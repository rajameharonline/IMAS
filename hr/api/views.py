from rest_framework import viewsets, permissions, status as drf_status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from django.db.models import Count, Sum, Q
from django.utils import timezone
from hr.models import (
    Department, PayHead, Payroll, PayrollPeriod, PayrollPayHead,
    Employee, Attendance, PayrollSheet, PayslipEntry, Position,
    PayslipPayment, EmployeeAdvance, AdvanceRecovery, ResignRule, Resignation, Rejoin,
)
from hr.api.serializers import (
    DepartmentSerializer, PayHeadSerializer,
    PayrollSerializer, PayrollPeriodSerializer, PayrollPayHeadSerializer,
    EmployeeSerializer, EmployeeUpdateSerializer,
    AttendanceSerializer, PayrollSheetSerializer,
    PayslipEntrySerializer, PayrollSheetDetailSerializer,
    PositionSerializer, PayslipPaymentSerializer,
    EmployeeAdvanceSerializer, AdvanceRecoverySerializer,
    ResignRuleSerializer, ResignationSerializer, RejoinSerializer,
)


class HRPagination(PageNumberPagination):
    """HR মডিউলের সব লিস্ট এন্ডপয়েন্টে ?page_size= সাপোর্ট করার জন্য (ডিফল্ট PAGE_SIZE=20 এ silently truncate হত)।"""
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 2000


class DepartmentViewSet(viewsets.ModelViewSet):
    queryset = Department.objects.annotate(
        employee_count=Count('employees', filter=Q(employees__status='active'))
    ).order_by('id')
    serializer_class = DepartmentSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = HRPagination
    search_fields = ['name', 'details']
    ordering_fields = ['id', 'name', 'created_at']


class PayHeadViewSet(viewsets.ModelViewSet):
    queryset = PayHead.objects.all().order_by('id')
    serializer_class = PayHeadSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = HRPagination
    search_fields = ['name', 'description']
    ordering_fields = ['id', 'name', 'payhead_type']


class PayrollViewSet(viewsets.ModelViewSet):
    queryset = Payroll.objects.all().order_by('id')
    serializer_class = PayrollSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = HRPagination
    search_fields = ['name']
    ordering_fields = ['id', 'name', 'payroll_type']

    # ── periods: GET লোড, POST bulk-save ─────────────────────────────
    @action(detail=True, methods=['get', 'post'], url_path='periods')
    def periods(self, request, pk=None):
        payroll = self.get_object()
        if request.method == 'GET':
            return Response(PayrollPeriodSerializer(payroll.periods.all(), many=True).data)

        periods_data = request.data.get('periods', [])
        payroll_type = request.data.get('payroll_type')
        if payroll_type:
            payroll.payroll_type = payroll_type
            payroll.save(update_fields=['payroll_type'])

        # Bulk replace: পুরনো মুছে নতুন তৈরি করো
        payroll.periods.all().delete()
        created = []
        for p in periods_data:
            period = PayrollPeriod(
                payroll=payroll,
                period_name=p.get('period_name', ''),
                start_date=p.get('start_date'),
                end_date=p.get('end_date'),
                issue_date=p.get('issue_date'),
            )
            created.append(period)
        PayrollPeriod.objects.bulk_create(created)
        return Response({'saved': len(created)})

    # ── payheads: GET লোড, POST assign ──────────────────────────────
    @action(detail=True, methods=['get', 'post'], url_path='payheads')
    def payheads(self, request, pk=None):
        payroll = self.get_object()
        if request.method == 'GET':
            qs = payroll.assigned_payheads.select_related('payhead').all()
            return Response(PayrollPayHeadSerializer(qs, many=True).data)

        payhead_id  = request.data.get('payhead')
        amount_type = request.data.get('amount_type', 'amount')
        unit_amount = request.data.get('unit_amount', 0)
        if not payhead_id:
            return Response({'error': 'payhead required.'}, status=400)

        obj, created = PayrollPayHead.objects.get_or_create(
            payroll=payroll, payhead_id=payhead_id,
            defaults={'amount_type': amount_type, 'unit_amount': unit_amount},
        )
        if not created:
            obj.amount_type = amount_type
            obj.unit_amount = unit_amount
            obj.save()
        return Response(PayrollPayHeadSerializer(obj).data, status=201 if created else 200)

    # ── payhead update ───────────────────────────────────────────────
    @action(detail=True, methods=['patch'], url_path=r'payheads/(?P<ph_id>[^/.]+)/update')
    def update_payhead(self, request, pk=None, ph_id=None):
        payroll = self.get_object()
        try:
            obj = PayrollPayHead.objects.get(id=ph_id, payroll=payroll)
        except PayrollPayHead.DoesNotExist:
            return Response({'error': 'Not found.'}, status=404)
        if 'unit_amount' in request.data:
            obj.unit_amount = request.data['unit_amount']
        if 'amount_type' in request.data:
            obj.amount_type = request.data['amount_type']
        obj.save()
        return Response(PayrollPayHeadSerializer(obj).data)

    # ── payhead remove ───────────────────────────────────────────────
    @action(detail=True, methods=['delete'], url_path=r'payheads/(?P<ph_id>[^/.]+)/remove')
    def remove_payhead(self, request, pk=None, ph_id=None):
        payroll = self.get_object()
        deleted, _ = PayrollPayHead.objects.filter(id=ph_id, payroll=payroll).delete()
        return Response({'deleted': deleted})


class EmployeeViewSet(viewsets.ModelViewSet):
    queryset = Employee.objects.all().order_by('-created_at')
    serializer_class = EmployeeSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = HRPagination
    filterset_fields = ['status', 'department', 'gender']
    search_fields = ['employee_id', 'full_name', 'phone', 'email', 'designation']
    ordering_fields = ['join_date', 'full_name', 'basic_salary', 'created_at']

    def get_serializer_class(self):
        if self.action in ['update', 'partial_update']:
            return EmployeeUpdateSerializer
        return EmployeeSerializer

    @staticmethod
    def _next_employee_id():
        last = (
            Employee.objects.filter(employee_id__regex=r'^EMP-\d+$')
            .order_by('-employee_id')
            .values_list('employee_id', flat=True)
            .first()
        )
        try:
            next_num = int(last[4:]) + 1 if last else 1
        except (TypeError, ValueError):
            next_num = 1
        while Employee.objects.filter(employee_id=f'EMP-{next_num:05d}').exists():
            next_num += 1
        return f'EMP-{next_num:05d}'

    def perform_create(self, serializer):
        serializer.save(employee_id=self._next_employee_id())

    @action(detail=False, methods=['get'], url_path='me')
    def me(self, request):
        # লগইন করা ইউজারের নিজের Employee profile + চলতি মাসের salary summary।
        # Employee Panel dashboard-এ profile card + salary sheet দেখাতে ব্যবহৃত।
        emp = (
            Employee.objects
            .filter(user=request.user)
            .select_related('payroll', 'department')
            .first()
        )
        if not emp:
            return Response(
                {'detail': 'এই ইউজারের সাথে কোনো Employee profile যুক্ত নেই।'},
                status=drf_status.HTTP_404_NOT_FOUND,
            )
        data = EmployeeSerializer(emp, context={'request': request}).data
        # চলতি মাসের payslip (থাকলে) — salary card-এ live amount দেখাতে
        month = timezone.now().strftime('%Y-%m')
        current = (
            PayrollSheet.objects
            .filter(employee=emp, month=month)
            .prefetch_related('payments')
            .first()
        )
        data['current_payslip'] = (
            PayrollSheetSerializer(current, context={'request': request}).data
            if current else None
        )
        # সাম্প্রতিক ৬ মাসের payslip history
        recent = (
            PayrollSheet.objects
            .filter(employee=emp)
            .select_related('employee', 'employee__payroll')
            .prefetch_related('payments')
            .order_by('-month')[:6]
        )
        data['recent_payslips'] = PayrollSheetSerializer(
            recent, many=True, context={'request': request}
        ).data
        return Response(data)

    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request):
        data = Employee.objects.aggregate(
            total=Count('id'),
            active=Count('id', filter=Q(status='active')),
            inactive=Count('id', filter=Q(status='inactive')),
            resigned=Count('id', filter=Q(status='resigned')),
            total_salary=Sum('basic_salary', filter=Q(status='active')),
        )
        depts = list(
            Employee.objects.filter(status='active', department__isnull=False)
            .values_list('department_id', flat=True)
            .distinct()
        )
        data['departments'] = depts
        return Response(data)


class AttendanceViewSet(viewsets.ModelViewSet):
    queryset = Attendance.objects.select_related('employee').all()
    serializer_class = AttendanceSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = HRPagination
    filterset_fields = ['employee', 'date', 'status']
    ordering = ['-date', 'employee_id']

    # ── এক তারিখে অনেক employee-এর হাজিরা একসাথে সেভ/আপডেট ───────────────
    @action(detail=False, methods=['post'], url_path='bulk')
    def bulk(self, request):
        """payload: { date, records: [{employee, status, check_in, check_out, notes}] }
        প্রতিটি (employee, date)-এ update_or_create — unique_together মেনে।
        """
        date = request.data.get('date')
        records = request.data.get('records', [])
        if not date:
            return Response({'error': 'date আবশ্যক'}, status=400)
        saved = 0
        for r in records:
            emp_id = r.get('employee')
            if not emp_id:
                continue
            Attendance.objects.update_or_create(
                employee_id=emp_id, date=date,
                defaults={
                    'status':    r.get('status') or 'present',
                    'check_in':  r.get('check_in') or None,
                    'check_out': r.get('check_out') or None,
                    'notes':     r.get('notes') or '',
                },
            )
            saved += 1
        return Response({'date': date, 'saved': saved}, status=200)


def _resolve_basic_salary(basic_override, emp):
    """basic salary — override > employee.basic_salary (parse fail-safe)।"""
    from decimal import Decimal
    try:
        return Decimal(str(basic_override)) if basic_override not in (None, '') \
            else Decimal(str(emp.basic_salary or 0))
    except Exception:
        return Decimal(str(emp.basic_salary or 0))


def _payslip_items(custom_payheads, emp):
    """payhead source — explicit custom > payroll defaults > []।"""
    if custom_payheads:
        return custom_payheads
    if emp.payroll:
        return [
            {
                'payhead': pp.payhead_id,
                'amount_type': pp.amount_type,
                'unit_amount': pp.unit_amount,
            }
            for pp in PayrollPayHead.objects.filter(payroll=emp.payroll)
                                            .select_related('payhead')
        ]
    return []


def _build_payslip_entries(sheet, basic, items):
    """items থেকে PayslipEntry list + total_add/total_ded (total_add basic দিয়ে শুরু)।
    Returns (entries, total_add, total_ded)।"""
    from decimal import Decimal
    total_add = basic
    total_ded = Decimal('0')
    entries = []
    for it in items:
        try:
            ph = PayHead.objects.get(id=it.get('payhead'))
        except PayHead.DoesNotExist:
            continue
        amt_type = it.get('amount_type') or 'amount'
        try:
            unit = Decimal(str(it.get('unit_amount') or 0))
        except Exception:
            unit = Decimal('0')
        final = basic * unit / Decimal('100') if amt_type == 'percentage' else unit
        entries.append(PayslipEntry(
            payslip=sheet, payhead=ph,
            payhead_name=ph.name, payhead_type=ph.payhead_type,
            amount_type=amt_type, unit_amount=unit, final_amount=final,
        ))
        if ph.payhead_type == 'addition':
            total_add += final
        else:
            total_ded += final
    return entries, total_add, total_ded


def _apply_advance_recovery(emp, sheet, month):
    """Employee-এর active advance থেকে monthly_deduction (বা পুরোটা) কেটে PayslipEntry
    (deduction) + AdvanceRecovery audit। Returns total recovered amount।"""
    from decimal import Decimal
    from datetime import datetime as _dt
    try:
        issue_date = _dt.strptime(f'{month}-01', '%Y-%m-%d').date()
    except ValueError:
        issue_date = timezone.now().date()
    recovered_total = Decimal('0')
    adv_qs = (
        EmployeeAdvance.objects.filter(employee=emp)
        .prefetch_related('recoveries')
        .order_by('taken_date', 'id')
    )
    for adv in adv_qs:
        recovered_so_far = sum((r.amount for r in adv.recoveries.all()), Decimal('0'))
        remaining = adv.amount - recovered_so_far
        if remaining <= 0:
            continue
        per_month = Decimal(str(adv.monthly_deduction or 0))
        recover = remaining if per_month <= 0 else min(per_month, remaining)
        if recover <= 0:
            continue
        PayslipEntry.objects.create(
            payslip=sheet, payhead=None,
            payhead_name=f'Advance Recovery (Adv#{adv.id})',
            payhead_type='deduction',
            amount_type='amount', unit_amount=recover, final_amount=recover,
        )
        AdvanceRecovery.objects.create(
            advance=adv, payslip=sheet,
            amount=recover, recovered_date=issue_date,
            notes=f'Auto from payslip #{sheet.id} ({month})',
        )
        recovered_total += recover
    return recovered_total


def _resolve_pay_amount(raw_amt, due):
    """pay amount parse + validate → (amount, error_msg); error_msg None হলে ok।
    খালি হলে remaining due full নেওয়া হয়। due-এর বেশি amount দেওয়া নিষেধ নয় —
    সেই অতিরিক্ত অংশ পরে employee-এর advance balance-এ যোগ হয় (দেখুন `pay()`)।"""
    from decimal import Decimal
    try:
        amount = Decimal(str(raw_amt)) if str(raw_amt).strip() else due
    except Exception:
        return None, 'Amount সঠিক নয়'
    if amount <= 0:
        return None, 'Amount > 0 হতে হবে'
    return amount, None


def _resolve_paid_date(paid_date_str):
    """paid_date string parse; invalid/খালি হলে আজ।"""
    from datetime import datetime
    try:
        return (datetime.strptime(paid_date_str, '%Y-%m-%d').date()
                if paid_date_str else timezone.now().date())
    except ValueError:
        return timezone.now().date()


def _resolve_pay_received_by(request):
    """received_by — explicit user id, নাহলে request.user।"""
    rb_id = request.data.get('received_by')
    received_by = None
    if rb_id:
        from django.contrib.auth import get_user_model
        try:
            received_by = get_user_model().objects.get(id=rb_id)
        except get_user_model().DoesNotExist:
            received_by = None
    if not received_by and request.user.is_authenticated:
        received_by = request.user
    return received_by


def _create_payslip_for_employee(emp, month, user):
    """একজন employee-র জন্য payslip + payroll-default entries তৈরি করে sheet ফেরায়
    (net_salary = total addition − deduction)। generate_all bulk-এ ব্যবহৃত।"""
    from decimal import Decimal
    basic = Decimal(str(emp.basic_salary or 0))
    sheet = PayrollSheet.objects.create(
        employee=emp, month=month,
        basic_salary=basic, bonus=0, deduction=0,
        net_salary=basic,
        created_by=user if user.is_authenticated else None,
    )
    # payroll-এর default payhead গুলো থেকে entries build (custom নেই)
    entries, total_add, total_ded = _build_payslip_entries(
        sheet, basic, _payslip_items(None, emp),
    )
    PayslipEntry.objects.bulk_create(entries)
    sheet.net_salary = total_add - total_ded
    sheet.save(update_fields=['net_salary'])
    return sheet


class PayrollSheetViewSet(viewsets.ModelViewSet):
    """Payslip Manager — PayrollSheet CRUD + generate/pay/cancel/entries"""
    queryset = PayrollSheet.objects.select_related('employee', 'employee__payroll').all()
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = HRPagination
    filterset_fields = ['employee', 'month', 'is_paid']

    def get_serializer_class(self):
        if self.action in ['retrieve', 'entries']:
            return PayrollSheetDetailSerializer
        return PayrollSheetSerializer

    # ── Net recompute helper ─────────────────────────────────────────────
    # basic_salary বা কোনো entry বদলালে net_salary নতুন করে হিসাব করতে হয়।
    # percentage-ভিত্তিক entry-এর final_amount basic-এর উপর নির্ভর করে, তাই
    # basic বদলালে সেগুলোর final-ও পুনরায় হিসাব করে fresh রাখি — না হলে
    # net_salary পুরনো থেকে যায় (এই কারণেই row-তে 0.00 দেখাচ্ছিল)।
    @staticmethod
    def _recompute_net(sheet):
        from decimal import Decimal
        basic = Decimal(str(sheet.basic_salary or 0))
        total_add = basic
        total_ded = Decimal('0')
        for e in sheet.entries.all():
            unit = Decimal(str(e.unit_amount or 0))
            # percentage হলে basic-এর শতাংশ; অন্যথায় unit-ই final
            final = basic * unit / Decimal('100') if e.amount_type == 'percentage' else unit
            if Decimal(str(e.final_amount)) != final:
                e.final_amount = final
                e.save(update_fields=['final_amount'])
            if e.payhead_type == 'addition':
                total_add += final
            else:
                total_ded += final
        sheet.net_salary = total_add - total_ded
        sheet.save(update_fields=['net_salary'])
        return sheet

    def perform_update(self, serializer):
        # PATCH/PUT (যেমন basic_salary edit) করার পর net_salary recompute করি —
        # default ModelViewSet শুধু field save করত, net পুরনো থেকে যেত।
        sheet = serializer.save()
        self._recompute_net(sheet)

    # ── Payslip Generate ─────────────────────────────────────────────────
    @action(detail=False, methods=['post'], url_path='generate')
    def generate(self, request):
        """payslip তৈরি করে। Optional `payheads` list দিলে সেই custom set
        ব্যবহার হবে; না দিলে employee-এর payroll-এর default payheads,
        সেটাও না থাকলে শুধু basic_salary।
        payheads item: {payhead, amount_type, unit_amount}
        """
        emp_id  = request.data.get('employee')
        month   = request.data.get('month')   # YYYY-MM
        basic_override = request.data.get('basic_salary')
        custom_payheads = request.data.get('payheads')  # optional list
        if not emp_id or not month:
            return Response({'error': 'employee ও month আবশ্যক'}, status=400)

        try:
            emp = Employee.objects.get(id=emp_id)
        except Employee.DoesNotExist:
            return Response({'error': 'Employee পাওয়া যায়নি'}, status=404)

        # ডুপ্লিকেট চেক — existing থাকলে রিটার্ন করি, কিন্তু custom payheads
        # পাঠানো হলে সেটা ভুল ধরে নেই (user নতুন generate চাইছে)
        existing = PayrollSheet.objects.filter(employee=emp, month=month).first()
        if existing and not custom_payheads:
            return Response(PayrollSheetDetailSerializer(existing).data)
        if existing and custom_payheads:
            return Response(
                {'error': f'{month}-এ ইতিমধ্যে payslip আছে — Edit modal থেকে সংশোধন করুন'},
                status=400,
            )

        # Basic salary — override > employee.basic_salary
        basic = _resolve_basic_salary(basic_override, emp)

        sheet = PayrollSheet.objects.create(
            employee=emp, month=month,
            basic_salary=basic, bonus=0, deduction=0,
            net_salary=basic,
            created_by=request.user if request.user.is_authenticated else None,
        )

        # payheads (custom > payroll defaults) → entries + totals
        entries, total_add, total_ded = _build_payslip_entries(
            sheet, basic, _payslip_items(custom_payheads, emp))
        if entries:
            PayslipEntry.objects.bulk_create(entries)

        # ─── Auto Advance Recovery — active advance থেকে monthly deduction ──
        total_ded += _apply_advance_recovery(emp, sheet, month)

        sheet.net_salary = total_add - total_ded
        sheet.save(update_fields=['net_salary'])
        return Response(PayrollSheetDetailSerializer(sheet).data, status=201)

    # ── List payslips for employee ───────────────────────────────────────
    @action(detail=False, methods=['get'], url_path='by-employee')
    def by_employee(self, request):
        emp_id = request.query_params.get('employee')
        if not emp_id:
            return Response({'error': 'employee param আবশ্যক'}, status=400)
        sheets = (
            PayrollSheet.objects.filter(employee_id=emp_id)
            .select_related('employee', 'employee__payroll')
            .prefetch_related('payments')
            .order_by('-month')
        )
        return Response(
            PayrollSheetSerializer(sheets, many=True, context={'request': request}).data
        )

    # ── Assignable payheads for Pay Slip modal "+ Add Payhead" ───────────
    @action(detail=False, methods=['get'], url_path='assignable-payheads')
    def assignable_payheads(self, request):
        """Pay Slip modal-এর "+ Add Payhead" dropdown-এর source।
        Employee-এর payroll-এ assign করা payhead (amount সহ) ফেরত দেয় —
        amount আগেই Payroll config-এ entry করা, তাই নতুন করে দিতে হয় না।
        Employee-এর payroll না থাকলে একমাত্র payroll fallback (single-payroll setup)।
        """
        emp_id = request.query_params.get('employee')
        payroll = None
        if emp_id:
            emp = Employee.objects.filter(id=emp_id).select_related('payroll').first()
            if emp and emp.payroll_id:
                payroll = emp.payroll
        if payroll is None and Payroll.objects.count() == 1:
            payroll = Payroll.objects.first()
        if payroll is None:
            return Response([])
        qs = PayrollPayHead.objects.filter(payroll=payroll).select_related('payhead')
        return Response(PayrollPayHeadSerializer(qs, many=True).data)

    # ── Pay payslip (partial-aware) ─────────────────────────────────────
    @action(detail=True, methods=['post'], url_path='pay')
    def pay(self, request, pk=None):
        """একটি payslip-এ payment record যোগ করে।
        amount দিলে partial; না দিলে remaining due full হবে।
        Multiple call করলে multiple installment record হবে।

        net_salary-র due-এর চেয়ে বেশি amount দেওয়া হলে (বা payslip আগে থেকেই
        সম্পূর্ণ পরিশোধিত থাকা অবস্থায় আবার payment দিলে) অতিরিক্ত অংশ ফেরত না
        দিয়ে employee-এর advance balance-এ যোগ হয়ে যায় — একটি নতুন
        `EmployeeAdvance` রেকর্ড তৈরি হয় (client billing-এর overpayment →
        advance_balance ঠিক এই একই প্যাটার্ন), যা পরবর্তী মাসের payslip
        generate/apply-advance-এ স্বয়ংক্রিয়ভাবে recover হবে।
        """
        from decimal import Decimal

        sheet = self.get_object()
        net   = Decimal(str(sheet.net_salary or 0))
        paid  = sum((p.amount for p in sheet.payments.all()), Decimal('0'))
        due   = max(net - paid, Decimal('0'))

        # Amount: pay_amount / amount দুটোই accept (frontend backward compat)
        raw_amt = request.data.get('amount', request.data.get('pay_amount', ''))
        amount, err = _resolve_pay_amount(raw_amt, due)
        if err:
            return Response({'error': err}, status=400)

        paid_date   = _resolve_paid_date(request.data.get('paid_date', ''))
        received_by = _resolve_pay_received_by(request)
        method      = request.data.get('payment_method', 'cash')
        remarks     = request.data.get('remarks', '') or request.data.get('notes', '')
        txn_id      = request.data.get('transaction_id', '')

        payslip_amount = min(amount, due)   # এই payslip-এর due-তে যা প্রযোজ্য হবে
        excess_amount  = amount - payslip_amount  # due-এর অতিরিক্ত অংশ

        payment = None
        if payslip_amount > 0:
            payment = PayslipPayment.objects.create(
                payslip=sheet, amount=payslip_amount,
                payment_method=method, paid_date=paid_date,
                transaction_id=txn_id, notes=remarks,
                received_by=received_by,
            )

        advance = None
        if excess_amount > 0:
            advance = EmployeeAdvance.objects.create(
                employee=sheet.employee, amount=excess_amount, monthly_deduction=0,
                taken_date=paid_date, payment_method=method, transaction_id=txn_id,
                notes=(f'Salary overpayment থেকে auto-advance — payslip #{sheet.id} ({sheet.month})'
                       + (f' — {remarks}' if remarks else '')),
                received_by=received_by,
            )

        # Sheet-level summary fields update (legacy compat)
        total_paid = paid + payslip_amount
        sheet.is_paid        = total_paid > 0 and total_paid + Decimal('0.001') >= net
        sheet.paid_date      = paid_date if sheet.is_paid else (sheet.paid_date or paid_date)
        sheet.payment_method = method
        sheet.save(update_fields=['is_paid', 'paid_date', 'payment_method'])

        result = {
            'payslip': PayrollSheetSerializer(sheet, context={'request': request}).data,
        }
        if payment:
            result['payment'] = PayslipPaymentSerializer(payment).data
        if advance:
            result['advance'] = EmployeeAdvanceSerializer(advance).data
            result['excess_added_to_advance'] = float(excess_amount)
        return Response(result, status=201)

    # ── List payments for a payslip ──────────────────────────────────────
    @action(detail=True, methods=['get'], url_path='payments')
    def payments(self, request, pk=None):
        sheet = self.get_object()
        qs = sheet.payments.select_related('received_by').all()
        return Response(PayslipPaymentSerializer(qs, many=True).data)

    # ── Edit a single payment record ──────────────────────────────────────
    @action(detail=True, methods=['patch'],
            url_path=r'payments/(?P<pay_id>[^/.]+)/edit')
    def edit_payment(self, request, pk=None, pay_id=None):
        """একটি PayslipPayment-এর amount/method/date/txn/notes/received_by সংশোধন করে।
        Note: এই edit accounting ledger-এ retroactively post হয় না — ledger শুধু
        payment তৈরি হওয়ার সময় একবার post হয় (`hr/ledger.py`)।"""
        from decimal import Decimal

        sheet = self.get_object()
        try:
            pay = PayslipPayment.objects.get(id=pay_id, payslip=sheet)
        except PayslipPayment.DoesNotExist:
            return Response({'error': 'Payment পাওয়া যায়নি'}, status=404)

        if 'amount' in request.data:
            try:
                amount = Decimal(str(request.data.get('amount')))
            except Exception:
                return Response({'error': 'Amount সঠিক নয়'}, status=400)
            if amount <= 0:
                return Response({'error': 'Amount > 0 হতে হবে'}, status=400)
            pay.amount = amount
        if 'payment_method' in request.data:
            pay.payment_method = request.data.get('payment_method') or pay.payment_method
        if 'paid_date' in request.data:
            paid_date = _resolve_paid_date(request.data.get('paid_date', ''))
            pay.paid_date = paid_date
        if 'transaction_id' in request.data:
            pay.transaction_id = request.data.get('transaction_id', '')
        if 'notes' in request.data or 'remarks' in request.data:
            pay.notes = request.data.get('notes', request.data.get('remarks', ''))
        if 'received_by' in request.data:
            received_by = _resolve_pay_received_by(request)
            pay.received_by = received_by
        pay.save()

        net = Decimal(str(sheet.net_salary or 0))
        total_paid = sum((p.amount for p in sheet.payments.all()), Decimal('0'))
        sheet.is_paid = total_paid + Decimal('0.001') >= net and total_paid > 0
        if not sheet.is_paid:
            sheet.paid_date = None
        sheet.save(update_fields=['is_paid', 'paid_date'])

        return Response({
            'payment': PayslipPaymentSerializer(pay).data,
            'payslip': PayrollSheetSerializer(sheet, context={'request': request}).data,
        })

    # ── Delete a single payment record ───────────────────────────────────
    @action(detail=True, methods=['delete'],
            url_path=r'payments/(?P<pay_id>[^/.]+)/remove')
    def remove_payment(self, request, pk=None, pay_id=None):
        from decimal import Decimal
        sheet = self.get_object()
        try:
            pay = PayslipPayment.objects.get(id=pay_id, payslip=sheet)
        except PayslipPayment.DoesNotExist:
            return Response({'error': 'Payment পাওয়া যায়নি'}, status=404)
        pay.delete()
        net = Decimal(str(sheet.net_salary or 0))
        total_paid = sum((p.amount for p in sheet.payments.all()), Decimal('0'))
        sheet.is_paid = total_paid + Decimal('0.001') >= net and total_paid > 0
        if not sheet.is_paid:
            sheet.paid_date = None
        sheet.save(update_fields=['is_paid', 'paid_date'])
        return Response({'deleted': 1})

    # ── Cancel payslip ───────────────────────────────────────────────────
    @action(detail=True, methods=['delete'], url_path='cancel')
    def cancel(self, request, pk=None):
        sheet = self.get_object()
        if sheet.payments.exists():
            return Response(
                {'error': 'যে payslip-এ payment হয়েছে সেটা বাতিল করা যাবে না'},
                status=400,
            )
        # Reverse advance recoveries — payslip CASCADE-এ delete হলেও
        # AdvanceRecovery.payslip SET_NULL হয়; এখানে explicit delete করি
        # যাতে advance balance ফিরে আসে।
        AdvanceRecovery.objects.filter(payslip=sheet).delete()
        sheet.delete()
        return Response({'message': 'Payslip বাতিল হয়েছে'})

    # ── Apply Advance Recovery to existing payslip ───────────────────────
    @action(detail=True, methods=['post'], url_path='apply-advance')
    def apply_advance(self, request, pk=None):
        """ইতিমধ্যে তৈরি payslip-এ employee-এর এখনো recover হয়নি এমন advance
        কেটে নেয় — প্রতিটি advance-এর জন্য একটি deduction PayslipEntry +
        AdvanceRecovery audit row তৈরি করে, তারপর net_salary recompute করে।

        Idempotent: এই payslip-এ যে advance ইতিমধ্যে recover হয়েছে সেটা আবার
        কাটে না (double-recovery ঠেকাতে)। ম্যানুয়াল edit অক্ষত থাকে।
        """
        from decimal import Decimal
        from datetime import datetime as _dt

        sheet = self.get_object()
        emp = sheet.employee

        # এই payslip-এ already recover করা advance বাদ দিই
        already = set(
            AdvanceRecovery.objects.filter(payslip=sheet).values_list('advance_id', flat=True)
        )

        try:
            issue_date = _dt.strptime(f'{sheet.month}-01', '%Y-%m-%d').date()
        except ValueError:
            issue_date = timezone.now().date()

        adv_qs = (
            EmployeeAdvance.objects.filter(employee=emp)
            .prefetch_related('recoveries')
            .order_by('taken_date', 'id')
        )
        applied = Decimal('0')
        for adv in adv_qs:
            if adv.id in already:
                continue
            recovered_so_far = sum((r.amount for r in adv.recoveries.all()), Decimal('0'))
            remaining = adv.amount - recovered_so_far
            if remaining <= 0:
                continue
            per_month = Decimal(str(adv.monthly_deduction or 0))
            recover = remaining if per_month <= 0 else min(per_month, remaining)
            if recover <= 0:
                continue

            PayslipEntry.objects.create(
                payslip=sheet, payhead=None,
                payhead_name=f'Advance Recovery (Adv#{adv.id})',
                payhead_type='deduction',
                amount_type='amount', unit_amount=recover, final_amount=recover,
            )
            AdvanceRecovery.objects.create(
                advance=adv, payslip=sheet,
                amount=recover, recovered_date=issue_date,
                notes=f'Applied to payslip #{sheet.id} ({sheet.month})',
            )
            applied += recover

        self._recompute_net(sheet)
        return Response({
            'applied': float(applied),
            'payslip': PayrollSheetDetailSerializer(sheet).data,
        })

    # ── Bulk Generate for a Month ────────────────────────────────────────
    @action(detail=False, methods=['post'], url_path='generate-all')
    def generate_all(self, request):
        """চলতি/নির্দিষ্ট মাসের active employee-দের জন্য payslip তৈরি করে।
        - month (YYYY-MM) না দিলে আজকের মাস ধরা হয়।
        - employee_ids দিলে শুধু সেই subset, না দিলে সব active employee যাদের
          payroll assigned আছে।
        - ইতিমধ্যে existing payslip থাকলে skip হবে।
        """
        from decimal import Decimal
        month = request.data.get('month') or timezone.now().date().strftime('%Y-%m')
        emp_ids = request.data.get('employee_ids') or []

        # Payroll না থাকলেও basic_salary দিয়ে fallback সম্ভব,
        # তাই কেবল active filter — explicit subset হলে status filter-ও skip
        if emp_ids:
            qs = Employee.objects.filter(id__in=emp_ids)
        else:
            qs = Employee.objects.filter(status='active')

        created_ids, skipped_ids, errors = [], [], []
        for emp in qs:
            if PayrollSheet.objects.filter(employee=emp, month=month).exists():
                skipped_ids.append(emp.id)
                continue
            try:
                sheet = _create_payslip_for_employee(emp, month, request.user)
                created_ids.append(sheet.id)
            except Exception as exc:  # pylint: disable=broad-except
                errors.append({'employee': emp.id, 'error': str(exc)})

        return Response({
            'month':       month,
            'created':     len(created_ids),
            'skipped':     len(skipped_ids),
            'errors':      errors,
            'created_ids': created_ids,
        }, status=201)

    # ── Get entries ──────────────────────────────────────────────────────
    @action(detail=True, methods=['get'], url_path='entries')
    def entries(self, request, pk=None):
        sheet = self.get_object()
        entries = sheet.entries.select_related('payhead').all()
        return Response(PayslipEntrySerializer(entries, many=True).data)

    # ── Update single entry ──────────────────────────────────────────────
    @action(detail=True, methods=['patch'], url_path=r'entries/(?P<entry_id>[^/.]+)/update')
    def update_entry(self, request, pk=None, entry_id=None):
        sheet = self.get_object()
        try:
            entry = PayslipEntry.objects.get(id=entry_id, payslip=sheet)
        except PayslipEntry.DoesNotExist:
            return Response({'error': 'Entry পাওয়া যায়নি'}, status=404)

        new_amount = request.data.get('unit_amount')
        if new_amount is None:
            return Response({'error': 'unit_amount আবশ্যক'}, status=400)

        entry.unit_amount = float(new_amount)
        # Recalculate final (simple amount mode for now)
        if entry.amount_type == 'percentage':
            basic = float(sheet.basic_salary)
            entry.final_amount = basic * float(new_amount) / 100
        else:
            entry.final_amount = float(new_amount)
        entry.save(update_fields=['unit_amount', 'final_amount'])

        # Recalculate sheet totals
        all_entries = sheet.entries.all()
        total_add = sum(float(e.final_amount) for e in all_entries if e.payhead_type == 'addition')
        total_ded = sum(float(e.final_amount) for e in all_entries if e.payhead_type == 'deduction')
        sheet.net_salary = total_add - total_ded
        sheet.save(update_fields=['net_salary'])

        return Response(PayslipEntrySerializer(entry).data)

    # ── Add entry (assign payhead to payslip) ────────────────────────────
    @action(detail=True, methods=['post'], url_path='assign-payhead')
    def assign_payhead(self, request, pk=None):
        sheet    = self.get_object()
        ph_id    = request.data.get('payhead')
        amt_type = request.data.get('amount_type', 'amount')
        unit_amt = float(request.data.get('unit_amount', 0))

        try:
            ph = PayHead.objects.get(id=ph_id)
        except PayHead.DoesNotExist:
            return Response({'error': 'PayHead পাওয়া যায়নি'}, status=404)

        # Avoid duplicate
        entry, created = PayslipEntry.objects.get_or_create(
            payslip=sheet, payhead=ph,
            defaults={
                'payhead_name': ph.name, 'payhead_type': ph.payhead_type,
                'amount_type': amt_type, 'unit_amount': unit_amt, 'final_amount': unit_amt,
            }
        )
        if not created:
            entry.unit_amount  = unit_amt
            entry.final_amount = unit_amt
            entry.amount_type  = amt_type
            entry.save()

        # Recalculate sheet
        all_entries = sheet.entries.all()
        total_add = sum(float(e.final_amount) for e in all_entries if e.payhead_type == 'addition')
        total_ded = sum(float(e.final_amount) for e in all_entries if e.payhead_type == 'deduction')
        sheet.net_salary = total_add - total_ded
        sheet.save(update_fields=['net_salary'])

        return Response(PayslipEntrySerializer(entry).data, status=201 if created else 200)

    # ── Remove entry ─────────────────────────────────────────────────────
    @action(detail=True, methods=['delete'], url_path=r'entries/(?P<entry_id>[^/.]+)/remove')
    def remove_entry(self, request, pk=None, entry_id=None):
        sheet = self.get_object()
        deleted, _ = PayslipEntry.objects.filter(id=entry_id, payslip=sheet).delete()
        if deleted:
            all_entries = sheet.entries.all()
            total_add = sum(float(e.final_amount) for e in all_entries if e.payhead_type == 'addition')
            total_ded = sum(float(e.final_amount) for e in all_entries if e.payhead_type == 'deduction')
            sheet.net_salary = total_add - total_ded
            sheet.save(update_fields=['net_salary'])
        return Response({'deleted': deleted})

    # ── Batch update entries (ViewPayheads modal → Update Pay Heads) ─────
    @action(detail=True, methods=['patch'], url_path='update-payheads')
    def update_payheads(self, request, pk=None):
        sheet   = self.get_object()
        entries = request.data.get('entries', [])  # [{id, unit_amount}, ...]
        updated = []
        for item in entries:
            try:
                entry = PayslipEntry.objects.get(id=item['id'], payslip=sheet)
                new_amt = float(item.get('unit_amount', 0))
                entry.unit_amount = new_amt
                if entry.amount_type == 'percentage':
                    entry.final_amount = float(sheet.basic_salary) * new_amt / 100
                else:
                    entry.final_amount = new_amt
                entry.save(update_fields=['unit_amount', 'final_amount'])
                updated.append(entry)
            except PayslipEntry.DoesNotExist:
                continue
        # Recalculate sheet totals
        all_e = sheet.entries.all()
        sheet.net_salary = (
            sum(float(e.final_amount) for e in all_e if e.payhead_type == 'addition') -
            sum(float(e.final_amount) for e in all_e if e.payhead_type == 'deduction')
        )
        sheet.save(update_fields=['net_salary'])
        return Response(PayslipEntrySerializer(updated, many=True).data)


class EmployeeAdvanceViewSet(viewsets.ModelViewSet):
    """Employee Advance CRUD + per-employee filter + recovery history"""
    queryset = (
        EmployeeAdvance.objects.select_related('employee', 'received_by')
        .prefetch_related('recoveries')
        .all()
    )
    serializer_class   = EmployeeAdvanceSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class   = HRPagination
    filterset_fields   = ['employee']
    ordering_fields    = ['taken_date', 'amount', 'created_at']
    ordering           = ['-taken_date', '-id']

    def perform_create(self, serializer):
        # received_by default: current user
        if not serializer.validated_data.get('received_by') and self.request.user.is_authenticated:
            serializer.save(received_by=self.request.user)
        else:
            serializer.save()

    @action(detail=False, methods=['get'], url_path='by-employee')
    def by_employee(self, request):
        emp_id = request.query_params.get('employee')
        if not emp_id:
            return Response({'error': 'employee param আবশ্যক'}, status=400)
        qs = self.get_queryset().filter(employee_id=emp_id)
        return Response(EmployeeAdvanceSerializer(qs, many=True).data)

    @action(detail=False, methods=['get'], url_path='balance')
    def balance(self, request):
        """Each employee-এর net advance balance (একসাথে summary)."""
        from decimal import Decimal
        emp_id = request.query_params.get('employee')
        qs = EmployeeAdvance.objects.prefetch_related('recoveries')
        if emp_id:
            qs = qs.filter(employee_id=emp_id)
        out = {}
        for a in qs:
            recovered = sum((r.amount for r in a.recoveries.all()), Decimal('0'))
            remaining = max(a.amount - recovered, Decimal('0'))
            out.setdefault(a.employee_id, Decimal('0'))
            out[a.employee_id] += remaining
        return Response({str(k): float(v) for k, v in out.items()})


class PositionViewSet(viewsets.ModelViewSet):
    # পজিশন CRUD API
    queryset = Position.objects.select_related('payroll', 'supervisor').annotate(
        employee_count=Count('employees', filter=Q(employees__status='active'))
    ).order_by('id')
    serializer_class = PositionSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = HRPagination
    search_fields = ['name', 'position_type', 'status']
    ordering_fields = ['id', 'name', 'status', 'created_at']


class ResignRuleViewSet(viewsets.ModelViewSet):
    """পদত্যাগ নীতি CRUD — Resignation form-এ dropdown হিসেবে ব্যবহৃত হয়।"""
    queryset = ResignRule.objects.all().order_by('id')
    serializer_class = ResignRuleSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = HRPagination
    search_fields = ['name']


class ResignationViewSet(viewsets.ModelViewSet):
    """পদত্যাগ রেকর্ড CRUD + approve/reject।
    approve হলে Employee.status='resigned'; reject/pending হলে 'active' ফিরিয়ে দেয়।
    """
    queryset = (
        Resignation.objects.select_related('employee', 'resign_rule', 'approved_by')
        .all().order_by('-apply_date', '-id')
    )
    serializer_class = ResignationSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = HRPagination
    filterset_fields = ['employee', 'status', 'resign_rule']
    search_fields = ['employee__full_name', 'employee__employee_id', 'reason']

    def _sync_employee_status(self, resignation):
        # approve → resigned; নয়তো active — Employee.status সঙ্গে রাখি
        emp = resignation.employee
        emp.status = 'resigned' if resignation.status == 'approved' else 'active'
        emp.save(update_fields=['status'])

    @action(detail=True, methods=['post'], url_path='approve')
    def approve(self, request, pk=None):
        resignation = self.get_object()
        resignation.status = 'approved'
        resignation.approved_by = request.user if request.user.is_authenticated else None
        resignation.approved_at = timezone.now()
        if request.data.get('remarks'):
            resignation.remarks = request.data['remarks']
        resignation.save()
        self._sync_employee_status(resignation)
        return Response(ResignationSerializer(resignation).data)

    @action(detail=True, methods=['post'], url_path='reject')
    def reject(self, request, pk=None):
        resignation = self.get_object()
        resignation.status = 'rejected'
        resignation.approved_by = request.user if request.user.is_authenticated else None
        resignation.approved_at = timezone.now()
        if request.data.get('remarks'):
            resignation.remarks = request.data['remarks']
        resignation.save()
        self._sync_employee_status(resignation)   # active ফিরিয়ে দেয়
        return Response(ResignationSerializer(resignation).data)


class RejoinViewSet(viewsets.ModelViewSet):
    """পুনঃযোগদান (Rejoin) রেকর্ড CRUD — create হলেই Employee.status='active'।
    Employee.join_date অপরিবর্তিত থাকে; এই rejoin_date আলাদা ইতিহাস হিসেবে save।
    """
    queryset = (
        Rejoin.objects.select_related('employee', 'previous_resignation', 'created_by')
        .all().order_by('-rejoin_date', '-id')
    )
    serializer_class = RejoinSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = HRPagination
    filterset_fields = ['employee']
    search_fields = ['employee__full_name', 'employee__employee_id', 'notes']

    def perform_create(self, serializer):
        user = self.request.user if self.request.user.is_authenticated else None
        rejoin = serializer.save(created_by=user)
        emp = rejoin.employee
        emp.status = 'active'
        emp.save(update_fields=['status'])


class CollectorCashViewSet(viewsets.ViewSet):
    """Collector-দের cash-in-hand balance ও transaction history"""
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        """সব collector-এর cash balance summary"""
        from hr.models import CollectorCashBalance
        from django.db.models import Sum
        balances = CollectorCashBalance.objects.select_related('employee').all()
        data = [{
            'employee_id':    b.employee.id,
            'employee_name':  b.employee.full_name,
            'employee_code':  b.employee.employee_id,
            'cash_in_hand':   str(b.cash_in_hand),
            'total_collected':str(b.total_collected),
            'total_approved': str(b.total_approved),
            'last_updated':   b.last_updated,
        } for b in balances]
        return Response(data)

    @action(detail=False, methods=['get'], url_path=r'employee/(?P<emp_id>[^/.]+)')
    def by_employee(self, request, emp_id=None):
        """নির্দিষ্ট employee-র balance ও recent transactions"""
        from hr.models import Employee, CollectorCashBalance, CollectorCashTransaction
        try:
            emp = Employee.objects.get(pk=emp_id)
        except Employee.DoesNotExist:
            return Response({'error': 'Employee not found'}, status=404)
        balance, _ = CollectorCashBalance.objects.get_or_create(employee=emp)
        txns = CollectorCashTransaction.objects.filter(employee=emp).order_by('-created_at')[:50]
        return Response({
            'employee_id':    emp.id,
            'employee_name':  emp.full_name,
            'cash_in_hand':   str(balance.cash_in_hand),
            'total_collected':str(balance.total_collected),
            'total_approved': str(balance.total_approved),
            'transactions': [{
                'id':          t.id,
                'txn_type':    t.txn_type,
                'amount':      str(t.amount),
                'client_name': t.client_name,
                'notes':       t.notes,
                'created_at':  t.created_at,
            } for t in txns],
        })
