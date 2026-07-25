# এই ফাইলটি RADIUS সার্ভার CRUD ও test-connection, online users ও disconnect API।
from rest_framework import viewsets, permissions
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.response import Response
from django.utils import timezone
from radius_app.models import RadiusServer
from radius_app.api.serializers import (
    RadiusServerSerializer, RadiusServerCreateSerializer,
    RadiusServerUpdateSerializer,
)


class RadiusServerViewSet(viewsets.ModelViewSet):
    # FreeRADIUS সার্ভার — যোগ, সম্পাদনা, মুছে ফেলা ও পরীক্ষা করার API
    queryset = RadiusServer.objects.all().order_by('-created_at')
    permission_classes = [permissions.IsAuthenticated]
    search_fields = ['name', 'radius_host']
    filterset_fields = ['is_active', 'server_type']

    def _test_connection_and_ensure_schema(self, server):
        # DB-তে connect test করে last_test_status সেভ করে; সফল হলে radcheck/radreply/
        # radusergroup-এ unique key নিশ্চিত করে — নইলে ON CONFLICT DO UPDATE কাজ করবে
        # না, duplicate row bug ফিরে আসবে। create ও update — দুই path-এই কল হয় (edit করে
        # db_host/db_port/db_name বদলে সম্পূর্ণ ভিন্ন physical DB-তে re-point করা হতে পারে)।
        try:
            import psycopg
            conn = psycopg.connect(
                host=server.db_host, port=server.db_port,
                user=server.db_user, password=server.db_password,
                dbname=server.db_name, connect_timeout=5,
            )
            conn.close()
            server.last_test_status = 'ok'
        except Exception:
            server.last_test_status = 'failed'
        server.last_tested = timezone.now()
        server.save(update_fields=['last_tested', 'last_test_status'])

        if server.last_test_status == 'ok':
            from radius_app.services.radius_service import RadiusService
            RadiusService.for_server(server).ensure_unique_keys()

    def perform_create(self, serializer):
        server = serializer.save()
        self._test_connection_and_ensure_schema(server)

    def perform_update(self, serializer):
        server = serializer.save()
        self._test_connection_and_ensure_schema(server)

    def get_serializer_class(self):
        if self.action == 'create':
            return RadiusServerCreateSerializer
        if self.action in ['update', 'partial_update']:
            return RadiusServerUpdateSerializer
        return RadiusServerSerializer

    def destroy(self, request, *args, **kwargs):
        """RADIUS server delete করার আগে linked Mikrotik router চেক করে।"""
        server = self.get_object()

        # Linked Mikrotik router আছে কিনা চেক
        try:
            from mikrotik_app.models import MikrotikServer
            linked = MikrotikServer.objects.filter(radius_server=server, radius_configured=True)
            if linked.exists():
                names = ', '.join(linked.values_list('name', flat=True)[:5])
                more = f' এবং আরও {linked.count() - 5}টি' if linked.count() > 5 else ''
                return Response({
                    'error': (
                        f'এই RADIUS server-টি {linked.count()}টি Mikrotik router-এ configured আছে: '
                        f'{names}{more}। '
                        f'আগে router গুলো delete করুন অথবা অন্য RADIUS server-এ configure করুন।'
                    ),
                    'linked_routers': list(linked.values('id', 'name', 'host')),
                }, status=400)
        except Exception:
            pass  # mikrotik_app না থাকলে skip

        # RADIUS nas table-এ এই server-এর সব NAS entry মুছে দেওয়া
        try:
            from radius_app.services.radius_service import RadiusService
            svc = RadiusService.for_server(server)
            nas_list = svc.get_nas_list()
            for nas in nas_list:
                svc.remove_nas(nas['ip'])
        except Exception:
            pass

        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['post'], url_path='test-connection')
    def test_connection(self, request, pk=None):
        # RADIUS DB সংযোগ পরীক্ষা — সফল হলে DB version দেখায়
        server = self.get_object()
        try:
            import psycopg
            conn = psycopg.connect(
                host=server.db_host,
                port=server.db_port,
                user=server.db_user,
                password=server.db_password,
                dbname=server.db_name,
                connect_timeout=5,
            )
            with conn.cursor() as cur:
                cur.execute("SELECT VERSION()")
                version = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM radcheck")
                user_count = cur.fetchone()[0]
            conn.close()
            server.last_tested = timezone.now()
            server.last_test_status = 'ok'
            server.save(update_fields=['last_tested', 'last_test_status'])
            return Response({
                'success': True,
                'message': f"RADIUS DB সংযোগ সফল! Server: {server.radius_host}",
                'db_version': version,
                'radcheck_count': user_count,
            })
        except Exception as e:
            server.last_tested = timezone.now()
            server.last_test_status = 'failed'
            server.save(update_fields=['last_tested', 'last_test_status'])
            return Response({
                'success': False,
                'message': f"সংযোগ ব্যর্থ: {str(e)}",
            }, status=400)

    @action(detail=True, methods=['post'], url_path='set-default')
    def set_default(self, request, pk=None):
        # এই সার্ভারকে default হিসেবে সেট করে, বাকিদের default বাদ দেয়
        server = self.get_object()
        RadiusServer.objects.filter(is_default=True).update(is_default=False)
        server.is_default = True
        server.save(update_fields=['is_default'])
        return Response({'success': True, 'message': f'{server.name} এখন ডিফল্ট RADIUS সার্ভার।'})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def auto_detect(request):
    # সার্ভারের .env থেকে default RADIUS সেটিং পড়ে ফর্ম auto-fill করার জন্য
    from django.conf import settings
    import socket
    server_ip = socket.gethostbyname(socket.gethostname())
    radius_cfg = getattr(settings, 'RADIUS_DB', {})
    return Response({
        'name': 'Primary RADIUS',
        'server_type': 'local',
        'db_host': radius_cfg.get('HOST', 'localhost'),
        'db_port': int(radius_cfg.get('PORT', 5432)),
        'db_name': radius_cfg.get('NAME', 'radius'),
        'db_user': radius_cfg.get('USER', 'radius'),
        'db_password': radius_cfg.get('PASSWORD', ''),
        'radius_host': server_ip,
        'radius_auth_port': 1812,
        'radius_acct_port': 1813,
    })


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def quick_test(request):
    # DB connect করে যাচাই করে — সংরক্ষণ ছাড়াই
    import psycopg
    try:
        conn = psycopg.connect(
            host=request.data.get('db_host', 'localhost'),
            port=int(request.data.get('db_port', 5432)),
            user=request.data.get('db_user', 'radius'),
            password=request.data.get('db_password', ''),
            dbname=request.data.get('db_name', 'radius'),
            connect_timeout=5,
        )
        with conn.cursor() as cur:
            cur.execute("SELECT VERSION()")
            version = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM radcheck")
            user_count = cur.fetchone()[0]
        conn.close()
        return Response({
            'success': True,
            'message': 'DB সংযোগ সফল!',
            'db_version': version,
            'user_count': user_count,
        })
    except Exception as e:
        return Response({'success': False, 'message': f'সংযোগ ব্যর্থ: {str(e)}'}, status=400)


def _parse_mikrotik_uptime(uptime_str):
    """Mikrotik uptime string (যেমন '2h30m15s') থেকে approximate start datetime বের করে।"""
    import re
    from datetime import datetime, timedelta
    if not uptime_str:
        return None
    try:
        total_seconds = 0
        for val, unit in re.findall(r'(\d++)([wdhms])', uptime_str):
            total_seconds += int(val) * {'w': 604800, 'd': 86400, 'h': 3600, 'm': 60, 's': 1}[unit]
        return datetime.now() - timedelta(seconds=total_seconds)
    except Exception:
        return None


def _fetch_mikrotik_active():
    """সব active MikroTik router-এর /ppp/active session → (active_keys set, sessions_by_key dict)।"""
    active_keys = set()
    sessions_by_key = {}
    try:
        from mikrotik_app.models import MikrotikServer
        from mikrotik_app.services.mikrotik_service import MikrotikService
        servers = list(MikrotikServer.objects.filter(is_active=True))
    except Exception:
        servers = []
    for server in servers:
        try:
            svc = MikrotikService.from_server_model(server)
            sessions = svc.get_active_connections()
        except Exception:
            continue
        for s in sessions:
            username = (s.get('name') or s.get('user') or '').strip()
            if not username:
                continue
            key = username.lower()
            active_keys.add(key)
            if key not in sessions_by_key:
                sessions_by_key[key] = {'server': server, 'session': s}
    return active_keys, sessions_by_key


def _split_fresh_and_ghosts(radius_users, mikrotik_active_keys):
    """RADIUS session → (fresh_radius online list, ghost_sessions username list)।
    fresh অথবা Mikrotik-confirmed = online; stale ও unconfirmed = ghost।"""
    fresh_radius = []
    ghost_sessions = []
    for u in radius_users:
        key = str(u.get('username') or '').lower()
        if not u.get('stale', False):
            fresh_radius.append(u)                    # ✓ fresh — online
        elif key in mikrotik_active_keys:
            u['stale_but_confirmed'] = True
            fresh_radius.append(u)                    # ✓ Mikrotik confirm — online
        else:
            ghost_sessions.append(u.get('username'))  # ✗ ghost — offline
    return fresh_radius, ghost_sessions


def _close_ghosts_on_target(svc, ghost_sessions):
    """একটি RADIUS target-এ ghost username-গুলোর open radacct session close করে।"""
    try:
        conn = svc._conn()
        with conn.cursor() as cur:
            for uname in ghost_sessions:
                if uname:
                    cur.execute(
                        "UPDATE radacct "
                        "SET acctstoptime=NOW(), acctterminatecause='Lost-Carrier' "
                        "WHERE username=%s AND acctstoptime IS NULL",
                        [uname]
                    )
        conn.commit()
        conn.close()
    except Exception:
        pass


def _close_ghost_sessions_async(ghost_sessions):
    """ghost radacct session-গুলো background thread-এ close করে (API response block হয় না)।"""
    import threading
    from radius_app.services.radius_service import RadiusService
    from radius_app.models import RadiusServer

    def _close():
        try:
            rs_list = list(RadiusServer.objects.filter(is_active=True))
            targets = [RadiusService(rs) for rs in rs_list] if rs_list else [RadiusService(None)]
            for svc in targets:
                _close_ghosts_on_target(svc, ghost_sessions)
        except Exception:
            pass
    threading.Thread(target=_close, daemon=True).start()


def _build_mikrotik_only(sessions_by_key, fresh_radius):
    """RADIUS accounting-এ miss হওয়া Mikrotik-only session-গুলোর row list।"""
    seen = {str(u['username']).lower() for u in fresh_radius if u.get('username')}
    rows = []
    for key, info in sessions_by_key.items():
        if key in seen:
            continue
        server = info['server']
        s      = info['session']
        # Mikrotik uptime থেকে session start সময় বের করি — সবচেয়ে কাছের অনুমান
        approx_start = _parse_mikrotik_uptime(s.get('uptime') or '')
        nas = str(getattr(server, 'radius_host', '') or getattr(server, 'db_host', '') or '')
        rows.append({
            'username':       (s.get('name') or s.get('user') or '').strip(),
            'nas_ip':         nas,
            'ip':             s.get('address') or '',
            'session_id':     s.get('.id') or s.get('session-id') or '',
            'start_time':     approx_start.isoformat(sep=' ', timespec='seconds') if approx_start else None,
            'bytes_in':       0,
            'bytes_out':      0,
            'caller_id':      s.get('caller-id') or '',
            'nas_identifier': nas,
            'source':         'mikrotik',
            'uptime':         s.get('uptime') or '',
        })
    return rows


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def online_users(request):
    """
    Online user তালিকা — সর্বদা সঠিক real-time ডেটা।

    Data sources (priority order):
      1. RADIUS radacct  — exact start_time, bytes in/out, session_id
      2. Mikrotik /ppp/active — ground truth (router যা দেখছে সেটাই সত্য)

    Ghost session elimination (call এর সময়ই):
      - RADIUS তে open session আছে কিন্তু Mikrotik confirm করছে না
        AND acctupdatetime > threshold → ghost → তাৎক্ষণিক radacct close করো
      - পরবর্তী call এ ওই session আর আসবে না

    Result rule:
      online = (fresh RADIUS) ∪ (stale RADIUS ∩ Mikrotik active) ∪ (Mikrotik-only)
      offline = stale RADIUS ∩ ¬Mikrotik → ghost → auto-closed
    """
    from radius_app.services.radius_service import RadiusService

    # ── Step 1: RADIUS radacct (fresh + stale দুটোই) ────────────────────
    radius_users = RadiusService.all_online_users()
    last_stop_times = RadiusService.get_all_last_stop_times()
    for u in radius_users:
        u.setdefault('source', 'radius')

    # ── Step 2: Mikrotik /ppp/active (ground truth) ──────────────────────
    mikrotik_active_keys, mikrotik_sessions_by_key = _fetch_mikrotik_active()

    # ── Step 3: Ghost detection + background auto-close ──────────────────
    fresh_radius, ghost_sessions = _split_fresh_and_ghosts(radius_users, mikrotik_active_keys)
    if ghost_sessions:
        _close_ghost_sessions_async(ghost_sessions)

    # ── Step 4: Mikrotik-only users (RADIUS accounting miss) ─────────────
    users = fresh_radius + _build_mikrotik_only(mikrotik_sessions_by_key, fresh_radius)

    # ── known_only=1 → শুধু এই DB-র client-দের online সংখ্যা ──────────────
    # Dashboard "Online Clients"-এর জন্য: রাউটার/RADIUS-এ অন্য (DB-বহির্ভূত)
    # session থাকলেও শুধু এই panel-এর client গোনা হয়। ghost-elimination উপরে
    # সব session-এ চলে — filter শুধু returned list/count-এ প্রভাব ফেলে।
    if request.query_params.get('known_only') in ('1', 'true', 'yes'):
        from clients.models import Client
        known = {
            u.lower() for u in Client.objects.values_list('username', flat=True) if u
        }
        users = [u for u in users if str(u.get('username') or '').lower() in known]

    return Response({
        'online_count':    len(users),
        'users':           users,
        'last_stop_times': last_stop_times,
    })


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def disconnect_user(request):
    # নির্দিষ্ট user-কে disconnect করার API
    username = request.data.get('username')
    if not username:
        return Response({'error': 'username প্রয়োজন।'}, status=400)
    from radius_app.services.radius_service import RadiusService
    # multi-RADIUS: user-এর client→router→radius_server ধরে সঠিক server-এ disconnect
    from clients.models import Client
    client = Client.objects.filter(username=username).select_related('router').first()
    svc = RadiusService.for_client(client) if client else RadiusService.get_default()
    success = svc.disconnect_user(username)
    return Response({'success': success, 'message': f'{username} disconnect করা হয়েছে।'})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def traffic_history(request):
    # মাসিক traffic history — ClientMonthlyTraffic (summary table) + current month live radacct।
    # Strategy:
    #   পূর্ববর্তী মাস → ClientMonthlyTraffic (app DB, দ্রুত, চিরস্থায়ী)
    #   চলতি মাস      → radacct live query (সঠিক real-time data)
    username = request.GET.get('username', '').strip()
    months   = min(int(request.GET.get('months', 6)), 24)
    if not username:
        return Response({'error': 'username প্রয়োজন।'}, status=400)

    from radius_app.services.radius_service import RadiusService
    from clients.models import Client, ClientMonthlyTraffic
    from django.utils import timezone

    try:
        client = Client.objects.filter(username=username).first()

        # ── Step 1: summary table থেকে ইতিহাস ──────────────────────────────
        if client:
            qs = (ClientMonthlyTraffic.objects
                  .filter(client=client)
                  .order_by('-year_month')[:months])
            history = [
                {
                    'month':         r.year_month,
                    'bytes_in':      r.bytes_in,
                    'bytes_out':     r.bytes_out,
                    'sessions':      r.sessions,
                    'total_seconds': r.online_seconds,
                    'source':        'summary',
                }
                for r in qs
            ]
        else:
            history = []

        # ── Step 2: চলতি মাসের live data radacct থেকে যোগ করি ──────────────
        current_month = timezone.localdate().strftime('%Y-%m')
        try:
            rs = RadiusService.for_client(client) if client else RadiusService.get_default()
            if rs:
                live_list = rs.get_traffic_history(username, months=1)
                if live_list and live_list[0]['month'] == current_month:
                    live = live_list[0]
                    live['source'] = 'live'
                    # summary table-এ current month থাকলে replace করি (live বেশি accurate)
                    history = [h for h in history if h['month'] != current_month]
                    history.insert(0, live)
                    history.sort(key=lambda x: x['month'], reverse=True)
        except Exception:
            pass  # radacct unavailable হলে summary data দিয়ে চলবে

        return Response({'history': history[:months]})

    except Exception as e:
        return Response({'error': str(e)}, status=500)
