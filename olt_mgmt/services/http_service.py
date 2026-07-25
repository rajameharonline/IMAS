"""
V-SOL OLT HTTP(S) Web-UI Scrape Service
কিছু OLT ইউনিটের Telnet CLI-তে PON/ONU diagnostic কমান্ড এক্সপোজ করা থাকে না
(শুধু L2 switch কমান্ড থাকে), কিন্তু একই ডেটা web management UI-এর
"ONU OPM Diag" পেজে (onuopmdiag.html) পাওয়া যায়। এই সার্ভিস সেই পেজ
login করে scrape করে RX power বের করে — Telnet fail করলে fallback হিসেবে।
"""
import logging
import re

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logger = logging.getLogger(__name__)

_ROW_RE = re.compile(
    r"<tr><td class='hd'>((?:EPON|GPON)\d+/(\d+):(\d+))</td>(.*?)</tr>",
    re.S | re.I,
)
_TD_RE = re.compile(r'<td[^>]*>(.*?)</td>', re.S)


def _login(session: requests.Session, base_url: str, username: str, password: str) -> bool:
    resp = session.post(
        f'{base_url}/action/main.html',
        data={'user': username, 'pass': password, 'who': '100'},
        timeout=10,
        verify=False,
    )
    if resp.status_code != 200 or 'Sorry' in resp.text:
        return False
    return True


# systeminfo.html-এ System Name থাকে: <input name=hostname id=hostname value="Office-olt" type="text" />
_HOSTNAME_RE = re.compile(r'<input[^>]*\bname=["\']?hostname["\']?[^>]*\bvalue="([^"]*)"', re.I)


def fetch_system_name_from_http(olt, timeout: int = 10) -> str:
    """
    OLT-এর web UI-তে login করে Device Information (systeminfo.html) পেজ থেকে
    ডিভাইসের আসল System Name (hostname) পড়ে।
    Returns: 'Kuhruil-epon-olt' — না পেলে '' (কখনো exception raise করে না)।
    """
    host = str(olt.ip_address)
    base_url = f'https://{host}'
    session = requests.Session()

    try:
        if not _login(session, base_url, str(olt.username or ''), olt.get_decrypted_password()):
            logger.warning(f"[{host}] system name: লগইন ব্যর্থ")
            return ''

        resp = session.get(f'{base_url}/action/systeminfo.html', timeout=timeout, verify=False)
        if resp.status_code != 200:
            logger.warning(f"[{host}] system name: page status {resp.status_code}")
            return ''

        m = _HOSTNAME_RE.search(resp.text)
        if not m:
            logger.warning(f"[{host}] system name: hostname ফিল্ড পাওয়া যায়নি")
            return ''

        name = m.group(1).strip()
        logger.info(f"[{host}] system name পাওয়া গেছে: {name!r}")
        return name
    except requests.RequestException as exc:
        logger.warning(f"[{host}] system name fetch error: {exc}")
        return ''


# onustatusinfo.html-এর row: <tr><td class='hd'>EPON0/1:1</td><td>Online</td>…
_STATUS_ROW_RE = re.compile(r"<tr><td class='hd'>((?:EPON|GPON)\d+/\d+:\d+)</td>(.*?)</tr>", re.S | re.I)
_TAG_RE = re.compile(r'<[^>]+>')


def _cell_text(raw: str) -> str:
    """HTML সেল → plain text (tag + &nbsp; সরিয়ে)।"""
    return _TAG_RE.sub('', raw).replace('&nbsp;', ' ').strip()


def _parse_onu_status_html(html: str) -> list:
    """
    onustatusinfo.html টেবিল → row dicts — telnet `show onu status all`-এর
    parse_onu_status_table()-এর সাথে **হুবহু একই shape**, যাতে caller
    (_match_onu_row / olt_onu_log) অপরিবর্তিত থাকে।

    কলাম ক্রম (ডিভাইসে যাচাই করা):
      0 ONU-ID · 1 Status · 2 MAC · 3 Description(খালি) · 4 Distance ·
      5 RTT · 6 LastRegTime · 7 LastDeregTime · 8 DeregReason · 9 AliveTime · 10 Upgrade

    সতর্কতা: telnet আউটপুটে index-3 (Description) কলামটি নেই, তাই এখানে
    Distance/RTT একঘর ডানে — positional mapping সেভাবেই করা হয়েছে।
    """
    rows = []
    for onu_id, rest in _STATUS_ROW_RE.findall(html):
        cells = [_cell_text(c) for c in _TD_RE.findall(rest)]
        if len(cells) < 8:      # Status..DeregReason পর্যন্ত না থাকলে row অসম্পূর্ণ
            continue

        m = re.match(r'^(EPON|GPON)(\d+)/(\d+):(\d+)$', onu_id, re.I)
        if not m:
            continue
        family, slot, onu_num = m.group(1).upper(), int(m.group(3)), int(m.group(4))

        def cell(i):
            return cells[i] if i < len(cells) else ''

        rows.append({
            'onu_id':       f'{family}0/{slot}:{onu_num}',
            'port':         f'{family} 0/{slot:02d}',
            'onu_num':      str(onu_num),
            'status':       cell(0).lower(),
            'mac':          cell(1).lower(),
            'distance_m':   cell(3),
            'rtt':          cell(4),
            'last_reg':     cell(5),
            'last_dereg':   cell(6),
            'dereg_reason': cell(7),
            'alive_time':   cell(8),
        })

    logger.info(f"http onu-status parsed {len(rows)} ONU rows")
    return rows


def fetch_onu_status_from_http(olt, timeout: int = 30, select: str = '255') -> list:
    """
    OLT web UI-র ONU Status Info পেজ scrape করে ONU registration history আনে —
    telnet `show onu status all`-এর প্রতিস্থাপন (একই row shape)।

    select: '255' = সব PON port, বা নির্দিষ্ট port নম্বর।
    Returns: [{'onu_id','port','onu_num','status','mac','distance_m','rtt',
               'last_reg','last_dereg','dereg_reason','alive_time'}, ...]
    """
    host = str(olt.ip_address)
    base_url = f'https://{host}'
    session = requests.Session()

    try:
        if not _login(session, base_url, str(olt.username or ''), olt.get_decrypted_password()):
            logger.warning(f"[{host}] HTTP onu-status: লগইন ব্যর্থ")
            return []

        resp = session.post(
            f'{base_url}/action/onustatusinfo.html',
            data={'select': select, 'who': '100'},
            timeout=timeout,
            verify=False,
        )
        if resp.status_code != 200:
            logger.warning(f"[{host}] HTTP onu-status: page status {resp.status_code}")
            return []

        return _parse_onu_status_html(resp.text)
    except requests.RequestException as exc:
        logger.warning(f"[{host}] HTTP onu-status fetch error: {exc}")
        return []


def _parse_opm_diag_html(html: str) -> dict:
    """
    onuopmdiag.html টেবিল থেকে RX power বের করে।
    কলাম অর্ডার: ONU ID, MAC, Description, Distance, Temp, Voltage, TXBias, TXPower, RXPower
    """
    result = {}
    for onu_id, slot, onu, rest in _ROW_RE.findall(html):
        cells = _TD_RE.findall(rest)
        if not cells:
            continue
        rx_text = cells[-1].strip()
        try:
            rx_raw = float(rx_text)
        except ValueError:
            continue
        if not (-60.0 <= rx_raw <= 10.0):
            logger.debug(f"http opm-diag RX out of range: {rx_raw} ({onu_id})")
            continue
        family = 'GPON' if onu_id.upper().startswith('GPON') else 'EPON'
        iface_key = f"{family} 0/{int(slot):02d}/{int(onu)}"
        result[iface_key] = rx_raw

    logger.info(f"http opm-diag parsed {len(result)} ONU RX values")
    return result


def select_code_for_interface(interface_id) -> str | None:
    """
    'EPON 0/01/5' → '1' — onuopmdiag.html-এর `select` কোড (PON port নম্বর)।

    পুরো OLT স্ক্যান (select=255) না করে শুধু ওই ONU-র PON port আনার জন্য।
    মাপা হয়েছে (192.168.110.2): select=255 → 8.30s/62 ONU, বনাম
    select=1 → 2.65s/15 ONU, select=3 → 0.11s/3 ONU। parse করা না গেলে None।
    """
    m = re.search(r'/(\d+)/', str(interface_id or ''))
    return str(int(m.group(1))) if m else None


# macinfo.html row: [VLAN ID, MAC Address, Type, Port ID]; Port ID = 'EPON0/1:5' হলে ONU-র
_MAC_PORT_RE = re.compile(r'^(EPON|GPON)(\d+)/(\d+):(\d+)$', re.I)


def fetch_cpe_mac_map_from_http(olt, timeout: int = 30) -> dict:
    """
    OLT-এর L2 MAC forwarding table (macinfo.html) scrape করে
    CPE/router MAC → ONU mapping আনে — SNMP `get_cpe_mac_to_onu_map()`-এর
    **হুবহু একই shape**, তাই caller অপরিবর্তিত থাকে।

    ডিভাইসে যাচাই (192.168.110.2): HTTP 0.48s/81 এন্ট্রি বনাম SNMP 4.89s/81 —
    ৮১টির ৮১টিই একই ONU-তে ম্যাপ করেছে।

    Returns: {normalized_cpe_mac: {'port': 'EPON 0/01', 'onu': '5', 'iface': 'EPON0/1:5'}}
    """
    from olt_mgmt.services.snmp_service import SNMPService  # শুধু normalize_mac static helper

    host = str(olt.ip_address)
    base_url = f'https://{host}'
    session = requests.Session()

    try:
        if not _login(session, base_url, str(olt.username or ''), olt.get_decrypted_password()):
            logger.warning(f"[{host}] HTTP mac-table: লগইন ব্যর্থ")
            return {}

        resp = session.post(f'{base_url}/action/macinfo.html',
                            data={'who': '100'}, timeout=timeout, verify=False)
        if resp.status_code != 200:
            logger.warning(f"[{host}] HTTP mac-table: page status {resp.status_code}")
            return {}

        result = {}
        for row_html in re.findall(r'<tr[^>]*>(.*?)</tr>', resp.text, re.S):
            cells = [_cell_text(c) for c in _TD_RE.findall(row_html)]
            if len(cells) != 4:
                continue
            m = _MAC_PORT_RE.match(cells[3])
            if not m:      # GE1/CPU ইত্যাদি uplink port — ONU নয়, বাদ
                continue
            mac = SNMPService.normalize_mac(cells[1])
            if not mac:
                continue
            family, slot, onu = m.group(1).upper(), int(m.group(3)), str(int(m.group(4)))
            result[mac] = {
                'port':  f'{family} 0/{slot:02d}',
                'onu':   onu,
                'iface': f'{family}0/{slot}:{onu}',
            }

        logger.info(f"[{host}] HTTP mac-table OK: {len(result)} CPE MAC→ONU")
        return result
    except requests.RequestException as exc:
        logger.warning(f"[{host}] HTTP mac-table fetch error: {exc}")
        return {}


def fetch_onu_diag_from_http(olt, timeout: int = 30, select: str = '255') -> dict:
    """
    ONU OPM Diag পেজের **সব** কলাম আনে (শুধু RX নয়)।

    কলাম: ONU ID · MAC · Description · Distance(m) · Temperature(°C) ·
          Supply Voltage(V) · TX Bias(mA) · TX Power(dBm) · RX Power(dBm)

    Returns: {'EPON 0/01/5': {'mac','description','distance_m','temperature_c',
                              'voltage_v','tx_power_dbm','rx_power_dbm'}, ...}
    """
    host = str(olt.ip_address)
    base_url = f'https://{host}'
    session = requests.Session()

    def _num(text):
        try:
            return float(str(text).strip())
        except (TypeError, ValueError):
            return None

    try:
        if not _login(session, base_url, str(olt.username or ''), olt.get_decrypted_password()):
            return {}
        resp = session.post(
            f'{base_url}/action/onuopmdiag.html',
            data={'select': select, 'port_refresh': 'Refresh', 'who': '100'},
            timeout=timeout, verify=False,
        )
        if resp.status_code != 200:
            return {}

        out = {}
        for onu_id, slot, onu, rest in _ROW_RE.findall(resp.text):
            cells = [_cell_text(c) for c in _TD_RE.findall(rest)]
            if len(cells) < 8:
                continue
            family = 'GPON' if onu_id.upper().startswith('GPON') else 'EPON'
            key = f"{family} 0/{int(slot):02d}/{int(onu)}"
            rx = _num(cells[7])
            out[key] = {
                'mac':           (cells[0] or '').lower(),
                'description':   cells[1],
                'distance_m':    cells[2],
                'temperature_c': _num(cells[3]),
                'voltage_v':     _num(cells[4]),
                'tx_power_dbm':  _num(cells[6]),
                # RX range guard — opm-diag কখনো আজগুবি মান দেয়
                'rx_power_dbm':  rx if (rx is not None and -60.0 <= rx <= 10.0) else None,
            }
        logger.info(f"[{host}] HTTP onu-diag parsed {len(out)} ONU (select={select})")
        return out
    except requests.RequestException as exc:
        logger.warning(f"[{host}] HTTP onu-diag fetch error: {exc}")
        return {}


def fetch_rx_from_http(olt, timeout: int = 15, select: str = '255') -> dict:
    """
    OLT-এর web UI-তে login করে ONU OPM Diag পেজ scrape করে RX power আনে।
    Telnet-এ ONU command না থাকা OLT ইউনিটের জন্য fallback।

    select: '255' = সব PON port (default), বা নির্দিষ্ট port নম্বর ('1', '2'…)
            — select_code_for_interface() দিয়ে বের করুন।
    Returns: {'EPON 0/01/16': -29.21, ...}
    """
    host = str(olt.ip_address)
    username = str(olt.username or '')
    password = olt.get_decrypted_password()
    base_url = f'https://{host}'

    session = requests.Session()

    try:
        if not _login(session, base_url, username, password):
            logger.warning(f"[{host}] HTTP opm-diag: লগইন ব্যর্থ")
            return {}

        resp = session.post(
            f'{base_url}/action/onuopmdiag.html',
            data={'select': select, 'port_refresh': 'Refresh', 'who': '100'},
            timeout=timeout,
            verify=False,
        )
        if resp.status_code != 200:
            logger.warning(f"[{host}] HTTP opm-diag: page status {resp.status_code}")
            return {}

        rx_map = _parse_opm_diag_html(resp.text)
        if rx_map:
            logger.info(f"[{host}] HTTP opm-diag OK (select={select}): {len(rx_map)} ONU entries")
        return rx_map
    except requests.RequestException as exc:
        logger.exception(f"HTTP RX fetch error ({host}): {exc}")
        return {}
