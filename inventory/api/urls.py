from django.urls import path, include
from rest_framework.routers import DefaultRouter
from inventory.api.views import (
    UnitViewSet, StoreLocationViewSet, ItemCategoryViewSet,
    ItemViewSet, StockViewSet, StockTransactionViewSet,
)

router = DefaultRouter()
router.register(r'units',             UnitViewSet,             basename='unit')
router.register(r'stores',            StoreLocationViewSet,    basename='store')
router.register(r'item-categories',   ItemCategoryViewSet,     basename='item-category')
router.register(r'items',             ItemViewSet,             basename='item')
router.register(r'stocks',            StockViewSet,            basename='stock')
router.register(r'stock-transactions', StockTransactionViewSet, basename='stock-transaction')

urlpatterns = [path('', include(router.urls))]
