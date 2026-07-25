// এই পেজে Support → Client Support — অর্থাৎ active tickets (open + in_progress)
// দেখানো হয়। backend role-based filter অনুযায়ী admin সব দেখবে, employee শুধু
// নিজের কাছে assigned ও নিজের create করা ticket দেখবে — তাই কোনো client-side
// permission filter দরকার নেই, get_queryset সামলায়।
//
// Inline action: admin → assigned_employee re-assign dropdown; সবাই → status
// quick toggle (Open/In Progress/Resolved/Closed)।

import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';

function getList(d) { return Array.isArray(d) ? d : (d?.results || []); }
function fmtDateTime(v) {
  if (!v) return '';
  try {
    const d = new Date(v);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      + ', ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch { return v; }
}

// ticket open হওয়ার পর কত সময় কেটেছে — live count-up timer ("৩h ১২m ০৫s")।
// resolved/closed হলে timer freeze হবে resolved_at-এ।
function elapsedSince(startStr, endStr) {
  if (!startStr) return '';
  const start = new Date(startStr).getTime();
  const end   = endStr ? new Date(endStr).getTime() : Date.now();
  let diff = Math.max(0, Math.floor((end - start) / 1000));
  const d = Math.floor(diff / 86400); diff %= 86400;
  const h = Math.floor(diff / 3600);  diff %= 3600;
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// elapsed color — সময় বাড়লে সতর্কতা: <1h teal, <4h amber, <24h orange, >24h red।
function elapsedColor(startStr, status) {
  if (['resolved', 'closed'].includes(status)) return 'text-emerald-700';
  if (!startStr) return 'text-gray-500';
  const hours = (Date.now() - new Date(startStr).getTime()) / 3600000;
  if (hours < 1)  return 'text-teal-700';
  if (hours < 4)  return 'text-amber-700';
  if (hours < 24) return 'text-orange-700';
  return 'text-red-700';
}

const STATUS_OPTS = [
  { value: 'open',        label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved',    label: 'Resolved' },
  { value: 'closed',      label: 'Closed' },
];

const PRIORITY_CLASS = {
  low:      'bg-gray-100 text-gray-600',
  medium:   'bg-blue-100 text-blue-700',
  high:     'bg-amber-100 text-amber-700',
  critical: 'bg-red-100 text-red-700',
  urgent:   'bg-red-100 text-red-700',
};
const STATUS_CLASS = {
  open:        'bg-amber-100 text-amber-700',
  in_progress: 'bg-blue-100 text-blue-700',
  resolved:    'bg-emerald-100 text-emerald-700',
  closed:      'bg-gray-100 text-gray-500',
};

/* ── Mobile Support Ticket Card ── */
function MobileTicketCard({ t, idx, navigate, isAdmin, staff, STATUS_OPTS, PRIORITY_CLASS, STATUS_CLASS, handleStatusChange, handleAssign, elapsedColor, elapsedSince, fmtDateTime, onReply }) {
  const isEven = idx % 2 === 0;
  const FRow = ({ label, children }) => (
    <div className="flex items-stretch border-b border-gray-200 last:border-0">
      <div className="w-24 shrink-0 bg-gray-50 px-3 py-2.5 flex items-center border-r border-gray-200">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex-1 min-w-0 px-3 py-2.5 flex items-center justify-end bg-white">{children}</div>
    </div>
  );
  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${isEven ? 'bg-white border-gray-200' : 'bg-slate-50/40 border-gray-200'}`}>
      {/* Header: Ticket No + Client + Status */}
      <div className="flex items-start justify-between gap-2 px-3 py-2.5 bg-[#23445f]/5 border-b border-gray-200">
        <div className="min-w-0">
          <button onClick={() => navigate(`/search?client=${t.client}`)}
            className="font-mono text-[12px] font-bold text-teal-700 hover:underline">
            {t.ticket_no || t.ticket_id}
          </button>
          <p className="font-semibold text-gray-900 text-[13px] truncate">{t.client_name || '—'}</p>
          <p className="font-mono text-[11px] text-gray-400">{t.client_customer_id}</p>
        </div>
        <select value={t.status} onChange={(e) => handleStatusChange(t, e.target.value)}
          className={`shrink-0 text-[10px] font-semibold uppercase border-0 rounded-full px-2 py-1 focus:outline-none cursor-pointer ${STATUS_CLASS[t.status] || 'bg-gray-100'}`}>
          {STATUS_OPTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      {/* 2-column: Type | Priority */}
      <div className="grid grid-cols-2 divide-x divide-gray-200 border-b border-gray-200">
        <div className="flex flex-col px-3 py-2.5">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Type</span>
          <span className="text-[12px] text-gray-700 truncate">{t.ticket_type_name || '—'}</span>
        </div>
        <div className="flex flex-col px-3 py-2.5">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Priority</span>
          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase w-fit ${PRIORITY_CLASS[t.priority] || 'bg-gray-100 text-gray-600'}`}>
            {t.priority_display || t.priority}
          </span>
        </div>
      </div>
      <div>
        <FRow label="Subject">
          <span className="text-[12px] text-gray-700 truncate" title={t.subject}>{t.subject}</span>
        </FRow>
        <FRow label="Assigned">
          {isAdmin ? (
            <select value={t.assigned_to || ''} onChange={(e) => handleAssign(t, e.target.value)}
              className="border border-gray-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-teal-400">
              <option value="">— Unassigned —</option>
              {staff.map(u => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
            </select>
          ) : (
            <span className="text-[12px] text-gray-700">{t.assigned_employee_name || <span className="italic text-gray-400">Unassigned</span>}</span>
          )}
        </FRow>
        <FRow label="Opened">
          <span className="font-mono text-[11px] text-gray-500">{fmtDateTime(t.created_at)}</span>
        </FRow>
        <FRow label="Elapsed">
          <span className={`font-mono text-[11px] font-semibold inline-flex items-center gap-1 ${elapsedColor(t.created_at, t.status)}`}>
            {!['resolved', 'closed'].includes(t.status) && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
            {elapsedSince(t.created_at, ['resolved', 'closed'].includes(t.status) ? (t.resolved_at || t.closed_at) : null)}
          </span>
        </FRow>
        <button onClick={onReply}
          className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 text-sm font-bold">
          💬 উত্তর / AI খসড়া
        </button>
      </div>
    </div>
  );
}

export default function ClientSupportPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  // current user-এর role দেখে admin কি না বিচার — re-assign dropdown টগল।
  const isAdmin = user && (
    user.is_superuser || user.is_staff || ['admin', 'superadmin'].includes(user.role)
  );

  // Dashboard থেকে navigate হলে ?status=open / in_progress URL-এ থাকবে; সেই
  // অনুযায়ী initial filter set — drill-down অভিজ্ঞতা।
  const initialStatus = searchParams.get('status') || 'all';
  const initialPriority = searchParams.get('priority') || 'all';

  const [tickets, setTickets]     = useState([]);
  const [staff, setStaff]         = useState([]);
  const [loading, setLoading]     = useState(false);
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [priorityFilter, setPriorityFilter] = useState(initialPriority);
  const [search, setSearch]       = useState('');
  // tick — প্রতি সেকেন্ডে state bump করে elapsedSince re-compute করি।
  const [, setTick]               = useState(0);

  // Close confirmation modal state — closing-এর আগে RADIUS অনলাইন চেক করি।
  // ticket: কোন ticket close হবে; onlineStatus: { is_online, client_name, ... };
  // checking: API call চলছে কিনা।
  const [closeModal, setCloseModal] = useState(null);  // { ticket } | null
  const [onlineStatus, setOnlineStatus] = useState(null);
  const [checking, setChecking]         = useState(false);

  // Reply modal (AI suggest সহ)
  const [replyModal, setReplyModal] = useState(null);  // { ticket } | null
  const [replyText, setReplyText]   = useState('');
  const [aiLoading, setAiLoading]   = useState(false);
  const [sending, setSending]       = useState(false);

  const openReply = (t) => { setReplyText(''); setReplyModal({ ticket: t }); };

  const aiSuggest = async () => {
    if (!replyModal) return;
    const tid = replyModal.ticket.id;
    setAiLoading(true);
    try {
      // নতুন (ভিন্ন) খসড়া শুরু — backend background-এ LLM চালায়
      let r = await api.post(`/support/tickets/${tid}/suggest-reply/`, { regenerate: true });
      if (r.data?.draft) { setReplyText(r.data.draft); return; }

      // রেডি না হওয়া পর্যন্ত poll (যত সময় লাগে — সর্বোচ্চ ~৫ মিনিট)
      const startedAt = Date.now();
      while (Date.now() - startedAt < 300000) {
        await new Promise(res => setTimeout(res, 3000));
        r = await api.post(`/support/tickets/${tid}/suggest-reply/`);
        if (r.data?.draft) { setReplyText(r.data.draft); return; }
      }
      toast.error('AI খসড়া তৈরিতে বেশি সময় লাগছে — একটু পরে আবার চেষ্টা করুন।');
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'AI খসড়া তৈরি ব্যর্থ।');
    } finally { setAiLoading(false); }
  };

  const sendReply = async () => {
    if (!replyModal || !replyText.trim()) return;
    setSending(true);
    try {
      await api.post(`/support/tickets/${replyModal.ticket.id}/reply/`, { message: replyText.trim() });
      toast.success('উত্তর পাঠানো হয়েছে।');
      setReplyModal(null);
    } catch {
      toast.error('উত্তর পাঠানো ব্যর্থ।');
    } finally { setSending(false); }
  };
  const [closing, setClosing]           = useState(false);

  // Live timer effect — প্রতি ১s elapsed value re-render।
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // active = open + in_progress; backend status filter একটাই accept করে,
      // তাই dual-call করে merge করি যদি 'active' filter active থাকে।
      const params = { page_size: 200, ordering: '-created_at' };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (priorityFilter !== 'all') params.priority = priorityFilter;
      if (search.trim()) params.search = search.trim();
      const r = await api.get('/support/tickets/', { params });
      let list = getList(r.data);
      // "active" pseudo-filter — open + in_progress দুটোই দেখাব।
      if (statusFilter === 'active') {
        list = list.filter(t => ['open', 'in_progress'].includes(t.status));
      }
      setTickets(list);
    } catch { toast.error('Failed to load tickets.'); }
    finally { setLoading(false); }
  }, [statusFilter, priorityFilter, search]);

  useEffect(() => { load(); }, [load]);

  // URL ↔ filter sync — refresh হলে filter বজায় থাকবে; deep-link share-যোগ্য।
  useEffect(() => {
    const params = {};
    if (statusFilter !== 'all')   params.status   = statusFilter;
    if (priorityFilter !== 'all') params.priority = priorityFilter;
    setSearchParams(params, { replace: true });
  }, [statusFilter, priorityFilter, setSearchParams]);

  // Staff list — re-assign dropdown-এর জন্য, শুধু admin user-এর জন্য fetch।
  useEffect(() => {
    if (!isAdmin) return;
    api.get('/auth/users/', { params: { page_size: 200 } })
      .then(r => setStaff(getList(r.data)))
      .catch(() => {});
  }, [isAdmin]);

  const handleStatusChange = async (t, newStatus) => {
    if (newStatus === t.status) return;

    // ── Close অনুরোধ হলে আলাদা flow — RADIUS live online check + confirm modal।
    // Business rule: client offline হলে ticket close করা যাবে না।
    if (newStatus === 'closed') {
      setCloseModal({ ticket: t });
      setOnlineStatus(null);
      setChecking(true);
      try {
        const r = await api.get(`/support/tickets/${t.id}/client-online-status/`);
        setOnlineStatus(r.data);
      } catch {
        // RADIUS service unavailable হলে safe-side block দেখাই।
        setOnlineStatus({ is_online: false, can_close: false, client_name: t.client_name, username: '' });
      } finally {
        setChecking(false);
      }
      return;
    }

    // অন্য সব status change normal flow।
    try {
      await api.post(`/support/tickets/${t.id}/change-status/`, { status: newStatus });
      toast.success(`Ticket ${t.ticket_no || t.ticket_id} → ${newStatus}`);
      load();
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Status update failed.';
      toast.error(msg);
    }
  };

  // Confirm modal-এর Close বাটন — অনলাইন থাকলে চলে, না হলে disabled।
  const handleConfirmClose = async () => {
    if (!closeModal || !onlineStatus?.is_online) return;
    setClosing(true);
    try {
      await api.post(`/support/tickets/${closeModal.ticket.id}/change-status/`, { status: 'closed' });
      toast.success(`Ticket ${closeModal.ticket.ticket_no || closeModal.ticket.ticket_id} closed.`);
      setCloseModal(null);
      load();
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Failed to close ticket.';
      toast.error(msg);
    } finally {
      setClosing(false);
    }
  };

  // RADIUS-এর live status re-check বাটন — client এর মধ্যে অনলাইন হলে refresh।
  const recheckOnline = async () => {
    if (!closeModal) return;
    setChecking(true);
    setOnlineStatus(null);
    try {
      const r = await api.get(`/support/tickets/${closeModal.ticket.id}/client-online-status/`);
      setOnlineStatus(r.data);
    } catch {
      setOnlineStatus({ is_online: false, can_close: false, client_name: closeModal.ticket.client_name, username: '' });
    } finally {
      setChecking(false);
    }
  };

  const handleAssign = async (t, newUserId) => {
    try {
      await api.post(`/support/tickets/${t.id}/assign/`,
        { assigned_to: newUserId || null });
      toast.success('Re-assigned.');
      load();
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Re-assign failed.';
      toast.error(msg);
    }
  };

  return (
    <div className="p-4 sm:p-6 min-h-screen bg-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center shadow-sm">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold font-slab text-gray-800">Client Support</h1>
            <p className="text-xs text-teal-600">
              Support &gt; Active Tickets {isAdmin ? '(All)' : '(My Tickets)'}
            </p>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3 mb-4 flex flex-wrap items-center gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by ticket #, client name, phone..."
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-[220px] focus:outline-none focus:ring-2 focus:ring-teal-400" />

        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400">
          <option value="all">All Status</option>
          <option value="active">Active (Open + In Progress)</option>
          {STATUS_OPTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400">
          <option value="all">All Priority</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>

        <button onClick={load}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm hover:bg-gray-50">
          Refresh
        </button>
      </div>

      {/* Ticket table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <>
        <div className="hidden space-y-2 p-3">
          {loading ? <p className="text-center py-6 text-gray-400 text-sm">Loading...</p>
           : tickets.length === 0 ? <p className="text-center py-6 text-gray-400 text-sm">No tickets found.</p>
           : tickets.map((t, idx) => (
             <MobileTicketCard key={t.id} t={t} idx={idx}
               navigate={navigate} isAdmin={isAdmin} staff={staff}
               STATUS_OPTS={STATUS_OPTS} PRIORITY_CLASS={PRIORITY_CLASS} STATUS_CLASS={STATUS_CLASS}
               handleStatusChange={handleStatusChange} handleAssign={handleAssign}
               elapsedColor={elapsedColor} elapsedSince={elapsedSince} fmtDateTime={fmtDateTime}
               onReply={() => openReply(t)} />
           ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="bg-[#23445f] text-white">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold uppercase text-xs tracking-wide">Ticket No</th>
                <th className="px-3 py-2.5 text-left font-semibold uppercase text-xs tracking-wide">Client</th>
                <th className="px-3 py-2.5 text-left font-semibold uppercase text-xs tracking-wide">Type</th>
                <th className="px-3 py-2.5 text-left font-semibold uppercase text-xs tracking-wide">Subject</th>
                <th className="px-3 py-2.5 text-center font-semibold uppercase text-xs tracking-wide">Priority</th>
                <th className="px-3 py-2.5 text-center font-semibold uppercase text-xs tracking-wide">Status</th>
                <th className="px-3 py-2.5 text-left font-semibold uppercase text-xs tracking-wide">Assigned To</th>
                <th className="px-3 py-2.5 text-left font-semibold uppercase text-xs tracking-wide">Opened</th>
                <th className="px-3 py-2.5 text-left font-semibold uppercase text-xs tracking-wide">Elapsed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan="9" className="text-center py-10 text-gray-400">Loading...</td></tr>
              ) : tickets.length === 0 ? (
                <tr><td colSpan="9" className="text-center py-10 text-gray-400">No tickets found.</td></tr>
              ) : tickets.map(t => (
                <tr key={t.id} className="hover:bg-teal-50/40">
                  <td className="px-3 py-2 font-mono text-xs">
                    <button onClick={() => navigate(`/search?client=${t.client}`)}
                      className="text-teal-700 hover:underline">
                      {t.ticket_no || t.ticket_id}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-gray-800 font-medium">{t.client_name || '—'}</div>
                    <div className="text-[11px] text-gray-500 font-mono">{t.client_customer_id}</div>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{t.ticket_type_name || '—'}</td>
                  <td className="px-3 py-2 text-gray-700 max-w-[260px] truncate" title={t.subject}>{t.subject}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${PRIORITY_CLASS[t.priority] || 'bg-gray-100 text-gray-600'}`}>
                      {t.priority_display || t.priority}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {/* Employee → quick status toggle; ম্যানেজার / admin-ও পারে */}
                    <select value={t.status}
                      onChange={(e) => handleStatusChange(t, e.target.value)}
                      className={`text-[11px] font-semibold uppercase border-0 rounded-full px-2 py-1 focus:outline-none cursor-pointer ${STATUS_CLASS[t.status] || 'bg-gray-100'}`}>
                      {STATUS_OPTS.map(s => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    {isAdmin ? (
                      // Admin re-assign dropdown — সব staff list থেকে।
                      <select value={t.assigned_to || ''}
                        onChange={(e) => handleAssign(t, e.target.value)}
                        className="border border-gray-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-teal-400">
                        <option value="">— Unassigned —</option>
                        {staff.map(u => (
                          <option key={u.id} value={u.id}>
                            {u.full_name || u.username}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-gray-700">
                        {t.assigned_employee_name || <span className="text-gray-400 italic">Unassigned</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">
                    {fmtDateTime(t.created_at)}
                    <button onClick={() => openReply(t)} title="উত্তর / AI খসড়া"
                      className="ml-2 inline-flex items-center gap-1 px-2 py-1 rounded bg-violet-50 text-violet-700 hover:bg-violet-100 font-semibold">
                      💬 Reply
                    </button>
                  </td>
                  {/* Live elapsed — resolved/closed হলে freeze, না হলে count-up। */}
                  <td className={`px-3 py-2 font-mono text-xs font-semibold whitespace-nowrap ${elapsedColor(t.created_at, t.status)}`}>
                    <span className="inline-flex items-center gap-1">
                      {!['resolved', 'closed'].includes(t.status) && (
                        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                      )}
                      {elapsedSince(t.created_at,
                        ['resolved', 'closed'].includes(t.status) ? (t.resolved_at || t.closed_at) : null)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      </div>

      {/* ── Close Ticket Confirmation Modal — live RADIUS online check ── */}
      {closeModal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-0 md:p-4">
          <div className="w-full md:max-w-md bg-white rounded-t-2xl md:rounded-2xl max-h-[85vh] overflow-y-auto shadow-2xl">
            {/* Header */}
            <div className="bg-[#1c2333] text-white px-5 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <h3 className="text-base font-semibold font-slab">Close Ticket</h3>
              </div>
              <button onClick={() => setCloseModal(null)}
                disabled={closing}
                className="text-gray-300 hover:text-white p-1 -mr-1 disabled:opacity-50">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Ticket snapshot */}
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Ticket</p>
              <p className="text-sm font-semibold text-gray-800">
                <span className="font-mono text-teal-700">{closeModal.ticket.ticket_no || closeModal.ticket.ticket_id}</span>
                <span className="ml-2 text-gray-600 font-normal">— {closeModal.ticket.subject}</span>
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {closeModal.ticket.client_name} ·
                <span className="font-mono ml-1">{closeModal.ticket.client_customer_id}</span>
              </p>
            </div>

            {/* Online status block */}
            <div className="px-5 py-5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
                Live Client Connectivity (RADIUS)
              </p>

              {checking ? (
                // Loading state
                <div className="flex items-center gap-2 p-4 rounded-lg bg-gray-50 border border-gray-200">
                  <span className="w-4 h-4 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-gray-600">Checking client online status...</span>
                </div>
              ) : onlineStatus?.is_online ? (
                // Online — green, allow close
                <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                    <span className="text-sm font-bold text-emerald-700 uppercase tracking-wide">Online</span>
                    {onlineStatus.source && (
                      <span className="ml-auto text-[9px] font-mono uppercase bg-emerald-200 text-emerald-800 px-1.5 py-0.5 rounded">
                        via {onlineStatus.source}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-emerald-800">
                    Client <span className="font-semibold">{onlineStatus.client_name}</span>
                    {' '}is currently connected. You can close this ticket.
                  </p>
                  {/* Diagnostic chips — কোন signal-এ match হলো */}
                  <div className="mt-2 flex flex-wrap gap-1 text-[10px] font-mono">
                    {onlineStatus.username && (
                      <span className={`px-1.5 py-0.5 rounded ${onlineStatus.matched_by === 'username' ? 'bg-emerald-200 text-emerald-900 font-bold' : 'bg-white text-gray-600'}`}>
                        user: {onlineStatus.username}
                      </span>
                    )}
                    {onlineStatus.mac_address && (
                      <span className={`px-1.5 py-0.5 rounded ${onlineStatus.matched_by === 'mac' ? 'bg-emerald-200 text-emerald-900 font-bold' : 'bg-white text-gray-600'}`}>
                        mac: {onlineStatus.mac_address}
                      </span>
                    )}
                    {onlineStatus.ip_address && (
                      <span className={`px-1.5 py-0.5 rounded ${onlineStatus.matched_by === 'ip' ? 'bg-emerald-200 text-emerald-900 font-bold' : 'bg-white text-gray-600'}`}>
                        ip: {onlineStatus.ip_address}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                // Offline — red, block close
                <div className="p-4 rounded-lg bg-red-50 border border-red-200">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                    <span className="text-sm font-bold text-red-700 uppercase tracking-wide">Offline</span>
                  </div>
                  <p className="text-xs text-red-800">
                    Client <span className="font-semibold">{onlineStatus?.client_name || closeModal.ticket.client_name}</span>
                    {' '}is currently offline (no active session in RADIUS or Mikrotik).
                    Closing is blocked until the client is back online.
                  </p>
                  {/* Diagnostic chips — none matched */}
                  <div className="mt-2 flex flex-wrap gap-1 text-[10px] font-mono">
                    {onlineStatus?.username && (
                      <span className="px-1.5 py-0.5 rounded bg-white text-gray-500">
                        user: {onlineStatus.username}
                      </span>
                    )}
                    {onlineStatus?.mac_address && (
                      <span className="px-1.5 py-0.5 rounded bg-white text-gray-500">
                        mac: {onlineStatus.mac_address}
                      </span>
                    )}
                    {onlineStatus?.ip_address && (
                      <span className="px-1.5 py-0.5 rounded bg-white text-gray-500">
                        ip: {onlineStatus.ip_address}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-red-700/80 mt-2 italic">
                    Tip: ask the customer to reconnect, then press Re-check.
                  </p>
                </div>
              )}

              {/* Re-check button — single-line action */}
              {!checking && (
                <button onClick={recheckOnline}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 hover:text-teal-900">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Re-check online status
                </button>
              )}
            </div>

            {/* Footer actions */}
            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2 bg-gray-50">
              <button onClick={() => setCloseModal(null)}
                disabled={closing}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleConfirmClose}
                disabled={closing || checking || !onlineStatus?.is_online}
                className="px-5 py-2 text-sm font-semibold rounded-lg text-white flex items-center gap-2
                  disabled:opacity-50 disabled:cursor-not-allowed
                  bg-emerald-600 hover:bg-emerald-700">
                {closing && (
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                Confirm Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reply modal (AI suggest সহ) ── */}
      {replyModal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-0 md:p-4">
          <div className="bg-white w-full md:max-w-lg rounded-t-2xl md:rounded-2xl shadow-xl">
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <h3 className="font-bold text-gray-800 text-sm">
                উত্তর — {replyModal.ticket.ticket_no || replyModal.ticket.ticket_id}
              </h3>
              <button onClick={() => setReplyModal(null)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
            </div>
            <div className="p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-500">উত্তর লিখুন</span>
                <button onClick={aiSuggest} disabled={aiLoading}
                  className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white">
                  {aiLoading
                    ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : '🤖'}
                  {aiLoading ? 'AI লিখছে… (একটু সময় লাগতে পারে)' : 'AI খসড়া উত্তর'}
                </button>
              </div>
              <textarea value={replyText} onChange={e => setReplyText(e.target.value)} rows={6}
                placeholder="এখানে উত্তর লিখুন, অথবা 'AI খসড়া উত্তর' চাপুন…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400" />
              <p className="text-[10px] text-gray-400 mt-1">🔒 AI-তে শুধু status/বকেয়া/online যায় — NID/পাসওয়ার্ড/ঠিকানা নয়। খসড়া edit করে পাঠান।</p>
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2 bg-gray-50">
              <button onClick={() => setReplyModal(null)} disabled={sending}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50">বাতিল</button>
              <button onClick={sendReply} disabled={sending || !replyText.trim()}
                className="px-5 py-2 text-sm font-semibold rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2">
                {sending && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                পাঠান
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
