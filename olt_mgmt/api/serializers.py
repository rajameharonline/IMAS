from rest_framework import serializers
from olt_mgmt.models import OLT, ONUSignal, OLTMacCache

# পুনরাবৃত্ত literal — S1192 এড়াতে module constant
# display_name = ডিভাইসের আসল System Name, না থাকলে ম্যানুয়াল name (model property)
_SRC_OLT_NAME = 'olt.display_name'
_SRC_CLIENT_FULL_NAME = 'client.full_name'


class OLTSerializer(serializers.ModelSerializer):
    onu_count = serializers.IntegerField(read_only=True)
    mac_count = serializers.IntegerField(read_only=True)
    last_sync_label = serializers.SerializerMethodField()
    snmp_community = serializers.SerializerMethodField()
    # UI সব জায়গায় এই নামটাই দেখায় — ডিভাইসের System Name, নইলে ম্যানুয়াল name
    display_name = serializers.ReadOnlyField()

    class Meta:
        model = OLT
        fields = [
            'id', 'name', 'system_name', 'display_name',
            'ip_address', 'snmp_community', 'snmp_version',
            'vendor', 'model', 'fw_version', 'rx_snmp_oid', 'tx_snmp_oid',
            'location', 'mgmt_proto', 'telnet_port',
            'ssh_port', 'username', 'prompt_regex',
            'is_active', 'last_polled', 'last_sync_at', 'last_sync_status',
            'last_sync_count', 'last_sync_message', 'created_at', 'updated_at',
            'onu_count', 'mac_count', 'last_sync_label',
        ]
        read_only_fields = [
            'system_name',  # ডিভাইস থেকে auto — হাতে সেট করা যাবে না
            'last_polled', 'last_sync_at', 'last_sync_status',
            'last_sync_count', 'last_sync_message', 'created_at', 'updated_at',
        ]

    def get_last_sync_label(self, obj):
        if not obj.last_sync_at:
            return ''
        return obj.last_sync_at.strftime('%Y-%m-%d %H:%M')

    def get_snmp_community(self, obj):
        # SNMP community আসলে একটা read/write credential — আগে সব authenticated
        # user (role নির্বিশেষে) list/retrieve response-এ এটা plaintext পেত, যা
        # দিয়ে সরাসরি bypass করে snmpwalk/snmpset চালানো যায়। এখন শুধু
        # admin/superadmin পুরো মান দেখে, বাকিরা masked মান পায় (edit form-এ
        # admin ছাড়া কেউ community বদলানোর দরকারও পড়ে না — Create/Update
        # serializer আলাদা)।
        request = self.context.get('request')
        role = getattr(getattr(request, 'user', None), 'role', '')
        if role in ('admin', 'superadmin'):
            return obj.snmp_community
        return '••••••' if obj.snmp_community else ''


class OLTCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = OLT
        fields = [
            'id', 'name', 'ip_address', 'snmp_community', 'snmp_version',
            'vendor', 'model', 'fw_version', 'rx_snmp_oid', 'tx_snmp_oid',
            'location', 'mgmt_proto', 'telnet_port',
            'ssh_port', 'username', 'password', 'enable_password',
            'prompt_regex', 'is_active',
        ]
        extra_kwargs = {
            'password': {'write_only': True, 'required': False, 'allow_blank': True},
            'enable_password': {'write_only': True, 'required': False, 'allow_blank': True},
        }

    def _encrypt_secrets(self, validated_data):
        # Telnet/SSH password DB-তে plaintext না রেখে encrypt করে রাখা হয় —
        # role_permissions/utils.py-এর একই Fernet utility ব্যবহার করে, যা এই
        # প্রজেক্টের অন্য credential field-এর জন্য (system_settings ইত্যাদি)
        # ইতিমধ্যে established pattern।
        from role_permissions.utils import encrypt_password
        if validated_data.get('password'):
            validated_data['password'] = encrypt_password(validated_data['password'])
        if validated_data.get('enable_password'):
            validated_data['enable_password'] = encrypt_password(validated_data['enable_password'])
        return validated_data

    def create(self, validated_data):
        return super().create(self._encrypt_secrets(validated_data))


class OLTUpdateSerializer(OLTCreateSerializer):
    def update(self, instance, validated_data):
        if validated_data.get('password', None) == '':
            validated_data.pop('password', None)
        if validated_data.get('enable_password', None) == '':
            validated_data.pop('enable_password', None)
        validated_data = self._encrypt_secrets(validated_data)
        return super().update(instance, validated_data)


class ONUSignalSerializer(serializers.ModelSerializer):
    olt_name = serializers.ReadOnlyField(source=_SRC_OLT_NAME)
    client_name = serializers.ReadOnlyField(source=_SRC_CLIENT_FULL_NAME)
    client_phone = serializers.ReadOnlyField(source='client.phone')
    client_address = serializers.ReadOnlyField(source='client.address')
    customer_id = serializers.ReadOnlyField(source='client.customer_id')
    # Zone কলাম — Zone › SubZone • Box (client linked থাকলে)
    zone_name = serializers.SerializerMethodField()
    subzone_name = serializers.SerializerMethodField()
    box_name = serializers.SerializerMethodField()

    def get_zone_name(self, obj):
        return obj.client.zone.name if (obj.client and obj.client.zone_id) else ''

    def get_subzone_name(self, obj):
        return obj.client.subzone.name if (obj.client and obj.client.subzone_id) else ''

    def get_box_name(self, obj):
        return obj.client.box.name if (obj.client and obj.client.box_id) else ''

    # ── ONU Monitoring টেবিলে দেখানোর জন্য আলাদা field ──
    # description: OLT থেকে শেখা ONU description (OLTMacCache.description → ONUSignal.notes)
    # mac_address: OLT MAC table থেকে শেখা MAC (refresh-from-inventory raw_data['mac']-এ store হয়)
    description = serializers.SerializerMethodField()
    mac_address = serializers.SerializerMethodField()

    def get_description(self, obj):
        # ONUSignal.notes মূলত OLTMacCache.description-এর কপি (sync-এর সময় বসে)।
        return obj.notes or ''

    def get_mac_address(self, obj):
        # MAC raw_data-এ আসে (refresh-from-inventory mac_cache branch থেকে),
        # সরাসরি field না থাকায় JSON থেকে নিরাপদে extract করা।
        raw = obj.raw_data or {}
        return raw.get('mac', '') or ''

    # ── Distance ও Last Deregister Reason ──────────────────────────────
    # এই দুটো ONUSignal-এ নেই, থাকে OLTMacCache-এ (single source of truth;
    # ONUSignal.raw_data ইচ্ছাকৃতভাবে minimal রাখা — tasks.py-র কমেন্ট দেখুন)।
    # N+1 query এড়াতে monitor endpoint প্রতি-request একবার map বানিয়ে
    # context-এ দেয় (`mac_info`); context না থাকলে চুপচাপ খালি ফেরত যায়।
    distance_m = serializers.SerializerMethodField()
    last_dereg_reason = serializers.SerializerMethodField()
    # ডিভাইসের ONU Status টেবিলের raw string — OLT-এর নিজের ঘড়ি অনুযায়ী।
    # নোট: এই OLT-গুলোর ঘড়ি ভুল সময়ে সেট (যেমন "2033/04/08") — ইচ্ছাকৃতভাবে
    # parse/convert করা হয় না, ডিভাইসে যা আছে হুবহু তাই দেখানো হয়।
    last_dereg_time = serializers.SerializerMethodField()
    alive_time = serializers.SerializerMethodField()

    def _mac_info(self, obj):
        key = (obj.olt_id, (obj.raw_data or {}).get('mac') or '')
        return (self.context.get('mac_info') or {}).get(key) or {}

    def get_distance_m(self, obj):
        return self._mac_info(obj).get('distance_m')

    def get_last_dereg_reason(self, obj):
        return self._mac_info(obj).get('last_dereg_reason') or ''

    def get_last_dereg_time(self, obj):
        return self._mac_info(obj).get('last_dereg_time') or ''

    def get_alive_time(self, obj):
        return self._mac_info(obj).get('alive_time') or ''

    class Meta:
        model = ONUSignal
        fields = [
            'id', 'olt', 'olt_name',
            'client', 'client_name', 'client_phone', 'client_address',
            'customer_id', 'zone_name', 'subzone_name', 'box_name',
            'interface_id', 'rx_power', 'tx_power',
            'signal_status', 'last_updated', 'notes', 'raw_data',
            'description', 'mac_address',
            'distance_m', 'last_dereg_reason', 'last_dereg_time', 'alive_time',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']


class OLTMacCacheSerializer(serializers.ModelSerializer):
    olt_name       = serializers.ReadOnlyField(source=_SRC_OLT_NAME)
    olt_ip_address = serializers.ReadOnlyField(source='olt.ip_address')
    client_name    = serializers.ReadOnlyField(source=_SRC_CLIENT_FULL_NAME)

    class Meta:
        model = OLTMacCache
        fields = '__all__'
