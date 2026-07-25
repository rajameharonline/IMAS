# এই ফাইলটি Task Management module-এর business-logic signal handler ধারণ করে।
#
# কেন signals (view-তে না রেখে):
#   Task যেখান থেকেই create/update হোক (admin panel, future মোবাইল API, Django
#   admin) — notification + audit trail + completed_at সবসময় consistent থাকবে।
#
# এখানে যা হয়:
#   1. Admin task assign/create করলে assigned employee-কে তাৎক্ষণিক
#      StaffNotification (bell badge) পাঠানো হয় → requirement #4 (real-time
#      admin→employee notification)।
#   2. status / assignment পরিবর্তনে TaskHistory audit log লেখা হয়।
#   3. status='completed' হলে completed_at auto-set হয়।
#
# Notification model হিসেবে support.StaffNotification reuse করা হয়েছে — runtime
# import (migration-level coupling নেই), তাই existing FreeRADIUS/Billing/Support
# কোনো logic ভাঙে না।

from django.db.models.signals import pre_save, post_save
from django.dispatch import receiver
from django.utils import timezone

from tasks_mgmt.models import Task, TaskHistory


# ════════════════════════════════════════════════════════════════════
# pre_save — পুরনো state snapshot, যেন post_save-এ পরিবর্তন detect করা যায়।
# ════════════════════════════════════════════════════════════════════
@receiver(pre_save, sender=Task)
def _capture_old_task_state(sender, instance, **kwargs):
    if not instance.pk:
        # নতুন task — পুরনো state নেই।
        instance._old_status = None
        instance._old_assigned_to_id = None
        return
    try:
        old = Task.objects.get(pk=instance.pk)
        instance._old_status = old.status
        instance._old_assigned_to_id = old.assigned_to_id
    except Task.DoesNotExist:
        instance._old_status = None
        instance._old_assigned_to_id = None


# ════════════════════════════════════════════════════════════════════
# post_save — completed_at auto-set + audit log + notification।
# ════════════════════════════════════════════════════════════════════
@receiver(post_save, sender=Task)
def _task_post_save(sender, instance, created, **kwargs):
    # actor = কে এই পরিবর্তন করল (view থেকে inject করা হয়)। না থাকলে None।
    actor = getattr(instance, '_actor_user', None)

    # ── 1. completed_at auto-set (recursion-safe update) ─────────────
    if instance.status == 'completed' and not instance.completed_at:
        # post_save আবার trigger না করিয়ে সরাসরি column update করি।
        Task.objects.filter(pk=instance.pk).update(completed_at=timezone.now())

    # ── 2. নতুন task → created log + assignee notification ────────────
    if created:
        # creation-এ view থেকে আলাদা actor inject করা হয় না; created_by-ই actor।
        creator = actor or instance.created_by
        TaskHistory.objects.create(
            task=instance,
            action='created',
            details=f'Task "{instance.title}" created.',
            performed_by=creator,
        )
        # create-এর সাথেই assigned থাকলে assigned employee-কে instantly notify।
        _notify_assignment(instance, creator, is_new=True)
        return

    # ── 3. বিদ্যমান task update ───────────────────────────────────────
    old_status = getattr(instance, '_old_status', None)
    old_assignee = getattr(instance, '_old_assigned_to_id', None)

    # status পরিবর্তন → log + (assignee/creator-কে) notify।
    if old_status is not None and old_status != instance.status:
        TaskHistory.objects.create(
            task=instance,
            action='status_change',
            details=f'Status: {old_status} → {instance.status}',
            performed_by=actor,
        )
        _notify_status_change(instance, actor)

    # assignment পরিবর্তন (re-assign) → log + নতুন assignee-কে notify।
    if old_assignee != instance.assigned_to_id:
        TaskHistory.objects.create(
            task=instance,
            action='reassigned',
            details=f'Assignment changed (user #{old_assignee or "—"} → '
                    f'#{instance.assigned_to_id or "—"}).',
            performed_by=actor,
        )
        _notify_assignment(instance, actor, is_new=False)


# ════════════════════════════════════════════════════════════════════
# Helper: assigned employee-কে notification + bell badge পাঠাই।
# ════════════════════════════════════════════════════════════════════
def _notify_assignment(task, actor, is_new):
    # assignee না থাকলে notify করার কেউ নেই।
    if not task.assigned_to_id:
        return
    # নিজে নিজেকে assign করলে notification অর্থহীন।
    if actor and actor.id == task.assigned_to_id:
        # তবু notification_sent flag set করে রাখি (idempotency)।
        if not task.notification_sent:
            Task.objects.filter(pk=task.pk).update(notification_sent=True)
        return

    # support.StaffNotification — runtime import, migration coupling এড়াতে।
    from support.models import StaffNotification
    StaffNotification.objects.create(
        recipient_id=task.assigned_to_id,
        notif_type='task_created' if is_new else 'task_assigned',
        title=f'New task assigned: {task.title[:120]}',
        message=(task.description or '')[:200],
        # employee নিজের কাজ দেখবে "My Tasks" page-এ — সেখানে deep-link।
        link_url=f'/tasks/mine?id={task.id}',
    )
    # একবার পাঠানো হয়েছে — flag set (requirement: notification_sent)।
    Task.objects.filter(pk=task.pk).update(notification_sent=True)


def _notify_status_change(task, actor):
    # status বদলালে assignee + creator উভয়কে জানাই (যে বদলেছে সে ছাড়া)।
    from support.models import StaffNotification
    recipients = set()
    if task.assigned_to_id:
        recipients.add(task.assigned_to_id)
    if task.created_by_id:
        recipients.add(task.created_by_id)
    if actor:
        recipients.discard(actor.id)
    for rid in recipients:
        StaffNotification.objects.create(
            recipient_id=rid,
            notif_type='task_status',
            title=f'Task status: {task.title[:110]} → {task.status}',
            message=(task.description or '')[:200],
            link_url=f'/tasks/mine?id={task.id}',
        )
