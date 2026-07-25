# URL/IPTV চ্যানেল shared relay — idle হয়ে গেলে বন্ধ করার periodic task।
# কেন দরকার: mobile_api.AppLiveTVStreamProxyView প্রথম viewer এলে lazy-start করে
# FFmpeg relay চালায় (bandwidth/CPU বাঁচাতে সব চ্যানেল সবসময় চালু রাখা হয় না)।
# viewer চলে গেলে idle অবস্থায় সেই process running থেকে যাবে না — এই task প্রতি
# কয়েক মিনিটে চেক করে কোনো viewer না থাকা url-type চ্যানেলের FFmpeg বন্ধ করে দেয়।
from celery import shared_task
import logging

logger = logging.getLogger(__name__)

IDLE_CHECK_STATUSES = ('starting', 'live')


@shared_task(name='livetv.sweep_idle_url_relays')
def sweep_idle_url_relays():
    from django.core.cache import cache
    from .models import TVChannel
    from .services.stream_service import StreamService

    stopped = []
    channels = TVChannel.objects.filter(
        input_type='url', status__in=IDLE_CHECK_STATUSES,
    ).exclude(ffmpeg_pid__isnull=True)

    for ch in channels:
        # mobile_api.AppLiveTVStreamProxyView প্রতি request-এ এই key refresh করে
        # (VIEWER_PING_TTL=180s) — key expire মানে গত ৩ মিনিটে কেউ দেখেনি।
        if cache.get(f'livetv_viewer_ping_{ch.id}') is None:
            StreamService.stop_stream(ch)
            stopped.append(ch.id)
            logger.info("Idle URL relay বন্ধ করা হয়েছে: '%s' (id=%s)", ch.name, ch.id)

    return {'stopped_channel_ids': stopped, 'checked': channels.count()}


# lazy-start relay celery-worker-এ দিয়ে চালানোর task — কেন দরকার: আগে
# mobile_api.AppLiveTVStreamProxyView django-app-এর নিজের request-handling process-এর
# ভেতরেই background thread দিয়ে StreamService.start_stream() (এবং তার ffmpeg
# subprocess) চালাত। এতে LiveTV viewer বাড়লে django-app-এর নিজস্ব memory
# budget-এই (admin panel/billing serve করার budget) ffmpeg process জমে গিয়ে
# django-app OOM crash-loop করত (২০২৬-০৭-০৯ ইনসিডেন্ট, কয়েক ঘণ্টায় ৩ বার)।
# এখন django-app শুধু এই task dispatch করে (near-instant), আসল ffmpeg spawn
# celery-worker-এর আলাদা cgroup/memory budget-এ হয় — django-app-এর web-serving
# ক্ষমতা LiveTV লোড থেকে সম্পূর্ণ আলাদা থাকে।
@shared_task(name='livetv.start_channel_relay')
def start_channel_relay(channel_id):
    from .models import TVChannel
    from .services.stream_service import StreamService

    ch = TVChannel.objects.filter(pk=channel_id).first()
    if ch and ch.status != 'live':
        ok, msg = StreamService.start_stream(ch)
        logger.info("Lazy-start relay (celery): '%s' (id=%s) → %s", ch.name, ch.id, ok)
        return {'id': ch.id, 'ok': ok, 'msg': str(msg)[:120]}
    return {'id': channel_id, 'ok': False, 'msg': 'channel not found বা ইতিমধ্যে live'}


# error status-এ আটকে থাকা url চ্যানেল স্বয়ংক্রিয়ভাবে retry — কেন দরকার:
# অনেক upstream IPTV feed মাঝে মাঝে flaky (segment সাময়িকভাবে expire/404, TCP
# glitch) — একবার fail হলে চ্যানেল চিরকাল "error" status-এ আটকে থাকত যতক্ষণ না
# admin ম্যানুয়ালি Start ক্লিক করে। এখন active viewer থাকলে (viewer ping cache
# আছে) প্রতি রাউন্ডে একবার retry করা হয় — উপরে থাকা relay lazy-start করবে যখনই
# পরের viewer request আসবে।
@shared_task(name='livetv.retry_error_url_channels')
def retry_error_url_channels():
    from django.core.cache import cache
    from .models import TVChannel
    from .services.stream_service import StreamService

    retried = []
    channels = TVChannel.objects.filter(
        input_type='url', status='error', is_active=True, direct_relay=False,
    ).exclude(source_url='')

    for ch in channels:
        # শুধু সাম্প্রতিক viewer আগ্রহ থাকা চ্যানেল retry করো — dead/delisted
        # feed-এর জন্য অযথা বারবার upstream hit করা এড়াতে।
        # cache.add lock: mobile_api-এর lazy-start ও admin-এর ম্যানুয়াল Start
        # একই সময়ে চললে দুটো ffmpeg process একই চ্যানেলে spawn হয়ে যেত —
        # duplicate process জমে RAM ফুরিয়ে যাওয়ার একটা কারণ ছিল এটা।
        lock_key = f'livetv_relay_starting_{ch.id}'
        if cache.get(f'livetv_viewer_ping_{ch.id}') is not None and cache.add(lock_key, True, timeout=20):
            try:
                ok, _ = StreamService.start_stream(ch)
                retried.append({'id': ch.id, 'name': ch.name, 'ok': ok})
                logger.info("Error চ্যানেল retry: '%s' (id=%s) → %s", ch.name, ch.id, ok)
            finally:
                cache.delete(lock_key)

    return {'retried': retried, 'checked': channels.count()}


# ── Auto-prune: dead/AV-হীন/ধীর চ্যানেল app-list থেকে স্বয়ংক্রিয় বাদ ─────────────
# কেন দরকার: bulk-imported IPTV playlist-এ অনেক link-rot হয় (feed মরে যায়, slow হয়ে
# যায়)। আগে admin-কে "Auto Check" বাটন ম্যানুয়ালি চাপতে হতো। এই task periodic-ভাবে
# প্রতিটা active url চ্যানেল ffprobe করে দেখে — video/audio আছে কিনা ও কত দ্রুত লোড হয়।
# ব্যর্থ (unreachable / video+audio দুটোই নেই / খুব ধীর) হলে last_content_ok=False
# সেট করে — get_visible_channels স্বয়ংক্রিয়ভাবে সেগুলো app থেকে লুকিয়ে দেয়।

# ffprobe stream-info পেতে সর্বোচ্চ কত সময় দেবে — এই সময়ের মধ্যে সাড়া না দিলে
# "high loading time" ধরে বাদ দেওয়া হয় (timeout = reachable=False)। কাজ করা কিন্তু
# ধীর CMAF/fmp4 source (যেমন Madani ~১৭s) যাতে ভুলে বাদ না পড়ে তাই generous ২৫s।
_PROBE_TIMEOUT = 25
_UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
       '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')


def _probe_channel_health(url):
    """ffprobe দিয়ে source-এ video/audio stream আছে কিনা ও কত সময় লাগে মাপে।
    Returns (reachable: bool, has_video: bool, has_audio: bool, load_ms: int|None)।
    """
    import subprocess
    import time as _t
    t0 = _t.monotonic()
    try:
        r = subprocess.run(
            [
                'ffprobe', '-v', 'error',
                '-user_agent', _UA,
                '-extension_picky', '0',
                '-allowed_extensions', 'ALL',
                '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
                '-show_entries', 'stream=codec_type',
                '-of', 'csv=p=0',
                url,
            ],
            capture_output=True, text=True, timeout=_PROBE_TIMEOUT,
        )
    except (subprocess.TimeoutExpired, OSError):
        return False, False, False, None
    load_ms = int((_t.monotonic() - t0) * 1000)
    if r.returncode != 0:
        return False, False, False, load_ms
    types = [ln.strip().lower() for ln in r.stdout.splitlines() if ln.strip()]
    return True, any('video' in t for t in types), any('audio' in t for t in types), load_ms


@shared_task(name='livetv.auto_prune_channels')
def auto_prune_channels():
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from django.core.cache import cache
    from django.db import close_old_connections
    from django.utils import timezone
    from .models import TVChannel

    close_old_connections()
    channels = list(
        TVChannel.objects.filter(input_type='url', is_active=True)
        .exclude(source_url='')
        .values('id', 'source_url')
    )
    healthy_count = hidden_count = 0

    def _check(entry):
        # probe fail/timeout transient হতে পারে (server load-এ working source-ও মাঝে
        # মাঝে ২৫s ছাড়ায়) — একবার retry করি যাতে ভালো চ্যানেল ভুলে hide না হয়।
        reachable, hv, ha, load_ms = _probe_channel_health(entry['source_url'])
        if not (reachable and hv):
            reachable, hv, ha, load_ms = _probe_channel_health(entry['source_url'])
        return entry['id'], reachable, hv, ha, load_ms

    try:
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = {pool.submit(_check, c): c for c in channels}
            for fut in as_completed(futures):
                cid, reachable, hv, _ha, _load_ms = fut.result()
                # শুধু **নির্ভরযোগ্য** ফলাফলে content_ok পরিবর্তন করি:
                #   reachable + video    → True  (দেখাও)
                #   reachable + no-video → False (radio/slate — Live TV-তে hide)
                #   unreachable/timeout  → স্পর্শ করি না — server load-এ working source-ও
                #     মাঝে মাঝে timeout করে; ভুলে hide করলে ভালো চ্যানেল হারিয়ে যায়।
                #     সত্যিকার dead হলে app-এর ping-filter এমনিতেই hide করে।
                if not reachable:
                    continue
                healthy = bool(hv)
                if healthy:
                    healthy_count += 1
                else:
                    hidden_count += 1
                try:
                    TVChannel.objects.filter(pk=cid).update(
                        last_content_ok=healthy,
                        last_content_checked_at=timezone.now(),
                    )
                except Exception:  # noqa: BLE001 — একটা fail বাকিগুলো থামাবে না
                    pass
    finally:
        cache.delete('mobile_livetv_channels')  # নতুন ফলাফল অনুযায়ী list রিফ্রেশ
        close_old_connections()

    logger.info("Auto-prune: %d সুস্থ, %d বাদ (মোট %d url চ্যানেল)",
                healthy_count, hidden_count, len(channels))
    return {'healthy': healthy_count, 'hidden': hidden_count, 'total': len(channels)}


# ── Keep-warm pool: top-N (বা সব) visible চ্যানেল সবসময় চালু রেখে ০ cold-start ──
# কেন: idle-sweep বন্ধ চ্যানেল খুললে relay cold-start-এ ~২s loading লাগে। bandwidth
# থাকলে (প্রতি relay ~2.5 Mbps) top-N চ্যানেল সবসময় warm রাখলে সেগুলো instant খোলে।
# LIVETV_KEEP_WARM_COUNT দিয়ে নিয়ন্ত্রিত (0=বন্ধ, N=top N, -1=সব) — bandwidth upgrade
# হলে শুধু সংখ্যা বাড়িয়ে celery restart করলেই হবে।
KEEP_WARM_PING_TTL = 300  # keep-warm ping কতক্ষণ টেকে (sweep interval 120s-এর বেশি রাখা)


def _warm_channel(ch):
    """একটি url channel keep-warm করে → 'refreshed' | 'started' | 'skipped'।
    (আগের keep_warm loop body-র হুবহু আচরণ)।"""
    import os
    import time as _t
    from django.core.cache import cache
    from .services.stream_service import StreamService

    if ch.direct_relay:
        # সরাসরি সোর্স মোডে কোনো local ffmpeg mirror নেই warm করার মতো —
        # প্রতি request-এ live upstream থেকেই proxy হয়, তাই সবসময় "ready"।
        return 'skipped'

    # sweep যাতে না মারে — ping refresh (interval-এর চেয়ে বড় TTL)
    cache.set(f'livetv_viewer_ping_{ch.id}', True, timeout=KEEP_WARM_PING_TTL)
    pl = ch.hls_playlist_path
    try:
        if os.path.isfile(pl) and (_t.time() - os.path.getmtime(pl)) < 30:
            return 'refreshed'  # ইতিমধ্যে warm
    except OSError:
        pass
    # বন্ধ → lazy-start (duplicate guard সহ)
    if ch.status != 'starting' and cache.add(
        f'livetv_relay_starting_{ch.id}', True, timeout=20
    ):
        try:
            StreamService.start_stream(ch)
            return 'started'
        except Exception:  # noqa: BLE001 — একটার fail বাকিগুলো থামাবে না
            pass
    return 'skipped'


@shared_task(name='livetv.keep_warm_channels')
def keep_warm_channels():
    from django.conf import settings
    from django.db import close_old_connections
    from .services.app_visibility import get_visible_channels

    count = int(getattr(settings, 'LIVETV_KEEP_WARM_COUNT', 0) or 0)
    if count == 0:
        return {'kept_warm': 0, 'disabled': True}

    close_old_connections()
    started = refreshed = 0
    targets = []
    try:
        visible = [c for c, _ in get_visible_channels()]
        targets = visible if count < 0 else visible[:count]
        for ch in targets:
            if ch.input_type != 'url':
                continue  # hardware চ্যানেল self-managed
            result = _warm_channel(ch)
            if result == 'refreshed':
                refreshed += 1
            elif result == 'started':
                started += 1
    finally:
        close_old_connections()

    logger.info("Keep-warm: %d target, %d নতুন start, %d already warm (count=%d)",
                len(targets), started, refreshed, count)
    return {'targets': len(targets), 'started': started, 'already_warm': refreshed, 'count': count}


# ── Stale HLS cache sweep — ডিস্ক স্পেস স্বয়ংক্রিয়ভাবে পরিষ্কার ────────────────────
# কেন দরকার: url/IPTV চ্যানেল বন্ধ (viewer চলে যাওয়া, upstream flaky, admin manual stop)
# হলেও তার আগের .ts segment ও index.m3u8 file ডিস্কে থেকে যায় — সময়ের সাথে অনেক চ্যানেল
# জমলে অপ্রয়োজনীয় ডিস্ক স্পেস খরচ হয়। এই task প্রতি ৩০ মিনিটে media/hls/-এর সব চ্যানেল
# directory scan করে।
#
# Active viewer কখনো প্রভাবিত হয় না কেন: এখানে কোনো DB status চেক করা হয় না — শুধু
# ফাইলের mtime (শেষ কবে পরিবর্তন হয়েছে) দেখা হয়। যে চ্যানেল সত্যিই live, তার ffmpeg
# প্রতি কয়েক সেকেন্ডে (hls_segment_time) নতুন segment লেখে ও playlist rewrite করে —
# ফলে সেই ফাইলগুলোর mtime সবসময় সাম্প্রতিক থাকে এবং STALE_HLS_AGE_SECONDS-এর
# threshold কখনো পার হয় না। শুধু genuinely বন্ধ/orphan হয়ে যাওয়া চ্যানেলের পুরনো
# leftover file-ই মুছে যায় — DB status lag/race থাকলেও (যেমন আগে r-plus-gould-এ
# দেখা গিয়েছিল) এই approach ভুল করে live channel-এর ফাইল মোছে না। Channel directory
# নিজে কখনো delete হয় না, শুধু ভেতরের .ts/.m3u8 ফাইল।
STALE_HLS_AGE_SECONDS = 1800  # ৩০ মিনিট


@shared_task(name='livetv.sweep_stale_hls_files')
def sweep_stale_hls_files():
    import os
    import time
    from django.conf import settings

    hls_root = os.path.join(settings.MEDIA_ROOT, 'hls')
    if not os.path.isdir(hls_root):
        return {'removed': 0, 'scanned': 0}

    cutoff = time.time() - STALE_HLS_AGE_SECONDS
    removed = scanned = 0
    for root, _dirs, files in os.walk(hls_root):
        for f in files:
            if not (f.endswith('.ts') or f.endswith('.m3u8')):
                continue
            scanned += 1
            p = os.path.join(root, f)
            try:
                if os.path.getmtime(p) < cutoff:
                    os.remove(p)
                    removed += 1
            except OSError:
                # race condition — ffmpeg ঠিক তখনই ফাইলটা rewrite/delete করলে ignore
                # করে পরের round-এ (৩০ মিনিট পর) আবার চেষ্টা হবে, error না ছড়িয়ে
                pass

    if removed:
        logger.info("Stale HLS cache sweep: %d/%d ফাইল মুছে ফেলা হয়েছে (>%ds পুরনো)।",
                    removed, scanned, STALE_HLS_AGE_SECONDS)
    return {'removed': removed, 'scanned': scanned}
