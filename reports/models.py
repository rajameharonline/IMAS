# এই ফাইলটি রিপোর্ট মডিউলের জন্য - রিপোর্ট লগ ও শিডিউল সংরক্ষণ করে।
from django.db import models
from django.conf import settings


class ReportLog(models.Model):
    # জেনারেট করা রিপোর্টের লগ
    REPORT_TYPES = [
        ('bill_collection', 'Bill Collection'),
        ('customer_report', 'Customer Report'),
        ('due_customer', 'Due Customer'),
        ('financial', 'Financial Transactions'),
        ('btrc_monthly', 'BTRC Monthly'),
        ('discount', 'Discount Report'),
    ]
    report_type = models.CharField(max_length=50, choices=REPORT_TYPES)
    parameters = models.JSONField(default=dict)
    file_path = models.CharField(max_length=500, blank=True)
    generated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    generated_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'report_logs'
        ordering = ['-generated_at']
