# Mobile API app — OTP রেকর্ড ও Push Notification লগ।
import secrets
import string
from django.db import models
from django.conf import settings
from django.utils import timezone
from datetime import timedelta


class OTPRecord(models.Model):
    # Client phone-এ পাঠানো OTP কোড ট্র্যাক করা
    phone      = models.CharField(max_length=20, db_index=True)
    otp_code   = models.CharField(max_length=6)
    is_used    = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    class Meta:
        db_table = 'mobile_otp_records'
        ordering = ['-created_at']

    def __str__(self):
        return f"OTP {self.phone} ({self.created_at:%Y-%m-%d %H:%M})"

    def is_valid(self):
        return not self.is_used and timezone.now() < self.expires_at

    @classmethod
    def generate(cls, phone: str) -> 'OTPRecord':
        # পুরনো unused OTP গুলো invalidate করে নতুন OTP তৈরি
        cls.objects.filter(phone=phone, is_used=False).update(is_used=True)
        code = ''.join(secrets.choice(string.digits) for _ in range(6))
        expire = timezone.now() + timedelta(minutes=10)
        return cls.objects.create(phone=phone, otp_code=code, expires_at=expire)


class BkashPaymentSession(models.Model):
    # bKash Tokenized Checkout session track করা
    PURPOSE_CHOICES = [
        ('bill',            'Bill Payment'),
        ('package_upgrade', 'Package Upgrade'),
    ]
    client       = models.ForeignKey('clients.Client', on_delete=models.CASCADE)
    payment_id   = models.CharField(max_length=100, unique=True)
    invoice_no   = models.CharField(max_length=100)
    amount       = models.DecimalField(max_digits=10, decimal_places=2)
    token        = models.TextField()  # grant token (short-lived)
    trx_id       = models.CharField(max_length=100, blank=True)
    is_completed = models.BooleanField(default=False)
    # Package upgrade-এর জন্য অতিরিক্ত fields
    purpose      = models.CharField(max_length=30, choices=PURPOSE_CHOICES, default='bill')
    new_package  = models.ForeignKey(
        'configuration.Package', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='upgrade_sessions',
    )
    created_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'mobile_bkash_sessions'
        ordering = ['-created_at']

    def __str__(self):
        return f'bKash {self.client.customer_id} ৳{self.amount}'


class PushNotificationLog(models.Model):
    # Admin থেকে পাঠানো push notification-এর log
    TARGET_CHOICES = [
        ('all',    'সকল Client'),
        ('zone',   'নির্দিষ্ট Zone'),
        ('client', 'নির্দিষ্ট Client'),
    ]
    title       = models.CharField(max_length=200)
    body        = models.TextField()
    target_type = models.CharField(max_length=10, choices=TARGET_CHOICES, default='all')
    target_id   = models.IntegerField(null=True, blank=True, help_text='Zone ID বা Client ID')
    target_name = models.CharField(max_length=200, blank=True)
    sent_count  = models.IntegerField(default=0)
    fail_count  = models.IntegerField(default=0)
    sent_by     = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    sent_at     = models.DateTimeField(auto_now_add=True)
    extra_data  = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = 'push_notification_logs'
        ordering = ['-sent_at']

    def __str__(self):
        return f"{self.title} → {self.get_target_type_display()} ({self.sent_count} sent)"
