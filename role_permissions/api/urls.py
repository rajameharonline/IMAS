# role_permissions/api/urls.py
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from role_permissions.api.views import RoleGroupViewSet, AppUserViewSet, MyPermissionsView

router = DefaultRouter()
router.register(r'roles',      RoleGroupViewSet, basename='role-group')
router.register(r'app-users',  AppUserViewSet,   basename='app-user')
router.register(r'my-perms',   MyPermissionsView, basename='my-permissions')

urlpatterns = [
    path('', include(router.urls)),
]
