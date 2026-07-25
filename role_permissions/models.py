# role_permissions/models.py — Role Group ও Module Permission management
from django.db import models
from django.conf import settings


class RoleGroup(models.Model):
    """Custom role group — admin এই group তৈরি করে user-কে assign করে"""
    STATUS_CHOICES = [('active', 'Active'), ('inactive', 'Inactive')]

    name         = models.CharField(max_length=100, unique=True)
    status       = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    redirect_url = models.CharField(max_length=255, blank=True)
    is_default   = models.BooleanField(default=False)
    created_by   = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                     null=True, blank=True, related_name='created_roles')
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'role_groups'
        ordering = ['name']

    def __str__(self):
        return self.name


class RoleModulePermission(models.Model):
    """প্রতিটি role-এর জন্য module/sub-module access level"""
    ACCESS_CHOICES = [
        ('full',  'Full'),
        ('write', 'Write'),
        ('read',  'Read'),
    ]

    role           = models.ForeignKey(RoleGroup, on_delete=models.CASCADE,
                                       related_name='module_permissions')
    module_key     = models.CharField(max_length=100)
    sub_module_key = models.CharField(max_length=100, blank=True, default='')
    access_level   = models.CharField(max_length=10, choices=ACCESS_CHOICES, default='full')
    is_enabled     = models.BooleanField(default=True)

    class Meta:
        db_table = 'role_module_permissions'
        unique_together = [('role', 'module_key', 'sub_module_key')]

    def __str__(self):
        key = f"{self.module_key}.{self.sub_module_key}" if self.sub_module_key else self.module_key
        return f"{self.role.name} → {key} [{self.access_level}]"


class RoleGranularPermission(models.Model):
    """Fine-grained permission — sub-modal-এর checkbox। যেমন: billing_list → download_invoice"""
    role           = models.ForeignKey(RoleGroup, on_delete=models.CASCADE,
                                       related_name='granular_permissions')
    context_key    = models.CharField(max_length=100)
    permission_key = models.CharField(max_length=200)
    is_enabled     = models.BooleanField(default=True)

    class Meta:
        db_table = 'role_granular_permissions'
        unique_together = [('role', 'context_key', 'permission_key')]

    def __str__(self):
        return f"{self.role.name} → {self.context_key}.{self.permission_key}"


class UserRoleAssignment(models.Model):
    """User-কে একটি RoleGroup assign করে।
    enc_password: Fernet AES দিয়ে encrypt করা password — admin panel-এ decrypt করে দেখানো হয়।
    """
    user         = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                                        related_name='role_assignment')
    role_group   = models.ForeignKey(RoleGroup, on_delete=models.SET_NULL, null=True, blank=True,
                                     related_name='assigned_users')
    enc_password = models.TextField(blank=True)  # Fernet encrypted — never plaintext
    assigned_by  = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                     null=True, blank=True, related_name='role_assignments_given')
    assigned_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'user_role_assignments'

    def __str__(self):
        return f"{self.user.username} → {self.role_group.name if self.role_group else 'No Role'}"
