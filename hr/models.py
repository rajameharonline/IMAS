# এই ফাইলটি HR ও Payroll ম্যানেজমেন্টের জন্য।
from django.db import models
from django.conf import settings


class Department(models.Model):
    # HR ডিপার্টমেন্ট — Service, Billing, Support, Accounts ইত্যাদি
    name    = models.CharField(max_length=100, unique=True)
    details = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'hr_departments'
        ordering = ['id']

    def __str__(self):
        return self.name


class PayHead(models.Model):
    # বেতনের উপাদান — Basic Salary, Over Time, Bonus, Deduction ইত্যাদি
    TYPE_CHOICES = [('addition', 'Addition'), ('deduction', 'Deduction')]

    name         = models.CharField(max_length=100, unique=True)
    payhead_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    description  = models.TextField(blank=True)
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'hr_payheads'
        ordering = ['id']

    def __str__(self):
        return f"{self.name} ({self.get_payhead_type_display()})"


class Employee(models.Model):
    # কর্মচারীর মূল তথ্য — বিস্তারিত ফিল্ড সহ
    GENDER_CHOICES = [('male', 'Male'), ('female', 'Female'), ('other', 'Other')]
    STATUS_CHOICES = [('active', 'Active'), ('inactive', 'Inactive'), ('resigned', 'Resigned')]
    MARITAL_CHOICES = [
        ('single', 'Single'), ('married', 'Married'),
        ('divorced', 'Divorced'), ('widowed', 'Widowed'),
    ]

    # ── Identification ───────────────────────────────────────────────────
    employee_id = models.CharField(max_length=50, unique=True)
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                null=True, blank=True, related_name='employee_profile')
    payroll = models.ForeignKey(
        'Payroll', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='assigned_employees', verbose_name='Assigned Payroll',
    )

    # ── Basic Information ────────────────────────────────────────────────
    full_name          = models.CharField(max_length=200)
    phone              = models.CharField(max_length=20)               # Personal Contact No.
    office_contact     = models.CharField(max_length=20, blank=True)
    guardian_contact   = models.CharField(max_length=20, blank=True)
    email              = models.EmailField(blank=True)
    gender             = models.CharField(max_length=10, choices=GENDER_CHOICES)
    date_of_birth      = models.DateField(null=True, blank=True)
    marital_status     = models.CharField(max_length=20, choices=MARITAL_CHOICES, blank=True)
    nid                = models.CharField(max_length=50, blank=True)
    facebook_link      = models.CharField(max_length=255, blank=True)
    reference          = models.CharField(max_length=200, blank=True)
    district           = models.CharField(max_length=100, blank=True)
    upazila            = models.CharField(max_length=100, blank=True)
    working_experience = models.TextField(blank=True)
    present_address    = models.TextField(blank=True)
    permanent_address  = models.TextField(blank=True)
    address            = models.TextField(blank=True)   # Legacy — kept for compatibility

    # ── Attendance / Device ──────────────────────────────────────────────
    punch_card_id = models.CharField(max_length=100, blank=True)
    in_time       = models.TimeField(null=True, blank=True)
    out_time      = models.TimeField(null=True, blank=True)

    # ── Educational Qualification ────────────────────────────────────────
    last_degree  = models.CharField(max_length=200, blank=True)
    institution  = models.CharField(max_length=200, blank=True)
    passing_year = models.CharField(max_length=10, blank=True)

    # ── Posting / Job Info ───────────────────────────────────────────────
    join_date    = models.DateField()
    designation  = models.CharField(max_length=100)
    department   = models.ForeignKey(
        Department, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='employees',
    )
    position     = models.ForeignKey(
        'Position', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='employees',
    )
    department_name = property(lambda self: self.department.name if self.department else '')
    basic_salary    = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    photo           = models.ImageField(upload_to='hr/employees/', blank=True, null=True)
    status          = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    created_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'employees'

    def __str__(self):
        return f"{self.employee_id} - {self.full_name}"


class Attendance(models.Model):
    # কর্মচারীর হাজিরা রেকর্ড
    STATUS_CHOICES = [
        ('present', 'Present'), ('absent', 'Absent'),
        ('late', 'Late'), ('half_day', 'Half Day'), ('leave', 'Leave'),
    ]
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='attendances')
    date = models.DateField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='present')
    check_in = models.TimeField(null=True, blank=True)
    check_out = models.TimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'attendance'
        unique_together = ('employee', 'date')


class Payroll(models.Model):
    # Payroll Structure — Monthly Payroll, Weekly Payroll ইত্যাদি
    PAYROLL_TYPE_CHOICES = [
        ('monthly', 'Monthly'), ('weekly', 'Weekly'), ('biweekly', 'Bi-Weekly'), ('daily', 'Daily'),
    ]
    PAYMENT_TYPE_CHOICES = [
        ('', 'Select Payment Type'), ('other', 'Other'), ('cash', 'Cash'),
        ('bkash', 'bKash'), ('bank', 'Bank'), ('rocket', 'Rocket'),
        ('sslcommerz', 'SSL Commerz'), ('foster', 'Foster Payments'),
        ('walletmix', 'Walletmix'), ('surecash', 'SureCash'), ('nagad', 'Nagad'),
        ('mcash', 'MCash'), ('ucash', 'UCash'), ('aamarpay', 'aamarPay'),
        ('phonepe', 'PhonePe'), ('razorpay', 'Razorpay'), ('stripe', 'Stripe'),
    ]
    name         = models.CharField(max_length=100, unique=True)
    payroll_type = models.CharField(max_length=20, choices=PAYROLL_TYPE_CHOICES, default='monthly')
    payment_type = models.CharField(max_length=20, choices=PAYMENT_TYPE_CHOICES, blank=True)
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'hr_payrolls'
        ordering = ['id']

    def __str__(self):
        return self.name


class PayrollPeriod(models.Model):
    # Payroll Structure-এর Bill Periods (Jan-26, Feb-26 ইত্যাদি)
    payroll     = models.ForeignKey(Payroll, on_delete=models.CASCADE, related_name='periods')
    period_name = models.CharField(max_length=20)
    start_date  = models.DateField()
    end_date    = models.DateField()
    issue_date  = models.DateField()

    class Meta:
        db_table = 'hr_payroll_periods'
        ordering = ['start_date']
        unique_together = ('payroll', 'period_name')


class PayrollPayHead(models.Model):
    # Payroll Structure-এ assigned PayHead (Basic Salary, Bonus ইত্যাদি)
    TYPE_CHOICES = [
        ('amount', 'Amount'), ('percentage', 'Percentage'), ('per_hour', 'Per Hour'),
    ]
    payroll     = models.ForeignKey(Payroll, on_delete=models.CASCADE, related_name='assigned_payheads')
    payhead     = models.ForeignKey(PayHead, on_delete=models.CASCADE, related_name='payroll_assignments')
    amount_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='amount')
    unit_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'hr_payroll_payheads'
        unique_together = ('payroll', 'payhead')


class PayrollSheet(models.Model):
    # মাসিক বেতন শিট
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='payrolls')
    month = models.CharField(max_length=7)  # YYYY-MM
    basic_salary = models.DecimalField(max_digits=10, decimal_places=2)
    bonus = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    deduction = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    net_salary = models.DecimalField(max_digits=10, decimal_places=2)
    is_paid = models.BooleanField(default=False)
    paid_date = models.DateField(null=True, blank=True)
    payment_method = models.CharField(max_length=50, blank=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'payroll_sheets'
        unique_together = ('employee', 'month')



class Position(models.Model):
    # HR পজিশন — Manager, Bill Collector, Network Engineer ইত্যাদি
    POSITION_TYPE_CHOICES = [
        ('single', 'Single'),   # একটি কর্মচারী একবার
        ('shared', 'Shared'),   # একাধিক কর্মচারী
    ]
    STATUS_CHOICES = [
        ('active',   'Active'),
        ('inactive', 'Inactive'),
    ]

    name             = models.CharField(max_length=150, unique=True)
    is_permanent     = models.BooleanField(default=False)
    is_seasonal      = models.BooleanField(default=False)
    position_type    = models.CharField(max_length=20, choices=POSITION_TYPE_CHOICES, default='shared')
    status           = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')

    # Hiring Information
    head_count       = models.PositiveIntegerField(default=1)
    bargaining_unit  = models.CharField(max_length=200, blank=True)
    payroll          = models.ForeignKey(
        Payroll, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='positions',
    )

    # Working Information
    working_hour     = models.CharField(max_length=50, blank=True)
    supervisor       = models.ForeignKey(
        Employee, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='supervised_positions',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'hr_positions'
        ordering = ['id']

    def __str__(self):
        return self.name


class PayslipEntry(models.Model):
    # প্রতিটি payslip-এর ভেতরে প্রতিটি payhead-এর amount রেকর্ড
    AMOUNT_TYPE_CHOICES = [
        ('amount',     'Amount'),
        ('percentage', 'Percentage'),
        ('per_hour',   'Per Hour'),
    ]

    payslip     = models.ForeignKey(
        PayrollSheet, on_delete=models.CASCADE, related_name='entries',
    )
    payhead     = models.ForeignKey(
        PayHead, on_delete=models.SET_NULL, null=True, related_name='payslip_entries',
    )
    payhead_name = models.CharField(max_length=100)        # snapshot
    payhead_type = models.CharField(max_length=20)         # addition / deduction
    amount_type  = models.CharField(max_length=20, choices=AMOUNT_TYPE_CHOICES, default='amount')
    unit_amount  = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    final_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    class Meta:
        db_table = 'hr_payslip_entries'
        ordering = ['id']

    def __str__(self):
        return f"{self.payslip_id} – {self.payhead_name}"


class EmployeeAdvance(models.Model):
    # Employee-কে আগে দেওয়া advance — পরবর্তী মাসগুলোর payslip থেকে
    # নির্দিষ্ট monthly_deduction অনুযায়ী auto-recover হবে।
    PAYMENT_METHOD_CHOICES = [
        ('cash',       'Cash'),
        ('bkash',      'bKash'),
        ('nagad',      'Nagad'),
        ('rocket',     'Rocket'),
        ('bank',       'Bank Transfer'),
        ('sslcommerz', 'SSLCommerz'),
        ('other',      'Other'),
    ]

    employee          = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name='advances',
    )
    amount            = models.DecimalField(max_digits=12, decimal_places=2)
    monthly_deduction = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        help_text='প্রতি মাসে কত টাকা কেটে নেওয়া হবে; 0 মানে পরবর্তী একটাই payslip-এ পুরোটা',
    )
    taken_date        = models.DateField()
    payment_method    = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES, default='cash')
    transaction_id    = models.CharField(max_length=100, blank=True)
    notes             = models.TextField(blank=True)
    received_by       = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='given_employee_advances',
    )
    created_at        = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'hr_employee_advances'
        ordering = ['-taken_date', '-id']

    def __str__(self):
        return f"Advance #{self.id} — {self.employee_id} — {self.amount}"


class AdvanceRecovery(models.Model):
    # প্রতি payslip-এ advance থেকে কত টাকা recover হলো — audit trail
    advance        = models.ForeignKey(
        EmployeeAdvance, on_delete=models.CASCADE, related_name='recoveries',
    )
    payslip        = models.ForeignKey(
        'PayrollSheet', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='advance_recoveries',
    )
    amount         = models.DecimalField(max_digits=10, decimal_places=2)
    recovered_date = models.DateField()
    notes          = models.CharField(max_length=255, blank=True)
    created_at     = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'hr_advance_recoveries'
        ordering = ['-recovered_date', '-id']

    def __str__(self):
        return f"Recovery #{self.id} — Adv#{self.advance_id} — {self.amount}"


class PayslipPayment(models.Model):
    # একই payslip-এ multiple partial payment record — Pay Full / Pay Partially দুটোই
    PAYMENT_METHOD_CHOICES = [
        ('cash',       'Cash'),
        ('bkash',      'bKash'),
        ('nagad',      'Nagad'),
        ('rocket',     'Rocket'),
        ('bank',       'Bank Transfer'),
        ('sslcommerz', 'SSLCommerz'),
        ('other',      'Other'),
    ]

    payslip        = models.ForeignKey(
        PayrollSheet, on_delete=models.CASCADE, related_name='payments',
    )
    amount         = models.DecimalField(max_digits=10, decimal_places=2)
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES, default='cash')
    paid_date      = models.DateField()
    transaction_id = models.CharField(max_length=100, blank=True)
    notes          = models.TextField(blank=True)
    received_by    = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='received_payslip_payments',
    )
    created_at     = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'hr_payslip_payments'
        ordering = ['-paid_date', '-id']

    def __str__(self):
        return f"{self.payslip_id} — {self.amount} ({self.payment_method})"


class ResignRule(models.Model):
    # পদত্যাগ নীতি — notice period ও early-leave deduction নির্ধারণ করে।
    # Resignation আবেদনে এই rule সংযুক্ত হয়, তাই প্রতিবার নতুন করে শর্ত লিখতে হয় না।
    name                 = models.CharField(max_length=150, unique=True)
    notice_period_days   = models.PositiveIntegerField(default=30)   # ন্যূনতম নোটিশ দিন
    deduction_percentage = models.DecimalField(max_digits=5, decimal_places=2, default=0)  # নোটিশ না মানলে কর্তন %
    description          = models.TextField(blank=True)
    is_active            = models.BooleanField(default=True)
    created_at           = models.DateTimeField(auto_now_add=True)
    updated_at           = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'hr_resign_rules'
        ordering = ['id']

    def __str__(self):
        return self.name


class Resignation(models.Model):
    # কর্মচারীর পদত্যাগ রেকর্ড — approve হলে Employee.status='resigned' হয়ে যায়।
    STATUS_CHOICES = [
        ('pending', 'Pending'), ('approved', 'Approved'), ('rejected', 'Rejected'),
    ]
    employee    = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='resignations')
    resign_rule = models.ForeignKey(
        ResignRule, on_delete=models.SET_NULL, null=True, blank=True, related_name='resignations',
    )
    apply_date  = models.DateField()                 # আবেদনের তারিখ
    resign_date = models.DateField()                 # কার্যকর / শেষ কর্মদিবস
    reason      = models.TextField(blank=True)
    status      = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    remarks     = models.TextField(blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='approved_resignations',
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'hr_resignations'
        ordering = ['-apply_date', '-id']

    def __str__(self):
        return f"{self.employee_id} — {self.status} ({self.resign_date})"


class Rejoin(models.Model):
    # পূর্বে resigned কর্মচারী আবার যোগ দিলে এই রেকর্ড তৈরি হয়; create হলেই
    # Employee.status='active' হয়ে যায়, পুরনো join_date অপরিবর্তিত থাকে।
    employee             = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='rejoins')
    previous_resignation = models.ForeignKey(
        Resignation, on_delete=models.SET_NULL, null=True, blank=True, related_name='rejoins',
    )
    rejoin_date = models.DateField()
    notes       = models.TextField(blank=True)
    created_by  = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_rejoins',
    )
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'hr_rejoins'
        ordering = ['-rejoin_date', '-id']

    def __str__(self):
        return f"{self.employee_id} rejoined {self.rejoin_date}"


class CollectorCashBalance(models.Model):
    """
    Collector-এর Cash-in-Hand balance tracker।
    - Collector বিল receive করলে → cash_in_hand বাড়ে (payment এর সাথে auto-update)
    - Admin approve করলে → cash_in_hand কমে
    এই model-টি collector-এর কাছে কত টাকা আছে তা track করে।
    """
    employee     = models.OneToOneField(
        Employee, on_delete=models.CASCADE, related_name='cash_balance',
    )
    cash_in_hand = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_collected  = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_approved   = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    last_updated = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'collector_cash_balance'

    def __str__(self):
        return f"{self.employee.full_name} — Cash: {self.cash_in_hand}"


class CollectorCashTransaction(models.Model):
    """Collector cash-এর প্রতিটি movement log"""
    TYPE_CHOICES = [
        ('collected', 'Bill Collected'),   # collector বিল নিলে +
        ('approved',  'Payment Approved'), # admin approve করলে −
        ('adjusted',  'Manual Adjustment'),
    ]
    employee    = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='cash_transactions')
    txn_type    = models.CharField(max_length=20, choices=TYPE_CHOICES)
    amount      = models.DecimalField(max_digits=10, decimal_places=2)
    # collected: payment FK; approved: payment FK
    payment_id  = models.IntegerField(null=True, blank=True)
    client_name = models.CharField(max_length=200, blank=True)
    notes       = models.CharField(max_length=255, blank=True)
    created_at  = models.DateTimeField(auto_now_add=True)
    created_by  = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='collector_cash_txns',
    )

    class Meta:
        db_table = 'collector_cash_transactions'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.employee_id} — {self.txn_type} — {self.amount}"
