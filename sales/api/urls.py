# Sales module API URLs — Product ও Service invoice flow।
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from sales.api.views import (
    ProductSalesInvoiceViewSet,
    ProductSalesPaymentViewSet,
    ServiceSalesInvoiceViewSet,
    ServiceSalesPaymentViewSet,
)

router = DefaultRouter()

# Product Sales
router.register(r'product-invoices',  ProductSalesInvoiceViewSet,  basename='product-invoice')
router.register(r'product-payments',  ProductSalesPaymentViewSet,  basename='product-payment')

# Service Sales
router.register(r'service-invoices',  ServiceSalesInvoiceViewSet,  basename='service-invoice')
router.register(r'service-payments',  ServiceSalesPaymentViewSet,  basename='service-payment')

urlpatterns = [path('', include(router.urls))]
