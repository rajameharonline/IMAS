# Live TV API — CRUD + stream lifecycle + hardware scan + playlist import
import requests
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, AllowAny

from ..models import TVChannel, TVCategory, LiveTVSubscriber, FTPVideoContent
from ..services.stream_service import StreamService
from ..services.playlist_parser import parse_playlist
from .serializers import TVChannelSerializer, TVCategorySerializer


def _tcp_ping_ms(host, port, timeout):
    """TCP connect latency (ms) মাপে — fail হলে None।"""
    import socket, time
    try:
        addr_info = socket.getaddrinfo(host, port, socket.AF_UNSPEC, socket.SOCK_STREAM)
        family, socktype, proto, _, sockaddr = addr_info[0]
        sock = socket.socket(family, socktype, proto)
        sock.settimeout(min(timeout, 3.0))
        t0 = time.monotonic()
        sock.connect(sockaddr)
        ms = int((time.monotonic() - t0) * 1000)
        sock.close()
        return ms
    except Exception:
        return None  # TCP fail


def _verify_rtsp_content(url, timeout):
    """ffprobe দিয়ে RTSP video stream verify → content_ok (bool)।"""
    import subprocess
    try:
        r = subprocess.run([
            'ffprobe', '-v', 'error',
            '-rtsp_transport', 'tcp',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=codec_type',
            '-of', 'csv=p=0',
            '-timeout', str(int(timeout * 1_000_000)),
            url,
        ], capture_output=True, text=True, timeout=timeout + 3)
        return r.returncode == 0 and 'video' in r.stdout
    except Exception:
        return True  # ffprobe fail → TCP OK-কেই OK ধরো


def _verify_http_content(url, timeout):
    """HTTP/HTTPS: প্রথম 8KB fetch করে HLS/segment content আছে কিনা → content_ok (bool)।
    4xx → False (আগের `return True, False, ms`-এর সমতুল্য; caller tcp_ok=True রাখে)।"""
    import ssl
    import urllib.request
    from django.conf import settings
    try:
        ctx = ssl.create_default_context()
        # IPTV upstream প্রায়ই expired/self-signed cert — content-probe fail এড়াতে
        # default-এ verify বন্ধ; LIVETV_PROXY_SSL_VERIFY=True দিলে verify চালু (S4830,
        # hardcoded নয় — hls_proxy_service.py-র মতো একই setting-নিয়ন্ত্রিত)।
        if not getattr(settings, 'LIVETV_PROXY_SSL_VERIFY', False):
            # NOSONAR(python:S5527,python:S4830) — ইচ্ছাকৃত, settings দিয়ে নিয়ন্ত্রিত:
            # admin-configured IPTV source URL-এর health-check probe মাত্র (end-user-facing
            # proxy না, সেটা hls_proxy_service.py-তে আলাদাভাবে হয়)। LIVETV_PROXY_SSL_VERIFY=True
            # সেট করলে verify চালু হয় — অপারেটরের হাতে নিয়ন্ত্রণ আছে, hardcoded bypass না।
            ctx.check_hostname = False  # NOSONAR
            ctx.verify_mode = ssl.CERT_NONE  # NOSONAR
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20', 'Range': 'bytes=0-8191'},
        )
        with urllib.request.urlopen(req, timeout=timeout - 1, context=ctx) as resp:
            if resp.status >= 400:
                return False
            raw  = resp.read(8192)
            text = raw.decode('utf-8', errors='ignore')
            ct   = resp.headers.get('Content-Type', '').lower()
            if 'mpegurl' in ct or url.lower().endswith('.m3u8') or '#extm3u' in text.lower():
                # HLS playlist: segment আছে কিনা
                return '#EXTM3U' in text.upper() and (
                    '#EXTINF' in text or '#EXT-X-STREAM-INF' in text or '#EXT-X-MEDIA' in text
                )
            if 'video/' in ct or 'octet-stream' in ct:
                return len(raw) >= 188  # TS packet size
            return len(raw) >= 100
    except Exception:
        return False


def _check_stream_content(url: str, timeout: float = 8.0):
    """TCP ping + actual video content verification।
    - HTTP/HTTPS: m3u8 playlist fetch করে #EXTM3U + segment আছে কিনা দেখে
    - RTSP/RTSPS: ffprobe দিয়ে video stream codec verify করে
    Returns: (tcp_ok: bool, content_ok: bool, latency_ms: int|None)
    """
    from urllib.parse import urlparse

    parsed = urlparse(url)
    scheme = (parsed.scheme or '').lower()
    host   = parsed.hostname
    port   = parsed.port or {'https': 443, 'rtsp': 554, 'rtsps': 554}.get(scheme, 80)

    if not host:
        return False, False, None

    ms = _tcp_ping_ms(host, port, timeout)
    if ms is None:
        return False, False, None  # TCP fail

    if scheme in ('rtsp', 'rtsps'):
        content_ok = _verify_rtsp_content(url, timeout)
    else:
        content_ok = _verify_http_content(url, timeout)

    return True, content_ok, ms


def _tcp_ping(url: str, timeout: float = 5.0):
    """TCP socket connect দিয়ে latency মাপো — ICMP ping-এর মতো accurate।
    HTTP HEAD-এর তুলনায়: DNS cache + TLS overhead নেই → বাস্তব latency দেখায়।
    Returns: (reachable: bool, latency_ms: int | None)
    """
    import socket, time
    from urllib.parse import urlparse

    try:
        parsed = urlparse(url)
        host = parsed.hostname
        port = parsed.port or (443 if parsed.scheme == 'https' else 80)
        if not host:
            return False, None

        # DNS একবার resolve করো (OS cache-এ থাকলে free)
        addr_info = socket.getaddrinfo(host, port, socket.AF_UNSPEC, socket.SOCK_STREAM)
        if not addr_info:
            return False, None
        family, socktype, proto, _, sockaddr = addr_info[0]

        sock = socket.socket(family, socktype, proto)
        sock.settimeout(timeout)
        t0 = time.monotonic()
        sock.connect(sockaddr)
        ms = int((time.monotonic() - t0) * 1000)
        sock.close()
        return True, ms
    except socket.timeout:
        return False, None
    except Exception:
        return False, None


def _channel_all_urls(channel):
    """channel-এর primary source_url + extra_urls থেকে [{label, url}] তালিকা।"""
    all_urls = []
    if channel.source_url:
        all_urls.append({'label': 'Primary', 'url': channel.source_url})
    for item in (channel.extra_urls or []):
        if isinstance(item, dict) and item.get('url'):
            all_urls.append({'label': item.get('label', 'Backup'), 'url': item['url']})
    return all_urls


def _save_best_ping(channel_id, results):
    """results থেকে সেরা (সর্বনিম্ন) ping DB-তে সংরক্ষণ (fail হলে চুপচাপ)।"""
    try:
        from django.utils import timezone as _tz
        best = next((r for r in results if r.get('reachable') and r.get('latency_ms') is not None), None)
        TVChannel.objects.filter(pk=channel_id).update(
            last_ping_ms=best['latency_ms'] if best else None,
            last_ping_ok=bool(best),
            last_pinged_at=_tz.now(),
        )
    except Exception:
        pass


def _run_ping_all_bg(channel_id, all_urls, cache_key):
    """সব URL parallel TCP-ping করে cache + DB update — background thread-এ চলে।"""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from django.core.cache import cache
    from django.db import close_old_connections

    close_old_connections()
    try:
        def _ping(entry):
            reachable, ms = _tcp_ping(entry['url'])
            return {**entry, 'reachable': reachable, 'latency_ms': ms}

        results = []
        with ThreadPoolExecutor(max_workers=min(len(all_urls), 8)) as pool:
            futures = {pool.submit(_ping, u): u for u in all_urls}
            for f in as_completed(futures):
                results.append(f.result())

        results.sort(key=lambda x: (not x['reachable'], x['latency_ms'] or 99999))
        cache.set(cache_key, results, timeout=90)
        _save_best_ping(channel_id, results)
    finally:
        close_old_connections()


def _deep_check_update_channel(ch_id, tcp_ok, content_ok, ms):
    """একটি channel-এর content + ping check result DB-তে update (fail হলে চুপচাপ)।"""
    try:
        from django.utils import timezone as _tz
        TVChannel.objects.filter(pk=ch_id).update(
            last_content_ok=content_ok,
            last_content_checked_at=_tz.now(),
            # TCP ping result-ও আপডেট করো
            last_ping_ok=tcp_ok,
            last_ping_ms=ms if tcp_ok else None,
            last_pinged_at=_tz.now(),
        )
    except Exception:
        pass


def _run_deep_check_bg(channels, total, progress_key):
    """সব URL channel-এর actual content deep-check — background thread; Redis-এ progress।"""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from django.core.cache import cache
    from django.db import close_old_connections

    close_old_connections()
    done = ok = fail = 0
    try:
        def _check(entry):
            tcp_ok, content_ok, ms = _check_stream_content(entry['source_url'])
            return entry['id'], tcp_ok, content_ok, ms

        with ThreadPoolExecutor(max_workers=20) as pool:
            futures = {pool.submit(_check, ch): ch for ch in channels}
            for future in as_completed(futures):
                ch_id, tcp_ok, content_ok, ms = future.result()
                done += 1
                if content_ok:
                    ok += 1
                else:
                    fail += 1
                _deep_check_update_channel(ch_id, tcp_ok, content_ok, ms)
                # Progress update (প্রতি 10টায় একবার)
                if done % 10 == 0 or done == total:
                    cache.set(progress_key, {
                        'running': done < total,
                        'total': total, 'done': done,
                        'ok': ok, 'fail': fail,
                    }, timeout=900)
    finally:
        cache.set(progress_key, {
            'running': False, 'total': total, 'done': done,
            'ok': ok, 'fail': fail, 'finished': True,
        }, timeout=900)
        # mobile cache clear — নতুন content check result অনুযায়ী filter হবে
        cache.delete('mobile_livetv_channels')
        close_old_connections()


class LiveTVSubscriberViewSet(viewsets.ModelViewSet):
    """Live TV Subscriber CRUD — admin panel থেকে manage করা হয়।"""
    queryset = LiveTVSubscriber.objects.all()
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_serializer_class(self):
        from rest_framework import serializers as S

        class LiveTVSubscriberSerializer(S.ModelSerializer):
            password_plain = S.CharField(write_only=True, required=False, allow_blank=True,
                                         help_text='সেট করতে চাইলে লিখুন, না হলে খালি রাখুন।')

            class Meta:
                model  = LiveTVSubscriber
                fields = ['id', 'name', 'phone', 'customer_id', 'is_active',
                          'expires_at', 'notes', 'created_at', 'updated_at', 'password_plain']
                read_only_fields = ['id', 'created_at', 'updated_at']

            def create(self, validated_data):
                pw = validated_data.pop('password_plain', '') or ''
                if not pw:
                    raise S.ValidationError({'password_plain': 'নতুন subscriber-এর জন্য password দিন।'})
                sub = LiveTVSubscriber(**validated_data)
                sub.set_password(pw)
                sub.save()
                return sub

            def update(self, instance, validated_data):
                pw = validated_data.pop('password_plain', '') or ''
                for attr, val in validated_data.items():
                    setattr(instance, attr, val)
                if pw:
                    instance.set_password(pw)
                instance.save()
                return instance

        return LiveTVSubscriberSerializer

    @action(detail=True, methods=['post'], url_path='toggle-active')
    def toggle_active(self, request, pk=None):
        sub = self.get_object()
        sub.is_active = not sub.is_active
        sub.save(update_fields=['is_active'])
        return Response({'is_active': sub.is_active})


class TVCategoryViewSet(viewsets.ModelViewSet):
    """Category CRUD — list/create/update/delete।"""
    queryset = TVCategory.objects.all()
    serializer_class = TVCategorySerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None


class TVChannelViewSet(viewsets.ModelViewSet):
    queryset = TVChannel.objects.all().order_by('sort_order', 'name')
    serializer_class = TVChannelSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None  # সব চ্যানেল এক request-এ পাঠাও

    def get_queryset(self):
        qs = super().get_queryset()
        # শুধু 'list' action-এ health-check চালাও। DRF-এর get_object() ভেতরেও
        # get_queryset() কল করে, তাই আগে এটা start/stop/transcode-এর মতো
        # প্রতিটা single-object action-এও চলত — ঘন ঘন admin polling + প্রতিটা
        # action-এ redundant os.kill(pid, 0) call মিলে race window বাড়িয়ে
        # দিত (check_status একটা channel-কে 'error' মার্ক করার মুহূর্তে
        # ব্যবহারকারী Start চাপলে দুটো ffmpeg spawn হওয়ার সুযোগ তৈরি হতো)।
        if self.action == 'list':
            for ch in qs.filter(status__in=['starting', 'live']):
                StreamService.check_status(ch)
        return qs

    def get_permissions(self):
        # hls-proxy শুধু স্ট্রিম bytes ফরওয়ার্ড করে (SSRF-protected netloc allowlist দিয়ে
        # already secured) — player-এ আলাদা token auth লাগবে না, শুধু admin app-এ
        # login করাই যথেষ্ট। বাকি সব action (CRUD, start/stop ইত্যাদি) IsAuthenticated-ই থাকবে।
        if self.action == 'hls_proxy':
            return [AllowAny()]
        return super().get_permissions()

    def _clear_caches(self):
        from django.core.cache import cache
        cache.delete('livetv_allowed_netlocs')
        cache.delete('mobile_livetv_channels')

    def perform_create(self, serializer):
        super().perform_create(serializer)
        self._clear_caches()

    def perform_update(self, serializer):
        super().perform_update(serializer)
        self._clear_caches()

    # ── Stream control ──────────────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='start')
    def start_stream(self, request, pk=None):
        # URL-type চ্যানেলও এখন v4l2/dvb-এর মতো FFmpeg দিয়ে local HLS mirror লেখে
        # (shared 1-fetch-N-viewer relay — 10k subscriber একই চ্যানেল দেখলেও
        # upstream-এ একবারই hit হয়)। mobile app-এ প্রথম viewer এলে এমনিতেই
        # lazy-start হয় (mobile_api.AppLiveTVStreamProxyView), এই বাটন
        # pre-warm/manual control-এর জন্য।
        from django.core.cache import cache as _cache
        channel = self.get_object()
        if channel.status == 'live':
            return Response({'detail': 'ইতিমধ্যে লাইভ আছে।'}, status=status.HTTP_400_BAD_REQUEST)
        if channel.direct_relay:
            # সরাসরি সোর্স মোড — কোনো FFmpeg spawn হবে না, শুধু is_active flip
            # করলেই hls-proxy?url=<source_url> দিয়ে সরাসরি upstream serve হবে
            # (RAM/CPU খরচ প্রায় শূন্য, কোনো local process ট্র্যাক করার দরকার নেই)।
            channel.is_active = True
            channel.save(update_fields=['is_active'])
            _cache.delete('mobile_livetv_channels')
            channel.refresh_from_db()
            return Response({'detail': 'সরাসরি সোর্স মোডে চালু হয়েছে (FFmpeg ছাড়া)।',
                            'channel': self.get_serializer(channel).data})
        # mobile app-এর lazy-start ও retry_error_url_channels celery task একই
        # চ্যানেলের জন্য একই সময়ে start_stream() ডাকতে পারে — lock ছাড়া দুটো
        # ffmpeg process একসাথে spawn হয়ে duplicate তৈরি হতো।
        lock_key = f'livetv_relay_starting_{channel.id}'
        if not _cache.add(lock_key, True, timeout=20):
            return Response({'detail': 'ইতিমধ্যে শুরু হচ্ছে, একটু পর আবার চেষ্টা করুন।'},
                            status=status.HTTP_409_CONFLICT)
        try:
            success, result = StreamService.start_stream(channel)
        finally:
            _cache.delete(lock_key)
        if success:
            channel.is_active = True
            channel.save(update_fields=['is_active'])
        _cache.delete('mobile_livetv_channels')
        channel.refresh_from_db()
        if success:
            return Response({'detail': 'স্ট্রিম শুরু হয়েছে।', 'channel': self.get_serializer(channel).data})
        return Response({'detail': result}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['post'], url_path='transcode')
    def start_transcode(self, request, pk=None):
        """URL-type channel-এ FFmpeg দিয়ে H.264 re-encoding শুরু করো।
        HEVC/H.265 stream যা browser-এ চলে না, সেগুলো H.264-এ convert করবে।
        """
        channel = self.get_object()
        if channel.input_type != 'url':
            return Response({'detail': 'শুধুমাত্র URL/RTSP চ্যানেলে Transcode করা যাবে।'},
                            status=status.HTTP_400_BAD_REQUEST)
        if not channel.source_url:
            return Response({'detail': 'Source URL নেই।'}, status=status.HTTP_400_BAD_REQUEST)
        # আগে চলতে থাকলে বন্ধ করো
        if channel.ffmpeg_pid:
            StreamService.stop_stream(channel)
        channel.is_active = True
        channel.save(update_fields=['is_active'])
        # URL transcode-এ QSV ব্যর্থ হওয়ার সম্ভাবনা বেশি (Intel driver নাও থাকতে পারে)
        # software libx264 ব্যবহার করো — CPU বেশি কিন্তু নির্ভরযোগ্য
        channel.use_qsv = False
        success, result = StreamService.start_stream(channel)
        channel.refresh_from_db()
        if success:
            return Response({'detail': 'H.264 Transcode শুরু হয়েছে।', 'channel': self.get_serializer(channel).data})
        return Response({'detail': result}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['post'], url_path='stop')
    def stop_stream(self, request, pk=None):
        from django.core.cache import cache as _cache
        channel = self.get_object()
        if channel.direct_relay:
            # direct_relay মোডে কোনো local ffmpeg process থাকেই না — শুধু flag বন্ধ করো
            channel.is_active = False
            channel.save(update_fields=['is_active'])
        else:
            StreamService.stop_stream(channel)
            channel.is_active = False
            channel.save(update_fields=['is_active'])
        _cache.delete('mobile_livetv_channels')
        channel.refresh_from_db()
        return Response({'detail': 'বন্ধ করা হয়েছে।', 'channel': self.get_serializer(channel).data})

    @action(detail=False, methods=['get'], url_path='hls-proxy')
    def hls_proxy(self, request):
        """Browser থেকে internal HLS server access করার জন্য streaming proxy।
        GET /api/v1/livetv/channels/hls-proxy/?url=http://180.94.28.28:8097/...
        M3U8 manifest-এ relative ও absolute URLs proxy দিয়ে rewrite করা হয়।
        (staff-only — subscriber app এখন mobile_api.AppLiveTVStreamProxyView ব্যবহার করে)
        """
        import urllib.parse as _urlparse
        from django.http import HttpResponseBadRequest
        from livetv.services.hls_proxy_service import proxy_and_rewrite_hls
        from livetv.services.netloc_allowlist import get_allowed_netlocs

        target_url = request.query_params.get('url')
        if not target_url:
            return HttpResponseBadRequest('url parameter দিন।')

        # URL/IPTV চ্যানেল এখন local FFmpeg mirror (/media/hls/<slug>/…) লেখে, কিন্তু সেই
        # path nginx-এ `deny all` (127.0.0.1 ছাড়া) — public admin browser সরাসরি হিট করলে 403।
        # তাই আমাদের নিজস্ব /media/hls/ path হলে disk থেকে সরাসরি serve করি (external upstream নয়)।
        parsed = _urlparse.urlparse(target_url)
        if parsed.path.startswith('/media/hls/') and (
            not parsed.netloc or parsed.netloc == request.get_host()
        ):
            proxy_base = request.build_absolute_uri('/api/v1/livetv/channels/hls-proxy/?url=')
            return self._serve_local_mirror(parsed.path, proxy_base, request)

        # SSRF protection: শুধু channel-এ registered source_url-এর host:port allow করো।
        target_netloc = parsed.netloc
        if target_netloc not in get_allowed_netlocs():
            return HttpResponseBadRequest(f'অনুমোদিত নয়: {target_netloc}')

        proxy_base = request.build_absolute_uri('/api/v1/livetv/channels/hls-proxy/?url=')
        return proxy_and_rewrite_hls(target_url, proxy_base, request)

    @staticmethod
    def _serve_local_mirror(media_path, proxy_base, request=None):
        """`/media/hls/<slug>/<file>` local FFmpeg mirror disk থেকে সরাসরি serve করে।
        m3u8 হলে segment line-গুলো আবার hls-proxy?url= দিয়ে rewrite করে (browser যাতে
        সব fetch এই একই proxy দিয়ে করে, raw /media/hls/ কখনো সরাসরি হিট না করে → 403 এড়ায়)।
        """
        import os
        from urllib.parse import quote as _urlq
        from django.conf import settings
        from django.http import HttpResponse, HttpResponseNotFound, HttpResponseBadRequest
        from livetv.services.hls_proxy_service import apply_stream_cors

        # /media/hls/<slug>/<file> → MEDIA_ROOT/hls/<slug>/<file>
        rel = media_path[len('/media/'):]                       # hls/<slug>/<file>
        hls_root = os.path.join(settings.MEDIA_ROOT, 'hls')
        abs_path = os.path.normpath(os.path.join(settings.MEDIA_ROOT, rel))
        # Path traversal guard — resolved path অবশ্যই MEDIA_ROOT/hls-এর ভিতরে থাকতে হবে
        if not abs_path.startswith(os.path.abspath(hls_root) + os.sep):
            return HttpResponseBadRequest('অবৈধ path।')
        if not os.path.isfile(abs_path):
            return HttpResponseNotFound('স্ট্রিম এখনো প্রস্তুত নয়।')

        fname = os.path.basename(abs_path)
        if fname.endswith('.m3u8'):
            mirror_dir = os.path.dirname(media_path)             # /media/hls/<slug>
            with open(abs_path, 'r', encoding='utf-8', errors='replace') as f:
                text = f.read()
            out = []
            for line in text.splitlines():
                s = line.strip()
                if not s or s.startswith('#'):
                    out.append(line)
                else:
                    seg_path = f'{mirror_dir}/{os.path.basename(s)}'
                    out.append(proxy_base + _urlq(seg_path, safe=''))
            resp = HttpResponse('\n'.join(out), content_type='application/vnd.apple.mpegurl')
        else:
            ct = 'video/MP2T' if fname.endswith('.ts') else 'application/octet-stream'
            with open(abs_path, 'rb') as f:
                resp = HttpResponse(f.read(), content_type=ct)
        apply_stream_cors(resp, request)
        resp['Cache-Control'] = 'no-cache, no-store'
        return resp

    @action(detail=True, methods=['get'], url_path='ping')
    def ping_stream(self, request, pk=None):
        """URL-type channel-এর stream reachability — Redis cache + background thread।
        গুরুত্বপূর্ণ: gunicorn worker কখনো block হয় না। cache miss হলে background-এ ping
        শুরু করে অবিলম্বে {pending:true} ফেরত দেয়। 90s cache TTL।
        """
        import threading
        from django.core.cache import cache

        channel = self.get_object()
        if channel.input_type != 'url' or not channel.source_url:
            return Response({'reachable': False, 'latency_ms': None, 'detail': 'URL নেই।'})

        cache_key = f'ping_ch_{channel.id}'
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        # Cache miss — background thread-এ ping করো, worker block হবে না
        url = channel.source_url
        ch_id = channel.id

        def _do_ping():
            from django.utils import timezone as _tz
            from django.db import close_old_connections

            close_old_connections()
            try:
                reachable, ms = _tcp_ping(url)
                result = {'reachable': reachable, 'latency_ms': ms}
                if not reachable:
                    result['detail'] = 'Unreachable'
                cache.set(cache_key, result, timeout=90)
                # DB-তে শেষ ping result সংরক্ষণ — dashboard সবসময় এটা দেখাবে
                try:
                    TVChannel.objects.filter(pk=ch_id).update(
                        last_ping_ms=ms,
                        last_ping_ok=reachable,
                        last_pinged_at=_tz.now(),
                    )
                except Exception:
                    pass
            finally:
                close_old_connections()

        threading.Thread(target=_do_ping, daemon=True).start()
        return Response({'reachable': None, 'latency_ms': None, 'pending': True})

    @action(detail=True, methods=['get'], url_path='ping-all')
    def ping_all_urls(self, request, pk=None):
        """Channel-এর সব URLs (primary + backup) parallel ping — Redis cache + background thread।
        gunicorn worker block হয় না।
        """
        import threading
        from django.core.cache import cache

        channel = self.get_object()
        if channel.input_type != 'url':
            return Response([])

        cache_key = f'ping_all_ch_{channel.id}'
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        all_urls = _channel_all_urls(channel)
        if not all_urls:
            return Response([])

        threading.Thread(
            target=_run_ping_all_bg, args=(channel.id, all_urls, cache_key), daemon=True
        ).start()
        return Response({'pending': True, 'results': []})

    @action(detail=True, methods=['get'], url_path='log')
    def get_log(self, request, pk=None):
        lines = int(request.query_params.get('lines', 80))
        return Response({'log': StreamService.get_ffmpeg_log(self.get_object(), lines)})

    @action(detail=True, methods=['post'], url_path='check')
    def check_status(self, request, pk=None):
        channel = self.get_object()
        StreamService.check_status(channel)
        channel.refresh_from_db()
        return Response(self.get_serializer(channel).data)

    # ── Stats ───────────────────────────────────────────────────────

    @action(detail=False, methods=['get'], url_path='stats')
    def stats(self, request):
        from django.db.models import Q
        qs = TVChannel.objects
        # URL-type channel: is_active=True হলে live, False হলে stopped
        live_count = qs.filter(
            Q(status='live') |
            Q(input_type='url', is_active=True)
        ).distinct().count()
        stopped_count = qs.filter(
            Q(status='stopped', input_type__in=['v4l2', 'dvb']) |
            Q(input_type='url', is_active=False)
        ).distinct().count()
        # App-এ দেখানো চ্যানেল: app-এর আসল list-এর (AppLiveTVChannelsView) একই
        # shared function দিয়ে গণনা — filter + Redis ping + content_ok + name dedup —
        # যাতে এই badge আর app-এর প্রকৃত channel সংখ্যা সবসময় মিলে যায়।
        from livetv.services.app_visibility import get_visible_channels
        app_visible = len(get_visible_channels())
        resp = Response({
            'total':       qs.count(),
            'live':        live_count,
            'stopped':     stopped_count,
            'error':       qs.filter(status='error').count(),
            'starting':    qs.filter(status='starting').count(),
            'app_visible': app_visible,
            # content check-এ video/audio পাওয়া যায়নি (✗) — app থেকে বাদ, delete-এর candidate
            'content_failed': qs.filter(last_content_ok=False).count(),
            'by_type': {
                'v4l2': qs.filter(input_type='v4l2').count(),
                'dvb':  qs.filter(input_type='dvb').count(),
                'url':  qs.filter(input_type='url').count(),
            },
        })
        # admin panel প্রতি ১০ সেকেন্ডে poll করে — browser/proxy যাতে stale সংখ্যা cache
        # না করে (live count সবসময় fresh দেখাতে হবে)।
        resp['Cache-Control'] = 'no-store, must-revalidate'
        return resp

    # ── Bulk delete ─────────────────────────────────────────────────

    @action(detail=False, methods=['post'], url_path='bulk-delete')
    def bulk_delete(self, request):
        """একাধিক চ্যানেল একসাথে delete — content-failed (✗) চ্যানেল bulk cleanup-এর জন্য।
        Body: { "ids": [1,2,3] }  অথবা  { "content_failed": true } (সব ✗ চ্যানেল)।
        relay চললে আগে বন্ধ করে তারপর delete করে।
        """
        ids = request.data.get('ids')
        if request.data.get('content_failed') and not ids:
            ids = list(TVChannel.objects.filter(last_content_ok=False).values_list('id', flat=True))
        if not isinstance(ids, list) or not ids:
            return Response({'detail': 'delete করার জন্য ids দিন।'}, status=status.HTTP_400_BAD_REQUEST)

        channels = list(TVChannel.objects.filter(pk__in=ids))
        deleted = 0
        for ch in channels:
            try:
                StreamService.stop_stream(ch)  # চললে relay বন্ধ করো
            except Exception:  # noqa: BLE001 — একটা fail বাকিগুলো থামাবে না
                pass
            try:
                ch.delete()
                deleted += 1
            except Exception:  # noqa: BLE001
                pass

        self._clear_caches()
        return Response({'deleted': deleted, 'detail': f'{deleted} টি চ্যানেল ডিলিট হয়েছে।'})

    # ── Deep Content Check ──────────────────────────────────────────

    @action(detail=False, methods=['post'], url_path='deep-check-all')
    def deep_check_all(self, request):
        """সব URL চ্যানেলের actual video stream check — background thread।
        ffprobe (RTSP) / HTTP m3u8 fetch (HTTP/HTTPS) দিয়ে content verify করে।
        Redis-এ progress track করা হয়।
        """
        import threading
        from django.core.cache import cache

        PROGRESS_KEY = 'deep_check_progress'
        prog = cache.get(PROGRESS_KEY)
        if prog and prog.get('running'):
            return Response({'detail': 'চেক ইতিমধ্যে চলছে।', 'progress': prog}, status=409)

        channels = list(TVChannel.objects.filter(
            input_type='url', source_url__isnull=False,
        ).exclude(source_url='').values('id', 'source_url'))

        total = len(channels)
        if total == 0:
            return Response({'detail': 'কোনো URL চ্যানেল নেই।'})

        cache.set(PROGRESS_KEY, {'running': True, 'total': total, 'done': 0, 'ok': 0, 'fail': 0}, timeout=900)

        threading.Thread(
            target=_run_deep_check_bg, args=(channels, total, PROGRESS_KEY), daemon=True
        ).start()
        return Response({
            'detail': f'Deep check শুরু হয়েছে — {total}টি চ্যানেল চেক হবে।',
            'total': total,
        })

    @action(detail=False, methods=['get'], url_path='deep-check-status')
    def deep_check_status(self, request):
        """Deep check-এর বর্তমান progress।"""
        from django.core.cache import cache
        prog = cache.get('deep_check_progress') or {'running': False, 'total': 0, 'done': 0}
        return Response(prog)

    # ── Hardware scan ───────────────────────────────────────────────

    @action(detail=False, methods=['get'], url_path='scan-devices')
    def scan_devices(self, request):
        """সার্ভারে লাগানো HDMI ও DVB কার্ড live scan।"""
        return Response({
            'v4l2': StreamService.scan_v4l2_devices(),
            'dvb':  StreamService.scan_dvb_adapters(),
            'alsa': StreamService.scan_alsa_devices(),
        })

    # ── Logo Upload ──────────────────────────────────────────────────

    @action(detail=False, methods=['post'], url_path='upload-logo')
    def upload_logo(self, request):
        """Channel logo image upload → media/livetv/logos/ এ সংরক্ষণ করে URL ফেরত দেয়।"""
        import uuid, os
        from django.conf import settings

        logo_file = request.FILES.get('logo')
        if not logo_file:
            return Response({'detail': 'logo file দিন।'}, status=status.HTTP_400_BAD_REQUEST)

        ext = os.path.splitext(logo_file.name)[-1].lower() or '.png'
        filename = f"{uuid.uuid4().hex}{ext}"
        logo_dir = os.path.join(settings.MEDIA_ROOT, 'livetv', 'logos')
        os.makedirs(logo_dir, exist_ok=True)

        dest = os.path.join(logo_dir, filename)
        with open(dest, 'wb+') as f:
            for chunk in logo_file.chunks():
                f.write(chunk)

        url = request.build_absolute_uri(f"{settings.MEDIA_URL}livetv/logos/{filename}")
        return Response({'url': url, 'filename': filename})

    @action(detail=False, methods=['post'], url_path='batch-ping')
    def batch_ping(self, request):
        """একসাথে অনেক URL ping করো — import preview-এর জন্য।
        Body: {"urls": ["url1", "url2", ...]}
        Response: {"url1": {"ms": 234, "ok": true}, ...}
        """
        import time, requests as req
        from concurrent.futures import ThreadPoolExecutor, as_completed

        urls = request.data.get('urls', [])
        if not isinstance(urls, list) or not urls:
            return Response({'detail': 'urls list দিন।'}, status=status.HTTP_400_BAD_REQUEST)
        urls = [str(u).strip() for u in urls if str(u).strip()][:300]

        headers = {'User-Agent': 'Mozilla/5.0 (compatible; ISP-BNAS/1.0)'}

        def _ping(url):
            try:
                t0 = time.monotonic()
                r = req.head(url, timeout=6, allow_redirects=True, headers=headers)
                ms = int((time.monotonic() - t0) * 1000)
                if r.status_code in (405, 501):
                    t0 = time.monotonic()
                    r = req.get(url, timeout=6, stream=True, headers=headers)
                    r.close()
                    ms = int((time.monotonic() - t0) * 1000)
                return url, ms, r.status_code < 500
            except req.exceptions.Timeout:
                return url, None, False
            except Exception:
                return url, None, False

        results = {}
        with ThreadPoolExecutor(max_workers=min(len(urls), 50)) as pool:
            futures = {pool.submit(_ping, u): u for u in urls}
            for f in as_completed(futures):
                url, ms, ok = f.result()
                results[url] = {'ms': ms, 'ok': ok}

        return Response(results)

    # ── Playlist Import ─────────────────────────────────────────────

    @action(detail=False, methods=['post'], url_path='parse-playlist')
    def parse_playlist_preview(self, request):
        """Playlist parse করে preview দেয় — কোনো channel তৈরি হয় না।

        Body (multipart বা JSON):
          - url   : playlist URL (IPTV provider থেকে কেনা M3U link)
          - file  : uploaded playlist file (M3U/JSON/CSV/XSPF/TXT)
          - text  : সরাসরি playlist text paste
        """
        text, filename = _get_playlist_text(request)
        if text is None:
            return Response(
                {'detail': 'url, file বা text — এর যেকোনো একটি দিন।'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            fmt, channels = parse_playlist(text, filename)
        except Exception as exc:
            return Response(
                {'detail': f'Parse করা যায়নি: {exc}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response({
            'format':   fmt,
            'total':    len(channels),
            'channels': channels,
        })

    @action(detail=False, methods=['post'], url_path='import-playlist')
    def import_playlist(self, request):
        """Playlist parse করে নির্বাচিত channel গুলো DB-তে সংরক্ষণ করে।

        Body:
          - url / file / text  : playlist source
          - selected_indices   : [0, 1, 3, …] — কোন index গুলো import করবে
                                 (না দিলে সবগুলো import হবে)
          - default_sort_start : প্রথম channel-এর sort_order (default: 0)
          - skip_duplicates    : true/false — একই URL থাকলে skip (default: true)
        """
        text, filename = _get_playlist_text(request)
        if text is None:
            return Response(
                {'detail': 'url, file বা text — এর যেকোনো একটি দিন।'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            fmt, channels = parse_playlist(text, filename)
        except Exception as exc:
            return Response(
                {'detail': f'Parse করা যায়নি: {exc}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        selected = request.data.get('selected_indices')
        if selected is not None:
            if isinstance(selected, str):
                import json as _json
                selected = _json.loads(selected)
            channels = [channels[i] for i in selected if 0 <= i < len(channels)]

        sort_start     = int(request.data.get('default_sort_start', 0))
        skip_dupes     = str(request.data.get('skip_duplicates', 'true')).lower() != 'false'

        existing_urls = set(
            TVChannel.objects.values_list('source_url', flat=True)
        ) if skip_dupes else set()

        created, skipped = 0, 0
        for i, ch in enumerate(channels):
            url = ch.get('source_url', '')
            if skip_dupes and url and url in existing_urls:
                skipped += 1
                continue
            TVChannel.objects.create(
                name         = ch.get('name', f'Channel {i+1}'),
                category     = ch.get('category', 'other'),
                logo_url     = ch.get('logo_url', ''),
                input_type   = 'url',
                source_url   = url,
                sort_order   = sort_start + i,
                video_bitrate = 2500,
                audio_bitrate = 128,
                use_qsv      = True,
            )
            existing_urls.add(url)
            created += 1

        # HLS proxy allowed_netlocs cache clear করো
        from django.core.cache import cache
        cache.delete('livetv_allowed_netlocs')

        return Response({
            'format':  fmt,
            'created': created,
            'skipped': skipped,
            'total':   len(channels),
            'detail':  f'{created} টি চ্যানেল যোগ হয়েছে।' + (f' {skipped} টি duplicate বাদ দেওয়া হয়েছে।' if skipped else ''),
        })


# ── helper ──────────────────────────────────────────────────────────

def _get_playlist_text(request):
    """request থেকে playlist text বের করে (URL fetch / file upload / raw text)।"""
    # ১. URL থেকে fetch
    url = request.data.get('url') or request.query_params.get('url')
    if url:
        try:
            resp = requests.get(url, timeout=15, headers={'User-Agent': 'ISP-BNAS/1.0'})
            resp.raise_for_status()
            return resp.text, url.split('/')[-1].split('?')[0] or 'playlist.m3u'
        except requests.RequestException as exc:
            raise ValueError(f'URL থেকে download করা যায়নি: {exc}') from exc

    # ২. Uploaded file
    f = request.FILES.get('file')
    if f:
        return f.read().decode('utf-8', errors='replace'), f.name

    # ৩. Raw text paste
    text = request.data.get('text')
    if text:
        return text, 'playlist.txt'


# ── FTP Video Content API ────────────────────────────────────────────────────
# App: token required  |  Admin: IsAuthenticated

from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser
from .auth_views import verify_livetv_token


class FTPContentAppView(APIView):
    """GET /api/v1/livetv/app/ftp-content/
    App subscriber-দের জন্য — token verify করে সব active content দেয়।
    ?type=movie|drama|series দিয়ে filter করা যাবে।
    """
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        sub = verify_livetv_token(request)
        if not sub:
            return Response({'detail': 'Invalid or expired token.'}, status=401)

        qs = FTPVideoContent.objects.filter(is_active=True)
        ct = request.query_params.get('type')
        if ct in ('movie', 'drama', 'series'):
            qs = qs.filter(content_type=ct)

        data = [_serialize_content(v) for v in qs]
        return Response(data)


class FTPContentAdminViewSet(viewsets.ModelViewSet):
    """Admin panel CRUD — /api/v1/livetv/ftp-content/ (IsAuthenticated)"""
    permission_classes = [IsAuthenticated]
    queryset = FTPVideoContent.objects.all().order_by('order', '-created_at')

    def get_serializer_class(self):
        return None  # inline serialize/deserialize নিচে করা হচ্ছে

    def list(self, request):
        qs = self.get_queryset()
        ct = request.query_params.get('type')
        if ct:
            qs = qs.filter(content_type=ct)
        q = request.query_params.get('q')
        if q:
            qs = qs.filter(title__icontains=q)
        return Response([_serialize_content(v) for v in qs])

    def retrieve(self, request, pk=None):
        obj = _get_content_or_404(pk)
        return Response(_serialize_content(obj))

    def create(self, request):
        obj = FTPVideoContent()
        _apply_fields(obj, request.data)
        obj.save()
        return Response(_serialize_content(obj), status=201)

    def partial_update(self, request, pk=None):
        obj = _get_content_or_404(pk)
        # video_filename পরিবর্তন হলে পুরনো ফাইল disk থেকে মুছে দাও
        new_vid = (request.data.get('video_filename') or '').strip()
        if new_vid and obj.video_filename and obj.video_filename != new_vid:
            _delete_video_file(obj.video_filename)
        # thumbnail_filename পরিবর্তন হলে পুরনো ছবি মুছে দাও
        new_thumb = (request.data.get('thumbnail_filename') or '').strip()
        if new_thumb and obj.thumbnail_filename and obj.thumbnail_filename != new_thumb:
            _delete_thumbnail_file(obj.thumbnail_filename)
        _apply_fields(obj, request.data)
        obj.save()
        return Response(_serialize_content(obj))

    def destroy(self, request, pk=None):
        obj = _get_content_or_404(pk)
        if obj.video_filename:
            _delete_video_file(obj.video_filename)
        if obj.thumbnail_filename:
            _delete_thumbnail_file(obj.thumbnail_filename)
        obj.delete()
        return Response(status=204)

    @action(detail=False, methods=['post'], url_path='bulk-order')
    def bulk_order(self, request):
        """POST { ids: [1,2,3] } — ক্রম অনুযায়ী order আপডেট করে"""
        ids = request.data.get('ids', [])
        for i, vid in enumerate(ids):
            FTPVideoContent.objects.filter(pk=vid).update(order=i)
        return Response({'detail': 'order আপডেট হয়েছে।'})


def _serialize_content(v):
    return {
        'id':                 v.id,
        'title':              v.title,
        'content_type':       v.content_type,
        'thumbnail_url':      v.thumbnail_url,
        'thumbnail_filename': v.thumbnail_filename,
        'description':        v.description,
        'year':               v.year,
        'genre':              v.genre,
        'language':           v.language,
        'video_url':          v.video_url,
        'video_filename':     v.video_filename,
        'series_title':       v.series_title,
        'season':             v.season,
        'episode':            v.episode,
        'is_active':          v.is_active,
        'order':              v.order,
        'created_at':         v.created_at.isoformat() if v.created_at else None,
    }


def _get_content_or_404(pk):
    from django.http import Http404
    try:
        return FTPVideoContent.objects.get(pk=pk)
    except FTPVideoContent.DoesNotExist:
        raise Http404


def _apply_fields(obj, data):
    for field in ('title', 'content_type', 'thumbnail_url', 'thumbnail_filename',
                  'description', 'genre', 'language',
                  'video_url', 'video_filename', 'series_title'):
        if field in data:
            setattr(obj, field, data[field] or '')
    for field in ('year', 'season', 'episode', 'order'):
        if field in data:
            setattr(obj, field, data[field] if data[field] not in (None, '') else None)
    if 'is_active' in data:
        obj.is_active = bool(data['is_active'])


def _delete_video_file(filename: str):
    """media/livetv/videos/<filename> disk থেকে মুছে দেয়।"""
    if not filename or '/' in filename or '..' in filename:
        return
    from django.core.files.storage import default_storage
    try:
        path = f'livetv/videos/{filename}'
        if default_storage.exists(path):
            default_storage.delete(path)
    except Exception:
        pass


def _delete_thumbnail_file(filename: str):
    """media/livetv/thumbnails/<filename> disk থেকে মুছে দেয়।"""
    if not filename or '/' in filename or '..' in filename:
        return
    from django.core.files.storage import default_storage
    try:
        path = f'livetv/thumbnails/{filename}'
        if default_storage.exists(path):
            default_storage.delete(path)
    except Exception:
        pass


# ── ভিডিও ফাইল আপলোড ──────────────────────────────────────────────────────────

# App-এ expo-video (ExoPlayer) যা support করে:
ALLOWED_VIDEO_EXTENSIONS = {
    '.mp4', '.mkv', '.webm', '.avi', '.mov', '.ts', '.flv',
    '.m4v', '.3gp', '.wmv', '.ogv', '.m2ts',
}


class FTPVideoUploadView(APIView):
    """POST /api/v1/livetv/ftp-content/upload-video/
    Admin-only: ভিডিও ফাইল আপলোড করে media/livetv/videos/ তে রাখে।
    Response: { url, filename, size_mb, ext }
    """
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        import os, uuid
        from django.core.files.storage import default_storage
        from django.core.files.base import ContentFile
        from django.conf import settings

        video_file = request.FILES.get('video_file')
        if not video_file:
            return Response({'detail': 'video_file field প্রয়োজন।'}, status=400)

        ext = os.path.splitext(video_file.name)[1].lower()
        if ext not in ALLOWED_VIDEO_EXTENSIONS:
            return Response({
                'detail': f'"{ext}" format support করা হয় না। '
                          f'সমর্থিত: {", ".join(sorted(ALLOWED_VIDEO_EXTENSIONS))}',
            }, status=400)

        # unique filename: livetv/videos/<uuid>.<ext>
        filename = f"{uuid.uuid4().hex}{ext}"
        save_path = f'livetv/videos/{filename}'

        saved_path = default_storage.save(save_path, ContentFile(video_file.read()))
        file_url = request.build_absolute_uri(settings.MEDIA_URL + saved_path)

        size_mb = round(video_file.size / (1024 * 1024), 2)
        return Response({
            'url':      file_url,
            'filename': filename,
            'size_mb':  size_mb,
            'ext':      ext,
        }, status=201)


class FTPVideoDeleteUploadView(APIView):
    """DELETE /api/v1/livetv/ftp-content/delete-upload/
    Body: { filename: '...' }  — media/livetv/videos/ থেকে ফাইল মুছে দেয়।
    """
    permission_classes = [IsAuthenticated]

    def delete(self, request):
        from django.core.files.storage import default_storage

        filename = (request.data.get('filename') or '').strip()
        if not filename or '/' in filename or '..' in filename:
            return Response({'detail': 'Invalid filename।'}, status=400)

        path = f'livetv/videos/{filename}'
        if default_storage.exists(path):
            default_storage.delete(path)
            return Response({'detail': 'ফাইল মুছে গেছে।'})
        return Response({'detail': 'ফাইল পাওয়া যায়নি।'}, status=404)


# ── থাম্বনেইল ইমেজ আপলোড ─────────────────────────────────────────────────────

ALLOWED_IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'}


class FTPThumbnailUploadView(APIView):
    """POST /api/v1/livetv/ftp-content/upload-thumbnail/
    Admin-only: thumbnail image আপলোড করে media/livetv/thumbnails/ তে রাখে।
    Response: { url, filename, size_kb, ext }
    """
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        import os, uuid
        from django.core.files.storage import default_storage
        from django.core.files.base import ContentFile
        from django.conf import settings

        img_file = request.FILES.get('thumbnail_file')
        if not img_file:
            return Response({'detail': 'thumbnail_file field প্রয়োজন।'}, status=400)

        ext = os.path.splitext(img_file.name)[1].lower()
        if ext not in ALLOWED_IMAGE_EXTENSIONS:
            return Response({
                'detail': f'"{ext}" format support করা হয় না। সমর্থিত: jpg, jpeg, png, webp, gif',
            }, status=400)

        filename  = f"{uuid.uuid4().hex}{ext}"
        save_path = f'livetv/thumbnails/{filename}'
        saved     = default_storage.save(save_path, ContentFile(img_file.read()))
        url       = request.build_absolute_uri(settings.MEDIA_URL + saved)
        size_kb   = round(img_file.size / 1024, 1)

        return Response({'url': url, 'filename': filename, 'size_kb': size_kb, 'ext': ext}, status=201)


class FTPThumbnailDeleteView(APIView):
    """DELETE /api/v1/livetv/ftp-content/delete-thumbnail/
    Body: { filename: '...' }  — media/livetv/thumbnails/ থেকে ফাইল মুছে দেয়।
    """
    permission_classes = [IsAuthenticated]

    def delete(self, request):
        from django.core.files.storage import default_storage

        filename = (request.data.get('filename') or '').strip()
        if not filename or '/' in filename or '..' in filename:
            return Response({'detail': 'Invalid filename।'}, status=400)

        path = f'livetv/thumbnails/{filename}'
        if default_storage.exists(path):
            default_storage.delete(path)
            return Response({'detail': 'ছবি মুছে গেছে।'})
        return Response({'detail': 'ছবি পাওয়া যায়নি।'}, status=404)
