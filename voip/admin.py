# VoIP মডেলের Django admin bindings।
from django.contrib import admin

from voip.models import SipEndpoint, CallLog, VoiceMessage


@admin.register(SipEndpoint)
class SipEndpointAdmin(admin.ModelAdmin):
    list_display = ('endpoint_name', 'kind', 'is_active', 'max_contacts', 'updated_at')
    list_filter = ('kind', 'is_active')
    search_fields = ('endpoint_name',)
    # secret_encrypted ইচ্ছাকৃতভাবে দেখানো হয় না (নিরাপত্তা)।
    exclude = ('secret_encrypted',)


@admin.register(CallLog)
class CallLogAdmin(admin.ModelAdmin):
    list_display = ('id', 'direction', 'caller_endpoint', 'callee_endpoint',
                    'status', 'duration', 'started_at')
    list_filter = ('direction', 'status')
    search_fields = ('sip_channel', 'caller_endpoint', 'callee_endpoint')
    date_hierarchy = 'started_at'


@admin.register(VoiceMessage)
class VoiceMessageAdmin(admin.ModelAdmin):
    list_display = ('id', 'client', 'sent_by', 'duration', 'is_heard', 'created_at')
    list_filter = ('is_heard',)
