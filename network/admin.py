# network/admin.py
# ─────────────────────────────────────────────────────────────────────────────
# Django Admin-এ সব network model নিবন্ধিত।
# NetworkNode ও NetworkLink-এ inline list_display ও filter সংযুক্ত করা হয়েছে
# যাতে admin panel থেকেই দ্রুত ডেটা পরিচালনা করা যায়।
# ─────────────────────────────────────────────────────────────────────────────

from django.contrib import admin
from .models import (
    NetworkPOP,
    NetworkConnection,
    NetworkDiagram,
    DistributedInventoryItem,
    NetworkNode,
    NetworkLink,
)


@admin.register(NetworkPOP)
class NetworkPOPAdmin(admin.ModelAdmin):
    list_display = ['name', 'address', 'is_active', 'created_at']
    list_filter = ['is_active']
    search_fields = ['name', 'address']


@admin.register(NetworkConnection)
class NetworkConnectionAdmin(admin.ModelAdmin):
    list_display = ['name', 'from_pop', 'to_pop', 'connection_type', 'is_active']
    list_filter = ['connection_type', 'is_active']


@admin.register(NetworkDiagram)
class NetworkDiagramAdmin(admin.ModelAdmin):
    list_display = ['name', 'is_active', 'created_by', 'created_at']
    list_filter = ['is_active']


@admin.register(DistributedInventoryItem)
class DistributedInventoryItemAdmin(admin.ModelAdmin):
    list_display = ['item', 'pop', 'quantity', 'installation_date']


@admin.register(NetworkNode)
class NetworkNodeAdmin(admin.ModelAdmin):
    """
    Network GIS node-এর admin view।
    মানচিত্রে প্রতিটি ডিভাইস এখান থেকেও তৈরি করা যাবে।
    """
    list_display = [
        'name', 'node_type', 'ip_address', 'status',
        'latitude', 'longitude', 'router',
    ]
    list_filter = ['node_type', 'status']
    search_fields = ['name', 'ip_address']
    readonly_fields = ['created_at', 'updated_at']
    fieldsets = (
        ('Basic Info', {
            'fields': ('name', 'node_type', 'ip_address', 'status', 'description')
        }),
        ('GIS Location', {'fields': ('latitude', 'longitude')}),
        ('Relational Links', {'fields': ('router', 'client')}),
        ('Topology Position', {'fields': ('pos_x', 'pos_y')}),
        ('Timestamps', {'fields': ('created_at', 'updated_at')}),
    )


@admin.register(NetworkLink)
class NetworkLinkAdmin(admin.ModelAdmin):
    """
    Network link-এর admin view।
    paths JSONField-এ Leaflet পলিলাইন coordinates সংরক্ষিত থাকে।
    """
    list_display = [
        'source_node', 'target_node', 'link_type',
        'color_code', 'distance', 'status',
    ]
    list_filter = ['link_type', 'status']
    search_fields = ['source_node__name', 'target_node__name', 'fiber_core_details']
    readonly_fields = ['created_at', 'updated_at']
