# এই ফাইলটি FreeRADIUS integration লগ, session ও সার্ভার কনফিগারেশন ম্যানেজমেন্টের জন্য।
# মূল radius tables (radcheck, radreply, radusergroup) সরাসরি MySQL-এ manage হয়।
from django.db import models


class RadiusLog(models.Model):
    # FreeRADIUS authentication ও accounting লগ
    ACTION_TYPES = [
        ('auth_accept', 'Auth Accept'), ('auth_reject', 'Auth Reject'),
        ('user_created', 'User Created'), ('user_deleted', 'User Deleted'),
        ('user_enabled', 'User Enabled'), ('user_disabled', 'User Disabled'),
        ('package_changed', 'Package Changed'), ('disconnect', 'Disconnect'),
    ]
    username = models.CharField(max_length=100)
    action = models.CharField(max_length=30, choices=ACTION_TYPES)
    details = models.TextField(blank=True)
    ip_address = models.CharField(max_length=50, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'radius_logs'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.username} - {self.action} at {self.created_at}"


class RadiusSession(models.Model):
    # বর্তমান active radius session তথ্য
    username = models.CharField(max_length=100)
    nas_ip = models.CharField(max_length=50, blank=True)
    framed_ip = models.CharField(max_length=50, blank=True)
    session_id = models.CharField(max_length=100, blank=True)
    start_time = models.DateTimeField(null=True, blank=True)
    bytes_in = models.BigIntegerField(default=0)
    bytes_out = models.BigIntegerField(default=0)
    is_online = models.BooleanField(default=True)
    last_updated = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'radius_sessions'


class RadiusServer(models.Model):
    # FreeRADIUS / RADIUS সার্ভারের কনফিগারেশন — একাধিক RADIUS সার্ভার সংরক্ষণের জন্য।
    # প্রতিটি সার্ভারে আলাদা MySQL database ও shared_secret থাকতে পারে।
    name = models.CharField(max_length=100, unique=True, verbose_name='সার্ভার নাম')
    server_type = models.CharField(
        max_length=20,
        choices=[('local', 'Local (এই সার্ভারে)'), ('remote', 'Remote (অন্য সার্ভারে)'), ('postgresql', 'PostgreSQL')],
        default='local',
    )
    # PostgreSQL connection settings
    db_host = models.CharField(max_length=100, default='localhost', verbose_name='DB Host')
    db_port = models.IntegerField(default=5432, verbose_name='DB Port')
    db_name = models.CharField(max_length=100, default='radius', verbose_name='Database নাম')
    db_user = models.CharField(max_length=100, default='radius', verbose_name='DB User')
    db_password = models.CharField(max_length=255, verbose_name='DB Password')

    # RADIUS NAS / Auth settings
    radius_host = models.CharField(max_length=100, default='localhost', verbose_name='RADIUS Host/IP')
    radius_auth_port = models.IntegerField(default=1812, verbose_name='Auth Port')
    radius_acct_port = models.IntegerField(default=1813, verbose_name='Accounting Port')
    # shared_secret DB-তে রাখা হচ্ছে, code/comment-এ কখনো লেখা যাবে না
    shared_secret = models.CharField(max_length=255, blank=True, verbose_name='Shared Secret')

    is_active = models.BooleanField(default=True, verbose_name='সক্রিয়')
    is_default = models.BooleanField(default=False, verbose_name='ডিফল্ট সার্ভার')
    last_tested = models.DateTimeField(null=True, blank=True, verbose_name='শেষ টেস্ট')
    last_test_status = models.CharField(
        max_length=20,
        choices=[('ok', 'সফল'), ('failed', 'ব্যর্থ'), ('unknown', 'অজানা')],
        default='unknown',
    )
    description = models.TextField(blank=True, verbose_name='বিবরণ')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'radius_servers'
        verbose_name = 'RADIUS Server'

    def __str__(self):
        return f"{self.name} ({self.radius_host})"

    def save(self, *args, **kwargs):
        # একই সময়ে একাধিক default থাকা যাবে না — এই server default হলে বাকি সবাইকে
        # non-default করে দেয়। (আগে দুটো server একসাথে is_default=True হয়ে যেত, যা
        # কোন server ব্যবহার হবে তা অস্পষ্ট করে তুলত।)
        super().save(*args, **kwargs)
        if self.is_default:
            RadiusServer.objects.filter(is_default=True).exclude(pk=self.pk).update(is_default=False)
