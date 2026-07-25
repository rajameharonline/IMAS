# bKash Tokenized Checkout Service
# Docs: https://developer.bka.sh/docs/tokenized-checkout-process
import requests
import logging
from django.conf import settings
from system_settings.models import PaymentGatewayConfig
from role_permissions.utils import decrypt_password

logger = logging.getLogger(__name__)


class BkashError(Exception):
    """bKash gateway থেকে token/payment/execute ব্যর্থ হলে তোলা হয় (S112 — specific exception)।"""


# পুনরাবৃত্ত literal — S1192 এড়াতে module constant
_CONTENT_JSON = 'application/json'


def _bkash_creds_from_db():
    """1st priority: DB (PaymentGatewayConfig, Admin Panel-এ configure) → creds dict বা None।"""
    try:
        gw = PaymentGatewayConfig.objects.filter(gateway='bkash').first()
        if gw and gw.app_key:
            return {
                'app_key':    gw.app_key,
                'app_secret': decrypt_password(gw.app_secret) if gw.app_secret else '',
                'username':   gw.username or '',
                'password':   decrypt_password(gw.password) if gw.password else '',
            }
    except Exception as e:
        logger.warning(f'bKash DB credentials load error: {e}')
    return None


def _bkash_creds_from_env():
    """2nd priority: .env সরাসরি read (settings cache bypass) → creds dict বা None।"""
    try:
        import environ as env_lib
        from pathlib import Path
        _env = env_lib.Env()
        _env.read_env(Path(settings.BASE_DIR) / '.env', overwrite=True)
        return {
            'app_key':    _env('BKASH_APP_KEY', default=''),
            'app_secret': _env('BKASH_APP_SECRET', default=''),
            'username':   _env('BKASH_USERNAME', default=''),
            'password':   _env('BKASH_PASSWORD', default=''),
            'base_url':   _env('BKASH_BASE_URL', default=''),
        }
    except Exception as e:
        logger.warning(f'bKash .env read error: {e}')
    return None


def _bkash_creds_from_settings():
    """3rd priority: cached settings.BKASH_CONFIG → creds dict।"""
    cfg = getattr(settings, 'BKASH_CONFIG', {})
    return {
        'app_key':    cfg.get('app_key', ''),
        'app_secret': cfg.get('app_secret', ''),
        'username':   cfg.get('username', ''),
        'password':   cfg.get('password', ''),
        'base_url':   cfg.get('base_url', ''),
    }


class BkashTokenizedService:
    def _apply_creds(self, creds):
        """creds dict থেকে fields সেট করে; base_url শুধু non-empty হলে override।"""
        self.app_key    = creds['app_key']
        self.app_secret = creds['app_secret']
        self.username   = creds['username']
        self.password   = creds['password']
        base = creds.get('base_url', '')
        if base:
            self.base_url = base

    def __init__(self):
        self.app_key = self.app_secret = self.username = self.password = ''
        self.base_url = 'https://tokenized.pay.bka.sh/v1.2.0-beta'

        # 1st: DB → 2nd: .env → 3rd: cached settings (app_key না পাওয়া পর্যন্ত)
        creds = _bkash_creds_from_db()
        if creds:
            self._apply_creds(creds)
        if not self.app_key:
            creds = _bkash_creds_from_env()
            if creds:
                self._apply_creds(creds)
        if not self.app_key:
            self._apply_creds(_bkash_creds_from_settings())

        self.base_url = self.base_url.rstrip('/')

    def _headers(self, token=None):
        h = {
            'Content-Type':  _CONTENT_JSON,
            'Accept':        _CONTENT_JSON,
            'X-APP-Key':     self.app_key,
        }
        if token:
            h['Authorization'] = token
        return h

    def grant_token(self):
        # Step 1: Access token নেওয়া
        url = f'{self.base_url}/tokenized/checkout/token/grant'
        logger.info(f'bKash grant_token: url={url}, app_key={self.app_key[:10]}..., username={self.username}')
        r = requests.post(url, json={
            'app_key':    self.app_key,
            'app_secret': self.app_secret,
        }, headers={
            'Content-Type': _CONTENT_JSON,
            'Accept':       _CONTENT_JSON,
            'username':     self.username,
            'password':     self.password,
        }, timeout=15)
        data = r.json()
        logger.info(f'bKash grant_token response ({r.status_code}): {data}')
        if r.status_code != 200 or 'id_token' not in data:
            raise BkashError(data.get('statusMessage', f'Token error: {data}'))
        return data['id_token']

    def create_payment(self, token, amount, invoice_no, callback_url, payer_ref=''):
        # Step 2: Payment session তৈরি করা
        url = f'{self.base_url}/tokenized/checkout/create'
        payload = {
            'mode':                  '0011',
            'payerReference':        payer_ref or invoice_no,
            'callbackURL':           callback_url,
            'amount':                str(int(float(amount))),
            'currency':              'BDT',
            'intent':                'sale',
            'merchantInvoiceNumber': invoice_no[:50],
        }
        logger.info(f'bKash create_payment payload: {payload}')
        r = requests.post(url, json=payload, headers=self._headers(token), timeout=15)
        data = r.json()
        logger.info(f'bKash create_payment response ({r.status_code}): {data}')
        if data.get('statusCode') != '0000':
            raise BkashError(f"{data.get('statusMessage','error')} | {data}")
        return {
            'bkash_url':  data['bkashURL'],
            'payment_id': data['paymentID'],
        }

    def execute_payment(self, token, payment_id):
        # Step 3: Payment confirm করা (callback-এ call হয়)
        url = f'{self.base_url}/tokenized/checkout/execute'
        r = requests.post(url, json={'paymentID': payment_id},
                          headers=self._headers(token), timeout=15)
        data = r.json()
        if data.get('statusCode') != '0000' or data.get('transactionStatus') != 'Completed':
            logger.error(f'bKash execute_payment failed: {data}')
            raise BkashError(data.get('statusMessage', 'Payment execution failed'))
        return {
            'trx_id':    data.get('trxID', ''),
            'amount':    data.get('amount', ''),
            'payer_ref': data.get('payerReference', ''),
            # sender-এর wallet নম্বর (FromWallet) — bKash execute response-এ আসে
            'customer_msisdn': (data.get('customerMsisdn') or
                                data.get('payerReference', '')),
        }
