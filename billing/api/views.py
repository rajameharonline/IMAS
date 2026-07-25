# এই ফাইলটি billing API views - বিলিং, পেমেন্ট, দৈনিক কালেকশন।
from rest_framework import viewsets, views, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination


class BillPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 500
from django.db.models import Sum, Count, Q
from django.utils import timezone
from billing.models import (
    Bill, Payment, InstallationFee, DailyCollection, WebhookPayment,
    ReminderRule, ReminderLog,
)
from billing.api.serializers import (
    BillSerializer, BillCreateSerializer, PaymentSerializer,
    InstallationFeeSerializer, DailyCollectionSerializer, WebhookPaymentSerializer,
    ReminderRuleSerializer, ReminderLogSerializer,
)


def _apply_client_billing_filters(qs, p):
    """simple FK/date query-param filters (zone/subzone/box/package/protocol/client_type/
    server/expiry range)।"""
    if p.get('zone'):
        qs = qs.filter(zone_id=p['zone'])
    if p.get('subzone'):
        qs = qs.filter(subzone_id=p['subzone'])
    if p.get('box'):
        qs = qs.filter(box_id=p['box'])
    if p.get('package'):
        qs = qs.filter(package_id=p['package'])
    if p.get('protocol'):
        qs = qs.filter(protocol_id=p['protocol'])
    if p.get('client_type'):
        qs = qs.filter(client_type_id=p['client_type'])
    if p.get('server'):
        qs = qs.filter(router_id=p['server'])
    if p.get('expiry_from'):
        qs = qs.filter(expiry_date__gte=p['expiry_from'])
    if p.get('expiry_to'):
        qs = qs.filter(expiry_date__lte=p['expiry_to'])
    return qs


def _apply_payment_date_filter(qs, p):
    """date_from/date_to রেঞ্জে payment হয়েছে এমন client-এ qs সীমাবদ্ধ (payment_date tz-aware,
    date_to-এর পুরো দিন ধরতে +1 দিন __lt)।"""
    from datetime import datetime as _dtm, timedelta as _td
    date_from = p.get('date_from')
    date_to   = p.get('date_to')
    if not (date_from or date_to):
        return qs
    pay_q = Payment.objects.all()
    if date_from:
        pay_q = pay_q.filter(payment_date__gte=date_from)
    if date_to:
        try:
            _to_excl = (_dtm.strptime(date_to, '%Y-%m-%d') + _td(days=1)).strftime('%Y-%m-%d')
            pay_q = pay_q.filter(payment_date__lt=_to_excl)
        except ValueError:
            pass
    paid_client_ids = pay_q.values_list('bill__client_id', flat=True).distinct()
    return qs.filter(id__in=list(paid_client_ids))


def _pay_status_client_ids(pay_status, bm):
    """এই মাসে (bm) client-wise paid/due যোগফল দেখে pay_status মেলে এমন client id list
    (Dashboard count-এর হুবহু logic — mutually exclusive)।"""
    from collections import defaultdict as _dd
    _agg = _dd(lambda: [0.0, 0.0])   # cid → [paid_sum, due_sum]
    for _cid, _p, _d in Bill.objects.filter(
        bill_month=bm
    ).values_list('client_id', 'paid_amount', 'due_amount'):
        _a = _agg[_cid]
        _a[0] += float(_p or 0)
        _a[1] += float(_d or 0)

    def _cat(paid_sum, due_sum):
        if due_sum <= 0:
            return 'paid'
        return 'partial' if paid_sum > 0 else 'unpaid'

    return [cid for cid, (ps, ds) in _agg.items() if _cat(ps, ds) == pay_status]


def _filter_client_billing_qs(qs, p, month, now):
    """client billing list-এর সব query-param filter (search/FK/payment-date/bill-status/pay-status)।"""
    search = p.get('search', '').strip()
    if search:
        qs = qs.filter(
            Q(full_name__icontains=search) |
            Q(username__icontains=search)  |
            Q(customer_id__icontains=search) |
            Q(phone__icontains=search)
        )
    qs = _apply_client_billing_filters(qs, p)
    qs = _apply_payment_date_filter(qs, p)
    bill_status_filter = p.get('status', '')
    if bill_status_filter:
        bill_month_q = month or now.strftime('%Y-%m')
        matched_ids = Bill.objects.filter(
            bill_month=bill_month_q, status=bill_status_filter
        ).values_list('client_id', flat=True)
        qs = qs.filter(id__in=matched_ids)
    pay_status = p.get('pay_status', '')
    if pay_status in ('paid', 'partial', 'unpaid'):
        qs = qs.filter(id__in=_pay_status_client_ids(pay_status, month or now.strftime('%Y-%m')))
    return qs


def _bill_row_data(client, c_bills, month, now):
    """client-এর এই মাসের bill(s) → primary bill_data dict (বিল না থাকলে client field থেকে)।"""
    priority = {'unpaid': 3, 'partial': 2, 'paid': 1, 'waived': 0}
    if c_bills:
        primary = max(c_bills, key=lambda b: priority.get(b.status, 0))
        return {
            'id':           primary.id,
            'bill_month':   primary.bill_month,
            'amount':       float(primary.amount),
            'net_amount':   float(primary.net_amount),
            'paid_amount':  sum(float(b.paid_amount) for b in c_bills),
            'due_amount':   sum(float(b.due_amount)  for b in c_bills),
            'discount':     float(primary.discount),
            'status':       primary.status,
            'due_date':     str(primary.due_date) if primary.due_date else None,
            'notes':        primary.notes,
            'is_auto':      primary.is_auto,
            'all_bill_ids': [b.id for b in c_bills],
        }
    return {
        'id':           None,
        'bill_month':   month or now.strftime('%Y-%m'),
        'amount':       float(client.monthly_bill),
        'net_amount':   float(client.monthly_bill),
        'paid_amount':  0,
        'due_amount':   float(client.due_amount),
        'discount':     0,
        'status':       None,
        'due_date':     str(client.expiry_date) if client.expiry_date else None,
        'notes':        '',
        'is_auto':      True,
        'all_bill_ids': [],
    }


def _client_billing_result(client, bill_data, last_pay, pending):
    """bill_data + client fields merge → final result row dict।"""
    return {
        **bill_data,
        'client':               client.id,
        'client_customer_id':   client.customer_id,
        'client_is_app_user':   client.is_app_user,   # ® badge — অ্যাপে রেজিস্টার্ড কিনা
        'client_name':          client.full_name,
        'client_phone':         client.phone,
        'client_username':      client.username,
        'client_zone':          client.zone.name       if client.zone     else '',
        'client_subzone':       client.subzone.name    if client.subzone  else '',
        'client_box':           client.box.name        if client.box      else '',
        'client_package':       client.package.name    if client.package  else '',
        'client_protocol_type': client.protocol.name   if client.protocol else '',
        'client_monthly_bill':  float(client.monthly_bill),
        'client_expiry':        str(client.expiry_date) if client.expiry_date else None,
        'client_status':        client.status,
        'client_ip':            client.ip_address,
        'client_server':        client.router.name if client.router else '',
        'router_name':          client.router.name if client.router else '',
        'client_balance_due':   float(client.due_amount),
        'advance_amount':       float(client.advance_balance),
        'last_payment_date':    last_pay.payment_date.date() if last_pay else None,
        'last_payment_method':  last_pay.payment_method      if last_pay else None,
        'has_pending_payment':  pending,
    }


def _check_bill_edit_permission(request, old):
    """Paid/Partial (financially sensitive) বিল edit — Admin/Superadmin + reason বাধ্যতামূলক।
    Returns edit_reason; permission fail-এ raise। save()-এর আগে check (partial persist এড়াতে)।"""
    from decimal import Decimal
    from rest_framework.exceptions import PermissionDenied, ValidationError
    edit_reason = (request.data.get('reason') or '').strip()
    is_sensitive = (old.paid_amount or Decimal('0')) > Decimal('0')
    if is_sensitive:
        role = getattr(request.user, 'role', '')
        if role not in ('admin', 'superadmin'):
            raise PermissionDenied('Paid/Partial বিল edit শুধু Admin/Superadmin করতে পারবে।')
        if not edit_reason:
            raise ValidationError({'reason': 'Paid/Partial বিল edit-এ কারণ (reason) দেওয়া বাধ্যতামূলক।'})
    return edit_reason


def _recalc_bill_due_status(instance):
    """net_amount বদলালে due_amount ও status recalculate + save।"""
    from decimal import Decimal
    new_due = max(instance.net_amount - instance.paid_amount, Decimal('0'))
    instance.due_amount = new_due
    if new_due <= 0 and instance.paid_amount > 0:
        instance.status = 'paid'
    elif instance.paid_amount > 0:
        instance.status = 'partial'
    else:
        instance.status = 'unpaid'
    instance.save(update_fields=['due_amount', 'status'])


def _refund_overpay_to_advance(client, instance, old_net):
    """Paid বিলের net কমানো হলে overpay (paid − net) advance_balance-এ ফেরত।
    Returns refunded amount (net বাড়ানো বা অপরিবর্তিত হলে 0 — idempotent)।"""
    from decimal import Decimal
    paid          = instance.paid_amount or Decimal('0')
    old_overpay   = max(paid - old_net, Decimal('0'))
    new_overpay   = max(paid - instance.net_amount, Decimal('0'))
    overpay_delta = new_overpay - old_overpay
    if overpay_delta > Decimal('0'):
        client.advance_balance = (client.advance_balance or Decimal('0')) + overpay_delta
        client.save(update_fields=['advance_balance'])
        return overpay_delta
    return Decimal('0')


def _log_bill_update(client, instance, snapshot, refunded, edit_reason, performer):
    """bill edit-এর change-diff activity log।"""
    from decimal import Decimal
    from clients.activity import log_client_activity
    performer_name = getattr(performer, 'full_name', '') or performer.username
    changes = []
    if snapshot['amount']   != instance.amount:     changes.append(f'Amount: ৳{snapshot["amount"]}→৳{instance.amount}')
    if snapshot['discount'] != instance.discount:   changes.append(f'Discount: ৳{snapshot["discount"]}→৳{instance.discount}')
    if snapshot['net']      != instance.net_amount: changes.append(f'Net: ৳{snapshot["net"]}→৳{instance.net_amount}')
    if snapshot['due_date'] != instance.due_date:   changes.append(f'DueDate: {snapshot["due_date"]}→{instance.due_date}')
    if snapshot['status']   != instance.status:     changes.append(f'Status: {snapshot["status"]}→{instance.status}')
    if refunded > Decimal('0'):                     changes.append(f'Overpaid ৳{refunded} → advance_balance')
    try:
        log_client_activity(
            client, 'bill_updated',
            title=f'বিল আপডেট — {instance.bill_month}',
            description=(
                f'{" | ".join(changes) if changes else "কোনো পরিবর্তন নেই"} | '
                + (f'Reason: {edit_reason} | ' if edit_reason else '')
                + f'Updated by: {performer_name}'
            ),
            amount=instance.net_amount,
            performed_by=performer_name,
            user=performer,
        )
    except Exception:
        pass


class BillViewSet(viewsets.ModelViewSet):
    # বিল CRUD API
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = BillPagination
    filterset_fields = ['status', 'client', 'bill_month']
    search_fields = ['client__full_name', 'client__customer_id', 'bill_month']
    ordering_fields = ['bill_month', 'created_at', 'net_amount']

    def get_queryset(self):
        qs = Bill.objects.select_related('client', 'client__zone', 'client__subzone', 'client__box', 'client__package', 'client__router').order_by('-bill_month')
        p = self.request.query_params

        # billing_status বা status উভয় প্যারামই গ্রহণ করে
        bill_status = p.get('billing_status') or p.get('status')
        if bill_status:
            qs = qs.filter(status=bill_status)

        if p.get('zone'):
            qs = qs.filter(client__zone_id=p['zone'])
        if p.get('subzone'):
            qs = qs.filter(client__subzone_id=p['subzone'])
        if p.get('box'):
            qs = qs.filter(client__box_id=p['box'])
        if p.get('package'):
            qs = qs.filter(client__package_id=p['package'])
        if p.get('client_type'):
            qs = qs.filter(client__client_type_id=p['client_type'])
        if p.get('server'):
            qs = qs.filter(client__router_id=p['server'])
        if p.get('protocol'):
            qs = qs.filter(client__protocol_id=p['protocol'])
        if p.get('expiry_from'):
            qs = qs.filter(client__expiry_date__gte=p['expiry_from'])
        if p.get('expiry_to'):
            qs = qs.filter(client__expiry_date__lte=p['expiry_to'])
        if p.get('date_from'):
            qs = qs.filter(created_at__date__gte=p['date_from'])
        if p.get('date_to'):
            qs = qs.filter(created_at__date__lte=p['date_to'])
        if p.get('client'):
            qs = qs.filter(client_id=p['client'])
        if p.get('bill_month'):
            qs = qs.filter(bill_month=p['bill_month'])

        return qs

    def get_serializer_class(self):
        if self.action == 'create':
            return BillCreateSerializer
        return BillSerializer

    def perform_create(self, serializer):
        from decimal import Decimal
        from clients.activity import log_client_activity
        instance = serializer.save()
        # due_amount = net_amount (নতুন বিলে paid_amount = 0)
        instance.due_amount = instance.net_amount
        instance.status     = 'unpaid'
        instance.save(update_fields=['due_amount', 'status'])
        # client due_amount sync
        client = instance.client
        from billing.models import recalc_client_due_amount
        recalc_client_due_amount(client)
        # ── Activity Log ──
        performer = self.request.user
        performer_name = getattr(performer, 'full_name', '') or performer.username
        try:
            log_client_activity(
                client, 'bill_generated',
                title=f'বিল তৈরি — {instance.bill_month}',
                description=(
                    f'Amount: ৳{instance.amount} | Discount: ৳{instance.discount} | '
                    f'Net: ৳{instance.net_amount} | Due Date: {instance.due_date or "N/A"} | '
                    f'Source: Manual (Admin)'
                ),
                amount=instance.net_amount,
                performed_by=performer_name,
                user=performer,
            )
        except Exception:
            pass

    def destroy(self, request, *args, **kwargs):
        # Bill delete নীতি:
        #   - শুধুমাত্র Superadmin এবং শুধুমাত্র paid_amount == 0 (কোনো পেমেন্ট জড়িত নয়) বিল
        #     হার্ড-ডিলিট করতে পারবে। তখন accounting/collection record অক্ষত থাকে।
        #   - যেকোনো paid/partial বিলে delete নিষিদ্ধ — Waive ব্যবহার করতে হবে (Payment
        #     মডেল on_delete=CASCADE হওয়ায় delete করলে পেমেন্ট রেকর্ডও মুছে হিসাব নষ্ট হতো)।
        from decimal import Decimal

        if getattr(request.user, 'role', '') != 'superadmin':
            return Response(
                {'error': 'শুধুমাত্র Superadmin বিল delete করতে পারবে।'},
                status=status.HTTP_403_FORBIDDEN,
            )

        bill = self.get_object()
        if (bill.paid_amount or Decimal('0')) > Decimal('0'):
            return Response(
                {'error': 'পরিশোধিত (paid/partial) বিল delete করা যাবে না। Waive ব্যবহার করুন।'},
                status=status.HTTP_405_METHOD_NOT_ALLOWED,
            )

        client = bill.client
        bill.delete()

        # client-এর মোট due_amount recalculate (delete হওয়া বিলের due বাদ দিয়ে)
        from billing.models import recalc_client_due_amount
        recalc_client_due_amount(client)

        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='waive')
    def waive_bill(self, request, pk=None):
        # Bill waive করে — due_amount শূন্য হয়, record থাকে। শুধু admin/superadmin পারবে।
        from decimal import Decimal
        from billing.models import _auto_enable_client_if_paid
        from clients.activity import log_client_activity

        ALLOWED = ('admin', 'superadmin')
        if getattr(request.user, 'role', '') not in ALLOWED:
            return Response({'error': 'শুধুমাত্র Admin/Superadmin bill waive করতে পারবে।'}, status=status.HTTP_403_FORBIDDEN)

        bill = self.get_object()
        if bill.status == 'waived':
            return Response({'error': 'এই bill ইতোমধ্যে waived।'}, status=status.HTTP_400_BAD_REQUEST)

        performer = request.user
        performer_name = getattr(performer, 'full_name', '') or performer.username
        prev_due = bill.due_amount
        waive_reason = (request.data.get('reason') or '').strip()

        bill.status     = 'waived'
        bill.due_amount = Decimal('0')
        bill.save(update_fields=['status', 'due_amount'])

        # client-এর মোট due_amount recalculate
        client = bill.client
        from billing.models import recalc_client_due_amount
        recalc_client_due_amount(client)

        # সব বকেয়া শোধ হলে auto-enable
        _auto_enable_client_if_paid(client)

        try:
            log_client_activity(
                client, 'bill_updated',
                title=f'বিল মওকুফ (Waived) — {bill.bill_month}',
                description=(
                    f'Net: ৳{bill.net_amount} | পূর্ববর্তী Due: ৳{prev_due} | '
                    + (f'Reason: {waive_reason} | ' if waive_reason else '')
                    + f'Waived by: {performer_name}'
                ),
                amount=bill.net_amount,
                performed_by=performer_name,
                user=performer,
            )
        except Exception:
            pass

        from billing.api.serializers import BillSerializer
        return Response(BillSerializer(bill).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='unwaive')
    def unwaive_bill(self, request, pk=None):
        # Waive বাতিল করে বিল আবার আগের অবস্থায় ফেরায় — due/status নতুন করে হিসাব হয়।
        # শুধু admin/superadmin পারবে। paid_amount অনুযায়ী paid/partial/unpaid নির্ধারিত হয়।
        from decimal import Decimal
        from clients.activity import log_client_activity

        ALLOWED = ('admin', 'superadmin')
        if getattr(request.user, 'role', '') not in ALLOWED:
            return Response({'error': 'শুধুমাত্র Admin/Superadmin Waive বাতিল করতে পারবে।'}, status=status.HTTP_403_FORBIDDEN)

        bill = self.get_object()
        if bill.status != 'waived':
            return Response({'error': 'এই bill waived নয়, তাই বাতিল করার কিছু নেই।'}, status=status.HTTP_400_BAD_REQUEST)

        performer = request.user
        performer_name = getattr(performer, 'full_name', '') or performer.username

        # net − paid দিয়ে due ও status আবার নির্ধারণ (waive করার আগের যুক্তির মতোই)
        new_due = max((bill.net_amount or Decimal('0')) - (bill.paid_amount or Decimal('0')), Decimal('0'))
        bill.due_amount = new_due
        if new_due <= 0 and (bill.paid_amount or Decimal('0')) > 0:
            bill.status = 'paid'
        elif (bill.paid_amount or Decimal('0')) > 0:
            bill.status = 'partial'
        else:
            bill.status = 'unpaid'
        bill.save(update_fields=['status', 'due_amount'])

        # client-এর মোট due_amount recalculate
        client = bill.client
        from billing.models import recalc_client_due_amount
        recalc_client_due_amount(client)

        try:
            log_client_activity(
                client, 'bill_updated',
                title=f'Waive বাতিল (Restored) — {bill.bill_month}',
                description=(
                    f'Net: ৳{bill.net_amount} | নতুন Status: {bill.status} | নতুন Due: ৳{new_due} | '
                    f'Restored by: {performer_name}'
                ),
                amount=bill.net_amount,
                performed_by=performer_name,
                user=performer,
            )
        except Exception:
            pass

        from billing.api.serializers import BillSerializer
        return Response(BillSerializer(bill).data, status=status.HTTP_200_OK)

    def perform_update(self, serializer):
        from decimal import Decimal
        from billing.models import _auto_enable_client_if_paid

        # পুরনো values সংরক্ষণ (diff log-এর জন্য)
        old = serializer.instance
        snapshot = {'amount': old.amount, 'discount': old.discount, 'net': old.net_amount,
                    'due_date': old.due_date, 'status': old.status}
        old_net = old.net_amount

        # ── Paid/Partial বিল edit: role gate + বাধ্যতামূলক reason (save()-এর আগে) ──
        edit_reason = _check_bill_edit_permission(self.request, old)

        instance = serializer.save()
        # net_amount পরিবর্তন হলে due_amount ও status recalculate
        _recalc_bill_due_status(instance)
        client = instance.client

        # ── Paid বিলের net কমানো হলে অতিরিক্ত টাকা advance_balance-এ ফেরত ──
        refunded = _refund_overpay_to_advance(client, instance, old_net)

        # client due_amount sync
        from billing.models import recalc_client_due_amount
        recalc_client_due_amount(client)

        # ফেরত আসা advance অন্য বকেয়া বিলে auto-apply (থাকলে)
        if refunded > Decimal('0'):
            from billing.services import BillingService
            BillingService.apply_advance_to_bills(client)
            client.refresh_from_db()

        # সব বকেয়া শোধ হলে client auto-enable
        _auto_enable_client_if_paid(client)
        # ── Activity Log ──
        _log_bill_update(client, instance, snapshot, refunded, edit_reason, self.request.user)

    @action(detail=False, methods=['post'], url_path='generate-monthly')
    def generate_monthly_bills(self, request):
        # Expiry Date অনুযায়ী বিল generate করার API — bulk operation, শুধু admin/superadmin।
        # month পাঠালে শুধু সেই মাসের সব active ক্লায়েন্টের বিল তৈরি হবে (manual override)।
        ALLOWED = ('admin', 'superadmin')
        if getattr(request.user, 'role', '') not in ALLOWED:
            return Response({'error': 'শুধুমাত্র Admin/Superadmin bulk bill generate করতে পারবে।'}, status=status.HTTP_403_FORBIDDEN)
        from billing.services import BillingService
        month = request.data.get('month')
        if month:
            result = BillingService.generate_monthly_bills(month)
        else:
            result = BillingService.generate_bills_by_expiry_date()
        return Response(result)

    @action(detail=False, methods=['post'], url_path='generate-for-client')
    def generate_for_client(self, request):
        # custom amount দিয়ে bill তৈরি করা যায় বলে শুধু admin/superadmin পারবে।
        ALLOWED = ('admin', 'superadmin')
        if getattr(request.user, 'role', '') not in ALLOWED:
            return Response({'error': 'শুধুমাত্র Admin/Superadmin manually bill generate করতে পারবে।'}, status=status.HTTP_403_FORBIDDEN)
        from billing.services import BillingService
        from decimal import Decimal as _Dec
        client_id    = request.data.get('client_id')
        bill_month   = request.data.get('bill_month') or None
        notes        = request.data.get('notes', '')
        raw_amount   = request.data.get('amount')
        custom_amount = _Dec(str(raw_amount)) if raw_amount else None
        if not client_id:
            return Response(
                {'error': 'client_id is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        result = BillingService.generate_bill_for_client(
            int(client_id), bill_month, custom_amount, notes
        )
        if 'error' in result:
            return Response(result, status=status.HTTP_400_BAD_REQUEST)
        return Response(result, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], url_path='client-billing-view')
    def client_billing_view(self, request):
        """সব client দেখায় — বিল আছে বা নেই, সবাই লিস্টে থাকবে।"""
        from clients.models import Client
        from django.utils import timezone

        now      = timezone.now()
        p        = request.query_params
        month    = p.get('bill_month', '')
        page     = max(int(p.get('page', 1)), 1)
        per_page = min(int(p.get('page_size', 20)), 500)

        qs = Client.objects.select_related(
            'zone', 'subzone', 'package', 'protocol', 'router', 'box', 'client_type'
        ).exclude(status__in=['left', 'cancelled'])
        qs = _filter_client_billing_qs(qs, p, month, now)

        total   = qs.count()
        offset  = (page - 1) * per_page
        clients = list(qs.order_by('customer_id')[offset: offset + per_page])
        c_ids   = [c.id for c in clients]

        bill_qs = Bill.objects.filter(client_id__in=c_ids)
        if month:
            bill_qs = bill_qs.filter(bill_month=month)
        bills_map = {}
        for b in bill_qs.order_by('-bill_month'):
            bills_map.setdefault(b.client_id, []).append(b)

        last_pay_map    = {}
        pending_pay_map = {}
        for pay in Payment.objects.filter(
            bill__client_id__in=c_ids
        ).select_related('bill').order_by('-payment_date'):
            cid = pay.bill.client_id
            if cid not in last_pay_map:
                last_pay_map[cid] = pay
            if not pay.is_verified:
                pending_pay_map[cid] = True

        results = []
        for client in clients:
            c_bills = bills_map.get(client.id, [])
            bill_data = _bill_row_data(client, c_bills, month, now)
            results.append(_client_billing_result(
                client, bill_data,
                last_pay_map.get(client.id), pending_pay_map.get(client.id, False)))

        return Response({'count': total, 'results': results})

    @action(detail=False, methods=['get'], url_path='collection-summary')
    def collection_summary(self, request):
        from decimal import Decimal
        month = request.query_params.get('month') or None
        qs = Bill.objects.all()
        if month:
            qs = qs.filter(bill_month=month)
        data = qs.aggregate(
            total_billed=Sum('net_amount'),
            total_collected=Sum('paid_amount'),
            total_due=Sum('due_amount'),
            total_bills=Count('id'),
            paid_count=Count('id', filter=Q(status='paid')),
            unpaid_count=Count('id', filter=Q(status='unpaid')),
            partial_count=Count('id', filter=Q(status='partial')),
        )
        # আগে প্রতি distinct client-এর জন্য আলাদা aggregate query চলত (N+1) —
        # বড় client base-এ collection-summary endpoint-এ হাজারো round-trip হতো।
        # একটাই values().annotate() দিয়ে সব client-এর totals একসাথে আনা হচ্ছে।
        client_ids = list(qs.values_list('client_id', flat=True).distinct())
        advance_amount = Decimal('0')
        if client_ids:
            per_client_totals = Bill.objects.filter(client_id__in=client_ids).values(
                'client_id'
            ).annotate(
                due=Sum('due_amount'),
                net=Sum('net_amount'),
                paid=Sum('paid_amount'),
            )
            for row in per_client_totals:
                total_due = row['due'] or Decimal('0')
                if total_due > 0:
                    continue
                total_net = row['net'] or Decimal('0')
                total_paid = row['paid'] or Decimal('0')
                advance_amount += max(total_paid - total_net, Decimal('0'))
        data['advance_amount'] = advance_amount
        return Response(data)

    @action(detail=True, methods=['get'], url_path='payments')
    def bill_payments(self, request, pk=None):
        bill = self.get_object()
        payments = bill.payments.select_related('received_by').order_by('-payment_date')
        from billing.api.serializers import PaymentSerializer
        return Response(PaymentSerializer(payments, many=True).data)


def _is_webhook_payment(payment, notes):
    """Webhook auto-processed payment কিনা (notes prefix বা webhook_source)।"""
    return (
        notes.startswith('bKash SNS') or
        notes.startswith('Webhook Auto') or
        notes.startswith('Webhook') or
        payment.webhook_source.exists()
    )


def _payment_client(payment):
    """payment-এর client — bill.client আগে, নাহলে direct client FK; কিছু না থাকলে None।"""
    if payment.bill and payment.bill.client:
        return payment.bill.client
    return payment.client


def _reverse_advance_on_delete(payment, client, pay_amount):
    """advance payment (bill=None) delete-এ client.advance_balance থেকে কমাও —
    নাহলে ভুয়া advance balance থেকে যায় ও পরে auto-apply হয়ে ISP লজিক ভাঙে।"""
    if payment.bill_id is None and client:
        from decimal import Decimal as _Dec
        client.advance_balance = max(
            (client.advance_balance or _Dec('0')) - _Dec(str(pay_amount)),
            _Dec('0'))
        client.save(update_fields=['advance_balance'])


def _resolve_received_by(payment, received_by_raw, notes_raw):
    """received_by (emp: prefix বা user id) resolve — notes-এ [গৃহীত: Name] সেট/clean।
    user id হলে payment.received_by mutate করে। Returns updated notes_raw।"""
    import re as _re
    if not received_by_raw:
        return notes_raw
    raw = str(received_by_raw)
    if raw.startswith('emp:'):
        from hr.models import Employee
        try:
            emp = Employee.objects.get(id=raw[4:])
            notes_clean = _re.sub(r'^\[গৃহীত: .+?\]\s*', '', notes_raw).strip()
            notes_raw   = f"[গৃহীত: {emp.full_name}] {notes_clean}".strip()
        except Employee.DoesNotExist:
            pass
    elif raw.isdigit():
        from accounts.models import User as _User
        new_user = _User.objects.filter(pk=raw).first()
        if new_user:
            payment.received_by = new_user
            notes_raw = _re.sub(r'^\[গৃহীত: .+?\]\s*', '', notes_raw).strip()
    return notes_raw


def _apply_payment_amount_change(payment, amount_raw, update_fields):
    """amount বদলালে payment.amount update + save + bill recalc → PaymentSerializer Response;
    নাহলে None (caller normal save করবে)।"""
    from decimal import Decimal, InvalidOperation
    if amount_raw is None:
        return None
    try:
        new_amount = Decimal(str(amount_raw))
        if new_amount > 0 and new_amount != payment.amount:
            payment.amount = new_amount
            update_fields.append('amount')
            payment.save(update_fields=update_fields)
            # bill ও client due recalculate
            if payment.bill:
                Payment.recalculate_bill_and_client(payment.bill)
            from billing.api.serializers import PaymentSerializer
            return Response(PaymentSerializer(payment).data)
    except (InvalidOperation, ValueError):
        pass
    return None


class PaymentViewSet(viewsets.ModelViewSet):
    queryset = Payment.objects.all()  # router basename detection-এর জন্য
    serializer_class = PaymentSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['payment_method', 'is_verified']  # bill__client → get_queryset-এ Q() দিয়ে handle
    search_fields = ['bill__client__full_name', 'bill__client__customer_id', 'bill__client__username', 'transaction_id']
    ordering_fields = ['payment_date', 'amount']

    def destroy(self, request, *args, **kwargs):
        """
        Manual payment delete — সম্পূর্ণ log রাখা হয়।
        Webhook auto-processed payments delete করা যাবে না। শুধু admin/superadmin পারবে।
        """
        from clients.activity import log_client_activity

        ALLOWED = ('admin', 'superadmin')
        if getattr(request.user, 'role', '') not in ALLOWED:
            return Response({'error': 'শুধুমাত্র Admin/Superadmin payment delete করতে পারবে।'}, status=status.HTTP_403_FORBIDDEN)

        payment = self.get_object()
        notes   = payment.notes or ''

        # ── Webhook payment block ─────────────────────────────────────────
        if _is_webhook_payment(payment, notes):
            return Response(
                {'error': 'Webhook payment delete করা যাবে না। Webhook Payments পেজ থেকে manage করুন।'},
                status=status.HTTP_403_FORBIDDEN,
            )

        # ── Delete-এর আগে সব তথ্য সংরক্ষণ করো ─────────────────────────
        performer      = request.user
        performer_name = getattr(performer, 'full_name', '') or performer.username
        pay_id         = payment.id
        pay_amount     = payment.amount
        pay_method     = payment.payment_method
        pay_date       = payment.payment_date
        pay_trx_id     = payment.transaction_id or '—'
        pay_notes      = notes[:100]
        pay_verified   = payment.is_verified

        # client বের করো (bill linked বা direct client FK)
        client = _payment_client(payment)

        # bill recalculate-এর জন্য bill reference রেখে দাও
        bill = payment.bill

        # ── advance payment (bill=None) → client.advance_balance থেকে কমাও ──
        _reverse_advance_on_delete(payment, client, pay_amount)

        # ── Delete ───────────────────────────────────────────────────────
        payment.delete()

        # ── Bill recalculate ─────────────────────────────────────────────
        if bill:
            try:
                from billing.models import Payment as _Pay
                _Pay.recalculate_bill_and_client(bill)
            except Exception:
                pass

        # ── Activity Log ─────────────────────────────────────────────────
        if client:
            log_client_activity(
                client,
                event_type='payment_deleted',
                title=f'Payment Deleted — ৳{pay_amount}',
                description=(
                    f'Payment ID: {pay_id} | '
                    f'Amount: ৳{pay_amount} | '
                    f'Method: {pay_method} | '
                    f'Date: {pay_date.strftime("%Y-%m-%d %H:%M") if pay_date else "—"} | '
                    f'TrxID: {pay_trx_id} | '
                    f'Verified: {"Yes" if pay_verified else "No"} | '
                    f'Note: {pay_notes} | '
                    f'Deleted by: {performer_name}'
                ),
                amount=pay_amount,
                performed_by=performer_name,
                user=performer,
            )

        return Response(status=status.HTTP_204_NO_CONTENT)

    def get_queryset(self):
        qs = Payment.objects.select_related(
            'bill', 'bill__client', 'client', 'received_by', 'approved_by', 'created_by'
        ).order_by('-payment_date')
        p = self.request.query_params
        # Client Profile Bill History: bill__client=id → সব payment দেখাবে (webhook সহ)
        if p.get('bill__client'):
            cid = p['bill__client']
            return qs.filter(Q(bill__client_id=cid) | Q(client_id=cid))
        # Daily Collection (Collected Bills tab): সব ধরনের gateway/webhook payment বাদ —
        # এগুলো Webhook Payments tab-এ দেখায়, manual collection নয়।
        qs = qs.filter(webhook_source__isnull=True).exclude(
            Q(notes__startswith='bKash SNS') |
            Q(notes__startswith='Webhook Auto') |
            Q(notes__startswith='Webhook Payment Transfer') |
            Q(notes__startswith='[bKash App]')
        )
        # date_from / date_to: local date (Asia/Dhaka) → UTC range convert করে filter
        # Frontend local date পাঠায়, payment_date UTC-তে store → make_aware দিয়ে সঠিক range বানাই
        from datetime import datetime, time as dtime
        from django.utils import timezone as _tz
        if p.get('date_from'):
            try:
                d = datetime.strptime(p['date_from'], '%Y-%m-%d').date()
                qs = qs.filter(payment_date__gte=_tz.make_aware(datetime.combine(d, dtime.min)))
            except Exception:
                pass
        if p.get('date_to'):
            try:
                d = datetime.strptime(p['date_to'], '%Y-%m-%d').date()
                qs = qs.filter(payment_date__lte=_tz.make_aware(datetime.combine(d, dtime.max)))
            except Exception:
                pass
        if p.get('bill_month'):
            qs = qs.filter(bill__bill_month=p['bill_month'])
        if p.get('username'):
            qs = qs.filter(
                Q(bill__client__username__icontains=p['username']) |
                Q(bill__client__customer_id__icontains=p['username']) |
                Q(bill__client__full_name__icontains=p['username'])
            )
        if p.get('received_by'):
            qs = qs.filter(received_by_id=p['received_by'])
        if p.get('approved_by'):
            qs = qs.filter(approved_by_id=p['approved_by'])
        if p.get('created_by'):
            qs = qs.filter(created_by_id=p['created_by'])
        if p.get('trans_status') == 'approved':
            qs = qs.filter(is_verified=True)
        if p.get('trans_status') == 'pending':
            qs = qs.filter(is_verified=False)
        return qs

    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request):
        qs = self.get_queryset()
        data = qs.aggregate(
            total_payments=Count('id'),
            total_amount=Sum('amount'),
            cash_amount=Sum('amount', filter=Q(payment_method='cash')),
            bkash_amount=Sum('amount', filter=Q(payment_method='bkash')),
            nagad_amount=Sum('amount', filter=Q(payment_method='nagad')),
            online_amount=Sum('amount', filter=~Q(payment_method='cash')),
        )
        return Response(data)

    def perform_create(self, serializer):
        received_by_id = self.request.data.get('received_by')
        received_by = self.request.user
        if received_by_id:
            from accounts.models import User
            received_by = User.objects.filter(pk=received_by_id).first() or self.request.user

        # superadmin / admin রিসিভ করলে সাথে সাথেই verified — approval লাগবে না।
        # worker / collector রিসিভ করলে is_verified=False, admin-কে approve করতে হবে।
        ADMIN_ROLES = ('superadmin', 'admin')
        creator_role = getattr(self.request.user, 'role', '')
        if creator_role in ADMIN_ROLES:
            is_verified = True
            approved_by = self.request.user
        else:
            is_verified = False
            approved_by = None

        payment = serializer.save(
            received_by=received_by,
            created_by=self.request.user,
            is_verified=is_verified,
            approved_by=approved_by,
        )
        try:
            from sms_service.services import SMSService
            SMSService.send_payment_confirmation(payment)
        except Exception:
            pass

    @action(detail=False, methods=['get'], url_path='collection-summary')
    def collection_summary(self, request):
        qs = self.get_queryset()
        data = qs.aggregate(
            received=Sum('amount'),
            discount=Sum('bill__discount'),
            due=Sum('bill__due_amount'),
            total=Count('id'),
            approved=Count('id', filter=Q(is_verified=True)),
            pending=Count('id', filter=Q(is_verified=False)),
        )
        return Response(data)

    @action(detail=False, methods=['post'], url_path='receive')
    def receive_payment(self, request):
        """
        ক্লায়েন্টের জন্য পেমেন্ট রিসিভ করে।
        Due bills গুলো oldest-first কাটে, বাকি → advance_balance।

        Request: { client_id, amount, payment_method, transaction_id, notes, received_by (optional) }
        """
        from decimal import Decimal
        from billing.services import BillingService
        from clients.models import Client

        # billing-এর সাথে সম্পর্কহীন role (যেমন 'support') বাদে সব staff role পারবে —
        # এই codebase-এ collector-এর zone/subzone assignment track করার কোনো data
        # model নেই (Employee/User কোনোটাতেই zone FK নেই), তাই per-zone scoping সম্ভব
        # না; role-level gate দিয়ে অন্তত সম্পূর্ণ-অসম্পর্কিত account-এর payment-রেকর্ড
        # করা আটকানো হলো।
        ALLOWED_ROLES = ('superadmin', 'admin', 'manager', 'accountant', 'collector')
        if getattr(request.user, 'role', '') not in ALLOWED_ROLES:
            return Response(
                {'error': 'আপনার payment রেকর্ড করার অনুমতি নেই।'},
                status=status.HTTP_403_FORBIDDEN,
            )

        client_id      = request.data.get('client_id')
        amount_raw     = request.data.get('amount')
        payment_method = request.data.get('payment_method', 'cash')
        transaction_id = request.data.get('transaction_id', '')
        notes          = request.data.get('notes', '')

        if not client_id or not amount_raw:
            return Response(
                {'error': 'client_id এবং amount দেওয়া আবশ্যক।'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            client = Client.objects.get(id=client_id)
        except Client.DoesNotExist:
            return Response({'error': 'Client পাওয়া যায়নি।'}, status=status.HTTP_404_NOT_FOUND)

        try:
            amount = Decimal(str(amount_raw))
            if amount <= 0:
                raise ValueError
        except Exception:
            return Response({'error': 'সঠিক amount দিন।'}, status=status.HTTP_400_BAD_REQUEST)

        # received_by নির্ধারণ
        # value হতে পারে: user_id (int/str) অথবা "emp:<employee_id>"
        received_by_raw = request.data.get('received_by', '')
        received_by = request.user
        if received_by_raw:
            raw = str(received_by_raw)
            if raw.startswith('emp:'):
                # User account নেই এমন Employee — নাম notes-এ যোগ করো
                from hr.models import Employee
                try:
                    emp = Employee.objects.get(id=raw[4:])
                    notes = f"[গৃহীত: {emp.full_name}] {notes}".strip()
                except Employee.DoesNotExist:
                    pass
                received_by = request.user   # fallback to logged-in user
            elif raw.isdigit():
                from accounts.models import User
                received_by = User.objects.filter(pk=raw).first() or request.user

        # admin/superadmin → সরাসরি verified; worker/collector → pending approval
        ADMIN_ROLES = ('superadmin', 'admin')
        creator_role = getattr(request.user, 'role', '')
        is_verified  = creator_role in ADMIN_ROLES
        approved_by  = request.user if is_verified else None

        result = BillingService.receive_payment(
            client=client,
            amount=amount,
            payment_method=payment_method,
            received_by=received_by,
            notes=notes,
            transaction_id=transaction_id,
            is_verified=is_verified,
            approved_by=approved_by,
        )
        return Response(result, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='approve-selected')
    def approve_selected(self, request):
        # Pending (collector-received) payment approve করলে bill/client due_amount
        # আপডেট হয় ও client auto-enable হয় — শুধু admin/superadmin পারবে, নইলে
        # collector নিজের জমা দেওয়া fake/pending payment নিজেই approve করতে পারত।
        ALLOWED = ('admin', 'superadmin')
        if getattr(request.user, 'role', '') not in ALLOWED:
            return Response({'error': 'শুধুমাত্র Admin/Superadmin payment approve করতে পারবে।'}, status=status.HTTP_403_FORBIDDEN)

        ids = request.data.get('ids') or []
        if not ids:
            return Response({'error': 'ids is required.'}, status=status.HTTP_400_BAD_REQUEST)
        # bulk .update() দিয়ে Payment.save() bypass হয়, তাই bill recalculate হয় না।
        # প্রতিটি payment আলাদাভাবে .save() করতে হবে যাতে just_verified logic চলে।
        payments = Payment.objects.filter(
            id__in=ids, is_verified=False
        ).select_related('bill', 'bill__client')
        updated = 0
        for payment in payments:
            payment.is_verified = True
            payment.approved_by = request.user
            payment.save()  # triggers recalculate_bill_and_client + _auto_enable_client_if_paid
            updated += 1
        return Response({'updated': updated})

    @action(detail=True, methods=['patch'], url_path='update-info')
    def update_info(self, request, pk=None):
        """
        Payment সম্পূর্ণ সংশোধন। শুধু Admin/Superadmin পারবে।
        Request: { received_by, notes, payment_method, transaction_id, amount }
        amount পরিবর্তন হলে bill ও client due_amount স্বয়ংক্রিয় recalculate হবে।
        """
        ALLOWED = ('admin', 'superadmin')
        if getattr(request.user, 'role', '') not in ALLOWED:
            return Response({'error': 'শুধুমাত্র Admin/Superadmin payment তথ্য সংশোধন করতে পারবে।'}, status=status.HTTP_403_FORBIDDEN)

        payment = self.get_object()
        data = request.data

        # ── received_by (emp: prefix সহ) ──
        received_by_raw = data.get('received_by', '')
        notes_raw = data.get('notes', payment.notes or '')
        notes_raw = _resolve_received_by(payment, received_by_raw, notes_raw)

        # ── সরল field update ──
        payment.notes          = notes_raw
        if data.get('payment_method'):
            payment.payment_method = data['payment_method']
        if 'transaction_id' in data:
            payment.transaction_id = data['transaction_id']

        update_fields = ['received_by', 'notes', 'payment_method', 'transaction_id']

        # ── amount পরিবর্তন হলে bill recalculate ──
        resp = _apply_payment_amount_change(payment, data.get('amount'), update_fields)
        if resp is not None:
            return resp

        payment.save(update_fields=update_fields)
        from billing.api.serializers import PaymentSerializer
        return Response(PaymentSerializer(payment).data)

    @action(detail=False, methods=['post'], url_path='delete-selected')
    def delete_selected(self, request):
        # single destroy()-এর মতোই role-check + webhook-payment guard + advance
        # reversal প্রযোজ্য — নইলে bulk endpoint দিয়ে সেই সুরক্ষাগুলো bypass হয়ে যেত।
        ALLOWED = ('admin', 'superadmin')
        if getattr(request.user, 'role', '') not in ALLOWED:
            return Response({'error': 'শুধুমাত্র Admin/Superadmin payment delete করতে পারবে।'}, status=status.HTTP_403_FORBIDDEN)

        ids = request.data.get('ids') or []
        if not ids:
            return Response({'error': 'ids is required.'}, status=status.HTTP_400_BAD_REQUEST)
        qs = Payment.objects.filter(id__in=ids).select_related('bill', 'bill__client', 'client')
        deleted = 0
        blocked = 0
        for payment in qs:
            notes = payment.notes or ''
            if _is_webhook_payment(payment, notes):
                blocked += 1
                continue
            client = _payment_client(payment)
            _reverse_advance_on_delete(payment, client, payment.amount)
            payment.delete()
            deleted += 1
        resp = {'deleted': deleted}
        if blocked:
            resp['blocked'] = blocked
            resp['message'] = f'{blocked}টা webhook payment delete করা যায়নি — Webhook Payments পেজ থেকে manage করুন।'
        return Response(resp)


class InstallationFeeViewSet(viewsets.ModelViewSet):
    queryset = InstallationFee.objects.select_related('client').all()
    serializer_class = InstallationFeeSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['client']

    def perform_create(self, serializer):
        serializer.save(received_by=self.request.user)


class DailyCollectionViewSet(viewsets.ModelViewSet):
    queryset = DailyCollection.objects.select_related('collected_by').order_by('-date')
    serializer_class = DailyCollectionSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['date']
    ordering_fields = ['date', 'total_collected']

    def get_queryset(self):
        qs = DailyCollection.objects.select_related('collected_by').order_by('-date')
        p = self.request.query_params
        if p.get('date_from'):
            qs = qs.filter(date__gte=p['date_from'])
        if p.get('date_to'):
            qs = qs.filter(date__lte=p['date_to'])
        if p.get('month'):
            qs = qs.filter(date__startswith=p['month'])
        return qs

    def perform_create(self, serializer):
        serializer.save(collected_by=self.request.user)

    @action(detail=False, methods=['post'], url_path='generate')
    def generate(self, request):
        from django.utils.dateparse import parse_date
        date_str = request.data.get('date', timezone.now().date().isoformat())
        target_date = parse_date(date_str)
        if not target_date:
            return Response(
                {'error': 'সঠিক তারিখ দিন (YYYY-MM-DD)।'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        day_payments = Payment.objects.filter(payment_date__date=target_date)
        agg = day_payments.aggregate(
            total=Sum('amount'),
            cash=Sum('amount', filter=Q(payment_method='cash')),
            online=Sum('amount', filter=~Q(payment_method='cash')),
            count=Count('id'),
        )
        total     = agg['total']     or 0
        cash      = agg['cash']      or 0
        online    = agg['online']    or 0
        count     = agg['count']     or 0

        obj, created = DailyCollection.objects.update_or_create(
            date=target_date,
            defaults={
                'total_collected': total,
                'cash_amount':     cash,
                'online_amount':   online,
                'total_payments':  count,
                'collected_by':    request.user,
            }
        )
        serializer = self.get_serializer(obj)
        return Response({**serializer.data, 'created': created})

    @action(detail=False, methods=['get'], url_path='month-summary')
    def month_summary(self, request):
        month = request.query_params.get('month', timezone.now().strftime('%Y-%m'))
        qs = DailyCollection.objects.filter(date__startswith=month)
        data = qs.aggregate(
            days=Count('id'),
            total=Sum('total_collected'),
            cash=Sum('cash_amount'),
            online=Sum('online_amount'),
            payments=Sum('total_payments'),
        )
        return Response(data)


def _delete_payment_ledger(payment_id):
    """একটি payment-এর ledger entry (BILLPAY-<id>) ও Income record মুছে দেয় — reversal-এ।"""
    try:
        from accounting.models import JournalEntry, Income
        ref = f'BILLPAY-{payment_id}'
        JournalEntry.objects.filter(reference=ref).delete()  # JournalLine cascade
        Income.objects.filter(reference=ref).delete()
    except Exception:
        pass


def _reverse_previous_transfer(webhook):
    """
    এই webhook-এর আগের transfer-এ তৈরি Payment(গুলো) reverse করে double-count রোধ করে।
    - bill-attached payment → delete (recalculate_bill_and_client নিজে due ফেরত দেয়)
    - advance payment (bill=None) → client.advance_balance থেকে কমিয়ে delete
    - প্রতিটির ledger (BILLPAY-<id>) ও Income মুছে দেয়
    Returns: reverse হওয়া payment সংখ্যা।
    """
    from billing.models import Payment
    from decimal import Decimal
    prev_client = webhook.transferred_to
    if not prev_client:
        return 0
    prev_payments = list(Payment.objects.filter(
        transaction_id=webhook.transaction_id,
        notes__startswith='Webhook Payment Transfer',
        client=prev_client,
    ))
    count = 0
    for p in prev_payments:
        if p.bill_id is None:   # advance portion → advance_balance কমাও
            prev_client.advance_balance = max(
                (prev_client.advance_balance or Decimal('0')) - Decimal(str(p.amount)),
                Decimal('0'))
            prev_client.save(update_fields=['advance_balance'])
        _delete_payment_ledger(p.id)
        p.delete()   # bill-attached হলে Payment.delete → recalculate_bill_and_client
        count += 1
    return count


def _apply_webhook_amount_filter(qs, p):
    """amount_min/amount_max → payment_amount range filter (invalid হলে skip)।"""
    if p.get('amount_min'):
        try:
            qs = qs.filter(payment_amount__gte=float(p['amount_min']))
        except (ValueError, TypeError):
            pass
    if p.get('amount_max'):
        try:
            qs = qs.filter(payment_amount__lte=float(p['amount_max']))
        except (ValueError, TypeError):
            pass
    return qs


def _apply_webhook_date_filter(qs, p):
    """date_from/date_to (YYYY-MM-DD) → created_at range filter (invalid হলে skip)।"""
    from django.utils import timezone as tz
    from datetime import datetime, time as dtime
    if p.get('date_from'):
        try:
            d = datetime.strptime(p['date_from'], '%Y-%m-%d').date()
            qs = qs.filter(created_at__gte=tz.make_aware(datetime.combine(d, dtime.min)))
        except Exception:
            pass
    if p.get('date_to'):
        try:
            d = datetime.strptime(p['date_to'], '%Y-%m-%d').date()
            qs = qs.filter(created_at__lte=tz.make_aware(datetime.combine(d, dtime.max)))
        except Exception:
            pass
    return qs


def _apply_webhook_transfer(webhook, client, request_user, reversed_count, linked):
    """transfer history append + webhook record update (status/transferred_to/remarks/
    linked_payment)। Returns new settlement_status।"""
    from django.utils import timezone as _tzlog
    prev_status = webhook.settlement_status
    # টাকা এই transfer-এর আগে কোথায় ছিল (from):
    prev_holder = webhook.transferred_to or webhook.matched_client
    from_repr = (
        f"{prev_holder.customer_id} ({prev_holder.username})"
        if prev_holder else 'Unmatched / Gateway'
    )
    to_repr = f"{client.customer_id} ({client.username})"
    by_repr = request_user.full_name or request_user.username
    is_retransfer = bool(reversed_count) or prev_status in ('payment_transferred', 'payment_retransferred')

    history = list((webhook.raw_data or {}).get('transfer_history', []))
    history.append({
        'seq':        len(history) + 1,
        'action':     're-transfer' if is_retransfer else 'transfer',
        'from':       from_repr,
        'from_id':    getattr(prev_holder, 'customer_id', '') or '',
        'to':         to_repr,
        'to_id':      client.customer_id or '',
        'amount':     str(webhook.payment_amount),
        'by':         by_repr,
        'at':         _tzlog.localtime(_tzlog.now()).strftime('%Y-%m-%d %I:%M %p'),
        'reversed_previous': reversed_count,
    })

    new_status = 'payment_transferred' if prev_status != 'payment_transferred' else 'payment_retransferred'
    webhook.settlement_status  = new_status
    webhook.transferred_to     = client
    if linked:
        webhook.linked_payment = linked
    webhook.update_by          = request_user
    rd = dict(webhook.raw_data or {})
    rd['transfer_history'] = history
    webhook.raw_data = rd
    # remarks_note-এ পুরো log (নতুন → পুরনো ক্রমে), Info card-এ সরাসরি দেখাতে
    webhook.remarks_note = '\n'.join(
        f"#{h['seq']} [{h['action']}] {h['from']} → {h['to']} | ৳{h['amount']} "
        f"| by {h['by']} | {h['at']}"
        for h in reversed(history)
    )
    webhook.save()
    return new_status


class WebhookPaymentViewSet(viewsets.ModelViewSet):
    """Webhook Payment list, detail, transfer — Webhook Payments tab"""
    queryset = WebhookPayment.objects.select_related(
        'matched_client', 'transferred_to', 'update_by', 'linked_payment'
    ).order_by('-created_at')
    serializer_class = WebhookPaymentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params

        if p.get('gateway'):
            qs = qs.filter(gateway_type=p['gateway'])
        if p.get('settlement_status'):
            qs = qs.filter(settlement_status=p['settlement_status'])
        if p.get('trans_status'):
            qs = qs.filter(trans_status=p['trans_status'])
        if p.get('from_wallet'):
            qs = qs.filter(from_wallet__icontains=p['from_wallet'])
        if p.get('trans_reference'):
            qs = qs.filter(trans_reference__icontains=p['trans_reference'])
        qs = _apply_webhook_amount_filter(qs, p)
        if p.get('client'):
            qs = qs.filter(
                Q(matched_client_id=p['client']) | Q(transferred_to_id=p['client'])
            )
        qs = _apply_webhook_date_filter(qs, p)
        if p.get('search'):
            q = p['search']
            qs = qs.filter(
                Q(transaction_id__icontains=q) |
                Q(from_wallet__icontains=q) |
                Q(trans_reference__icontains=q)
            )
        return qs

    @action(detail=True, methods=['post'], url_path='transfer')
    def transfer_to_client(self, request, pk=None):
        """
        Manually transfer webhook payment to a specific client's bill.
        Request: { client_id: int }
        """
        from decimal import Decimal
        from clients.models import Client
        from billing.services import BillingService

        webhook = self.get_object()
        client_id = request.data.get('client_id')

        if not client_id:
            return Response({'error': 'client_id আবশ্যক।'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            client = Client.objects.get(pk=client_id)
        except Client.DoesNotExist:
            return Response({'error': 'Client পাওয়া যায়নি।'}, status=status.HTTP_404_NOT_FOUND)

        # Re-transfer হলে আগের transfer payment আগে reverse করো (double-count রোধ — 'move')।
        # আগের destination client থেকে টাকা ফেরত নিয়ে নতুন client-এ বসানো হবে।
        reversed_count = _reverse_previous_transfer(webhook)

        # Payment তৈরি করো
        gateway_to_method = {
            'BKASH_WEBHOOK': 'bkash',
            'NAGAD_WEBHOOK': 'nagad',
            'ROCKET_WEBHOOK': 'rocket',
            'FOSTERPAYMENTS_WEBHOOK': 'other',
            'SSLCOMMERZ_WEBHOOK': 'sslcommerz',
        }
        pay_method = gateway_to_method.get(webhook.gateway_type, 'other')
        notes = (
            f"Webhook Payment Transfer | Gateway: {webhook.gateway_type} | "
            f"TxnID: {webhook.transaction_id} | From: {webhook.from_wallet}"
        )
        result = BillingService.receive_payment(
            client=client,
            amount=Decimal(str(webhook.payment_amount)),
            payment_method=pay_method,
            received_by=request.user,
            transaction_id=webhook.transaction_id,
            notes=notes,
            is_verified=True,
            approved_by=request.user,
        )

        # তৈরি প্রথম payment-কে webhook-এ link → webhook_source__isnull=False হওয়ায়
        # Collected Bills page থেকে বাদ পড়বে (এটি bKash gateway payment, manual collection নয়)।
        pay_ids = (result or {}).get('payment_ids') or []
        linked = Payment.objects.filter(id=pay_ids[0]).first() if pay_ids else None

        # ── Transfer history log + webhook record update ──
        new_status = _apply_webhook_transfer(webhook, client, request.user, reversed_count, linked)

        msg = f'Payment {client.username}-এ transfer হয়েছে।'
        if reversed_count:
            msg = (f'আগের transfer ফেরত নিয়ে Payment {client.username}-এ '
                   f're-transfer হয়েছে (double-count হয়নি)।')
        return Response({
            'message': msg,
            'settlement_status': new_status,
            'reversed_previous': reversed_count,
            'payment': result,
        })


def _map_webhook_fields(data):
    """gateway payload → normalized webhook fields dict (bKash/generic alias mapping)।"""
    return {
        'transaction_id': (data.get('trxID') or data.get('transaction_id') or
                           data.get('transactionID') or data.get('id') or ''),
        'amount_raw': (data.get('amount') or data.get('paymentAmount') or
                       data.get('value') or 0),
        'from_wallet': (data.get('customerMsisdn') or data.get('payerAccount') or
                        data.get('msisdn') or data.get('from') or ''),
        'to_wallet_org': (data.get('orgMsisdn') or data.get('merchantMsisdn') or
                          data.get('to') or ''),
        'trans_reference': (data.get('merchantInvoiceNumber') or data.get('invoiceNumber') or
                            data.get('reference') or data.get('order_id') or ''),
        'trans_msg_inv_no': (data.get('paymentID') or data.get('paymentId') or
                             data.get('id') or data.get('msgID') or ''),
        'trans_status': (data.get('transactionStatus') or data.get('status') or 'Completed'),
        'timestamp_raw': (data.get('paymentExecuteTime') or data.get('completedTime') or
                          data.get('timestamp') or None),
    }


def _auto_settle_webhook(matched_client, amount, gateway, transaction_id):
    """matched client + amount>0 হলে receive_payment দিয়ে auto-settle।
    Returns settlement_status ('automatically_settled' বা 'payment_requested')।"""
    if not (matched_client and amount > 0):
        return 'payment_requested'
    from billing.services import BillingService
    gateway_to_method = {
        'BKASH_WEBHOOK': 'bkash', 'NAGAD_WEBHOOK': 'nagad',
        'ROCKET_WEBHOOK': 'rocket', 'SSLCOMMERZ_WEBHOOK': 'sslcommerz',
    }
    pay_method = gateway_to_method.get(gateway, 'other')
    notes = f"Webhook Auto | Gateway: {gateway} | TxnID: {transaction_id}"
    try:
        BillingService.receive_payment(
            client=matched_client, amount=amount,
            payment_method=pay_method, transaction_id=transaction_id,
            notes=notes, is_verified=True,
        )
        return 'automatically_settled'
    except Exception:
        return 'payment_requested'


class WebhookReceiveView(viewsets.ViewSet):
    """
    Payment gateway-এর webhook receiver।
    bKash, Nagad ইত্যাদি এই endpoint-এ POST করবে।
    POST /api/v1/billing/webhook/receive/{gateway}/
    """
    permission_classes = []  # gateway থেকে anonymous POST আসে

    @action(detail=False, methods=['post'], url_path=r'receive/(?P<gateway>[^/.]+)')
    def receive(self, request, gateway=None):
        from decimal import Decimal
        from django.conf import settings as _settings
        from django.db import transaction as _tx, IntegrityError
        from django.utils import timezone as tz
        import dateutil.parser
        import hmac as _hmac

        # ── shared-secret verification (fail-closed) ──────────────────────
        # anonymous endpoint বলে (permission_classes=[]) কোনো auth নেই — তাই
        # shared secret দিয়েই authenticity যাচাই করা হয়। secret configure না
        # থাকলে সব request reject (fail-closed) — misconfiguration-এ ভুলবশত
        # খুলে থাকা এড়াতে।
        expected_secret = getattr(_settings, 'WEBHOOK_SHARED_SECRET', '')
        if not expected_secret:
            logger.error(
                "Webhook receive ব্লক করা হলো: WEBHOOK_SHARED_SECRET .env-এ সেট করা নেই (gateway=%s)।",
                gateway
            )
            return Response({'error': 'Webhook not configured.'}, status=503)
        provided_secret = request.headers.get('X-Webhook-Secret') or request.query_params.get('secret') or ''
        if not _hmac.compare_digest(str(provided_secret), str(expected_secret)):
            logger.warning("Webhook receive ব্যর্থ: ভুল/অনুপস্থিত shared secret (gateway=%s)।", gateway)
            return Response({'error': 'Unauthorized.'}, status=401)

        gateway = (gateway or 'BKASH').upper()
        if not gateway.endswith('_WEBHOOK'):
            gateway = f"{gateway}_WEBHOOK"

        data = request.data

        # ── gateway field mapping (bKash/generic aliases) ────────────────────
        f = _map_webhook_fields(data)
        transaction_id = f['transaction_id']

        if not transaction_id:
            return Response({'error': 'transaction_id missing'}, status=400)

        # Timestamp parse
        trans_timestamp = None
        if f['timestamp_raw']:
            try:
                trans_timestamp = dateutil.parser.parse(str(f['timestamp_raw']))
            except Exception:
                trans_timestamp = tz.now()

        try:
            amount = Decimal(str(f['amount_raw']))
        except Exception:
            amount = Decimal('0')

        # ── Auto-match: trans_reference → client customer_id বা username ────
        from clients.models import Client
        matched_client = None
        if f['trans_reference']:
            matched_client = (
                Client.objects.filter(customer_id=f['trans_reference']).first() or
                Client.objects.filter(username=f['trans_reference']).first()
            )

        # ── Race-safe duplicate handling ───────────────────────────────────
        # আগে exists()-check করে পরে create করলে দুইটা concurrent request (gateway
        # retry) উভয়ই "নেই" দেখে auto-settle চালিয়ে double-credit করতে পারত।
        # তাই আগে row claim করি (transaction_id-এর DB-level unique constraint-ই
        # আসল গার্ড) — দ্বিতীয় request IntegrityError-এ ধরা পড়ে সরাসরি "Already
        # processed" বলবে, auto-settle-ই চালাবে না।
        try:
            with _tx.atomic():
                webhook = WebhookPayment.objects.create(
                    gateway_type     = gateway,
                    transaction_id   = transaction_id,
                    payment_amount   = amount,
                    from_wallet      = f['from_wallet'],
                    to_wallet_org    = f['to_wallet_org'],
                    trans_reference  = f['trans_reference'],
                    trans_msg_inv_no = f['trans_msg_inv_no'],
                    trans_timestamp  = trans_timestamp or tz.now(),
                    trans_status     = f['trans_status'],
                    settlement_status= 'payment_requested',
                    matched_client   = matched_client,
                    raw_data         = data,
                )
        except IntegrityError:
            logger.info("Webhook duplicate (race-safe): transaction_id=%s — skipped", transaction_id)
            return Response({'message': 'Already processed'}, status=200)

        # ── Auto-settle (matched + amount>0 হলে) — row claim হওয়ার পরেই, তাই
        # দুইবার settle হওয়া সম্ভব না ──
        settlement_status = _auto_settle_webhook(matched_client, amount, gateway, transaction_id)
        if settlement_status != webhook.settlement_status:
            webhook.settlement_status = settlement_status
            webhook.save(update_fields=['settlement_status'])

        return Response({'message': 'Webhook received', 'id': webhook.id}, status=200)


# ═══════════════════════════════════════════════════════════════════════════════
# bKash Amazon SNS Webhook Handler
# Endpoint: POST /api/v1/billing/webhook/bkash-sns/
#
# bKash তাদের real-time payment notification Amazon SNS দিয়ে পাঠায়।
# দুই ধরনের request আসে:
#   1. SubscriptionConfirmation — প্রথমবার subscribe করার সময়
#   2. Notification            — প্রতিটি payment এর পর
# ═══════════════════════════════════════════════════════════════════════════════

import logging
import json
import base64
import ssl
import urllib.request
from urllib.parse import urlparse

logger = logging.getLogger('billing.bkash_sns')


def _verify_sns_signature(payload: dict) -> bool:
    """
    Amazon SNS message-এর RSA-SHA1 signature verify করে।

    নিরাপত্তা নিশ্চিত করতে:
    1. SigningCertURL অবশ্যই amazonaws.com domain-এর হতে হবে
    2. Certificate download করে public key বের করা হয়
    3. Message-এর type অনুযায়ী canonical string build করে signature verify করা হয়
    """
    try:
        from cryptography.x509 import load_pem_x509_certificate
        from cryptography.hazmat.primitives.asymmetric import padding
        from cryptography.hazmat.primitives import hashes

        cert_url = payload.get('SigningCertURL', '')

        # SigningCertURL অবশ্যই amazonaws.com-এর হতে হবে (security check)
        parsed = urlparse(cert_url)
        if not parsed.hostname or not parsed.hostname.endswith('.amazonaws.com'):
            logger.warning('SNS: Invalid SigningCertURL domain: %s', cert_url)
            return False

        # Certificate download (SSL verify চালু থাকবে)
        context = ssl.create_default_context()
        with urllib.request.urlopen(cert_url, context=context, timeout=5) as resp:
            cert_pem = resp.read()

        cert = load_pem_x509_certificate(cert_pem)
        public_key = cert.public_key()

        # Canonical string তৈরি — Message type অনুযায়ী field order নির্দিষ্ট
        msg_type = payload.get('Type', '')
        if msg_type == 'Notification':
            fields = ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
        else:  # SubscriptionConfirmation / UnsubscribeConfirmation
            fields = ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']

        canonical_parts = []
        for field in fields:
            if field in payload:
                canonical_parts.append(field + '\n' + payload[field] + '\n')
        canonical_string = ''.join(canonical_parts).encode('utf-8')

        # Signature decode (base64)
        signature = base64.b64decode(payload.get('Signature', ''))

        # Hash algorithm নির্ধারণ payload-এর SignatureVersion অনুযায়ী।
        # এটা data hashing নয় — AWS SNS-এর RSA signature verify করার জন্য AWS
        # নিজে যে digest দিয়ে sign করেছে সেটাই মেলাতে হয়। SignatureVersion '2' →
        # SHA256 (AWS-এর নতুন default), '1' (legacy) → SHA1। আমরা weak hash "বেছে"
        # নিচ্ছি না; algorithm-টি সম্পূর্ণভাবে AWS-এর পাঠানো version দ্বারা নির্ধারিত।
        # নাম→cryptography hash class map (getattr) — যাতে verification-এ কোনো
        # hardcoded weak-hash constructor না থাকে।
        _SNS_HASH_BY_VERSION = {'1': 'SHA1', '2': 'SHA256'}
        sig_version = str(payload.get('SignatureVersion', '1'))
        hash_alg = getattr(hashes, _SNS_HASH_BY_VERSION.get(sig_version, 'SHA1'))()

        # RSA signature verify (SignatureVersion অনুযায়ী SHA256/SHA1)
        public_key.verify(signature, canonical_string, padding.PKCS1v15(), hash_alg)
        return True

    except Exception as exc:
        logger.exception('SNS signature verify failed: %s', exc)
        return False


def _normalize_phone(msisdn: str) -> str:
    """
    bKash phone number normalize করে। +8801... → 01..., 8801... → 01...
    """
    if not msisdn:
        return ''
    cleaned = msisdn.strip().replace(' ', '').replace('-', '')
    if cleaned.startswith('+88'):
        cleaned = cleaned[3:]
    elif cleaned.startswith('88') and len(cleaned) == 13:
        cleaned = cleaned[2:]
    return cleaned


def _handle_sns_subscription(payload):
    """SubscriptionConfirmation — SubscribeURL-এ GET করে subscription confirm → Response।"""
    subscribe_url = payload.get('SubscribeURL', '')
    token         = payload.get('Token', '')
    logger.info(
        'bKash SNS: SubscriptionConfirmation | Token=%s... | URL=%s',
        token[:20] if token else '', subscribe_url[:80] if subscribe_url else '',
    )
    if not subscribe_url:
        logger.error('bKash SNS: SubscribeURL missing in SubscriptionConfirmation')
        return Response({'error': 'SubscribeURL missing'}, status=400)
    try:
        context = ssl.create_default_context()
        with urllib.request.urlopen(subscribe_url, context=context, timeout=10) as resp:
            confirm_body = resp.read().decode('utf-8', errors='replace')
            http_status  = resp.status
        logger.info(
            'bKash SNS: Subscription confirmed | HTTP %s | Response: %s...',
            http_status, confirm_body[:200],
        )
        return Response(
            {'message': 'Subscription confirmed', 'http_status': http_status}, status=200)
    except Exception as exc:
        logger.exception('bKash SNS: SubscribeURL GET failed | %s', exc)
        return Response({'error': 'Subscription confirm failed', 'detail': str(exc)}, status=500)


def _sns_notification_match_client(invoice_number, trx_id):
    """শুধুমাত্র merchantInvoiceNumber → customer_id/username দিয়ে client match
    (phone/debitMSISDN দিয়ে নয় — ভুল client এড়াতে)। Returns client বা None।"""
    from clients.models import Client
    if not invoice_number:
        logger.warning('bKash SNS: merchantInvoiceNumber missing | trxID=%s '
                       '(manual transfer required)', trx_id)
        return None
    matched = (
        Client.objects.filter(customer_id=invoice_number).first() or
        Client.objects.filter(username=invoice_number).first()
    )
    if matched:
        logger.info('bKash SNS: Client matched by invoiceNumber=%s → %s', invoice_number, matched)
    else:
        logger.warning('bKash SNS: No client matched for invoiceNumber=%s '
                       '(manual transfer required)', invoice_number)
    return matched


def _sns_auto_settle(matched_client, amount, transaction_status, trx_id,
                     debit_msisdn, transaction_type, date_time):
    """Completed + matched + amount>0 হলে receive_payment auto-settle।
    Returns (settlement_status, linked_payment)।"""
    if transaction_status != 'Completed':
        logger.info('bKash SNS: Skipping auto-settle — status=%s | trxID=%s',
                    transaction_status, trx_id)
        return 'payment_requested', None
    if not (matched_client and amount > 0):
        return 'payment_requested', None
    from billing.services import BillingService
    notes = (
        f"bKash SNS Webhook | trxID: {trx_id} | "
        f"from: {debit_msisdn} | type: {transaction_type} | "
        f"dateTime: {date_time}"
    )
    try:
        result = BillingService.receive_payment(
            client=matched_client,
            amount=amount,
            payment_method='bkash',
            transaction_id=trx_id,
            notes=notes,
            is_verified=True,
        )
        pay_ids = (result or {}).get('payment_ids', [])
        linked_payment = Payment.objects.filter(id=pay_ids[0]).first() if pay_ids else None
        logger.info('bKash SNS: Auto-settled | client=%s | amount=%s | trxID=%s',
                    matched_client, amount, trx_id)
        return 'automatically_settled', linked_payment
    except Exception as exc:
        logger.exception('bKash SNS: Auto-settle failed | trxID=%s | client=%s | %s',
                         trx_id, matched_client, exc)
        return 'payment_requested', None


def _handle_sns_notification(payload, message_id):
    """Notification — Message JSON parse করে WebhookPayment record + auto-settle → Response।"""
    from decimal import Decimal
    from django.utils import timezone as tz
    raw_message = payload.get('Message', '')
    try:
        msg = json.loads(raw_message)
    except (json.JSONDecodeError, TypeError) as exc:
        logger.exception(
            'bKash SNS: Message JSON parse failed | MessageId=%s | %s | Raw=%s',
            message_id, exc, raw_message[:300],
        )
        return Response({'error': 'Message parse failed'}, status=400)

    # ── bKash Notification fields ──
    date_time          = msg.get('dateTime', '')
    debit_msisdn       = msg.get('debitMSISDN', '')   # Customer phone
    credit_msisdn      = msg.get('creditMSISDN', '')  # Merchant number
    trx_id             = msg.get('trxID', '')
    amount_raw         = msg.get('amount', '0')
    transaction_status = msg.get('transactionStatus', '')
    transaction_type   = msg.get('transactionType', '')
    invoice_number     = msg.get('merchantInvoiceNumber', '') or msg.get('invoiceNumber', '')

    logger.info(
        'bKash SNS Notification | trxID=%s | debitMSISDN=%s | amount=%s | '
        'status=%s | type=%s | dateTime=%s',
        trx_id, debit_msisdn, amount_raw, transaction_status,
        transaction_type, date_time,
    )

    if not trx_id:
        logger.warning('bKash SNS: trxID missing in Notification | MessageId=%s', message_id)
        return Response({'error': 'trxID missing'}, status=400)

    # Timestamp parse
    trans_timestamp = tz.now()
    if date_time:
        try:
            import dateutil.parser
            trans_timestamp = dateutil.parser.parse(date_time)
        except Exception:
            logger.warning('bKash SNS: dateTime parse failed: %s', date_time)

    try:
        amount = Decimal(str(amount_raw).replace(',', ''))
    except Exception:
        amount = Decimal('0')

    matched_client = _sns_notification_match_client(invoice_number, trx_id)

    # ── Race-safe duplicate handling ───────────────────────────────────────
    # আগে exists()-check করে auto-settle চালালে দুইটা concurrent SNS delivery
    # (AWS SNS at-least-once delivery guarantee অনুযায়ী duplicate deliveries
    # স্বাভাবিক) উভয়ই "নেই" দেখে double-credit করতে পারত। তাই আগে row claim
    # করি (transaction_id-এর DB-level unique constraint-ই আসল গার্ড)।
    from django.db import transaction as _tx, IntegrityError
    try:
        with _tx.atomic():
            webhook = WebhookPayment.objects.create(
                gateway_type      = 'BKASH_WEBHOOK',
                transaction_id    = trx_id,
                payment_amount    = amount,
                from_wallet       = _normalize_phone(debit_msisdn),
                to_wallet_org     = credit_msisdn,
                trans_reference   = invoice_number or '',
                trans_msg_inv_no  = message_id,
                trans_timestamp   = trans_timestamp,
                trans_status      = transaction_status,
                settlement_status = 'payment_requested',
                matched_client    = matched_client,
                remarks_note      = f"transactionType: {transaction_type}",
                raw_data          = {
                    'sns_payload':  payload,
                    'parsed_msg':   msg,
                },
            )
    except IntegrityError:
        logger.info('bKash SNS: Duplicate trxID=%s (race-safe) — skipped', trx_id)
        return Response({'message': 'Already processed', 'trxID': trx_id}, status=200)

    # ── Auto-settle — row claim হওয়ার পরেই, তাই দুইবার settle সম্ভব না ──
    settlement_status, linked_payment = _sns_auto_settle(
        matched_client, amount, transaction_status, trx_id,
        debit_msisdn, transaction_type, date_time)
    if settlement_status != webhook.settlement_status or linked_payment:
        webhook.settlement_status = settlement_status
        webhook.linked_payment = linked_payment
        webhook.save(update_fields=['settlement_status', 'linked_payment'])

    logger.info('bKash SNS: WebhookPayment saved | id=%s | settlement=%s',
                webhook.id, settlement_status)
    return Response(
        {
            'message':    'Notification processed',
            'trxID':      trx_id,
            'status':     transaction_status,
            'settled':    settlement_status == 'automatically_settled',
            'webhook_id': webhook.id,
        },
        status=200,
    )


class BkashSNSWebhookView(views.APIView):
    """
    bKash Amazon SNS Webhook endpoint।
    POST /api/v1/billing/webhook/bkash-sns/

    Authentication নেই — gateway থেকে anonymous POST আসে।
    Security: Amazon SNS RSA-SHA1 signature verify হয়।
    """
    permission_classes = []
    authentication_classes = []

    # production-এ True রাখো — dev-এ settings দিয়ে False করা যাবে
    @staticmethod
    def _should_verify_signature() -> bool:
        from django.conf import settings
        return getattr(settings, 'BKASH_SNS_VERIFY_SIGNATURE', True)

    def post(self, request):
        raw_body = request.body
        sns_type = request.headers.get('X-Amz-Sns-Message-Type', '')

        # ── Payload parse ────────────────────────────────────────────────────
        try:
            # Content-Type: text/plain হলেও JSON parse করি
            if isinstance(request.data, dict):
                payload = request.data
            else:
                payload = json.loads(raw_body)
        except Exception as exc:
            logger.exception('bKash SNS: JSON parse failed | %s', exc)
            return Response({'error': 'Invalid JSON'}, status=400)

        msg_type = payload.get('Type') or sns_type
        topic_arn = payload.get('TopicArn', '')
        message_id = payload.get('MessageId', '')

        logger.info(
            'bKash SNS received | Type=%s | MessageId=%s | TopicArn=%s',
            msg_type, message_id, topic_arn,
        )

        # ── Signature verify ─────────────────────────────────────────────────
        if self._should_verify_signature():
            if not _verify_sns_signature(payload):
                logger.warning(
                    'bKash SNS: Signature verification FAILED | MessageId=%s', message_id,
                )
                return Response({'error': 'Signature verification failed'}, status=403)
            logger.info('bKash SNS: Signature OK | MessageId=%s', message_id)

        # Case 1: SubscriptionConfirmation | Case 2: Notification | অন্য: log + 200
        if msg_type == 'SubscriptionConfirmation':
            return _handle_sns_subscription(payload)
        if msg_type == 'Notification':
            return _handle_sns_notification(payload, message_id)

        # ── অন্য Type (যেমন UnsubscribeConfirmation) — log করে 200 দাও ────
        logger.info('bKash SNS: Unhandled Type=%s | MessageId=%s', msg_type, message_id)
        return Response({'message': f'Type {msg_type} received'}, status=200)


class ReminderRuleViewSet(viewsets.ModelViewSet):
    """পেমেন্ট রিমাইন্ডার নিয়ম CRUD + manual 'send-now' + preview।"""
    queryset = ReminderRule.objects.select_related('zone', 'package').all()
    serializer_class = ReminderRuleSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['is_active', 'trigger']

    @action(detail=True, methods=['get'], url_path='preview')
    def preview(self, request, pk=None):
        # কতজন client এই rule-এ যোগ্য + প্রথম কয়েকজনের নমুনা message
        from billing.reminder_service import eligible_clients, render_message
        rule = self.get_object()
        qs = eligible_clients(rule)
        sample = []
        for c in qs[:5]:
            sample.append({
                'customer_id': c.customer_id,
                'name': c.full_name,
                'phone': c.phone,
                'due': str(c.due_amount),
                'message': render_message(rule.message_template, c),
            })
        return Response({'eligible_count': qs.count(), 'sample': sample})

    @action(detail=True, methods=['post'], url_path='send-now')
    def send_now(self, request, pk=None):
        # এখনই এই rule অনুযায়ী reminder পাঠায় (manual trigger)
        from billing.reminder_service import send_for_rule
        rule = self.get_object()
        by = 'manual:' + ((request.user.full_name or request.user.username)
                          if request.user and request.user.is_authenticated else 'system')
        try:
            summary = send_for_rule(rule, triggered_by=by)
            return Response({'success': True, 'summary': summary})
        except Exception as e:
            return Response({'success': False, 'error': str(e)},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ReminderLogViewSet(viewsets.ReadOnlyModelViewSet):
    """রিমাইন্ডার পাঠানোর লগ (read-only)।"""
    queryset = ReminderLog.objects.select_related('client', 'rule').all()
    serializer_class = ReminderLogSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = BillPagination
    filterset_fields = ['channel', 'status', 'rule', 'client', 'triggered_by']
    search_fields = ['client__full_name', 'client__customer_id', 'recipient']
