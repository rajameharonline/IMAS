# Accounting API views — Dashboard, Vouchers, Reports সব এক জায়গায়।
# কেন এত বড় ফাইল: সব accounting endpoint একই app-এ থাকলে shared helpers reuse হয়।
from decimal import Decimal
from datetime import date as _date, timedelta

from django.db.models import Sum, Q
from django.utils import timezone
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.views import APIView

from accounting.models import (
    AccountType, ChartOfAccount, JournalEntry, JournalLine,
    IncomeCategory, Income, ExpenseCategory, Expense, DailyAccount,
)
from accounting.api.serializers import (
    AccountTypeSerializer, ChartOfAccountSerializer, JournalEntrySerializer,
    IncomeCategorySerializer, IncomeSerializer,
    ExpenseCategorySerializer, ExpenseSerializer,
    DailyAccountSerializer,
)

# পুনরাবৃত্ত literal — S1192 এড়াতে module constant
_ERR_NO_ID = 'কোনো ID নেই।'


# ── helpers ──────────────────────────────────────────────────────────────────

def _account_balance_till(account, till_date=None):
    # account-এর till_date পর্যন্ত (inclusive) running balance।
    # is_debit_normal=True → DR - CR; False → CR - DR।
    qs = JournalLine.objects.filter(account=account)
    if till_date:
        qs = qs.filter(journal__date__lte=till_date)
    agg = qs.aggregate(dr=Sum('debit'), cr=Sum('credit'))
    dr = Decimal(str(agg['dr'] or 0))
    cr = Decimal(str(agg['cr'] or 0))
    if account.account_type.is_debit_normal:
        return dr - cr
    return cr - dr


def _account_balance_range(account, from_date, to_date):
    # নির্দিষ্ট range-এ DR ও CR movement।
    qs = JournalLine.objects.filter(account=account)
    if from_date:
        qs = qs.filter(journal__date__gte=from_date)
    if to_date:
        qs = qs.filter(journal__date__lte=to_date)
    agg = qs.aggregate(dr=Sum('debit'), cr=Sum('credit'))
    return Decimal(str(agg['dr'] or 0)), Decimal(str(agg['cr'] or 0))


def _next_voucher_no(prefix, model_class, field='voucher_no'):
    # Auto-incrementing voucher number।
    last = (model_class.objects
            .exclude(**{field: ''})
            .order_by(f'-{field}')
            .values_list(field, flat=True)
            .first())
    if last:
        raw = ''.join(c for c in str(last) if c.isdigit())
        try:
            return f'{prefix}{int(raw) + 1:06d}'
        except (ValueError, TypeError):
            pass
    return f'{prefix}000001'


# ── AccountType ──────────────────────────────────────────────────────────────

class AccountTypeViewSet(viewsets.ReadOnlyModelViewSet):
    # Account type master (Asset, Liability ইত্যাদি) read-only।
    queryset = AccountType.objects.all()
    serializer_class = AccountTypeSerializer
    permission_classes = [permissions.IsAuthenticated]


# ── Chart of Accounts ─────────────────────────────────────────────────────────

class ChartOfAccountViewSet(viewsets.ModelViewSet):
    # COA CRUD — Add Account modal থেকে POST হয়।
    queryset = ChartOfAccount.objects.select_related('account_type', 'parent').all()
    serializer_class = ChartOfAccountSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['account_type', 'is_active']


# ── Income Category ───────────────────────────────────────────────────────────

class IncomeCategoryViewSet(viewsets.ModelViewSet):
    queryset = IncomeCategory.objects.select_related('account').all()
    serializer_class = IncomeCategorySerializer
    permission_classes = [permissions.IsAuthenticated]


# ── Expense Category ──────────────────────────────────────────────────────────

class ExpenseCategoryViewSet(viewsets.ModelViewSet):
    queryset = ExpenseCategory.objects.select_related('account').all()
    serializer_class = ExpenseCategorySerializer
    permission_classes = [permissions.IsAuthenticated]


# ── Income (Credit Voucher) ───────────────────────────────────────────────────

class IncomeViewSet(viewsets.ModelViewSet):
    # Credit Voucher list + CRUD + bulk approve।
    # voucher create: একটি voucher_no-তে multiple lines save হয়।
    serializer_class = IncomeSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = Income.objects.select_related('category', 'account', 'created_by', 'approved_by')
        p = self.request.query_params

        account = p.get('account')
        if account:
            qs = qs.filter(account_id=account)

        category = p.get('category')
        if category:
            qs = qs.filter(category_id=category)

        status_f = p.get('status')
        if status_f == 'approved':
            qs = qs.filter(is_approved=True)
        elif status_f == 'pending':
            qs = qs.filter(is_approved=False)

        created_by = p.get('created_by')
        if created_by:
            qs = qs.filter(created_by_id=created_by)

        from_date = p.get('from_date')
        to_date   = p.get('to_date')
        if from_date:
            qs = qs.filter(date__gte=from_date)
        if to_date:
            qs = qs.filter(date__lte=to_date)

        search = p.get('search')
        if search:
            qs = qs.filter(
                Q(voucher_no__icontains=search) |
                Q(description__icontains=search) |
                Q(reference__icontains=search)
            )
        return qs.order_by('-date', '-id')

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=False, methods=['post'], url_path='create-voucher')
    def create_voucher(self, request):
        # Multi-line income voucher তৈরি করা।
        # একটি voucher_no দিয়ে সব lines group করা হয়।
        data   = request.data
        lines  = data.get('lines', [])
        if not lines:
            return Response({'detail': 'কমপক্ষে একটি line item দরকার।'}, status=400)

        voucher_no = _next_voucher_no('INV', Income)
        account_id = data.get('account')
        v_date     = data.get('date') or str(_date.today())
        description = data.get('description', '')
        attachment  = request.FILES.get('attachment')

        created = []
        for line in lines:
            cat_id = line.get('category')
            amount = line.get('amount', 0)
            if not amount:
                continue
            inc = Income.objects.create(
                voucher_no=voucher_no,
                account_id=account_id if account_id else None,
                category_id=cat_id if cat_id else None,
                amount=amount,
                date=v_date,
                description=description,
                attachment=attachment,
                created_by=request.user,
            )
            created.append(inc)

        if not created:
            return Response({'detail': 'কোনো valid line item পাওয়া যায়নি।'}, status=400)

        return Response(
            IncomeSerializer(created, many=True, context={'request': request}).data,
            status=201,
        )

    @action(detail=False, methods=['post'], url_path='bulk-approve')
    def bulk_approve(self, request):
        # Selected income IDs approve করা।
        ids = request.data.get('ids', [])
        if not ids:
            return Response({'detail': _ERR_NO_ID}, status=400)
        now = timezone.now()
        Income.objects.filter(pk__in=ids).update(
            is_approved=True, approved_by=request.user, approved_at=now,
        )
        return Response({'approved': len(ids)})

    @action(detail=False, methods=['post'], url_path='bulk-delete')
    def bulk_delete(self, request):
        ids = request.data.get('ids', [])
        if not ids:
            return Response({'detail': _ERR_NO_ID}, status=400)
        Income.objects.filter(pk__in=ids).delete()
        return Response({'deleted': len(ids)})

    @action(detail=False, methods=['get'], url_path='next-voucher-no')
    def next_voucher_no(self, request):
        return Response({'voucher_no': _next_voucher_no('INV', Income)})


# ── Expense (Debit Voucher) ───────────────────────────────────────────────────

class ExpenseViewSet(viewsets.ModelViewSet):
    # Debit Voucher list + CRUD + bulk approve।
    serializer_class = ExpenseSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = Expense.objects.select_related('category', 'account', 'created_by', 'approved_by')
        p = self.request.query_params

        account = p.get('account')
        if account:
            qs = qs.filter(account_id=account)

        category = p.get('category')
        if category:
            qs = qs.filter(category_id=category)

        status_f = p.get('status')
        if status_f == 'approved':
            qs = qs.filter(is_approved=True)
        elif status_f == 'pending':
            qs = qs.filter(is_approved=False)

        created_by = p.get('created_by')
        if created_by:
            qs = qs.filter(created_by_id=created_by)

        from_date = p.get('from_date')
        to_date   = p.get('to_date')
        if from_date:
            qs = qs.filter(date__gte=from_date)
        if to_date:
            qs = qs.filter(date__lte=to_date)

        search = p.get('search')
        if search:
            qs = qs.filter(
                Q(voucher_no__icontains=search) |
                Q(description__icontains=search)
            )
        return qs.order_by('-date', '-id')

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=False, methods=['post'], url_path='create-voucher')
    def create_voucher(self, request):
        data        = request.data
        lines       = data.get('lines', [])
        if not lines:
            return Response({'detail': 'কমপক্ষে একটি line item দরকার।'}, status=400)

        voucher_no  = _next_voucher_no('EXP', Expense)
        account_id  = data.get('account')
        v_date      = data.get('date') or str(_date.today())
        description = data.get('description', '')
        attachment  = request.FILES.get('attachment')

        created = []
        for line in lines:
            cat_id = line.get('category')
            amount = line.get('amount', 0)
            if not amount:
                continue
            exp = Expense.objects.create(
                voucher_no=voucher_no,
                account_id=account_id if account_id else None,
                category_id=cat_id if cat_id else None,
                amount=amount,
                date=v_date,
                description=description,
                attachment=attachment,
                created_by=request.user,
            )
            created.append(exp)

        if not created:
            return Response({'detail': 'কোনো valid line item পাওয়া যায়নি।'}, status=400)

        return Response(
            ExpenseSerializer(created, many=True, context={'request': request}).data,
            status=201,
        )

    @action(detail=False, methods=['post'], url_path='bulk-approve')
    def bulk_approve(self, request):
        ids = request.data.get('ids', [])
        if not ids:
            return Response({'detail': _ERR_NO_ID}, status=400)
        now = timezone.now()
        Expense.objects.filter(pk__in=ids).update(
            is_approved=True, approved_by=request.user, approved_at=now,
        )
        return Response({'approved': len(ids)})

    @action(detail=False, methods=['post'], url_path='bulk-delete')
    def bulk_delete(self, request):
        ids = request.data.get('ids', [])
        if not ids:
            return Response({'detail': _ERR_NO_ID}, status=400)
        Expense.objects.filter(pk__in=ids).delete()
        return Response({'deleted': len(ids)})

    @action(detail=False, methods=['get'], url_path='next-voucher-no')
    def next_voucher_no(self, request):
        return Response({'voucher_no': _next_voucher_no('EXP', Expense)})


# ── Journal Entry (Journal Voucher) ───────────────────────────────────────────

class JournalEntryViewSet(viewsets.ModelViewSet):
    # Journal Voucher CRUD + approve।
    serializer_class = JournalEntrySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = JournalEntry.objects.prefetch_related('lines__account').select_related('created_by', 'approved_by')
        p  = self.request.query_params

        account = p.get('account')
        if account:
            qs = qs.filter(lines__account_id=account).distinct()

        status_f = p.get('status')
        if status_f == 'approved':
            qs = qs.filter(is_posted=True)
        elif status_f == 'pending':
            qs = qs.filter(is_posted=False)

        from_date = p.get('from_date')
        to_date   = p.get('to_date')
        if from_date:
            qs = qs.filter(date__gte=from_date)
        if to_date:
            qs = qs.filter(date__lte=to_date)

        search = p.get('search')
        if search:
            qs = qs.filter(
                Q(reference__icontains=search) |
                Q(description__icontains=search)
            )
        return qs.order_by('-date', '-id')

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=False, methods=['post'], url_path='bulk-approve')
    def bulk_approve(self, request):
        ids = request.data.get('ids', [])
        if not ids:
            return Response({'detail': _ERR_NO_ID}, status=400)
        now = timezone.now()
        JournalEntry.objects.filter(pk__in=ids).update(
            is_posted=True, approved_by=request.user, approved_at=now,
        )
        return Response({'approved': len(ids)})

    @action(detail=False, methods=['post'], url_path='bulk-delete')
    def bulk_delete(self, request):
        ids = request.data.get('ids', [])
        if not ids:
            return Response({'detail': _ERR_NO_ID}, status=400)
        JournalEntry.objects.filter(pk__in=ids).delete()
        return Response({'deleted': len(ids)})

    @action(detail=False, methods=['get'], url_path='next-reference')
    def next_reference(self, request):
        last = (JournalEntry.objects
                .order_by('-reference')
                .values_list('reference', flat=True)
                .first())
        if last:
            raw = ''.join(c for c in str(last) if c.isdigit())
            try:
                return Response({'reference': f'JV-{int(raw) + 1:06d}'})
            except (ValueError, TypeError):
                pass
        return Response({'reference': 'JV-000001'})


# ── Daily Account ──────────────────────────────────────────────────────────────

class DailyAccountViewSet(viewsets.ModelViewSet):
    queryset = DailyAccount.objects.all()
    serializer_class = DailyAccountSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['date', 'is_closed']

    @action(detail=False, methods=['get'], url_path='profit-loss')
    def profit_loss(self, request):
        # Income - Expense = Net Profit।
        from_date = request.query_params.get('from_date')
        to_date   = request.query_params.get('to_date')

        inc_qs = Income.objects.all()
        exp_qs = Expense.objects.all()
        if from_date:
            inc_qs = inc_qs.filter(date__gte=from_date)
            exp_qs = exp_qs.filter(date__gte=from_date)
        if to_date:
            inc_qs = inc_qs.filter(date__lte=to_date)
            exp_qs = exp_qs.filter(date__lte=to_date)

        total_income  = float(inc_qs.aggregate(t=Sum('amount'))['t'] or 0)
        total_expense = float(exp_qs.aggregate(t=Sum('amount'))['t'] or 0)

        # Category breakdown
        inc_by_cat = list(
            inc_qs.values('category__name').annotate(total=Sum('amount'))
            .order_by('-total')
        )
        exp_by_cat = list(
            exp_qs.values('category__name').annotate(total=Sum('amount'))
            .order_by('-total')
        )

        return Response({
            'total_income':  total_income,
            'total_expense': total_expense,
            'net_profit':    total_income - total_expense,
            'income_by_category':  [{'name': r['category__name'] or 'Uncategorized', 'amount': float(r['total'])} for r in inc_by_cat],
            'expense_by_category': [{'name': r['category__name'] or 'Uncategorized', 'amount': float(r['total'])} for r in exp_by_cat],
            'from_date': from_date,
            'to_date':   to_date,
        })

    @action(detail=False, methods=['get'], url_path='trial-balance')
    def trial_balance(self, request):
        # ট্রায়াল ব্যালেন্স — till_date পর্যন্ত সব account-এর DR/CR।
        till_date = request.query_params.get('till_date')
        accounts  = ChartOfAccount.objects.filter(is_active=True).select_related('account_type')
        rows = []
        for acct in accounts:
            qs = JournalLine.objects.filter(account=acct)
            if till_date:
                qs = qs.filter(journal__date__lte=till_date)
            agg = qs.aggregate(dr=Sum('debit'), cr=Sum('credit'))
            dr = float(agg['dr'] or 0)
            cr = float(agg['cr'] or 0)
            if dr > 0 or cr > 0:
                rows.append({
                    'account_id':   acct.id,
                    'account_code': acct.code,
                    'account_name': acct.name,
                    'account_type': acct.account_type.name,
                    'account_type_code': acct.account_type.code,
                    'debit':  dr,
                    'credit': cr,
                })
        return Response(rows)


# ── Accounting Dashboard ──────────────────────────────────────────────────────


def _account_group_balance(qs_filter, credit_side=False):
    """qs_filter মেলা সব ChartOfAccount-এর JournalLine balance যোগফল।
    credit_side=True → (cr-dr) [payable/liability]; নাহলে (dr-cr) [receivable/asset]।"""
    total = 0.0
    try:
        for acc in ChartOfAccount.objects.filter(**qs_filter):
            agg = JournalLine.objects.filter(account=acc).aggregate(dr=Sum('debit'), cr=Sum('credit'))
            if credit_side:
                total += float((agg['cr'] or 0) - (agg['dr'] or 0))
            else:
                total += float((agg['dr'] or 0) - (agg['cr'] or 0))
    except Exception:
        pass
    return total


def _cash_on_hand():
    """Cash on Hand — account code 1010-এর balance (dr-cr); account না থাকলে 0।"""
    try:
        cash_acct = ChartOfAccount.objects.get(code='1010')
        agg = JournalLine.objects.filter(account=cash_acct).aggregate(dr=Sum('debit'), cr=Sum('credit'))
        return float((agg['dr'] or 0) - (agg['cr'] or 0))
    except ChartOfAccount.DoesNotExist:
        return 0


class AccountingDashboardView(APIView):
    # Dashboard stat cards + recent income/expense।
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from_date = request.query_params.get('from_date')
        to_date   = request.query_params.get('to_date')

        inc_qs = Income.objects.all()
        exp_qs = Expense.objects.all()
        if from_date:
            inc_qs = inc_qs.filter(date__gte=from_date)
            exp_qs = exp_qs.filter(date__gte=from_date)
        if to_date:
            inc_qs = inc_qs.filter(date__lte=to_date)
            exp_qs = exp_qs.filter(date__lte=to_date)

        total_income  = float(inc_qs.aggregate(t=Sum('amount'))['t'] or 0)
        total_expense = float(exp_qs.aggregate(t=Sum('amount'))['t'] or 0)
        net_profit    = total_income - total_expense

        # Cash on Hand (account code 1010)
        cash_balance = _cash_on_hand()

        # Expected payments from customers (Receivable assets)
        cust_receivable = _account_group_balance(
            {'account_type__code': 'ASSET', 'name__icontains': 'Receivable'}, credit_side=False)

        # Expected payments to vendors (Payable liabilities)
        vendor_payable = _account_group_balance(
            {'account_type__code': 'LIA', 'name__icontains': 'Payable'}, credit_side=True)

        # Income by category (chart data)
        inc_by_cat = list(
            inc_qs.values('category__name').annotate(total=Sum('amount')).order_by('-total')
        )
        exp_by_cat = list(
            exp_qs.values('category__name').annotate(total=Sum('amount')).order_by('-total')
        )

        # Latest 10 incomes / expenses
        latest_income  = IncomeSerializer(
            inc_qs.order_by('-date', '-id')[:10], many=True, context={'request': request}
        ).data
        latest_expense = ExpenseSerializer(
            exp_qs.order_by('-date', '-id')[:10], many=True, context={'request': request}
        ).data

        return Response({
            'total_income':          total_income,
            'total_expense':         total_expense,
            'net_profit':            net_profit,
            'cash_on_hand':          cash_balance,
            'customer_receivable':   cust_receivable,
            'vendor_payable':        vendor_payable,
            'total_upcoming':        cust_receivable - vendor_payable,
            'income_by_category':    [{'name': r['category__name'] or 'Uncategorized', 'amount': float(r['total'])} for r in inc_by_cat],
            'expense_by_category':   [{'name': r['category__name'] or 'Uncategorized', 'amount': float(r['total'])} for r in exp_by_cat],
            'latest_income':         latest_income,
            'latest_expense':        latest_expense,
            'from_date':             from_date,
            'to_date':               to_date,
        })


# ── Balance Sheet ─────────────────────────────────────────────────────────────

def _balance_sheet_add_account(acct, till_date, sections):
    """একটি account-এর till_date balance calc করে sections dict-এ যোগ করে
    (শুধু ASSET/LIA/EQU ও non-zero balance)।"""
    type_code = acct.account_type.code
    if type_code not in ('ASSET', 'LIA', 'EQU'):
        return
    qs = JournalLine.objects.filter(account=acct, journal__date__lte=till_date)
    agg = qs.aggregate(dr=Sum('debit'), cr=Sum('credit'))
    dr = Decimal(str(agg['dr'] or 0))
    cr = Decimal(str(agg['cr'] or 0))
    balance = (dr - cr) if acct.account_type.is_debit_normal else (cr - dr)
    if balance == 0:
        return
    type_name = acct.account_type.name
    if type_name not in sections:
        sections[type_name] = {'code': type_code, 'items': [], 'total': Decimal('0')}
    parent_name = acct.parent.name if acct.parent else 'General'
    sections[type_name]['items'].append({
        'id':          acct.id,
        'code':        acct.code,
        'name':        acct.name,
        'parent_name': parent_name,
        'balance':     float(balance),
    })
    sections[type_name]['total'] += balance


class BalanceSheetView(APIView):
    # Balance Sheet — till_date পর্যন্ত সব account-এর cumulative balance।
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        till_date = request.query_params.get('till_date') or str(_date.today())
        accounts  = ChartOfAccount.objects.filter(is_active=True).select_related('account_type', 'parent')

        sections = {}
        for acct in accounts:
            _balance_sheet_add_account(acct, till_date, sections)

        # Net Profit → Owner's Equity-তে যোগ
        inc_total  = float(Income.objects.filter(date__lte=till_date).aggregate(t=Sum('amount'))['t'] or 0)
        exp_total  = float(Expense.objects.filter(date__lte=till_date).aggregate(t=Sum('amount'))['t'] or 0)
        net_profit = inc_total - exp_total

        # Serialize
        result = {}
        for name, data in sections.items():
            result[name] = {
                'code':  data['code'],
                'items': data['items'],
                'total': float(data['total']),
            }

        # Owner's Equity (net profit)
        result['Owner\'s Equity'] = {
            'code':  'EQU',
            'items': [{'name': 'Net Profit', 'balance': net_profit}],
            'total': net_profit,
        }

        return Response({'sections': result, 'till_date': till_date})


# ── Account Transactions ──────────────────────────────────────────────────────

def _build_ledger_transactions(lines_qs, acct, start_balance):
    """ledger lines → (transactions list, total_dr, total_cr) — running balance সহ।"""
    transactions = []
    running = start_balance
    total_dr = Decimal('0')
    total_cr = Decimal('0')
    debit_normal = acct.account_type.is_debit_normal
    for line in lines_qs:
        if debit_normal:
            running = running + Decimal(str(line.debit or 0)) - Decimal(str(line.credit or 0))
        else:
            running = running - Decimal(str(line.debit or 0)) + Decimal(str(line.credit or 0))
        total_dr += Decimal(str(line.debit or 0))
        total_cr += Decimal(str(line.credit or 0))
        transactions.append({
            'date':        str(line.journal.date),
            'reference':   line.journal.reference,
            'description': line.description or line.journal.description,
            'debit':       float(line.debit or 0),
            'credit':      float(line.credit or 0),
            'balance':     float(running),
        })
    return transactions, total_dr, total_cr


class AccountTransactionsView(APIView):
    # নির্দিষ্ট account-এর ledger — starting balance + range movements।
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        account_id = request.query_params.get('account_id')
        from_date  = request.query_params.get('from_date')
        to_date    = request.query_params.get('to_date')

        if not account_id:
            return Response({'detail': 'account_id প্রয়োজন।'}, status=400)

        try:
            acct = ChartOfAccount.objects.select_related('account_type', 'parent').get(pk=account_id)
        except ChartOfAccount.DoesNotExist:
            return Response({'detail': 'Account পাওয়া যায়নি।'}, status=404)

        # Starting balance = balance before from_date
        start_balance = Decimal('0')
        if from_date:
            prev_date = str((_date.fromisoformat(from_date) - timedelta(days=1)))
            start_balance = _account_balance_till(acct, prev_date)
        else:
            start_balance = Decimal('0')

        # Transactions in range
        lines_qs = JournalLine.objects.filter(account=acct).select_related('journal')
        if from_date:
            lines_qs = lines_qs.filter(journal__date__gte=from_date)
        if to_date:
            lines_qs = lines_qs.filter(journal__date__lte=to_date)
        lines_qs = lines_qs.order_by('journal__date', 'id')

        transactions, total_dr, total_cr = _build_ledger_transactions(lines_qs, acct, start_balance)

        ending_balance = start_balance + (total_dr - total_cr if acct.account_type.is_debit_normal else total_cr - total_dr)

        return Response({
            'account': {
                'id':   acct.id,
                'code': acct.code,
                'name': acct.name,
                'type': acct.account_type.name,
                'parent': acct.parent.name if acct.parent else '',
            },
            'starting_balance': float(start_balance),
            'ending_balance':   float(ending_balance),
            'total_debit':      float(total_dr),
            'total_credit':     float(total_cr),
            'transactions':     transactions,
            'from_date':        from_date,
            'to_date':          to_date,
        })


# ── Account Balances ──────────────────────────────────────────────────────────

class AccountBalancesView(APIView):
    # সব account-এর starting balance, Dr/Cr movement, ending balance।
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from_date  = request.query_params.get('from_date')
        to_date    = request.query_params.get('to_date')
        type_code  = request.query_params.get('type_code')  # optional filter

        accounts = ChartOfAccount.objects.filter(is_active=True).select_related('account_type')
        if type_code:
            accounts = accounts.filter(account_type__code=type_code)

        sections  = {}
        prev_date = None
        if from_date:
            prev_date = str((_date.fromisoformat(from_date) - timedelta(days=1)))

        for acct in accounts:
            # Starting balance
            start_bal = _account_balance_till(acct, prev_date) if prev_date else Decimal('0')

            # Movement in range
            dr_move, cr_move = _account_balance_range(acct, from_date, to_date)

            if acct.account_type.is_debit_normal:
                net_move   = dr_move - cr_move
            else:
                net_move   = cr_move - dr_move

            end_bal = start_bal + net_move

            if start_bal == 0 and dr_move == 0 and cr_move == 0:
                continue

            type_name = acct.account_type.name
            if type_name not in sections:
                sections[type_name] = {
                    'code':  acct.account_type.code,
                    'items': [],
                    'start': Decimal('0'),
                    'dr':    Decimal('0'),
                    'cr':    Decimal('0'),
                    'net':   Decimal('0'),
                    'end':   Decimal('0'),
                }

            sections[type_name]['items'].append({
                'id':    acct.id,
                'code':  acct.code,
                'name':  acct.name,
                'starting_balance': float(start_bal),
                'debit':            float(dr_move),
                'credit':           float(cr_move),
                'net_movement':     float(net_move),
                'ending_balance':   float(end_bal),
            })
            sections[type_name]['start'] += start_bal
            sections[type_name]['dr']    += dr_move
            sections[type_name]['cr']    += cr_move
            sections[type_name]['net']   += net_move
            sections[type_name]['end']   += end_bal

        # Serialize
        result = {}
        for name, data in sections.items():
            result[name] = {
                'code':  data['code'],
                'items': data['items'],
                'total': {
                    'starting_balance': float(data['start']),
                    'debit':            float(data['dr']),
                    'credit':           float(data['cr']),
                    'net_movement':     float(data['net']),
                    'ending_balance':   float(data['end']),
                },
            }

        return Response({'sections': result, 'from_date': from_date, 'to_date': to_date})


# ── Compare Profit & Loss ─────────────────────────────────────────────────────

class CompareProfitLossView(APIView):
    # দুটো date range-এর P&L তুলনা।
    permission_classes = [permissions.IsAuthenticated]

    def _pnl(self, from_d, to_d):
        inc_qs = Income.objects.all()
        exp_qs = Expense.objects.all()
        if from_d:
            inc_qs = inc_qs.filter(date__gte=from_d)
            exp_qs = exp_qs.filter(date__gte=from_d)
        if to_d:
            inc_qs = inc_qs.filter(date__lte=to_d)
            exp_qs = exp_qs.filter(date__lte=to_d)

        inc_total = float(inc_qs.aggregate(t=Sum('amount'))['t'] or 0)
        exp_total = float(exp_qs.aggregate(t=Sum('amount'))['t'] or 0)

        inc_by_cat = {
            r['category__name'] or 'Uncategorized': float(r['total'])
            for r in inc_qs.values('category__name').annotate(total=Sum('amount'))
        }
        exp_by_cat = {
            r['category__name'] or 'Uncategorized': float(r['total'])
            for r in exp_qs.values('category__name').annotate(total=Sum('amount'))
        }
        return inc_total, exp_total, inc_by_cat, exp_by_cat

    def get(self, request):
        from_date         = request.query_params.get('from_date')
        to_date           = request.query_params.get('to_date')
        compare_from_date = request.query_params.get('compare_from_date')
        compare_to_date   = request.query_params.get('compare_to_date')

        inc1, exp1, inc_cat1, exp_cat1 = self._pnl(from_date, to_date)
        inc2, exp2, inc_cat2, exp_cat2 = self._pnl(compare_from_date, compare_to_date)

        # Merge income categories
        all_inc_cats = set(list(inc_cat1.keys()) + list(inc_cat2.keys()))
        all_exp_cats = set(list(exp_cat1.keys()) + list(exp_cat2.keys()))

        income_rows = []
        for cat in sorted(all_inc_cats):
            v1 = inc_cat1.get(cat, 0)
            v2 = inc_cat2.get(cat, 0)
            change = v1 - v2
            pct    = ((change / v2 * 100) if v2 else 0)
            income_rows.append({'name': cat, 'current': v1, 'compare': v2, 'change': change, 'change_pct': round(pct, 2)})

        expense_rows = []
        for cat in sorted(all_exp_cats):
            v1 = exp_cat1.get(cat, 0)
            v2 = exp_cat2.get(cat, 0)
            change = v1 - v2
            pct    = ((change / v2 * 100) if v2 else 0)
            expense_rows.append({'name': cat, 'current': v1, 'compare': v2, 'change': change, 'change_pct': round(pct, 2)})

        profit1 = inc1 - exp1
        profit2 = inc2 - exp2
        profit_change = profit1 - profit2
        profit_pct    = round((profit_change / profit2 * 100) if profit2 else 0, 2)

        return Response({
            'current': {
                'from_date': from_date, 'to_date': to_date,
                'total_income': inc1, 'total_expense': exp1, 'net_profit': profit1,
            },
            'compare': {
                'from_date': compare_from_date, 'to_date': compare_to_date,
                'total_income': inc2, 'total_expense': exp2, 'net_profit': profit2,
            },
            'profit_change':     profit_change,
            'profit_change_pct': profit_pct,
            'income_rows':       income_rows,
            'expense_rows':      expense_rows,
        })


# ── Cash Book ─────────────────────────────────────────────────────────────────


def _model_qs(module_path, model_name):
    """dynamic import → Model.objects (import fail হলে exception — caller catch করে)।"""
    import importlib
    return getattr(importlib.import_module(module_path), model_name).objects


def _safe_dated_sum(qs_factory, date_field, amount_field, from_date, to_date):
    """qs_factory() base queryset (import নিরাপদ) → date range filter → amount_field-এর Sum;
    যেকোনো error-এ 0।"""
    try:
        qs = qs_factory()
        if from_date:
            qs = qs.filter(**{f'{date_field}__gte': from_date})
        if to_date:
            qs = qs.filter(**{f'{date_field}__lte': to_date})
        return float(qs.aggregate(t=Sum(amount_field))['t'] or 0)
    except Exception:
        return 0


class CashBookView(APIView):
    # Cash Book — Debit (in) এবং Credit (out) দুই কলাম।
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from_date = request.query_params.get('from_date')
        to_date   = request.query_params.get('to_date')

        # প্রতিটি source একটি date-range Sum — model import fail হলে 0 (helper catch করে)
        collected_bill = _safe_dated_sum(
            lambda: _model_qs('billing.models', 'Payment').filter(is_verified=True),
            'payment_date__date', 'amount', from_date, to_date)
        installation_charge = _safe_dated_sum(
            lambda: _model_qs('billing.models', 'InstallationFee').all(),
            'payment_date', 'paid_amount', from_date, to_date)
        product_sales = _safe_dated_sum(
            lambda: _model_qs('sales.models', 'ProductSalesPayment').all(),
            'receive_date', 'paid_amount', from_date, to_date)
        service_sales = _safe_dated_sum(
            lambda: _model_qs('sales.models', 'ServiceSalesPayment').all(),
            'receive_date', 'paid_amount', from_date, to_date)
        direct_income = _safe_dated_sum(
            lambda: Income.objects.all(), 'date', 'amount', from_date, to_date)
        paid_salary = _safe_dated_sum(
            lambda: _model_qs('hr.models', 'PayrollRecord').filter(is_paid=True),
            'paid_date', 'net_salary', from_date, to_date)
        direct_expense = _safe_dated_sum(
            lambda: Expense.objects.all(), 'date', 'amount', from_date, to_date)
        bandwidth_paid = _safe_dated_sum(
            lambda: _model_qs('purchase.models', 'ProviderBillPayment').all(),
            'payment_date', 'amount', from_date, to_date)
        purchase_paid = _safe_dated_sum(
            lambda: _model_qs('purchase.models', 'PurchaseBill').all(),
            'bill_date', 'paid_amount', from_date, to_date)

        debit_total  = collected_bill + installation_charge + product_sales + service_sales + direct_income
        credit_total = paid_salary + direct_expense + bandwidth_paid + purchase_paid
        cash_on_hand = debit_total - credit_total

        return Response({
            'debit': {
                'collected_bill':       collected_bill,
                'installation_charge':  installation_charge,
                'product_sales':        product_sales,
                'other_service_sales':  service_sales,
                'income':               direct_income,
                'total':                debit_total,
            },
            'credit': {
                'paid_salary':          paid_salary,
                'expense':              direct_expense,
                'bandwidth_provider':   bandwidth_paid,
                'purchase_paid':        purchase_paid,
                'total':                credit_total,
            },
            'cash_on_hand': cash_on_hand,
            'from_date':    from_date,
            'to_date':      to_date,
        })
