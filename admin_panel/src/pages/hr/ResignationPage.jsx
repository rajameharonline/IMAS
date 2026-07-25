// HR & Payroll — Resignation পেজ (পদত্যাগ আবেদন CRUD + approve/reject)
// approve হলে Employee.status='resigned' হয়ে যায়; reject/pending হলে 'active'
import { useEffect, useState, useCallback, useMemo } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition';
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => d
  ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  : '—';
const EMPTY = { employee: '', resign_rule: '', apply_date: today(), resign_date: today(), reason: '' };

/* ─── Status badge ──────────────────────────────────────────────────────── */
function StatusBadge({ status }) {
  const cfg = {
    pending:  { bg: 'bg-amber-100 text-amber-700',     label: 'Pending'  },
    approved: { bg: 'bg-emerald-100 text-emerald-700', label: 'Approved' },
    rejected: { bg: 'bg-rose-100 text-rose-700',       label: 'Rejected' },
  }[status] || { bg: 'bg-gray-200 text-gray-700', label: status };
  return <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${cfg.bg}`}>{cfg.label}</span>;
}

/* ─── Add / Edit Modal ──────────────────────────────────────────────────── */
function ResignationModal({ mode, form, setForm, employees, rules, onSave, onClose, saving }) {
  const isEdit = mode === 'edit';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
          <h2 className="text-base font-bold font-slab">{isEdit ? 'Edit Resignation' : 'New Resignation'}</h2>
          <button onClick={onClose} className="text-white/80 hover:text-white text-2xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="px-6 pt-4 pb-3 space-y-4">
          <div>
            <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1.5">
              Employee <span className="text-rose-500">*</span>
            </label>
            <select className={inp} value={form.employee}
              onChange={e => setForm(f => ({ ...f, employee: e.target.value }))} disabled={isEdit}>
              <option value="">Select Employee</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>{e.full_name} — {e.employee_id} ({e.designation})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1.5">Resign Rule</label>
            <select className={inp} value={form.resign_rule}
              onChange={e => setForm(f => ({ ...f, resign_rule: e.target.value }))}>
              <option value="">— None —</option>
              {rules.map(r => (
                <option key={r.id} value={r.id}>{r.name} ({r.notice_period_days}d notice)</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1.5">
                Apply Date <span className="text-rose-500">*</span>
              </label>
              <input type="date" className={inp} value={form.apply_date}
                onChange={e => setForm(f => ({ ...f, apply_date: e.target.value }))} />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1.5">
                Last Working Date <span className="text-rose-500">*</span>
              </label>
              <input type="date" className={inp} value={form.resign_date}
                onChange={e => setForm(f => ({ ...f, resign_date: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1.5">Reason</label>
            <textarea rows={3} className={inp + ' resize-none'} placeholder="Reason for resignation..."
              value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 pb-5 pt-1">
          <button onClick={onClose} className="px-6 py-2 rounded-lg text-sm font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700">Cancel</button>
          <button onClick={onSave} disabled={saving}
            className="px-6 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60">
            {saving ? 'সেভ হচ্ছে...' : isEdit ? 'Update' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Approve / Reject Modal ────────────────────────────────────────────── */
function ActionModal({ action, target, onClose, onDone }) {
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const isApprove = action === 'approve';

  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/hr/resignations/${target.id}/${action}/`, { remarks });
      toast.success(isApprove ? '✅ Approved — Employee status: resigned' : '✅ Rejected — Employee active');
      onDone();
    } catch { toast.error('Action ব্যর্থ।'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className={`flex items-center justify-between px-6 py-4 text-white ${
          isApprove ? 'bg-gradient-to-r from-emerald-600 to-teal-600' : 'bg-gradient-to-r from-rose-600 to-rose-500'
        }`}>
          <h2 className="text-base font-bold font-slab">{isApprove ? 'Approve Resignation' : 'Reject Resignation'}</h2>
          <button onClick={onClose} className="text-white/80 hover:text-white text-2xl leading-none">×</button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <p className="text-sm text-gray-700">
            <span className="font-bold">{target.employee_name}</span> ({target.employee_code}) —{' '}
            Resign Date: <span className="font-mono">{fmtDate(target.resign_date)}</span>
          </p>
          {isApprove && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              ⚠ Approve করলে Employee.status = <strong>resigned</strong> হয়ে যাবে।
            </p>
          )}
          <div>
            <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1.5">Remarks</label>
            <textarea rows={2} className={inp + ' resize-none'} placeholder="Optional note..."
              value={remarks} onChange={e => setRemarks(e.target.value)} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 pb-5 pt-1">
          <button onClick={onClose} className="px-6 py-2 rounded-lg text-sm font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700">Cancel</button>
          <button onClick={submit} disabled={busy}
            className={`px-6 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60 ${
              isApprove ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
            }`}>
            {busy ? '...' : isApprove ? 'Approve' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Page ─────────────────────────────────────────────────────────── */
/* ── Mobile Resignation Card ── */
function MobileResignationCard({ r, idx, fmtDate, setActionTarget, openEdit, handleDelete }) {
  const isEven = idx % 2 === 0;
  const FRow = ({ label, children }) => (
    <div className="flex items-stretch border-b border-gray-200 last:border-0">
      <div className="w-28 shrink-0 bg-gray-50 px-3 py-2.5 flex items-center border-r border-gray-200">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex-1 min-w-0 px-3 py-2.5 flex items-center justify-end bg-white">{children}</div>
    </div>
  );
  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${isEven ? 'bg-white border-gray-200' : 'bg-slate-50/40 border-gray-200'}`}>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-[#23445f]/5 border-b border-gray-200">
        <div className="min-w-0">
          <p className="font-bold text-gray-900 text-[13px] truncate">{r.employee_name}</p>
          <p className="font-mono text-[11px] text-gray-400">{r.employee_code}</p>
        </div>
        <StatusBadge status={r.status} />
      </div>
      <div className="grid grid-cols-2 divide-x divide-gray-200 border-b border-gray-200">
        <div className="flex flex-col px-3 py-2.5">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Apply Date</span>
          <span className="font-mono text-[12px] text-gray-700">{fmtDate(r.apply_date)}</span>
        </div>
        <div className="flex flex-col px-3 py-2.5">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Last Working</span>
          <span className="font-mono text-[12px] text-gray-700">{fmtDate(r.resign_date)}</span>
        </div>
      </div>
      <div>
        <FRow label="Designation"><span className="text-[12px] text-gray-700">{r.employee_designation || '—'}</span></FRow>
        <FRow label="Rule"><span className="text-[12px] text-gray-700">{r.resign_rule_name || '—'}</span></FRow>
        <FRow label="Reason"><span className="text-[12px] text-gray-500 truncate">{r.reason || '—'}</span></FRow>
      </div>
      <div className="flex items-center gap-1.5 px-3 py-2.5 bg-gray-50/60 border-t border-gray-200 flex-wrap">
        {r.status === 'pending' && (
          <>
            <button onClick={() => setActionTarget({ action: 'approve', target: r })}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700">Approve</button>
            <button onClick={() => setActionTarget({ action: 'reject', target: r })}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-rose-600 text-white hover:bg-rose-700">Reject</button>
          </>
        )}
        {r.status !== 'approved' && (
          <button onClick={() => openEdit(r)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100">Edit</button>
        )}
        <button onClick={() => handleDelete(r)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100">Delete</button>
      </div>
    </div>
  );
}

export default function ResignationPage() {
  const [list,       setList]       = useState([]);
  const [employees,  setEmployees]  = useState([]);
  const [rules,      setRules]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [modal,      setModal]      = useState(null);   // 'add' | 'edit'
  const [editTarget, setEditTarget] = useState(null);
  const [form,       setForm]       = useState(EMPTY);
  const [saving,     setSaving]     = useState(false);
  const [actionTarget, setActionTarget] = useState(null); // { action, target }
  const [search,     setSearch]     = useState('');
  const [statusF,    setStatusF]    = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [resList, empRes, ruleRes] = await Promise.all([
        api.get('/hr/resignations/?ordering=-apply_date'),
        api.get('/hr/employees/?page_size=500&ordering=full_name'),
        api.get('/hr/resign-rules/?ordering=id'),
      ]);
      setList(resList.data?.results ?? resList.data ?? []);
      setEmployees(empRes.data?.results ?? empRes.data ?? []);
      setRules((ruleRes.data?.results ?? ruleRes.data ?? []).filter(r => r.is_active));
    } catch { toast.error('ডেটা লোড ব্যর্থ।'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let xs = list;
    if (statusF) xs = xs.filter(r => r.status === statusF);
    const q = search.toLowerCase().trim();
    if (q) {
      xs = xs.filter(r =>
        (r.employee_name || '').toLowerCase().includes(q) ||
        (r.employee_code || '').toLowerCase().includes(q) ||
        (r.reason || '').toLowerCase().includes(q),
      );
    }
    return xs;
  }, [list, search, statusF]);

  const summary = useMemo(() => ({
    total: list.length,
    pending: list.filter(r => r.status === 'pending').length,
    approved: list.filter(r => r.status === 'approved').length,
    rejected: list.filter(r => r.status === 'rejected').length,
  }), [list]);

  const openAdd = () => { setForm(EMPTY); setEditTarget(null); setModal('add'); };
  const openEdit = (r) => {
    setForm({
      employee: r.employee, resign_rule: r.resign_rule || '',
      apply_date: r.apply_date, resign_date: r.resign_date, reason: r.reason || '',
    });
    setEditTarget(r); setModal('edit');
  };
  const closeModal = () => { setModal(null); setEditTarget(null); };

  const handleSave = async () => {
    if (!form.employee)    { toast.error('Employee নির্বাচন করুন।'); return; }
    if (!form.apply_date)  { toast.error('Apply date দিন।'); return; }
    if (!form.resign_date) { toast.error('Resign date দিন।'); return; }
    setSaving(true);
    try {
      const payload = {
        employee: form.employee,
        resign_rule: form.resign_rule || null,
        apply_date: form.apply_date, resign_date: form.resign_date,
        reason: form.reason,
      };
      if (modal === 'edit' && editTarget) {
        await api.patch(`/hr/resignations/${editTarget.id}/`, payload);
        toast.success('Resignation আপডেট হয়েছে।');
      } else {
        await api.post('/hr/resignations/', payload);
        toast.success('Resignation submit হয়েছে — pending approval।');
      }
      closeModal(); load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'সেভ ব্যর্থ।');
    } finally { setSaving(false); }
  };

  const handleDelete = async (r) => {
    if (!window.confirm(`${r.employee_name}-এর resignation মুছবেন?`)) return;
    try {
      await api.delete(`/hr/resignations/${r.id}/`);
      toast.success('Resignation মুছে ফেলা হয়েছে।');
      load();
    } catch { toast.error('মুছতে ব্যর্থ।'); }
  };

  return (
    <div className="p-4 sm:p-6 min-h-screen bg-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="font-slab text-2xl font-bold text-gray-900 flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-sm">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </span>
          Resignations
        </h1>
        <div className="flex items-center gap-3">
          <div className="text-xs text-gray-400 hidden sm:flex items-center gap-1">
            <span className="text-teal-600 font-medium">HR &amp; Payroll</span><span>›</span><span>Resignation</span>
          </div>
          <button onClick={openAdd}
            className="inline-flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Resignation
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="rounded-xl bg-white border border-gray-200 p-4 shadow-sm">
          <p className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Total</p>
          <p className="text-2xl font-bold font-slab text-gray-900 mt-1">{summary.total}</p>
        </div>
        <div className="rounded-xl bg-white border border-amber-100 p-4 shadow-sm">
          <p className="text-[10px] uppercase font-bold text-amber-600 tracking-wider">Pending</p>
          <p className="text-2xl font-bold font-slab text-amber-600 mt-1">{summary.pending}</p>
        </div>
        <div className="rounded-xl bg-white border border-emerald-100 p-4 shadow-sm">
          <p className="text-[10px] uppercase font-bold text-emerald-600 tracking-wider">Approved</p>
          <p className="text-2xl font-bold font-slab text-emerald-600 mt-1">{summary.approved}</p>
        </div>
        <div className="rounded-xl bg-white border border-rose-100 p-4 shadow-sm">
          <p className="text-[10px] uppercase font-bold text-rose-600 tracking-wider">Rejected</p>
          <p className="text-2xl font-bold font-slab text-rose-600 mt-1">{summary.rejected}</p>
        </div>
      </div>

      {/* Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Filters */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-wrap gap-2">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>Status:</span>
            <select value={statusF} onChange={e => setStatusF(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>Search:</span>
            <input value={search} onChange={e => setSearch(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-teal-500"
              placeholder="Name, code, reason..." />
          </div>
        </div>

        {/* Table */}
        <>
        <div className="md:hidden space-y-2 p-3">
          {loading ? <p className="text-center py-6 text-gray-400 text-sm">লোড হচ্ছে...</p>
           : filtered.length === 0 ? <p className="text-center py-6 text-gray-400 text-sm">কোনো resignation নেই।</p>
           : filtered.map((r, idx) => (
             <MobileResignationCard key={r.id} r={r} idx={idx} fmtDate={fmtDate}
               setActionTarget={setActionTarget} openEdit={openEdit} handleDelete={handleDelete} />
           ))}
        </div>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#23445f] text-white text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-center font-semibold w-12">SN</th>
                <th className="px-4 py-3 text-left font-semibold">Employee</th>
                <th className="px-4 py-3 text-left font-semibold">Designation</th>
                <th className="px-4 py-3 text-left font-semibold">Rule</th>
                <th className="px-4 py-3 text-center font-semibold">Apply Date</th>
                <th className="px-4 py-3 text-center font-semibold">Last Working</th>
                <th className="px-4 py-3 text-left font-semibold">Reason</th>
                <th className="px-4 py-3 text-center font-semibold">Status</th>
                <th className="px-4 py-3 text-center font-semibold w-44">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-10 text-gray-400">লোড হচ্ছে...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-10 text-gray-400">কোনো resignation নেই।</td></tr>
              ) : filtered.map((r, idx) => (
                <tr key={r.id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'} hover:bg-teal-50/40 transition-colors border-b border-gray-100`}>
                  <td className="px-4 py-3 text-center font-mono text-xs text-gray-500">{idx + 1}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-gray-800">{r.employee_name}</p>
                    <p className="text-[11px] text-gray-500 font-mono">{r.employee_code}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-700 text-sm">{r.employee_designation || '—'}</td>
                  <td className="px-4 py-3 text-gray-700 text-sm">{r.resign_rule_name || '—'}</td>
                  <td className="px-4 py-3 text-center font-mono text-xs text-gray-600">{fmtDate(r.apply_date)}</td>
                  <td className="px-4 py-3 text-center font-mono text-xs text-gray-600">{fmtDate(r.resign_date)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate" title={r.reason}>{r.reason || '—'}</td>
                  <td className="px-4 py-3 text-center"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1.5 flex-wrap">
                      {r.status === 'pending' && (
                        <>
                          <button onClick={() => setActionTarget({ action: 'approve', target: r })}
                            className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white">
                            Approve
                          </button>
                          <button onClick={() => setActionTarget({ action: 'reject', target: r })}
                            className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-rose-600 hover:bg-rose-700 text-white">
                            Reject
                          </button>
                        </>
                      )}
                      {r.status !== 'approved' && (
                        <button onClick={() => openEdit(r)} title="Edit"
                          className="p-1.5 rounded-lg text-teal-600 hover:bg-teal-50 transition border border-teal-200">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                      )}
                      <button onClick={() => handleDelete(r)} title="Delete"
                        className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 transition border border-rose-200">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      </div>

      {(modal === 'add' || modal === 'edit') && (
        <ResignationModal mode={modal} form={form} setForm={setForm} employees={employees} rules={rules}
          onSave={handleSave} onClose={closeModal} saving={saving} />
      )}

      {actionTarget && (
        <ActionModal action={actionTarget.action} target={actionTarget.target}
          onClose={() => setActionTarget(null)}
          onDone={() => { setActionTarget(null); load(); }} />
      )}
    </div>
  );
}
