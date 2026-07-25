# Mobile API URL routes
from django.urls import path
from mobile_api.api.views import (
    AppTokenRefreshView,
    AppLogoutView,
    AppPaymentGatewayListView,
    AppReportPaymentView,
    AppPaymentHistoryView,
    AppSmsHistoryView,
    AppNotificationHistoryView,
    AppLoginView,
    AppStaffProfileView,
    AppStaffDashboardView,
    AppStaffCollectionReportView,
    AppStaffClientListView,
    AppStaffClientDetailView,
    AppStaffPendingPaymentsView,
    AppStaffBillsView,
    AppStaffHRView,
    AppStaffFCMTokenView,
    AppPOPProfileView,
    AppStaffSipCredentialsView,
    AppRegisterCheckView,
    AppRegisterView,
    BkashInitiateView,
    BkashCallbackView,
    ClientProfileView,
    AppSipCredentialsView,
    FCMTokenUpdateView,
    AppBillListView,
    AppCurrentBillView,
    AppTicketListCreateView,
    AppTicketDetailView,
    AppAIChatView,
    AppBannerListView,
    AppConfigView,
    AppLiveTrafficView,
    SendPushNotificationView,
    PushNotificationLogListView,
    app_apk_download,
    livetv_apk_download,
    AppPackageListView,
    AppPackageUpgradeInitiateView,
    AppPackageDowngradeView,
    AppLiveTVChannelsView,
    AppLiveTVStreamProxyView,
)

urlpatterns = [
    # ─── Authentication ───────────────────────────────────────
    path('auth/login/',            AppLoginView.as_view(),         name='app-login'),
    path('auth/register/check/',   AppRegisterCheckView.as_view(), name='app-register-check'),
    path('auth/register/',         AppRegisterView.as_view(),      name='app-register'),
    path('auth/refresh/',     AppTokenRefreshView.as_view(), name='app-token-refresh'),
    path('auth/logout/',      AppLogoutView.as_view(),     name='app-logout'),

    # ─── Staff/Admin Self-Service ─────────────────────────────
    path('staff/me/',         AppStaffProfileView.as_view(), name='app-staff-profile'),
    path('staff/dashboard/',  AppStaffDashboardView.as_view(), name='app-staff-dashboard'),
    path('staff/reports/daily-collection/', AppStaffCollectionReportView.as_view(), name='app-staff-collection'),
    path('staff/clients/',        AppStaffClientListView.as_view(),   name='app-staff-clients'),
    path('staff/clients/<int:pk>/', AppStaffClientDetailView.as_view(), name='app-staff-client-detail'),
    path('staff/pending-payments/', AppStaffPendingPaymentsView.as_view(), name='app-staff-pending-payments'),
    path('staff/bills/',      AppStaffBillsView.as_view(), name='app-staff-bills'),
    path('staff/hr/me/',      AppStaffHRView.as_view(),    name='app-staff-hr'),
    path('staff/fcm-token/',  AppStaffFCMTokenView.as_view(), name='app-staff-fcm'),
    path('staff/voip/sip-credentials/', AppStaffSipCredentialsView.as_view(), name='app-staff-sip'),

    # ─── POP Reseller Self-Service ────────────────────────────
    path('pop/me/',           AppPOPProfileView.as_view(),   name='app-pop-profile'),

    # ─── Client Self-Service ──────────────────────────────────
    path('me/',               ClientProfileView.as_view(),   name='app-profile'),
    path('me/fcm-token/',     FCMTokenUpdateView.as_view(),  name='app-fcm-token'),
    path('me/traffic/',       AppLiveTrafficView.as_view(),  name='app-traffic'),
    path('voip/sip-credentials/', AppSipCredentialsView.as_view(), name='app-sip-credentials'),
    path('me/sms/',           AppSmsHistoryView.as_view(),   name='app-sms-history'),
    path('me/notifications/', AppNotificationHistoryView.as_view(), name='app-notifications'),

    # ─── bKash Tokenized Checkout ─────────────────────────────
    path('payments/bkash/initiate/',  BkashInitiateView.as_view(),  name='app-bkash-initiate'),
    path('payments/bkash/callback/',  BkashCallbackView.as_view(),  name='app-bkash-callback'),

    # ─── Billing & Payments ───────────────────────────────────
    path('bills/',               AppBillListView.as_view(),          name='app-bills'),
    path('bills/current/',       AppCurrentBillView.as_view(),       name='app-current-bill'),
    path('payments/',            AppPaymentHistoryView.as_view(),     name='app-payments'),
    path('payments/report/',     AppReportPaymentView.as_view(),      name='app-report-payment'),
    path('payment-gateways/',    AppPaymentGatewayListView.as_view(), name='app-payment-gateways'),

    # ─── Support Tickets ──────────────────────────────────────
    path('tickets/',          AppTicketListCreateView.as_view(), name='app-tickets'),
    path('tickets/<int:pk>/', AppTicketDetailView.as_view(),     name='app-ticket-detail'),
    path('ai/chat/',          AppAIChatView.as_view(),           name='app-ai-chat'),

    # ─── Public ───────────────────────────────────────────────
    path('apk-download/',          app_apk_download,         name='app-apk-download'),
    path('livetv-apk-download/',   livetv_apk_download,      name='livetv-apk-download'),
    path('banners/',          AppBannerListView.as_view(),   name='app-banners'),
    path('config/',           AppConfigView.as_view(),       name='app-config'),

    # ─── Package Self-Service ─────────────────────────────────
    path('packages/',                    AppPackageListView.as_view(),             name='app-packages'),
    path('packages/upgrade/initiate/',   AppPackageUpgradeInitiateView.as_view(), name='app-package-upgrade-initiate'),
    path('packages/downgrade/',          AppPackageDowngradeView.as_view(),        name='app-package-downgrade'),

    # ─── Admin Operations ─────────────────────────────────────
    path('admin/push/send/',    SendPushNotificationView.as_view(),   name='app-push-send'),
    path('admin/push/history/', PushNotificationLogListView.as_view(), name='app-push-history'),

    # ─── Live TV ───────────────────────────────────────────────
    path('livetv/channels/', AppLiveTVChannelsView.as_view(), name='app-livetv-channels'),
    # index.m3u8 suffix variant — expo-video (ExoPlayer/AVPlayer) URL extension
    # দেখে HLS detect করে; extension ছাড়া manifest হলে player format চিনতে পারে না
    # → "Stream Unavailable"। দুটো route-ই একই view, suffix শুধু decoration (view উপেক্ষা করে)।
    path('livetv/stream/<int:channel_id>/index.m3u8', AppLiveTVStreamProxyView.as_view(), name='app-livetv-stream-m3u8'),
    path('livetv/stream/<int:channel_id>/', AppLiveTVStreamProxyView.as_view(), name='app-livetv-stream'),
]
