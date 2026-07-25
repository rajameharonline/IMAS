# এই ফাইলটি ISP ক্লায়েন্ট/গ্রাহক ম্যানেজমেন্টের জন্য।
from decimal import Decimal
from django.db import models
from django.conf import settings
from configuration.models import Zone, SubZone, Box, ClientType, ProtocolType, Package


class Client(models.Model):
    STATUS_CHOICES = [
        ('active', 'Active'), ('inactive', 'Inactive'),
        ('suspended', 'Suspended'), ('expired', 'Expired'),
        ('cancelled', 'Cancelled'), ('left', 'Left'),
    ]
    customer_id = models.CharField(max_length=50, unique=True)
    full_name = models.CharField(max_length=200)
    father_name = models.CharField(max_length=200, blank=True, default='')
    phone = models.CharField(max_length=20)
    alt_phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    nid = models.CharField(max_length=50, blank=True)
    area = models.CharField(max_length=200, blank=True, default='', help_text='এলাকা/লোকেশন (user-editable)')
    house_name = models.CharField(max_length=200, blank=True, default='', help_text='বাড়ির নাম')
    address = models.TextField(blank=True)
    zone = models.ForeignKey(Zone, on_delete=models.SET_NULL, null=True, related_name='clients')
    subzone = models.ForeignKey(SubZone, on_delete=models.SET_NULL, null=True, related_name='clients')
    box = models.ForeignKey(Box, on_delete=models.SET_NULL, null=True, blank=True, related_name='clients')
    client_type = models.ForeignKey(ClientType, on_delete=models.SET_NULL, null=True)
    protocol = models.ForeignKey(ProtocolType, on_delete=models.SET_NULL, null=True)
    package = models.ForeignKey(Package, on_delete=models.SET_NULL, null=True, related_name='clients')
    # PPPoE username - FreeRADIUS authentication-এ ব্যবহার হয়
    username = models.CharField(max_length=100, unique=True)
    password = models.CharField(max_length=100)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    mac_address = models.CharField(max_length=20, blank=True)
    router = models.ForeignKey('mikrotik_app.MikrotikServer', on_delete=models.SET_NULL,
                               null=True, blank=True, related_name='clients')
    pppoe_profile = models.CharField(max_length=100, blank=True, verbose_name='PPPoE Profile')
    bill_date = models.IntegerField(default=1)
    expiry_day = models.IntegerField(null=True, blank=True)  # প্রতিমাসে কত তারিখে expire হবে (1-30)
    billing_start_month = models.CharField(
        max_length=7, blank=True,
        help_text='বিলিং শুরুর মাস — YYYY-MM format (e.g., 2025-06)'
    )
    connection_date = models.DateField(null=True, blank=True)
    expiry_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    monthly_bill = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0'))
    discount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0'))
    due_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0'))
    advance_balance = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0'))  # অতিরিক্ত পেমেন্ট ব্যালেন্স
    photo        = models.ImageField(upload_to='clients/photos/',   blank=True, null=True)
    nid_photo    = models.ImageField(upload_to='clients/nid/',      blank=True, null=True)
    reg_form_pic = models.ImageField(upload_to='clients/reg_forms/', blank=True, null=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                   null=True, related_name='created_clients')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    notes  = models.TextField(blank=True)
    map_lat = models.DecimalField(max_digits=10, decimal_places=6, null=True, blank=True, verbose_name='Map Latitude')
    map_lng = models.DecimalField(max_digits=10, decimal_places=6, null=True, blank=True, verbose_name='Map Longitude')
    is_vip = models.BooleanField(default=False, verbose_name='VIP Client')  # VIP ক্লায়েন্ট flag
    # Left list থেকে ফিরে আসা ক্লায়েন্ট ট্র্যাকিং
    is_renewed  = models.BooleanField(default=False, db_index=True,
                                      help_text='True = Left list থেকে restore করা হয়েছে')
    renewed_at  = models.DateTimeField(null=True, blank=True,
                                       help_text='কখন restore করা হয়েছে')
    # Mobile App fields
    fcm_token    = models.CharField(max_length=300, blank=True, default='',
                                    help_text='Firebase Cloud Messaging token (Android/iOS)')
    app_enabled  = models.BooleanField(default=True, help_text='Client mobile app access allow/block')
    app_last_seen = models.DateTimeField(null=True, blank=True, help_text='সর্বশেষ app login সময়')
    # App login password — PPPoE/RADIUS password (উপরের `password`) থেকে সম্পূর্ণ আলাদা।
    # hashed আকারে রাখা হয় (Django make_password)। App login = customer_id + এই password।
    app_password = models.CharField(max_length=128, blank=True, default='',
                                    help_text='App login password (hashed) — PPPoE password নয়')
    app_registered_on = models.DateTimeField(null=True, blank=True,
                                             help_text='App user হিসেবে register করার সময়')

    # ── Network & Product Information (Customer Search প্রোফাইল ট্যাবে দেখায়/edit হয়) ──
    # আগে এই field-গুলো শুধু UI-তে ছিল, কোথাও persist হত না — তাই সবসময় ফাঁকা দেখাত।
    # latitude/longitude = উপরের map_lat/map_lng (আলাদা field নয়)।
    device              = models.CharField(max_length=150, blank=True, default='', help_text='ONU/Router device নাম/মডেল')
    package_no          = models.CharField(max_length=100, blank=True, default='', help_text='Package/box নম্বর')
    optical_fiber       = models.CharField(max_length=100, blank=True, default='', help_text='Optical fiber তথ্য')
    cable_meter         = models.CharField(max_length=50,  blank=True, default='', help_text='প্রয়োজনীয় cable (মিটার)')
    vendor              = models.CharField(max_length=120, blank=True, default='', help_text='Device vendor/brand')
    serial_no           = models.CharField(max_length=120, blank=True, default='', help_text='Device serial number')
    fiber_code          = models.CharField(max_length=60,  blank=True, default='', help_text='Fiber code')
    color_of_cord       = models.CharField(max_length=60,  blank=True, default='', help_text='Cord/core color')
    device_purchase_date = models.DateField(null=True, blank=True, help_text='Device কেনার তারিখ')

    # Remote Management — ONU/Router-এর remote access তথ্য (manually টাইপ করা হয়)
    remote_mgmt_ip      = models.CharField(max_length=200, blank=True, default='', help_text='Remote Management IP/URL (যেমন http://10.5.15.208:8810)')
    remote_admin_user   = models.CharField(max_length=120, blank=True, default='', help_text='Remote management admin username')
    remote_admin_pass   = models.CharField(max_length=120, blank=True, default='', help_text='Remote management admin password')

    # ── POP (MAC Reseller) সম্পর্ক — client কোন POP-এর আন্ডারে রিচার্জ/ম্যানেজ হয় ──
    pop          = models.ForeignKey('pop.POP', on_delete=models.SET_NULL, null=True, blank=True, related_name='clients')
    pop_exported = models.BooleanField(default=False, help_text='POP-এর আন্ডারে client export হয়েছে কিনা')

    class Meta:
        db_table = 'clients'
        ordering = ['-created_at']
        indexes = [
            # সবচেয়ে বেশি search/filter হয় এই fields-এ
            models.Index(fields=['phone'],        name='idx_client_phone'),
            models.Index(fields=['status'],       name='idx_client_status'),
            models.Index(fields=['expiry_date'],  name='idx_client_expiry'),
            models.Index(fields=['full_name'],    name='idx_client_name'),
            # billing automation-এ প্রতিদিন এই query চলে
            models.Index(fields=['status', 'expiry_date'], name='idx_client_status_expiry'),
            models.Index(fields=['status', 'router_id'],   name='idx_client_status_router'),
            # app login query
            models.Index(fields=['app_enabled', 'status'], name='idx_client_app_status'),
            models.Index(fields=['pop', 'pop_exported'], name='idx_client_pop_exported'),
        ]

    def __str__(self):
        return f"{self.customer_id} - {self.full_name}"

    # ─── App login password helpers ─────────────────────────────────────────
    def set_app_password(self, raw_password):
        # raw password hash করে সংরক্ষণ
        from django.contrib.auth.hashers import make_password
        self.app_password = make_password(raw_password)

    def check_app_password(self, raw_password):
        # raw password hash-এর সাথে মেলে কিনা
        from django.contrib.auth.hashers import check_password
        if not self.app_password:
            return False
        return check_password(raw_password, self.app_password)

    @property
    def is_app_user(self):
        # app_password সেট থাকলে = registered app user
        return bool(self.app_password)


class MacVendor(models.Model):
    """MAC OUI → device brand/vendor cache।

    প্রতিটি OUI (MAC-এর প্রথম ৩ বাইট) একবার macvendors.com থেকে এনে এখানে জমা
    থাকে, যাতে পরের বার থেকে external API ছাড়াই (offline) brand দেখানো যায়।
    [[clients/mac_vendor.py]] এই table ব্যবহার করে।
    """
    oui = models.CharField(max_length=6, unique=True, db_index=True,
                           help_text="MAC-এর প্রথম ৩ বাইট, uppercase hex (e.g. '44A56E')")
    vendor = models.CharField(max_length=120, blank=True, help_text='Device brand/manufacturer')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'mac_vendors'
        verbose_name = 'MAC Vendor'

    def __str__(self):
        return f"{self.oui} → {self.vendor or '?'}"


class LeftClient(models.Model):
    RECOVERY_STATUS_CHOICES = [
        ('pending',   'Pending'),
        ('partial',   'Partial'),
        ('recovered', 'Recovered'),
    ]
    # সংযোগ ছেড়ে দেওয়া ক্লায়েন্টের তথ্য
    client = models.OneToOneField(Client, on_delete=models.CASCADE, related_name='left_info')
    left_date = models.DateField()
    reason = models.TextField(blank=True)
    equipment_returned = models.BooleanField(default=False)
    balance_settled = models.BooleanField(default=False)
    final_due = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0'))
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='left_clients_created')
    created_at = models.DateTimeField(auto_now_add=True)
    # Recovery information
    cable_recovered  = models.BooleanField(default=False)
    device_recovered = models.BooleanField(default=False)
    recovery_status  = models.CharField(max_length=20, choices=RECOVERY_STATUS_CHOICES, default='pending')
    recovered_by     = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='left_clients_recovered')
    recovery_notes   = models.TextField(blank=True)

    class Meta:
        db_table = 'left_clients'


class ChangeRequest(models.Model):
    # ক্লায়েন্টের প্যাকেজ বা তথ্য পরিবর্তনের রিকোয়েস্ট
    STATUS_CHOICES = [('pending', 'Pending'), ('approved', 'Approved'), ('rejected', 'Rejected')]
    REQUEST_TYPE_CHOICES = [
        ('package_change', 'Package Change'), ('address_change', 'Address Change'),
        ('router_change', 'Router Change'), ('other', 'Other'),
    ]
    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name='change_requests')
    request_type = models.CharField(max_length=30, choices=REQUEST_TYPE_CHOICES)
    old_value = models.TextField(blank=True)
    new_value = models.TextField(blank=True)
    reason = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                     null=True, related_name='change_requests_made')
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                    null=True, blank=True, related_name='change_requests_approved')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'change_requests'


class ClientScheduler(models.Model):
    # ক্লায়েন্টের সংযোগ enable/disable/package-change শিডিউল
    ACTION_CHOICES = [
        ('enable', 'Enable'), ('disable', 'Disable'), ('change_package', 'Change Package'),
    ]
    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name='schedules')
    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    scheduled_at = models.DateTimeField()
    new_package = models.ForeignKey(Package, on_delete=models.SET_NULL, null=True, blank=True)
    is_executed = models.BooleanField(default=False)
    executed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'client_schedulers'


class ClientChangeLog(models.Model):
    # ক্লায়েন্টের যেকোনো তথ্য পরিবর্তনের সময় একটি snapshot রেকর্ড হয়
    client          = models.ForeignKey(Client, on_delete=models.CASCADE, related_name='change_logs')
    customer_id     = models.CharField(max_length=50, blank=True)
    username        = models.CharField(max_length=100, blank=True)
    password        = models.CharField(max_length=100, blank=True)
    full_name       = models.CharField(max_length=200, blank=True)
    phone           = models.CharField(max_length=20, blank=True)
    service         = models.CharField(max_length=100, blank=True)
    remarks         = models.TextField(blank=True)
    billing_status  = models.CharField(max_length=20, blank=True)
    mikrotik_status = models.BooleanField(default=True)
    server          = models.CharField(max_length=100, blank=True)
    speed           = models.CharField(max_length=100, blank=True)
    package         = models.CharField(max_length=100, blank=True)
    protocol        = models.CharField(max_length=50, blank=True)
    conn_type       = models.CharField(max_length=50, blank=True)
    client_type     = models.CharField(max_length=100, blank=True)
    monthly_bill    = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0'))
    expiry_date     = models.DateField(null=True, blank=True)
    zone            = models.CharField(max_length=100, blank=True)
    changed_by      = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                        null=True, related_name='client_change_logs')
    changed_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'client_change_logs'
        ordering = ['-changed_at']

    def __str__(self):
        # local snapshot field ব্যবহার — FK dereference/extra query এড়ায় (creation-এ সবসময় সেট হয়)
        return f"Change: {self.customer_id} @ {self.changed_at:%Y-%m-%d %H:%M}"


class ClientStatusLog(models.Model):
    # ক্লায়েন্ট enable/disable হলে এই log তৈরি হয়
    client          = models.ForeignKey(Client, on_delete=models.CASCADE, related_name='status_logs')
    customer_id     = models.CharField(max_length=50, blank=True)
    username        = models.CharField(max_length=100, blank=True)
    password        = models.CharField(max_length=100, blank=True)
    full_name       = models.CharField(max_length=200, blank=True)
    phone           = models.CharField(max_length=20, blank=True)
    remarks         = models.TextField(blank=True)
    mikrotik_status = models.BooleanField(default=True)
    changed_by      = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                        null=True, related_name='client_status_logs')
    changed_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'client_status_logs'
        ordering = ['-changed_at']

    def __str__(self):
        # local snapshot field ব্যবহার — FK dereference/extra query এড়ায় (creation-এ সবসময় সেট হয়)
        return f"Status: {self.customer_id} @ {self.changed_at:%Y-%m-%d %H:%M}"


class ClientActivityLog(models.Model):
    # সব automated ও manual event-এর একক unified log
    EVENT_TYPES = [
        ('bill_generated',   'Bill Generated'),
        ('bill_updated',     'Bill Updated'),
        ('bill_deleted',     'Bill Deleted'),
        ('payment_received', 'Payment Received'),
        ('payment_deleted',  'Payment Deleted'),
        ('payment_approved', 'Payment Approved'),   # collector payment admin approve করলে
        ('client_disabled',  'Client Disabled'),
        ('client_enabled',   'Client Enabled'),
        ('status_changed',   'Status Changed'),
        ('expiry_extended',  'Expiry Extended'),
        ('package_changed',  'Package Changed'),
        ('profile_updated',  'Profile Updated'),
        ('sms_sent',         'SMS Sent'),
        ('radius_action',    'RADIUS Action'),
        ('mikrotik_action',  'Mikrotik Action'),
        ('other',            'Other'),
    ]
    client            = models.ForeignKey(Client, on_delete=models.CASCADE, related_name='activity_logs')
    event_type        = models.CharField(max_length=30, choices=EVENT_TYPES)
    title             = models.CharField(max_length=200)
    description       = models.TextField(blank=True)
    amount            = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    performed_by      = models.CharField(max_length=100, default='System')
    performed_by_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                          null=True, blank=True, related_name='client_activity_logs')
    created_at        = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'client_activity_logs'
        ordering = ['-created_at']

    def __str__(self):
        # self.client হলো Client FK — customer_id runtime-এ থাকে (Pylint ORM বোঝে না)
        return f"[{self.event_type}] {self.client.customer_id} @ {self.created_at:%Y-%m-%d %H:%M}"  # pylint: disable=no-member


class ClientMonthlyTraffic(models.Model):
    # প্রতিটি client-এর মাসিক traffic summary — radacct থেকে daily aggregate করে এখানে জমা হয়।
    # radacct purge হওয়ার আগেই data এখানে সংরক্ষিত হয়, তাই history চিরস্থায়ী থাকে।
    client         = models.ForeignKey(Client, on_delete=models.CASCADE, related_name='monthly_traffic')
    year_month     = models.CharField(max_length=7)          # '2026-06' format
    bytes_in       = models.BigIntegerField(default=0)        # মোট download bytes
    bytes_out      = models.BigIntegerField(default=0)        # মোট upload bytes
    sessions       = models.IntegerField(default=0)           # session সংখ্যা
    online_seconds = models.BigIntegerField(default=0)        # মোট online সময় (সেকেন্ড)
    updated_at     = models.DateTimeField(auto_now=True)      # শেষ aggregate কখন

    class Meta:
        db_table = 'client_monthly_traffic'
        unique_together = ('client', 'year_month')
        ordering        = ['-year_month']
        indexes         = [models.Index(fields=['client', 'year_month'], name='clients_cmt_client_month_idx')]

    def __str__(self):
        return f"{self.client.username} — {self.year_month}"


