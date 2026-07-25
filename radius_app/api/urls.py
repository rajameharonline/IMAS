# এই ফাইলটি RADIUS app-এর API URL routes।
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from radius_app.api.views import RadiusServerViewSet, online_users, disconnect_user, auto_detect, quick_test, traffic_history

router = DefaultRouter()
router.register(r'servers', RadiusServerViewSet, basename='radius-server')

urlpatterns = [
    path('', include(router.urls)),
    path('online-users/', online_users),
    path('disconnect/', disconnect_user),
    path('auto-detect/', auto_detect),
    path('quick-test/', quick_test),
    path('traffic-history/', traffic_history),
]
