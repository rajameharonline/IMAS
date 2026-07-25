# এই ফাইলটি Mikrotik RouterOS সার্ভার ম্যানেজমেন্টের জন্য।
from django.db import models
from django.conf import settings


class MikrotikServer(models.Model):
    # Mikrotik Router এর তথ্য - RouterOS API দিয়ে সংযুক্ত হবে
    name = models.CharField(max_length=100, unique=True)
    host = models.CharField(max_length=100)
    port = models.IntegerField(default=8728)
    username = models.CharField(max_length=100)
    password = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)
    last_connected = models.DateTimeField(null=True, blank=True)
    description = models.TextField(blank=True)

    # RADIUS সার্ভার লিংক — কোন RADIUS সার্ভারে এই router authenticate করবে
    radius_server = models.ForeignKey(
        'radius_app.RadiusServer',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='mikrotik_servers',
        verbose_name='RADIUS সার্ভার',
    )
    # Router-এ RADIUS config push হয়েছে কিনা
    radius_configured = models.BooleanField(default=False, verbose_name='RADIUS কনফিগার হয়েছে')
    radius_configured_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'mikrotik_servers'

    def __str__(self):
        return f"{self.name} ({self.host})"


class RouterBackup(models.Model):
    # Mikrotik Router backup ফাইলের রেকর্ড
    server = models.ForeignKey(MikrotikServer, on_delete=models.CASCADE, related_name='backups')
    filename = models.CharField(max_length=255)
    file_path = models.CharField(max_length=500, blank=True)
    size_kb = models.IntegerField(default=0)
    backup_type = models.CharField(max_length=20, default='auto')  # auto or manual
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'router_backups'
        ordering = ['-created_at']


class ImportedClient(models.Model):
    # Mikrotik থেকে Import করা PPPoE user এর লগ
    server = models.ForeignKey(MikrotikServer, on_delete=models.CASCADE)
    username = models.CharField(max_length=100)
    service = models.CharField(max_length=50, blank=True)
    profile = models.CharField(max_length=100, blank=True)
    comment = models.TextField(blank=True)
    is_imported = models.BooleanField(default=False)
    imported_client = models.ForeignKey('clients.Client', on_delete=models.SET_NULL,
                                        null=True, blank=True)
    imported_at = models.DateTimeField(null=True, blank=True)
    raw_data = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'mikrotik_imported'
