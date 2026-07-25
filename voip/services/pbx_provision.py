# IP-PBX / Hotline dialplan provisioning service।
# কাজ: হটলাইন নম্বর, রিং গ্রুপ ও IVR কনফিগ থেকে Asterisk dialplan generate করে
#       /etc/asterisk/extensions_isp.d/hotline.conf-এ লেখে।
#
# গুরুত্বপূর্ণ সিদ্ধান্ত:
#   - পৃথক ফাইল /etc/asterisk/extensions_isp.d/hotline.conf ব্যবহার করা হয়,
#     যাতে [voip-internal] ও [voip-announce] কনফিগে হাত না লাগে।
#   - extensions_isp.d/ ডিরেক্টরি isp:asterisk মালিকানার setgid হতে হবে।
#     (install.sh দেখুন — pjsip_isp.d এর মতো সেটআপ করতে হবে)।
#   - VOIP_ENABLED=False হলে ফাইল লেখা হয় না।
#   - ffmpeg দিয়ে greeting convert করা হয় voice_broadcast.py-এর convert_to_wav() দিয়ে।
import logging
import os
import socket
import time

from django.conf import settings

logger = logging.getLogger(__name__)

HOTLINE_CONF_DIR = '/etc/asterisk/extensions_isp.d'
HOTLINE_CONF_FILE = os.path.join(HOTLINE_CONF_DIR, 'hotline.conf')



# পুনরাবৃত্ত literal — S1192 এড়াতে module constant
_DP_ANSWER = ' same => n,Answer()'
_DP_HANGUP = ' same => n,Hangup()'

def _is_business_hours(hotline) -> bool:
    # Asia/Dhaka সময়ে এখন ব্যবসায়িক সময় কিনা চেক করো।
    import datetime
    from django.utils import timezone

    now     = timezone.localtime()
    weekday = now.weekday()   # 0=সোমবার … 6=রবিবার
    t       = now.time()

    hours = hotline.business_hours.filter(weekday=weekday, is_open=True)
    for h in hours:
        if h.start_time <= t <= h.end_time:
            return True
    return False


def _ring_group_dial(rg, timeout: int) -> str:
    # রিং গ্রুপের জন্য Dial() argument তৈরি (PJSIP endpoint নাম দিয়ে)।
    members = rg.members.filter(enabled=True).order_by('order').select_related('agent')
    if not members:
        return ''
    endpoints = '&'.join(
        f'PJSIP/{m.agent.sip_endpoint_name or f"agent_{m.agent_id}"}'
        for m in members
    )
    return f'Dial({endpoints},{timeout},tT)'


def _agent_dial(agent, timeout: int) -> str:
    ep = agent.sip_endpoint_name or f'agent_{agent.pk}'
    return f'Dial(PJSIP/{ep},{timeout},tT)'


def _generate_context(hotline) -> str:
    # একটি হটলাইন নম্বরের জন্য Asterisk dialplan context।
    ctx_name = f'hotline-{hotline.pk}'
    lines    = [f'; হটলাইন: {hotline.title} ({hotline.number})',
                f'[{ctx_name}]']

    route_type = hotline.default_route_type
    timeout    = 25

    if hotline.business_hours_enabled:
        # ব্যবসায়িক সময় চেক — সময়মতো route করো।
        lines.append(f'exten => s,1,NoOp(Hotline inbound: {hotline.number})')
        lines.append(' same => n,Set(NOW=${STRFTIME(${EPOCH},Asia/Dhaka,%H%M)})')
        # Asterisk GotoIfTime দিয়ে বিজনেস আওয়ার চেক।
        _add_business_hour_goto(lines, hotline, route_type, timeout)
    else:
        lines.append(f'exten => s,1,NoOp(Hotline inbound: {hotline.number})')
        _add_route_lines(lines, route_type, hotline, timeout)

    lines.append('')
    return '\n'.join(lines)


def _add_business_hour_goto(lines, hotline, route_type, timeout):
    # GotoIfTime(start-end,weekdays,mdays,months) → লেবেল।
    hours = hotline.business_hours.filter(is_open=True).order_by('weekday', 'start_time')
    if hours.exists():
        for h in hours:
            weekday_map = {0:'mon',1:'tue',2:'wed',3:'thu',4:'fri',5:'sat',6:'sun'}
            wd  = weekday_map.get(h.weekday, 'mon')
            st  = h.start_time.strftime('%H:%M')
            et  = h.end_time.strftime('%H:%M')
            lines.append(f' same => n,GotoIfTime({st}-{et},{wd},*,*?open)')
        # অফ-আওয়ার
        if hotline.after_hours_message:
            lines.append(_DP_ANSWER)
            lines.append(f' same => n,Playback({hotline.after_hours_message})')
        lines.append(_DP_HANGUP)
        lines.append(' same => n(open),NoOp(Open hours)')
        _add_route_lines(lines, route_type, hotline, timeout)
    else:
        _add_route_lines(lines, route_type, hotline, timeout)


def _add_wake_dial(lines, endpoints, timeout):
    # FCM-wake + retry Dial — voip-internal-এর প্রমাণিত প্যাটার্নের মতো।
    # কেন: অ্যাপ killed/background থাকলে এজেন্টের SIP endpoint unregistered → Dial
    # সঙ্গে সঙ্গে CHANUNAVAIL দেয়। AMI listener ততক্ষণে FCM push পাঠিয়েছে (app জাগছে)।
    # CHANUNAVAIL হলে ২s অপেক্ষা করে আবার Dial — app register হওয়া পর্যন্ত (~৪০s window)।
    # Answer() নয় Ringing() — wake হওয়া পর্যন্ত caller ringback শোনে; Dial answered
    # হলে নিজেই bridge করে। registered agent থাকলে স্বাভাবিক ring (CHANUNAVAIL নয়) →
    # retry loop bypass হয়ে যথারীতি কাজ করে।
    lines.append(' same => n,Ringing()')
    lines.append(' same => n,Set(TRIES=0)')
    lines.append(f' same => n(wakedial),Dial({endpoints},{timeout},tT)')
    # registered ছিল ও রিং হয়েছে (answer/busy/noanswer) → retry নয়, নিচে নামি
    lines.append(' same => n,ExecIf($["${DIALSTATUS}"!="CHANUNAVAIL"]?Goto(donedial))')
    lines.append(' same => n,Set(TRIES=$[${TRIES}+1])')
    lines.append(' same => n,ExecIf($[${TRIES}>20]?Goto(donedial))')   # ~৪০s wake window
    lines.append(' same => n,Wait(2)')
    lines.append(' same => n,Goto(wakedial)')
    lines.append(' same => n(donedial),NoOp(dial finished status=${DIALSTATUS})')


def _add_sequential_dial(lines, eps, timeout):
    # Sequential strategy: member-দের একে একে রিং (order অনুযায়ী); কেউ ANSWER করলে থামে।
    # প্রতিটি member-এ ছোট wake-retry (~৬s) — FCM-woken app register-এর সময় (DialBegin-এ
    # সব member FCM push পায়); না ধরলে/unavailable হলে পরের member-এ। শেষে donedial।
    lines.append(' same => n,Ringing()')
    n = len(eps)
    for i, ep in enumerate(eps):
        nxt = f'm{i + 1}' if i + 1 < n else 'donedial'
        lines.append(f' same => n(m{i}),Set(T{i}=0)')
        lines.append(f' same => n(d{i}),Dial(PJSIP/{ep},{timeout},tT)')
        lines.append(' same => n,ExecIf($["${DIALSTATUS}"="ANSWER"]?Goto(donedial))')
        lines.append(f' same => n,ExecIf($["${{DIALSTATUS}}"!="CHANUNAVAIL"]?Goto({nxt}))')
        lines.append(f' same => n,Set(T{i}=$[${{T{i}}}+1])')
        lines.append(f' same => n,ExecIf($[${{T{i}}}>3]?Goto({nxt}))')
        lines.append(' same => n,Wait(2)')
        lines.append(f' same => n,Goto(d{i})')
    lines.append(' same => n(donedial),NoOp(sequential finished status=${DIALSTATUS})')


def _add_ring_group_lines(lines, rg, timeout):
    """ring group dial lines — strategy (sequential/ring_all) + no-answer routing।"""
    members  = rg.members.filter(enabled=True).order_by('order').select_related('agent')
    eps = [(m.agent.sip_endpoint_name or f'agent_{m.agent_id}') for m in members]
    endpoints = '&'.join(f'PJSIP/{e}' for e in eps)
    if endpoints:
        # strategy অনুযায়ী: sequential → একে একে; নইলে ring_all (সবাই একসাথে)।
        if rg.strategy == 'sequential':
            _add_sequential_dial(lines, eps, timeout)
        else:
            _add_wake_dial(lines, endpoints, timeout)
        # no-answer routing (woken agent রিং পেয়েও না ধরলে / busy হলে এখানে আসে)
        if rg.no_answer_route_type == 'forward' and rg.no_answer_forward_num:
            lines.append(f' same => n,Dial(SIP/{rg.no_answer_forward_num},{timeout})')
        elif rg.no_answer_route_type == 'ivr':
            lines.append(' same => n,NoOp(No answer — IVR fallback)')
    lines.append(_DP_HANGUP)


def _add_route_lines(lines, route_type, hotline, timeout):
    if route_type == 'ring_group' and hotline.default_ring_group:
        _add_ring_group_lines(lines, hotline.default_ring_group, timeout)

    elif route_type == 'ivr' and hotline.default_ivr:
        _add_ivr_lines(lines, hotline.default_ivr, timeout)

    elif route_type == 'agent' and hotline.default_agent:
        ag = hotline.default_agent
        ep = ag.sip_endpoint_name or f'agent_{ag.pk}'
        _add_wake_dial(lines, f'PJSIP/{ep}', timeout)
        lines.append(_DP_HANGUP)

    elif route_type == 'forward' and hotline.forward_number:
        lines.append(_DP_ANSWER)
        lines.append(f' same => n,Dial(SIP/{hotline.forward_number},{timeout})')
        lines.append(_DP_HANGUP)

    else:
        lines.append(_DP_ANSWER)
        lines.append(' same => n,Playback(beep)')
        lines.append(_DP_HANGUP)


def _add_ivr_option_lines(lines, opt, timeout):
    """একটি IVR digit option-এর dial lines (wake-dial সহ)।"""
    lines.append(f'exten => {opt.digit},1,NoOp(IVR: {opt.label})')
    if opt.route_type == 'ring_group' and opt.ring_group:
        members = opt.ring_group.members.filter(enabled=True).order_by('order').select_related('agent')
        eps = [(m.agent.sip_endpoint_name or f'agent_{m.agent_id}') for m in members]
        if eps:
            if opt.ring_group.strategy == 'sequential':
                _add_sequential_dial(lines, eps, timeout)
            else:
                _add_wake_dial(lines, '&'.join(f'PJSIP/{e}' for e in eps), timeout)
    elif opt.route_type == 'agent' and opt.agent:
        ep = opt.agent.sip_endpoint_name or f'agent_{opt.agent.pk}'
        _add_wake_dial(lines, f'PJSIP/{ep}', timeout)
    elif opt.route_type == 'forward' and opt.forward_number:
        lines.append(f' same => n,Dial(SIP/{opt.forward_number},{timeout})')
    lines.append(_DP_HANGUP)


def _add_ivr_lines(lines, ivr, timeout):
    # Background() — greeting বাজায় ও একই সাথে DTMF শোনে; digit চাপামাত্র সেই option
    # extension-এ jump করে। (Playback() DTMF ইন্টারাপ্ট করত না → greeting চলাকালীন চাপা
    # digit হারিয়ে যেত, পরে WaitExten timeout → call কেটে যেত।)
    lines.append(_DP_ANSWER)
    if ivr.greeting_file:
        lines.append(f' same => n,Background({ivr.greeting_file})')
    # greeting শেষেও কিছুক্ষণ digit-এর জন্য অপেক্ষা; কোনো input না এলে hangup।
    lines.append(f' same => n,WaitExten({ivr.timeout_seconds})')
    lines.append(_DP_HANGUP)

    # প্রতিটি digit option — wake-dial সহ (agent app killed/বন্ধ থাকলেও রিং)।
    # FCM wake আগেই গেছে: হটলাইন ডায়ালে _hotline_agents-এর 'ivr' branch সব option-এর
    # agent-কে push করে (greeting চলাকালীন তারা জাগে)। তাই এখানে wake-dial retry loop
    # দিলে digit চাপার পর register হওয়া পর্যন্ত অপেক্ষা করে ধরিয়ে দেয় (plain Dial নয়)।
    for opt in ivr.options.order_by('order', 'digit').select_related('ring_group', 'agent'):
        _add_ivr_option_lines(lines, opt, timeout)


def generate_hotline_dialplan(hotline) -> dict:
    """হটলাইন নম্বরের জন্য Asterisk dialplan config লিখে reload করে।
    VOIP_ENABLED=False হলেও config generate করে (dry-run মোড)।"""
    content = _generate_context(hotline)

    if not getattr(settings, 'VOIP_ENABLED', False):
        return {'status': 'dry_run', 'content': content}

    # ডিরেক্টরি তৈরি (isp user লিখতে পারলে; না পারলে graceful fail)।
    try:
        os.makedirs(HOTLINE_CONF_DIR, mode=0o2775, exist_ok=True)
    except PermissionError:
        return {
            'status': 'error',
            'detail': (
                f'{HOTLINE_CONF_DIR} ডিরেক্টরি নেই বা isp user লিখতে পারছে না। '
                'Install step: sudo install -d -o isp -g asterisk -m 2775 '
                f'{HOTLINE_CONF_DIR}'
            ),
        }

    # সব active hotline-এর config একত্রিত করে পুরো ফাইল rewrite (atomic)।
    _write_all_hotlines()
    reload_dialplan()
    return {'status': 'applied', 'file': HOTLINE_CONF_FILE}


def apply_full_dialplan():
    """পুরো hotline.conf (hotline routes + staff agent extension) পুনরায় লিখে
    Asterisk dialplan reload করে। hotline বা PBX agent পরিবর্তনের পর কল করতে হয়।"""
    if not getattr(settings, 'VOIP_ENABLED', False):
        return {'status': 'dry_run'}
    try:
        os.makedirs(HOTLINE_CONF_DIR, mode=0o2775, exist_ok=True)
    except PermissionError:
        return {'status': 'error', 'detail': f'{HOTLINE_CONF_DIR} লিখতে পারছে না'}
    _write_all_hotlines()
    reload_dialplan()
    return {'status': 'applied', 'file': HOTLINE_CONF_FILE}


def _write_all_hotlines():
    from voip.models import HotlineNumber, PBXAgent

    header = (
        '; ═══════════════════════════════════════════════════════════════════\n'
        '; ISP-PBX Hotline Dialplan — স্বয়ংক্রিয়ভাবে তৈরি (pbx_provision.py)।\n'
        '; হাতে এডিট করবেন না। Admin panel → VoIP → Hotline Control থেকে পরিচালনা করুন।\n'
        '; ═══════════════════════════════════════════════════════════════════\n\n'
        '; Main inbound context — SIP trunk এই context-এ DID পাঠায়।\n'
        '[isp-hotline-inbound]\n'
    )

    number_routes = []
    contexts      = []
    for hn in HotlineNumber.objects.filter(is_active=True).prefetch_related(
        'default_ring_group__members__agent',
        'default_ivr__options__ring_group__members__agent',
        'default_ivr__options__agent',
        'default_agent',
        'business_hours',
    ):
        ctx = f'hotline-{hn.pk}'
        number_routes.append(
            f'exten => {hn.number},1,Goto({ctx},s,1)'
        )
        contexts.append(_generate_context(hn))

    if not number_routes:
        number_routes.append('; এখনো কোনো active hotline নেই।')
        number_routes.append('exten => _X.,1,Hangup()')

    # [voip-internal] context-এ hotline নম্বর extend করি।
    # client app যখন sip:100@domain ডায়াল করে, এই extension isp-hotline-inbound-এ পাঠায়।
    # Asterisk একই context একাধিক ফাইলে থাকলে merge করে।
    internal_routes = [
        '; hotline নম্বর → voip-internal context (client app থেকে সরাসরি ডায়াল করা যায়)',
        '[voip-internal]',
    ]
    active_hotlines = [hn for hn in HotlineNumber.objects.filter(is_active=True)]
    if active_hotlines:
        for hn in active_hotlines:
            internal_routes.append(
                f'exten => {hn.number},1,Goto(isp-hotline-inbound,{hn.number},1)'
            )

    # ── Staff-to-staff direct extension calling ──────────────────────────────
    # একজন স্টাফ (admin/superadmin/employee) অন্য স্টাফের extension ডায়াল করলে
    # (যেমন 101/102/103) সরাসরি সেই agent-এর SIP endpoint রিং হয়।
    # গুরুত্বপূর্ণ: এখানে plain Dial নয়, wake-dial retry loop ব্যবহার করি। কারণ
    # employee/admin-এর অ্যাপ background/killed থাকলে তার SIP endpoint unregistered →
    # plain Dial সঙ্গে সঙ্গে CHANUNAVAIL দিয়ে কল কেটে দিত। AMI listener
    # (_maybe_push_pbx) এই extension dial ধরে routed agent-কে FCM wake push পাঠায়;
    # wake-dial Ringing()+retry app register হওয়া পর্যন্ত (~৪০s) অপেক্ষা করে ধরিয়ে দেয়।
    internal_routes.append('; PBX agent extension → সরাসরি সেই agent-কে রিং (staff-to-staff, wake-dial)')
    for ag in PBXAgent.objects.filter(is_active=True):
        if not ag.extension:
            continue
        ep = ag.sip_endpoint_name or f'agent_{ag.pk}'
        internal_routes.append(
            f'exten => {ag.extension},1,NoOp(Staff call → {ag.display_name} [{ep}])'
        )
        _add_wake_dial(internal_routes, f'PJSIP/{ep}', 30)
        internal_routes.append(_DP_HANGUP)
    internal_section = '\n'.join(internal_routes)

    body = header + '\n'.join(number_routes) + '\n\n' + '\n'.join(contexts) + '\n\n' + internal_section

    tmp = HOTLINE_CONF_FILE + '.tmp'
    with open(tmp, 'w') as f:
        f.write(body)
    os.chmod(tmp, 0o640)
    os.replace(tmp, HOTLINE_CONF_FILE)


def reload_dialplan():
    # AMI দিয়ে Asterisk dialplan reload — voip-internal/voip-announce অক্ষুণ্ণ থাকে।
    host   = getattr(settings, 'ASTERISK_AMI_HOST', '127.0.0.1')
    port   = int(getattr(settings, 'ASTERISK_AMI_PORT', 5038))
    user   = getattr(settings, 'ASTERISK_AMI_USER', '')
    secret = getattr(settings, 'ASTERISK_AMI_PASS', '')
    if not user:
        logger.warning('ASTERISK_AMI_USER সেট নেই — dialplan reload বাদ।')
        return
    s = socket.create_connection((host, port), timeout=5)
    try:
        s.recv(1024)
        msg = (
            f'Action: Login\r\nUsername: {user}\r\nSecret: {secret}\r\n\r\n'
            f'Action: Command\r\nCommand: dialplan reload\r\n\r\n'
            f'Action: Logoff\r\n\r\n'
        )
        s.sendall(msg.encode())
        time.sleep(0.3)
        s.recv(4096)
    finally:
        s.close()
    logger.info('Asterisk dialplan reloaded (PBX hotline).')
