# এই ফাইলটি clients app-এর serializers - ক্লায়েন্ট তৈরি, আপডেট, তালিকা API-এর জন্য।
from rest_framework import serializers
from clients.models import (
    Client, LeftClient, ChangeRequest, ClientScheduler,
    ClientChangeLog, ClientStatusLog, ClientActivityLog,
)


class ClientListSerializer(serializers.ModelSerializer):
    # ক্লায়েন্ট তালিকার জন্য সংক্ষিপ্ত serializer
    zone_name        = serializers.ReadOnlyField(source='zone.name')
    subzone_name     = serializers.ReadOnlyField(source='subzone.name')
    box_name         = serializers.ReadOnlyField(source='box.name')
    package_name     = serializers.ReadOnlyField(source='package.name')
    router_name      = serializers.ReadOnlyField(source='router.name')
    protocol_name    = serializers.ReadOnlyField(source='protocol.name')
    client_type_name = serializers.ReadOnlyField(source='client_type.name')

    class Meta:
        model = Client
        fields = ['id', 'customer_id', 'full_name', 'phone', 'username', 'password',
                  'ip_address', 'mac_address', 'status', 'zone_name', 'subzone_name',
                  'box_name', 'package_name', 'router_name', 'protocol_name',
                  'client_type_name', 'monthly_bill', 'due_amount', 'expiry_day', 'expiry_date',
                  'pppoe_profile', 'is_app_user']


class ClientDetailSerializer(serializers.ModelSerializer):
    # ক্লায়েন্টের বিস্তারিত তথ্যের serializer
    zone_name        = serializers.ReadOnlyField(source='zone.name')
    subzone_name     = serializers.ReadOnlyField(source='subzone.name')
    box_name         = serializers.ReadOnlyField(source='box.name')
    package_name     = serializers.ReadOnlyField(source='package.name')
    router_name      = serializers.ReadOnlyField(source='router.name')
    protocol_name    = serializers.ReadOnlyField(source='protocol.name')
    client_type_name = serializers.ReadOnlyField(source='client_type.name')
    # MAC OUI থেকে device brand/vendor (Network & Product ট্যাবে দেখায়)
    mac_vendor       = serializers.SerializerMethodField()
    # বর্তমান WAN IP — live radacct থেকে (PPPoE IP dynamic, stored নয়)
    current_ip       = serializers.SerializerMethodField()

    def get_mac_vendor(self, obj):
        try:
            from clients.mac_vendor import lookup_vendor
            return lookup_vendor(obj.mac_address)
        except Exception:
            return ''

    def get_current_ip(self, obj):
        # live session IP; না পেলে static ip_address field-এ fallback
        try:
            from radius_app.services.radius_service import RadiusService
            ip = RadiusService.for_client(obj).get_user_live_ip(obj.username)
            if ip:
                return ip
        except Exception:
            pass
        return obj.ip_address or ''

    class Meta:
        model = Client
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at', 'customer_id']


import re as _re

_MOBILE_LABEL = 'মোবাইল নম্বর'

def _validate_bd_phone(value, field_label=_MOBILE_LABEL):
    if not value:
        return value
    if not _re.match(r'^01[3-9]\d{8}$', value.strip()):
        raise serializers.ValidationError(
            f'{field_label} সঠিক নয় — ১১ সংখ্যার বাংলাদেশি নম্বর দিন (01XXXXXXXXX)।'
        )
    return value.strip()


class ClientCreateSerializer(serializers.ModelSerializer):
    # নতুন ক্লায়েন্ট তৈরির serializer — customer_id auto-generate হয়
    customer_id = serializers.CharField(required=False, read_only=True)
    ip_address = serializers.IPAddressField(required=False, allow_null=True, allow_blank=True, default=None)

    class Meta:
        model = Client
        exclude = ['created_at', 'updated_at']

    def validate_phone(self, value):
        return _validate_bd_phone(value, _MOBILE_LABEL)

    def validate_alt_phone(self, value):
        if not value:
            return value
        return _validate_bd_phone(value, 'বিকল্প মোবাইল নম্বর')

    def validate_username(self, value):
        if Client.objects.filter(username=value).exists():
            raise serializers.ValidationError("এই username ইতোমধ্যে ব্যবহৃত হচ্ছে।")
        return value

    def validate_nid(self, value):
        if not value:
            return value
        if not _re.match(r'^\d{10}$|^\d{13}$|^\d{17}$', value.strip()):
            raise serializers.ValidationError("NID সঠিক নয় — ১০, ১৩ বা ১৭ সংখ্যার হতে হবে।")
        return value.strip()

    def validate_ip_address(self, value):
        if value == '' or value is None:
            return None
        return value


class ClientUpdateSerializer(serializers.ModelSerializer):
    # ক্লায়েন্ট আপডেটের serializer — photo/nid_photo/reg_form_pic multipart সহ
    ip_address = serializers.IPAddressField(required=False, allow_null=True, allow_blank=True, default=None)
    photo        = serializers.ImageField(required=False, allow_null=True)
    nid_photo    = serializers.ImageField(required=False, allow_null=True)
    reg_form_pic = serializers.ImageField(required=False, allow_null=True)

    class Meta:
        model = Client
        exclude = ['created_at', 'updated_at']
        read_only_fields = ['id', 'created_by']

    def validate_phone(self, value):
        return _validate_bd_phone(value, _MOBILE_LABEL)

    def validate_alt_phone(self, value):
        if not value:
            return value
        return _validate_bd_phone(value, 'বিকল্প মোবাইল নম্বর')

    def validate_nid(self, value):
        if not value:
            return value
        if not _re.match(r'^\d{10}$|^\d{13}$|^\d{17}$', value.strip()):
            raise serializers.ValidationError("NID সঠিক নয় — ১০, ১৩ বা ১৭ সংখ্যার হতে হবে।")
        return value.strip()

    def validate_customer_id(self, value):
        if not value:
            return value
        qs = Client.objects.filter(customer_id=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("এই Customer ID ইতোমধ্যে ব্যবহৃত হচ্ছে।")
        return value

    def validate_ip_address(self, value):
        if value == '' or value is None:
            return None
        return value


class LeftClientSerializer(serializers.ModelSerializer):
    client_name        = serializers.ReadOnlyField(source='client.full_name')
    client_customer_id = serializers.ReadOnlyField(source='client.customer_id')
    client_phone       = serializers.ReadOnlyField(source='client.phone')
    client_username    = serializers.ReadOnlyField(source='client.username')
    client_zone        = serializers.ReadOnlyField(source='client.zone.name')
    client_protocol    = serializers.ReadOnlyField(source='client.protocol.name')
    client_type        = serializers.ReadOnlyField(source='client.client_type.name')
    client_package     = serializers.ReadOnlyField(source='client.package.name')
    client_monthly_bill = serializers.ReadOnlyField(source='client.monthly_bill')
    client_server      = serializers.ReadOnlyField(source='client.router.name')
    recovered_by_name  = serializers.ReadOnlyField(source='recovered_by.username')

    class Meta:
        model = LeftClient
        fields = '__all__'


class ChangeRequestSerializer(serializers.ModelSerializer):
    client_name = serializers.ReadOnlyField(source='client.full_name')

    class Meta:
        model = ChangeRequest
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']


class ClientSchedulerSerializer(serializers.ModelSerializer):
    class Meta:
        model = ClientScheduler
        fields = '__all__'


class ClientChangeLogSerializer(serializers.ModelSerializer):
    changed_by_name = serializers.ReadOnlyField(source='changed_by.username')

    class Meta:
        model = ClientChangeLog
        fields = '__all__'


class ClientStatusLogSerializer(serializers.ModelSerializer):
    changed_by_name = serializers.ReadOnlyField(source='changed_by.username')

    class Meta:
        model = ClientStatusLog
        fields = '__all__'


class ClientActivityLogSerializer(serializers.ModelSerializer):
    performed_by_username = serializers.ReadOnlyField(source='performed_by_user.username')
    event_type_display    = serializers.ReadOnlyField(source='get_event_type_display')

    class Meta:
        model  = ClientActivityLog
        fields = [
            'id', 'client', 'event_type', 'event_type_display',
            'title', 'description', 'amount',
            'performed_by', 'performed_by_username', 'created_at',
        ]
