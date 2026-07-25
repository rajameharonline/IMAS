// Position Management — HR & Payroll
// স্ক্রিনশট অনুযায়ী: List + Add + Update — সব একই পেজে view-switching দিয়ে
import { useEffect, useState, useCallback, useMemo } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

/* ─── Design tokens ─────────────────────────────────────────────────────── */
const inp = [
  'w-full border border-gray-300 rounded-md px-3 py-[7px] text-sm',
  'bg-white text-gray-800 placeholder-gray-400',
  'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent',
  'transition-all duration-150',
].join(' ');
const sel = `${inp} appearance-none`;

/* ─── Empty form ────────────────────────────────────────────────────────── */
const EMPTY = {
  name: '', is_permanent: false, is_seasonal: false,
  position_type: '', status: '',
  head_count: '', bargaining_unit: '',
  payroll: '', working_hour: '', supervisor: '',
};

/* ─── Status badge ──────────────────────────────────────────────────────── */
function StatusBadge({ status }) {
  const style = status === 'active'
    ? 'text-emerald-700 bg-emerald-100'
    : 'text-rose-700 bg-rose-100';
  return (
    <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${style}`}>
      {status === 'active' ? 'Active' : 'Inactive'}
    </span>
  );
}

/* ─── Section Header (dark bg, matches screenshot) ─────────────────────── */
function SectionHeader({ title }) {
  return (
    <div className="bg-[#1c2333] text-white text-sm font-semibold font-slab px-5 py-3">
      {title}
    </div>
  );
}

/* ─── Field + Label ─────────────────────────────────────────────────────── */
function FL({ label, required, hint, children }) {
  return (
    <div>
      <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[10.5px] text-gray-400 mt-1 leading-snug">{hint}</p>}
    </div>
  );
}

/* ─── Checkbox styled ───────────────────────────────────────────────────── */
function CheckBox({ label, checked, onChange }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none group">
      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all
        ${checked ? 'bg-teal-600 border-teal-600' : 'border-gray-400 bg-white'}`}
        role="checkbox" aria-checked={checked} tabIndex={0}
        onClick={onChange}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(); } }}>
        {checked && (
          <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <span className="text-[11px] font-bold uppercase tracking-wide text-gray-600 group-hover:text-gray-800">
        {label}
      </span>
    </label>
  );
}

/* ─── Delete Confirm Modal ──────────────────────────────────────────────── */
function DeleteModal({ pos, onClose, onDeleted }) {
  const [deleting, setDeleting] = useState(false);
  const handle = async () => {
    setDeleting(true);
    try {
      await api.delete(`/hr/positions/${pos.id}/`);
      toast.success('পজিশন মুছে ফেলা হয়েছে');
      onDeleted();
    } catch { toast.error('মুছতে ব্যর্থ হয়েছে'); }
    finally { setDeleting(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
        <div className="text-5xl mb-3">⚠️</div>
        <p className="text-gray-700 font-medium text-sm mb-1">
          <span className="font-bold text-red-600">"{pos.name}"</span> পজিশনটি মুছতে চান?
        </p>
        <p className="text-gray-400 text-xs mb-5">এই কাজটি পূর্বাবস্থায় ফেরানো যাবে না।</p>
        <div className="flex gap-3">
          <button onClick={onClose} disabled={deleting}
            className="flex-1 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
            বাতিল
          </button>
          <button onClick={handle} disabled={deleting}
            className="flex-1 py-2 text-sm font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-1.5">
            {deleting && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            মুছুন
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Mobile Position Card ── */
function MobilePositionCard({ pos, idx, openEdit, setDeletePos }) {
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
      <div className="flex items-start justify-between gap-2 px-3 py-2.5 bg-[#23445f]/5 border-b border-gray-200">
        <div className="min-w-0">
          <p className="font-bold text-gray-900 text-[13px]">{pos.name}</p>
          <div className="flex gap-1 mt-0.5">
            {pos.is_permanent && <span className="text-[10px] bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded font-medium">Permanent</span>}
            {pos.is_seasonal && <span className="text-[10px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded font-medium">Seasonal</span>}
          </div>
        </div>
        <StatusBadge status={pos.status} />
      </div>
      <div className="grid grid-cols-2 divide-x divide-gray-200 border-b border-gray-200">
        <div className="flex flex-col px-3 py-2.5">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Type</span>
          <span className="text-[12px] font-medium text-teal-700">{pos.position_type === 'single' ? 'Single' : 'Shared'}</span>
        </div>
        <div className="flex flex-col px-3 py-2.5">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">PayRoll</span>
          <span className="text-[12px] font-medium text-gray-800">{pos.payroll_name || '—'}</span>
        </div>
      </div>
      <div>
        <FRow label="Employees">
          <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-700">
            {pos.employee_count ?? 0}{pos.head_count ? ` / ${pos.head_count}` : ''}
          </span>
        </FRow>
        <FRow label="Supervisor"><span className="text-[12px] text-gray-700">{pos.supervisor_name || '—'}</span></FRow>
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50/60 border-t border-gray-200">
        <button onClick={() => openEdit(pos)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100">Edit</button>
        <button onClick={() => setDeletePos(pos)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100">Delete</button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════════════════════ */
export default function PositionPage() {
  /* ── View state: 'list' | 'add' | 'edit' ── */
  const [view,      setView]      = useState('list');
  const [editPos,   setEditPos]   = useState(null);

  /* ── Data ── */
  const [positions, setPositions] = useState([]);
  const [payrolls,  setPayrolls]  = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading,   setLoading]   = useState(true);

  /* ── Form ── */
  const [form,    setForm]    = useState({ ...EMPTY });
  const [saving,  setSaving]  = useState(false);

  /* ── Table ── */
  const [search,   setSearch]   = useState('');
  const [perPage,  setPerPage]  = useState(10);
  const [page,     setPage]     = useState(1);
  const [deletePos, setDeletePos] = useState(null);

  /* ── Fetch all ── */
  const fetchData = useCallback(async () => {
    setLoading(true);

    // আলাদাভাবে fetch — একটি ফেল হলেও বাকিগুলো কাজ করবে
    const safe = async (fn) => { try { return await fn(); } catch { return null; } };

    const [posRes, prRes, empRes] = await Promise.all([
      safe(() => api.get('/hr/positions/?ordering=id')),
      safe(() => api.get('/hr/payrolls/?ordering=id')),
      safe(() => api.get('/hr/employees/?status=active&ordering=full_name')),
    ]);

    if (posRes) setPositions(posRes.data?.results ?? posRes.data ?? []);
    if (prRes)  setPayrolls(prRes.data?.results  ?? prRes.data  ?? []);
    if (empRes) setEmployees(empRes.data?.results ?? empRes.data ?? []);

    if (!posRes && !prRes && !empRes) toast.error('ডেটা লোড হয়নি');
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* ── Filtered + paged list ── */
  const filtered = useMemo(() => {
    if (!search.trim()) return positions;
    const q = search.toLowerCase();
    return positions.filter(p =>
      p.name?.toLowerCase().includes(q) ||
      p.position_type?.toLowerCase().includes(q) ||
      p.payroll_name?.toLowerCase().includes(q)
    );
  }, [positions, search]);

  const totalPages = Math.ceil(filtered.length / perPage);
  const paged = filtered.slice((page - 1) * perPage, page * perPage);

  /* ── Open Add form ── */
  const openAdd = () => {
    setForm({ ...EMPTY });
    setEditPos(null);
    setView('add');
  };

  /* ── Open Edit form ── */
  const openEdit = (pos) => {
    setForm({
      name:            pos.name || '',
      is_permanent:    pos.is_permanent || false,
      is_seasonal:     pos.is_seasonal || false,
      position_type:   pos.position_type || '',
      status:          pos.status || 'active',
      head_count:      pos.head_count ?? '',
      bargaining_unit: pos.bargaining_unit || '',
      payroll:         pos.payroll || '',
      working_hour:    pos.working_hour || '',
      supervisor:      pos.supervisor || '',
    });
    setEditPos(pos);
    setView('edit');
  };

  /* ── Form field setter ── */
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const toggle = (k) => () => setForm(f => ({ ...f, [k]: !f[k] }));

  /* ── Clear form ── */
  const clearForm = () => setForm({ ...EMPTY });

  /* ── Save (Add or Edit) ── */
  const handleSave = async () => {
    if (!form.name.trim())       { toast.error('Position Name আবশ্যক'); return; }
    if (!form.position_type)     { toast.error('Position Type নির্বাচন করুন'); return; }
    if (!form.status)            { toast.error('Status নির্বাচন করুন'); return; }
    if (!form.head_count || Number(form.head_count) < 1) { toast.error('Head Count আবশ্যক'); return; }
    if (!form.payroll)           { toast.error('Payroll নির্বাচন করুন'); return; }

    setSaving(true);
    try {
      const payload = {
        name:            form.name.trim(),
        is_permanent:    form.is_permanent,
        is_seasonal:     form.is_seasonal,
        position_type:   form.position_type,
        status:          form.status,
        head_count:      Number(form.head_count),
        bargaining_unit: form.bargaining_unit,
        payroll:         form.payroll || null,
        working_hour:    form.working_hour,
        supervisor:      form.supervisor || null,
      };

      if (view === 'edit' && editPos) {
        await api.patch(`/hr/positions/${editPos.id}/`, payload);
        toast.success('পজিশন আপডেট হয়েছে');
      } else {
        await api.post('/hr/positions/', payload);
        toast.success('নতুন পজিশন তৈরি হয়েছে');
      }
      await fetchData();
      setView('list');
    } catch (err) {
      const status = err.response?.status;
      const d = err.response?.data;
      if (d && typeof d === 'object' && !Array.isArray(d)) {
        Object.entries(d).forEach(([k, v]) =>
          toast.error(`${k}: ${Array.isArray(v) ? v[0] : v}`)
        );
      } else if (status === 404) {
        toast.error('API endpoint পাওয়া যায়নি (404) — সার্ভার reload করুন');
      } else if (status === 500) {
        toast.error('সার্ভার error (500) — লগ দেখুন');
      } else if (status === 401 || status === 403) {
        toast.error('অনুমতি নেই — পুনরায় লগইন করুন');
      } else {
        toast.error('সংরক্ষণ ব্যর্থ হয়েছে');
      }
    } finally { setSaving(false); }
  };

  /* ════════════════════════════════════════════════════════════════════
     RENDER: LIST VIEW
  ════════════════════════════════════════════════════════════════════ */
  if (view === 'list') return (
    <div className="p-4 sm:p-6 min-h-screen bg-gray-100">

      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="font-slab text-2xl font-bold text-gray-900 flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-sm">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </span>
          Positions
        </h1>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="text-teal-600 font-medium">HR &amp; Payroll</span>
          <span>›</span>
          <span>Positions</span>
        </div>
      </div>

      {/* Table card */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">

        {/* Top bar: + Add button */}
        <div className="flex justify-end px-4 py-3 border-b border-gray-100">
          <button onClick={openAdd}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold
              rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition active:scale-95 shadow-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            Add Position
          </button>
        </div>

        {/* Controls: SHOW + SEARCH */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-wrap gap-3">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span className="font-medium">SHOW</span>
            <select
              className="border border-gray-300 rounded-lg px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              value={perPage}
              onChange={e => { setPerPage(Number(e.target.value)); setPage(1); }}
            >
              {[5, 10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className="font-medium">ENTRIES</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-600">SEARCH:</span>
            <input
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-44
                focus:outline-none focus:ring-2 focus:ring-teal-500"
              placeholder="নাম বা টাইপ..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-7 h-7 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-400">লোড হচ্ছে...</p>
          </div>
        ) : paged.length === 0 ? (
          <div className="text-center py-20 text-gray-400 text-sm">
            {search ? 'কোনো ফলাফল পাওয়া যায়নি' : 'কোনো পজিশন নেই। "+ Add Position" ক্লিক করুন।'}
          </div>
        ) : (
          <>
          <div className="md:hidden space-y-2 p-3">
            {paged.map((pos, idx) => (
              <MobilePositionCard key={pos.id} pos={pos} idx={idx} openEdit={openEdit} setDeletePos={setDeletePos} />
            ))}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#23445f] text-white text-left text-xs uppercase tracking-wide">
                  <th className="px-4 py-3 text-xs font-semibold w-12">SN</th>
                  <th className="px-4 py-3 text-xs font-semibold">Position Name</th>
                  <th className="px-4 py-3 text-xs font-semibold">Position Type</th>
                  <th className="px-4 py-3 text-xs font-semibold">PayRoll</th>
                  <th className="px-4 py-3 text-xs font-semibold">Employees</th>
                  <th className="px-4 py-3 text-xs font-semibold">Supervisor</th>
                  <th className="px-4 py-3 text-xs font-semibold">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((pos, idx) => (
                  <tr key={pos.id}
                    className={`border-b border-gray-100 transition-colors
                      ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'} hover:bg-teal-50/40`}>

                    <td className="px-4 py-3 text-center text-gray-500 font-mono text-xs">
                      {(page - 1) * perPage + idx + 1}
                    </td>

                    <td className="px-4 py-3">
                      <span className="font-semibold text-gray-800">{pos.name}</span>
                      {(pos.is_permanent || pos.is_seasonal) && (
                        <div className="flex gap-1 mt-0.5">
                          {pos.is_permanent && (
                            <span className="text-[10px] bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded font-medium">Permanent</span>
                          )}
                          {pos.is_seasonal && (
                            <span className="text-[10px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded font-medium">Seasonal</span>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <span className="text-teal-700 font-medium text-sm">
                        {pos.position_type === 'single' ? 'Single' : 'Shared'}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-center text-gray-700 text-sm">
                      {pos.payroll_name || '—'}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-700">
                        {pos.employee_count ?? 0}{pos.head_count ? ` / ${pos.head_count}` : ''}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-center text-gray-500 text-xs">
                      {pos.supervisor_name || '—'}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <StatusBadge status={pos.status} />
                    </td>

                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {/* Edit */}
                        <button onClick={() => openEdit(pos)} title="Edit"
                          className="p-1.5 rounded-lg text-teal-600 hover:bg-teal-50 transition border border-teal-200">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5
                                 m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        {/* Delete */}
                        <button onClick={() => setDeletePos(pos)} title="Delete"
                          className="p-1.5 rounded-md text-red-500 hover:bg-red-50 transition border border-red-200">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7
                                 m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
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
        )}

        {/* Pagination */}
        {!loading && filtered.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 flex-wrap gap-2">
            <p className="text-xs text-gray-500">
              Showing {Math.min((page - 1) * perPage + 1, filtered.length)} to{' '}
              {Math.min(page * perPage, filtered.length)} of {filtered.length} entries
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-xs border border-gray-300 rounded-md text-gray-600
                  hover:bg-gray-50 disabled:opacity-40 transition"
              >
                Previous
              </button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                const n = totalPages <= 7 ? i + 1 : (page <= 4 ? i + 1 : page - 3 + i);
                if (n < 1 || n > totalPages) return null;
                return (
                  <button key={n} onClick={() => setPage(n)}
                    className={`w-8 h-8 text-xs rounded-md border transition
                      ${page === n
                        ? 'bg-teal-600 text-white border-teal-600 font-semibold'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                    {n}
                  </button>
                );
              })}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages || totalPages === 0}
                className="px-3 py-1.5 text-xs border border-gray-300 rounded-md text-gray-600
                  hover:bg-gray-50 disabled:opacity-40 transition"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirm */}
      {deletePos && (
        <DeleteModal
          pos={deletePos}
          onClose={() => setDeletePos(null)}
          onDeleted={() => { setDeletePos(null); fetchData(); }}
        />
      )}
    </div>
  );

  /* ════════════════════════════════════════════════════════════════════
     RENDER: ADD / EDIT FORM VIEW (matches screenshot)
  ════════════════════════════════════════════════════════════════════ */
  const isEdit = view === 'edit';
  return (
    <div className="p-4 sm:p-6 min-h-screen bg-gray-100">

      {/* ── Page header ── */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="font-slab text-2xl font-bold text-gray-900 flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-sm">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </span>
          Position
        </h1>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="text-teal-600 font-medium">HR &amp; Payroll</span>
          <span>›</span>
          <span>{isEdit ? 'Update Position' : 'Add New Position'}</span>
          <button onClick={() => setView('list')}
            className="ml-3 w-6 h-6 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center text-gray-500 font-bold text-xs transition">
            ×
          </button>
        </div>
      </div>

      {/* ── Form title ── */}
      <h2 className="font-slab text-lg font-bold text-gray-800 mb-4">
        {isEdit ? 'Update Position' : 'Add a Position'}
      </h2>

      {/* ════════════════════════════════════════════════════════════
          Row 1: Position (left) + Hiring Information (right)
      ════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-5 mb-5">

        {/* ── Left: Position ── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <SectionHeader title="Position" />
          <div className="p-5 space-y-5">

            {/* Position Name */}
            <FL label="Position Name" required
              hint="Name of the Position Ex: Manager, Bill Collector etc.">
              <input className={inp} placeholder="Position Name"
                value={form.name} onChange={set('name')} />
            </FL>

            {/* Permanent / Seasonal checkboxes */}
            <div>
              <div className="flex items-center gap-6 mb-1">
                <CheckBox label="Permanent" checked={form.is_permanent} onChange={toggle('is_permanent')} />
                <CheckBox label="Seasonal"  checked={form.is_seasonal}  onChange={toggle('is_seasonal')} />
              </div>
              <p className="text-[10.5px] text-gray-400 mt-1">
                Is the Employee is Permanent or Seasonal.
              </p>
            </div>

            {/* Position Type + Status (side by side) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FL label="Position Type" required
                hint={
                  <span>
                    i. Single Positions can be use one time between every employee.<br />
                    ii. Shared Positions can be use multiple time for every employee.
                  </span>
                }>
                <select className={sel} value={form.position_type} onChange={set('position_type')}>
                  <option value="">Select</option>
                  <option value="single">Single</option>
                  <option value="shared">Shared</option>
                </select>
              </FL>

              <FL label="Status" required>
                <select className={sel} value={form.status} onChange={set('status')}>
                  <option value="">Select Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </FL>
            </div>

          </div>
        </div>

        {/* ── Right: Hiring Information ── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <SectionHeader title="Hiring Information" />
          <div className="p-5 space-y-5">

            {/* Head Count + Bargaining Unit */}
            <div className="grid grid-cols-2 gap-4">
              <FL label="Head Count" required
                hint="The maximum number of Employee that can be assigned in this Position.">
                <input className={inp} type="number" min="1" placeholder="0"
                  value={form.head_count} onChange={set('head_count')} />
              </FL>

              <FL label="Bargaining Unit"
                hint="The minimum salary scale bargaining start from.">
                <input className={inp} placeholder="e.g. 15000"
                  value={form.bargaining_unit} onChange={set('bargaining_unit')} />
              </FL>
            </div>

            {/* Payroll */}
            <FL label="Payroll" required hint="That position will assigned under this Payroll.">
              <select className={sel} value={form.payroll} onChange={set('payroll')}>
                <option value="">Select PayRoll</option>
                {payrolls.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </FL>

          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════
          Row 2: Working Information (full width)
      ════════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mb-5">
        <SectionHeader title="Working Information" />
        <div className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <FL label="Working Hour" hint="Working hours for this Position.">
              <input className={inp} placeholder="e.g. 8 hours / day"
                value={form.working_hour} onChange={set('working_hour')} />
            </FL>

            <FL label="Supervisor" hint="Reporting Manager of this Position.">
              <select className={sel} value={form.supervisor} onChange={set('supervisor')}>
                <option value="">Select</option>
                {employees.map(e => (
                  <option key={e.id} value={e.id}>{e.full_name}</option>
                ))}
              </select>
            </FL>
          </div>
        </div>
      </div>

      {/* ── Buttons (bottom right, matches screenshot) ── */}
      <div className="flex justify-end gap-3">
        {!isEdit && (
          <button onClick={clearForm} disabled={saving}
            className="px-5 py-2.5 text-sm font-semibold rounded-lg bg-gray-100 text-gray-700
              hover:bg-gray-200 transition active:scale-95 disabled:opacity-60">
            Clear Position
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold rounded-lg
            bg-emerald-600 text-white hover:bg-emerald-700 shadow-md disabled:opacity-60
            active:scale-95 transition-all"
        >
          {saving && (
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          )}
          {isEdit ? 'Update Position' : 'Save Position'}
        </button>
        <button onClick={() => setView('list')} disabled={saving}
          className="px-4 py-2.5 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition">
          বাতিল
        </button>
      </div>

    </div>
  );
}
