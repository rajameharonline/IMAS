# ISP Billing & Network Automation System - Main URL Configuration
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from config.walled_garden import expired_notice

# সব API endpoint /api/v1/ prefix দিয়ে সংগঠিত করা হয়েছে
api_v1_patterns = [
    # Authentication & Users
    path('auth/', include('accounts.api.urls')),

    # Configuration (Zone, SubZone, Box, Package etc.)
    path('config/', include('configuration.api.urls')),

    # Clients
    path('', include('clients.api.urls')),

    # Billing & Payments
    path('billing/', include('billing.api.urls')),

    # FreeRADIUS - online user এর জন্য
    path('radius/', include('radius_app.api.urls')),

    # Mikrotik RouterOS
    path('mikrotik/', include('mikrotik_app.api.urls')),

    # OLT Management
    path('olt/', include('olt_mgmt.api.urls')),

    # HR & Payroll
    path('hr/', include('hr.api.urls')),

    # Accounting
    path('accounting/', include('accounting.api.urls')),

    # Inventory master data (Item Category, Item)
    path('inventory/', include('inventory.api.urls')),

    # Bandwidth Buy / Provider Bills
    path('purchase/', include('purchase.api.urls')),

    # Reports
    path('reports/', include('reports.api.urls')),

    # SMS Service
    path('sms/', include('sms_service.api.urls')),

    # Support & Ticketing
    path('support/', include('support.api.urls')),

    # Task Management (Module 7) — Tasks, My Tasks, Categories, stats
    path('tasks/', include('tasks_mgmt.api.urls')),

    # System Settings (Company, Invoice Setup)
    path('system/', include('system_settings.api.urls')),

    # Network GIS Map & Topology (Module 9)
    # nodes, links CRUD + topology React Flow endpoint + position drag-save
    path('network/', include('network.api.urls')),

    # Sales & Service (Product Sales Invoice + Service Sales Invoice)
    path('sales/', include('sales.api.urls')),

    # Role & Permission Management (App Users, Role Groups, Module Permissions)
    path('role-permissions/', include('role_permissions.api.urls')),

    # Mobile App Client API
    path('app/', include('mobile_api.api.urls')),

    # VoIP / IP-phone কলিং (Asterisk app-to-app) — VOIP_PLAN.md
    path('voip/', include('voip.api.urls')),

    # POP Management (Reseller/Distributor)
    path('pop/', include('pop.api.urls')),

    # Live TV চ্যানেল ব্রডকাস্ট (DVB + FFmpeg QSV HLS)
    path('livetv/', include('livetv.api.urls')),
]

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/v1/', include(api_v1_patterns)),

    # Walled garden — expired client notice page (anonymous, HTML)
    # MikroTik HTTP redirect এখানে আসে; Nginx walled-garden server block
    # যেকোনো path-কে /expired/-এ rewrite করে দেয় (নিচের সেটআপ নোট দেখুন)।
    path('expired/', expired_notice, name='expired-notice'),
]

# Development-এ media files serve করা হচ্ছে
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
