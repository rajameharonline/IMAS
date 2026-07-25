import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { usePermission } from '../../context/PermissionContext';
// Module 6 — Support & Ticketing: instant ticket creation modal।
import OpenTicketModal from '../../components/OpenTicketModal';

/* ── Formatters ─────────────────────────────────────────────────── */
function fmtDate(v) {
  if (!v) return '';
  try { return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return v; }
}
function fmtDateTime(v) {
  if (!v) return '';
  try {
    const d = new Date(v);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ', ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch { return v; }
}
function fmtBillMonth(v) {
  if (!v) return '';
  const [y, m] = v.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short' }) + '-' + y.slice(2);
}
function getList(d) { return Array.isArray(d) ? d : (d?.results || []); }

/* ── RADIUS helpers ──────────────────────────────────────────────── */
function formatUptime(startTimeStr) {
  if (!startTimeStr) return '';
  const start = new Date(startTimeStr);
  const diff  = Math.floor((Date.now() - start.getTime()) / 1000);
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
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/* ── Section wrapper ────────────────────────────────────────────── */
// icon === null বা undefined হলে SVG span skip — কিছু section-এ icon-less
// header দরকার পড়লে কাজ করবে (যেমন All Complain History)।
function Sec({ icon, title, badge, children }) {
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div style={{ backgroundColor: '#23445f', borderBottom: '1px solid #24364d' }} className="text-white px-4 py-2.5 flex items-center gap-2.5">
        {icon && <span className="shrink-0 opacity-80">{icon}</span>}
        <span className="text-sm font-semibold">{title}</span>
        {badge && <span className="ml-1 bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{badge}</span>}
      </div>
      <div className="bg-white px-5 py-4">{children}</div>
    </div>
  );
}

/* ── Readonly field ─────────────────────────────────────────────── */
function RF({ label, value }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <input readOnly value={value ?? ''} className="w-full border border-gray-200 rounded px-3 py-1.5 text-sm bg-gray-50 text-gray-700 focus:outline-none" />
    </div>
  );
}

/* ── Readonly field with colored value ──────────────────────────── */
function RFColor({ label, value, color }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <input readOnly value={value ?? ''}
        className="w-full border border-gray-200 rounded px-3 py-1.5 text-sm bg-gray-50 font-semibold focus:outline-none"
        style={{ color: color && value ? color : '#374151' }} />
    </div>
  );
}

/* ── Paged table ────────────────────────────────────────────────── */
function PagedTable({ columns, rows }) {
  const [perPage, setPerPage] = useState(10);
  const [srch, setSrch] = useState('');
  const [page, setPage] = useState(1);
  // Bug fix: search-box খালি থাকলে সব row দেখাব; render-only column গুলোও
  // search-এ ম্যাচ করব (row[c.key] raw value)। পূর্বে `!c.render` শর্তে সব
  // column-এ render থাকলে filter সব row বাদ দিত।
  const q = srch.trim().toLowerCase();
  const filtered = !q
    ? rows
    : rows.filter(row =>
        columns.some(c => String(row[c.key] ?? '').toLowerCase().includes(q))
      );
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const slice = filtered.slice((page - 1) * perPage, page * perPage);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>SHOW</span>
          <select value={perPage} onChange={e => { setPerPage(+e.target.value); setPage(1); }}
            className="border border-gray-300 rounded px-2 py-1 text-sm bg-white">
            {[10, 20, 50, 100].map(n => <option key={n}>{n}</option>)}
          </select>
          <span>ENTRIES</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className="font-medium">SEARCH:</span>
          <input value={srch} onChange={e => { setSrch(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded px-2 py-1 text-sm w-40 focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>
      </div>

      {/* Mobile: card view */}
      <div className="md:hidden space-y-2">
        {slice.length === 0
          ? <p className="text-center py-8 text-gray-400 text-sm">No data available in table</p>
          : slice.map((row, i) => (
            <div key={i} className={`rounded-xl border shadow-sm overflow-hidden ${i % 2 === 0 ? 'bg-white border-gray-200' : 'bg-slate-50/40 border-gray-200'}`}>
              {columns.map(c => (
                <div key={c.key} className="flex items-stretch border-b border-gray-100 last:border-0">
                  <div className="w-28 shrink-0 bg-gray-50 px-3 py-2 flex items-center border-r border-gray-100">
                    <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide leading-tight">{c.label}</span>
                  </div>
                  <div className="flex-1 min-w-0 px-3 py-2 flex items-center text-sm text-gray-700 break-all">
                    {c.render ? c.render(row) : (row[c.key] ?? '—')}
                  </div>
                </div>
              ))}
            </div>
          ))}
      </div>

      {/* Desktop: table view */}
      <div className="hidden md:block overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr style={{ backgroundColor: '#23445f' }} className="text-white">
              {columns.map(c => (
                <th key={c.key} style={{ borderRight: '1px solid #24364d' }} className="px-3 py-2.5 text-left font-semibold last:border-r-0 whitespace-nowrap">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.length === 0
              ? <tr><td colSpan={columns.length} className="text-center py-8 text-gray-400 text-sm">No data available in table</td></tr>
              : slice.map((row, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white hover:bg-blue-50' : 'bg-gray-50 hover:bg-blue-50'}>
                  {columns.map(c => (
                    <td key={c.key} className="px-3 py-2 border-b border-gray-100 border-r last:border-r-0 whitespace-nowrap">
                      {c.render ? c.render(row) : (row[c.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-1 mt-3">
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
          className="px-3 py-1 text-sm border rounded hover:bg-gray-100 disabled:opacity-40">Previous</button>
        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(p => (
          <button key={p} onClick={() => setPage(p)}
            className={`px-3 py-1 text-sm border rounded ${p === page ? 'bg-blue-500 text-white border-blue-500' : 'hover:bg-gray-100'}`}>{p}</button>
        ))}
        <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
          className="px-3 py-1 text-sm border rounded hover:bg-gray-100 disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}

function Toggle({ active }) {
  return (
    <div className={`relative inline-flex h-6 w-11 items-center rounded-full cursor-default ${active ? 'bg-blue-500' : 'bg-gray-300'}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${active ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
    </div>
  );
}

function DateFilter() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
      <div>
        <label className="text-sm font-medium text-gray-600 block mb-1">FROM DATE</label>
        <input type="date" className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" />
      </div>
      <div>
        <label className="text-sm font-medium text-gray-600 block mb-1">TO DATE</label>
        <input type="date" className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm" />
      </div>
    </div>
  );
}

/* ── Icons ──────────────────────────────────────────────────────── */
const IcoUser = <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" /></svg>;
const IcoNet  = <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" /></svg>;
const IcoSrv  = <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>;
const IcoOlt  = <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" /></svg>;
const IcoNPrd = <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>;
const IcoComp = <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>;
const IcoRmrk = <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>;
const IcoMsg  = <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>;
const IcoPay  = <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>;
const IcoBill = <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>;
const IcoLog  = <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
const IcoInv  = <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;
const IcoInst = <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>;
const IcoPencil = <svg className="w-3 h-3 text-blue-400 inline ml-1 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>;

/* ════════════════════════════════════════════════════════════════ */
export default function CustomerSearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  // Customer search পেজে Open Ticket ও Kick ছাড়া বাকি সব action শুধু admin role
  // (superadmin/admin)। অন্য কোনো role এসব করতে পারবে না।
  const { isSuper: isAdmin } = usePermission();

  /* search */
  const [query, setQuery]                 = useState('');
  const [searching, setSearching]         = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [showDropdown, setShowDropdown]   = useState(false);
  const dropdownRef    = useRef(null);
  const searchTimerRef = useRef(null);

  /* client data */
  const [client,     setClient]     = useState(null);
  const [bills,      setBills]      = useState([]);
  const [payments,   setPayments]   = useState([]);
  const [installFee, setInstallFee] = useState(null);
  const [smsLogs,    setSmsLogs]    = useState([]);
  const [remarks,    setRemarks]    = useState([]);
  const [changeLogs, setChangeLogs] = useState([]);
  const [statusLogs, setStatusLogs] = useState([]);
  const [loading,    setLoading]    = useState(false);

  /* RADIUS live session data */
  const [radiusSession,      setRadiusSession]      = useState(null);   // online হলে session object
  const [lastStopInfo,       setLastStopInfo]       = useState(null);   // { stop_time, terminate_cause }
  const [trafficData,        setTrafficData]        = useState(null);   // Mikrotik real-time bytes
  const [trafficLoading,     setTrafficLoading]     = useState(false);  // Mikrotik fetch in progress
  const [trafficHistory,     setTrafficHistory]     = useState([]);     // মাসিক traffic history
  const [trafficHistoryLoad, setTrafficHistoryLoad] = useState(false);  // history loading
  const [tick,               setTick]               = useState(0);      // প্রতি ১s — uptime live update

  /* Quick-actions */
  const [actionBusy,  setActionBusy]  = useState('');    // চলমান quick-action ('kick'|'toggle')

  /* OLT info — দুই ধাপ: DB (fast) + Telnet (slow/background) */
  const [oltMac,      setOltMac]      = useState(null);   // DB MAC cache — তুরন্ত
  const [onuLog,      setOnuLog]      = useState(null);   // Telnet log — background
  const [onuLogLoading, setOnuLogLoading] = useState(false);

  /* edit */
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState({});
  const [saving,   setSaving]   = useState(false);

  /* Module 6 — Support tickets state */
  // tickets   — এই client-এর সব ticket (Complain History section render)।
  // showOpenTicket — "+ Open Ticket" modal দেখানোর flag।
  const [tickets, setTickets]               = useState([]);
  const [showOpenTicket, setShowOpenTicket] = useState(false);

  /* dropdown options */
  const [zones,       setZones]       = useState([]);
  const [subzones,    setSubzones]    = useState([]);
  const [boxes,       setBoxes]       = useState([]);
  const [packages,    setPackages]    = useState([]);
  const [protocols,   setProtocols]   = useState([]);
  const [clientTypes, setClientTypes] = useState([]);
  const [servers,     setServers]     = useState([]);

  /* load dropdown options once */
  useEffect(() => {
    Promise.all([
      api.get('/config/zones/'),
      api.get('/config/subzones/'),
      api.get('/config/boxes/'),
      api.get('/config/packages/'),
      api.get('/config/protocol-types/'),
      api.get('/config/client-types/'),
      api.get('/mikrotik/servers/'),
    ]).then(([zR, szR, bR, pkgR, prR, ctR, srvR]) => {
      setZones(getList(zR.data));
      setSubzones(getList(szR.data));
      setBoxes(getList(bR.data));
      setPackages(getList(pkgR.data));
      setProtocols(getList(prR.data));
      setClientTypes(getList(ctR.data));
      setServers(getList(srvR.data));
    }).catch(() => {});
  }, []);

  /* populate formData whenever client changes */
  useEffect(() => {
    if (!client) return;
    setFormData({
      full_name:    client.full_name    || '',
      phone:        client.phone        || '',
      alt_phone:    client.alt_phone    || '',
      email:        client.email        || '',
      house_no:     client.house_no     || '',
      road_no:      client.road_no      || '',
      address:      client.address      || '',
      nid:          client.nid          || '',
      zone:         client.zone         || '',
      subzone:      client.subzone      || '',
      box:          client.box          || '',
      package:      client.package      || '',
      router:       client.router       || '',
      protocol:     client.protocol     || '',
      client_type:  client.client_type  || '',
      pppoe_profile: client.pppoe_profile || '',
      username:     client.username     || '',
      password:     client.password     || '',
      monthly_bill: client.monthly_bill || '',
      expiry_date:  client.expiry_date  || '',
      discount:     client.discount     || '',
      bill_date:    client.bill_date    || '',
      monthly_amount_month: client.monthly_amount_month || '',
      notes:               client.notes               || '',
      device:              client.device              || '',
      package_no:          client.package_no          || '',
      optical_fiber:       client.optical_fiber       || '',
      cable_meter:         client.cable_meter         || '',
      vendor:              client.vendor              || '',
      latitude:            client.map_lat             || '',
      longitude:           client.map_lng             || '',
      serial_no:           client.serial_no           || '',
      fiber_code:          client.fiber_code          || '',
      color_of_cord:       client.color_of_cord       || '',
      device_purchase_date: client.device_purchase_date || '',
      // Remote Management IP — save করা না থাকলে client IP দিয়ে রেডি default (যেমন http://10.5.13.193:8810)
      remote_mgmt_ip:      client.remote_mgmt_ip
                            || (client.ip_address ? `http://${client.ip_address}:8810` : ''),
      remote_admin_user:   client.remote_admin_user   || '',
      remote_admin_pass:   client.remote_admin_pass   || '',
    });
    setEditMode(false);
  }, [client]);

  /* Remote Management IP prefill — save করা না থাকলে live IP (RADIUS/Mikrotik) দিয়ে রেডি default */
  useEffect(() => {
    if (!client || client.remote_mgmt_ip) return;   // DB-তে save করা থাকলে override নয়
    const liveIp = trafficData?.ip || radiusSession?.ip || client.ip_address || '';
    if (!liveIp) return;
    const def = `http://${liveIp}:8810`;
    setFormData(p => (p.remote_mgmt_ip ? p : { ...p, remote_mgmt_ip: def }));
  }, [client, trafficData, radiusSession]);

  /* tick — প্রতি সেকেন্ডে uptime live update */
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  /* RADIUS session fetch — client username দিয়ে match */
  const loadRadiusSession = useCallback(async (username) => {
    if (!username) return;
    setRadiusSession(null);
    setLastStopInfo(null);
    try {
      const r   = await api.get('/radius/online-users/');
      const key = String(username).toLowerCase();
      const sessions = r.data?.users || [];
      const session  = sessions.find(s => String(s.username || '').toLowerCase() === key) || null;
      setRadiusSession(session);
      const stopTimes = r.data?.last_stop_times || {};
      const stopInfo  = stopTimes[username] || stopTimes[key] || null;
      setLastStopInfo(stopInfo);
    } catch { /* silent — RADIUS না থাকলে চলবে */ }
  }, []);

  /* Mikrotik real-time traffic — online হলে tx-byte/rx-byte আনি */
  const loadTrafficData = useCallback(async (username) => {
    if (!username) return;
    setTrafficData(null);
    setTrafficLoading(true);
    try {
      const r = await api.get(`/mikrotik/traffic/${username}/`);
      if (r.data?.online) {
        setTrafficData(r.data);
      }
    } catch { /* silent — Mikrotik down হলে চলবে */ }
    finally { setTrafficLoading(false); }
  }, []);

  /* মাসিক RADIUS traffic history */
  const loadTrafficHistory = useCallback(async (username) => {
    if (!username) return;
    setTrafficHistory([]);
    setTrafficHistoryLoad(true);
    try {
      const r = await api.get('/radius/traffic-history/', { params: { username, months: 6 } });
      setTrafficHistory(r.data?.history || []);
    } catch { /* silent */ }
    finally { setTrafficHistoryLoad(false); }
  }, []);

  /* OLT info load — client load হলে auto-call */
  const loadOltInfo = useCallback(async (id) => {
    // Step 1: DB MAC cache — তুরন্ত আসে
    setOltMac(null);
    setOnuLog(null);
    try {
      const r = await api.get('/olt/mac-cache/', { params: { client: id, page_size: 1 } });
      const rows = getList(r.data);
      if (rows.length > 0) setOltMac(rows[0]);
    } catch { /* OLT না থাকলে silent */ }

    // Step 2: Telnet ONU log — background (~15-25s), আলাদা loading
    setOnuLogLoading(true);
    try {
      const r = await api.get(`/olt/onu-log/?client_id=${id}`);
      setOnuLog(r.data);
    } catch { /* Telnet সমস্যা হলে silent */ }
    finally { setOnuLogLoading(false); }
  }, []);

  // এই client-এর সব ticket লোড — Support module-এর Complain History সেকশনে দেখাব।
  // backend role-based filter (admin → সব ticket, employee → assigned/created)
  // অনুযায়ী data ফেরত আসবে; client_id ম্যাচ করে শুধু এই গ্রাহকের history।
  const loadTickets = useCallback(async (id) => {
    if (!id) return;
    try {
      const r = await api.get('/support/tickets/', {
        params: { client: id, page_size: 500, ordering: '-created_at' },
      });
      const list = getList(r.data);
      // safety filter — backend filter ছাড়াও আবার match (id type mismatch
      // হলেও সঠিক client-এর ticket-ই দেখাব)।
      const cid = Number(id);
      setTickets(list.filter(t => Number(t.client) === cid));
    } catch {
      setTickets([]);
    }
  }, []);

  const loadClient = useCallback(async (id) => {
    setLoading(true);
    setClient(null);
    try {
      const [cR, bR, pR, iR, sR, rR, clR, slR] = await Promise.all([
        api.get(`/clients/${id}/`),
        api.get('/billing/bills/',             { params: { client: id, page_size: 500 } }),
        api.get('/billing/payments/',          { params: { bill__client: id, page_size: 500 } }),
        api.get('/billing/installation-fees/', { params: { client: id } }),
        api.get('/sms/logs/',                  { params: { client: id, page_size: 500 } }),
        api.get('/change-requests/',           { params: { client: id } }),
        api.get('/client-change-logs/',        { params: { client: id, page_size: 500 } }),
        api.get('/client-status-logs/',        { params: { client: id, page_size: 500 } }),
      ]);
      setClient(cR.data);
      setBills(      getList(bR.data));
      setPayments(   getList(pR.data));
      setInstallFee( getList(iR.data)[0] || null);
      setSmsLogs(    getList(sR.data));
      setRemarks(    getList(rR.data));
      setChangeLogs( getList(clR.data));
      setStatusLogs( getList(slR.data));
      // Module 6 — সাপোর্ট টিকেট লোড (parallel; failure block করবে না)।
      loadTickets(id);
      // RADIUS + Mikrotik traffic + OLT — আলাদাভাবে load (block করবে না)
      loadRadiusSession(cR.data.username);
      loadTrafficData(cR.data.username);
      loadTrafficHistory(cR.data.username);
      loadOltInfo(id);
    } catch { toast.error('ক্লায়েন্ট তথ্য লোড করতে সমস্যা হয়েছে।'); }
    finally { setLoading(false); }
  }, [loadOltInfo, loadRadiusSession, loadTrafficData, loadTrafficHistory, loadTickets]);

  useEffect(() => {
    const clientId = searchParams.get('client');
    if (clientId) loadClient(clientId);
    const q = searchParams.get('q');
    if (q) setQuery(q);
  }, [searchParams, loadClient]);

  /* ── Quick-action: Kick Session (status অপরিবর্তিত, current session terminate) ── */
  const handleKick = useCallback(async () => {
    if (!client?.id) return;
    setActionBusy('kick');
    try {
      const { data } = await api.post(`/clients/${client.id}/kick-session/`);
      toast.success(data?.message || 'Session terminate করা হয়েছে।');
      // reconnect-এর পর নতুন session/IP দেখাতে একবার live data পুনরায় আনি
      setTimeout(() => {
        loadRadiusSession(client.username);
        loadTrafficData(client.username);
      }, 1500);
    } catch { toast.error('Kick session ব্যর্থ হয়েছে।'); }
    finally { setActionBusy(''); }
  }, [client, loadRadiusSession, loadTrafficData]);

  /* ── Quick-action: Enable/Disable (status toggle) ── */
  const handleToggleStatus = useCallback(async () => {
    if (!client?.id) return;
    const action = client.status === 'active' ? 'disable' : 'enable';
    setActionBusy('toggle');
    try {
      await api.post(`/clients/${client.id}/${action}/`);
      toast.success(action === 'disable' ? 'Client suspend করা হয়েছে।' : 'Client active করা হয়েছে।');
      loadClient(client.id);  // status + সব refresh
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Operation ব্যর্থ হয়েছে।');
    } finally { setActionBusy(''); }
  }, [client, loadClient]);

  useEffect(() => {
    const h = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setShowDropdown(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const doSearch = async (q, autoSelect = true) => {
    const sq = (q !== undefined ? q : query).trim();
    if (!sq) return;
    setSearching(true);
    if (autoSelect) setShowDropdown(false);
    try {
      const r = await api.get('/clients/', { params: { search: sq, page_size: 20 } });
      const list = getList(r.data);
      setSearchResults(list);
      if (autoSelect && list.length === 1) selectClient(list[0]);
      else if (list.length > 0)            setShowDropdown(true);
      else if (autoSelect)                 toast('কোনো ক্লায়েন্ট পাওয়া যায়নি।');
    } catch { toast.error('সার্চ করতে সমস্যা হয়েছে।'); }
    finally { setSearching(false); }
  };

  const selectClient = (c) => {
    setShowDropdown(false); setSearchResults([]);
    setSearchParams({ client: String(c.id) });
    loadClient(c.id);
  };

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(searchTimerRef.current);
    if (!val.trim()) { setSearchResults([]); setShowDropdown(false); return; }
    searchTimerRef.current = setTimeout(() => doSearch(val, false), 300);
  };

  const handleKeyDown = (e) => { if (e.key === 'Enter') { clearTimeout(searchTimerRef.current); doSearch(query, true); } };

  const set = (k) => (e) => setFormData(p => ({ ...p, [k]: e.target.value }));

  const handleUpdate = async () => {
    setSaving(true);
    try {
      const payload = { ...formData };
      // local state uses latitude/longitude but API expects map_lat/map_lng
      if (payload.latitude  !== undefined) { payload.map_lat = payload.latitude  || null; delete payload.latitude; }
      if (payload.longitude !== undefined) { payload.map_lng = payload.longitude || null; delete payload.longitude; }
      // DateField — খালি string ('') কে null করি, নইলে backend validation error
      if (payload.device_purchase_date === '') payload.device_purchase_date = null;
      await api.patch(`/clients/${client.id}/`, payload);
      toast.success('তথ্য সফলভাবে আপডেট হয়েছে।');
      setEditMode(false);
      loadClient(client.id);
    } catch (err) {
      const msg = err?.response?.data ? JSON.stringify(err.response.data) : 'আপডেট করতে সমস্যা হয়েছে।';
      toast.error(msg.slice(0, 120));
    } finally { setSaving(false); }
  };

  /* ── Editable Field ─── shows input/select in edit mode, readonly otherwise ── */
  function EF({ label, name, type = 'text', opts = null, readonlyVal = null }) {
    const val = formData[name] ?? '';
    const dispVal = readonlyVal !== null ? readonlyVal : val;
    return (
      <div>
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">
          {label}{editMode && IcoPencil}
        </p>
        {editMode ? (
          opts ? (
            <select value={val} onChange={set(name)}
              className="w-full border border-blue-400 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option value="">— Select —</option>
              {opts.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          ) : (
            <input type={type} value={val} onChange={set(name)}
              className="w-full border border-blue-400 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500" />
          )
        ) : (
          <input readOnly value={dispVal}
            className="w-full border border-gray-200 rounded px-3 py-1.5 text-sm bg-gray-50 text-gray-700 focus:outline-none" />
        )}
      </div>
    );
  }

  /* ── Section renderers ─────────────────────────────────────────── */

  function renderPersonal() {
    // Zone • SubZone • Box — যা API থেকে আসে
    const zoneParts = [client.zone_name, client.subzone_name, client.box_name].filter(Boolean);
    const zoneFull  = zoneParts.join(' • ');

    return (
      <Sec icon={IcoUser} title="Personal Information">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <EF label="CLIENT NAME"   name="full_name" />
          <EF label="MOBILE NUMBER" name="phone" />
          <EF label="PHONE NUMBER"  name="alt_phone" />
          <EF label="EMAIL"         name="email" type="email" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-3">
          <EF label="HOUSE NO."       name="house_no" />
          <EF label="ROAD NO."        name="road_no" />
          <EF label="ADDRESS DETAILS" name="address" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <RF label="CREATED ON"    value={fmtDate(client.created_at)} />
          <RF label="JOINED ON"     value={fmtDate(client.connection_date)} />
          <RF label="ZONE"          value={zoneFull} />
          <EF label="NID"           name="nid" />
        </div>
      </Sec>
    );
  }

  function renderConnectivity() {
    const isOnline = !!radiusSession;

    // UPTIME — online হলে session.start_time থেকে live হিসাব (tick দিয়ে প্রতি ১s update)
    const uptime = isOnline && radiusSession?.start_time
      ? formatUptime(radiusSession.start_time)
      : '';

    // LAST LOGOUT TIME — RADIUS last_stop_times থেকে
    const stopTime = lastStopInfo?.stop_time || (typeof lastStopInfo === 'string' ? lastStopInfo : null);
    const lastLogout = stopTime ? fmtDateTime(stopTime) : '';

    // IP ADDRESS — Mikrotik real-time > RADIUS session > client model
    const liveIp = trafficData?.ip || radiusSession?.ip || client.ip_address || '';

    // MAC ADDRESS — Mikrotik real-time caller_id > RADIUS callingstationid > client.mac_address
    const macAddr = trafficData?.caller_id || radiusSession?.caller_id || client.mac_address || '';

    // CONNECTIVITY STATUS — RADIUS session presence দিয়ে real-time
    const connStatus = isOnline ? 'Connected' : 'Disconnected';
    const connColor  = isOnline ? '#16a34a'   : '#dc2626';

    // DOWNLOADED / UPLOADED —
    //   1st priority: Mikrotik real-time interface bytes (trafficData)
    //   2nd priority: RADIUS radacct accumulated bytes (radiusSession)
    //   Loading: spinner দেখায়, value empty রাখে না — "Loading..." দেখায়
    let downloaded, uploaded;
    if (trafficLoading && trafficData == null) {
      // প্রথমবার লোড হচ্ছে — RADIUS fallback আপাতত দেখাই
      downloaded = radiusSession?.bytes_in != null ? formatBytes(radiusSession.bytes_in) : '—';
      uploaded   = radiusSession?.bytes_out != null ? formatBytes(radiusSession.bytes_out) : '—';
    } else if (trafficData != null) {
      // Mikrotik real-time data আছে — এটাই সবচেয়ে accurate
      downloaded = formatBytes(trafficData.bytes_in  ?? 0);
      uploaded   = formatBytes(trafficData.bytes_out ?? 0);
    } else {
      // Mikrotik data নেই — RADIUS radacct থেকে
      downloaded = radiusSession?.bytes_in  != null ? formatBytes(radiusSession.bytes_in)  : '';
      uploaded   = radiusSession?.bytes_out != null ? formatBytes(radiusSession.bytes_out) : '';
    }

    // CONNECTED DEVICE — Mikrotik server_name > RADIUS NAS identifier > NAS IP > client device
    const connDevice = trafficData?.server_name
      || radiusSession?.nas_identifier
      || radiusSession?.nas_ip
      || client.device || '';

    // Mikrotik uptime (real-time) vs RADIUS start_time
    const displayUptime = trafficData?.uptime || uptime;

    // চলতি মাসের মোট — radacct summary (trafficHistory[0]); না থাকলে fallback:
    //   current session bytes (radacct session > Mikrotik live) — অন্তত চলতি ব্যবহার দেখায়
    const monthRow = trafficHistory.length > 0 ? trafficHistory[0] : null;
    const monthIn  = monthRow ? monthRow.bytes_in
                   : (radiusSession?.bytes_in  ?? trafficData?.bytes_in  ?? null);
    const monthOut = monthRow ? monthRow.bytes_out
                   : (radiusSession?.bytes_out ?? trafficData?.bytes_out ?? null);
    const monthApprox = !monthRow;   // radacct summary নেই — session দিয়ে আনুমানিক

    return (
      <Sec icon={IcoNet} title="Connectivity Information">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          {/* UPTIME — Mikrotik real-time > RADIUS calculated */}
          <div>
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">UPTIME</p>
            <input readOnly value={displayUptime}
              className="w-full border border-gray-200 rounded px-3 py-1.5 text-sm bg-gray-50 font-mono focus:outline-none"
              style={{ color: isOnline && displayUptime ? '#16a34a' : '#374151' }} />
          </div>
          <RF label="LAST LOGOUT TIME"      value={lastLogout} />
          <RF label="MAC ADDRESS/CALLER ID" value={macAddr} />
          <RF label="IP ADDRESS"            value={liveIp} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <RF label="CONNECTED DEVICE" value={connDevice} />
          {/* CONNECTIVITY STATUS — real-time রঙ */}
          <div>
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">CONNECTIVITY STATUS</p>
            <input readOnly value={connStatus}
              className="w-full border border-gray-200 rounded px-3 py-1.5 text-sm bg-gray-50 font-semibold focus:outline-none"
              style={{ color: connColor }} />
          </div>
          {/* UPLOADED DATA — বাঁয়ে চলতি session (live, নীল), ডানে চলতি মাসের মোট */}
          <div>
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">
              UPLOADED DATA
              {trafficData != null && (
                <span className="ml-1 text-[9px] text-blue-400 font-normal normal-case">live</span>
              )}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {/* Session (live) */}
              <div>
                <div className="relative">
                  <input readOnly value={downloaded}
                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm bg-gray-50 text-blue-700 font-mono font-semibold focus:outline-none" />
                  {trafficLoading && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2">
                      <span className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin inline-block" />
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[9px] text-gray-400 uppercase tracking-wide">Session</p>
              </div>
              {/* This Month (radacct মাসিক মোট; না থাকলে session দিয়ে আনুমানিক) */}
              <div>
                <input readOnly value={monthIn != null ? formatBytes(monthIn) : '—'}
                  className="w-full border border-blue-200 rounded px-2 py-1.5 text-sm bg-blue-50 text-blue-800 font-mono font-semibold focus:outline-none" />
                <p className="mt-0.5 text-[9px] text-blue-400 uppercase tracking-wide">
                  This Month{monthApprox && monthIn != null && <span className="text-amber-500 normal-case">~approx</span>}
                </p>
              </div>
            </div>
          </div>
          {/* DOWNLOADED DATA — বাঁয়ে চলতি session (live, সবুজ), ডানে চলতি মাসের মোট */}
          <div>
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">
              DOWLOADED DATA
              {trafficData != null && (
                <span className="ml-1 text-[9px] text-green-400 font-normal normal-case">live</span>
              )}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {/* Session (live) */}
              <div>
                <div className="relative">
                  <input readOnly value={uploaded}
                    className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm bg-gray-50 text-green-700 font-mono font-semibold focus:outline-none" />
                  {trafficLoading && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2">
                      <span className="w-3 h-3 border-2 border-green-400 border-t-transparent rounded-full animate-spin inline-block" />
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[9px] text-gray-400 uppercase tracking-wide">Session</p>
              </div>
              {/* This Month (radacct মাসিক মোট; না থাকলে session দিয়ে আনুমানিক) */}
              <div>
                <input readOnly value={monthOut != null ? formatBytes(monthOut) : '—'}
                  className="w-full border border-green-200 rounded px-2 py-1.5 text-sm bg-green-50 text-green-800 font-mono font-semibold focus:outline-none" />
                <p className="mt-0.5 text-[9px] text-green-500 uppercase tracking-wide">
                  This Month{monthApprox && monthOut != null && <span className="text-amber-500 normal-case">~approx</span>}
                </p>
              </div>
            </div>
          </div>
        </div>
        {/* Remote Management — IP auto-fill (read-only); Username/Password global Edit toggle-এ editable */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          {/* REMOTE MANAGEMENT IP — auto-prefilled, read-only + ছোট "open" link (নতুন tab) */}
          <div>
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1 flex items-center justify-between">
              <span>REMOTE MANAGEMENT IP ADDRESS</span>
              {formData.remote_mgmt_ip ? (
                <a href={formData.remote_mgmt_ip} target="_blank" rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 hover:underline normal-case text-[10px] font-semibold">↗ open</a>
              ) : null}
            </p>
            <input readOnly value={formData.remote_mgmt_ip ?? ''}
              className="w-full border border-gray-200 rounded px-3 py-1.5 text-sm bg-gray-50 text-gray-700 focus:outline-none" />
          </div>
          {/* ADMIN USERNAME / PASSWORD — Edit toggle-এ editable (EF) */}
          <EF label="ADMIN USERNAME" name="remote_admin_user" />
          <EF label="ADMIN PASSWORD" name="remote_admin_pass" />
        </div>
      </Sec>
    );
  }

  function renderTrafficHistory() {
    /* মাসিক traffic summary (radacct থেকে) — last 6 months */
    const MONTHS_BN = { '01':'জানু','02':'ফেব্রু','03':'মার্চ','04':'এপ্রিল',
                        '05':'মে','06':'জুন','07':'জুলাই','08':'আগস্ট',
                        '09':'সেপ্টে','10':'অক্টো','11':'নভে','12':'ডিসে' };
    const fmtMonth = (m) => {
      if (!m) return '—';
      const [y, mo] = m.split('-');
      return `${MONTHS_BN[mo] || mo}-${y.slice(2)}`;
    };
    const fmtSecs = (s) => {
      if (!s) return '—';
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };

    /* current month bytes (for progress bars) */
    const maxIn  = Math.max(...trafficHistory.map(r => r.bytes_in  || 0), 1);
    const maxOut = Math.max(...trafficHistory.map(r => r.bytes_out || 0), 1);

    return (
      <Sec icon={IcoNet} title="Monthly Traffic History">
        {trafficHistoryLoad ? (
          <div className="flex items-center gap-2 px-4 py-6 text-gray-400 text-sm">
            <span className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            লোড হচ্ছে...
          </div>
        ) : trafficHistory.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-400">কোনো traffic data পাওয়া যায়নি।</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#1c2333] text-white/80 text-[10px] uppercase tracking-wider">
                  <th className="px-4 py-2.5 text-left font-semibold">মাস</th>
                  <th className="px-4 py-2.5 text-center font-semibold">Session</th>
                  <th className="px-4 py-2.5 text-left font-semibold">↓ ডাউনলোড</th>
                  <th className="px-4 py-2.5 text-left font-semibold">↑ আপলোড</th>
                  <th className="px-4 py-2.5 text-right font-semibold">মোট সময়</th>
                </tr>
              </thead>
              <tbody>
                {trafficHistory.map((row, i) => {
                  const dlPct  = Math.round((row.bytes_in  / maxIn)  * 100);
                  const ulPct  = Math.round((row.bytes_out / maxOut) * 100);
                  const isEven = i % 2 === 0;
                  return (
                    <tr key={row.month} className={isEven ? 'bg-white' : 'bg-[#f8fafc]'}>
                      <td className="px-4 py-2.5 font-semibold text-gray-700">
                        {fmtMonth(row.month)}
                      </td>
                      <td className="px-4 py-2.5 text-center text-gray-500">
                        {row.sessions}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="w-16 text-right font-mono text-blue-700 font-semibold shrink-0">
                            {formatBytes(row.bytes_in)}
                          </span>
                          <div className="flex-1 h-2 rounded-full bg-blue-100 overflow-hidden">
                            <div className="h-full rounded-full bg-blue-500 transition-all"
                              style={{ width: `${dlPct}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="w-16 text-right font-mono text-green-700 font-semibold shrink-0">
                            {formatBytes(row.bytes_out)}
                          </span>
                          <div className="flex-1 h-2 rounded-full bg-green-100 overflow-hidden">
                            <div className="h-full rounded-full bg-green-500 transition-all"
                              style={{ width: `${ulPct}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-500 font-mono">
                        {fmtSecs(row.total_seconds)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-[#f1f5f9] border-t border-gray-200">
                  <td className="px-4 py-2.5 font-bold text-gray-700 text-[10px] uppercase">মোট</td>
                  <td className="px-4 py-2.5 text-center font-bold text-gray-700">
                    {trafficHistory.reduce((s, r) => s + r.sessions, 0)}
                  </td>
                  <td className="px-4 py-2.5 font-bold font-mono text-blue-700">
                    {formatBytes(trafficHistory.reduce((s, r) => s + r.bytes_in, 0))}
                  </td>
                  <td className="px-4 py-2.5 font-bold font-mono text-green-700">
                    {formatBytes(trafficHistory.reduce((s, r) => s + r.bytes_out, 0))}
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold text-gray-700 font-mono">
                    {fmtSecs(trafficHistory.reduce((s, r) => s + r.total_seconds, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Sec>
    );
  }

  function renderServerBilling() {
    return (
      <Sec icon={IcoSrv} title="Server and Billing Information">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <EF label="PACKAGE"      name="package"      opts={packages}    readonlyVal={client.package_name} />
          <EF label="MONTHLY BILL" name="monthly_bill" type="number" />
          <EF label="ZONE"         name="zone"         opts={zones}       readonlyVal={client.zone_name} />
          <EF label="EXPIRY DATE"  name="expiry_date"  type="date" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <EF label="PROFILE"     name="pppoe_profile" />
          <EF label="CLIENT TYPE" name="client_type"   opts={clientTypes} readonlyVal={client.client_type_name} />
          <EF label="SUB ZONE"    name="subzone"       opts={subzones}    readonlyVal={client.subzone_name} />
          <EF label="MONTHLY AMOUNT MONTH" name="monthly_amount_month" type="number" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <EF label="PROTOCOL"   name="protocol"  opts={protocols}  readonlyVal={client.protocol_name} />
          <EF label="BOX"        name="box"       opts={boxes}      readonlyVal={client.box_name} />
          <EF label="SERVER"     name="router"    opts={servers}    readonlyVal={client.router_name} />
          <EF label="USERNAME"   name="username" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <EF label="PASSWORD"     name="password" />
          <EF label="DISCOUNT"     name="discount"   type="number" />
          <EF label="BILL DATE"    name="bill_date"  type="number" />
          <RF label="DUE AMOUNT"   value={client.due_amount ? `${client.due_amount} BDT` : '0.00 BDT'} />
        </div>
      </Sec>
    );
  }

  function renderOLT() {
    // ── DB MAC cache (fast, from /olt/mac-cache/) ──────────────────
    const oltIp     = oltMac?.olt_ip_address || '';
    const oltName   = oltMac?.olt_name       || '';
    const rxDbm     = oltMac?.rx_power_dbm;
    const rxPower   = rxDbm != null ? `${rxDbm} dBm` : '';
    const oltPort   = oltMac?.port            || '';
    const onuMac    = oltMac?.mac             || '';
    const onuId     = oltMac?.onu             || '';
    const oltStatus = oltMac?.status          || '';
    const distMac   = oltMac?.distance_m      ? `${oltMac.distance_m} m` : '';

    // ── Telnet ONU log (background, ~15-25s) ───────────────────────
    const lastReg     = onuLog?.last_reg      || '';
    const lastUnreg   = onuLog?.last_dereg    || '';
    const disconnReason = onuLog?.dereg_reason || '';
    const aliveTime   = onuLog?.alive_time    || '';

    const statusColor = oltStatus === 'online'  ? '#16a34a'
                      : oltStatus === 'offline' ? '#dc2626'
                      : '#6b7280';

    const rxColor = rxDbm != null
      ? rxDbm >= -20 ? '#16a34a'
      : rxDbm >= -25 ? '#0d9488'
      : rxDbm >= -28 ? '#d97706' : '#dc2626'
      : '';

    const reasonColor = disconnReason.toLowerCase().includes('power') ? '#ea580c'
                      : disconnReason.toLowerCase().includes('dying')  ? '#dc2626'
                      : disconnReason.toLowerCase().includes('loss')   ? '#dc2626'
                      : disconnReason ? '#6b7280' : '';

    // Telnet-এর জন্য loading placeholder
    const ph = onuLogLoading ? 'Loading...' : '';

    return (
      <Sec icon={IcoOlt} title="OLT Information"
        badge={onuLogLoading ? 'Syncing...' : (onuLog ? 'Live' : undefined)}>
        {/* Row 1 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <RF       label="CLIENT MAC ADDRESS" value={client.mac_address} />
          <RF       label="OLT IP ADDRESS"     value={oltIp} />
          <RF       label="OLT NAME"           value={oltName} />
          <RFColor  label="OPTICAL POWER"      value={rxPower} color={rxColor} />
        </div>
        {/* Row 2 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <RF       label="OLT PORT"           value={oltPort} />
          <RF       label="ONU MAC ADDRESS"    value={onuMac} />
          <RF       label="ONU ID"             value={onuId ? `ONU ${onuId}` : ''} />
          <RFColor  label="STATUS"             value={oltStatus.toUpperCase()} color={statusColor} />
        </div>
        {/* Row 3 — Telnet data */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <RF       label="LAST REGISTERED TIME"   value={lastReg   || ph} />
          <RF       label="LAST UNREGISTERED TIME" value={lastUnreg || ph} />
          <RF       label="ALIVE TIME"             value={aliveTime || ph} />
          <RF       label="DISTANCE"               value={distMac} />
        </div>
        {/* Row 4 */}
        <div className="grid grid-cols-1 gap-3">
          <RFColor  label="DISCONNECT REASON"  value={disconnReason || ph} color={reasonColor} />
        </div>
      </Sec>
    );
  }

  function renderNetworkProduct() {
    return (
      <Sec icon={IcoNPrd} title="Network and Product Information">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          {/* DEVICE: manual মান না থাকলে client-এর assigned রাউটারের নাম দেখায় */}
          <EF label="DEVICE"                  name="device"
              readonlyVal={formData.device || client?.router_name || ''} />
          <EF label="PACKAGE NO."             name="package_no" />
          <EF label="OPTICAL FIBER"           name="optical_fiber" />
          <EF label="REQUIRE CABLE IN METER"  name="cable_meter" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          {/* VENDOR: manual মান না থাকলে MAC OUI থেকে detect করা vendor দেখায় */}
          <EF label="VENDOR"                  name="vendor"
              readonlyVal={formData.vendor || client?.mac_vendor || ''} />
          <EF label="LATITUDE"                name="latitude" />
          <EF label="LONGITUDE"               name="longitude" />
          <EF label="SERIAL NO."              name="serial_no" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          <EF label="FIBER CODE"              name="fiber_code" />
          <EF label="COLOR OF CORD"           name="color_of_cord" />
          <EF label="DEVICE PURCHASE DATE"    name="device_purchase_date" type="date" />
        </div>
      </Sec>
    );
  }

  // Complain / Support Ticket history — Module 6 backend থেকে live load।
  // priorityClass / statusClass — কালার-কোডেড badge দেখানোর জন্য।
  function renderComplain() {
    const priorityClass = (p) => ({
      low:      'bg-gray-100 text-gray-600',
      medium:   'bg-blue-100 text-blue-700',
      high:     'bg-amber-100 text-amber-700',
      critical: 'bg-red-100 text-red-700',
      urgent:   'bg-red-100 text-red-700',
    }[p] || 'bg-gray-100 text-gray-600');

    const statusClass = (s) => ({
      open:        'bg-amber-100 text-amber-700',
      in_progress: 'bg-blue-100 text-blue-700',
      resolved:    'bg-emerald-100 text-emerald-700',
      closed:      'bg-gray-100 text-gray-500',
    }[s] || 'bg-gray-100 text-gray-600');

    // open → solved পর্যন্ত মোট সময় হিসাব (resolved/closed হলে freeze)।
    const durationHours = (r) => {
      if (!r.created_at) return '';
      const end = (r.resolved_at || r.closed_at) ? new Date(r.resolved_at || r.closed_at) : new Date();
      const ms  = end.getTime() - new Date(r.created_at).getTime();
      const h   = Math.max(0, Math.floor(ms / 3600000));
      const m   = Math.max(0, Math.floor((ms % 3600000) / 60000));
      if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
      if (h > 0)  return `${h}h ${m}m`;
      return `${m}m`;
    };

    return (
      <Sec icon={IcoComp} title="All Complain History" badge={tickets.length > 0 ? String(tickets.length) : undefined}>
        <PagedTable columns={[
          { key: 'ticket_no',        label: 'TicketNo',
            render: r => <span className="font-mono text-xs font-semibold text-teal-700">{r.ticket_no || r.ticket_id}</span> },
          { key: 'ticket_type_name', label: 'Type',
            render: r => r.ticket_type_name || '—' },
          { key: 'subject',          label: 'Subject',
            render: r => <span className="text-gray-700">{r.subject}</span> },
          { key: 'priority',         label: 'Priority',
            render: r => <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${priorityClass(r.priority)}`}>
              {r.priority_display || r.priority}
            </span> },
          { key: 'created_at',       label: 'Opened',
            render: r => <span className="font-mono text-xs">{fmtDateTime(r.created_at)}</span> },
          { key: 'created_by_name',  label: 'CreatedBy',
            render: r => r.created_by_name || '—' },
          { key: 'status',           label: 'Status',
            render: r => <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${statusClass(r.status)}`}>
              {r.status_display || r.status}
            </span> },
          { key: 'assigned_employee_name', label: 'AssignTo',
            render: r => r.assigned_employee_name || <span className="text-gray-400 italic">Unassigned</span> },
          { key: 'resolved_at',      label: 'SolvedTime',
            render: r => r.resolved_at || r.closed_at
              ? <span className="font-mono text-xs text-emerald-700">{fmtDateTime(r.resolved_at || r.closed_at)}</span>
              : <span className="text-gray-300">—</span> },
          { key: 'duration',         label: 'Duration',
            render: r => <span className="font-mono text-xs text-gray-600">{durationHours(r)}</span> },
        ]} rows={tickets} />
      </Sec>
    );
  }

  function renderRemarks() {
    return (
      <Sec icon={IcoRmrk} title="All Remarks History">
        <PagedTable columns={[
          { key: 'request_type', label: 'RemarksType', render: r => r.request_type === 'package_change' ? 'EffectiveToChange' : (r.request_type || '—') },
          { key: 'reason',       label: 'Remarks' },
          { key: 'created_at',   label: 'RemarksDate', render: r => fmtDateTime(r.created_at) },
          { key: 'requested_by', label: 'RemarksBy',   render: r => r.requested_by || 'admin' },
        ]} rows={remarks} />
      </Sec>
    );
  }

  function renderMessage() {
    return (
      <Sec icon={IcoMsg} title="All Message History">
        <PagedTable columns={[
          { key: 'template', label: 'SMSType',  render: r => r.template ? String(r.template) : 'Due' },
          { key: 'message',  label: 'SMSText' },
          { key: 'sent_at',  label: 'SendDate', render: r => fmtDate(r.sent_at || r.created_at) },
          { key: 'status',   label: 'Status',   render: r => <span className={r.status === 'sent' ? 'text-green-600' : r.status === 'failed' ? 'text-red-500' : 'text-gray-500'}>{r.status || ''}</span> },
          { key: 'sent_by',  label: 'SendBy',   render: r => r.sent_by || '' },
        ]} rows={smsLogs} />
      </Sec>
    );
  }

  function renderPayments() {
    return (
      <Sec icon={IcoPay} title="Received Bill History">
        <PagedTable columns={[
          { key: 'payment_date',   label: 'ReceiveDate',  render: r => fmtDate(r.payment_date) },
          { key: 'received_by',    label: 'ReceivedBy',   render: r => r.received_by_name || r.received_by || '—' },
          { key: 'payment_method', label: 'PaymentInfo',  render: r => <span>Payment by - <strong className="capitalize">{r.payment_method}</strong></span> },
          { key: 'notes',          label: 'Remarks/Note', render: r => r.notes || '' },
          { key: 'discount',       label: 'Discount',     render: () => '0' },
          { key: 'amount',         label: 'ReceivedBill' },
          { key: 'totalBill',      label: 'TotalBill',    render: r => r.amount },
        ]} rows={payments} />
      </Sec>
    );
  }

  function renderBills() {
    return (
      <Sec icon={IcoBill} title="Generated Bill/Invoices">
        <PagedTable columns={[
          { key: 'status',     label: '+/-',         render: r => <span className={`inline-block w-3 h-3 rounded-full ${r.status === 'paid' ? 'bg-green-500' : r.status === 'partial' ? 'bg-yellow-500' : 'bg-red-400'}`} /> },
          { key: 'due_date',   label: 'Date',        render: r => fmtDate(r.due_date || (r.bill_month + '-10')) },
          { key: 'bill_month', label: 'BillingMonth', render: r => fmtBillMonth(r.bill_month) },
          { key: 'package',    label: 'Package',     render: () => client?.package_name || '—' },
          { key: 'speed',      label: 'Speed',       render: () => client?.pppoe_profile || '—' },
          { key: 'net_amount', label: 'BillAmount' },
          { key: 'action',     label: 'Action',      render: () => <button onClick={() => toast('Coming soon')} className="text-green-600 text-base">✎</button> },
        ]} rows={bills} />
      </Sec>
    );
  }

  function renderEnableLog() {
    return (
      <Sec icon={IcoLog} title="Customer Enable-Disable Logs">
        <DateFilter />
        <PagedTable columns={[
          { key: 'customer_id',     label: 'Customer ID' },
          { key: 'username',        label: 'UserName' },
          { key: 'password',        label: 'Password' },
          { key: 'full_name',       label: 'Name' },
          { key: 'phone',           label: 'Mobile' },
          { key: 'remarks',         label: 'Remarks',    render: r => <span className={`px-2 py-0.5 rounded text-xs font-medium ${r.mikrotik_status ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{r.remarks || (r.mikrotik_status ? 'Enabled' : 'Disabled')}</span> },
          { key: 'mikrotik_status', label: 'M.Status',   render: r => <Toggle active={r.mikrotik_status} /> },
          { key: 'changed_by_name', label: 'ChangedBy',  render: r => r.changed_by_name || '—' },
          { key: 'changed_at',      label: 'ChangedDate', render: r => fmtDateTime(r.changed_at) },
        ]} rows={statusLogs} />
      </Sec>
    );
  }

  function renderChangeLog() {
    return (
      <Sec icon={IcoLog} title="Customer Change Logs">
        <DateFilter />
        <PagedTable columns={[
          { key: 'customer_id',     label: 'Customer ID' },
          { key: 'full_name',       label: 'Name' },
          { key: 'phone',           label: 'Mobile' },
          { key: 'service',         label: 'Service/Remarks/B.Status/M.Status' },
          { key: 'billing_status',  label: 'B.Status',   render: r => r.billing_status ? <span className={`px-1.5 py-0.5 rounded text-xs font-medium capitalize ${r.billing_status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{r.billing_status}</span> : '—' },
          { key: 'mikrotik_status', label: 'M.Status',   render: r => <Toggle active={r.mikrotik_status} /> },
          { key: 'server',          label: 'Server' },
          { key: 'speed',           label: 'Speed' },
          { key: 'package',         label: 'Package' },
          { key: 'protocol',        label: 'Protocol' },
          { key: 'monthly_bill',    label: 'M.Bill' },
          { key: 'expiry_date',     label: 'Ex.Date',    render: r => fmtDate(r.expiry_date) },
          { key: 'zone',            label: 'Zone' },
          { key: 'changed_by_name', label: 'ChangedBy',  render: r => r.changed_by_name || '—' },
          { key: 'changed_at',      label: 'ChangedDate', render: r => fmtDateTime(r.changed_at) },
        ]} rows={changeLogs} />
      </Sec>
    );
  }

  function renderInvoices() {
    return (
      <Sec icon={IcoInv} title="Product & Service Sales Invoices">
        <PagedTable columns={[
          { key: 'CustomerName',  label: 'CustomerName' }, { key: 'InvoiceType', label: 'Invoice Type' },
          { key: 'InvoiceNo',     label: 'InvoiceNo' },    { key: 'TotalAmount', label: 'Total Amount' },
          { key: 'ReceiveAmount', label: 'Receive Amount'},{ key: 'Due',         label: 'Due' },
          { key: 'Status',        label: 'Status' },
        ]} rows={[]} />
      </Sec>
    );
  }

  function renderInstallation() {
    return (
      <Sec icon={IcoInst} title="Installation Charge Information">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <RF label="CHARGE CREATED ON" value={installFee ? fmtDate(installFee.created_at) : ''} />
          <RF label="INSTALLATION FEE"  value={installFee ? String(installFee.amount) : '0.00'} />
          <RF label="PAID AMOUNT"       value={installFee ? String(installFee.paid_amount) : '0.00'} />
          <RF label="DUE AMOUNT"        value={installFee ? (parseFloat(installFee.amount) - parseFloat(installFee.paid_amount)).toFixed(2) : '0.00'} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          <RF label="PAYMENT METHOD" value={installFee?.payment_method || ''} />
          <RF label="PAYMENT DATE"   value={installFee ? fmtDate(installFee.payment_date || installFee.created_at) : ''} />
          <RF label="RECEIVED BY"    value="" />
        </div>
      </Sec>
    );
  }

  /* ── Render ────────────────────────────────────────────────────── */
  // Router admin link ও quick-action-এর জন্য live WAN IP
  // (Mikrotik real-time > RADIUS session > client model)
  const liveIp = trafficData?.ip || radiusSession?.ip || client?.ip_address || '';

  return (
    <div className="p-4 min-h-screen bg-gray-100">

      {/* Title */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <h1 className="font-semibold text-gray-700 text-base">Customer Search</h1>
        </div>
        <nav className="hidden sm:block text-xs text-gray-400">Client &gt; Customer Search</nav>
      </div>

      {/* ── Action panel ─────────────────────────────────────────── */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-5 py-4 mb-4">
        {client ? (
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 w-full">

            {/* ── Left: Client info ── */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Customer ID */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Customer ID</p>
                <input readOnly value={client.customer_id || client.id}
                  className="border border-gray-200 rounded-md px-3 py-1.5 text-sm bg-gray-50 w-28 font-mono font-bold text-gray-800 focus:outline-none" />
              </div>

              {/* User ID / IP */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">User ID / IP</p>
                <input readOnly value={client.username || client.ip_address || ''}
                  className="border border-gray-200 rounded-md px-3 py-1.5 text-sm bg-gray-50 w-36 font-mono text-gray-700 focus:outline-none" />
              </div>

              {/* Divider */}
              <div className="hidden sm:block h-8 w-px bg-gray-200 self-end mb-0.5" />

              {/* Status badge + Toggle */}
              <div className="flex items-center gap-2 self-end mb-0.5">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold tracking-wide
                  ${client.status === 'active'
                    ? 'bg-green-50 text-green-700 ring-1 ring-green-200'
                    : 'bg-gray-100 text-gray-500 ring-1 ring-gray-200'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${client.status === 'active' ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                  {client.status === 'active' ? 'Online' : 'Offline'}
                </span>
                <Toggle active={client.status === 'active'} />
              </div>
            </div>

            {/* ── Right: Action buttons ── */}
            <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
              {/* + Open Ticket */}
              <button
                onClick={() => setShowOpenTicket(true)}
                className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-1.5 rounded-md shadow-sm transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Open Ticket
              </button>

              {/* ── Quick-actions: Kick / Enable-Disable / Router / Recharge ── */}
              {/* Kick Session — status অপরিবর্তিত, current session terminate */}
              <button onClick={handleKick} disabled={actionBusy === 'kick'}
                title="বর্তমান session কেটে দিয়ে নতুন setting/IP দিয়ে reconnect করায়"
                className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-semibold px-3 py-1.5 rounded-md shadow-sm transition-colors">
                {actionBusy === 'kick'
                  ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>}
                Kick
              </button>

              {/* ── নিচের সব action শুধুমাত্র admin role (superadmin/admin)। ── */}
              {/* অন্য role: শুধু Open Ticket ও Kick করতে পারবে। */}
              {isAdmin && (
                <>
                  {/* Enable / Disable — status toggle */}
                  <button onClick={handleToggleStatus} disabled={actionBusy === 'toggle'}
                    title={client.status === 'active' ? 'গ্রাহককে suspend করুন' : 'গ্রাহককে active করুন'}
                    className={`flex items-center gap-1.5 disabled:opacity-50 text-white text-sm font-semibold px-3 py-1.5 rounded-md shadow-sm transition-colors
                      ${client.status === 'active' ? 'bg-rose-500 hover:bg-rose-600' : 'bg-green-600 hover:bg-green-700'}`}>
                    {actionBusy === 'toggle'
                      ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.636 5.636a9 9 0 1012.728 0M12 3v9" /></svg>}
                    {client.status === 'active' ? 'Disable' : 'Enable'}
                  </button>

                  {/* Router Admin — live IP:8810 → গ্রাহকের router admin panel */}
                  {liveIp && (
                    <a href={`http://${liveIp}:8810`} target="_blank" rel="noopener noreferrer"
                      title={`রাউটারের অ্যাডমিন প্যানেল (${liveIp}:8810)`}
                      className="flex items-center gap-1.5 bg-slate-600 hover:bg-slate-700 text-white text-sm font-semibold px-3 py-1.5 rounded-md shadow-sm transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V8a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 01-2 2M5 12a2 2 0 00-2 2v2a2 2 0 002 2h14a2 2 0 002-2v-2a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>
                      Router
                    </a>
                  )}

                  {/* Recharge — ঐ গ্রাহকের bill filter করে Billing পেজে নিয়ে যায় */}
                  <button onClick={() => navigate(`/billing/bills?search=${encodeURIComponent(client.customer_id || client.username || client.id)}`)}
                    title="বিল পরিশোধ / রিচার্জ"
                    className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-3 py-1.5 rounded-md shadow-sm transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                    Recharge
                  </button>

                  {/* Edit toggle */}
                  <label className="flex items-center gap-1.5 cursor-pointer select-none border border-gray-200 rounded-md px-3 py-1.5 bg-gray-50 hover:bg-gray-100 transition-colors">
                    <input type="checkbox" checked={editMode} onChange={e => setEditMode(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-gray-300 cursor-pointer accent-blue-600" />
                    <span className="text-sm font-semibold text-gray-600">Edit</span>
                  </label>

                  {/* Update */}
                  <button onClick={handleUpdate} disabled={!editMode || saving}
                    className={`flex items-center gap-1.5 text-sm font-semibold px-4 py-1.5 rounded-md transition-all
                      ${editMode
                        ? 'bg-blue-500 hover:bg-blue-600 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200'}`}>
                    {saving
                      ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>}
                    Update
                  </button>

                  {/* Download Profile */}
                  <button onClick={() => toast('Downloading...')}
                    style={{ backgroundColor: '#23445f' }}
                    className="flex items-center gap-1.5 hover:opacity-90 text-white text-sm font-semibold px-4 py-1.5 rounded-md shadow-sm transition-opacity">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download Profile
                  </button>
                </>
              )}
            </div>

          </div>
        ) : (
          <div className="flex items-center gap-2 py-1 text-sm text-gray-400">
            <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <span>উপরে টপবারের সার্চ বক্স থেকে একটি ক্লায়েন্ট বেছে নিন।</span>
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            লোড হচ্ছে...
          </div>
        </div>
      )}

      {/* No client */}
      {!loading && !client && (
        <div className="flex flex-col items-center justify-center h-48 text-gray-400">
          <svg className="w-12 h-12 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-sm">ক্লায়েন্ট খুঁজতে উপরের সার্চ ফর্ম ব্যবহার করুন।</p>
        </div>
      )}

      {/* All sections */}
      {!loading && client && (
        <div className="space-y-4">
          {renderPersonal()}
          {renderConnectivity()}
          {renderServerBilling()}
          {renderOLT()}
          {renderNetworkProduct()}
          {renderComplain()}
          {renderRemarks()}
          {renderMessage()}
          {renderPayments()}
          {renderBills()}
          {renderEnableLog()}
          {renderChangeLog()}
          {renderInvoices()}
          {renderInstallation()}
        </div>
      )}

      {/* Module 6 — "+ Open Ticket" modal; client snapshot pre-bound */}
      {showOpenTicket && client && (
        <OpenTicketModal
          client={client}
          onClose={() => setShowOpenTicket(false)}
          onCreated={() => { setShowOpenTicket(false); loadTickets(client.id); }}
        />
      )}
    </div>
  );
}
