from django.urls import path, include
from rest_framework.routers import DefaultRouter
from clients.api.views import (
    ClientViewSet, LeftClientViewSet, ChangeRequestViewSet, ClientSchedulerViewSet,
    ClientChangeLogViewSet, ClientStatusLogViewSet, ClientActivityLogViewSet,
)

router = DefaultRouter()
router.register(r'clients', ClientViewSet, basename='client')
router.register(r'left-clients', LeftClientViewSet)
router.register(r'change-requests', ChangeRequestViewSet)
router.register(r'schedulers', ClientSchedulerViewSet)
router.register(r'client-change-logs', ClientChangeLogViewSet, basename='client-change-log')
router.register(r'client-status-logs', ClientStatusLogViewSet, basename='client-status-log')
router.register(r'client-activity-logs', ClientActivityLogViewSet, basename='client-activity-log')

urlpatterns = [path('', include(router.urls))]
