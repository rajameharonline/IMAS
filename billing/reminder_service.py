# পেমেন্ট রিমাইন্ডার service — rule অনুযায়ী যোগ্য client বের করে SMS/Push/Email
# পাঠায় এবং প্রতিটি প্রচেষ্টা ReminderLog-এ রেকর্ড করে।
#
# reuse: sms_service.SMSService, mobile_api.services.push_service, Django send_mail।
import logging
from datetime import timedelta

from django.utils import timezone
from django.conf import settings
from django.core.mail import send_mail

logger = logging.getLogger(__name__)


def _public_base_url() -> str:
    """পাবলিক HTTPS base URL ফেরত দেয় (app download link বানাতে)।
    অগ্রাধিকার: CSRF_TRUSTED_ORIGINS → ALLOWED_HOSTS-এর প্রথম আসল ডোমেইন (IP/localhost বাদ)।"""
    origins = getattr(settings, 'CSRF_TRUSTED_ORIGINS', None) or []
    if origins:
        return origins[0].rstrip('/')
    for host in getattr(settings, 'ALLOWED_HOSTS', []):
        h = (host or '').strip()
        # IP বা localhost বাদ — আসল ডোমেইন (অক্ষর + ডট) খোঁজা
        if h and '.' in h and any(ch.isalpha() for ch in h) and h not in ('localhost',):
            return f'https://{h}'
    return ''


def render_message(template: str, client) -> str:
    """template-এর placeholder client-এর তথ্য দিয়ে পূরণ করে।"""
    # App download link — APK media/app/-এ থাকে, nginx সরাসরি serve করে।
    base = _public_base_url()
    app_link = f'{base}/media/app/rajamehar-online.apk' if base else ''
    mapping = {
        'name':        client.full_name or '',
        'due':         f"{client.due_amount:.2f}".rstrip('0').rstrip('.') if client.due_amount is not None else '0',
        'expiry_date': client.expiry_date.strftime('%d-%m-%Y') if client.expiry_date else '',
        'customer_id': client.customer_id or '',
        'package':     client.package.name if client.package_id and client.package else '',
        'phone':       client.phone or '',
        'app_link':    app_link,
    }
    msg = template or ''
    for key, val in mapping.items():
        msg = msg.replace('{' + key + '}', str(val))
    return msg


def eligible_clients(rule):
    """একটি rule-এর জন্য যোগ্য client queryset ফেরত দেয়।"""
    from clients.models import Client
    today = timezone.localdate()
    qs = Client.objects.select_related('package')

    # status filter
    if rule.only_active:
        qs = qs.filter(status='active')
    else:
        qs = qs.exclude(status__in=['left', 'cancelled'])

    # trigger
    if rule.trigger == 'on_due':
        qs = qs.filter(due_amount__gt=rule.min_due)
    elif rule.trigger == 'before_expiry':
        qs = qs.filter(expiry_date=today + timedelta(days=rule.offset_days),
                       due_amount__gte=rule.min_due)
    elif rule.trigger == 'after_expiry':
        qs = qs.filter(expiry_date=today - timedelta(days=rule.offset_days),
                       due_amount__gte=rule.min_due)

    # optional target filters
    if rule.zone_id:
        qs = qs.filter(zone_id=rule.zone_id)
    if rule.package_id:
        qs = qs.filter(package_id=rule.package_id)

    return qs


def _log(rule, client, channel, recipient, message, status, detail, triggered_by):
    from billing.models import ReminderLog
    try:
        ReminderLog.objects.create(
            rule=rule, client=client, channel=channel, recipient=recipient or '',
            message=message or '', status=status, detail=(detail or '')[:2000],
            triggered_by=triggered_by,
        )
    except Exception as e:  # log-fail যেন মূল কাজ না আটকায়
        logger.warning("ReminderLog write failed: %s", e)


def _send_sms_channel(rule, client, message, triggered_by, res):
    """SMS channel enabled + phone থাকলে পাঠায় (res mutate)।"""
    if not (rule.via_sms and client.phone):
        return
    try:
        from sms_service.services import SMSService
        ok = SMSService.send_sms(client.phone, message, client=client)
        _log(rule, client, 'sms', client.phone, message,
             'sent' if ok else 'failed', '' if ok else 'gateway returned false', triggered_by)
        res['sms' if ok else 'failed'] += 1
    except Exception as e:
        _log(rule, client, 'sms', client.phone, message, 'failed', str(e), triggered_by)
        res['failed'] += 1


def _send_push_channel(rule, client, message, triggered_by, res):
    """App Push (FCM) channel enabled + token থাকলে পাঠায় (res mutate)।"""
    if not (rule.via_push and getattr(client, 'fcm_token', '')):
        return
    try:
        from mobile_api.services import push_service
        ok = push_service.send_to_token(client.fcm_token, 'পেমেন্ট রিমাইন্ডার', message)
        _log(rule, client, 'push', (client.fcm_token or '')[:40], message,
             'sent' if ok else 'failed', '' if ok else 'fcm returned false', triggered_by)
        res['push' if ok else 'failed'] += 1
    except Exception as e:
        _log(rule, client, 'push', (client.fcm_token or '')[:40], message, 'failed', str(e), triggered_by)
        res['failed'] += 1


def _send_email_channel(rule, client, message, triggered_by, res):
    """Email channel enabled + email থাকলে পাঠায় (res mutate)।"""
    if not (rule.via_email and client.email):
        return
    try:
        subject = rule.email_subject or 'পেমেন্ট রিমাইন্ডার'
        sent = send_mail(subject, message,
                         getattr(settings, 'DEFAULT_FROM_EMAIL', None) or settings.EMAIL_HOST_USER,
                         [client.email], fail_silently=False)
        ok = bool(sent)
        _log(rule, client, 'email', client.email, message,
             'sent' if ok else 'failed', '' if ok else 'send_mail returned 0', triggered_by)
        res['email' if ok else 'failed'] += 1
    except Exception as e:
        _log(rule, client, 'email', client.email, message, 'failed', str(e), triggered_by)
        res['failed'] += 1


def _send_one(rule, client, message, triggered_by):
    """একজন client-কে rule-এর enabled সব channel-এ পাঠায়। Returns per-channel counts."""
    res = {'sms': 0, 'push': 0, 'email': 0, 'failed': 0}
    _send_sms_channel(rule, client, message, triggered_by, res)
    _send_push_channel(rule, client, message, triggered_by, res)
    _send_email_channel(rule, client, message, triggered_by, res)
    return res


def send_for_rule(rule, triggered_by='auto'):
    """একটি rule-এর সব যোগ্য client-কে reminder পাঠায়। Returns summary dict।"""
    summary = {'rule': rule.name, 'clients': 0, 'sms': 0, 'push': 0, 'email': 0, 'failed': 0}
    for client in eligible_clients(rule):
        message = render_message(rule.message_template, client)
        r = _send_one(rule, client, message, triggered_by)
        summary['clients'] += 1
        for k in ('sms', 'push', 'email', 'failed'):
            summary[k] += r[k]
    logger.info("Reminder rule '%s' (%s): %s", rule.name, triggered_by, summary)
    return summary
