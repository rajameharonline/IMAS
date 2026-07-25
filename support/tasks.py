# support-সংক্রান্ত Celery background task।
# AI দিয়ে নতুন ticket auto-categorize + smart-routing + sentiment-flag + auto-reply —
# ticket create-এর response ধীর না করে background-এ চলে।
from celery import shared_task
import logging

logger = logging.getLogger(__name__)

_PRIO_RANK = {'low': 1, 'medium': 2, 'high': 3, 'urgent': 4, 'critical': 5}

# intent → কোন role-কে assign করা ভালো (priority-order; প্রথম যে role-এ active user আছে)
_ROUTE_ROLES = {
    'billing_due':     ['accountant', 'support', 'manager'],
    'connection_down': ['support', 'manager'],
    'speed_slow':      ['support', 'manager'],
    'package_change':  ['manager', 'support'],
    'new_connection':  ['manager', 'support'],
    'general':         ['support', 'manager'],
}

# খুব নিরাপদ intent — auto-reply চালু থাকলে draft উত্তর পোস্ট করা হয়
_AUTOREPLY_INTENTS = {'billing_due'}


def _pick_assignee(role_priority):
    """প্রদত্ত role-priority-তে প্রথম যে role-এ active user আছে, সেখান থেকে সবচেয়ে কম
    open ticket-ওয়ালা user ফেরত দেয় (load-balance)। কেউ না থাকলে None।"""
    try:
        from django.db.models import Count, Q
        from accounts.models import User
        # প্রদত্ত role-গুলোর পর fallback admin → superadmin — ছোট ISP-তে support/
        # manager না থাকলেও ticket যেন সবসময় কারও কাছে assign হয়।
        for role in list(role_priority) + ['admin', 'superadmin']:
            qs = User.objects.filter(is_active=True, role=role)
            if qs.exists():
                qs = qs.annotate(open_ct=Count(
                    'assigned_tickets',
                    filter=Q(assigned_tickets__status__in=['open', 'in_progress']))
                ).order_by('open_ct', 'id')
                return qs.first()
    except Exception as e:
        logger.warning("_pick_assignee failed: %s", e)
    return None


@shared_task(name='support.ai_categorize_ticket')
def _apply_ai_fields(ticket, meta, sentiment, intent):
    """AI meta + sentiment অনুযায়ী ticket-এর category/priority/assignee সেট করে
    (in-place mutate), update_fields list ফেরত দেয়। মানুষ সেট করা মান override করে না।"""
    from support.models import SupportCategory
    update_fields = []
    # category — মানুষ সেট না করে থাকলে AI category (নাম দিয়ে get_or_create)
    if not ticket.category_id:
        cat, _ = SupportCategory.objects.get_or_create(
            name=meta['category'],
            defaults={'description': 'AI auto-categorized'},
        )
        ticket.category = cat
        update_fields.append('category')

    # priority — ticket এখনো default 'medium' হলে AI priority সেট
    if ticket.priority in ('medium', '') and meta['priority'] != ticket.priority:
        ticket.priority = meta['priority']
        update_fields.append('priority')

    # ── #5 Sentiment flag — গ্রাহক অসন্তুষ্ট/রাগান্বিত হলে priority bump ──────
    if sentiment == 'negative' and _PRIO_RANK.get(ticket.priority, 0) < _PRIO_RANK['high']:
        ticket.priority = 'high'
        if 'priority' not in update_fields:
            update_fields.append('priority')

    # ── #4 Smart-routing — unassigned হলে role-ভিত্তিক load-balance assign ────
    if not ticket.assigned_to_id:
        assignee = _pick_assignee(_ROUTE_ROLES.get(intent, ['support', 'manager']))
        if assignee:
            ticket.assigned_to = assignee
            update_fields.append('assigned_to')
    return update_fields


def _write_categorize_audit(ticket, meta, intent, sentiment, update_fields):
    """AI auto-categorize-এর audit trail note (fail হলে চুপচাপ)।"""
    try:
        from support.models import TicketActivityLog
        note = f"AI auto-categorize → {meta['category']} ({intent}), priority={ticket.priority}"
        if sentiment == 'negative':
            note += " | 😟 অসন্তুষ্ট গ্রাহক — অগ্রাধিকার দিন"
        if 'assigned_to' in update_fields and ticket.assigned_to_id:
            note += f" | auto-assign → {ticket.assigned_to.full_name or ticket.assigned_to.username}"
        TicketActivityLog.objects.create(ticket=ticket, action_type='note', message=note)
    except Exception:
        pass


def _maybe_auto_reply(ticket, intent, text, ai_service):
    """#6 Auto-reply — নিরাপদ intent + flag চালু + portal + কোনো staff reply নেই হলে
    AI draft reply তৈরি; returns auto_replied bool।"""
    try:
        from django.conf import settings
        if (getattr(settings, 'AI_TICKET_AUTOREPLY', False)
                and ticket.source == 'portal' and intent in _AUTOREPLY_INTENTS
                and not ticket.replies.filter(is_client_reply=False).exists()):
            from support.models import TicketReply
            draft = ai_service.render_reply(intent, ticket.client, text)
            TicketReply.objects.create(
                ticket=ticket, message=f"🤖 (স্বয়ংক্রিয় উত্তর)\n{draft}", is_client_reply=False)
            return True
    except Exception as e:
        logger.warning("ai auto-reply failed: %s", e)
    return False


def ai_categorize_ticket(ticket_id: int):
    """নতুন ticket-কে AI দিয়ে শ্রেণিবদ্ধ করে category + priority সেট করে।

    🔒 শুধু ticket text AI-তে যায় (sensitive কিছু নয়)। মানুষ আগে থেকে category/
    priority সেট করে থাকলে override করে না।
    """
    from support.models import SupportTicket
    from support import ai_service

    try:
        ticket = SupportTicket.objects.select_related('category').get(id=ticket_id)
    except SupportTicket.DoesNotExist:
        return {'error': 'ticket নেই'}

    intent = ai_service.classify_ticket(ticket)
    meta = ai_service.INTENT_META.get(intent, ai_service.INTENT_META['general'])
    text = f"{ticket.subject}\n{ticket.description}"
    sentiment = ai_service.classify_sentiment(text)

    update_fields = _apply_ai_fields(ticket, meta, sentiment, intent)
    if update_fields:
        # save করলে signal status/assign/priority change-এ StaffNotification পাঠায়
        ticket.save(update_fields=update_fields)

    _write_categorize_audit(ticket, meta, intent, sentiment, update_fields)
    auto_replied = _maybe_auto_reply(ticket, intent, text, ai_service)

    logger.info("ai_categorize_ticket %s → %s (%s) sentiment=%s assigned=%s autoreply=%s",
                ticket.ticket_id, intent, meta['category'], sentiment,
                ticket.assigned_to_id, auto_replied)
    return {'ticket': ticket.ticket_id, 'intent': intent, 'category': meta['category'],
            'sentiment': sentiment, 'assigned_to': ticket.assigned_to_id,
            'auto_replied': auto_replied, 'updated': update_fields}
