from django.urls import path, include
from rest_framework.routers import DefaultRouter
from mikrotik_app.api.views import (
    MikrotikServerViewSet, RouterBackupViewSet, ImportedClientViewSet,
    fetch_router_info, all_online_usernames, client_traffic, ping_client,
)

router = DefaultRouter()
router.register(r'servers', MikrotikServerViewSet)
router.register(r'backups', RouterBackupViewSet)
router.register(r'imported-clients', ImportedClientViewSet)

urlpatterns = [
    path('', include(router.urls)),
    path('fetch-router-info/', fetch_router_info),
    path('online-usernames/', all_online_usernames),
    path('traffic/<str:username>/', client_traffic),
    path('ping/', ping_client),
]
