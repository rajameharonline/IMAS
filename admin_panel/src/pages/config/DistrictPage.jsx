import { useEffect, useState, useRef } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white placeholder-gray-400 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-50 transition-all';

export default function DistrictPage() {
  const [districts,  setDistricts]  = useState([]);
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(1);
  const [search,     setSearch]     = useState('');
  const [loading,    setLoading]    = useState(false);
  const [modal,      setModal]      = useState(null); // null | { mode:'add'|'edit', data? }
  const [form,       setForm]       = useState({ name: '', is_active: true });
  const [saving,     setSaving]     = useState(false);
  const searchTimer = useRef(null);
  const PER_PAGE = 10;

  useEffect(() => { load(); }, [page, search]);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get(`/config/districts/?page=${page}&search=${search}&ordering=name`);
      setDistricts(r.data.results || r.data);
      setTotal(r.data.count || (r.data.results ? r.data.count : r.data.length));
    } catch { toast.error('ডেটা লোড ব্যর্থ'); }
    finally { setLoading(false); }
  }

  function openAdd()      { setForm({ name: '', is_active: true }); setModal({ mode: 'add' }); }
  function openEdit(d)    { setForm({ name: d.name, is_active: d.is_active }); setModal({ mode: 'edit', data: d }); }
  function closeModal()   { setModal(null); }

  const set = k => e => setForm(p => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function handleSave() {
    if (!form.name.trim()) { toast.error('District নাম দিন'); return; }
    setSaving(true);
    try {
      if (modal.mode === 'add') {
        await api.post('/config/districts/', form);
        toast.success('District যোগ হয়েছে');
      } else {
        await api.patch(`/config/districts/${modal.data.id}/`, form);
        toast.success('District আপডেট হয়েছে');
      }
      closeModal(); load();
    } catch (err) {
      toast.error(err.response?.data?.name?.[0] || 'Error');
    } finally { setSaving(false); }
  }

  async function toggleStatus(d) {
    try {
      await api.patch(`/config/districts/${d.id}/`, { is_active: !d.is_active });
      toast.success(d.is_active ? 'Inactive করা হয়েছে' : 'Active করা হয়েছে');
      load();
    } catch { toast.error('Error'); }
  }

  async function handleDelete(d) {
    if (!window.confirm(`"${d.name}" মুছে দিতে চান?`)) return;
    try {
      await api.delete(`/config/districts/${d.id}/`);
      toast.success('District মুছে দেওয়া হয়েছে');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'ব্যবহৃত District মুছা যাবে না');
    }
  }

  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div className="min-h-full bg-gradient-to-br from-slate-50 via-gray-50 to-blue-50/30 p-5 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#1d3a50] to-[#2d5473] flex items-center justify-center shadow-md">
            <span className="text-lg">🗺️</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-800">District</h1>
            <p className="text-xs text-gray-400">বাংলাদেশের জেলা ম্যানেজমেন্ট</p>
          </div>
        </div>
        <button onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#1d3a50] to-[#2d5473] hover:from-[#16304a] hover:to-[#264a63] text-white text-sm font-semibold rounded-xl shadow-md transition-all">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
          Add District
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Districts',  value: total,                                             color: 'from-blue-500 to-blue-600',  icon: '🗺️' },
          { label: 'Active',           value: districts.filter(d => d.is_active).length,          color: 'from-emerald-500 to-emerald-600', icon: '✅' },
          { label: 'Inactive',         value: districts.filter(d => !d.is_active).length,         color: 'from-gray-400 to-gray-500',  icon: '⏸️' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${s.color} flex items-center justify-center text-lg shrink-0`}>{s.icon}</div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{s.value}</p>
              <p className="text-[11px] text-gray-400 font-medium">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Table card */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-md overflow-hidden">
        {/* Table header */}
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-gray-600">{total} টি District</p>
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35"/></svg>
            <input
              className="pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-teal-500 w-48"
              placeholder="Search district..."
              value={search}
              onChange={e => { clearTimeout(searchTimer.current); const v = e.target.value; searchTimer.current = setTimeout(() => { setSearch(v); setPage(1); }, 350); }}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wider w-12">#</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wider">District Name</th>
                <th className="px-5 py-3 text-center text-[11px] font-bold text-gray-500 uppercase tracking-wider">Upazilas</th>
                <th className="px-5 py-3 text-center text-[11px] font-bold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-center text-[11px] font-bold text-gray-500 uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading
                ? <tr><td colSpan={5} className="px-5 py-12 text-center text-gray-400 text-sm">Loading...</td></tr>
                : districts.length === 0
                  ? <tr><td colSpan={5} className="px-5 py-12 text-center text-gray-400 text-sm">কোনো district নেই</td></tr>
                  : districts.map((d, i) => (
                    <tr key={d.id} className="hover:bg-gray-50/60 transition-colors group">
                      <td className="px-5 py-3.5 text-gray-400 text-xs font-medium">{(page - 1) * PER_PAGE + i + 1}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-xs shrink-0">🗺️</div>
                          <span className="font-semibold text-gray-800">{d.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <span className="inline-flex items-center justify-center w-8 h-6 rounded-md bg-indigo-50 border border-indigo-100 text-xs font-bold text-indigo-600">
                          {d.upazila_count ?? 0}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <button onClick={() => toggleStatus(d)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                            d.is_active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100' : 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200'
                          }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${d.is_active ? 'bg-emerald-500' : 'bg-gray-400'}`}/>
                          {d.is_active ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-center gap-1.5">
                          <button onClick={() => openEdit(d)}
                            className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-100 hover:bg-blue-100 flex items-center justify-center transition-colors" title="Edit">
                            <svg className="w-3.5 h-3.5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                          </button>
                          <button onClick={() => handleDelete(d)}
                            className="w-7 h-7 rounded-lg bg-red-50 border border-red-100 hover:bg-red-100 flex items-center justify-center transition-colors" title="Delete">
                            <svg className="w-3.5 h-3.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
            <span>Showing {(page-1)*PER_PAGE+1}–{Math.min(page*PER_PAGE, total)} of {total}</span>
            <div className="flex gap-1">
              {[...Array(totalPages)].map((_, i) => (
                <button key={i} onClick={() => setPage(i+1)}
                  className={`w-7 h-7 rounded-lg text-xs font-semibold transition-all ${page===i+1 ? 'bg-[#1d3a50] text-white' : 'hover:bg-gray-100 text-gray-600'}`}>
                  {i+1}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && closeModal()}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="bg-gradient-to-r from-[#1d3a50] to-[#2d5473] px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">🗺️</span>
                <div>
                  <p className="text-sm font-bold text-white">{modal.mode === 'add' ? 'Add' : 'Edit'} District</p>
                  <p className="text-[11px] text-white/60">{modal.mode === 'add' ? 'নতুন জেলা যোগ করুন' : 'জেলার তথ্য সম্পাদনা করুন'}</p>
                </div>
              </div>
              <button onClick={closeModal} className="w-7 h-7 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">District Name <span className="text-red-400">*</span></label>
                <input className={inp} autoFocus value={form.name} onChange={set('name')} placeholder="e.g. Dhaka" onKeyDown={e => e.key === 'Enter' && handleSave()} />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-100">
                <span className="text-sm font-medium text-gray-700">Active Status</span>
                <button type="button" onClick={() => setForm(p => ({ ...p, is_active: !p.is_active }))}
                  className={`relative w-10 h-5 rounded-full transition-colors ${form.is_active ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.is_active ? 'translate-x-5' : 'translate-x-0'}`}/>
                </button>
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-2.5">
              <button onClick={closeModal} className="flex-1 px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm font-medium text-gray-600 transition-all">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-[#1d3a50] to-[#2d5473] hover:from-[#16304a] hover:to-[#264a63] text-white text-sm font-semibold transition-all disabled:opacity-60">
                {saving ? <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Saving...</> : modal.mode === 'add' ? 'Add District' : 'Update'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
