// HR & Payroll — Pay Heads পেইজ (স্ক্রিনশট অনুযায়ী)
import { useEffect, useState, useCallback, useMemo } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition';
const EMPTY = { name: '', payhead_type: '', description: '' };

const TYPE_DISPLAY = { addition: 'Addition', deduction: 'Deduction' };

// ══════════════════════════════════════════════════════════════
// Modal — Add / Edit
// ══════════════════════════════════════════════════════════════
function PayHeadModal({ mode, form, setForm, onSave, onClose, saving }) {
  const isEdit = mode === 'edit';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
          <h2 className="text-base font-bold font-slab">
            {isEdit ? 'Edit Pay Head' : 'Add Pay Head'}
          </h2>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white text-2xl leading-none"
          >×</button>
        </div>

        {/* Body */}
        <div className="px-5 pt-4 pb-3 space-y-4">

          {/* Payhead Name */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">
              PAYHEAD NAME : <span className="text-red-500">*</span>
            </label>
            <input
              className={inp}
              placeholder="Payhead name"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>

          {/* Payhead Type */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">
              PAYHEAD TYPE: <span className="text-red-500">*</span>
            </label>
            <select
              className={inp + ' bg-white'}
              value={form.payhead_type}
              onChange={e => setForm(f => ({ ...f, payhead_type: e.target.value }))}
            >
              <option value="">Select PayHead Type</option>
              <option value="addition">Addition</option>
              <option value="deduction">Deduction</option>
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">
              DESCRIPTION
            </label>
            <textarea
              rows={3}
              className={inp + ' resize-none'}
              placeholder="Description..."
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 pb-5 pt-1">
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-lg text-sm font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
          >Cancel</button>
          <button
            onClick={onSave}
            disabled={saving}
            className="px-6 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-60"
          >
            {saving ? 'সেভ হচ্ছে...' : isEdit ? 'Update' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Mobile Card Component
// ══════════════════════════════════════════════════════════════
function MobilePayHeadCard({ ph, onEdit }) {
  const FRow = ({ label, children }) => (
    <div className="flex items-stretch border-b border-gray-200 last:border-0">
      <div className="w-28 shrink-0 bg-gray-50 px-3 py-2.5 flex items-center border-r border-gray-200">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex-1 min-w-0 px-3 py-2.5 flex items-center justify-end bg-white">{children}</div>
    </div>
  );
  const isAddition = ph.payhead_type === 'addition';
  return (
    <div className="rounded-xl border border-gray-200 shadow-sm overflow-hidden bg-white">
      {/* Header */}
      <div className="px-3 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-2">
        <span className="font-semibold text-sm text-gray-800">{ph.name}</span>
        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${
          isAddition ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
        }`}>
          {ph.payhead_type_display || TYPE_DISPLAY[ph.payhead_type] || ph.payhead_type}
        </span>
      </div>
      {/* Rows */}
      <FRow label="Type">
        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${
          isAddition ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
        }`}>
          {ph.payhead_type_display || TYPE_DISPLAY[ph.payhead_type] || ph.payhead_type}
        </span>
      </FRow>
      <FRow label="Description">
        <span className="text-xs text-gray-500 text-right">{ph.description || '—'}</span>
      </FRow>
      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-3 py-2 bg-gray-50 border-t border-gray-200">
        <button
          onClick={() => onEdit(ph)}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100"
        >Edit</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Main PayHeadPage
// ══════════════════════════════════════════════════════════════
export default function PayHeadPage() {
  const [payheads,    setPayheads]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [modal,       setModal]       = useState(null);   // null | 'add' | 'edit'
  const [editTarget,  setEditTarget]  = useState(null);
  const [form,        setForm]        = useState(EMPTY);
  const [saving,      setSaving]      = useState(false);

  // Table controls
  const [search,   setSearch]   = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [page,     setPage]     = useState(1);

  // ── Fetch ────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/hr/payheads/?ordering=id');
      setPayheads(res.data?.results ?? res.data ?? []);
    } catch {
      toast.error('Pay Heads লোড ব্যর্থ।');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Filter + Paginate ────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return payheads;
    return payheads.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.payhead_type_display || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q)
    );
  }, [payheads, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  // ── Open Add ─────────────────────────────────────────────
  const openAdd = () => {
    setForm(EMPTY);
    setEditTarget(null);
    setModal('add');
  };

  // ── Open Edit ────────────────────────────────────────────
  const openEdit = (ph) => {
    setForm({ name: ph.name, payhead_type: ph.payhead_type, description: ph.description || '' });
    setEditTarget(ph);
    setModal('edit');
  };

  const closeModal = () => { setModal(null); setEditTarget(null); };

  // ── Save ─────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.name.trim())        { toast.error('Payhead নাম দিন।'); return; }
    if (!form.payhead_type)       { toast.error('Payhead Type সিলেক্ট করুন।'); return; }
    setSaving(true);
    try {
      const payload = { name: form.name.trim(), payhead_type: form.payhead_type, description: form.description };
      if (modal === 'edit' && editTarget) {
        await api.patch(`/hr/payheads/${editTarget.id}/`, payload);
        toast.success('Pay Head আপডেট হয়েছে।');
      } else {
        await api.post('/hr/payheads/', payload);
        toast.success('নতুন Pay Head যোগ হয়েছে।');
      }
      closeModal();
      load();
    } catch (err) {
      const msg = err?.response?.data?.name?.[0]
        || err?.response?.data?.detail
        || 'সেভ ব্যর্থ হয়েছে।';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 min-h-screen bg-gray-100">

      {/* Page Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="font-slab text-2xl font-bold text-gray-900 flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-sm">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z" />
            </svg>
          </span>
          Pay Heads
        </h1>
        <div className="flex items-center gap-3">
          <div className="text-xs text-gray-400 hidden sm:flex items-center gap-1">
            <span className="text-teal-600 font-medium">HR &amp; Payroll</span>
            <span>›</span><span>Payhead</span>
          </div>
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Pay Head
          </button>
        </div>
      </div>

      {/* Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">

        {/* Table Controls */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-wrap gap-2">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>SHOW</span>
            <select
              value={pageSize}
              onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              {[10, 25, 50, 100].map(n => <option key={n}>{n}</option>)}
            </select>
            <span>ENTRIES</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>SEARCH:</span>
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-44 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
        </div>

        {/* Table */}
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-2 p-3">
            {loading ? (
              <p className="text-center py-6 text-gray-400 text-sm">লোড হচ্ছে...</p>
            ) : paged.length === 0 ? (
              <p className="text-center py-6 text-gray-400 text-sm">কোনো Pay Head নেই।</p>
            ) : paged.map((ph, idx) => (
              <MobilePayHeadCard
                key={ph.id}
                ph={ph}
                onEdit={openEdit}
              />
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#23445f] text-white text-xs uppercase tracking-wide">
                  <th className="px-4 py-3 text-center font-semibold w-28">Serial No.</th>
                  <th className="px-4 py-3 text-center font-semibold">PayHead name</th>
                  <th className="px-4 py-3 text-center font-semibold">PayHead Type</th>
                  <th className="px-4 py-3 text-center font-semibold">Description</th>
                  <th className="px-4 py-3 text-center font-semibold w-24">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="text-center py-10 text-gray-400">লোড হচ্ছে...</td></tr>
                ) : paged.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-10 text-gray-400">কোনো Pay Head নেই।</td></tr>
                ) : paged.map((ph, idx) => {
                  const serial = (page - 1) * pageSize + idx + 1;
                  const isEven = idx % 2 === 0;
                  const isAddition = ph.payhead_type === 'addition';
                  return (
                    <tr key={ph.id} className={`${isEven ? 'bg-white' : 'bg-slate-50/40'} hover:bg-teal-50/40 transition-colors`}>
                      <td className="px-4 py-3 text-center text-gray-700 font-mono text-xs">{serial}</td>
                      <td className="px-4 py-3 text-center font-medium text-gray-800">{ph.name}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          isAddition ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                        }`}>
                          {ph.payhead_type_display || TYPE_DISPLAY[ph.payhead_type] || ph.payhead_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-gray-500 text-xs">{ph.description || ''}</td>
                      <td className="px-4 py-3 text-center">
                        {/* Edit only — স্ক্রিনশট অনুযায়ী delete নেই */}
                        <button
                          onClick={() => openEdit(ph)}
                          title="Edit"
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-600 transition-colors mx-auto"
                        >
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>

        {/* Pagination Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 flex-wrap gap-2">
          <span className="text-xs text-gray-500">
            {filtered.length === 0
              ? 'কোনো entry নেই'
              : `Showing ${(page - 1) * pageSize + 1} to ${Math.min(page * pageSize, filtered.length)} of ${filtered.length} entries`}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 rounded border border-gray-300 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >Previous</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`px-3 py-1 rounded-lg border text-xs font-medium transition-colors ${
                  p === page
                    ? 'bg-teal-600 border-teal-600 text-white'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >{p}</button>
            ))}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 rounded border border-gray-300 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >Next</button>
          </div>
        </div>
      </div>

      {/* Modal */}
      {(modal === 'add' || modal === 'edit') && (
        <PayHeadModal
          mode={modal}
          form={form}
          setForm={setForm}
          onSave={handleSave}
          onClose={closeModal}
          saving={saving}
        />
      )}
    </div>
  );
}
