from django.contrib import admin
from olt_mgmt.models import OLT, ONUSignal, OLTMacCache, SNMPTrapLog


@admin.register(SNMPTrapLog)
class SNMPTrapLogAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'source_ip', 'event', 'interface_id', 'handled', 'summary')
    list_filter = ('event', 'handled', 'source_ip')
    search_fields = ('source_ip', 'interface_id', 'trap_oid', 'summary')
    readonly_fields = ('created_at',)


@admin.register(OLT)
class OLTAdmin(admin.ModelAdmin):
    list_display = ('name', 'vendor', 'ip_address', 'mgmt_proto', 'is_active', 'last_sync_at', 'last_sync_count')
    list_filter = ('vendor', 'mgmt_proto', 'is_active')
    search_fields = ('name', 'ip_address', 'location')


@admin.register(OLTMacCache)
class OLTMacCacheAdmin(admin.ModelAdmin):
    list_display = ('olt', 'mac', 'port', 'onu', 'status', 'rx_power_dbm', 'client', 'learned_at')
    list_filter = ('olt', 'vendor', 'status')
    search_fields = ('mac', 'description', 'port', 'onu')


@admin.register(ONUSignal)
class ONUSignalAdmin(admin.ModelAdmin):
    list_display = ('client', 'olt', 'interface_id', 'rx_power', 'signal_status', 'last_updated')
    list_filter = ('olt', 'signal_status')
    search_fields = ('interface_id', 'client__full_name', 'client__phone', 'client__customer_id')
