// Purchase Requisition List — ISP hardware purchase request management।
// কেন এখানে approve/reject action: technician requisition create করে,
// admin approve করে, তারপর purchase order তৈরি হয়।

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, RefreshCw, Eye, SquarePen, Trash2, CircleCheck, CircleX, ClipboardList } from 'lucide-react';
import api from '../../utils/api';
import { asList, money, formatApiError } from '../bandwidth/bandwidthHelpers';

/* ── Status Badge ──────────────────────────────────────── */
function StatusBadge({ status }) {
  const map = {
    pending:   'bg-amber-500 text-white',
    approved:  'bg-emerald-600 text-white',
    rejected:  'bg-rose-600 text-white',
    purchased: 'bg-sky-600 text-white',
  };
  return (
    <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${map[status] || 'bg-slate-200 text-slate-600'}`}>
      {status?.charAt(0).toUpperCase() + status?.slice(1)}
    </span>
  );
}

/* ── Stat Card ─────────────────────────────────────────── */
function StatBox({ label, value, sub, tone = 'blue' }) {
  const map = {
    blue:   'bg-gradient-to-r from-sky-500 to-cyan-600',
    green:  'bg-gradient-to-r from-teal-500 to-emerald-600',
    purple: 'bg-gradient-to-r from-violet-500 to-indigo-600',
    slate:  'bg-gradient-to-r from-slate-500 to-slate-600',
  };
  return (
    <div className={`${map[tone]} rounded-2xl p-6 text-white shadow-sm flex items-center justify-between gap-2`}>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-white/80 truncate">{label}</p>
        <p className="mt-1 text-2xl font-bold truncate">{value}</p>
        <p className="text-xs text-white/70 mt-1 truncate">{sub}</p>
      </div>
      <ClipboardList className="h-10 w-10 text-white/30 shrink-0" />
    </div>
  );
}

/* ── Mobile Card ────────────────────────────────────────── */
function ReqMobileCard({ req, navigate, handleDelete, handleApprove, handleReject }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 hover:border-slate-300 transition-all">
      <div className="flex justify-between items-center border-b border-gray-100 pb-3 mb-3">
        <span className="text-sm font-bold text-gray-900">{req.requisition_no}</span>
        <StatusBadge status={req.status} />
      </div>
      <div className="space-y-2 text-xs">
        {[
          ['Date',       req.requisition_date],
          ['Need By',    req.required_by],
          ['Requested',  req.requested_by_name],
          ['Total',      `৳ ${money(req.total_amount)}`],
        ].map(([label, val]) => val && (
          <div key={label} className="flex justify-between items-center">
            <span className="text-gray-500 font-medium uppercase tracking-wider">{label}:</span>
            <span className="text-gray-900 font-semibold text-right">{val}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap gap-2 justify-end">
        {req.status === 'pending' && (
          <>
            <button onClick={() => handleApprove(req)}
              className="flex items-center gap-1 px-3 py-2 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-xl text-xs font-medium min-h-[44px]">
              <CircleCheck className="h-4 w-4" /> Approve
            </button>
            <button onClick={() => handleReject(req)}
              className="flex items-center gap-1 px-3 py-2 bg-rose-50 text-rose-600 border border-rose-200 rounded-xl text-xs font-medium min-h-[44px]">
              <CircleX className="h-4 w-4" /> Reject
            </button>
          </>
        )}
        <button onClick={() => navigate(`/purchase/requisition/${req.id}/edit`)}
          className="flex items-center gap-1 px-3 py-2 bg-blue-50 text-blue-600 border border-blue-200 rounded-xl text-xs font-medium min-h-[44px]">
          <SquarePen className="h-4 w-4" /> Edit
        </button>
        <button onClick={() => handleDelete(req)}
          className="flex items-center gap-1 px-3 py-2 bg-red-50 text-red-600 border border-red-200 rounded-xl text-xs font-medium min-h-[44px]">
          <Trash2 className="h-4 w-4" /> Delete
        </button>
      </div>
    </div>
  );
}

/* ── Main ─────────────────────────────────────────────── */
export default function RequisitionListPage() {
  const navigate = useNavigate();
  const [reqs, setReqs]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [statusF, setStatusF]   = useState('');
  const [pageSize, setPageSize] = useState(25);
  const [stats, setStats]       = useState({});

  const fetchData = async () => {
    setLoading(true);
    try {
      const [rRes, sRes] = await Promise.all([
        api.get('/purchase/requisitions/?page_size=500'),
        api.get('/purchase/requisitions/stats/'),
      ]);
      setReqs(asList(rRes.data));
      setStats(sRes.data || {});
    } catch {
      toast.error('Requisitions লোড করা যায়নি।');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reqs.filter((r) => {
      const m = !q || [r.requisition_no, r.requested_by_name, r.notes, r.purpose]
        .some((x) => String(x || '').toLowerCase().includes(q));
      const s = !statusF || r.status === statusF;
      return m && s;
    });
  }, [reqs, search, statusF]);

  const visible = useMemo(() => filtered.slice(0, pageSize), [filtered, pageSize]);

  const handleApprove = async (req) => {
    try {
      await api.post(`/purchase/requisitions/${req.id}/approve/`);
      toast.success('Approved.');
      fetchData();
    } catch (err) {
      toast.error(formatApiError(err, 'Action failed.'));
    }
  };

  const handleReject = async (req) => {
    if (!confirm('Reject this requisition?')) return;
    try {
      await api.post(`/purchase/requisitions/${req.id}/reject/`);
      toast.success('Rejected.');
      fetchData();
    } catch (err) {
      toast.error(formatApiError(err, 'Action failed.'));
    }
  };

  const handleDelete = async (req) => {
    if (!confirm(`Delete ${req.requisition_no}?`)) return;
    try {
      await api.delete(`/purchase/requisitions/${req.id}/`);
      toast.success('Deleted.');
      fetchData();
    } catch (err) {
      toast.error(formatApiError(err, 'Delete failed.'));
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Requisition List</h1>
          <p className="text-xs text-slate-500">Purchase Requisitions Management</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchData}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 transition-all">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button onClick={() => navigate('/purchase/requisition/new')}
            className="inline-flex items-center gap-2 rounded-xl bg-[#173d59] hover:bg-[#1f5075] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all">
            <Plus className="h-4 w-4" /> Requisition
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox tone="blue"   label="Total"     value={stats.total    || 0} sub="All requisitions" />
        <StatBox tone="slate"  label="Pending"   value={stats.pending  || 0} sub="Awaiting approval" />
        <StatBox tone="green"  label="Approved"  value={stats.approved || 0} sub="Ready to purchase" />
        <StatBox tone="purple" label="Purchased" value={stats.purchased || 0} sub="Order created" />
      </div>

      {/* Table Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 bg-gray-50 rounded-xl p-4 mb-5">
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Search</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Requisition no, notes..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-400/30" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Status</label>
            <select value={statusF} onChange={(e) => setStatusF(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-400/30">
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="purchased">Purchased</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Show</label>
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none">
              {[10, 25, 50].map((n) => <option key={n} value={n}>{n} entries</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="py-20 text-center text-slate-400 text-sm">Loading...</div>
        ) : (
          <div className="w-full">
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-full divide-y divide-gray-200">
                <thead className="bg-[#23445f]">
                  <tr>
                    {['SN', 'Req No', 'Date', 'Need By', 'Requested By', 'Total Amount', 'Status', 'Action'].map((h) => (
                      <th key={h} className="px-4 py-4 text-white text-xs font-semibold uppercase tracking-wider text-left whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {visible.map((r, i) => (
                    <tr key={r.id} className={`${i % 2 === 1 ? 'bg-gray-50/50' : 'bg-white'} hover:bg-blue-50/30 transition-colors`}>
                      <td className="px-4 py-3 text-slate-500 text-xs">{i + 1}</td>
                      <td className="px-4 py-3 font-semibold text-slate-800">{r.requisition_no}</td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{r.requisition_date || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{r.required_by || '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{r.requested_by_name || '—'}</td>
                      <td className="px-4 py-3 font-mono font-semibold text-slate-800 whitespace-nowrap">
                        ৳ {money(r.total_amount)}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {r.status === 'pending' && (
                            <>
                              <button onClick={() => handleApprove(r)} title="Approve"
                                className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-emerald-500 hover:bg-emerald-50">
                                <CircleCheck className="h-4 w-4" />
                              </button>
                              <button onClick={() => handleReject(r)} title="Reject"
                                className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-rose-500 hover:bg-rose-50">
                                <CircleX className="h-4 w-4" />
                              </button>
                            </>
                          )}
                          <button onClick={() => navigate(`/purchase/requisition/${r.id}/edit`)} title="Edit"
                            className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-sky-500 hover:bg-sky-50">
                            <SquarePen className="h-4 w-4" />
                          </button>
                          <button onClick={() => handleDelete(r)} title="Delete"
                            className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-rose-500 hover:bg-rose-50">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {visible.length === 0 && (
                    <tr><td colSpan={8} className="py-16 text-center text-slate-400">No requisitions found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="block md:hidden space-y-4">
              {visible.length === 0
                ? <p className="text-center py-12 text-slate-400 text-sm">No requisitions found.</p>
                : visible.map((r) => (
                    <ReqMobileCard key={r.id} req={r} navigate={navigate}
                      handleDelete={handleDelete} handleApprove={handleApprove} handleReject={handleReject} />
                  ))}
            </div>

            <p className="mt-4 text-xs text-slate-400">Showing {visible.length} of {filtered.length} entries</p>
          </div>
        )}
      </div>
    </div>
  );
}
