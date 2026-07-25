# এই ফাইলটি একাউন্টিং মডিউলের জন্য: চার্ট অব একাউন্টস, জার্নাল, ইনকাম, এক্সপেন্স, ব্যালেন্স শিট।
from django.db import models
from django.conf import settings


class AccountType(models.Model):
    # একাউন্ট টাইপ: Asset, Liability, Equity, Income, Expense
    name = models.CharField(max_length=100, unique=True)
    code = models.CharField(max_length=20, unique=True)
    is_debit_normal = models.BooleanField(default=True)

    class Meta:
        db_table = 'account_types'

    def __str__(self):
        return self.name


class ChartOfAccount(models.Model):
    # চার্ট অব একাউন্টস - সকল একাউন্টের তালিকা
    account_type = models.ForeignKey(AccountType, on_delete=models.CASCADE)
    code = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=200)
    parent = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'chart_of_accounts'
        ordering = ['code']

    def __str__(self):
        return f"{self.code} - {self.name}"


class JournalEntry(models.Model):
    # জার্নাল এন্ট্রি — double-entry bookkeeping।
    # is_posted → approved হলে True।
    reference   = models.CharField(max_length=100, unique=True)
    date        = models.DateField()
    description = models.TextField()
    total_debit = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_credit= models.DecimalField(max_digits=14, decimal_places=2, default=0)
    is_posted   = models.BooleanField(default=False)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='approved_journals',
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    attachment  = models.FileField(upload_to='journal/', null=True, blank=True)
    created_by  = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, related_name='created_journals',
    )
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'journal_entries'
        ordering = ['-date']


class JournalLine(models.Model):
    # জার্নাল এন্ট্রির প্রতিটি লাইন (debit বা credit)
    journal = models.ForeignKey(JournalEntry, on_delete=models.CASCADE, related_name='lines')
    account = models.ForeignKey(ChartOfAccount, on_delete=models.CASCADE)
    debit = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    credit = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    description = models.TextField(blank=True)

    class Meta:
        db_table = 'journal_lines'


class IncomeCategory(models.Model):
    name = models.CharField(max_length=100, unique=True)
    account = models.ForeignKey(ChartOfAccount, on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        db_table = 'income_categories'

    def __str__(self):
        return self.name


class Income(models.Model):
    # আয়ের রেকর্ড — Credit Voucher।
    # voucher_no: একই form submission-এর সব line items একই voucher_no শেয়ার করে।
    # account: কোন account-এ cash জমা হলো (DR side)।
    # is_approved: admin approve করলে True হয়।
    STATUS_CHOICES = [('pending', 'Pending'), ('approved', 'Approved')]

    voucher_no  = models.CharField(max_length=50, blank=True, db_index=True)
    account     = models.ForeignKey(
        ChartOfAccount, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='income_entries',
    )
    category    = models.ForeignKey(IncomeCategory, on_delete=models.SET_NULL, null=True)
    amount      = models.DecimalField(max_digits=12, decimal_places=2)
    date        = models.DateField()
    description = models.TextField(blank=True)
    reference   = models.CharField(max_length=100, blank=True)
    is_approved = models.BooleanField(default=False)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='approved_incomes',
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    attachment  = models.FileField(upload_to='income/', null=True, blank=True)
    created_by  = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, related_name='created_incomes',
    )
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'incomes'
        ordering = ['-date', '-id']

    @property
    def status(self):
        return 'approved' if self.is_approved else 'pending'


class ExpenseCategory(models.Model):
    name = models.CharField(max_length=100, unique=True)
    account = models.ForeignKey(ChartOfAccount, on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        db_table = 'expense_categories'

    def __str__(self):
        return self.name


class Expense(models.Model):
    # ব্যয়ের রেকর্ড — Debit Voucher।
    # voucher_no: একই voucher-এর সব line items share করে।
    # account: কোন account থেকে cash বেরিয়ে গেছে (CR side)।
    STATUS_CHOICES = [('pending', 'Pending'), ('approved', 'Approved')]

    voucher_no  = models.CharField(max_length=50, blank=True, db_index=True)
    account     = models.ForeignKey(
        ChartOfAccount, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='expense_entries',
    )
    category    = models.ForeignKey(ExpenseCategory, on_delete=models.SET_NULL, null=True)
    amount      = models.DecimalField(max_digits=12, decimal_places=2)
    date        = models.DateField()
    description = models.TextField(blank=True)
    reference   = models.CharField(max_length=100, blank=True)
    is_approved = models.BooleanField(default=False)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='approved_expenses',
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    attachment  = models.FileField(upload_to='expense/', null=True, blank=True)
    created_by  = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, related_name='created_expenses',
    )
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'expenses'
        ordering = ['-date', '-id']

    @property
    def status(self):
        return 'approved' if self.is_approved else 'pending'


class DailyAccount(models.Model):
    # দৈনিক একাউন্ট ক্লোজিং
    date = models.DateField(unique=True)
    total_income = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_expense = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    net = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    is_closed = models.BooleanField(default=False)
    closed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'daily_accounts'
        ordering = ['-date']
