# VoIP module API URLs।
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from voip.api.views import (
    SipCredentialsView, CallOriginateView, RegisteredClientsView,
    CallLogViewSet, VoiceMessageViewSet, VoiceRecordingViewSet,
    VoiceCallScheduleViewSet,
    PBXAgentViewSet, RingGroupViewSet, IVRMenuViewSet,
    HotlineNumberViewSet, PBXDashboardView, PBXReloadDialplanView,
    ReprovisionAllEndpointsView,
)

router = DefaultRouter()
router.register(r'call-logs',        CallLogViewSet,        basename='call-log')
router.register(r'voice-messages',   VoiceMessageViewSet,   basename='voice-message')
router.register(r'voice-recordings', VoiceRecordingViewSet, basename='voice-recording')
router.register(r'voice-schedules',  VoiceCallScheduleViewSet, basename='voice-schedule')
router.register(r'pbx-agents',       PBXAgentViewSet,       basename='pbx-agent')
router.register(r'ring-groups',      RingGroupViewSet,      basename='ring-group')
router.register(r'ivr-menus',        IVRMenuViewSet,        basename='ivr-menu')
router.register(r'hotline-numbers',  HotlineNumberViewSet,  basename='hotline-number')

urlpatterns = [
    path('sip-credentials/',        SipCredentialsView.as_view(),      name='voip-sip-credentials'),
    path('call/originate/',         CallOriginateView.as_view(),       name='voip-call-originate'),
    path('registered-clients/',     RegisteredClientsView.as_view(),   name='voip-registered-clients'),
    path('pbx/dashboard-stats/',    PBXDashboardView.as_view(),        name='pbx-dashboard-stats'),
    path('pbx/reload-dialplan/',    PBXReloadDialplanView.as_view(),   name='pbx-reload-dialplan'),
    path('reprovision/',            ReprovisionAllEndpointsView.as_view(), name='voip-reprovision'),
    path('', include(router.urls)),
]
