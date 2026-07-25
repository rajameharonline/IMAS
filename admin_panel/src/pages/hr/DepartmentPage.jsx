// HR & Payroll — Department পেইজ
import { useEffect, useState, useCallback, useMemo } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

// ── ইনপুট স্টাইল ──────────────────────────────────────────────
const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition';

// ── Empty form state ──────────────────────────────────────────
const EMPTY = { name: '', details: '' };

// ══════════════════════════════════════════════════════════════
// Modal Component — Add / Edit
// ══════════════════════════════════════════════════════════════
function DeptModal({ mode, form, setForm, onSave, onClose, saving }) {
  const isEdit = mode === 'edit';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
          <h2 className="text-base font-bold font-slab">
            {isEdit ? 'Edit Department' : 'Add Department'}
          </h2>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white text-2xl leading-none"
          >×</button>
        </div>

        {/* Body */}
        <div className="px-5 pt-4 pb-3 space-y-4">
          {/* Department name */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">
              Department <span className="text-red-500">*</span>
            </label>
            <input
              className={inp}
              placeholder="Department name"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>

          {/* Details */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1 uppercase tracking-wide">
              Details <span className="text-gray-400 font-normal normal-case">(optional)</span>
            </label>
            <textarea
              rows={3}
              className={inp + ' resize-none'}
              placeholder="Details..."
              value={form.details}
              onChange={e => setForm(f => ({ ...f, details: e.target.value }))}
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
// Delete Confirm Modal
// ══════════════════════════════════════════════════════════════
function DeleteModal({ dept, onConfirm, onClose, deleting }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
        <div className="text-5xl mb-3">⚠️</div>
        <p className="text-gray-700 font-medium text-sm mb-1">
          <span className="font-bold text-red-600">"{dept?.name}"</span> ডিপার্টমেন্টটি মুছতে চান?
        </p>
        <p className="text-gray-400 text-xs mb-5">এই কাজটি পূর্বাবস্থায় ফেরানো যাবে না।</p>
        <div className="flex gap-3">
          <button onClick={onClose} disabled={deleting}
            className="flex-1 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
            বাতিল
          </button>
          <button onClick={onConfirm} disabled={deleting}
            className="flex-1 py-2 text-sm font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-1.5">
            {deleting && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            মুছুন
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Mobile Card Component
// ══════════════════════════════════════════════════════════════
function MobileDeptCard({ dept, onEdit, onDelete }) {
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
      <div className="px-3 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <span className="font-semibold text-sm text-gray-800">{dept.name}</span>
      </div>
      {/* Rows */}
      <FRow label="Employees">
        <span className="text-xs text-gray-500 text-right">{dept.employee_count ?? '—'}</span>
      </FRow>
      <FRow label="Details">
        <span className="text-xs text-gray-500 text-right">{dept.details || '—'}</span>
      </FRow>
      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-3 py-2 bg-gray-50 border-t border-gray-200">
        <button
          onClick={() => onEdit(dept)}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors bg-teal-50 text-teal-600 border-teal-200 hover:bg-teal-100"
        >Edit</button>
        <button
          onClick={() => onDelete(dept)}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors bg-red-50 text-red-600 border-red-200 hover:bg-red-100"
        >Delete</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Main DepartmentPage
// ══════════════════════════════════════════════════════════════
export default function DepartmentPage() {
  const [departments, setDepartments] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [modal,       setModal]       = useState(null);   // null | 'add' | 'edit'
  const [editTarget,  setEditTarget]  = useState(null);   // Department object being edited
  const [deleteTarget,setDeleteTarget]= useState(null);   // Department to delete
  const [form,        setForm]        = useState(EMPTY);
  const [saving,      setSaving]      = useState(false);
  const [deleting,    setDeleting]    = useState(false);

  // Table controls
  const [search,    setSearch]    = useState('');
  const [pageSize,  setPageSize]  = useState(10);
  const [page,      setPage]      = useState(1);

  // ── Fetch ────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/hr/departments/?ordering=id&page_size=1000');
      setDepartments(res.data?.results ?? res.data ?? []);
    } catch {
      toast.error('Department লোড ব্যর্থ।');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Filtered + Paginated data ─────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return q
      ? departments.filter(d =>
          d.name.toLowerCase().includes(q) ||
          (d.details || '').toLowerCase().includes(q)
        )
      : departments;
  }, [departments, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  // ── Open Add modal ────────────────────────────────────────
  const openAdd = () => {
    setForm(EMPTY);
    setEditTarget(null);
    setModal('add');
  };

  // ── Open Edit modal ───────────────────────────────────────
  const openEdit = (dept) => {
    setForm({ name: dept.name, details: dept.details || '' });
    setEditTarget(dept);
    setModal('edit');
  };

  // ── Close modal ───────────────────────────────────────────
  const closeModal = () => { setModal(null); setEditTarget(null); };

  // ── Save (Add or Update) ──────────────────────────────────
  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Department নাম দিন।'); return; }
    setSaving(true);
    try {
      if (modal === 'edit' && editTarget) {
        await api.patch(`/hr/departments/${editTarget.id}/`, { name: form.name.trim(), details: form.details });
        toast.success('Department আপডেট হয়েছে।');
      } else {
        await api.post('/hr/departments/', { name: form.name.trim(), details: form.details });
        toast.success('নতুন Department যোগ হয়েছে।');
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

  // ── Delete ────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/hr/departments/${deleteTarget.id}/`);
      toast.success(`"${deleteTarget.name}" মুছে গেছে।`);
      setDeleteTarget(null);
      load();
    } catch {
      toast.error('Delete ব্যর্থ।');
    } finally {
      setDeleting(false);
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
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2M19 21H5m0 0H3m4-11h2m-2 4h2m4-4h2m-2 4h2M9 3v18" />
            </svg>
          </span>
          Department
        </h1>
        <div className="flex items-center gap-3">
          <div className="text-xs text-gray-400 hidden sm:flex items-center gap-1">
            <span className="text-teal-600 font-medium">HR &amp; Payroll</span>
            <span>›</span><span>Department</span>
          </div>
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Department
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
              <p className="text-center py-6 text-gray-400 text-sm">কোনো Department নেই।</p>
            ) : paged.map((dept) => (
              <MobileDeptCard
                key={dept.id}
                dept={dept}
                onEdit={openEdit}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#23445f] text-white text-xs uppercase tracking-wide">
                  <th className="px-4 py-3 text-center font-semibold w-24">Serial</th>
                  <th className="px-4 py-3 text-center font-semibold">Department Name</th>
                  <th className="px-4 py-3 text-center font-semibold w-28">Employees</th>
                  <th className="px-4 py-3 text-center font-semibold">Details</th>
                  <th className="px-4 py-3 text-center font-semibold w-28">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="text-center py-10 text-gray-400">লোড হচ্ছে...</td></tr>
                ) : paged.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-10 text-gray-400">কোনো Department নেই।</td></tr>
                ) : paged.map((dept, idx) => {
                  const serial = (page - 1) * pageSize + idx + 1;
                  const isEven = idx % 2 === 0;
                  return (
                    <tr key={dept.id} className={`${isEven ? 'bg-white' : 'bg-slate-50/40'} hover:bg-teal-50/40 transition-colors`}>
                      <td className="px-4 py-3 text-center text-gray-700 font-mono text-xs">{serial}</td>
                      <td className="px-4 py-3 text-center font-medium text-gray-800">{dept.name}</td>
                      <td className="px-4 py-3 text-center text-gray-500 text-xs">{dept.employee_count ?? '—'}</td>
                      <td className="px-4 py-3 text-center text-gray-500 text-xs">{dept.details || ''}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {/* Edit */}
                          <button
                            onClick={() => openEdit(dept)}
                            title="Edit"
                            className="p-1.5 rounded-lg text-teal-600 hover:bg-teal-50 transition border border-teal-200"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5
                                   m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          {/* Delete */}
                          <button
                            onClick={() => setDeleteTarget(dept)}
                            title="Delete"
                            className="p-1.5 rounded-md text-red-500 hover:bg-red-50 transition border border-red-200"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7
                                   m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
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
              : `Showing ${(page - 1) * pageSize + 1} to ${Math.min(page * pageSize, filtered.length)} of ${filtered.length} entries`
            }
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

      {/* Modals */}
      {(modal === 'add' || modal === 'edit') && (
        <DeptModal
          mode={modal}
          form={form}
          setForm={setForm}
          onSave={handleSave}
          onClose={closeModal}
          saving={saving}
        />
      )}
      {deleteTarget && (
        <DeleteModal
          dept={deleteTarget}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
          deleting={deleting}
        />
      )}
    </div>
  );
}
