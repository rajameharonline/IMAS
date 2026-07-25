"""
OLT ডিভাইস ডাটা সংগ্রহের একক প্রবেশদ্বার — **HTTP প্রধান, SNMP fallback**।

কেন এই স্তর (2026-07-20):
  আগে caller-রা সরাসরি SNMPService ডাকত। ডিভাইসে মেপে দেখা গেছে HTTP
  web-UI scrape প্রতিটি দিক থেকেই ভালো (192.168.110.2):

    CPE MAC → ONU : HTTP 0.48s/81  বনাম  SNMP 4.89s/81  (৮১/৮১ হুবহু মিল)
    ONU inventory : HTTP 10.9s/73  বনাম  SNMP 17.6s/73  (RX কভারেজ 70/73 উভয়ে)

  তবু SNMP পুরোপুরি ফেলে দেওয়া হয়নি: HTML scrape V-SOL-এর নির্দিষ্ট web UI
  ধরে লেখা। Huawei/ZTE/BDCOM OLT যোগ করলে বা firmware-এ UI বদলালে HTTP
  ভাঙবে — তখন SNMP (স্ট্যান্ডার্ড MIB) স্বয়ংক্রিয়ভাবে দায়িত্ব নেবে।

  প্রতিটি ফাংশন (data, source) রিটার্ন করে — source = 'http' বা 'snmp',
  যাতে লগ/ডিবাগে বোঝা যায় কোন পথে ডাটা এসেছে।
"""
import logging

logger = logging.getLogger(__name__)


def _snmp(olt):
    from olt_mgmt.services.snmp_service import SNMPService
    return SNMPService.from_olt_model(olt)


def _http_usable(olt) -> bool:
    """HTTP scrape-এর জন্য credential আছে কিনা (না থাকলে সরাসরি SNMP)।"""
    return bool(olt.username and olt.password)


# ─── CPE MAC → ONU mapping ───────────────────────────────────────────────────

def fetch_cpe_mac_map(olt) -> tuple[dict, str]:
    """
    CPE/router MAC → ONU mapping — ক্লায়েন্টকে ONU-র সাথে যুক্ত করতে ব্যবহৃত।
    Returns ({normalized_mac: {'port','onu','iface'}}, source)।
    """
    if _http_usable(olt):
        try:
            from olt_mgmt.services.http_service import fetch_cpe_mac_map_from_http
            data = fetch_cpe_mac_map_from_http(olt)
            if data:
                return data, 'http'
            logger.info('cpe_mac_map: HTTP খালি (%s) — SNMP fallback', olt.ip_address)
        except Exception as exc:
            logger.warning('cpe_mac_map: HTTP ব্যর্থ (%s): %s — SNMP fallback', olt.ip_address, exc)

    try:
        return _snmp(olt).get_cpe_mac_to_onu_map(), 'snmp'
    except Exception as exc:
        logger.warning('cpe_mac_map: SNMP-ও ব্যর্থ (%s): %s', olt.ip_address, exc)
        return {}, 'none'


# ─── ONU inventory ───────────────────────────────────────────────────────────

def _http_onu_rows(olt) -> list:
    """
    HTTP (onustatusinfo + opm-diag) → SNMP `get_onu_list()`-এর **হুবহু একই
    row shape**, যাতে `_process_onu_row()` ইত্যাদি caller অপরিবর্তিত থাকে।

    `value` ইচ্ছাকৃতভাবে খালি: SNMP-এ `value` = raw OID string (V-SOL-এ ONU-র
    MAC), আর `_process_onu_row` করে `description = row['description'] or value`
    — ফলে description-এ আসল কিছু না থাকলে MAC বসে যেত। ব্যবহারকারীর
    সিদ্ধান্ত (2026-07-20): Description ডিভাইসে যা আছে **ঠিক তাই** দেখাবে,
    না থাকলে খালি। যাচাই করা হয়েছে HTTP সব আসল description ধরে (1/1 ও 6/6)।
    """
    from olt_mgmt.services.http_service import (
        fetch_onu_status_from_http, fetch_onu_diag_from_http,
    )

    status_rows = fetch_onu_status_from_http(olt)
    if not status_rows:
        return []

    # নোট: opm-diag শুধু **online** ONU-র রিডিং দেয় (ডিভাইসে যাচাই: Kuhruil
    # 62 online → 62 diag, Cholash 22 online → 21 diag, offline-এর সাথে ছেদ ০)।
    # অফলাইন ONU-তে অপটিক্যাল সিগন্যাল নেই, তাই মাপার কিছু নেই — এটা ঘাটতি নয়।
    # (একবার per-port retry দিয়ে "সম্পূর্ণ" করার চেষ্টা করা হয়েছিল; তাতে শুধু
    # ডিভাইসে বাড়তি চাপ ও দেরি হতো, নতুন কোনো row আসত না — তাই সরানো হয়েছে।)
    # timeout উদার রাখা: বড় OLT-এ (Office, 389 ONU) opm-diag ~32s নেয় —
    # default 30s-এ ঠিক সীমান্তে ব্যর্থ হয়ে নীরবে SNMP fallback-এ চলে যেত,
    # ফলে dereg/alive ডাটা আসত না। মাপা মান থেকে যথেষ্ট মার্জিন রাখা হলো।
    diag = fetch_onu_diag_from_http(olt, timeout=90)

    rows = []
    for sr in status_rows:
        # status row-এর port 'EPON 0/01' + onu_num '5' → diag key 'EPON 0/01/5'
        key = f"{sr['port']}/{sr['onu_num']}"
        d = diag.get(key, {})
        rows.append({
            # value খালি — উপরের docstring দেখুন (Description আসল মান-ই দেখাবে)
            'value':         '',
            'oid':           '',
            'port':          sr['port'],
            'onu':           sr['onu_num'],
            'mac':           sr['mac'],
            'status':        sr['status'],
            'description':   d.get('description') or '',
            'distance_m':    sr['distance_m'] or d.get('distance_m'),
            'rx_power_dbm':  d.get('rx_power_dbm'),
            'tx_power_dbm':  d.get('tx_power_dbm'),
            'temperature_c': d.get('temperature_c'),
            'voltage_v':     d.get('voltage_v'),
            'vendor':        olt.vendor or '',
            # ONU registration history — SNMP-এ এগুলো নেই, শুধু HTTP পথে আসে
            'last_dereg_reason': sr.get('dereg_reason') or '',
            'last_reg':          sr.get('last_reg') or '',
            'last_dereg':        sr.get('last_dereg') or '',
            'alive_time':        sr.get('alive_time') or '',
        })
    return rows


def fetch_onu_inventory(olt) -> tuple[list, str]:
    """
    ONU inventory rows (interface, mac, status, rx/tx, distance…)।
    Returns (rows, source)। Row shape = SNMPService.get_onu_list()-এর মতো।
    """
    if _http_usable(olt):
        try:
            rows = _http_onu_rows(olt)
            if rows:
                return rows, 'http'
            logger.info('onu_inventory: HTTP খালি (%s) — SNMP fallback', olt.ip_address)
        except Exception as exc:
            logger.warning('onu_inventory: HTTP ব্যর্থ (%s): %s — SNMP fallback', olt.ip_address, exc)

    try:
        return _snmp(olt).get_onu_list(), 'snmp'
    except Exception as exc:
        logger.warning('onu_inventory: SNMP-ও ব্যর্থ (%s): %s', olt.ip_address, exc)
        return [], 'none'
