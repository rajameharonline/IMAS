# MAC address → device brand/vendor lookup।
#
# কৌশল (robust + self-maintaining):
#   ১. MAC-এর প্রথম ৩ বাইট (OUI) বের করি — এটাই manufacturer নির্ধারণ করে।
#   ২. প্রচলিত brand হলে built-in COMMON_OUI থেকে instant (offline) উত্তর।
#   ৩. নাহলে DB cache (MacVendor table) দেখি।
#   ৪. তাও না থাকলে macvendors.com থেকে একবার এনে DB-তে cache করি — পরের বার
#      থেকে instant/offline। ব্যর্থ হলে খালি string (UI '—' দেখাবে)।
#
# কেন external API প্রতিবার নয়: একই OUI একবারই lookup হয়, এরপর DB-তে থাকে।
# তাই rate-limit বা latency সমস্যা হয় না; warm-up-এর পর পুরোপুরি offline চলে।
import re
import logging

logger = logging.getLogger(__name__)

# প্রচলিত ISP CPE/router brand-এর কিছু OUI — instant offline hit-এর জন্য seed।
# (বাকি সব OUI প্রথম দর্শনে online এনে DB-তে জমা হয়।)
COMMON_OUI = {
    'C83A35': 'Tenda',   'D83214': 'Tenda',   '0495E6': 'Tenda',
    '50C7BF': 'TP-Link', '14CC20': 'TP-Link', 'A42BB0': 'TP-Link', '6032B1': 'TP-Link',
    '4C5E0C': 'MikroTik','6C3B6B': 'MikroTik','488F5A': 'MikroTik','18FD74': 'MikroTik',
    '64D154': 'MikroTik','2CC81B': 'MikroTik','DC2C6E': 'MikroTik','CC2DE0': 'MikroTik',
    '44A56E': 'NETGEAR',
    '001E58': 'D-Link',  '1CBDB9': 'D-Link',
    'F8D111': 'TP-Link',
}


def normalize_oui(mac: str) -> str:
    """MAC string থেকে ৬-অক্ষরের uppercase OUI বের করে (e.g. '44:A5:6E:..' → '44A56E')।"""
    if not mac:
        return ''
    hex_only = re.sub(r'[^0-9A-Fa-f]', '', mac).upper()
    return hex_only[:6] if len(hex_only) >= 6 else ''


def lookup_vendor(mac: str) -> str:
    """MAC থেকে device brand/vendor নাম ফেরত দেয় (না পেলে খালি string)।"""
    oui = normalize_oui(mac)
    if not oui:
        return ''

    if oui in COMMON_OUI:
        return COMMON_OUI[oui]

    # DB cache
    try:
        from clients.models import MacVendor
        row = MacVendor.objects.filter(oui=oui).first()
        if row is not None:
            return row.vendor
    except Exception:
        return ''  # DB/migration সমস্যা হলে profile যেন না ভাঙে

    # প্রথমবার — online এনে cache করি
    vendor = _fetch_online(oui)
    try:
        from clients.models import MacVendor
        MacVendor.objects.update_or_create(oui=oui, defaults={'vendor': vendor})
    except Exception:
        pass
    return vendor


def _fetch_online(oui: str) -> str:
    """macvendors.com থেকে OUI-এর vendor আনে (privacy: শুধু OUI পাঠাই, পূর্ণ MAC নয়)।"""
    try:
        import requests
        mac_prefix = ':'.join(oui[i:i + 2] for i in (0, 2, 4))
        r = requests.get(f'https://api.macvendors.com/{mac_prefix}', timeout=2.5)
        if r.status_code == 200:
            return r.text.strip()[:120]
        # 404 = unknown OUI — খালি cache করি যাতে বারবার query না হয়
    except Exception as e:
        logger.warning('MAC vendor online lookup failed for %s: %s', oui, e)
    return ''
