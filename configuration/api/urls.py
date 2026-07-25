from django.urls import path, include
from rest_framework.routers import DefaultRouter
from configuration.api.views import (
    ZoneViewSet, SubZoneViewSet, BoxViewSet,
    ClientTypeViewSet, ProtocolTypeViewSet, PackageViewSet,
    DistrictViewSet, UpazilaViewSet,
)

router = DefaultRouter()
router.register(r'zones', ZoneViewSet)
router.register(r'subzones', SubZoneViewSet)
router.register(r'boxes', BoxViewSet)
router.register(r'client-types', ClientTypeViewSet)
router.register(r'protocol-types', ProtocolTypeViewSet)
router.register(r'packages', PackageViewSet)
router.register(r'districts', DistrictViewSet)
router.register(r'upazilas', UpazilaViewSet)

urlpatterns = [path('', include(router.urls))]
