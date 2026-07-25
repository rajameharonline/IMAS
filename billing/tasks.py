# এই ফাইলটি billing-সংক্রান্ত Celery background task।
# auto bill generate, expired client disable, due SMS পাঠানো এই task গুলো করে।
from celery import shared_task
from django.utils import timezone
from django.db.models import Q
import logging

logger = logging.getLogger(__name__)


@shared_task(name='billing.auto_generate_monthly_bills')
def auto_generate_monthly_bills():
    # প্রতি মাসের ১ তারিখে চলে — সব active ক্লায়েন্টের বিল তৈরি করে
    from billing.services import BillingService
    result = BillingService.generate_bills_for_active_clients()
    logger.info(f"Auto bill generation (1st of month): {result}")
    return result


def _extend_expiry_advance_paid(client, today):
    """Advance balance দিয়ে বিল paid — disable না করে expiry extend + log।"""
    import calendar as _cal
    from datetime import date as _date
    if client.expiry_day:
        nm = today.month + 1 if today.month < 12 else 1
        ny = today.year if today.month < 12 else today.year + 1
        max_day = _cal.monthrange(ny, nm)[1]
        new_expiry = _date(ny, nm, min(client.expiry_day, max_day))
        client.expiry_date = new_expiry
        client.save(update_fields=['expiry_date'])
    logger.info(
        "Skipped disable (advance paid): %s | due=%.2f | new_expiry=%s",
        client.username, client.due_amount, client.expiry_date,
    )
    try:
        from clients.activity import log_client_activity
        log_client_activity(
            client, 'status_changed',
            title='Advance Balance-এ বিল পরিশোধ — সংযোগ সক্রিয় থাকবে',
            description=(
                f'Advance balance থেকে বিল সম্পূর্ণ পরিশোধ হয়েছে। '
                f'নতুন Expiry Date: {client.expiry_date}'
            ),
        )
    except Exception:
        pass


def _move_client_to_expired(client):
    """Due আছে — RADIUS Blocked_Group (Expired PPPoE) + Mikrotik session kick +
    status='expired' + log। disable_user নয় (walled garden)। Returns RADIUS error count।"""
    from radius_app.services.radius_service import RadiusService
    from mikrotik_app.services.mikrotik_service import MikrotikService
    errors = 0
    try:
        svc = RadiusService.for_client(client)
        svc.enable_user(client.username)            # পুরনো Reject থাকলে মুছে দাও
        svc.move_to_blocked_group(client.username)  # → Expired PPPoE profile
    except Exception as e:
        logger.exception("RADIUS move_to_blocked_group failed for %s: %s", client.username, e)
        errors += 1
    # Mikrotik: secret disable করি না (walled garden) — শুধু চলমান session কেটে দিই
    try:
        if client.router:
            MikrotikService.from_server_model(client.router).disconnect_active_session(client.username)
    except Exception:
        pass
    client.status = 'expired'
    client.save(update_fields=['status'])
    logger.info(
        "Expired: %s (expiry_day=%s, expiry_date=%s, due=%.2f)",
        client.username, client.expiry_day, client.expiry_date, client.due_amount,
    )
    try:
        from clients.activity import log_client_activity
        if client.expiry_day:
            reason = f'Expiry Day {client.expiry_day} অনুযায়ী'
        else:
            reason = f'Expiry Date {client.expiry_date} অতিক্রান্ত হওয়ায়'
        log_client_activity(
            client, 'client_disabled',
            title='মেয়াদ শেষ — Expired profile-এ স্থানান্তর',
            description=(
                f'{reason} সংযোগ Expired PPPoE profile-এ পাঠানো হয়েছে '
                f'(সীমিত access — বিল পরিশোধ করলে স্বয়ংক্রিয়ভাবে পুনরায় সক্রিয় হবে)।'
            ),
        )
    except Exception:
        pass
    return errors


def _process_expiry_candidate(client, today):
    """একটি expiry candidate — advance-paid হলে skip+expiry-extend, নাহলে Expired
    walled-garden-এ পাঠাও। Returns (outcome: 'skipped'|'disabled', errors: int)।"""
    # শুধু due_amount refresh করি (bill generation-এর পর stale হতে পারে) —
    # fields= ছাড়া refresh_from_db() caller-এর select_related('router',
    # 'router__radius_server') cache মুছে দিত, ফলে নিচে client.router access-এ
    # প্রতিটা client-এর জন্য আলাদা query (N+1) লাগত।
    client.refresh_from_db(fields=['due_amount'])
    if client.due_amount <= 0:
        _extend_expiry_advance_paid(client, today)
        return 'skipped', 0
    return 'disabled', _move_client_to_expired(client)


@shared_task(name='billing.disable_expired_clients')
def disable_expired_clients():
    # প্রতিদিন নির্ধারিত সময়ে চলে (System Settings → Automation থেকে সময় নির্ধারণ)।
    # expiry_day সেট থাকলে: আজকের তারিখ == expiry_day → disable।
    #   বিশেষ ক্ষেত্র: মাসের শেষ দিনে expiry_day > আজকের দিন হলেও disable
    #   (যেমন: expiry_day=31 কিন্তু এপ্রিলে মাত্র 30 দিন)।
    # expiry_day না থাকলে: expiry_date <= today → disable (পুরনো ক্লায়েন্ট fallback)।
    import calendar
    from clients.models import Client

    today = timezone.localdate()   # ✅ Asia/Dhaka তারিখ (now().date() UTC দেয় — বাগ ছিল)
    last_day_of_month = calendar.monthrange(today.year, today.month)[1]
    is_last_day = (today.day == last_day_of_month)

    # expiry_day-ভিত্তিক filter তৈরি
    # সাধারণত: expiry_day == today.day
    # মাসের শেষ দিনে: expiry_day >= today.day (যেসব বড় তারিখ এ মাসে নেই সেগুলো ধরে)
    if is_last_day:
        day_filter = Q(expiry_day__gte=today.day)
    else:
        day_filter = Q(expiry_day=today.day)

    by_day = Client.objects.filter(
        day_filter,
        expiry_day__isnull=False,
        status='active',
    ).select_related('router', 'router__radius_server')

    # পুরনো expiry_date-ভিত্তিক (expiry_day না থাকা পুরনো ক্লায়েন্ট)
    # __lte: আজকের তারিখ সহ অতিক্রান্ত সব client ধরবে
    by_date = Client.objects.filter(
        expiry_day__isnull=True,
        expiry_date__lte=today,
        status='active',
    ).select_related('router', 'router__radius_server')

    # ── expiry_date = সর্বোচ্চ অগ্রাধিকার ──────────────────────────────
    # expiry_day সেট থাকুক বা না থাকুক — যার expiry_date আজকের আগে পার হয়ে
    # গেছে অথচ এখনো active, তাকে নিশ্চিতভাবে disable করি। এতে expiry_date-ই
    # চূড়ান্ত master switch হিসেবে কাজ করে (expiry_day mismatch হলেও আটকায় না)।
    by_expired_date = Client.objects.filter(
        expiry_date__lt=today,
        status='active',
    ).select_related('router', 'router__radius_server')

    # expiry আগে এই মাসের বিল নিশ্চিত করা (due invoice at expiry time)
    try:
        from billing.services import BillingService
        BillingService.generate_bills_for_active_clients(today.strftime('%Y-%m'))
    except Exception:
        pass

    disabled_count = 0
    skipped_count  = 0
    errors = 0

    # তিন queryset একত্র — pk দিয়ে dedupe (একই client একাধিক filter-এ পড়তে পারে)
    candidates = {}
    for c in list(by_day) + list(by_date) + list(by_expired_date):
        candidates[c.pk] = c

    for client in candidates.values():
        outcome, errs = _process_expiry_candidate(client, today)
        errors += errs
        if outcome == 'skipped':
            skipped_count += 1
        else:
            disabled_count += 1

    logger.info(
        "disable_expired_clients: disabled=%d, skipped(advance_paid)=%d, errors=%d, date=%s",
        disabled_count, skipped_count, errors, today,
    )
    return {'disabled': disabled_count, 'skipped': skipped_count, 'errors': errors}


@shared_task(name='billing.send_due_sms')
def send_due_sms():
    # বকেয়া বিল আছে এমন ক্লায়েন্টদের SMS পাঠায়।
    # প্রতি মাসের ৫ তারিখে এই task চলবে।
    from clients.models import Client
    from sms_service.services import SMSService

    due_clients = Client.objects.filter(
        due_amount__gt=0,
        status='active',
    ).select_related('package')

    sent_count = 0
    for client in due_clients:
        message = (
            f"প্রিয় {client.full_name}, আপনার বকেয়া বিল {client.due_amount}৳। "
            f"অনুগ্রহ করে দ্রুত পরিশোধ করুন। - ISP"
        )
        success = SMSService.send_sms(client.phone, message, client=client)
        if success:
            sent_count += 1

    logger.info(f"Due SMS sent to {sent_count} clients")
    return {'sent': sent_count}


def _collect_radius_svc_list():
    """active RADIUS servers-এর svc list; না থাকলে default; একেবারে না থাকলে []।"""
    from radius_app.services.radius_service import RadiusService
    from radius_app.models import RadiusServer
    servers = list(RadiusServer.objects.filter(is_active=True))
    svc_list = [RadiusService(rs) for rs in servers] if servers else []
    if not svc_list:
        svc = RadiusService.get_default()
        if svc:
            svc_list = [svc]
    return svc_list


def _combine_monthly_aggregates(svc_list):
    """সব server-এর monthly aggregate (username+month দিয়ে merge) → combined dict।"""
    combined: dict = {}  # key: (username, month) → {bytes_in, bytes_out, sessions, total_seconds}
    for svc in svc_list:
        rows = svc.get_monthly_aggregates(days=35)
        for r in rows:
            key = (r['username'], r['month'])
            if key in combined:
                combined[key]['bytes_in']      += r['bytes_in']
                combined[key]['bytes_out']     += r['bytes_out']
                combined[key]['sessions']      += r['sessions']
                combined[key]['total_seconds'] += r['total_seconds']
            else:
                combined[key] = {
                    'bytes_in':      r['bytes_in'],
                    'bytes_out':     r['bytes_out'],
                    'sessions':      r['sessions'],
                    'total_seconds': r['total_seconds'],
                }
    return combined


def _upsert_monthly_traffic(combined):
    """combined aggregate → ClientMonthlyTraffic upsert (transaction)। Returns upserted count।"""
    from clients.models import Client, ClientMonthlyTraffic
    from django.db import transaction
    # username → client_id map (একটি query-তেই)
    all_usernames  = {uname for uname, _ in combined.keys()}
    username_to_id = dict(
        Client.objects.filter(username__in=all_usernames).values_list('username', 'id')
    )
    upserted = 0
    with transaction.atomic():
        for (username, month), data in combined.items():
            client_id = username_to_id.get(username)
            if not client_id:
                continue  # system user বা deleted client — skip
            obj, created = ClientMonthlyTraffic.objects.get_or_create(
                client_id=client_id,
                year_month=month,
                defaults={
                    'bytes_in':      data['bytes_in'],
                    'bytes_out':     data['bytes_out'],
                    'sessions':      data['sessions'],
                    'online_seconds': data['total_seconds'],
                }
            )
            if not created:
                # আপডেট করি (চলমান মাসের data বাড়তে থাকে)
                obj.bytes_in       = data['bytes_in']
                obj.bytes_out      = data['bytes_out']
                obj.sessions       = data['sessions']
                obj.online_seconds = data['total_seconds']
                obj.save(update_fields=['bytes_in', 'bytes_out', 'sessions', 'online_seconds', 'updated_at'])
            upserted += 1
    return upserted


@shared_task(name='billing.aggregate_radacct_to_monthly_traffic')
def aggregate_radacct_to_monthly_traffic():
    # প্রতিদিন রাত ১টায় চলে — radacct থেকে মাসিক summary তৈরি করে ClientMonthlyTraffic-এ upsert।
    # purge task (রাত ২টায়) চলার আগেই data সংরক্ষিত হয়, তাই history চিরস্থায়ী থাকে।
    svc_list = _collect_radius_svc_list()
    if not svc_list:
        logger.warning("Radacct aggregate: no active RADIUS server found")
        return {'upserted': 0}

    # সব server থেকে aggregate data সংগ্রহ — username+month দিয়ে merge
    combined = _combine_monthly_aggregates(svc_list)
    if not combined:
        logger.info("Radacct aggregate: no data found")
        return {'upserted': 0}

    upserted = _upsert_monthly_traffic(combined)
    logger.info("Radacct aggregate complete: %d records upserted", upserted)
    return {'upserted': upserted}


@shared_task(name='billing.purge_old_radacct_sessions')
def purge_old_radacct_sessions():
    # প্রতিদিন রাত ২টায় চলে — ৩০ দিনের বেশি পুরনো বন্ধ session মুছে storage বাঁচায়।
    # নিয়ম:
    #   ✅ active client-এর পুরনো closed session → DELETE (summary table-এ আগেই সংরক্ষিত)
    #   ❌ suspended/expired client → DELETE করা হয় না (তারা re-activate হলে data দেখাতে পারব)
    #   ❌ open session (acctstoptime IS NULL) → কখনো DELETE হয় না
    from radius_app.services.radius_service import RadiusService
    from radius_app.models import RadiusServer
    from clients.models import Client

    # suspended ও expired client-এর username list — এদের data রাখব
    protected_usernames = list(
        Client.objects.filter(status__in=['suspended', 'expired'])
        .values_list('username', flat=True)
    )

    servers = list(RadiusServer.objects.filter(is_active=True))
    if not servers:
        svc = RadiusService.get_default()
        if not svc:
            logger.warning("Radacct purge: no active RADIUS server found")
            return {'deleted': 0, 'protected': len(protected_usernames)}
        deleted = svc.purge_old_sessions(days=30, exclude_usernames=protected_usernames)
        return {'deleted': deleted, 'protected': len(protected_usernames)}

    total = 0
    for rs in servers:
        svc = RadiusService(rs)
        total += svc.purge_old_sessions(days=30, exclude_usernames=protected_usernames)

    logger.info("Radacct purge: %d rows deleted, %d suspended/expired users protected",
                total, len(protected_usernames))
    return {'deleted': total, 'protected': len(protected_usernames)}


@shared_task(name='billing.process_payment_reminders')
def process_payment_reminders():
    """প্রতি ঘণ্টায় চলে — যেসব active ReminderRule-এর send_hour == এখনকার ঘণ্টা,
    সেগুলোর যোগ্য client-দের reminder (SMS/Push/Email) পাঠায়।"""
    from billing.models import ReminderRule
    from billing.reminder_service import send_for_rule

    hour = timezone.localtime().hour
    rules = ReminderRule.objects.filter(is_active=True, send_hour=hour)
    results = []
    for rule in rules:
        try:
            results.append(send_for_rule(rule, triggered_by='auto'))
        except Exception as e:
            logger.exception("process_payment_reminders rule %s error: %s", rule.id, e)
    logger.info("process_payment_reminders: hour=%d, rules_run=%d", hour, len(results))
    return {'hour': hour, 'rules_run': len(results), 'results': results}
