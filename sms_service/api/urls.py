from django.urls import path, include
from rest_framework.routers import DefaultRouter
from sms_service.api.views import (SMSGatewayViewSet, SMSTemplateViewSet,
                                   SMSGroupViewSet, SMSLogViewSet, SendSMSViewSet)

router = DefaultRouter()
router.register(r'gateways', SMSGatewayViewSet)
router.register(r'templates', SMSTemplateViewSet)
router.register(r'groups', SMSGroupViewSet)
router.register(r'logs', SMSLogViewSet)
router.register(r'send', SendSMSViewSet, basename='send-sms')

urlpatterns = [path('', include(router.urls))]
