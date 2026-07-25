# OLT Management API URL configuration
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from olt_mgmt.api.views import (
    OLTViewSet, ONUSignalViewSet, OLTMacCacheViewSet,
    client_rx_powers, live_client_rx, olt_onu_log,
)

router = DefaultRouter()
router.register(r'olts', OLTViewSet)
router.register(r'onu-signals', ONUSignalViewSet)
router.register(r'mac-cache', OLTMacCacheViewSet)

urlpatterns = [
    path('', include(router.urls)),
    path('client-rx-powers/', client_rx_powers, name='client-rx-powers'),
    path('live-rx/', live_client_rx, name='live-client-rx'),
    path('onu-log/', olt_onu_log, name='olt-onu-log'),
]
