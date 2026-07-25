# এই ফাইলটি সিস্টেম সেটিংস, কোম্পানি তথ্য, পেমেন্ট গেটওয়ে, ইমেইল সেটআপ পরিচালনার জন্য।
from django.db import models
from django.conf import settings


class CompanySetup(models.Model):
    # ISP কোম্পানির মূল তথ্য
    name = models.CharField(max_length=200)
    address = models.TextField(blank=True)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    website = models.URLField(blank=True)
    logo = models.ImageField(upload_to='company/', blank=True, null=True)
    trade_license = models.CharField(max_length=100, blank=True)
    btrc_license = models.CharField(max_length=100, blank=True)
    # Customer ID format — prefix-XXXXX
    customer_id_prefix = models.CharField(
        max_length=20, default='ISP', blank=True,
        help_text="নতুন ক্লায়েন্টের Customer ID-এর prefix (যেমন ISP, RC, NET)"
    )
    customer_id_digits = models.PositiveSmallIntegerField(
        default=5,
        help_text="Number-অংশে কত digit থাকবে (৩–১০), যেমন 5 হলে ISP-00001"
    )
    customer_id_start_number = models.PositiveIntegerField(
        default=1,
        help_text="নতুন client-এর starting number (যেমন 1000 হলে প্রথম client হবে 1000)"
    )
    customer_id_editable = models.BooleanField(
        default=False,
        help_text="True হলে Edit Client ফর্মে Customer ID field দেখা যাবে ও পরিবর্তন করা যাবে"
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'company_setup'

    def __str__(self):
        return self.name


class InvoiceSetup(models.Model):
    # ইনভয়েস/বিল ফরম্যাট সেটআপ
    prefix = models.CharField(max_length=20, default='INV')
    start_number = models.IntegerField(default=1000)
    header_color = models.CharField(max_length=20, default='#DC5014', blank=True)
    footer_text = models.TextField(blank=True)
    note_text = models.TextField(
        blank=True,
        default="This is a computerized Invoice and doesn't need any signature.",
    )
    show_logo = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'invoice_setup'


class SystemSetting(models.Model):
    # Key-Value সিস্টেম সেটিংস
    key = models.CharField(max_length=100, unique=True)
    value = models.TextField()
    description = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'system_settings'

    def __str__(self):
        return f"{self.key}: {self.value}"


class ActivityLog(models.Model):
    # সিস্টেম অ্যাক্টিভিটি লগ - কে, কখন, কী করেছে
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    action = models.CharField(max_length=200)
    model_name = models.CharField(max_length=100, blank=True)
    object_id = models.CharField(max_length=50, blank=True)
    details = models.JSONField(default=dict)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'activity_logs'
        ordering = ['-created_at']


class PaymentGatewayConfig(models.Model):
    # পেমেন্ট গেটওয়ে কনফিগারেশন — ১৪টি গেটওয়ে সাপোর্ট
    GATEWAY_CHOICES = [
        ('sslcommerz',     'SSLCommerz'),
        ('bkash',          'bKash'),
        ('nagad',          'Nagad'),
        ('aamarpay',       'aamarPay'),
        ('shurjopay',      'shurjoPay'),
        ('fosterpayments', 'FosterPayments'),
        ('walletmix',      'Walletmix'),
        ('phonepe',        'PhonePe'),
        ('razorpay',       'Razorpay'),
        ('rocket',         'Rocket'),
        ('stripe',         'Stripe'),
        ('easypayment',    'EasyPayment'),
        ('webhook',        'Webhook'),
        ('paybill',        'Paybill'),
    ]

    GATEWAY_TYPE_CHOICES = [
        # bKash
        ('bkash_tokenized',    'bKash Tokenized API (Web/URL) Payment'),
        ('bkash_checkout',     'bKash Checkout API (Popup) Payment'),
        ('platform_connector', 'Platform Connector (Real Time Pull)'),
        # Nagad
        ('nagad_api',          'Nagad Direct Merchant API'),
        ('nagad_tokenized',    'Nagad Tokenized Payment'),
        # SSLCommerz
        ('ssl_standard',       'SSLCommerz Standard (Hosted)'),
        ('ssl_seamless',       'SSLCommerz Seamless Integration'),
        # aamarPay
        ('aamarpay_pgw',       'aamarPay Payment Gateway'),
        # shurjoPay
        ('shurjopay_pgw',      'shurjoPay Payment Gateway'),
        # Stripe
        ('stripe_checkout',    'Stripe Checkout'),
        ('stripe_elements',    'Stripe Elements'),
        # Razorpay
        ('razorpay_standard',  'Razorpay Standard Checkout'),
        # Generic
        ('pgw',                'Payment Gateway (Generic)'),
        ('api_integration',    'API Integration'),
        ('webhook_receiver',   'Webhook Receiver'),
    ]

    SANDBOX_LIVE_CHOICES = [
        ('sandbox', 'Sandbox'),
        ('live',    'Live'),
    ]

    gateway         = models.CharField(max_length=30, choices=GATEWAY_CHOICES, unique=True)
    gateway_type    = models.CharField(max_length=30, choices=GATEWAY_TYPE_CHOICES, default='platform_connector', blank=True)
    sandbox_live    = models.CharField(max_length=10, choices=SANDBOX_LIVE_CHOICES, default='sandbox', blank=True)
    app_key         = models.CharField(max_length=500, blank=True)          # X-APP-Key
    app_secret      = models.CharField(max_length=500, blank=True)          # Secret Key (Fernet encrypted)
    merchant_number = models.CharField(max_length=200, blank=True)
    username        = models.CharField(max_length=200, blank=True)
    password        = models.CharField(max_length=500, blank=True)          # Fernet encrypted
    is_active       = models.BooleanField(default=False)
    activation_date = models.DateField(null=True, blank=True)
    expiry_date     = models.DateField(null=True, blank=True)
    # applicable for — কোন পোর্টালে এই গেটওয়ে ব্যবহার হবে
    applicable_admin_portal    = models.BooleanField(default=False)
    applicable_pop_portal      = models.BooleanField(default=False)
    applicable_bandwidth_pop   = models.BooleanField(default=False)
    applicable_pop_client      = models.BooleanField(default=False)
    config      = models.JSONField(default=dict)   # অতিরিক্ত gateway-specific config
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'payment_gateway_configs'

    def __str__(self):
        return self.get_gateway_display()


class MobileAppConfig(models.Model):
    # Mobile App version control ও maintenance mode
    android_version     = models.CharField(max_length=20, default='1.0.0')
    ios_version         = models.CharField(max_length=20, default='1.0.0')
    min_android_version = models.CharField(max_length=20, default='1.0.0', help_text='এর চেয়ে পুরনো version force update পাবে')
    min_ios_version     = models.CharField(max_length=20, default='1.0.0', help_text='এর চেয়ে পুরনো version force update পাবে')
    store_url_android   = models.URLField(blank=True, help_text='Google Play Store URL')
    store_url_ios       = models.URLField(blank=True, help_text='Apple App Store URL')
    maintenance_mode    = models.BooleanField(default=False, help_text='True হলে app-এ maintenance বার্তা দেখাবে')
    maintenance_message = models.TextField(blank=True, default='সিস্টেম রক্ষণাবেক্ষণ চলছে। অনুগ্রহ করে কিছুক্ষণ পরে চেষ্টা করুন।')
    # Scrolling notice (ticker)
    ticker_notice       = models.TextField(blank=True, default='',
                            help_text='App-এর header-এর নিচে চলন্ত নোটিশ। খালি রাখলে দেখাবে না।')
    ticker_color        = models.CharField(max_length=10, blank=True, default='#1e3a8a',
                            help_text='Notice-এর text color (hex)')
    ticker_bg           = models.CharField(max_length=10, blank=True, default='#dbeafe',
                            help_text='Notice-এর background color (hex)')
    ticker_expires_at   = models.DateTimeField(null=True, blank=True,
                            help_text='এই সময়ের পর notice আর দেখাবে না। খালি রাখলে সবসময় দেখাবে।')
    # FTP ও Live TV
    ftp_servers         = models.JSONField(default=list, blank=True,
                            help_text='[{"name":"FTP Server 1","url":"ftp://...","icon":"🗄️"}]')
    live_tv_channels    = models.JSONField(default=list, blank=True,
                            help_text='[{"name":"Channel 1","url":"http://...","logo":""}]')
    updated_at          = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'mobile_app_config'

    def __str__(self):
        return f"Android {self.android_version} / iOS {self.ios_version}"

    @classmethod
    def get_config(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class AppBanner(models.Model):
    # Mobile App-এ দেখানো banner / notice
    title       = models.CharField(max_length=200)
    body        = models.TextField(blank=True)
    image       = models.ImageField(upload_to='app_banners/', null=True, blank=True)
    link_url    = models.URLField(blank=True, help_text='ব্যানারে ক্লিক করলে এই URL খুলবে')
    is_active   = models.BooleanField(default=True)
    priority    = models.IntegerField(default=0, help_text='বড় সংখ্যা = উপরে দেখাবে')
    expires_at  = models.DateTimeField(null=True, blank=True, help_text='এই সময়ের পর banner আর দেখাবে না')
    created_by  = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'app_banners'
        ordering = ['-priority', '-created_at']

    def __str__(self):
        return self.title


class AutomaticProcess(models.Model):
    # স্বয়ংক্রিয় প্রক্রিয়া সেটিংস (Celery task scheduling)
    PROCESS_TYPES = [
        ('auto_bill',          'Auto Bill Generation'),
        ('expire_disable',     'Expire & Disable Clients'),
        ('sms_due',            'Due SMS Send'),
        ('router_backup',      'Router Backup'),
        ('daily_close',        'Daily Account Closing'),
        ('radacct_aggregate',  'RADIUS Traffic Aggregate'),   # daily cron
        ('radacct_purge',      'RADIUS Session Purge'),       # daily cron
        ('olt_mac_sync',       'OLT MAC Table Sync'),         # interval 5m
        ('olt_link_onu',       'OLT ONU↔Client Link'),        # interval 15m
        ('voip_schedule',      'Voice Call Auto Scheduler'),  # daily cron, time configurable
        ('mikrotik_sync',      'MikroTik Active User Sync'),  # cron */5, toggle-only
    ]
    process_type = models.CharField(max_length=30, choices=PROCESS_TYPES, unique=True)
    is_enabled = models.BooleanField(default=True)
    schedule_cron = models.CharField(max_length=100, default='0 0 * * *')
    last_run = models.DateTimeField(null=True, blank=True)
    next_run = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'automatic_processes'
