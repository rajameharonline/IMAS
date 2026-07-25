import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useSoftphone } from '../../voip/SoftphoneContext';

/* ── Formatters ─────────────────────────────────────────────────────────── */
function fmtDate(v) {
  if (!v) return '—';
  try { return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return v; }
}
function fmtDateTime(v) {
  if (!v) return '—';
  try {
    const d = new Date(v);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch { return v; }
}
function fmtBillMonth(v) {
  if (!v) return '—';
  const [y, m] = v.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short' }) + '-' + y.slice(2);
}
const money = v => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });

/* ── Shared UI Components ───────────────────────────────────────────────── */

function CardSection({ title, children, action }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 shadow-sm">
      <div className="flex items-center justify-between bg-[#1c2333] px-4 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-white/80">{title}</p>
        {action && <div>{action}</div>}
      </div>
      {children}
    </div>
  );
}

function InfoGrid({ rows }) {
  return (
    <div className="divide-y divide-gray-100 text-xs">
      {rows.map((cols, i) => (
        // মোবাইলে প্রতি জোড়া আলাদা সারিতে (grid-cols-1), sm+ থেকে পাশাপাশি দুই কলাম
        <div key={i} className={`grid grid-cols-1 ${cols.length === 1 ? '' : 'sm:grid-cols-2'} ${i % 2 === 0 ? 'bg-white' : 'bg-[#f8fafc]'}`}>
          {cols.map((col, j) => (
            <div key={j} className="flex items-start border-b border-gray-100 px-3 py-2.5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 sm:px-4">
              <span className="w-28 shrink-0 font-semibold text-[#5a7a90] sm:w-48">{col.label}</span>
              <span className="mx-2 shrink-0 text-gray-300">:</span>
              <span className="flex-1 break-words font-medium text-gray-800">{col.value ?? '—'}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ModernTable({ columns, rows, emptyText = 'No data available' }) {
  const [perPage, setPerPage] = useState(10);
  const [search,  setSearch]  = useState('');
  const [page,    setPage]    = useState(1);

  const filtered = search.trim() === ''
    ? rows
    : rows.filter(row =>
        columns.some(c =>
          String(c.render ? (typeof row[c.key] === 'string' ? row[c.key] : '') : (row[c.key] ?? ''))
            .toLowerCase().includes(search.toLowerCase())
        )
      );
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const slice      = filtered.slice((page - 1) * perPage, page * perPage);

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          <span className="font-semibold uppercase tracking-wider">Show</span>
          <select value={perPage} onChange={e => { setPerPage(+e.target.value); setPage(1); }}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#1c2333]">
            {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="font-semibold uppercase tracking-wider">Entries</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#5a7a90]">Search:</span>
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-48 rounded-lg border border-gray-200 px-3 py-1.5 text-xs outline-none transition focus:border-[#1c2333] focus:ring-1 focus:ring-[#1c2333]/20" />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[#1c2333] text-left text-[10px] font-bold uppercase tracking-wider text-white/80">
              {columns.map(c => (
                <th key={c.key} className="whitespace-nowrap border-r border-white/10 px-3 py-3 last:border-r-0">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {slice.length === 0 ? (
              <tr><td colSpan={columns.length} className="py-12 text-center text-gray-400">{emptyText}</td></tr>
            ) : slice.map((row, i) => (
              <tr key={i} className={`transition-colors hover:bg-[#f0f6fa] ${i % 2 === 1 ? 'bg-gray-50/60' : 'bg-white'}`}>
                {columns.map(c => (
                  <td key={c.key} className="whitespace-nowrap border-r border-gray-100 px-3 py-2.5 last:border-r-0">
                    {c.render ? c.render(row) : (row[c.key] ?? <span className="text-gray-300">—</span>)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>Showing {filtered.length === 0 ? 0 : (page - 1) * perPage + 1}–{Math.min(page * perPage, filtered.length)} of {filtered.length}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="rounded-lg border border-gray-200 px-3 py-1.5 font-medium transition hover:bg-gray-50 disabled:opacity-40">← Prev</button>
          {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(p => (
            <button key={p} onClick={() => setPage(p)}
              className={`rounded-lg border px-3 py-1.5 font-medium transition ${p === page ? 'border-[#1c2333] bg-[#1c2333] text-white' : 'border-gray-200 hover:bg-gray-50'}`}>
              {p}
            </button>
          ))}
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="rounded-lg border border-gray-200 px-3 py-1.5 font-medium transition hover:bg-gray-50 disabled:opacity-40">Next →</button>
        </div>
      </div>
    </div>
  );
}

function TabBtn({ label, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all ${
        active
          ? 'bg-[#1c2333] text-white shadow-sm'
          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
      }`}>
      {label}
    </button>
  );
}

function StatusBadge({ status }) {
  const map = {
    active:    'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    inactive:  'bg-gray-100 text-gray-500 ring-1 ring-gray-200',
    suspended: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
    expired:   'bg-red-50 text-red-600 ring-1 ring-red-200',
    left:      'bg-red-50 text-red-600 ring-1 ring-red-200',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold capitalize ${map[status] || 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  );
}

function Toggle({ active }) {
  return (
    <div className={`relative inline-flex h-5 w-9 cursor-default items-center rounded-full transition-colors ${active ? 'bg-emerald-500' : 'bg-gray-300'}`}>
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${active ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
    </div>
  );
}

function DateFilter() {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3">
      {[['FROM DATE', 'date_from'], ['TO DATE', 'date_to']].map(([lbl]) => (
        <div key={lbl}>
          <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[#5a7a90]">{lbl}</label>
          <input type="date" className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs outline-none transition focus:border-[#1c2333] focus:ring-1 focus:ring-[#1c2333]/20" />
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, sub, gradient }) {
  return (
    <div className={`relative overflow-hidden rounded-xl p-4 text-white shadow ${gradient}`}>
      <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">{label}</p>
      <p className="mt-1.5 text-2xl font-extrabold">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] opacity-70">{sub}</p>}
    </div>
  );
}

const TABS_ROW1 = [
  { key: 'service',  label: 'Service Information' },
  { key: 'network',  label: 'Network & Product' },
  { key: 'personal', label: 'Personal Information' },
  { key: 'bills',    label: 'Bills / Invoices' },
  { key: 'payments', label: 'Bill History' },
  { key: 'complain', label: 'Complain History' },
];
const TABS_ROW2 = [
  { key: 'remarks',     label: 'Remarks History' },
  { key: 'message',     label: 'Message History' },
  { key: 'activitylog', label: 'Activity Log' },
  { key: 'changelog',   label: 'Change Log' },
  { key: 'enablelog',   label: 'Enable/Disable Log' },
  { key: 'invoices',    label: 'Sales Invoices' },
];

/* ── Main Component ─────────────────────────────────────────────────────── */
export default function ClientProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const isSuperAdmin = currentUser?.role === 'superadmin' || currentUser?.role === 'admin';
  const softphone = useSoftphone();  // VoIP — client-কে কল করার জন্য

  const [client,     setClient]     = useState(null);
  const [bills,      setBills]      = useState([]);
  const [payments,   setPayments]   = useState([]);
  const [installFee, setInstallFee] = useState(null);
  const [smsLogs,    setSmsLogs]    = useState([]);
  const [remarks,    setRemarks]    = useState([]);
  const [changeLogs,    setChangeLogs]    = useState([]);
  const [statusLogs,    setStatusLogs]    = useState([]);
  const [activityLogs,    setActivityLogs]    = useState([]);
  const [actFilterType,   setActFilterType]   = useState('');
  const [actSearch,       setActSearch]       = useState('');

  // ── log category constants ─────────────────────────────────────────
  const ENABLE_DISABLE_TYPES = ['client_enabled', 'client_disabled'];
  const CHANGE_LOG_TYPES     = ['profile_updated', 'package_changed', 'status_changed'];
  // Activity Log = উপরের দুটো ছাড়া বাকি সব

  // ── derived log lists (activityLogs একটাই source) ──────────────────
  const enableDisableLogs = activityLogs.filter(l => ENABLE_DISABLE_TYPES.includes(l.event_type));
  const changeOnlyLogs    = activityLogs.filter(l => CHANGE_LOG_TYPES.includes(l.event_type));
  const activityOnlyLogs  = activityLogs.filter(
    l => !ENABLE_DISABLE_TYPES.includes(l.event_type) && !CHANGE_LOG_TYPES.includes(l.event_type)
  );

  // Enable/Disable Log search
  const [edSearch, setEdSearch] = useState('');
  const [edFilter, setEdFilter] = useState('');
  // Change Log search
  const [clSearch, setClSearch] = useState('');
  const [clFilter, setClFilter] = useState('');
  const [loading,    setLoading]    = useState(true);
  const [activeTab,  setActiveTab]  = useState('service');

  const [packages,      setPackages]      = useState([]);
  const [tickets,       setTickets]       = useState([]);

  // Bill Edit modal
  const [billEditModal, setBillEditModal] = useState(null);
  const [billEditForm,  setBillEditForm]  = useState({ amount: '', discount: '0', net_amount: '', due_date: '', notes: '' });
  const [billSaving,    setBillSaving]    = useState(false);

  // Bill Add modal
  const [billAddOpen,  setBillAddOpen]  = useState(false);
  const [billAddForm,  setBillAddForm]  = useState({ bill_month: '', amount: '', discount: '0', due_date: '', notes: '' });
  const [billAdding,   setBillAdding]   = useState(false);

  // Bill Delete
  const [billDeleting, setBillDeleting] = useState(null); // bill id being deleted
  const [billDeleteTarget, setBillDeleteTarget] = useState(null); // bill object pending delete confirm
  const [billUnwaiveTarget, setBillUnwaiveTarget] = useState(null); // waived bill pending restore confirm
  const [billUnwaiving, setBillUnwaiving] = useState(null); // bill id being restored

  const [payDetailModal, setPayDetailModal] = useState(null);

  // Photo lightbox
  const [photoViewer, setPhotoViewer] = useState(null); // URL string or null

  // Media base URL — Django MEDIA_URL → absolute
  const MEDIA_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1')
    .replace('/api/v1', '');
  const absUrl = (url) => {
    if (!url) return null;
    if (url.startsWith('http')) return url;
    return `${MEDIA_BASE}${url}`;
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const pick = (res, fallback = []) => {
      if (res.status !== 'fulfilled') return fallback;
      const d = res.value?.data;
      if (!d) return fallback;
      return Array.isArray(d) ? d : (d.results ?? fallback);
    };
    try {
      const results = await Promise.allSettled([
        api.get(`/clients/${id}/`),                                                            // 0
        api.get('/billing/bills/',             { params: { client: id, page_size: 500 } }),    // 1
        api.get('/billing/payments/',          { params: { bill__client: id, page_size: 500 } }), // 2
        api.get('/billing/installation-fees/', { params: { client: id } }),                    // 3
        api.get('/sms/logs/',                  { params: { client: id, page_size: 500 } }),    // 4
        api.get('/change-requests/',           { params: { client: id, page_size: 500 } }),    // 5
        api.get('/client-change-logs/',        { params: { client: id, page_size: 500 } }),    // 6
        api.get('/client-status-logs/',        { params: { client: id, page_size: 500 } }),    // 7
        api.get('/config/packages/'),                                                           // 8
        api.get('/support/tickets/',           { params: { client: id, page_size: 500 } }),    // 9
        api.get('/client-activity-logs/',      { params: { client: id, page_size: 500 } }),    // 10
      ]);
      const [cR, bR, pR, iR, sR, rR, clR, slR, pkR, tkR, alR] = results;
      if (cR.status === 'fulfilled') setClient(cR.value.data);
      else { toast.error('ক্লায়েন্ট তথ্য লোড করতে সমস্যা হয়েছে।'); }
      setBills(        pick(bR));
      setPayments(     pick(pR));
      setInstallFee(   pick(iR)[0] || null);
      setSmsLogs(      pick(sR));
      setRemarks(      pick(rR));
      setChangeLogs(   pick(clR));
      setStatusLogs(   pick(slR));
      setPackages(     pick(pkR));
      setTickets(      pick(tkR));
      setActivityLogs( pick(alR));
    } catch { toast.error('ডেটা লোড করতে সমস্যা হয়েছে।'); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /* ── Bill Handlers ─────────────────────────────────────────────────────── */

  const refreshBills = async () => {
    const bR = await api.get('/billing/bills/', { params: { client: id, page_size: 500 } });
    setBills(Array.isArray(bR.data) ? bR.data : (bR.data.results || []));
    // client due_amount ও refresh করো
    const cR = await api.get(`/clients/${id}/`);
    if (cR.data) setClient(cR.data);
  };

  const handleBillSave = async () => {
    if (!billEditModal) return;
    setBillSaving(true);
    try {
      const amt      = parseFloat(billEditForm.amount || 0);
      const disc     = parseFloat(billEditForm.discount || 0);
      const netAmt   = Math.max(amt - disc, 0);
      const payload  = {
        amount:     amt,
        discount:   disc,
        net_amount: netAmt,
      };
      if (billEditForm.due_date)  payload.due_date = billEditForm.due_date;
      if (billEditForm.notes !== undefined) payload.notes = billEditForm.notes;
      await api.patch(`/billing/bills/${billEditModal.id}/`, payload);
      toast.success('বিল আপডেট হয়েছে।');
      setBillEditModal(null);
      await refreshBills();
    } catch (err) {
      const d = err.response?.data;
      if (d && typeof d === 'object') Object.values(d).forEach(m => toast.error(Array.isArray(m) ? m[0] : m));
      else toast.error('আপডেট ব্যর্থ হয়েছে।');
    }
    finally { setBillSaving(false); }
  };

  const handleBillAdd = async () => {
    if (!billAddForm.bill_month) { toast.error('Billing Month দিন।'); return; }
    if (!billAddForm.amount || parseFloat(billAddForm.amount) <= 0) { toast.error('Bill Amount দিন।'); return; }
    setBillAdding(true);
    try {
      const amt  = parseFloat(billAddForm.amount || 0);
      const disc = parseFloat(billAddForm.discount || 0);
      const net  = Math.max(amt - disc, 0);
      const payload = {
        client:     id,
        bill_month: billAddForm.bill_month,
        amount:     amt,
        discount:   disc,
        net_amount: net,
      };
      if (billAddForm.due_date) payload.due_date = billAddForm.due_date;
      if (billAddForm.notes)    payload.notes    = billAddForm.notes;
      await api.post('/billing/bills/', payload);
      toast.success('নতুন বিল যোগ করা হয়েছে।');
      setBillAddOpen(false);
      setBillAddForm({ bill_month: '', amount: '', discount: '0', due_date: '', notes: '' });
      await refreshBills();
    } catch (err) {
      const d = err.response?.data;
      if (d && typeof d === 'object') Object.values(d).forEach(m => toast.error(Array.isArray(m) ? m[0] : m));
      else toast.error('বিল যোগ ব্যর্থ হয়েছে।');
    }
    finally { setBillAdding(false); }
  };

  const handleBillDelete = (bill) => {
    // ব্রাউজারের ডিফল্ট confirm() নয় — পেজের ভিতরে সুন্দর modal খোলে
    setBillDeleteTarget(bill);
  };

  const confirmBillDelete = async () => {
    const bill = billDeleteTarget;
    if (!bill) return;
    // পরিশোধিত (paid/partial) বিল হার্ড-ডিলিট নিষিদ্ধ — পেমেন্ট cascade-এ মুছে হিসাব নষ্ট হতো।
    // তাই paid_amount > 0 হলে delete-এর বদলে Waive করা হয়; unpaid হলে আসল delete।
    const isPaid = Number(bill.paid_amount || 0) > 0;
    setBillDeleting(bill.id);
    try {
      if (isPaid) {
        await api.post(`/billing/bills/${bill.id}/waive/`, {});
        toast.success('বিল মওকুফ (Waived) করা হয়েছে।');
      } else {
        await api.delete(`/billing/bills/${bill.id}/`);
        toast.success('বিল মুছে ফেলা হয়েছে।');
      }
      setBillDeleteTarget(null);
      await refreshBills();
    } catch (err) {
      const d = err.response?.data;
      if (d && typeof d === 'object') Object.values(d).forEach(m => toast.error(Array.isArray(m) ? m[0] : m));
      else toast.error(isPaid ? 'মওকুফ করতে সমস্যা হয়েছে।' : 'মুছতে সমস্যা হয়েছে।');
    }
    finally { setBillDeleting(null); }
  };

  const confirmBillUnwaive = async () => {
    const bill = billUnwaiveTarget;
    if (!bill) return;
    setBillUnwaiving(bill.id);
    try {
      await api.post(`/billing/bills/${bill.id}/unwaive/`, {});
      toast.success('Waive বাতিল করা হয়েছে — বিল ফিরিয়ে আনা হয়েছে।');
      setBillUnwaiveTarget(null);
      await refreshBills();
    } catch (err) {
      const d = err.response?.data;
      if (d && typeof d === 'object') Object.values(d).forEach(m => toast.error(Array.isArray(m) ? m[0] : m));
      else toast.error('Waive বাতিল করতে সমস্যা হয়েছে।');
    }
    finally { setBillUnwaiving(null); }
  };

  /* ── Tab renderers ──────────────────────────────────────────────────────── */

  function renderService() {
    return (
      <div className="space-y-4">
        <CardSection title="Internet Service Information">
          <InfoGrid rows={[
            [{ label: 'Package',            value: client.package_name || '—' },     { label: 'Joining Date',      value: fmtDate(client.connection_date) }],
            [{ label: 'Profile',            value: client.pppoe_profile || '—' },    { label: 'Client Type',       value: client.client_type_name || '—' }],
            [{ label: 'Billing Start Month',value: fmtDate(client.connection_date) },{ label: 'Username / IP',     value: client.username || client.ip_address || '—' }],
            [{ label: 'Expire Date',        value: client.bill_date ? String(client.bill_date) : fmtDate(client.expiry_date) }, { label: 'Password', value: client.password || '—' }],
            [{ label: 'Monthly Bill',       value: client.monthly_bill ? `৳ ${client.monthly_bill}` : '৳ 0.00' }, { label: 'Balance Due', value: client.due_amount ? `৳ ${client.due_amount}` : '৳ 0.00' }],
            [{ label: 'Reference By',       value: '—' }, { label: 'Connection Setup By', value: '—' }],
            [{ label: 'Last Log in',        value: '—' }],
          ]} />
        </CardSection>

        <CardSection title="Installation Charge Information">
          <InfoGrid rows={[
            [{ label: 'Charge Created On', value: installFee ? fmtDate(installFee.created_at) : '—' }, { label: 'Installation Fee', value: installFee ? `৳ ${installFee.amount}` : '৳ 0.00' }],
            [{ label: 'Paid Amount',       value: installFee ? `৳ ${installFee.paid_amount}` : '৳ 0.00' }, { label: 'Due Amount', value: installFee ? `৳ ${(parseFloat(installFee.amount) - parseFloat(installFee.paid_amount)).toFixed(2)}` : '৳ 0.00' }],
            [{ label: 'Payment Method',    value: installFee?.payment_method || '—' }, { label: 'Payment Date', value: installFee ? fmtDate(installFee.payment_date || installFee.created_at) : '—' }],
            [{ label: 'Received By',       value: '—' }],
          ]} />
        </CardSection>
      </div>
    );
  }

  function renderNetwork() {
    return (
      <CardSection title="Networks & Products Information">
        <InfoGrid rows={[
          [{ label: 'Server',                  value: client.router_name || '—' },  { label: 'Protocol',      value: client.protocol_name || '—' }],
          [{ label: 'Zone',                    value: client.zone_name || '—' },    { label: 'Sub Zone',      value: client.subzone_name || '—' }],
          [{ label: 'Box',                     value: client.box_name || '—' },     { label: 'Connection Type', value: client.protocol_name || '—' }],
          [{ label: 'Latitude',               value: client.map_lat ? String(client.map_lat) : '—' }, { label: 'Longitude', value: client.map_lng ? String(client.map_lng) : '—' }],
          [{ label: 'Cable Requirement (m)',   value: '0.00 m' },                   { label: 'Fiber Code',    value: '—' }],
          [{ label: 'Number of Core',          value: '—' },                        { label: 'Device',        value: client.mac_vendor || '—' }],
          [{ label: 'Device MAC / Serial No',  value: client.mac_address || '—' }, { label: 'Vendor',        value: client.mac_vendor || 'N/A' }],
          [{ label: 'Purchase Date',           value: '—' },
           { label: 'IP', value: (client.current_ip || client.ip_address)
               ? <a href={`http://${client.current_ip || client.ip_address}:8810`} target="_blank" rel="noopener noreferrer"
                    className="text-blue-600 hover:underline" title="রাউটারের অ্যাডমিন প্যানেল খুলুন">
                   {`${client.current_ip || client.ip_address}:8810`}
                 </a>
               : '—' }],
        ]} />
      </CardSection>
    );
  }

  function renderPersonal() {
    return (
      <div className="space-y-4">
        <CardSection title="Customer Personal Information">
          <InfoGrid rows={[
            [{ label: 'Father Name',              value: '—' },                   { label: 'Mother Name',     value: '—' }],
            [{ label: 'Date of Birth',            value: '—' },                   { label: 'NID',             value: client.nid || '—' }],
            [{ label: 'Registration / Form No.',  value: '—' },                   { label: 'Email',           value: client.email || '—' }],
            [{ label: 'Gender',                   value: '—' },                   { label: 'Occupation',      value: '—' }],
            [{ label: 'Mobile No',                value: client.phone || '—' },   { label: 'Phone Number',    value: client.alt_phone || '—' }],
            [{ label: 'Facebook',                 value: '—' },                   { label: 'LinkedIn',        value: '—' }],
            [{ label: 'District',                 value: '—' },                   { label: 'Upazila',         value: '—' }],
            [{ label: 'Road Number',              value: '—' },                   { label: 'House Number',    value: '—' }],
            [{ label: 'Present Address',          value: client.address || '—' }, { label: 'Permanent Address', value: '—' }],
          ]} />
        </CardSection>

        {/* Photo Documents Section */}
        <CardSection title="Client Documents & Photos">
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
            {/* Profile Photo */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#5a7a90]">Profile Photo</p>
              <div
                onClick={() => absUrl(client.photo) && setPhotoViewer(absUrl(client.photo))}
                role={absUrl(client.photo) ? 'button' : undefined}
                tabIndex={absUrl(client.photo) ? 0 : undefined}
                onKeyDown={e => { if (absUrl(client.photo) && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setPhotoViewer(absUrl(client.photo)); } }}
                className={`relative aspect-[4/3] overflow-hidden rounded-xl border-2 ${absUrl(client.photo) ? 'border-[#1c2333] cursor-pointer hover:opacity-90' : 'border-dashed border-gray-200 bg-gray-50'} flex items-center justify-center`}
              >
                {absUrl(client.photo) ? (
                  <>
                    <img src={absUrl(client.photo)} alt="Profile" className="h-full w-full object-contain bg-white" />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/10 transition-colors">
                      <svg className="h-6 w-6 text-white opacity-0 hover:opacity-100 transition-opacity drop-shadow" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                      </svg>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-2 p-4 text-gray-300">
                    <svg className="h-10 w-10" fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>
                    <span className="text-[10px]">No photo</span>
                  </div>
                )}
              </div>
            </div>

            {/* NID / Birth Certificate */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#5a7a90]">NID / Birth Certificate</p>
              <div
                onClick={() => absUrl(client.nid_photo) && setPhotoViewer(absUrl(client.nid_photo))}
                role={absUrl(client.nid_photo) ? 'button' : undefined}
                tabIndex={absUrl(client.nid_photo) ? 0 : undefined}
                onKeyDown={e => { if (absUrl(client.nid_photo) && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setPhotoViewer(absUrl(client.nid_photo)); } }}
                className={`relative aspect-[4/3] overflow-hidden rounded-xl border-2 ${absUrl(client.nid_photo) ? 'border-blue-400 cursor-pointer hover:opacity-90' : 'border-dashed border-gray-200 bg-gray-50'} flex items-center justify-center`}
              >
                {absUrl(client.nid_photo) ? (
                  <img src={absUrl(client.nid_photo)} alt="NID" className="h-full w-full object-contain bg-white" />
                ) : (
                  <div className="flex flex-col items-center gap-2 p-4 text-gray-300">
                    <svg className="h-10 w-10" fill="currentColor" viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12zM6 10h2v2H6zm0 4h8v2H6zm4-4h8v2h-8z"/></svg>
                    <span className="text-[10px]">No NID photo</span>
                  </div>
                )}
              </div>
            </div>

            {/* Registration Form */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#5a7a90]">Registration Form</p>
              <div
                onClick={() => absUrl(client.reg_form_pic) && setPhotoViewer(absUrl(client.reg_form_pic))}
                role={absUrl(client.reg_form_pic) ? 'button' : undefined}
                tabIndex={absUrl(client.reg_form_pic) ? 0 : undefined}
                onKeyDown={e => { if (absUrl(client.reg_form_pic) && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setPhotoViewer(absUrl(client.reg_form_pic)); } }}
                className={`relative aspect-[4/3] overflow-hidden rounded-xl border-2 ${absUrl(client.reg_form_pic) ? 'border-emerald-400 cursor-pointer hover:opacity-90' : 'border-dashed border-gray-200 bg-gray-50'} flex items-center justify-center`}
              >
                {absUrl(client.reg_form_pic) ? (
                  <img src={absUrl(client.reg_form_pic)} alt="Reg Form" className="h-full w-full object-contain bg-white" />
                ) : (
                  <div className="flex flex-col items-center gap-2 p-4 text-gray-300">
                    <svg className="h-10 w-10" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
                    <span className="text-[10px]">No reg form</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          <p className="px-4 pb-3 text-[10px] text-gray-400">ছবিতে ক্লিক করলে বড় করে দেখা যাবে।</p>
        </CardSection>
      </div>
    );
  }

  function renderBills() {
    const totalBill = bills.reduce((s, b) => s + Number(b.net_amount  || 0), 0);
    const totalPaid = bills.reduce((s, b) => s + Number(b.paid_amount || 0), 0);
    const totalDue  = bills.reduce((s, b) => s + Number(b.due_amount  || 0), 0);

    const statusCfg = {
      paid:    { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', label: 'Paid' },
      partial: { dot: 'bg-amber-400',   badge: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',      label: 'Partial' },
      unpaid:  { dot: 'bg-red-400',     badge: 'bg-red-50 text-red-600 ring-1 ring-red-200',            label: 'Unpaid' },
      waived:  { dot: 'bg-gray-300',    badge: 'bg-gray-100 text-gray-500 ring-1 ring-gray-200',        label: 'Waived' },
    };

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="মোট বিল"  value={bills.length}         sub="Generated"   gradient="bg-gradient-to-br from-[#1c2333] to-[#2a3550]" />
          <StatCard label="মোট বিলড" value={`৳${money(totalBill)}`} sub="Net Amount"  gradient="bg-gradient-to-br from-indigo-500 to-indigo-600" />
          <StatCard label="পরিশোধ"   value={`৳${money(totalPaid)}`} sub="Paid Amount" gradient="bg-gradient-to-br from-emerald-500 to-teal-600" />
          <StatCard label="বকেয়া"    value={`৳${money(totalDue)}`}  sub="Due Amount"  gradient="bg-gradient-to-br from-red-500 to-rose-600" />
        </div>

        <CardSection
          title="Generated & Updated Bill / Invoices"
          action={isSuperAdmin && (
            <button
              onClick={() => {
                // default bill_month = current month
                const now = new Date();
                const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                setBillAddForm({ bill_month: ym, amount: String(Number(client?.monthly_bill || 0)), discount: '0', due_date: '', notes: '' });
                setBillAddOpen(true);
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1 text-[10px] font-bold text-white transition hover:bg-emerald-600"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add Bill
            </button>
          )}
        >
          <div className="p-4">
            <ModernTable
              rows={bills}
              columns={[
                { key: 'status',     label: '+/-',          render: r => { const s = statusCfg[r.status] || statusCfg.unpaid; return <span className={`inline-block h-2.5 w-2.5 rounded-full ${s.dot}`} />; } },
                { key: 'due_date',   label: 'Date',         render: r => fmtDate(r.due_date || (r.bill_month + '-10')) },
                { key: 'bill_month', label: 'Billing Month',render: r => <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-100">{fmtBillMonth(r.bill_month)}</span> },
                { key: 'package',    label: 'Package',      render: () => client?.package_name || '—' },
                { key: 'speed',      label: 'Speed',        render: () => client?.pppoe_profile || '—' },
                { key: 'net_amount', label: 'Bill Amount',  render: r => <span className="font-semibold text-gray-800">৳{money(r.net_amount)}</span> },
                { key: 'paid_amount',label: 'Paid',         render: r => <span className="font-semibold text-emerald-600">৳{money(r.paid_amount)}</span> },
                { key: 'due_amount', label: 'Due',          render: r => <span className="font-bold text-red-600">৳{money(r.due_amount)}</span> },
                { key: 'status_badge',label:'Status',       render: r => { const s = statusCfg[r.status] || statusCfg.unpaid; return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${s.badge}`}>{s.label}</span>; } },
                { key: 'action',     label: 'Action',       render: r => (
                  <div className="flex items-center gap-1.5">
                    {/* Edit */}
                    {isSuperAdmin && (
                      <button
                        onClick={() => {
                          setBillEditModal(r);
                          setBillEditForm({
                            amount:     String(Number(r.amount || r.net_amount || 0)),
                            discount:   String(Number(r.discount || 0)),
                            net_amount: String(Number(r.net_amount || 0)),
                            due_date:   r.due_date || '',
                            notes:      r.notes || '',
                          });
                        }}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-600 transition hover:bg-emerald-100"
                        title="Edit"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                    )}
                    {/* Delete */}
                    {isSuperAdmin && (
                      <button
                        onClick={() => handleBillDelete(r)}
                        disabled={billDeleting === r.id}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-500 transition hover:bg-red-100 disabled:opacity-40"
                        title="Delete"
                      >
                        {billDeleting === r.id ? (
                          <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                          </svg>
                        ) : (
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        )}
                      </button>
                    )}
                    {/* Restore (Waive বাতিল) — শুধু waived বিলে */}
                    {isSuperAdmin && r.status === 'waived' && (
                      <button
                        onClick={() => setBillUnwaiveTarget(r)}
                        disabled={billUnwaiving === r.id}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-600 transition hover:bg-amber-100 disabled:opacity-40"
                        title="Waive বাতিল করুন"
                      >
                        {billUnwaiving === r.id ? (
                          <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                          </svg>
                        ) : (
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v2M3 10l5-5M3 10l5 5" />
                          </svg>
                        )}
                      </button>
                    )}
                    {/* non-admin: view-only indicator */}
                    {!isSuperAdmin && <span className="text-[10px] text-gray-400">—</span>}
                  </div>
                )},
              ]}
            />
          </div>
        </CardSection>
      </div>
    );
  }

  function renderPayments() {
    const totalRcv  = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const totalDisc = payments.reduce((s, p) => s + Number(p.discount || 0), 0);

    const methodLabel = m => {
      if (!m) return 'Other';
      const map = { cash: 'Cash', bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket', bank: 'Bank', card: 'Card' };
      return map[m.toLowerCase()] || m;
    };
    const isBold = m => m && ['bkash','nagad','rocket'].includes(m.toLowerCase());

    const handleDeletePayment = async (pid) => {
      if (!window.confirm('এই পেমেন্ট মুছে ফেলবেন?')) return;
      try {
        await api.delete(`/billing/payments/${pid}/`);
        toast.success('পেমেন্ট মুছে ফেলা হয়েছে।');
        const pR = await api.get('/billing/payments/', { params: { bill__client: id, page_size: 500 } });
        setPayments(Array.isArray(pR.data) ? pR.data : (pR.data.results || []));
      } catch { toast.error('মুছতে সমস্যা হয়েছে।'); }
    };

    return (
      <div className="space-y-4">
        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="মোট পেমেন্ট"   value={payments.length}              sub="Transactions"   gradient="bg-gradient-to-br from-[#1c2333] to-[#2a3550]" />
          <StatCard label="মোট গ্রহীত"    value={`৳${money(totalRcv)}`}        sub="Total Received" gradient="bg-gradient-to-br from-emerald-500 to-teal-600" />
          <StatCard label="মোট ডিসকাউন্ট" value={`৳${money(totalDisc)}`}       sub="Total Discount" gradient="bg-gradient-to-br from-amber-500 to-orange-500" />
          <StatCard label="বর্তমান বকেয়া" value={`৳${money(Number(client?.due_amount || 0))}`} sub="Current Due" gradient="bg-gradient-to-br from-red-500 to-rose-600" />
        </div>

        <CardSection title="All Received Bill History">
          <div className="p-4">
            <ModernTable
              rows={payments}
              columns={[
                {
                  key: 'payment_date',
                  label: 'Receive Date',
                  render: r => (
                    <div className="text-center">
                      <div className="font-semibold text-gray-800 text-[11px]">{fmtDate(r.payment_date)}</div>
                    </div>
                  ),
                },
                {
                  key: 'received_by',
                  label: 'Received By',
                  render: r => (
                    <span className="font-medium text-gray-700">{r.received_by_name || r.received_by || '—'}</span>
                  ),
                },
                {
                  key: 'payment_method',
                  label: 'Payment Info',
                  render: r => (
                    <div className="space-y-0.5">
                      <div className="text-[11px] text-gray-600">
                        Payment by -{' '}
                        <span className={isBold(r.payment_method) ? 'font-bold text-gray-800' : 'font-medium text-gray-700'}>
                          {methodLabel(r.payment_method)}
                        </span>
                      </div>
                      <button
                        onClick={() => setPayDetailModal(r)}
                        className="text-[10px] font-semibold text-amber-600 underline hover:text-amber-700 transition"
                      >
                        Click For Details
                      </button>
                    </div>
                  ),
                },
                {
                  key: 'created_by',
                  label: 'Created By',
                  render: r => <span className="text-gray-600 text-[11px]">{r.created_by_name || '—'}</span>,
                },
                {
                  key: 'notes',
                  label: 'Remarks / Note',
                  render: r => (
                    <span className="block max-w-[120px] truncate text-[11px] text-gray-600" title={r.notes || r.remarks}>
                      {r.notes || r.remarks || '—'}
                    </span>
                  ),
                },
                {
                  key: 'discount',
                  label: 'Discount',
                  render: r => <span className="font-medium text-amber-600">{Number(r.discount || 0).toFixed(0)}</span>,
                },
                {
                  key: 'amount',
                  label: 'Received Bill',
                  render: r => <span className="font-bold text-emerald-600">৳{money(r.amount)}</span>,
                },
                {
                  key: 'total_bill',
                  label: 'Total Bill',
                  render: r => {
                    const bill = bills.find(b => b.id === r.bill);
                    const total = bill ? Number(bill.amount || bill.net_amount || 0) : Number(r.amount || 0);
                    return <span className="font-semibold text-gray-800">৳{money(total)}</span>;
                  },
                },
                {
                  key: 'action',
                  label: 'Action',
                  render: r => {
                    // Webhook payment → delete করা যাবে না
                    const isWebhook = r.gateway_info?.is_gateway ||
                      (r.notes || '').startsWith('bKash SNS') ||
                      (r.notes || '').startsWith('Webhook');
                    if (isWebhook) {
                      return (
                        <span
                          title="Webhook payment — Delete করা যাবে না"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                        </span>
                      );
                    }
                    return (
                      <button
                        onClick={() => handleDeletePayment(r.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-red-100 bg-red-50 text-red-500 transition hover:bg-red-100"
                        title="Delete"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    );
                  },
                },
              ]}
            />
          </div>
        </CardSection>
      </div>
    );
  }

  function renderComplain() {
    const priorityCfg = {
      high:   'bg-red-50 text-red-600 ring-1 ring-red-200',
      medium: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
      low:    'bg-blue-50 text-blue-600 ring-1 ring-blue-200',
    };
    const statusCfg = {
      open:       'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
      in_progress:'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200',
      resolved:   'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
      closed:     'bg-gray-100 text-gray-500 ring-1 ring-gray-200',
    };
    const total    = tickets.length;
    const open     = tickets.filter(t => t.status === 'open').length;
    const resolved = tickets.filter(t => t.status === 'resolved').length;

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="মোট কমপ্লেইন"  value={total}    sub="All Tickets"      gradient="bg-gradient-to-br from-[#1c2333] to-[#2a3550]" />
          <StatCard label="চলমান"          value={open}     sub="Open Tickets"     gradient="bg-gradient-to-br from-orange-500 to-amber-500" />
          <StatCard label="সমাধান হয়েছে"   value={resolved} sub="Resolved Tickets" gradient="bg-gradient-to-br from-emerald-500 to-teal-600" />
        </div>
        <CardSection title="All Complain History">
          <div className="p-4">
            <ModernTable
              emptyText="No complain records found."
              rows={tickets}
              columns={[
                { key: 'ticket_id',  label: 'Ticket ID',    render: r => <span className="font-mono text-[10px] bg-gray-100 px-1.5 py-0.5 rounded font-semibold">{r.ticket_id || `#${r.id}`}</span> },
                { key: 'subject',    label: 'Problem',      render: r => <span className="max-w-[200px] truncate block text-[11px] font-medium text-gray-800" title={r.subject}>{r.subject || '—'}</span> },
                { key: 'priority',   label: 'Priority',     render: r => <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${priorityCfg[r.priority] || priorityCfg.low}`}>{r.priority || '—'}</span> },
                { key: 'created_at', label: 'Complain Time',render: r => fmtDateTime(r.created_at) },
                { key: 'created_by', label: 'Created By',   render: r => r.created_by_name || r.created_by || '—' },
                { key: 'status',     label: 'Status',       render: r => <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${statusCfg[r.status] || statusCfg.open}`}>{(r.status || '—').replace('_', ' ')}</span> },
                { key: 'assigned_to',label: 'Assign To',    render: r => r.assigned_to_name || r.assigned_to || 'Unassigned' },
                { key: 'resolved_at',label: 'Solved Time',  render: r => r.resolved_at ? fmtDateTime(r.resolved_at) : <span className="text-gray-300">—</span> },
              ]}
            />
          </div>
        </CardSection>
      </div>
    );
  }

  function renderRemarks() {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="মোট রিমার্কস"  value={remarks.length} sub="All Remarks" gradient="bg-gradient-to-br from-[#1c2333] to-[#2a3550]" />
          <StatCard label="অনুমোদিত"       value={remarks.filter(r => r.status === 'approved').length} sub="Approved" gradient="bg-gradient-to-br from-emerald-500 to-teal-600" />
        </div>
        <CardSection title="All Remarks History">
          <div className="p-4">
            <ModernTable
              emptyText="No remarks history found."
              rows={remarks}
              columns={[
                { key: 'request_type', label: 'Remarks Type', render: r => {
                    const label = r.request_type === 'package_change' ? 'Package Change' : (r.request_type || '—').replace(/_/g, ' ');
                    return <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 capitalize">{label}</span>;
                  }},
                { key: 'reason',       label: 'Remarks',      render: r => <span className="max-w-[240px] truncate block text-[11px]" title={r.reason}>{r.reason || '—'}</span> },
                { key: 'created_at',   label: 'Date',         render: r => fmtDateTime(r.created_at) },
                { key: 'requested_by', label: 'Remarks By',   render: r => r.requested_by_name || r.requested_by || 'admin' },
                { key: 'status',       label: 'Status',       render: r => r.status
                    ? <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ring-1 ${r.status === 'approved' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-amber-50 text-amber-700 ring-amber-200'}`}>{r.status}</span>
                    : <span className="text-gray-300">—</span>
                },
              ]}
            />
          </div>
        </CardSection>
      </div>
    );
  }

  function renderMessage() {
    const sent   = smsLogs.filter(s => s.status === 'sent').length;
    const failed = smsLogs.filter(s => s.status === 'failed').length;
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="মোট মেসেজ"  value={smsLogs.length} sub="All Messages"  gradient="bg-gradient-to-br from-[#1c2333] to-[#2a3550]" />
          <StatCard label="সফল পাঠানো" value={sent}           sub="Sent"          gradient="bg-gradient-to-br from-emerald-500 to-teal-600" />
          <StatCard label="ব্যর্থ"      value={failed}         sub="Failed"        gradient="bg-gradient-to-br from-red-500 to-rose-600" />
        </div>
        <CardSection title="All Message History">
          <div className="p-4">
            <ModernTable
              emptyText="No message history found."
              rows={smsLogs}
              columns={[
                { key: 'template', label: 'SMS Type',  render: r => <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">{r.template ? String(r.template) : 'Due Notice'}</span> },
                { key: 'message',  label: 'SMS Text',  render: r => <span className="max-w-[280px] truncate block text-[11px]" title={r.message}>{r.message || '—'}</span> },
                { key: 'sent_at',  label: 'Send Date', render: r => fmtDateTime(r.sent_at || r.created_at) },
                { key: 'status',   label: 'Status',    render: r => {
                    const cfg = r.status === 'sent' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : r.status === 'failed' ? 'bg-red-50 text-red-600 ring-red-200' : 'bg-gray-100 text-gray-500 ring-gray-200';
                    return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ring-1 ${cfg}`}>{r.status || '—'}</span>;
                  }},
                { key: 'sent_by',  label: 'Sent By',   render: r => r.sent_by_name || r.sent_by || 'System' },
              ]}
            />
          </div>
        </CardSection>
      </div>
    );
  }

  // ── Shared EVENT_META ─────────────────────────────────────────────────────
  const EVENT_META = {
    bill_generated:   { icon: '🧾', color: 'bg-indigo-500',  badge: 'bg-indigo-50 text-indigo-700 ring-indigo-200',     label: 'Bill Generated' },
    bill_updated:     { icon: '✏️',  color: 'bg-amber-400',   badge: 'bg-amber-50 text-amber-700 ring-amber-200',         label: 'Bill Updated' },
    bill_deleted:     { icon: '🗑️', color: 'bg-red-400',     badge: 'bg-red-50 text-red-600 ring-red-200',              label: 'Bill Deleted' },
    payment_received: { icon: '💰', color: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200',   label: 'Payment Received' },
    payment_deleted:  { icon: '🗑️', color: 'bg-rose-500',   badge: 'bg-rose-50 text-rose-600 ring-rose-200',            label: 'Payment Deleted' },
    payment_approved: { icon: '✅', color: 'bg-green-500',   badge: 'bg-green-50 text-green-700 ring-green-200',         label: 'Payment Approved' },
    expiry_extended:  { icon: '📅', color: 'bg-purple-500',  badge: 'bg-purple-50 text-purple-700 ring-purple-200',     label: 'Expiry Extended' },
    sms_sent:         { icon: '💬', color: 'bg-pink-400',    badge: 'bg-pink-50 text-pink-700 ring-pink-200',           label: 'SMS Sent' },
    radius_action:    { icon: '📡', color: 'bg-orange-400',  badge: 'bg-orange-50 text-orange-700 ring-orange-200',     label: 'RADIUS Action' },
    mikrotik_action:  { icon: '🌐', color: 'bg-gray-500',    badge: 'bg-gray-100 text-gray-600 ring-gray-200',          label: 'Mikrotik Action' },
    other:            { icon: 'ℹ️', color: 'bg-gray-400',    badge: 'bg-gray-100 text-gray-500 ring-gray-200',          label: 'Other' },
    // Enable/Disable Log
    client_disabled:  { icon: '🔴', color: 'bg-red-500',     badge: 'bg-red-50 text-red-600 ring-red-200',             label: 'Disabled' },
    client_enabled:   { icon: '🟢', color: 'bg-teal-500',    badge: 'bg-teal-50 text-teal-700 ring-teal-200',          label: 'Enabled' },
    // Change Log
    status_changed:   { icon: '🔄', color: 'bg-blue-500',    badge: 'bg-blue-50 text-blue-700 ring-blue-200',          label: 'Status Changed' },
    package_changed:  { icon: '📦', color: 'bg-cyan-500',    badge: 'bg-cyan-50 text-cyan-700 ring-cyan-200',          label: 'Package Changed' },
    profile_updated:  { icon: '👤', color: 'bg-slate-500',   badge: 'bg-slate-50 text-slate-700 ring-slate-200',       label: 'Profile Updated' },
  };

  // ── Reusable Timeline component ─────────────────────────────────────────
  function ActivityTimeline({ logs, filterValue, setFilterValue, searchValue, setSearchValue, filterOptions, emptyText, title }) {
    const filtered = logs.filter(log => {
      if (filterValue && log.event_type !== filterValue) return false;
      if (searchValue && !`${log.title} ${log.description} ${log.performed_by}`.toLowerCase().includes(searchValue.toLowerCase())) return false;
      return true;
    });
    return (
      <div className="overflow-hidden rounded-xl border border-gray-200 shadow-sm">
        <div className="bg-[#1c2333] px-4 py-2.5 flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/80">{title}</p>
          <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-bold text-white">{filtered.length} events</span>
        </div>
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 bg-gray-50/60 px-4 py-3">
          <select value={filterValue} onChange={e => setFilterValue(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-medium outline-none focus:ring-1 focus:ring-[#1c2333]">
            <option value="">All Events</option>
            {filterOptions.map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <input value={searchValue} onChange={e => setSearchValue(e.target.value)}
            placeholder="Search..."
            className="w-52 rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] outline-none focus:border-[#1c2333] focus:ring-1 focus:ring-[#1c2333]/20" />
        </div>
        {/* Timeline */}
        <div className="p-4">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">{emptyText || 'কোনো লগ পাওয়া যায়নি।'}</div>
          ) : (
            <div className="relative">
              <div className="absolute left-[19px] top-0 bottom-0 w-0.5 bg-gray-200" />
              <div className="space-y-0">
                {filtered.map((log, idx) => {
                  const meta   = EVENT_META[log.event_type] || EVENT_META.other;
                  const isLast = idx === filtered.length - 1;
                  return (
                    <div key={log.id} className={`relative flex gap-4 ${isLast ? '' : 'pb-4'}`}>
                      <div className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${meta.color} text-base shadow-sm`}>
                        <span className="select-none">{meta.icon}</span>
                      </div>
                      <div className="flex-1 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-start justify-between gap-3 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${meta.badge}`}>
                                {meta.label}
                              </span>
                              {log.amount && (
                                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                                  ৳{Number(log.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </span>
                              )}
                            </div>
                            <p className="text-[12px] font-semibold text-gray-800">{log.title}</p>
                            {log.description && log.event_type === 'profile_updated' && log.description.includes('\n') ? (
                              /* Change Log: বিস্তারিত field diff — প্রতিটা line আলাদা row */
                              <div className="mt-1.5 space-y-1">
                                {log.description.split('\n').filter(Boolean).map((line, li) => {
                                  // "Label: "old" → "new"" ফরম্যাট parse করা
                                  const arrowIdx = line.indexOf(' → ');
                                  if (arrowIdx !== -1) {
                                    const colonIdx = line.indexOf(':');
                                    const label   = colonIdx !== -1 ? line.slice(0, colonIdx).trim() : '';
                                    const oldPart = colonIdx !== -1 ? line.slice(colonIdx + 1, arrowIdx).trim().replace(/^"|"$/g, '') : '';
                                    const newPart = line.slice(arrowIdx + 3).trim().replace(/^"|"$/g, '');
                                    return (
                                      <div key={li} className="flex flex-wrap items-center gap-1 rounded-lg bg-gray-50 px-2 py-1 text-[11px] ring-1 ring-gray-100">
                                        {label && (
                                          <span className="shrink-0 font-bold text-[#5a7a90] min-w-[70px]">{label}</span>
                                        )}
                                        <span className="shrink-0 text-gray-300">:</span>
                                        <span className="rounded bg-red-50 px-1.5 py-0.5 font-mono text-red-600 line-through">
                                          {oldPart || '—'}
                                        </span>
                                        <span className="shrink-0 text-gray-400">→</span>
                                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono font-semibold text-emerald-700">
                                          {newPart || '—'}
                                        </span>
                                      </div>
                                    );
                                  }
                                  return (
                                    <p key={li} className="text-[11px] text-gray-500">{line}</p>
                                  );
                                })}
                              </div>
                            ) : log.description ? (
                              <p className="mt-0.5 text-[11px] text-gray-500 leading-relaxed">{log.description}</p>
                            ) : null}
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-[10px] font-semibold text-gray-400">{fmtDate(log.created_at)}</p>
                            <p className="text-[10px] text-gray-400">
                              {new Date(log.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                            <p className="mt-1 text-[10px] font-medium text-[#5a7a90]">
                              by {log.performed_by_username || log.performed_by || 'System'}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Activity Log: bill, payment, expiry, sms, radius, mikrotik, other ────
  function renderActivityLog() {
    const ACTIVITY_TYPES = Object.entries(EVENT_META).filter(
      ([k]) => !ENABLE_DISABLE_TYPES.includes(k) && !CHANGE_LOG_TYPES.includes(k)
    );

    const bill  = activityOnlyLogs.filter(l => l.event_type === 'bill_generated').length;
    const paid  = activityOnlyLogs.filter(l => l.event_type === 'payment_received').length;
    const other = activityOnlyLogs.filter(l => !['bill_generated','payment_received'].includes(l.event_type)).length;

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="মোট কার্যক্রম" value={activityOnlyLogs.length} sub="Total Events"    gradient="bg-gradient-to-br from-[#1c2333] to-[#2a3550]" />
          <StatCard label="বিল"            value={bill}                    sub="Bills"            gradient="bg-gradient-to-br from-indigo-500 to-indigo-600" />
          <StatCard label="পেমেন্ট"        value={paid}                    sub="Payments"         gradient="bg-gradient-to-br from-emerald-500 to-teal-600" />
        </div>
        <ActivityTimeline
          logs={activityOnlyLogs}
          filterValue={actFilterType} setFilterValue={setActFilterType}
          searchValue={actSearch}     setSearchValue={setActSearch}
          filterOptions={ACTIVITY_TYPES}
          title="Activity Log Timeline"
          emptyText="কোনো Activity Log পাওয়া যায়নি।"
        />
      </div>
    );
  }

  // ── Change Log: profile_updated, package_changed, status_changed ──────────
  function renderChangeLog() {
    const CHANGE_TYPES = Object.entries(EVENT_META).filter(([k]) => CHANGE_LOG_TYPES.includes(k));
    const pkgChanged    = changeOnlyLogs.filter(l => l.event_type === 'package_changed').length;
    const profUpdated   = changeOnlyLogs.filter(l => l.event_type === 'profile_updated').length;
    const stChanged     = changeOnlyLogs.filter(l => l.event_type === 'status_changed').length;

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="মোট পরিবর্তন"  value={changeOnlyLogs.length} sub="Total Changes"   gradient="bg-gradient-to-br from-[#1c2333] to-[#2a3550]" />
          <StatCard label="প্রোফাইল"       value={profUpdated}           sub="Profile Updated" gradient="bg-gradient-to-br from-slate-500 to-slate-600" />
          <StatCard label="প্যাকেজ"        value={pkgChanged}            sub="Package Changed" gradient="bg-gradient-to-br from-cyan-500 to-cyan-600" />
          <StatCard label="স্ট্যাটাস"      value={stChanged}             sub="Status Changed"  gradient="bg-gradient-to-br from-blue-500 to-blue-600" />
        </div>
        <ActivityTimeline
          logs={changeOnlyLogs}
          filterValue={clFilter} setFilterValue={setClFilter}
          searchValue={clSearch} setSearchValue={setClSearch}
          filterOptions={CHANGE_TYPES}
          title="Change Log Timeline"
          emptyText="কোনো Change Log পাওয়া যায়নি।"
        />
      </div>
    );
  }

  // ── Enable / Disable Log: client_enabled, client_disabled ────────────────
  function renderEnableLog() {
    const ED_TYPES = Object.entries(EVENT_META).filter(([k]) => ENABLE_DISABLE_TYPES.includes(k));
    const enabled  = enableDisableLogs.filter(l => l.event_type === 'client_enabled').length;
    const disabled = enableDisableLogs.filter(l => l.event_type === 'client_disabled').length;

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="মোট লগ"    value={enableDisableLogs.length} sub="Total Logs" gradient="bg-gradient-to-br from-[#1c2333] to-[#2a3550]" />
          <StatCard label="সক্রিয়"    value={enabled}                  sub="Enabled"   gradient="bg-gradient-to-br from-emerald-500 to-teal-600" />
          <StatCard label="নিষ্ক্রিয়" value={disabled}                 sub="Disabled"  gradient="bg-gradient-to-br from-red-500 to-rose-600" />
        </div>
        <ActivityTimeline
          logs={enableDisableLogs}
          filterValue={edFilter} setFilterValue={setEdFilter}
          searchValue={edSearch} setSearchValue={setEdSearch}
          filterOptions={ED_TYPES}
          title="Enable / Disable Log Timeline"
          emptyText="কোনো Enable/Disable Log পাওয়া যায়নি।"
        />
      </div>
    );
  }

  function renderInvoices() {
    return (
      <CardSection title="Product & Service Sales Invoices">
        <div className="p-4">
          <ModernTable emptyText="No sales invoices found." rows={[]} columns={[
            { key: 'CustomerName',  label: 'Customer' },
            { key: 'InvoiceType',   label: 'Invoice Type' },
            { key: 'InvoiceNo',     label: 'Invoice No' },
            { key: 'TotalAmount',   label: 'Total Amount' },
            { key: 'ReceiveAmount', label: 'Received' },
            { key: 'Discount',      label: 'Discount' },
            { key: 'Due',           label: 'Due' },
            { key: 'Status',        label: 'Status' },
          ]} />
        </div>
      </CardSection>
    );
  }

  function renderTabContent() {
    switch (activeTab) {
      case 'service':     return renderService();
      case 'network':     return renderNetwork();
      case 'personal':    return renderPersonal();
      case 'bills':       return renderBills();
      case 'payments':    return renderPayments();
      case 'complain':    return renderComplain();
      case 'remarks':     return renderRemarks();
      case 'message':     return renderMessage();
      case 'activitylog': return renderActivityLog();
      case 'changelog':   return renderChangeLog();
      case 'enablelog':   return renderEnableLog();
      case 'invoices':    return renderInvoices();
      default:            return null;
    }
  }

  if (loading) return (
    <div className="flex h-64 items-center justify-center text-sm text-gray-400">
      <span className="mr-2 animate-spin text-xl">⟳</span> লোড হচ্ছে...
    </div>
  );
  if (!client) return (
    <div className="flex h-64 items-center justify-center text-sm text-gray-400">ক্লায়েন্ট পাওয়া যায়নি।</div>
  );

  return (
    <>
    <div className="min-h-screen bg-gray-50 p-3 sm:p-4">

      {/* Breadcrumb */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base select-none">👤</span>
          <h1 className="text-base font-bold text-gray-800">Profile</h1>
          <span className="text-xs text-gray-400">— Client Profile</span>
        </div>
        <div className="flex items-center gap-3">
          {/* VoIP — client app-এ কল (Softphone enabled হলেই দেখায়) */}
          {softphone && softphone.status !== 'disabled' && (
            <button
              onClick={() => softphone.startCall(`client_${client.id}`, client.full_name)}
              disabled={softphone.status !== 'registered' || !!softphone.call}
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              title={softphone.status === 'registered' ? 'অ্যাপে কল করুন' : 'ফোন প্রস্তুত নয়'}
            >
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
              কল করুন
            </button>
          )}
          <nav className="text-xs text-gray-400">
            Client &gt;{' '}
            <button onClick={() => navigate('/clients')} className="text-[#1c2333] hover:underline font-medium">Client list</button>
            {' '}&gt; Profile
          </nav>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">

        {/* ── Left Card ── */}
        <div className="w-full shrink-0 lg:w-64">
          <div className="overflow-hidden rounded-2xl bg-white shadow-md">

            {/* Avatar section */}
            <div className="bg-gradient-to-b from-[#1c2333] to-[#2a3550] px-4 pb-5 pt-6">
              <div className="relative flex items-end justify-center">
                {/* NID photo button */}
                <button
                  onClick={() => absUrl(client.nid_photo) && setPhotoViewer(absUrl(client.nid_photo))}
                  className={`absolute left-0 bottom-0 flex h-7 w-7 items-center justify-center rounded-full transition ${absUrl(client.nid_photo) ? 'bg-blue-500/80 hover:bg-blue-500 cursor-pointer' : 'bg-white/10 cursor-default opacity-40'}`}
                  title={absUrl(client.nid_photo) ? 'NID ছবি দেখুন' : 'NID ছবি নেই'}
                >
                  <svg className="h-3.5 w-3.5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12zM6 10h2v2H6zm0 4h8v2H6zm4-4h8v2h-8z"/></svg>
                </button>

                {/* Profile photo circle */}
                <div
                  onClick={() => absUrl(client.photo) && setPhotoViewer(absUrl(client.photo))}
                  role={absUrl(client.photo) ? 'button' : undefined}
                  tabIndex={absUrl(client.photo) ? 0 : undefined}
                  onKeyDown={e => { if (absUrl(client.photo) && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setPhotoViewer(absUrl(client.photo)); } }}
                  className={`h-20 w-20 shrink-0 overflow-hidden rounded-full border-4 border-white/20 bg-[#2a3550] ${absUrl(client.photo) ? 'cursor-pointer hover:opacity-90' : ''}`}
                >
                  {absUrl(client.photo)
                    ? <img src={absUrl(client.photo)} alt={client.full_name} className="h-full w-full object-contain" />
                    : <svg className="h-full w-full text-gray-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>
                  }
                </div>

                {/* Reg Form photo button */}
                <button
                  onClick={() => absUrl(client.reg_form_pic) && setPhotoViewer(absUrl(client.reg_form_pic))}
                  className={`absolute right-0 bottom-0 flex h-7 w-7 items-center justify-center rounded-full transition ${absUrl(client.reg_form_pic) ? 'bg-emerald-500/80 hover:bg-emerald-500 cursor-pointer' : 'bg-white/10 cursor-default opacity-40'}`}
                  title={absUrl(client.reg_form_pic) ? 'Registration Form দেখুন' : 'Registration Form নেই'}
                >
                  <svg className="h-3.5 w-3.5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
                </button>
              </div>
              <p className="mt-3 text-center text-sm font-bold text-white">{client.full_name}</p>
              <p className="text-center text-[10px] text-blue-200 mt-0.5">{client.customer_id}</p>
            </div>

            {/* Info rows */}
            <div className="divide-y divide-gray-100 text-xs">
              {[
                { icon: '🆔', label: 'Customer ID',      value: client.customer_id },
                { icon: '💳', label: 'Billing Status',  value: <StatusBadge status={client.status} /> },
                { icon: '📶', label: 'Mikrotik Status', value: <Toggle active={client.status === 'active'} /> },
                { icon: '📱', label: 'App Access',      value: (
                  <button
                    onClick={async () => {
                      try {
                        const r = await api.patch(`/clients/${client.id}/`, { app_enabled: !client.app_enabled });
                        setClient(prev => ({ ...prev, app_enabled: r.data.app_enabled }));
                      } catch { /* ignore */ }
                    }}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold transition-colors ${
                      client.app_enabled ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-rose-100 text-rose-600 hover:bg-rose-200'
                    }`}
                  >
                    {client.app_enabled ? 'Enabled' : 'Disabled'}
                  </button>
                )},
                { icon: '📅', label: 'Creation Date',   value: fmtDate(client.created_at) },
              ].map(({ icon, label, value }) => (
                <div key={label} className="flex items-center gap-2 px-3 py-2.5">
                  <span className="shrink-0 text-sm select-none">{icon}</span>
                  <span className="shrink-0 text-gray-500">{label}</span>
                  <span className="ml-auto text-right font-semibold text-gray-800">{value}</span>
                </div>
              ))}
            </div>

            {/* Action buttons */}
            <div className="p-3 grid grid-cols-2 gap-2">
              {[
                { label: 'Update Info',      icon: '✏️', onClick: () => navigate(`/clients/${id}`) },
                { label: 'Status Scheduler', icon: '📅', onClick: () => toast('Coming soon') },
                { label: 'Email / Message',  icon: '💬', onClick: () => toast('Coming soon') },
                { label: 'Pkg Scheduler',    icon: '📋', onClick: () => toast('Coming soon') },
              ].map(({ label, icon, onClick }) => (
                <button key={label} onClick={onClick}
                  className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[10px] font-semibold text-gray-700 transition hover:bg-gray-50 truncate">
                  <span className="select-none">{icon}</span><span className="truncate">{label}</span>
                </button>
              ))}
            </div>

            <div className="space-y-2 px-3 pb-3">
              <button onClick={() => toast('Downloading...')}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#1c2333] py-2 text-xs font-bold text-white transition hover:bg-[#2a3347]">
                ⬇ Download Information
              </button>
              <button onClick={() => navigate('/clients')}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-gray-500 py-2 text-xs font-bold text-white transition hover:bg-gray-600">
                ← Go To Client List
              </button>
            </div>
          </div>
        </div>

        {/* ── Right Panel ── */}
        <div className="min-w-0 flex-1">
          <div className="overflow-hidden rounded-2xl bg-white shadow-md">

            {/* Tab rows */}
            <div className="border-b border-gray-200 px-4 pt-3 pb-2 space-y-2">
              <div className="flex flex-wrap gap-1">
                {TABS_ROW1.map(t => <TabBtn key={t.key} label={t.label} active={activeTab === t.key} onClick={() => setActiveTab(t.key)} />)}
              </div>
              <div className="flex flex-wrap gap-1">
                {TABS_ROW2.map(t => <TabBtn key={t.key} label={t.label} active={activeTab === t.key} onClick={() => setActiveTab(t.key)} />)}
              </div>
            </div>

            <div className="p-3 sm:p-4">{renderTabContent()}</div>
          </div>
        </div>
      </div>
    </div>

    {/* ── Bill Edit Modal ── */}
    {/* ── Payment Gateway Details Modal ── */}
    {payDetailModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
        <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">

          {/* Header */}
          <div className="bg-gradient-to-r from-[#1c2333] to-[#2a3550] px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15">
                  <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-white">Payment Gateway Information</p>
                  <p className="mt-0.5 text-[10px] text-blue-200">Transaction Details</p>
                </div>
              </div>
              <button onClick={() => setPayDetailModal(null)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-lg text-white/60 transition hover:bg-white/25 hover:text-white">×</button>
            </div>
          </div>

          {/* Body */}
          {(() => {
            const gi = payDetailModal.gateway_info || {}
            const trxId   = gi.transaction_id    || payDetailModal.transaction_id || 'N/A'
            const paidAmt = gi.paid_amount        ?? payDetailModal.amount ?? 0
            const vatAmt  = gi.vat_amount         ?? 0
            const procFee = gi.processing_fee     ?? 0
            const svcChg  = gi.service_charge     ?? 0
            const stored  = gi.stored_amount      ?? paidAmt
            const cardType    = gi.card_type      || payDetailModal.payment_method || 'N/A'
            const receiverId  = gi.bank_receiver_id   || 'Not Used'
            const receiverName= gi.bank_receiver_name || 'Not Used'
            const cardHolder  = gi.card_holder        || 'Not Used'
            const cardNumber  = gi.card_number        || 'Not Used'
            const gwStatus    = gi.payment_status     || (payDetailModal.is_verified ? 'Completed' : 'Pending')
            const rows = [
              { label: 'Payment Date',              value: fmtDateTime(payDetailModal.payment_date || payDetailModal.created_at) },
              { label: 'Transaction Id',             value: trxId },
              { label: 'Bank / Receiver ID',         value: receiverId },
              { label: 'Bank / Receiver Name',       value: receiverName },
              { label: 'Paid Amount',                value: `${money(paidAmt)} BDT`, bold: true },
              { label: 'VAT Amount',                 value: `${money(vatAmt)} BDT` },
              { label: 'Processing Fee',             value: `${money(procFee)} BDT` },
              { label: 'Deducted / Service Charge',  value: `${money(svcChg)} BDT` },
              { label: 'Stored / Savings Amount',    value: `${money(stored)} BDT` },
              { label: 'Card Type',                  value: cardType },
              { label: 'Card Holder / Sender',       value: cardHolder },
              { label: 'Card Number',                value: cardNumber },
            ]
            return (
              <div className="divide-y divide-gray-100 text-xs">
                {rows.map(({ label, value, bold }, i) => (
                  <div key={label} className={`flex items-center px-6 py-2.5 ${i % 2 === 0 ? 'bg-white' : 'bg-[#f8fafc]'}`}>
                    <span className="w-52 shrink-0 font-semibold text-[#5a7a90]">{label}</span>
                    <span className="mx-2 shrink-0 text-gray-300">:</span>
                    <span className={`break-all font-medium ${bold ? 'text-emerald-700' : 'text-gray-800'}`}>{value}</span>
                  </div>
                ))}
                {/* Payment Status */}
                <div className="flex items-center bg-white px-6 py-2.5">
                  <span className="w-52 shrink-0 font-semibold text-[#5a7a90]">Payment Status</span>
                  <span className="mx-2 shrink-0 text-gray-300">:</span>
                  {gwStatus === 'Completed' || gwStatus === 'Success' || payDetailModal.is_verified
                    ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Success
                      </span>
                    : <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-[11px] font-bold text-amber-700 ring-1 ring-amber-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{gwStatus || 'Pending'}
                      </span>
                  }
                </div>
              </div>
            )
          })()}

          {/* Footer */}
          <div className="flex justify-center px-6 py-4 bg-gray-50 border-t border-gray-100">
            <button onClick={() => setPayDetailModal(null)}
              className="min-w-[120px] rounded-xl bg-red-500 px-6 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-red-600 active:scale-95">
              Close
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── Bill Edit Modal ── */}
    {billEditModal && (() => {
      const lbl     = 'mb-1 block text-[10px] font-bold uppercase tracking-wider text-[#5a7a90]';
      const inp     = 'h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none transition focus:border-[#1c2333] focus:ring-2 focus:ring-[#1c2333]/10';
      const editAmt = parseFloat(billEditForm.amount || 0);
      const editDis = parseFloat(billEditForm.discount || 0);
      const editNet = Math.max(editAmt - editDis, 0);
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            {/* Header */}
            <div className="bg-gradient-to-r from-[#1c2333] to-[#2a3550] px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 select-none">✏️</div>
                  <div>
                    <p className="text-sm font-bold text-white">Edit Bill</p>
                    <p className="mt-0.5 text-[10px] text-blue-200">{fmtBillMonth(billEditModal.bill_month)} — {client?.full_name}</p>
                  </div>
                </div>
                <button onClick={() => setBillEditModal(null)}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xl text-white/60 transition hover:bg-white/25 hover:text-white">×</button>
              </div>
            </div>
            {/* Body */}
            <div className="grid grid-cols-2 gap-4 p-5">
              {/* Bill Month (read-only) */}
              <div>
                <label className={lbl}>Billing Month</label>
                <div className="flex h-9 w-full items-center rounded-lg border border-gray-100 bg-gray-50 px-3 text-sm font-semibold text-indigo-700">{fmtBillMonth(billEditModal.bill_month)}</div>
              </div>
              {/* Due Date */}
              <div>
                <label className={lbl}>Due Date</label>
                <input type="date" className={inp}
                  value={billEditForm.due_date}
                  onChange={e => setBillEditForm(f => ({ ...f, due_date: e.target.value }))} />
              </div>
              {/* Bill Amount */}
              <div>
                <label className={lbl}>Bill Amount (৳) <span className="text-red-500">*</span></label>
                <input type="number" min="0" step="0.01" className={inp}
                  value={billEditForm.amount}
                  onChange={e => setBillEditForm(f => ({
                    ...f, amount: e.target.value,
                    net_amount: String(Math.max(parseFloat(e.target.value || 0) - parseFloat(f.discount || 0), 0))
                  }))} />
              </div>
              {/* Discount */}
              <div>
                <label className={lbl}>Discount (৳)</label>
                <input type="number" min="0" step="0.01" className={inp}
                  value={billEditForm.discount}
                  onChange={e => setBillEditForm(f => ({
                    ...f, discount: e.target.value,
                    net_amount: String(Math.max(parseFloat(f.amount || 0) - parseFloat(e.target.value || 0), 0))
                  }))} />
              </div>
              {/* Net Amount (calculated) */}
              <div className="col-span-2">
                <label className={lbl}>Net Amount (After Discount)</label>
                <div className={`flex h-9 items-center rounded-lg border ${editNet > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-gray-50 text-gray-500'} px-3 text-sm font-bold`}>
                  ৳ {money(editNet)}
                </div>
              </div>
              {/* Notes */}
              <div className="col-span-2">
                <label className={lbl}>Notes / Remarks</label>
                <textarea className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none transition focus:border-[#1c2333] focus:ring-2 focus:ring-[#1c2333]/10"
                  rows={2} placeholder="কোনো মন্তব্য বা কারণ..."
                  value={billEditForm.notes}
                  onChange={e => setBillEditForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            {/* Footer */}
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setBillEditModal(null)}
                className="h-10 flex-1 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 transition hover:bg-gray-50">Cancel</button>
              <button onClick={handleBillSave} disabled={billSaving}
                className="h-10 flex-1 rounded-xl bg-[#1c2333] text-sm font-bold text-white transition hover:bg-[#2a3550] disabled:opacity-50">
                {billSaving ? 'সংরক্ষণ হচ্ছে...' : '✓ Update Bill'}
              </button>
            </div>
          </div>
        </div>
      );
    })()}

    {/* ── Bill Add Modal ── */}
    {billAddOpen && (() => {
      const lbl    = 'mb-1 block text-[10px] font-bold uppercase tracking-wider text-[#5a7a90]';
      const inp    = 'h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none transition focus:border-[#1c2333] focus:ring-2 focus:ring-[#1c2333]/10';
      const addAmt = parseFloat(billAddForm.amount || 0);
      const addDis = parseFloat(billAddForm.discount || 0);
      const addNet = Math.max(addAmt - addDis, 0);
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            {/* Header */}
            <div className="bg-gradient-to-r from-emerald-600 to-teal-700 px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 select-none">➕</div>
                  <div>
                    <p className="text-sm font-bold text-white">Add New Bill</p>
                    <p className="mt-0.5 text-[10px] text-emerald-100">{client?.full_name} — {client?.customer_id}</p>
                  </div>
                </div>
                <button onClick={() => setBillAddOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xl text-white/60 transition hover:bg-white/25 hover:text-white">×</button>
              </div>
            </div>
            {/* Body */}
            <div className="grid grid-cols-2 gap-4 p-5">
              {/* Bill Month */}
              <div>
                <label className={lbl}>Billing Month <span className="text-red-500">*</span></label>
                <input type="month" className={inp}
                  value={billAddForm.bill_month}
                  onChange={e => setBillAddForm(f => ({ ...f, bill_month: e.target.value }))} />
              </div>
              {/* Due Date */}
              <div>
                <label className={lbl}>Due Date</label>
                <input type="date" className={inp}
                  value={billAddForm.due_date}
                  onChange={e => setBillAddForm(f => ({ ...f, due_date: e.target.value }))} />
              </div>
              {/* Bill Amount */}
              <div>
                <label className={lbl}>Bill Amount (৳) <span className="text-red-500">*</span></label>
                <input type="number" min="0" step="0.01" className={inp}
                  value={billAddForm.amount}
                  onChange={e => setBillAddForm(f => ({
                    ...f, amount: e.target.value,
                    net_amount: String(Math.max(parseFloat(e.target.value || 0) - parseFloat(f.discount || 0), 0))
                  }))} />
              </div>
              {/* Discount */}
              <div>
                <label className={lbl}>Discount (৳)</label>
                <input type="number" min="0" step="0.01" className={inp}
                  value={billAddForm.discount}
                  onChange={e => setBillAddForm(f => ({
                    ...f, discount: e.target.value,
                    net_amount: String(Math.max(parseFloat(f.amount || 0) - parseFloat(e.target.value || 0), 0))
                  }))} />
              </div>
              {/* Net Amount */}
              <div className="col-span-2">
                <label className={lbl}>Net Amount (After Discount)</label>
                <div className={`flex h-9 items-center rounded-lg border ${addNet > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-gray-50 text-gray-500'} px-3 text-sm font-bold`}>
                  ৳ {money(addNet)}
                </div>
              </div>
              {/* Notes */}
              <div className="col-span-2">
                <label className={lbl}>Notes / Remarks</label>
                <textarea className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none transition focus:border-[#1c2333] focus:ring-2 focus:ring-[#1c2333]/10"
                  rows={2} placeholder="কোনো মন্তব্য বা কারণ..."
                  value={billAddForm.notes}
                  onChange={e => setBillAddForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            {/* Footer */}
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setBillAddOpen(false)}
                className="h-10 flex-1 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 transition hover:bg-gray-50">Cancel</button>
              <button onClick={handleBillAdd} disabled={billAdding}
                className="h-10 flex-1 rounded-xl bg-emerald-600 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50">
                {billAdding ? 'যোগ হচ্ছে...' : '✓ Add Bill'}
              </button>
            </div>
          </div>
        </div>
      );
    })()}
    {/* ── Bill Delete / Waive Confirm Modal ── */}
    {billDeleteTarget && (() => {
      // paid/partial বিল delete হয় না — তখন modal-টি Waive কনফার্মে রূপ নেয়
      const isPaid = Number(billDeleteTarget.paid_amount || 0) > 0;
      return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
        onClick={() => billDeleting ? null : setBillDeleteTarget(null)}>
        <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl"
          onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className={`px-6 py-4 ${isPaid ? 'bg-gradient-to-r from-amber-500 to-orange-600' : 'bg-gradient-to-r from-red-600 to-rose-700'}`}>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 select-none">{isPaid ? '⚖️' : '🗑️'}</div>
              <div>
                <p className="text-sm font-bold text-white">{isPaid ? 'বিল মওকুফ (Waive) করবেন?' : 'বিল মুছে ফেলবেন?'}</p>
                <p className={`mt-0.5 text-[10px] ${isPaid ? 'text-amber-100' : 'text-red-100'}`}>{client?.full_name} — {client?.customer_id}</p>
              </div>
            </div>
          </div>
          {/* Body */}
          <div className="px-6 py-5">
            {isPaid ? (
              <>
                <p className="text-sm text-gray-700">
                  <strong className="text-gray-900">{billDeleteTarget.bill_month}</strong> মাসের বিলে পরিশোধ
                  {' '}<strong className="text-gray-900">৳{money(billDeleteTarget.paid_amount)}</strong> থাকায় এটি delete করা যাবে না।
                </p>
                <p className="mt-2 text-xs text-gray-500">এর বদলে বিলটি <strong>Waived</strong> করা হবে — রেকর্ড থাকবে, বকেয়া শূন্য হবে।</p>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-700">
                  <strong className="text-gray-900">{billDeleteTarget.bill_month}</strong> মাসের বিল
                  {' '}<strong className="text-gray-900">৳{money(billDeleteTarget.net_amount)}</strong>
                  {' '}স্থায়ীভাবে মুছে যাবে।
                </p>
                <p className="mt-2 text-xs font-semibold text-red-600">এই action undo করা যাবে না।</p>
              </>
            )}
          </div>
          {/* Footer */}
          <div className="flex gap-3 px-6 pb-5">
            <button onClick={() => setBillDeleteTarget(null)} disabled={!!billDeleting}
              className="h-10 flex-1 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50">বাতিল</button>
            <button onClick={confirmBillDelete} disabled={!!billDeleting}
              className={`h-10 flex-1 rounded-xl text-sm font-bold text-white transition disabled:opacity-50 ${isPaid ? 'bg-amber-500 hover:bg-amber-600' : 'bg-red-600 hover:bg-red-700'}`}>
              {billDeleting ? (isPaid ? 'মওকুফ হচ্ছে...' : 'মুছছে...') : (isPaid ? 'হ্যাঁ, মওকুফ করুন' : 'হ্যাঁ, মুছুন')}
            </button>
          </div>
        </div>
      </div>
      );
    })()}
    {/* ── Bill Unwaive (Restore) Confirm Modal ── */}
    {billUnwaiveTarget && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
        onClick={() => billUnwaiving ? null : setBillUnwaiveTarget(null)}>
        <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl"
          onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="bg-gradient-to-r from-amber-500 to-orange-600 px-6 py-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 select-none">↩️</div>
              <div>
                <p className="text-sm font-bold text-white">Waive বাতিল করবেন?</p>
                <p className="mt-0.5 text-[10px] text-amber-100">{client?.full_name} — {client?.customer_id}</p>
              </div>
            </div>
          </div>
          {/* Body */}
          <div className="px-6 py-5">
            <p className="text-sm text-gray-700">
              <strong className="text-gray-900">{billUnwaiveTarget.bill_month}</strong> মাসের মওকুফ করা বিলটি আবার সক্রিয় হবে।
            </p>
            <p className="mt-2 text-xs text-gray-500">পরিশোধ অনুযায়ী status (unpaid/partial/paid) ও বকেয়া নতুন করে হিসাব হবে।</p>
          </div>
          {/* Footer */}
          <div className="flex gap-3 px-6 pb-5">
            <button onClick={() => setBillUnwaiveTarget(null)} disabled={!!billUnwaiving}
              className="h-10 flex-1 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50">বাতিল</button>
            <button onClick={confirmBillUnwaive} disabled={!!billUnwaiving}
              className="h-10 flex-1 rounded-xl bg-amber-500 text-sm font-bold text-white transition hover:bg-amber-600 disabled:opacity-50">
              {billUnwaiving ? 'ফিরছে...' : 'হ্যাঁ, ফিরিয়ে আনুন'}
            </button>
          </div>
        </div>
      </div>
    )}
    {/* ── Photo Lightbox Modal ── */}
    {photoViewer && (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
        onClick={() => setPhotoViewer(null)}
      >
        <div
          className="relative max-h-[90vh] max-w-3xl"
          onClick={e => e.stopPropagation()}
        >
          <img
            src={photoViewer}
            alt="Preview"
            className="max-h-[85vh] max-w-full rounded-xl object-contain shadow-2xl"
          />
          <button
            onClick={() => setPhotoViewer(null)}
            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white transition hover:bg-black/75"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          {/* Download link */}
          <a
            href={photoViewer}
            download
            target="_blank"
            rel="noreferrer"
            onClick={e => e.stopPropagation()}
            className="absolute left-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white transition hover:bg-black/75"
            title="Download"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </a>
        </div>
      </div>
    )}
    </>
  );
}
