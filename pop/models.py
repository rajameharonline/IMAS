# POP ম্যানেজমেন্ট: MAC Reseller (POP), Tariff, Funding, PGW, Settlement, Notice
from django.db import models
from django.conf import settings
from django.utils import timezone
import uuid


def _receipt_no():
    return f'RCP-{timezone.now().strftime("%Y%m%d")}-{uuid.uuid4().hex[:6].upper()}'


def _invoice_no():
    return f'INV-{timezone.now().strftime("%Y%m%d")}-{uuid.uuid4().hex[:6].upper()}'


# ── POP Package & Tariff (Migration 2 — tables: isp_pop_packages, isp_pop_tariff_plans, isp_pop_tariff_items) ──

class POPPackage(models.Model):
    name         = models.CharField(max_length=100, unique=True)
    bandwidth_mb = models.IntegerField(verbose_name='Bandwidth Allocation MB (BTRC)')
    details      = models.TextField(blank=True, default='')
    created_at   = models.DateTimeField(auto_now_add=True)
    created_by   = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, related_name='pop_packages',
    )

    class Meta:
        db_table = 'pop_packages'
        ordering = ['name']

    def __str__(self):
        return self.name


class POPTariff(models.Model):
    TARIFF_TYPE_CHOICES = [('custom', 'Custom'), ('date_to_date', 'Date To Date')]
    tariff_type = models.CharField(max_length=20, choices=TARIFF_TYPE_CHOICES, default='custom')
    name        = models.CharField(max_length=100)
    created_at  = models.DateTimeField(auto_now_add=True)
    created_by  = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, related_name='pop_tariffs',
    )

    class Meta:
        db_table = 'pop_tariff_plans'
        ordering = ['-created_at']

    def __str__(self):
        return self.name


class POPTariffItem(models.Model):
    tariff              = models.ForeignKey(POPTariff, on_delete=models.CASCADE, related_name='items')
    package             = models.ForeignKey(POPPackage, on_delete=models.CASCADE, related_name='tariff_items')
    server              = models.ForeignKey(
        'mikrotik_app.MikrotikServer', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='pop_tariff_items',
    )
    rate                = models.DecimalField(max_digits=10, decimal_places=2)
    validity_days       = models.IntegerField(default=30)
    min_activation_days = models.IntegerField(default=1)

    class Meta:
        db_table = 'pop_tariff_items'
        ordering = ['id']


# ── POP Main Model (Migration 2 — table: isp_pops) ────────────────────────────

POP_MENU_KEYS = [
    'configuration', 'mikrotik_client', 'employee', 'client',
    'billing', 'monitoring', 'client_support', 'sms_service',
    'report', 'fund_history', 'tutorials',
]


class POP(models.Model):
    """ISP POP (Point of Presence) — রিসেলার / ডিস্ট্রিবিউটর অ্যাকাউন্ট।"""
    POP_TYPE_CHOICES = [('prepaid', 'Prepaid'), ('postpaid', 'Postpaid')]

    code                    = models.CharField(max_length=10, unique=True, verbose_name='POP Code')
    business_name           = models.CharField(max_length=200, verbose_name='POP/Business Name')
    contact_person          = models.CharField(max_length=100)
    email                   = models.EmailField()
    mobile                  = models.CharField(max_length=20)
    phone                   = models.CharField(max_length=20, blank=True, default='')
    national_id             = models.CharField(max_length=50, blank=True, default='')
    pop_prefix              = models.CharField(max_length=20, blank=True, default='')
    set_prefix_in_mikrotik  = models.BooleanField(default=False)
    pop_type                = models.CharField(max_length=20, choices=POP_TYPE_CHOICES, default='prepaid')
    min_rechargeable_amount = models.DecimalField(max_digits=10, decimal_places=2, default=5)
    address                 = models.TextField(blank=True, default='')
    logo                    = models.ImageField(upload_to='pop_logos/', null=True, blank=True)
    want_to_disable_clients = models.BooleanField(default=True)
    min_balance             = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    username                = models.CharField(max_length=100, unique=True)
    password                = models.CharField(max_length=255)
    menus                   = models.JSONField(default=list)
    is_active               = models.BooleanField(default=True)
    is_locked               = models.BooleanField(default=False)
    fund_start              = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    level                   = models.IntegerField(default=1)
    client_enabled          = models.BooleanField(default=True)
    restrict_online_payment = models.BooleanField(default=False)
    tariff                  = models.ForeignKey(
        POPTariff, on_delete=models.SET_NULL, null=True, blank=True, related_name='pops',
    )
    district                = models.ForeignKey(
        'configuration.District', on_delete=models.SET_NULL, null=True, blank=True,
    )
    upazila                 = models.ForeignKey(
        'configuration.Upazila', on_delete=models.SET_NULL, null=True, blank=True,
    )
    zone                    = models.ForeignKey(
        'configuration.Zone', on_delete=models.SET_NULL, null=True, blank=True,
    )
    created_by              = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, related_name='created_pops',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'pops'
        ordering = ['code']

    def __str__(self):
        return f'{self.code} - {self.business_name}'

    def save(self, *args, **kwargs):
        # প্রথমবার save-এ code auto-generate
        if not self.code:
            last = POP.objects.order_by('-id').first()
            next_num = (last.id + 1) if last else 1
            self.code = str(next_num).zfill(4)
        super().save(*args, **kwargs)


class POPFund(models.Model):
    """POP সরল ফান্ড রেকর্ড (Migration 2 — table: isp_pop_funds)।"""
    FUND_TYPE_CHOICES = [('add', 'Add Fund'), ('deduct', 'Deduct')]

    pop       = models.ForeignKey(POP, on_delete=models.CASCADE, related_name='funds')
    amount    = models.DecimalField(max_digits=12, decimal_places=2)
    fund_type = models.CharField(max_length=10, choices=FUND_TYPE_CHOICES, default='add')
    purpose   = models.CharField(max_length=200)
    date      = models.DateField()
    notes     = models.TextField(blank=True, default='')
    funded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, related_name='pop_funds',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'pop_funds'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.pop.code} — {self.fund_type} {self.amount}'


# ── Legacy NetworkPOP-ভিত্তিক Tariff (পুরনো, অপরিবর্তিত) ───────────────────

class POPTariffConfig(models.Model):
    pop       = models.ForeignKey('network.NetworkPOP', on_delete=models.CASCADE, related_name='tariffs')
    package   = models.ForeignKey('configuration.Package', on_delete=models.CASCADE)
    price     = models.DecimalField(max_digits=10, decimal_places=2)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'pop_tariffs'
        unique_together = ('pop', 'package')


# ── POP Funding (বিস্তারিত — Migration 3 — table: isp_pop_fundings) ──────────

class POPFunding(models.Model):
    TRANS_STATUS_CHOICES = [
        ('pending', 'Pending'), ('partial', 'Partial'),
        ('completed', 'Completed'), ('cancelled', 'Cancelled'),
    ]
    PAYMENT_METHOD = [
        ('cash', 'Cash'), ('bank', 'Bank Transfer'),
        ('bkash', 'bKash'), ('nagad', 'Nagad'),
        ('rocket', 'Rocket'), ('cheque', 'Cheque'),
        ('online', 'Online'), ('other', 'Other'),
    ]

    pop              = models.ForeignKey(POP, on_delete=models.CASCADE, related_name='fundings')
    invoice_number   = models.CharField(max_length=50, unique=True, default=_invoice_no)
    fund_amount      = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    received_amount  = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    p_processing_fee = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    vat              = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    discount         = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    due_amount       = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    funding_date     = models.DateField(default=timezone.localdate)
    fund_given_by    = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='pop_fundings_given',
    )
    received_date = models.DateField(null=True, blank=True)
    received_by   = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='pop_fundings_received',
    )
    payment_by              = models.CharField(max_length=20, choices=PAYMENT_METHOD, blank=True)
    remarks                 = models.TextField(blank=True)
    trans_status            = models.CharField(max_length=20, choices=TRANS_STATUS_CHOICES, default='pending')
    restrict_online_payment = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'pop_fundings'
        indexes = [
            models.Index(fields=['pop']),
            models.Index(fields=['trans_status']),
            models.Index(fields=['funding_date']),
        ]
        ordering = ['-funding_date', '-id']

    def save(self, *args, **kwargs):
        self.due_amount = (
            self.fund_amount + self.p_processing_fee + self.vat
            - self.discount - self.received_amount
        )
        super().save(*args, **kwargs)


class POPFundTransaction(models.Model):
    TRANS_TYPE_CHOICES = [
        ('fund', 'Fund (+)'), ('payment', 'Payment'),
        ('refund', 'Refund (-)'), ('adjustment', 'Adjustment'),
    ]

    funding          = models.ForeignKey(POPFunding, on_delete=models.CASCADE, related_name='transactions')
    receipt_number   = models.CharField(max_length=50, unique=True, default=_receipt_no)
    trans_type       = models.CharField(max_length=20, choices=TRANS_TYPE_CHOICES, default='payment')
    fund_amount      = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    refund_amount    = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    paid_amount      = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    p_processing_fee = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    vat              = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    discount         = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    due              = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    remarks          = models.TextField(blank=True)
    received_on      = models.DateField(default=timezone.localdate)
    received_by      = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='pop_trans_received',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='pop_trans_created',
    )

    class Meta:
        db_table = 'pop_fund_transactions'
        indexes = [
            models.Index(fields=['funding']),
            models.Index(fields=['trans_type']),
            models.Index(fields=['received_on']),
        ]
        ordering = ['-received_on', '-id']


class ClientPGWPayment(models.Model):
    STATUS_CHOICES = [
        ('pending', 'Pending'), ('success', 'Success'),
        ('failed', 'Failed'), ('cancelled', 'Cancelled'),
    ]

    pop              = models.ForeignKey(
        POP, on_delete=models.SET_NULL, null=True, blank=True, related_name='pgw_payments',
    )
    client           = models.ForeignKey('clients.Client', on_delete=models.CASCADE, related_name='pgw_payments')
    bill             = models.ForeignKey('billing.Bill', on_delete=models.SET_NULL, null=True, blank=True)
    gateway_name     = models.CharField(max_length=50)
    gateway_type     = models.CharField(max_length=50, blank=True)
    amount           = models.DecimalField(max_digits=10, decimal_places=2)
    transaction_id   = models.CharField(max_length=200, blank=True)
    money_receipt_no = models.CharField(max_length=100, blank=True)
    status           = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    gateway_response = models.JSONField(default=dict)
    processing_fee   = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    received_by      = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='pgw_payments_received',
    )
    received_date = models.DateField(null=True, blank=True)
    initiated_at  = models.DateTimeField(auto_now_add=True)
    completed_at  = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'pgw_payments'
        indexes = [
            models.Index(fields=['pop']),
            models.Index(fields=['status']),
            models.Index(fields=['initiated_at']),
        ]
        ordering = ['-initiated_at']


class POPPGWSettlement(models.Model):
    STATUS_CHOICES = [
        ('pending', 'Pending'), ('settled', 'Settled'), ('partial', 'Partial'),
    ]

    pop            = models.ForeignKey(POP, on_delete=models.CASCADE, related_name='pgw_settlements')
    amount         = models.DecimalField(max_digits=12, decimal_places=2)
    invoice_number = models.CharField(max_length=100, blank=True, default=_invoice_no)
    remarks        = models.TextField(blank=True)
    status         = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    created_by     = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='pgw_settlements_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'pop_pgw_settlements'
        indexes = [
            models.Index(fields=['pop']),
            models.Index(fields=['status']),
            models.Index(fields=['created_at']),
        ]
        ordering = ['-created_at']


class POPNotice(models.Model):
    STATUS_CHOICES = [('enable', 'Enable'), ('disable', 'Disable')]

    pop        = models.ForeignKey(
        POP, on_delete=models.SET_NULL, null=True, blank=True, related_name='notices',
    )
    title      = models.CharField(max_length=300)
    details    = models.TextField()
    start_date = models.DateField(null=True, blank=True)
    end_date   = models.DateField(null=True, blank=True)
    status     = models.CharField(max_length=10, choices=STATUS_CHOICES, default='enable')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='pop_notices_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'pop_notices'
        indexes = [
            models.Index(fields=['pop']),
            models.Index(fields=['status']),
        ]
        ordering = ['-created_at']


# ─────────────────────────────────────────────────────────────────────────────
# POP Change Log — POP তথ্য update হলে snapshot রাখা হয়
# ─────────────────────────────────────────────────────────────────────────────

class POPChangeLog(models.Model):
    pop                  = models.ForeignKey(POP, on_delete=models.CASCADE, related_name='change_logs')
    business_name        = models.CharField(max_length=200, blank=True, default='')
    tariff_name           = models.CharField(max_length=100, blank=True, default='')
    mobile                = models.CharField(max_length=20, blank=True, default='')
    zone_name             = models.CharField(max_length=100, blank=True, default='')
    upazila_name          = models.CharField(max_length=100, blank=True, default='')
    district_name         = models.CharField(max_length=100, blank=True, default='')
    pop_prefix             = models.CharField(max_length=20, blank=True, default='')
    client_will_be_disabled = models.BooleanField(default=False)
    fund_start_on         = models.BooleanField(default=False)
    min_rechargeable_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    set_prefix_in_mikrotik  = models.BooleanField(default=False)
    restrict_online_payment = models.BooleanField(default=False)
    remarks                = models.TextField(blank=True, default='')
    changed_by             = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='pop_change_logs',
    )
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'pop_change_logs'
        indexes  = [models.Index(fields=['pop']), models.Index(fields=['changed_at'])]
        ordering = ['-changed_at']


# ─────────────────────────────────────────────────────────────────────────────
# POP Fund Start Log — fund_start (client auto-disable feature) on/off ইতিহাস
# ─────────────────────────────────────────────────────────────────────────────

class POPFundStartLog(models.Model):
    pop            = models.ForeignKey(POP, on_delete=models.CASCADE, related_name='fund_start_logs')
    is_enabled     = models.BooleanField(default=False)
    effective_from = models.DateField(null=True, blank=True)
    effective_to   = models.DateField(null=True, blank=True)
    activated_days = models.IntegerField(default=0)
    changed_by     = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='pop_fund_start_logs',
    )
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'pop_fund_start_logs'
        indexes  = [models.Index(fields=['pop']), models.Index(fields=['changed_at'])]
        ordering = ['-changed_at']


# ─────────────────────────────────────────────────────────────────────────────
# Client Recharge Log — POP-এর আন্ডারে client recharge/renewal ইতিহাস
# (Credited Transactions ও Recharge Transactions ট্যাব এখান থেকেই আসে)
# ─────────────────────────────────────────────────────────────────────────────

class ClientRechargeLog(models.Model):
    TRANS_TYPE_CHOICES = [
        ('recharge', 'Recharge'), ('renewal', 'Renewal'),
        ('package_change', 'Package Change'), ('bonus', 'Bonus'), ('revert', 'Revert'),
    ]

    pop             = models.ForeignKey(POP, on_delete=models.CASCADE, related_name='recharge_logs')
    client          = models.ForeignKey('clients.Client', on_delete=models.CASCADE, related_name='pop_recharge_logs')
    package         = models.ForeignKey('configuration.Package', on_delete=models.SET_NULL, null=True, blank=True)
    daily_rate      = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    r_from_date     = models.DateField(null=True, blank=True)
    r_to_date       = models.DateField(null=True, blank=True)
    days            = models.IntegerField(default=0)
    credited_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    trans_type      = models.CharField(max_length=20, choices=TRANS_TYPE_CHOICES, default='recharge')
    remarks         = models.CharField(max_length=255, blank=True, default='')
    credited_on     = models.DateTimeField(auto_now_add=True)
    credited_by     = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='pop_recharge_credited',
    )

    class Meta:
        db_table = 'pop_client_recharge_logs'
        indexes  = [
            models.Index(fields=['pop']),
            models.Index(fields=['client']),
            models.Index(fields=['credited_on']),
        ]
        ordering = ['-credited_on']
