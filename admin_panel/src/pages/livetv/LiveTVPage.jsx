import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../utils/api';
import { toast } from 'react-hot-toast';
import Hls from 'hls.js';

// ── Icons ──────────────────────────────────────────────────────────────
const Icons = {
  Tv:     () => <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z" clipRule="evenodd" /></svg>,
  Play:   () => <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>,
  Stop:   () => <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" /></svg>,
  Edit:   () => <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /></svg>,
  Import: () => <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /></svg>,
  Trash: () => <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>,
  Copy: () => <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"/><path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"/></svg>,
  Log:  () => <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" /></svg>,
  Scan: () => <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11 4a1 1 0 10-2 0v4a1 1 0 102 0V7zm-3 1a1 1 0 10-2 0v3a1 1 0 102 0V8zM8 9a1 1 0 00-2 0v2a1 1 0 102 0V9z" clipRule="evenodd" /></svg>,
  Preview: () => <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zm12.553 1.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z"/></svg>,
};

// ── Input type config ─────────────────────────────────────────────────
const INPUT_TYPES = [
  { value: 'v4l2', label: 'HDMI Card', color: 'bg-blue-100 text-blue-700 border-blue-200',   icon: '🖥', desc: '8-port HDMI PCIe card' },
  { value: 'dvb',  label: 'DVB-S2',   color: 'bg-purple-100 text-purple-700 border-purple-200', icon: '📡', desc: 'Satellite dish card' },
  { value: 'url',  label: 'URL/RTSP', color: 'bg-green-100 text-green-700 border-green-200', icon: '🌐', desc: 'Network stream URL' },
];

const INPUT_TYPE_MAP = Object.fromEntries(INPUT_TYPES.map(t => [t.value, t]));

// ── Status ────────────────────────────────────────────────────────────
const STATUS_STYLE = {
  live:     'bg-green-100 text-green-800 border-green-200',
  starting: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  stopped:  'bg-gray-100 text-gray-600 border-gray-200',
  error:    'bg-red-100 text-red-800 border-red-200',
};
const STATUS_DOT = {
  live: 'bg-green-500 animate-pulse', starting: 'bg-yellow-500 animate-pulse',
  stopped: 'bg-gray-400', error: 'bg-red-500',
};

function StatusBadge({ status, label }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[status] || STATUS_STYLE.stopped}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status] || STATUS_DOT.stopped}`} />
      {label}
    </span>
  );
}

function formatUptime(sec) {
  if (!sec) return null;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// CAT_COLOR — runtime-এ API থেকে categories fetch করে populate হবে
let CAT_COLOR = { other: 'bg-gray-100 text-gray-600' };
let CAT_NAME  = { other: 'অন্যান্য' };

// ── Channel Card ──────────────────────────────────────────────────────
const AVATAR_COLORS = ['#e50914','#0f79af','#2ecc71','#9b59b6','#e67e22','#1abc9c','#e74c3c','#3498db'];
const avatarColor = (name) => AVATAR_COLORS[(name?.charCodeAt(0) || 0) % AVATAR_COLORS.length];

// ms → color/dot helper
function _pingStyle(reachable, ms) {
  if (reachable === null || reachable === undefined || reachable === false)
    return { color: 'text-gray-400', dot: 'bg-gray-300' };
  if (ms < 200) return { color: 'text-green-600', dot: 'bg-green-500' };
  if (ms < 500) return { color: 'text-yellow-500', dot: 'bg-yellow-400' };
  return { color: 'text-red-500', dot: 'bg-red-500' };
}

// initialMs — channel.last_ping_ms (DB থেকে আসে, সাথে সাথে দেখায়, কখনো ●●● নয়)
function PingBadge({ channelId, inputType, hasBackups, initialMs, initialOk }) {
  // DB value দিয়ে শুরু করো — pending কখনো দেখাবে না
  const initResults = (inputType === 'url' && initialMs != null)
    ? [{ label: 'Primary', reachable: initialOk !== false, latency_ms: initialMs }]
    : null;

  const [results, setResults] = useState(initResults);
  const retryTimer = useRef(null);
  const historyRef = useRef({});

  const check = useCallback(async () => {
    if (inputType !== 'url') return;
    try {
      const endpoint = hasBackups
        ? `/livetv/channels/${channelId}/ping-all/`
        : `/livetv/channels/${channelId}/ping/`;
      const r = await api.get(endpoint);
      const d = r.data;

      // pending: background ping চলছে — 5s পরে retry, কিন্তু পুরনো result রাখো
      if (d.pending === true) {
        retryTimer.current = setTimeout(() => check(), 5000);
        return; // setResults করা হচ্ছে না — আগের value দেখাবে
      }

      let list;
      if (Array.isArray(d)) list = d;
      else if (Array.isArray(d.results)) list = d.results;
      else list = [{ label: 'Primary', ...d }];

      // moving average (3-reading smoothing)
      const smoothed = list.map(item => {
        if (item.latency_ms != null) {
          const key = item.url || String(channelId);
          const h = historyRef.current[key] || [];
          const newH = [...h.slice(-2), item.latency_ms];
          historyRef.current[key] = newH;
          const avg = Math.round(newH.reduce((a, b) => a + b, 0) / newH.length);
          return { ...item, latency_ms: avg };
        }
        return item;
      });
      setResults(smoothed);
    } catch {
      // error হলেও আগের value রাখো (null-এ যাবে না)
    }
  }, [channelId, inputType, hasBackups]);

  useEffect(() => {
    if (inputType !== 'url') return;
    // স্টার্ট stagger: 0–15s random delay
    const delay = Math.random() * 15000;
    const t0 = setTimeout(() => check(), delay);
    // 90s auto-refresh
    const t1 = setInterval(() => check(), 90_000);
    return () => {
      clearTimeout(t0);
      clearInterval(t1);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [check, inputType]);

  if (inputType !== 'url') return null;

  // results নেই মানে এই channel-এ এখনো কোনো ping হয়নি (নতুন channel)
  if (!results) {
    return <span className="text-xs text-gray-400 animate-pulse">●●●</span>;
  }

  const best = results.find(r => r.reachable) || results[0];
  const ms = best?.latency_ms;
  const reachable = best?.reachable;
  const { color, dot } = _pingStyle(reachable, ms);
  const label = !reachable ? 'Unreachable' : `${ms}ms`;
  const urlCount = results.length;
  const okCount  = results.filter(r => r.reachable).length;
  const tooltip  = results.map(r =>
    `${r.label}: ${r.reachable ? r.latency_ms + 'ms' : 'Unreachable'}`
  ).join(' | ') + ' — Click to recheck';

  return (
    <button onClick={() => check()} title={tooltip}
      className={`flex items-center gap-1 text-xs font-mono ${color} hover:opacity-75 transition-opacity`}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${dot} ${reachable && ms < 200 ? 'animate-pulse' : ''}`} />
      {label}
      {urlCount > 1 && (
        <span className="text-gray-400 font-sans">({okCount}/{urlCount})</span>
      )}
    </button>
  );
}

function ChannelCard({ channel, onStart, onStop, onEdit, onDelete, onLog, onPreview, onReorder, loading,
                       selectMode = false, selected = false, onToggleSelect }) {
  const [copied, setCopied] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [orderVal, setOrderVal] = useState(channel.sort_order);
  const [orderSaving, setOrderSaving] = useState(false);
  const isRunning = ['live', 'starting'].includes(channel.status);
  const inputCfg  = INPUT_TYPE_MAP[channel.input_type] || INPUT_TYPE_MAP.url;

  // বাইরে থেকে sort_order বদলালে (অন্য কার্ড রিওয়ার্ডার/রিফ্রেশে) input-ও sync রাখো
  useEffect(() => { setOrderVal(channel.sort_order); }, [channel.sort_order]);

  const commitOrder = () => {
    const n = Math.max(0, parseInt(orderVal, 10) || 0);
    setOrderVal(n);
    if (n === channel.sort_order) return;
    setOrderSaving(true);
    Promise.resolve(onReorder?.(channel.id, n)).finally(() => setOrderSaving(false));
  };

  // logo_url বদলালে error state reset করো
  useEffect(() => { setLogoError(false); }, [channel.logo_url]);

  const copyUrl = () => {
    navigator.clipboard.writeText(channel.hls_url || '').then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  };

  const sourceSummary = channel.input_type === 'v4l2'
    ? channel.device_path || 'device?'
    : channel.input_type === 'dvb'
    ? `Adapter ${channel.dvb_adapter} · ${(channel.dvb_frequency / 1000).toFixed(0)} MHz ${channel.dvb_polarization}`
    : channel.source_url || 'URL?';

  return (
    <div className={`relative bg-white rounded-xl border shadow-sm hover:shadow-md transition-shadow flex flex-col overflow-hidden ${
      selectMode && selected ? 'border-red-400 ring-2 ring-red-300' : 'border-gray-200'
    }`}>
      {/* Bulk-select checkbox (content-failed view) */}
      {selectMode && (
        <button onClick={() => onToggleSelect?.(channel.id)}
          title="ডিলিটের জন্য সিলেক্ট করুন"
          className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-md flex items-center justify-center text-sm font-bold border-2 transition-colors ${
            selected ? 'bg-red-600 border-red-600 text-white' : 'bg-white/90 border-gray-300 text-transparent hover:border-red-400'
          }`}>
          ✓
        </button>
      )}
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
        {/* সিরিয়াল নম্বর — এই নম্বর অনুযায়ীই মোবাইল অ্যাপের চ্যানেল লিস্টের অর্ডার হয়
            (TVChannel.sort_order, admin API ও app উভয়ই একই field দিয়ে sort করে —
            তাই এখানে বদলালে সরাসরি অ্যাপের লিস্টেও প্রতিফলিত হয়)। */}
        <input type="number" min="0" title="সিরিয়াল নম্বর (মোবাইল অ্যাপে এই ক্রমেই দেখাবে)"
          value={orderVal}
          onChange={e => setOrderVal(e.target.value)}
          onBlur={commitOrder}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          disabled={orderSaving}
          className={`w-11 h-8 shrink-0 text-center text-xs font-bold rounded-lg border outline-none
            ${orderSaving ? 'opacity-50' : ''} border-gray-300 text-gray-700 bg-white
            focus:border-blue-500 focus:ring-1 focus:ring-blue-500`} />
        <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 overflow-hidden"
          style={{ backgroundColor: channel.logo_url && !logoError ? '#1a1a2e' : avatarColor(channel.name) }}>
          {channel.logo_url && !logoError
            ? <img src={channel.logo_url_encoded || encodeURI(channel.logo_url)} alt={channel.name}
                className="w-full h-full object-contain p-1"
                onError={() => setLogoError(true)} />
            : <span className="text-white font-bold text-lg select-none">
                {channel.name?.charAt(0)?.toUpperCase() || '📺'}
              </span>
          }
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-800 truncate">{channel.name}</h3>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${CAT_COLOR[channel.category] || CAT_COLOR.other}`}>
              {channel.category_display}
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${inputCfg.color}`}>
              {inputCfg.icon} {inputCfg.label}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusBadge status={channel.status} label={channel.status_display} />
          <div className="flex items-center gap-1">
            <PingBadge channelId={channel.id} inputType={channel.input_type} hasBackups={(channel.extra_urls||[]).length > 0} initialMs={channel.last_ping_ms} initialOk={channel.last_ping_ok} />
            {channel.input_type === 'url' && channel.last_content_ok === true  && <span title="Video stream verified" className="text-green-500 text-xs">✓</span>}
            {channel.input_type === 'url' && channel.last_content_ok === false && <span title="No video content detected" className="text-red-500 text-xs font-bold">✗</span>}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 flex-1 space-y-2">
        {/* Source */}
        <div className="text-xs text-gray-500 font-mono bg-gray-50 px-2 py-1.5 rounded truncate" title={sourceSummary}>
          {sourceSummary}
        </div>

        {/* HLS URL */}
        {channel.hls_url && (
          <div className="flex items-center gap-2 bg-blue-50 rounded-lg px-2 py-1.5">
            <span className="text-xs text-blue-600 truncate flex-1 font-mono">{channel.hls_url}</span>
            <button onClick={copyUrl} className="text-blue-400 hover:text-blue-700 shrink-0" title="Copy URL">
              {copied ? <span className="text-green-600 text-xs font-bold">✓</span> : <Icons.Copy />}
            </button>
          </div>
        )}

        {/* Encoding stats */}
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>🎬 {channel.video_bitrate}k</span>
          <span>🎵 {channel.audio_bitrate}k</span>
          <span>{channel.resolution_display}</span>
          {channel.use_qsv && <span className="text-blue-600 font-medium">⚡ QSV</span>}
          {channel.direct_relay && (
            <span className="text-emerald-600 font-medium" title="FFmpeg ছাড়া সরাসরি সোর্স থেকে proxy হচ্ছে">
              🌿 Direct (No RAM)
            </span>
          )}
        </div>

        {channel.uptime_seconds && (
          <div className="text-xs text-green-600 font-medium">⏱ Uptime: {formatUptime(channel.uptime_seconds)}</div>
        )}
        {channel.status === 'error' && channel.error_message && (
          <div className="text-xs text-red-600 bg-red-50 rounded p-2 break-words line-clamp-2">⚠ {channel.error_message}</div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 p-3 border-t border-gray-100 bg-gray-50">
        {isRunning ? (
          <button onClick={() => onStop(channel)} disabled={loading}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50">
            <Icons.Stop /> Stop
          </button>
        ) : (
          <button onClick={() => onStart(channel)} disabled={loading}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50">
            <Icons.Play /> Start
          </button>
        )}
        {channel.hls_url && (
          <button onClick={() => onPreview(channel)} title="Preview Stream"
            className="p-1.5 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors">
            <Icons.Preview />
          </button>
        )}
        <button onClick={() => onLog(channel)} title="Log" className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"><Icons.Log /></button>
        <button onClick={() => onEdit(channel)} title="Edit" className="p-1.5 text-gray-500 hover:text-yellow-600 hover:bg-yellow-50 rounded-lg transition-colors"><Icons.Edit /></button>
        <button onClick={() => onDelete(channel)} title="Delete" className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Icons.Trash /></button>
      </div>
    </div>
  );
}

// ── PlayerModal ───────────────────────────────────────────────────────
// External URL → Django proxy URL (IP/domain যাই হোক)
// Browser-এর current origin থেকে আলাদা host হলেই proxy দিয়ে পাঠাও
function toProxyUrl(url) {
  if (!url) return url;
  try {
    const parsed = new URL(url, window.location.origin);
    // ভিন্ন host (external upstream) → proxy। একই host হলেও /media/hls/ (local FFmpeg
    // mirror) → proxy, কারণ ওই path nginx-এ deny all (127.0.0.1 ছাড়া) → সরাসরি হিট করলে 403।
    if (parsed.hostname !== window.location.hostname ||
        parsed.pathname.startsWith('/media/hls/')) {
      return `/api/v1/livetv/channels/hls-proxy/?url=${encodeURIComponent(url)}`;
    }
  } catch (_) {}
  return url;
}

// সেকেন্ড → mm:ss / hh:mm:ss ফরম্যাট
function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) return '00:00';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// নেটওয়ার্ক error-এ auto-retry backoff (ms) — ম্যানুয়াল error screen দেখানোর আগে কয়েকবার নিজে থেকেই চেষ্টা করবে
const AUTO_RETRY_DELAYS = [1000, 2000, 4000];

function PlayerModal({ channel, onClose, onStartTranscode }) {
  const containerRef = useRef(null);
  const videoRef      = useRef(null);
  const hlsRef        = useRef(null);
  const recoveredRef  = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef(null);
  const hideCtrlTimer  = useRef(null);

  const [error, setError]         = useState(null);
  const [errType, setErrType]     = useState(null); // 'network' | 'media' | 'other'
  const [quality, setQuality]     = useState({ level: -1, levels: [] });
  const [audioTracks, setAudioTracks] = useState({ tracks: [], current: -1 });
  const [buffering, setBuffering] = useState(true);
  const [retrying, setRetrying]   = useState(false);

  // player UI state
  const [playing, setPlaying]     = useState(true);
  const [muted, setMuted]         = useState(() => localStorage.getItem('livetv_muted') === '1');
  const [volume, setVolume]       = useState(() => Number(localStorage.getItem('livetv_volume') ?? 1));
  const [isLive, setIsLive]       = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showStats, setShowStats]  = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [stats, setStats]          = useState(null); // {bitrate, dropped, buffered, latency}

  const streamUrl = toProxyUrl(channel?.hls_url);

  const clearAutoRetry = () => {
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
  };

  const initPlayer = useCallback((isAutoRetry = false) => {
    if (!videoRef.current) return;
    clearAutoRetry();
    setError(null); setErrType(null); setBuffering(true); setRetrying(false);
    recoveredRef.current = false;
    if (!isAutoRetry) retryCountRef.current = 0;

    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

    if (Hls.isSupported()) {
      // hls-proxy public (SSRF-protected netloc allowlist দিয়ে secured) —
      // admin app-এ login-ই যথেষ্ট, প্লেয়ারে আলাদা token পাঠানোর দরকার নেই
      // (তাই দীর্ঘক্ষণ live দেখলেও token expire হয়ে playback বন্ধ হবে না)
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        // live edge-এর কাছাকাছি রাখা: target ৩ সেগমেন্ট পিছনে, ৫-এর বেশি পিছালে
        // (আমাদের mirror-এ list_size ৫) smooth ভাবে ১.৫x গতিতে catch-up করবে —
        // hard jump ছাড়াই ২০s live-gap ধীরে ধীরে কমে ~৯s-এ আসবে।
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 5,
        maxLiveSyncPlaybackRate: 1.5,
        // মসৃণ playback + memory: পুরনো buffer বেশি জমতে দেবে না, সামনে যথেষ্ট রাখবে
        backBufferLength: 15,
        maxBufferLength: 30,
        // frame drop কমাতে: decode-এ পিছিয়ে গেলে buffer flush করে live-এ ফিরবে
        manifestLoadingTimeOut: 15000,
        fragLoadingTimeOut: 20000,
      });
      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(videoRef.current);
      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        setQuality({ level: hls.currentLevel, levels: data.levels });
        retryCountRef.current = 0;
        videoRef.current?.play().catch(() => {});
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        setQuality(q => ({ ...q, level: data.level }));
      });
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
        setAudioTracks({ tracks: data.audioTracks || [], current: hls.audioTrack });
      });
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
        setAudioTracks(a => ({ ...a, current: data.id }));
      });
      hls.on(Hls.Events.FRAG_BUFFERED, () => setBuffering(false));
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        // mediaError → একবার auto-recover চেষ্টা করো
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredRef.current) {
          recoveredRef.current = true;
          hls.recoverMediaError();
          return;
        }
        // networkError → কয়েকবার silent auto-retry (backoff), তারপর error screen
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retryCountRef.current < AUTO_RETRY_DELAYS.length) {
          const delay = AUTO_RETRY_DELAYS[retryCountRef.current];
          retryCountRef.current += 1;
          setRetrying(true);
          retryTimerRef.current = setTimeout(() => initPlayer(true), delay);
          return;
        }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setErrType('network');
          setError('স্ট্রিম সার্ভার সাড়া দিচ্ছে না — চ্যানেল অফলাইন বা নেটওয়ার্ক সমস্যা।');
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          setErrType('media');
          setError('ভিডিও ডিকোড করা যাচ্ছে না — সম্ভবত H.265/HEVC কোডেক (ব্রাউজার সমর্থন করে না)।');
        } else {
          setErrType('other');
          setError(`স্ট্রিম ত্রুটি: ${data.details}`);
        }
      });
    } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari — নেটিভ HLS
      videoRef.current.src = streamUrl;
      videoRef.current.play().catch(() => {});
      setBuffering(false);
    } else {
      setErrType('other');
      setError('এই ব্রাউজারে HLS সাপোর্ট নেই।');
    }
  }, [streamUrl]);

  useEffect(() => {
    if (!channel) return;
    initPlayer();
    return () => {
      clearAutoRetry();
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [channel, initPlayer]);

  // ভিডিও element event → play/pause/buffering/live-edge state sync
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);
    const onTimeUpdate = () => {
      const seekable = v.seekable;
      if (seekable.length > 0) {
        const edge = seekable.end(seekable.length - 1);
        setIsLive(edge - v.currentTime < 8); // ৮ সেকেন্ডের মধ্যে থাকলে "লাইভ"
      }
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('playing', onPlaying);
    v.addEventListener('timeupdate', onTimeUpdate);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('timeupdate', onTimeUpdate);
    };
  }, [channel]);

  // ভলিউম/মিউট প্রয়োগ + persist
  useEffect(() => {
    if (videoRef.current) { videoRef.current.volume = volume; videoRef.current.muted = muted; }
    localStorage.setItem('livetv_muted', muted ? '1' : '0');
    localStorage.setItem('livetv_volume', String(volume));
  }, [volume, muted]);

  // fullscreen state track
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // stats overlay — প্রতি সেকেন্ডে বর্তমান bitrate/buffer/dropped frame আপডেট
  useEffect(() => {
    if (!showStats) return;
    const t = setInterval(() => {
      const v = videoRef.current;
      const hls = hlsRef.current;
      if (!v) return;
      const seekable = v.seekable;
      const buffered = v.buffered.length ? v.buffered.end(v.buffered.length - 1) - v.currentTime : 0;
      const dropped = v.getVideoPlaybackQuality?.().droppedVideoFrames ?? null;
      const level = hls?.levels?.[hls.currentLevel];
      // Resolution: আমাদের local mirror media-playlist (master নয়) — তাই hls.js-এর
      // level.width/height 0x0 আসে। আসল decoded ভিডিও dimension videoWidth/Height থেকে নাও।
      const vw = v.videoWidth || level?.width || 0;
      const vh = v.videoHeight || level?.height || 0;
      // Bitrate: level.bitrate না থাকলে (media playlist) hls.js-এর measured throughput নাও।
      const brBps = level?.bitrate || hls?.bandwidthEstimate || 0;
      setStats({
        bitrate: brBps ? Math.round(brBps / 1000) : null,
        resolution: (vw && vh) ? `${vw}x${vh}` : null,
        buffered: buffered.toFixed(1),
        dropped,
        liveGap: seekable.length ? (seekable.end(seekable.length - 1) - v.currentTime).toFixed(1) : null,
      });
    }, 1000);
    return () => clearInterval(t);
  }, [showStats]);

  // কী-বোর্ড শর্টকাট (space/m/f/↑/↓)
  useEffect(() => {
    const onKey = (e) => {
      if (!channel) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'm' || e.key === 'M') setMuted(m => !m);
      else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
      else if (e.key === 'ArrowUp') { e.preventDefault(); setVolume(v => Math.min(1, +(v + 0.1).toFixed(2))); setMuted(false); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setVolume(v => Math.max(0, +(v - 0.1).toFixed(2))); }
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  };

  const goLive = () => {
    const v = videoRef.current;
    const seekable = v?.seekable;
    if (v && seekable?.length) v.currentTime = seekable.end(seekable.length - 1) - 0.5;
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else containerRef.current.requestFullscreen().catch(() => {});
  };

  const togglePiP = async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (videoRef.current) await videoRef.current.requestPictureInPicture();
    } catch { /* PiP অসমর্থিত */ }
  };

  const wakeControls = () => {
    setShowControls(true);
    if (hideCtrlTimer.current) clearTimeout(hideCtrlTimer.current);
    hideCtrlTimer.current = setTimeout(() => setShowControls(false), 3000);
  };
  useEffect(() => () => { if (hideCtrlTimer.current) clearTimeout(hideCtrlTimer.current); }, []);

  const copyUrl = () => {
    navigator.clipboard.writeText(channel?.hls_url || '').then(() => toast.success('URL copied!'));
  };

  if (!channel) return null;

  const currentLevel = quality.levels[quality.level];
  const qualityLabel = currentLevel
    ? `${currentLevel.height}p · ${Math.round(currentLevel.bitrate / 1000)}k`
    : 'Auto';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-gray-900 rounded-2xl overflow-hidden w-full max-w-3xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-gray-800 border-b border-gray-700">
          <div className="w-7 h-7 rounded bg-gray-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
            {channel.name?.charAt(0)?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{channel.name}</p>
            <p className="text-xs text-gray-400 truncate font-mono">{streamUrl}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {quality.levels.length > 0 && (
              <span className="text-xs bg-purple-700 text-purple-100 px-2 py-0.5 rounded-full font-medium">
                {qualityLabel}
              </span>
            )}
            <button onClick={() => setShowStats(s => !s)} title="Stream stats"
              className={`text-xs px-2 py-0.5 rounded-full font-medium border transition-colors ${showStats ? 'bg-blue-700 border-blue-500 text-blue-100' : 'border-gray-600 text-gray-400 hover:border-gray-400'}`}>
              ⓘ
            </button>
            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${isLive ? 'bg-green-700 text-green-100' : 'bg-gray-700 text-gray-300'}`}>
              <span className={`w-1.5 h-1.5 rounded-full inline-block ${isLive ? 'bg-green-300 animate-pulse' : 'bg-gray-400'}`} />
              LIVE
            </span>
            <button onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors ml-1 text-lg leading-none">✕</button>
          </div>
        </div>

        {/* Video */}
        <div ref={containerRef} className="relative bg-black group" style={{ aspectRatio: '16/9' }}
          onMouseMove={wakeControls} onClick={wakeControls}>
          {error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
              <span className="text-5xl">{errType === 'media' ? '🎬' : '📡'}</span>
              <div>
                <p className="text-red-400 font-semibold text-sm mb-1">{error}</p>
                {errType === 'media' && (
                  <p className="text-gray-500 text-xs">চ্যানেলের encoding settings-এ resolution passthrough বা H.264 re-encode চালু করুন।</p>
                )}
                {errType === 'network' && (
                  <p className="text-gray-500 text-xs">চ্যানেল stop করে আবার start করুন, অথবা source URL আপডেট করুন।</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-center">
                <button onClick={() => initPlayer()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">
                  🔄 Retry
                </button>
                {errType === 'media' && channel?.input_type === 'url' && (
                  <button onClick={async () => {
                    try {
                      await api.post(`/livetv/channels/${channel.id}/transcode/`);
                      onClose();
                      toast.success(`${channel.name}: H.264 Transcode শুরু হয়েছে। ৫-১০ সেকেন্ড পর preview করুন।`);
                    } catch (e) {
                      toast.error(e.response?.data?.detail || 'Transcode শুরু করা যায়নি।');
                    }
                  }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium">
                    ⚡ H.264 Transcode চালু করুন
                  </button>
                )}
                <button onClick={copyUrl}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors">
                  📋 Copy URL
                </button>
                <a href={`vlc://${channel?.hls_url}`}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-orange-700 hover:bg-orange-600 text-white rounded-lg transition-colors">
                  ▶ VLC-তে খুলুন
                </a>
              </div>
            </div>
          ) : (
            <>
              <video ref={videoRef} autoPlay muted={muted}
                className="w-full h-full object-contain"
                style={{ background: '#000' }}
                onClick={togglePlay}
              />

              {/* Buffering / auto-retry spinner */}
              {(buffering || retrying) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none bg-black/20">
                  <div className="w-10 h-10 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                  {retrying && <span className="text-xs text-white/80">সংযোগ পুনরায় চেষ্টা করা হচ্ছে…</span>}
                </div>
              )}

              {/* Stats overlay */}
              {showStats && stats && (
                <div className="absolute top-2 left-2 bg-black/70 text-green-400 text-[10px] font-mono rounded-lg px-2.5 py-2 space-y-0.5 pointer-events-none">
                  <div>Resolution: {stats.resolution || '—'}</div>
                  <div>Bitrate: {stats.bitrate ? `${stats.bitrate} kbps` : '—'}</div>
                  <div>Buffer: {stats.buffered}s</div>
                  <div>Live gap: {stats.liveGap}s</div>
                  {stats.dropped !== null && <div>Dropped frames: {stats.dropped}</div>}
                </div>
              )}

              {/* Custom control bar */}
              <div className={`absolute bottom-0 left-0 right-0 flex items-center gap-3 px-3 py-2 bg-gradient-to-t from-black/85 to-transparent transition-opacity duration-200 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
                <button onClick={togglePlay} className="text-white hover:text-blue-400 transition-colors" title={playing ? 'Pause (Space)' : 'Play (Space)'}>
                  {playing ? '⏸' : '▶'}
                </button>

                <button onClick={() => setMuted(m => !m)} className="text-white hover:text-blue-400 transition-colors" title="Mute (M)">
                  {muted || volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}
                </button>
                <input type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume}
                  onChange={e => { setVolume(+e.target.value); setMuted(false); }}
                  className="w-16 accent-blue-500" title="Volume (↑/↓)" />

                {!isLive && (
                  <button onClick={goLive} className="text-xs bg-red-600 hover:bg-red-700 text-white px-2 py-0.5 rounded-full font-medium">
                    ⏵ Go Live
                  </button>
                )}

                <span className="flex-1" />

                {audioTracks.tracks.length > 1 && (
                  <select value={audioTracks.current}
                    onChange={e => { if (hlsRef.current) hlsRef.current.audioTrack = +e.target.value; }}
                    className="bg-gray-800 text-white text-xs rounded px-1.5 py-1 border border-gray-600" title="Audio track">
                    {audioTracks.tracks.map((t, i) => (
                      <option key={i} value={i}>{t.name || t.lang || `Audio ${i + 1}`}</option>
                    ))}
                  </select>
                )}

                <button onClick={togglePiP} className="text-white hover:text-blue-400 transition-colors" title="Picture-in-Picture">
                  ⧉
                </button>
                <button onClick={toggleFullscreen} className="text-white hover:text-blue-400 transition-colors" title="Fullscreen (F)">
                  {isFullscreen ? '⤢' : '⛶'}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Quality levels */}
        {quality.levels.length > 1 && (
          <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 border-t border-gray-700 overflow-x-auto">
            <span className="text-xs text-gray-400 shrink-0">Quality:</span>
            <button
              onClick={() => { if (hlsRef.current) { hlsRef.current.currentLevel = -1; setQuality(q => ({...q, level: -1})); } }}
              className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${quality.level === -1 ? 'bg-purple-600 border-purple-500 text-white' : 'border-gray-600 text-gray-300 hover:border-purple-500'}`}>
              Auto
            </button>
            {quality.levels.map((l, i) => (
              <button key={i}
                onClick={() => { if (hlsRef.current) { hlsRef.current.currentLevel = i; setQuality(q => ({...q, level: i})); } }}
                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${quality.level === i ? 'bg-purple-600 border-purple-500 text-white' : 'border-gray-600 text-gray-300 hover:border-purple-500'}`}>
                {l.height}p
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Toggle Switch ─────────────────────────────────────────────────────
function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <div
        role="switch"
        aria-checked={checked}
        tabIndex={0}
        onClick={() => onChange(!checked)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(!checked); } }}
        className={`relative w-10 h-5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1 ${checked ? 'bg-blue-600' : 'bg-gray-300'}`}>
        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${checked ? 'left-5' : 'left-0.5'}`} />
      </div>
      <span className="text-xs font-medium text-gray-700">{label}</span>
    </label>
  );
}

// ── ChannelModal ──────────────────────────────────────────────────────
const EMPTY_FORM = {
  name: '', category: 'other', logo_url: '', description: '',
  input_type: 'v4l2',
  // V4L2
  device_path: '', audio_device: '', framerate: '25',
  // DVB
  dvb_adapter: 0, dvb_frequency: 11538000, dvb_symbol_rate: 27500,
  dvb_polarization: 'H', dvb_video_pid: 0, dvb_audio_pid: 0,
  // URL
  source_url: '',
  extra_urls: [], // [{label, url}]
  direct_relay: false,
  // Encoding
  resolution: '1920x1080', video_bitrate: 2500, audio_bitrate: 128,
  use_qsv: true, hls_segment_time: 3, hls_list_size: 5,
  is_active: true, sort_order: 0,
};

function ChannelModal({ open, onClose, onSave, initial, categories = [] }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [devices, setDevices] = useState({ v4l2: [], dvb: [], alsa: [] });
  const [scanning, setScanning] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);

  useEffect(() => {
    if (open) setForm(initial ? { ...EMPTY_FORM, ...initial } : EMPTY_FORM);
  }, [open, initial]);

  if (!open) return null;

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const scanDevices = async () => {
    setScanning(true);
    try {
      const r = await api.get('/livetv/channels/scan-devices/');
      setDevices(r.data);
      const total = (r.data.v4l2?.length || 0) + (r.data.dvb?.length || 0);
      toast.success(`${total} hardware device(s) found.`);
    } catch {
      toast.error('Hardware scan failed.');
    } finally {
      setScanning(false);
    }
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      const r = await api.post('/livetv/channels/upload-logo/', fd);
      set('logo_url', r.data.url);
      toast.success('Logo upload হয়েছে।');
    } catch {
      toast.error('Logo upload failed.');
    } finally {
      setLogoUploading(false);
      e.target.value = '';
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Please enter a channel name.'); return; }
    if (form.input_type === 'v4l2' && !form.device_path) { toast.error('Please enter a V4L2 device path.'); return; }
    if (form.input_type === 'url' && !form.source_url) { toast.error('Please enter a source URL.'); return; }
    setSaving(true);
    // input_type অনুযায়ী অপ্রয়োজনীয় fields পাঠাবো না
    const payload = { ...form };
    if (form.input_type === 'url') {
      payload.device_path = ''; payload.audio_device = '';
      payload.dvb_adapter = 0; payload.dvb_frequency = 0; payload.dvb_symbol_rate = 0;
      payload.dvb_video_pid = 0; payload.dvb_audio_pid = 0;
    } else if (form.input_type === 'dvb') {
      payload.device_path = ''; payload.audio_device = '';
      payload.source_url = ''; payload.direct_relay = false;
    } else {
      payload.source_url = ''; payload.direct_relay = false;
      payload.dvb_adapter = 0; payload.dvb_frequency = 0; payload.dvb_symbol_rate = 0;
      payload.dvb_video_pid = 0; payload.dvb_audio_pid = 0;
    }
    try { await onSave(payload); onClose(); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white z-10">
          <h2 className="text-base font-semibold text-gray-800">
            {initial ? 'Edit Channel' : 'Add New Channel'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">

          {/* Name + Category */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Channel Name *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                placeholder="e.g. NTV" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
              <select value={form.category} onChange={e => set('category', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400">
                {(categories.length > 0 ? categories : [{ slug: 'other', name: 'অন্যান্য' }])
                  .map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>
            </div>
          </div>

          {/* Input type selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-700">Input Source Type</label>
              <button type="button" onClick={scanDevices} disabled={scanning}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50">
                <Icons.Scan />{scanning ? 'Scanning...' : 'Scan Hardware'}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {INPUT_TYPES.map(t => (
                <button key={t.value} type="button"
                  onClick={() => set('input_type', t.value)}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 text-xs font-medium transition-all
                    ${form.input_type === t.value
                      ? 'border-gray-700 bg-gray-50 text-gray-800'
                      : 'border-gray-200 text-gray-500 hover:border-gray-400'}`}>
                  <span className="text-2xl">{t.icon}</span>
                  <span className="font-semibold">{t.label}</span>
                  <span className="text-gray-400 text-center leading-tight">{t.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* V4L2 Settings */}
          {form.input_type === 'v4l2' && (
            <div className="bg-blue-50 rounded-xl p-4 space-y-3">
              <h3 className="text-xs font-semibold text-blue-800 flex items-center gap-1.5">🖥 HDMI Capture Card (V4L2)</h3>

              {devices.v4l2.length > 0 ? (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Select Device</label>
                  <select value={form.device_path} onChange={e => set('device_path', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                    <option value="">-- Select a device --</option>
                    {devices.v4l2.map(d => (
                      <option key={d.path} value={d.path}>{d.path} — {d.name}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Device Path *</label>
                  <input value={form.device_path} onChange={e => set('device_path', e.target.value)}
                    className={`w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 ${/^https?:\/\/|^rtsp:\/\/|^rtmp:\/\//i.test(form.device_path) ? 'border-orange-400 focus:ring-orange-400' : 'border-gray-300 focus:ring-blue-400'}`}
                    placeholder="/dev/video0  (8-port card: /dev/video0…video7)" />
                  {/^https?:\/\/|^rtsp:\/\/|^rtmp:\/\//i.test(form.device_path) ? (
                    <div className="mt-1 flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                      <span className="text-orange-600 text-xs">⚠️ This looks like a stream URL. Did you mean to use the URL/RTSP tab?</span>
                      <button type="button" onClick={() => { set('source_url', form.device_path); set('device_path', ''); set('input_type', 'url'); }}
                        className="ml-auto text-xs bg-orange-500 text-white px-2 py-1 rounded-md hover:bg-orange-600 whitespace-nowrap">
                        Switch to URL/RTSP →
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-blue-600 mt-1">💡 Click "Scan Hardware" to list available devices</p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Frame Rate</label>
                  <select value={form.framerate} onChange={e => set('framerate', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                    {[['25','25 fps (PAL)'],['30','30 fps'],['50','50 fps'],['60','60 fps']].map(([v,l]) =>
                      <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">ALSA Audio (optional)</label>
                  <input value={form.audio_device} onChange={e => set('audio_device', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder="hw:1,0  (blank = embedded)" />
                </div>
              </div>
            </div>
          )}

          {/* DVB Settings */}
          {form.input_type === 'dvb' && (
            <div className="bg-purple-50 rounded-xl p-4 space-y-3">
              <h3 className="text-xs font-semibold text-purple-800 flex items-center gap-1.5">📡 DVB-S2 Satellite Card</h3>

              {devices.dvb.length > 0 ? (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Select Card</label>
                  <select value={form.dvb_adapter} onChange={e => set('dvb_adapter', +e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
                    {devices.dvb.map(d => (
                      <option key={d.adapter} value={d.adapter}>Adapter {d.adapter} — {d.name} ({d.type})</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Adapter Number</label>
                  <input type="number" value={form.dvb_adapter} onChange={e => set('dvb_adapter', +e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                    min="0" max="7" placeholder="0 = first card" />
                  <p className="text-xs text-purple-600 mt-1">💡 Click "Scan Hardware" to list installed cards</p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Frequency (KHz)</label>
                  <input type="number" value={form.dvb_frequency} onChange={e => set('dvb_frequency', +e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                    placeholder="11538000" />
                  <p className="text-xs text-gray-400 mt-0.5">11538 MHz = 11538000</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Symbol Rate</label>
                  <input type="number" value={form.dvb_symbol_rate} onChange={e => set('dvb_symbol_rate', +e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                    placeholder="27500" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Polarization</label>
                  <select value={form.dvb_polarization} onChange={e => set('dvb_polarization', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
                    {[['H','H (Horizontal)'],['V','V (Vertical)'],['L','L (Left)'],['R','R (Right)']].map(([v,l]) =>
                      <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Video PID (0=auto)</label>
                  <input type="number" value={form.dvb_video_pid} onChange={e => set('dvb_video_pid', +e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" min="0" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Audio PID (0=auto)</label>
                  <input type="number" value={form.dvb_audio_pid} onChange={e => set('dvb_audio_pid', +e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" min="0" />
                </div>
              </div>

              <div className="bg-purple-100 rounded-lg p-2 text-xs text-purple-700">
                📌 When DVB-S2 card is installed, run:<br />
                <code className="bg-purple-200 px-1 rounded">apt install dvb-tools v4l-utils</code>
              </div>
            </div>
          )}

          {/* URL Settings */}
          {form.input_type === 'url' && (
            <div className="bg-green-50 rounded-xl p-4 space-y-3">
              <h3 className="text-xs font-semibold text-green-800">🌐 Network Stream URLs</h3>

              {/* Primary URL */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Primary URL * <span className="text-green-600 font-normal">(সবচেয়ে ভালো লিংক)</span>
                </label>
                <input value={form.source_url} onChange={e => set('source_url', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-400"
                  placeholder="rtsp://… or http://… or udp://239.0.0.1:1234" />
                <p className="text-xs text-green-600 mt-1">
                  Tvheadend: <code className="bg-green-100 px-1 rounded">http://localhost:9981/stream/channel/&lt;UUID&gt;</code>
                </p>
              </div>

              {/* Backup URLs */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-700">Backup URLs <span className="text-gray-400 font-normal">(auto-failover)</span></label>
                  <button type="button"
                    onClick={() => set('extra_urls', [...(form.extra_urls||[]), {label:'Backup '+(((form.extra_urls||[]).length)+1), url:''}])}
                    className="text-xs bg-green-600 text-white px-2 py-1 rounded-lg hover:bg-green-700">
                    + Add Backup
                  </button>
                </div>
                {(form.extra_urls||[]).length === 0 && (
                  <p className="text-xs text-gray-400 italic">No backup URLs. Primary fail হলে stream যাবে না।</p>
                )}
                <div className="space-y-2">
                  {(form.extra_urls||[]).map((item, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <input value={item.label||''} onChange={e => {
                          const u=[...(form.extra_urls||[])]; u[idx]={...u[idx],label:e.target.value}; set('extra_urls',u);
                        }}
                        className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"
                        placeholder="Label" />
                      <input value={item.url||''} onChange={e => {
                          const u=[...(form.extra_urls||[])]; u[idx]={...u[idx],url:e.target.value}; set('extra_urls',u);
                        }}
                        className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-green-400"
                        placeholder="https://... or rtsp://..." />
                      <button type="button" onClick={() => {
                          const u=[...(form.extra_urls||[])]; u.splice(idx,1); set('extra_urls',u);
                        }}
                        className="text-red-400 hover:text-red-600 text-sm px-1">✕</button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Direct-source mode — কোনো local FFmpeg mirror ছাড়া সরাসরি সোর্স proxy */}
              <div className="border-t border-green-200 pt-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-gray-700">সরাসরি সোর্স (No FFmpeg)</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    চালু থাকলে local FFmpeg mirror ছাড়াই সরাসরি সোর্স URL থেকে proxy করে দেখানো হবে —
                    RAM/CPU খরচ প্রায় শূন্য। শুধু browser-compatible (H.264/AAC) সোর্সে কাজ করবে;
                    HEVC/exotic codec হলে বন্ধ রেখে আগের মতো Transcode ব্যবহার করুন।
                  </p>
                </div>
                <Toggle checked={form.direct_relay} onChange={v => set('direct_relay', v)} />
              </div>
            </div>
          )}

          {/* Logo + Description */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Logo URL</label>
              <div className="flex gap-2 items-center">
                <div className="w-10 h-10 rounded-lg shrink-0 flex items-center justify-center overflow-hidden border border-gray-200 bg-gray-800">
                  {form.logo_url
                    ? <img src={encodeURI(form.logo_url)} className="w-full h-full object-contain p-0.5"
                        onError={e => { e.target.style.display='none'; }} alt="" />
                    : <span className="text-gray-400 text-xs">📺</span>}
                </div>
                <div className="flex-1 space-y-1">
                  <input value={form.logo_url} onChange={e => set('logo_url', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                    placeholder="https://... অথবা নিচে upload করুন" />
                  <label className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border cursor-pointer transition-colors
                    ${logoUploading ? 'bg-gray-100 text-gray-400' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                    {logoUploading ? '⏳ Uploading...' : '📁 Upload Image'}
                    <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} disabled={logoUploading} />
                  </label>
                </div>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
              <input value={form.description} onChange={e => set('description', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" />
            </div>
          </div>

          {/* Encoding */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-4">
            <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Encoding Settings</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Resolution</label>
                <select value={form.resolution} onChange={e => set('resolution', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400">
                  {[['1920x1080','1080p Full HD'],['1280x720','720p HD'],['854x480','480p SD'],
                    ['640x360','360p'],['passthrough','Passthrough (no re-encode)']].map(([v,l]) =>
                    <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Video Bitrate (kbps)</label>
                <input type="number" value={form.video_bitrate} onChange={e => set('video_bitrate', +e.target.value)}
                  disabled={form.resolution === 'passthrough'}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:bg-gray-100"
                  min="500" max="8000" step="100" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Audio (kbps)</label>
                <input type="number" value={form.audio_bitrate} onChange={e => set('audio_bitrate', +e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  min="64" max="320" step="32" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Segment (sec)</label>
                <input type="number" value={form.hls_segment_time} onChange={e => set('hls_segment_time', +e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  min="1" max="10" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">List Size</label>
                <input type="number" value={form.hls_list_size} onChange={e => set('hls_list_size', +e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  min="2" max="20" />
              </div>
            </div>
            <Toggle checked={form.use_qsv} onChange={v => set('use_qsv', v)}
              label="Intel QSV Hardware Encode — CPU usage only 5–10%" />
          </div>

          {/* Sort order */}
          <div className="flex items-center gap-4">
            <div className="w-32">
              <label className="block text-xs font-medium text-gray-700 mb-1">Sort Order</label>
              <input type="number" value={form.sort_order} onChange={e => set('sort_order', +e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" min="0" />
            </div>
            <div className="flex items-end pb-2">
              <Toggle checked={form.is_active} onChange={v => set('is_active', v)} label="Active" />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 text-sm font-medium text-white bg-gray-800 hover:bg-gray-900 rounded-lg transition-colors disabled:opacity-50 min-w-[80px]">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Color presets ─────────────────────────────────────────────────────
const COLOR_PRESETS = [
  { label: 'Blue',   value: 'bg-blue-100 text-blue-700' },
  { label: 'Purple', value: 'bg-purple-100 text-purple-700' },
  { label: 'Orange', value: 'bg-orange-100 text-orange-700' },
  { label: 'Green',  value: 'bg-emerald-100 text-emerald-700' },
  { label: 'Sky',    value: 'bg-sky-100 text-sky-700' },
  { label: 'Pink',   value: 'bg-pink-100 text-pink-700' },
  { label: 'Red',    value: 'bg-red-100 text-red-700' },
  { label: 'Yellow', value: 'bg-yellow-100 text-yellow-700' },
  { label: 'Gray',   value: 'bg-gray-100 text-gray-600' },
];

// ── Category Modal ────────────────────────────────────────────────────
function CategoryModal({ open, onClose, onDone }) {
  const [cats, setCats]         = useState([]);
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [form, setForm]         = useState({ slug: '', name: '', color: COLOR_PRESETS[0].value, sort_order: 0 });
  const [editSlug, setEditSlug] = useState(null); // null=add, slug=edit

  const load = async () => {
    setLoading(true);
    try { const r = await api.get('/livetv/categories/'); setCats(r.data); }
    catch { toast.error('Category load failed.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (open) load(); }, [open]);

  if (!open) return null;

  const resetForm = () => { setForm({ slug: '', name: '', color: COLOR_PRESETS[0].value, sort_order: 0 }); setEditSlug(null); };

  const startEdit = (cat) => {
    setForm({ slug: cat.slug, name: cat.name, color: cat.color, sort_order: cat.sort_order });
    setEditSlug(cat.slug);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Please enter a category name.'); return; }
    setSaving(true);
    try {
      if (editSlug) {
        await api.put(`/livetv/categories/${editSlug}/`, form);
        toast.success('Category updated.');
      } else {
        const autoSlug = form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        await api.post('/livetv/categories/', { ...form, slug: autoSlug });
        toast.success('Category added.');
      }
      resetForm();
      load();
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.detail || JSON.stringify(err.response?.data) || 'Error');
    } finally { setSaving(false); }
  };

  const handleDelete = async (cat) => {
    if (cat.channel_count > 0) {
      toast.error(`${cat.channel_count} channel(s) use this category. Reassign them first.`);
      return;
    }
    setDeleting(cat.slug);
    try {
      await api.delete(`/livetv/categories/${cat.slug}/`);
      toast.success('Category deleted.');
      load(); onDone();
    } catch { toast.error('Delete failed.'); }
    finally { setDeleting(null); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <h2 className="text-base font-semibold text-gray-800">📂 Category ম্যানেজমেন্ট</h2>
          <button onClick={() => { resetForm(); onClose(); }} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Add/Edit form */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
            <h3 className="text-sm font-medium text-gray-700 mb-3">
              {editSlug ? '✏️ Edit Category' : '➕ New Category'}
            </h3>
            <form onSubmit={handleSave} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                    placeholder="e.g. Documentary" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Sort Order</label>
                  <input type="number" value={form.sort_order}
                    onChange={e => setForm(f => ({ ...f, sort_order: +e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                    min="0" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Color</label>
                <div className="flex flex-wrap gap-2">
                  {COLOR_PRESETS.map(p => (
                    <button key={p.value} type="button"
                      onClick={() => setForm(f => ({ ...f, color: p.value }))}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border-2 transition-all ${p.value}
                        ${form.color === p.value ? 'border-gray-700 scale-105' : 'border-transparent'}`}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button type="submit" disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-white bg-gray-800 hover:bg-gray-900 rounded-lg disabled:opacity-50">
                  {saving ? 'Saving...' : editSlug ? 'Update' : 'Add'}
                </button>
                {editSlug && (
                  <button type="button" onClick={resetForm}
                    className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
                    Cancel
                  </button>
                )}
                {form.name && (
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${form.color}`}>
                    {form.name} preview
                  </span>
                )}
              </div>
            </form>
          </div>

          {/* Category list */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Existing Categories</h3>
            {loading ? (
              <div className="text-center py-8 text-gray-400 text-sm">Loading...</div>
            ) : (
              <div className="space-y-2">
                {cats.map(cat => (
                  <div key={cat.slug}
                    className={`flex items-center justify-between px-4 py-3 rounded-xl border ${editSlug === cat.slug ? 'border-gray-400 bg-gray-50' : 'border-gray-100 bg-white'}`}>
                    <div className="flex items-center gap-3">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${cat.color}`}>{cat.name}</span>
                      <span className="text-xs text-gray-400 font-mono">{cat.slug}</span>
                      <span className="text-xs text-gray-400">{cat.channel_count} channels</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => startEdit(cat)}
                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                        <Icons.Edit />
                      </button>
                      <button onClick={() => handleDelete(cat)} disabled={deleting === cat.slug}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40">
                        <Icons.Trash />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Log Modal ──────────────────────────────────────────────────────────
function LogModal({ open, channel, onClose }) {
  const [log, setLog] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || !channel) return;
    setLoading(true);
    api.get(`/livetv/channels/${channel.id}/log/?lines=100`)
      .then(r => setLog(r.data.log || '(no log available)'))
      .catch(() => setLog('Failed to load log.'))
      .finally(() => setLoading(false));
  }, [open, channel]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
          <h2 className="text-sm font-medium text-gray-200">FFmpeg Log — {channel?.name} <span className="text-xs text-gray-500">({channel?.input_type_display})</span></h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-xl">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading
            ? <div className="text-gray-500 text-xs animate-pulse">Loading...</div>
            : <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap break-words leading-relaxed">{log}</pre>}
        </div>
      </div>
    </div>
  );
}

// ── Delete Modal ───────────────────────────────────────────────────────
function DeleteModal({ open, channel, onConfirm, onClose, loading }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="text-base font-semibold text-gray-800 mb-2">Delete Channel?</h3>
        <p className="text-sm text-gray-600 mb-5">
          <strong>{channel?.name}</strong> will be permanently deleted.
          {channel?.status === 'live' && ' The active stream will be stopped.'}
        </p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={onConfirm} disabled={loading}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50">
            {loading ? 'Deleting...' : 'Yes, Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Bulk Delete Modal ──────────────────────────────────────────────────
function BulkDeleteModal({ open, count, onConfirm, onClose, loading }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="text-base font-semibold text-gray-800 mb-2">{count} টি চ্যানেল ডিলিট করবেন?</h3>
        <p className="text-sm text-gray-600 mb-5">
          সিলেক্ট করা <strong>{count} টি চ্যানেল</strong> স্থায়ীভাবে মুছে যাবে। চালু থাকলে স্ট্রিম বন্ধ হবে।
          এটা <strong>ফিরিয়ে আনা যাবে না</strong>।
        </p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">বাতিল</button>
          <button onClick={onConfirm} disabled={loading}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50">
            {loading ? 'ডিলিট হচ্ছে...' : `হ্যাঁ, ${count} টি ডিলিট`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Import Playlist Modal ──────────────────────────────────────────────
const FORMAT_LABELS = {
  m3u: 'M3U/M3U8', json: 'JSON', csv: 'CSV', xspf: 'XSPF', txt: 'URL List',
};
const CAT_LABELS = {
  news:'News', entertainment:'Entertainment', sports:'Sports',
  religious:'Religious', international:'International', music:'Music', other:'Other',
};

function PingBadgeInline({ ms, pinging }) {
  if (pinging) return <span className="text-gray-400 text-[10px] animate-pulse">pinging…</span>;
  if (ms === undefined) return null;
  if (ms === null) return <span className="text-[10px] font-semibold text-red-500">✗ offline</span>;
  const color = ms < 300 ? 'text-green-600' : ms < 800 ? 'text-yellow-600' : 'text-orange-600';
  return <span className={`text-[10px] font-bold ${color}`}>{ms}ms</span>;
}

function ImportModal({ open, onClose, onDone }) {
  const [tab, setTab]           = useState('url');
  const [urlVal, setUrlVal]     = useState('');
  const [fileObj, setFileObj]   = useState(null);
  const [textVal, setTextVal]   = useState('');
  const [previewing, setPrev]   = useState(false);
  const [importing, setImport]  = useState(false);
  const [preview, setPreview]   = useState(null);      // {format, total, channels:[]}
  const [sortedRows, setSorted] = useState([]);         // [{origIdx, ch, ms}]
  const [selected, setSelected] = useState(new Set());  // Set of origIdx
  const [skipDupes, setSkipDupes] = useState(true);
  const [pinging, setPinging]   = useState(false);
  const [pingMap, setPingMap]   = useState({});         // url→ms|null
  const [sortBy, setSortBy]     = useState('speed');    // 'speed' | 'name' | 'original'

  // buildRows — early return-এর আগে define করতে হবে (useEffect-এ ব্যবহার হয়)
  const buildRows = (channels, pMap, sort) => {
    const rows = channels.map((ch, origIdx) => ({
      origIdx, ch, ms: pMap[ch.source_url],
    }));
    if (sort === 'speed') {
      rows.sort((a, b) => {
        const am = a.ms ?? 99999, bm = b.ms ?? 99999;
        return am - bm;
      });
    } else if (sort === 'name') {
      rows.sort((a, b) => a.ch.name.localeCompare(b.ch.name));
    }
    return rows;
  };

  useEffect(() => {
    if (open) {
      setPreview(null); setSorted([]); setSelected(new Set());
      setUrlVal(''); setFileObj(null); setTextVal(''); setTab('url');
      setPingMap({}); setPinging(false); setSortBy('speed');
    }
  }, [open]);

  // pingMap আপডেট হলে rows re-sort করো — early return-এর আগে থাকা আবশ্যিক (hooks rule)
  useEffect(() => {
    if (!preview) return;
    setSorted(buildRows(preview.channels, pingMap, sortBy));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pingMap, sortBy, preview]);

  if (!open) return null;

  const buildFormData = () => {
    const fd = new FormData();
    if (tab === 'url')  fd.append('url',  urlVal);
    if (tab === 'file' && fileObj) fd.append('file', fileObj);
    if (tab === 'text') fd.append('text', textVal);
    return fd;
  };

  const runPing = async (channels) => {
    const urls = [...new Set(channels.map(c => c.source_url).filter(Boolean))];
    if (!urls.length) return;
    setPinging(true);
    try {
      const CHUNK = 50;
      let allResults = {};
      for (let i = 0; i < urls.length; i += CHUNK) {
        const chunk = urls.slice(i, i + CHUNK);
        try {
          const r = await api.post('/livetv/channels/batch-ping/', { urls: chunk });
          allResults = { ...allResults, ...r.data };
          setPingMap(prev => {
            const next = { ...prev };
            chunk.forEach(u => { next[u] = r.data[u]?.ok ? r.data[u].ms : null; });
            return next;
          });
        } catch { break; }
      }
    } finally { setPinging(false); }
  };

  const handlePreview = async () => {
    setPrev(true);
    try {
      const r = await api.post('/livetv/channels/parse-playlist/', buildFormData());
      const data = r.data;
      if (data.total === 0) {
        toast.error('কোনো চ্যানেল পাওয়া যায়নি। ফরম্যাট চেক করুন।');
        return;
      }
      setPreview(data);
      setPingMap({});
      const initialRows = buildRows(data.channels, {}, 'original');
      setSorted(initialRows);
      setSelected(new Set(initialRows.map(r => r.origIdx)));
      toast.success(`${data.total} চ্যানেল পাওয়া গেছে (${FORMAT_LABELS[data.format] || data.format}) — speed check চলছে…`);
      // background ping
      runPing(data.channels).then(() => {});
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Playlist parse করা যায়নি।');
    } finally { setPrev(false); }
  };

  const toggleAll = () => {
    if (selected.size === sortedRows.length) setSelected(new Set());
    else setSelected(new Set(sortedRows.map(r => r.origIdx)));
  };

  const handleImport = async () => {
    if (selected.size === 0) { toast.error('কমপক্ষে একটি চ্যানেল বেছে নিন।'); return; }
    setImport(true);
    try {
      const fd = buildFormData();
      // sortedRows থেকে selected গুলো নিয়ে order রক্ষা করো
      const orderedIndices = sortedRows
        .filter(r => selected.has(r.origIdx))
        .map(r => r.origIdx);
      fd.append('selected_indices', JSON.stringify(orderedIndices));
      fd.append('skip_duplicates', skipDupes ? 'true' : 'false');
      const r = await api.post('/livetv/channels/import-playlist/', fd);
      toast.success(r.data.detail);
      onDone();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Import ব্যর্থ হয়েছে।');
    } finally { setImport(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
              <Icons.Import /> Import IPTV Playlist
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">M3U · M3U8 · JSON · CSV · XSPF · URL List — যেকোনো ফরম্যাট</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Source tabs */}
          <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
            {[['url','🔗 URL'], ['file','📄 File Upload'], ['text','📋 Paste']].map(([v, l]) => (
              <button key={v} onClick={() => { setTab(v); setPreview(null); }}
                className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${tab === v ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
                {l}
              </button>
            ))}
          </div>

          {/* URL tab */}
          {tab === 'url' && (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-gray-700 mb-1">Playlist URL</label>
              <input value={urlVal} onChange={e => setUrlVal(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
                placeholder="http://provider.com/get.php?username=xxx&password=yyy&type=m3u"
                onKeyDown={e => e.key === 'Enter' && handlePreview()} />
              <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700">
                <p className="font-medium">💡 IPTV provider-এর M3U link এখানে দিন।</p>
                <p className="mt-0.5 text-blue-600">Link-এ সাধারণত <code>type=m3u</code> বা <code>output=m3u</code> থাকে।</p>
              </div>
            </div>
          )}

          {/* File tab */}
          {tab === 'file' && (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-gray-700 mb-1">Playlist File</label>
              <div className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${fileObj ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-blue-400'}`}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFileObj(f); }}>
                {fileObj ? (
                  <div className="text-sm text-green-700">
                    <div className="text-2xl mb-2">✅</div>
                    <p className="font-medium">{fileObj.name}</p>
                    <p className="text-xs text-gray-500">{(fileObj.size/1024).toFixed(1)} KB</p>
                    <button onClick={() => setFileObj(null)} className="mt-2 text-xs text-red-500 hover:underline">Remove</button>
                  </div>
                ) : (
                  <label className="cursor-pointer block">
                    <div className="text-3xl mb-2">📂</div>
                    <p className="text-sm text-gray-600">এখানে ফাইল ড্র্যাগ করুন বা ক্লিক করুন</p>
                    <p className="text-xs text-gray-400 mt-1">.m3u .m3u8 .json .csv .xspf .txt</p>
                    <input type="file" className="hidden"
                      accept=".m3u,.m3u8,.json,.csv,.xspf,.txt,text/*,application/json"
                      onChange={e => setFileObj(e.target.files[0] || null)} />
                  </label>
                )}
              </div>
            </div>
          )}

          {/* Text paste tab */}
          {tab === 'text' && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Playlist Content Paste করুন</label>
              <textarea value={textVal} onChange={e => setTextVal(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                rows={8} placeholder={'#EXTM3U\n#EXTINF:-1 tvg-name="NTV" group-title="News",NTV\nhttp://stream.example.com/ntv\n...'} />
              <p className="text-xs text-gray-400 mt-1">M3U · JSON · CSV · XSPF — সব ফরম্যাট সাপোর্টেড</p>
            </div>
          )}

          {/* Preview button */}
          {!preview && (
            <button onClick={handlePreview} disabled={previewing || (!urlVal && !fileObj && !textVal)}
              className="w-full py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {previewing
                ? <><span className="animate-spin">⏳</span> Parse করা হচ্ছে…</>
                : '🔍 চ্যানেল Preview করুন'}
            </button>
          )}

          {/* Preview table */}
          {preview && (
            <div className="space-y-3">
              {/* Stats row */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-800">{preview.total} চ্যানেল</span>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">
                    {FORMAT_LABELS[preview.format] || preview.format}
                  </span>
                  {pinging && (
                    <span className="text-xs text-blue-600 animate-pulse flex items-center gap-1">
                      <span className="animate-spin inline-block">⚡</span> Speed check চলছে…
                    </span>
                  )}
                  {!pinging && Object.keys(pingMap).length > 0 && (
                    <span className="text-xs text-green-600 font-medium">
                      ✓ Speed check সম্পন্ন — দ্রুত লিংক আগে
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Sort buttons */}
                  <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
                    {[['speed','⚡ Speed'], ['name','A-Z'], ['original','Original']].map(([v, l]) => (
                      <button key={v} onClick={() => setSortBy(v)}
                        className={`px-2 py-1 text-[11px] font-medium rounded-md transition-all ${sortBy === v ? 'bg-white shadow text-gray-800' : 'text-gray-500'}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer select-none">
                    <input type="checkbox" checked={skipDupes} onChange={e => setSkipDupes(e.target.checked)} className="w-3.5 h-3.5" />
                    Duplicate বাদ দাও
                  </label>
                  <button onClick={toggleAll} className="text-xs text-blue-600 hover:underline font-medium">
                    {selected.size === sortedRows.length ? 'সব বাদ' : 'সব নির্বাচন'}
                  </button>
                  <span className="text-xs text-gray-400">{selected.size}/{sortedRows.length}</span>
                </div>
              </div>

              {/* Table */}
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0 border-b border-gray-200">
                      <tr>
                        <th className="w-8 px-3 py-2 text-left"></th>
                        <th className="px-3 py-2 text-left text-gray-600 font-semibold">চ্যানেল</th>
                        <th className="px-2 py-2 text-left text-gray-600 font-semibold w-16">Speed</th>
                        <th className="px-3 py-2 text-left text-gray-600 font-semibold hidden sm:table-cell">ক্যাটাগরি</th>
                        <th className="px-3 py-2 text-left text-gray-600 font-semibold hidden lg:table-cell">URL</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {sortedRows.map(({ origIdx, ch, ms }, rank) => {
                        const isSel = selected.has(origIdx);
                        return (
                          <tr key={origIdx}
                            className={`cursor-pointer transition-colors ${isSel ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-50'}`}
                            onClick={() => {
                              const s = new Set(selected);
                              s.has(origIdx) ? s.delete(origIdx) : s.add(origIdx);
                              setSelected(s);
                            }}>
                            <td className="px-3 py-2">
                              <input type="checkbox" checked={isSel} onChange={() => {}} className="w-3.5 h-3.5 pointer-events-none" />
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                {/* rank badge */}
                                {sortBy === 'speed' && (
                                  <span className={`text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${rank === 0 ? 'bg-yellow-400 text-yellow-900' : rank < 3 ? 'bg-gray-200 text-gray-600' : 'bg-gray-100 text-gray-400'}`}>
                                    {rank + 1}
                                  </span>
                                )}
                                {ch.logo_url && <img src={ch.logo_url} className="w-5 h-5 rounded object-cover shrink-0" onError={e => { e.target.style.display='none'; }} alt="" />}
                                <span className="font-medium text-gray-800 truncate max-w-[140px]">{ch.name}</span>
                              </div>
                            </td>
                            <td className="px-2 py-2">
                              <PingBadgeInline ms={pingMap[ch.source_url]} pinging={pinging && pingMap[ch.source_url] === undefined} />
                            </td>
                            <td className="px-3 py-2 hidden sm:table-cell">
                              <span className="text-gray-500">{CAT_LABELS[ch.category] || ch.category}</span>
                            </td>
                            <td className="px-3 py-2 hidden lg:table-cell">
                              <span className="font-mono text-gray-400 truncate max-w-[180px] block">{ch.source_url}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Footer buttons */}
              <div className="flex gap-3">
                <button onClick={() => { setPreview(null); setPingMap({}); }}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-xl hover:bg-gray-50">
                  ← পরিবর্তন করুন
                </button>
                <button onClick={handleImport} disabled={importing || selected.size === 0}
                  className="flex-1 py-2 text-sm font-medium text-white bg-gray-800 hover:bg-gray-900 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                  {importing
                    ? <><span className="animate-spin">⏳</span> Import হচ্ছে…</>
                    : `✅ ${selected.size} টি চ্যানেল Import করুন${sortBy === 'speed' ? ' (Speed অনুযায়ী)' : ''}`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function downloadM3U(channels) {
  const lines = ['#EXTM3U'];
  channels.filter(c => c.status === 'live').forEach(c => {
    lines.push(`#EXTINF:-1 tvg-name="${c.name}" group-title="${c.category_display}",${c.name}`);
    lines.push(c.hls_url);
  });
  const blob = new Blob([lines.join('\n')], { type: 'application/x-mpegURL' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'livetv.m3u' });
  a.click(); URL.revokeObjectURL(a.href);
}

// ── Main Page ──────────────────────────────────────────────────────────
export default function LiveTVPage() {
  const [channels, setChannels]   = useState([]);
  const [categories, setCategories] = useState([]);
  const [stats, setStats]         = useState({ total: 0, live: 0, stopped: 0, error: 0, starting: 0, by_type: {} });
  const [loading, setLoading]     = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [deepCheck, setDeepCheck] = useState(null); // { running, total, done, ok, fail, finished }
  const [editTarget, setEditTarget] = useState(null);
  const [logTarget, setLogTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [previewTarget, setPreviewTarget] = useState(null);
  const [deleting, setDeleting]   = useState(false);
  const [filterCat, setFilterCat] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [filterContent, setFilterContent] = useState('all'); // 'all' | 'failed' (✗ video নেই)
  const [search, setSearch]       = useState('');
  // bulk-select + delete (content-failed cleanup)
  const [selectedIds, setSelectedIds]   = useState(() => new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting]     = useState(false);

  const fetchCategories = useCallback(async () => {
    try {
      const r = await api.get('/livetv/categories/');
      const cats = r.data;
      setCategories(cats);
      // global CAT_COLOR ও CAT_NAME আপডেট করো
      cats.forEach(c => { CAT_COLOR[c.slug] = c.color; CAT_NAME[c.slug] = c.name; });
    } catch { /* silent */ }
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const [chRes, stRes] = await Promise.all([
        api.get('/livetv/channels/'),
        api.get('/livetv/channels/stats/'),
      ]);
      setChannels(chRes.data.results || chRes.data);
      setStats(stRes.data);
    } catch { toast.error('Failed to load data.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchCategories();
    fetchData();
    const iv = setInterval(fetchData, 10000);
    return () => clearInterval(iv);
  }, [fetchData, fetchCategories]);

  // deep check progress polling
  const deepCheckPollRef = useRef(null);
  const pollDeepCheck = useCallback(async () => {
    try {
      const r = await api.get('/livetv/channels/deep-check-status/');
      setDeepCheck(r.data);
      if (!r.data.running) {
        clearInterval(deepCheckPollRef.current);
        deepCheckPollRef.current = null;
        if (r.data.finished) fetchData(); // channel list refresh
      }
    } catch { /* silent */ }
  }, [fetchData]);

  const startDeepCheck = async () => {
    try {
      const r = await api.post('/livetv/channels/deep-check-all/');
      toast.success(r.data.detail);
      setDeepCheck({ running: true, total: r.data.total, done: 0, ok: 0, fail: 0 });
      clearInterval(deepCheckPollRef.current);
      deepCheckPollRef.current = setInterval(pollDeepCheck, 3000);
    } catch (err) {
      const msg = err.response?.data?.detail || 'Deep check শুরু করা যায়নি।';
      toast.error(msg);
      if (err.response?.status === 409) {
        // already running — poll শুরু করো
        setDeepCheck(err.response.data?.progress || { running: true });
        clearInterval(deepCheckPollRef.current);
        deepCheckPollRef.current = setInterval(pollDeepCheck, 3000);
      }
    }
  };

  useEffect(() => () => clearInterval(deepCheckPollRef.current), []);

  const handleSave = async (form) => {
    try {
      if (editTarget) { await api.put(`/livetv/channels/${editTarget.id}/`, form); toast.success('Channel updated.'); }
      else { await api.post('/livetv/channels/', form); toast.success('New channel added.'); }
      fetchData();
    } catch (err) {
      const msg = err.response?.data ? JSON.stringify(err.response.data) : 'An error occurred.';
      toast.error(msg); throw err;
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try { await api.delete(`/livetv/channels/${deleteTarget.id}/`); toast.success('Channel deleted.'); setDeleteTarget(null); fetchData(); }
    catch { toast.error('Failed to delete channel.'); }
    finally { setDeleting(false); }
  };

  // কার্ডের সিরিয়াল নম্বর বদলালে TVChannel.sort_order আপডেট হয় — এই একই field
  // দিয়ে mobile app-এর get_visible_channels() ও এই list দুটোই sort হয়, তাই এখানে
  // বদলালে সরাসরি (পরের app refresh/cache-expire-এ) অ্যাপের চ্যানেল লিস্টেও প্রতিফলিত হয়।
  const handleReorder = async (channelId, newOrder) => {
    // list-এ তাৎক্ষণিক re-sort দেখানোর জন্য optimistic local update
    setChannels(prev => [...prev]
      .map(c => c.id === channelId ? { ...c, sort_order: newOrder } : c)
      .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name)));
    try {
      await api.patch(`/livetv/channels/${channelId}/`, { sort_order: newOrder });
    } catch {
      toast.error('সিরিয়াল নম্বর সেভ করা যায়নি।');
      fetchData(); // ব্যর্থ হলে সার্ভারের প্রকৃত অবস্থায় ফিরিয়ে আনো
    }
  };

  const handleStart = async (ch) => {
    setActionLoading(true);
    try {
      await api.post(`/livetv/channels/${ch.id}/start/`);
      toast.success(`${ch.name} is starting...`);
      setTimeout(fetchData, 3000);
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to start stream.'); }
    finally { setActionLoading(false); }
  };

  const handleStop = async (ch) => {
    setActionLoading(true);
    try { await api.post(`/livetv/channels/${ch.id}/stop/`); toast.success(`${ch.name} stopped.`); fetchData(); }
    catch { toast.error('Failed to stop stream.'); }
    finally { setActionLoading(false); }
  };

  const filtered = channels.filter(c => {
    if (filterCat !== 'all' && c.category !== filterCat) return false;
    if (filterStatus !== 'all' && c.status !== filterStatus) return false;
    if (filterType !== 'all' && c.input_type !== filterType) return false;
    if (filterContent === 'failed' && c.last_content_ok !== false) return false;
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // content-failed (✗) badge-এ ক্লিক করলে ওই লিস্টে filter + select-mode চালু
  const selectMode = filterContent === 'failed';
  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const selectAllVisible = () => setSelectedIds(new Set(filtered.map(c => c.id)));
  const clearSelection = () => setSelectedIds(new Set());
  const showContentFailed = () => {
    setFilterContent(f => f === 'failed' ? 'all' : 'failed');
    clearSelection();
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    try {
      const ids = [...selectedIds];
      const r = await api.post('/livetv/channels/bulk-delete/', { ids });
      toast.success(r.data.detail || `${ids.length} টি চ্যানেল ডিলিট হয়েছে।`);
      setBulkDeleteOpen(false);
      clearSelection();
      fetchData();
    } catch { toast.error('Bulk delete ব্যর্থ হয়েছে।'); }
    finally { setBulkDeleting(false); }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-2 border-gray-200 border-t-gray-700 rounded-full" />
    </div>
  );

  const STATS = [
    { label: 'Total Channels', value: stats.total,       accent: 'border-t-2 border-gray-700',   num: 'text-gray-800',  icon: '📺' },
    { label: 'Live',           value: stats.live,        accent: 'border-t-2 border-green-500',  num: 'text-green-600', icon: '🟢' },
    { label: 'Starting',       value: stats.starting,    accent: 'border-t-2 border-yellow-400', num: 'text-yellow-600',icon: '⏳' },
    { label: 'Stopped',        value: stats.stopped,     accent: 'border-t-2 border-gray-300',   num: 'text-gray-500',  icon: '⏹' },
    { label: 'Error',          value: stats.error,       accent: 'border-t-2 border-red-500',    num: 'text-red-600',   icon: '⚠' },
    { label: 'অ্যাপে দেখাচ্ছে', value: stats.app_visible ?? '—', accent: 'border-t-2 border-blue-500', num: 'text-blue-600', icon: '📱' },
    // ✗ (video নেই) — ক্লিক করলে সেই লিস্ট দেখায় + bulk delete করা যায়
    { label: 'ভিডিও নেই (✗)', value: stats.content_failed ?? '—', accent: 'border-t-2 border-rose-500', num: 'text-rose-600', icon: '✗',
      onClick: showContentFailed, active: filterContent === 'failed' },
  ];

  return (
    <div className="flex flex-col min-h-full bg-gray-50">

      {/* ── Header bar ── */}
      <div className="bg-gray-900 px-4 sm:px-6 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-600 flex items-center justify-center text-white shrink-0">
            <Icons.Tv />
          </div>
          <div>
            <h1 className="text-base font-bold text-white leading-tight">Live TV Broadcast</h1>
            <p className="text-xs text-gray-400 mt-0.5">HDMI Card · DVB-S2 · URL/RTSP — FFmpeg Intel QSV HLS</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
          <button onClick={() => downloadM3U(channels)}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs border border-gray-600 text-gray-300 hover:bg-gray-800 rounded-lg transition-colors">
            ⬇ M3U Playlist
          </button>
          <button onClick={startDeepCheck} disabled={deepCheck?.running}
            title="সব চ্যানেলের actual video stream চেক করে app থেকে dead channel বাদ দেয়"
            className={`flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-lg font-medium transition-colors border ${
              deepCheck?.running
                ? 'border-orange-500 text-orange-300 bg-orange-900/30 cursor-wait'
                : 'border-orange-500 text-orange-300 hover:bg-orange-900/30'
            }`}>
            {deepCheck?.running
              ? `⏳ চেক চলছে… ${deepCheck.done||0}/${deepCheck.total||0}`
              : '🔍 Auto Check'}
          </button>
          <button onClick={() => setImportOpen(true)}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs border border-blue-500 text-blue-300 hover:bg-blue-900/40 rounded-lg font-medium transition-colors">
            <Icons.Import /> Import Playlist
          </button>
          <button onClick={() => setCatModalOpen(true)}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs border border-yellow-500 text-yellow-300 hover:bg-yellow-900/30 rounded-lg transition-colors">
            📂 Categories
          </button>
          <button onClick={() => { setEditTarget(null); setModalOpen(true); }}
            className="col-span-2 sm:col-span-1 flex items-center justify-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors">
            + New Channel
          </button>
        </div>
      </div>

      {/* ── Stats strip ── */}
      <div className="bg-white border-b border-gray-200 shrink-0">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 divide-x divide-y sm:divide-y-0 divide-gray-100">
          {STATS.map(s => {
            const Tag = s.onClick ? 'button' : 'div';
            return (
              <Tag key={s.label} onClick={s.onClick}
                title={s.onClick ? 'ক্লিক করে এই চ্যানেলগুলো দেখুন ও bulk delete করুন' : undefined}
                className={`flex items-center gap-3 px-3 sm:px-6 py-4 text-left ${s.accent} ${
                  s.onClick ? 'hover:bg-gray-50 cursor-pointer transition-colors' : ''
                } ${s.active ? 'bg-rose-50 ring-1 ring-inset ring-rose-300' : ''}`}>
                <span className="text-xl shrink-0">{s.icon}</span>
                <div className="min-w-0">
                  <div className={`text-xl sm:text-2xl font-bold leading-none ${s.num}`}>{s.value}</div>
                  <div className="text-xs text-gray-500 mt-0.5 truncate">{s.label}</div>
                </div>
              </Tag>
            );
          })}
        </div>

        {(stats.by_type?.v4l2 > 0 || stats.by_type?.dvb > 0 || stats.by_type?.url > 0) && (
          <div className="flex items-center gap-2 text-xs px-4 sm:px-6 py-2 border-t border-gray-100 bg-gray-50 flex-wrap">
            <span className="text-gray-400 font-medium">Input:</span>
            {stats.by_type?.v4l2 > 0 && <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">🖥 HDMI: {stats.by_type.v4l2}</span>}
            {stats.by_type?.dvb  > 0 && <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">📡 DVB-S2: {stats.by_type.dvb}</span>}
            {stats.by_type?.url  > 0 && <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full">🌐 URL: {stats.by_type.url}</span>}
          </div>
        )}

        {/* Deep check progress / result */}
        {deepCheck && (
          <div className={`px-4 sm:px-6 py-2 border-t text-xs flex items-center gap-3 flex-wrap ${
            deepCheck.running ? 'bg-orange-50 border-orange-100' : deepCheck.finished ? 'bg-green-50 border-green-100' : 'bg-gray-50 border-gray-100'
          }`}>
            {deepCheck.running ? (
              <>
                <span className="text-orange-600 font-medium">🔍 Stream Content চেক চলছে…</span>
                <div className="flex-1 bg-orange-100 rounded-full h-2 max-w-xs">
                  <div className="bg-orange-500 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${deepCheck.total ? Math.round((deepCheck.done / deepCheck.total) * 100) : 0}%` }} />
                </div>
                <span className="text-orange-500">{deepCheck.done}/{deepCheck.total}</span>
                <span className="text-green-600">✓ {deepCheck.ok||0} OK</span>
                <span className="text-red-500">✗ {deepCheck.fail||0} বাদ</span>
              </>
            ) : deepCheck.finished ? (
              <>
                <span className="text-green-700 font-medium">✅ Content Check সম্পন্ন</span>
                <span className="text-green-600">✓ {deepCheck.ok||0} OK (app-এ দেখাবে)</span>
                <span className="text-red-500">✗ {deepCheck.fail||0} বাদ (video নেই)</span>
                <button onClick={() => setDeepCheck(null)} className="ml-auto text-gray-400 hover:text-gray-600">✕</button>
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* ── Filters ── */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3 flex items-center gap-2 flex-wrap shrink-0">
        <div className="relative flex-1 min-w-[140px] sm:flex-none">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search channels..."
            className="w-full border border-gray-200 rounded-lg pl-7 pr-3 py-1.5 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:bg-white sm:min-w-[180px] transition-colors" />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="flex-1 sm:flex-none min-w-[110px] border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300">
          <option value="all">All Types</option>
          <option value="v4l2">🖥 HDMI</option>
          <option value="dvb">📡 DVB-S2</option>
          <option value="url">🌐 URL</option>
        </select>
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
          className="flex-1 sm:flex-none min-w-[110px] border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300">
          <option value="all">All Categories</option>
          {categories.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="flex-1 sm:flex-none min-w-[110px] border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300">
          <option value="all">All Status</option>
          <option value="live">🟢 Live</option>
          <option value="starting">⏳ Starting</option>
          <option value="stopped">⏹ Stopped</option>
          <option value="error">⚠ Error</option>
        </select>
        <div className="w-full sm:w-auto sm:ml-auto flex items-center gap-1.5 text-xs text-gray-500 justify-end">
          <span className="font-semibold text-gray-700">{filtered.length}</span>
          {filtered.length !== channels.length && <span>/ {channels.length}</span>}
          <span>channel(s)</span>
        </div>
      </div>

      {/* ── Bulk-select toolbar (✗ content-failed view) ── */}
      {selectMode && (
        <div className="flex items-center gap-3 flex-wrap px-3 sm:px-6 py-2.5 bg-rose-50 border-b border-rose-200 text-xs">
          <span className="font-semibold text-rose-700">✗ ভিডিও নেই — {filtered.length} টি চ্যানেল</span>
          <button onClick={selectAllVisible}
            className="px-2.5 py-1 rounded-md border border-rose-300 text-rose-700 hover:bg-rose-100 font-medium">
            সব সিলেক্ট ({filtered.length})
          </button>
          {selectedIds.size > 0 && (
            <button onClick={clearSelection}
              className="px-2.5 py-1 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100">
              ক্লিয়ার
            </button>
          )}
          <span className="text-gray-500">{selectedIds.size} সিলেক্টেড</span>
          <button onClick={() => setBulkDeleteOpen(true)} disabled={selectedIds.size === 0}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed">
            🗑 সিলেক্টেড ডিলিট ({selectedIds.size})
          </button>
          <button onClick={() => { setFilterContent('all'); clearSelection(); }}
            className="px-2.5 py-1 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100">
            ✕ বন্ধ
          </button>
        </div>
      )}

      {/* ── Channel Grid ── */}
      <div className="flex-1 p-3 sm:p-4 md:p-6">
        {filtered.length === 0 ? (
          <div className="text-center py-24 text-gray-400">
            <div className="text-6xl mb-4">📺</div>
            <p className="text-sm font-semibold">No channels found</p>
            <p className="text-xs mt-1">Click "+ New Channel" to add one</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {filtered.map(ch => (
              <ChannelCard key={ch.id} channel={ch} loading={actionLoading}
                selectMode={selectMode}
                selected={selectedIds.has(ch.id)}
                onToggleSelect={toggleSelect}
                onStart={handleStart} onStop={handleStop}
                onEdit={c => { setEditTarget(c); setModalOpen(true); }}
                onDelete={c => setDeleteTarget(c)}
                onLog={c => setLogTarget(c)}
                onReorder={handleReorder}
                onPreview={c => setPreviewTarget(c)} />
            ))}
          </div>
        )}
      </div>

      <ChannelModal open={modalOpen} onClose={() => { setModalOpen(false); setEditTarget(null); }} onSave={handleSave} initial={editTarget} categories={categories} />
      <LogModal open={!!logTarget} channel={logTarget} onClose={() => setLogTarget(null)} />
      <DeleteModal open={!!deleteTarget} channel={deleteTarget} onConfirm={handleDelete} onClose={() => setDeleteTarget(null)} loading={deleting} />
      <BulkDeleteModal open={bulkDeleteOpen} count={selectedIds.size} onConfirm={handleBulkDelete} onClose={() => setBulkDeleteOpen(false)} loading={bulkDeleting} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={fetchData} />
      <CategoryModal open={catModalOpen} onClose={() => setCatModalOpen(false)} onDone={fetchCategories} />
      {previewTarget && <PlayerModal channel={previewTarget} onClose={() => setPreviewTarget(null)} onStartTranscode={handleStart} />}
    </div>
  );
}
