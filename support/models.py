# এই ফাইলটি Support & Ticketing System-এর core data model ধারণ করে।
#
# কেন এই relations:
#   • SupportCategory → ticket-এর "TicketType" (যেমন: Fiber Cut, Router Issue,
#     Billing Query) — frontend dropdown ও admin lookup এর জন্য।
#   • SupportTicket  → প্রতিটি client-issue-এর কেন্দ্রীয় record; Client
#     (clients.Client) + assigned_employee/created_by (accounts.User) — উভয়
#     table-এর সাথে strict FK দেওয়া আছে যেন reporting + role filter সরাসরি
#     SQL JOIN দিয়ে কাজ করতে পারে।
#   • TicketReply   → ticket-এর staff/client conversation history।
#   • TicketActivityLog → status change / assignment / created — audit trail।
#   • StaffNotification → client/employee ticket তৈরি করলে সংশ্লিষ্ট admin +
#     assigned employee-এর জন্য তাৎক্ষণিক notification badge ফিড।
#
# সতর্কতা: existing FreeRADIUS / Mikrotik / Billing logic-এর সাথে এই module-এর
#   কোনো coupling নেই — শুধু read-only Client FK ব্যবহৃত হয়েছে।

from django.db import models
from django.conf import settings


class SupportCategory(models.Model):
    # SupportCategory effectively "TicketType" lookup — যেমন: Fiber Cut,
    # Router Issue, Billing Query, Speed Slow ইত্যাদি admin-managed list।
    # পুরনো API/data-র সাথে compatible থাকার জন্য DB table নাম অপরিবর্তিত।
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True, null=True)

    class Meta:
        db_table = 'support_categories'
        ordering = ['name']

    def __str__(self):
        return self.name


class SupportTicket(models.Model):
    # ── Core relational integrity ──────────────────────────────────────
    # Client → CASCADE: client delete হলে orphan ticket রাখতে চাই না।
    # assigned_to (employee/user) → SET_NULL: staff চলে গেলেও ticket থাকবে।
    # category (TicketType lookup) → SET_NULL: lookup delete হলে FK null হবে।

    PRIORITY_CHOICES = [
        ('low',     'Low'),
        ('medium',  'Medium'),
        ('high',    'High'),
        ('critical', 'Critical'),   # নতুন — emergency-level issues
        ('urgent',  'Urgent'),      # legacy compat (পুরনো record ছিল)
    ]
    STATUS_CHOICES = [
        ('open',        'Open'),
        ('in_progress', 'In Progress'),
        ('resolved',    'Resolved'),
        ('closed',      'Closed'),
    ]
    SOURCE_CHOICES = [
        ('admin',  'Admin Panel'),
        ('portal', 'Client Portal'),     # client নিজেই open করলে
        ('phone',  'Phone / Walk-in'),
        ('field',  'Field Engineer'),
    ]

    # ticket_id = ticket_no — auto-generated unique identifier (TKT-XXXXX)।
    ticket_id = models.CharField(max_length=50, unique=True, db_index=True)
    client = models.ForeignKey(
        'clients.Client', on_delete=models.CASCADE, related_name='tickets',
    )
    category = models.ForeignKey(
        SupportCategory, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='tickets',
    )
    subject = models.CharField(max_length=200)
    description = models.TextField()
    priority = models.CharField(
        max_length=20, choices=PRIORITY_CHOICES, default='medium',
    )
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default='open', db_index=True,
    )
    source = models.CharField(
        max_length=20, choices=SOURCE_CHOICES, default='admin',
        help_text='Ticket কোথা থেকে এসেছে — client portal হলে staff-এর কাছে instant notification যাবে।',
    )
    # assigned_to = "assigned_employee" — null হলে unassigned।
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='assigned_tickets',
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='created_tickets',
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    closed_at   = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'support_tickets'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.ticket_id} - {self.subject}"


class TicketReply(models.Model):
    # Ticket-এর প্রতিটি reply/comment — staff ↔ client conversation thread।
    ticket = models.ForeignKey(
        SupportTicket, on_delete=models.CASCADE, related_name='replies',
    )
    message = models.TextField()
    is_client_reply = models.BooleanField(default=False)
    replied_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'ticket_replies'
        ordering = ['created_at']


class TicketActivityLog(models.Model):
    # প্রতিটি ticket-এর audit trail — কে কখন কী করেছে (status change, assign,
    # reply, created)। future-এ ticket detail page এ timeline দেখানো হবে।
    ACTION_CHOICES = [
        ('created',      'Created'),
        ('status_change', 'Status Changed'),
        ('assigned',     'Assigned'),
        ('reassigned',   'Re-assigned'),
        ('replied',      'Replied'),
        ('priority_change', 'Priority Changed'),
        ('closed',       'Closed'),
        ('reopened',     'Reopened'),
    ]
    ticket = models.ForeignKey(
        SupportTicket, on_delete=models.CASCADE, related_name='activity_logs',
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='ticket_activities',
    )
    action_type = models.CharField(max_length=30, choices=ACTION_CHOICES)
    # before/after snapshot — যেন timeline-এ "Open → In Progress" দেখানো যায়।
    from_value = models.CharField(max_length=100, blank=True)
    to_value   = models.CharField(max_length=100, blank=True)
    message    = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = 'ticket_activity_logs'
        ordering = ['-created_at']

    def __str__(self):
        return f"[{self.action_type}] {self.ticket.ticket_id} @ {self.created_at:%Y-%m-%d %H:%M}"


class StaffNotification(models.Model):
    # Staff (admin/employee) panel-এর notification badge feed।
    # কেন আলাদা model: ticket creation, assignment, status change — সব ধরনের
    # alert এক জায়গায় থাকলে frontend একটি query দিয়ে badge count পায় এবং
    # future-এ অন্য module (billing, hr) থেকেও notification push করা যাবে।
    NOTIF_TYPES = [
        ('ticket_created',  'New Ticket Created'),
        ('ticket_assigned', 'Ticket Assigned'),
        ('ticket_status',   'Ticket Status Updated'),
        ('ticket_reply',    'New Reply on Ticket'),
        # Module 7 — Task Management notification types। আলাদা feed না বানিয়ে
        # একই bell badge-এ task alert দেখানোর জন্য এই type-গুলো যোগ করা হলো।
        ('task_assigned',   'Task Assigned'),
        ('task_created',    'New Task Created'),
        ('task_status',     'Task Status Updated'),
        ('system',          'System Notification'),
    ]

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='staff_notifications',
        # User-এর FK CASCADE — user delete হলে পুরনো notification রাখার দরকার নেই।
    )
    notif_type = models.CharField(max_length=30, choices=NOTIF_TYPES)
    title   = models.CharField(max_length=200)
    message = models.CharField(max_length=500, blank=True)
    link_url = models.CharField(
        max_length=300, blank=True,
        help_text='Frontend route — যেমন /support/tickets?id=123',
    )
    # সরাসরি ticket reference — listing / detail-এ JOIN ছাড়াই কাজ চলে।
    related_ticket = models.ForeignKey(
        SupportTicket, on_delete=models.CASCADE, null=True, blank=True,
        related_name='notifications',
    )
    is_read = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    read_at    = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'staff_notifications'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['recipient', 'is_read']),
        ]

    def __str__(self):
        return f"[{self.notif_type}] → {self.recipient_id} ({'read' if self.is_read else 'unread'})"
