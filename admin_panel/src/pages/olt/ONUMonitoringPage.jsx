// এই কম্পোনেন্টটি OLT-এর সব ONU-এর live signal monitoring দেখায়।
// Design: TopBar/Sidebar-harmonized — primary #1c2333 dark anchor + teal-600 brand
// accent + neutral gray base + subtle pastel status colors।
// Typography: Inter (sans), JetBrains Mono (mono), Roboto Slab (slab headers)।

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import OltRxModal from '../../components/OltRxModal';

/* ─── Status config ────────────────────────────────────────
 * Backend signal_status enum: good / low / offline / unknown
 * UI binary display: Online (good+low) / Offline (offline+unknown)
 * Low signal row-এ subtle amber tint বাকি default white।
 */
const STATUS = {
  good:    { binary: 'online',  rowTint: '' },
  low:     { binary: 'online',  rowTint: 'bg-amber-50/70' },
  offline: { binary: 'offline', rowTint: '' },
  unknown: { binary: 'offline', rowTint: '' },
};

const BINARY_BADGE = {
  online:  { label: 'Online',  cls: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  offline: { label: 'Offline', cls: 'bg-gray-100 text-gray-500',       dot: 'bg-gray-400' },
};

/* ─── Helpers ──────────────────────────────────────────────── */

/* RX Power tier (industry-standard EPON/GPON thresholds):
 *   Good     : RX >= -23 dBm     — excellent signal, healthy ONU
 *   Warning  : -23 to -27 dBm    — acceptable but watch closely
 *   Bad      : RX < -27 dBm      — degraded fiber, splice/cleaning needed
 * তিনটি tier-এর জন্য আলাদা color + label badge দেখানো হয়।
 */
function rxPowerTier(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  if (n >= -23) return 'good';
  if (n >= -27) return 'warning';
  return 'bad';
}

const RX_BADGE = {
  good:    { label: 'Good',    cls: 'bg-emerald-100 text-emerald-700' },
  warning: { label: 'Warning', cls: 'bg-amber-100 text-amber-700' },
  bad:     { label: 'Bad',     cls: 'bg-red-100 text-red-700' },
};

// RX Power cell — smaller, cleaner sizing; modern standard look (no uppercase/heavy bold)
function formatPower(v) {
  if (v === null || v === undefined || v === '') {
    return <span className="font-mono text-xs italic text-gray-400">No Signal</span>;
  }
  const n = Number(v);
  const tier = rxPowerTier(v);
  const valueCls =
    tier === 'bad'     ? 'text-red-600' :
    tier === 'warning' ? 'text-amber-700' :
                         'text-emerald-700';
  const badge = tier ? RX_BADGE[tier] : null;
  return (
    <div className="inline-flex items-center gap-1.5">
      <span className={`font-mono text-xs font-medium ${valueCls}`}>
        {n.toFixed(2)} dBm
      </span>
      {badge && (
        <span className={`inline-flex rounded px-1.5 py-px text-[10px] font-medium ${badge.cls}`}>
          {badge.label}
        </span>
      )}
    </div>
  );
}

// "EPON 0/01/5" → "EPON 0/01" (group key — backend raw)
function getPONPort(id) {
  if (!id) return 'Unknown';
  const i = id.lastIndexOf('/');
  return i === -1 ? id : id.substring(0, i).trim();
}

// "EPON 0/01" → "EPON0/1" — vendor convention, leading-zero strip
function formatPONLabel(id) {
  if (!id) return '';
  return String(id)
    .replace(/^(EPON|GPON|XGS-PON|XGPON|GePON)\s+/i, '$1')
    .replace(/\/0+(\d+)/g, '/$1');
}

// "EPON 0/01/5" → "EPON0/1:5" (CLI convention)
function formatONUID(id) {
  if (!id) return '-';
  return formatPONLabel(id).replace(/\/(\d+)$/, ':$1');
}

// Client cell — "CustomerID-নাম" (যেমন 5555-Amir); একটি অংশ না থাকলে অন্যটি একা
function formatClient(row) {
  const id = (row.customer_id || '').toString().trim();
  const name = (row.client_name || '').trim();
  if (id && name) return `${id}-${name}`;
  return id || name || '';
}

/* Client সেল — linked থাকলে ক্লিক করে ক্লায়েন্ট প্রোফাইলে যায়।
 * <Link> ব্যবহার করা হয়েছে (button নয়) যাতে middle-click / "নতুন ট্যাবে খুলুন"
 * কাজ করে। client FK না থাকলে (unlinked) সাধারণ টেক্সট। */
function ClientCell({ row, className = '' }) {
  if (!row.client_name) {
    return <span className={`italic text-gray-400 ${className}`}>Unlinked</span>;
  }
  const label = formatClient(row);
  if (!row.client) {
    return <span className={`font-semibold text-gray-900 ${className}`}>{label}</span>;
  }
  return (
    <Link
      to={`/clients/${row.client}/profile`}
      title={`${label} — প্রোফাইল দেখুন`}
      className={`font-semibold text-teal-700 underline-offset-2 hover:text-teal-900 hover:underline focus:outline-none focus:ring-2 focus:ring-teal-500/40 rounded ${className}`}
    >
      {label}
    </Link>
  );
}

/* Last Deregister Reason — ONU সর্বশেষ কেন বিচ্ছিন্ন হয়েছিল।
 * OLT-এর সাধারণ মান: 'Power Off' (গ্রাহকের বিদ্যুৎ গেছে — স্বাভাবিক),
 * 'Wire Down'/'LOS' (ফাইবার সমস্যা — মনোযোগ দরকার), 'N/A' (কখনো হয়নি)।
 * ফাইবার-সংক্রান্ত কারণ amber-এ হাইলাইট, যাতে triage-এ চোখে পড়ে। */
function DeregReason({ value }) {
  const v = (value || '').trim();
  if (!v || v === 'N/A') return <span className="italic text-gray-400">—</span>;
  const lower = v.toLowerCase();
  const isFiber = lower.includes('wire') || lower.includes('los') || lower.includes('link');
  const cls = isFiber
    ? 'bg-amber-100 text-amber-700'
    : 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`} title={v}>
      {v}
    </span>
  );
}

/* Client লেবেল ("5555-Amir") বাস্তব OLT ডিভাইসের ONU Description-এ লেখার বাটন।
 *
 * লোডিং ডিজাইন: ব্যস্ত অবস্থায় আইকন বদলে ঘূর্ণায়মান spinner হয়, রঙ
 * teal→amber, cursor `wait`, আর নিচে indeterminate progress sweep — কাজটি
 * ~৩ সেকেন্ড নেয় (আসল ডিভাইসে CLI সেশন), তাই স্পষ্ট feedback জরুরি।
 * unlinked ONU-তে পাঠানোর কিছু নেই, তাই বাটন disabled থাকে।
 */
function PushDescButton({ row, busy, onClick }) {
  const linked = !!row.client;
  const label = linked ? formatClient(row) : '';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || !linked}
      aria-busy={busy}
      title={linked
        ? `ডিভাইসের ONU Description-এ লিখুন: ${label}`
        : 'ক্লায়েন্ট linked নয় — পাঠানোর কিছু নেই'}
      aria-label="Client নাম ডিভাইসের Description-এ পাঠান"
      className={`relative inline-flex h-7 w-7 items-center justify-center overflow-hidden rounded-md border transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500/40 ${
        !linked
          ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-300'
          : busy
            ? 'cursor-wait border-amber-300 bg-amber-50 text-amber-600'
            : 'border-teal-200 bg-teal-50 text-teal-600 hover:border-teal-300 hover:bg-teal-100 hover:text-teal-700'
      }`}
    >
      {busy ? (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <Icon.Tag className="h-4 w-4" />
      )}
      {busy && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-amber-200">
          <span className="block h-full w-1/3 bg-amber-500 animate-[oltclock_1.1s_ease-in-out_infinite]" />
        </span>
      )}
    </button>
  );
}

// MAC normalize → uppercase + colon separator
function formatMac(mac) {
  if (!mac) return '';
  return mac.toUpperCase().replace(/-/g, ':');
}

// "EPON 0/01/5" → 5 (last numeric segment — ONU index on PON port)
function getONUIndex(id) {
  if (!id) return Number.POSITIVE_INFINITY;
  const m = String(id).match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
}

// Flat table-এর natural order: OLT → PON port → ONU index (বাস্তব OLT-এর মতো
// 1,2,3,…10,11 — lexicographic 1,10,11,2 নয়)
function compareByOltPonOnu(a, b) {
  const nat = (x, y) => String(x || '').localeCompare(String(y || ''), undefined, { numeric: true, sensitivity: 'base' });
  return nat(a.olt_name, b.olt_name)
      || nat(getPONPort(a.interface_id), getPONPort(b.interface_id))
      || (getONUIndex(a.interface_id) - getONUIndex(b.interface_id));
}

/* ─── Inline SVG icons (stroke-only) ───────────────────────── */

const Icon = {
  Refresh: (p) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
         strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <polyline points="21 3 21 8 16 8" />
      <polyline points="3 21 3 16 8 16" />
    </svg>
  ),
  Reload: (p) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
         strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15A9 9 0 1 1 18.36 6.36L23 10" />
    </svg>
  ),
  Search: (p) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
         strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  Filter: (p) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
         strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  ),
  Chevron: (p) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
         strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 6 15 12 9 18" />
    </svg>
  ),
  // Tag/label — Client নাম ডিভাইসের Description-এ পাঠানোর আইকন
  Tag: (p) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
         strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
      <line x1="7.5" y1="7.5" x2="7.51" y2="7.5" />
    </svg>
  ),
  // ONU/CPE ডিভাইস — বক্স + status LED + উপরে signal wave
  Device: (p) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
         strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="13" width="20" height="7" rx="2" />
      <line x1="6" y1="16.5" x2="6" y2="16.5" />
      <line x1="9.5" y1="16.5" x2="18" y2="16.5" />
      <path d="M7.5 9.5a6 6 0 0 1 9 0" />
      <path d="M10 6.5a10 10 0 0 1 4 0" />
    </svg>
  ),
  Antenna: (p) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
         strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12 12 4l7 8" />
      <path d="M8.5 12 12 8l3.5 4" />
      <line x1="12" y1="12" x2="12" y2="22" />
    </svg>
  ),
  Warning: (p) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
         strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  Signal: (p) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
         strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 20h.01" />
      <path d="M7 20v-4" />
      <path d="M12 20v-8" />
      <path d="M17 20V8" />
      <path d="M22 4v16" />
    </svg>
  ),
  Users: (p) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
         strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
};

/* ─── Status binary badge ────────────────────────────────────
 * Size consistency: RX badge-এর সঙ্গে coherent — text-[11px] font-medium,
 * flat rounded (not pill), tighter padding। dot indicator smaller।
 */
function SignalBadge({ status }) {
  const binary = STATUS[status]?.binary || 'offline';
  const cfg = BINARY_BADGE[binary];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium ${cfg.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

/* ─── Single ONU data row ──────────────────────────────────────
 * সব column-এ data text-এর base size `text-xs` (12px) — uniform &
 * readable। Hierarchy শুধু font-weight ও color দিয়ে — size দিয়ে নয়।
 */
function ONUDataRow({ row, indent, onSignalClick, onPushDesc, pushBusy }) {
  const tint = STATUS[row.signal_status]?.rowTint || '';
  const mac = formatMac(row.mac_address);
  return (
    <tr className={`${tint} hover:bg-gray-50 transition-colors`}>
      {/* OLT Name */}
      <td className={`px-4 py-2.5 text-xs font-medium text-gray-800 ${indent ? 'pl-10' : ''}`}>
        {row.olt_name || '-'}
      </td>

      {/* ONU ID — Monospace */}
      <td className="px-4 py-2.5 font-mono text-xs text-gray-800">
        {formatONUID(row.interface_id)}
      </td>

      {/* Client — "CustomerID-নাম" (যেমন 5555-Amir), ক্লিকে প্রোফাইল পেজ */}
      <td className="px-4 py-2.5 text-xs text-gray-800">
        <ClientCell row={row} />
      </td>

      {/* Zone — Zone › SubZone • Box */}
      <td className="px-4 py-2.5 text-xs text-gray-800">
        {(row.zone_name || row.subzone_name || row.box_name) ? (
          <>
            <p className="font-medium text-gray-900">{row.zone_name || '—'}</p>
            {(row.subzone_name || row.box_name) && (
              <p className="text-[11px] text-gray-500 mt-0.5">
                {[row.subzone_name, row.box_name].filter(Boolean).join(' • ')}
              </p>
            )}
          </>
        ) : (
          <span className="italic text-gray-400">—</span>
        )}
      </td>

      {/* MAC Address — Monospace */}
      <td className="px-4 py-2.5 font-mono text-xs text-gray-700">
        {mac || <span className="italic text-gray-400">—</span>}
      </td>

      {/* Status — badge; online হলে নিচে Alive Time (ডিভাইসের মান) */}
      <td className="px-4 py-2.5">
        <SignalBadge status={row.signal_status} />
        {STATUS[row.signal_status]?.binary === 'online' && row.alive_time && (
          <p className="mt-0.5 font-mono text-[10px] text-gray-500" title="Alive Time — ONU কতক্ষণ ধরে online">
            {row.alive_time}
          </p>
        )}
      </td>

      {/* RX Power (dBm) — শুধু রিয়েল-টাইম লেবেল (ক্লিকযোগ্য নয়) */}
      <td className="px-4 py-2.5">{formatPower(row.rx_power)}</td>

      {/* Distance (m) — OLT-এ মাপা fiber দূরত্ব */}
      <td className="px-4 py-2.5 font-mono text-xs text-gray-700">
        {row.distance_m != null && row.distance_m !== ''
          ? Number(row.distance_m).toLocaleString()
          : <span className="italic text-gray-400">—</span>}
      </td>

      {/* Last Deregister Reason + নিচে Deregister Time (ডিভাইসের raw মান) */}
      <td className="px-4 py-2.5 text-xs">
        <DeregReason value={row.last_dereg_reason} />
        {row.last_dereg_time && row.last_dereg_time !== 'N/A' && (
          <p className="mt-0.5 font-mono text-[10px] text-gray-500" title="Last Deregister Time (OLT-এর নিজের ঘড়ি অনুযায়ী)">
            {row.last_dereg_time}
          </p>
        )}
      </td>

      {/* Action — সবার ডানে: ONU সিগন্যাল কার্ড + Description push */}
      <td className="px-4 py-2.5">
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => onSignalClick(row)}
            title="ONU Info — OLT / ONU সিগন্যাল"
            aria-label="ONU সিগন্যাল বিস্তারিত দেখুন"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-600 transition-colors hover:border-emerald-300 hover:bg-emerald-100 hover:text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          >
            <Icon.Device className="h-4 w-4" />
          </button>
          <PushDescButton row={row} busy={pushBusy === row.id} onClick={() => onPushDesc(row)} />
        </div>
      </td>

    </tr>
  );
}

/* ─── Stats card ───────────────────────────────────────────────
 * Reference design (OLT Users পেজ): gradient card — বাঁয়ে translucent
 * icon box, ডানে label + বড় সংখ্যা, নিচে darker footer band।
 * clickable — ক্লিক করলে সংশ্লিষ্ট status filter toggle (Total → clear)।
 */
function StatCard({ label, value, accent, icon: I, footer, active, onClick }) {
  const grad = {
    total:   'from-slate-600 to-slate-800',        // dark charcoal — সব ONU
    online:  'from-teal-500 via-cyan-500 to-sky-600', // teal→blue — good
    low:     'from-violet-500 to-indigo-600',      // purple — weak signal
    offline: 'from-rose-500 to-red-600',           // red — offline
  }[accent] || 'from-slate-600 to-slate-800';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative w-full overflow-hidden rounded-2xl bg-gradient-to-br text-left text-white shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg focus:outline-none ${grad} ${
        active ? 'ring-2 ring-white/80 ring-offset-2 ring-offset-gray-100' : 'ring-1 ring-black/5'
      }`}
    >
      <div className="flex items-center gap-4 p-5">
        {I && (
          <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
            <I className="h-7 w-7" />
          </span>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-white/90">{label}</p>
          <p className="mt-0.5 font-slab text-3xl font-bold leading-tight">
            {Number(value || 0).toLocaleString()}
          </p>
        </div>
      </div>
      <div className="bg-black/15 px-5 py-2">
        <p className="text-xs font-medium text-white/85">{footer}</p>
      </div>
    </button>
  );
}

/* ─── Mobile ONU Card ── */
function MobileONUCard({ row, indent, onSignalClick, onPushDesc, pushBusy }) {
  const mac = formatMac(row.mac_address);
  const FRow = ({ label, children }) => (
    <div className="flex items-stretch border-b border-gray-200 last:border-0">
      <div className="w-20 shrink-0 bg-gray-50 px-3 py-2 flex items-center border-r border-gray-200">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex-1 min-w-0 px-3 py-2 flex items-center justify-end bg-white">{children}</div>
    </div>
  );
  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden bg-white ${indent ? 'ml-3 border-teal-100' : 'border-gray-200'}`}>
      {/* Header: OLT Name + Signal badge */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-[#23445f]/5 border-b border-gray-200">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">OLT</p>
          <p className="text-[12px] font-semibold text-gray-900 truncate">{row.olt_name || '—'}</p>
        </div>
        <SignalBadge status={row.signal_status} />
      </div>
      {/* 2-column: ONU ID | MAC */}
      <div className="grid grid-cols-2 divide-x divide-gray-200 border-b border-gray-200">
        <div className="flex flex-col px-3 py-2.5">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">ONU ID</span>
          <span className="font-mono text-[12px] font-semibold text-gray-800">{formatONUID(row.interface_id)}</span>
        </div>
        <div className="flex flex-col px-3 py-2.5">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">MAC</span>
          <span className="font-mono text-[11px] text-gray-700">{mac || '—'}</span>
        </div>
      </div>
      {/* Client/Description + RX Power */}
      <div>
        <FRow label="Client">
          <ClientCell row={row} className="text-[12px] truncate text-right min-w-0" />
        </FRow>
        {(row.zone_name || row.subzone_name || row.box_name) && (
          <FRow label="Zone">
            <div className="text-right min-w-0">
              <p className="text-[12px] font-medium text-gray-900 truncate">{row.zone_name || '—'}</p>
              {(row.subzone_name || row.box_name) && (
                <p className="text-[10px] text-gray-500 truncate">
                  {[row.subzone_name, row.box_name].filter(Boolean).join(' • ')}
                </p>
              )}
            </div>
          </FRow>
        )}
        <FRow label="RX Power">{formatPower(row.rx_power)}</FRow>
        {row.distance_m != null && row.distance_m !== '' && (
          <FRow label="Distance"><span className="font-mono text-[12px] text-gray-700">{Number(row.distance_m).toLocaleString()} m</span></FRow>
        )}
        {row.last_dereg_reason && (
          <FRow label="Last Dereg"><DeregReason value={row.last_dereg_reason} /></FRow>
        )}
        <FRow label="Action">
          <button
            type="button"
            onClick={() => onSignalClick(row)}
            title="ONU Info — OLT / ONU সিগন্যাল"
            aria-label="ONU সিগন্যাল বিস্তারিত দেখুন"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-600 transition-colors hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          >
            <Icon.Device className="h-4 w-4" />
          </button>
          <span className="ml-1.5 inline-block align-middle">
            <PushDescButton row={row} busy={pushBusy === row.id} onClick={() => onPushDesc(row)} />
          </span>
        </FRow>
      </div>
    </div>
  );
}

/* ─── Summary chip ─────────────────────────────────────────────
 * টেবিলের উপরে বাম পাশে ছোট count chip — "OLT 1", "Online 70" ইত্যাদি।
 */
function SumChip({ label, value, tone, dot }) {
  const t = {
    slate:   { box: 'bg-white border-gray-300 text-gray-600',        num: 'text-gray-900',     dot: 'bg-gray-400'    },
    dark:    { box: 'bg-[#23445f] border-[#23445f] text-white/75',   num: 'text-white',        dot: 'bg-white/70'    },
    online:  { box: 'bg-emerald-50 border-emerald-200 text-emerald-700', num: 'text-emerald-800', dot: 'bg-emerald-500' },
    offline: { box: 'bg-rose-50 border-rose-200 text-rose-700',      num: 'text-rose-800',     dot: 'bg-rose-500'    },
  }[tone] || {};
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${t.box}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />}
      {label}
      <span className={`font-semibold tabular-nums ${t.num}`}>{Number(value || 0).toLocaleString()}</span>
    </span>
  );
}

/* ─── Column filter fields ─────────────────────────────────────
 * ড্যাশবোর্ড-harmonized: gray-500 uppercase label, gray-300 border,
 * teal focus ring। clear "×" শুধু value থাকলে দেখায়। */
function ColFieldShell({ label, active, children }) {
  return (
    <label className="block">
      <span className={`mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${active ? 'text-teal-700' : 'text-gray-500'}`}>
        {label}
        {active && <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />}
      </span>
      {children}
    </label>
  );
}

function ColText({ label, value, onChange, placeholder, mono }) {
  return (
    <ColFieldShell label={label} active={!!value}>
      <div className="relative">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || 'Filter…'}
          className={`w-full rounded-lg border bg-white px-3 py-2 pr-7 text-sm text-gray-800 placeholder-gray-400 transition-shadow focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30 ${
            value ? 'border-teal-400' : 'border-gray-300'
          } ${mono ? 'font-mono' : ''}`}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label={`Clear ${label}`}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
    </ColFieldShell>
  );
}

function ColSelect({ label, value, onChange, options }) {
  return (
    <ColFieldShell label={label} active={!!value}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-gray-800 transition-shadow focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30 ${
          value ? 'border-teal-400' : 'border-gray-300'
        }`}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </ColFieldShell>
  );
}

/* ─── Main Page ────────────────────────────────────────────── */
export default function ONUMonitoringPage() {
  const [rows,       setRows]       = useState([]);
  const [summary,    setSummary]    = useState(null);
  const [olts,       setOlts]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [filters,    setFilters]    = useState({ search: '', olt: '', status: '' });
  // RX Power সেলে ক্লিক করলে যে ONU-এর সিগন্যাল কার্ড দেখাবে
  const [signalRow,  setSignalRow]  = useState(null);
  // কোন ONU-র Description ডিভাইসে push হচ্ছে (row.id) — বাটনের লোডিং state
  const [pushBusy,   setPushBusy]   = useState(null);

  /* Client লেবেল বাস্তব OLT ডিভাইসের ONU Description-এ লেখে (CLI, ~৩s)।
   * সফল হলে backend লোকাল কপিও আপডেট করে, তাই load(true) দিয়ে টেবিল রিফ্রেশ। */
  const pushDescription = async (row) => {
    if (!row.client || pushBusy) return;
    setPushBusy(row.id);
    try {
      const { data } = await api.post(`/olt/onu-signals/${row.id}/push-description/`);
      toast.success(`ডিভাইসে Description সেট হয়েছে: ${data.sent}`);
      load(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Description পাঠানো যায়নি।');
    } finally {
      setPushBusy(null);
    }
  };

  // searchInput → debounced হয়ে filters.search-এ যায় (টাইপিং smooth, কম API hit)
  const [searchInput, setSearchInput] = useState('');
  // Client-side controls — backend-এ trip ছাড়াই দ্রুত triage
  const [sort,       setSort]       = useState('default'); // default | rx_asc | rx_desc
  const [linkFilter, setLinkFilter] = useState('all');     // all | linked | unlinked

  // ── Per-column filters (client-side, instant) ──────────────────────────
  // প্রতিটি টেবিল কলামের জন্য আলাদা ফিল্টার। displayRows-এ প্রয়োগ হয় বলে
  // grouped (OLT সিলেক্টেড) view-এও কাজ করে।
  const EMPTY_COLS = {
    olt_name: '', pon: '', onu: '', dereg: '', client: '',
    zone: '', subzone: '', box: '', mac: '', status: '', rx_tier: '',
  };
  const [colFilters, setColFilters] = useState(EMPTY_COLS);
  const [showFilters, setShowFilters] = useState(false);
  const setCol = (k, v) => setColFilters((c) => ({ ...c, [k]: v }));
  const clearCols = () => setColFilters(EMPTY_COLS);
  const activeColCount = Object.values(colFilters).filter((v) => v !== '').length;

  // ── Zone/SubZone/Box dropdown options — ডাটাবেস টেবিল থেকে (config) ──
  const [zones,    setZones]    = useState([]);
  const [subzones, setSubzones] = useState([]);
  const [boxes,    setBoxes]    = useState([]);
  useEffect(() => {
    const L = (d) => d?.results || d || [];
    Promise.all([
      api.get('/config/zones/').catch(() => ({ data: [] })),
      api.get('/config/subzones/').catch(() => ({ data: [] })),
      api.get('/config/boxes/').catch(() => ({ data: [] })),
    ]).then(([z, sz, b]) => {
      setZones(L(z.data)); setSubzones(L(sz.data)); setBoxes(L(b.data));
    });
  }, []);

  const params = useMemo(() => {
    const q = {};
    if (filters.search.trim()) q.search = filters.search.trim();
    if (filters.olt)           q.olt    = filters.olt;
    if (filters.status)        q.status = filters.status;
    return q;
  }, [filters]);

  const load = (quiet = false) => {
    if (!quiet) setLoading(true);
    Promise.all([
      api.get('/olt/onu-signals/monitor/', { params }),
      api.get('/olt/olts/').catch(() => ({ data: [] })),
    ])
      .then(([monitor, oltRes]) => {
        setRows(monitor.data.results || []);
        setSummary(monitor.data.summary || null);
        setOlts(oltRes.data.results || oltRes.data || []);
        // OLT সিলেক্ট করলেও PON group default-এ collapsed থাকবে।
      })
      .catch(() => toast.error('ONU monitoring data load failed.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [params]);

  // ── Debounce: searchInput টাইপ থামার ৩৫০ms পর filters.search-এ commit ──
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.search === searchInput.trim() ? f : { ...f, search: searchInput.trim() }));
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ── Always-on auto refresh — 20s interval (near real-time) ─────────────
  // Page visible না থাকলে (অন্য tab-এ user) skip — অপ্রয়োজনীয় API hit
  // এড়াতে। ফেরত আসলে পরের tick-এ automatic resume।
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') {
        load(true);
      }
    };
    const t = setInterval(tick, 20000);
    return () => clearInterval(t);
  }, [params]);

  // Stat card / chip থেকে status set — একই card-এ আবার ক্লিক করলে toggle-off
  const setStatusFilter = (s) =>
    setFilters((f) => ({ ...f, status: f.status === s ? '' : s }));

  // ── Client-side derive: Linked/Unlinked filter + RX sort ──────────────
  // Grouped (OLT সিলেক্টেড) view-এ sort PON group-এর ভেতরে index-order রাখে;
  // RX sort শুধু flat (All OLTs) list-এ প্রয়োগ হয় — triage-এর মূল ক্ষেত্র।
  const displayRows = useMemo(() => {
    let out = rows;
    if (linkFilter === 'linked')   out = out.filter((r) => r.client_name);
    if (linkFilter === 'unlinked') out = out.filter((r) => !r.client_name);

    // ── Per-column filters — case-insensitive "contains" (নির্দিষ্ট column-এ dropdown) ──
    const cf = colFilters;
    const inc = (val, q) => String(val ?? '').toLowerCase().includes(q.toLowerCase());
    if (cf.olt_name)    out = out.filter((r) => r.olt_name === cf.olt_name);
    if (cf.pon)         out = out.filter((r) => getPONPort(r.interface_id) === cf.pon);
    if (cf.onu)         out = out.filter((r) => r.interface_id === cf.onu);
    if (cf.dereg)       out = out.filter((r) => (r.last_dereg_reason || '') === cf.dereg);
    if (cf.client)      out = out.filter((r) => inc(r.client_name, cf.client) || inc(r.customer_id, cf.client));
    if (cf.zone)        out = out.filter((r) => r.zone_name === cf.zone);
    if (cf.subzone)     out = out.filter((r) => r.subzone_name === cf.subzone);
    if (cf.box)         out = out.filter((r) => r.box_name === cf.box);
    if (cf.mac)         out = out.filter((r) => inc(formatMac(r.mac_address), cf.mac) || inc(r.mac_address, cf.mac));
    if (cf.status)      out = out.filter((r) => r.signal_status === cf.status);
    if (cf.rx_tier)     out = out.filter((r) => {
      const t = rxPowerTier(r.rx_power);
      return cf.rx_tier === 'none' ? t === null : t === cf.rx_tier;
    });

    if (sort === 'default') {
      // Flat টেবিল — OLT → PON → ONU index ক্রমে (বাস্তব OLT-এর মতো)
      out = [...out].sort(compareByOltPonOnu);
    } else {
      const dir = sort === 'rx_asc' ? 1 : -1; // rx_asc = worst (সবচেয়ে কম dBm) আগে
      // No-signal (null) rows worst হিসেবে গণ্য — worst-first-এ উপরে আসে
      out = [...out].sort((a, b) => {
        const av = a.rx_power == null ? -Infinity : Number(a.rx_power);
        const bv = b.rx_power == null ? -Infinity : Number(b.rx_power);
        return (av - bv) * dir;
      });
    }
    return out;
  }, [rows, linkFilter, sort, colFilters]);

  // ── টেবিলের উপরে সামারি — বর্তমান ফিল্টারে OLT/PON/ONU/Online/Offline সংখ্যা ──
  const viewStats = useMemo(() => {
    const oltSet = new Set();
    const ponSet = new Set();
    let online = 0, offline = 0;
    displayRows.forEach((r) => {
      if (r.olt_name) oltSet.add(r.olt_name);
      // PON key-এ OLT নাম যোগ — ভিন্ন OLT-এর একই PON আলাদা গোনার জন্য
      ponSet.add(`${r.olt_name || ''}|${getPONPort(r.interface_id)}`);
      if (STATUS[r.signal_status]?.binary === 'online') online += 1;
      else offline += 1;
    });
    return { olt: oltSet.size, pon: ponSet.size, onu: displayRows.length, online, offline };
  }, [displayRows]);

  // ── OLT → PON → ONU নির্ভরশীল dropdown options (লোড হওয়া rows থেকে) ──
  // OLT সিলেক্ট করলে শুধু সেই OLT-এর PON; PON সিলেক্ট করলে শুধু সেই PON-এর ONU।
  const oltPonOnuOpts = useMemo(() => {
    const selOlt = colFilters.olt_name;
    const selPon = colFilters.pon;
    // OLT options — unique olt_name (নাম অনুযায়ী numeric-aware sort)
    const oltNames = [...new Set(rows.map((r) => r.olt_name).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    // PON options — সিলেক্টেড OLT-এর ভেতরে
    const ponScope = selOlt ? rows.filter((r) => r.olt_name === selOlt) : rows;
    const pons = [...new Set(ponScope.map((r) => getPONPort(r.interface_id)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    // ONU options — সিলেক্টেড OLT+PON-এর ভেতরে, index অনুযায়ী numeric sort
    const onuScope = selPon ? ponScope.filter((r) => getPONPort(r.interface_id) === selPon) : ponScope;
    const seen = new Set();
    const onus = [...onuScope]
      .sort((a, b) => getONUIndex(a.interface_id) - getONUIndex(b.interface_id))
      .filter((r) => (seen.has(r.interface_id) ? false : seen.add(r.interface_id)))
      .map((r) => ({ value: r.interface_id, label: formatONUID(r.interface_id) }));
    return {
      olt: [{ value: '', label: 'All OLTs' }, ...oltNames.map((n) => ({ value: n, label: n }))],
      pon: [{ value: '', label: 'All PON' },  ...pons.map((p) => ({ value: p, label: formatPONLabel(p) }))],
      onu: [{ value: '', label: 'All ONU' },  ...onus],
    };
  }, [rows, colFilters.olt_name, colFilters.pon]);

  // Last Deregister Reason — লোড হওয়া rows-এ যেসব কারণ আছে সেগুলোই অপশন
  const deregOpts = useMemo(() => {
    const vals = [...new Set(rows.map((r) => (r.last_dereg_reason || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    return [{ value: '', label: 'All reasons' }, ...vals.map((v) => ({ value: v, label: v }))];
  }, [rows]);

  // ── Zone → SubZone → Box নির্ভরশীল dropdown options ──────────────────
  // Zone সিলেক্ট করলে শুধু সেই zone-এর subzone; subzone সিলেক্ট করলে শুধু
  // সেই subzone-এর box দেখায়। row-এ শুধু name string আছে বলে match by name।
  const zoneOpts = useMemo(() => {
    const selZone = zones.find((z) => z.name === colFilters.zone);
    const selSub  = subzones.find((s) => s.name === colFilters.subzone && (!selZone || s.zone === selZone.id));
    const subList = selZone ? subzones.filter((s) => s.zone === selZone.id) : subzones;
    const boxList = selSub  ? boxes.filter((b) => b.subzone === selSub.id)
                  : selZone ? boxes.filter((b) => b.zone_id === selZone.id)
                            : boxes;
    const toOpts = (list, allLabel) => [
      { value: '', label: allLabel },
      ...list.map((x) => ({ value: x.name, label: x.name })),
    ];
    return {
      zone: toOpts(zones,   'All zones'),
      sub:  toOpts(subList, 'All sub zones'),
      box:  toOpts(boxList, 'All boxes'),
    };
  }, [zones, subzones, boxes, colFilters.zone, colFilters.subzone]);

  const totalCount   = summary?.total   ?? rows.length;
  const goodCount    = summary?.good    ?? rows.filter((r) => r.signal_status === 'good').length;
  const lowCount     = summary?.low     ?? rows.filter((r) => r.signal_status === 'low').length;
  const offlineCount = summary?.offline ?? rows.filter((r) => r.signal_status === 'offline').length;

  return (
    <div className="space-y-6">

      {/* ── OLT / ONU সিগন্যাল কার্ড — RX Power সেলে ক্লিকে খোলে ──
       * logQuery-তে signal_id পাঠানো হয় (client_id নয়), কারণ এখানকার
       * বেশিরভাগ ONU কোনো client-এর সাথে linked নয়। */}
      {signalRow && (
        <OltRxModal
          subtitle={
            signalRow.client_name
              ? `${formatClient(signalRow)} · ${formatONUID(signalRow.interface_id)}`
              : `${signalRow.olt_name} · ${formatONUID(signalRow.interface_id)}`
          }
          rxInfo={{
            rx:      signalRow.rx_power,
            status:  signalRow.signal_status,
            source:  signalRow.raw_data?.source || '',
            olt:     signalRow.olt_name,
            iface:   signalRow.interface_id,
            updated: signalRow.last_updated,
          }}
          logQuery={`signal_id=${signalRow.id}`}
          onClose={() => setSignalRow(null)}
          onForceRefresh={async () => {
            // সরাসরি ডিভাইস থেকে পড়ে DB আপডেট করে। পুরো OLT নয় — শুধু এই
            // ONU-র PON port আনা হয় (দ্রুত ও ডিভাইসে কম চাপ); parse/scrape
            // ব্যর্থ হলে backend নিজেই পূর্ণ স্ক্যানে fallback করে।
            const { data } = await api.post(`/olt/onu-signals/${signalRow.id}/live-refresh/`);
            if (data?.signal) setSignalRow(data.signal);
            if (data?.in_device === false) {
              toast('ডিভাইস এই ONU-টি রিপোর্ট করেনি (সম্ভবত unregistered) — পুরনো মান রাখা হলো।', { icon: '⚠️' });
            } else {
              const where = data?.scope === 'all'
                ? 'সম্পূর্ণ OLT'
                : `PON ${String(data?.scope || '').replace('pon_', '')}`;
              toast.success(`${where} থেকে ${data?.updated ?? 0} ONU RX আপডেট হয়েছে।`);
            }
            load(true);   // টেবিলের বাকি রো-ও নতুন মান দেখাবে
          }}
        />
      )}

      {/* ── Page Header ── */}
      <div>
        <h1 className="font-slab text-2xl font-bold text-gray-900">ONU Monitoring</h1>
      </div>

      {/* ── Stats Cards (clickable → status filter toggle) ── */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total"      value={totalCount}   accent="total"   icon={Icon.Users}   footer="All ONU signals"
                  active={!filters.status} onClick={() => setStatusFilter('')} />
        <StatCard label="Good"       value={goodCount}    accent="online"  icon={Icon.Signal}  footer="Good signal"
                  active={filters.status === 'good'} onClick={() => setStatusFilter('good')} />
        <StatCard label="Low Signal" value={lowCount}     accent="low"     icon={Icon.Warning} footer="Weak signal"
                  active={filters.status === 'low'} onClick={() => setStatusFilter('low')} />
        <StatCard label="Offline"    value={offlineCount} accent="offline" icon={Icon.Antenna} footer="Offline ONU"
                  active={filters.status === 'offline'} onClick={() => setStatusFilter('offline')} />
      </div>

      {/* ── Main Table Card ── */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">

        {/* Filter Bar */}
        <div className="flex flex-col gap-3 border-b border-gray-200 bg-gray-50 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex-1">
            {/* Search input — OLT ও Status ফিল্টার এখন Column Filters প্যানেলে */}
            <div className="relative max-w-md">
              <Icon.Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white pl-9 pr-8 py-2.5 text-sm text-gray-800 placeholder-gray-400 transition-shadow focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
                placeholder="Search customer, phone, interface..."
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label="Clear search"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Quick controls — Column filters · Linked toggle · Sort · count */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Column-filter panel toggle — active থাকলে count badge + teal highlight */}
            <button
              type="button"
              onClick={() => setShowFilters((s) => !s)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                showFilters || activeColCount > 0
                  ? 'border-teal-500 bg-teal-50 text-teal-700'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
              }`}
            >
              <Icon.Filter className="h-4 w-4" />
              Column Filters
              {activeColCount > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-teal-600 px-1 text-[10px] font-bold text-white">
                  {activeColCount}
                </span>
              )}
              <Icon.Chevron className={`h-3.5 w-3.5 transition-transform ${showFilters ? 'rotate-90' : ''}`} />
            </button>

            {/* Linked / Unlinked segmented toggle */}
            <div className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5 text-xs font-medium">
              {[
                { k: 'all',      label: 'All' },
                { k: 'linked',   label: 'Linked' },
                { k: 'unlinked', label: 'Unlinked' },
              ].map((opt) => (
                <button
                  key={opt.k}
                  type="button"
                  onClick={() => setLinkFilter(opt.k)}
                  className={`rounded-md px-2.5 py-1.5 transition-colors ${
                    linkFilter === opt.k ? 'bg-teal-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Sort — flat (All OLTs) view-এ RX-ভিত্তিক triage */}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              title="RX power অনুযায়ী sort"
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-shadow focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="default">Sort: Default</option>
              <option value="rx_asc">Worst signal first</option>
              <option value="rx_desc">Best signal first</option>
            </select>

            <span className="text-xs font-medium text-gray-500">
              Showing <span className="font-semibold text-gray-800">{displayRows.length.toLocaleString()}</span>
            </span>
          </div>

        </div>

        {/* ── Per-Column Filter Panel (collapsible) ──────────────────────
         * প্রতিটি টেবিল কলামের জন্য আলাদা ইনপুট — টেক্সট কলামে "contains"
         * সার্চ, Status/RX Power-এ dropdown। ড্যাশবোর্ড প্যালেট: white card,
         * gray-200 border, teal focus ring, #23445f label-strip। */}
        {showFilters && (
          <div className="border-b border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 bg-[#23445f]/[0.04] px-4 py-2.5">
              <div className="flex items-center gap-2">
                <Icon.Filter className="h-3.5 w-3.5 text-teal-600" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-600">
                  Column Filters
                </span>
                {activeColCount > 0 && (
                  <span className="text-[11px] font-medium text-gray-400">
                    ({activeColCount} active)
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={clearCols}
                disabled={activeColCount === 0}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear all
              </button>
            </div>

            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* OLT → PON → ONU: লোড হওয়া ডেটা থেকে নির্ভরশীল dropdown */}
              <ColSelect label="OLT" value={colFilters.olt_name} options={oltPonOnuOpts.olt}
                onChange={(v) => setColFilters((c) => ({ ...c, olt_name: v, pon: '', onu: '' }))} />
              <ColSelect label="PON" value={colFilters.pon} options={oltPonOnuOpts.pon}
                onChange={(v) => setColFilters((c) => ({ ...c, pon: v, onu: '' }))} />
              <ColSelect label="ONU" value={colFilters.onu} options={oltPonOnuOpts.onu}
                onChange={(v) => setCol('onu', v)} />
              <ColSelect label="Last Dereg Reason" value={colFilters.dereg} options={deregOpts}
                onChange={(v) => setCol('dereg', v)} />
              <ColText  label="Client"      value={colFilters.client}      onChange={(v) => setCol('client', v)} placeholder="নাম বা Customer ID" />
              {/* Zone → SubZone → Box: ডাটাবেস টেবিল থেকে নির্ভরশীল dropdown */}
              <ColSelect label="Zone" value={colFilters.zone} options={zoneOpts.zone}
                onChange={(v) => setColFilters((c) => ({ ...c, zone: v, subzone: '', box: '' }))} />
              <ColSelect label="Sub Zone" value={colFilters.subzone} options={zoneOpts.sub}
                onChange={(v) => setColFilters((c) => ({ ...c, subzone: v, box: '' }))} />
              <ColSelect label="Box" value={colFilters.box} options={zoneOpts.box}
                onChange={(v) => setCol('box', v)} />
              <ColText  label="MAC Address" value={colFilters.mac}         onChange={(v) => setCol('mac', v)}      mono />
              <ColSelect label="Status" value={colFilters.status} onChange={(v) => setCol('status', v)}
                options={[
                  { value: '',        label: 'All statuses' },
                  { value: 'good',    label: 'Good' },
                  { value: 'low',     label: 'Low Signal' },
                  { value: 'offline', label: 'Offline' },
                  { value: 'unknown', label: 'Unknown' },
                ]} />
              <ColSelect label="RX Power" value={colFilters.rx_tier} onChange={(v) => setCol('rx_tier', v)}
                options={[
                  { value: '',        label: 'All levels' },
                  { value: 'good',    label: 'Good  (≥ -23 dBm)' },
                  { value: 'warning', label: 'Warning  (-23 to -27)' },
                  { value: 'bad',     label: 'Bad  (< -27 dBm)' },
                  { value: 'none',    label: 'No Signal' },
                ]} />
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="py-16 text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-teal-600" />
            <p className="mt-3 text-sm font-medium text-gray-500">Loading ONU signals...</p>
          </div>
        )}

        {/* Empty state — কোনো data-ই নেই */}
        {!loading && rows.length === 0 && (
          <div className="py-16 text-center">
            <Icon.Antenna className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 font-slab text-lg font-semibold text-gray-800">No ONU signal rows found</p>
            <p className="mt-1 text-sm text-gray-500">
              Click <span className="font-semibold text-gray-800">Refresh Signals</span> after ONU inventory or MAC cache sync has data.
            </p>
          </div>
        )}

        {/* Filter-এ কিছু মিলল না (data আছে কিন্তু current filter খালি) */}
        {!loading && rows.length > 0 && displayRows.length === 0 && (
          <div className="py-16 text-center">
            <Icon.Search className="mx-auto h-9 w-9 text-gray-300" />
            <p className="mt-3 font-slab text-base font-semibold text-gray-800">এই filter-এ কোনো ONU নেই</p>
            <button
              type="button"
              onClick={() => { setLinkFilter('all'); setStatusFilter(''); setSearchInput(''); clearCols(); }}
              className="mt-3 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* Table */}
        {!loading && displayRows.length > 0 && (
          <>
          {/* ── Mobile Card List — বন্ধ (সব স্ক্রিনে টেবিল দেখানো হয়) ── */}
          <div className="hidden space-y-2 p-3">
            {displayRows.map((row) => (
              <MobileONUCard key={row.id} row={row} indent={false} onSignalClick={setSignalRow}
                             onPushDesc={pushDescription} pushBusy={pushBusy} />
            ))}
          </div>
          {/* ── Summary strip — বর্তমান ফিল্টারের OLT/PON/ONU/Online/Offline সংখ্যা ── */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-gray-200 bg-gray-50/70 px-4 py-2">
            <SumChip label="OLT"     value={viewStats.olt}     tone="slate" />
            <SumChip label="PON"     value={viewStats.pon}     tone="slate" />
            <SumChip label="ONU"     value={viewStats.onu}     tone="dark"  />
            <span className="mx-0.5 h-3.5 w-px bg-gray-300" />
            <SumChip label="Online"  value={viewStats.online}  tone="online"  dot />
            <SumChip label="Offline" value={viewStats.offline} tone="offline" dot />
          </div>

          {/* ── Table (সব স্ক্রিন; মোবাইলে অনুভূমিক স্ক্রল) ── */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px]">
              <thead>
                <tr className="bg-[#23445f] text-left text-[11px] font-semibold uppercase tracking-wider text-white">
                  <th className="px-4 py-3">OLT Name</th>
                  <th className="px-4 py-3">ONU ID</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Zone</th>
                  <th className="px-4 py-3">MAC Address</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">RX Power (dBm)</th>
                  <th className="px-4 py-3">Distance (m)</th>
                  <th className="px-4 py-3">Last Deregister Reason</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {displayRows.map((row) => (
                  <ONUDataRow key={row.id} row={row} indent={false} onSignalClick={setSignalRow}
                              onPushDesc={pushDescription} pushBusy={pushBusy} />
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
