# Purchase module API URLs — ISP hardware flow + Bandwidth provider flow।
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from purchase.api.views import (
    VendorViewSet,
    PurchaseRequisitionViewSet,
    PurchaseOrderViewSet,
    PurchaseBillViewSet,
    ProviderViewSet,
    ProviderBillViewSet,
)

router = DefaultRouter()

# ISP hardware purchase flow
router.register(r'vendors', VendorViewSet, basename='vendor')
router.register(r'requisitions', PurchaseRequisitionViewSet, basename='requisition')
router.register(r'orders', PurchaseOrderViewSet, basename='purchase-order')
router.register(r'bills', PurchaseBillViewSet, basename='purchase-bill')

# Bandwidth provider bill flow (পূর্বের routes অটুট রাখা হলো)
router.register(r'providers', ProviderViewSet, basename='provider')
router.register(r'provider-bills', ProviderBillViewSet, basename='provider-bill')

urlpatterns = [path('', include(router.urls))]
