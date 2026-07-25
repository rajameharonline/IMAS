# Mobile API serializers — Client auth, profile, bills, tickets
from rest_framework import serializers
from clients.models import Client
from billing.models import Bill, Payment
from support.models import SupportTicket, TicketReply, SupportCategory
from system_settings.models import AppBanner, MobileAppConfig


class SendOTPSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=20)

    def validate_phone(self, value):
        # phone normalize: 01XXXXXXXX বা +8801XXXXXXXX → 01XXXXXXXX
        phone = value.strip()
        if phone.startswith('+880'):
            phone = '0' + phone[4:]
        elif phone.startswith('880') and len(phone) == 13:
            phone = '0' + phone[3:]
        if not phone.startswith('01') or len(phone) != 11:
            raise serializers.ValidationError('সঠিক বাংলাদেশী মোবাইল নম্বর দিন (01XXXXXXXXX)')
        return phone


class VerifyOTPSerializer(serializers.Serializer):
    phone    = serializers.CharField(max_length=20)
    otp_code = serializers.CharField(max_length=6, min_length=4)


class AppLoginSerializer(serializers.Serializer):
    # Role-aware login: Client (Customer Code) অথবা Staff (Username)।
    #  • Client app পুরনো মতোই customer_id পাঠায় → backward compatible।
    #  • Staff app username + login_type='staff' পাঠায়।
    #  • কোনোটি না থাকলে identifier দিয়ে auto-detect (client আগে, না পেলে staff)।
    customer_id = serializers.CharField(max_length=50, required=False, allow_blank=True)
    username    = serializers.CharField(max_length=150, required=False, allow_blank=True)
    identifier  = serializers.CharField(max_length=150, required=False, allow_blank=True)
    login_type  = serializers.ChoiceField(
        choices=['client', 'staff'], required=False, allow_blank=True,
    )
    password    = serializers.CharField(max_length=128, trim_whitespace=False)

    def validate(self, data):
        # identifier resolve: customer_id / username / identifier যেকোনো একটি
        ident = (data.get('customer_id') or data.get('username') or
                 data.get('identifier') or '').strip()
        if not ident:
            raise serializers.ValidationError(
                {'identifier': 'Customer Code বা Username দিন।'}
            )
        data['identifier'] = ident
        return data


class RegisterCheckSerializer(serializers.Serializer):
    # Self-registration ধাপ ১ — Client Code eligibility যাচাই
    customer_id = serializers.CharField(max_length=50)

    def validate_customer_id(self, value):
        return value.strip()


class AppRegisterSerializer(serializers.Serializer):
    # Self-registration ধাপ ২ — OTP + email + password দিয়ে register
    customer_id      = serializers.CharField(max_length=50)
    otp_code         = serializers.CharField(max_length=6, min_length=4)
    email            = serializers.EmailField(required=True, allow_blank=False)  # বাধ্যতামূলক
    password         = serializers.CharField(max_length=128, min_length=4, trim_whitespace=False)
    confirm_password = serializers.CharField(max_length=128, trim_whitespace=False)

    def validate_customer_id(self, value):
        return value.strip()

    def validate(self, data):
        if data['password'] != data['confirm_password']:
            raise serializers.ValidationError({'confirm_password': 'Password ও Confirm Password মেলেনি।'})
        return data


class FCMTokenSerializer(serializers.Serializer):
    fcm_token = serializers.CharField(max_length=300)


class AppClientProfileSerializer(serializers.ModelSerializer):
    package_name  = serializers.ReadOnlyField(source='package.name')
    zone_name     = serializers.ReadOnlyField(source='zone.name')
    subzone_name  = serializers.ReadOnlyField(source='subzone.name')
    # নোট: live Connected/Disconnected এখন HomeScreen-এ /app/me/traffic/ (Mikrotik
    # ground truth, প্রতি ৩s) থেকে আসে — তাই এখানে radacct-ভিত্তিক online field রাখা
    # হয়নি (radacct stale হতে পারত ও per-call query overhead যোগ করত)।

    class Meta:
        model = Client
        fields = [
            'id', 'customer_id', 'full_name', 'father_name', 'phone', 'alt_phone',
            'email', 'area', 'house_name', 'address', 'map_lat', 'map_lng',
            'status', 'package_name', 'zone_name', 'subzone_name',
            'expiry_date', 'monthly_bill', 'due_amount', 'advance_balance',
            'connection_date', 'is_vip', 'photo', 'app_enabled', 'app_last_seen',
        ]
        read_only_fields = [
            'id', 'customer_id', 'status', 'package_name', 'zone_name', 'subzone_name',
            'expiry_date', 'monthly_bill', 'due_amount', 'advance_balance',
            'connection_date', 'is_vip', 'app_enabled', 'app_last_seen',
        ]


class AppBillSerializer(serializers.ModelSerializer):
    payment_count   = serializers.SerializerMethodField()
    payment_methods = serializers.SerializerMethodField()

    class Meta:
        model = Bill
        fields = [
            'id', 'bill_month', 'amount', 'paid_amount', 'due_amount',
            'status', 'is_auto', 'payment_count', 'payment_methods', 'created_at',
        ]

    def get_payment_count(self, obj):
        return obj.payments.filter(is_verified=True).count()

    def get_payment_methods(self, obj):
        # এই bill-এর verified payment-গুলোর distinct method (যেমন ['bkash'] বা ['cash'])
        methods = obj.payments.filter(is_verified=True).values_list('payment_method', flat=True).distinct()
        return list(methods)


class AppPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ['id', 'amount', 'payment_method', 'received_at', 'notes']


class AppTicketCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupportTicket
        fields = ['id', 'subject', 'description', 'category']


class AppTicketListSerializer(serializers.ModelSerializer):
    category_name = serializers.ReadOnlyField(source='category.name')

    class Meta:
        model = SupportTicket
        fields = ['id', 'subject', 'status', 'priority', 'category_name', 'created_at', 'updated_at']


class AppTicketDetailSerializer(serializers.ModelSerializer):
    category_name = serializers.ReadOnlyField(source='category.name')
    replies       = serializers.SerializerMethodField()

    class Meta:
        model = SupportTicket
        fields = ['id', 'subject', 'description', 'status', 'priority',
                  'category_name', 'replies', 'created_at', 'updated_at']

    def get_replies(self, obj):
        qs = obj.replies.order_by('created_at')
        return [
            {
                'id': r.id,
                'message': r.message,
                # TicketReply-তে created_by নেই (ছিল replied_by) — আগে এখানে
                # AttributeError-এ পুরো ticket-detail API crash করত, তাই reply
                # থাকা ticket app-এ খুলত না। is_client_reply flag-ই নির্ভরযোগ্য।
                'is_staff': not r.is_client_reply,
                'created_at': r.created_at,
            }
            for r in qs
        ]


class AppBannerSerializer(serializers.ModelSerializer):
    # image_url — absolute URL (mobile app সরাসরি দেখাতে পারে)
    image_url = serializers.SerializerMethodField()

    def get_image_url(self, obj):
        if obj.image:
            request = self.context.get('request')
            return request.build_absolute_uri(obj.image.url) if request else obj.image.url
        return ''

    class Meta:
        model = AppBanner
        fields = ['id', 'title', 'body', 'image', 'image_url', 'link_url', 'priority']


class AppConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = MobileAppConfig
        fields = [
            'android_version', 'ios_version',
            'min_android_version', 'min_ios_version',
            'store_url_android', 'store_url_ios',
            'maintenance_mode', 'maintenance_message',
            'ticker_notice', 'ticker_color', 'ticker_bg', 'ticker_expires_at',
            'ftp_servers', 'live_tv_channels',
        ]


class PushNotificationSendSerializer(serializers.Serializer):
    title       = serializers.CharField(max_length=200)
    body        = serializers.CharField()
    target_type = serializers.ChoiceField(choices=['all', 'zone', 'client'])
    target_id   = serializers.IntegerField(required=False, allow_null=True)
    extra_data  = serializers.JSONField(required=False, default=dict)
