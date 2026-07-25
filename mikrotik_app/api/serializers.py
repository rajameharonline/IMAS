# এই ফাইলটি Mikrotik server serializers — create/update-এ password আলাদাভাবে handle হয়।
from rest_framework import serializers
from mikrotik_app.models import MikrotikServer, RouterBackup, ImportedClient
class MikrotikServerSerializer(serializers.ModelSerializer):
    # তালিকা ও detail view — password দেখানো হয় না (security)
    radius_server_name = serializers.ReadOnlyField(source='radius_server.name')

    class Meta:
        model = MikrotikServer
        fields = [
            'id', 'name', 'host', 'port', 'username',
            'is_active', 'last_connected', 'description',
            'radius_server', 'radius_server_name', 'radius_configured', 'radius_configured_at',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'last_connected', 'radius_configured', 'radius_configured_at', 'created_at', 'updated_at']


class MikrotikServerCreateSerializer(serializers.ModelSerializer):
    # নতুন সার্ভার তৈরি — name router থেকে auto-fill হয়, password আবশ্যক
    class Meta:
        model = MikrotikServer
        fields = ['name', 'host', 'port', 'username', 'password', 'description', 'is_active']

    def validate_port(self, value):
        if not (1 <= value <= 65535):
            raise serializers.ValidationError("Port অবশ্যই 1-65535 এর মধ্যে হতে হবে।")
        return value

    def validate(self, attrs):
        name = attrs.get('name', '')
        if name and MikrotikServer.objects.filter(name=name).exists():
            raise serializers.ValidationError({'name': "এই নামে সার্ভার ইতোমধ্যে আছে।"})
        return attrs


class MikrotikServerUpdateSerializer(serializers.ModelSerializer):
    # সার্ভার আপডেট — password optional (খালি রাখলে পুরনো password থাকবে)
    password = serializers.CharField(required=False, allow_blank=True, write_only=True)

    class Meta:
        model = MikrotikServer
        fields = ['name', 'host', 'port', 'username', 'password', 'description', 'is_active']

    def update(self, instance, validated_data):
        # password খালি হলে পুরনো password রাখা হবে
        password = validated_data.pop('password', None)
        if password:
            instance.password = password
        return super().update(instance, validated_data)


class RouterBackupSerializer(serializers.ModelSerializer):
    server_name = serializers.ReadOnlyField(source='server.name')

    class Meta:
        model = RouterBackup
        fields = '__all__'


class ImportedClientSerializer(serializers.ModelSerializer):
    server_name = serializers.ReadOnlyField(source='server.name')

    class Meta:
        model = ImportedClient
        fields = '__all__'
