# এই ফাইলটি configuration API views.
from rest_framework import viewsets, permissions
from configuration.models import Zone, SubZone, Box, ClientType, ProtocolType, Package, District, Upazila
from configuration.api.serializers import (
    ZoneSerializer, SubZoneSerializer, BoxSerializer,
    ClientTypeSerializer, ProtocolTypeSerializer, PackageSerializer,
    DistrictSerializer, UpazilaSerializer,
)


class ZoneViewSet(viewsets.ModelViewSet):
    queryset = Zone.objects.all()
    serializer_class = ZoneSerializer
    permission_classes = [permissions.IsAuthenticated]
    search_fields = ['name']
    filterset_fields = ['is_active']


class SubZoneViewSet(viewsets.ModelViewSet):
    queryset = SubZone.objects.select_related('zone').all()
    serializer_class = SubZoneSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['zone', 'is_active']


class BoxViewSet(viewsets.ModelViewSet):
    queryset = Box.objects.select_related('subzone', 'subzone__zone').all()
    serializer_class = BoxSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['subzone', 'is_active']


class ClientTypeViewSet(viewsets.ModelViewSet):
    queryset = ClientType.objects.all()
    serializer_class = ClientTypeSerializer
    permission_classes = [permissions.IsAuthenticated]


class ProtocolTypeViewSet(viewsets.ModelViewSet):
    queryset = ProtocolType.objects.all()
    serializer_class = ProtocolTypeSerializer
    permission_classes = [permissions.IsAuthenticated]

    def _sync_radius(self, proto):
        """PPPoE / Hotspot হলে RADIUS NAS type যাচাই করে log করে।"""
        import logging
        log = logging.getLogger(__name__)
        if proto.radius_enabled:
            log.info(
                "ProtocolType '%s' (mikrotik=%s) has RADIUS enabled.",
                proto.name, proto.mikrotik_interface_type,
            )
        else:
            log.info(
                "ProtocolType '%s' (mikrotik=%s) has RADIUS disabled.",
                proto.name, proto.mikrotik_interface_type,
            )

    def perform_create(self, serializer):
        proto = serializer.save()
        self._sync_radius(proto)

    # update-এ create-এর সাথে অভিন্ন আচরণ (S4144) — alias করে duplication এড়ানো
    perform_update = perform_create


class DistrictViewSet(viewsets.ModelViewSet):
    queryset = District.objects.all()
    serializer_class = DistrictSerializer
    permission_classes = [permissions.IsAuthenticated]
    search_fields = ['name']
    filterset_fields = ['is_active']


class UpazilaViewSet(viewsets.ModelViewSet):
    queryset = Upazila.objects.select_related('district').all()
    serializer_class = UpazilaSerializer
    permission_classes = [permissions.IsAuthenticated]
    search_fields = ['name']
    filterset_fields = ['district', 'is_active']


class PackageViewSet(viewsets.ModelViewSet):
    queryset = Package.objects.all()
    serializer_class = PackageSerializer
    permission_classes = [permissions.IsAuthenticated]
    search_fields = ['name']
    filterset_fields = ['is_active', 'billing_cycle']

    def _sync_radius(self, pkg):
        """Package-এর mikrotik_profile ও ip_pool_name অনুযায়ী RADIUS radgroupreply আপডেট করে।"""
        group = pkg.mikrotik_profile
        pool = pkg.ip_pool_name or group
        if not group:
            return
        try:
            from radius_app.services.radius_service import RadiusService
            RadiusService.sync_package_to_all_servers(
                group_name=group,
                attribute='Mikrotik-Group',
                op=':=',
                value=group,
                pool_name=pool,
            )
        except Exception as e:
            import logging
            logging.getLogger(__name__).exception("Package RADIUS sync error for %s: %s", group, e)

    def perform_create(self, serializer):
        pkg = serializer.save()
        self._sync_radius(pkg)
        pkg._radius_synced = True  # signal double-sync এড়াতে flag সেট

    # update-এ create-এর সাথে অভিন্ন আচরণ (S4144) — alias করে duplication এড়ানো
    perform_update = perform_create

    def destroy(self, request, *args, **kwargs):
        """Package delete করার আগে:
        1. Active client চেক — থাকলে block করা
        2. RADIUS radgroupreply থেকে package group cleanup
        """
        from rest_framework.response import Response
        import logging
        log = logging.getLogger(__name__)
        pkg = self.get_object()

        # ১. Active client চেক — এই package-এ assigned client থাকলে delete block
        active_clients = pkg.clients.filter(status__in=['active', 'inactive']).count()
        if active_clients > 0:
            return Response({
                'error': (
                    f'"{pkg.name}" প্যাকেজটি {active_clients}জন ক্লায়েন্টের সাথে সংযুক্ত। '
                    f'আগে ক্লায়েন্টদের অন্য প্যাকেজে স্থানান্তর করুন।'
                ),
                'active_clients': active_clients,
            }, status=400)

        # ২. RADIUS radgroupreply থেকে এই package-এর group entries মুছে দেওয়া
        group = pkg.mikrotik_profile
        if group:
            try:
                from radius_app.services.radius_service import RadiusService
                from radius_app.models import RadiusServer
                servers = list(RadiusServer.objects.filter(is_active=True))
                targets = [RadiusService.for_server(s) for s in servers] if servers else [RadiusService.get_default()]
                for svc in targets:
                    svc.delete_package_group(group)
                log.info("Package RADIUS group deleted: %s", group)
            except Exception as e:
                log.warning("Package delete RADIUS cleanup failed for %s: %s", group, e)

        return super().destroy(request, *args, **kwargs)
