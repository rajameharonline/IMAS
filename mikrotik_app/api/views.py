# এই ফাইলটি Mikrotik server API views — CRUD, RADIUS auto-config, live traffic, backup, import।
from rest_framework import viewsets, permissions
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from django.utils import timezone
from mikrotik_app.models import MikrotikServer, RouterBackup, ImportedClient
from mikrotik_app.api.serializers import (
    MikrotikServerSerializer, MikrotikServerCreateSerializer,
    MikrotikServerUpdateSerializer, RouterBackupSerializer, ImportedClientSerializer
)


def _get_routable_ip():
    """Server-এর actual routable IP পাই — loopback (127.x) ব্যবহার এড়াতে।"""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None


def _push_radius_to_router(server, radius_server):
    """Router-এ RADIUS config push করে এবং nas table-এ এন্ট্রি যোগ করে।"""
    import subprocess
    from mikrotik_app.services.mikrotik_service import MikrotikService
    from radius_app.services.radius_service import RadiusService

    # RouterOS-এর /radius address-এ শুধু IP গ্রহণযোগ্য — hostname (localhost) বা
    # loopback (127.x) হলে real routable IP দিয়ে প্রতিস্থাপন করো।
    import ipaddress

    def _is_usable_ip(value):
        if not value:
            return False
        try:
            ip = ipaddress.ip_address(value)
        except ValueError:
            # 'localhost'-এর মতো hostname — IP নয়, তাই ব্যবহারযোগ্য নয়
            return False
        return not ip.is_loopback

    radius_host = radius_server.radius_host
    if not _is_usable_ip(radius_host):
        routable = _get_routable_ip()
        if routable:
            radius_host = routable
            radius_server.radius_host = routable
            radius_server.save(update_fields=['radius_host'])

    # ১. Mikrotik Router-এ RADIUS client config push করা
    service = MikrotikService.from_server_model(server)
    result = service.configure_radius(
        radius_host=radius_host,
        shared_secret=radius_server.shared_secret,
        auth_port=radius_server.radius_auth_port,
        acct_port=radius_server.radius_acct_port,
    )

    # ২. nas table-এ Mikrotik-এর IP এন্ট্রি যোগ করা — CoA/disconnect ও accounting-এর জন্য
    RadiusService.for_server(radius_server).add_nas(
        nas_ip=server.host,
        shared_secret=radius_server.shared_secret,
        shortname=server.name,
        description=f"Mikrotik Router: {server.name}",
    )

    # ৩. FreeRADIUS reload — নতুন NAS entry load করতে (না করলে router-এর auth
    #    packet নীরবে drop হয় → radius timeout)। ফলাফল result-এ যোগ করা হয়
    #    যাতে UI-তে reload ব্যর্থ হলে admin জানতে পারে।
    reload_res = RadiusService.reload_freeradius()
    if not reload_res.get('success'):
        result['freeradius_reload'] = reload_res.get('error')

    server.radius_server = radius_server
    server.radius_configured = True
    server.radius_configured_at = timezone.now()
    server.save(update_fields=['radius_server', 'radius_configured', 'radius_configured_at'])
    return result


# ── PPPoE secret → Bulk Import row helpers (pppoe_secrets action-এ ব্যবহৃত) ──
_MT_MON = {'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
           'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12}


def _mt_ymd(v):
    """যেকোনো তারিখ → YYYY-MM-DD ("Jul 10 2026 01:00:52 +0600" / "2026-06-10")। না মিললে ''।"""
    import re as _re
    s = str(v or '').strip()
    m = _re.search(r'(\d{4})-(\d{2})-(\d{2})', s)
    if m:
        return f'{m.group(1)}-{m.group(2)}-{m.group(3)}'
    m = _re.search(r'([A-Za-z]{3,}+)\s++(\d{1,2}+)\s++(\d{4})', s)
    if m and m.group(1)[:3].lower() in _MT_MON:
        return f'{m.group(3)}-{_MT_MON[m.group(1)[:3].lower()]:02d}-{int(m.group(2)):02d}'
    return ''


def _mt_kv_split(text, sep, kv):
    """text-কে sep দিয়ে ভেঙে প্রতিটি part-এ kv থাকলে key→value dict (key lower)।"""
    out = {}
    for part in text.split(sep):
        if kv in part:
            k, v = part.split(kv, 1)
            out[k.strip().lower()] = v.strip()
    return out


def _mt_parse_comment(c):
    """secret comment parse — দুই format: "Key: Value | ..." অথবা "key--value,..."।"""
    c = (c or '').strip()
    if '|' in c and ':' in c:
        return _mt_kv_split(c, '|', ':')
    if '--' in c:
        return _mt_kv_split(c, ',', '--')
    return {}


def _mt_secret_bstatus(cmap, disabled):
    """B.Status — comment status আগে (billing intent), নইলে MikroTik disabled flag।"""
    st = (cmap.get('status') or '').lower()
    if st == 'active':
        return 'Active'
    if st in ('suspended', 'inactive', 'disabled', 'expired'):
        return 'Inactive'
    return 'Inactive' if disabled else 'Active'


def _mt_field(cmap, *keys):
    """cmap থেকে প্রথম non-empty key-এর value (কোনোটাই না থাকলে '')।"""
    for k in keys:
        v = cmap.get(k)
        if v:
            return v
    return ''


def _mt_bill_day(join, exp):
    """Bill.Date = joining দিন, নইলে expiry দিন; কোনোটাই না থাকলে ''।"""
    src = join or exp
    return str(int(src[8:10])) if src else ''


def _mt_secret_to_row(s, existing):
    """একটি /ppp/secret entry → Bulk Import row dict। username না থাকলে None।"""
    uname = (s.get('name') or '').strip()
    if not uname:
        return None
    disabled = str(s.get('disabled', 'false')).lower() in ('true', 'yes')
    m = _mt_parse_comment(s.get('comment') or '')
    zraw = _mt_field(m, 'zone name')
    zone = zraw.split('•')[0].split('|')[0].strip() if zraw else ''
    exp  = _mt_ymd(_mt_field(m, 'bill expiry date', 'exp_date', 'expiry'))
    join = _mt_ymd(_mt_field(m, 'joining date', 'joindate'))
    digits = ''.join(ch for ch in uname if ch.isdigit())
    return {
        'Customer ID': digits[-4:] if len(digits) >= 4 else digits,
        'Name':        _mt_field(m, 'client name', 'name') or uname,
        'Mobile':      _mt_field(m, 'mobile number', 'mobile'),
        'Email':       '',
        'Zone':        zone,
        'Protocol':    'PPPoE',
        'Package':     _mt_field(m, 'package name', 'package'),
        'Profile':     (s.get('profile') or '').strip(),
        'UserName':    uname,
        'Password':    (s.get('password') or '').strip(),
        'B.Status':    _mt_secret_bstatus(m, disabled),
        'Exp.Date':    exp,
        'Bill.Date':   _mt_bill_day(join, exp),
        'M.Bill':      _mt_field(m, 'monthly bill', 'bill'),
        '_joining':    join,
        '_ip':         (s.get('remote-address') or '').strip(),
        '_exists':     uname in existing,
    }


class MikrotikServerViewSet(viewsets.ModelViewSet):
    # Mikrotik router সার্ভার — যোগ, সম্পাদনা, মুছে ফেলা ও পরীক্ষা করার API
    queryset = MikrotikServer.objects.select_related('radius_server').order_by('-created_at')
    permission_classes = [permissions.IsAuthenticated]
    search_fields = ['name', 'host']
    filterset_fields = ['is_active', 'radius_configured']

    def get_serializer_class(self):
        if self.action == 'create':
            return MikrotikServerCreateSerializer
        if self.action in ['update', 'partial_update']:
            return MikrotikServerUpdateSerializer
        return MikrotikServerSerializer

    def create(self, request, *args, **kwargs):
        # সার্ভার সংরক্ষণের পর default RADIUS সার্ভারে auto-configure করে
        response = super().create(request, *args, **kwargs)
        server_id = response.data.get('id')
        radius_result = {'configured': False, 'message': 'কোনো default RADIUS সার্ভার নেই।'}
        if server_id:
            try:
                from radius_app.models import RadiusServer
                radius_server = RadiusServer.objects.filter(is_default=True, is_active=True).first() \
                    or RadiusServer.objects.filter(is_active=True).first()
                if radius_server:
                    server = MikrotikServer.objects.get(id=server_id)
                    result = _push_radius_to_router(server, radius_server)
                    radius_result = {'configured': True, 'message': result['message'], 'radius_server': radius_server.name}
            except Exception as e:
                radius_result = {'configured': False, 'message': f'RADIUS config ব্যর্থ: {str(e)}'}
        response.data['radius_auto_config'] = radius_result
        return response

    def perform_destroy(self, instance):
        """Mikrotik router delete করার আগে সম্পূর্ণ cleanup।"""
        import subprocess
        from radius_app.services.radius_service import RadiusService
        import logging
        _log = logging.getLogger(__name__)

        # ১. Actual Mikrotik router থেকে RADIUS config মুছে দেওয়া (best-effort)
        if instance.radius_configured and instance.radius_server:
            try:
                from mikrotik_app.services.mikrotik_service import MikrotikService
                radius_host = instance.radius_server.radius_host
                svc = MikrotikService.from_server_model(instance)
                svc.remove_radius_config(radius_host=radius_host)
                _log.info("Router RADIUS config removed: %s (RADIUS: %s)", instance.host, radius_host)
            except Exception as e:
                # Router offline থাকলেও delete continue করবে
                _log.warning("Mikrotik delete: router RADIUS removal failed (may be offline) %s: %s", instance.host, e)

        # ২. RADIUS nas table থেকে এই router-এর IP entry মুছে দেওয়া
        try:
            if instance.radius_server:
                RadiusService.for_server(instance.radius_server).remove_nas(instance.host)
            else:
                RadiusService.get_default().remove_nas(instance.host)
            _log.info("NAS entry removed from RADIUS for router: %s", instance.host)
        except Exception as e:
            _log.warning("Mikrotik delete: NAS cleanup failed for %s: %s", instance.host, e)

        # ৩. FreeRADIUS reload — NAS entry পরিবর্তন কার্যকর করতে
        RadiusService.reload_freeradius()

        instance.delete()

    @action(detail=True, methods=['post'], url_path='configure-radius')
    def configure_radius(self, request, pk=None):
        # Router-এ RADIUS config manual ভাবে push করে (নির্দিষ্ট বা default RADIUS সার্ভার)
        server = self.get_object()
        try:
            from radius_app.models import RadiusServer
            radius_id = request.data.get('radius_server_id')
            if radius_id:
                radius_server = RadiusServer.objects.get(id=radius_id, is_active=True)
            else:
                radius_server = RadiusServer.objects.filter(is_default=True, is_active=True).first() \
                    or RadiusServer.objects.filter(is_active=True).first()
            if not radius_server:
                return Response({'success': False, 'error': 'কোনো active RADIUS সার্ভার পাওয়া যায়নি।'}, status=400)
            result = _push_radius_to_router(server, radius_server)
            return Response({'success': True, 'message': result['message'], 'radius_server': radius_server.name})
        except Exception as e:
            server.radius_configured = False
            server.save(update_fields=['radius_configured'])
            return Response({'success': False, 'error': f'RADIUS config ব্যর্থ: {str(e)}'}, status=400)

    @action(detail=True, methods=['post'], url_path='test-connection')
    def test_connection(self, request, pk=None):
        # Mikrotik Router-এর সাথে সংযোগ পরীক্ষা করে। সফল হলে system resource দেখায়।
        server = self.get_object()
        try:
            from mikrotik_app.services.mikrotik_service import MikrotikService
            service = MikrotikService.from_server_model(server)
            info = service.get_system_resource()
            server.last_connected = timezone.now()
            server.save(update_fields=['last_connected'])
            return Response({'success': True, 'message': f"সংযোগ সফল! Router: {server.host}", 'system_info': info})
        except Exception as e:
            return Response({'success': False, 'message': f"সংযোগ ব্যর্থ: {str(e)}"}, status=400)

    @action(detail=True, methods=['get'], url_path='live-traffic')
    def live_traffic(self, request, pk=None):
        # Mikrotik Router-এর live traffic তথ্য আনে
        server = self.get_object()
        try:
            from mikrotik_app.services.mikrotik_service import MikrotikService
            service = MikrotikService.from_server_model(server)
            interface = request.query_params.get('interface', 'ether1')
            traffic = service.get_interface_traffic(interface)
            return Response(traffic)
        except Exception as e:
            return Response({'error': str(e)}, status=400)

    @action(detail=True, methods=['get'], url_path='active-connections')
    def active_connections(self, request, pk=None):
        # Mikrotik Router-এর সব active PPPoE connection তালিকা
        server = self.get_object()
        try:
            from mikrotik_app.services.mikrotik_service import MikrotikService
            service = MikrotikService.from_server_model(server)
            connections = service.get_active_connections()
            return Response({'count': len(connections), 'connections': connections})
        except Exception as e:
            return Response({'error': str(e)}, status=400)

    @action(detail=True, methods=['get'], url_path='check-username')
    def check_username(self, request, pk=None):
        # Mikrotik /ppp/secret-এ username পাওয়া যাচ্ছে কিনা চেক করে
        server = self.get_object()
        username = request.query_params.get('username', '').strip()
        if not username:
            return Response({'error': 'username প্রয়োজন'}, status=400)
        try:
            from mikrotik_app.services.mikrotik_service import MikrotikService
            service = MikrotikService.from_server_model(server)
            exists = service.check_user_exists(username)
            return Response({'exists': exists, 'username': username})
        except Exception as e:
            return Response({'error': str(e)}, status=400)

    @action(detail=True, methods=['get'], url_path='pppoe-profiles')
    def pppoe_profiles(self, request, pk=None):
        # Mikrotik Router থেকে PPPoE profile তালিকা আনে — Package form dropdown-এর জন্য
        server = self.get_object()
        try:
            from mikrotik_app.services.mikrotik_service import MikrotikService
            service = MikrotikService.from_server_model(server)
            profiles = service.get_pppoe_profiles()
            return Response({'profiles': profiles})
        except Exception as e:
            return Response({'error': str(e)}, status=400)

    @action(detail=True, methods=['get'], url_path='pppoe-secrets')
    def pppoe_secrets(self, request, pk=None):
        # Mikrotik Router-এর PPPoE secret তালিকা → Bulk Import row format-এ map করে।
        # যেগুলো ইতিমধ্যে এই DB-তে আছে (username) সেগুলো 'exists' চিহ্নিত করা হয়।
        # প্রতি-secret mapping/parsing module-level helper-এ (_mt_secret_to_row ইত্যাদি)।
        server = self.get_object()
        try:
            from mikrotik_app.services.mikrotik_service import MikrotikService
            from clients.models import Client
            service = MikrotikService.from_server_model(server)
            secrets = service.get_pppoe_users()  # raw /ppp/secret list

            existing = set(Client.objects.values_list('username', flat=True))
            rows = []
            for s in secrets:
                row = _mt_secret_to_row(s, existing)
                if row is not None:
                    rows.append(row)
            return Response({'rows': rows, 'total': len(rows),
                             'already_imported': sum(1 for r in rows if r['_exists'])})
        except Exception as e:
            return Response({'error': str(e)}, status=400)

    @action(detail=True, methods=['get'], url_path='ip-pools')
    def ip_pools(self, request, pk=None):
        # Mikrotik Router-এর IP Pool তালিকা আনে
        server = self.get_object()
        try:
            from mikrotik_app.services.mikrotik_service import MikrotikService
            service = MikrotikService.from_server_model(server)
            pools = service.get_ip_pools()
            return Response({'pools': pools})
        except Exception as e:
            return Response({'error': str(e)}, status=400)

    @action(detail=True, methods=['post'], url_path='create-ip-pool')
    def create_ip_pool(self, request, pk=None):
        # Mikrotik Router-এ নতুন IP Pool তৈরি করে (যেমন 192.168.10.0/24)
        server = self.get_object()
        pool_name = request.data.get('pool_name', '').strip()
        network = request.data.get('network', '').strip()
        next_pool = request.data.get('next_pool', '').strip()
        if not pool_name or not network:
            return Response({'error': 'pool_name এবং network (CIDR) আবশ্যক।'}, status=400)
        try:
            from mikrotik_app.services.mikrotik_service import MikrotikService
            service = MikrotikService.from_server_model(server)
            result = service.create_ip_pool(pool_name, network, next_pool)
            return Response({'success': True, **result})
        except Exception as e:
            return Response({'success': False, 'error': str(e)}, status=400)

    @action(detail=True, methods=['post'], url_path='sync-to-radius')
    def sync_to_radius(self, request, pk=None):
        # Mikrotik-এর সব PPPoE user RADIUS radcheck-এ sync করে — one-time migration-এর জন্য
        server = self.get_object()
        try:
            import psycopg
            from django.conf import settings
            from mikrotik_app.services.mikrotik_service import MikrotikService

            service = MikrotikService.from_server_model(server)
            users = service.get_pppoe_users()

            db = settings.RADIUS_DB
            conn = psycopg.connect(host=db['host'], port=db.get('port', 5432),
                                     user=db['user'], password=db['password'], dbname=db['name'])
            cursor = conn.cursor()

            added = updated = 0
            for u in users:
                username = u.get('name', '').strip()
                password = u.get('password', '').strip()
                if not username or not password:
                    continue
                cursor.execute(
                    "SELECT id FROM radcheck WHERE username=%s AND attribute='Cleartext-Password'",
                    (username,)
                )
                if cursor.fetchone():
                    cursor.execute(
                        "UPDATE radcheck SET value=%s WHERE username=%s AND attribute='Cleartext-Password'",
                        (password, username)
                    )
                    updated += 1
                else:
                    cursor.execute(
                        "INSERT INTO radcheck (username, attribute, op, value) VALUES (%s, 'Cleartext-Password', ':=', %s)",
                        (username, password)
                    )
                    added += 1

            conn.commit()
            conn.close()

            return Response({
                'success': True,
                'message': f'{added} জন নতুন user RADIUS-এ যোগ হয়েছে, {updated} জন update হয়েছে।',
                'added': added,
                'updated': updated,
                'total': len(users),
            })
        except Exception as e:
            return Response({'success': False, 'error': str(e)}, status=400)

    @action(detail=True, methods=['post'], url_path='disconnect-all-sessions')
    def disconnect_all_sessions(self, request, pk=None):
        # সব active PPPoE session force disconnect করে — পরবর্তী reconnect RADIUS দিয়ে auth হবে
        server = self.get_object()
        try:
            from mikrotik_app.services.mikrotik_service import MikrotikService
            service = MikrotikService.from_server_model(server)
            result = service.disconnect_all_active_sessions()
            return Response({
                'success': True,
                'message': f"{result['disconnected']} টি সংযোগ বিচ্ছিন্ন করা হয়েছে। সবাই পুনরায় RADIUS দিয়ে সংযুক্ত হবে।",
                'disconnected': result['disconnected'],
                'total': result['total'],
            })
        except Exception as e:
            return Response({'success': False, 'error': str(e)}, status=400)

    @action(detail=True, methods=['post'], url_path='create-backup')
    def create_backup(self, request, pk=None):
        # Mikrotik Router-এর manual backup তৈরি করে
        server = self.get_object()
        try:
            from mikrotik_app.services.mikrotik_service import MikrotikService
            service = MikrotikService.from_server_model(server)
            backup_name = service.create_backup()
            if backup_name:
                backup = RouterBackup.objects.create(
                    server=server, filename=backup_name,
                    backup_type='manual', created_by=request.user,
                )
                server.last_connected = timezone.now()
                server.save(update_fields=['last_connected'])
                return Response({
                    'success': True,
                    'message': f'Backup তৈরি হয়েছে: {backup_name}',
                    'backup': RouterBackupSerializer(backup).data,
                })
            return Response({'success': False, 'error': 'Router থেকে backup তৈরি করতে ব্যর্থ।'}, status=400)
        except Exception as e:
            return Response({'success': False, 'error': str(e)}, status=400)

    @action(detail=True, methods=['post'], url_path='import-users')
    def import_users(self, request, pk=None):
        # Mikrotik থেকে সব PPPoE user import করে — ImportedClient table-এ সংরক্ষণ হয়
        server = self.get_object()
        try:
            from mikrotik_app.services.mikrotik_service import MikrotikService
            service = MikrotikService.from_server_model(server)
            users = service.get_pppoe_users()
            new_count = 0
            existing_count = 0
            for user in users:
                _, created = ImportedClient.objects.get_or_create(
                    server=server,
                    username=user.get('name', ''),
                    defaults={
                        'service': user.get('service', 'pppoe'),
                        'profile': user.get('profile', ''),
                        'comment': user.get('comment', ''),
                        'raw_data': user,
                    }
                )
                if created:
                    new_count += 1
                else:
                    existing_count += 1
            return Response({
                'success': True,
                'message': f'{new_count} জন নতুন user import হয়েছে।',
                'new': new_count,
                'existing': existing_count,
                'total': len(users),
            })
        except Exception as e:
            return Response({'success': False, 'error': str(e)}, status=400)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def fetch_router_info(request):
    # সংরক্ষণের আগে router-এ সংযোগ করে নাম, model ও version যাচাই করে
    host = request.data.get('host', '').strip()
    port = int(request.data.get('port', 8728))
    username = request.data.get('username', '').strip()
    password = request.data.get('password', '')
    if not all([host, username, password]):
        return Response({'error': 'host, username এবং password আবশ্যক।'}, status=400)
    try:
        from mikrotik_app.services.mikrotik_service import MikrotikService
        service = MikrotikService(host=host, username=username, password=password, port=port)
        info = service.get_identity()
        return Response({'success': True, 'info': info})
    except Exception as e:
        return Response({'success': False, 'error': f"সংযোগ ব্যর্থ: {str(e)}"}, status=400)


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def all_online_usernames(request):
    # সব active Mikrotik server-এর /ppp/active থেকে online username তালিকা
    from mikrotik_app.services.mikrotik_service import MikrotikService
    servers = MikrotikServer.objects.filter(is_active=True)
    seen = set()
    for server in servers:
        try:
            connections = MikrotikService.from_server_model(server).get_active_connections()
            for c in connections:
                name = c.get('name') or c.get('user') or c.get('username', '')
                if name:
                    seen.add(name)
        except Exception:
            pass
    return Response({'usernames': list(seen), 'count': len(seen)})


def _do_server_ping(ip: str, count: int = 4) -> dict:
    """Django server থেকে subprocess ping চালায়।"""
    import subprocess
    import re
    try:
        res = subprocess.run(
            ['ping', '-c', str(count), '-W', '2', '-i', '0.3', ip],
            capture_output=True, text=True, timeout=15,
        )
        out = res.stdout
        stats = re.search(r'(\d++) packets transmitted, (\d++) received', out)
        rtt = re.search(r'rtt .* = ([\d.]+)/([\d.]+)/([\d.]+)', out)
        sent = int(stats.group(1)) if stats else count
        recv = int(stats.group(2)) if stats else 0
        return {
            'success': recv > 0,
            'sent': sent,
            'received': recv,
            'loss': round((sent - recv) / sent * 100) if sent else 100,
            'min': float(rtt.group(1)) if rtt else None,
            'avg': float(rtt.group(2)) if rtt else None,
            'max': float(rtt.group(3)) if rtt else None,
        }
    except subprocess.TimeoutExpired:
        return {'success': False, 'error': 'Timeout', 'sent': count, 'received': 0, 'loss': 100}
    except Exception as e:
        return {'success': False, 'error': str(e), 'sent': count, 'received': 0, 'loss': 100}


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def ping_client(request):
    """Server-side ping + Mikrotik router ping — উভয় দিক থেকে client-এর reachability।"""
    from mikrotik_app.services.mikrotik_service import MikrotikService as MtSvc
    ip = request.data.get('ip', '').strip()
    username = request.data.get('username', '').strip()
    if not ip or ip == '-':
        return Response({'error': 'Valid IP required'}, status=400)

    server_result = _do_server_ping(ip)

    # Mikrotik router reachability (server → router)
    router_ping = None
    mikrotik_check = None
    mikrotik_server_name = None
    for server in MikrotikServer.objects.filter(is_active=True):
        try:
            router_ping = _do_server_ping(server.host, count=4)
        except Exception:
            pass
        try:
            svc = MtSvc.from_server_model(server)
            mikrotik_check = svc.check_client_connectivity(ip)
            mikrotik_server_name = server.name
        except Exception:
            pass
        break

    return Response({
        'ip': ip,
        'username': username,
        'server_ping': server_result,
        'router_ping': router_ping,
        'mikrotik_check': mikrotik_check,
        'mikrotik_server': mikrotik_server_name,
    })


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def client_traffic(request, username):
    """Mikrotik /ppp/active থেকে specific user-এর real-time traffic data।
    client-এর router_id দিয়ে সঠিক server-এ সরাসরি query করে (fast path)।
    না পেলে সব active server-এ চেষ্টা করে (fallback)।
    """
    from mikrotik_app.services.mikrotik_service import MikrotikService as MtSvc
    import logging
    logger = logging.getLogger(__name__)

    # Fast path: client-এর router থেকে correct server সরাসরি বের করা
    preferred_server = None
    try:
        from clients.models import Client
        client = Client.objects.select_related('router').filter(username=username).first()
        if client and client.router_id:
            preferred_server = MikrotikServer.objects.filter(
                id=client.router_id, is_active=True
            ).first()
    except Exception:
        pass

    servers = []
    if preferred_server:
        # preferred server আগে check করি
        servers = [preferred_server] + list(
            MikrotikServer.objects.filter(is_active=True).exclude(id=preferred_server.id)
        )
    else:
        servers = list(MikrotikServer.objects.filter(is_active=True))

    for server in servers:
        try:
            svc = MtSvc.from_server_model(server)
            data = svc.get_user_traffic(username)
            if data:
                return Response({
                    'online': True,
                    'server_name': server.name,
                    'server_id': server.id,
                    **data
                })
        except Exception as e:
            # user-controlled মান log injection (CWE-117) রোধে CR/LF সরাই
            safe_user = str(username).replace('\r', '').replace('\n', '')
            logger.warning("client_traffic: server %s error for %s: %s", server.name, safe_user, e)
            continue

    return Response({'online': False, 'username': username})


class RouterBackupViewSet(viewsets.ReadOnlyModelViewSet):
    # Router backup ইতিহাসের তালিকা
    queryset = RouterBackup.objects.select_related('server').order_by('-created_at')
    serializer_class = RouterBackupSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['server', 'backup_type']


class ImportedClientViewSet(viewsets.ReadOnlyModelViewSet):
    # Mikrotik থেকে import করা client-এর তালিকা
    queryset = ImportedClient.objects.select_related('server').order_by('-created_at')
    serializer_class = ImportedClientSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['server', 'is_imported']
    search_fields = ['username', 'profile', 'comment']
