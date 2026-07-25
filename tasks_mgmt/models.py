# এই ফাইলটি টাস্ক ম্যানেজমেন্টের জন্য: ক্যাটেগরি, টাস্ক, হিস্টোরি।
#
# Module 7 — Task Management System।
# কেন এই relations:
#   • TaskCategory → টাস্কের ধরন lookup (Installation, Maintenance, Recovery)।
#   • Task        → কেন্দ্রীয় কাজের record; assigned_to/created_by উভয়ই
#     accounts.User (Employee/Admin) এর সাথে strict FK — যাতে "My Tasks"
#     (employee filter) ও "All Tasks" (admin) SQL JOIN দিয়ে সরাসরি কাজ করে।
#   • client (optional) → কোন client/box-এর সাথে কাজ সম্পর্কিত হলে link।
#   • TaskHistory → প্রতিটি status/assignment পরিবর্তনের audit trail।
#
# Notification: Task assign/create হলে support.StaffNotification-এ record তৈরি
#   হয় (signals.py)। আলাদা notification model না বানিয়ে existing bell feed reuse
#   করা হয়েছে — যাতে Topbar-এর একটিই badge সব ধরনের alert দেখায় (no duplicate)।
from django.db import models
from django.conf import settings
from django.utils import timezone


class TaskCategory(models.Model):
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    color = models.CharField(max_length=20, default='#3B82F6')
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'task_categories'

    def __str__(self):
        return self.name


class Task(models.Model):
    # টাস্ক/কাজের রেকর্ড
    # Priority — requirement অনুযায়ী Low/Medium/High; 'urgent' legacy compat
    # (পুরনো row থাকলে ভাঙবে না)।
    PRIORITY_CHOICES = [
        ('low', 'Low'), ('medium', 'Medium'), ('high', 'High'),
        ('urgent', 'Urgent'),
    ]
    # Status — requirement: Pending / Processing / Completed / Overdue।
    #   • 'processing' = কাজ চলছে।
    #   • 'overdue'    = deadline পেরিয়েছে অথচ অসম্পূর্ণ। এটি মূলত derived
    #     (নিচের is_overdue property সবসময় live সঠিক value দেয়), কিন্তু
    #     stored value হিসেবেও allow করা আছে যাতে future-এ Celery job চাইলে
    #     persist করতে পারে।
    #   • 'in_progress' / 'cancelled' = পুরনো schema-র backward-compat।
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('processing', 'Processing'),
        ('completed', 'Completed'),
        ('overdue', 'Overdue'),
        ('in_progress', 'In Progress'),   # legacy
        ('cancelled', 'Cancelled'),        # legacy
    ]
    # কোন status-গুলোতে কাজ "শেষ" বিবেচিত — overdue হিসাব ও completed_at-এর জন্য।
    CLOSED_STATUSES = ('completed', 'cancelled')

    title = models.CharField(max_length=200)
    category = models.ForeignKey(TaskCategory, on_delete=models.SET_NULL, null=True, blank=True)
    description = models.TextField(blank=True)
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default='medium')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                    null=True, related_name='assigned_tasks')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                   null=True, related_name='created_tasks')
    client = models.ForeignKey('clients.Client', on_delete=models.SET_NULL,
                               null=True, blank=True, related_name='tasks')
    # deadline = countdown timer-এর canonical target time (requirement-mandated)।
    # due_date legacy column অপরিবর্তিত রাখা হলো (পুরনো data ভাঙা যাবে না), কিন্তু
    # সব নতুন logic deadline ব্যবহার করে। নতুন task-এ deadline না দিলে serializer
    # due_date থেকে fallback নেয়।
    deadline = models.DateTimeField(null=True, blank=True)
    due_date = models.DateTimeField(null=True, blank=True)   # legacy — deadline preferred
    # notification_sent = assign-notification একবারই পাঠানো হয়েছে কিনা — signal-এ
    # duplicate alert ঠেকাতে idempotency flag হিসেবে ব্যবহৃত।
    notification_sent = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'tasks'
        ordering = ['-created_at']

    def __str__(self):
        return self.title

    # ── Countdown / overdue helpers ───────────────────────────────────
    # কেন property: frontend live timer deadline থেকে নিজেই tick করে, কিন্তু
    # backend-এও সঠিক overdue/effective_status লাগে (stats, list badge)। এক
    # জায়গায় logic রাখলে frontend-backend mismatch হয় না।

    @property
    def is_overdue(self):
        # কাজ শেষ/বাতিল হলে কখনো overdue নয়; deadline না থাকলেও নয়।
        if self.status in self.CLOSED_STATUSES:
            return False
        if not self.deadline:
            return False
        return self.deadline < timezone.now()

    @property
    def effective_status(self):
        # stored status workflow-state ধরে রাখে; deadline cross করলে display-এ
        # 'overdue' দেখাই — admin/employee দু-জায়গাতেই consistent।
        if self.is_overdue:
            return 'overdue'
        return self.status

    @property
    def remaining_seconds(self):
        # deadline পর্যন্ত বাকি সেকেন্ড; অতীত হলে negative; deadline নাই হলে None।
        if not self.deadline:
            return None
        return int((self.deadline - timezone.now()).total_seconds())


class TaskHistory(models.Model):
    # টাস্কের পরিবর্তনের ইতিহাস
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='history')
    action = models.CharField(max_length=100)
    details = models.TextField(blank=True)
    performed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'task_history'
        ordering = ['-created_at']
