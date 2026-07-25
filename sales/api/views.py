# Sales API views — Product ও Service উভয় invoice flow।
# কেন আলাদা ViewSet: Product-এ stock deduction হয়, Service-এ হয় না।
# Payment action: invoice-এর বিপরীতে payment receive করলে journal entry হয়।
from decimal import Decimal

from django.db.models import Sum, Q
from django.utils import timezone
from rest_framework import permissions, viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response

from clients.models import Client
from sales.models import (
    ProductSalesInvoice, ProductSalesPayment,
    ServiceSalesInvoice, ServiceSalesPayment,
)
from sales.api.serializers import (
    ProductSalesInvoiceSerializer, ProductSalesPaymentSerializer,
    ServiceSalesInvoiceSerializer, ServiceSalesPaymentSerializer,
)
from sales.api.utils import next_product_invoice_no, next_service_invoice_no


# ─── Product Sales ViewSet ───────────────────────────────────────────────────

class ProductSalesInvoiceViewSet(viewsets.ModelViewSet):
    # Product Sales Invoice CRUD।
    # search: customer name, username, invoice_no
    # filter: status, created_at range, customer
    permission_classes = [permissions.IsAuthenticated]
    serializer_class   = ProductSalesInvoiceSerializer

    def get_queryset(self):
        qs  = ProductSalesInvoice.objects.select_related(
            'customer', 'created_by',
        ).prefetch_related('lines__item')

        params = self.request.query_params

        # Customer filter
        customer = params.get('customer')
        if customer:
            qs = qs.filter(customer_id=customer)

        # Username filter
        username = params.get('username')
        if username:
            qs = qs.filter(customer__username__icontains=username)

        # Created by filter
        created_by = params.get('created_by')
        if created_by:
            qs = qs.filter(created_by_id=created_by)

        # Status filter
        status_f = params.get('status')
        if status_f:
            qs = qs.filter(status=status_f)

        # Date range filters (created_at)
        from_date = params.get('from_date')
        to_date   = params.get('to_date')
        if from_date:
            qs = qs.filter(created_at__date__gte=from_date)
        if to_date:
            qs = qs.filter(created_at__date__lte=to_date)

        # Search
        search = params.get('search')
        if search:
            qs = qs.filter(
                Q(invoice_no__icontains=search) |
                Q(customer__full_name__icontains=search) |
                Q(customer__username__icontains=search)
            )

        return qs.order_by('-created_at')

    @action(detail=False, methods=['get'], url_path='next-invoice-no')
    def next_invoice_no(self, request):
        # Create Invoice form-এ auto Invoice No দেখানোর জন্য।
        return Response({'invoice_no': next_product_invoice_no()})

    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request):
        # Dashboard stat cards-এর aggregate।
        qs     = self.get_queryset()
        totals = qs.aggregate(
            total_amount=Sum('total'),
            total_received=Sum('receive_amount'),
            total_due=Sum('due'),
            total_discount=Sum('discount'),
        )
        return Response({
            'count':           qs.count(),
            'total_amount':    float(totals['total_amount']    or 0),
            'total_received':  float(totals['total_received']  or 0),
            'total_due':       float(totals['total_due']       or 0),
            'total_discount':  float(totals['total_discount']  or 0),
            'paid_count':      qs.filter(status='paid').count(),
            'partial_count':   qs.filter(status='partial').count(),
            'unpaid_count':    qs.filter(status='unpaid').count(),
        })

    @action(detail=True, methods=['post'], url_path='receive-payment')
    def receive_payment(self, request, pk=None):
        # Invoice-এর বিপরীতে payment receive করার action।
        invoice = self.get_object()
        data    = request.data

        amount = Decimal(str(data.get('amount', 0)))
        if amount <= 0:
            return Response({'detail': 'Amount must be greater than zero.'}, status=400)

        try:
            from django.contrib.auth import get_user_model
            user_model = get_user_model()

            received_by_id = data.get('received_by')
            paid_by_id     = data.get('paid_by')
            received_by = user_model.objects.filter(pk=received_by_id).first() if received_by_id else request.user
            paid_by     = user_model.objects.filter(pk=paid_by_id).first()     if paid_by_id     else None

            from datetime import date as _date
            receive_date_str = data.get('receive_date')
            receive_date = None
            if receive_date_str:
                try:
                    receive_date = _date.fromisoformat(receive_date_str)
                except ValueError:
                    pass

            payment = invoice.register_payment(
                amount=amount,
                payment_method=data.get('payment_method', 'cash'),
                received_by=received_by,
                paid_by=paid_by,
                receive_date=receive_date,
                description=data.get('description', ''),
                user=request.user,
            )
            return Response(
                ProductSalesPaymentSerializer(payment, context={'request': request}).data,
                status=201,
            )
        except ValueError as e:
            return Response({'detail': str(e)}, status=400)
        except Exception as e:
            return Response({'detail': str(e)}, status=500)

    @action(detail=True, methods=['get'], url_path='payments')
    def payments(self, request, pk=None):
        # Invoice-এর payment history।
        invoice = self.get_object()
        qs      = invoice.payments.select_related(
            'received_by', 'paid_by', 'created_by', 'invoice__customer',
        ).order_by('-receive_date')
        return Response(ProductSalesPaymentSerializer(qs, many=True, context={'request': request}).data)


class ProductSalesPaymentViewSet(viewsets.ReadOnlyModelViewSet):
    # Bills tab-এর জন্য: সব product payment records list করে।
    permission_classes = [permissions.IsAuthenticated]
    serializer_class   = ProductSalesPaymentSerializer

    def get_queryset(self):
        qs = ProductSalesPayment.objects.select_related(
            'invoice__customer', 'paid_by', 'received_by', 'created_by',
        )
        params = self.request.query_params

        customer = params.get('customer')
        if customer:
            qs = qs.filter(invoice__customer_id=customer)

        username = params.get('username')
        if username:
            qs = qs.filter(invoice__customer__username__icontains=username)

        received_by = params.get('received_by')
        if received_by:
            qs = qs.filter(received_by_id=received_by)

        created_by = params.get('created_by')
        if created_by:
            qs = qs.filter(created_by_id=created_by)

        receive_from = params.get('receive_from')
        receive_to   = params.get('receive_to')
        if receive_from:
            qs = qs.filter(receive_date__gte=receive_from)
        if receive_to:
            qs = qs.filter(receive_date__lte=receive_to)

        create_from = params.get('create_from')
        create_to   = params.get('create_to')
        if create_from:
            qs = qs.filter(created_at__date__gte=create_from)
        if create_to:
            qs = qs.filter(created_at__date__lte=create_to)

        search = params.get('search')
        if search:
            qs = qs.filter(
                Q(receipt_no__icontains=search) |
                Q(invoice__invoice_no__icontains=search) |
                Q(invoice__customer__full_name__icontains=search)
            )

        return qs.order_by('-receive_date', '-id')


# ─── Service Sales ViewSet ───────────────────────────────────────────────────

class ServiceSalesInvoiceViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class   = ServiceSalesInvoiceSerializer

    def get_queryset(self):
        qs = ServiceSalesInvoice.objects.select_related(
            'customer', 'created_by',
        ).prefetch_related('lines__item')

        params = self.request.query_params

        customer = params.get('customer')
        if customer:
            qs = qs.filter(customer_id=customer)

        username = params.get('username')
        if username:
            qs = qs.filter(customer__username__icontains=username)

        invoice_type = params.get('invoice_type')
        if invoice_type:
            qs = qs.filter(invoice_type=invoice_type)

        received_by = params.get('received_by')
        if received_by:
            qs = qs.filter(payments__received_by_id=received_by).distinct()

        created_by = params.get('created_by')
        if created_by:
            qs = qs.filter(created_by_id=created_by)

        status_f = params.get('status')
        if status_f:
            qs = qs.filter(status=status_f)

        from_date = params.get('from_date')
        to_date   = params.get('to_date')
        if from_date:
            qs = qs.filter(created_at__date__gte=from_date)
        if to_date:
            qs = qs.filter(created_at__date__lte=to_date)

        search = params.get('search')
        if search:
            qs = qs.filter(
                Q(invoice_no__icontains=search) |
                Q(customer__full_name__icontains=search) |
                Q(customer__username__icontains=search)
            )

        return qs.order_by('-created_at')

    @action(detail=False, methods=['get'], url_path='next-invoice-no')
    def next_invoice_no(self, request):
        return Response({'invoice_no': next_service_invoice_no()})

    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request):
        qs     = self.get_queryset()
        totals = qs.aggregate(
            total_amount=Sum('total'),
            total_received=Sum('receive_amount'),
            total_due=Sum('due'),
            total_discount=Sum('discount'),
        )
        return Response({
            'count':          qs.count(),
            'total_amount':   float(totals['total_amount']   or 0),
            'total_received': float(totals['total_received'] or 0),
            'total_due':      float(totals['total_due']      or 0),
            'total_discount': float(totals['total_discount'] or 0),
            'paid_count':     qs.filter(status='paid').count(),
            'partial_count':  qs.filter(status='partial').count(),
            'unpaid_count':   qs.filter(status='unpaid').count(),
        })

    @action(detail=True, methods=['post'], url_path='receive-payment')
    def receive_payment(self, request, pk=None):
        invoice = self.get_object()
        data    = request.data
        amount  = Decimal(str(data.get('amount', 0)))
        if amount <= 0:
            return Response({'detail': 'Amount must be greater than zero.'}, status=400)

        try:
            from django.contrib.auth import get_user_model
            user_model = get_user_model()
            received_by_id = data.get('received_by')
            paid_by_id     = data.get('paid_by')
            received_by = user_model.objects.filter(pk=received_by_id).first() if received_by_id else request.user
            paid_by     = user_model.objects.filter(pk=paid_by_id).first()     if paid_by_id     else None

            from datetime import date as _date
            receive_date_str = data.get('receive_date')
            receive_date = None
            if receive_date_str:
                try:
                    receive_date = _date.fromisoformat(receive_date_str)
                except ValueError:
                    pass

            payment = invoice.register_payment(
                amount=amount,
                payment_method=data.get('payment_method', 'cash'),
                received_by=received_by,
                paid_by=paid_by,
                receive_date=receive_date,
                description=data.get('description', ''),
                user=request.user,
            )
            return Response(
                ServiceSalesPaymentSerializer(payment, context={'request': request}).data,
                status=201,
            )
        except ValueError as e:
            return Response({'detail': str(e)}, status=400)
        except Exception as e:
            return Response({'detail': str(e)}, status=500)

    @action(detail=True, methods=['get'], url_path='payments')
    def payments(self, request, pk=None):
        invoice = self.get_object()
        qs      = invoice.payments.select_related(
            'received_by', 'paid_by', 'created_by', 'invoice__customer',
        ).order_by('-receive_date')
        return Response(ServiceSalesPaymentSerializer(qs, many=True, context={'request': request}).data)


class ServiceSalesPaymentViewSet(viewsets.ReadOnlyModelViewSet):
    # Service bills tab — সব service payment records।
    permission_classes = [permissions.IsAuthenticated]
    serializer_class   = ServiceSalesPaymentSerializer

    def get_queryset(self):
        qs = ServiceSalesPayment.objects.select_related(
            'invoice__customer', 'paid_by', 'received_by', 'created_by',
        )
        params = self.request.query_params

        customer = params.get('customer')
        if customer:
            qs = qs.filter(invoice__customer_id=customer)

        username = params.get('username')
        if username:
            qs = qs.filter(invoice__customer__username__icontains=username)

        invoice_type = params.get('invoice_type')
        if invoice_type:
            qs = qs.filter(invoice__invoice_type=invoice_type)

        received_by = params.get('received_by')
        if received_by:
            qs = qs.filter(received_by_id=received_by)

        created_by = params.get('created_by')
        if created_by:
            qs = qs.filter(created_by_id=created_by)

        receive_from = params.get('receive_from')
        receive_to   = params.get('receive_to')
        if receive_from:
            qs = qs.filter(receive_date__gte=receive_from)
        if receive_to:
            qs = qs.filter(receive_date__lte=receive_to)

        create_from = params.get('create_from')
        create_to   = params.get('create_to')
        if create_from:
            qs = qs.filter(created_at__date__gte=create_from)
        if create_to:
            qs = qs.filter(created_at__date__lte=create_to)

        search = params.get('search')
        if search:
            qs = qs.filter(
                Q(receipt_no__icontains=search) |
                Q(invoice__invoice_no__icontains=search) |
                Q(invoice__customer__full_name__icontains=search)
            )

        return qs.order_by('-receive_date', '-id')
