// HR & Payroll — Resign Rule পেজ (পদত্যাগ নীতি CRUD)
// Design: Payslip Manager-এর সাথে মিল — gradient header, #1c2333 table, teal accent
import { useEffect, useState, useCallback, useMemo } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition';
const EMPTY = { name: '', notice_period_days: 30, deduction_percentage: 0, description: '', is_active: true };

/* ─── Add / Edit Modal ──────────────────────────────────────────────────── */
function RuleModal({ mode, form, setForm, onSave, onClose, saving }) {
  const isEdit = mode === 'edit';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
          <h2 className="text-base font-bold font-slab">{isEdit ? 'Edit Resign Rule' : 'Add Resign Rule'}</h2>
          <button onClick={onClose} className="text-white/80 hover:text-white text-2xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="px-6 pt-4 pb-3 space-y-4">
          <div>
            <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1.5">
              Rule Name <span className="text-rose-500">*</span>
            </label>
            <input className={inp} placeholder="e.g. Standard 30-Day Notice"
              value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1.5">
                Notice Period (Days) <span className="text-rose-500">*</span>
              </label>
              <input type="number" min="0" className={inp}
                value={form.notice_period_days}
                onChange={e => setForm(f => ({ ...f, notice_period_days: e.target.value }))} />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1.5">
                Early-Leave Deduction (%)
              </label>
              <input type="number" min="0" step="0.01" className={inp}
                value={form.deduction_percentage}
                onChange={e => setForm(f => ({ ...f, deduction_percentage: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1.5">Description</label>
            <textarea rows={3} className={inp + ' resize-none'} placeholder="Policy details..."
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          {/* Active toggle */}
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <button type="button" onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
              className={`relative w-11 h-6 rounded-full transition-colors ${form.is_active ? 'bg-teal-500' : 'bg-gray-300'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.is_active ? 'translate-x-5' : ''}`} />
            </button>
            <span className="text-[11px] font-bold text-gray-600 uppercase tracking-wide">Active</span>
          </label>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 pb-5 pt-1">
          <button onClick={onClose}
            className="px-6 py-2 rounded-lg text-sm font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700">Cancel</button>
          <button onClick={onSave} disabled={saving}
            className="px-6 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60">
            {saving ? 'সেভ হচ্ছে...' : isEdit ? 'Update' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Mobile Card Component ─────────────────────────────────────────────── */
function MobileResignRuleCard({ r, onEdit, onDelete }) {
  const FRow = ({ label, children }) => (
    <div className="flex items-stretch border-b border-gray-200 last:border-0">
      <div className="w-28 shrink-0 bg-gray-50 px-3 py-2.5 flex items-center border-r border-gray-200">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex-1 min-w-0 px-3 py-2.5 flex items-center justify-end bg-white">{children}</div>
    </div>
  );
  return (
    <div className="rounded-xl border border-gray-200 shadow-sm overflow-hidden bg-white">
      {/* Header */}
      <div className="px-3 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-2">
        <span className="font-semibold text-sm text-gray-800">{r.name}</span>
        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${
          r.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'
        }`}>{r.is_active ? 'Active' : 'Inactive'}</span>
      </div>
      {/* 2-column grid row */}
      <div className="grid grid-cols-2 border-b border-gray-200">
        <div className="flex flex-col border-r border-gray-200">
          <div className="bg-gray-50 px-3 py-1.5 border-b border-gray-200">
            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Notice Days</span>
          </div>
          <div className="px-3 py-2.5 bg-white flex items-center justify-end">
            <span className="text-sm font-mono text-gray-700">{r.notice_period_days}</span>
          </div>
        </div>
        <div className="flex flex-col">
          <div className="bg-gray-50 px-3 py-1.5 border-b border-gray-200">
            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Deduction %</span>
          </div>
          <div className="px-3 py-2.5 bg-white flex items-center justify-end">
            <span className="text-sm font-mono text-gray-700">{Number(r.deduction_percentage)}%</span>
          </div>
        </div>
      </div>
      {/* Description row */}
      <FRow label="Description">
        <span className="text-xs text-gray-500 text-right">{r.description || '—'}</span>
      </FRow>
      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-3 py-2 bg-gray-50 border-t border-gray-200">
        <button
          onClick={() => onEdit(r)}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100"
        >Edit</button>
        <button
          onClick={() => onDelete(r)}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors bg-red-50 text-red-600 border-red-200 hover:bg-red-100"
        >Delete</button>
      </div>
    </div>
  );
}

/* ─── Main Page ─────────────────────────────────────────────────────────── */
export default function ResignRulePage() {
  const [rules,      setRules]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [modal,      setModal]      = useState(null);   // null | 'add' | 'edit'
  const [editTarget, setEditTarget] = useState(null);
  const [form,       setForm]       = useState(EMPTY);
  const [saving,     setSaving]     = useState(false);
  const [search,     setSearch]     = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/hr/resign-rules/?ordering=id');
      setRules(res.data?.results ?? res.data ?? []);
    } catch { toast.error('Resign Rules লোড ব্যর্থ।'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return rules;
    return rules.filter(r => r.name.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q));
  }, [rules, search]);

  const openAdd = () => { setForm(EMPTY); setEditTarget(null); setModal('add'); };
  const openEdit = (r) => {
    setForm({
      name: r.name, notice_period_days: r.notice_period_days,
      deduction_percentage: r.deduction_percentage, description: r.description || '',
      is_active: r.is_active,
    });
    setEditTarget(r); setModal('edit');
  };
  const closeModal = () => { setModal(null); setEditTarget(null); };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Rule Name দিন।'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        notice_period_days: Number(form.notice_period_days) || 0,
        deduction_percentage: Number(form.deduction_percentage) || 0,
        description: form.description,
        is_active: form.is_active,
      };
      if (modal === 'edit' && editTarget) {
        await api.patch(`/hr/resign-rules/${editTarget.id}/`, payload);
        toast.success('Resign Rule আপডেট হয়েছে।');
      } else {
        await api.post('/hr/resign-rules/', payload);
        toast.success('নতুন Resign Rule যোগ হয়েছে।');
      }
      closeModal(); load();
    } catch (err) {
      toast.error(err?.response?.data?.name?.[0] || 'সেভ ব্যর্থ হয়েছে।');
    } finally { setSaving(false); }
  };

  const handleDelete = async (r) => {
    if (!window.confirm(`"${r.name}" rule মুছবেন?`)) return;
    try {
      await api.delete(`/hr/resign-rules/${r.id}/`);
      toast.success('Rule মুছে ফেলা হয়েছে।');
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
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </span>
          Resign Rules
        </h1>
        <div className="flex items-center gap-3">
          <div className="text-xs text-gray-400 hidden sm:flex items-center gap-1">
            <span className="text-teal-600 font-medium">HR &amp; Payroll</span><span>›</span><span>Resign Rule</span>
          </div>
          <button onClick={openAdd}
            className="inline-flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Rule
          </button>
        </div>
      </div>

      {/* Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Search */}
        <div className="flex items-center justify-end px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>Search:</span>
            <input value={search} onChange={e => setSearch(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-teal-500"
              placeholder="Name..." />
          </div>
        </div>

        {/* Table */}
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-2 p-3">
            {loading ? (
              <p className="text-center py-6 text-gray-400 text-sm">লোড হচ্ছে...</p>
            ) : filtered.length === 0 ? (
              <p className="text-center py-6 text-gray-400 text-sm">কোনো Resign Rule নেই।</p>
            ) : filtered.map((r, idx) => (
              <MobileResignRuleCard
                key={r.id}
                r={r}
                onEdit={openEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#23445f] text-white text-xs uppercase tracking-wide">
                  <th className="px-4 py-3 text-center font-semibold w-16">SN</th>
                  <th className="px-4 py-3 text-left font-semibold">Rule Name</th>
                  <th className="px-4 py-3 text-center font-semibold">Notice Days</th>
                  <th className="px-4 py-3 text-center font-semibold">Deduction %</th>
                  <th className="px-4 py-3 text-left font-semibold">Description</th>
                  <th className="px-4 py-3 text-center font-semibold">Status</th>
                  <th className="px-4 py-3 text-center font-semibold w-28">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="text-center py-10 text-gray-400">লোড হচ্ছে...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-10 text-gray-400">কোনো Resign Rule নেই।</td></tr>
                ) : filtered.map((r, idx) => (
                  <tr key={r.id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'} hover:bg-teal-50/40 transition-colors border-b border-gray-100`}>
                    <td className="px-4 py-3 text-center font-mono text-xs text-gray-500">{idx + 1}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{r.name}</td>
                    <td className="px-4 py-3 text-center font-mono text-gray-700">{r.notice_period_days}</td>
                    <td className="px-4 py-3 text-center font-mono text-gray-700">{Number(r.deduction_percentage)}%</td>
                    <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">{r.description || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        r.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'
                      }`}>{r.is_active ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => openEdit(r)} title="Edit"
                          className="p-1.5 rounded-lg text-teal-600 hover:bg-teal-50 transition border border-teal-200">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
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
        <RuleModal mode={modal} form={form} setForm={setForm} onSave={handleSave} onClose={closeModal} saving={saving} />
      )}
    </div>
  );
}
