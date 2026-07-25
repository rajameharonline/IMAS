# POP Management API Views
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from django.db.models import Q, Sum, Count
from django.utils import timezone

from clients.models import Client
from pop.models import (
    POP, POPPackage, POPTariff, POPTariffItem, POPFund,
    POPFunding, POPFundTransaction,
    ClientPGWPayment, POPPGWSettlement, POPNotice,
    POPChangeLog, POPFundStartLog, ClientRechargeLog,
    POP_MENU_KEYS,
)
from pop.api.serializers import (
    POPPackageSerializer, POPTariffSerializer, POPTariffItemSerializer,
    POPListSerializer, POPDetailSerializer, POPCreateSerializer,
    POPFundSerializer, POPFundingSerializer, POPFundTransactionSerializer,
    ClientPGWPaymentSerializer, POPPGWSettlementSerializer, POPNoticeSerializer,
    POPClientSerializer, POPChangeLogSerializer, POPFundStartLogSerializer,
    ClientRechargeLogSerializer,
)


class StandardPagination(PageNumberPagination):
    page_size = 100
    page_size_query_param = 'page_size'
    max_page_size = 500


# ─────────────────────────────────────────────────────────────────────────────
# Package / Tariff
# ─────────────────────────────────────────────────────────────────────────────

class POPPackageViewSet(viewsets.ModelViewSet):
    queryset = POPPackage.objects.all()
    serializer_class = POPPackageSerializer
    permission_classes = [permissions.IsAuthenticated]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class POPTariffViewSet(viewsets.ModelViewSet):
    queryset = POPTariff.objects.prefetch_related('items__package', 'items__server', 'pops').all()
    serializer_class = POPTariffSerializer
    permission_classes = [permissions.IsAuthenticated]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=['post'], url_path='add-item')
    def add_item(self, request, pk=None):
        tariff = self.get_object()
        s = POPTariffItemSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        item = s.save(tariff=tariff)
        return Response(POPTariffItemSerializer(item).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete'], url_path='remove-item/(?P<item_id>[0-9]+)')
    def remove_item(self, request, pk=None, item_id=None):
        POPTariffItem.objects.filter(tariff=self.get_object(), id=item_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class POPTariffItemViewSet(viewsets.ModelViewSet):
    queryset = POPTariffItem.objects.select_related('package', 'server', 'tariff').all()
    serializer_class = POPTariffItemSerializer
    permission_classes = [permissions.IsAuthenticated]


# ─────────────────────────────────────────────────────────────────────────────
# POP (MAC Reseller)
# ─────────────────────────────────────────────────────────────────────────────

class POPViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        qs = POP.objects.select_related('district', 'upazila', 'zone', 'tariff').all()
        q = self.request.query_params
        if q.get('search'):
            qs = qs.filter(
                Q(code__icontains=q['search']) |
                Q(business_name__icontains=q['search']) |
                Q(contact_person__icontains=q['search']) |
                Q(mobile__icontains=q['search'])
            )
        if q.get('pop_type'):
            qs = qs.filter(pop_type=q['pop_type'])
        if q.get('is_active'):
            qs = qs.filter(is_active=q['is_active'].lower() == 'true')
        if q.get('is_locked'):
            qs = qs.filter(is_locked=q['is_locked'].lower() == 'true')
        if q.get('client_enabled'):
            qs = qs.filter(client_enabled=q['client_enabled'].lower() == 'true')
        if q.get('created_from'):
            qs = qs.filter(created_at__date__gte=q['created_from'])
        if q.get('created_to'):
            qs = qs.filter(created_at__date__lte=q['created_to'])
        return qs

    def get_serializer_class(self):
        if self.action == 'list':
            return POPListSerializer
        if self.action == 'create':
            return POPCreateSerializer
        return POPDetailSerializer

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        pop = serializer.save()
        # POP তথ্য পরিবর্তনের snapshot লগ করা
        POPChangeLog.objects.create(
            pop=pop,
            business_name=pop.business_name,
            tariff_name=pop.tariff.name if pop.tariff else '',
            mobile=pop.mobile,
            zone_name=pop.zone.name if pop.zone else '',
            upazila_name=pop.upazila.name if pop.upazila else '',
            district_name=pop.district.name if pop.district else '',
            pop_prefix=pop.pop_prefix,
            client_will_be_disabled=pop.want_to_disable_clients,
            fund_start_on=pop.fund_start > 0,
            min_rechargeable_amount=pop.min_rechargeable_amount,
            set_prefix_in_mikrotik=pop.set_prefix_in_mikrotik,
            restrict_online_payment=pop.restrict_online_payment,
            changed_by=self.request.user,
        )

    @action(detail=False, methods=['get'], url_path='stats')
    def stats(self, request):
        total_pops = POP.objects.count()
        total_clients = Client.objects.filter(pop__isnull=False).count()
        return Response({'total_pops': total_pops, 'total_clients': total_clients, 'online_clients': 0})

    @action(detail=True, methods=['post'], url_path='toggle-lock')
    def toggle_lock(self, request, pk=None):
        pop = self.get_object()
        pop.is_locked = not pop.is_locked
        pop.save(update_fields=['is_locked'])
        return Response({'is_locked': pop.is_locked})

    @action(detail=True, methods=['post'], url_path='toggle-active')
    def toggle_active(self, request, pk=None):
        pop = self.get_object()
        pop.is_active = not pop.is_active
        pop.save(update_fields=['is_active'])
        return Response({'is_active': pop.is_active})

    @action(detail=True, methods=['post'], url_path='toggle-fund-start')
    def toggle_fund_start(self, request, pk=None):
        """fund_start চালু/বন্ধ করা ও লগ রাখা (POP Fund Start Logs ট্যাব)।"""
        pop = self.get_object()
        enable = request.data.get('enable')
        enable = (pop.fund_start <= 0) if enable is None else bool(enable)
        effective_from = request.data.get('effective_from') or timezone.localdate()
        effective_to = request.data.get('effective_to') or None
        days = int(request.data.get('activated_days') or 0)
        if not enable:
            pop.fund_start = 0
            pop.save(update_fields=['fund_start'])
        POPFundStartLog.objects.create(
            pop=pop, is_enabled=enable,
            effective_from=effective_from, effective_to=effective_to,
            activated_days=days, changed_by=request.user,
        )
        return Response({'fund_start_on': enable})

    @action(detail=False, methods=['get'], url_path='menu-keys')
    def menu_keys(self, request):
        return Response(POP_MENU_KEYS)

    @action(detail=False, methods=['get'], url_path='next-code')
    def next_code(self, request):
        last = POP.objects.order_by('-id').first()
        next_num = (last.id + 1) if last else 1
        return Response({'code': str(next_num).zfill(4)})

    @action(detail=False, methods=['get'], url_path='dropdown')
    def dropdown(self, request):
        pops = POP.objects.filter(is_active=True).values('id', 'code', 'business_name')
        return Response(list(pops))

    # ── POP Profile সাব-ট্যাব ───────────────────────────────────────────────

    @action(detail=True, methods=['get'], url_path='clients')
    def clients(self, request, pk=None):
        """exported=true/false query param দিয়ে Exported/Unexported Clients ট্যাব।"""
        pop = self.get_object()
        exported = request.query_params.get('exported', 'true').lower() == 'true'
        qs = Client.objects.filter(pop=pop, pop_exported=exported).select_related(
            'zone', 'client_type', 'package', 'router',
        )
        return Response(POPClientSerializer(qs, many=True).data)

    @action(detail=True, methods=['post'], url_path='clients-bulk')
    def clients_bulk(self, request, pk=None):
        """bulk export/revert/enable/disable/recharge/package-change client ids নিয়ে।"""
        pop = self.get_object()
        op = request.data.get('op')
        ids = request.data.get('client_ids', [])
        qs = Client.objects.filter(pop=pop, id__in=ids)
        if op == 'export':
            qs.update(pop_exported=True)
        elif op == 'revert':
            qs.update(pop_exported=False)
        elif op == 'enable':
            qs.update(status='active')
        elif op == 'disable':
            qs.update(status='suspended')
        elif op == 'package_change':
            package_id = request.data.get('package')
            if package_id:
                qs.update(package_id=package_id)
        else:
            return Response({'detail': 'অজানা অপারেশন'}, status=status.HTTP_400_BAD_REQUEST)
        return Response({'updated': qs.count()})

    @action(detail=True, methods=['get'], url_path='debited-transactions')
    def debited_transactions(self, request, pk=None):
        """POPFunding history — এই POP-এর জন্য ফান্ড ডেবিট হিসাব।"""
        pop = self.get_object()
        qs = POPFunding.objects.filter(pop=pop).select_related('pop', 'fund_given_by', 'received_by')
        return Response(POPFundingSerializer(qs, many=True).data)

    @action(detail=True, methods=['get'], url_path='credited-transactions')
    def credited_transactions(self, request, pk=None):
        """তারিখ অনুযায়ী গ্রুপড client recharge সারাংশ।"""
        pop = self.get_object()
        from django.db.models.functions import TruncDate
        rows = (
            ClientRechargeLog.objects.filter(pop=pop)
            .annotate(day=TruncDate('credited_on'))
            .values('day')
            .annotate(
                total_user=Count('client', distinct=True),
                total_amount=Sum('credited_amount'),
            )
            .order_by('-day')
        )
        return Response(list(rows))

    @action(detail=True, methods=['get'], url_path='recharge-transactions')
    def recharge_transactions(self, request, pk=None):
        pop = self.get_object()
        qs = ClientRechargeLog.objects.filter(pop=pop).select_related('client', 'package', 'credited_by')
        return Response(ClientRechargeLogSerializer(qs, many=True).data)

    @action(detail=True, methods=['get'], url_path='change-logs')
    def change_logs(self, request, pk=None):
        pop = self.get_object()
        qs = POPChangeLog.objects.filter(pop=pop).select_related('changed_by')
        return Response(POPChangeLogSerializer(qs, many=True).data)

    @action(detail=True, methods=['get'], url_path='fund-start-logs')
    def fund_start_logs(self, request, pk=None):
        pop = self.get_object()
        qs = POPFundStartLog.objects.filter(pop=pop).select_related('changed_by')
        return Response(POPFundStartLogSerializer(qs, many=True).data)

    @action(detail=True, methods=['get'], url_path='online-clients')
    def online_clients(self, request, pk=None):
        """এই POP-এর client-দের মধ্যে যারা বর্তমানে RADIUS-এ online।"""
        pop = self.get_object()
        usernames = set(Client.objects.filter(pop=pop).values_list('username', flat=True))
        from radius_app.services.radius_service import RadiusService
        all_online = RadiusService().get_online_users()
        online = [u for u in all_online if u.get('username') in usernames]
        return Response({
            'total_users': len(usernames),
            'online_users': len(online),
            'offline_users': len(usernames) - len(online),
            'sessions': online,
        })


# ─────────────────────────────────────────────────────────────────────────────
# POPFund (সরল)
# ─────────────────────────────────────────────────────────────────────────────

class POPFundViewSet(viewsets.ModelViewSet):
    serializer_class = POPFundSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        qs = POPFund.objects.select_related('pop', 'funded_by').all()
        if self.request.query_params.get('pop'):
            qs = qs.filter(pop_id=self.request.query_params['pop'])
        return qs

    def perform_create(self, serializer):
        serializer.save(funded_by=self.request.user)


# ─────────────────────────────────────────────────────────────────────────────
# POPFunding (বিস্তারিত)
# ─────────────────────────────────────────────────────────────────────────────

class POPFundingViewSet(viewsets.ModelViewSet):
    serializer_class = POPFundingSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        qs = POPFunding.objects.select_related(
            'pop', 'fund_given_by', 'received_by'
        ).prefetch_related('transactions').all()
        q = self.request.query_params
        if q.get('pop'):
            qs = qs.filter(pop_id=q['pop'])
        if q.get('status'):
            qs = qs.filter(trans_status=q['status'])
        if q.get('from_date'):
            qs = qs.filter(funding_date__gte=q['from_date'])
        if q.get('to_date'):
            qs = qs.filter(funding_date__lte=q['to_date'])
        if q.get('search'):
            qs = qs.filter(
                Q(invoice_number__icontains=q['search']) |
                Q(pop__business_name__icontains=q['search'])
            )
        return qs

    def perform_create(self, serializer):
        serializer.save(fund_given_by=self.request.user)

    @action(detail=True, methods=['post'], url_path='add-transaction')
    def add_transaction(self, request, pk=None):
        funding = self.get_object()
        data = request.data.copy()
        data['funding'] = funding.id
        s = POPFundTransactionSerializer(data=data)
        s.is_valid(raise_exception=True)
        trans = s.save(received_by=request.user, created_by=request.user)
        funding.received_amount = funding.transactions.aggregate(t=Sum('paid_amount'))['t'] or 0
        funding.save(update_fields=['received_amount', 'due_amount'])
        return Response(POPFundTransactionSerializer(trans).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request):
        qs = self.get_queryset()
        agg = qs.aggregate(
            total_fund=Sum('fund_amount'),
            total_received=Sum('received_amount'),
            total_due=Sum('due_amount'),
        )
        return Response({
            'total_fund': agg['total_fund'] or 0,
            'total_received': agg['total_received'] or 0,
            'total_due': agg['total_due'] or 0,
            'count': qs.count(),
        })


class POPFundTransactionViewSet(viewsets.ModelViewSet):
    serializer_class = POPFundTransactionSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        qs = POPFundTransaction.objects.select_related(
            'funding__pop', 'received_by', 'created_by'
        ).all()
        if self.request.query_params.get('funding'):
            qs = qs.filter(funding_id=self.request.query_params['funding'])
        return qs

    def perform_create(self, serializer):
        serializer.save(received_by=self.request.user, created_by=self.request.user)


# ─────────────────────────────────────────────────────────────────────────────
# ClientPGWPayment
# ─────────────────────────────────────────────────────────────────────────────

class ClientPGWPaymentViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = ClientPGWPaymentSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        qs = ClientPGWPayment.objects.select_related('pop', 'client', 'bill', 'received_by').all()
        q = self.request.query_params
        if q.get('pop'):
            qs = qs.filter(pop_id=q['pop'])
        if q.get('status'):
            qs = qs.filter(status=q['status'])
        if q.get('gateway'):
            qs = qs.filter(gateway_name=q['gateway'])
        if q.get('from_date'):
            qs = qs.filter(initiated_at__date__gte=q['from_date'])
        if q.get('to_date'):
            qs = qs.filter(initiated_at__date__lte=q['to_date'])
        if q.get('search'):
            qs = qs.filter(
                Q(client__name__icontains=q['search']) |
                Q(transaction_id__icontains=q['search']) |
                Q(money_receipt_no__icontains=q['search'])
            )
        return qs

    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request):
        qs = self.get_queryset()
        agg = qs.filter(status='success').aggregate(total=Sum('amount'))
        return Response({
            'total_success': agg['total'] or 0,
            'count_success': qs.filter(status='success').count(),
            'count_pending': qs.filter(status='pending').count(),
            'count_failed': qs.filter(status='failed').count(),
        })


# ─────────────────────────────────────────────────────────────────────────────
# POPPGWSettlement
# ─────────────────────────────────────────────────────────────────────────────

class POPPGWSettlementViewSet(viewsets.ModelViewSet):
    serializer_class = POPPGWSettlementSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        qs = POPPGWSettlement.objects.select_related('pop', 'created_by').all()
        q = self.request.query_params
        if q.get('pop'):
            qs = qs.filter(pop_id=q['pop'])
        if q.get('status'):
            qs = qs.filter(status=q['status'])
        if q.get('from_date'):
            qs = qs.filter(created_at__date__gte=q['from_date'])
        if q.get('to_date'):
            qs = qs.filter(created_at__date__lte=q['to_date'])
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=['post'], url_path='mark-settled')
    def mark_settled(self, request, pk=None):
        settlement = self.get_object()
        settlement.status = 'settled'
        settlement.save(update_fields=['status'])
        return Response(POPPGWSettlementSerializer(settlement).data)


# ─────────────────────────────────────────────────────────────────────────────
# POPNotice
# ─────────────────────────────────────────────────────────────────────────────

class POPNoticeViewSet(viewsets.ModelViewSet):
    serializer_class = POPNoticeSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        qs = POPNotice.objects.select_related('pop', 'created_by').all()
        q = self.request.query_params
        if q.get('pop'):
            qs = qs.filter(pop_id=q['pop'])
        if q.get('status'):
            qs = qs.filter(status=q['status'])
        if q.get('search'):
            qs = qs.filter(Q(title__icontains=q['search']) | Q(details__icontains=q['search']))
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=['post'], url_path='toggle-status')
    def toggle_status(self, request, pk=None):
        notice = self.get_object()
        notice.status = 'disable' if notice.status == 'enable' else 'enable'
        notice.save(update_fields=['status'])
        return Response({'status': notice.status})
