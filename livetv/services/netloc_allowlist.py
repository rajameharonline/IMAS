# SSRF allowlist — DB-তে registered channel source_url/extra_urls-এর netloc cache করে।
# hls_proxy (staff) ও AppLiveTVStreamProxyView (subscriber) দুটোই এই cache শেয়ার করে।
import urllib.parse as _urlparse

from django.core.cache import cache

CACHE_KEY = 'livetv_allowed_netlocs'


def _safe_netloc(url):
    """URL parse করে netloc ফেরত; parse fail হলে None (তখন কিছু যোগ হয় না)।"""
    try:
        return _urlparse.urlparse(url).netloc
    except Exception:
        return None


def _channel_netlocs(src, extra):
    """একটি channel-এর source_url + extra_urls থেকে netloc গুলো yield করে
    (আগের nested try/except-এর হুবহু আচরণ — successful parse-এর empty netloc-ও yield)।"""
    n = _safe_netloc(src)
    if n is not None:
        yield n
    for item in (extra or []):
        url = item.get('url', '') if isinstance(item, dict) else ''
        if url:
            n = _safe_netloc(url)
            if n is not None:
                yield n


def get_allowed_netlocs():
    """DB-তে registered সব channel-এর source_url + extra_urls থেকে netloc set — 120s cache।"""
    from ..models import TVChannel

    allowed = cache.get(CACHE_KEY)
    if allowed is not None:
        return allowed

    allowed = set()
    for src, extra in TVChannel.objects.exclude(source_url='').values_list('source_url', 'extra_urls'):
        allowed.update(_channel_netlocs(src, extra))
    cache.set(CACHE_KEY, allowed, timeout=120)
    return allowed
