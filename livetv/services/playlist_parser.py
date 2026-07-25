"""IPTV Playlist Parser — যেকোনো ফরম্যাট সাপোর্ট করে।

সাপোর্টেড ফরম্যাট:
  1. M3U / M3U8  — সবচেয়ে প্রচলিত (#EXTM3U / #EXTINF)
  2. JSON        — [{"name":…,"url":…,"logo":…,"group":…}, …]
  3. CSV         — name,url,logo,group (হেডার সহ বা ছাড়া)
  4. XSPF        — XML Shareable Playlist Format
  5. Simple TXT  — প্রতি লাইনে একটি URL (নাম auto-generate)
"""
import re
import json
import csv
import io
import xml.etree.ElementTree as ET

# group-title → আমাদের category mapping
_CAT_MAP = {
    'news': 'news', 'সংবাদ': 'news', 'বার্তা': 'news', 'খবর': 'news',
    'sport': 'sports', 'sports': 'sports', 'খেলা': 'sports', 'ক্রিকেট': 'sports',
    'entertainment': 'entertainment', 'বিনোদন': 'entertainment', 'drama': 'entertainment',
    'music': 'music', 'সঙ্গীত': 'music', 'মিউজিক': 'music', 'গান': 'music',
    'religious': 'religious', 'ধর্ম': 'religious', 'islamic': 'religious', 'quran': 'religious',
    'international': 'international', 'foreign': 'international', 'world': 'international',
}



# পুনরাবৃত্ত literal — S1192 এড়াতে module constant
_EXTINF = '#EXTINF'

def _map_category(group_str):
    g = (group_str or '').lower()
    for k, v in _CAT_MAP.items():
        if k in g:
            return v
    return 'other'


def _make_channel(name, url, logo='', group='', **_):
    return {
        'name':       (name or '').strip() or 'Untitled',
        'source_url': (url  or '').strip(),
        'logo_url':   (logo or '').strip(),
        'group':      (group or '').strip(),
        'category':   _map_category(group),
        'input_type': 'url',
    }


# ── ১. M3U / M3U8 ───────────────────────────────────────────────────
def _next_content_line(lines, start):
    """start থেকে প্রথম non-empty, non-comment line-এর index (না থাকলে len(lines))।"""
    j = start
    while j < len(lines) and (not lines[j].strip() or lines[j].strip().startswith('#')):
        j += 1
    return j


def _parse_master_playlist(lines):
    """HLS master playlist (EXT-X-STREAM-INF, EXTINF নেই) → single best-bandwidth channel।"""
    best_url, best_bw, best_res = None, -1, ''
    for i, line in enumerate(lines):
        if not line.strip().upper().startswith('#EXT-X-STREAM-INF'):
            continue
        bw_m = re.search(r'BANDWIDTH=(\d+)', line, re.IGNORECASE)
        res_m = re.search(r'RESOLUTION=(\d+x\d+)', line, re.IGNORECASE)
        bw = int(bw_m.group(1)) if bw_m else 0
        res = res_m.group(1) if res_m else ''
        # পরের non-comment line = URL
        j = _next_content_line(lines, i + 1)
        if j < len(lines):
            u = lines[j].strip()
            if u and not u.startswith('#') and bw >= best_bw:
                best_bw, best_url, best_res = bw, u, res
    if not best_url:
        return []
    name = f'Imported Channel ({best_res})' if best_res else 'Imported Channel'
    return [_make_channel(name, best_url, '')]


def _parse_extinf_attrs(line):
    """একটি #EXTINF line → (name, logo, group)।"""
    def attr(pat):
        m = re.search(pat, line, re.IGNORECASE)
        return m.group(1).strip() if m else ''

    tvg_name = attr(r'tvg-name="([^"]*)"')
    logo     = attr(r'tvg-logo="([^"]*)"')
    group    = attr(r'group-title="([^"]*)"')
    display  = line.split(',', 1)[-1].strip() if ',' in line else ''
    return (tvg_name or display), logo, group


def _parse_extinf_playlist(lines):
    """Standard IPTV M3U (EXTINF entries) → channels তালিকা।"""
    channels = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.upper().startswith(_EXTINF):
            name, logo, group = _parse_extinf_attrs(line)
            # পরবর্তী non-comment, non-empty line = URL
            j = _next_content_line(lines, i + 1)
            if j < len(lines):
                url = lines[j].strip()
                if url:
                    channels.append(_make_channel(name, url, logo, group))
                    i = j + 1
                    continue
        i += 1
    return channels


def parse_m3u(text):
    lines = text.strip().splitlines()
    # HLS Master Playlist — EXTINF নেই, শুধু EXT-X-STREAM-INF আছে → best bandwidth channel
    if '#EXT-X-STREAM-INF' in text and _EXTINF not in text:
        return _parse_master_playlist(lines)
    # Standard IPTV M3U — EXTINF entries
    return _parse_extinf_playlist(lines)


# ── ২. JSON ──────────────────────────────────────────────────────────
def parse_json(text):
    data = json.loads(text)
    # top-level list অথবা {"channels": […]} অথবা {"data": […]}
    if isinstance(data, dict):
        data = data.get('channels') or data.get('data') or data.get('items') or []
    channels = []
    for item in data:
        if not isinstance(item, dict):
            continue
        url = item.get('url') or item.get('stream_url') or item.get('source_url') or ''
        if not url:
            continue
        channels.append(_make_channel(
            name  = item.get('name') or item.get('title') or item.get('channel_name', ''),
            url   = url,
            logo  = item.get('logo') or item.get('logo_url') or item.get('icon', ''),
            group = item.get('group') or item.get('group_title') or item.get('category', ''),
        ))
    return channels


# ── ৩. CSV ───────────────────────────────────────────────────────────
def _csv_rows(text):
    """CSV text → row dicts। Header-এ url-জাতীয় column না থাকলে (বা row না থাকলে)
    positional fallback: name, url [, logo [, group]]।"""
    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)
    if rows and any(
        k.lower() in ('url', 'stream_url', 'source_url', 'link')
        for k in (reader.fieldnames or [])
    ):
        return rows
    # header নেই — positional
    positional = []
    for line in text.strip().splitlines():
        parts = [p.strip() for p in line.split(',')]
        if len(parts) >= 2:
            positional.append({
                'name': parts[0], 'url': parts[1],
                'logo': parts[2] if len(parts) > 2 else '',
                'group': parts[3] if len(parts) > 3 else '',
            })
    return positional


def _csv_row_to_channel(row):
    """একটি CSV row → channel dict (flexible key names; url না থাকলে None)।"""
    url = (
        row.get('url') or row.get('stream_url') or
        row.get('source_url') or row.get('link') or ''
    )
    if not url:
        return None
    return _make_channel(
        name  = row.get('name') or row.get('title') or row.get('channel', ''),
        url   = url,
        logo  = row.get('logo') or row.get('logo_url') or row.get('icon', ''),
        group = row.get('group') or row.get('group_title') or row.get('category', ''),
    )


def parse_csv(text):
    channels = []
    for row in _csv_rows(text):
        ch = _csv_row_to_channel(row)
        if ch is not None:
            channels.append(ch)
    return channels


# ── ৪. XSPF (XML) ────────────────────────────────────────────────────
def parse_xspf(text):
    NS = {'xspf': 'http://xspf.org/ns/0/'}
    root = ET.fromstring(text)
    track_list = root.find('xspf:trackList', NS) or root.find('trackList')
    if track_list is None:
        return []

    def txt(el, tag):
        child = el.find(f'xspf:{tag}', NS) or el.find(tag)
        return child.text.strip() if child is not None and child.text else ''

    channels = []
    for track in (track_list.findall('xspf:track', NS) or track_list.findall('track')):
        url = txt(track, 'location')
        if not url:
            continue
        channels.append(_make_channel(
            name  = txt(track, 'title'),
            url   = url,
            logo  = txt(track, 'image'),
            group = txt(track, 'album') or txt(track, 'annotation'),
        ))
    return channels


# ── ৫. Simple URL list (TXT) ──────────────────────────────────────────
def parse_txt(text):
    channels = []
    for i, line in enumerate(text.strip().splitlines(), 1):
        url = line.strip()
        if url and not url.startswith('#') and ('://' in url):
            channels.append(_make_channel(name=f'Channel {i}', url=url))
    return channels


# ── Auto-detect ──────────────────────────────────────────────────────
def parse_playlist(text, filename=''):
    """ফরম্যাট auto-detect করে parse করে।"""
    text = text.strip()
    ext  = (filename.rsplit('.', 1)[-1].lower()) if '.' in filename else ''

    # JSON
    if ext == 'json' or text.startswith('{') or text.startswith('['):
        try:
            return 'json', parse_json(text)
        except Exception:
            pass

    # XSPF
    if ext == 'xspf' or ('<xspf' in text.lower() or 'xspf.org' in text):
        try:
            return 'xspf', parse_xspf(text)
        except ET.ParseError:
            pass

    # M3U
    if ext in ('m3u', 'm3u8') or text.upper().startswith('#EXTM3U') or _EXTINF in text:
        return 'm3u', parse_m3u(text)

    # CSV
    if ext == 'csv':
        return 'csv', parse_csv(text)

    # Simple URL list
    return 'txt', parse_txt(text)
