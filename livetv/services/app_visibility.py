# App-এ কোন চ্যানেলগুলো দেখানো হবে তার একক উৎস (single source of truth)।
#
# আগে দুই জায়গায় দুই রকম হিসাব ছিল → admin panel-এর "অ্যাপে দেখাচ্ছে" সংখ্যা আর
# app-এর আসল channel সংখ্যা মিলত না:
#   - mobile_api.AppLiveTVChannelsView (আসল list): Redis ping cache + last_content_ok
#     বাদ + not-yet-pinged দেখায় + name dedup।
#   - livetv stats endpoint (badge): শুধু DB last_ping_* field, dedup/content_ok বাদ।
# এখন দুটোই এই একই ফাংশন ব্যবহার করে, তাই সংখ্যা সবসময় মিলবে।

from django.core.cache import cache

# এর বেশি ping (ms) হলে app-এ দেখাবে না
PING_THRESHOLD_MS = 200


def _multi_ping_status(multi):
    """ping_all_ch_* (multi-URL) cache entry → (ms, known)।"""
    if isinstance(multi, dict) and multi.get('pending'):
        return None, False  # pending
    reachable_ms = [
        r['latency_ms'] for r in (multi if isinstance(multi, list) else [])
        if r.get('reachable') and r.get('latency_ms') is not None
    ]
    if reachable_ms:
        return min(reachable_ms), True   # reachable, best ms
    if isinstance(multi, list) and multi:
        return None, True   # ping হয়েছে কিন্তু সব URL offline
    return None, False


def _single_ping_status(single):
    """ping_ch_* (single-URL) cache entry → (ms, known)।"""
    if single.get('pending'):
        return None, False   # background ping চলছে → unknown
    ms = single.get('latency_ms')    # None = timeout/error
    ok = single.get('reachable', False)
    return (ms if ok else None), True


def _ping_status(ch_id, all_ping):
    """Redis ping cache থেকে (ms, known) বের করে।
      ms=int,  known=True  → ping হয়েছে, reachable, ms latency
      ms=None, known=True  → ping হয়েছে, unreachable (offline)
      ms=None, known=False → এখনো ping হয়নি (নতুন channel) → দেখাবে
    """
    multi = all_ping.get(f'ping_all_ch_{ch_id}')
    if multi:
        return _multi_ping_status(multi)
    single = all_ping.get(f'ping_ch_{ch_id}')
    if single:
        return _single_ping_status(single)
    return None, False  # cache নেই → এখনো ping হয়নি


def _channel_visibility(ch, all_ping):
    """একটি channel app-এ দেখাবে কিনা → (show, ms_or_None)। show=False হলে বাদ।
    (আগের Step-1 filter loop-এর হুবহু আচরণ)।"""
    if ch.input_type == 'url' and ch.source_url:
        if ch.last_content_ok is False:
            return False, None  # content check fail → video নেই
        ms, known = _ping_status(ch.id, all_ping)
        if known:
            if ms is None:
                return False, None  # offline/unreachable
            if ms > PING_THRESHOLD_MS:
                return False, None  # >200ms
        # known=False → নতুন channel, এখনো ping হয়নি → দেখাবে
        return True, ms
    if ch.status == 'live':
        return True, None  # hardware channel live
    return False, None  # hardware stopped/error → দেখাবে না


def get_visible_channels():
    """App-এ প্রদর্শিত চূড়ান্ত channel তালিকা (filter + name dedup)।

    Returns: list of (TVChannel, ms_or_None) — sort_order/name অনুযায়ী sorted।
    URL build করে না — caller (app view) নিজে URL বসায়; stats endpoint শুধু len() নেয়।
    """
    from livetv.models import TVChannel

    channels = list(TVChannel.objects.filter(is_active=True).order_by('sort_order', 'name').only(
        'id', 'name', 'slug', 'category', 'logo_url', 'description',
        'input_type', 'status', 'is_active', 'sort_order',
        'source_url', 'extra_urls', 'last_content_ok',
    ))

    url_ch_ids = [ch.id for ch in channels if ch.input_type == 'url']
    ping_keys = (
        [f'ping_ch_{cid}' for cid in url_ch_ids] +
        [f'ping_all_ch_{cid}' for cid in url_ch_ids]
    )
    all_ping = cache.get_many(ping_keys)

    # ── Step 1: filter ──────────────────────────────────────────────
    raw = []  # [(channel, ms_or_None)]
    for ch in channels:
        show, ms = _channel_visibility(ch, all_ping)
        if show:
            raw.append((ch, ms))

    # ── Step 2: name dedup — একই নামে একাধিক থাকলে সবচেয়ে ভালো টা রাখো ──
    # Rank (বড় = ভালো): (১) error-status নয় এমন চ্যানেল আগে — কারণ error মানে relay
    # ffmpeg ওই source টানতে পারেনি (app mirror দিয়ে চলবে না), যদিও ping কম হতে পারে;
    # (২) ping জানা থাকলে আগে; (৩) কম ping আগে। এতে একই নামে একটা error+low-ping আর
    # একটা working source থাকলে app working টাই দেখায় (যেমন BTV — id=5 error বাদ দিয়ে
    # working BTV source বেছে নেয়)।
    def _rank(ch, ms):
        return (
            0 if ch.status == 'error' else 1,   # non-error > error
            1 if ms is not None else 0,          # pinged > এখনো ping হয়নি
            -(ms if ms is not None else 0),      # কম ms > বেশি ms
        )

    name_best = {}  # name_lower → (channel, ms)
    for ch, ms in raw:
        key = (ch.name or '').lower().strip()
        if key not in name_best or _rank(ch, ms) > _rank(*name_best[key]):
            name_best[key] = (ch, ms)

    return sorted(
        name_best.values(),
        key=lambda x: (x[0].sort_order, (x[0].name or '').lower()),
    )
