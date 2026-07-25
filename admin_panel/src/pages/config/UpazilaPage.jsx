import { useEffect, useState, useRef } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white placeholder-gray-400 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-50 transition-all';
const sel = inp + ' cursor-pointer';

export default function UpazilaPage() {
  const [upazilas,  setUpazilas]  = useState([]);
  const [districts, setDistricts] = useState([]);
  const [total,     setTotal]     = useState(0);
  const [page,      setPage]      = useState(1);
  const [search,    setSearch]    = useState('');
  const [filterDist,setFilterDist]= useState('');
  const [loading,   setLoading]   = useState(false);
  const [modal,     setModal]     = useState(null);
  const [form,      setForm]      = useState({ district: '', name: '', is_active: true });
  const [saving,    setSaving]    = useState(false);
  const searchTimer = useRef(null);
  const PER_PAGE = 15;

  useEffect(() => { loadDistricts(); }, []);
  useEffect(() => { load(); }, [page, search, filterDist]);

  async function loadDistricts() {
    try {
      const r = await api.get('/config/districts/?is_active=true&ordering=name&page_size=200');
      setDistricts(r.data.results || r.data);
    } catch { /* silent */ }
  }

  async function load() {
    setLoading(true);
    try {
      let url = `/config/upazilas/?page=${page}&search=${search}&ordering=name`;
      if (filterDist) url += `&district=${filterDist}`;
      const r = await api.get(url);
      setUpazilas(r.data.results || r.data);
      setTotal(r.data.count || (r.data.results ? r.data.count : r.data.length));
    } catch { toast.error('ডেটা লোড ব্যর্থ'); }
    finally { setLoading(false); }
  }

  function openAdd() {
    setForm({ district: filterDist || '', name: '', is_active: true });
    setModal({ mode: 'add' });
  }
  function openEdit(u) {
    setForm({ district: String(u.district), name: u.name, is_active: u.is_active });
    setModal({ mode: 'edit', data: u });
  }
  function closeModal() { setModal(null); }

  const set = k => e => setForm(p => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function handleSave() {
    if (!form.district) { toast.error('District সিলেক্ট করুন'); return; }
    if (!form.name.trim()) { toast.error('Upazila নাম দিন'); return; }
    setSaving(true);
    try {
      if (modal.mode === 'add') {
        await api.post('/config/upazilas/', form);
        toast.success('Upazila যোগ হয়েছে');
      } else {
        await api.patch(`/config/upazilas/${modal.data.id}/`, form);
        toast.success('Upazila আপডেট হয়েছে');
      }
      closeModal(); load();
    } catch (err) {
      toast.error(err.response?.data?.name?.[0] || err.response?.data?.non_field_errors?.[0] || 'Error');
    } finally { setSaving(false); }
  }

  async function toggleStatus(u) {
    try {
      await api.patch(`/config/upazilas/${u.id}/`, { is_active: !u.is_active });
      toast.success(u.is_active ? 'Inactive করা হয়েছে' : 'Active করা হয়েছে');
      load();
    } catch { toast.error('Error'); }
  }

  async function handleDelete(u) {
    if (!window.confirm(`"${u.name}" মুছে দিতে চান?`)) return;
    try {
      await api.delete(`/config/upazilas/${u.id}/`);
      toast.success('Upazila মুছে দেওয়া হয়েছে');
      load();
    } catch { toast.error('ব্যবহৃত Upazila মুছা যাবে না'); }
  }

  const totalPages = Math.ceil(total / PER_PAGE);
  const activeCount = upazilas.filter(u => u.is_active).length;

  return (
    <div className="min-h-full bg-gradient-to-br from-slate-50 via-gray-50 to-blue-50/30 p-5 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#1a4a3a] to-[#2d6b55] flex items-center justify-center shadow-md">
            <span className="text-lg">📍</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-800">Upazila</h1>
            <p className="text-xs text-gray-400">উপজেলা / থানা ম্যানেজমেন্ট</p>
          </div>
        </div>
        <button onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#1a4a3a] to-[#2d6b55] hover:from-[#164030] hover:to-[#265e4a] text-white text-sm font-semibold rounded-xl shadow-md transition-all">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
          Add Upazila
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Upazilas', value: total,       color: 'from-emerald-500 to-emerald-600', icon: '📍' },
          { label: 'Active',         value: activeCount, color: 'from-blue-500 to-blue-600',       icon: '✅' },
          { label: 'Districts',      value: districts.length, color: 'from-purple-500 to-purple-600', icon: '🗺️' },
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
        {/* Filters row */}
        <div className="px-5 py-3.5 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <p className="text-sm font-semibold text-gray-600 mr-auto">{total} টি Upazila</p>

          {/* District filter */}
          <select className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-teal-500 bg-white"
            value={filterDist}
            onChange={e => { setFilterDist(e.target.value); setPage(1); }}>
            <option value="">All Districts</option>
            {districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>

          {/* Search */}
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35"/></svg>
            <input
              className="pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-teal-500 w-44"
              placeholder="Search upazila..."
              defaultValue={search}
              onChange={e => { clearTimeout(searchTimer.current); const v = e.target.value; searchTimer.current = setTimeout(() => { setSearch(v); setPage(1); }, 350); }}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wider w-12">#</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wider">Upazila Name</th>
                <th className="px-5 py-3 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wider">District</th>
                <th className="px-5 py-3 text-center text-[11px] font-bold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-center text-[11px] font-bold text-gray-500 uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading
                ? <tr><td colSpan={5} className="px-5 py-12 text-center text-gray-400 text-sm">Loading...</td></tr>
                : upazilas.length === 0
                  ? <tr><td colSpan={5} className="px-5 py-12 text-center text-gray-400 text-sm">কোনো upazila নেই</td></tr>
                  : upazilas.map((u, i) => (
                    <tr key={u.id} className="hover:bg-gray-50/60 transition-colors group">
                      <td className="px-5 py-3.5 text-gray-400 text-xs font-medium">{(page - 1) * PER_PAGE + i + 1}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center text-xs shrink-0">📍</div>
                          <span className="font-semibold text-gray-800">{u.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 border border-blue-100 text-xs font-medium text-blue-700">
                          🗺️ {u.district_name}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <button onClick={() => toggleStatus(u)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                            u.is_active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100' : 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200'
                          }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${u.is_active ? 'bg-emerald-500' : 'bg-gray-400'}`}/>
                          {u.is_active ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-center gap-1.5">
                          <button onClick={() => openEdit(u)}
                            className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-100 hover:bg-blue-100 flex items-center justify-center transition-colors" title="Edit">
                            <svg className="w-3.5 h-3.5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                          </button>
                          <button onClick={() => handleDelete(u)}
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
              {[...Array(Math.min(totalPages, 10))].map((_, i) => (
                <button key={i} onClick={() => setPage(i+1)}
                  className={`w-7 h-7 rounded-lg text-xs font-semibold transition-all ${page===i+1 ? 'bg-[#1a4a3a] text-white' : 'hover:bg-gray-100 text-gray-600'}`}>
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
            <div className="bg-gradient-to-r from-[#1a4a3a] to-[#2d6b55] px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">📍</span>
                <div>
                  <p className="text-sm font-bold text-white">{modal.mode === 'add' ? 'Add' : 'Edit'} Upazila</p>
                  <p className="text-[11px] text-white/60">{modal.mode === 'add' ? 'নতুন উপজেলা যোগ করুন' : 'উপজেলার তথ্য সম্পাদনা করুন'}</p>
                </div>
              </div>
              <button onClick={closeModal} className="w-7 h-7 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">District <span className="text-red-400">*</span></label>
                <select className={sel} value={form.district} onChange={set('district')}>
                  <option value="">Select District</option>
                  {districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Upazila Name <span className="text-red-400">*</span></label>
                <input className={inp} autoFocus={!form.district} value={form.name} onChange={set('name')} placeholder="e.g. Savar" onKeyDown={e => e.key === 'Enter' && handleSave()} />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-100">
                <span className="text-sm font-medium text-gray-700">Active Status</span>
                <button type="button" onClick={() => setForm(p => ({ ...p, is_active: !p.is_active }))}
                  className={`relative w-10 h-5 rounded-full transition-colors ${form.is_active ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${form.is_active ? 'translate-x-5' : 'translate-x-0.5'}`}/>
                </button>
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-2.5">
              <button onClick={closeModal} className="flex-1 px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm font-medium text-gray-600 transition-all">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-[#1a4a3a] to-[#2d6b55] hover:from-[#164030] hover:to-[#265e4a] text-white text-sm font-semibold transition-all disabled:opacity-60">
                {saving ? <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Saving...</> : modal.mode === 'add' ? 'Add Upazila' : 'Update'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
