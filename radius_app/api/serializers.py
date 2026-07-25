# এই ফাইলটি RADIUS সার্ভার serializers — create/update-এ password আলাদাভাবে handle হয়।
from rest_framework import serializers
from radius_app.models import RadiusLog, RadiusSession, RadiusServer


class RadiusLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = RadiusLog
        fields = '__all__'


class RadiusSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = RadiusSession
        fields = '__all__'


class RadiusServerSerializer(serializers.ModelSerializer):
    # তালিকা ও detail view — password/secret দেখানো হয় না (security)
    class Meta:
        model = RadiusServer
        fields = [
            'id', 'name', 'server_type',
            'db_host', 'db_port', 'db_name', 'db_user',
            'radius_host', 'radius_auth_port', 'radius_acct_port',
            'is_active', 'is_default', 'last_tested', 'last_test_status',
            'description', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'last_tested', 'last_test_status', 'created_at', 'updated_at']


class RadiusServerCreateSerializer(serializers.ModelSerializer):
    # নতুন RADIUS সার্ভার তৈরি — db_password ও shared_secret আবশ্যক
    class Meta:
        model = RadiusServer
        fields = [
            'name', 'server_type',
            'db_host', 'db_port', 'db_name', 'db_user', 'db_password',
            'radius_host', 'radius_auth_port', 'radius_acct_port', 'shared_secret',
            'is_active', 'is_default', 'description',
        ]

    def validate_name(self, value):
        if RadiusServer.objects.filter(name=value).exists():
            raise serializers.ValidationError("এই নামে RADIUS সার্ভার ইতোমধ্যে আছে।")
        return value

    def validate_db_port(self, value):
        if not (1 <= value <= 65535):
            raise serializers.ValidationError("DB Port অবশ্যই 1-65535 এর মধ্যে হতে হবে।")
        return value

    def validate_radius_auth_port(self, value):
        if not (1 <= value <= 65535):
            raise serializers.ValidationError("Auth Port অবশ্যই 1-65535 এর মধ্যে হতে হবে।")
        return value


class RadiusServerUpdateSerializer(serializers.ModelSerializer):
    # সার্ভার আপডেট — password/secret optional (খালি রাখলে পুরনো থাকবে)
    db_password = serializers.CharField(required=False, allow_blank=True, write_only=True)
    shared_secret = serializers.CharField(required=False, allow_blank=True, write_only=True)

    class Meta:
        model = RadiusServer
        fields = [
            'name', 'server_type',
            'db_host', 'db_port', 'db_name', 'db_user', 'db_password',
            'radius_host', 'radius_auth_port', 'radius_acct_port', 'shared_secret',
            'is_active', 'is_default', 'description',
        ]

    def update(self, instance, validated_data):
        # password/secret খালি হলে পুরনো রাখা হবে
        db_password = validated_data.pop('db_password', None)
        shared_secret = validated_data.pop('shared_secret', None)
        if db_password:
            instance.db_password = db_password
        if shared_secret:
            instance.shared_secret = shared_secret
        return super().update(instance, validated_data)
