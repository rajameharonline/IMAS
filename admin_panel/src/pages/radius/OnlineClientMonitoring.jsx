import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import toast from 'react-hot-toast';

function formatDuration(startTimeStr) {
  if (!startTimeStr) return '-';
  const start = new Date(startTimeStr);
  const diff = Math.floor((Date.now() - start.getTime()) / 1000);
  if (diff < 0) return '0s';
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (d > 0) return `${d}d ${h}h ${m}m ${s}s`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// RADIUS terminate_cause → বাংলা কারণ + source category
function getDisconnectInfo(cause) {
  if (!cause) return { label: 'অজানা কারণ', source: 'unknown', color: 'gray' };
  const c = String(cause).toLowerCase().trim();

  // ক্লায়েন্ট নিজে বন্ধ করেছে (রাউটার/ONU Power off বা disconnect)
  if (['user-request', 'user-error', 'supplicant-restart'].includes(c))
    return { label: 'ক্লায়েন্ট বন্ধ করেছে', source: 'Client (Router/ONU)', color: 'amber' };

  // লাইন বিচ্ছিন্ন — ফিজিক্যাল (fiber cut, ONU power)
  if (['lost-carrier', 'lost-service', 'port-error', 'nas-port-error', 'link-lost'].includes(c))
    return { label: 'লাইন বিচ্ছিন্ন', source: 'Client Side (ONU/Cable)', color: 'red' };

  // Mikrotik Router থেকে বন্ধ (admin disconnect বা reboot)
  if (['nas-request', 'nas-error', 'nas-reboot', 'admin-reset'].includes(c))
    return { label: 'Router/NAS থেকে বন্ধ', source: 'Mikrotik Router', color: 'orange' };

  // RADIUS Server থেকে বন্ধ
  if (['session-timeout', 'idle-timeout', 'radius-request', 'acct-status-type'].includes(c))
    return { label: 'RADIUS Server', source: 'RADIUS Timeout/Policy', color: 'purple' };

  // Admin manually RADIUS-এ disable করেছে
  if (c === 'admin-reset')
    return { label: 'Admin বন্ধ করেছে', source: 'RADIUS/App', color: 'blue' };

  return { label: cause, source: 'অজানা উৎস', color: 'gray' };
}

const DISCONNECT_COLOR = {
  amber:  { badge: 'bg-amber-50 text-amber-700 ring-amber-200',   dot: 'bg-amber-400' },
  red:    { badge: 'bg-red-50 text-red-600 ring-red-200',         dot: 'bg-red-500' },
  orange: { badge: 'bg-orange-50 text-orange-700 ring-orange-200',dot: 'bg-orange-500' },
  purple: { badge: 'bg-purple-50 text-purple-700 ring-purple-200',dot: 'bg-purple-500' },
  blue:   { badge: 'bg-blue-50 text-blue-700 ring-blue-200',      dot: 'bg-blue-500' },
  gray:   { badge: 'bg-gray-100 text-gray-500 ring-gray-200',     dot: 'bg-gray-400' },
};

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatCCode(customerId) {
  // সব পেজে একই customer_id হুবহু দেখানো হবে (strip করা হবে না)
  return customerId || '—';
}

// OLT datetime string normalize — "2026/04/25 20:37:15" → "2026-04-25T20:37:15"
// Safari browser ISO 8601 ছাড়া parse করে না, তাই slash → hyphen + T separator
function normalizeOltDate(s) {
  if (!s || s === '-' || s === 'N/A') return null;
  // "2026/04/25 20:37:15" → "2026-04-25T20:37:15"
  return String(s).replace(/\//g, '-').replace(' ', 'T');
}

// ONU dereg_reason → short label (table cell-এ compact দেখানোর জন্য)
function shortDeregReason(reason) {
  if (!reason || reason === '-' || reason === 'N/A') return 'Offline';
  const r = String(reason).toLowerCase();
  if (r.includes('power off') || r.includes('poweroff')) return 'Power Off';
  if (r.includes('dying gasp'))                           return 'Dying Gasp';
  if (r.includes('loss') || r.includes('los'))            return 'Signal Loss';
  if (r.includes('admin'))                                return 'Admin Off';
  if (r.includes('link'))                                 return 'Link Down';
  const s = String(reason);
  return s.length > 13 ? s.slice(0, 12) + '…' : s;
}

function TipBtn({ onClick, tooltip, color, children }) {
  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={`flex items-center justify-center w-7 h-7 rounded border transition-all hover:scale-105 ${color}`}
      >
        {children}
      </button>
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded px-2 py-0.5 text-[10px] font-semibold text-white bg-gray-800 opacity-0 group-hover:opacity-100 transition-opacity z-[60]">
        {tooltip}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
      </span>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-8 w-8 text-teal-500" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function LiveTrafficModal({ client, session, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b bg-[#1c2333] rounded-t-xl">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <svg className="w-4 h-4 text-teal-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Live Traffic
          </h2>
          <button onClick={onClose} className="text-gray-300 hover:text-white text-xl font-bold">&times;</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex justify-between text-sm py-2 border-b">
            <span className="text-gray-500 font-medium">Client</span>
            <span className="font-semibold text-gray-800">{client.full_name || '-'}</span>
          </div>
          <div className="flex justify-between text-sm py-2 border-b">
            <span className="text-gray-500 font-medium">Username</span>
            <span className="font-mono text-blue-600">{client.username || '-'}</span>
          </div>
          <div className="flex justify-between text-sm py-2 border-b">
            <span className="text-gray-500 font-medium">Bytes In</span>
            <span className="font-semibold text-green-600">{session ? formatBytes(session.bytes_in) : '-'}</span>
          </div>
          <div className="flex justify-between text-sm py-2 border-b">
            <span className="text-gray-500 font-medium">Bytes Out</span>
            <span className="font-semibold text-orange-500">{session ? formatBytes(session.bytes_out) : '-'}</span>
          </div>
          <div className="flex justify-between text-sm py-2 border-b">
            <span className="text-gray-500 font-medium">Session Start</span>
            <span className="font-medium text-gray-700">{session?.start_time ? new Date(session.start_time).toLocaleString() : '-'}</span>
          </div>
          <div className="flex justify-between text-sm py-2">
            <span className="text-gray-500 font-medium">Duration</span>
            <span className="font-mono text-teal-600">{session?.start_time ? formatDuration(session.start_time) : '-'}</span>
          </div>
        </div>
        <div className="px-5 pb-5">
          <button onClick={onClose} className="w-full py-2 rounded-lg bg-[#1c2333] text-white text-sm font-medium hover:bg-[#2d3748] transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}


function PingResultCard({ label, sourceLabel, result }) {
  if (!result) return null;
  const ok = result.success;
  return (
    <div className={`rounded-lg border p-3 ${ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex flex-col">
          <span className="text-xs font-bold text-gray-700">{label}</span>
          {sourceLabel && <span className="text-[10px] text-gray-400">{sourceLabel}</span>}
        </div>
        <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
          {ok ? '● Reachable' : '● Unreachable'}
        </span>
      </div>
      {result.error && !result.avg ? (
        <p className="text-xs text-red-500 font-mono">{result.error}</p>
      ) : (
        <div className="grid grid-cols-4 gap-1 text-center">
          {[
            ['Min', result.min != null ? result.min + ' ms' : '-'],
            ['Avg', result.avg != null ? result.avg + ' ms' : '-'],
            ['Max', result.max != null ? result.max + ' ms' : '-'],
            ['Loss', (result.loss ?? '-') + (result.loss != null ? '%' : '')],
          ].map(([k, v]) => (
            <div key={k} className="bg-white/70 rounded py-1.5">
              <p className="text-[9px] text-gray-400 uppercase font-semibold">{k}</p>
              <p className={`text-xs font-bold ${k === 'Loss' && result.loss > 0 ? 'text-red-600' : 'text-gray-800'}`}>{v}</p>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-gray-400 mt-1.5 text-right">
        Sent {result.sent ?? '-'} · Received {result.received ?? '-'}
      </p>
    </div>
  );
}

function PingModal({ client, onClose }) {
  const pingIp = (client.displayIp && client.displayIp !== '-') ? client.displayIp : (client.ip_address || '');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const doPing = useCallback(async () => {
    if (!pingIp) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await api.post('/mikrotik/ping/', { ip: pingIp, username: client.username });
      setResult(res.data);
    } catch {
      setResult({ error: 'Ping request failed' });
    } finally {
      setLoading(false);
    }
  }, [pingIp, client.username]);

  useEffect(() => { doPing(); }, [doPing]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-[#1c2333] rounded-t-xl">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <svg className="w-4 h-4 text-teal-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
            </svg>
            Client Ping
          </h2>
          <button onClick={onClose} className="text-gray-300 hover:text-white text-xl leading-none">&times;</button>
        </div>

        {/* Client info bar */}
        <div className="flex items-center gap-4 px-5 py-3 bg-gray-50 border-b text-xs text-gray-600">
          <span><span className="font-semibold text-gray-800">{client.full_name || '-'}</span></span>
          <span className="text-gray-300">|</span>
          <span>Username: <span className="font-mono font-semibold text-blue-600">{client.username || '-'}</span></span>
          <span className="text-gray-300">|</span>
          <span>IP: <span className="font-mono font-semibold text-blue-600">{pingIp || '-'}</span></span>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3">
          {!pingIp && (
            <p className="text-sm text-center text-red-500 py-4">IP address পাওয়া যায়নি — client offline হতে পারে।</p>
          )}

          {pingIp && loading && (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="relative w-12 h-12">
                <div className="absolute inset-0 rounded-full border-4 border-teal-100" />
                <div className="absolute inset-0 rounded-full border-4 border-teal-500 border-t-transparent animate-spin" />
              </div>
              <p className="text-sm text-gray-500 animate-pulse">Pinging {pingIp}…</p>
              <p className="text-xs text-gray-400">Server + Mikrotik router উভয় থেকে ping করা হচ্ছে</p>
            </div>
          )}

          {result && !loading && (
            <>
              {result.error && !result.server_ping && (
                <p className="text-sm text-red-500 text-center py-2">{result.error}</p>
              )}

              {/* Server → Client IP ping */}
              <PingResultCard
                label="Client IP Ping"
                sourceLabel={`ISP Server → ${result.ip}`}
                result={result.server_ping}
              />

              {/* Server → Mikrotik Router ping */}
              <PingResultCard
                label={`Router Ping${result.mikrotik_server ? ` (${result.mikrotik_server})` : ''}`}
                sourceLabel="ISP Server → Mikrotik Router"
                result={result.router_ping}
              />

              {/* Mikrotik PPPoE Interface check */}
              {result.mikrotik_check && (
                <div className={`rounded-lg border p-3 ${result.mikrotik_check.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-xs font-bold text-gray-700">Mikrotik Interface Check</span>
                      <p className="text-[10px] text-gray-400">PPPoE Session Status via Router</p>
                    </div>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${result.mikrotik_check.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                      {result.mikrotik_check.connected ? '● Connected' : '● Disconnected'}
                    </span>
                  </div>
                  {result.mikrotik_check.error ? (
                    <p className="text-xs text-red-500 font-mono">{result.mikrotik_check.error}</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-white/70 rounded py-1.5 text-center">
                        <p className="text-[9px] text-gray-400 uppercase font-semibold">Uptime</p>
                        <p className="text-xs font-bold text-gray-800">{result.mikrotik_check.uptime || '-'}</p>
                      </div>
                      <div className="bg-white/70 rounded py-1.5 text-center">
                        <p className="text-[9px] text-gray-400 uppercase font-semibold">Link Drops</p>
                        <p className={`text-xs font-bold ${result.mikrotik_check.link_downs > 0 ? 'text-orange-500' : 'text-green-600'}`}>
                          {result.mikrotik_check.link_downs ?? '-'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={doPing}
            disabled={loading || !pingIp}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${loading || !pingIp ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-teal-600 text-white hover:bg-teal-700'}`}
          >
            <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {loading ? 'Pinging…' : 'Re-Ping'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg bg-[#1c2333] text-white text-sm font-medium hover:bg-[#2d3748] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ট্যাব বাটন সরানো হয়েছে — শুধু Online Client Monitoring দেখাবে

const SELECT_CLS = 'text-sm border border-gray-300 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 w-full';

/* ── Mobile Online Client Card ── */
function MobileOnlineCard({
  c, idx,
  rxInfo, rx, rxQuality, onuStatus, onuLogs,
  di, clr, offlineFrom, stopTime,
  openModal, navigate, fetchData,
}) {
  const isEven = idx % 2 === 0;

  /* label(gray bg) | value(white) full-width row */
  const FRow = ({ label, children }) => (
    <div className="flex items-stretch border-b border-gray-200 last:border-0">
      <div className="w-24 shrink-0 bg-gray-50 px-3 py-2.5 flex items-center border-r border-gray-200">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex-1 min-w-0 px-3 py-2.5 flex items-center justify-end bg-white">
        {children}
      </div>
    </div>
  );

  /* 2-column grid cell */
  const GCell = ({ label, children }) => (
    <div className="flex flex-col px-3 py-2.5">
      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">{label}</span>
      <span className="text-[12px] font-medium text-gray-800 truncate">{children}</span>
    </div>
  );

  /* ONU/RX inline display */
  const rxNode = !rxInfo ? (
    <span className="text-gray-300 text-[12px]">—</span>
  ) : onuStatus === 'offline' ? (() => {
    const log = onuLogs[c.id];
    const deregLabel = (log && log !== 'loading') ? shortDeregReason(log.dereg_reason) : null;
    return (
      <span className="inline-flex items-center gap-1">
        <span className={`w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 ${log === 'loading' ? 'animate-pulse' : ''}`} />
        <span className="text-[11px] font-semibold text-red-600">
          {log === 'loading' ? 'loading…' : (deregLabel || 'ONU Offline')}
        </span>
      </span>
    );
  })() : rx != null ? (
    <span className={`inline-flex items-center gap-1 ${rxQuality?.cls}`}>
      <span className="font-mono text-[12px] font-bold tabular-nums">{rx.toFixed(2)}</span>
      <span className="text-[10px] font-semibold">{rxQuality?.label}</span>
    </span>
  ) : (
    <span className="text-[11px] text-gray-400">No Signal</span>
  );

  /* Duration / disconnect display */
  const durationNode = c.isOnline && c.session?.start_time ? (
    <span className="inline-flex items-center gap-1 font-mono text-[12px] font-bold text-emerald-600 tabular-nums">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
      {formatDuration(c.session.start_time)}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ring-1 ${clr.badge}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${clr.dot} shrink-0`} />
        {di.label}
      </span>
      {offlineFrom
        ? <span className="font-mono text-[10px] text-gray-500 tabular-nums">{formatDuration(offlineFrom)} ago</span>
        : <span className="text-[10px] text-gray-300">—</span>}
    </span>
  );

  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${isEven ? 'bg-white border-gray-200' : 'bg-slate-50/40 border-gray-200'}`}>

      {/* ── Header: Customer ID + Name + Online/Offline badge ── */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-[#23445f]/5 border-b border-gray-200">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="font-mono text-[11px] font-bold text-[#23445f] shrink-0">
              {formatCCode(c.customer_id)}
            </span>
            <span className="text-[13px] font-bold text-gray-900 truncate">{c.full_name || '—'}</span>
          </div>
          {c.phone && <p className="text-[11px] text-gray-400">{c.phone}</p>}
        </div>
        {c.displayStatus === 'Connected' ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />Online
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-600 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />Offline
          </span>
        )}
      </div>

      {/* ── Connection Info — 2-column grid ── */}
      <div className="grid grid-cols-2 divide-x divide-gray-200 border-b border-gray-200">
        <GCell label="Username">
          <span className="font-mono font-semibold text-gray-800">{c.username || '—'}</span>
        </GCell>
        <GCell label="Zone">
          {c.zone_name || '—'}{c.subzone_name ? ` · ${c.subzone_name}` : ''}
        </GCell>
        <div className="flex flex-col px-3 py-2.5 border-t border-gray-200">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Conn. Type</span>
          <span className="text-[12px] font-medium text-gray-800">{c.connectionType || '—'}</span>
        </div>
        <div className="flex flex-col px-3 py-2.5 border-t border-gray-200">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Server</span>
          <span className="text-[12px] font-medium text-gray-800 truncate">{c.router_name || '—'}</span>
        </div>
        <div className="flex flex-col px-3 py-2.5 border-t border-gray-200">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Profile</span>
          <span className="text-[12px] font-medium text-gray-800 truncate">{c.pppoe_profile || '—'}</span>
        </div>
        <div className="flex flex-col px-3 py-2.5 border-t border-gray-200">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Service</span>
          <span className="text-[12px] font-medium text-gray-800 truncate">{c.package_name || '—'}</span>
        </div>
        <div className="flex flex-col px-3 py-2.5 border-t border-gray-200">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">IP</span>
          <span className="font-mono text-[12px] font-semibold text-blue-600">{c.displayIp || '—'}</span>
        </div>
        <div className="flex flex-col px-3 py-2.5 border-t border-gray-200">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">ONU/RX</span>
          <span>{rxNode}</span>
        </div>
      </div>

      {/* ── Duration / Status — full-width FRow ── */}
      <div>
        <FRow label="Duration">{durationNode}</FRow>
      </div>

      {/* ── Footer: Actions ── */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50/60 border-t border-gray-200">
        <button
          onClick={() => navigate(`/radius/traffic/${c.username}`, { state: c })}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors active:scale-95">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Traffic
        </button>
        <button
          onClick={() => openModal('ping', c)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 transition-colors active:scale-95">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
          </svg>
          Ping
        </button>
        <button
          onClick={() => { fetchData(); toast.success('Refreshed'); }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100 transition-colors active:scale-95">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>
    </div>
  );
}

export default function OnlineClientMonitoring() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState([]);
  const [onlineMap, setOnlineMap] = useState(new Map());
  const [zones, setZones] = useState([]);
  const [subzones, setSubzones] = useState([]);
  const [boxes, setBoxes] = useState([]);
  const [servers, setServers] = useState([]);
  // activeTab সরানো হয়েছে
  const [tick, setTick] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null); // শেষবার data fetch হয়েছে কখন
  const [nextRefreshIn,   setNextRefreshIn]   = useState(15);   // পরবর্তী auto-refresh countdown

  const [filterServer, setFilterServer] = useState('');
  const [filterProtocol, setFilterProtocol] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterZone, setFilterZone] = useState('');
  const [filterSubzone, setFilterSubzone] = useState('');
  const [filterBox, setFilterBox] = useState('');
  const [filterConnType, setFilterConnType] = useState('');
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(100);
  const [showFilters, setShowFilters] = useState(false);

  const [lastStopTimes, setLastStopTimes] = useState({});
  // lazy initializer — useState callback synchronous, first render-এর আগেই চলে
  // তাই page load-এ তুরন্ত last known RX data দেখায়
  const [rxPowers, setRxPowers] = useState(() => {
    try {
      const saved = localStorage.getItem('rxPowers_v1');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const [rxLastFetched, setRxLastFetched] = useState(null); // শেষবার RX fetch হয়েছে কখন
  const [syncing, setSyncing] = useState(false);
  // যখন client প্রথমবার offline দেখা যায় সেই সময় রেকর্ড করা হয় — { username_lower: ISOString }
  const offlineDetectedAtRef = useRef({});
  // ONU log cache — { client_id: 'loading' | null | { last_reg, last_dereg, dereg_reason, … } }
  const [onuLogs, setOnuLogs] = useState({});
  const onuLogFetchedRef = useRef(new Set()); // duplicate fetch এড়ানোর জন্য
  const [modal, setModal] = useState(null);
  const [modalClient, setModalClient] = useState(null);
  const [modalRxInfo, setModalRxInfo] = useState(null);  // OLT/ONU/RX modal-এর rxInfo

  const loadData = useCallback(async ({ showToast = false } = {}) => {
    try {
      const [radiusRes, clientsRes] = await Promise.all([
        api.get('/radius/online-users/'),
        api.get('/clients/?page_size=500'),
      ]);

      const sessions = radiusRes.data?.users || [];
      const radiusSessions = sessions.filter(s => !s.source || s.source === 'radius');
      const mikrotikSessions = sessions.filter(s => s.source === 'mikrotik');

      const map = new Map();
      sessions.forEach(s => {
        if (s.username) map.set(String(s.username).toLowerCase(), s);
      });
      setOnlineMap(map);
      setLastStopTimes(radiusRes.data?.last_stop_times || {});

      const allClients = clientsRes.data?.results || clientsRes.data || [];
      setClients(allClients);

      setLastRefreshedAt(new Date());
      setNextRefreshIn(5);
      if (showToast) {
        toast.success(
          `Sync সফল! RADIUS: ${radiusSessions.length}, Mikrotik: ${mikrotikSessions.length} | মোট Client: ${allClients.length}`,
          { duration: 4000 }
        );
      }
    } catch (err) {
      if (showToast) toast.error('Sync ব্যর্থ হয়েছে — RADIUS ও Mikrotik চেক করুন');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchData = useCallback(() => loadData(), [loadData]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    await loadData({ showToast: true });
    setSyncing(false);
  }, [loadData]);

  // ONU RX Power fetch — stale-while-revalidate + localStorage instant load
  // /olt/live-rx/ → backend: fresh cache → stale+bg refresh → DB baseline+bg SNMP
  // backend কখনোই block করে না, তাই response সর্বদা মিলিসেকেন্ডে আসে
  const fetchRxPowers = useCallback(async (force = false) => {
    try {
      const url = force ? '/olt/live-rx/?force=1' : '/olt/live-rx/';
      const res = await api.get(url);
      const data = res.data?.rx || {};
      // backend response empty হলে পুরনো localStorage data wipe করা যাবে না —
      // এতে UI flicker করে "—" দেখাবে যতক্ষণ না bg SNMP শেষ হয়
      if (Object.keys(data).length > 0) {
        setRxPowers(data);
        try {
          // localStorage-এ শুধু rx!=null entry save করো
          // পরের page load-এ তুরন্ত last known good values দেখাবে
          const toSave = Object.fromEntries(
            Object.entries(data).filter(([, v]) => v?.rx != null)
          );
          localStorage.setItem('rxPowers_v1', JSON.stringify(toSave));
        } catch { /* quota */ }
      }
      setRxLastFetched(new Date()); // শেষবার fetch হয়েছে কখন — UI-তে দেখাবে
    } catch {
      // OLT না থাকলেও চলবে — silent fail
    }
  }, []);

  // Offline ONU-দের OLT log batch-fetch — batch size 5, duplicate skip
  const fetchOnuLogsForOffline = useCallback(async (clientIds) => {
    const toFetch = clientIds.filter(id => !onuLogFetchedRef.current.has(id));
    if (toFetch.length === 0) return;

    // সবাইকে 'loading' mark করো
    toFetch.forEach(id => onuLogFetchedRef.current.add(id));
    setOnuLogs(prev => {
      const patch = {};
      toFetch.forEach(id => { patch[id] = 'loading'; });
      return { ...prev, ...patch };
    });

    // ৫টা করে batch-এ parallel fetch
    for (let i = 0; i < toFetch.length; i += 5) {
      const batch = toFetch.slice(i, i + 5);
      await Promise.all(batch.map(async id => {
        try {
          const res = await api.get(`/olt/onu-log/?client_id=${id}`);
          setOnuLogs(prev => ({ ...prev, [id]: res.data || null }));
        } catch {
          setOnuLogs(prev => ({ ...prev, [id]: null }));
        }
      }));
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchRxPowers();   // backend stale cache থাকলে milliseconds-এ return

    const refetchInterval = setInterval(fetchData, 5000);
    const tickInterval    = setInterval(() => {
      setTick(t => t + 1);
      setNextRefreshIn(n => (n <= 1 ? 5 : n - 1));
    }, 1000);
    const rxInterval      = setInterval(fetchRxPowers, 60000);  // প্রতি ১ মিনিটে auto-refresh

    Promise.all([
      api.get('/config/zones/').then(r => setZones(r.data?.results || r.data || [])).catch(() => {}),
      api.get('/config/subzones/').then(r => setSubzones(r.data?.results || r.data || [])).catch(() => {}),
      api.get('/config/boxes/').then(r => setBoxes(r.data?.results || r.data || [])).catch(() => {}),
      api.get('/mikrotik/servers/?page_size=50').then(r => setServers(r.data?.results || r.data || [])).catch(() => {}),
    ]);

    return () => {
      clearInterval(refetchInterval);
      clearInterval(tickInterval);
      clearInterval(rxInterval);
    };
  }, [fetchData, fetchRxPowers]);

  // Offline detection tracker — clients বা onlineMap পরিবর্তন হলে চলে (প্রতি ১৫s)
  useEffect(() => {
    const now = new Date().toISOString();
    clients.forEach(c => {
      const key = String(c.username || '').toLowerCase();
      const isOnline = onlineMap.has(key);
      if (!isOnline) {
        // প্রথমবার offline দেখলে সময় রেকর্ড করো
        if (!offlineDetectedAtRef.current[key]) {
          offlineDetectedAtRef.current[key] = now;
        }
      } else {
        // online হলে entry মুছে দাও — পরে offline হলে নতুন সময় থেকে শুরু হবে
        delete offlineDetectedAtRef.current[key];
      }
    });
  }, [clients, onlineMap]);

  // OLT-offline ONU-দের log fetch — rxPowers বা clients পরিবর্তন হলে trigger হয়
  useEffect(() => {
    if (!rxPowers || Object.keys(rxPowers).length === 0) return;
    const offlineIds = clients
      .filter(c => {
        const ri = rxPowers[c.id] || rxPowers[String(c.id)];
        return ri?.status === 'offline';
      })
      .map(c => c.id);
    if (offlineIds.length > 0) fetchOnuLogsForOffline(offlineIds);
  }, [rxPowers, clients, fetchOnuLogsForOffline]);

  const enrichedClients = useMemo(() => {
    return clients.map(c => {
      const key = String(c.username || '').toLowerCase();
      const session = onlineMap.get(key) || null;
      const isOnline = !!session;
      return {
        ...c,
        isOnline,
        session,
        displayStatus: isOnline ? 'Connected' : 'Disconnected',
        displayIp: session?.ip || c.ip_address || '-',
        connectionType: c.protocol_name || 'Optical Fiber',
      };
    });
  }, [clients, onlineMap, tick]);

  // tabClients সরানো — সরাসরি enrichedClients ব্যবহার করা হচ্ছে
  const filteredClients = useMemo(() => {
    return enrichedClients.filter(c => {
      if (filterServer && c.router_name !== filterServer) return false;
      if (filterProtocol && c.protocol_name !== filterProtocol) return false;
      if (filterStatus && c.displayStatus !== filterStatus) return false;
      if (filterZone && c.zone_name !== filterZone) return false;
      if (filterSubzone && c.subzone_name !== filterSubzone) return false;
      if (filterBox && c.box_name !== filterBox) return false;
      if (filterConnType && c.connectionType !== filterConnType) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          String(c.full_name || '').toLowerCase().includes(q) ||
          String(c.username || '').toLowerCase().includes(q) ||
          String(c.phone || '').toLowerCase().includes(q) ||
          String(c.customer_id || '').toLowerCase().includes(q) ||
          String(c.ip_address || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [enrichedClients, filterServer, filterProtocol, filterStatus, filterZone, filterSubzone, filterBox, filterConnType, search]);

  const paginatedClients = useMemo(() => filteredClients.slice(0, pageSize), [filteredClients, pageSize]);

  const totalCount = enrichedClients.length;
  const onlineCount = enrichedClients.filter(c => c.isOnline).length;
  const offlineCount = totalCount - onlineCount;

  const uniqueProtocols = [...new Set(clients.map(c => c.protocol_name).filter(Boolean))];
  const uniqueConnTypes = [...new Set(enrichedClients.map(c => c.connectionType).filter(Boolean))];

  const openModal = (type, client, rxInfo = null) => {
    setModal(type);
    setModalClient(client);
    setModalRxInfo(rxInfo);
  };

  const closeModal = () => {
    setModal(null);
    setModalClient(null);
    setModalRxInfo(null);
  };

  return (
    <div className="space-y-4">
      {modal === 'traffic' && modalClient && (
        <LiveTrafficModal client={modalClient} session={modalClient.session} onClose={closeModal} />
      )}
      {modal === 'ping' && modalClient && (
        <PingModal client={modalClient} onClose={closeModal} />
      )}

      {/* ── Page header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Online Clients Monitoring</h1>
          <p className="text-sm text-gray-500 mt-0.5">Monitor Online Clients</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Live real-time indicator */}
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
            <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
            </span>
            <div className="text-[11px] leading-tight">
              <div className="font-bold text-green-700">LIVE</div>
            </div>
          </div>

          {/* Sync বাটন — ট্যাব সরানোর পর এখানে এসেছে */}
          <button
            onClick={handleSync}
            disabled={syncing}
            className={`flex items-center gap-2 px-4 py-1.5 text-white text-xs font-medium rounded-lg transition-colors ${syncing ? 'bg-teal-400 cursor-not-allowed' : 'bg-teal-600 hover:bg-teal-700'}`}
          >
            <svg className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {syncing ? 'Syncing...' : 'Sync Clients & Servers'}
          </button>
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex-1 rounded-xl p-3 flex items-center gap-3" style={{ background: 'linear-gradient(135deg, #0694a2 0%, #047481 100%)' }}>
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div className="text-white">
            <p className="text-xs opacity-80">Total Users</p>
            <p className="text-2xl font-bold">{totalCount}</p>
          </div>
        </div>

        <div className="flex-1 rounded-xl p-3 flex items-center gap-3" style={{ background: 'linear-gradient(135deg, #0694a2 0%, #047481 100%)' }}>
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728M8.464 15.536a5 5 0 010-7.072m7.072 0a5 5 0 010 7.072M12 12h.01" />
            </svg>
          </div>
          <div className="text-white">
            <p className="text-xs opacity-80">Online Users</p>
            <p className="text-2xl font-bold">{onlineCount}</p>
          </div>
        </div>

        <div className="flex-1 rounded-xl p-3 flex items-center gap-3 bg-[#2d3748]">
          <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728M5.636 5.636a9 9 0 000 12.728M9 9a3 3 0 000 6M15 9a3 3 0 010 6M12 12h.01" />
            </svg>
          </div>
          <div className="text-white">
            <p className="text-xs opacity-80">Offline Users</p>
            <p className="text-2xl font-bold">{offlineCount}</p>
          </div>
        </div>
      </div>

      {/* ── Show / Hide Filter Toggle ── */}
      <div className="flex justify-center">
        <button
          onClick={() => setShowFilters(v => !v)}
          className="inline-flex items-center gap-2 px-6 py-2 rounded-full bg-[#173d59] text-white text-xs font-semibold hover:bg-[#1c2f44] transition-colors shadow-sm"
        >
          {showFilters ? 'Hide Filters' : 'Show Filters'}
          <svg className={`w-3.5 h-3.5 transition-transform ${showFilters ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* ── Filter Panel — default hidden ── */}
      {showFilters && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">SERVER</label>
              <select value={filterServer} onChange={e => setFilterServer(e.target.value)} className={SELECT_CLS}>
                <option value="">All Servers</option>
                {servers.map(s => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">PROTOCOL</label>
              <select value={filterProtocol} onChange={e => setFilterProtocol(e.target.value)} className={SELECT_CLS}>
                <option value="">All Protocols</option>
                {uniqueProtocols.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">STATUS</label>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={SELECT_CLS}>
                <option value="">All Status</option>
                <option value="Connected">Connected</option>
                <option value="Disconnected">Disconnected</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">ZONE</label>
              <select value={filterZone} onChange={e => setFilterZone(e.target.value)} className={SELECT_CLS}>
                <option value="">All Zones</option>
                {zones.map(z => (
                  <option key={z.id} value={z.name}>{z.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">SUB ZONE</label>
              <select value={filterSubzone} onChange={e => setFilterSubzone(e.target.value)} className={SELECT_CLS}>
                <option value="">All Sub Zones</option>
                {subzones.map(s => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">BOX</label>
              <select value={filterBox} onChange={e => setFilterBox(e.target.value)} className={SELECT_CLS}>
                <option value="">All Boxes</option>
                {boxes.map(b => (
                  <option key={b.id} value={b.name}>{b.name}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-1">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">CONNECTION TYPE</label>
              <select value={filterConnType} onChange={e => setFilterConnType(e.target.value)} className={SELECT_CLS}>
                <option value="">All Types</option>
                {uniqueConnTypes.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="flex flex-col gap-2 px-4 py-3 border-b border-gray-100 md:flex-row md:items-center md:justify-between">
          {/* Search — mobile-এ full width, desktop-এ right */}
          <div className="relative w-full md:order-2 md:w-52">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Name, username, IP..."
              className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            />
          </div>
          {/* Show entries — mobile-এ left */}
          <div className="flex items-center gap-2 text-xs text-gray-500 font-medium md:order-1">
            <span>SHOW</span>
            <select
              value={pageSize}
              onChange={e => setPageSize(Number(e.target.value))}
              className="border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            >
              {[10, 25, 50, 100, 200].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <span>ENTRIES</span>
            <span className="text-gray-400">(Showing {paginatedClients.length} of {filteredClients.length})</span>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Spinner />
          </div>
        ) : paginatedClients.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <p className="text-sm">কোনো ডাটা পাওয়া যায়নি</p>
          </div>
        ) : (
          <>
          {/* ── Mobile Card List — বন্ধ (সব স্ক্রিনে টেবিল দেখানো হয়) ── */}
          <div className="hidden space-y-2 p-3">
            {paginatedClients.map((c, idx) => {
              const rxInfo    = rxPowers[c.id] || rxPowers[String(c.id)];
              const rx        = rxInfo?.rx != null ? parseFloat(rxInfo.rx) : null;
              const onuStatus = rxInfo?.status || null;
              const rxQuality = !rxInfo                ? null
                              : onuStatus === 'offline'? { label: 'ONU Offline', cls: 'text-red-500' }
                              : rx == null             ? null
                              : rx >= -20              ? { label: 'Excellent',   cls: 'text-emerald-600' }
                              : rx >= -25              ? { label: 'Good',        cls: 'text-teal-600' }
                              : rx >= -28              ? { label: 'Low',         cls: 'text-amber-600' }
                              :                          { label: 'Critical',    cls: 'text-red-600' };
              const stopInfo   = lastStopTimes[c.username] || lastStopTimes[String(c.username).toLowerCase()];
              const stopTime   = stopInfo?.stop_time || (typeof stopInfo === 'string' ? stopInfo : null);
              const cause      = stopInfo?.terminate_cause || '';
              const di         = getDisconnectInfo(cause);
              const clr        = DISCONNECT_COLOR[di.color] || DISCONNECT_COLOR.gray;
              const userKey    = String(c.username || '').toLowerCase();
              const detectedAt = offlineDetectedAtRef.current[userKey];
              const offlineFrom = stopTime || detectedAt || null;
              return (
                <MobileOnlineCard
                  key={c.id}
                  c={c} idx={idx}
                  rxInfo={rxInfo} rx={rx} rxQuality={rxQuality} onuStatus={onuStatus} onuLogs={onuLogs}
                  di={di} clr={clr} offlineFrom={offlineFrom} stopTime={stopTime}
                  openModal={openModal} navigate={navigate} fetchData={fetchData}
                />
              );
            })}
          </div>
          {/* ── Desktop Table (md+) ── */}
          {/* ── Table (সব স্ক্রিন; মোবাইলে অনুভূমিক স্ক্রল) ── */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="bg-[#23445f] text-white text-xs uppercase tracking-wide">
                  <th className="px-2 py-2 text-left whitespace-nowrap">Customer ID</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Username</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Name</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Zone</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Conn Type</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Server</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Profile</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Service</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">IP</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Status</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap"
                    title={rxLastFetched
                      ? `Updated: ${rxLastFetched.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                      : 'Loading…'}>
                    ONU/RX
                  </th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Duration</th>
                  <th className="px-2 py-2 text-left whitespace-nowrap">Action</th>
                </tr>
              </thead>
              <tbody>
                {paginatedClients.map((c, idx) => {
                  // ONU/RX data
                  const rxInfo    = rxPowers[c.id] || rxPowers[String(c.id)];
                  const rx        = rxInfo?.rx != null ? parseFloat(rxInfo.rx) : null;
                  const onuStatus = rxInfo?.status || null; // 'good'|'low'|'offline'|'unknown'
                  const rxQuality = !rxInfo                ? null
                                  : onuStatus === 'offline'? { label: 'ONU Offline', cls: 'text-red-500'     }
                                  : rx == null             ? null   // অন্য status কিন্তু rx নেই → dash
                                  : rx >= -20              ? { label: 'Excellent',   cls: 'text-emerald-600' }
                                  : rx >= -25              ? { label: 'Good',        cls: 'text-teal-600'    }
                                  : rx >= -28              ? { label: 'Low',         cls: 'text-amber-600'   }
                                  :                          { label: 'Critical',    cls: 'text-red-600'     };

                  // Disconnect info
                  const stopInfo    = lastStopTimes[c.username] || lastStopTimes[String(c.username).toLowerCase()];
                  const stopTime    = stopInfo?.stop_time || (typeof stopInfo === 'string' ? stopInfo : null);
                  const cause       = stopInfo?.terminate_cause || '';
                  const di          = getDisconnectInfo(cause);
                  const clr         = DISCONNECT_COLOR[di.color] || DISCONNECT_COLOR.gray;
                  // RADIUS-এ stop record না থাকলে page-এ প্রথম offline দেখার সময় ব্যবহার করি
                  const userKey     = String(c.username || '').toLowerCase();
                  const detectedAt  = offlineDetectedAtRef.current[userKey]; // fallback offline time
                  // সময়ের উৎস: RADIUS stop_time > detected time > null
                  const offlineFrom = stopTime || detectedAt || null;

                  return (
                    <tr
                      key={c.id}
                      className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} border-b border-gray-100 hover:bg-blue-50/30 transition-colors`}
                    >
                      {/* Customer ID */}
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <span className="font-bold text-gray-800 text-xs">{formatCCode(c.customer_id)}</span>
                      </td>

                      {/* Username */}
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <span className="font-mono font-semibold text-gray-800 text-xs">{c.username || '-'}</span>
                      </td>

                      {/* Name — phone টাইটেলে */}
                      <td className="px-2 py-1.5 whitespace-nowrap max-w-[110px]">
                        <span
                          className="block truncate text-gray-800 text-xs"
                          title={`${c.full_name || '-'}${c.phone ? ' · ' + c.phone : ''}`}
                        >
                          {c.full_name || '-'}
                        </span>
                      </td>

                      {/* Zone — subzone ও box টাইটেলে */}
                      <td className="px-2 py-1.5 whitespace-nowrap max-w-[90px]">
                        <span
                          className="block truncate text-gray-700 text-xs"
                          title={[c.zone_name, c.subzone_name, c.box_name].filter(Boolean).join(' · ') || '-'}
                        >
                          {c.zone_name || '-'}{c.subzone_name ? ` · ${c.subzone_name}` : ''}
                        </span>
                      </td>

                      {/* Connection Type */}
                      <td className="px-2 py-1.5 whitespace-nowrap max-w-[80px]">
                        <span className="block truncate text-gray-700 text-xs" title={c.connectionType || '-'}>
                          {c.connectionType || '-'}
                        </span>
                      </td>

                      {/* Server */}
                      <td className="px-2 py-1.5 whitespace-nowrap max-w-[90px]">
                        <span className="block truncate text-gray-700 text-xs" title={c.router_name || '-'}>
                          {c.router_name || '-'}
                        </span>
                      </td>

                      {/* Profile */}
                      <td className="px-2 py-1.5 whitespace-nowrap max-w-[80px]">
                        <span className="block truncate text-gray-700 text-xs" title={c.pppoe_profile || '-'}>
                          {c.pppoe_profile || '-'}
                        </span>
                      </td>

                      {/* Service */}
                      <td className="px-2 py-1.5 whitespace-nowrap max-w-[80px]">
                        <span className="block truncate text-gray-700 text-xs" title={c.package_name || '-'}>
                          {c.package_name || '-'}
                        </span>
                      </td>

                      {/* IP */}
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <span className="text-blue-600 font-mono text-xs">{c.displayIp}</span>
                      </td>

                      {/* Status */}
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {c.displayStatus === 'Connected' ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                            Online
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-600">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
                            Offline
                          </span>
                        )}
                      </td>

                      {/* ONU/RX — single inline line */}
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {!rxInfo ? (
                          /* OLT integration নেই / client এখনো scan হয়নি */
                          <span className="text-gray-300 text-xs">—</span>

                        ) : onuStatus === 'offline' ? (() => {
                          /* OLT থেকে নিশ্চিত offline — ONU log দেখাবে */
                          const log = onuLogs[c.id]; // 'loading' | null | { data }
                          const logReady   = log && log !== 'loading';
                          const deregLabel = logReady ? shortDeregReason(log.dereg_reason) : null;
                          // tooltip-এ exact datetime দেখাবে (hover করলে)
                          const lastDeregISO  = logReady ? normalizeOltDate(log.last_dereg) : null;
                          const lastDeregDate = lastDeregISO ? new Date(lastDeregISO) : null;
                          const lastDeregValid = lastDeregDate && !isNaN(lastDeregDate.getTime());
                          return (
                            <span
                              className="inline-flex items-center gap-1"
                              title={logReady
                                ? `ONU Offline · ${log.dereg_reason || '—'}${lastDeregValid ? ' · ' + lastDeregDate.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}`
                                : 'ONU অফলাইন'}
                            >
                              {/* Dot — loading হলে pulse */}
                              <span className={`w-1.5 h-1.5 rounded-full bg-red-500 inline-block shrink-0 ${log === 'loading' ? 'animate-pulse' : ''}`} />
                              {log === 'loading' ? (
                                <span className="text-[10px] text-red-400 italic">loading…</span>
                              ) : deregLabel ? (
                                /* শুধু reason label — time দেখানোর প্রয়োজন নেই */
                                <span className="text-[10px] font-semibold text-red-600">{deregLabel}</span>
                              ) : (
                                <span className="text-[10px] font-semibold text-red-500">ONU Offline</span>
                              )}
                            </span>
                          );
                        })()

                        : rx != null ? (
                          /* ONU অনলাইন — RX dBm ও quality দেখাবে */
                          <span
                            className={`inline-flex items-center gap-1 ${rxQuality?.cls}`}
                            title="রিয়েল-টাইম ONU RX"
                          >
                            <span className="font-mono text-xs font-bold tabular-nums">{rx.toFixed(2)}</span>
                            <span className="text-[10px] font-semibold">{rxQuality?.label}</span>
                          </span>
                        ) : (
                          /* rxInfo আছে কিন্তু rx নেই — scan pending */
                          <span className="inline-flex items-center gap-1" title="OLT scan pending">
                            <span className="text-[10px] text-gray-400">No Signal</span>
                          </span>
                        )}
                      </td>

                      {/* Duration — single inline line */}
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {c.isOnline && c.session?.start_time ? (
                          <span className="inline-flex items-center gap-1 font-mono text-xs font-bold text-emerald-600 tabular-nums">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block shrink-0" />
                            {formatDuration(c.session.start_time)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <span
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ring-1 shrink-0 ${clr.badge}`}
                              title={`${di.source}${stopTime ? ' · ' + new Date(stopTime).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : detectedAt ? ' · এই session-এ detected' : ''}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${clr.dot} shrink-0`} />
                              {di.label}
                            </span>
                            {offlineFrom ? (
                              <span className="font-mono text-[10px] text-gray-500 tabular-nums shrink-0">
                                {formatDuration(offlineFrom)} ago
                              </span>
                            ) : (
                              <span className="text-[10px] text-gray-300 shrink-0">—</span>
                            )}
                          </span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <TipBtn
                            onClick={() => navigate(`/radius/traffic/${c.username}`, { state: c })}
                            tooltip="Live Traffic"
                            color="bg-green-50 border-green-300 text-green-600 hover:bg-green-100"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                            </svg>
                          </TipBtn>
                          <TipBtn
                            onClick={() => openModal('ping', c)}
                            tooltip="Client Ping"
                            color="bg-green-50 border-green-300 text-green-600 hover:bg-green-100"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                            </svg>
                          </TipBtn>
                          <TipBtn
                            onClick={() => { fetchData(); toast.success('Refreshed'); }}
                            tooltip="Re-Check"
                            color="bg-green-50 border-green-300 text-green-600 hover:bg-green-100"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          </TipBtn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
