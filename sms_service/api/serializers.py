from rest_framework import serializers
from sms_service.models import SMSGateway, SMSTemplate, SMSGroup, SMSLog


class SMSGatewaySerializer(serializers.ModelSerializer):
    provider_label = serializers.CharField(source='get_provider_type_display', read_only=True)

    class Meta:
        model = SMSGateway
        fields = ['id', 'name', 'provider_type', 'provider_label', 'api_url', 'api_key',
                  'sender_id', 'config', 'is_active', 'is_default', 'created_at', 'updated_at']
        extra_kwargs = {
            'api_key':   {'required': False, 'allow_blank': True},
            'api_url':   {'required': False, 'allow_blank': True},
            'sender_id': {'required': False, 'allow_blank': True},
        }


class SMSTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = SMSTemplate
        fields = '__all__'


class SMSGroupSerializer(serializers.ModelSerializer):
    class Meta:
        model = SMSGroup
        fields = '__all__'


class SMSLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = SMSLog
        fields = '__all__'


class SendSMSSerializer(serializers.Serializer):
    phones = serializers.ListField(child=serializers.CharField())
    message = serializers.CharField()
    template_id = serializers.IntegerField(required=False)
