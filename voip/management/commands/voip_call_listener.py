# VoIP call logging — Asterisk AMI (localhost) event শুনে isp_call_logs-এ লেখে।
# কেন AMI (ARI Stasis নয়): আসল কল voip-internal dialplan দিয়ে যায় (Stasis-এ নয়),
# তাই passive logging-এর জন্য AMI-ই সঠিক — dialplan reroute করতে হয় না।
#
# চালানো (long-running, gunicorn-এর বাইরে — যেমন OLT sync):
#   python manage.py voip_call_listener
# Production-এ systemd: isp-voip-listener.service (deploy/asterisk/)।
#
# Event → CallLog ম্যাপিং (Linkedid দিয়ে দুই channel leg correlate):
#   DialBegin → CallLog তৈরি (ringing, caller/callee, client/agent FK)
#   DialEnd   → status (ANSWER/BUSY/NOANSWER/...) + answered_at
#   Hangup    → ended_at + duration + final status (answered হলে completed)
import logging
import re
import socket
import time

from django.core.management.base import BaseCommand
from django.conf import settings
from django.db import close_old_connections
from django.utils import timezone

logger = logging.getLogger(__name__)

# PJSIP/client_4-00000002 → client_4 ; CallerIDNum সরাসরি client_4/agent_1
_CHAN_RE = re.compile(r'PJSIP/([A-Za-z]+_\d+)-')
_NAME_RE = re.compile(r'^(client|agent)_(\d+)$')

_DIALSTATUS = {
    'ANSWER': ('answered', 'answered'),
    'BUSY': ('busy', None),
    'NOANSWER': ('no_answer', None),
    'CANCEL': ('no_answer', None),
    'CONGESTION': ('failed', None),
    'CHANUNAVAIL': ('failed', None),
}


def _endpoint_name(value: str) -> str:
    # channel string বা callerid থেকে client_X/agent_X বের করি।
    if not value:
        return ''
    m = _CHAN_RE.search(value)
    if m:
        return m.group(1)
    return value if _NAME_RE.match(value) else ''


def _resolve(name: str):
    # (client, user) — endpoint নাম থেকে FK।
    from clients.models import Client
    from django.contrib.auth import get_user_model
    m = _NAME_RE.match(name or '')
    if not m:
        return None, None
    kind, pk = m.group(1), int(m.group(2))
    if kind == 'client':
        return Client.objects.filter(pk=pk).first(), None
    return None, get_user_model().objects.filter(pk=pk).first()


class Command(BaseCommand):
    help = 'Asterisk AMI event শুনে কল লগ (isp_call_logs) লেখে — long-running।'

    def handle(self, *args, **opts):
        host = getattr(settings, 'ASTERISK_AMI_HOST', '127.0.0.1')
        port = int(getattr(settings, 'ASTERISK_AMI_PORT', 5038))
        user = getattr(settings, 'ASTERISK_AMI_USER', '')
        secret = getattr(settings, 'ASTERISK_AMI_PASS', '')
        if not user:
            self.stderr.write('ASTERISK_AMI_USER সেট নেই (.env)। থামছি।')
            return
        self.stdout.write(self.style.SUCCESS(f'VoIP call listener শুরু — AMI {host}:{port}'))
        while True:
            try:
                self._run(host, port, user, secret)
            except Exception as exc:
                logger.warning('AMI সংযোগ বিচ্ছিন্ন: %s — ৫s পর retry', exc)
                time.sleep(5)

    # ── একটি AMI সেশন (disconnect হলে handle() retry করে) ───────────────────────
    def _run(self, host, port, user, secret):
        sock = socket.create_connection((host, port), timeout=10)
        sock.settimeout(None)
        # banner পড়ি
        sock.recv(1024)
        login = (f'Action: Login\r\nUsername: {user}\r\nSecret: {secret}\r\n'
                 f'Events: call\r\n\r\n')
        sock.sendall(login.encode())
        f = sock.makefile('r', encoding='utf-8', newline='\r\n')
        msg = {}
        for raw in f:
            line = raw.rstrip('\r\n')
            if line == '':
                if msg:
                    self._dispatch(msg)
                    msg = {}
                continue
            if ': ' in line:
                k, v = line.split(': ', 1)
                msg[k] = v

    def _dispatch(self, msg):
        event = msg.get('Event')
        if event not in ('Newchannel', 'DialEnd', 'Hangup'):
            return
        close_old_connections()  # long-running — stale DB connection এড়াই
        try:
            if event == 'Newchannel':
                self._ensure_calllog(msg)         # কল শুরুতেই log তৈরি (unreachable হলেও)
                self._maybe_push_pbx(msg)         # hotline/extension dial → routed agent-দের wake push
            elif event == 'DialEnd':
                self._on_dial_end(msg)
            elif event == 'Hangup':
                self._ensure_calllog(msg)         # Newchannel মিস হলে এখানে fallback
                self._on_hangup(msg)
        except Exception as exc:
            logger.warning('Event handle ব্যর্থ (%s): %s', event, exc)

    def _ensure_calllog(self, msg):
        # originating leg = যার dialed Exten একটি বৈধ endpoint নাম (client_/agent_)।
        # callee leg-এর Exten ভিন্ন/খালি — তাই এটি শুধু caller leg-এ log তৈরি করে।
        from voip.models import CallLog
        exten = msg.get('Exten', '')
        if not _NAME_RE.match(exten):
            return
        linkedid = msg.get('Linkedid') or msg.get('Uniqueid')
        if not linkedid:
            return
        caller = _endpoint_name(msg.get('Channel'))
        callee = exten
        direction = 'inbound' if caller.startswith('client_') else 'outbound'
        c_client, _ = _resolve(callee if callee.startswith('client_') else caller)
        _, a_user = _resolve(caller if caller.startswith('agent_') else callee)
        _, created = CallLog.objects.get_or_create(
            sip_channel=linkedid,
            defaults=dict(
                client=c_client, agent=a_user, direction=direction,
                caller_endpoint=caller, callee_endpoint=callee,
                status='ringing', started_at=timezone.now(),
            ),
        )
        # নতুন কল + callee একজন client → ওই client-এর device-এ ইনকামিং কল push।
        # (অ্যাপ বন্ধ/background থাকলেও user যেন জানে; tap করলে অ্যাপ খুলে register
        #  হয় ও 40s ring window-এর মধ্যে SIP INVITE আসে → CallScreen।)
        if created and callee.startswith('client_') and c_client is not None:
            self._push_incoming(c_client, caller, linkedid)

    def _push_incoming(self, client, caller, linkedid):
        # ব্যর্থ হলেও call logging যেন না ভাঙে — সব try/except-এ।
        try:
            token = getattr(client, 'fcm_token', '') or ''
            if not token:
                return
            from mobile_api.services.push_service import send_to_token
            ok = send_to_token(
                token,
                title='📞 ইনকামিং কল',
                body='অফিস থেকে আপনাকে কল করা হচ্ছে…',
                data={
                    'type': 'incoming_call',
                    'caller': caller or 'office',
                    'caller_name': self._caller_display(caller),   # incoming UI-তে আসল নাম
                    'channel': linkedid or '',
                    'screen': 'Home',
                },
                high_priority=True,   # Doze/lock-screen-এও সাথে সাথে delivery
                data_only=True,       # RNFirebase bg handler → CallKeep রিং (killed অ্যাপেও)
            )
            logger.info('ইনকামিং কল push → client_%s: %s', client.pk, 'sent' if ok else 'failed')
        except Exception as exc:  # pragma: no cover
            logger.warning('ইনকামিং কল push ব্যর্থ: %s', exc)

    # ── Hotline / staff-extension কল → routed agent-দের FCM wake push ────────────
    # কেন আলাদা: client হটলাইন নম্বরে (যেমন 100) বা staff extension-এ (যেমন 101) কল
    # দিলে caller leg-এর Exten হয় ঐ নম্বর — কোনো client_/agent_ endpoint নাম নয়, তাই
    # _ensure_calllog এটা ধরে না এবং আগে কোনো agent-কে push যেত না। ফলে অ্যাপ
    # killed/background থাকলে এজেন্ট কখনো জানত না কল এসেছে (WSS suspended → INVITE নেই)।
    # এখানে number → routed agent(দের) resolve করে প্রত্যেককে push পাঠাই — অ্যাপ জেগে
    # SIP register করে ring window-এর মধ্যে INVITE ধরে।
    def _maybe_push_pbx(self, msg):
        exten = msg.get('Exten', '')
        # endpoint-নাম dial (client_/agent_) → _ensure_calllog সামলায়; এখানে শুধু নম্বর।
        # Asterisk special exten (s/h/i/t/o) ও Dial-করা leg-এ অযথা DB query এড়াই।
        if not exten or _NAME_RE.match(exten) or exten in ('s', 'h', 'i', 't', 'o'):
            return
        caller = _endpoint_name(msg.get('Channel'))
        if not caller:
            return
        linkedid = msg.get('Linkedid') or msg.get('Uniqueid')
        self._push_agents_for_dial(caller, exten, linkedid)

    @staticmethod
    def _ring_group_agents(ring_group):
        """একটি ring group-এর active member agent set।"""
        agents = set()
        for m in ring_group.members.filter(enabled=True).select_related('agent'):
            if m.agent and m.agent.is_active:
                agents.add(m.agent)
        return agents

    def _ivr_agents(self, ivr):
        """IVR interactive — কোন option বাছবে জানা নেই, তাই সব option-এর agent + ring-group
        agent জাগাই। → agent set।"""
        agents = set()
        for opt in ivr.options.select_related('ring_group', 'agent'):
            if opt.agent_id and opt.agent.is_active:
                agents.add(opt.agent)
            if opt.ring_group_id:
                agents |= self._ring_group_agents(opt.ring_group)
        return agents

    def _hotline_agents(self, hn):
        # একটি হটলাইন নম্বর কোন কোন agent-কে রাউট করে — ring group / direct agent / IVR।
        rt = hn.default_route_type
        if rt == 'ring_group' and hn.default_ring_group_id:
            return self._ring_group_agents(hn.default_ring_group)
        if rt == 'agent' and hn.default_agent_id and hn.default_agent.is_active:
            return {hn.default_agent}
        if rt == 'ivr' and hn.default_ivr_id:
            return self._ivr_agents(hn.default_ivr)
        return set()

    @staticmethod
    def _wake_agent_push(ag, caller, caller_name, linkedid):
        """একটি agent-এর user-এ incoming-call wake push → sent bool (token নেই হলে False)।"""
        user = ag.user
        token = (getattr(user, 'fcm_token', '') or '') if user else ''
        if not token:
            return False
        from mobile_api.services.push_service import send_to_token
        return bool(send_to_token(
            token,
            title='📞 ইনকামিং কল',
            body=f'{caller_name} আপনাকে কল করছে…',
            data={
                'type': 'incoming_call',
                'caller': caller or 'office',
                'caller_name': caller_name,
                'channel': linkedid or '',
                'screen': 'Home',
            },
            high_priority=True,   # Doze/lock-screen-এও সাথে সাথে delivery
            data_only=True,       # RNFirebase bg handler → CallKeep রিং (killed অ্যাপেও)
        ))

    def _push_agents_for_dial(self, caller, exten, linkedid):
        try:
            from voip.models import HotlineNumber, PBXAgent
            agents = set()
            hn = HotlineNumber.objects.filter(number=exten, is_active=True).first()
            if hn:
                agents |= self._hotline_agents(hn)
            else:
                ag = PBXAgent.objects.filter(extension=exten, is_active=True).first()
                if ag:
                    agents.add(ag)
            if not agents:
                return
            caller_name = self._caller_display(caller)
            sent = 0
            for ag in agents:
                if self._wake_agent_push(ag, caller, caller_name, linkedid):
                    sent += 1
            logger.info('Hotline/ext push → exten=%s, %s/%s agent(s) sent', exten, sent, len(agents))
        except Exception as exc:  # pragma: no cover
            logger.warning('Agent wake push ব্যর্থ (exten=%s): %s', exten, exc)

    def _caller_display(self, caller):
        # CallKeep incoming UI-তে caller-এর নাম। অগ্রাধিকার:
        #   staff/agent → PBX Agents পেজের display_name (admin/Support Team/test...),
        #   নইলে User.full_name; client → গ্রাহকের নাম; কিছু না পেলে ব্র্যান্ড।
        try:
            # ১) staff/agent endpoint → PBX Agent display_name (পেজ অনুযায়ী)
            try:
                from voip.models import PBXAgent
                ag = PBXAgent.objects.filter(sip_endpoint_name=caller).first()
                if ag and (ag.display_name or '').strip():
                    return ag.display_name
            except Exception:
                pass
            client, user = _resolve(caller)
            if client is not None:
                return (getattr(client, 'name', '') or getattr(client, 'full_name', '')
                        or 'গ্রাহক')
            if user is not None:
                return (getattr(user, 'full_name', '') or getattr(user, 'username', '')
                        or 'স্টাফ')
        except Exception:  # pragma: no cover
            pass
        return 'Rajamehar Online WiFi'

    def _on_dial_end(self, msg):
        from voip.models import CallLog
        linkedid = msg.get('Linkedid') or msg.get('Uniqueid')
        cl = CallLog.objects.filter(sip_channel=linkedid).first()
        if not cl:
            return
        status, ans = _DIALSTATUS.get(msg.get('DialStatus', ''), ('failed', None))
        cl.status = status
        if ans and not cl.answered_at:
            cl.answered_at = timezone.now()
        cl.save(update_fields=['status', 'answered_at'])

    # Hangup Cause (Q.850) → unanswered call-এর final status
    _CAUSE = {'17': 'busy', '19': 'no_answer', '21': 'no_answer',
              '3': 'failed', '34': 'failed', '38': 'failed', '20': 'no_answer'}

    def _on_hangup(self, msg):
        from voip.models import CallLog
        linkedid = msg.get('Linkedid') or msg.get('Uniqueid')
        cl = CallLog.objects.filter(sip_channel=linkedid, ended_at__isnull=True).first()
        if not cl:
            return
        cl.ended_at = timezone.now()
        if cl.answered_at:
            cl.duration = int((cl.ended_at - cl.answered_at).total_seconds())
            cl.status = 'completed'
        elif cl.status in ('ringing', 'initiated'):
            # DialEnd আসেনি (callee unreachable) → Hangup Cause থেকে status।
            cl.status = self._CAUSE.get(msg.get('Cause', ''), 'no_answer')
        cl.save(update_fields=['ended_at', 'duration', 'status'])
