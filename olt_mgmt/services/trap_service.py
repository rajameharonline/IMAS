# OLT থেকে আসা SNMP trap পার্স ও শ্রেণিবদ্ধ করার pure-function সার্ভিস।
#
# snmp_trap_listener (pysnmp) প্রতিটি trap-এর varbind তালিকা এখানে পাঠায়; এখান থেকে
# event (link_up/down ইত্যাদি) + interface_id বের হয়। কোনো DB/network ছোঁয়া নেই —
# তাই সহজে unit-test করা যায় এবং পরে V-SOL-specific OID যোগ করা সহজ।
import re

# ── Standard SNMPv2 trap OIDs (RFC 3418) ─────────────────────────────────────
TRAP_OID_VARBIND = '1.3.6.1.6.3.1.1.4.1.0'   # snmpTrapOID.0 — কোন trap সেটা বলে
_STD_TRAPS = {
    '1.3.6.1.6.3.1.1.5.1': 'cold_start',
    '1.3.6.1.6.3.1.1.5.2': 'warm_start',
    '1.3.6.1.6.3.1.1.5.3': 'link_down',
    '1.3.6.1.6.3.1.1.5.4': 'link_up',
    '1.3.6.1.6.3.1.1.5.5': 'auth_fail',
}

# IF-MIB columns — interface শনাক্ত করতে
_IF_DESCR_PREFIX = '1.3.6.1.2.1.2.2.1.2'   # ifDescr
_IF_INDEX_PREFIX = '1.3.6.1.2.1.2.2.1.1'   # ifIndex

# V-SOL enterprise base — এই prefix-এর trap vendor-specific (ONU register/dereg)
_VSOL_ENTERPRISE = '1.3.6.1.4.1.37950'

# register/deregister value-তে যেসব শব্দ ইঙ্গিত দেয়
_REGISTER_HINTS = ('register', 'online', 'link up', 'auth success', 'up')
_DEREG_HINTS = ('dereg', 'deregister', 'offline', 'los', 'link down', 'dying', 'lost', 'down')


def normalize_interface(text: str) -> str:
    """ifDescr/interface string → polling-এর সাথে সামঞ্জস্যপূর্ণ interface_id।

    'EPON0/1:5' / 'EPON0/01:5' / 'EPON01ONU5' / 'epon 0/1:5' → 'EPON 0/01/5'
    (ONUSignal.interface_id format: '<port>/<onu>' যেখানে port='EPON 0/01')।
    মিল না পেলে original (trim) ফেরত।
    """
    t = (text or '').strip()
    if not t:
        return ''
    # Format A: EPON0/1:5  বা  EPON0/01:5  (slash + colon)
    m = re.search(r'[Ee][Pp][Oo][Nn]\s*+(?:\d+/)?(\d++)\s*+[:/]\s*+(\d++)', t)
    if not m:
        # Format B: EPON01ONU5  /  EPON0/1ONU5
        m = re.search(r'[Ee][Pp][Oo][Nn]\s*+(?:\d+/)?(\d++)\s*+[Oo][Nn][Uu]\s*+(\d++)', t)
    if m:
        port_num = int(m.group(1))
        onu_num = m.group(2)
        return f'EPON 0/{port_num:02d}/{onu_num}'
    # GPON variant
    m = re.search(r'[Gg][Pp][Oo][Nn]\s*+(?:\d+/)?(\d++)\s*+[:/]\s*+(\d++)', t)
    if m:
        return f'GPON 0/{int(m.group(1)):02d}/{m.group(2)}'
    return t


def _find_interface(varbinds) -> str:
    """varbind তালিকা থেকে ifDescr খুঁজে interface_id বের করে।"""
    for oid, value in varbinds:
        if str(oid).startswith(_IF_DESCR_PREFIX):
            iface = normalize_interface(value)
            if iface:
                return iface
    # ifDescr না থাকলে value-তে EPON/GPON pattern খুঁজি
    for _oid, value in varbinds:
        if re.search(r'[EeGg][Pp][Oo][Nn]', str(value)):
            iface = normalize_interface(value)
            if iface:
                return iface
    return ''


def classify_trap(varbinds) -> dict:
    """varbinds: list of (oid_str, value_str) → {event, interface_id, trap_oid, summary}।

    - snmpTrapOID.0 দেখে standard event (linkUp/Down/coldStart...)।
    - V-SOL enterprise trap হলে value-র শব্দ দেখে register/dereg অনুমান।
    - interface ifDescr/value থেকে।
    """
    varbinds = [(str(o), str(v)) for o, v in (varbinds or [])]
    trap_oid = ''
    for oid, value in varbinds:
        if oid == TRAP_OID_VARBIND:
            trap_oid = value.strip()
            break

    event = _STD_TRAPS.get(trap_oid, '')
    if not event:
        if trap_oid.startswith(_VSOL_ENTERPRISE):
            # vendor trap — value text দেখে register/dereg অনুমান
            blob = ' '.join(v.lower() for _o, v in varbinds)
            if any(h in blob for h in _DEREG_HINTS):
                event = 'onu_dereg'
            elif any(h in blob for h in _REGISTER_HINTS):
                event = 'onu_register'
            else:
                event = 'unknown'
        else:
            event = 'unknown'

    interface_id = _find_interface(varbinds)

    label = dict([
        ('link_up', 'Link Up'), ('link_down', 'Link Down'),
        ('onu_register', 'ONU Register'), ('onu_dereg', 'ONU Deregister'),
        ('cold_start', 'Cold Start'), ('warm_start', 'Warm Start'),
        ('auth_fail', 'Auth Failure'), ('unknown', 'Unknown trap'),
    ]).get(event, event)
    summary = f"{label}" + (f" — {interface_id}" if interface_id else '')

    return {
        'event': event,
        'interface_id': interface_id,
        'trap_oid': trap_oid,
        'summary': summary[:255],
    }


# event → ONUSignal.signal_status / OLTMacCache.status নির্ধারণ
def event_to_status(event: str):
    """recognized event হলে ('signal_status', 'mac_status') ফেরত; নাহলে (None, None)।"""
    if event in ('link_down', 'onu_dereg'):
        return 'offline', 'offline'
    if event in ('link_up', 'onu_register'):
        return 'good', 'online'
    return None, None
