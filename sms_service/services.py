# Multi-channel messaging service — Local SMS / WhatsApp / Telegram / Email।
# প্রতিটি gateway-এর provider_type অনুযায়ী সঠিক চ্যানেলে পাঠায়।
import requests
import logging
from django.conf import settings

logger = logging.getLogger(__name__)


def _num(v):
    # decimal → trailing zero ছাড়া string (500.00 → 500)
    try:
        return f'{float(v):.2f}'.rstrip('0').rstrip('.')
    except Exception:
        return str(v or '')


def _company_sms_context():
    """CompanyName / CompanyMobile / BaseSiteURL / MonthName (সবসময় উপলব্ধ)।"""
    try:
        from system_settings.models import CompanySetup
        co = CompanySetup.objects.first()
    except Exception:
        co = None
    ctx = {
        'CompanyName':   (getattr(co, 'name', '') or 'ISP'),
        'CompanyMobile': (getattr(co, 'phone', '') or ''),
        'BaseSiteURL':   (getattr(co, 'website', '') or ''),
    }
    try:
        from django.utils import timezone as _tz
        ctx['MonthName'] = _tz.localdate().strftime('%B')
    except Exception:
        pass
    return ctx


def _client_sms_context(client):
    """client-এর SMS placeholder values (CamelCase + পুরনো lowercase aliases)।"""
    pkg = client.package.name if getattr(client, 'package_id', None) and client.package else ''
    zone = client.zone.name if getattr(client, 'zone_id', None) and client.zone else ''
    exp = client.expiry_date.strftime('%d-%m-%Y') if client.expiry_date else ''
    return {
        'CustomerName':      client.full_name or '',
        'CustomerNumber':    client.phone or '',
        'ClientID':          client.customer_id or '',
        'ClientCode':        client.customer_id or '',
        'UserName':          client.username or '',
        'Password':          client.password or '',
        'Package':           pkg,
        'MonthlyBillAmount': _num(client.monthly_bill),
        'MonthlyBill':       _num(client.monthly_bill),
        'Due':               _num(client.due_amount),
        'BillingLastDate':   exp,
        'PaymentDue':        exp,
        'Zone':              zone,
        'Address':           client.address or '',
        # পুরনো lowercase aliases (reminder template backward-compat)
        'name':        client.full_name or '',
        'customer_id': client.customer_id or '',
        'due':         _num(client.due_amount),
        'package':     pkg,
        'phone':       client.phone or '',
        'expiry_date': exp,
    }


def _payment_sms_context(client):
    """latest verified payment + bill → PaidAmount/ReceiptAmount/PaymentDate/InvoiceId (best-effort)।"""
    ctx = {}
    try:
        from billing.models import Payment, Bill
        lp = (Payment.objects.filter(bill__client=client, is_verified=True)
              .order_by('-payment_date').first())
        if lp:
            ctx['PaidAmount']    = _num(lp.amount)
            ctx['ReceiptAmount'] = _num(lp.amount)
            ctx['PaymentDate']   = lp.payment_date.strftime('%d-%m-%Y') if lp.payment_date else ''
        lb = Bill.objects.filter(client=client).order_by('-id').first()
        if lb:
            ctx['InvoiceId'] = str(lb.id)
    except Exception:
        pass
    return ctx


def render_sms_template(template: str, client=None, extra: dict = None) -> str:
    """template-এর {placeholder}-গুলো আসল মান দিয়ে পূরণ করে।
    CamelCase ({CustomerName}, {ClientID}, {CompanyName}…) ও পুরনো lowercase
    ({name}, {customer_id}…) — দুটোই সাপোর্ট করে। extra দিয়ে ticket/OTP-নির্দিষ্ট
    মান ({TicketNo}, {Problem}, {VerificationCode}) দেওয়া যায়।"""
    msg = template or ''
    if '{' not in msg:
        return msg
    ctx = _company_sms_context()
    if client is not None:
        ctx.update(_client_sms_context(client))
        # ── Payment/Invoice — template-এ থাকলে latest থেকে নাও (best-effort) ──
        if any(k in msg for k in ('{PaidAmount}', '{ReceiptAmount}', '{PaymentDate}', '{InvoiceId}')):
            ctx.update(_payment_sms_context(client))
    if extra:
        ctx.update({k: str(v) for k, v in extra.items()})
    for k, v in ctx.items():
        msg = msg.replace('{' + k + '}', str(v))
    return msg


class MessagingService:
    """একটি SMSGateway দিয়ে message পাঠায় (চ্যানেল-ভেদে)।
    Returns: (success: bool, response_text: str)"""

    @staticmethod
    def send(gateway, to: str, message: str, subject: str = None):
        try:
            pt = gateway.provider_type
            if pt == 'sms_http':
                return MessagingService._send_sms_http(gateway, to, message)
            if pt == 'whatsapp':
                return MessagingService._send_whatsapp(gateway, to, message)
            if pt == 'telegram':
                return MessagingService._send_telegram(gateway, to, message)
            if pt == 'email':
                return MessagingService._send_email(gateway, to, message, subject)
            return False, f'Unknown provider_type: {pt}'
        except Exception as e:
            logger.exception(f'Messaging send error [{gateway.name}/{to}]: {e}')
            return False, str(e)

    # ── Local SMS Provider (HTTP API) ──────────────────────────────────────
    @staticmethod
    def _send_sms_http(gw, to, message):
        cfg = gw.config or {}
        method = (cfg.get('http_method') or 'POST').upper()
        send_as = (cfg.get('send_as') or 'json').lower()   # json | form | query
        to_param = cfg.get('to_param') or 'to'
        msg_param = cfg.get('msg_param') or 'message'
        sender_param = cfg.get('sender_param') or 'sender_id'
        key_param = cfg.get('key_param', 'api_key')         # খালি হলে header-এ যাবে
        payload = dict(cfg.get('extra_params') or {})
        payload[to_param] = to
        payload[msg_param] = message
        if gw.sender_id:
            payload[sender_param] = gw.sender_id
        headers = {}
        if key_param:
            payload[key_param] = gw.api_key
        elif cfg.get('auth_header'):
            headers['Authorization'] = cfg['auth_header'].replace('{key}', gw.api_key)
        else:
            headers['Authorization'] = f'Bearer {gw.api_key}'

        kw = {'headers': headers, 'timeout': 15}
        if method == 'GET':
            kw['params'] = payload
            r = requests.get(gw.api_url, **kw)
        elif send_as == 'form':
            kw['data'] = payload
            r = requests.post(gw.api_url, **kw)
        elif send_as == 'query':
            kw['params'] = payload
            r = requests.post(gw.api_url, **kw)
        else:
            kw['json'] = payload
            r = requests.post(gw.api_url, **kw)
        ok = 200 <= r.status_code < 300
        return ok, f'HTTP {r.status_code}: {r.text[:300]}'

    # ── WhatsApp Cloud API (graph.facebook.com) বা সমতুল্য ──────────────────
    @staticmethod
    def _send_whatsapp(gw, to, message):
        cfg = gw.config or {}
        phone_number_id = cfg.get('phone_number_id') or gw.sender_id
        url = gw.api_url or f'https://graph.facebook.com/v19.0/{phone_number_id}/messages'
        headers = {'Authorization': f'Bearer {gw.api_key}',
                   'Content-Type': 'application/json'}
        body = {
            'messaging_product': 'whatsapp',
            'to': to,
            'type': 'text',
            'text': {'body': message},
        }
        r = requests.post(url, json=body, headers=headers, timeout=15)
        ok = 200 <= r.status_code < 300
        return ok, f'HTTP {r.status_code}: {r.text[:300]}'

    # ── Telegram Bot API ────────────────────────────────────────────────────
    @staticmethod
    def _send_telegram(gw, to, message):
        cfg = gw.config or {}
        token = gw.api_key
        # to numeric হলে সেটাই chat_id; নইলে config-এর default chat_id
        chat_id = to if str(to).lstrip('-').isdigit() else (cfg.get('chat_id') or gw.sender_id)
        url = gw.api_url or f'https://api.telegram.org/bot{token}/sendMessage'
        r = requests.post(url, json={'chat_id': chat_id, 'text': message}, timeout=15)
        ok = 200 <= r.status_code < 300
        return ok, f'HTTP {r.status_code}: {r.text[:300]}'

    # ── Email (SMTP) ────────────────────────────────────────────────────────
    @staticmethod
    def _send_email(gw, to, message, subject=None):
        import smtplib
        from email.mime.text import MIMEText
        cfg = gw.config or {}
        host = cfg.get('smtp_host'); port = int(cfg.get('smtp_port') or 587)
        user = cfg.get('smtp_user'); pwd = cfg.get('smtp_password')
        from_email = cfg.get('from_email') or user
        use_tls = cfg.get('use_tls', True)
        subj = subject or cfg.get('subject') or 'Notification'
        if not host or not from_email:
            return False, 'SMTP host/from_email missing'
        msg = MIMEText(message, 'plain', 'utf-8')
        msg['Subject'] = subj; msg['From'] = from_email; msg['To'] = to
        try:
            if int(port) == 465:
                server = smtplib.SMTP_SSL(host, port, timeout=20)
            else:
                server = smtplib.SMTP(host, port, timeout=20)
                if use_tls:
                    server.starttls()
            if user and pwd:
                server.login(user, pwd)
            server.sendmail(from_email, [to], msg.as_string())
            server.quit()
            return True, 'Email sent'
        except Exception as e:
            return False, f'SMTP error: {e}'


def _send_via_env_fallback(phone, message):
    """gateway না থাকলে .env SMS_GATEWAY_URL fallback (পুরনো আচরণ) → ok bool।"""
    api_url = getattr(settings, 'SMS_GATEWAY_URL', '') or ''
    api_key = getattr(settings, 'SMS_GATEWAY_API_KEY', '') or ''
    sender_id = getattr(settings, 'SMS_SENDER_ID', '') or ''
    if not api_url or not api_key:
        logger.warning('SMS Gateway not configured (admin panel বা .env)')
        return False
    try:
        r = requests.post(api_url, json={'api_key': api_key, 'sender_id': sender_id,
                                         'recipient': phone, 'message': message}, timeout=10)
        return r.status_code == 200
    except Exception as e:
        logger.exception(f'SMS error for {phone}: {e}')
        return False


def _log_sms(phone, message, client, ok, sent_by, gw):
    """SMSLog তৈরি — client না দিলে phone দিয়ে resolve (In-app SMS History-র জন্য)।"""
    try:
        from sms_service.models import SMSLog
        cl = client
        if cl is None and phone:
            from clients.models import Client
            cl = Client.objects.filter(phone=phone).first()
        SMSLog.objects.create(
            recipient_phone=phone or '', client=cl, message=message,
            status='sent' if ok else 'failed', sent_by=sent_by, gateway=gw,
        )
    except Exception as e:
        logger.exception(f'SMSLog create failed: {e}')


class SMSService:
    """পুরনো call-site-এর সাথে backward-compatible — default/active gateway দিয়ে পাঠায়।"""

    @staticmethod
    def _pick_gateway():
        from sms_service.models import SMSGateway
        return (SMSGateway.objects.filter(is_active=True, is_default=True).first()
                or SMSGateway.objects.filter(is_active=True).order_by('-id').first())

    @staticmethod
    def send_sms(phone: str, message: str, client=None, sent_by=None, log: bool = True,
                 gateway=None) -> bool:
        """SMS পাঠায় এবং (log=True হলে) সবসময় একটি SMSLog তৈরি করে — যাতে যেকোনো
        জায়গা থেকে পাঠানো SMS client-এর In-app SMS History-তে দেখায়।"""
        gw = gateway
        if gw is None:
            try:
                gw = SMSService._pick_gateway()
            except Exception as e:
                logger.exception(f'SMS gateway lookup error: {e}')
        if gw:
            ok, resp = MessagingService.send(gw, phone, message)
            (logger.info if ok else logger.error)(f'SMS [{gw.name}] → {phone}: {resp}')
        else:
            ok = _send_via_env_fallback(phone, message)

        # ── সবসময় log (client FK সহ — phone দিয়ে resolve) ──
        if log:
            _log_sms(phone, message, client, ok, sent_by, gw)
        return ok

    @staticmethod
    def send_payment_confirmation(payment) -> bool:
        client = payment.bill.client
        message = (f'প্রিয় {client.full_name}, আপনার {payment.amount}৳ পেমেন্ট গ্রহণ করা হয়েছে। '
                   f'ধন্যবাদ। - ISP')
        return SMSService.send_sms(client.phone, message, client=client)
