# এই ফাইলটি ইনভেন্টরি ম্যানেজমেন্টের জন্য: ইউনিট, স্টোর, আইটেম, স্টক।
from django.db import models
from django.conf import settings


class Unit(models.Model):
    name = models.CharField(max_length=50, unique=True)
    symbol = models.CharField(max_length=10, blank=True)

    class Meta:
        db_table = 'inv_units'

    def __str__(self):
        return self.name


class StoreLocation(models.Model):
    # ISP স্টোর রুম — মালামাল যেখানে রাখা হয় (HQ গোডাউন, POP কেবিনেট ইত্যাদি)।
    # short_value: table-এ compact code দেখানোর জন্য (যেমন HQ, POP-1)।
    name = models.CharField(max_length=100, unique=True)
    short_value = models.CharField(max_length=50, blank=True)
    address = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'inv_stores'
        ordering = ['name']

    def __str__(self):
        return self.name


class ItemCategory(models.Model):
    # এই lookup table-টি bandwidth / inventory item group ধরে রাখে।
    # কেন `parent` রাখা হলো: Bandwidth, IP Transit, Fiber Lease-এর মতো
    # top-level group-এর নিচে sub-category রাখলে UI tree এবং রিপোর্টিং দুটোই
    # সহজ হয়, বিশেষ করে purchase bill বা stock breakdown-এর সময়।
    name = models.CharField(max_length=100, unique=True)
    parent = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='children',
    )
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'inv_item_categories'
        ordering = ['name']

    def __str__(self):
        return self.name


class Item(models.Model):
    # ISP হার্ডওয়্যার আইটেম — Router, ONU, Cable, Splitter ইত্যাদি।
    # item_type: Product (physical hardware) বা Service (installation/support)।
    # is_serialized: Router/ONU-এর মতো serial track করতে হয় এমন আইটেম।
    # approximate_rate: purchase order-এ default rate হিসেবে ব্যবহার হবে।
    ITEM_TYPE_CHOICES = [('product', 'Product'), ('service', 'Service')]

    code = models.CharField(max_length=50, unique=True)        # SKU / item code
    name = models.CharField(max_length=200)
    item_type = models.CharField(max_length=20, choices=ITEM_TYPE_CHOICES, default='product')
    is_serialized = models.BooleanField(default=False)
    category = models.ForeignKey(ItemCategory, on_delete=models.SET_NULL, null=True, blank=True)
    unit = models.ForeignKey(Unit, on_delete=models.SET_NULL, null=True, blank=True)
    minimum_stock = models.IntegerField(default=0)
    vat_percent = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    approximate_rate = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    income_account = models.ForeignKey(
        'accounting.ChartOfAccount',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='income_items',
    )
    expense_account = models.ForeignKey(
        'accounting.ChartOfAccount',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='expense_items',
    )
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'inv_items'
        ordering = ['name']

    def __str__(self):
        return f"{self.code} - {self.name}"

    @property
    def total_stock(self):
        from django.db.models import Sum
        agg = self.stocks.aggregate(total=Sum('quantity'))
        return agg['total'] or 0


class Stock(models.Model):
    # স্টক আবরণ - প্রতিটি store-এ প্রতিটি item-এর পরিমাণ
    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name='stocks')
    store = models.ForeignKey(StoreLocation, on_delete=models.CASCADE, related_name='stocks')
    quantity = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'inv_stocks'
        unique_together = ('item', 'store')


class StockTransaction(models.Model):
    # স্টক ইন/আউট ট্রানজেকশন রেকর্ড
    TRANS_TYPE = [
        ('in', 'Stock In'), ('out', 'Stock Out'),
        ('transfer', 'Transfer'), ('adjustment', 'Adjustment'),
    ]
    item = models.ForeignKey(Item, on_delete=models.CASCADE)
    store = models.ForeignKey(StoreLocation, on_delete=models.CASCADE)
    transaction_type = models.CharField(max_length=20, choices=TRANS_TYPE)
    quantity = models.DecimalField(max_digits=10, decimal_places=2)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    reference = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'inv_transactions'
