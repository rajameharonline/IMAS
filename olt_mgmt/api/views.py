# এই ফাইলটি OLT management API views।
import socket
import threading as _threading

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from olt_mgmt.models import OLT, ONUSignal, OLTMacCache
from olt_mgmt.api.serializers import (
    OLTSerializer, OLTCreateSerializer, OLTUpdateSerializer,
    ONUSignalSerializer, OLTMacCacheSerializer,
)


def _probe_tcp(host, port, timeout=4):
    with socket.create_connection((str(host), int(port)), timeout=timeout) as sock:
        sock.settimeout(1.5)
        try:
            banner = sock.recv(512).decode(errors='ignore').strip()
        except socket.timeout:
            banner = ''
        return banner


def _describe_banner(banner):
    text = (banner or '').strip()
    lower = text.lower()
    if text.startswith('SSH-'):
        return f"SSH banner: {text.splitlines()[0]}"
    if 'password' in lower:
        return 'Password prompt detected'
    if 'login' in lower or 'username' in lower:
        return 'Login prompt detected'
    if text:
        return f"Banner: {text[:120]}"
    return 'TCP connection opened, but no banner was returned.'


def _refresh_system_name(olt):
    """
    ডিভাইসের web UI থেকে আসল System Name এনে OLT.system_name-এ রাখে।
    Best-effort — ডিভাইস unreachable/credential ভুল হলে চুপচাপ '' ফেরত দেয়,
    caller-এর মূল কাজ (create/sync) কখনো ব্যর্থ করে না।
    """
    if not olt.username or not olt.password:
        return ''
    try:
        from olt_mgmt.services.http_service import fetch_system_name_from_http
        name = fetch_system_name_from_http(olt)
    except Exception:
        _logger.exception(f"System Name fetch ব্যর্থ (OLT {olt.pk})")
        return ''
    if name and name != olt.system_name:
        olt.system_name = name
        olt.save(update_fields=['system_name'])
    return name


def _fetch_rx_from_device(olt, select: str = '255'):
    """
    ডিভাইস থেকে RX map আনে — **HTTP web-UI scrape** (opm-diag পেজ)।

    Telnet পথ সরিয়ে দেওয়া হয়েছে (2026-07-20): ডিভাইসে মেপে দেখা গেছে
    HTTP প্রতিটি দিক থেকে ভালো — 8.30s/62 ONU বনাম Telnet 12.0s/44 ONU
    (অসম্পূর্ণ), এবং Telnet CLI মাঝেমধ্যে opm-diag-এ সাড়াই দেয় না।
    HTTP-তে per-PON-port fetch-ও সম্ভব (select), Telnet-এ ছিল না।

    select: '255' = সব PON port, বা নির্দিষ্ট port নম্বর।
    Returns (rx_map, source, error_response)। একই OLT-এ concurrent heavy
    scrape আটকাতে lock ব্যবহার করে (lock না পেলে 429)।
    """
    from olt_mgmt.services.http_service import fetch_rx_from_http

    if not olt.username or not olt.password:
        return None, '', Response(
            {'ok': False, 'error': 'OLT-এ username ও password সেট করুন।'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not _olt_device_lock_acquire(olt.id):
        return None, '', Response(
            {'ok': False, 'error': 'এই OLT-এ ইতিমধ্যে একটা sync চলছে, একটু পর আবার চেষ্টা করুন।'},
            status=429,
        )
    try:
        rx_map = fetch_rx_from_http(olt, timeout=30, select=select)
        # ডিভাইসে System Name বদলালে এখানেই আপডেট হয়ে যায় (best-effort)
        _refresh_system_name(olt)
    finally:
        _olt_device_lock_release(olt.id)

    if not rx_map:
        return None, '', Response({
            'ok': False,
            'error': (
                'OLT web UI (ONU OPM Diag) থেকে কোনো ONU data পাওয়া যায়নি। '
                'IP/username/password ও ডিভাইসের HTTP access চেক করুন।'
            ),
        }, status=status.HTTP_400_BAD_REQUEST)

    return rx_map, 'http_opm_diag', None


def _apply_rx_map(olt, rx_map, source, now):
    """
    ডিভাইস থেকে পাওয়া rx_map → ONUSignal-এ upsert; returns (created, updated)।

    গুরুত্বপূর্ণ: raw_data **merge** করা হয়, replace নয়। আগে এখানে
    `{'source': source}` দিয়ে পুরো raw_data ওভাররাইট হতো, যাতে `mac` key
    মুছে যেত — অথচ ONU Event Log সেই MAC দিয়েই ONU খুঁজে (_match_onu_row)।
    """
    existing = {
        s.interface_id: s
        for s in ONUSignal.objects.filter(olt=olt, interface_id__in=list(rx_map.keys()))
    }
    created = updated = 0
    for iface_key, rx_dbm in rx_map.items():
        prev = existing.get(iface_key)
        raw = dict(prev.raw_data or {}) if prev else {}
        raw['source'] = source
        _, was_created = ONUSignal.objects.update_or_create(
            olt=olt,
            interface_id=iface_key,
            defaults={
                'rx_power': rx_dbm,
                'signal_status': _signal_status(rx_dbm),
                'last_updated': now,
                'raw_data': raw,
            },
        )
        created += int(was_created)
        updated += int(not was_created)
    return created, updated


def _signal_status(rx_power):
    if rx_power is None:
        return 'offline'
    try:
        return 'low' if float(rx_power) < -25 else 'good'
    except (TypeError, ValueError):
        return 'unknown'


# OLT-strings যা ONU-কে আসলে disconnect/deregistered বুঝায়
# (vendor-ভেদে variants: BDCOM 'dereg', Vsol 'offline', Huawei 'lost' ইত্যাদি)
_OFFLINE_TOKENS = {
    'offline', 'down', 'lost', 'inactive', 'disable', 'disabled',
    'dereg', 'dereg-power-off', 'dereg-los', 'dying-gasp', 'los',
}
_ONLINE_TOKENS = {'online', 'up', 'active', 'working', 'success'}


def _signal_status_from_mac_row(row):
    """OLTMacCache row → ONUSignal.signal_status নির্ধারণ।

    কেন আলাদা helper:
      পুরনো _signal_status() শুধু rx_power দেখত — rx=None হলেই 'offline'।
      কিন্তু OLT কিছু online ONU-এর জন্য rx report নাও করতে পারে
      (vendor-specific OID miss বা snmp timeout), সেক্ষেত্রে আমরা ভুলভাবে
      'offline' লিখে দিতাম। OLTMacCache.status-ই OLT-এর actual ONU state।

    Priority:
      1. OLT বলছে offline/dereg/lost → 'offline' (rx যাই হোক)
      2. OLT বলছে online + rx আছে   → threshold অনুযায়ী 'good'/'low'
      3. OLT বলছে online + rx নেই   → 'good' (ONU detected, signal unknown)
      4. status field খালি/অজানা    → rx থাকলে threshold, না হলে 'unknown'
    """
    st = (row.status or '').strip().lower()
    if st in _OFFLINE_TOKENS:
        return 'offline'
    rx = row.rx_power_dbm
    if rx is not None:
        try:
            return 'low' if float(rx) < -25 else 'good'
        except (TypeError, ValueError):
            return 'unknown'
    return 'good' if st in _ONLINE_TOKENS else 'unknown'


# sync_mac_table (manual "Sync MAC Table" বাটন) আগে এই row-processing logic
# নিজে আলাদাভাবে duplicate রাখত (client_id/tx_power link করত না) — auto-sync
# task (olt_mgmt/tasks.py:_process_onu_row)-এর সাথে drift হয়ে যেত: যেটা শেষ
# চলত সেটাই client_id/tx_power জিতে যেত। এখন manual sync সরাসরি সেই একই
# ফাংশন reuse করে যাতে দুটো path কখনো আলাদা আচরণ না করে।
def _sync_mac_row(olt, service, row, idx, now, cust_map, existing_links):
    """sync_mac_table-এর একটি row → tasks._process_onu_row()-এর thin wrapper।
    Returns (was_created: bool, interface_id: str, mac: str)।"""
    from olt_mgmt.tasks import _process_onu_row
    return _process_onu_row(olt, service, row, idx, now, cust_map, existing_links)


def _mark_touched(touched_per_olt, sig):
    """refresh_from_inventory-এর জন্য olt_id → touched ONUSignal id set।"""
    touched_per_olt.setdefault(sig.olt_id, set()).add(sig.id)


def _sync_mac_cache_signals(touched_per_olt, now):
    """OLTMacCache → ONUSignal upsert (সব row, rx unknown হলেও); returns (created, updated)।"""
    created = updated = 0
    for row in OLTMacCache.objects.select_related('olt', 'client').all():
        interface_id = row.port
        if row.onu:
            interface_id = f'{row.port}/{row.onu}' if row.port else row.onu
        if not interface_id:
            continue
        sig, was_created = ONUSignal.objects.update_or_create(
            olt=row.olt,
            interface_id=interface_id,
            defaults={
                'client': row.client,
                'rx_power': row.rx_power_dbm,
                'signal_status': _signal_status_from_mac_row(row),
                'last_updated': row.learned_at or now,
                'notes': row.description,
                'raw_data': {
                    'source': 'mac_cache',
                    'mac': row.mac,
                    'status': row.status,
                },
            },
        )
        _mark_touched(touched_per_olt, sig)
        created += int(was_created)
        updated += int(not was_created)
    return created, updated


def _cleanup_stale_signals_per_olt(touched_per_olt):
    """touched হয়নি কিন্তু cleanable source-এর ONUSignal rows delete; returns deleted count।
    whitelist-এর বাইরের source (live_snmp/telnet) untouched থাকলেও রক্ষিত।"""
    CLEANABLE_SOURCES = {'olt_sync', 'mac_cache'}
    deleted = 0
    for olt_id, touched in touched_per_olt.items():
        stale_qs = ONUSignal.objects.filter(olt_id=olt_id).exclude(id__in=touched)
        # JSONField source check Python-side — vendor-cross-DB safe
        stale_ids = [
            s.id for s in stale_qs.only('id', 'raw_data')
            if (s.raw_data or {}).get('source') in CLEANABLE_SOURCES
        ]
        if stale_ids:
            deleted += ONUSignal.objects.filter(id__in=stale_ids).delete()[0]
    return deleted


class OLTViewSet(viewsets.ModelViewSet):
    queryset = OLT.objects.annotate(
        # আগে Count('onus', ...) ব্যবহার হতো — এখন-অপসারিত dead ONU model-এর
        # related_name, যেটা কখনো কোনো row পেত না (সবসময় 0 দেখাত)। এখন
        # ONUSignal (real, live-synced ONU tracking table)-এর related_name
        # 'signals' দিয়ে প্রকৃত count আসে।
        onu_count=Count('signals', distinct=True),
        mac_count=Count('mac_cache', distinct=True),
    )
    permission_classes = [permissions.IsAuthenticated]
    search_fields = ['name', 'system_name', 'ip_address', 'vendor', 'model', 'location']
    filterset_fields = ['vendor', 'is_active', 'mgmt_proto']
    ordering_fields = ['name', 'ip_address', 'vendor', 'last_sync_at', 'created_at']

    def get_serializer_class(self):
        if self.action == 'create':
            return OLTCreateSerializer
        if self.action in ['update', 'partial_update']:
            return OLTUpdateSerializer
        return OLTSerializer

    def perform_create(self, serializer):
        # OLT তৈরির সাথে সাথে ডিভাইস থেকে আসল System Name এনে DB-তে রাখি,
        # যাতে UI সব জায়গায় বাস্তব নামটাই দেখায়। ডিভাইস unreachable হলেও
        # create ব্যর্থ হবে না — best-effort।
        olt = serializer.save()
        _refresh_system_name(olt)

    @action(detail=True, methods=['post'], url_path='sync-clock')
    def sync_clock(self, request, pk=None):
        """
        OLT ডিভাইসের DateTime + timezone এই সার্ভারের সময় দিয়ে আপডেট করে (CLI)।

        **শুধু ম্যানুয়াল** — কোনো scheduled task নেই (ব্যবহারকারীর সিদ্ধান্ত)।
        OLT-এর web UI-তে কনফিগ লেখা কাজ করে না (HTTP 200 আসে কিন্তু প্রয়োগ হয়
        না), তাই CLI ব্যবহার করা হয় — বিস্তারিত `cli_service.py` দেখুন।

        Response: { ok, before, after, server_time, error }
        """
        from django.conf import settings
        from olt_mgmt.services.cli_service import sync_olt_clock, DHAKA_TZ

        olt = self.get_object()
        try:
            r = sync_olt_clock(olt, ntp_server=getattr(settings, 'OLT_NTP_SERVER', '') or '')
        except Exception as exc:
            _logger.exception('sync_clock ব্যর্থ (OLT %s)', olt.pk)
            return Response({'ok': False, 'error': f'CLI ত্রুটি: {exc}'},
                            status=status.HTTP_400_BAD_REQUEST)

        server_time = timezone.localtime(timezone.now()).astimezone(DHAKA_TZ)
        payload = {**r, 'server_time': server_time.strftime('%Y-%m-%d %H:%M:%S')}
        if not r['ok']:
            return Response(payload, status=status.HTTP_400_BAD_REQUEST)

        olt.last_polled = timezone.now()
        olt.save(update_fields=['last_polled'])
        return Response(payload)

    @action(detail=True, methods=['post'], url_path='sync-system-name')
    def sync_system_name(self, request, pk=None):
        """ডিভাইস থেকে System Name আবার পড়ে DB-তে আপডেট করে।"""
        olt = self.get_object()
        name = _refresh_system_name(olt)
        if not name:
            return Response({
                'ok': False,
                'error': 'ডিভাইস থেকে System Name পাওয়া যায়নি — IP/credential চেক করুন।',
            }, status=status.HTTP_400_BAD_REQUEST)
        return Response({'ok': True, 'system_name': name, 'display_name': olt.display_name})

    @action(detail=True, methods=['post'], url_path='test-connection')
    def test_connection(self, request, pk=None):
        """
        সংযোগ পরীক্ষা — এখন **যে চ্যানেল দিয়ে আসলে sync হয়** সেটাই যাচাই করে:
        OLT-এর web UI-তে login করে System Name পড়ার চেষ্টা (HTTP)। আগে শুধু
        Telnet/SSH পোর্ট খোলা আছে কিনা দেখত, যা Telnet সরানোর পর আর
        automation-এর প্রকৃত অবস্থা বলত না (পোর্ট খোলা থাকলেও sync ভাঙতে পারত)।
        """
        olt = self.get_object()

        system_name = _refresh_system_name(olt)
        if system_name:
            olt.last_polled = timezone.now()
            olt.save(update_fields=['last_polled'])
            return Response({
                'ok': True,
                'message': f'সংযোগ সফল: {olt.ip_address} (web UI)',
                'description': f'ডিভাইস System Name: {system_name}',
                'system_name': system_name,
            })

        # HTTP ব্যর্থ — TCP probe দিয়ে বোঝার চেষ্টা যে ডিভাইস আদৌ সাড়া দিচ্ছে কিনা
        try:
            banner = _probe_tcp(olt.ip_address, 443 if olt.mgmt_proto != 'snmp' else 161)
            hint = _describe_banner(banner)
        except Exception as exc:
            hint = f'TCP সংযোগও ব্যর্থ: {exc}'

        return Response({
            'ok': False,
            'message': f'সংযোগ ব্যর্থ: {olt.ip_address} — web UI login হয়নি।',
            'description': f'IP/username/password ও ডিভাইসের HTTPS access চেক করুন। {hint}',
        }, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], url_path='detect-prompt')
    def detect_prompt(self, request):
        # Add/Edit modal থেকে host ও port দিয়ে prompt/banner detection।
        host = (request.data.get('host') or request.data.get('ip_address') or '').strip()
        port = int(request.data.get('port') or request.data.get('telnet_port') or 23)
        if not host:
            return Response({'ok': False, 'error': 'Host/IP প্রয়োজন।'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            banner = _probe_tcp(host, port)
            return Response({'ok': True, 'detected': _describe_banner(banner), 'banner': banner})
        except Exception as exc:
            return Response({'ok': False, 'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='sync-mac-table')
    def sync_mac_table(self, request, pk=None):
        # PHP sample-এর sync action-এর Django সংস্করণ: SNMP থেকে পাওয়া rows cache করে।
        # Vendor-specific Telnet parser পরে সহজে বসানোর জন্য cache model/API প্রস্তুত রাখা হয়েছে।
        olt = self.get_object()
        try:
            from olt_mgmt.services.snmp_service import SNMPService
            from olt_mgmt.services import device_service
            from olt_mgmt.tasks import _build_cust_map, _build_existing_links
            # `service` শুধু static helper (normalize_mac ইত্যাদি) সরবরাহ করে;
            # প্রকৃত ডাটা HTTP প্রধান, ব্যর্থ হলে SNMP (device_service দেখুন)
            service = SNMPService.from_olt_model(olt)
            rows, _src = device_service.fetch_onu_inventory(olt)
            now = timezone.now()
            created = updated = 0
            cust_map = _build_cust_map()
            existing_links = _build_existing_links(olt)

            touched_interface_ids = set()
            touched_macs = set()
            for idx, row in enumerate(rows[:500], start=1):
                was_created, interface_id, mac = _sync_mac_row(
                    olt, service, row, idx, now, cust_map, existing_links)
                if was_created:
                    created += 1
                else:
                    updated += 1
                touched_interface_ids.add(interface_id)
                touched_macs.add(mac)

            # পূর্বের failed/partial sync (যেমন RX walk timeout) থেকে phantom
            # rows ('EPON 0/01/N' fallback) cleanup — auto-task-এর মতোই
            # coverage-sanity-guarded helper ব্যবহার করা হয় (partial walk-এ
            # real online ONU-র data ভুলভাবে মুছে যাওয়া এড়াতে)।
            from olt_mgmt.tasks import _cleanup_stale_signals, _cleanup_stale_mac_cache
            _cleanup_stale_signals(olt, touched_interface_ids)
            _cleanup_stale_mac_cache(olt, touched_macs)

            count = created + updated
            olt.last_sync_at = now
            olt.last_sync_status = 'success'
            olt.last_sync_count = count
            olt.last_sync_message = f'{count} টি row sync হয়েছে।'
            olt.save(update_fields=['last_sync_at', 'last_sync_status', 'last_sync_count', 'last_sync_message'])
            return Response({
                'ok': True,
                'message': olt.last_sync_message,
                'created': created,
                'updated': updated,
                'count': count,
            })
        except Exception as exc:
            olt.last_sync_at = timezone.now()
            olt.last_sync_status = 'failed'
            olt.last_sync_message = str(exc)
            olt.save(update_fields=['last_sync_at', 'last_sync_status', 'last_sync_message'])
            return Response({'ok': False, 'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['get'], url_path='mac-cache')
    def mac_cache(self, request, pk=None):
        olt = self.get_object()
        rows = olt.mac_cache.select_related('client').order_by('port', 'onu', 'mac')[:500]
        return Response(OLTMacCacheSerializer(rows, many=True).data)

    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request):
        return Response({
            'total': OLT.objects.count(),
            'active': OLT.objects.filter(is_active=True).count(),
            'inactive': OLT.objects.filter(is_active=False).count(),
            'mac_rows': OLTMacCache.objects.count(),
            'signals': ONUSignal.objects.count(),
            'low_signals': ONUSignal.objects.filter(signal_status='low').count(),
            'offline_signals': ONUSignal.objects.filter(signal_status='offline').count(),
        })

    @action(detail=True, methods=['get'], url_path='system-info')
    def system_info(self, request, pk=None):
        # SNMP দিয়ে OLT system তথ্য আনা হচ্ছে
        olt = self.get_object()
        from olt_mgmt.services.snmp_service import SNMPService
        service = SNMPService.from_olt_model(olt)
        info = service.get_system_info()
        return Response(info)

    @action(detail=True, methods=['get'], url_path='onu-list')
    def onu_list(self, request, pk=None):
        # OLT-এর ONU তালিকা — HTTP প্রধান, ব্যর্থ হলে SNMP (device_service)
        olt = self.get_object()
        from olt_mgmt.services import device_service
        onu_data, source = device_service.fetch_onu_inventory(olt)
        return Response({'source': source, 'count': len(onu_data), 'results': onu_data})

    @action(detail=True, methods=['get'], url_path='diagnose-rx-oids')
    def diagnose_rx_oids(self, request, pk=None):
        """
        V-SOL OLT-এর সব candidate RX OID walk করে ফলাফল দেয়।
        নতুন OLT-এ কোন OID কাজ করছে তা জানতে ব্যবহার করুন।
        """
        olt = self.get_object()
        from olt_mgmt.services.snmp_service import SNMPService
        service = SNMPService.from_olt_model(olt)
        results = service.diagnose_rx_oids()
        working = [oid for oid, info in results.items() if info['count'] > 0]
        return Response({
            'olt': olt.display_name,
            'ip': str(olt.ip_address),
            'fw_version': olt.fw_version,
            'rx_snmp_oid': olt.rx_snmp_oid or '',
            'working_oids': working,
            'details': results,
            'recommendation': (
                f"rx_snmp_oid = '{working[0]}' সেট করুন" if working
                else 'SNMP-এ RX OID নেই — Telnet RX Sync ব্যবহার করুন'
            ),
        })

    @action(detail=True, methods=['post'], url_path='sync-rx')
    def sync_rx(self, request, pk=None):
        """
        OLT web UI (ONU OPM Diag) scrape করে সব ONU-র RX Power আপডেট করে।
        SNMP-তে RX না পাওয়া firmware-এর জন্য এটাই প্রধান RX উৎস।
        """
        olt = self.get_object()
        now = timezone.now()

        rx_map, source, err = _fetch_rx_from_device(olt)
        if err is not None:
            return err

        created, updated = _apply_rx_map(olt, rx_map, source, now)

        olt.last_sync_at = now
        olt.last_sync_status = 'success'
        olt.last_sync_count = created + updated
        olt.last_sync_message = f'HTTP opm-diag: {created + updated} ONU RX আপডেট।'
        olt.save(update_fields=['last_sync_at', 'last_sync_status', 'last_sync_count', 'last_sync_message'])

        return Response({
            'ok': True,
            'message': olt.last_sync_message,
            'created': created,
            'updated': updated,
            'total': created + updated,
        })

    @action(detail=True, methods=['post'], url_path='sync-rx-telnet')
    def sync_rx_telnet(self, request, pk=None):
        """Deprecated alias — Telnet সরানোর আগের URL, পুরনো caller ভাঙা এড়াতে
        রাখা হয়েছে। নতুন কোডে `sync-rx` ব্যবহার করুন।"""
        return self.sync_rx(request, pk=pk)


class ONUSignalViewSet(viewsets.ModelViewSet):
    queryset = ONUSignal.objects.select_related(
        'olt', 'client', 'client__zone', 'client__subzone', 'client__box').all()
    serializer_class = ONUSignalSerializer
    permission_classes = [permissions.IsAuthenticated]
    search_fields = ['interface_id', 'client__full_name', 'client__phone', 'client__customer_id',
                     'olt__name', 'client__zone__name', 'client__subzone__name', 'client__box__name']
    filterset_fields = ['olt', 'signal_status', 'client']
    ordering_fields = ['last_updated', 'rx_power', 'client__full_name', 'interface_id']

    @action(detail=True, methods=['post'], url_path='push-description')
    def push_description(self, request, pk=None):
        """
        Client কলামের লেবেল ("customerID-নাম") বাস্তব OLT ডিভাইসের ONU
        Description-এ লিখে দেয় (CLI — web UI-তে কনফিগ লেখা কাজ করে না)।

        কেন উপযোগী: description-ভিত্তিক client auto-link (`_client_id_from_desc`)
        ঠিক এই "customerID-নাম" ফরম্যাট পড়ে। ডিভাইসে লিখে রাখলে পরবর্তী
        sync-গুলোতেও ONU↔Client সম্পর্ক নিজে থেকেই টিকে থাকে।

        **শুধু ম্যানুয়াল** — কোনো scheduled task নেই।
        Response: { ok, sent, description, error }
        """
        from olt_mgmt.services.cli_service import set_onu_description

        sig = self.get_object()
        if not sig.client_id:
            return Response(
                {'ok': False, 'error': 'এই ONU কোনো ক্লায়েন্টের সাথে linked নয় — পাঠানোর কিছু নেই।'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        client = sig.client
        label = '-'.join(x for x in [str(client.customer_id or '').strip(),
                                     str(client.full_name or '').strip()] if x)
        try:
            r = set_onu_description(sig.olt, sig.interface_id, label)
        except Exception as exc:
            _logger.exception('push_description ব্যর্থ (signal %s)', sig.pk)
            return Response({'ok': False, 'error': f'CLI ত্রুটি: {exc}'},
                            status=status.HTTP_400_BAD_REQUEST)

        if not r['ok']:
            return Response(r, status=status.HTTP_400_BAD_REQUEST)

        # ডিভাইসে সফল — লোকাল কপিও এখনই আপডেট করি, যাতে পরের sync-এর জন্য
        # অপেক্ষা না করে UI-তে সাথে সাথে দেখা যায়।
        sig.notes = r['sent']
        sig.save(update_fields=['notes'])
        OLTMacCache.objects.filter(
            olt=sig.olt, mac=(sig.raw_data or {}).get('mac') or ''
        ).update(description=r['sent'])

        return Response({**r, 'description': r['sent']})

    @action(detail=True, methods=['post'], url_path='live-refresh')
    def live_refresh(self, request, pk=None):
        """
        এই ONU-র জন্য **সরাসরি ডিভাইস থেকে** RX পড়ে DB আপডেট করে।

        **Scope:** পুরো OLT স্ক্যান না করে শুধু এই ONU-র PON port আনা হয়
        (web-UI `onuopmdiag.html?select=<port>`)। ডিভাইসে মাপা
        (192.168.110.2): সব port (select=255) → 8.30s/62 ONU, বনাম একক port →
        0.11-4.27s/3-29 ONU। এতে সময় ও OLT-এর উপর চাপ দুটোই অনেক কমে।
        Telnet-এ port-ভিত্তিক ভ্যারিয়েন্ট নেই (`% Unknown command`), তাই
        per-port শুধু HTTP পথেই সম্ভব; ব্যর্থ হলে পূর্ণ স্ক্যানে fallback।

        শেষে ONU log cache মুছে দেওয়া হয়, যাতে পরের `onu-log` কল cached নয়
        — সরাসরি ডিভাইস থেকে fresh status পড়ে।

        Response: { ok, source, scope, in_device, device_total, updated, signal }
        `in_device=False` মানে ডিভাইস এই interface-টা রিপোর্ট করেনি (ONU
        সম্ভবত unregistered) — তখন পুরনো মান ইচ্ছাকৃতভাবে অপরিবর্তিত রাখা হয়,
        কারণ "রিপোর্ট করেনি" আর "offline" এক জিনিস নয়।
        """
        from django.core.cache import cache
        from olt_mgmt.services.http_service import (
            fetch_rx_from_http, select_code_for_interface,
        )

        sig = self.get_object()
        olt = sig.olt
        now = timezone.now()

        if not olt.username or not olt.password:
            return Response({'ok': False, 'error': 'OLT-এ username ও password সেট করুন।'},
                            status=status.HTTP_400_BAD_REQUEST)

        # ── ১) দ্রুত পথ: শুধু এই ONU-র PON port ──
        rx_map, source, scope = {}, '', ''
        sel = select_code_for_interface(sig.interface_id)
        if sel:
            rx_map = fetch_rx_from_http(olt, timeout=25, select=sel)
            if rx_map:
                source, scope = 'http_opm_diag', f'pon_{sel}'

        # ── ২) fallback: পূর্ণ স্ক্যান (Telnet → HTTP) ──
        if not rx_map:
            rx_map, source, err = _fetch_rx_from_device(olt)
            if err is not None:
                return err
            scope = 'all'

        created, updated = _apply_rx_map(olt, rx_map, source, now)

        if scope == 'all':
            # পূর্ণ স্ক্যান হলেই কেবল last_sync_* আপডেট — নইলে partial refresh
            # পুরো-sync হিসেবে ভুলভাবে রেকর্ড হয়ে যেত।
            olt.last_sync_at = now
            olt.last_sync_status = 'success'
            olt.last_sync_count = created + updated
            olt.last_sync_message = f'Live Refresh (full): {created + updated} ONU RX আপডেট।'
            olt.save(update_fields=['last_sync_at', 'last_sync_status',
                                    'last_sync_count', 'last_sync_message'])
        else:
            olt.last_polled = now
            olt.save(update_fields=['last_polled'])

        # cache bust → পরের onu-log কল ডিভাইস থেকে fresh পড়বে
        cache.delete(f'onu_log_sig_{sig.pk}')
        if sig.client_id:
            cache.delete(f'onu_log_{sig.client_id}')

        sig.refresh_from_db()
        return Response({
            'ok': True,
            'source': source,
            'scope': scope,                       # 'pon_<n>' বা 'all'
            'in_device': sig.interface_id in rx_map,
            'device_total': len(rx_map),
            'updated': created + updated,
            'signal': ONUSignalSerializer(sig).data,
        })

    @action(detail=False, methods=['get'], url_path='monitor')
    def monitor(self, request):
        qs = self.get_queryset()
        olt_id = request.query_params.get('olt')
        signal_status = request.query_params.get('status')
        search = (request.query_params.get('search') or '').strip()

        if olt_id:
            qs = qs.filter(olt_id=olt_id)
        if signal_status:
            qs = qs.filter(signal_status=signal_status)
        if search:
            qs = qs.filter(
                Q(interface_id__icontains=search)
                | Q(client__full_name__icontains=search)
                | Q(client__phone__icontains=search)
                | Q(client__customer_id__icontains=search)
                | Q(olt__name__icontains=search)
                | Q(client__zone__name__icontains=search)
                | Q(client__subzone__name__icontains=search)
                | Q(client__box__name__icontains=search)
            )

        rows = qs.order_by('client__full_name', 'interface_id')[:1000]

        # Distance / Last Deregister Reason OLTMacCache-এ থাকে। প্রতি row-তে
        # আলাদা query (N+1, ১০০০ পর্যন্ত) এড়াতে এক query-তে map বানিয়ে
        # serializer context-এ পাঠানো হয় — key (olt_id, mac)।
        mac_info = {
            (m['olt_id'], m['mac']): {
                'distance_m': m['distance_m'],
                'last_dereg_reason': m['last_dereg_reason'],
                'last_dereg_time': m['last_dereg_time_raw'],
                'alive_time': m['alive_time'],
            }
            for m in OLTMacCache.objects
            .filter(olt_id__in={r.olt_id for r in rows})
            .values('olt_id', 'mac', 'distance_m', 'last_dereg_reason',
                    'last_dereg_time_raw', 'alive_time')
        }

        return Response({
            'summary': {
                'total': qs.count(),
                'good': qs.filter(signal_status='good').count(),
                'low': qs.filter(signal_status='low').count(),
                'offline': qs.filter(signal_status='offline').count(),
                'unknown': qs.filter(signal_status='unknown').count(),
            },
            'results': ONUSignalSerializer(
                rows, many=True, context={'mac_info': mac_info},
            ).data,
        })

    @action(detail=False, methods=['post'], url_path='refresh-from-inventory')
    def refresh_from_inventory(self, request):
        """MAC cache থেকে ONUSignal table sync।

        কেন self-cleaning দরকার:
          পূর্বে past olt_sync-এর কারণে ONUSignal-এ phantom row জমে যেত
          (যেমন একটা PON port-এ 391 entry, যদিও OLT-এ মাত্র ৬১ ONU)।
          এই action সব OLT-এর সবগুলো বর্তমান rows-এর id track করে এবং
          শেষে যেগুলো এই sync-এ touched হয়নি কিন্তু olt_sync/mac_cache
          source দিয়ে তৈরি — সেগুলো delete করে। অন্য source
          (telnet_opm_diag, live_snmp ইত্যাদি) untouched থাকলেও delete হয় না।
        """
        now = timezone.now()

        # OLT-ভিত্তিক touched ONUSignal id ট্র্যাক — sync-শেষে stale cleanup-এর জন্য
        touched_per_olt = {}  # olt_id → set[int]

        created, updated = _sync_mac_cache_signals(touched_per_olt, now)
        deleted = _cleanup_stale_signals_per_olt(touched_per_olt)

        return Response({
            'ok': True,
            'message': (
                f'{created + updated} টি row refresh হয়েছে, '
                f'{deleted} টি stale entry মুছে দেওয়া হয়েছে।'
            ),
            'created': created,
            'updated': updated,
            'deleted': deleted,
        })


class OLTMacCacheViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = OLTMacCache.objects.select_related('olt', 'client').all()
    serializer_class = OLTMacCacheSerializer
    permission_classes = [permissions.IsAuthenticated]
    search_fields = ['mac', 'description', 'port', 'onu', 'client__full_name']
    filterset_fields = ['olt', 'vendor', 'status', 'client']


import logging as _logging
_logger = _logging.getLogger(__name__)

from rest_framework.decorators import api_view, permission_classes as _perm_cls
from rest_framework.permissions import IsAuthenticated as _IsAuth

def _rx_from_mac_cache(rx_map):
    """OLTMacCache (client linked, rx আছে) → rx_map (first-wins, override করে না)।"""
    for row in (
        OLTMacCache.objects
        .filter(client__isnull=False, rx_power_dbm__isnull=False)
        .select_related('olt', 'client')
    ):
        cid = row.client_id
        rx  = row.rx_power_dbm
        if cid not in rx_map:
            iface = f'{row.port}/{row.onu}' if row.port and row.onu else (row.port or row.onu or '')
            rx_map[cid] = {
                'rx':      rx,
                'status':  _signal_status(rx),
                'olt':     row.olt.display_name if row.olt else '',
                'iface':   str(iface),
                'updated': str(row.learned_at or ''),
                'source':  'mac_cache',
            }


def _rx_from_onu_signal(rx_map):
    """ONUSignal (client link) → rx_map (সর্বোচ্চ priority — সবসময় override)।"""
    for sig in (
        ONUSignal.objects
        .filter(client__isnull=False, rx_power__isnull=False)
        .select_related('olt', 'client')
    ):
        cid = sig.client_id
        rx  = sig.rx_power
        rx_map[cid] = {
            'rx':      rx,
            'status':  sig.signal_status or _signal_status(rx),
            'olt':     sig.olt.display_name if sig.olt else '',
            'iface':   sig.interface_id or '',
            'updated': str(sig.last_updated or ''),
            'source':  'signal',
        }


@api_view(['GET'])
@_perm_cls([_IsAuth])
def client_rx_powers(request):
    """
    সব client-এর সর্বশেষ ONU RX power (dBm) একটি map হিসেবে দেয়।
    Priority: ONUSignal (client FK) > OLTMacCache (client FK)
    Response: {
      "rx": { "<client_id>": { "rx": -22.5, "status": "good", "olt": "OLT-1",
                               "iface": "1/2", "updated": "2026-05-25T..." } },
      "count": N
    }
    """
    rx_map = {}  # client_id → info dict
    _rx_from_mac_cache(rx_map)      # 1. mac_cache (lowest priority)
    _rx_from_onu_signal(rx_map)     # 2. onu signal (highest)
    return Response({'rx': rx_map, 'count': len(rx_map)})


def _session_mac_link(session, username_to_cid):
    """একটি active session → (norm_mac, cid) যদি username→client ও valid caller-id MAC
    থাকে; নাহলে None।"""
    from olt_mgmt.services.snmp_service import SNMPService
    username  = (session.get('name') or '').lower().strip()
    caller_id = (session.get('caller-id') or '').strip()
    if not username or not caller_id:
        return None
    norm_mac = SNMPService.normalize_mac(caller_id)
    if not norm_mac:
        return None
    cid = username_to_cid.get(username)
    if not cid:
        return None
    return norm_mac, cid


def _process_mikrotik_server(server, mac_to_cid, username_to_cid):
    """একটি Mikrotik server-এর active session থেকে MAC↔client link; returns added count।
    Client.mac_address auto-save/self-correct করে (খালি থাকা বা swap হওয়া উভয় ক্ষেত্রে)।

    আগে শুধু mac_address='' থাকলেই লেখা হতো, আর mac_to_cid seed dict-এ ইতিমধ্যে
    কোনো (সম্ভবত stale) entry থাকলে সেটা override হতো না — router/CPE swap
    (client A-এর পুরনো device client B-কে reissue) হলে B-এর লাইভ, username-
    verified PPPoE session থাকা সত্ত্বেও ONU port A-এর নামে link হতেই থাকত।
    এখন লাইভ session (username দিয়ে verified, তাই বেশি বিশ্বাসযোগ্য) সবসময়
    stale static mac_address override করে, এবং পুরনো owner-এর mac_address
    clear করে দেয় (নইলে দুই client একই MAC দেখাত)।
    """
    from mikrotik_app.services.mikrotik_service import MikrotikService
    from clients.models import Client
    try:
        svc = MikrotikService.from_server_model(server)
        sessions = svc.get_active_connections()
    except Exception as exc:
        _logger.warning('Mikrotik caller-id fetch failed (%s): %s', server.host, exc)
        return 0

    added = 0
    live_links = []   # (cid, norm_mac) — username-verified, তাই authoritative
    for session in sessions:
        link = _session_mac_link(session, username_to_cid)
        if link is None:
            continue
        norm_mac, cid = link
        if mac_to_cid.get(norm_mac) != cid:
            mac_to_cid[norm_mac] = cid
            added += 1
        live_links.append((cid, norm_mac))

    # DB self-correct: প্রতিটা live-verified (client, mac) pair-এর জন্য
    # Client.mac_address আপডেট করো (খালি বা আগের ভিন্ন মান — উভয় ক্ষেত্রেই),
    # এবং সেই MAC যদি অন্য কোনো client-এর কাছে stale থেকে থাকে তা clear করো।
    for cid, norm_mac in live_links:
        try:
            Client.objects.filter(mac_address=norm_mac).exclude(pk=cid).update(mac_address='')
            Client.objects.filter(pk=cid).exclude(mac_address=norm_mac).update(mac_address=norm_mac)
        except Exception:
            pass
    return added


def _fetch_mikrotik_caller_ids(mac_to_cid: dict, username_to_cid: dict) -> int:
    """
    Mikrotik RouterOS API থেকে সব active PPPoE session-এর caller-id (router/CPE MAC) নিয়ে
    mac_to_cid map-এ যোগ করে। Client.mac_address খালি থাকলে auto-save করে।
    Returns: কতটি নতুন MAC-client link পাওয়া গেছে
    """
    from mikrotik_app.models import MikrotikServer
    try:
        servers = list(MikrotikServer.objects.filter(is_active=True))
    except Exception as exc:
        _logger.warning('Mikrotik server list error: %s', exc)
        return 0

    added = sum(
        _process_mikrotik_server(server, mac_to_cid, username_to_cid)
        for server in servers
    )
    _logger.info('Mikrotik caller-id: %d নতুন MAC-client link', added)
    return added


def _baseline_mac_to_cid():
    """Client.mac_address (normalized) → client id map।"""
    from clients.models import Client
    from olt_mgmt.services.snmp_service import SNMPService
    mac_to_cid = {}
    for c in Client.objects.values('id', 'mac_address'):
        mac = SNMPService.normalize_mac(c.get('mac_address') or '')
        if mac:
            mac_to_cid[mac] = c['id']
    return mac_to_cid


def _baseline_rx_from_mac_cache(rx_map):
    """OLTMacCache (client FK, rx আছে) → rx_map (str client_id key, first-wins)।"""
    for row in (
        OLTMacCache.objects
        .filter(client__isnull=False, rx_power_dbm__isnull=False)
        .select_related('olt')
    ):
        cid = str(row.client_id)
        if cid not in rx_map:
            iface = f'{row.port}/{row.onu}' if row.port and row.onu else (row.port or row.onu or '')
            rx_map[cid] = {
                'rx':      row.rx_power_dbm,
                'status':  _signal_status(row.rx_power_dbm),
                'olt':     row.olt.display_name if row.olt else '',
                'iface':   str(iface),
                'updated': str(row.learned_at or ''),
                'source':  'mac_cache',
            }


def _client_mac_rx_entry(row):
    """OLTMacCache row → rx_map entry dict (source=client_mac)।"""
    rx = row.rx_power_dbm
    iface = f'{row.port}/{row.onu}' if row.port and row.onu else (row.port or row.onu or '')
    return {
        'rx':      rx,
        'status':  _signal_status(rx) if rx is not None else 'offline',
        'olt':     row.olt.display_name if row.olt else '',
        'iface':   str(iface),
        'updated': str(row.learned_at or ''),
        'source':  'client_mac',
    }


def _baseline_rx_from_client_mac(rx_map, mac_to_cid):
    """OLTMacCache.client_mac → mac_to_cid ম্যাচ করে rx_map (mac_cache entry override করে)।"""
    from olt_mgmt.services.snmp_service import SNMPService
    for row in (
        OLTMacCache.objects
        .exclude(client_mac='').exclude(client_mac__isnull=True)
        .select_related('olt')
    ):
        norm = SNMPService.normalize_mac(row.client_mac)
        cid_int = mac_to_cid.get(norm) if norm else None
        if not cid_int:
            continue
        str_cid = str(cid_int)
        ex = rx_map.get(str_cid)
        if ex and ex.get('source') not in ('mac_cache',):
            continue
        rx_map[str_cid] = _client_mac_rx_entry(row)


def _baseline_rx_from_signal(rx_map):
    """ONUSignal (client link) → rx_map (highest priority — সবসময় override)।"""
    for sig in (
        ONUSignal.objects
        .filter(client__isnull=False, rx_power__isnull=False)
        .select_related('olt')
    ):
        cid = str(sig.client_id)
        rx_map[cid] = {
            'rx':      sig.rx_power,
            'status':  sig.signal_status or _signal_status(sig.rx_power),
            'olt':     sig.olt.display_name if sig.olt else '',
            'iface':   sig.interface_id or '',
            'updated': str(sig.last_updated or ''),
            'source':  'signal',
        }


def _do_db_baseline():
    """
    শুধু DB থেকে last-known RX values return করে — কোনো SNMP চালায় না।
    কাজ মিলিসেকেন্ডে শেষ হয়, তাই live_client_rx-এর প্রথম-fresh request-এ
    blocking SNMP-এর বদলে এটা ব্যবহার করা হয়।
    Returns: payload dict {rx, count, snmp_olts: 0, matched: 0}
    """
    mac_to_cid = _baseline_mac_to_cid()
    rx_map = {}
    _baseline_rx_from_mac_cache(rx_map)                 # 1. mac_cache (lowest)
    _baseline_rx_from_client_mac(rx_map, mac_to_cid)    # 2. client_mac match
    _baseline_rx_from_signal(rx_map)                    # 3. signal (highest)
    return {
        'rx':        rx_map,
        'count':     len(rx_map),
        'snmp_olts': 0,
        'matched':   0,
    }


def _live_rx_entry(ex, rx, olt_name, iface, now_str, keep_update_iface=True):
    """live SNMP result → rx_map entry (source='live_snmp')।
    rx থাকলে fresh; rx None কিন্তু ex-এ ভালো rx থাকলে পুরনো rx রাখে; নাহলে offline।
    keep_update_iface=False হলে rx-রাখা branch-এ iface পরিবর্তন করে না (direct-match আচরণ)।"""
    if rx is not None:
        return {
            'rx':      rx,
            'status':  _signal_status(rx),
            'olt':     olt_name,
            'iface':   iface,
            'updated': now_str,
            'source':  'live_snmp',
        }
    if ex and ex.get('rx') is not None:
        # SNMP rx=null কিন্তু DB-তে ভালো rx আছে — overwrite করো না, পুরনো rx রাখো
        entry = {**ex, 'olt': olt_name, 'source': 'live_snmp'}
        if keep_update_iface:
            entry['iface'] = iface
        return entry
    return {
        'rx':      None,
        'status':  'offline',
        'olt':     olt_name,
        'iface':   iface,
        'updated': now_str,
        'source':  'live_snmp',
    }


def _scan_olt_snmp(olt):
    """একটি OLT SNMP walk (onu list + bridge map parallel); returns (olt, onu_rows, cpe_map, err)।"""
    from olt_mgmt.services.snmp_service import SNMPService
    from concurrent.futures import ThreadPoolExecutor
    try:
        service = SNMPService.from_olt_model(olt)
        with ThreadPoolExecutor(max_workers=2) as inner:
            f_onu    = inner.submit(service.get_onu_list)
            f_bridge = inner.submit(service.get_cpe_mac_to_onu_map)
            onu_rows    = f_onu.result()
            cpe_onu_map = f_bridge.result()
        return olt, onu_rows, cpe_onu_map, None
    except Exception as exc:
        return olt, [], {}, exc


def _resolve_onu_rx_mac(olt, onu_row, port, onu_id):
    """onu_row থাকলে সেখান থেকে, নইলে OLTMacCache DB থেকে (rx_power_dbm, normalized onu_mac)।"""
    from olt_mgmt.services.snmp_service import SNMPService
    if onu_row:
        return onu_row.get('rx_power_dbm'), SNMPService.normalize_mac(onu_row.get('mac') or '')
    db_entry = OLTMacCache.objects.filter(olt=olt, port=port, onu=onu_id).first()
    return (db_entry.rx_power_dbm if db_entry else None), (db_entry.mac if db_entry else '')


def _update_client_rx_if_needed(rx_map, cid, rx, olt_name, iface, now_str, keep_update_iface):
    """client-এর rx_map entry live_snmp না থাকলে সেট করে True (matched) ফেরায়, নইলে False।"""
    str_cid = str(cid)
    ex = rx_map.get(str_cid)
    if not ex or ex.get('source') != 'live_snmp':
        rx_map[str_cid] = _live_rx_entry(ex, rx, olt_name, iface, now_str,
                                         keep_update_iface=keep_update_iface)
        return True
    return False


def _apply_bridge_matches(rx_map, olt, cpe_onu_map, onu_by_pos, mac_to_cid, now, now_str):
    """Bridge table (cpe_mac → onu location) দিয়ে client RX match; returns matched count।"""
    matched = 0
    for cpe_mac, onu_loc in cpe_onu_map.items():
        cid = mac_to_cid.get(cpe_mac)
        if not cid:
            continue
        port, onu_id, iface = onu_loc['port'], onu_loc['onu'], onu_loc['iface']
        onu_row = onu_by_pos.get((port, onu_id))
        rx, onu_mac = _resolve_onu_rx_mac(olt, onu_row, port, onu_id)
        if _update_client_rx_if_needed(rx_map, cid, rx, olt.display_name, iface, now_str, True):
            matched += 1
        if onu_mac:
            _try_update_mac_cache(olt, onu_row or {}, onu_mac, cid, now, client_mac=cpe_mac)
    return matched


def _apply_onu_matched_row(rx_map, olt, row, cid, norm_mac, now, now_str):
    """matched ONU row → rx_map update + mac cache; returns 1 (matched) বা 0।"""
    port   = str(row.get('port') or '')
    onu_id = str(row.get('onu') or '')
    iface  = f'{port}/{onu_id}' if port and onu_id else ''
    m = 1 if _update_client_rx_if_needed(
        rx_map, cid, row.get('rx_power_dbm'), olt.display_name, iface, now_str, False) else 0
    _try_update_mac_cache(olt, row, norm_mac, cid, now)
    return m


def _apply_onu_mac_matches(rx_map, olt, onu_rows, mac_to_cid, now, now_str):
    """ONU MAC সরাসরি client MAC-এর সাথে match; returns matched count।"""
    from olt_mgmt.services.snmp_service import SNMPService
    matched = 0
    for row in onu_rows:
        norm_mac = SNMPService.normalize_mac(row.get('mac') or '')
        cid      = mac_to_cid.get(norm_mac) if norm_mac else None
        if cid:
            matched += _apply_onu_matched_row(rx_map, olt, row, cid, norm_mac, now, now_str)
        elif norm_mac:
            _try_update_mac_cache(olt, row, norm_mac, None, now)
    return matched


def _live_snmp_scan(rx_map, mac_to_cid, active_olts, now, now_str):
    """সব active OLT parallel SNMP walk করে rx_map live update; returns (scanned, matched)।"""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    scanned = 0
    matched = 0
    with ThreadPoolExecutor(max_workers=max(len(active_olts), 1)) as pool:
        futures = {pool.submit(_scan_olt_snmp, olt): olt for olt in active_olts}
        for fut in as_completed(futures):
            olt, onu_rows, cpe_onu_map, err = fut.result()
            if err:
                _logger.warning('_do_live_rx_compute: OLT "%s" SNMP error — %s', olt.name, err)
                continue
            scanned += 1
            onu_by_pos = {}
            for row in onu_rows:
                key = (str(row.get('port') or ''), str(row.get('onu') or ''))
                onu_by_pos[key] = row
            matched += _apply_bridge_matches(rx_map, olt, cpe_onu_map, onu_by_pos, mac_to_cid, now, now_str)
            matched += _apply_onu_mac_matches(rx_map, olt, onu_rows, mac_to_cid, now, now_str)
    return scanned, matched


def _do_live_rx_compute():
    """
    সব active OLT SNMP walk করে client RX power বের করে।
    live_client_rx view এবং background thread দুটোই এই helper call করে।
    Returns: payload dict  {rx, count, snmp_olts, matched}
    """
    from django.db import close_old_connections
    from clients.models import Client
    from olt_mgmt.services.snmp_service import SNMPService

    close_old_connections()   # background thread-এ পুরনো DB connection বন্ধ করো

    mac_to_cid      = {}
    username_to_cid = {}
    for c in Client.objects.values('id', 'mac_address', 'username'):
        uname = (c.get('username') or '').lower().strip()
        if uname:
            username_to_cid[uname] = c['id']
        mac = SNMPService.normalize_mac(c.get('mac_address') or '')
        if mac:
            mac_to_cid[mac] = c['id']

    _fetch_mikrotik_caller_ids(mac_to_cid, username_to_cid)

    rx_map  = {}
    now     = timezone.now()
    now_str = now.isoformat()

    # ── DB baseline (mac_cache < client_mac < signal) — _do_db_baseline-এর সাথে অভিন্ন ──
    _baseline_rx_from_mac_cache(rx_map)
    _baseline_rx_from_client_mac(rx_map, mac_to_cid)
    _baseline_rx_from_signal(rx_map)

    # ── Live SNMP scan ───────────────────────────────────────────────────
    active_olts = list(OLT.objects.filter(is_active=True))
    if not mac_to_cid:
        _logger.info('_do_live_rx_compute: mac_to_cid ফাঁকা — SNMP skip')
        snmp_olts_scanned, live_matched = 0, 0
    else:
        snmp_olts_scanned, live_matched = _live_snmp_scan(
            rx_map, mac_to_cid, active_olts, now, now_str)

    return {
        'rx':        rx_map,
        'count':     len(rx_map),
        'snmp_olts': snmp_olts_scanned,
        'matched':   live_matched,
    }


# Cache constants
_LIVE_RX_CACHE_KEY = 'live_client_rx_v4'
_LIVE_RX_STALE_KEY = 'live_client_rx_v4_stale'   # পুরনো data — 10 মিনিট
_LIVE_RX_LOCK_KEY  = 'live_client_rx_refreshing'  # background refresh lock
_LIVE_RX_TTL       = 60    # 1 মিনিট fresh cache
_LIVE_RX_STALE_TTL = 600   # 10 মিনিট stale cache
_LIVE_RX_LOCK_TTL  = 180   # 3 মিনিট lock (SNMP walk timeout=90s এর দ্বিগুণ)


@api_view(['GET'])
@_perm_cls([_IsAuth])
def live_client_rx(request):
    """
    সব active OLT থেকে live SNMP walk করে client-এর router MAC দিয়ে auto-match করে।

    Instant-return pattern (কখনোই block করে না):
      - Fresh cache (2 min) থাকলে → তুরন্ত return
      - Stale cache (10 min) থাকলে → stale data তুরন্ত return + bg SNMP refresh
      - কোনো cache নেই → DB baseline তুরন্ত return + bg SNMP refresh

    ?force=1 দিলে cache bypass করে blocking SNMP চালায়।
    """
    from django.core.cache import cache

    force = request.query_params.get('force', '').lower() in ('1', 'true', 'yes')

    def _kick_bg_refresh():
        """একটিমাত্র background thread চালু করো (lock দিয়ে duplicate avoid)।"""
        if cache.get(_LIVE_RX_LOCK_KEY):
            return
        cache.set(_LIVE_RX_LOCK_KEY, True, _LIVE_RX_LOCK_TTL)

        def _bg_refresh():
            try:
                payload = _do_live_rx_compute()
                cache.set(_LIVE_RX_CACHE_KEY, payload, _LIVE_RX_TTL)
                cache.set(_LIVE_RX_STALE_KEY, payload, _LIVE_RX_STALE_TTL)
                _logger.info('live_client_rx: background refresh সম্পন্ন, matched=%d', payload.get('matched', 0))
            except Exception as exc:
                _logger.exception('live_client_rx: background refresh error — %s', exc)
            finally:
                cache.delete(_LIVE_RX_LOCK_KEY)

        _threading.Thread(target=_bg_refresh, daemon=True).start()

    if not force:
        # ── Fresh cache → তুরন্ত return ────────────────────────────────
        cached = cache.get(_LIVE_RX_CACHE_KEY)
        if cached is not None:
            return Response({**cached, 'cached': True})

        # ── Stale cache → তুরন্ত return + bg refresh ──────────────────
        stale = cache.get(_LIVE_RX_STALE_KEY)
        if stale is not None:
            _kick_bg_refresh()
            return Response({**stale, 'cached': True, 'stale': True})

        # ── কোনো cache নেই → DB baseline তুরন্ত return + bg SNMP ──────
        # blocking SNMP-এ user-কে ৯০-১৮০s অপেক্ষা করানো হবে না
        _kick_bg_refresh()
        baseline = _do_db_baseline()
        return Response({**baseline, 'cached': False, 'baseline': True})

    # ── force=1 → blocking compute ─────────────────────────────────────
    payload = _do_live_rx_compute()
    cache.set(_LIVE_RX_CACHE_KEY, payload, _LIVE_RX_TTL)
    cache.set(_LIVE_RX_STALE_KEY, payload, _LIVE_RX_STALE_TTL)
    cache.delete(_LIVE_RX_LOCK_KEY)   # lock থাকলে clear করো
    return Response({**payload, 'cached': False})


# Device sync/log endpoint HTTP request-এর ভেতরেই synchronously চলে (web-UI
# scrape সাধারণত ১.৫-৮.৩s, তবে বড় OLT-এ বেশিও হতে পারে)। পুরোপুরি Celery-তে
# সরালে frontend contract (তাৎক্ষণিক response) বদলে যেত, তাই কম-ঝুঁকির fix:
# একই OLT-এ concurrent heavy scrape আটকানো — একজন user বারবার ক্লিক করলে বা
# একাধিক client_id একই OLT-এ হলে, দ্বিতীয় request সাথে সাথে reject হয়
# (gunicorn worker exhaustion/self-DoS প্রতিরোধ করতে)।
# নোট: cache key-তে এখনো 'telnet' শব্দটি আছে (Telnet সরানোর আগের), ইচ্ছাকৃতভাবে
# অপরিবর্তিত — deploy-এর সময় চলমান lock গুলো যাতে অক্ষত থাকে।
_TELNET_LOCK_TTL = 40  # seconds — সাধারণ operation duration-এর চেয়ে বেশি


def _olt_device_lock_acquire(olt_id):
    """একই OLT-এ একসাথে একাধিক heavy device-scrape আটকায় (self-DoS প্রতিরোধ)।
    আগে নাম ছিল _olt_telnet_lock_* — Telnet সরানোর পর generic করা হয়েছে,
    cache key অপরিবর্তিত রাখা হয়েছে যাতে চলমান lock গুলো অক্ষত থাকে।"""
    from django.core.cache import cache
    key = f'olt_telnet_lock:{olt_id}'
    try:
        # cache.add() atomic — শুধু key না থাকলে সেট করে, race-safe lock
        return cache.add(key, True, timeout=_TELNET_LOCK_TTL)
    except Exception:
        return True   # cache backend down হলে fail-open — feature পুরোপুরি বন্ধ না হয়ে যায়


def _olt_device_lock_release(olt_id):
    from django.core.cache import cache
    try:
        cache.delete(f'olt_telnet_lock:{olt_id}')
    except Exception:
        pass


def _fetch_onu_status_rows(olt, select: str = '255'):
    """
    OLT web UI-র ONU Status Info পেজ থেকে ONU registration history rows;
    সফল হলে (rows, None), fail হলে (None, error_response)।

    আগে এটা Telnet-এ `show onu status all` চালাত। HTTP-তে সরানো হয়েছে
    (2026-07-20) — মেপে দেখা গেছে 1.50s/73 rows বনাম Telnet 12s+/44 rows,
    এবং row dict-এর shape হুবহু এক (parse_onu_status_table-এর মতো)।

    একই OLT-এ concurrent heavy scrape আটকাতে lock — না পেলে 429।
    """
    from olt_mgmt.services.http_service import fetch_onu_status_from_http

    if not olt.username or not olt.password:
        return None, Response({'error': 'OLT-এ username ও password সেট করুন।'}, status=400)

    if not _olt_device_lock_acquire(olt.id):
        return None, Response(
            {'error': 'এই OLT-এ ইতিমধ্যে একটা sync চলছে, একটু পর আবার চেষ্টা করুন।'},
            status=429,
        )
    try:
        rows = fetch_onu_status_from_http(olt, timeout=30, select=select)
    except Exception as exc:
        _logger.warning('olt_onu_log: HTTP error (%s): %s', olt.ip_address, exc)
        return None, Response({'error': f'OLT web UI সংযোগ ব্যর্থ: {exc}'}, status=503)
    finally:
        _olt_device_lock_release(olt.id)

    if not rows:
        return None, Response(
            {'error': 'OLT web UI (ONU Status Info) থেকে ONU তালিকা পাওয়া যায়নি।'},
            status=503,
        )
    return rows, None


def _match_onu_row(rows, onu_mac, port, onu_num):
    """rows-এ ONU খুঁজে matched row — প্রথমে MAC, না পেলে port+onu_num fallback; None হতে পারে।"""
    from olt_mgmt.services.snmp_service import SNMPService
    norm_onu_mac = SNMPService.normalize_mac(onu_mac)
    for row in rows:
        if SNMPService.normalize_mac(row['mac']) == norm_onu_mac:
            return row
    # fallback: port + onu_num দিয়ে match
    if port and onu_num:
        clean_port = port.replace(' ', '').lower()
        for row in rows:
            row_port = row['port'].replace(' ', '').lower()
            if row['onu_num'] == onu_num and row_port == clean_port:
                return row
    return None


def _onu_target_from_signal(signal_id):
    """
    ONUSignal pk → (target_dict, error_response)। ONU Monitoring পেজের জন্য —
    ওখানে বেশিরভাগ ONU কোনো client-এর সাথে linked নয়, তাই client_id দিয়ে
    lookup করা যায় না; interface_id + raw_data['mac'] দিয়েই সরাসরি খুঁজি।
    """
    sig = ONUSignal.objects.select_related('olt').filter(pk=signal_id).first()
    if not sig or not sig.olt:
        return None, Response({'error': 'ONU signal row পাওয়া যায়নি'}, status=404)

    # 'EPON 0/01/5' → port='EPON 0/01', onu_num='5'
    iface = (sig.interface_id or '').strip()
    cut = iface.rfind('/')
    port, onu_num = (iface[:cut].strip(), iface[cut + 1:].strip()) if cut != -1 else (iface, '')

    return {
        'olt': sig.olt,
        'onu_mac': ((sig.raw_data or {}).get('mac') or '').lower().strip(),
        'port': port,
        'onu_num': onu_num,
        'cache_key': f'onu_log_sig_{signal_id}',
    }, None


def _onu_target_from_client(client_id):
    """client pk → (target_dict, error_response)। mac_cache-এর সর্বশেষ row ব্যবহার করে।"""
    mac_row = (
        OLTMacCache.objects
        .filter(client_id=client_id)
        .select_related('olt')
        .order_by('-learned_at')
        .first()
    )
    if not mac_row or not mac_row.olt:
        return None, Response({'error': 'এই client-এর OLT/ONU mapping পাওয়া যায়নি'}, status=404)

    return {
        'olt': mac_row.olt,
        'onu_mac': (mac_row.mac or '').lower().strip(),
        'port': (mac_row.port or '').strip(),
        'onu_num': (mac_row.onu or '').strip(),
        'cache_key': f'onu_log_{client_id}',
    }, None


@api_view(['GET'])
@_perm_cls([_IsAuth])
def olt_onu_log(request):
    """
    ONU রেজিস্ট্রেশন ইতিহাস — OLT Telnet `show onu status all` থেকে।

    ?client_id=13   → client-এর linked ONU (Online Clients Monitoring)
    ?signal_id=42   → সরাসরি ONUSignal row (ONU Monitoring; unlinked ONU-তেও কাজ করে)

    Response: {
      onu_id, status, mac, distance_m, rtt,
      last_reg, last_dereg, dereg_reason, alive_time,
      olt_name, cached
    }
    """
    from django.core.cache import cache

    client_id = request.query_params.get('client_id', '').strip()
    signal_id = request.query_params.get('signal_id', '').strip()

    if signal_id:
        target, err = _onu_target_from_signal(signal_id)
    elif client_id:
        target, err = _onu_target_from_client(client_id)
    else:
        return Response({'error': 'client_id বা signal_id প্রয়োজন'}, status=400)
    if err is not None:
        return err

    cached = cache.get(target['cache_key'])
    if cached is not None:
        return Response({**cached, 'cached': True})

    olt     = target['olt']
    onu_mac = target['onu_mac']
    port    = target['port']
    onu_num = target['onu_num']
    cache_key = target['cache_key']

    rows, err = _fetch_onu_status_rows(olt)
    if err is not None:
        return err

    matched = _match_onu_row(rows, onu_mac, port, onu_num)
    if not matched:
        return Response({'error': f'ONU (MAC={onu_mac}) status table-এ পাওয়া যায়নি'}, status=404)

    payload = {
        'onu_id':       matched['onu_id'],
        'status':       matched['status'],
        'mac':          matched['mac'],
        'distance_m':   matched['distance_m'],
        'rtt':          matched['rtt'],
        'last_reg':     matched['last_reg'],
        'last_dereg':   matched['last_dereg'],
        'dereg_reason': matched['dereg_reason'],
        'alive_time':   matched['alive_time'],
        'olt_name':     olt.display_name,
    }
    cache.set(cache_key, payload, 60)   # 60s cache
    return Response({**payload, 'cached': False})


def _try_update_mac_cache(olt, row, norm_mac, client_id, now, client_mac=None):
    """
    OLTMacCache row upsert।
    norm_mac  = ONU hardware MAC (primary key)
    client_mac = CPE/router MAC (bridge table থেকে পাওয়া, আলাদা field-এ save)
    """
    try:
        defaults = {
            'vendor':       row.get('vendor') or olt.vendor or '',
            'port':         str(row.get('port') or ''),
            'onu':          str(row.get('onu') or ''),
            'status':       row.get('status') or (
                'offline' if row.get('rx_power_dbm') is None else 'online'
            ),
            'rx_power_dbm': row.get('rx_power_dbm'),
            'description':  str(row.get('description') or '')[:255],
            'learned_at':   now,
            'raw_data':     {k: v for k, v in row.items() if k != 'raw_data'},
        }
        if client_id is not None:
            defaults['client_id'] = client_id
        if client_mac:
            defaults['client_mac']            = client_mac
            defaults['client_mac_learned_at'] = now
        OLTMacCache.objects.update_or_create(olt=olt, mac=norm_mac, defaults=defaults)
    except Exception as exc:
        _logger.warning('_try_update_mac_cache: %s', exc)
