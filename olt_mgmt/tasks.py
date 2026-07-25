# এই ফাইলটি OLT management-এর background Celery tasks।
# মূল উদ্দেশ্য: সব active OLT-এর MAC table নিয়মিত (প্রতি 5 মিনিট) sync করা
# যাতে ONUSignal table সবসময় fresh থাকে এবং ONU Monitoring page-এ
# auto-refresh-এ latest data দেখায়।
import logging
import re
from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


def _build_cust_map():
    """customer_id (str) → Client.pk map — ONU description-এর leading id দিয়ে link করতে।"""
    from clients.models import Client
    return {
        str(cid): pk for cid, pk in
        Client.objects.exclude(customer_id='').values_list('customer_id', 'id')
    }


def _client_id_from_desc(desc, cust_map):
    """ONU description ("customerID-নাম") শুরুর ২+ অঙ্কের customer_id → client pk।"""
    m = re.match(r'\s*(\d{2,})', str(desc or ''))
    return cust_map.get(m.group(1)) if m else None


def _build_existing_links(olt):
    """OLT-এর সব বিদ্যমান OLTMacCache client link একবারে fetch করে {mac:
    (client_id, source)} dict বানায় — _process_onu_row প্রতি row-তে আলাদা
    query না চালিয়ে এই dict থেকেই lookup করে (N+1 এড়াতে)।"""
    from olt_mgmt.models import OLTMacCache
    return {
        row['mac']: (row['client_id'], row['client_link_source'])
        for row in OLTMacCache.objects.filter(olt=olt).values(
            'mac', 'client_id', 'client_link_source'
        )
    }


def _resolve_client_link(existing_links, mac, desc_client_id):
    """description-based (এই function-এর caller) client link কি বসানো/রাখা/মোছা
    উচিত তা ঠিক করে — link_onu_clients (MAC-based, লাইভ PPPoE session দিয়ে
    verified) যদি ইতিমধ্যে এই MAC-এ link বসিয়ে থাকে, description-based sync
    সেটা কখনো override করবে না (নইলে দুই task প্রতি ৫ মিনিটে একে অপরের
    client_id উল্টে-পাল্টে দিত)। description আর কোনো customer_id-এর সাথে না
    মিললে (client leave/reassign করেছে কিন্তু description আপডেট হয়নি) এবং
    বিদ্যমান link description-based-ই হলে — সেটা clear করে দেয় (স্থায়ীভাবে
    ভুল client-এ আটকে থাকা এড়াতে)।
    Returns (client_id_or_None, source_str)।
    """
    existing_client_id, existing_source = existing_links.get(mac, (None, ''))
    if existing_source == 'mac' and existing_client_id:
        return existing_client_id, 'mac'   # verified MAC-link — অক্ষত রাখো
    if desc_client_id:
        return desc_client_id, 'description'
    return None, ''   # কোনো match নেই — stale description-based link থাকলে clear হবে


def _process_onu_row(olt, service, row, idx, now, cust_map, existing_links):
    """একটি ONU row → OLTMacCache + ONUSignal update_or_create।
    Returns (was_created: bool, interface_id: str, mac: str)।"""
    from olt_mgmt.models import OLTMacCache, ONUSignal
    from olt_mgmt.api.views import _signal_status_from_mac_row
    from types import SimpleNamespace

    value = str(row.get('value') or '').strip()
    oid = str(row.get('oid') or '')
    rx_power = row.get('rx_power_dbm')
    tx_power = row.get('tx_power_dbm')
    distance = row.get('distance_m')
    port = row.get('port') or service.port_from_oid(oid)
    onu = str(row.get('onu') or idx)
    # port/onu (OLT-assigned slot, walk-order নির্বিশেষে স্থিতিশীল) ব্যবহার করে
    # synthetic MAC তৈরি করা হয় — আগে (oid, idx) ব্যবহার হতো, যেটা walk-এ ONU-র
    # position বদলালে (কোনো ONU offline/online, walk order shift) একই physical
    # ONU-র জন্য প্রতিবার ভিন্ন synthetic MAC দিত, ফলে OLTMacCache-এ পুরনো
    # synthetic-MAC row কখনো cleanup না হয়ে phantom row জমে যেত।
    mac = (service.normalize_mac(row.get('mac') or value)
           or service.synthetic_mac_from_identity(olt.id, port, onu))
    description = str(row.get('description') or value)[:255]
    row_status = row.get('status') or (
        'offline' if rx_power is None else 'online'
    )
    # description ("customerID-নাম") থেকে ONU↔Client link — MAC-based link থাকলে override না
    desc_client_id = _client_id_from_desc(description, cust_map)
    client_id, link_source = _resolve_client_link(existing_links, mac, desc_client_id)

    mac_defaults = {
        'vendor': row.get('vendor') or olt.vendor,
        'port': port,
        'onu': onu,
        'status': row_status,
        'description': description,
        'distance_m': distance,
        'rx_power_dbm': rx_power,
        'raw_data': row,
        'learned_at': now,
        'client_id': client_id,             # None হলে stale link clear করে
        'client_link_source': link_source,
    }
    # ONU registration history — শুধু HTTP path-এ আসে (SNMP-এ এই ডাটা নেই)।
    # SNMP fallback-এ চললে key-টাই থাকবে না, তখন পুরনো মান খালি দিয়ে
    # ওভাররাইট না করে অক্ষত রাখা হয় — নইলে fallback-এ গেলেই UI-র
    # "Last Deregister Reason" কলাম ফাঁকা হয়ে যেত।
    dereg_reason = row.get('last_dereg_reason')
    if dereg_reason:
        mac_defaults['last_dereg_reason'] = str(dereg_reason)[:255]
    if row.get('last_dereg'):
        mac_defaults['last_dereg_time_raw'] = str(row['last_dereg'])[:40]
    if row.get('alive_time'):
        mac_defaults['alive_time'] = str(row['alive_time'])[:40]
    _, was_created = OLTMacCache.objects.update_or_create(
        olt=olt, mac=mac, defaults=mac_defaults,
    )

    interface_id = f'{port}/{onu}' if port else onu
    ONUSignal.objects.update_or_create(
        olt=olt,
        interface_id=interface_id,
        defaults={
            'client_id': client_id,
            'rx_power': rx_power,
            'tx_power': tx_power,
            'signal_status': _signal_status_from_mac_row(
                SimpleNamespace(status=row_status, rx_power_dbm=rx_power)
            ),
            'last_updated': now,
            'notes': description,
            # আগে পুরো `row` dict (**row) spread করে OLTMacCache.raw_data-র সাথে
            # প্রায় হুবহু ~400 byte/row duplicate করত, যদিও ONUSignalSerializer
            # (api/serializers.py:get_mac_address) শুধু raw_data['mac'] key-টাই
            # পড়ে — বাকি সব key (oid, vendor, status, distance_m, rx_power_dbm,
            # ইত্যাদি) OLTMacCache-এ আগে থেকেই আছে (দেখুন mac_defaults['raw_data']
            # উপরে) এবং কোথাও ONUSignal.raw_data থেকে পড়া হয় না। এখন
            # _sync_mac_cache_signals()-এর (api/views.py) সাথে সামঞ্জস্যপূর্ণ
            # minimal shape ব্যবহার করা হচ্ছে।
            'raw_data': {'source': 'olt_sync', 'mac': mac, 'status': row_status},
        },
    )
    return was_created, interface_id, mac


# partial/timeout SNMP walk sanity guard — এই sync যদি আগের তুলনায় অনেক কম ONU
# touch করে থাকে (যেমন RX walk আংশিক timeout, SNMP glitch), তাহলে ধরে নেওয়া ঠিক
# না যে বাকি ONU-গুলো সত্যিই disappear করেছে — সেগুলো real, online ONU হতে পারে
# যেগুলো শুধু এই particular sync-এ ধরা পড়েনি। এই threshold-এর নিচে coverage হলে
# cleanup skip করে শুধু warning log করা হয় (আগে unconditionally delete হতো,
# transient SNMP hiccup-এ signal data হারিয়ে যেত)।
_STALE_CLEANUP_MIN_COVERAGE_RATIO = 0.5


def _cleanup_stale_signals(olt, touched_interface_ids):
    """এই sync-এ touch না-হওয়া olt_sync phantom ONUSignal rows মুছে দেয়।
    (যেমন RX walk timeout হলে fallback 'EPON 0/01/N' rows) — তবে এই sync-এর
    coverage আগের তুলনায় সন্দেহজনকভাবে কম হলে (partial/timeout walk) delete
    skip করে শুধু warning log করে, ভুলভাবে real online ONU-র data হারানো এড়াতে।
    """
    from olt_mgmt.models import ONUSignal
    existing_qs = ONUSignal.objects.filter(olt=olt, raw_data__source='olt_sync')
    existing_count = existing_qs.count()
    touched_count = len(touched_interface_ids)

    if existing_count and touched_count < existing_count * _STALE_CLEANUP_MIN_COVERAGE_RATIO:
        logger.warning(
            'OLT auto-sync: %s এই sync-এ মাত্র %d/%d ONU touch হয়েছে (সন্দেহজনক '
            'কম coverage — সম্ভবত partial/timeout SNMP walk) — stale cleanup '
            'SKIP করা হলো, real online ONU-র data মুছে যাওয়া এড়াতে।',
            olt.name, touched_count, existing_count,
        )
        return

    stale_deleted, _ = existing_qs.exclude(interface_id__in=touched_interface_ids).delete()
    if stale_deleted:
        logger.info(
            'OLT auto-sync stale cleanup: %s removed %d phantom rows',
            olt.name, stale_deleted,
        )


def _cleanup_stale_mac_cache(olt, touched_macs):
    """এই sync-এ touch না-হওয়া OLTMacCache row মুছে দেয় (disconnected/re-provisioned
    ONU-র পুরনো MAC entry) — এই টেবিলের আগে কোনো cleanup ছিল না, শুধু upsert হতো,
    ফলে offline হয়ে যাওয়া ONU-র row চিরস্থায়ীভাবে জমে থাকত (storage-review,
    2026-07-19)। _cleanup_stale_signals-এর মতোই coverage-guarded, partial/timeout
    SNMP walk-এ real online ONU-র row ভুলভাবে মুছে যাওয়া এড়াতে।
    """
    from olt_mgmt.models import OLTMacCache
    existing_qs = OLTMacCache.objects.filter(olt=olt)
    existing_count = existing_qs.count()
    touched_count = len(touched_macs)

    if existing_count and touched_count < existing_count * _STALE_CLEANUP_MIN_COVERAGE_RATIO:
        logger.warning(
            'OLT auto-sync mac-cache cleanup: %s এই sync-এ মাত্র %d/%d MAC touch '
            'হয়েছে (সন্দেহজনক কম coverage) — cleanup SKIP করা হলো, real online '
            'ONU-র data মুছে যাওয়া এড়াতে।',
            olt.name, touched_count, existing_count,
        )
        return

    stale_deleted, _ = existing_qs.exclude(mac__in=touched_macs).delete()
    if stale_deleted:
        logger.info(
            'OLT auto-sync mac-cache cleanup: %s removed %d stale MAC rows',
            olt.name, stale_deleted,
        )


def _sync_one_olt(olt, cust_map):
    """একটি OLT sync (SNMP → OLTMacCache/ONUSignal) → item dict {name, ok, count, error}।"""
    from olt_mgmt.services.snmp_service import SNMPService
    from olt_mgmt.services import device_service
    item = {'name': olt.name, 'ok': False, 'count': 0, 'error': None}
    try:
        # HTTP প্রধান, ব্যর্থ হলে SNMP fallback (device_service দেখুন)।
        # `service` শুধু static helper (normalize_mac/port_from_oid/
        # synthetic_mac_*) দেওয়ার জন্য — উভয় path-এ একই।
        service = SNMPService.from_olt_model(olt)
        rows, _src = device_service.fetch_onu_inventory(olt)
        now = timezone.now()
        created = updated = 0
        existing_links = _build_existing_links(olt)

        touched_interface_ids = set()
        touched_macs = set()
        for idx, row in enumerate(rows[:500], start=1):
            was_created, interface_id, mac = _process_onu_row(
                olt, service, row, idx, now, cust_map, existing_links)
            created += int(was_created)
            updated += int(not was_created)
            touched_interface_ids.add(interface_id)
            touched_macs.add(mac)

        _cleanup_stale_signals(olt, touched_interface_ids)
        _cleanup_stale_mac_cache(olt, touched_macs)

        count = created + updated
        olt.last_sync_at = now
        olt.last_sync_status = 'success'
        olt.last_sync_count = count
        olt.last_sync_message = f'Auto-sync: {count} row processed.'
        olt.save(update_fields=[
            'last_sync_at', 'last_sync_status',
            'last_sync_count', 'last_sync_message',
        ])
        item.update({'ok': True, 'count': count})
        logger.info('OLT auto-sync ok: %s (%d rows)', olt.name, count)
    except Exception as exc:
        olt.last_sync_at = timezone.now()
        olt.last_sync_status = 'failed'
        olt.last_sync_message = str(exc)[:500]
        olt.save(update_fields=[
            'last_sync_at', 'last_sync_status', 'last_sync_message',
        ])
        item['error'] = str(exc)[:300]
        logger.exception('OLT auto-sync failed: %s — %s', olt.name, exc)
    return item


@shared_task(name='olt_mgmt.sync_all_olts_mac_table')
def sync_all_olts_mac_table():
    """সব active OLT-এর জন্য sync-mac-table action-এর equivalent।

    কেন আলাদা task: ONU Monitoring page-এর manual "Refresh Signals" বাটন
    সরিয়ে দেওয়ার পর, OLT থেকে fresh data backend-এ আনার জন্য নিয়মিত
    automatic process দরকার ছিল। প্রতি 5 মিনিট interval-এ এই task চলে।

    Per-OLT flow (sync_mac_table action-এর সাথে সমান):
      1. device_service.fetch_onu_inventory() — HTTP web-UI প্রধান,
         ব্যর্থ/non-VSOL হলে SNMP fallback
      2. প্রতিটি row → OLTMacCache update_or_create
      3. প্রতিটি row → ONUSignal update_or_create (signal_status decide)
      4. OLT.last_sync_at/status/count/message update

    Returns: {'olts': [{name, ok, count, error}], 'total': n}

    Parallel sync: প্রতিটা OLT sequentially চললে (walk_timeout up to 180s/OLT)
    একাধিক ধীর/অনুপলব্ধ OLT থাকলে মোট সময় ৫-মিনিট schedule interval ছাড়িয়ে
    যেতে পারত — celery beat তখন আগের run শেষ হওয়ার আগেই নতুন run enqueue করত
    (overlapping run race)। SNMP walk subprocess.run()-এ blocking I/O (GIL
    release করে), তাই ThreadPoolExecutor দিয়ে OLT-গুলো parallel-এ sync করা
    নিরাপদ এবং কার্যকর — প্রতিটা OLT independent row set-এ কাজ করে বলে race
    নেই। (celery.group ব্যবহার না করার কারণ: broker/Redis অনুপলব্ধ থাকলেও এই
    approach কাজ করে, কারণ এটা একই task-এর ভেতরে থ্রেড, আলাদা task dispatch না)।
    """
    from olt_mgmt.models import OLT
    from concurrent.futures import ThreadPoolExecutor
    from django.db import connection as _db_connection

    # ONU description = "customerID-নাম" (যেমন "5107-Mehdi") — তাই leading customer_id দিয়ে
    # ONU↔Client link করি (একবার map তৈরি, প্রতি ONU-তে নয় — efficient)।
    cust_map = _build_cust_map()

    olts = list(OLT.objects.filter(is_active=True))
    if not olts:
        return {'olts': [], 'total': 0}

    def _sync_and_close(olt):
        try:
            return _sync_one_olt(olt, cust_map)
        finally:
            # প্রতিটা thread-এর নিজস্ব DB connection হয় — explicit close না করলে
            # idle connection thread pool-এর আয়ুষ্কাল ধরে জমে থাকতে পারে
            _db_connection.close()

    with ThreadPoolExecutor(max_workers=min(len(olts), 5)) as executor:
        results = list(executor.map(_sync_and_close, olts))

    return {'olts': results, 'total': len(results)}


@shared_task(name='olt_mgmt.link_onu_clients')
def link_onu_clients():
    """ONU ↔ Client MAC-ভিত্তিক auto-link (Monitoring-এর Client/Zone কলামের জন্য)।

    চেইন: MikroTik active session caller-id → Client.mac_address (auto-save) →
          OLT bridge table (CPE MAC → ONU interface) → ONUSignal/OLTMacCache.client।
    ৫-মিনিট RX sync ধীর না করতে এটি আলাদা (কম ঘনঘন) চলে — client↔ONU সম্পর্ক কম বদলায়।
    """
    from olt_mgmt.models import OLT, ONUSignal, OLTMacCache
    from olt_mgmt.services.snmp_service import SNMPService
    from clients.models import Client

    # debounce lock ছেড়ে দিই — task চলার পর নতুন client-change আবার enqueue করতে পারবে
    try:
        from django.core.cache import cache
        cache.delete('olt_link_pending')
    except Exception:
        pass

    # username/MAC → client_id map; MikroTik থেকে caller-id refresh (Client.mac_address auto-save)
    username_to_cid = {
        u.lower().strip(): cid
        for u, cid in Client.objects.exclude(username='').values_list('username', 'id')
    }
    mac_to_cid = {}
    for c in Client.objects.exclude(mac_address='').values('id', 'mac_address'):
        m = SNMPService.normalize_mac(c.get('mac_address') or '')
        if m:
            mac_to_cid[m] = c['id']
    try:
        from olt_mgmt.api.views import _fetch_mikrotik_caller_ids
        _fetch_mikrotik_caller_ids(mac_to_cid, username_to_cid)
    except Exception as exc:
        logger.warning('link_onu_clients: mikrotik caller-id refresh failed: %s', exc)

    linked = 0
    for olt in OLT.objects.filter(is_active=True):
        try:
            from olt_mgmt.services import device_service
            # HTTP macinfo.html প্রধান, ব্যর্থ হলে SNMP bridge table
            cpe_map, _src = device_service.fetch_cpe_mac_map(olt)   # {cpe_mac: {port, onu, iface}}
        except Exception as exc:
            logger.warning('link_onu_clients: bridge map failed (%s): %s', olt.name, exc)
            continue
        for cpe_mac, info in cpe_map.items():
            cid = mac_to_cid.get(cpe_mac)
            if not cid:
                continue
            iface = f"{info['port']}/{info['onu']}"
            n = ONUSignal.objects.filter(olt=olt, interface_id=iface).update(client_id=cid)
            # source='mac' — এই link লাইভ PPPoE session দিয়ে verified, তাই পরের
            # description-based auto-sync (৫ মিনিট পরপর) এটা override করবে না
            # (দেখুন _resolve_client_link, tasks.py)।
            OLTMacCache.objects.filter(
                olt=olt, port=info['port'], onu=info['onu']
            ).update(client_id=cid, client_link_source='mac')
            linked += n

    logger.info('link_onu_clients: %d ONUSignal linked to clients', linked)
    return {'linked': linked, 'clients_with_mac': len(mac_to_cid)}


# নোট: OLT ঘড়ি sync-এর কোনো Celery task নেই — ব্যবহারকারীর সিদ্ধান্ত
# (2026-07-20) অনুযায়ী সময় সেট **শুধু ম্যানুয়ালি** হবে, OLT Management
# পেজের "Time" বাটন থেকে (OLTViewSet.sync_clock → cli_service.sync_olt_clock)।
