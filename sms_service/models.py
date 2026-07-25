# এই ফাইলটি SMS সার্ভিস ম্যানেজমেন্টের জন্য: গেটওয়ে, টেমপ্লেট, গ্রুপ, SMS লগ।
from django.db import models
from django.conf import settings


class SMSGateway(models.Model):
    # Multi-channel messaging gateway — Local SMS / WhatsApp / Telegram / Email।
    PROVIDER_TYPES = [
        ('sms_http', 'Local SMS Provider (HTTP API)'),
        ('whatsapp', 'WhatsApp API'),
        ('telegram', 'Telegram Bot'),
        ('email',    'Email (SMTP)'),
    ]
    name          = models.CharField(max_length=100, unique=True)
    provider_type = models.CharField(max_length=20, choices=PROVIDER_TYPES,
                                     default='sms_http', db_index=True)
    # ── HTTP/SMS/WhatsApp common ──
    api_url   = models.URLField(blank=True)          # endpoint (provider-ভেদে)
    api_key   = models.CharField(max_length=500, blank=True)  # api key / token / bot token
    sender_id = models.CharField(max_length=100, blank=True)  # sender id / from / phone_number_id
    # ── channel-নির্দিষ্ট বাকি সব config (JSON) ──
    # sms_http: http_method,send_as,to_param,msg_param,sender_param,key_param,auth_header,extra_params
    # whatsapp: phone_number_id
    # telegram: chat_id
    # email   : smtp_host,smtp_port,smtp_user,smtp_password,from_email,use_tls,subject
    config    = models.JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=True)
    is_default = models.BooleanField(default=False, help_text='ডিফল্ট চ্যানেল (পাঠানোর জন্য)')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'sms_gateways'

    def __str__(self):
        return f'{self.name} ({self.get_provider_type_display()})'


class SMSTemplate(models.Model):
    # SMS টেমপ্লেট - বিভিন্ন ধরনের SMS-এর জন্য ({placeholder} সহ)
    TYPE_CHOICES = [('default', 'Default'), ('custom', 'Custom')]
    name = models.CharField(max_length=100, unique=True)
    content = models.TextField()
    template_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='custom')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'sms_templates'
        ordering = ['id']

    def __str__(self):
        return self.name


class SMSGroup(models.Model):
    # SMS গ্রুপ - একসাথে অনেক ক্লায়েন্টকে SMS পাঠানোর জন্য
    name = models.CharField(max_length=100, unique=True)
    clients = models.ManyToManyField('clients.Client', blank=True, related_name='sms_groups')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'sms_groups'


class SMSLog(models.Model):
    # SMS পাঠানোর লগ রেকর্ড
    STATUS_CHOICES = [
        ('pending', 'Pending'), ('sent', 'Sent'),
        ('failed', 'Failed'), ('delivered', 'Delivered'),
    ]
    recipient_phone = models.CharField(max_length=20)
    client = models.ForeignKey('clients.Client', on_delete=models.SET_NULL,
                               null=True, blank=True, related_name='sms_logs')
    template = models.ForeignKey(SMSTemplate, on_delete=models.SET_NULL, null=True, blank=True)
    message = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    gateway = models.ForeignKey(SMSGateway, on_delete=models.SET_NULL, null=True)
    sent_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    gateway_response = models.TextField(blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'sms_logs'
        ordering = ['-created_at']
