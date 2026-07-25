"""
OLT CLI (Telnet) — **শুধুমাত্র কনফিগারেশন লেখার জন্য**, ডাটা sync-এর জন্য নয়।

কেন Telnet ফিরে এল (2026-07-20):
  ডাটা sync (RX, ONU status, MAC table) HTTP-তে সরানো হয়েছে — সেখানে HTTP
  দ্রুত ও সম্পূর্ণ। কিন্তু OLT-এর web UI-তে **কনফিগ লেখা কাজ করে না**:
  rtc.html / ntp.html-এ POST করলে HTTP 200 আসে কিন্তু কিছুই প্রয়োগ হয় না
  (who=0/1/2/3/100, Referer/Origin হেডার, GET — সব চেষ্টা করা হয়েছে;
  অ্যাকাউন্ট Admin হওয়া সত্ত্বেও)। CLI-তে একই কাজ নির্ভরযোগ্যভাবে হয়।

  অর্থাৎ ভূমিকা ভাগ করা: **HTTP = পড়া, CLI = লেখা**।

py3.13+ এ telnetlib সরিয়ে দেওয়া হয়েছে, তাই ন্যূনতম socket ক্লায়েন্ট।
"""
import logging
import re
import socket
import time
from datetime import datetime, timedelta, timezone as dt_timezone

logger = logging.getLogger(__name__)

_IAC = 255
# CLI প্রম্পট: 'Kuhruil-epon-olt>' / '…#' / '…(config)#' — লাইনের শেষে
_PROMPT_RE = re.compile(r'[>#]\s*$')
# Bangladesh = GMT+6; V-SOL CLI-তে "(GMT+06:00) Astana, Dhaka" = কোড '6-1'
DHAKA_TZ = dt_timezone(timedelta(hours=6))
DHAKA_TZ_CODE = '6-1'


def _strip_iac(data: bytes) -> bytes:
    """Telnet IAC negotiation byte সরায় (payload-এ মিশে গেলে parse ভাঙে)।"""
    out, i = bytearray(), 0
    while i < len(data):
        if data[i] == _IAC:
            nxt = data[i + 1] if i + 1 < len(data) else None
            if nxt in (251, 252, 253, 254):
                i += 3
                continue
            if nxt == 250:                       # subnegotiation → IAC SE পর্যন্ত
                j = data.find(bytes([_IAC, 240]), i)
                i = (j + 2) if j != -1 else len(data)
                continue
            i += 2
            continue
        out.append(data[i])
        i += 1
    return bytes(out)


class OLTCli:
    """ন্যূনতম Telnet ক্লায়েন্ট — login → enable → configure terminal।"""

    def __init__(self, host, username, password, enable_password='', port=23, timeout=15):
        self.host = str(host)
        self.timeout = timeout
        self._sock = socket.create_connection((self.host, int(port or 23)), timeout=timeout)
        self._sock.settimeout(timeout)
        login_re = re.compile(r'(?:[Uu]sername|[Ll]ogin|[Pp]assword)\s*:\s*$')
        self._read(5, until=login_re)        # banner → Username:
        self._send(str(username or ''))
        self._read(5, until=login_re)        # → Password:
        self._send(password or '')
        self._read(5)                        # → prompt (>/#)
        # privileged mode — prompt '>' থেকে '#'
        out = self.run('enable', 3)
        if 'assword' in out:
            self.run(enable_password or password or '', 3)

    def _send(self, text):
        self._sock.sendall((text + '\n').encode())

    def _read(self, wait=3, until=_PROMPT_RE):
        """
        প্রম্পট (`>` / `#` / `(config)#`) দেখা মাত্রই ফিরে আসে — নইলে `wait`
        পর্যন্ত অপেক্ষা। আগে সবসময় পুরো timeout ঘুমাত, ফলে একটা clock-sync-এ
        ~36s লাগত; prompt-aware হওয়ায় এখন কয়েক সেকেন্ড।
        """
        out, end = '', time.time() + wait
        while time.time() < end:
            try:
                self._sock.settimeout(max(0.2, end - time.time()))
                chunk = self._sock.recv(8192)
                if not chunk:
                    break
                out += _strip_iac(chunk).decode(errors='ignore')
                if until and until.search(out):
                    break
            except socket.timeout:
                break
        return out

    def run(self, cmd, wait=3, until=_PROMPT_RE):
        self._send(cmd)
        return self._read(wait, until)

    def close(self):
        try:
            self._sock.close()
        except OSError:
            pass

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def _failed(output: str) -> bool:
    """CLI আউটপুটে স্পষ্ট প্রত্যাখ্যান আছে কিনা।"""
    return bool(re.search(r'%\s*(Unknown command|Command incomplete|Invalid|Error)', output, re.I))


# ডিভাইসের সীমা: "Specify onu description string,max length 32"
ONU_DESC_MAX = 32
# 'EPON 0/01/5' → ('EPON 0/1', '5')  — CLI-তে port zero-padded নয়
_IFACE_RE = re.compile(r'^\s*(EPON|GPON)\s*(\d+)\s*/\s*(\d+)\s*/\s*(\d+)\s*$', re.I)


def parse_interface(interface_id):
    """'EPON 0/01/5' → ('EPON 0/1', '5')। parse না হলে (None, None)।"""
    m = _IFACE_RE.match(str(interface_id or ''))
    if not m:
        return None, None
    family, slot, port, onu = m.group(1).upper(), int(m.group(2)), int(m.group(3)), int(m.group(4))
    return f'{family} {slot}/{port}', str(onu)


def set_onu_description(olt, interface_id, description: str) -> dict:
    """
    বাস্তব OLT ডিভাইসে একটি ONU-র description সেট করে (CLI)।

    CLI চেইন:  configure terminal → interface EPON 0/1 → onu 5 description <text>

    কেন CLI: OLT-এর web UI-তে কনফিগ লেখা কাজ করে না (উপরের module docstring
    দেখুন)। description লেখা গুরুত্বপূর্ণ — ONU Monitoring-এর description-ভিত্তিক
    client auto-link (`_client_id_from_desc`) এই মান থেকেই "customerID-নাম"
    পড়ে, তাই ডিভাইসে লিখে রাখলে পরবর্তী sync-এ লিংক নিজে থেকেই টিকে থাকে।

    Returns: {'ok': bool, 'sent': str, 'error': str}
    """
    result = {'ok': False, 'sent': '', 'error': ''}

    port, onu = parse_interface(interface_id)
    if not port:
        result['error'] = f'interface parse করা গেল না: {interface_id!r}'
        return result

    # ডিভাইস স্পেস-যুক্ত string গ্রহণ করে না — স্পেস '_' করে, তারপর ৩২ অক্ষরে কাটা
    text = re.sub(r'\s+', '_', str(description or '').strip())[:ONU_DESC_MAX]
    if not text:
        result['error'] = 'description খালি — পাঠানোর কিছু নেই।'
        return result
    result['sent'] = text

    if not olt.username or not olt.password:
        result['error'] = 'OLT-এ username/password সেট নেই।'
        return result

    try:
        with OLTCli(
            olt.ip_address, olt.username, olt.get_decrypted_password(),
            olt.get_decrypted_enable_password(), port=olt.telnet_port or 23,
        ) as cli:
            if _failed(cli.run('configure terminal', 3)):
                result['error'] = 'configure terminal ব্যর্থ।'
                return result
            if _failed(cli.run(f'interface {port}', 3)):
                result['error'] = f'interface {port} ব্যর্থ।'
                return result

            out = cli.run(f'onu {onu} description {text}', 5)
            if _failed(out):
                result['error'] = f'description সেট ব্যর্থ: {out.strip()[:150]}'
                return result

            cli.run('end', 2)
            cli.run('write file', 8)
            result['ok'] = True
            return result
    except OSError as exc:
        result['error'] = f'CLI সংযোগ ব্যর্থ: {exc}'
        return result


def sync_olt_clock(olt, now=None, ntp_server: str = '') -> dict:
    """
    OLT-এর ঘড়ি ও timezone সঠিক করে (এবং চাইলে NTP সার্ভার সেট করে), তারপর
    কনফিগ সেভ করে।

    কেন push করা হয়: এই OLT-গুলোর ম্যানেজমেন্ট নেটওয়ার্ক থেকে ইন্টারনেট NTP-তে
    পৌঁছানো যায় বলে মনে হয় না (Kuhruil-এ NTP enabled ও সার্ভার সেট থাকা
    সত্ত্বেও ঘড়ি ২০০০ সালে আটকে ছিল)। আমাদের সার্ভার chrony দিয়ে stratum-3
    নির্ভুল, তাই সেখান থেকে সময় push করাই সবচেয়ে নির্ভরযোগ্য।

    Returns: {'ok': bool, 'before': str, 'after': str, 'error': str}
    """
    now = now or datetime.now(DHAKA_TZ)
    result = {'ok': False, 'before': '', 'after': '', 'error': ''}

    if not olt.username or not olt.password:
        result['error'] = 'OLT-এ username/password সেট নেই।'
        return result

    try:
        with OLTCli(
            olt.ip_address, olt.username, olt.get_decrypted_password(),
            olt.get_decrypted_enable_password(), port=olt.telnet_port or 23,
        ) as cli:
            out = cli.run('configure terminal', 3)
            if _failed(out):
                result['error'] = 'configure terminal ব্যর্থ (privileged মোডে যাওয়া যায়নি)।'
                return result

            # timezone আগে — নইলে সেট করা সময় ভুল offset-এ ব্যাখ্যা হতে পারে
            tz_out = cli.run(f'time zone {DHAKA_TZ_CODE}', 3)
            if _failed(tz_out):
                logger.warning('[%s] time zone সেট ব্যর্থ: %s', olt.ip_address, tz_out.strip()[:120])

            cmd = (f'time set year {now.year} month {now.month} day {now.day} '
                   f'hour {now.hour} minute {now.minute} second {now.second}')
            set_out = cli.run(cmd, 5)
            # ডিভাইস নিজেই "before config rtc" / "config rtc success" লগ ছাপে
            m_before = re.search(r'(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2}).*?before config rtc', set_out, re.S)
            m_after = re.search(r'(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2}).*?config rtc success', set_out, re.S)
            result['before'] = m_before.group(1) if m_before else ''
            result['after'] = m_after.group(1) if m_after else ''

            if _failed(set_out) or not result['after']:
                result['error'] = f'time set ব্যর্থ: {set_out.strip()[:150]}'
                return result

            if ntp_server:
                ntp_out = cli.run(f'ntp server {ntp_server}', 3)
                if _failed(ntp_out):
                    logger.warning('[%s] ntp server সেট ব্যর্থ: %s',
                                   olt.ip_address, ntp_out.strip()[:120])

            cli.run('end', 2)
            cli.run('write file', 6)      # reboot-এর পরও টিকে থাকার জন্য
            result['ok'] = True
            return result
    except OSError as exc:          # socket.timeout OSError-এরই সাবক্লাস
        result['error'] = f'CLI সংযোগ ব্যর্থ: {exc}'
        return result
