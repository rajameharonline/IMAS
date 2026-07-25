# এই ফাইলটি সম্পদ (Assets) ম্যানেজমেন্টের জন্য।
from django.db import models
from django.conf import settings


class Asset(models.Model):
    # কোম্পানির সম্পদ/আসবাবপত্র/যন্ত্রপাতির তালিকা
    STATUS_CHOICES = [
        ('active', 'Active'), ('under_repair', 'Under Repair'),
        ('disposed', 'Disposed'), ('lost', 'Lost'),
    ]
    asset_code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=200)
    category = models.ForeignKey('inventory.ItemCategory', on_delete=models.SET_NULL, null=True)
    purchase_date = models.DateField(null=True, blank=True)
    purchase_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    current_value = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    location = models.CharField(max_length=200, blank=True)
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                    null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    description = models.TextField(blank=True)
    photo = models.ImageField(upload_to='assets/', blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'assets'

    def __str__(self):
        return f"{self.asset_code} - {self.name}"


class DestroyedItem(models.Model):
    # নষ্ট/ধ্বংসকৃত সম্পদের রেকর্ড
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, null=True, blank=True)
    item = models.ForeignKey('inventory.Item', on_delete=models.CASCADE, null=True, blank=True)
    quantity = models.DecimalField(max_digits=10, decimal_places=2, default=1)
    destruction_date = models.DateField()
    reason = models.TextField(blank=True)
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                    null=True, related_name='approved_destructions')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'destroyed_items'
