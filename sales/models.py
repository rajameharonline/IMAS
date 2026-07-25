# এই ফাইলটি Sales & Service মডিউলের মডেল সংজ্ঞায়িত করে।
# দুটি আলাদা flow:
#   1) ProductSalesInvoice  — inventory item বিক্রি (stock OUT হয়)
#   2) ServiceSalesInvoice  — সার্ভিস বিক্রি (installation, maintenance ইত্যাদি)
# উভয় ক্ষেত্রে payment receipt + double-entry accounting journal তৈরি হয়।

from decimal import Decimal
from django.db import models, transaction
from django.conf import settings


# ─── Invoice Number Auto-Generator ──────────────────────────────────────────

def _next_invoice_no(prefix, model_class, field='invoice_no', digits=6):
    # শেষ invoice_no থেকে পরবর্তী serial বের করার utility।
    # কেন: UI-তে Invoice No field blank রেখে submit করলেও auto number পাবে।
    last = model_class.objects.order_by(f'-{field}').values_list(field, flat=True).first()
    if last:
        raw = ''.join(ch for ch in str(last) if ch.isdigit())
        try:
            return f'{prefix}{int(raw) + 1:0{digits}d}'
        except (TypeError, ValueError):
            pass
    return f'{prefix}{1:0{digits}d}'


def _next_receipt_no(prefix, model_class, field='receipt_no', digits=6):
    # Payment receipt number auto-generator।
    last = model_class.objects.order_by(f'-{field}').values_list(field, flat=True).first()
    if last:
        raw = ''.join(ch for ch in str(last) if ch.isdigit())
        try:
            return f'{prefix}{int(raw) + 1:0{digits}d}'
        except (TypeError, ValueError):
            pass
    return f'{prefix}{1:0{digits}d}'


# ─── Product Sales Invoice ───────────────────────────────────────────────────

class ProductSalesInvoice(models.Model):
    # Product বিক্রির invoice header।
    # কেন stock OUT: product sell করলে inventory থেকে বাদ যায়,
    # তাই invoice create-এর সময় StockTransaction 'out' তৈরি হয়।
    STATUS_CHOICES = [
        ('unpaid', 'Unpaid'),
        ('partial', 'Partial'),
        ('paid', 'Paid'),
    ]

    invoice_no  = models.CharField(max_length=50, unique=True)
    customer    = models.ForeignKey(
        'clients.Client', on_delete=models.PROTECT, related_name='product_sales_invoices',
    )
    payment_due = models.DateField(null=True, blank=True)
    total       = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    # receive_amount = এ পর্যন্ত মোট payment পাওয়া গেছে
    receive_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    discount    = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    due         = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    status      = models.CharField(max_length=20, choices=STATUS_CHOICES, default='unpaid')
    remarks     = models.TextField(blank=True)
    created_by  = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, related_name='product_invoices_created',
    )
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'product_sales_invoices'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.invoice_no} — {self.customer}'

    def recalculate(self, save=True):
        # Payment পাওয়ার পর due ও status sync রাখার helper।
        paid     = Decimal(str(self.receive_amount or 0))
        discount = Decimal(str(self.discount or 0))
        net      = max(Decimal(str(self.total or 0)) - discount, Decimal('0.00'))
        self.due = max(net - paid, Decimal('0.00'))
        if self.due <= 0:
            self.status = 'paid'
        elif paid > 0:
            self.status = 'partial'
        else:
            self.status = 'unpaid'
        if save:
            self.save(update_fields=['due', 'status', 'receive_amount', 'updated_at'])
        return self

    def register_payment(self, amount, payment_method='cash', received_by=None,
                         paid_by=None, receive_date=None, description='', user=None):
        # Payment receive হলে:
        # 1) Receipt তৈরি হয়  2) Ledger: DR Cash, CR Sales Income
        from accounting.models import (
            AccountType, ChartOfAccount, JournalEntry, JournalLine, Income, IncomeCategory,
        )

        amount = Decimal(str(amount or 0))
        if amount <= 0:
            raise ValueError('Payment amount must be greater than zero.')

        with transaction.atomic():
            inv = ProductSalesInvoice.objects.select_for_update().get(pk=self.pk)
            due = Decimal(str(inv.due or 0))
            if amount > due:
                raise ValueError('Payment amount cannot exceed due amount.')

            # Cash On Hand account
            asset_type, _ = AccountType.objects.get_or_create(
                code='ASSET', defaults={'name': 'Asset', 'is_debit_normal': True},
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

            # Product Sales Income account
            income_type, _ = AccountType.objects.get_or_create(
                code='INC', defaults={'name': 'Income', 'is_debit_normal': False},
            )
            income_account, _ = ChartOfAccount.objects.get_or_create(
                code='4200',
                defaults={
                    'account_type': income_type,
                    'name': 'Product Sales Income',
                    'description': 'Income from product sales',
                    'is_active': True,
                },
            )
            income_cat, _ = IncomeCategory.objects.get_or_create(
                name='Product Sales',
                defaults={'account': income_account},
            )

            reference = f'PSALE-{inv.invoice_no}-{inv.payments.count() + 1}'
            journal = JournalEntry.objects.create(
                reference=reference,
                date=receive_date or inv.created_at.date(),
                description=description or f'Product sale payment for {inv.invoice_no}',
                total_debit=amount,
                total_credit=amount,
                is_posted=True,
                created_by=user,
            )
            JournalLine.objects.create(
                journal=journal, account=cash_account,
                debit=amount, credit=Decimal('0.00'),
                description=f'Cash received — {inv.invoice_no}',
            )
            JournalLine.objects.create(
                journal=journal, account=income_account,
                debit=Decimal('0.00'), credit=amount,
                description=f'Product sales income — {inv.invoice_no}',
            )
            Income.objects.create(
                category=income_cat, amount=amount,
                date=receive_date or inv.created_at.date(),
                description=description or f'Product sale {inv.invoice_no}',
                reference=reference, created_by=user,
            )

            receipt_no = _next_receipt_no('RCP-P', ProductSalesPayment)
            payment = ProductSalesPayment.objects.create(
                invoice=inv,
                receipt_no=receipt_no,
                paid_amount=amount,
                payment_method=payment_method,
                paid_by=paid_by,
                receive_date=receive_date or inv.created_at.date(),
                received_by=received_by,
                journal_entry=journal,
                created_by=user,
            )

            inv.receive_amount = (inv.receive_amount or Decimal('0.00')) + amount
            inv.recalculate(save=False)
            inv.save(update_fields=['receive_amount', 'due', 'status', 'updated_at'])
            return payment


class ProductSalesInvoiceLine(models.Model):
    # Product sales invoice-এর line items।
    # item FK: inventory.Item থেকে product type item নির্বাচন করা হয়।
    invoice     = models.ForeignKey(
        ProductSalesInvoice, on_delete=models.CASCADE, related_name='lines',
    )
    item        = models.ForeignKey(
        'inventory.Item', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='product_sale_lines',
    )
    description = models.CharField(max_length=255, blank=True)
    quantity    = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    rate        = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    vat_percent = models.DecimalField(max_digits=6,  decimal_places=2, default=0)
    total       = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    class Meta:
        db_table = 'product_sales_invoice_lines'

    def save(self, *args, **kwargs):
        # Total = qty × rate + VAT
        qty   = Decimal(str(self.quantity or 0))
        rate  = Decimal(str(self.rate or 0))
        vat   = Decimal(str(self.vat_percent or 0))
        base  = qty * rate
        self.total = base + (base * vat / Decimal('100'))
        super().save(*args, **kwargs)


class ProductSalesPayment(models.Model):
    # Product sales invoice-এর payment receipt।
    PAYMENT_METHOD_CHOICES = [
        ('cash', 'Cash'), ('bkash', 'bKash'), ('nagad', 'Nagad'),
        ('rocket', 'Rocket'), ('bank', 'Bank Transfer'), ('other', 'Other'),
    ]

    invoice        = models.ForeignKey(
        ProductSalesInvoice, on_delete=models.CASCADE, related_name='payments',
    )
    receipt_no     = models.CharField(max_length=50, unique=True)
    paid_amount    = models.DecimalField(max_digits=14, decimal_places=2)
    discount       = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES, default='cash')
    paid_by        = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='product_sales_paid_by',
    )
    receive_date   = models.DateField()
    received_by    = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='product_sales_received_by',
    )
    journal_entry  = models.ForeignKey(
        'accounting.JournalEntry', on_delete=models.SET_NULL, null=True, blank=True,
    )
    created_by     = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='product_sales_payments_created',
    )
    created_at     = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'product_sales_payments'
        ordering = ['-receive_date', '-id']

    def __str__(self):
        return self.receipt_no


# ─── Service Sales Invoice ───────────────────────────────────────────────────

class ServiceSalesInvoice(models.Model):
    # Service বিক্রির invoice header।
    # invoice_type: Installation, Maintenance, Configuration ইত্যাদি ক্যাটাগরি।
    # Service-এ stock movement নেই — শুধু income accounting হয়।
    STATUS_CHOICES = [
        ('unpaid', 'Unpaid'),
        ('partial', 'Partial'),
        ('paid', 'Paid'),
    ]
    INVOICE_TYPE_CHOICES = [
        ('installation', 'Installation'),
        ('maintenance',  'Maintenance'),
        ('configuration','Configuration'),
        ('support',      'Support'),
        ('other',        'Other'),
    ]

    invoice_no   = models.CharField(max_length=50, unique=True)
    invoice_type = models.CharField(
        max_length=30, choices=INVOICE_TYPE_CHOICES, default='installation',
    )
    customer     = models.ForeignKey(
        'clients.Client', on_delete=models.PROTECT, related_name='service_sales_invoices',
    )
    payment_due  = models.DateField(null=True, blank=True)
    total        = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    receive_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    discount     = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    due          = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    status       = models.CharField(max_length=20, choices=STATUS_CHOICES, default='unpaid')
    remarks      = models.TextField(blank=True)
    created_by   = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, related_name='service_invoices_created',
    )
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'service_sales_invoices'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.invoice_no} — {self.customer}'

    def recalculate(self, save=True):
        # Payment পাওয়ার পর due ও status sync রাখার helper।
        paid     = Decimal(str(self.receive_amount or 0))
        discount = Decimal(str(self.discount or 0))
        net      = max(Decimal(str(self.total or 0)) - discount, Decimal('0.00'))
        self.due = max(net - paid, Decimal('0.00'))
        if self.due <= 0:
            self.status = 'paid'
        elif paid > 0:
            self.status = 'partial'
        else:
            self.status = 'unpaid'
        if save:
            self.save(update_fields=['due', 'status', 'receive_amount', 'updated_at'])
        return self

    def register_payment(self, amount, payment_method='cash', received_by=None,
                         paid_by=None, receive_date=None, description='', user=None):
        # Service payment: DR Cash, CR Service Sales Income
        from accounting.models import (
            AccountType, ChartOfAccount, JournalEntry, JournalLine, Income, IncomeCategory,
        )

        amount = Decimal(str(amount or 0))
        if amount <= 0:
            raise ValueError('Payment amount must be greater than zero.')

        with transaction.atomic():
            inv = ServiceSalesInvoice.objects.select_for_update().get(pk=self.pk)
            due = Decimal(str(inv.due or 0))
            if amount > due:
                raise ValueError('Payment amount cannot exceed due amount.')

            asset_type, _ = AccountType.objects.get_or_create(
                code='ASSET', defaults={'name': 'Asset', 'is_debit_normal': True},
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
            income_type, _ = AccountType.objects.get_or_create(
                code='INC', defaults={'name': 'Income', 'is_debit_normal': False},
            )
            income_account, _ = ChartOfAccount.objects.get_or_create(
                code='4210',
                defaults={
                    'account_type': income_type,
                    'name': 'Service Sales Income',
                    'description': 'Income from service sales',
                    'is_active': True,
                },
            )
            income_cat, _ = IncomeCategory.objects.get_or_create(
                name='Service Sales',
                defaults={'account': income_account},
            )

            reference = f'SSALE-{inv.invoice_no}-{inv.payments.count() + 1}'
            journal = JournalEntry.objects.create(
                reference=reference,
                date=receive_date or inv.created_at.date(),
                description=description or f'Service sale payment for {inv.invoice_no}',
                total_debit=amount,
                total_credit=amount,
                is_posted=True,
                created_by=user,
            )
            JournalLine.objects.create(
                journal=journal, account=cash_account,
                debit=amount, credit=Decimal('0.00'),
                description=f'Cash received — {inv.invoice_no}',
            )
            JournalLine.objects.create(
                journal=journal, account=income_account,
                debit=Decimal('0.00'), credit=amount,
                description=f'Service sales income — {inv.invoice_no}',
            )
            Income.objects.create(
                category=income_cat, amount=amount,
                date=receive_date or inv.created_at.date(),
                description=description or f'Service sale {inv.invoice_no}',
                reference=reference, created_by=user,
            )

            receipt_no = _next_receipt_no('RCP-S', ServiceSalesPayment)
            payment = ServiceSalesPayment.objects.create(
                invoice=inv,
                receipt_no=receipt_no,
                paid_amount=amount,
                payment_method=payment_method,
                paid_by=paid_by,
                receive_date=receive_date or inv.created_at.date(),
                received_by=received_by,
                journal_entry=journal,
                created_by=user,
            )

            inv.receive_amount = (inv.receive_amount or Decimal('0.00')) + amount
            inv.recalculate(save=False)
            inv.save(update_fields=['receive_amount', 'due', 'status', 'updated_at'])
            return payment


class ServiceSalesInvoiceLine(models.Model):
    # Service invoice-এর line items।
    # item FK: inventory.Item service type থেকে নেওয়া হয়।
    invoice     = models.ForeignKey(
        ServiceSalesInvoice, on_delete=models.CASCADE, related_name='lines',
    )
    item        = models.ForeignKey(
        'inventory.Item', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='service_sale_lines',
    )
    description = models.CharField(max_length=255, blank=True)
    quantity    = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    rate        = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    vat_percent = models.DecimalField(max_digits=6,  decimal_places=2, default=0)
    total       = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    class Meta:
        db_table = 'service_sales_invoice_lines'

    def save(self, *args, **kwargs):
        qty  = Decimal(str(self.quantity or 0))
        rate = Decimal(str(self.rate or 0))
        vat  = Decimal(str(self.vat_percent or 0))
        base = qty * rate
        self.total = base + (base * vat / Decimal('100'))
        super().save(*args, **kwargs)


class ServiceSalesPayment(models.Model):
    # Service sales invoice-এর payment receipt।
    PAYMENT_METHOD_CHOICES = [
        ('cash', 'Cash'), ('bkash', 'bKash'), ('nagad', 'Nagad'),
        ('rocket', 'Rocket'), ('bank', 'Bank Transfer'), ('other', 'Other'),
    ]

    invoice        = models.ForeignKey(
        ServiceSalesInvoice, on_delete=models.CASCADE, related_name='payments',
    )
    receipt_no     = models.CharField(max_length=50, unique=True)
    paid_amount    = models.DecimalField(max_digits=14, decimal_places=2)
    discount       = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES, default='cash')
    paid_by        = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='service_sales_paid_by',
    )
    receive_date   = models.DateField()
    received_by    = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='service_sales_received_by',
    )
    journal_entry  = models.ForeignKey(
        'accounting.JournalEntry', on_delete=models.SET_NULL, null=True, blank=True,
    )
    created_by     = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='service_sales_payments_created',
    )
    created_at     = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'service_sales_payments'
        ordering = ['-receive_date', '-id']

    def __str__(self):
        return self.receipt_no
