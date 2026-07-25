# এই ফাইলটি ISP সিস্টেমের মূল কনফিগারেশন পরিচালনার জন্য: জোন, সাবজোন, বক্স, ক্লায়েন্ট টাইপ, প্রটোকল, প্যাকেজ।
from django.db import models


class Zone(models.Model):
    # নেটওয়ার্ক সার্ভিস এলাকার জোন
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'zones'

    def __str__(self):
        return self.name


class SubZone(models.Model):
    # জোনের অধীনে সাবজোন
    zone = models.ForeignKey(Zone, on_delete=models.CASCADE, related_name='subzones')
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'subzones'
        unique_together = ('zone', 'name')

    def __str__(self):
        return f"{self.zone.name} > {self.name}"


class Box(models.Model):
    # নেটওয়ার্ক বক্স/ডিস্ট্রিবিউশন পয়েন্ট
    subzone = models.ForeignKey(SubZone, on_delete=models.CASCADE, related_name='boxes')
    name = models.CharField(max_length=100)
    location = models.TextField(blank=True)
    latitude = models.DecimalField(max_digits=10, decimal_places=8, null=True, blank=True)
    longitude = models.DecimalField(max_digits=11, decimal_places=8, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'boxes'

    def __str__(self):
        return f"{self.subzone} > {self.name}"


class ClientType(models.Model):
    # ক্লায়েন্টের ধরন (Home, Office, Corporate, Student)
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    image = models.ImageField(upload_to='client_types/', null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'client_types'

    def __str__(self):
        return self.name


class ProtocolType(models.Model):
    # নেটওয়ার্ক প্রটোকল টাইপ (PPPoE, DHCP, Static)
    MIKROTIK_INTERFACE_CHOICES = [
        ('pppoe',   'PPPoE'),
        ('dhcp',    'DHCP'),
        ('static',  'Static IP'),
        ('hotspot', 'Hotspot'),
        ('other',   'Other'),
    ]

    name = models.CharField(max_length=50, unique=True)
    description = models.TextField(blank=True)
    mikrotik_interface_type = models.CharField(
        max_length=20,
        choices=MIKROTIK_INTERFACE_CHOICES,
        default='pppoe',
        verbose_name='Mikrotik Interface Type',
    )
    radius_enabled = models.BooleanField(
        default=True,
        verbose_name='RADIUS Authentication',
        help_text='PPPoE ও Hotspot-এ RADIUS প্রয়োজন; DHCP/Static-এ ঐচ্ছিক।',
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'protocol_types'

    def __str__(self):
        return self.name


class Package(models.Model):
    # ইন্টারনেট প্যাকেজ — নাম, স্পিড বিবরণ ও Mikrotik PPPoE profile লিংক।
    # Speed limit Mikrotik profile থেকে নিয়ন্ত্রণ হয়, এখানে শুধু তথ্য থাকে।
    BILLING_CYCLE_CHOICES = [
        ('monthly', 'Monthly'),
        ('quarterly', 'Quarterly'),
        ('half_yearly', 'Half Yearly'),
        ('yearly', 'Yearly'),
    ]

    name = models.CharField(max_length=100, unique=True, verbose_name='প্যাকেজ নাম')
    speed_name = models.CharField(max_length=100, blank=True, verbose_name='স্পিড বিবরণ',
                                   help_text='যেমন: 10 Mbps, 20M/10M, Unlimited')
    router = models.ForeignKey(
        'mikrotik_app.MikrotikServer', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='packages',
        verbose_name='MikroTik Router',
    )
    mikrotik_profile = models.CharField(max_length=100, blank=True, verbose_name='Mikrotik PPPoE Profile',
                                         help_text='Mikrotik-এর PPPoE profile নাম')
    ip_pool_name = models.CharField(max_length=100, blank=True, verbose_name='RADIUS IP Pool',
                                     help_text='Mikrotik IP pool নাম — RADIUS Framed-Pool এ ব্যবহার হবে। খালি রাখলে PPPoE Profile নাম ব্যবহার হবে।')
    price = models.DecimalField(max_digits=10, decimal_places=2, verbose_name='মূল্য')
    billing_cycle = models.CharField(max_length=20, choices=BILLING_CYCLE_CHOICES, default='monthly', verbose_name='বিলিং চক্র')
    description = models.TextField(blank=True, verbose_name='বিবরণ')
    is_free = models.BooleanField(
        default=False, verbose_name='ফ্রি প্যাকেজ (বিল নেই)',
        help_text='টিক দিলে এই package-এর client-দের কোনো মাসিক বিল generate হবে না। '
                  'Profile (speed) client-ভেদে আলাদা দেওয়া যাবে।')
    is_active = models.BooleanField(default=True, verbose_name='সক্রিয়')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'packages'

    def __str__(self):
        return f"{self.name} ({self.speed_name})" if self.speed_name else self.name


class District(models.Model):
    name = models.CharField(max_length=100, unique=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'districts'
        ordering = ['name']

    def __str__(self):
        return self.name


class Upazila(models.Model):
    district = models.ForeignKey(District, on_delete=models.CASCADE, related_name='upazilas')
    name = models.CharField(max_length=100)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'upazilas'
        unique_together = ('district', 'name')
        ordering = ['name']

    def __str__(self):
        return f"{self.district.name} > {self.name}"
