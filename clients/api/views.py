# এই ফাইলটি clients API views - ক্লায়েন্ট ম্যানেজমেন্টের সব API endpoint।
import logging
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from django.db.models import Q

logger = logging.getLogger(__name__)


def _log_sync_failure(system, operation, username, exc, level='exception'):
    """RADIUS/MikroTik/session external-sync ব্যর্থতার জন্য single, greppable log format।
    Client lifecycle-এর ~২৪ জায়গায় (enable/disable/create/update/restore/left) RADIUS ও
    MikroTik-এর সাথে sync করা হয় — প্রতিটার নিজস্ব try/except ছিল, প্রতিটার হাতে-লেখা আলাদা
    বাংলা message। এই helper একটাই canonical format দেয় (system=.. operation=.. username=..)
    যাতে "গত ২৪ ঘণ্টায় সব RADIUS sync failure" এক grep দিয়ে বের করা যায়, এবং ভবিষ্যতে
    Sentry/alerting যোগ করতে হলে এক জায়গায় বদলালেই সব ~২৪ site-এ প্রযোজ্য হয়।

    এই helper শুধু logging format কেন্দ্রীয় করে — actual sync call sequence (enable-এ
    traffic-clear+group-restore, disable-এ Auth-Type-Reject, restore-এ create+disable
    ইত্যাদি) ইচ্ছাকৃতভাবে যার যার জায়গায় রাখা হয়েছে, কারণ প্রতিটা lifecycle event-এর
    ব্যবসায়িক নিয়ম সত্যিকারের ভিন্ন — সব একটা function-এ merge করা production billing
    system-এ ঝুঁকিপূর্ণ হতো।

    level='exception' (ডিফল্ট, traceback সহ — single/primary router-এ সরাসরি client-এর
    কাজ আটকে যাওয়া failure) অথবা 'warning' (multi-server best-effort loop iteration, বা
    non-critical cleanup — অন্য router/step ঠিকমতো চলতে থাকবে)।
    """
    msg = "External sync failed: system=%s operation=%s username=%s error=%s"
    if level == 'warning':
        logger.warning(msg, system, operation, username, exc)
    else:
        logger.exception(msg, system, operation, username, exc)


# পুনরাবৃত্ত literal — S1192 এড়াতে module constant
_SQL_B_STATUS = 'B.Status'
_SQL_M_BILL = 'M.Bill'

class ClientPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 500
from clients.models import (
    Client, LeftClient, ChangeRequest, ClientScheduler,
    ClientChangeLog, ClientStatusLog, ClientActivityLog,
)
from clients.api.serializers import (
    ClientListSerializer, ClientDetailSerializer, ClientCreateSerializer,
    ClientUpdateSerializer, LeftClientSerializer, ChangeRequestSerializer,
    ClientSchedulerSerializer, ClientChangeLogSerializer, ClientStatusLogSerializer,
    ClientActivityLogSerializer,
)


def _kick_session_via_coa_or_api(server, username: str) -> dict:
    """একটি Mikrotik server-এ user-এর active session terminate করে।

    প্রথমে CoA / Packet-of-Disconnect (RFC 5176, RADIUS standard) পাঠায়।
    NAK / unsupported হলে fallback হিসেবে RouterOS API দিয়ে
    /ppp/active থেকে session সরিয়ে দেয়।

    Why এই দুই-স্তর: CoA standard ও protocol-pure (radacct-ও সঠিকভাবে
    update হয় Acct-Terminate-Cause সহ)। কিন্তু পুরোনো router config-এ
    /radius/incoming accept=no থাকলে কাজ করে না — সেক্ষেত্রে API path।

    Returns: {'coa': {...} | None, 'api': bool}
    """
    from mikrotik_app.services.mikrotik_service import MikrotikService
    result = {'coa': None, 'api': False}

    # CoA secret = সেই Mikrotik-এ লিংকড RADIUS server-এর shared_secret
    coa_secret = ''
    try:
        rs = getattr(server, 'radius_server', None)
        if rs and getattr(rs, 'shared_secret', None):
            coa_secret = rs.shared_secret
    except Exception:
        pass

    if coa_secret:
        try:
            result['coa'] = MikrotikService.send_coa_disconnect(
                username=username,
                nas_host=server.host,
                shared_secret=coa_secret,
                coa_port=3799,
            )
        except Exception:
            result['coa'] = {'success': False, 'message': 'coa-exception'}

    # CoA-ACK পেলেও আমরা defensive ভাবে API দিয়েও মুছি — কোনো race
    # condition থাকলে session যাতে সত্যিই চলে যায়। API call cheap এবং
    # idempotent (session না থাকলে কিছু করে না)।
    try:
        ok = MikrotikService.from_server_model(server).disconnect_active_session(username)
        result['api'] = bool(ok)
    except Exception:
        result['api'] = False
    return result


def _secret_zone_str(client):
    """Zone › SubZone › Box একসাথে ' • ' দিয়ে যোগ (কোনোটা না থাকলে সেগমেন্ট বাদ)।"""
    zone_parts = []
    if client.zone:
        zone_parts.append(str(client.zone.name))
    if client.subzone:
        zone_parts.append(str(client.subzone.name))
    if client.box:
        zone_parts.append(str(client.box.name))
    return ' • '.join(zone_parts)


def _secret_bill_str(client):
    """monthly_bill → integer-friendly string (500.00 → '500', নাহলে .2f)।"""
    if client.monthly_bill is None:
        return ''
    bill = client.monthly_bill
    try:
        # পূর্ণসংখ্যা হলে দশমিক ছাড়াই দেখানো, না হলে .00 সহ
        return str(int(bill)) if bill == int(bill) else f"{bill:.2f}"
    except (ValueError, TypeError):
        return str(bill)


def _build_mikrotik_secret_comment(client) -> str:
    """Mikrotik /ppp/secret comment field-এর জন্য detailed client-info string তৈরি করে।

    Output format (একটি লাইন, `|` সেপারেটর দিয়ে):
      Customer ID: 1001 | Client Name: Rojy | Mobile Number: 01300000000 |
      Zone Name: Rajamehar • Uttor Para • Bagon Bari | Present Address: Bazar |
      Joining Date: 2026-03-24 | Package Name: 5 Mbps |
      Monthly Bill: 500 | Bill Expiry Date: 2026-04-24

    Why এই format:
      Mikrotik secret list-এর comment column থেকে এক নজরেই গ্রাহকের সম্পূর্ণ
      bill/zone/package context দেখা যায় — DB query ছাড়াই router admin
      বুঝতে পারেন কে কোন এলাকার, কোন প্যাকেজ ও কত টাকা বিল।

    Why `|` সেপারেটর এবং Zone-এ `•`:
      `|` Mikrotik comment-এ safe ASCII এবং readable। Zone/SubZone/Box-এর
      মধ্যে `•` ব্যবহার — visually আলাদা করে, কিন্তু overall string-কে
      একই pipe-segment হিসেবে রাখে যাতে regex parsing সহজ হয়।

    কেন optional field-গুলোকে skip না করে empty দেখাই:
      router admin দ্রুত স্ক্যান করার সময় position-ই (১ম, ২য়...) লক্ষ্য
      রাখেন — field মিসিং হলে position shift হলে পড়তে অসুবিধা।
    """
    # Zone › SubZone › Box একসাথে যোগ — কোনোটা না থাকলে সেগমেন্ট বাদ
    zone_str = _secret_zone_str(client)

    # Package name - speed_name থাকলে সেটাই বেশি descriptive (e.g. "5 Mbps")
    pkg_str = ''
    if client.package:
        pkg_str = client.package.speed_name or client.package.name or ''

    # Date গুলো ISO format-এ (YYYY-MM-DD) - locale-independent, parser-friendly
    join_str = client.connection_date.strftime('%Y-%m-%d') if client.connection_date else ''
    exp_str  = client.expiry_date.strftime('%Y-%m-%d')     if client.expiry_date     else ''

    # monthly_bill Decimal → integer-friendly string (500.00 → "500")
    bill_str = _secret_bill_str(client)

    parts = [
        f"Customer ID: {client.customer_id or ''}",
        f"Client Name: {client.full_name or ''}",
        f"Mobile Number: {client.phone or ''}",
        f"Zone Name: {zone_str}",
        f"Present Address: {client.address or ''}",
        f"Joining Date: {join_str}",
        f"Package Name: {pkg_str}",
        f"Monthly Bill: {bill_str}",
        f"Bill Expiry Date: {exp_str}",
    ]
    return ' | '.join(parts)


def _snapshot_change_log(client, user):
    """Client-এর বর্তমান state দিয়ে একটি ClientChangeLog তৈরি করে।"""
    ClientChangeLog.objects.create(
        client          = client,
        customer_id     = client.customer_id or '',
        username        = client.username or '',
        password        = client.password or '',
        full_name       = client.full_name or '',
        phone           = client.phone or '',
        service         = (client.package.name if client.package else ''),
        billing_status  = client.status or '',
        mikrotik_status = (client.status == 'active'),
        server          = (client.router.name if client.router else ''),
        speed           = client.pppoe_profile or '',
        package         = (client.package.name if client.package else ''),
        protocol        = (client.protocol.name if client.protocol else ''),
        client_type     = (client.client_type.name if client.client_type else ''),
        monthly_bill    = client.monthly_bill or 0,
        expiry_date     = client.expiry_date,
        zone            = (client.zone.name if client.zone else ''),
        changed_by      = user,
    )


def _save_client_traffic_before_clear(client, radius_svc):
    """Re-activation-এর আগে client-এর সব radacct data ClientMonthlyTraffic-এ সংরক্ষণ করে।
    এরপর radacct clear হলেও মাসিক ইতিহাস summary table-এ থাকে।
    """
    try:
        from clients.models import ClientMonthlyTraffic
        from django.db import transaction
        rows = radius_svc.get_user_monthly_aggregates(client.username)
        if not rows:
            return
        with transaction.atomic():
            for r in rows:
                obj, created = ClientMonthlyTraffic.objects.get_or_create(
                    client=client,
                    year_month=r['month'],
                    defaults={
                        'bytes_in':      r['bytes_in'],
                        'bytes_out':     r['bytes_out'],
                        'sessions':      r['sessions'],
                        'online_seconds': r['total_seconds'],
                    }
                )
                if not created:
                    # সর্বশেষ data দিয়ে আপডেট করি
                    obj.bytes_in       = r['bytes_in']
                    obj.bytes_out      = r['bytes_out']
                    obj.sessions       = r['sessions']
                    obj.online_seconds = r['total_seconds']
                    obj.save(update_fields=['bytes_in','bytes_out','sessions','online_seconds','updated_at'])
    except Exception as e:
        import logging
        logging.getLogger(__name__).exception("Traffic save before clear failed for %s: %s", client.username, e)


def _snapshot_status_log(client, user, remarks=''):
    """Enable/Disable হলে ClientStatusLog তৈরি করে।"""
    ClientStatusLog.objects.create(
        client          = client,
        customer_id     = client.customer_id or '',
        username        = client.username or '',
        password        = client.password or '',
        full_name       = client.full_name or '',
        phone           = client.phone or '',
        remarks         = remarks,
        mikrotik_status = (client.status == 'active'),
        changed_by      = user,
    )


def _client_radius_profile(client) -> str:
    """Client-এর router-specific RADIUS group/profile নাম ফেরত দেয়।

    Source of truth = client.pppoe_profile (admin client form-এ নির্বাচিত router-এর
    live profile তালিকা থেকে বেছেছে)। backward-compat: pppoe_profile খালি হলে
    package.mikrotik_profile।

    কেন router-specific: RADIUS group সব router-কে একই নাম পাঠায়। আগে নাম আসত
    global Package.mikrotik_profile থেকে — তাই router-ভেদে profile নাম আলাদা হলে
    (যেমন '5M' vs '5 Mbps') client ভুল/অস্তিত্বহীন profile পেত → IP পেত না।
    client.pppoe_profile ব্যবহার করলে প্রতিটি client তার নিজের router-এর বাস্তব
    profile নাম পায়, তাই একাধিক router থাকলেও collision হয় না।
    """
    prof = (getattr(client, 'pppoe_profile', '') or '').strip()
    if not prof and client.package and client.package.mikrotik_profile:
        prof = client.package.mikrotik_profile.strip()
    return prof


def _ensure_radius_group(svc, group_name: str) -> str:
    """RADIUS group-এ Mikrotik-Group := group_name নিশ্চিত করে।

    এটি router-কে user-টিকে ঐ নামের PPPoE profile-এ ফেলতে বলে; profile-ই তার নিজের
    remote-address (IP pool) দিয়ে IP assign করে। তাই আলাদা Framed-Pool পাঠানো লাগে না
    — এতে router-ভেদে pool নাম আলাদা হলেও 0.0.0.0 সমস্যা হয় না।
    """
    name = (group_name or '').strip()
    if not name:
        return ''
    try:
        svc.set_group_attribute(name, 'Mikrotik-Group', ':=', name)
    except Exception:
        pass
    return name


def _client_billing_classification(bill_month_str):
    """এই মাসের bill গুলো client-wise aggregate করে distinct client শ্রেণিবিন্যাস
    → (billing_clients, paid_c, partial_c, unpaid_c, waived_c)। মোট due ≤ 0 এবং
    কিছু আসলে paid (paid_sum>0) → Paid; due ≤ 0 কিন্তু paid_sum=0 এবং কোনো bill
    waived → Waived (আলাদা bucket — নইলে waived bill "Paid" হিসেবে গোনা হয়ে
    collection-rate KPI বাস্তবের চেয়ে বেশি দেখাত); due>0 কিন্তু কিছু paid → Partial;
    due>0, কিছুই paid নয় → Unpaid।"""
    from collections import defaultdict as _dd
    from billing.models import Bill
    _agg = _dd(lambda: [0.0, 0.0, False])   # client_id → [paid_sum, due_sum, has_waived]
    for _cid, _paid, _due, _status in Bill.objects.filter(
        bill_month=bill_month_str
    ).values_list('client_id', 'paid_amount', 'due_amount', 'status'):
        a = _agg[_cid]
        a[0] += float(_paid or 0)
        a[1] += float(_due or 0)
        if _status == 'waived':
            a[2] = True
    paid_c = partial_c = unpaid_c = waived_c = 0
    for _paid_sum, _due_sum, _has_waived in _agg.values():
        if _due_sum <= 0:
            if _paid_sum <= 0 and _has_waived:
                waived_c += 1
            else:
                paid_c += 1
        elif _paid_sum > 0:
            partial_c += 1
        else:
            unpaid_c += 1
    return len(_agg), paid_c, partial_c, unpaid_c, waived_c


def _months_back(now, count):
    """now থেকে পেছনে count মাস → [(month_abbr, year, month), …] পুরনো→নতুন ক্রমে।"""
    import calendar as _cal
    y, m = now.year, now.month
    out = []
    for i in range(count - 1, -1, -1):
        mi, yi = m - i, y
        while mi <= 0:
            mi += 12
            yi -= 1
        out.append((_cal.month_abbr[mi], yi, mi))
    return out


def _monthly_new_clients(qs, now):
    """শেষ ৬ মাসের নতুন client count।"""
    return [
        {'month': abbr, 'count': qs.filter(created_at__year=yi, created_at__month=mi).count()}
        for abbr, yi, mi in _months_back(now, 6)
    ]


def _monthly_billing_perf(now):
    """শেষ ১২ মাসের billing performance (net_amount sum)।"""
    from django.db.models import Sum
    from billing.models import Bill
    out = []
    for abbr, yi, mi in _months_back(now, 12):
        agg = Bill.objects.filter(bill_month=f'{yi}-{mi:02d}').aggregate(t=Sum('net_amount'))
        out.append({'month': abbr, 'count': float(agg['t'] or 0)})
    return out


def _enable_client_radius(client, old_status, is_expired):
    """enable-এ RADIUS: Auth-Type:Reject সরাই + group expiry অনুযায়ী (active/Blocked)।
    পূর্ণ active হলে নতুন billing cycle — traffic save+clear; expired-এ clear করি না।"""
    try:
        from radius_app.services.radius_service import RadiusService
        svc = RadiusService.for_client(client)
        if old_status in ('suspended', 'expired') and not is_expired:
            _save_client_traffic_before_clear(client, svc)
            svc.clear_client_traffic(client.username)
        svc.enable_user(client.username)
        if is_expired:
            # মেয়াদ শেষ — Expired PPPoE (Blocked_Group) profile, full internet নয়
            svc.move_to_blocked_group(client.username)
        else:
            original_group = _client_radius_profile(client)
            if original_group:
                _ensure_radius_group(svc, original_group)
                svc.restore_user_group(client.username, original_group)
    except Exception as e:
        _log_sync_failure('radius', 'enable', client.username, e)


def _enable_client_mikrotik(client):
    """enable-এ MikroTik PPPoE secret চালু (connect করতে পারবে; expired হলে RADIUS-ই
    Expired profile-এ সীমিত রাখবে)।"""
    try:
        if client.router:
            from mikrotik_app.services.mikrotik_service import MikrotikService
            MikrotikService.from_server_model(client.router).enable_pppoe_user(client.username)
    except Exception as e:
        _log_sync_failure('mikrotik', 'enable', client.username, e)


def _log_client_enabled(client, request, old_status, is_expired):
    """enable-এ ClientActivityLog (client_enabled event)।"""
    try:
        from clients.activity import log_client_activity
        performed_by = (
            (request.user.full_name or request.user.username)
            if request.user and request.user.is_authenticated else 'System'
        )
        note = ' (মেয়াদ শেষ — Expired profile-এ সীমিত)' if is_expired else ''
        log_client_activity(
            client, 'client_enabled',
            title='সংযোগ সক্রিয় করা হয়েছে',
            description=(
                f'Client List থেকে manually Activate করা হয়েছে | '
                f'পূর্বের Status: {old_status} → {client.status}{note} | '
                f'By: {performed_by}'
            ),
            performed_by=performed_by,
            user=request.user if request.user.is_authenticated else None,
        )
    except Exception:
        pass


_CLIENT_TRACKED_FIELDS = [
    # (field_attr, display_label, FK_name_attr_or_None) — perform_update change-diff-এর জন্য
    ('full_name',           'নাম',              None),
    ('father_name',         'পিতার নাম',        None),
    ('phone',               'মোবাইল',           None),
    ('alt_phone',           'বিকল্প মোবাইল',    None),
    ('email',               'ইমেইল',            None),
    ('nid',                 'NID',               None),
    ('address',             'ঠিকানা',            None),
    ('area',                'এলাকা',             None),
    ('house_name',          'বাড়ির নাম',        None),
    ('username',            'Username',          None),
    ('password',            'Password',          None),
    ('ip_address',          'IP Address',        None),
    ('mac_address',         'MAC Address',       None),
    ('zone',                'Zone',              'name'),
    ('subzone',             'Sub Zone',          'name'),
    ('box',                 'Box',               'name'),
    ('package',             'Package',           'name'),
    ('protocol',            'Protocol',          'name'),
    ('router',              'Server',            'name'),
    ('client_type',         'Client Type',       'name'),
    ('pppoe_profile',       'PPPoE Profile',     None),
    ('monthly_bill',        'মাসিক বিল',         None),
    ('discount',            'ডিসকাউন্ট',         None),
    ('expiry_day',          'Expiry Day',        None),
    ('expiry_date',         'Expiry Date',       None),
    ('bill_date',           'Bill Date',         None),
    ('billing_start_month', 'Billing Start',     None),
    ('connection_date',     'Connection Date',   None),
    ('status',              'Status',            None),
    ('is_vip',              'VIP',               None),
    ('map_lat',             'Map Latitude',      None),
    ('map_lng',             'Map Longitude',     None),
    ('notes',               'Notes',             None),
]


def _tracked_val(obj, attr, fk_attr):
    v = getattr(obj, attr, None)
    if v is None:
        return ''
    if fk_attr:
        return getattr(v, fk_attr, '') or ''
    return str(v)


def _enforce_geo_permission(serializer, old, user):
    """map_lat/map_lng: edit → superadmin/admin বা 'location_edit' granular permission;
    clear (মান খালি করা) → শুধু superadmin/admin। permission নেই হলে validated_data থেকে pop।"""
    from role_permissions.utils import user_has_granular
    is_admin = getattr(user, 'role', '') in ('superadmin', 'admin')
    can_edit_loc = is_admin or user_has_granular(user, 'common', 'location_edit')
    for geo in ('map_lat', 'map_lng'):
        if geo in serializer.validated_data:
            new_val = serializer.validated_data[geo]
            old_val = getattr(old, geo, None)
            is_clearing = (new_val in (None, '')) and (old_val not in (None, ''))
            if is_clearing:
                if not is_admin:
                    serializer.validated_data.pop(geo)   # delete → শুধু admin
            elif not can_edit_loc:
                serializer.validated_data.pop(geo)        # edit → permission লাগবে


def _apply_expiry_status(client, new_status):
    """expiry_date = master switch — active↔expired toggle (manual suspended/inactive/left/
    cancelled override করে না)। Returns effective new_status (client.status-ও update হয়)।"""
    from django.utils import timezone as _tz
    _today = _tz.localdate()
    if client.expiry_date:
        if client.expiry_date < _today and new_status == 'active':
            client.status = 'expired'
            client.save(update_fields=['status'])
            return 'expired'
        if client.expiry_date >= _today and new_status == 'expired':
            client.status = 'active'
            client.save(update_fields=['status'])
            return 'active'
    return new_status


def _radius_status_transition(svc, client, old_status, new_status, new_group):
    """status transition lifecycle — active→enable+group, suspended/expired→Blocked_Group,
    inactive/left→disable।"""
    if new_status == 'active':
        if old_status in ('suspended', 'expired'):
            # ১. আগে সব মাসিক data ClientMonthlyTraffic-এ save; ২. radacct clear (নতুন cycle)
            _save_client_traffic_before_clear(client, svc)
            svc.clear_client_traffic(client.username)
        svc.enable_user(client.username)
        if new_group:
            svc.restore_user_group(client.username, new_group)
    elif new_status in ('suspended', 'expired'):
        # Auth-Type:Reject মুছে Blocked_Group (walled garden — payment page দেখতে পারে)
        svc.enable_user(client.username)
        svc.move_to_blocked_group(client.username)
    else:
        # inactive / left / cancelled — সম্পূর্ণ blocked
        svc.disable_user(client.username)


def _sync_radius_on_update(client, old, old_password, old_package_group, old_status,
                           new_password, new_group, new_status):
    """update-এ RADIUS sync — নেই হলে create; পাসওয়ার্ড/group/status/username/router বদল handle।"""
    from radius_app.services.radius_service import RadiusService
    try:
        svc = RadiusService.for_client(client)

        # router বদলে ভিন্ন RADIUS server হলে পুরনো server-এ orphan entry থেকে যায় —
        # নতুন server-এ sync করার আগে পুরনো server থেকে user মুছে দিই। client-এর আগে
        # কোনো router না থাকলেও (old.router_id=None) for_client() default server-এ
        # fallback করে থাকে, তাই এখানে old.router_id truthy-check বাদ দেওয়া হয়েছে —
        # নইলে "router ছিল না → router assign করা হলো" transition-এ পুরনো default
        # server-এর entry কখনো clean হতো না।
        if old.router_id != client.router_id:
            try:
                old_svc = RadiusService.for_client(old)
                if old_svc.connection_identity() != svc.connection_identity():
                    old_svc.delete_user(old.username)
            except Exception as e:
                _log_sync_failure('radius', 'old_server_cleanup', old.username, e, level='warning')

        # username edit করে বদলালে পুরনো credential নতুন username-এ migrate করি
        # (নইলে পুরনো username দিয়েও PPPoE login চালু থেকে যাবে)
        if old.username and old.username != client.username:
            if not svc.rename_user(old.username, client.username):
                _log_sync_failure(
                    'radius', 'rename', f'{old.username}→{client.username}',
                    RuntimeError('rename_user() returned False'), level='warning'
                )

        if not svc.user_exists(client.username):
            # RADIUS-এ নেই — সম্পূর্ণ নতুন insert
            svc.create_user(client.username, new_password)
            if new_group:
                _ensure_radius_group(svc, new_group)
                svc.set_user_group(client.username, new_group)
            if new_status != 'active':
                svc.disable_user(client.username)
        else:
            # পাসওয়ার্ড বদলেছে
            if old_password != new_password:
                svc.change_password(client.username, new_password)
            # প্যাকেজ/গ্রুপ বদলেছে (suspended/expired-এ Blocked_Group থাকলে status block handle করবে)
            if (old_package_group != new_group and new_group
                    and new_status not in ('suspended', 'expired')):
                _ensure_radius_group(svc, new_group)
                svc.set_user_group(client.username, new_group)
            if old_status != new_status:
                _radius_status_transition(svc, client, old_status, new_status, new_group)
    except Exception as e:
        _log_sync_failure('radius', 'update', client.username, e)


def _sync_mikrotik_secret_on_update(client, old, new_group, new_status):
    """client info edit-এ Mikrotik /ppp/secret upsert (password/profile/comment refresh);
    router পাল্টালে পুরনো router থেকে orphan secret মুছি। 'left' status আলাদা handle (skip)।"""
    if new_status == 'left':
        return
    try:
        from mikrotik_app.services.mikrotik_service import MikrotikService
        # router পাল্টালে পুরনো router থেকে orphan secret মুছে দিই
        if old.router_id and old.router_id != client.router_id:
            try:
                MikrotikService.from_server_model(old.router).delete_pppoe_user(client.username)
            except Exception as e:
                _log_sync_failure('mikrotik', 'old_router_cleanup', client.username, e, level='warning')
        if client.router:
            sync_profile = client.pppoe_profile or new_group or 'default'
            MikrotikService.from_server_model(client.router).create_pppoe_user(
                username=client.username,
                password=client.password,
                profile=sync_profile,
                comment=_build_mikrotik_secret_comment(client),
            )
    except Exception as e:
        _log_sync_failure('mikrotik', 'update', client.username, e)


def _kick_sessions_on_update(client, old_status, new_status, old_package_group, new_group):
    """active session terminate (CoA + API fallback) — status non-active হলে, বা package/
    profile (group) বদলালে, বা suspended/expired→active reactivate হলে (নতুন profile/IP পেতে)।"""
    group_changed = bool(new_group and old_package_group != new_group)
    reactivated = old_status in ('suspended', 'expired') and new_status == 'active'
    if (old_status != new_status and new_status != 'active') \
            or (new_status == 'active' and (group_changed or reactivated)):
        try:
            from mikrotik_app.services.mikrotik_service import MikrotikService
            from mikrotik_app.models import MikrotikServer
            for s in MikrotikServer.objects.filter(is_active=True):
                _kick_session_via_coa_or_api(s, client.username)
        except Exception as e:
            _log_sync_failure('mikrotik', 'session_kick', client.username, e, level='warning')


def _handle_client_left(client, request_user):
    """new_status='left' — LeftClient record + RADIUS user delete + সব router-এ secret delete।"""
    from django.utils import timezone
    LeftClient.objects.get_or_create(
        client=client,
        defaults={
            'left_date': timezone.now().date(),
            'final_due': client.due_amount,
            'created_by': request_user,
        }
    )
    # RADIUS থেকে user সম্পূর্ণ মুছে দেওয়া
    try:
        from radius_app.services.radius_service import RadiusService
        RadiusService.for_client(client).delete_user(client.username)
    except Exception as e:
        _log_sync_failure('radius', 'left_delete', client.username, e)
    # সব Mikrotik router থেকে PPPoE secret মুছে দেওয়া
    try:
        from mikrotik_app.models import MikrotikServer
        from mikrotik_app.services.mikrotik_service import MikrotikService
        for s in MikrotikServer.objects.filter(is_active=True):
            try:
                MikrotikService.from_server_model(s).delete_pppoe_user(client.username)
            except Exception as e:
                _log_sync_failure('mikrotik', f'left_delete_secret[server={s}]', client.username, e, level='warning')
    except Exception as e:
        _log_sync_failure('mikrotik', 'left_bulk_secret_cleanup', client.username, e)


def _handle_client_returned(client):
    """old_status='left' → ফিরে এসেছে — LeftClient delete + Mikrotik secret পুনরায় যোগ (disabled)।"""
    LeftClient.objects.filter(client=client).delete()
    try:
        if client.router:
            from mikrotik_app.services.mikrotik_service import MikrotikService
            profile = client.pppoe_profile or (
                client.package.mikrotik_profile if client.package else ''
            ) or 'default'
            MikrotikService.from_server_model(client.router).create_pppoe_user(
                username=client.username,
                password=client.password,
                profile=profile,
                comment=_build_mikrotik_secret_comment(client),
            )
    except Exception:
        pass


def _handle_left_status_change(client, old_status, new_status, request_user):
    """left-status transition — left-এ গেলে cleanup, left থেকে ফিরলে restore।"""
    if old_status == new_status:
        return
    if new_status == 'left':
        _handle_client_left(client, request_user)
    elif old_status == 'left':
        _handle_client_returned(client)


def _log_update_activity(client, old_status, new_status, old_snapshot, request_user):
    """update-এ enable/disable log (status change) + field-diff profile_updated log।"""
    try:
        from clients.activity import log_client_activity
        by = getattr(request_user, 'full_name', '') or request_user.username

        if old_status != new_status:
            # status change → enable/disable log
            if new_status == 'active':
                log_client_activity(client, 'client_enabled',
                    title='সংযোগ সক্রিয় (ম্যানুয়াল)',
                    description=f'পূর্বের Status: {old_status} → active',
                    performed_by=by, user=request_user)
            else:
                log_client_activity(client, 'client_disabled',
                    title=f'সংযোগ নিষ্ক্রিয় (ম্যানুয়াল) → {new_status}',
                    description=f'পূর্বের Status: {old_status} → {new_status}',
                    performed_by=by, user=request_user)

        # ── profile_updated: কোন fields পরিবর্তন হয়েছে diff তৈরি করা ──
        client.refresh_from_db()
        change_lines = []
        for attr, label, fk_attr in _CLIENT_TRACKED_FIELDS:
            # status পরিবর্তন আলাদা enable/disable লগে যায় — ডুপ্লিকেট এড়াতে বাদ
            if attr == 'status':
                continue
            old_v = old_snapshot.get(attr, '')
            new_v = _tracked_val(client, attr, fk_attr)
            if str(old_v) != str(new_v):
                change_lines.append(f'{label}: "{old_v}" → "{new_v}"')

        if change_lines:
            description = '\n'.join(change_lines)
            log_client_activity(client, 'profile_updated',
                title=f'প্রোফাইল আপডেট ({len(change_lines)} টি পরিবর্তন)',
                description=description,
                performed_by=by, user=request_user)
        elif old_status == new_status:
            # কোনো পরিবর্তন নেই (শুধু save হয়েছে)
            log_client_activity(client, 'profile_updated',
                title='প্রোফাইল Save (কোনো পরিবর্তন নেই)',
                description='তথ্য সম্পাদনা ফর্ম Submit করা হয়েছে কিন্তু কোনো ডেটা পরিবর্তন হয়নি।',
                performed_by=by, user=request_user)
    except Exception:
        pass


def _row_str(row, key, *aliases):
    """row থেকে key (বা aliases) — প্রথম non-empty stripped string; নাহলে ''।"""
    for k in (key,) + aliases:
        v = str(row.get(k) or '').strip()
        if v:
            return v
    return ''


def _row_fk(row, cache, *keys):
    """row-এর keys দিয়ে case-insensitive cache lookup → FK object বা None।"""
    for key in keys:
        val = str(row.get(key) or '').strip().lower()
        if val and val in cache:
            return cache[val]
    return None


def _parse_import_date(val):
    """একাধিক common format থেকে date parse; না পারলে None।"""
    import datetime
    if not val:
        return None
    raw = str(val).strip()
    for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y', '%m/%d/%Y', '%Y/%m/%d'):
        try:
            return datetime.datetime.strptime(raw, fmt).date()
        except ValueError:
            pass
    return None


def _next_import_cid():
    """DB-তে সর্বোচ্চ numeric customer_id + 1 (6-digit zero-padded)।"""
    from django.db import connection as _conn
    with _conn.cursor() as cur:
        cur.execute("SELECT MAX(CAST(customer_id AS INTEGER)) FROM clients "
                    "WHERE customer_id ~ '^[0-9]+$'")
        mx = cur.fetchone()[0] or 0
    return str(mx + 1).zfill(6)


def _resolve_import_cid(row, used_cids):
    """row-এ Customer ID unique হলে সেটাই; নাহলে/collision হলে auto-generate (batch dedup)।"""
    wanted = _row_str(row, 'Customer ID', 'CustomerID', 'customer_id')
    if (wanted and wanted not in used_cids
            and not Client.objects.filter(customer_id=wanted).exists()):
        used_cids.add(wanted)
        return wanted
    cid = _next_import_cid()
    while cid in used_cids:
        cid = str(int(cid) + 1).zfill(6)
    used_cids.add(cid)
    return cid


def _import_row_missing(row, sel_package):
    """required field validation → missing label list। Mobile/Zone ঐচ্ছিক; Profile ও
    M.Bill package দেওয়া থাকলে required নয়।"""
    missing = []
    if not _row_str(row, 'Name'):                 missing.append('Name')
    if not _row_str(row, 'UserName', 'Username'): missing.append('UserName')
    if not _row_str(row, 'Password'):             missing.append('Password')
    if not _row_str(row, 'Protocol'):             missing.append('Protocol')
    if not _row_str(row, 'Package'):              missing.append('Package')
    _has_pkg = bool(_row_str(row, 'Package')) or bool(sel_package)
    if not _row_str(row, 'Profile') and not _has_pkg:      missing.append('Profile')
    if not _row_str(row, _SQL_B_STATUS):                   missing.append(_SQL_B_STATUS)
    if not _row_str(row, _SQL_M_BILL) and not _has_pkg:    missing.append(_SQL_M_BILL)
    return missing


def _build_import_ctx(request):
    """bulk import-এর lookup cache (case-insensitive) + user-selected router/package +
    batch state (used_cids, user, logger)।"""
    import logging as _log
    from configuration.models import Zone, Package, ProtocolType
    from mikrotik_app.models import MikrotikServer

    zone_cache = {z.name.lower(): z for z in Zone.objects.all()}
    # Package — নাম দিয়ে; নাম না মিললে mikrotik_profile দিয়েও (যেমন "5M" → "5 Mbps")
    pkg_cache = {}
    for p in Package.objects.all():
        pkg_cache[p.name.lower()] = p
        _prof = (getattr(p, 'mikrotik_profile', '') or '').strip().lower()
        if _prof and _prof not in pkg_cache:
            pkg_cache[_prof] = p
    proto_cache = {pr.name.lower(): pr for pr in ProtocolType.objects.all()}
    all_routers = list(MikrotikServer.objects.all())
    router_cache = {r.name.lower(): r for r in all_routers}
    # Server না দিলে একমাত্র/প্রথম server স্বয়ংক্রিয়
    default_router = all_routers[0] if len(all_routers) == 1 else None

    sel_router = None
    _rid = request.data.get('router_id')
    if _rid:
        sel_router = next((r for r in all_routers if str(r.id) == str(_rid)), None)
    sel_package = None
    _pid = request.data.get('package_id')
    if _pid:
        sel_package = Package.objects.filter(id=_pid).first()

    return {
        'zone_cache': zone_cache, 'pkg_cache': pkg_cache, 'proto_cache': proto_cache,
        'router_cache': router_cache, 'default_router': default_router,
        'sel_router': sel_router, 'sel_package': sel_package,
        'used_cids': set(), 'user': request.user,
        'logger': _log.getLogger(__name__),
    }


def _import_resolve_zone(row, ctx):
    """Zone নাম cache-এ মিললে সেটা; না মিললে স্বয়ংক্রিয় তৈরি (faithful import)।
    Zone কলাম খালি হলে None।"""
    _zname = _row_str(row, 'Zone')
    if not _zname:
        return None
    zone = ctx['zone_cache'].get(_zname.lower())
    if not zone:
        from configuration.models import Zone
        zone = Zone.objects.create(name=_zname, is_active=True)
        ctx['zone_cache'][_zname.lower()] = zone
    return zone


def _import_parse_billing(row, package):
    """import row থেকে monthly_bill, bill_day, billing status parse + validate।
    Returns (monthly, bill_day, b_status)।"""
    b_status = _row_str(row, _SQL_B_STATUS).lower() or 'active'
    if b_status not in ('active', 'inactive', 'suspended', 'expired', 'cancelled'):
        b_status = 'active'
    pkg_price = float(package.price) if package else 0
    try:
        monthly = float(_row_str(row, _SQL_M_BILL) or 0) or pkg_price
    except ValueError:
        monthly = pkg_price
    try:
        bill_day = int(float(_row_str(row, 'Bill.Date') or 1))
    except ValueError:
        bill_day = 1
    return monthly, bill_day, b_status


def _build_import_client(idx, row, ctx):
    """একটি row validate + FK resolve + parse + Client create।
    Returns (client, detail, params); fail হলে (None, result_dict, None)।"""
    sel_package = ctx['sel_package']
    # ── required field validation ──
    missing = _import_row_missing(row, sel_package)
    if missing:
        return None, {'row': idx, 'status': 'skip',
                      'reason': f'Required ফাঁকা: {", ".join(missing)}'}, None

    username = _row_str(row, 'UserName', 'Username')
    if Client.objects.filter(username=username).exists():
        return None, {'row': idx, 'status': 'skip',
                      'reason': f'Username "{username}" ইতোমধ্যে আছে'}, None

    name = _row_str(row, 'Name')
    mobile = _row_str(row, 'Mobile')
    password = _row_str(row, 'Password')
    zone = _import_resolve_zone(row, ctx)
    package = _row_fk(row, ctx['pkg_cache'], 'Package') or sel_package
    protocol = _row_fk(row, ctx['proto_cache'], 'Protocol', 'Prot.Type')
    router = ctx['sel_router'] or _row_fk(row, ctx['router_cache'], 'Server') or ctx['default_router']

    profile = _row_str(row, 'Profile') or (package.mikrotik_profile if package else '') or 'default'
    monthly, bill_day, b_status = _import_parse_billing(row, package)

    from django.utils import timezone as _tz
    expiry_date = _parse_import_date(_row_str(row, 'Exp.Date'))
    joining_date = _parse_import_date(_row_str(row, '_joining')) or _tz.now().date()
    email = _row_str(row, 'Email') or ''   # NOT NULL — খালি string দিতে হবে

    try:
        client = Client.objects.create(
            customer_id     = _resolve_import_cid(row, ctx['used_cids']),
            full_name       = name,
            phone           = mobile,
            email           = email,
            zone            = zone,
            protocol        = protocol,
            package         = package,
            router          = router,
            username        = username,
            password        = password,
            pppoe_profile   = profile,
            monthly_bill    = monthly,
            bill_date       = bill_day,
            expiry_date     = expiry_date,
            connection_date = joining_date,
            status          = b_status,
            created_by      = ctx['user'],
        )
    except Exception as exc:
        return None, {'row': idx, 'status': 'error', 'reason': str(exc)}, None

    detail = {
        'row': idx, 'status': 'ok', 'customer_id': client.customer_id,
        'username': username, 'radius': False, 'mikrotik': False, 'invoice': False,
    }
    params = {'b_status': b_status, 'router': router, 'profile': profile,
              'package': package, 'joining_date': joining_date}
    return client, detail, params


def _bulk_radius_setup(client, b_status, detail, logger):
    """bulk import — RADIUS user create + group + disable if inactive।"""
    try:
        from radius_app.services.radius_service import RadiusService
        svc = RadiusService.for_client(client)
        svc.create_user(client.username, client.password)
        group = _client_radius_profile(client)
        if group:
            _ensure_radius_group(svc, group)
            svc.set_user_group(client.username, group)
        if b_status != 'active':
            svc.disable_user(client.username)
        detail['radius'] = True
    except Exception as exc:
        detail['radius_error'] = str(exc)
        logger.exception('Bulk import RADIUS error [%s]: %s', client.username, exc)


def _bulk_mikrotik_setup(client, router, profile, detail, logger):
    """bulk import — Mikrotik PPPoE secret create (detailed comment সহ)।"""
    try:
        if router:
            from mikrotik_app.services.mikrotik_service import MikrotikService
            MikrotikService.from_server_model(router).create_pppoe_user(
                username=client.username,
                password=client.password,
                profile=profile,
                comment=_build_mikrotik_secret_comment(client),
            )
            detail['mikrotik'] = True
    except Exception as exc:
        detail['mikrotik_error'] = str(exc)
        logger.exception('Bulk import Mikrotik error [%s]: %s', client.username, exc)


def _bulk_invoice_setup(client, package, joining_date, detail, logger):
    """bulk import — Auto Invoice (free package হলে বিল নয়)।"""
    try:
        if package and not getattr(package, 'is_free', False):
            from billing.services import BillingService
            from django.utils import timezone as _tz
            bm = (joining_date or _tz.now().date()).strftime('%Y-%m')
            BillingService.generate_bill_for_client(
                client_id=client.id,
                bill_month=bm,
                notes=f'Bulk import ({client.customer_id})',
            )
            detail['invoice'] = True
    except Exception as exc:
        detail['invoice_error'] = str(exc)
        logger.exception('Bulk import invoice error [%s]: %s', client.username, exc)


def _import_one_client(idx, row, ctx):
    """একটি row → Client create + RADIUS/Mikrotik/invoice। Returns (result_dict, is_success)।"""
    client, detail, params = _build_import_client(idx, row, ctx)
    if client is None:
        return detail, False
    logger = ctx['logger']
    _bulk_radius_setup(client, params['b_status'], detail, logger)
    _bulk_mikrotik_setup(client, params['router'], params['profile'], detail, logger)
    _bulk_invoice_setup(client, params['package'], params['joining_date'], detail, logger)
    return detail, True


def _mikrotik_online_usernames():
    """সব active Mikrotik server-এর /ppp/active থেকে online username set (lowercase)।
    import fail হলে caller-এর কাছে exception propagate করে (fallback ঠিক রাখতে)।"""
    from mikrotik_app.services.mikrotik_service import MikrotikService
    from mikrotik_app.models import MikrotikServer
    online_names = set()
    for server in MikrotikServer.objects.filter(is_active=True):
        try:
            conns = MikrotikService.from_server_model(server).get_active_connections()
            for c in conns:
                name = c.get('name') or c.get('user') or c.get('username', '')
                if name:
                    online_names.add(name.lower())
        except Exception:
            pass
    return online_names


def _current_month_range(now_local):
    """now_local-এর চলতি মাসের [month_start, next_month_start) — DB CONVERT_TZ এড়াতে
    Python-এ range হিসাব করে gte/lt filter করা হয়।"""
    month_start = now_local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if now_local.month == 12:
        month_end = now_local.replace(
            year=now_local.year + 1, month=1, day=1,
            hour=0, minute=0, second=0, microsecond=0,
        )
    else:
        month_end = now_local.replace(
            month=now_local.month + 1, day=1,
            hour=0, minute=0, second=0, microsecond=0,
        )
    return month_start, month_end


class ClientViewSet(viewsets.ModelViewSet):
    # ক্লায়েন্ট CRUD API
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = ClientPagination
    search_fields = ['=id', 'customer_id', 'full_name', 'phone', 'username', 'address']
    filterset_fields = ['status', 'zone', 'subzone', 'box', 'package', 'protocol', 'router', 'client_type']
    ordering_fields = ['created_at', 'full_name', 'customer_id']

    def get_queryset(self):
        qs = Client.objects.select_related(
            'zone', 'subzone', 'box', 'package', 'router',
            'router__radius_server', 'protocol', 'client_type',
        ).order_by('-created_at')
        if self.action == 'list':
            qs = self._filter_list_queryset(qs)
        return qs

    def _filter_list_queryset(self, qs):
        """list action-এর query-param filters — online/date-range/new/renewed।"""
        p = self.request.query_params
        qs = qs.exclude(status='left').exclude(left_info__isnull=False)

        # ?online=1 → এখন PPPoE active; ?online=0 → offline (Mikrotik active নয়)
        online = p.get('online')
        if online == '1':
            try:
                qs = qs.filter(username__in=_mikrotik_online_usernames())
            except Exception:
                qs = qs.none()
        elif online == '0':
            try:
                qs = qs.exclude(username__in=_mikrotik_online_usernames())
            except Exception:
                pass

        # ?date_from / ?date_to → connection_date range (যোগদানের তারিখ)
        df = p.get('date_from')
        dt = p.get('date_to')
        if df:
            qs = qs.filter(connection_date__gte=df)
        if dt:
            qs = qs.filter(connection_date__lte=dt)

        # ?new=1 → চলতি মাসের নতুন ক্লায়েন্ট (Python month-range, DB CONVERT_TZ এড়াতে)
        if p.get('new') == '1':
            from django.utils import timezone as _tz
            month_start, month_end = _current_month_range(_tz.localtime())
            qs = qs.filter(created_at__gte=month_start, created_at__lt=month_end)

        # ?renewed=1 → Left list থেকে ফিরে আসা ক্লায়েন্ট
        if p.get('renewed') == '1':
            qs = qs.filter(is_renewed=True)

        return qs

    def get_serializer_class(self):
        if self.action == 'list':
            return ClientListSerializer
        if self.action == 'create':
            return ClientCreateSerializer
        if self.action in ['update', 'partial_update']:
            return ClientUpdateSerializer
        return ClientDetailSerializer

    @staticmethod
    def _next_customer_id():
        """
        CompanySetup-এর customer_id_digits ও customer_id_start_number অনুযায়ী
        পরবর্তী unique Customer ID (শুধু numeric) তৈরি করে।
        উদাহরণ: digits=5, start=100 → 00100, 00101, 00102 …
        """
        from system_settings.models import CompanySetup
        setup, _ = CompanySetup.objects.get_or_create(
            id=1, defaults={'name': 'ISP Company'}
        )
        digits    = max(1, min(20, setup.customer_id_digits or 5))
        start_num = max(1, setup.customer_id_start_number or 1)

        # শুধু pure-numeric customer_id-গুলো বিবেচনায় নাও
        last = (
            Client.objects.filter(customer_id__regex=r'^\d+$')
            .order_by('-customer_id')
            .values_list('customer_id', flat=True)
            .first()
        )
        try:
            last_num = int(last) if last else 0
        except (TypeError, ValueError):
            last_num = 0
        # next = max(last+1, start_num) — start_number floor হিসেবে কাজ করে
        next_num = max(last_num + 1, start_num)
        fmt = f"{{:0{digits}d}}"
        while Client.objects.filter(customer_id=fmt.format(next_num)).exists():
            next_num += 1
        return fmt.format(next_num)

    def perform_create(self, serializer):
        client = serializer.save(created_by=self.request.user, customer_id=self._next_customer_id())

        from radius_app.services.radius_service import RadiusService
        from mikrotik_app.services.mikrotik_service import MikrotikService

        # RADIUS group = client-এর router-specific profile (pppoe_profile)।
        group = _client_radius_profile(client)
        profile = client.pppoe_profile or group or 'default'

        # ১. RADIUS — auth, group (Mikrotik-Group)
        try:
            svc = RadiusService.for_client(client)
            svc.create_user(client.username, client.password)
            if group:
                _ensure_radius_group(svc, group)
                svc.set_user_group(client.username, group)
            if client.status != 'active':
                svc.disable_user(client.username)
        except Exception as e:
            _log_sync_failure('radius', 'create', client.username, e)

        # ২. Mikrotik — local secret disabled=yes (reference only, auth RADIUS থেকে)
        # comment-এ গ্রাহকের সম্পূর্ণ profile snapshot পাঠানো হচ্ছে যাতে router
        # admin secret list থেকে এক নজরেই কাস্টমার চিনতে পারেন।
        try:
            if client.router:
                MikrotikService.from_server_model(client.router).create_pppoe_user(
                    username=client.username,
                    password=client.password,
                    profile=profile,
                    comment=_build_mikrotik_secret_comment(client),
                )
        except Exception as e:
            _log_sync_failure('mikrotik', 'create', client.username, e)

        # ৩. Auto Invoice — connection_date মাসের জন্য বিল তৈরি
        import logging as _log
        _logger = _log.getLogger(__name__)
        try:
            from billing.services import BillingService
            from django.utils import timezone as _tz
            if client.package and getattr(client.package, 'is_free', False):
                _logger.info('Auto-invoice skipped: %s free package।', client.customer_id)
            elif client.package:
                conn_date = client.connection_date or _tz.now().date()
                bill_month = conn_date.strftime('%Y-%m')
                result = BillingService.generate_bill_for_client(
                    client_id=client.id,
                    bill_month=bill_month,
                    notes=f'Auto-generated on registration ({client.customer_id})',
                )
                _logger.info('Auto-invoice: %s | %s', client.customer_id, result)
            else:
                _logger.warning('Auto-invoice skipped: %s has no package.', client.customer_id)
        except Exception as _e:
            _logger.exception('Auto-invoice failed for %s: %s', client.customer_id, _e)

    def update(self, request, *args, **kwargs):
        # খালি map_lat/map_lng (UI-তে field clear করে delete) → None-এ রূপান্তর,
        # যাতে DecimalField serializer গ্রহণ করে এবং perform_update-এর clear logic চলে।
        data = request.data
        if hasattr(data, '_mutable'):
            data._mutable = True
        for geo in ('map_lat', 'map_lng'):
            if geo in data and (data.get(geo) is None or str(data.get(geo)).strip() == ''):
                data[geo] = None
        return super().update(request, *args, **kwargs)

    def perform_update(self, serializer):
        old = self.get_object()
        old_password = old.password
        old_package_group = _client_radius_profile(old)
        old_status = old.status

        # ── change-diff এর জন্য আগের field values snapshot ──────────
        old_snapshot = {attr: _tracked_val(old, attr, fk_attr)
                        for attr, _, fk_attr in _CLIENT_TRACKED_FIELDS}

        # ── Latitude/Longitude permission enforcement ──────────────────────
        _enforce_geo_permission(serializer, old, self.request.user)

        client = serializer.save()
        new_password = client.password
        new_group = _client_radius_profile(client)

        # ── expiry_date = master switch (active↔expired toggle) ──
        new_status = _apply_expiry_status(client, client.status)

        # ─── RADIUS sync (create / password / group / status / username / router transition) ──
        _sync_radius_on_update(client, old, old_password, old_package_group, old_status,
                               new_password, new_group, new_status)

        # ─── Mikrotik secret sync ('left' আলাদা handle) ──
        _sync_mikrotik_secret_on_update(client, old, new_group, new_status)

        # ─── Mikrotik active session terminate (CoA + API fallback) ──
        _kick_sessions_on_update(client, old_status, new_status, old_package_group, new_group)

        # ─── Left Client record + secret sync (left ↔ returned) ──
        _handle_left_status_change(client, old_status, new_status, self.request.user)

        # ─── Change log snapshot ──────────────────────────────────
        try:
            _snapshot_change_log(client, self.request.user)
        except Exception:
            pass

        # ─── Activity log (enable/disable + profile-diff) ──
        _log_update_activity(client, old_status, new_status, old_snapshot, self.request.user)

    @action(detail=True, methods=['post'], url_path='enable')
    def enable_client(self, request, pk=None):
        # Active lifecycle: Auth-Type:Reject সরাও + Blocked_Group থেকে
        # বের করে আসল প্যাকেজ group-এ ফেরাও। User পরের connect-এ
        # original IP pool ও speed profile পাবে।
        client = self.get_object()

        # Admin/Superadmin ছাড়া due থাকলে enable করা যাবে না
        ADMIN_ROLES = ('superadmin', 'admin')
        user_role = getattr(request.user, 'role', '')
        if user_role not in ADMIN_ROLES and float(client.due_amount or 0) > 0:
            return Response(
                {'error': f'বকেয়া ৳{client.due_amount} পরিশোধ না করে enable করার অনুমতি নেই।'},
                status=status.HTTP_403_FORBIDDEN,
            )

        old_status = client.status

        # ── expiry-aware activate ───────────────────────────────────────
        # লাইন চালু করার সময় মেয়াদ মেনে চলি (expiry = master switch):
        #   • expiry_date পার হয়ে গেলে → 'expired' (walled-garden, full internet
        #     নয় — বকেয়া/payment page পর্যন্ত সীমিত)।
        #   • নাহলে → 'active' (আগের মতো পূর্ণ ইন্টারনেট)।
        from django.utils import timezone as _tz
        is_expired = bool(client.expiry_date and client.expiry_date < _tz.localdate())
        client.status = 'expired' if is_expired else 'active'
        client.save()

        _enable_client_radius(client, old_status, is_expired)
        _enable_client_mikrotik(client)

        # ClientStatusLog (Enable/Disable Logs tab)
        try:
            _snapshot_status_log(client, request.user, remarks='Enabled manually from Client List')
        except Exception:
            pass
        # ClientActivityLog (Activity Log tab — client_enabled event)
        _log_client_enabled(client, request, old_status, is_expired)

        msg = (f'{client.full_name} activated — মেয়াদ শেষ, Expired profile-এ সীমিত (বকেয়া পরিশোধে পূর্ণ চালু হবে)।'
               if is_expired else f'{client.full_name} activated.')
        return Response({'status': client.status, 'message': msg})

    @action(detail=True, methods=['post'], url_path='disable')
    def disable_client(self, request, pk=None):
        # Manual suspend: Auth-Type:Reject বসাও — PPPoE login-ই হবে না।
        # Expired PPPoE profile শুধু expired status-এর জন্য (payment page)।
        client = self.get_object()
        old_status = client.status
        client.status = 'suspended'
        client.save()
        # RADIUS: Auth-Type:Reject বসাও (পুরোপুরি block — payment page নয়)
        try:
            from radius_app.services.radius_service import RadiusService
            svc = RadiusService.for_client(client)
            svc.disable_user(client.username)              # Auth-Type:Reject
        except Exception as e:
            _log_sync_failure('radius', 'disable', client.username, e)
        # Mikrotik — CoA/PoD আগে, fallback API
        try:
            from mikrotik_app.models import MikrotikServer
            for s in MikrotikServer.objects.filter(is_active=True):
                _kick_session_via_coa_or_api(s, client.username)
        except Exception as e:
            _log_sync_failure('mikrotik', 'session_kick', client.username, e, level='warning')
        # ClientStatusLog (Enable/Disable Logs tab)
        try:
            _snapshot_status_log(client, request.user, remarks='Disabled manually from Client List')
        except Exception:
            pass
        # ClientActivityLog (Activity Log tab — client_disabled event)
        try:
            from clients.activity import log_client_activity
            performed_by = (
                (request.user.full_name or request.user.username)
                if request.user and request.user.is_authenticated else 'System'
            )
            log_client_activity(
                client, 'client_disabled',
                title='সংযোগ নিষ্ক্রিয় করা হয়েছে',
                description=(
                    f'Client List থেকে manually Disable করা হয়েছে | '
                    f'পূর্বের Status: {old_status} → suspended | '
                    f'By: {performed_by}'
                ),
                performed_by=performed_by,
                user=request.user if request.user.is_authenticated else None,
            )
        except Exception:
            pass
        return Response({'status': 'disabled', 'message': f'{client.full_name} disabled.'})

    @action(detail=True, methods=['post'], url_path='kick-session')
    def kick_session(self, request, pk=None):
        """বর্তমান PPPoE session terminate করে — status পরিবর্তন ছাড়াই।

        ব্যবহার: speed/IP debug, IP renewal, troubleshooting — user
        পরবর্তী মুহূর্তে আবার auto-reconnect করবে।

        Flow: CoA / Packet of Disconnect (RFC 5176) → RouterOS API fallback।
        কোনো RADIUS DB change হয় না, কোনো status update হয় না।
        """
        client = self.get_object()
        results = []
        try:
            from mikrotik_app.models import MikrotikServer
            servers = MikrotikServer.objects.filter(is_active=True)
            for s in servers:
                r = _kick_session_via_coa_or_api(s, client.username)
                results.append({
                    'router': s.host,
                    'coa_ack': bool(r['coa'] and r['coa'].get('success')),
                    'coa_msg': (r['coa'] or {}).get('message', ''),
                    'api_disconnect': r['api'],
                })
        except Exception as e:
            return Response({'success': False, 'error': str(e)},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # ─── Activity log ───────────────────────────────────────────
        try:
            from clients.activity import log_client_activity
            performed_by = (
                (request.user.full_name or request.user.username)
                if request.user and request.user.is_authenticated else 'System'
            )
            log_client_activity(
                client, 'session_kicked',
                title='Active session terminate (CoA/PoD)',
                description=f'Manual kick from Client List | By: {performed_by} | '
                            f'{len(results)} router-এ চেষ্টা',
                performed_by=performed_by,
                user=request.user if request.user.is_authenticated else None,
            )
        except Exception:
            pass

        any_ok = any(r['coa_ack'] or r['api_disconnect'] for r in results)
        return Response({
            'success': any_ok,
            'message': f'Kicked {client.username}' if any_ok else 'No active session found',
            'routers': results,
        })

    @action(detail=False, methods=['post'], url_path='radacct-cleanup')
    def radacct_cleanup(self, request):
        """radacct-এ আটকে থাকা open sessions close করে দেয়।

        Why: NAS reboot / network drop-এর পর Accounting-Stop packet হারিয়ে
        গেলে radacct-এ session "open" থেকে যায় → online count ভুল হয়।
        হিস্টোরি মুছে না — শুধু stoptime + terminate cause সেট করে।
        """
        hours = int(request.data.get('hours', 24))
        username = request.data.get('username') or None
        try:
            from radius_app.services.radius_service import RadiusService
            from radius_app.models import RadiusServer
            total = 0
            servers = list(RadiusServer.objects.filter(is_active=True)) or [None]
            for rs in servers:
                svc = RadiusService.for_server(rs) if rs else RadiusService.get_default()
                total += svc.cleanup_stale_sessions(username=username, older_than_hours=hours)
            return Response({'success': True, 'closed_sessions': total,
                             'older_than_hours': hours, 'username': username})
        except Exception as e:
            return Response({'success': False, 'error': str(e)},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['post'], url_path='restore')
    def restore_client(self, request, pk=None):
        try:
            client = Client.objects.get(pk=pk)
        except Client.DoesNotExist:
            return Response({'error': 'Client not found.'}, status=status.HTTP_404_NOT_FOUND)
        if not LeftClient.objects.filter(client=client).exists():
            return Response({'error': 'Client is not in left list.'}, status=status.HTTP_400_BAD_REQUEST)
        from django.utils import timezone as _tz
        client.status     = 'inactive'
        client.is_renewed = True
        client.renewed_at = _tz.now()
        client.save()
        LeftClient.objects.filter(client=client).delete()

        group = _client_radius_profile(client)
        profile = client.pppoe_profile or group or 'default'

        # ১. RADIUS — user পুনরায় তৈরি করে disable করা (inactive → active হলে enable হবে)
        try:
            from radius_app.services.radius_service import RadiusService
            svc = RadiusService.for_client(client)
            svc.create_user(client.username, client.password)
            if group:
                _ensure_radius_group(svc, group)
                svc.set_user_group(client.username, group)
            svc.disable_user(client.username)
        except Exception as e:
            _log_sync_failure('radius', 'restore', client.username, e)

        # ২. Mikrotik — /ppp/secret পুনরায় যোগ করা (disabled=yes, RADIUS-only auth)
        # comment field-এ গ্রাহকের সর্বশেষ profile snapshot সংরক্ষণ
        try:
            if client.router:
                from mikrotik_app.services.mikrotik_service import MikrotikService
                MikrotikService.from_server_model(client.router).create_pppoe_user(
                    username=client.username,
                    password=client.password,
                    profile=profile,
                    comment=_build_mikrotik_secret_comment(client),
                )
        except Exception as e:
            _log_sync_failure('mikrotik', 'restore', client.username, e)

        return Response({'status': 'restored', 'message': f'{client.full_name} পুনরায় সক্রিয় করা হয়েছে।'})

    @action(detail=True, methods=['post'], url_path='sync-mac')
    def sync_mac(self, request, pk=None):
        # Mikrotik active session থেকে caller-id (MAC) নিয়ে client record আপডেট করা
        client = self.get_object()
        mac = None
        try:
            from mikrotik_app.models import MikrotikServer
            from mikrotik_app.services.mikrotik_service import MikrotikService
            for server in MikrotikServer.objects.filter(is_active=True):
                try:
                    connections = MikrotikService.from_server_model(server).get_active_connections()
                    for c in connections:
                        if c.get('name') == client.username:
                            mac = c.get('caller-id', '').strip()
                            break
                except Exception:
                    pass
                if mac:
                    break
        except Exception:
            pass
        if mac:
            client.mac_address = mac
            client.save(update_fields=['mac_address'])
            return Response({'mac_address': mac})
        return Response({'error': 'Client অনলাইনে নেই বা MAC পাওয়া যায়নি।'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=False, methods=['get'], url_path='due-clients')
    def due_clients(self, request):
        # বকেয়া ক্লায়েন্টের তালিকা
        queryset = self.get_queryset().filter(due_amount__gt=0)
        serializer = ClientListSerializer(queryset, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='expired-clients')
    def expired_clients(self, request):
        # মেয়াদ শেষ ক্লায়েন্টের তালিকা
        from django.utils import timezone
        queryset = self.get_queryset().filter(
            expiry_date__lt=timezone.now().date()
        ).exclude(status='cancelled')
        serializer = ClientListSerializer(queryset, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='client-stats')
    def client_stats(self, request):
        from django.utils import timezone
        now = timezone.now()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        qs = Client.objects
        return Response({
            'running':         qs.filter(status='active').count(),
            'new_this_month':  qs.filter(created_at__gte=month_start).count(),
            'expired':         qs.filter(status='expired').count(),
            'inactive':        qs.filter(status__in=['inactive', 'suspended']).count(),
        })

    # ─── Portal / App Registration (Customer Code + Password login) ──────────
    @action(detail=False, methods=['get'], url_path='portal-stats')
    def portal_stats(self, request):
        # ৩টি stat কার্ড: Total / App Users / Non-App Users
        qs = Client.objects
        total = qs.count()
        app_users = qs.exclude(app_password='').count()
        return Response({
            'total': total,
            'app_users': app_users,
            'non_app_users': total - app_users,
        })

    @action(detail=False, methods=['get'], url_path='portal-lookup')
    def portal_lookup(self, request):
        # USER NAME (ID) dropdown — client খুঁজে details auto-fill করতে
        search = (request.query_params.get('search') or '').strip()
        qs = Client.objects.select_related('zone').all()
        if search:
            qs = qs.filter(
                Q(customer_id__icontains=search) | Q(username__icontains=search) |
                Q(full_name__icontains=search)
            )
        qs = qs.order_by('customer_id')[:20]
        return Response([{
            'id': c.id,
            'customer_id': c.customer_id,
            'username': c.username,
            'full_name': c.full_name,
            'zone': c.zone.name if c.zone else '',
            'phone': c.phone,
            'email': c.email,
            'is_app_user': c.is_app_user,
            'app': bool(c.fcm_token),   # push পাঠানো যাবে কিনা
        } for c in qs])

    @action(detail=False, methods=['get'], url_path='portal-registered')
    def portal_registered(self, request):
        # Registered Clients table — filter: all|app|non_app, search
        user_type = request.query_params.get('user_type', 'all')
        search    = (request.query_params.get('search') or '').strip()
        qs = Client.objects.select_related('package', 'zone', 'router').all()
        if user_type == 'app':
            qs = qs.exclude(app_password='')
        elif user_type == 'non_app':
            qs = qs.filter(app_password='')
        if search:
            qs = qs.filter(
                Q(customer_id__icontains=search) | Q(full_name__icontains=search) |
                Q(phone__icontains=search) | Q(username__icontains=search)
            )
        qs = qs.order_by('-created_at')
        data = [{
            'id': c.id,
            'datetime': c.created_at,
            'customer_id': c.customer_id,
            'username': c.username,
            'ip_address': c.ip_address or '',
            'full_name': c.full_name,
            'phone': c.phone,
            'email': c.email,
            'zone': c.zone.name if c.zone else '',
            'package': c.package.name if c.package else '',
            'server': c.router.name if c.router else '',
            'status': c.status,
            'app_enabled': c.app_enabled,
            'is_app_user': c.is_app_user,
            'app_registered_on': c.app_registered_on,
        } for c in qs]
        return Response(data)

    @action(detail=False, methods=['post'], url_path='portal-register')
    def portal_register(self, request):
        # বিদ্যমান client-কে app user হিসেবে register — password সেট
        from django.utils import timezone
        client_id = request.data.get('client_id')
        password  = request.data.get('password') or ''
        confirm   = request.data.get('confirm_password')
        phone     = request.data.get('phone')
        email     = request.data.get('email')
        if not client_id:
            return Response({'detail': 'Client নির্বাচন করুন।'}, status=400)
        if not (email or '').strip():
            return Response({'detail': 'ইমেইল বাধ্যতামূলক।'}, status=400)
        if len(password) < 4:
            return Response({'detail': 'Password কমপক্ষে ৪ অক্ষরের হতে হবে।'}, status=400)
        if confirm is not None and password != confirm:
            return Response({'detail': 'Password ও Confirm Password মেলেনি।'}, status=400)
        try:
            client = Client.objects.get(pk=client_id)
        except Client.DoesNotExist:
            return Response({'detail': 'Client পাওয়া যায়নি।'}, status=404)
        if phone is not None and str(phone).strip():
            client.phone = str(phone).strip()
        if email is not None:
            client.email = str(email).strip()
        client.set_app_password(password)
        client.app_enabled = True
        if not client.app_registered_on:
            client.app_registered_on = timezone.now()
        client.save(update_fields=['phone', 'email', 'app_password', 'app_enabled', 'app_registered_on'])
        return Response({'detail': f'{client.customer_id} — app user হিসেবে register হয়েছে।'})

    @action(detail=True, methods=['post'], url_path='portal-reset-password')
    def portal_reset_password(self, request, pk=None):
        client = self.get_object()
        password = request.data.get('password') or ''
        if len(password) < 4:
            return Response({'detail': 'Password কমপক্ষে ৪ অক্ষরের হতে হবে।'}, status=400)
        client.set_app_password(password)
        client.app_enabled = True
        client.save(update_fields=['app_password', 'app_enabled'])
        return Response({'detail': 'Password রিসেট হয়েছে।'})

    @action(detail=True, methods=['post'], url_path='portal-toggle-app')
    def portal_toggle_app(self, request, pk=None):
        # app access on/off (L.Status toggle)
        client = self.get_object()
        client.app_enabled = not client.app_enabled
        client.save(update_fields=['app_enabled'])
        return Response({'detail': 'App access আপডেট হয়েছে।', 'app_enabled': client.app_enabled})

    @action(detail=False, methods=['get'], url_path='dashboard-stats')
    def dashboard_stats(self, request):
        # Dashboard-এর জন্য সম্পূর্ণ statistics — clients + billing + charts + top20
        from django.db.models import Sum, Count, Q
        from django.utils import timezone
        from billing.models import Bill

        now = timezone.now()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        bill_month_str = now.strftime('%Y-%m')

        qs = Client.objects

        # ── billing this month ──────────────────────────────────
        bill_agg = Bill.objects.filter(bill_month=bill_month_str).aggregate(
            count=Count('id'),
            paid=Count('id', filter=Q(status='paid')),
            partial=Count('id', filter=Q(status='partial')),
            unpaid=Count('id', filter=Q(status='unpaid')),
            net=Sum('net_amount'),
            collected=Sum('paid_amount'),
            disc=Sum('discount'),
        )

        # ── distinct CLIENT-wise paid/partial/unpaid ────────────────────
        # Card-গুলোর label "Clients" — তাই bill নয়, distinct client গোনা হয়।
        _billing_clients, _paid_c, _partial_c, _unpaid_c, _waived_c = _client_billing_classification(bill_month_str)

        # ── last 6 months new clients + last 12 months billing performance ──
        monthly_new = _monthly_new_clients(qs, now)
        monthly_perf = _monthly_billing_perf(now)

        # ── top 20 due clients ──────────────────────────────────
        top20 = [
            {
                'username':     c.username,
                'phone':        c.phone,
                'monthly_bill': float(c.monthly_bill),
                'due_amount':   float(c.due_amount),
            }
            for c in Client.objects.filter(due_amount__gt=0).order_by('-due_amount')[:20]
        ]

        return Response({
            'total':          qs.count(),
            'active':         qs.filter(status='active').count(),
            'inactive':       qs.filter(status='inactive').count(),
            'suspended':      qs.filter(status='suspended').count(),
            'expired':        qs.filter(status='expired').count(),
            # orphan-guard: যাদের Client মুছে গেছে (dangling FK) সেই LeftClient
            # গোনা হবে না — নইলে dashboard ভুল সংখ্যা দেখায় (পেজের INNER JOIN list
            # ওগুলো এমনিতেই বাদ দেয়, তাই count mismatch হত)।
            'left':           LeftClient.objects.filter(
                                  client_id__in=Client.objects.values('id')).count(),
            'new_this_month': qs.filter(created_at__gte=month_start).count(),
            'renewed':        qs.filter(is_renewed=True).count(),
            'total_due':      float(qs.aggregate(s=Sum('due_amount'))['s'] or 0),
            'billing_count':  _billing_clients,
            'paid_count':     _paid_c,
            'partial_count':  _partial_c,
            'unpaid_count':   _unpaid_c,
            'waived_count':   _waived_c,
            'net_billed':     float(bill_agg['net']       or 0),
            'collected':      float(bill_agg['collected'] or 0),
            'discount':       float(bill_agg['disc']      or 0),
            'monthly_new':    monthly_new,
            'monthly_perf':   monthly_perf,
            'top20_due':      top20,
        })


    @action(detail=False, methods=['post'], url_path='check-existing')
    def check_existing(self, request):
        """পাঠানো username-গুলোর মধ্যে কোনগুলো ইতিমধ্যে DB-তে আছে ফেরত দেয়।
        Bulk Import preview-তে 'already imported' badge দেখাতে।"""
        names = request.data.get('usernames') or []
        names = [str(n).strip() for n in names if str(n).strip()]
        existing = list(
            Client.objects.filter(username__in=names)
            .values_list('username', flat=True)
        )
        return Response({'existing': existing})

    @action(detail=False, methods=['post'], url_path='bulk-import')
    def bulk_import(self, request):
        """
        Excel থেকে parse করা client row bulk-এ import করে।
        প্রতিটি client-এর জন্য perform_create-এর মতো:
          1. DB-তে Client তৈরি
          2. RADIUS — user create + group + disable if inactive
          3. Mikrotik — PPPoE secret create
          4. Auto Invoice — billing generate
        """
        rows = request.data.get('rows', [])
        if not rows:
            return Response({'ok': False, 'error': 'কোনো data পাঠানো হয়নি।'},
                            status=status.HTTP_400_BAD_REQUEST)

        ctx = _build_import_ctx(request)
        results = []
        success_count = 0
        fail_count = 0
        for idx, row in enumerate(rows, start=1):
            detail, ok = _import_one_client(idx, row, ctx)
            results.append(detail)
            if ok:
                success_count += 1
            else:
                fail_count += 1

        return Response({
            'ok': True,
            'success': success_count,
            'failed': fail_count,
            'total': len(rows),
            'results': results,
        })

    @action(detail=False, methods=['get'], url_path='bulk-import-sample')
    def bulk_import_sample(self, request):
        """Sample Excel file download — সব required ও optional column সহ।"""
        import openpyxl
        from django.http import HttpResponse
        import io
        from openpyxl.styles import Font, PatternFill, Alignment

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = 'Clients'

        # Columns (user-requested order) — True = Required, False = Optional
        headers = [
            ('Name',      True),
            ('Mobile',    True),
            ('Email',     False),
            ('Zone',      True),
            ('Protocol',  True),
            ('Package',   True),
            ('Profile',   True),
            ('UserName',  True),
            ('Password',  True),
            (_SQL_B_STATUS,  True),
            ('Exp.Date',  False),
            ('Bill.Date', False),
            (_SQL_M_BILL,    True),
        ]

        req_font = Font(bold=True, color='FFFFFF')
        req_fill = PatternFill('solid', fgColor='1E3A5F')   # dark blue — required
        opt_font = Font(bold=True, color='1E3A5F')
        opt_fill = PatternFill('solid', fgColor='D6E4F0')   # light blue — optional
        center   = Alignment(horizontal='center')

        for col, (header, is_req) in enumerate(headers, 1):
            label = f'{header} *' if is_req else header
            cell  = ws.cell(row=1, column=col, value=label)
            cell.font      = req_font if is_req else opt_font
            cell.fill      = req_fill if is_req else opt_fill
            cell.alignment = center
            ws.column_dimensions[cell.column_letter].width = max(14, len(header) + 4)

        # ── Sample data row (row 2) ────────────────────────────────
        sample = [
            'রহিম উদ্দিন',   # Name
            '01712345678',    # Mobile
            'rahim@mail.com', # Email (optional)
            'Zone A',         # Zone
            'PPPoE',          # Protocol
            '10M Package',    # Package
            'pppoe-10M',      # Profile
            'rahim_10',       # UserName
            'pass@123',       # Password
            'active',         # B.Status
            '2025-12-31',     # Exp.Date (optional)
            '1',              # Bill.Date (optional, 1-28)
            '500',            # M.Bill
        ]
        for col, val in enumerate(sample, 1):
            ws.cell(row=2, column=col, value=val)

        # ── Info / hint row (row 3) ────────────────────────────────
        info_vals = [
            'ক্লায়েন্টের পুরো নাম',        # Name
            '01XXXXXXXXX',                   # Mobile
            'ঐচ্ছিক',                        # Email
            'Zone-এর সঠিক নাম',              # Zone
            'PPPoE / DHCP / Static',         # Protocol
            'Package-এর সঠিক নাম',           # Package
            'Mikrotik profile নাম',          # Profile
            'PPPoE username',                # UserName
            'PPPoE password',                # Password
            'active / inactive / suspended', # B.Status
            'YYYY-MM-DD (ঐচ্ছিক)',           # Exp.Date
            '1–28 (ঐচ্ছিক)',                 # Bill.Date
            'মাসিক বিল টাকায়',               # M.Bill
        ]
        info_font = Font(italic=True, color='888888', size=8)
        for col, val in enumerate(info_vals, 1):
            cell = ws.cell(row=3, column=col, value=val)
            cell.font = info_font

        ws.freeze_panes = 'A2'

        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)

        response = HttpResponse(
            buf.read(),
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        response['Content-Disposition'] = 'attachment; filename="bulk_import_sample.xlsx"'
        return response


class LeftClientViewSet(viewsets.ModelViewSet):
    # orphan-guard: client_id__in দিয়ে শুধু বিদ্যমান Client-যুক্ত row রাখি।
    # আগে select_related INNER JOIN list থেকে orphan বাদ দিত, কিন্তু paginator-এর
    # .count() join ছাড়া গুনত → "N total records" দেখাত অথচ table খালি। এই filter
    # count ও list দুটোকেই consistent রাখে।
    queryset = LeftClient.objects.filter(
        client_id__in=Client.objects.values('id')
    ).select_related(
        'client', 'client__router', 'client__router__radius_server'
    ).order_by('-left_date')
    serializer_class = LeftClientSerializer
    permission_classes = [permissions.IsAuthenticated]
    search_fields = ['client__full_name', 'client__username', 'client__phone', 'reason']
    filterset_fields = ['equipment_returned', 'balance_settled']

    def perform_create(self, serializer):
        instance = serializer.save(created_by=self.request.user)
        client = instance.client

        # client status → left (DB-তে সেভ, সব path-এ নিশ্চিত)
        if client.status != 'left':
            client.status = 'left'
            client.save(update_fields=['status'])

        # RADIUS থেকে user সম্পূর্ণ মুছে দেওয়া
        try:
            from radius_app.services.radius_service import RadiusService
            RadiusService.for_client(client).delete_user(client.username)
        except Exception as e:
            _log_sync_failure('radius', 'leftclient_create_delete', client.username, e)

        # সব active Mikrotik router-এর /ppp/secret থেকে মুছে দেওয়া
        try:
            from mikrotik_app.models import MikrotikServer
            from mikrotik_app.services.mikrotik_service import MikrotikService
            for server in MikrotikServer.objects.filter(is_active=True):
                try:
                    MikrotikService.from_server_model(server).delete_pppoe_user(client.username)
                except Exception as e:
                    _log_sync_failure('mikrotik', f'leftclient_create_delete_secret[server={server}]', client.username, e, level='warning')
        except Exception as e:
            _log_sync_failure('mikrotik', 'leftclient_create_bulk_cleanup', client.username, e)

        # Active Mikrotik session disconnect করা
        try:
            from mikrotik_app.models import MikrotikServer
            from mikrotik_app.services.mikrotik_service import MikrotikService
            for server in MikrotikServer.objects.filter(is_active=True):
                try:
                    MikrotikService.from_server_model(server).disconnect_active_session(client.username)
                except Exception as e:
                    _log_sync_failure('mikrotik', f'leftclient_create_session_disconnect[server={server}]', client.username, e, level='warning')
        except Exception as e:
            _log_sync_failure('mikrotik', 'leftclient_create_session_disconnect_loop', client.username, e)

    def perform_destroy(self, instance):
        # Left Client চিরতরে মুছলে RADIUS ও সব Mikrotik router থেকে PPPoE secret সরানো হয়।
        client = instance.client
        username = client.username

        # ১. RADIUS থেকে user সম্পূর্ণ মুছে দেওয়া + radacct history purge (client চিরতরে
        # মুছলে audit trail-এর প্রয়োজন শেষ — future-এ এই username অন্য client-কে দিলে
        # rename_user() যাতে পুরনো history-র সাথে মিশিয়ে না ফেলে)
        try:
            from radius_app.services.radius_service import RadiusService
            svc = RadiusService.for_client(client)
            svc.delete_user(username)
            svc.purge_radacct(username)
        except Exception as e:
            _log_sync_failure('radius', 'leftclient_permanent_delete', username, e)

        # ২. সব active Mikrotik router-এর /ppp/secret থেকে মুছে দেওয়া
        try:
            from mikrotik_app.models import MikrotikServer
            from mikrotik_app.services.mikrotik_service import MikrotikService
            for server in MikrotikServer.objects.filter(is_active=True):
                try:
                    MikrotikService.from_server_model(server).delete_pppoe_user(username)
                except Exception as e:
                    _log_sync_failure('mikrotik', f'leftclient_permanent_delete_secret[server={server}]', username, e, level='warning')
        except Exception as e:
            _log_sync_failure('mikrotik', 'leftclient_permanent_delete_bulk_cleanup', username, e)

        # ৩. Client record মুছলে OneToOneField CASCADE-এ LeftClient-ও মুছে যাবে
        client.delete()


class ChangeRequestViewSet(viewsets.ModelViewSet):
    queryset = ChangeRequest.objects.select_related('client').all()
    serializer_class = ChangeRequestSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['status', 'request_type', 'client']

    def perform_create(self, serializer):
        serializer.save(requested_by=self.request.user)

    @action(detail=True, methods=['post'], url_path='approve')
    def approve(self, request, pk=None):
        change_request = self.get_object()
        change_request.status = 'approved'
        change_request.approved_by = request.user
        change_request.save()
        return Response({'message': 'রিকোয়েস্ট অনুমোদন করা হয়েছে।'})


class ClientSchedulerViewSet(viewsets.ModelViewSet):
    queryset = ClientScheduler.objects.select_related('client').all()
    serializer_class = ClientSchedulerSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['is_executed', 'action']

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class ClientChangeLogViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = ClientChangeLogSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['client']

    def get_queryset(self):
        qs = ClientChangeLog.objects.select_related('changed_by', 'client')
        client_id = self.request.query_params.get('client')
        if client_id:
            qs = qs.filter(client_id=client_id)
        return qs.order_by('-changed_at')


class ClientStatusLogViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = ClientStatusLogSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['client']

    def get_queryset(self):
        qs = ClientStatusLog.objects.select_related('changed_by', 'client')
        client_id = self.request.query_params.get('client')
        if client_id:
            qs = qs.filter(client_id=client_id)
        return qs.order_by('-changed_at')


class ClientActivityLogViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = ClientActivityLogSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = ClientPagination   # page_size=20, max=500
    filterset_fields = ['client', 'event_type']

    def get_queryset(self):
        qs = ClientActivityLog.objects.select_related('performed_by_user', 'client')
        p = self.request.query_params
        if p.get('client'):
            qs = qs.filter(client_id=p['client'])
        if p.get('event_type'):
            qs = qs.filter(event_type=p['event_type'])
        return qs.order_by('-created_at')
