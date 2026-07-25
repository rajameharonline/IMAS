# এই ফাইলটি Support module-এর DRF serializer সংজ্ঞা ধারণ করে।
#
# Design rule: frontend Ticket form-এ "ticket_type", "ticket_no",
# "assigned_employee" ইত্যাদি label ব্যবহার করা হয়, কিন্তু DB model-এ
# field name হলো category / ticket_id / assigned_to। তাই serializer-এ
# alias করি — DB rename ছাড়াই API surface সুন্দর রাখার জন্য।

from rest_framework import serializers
from django.contrib.auth import get_user_model

from support.models import (
    SupportCategory,
    SupportTicket,
    TicketReply,
    TicketActivityLog,
    StaffNotification,
)

User = get_user_model()


# ════════════════════════════════════════════════════════════════════
# TicketType (SupportCategory alias) — admin lookup CRUD
# ════════════════════════════════════════════════════════════════════
class SupportCategorySerializer(serializers.ModelSerializer):
    # frontend "Ticket Type" wording-এ পরিচালিত হবে — alias দরকার নেই,
    # name field-ই enough।
    ticket_count = serializers.SerializerMethodField()

    class Meta:
        model = SupportCategory
        fields = ['id', 'name', 'description', 'is_active', 'created_at', 'ticket_count']
        read_only_fields = ['id', 'created_at']

    def get_ticket_count(self, obj):
        # admin lookup table-এ কোন type-এ কতগুলো ticket আছে সেটা দেখানোর জন্য।
        return obj.tickets.count() if hasattr(obj, 'tickets') else 0


# ════════════════════════════════════════════════════════════════════
# Activity log — read-only timeline serializer
# ════════════════════════════════════════════════════════════════════
class TicketActivityLogSerializer(serializers.ModelSerializer):
    actor_name = serializers.ReadOnlyField(source='actor.username')
    action_display = serializers.CharField(source='get_action_type_display', read_only=True)

    class Meta:
        model = TicketActivityLog
        fields = [
            'id', 'action_type', 'action_display',
            'from_value', 'to_value', 'message',
            'actor', 'actor_name', 'created_at',
        ]
        read_only_fields = fields


# ════════════════════════════════════════════════════════════════════
# Reply — staff/client conversation thread
# ════════════════════════════════════════════════════════════════════
class TicketReplySerializer(serializers.ModelSerializer):
    replied_by_name = serializers.ReadOnlyField(source='replied_by.username')

    class Meta:
        model = TicketReply
        fields = [
            'id', 'ticket', 'message', 'is_client_reply',
            'replied_by', 'replied_by_name', 'created_at',
        ]
        read_only_fields = ['id', 'created_at', 'replied_by']


# ════════════════════════════════════════════════════════════════════
# Ticket — main serializer with alias fields + nested logs
# ════════════════════════════════════════════════════════════════════
class SupportTicketSerializer(serializers.ModelSerializer):
    # ── Alias fields (DB rename ছাড়াই UI-friendly naming) ─────────
    ticket_no = serializers.CharField(source='ticket_id', read_only=True)
    ticket_type = serializers.PrimaryKeyRelatedField(
        source='category', queryset=SupportCategory.objects.all(),
        required=False, allow_null=True,
    )
    ticket_type_name = serializers.ReadOnlyField(source='category.name')
    assigned_employee = serializers.PrimaryKeyRelatedField(
        source='assigned_to', queryset=User.objects.all(),
        required=False, allow_null=True,
    )
    assigned_employee_name = serializers.SerializerMethodField()

    # ── Client snapshot — table render-এ JOIN ছাড়া কাজ চলে ────────
    client_name = serializers.ReadOnlyField(source='client.full_name')
    client_phone = serializers.ReadOnlyField(source='client.phone')
    client_customer_id = serializers.ReadOnlyField(source='client.customer_id')
    client_zone_name = serializers.ReadOnlyField(source='client.zone_name')

    # ── Display helpers ───────────────────────────────────────────
    priority_display = serializers.CharField(source='get_priority_display', read_only=True)
    status_display   = serializers.CharField(source='get_status_display', read_only=True)
    source_display   = serializers.CharField(source='get_source_display', read_only=True)
    # CreatedBy — full_name preferred, fallback username (assigned-এর সাথে consistency)।
    created_by_name  = serializers.SerializerMethodField()

    # ── Nested: replies + activity timeline ───────────────────────
    replies = TicketReplySerializer(many=True, read_only=True)
    activity_logs = TicketActivityLogSerializer(many=True, read_only=True)

    class Meta:
        model = SupportTicket
        fields = [
            'id', 'ticket_id', 'ticket_no',
            'client', 'client_name', 'client_phone',
            'client_customer_id', 'client_zone_name',
            'category', 'ticket_type', 'ticket_type_name',
            'subject', 'description',
            'priority', 'priority_display',
            'status', 'status_display',
            'source', 'source_display',
            'assigned_to', 'assigned_employee',
            'assigned_employee_name',
            'created_by', 'created_by_name',
            'resolved_at', 'closed_at',
            'created_at', 'updated_at',
            'replies', 'activity_logs',
        ]
        read_only_fields = [
            'id', 'ticket_id', 'ticket_no',
            'created_by', 'created_by_name',
            'resolved_at', 'closed_at',
            'created_at', 'updated_at',
        ]

    def get_assigned_employee_name(self, obj):
        # assigned_to user-এর full_name থাকলে full_name, না হলে username।
        u = obj.assigned_to
        if not u:
            return ''
        return getattr(u, 'full_name', '') or u.username

    def get_created_by_name(self, obj):
        u = obj.created_by
        if not u:
            return ''
        return getattr(u, 'full_name', '') or u.username

    def validate(self, attrs):
        # subject এবং description খালি রাখা যাবে না — কোনোভাবে frontend bypass হলে।
        if not attrs.get('subject', '').strip():
            raise serializers.ValidationError({'subject': 'Subject is required.'})
        if not attrs.get('description', '').strip():
            raise serializers.ValidationError({'description': 'Description is required.'})
        return attrs


# ════════════════════════════════════════════════════════════════════
# Light-weight ticket list serializer — large-table fast rendering
# ════════════════════════════════════════════════════════════════════
class SupportTicketListSerializer(serializers.ModelSerializer):
    ticket_no = serializers.CharField(source='ticket_id', read_only=True)
    client_name = serializers.ReadOnlyField(source='client.full_name')
    client_phone = serializers.ReadOnlyField(source='client.phone')
    client_customer_id = serializers.ReadOnlyField(source='client.customer_id')
    ticket_type_name = serializers.ReadOnlyField(source='category.name')
    assigned_employee_name = serializers.SerializerMethodField()
    # CreatedBy column — full_name না থাকলে username fallback।
    # পূর্বে list serializer-এ এই field অনুপস্থিত ছিল → frontend "—" দেখাত।
    created_by_name = serializers.SerializerMethodField()
    priority_display = serializers.CharField(source='get_priority_display', read_only=True)
    status_display   = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = SupportTicket
        fields = [
            'id', 'ticket_id', 'ticket_no',
            'client', 'client_name', 'client_phone', 'client_customer_id',
            'category', 'ticket_type_name',
            'subject',
            'priority', 'priority_display',
            'status', 'status_display',
            'source',
            'assigned_to', 'assigned_employee_name',
            'created_by', 'created_by_name',
            'resolved_at', 'closed_at',
            'created_at', 'updated_at',
        ]

    def get_assigned_employee_name(self, obj):
        u = obj.assigned_to
        if not u:
            return ''
        return getattr(u, 'full_name', '') or u.username

    def get_created_by_name(self, obj):
        u = obj.created_by
        if not u:
            return ''
        return getattr(u, 'full_name', '') or u.username


# ════════════════════════════════════════════════════════════════════
# Staff Notification — bell badge feed
# ════════════════════════════════════════════════════════════════════
class StaffNotificationSerializer(serializers.ModelSerializer):
    notif_type_display = serializers.CharField(source='get_notif_type_display', read_only=True)
    ticket_no = serializers.ReadOnlyField(source='related_ticket.ticket_id')

    class Meta:
        model = StaffNotification
        fields = [
            'id', 'notif_type', 'notif_type_display',
            'title', 'message', 'link_url',
            'related_ticket', 'ticket_no',
            'is_read', 'created_at', 'read_at',
        ]
        read_only_fields = fields
