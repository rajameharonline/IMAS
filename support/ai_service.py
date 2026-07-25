# AI Support service — local Ollama (dedicated মেশিন) দিয়ে support খসড়া উত্তর।
#
# 🔒 DATA SECURITY (গুরুত্বপূর্ণ):
#   AI-তে শুধু NON-SENSITIVE তথ্য যায় — status, package, বকেয়া পরিমাণ, online/
#   offline, ticket text। NID, password, পূর্ণ ফোন, পূর্ণ ঠিকানা, পেমেন্ট/কার্ড
#   details — কখনো প্রম্পটে যায় না (safe_client_context-এ hard-coded ভাবে শুধু
#   নিরাপদ field পড়া হয়)। Ollama local মেশিনে চলে বলে data নেটওয়ার্কের বাইরেও
#   যায় না — সম্পূর্ণ আপনার নিয়ন্ত্রণে।
#
# provider-agnostic: AI_PROVIDER বদলে পরে cloud (OpenAI/Anthropic) বা বড় GPU
# মেশিনে নেওয়া যাবে — শুধু settings/.env বদলালেই হবে।
import logging
import random
import requests
from django.conf import settings

logger = logging.getLogger(__name__)



# পুনরাবৃত্ত literal — S1192 এড়াতে module constant
_NO_CUSTOMER_INFO = 'গ্রাহক তথ্য নেই।'
_NO_DUE = "বকেয়া: নেই"

def _pick(*options):
    """variation-এর জন্য একটি phrasing বেছে নেয় — যাতে পরপর উত্তর একঘেয়ে না হয়।"""
    return random.choice(options)


# ──────────────────────────────────────────────────────────
# Provider-agnostic chat
# ──────────────────────────────────────────────────────────
def _ollama_chat(system: str, user: str, max_tokens: int, temperature: float, timeout=None) -> str:
    url = settings.AI_BASE_URL.rstrip('/') + '/api/chat'
    payload = {
        'model': settings.AI_MODEL,
        'messages': [
            {'role': 'system', 'content': system},
            {'role': 'user', 'content': user},
        ],
        'stream': False,
        'keep_alive': -1,  # model RAM-এ স্থায়ী রাখে → cold-start delay আর হয় না
        'options': {'num_predict': max_tokens, 'temperature': temperature},
    }
    r = requests.post(url, json=payload, timeout=timeout or settings.AI_TIMEOUT)
    r.raise_for_status()
    return ((r.json().get('message') or {}).get('content') or '').strip()


def chat(system: str, user: str, max_tokens: int = 400, temperature: float = 0.4, timeout=None) -> str:
    """এক প্রম্পট → AI উত্তর। provider অনুযায়ী রুট করে।
    timeout=None হলে settings.AI_TIMEOUT; দীর্ঘ generation-এ (যেমন background draft)
    আলাদা বড় timeout পাস করা যায়।
    """
    if not settings.AI_ENABLED:
        raise RuntimeError('AI বন্ধ (AI_ENABLED=False)')
    provider = (settings.AI_PROVIDER or 'ollama').lower()
    if provider == 'ollama':
        return _ollama_chat(system, user, max_tokens, temperature, timeout=timeout)
    # ভবিষ্যতে: openai / anthropic যোগ করা যাবে (একই signature)
    raise RuntimeError(f'AI provider এখনো সমর্থিত নয়: {provider}')


def _ollama_chat_messages(messages: list, max_tokens: int, temperature: float) -> str:
    """পূর্ণ messages তালিকা (system + multi-turn) দিয়ে Ollama chat — কথোপকথনের context রাখে।"""
    url = settings.AI_BASE_URL.rstrip('/') + '/api/chat'
    payload = {
        'model': settings.AI_MODEL,
        'messages': messages,
        'stream': False,
        'keep_alive': -1,
        'options': {'num_predict': max_tokens, 'temperature': temperature},
    }
    r = requests.post(url, json=payload, timeout=settings.AI_TIMEOUT)
    r.raise_for_status()
    return ((r.json().get('message') or {}).get('content') or '').strip()


def chat_messages(messages: list, max_tokens: int = 320, temperature: float = 0.5) -> str:
    """multi-turn কথোপকথন → AI উত্তর (history সহ)। provider অনুযায়ী রুট করে।"""
    if not settings.AI_ENABLED:
        raise RuntimeError('AI বন্ধ (AI_ENABLED=False)')
    provider = (settings.AI_PROVIDER or 'ollama').lower()
    if provider == 'ollama':
        return _ollama_chat_messages(messages, max_tokens, temperature)
    raise RuntimeError(f'AI provider এখনো সমর্থিত নয়: {provider}')


def is_available() -> bool:
    """Ollama/AI সার্ভিস পৌঁছানো যায় কিনা (UI-তে বাটন দেখানোর আগে চেক)।"""
    if not settings.AI_ENABLED:
        return False
    try:
        if (settings.AI_PROVIDER or 'ollama').lower() == 'ollama':
            r = requests.get(settings.AI_BASE_URL.rstrip('/') + '/api/tags', timeout=5)
            return r.status_code == 200
    except Exception:
        return False
    return True


# ──────────────────────────────────────────────────────────
# 🔒 Safe client context — শুধু non-sensitive field
# ──────────────────────────────────────────────────────────
def _ctx_status(client):
    try:
        status = client.get_status_display() if hasattr(client, 'get_status_display') else client.status
        return f"স্ট্যাটাস: {status}"
    except Exception:
        return None


def _ctx_package(client):
    try:
        if client.package_id and client.package:
            return f"প্যাকেজ: {client.package.name}"
    except Exception:
        pass
    return None


def _ctx_due(client):
    try:
        due = float(client.due_amount or 0)
        return f"বকেয়া বিল: {due:.0f} টাকা" if due > 0 else _NO_DUE
    except Exception:
        return None


def _ctx_expiry(client):
    try:
        if client.expiry_date:
            return f"মেয়াদ শেষের তারিখ: {client.expiry_date}"
    except Exception:
        pass
    return None


def _ctx_online(client):
    # live online status (helper support/api/views-এ আছে)
    try:
        from support.api.views import _client_online_status
        st = _client_online_status(client)
        if isinstance(st, dict):
            return "সংযোগ: " + ("Online" if st.get('online') else "Offline")
    except Exception:
        pass
    return None


def safe_client_context(client) -> str:
    """Client-এর শুধু নিরাপদ তথ্য AI-তে পাঠানোর জন্য সাজায়।

    এখানে ইচ্ছাকৃতভাবে শুধু নিচের field গুলো পড়া হয় — NID/password/পূর্ণ ফোন/
    পূর্ণ ঠিকানা/পেমেন্ট details কখনো নয়।
    """
    if not client:
        return _NO_CUSTOMER_INFO
    lines = [
        line for line in (
            _ctx_status(client),
            _ctx_package(client),
            _ctx_due(client),
            _ctx_expiry(client),
            _ctx_online(client),
        ) if line
    ]
    return '\n'.join(lines) if lines else 'গ্রাহকের প্রাসঙ্গিক তথ্য নেই।'


# ──────────────────────────────────────────────────────────
# Feature: Suggest reply for a support ticket
# ──────────────────────────────────────────────────────────
# ── পথ A: AI শুধু শ্রেণিবদ্ধ করে; উত্তর আসে মানুষ-লেখা বাংলা template থেকে ──
# (ছোট 3B model বাংলা generation-এ দুর্বল, কিন্তু classification ভালো পারে। তাই
#  নির্ভরযোগ্য পেশাদার বাংলা পেতে template + client data ব্যবহার করি।)

INTENTS = [
    'billing_due',      # বিল/বকেয়া/পেমেন্ট
    'connection_down',  # নেট নেই / সংযোগ বন্ধ
    'speed_slow',       # গতি কম
    'package_change',   # প্যাকেজ পরিবর্তন/আপগ্রেড
    'new_connection',   # নতুন সংযোগ
    'general',          # অন্যান্য
]

# intent → support category নাম + priority (auto-categorize-এ ব্যবহৃত)
INTENT_META = {
    'billing_due':     {'category': 'বিল ও পেমেন্ট',   'priority': 'medium'},
    'connection_down': {'category': 'সংযোগ বিচ্ছিন্ন',  'priority': 'high'},
    'speed_slow':      {'category': 'গতি সমস্যা',       'priority': 'medium'},
    'package_change':  {'category': 'প্যাকেজ পরিবর্তন', 'priority': 'low'},
    'new_connection':  {'category': 'নতুন সংযোগ',       'priority': 'low'},
    'general':         {'category': 'সাধারণ',           'priority': 'medium'},
}

CLASSIFY_SYSTEM = (
    "তুমি একটি ISP ticket classifier। গ্রাহকের সমস্যা পড়ে শুধু একটি keyword দাও, "
    "অন্য কিছু লিখবে না। সম্ভাব্য keyword: "
    "billing_due (বিল/বকেয়া/পেমেন্ট), connection_down (নেট নেই/সংযোগ বন্ধ), "
    "speed_slow (গতি কম/slow), package_change (প্যাকেজ বদল/আপগ্রেড), "
    "new_connection (নতুন সংযোগ), general (অন্য সব)।"
)


def classify_text(text: str) -> str:
    """যেকোনো সমস্যা-text কে একটি intent keyword-এ শ্রেণিবদ্ধ করে (fallback: general)।"""
    text = (text or '')[:800]
    if not text.strip():
        return 'general'
    try:
        out = chat(CLASSIFY_SYSTEM, f"সমস্যা: {text}\nkeyword:",
                   max_tokens=8, temperature=0.0).lower()
        for intent in INTENTS:
            if intent in out:
                return intent
    except Exception as e:
        logger.warning("classify_text failed: %s", e)
    return 'general'


def classify_ticket(ticket) -> str:
    """ticket → intent keyword।"""
    return classify_text(f"{ticket.subject}\n{ticket.description}")


# গ্রাহক অসন্তুষ্ট/রাগান্বিত/হুমকিমূলক — staff আগে অ্যাটেন্ড করার জন্য flag
_NEGATIVE_TOKENS = (
    'বিরক্ত', 'জঘন্য', 'বাজে', 'ফালতু', 'রাগ', 'অভিযোগ করব', 'ভোগান্তি', 'কতবার বল',
    'কতবার বললাম', 'টাকা ফেরত', 'রিফান্ড', 'প্রতারণা', 'খারাপ সার্ভিস', 'বাজে সার্ভিস',
    'সবচেয়ে খারাপ', 'অন্য কোম্পানি', 'চলে যাব', 'লাইন কেটে দেব', 'সহ্য', 'মেজাজ',
    'ক্ষতিপূরণ', 'cheat', 'terrible', 'worst', 'disgusting', 'scam',
)


def classify_sentiment(text: str) -> str:
    """গ্রাহকের বার্তা → 'negative' (অসন্তুষ্ট/রাগান্বিত) অথবা 'neutral'।

    আগে keyword (instant), না মিললে LLM ছোট classify (background task বলে গতি সমস্যা নয়)।
    """
    t = (text or '').lower()
    if any(k in t for k in _NEGATIVE_TOKENS):
        return 'negative'
    try:
        out = chat(
            "তুমি একটি sentiment classifier। গ্রাহকের বার্তা পড়ে শুধু একটি শব্দ দাও: "
            "negative (রাগ/অসন্তুষ্ট/হুমকি/তীব্র অভিযোগ) অথবা neutral। অন্য কিছু লিখবে না।",
            f"বার্তা: {(text or '')[:600]}\nউত্তর:", max_tokens=4, temperature=0.0).lower()
        if any(k in out for k in ('negativ', 'নেগেট', 'রাগ', 'অসন্তু')):
            return 'negative'
    except Exception as e:
        logger.warning("classify_sentiment failed: %s", e)
    return 'neutral'


def _due(client) -> float:
    try:
        return float(client.due_amount or 0) if client else 0.0
    except Exception:
        return 0.0


def _is_online(client) -> bool:
    try:
        from support.api.views import _client_online_status
        st = _client_online_status(client)
        return bool(isinstance(st, dict) and st.get('online'))
    except Exception:
        return False


# ──────────────────────────────────────────────────────────
# নির্দিষ্ট তথ্য-ভিত্তিক উত্তর (deterministic) — গ্রাহকের আসল data থেকে
# precise জবাব। মেয়াদ/বকেয়া/প্যাকেজ/স্ট্যাটাস-এর মত factual প্রশ্নে template
# generic উত্তর না দিয়ে এখান থেকে সঠিক specific উত্তর দেওয়া হয়।
# ──────────────────────────────────────────────────────────
_BN_MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
              'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর']


def _bn_date(d) -> str:
    """date → "১২ জুন ২০২৬" (বাংলা মাস)। digit ইংরেজিই রাখা হয় (পড়তে সহজ)।"""
    try:
        return f"{d.day} {_BN_MONTHS[d.month - 1]} {d.year}" if d else ''
    except Exception:
        return str(d or '')


def _days_left(client):
    """মেয়াদ শেষ হতে আর কত দিন (ঋণাত্মক = পার হয়ে গেছে)। না থাকলে None।"""
    try:
        from django.utils import timezone
        if client and client.expiry_date:
            return (client.expiry_date - timezone.localdate()).days
    except Exception:
        pass
    return None


def _pkg_speed(client) -> str:
    try:
        if client and client.package_id and client.package:
            return (client.package.speed_name or '').strip()
    except Exception:
        pass
    return ''


def _wrap(body: str) -> str:
    closing = _pick("ধন্যবাদ।", "আপনার সহযোগিতার জন্য ধন্যবাদ।", "ধন্যবাদান্তে।")
    return f"প্রিয় গ্রাহক,\n\n{body}\n\n{closing}"


def _client_answer_ctx(client):
    """precise-answer branch helpers-এর জন্য common client value bundle।"""
    due = _due(client)
    try:
        monthly = float(client.monthly_bill or 0)
    except Exception:
        monthly = 0.0
    try:
        advance = float(getattr(client, 'advance_balance', 0) or 0)
    except Exception:
        advance = 0.0
    return {
        'due': due,
        'due_txt': f"৳{due:.0f}",
        'exp': getattr(client, 'expiry_date', None),
        'days': _days_left(client),
        'pkg': client.package.name if (client.package_id and client.package) else '',
        'speed': _pkg_speed(client),
        'monthly': monthly,
        'advance': advance,
    }


def _answer_expiry(ctx):
    exp, days, due, due_txt = ctx['exp'], ctx['days'], ctx['due'], ctx['due_txt']
    if exp:
        s = f"আপনার সংযোগের মেয়াদ শেষ হবে {_bn_date(exp)}।"
        if days is not None:
            if days > 0:
                s += f" আর {days} দিন বাকি আছে।"
            elif days == 0:
                s += " আজই মেয়াদ শেষ হচ্ছে।"
            else:
                s += f" মেয়াদ {abs(days)} দিন আগে শেষ হয়েছে।"
        if due > 0:
            s += (f" বর্তমান বকেয়া {due_txt} — অ্যাপে bKash দিয়ে পরিশোধ করলে "
                  f"মেয়াদ বেড়ে সংযোগ সচল থাকবে।")
        return _wrap(s)
    return _wrap("আপনার অ্যাকাউন্টে মেয়াদের তারিখ এখনো নির্ধারিত নেই। বিস্তারিত জানতে "
                 "অনুগ্রহ করে আমাদের অফিসে যোগাযোগ করুন।")


def _answer_due(ctx):
    due, due_txt, exp, advance = ctx['due'], ctx['due_txt'], ctx['exp'], ctx['advance']
    if due > 0:
        s = f"আপনার বর্তমান বকেয়া {due_txt}।"
        if exp:
            s += f" মেয়াদ {_bn_date(exp)} পর্যন্ত।"
        s += " অ্যাপে লগইন করে bKash দিয়ে পরিশোধ করলে কিছুক্ষণের মধ্যেই সংযোগ সচল হবে।"
        return _wrap(s)
    s = "আপনার অ্যাকাউন্টে এই মুহূর্তে কোনো বকেয়া নেই।"
    if advance > 0:
        s += f" অ্যাডভান্স জমা আছে ৳{advance:.0f}।"
    if exp:
        s += f" পরবর্তী মেয়াদ শেষ {_bn_date(exp)}।"
    return _wrap(s)


def _answer_package(ctx):
    pkg, speed, monthly = ctx['pkg'], ctx['speed'], ctx['monthly']
    if pkg or speed:
        label = pkg + (f" ({speed})" if speed and speed not in pkg else '')
        s = f"আপনার বর্তমান প্যাকেজ: {label}।"
        if monthly > 0:
            s += f" মাসিক বিল ৳{monthly:.0f}।"
        return _wrap(s)
    return _wrap("আপনার প্যাকেজের তথ্য এই মুহূর্তে পাওয়া যাচ্ছে না। অনুগ্রহ করে অফিসে যোগাযোগ করুন।")


def _answer_status(client, ctx):
    due, due_txt = ctx['due'], ctx['due_txt']
    online = _is_online(client)
    if online:
        s = "আমাদের সিস্টেমে আপনার সংযোগ এই মুহূর্তে Online (চালু) দেখাচ্ছে।"
    else:
        s = ("আমাদের সিস্টেমে আপনার সংযোগ এই মুহূর্তে Offline দেখাচ্ছে। "
             "router/ONU-এর power ও fiber cable চেক করে একবার restart দিন।")
    if due > 0:
        s += f" উল্লেখ্য, {due_txt} বকেয়া রয়েছে।"
    return _wrap(s)


def _answer_account(ctx):
    pkg, speed, monthly = ctx['pkg'], ctx['speed'], ctx['monthly']
    due, due_txt, exp, days = ctx['due'], ctx['due_txt'], ctx['exp'], ctx['days']
    parts = []
    if pkg or speed:
        parts.append(f"প্যাকেজ: {pkg}{(' (' + speed + ')') if speed and speed not in pkg else ''}")
    if monthly > 0:
        parts.append(f"মাসিক বিল: ৳{monthly:.0f}")
    parts.append(f"বকেয়া: {due_txt}" if due > 0 else _NO_DUE)
    if exp:
        tail = f" (আর {days} দিন)" if (days is not None and days >= 0) else ""
        parts.append(f"মেয়াদ শেষ: {_bn_date(exp)}{tail}")
    return _wrap("আপনার অ্যাকাউন্টের তথ্য:\n• " + "\n• ".join(parts))


def _specific_answer(message: str, client):
    """প্রশ্নে নির্দিষ্ট তথ্য চাওয়া হলে আসল data দিয়ে precise উত্তর; নাহলে None।"""
    if not client:
        return None
    m = (message or '').lower()

    def has(*kw):
        return any(k in m for k in kw)

    ctx = _client_answer_ctx(client)

    # ── মেয়াদ / expiry date ──────────────────────────────
    if has('মেয়াদ', 'এক্সপায়ার', 'এক্সপায়ারি', 'expire', 'expiry',
           'কবে শেষ', 'কত দিন', 'কতদিন', 'কয় দিন', 'কয়দিন', 'renew', 'রিনিউ'):
        return _answer_expiry(ctx)

    # ── বকেয়া / বিল কত ───────────────────────────────────
    if has('বকেয়া', 'কত টাকা', 'কত বিল', 'বিল কত', 'due', 'কত দিতে', 'পরিশোধ', 'বাকি আছে'):
        return _answer_due(ctx)

    # ── প্যাকেজ / স্পিড ──────────────────────────────────
    if has('প্যাকেজ', 'package', 'স্পিড', 'speed', 'গতি কত', 'কত mbps', 'mbps', 'প্ল্যান', 'plan'):
        return _answer_package(ctx)

    # ── সংযোগ online/offline / status ────────────────────
    if has('অনলাইন', 'online', 'অফলাইন', 'offline', 'সংযোগ আছে', 'connected', 'কানেক্ট',
           'স্ট্যাটাস', 'status', 'সচল', 'চালু আছে'):
        return _answer_status(client, ctx)

    # ── অ্যাকাউন্ট সারসংক্ষেপ / আমার তথ্য ────────────────
    if has('আমার তথ্য', 'অ্যাকাউন্ট', 'account', 'সারাংশ', 'details', 'বিস্তারিত', 'সব তথ্য'):
        return _answer_account(ctx)

    return None


# সংযোগ "বারবার যায়/ডিস্টার্ব" (intermittent) — billing নয়, লাইন সমস্যা; বকেয়া থাকলেও escalate
_INTERMITTENT_TOKENS = ('বারবার', 'মাঝে মাঝে', 'মাঝেমাঝে', 'ডিস্টার্ব', 'ছেড়ে দেয়',
                        'কেটে যায়', 'আসা যাওয়া', 'disturb', 'drop')


def _reply_connection_down(intermittent, expired, online, due, due_txt):
    """connection_down intent-এর body — অভিযোগের ধরন (intermittent/expired/online/offline)
    অনুযায়ী উপযুক্ত বাংলা উত্তর।"""
    lead = _pick("আপনার অসুবিধার জন্য আন্তরিকভাবে দুঃখিত।",
                 "সমস্যাটির জন্য আমরা দুঃখিত।",
                 "বিষয়টি জানানোর জন্য ধন্যবাদ, অসুবিধার জন্য দুঃখিত।")
    steps = _pick(
        "router/ONU টি ১০ সেকেন্ড বন্ধ রেখে আবার চালু করুন এবং fiber/তারের সংযোগ ঢিলা আছে কিনা দেখুন।",
        "একবার router/ONU restart দিন এবং power ও fiber cable ঠিকমতো লাগানো আছে কিনা যাচাই করুন।")
    if intermittent:
        body = (f"{lead} সংযোগ {_pick('বারবার চলে যাওয়া', 'মাঝে মাঝে কেটে যাওয়া')} সাধারণত "
                f"তার/ONU বা signal-জনিত হতে পারে। অনুগ্রহ করে {steps} এরপরও সমস্যা থাকলে "
                f"জানান — আমরা লাইন পরীক্ষা করে দ্রুত টেকনিশিয়ান পাঠাবো।")
        if due > 0:
            body += f" (উল্লেখ্য, {due_txt} বকেয়া থাকলে মাঝে মাঝে সংযোগ সীমিত হতে পারে।)"
        return body
    if expired or due > 0:
        return (f"{lead} আমাদের সিস্টেমে {due_txt} বকেয়া থাকায় সংযোগ সীমিত/বন্ধ থাকতে পারে। "
                f"অ্যাপে bKash দিয়ে পরিশোধ করলে সংযোগ স্বয়ংক্রিয়ভাবে চালু হবে। তবুও সমস্যা "
                f"থাকলে জানান — আমরা লাইন চেক করব।")
    if online:
        tail = _pick("তারপরও সমস্যা থাকলে জানান — টেকনিশিয়ান পাঠানো হবে।",
                     "এরপরও ঠিক না হলে আমাদের জানাবেন, আমরা লাইন পরীক্ষা করব।",
                     "তবুও সমস্যা থাকলে জানান — দ্রুত প্রয়োজনীয় ব্যবস্থা নেব।")
        return (f"{lead} আমাদের সিস্টেমে আপনার সংযোগ এই মুহূর্তে Online দেখাচ্ছে। "
                f"অনুগ্রহ করে {steps} {tail}")
    tail = _pick("সমস্যা না গেলে জানান, দ্রুত টেকনিশিয়ান পাঠানো হবে।",
                 "এরপরও ঠিক না হলে জানাবেন — আমরা দ্রুত টেকনিশিয়ান পাঠিয়ে দেব।",
                 "তবুও সমস্যা থাকলে জানান, আমরা লাইন পরীক্ষা করে দ্রুত ব্যবস্থা নেব।")
    return (f"{lead} আপনার সংযোগ এই মুহূর্তে Offline দেখাচ্ছে। অনুগ্রহ করে {steps} {tail}")


def _reply_billing_due(due, due_txt):
    if due > 0:
        return (f"আমাদের সিস্টেমে আপনার বর্তমান বকেয়া {due_txt}। "
                + _pick("অনুগ্রহ করে অ্যাপে লগইন করে bKash দিয়ে পরিশোধ করুন",
                        "অ্যাপ থেকে bKash-এ সহজেই পরিশোধ করতে পারেন")
                + " — পরিশোধের কিছুক্ষণের মধ্যেই সংযোগ স্বয়ংক্রিয়ভাবে সচল হবে।")
    return _pick(
        "আপনার অ্যাকাউন্টে এই মুহূর্তে কোনো বকেয়া নেই। বিল সংক্রান্ত আর কিছু জানতে চাইলে বলুন।",
        "এই মুহূর্তে আপনার কোনো বিল বকেয়া নেই। অন্য কোনো সাহায্য লাগলে জানাবেন।")


def _reply_speed_slow(pkg):
    pkg_txt = f"আপনার প্যাকেজ {pkg}। " if pkg else ""
    return (f"{_pick('গতি কম পাওয়ায় দুঃখিত।', 'ধীরগতির সমস্যার জন্য দুঃখিত।')} {pkg_txt}"
            + _pick("একবার router restart দিন, সম্ভব হলে WiFi-এর বদলে cable দিয়ে speedtest করুন",
                    "router restart দিয়ে দেখুন এবং সম্ভব হলে তার দিয়ে সরাসরি speedtest করুন")
            + ", এবং একসাথে অনেক device যুক্ত আছে কিনা দেখুন। সমস্যা থাকলে জানান, আমরা আপনার লাইন পরীক্ষা করব।")


def _reply_package_change():
    return _pick(
        "প্যাকেজ পরিবর্তন/আপগ্রেড করতে চাইলে কোন প্যাকেজ নিতে চান জানান — আমাদের প্রতিনিধি শীঘ্রই ব্যবস্থা নেবেন।",
        "কোন প্যাকেজে যেতে চান একটু জানালে আমরা প্রয়োজনীয় পরিবর্তন দ্রুত করে দেব।")


def _reply_new_connection():
    return ("নতুন সংযোগে আগ্রহ প্রকাশ করায় ধন্যবাদ। আপনার এলাকা ও একটি যোগাযোগ নম্বর জানালে "
            "আমরা feasibility যাচাই করে দ্রুত যোগাযোগ করব।")


def _reply_general():
    return _pick(
        "আপনার বার্তাটি পেয়েছি এবং বিষয়টি দেখছি। শীঘ্রই সমাধান/উত্তর জানাবো।",
        "বিষয়টি আমরা নোট করেছি এবং দ্রুত প্রয়োজনীয় ব্যবস্থা নিচ্ছি।")


def render_reply(intent: str, client, message: str = '') -> str:
    """intent + client-এর আসল data (+ গ্রাহকের বার্তা) → সহানুভূতিশীল, বৈচিত্র্যময় বাংলা উত্তর।

    message দিলে অভিযোগের ধরন বুঝে (intermittent/disturbance বনাম একদম বন্ধ) উপযুক্ত উত্তর
    দেয়; এবং পরপর একই মেসেজে একঘেয়ে না হতে phrasing variation ব্যবহার করে।
    """
    due = _due(client)
    pkg = (client.package.name if client and client.package_id and client.package else '')
    expired = bool(client and getattr(client, 'status', '') in ('expired', 'suspended', 'inactive'))
    online = _is_online(client)
    due_txt = f"৳{due:.0f}"
    m = (message or '').lower()
    # অভিযোগ intermittent (বারবার যায়/ডিস্টার্ব) নাকি একদম বন্ধ?
    intermittent = any(k in m for k in _INTERMITTENT_TOKENS)

    if intent == 'billing_due':
        body = _reply_billing_due(due, due_txt)
    elif intent == 'connection_down':
        body = _reply_connection_down(intermittent, expired, online, due, due_txt)
    elif intent == 'speed_slow':
        body = _reply_speed_slow(pkg)
    elif intent == 'package_change':
        body = _reply_package_change()
    elif intent == 'new_connection':
        body = _reply_new_connection()
    else:  # general
        body = _reply_general()

    closing = _pick("ধন্যবাদ।", "আপনার সহযোগিতার জন্য ধন্যবাদ।", "ধন্যবাদান্তে।")
    return f"প্রিয় গ্রাহক,\n\n{body}\n\n{closing}"


# খসড়া উত্তরের system prompt — পেশাদার, data-driven reply (staff edit করে পাঠাবে)।
TICKET_DRAFT_SYSTEM = (
    "তুমি একটি বাংলাদেশি ISP কোম্পানির অভিজ্ঞ ও পেশাদার গ্রাহকসেবা প্রতিনিধি। নিচের "
    "'গ্রাহক প্রোফাইল' (প্যাকেজ, সংযোগ, বিলিং, live সংযোগ ও ফাইবার সিগন্যাল) এবং 'টিকেট "
    "বিবরণ' বিশ্লেষণ করে গ্রাহককে পাঠানোর জন্য একটি পূর্ণাঙ্গ, পেশাদার খসড়া উত্তর লেখো।\n"
    "নিয়ম:\n"
    "• শুধু নিচে দেওয়া তথ্য ব্যবহার করো — অনুমান বা বানিয়ে কিছু বলবে না; তথ্যে না থাকলে "
    "নম্রভাবে যাচাই করে জানানোর আশ্বাস দাও।\n"
    "• গ্রাহকের আসল সমস্যাটা (টিকেটের বিষয়/বিবরণ) সরাসরি ও বুদ্ধিমত্তার সাথে সম্বোধন করো।\n"
    "• প্রাসঙ্গিক ডেটা মিলিয়ে কারণ ও করণীয় বলো:\n"
    "   – সংযোগ বন্ধ/ধীর: live Online/Offline দেখে — Offline হলে fiber/তার ও ONU পরীক্ষা "
    "ও টেকনিশিয়ান পাঠানোর কথা; Online হলে router/ONU restart-এর ধাপ। (RX dBm-এর মতো "
    "কারিগরি মান বার্তায় কখনো লিখবে না।)\n"
    "   – বকেয়া/মেয়াদ শেষ: বকেয়া পরিমাণ ও মেয়াদের তারিখ উল্লেখ করে নম্রভাবে অ্যাপে bKash-এ "
    "পরিশোধের কথা; অগ্রিম ব্যালেন্স থাকলে সেটাও জানাও।\n"
    "• গঠন: সম্বোধন → সহানুভূতি → পরিস্থিতির সংক্ষিপ্ত বিশ্লেষণ → সুনির্দিষ্ট করণীয়/সমাধান → "
    "আশ্বাস ও ধন্যবাদ। ভদ্র, পেশাদার, প্রাঞ্জল চলিত বাংলা (৩-৬ বাক্য)।\n"
    "• গোপন/অভ্যন্তরীণ তথ্য (NID/পাসওয়ার্ড/ঠিকানা/সার্ভার IP/কারিগরি গোপন) উল্লেখ করবে না।"
)


def _ticket_context(ticket) -> str:
    """LLM grounding-এর জন্য টিকেটের বিবরণ + সাম্প্রতিক কথোপকথন (non-sensitive)।"""
    lines = []
    if getattr(ticket, 'subject', ''):
        lines.append(f"বিষয়: {ticket.subject}")
    cat = getattr(getattr(ticket, 'category', None), 'name', '') or ''
    if cat:
        lines.append(f"ধরন: {cat}")
    if getattr(ticket, 'priority', ''):
        lines.append(f"অগ্রাধিকার: {ticket.priority}")
    if getattr(ticket, 'status', ''):
        lines.append(f"অবস্থা: {ticket.status}")
    if getattr(ticket, 'description', ''):
        lines.append(f"গ্রাহকের বিবরণ: {ticket.description}")
    # সাম্প্রতিক কথোপকথন (সর্বশেষ ৪টি reply) — staff/গ্রাহক context
    try:
        recent = list(ticket.replies.order_by('created_at'))[-4:]
        for r in recent:
            who = 'গ্রাহক' if r.is_client_reply else 'Support'
            msg = (r.message or '').strip()
            if msg:
                lines.append(f"[{who}] {msg}")
    except Exception:
        pass
    return '\n'.join(lines)


def _client_rx(client):
    """গ্রাহকের সর্বশেষ ONU RX power + signal status (Online Monitoring থেকে)। নাই হলে None।"""
    try:
        from olt_mgmt.models import ONUSignal
        s = (ONUSignal.objects
             .filter(client=client, rx_power__isnull=False)
             .order_by('-last_updated').first())
        if s:
            return {'rx': float(s.rx_power), 'status': (s.signal_status or '')}
    except Exception:
        pass
    return None


def _last_payment(client):
    """সর্বশেষ পেমেন্ট (তারিখ + পরিমাণ + মাধ্যম) — Billing থেকে। নাই হলে None।"""
    try:
        from django.db.models import Q
        from billing.models import Payment
        p = (Payment.objects
             .filter(Q(client=client) | Q(bill__client=client))
             .order_by('-payment_date').first())
        if p:
            method = dict(Payment.PAYMENT_METHOD).get(p.payment_method, p.payment_method)
            return f"{p.payment_date:%Y-%m-%d}, ৳{float(p.amount):.0f} ({method})"
    except Exception:
        pass
    return None


def _snapshot_identity(client):
    """নাম / কাস্টমার আইডি / এলাকা।"""
    L = []
    if getattr(client, 'full_name', ''):
        L.append(f"নাম: {client.full_name}")
    if getattr(client, 'customer_id', ''):
        L.append(f"কাস্টমার আইডি: {client.customer_id}")
    zone = getattr(getattr(client, 'zone', None), 'name', '') or getattr(client, 'area', '') or ''
    if zone:
        L.append(f"এলাকা/জোন: {zone}")
    return L


def _snapshot_package_conn(client):
    """প্যাকেজ + সংযোগ ধরন + সার্ভার + স্ট্যাটাস (Client List)।"""
    L = []
    try:
        if client.package_id and client.package:
            sp = (getattr(client.package, 'speed_name', '') or '').strip()
            # speed নাম প্যাকেজ নামের মধ্যেই থাকলে আর আলাদা দেখাই না (duplicate এড়াতে)
            extra = f" ({sp})" if sp and sp.lower() not in client.package.name.lower() else ''
            L.append(f"প্যাকেজ: {client.package.name}{extra}")
    except Exception:
        pass
    proto = getattr(getattr(client, 'protocol', None), 'name', '') or ''
    if proto:
        L.append(f"সংযোগ ধরন: {proto}")
    srv = getattr(getattr(client, 'router', None), 'name', '') or ''
    if srv:
        L.append(f"সার্ভার: {srv}")
    try:
        st = client.get_status_display() if hasattr(client, 'get_status_display') else client.status
        if st:
            L.append(f"স্ট্যাটাস: {st}")
    except Exception:
        pass
    return L


def _snapshot_billing(client):
    """Live online + বকেয়া / অগ্রিম / মেয়াদ / সর্বশেষ পেমেন্ট।"""
    L = []
    # Live online/offline — RX dBm মান ইচ্ছাকৃতভাবে দেওয়া হয় না।
    L.append("সংযোগ এই মুহূর্তে: " + ("Online" if _is_online(client) else "Offline"))
    due = _due(client)
    L.append(f"বকেয়া বিল: {due:.0f} টাকা" if due > 0 else _NO_DUE)
    try:
        adv = float(client.advance_balance or 0)
        if adv > 0:
            L.append(f"অগ্রিম ব্যালেন্স: {adv:.0f} টাকা")
    except Exception:
        pass
    exp = getattr(client, 'expiry_date', None)
    if exp:
        d = _days_left(client)
        if d is None:
            L.append(f"মেয়াদ শেষ: {exp}")
        elif d >= 0:
            L.append(f"মেয়াদ শেষ: {exp} (বাকি {d} দিন)")
        else:
            L.append(f"মেয়াদ শেষ: {exp} ({abs(d)} দিন আগে পার হয়েছে)")
    lp = _last_payment(client)
    if lp:
        L.append(f"সর্বশেষ পেমেন্ট: {lp}")
    return L


def _ticket_client_snapshot(client) -> str:
    """Client List + Billing + Online Monitoring-এর তথ্য একত্রে — পেশাদার grounded
    reply-এর জন্য সম্পূর্ণ গ্রাহক প্রোফাইল (শুধু non-sensitive; NID/পাসওয়ার্ড/ঠিকানা বাদ)।"""
    if not client:
        return _NO_CUSTOMER_INFO
    L = _snapshot_identity(client) + _snapshot_package_conn(client) + _snapshot_billing(client)
    return '\n'.join(x for x in L if x)


def suggest_ticket_reply(ticket) -> str:
    """ticket + client-এর সম্পূর্ণ snapshot (Client List + Billing + Online Monitoring)
    দেখে AI পেশাদার বাংলা খসড়া তৈরি করে। LLM বন্ধ/ব্যর্থ হলে template fallback।
    """
    intent = classify_ticket(ticket)

    # ── Grounded LLM draft — শুধু .env-এ AI_DRAFT_USE_LLM=True হলে ──────────
    # কেন default-এ বন্ধ: local Ollama-র ছোট মডেল প্রায়ই ভাঙা/ভুল বাংলা লেখে যা
    # গ্রাহকের কাছে বিব্রতকর। তাই default-এ নিচের curated template (পরিষ্কার, পেশাদার,
    # data-aware ও _pick-এ varied) ব্যবহার হয়। ভালো বাংলা-সক্ষম মডেল/provider থাকলে
    # AI_DRAFT_USE_LLM=True দিয়ে grounded LLM চালু করা যায় (background-এ চলে, temp 0.6)।
    if getattr(settings, 'AI_DRAFT_USE_LLM', False):
        try:
            facts = _ticket_client_snapshot(ticket.client)
            tctx  = _ticket_context(ticket)
            user = (
                f"গ্রাহক প্রোফাইল:\n{facts}\n\n"
                f"টিকেট বিবরণ:\n{tctx}\n\n"
                "উপরের তথ্য বিশ্লেষণ করে গ্রাহককে পাঠানোর পূর্ণাঙ্গ পেশাদার খসড়া উত্তর (বাংলায়):"
            )
            out = (chat(
                TICKET_DRAFT_SYSTEM, user, max_tokens=340, temperature=0.6,
                timeout=getattr(settings, 'AI_DRAFT_TIMEOUT', 600),
            ) or '').strip()
            if len(out) >= 8:
                logger.info("AI suggest_reply(LLM) ticket %s → intent=%s", ticket.ticket_id, intent)
                return out
        except Exception as e:
            logger.warning("AI suggest_reply LLM failed (%s) — template fallback", e)

    # ── Fallback: intent-ভিত্তিক template ───────────────────────────────
    draft = render_reply(intent, ticket.client, f"{ticket.subject} {ticket.description}")
    logger.info("AI suggest_reply(template) ticket %s → intent=%s", ticket.ticket_id, intent)
    return draft


# ──────────────────────────────────────────────────────────
# Feature: App AI chatbot — client-এর প্রশ্নের instant উত্তর
# ──────────────────────────────────────────────────────────
# intent যেগুলো মানুষের হস্তক্ষেপ দরকার (auto-ticket-এর সম্ভাব্য প্রার্থী)
PROBLEM_INTENTS = {'connection_down', 'speed_slow', 'package_change', 'new_connection'}


def _fact_sheet(client) -> str:
    """LLM grounding-এর জন্য গ্রাহকের non-sensitive তথ্যের সারসংক্ষেপ।"""
    if not client:
        return _NO_CUSTOMER_INFO
    lines = []
    name = getattr(client, 'full_name', '') or ''
    if name:
        lines.append(f"নাম: {name}")
    # safe_client_context → status/package/due/expiry/online (multi-line)
    lines.append(safe_client_context(client))
    try:
        mb = float(client.monthly_bill or 0)
        if mb > 0:
            lines.append(f"মাসিক বিল: {mb:.0f} টাকা")
    except Exception:
        pass
    d = _days_left(client)
    if d is not None:
        lines.append(f"মেয়াদ শেষ হতে বাকি: {d} দিন" if d >= 0 else f"মেয়াদ পার হয়েছে: {abs(d)} দিন আগে")
    return '\n'.join(x for x in lines if x)


GROUND_SYSTEM = (
    "তুমি একটি বাংলাদেশি ISP কোম্পানির বিনয়ী সহায়ক AI। গ্রাহকের প্রশ্নের উত্তর দাও "
    "শুধুমাত্র নিচে দেওয়া 'গ্রাহক তথ্য' এবং সাধারণ ইন্টারনেট/ISP জ্ঞান ব্যবহার করে। "
    "তথ্যে না থাকলে অনুমান বা বানিয়ে কিছু বলবে না — সেক্ষেত্রে বলো বিষয়টি সাপোর্ট টিমকে "
    "জানানো হবে। সংক্ষিপ্ত (২-৪ বাক্য), ভদ্র ও প্রাঞ্জল বাংলায় উত্তর দাও। অভ্যন্তরীণ/"
    "কারিগরি/গোপন তথ্য উল্লেখ করবে না।"
)


CONVERSE_SYSTEM = (
    "তুমি একটি বাংলাদেশি ইন্টারনেট (ISP) কোম্পানির বন্ধুত্বপূর্ণ ও সহানুভূতিশীল গ্রাহকসেবা "
    "সহকারী। গ্রাহকের কথা মন দিয়ে বুঝে স্বাভাবিক, আন্তরিক ও মানবিকভাবে উত্তর দাও — প্রতিবার "
    "একই রকম যান্ত্রিক উত্তর দেবে না, কথোপকথনের প্রবাহ বজায় রাখো।\n"
    "নিয়ম:\n"
    "• নিচের 'গ্রাহক তথ্য' সত্য — শুধু এটাই ব্যবহার করো; বাইরের কিছু অনুমান বা বানিয়ে বলবে না।\n"
    "• সমস্যা শুনলে আগে সহানুভূতি জানাও, তারপর বাস্তব করণীয় ধাপ বলো (router/ONU restart, "
    "তার চেক ইত্যাদি) এবং প্রয়োজনে কারিগরি দল পাঠানোর আশ্বাস দাও।\n"
    "• বকেয়া/মেয়াদ-জনিত সংযোগ সমস্যা হলে নম্রভাবে অ্যাপে bKash-এ পরিশোধের কথা বলো — তবে "
    "শুধু সেটাই বারবার চাপিয়ে দিও না; গ্রাহকের আসল অভিযোগটাও আমলে নাও।\n"
    "• তথ্য কম থাকলে একটি স্পষ্ট প্রশ্ন করে বিস্তারিত জেনে নাও।\n"
    "• সংক্ষিপ্ত (২-৫ বাক্য), ভদ্র, প্রাঞ্জল চলিত বাংলায় উত্তর দাও। গোপন/অভ্যন্তরীণ তথ্য বলবে না।"
)


def _conversation_enabled() -> bool:
    """LLM কথোপকথন চালু কিনা। CPU Ollama খুব ধীর (৪০-৭০s/উত্তর, ১৫০s timeout হ্যাং করায়),
    তাই default-এ শুধু fast provider (openai/anthropic) বা explicit flag-এ চালু।

    .env: AI_CHAT_CONVERSATION=True দিলে ollama-তেও জোর করে চালু করা যায় (ধীরগতি মেনে)।
    """
    if not settings.AI_ENABLED:
        return False
    if getattr(settings, 'AI_CHAT_CONVERSATION', False):
        return True
    return (settings.AI_PROVIDER or 'ollama').lower() != 'ollama'


def _llm_converse(message: str, client, history=None):
    """গ্রাহকের সাথে natural multi-turn কথোপকথন — fact-sheet-এ grounded। ব্যর্থ হলে None।"""
    if not _conversation_enabled():
        return None
    try:
        facts = _fact_sheet(client)
        system = f"{CONVERSE_SYSTEM}\n\nগ্রাহক তথ্য:\n{facts}"
        messages = [{'role': 'system', 'content': system}]
        # সাম্প্রতিক কথোপকথন (সর্বশেষ ৬টি) — context ধরে রাখতে
        for h in (history or [])[-6:]:
            text = (h.get('text') or '').strip()
            if not text:
                continue
            role = 'assistant' if h.get('from') == 'bot' else 'user'
            messages.append({'role': role, 'content': text})
        messages.append({'role': 'user', 'content': message})
        out = (chat_messages(messages, max_tokens=320, temperature=0.5) or '').strip()
        return out if len(out) >= 4 else None
    except Exception as e:
        logger.warning("LLM converse failed: %s", e)
        return None


def _llm_grounded_answer(message: str, client):
    """fact-sheet দিয়ে free-form প্রশ্নের grounded বাংলা উত্তর; ব্যর্থ হলে None।"""
    try:
        facts = _fact_sheet(client)
        user = f"গ্রাহক তথ্য:\n{facts}\n\nপ্রশ্ন: {message}\n\nউত্তর (বাংলায়):"
        out = chat(GROUND_SYSTEM, user, max_tokens=300, temperature=0.3)
        out = (out or '').strip()
        return out if len(out) >= 4 else None
    except Exception as e:
        logger.warning("LLM grounded answer failed: %s", e)
        return None


def _recent_open_ticket(client):
    """গত ৬ ঘণ্টায় এই client-এর খোলা ticket থাকলে ফেরত দেয় (duplicate এড়াতে)।"""
    try:
        from datetime import timedelta
        from django.utils import timezone
        from support.models import SupportTicket
        return (SupportTicket.objects
                .filter(client=client, status__in=['open', 'in_progress'],
                        created_at__gte=timezone.now() - timedelta(hours=6))
                .order_by('-created_at').first())
    except Exception:
        return None


_PRIO_RANK = {'low': 1, 'medium': 2, 'high': 3, 'urgent': 4, 'critical': 5}


def _append_to_existing_ticket(existing, message, priority):
    """পুরনো খোলা ticket-এ গ্রাহকের নতুন বার্তা reply হিসেবে যোগ + জরুরি হলে priority bump
    → existing ticket।"""
    from support.models import TicketReply
    try:
        TicketReply.objects.create(ticket=existing, message=message, is_client_reply=True)
    except Exception:
        pass
    # জরুরি (যেমন ফাইবার কাটা) হলে existing ticket-এর priority bump করি
    if priority and _PRIO_RANK.get(priority, 0) > _PRIO_RANK.get(existing.priority, 0):
        try:
            existing.priority = priority
            existing.save(update_fields=['priority'])
        except Exception:
            pass
    return existing


def _generate_ticket_id():
    """অনন্য TKT-YYYYMMDD-XXXXXX আইডি (৫ চেষ্টা); না পেলে None।"""
    import uuid
    from django.utils import timezone
    from support.models import SupportTicket
    today = timezone.now().strftime('%Y%m%d')
    for _ in range(5):
        cand = f"TKT-{today}-{uuid.uuid4().hex[:6].upper()}"
        if not SupportTicket.objects.filter(ticket_id=cand).exists():
            return cand
    return None


def _create_new_ticket(client, message, priority, subject, category_name):
    """নতুন portal ticket তৈরি + ai_categorize dispatch → ticket বা None।"""
    from support.models import SupportTicket, SupportCategory
    tid = _generate_ticket_id()
    if not tid:
        return None

    subj = subject or ((message[:60] + ('…' if len(message) > 60 else '')) or 'গ্রাহক সহায়তা')
    create_kwargs = dict(
        ticket_id=tid, client=client,
        subject=subj, description=message,
        source='portal', status='open',
    )
    if priority:
        create_kwargs['priority'] = priority    # explicit (ai_categorize override করবে না)
    if category_name:
        cat, _ = SupportCategory.objects.get_or_create(
            name=category_name, defaults={'description': 'AI auto'})
        create_kwargs['category'] = cat
    ticket = SupportTicket.objects.create(**create_kwargs)
    try:
        from support.tasks import ai_categorize_ticket
        ai_categorize_ticket.delay(ticket.id)
    except Exception:
        pass
    logger.info("AI auto-created ticket %s for client %s", ticket.ticket_id,
                getattr(client, 'customer_id', client.pk))
    return ticket


def auto_create_ticket(message: str, client, priority=None, subject=None, category_name=None):
    """গ্রাহকের সমস্যা থেকে নিজে ticket তৈরি করে (source=portal) — signal স্বয়ংক্রিয়ভাবে
    admin/manager/support staff-কে StaffNotification (top-bar badge) পাঠায় এবং
    ai_categorize_ticket task category+priority সেট করে।

    priority/subject/category_name দিলে সেগুলো explicit সেট হয় (যেমন ফাইবার কাটা →
    'critical')। duplicate এড়াতে: গত ৬ ঘণ্টায় খোলা ticket থাকলে নতুন না বানিয়ে সেটিতেই
    গ্রাহকের নতুন বার্তা reply হিসেবে যোগ করে (priority দিলে existing-ও bump করে)। ব্যর্থ হলে None।
    """
    if not client:
        return None
    try:
        existing = _recent_open_ticket(client)
        if existing:
            return _append_to_existing_ticket(existing, message, priority)
        return _create_new_ticket(client, message, priority, subject, category_name)
    except Exception as e:
        logger.warning("auto_create_ticket failed: %s", e)
        return None


def _needs_ticket(intent: str, client) -> bool:
    """এই intent-এ মানুষের হস্তক্ষেপ দরকার কিনা (auto-ticket তৈরি হবে কিনা)।"""
    if intent in ('speed_slow', 'package_change', 'new_connection'):
        return True
    if intent == 'connection_down':
        # billing-জনিত (বকেয়া/মেয়াদ শেষ) হলে ticket নয় — পরিশোধেই সমাধান।
        due = _due(client)
        billing = bool(client and getattr(client, 'status', '') in ('expired', 'suspended', 'inactive'))
        return not (due > 0 or billing)
    return False


_GREET_TOKENS  = ('assalam', 'সালাম', 'আসসালাম', 'হ্যালো', 'hello', 'helo', 'নমস্কার', 'আদাব', 'hi')
_THANKS_TOKENS = ('ধন্যবাদ', 'thank', 'thanks', 'thnx', 'tnx', 'শুকরিয়া')
_OK_TOKENS     = ('ঠিক আছে', 'আচ্ছা', 'okay', 'okk', 'বুঝলাম', 'বুঝেছি')


def _smalltalk_reply(message: str):
    """greeting/ধন্যবাদ/ছোট acknowledgement হলে friendly উত্তর; নাহলে None।

    এতে greeting-এর জন্য অপ্রয়োজনীয় ticket তৈরি হয় না।
    """
    m = (message or '').strip().lower()
    if not m:
        return None
    short = len(m) <= 25
    if any(k in m for k in _THANKS_TOKENS):
        return "আপনাকে স্বাগতম! আর কোনো সাহায্য লাগলে নির্দ্বিধায় জানাবেন।"
    if short and any(k in m for k in _GREET_TOKENS):
        return ("আসসালামু আলাইকুম! আমি আপনার AI সহকারী। বিল, মেয়াদ, সংযোগ বা গতি সংক্রান্ত "
                "যেকোনো প্রশ্ন করুন — আমি সাহায্য করার চেষ্টা করব।")
    if short and (m in ('ok', 'k') or any(k in m for k in _OK_TOKENS)):
        return "জি, ধন্যবাদ! আর কিছু জানতে চাইলে নির্দ্বিধায় জিজ্ঞেস করুন।"
    return None


# গ্রাহক "বিল পরিশোধ করেছি" দাবি করলে — past-tense payment claim
_PAID_PHRASES = (
    'বিল দিয়েছি', 'বিল দিছি', 'বিল দিলাম', 'বিল জমা', 'বিল পরিশোধ', 'পরিশোধ করেছি',
    'পরিশোধ করলাম', 'পরিশোধ করে দিয়েছি', 'পেমেন্ট করেছি', 'পেমেন্ট দিয়েছি', 'পেমেন্ট করছি',
    'টাকা দিয়েছি', 'টাকা পাঠিয়েছি', 'টাকা জমা', 'বিকাশ করেছি', 'বিকাশ দিয়েছি', 'bkash করেছি',
    'পে করেছি', 'paid', 'দিয়ে দিয়েছি', 'রিচার্জ করেছি',
)


def _to_en_digits(s: str) -> str:
    """বাংলা সংখ্যা → ইংরেজি (০৫ → 05) — তারিখ পার্স করতে।"""
    return (s or '').translate(str.maketrans('০১২৩৪৫৬৭৮৯', '0123456789'))


def _claim_day(message: str):
    """বার্তা থেকে দাবিকৃত তারিখ (মাসের দিন ১-৩১) বের করে; না থাকলে None।"""
    import re
    m = _to_en_digits(message or '')
    mt = re.search(r'(\d{1,2})\s*(?:তারিখ|তারিখে|tarikh|date)', m)
    if not mt:
        mt = re.search(r'\b(\d{1,2})\b', m)
    if mt:
        d = int(mt.group(1))
        if 1 <= d <= 31:
            return d
    return None


def _payment_claim_answer(message: str, client):
    """গ্রাহক বিল পরিশোধের দাবি করলে আসল রেকর্ড (Payment + WebhookPayment) খুঁজে সঠিক উত্তর।

    উৎস: Payment (cash/collector/online — admin client/bill/collection তালিকার ভিত্তি),
    WebhookPayment (gateway/webhook তালিকা — matched ও unmatched উভয়)। না মিললে None।
    Returns: (reply_str, escalate_bool) অথবা None।
    """
    if not client:
        return None
    m = (message or '').lower()
    if not any(p in m for p in _PAID_PHRASES):
        return None
    try:
        from datetime import timedelta
        from django.utils import timezone

        since = timezone.now() - timedelta(days=60)
        claim_day = _claim_day(message)

        events = _recent_payment_events(client, since)
        if events:
            return _matched_payment_reply(client, events, claim_day)

        # ── client-এ কিছু নেই — গ্রাহকের ফোনে unmatched webhook আছে কিনা ──
        unmatched = _unmatched_webhook_reply(client, since)
        if unmatched is not None:
            return unmatched

        # ── কোথাও পাওয়া যায়নি — যাচাইয়ের জন্য escalate ──────────────
        return _wrap(
            "আপনার পেমেন্টটি আমাদের সিস্টেমে এখনো দেখা যাচ্ছে না। অনুগ্রহ করে কোন মাধ্যমে "
            "(bKash/Nagad/ক্যাশ), কত টাকা ও transaction ID/সময় জানান — আমরা বিষয়টি যাচাই "
            "করে দ্রুত সমন্বয় করে দিচ্ছি।"), True
    except Exception as e:
        logger.warning("payment_claim_answer failed: %s", e)
        return None


def _recent_payment_events(client, since):
    """client-এর সাম্প্রতিক Payment + matched WebhookPayment → normalized event list।"""
    from django.db.models import Q
    from django.utils import timezone
    from billing.models import Payment, WebhookPayment

    # (১) এই client-এর রেকর্ডকৃত Payment (client বা bill→client)
    pays = list(
        Payment.objects.filter(Q(client=client) | Q(bill__client=client),
                               payment_date__gte=since)
        .order_by('-payment_date')[:12]
    )
    # (২) এই client-এ matched gateway/webhook payment
    whs = list(
        WebhookPayment.objects.filter(matched_client=client, trans_status='Completed',
                                      created_at__gte=since).order_by('-created_at')[:12]
    )
    events = []
    for p in pays:
        dt = timezone.localtime(p.payment_date)
        events.append({'dt': dt, 'amount': float(p.amount or 0),
                       'method': p.get_payment_method_display(), 'verified': p.is_verified})
    for w in whs:
        dt = timezone.localtime(w.trans_timestamp or w.created_at)
        events.append({'dt': dt, 'amount': float(w.payment_amount or 0),
                       'method': w.get_gateway_type_display(), 'verified': True})
    return events


def _matched_payment_reply(client, events, claim_day):
    """matched payment থেকে reply → (reply_str, escalate_bool)।"""
    events.sort(key=lambda e: e['dt'], reverse=True)
    # দাবিকৃত দিন থাকলে সেই দিনের কাছেরটি, নাহলে সর্বশেষ
    chosen = next((e for e in events if claim_day and e['dt'].day == claim_day), events[0])
    due = _due(client)
    head = (f"হ্যাঁ, আমরা আপনার {_bn_date(chosen['dt'].date())} তারিখের "
            f"৳{chosen['amount']:.0f} ({chosen['method']}) পেমেন্ট রেকর্ডে পেয়েছি।")
    if not chosen['verified']:
        head += " পেমেন্টটি এখন যাচাইয়ের অপেক্ষায় আছে — যাচাই হলে স্বয়ংক্রিয়ভাবে সমন্বয় হবে।"
    if due > 0:
        tail = (f" তবে আপনার অ্যাকাউন্টে এখনো ৳{due:.0f} বকেয়া দেখাচ্ছে — আংশিক বাকি "
                f"থাকলে অনুগ্রহ করে পরিশোধ করুন, নয়তো transaction ID দিন আমরা মিলিয়ে দেখছি।")
        return _wrap(head + tail), True   # বকেয়া রয়ে গেলে staff যাচাই করুক
    return _wrap(head + " বর্তমানে আপনার কোনো বকেয়া নেই — ধন্যবাদ!"), False


def _unmatched_webhook_reply(client, since):
    """client-এর ফোন নম্বরে unmatched webhook payment খুঁজে → (reply, escalate) বা None।"""
    import re
    from django.utils import timezone
    from billing.models import WebhookPayment

    phone = re.sub(r'\D', '', client.phone or '')[-10:]
    if not phone:
        return None
    unmatched = WebhookPayment.objects.filter(
        matched_client__isnull=True, trans_status='Completed', created_at__gte=since
    ).order_by('-created_at')[:50]
    hit = next((w for w in unmatched
                if phone in re.sub(r'\D', '', w.from_wallet or '')), None)
    if not hit:
        return None
    dt = timezone.localtime(hit.trans_timestamp or hit.created_at)
    return _wrap(
        f"আপনার নম্বর থেকে {_bn_date(dt.date())} তারিখে ৳{float(hit.payment_amount or 0):.0f} "
        f"একটি পেমেন্ট পাওয়া গেছে, তবে সেটি এখনো আপনার অ্যাকাউন্টে যুক্ত হয়নি। আমরা "
        f"বিষয়টি সমন্বয়ের জন্য সাপোর্ট টিমকে জানিয়ে দিচ্ছি — শীঘ্রই যুক্ত হয়ে যাবে।"), True


# ফাইবার/তার শারীরিকভাবে কাটা/ছিঁড়ে যাওয়া — জরুরি (critical), সাথে সাথে ticket।
# দুই-অংশ detection: fiber-শব্দ + cut-শব্দ একসাথে থাকলে (suffix টি/টা/টির উপেক্ষা করে)।
_FIBER_WORDS = ('ফাইবার', 'ক্যাবল', 'কেবল', 'অপটিক', 'cable', 'fiber', 'optic', 'wire')
_CUT_WORDS   = ('কাট', 'কেট', 'ছিঁ', 'ছিড়', 'ছেঁ', 'ছিন্ন', 'cut')
# "তার" (pronoun-ও হয়) — শুধু স্পষ্ট wire-phrase হলে ধরি, false-positive এড়াতে
_WIRE_PHRASES = ('তার কাট', 'তার কেট', 'তার ছিঁ', 'তার ছিড়', 'তার ছেঁ', 'তারটি কাট', 'তারটি কেট',
                 'তারটা কাট', 'তারটা কেট', 'লাইনের তার', 'তার ছিন্ন')


def _is_fiber_cut(message: str) -> bool:
    m = (message or '').lower()
    if any(p in m for p in _WIRE_PHRASES):
        return True
    return any(w in m for w in _FIBER_WORDS) and any(c in m for c in _CUT_WORDS)


def _fiber_cut_answer(message: str):
    """ফাইবার/তার কাটা অভিযোগ হলে safety-সচেতন জরুরি উত্তর। Returns reply অথবা None।
    (ticket সবসময় তৈরি হবে — caller এটি critical priority-তে create করে।)"""
    if not _is_fiber_cut(message):
        return None
    return _wrap(
        "আপনার এলাকায় ফাইবার/তার কেটে যাওয়ার বিষয়টি জানানোর জন্য ধন্যবাদ — এটি আমরা জরুরি "
        "সমস্যা হিসেবে এখনই আমাদের টেকনিক্যাল টিমকে জানিয়ে দিচ্ছি। অনুগ্রহ করে কাটা তার/ফাইবারে "
        "হাত দেবেন না এবং নিরাপদ দূরত্বে থাকুন (আশেপাশে বৈদ্যুতিক তার থাকতে পারে)। আমাদের "
        "টেকনিশিয়ান দ্রুত আপনার ঠিকানায় গিয়ে মেরামত করবেন।")


# লাইন/সংযোগ "বন্ধ/নেই" সংক্রান্ত sustained outage অভিযোগ (intermittent নয়)
_OUTAGE_TOKENS = (
    'লাইন বন্ধ', 'নেট বন্ধ', 'ইন্টারনেট বন্ধ', 'সংযোগ বন্ধ', 'কানেকশন বন্ধ', 'লাইন নেই',
    'নেট নেই', 'ইন্টারনেট নেই', 'সংযোগ নেই', 'কানেকশন নেই', 'লাইন আসে না', 'নেট আসে না',
    'ইন্টারনেট আসে না', 'কাজ করছে না', 'চলছে না', 'বন্ধ আছে', 'বন্ধ হয়ে আছে', 'বন্ধ রয়েছে',
    'দিন ধরে বন্ধ', 'down', 'no internet', 'not working', 'অফলাইন',
)


def _aware(dt):
    """naive datetime → aware (current tz); aware হলে localtime। None হলে None।"""
    from django.utils import timezone
    if dt is None:
        return None
    if timezone.is_naive(dt):
        try:
            return timezone.make_aware(dt, timezone.get_current_timezone())
        except Exception:
            return dt
    return timezone.localtime(dt)


def _human_duration(dt) -> str:
    """এখন থেকে dt কত আগে — "প্রায় ২ দিন", "প্রায় ৫ ঘণ্টা" ইত্যাদি।"""
    from django.utils import timezone
    a = _aware(dt)
    if not a:
        return ''
    secs = max((timezone.now() - a).total_seconds(), 0)
    days, hours, mins = int(secs // 86400), int((secs % 86400) // 3600), int((secs % 3600) // 60)
    if days >= 1:
        return f"প্রায় {days} দিন" + (f" {hours} ঘণ্টা" if hours else "")
    if hours >= 1:
        return f"প্রায় {hours} ঘণ্টা"
    return f"প্রায় {max(mins, 1)} মিনিট"


def _outage_diagnosis(message: str, client):
    """গ্রাহক "লাইন বন্ধ/নেই" বললে log (status/expiry/বকেয়া + activity log + radacct
    last-online) দেখে সঠিক, কারণ-সহ উত্তর। Returns (reply, escalate) অথবা None।"""
    if not client:
        return None
    m = (message or '').lower()
    if not any(k in m for k in _OUTAGE_TOKENS):
        return None
    # "বারবার যায়" intermittent হলে normal connection flow-ই ভালো handle করে
    if any(k in m for k in _INTERMITTENT_TOKENS):
        return None
    try:
        due = _due(client)
        status = getattr(client, 'status', '')
        days_left = _days_left(client)
        # লাইন আসলে কাটা = status cut অথবা মেয়াদ পার। (শুধু due > 0 = কাটা নয় — grace-এ active থাকে)
        billing_cut = (status in ('expired', 'suspended', 'inactive')
                       or (days_left is not None and days_left < 0))

        # ── (১) বকেয়া/মেয়াদজনিত বন্ধ ──────
        if billing_cut:
            return _outage_billing_cut_reply(client, due)

        # ── (২) বিল/মেয়াদ ঠিক — live online কিনা দেখি ────────────────────
        if _is_online(client):
            return _wrap(
                "ভালো খবর — আমাদের সিস্টেমে আপনার সংযোগ এই মুহূর্তে Online দেখাচ্ছে। মাঝে মাঝে "
                "বিচ্ছিন্ন হলে router/ONU টি ১০ সেকেন্ড বন্ধ রেখে চালু করুন এবং fiber/তার ঠিকমতো "
                "লাগানো আছে কিনা দেখুন। তবুও সমস্যা থাকলে জানান।"), False

        # ── (৩) offline — radacct last-online থেকে কতক্ষণ বন্ধ ──────────
        return _outage_offline_reply(client, due)
    except Exception as e:
        logger.warning("outage_diagnosis failed: %s", e)
        return None


def _outage_billing_cut_reply(client, due):
    """বকেয়া/মেয়াদজনিত বন্ধ — activity log থেকে কখন বন্ধ হলো + reply → (reply, False)।"""
    when = None
    try:
        from clients.models import ClientActivityLog
        log = (ClientActivityLog.objects
               .filter(client=client, event_type__in=['client_disabled', 'status_changed'])
               .order_by('-created_at').first())
        when = log.created_at if log else None
    except Exception:
        when = None
    whentxt = ''
    if when:
        a = _aware(when)
        whentxt = f"{_bn_date(a.date())} ({_human_duration(when)} আগে) থেকে "
    reason = "বকেয়া বিল" if due > 0 else "মেয়াদ শেষ হওয়ায়"
    body = f"আমাদের সিস্টেম অনুযায়ী আপনার সংযোগটি {whentxt}{reason}-জনিত কারণে বন্ধ রয়েছে।"
    if due > 0:
        body += (f" ৳{due:.0f} পরিশোধ করলেই সংযোগ স্বয়ংক্রিয়ভাবে সচল হবে — অ্যাপে bKash "
                 f"দিয়ে সহজেই পরিশোধ করতে পারেন।")
    else:
        body += " অনুগ্রহ করে বিল পরিশোধ/নবায়ন করলে সংযোগ সচল হবে।"
    return _wrap(body), False


def _outage_offline_reply(client, due):
    """offline — radacct last-online থেকে কতক্ষণ বন্ধ + reply → (reply, True)।"""
    last_seen = None
    try:
        from radius_app.services.radius_service import RadiusService
        svc = RadiusService.for_client(client)
        sess = svc.get_last_session(client.username) if svc else None
        if sess:
            last_seen = sess.get('stop') or sess.get('update') or sess.get('start')
    except Exception:
        last_seen = None

    due_note = (f" (এছাড়া ৳{due:.0f} বকেয়া রয়েছে — সুবিধামতো পরিশোধ করে নিলে ভালো হয়।)"
                if due > 0 else "")
    if last_seen:
        a = _aware(last_seen)
        seen_txt = f"{_bn_date(a.date())} {a.strftime('%H:%M')} ({_human_duration(last_seen)} আগে)"
        body = (f"আপনার মেয়াদ ঠিক আছে, তবে সিস্টেমে আপনার সংযোগ শেষবার {seen_txt} online "
                f"ছিল — এরপর আর সংযোগ পাওয়া যায়নি। সম্ভবত ONU/router, বিদ্যুৎ বা fiber/তারের "
                f"সমস্যা। অনুগ্রহ করে ONU/router-এর power ও fiber cable চেক করে একবার restart দিন। "
                f"আমরা বিষয়টি টেকনিক্যাল টিমকে জানিয়ে দিচ্ছি — দ্রুত টেকনিশিয়ান পাঠানো হবে।{due_note}")
        return _wrap(body), True

    body = ("আপনার বিল/মেয়াদ ঠিক থাকলেও সংযোগের কোনো সাম্প্রতিক active session পাওয়া যাচ্ছে না — "
            "সম্ভবত ONU/router বা fiber/বিদ্যুৎ-জনিত সমস্যা। power ও fiber cable চেক করে restart "
            "দিন। আমরা টেকনিক্যাল টিমকে জানিয়ে দিচ্ছি, দ্রুত ব্যবস্থা নেওয়া হবে।")
    return _wrap(body), True


# প্যাকেজ পরিবর্তন/আপগ্রেড — context-সচেতন কথোপকথন (admin প্যাকেজ তালিকা খুঁজে)
_PKG_CHANGE_TOKENS = (
    'আপগ্রেড', 'upgrade', 'প্যাকেজ পরিবর্ত', 'প্যাকেজ বদল', 'প্যাকেজ চেঞ্জ', 'প্যাকেজ change',
    'প্যাকেজ বাড়া', 'স্পিড বাড়া', 'নতুন প্যাকেজ', 'প্যাকেজ নিতে চাই', 'প্যাকেজ পাল্টা',
    'প্যাকেজ আপগ্রেড', 'প্ল্যান পরিবর্ত', 'প্ল্যান বদল',
)


def _recent_package_context(history) -> bool:
    """সাম্প্রতিক কথোপকথনে প্যাকেজ সংক্রান্ত আলোচনা ছিল কিনা — "10 Mbps"-কে উত্তর হিসেবে বুঝতে।"""
    for h in (history or [])[-4:]:
        t = (h.get('text') or '').lower()
        if any(k in t for k in ('প্যাকেজ', 'package', 'আপগ্রেড', 'upgrade', 'mbps', 'স্পিড', 'প্ল্যান')):
            return True
    return False


def _pkg_by_name(pkgs, m):
    """package name/speed_name সরাসরি বার্তায় থাকলে সেই package; নাহলে None।"""
    for p in pkgs:
        for label in (p.speed_name or '', p.name or ''):
            lab = label.lower().strip()
            if lab and lab in m:
                return p
    return None


def _pkg_by_speed(pkgs, m):
    """বার্তায় 'NN Mbps' সংখ্যা থাকলে সেই speed-এর package; নাহলে None।"""
    import re
    mt = re.search(r'(\d{1,4})\s*(?:mbps|mb|এমবি|মেগা|m\b)', m)
    if not mt:
        return None
    num = mt.group(1)
    for p in pkgs:
        blob = _to_en_digits(f"{p.speed_name or ''} {p.name or ''}".lower())
        nums = re.findall(r'\d+', blob)
        if num in nums:
            return p
    return None


def _find_package(message: str):
    """বার্তা থেকে কাঙ্ক্ষিত Package খুঁজে বের করে (নাম/speed/Mbps সংখ্যা মিলিয়ে); নাহলে None।"""
    try:
        from configuration.models import Package
        m = _to_en_digits((message or '').lower())
        pkgs = list(Package.objects.filter(is_active=True))
        # ১. নাম/speed_name সরাসরি বার্তায়   ২. সংখ্যা + Mbps
        return _pkg_by_name(pkgs, m) or _pkg_by_speed(pkgs, m)
    except Exception as e:
        logger.warning("_find_package failed: %s", e)
    return None


def _package_change_answer(message: str, client, history=None):
    """প্যাকেজ পরিবর্তন প্রসঙ্গ হলে — তালিকা দেখায় বা নির্বাচিত প্যাকেজ confirm করে ticket তৈরি।
    Returns (reply, ticket) অথবা None। (context: আগের turn-এ প্যাকেজ প্রশ্ন থাকলেও কাজ করে)"""
    if not client:
        return None
    m = (message or '').lower()
    change_req = any(k in m for k in _PKG_CHANGE_TOKENS)
    if not change_req and not _recent_package_context(history):
        return None

    picked = _find_package(message)
    if picked:
        return _package_picked_reply(client, message, picked)
    if change_req:
        return _package_list_reply(client)
    return None


def _package_picked_reply(client, message, picked):
    """গ্রাহক নির্দিষ্ট প্যাকেজ বেছে নিলে confirm + ticket → (reply, ticket_or_None)।"""
    price = float(picked.price or 0)
    cur = client.package.name if (client.package_id and client.package) else ''
    speed = f" ({picked.speed_name})" if picked.speed_name and picked.speed_name not in picked.name else ''
    if cur and cur.lower() == picked.name.lower():
        return _wrap(f"আপনি তো বর্তমানে {picked.name}{speed} প্যাকেজেই আছেন (মাসিক ৳{price:.0f})। "
                     f"অন্য কোনো প্যাকেজে যেতে চাইলে সেটির নাম/স্পিড জানান।"), None
    body = (f"আপনি {picked.name}{speed} প্যাকেজটি বেছেছেন — মাসিক বিল ৳{price:.0f}। আপনার "
            f"আপগ্রেড/পরিবর্তন অনুরোধটি আমরা গ্রহণ করেছি এবং প্রসেস করছি — আমাদের প্রতিনিধি "
            f"শীঘ্রই যোগাযোগ করে পরিবর্তনটি সম্পন্ন করবেন।")
    ticket = auto_create_ticket(
        message, client, subject=f"প্যাকেজ পরিবর্তন → {picked.name}",
        category_name='প্যাকেজ পরিবর্তন')
    return _wrap(body), ticket


def _package_list_reply(client):
    """admin প্যাকেজ তালিকা খুঁজে গ্রাহককে বিকল্প দেখাই (data-grounded) → (reply, None)।"""
    try:
        from configuration.models import Package
        pkgs = list(Package.objects.filter(is_active=True).order_by('price'))
    except Exception:
        pkgs = []
    if pkgs:
        cur = client.package.name if (client.package_id and client.package) else ''
        curtxt = f"আপনার বর্তমান প্যাকেজ: {cur}।\n\n" if cur else ""
        lines = "\n".join(
            f"• {p.name}{(' — ' + p.speed_name) if p.speed_name and p.speed_name not in p.name else ''}"
            f" — ৳{float(p.price or 0):.0f}/মাস" for p in pkgs[:12])
        return _wrap(f"{curtxt}আমাদের বর্তমান প্যাকেজসমূহ:\n{lines}\n\nকোন প্যাকেজে যেতে চান "
                     f"লিখে জানান (যেমন: 10 Mbps) — আমি অনুরোধটি প্রসেস করে দেব।"), None
    return _wrap("প্যাকেজ পরিবর্তন/আপগ্রেড করতে চাইলে কোন প্যাকেজ নিতে চান জানান — আমাদের "
                 "প্রতিনিধি শীঘ্রই প্রয়োজনীয় ব্যবস্থা নেবেন।"), None


def _ticket_response(intent, reply, ticket, suggest_ticket=False):
    """ticket-সহ standard response dict (ticket None হলে id/pk None)।"""
    return {
        'intent': intent,
        'reply': reply,
        'ticket_id': (ticket.ticket_id if ticket else None),
        'ticket_pk': (ticket.id if ticket else None),
        'suggest_ticket': suggest_ticket,
    }


def _handle_fiber_cut(message, client):
    """ফাইবার/তার কাটা — জরুরি safety উত্তর + critical ticket। match না হলে None।"""
    fiber = _fiber_cut_answer(message)
    if not fiber:
        return None
    ticket = auto_create_ticket(
        message, client, priority='critical',
        subject=f"🚨 ফাইবার কাটা — {(client.full_name or client.customer_id) if client else ''}".strip(),
        category_name='সংযোগ বিচ্ছিন্ন',
    )
    reply = fiber
    if ticket:
        reply += (f"\n\n📌 জরুরি টিকেট তৈরি হয়েছে — নম্বর: {ticket.ticket_id} (অগ্রাধিকার: "
                  f"জরুরি)। আমাদের টিম দ্রুত ব্যবস্থা নিচ্ছে।")
    return _ticket_response('connection_down', reply, ticket)


def _handle_payment_claim(message, client):
    """"বিল পরিশোধ করেছি" দাবি — Payment/Webhook রেকর্ড খুঁজে উত্তর; escalate হলে ticket। None হতে পারে।"""
    claim = _payment_claim_answer(message, client)
    if not claim:
        return None
    reply, escalate = claim
    ticket = auto_create_ticket(message, client) if escalate else None
    if ticket:
        reply += (f"\n\n📌 বিষয়টি সমন্বয়ের জন্য সাপোর্ট টিমে পাঠানো হয়েছে — "
                  f"টিকেট নম্বর: {ticket.ticket_id}।")
    return _ticket_response('billing_due', reply, ticket)


def _handle_outage(message, client):
    """"লাইন বন্ধ/নেই" outage — কারণ-সহ উত্তর; technical down হলে ticket escalate। None হতে পারে।"""
    outage = _outage_diagnosis(message, client)
    if not outage:
        return None
    reply, escalate = outage
    ticket = auto_create_ticket(message, client) if escalate else None
    if ticket:
        reply += (f"\n\n📌 আপনার বিষয়টি টেকনিক্যাল টিমে পাঠানো হয়েছে — "
                  f"টিকেট নম্বর: {ticket.ticket_id}। আমাদের প্রতিনিধি শীঘ্রই যোগাযোগ করবেন।")
    return _ticket_response('connection_down', reply, ticket)


def _handle_package_change(message, client, history):
    """প্যাকেজ পরিবর্তন/আপগ্রেড — context-সচেতন উত্তর + ticket। None হতে পারে।"""
    pkg = _package_change_answer(message, client, history)
    if not pkg:
        return None
    reply, ticket = pkg
    if ticket:
        reply += (f"\n\n📌 অনুরোধটি সাপোর্ট টিমে পাঠানো হয়েছে — টিকেট নম্বর: {ticket.ticket_id}।")
    return _ticket_response('package_change', reply, ticket)


def answer_client_query(message: str, client, history=None) -> dict:
    """গ্রাহকের বার্তা → বুদ্ধিমান, কথোপকথনমূলক উত্তর। অগ্রাধিকারক্রম:

    1) greeting/ধন্যবাদ → friendly উত্তর (LLM/ticket নয়)।
    2) নির্দিষ্ট তথ্য-প্রশ্ন (মেয়াদ/বকেয়া/প্যাকেজ/status) → আসল data দিয়ে instant precise উত্তর।
    3) অন্য সব → LLM কথোপকথন (history + fact-sheet-এ grounded) — সহানুভূতিশীল, natural,
       গ্রাহকের আসল সমস্যা বুঝে। LLM অনুপলব্ধ হলে intent-template fallback।
    4) প্রকৃত সমস্যা (connection[non-billing]/speed/package/new/general) → পাশাপাশি নিজে
       ticket তৈরি করে staff-কে পাঠায়; reply-তে ticket নম্বর যুক্ত হয়।

    🔒 শুধু non-sensitive data (status/বকেয়া/online/package/expiry) ব্যবহৃত।
    Returns: {intent, reply, suggest_ticket, ticket_id?, ticket_pk?}।
    """
    # ১. greeting/ধন্যবাদ — সংক্ষিপ্ত friendly, কোনো LLM/ticket নয়
    small = _smalltalk_reply(message)
    if small:
        return {'intent': 'general', 'reply': small, 'suggest_ticket': False}

    # ২-৪. ক্রমানুসারে specialized handler — ফাইবার কাটা → payment claim → outage।
    # (claim _specific_answer-এর due-branch-এর আগে; সব handler match না হলে None দেয়)
    for handler in (_handle_fiber_cut, _handle_payment_claim, _handle_outage):
        resp = handler(message, client)
        if resp is not None:
            return resp

    # প্যাকেজ পরিবর্তন — context-সচেতন (history লাগে বলে আলাদা)
    resp = _handle_package_change(message, client, history)
    if resp is not None:
        return resp

    # ৫. নির্দিষ্ট তথ্য — instant, নির্ভুল (মেয়াদ/বকেয়া/প্যাকেজ/status)
    direct = _specific_answer(message, client)
    if direct:
        return {'intent': 'account_info', 'reply': direct, 'suggest_ticket': False}

    # intent — ticket routing-এর জন্য (সস্তা ৮-token classify)
    intent = classify_text(message)

    # মূল উত্তর — LLM কথোপকথন (history সহ); ব্যর্থ হলে message-aware varied template
    reply = _llm_converse(message, client, history) or render_reply(intent, client, message)

    # প্রকৃত সমস্যা হলে নিজে ticket escalate (billing-জনিত হলে নয়)।
    # তবে সংযোগ "বারবার যায়/ডিস্টার্ব" হলে বকেয়া থাকলেও escalate — এটা লাইন সমস্যা।
    intermittent_conn = (intent == 'connection_down'
                         and any(k in message.lower() for k in _INTERMITTENT_TOKENS))
    escalate = _needs_ticket(intent, client) or (intent == 'general') or intermittent_conn
    ticket = auto_create_ticket(message, client) if escalate else None
    if ticket:
        reply += (f"\n\n📌 আপনার বিষয়টি আমাদের সাপোর্ট টিমে পাঠানো হয়েছে — "
                  f"টিকেট নম্বর: {ticket.ticket_id}। আমাদের প্রতিনিধি শীঘ্রই যোগাযোগ করবেন।")

    return _ticket_response(intent, reply, ticket)
