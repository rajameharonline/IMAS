# এই ফাইলটি দুই ধরনের purchase flow সামলায়:
# 1) ISP hardware/equipment purchase flow (Vendor → Requisition → Order → Bill)
# 2) Bandwidth provider bill flow (Provider → ProviderBill → ProviderBillPayment)
#
# কেন আলাদা রাখছি: hardware purchase আর bandwidth provider payment দুটো
# ভিন্ন operational চাহিদা পূরণ করে। hardware-এ serial tracking, store room,
# VAT per item লাগে। bandwidth-এ provider invoice, monthly billing cycle লাগে।
from django.db import models
from django.conf import settings
from django.db import transaction
from decimal import Decimal


# ─── ISP Hardware/Equipment Purchase Flow ───────────────────────────────────


# পুনরাবৃত্ত literal — S1192 এড়াতে module constant
_ITEM_MODEL = 'inventory.Item'

class Vendor(models.Model):
    # ISP hardware vendor master: Router/ONU/Cable supplier কোম্পানির তথ্য।
    # কেন logo এবং contact_person: vendor list page-এ screenshot-এর মতো
    # company card দেখানো দরকার; শুধু নাম-ফোন যথেষ্ট নয়।
    name = models.CharField(max_length=200)           # Company Name
    contact_person = models.CharField(max_length=200, blank=True)
    phone = models.CharField(max_length=20, blank=True)        # পুরোনো field, backward compat
    phone_number = models.CharField(max_length=30, blank=True) # নতুন canonical field
    mobile_number = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    facebook_url = models.URLField(blank=True)
    skype_id = models.CharField(max_length=120, blank=True)
    website = models.URLField(blank=True)
    address = models.TextField(blank=True)
    logo = models.ImageField(upload_to='vendors/', blank=True, null=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'vendors'
        ordering = ['name']

    def __str__(self):
        return self.name

    @property
    def balance_due(self):
        # Vendor-এর outstanding purchase bill due সহজে দেখানোর জন্য।
        agg = self.orders.aggregate(
            total=models.Sum('bills__due_amount')
        )
        return agg['total'] or Decimal('0.00')


class PurchaseRequisition(models.Model):
    # ক্রয় রিকুইজিশন header — multi-item support।
    # কেন item nullable করা হলো: পুরোনো single-item flow backward compat রাখতে,
    # কিন্তু নতুন req_items (PurchaseRequisitionItem) multi-line support দেবে।
    STATUS_CHOICES = [
        ('pending', 'Pending'), ('approved', 'Approved'),
        ('rejected', 'Rejected'), ('purchased', 'Purchased'),
    ]
    requisition_no = models.CharField(max_length=50, unique=True)
    requisition_date = models.DateField(null=True, blank=True)
    item = models.ForeignKey(
        _ITEM_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True,
    )
    quantity = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    required_by = models.DateField(null=True, blank=True)   # "need by date"
    purpose = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, related_name='requisitions_made',
    )
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='requisitions_approved',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'purchase_requisitions'
        ordering = ['-created_at']

    def __str__(self):
        return self.requisition_no

    @property
    def total_amount(self):
        # Multi-line requisition-এর grand total।
        return sum(
            (item.total for item in self.req_items.all()),
            Decimal('0.00')
        )


class PurchaseRequisitionItem(models.Model):
    # প্রতিটি requisition-এর line items।
    # কেন vendor_suggestion: ISP-এ specific hardware কোন vendor থেকে কিনতে হবে
    # সেটা technician জানেন, requisition-এ note করলে purchase order সহজ হয়।
    requisition = models.ForeignKey(
        PurchaseRequisition, on_delete=models.CASCADE, related_name='req_items',
    )
    item = models.ForeignKey(
        _ITEM_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
    )
    vendor_suggestion = models.ForeignKey(
        Vendor, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='suggested_requisition_items',
    )
    description = models.CharField(max_length=255, blank=True)
    unit = models.ForeignKey(
        'inventory.Unit', on_delete=models.SET_NULL, null=True, blank=True,
    )
    quantity = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    rate = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        db_table = 'purchase_requisition_items'

    def save(self, *args, **kwargs):
        # Total auto-calc যাতে UI manually দিতে না হয়।
        self.total = Decimal(str(self.quantity or 0)) * Decimal(str(self.rate or 0))
        super().save(*args, **kwargs)


class PurchaseOrder(models.Model):
    # ক্রয় অর্ডার — Router, ONU, Cable, Accessories purchase।
    STATUS_CHOICES = [
        ('pending', 'Pending'), ('received', 'Received'), ('cancelled', 'Cancelled'),
    ]
    order_no = models.CharField(max_length=50, unique=True)
    vendor = models.ForeignKey(Vendor, on_delete=models.PROTECT, related_name='orders')
    requisition = models.ForeignKey(
        PurchaseRequisition, on_delete=models.SET_NULL, null=True, blank=True,
    )
    order_date = models.DateField()
    expected_delivery = models.DateField(null=True, blank=True)
    total_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
        related_name='purchase_orders_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'purchase_orders'
        ordering = ['-order_date', '-id']

    def __str__(self):
        return self.order_no

    def recalculate_total(self, save=True):
        # Order line items save/update হলে header total sync রাখা।
        total = sum(
            (item.total_amount for item in self.items.all()),
            Decimal('0.00')
        )
        self.total_amount = total
        if save:
            self.save(update_fields=['total_amount', 'updated_at'])
        return self


class PurchaseOrderItem(models.Model):
    # ক্রয় অর্ডারের line items — ISP hardware specific fields।
    # sequenceable + serial_mac: Router, ONU, Switch-এর MAC/Serial track করা দরকার
    # কারণ warranty, asset management এবং network audit-এ এগুলো লাগবে।
    order = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE, related_name='items')
    item = models.ForeignKey(
        _ITEM_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
    )
    description = models.CharField(max_length=255, blank=True)
    sequenceable = models.BooleanField(default=False)
    starts_with = models.CharField(max_length=100, blank=True)
    serial_mac = models.TextField(blank=True)
    store = models.ForeignKey(
        'inventory.StoreLocation', on_delete=models.SET_NULL, null=True, blank=True,
    )
    unit = models.ForeignKey(
        'inventory.Unit', on_delete=models.SET_NULL, null=True, blank=True,
    )
    quantity = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    vat_percent = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    total_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)  # without VAT
    total_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)  # with VAT

    class Meta:
        db_table = 'purchase_order_items'

    def save(self, *args, **kwargs):
        # Line total auto-calc: rate × qty + VAT।
        qty = Decimal(str(self.quantity or 0))
        rate = Decimal(str(self.unit_price or 0))
        vat = Decimal(str(self.vat_percent or 0))
        self.total_price = qty * rate
        self.total_amount = self.total_price + (self.total_price * vat / Decimal('100'))
        super().save(*args, **kwargs)


class PurchaseBill(models.Model):
    # ক্রয় বিল — purchase order থেকে তৈরি invoice।
    # discount_amount রাখা হলো কারণ vendor থেকে bulk discount আসতে পারে।
    STATUS_CHOICES = [
        ('unpaid', 'Unpaid'), ('paid', 'Paid'), ('partial', 'Partial'),
    ]
    order = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE, related_name='bills')
    bill_no = models.CharField(max_length=50, unique=True)
    bill_date = models.DateField()
    total_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    paid_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    discount_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    due_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='unpaid')
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'purchase_bills'
        ordering = ['-bill_date', '-id']

    def __str__(self):
        return self.bill_no

    def recalculate(self, save=True):
        # Bill total sync: paid + discount adjust করলে due আর status update হবে।
        paid = Decimal(str(self.paid_amount or 0))
        discount = Decimal(str(self.discount_amount or 0))
        net = max(Decimal(str(self.total_amount or 0)) - discount, Decimal('0.00'))
        self.due_amount = max(net - paid, Decimal('0.00'))
        if self.due_amount <= 0:
            self.status = 'paid'
        elif paid > 0:
            self.status = 'partial'
        else:
            self.status = 'unpaid'
        if save:
            self.save(update_fields=['due_amount', 'status', 'updated_at'])
        return self


# ─── Bandwidth Provider Bill Flow ───────────────────────────────────────────

class Provider(models.Model):
    # Bandwidth / IIG / ICX provider master.
    # UI screenshot অনুযায়ী এখানে company, contact, যোগাযোগ, account detail সব থাকবে।
    name = models.CharField(max_length=200, unique=True)
    contact_person = models.CharField(max_length=200, blank=True)
    email = models.EmailField(blank=True)
    phone_number = models.CharField(max_length=30, blank=True)
    mobile_number = models.CharField(max_length=30, blank=True)
    facebook_url = models.URLField(blank=True)
    skype_id = models.CharField(max_length=120, blank=True)
    website = models.URLField(blank=True)
    account_name = models.CharField(max_length=200, blank=True)
    account_number = models.CharField(max_length=120, blank=True)
    bank_name = models.CharField(max_length=200, blank=True)
    account_details = models.TextField(blank=True)
    address = models.TextField(blank=True)
    logo = models.ImageField(upload_to='providers/', blank=True, null=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'bandwidth_providers'
        ordering = ['name']

    def __str__(self):
        return self.name

    @property
    def current_due(self):
        # Provider list/detail-এ দ্রুত current due দেখানোর জন্য helper property।
        agg = self.bills.aggregate(
            total=models.Sum('due_amount')
        )
        return agg['total'] or Decimal('0.00')


class ProviderBill(models.Model):
    # নতুন bandwidth/provider invoice registry.
    # `amount` = subtotal, `tax` = tax portion, `net_amount` = total payable.
    # `paid_amount` জমা বাড়ে, `due_amount` কমে, আর status dashboard/filter-এ ব্যবহার হবে।
    STATUS_CHOICES = [
        ('unpaid', 'Unpaid'),
        ('partial', 'Partial'),
        ('paid', 'Paid'),
    ]

    bill_no = models.CharField(max_length=50, unique=True)
    invoice_no = models.CharField(max_length=80, unique=True)
    provider = models.ForeignKey(Provider, on_delete=models.CASCADE, related_name='bills')
    billing_month = models.CharField(max_length=20, blank=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tax = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    discount_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    net_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    paid_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    due_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='unpaid')
    issue_date = models.DateField()
    due_date = models.DateField(null=True, blank=True)
    file_attachment = models.FileField(upload_to='bandwidth/provider-bills/', blank=True, null=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'bandwidth_provider_bills'
        ordering = ['-issue_date', '-id']

    def __str__(self):
        return f"{self.bill_no} - {self.provider.name}"

    def recalculate_totals(self, save=True):
        # Bill save-এর আগে/পরে totals sync রাখার জন্য helper।
        lines = list(self.lines.all())
        subtotal = sum((line.amount for line in lines), Decimal('0.00'))
        tax_total = sum((line.tax_amount for line in lines), Decimal('0.00'))
        self.amount = subtotal
        self.tax = tax_total
        discount = Decimal(str(self.discount_amount or 0))
        self.net_amount = max(subtotal + tax_total - discount, Decimal('0.00'))
        paid = self.paid_amount or Decimal('0.00')
        self.due_amount = max(self.net_amount - paid, Decimal('0.00'))
        if self.due_amount <= 0:
            self.status = 'paid'
        elif paid > 0:
            self.status = 'partial'
        else:
            self.status = 'unpaid'
        if save:
            self.save(update_fields=['amount', 'tax', 'net_amount', 'due_amount', 'status', 'updated_at'])
        return self

    def register_payment(self, amount, paid_at=None, payment_method='', description='', user=None):
        # একটি payment settle করলে bill + cash account + journal একসাথে update।
        from accounting.models import JournalEntry, JournalLine, Expense, ExpenseCategory, ChartOfAccount, AccountType

        amount = Decimal(str(amount or 0))
        if amount <= 0:
            raise ValueError('Payment amount must be greater than zero.')

        with transaction.atomic():
            bill = ProviderBill.objects.select_for_update().select_related('provider').get(pk=self.pk)
            bill.due_amount = Decimal(str(bill.due_amount or 0))
            if amount > bill.due_amount:
                raise ValueError('Payment amount cannot exceed due amount.')

            asset_type, _ = AccountType.objects.get_or_create(
                code='ASSET',
                defaults={'name': 'Asset', 'is_debit_normal': True},
            )
            cash_account, _ = ChartOfAccount.objects.get_or_create(
                code='1010',
                defaults={
                    'account_type': asset_type,
                    'name': 'Cash On Hand',
                    'description': 'Operating cash balance',
                    'is_active': True,
                },
            )
            expense_type, _ = AccountType.objects.get_or_create(
                code='EXP',
                defaults={'name': 'Expense', 'is_debit_normal': True},
            )
            expense_account, _ = ChartOfAccount.objects.get_or_create(
                code='5100',
                defaults={
                    'account_type': expense_type,
                    'name': 'Bandwidth Purchase Expense',
                    'description': 'Provider purchase/payment expense',
                    'is_active': True,
                },
            )
            expense_cat, _ = ExpenseCategory.objects.get_or_create(
                name='Bandwidth Purchase',
                defaults={'account': expense_account},
            )
            if expense_cat.account_id != expense_account.id:
                expense_cat.account = expense_account
                expense_cat.save(update_fields=['account'])

            reference = f'PBPAY-{bill.invoice_no}-{bill.payments.count() + 1}'
            journal = JournalEntry.objects.create(
                reference=reference,
                date=paid_at or bill.issue_date,
                description=description or f'Payment for provider bill {bill.invoice_no}',
                total_debit=amount,
                total_credit=amount,
                is_posted=True,
                created_by=user,
            )
            JournalLine.objects.create(
                journal=journal,
                account=expense_account,
                debit=amount,
                credit=Decimal('0.00'),
                description=description or f'Bandwidth purchase expense for {bill.invoice_no}',
            )
            JournalLine.objects.create(
                journal=journal,
                account=cash_account,
                debit=Decimal('0.00'),
                credit=amount,
                description=description or f'Cash outflow for {bill.invoice_no}',
            )

            Expense.objects.create(
                category=expense_cat,
                amount=amount,
                date=paid_at or bill.issue_date,
                description=description or f'Provider payment for {bill.provider.name}',
                reference=reference,
                created_by=user,
            )

            payment = ProviderBillPayment.objects.create(
                bill=bill,
                amount=amount,
                payment_date=paid_at or bill.issue_date,
                payment_method=payment_method,
                description=description,
                journal_entry=journal,
                created_by=user,
            )

            bill.paid_amount = (bill.paid_amount or Decimal('0.00')) + amount
            bill.due_amount = max((bill.net_amount or Decimal('0.00')) - bill.paid_amount, Decimal('0.00'))
            bill.status = 'paid' if bill.due_amount <= 0 else 'partial'
            bill.save(update_fields=['paid_amount', 'due_amount', 'status', 'updated_at'])
            return payment


class ProviderBillLine(models.Model):
    # Bandwidth provider bill-এর itemized breakdown।
    # কেন item FK নেই: Bandwidth Buy সম্পূর্ণ আলাদা flow — inventory Item-এর
    # সাথে কোনো সম্পর্ক নেই। শুধু description text দিয়েই line item manage হবে।
    bill = models.ForeignKey(ProviderBill, on_delete=models.CASCADE, related_name='lines')
    description = models.CharField(max_length=255, blank=True)
    unit = models.CharField(max_length=50, blank=True)
    quantity = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    rate = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    vat_percent = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tax_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    from_date = models.DateField(null=True, blank=True)
    to_date = models.DateField(null=True, blank=True)

    class Meta:
        db_table = 'bandwidth_provider_bill_lines'

    def save(self, *args, **kwargs):
        self.amount = Decimal(str(self.quantity or 0)) * Decimal(str(self.rate or 0))
        self.tax_amount = (self.amount * Decimal(str(self.vat_percent or 0))) / Decimal('100')
        self.total_amount = self.amount + self.tax_amount
        super().save(*args, **kwargs)


class ProviderBillPayment(models.Model):
    # Payment history রাখি, যাতে partial payment একাধিকবার settle করা যায়।
    bill = models.ForeignKey(ProviderBill, on_delete=models.CASCADE, related_name='payments')
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    payment_date = models.DateField()
    payment_method = models.CharField(max_length=50, blank=True)
    description = models.TextField(blank=True)
    journal_entry = models.ForeignKey('accounting.JournalEntry', on_delete=models.SET_NULL, null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'bandwidth_provider_bill_payments'
        ordering = ['-payment_date', '-id']

    def __str__(self):
        return f'{self.bill.invoice_no} - {self.amount}'
