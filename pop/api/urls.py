# POP Management API URLs
from rest_framework.routers import DefaultRouter
from pop.api.views import (
    POPPackageViewSet, POPTariffViewSet, POPTariffItemViewSet,
    POPViewSet, POPFundViewSet,
    POPFundingViewSet, POPFundTransactionViewSet,
    ClientPGWPaymentViewSet, POPPGWSettlementViewSet, POPNoticeViewSet,
)

router = DefaultRouter()
router.register('packages',          POPPackageViewSet,         basename='pop-package')
router.register('tariffs',           POPTariffViewSet,          basename='pop-tariff')
router.register('tariff-items',      POPTariffItemViewSet,      basename='pop-tariff-item')
router.register('pops',              POPViewSet,                basename='pop')
router.register('funds',             POPFundViewSet,            basename='pop-fund')
router.register('fundings',          POPFundingViewSet,         basename='pop-funding')
router.register('fund-transactions', POPFundTransactionViewSet, basename='pop-fund-trans')
router.register('pgw-payments',      ClientPGWPaymentViewSet,   basename='pop-pgw')
router.register('pgw-settlements',   POPPGWSettlementViewSet,   basename='pop-pgw-settle')
router.register('notices',           POPNoticeViewSet,          basename='pop-notice')

urlpatterns = router.urls
