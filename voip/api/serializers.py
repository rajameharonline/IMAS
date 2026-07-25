# VoIP API serializers।
from rest_framework import serializers

from voip.models import (
    CallLog, VoiceMessage, VoiceRecording, VoiceCallSchedule,
    PBXAgent, RingGroup, RingGroupMember,
    IVRMenu, IVROption, HotlineNumber, PBXBusinessHour,
)


class CallLogSerializer(serializers.ModelSerializer):
    client_name = serializers.ReadOnlyField(source='client.full_name')
    client_customer_id = serializers.ReadOnlyField(source='client.customer_id')
    agent_name = serializers.SerializerMethodField()

    def get_agent_name(self, obj):
        if not obj.agent:
            return ''
        return getattr(obj.agent, 'full_name', '') or obj.agent.username

    class Meta:
        model = CallLog
        fields = [
            'id', 'client', 'client_name', 'client_customer_id',
            'agent', 'agent_name', 'direction', 'sip_channel',
            'caller_endpoint', 'callee_endpoint',
            'started_at', 'answered_at', 'ended_at', 'duration',
            'status', 'recording', 'note', 'created_at',
        ]
        read_only_fields = fields  # call log ARI listener লেখে, API থেকে edit নয়


class VoiceMessageSerializer(serializers.ModelSerializer):
    client_name = serializers.ReadOnlyField(source='client.full_name')
    sent_by_name = serializers.SerializerMethodField()

    def get_sent_by_name(self, obj):
        if not obj.sent_by:
            return ''
        return getattr(obj.sent_by, 'full_name', '') or obj.sent_by.username

    class Meta:
        model = VoiceMessage
        fields = [
            'id', 'client', 'client_name', 'sent_by', 'sent_by_name',
            'audio', 'duration', 'is_heard', 'heard_at', 'created_at',
        ]
        read_only_fields = ['sent_by', 'is_heard', 'heard_at', 'created_at']


class VoiceRecordingSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()

    def get_created_by_name(self, obj):
        if not obj.created_by:
            return ''
        return getattr(obj.created_by, 'full_name', '') or obj.created_by.username

    class Meta:
        model = VoiceRecording
        fields = [
            'id', 'title', 'audio', 'duration',
            'created_by', 'created_by_name', 'created_at',
        ]
        read_only_fields = ['created_by', 'created_at']


class VoiceCallScheduleSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    timing_label = serializers.CharField(source='get_timing_display', read_only=True)
    recording_title = serializers.ReadOnlyField(source='recording.title')
    # play করার জন্য — recording থাকলে সেটার audio, নইলে inline audio।
    audio_url = serializers.SerializerMethodField()

    def get_created_by_name(self, obj):
        if not obj.created_by:
            return ''
        return getattr(obj.created_by, 'full_name', '') or obj.created_by.username

    def get_audio_url(self, obj):
        f = (obj.recording.audio if obj.recording else None) or obj.audio
        if not f:
            return ''
        url = f.url
        request = self.context.get('request')
        return request.build_absolute_uri(url) if request else url

    class Meta:
        model = VoiceCallSchedule
        fields = [
            'id', 'name', 'recording', 'recording_title', 'audio', 'audio_url',
            'days', 'timing', 'timing_label', 'run_time',
            'status_filter', 'is_active', 'last_run_date',
            'created_by', 'created_by_name', 'created_at',
        ]
        read_only_fields = ['last_run_date', 'created_by', 'created_at']


# ─── IP-PBX / Hotline serializers ────────────────────────────────────────────

class PBXAgentSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()

    def get_user_name(self, obj):
        if not obj.user:
            return ''
        return getattr(obj.user, 'full_name', '') or obj.user.username

    class Meta:
        model  = PBXAgent
        fields = [
            'id', 'user', 'user_name', 'display_name', 'extension',
            'sip_endpoint_name', 'role_label', 'is_active', 'priority',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']


class RingGroupMemberSerializer(serializers.ModelSerializer):
    agent_name      = serializers.ReadOnlyField(source='agent.display_name')
    agent_extension = serializers.ReadOnlyField(source='agent.extension')

    class Meta:
        model  = RingGroupMember
        fields = ['id', 'ring_group', 'agent', 'agent_name', 'agent_extension', 'order', 'enabled']


class RingGroupSerializer(serializers.ModelSerializer):
    members = RingGroupMemberSerializer(many=True, read_only=True)

    class Meta:
        model  = RingGroup
        fields = [
            'id', 'name', 'strategy', 'timeout_seconds', 'retry_seconds',
            'no_answer_route_type', 'no_answer_forward_num',
            'is_active', 'members', 'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']


class IVROptionSerializer(serializers.ModelSerializer):
    ring_group_name = serializers.ReadOnlyField(source='ring_group.name')
    agent_name      = serializers.ReadOnlyField(source='agent.display_name')

    class Meta:
        model  = IVROption
        fields = [
            'id', 'ivr', 'digit', 'label', 'route_type',
            'ring_group', 'ring_group_name',
            'agent', 'agent_name',
            'forward_number', 'order',
        ]


class IVRMenuSerializer(serializers.ModelSerializer):
    options = IVROptionSerializer(many=True, read_only=True)

    class Meta:
        model  = IVRMenu
        fields = [
            'id', 'name', 'greeting_file', 'greeting_upload',
            'timeout_seconds', 'invalid_msg_file',
            'is_active', 'options', 'created_at', 'updated_at',
        ]
        read_only_fields = ['greeting_file', 'created_at', 'updated_at']


class PBXBusinessHourSerializer(serializers.ModelSerializer):
    weekday_label = serializers.CharField(source='get_weekday_display', read_only=True)

    class Meta:
        model  = PBXBusinessHour
        fields = ['id', 'hotline', 'weekday', 'weekday_label', 'start_time', 'end_time', 'is_open']


class HotlineNumberSerializer(serializers.ModelSerializer):
    ring_group_name  = serializers.ReadOnlyField(source='default_ring_group.name')
    ivr_name         = serializers.ReadOnlyField(source='default_ivr.name')
    agent_name       = serializers.ReadOnlyField(source='default_agent.display_name')
    business_hours   = PBXBusinessHourSerializer(many=True, read_only=True)

    class Meta:
        model  = HotlineNumber
        fields = [
            'id', 'title', 'number', 'provider_type',
            'sip_trunk_host', 'sip_trunk_username',
            'is_active',
            'default_route_type',
            'default_ring_group', 'ring_group_name',
            'default_ivr', 'ivr_name',
            'default_agent', 'agent_name',
            'forward_number',
            'business_hours_enabled', 'after_hours_message',
            'business_hours',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']
        extra_kwargs = {'sip_trunk_password_enc': {'write_only': True}}
