from django.urls import path, include
from rest_framework.routers import DefaultRouter
from billing.api.views import (
    BillViewSet, PaymentViewSet, InstallationFeeViewSet, DailyCollectionViewSet,
    WebhookPaymentViewSet, WebhookReceiveView, BkashSNSWebhookView,
    ReminderRuleViewSet, ReminderLogViewSet,
)

router = DefaultRouter()
router.register(r'bills',              BillViewSet,            basename='bill')
router.register(r'payments',          PaymentViewSet)
router.register(r'installation-fees', InstallationFeeViewSet)
router.register(r'daily-collections', DailyCollectionViewSet)
router.register(r'webhook-payments',  WebhookPaymentViewSet,  basename='webhook-payment')
router.register(r'webhook',           WebhookReceiveView,     basename='webhook-receive')
router.register(r'reminder-rules',    ReminderRuleViewSet,    basename='reminder-rule')
router.register(r'reminder-logs',     ReminderLogViewSet,     basename='reminder-log')

urlpatterns = [
    # bKash SNS — router-এর আগে রাখতে হবে, নইলে webhook/{pk}/ pattern ধরে ফেলে
    path('webhook/bkash-sns/', BkashSNSWebhookView.as_view(), name='bkash-sns-webhook'),
    path('', include(router.urls)),
]
