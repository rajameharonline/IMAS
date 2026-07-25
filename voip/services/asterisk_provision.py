# Asterisk endpoint provisioning service (file-based)।
# কাজ: একজন client/agent-এর জন্য SipEndpoint তৈরি/মুছে ফেলা এবং (Asterisk চালু থাকলে)
#       PJSIP config file লিখে `pjsip reload` (AMI দিয়ে) ট্রিগার করা।
#
# কেন realtime/ODBC নয়: এই সার্ভারে Ubuntu mysql-server-8.4 প্যাকেজ `Conflicts: mariadb-common`,
# আর odbc-mariadb → libmariadb3 → mariadb-common। ফলে odbc-mariadb ইনস্টল করলে mysql-server
# remove হয়ে যায় (প্রোডাকশন DB ডাউন)। apt-এ MySQL-এর নিজস্ব ODBC driver-ও নেই। তাই realtime বাদ
# দিয়ে file-based provisioning — প্রতিটি endpoint একটি .conf file, pjsip.conf যেটা include করে।
# বিস্তারিত: memory project-mysql-odbc-gotcha, VOIP_PLAN.md।
#
# গুরুত্বপূর্ণ নকশা সিদ্ধান্ত:
#   - VOIP_ENABLED=False (default) হলে file লেখা/reload হয় না; শুধু SipEndpoint DB-তে লেখা হয়।
#   - কোনো exception যেন client create-কে না ভাঙে — caller-এ try/except থাকে।
#   - file লেখে gunicorn user (isp); dir setgid asterisk → asterisk group read করতে পারে।
import logging
import os
import secrets
import socket
import time

from django.conf import settings

from role_permissions.utils import encrypt_password, decrypt_password
from voip.models import SipEndpoint

logger = logging.getLogger(__name__)


def _gen_secret(length: int = 24) -> str:
    # SIP digest auth password — যথেষ্ট শক্তিশালী random (toll-fraud রোধে জরুরি)।
    return secrets.token_urlsafe(length)


def endpoint_name_for(*, client=None, user=None) -> str:
    # নামকরণ কনভেনশন — ARI listener এই prefix দিয়ে client/agent চেনে।
    if client is not None:
        return f'client_{client.pk}'
    if user is not None:
        return f'agent_{user.pk}'
    raise ValueError('client বা user — যেকোনো একটি দিতে হবে।')


def provision_endpoint(*, client=None, user=None, regenerate_secret=False) -> SipEndpoint:
    """client বা agent-এর জন্য SipEndpoint নিশ্চিত করে (get-or-create) ও secret সেট করে।
    Asterisk চালু থাকলে PJSIP config file লিখে reload করে।"""
    kind = 'client' if client is not None else 'agent'
    name = endpoint_name_for(client=client, user=user)

    ep, created = SipEndpoint.objects.get_or_create(
        endpoint_name=name,
        defaults={'kind': kind, 'client': client, 'user': user},
    )

    # নতুন হলে অথবা স্পষ্টভাবে চাওয়া হলে secret তৈরি করি।
    if created or regenerate_secret or not ep.secret_encrypted:
        ep.secret_encrypted = encrypt_password(_gen_secret())
        ep.is_active = True
        ep.save(update_fields=['secret_encrypted', 'is_active', 'updated_at'])

    # Asterisk চালু থাকলে config file লিখে reload (ব্যর্থ হলেও client create ভাঙবে না)।
    if getattr(settings, 'VOIP_ENABLED', False):
        try:
            _write_endpoint_file(ep)
            _reload_pjsip()
        except Exception as exc:  # pragma: no cover - server-নির্ভর
            logger.warning('PJSIP provision/reload ব্যর্থ (%s): %s', name, exc)

    return ep


def deprovision_endpoint(*, client=None, user=None):
    """client left/deleted বা agent disable হলে endpoint নিষ্ক্রিয় ও config file মুছি।"""
    name = endpoint_name_for(client=client, user=user)
    try:
        ep = SipEndpoint.objects.get(endpoint_name=name)
    except SipEndpoint.DoesNotExist:
        return
    ep.is_active = False
    ep.save(update_fields=['is_active', 'updated_at'])
    if getattr(settings, 'VOIP_ENABLED', False):
        try:
            _remove_endpoint_file(name)
            _reload_pjsip()
        except Exception as exc:  # pragma: no cover
            logger.warning('PJSIP deprovision ব্যর্থ (%s): %s', name, exc)


# ─── File-based PJSIP config (Phase 1-এ Asterisk চালু হলে কার্যকর) ─────────────
# pjsip.conf এই dir-টা include করে: #include "pjsip_isp.d/*.conf"

def _pjsip_dir() -> str:
    return getattr(settings, 'VOIP_PJSIP_DIR', '/etc/asterisk/pjsip_isp.d')


def _endpoint_display_name(ep: SipEndpoint) -> str:
    # incoming কল-এ caller-এর নাম দেখাতে: staff/agent → PBX Agents পেজের display_name
    # (নইলে User নাম); client → গ্রাহকের নাম। এটি endpoint-এর callerid-এ বসে, ফলে
    # INVITE-এর From header-এ নামটা যায় → receiving app সরাসরি দেখায় (FCM timing লাগে না)।
    try:
        if getattr(ep, 'user_id', None):
            from voip.models import PBXAgent
            ag = (PBXAgent.objects.filter(sip_endpoint_name=ep.endpoint_name).first()
                  or PBXAgent.objects.filter(user_id=ep.user_id).first())
            if ag and (ag.display_name or '').strip():
                return ag.display_name.strip()
            u = ep.user
            return (getattr(u, 'full_name', '') or getattr(u, 'username', '') or ep.endpoint_name)
        if getattr(ep, 'client_id', None):
            c = ep.client
            return (getattr(c, 'full_name', '') or getattr(c, 'name', '') or ep.endpoint_name)
    except Exception:
        pass
    return ep.endpoint_name


def _endpoint_stanza(ep: SipEndpoint) -> str:
    # একটি endpoint-এর সম্পূর্ণ PJSIP কনফিগ (endpoint + auth + aor)।
    # webrtc=yes Asterisk-এ DTLS-SRTP, ICE, AVPF, rtcp_mux ইত্যাদি স্বয়ংক্রিয় সেট করে।
    name = ep.endpoint_name
    secret = decrypt_password(ep.secret_encrypted)
    disp = _endpoint_display_name(ep).replace('"', '').replace('\n', ' ').strip() or name
    callerid = f'"{disp}" <{name}>'
    return f"""; স্বয়ংক্রিয়ভাবে তৈরি (voip/services/asterisk_provision.py) — হাতে এডিট করবেন না।
[{name}]
type=endpoint
transport=transport-wss
context=voip-internal
disallow=all
allow=opus,ulaw
callerid={callerid}
auth={name}
aors={name}
webrtc=yes
rewrite_contact=yes
force_rport=yes
direct_media=no
; SIP INFO DTMF সাপোর্ট: react-native-webrtc-এ RTCDTMFSender.dtmf প্রায়ই null,
; app SIP INFO পাঠায় — auto_info RFC 4733 ও SIP INFO দুটোই গ্রহণ করে।
dtmf_mode=auto_info
; rtp_symmetric=yes (comedia): NAT-এর পেছনের peer (যেমন WiFi মোবাইল) থেকে RTP যে
; address-এ আসে, Asterisk সেখানেই media ফেরত পাঠায় — SDP/ICE-এ ঘোষিত (প্রায়ই
; unreachable) address-এ নয়। webrtc=yes এটা সেট করে না, তাই asymmetric NAT-এ এক
; দিকের অডিও (Asterisk→peer) হারিয়ে যেত। one-way audio ঠেকাতে আবশ্যক।
rtp_symmetric=yes
; RTP ৩০s বন্ধ থাকলে (app killed/network lost, SIP BYE পৌঁছায়নি) Asterisk নিজে
; কল কেটে দেয় — নইলে channel server-এ ঝুলে থাকে (stuck call)।
rtp_timeout=30
rtp_timeout_hold=60

[{name}]
type=auth
auth_type=userpass
username={name}
password={secret}

[{name}]
type=aor
max_contacts={ep.max_contacts}
remove_existing=yes
; maximum_expiration=300: client app যদি SIP BYE/UNREGISTER না পাঠিয়ে বন্ধ হয় (Android kill),
; stale contact সর্বোচ্চ ৫ মিনিটে expire হবে (default Asterisk: ৭২০০s)।
; এতে পরবর্তী কলে Asterisk দ্রুত বুঝবে endpoint অনুপলব্ধ → FCM wake → re-register।
; নোট: Asterisk 22 PJSIP AOR-এ _expiration suffix ব্যবহার করে (_expiry নয়)।
maximum_expiration=300
default_expiration=120
minimum_expiration=30
qualify_frequency=30
qualify_timeout=3
"""


def _write_endpoint_file(ep: SipEndpoint):
    path = os.path.join(_pjsip_dir(), f'{ep.endpoint_name}.conf')
    tmp = f'{path}.tmp'
    with open(tmp, 'w') as f:
        f.write(_endpoint_stanza(ep))
    os.chmod(tmp, 0o640)
    os.replace(tmp, path)  # atomic


def _remove_endpoint_file(name: str):
    path = os.path.join(_pjsip_dir(), f'{name}.conf')
    if os.path.exists(path):
        os.remove(path)


def _reload_pjsip():
    # AMI (localhost) দিয়ে `pjsip reload` — সক্রিয় কল/registration বিঘ্নিত হয় না।
    host = getattr(settings, 'ASTERISK_AMI_HOST', '127.0.0.1')
    port = int(getattr(settings, 'ASTERISK_AMI_PORT', 5038))
    user = getattr(settings, 'ASTERISK_AMI_USER', '')
    secret = getattr(settings, 'ASTERISK_AMI_PASS', '')
    if not user:
        logger.warning('ASTERISK_AMI_USER সেট নেই — pjsip reload বাদ।')
        return
    s = socket.create_connection((host, port), timeout=5)
    try:
        s.recv(1024)  # banner
        msg = (
            f'Action: Login\r\nUsername: {user}\r\nSecret: {secret}\r\n\r\n'
            f'Action: Command\r\nCommand: pjsip reload\r\n\r\n'
            f'Action: Logoff\r\n\r\n'
        )
        s.sendall(msg.encode())
        time.sleep(0.3)
        s.recv(4096)
    finally:
        s.close()
