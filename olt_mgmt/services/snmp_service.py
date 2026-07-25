import logging
import hashlib
import re
import subprocess

logger = logging.getLogger(__name__)

# ─── V-SOL RX Power OID candidates ───────────────────────────────────────────
# পুরনো ফার্মওয়্যার: STRING format  → "(-25.50 dBm)" বা "-25.50 dBm"
# নতুন ফার্মওয়্যার: Integer32 format → -2550  (মানে ÷100 = -25.50 dBm)
VSOL_RX_OIDS = [
    '1.3.6.1.4.1.37950.1.1.5.12.2.1.8.1.7',   # V1 — পুরনো firmware
    '1.3.6.1.4.1.37950.1.1.5.12.2.2.2.1.7',   # V2 variant-A
    '1.3.6.1.4.1.37950.1.1.5.12.2.1.10.1.7',  # V2 variant-B
]

# V-SOL ONU optical diagnostics টেবিল (12.2.1.8.1) — discover করে নিশ্চিত করা হয়েছে:
#   col .3 = temperature ("51.87 C"), .4 = voltage ("3.27 V"),
#   col .5 = bias current ("9.61 mA"), .6 = TX power ("1.64 mW (2.15 dBm)"),
#   col .7 = RX power (উপরে)।
VSOL_TX_OID = '1.3.6.1.4.1.37950.1.1.5.12.2.1.8.1.6'
# temperature/voltage walk করি (bias .5 কম দরকারি — sync গতি বাঁচাতে বাদ)
VSOL_DIAG_OIDS = {
    'temperature_c': '1.3.6.1.4.1.37950.1.1.5.12.2.1.8.1.3',
    'voltage_v':     '1.3.6.1.4.1.37950.1.1.5.12.2.1.8.1.4',
}

# valid dBm range for ONU optical power: -60 to +10 dBm
_DBM_MIN = -60.0
_DBM_MAX = 10.0



# পুনরাবৃত্ত literal — S1192 এড়াতে module constant
_NUM_RE = r'-?\d+(?:\.\d+)?'

class SNMPService:
    def __init__(self, host: str, community: str = 'public', version: str = '2c'):
        # OLT SNMP connection সেটআপ
        self.host = host
        self.community = community
        self.vendor = ''
        self.fw_version = 'auto'   # 'auto' | 'v1' | 'v2'
        self.rx_snmp_oid = ''      # custom OID override (ফাঁকা = default)
        self.tx_snmp_oid = ''      # TX power OID override (ফাঁকা = V-SOL default)
        self.with_optical_diag = True   # temperature/voltage/bias walk করবে কিনা
        # SNMP walk subprocess timeout (seconds)
        # ছোট OLT (৮০ ONU): ৩০s; বড় OLT (৩৯৫+ ONU): slow হলে ৯০s+ লাগে — 180s margin
        self.walk_timeout = 180

    def _get(self, oid: str):
        # SNMP GET request পাঠানো হচ্ছে নির্দিষ্ট OID-এর জন্য
        try:
            proc = subprocess.run(
                ['snmpget', '-v2c', '-c', self.community, '-t', '4', '-r', '1', self.host, oid],
                text=True,
                capture_output=True,
                timeout=8,
                check=False,
            )
            if proc.returncode != 0:
                logger.error(f"SNMP GET error ({self.host}, {oid}): {proc.stderr.strip()}")
                return None
            parsed = self._parse_cli_line(proc.stdout.strip())
            return parsed.get('value') if parsed else None
        except Exception as e:
            logger.exception(f"SNMP GET error ({self.host}, {oid}): {e}")
            return None

    def _walk(self, oid: str, timeout: int = None) -> list:
        """
        SNMP WALK — নির্দিষ্ট OID tree-র সব value আনে।
        timeout: subprocess max wait (seconds). None = self.walk_timeout ব্যবহার করে।
        বড় OLT (৩০০+ ONU)-তে walk ৩০-৬০s লাগতে পারে, তাই timeout বাড়ানো হয়েছে।
        """
        results = []
        t = timeout if timeout is not None else self.walk_timeout
        snmp_t = min(8, t // 4)  # per-request SNMP timeout (subprocess timeout-এর ১/৪)
        try:
            proc = subprocess.run(
                ['snmpwalk', '-v2c', '-c', self.community,
                 '-t', str(snmp_t), '-r', '1', self.host, oid],
                text=True,
                capture_output=True,
                timeout=t,
                check=False,
            )
            if proc.returncode != 0:
                logger.error(f"SNMP WALK error ({self.host}, {oid}): {proc.stderr.strip()}")
                return results
            for line in proc.stdout.splitlines():
                parsed = self._parse_cli_line(line)
                if parsed:
                    results.append(parsed)
        except subprocess.TimeoutExpired as e:
            # timeout হলেও capture_output=True থাকায় e.stdout-এ ততক্ষণে যা পড়া
            # হয়েছিল তা থাকে — আগে এটা ignore করে খালি list রিটার্ন হতো, ফলে বড়
            # OLT-এ ৯০% হয়ে যাওয়া walk-ও timeout-এ পুরোপুরি বাদ পড়ে যেত (partial
            # হলেও data থাকা সত্ত্বেও)। এখন partial output থেকে যতটুকু পার্স করা যায়
            # তা ব্যবহার করা হচ্ছে।
            partial = e.stdout or ''
            if partial:
                logger.warning(
                    f"SNMP WALK timeout ({self.host}, {oid}) — partial output "
                    f"ব্যবহার হচ্ছে ({len(partial.splitlines())} lines captured)"
                )
                for line in partial.splitlines():
                    parsed = self._parse_cli_line(line)
                    if parsed:
                        results.append(parsed)
            else:
                logger.exception(f"SNMP WALK timeout, কোনো partial data নেই ({self.host}, {oid}): {e}")
        except Exception as e:
            logger.exception(f"SNMP WALK error ({self.host}): {e}")
        return results

    # SNMP error/empty responses যেগুলো real data নয়
    _SNMP_NON_DATA = (
        'no such object',
        'no such instance',
        'end of mib',
        'end of mib view',
        'no more variables',
    )

    @classmethod
    def _parse_cli_line(cls, line: str):
        if not line or ' = ' not in line:
            return None
        oid, raw = line.split(' = ', 1)
        value = raw
        if ': ' in raw:
            _, value = raw.split(': ', 1)
        value = value.strip().strip('"')
        # SNMP error response ফিল্টার — real data নয়
        if any(err in value.lower() for err in cls._SNMP_NON_DATA):
            return None
        return {'oid': oid.strip(), 'value': value, 'raw': raw.strip()}

    def get_system_info(self) -> dict:
        # OLT device-এর system তথ্য আনা হচ্ছে
        return {
            'name': self._get('1.3.6.1.2.1.1.5.0'),
            'description': self._get('1.3.6.1.2.1.1.1.0'),
            'uptime': self._get('1.3.6.1.2.1.1.3.0'),
            'location': self._get('1.3.6.1.2.1.1.6.0'),
        }

    def get_onu_list(self) -> list:
        # OLT-এ সংযুক্ত ONU তালিকা আনা হচ্ছে (vendor-specific OID হতে পারে)
        if self.vendor == 'vsol':
            return self.get_vsol_onu_list()
        onu_oid = '1.3.6.1.4.1.2011.6.128.1.1.2.46.1.1'  # Huawei OLT ONU index
        return self._walk(onu_oid)

    # ─── V-SOL RX OID auto-detection ─────────────────────────────────────────
    def _vsol_fetch_rx_rows(self, expected_count: int = 0) -> tuple[list, bool]:
        """
        RX power walk চালায় এবং (rows, is_integer_format) রিটার্ন করে।
        পুরনো firmware: string format  → is_integer_format=False
        নতুন firmware:  integer format → is_integer_format=True (÷100 করতে হবে)

        expected_count = MAC walk থেকে জানা প্রকৃত ONU সংখ্যা (দেওয়া থাকলে)।
        আগে প্রথম non-empty candidate OID পেলেই থেমে যেত — একটা OID variant
        কিছু ONU chip revision-এ partial coverage দিলে বাকি candidate-গুলো আর
        try হতো না, ফলে সেই partial result-কেই "সম্পূর্ণ সফল" ধরে নিয়ে বাকি
        ONU-গুলো ভুলভাবে rx_power=None (offline) দেখাত। এখন সব candidate try
        করে সর্বোচ্চ-coverage (বেশি row) দেওয়া candidate বেছে নেওয়া হয়,
        expected_count-এর কাছাকাছি পৌঁছালে early-exit করে বাকিগুলো skip করে
        (সময় বাঁচাতে)।
        """
        # 1) Custom OID override থাকলে সরাসরি সেটা ব্যবহার করো
        if self.rx_snmp_oid:
            candidate_oids = [self.rx_snmp_oid]
        else:
            # fw_version অনুযায়ী কোন OID গুলো try করব
            if self.fw_version == 'v1':
                candidate_oids = [VSOL_RX_OIDS[0]]
            elif self.fw_version == 'v2':
                candidate_oids = VSOL_RX_OIDS[1:]
            else:  # auto — সব try করো
                candidate_oids = VSOL_RX_OIDS

        best_rows, best_oid = [], None
        for oid in candidate_oids:
            rows = self._walk(oid)
            if not rows:
                logger.info(f"VSOL RX OID returned no rows: {oid} ({self.host})")
                continue
            logger.info(
                f"VSOL RX OID candidate: {oid} ({self.host}) — {len(rows)} rows"
            )
            if len(rows) > len(best_rows):
                best_rows, best_oid = rows, oid
            if expected_count and len(best_rows) >= expected_count:
                break   # প্রত্যাশিত সংখ্যা পেয়ে গেছি — বাকি candidate try করার দরকার নেই

        if not best_rows:
            logger.warning(f"VSOL RX: কোনো OID-এ ডেটা পাওয়া যায়নি ({self.host})")
            return [], False

        if expected_count and len(best_rows) < expected_count:
            logger.warning(
                f"VSOL RX: সেরা candidate ({best_oid}, {self.host}) দিয়েও "
                f"{len(best_rows)}/{expected_count} ONU-এর RX data পাওয়া গেছে — "
                f"বাকি ONU-গুলো rx_power=None (offline) দেখাবে, incomplete walk "
                f"হতে পারে (timeout/partial SNMP response)।"
            )

        is_int_fmt = self._detect_integer_format(best_rows)
        logger.info(
            f"VSOL RX OID selected: {best_oid} ({self.host}) — "
            f"{len(best_rows)} rows, integer_fmt={is_int_fmt}"
        )
        return best_rows, is_int_fmt

    @staticmethod
    def _detect_integer_format(rows: list) -> bool:
        """
        SNMP row-এর value দেখে integer format (÷100 দরকার) কিনা বোঝায়।

        প্রধান signal: numeric text-এ decimal point আছে কিনা — V1 (string dBm)
        ফরম্যাট সবসময় "-25.50"-এর মতো ২-দশমিক float হিসেবে আসে, V2 (Integer32)
        ফরম্যাট কখনো decimal point রাখে না (raw integer, যেমন "-2550" বা
        near-zero signal-এ "-50")।

        আগে শুধু magnitude (abs(v) > 100) দিয়ে সিদ্ধান্ত নেওয়া হতো — এতে
        near-zero (খুব ভালো signal, -1 dBm-এর কাছাকাছি) V2 reading ভুলভাবে
        "string format" (÷100 না করে) ধরে নিত: -0.50 dBm true reading V2-তে
        integer "-50" হিসেবে আসে, কিন্তু abs(-50)=50 ≤ 100 বলে পুরনো কোড
        "integer format না" ভাবত এবং -50-কে সরাসরি dBm হিসেবে store করত
        (আসল -0.50 dBm-এর বদলে ভুলভাবে -50 dBm "critically low" দেখাত) — আর
        range-check (-60 থেকে +10)-ও এটা ধরতে পারত না কারণ -50 নিজেই valid
        range-এর মধ্যে। Decimal-point উপস্থিতি magnitude-নির্বিশেষে সঠিক সিদ্ধান্ত দেয়।
        """
        decimal_votes = 0
        integer_votes = 0
        for row in rows[:10]:
            raw = str(row.get('value') or '')
            if 'dbm' in raw.lower():
                return False   # explicit unit marker → নিশ্চিতভাবে string/already-dBm format
            m = re.search(_NUM_RE, raw)
            if not m:
                continue
            if '.' in m.group(0):
                decimal_votes += 1
            else:
                integer_votes += 1
        if decimal_votes or integer_votes:
            return integer_votes > decimal_votes
        return False

    def _parse_rx_value(self, raw_value: str, is_integer_format: bool) -> float | None:
        """
        RX power string → float dBm।
        is_integer_format=True হলে ÷100 করে।
        """
        v = self.extract_dbm(raw_value)
        if v is None:
            return None
        if is_integer_format:
            v = v / 100.0
        # valid range check
        if not (_DBM_MIN <= v <= _DBM_MAX):
            logger.debug(f"RX power out of range ({v} dBm), raw='{raw_value}' — discarding")
            return None
        return v

    def _vsol_diag_value(self, diag_rows, key, index):
        """optical diagnostics walk থেকে index-তম value (extract_number); না থাকলে None।
        (আগের inline ternary-র হুবহু আচরণ: key/index না থাকলে None)।"""
        rows = diag_rows.get(key, [])
        if index < len(rows):
            return self.extract_number(rows[index]['value'])
        return None

    def _build_vsol_row(self, index, ctx):
        """VSOL walk results (ctx) থেকে index-তম ONU row dict।"""
        mac_rows, desc_rows, distance_rows = ctx['mac'], ctx['desc'], ctx['distance']
        rx_rows, tx_rows, diag_rows = ctx['rx'], ctx['tx'], ctx['diag']
        is_int_fmt, tx_int_fmt = ctx['is_int_fmt'], ctx['tx_int_fmt']

        mac      = mac_rows[index]['value']      if index < len(mac_rows)      else ''
        desc     = desc_rows[index]['value']     if index < len(desc_rows)     else ''
        distance = self._int_value(distance_rows[index]['value']) if index < len(distance_rows) else None
        rx_raw   = rx_rows[index]['value']       if index < len(rx_rows)       else ''
        rx_oid   = rx_rows[index]['oid']         if index < len(rx_rows)       else ''
        tx_raw   = tx_rows[index]['value']       if index < len(tx_rows)       else ''

        rx_power = self._parse_rx_value(rx_raw, is_int_fmt)
        tx_power = self._parse_rx_value(tx_raw, tx_int_fmt) if tx_raw else None
        port, onu = self.vsol_port_onu_from_oid(rx_oid, index)

        return {
            'oid':         mac_rows[index]['oid'] if index < len(mac_rows) else rx_oid,
            'value':       mac or desc or rx_raw,
            'vendor':      'vsol',
            'mac':         self.normalize_mac(mac) or mac,
            'port':        port,
            'onu':         str(onu),
            'description': '' if desc.upper() == 'NULL' else desc,
            'distance_m':  distance,
            'rx_power_dbm': rx_power,
            'tx_power_dbm': tx_power,
            'temperature_c': self._vsol_diag_value(diag_rows, 'temperature_c', index),
            'voltage_v':    self._vsol_diag_value(diag_rows, 'voltage_v', index),
            'status':      'offline' if rx_power is None else 'online',
            'raw_rx':      rx_raw,
            'rx_int_fmt':  is_int_fmt,  # diagnostic তথ্য
        }

    def get_vsol_onu_list(self) -> list:
        oids = {
            'desc':     '1.3.6.1.4.1.37950.1.1.5.12.1.12.1.10',
            'mac':      '1.3.6.1.4.1.37950.1.1.5.12.1.12.1.6',
            'distance': '1.3.6.1.4.1.37950.1.1.5.12.1.12.1.13',
        }
        desc_rows     = self._walk(oids['desc'])
        mac_rows      = self._walk(oids['mac'])
        distance_rows = self._walk(oids['distance'])

        # RX power — auto OID detection সহ; mac_rows-এর সংখ্যা expected_count
        # হিসেবে দিলে partial-coverage candidate detect করা যায়
        rx_rows, is_int_fmt = self._vsol_fetch_rx_rows(expected_count=len(mac_rows))

        # TX power — tx_snmp_oid override নাহলে V-SOL default (12.2.1.8.1.6)
        tx_oid = self.tx_snmp_oid or (VSOL_TX_OID if self.vendor == 'vsol' else '')
        tx_rows, tx_int_fmt = [], False
        if tx_oid:
            tx_rows = self._walk(tx_oid)
            tx_int_fmt = self._detect_integer_format(tx_rows) if tx_rows else False

        # Optical diagnostics — temperature/voltage/bias (V-SOL only)
        diag_rows = {}
        if self.vendor == 'vsol' and self.with_optical_diag:
            for key, oid in VSOL_DIAG_OIDS.items():
                diag_rows[key] = self._walk(oid)

        ctx = {
            'mac': mac_rows, 'desc': desc_rows, 'distance': distance_rows,
            'rx': rx_rows, 'tx': tx_rows, 'diag': diag_rows,
            'is_int_fmt': is_int_fmt, 'tx_int_fmt': tx_int_fmt,
        }
        total = max(len(mac_rows), len(desc_rows), len(rx_rows), len(distance_rows), len(tx_rows))
        return [self._build_vsol_row(index, ctx) for index in range(total)]

    def get_onu_rx_power(self, port: int, onu_id: int) -> float | None:
        # ONU-এর received optical power (dBm) আনা হচ্ছে - signal quality চেক করতে
        try:
            oid = f'1.3.6.1.4.1.2011.6.128.1.1.2.51.1.4.{port}.{onu_id}'
            value = self._get(oid)
            if value:
                return float(value) / 100.0  # মান dBm-এ রূপান্তর
        except Exception as e:
            logger.exception(f"ONU RX power error: {e}")
        return None

    def get_onu_status(self, port: int, onu_id: int) -> str:
        # ONU-এর online/offline status চেক করা হচ্ছে
        try:
            oid = f'1.3.6.1.4.1.2011.6.128.1.1.2.46.1.15.{port}.{onu_id}'
            value = self._get(oid)
            status_map = {'1': 'online', '2': 'offline', '5': 'dying_gasp'}
            return status_map.get(value, 'unknown')
        except Exception as e:
            logger.exception(f"ONU status error: {e}")
            return 'unknown'

    # ─── SNMP Diagnostic: কোন RX OID কাজ করছে খুঁজে বের করা ─────────────────
    def diagnose_rx_oids(self) -> dict:
        """
        সব candidate RX OID walk করে ফলাফল দেয়।
        OLT Admin panel-এর diagnostic endpoint-এ ব্যবহার হবে।
        """
        results = {}
        for oid in VSOL_RX_OIDS:
            rows = self._walk(oid)
            sample = []
            if rows:
                is_int = self._detect_integer_format(rows)
                for r in rows[:3]:
                    raw = r.get('value', '')
                    parsed = self._parse_rx_value(raw, is_int)
                    sample.append({'raw': raw, 'parsed_dbm': parsed})
                results[oid] = {
                    'count': len(rows),
                    'integer_format': is_int,
                    'sample': sample,
                }
            else:
                results[oid] = {'count': 0, 'integer_format': False, 'sample': []}
        return results

    @staticmethod
    def normalize_mac(value: str):
        # আগে "১২+ hex digit থাকলে প্রথম ১২টা নাও" — অর্থাৎ কোনো SNMP value-তে
        # কাকতালীয়ভাবে ১২+ hex-এর মতো character থাকলে (যেমন কোনো concatenated
        # multi-field value বা garbage response) সেটাকে "valid MAC" হিসেবে
        # truncate করে মেনে নিত, ভুল/garbage data-ও silently সঠিক-দেখতে MAC
        # হয়ে যেত। এখন ঠিক ১২টা hex digit না থাকলে reject করে None ফেরত দেয়
        # (caller-এর synthetic_mac fallback-এ যাবে)।
        hex_value = re.sub(r'[^0-9a-fA-F]', '', str(value or ''))
        if len(hex_value) != 12:
            return None
        hex_value = hex_value.lower()
        return ':'.join(hex_value[i:i + 2] for i in range(0, 12, 2))

    @staticmethod
    def synthetic_mac_from_oid(oid: str, index: int) -> str:
        # MD5 এখানে শুধু OID→deterministic synthetic MAC তৈরিতে (non-security hashing),
        # তাই usedforsecurity=False — কোনো credential/integrity যাচাই নয়।
        digest = hashlib.md5(f'{oid}:{index}'.encode(),
                             usedforsecurity=False).hexdigest()[:12]
        return ':'.join(digest[i:i + 2] for i in range(0, 12, 2))

    @staticmethod
    def synthetic_mac_from_identity(olt_id, port: str, onu: str) -> str:
        """MAC-হীন ONU-এর জন্য synthetic MAC — (olt_id, port, onu) থেকে derive করা,
        walk position/index থেকে নয়। আগের synthetic_mac_from_oid(oid, index)
        walk-এ ONU-র position বদলালে (কোনো ONU offline হলে, walk order শিফট
        হলে) একই physical ONU-র জন্য প্রতিবার ভিন্ন synthetic MAC দিত — যেহেতু
        OLTMacCache (olt, mac)-এ unique, প্রতিবার নতুন row তৈরি হতো, পুরনোটা
        কখনো cleanup হতো না (phantom row জমতে থাকত)। port/onu — OLT নিজে যে
        slot-এ ONU register করেছে তার উপর ভিত্তি করে — walk order-নির্বিশেষে
        স্থিতিশীল, তাই এই সমস্যা হয় না।
        """
        digest = hashlib.md5(f'{olt_id}:{port}:{onu}'.encode(),
                             usedforsecurity=False).hexdigest()[:12]
        return ':'.join(digest[i:i + 2] for i in range(0, 12, 2))

    @staticmethod
    def port_from_oid(oid: str) -> str:
        nums = re.findall(r'\d+', str(oid or ''))
        if len(nums) >= 2:
            return f'PON 0/{int(nums[-2]):02d}'
        return 'PON 0/00'

    @staticmethod
    def extract_dbm(value: str):
        # Format 1: (-25.50 dBm)  বা  -25.50 dBm
        match = re.search(r'\((-?\d+(?:\.\d+)?)\s*dBm\)', str(value or ''), re.I)
        if match:
            return float(match.group(1))
        match = re.search(r'(-?\d++(?:\.\d++)?)\s*+dBm', str(value or ''), re.I)
        if match:
            return float(match.group(1))
        # Format 2: raw number (integer বা float)
        match = re.search(_NUM_RE, str(value or ''))
        if match:
            return float(match.group(0))
        return None

    @staticmethod
    def extract_number(value):
        """"51.87 C" / "3.27 V" / "9.61 mA" → float (প্রথম সংখ্যা)। না পেলে None।"""
        match = re.search(_NUM_RE, str(value or ''))
        return float(match.group(0)) if match else None

    @staticmethod
    def _int_value(value):
        match = re.search(r'\d+', str(value or ''))
        return int(match.group(0)) if match else None

    @staticmethod
    def vsol_port_onu_from_oid(oid: str, index: int):
        nums = [int(x) for x in re.findall(r'\d+', str(oid or ''))]
        if len(nums) >= 2:
            return f'EPON 0/{nums[-2]:02d}', nums[-1]
        return 'EPON 0/01', index + 1

    # ─── Standard Bridge MIB — CPE/Router MAC → ONU port matching ───────────────
    def get_bridge_table(self) -> dict:
        """
        Standard Bridge MIB: 1.3.6.1.2.1.17.4.3.1.2 (dot1dTpFdbPort)
        CPE/router MAC (client-এর home router MAC) → bridge port index।
        Returns: {normalized_cpe_mac: bridge_port_index}
        """
        oid = '1.3.6.1.2.1.17.4.3.1.2'
        rows = self._walk(oid, timeout=30)
        mac_port = {}
        for row in rows:
            raw_oid = row.get('oid', '')
            # OID-এর শেষ ৬ segment = MAC address bytes (decimal notation)
            nums = re.findall(r'\d+', raw_oid)
            if len(nums) < 6:
                continue
            mac_bytes = nums[-6:]
            try:
                mac = ':'.join(f'{int(b):02x}' for b in mac_bytes)
                port_idx = int(row.get('value', 0))
            except (ValueError, TypeError):
                continue
            if port_idx > 0:
                mac_port[mac] = port_idx
        logger.info(f"Bridge table ({self.host}): {len(mac_port)} CPE MAC entries")
        return mac_port

    def get_bridge_port_to_ifindex(self) -> dict:
        """
        dot1dBasePortTable: 1.3.6.1.2.1.17.1.4.1.2
        Bridge port index → ifIndex mapping।
        Returns: {bridge_port_int: ifindex_int}
        """
        oid = '1.3.6.1.2.1.17.1.4.1.2'
        rows = self._walk(oid, timeout=15)
        port_ifidx = {}
        for row in rows:
            nums = re.findall(r'\d+', row.get('oid', ''))
            if not nums:
                continue
            bridge_port = int(nums[-1])
            try:
                ifidx = int(row.get('value', 0))
            except (ValueError, TypeError):
                continue
            if ifidx > 0:
                port_ifidx[bridge_port] = ifidx
        return port_ifidx

    def get_if_descr(self) -> dict:
        """
        ifDescr MIB: 1.3.6.1.2.1.2.2.1.2
        ifIndex → interface name (e.g. 'EPON0/1:174')।
        Returns: {ifindex_int: if_name_str}
        """
        oid = '1.3.6.1.2.1.2.2.1.2'
        rows = self._walk(oid, timeout=20)
        idx_name = {}
        for row in rows:
            nums = re.findall(r'\d+', row.get('oid', ''))
            if not nums:
                continue
            ifidx = int(nums[-1])
            idx_name[ifidx] = row.get('value', '')
        return idx_name

    def get_cpe_mac_to_onu_map(self) -> dict:
        """
        CPE/router MAC → ONU (port, onu_id) mapping।
        Bridge table + ifDescr combine করে।

        V-SOL OLT quirk:
          bridge_port_table (17.1.4.1.2) শুধু physical uplink ports রাখে (e.g. 1-24)।
          ONU bridge ports (e.g. 194) সেখানে নেই।
          V-SOL OLT-এ bridge_port value = ifIndex directly।

        Chain:
          cpe_mac → bridge_port (=ifIndex) → ifDescr['EPON04ONU13']
                  → port='EPON 0/04', onu='13'

        Supported ifDescr formats:
          'EPON04ONU13'       ← V-SOL standard
          'EPON04ONU13 desc'  ← V-SOL with description
          'EPON0/4:13'        ← alternative slash format

        Returns: {normalized_cpe_mac: {'port': 'EPON 0/04', 'onu': '13', 'iface': '...'}}
        """
        bridge_mac_port = self.get_bridge_table()
        if not bridge_mac_port:
            logger.info(f"Bridge table empty ({self.host}) — no CPE MAC data")
            return {}

        # bridge port table — শুধু physical ports (V-SOL এ 1-24)
        bridge_port_ifidx = self.get_bridge_port_to_ifindex()
        # ifDescr — ifIndex → interface name
        ifidx_name = self.get_if_descr()

        result = {}
        for mac, bridge_port in bridge_mac_port.items():
            # Standard: bridge_port → ifIndex via port table
            ifidx = bridge_port_ifidx.get(bridge_port)
            # V-SOL fallback: bridge_port IS the ifIndex (ONU virtual interface)
            if not ifidx:
                ifidx = bridge_port

            if_name = (ifidx_name.get(ifidx) or '').strip()
            if not if_name:
                continue

            # Format 1: 'EPON04ONU13' বা 'EPON04ONU13 description'
            m = re.match(r'[Ee][Pp][Oo][Nn](\d+)[Oo][Nn][Uu](\d+)', if_name)
            if not m:
                # Format 2: 'EPON0/4:13' বা 'EPON0/04:13' — slash format
                m = re.match(r'[Ee][Pp][Oo][Nn]\d*/(\d+):(\d+)', if_name)
            if m:
                port = f'EPON 0/{int(m.group(1)):02d}'
                onu  = m.group(2)
                result[mac] = {'port': port, 'onu': onu, 'iface': if_name}

        logger.info(
            f"CPE-MAC→ONU map ({self.host}): {len(result)} entries "
            f"(of {len(bridge_mac_port)} bridge MACs)"
        )
        return result

    @classmethod
    def from_olt_model(cls, olt) -> 'SNMPService':
        # OLT model থেকে service instance তৈরি করা হয়
        service = cls(
            host=str(olt.ip_address),
            community=olt.snmp_community,
        )
        service.vendor     = (olt.vendor or '').lower()
        service.fw_version = getattr(olt, 'fw_version', 'auto') or 'auto'
        service.rx_snmp_oid = getattr(olt, 'rx_snmp_oid', '') or ''
        service.tx_snmp_oid = getattr(olt, 'tx_snmp_oid', '') or ''
        return service
