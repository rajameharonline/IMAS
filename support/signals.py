# এই ফাইলটি Support module-এর সমস্ত Django signal handler নিয়ন্ত্রণ করে।
#
# কেন signal-based approach: ticket-এর create / status change / assign event
# বিভিন্ন entry point (admin API, client portal API, future mobile API) থেকে
# trigger হতে পারে। সবগুলোতে duplicate code না লিখে এক জায়গায় signal হ্যান্ডল
# করলে business rule (activity log, staff notification) consistent থাকে।

from django.conf import settings
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver
from django.utils import timezone
from django.db import transaction

from support.models import (
    SupportTicket,
    TicketReply,
    TicketActivityLog,
    StaffNotification,
)


# ────────────────────────────────────────────────────────────────────
# Internal cache: pre_save snapshot — status/assigned_to-এর পুরনো মান
# track করার জন্য, যাতে post_save-এ "from → to" timeline লেখা যায়।
# Django built-in instance pk দিয়ে cache, transaction-safe।
# ────────────────────────────────────────────────────────────────────
_TICKET_PREV_SNAPSHOT = {}


def _push_fcm_to_users(user_ids, title, body, data=None):
    """নির্দিষ্ট staff user_id-দের fcm_token-এ push পাঠায় (staff মোবাইল অ্যাপ)।
    error-safe — token না থাকলে/ব্যর্থ হলে চুপচাপ skip। commit-পরে চলে।"""
    ids = [u for u in (user_ids or []) if u]
    if not ids:
        return

    def _send():
        try:
            from accounts.models import User
            from mobile_api.services import push_service
            tokens = list(
                User.objects.filter(id__in=ids, is_active=True)
                .exclude(fcm_token='').values_list('fcm_token', flat=True)
            )
            if tokens:
                push_service.send_to_multiple(tokens, title, body, data or {})
        except Exception:
            pass

    transaction.on_commit(_send)


@receiver(pre_save, sender=SupportTicket)
def _capture_previous_ticket_state(sender, instance, **kwargs):
    # নতুন create হলে কিছু capture করার নেই — শুধু update-এর time-এ।
    if not instance.pk:
        return
    try:
        prev = SupportTicket.objects.only('status', 'assigned_to_id', 'priority').get(pk=instance.pk)
        _TICKET_PREV_SNAPSHOT[instance.pk] = {
            'status':        prev.status,
            'assigned_to_id': prev.assigned_to_id,
            'priority':      prev.priority,
        }
    except SupportTicket.DoesNotExist:
        # খুব rare race condition — silently ignore।
        _TICKET_PREV_SNAPSHOT.pop(instance.pk, None)


@receiver(post_save, sender=SupportTicket)
def _on_ticket_saved(sender, instance, created, **kwargs):
    # নতুন ticket তৈরি হলে: activity log + notification feed dispatch।
    if created:
        _handle_ticket_created(instance)
        return

    # Existing ticket update — pre_save snapshot-এর সাথে diff নিয়ে activity
    # log + selective notification তৈরি করি।
    prev = _TICKET_PREV_SNAPSHOT.pop(instance.pk, None)
    if not prev:
        return
    _handle_ticket_updated(instance, prev)


def _handle_ticket_created(ticket: SupportTicket):
    # ── 1. Activity log — created event ───────────────────────────
    TicketActivityLog.objects.create(
        ticket=ticket,
        actor=ticket.created_by,
        action_type='created',
        to_value=ticket.status,
        message=f'Ticket created with priority {ticket.priority}',
    )

    # ── 2. Notification — সব admin/superadmin + assigned employee ─
    # কেন: client portal থেকে ticket এলে staff কে দেখাতে হবে badge alert।
    # কোন user-দের: role IN (admin, superadmin) যাদের is_active=True।
    user_model = _get_user_model()
    recipients_qs = user_model.objects.filter(
        is_active=True,
        role__in=['admin', 'superadmin', 'manager', 'support'],
    )
    # assigned employee যদি আলাদা role হয় তবে also include করি (dedup করব)।
    extra_id = ticket.assigned_to_id
    extra_qs = user_model.objects.filter(pk=extra_id) if extra_id else user_model.objects.none()
    user_ids = set(recipients_qs.values_list('id', flat=True)) | set(extra_qs.values_list('id', flat=True))
    # creator কে নিজস্ব ticket-এর notification পাঠানো অপ্রয়োজনীয়।
    if ticket.created_by_id:
        user_ids.discard(ticket.created_by_id)

    client_name = getattr(ticket.client, 'full_name', '') or getattr(ticket.client, 'customer_id', '')
    source_label = ticket.get_source_display() if hasattr(ticket, 'get_source_display') else ticket.source
    notif_title = f'New Ticket: {ticket.ticket_id}'
    notif_msg   = f'{client_name} — {ticket.subject} ({source_label})'
    link        = f'/support/tickets?id={ticket.id}'

    StaffNotification.objects.bulk_create([
        StaffNotification(
            recipient_id=uid,
            notif_type='ticket_created',
            title=notif_title,
            message=notif_msg,
            link_url=link,
            related_ticket=ticket,
        )
        for uid in user_ids
    ])

    # ── 3. FCM push — staff মোবাইল অ্যাপে instant alert ──
    _push_fcm_to_users(user_ids, notif_title, notif_msg, {
        'type': 'ticket_created', 'ticket_id': str(ticket.id),
    })


def _log_status_change(ticket, prev, actor):
    """status বদলালে activity log + resolved/closed timestamp + assignee/creator notification।"""
    if prev.get('status') == ticket.status:
        return
    TicketActivityLog.objects.create(
        ticket=ticket,
        actor=actor,
        action_type='status_change',
        from_value=prev.get('status', ''),
        to_value=ticket.status,
        message=f'Status: {prev.get("status")} → {ticket.status}',
    )
    # status closed/resolved হলে timestamp set করি (যদি set না থাকে)
    if ticket.status == 'resolved' and not ticket.resolved_at:
        SupportTicket.objects.filter(pk=ticket.pk).update(resolved_at=timezone.now())
    if ticket.status == 'closed' and not ticket.closed_at:
        SupportTicket.objects.filter(pk=ticket.pk).update(closed_at=timezone.now())

    # assigned employee + ticket creator কে status notification পাঠাই।
    targets = {ticket.assigned_to_id, ticket.created_by_id} - {None, getattr(actor, 'id', None)}
    if targets:
        StaffNotification.objects.bulk_create([
            StaffNotification(
                recipient_id=uid,
                notif_type='ticket_status',
                title=f'Ticket {ticket.ticket_id} updated',
                message=f'Status changed to {ticket.status}',
                link_url=f'/support/tickets?id={ticket.id}',
                related_ticket=ticket,
            )
            for uid in targets
        ])
        _push_fcm_to_users(list(targets), f'Ticket {ticket.ticket_id} updated',
                           f'Status changed to {ticket.status}',
                           {'type': 'ticket_status', 'ticket_id': str(ticket.id)})


def _log_assignment_change(ticket, prev, actor):
    """assignment বদলালে activity log + নতুন assignee-কে instant notification।"""
    if prev.get('assigned_to_id') == ticket.assigned_to_id:
        return
    action = 'reassigned' if prev.get('assigned_to_id') else 'assigned'
    TicketActivityLog.objects.create(
        ticket=ticket,
        actor=actor,
        action_type=action,
        from_value=str(prev.get('assigned_to_id') or ''),
        to_value=str(ticket.assigned_to_id or ''),
        message='Ticket re-assigned' if prev.get('assigned_to_id') else 'Ticket assigned',
    )
    # নতুন assigned employee কে instant notification পাঠাই।
    if ticket.assigned_to_id and ticket.assigned_to_id != getattr(actor, 'id', None):
        StaffNotification.objects.create(
            recipient_id=ticket.assigned_to_id,
            notif_type='ticket_assigned',
            title=f'Ticket {ticket.ticket_id} assigned to you',
            message=ticket.subject[:200],
            link_url=f'/support/tickets?id={ticket.id}',
            related_ticket=ticket,
        )
        _push_fcm_to_users([ticket.assigned_to_id],
                           f'Ticket {ticket.ticket_id} assigned to you',
                           ticket.subject[:200],
                           {'type': 'ticket_assigned', 'ticket_id': str(ticket.id)})


def _log_priority_change(ticket, prev, actor):
    """priority বদলালে activity log।"""
    if prev.get('priority') == ticket.priority:
        return
    TicketActivityLog.objects.create(
        ticket=ticket,
        actor=actor,
        action_type='priority_change',
        from_value=prev.get('priority', ''),
        to_value=ticket.priority,
    )


def _handle_ticket_updated(ticket: SupportTicket, prev: dict):
    actor = getattr(ticket, '_actor_user', None)  # serializer view থেকে inject হলে
    _log_status_change(ticket, prev, actor)
    _log_assignment_change(ticket, prev, actor)
    _log_priority_change(ticket, prev, actor)


# ────────────────────────────────────────────────────────────────────
# Ticket reply signal — staff/client একটি reply দিলে assigned employee
# ও ticket creator কে notification পাঠানো হয়।
# ────────────────────────────────────────────────────────────────────
@receiver(post_save, sender=TicketReply)
def _on_reply_created(sender, instance, created, **kwargs):
    if not created:
        return
    ticket = instance.ticket
    TicketActivityLog.objects.create(
        ticket=ticket,
        actor=instance.replied_by,
        action_type='replied',
        message=instance.message[:250],
    )
    # যিনি reply দিয়েছেন তাকে notification পাঠানোর দরকার নেই।
    targets = {ticket.assigned_to_id, ticket.created_by_id}
    if instance.replied_by_id:
        targets.discard(instance.replied_by_id)
    targets.discard(None)
    if not targets:
        return
    StaffNotification.objects.bulk_create([
        StaffNotification(
            recipient_id=uid,
            notif_type='ticket_reply',
            title=f'New reply on {ticket.ticket_id}',
            message=instance.message[:200],
            link_url=f'/support/tickets?id={ticket.id}',
            related_ticket=ticket,
        )
        for uid in targets
    ])


def _get_user_model():
    # Lazy import — circular import এড়ানোর জন্য signal handler-এর ভেতরে।
    from django.contrib.auth import get_user_model
    return get_user_model()
