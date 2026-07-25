# POP Management API Serializers
from rest_framework import serializers
from clients.models import Client
from pop.models import (
    POP, POPPackage, POPTariff, POPTariffItem, POPFund,
    POPFunding, POPFundTransaction,
    ClientPGWPayment, POPPGWSettlement, POPNotice,
    POPChangeLog, POPFundStartLog, ClientRechargeLog,
    POP_MENU_KEYS,
)


# ─────────────────────────────────────────────────────────────────────────────
# Package / Tariff
# ─────────────────────────────────────────────────────────────────────────────

class POPPackageSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = POPPackage
        fields = ['id', 'name', 'bandwidth_mb', 'details', 'created_by_name', 'created_at']
        read_only_fields = ['created_by_name', 'created_at']

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.username if obj.created_by else ''


class POPTariffItemSerializer(serializers.ModelSerializer):
    package_name = serializers.SerializerMethodField()
    server_name  = serializers.SerializerMethodField()
    protocol     = serializers.SerializerMethodField()
    profile      = serializers.SerializerMethodField()

    class Meta:
        model = POPTariffItem
        fields = [
            'id', 'tariff', 'package', 'package_name',
            'server', 'server_name', 'protocol', 'profile',
            'rate', 'validity_days', 'min_activation_days',
        ]

    def get_package_name(self, obj):
        return obj.package.name if obj.package else ''

    def get_server_name(self, obj):
        return obj.server.name if obj.server else ''

    def get_protocol(self, obj):
        return 'PPPoE' if obj.server else ''

    def get_profile(self, obj):
        return obj.package.name if obj.package else ''


class POPTariffSerializer(serializers.ModelSerializer):
    items               = POPTariffItemSerializer(many=True, read_only=True)
    created_by_name     = serializers.SerializerMethodField()
    pop_count           = serializers.SerializerMethodField()
    package_names       = serializers.SerializerMethodField()
    server_names        = serializers.SerializerMethodField()
    profile_names       = serializers.SerializerMethodField()
    deleted_package_info = serializers.SerializerMethodField()

    class Meta:
        model = POPTariff
        fields = [
            'id', 'tariff_type', 'name', 'items',
            'pop_count', 'package_names', 'server_names', 'profile_names',
            'deleted_package_info', 'created_by_name', 'created_at',
        ]
        read_only_fields = ['created_by_name', 'created_at']

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.username if obj.created_by else ''

    def get_pop_count(self, obj):
        return obj.pops.count()

    def get_package_names(self, obj):
        return ', '.join(i.package.name for i in obj.items.all() if i.package)

    def get_server_names(self, obj):
        names = {i.server.name for i in obj.items.all() if i.server}
        return ', '.join(names)

    def get_profile_names(self, obj):
        return ', '.join(i.package.name for i in obj.items.all() if i.package)

    def get_deleted_package_info(self, obj):
        return ''


# ─────────────────────────────────────────────────────────────────────────────
# POP List / Detail / Create
# ─────────────────────────────────────────────────────────────────────────────

class POPListSerializer(serializers.ModelSerializer):
    district_name   = serializers.SerializerMethodField()
    upazila_name    = serializers.SerializerMethodField()
    zone_name       = serializers.SerializerMethodField()
    tariff_name     = serializers.SerializerMethodField()
    server_name     = serializers.SerializerMethodField()
    clients_running  = serializers.SerializerMethodField()
    clients_enabled  = serializers.SerializerMethodField()
    clients_disabled = serializers.SerializerMethodField()
    clients_left     = serializers.SerializerMethodField()
    remaining_fund   = serializers.SerializerMethodField()

    class Meta:
        model = POP
        fields = [
            'id', 'code', 'business_name', 'pop_type', 'contact_person',
            'server_name', 'mobile', 'level', 'tariff_name',
            'clients_running', 'clients_enabled', 'clients_disabled',
            'clients_left', 'remaining_fund', 'client_enabled',
            'fund_start', 'is_locked', 'is_active',
            'district_name', 'upazila_name', 'zone_name', 'created_at',
        ]

    def get_district_name(self, obj):
        return obj.district.name if obj.district else ''

    def get_upazila_name(self, obj):
        return obj.upazila.name if obj.upazila else ''

    def get_zone_name(self, obj):
        return obj.zone.name if obj.zone else ''

    def get_tariff_name(self, obj):
        return obj.tariff.name if obj.tariff else ''

    def get_server_name(self, obj):
        if obj.tariff:
            item = obj.tariff.items.filter(server__isnull=False).first()
            if item and item.server:
                return item.server.name
        return ''

    def get_clients_running(self, obj):
        return obj.clients.filter(status='active').count()

    def get_clients_enabled(self, obj):
        return obj.clients.filter(pop_exported=True, status='active').count()

    def get_clients_disabled(self, obj):
        return obj.clients.filter(pop_exported=True).exclude(status='active').count()

    def get_clients_left(self, obj):
        return obj.clients.filter(status='left').count()

    def get_remaining_fund(self, obj):
        from django.db.models import Sum
        adds    = obj.funds.filter(fund_type='add').aggregate(t=Sum('amount'))['t'] or 0
        deducts = obj.funds.filter(fund_type='deduct').aggregate(t=Sum('amount'))['t'] or 0
        return float(obj.fund_start) + float(adds) - float(deducts)


class POPDetailSerializer(serializers.ModelSerializer):
    district_name = serializers.SerializerMethodField()
    upazila_name  = serializers.SerializerMethodField()
    zone_name     = serializers.SerializerMethodField()
    tariff_name   = serializers.SerializerMethodField()
    logo_url      = serializers.SerializerMethodField()

    class Meta:
        model = POP
        fields = [
            'id', 'code', 'contact_person', 'email', 'mobile', 'phone',
            'national_id', 'district', 'district_name', 'upazila', 'upazila_name',
            'zone', 'zone_name', 'pop_prefix', 'set_prefix_in_mikrotik',
            'pop_type', 'min_rechargeable_amount', 'address', 'logo', 'logo_url',
            'business_name', 'tariff', 'tariff_name', 'want_to_disable_clients',
            'min_balance', 'username', 'menus', 'restrict_online_payment',
            'is_active', 'is_locked', 'fund_start', 'level', 'client_enabled',
            'created_at', 'updated_at',
        ]
        extra_kwargs = {'password': {'write_only': True, 'required': False}}

    def get_district_name(self, obj):
        return obj.district.name if obj.district else ''

    def get_upazila_name(self, obj):
        return obj.upazila.name if obj.upazila else ''

    def get_zone_name(self, obj):
        return obj.zone.name if obj.zone else ''

    def get_tariff_name(self, obj):
        return obj.tariff.name if obj.tariff else ''

    def get_logo_url(self, obj):
        request = self.context.get('request')
        if obj.logo and request:
            return request.build_absolute_uri(obj.logo.url)
        return ''


class POPCreateSerializer(serializers.ModelSerializer):
    password         = serializers.CharField(write_only=True)
    confirm_password = serializers.CharField(write_only=True)

    class Meta:
        model = POP
        fields = [
            'contact_person', 'email', 'mobile', 'phone', 'national_id',
            'district', 'upazila', 'zone', 'pop_prefix', 'set_prefix_in_mikrotik',
            'pop_type', 'min_rechargeable_amount', 'address', 'logo',
            'business_name', 'tariff', 'want_to_disable_clients', 'restrict_online_payment',
            'min_balance', 'username', 'password', 'confirm_password',
            'menus', 'fund_start', 'level',
        ]

    def validate(self, data):
        if data.get('password') != data.pop('confirm_password', ''):
            raise serializers.ValidationError({'confirm_password': 'পাসওয়ার্ড মিলছে না।'})
        return data

    def create(self, validated_data):
        request = self.context.get('request')
        pop = POP(**validated_data)
        if request and request.user.is_authenticated:
            pop.created_by = request.user
        pop.save()
        return pop


# ─────────────────────────────────────────────────────────────────────────────
# POPFund (সরল)
# ─────────────────────────────────────────────────────────────────────────────

class POPFundSerializer(serializers.ModelSerializer):
    pop_name       = serializers.SerializerMethodField()
    funded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = POPFund
        fields = [
            'id', 'pop', 'pop_name', 'amount', 'fund_type',
            'purpose', 'date', 'funded_by', 'funded_by_name', 'notes', 'created_at',
        ]
        read_only_fields = ['funded_by', 'funded_by_name', 'created_at']

    def get_pop_name(self, obj):
        return str(obj.pop) if obj.pop else ''

    def get_funded_by_name(self, obj):
        return obj.funded_by.get_full_name() or obj.funded_by.username if obj.funded_by else ''


# ─────────────────────────────────────────────────────────────────────────────
# POPFunding (বিস্তারিত)
# ─────────────────────────────────────────────────────────────────────────────

class POPFundTransactionSerializer(serializers.ModelSerializer):
    received_by_name = serializers.SerializerMethodField()
    created_by_name  = serializers.SerializerMethodField()

    class Meta:
        model = POPFundTransaction
        fields = [
            'id', 'funding', 'receipt_number', 'trans_type',
            'fund_amount', 'refund_amount', 'paid_amount',
            'p_processing_fee', 'vat', 'discount', 'due',
            'remarks', 'received_on',
            'received_by', 'received_by_name',
            'created_by', 'created_by_name', 'created_at',
        ]
        read_only_fields = ['receipt_number', 'received_by', 'created_by', 'created_at']

    def get_received_by_name(self, obj):
        return obj.received_by.get_full_name() or obj.received_by.username if obj.received_by else ''

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.username if obj.created_by else ''


class POPFundingSerializer(serializers.ModelSerializer):
    pop_name         = serializers.SerializerMethodField()
    pop_code         = serializers.SerializerMethodField()
    fund_given_name  = serializers.SerializerMethodField()
    received_by_name = serializers.SerializerMethodField()
    transactions     = POPFundTransactionSerializer(many=True, read_only=True)

    class Meta:
        model = POPFunding
        fields = [
            'id', 'pop', 'pop_name', 'pop_code', 'invoice_number',
            'fund_amount', 'received_amount', 'p_processing_fee', 'vat',
            'discount', 'due_amount', 'funding_date',
            'fund_given_by', 'fund_given_name',
            'received_date', 'received_by', 'received_by_name',
            'payment_by', 'remarks', 'trans_status', 'restrict_online_payment',
            'transactions', 'created_at', 'updated_at',
        ]
        read_only_fields = ['invoice_number', 'due_amount', 'fund_given_by', 'created_at', 'updated_at']

    def get_pop_name(self, obj):
        return obj.pop.business_name if obj.pop else ''

    def get_pop_code(self, obj):
        return obj.pop.code if obj.pop else ''

    def get_fund_given_name(self, obj):
        return obj.fund_given_by.get_full_name() or obj.fund_given_by.username if obj.fund_given_by else ''

    def get_received_by_name(self, obj):
        return obj.received_by.get_full_name() or obj.received_by.username if obj.received_by else ''


# ─────────────────────────────────────────────────────────────────────────────
# ClientPGWPayment
# ─────────────────────────────────────────────────────────────────────────────

class ClientPGWPaymentSerializer(serializers.ModelSerializer):
    client_name      = serializers.SerializerMethodField()
    client_code      = serializers.SerializerMethodField()
    pop_name         = serializers.SerializerMethodField()
    received_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ClientPGWPayment
        fields = [
            'id', 'pop', 'pop_name', 'client', 'client_name', 'client_code', 'bill',
            'gateway_name', 'gateway_type', 'amount', 'transaction_id',
            'money_receipt_no', 'status', 'processing_fee',
            'received_by', 'received_by_name', 'received_date',
            'initiated_at', 'completed_at',
        ]

    def get_client_name(self, obj):
        return obj.client.name if obj.client else ''

    def get_client_code(self, obj):
        return obj.client.customer_id if obj.client else ''

    def get_pop_name(self, obj):
        return obj.pop.business_name if obj.pop else ''

    def get_received_by_name(self, obj):
        return obj.received_by.get_full_name() or obj.received_by.username if obj.received_by else ''


# ─────────────────────────────────────────────────────────────────────────────
# POPPGWSettlement
# ─────────────────────────────────────────────────────────────────────────────

class POPPGWSettlementSerializer(serializers.ModelSerializer):
    pop_name       = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = POPPGWSettlement
        fields = [
            'id', 'pop', 'pop_name', 'amount', 'invoice_number',
            'remarks', 'status', 'created_by', 'created_by_name', 'created_at',
        ]
        read_only_fields = ['invoice_number', 'created_by', 'created_at']

    def get_pop_name(self, obj):
        return obj.pop.business_name if obj.pop else ''

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.username if obj.created_by else ''


# ─────────────────────────────────────────────────────────────────────────────
# POPNotice
# ─────────────────────────────────────────────────────────────────────────────

class POPNoticeSerializer(serializers.ModelSerializer):
    pop_name       = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = POPNotice
        fields = [
            'id', 'pop', 'pop_name', 'title', 'details',
            'start_date', 'end_date', 'status',
            'created_by', 'created_by_name', 'created_at', 'updated_at',
        ]
        read_only_fields = ['created_by', 'created_at', 'updated_at']

    def get_pop_name(self, obj):
        return obj.pop.business_name if obj.pop else 'সকল POP'

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.username if obj.created_by else ''


# ─────────────────────────────────────────────────────────────────────────────
# POP Profile — Client export/unexport, change/fund-start log, recharge log
# ─────────────────────────────────────────────────────────────────────────────

class POPClientSerializer(serializers.ModelSerializer):
    """POP profile-এর Exported/Unexported Clients ট্যাবের জন্য।"""
    package_name  = serializers.SerializerMethodField()
    server_name   = serializers.SerializerMethodField()
    zone_name     = serializers.SerializerMethodField()
    client_type_name = serializers.SerializerMethodField()

    class Meta:
        model = Client
        fields = [
            'id', 'username', 'password', 'full_name', 'phone', 'ip_address', 'mac_address',
            'zone_name', 'client_type_name', 'package_name', 'server_name',
            'expiry_day', 'status', 'pop_exported', 'app_enabled',
        ]

    def get_package_name(self, obj):
        return obj.package.name if obj.package else ''

    def get_server_name(self, obj):
        return obj.router.name if obj.router else ''

    def get_zone_name(self, obj):
        return obj.zone.name if obj.zone else ''

    def get_client_type_name(self, obj):
        return obj.client_type.name if obj.client_type else ''


class POPChangeLogSerializer(serializers.ModelSerializer):
    changed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = POPChangeLog
        fields = [
            'id', 'pop', 'business_name', 'tariff_name', 'mobile',
            'zone_name', 'upazila_name', 'district_name', 'pop_prefix',
            'client_will_be_disabled', 'fund_start_on', 'min_rechargeable_amount',
            'set_prefix_in_mikrotik', 'restrict_online_payment', 'remarks',
            'changed_by', 'changed_by_name', 'changed_at',
        ]
        read_only_fields = ['changed_by', 'changed_at']

    def get_changed_by_name(self, obj):
        return obj.changed_by.get_full_name() or obj.changed_by.username if obj.changed_by else ''


class POPFundStartLogSerializer(serializers.ModelSerializer):
    changed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = POPFundStartLog
        fields = [
            'id', 'pop', 'is_enabled', 'effective_from', 'effective_to',
            'activated_days', 'changed_by', 'changed_by_name', 'changed_at',
        ]
        read_only_fields = ['changed_by', 'changed_at']

    def get_changed_by_name(self, obj):
        return obj.changed_by.get_full_name() or obj.changed_by.username if obj.changed_by else ''


class ClientRechargeLogSerializer(serializers.ModelSerializer):
    username       = serializers.SerializerMethodField()
    package_name   = serializers.SerializerMethodField()
    credited_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ClientRechargeLog
        fields = [
            'id', 'pop', 'client', 'username', 'package', 'package_name',
            'daily_rate', 'r_from_date', 'r_to_date', 'days', 'credited_amount',
            'trans_type', 'remarks', 'credited_on', 'credited_by', 'credited_by_name',
        ]
        read_only_fields = ['credited_on', 'credited_by']

    def get_username(self, obj):
        return obj.client.username if obj.client else ''

    def get_package_name(self, obj):
        return obj.package.name if obj.package else ''

    def get_credited_by_name(self, obj):
        return obj.credited_by.get_full_name() or obj.credited_by.username if obj.credited_by else ''
