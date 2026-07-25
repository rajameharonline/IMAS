from rest_framework.routers import DefaultRouter
from django.urls import path
from .views import (
    TVChannelViewSet, TVCategoryViewSet, LiveTVSubscriberViewSet,
    FTPContentAdminViewSet, FTPContentAppView,
    FTPVideoUploadView, FTPVideoDeleteUploadView,
    FTPThumbnailUploadView, FTPThumbnailDeleteView,
)
from . import auth_views

router = DefaultRouter()
router.register('channels',    TVChannelViewSet,          basename='livetv-channel')
router.register('categories',  TVCategoryViewSet,         basename='livetv-category')
router.register('subscribers', LiveTVSubscriberViewSet,   basename='livetv-subscriber')
router.register('ftp-content', FTPContentAdminViewSet,    basename='livetv-ftp-content')

# ⚠️ Custom path গুলো router.urls-এর আগে রাখতে হবে।
# router `ftp-content/{pk}/` pattern সব path ধরে ফেলে —
# তাই upload-video ও delete-upload আগে declare না করলে
# router সেগুলোকে pk='upload-video' ভেবে 405 দেয়।
urlpatterns = [
    # Live TV App Authentication
    path('app/auth/login/',       auth_views.LiveTVLoginView.as_view(),    name='livetv-app-login'),
    path('app/auth/register/',    auth_views.LiveTVRegisterView.as_view(), name='livetv-app-register'),
    path('app/auth/me/',          auth_views.LiveTVMeView.as_view(),       name='livetv-app-me'),
    # FTP Content (App)
    path('app/ftp-content/',      FTPContentAppView.as_view(),             name='livetv-app-ftp-content'),
    # Video/Thumbnail file upload (Admin) — router-এর আগে আসতে হবে
    path('ftp-content/upload-video/',      FTPVideoUploadView.as_view(),      name='livetv-ftp-upload'),
    path('ftp-content/delete-upload/',     FTPVideoDeleteUploadView.as_view(),name='livetv-ftp-delete-upload'),
    path('ftp-content/upload-thumbnail/',  FTPThumbnailUploadView.as_view(),  name='livetv-ftp-thumb-upload'),
    path('ftp-content/delete-thumbnail/',  FTPThumbnailDeleteView.as_view(),  name='livetv-ftp-thumb-delete'),
] + router.urls
