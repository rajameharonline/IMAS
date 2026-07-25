from rest_framework import serializers
from django.contrib.auth import get_user_model
from hr.models import (
    Department, PayHead, Payroll, PayrollPeriod, PayrollPayHead,
    Employee, Attendance, PayrollSheet, PayslipEntry, Position, PayslipPayment,
    EmployeeAdvance, AdvanceRecovery, ResignRule, Resignation, Rejoin,
)

User = get_user_model()

# পুনরাবৃত্ত literal — S1192 এড়াতে module constant
_SRC_EMP_FULL_NAME = 'employee.full_name'
_SRC_EMP_ID = 'employee.employee_id'
_SRC_EMP_DESIGNATION = 'employee.designation'


class DepartmentSerializer(serializers.ModelSerializer):
    employee_count = serializers.SerializerMethodField()

    def get_employee_count(self, obj):
        return obj.employees.filter(status='active').count()

    class Meta:
        model  = Department
        fields = ['id', 'name', 'details', 'employee_count', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']


class PayHeadSerializer(serializers.ModelSerializer):
    payhead_type_display = serializers.ReadOnlyField(source='get_payhead_type_display')

    class Meta:
        model  = PayHead
        fields = ['id', 'name', 'payhead_type', 'payhead_type_display', 'description', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']


class PayrollPeriodSerializer(serializers.ModelSerializer):
    class Meta:
        model  = PayrollPeriod
        fields = ['id', 'period_name', 'start_date', 'end_date', 'issue_date']


class PayrollPayHeadSerializer(serializers.ModelSerializer):
    payhead_name         = serializers.ReadOnlyField(source='payhead.name')
    payhead_type         = serializers.ReadOnlyField(source='payhead.payhead_type')
    payhead_type_display = serializers.ReadOnlyField(source='payhead.get_payhead_type_display')
    amount_type_display  = serializers.ReadOnlyField(source='get_amount_type_display')

    class Meta:
        model  = PayrollPayHead
        fields = ['id', 'payroll', 'payhead', 'payhead_name', 'payhead_type',
                  'payhead_type_display', 'amount_type', 'amount_type_display',
                  'unit_amount', 'created_at']
        read_only_fields = ['id', 'created_at']


class PayrollSerializer(serializers.ModelSerializer):
    payroll_type_display  = serializers.ReadOnlyField(source='get_payroll_type_display')
    payment_type_display  = serializers.ReadOnlyField(source='get_payment_type_display')
    periods_count         = serializers.SerializerMethodField()
    payheads_count        = serializers.SerializerMethodField()

    def get_periods_count(self, obj):
        return obj.periods.count()

    def get_payheads_count(self, obj):
        return obj.assigned_payheads.count()

    class Meta:
        model  = Payroll
        fields = ['id', 'name', 'payroll_type', 'payroll_type_display',
                  'payment_type', 'payment_type_display',
                  'periods_count', 'payheads_count', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']


class EmployeeSerializer(serializers.ModelSerializer):
    department_name_display = serializers.SerializerMethodField()
    payroll_name            = serializers.SerializerMethodField()
    payroll_id_val          = serializers.SerializerMethodField()
    position_name            = serializers.SerializerMethodField()

    # Optional / nullable fields — blank string এবং null দুটোই accept করবে
    gender         = serializers.CharField(required=False, allow_blank=True, default='')
    marital_status = serializers.CharField(required=False, allow_blank=True, default='')
    date_of_birth  = serializers.DateField(required=False, allow_null=True, default=None)
    in_time        = serializers.TimeField(required=False, allow_null=True, default=None)
    out_time       = serializers.TimeField(required=False, allow_null=True, default=None)
    basic_salary   = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, default=0
    )
    department     = serializers.PrimaryKeyRelatedField(
        queryset=Department.objects.all(),
        required=False, allow_null=True, default=None,
    )
    payroll        = serializers.PrimaryKeyRelatedField(
        queryset=Payroll.objects.all(),
        required=False, allow_null=True, default=None,
    )
    position       = serializers.PrimaryKeyRelatedField(
        queryset=Position.objects.all(),
        required=False, allow_null=True, default=None,
    )
    user           = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(),
        required=False, allow_null=True, default=None,
    )

    def get_department_name_display(self, obj):
        return obj.department.name if obj.department else ''

    def get_payroll_name(self, obj):
        return obj.payroll.name if obj.payroll else ''

    def get_payroll_id_val(self, obj):
        return obj.payroll.id if obj.payroll else None

    def get_position_name(self, obj):
        return obj.position.name if obj.position else ''

    class Meta:
        model = Employee
        fields = [
            'id', 'employee_id',
            'full_name', 'phone', 'office_contact', 'guardian_contact',
            'email', 'gender', 'date_of_birth', 'marital_status',
            'nid', 'facebook_link', 'reference',
            'district', 'upazila',
            'working_experience', 'present_address', 'permanent_address', 'address',
            'punch_card_id', 'in_time', 'out_time',
            'last_degree', 'institution', 'passing_year',
            'join_date', 'department', 'department_name_display',
            'payroll', 'payroll_name', 'payroll_id_val',
            'position', 'position_name',
            'designation', 'basic_salary', 'photo', 'status',
            'user', 'created_at',
        ]
        read_only_fields = ['id', 'employee_id', 'created_at',
                            'department_name_display', 'payroll_name', 'payroll_id_val',
                            'position_name']


class EmployeeUpdateSerializer(serializers.ModelSerializer):
    department_name_display = serializers.SerializerMethodField()

    def get_department_name_display(self, obj):
        return obj.department.name if obj.department else ''

    class Meta:
        model = Employee
        exclude = ['photo']
        read_only_fields = ['id', 'created_at', 'department_name_display']


class AttendanceSerializer(serializers.ModelSerializer):
    employee_name = serializers.ReadOnlyField(source=_SRC_EMP_FULL_NAME)

    class Meta:
        model = Attendance
        fields = '__all__'


class PayslipPaymentSerializer(serializers.ModelSerializer):
    received_by_name = serializers.SerializerMethodField()
    payment_method_display = serializers.ReadOnlyField(source='get_payment_method_display')

    def get_received_by_name(self, obj):
        if not obj.received_by:
            return ''
        u = obj.received_by
        return getattr(u, 'full_name', '') or u.username

    class Meta:
        model  = PayslipPayment
        fields = ['id', 'payslip', 'amount', 'payment_method', 'payment_method_display',
                  'paid_date', 'transaction_id', 'notes',
                  'received_by', 'received_by_name', 'created_at']
        read_only_fields = ['id', 'created_at', 'received_by_name', 'payment_method_display']


class PayrollSheetSerializer(serializers.ModelSerializer):
    employee_name      = serializers.ReadOnlyField(source=_SRC_EMP_FULL_NAME)
    employee_code      = serializers.ReadOnlyField(source=_SRC_EMP_ID)
    employee_phone     = serializers.ReadOnlyField(source='employee.phone')
    employee_photo     = serializers.SerializerMethodField()
    payroll_name       = serializers.SerializerMethodField()
    paid_amount        = serializers.SerializerMethodField()
    due_amount         = serializers.SerializerMethodField()
    payment_status     = serializers.SerializerMethodField()
    last_payment_date  = serializers.SerializerMethodField()
    last_payment_method = serializers.SerializerMethodField()
    payment_count      = serializers.SerializerMethodField()

    def get_employee_photo(self, obj):
        request = self.context.get('request')
        if obj.employee and obj.employee.photo:
            try:
                url = obj.employee.photo.url
                return request.build_absolute_uri(url) if request else url
            except (ValueError, AttributeError):
                return None
        return None

    def get_payroll_name(self, obj):
        pr = getattr(obj.employee, 'payroll', None)
        return pr.name if pr else ''

    def _payments(self, obj):
        # Cache per-instance to avoid duplicate queries within one serialization
        if not hasattr(obj, '_cached_payments'):
            obj._cached_payments = list(obj.payments.all())
        return obj._cached_payments

    def get_paid_amount(self, obj):
        return float(sum(p.amount for p in self._payments(obj)))

    def get_due_amount(self, obj):
        return max(float(obj.net_salary or 0) - self.get_paid_amount(obj), 0.0)

    def get_payment_status(self, obj):
        net  = float(obj.net_salary or 0)
        paid = self.get_paid_amount(obj)
        if paid <= 0:           return 'unpaid'
        if paid + 0.001 >= net: return 'paid'
        return 'partial'

    def get_last_payment_date(self, obj):
        ps = self._payments(obj)
        return ps[0].paid_date.isoformat() if ps else None

    def get_last_payment_method(self, obj):
        ps = self._payments(obj)
        return ps[0].payment_method if ps else None

    def get_payment_count(self, obj):
        return len(self._payments(obj))

    class Meta:
        model  = PayrollSheet
        fields = ['id', 'employee', 'employee_name', 'employee_code',
                  'employee_phone', 'employee_photo', 'payroll_name',
                  'month', 'basic_salary', 'bonus', 'deduction', 'net_salary',
                  'is_paid', 'paid_date', 'payment_method', 'notes',
                  'paid_amount', 'due_amount', 'payment_status',
                  'last_payment_date', 'last_payment_method', 'payment_count',
                  'created_by', 'created_at']
        read_only_fields = ['id', 'created_at', 'employee_name', 'employee_code',
                            'employee_phone', 'employee_photo', 'payroll_name',
                            'paid_amount', 'due_amount', 'payment_status',
                            'last_payment_date', 'last_payment_method', 'payment_count']


class AdvanceRecoverySerializer(serializers.ModelSerializer):
    payslip_month = serializers.SerializerMethodField()

    def get_payslip_month(self, obj):
        return obj.payslip.month if obj.payslip else None

    class Meta:
        model  = AdvanceRecovery
        fields = ['id', 'advance', 'payslip', 'payslip_month',
                  'amount', 'recovered_date', 'notes', 'created_at']
        read_only_fields = ['id', 'created_at', 'payslip_month']


class EmployeeAdvanceSerializer(serializers.ModelSerializer):
    employee_name        = serializers.ReadOnlyField(source=_SRC_EMP_FULL_NAME)
    received_by_name     = serializers.SerializerMethodField()
    payment_method_display = serializers.ReadOnlyField(source='get_payment_method_display')
    recovered_amount     = serializers.SerializerMethodField()
    remaining_amount     = serializers.SerializerMethodField()
    is_cleared           = serializers.SerializerMethodField()
    recoveries           = AdvanceRecoverySerializer(many=True, read_only=True)

    def get_received_by_name(self, obj):
        if not obj.received_by:
            return ''
        u = obj.received_by
        return getattr(u, 'full_name', '') or u.username

    def _recovered(self, obj):
        if not hasattr(obj, '_cached_recovered'):
            obj._cached_recovered = sum((r.amount for r in obj.recoveries.all()),
                                        type(obj.amount)('0'))
        return obj._cached_recovered

    def get_recovered_amount(self, obj):
        return float(self._recovered(obj))

    def get_remaining_amount(self, obj):
        return max(float(obj.amount) - self.get_recovered_amount(obj), 0.0)

    def get_is_cleared(self, obj):
        return self.get_remaining_amount(obj) <= 0.001

    def validate_amount(self, value):
        # Edit করার সময় amount কখনো already-recovered টাকার চেয়ে কম করা যাবে না —
        # তাহলে remaining ঋণাত্মক হয়ে যেত (recovery history অসামঞ্জস্যপূর্ণ হয়ে যাবে)।
        if self.instance is not None:
            recovered = self._recovered(self.instance)
            if value < recovered:
                raise serializers.ValidationError(
                    f'Amount ইতিমধ্যে recover হওয়া ({recovered})-এর কম করা যাবে না।'
                )
        return value

    class Meta:
        model  = EmployeeAdvance
        fields = ['id', 'employee', 'employee_name',
                  'amount', 'monthly_deduction', 'taken_date',
                  'payment_method', 'payment_method_display',
                  'transaction_id', 'notes',
                  'received_by', 'received_by_name',
                  'recovered_amount', 'remaining_amount', 'is_cleared',
                  'recoveries', 'created_at']
        read_only_fields = ['id', 'created_at', 'employee_name',
                            'received_by_name', 'payment_method_display',
                            'recovered_amount', 'remaining_amount',
                            'is_cleared', 'recoveries']


class PositionSerializer(serializers.ModelSerializer):
    # Read-only display fields
    payroll_name     = serializers.ReadOnlyField(source='payroll.name')
    supervisor_name  = serializers.ReadOnlyField(source='supervisor.full_name')
    position_type_display = serializers.ReadOnlyField(source='get_position_type_display')
    status_display   = serializers.ReadOnlyField(source='get_status_display')
    employee_count   = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model  = Position
        fields = [
            'id', 'name', 'is_permanent', 'is_seasonal',
            'position_type', 'position_type_display',
            'status', 'status_display',
            'head_count', 'bargaining_unit', 'employee_count',
            'payroll', 'payroll_name',
            'working_hour',
            'supervisor', 'supervisor_name',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at',
                            'payroll_name', 'supervisor_name',
                            'position_type_display', 'status_display', 'employee_count']


class PayslipEntrySerializer(serializers.ModelSerializer):
    payhead_type_display = serializers.SerializerMethodField()

    def get_payhead_type_display(self, obj):
        return 'Addition' if obj.payhead_type == 'addition' else 'Deduction'

    class Meta:
        model  = PayslipEntry
        fields = ['id','payslip','payhead','payhead_name','payhead_type',
                  'payhead_type_display','amount_type','unit_amount','final_amount']
        read_only_fields = ['id','payslip','payhead_name','payhead_type',
                            'payhead_type_display']


class PayrollSheetDetailSerializer(serializers.ModelSerializer):
    entries           = PayslipEntrySerializer(many=True, read_only=True)
    payments          = PayslipPaymentSerializer(many=True, read_only=True)
    employee_name     = serializers.ReadOnlyField(source=_SRC_EMP_FULL_NAME)
    employee_id_code  = serializers.ReadOnlyField(source=_SRC_EMP_ID)
    employee_phone    = serializers.ReadOnlyField(source='employee.phone')
    employee_email    = serializers.ReadOnlyField(source='employee.email')
    employee_designation = serializers.ReadOnlyField(source=_SRC_EMP_DESIGNATION)
    payroll_name      = serializers.SerializerMethodField()
    total_addition    = serializers.SerializerMethodField()
    total_deduction   = serializers.SerializerMethodField()
    paid_amount       = serializers.SerializerMethodField()
    due_amount        = serializers.SerializerMethodField()
    payment_status    = serializers.SerializerMethodField()

    def get_payroll_name(self, obj):
        pr = getattr(obj.employee, 'payroll', None)
        return pr.name if pr else ''

    def get_total_addition(self, obj):
        return float(sum(e.final_amount for e in obj.entries.all() if e.payhead_type == 'addition'))

    def get_total_deduction(self, obj):
        return float(sum(e.final_amount for e in obj.entries.all() if e.payhead_type == 'deduction'))

    def get_paid_amount(self, obj):
        return float(sum(p.amount for p in obj.payments.all()))

    def get_due_amount(self, obj):
        return max(float(obj.net_salary or 0) - self.get_paid_amount(obj), 0.0)

    def get_payment_status(self, obj):
        net  = float(obj.net_salary or 0)
        paid = self.get_paid_amount(obj)
        if paid <= 0:           return 'unpaid'
        if paid + 0.001 >= net: return 'paid'
        return 'partial'

    class Meta:
        model  = PayrollSheet
        fields = ['id','employee','employee_name','employee_id_code','employee_phone',
                  'employee_email','employee_designation','payroll_name',
                  'month','basic_salary','bonus','deduction','net_salary',
                  'is_paid','paid_date','payment_method','notes','created_at',
                  'entries','payments','total_addition','total_deduction',
                  'paid_amount','due_amount','payment_status']
        read_only_fields = ['id','created_at']


class ResignRuleSerializer(serializers.ModelSerializer):
    # পদত্যাগ নীতি CRUD — Resignation আবেদনে dropdown হিসেবে ব্যবহৃত হয়
    class Meta:
        model = ResignRule
        fields = ['id', 'name', 'notice_period_days', 'deduction_percentage',
                  'description', 'is_active', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']


class ResignationSerializer(serializers.ModelSerializer):
    # পদত্যাগ রেকর্ড — list/form-এ employee ও rule-এর readable নাম সহ
    employee_name    = serializers.ReadOnlyField(source=_SRC_EMP_FULL_NAME)
    employee_code    = serializers.ReadOnlyField(source=_SRC_EMP_ID)
    employee_designation = serializers.ReadOnlyField(source=_SRC_EMP_DESIGNATION)
    resign_rule_name = serializers.ReadOnlyField(source='resign_rule.name')
    status_display   = serializers.ReadOnlyField(source='get_status_display')
    approved_by_name = serializers.SerializerMethodField()

    def get_approved_by_name(self, obj):
        if not obj.approved_by:
            return ''
        u = obj.approved_by
        return getattr(u, 'full_name', '') or u.username

    class Meta:
        model = Resignation
        fields = ['id', 'employee', 'employee_name', 'employee_code', 'employee_designation',
                  'resign_rule', 'resign_rule_name', 'apply_date', 'resign_date',
                  'reason', 'status', 'status_display', 'remarks',
                  'approved_by', 'approved_by_name', 'approved_at', 'created_at']
        read_only_fields = ['id', 'approved_by', 'approved_at', 'created_at',
                            'employee_name', 'employee_code', 'employee_designation',
                            'resign_rule_name', 'status_display', 'approved_by_name']


class RejoinSerializer(serializers.ModelSerializer):
    # পুনঃযোগদান রেকর্ড — list/form-এ employee ও previous resignation-এর readable info সহ
    employee_name        = serializers.ReadOnlyField(source=_SRC_EMP_FULL_NAME)
    employee_code        = serializers.ReadOnlyField(source=_SRC_EMP_ID)
    employee_designation = serializers.ReadOnlyField(source=_SRC_EMP_DESIGNATION)
    previous_resign_date = serializers.ReadOnlyField(source='previous_resignation.resign_date')
    created_by_name      = serializers.SerializerMethodField()

    def get_created_by_name(self, obj):
        if not obj.created_by:
            return ''
        u = obj.created_by
        return getattr(u, 'full_name', '') or u.username

    class Meta:
        model = Rejoin
        fields = ['id', 'employee', 'employee_name', 'employee_code', 'employee_designation',
                  'previous_resignation', 'previous_resign_date',
                  'rejoin_date', 'notes',
                  'created_by', 'created_by_name', 'created_at']
        read_only_fields = ['id', 'created_by', 'created_at',
                            'employee_name', 'employee_code', 'employee_designation',
                            'previous_resign_date', 'created_by_name']
