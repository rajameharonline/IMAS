# OLT-এর SNMP subtree walk করে কোন OID-এ কী ডেটা আছে দেখায় — TX power/temperature/
# voltage/ONU type ইত্যাদির সঠিক OID খুঁজে বের করতে।
#
# কেন দরকার: V-SOL firmware-ভেদে এসব OID আলাদা। অনুমান না করে আসল ডিভাইসে walk করে
# মিলিয়ে নেওয়াই নিরাপদ — এই কমান্ডের output শেয়ার করলে exact OID গুলো wire করা যাবে।
#
# চালানো:
#   python manage.py snmp_discover 192.168.130.2
#   python manage.py snmp_discover 192.168.130.2 --oid 1.3.6.1.4.1.37950.1.1.5.12 --limit 60
#   python manage.py snmp_discover <olt_id> --community public
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'OLT-এর SNMP subtree walk করে OID→value দেখায় (TX/temp/voltage OID খুঁজতে)।'

    # V-SOL ONU তথ্যের base subtree। optical table (12.2.1.8.1) discover করে map করা:
    #   col .3=temp, .4=voltage, .5=bias, .6=TX power, .7=RX power।
    # পুরো 12.2 walk বড় (timeout হয়) — তাই নির্দিষ্ট column probe।
    DEFAULT_BASES = [
        ('ONU info (12.1.12.x)',     '1.3.6.1.4.1.37950.1.1.5.12.1.12'),
        ('Optical temp (.8.1.3)',    '1.3.6.1.4.1.37950.1.1.5.12.2.1.8.1.3'),
        ('Optical voltage (.8.1.4)', '1.3.6.1.4.1.37950.1.1.5.12.2.1.8.1.4'),
        ('Optical TX (.8.1.6)',      '1.3.6.1.4.1.37950.1.1.5.12.2.1.8.1.6'),
    ]

    def add_arguments(self, parser):
        parser.add_argument('olt', help='OLT id, name, বা IP address')
        parser.add_argument('--community', default='', help='SNMP community (default: OLT-এর সেটিং)')
        parser.add_argument('--oid', default='', help='নির্দিষ্ট base OID walk (default: V-SOL ONU subtree)')
        parser.add_argument('--limit', type=int, default=40, help='প্রতি subtree সর্বোচ্চ কত row দেখাবে')

    def handle(self, *args, **opts):
        from olt_mgmt.models import OLT
        from olt_mgmt.services.snmp_service import SNMPService

        key = str(opts['olt'])
        olt = None
        if key.isdigit():
            olt = OLT.objects.filter(pk=int(key)).first()
        if not olt:
            olt = OLT.objects.filter(ip_address=key).first()
        if not olt:
            olt = OLT.objects.filter(name__icontains=key).first()
        if not olt:
            self.stderr.write(self.style.ERROR(f'OLT পাওয়া যায়নি: {key}'))
            return

        community = opts['community'] or olt.snmp_community or 'public'
        svc = SNMPService(host=str(olt.ip_address), community=community)
        self.stdout.write(self.style.SUCCESS(
            f'Discover {olt.name} ({olt.ip_address}) community={community}'))

        bases = [('custom', opts['oid'])] if opts['oid'] else self.DEFAULT_BASES
        for label, base in bases:
            self.stdout.write(self.style.HTTP_INFO(f'\n── {label}: {base} ──'))
            rows = svc._walk(base)
            if not rows:
                self.stdout.write('  (কোনো ডেটা নেই / OID supported নয়)')
                continue
            # column (base-এর পরের প্রথম index) অনুযায়ী group — কোন column কী, বুঝতে
            self.stdout.write(f'  মোট {len(rows)} row। নমুনা:')
            shown = 0
            for r in rows:
                if shown >= opts['limit']:
                    self.stdout.write(f'  … আরও {len(rows) - shown} row')
                    break
                oid = r.get('oid', '')
                val = (r.get('value', '') or '')[:60]
                self.stdout.write(f'  {oid} = {val}')
                shown += 1

        self.stdout.write(self.style.SUCCESS(
            '\nএই output শেয়ার করুন — TX power/temperature/voltage/ONU-type OID গুলো '
            'চিহ্নিত করে wire করে দেওয়া হবে।'))
