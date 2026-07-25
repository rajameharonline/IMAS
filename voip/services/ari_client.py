# ARI (Asterisk REST Interface) client — server-initiated কল originate করার জন্য।
# কেন urllib (requests নয়): বাড়তি dependency এড়াতে stdlib দিয়েই কাজ চলে।
# Passive call logging AMI দিয়ে হয় (voip_call_listener) — এটি শুধু originate।
import base64
import json
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings


def _ari_request(method: str, path: str, params: dict):
    base = getattr(settings, 'ASTERISK_ARI_URL', 'http://127.0.0.1:8088').rstrip('/')
    user = getattr(settings, 'ASTERISK_ARI_USER', '')
    pwd = getattr(settings, 'ASTERISK_ARI_PASS', '')
    url = f'{base}/ari{path}?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, method=method)
    token = base64.b64encode(f'{user}:{pwd}'.encode()).decode()
    req.add_header('Authorization', f'Basic {token}')
    with urllib.request.urlopen(req, timeout=8) as resp:
        body = resp.read().decode() or '{}'
        return json.loads(body)


def originate_call(caller: str, callee: str) -> str:
    """agent (caller)-এর softphone বাজে; answer করলে dialplan callee-কে dial করে।
    ফেরত: তৈরি channel-এর id (CallLog correlation-এ ব্যবহার্য)।"""
    # endpoint=caller (agent) → answer হলে voip-internal context-এ exten=callee dial হয়।
    data = _ari_request('POST', '/channels', {
        'endpoint': f'PJSIP/{caller}',
        'extension': callee,
        'context': 'voip-internal',
        'priority': 1,
        'callerId': callee,
        'timeout': 30,
    })
    return data.get('id', '')
