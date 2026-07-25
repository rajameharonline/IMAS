# Purchase API views — দুটো flow:
# 1) ISP hardware: VendorViewSet, RequisitionViewSet, OrderViewSet, BillViewSet
# 2) Bandwidth: ProviderViewSet, ProviderBillViewSet (পূর্বের flow অটুট)
from decimal import Decimal

from django.db.models import Count, Sum, Q
from django.http import HttpResponse, FileResponse
from django.conf import settings
from django.utils import timezone
from django.utils.html import escape
from rest_framework import permissions, viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response

from accounting.models import AccountType, ChartOfAccount, JournalLine
from purchase.models import (
    Vendor, PurchaseRequisition, PurchaseOrder, PurchaseBill,
    Provider, ProviderBill,
)
from purchase.api.serializers import (
    VendorSerializer,
    PurchaseRequisitionSerializer,
    PurchaseOrderSerializer,
    PurchaseBillSerializer,
    ProviderSerializer,
    ProviderBillSerializer,
    ProviderBillPaymentSerializer,
)


# ─── Cash On Hand helpers (bandwidth bill payment এর জন্য) ──────────────────

def _cash_on_hand_account():
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
    return cash_account


def _cash_balance():
    cash_account = _cash_on_hand_account()
    agg = JournalLine.objects.filter(account=cash_account).aggregate(
        debit=Sum('debit'),
        credit=Sum('credit'),
    )
    return float((agg['debit'] or 0) - (agg['credit'] or 0))


# ─── ISP Hardware Purchase ViewSets ──────────────────────────────────────────

class VendorViewSet(viewsets.ModelViewSet):
    # Vendor CRUD + logo upload support।
    # কেন annotate: list page-এ total_due সরাসরি SQL aggregate থেকে
    # নিলে N+1 query এড়ানো যায়।
    queryset = Vendor.objects.annotate(
        total_due=Sum('orders__bills__due_amount'),
    ).order_by('name')
    serializer_class = VendorSerializer
    permission_classes = [permissions.IsAuthenticated]
    search_fields = ['name', 'contact_person', 'mobile_number', 'email', 'address']
    filterset_fields = ['is_active']

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['request'] = self.request
        return ctx

    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request):
        # Dashboard stat cards-এর জন্য vendor aggregate।
        qs = Vendor.objects.annotate(
            total_due=Sum('orders__bills__due_amount'),
        )
        total = qs.count()
        active = qs.filter(is_active=True).count()
        due_agg = qs.aggregate(due=Sum('total_due'))
        return Response({
            'total': total,
            'active': active,
            'inactive': total - active,
            'total_due': float(due_agg['due'] or 0),
        })


class PurchaseRequisitionViewSet(viewsets.ModelViewSet):
    # Requisition CRUD — multi-item।
    queryset = PurchaseRequisition.objects.prefetch_related(
        'req_items__item', 'req_items__vendor_suggestion', 'req_items__unit',
    ).select_related('requested_by', 'approved_by').all()
    serializer_class = PurchaseRequisitionSerializer
    permission_classes = [permissions.IsAuthenticated]
    search_fields = ['requisition_no', 'purpose', 'notes']
    filterset_fields = ['status']

    def perform_create(self, serializer):
        serializer.save(requested_by=self.request.user)

    @action(detail=True, methods=['post'], url_path='approve')
    def approve(self, request, pk=None):
        req = self.get_object()
        req.status = 'approved'
        req.approved_by = request.user
        req.save(update_fields=['status', 'approved_by'])
        return Response({'status': 'approved'})

    @action(detail=True, methods=['post'], url_path='reject')
    def reject(self, request, pk=None):
        req = self.get_object()
        req.status = 'rejected'
        req.approved_by = request.user
        req.save(update_fields=['status', 'approved_by'])
        return Response({'status': 'rejected'})

    @action(detail=False, methods=['get'], url_path='stats')
    def stats(self, request):
        agg = PurchaseRequisition.objects.aggregate(
            total=Count('id'),
            pending=Count('id', filter=Q(status='pending')),
            approved=Count('id', filter=Q(status='approved')),
            purchased=Count('id', filter=Q(status='purchased')),
        )
        return Response(agg)


class PurchaseOrderViewSet(viewsets.ModelViewSet):
    # Purchase Order CRUD — ISP hardware (Router, ONU, Cable, Accessories)।
    queryset = PurchaseOrder.objects.select_related(
        'vendor', 'requisition', 'created_by',
    ).prefetch_related(
        'items__item', 'items__unit', 'items__store', 'bills',
    ).all()
    serializer_class = PurchaseOrderSerializer
    permission_classes = [permissions.IsAuthenticated]
    search_fields = ['order_no', 'vendor__name', 'notes']
    filterset_fields = ['status', 'vendor']
    ordering_fields = ['order_date', 'total_amount', 'created_at']

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=False, methods=['get'], url_path='stats')
    def stats(self, request):
        # Purchase list page-এর stat cards।
        agg = PurchaseOrder.objects.aggregate(
            total=Count('id'),
            pending=Count('id', filter=Q(status='pending')),
            received=Count('id', filter=Q(status='received')),
            total_value=Sum('total_amount'),
        )
        bill_agg = PurchaseBill.objects.aggregate(
            total_paid=Sum('paid_amount'),
            total_due=Sum('due_amount'),
        )
        return Response({
            'total_orders': agg['total'] or 0,
            'pending_orders': agg['pending'] or 0,
            'received_orders': agg['received'] or 0,
            'total_value': float(agg['total_value'] or 0),
            'total_paid': float(bill_agg['total_paid'] or 0),
            'total_due': float(bill_agg['total_due'] or 0),
        })


class PurchaseBillViewSet(viewsets.ModelViewSet):
    # Purchase Bill CRUD + payment action।
    queryset = PurchaseBill.objects.select_related(
        'order__vendor',
    ).all()
    serializer_class = PurchaseBillSerializer
    permission_classes = [permissions.IsAuthenticated]
    search_fields = ['bill_no', 'order__order_no', 'order__vendor__name']
    filterset_fields = ['status', 'order__vendor']
    ordering_fields = ['bill_date', 'total_amount', 'due_amount']

    @action(detail=True, methods=['post'], url_path='pay')
    def pay(self, request, pk=None):
        # Bill-এ payment করলে paid/due/status update হবে।
        bill = self.get_object()
        amount = Decimal(str(request.data.get('amount') or 0))
        discount = Decimal(str(request.data.get('discount_amount') or 0))

        if amount <= 0 and discount <= 0:
            return Response(
                {'detail': 'Amount or discount must be greater than zero.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if discount > 0:
            bill.discount_amount = (bill.discount_amount or Decimal('0')) + discount

        if amount > 0:
            bill.paid_amount = (bill.paid_amount or Decimal('0')) + amount

        bill.recalculate(save=True)
        return Response(PurchaseBillSerializer(bill).data)

    @action(detail=False, methods=['get'], url_path='stats')
    def stats(self, request):
        agg = PurchaseBill.objects.aggregate(
            total=Count('id'),
            total_amount=Sum('total_amount'),
            paid_amount=Sum('paid_amount'),
            due_amount=Sum('due_amount'),
            discount_amount=Sum('discount_amount'),
            unpaid_count=Count('id', filter=Q(status='unpaid')),
            partial_count=Count('id', filter=Q(status='partial')),
            paid_count=Count('id', filter=Q(status='paid')),
        )
        return Response({
            'total': agg['total'] or 0,
            'total_amount': float(agg['total_amount'] or 0),
            'paid_amount': float(agg['paid_amount'] or 0),
            'due_amount': float(agg['due_amount'] or 0),
            'discount_amount': float(agg['discount_amount'] or 0),
            'unpaid_count': agg['unpaid_count'] or 0,
            'partial_count': agg['partial_count'] or 0,
            'paid_count': agg['paid_count'] or 0,
        })


# ─── Bandwidth Provider ViewSets ─────────────────────────────────────────────

def _bill_line_row(line) -> str:
    """একটি bill line → printable invoice <tr>।"""
    name = escape(line.item.name if line.item else line.description or "-")
    return (
        '<tr>'
        f'<td>{name}</td>'
        f'<td class="num">{escape(str(line.quantity))}</td>'
        f'<td>{escape(line.unit or "")}</td>'
        f'<td class="num">{escape(str(line.rate))}</td>'
        f'<td class="num">{escape(str(line.vat_percent))}%</td>'
        f'<td class="num">{escape(str(line.total_amount))}</td>'
        '</tr>'
    )


def _bill_payment_row(p) -> str:
    """একটি payment → printable invoice <tr>।"""
    return (
        '<tr>'
        f'<td>{escape(str(p.payment_date))}</td>'
        f'<td>{escape(p.payment_method or "")}</td>'
        f'<td class="num">{escape(str(p.amount))}</td>'
        f'<td>{escape(p.description or "")}</td>'
        '</tr>'
    )


def _bill_html(bill: ProviderBill) -> str:
    # Printable HTML invoice fallback।
    rows = [_bill_line_row(line) for line in bill.lines.select_related('item').all()]
    payments = [_bill_payment_row(p) for p in bill.payments.all()]
    rows_html = ''.join(rows) or '<tr><td colspan="6">No line items</td></tr>'
    payments_html = ''.join(payments) or '<tr><td colspan="4">No payments</td></tr>'
    company_name = escape(getattr(settings, 'COMPANY_NAME', 'Company'))
    company_address = escape(getattr(settings, 'COMPANY_ADDRESS', ''))
    company_phone = escape(getattr(settings, 'COMPANY_PHONE', ''))
    return f"""<!DOCTYPE html>
<html>
<head>
  <title>Purchase Bill {bill.invoice_no}</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{ font-family: Arial, sans-serif; margin: 0; background: #f3f4f6; color: #111827; }}
    .wrap {{ max-width: 920px; margin: 0 auto; padding: 24px; }}
    .sheet {{ background: #fff; border: 1px solid #d1d5db; }}
    .topbar {{ display:flex; justify-content:space-between; align-items:center;
              padding:18px 24px; border-bottom:1px solid #e5e7eb; }}
    .title {{ font-size:22px; font-weight:700; color:#173d59; }}
    .section {{ padding:18px 24px; }}
    .grid {{ display:grid; grid-template-columns:1.2fr 0.8fr; gap:16px; }}
    .box {{ border-top:1px solid #e5e7eb; padding-top:14px; }}
    .meta-table {{ width:100%; border-collapse:collapse; }}
    .meta-table td {{ padding:2px 0; font-size:13px; }}
    .label {{ color:#6b7280; width:130px; }}
    table {{ width:100%; border-collapse:collapse; }}
    th,td {{ border-bottom:1px solid #e5e7eb; padding:8px 10px; font-size:13px; }}
    th {{ background:#23445f; color:#fff; text-align:left; }}
    .num {{ text-align:right; }}
    .totals {{ margin-top:14px; width:320px; margin-left:auto; }}
    .grand {{ font-weight:700; border-top:1px solid #111827; padding-top:8px; }}
    .muted {{ color:#6b7280; }}
  </style>
</head>
<body>
  <div class="wrap"><div class="sheet">
    <div class="topbar">
      <div>
        <div class="title">Purchase Bill</div>
        <div class="muted">Bill No: <strong>{escape(bill.bill_no)}</strong></div>
      </div>
      <div class="muted">Invoice: {escape(bill.invoice_no)}</div>
    </div>
    <div class="section">
      <div class="grid">
        <div class="box">
          <table class="meta-table">
            <tr><td class="label">BILL TO</td>
                <td><strong>{escape(bill.provider.name)}</strong></td></tr>
            <tr><td class="label">Contact</td>
                <td>{escape(bill.provider.contact_person or '—')}</td></tr>
            <tr><td class="label">Mobile</td>
                <td>{escape(bill.provider.mobile_number or bill.provider.phone_number or '—')}</td></tr>
            <tr><td class="label">Email</td>
                <td>{escape(bill.provider.email or '—')}</td></tr>
          </table>
        </div>
        <div class="box" style="text-align:right">
          <div class="title" style="font-size:15px">{company_name}</div>
          <div>{company_address}</div>
          <div>{company_phone}</div>
          <div class="muted">Month: {escape(bill.billing_month or '—')}</div>
          <div class="muted">Issue: {escape(str(bill.issue_date))}</div>
          <div class="muted">Due: {escape(str(bill.due_date or '—'))}</div>
        </div>
      </div>
      <div class="box">
        <table>
          <thead><tr>
            <th>Item</th><th class="num">Qty</th><th>Unit</th>
            <th class="num">Rate</th><th class="num">VAT%</th><th class="num">Amount</th>
          </tr></thead>
          <tbody>{rows_html}</tbody>
        </table>
        <div class="totals">
          <table>
            <tr><td>Bill Amount</td><td class="num">{bill.amount}</td></tr>
            <tr><td>Tax</td><td class="num">{bill.tax}</td></tr>
            <tr><td>Discount</td><td class="num">{bill.discount_amount}</td></tr>
            <tr><td class="grand">Net Amount</td><td class="num grand">{bill.net_amount}</td></tr>
            <tr><td>Paid</td><td class="num">{bill.paid_amount}</td></tr>
            <tr><td>Due</td><td class="num">{bill.due_amount}</td></tr>
          </table>
        </div>
      </div>
      <div class="box" style="margin-top:16px">
        <h3>Payment History</h3>
        <table>
          <thead><tr>
            <th>Date</th><th>Method</th><th class="num">Amount</th><th>Note</th>
          </tr></thead>
          <tbody>{payments_html}</tbody>
        </table>
      </div>
      <div class="muted" style="margin-top:12px">
        <strong>Notes:</strong> {escape(bill.notes or '—')}
      </div>
    </div>
  </div></div>
</body></html>"""


class ProviderViewSet(viewsets.ModelViewSet):
    # Provider master data CRUD (bandwidth buy module)।
    queryset = Provider.objects.annotate(
        total_due=Sum('bills__due_amount'),
        total_bills=Count('bills'),
    ).order_by('name')
    serializer_class = ProviderSerializer
    permission_classes = [permissions.IsAuthenticated]
    search_fields = ['name', 'contact_person', 'mobile_number', 'email', 'address']
    filterset_fields = ['is_active']

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['request'] = self.request
        return ctx


class ProviderBillViewSet(viewsets.ModelViewSet):
    # Provider bills: list, create, edit, pay, invoice download, dashboard metrics।
    queryset = ProviderBill.objects.select_related(
        'provider',
    ).prefetch_related('lines', 'payments').all()
    serializer_class = ProviderBillSerializer
    permission_classes = [permissions.IsAuthenticated]
    search_fields = ['bill_no', 'invoice_no', 'provider__name', 'billing_month']
    filterset_fields = ['status', 'provider', 'billing_month']
    ordering_fields = [
        'issue_date', 'due_date', 'net_amount', 'paid_amount', 'due_amount', 'created_at',
    ]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=['post'], url_path='pay')
    def pay(self, request, pk=None):
        bill = self.get_object()
        serializer = ProviderBillPaymentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        amount = Decimal(str(serializer.validated_data.get('amount') or 0))
        payment_date = serializer.validated_data.get('payment_date') or timezone.now().date()
        payment_method = serializer.validated_data.get('payment_method', '')
        description = serializer.validated_data.get('description', '')
        try:
            payment = bill.register_payment(
                amount=amount,
                paid_at=payment_date,
                payment_method=payment_method,
                description=description,
                user=request.user,
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        bill.refresh_from_db()
        return Response({
            'message': 'Payment posted successfully.',
            'payment_id': payment.id,
            'bill': ProviderBillSerializer(bill, context={'request': request}).data,
            'cash_on_hand': _cash_balance(),
        })

    @action(detail=True, methods=['get'], url_path='download-invoice')
    def download_invoice(self, request, pk=None):
        bill = self.get_object()
        if bill.file_attachment:
            return FileResponse(
                bill.file_attachment.open('rb'),
                as_attachment=True,
                filename=bill.file_attachment.name.split('/')[-1],
            )
        html = _bill_html(bill)
        return HttpResponse(html, content_type='text/html')

    @action(detail=False, methods=['get'], url_path='dashboard-stats')
    def dashboard_stats(self, request):
        from django.db import models as m
        agg = ProviderBill.objects.aggregate(
            bill_count=Count('id'),
            bill_amount=Sum('net_amount'),
            discount_amount=Sum('discount_amount'),
            due_count=Count('id', filter=m.Q(status__in=['unpaid', 'partial'])),
            due_amount=Sum('due_amount', filter=m.Q(status__in=['unpaid', 'partial'])),
            paid_count=Count('id', filter=m.Q(status='paid')),
            paid_amount=Sum('paid_amount'),
        )
        return Response({
            'bill_count': agg['bill_count'] or 0,
            'bill_amount': float(agg['bill_amount'] or 0),
            'discount_amount': float(agg['discount_amount'] or 0),
            'due_count': agg['due_count'] or 0,
            'due_amount': float(agg['due_amount'] or 0),
            'paid_count': agg['paid_count'] or 0,
            'paid_amount': float(agg['paid_amount'] or 0),
            'cash_on_hand': _cash_balance(),
        })
