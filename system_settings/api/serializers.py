from rest_framework import serializers
from system_settings.models import (
    CompanySetup, InvoiceSetup, SystemSetting, ActivityLog, PaymentGatewayConfig,
    AutomaticProcess, MobileAppConfig, AppBanner,
)


class CompanySetupSerializer(serializers.ModelSerializer):
    logo_url = serializers.SerializerMethodField()

    def get_logo_url(self, obj):
        if obj.logo:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.logo.url)
            return obj.logo.url
        return ''

    class Meta:
        model = CompanySetup
        fields = '__all__'


class InvoiceSetupSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceSetup
        fields = '__all__'


class SystemSettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = SystemSetting
        fields = '__all__'


class ActivityLogSerializer(serializers.ModelSerializer):
    username = serializers.ReadOnlyField(source='user.username')

    class Meta:
        model = ActivityLog
        fields = '__all__'


class PaymentGatewayConfigSerializer(serializers.ModelSerializer):
    # password ও app_secret plain-text হিসেবে write, Fernet encrypted হিসেবে store
    password_plain   = serializers.CharField(write_only=True, required=False, allow_blank=True)
    app_secret_plain = serializers.CharField(write_only=True, required=False, allow_blank=True)
    gateway_label    = serializers.SerializerMethodField()

    def get_gateway_label(self, obj):
        return obj.get_gateway_display()

    def to_representation(self, instance):
        data = super().to_representation(instance)
        from role_permissions.utils import decrypt_password
        # password এবং app_secret decrypt করে পাঠানো হয়
        data['password_plain']   = decrypt_password(instance.password)   if instance.password   else ''
        data['app_secret_plain'] = decrypt_password(instance.app_secret) if instance.app_secret else ''
        return data

    def _encrypt_sensitive(self, validated_data):
        from role_permissions.utils import encrypt_password
        # password
        plain_pw = validated_data.pop('password_plain', None)
        if plain_pw is not None:
            validated_data['password'] = encrypt_password(plain_pw) if plain_pw else ''
        # app_secret
        plain_secret = validated_data.pop('app_secret_plain', None)
        if plain_secret is not None:
            validated_data['app_secret'] = encrypt_password(plain_secret) if plain_secret else ''
        return validated_data

    def create(self, validated_data):
        return super().create(self._encrypt_sensitive(validated_data))

    def update(self, instance, validated_data):
        return super().update(instance, self._encrypt_sensitive(validated_data))

    class Meta:
        model  = PaymentGatewayConfig
        fields = [
            'id', 'gateway', 'gateway_label', 'gateway_type',
            'sandbox_live', 'app_key', 'app_secret', 'app_secret_plain',
            'merchant_number', 'username', 'password', 'password_plain',
            'is_active', 'activation_date', 'expiry_date',
            'applicable_admin_portal', 'applicable_pop_portal',
            'applicable_bandwidth_pop', 'applicable_pop_client',
            'config', 'updated_at',
        ]
        extra_kwargs = {
            'password':   {'write_only': True},
            'app_secret': {'write_only': True},
        }


class MobileAppConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model  = MobileAppConfig
        fields = ['id', 'android_version', 'ios_version', 'min_android_version', 'min_ios_version',
                  'store_url_android', 'store_url_ios', 'maintenance_mode', 'maintenance_message',
                  'ticker_notice', 'ticker_color', 'ticker_bg', 'ticker_expires_at',
                  'ftp_servers', 'live_tv_channels', 'updated_at']


class AppBannerSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    def get_image_url(self, obj):
        if obj.image:
            request = self.context.get('request')
            return request.build_absolute_uri(obj.image.url) if request else obj.image.url
        return ''

    class Meta:
        model  = AppBanner
        fields = ['id', 'title', 'body', 'image', 'image_url', 'link_url',
                  'is_active', 'priority', 'expires_at', 'created_at']


class AutomaticProcessSerializer(serializers.ModelSerializer):
    run_hour   = serializers.SerializerMethodField()
    run_minute = serializers.SerializerMethodField()

    def get_run_hour(self, obj):
        # cron: "minute hour * * *"
        parts = obj.schedule_cron.split()
        try:
            return int(parts[1])
        except (IndexError, ValueError):
            return 0

    def get_run_minute(self, obj):
        parts = obj.schedule_cron.split()
        try:
            return int(parts[0])
        except (IndexError, ValueError):
            return 0

    class Meta:
        model = AutomaticProcess
        fields = '__all__'
