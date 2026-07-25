# HLS manifest/segment streaming proxy — shared core।
# staff hls-proxy (TVChannelViewSet.hls_proxy) ও subscriber-facing stream proxy
# (mobile_api.AppLiveTVStreamProxyView) দুটোই এই একই rewrite logic ব্যবহার করে,
# যাতে SSRF protection ও manifest rewriting একটাই জায়গায় maintain হয়।
import re
import urllib.parse as _urlparse

import requests as req
import urllib3
from django.conf import settings
from django.http import (
    StreamingHttpResponse, HttpResponseBadRequest, HttpResponse, HttpResponseRedirect,
)

# অনেক IPTV/CDN source-এর SSL সার্টিফিকেট মেয়াদোত্তীর্ণ/self-signed (browser "Not secure"
# দেখিয়ে চালাতে দেয়, ffmpeg-ও verify করে না)। proxy-তে verify করলে সেসব source "সার্ভার
# সাড়া দিচ্ছে না" দেখাত — তাই default-এ verify বন্ধ। কিন্তু hardcoded verify=False (S4830)
# এর বদলে setting দিয়ে নিয়ন্ত্রণযোগ্য: operator-এর সব source valid cert হলে
# LIVETV_PROXY_SSL_VERIFY=True দিয়ে hostname/cert verification চালু করা যায়।
_SSL_VERIFY = getattr(settings, 'LIVETV_PROXY_SSL_VERIFY', False)
if not _SSL_VERIFY:
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


def apply_stream_cors(response, request=None):
    """Cross-origin HLS playback-এর জন্য শুধু allowlisted origin reflect করি — wildcard
    `*` নয় (S5122)। corsheaders middleware-ও একই allowlist ব্যবহার করে, কিন্তু
    streaming/media response-এ explicit রাখি। Native app player browser নয় (Origin header
    পাঠায় না) → CORS enforce হয় না, তাই header না থাকলেও কাজ করে।"""
    origin = request.META.get('HTTP_ORIGIN') if request is not None else None
    if origin and origin in getattr(settings, 'CORS_ALLOWED_ORIGINS', []):
        response['Access-Control-Allow-Origin'] = origin
        response['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS'
        response.setdefault('Vary', 'Origin')
    return response


def _fetch_upstream(target_url):
    """upstream GET — সফল হলে (response, None); fail/ok-নয় হলে (None, error_response)।"""
    try:
        upstream = req.get(
            target_url, timeout=15, stream=True, verify=_SSL_VERIFY,
            headers={
                'User-Agent': 'Mozilla/5.0 (compatible; ISP-BNAS-Proxy/1.0)',
                'Accept': '*/*',
            },
        )
    except req.exceptions.Timeout:
        return None, HttpResponse('Upstream timeout (15s)', status=504)
    except req.exceptions.ConnectionError as e:
        return None, HttpResponse(f'Connection failed: {e}', status=502)
    except Exception as e:
        return None, HttpResponse(f'Proxy error: {e}', status=502)

    if not upstream.ok:
        return None, HttpResponse(
            f'Upstream {upstream.status_code}: {upstream.reason}',
            status=upstream.status_code if upstream.status_code < 600 else 502,
        )
    return upstream, None


def _best_rendition_url(lines):
    """master playlist lines থেকে সর্বোচ্চ-bandwidth rendition URL (না পেলে None)।"""
    best_url = None
    best_bw  = 0
    for i, line in enumerate(lines):
        if not line.strip().startswith('#EXT-X-STREAM-INF'):
            continue
        if i + 1 >= len(lines):
            continue
        rendition = lines[i + 1].strip()
        if not rendition or rendition.startswith('#'):
            continue
        m = re.search(r'BANDWIDTH=(\d+)', line)
        bw = int(m.group(1)) if m else 0
        if bw >= best_bw:
            best_bw  = bw
            best_url = rendition
    return best_url


def _master_best_rendition_redirect(text, base_url, proxy_base):
    """Master playlist হলে best video rendition-এ redirect response; নাহলে None।"""
    if '#EXT-X-STREAM-INF' not in text:
        return None
    best_url = _best_rendition_url(text.splitlines())
    if not best_url:
        return None
    abs_rendition = best_url if best_url.startswith('http') else _urlparse.urljoin(base_url + '/', best_url)
    return HttpResponseRedirect(proxy_base + _urlparse.quote(abs_rendition, safe=''))


def _rewrite_manifest(text, base_url, proxy_base):
    """media playlist-এর সব segment/URI line proxy_base দিয়ে rewrite করে string ফেরত।"""
    def rewrite_url(raw_url):
        raw_url = raw_url.strip()
        if not raw_url:
            return raw_url
        abs_url = raw_url if raw_url.startswith('http') else _urlparse.urljoin(base_url, raw_url)
        return proxy_base + _urlparse.quote(abs_url, safe='')

    result = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            result.append(line)
        elif stripped.startswith('#'):
            line = re.sub(
                r'URI="([^"]+)"',
                lambda m: f'URI="{rewrite_url(m.group(1))}"',
                line,
            )
            result.append(line)
        else:
            result.append(rewrite_url(stripped))
    return '\n'.join(result)


def proxy_and_rewrite_hls(target_url: str, proxy_base: str, request=None):
    """Upstream HLS URL fetch করে manifest হলে rewrite করে, segment হলে stream করে দেয়।

    target_url: upstream (বা internal) URL যেখান থেকে ফেচ করতে হবে।
    proxy_base: rewritten URL-গুলো যে prefix দিয়ে শুরু হবে
                (e.g. ".../hls-proxy/?url=" বা ".../stream/5/?url=")।
                caller নিজের auth token/channel-scoping proxy_base-এর মধ্যেই বসিয়ে দেবে।

    Returns: Django HttpResponse (StreamingHttpResponse বা error response)
    """
    if not target_url:
        return HttpResponseBadRequest('url parameter দিন।')

    parsed_target = _urlparse.urlparse(target_url)
    if not parsed_target.netloc or parsed_target.scheme not in ('http', 'https'):
        return HttpResponseBadRequest('অবৈধ URL।')

    upstream, err = _fetch_upstream(target_url)
    if err is not None:
        return err

    content_type = upstream.headers.get('Content-Type', 'application/octet-stream')
    is_m3u8 = 'mpegurl' in content_type or target_url.split('?')[0].endswith('.m3u8')

    if is_m3u8:
        text = upstream.text
        base_url = target_url.split('?')[0].rsplit('/', 1)[0] + '/'

        # Master playlist হলে সরাসরি best video rendition-এ redirect করো
        redirect = _master_best_rendition_redirect(text, base_url, proxy_base)
        if redirect is not None:
            return redirect

        rewritten = _rewrite_manifest(text, base_url, proxy_base)
        response = StreamingHttpResponse(
            (rewritten,), content_type='application/vnd.apple.mpegurl'
        )
    else:
        def iter_content():
            for chunk in upstream.iter_content(chunk_size=32768):
                yield chunk
        response = StreamingHttpResponse(iter_content(), content_type=content_type)

    apply_stream_cors(response, request)
    response['Cache-Control'] = 'no-cache, no-store'
    return response
