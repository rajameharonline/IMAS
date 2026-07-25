# Voice SMS — automated voice call broadcast।
# অডিও → Asterisk-playable wav (ffmpeg) → প্রতি client-কে FCM wake → register হলে
# AMI Originate (voip-announce dialplan) → client রিসিভ করলে রেকর্ডিং Playback।
import logging
import os
import socket
import subprocess
import time

from django.conf import settings

logger = logging.getLogger(__name__)

ANNOUNCE_DIR = os.path.join(settings.MEDIA_ROOT, 'voice_announce')


def convert_to_wav(src_path, basename):
    """যেকোনো অডিও → 8kHz mono pcm_s16le wav (Asterisk Playback-যোগ্য)।
    return: extension ছাড়া absolute path (Playback ${ANNOUNCE}-এর জন্য)।"""
    os.makedirs(ANNOUNCE_DIR, exist_ok=True)
    out = os.path.join(ANNOUNCE_DIR, basename + '.wav')
    subprocess.run(
        ['ffmpeg', '-y', '-i', src_path, '-ar', '8000', '-ac', '1',
         '-acodec', 'pcm_s16le', out],
        check=True, capture_output=True, timeout=120,
    )
    os.chmod(out, 0o644)               # asterisk (other) যেন পড়তে পারে
    return out[:-4]                    # .wav ছাড়া


# ─── AMI helper ──────────────────────────────────────────────────────────────
def _ami(cmds, read_timeout=4.0):
    """AMI-তে একাধিক action পাঠিয়ে সম্পূর্ণ response ফেরায়।
    read_timeout: socket-level timeout (s) — শেষ chunk আসার পরে এতটুকু wait করে।"""
    host = getattr(settings, 'ASTERISK_AMI_HOST', '127.0.0.1')
    port = int(getattr(settings, 'ASTERISK_AMI_PORT', 5038))
    user = getattr(settings, 'ASTERISK_AMI_USER', '')
    secret = getattr(settings, 'ASTERISK_AMI_PASS', '')
    s = socket.create_connection((host, port), timeout=8)
    try:
        s.recv(1024)  # banner
        msg = f'Action: Login\r\nUsername: {user}\r\nSecret: {secret}\r\n\r\n'
        for c in cmds:
            msg += c
        msg += 'Action: Logoff\r\n\r\n'
        s.sendall(msg.encode())
        # non-blocking read: chunk আসা বন্ধ হলে (read_timeout) বেরিয়ে যাই।
        # কেন fixed sleep নয়: 800+ endpoint থাকলে pjsip show contacts response
        # বড় হতে পারে; fixed 0.4s miss করতে পারে।
        s.settimeout(read_timeout)
        data = b''
        try:
            while True:
                ch = s.recv(65536)
                if not ch:
                    break
                data += ch
        except (socket.timeout, BlockingIOError):
            pass
        return data.decode(errors='replace')
    finally:
        try:
            s.close()
        except OSError:
            pass


def _is_registered(endpoint):
    """Asterisk-এ endpoint-এর active SIP contact আছে কিনা।
    endpoint-specific CLI query — শুধু ঐ AOR-এর contacts দেখে (দ্রুত, ছোট response)।
    'Expiration:' থাকে registered contact-এ; 'No Contacts' থাকে unregistered-এ।"""
    resp = _ami(
        [f'Action: Command\r\nCommand: pjsip show contacts endpoint {endpoint}\r\n\r\n'],
        read_timeout=3.0,
    )
    # registered: "Uri: sip:client_4@..." + "Expiration: <সংখ্যা>" লাইন থাকে
    return 'Expiration:' in resp and '/sip:' in resp


# OriginateResponse Reason → outcome:
#   4=answered(রিসিভ), 3=no answer(রিসিভ করেনি), 5/8=busy/congestion,
#   0/1=failure/hangup(কল পায়নি)।
def _originate_outcome(cur, aid):
    """একটি AMI event block → আমাদের OriginateResponse হলে outcome
    ('answered'/'no_answer'/'unreachable'); নাহলে None (আরও পড়তে হবে)।"""
    if cur.get('Event') != 'OriginateResponse' or cur.get('ActionID') != aid:
        return None
    reason = cur.get('Reason', '')
    resp = cur.get('Response', '')
    if reason == '4' or resp == 'Success':
        return 'answered'
    if reason == '3':
        return 'no_answer'
    return 'unreachable'


def _originate_and_wait(endpoint, announce, ring=25):
    """Originate (Async) করে OriginateResponse event পড়ে outcome ফেরায়:
    'answered' | 'no_answer' | 'unreachable'। ring সেকেন্ড পর্যন্ত অপেক্ষা।"""
    host = getattr(settings, 'ASTERISK_AMI_HOST', '127.0.0.1')
    port = int(getattr(settings, 'ASTERISK_AMI_PORT', 5038))
    user = getattr(settings, 'ASTERISK_AMI_USER', '')
    secret = getattr(settings, 'ASTERISK_AMI_PASS', '')
    aid = f'ann{int(time.time()*1000)%100000}_{endpoint}'
    s = socket.create_connection((host, port), timeout=5)
    try:
        s.recv(1024)
        s.sendall((
            f'Action: Login\r\nUsername: {user}\r\nSecret: {secret}\r\n\r\n'
            f'Action: Originate\r\nActionID: {aid}\r\nChannel: PJSIP/{endpoint}\r\n'
            f'Context: voip-announce\r\nExten: s\r\nPriority: 1\r\nAsync: true\r\n'
            f'Timeout: {ring * 1000}\r\nCallerID: Rajamehar Online <0000>\r\n'
            f'Variable: ANNOUNCE={announce}\r\n\r\n'
        ).encode())
        f = s.makefile('r', encoding='utf-8', newline='\r\n')
        s.settimeout(ring + 12)
        cur = {}
        try:
            for raw in f:
                line = raw.rstrip('\r\n')
                if line == '':
                    outcome = _originate_outcome(cur, aid)
                    if outcome is not None:
                        return outcome
                    cur = {}
                    continue
                if ': ' in line:
                    k, v = line.split(': ', 1)
                    cur[k] = v
        except socket.timeout:
            return 'no_answer'   # সময় শেষ — সম্ভবত রিং হয়ে answer হয়নি
    finally:
        try:
            s.close()
        except OSError:
            pass
    return 'unreachable'


def _wake_broadcast_clients(clients, send_to_token):
    """সব client-কে FCM wake push (Originate-এর আগে, যাতে app জেগে register করার সময় পায়;
    FCM TTL=45s তাই এর মধ্যে কল না হলে push বাতিল)।"""
    for _ep, token in clients:
        if token:
            try:
                send_to_token(
                    token, '📞 ইনকামিং কল', 'Rajamehar Online থেকে কল আসছে…',
                    data={'type': 'incoming_call', 'caller': 'Rajamehar Online'},
                    high_priority=True, data_only=True,
                )
            except Exception:  # pragma: no cover
                pass


def _broadcast_call_one(ep, announce):
    """একটি client — register-এর জন্য (~45s) অপেক্ষা করে announce originate; CallLog লিখে
    outcome key ('answered'/'no_answer'/'unreachable') ফেরায়; ep invalid হলে None।"""
    from django.utils import timezone
    from voip.models import CallLog
    try:
        client_pk = int(ep.split('_')[1])
    except (IndexError, ValueError):
        return None
    cl = CallLog.objects.create(
        client_id=client_pk, direction='outbound', caller_endpoint='voice_sms',
        callee_endpoint=ep, status='ringing', started_at=timezone.now(),
    )
    # register poll: FCM TTL=45s; mobile data-এ wake + SIP handshake ৫-২০s নিতে পারে।
    registered = False
    for _ in range(15):
        if _is_registered(ep):
            registered = True
            break
        time.sleep(3)
    if not registered:
        cl.status = 'failed'; cl.ended_at = timezone.now()
        cl.save(update_fields=['status', 'ended_at'])
        return 'unreachable'
    outcome = _originate_and_wait(ep, announce)
    now = timezone.now()
    if outcome == 'answered':
        cl.status = 'completed'; cl.answered_at = now
    elif outcome == 'no_answer':
        cl.status = 'no_answer'
    else:
        cl.status = 'failed'
    cl.ended_at = now
    cl.save(update_fields=['status', 'answered_at', 'ended_at'])
    return outcome


def broadcast_voice_call(announce, clients, schedule=None):
    """clients: [(endpoint, fcm_token)]। FCM দিয়ে wake → register হলে announce
    originate → প্রতি client-এর outcome CallLog-এ লেখে (status: completed=রিসিভ,
    no_answer=রিসিভ করেনি, failed=কল পায়নি)। background thread-এ চলে।"""
    from mobile_api.services.push_service import send_to_token

    # ১) FCM wake (সবাইকে একসাথে) — Originate-এর আগে।
    _wake_broadcast_clients(clients, send_to_token)

    # FCM পাঠানোর পর ৩s অপেক্ষা — Android high-priority FCM সাধারণত 1-3s-এ deliver হয়।
    time.sleep(3)

    res = {'answered': 0, 'no_answer': 0, 'unreachable': 0}
    for ep, _token in clients:
        outcome = _broadcast_call_one(ep, announce)
        if outcome is not None:
            res[outcome] += 1

    logger.info('voice broadcast%s: %s', f' (sched {schedule})' if schedule else '', res)
    return res
