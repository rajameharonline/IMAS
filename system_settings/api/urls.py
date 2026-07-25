from django.urls import path, include
from rest_framework.routers import DefaultRouter
from system_settings.api.views import (
    CompanySetupViewSet, InvoiceSetupViewSet,
    SystemSettingViewSet, ActivityLogViewSet, AutomaticProcessViewSet,
    PaymentGatewayConfigViewSet, MobileAppConfigViewSet, AppBannerViewSet,
)

router = DefaultRouter()
router.register(r'company', CompanySetupViewSet)
router.register(r'invoice-setup', InvoiceSetupViewSet)
router.register(r'settings', SystemSettingViewSet)
router.register(r'activity-logs', ActivityLogViewSet)
router.register(r'automation', AutomaticProcessViewSet)
router.register(r'payment-gateways', PaymentGatewayConfigViewSet)
router.register(r'mobile-app-config', MobileAppConfigViewSet, basename='mobile-app-config')
router.register(r'app-banners', AppBannerViewSet)

urlpatterns = [path('', include(router.urls))]
