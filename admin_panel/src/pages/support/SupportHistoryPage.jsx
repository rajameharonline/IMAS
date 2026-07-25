// এই পেজে Support → Support History — সব ticket (open/in_progress/resolved/
// closed) এক জায়গায় দেখানো হয়; admin চাইলে date range, status, ticket type
// অনুযায়ী filter করতে পারবে। backend role-based filter অনুযায়ী data দেখাবে।

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import toast from 'react-hot-toast';

function getList(d) { return Array.isArray(d) ? d : (d?.results || []); }
function fmtDateTime(v) {
  if (!v) return '';
  try {
    const d = new Date(v);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      + ', ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch { return v; }
}

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

/* ── Mobile Support History Card ── */
function MobileHistoryCard({ t, idx, navigate, fmtDateTime }) {
  const isEven = idx % 2 === 0;
  const PRIORITY_CLASS = { low: 'bg-gray-100 text-gray-600', medium: 'bg-blue-100 text-blue-700', high: 'bg-amber-100 text-amber-700', critical: 'bg-red-100 text-red-700', urgent: 'bg-red-100 text-red-700' };
  const STATUS_CLASS   = { open: 'bg-amber-100 text-amber-700', in_progress: 'bg-blue-100 text-blue-700', resolved: 'bg-emerald-100 text-emerald-700', closed: 'bg-gray-100 text-gray-500' };
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
      <div className="flex items-start justify-between gap-2 px-3 py-2.5 bg-[#23445f]/5 border-b border-gray-200">
        <div className="min-w-0">
          <button onClick={() => navigate(`/search?client=${t.client}`)}
            className="font-mono text-[12px] font-bold text-teal-700 hover:underline">
            {t.ticket_no || t.ticket_id}
          </button>
          <p className="font-semibold text-gray-900 text-[13px] truncate">{t.client_name || '—'}</p>
          <p className="font-mono text-[11px] text-gray-400">{t.client_customer_id}</p>
        </div>
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${STATUS_CLASS[t.status] || 'bg-gray-100'}`}>
          {t.status_display || t.status}
        </span>
      </div>
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
        <FRow label="Subject"><span className="text-[12px] text-gray-700 truncate">{t.subject}</span></FRow>
        <FRow label="Assigned"><span className="text-[12px] text-gray-700">{t.assigned_employee_name || <span className="italic text-gray-400">Unassigned</span>}</span></FRow>
        <FRow label="Opened"><span className="font-mono text-[11px] text-gray-500">{fmtDateTime(t.created_at)}</span></FRow>
        <FRow label="Resolved"><span className="font-mono text-[11px] text-gray-500">{fmtDateTime(t.resolved_at) || '—'}</span></FRow>
      </div>
    </div>
  );
}

export default function SupportHistoryPage() {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState([]);
  const [types, setTypes]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    status: 'all',
    priority: 'all',
    type: 'all',
    from_date: '',
    to_date: '',
    search: '',
  });

  // Filter helper — local state সরাসরি set।
  const set = (k) => (e) => setFilters(p => ({ ...p, [k]: e.target.value }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page_size: 500, ordering: '-created_at' };
      if (filters.status !== 'all') params.status = filters.status;
      if (filters.priority !== 'all') params.priority = filters.priority;
      if (filters.type !== 'all') params.category = filters.type;
      if (filters.search.trim()) params.search = filters.search.trim();
      const r = await api.get('/support/tickets/', { params });
      let list = getList(r.data);
      // date range — frontend-side filter (backend filter এর জন্য আলাদা endpoint নেই)।
      if (filters.from_date) {
        const fd = new Date(filters.from_date).getTime();
        list = list.filter(t => new Date(t.created_at).getTime() >= fd);
      }
      if (filters.to_date) {
        // to_date inclusive — 23:59:59 ধরে নিই।
        const td = new Date(filters.to_date).getTime() + 86399999;
        list = list.filter(t => new Date(t.created_at).getTime() <= td);
      }
      setTickets(list);
    } catch { toast.error('Failed to load tickets.'); }
    finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    // Filter dropdown-এ TicketType list।
    api.get('/support/categories/', { params: { is_active: true, page_size: 200 } })
      .then(r => setTypes(getList(r.data)))
      .catch(() => {});
  }, []);

  // Stat counters — table-এর উপরে summary।
  const stats = tickets.reduce((acc, t) => {
    acc.total++;
    if (t.status === 'open')        acc.open++;
    if (t.status === 'in_progress') acc.in_progress++;
    if (t.status === 'resolved')    acc.resolved++;
    if (t.status === 'closed')      acc.closed++;
    return acc;
  }, { total: 0, open: 0, in_progress: 0, resolved: 0, closed: 0 });

  return (
    <div className="p-4 sm:p-6 min-h-screen bg-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center shadow-sm">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold font-slab text-gray-800">Support History</h1>
            <p className="text-xs text-teal-600">Support &gt; Full History</p>
          </div>
        </div>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <StatCard label="Total"       value={stats.total}      color="text-gray-800" />
        <StatCard label="Open"        value={stats.open}        color="text-amber-700" />
        <StatCard label="In Progress" value={stats.in_progress} color="text-blue-700" />
        <StatCard label="Resolved"    value={stats.resolved}    color="text-emerald-700" />
        <StatCard label="Closed"      value={stats.closed}      color="text-gray-500" />
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3 mb-4 grid grid-cols-2 md:grid-cols-6 gap-2">
        <input value={filters.search} onChange={set('search')}
          placeholder="Search..."
          className="col-span-2 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
        <select value={filters.status} onChange={set('status')}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400">
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
        <select value={filters.priority} onChange={set('priority')}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400">
          <option value="all">All Priority</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
        <select value={filters.type} onChange={set('type')}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400">
          <option value="all">All Types</option>
          {types.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <button onClick={load}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm hover:bg-gray-50">
          Apply
        </button>

        <input type="date" value={filters.from_date} onChange={set('from_date')}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
        <input type="date" value={filters.to_date} onChange={set('to_date')}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <>
        <div className="hidden space-y-2 p-3">
          {loading ? <p className="text-center py-6 text-gray-400 text-sm">Loading...</p>
           : tickets.length === 0 ? <p className="text-center py-6 text-gray-400 text-sm">No tickets found.</p>
           : tickets.map((t, idx) => (
             <MobileHistoryCard key={t.id} t={t} idx={idx} navigate={navigate} fmtDateTime={fmtDateTime} />
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
                <th className="px-3 py-2.5 text-left font-semibold uppercase text-xs tracking-wide">Assigned</th>
                <th className="px-3 py-2.5 text-left font-semibold uppercase text-xs tracking-wide">Opened</th>
                <th className="px-3 py-2.5 text-left font-semibold uppercase text-xs tracking-wide">Resolved</th>
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
                  <td className="px-3 py-2 text-gray-700 max-w-[280px] truncate" title={t.subject}>{t.subject}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${PRIORITY_CLASS[t.priority] || 'bg-gray-100 text-gray-600'}`}>
                      {t.priority_display || t.priority}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${STATUS_CLASS[t.status] || 'bg-gray-100'}`}>
                      {t.status_display || t.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700">
                    {t.assigned_employee_name || <span className="text-gray-400 italic">Unassigned</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500">{fmtDateTime(t.created_at)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500">{fmtDateTime(t.resolved_at) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`text-2xl font-bold font-mono mt-1 ${color}`}>{value}</p>
    </div>
  );
}
