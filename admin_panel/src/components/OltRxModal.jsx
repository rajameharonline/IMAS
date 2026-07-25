// OLT / ONU সিগন্যাল কার্ড — RX power gauge + Signal Info + ONU Event Log।
// আগে এটা OnlineClientMonitoring.jsx-এর ভেতরে ছিল; এখন shared component,
// কারণ ONU Monitoring পেজ থেকেও (RX Power সেলে ক্লিক করে) খোলা হয়।
//
// logQuery দিয়ে ঠিক হয় কোন ONU-এর log আনবে:
//   `client_id=13`  → client-এর linked ONU
//   `signal_id=42`  → সরাসরি ONUSignal row (unlinked ONU-তেও কাজ করে)
import { useEffect, useState } from 'react';
import api from '../utils/api';

// "EPON 0/04/13" / "EPON04ONU13" → "EPON0/4:13"
function formatInterface(id) {
  if (!id || id === '-') return '-';
  const s = String(id).trim();

  // SNMP shorthand: EPON04ONU13 / GPON12ONU5 / GePON04ONU13 ইত্যাদি
  const m = s.match(/^(EPON|GPON|XGS-PON|XGPON|GePON)(\d)(\d+)ONU(\d+)$/i);
  if (m) {
    const [, proto, slot, port, onu] = m;
    return `${proto}${parseInt(slot, 10)}/${parseInt(port, 10)}:${parseInt(onu, 10)}`;
  }

  // CLI/DB slash format: "EPON 0/04/13"
  return s
    .replace(/^(EPON|GPON|XGS-PON|XGPON|GePON)\s+/i, '$1')
    .replace(/\/0+(\d+)/g, '/$1')
    .replace(/\/(\d+)$/, ':$1');
}

// LastDeregReason → বাংলা/ইংরেজি ব্যাখ্যা + রঙ
function deregReasonInfo(reason) {
  if (!reason || reason === '-' || reason === 'N/A') return null;
  const r = reason.toLowerCase();
  if (r.includes('power off') || r.includes('poweroff'))
    return { label: reason, note: 'ONU বন্ধ হয়েছে (PowerOff)',       color: 'text-orange-600 bg-orange-50 ring-orange-200' };
  if (r.includes('dying gasp'))
    return { label: reason, note: 'Power হারানোর আগে signal পাঠিয়েছে', color: 'text-red-600 bg-red-50 ring-red-200' };
  if (r.includes('loss') || r.includes('los'))
    return { label: reason, note: 'Fiber বা signal বিচ্ছিন্ন',        color: 'text-red-700 bg-red-50 ring-red-200' };
  if (r.includes('admin'))
    return { label: reason, note: 'Admin disable করেছে',               color: 'text-blue-600 bg-blue-50 ring-blue-200' };
  if (r.includes('link'))
    return { label: reason, note: 'Link down',                          color: 'text-amber-600 bg-amber-50 ring-amber-200' };
  return { label: reason, note: '',                                     color: 'text-gray-600 bg-gray-50 ring-gray-200' };
}

export default function OltRxModal({ subtitle, rxInfo, logQuery, onClose, onForceRefresh }) {
  const [refreshing, setRefreshing] = useState(false);
  const [onuLog, setOnuLog]         = useState(null);   // ONU registration history
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError]     = useState(null);
  const [reloadKey, setReloadKey]   = useState(0);      // Live Refresh → log পুনরায় আনে
  const [refreshError, setRefreshError] = useState(null);

  const rx  = rxInfo?.rx != null && rxInfo.rx !== '' ? parseFloat(rxInfo.rx) : null;
  const st  = rxInfo?.status || 'unknown';
  const src = rxInfo?.source || '';

  const cfg =
    st === 'good'    ? { bar: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50', ring: 'ring-emerald-200', label: 'Good Signal',  dot: 'bg-emerald-500' }
  : st === 'low'     ? { bar: 'bg-amber-400',   text: 'text-amber-700',   bg: 'bg-amber-50',   ring: 'ring-amber-200',   label: 'Low Signal',   dot: 'bg-amber-400'   }
  : st === 'offline' ? { bar: 'bg-red-400',     text: 'text-red-600',     bg: 'bg-red-50',     ring: 'ring-red-200',     label: 'Offline',      dot: 'bg-red-400'     }
  :                    { bar: 'bg-gray-300',    text: 'text-gray-400',    bg: 'bg-gray-50',    ring: 'ring-gray-200',    label: 'No Data',      dot: 'bg-gray-300'    };

  const bars = rx == null ? 0 : rx >= -20 ? 4 : rx >= -25 ? 3 : rx >= -28 ? 2 : 1;

  const ageSec = rxInfo?.updated
    ? Math.floor((Date.now() - new Date(rxInfo.updated).getTime()) / 1000)
    : null;
  const ageStr = ageSec == null ? 'N/A'
    : ageSec < 60   ? `${ageSec}s ago`
    : ageSec < 3600 ? `${Math.floor(ageSec / 60)}m ago`
    : `${Math.floor(ageSec / 3600)}h ago`;

  const srcBadge =
    src === 'live_snmp'       ? { icon: '⚡', label: 'Live SNMP',   cls: 'bg-teal-50 text-teal-700 ring-teal-200'   }
  : src === 'client_mac'      ? { icon: '🔗', label: 'Bridge MAC',  cls: 'bg-violet-50 text-violet-700 ring-violet-200' }
  : src === 'signal'          ? { icon: '📡', label: 'Signal DB',   cls: 'bg-blue-50 text-blue-700 ring-blue-200'   }
  : src === 'mac_cache'       ? { icon: '💾', label: 'Cache',       cls: 'bg-gray-50 text-gray-600 ring-gray-200'   }
  : src === 'telnet_opm_diag' ? { icon: '🖧', label: 'Telnet OPM',  cls: 'bg-indigo-50 text-indigo-700 ring-indigo-200' }
  : src === 'http_opm_diag'   ? { icon: '🌐', label: 'HTTP OPM',    cls: 'bg-sky-50 text-sky-700 ring-sky-200'      }
  :                             { icon: '❔', label: src || 'Unknown', cls: 'bg-gray-50 text-gray-500 ring-gray-200' };

  // Modal open হলে (এবং Live Refresh-এ) ONU log auto-fetch
  useEffect(() => {
    if (!logQuery) return;
    setLogLoading(true);
    setLogError(null);
    api.get(`/olt/onu-log/?${logQuery}`)
      .then(r => setOnuLog(r.data))
      .catch(e => setLogError(e?.response?.data?.error || 'ONU log আনতে সমস্যা'))
      .finally(() => setLogLoading(false));
  }, [logQuery, reloadKey]);

  // Live Refresh: onForceRefresh সরাসরি ডিভাইসে গিয়ে DB আপডেট করে (কয়েক সেকেন্ড
  // লাগতে পারে — Telnet session), তারপর reloadKey বাড়িয়ে ONU log-ও নতুন করে
  // আনা হয় (সার্ভার cache ততক্ষণে bust হয়ে গেছে, তাই সেটাও live আসবে)।
  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      if (onForceRefresh) await onForceRefresh();
      setReloadKey(k => k + 1);
    } catch (e) {
      setRefreshError(
        e?.response?.data?.error || 'ডিভাইস থেকে ডাটা আনা যায়নি — OLT সংযোগ/credential চেক করুন।'
      );
    } finally {
      setRefreshing(false);
    }
  };

  const deregInfo = deregReasonInfo(onuLog?.dereg_reason);

  // ── reusable row components ──────────────────────────────────────────────
  const SectionHeader = ({ icon, title, right }) => (
    <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-y border-gray-100">
      <span className="flex items-center gap-1.5 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
        {icon} {title}
      </span>
      {right && <span className="text-[9px] text-gray-400">{right}</span>}
    </div>
  );

  const Row = ({ label, value, valueClass = 'text-gray-800', last = false }) => (
    <div className={`flex items-center justify-between px-4 py-2.5 ${last ? '' : 'border-b border-gray-50'}`}>
      <span className="text-[11px] text-gray-400 font-medium shrink-0 w-28">{label}</span>
      <span className={`text-[12px] font-semibold text-right break-all ${valueClass}`}>{value || '—'}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-3"
         onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[92vh] overflow-y-auto flex flex-col"
           onClick={e => e.stopPropagation()}>

        {/* ══ HEADER ═══════════════════════════════════════════════════════════ */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3.5 bg-[#1c2333] rounded-t-2xl">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-teal-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-teal-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"/>
              </svg>
            </div>
            <div>
              <p className="text-[13px] font-bold text-white leading-tight">OLT / ONU সিগন্যাল</p>
              <p className="text-[10px] text-gray-400 leading-tight">{subtitle}</p>
            </div>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white flex items-center justify-center text-lg font-bold transition-colors">
            ×
          </button>
        </div>

        {/* ══ RX POWER GAUGE ═══════════════════════════════════════════════════ */}
        <div className={`px-4 py-4 ${cfg.bg} border-b border-gray-100`}>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">RX Power</p>
              <div className="flex items-end gap-1.5">
                <span className={`text-[42px] font-black leading-none ${cfg.text}`}>
                  {rx != null ? rx.toFixed(2) : '—'}
                </span>
                {rx != null && <span className="text-[13px] text-gray-400 mb-1 font-medium">dBm</span>}
              </div>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ring-1 ${cfg.bg} ${cfg.text} ${cfg.ring}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} animate-pulse`}/>
                {cfg.label}
              </span>
            </div>
            {/* Signal bars */}
            <div className="flex items-end gap-[5px] h-[52px]">
              {[1,2,3,4].map(b => (
                <div key={b}
                  className={`w-[14px] rounded-md transition-all duration-300 ${b <= bars ? cfg.bar : 'bg-gray-200'}`}
                  style={{ height: `${b * 11 + 8}px` }}/>
              ))}
            </div>
          </div>
          {/* mini signal guide */}
          <div className="flex items-center gap-3 mt-3 pt-2.5 border-t border-white/40">
            {[
              { color: 'bg-emerald-500', label: '≥ −20 dBm  Excellent' },
              { color: 'bg-amber-400',   label: '−25  Low'   },
              { color: 'bg-red-500',     label: '−28  Critical' },
            ].map(g => (
              <span key={g.label} className="flex items-center gap-1 text-[9px] text-gray-500">
                <span className={`w-2 h-2 rounded-sm ${g.color}`}/>
                {g.label}
              </span>
            ))}
          </div>
        </div>

        {/* ══ OLT / SIGNAL INFO ════════════════════════════════════════════════ */}
        <SectionHeader icon="📡" title="Signal Info"
          right={<span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold ring-1 ${srcBadge.cls}`}>{srcBadge.icon} {srcBadge.label}</span>} />
        <Row label="OLT"         value={rxInfo?.olt || '-'} />
        <Row label="Interface"   value={formatInterface(rxInfo?.iface)}
             valueClass="font-mono text-teal-700 font-bold" />
        <Row label="Last Updated" value={ageStr} last />

        {/* ══ ONU EVENT LOG ════════════════════════════════════════════════════ */}
        <SectionHeader icon="📋" title="ONU Event Log"
          right={logLoading ? (
            <span className="flex items-center gap-1 text-[9px] text-teal-500">
              <svg className="animate-spin w-2.5 h-2.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Loading…
            </span>
          ) : onuLog ? (onuLog.cached ? '💾 cached' : '⚡ live') : null}
        />

        {/* Disconnect Reason banner */}
        {!logLoading && deregInfo && (
          <div className={`mx-4 mt-3 mb-1 flex items-start gap-2.5 px-3 py-2.5 rounded-xl ring-1 ${deregInfo.color}`}>
            <span className="text-[18px] leading-none mt-0.5 shrink-0">⚠️</span>
            <div>
              <p className="text-[12px] font-bold leading-tight">Last Disconnect: {deregInfo.label}</p>
              {deregInfo.note && <p className="text-[10px] opacity-75 mt-0.5 leading-snug">{deregInfo.note}</p>}
            </div>
          </div>
        )}

        {logLoading && (
          <div className="flex items-center justify-center gap-2 py-5 text-[11px] text-gray-400">
            <svg className="animate-spin w-4 h-4 text-teal-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            OLT থেকে লোড হচ্ছে…
          </div>
        )}

        {!logLoading && logError && (
          <div className="mx-4 my-3 flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-50 ring-1 ring-red-200">
            <span className="text-red-400 text-base">⚠</span>
            <p className="text-[11px] text-red-600">{logError}</p>
          </div>
        )}

        {!logLoading && onuLog && (() => {
          const logRows = [
            { icon: '🟢', label: 'Last Online',    value: onuLog.last_reg   || '—' },
            { icon: '🔴', label: 'Last Offline',   value: onuLog.last_dereg || '—' },
            { icon: '⏱', label: 'Alive Time',     value: onuLog.alive_time || '—' },
            { icon: '📏', label: 'Distance',       value: onuLog.distance_m ? `${onuLog.distance_m} m` : '—' },
            { icon: '🔌', label: 'ONU ID',         value: onuLog.onu_id     || '—' },
            { icon: '📡', label: 'ONU Status',     value: onuLog.status     || '—',
              valueClass: onuLog.status === 'online' ? 'text-emerald-600 font-bold' : 'text-red-500 font-bold' },
          ];
          return logRows.map(({ icon, label, value, valueClass }, i) => (
            <div key={label} className={`flex items-center justify-between px-4 py-2.5 ${i < logRows.length - 1 ? 'border-b border-gray-50' : ''}`}>
              <span className="flex items-center gap-1.5 text-[11px] text-gray-400 font-medium shrink-0 w-32">
                <span>{icon}</span>{label}
              </span>
              <span className={`text-[12px] font-semibold text-right font-mono ${valueClass || 'text-gray-700'}`}>
                {value}
              </span>
            </div>
          ));
        })()}

        {/* Live Refresh ব্যর্থ হলে (ডিভাইস unreachable / lock busy) */}
        {refreshError && (
          <div className="mx-4 my-2 flex items-center gap-2 px-3 py-2.5 rounded-lg bg-amber-50 ring-1 ring-amber-200">
            <span className="text-amber-500 text-base">⚠</span>
            <p className="text-[11px] text-amber-700">{refreshError}</p>
          </div>
        )}

        {/* ══ ACTIONS ══════════════════════════════════════════════════════════ */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-4 py-3 flex gap-2 rounded-b-2xl mt-1">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex-1 py-2.5 rounded-xl bg-teal-600 text-white text-[13px] font-bold hover:bg-teal-700 active:scale-[.98] transition-all disabled:opacity-60 flex items-center justify-center gap-1.5"
          >
            {refreshing
              ? <><svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> ডিভাইস থেকে পড়ছে…</>
              : <>⚡ Live Refresh</>}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-[#1c2333] text-white text-[13px] font-bold hover:bg-[#2d3748] active:scale-[.98] transition-all"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
