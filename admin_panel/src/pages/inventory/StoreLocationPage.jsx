// Store Location — ISP গোডাউন/ক্যাবিনেট ম্যানেজমেন্ট।
// short_value: compact code (HQ, POP-1 ইত্যাদি) purchase entry-তে দেখানোর জন্য।
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, RefreshCw, SquarePen, Trash2 } from 'lucide-react';
import api from '../../utils/api';
import { formatApiError } from '../bandwidth/bandwidthHelpers';

const EMPTY = { name: '', short_value: '' };

export default function StoreLocationPage() {
  const [stores,  setStores]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(false);
  const [editing, setEditing] = useState(null);
  const [form,    setForm]    = useState(EMPTY);
  const [saving,  setSaving]  = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/inventory/stores/?page_size=500&is_active=true');
      setStores(Array.isArray(data) ? data : (data?.results || []));
    } catch { toast.error('Store list লোড করা যায়নি।'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);

  const openAdd  = () => { setEditing(null); setForm(EMPTY); setModal(true); };
  const openEdit = (s) => { setEditing(s); setForm({ name: s.name, short_value: s.short_value || '' }); setModal(true); };
  const close    = () => { setModal(false); setEditing(null); setForm(EMPTY); };

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Location Name required.'); return; }
    setSaving(true);
    try {
      const payload = { name: form.name.trim(), short_value: form.short_value.trim(), is_active: true };
      if (editing) {
        await api.patch(`/inventory/stores/${editing.id}/`, payload);
        toast.success('Store updated.');
      } else {
        await api.post('/inventory/stores/', payload);
        toast.success('Store created.');
      }
      close(); fetch();
    } catch (err) { toast.error(formatApiError(err, 'Save failed.')); }
    finally { setSaving(false); }
  };

  const handleDelete = async (s) => {
    if (!confirm(`Delete "${s.name}"?`)) return;
    try {
      await api.delete(`/inventory/stores/${s.id}/`);
      toast.success('Deleted.'); fetch();
    } catch (err) { toast.error(formatApiError(err, 'Delete failed.')); }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Store Location</h1>
          <p className="text-xs text-slate-500">Store Locations</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetch}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 transition-all">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button onClick={openAdd}
            className="inline-flex items-center gap-2 rounded-xl bg-[#173d59] hover:bg-[#1f5075] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all">
            <Plus className="h-4 w-4" /> Store Location
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        {loading ? (
          <div className="py-20 text-center text-slate-400 text-sm">Loading...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-full divide-y divide-gray-200">
              <thead className="bg-[#23445f]">
                <tr>
                  {['Sl.No.', 'Location Name', 'Location Short Value', 'Action'].map((h) => (
                    <th key={h} className="px-6 py-4 text-white text-xs font-semibold uppercase tracking-wider text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {stores.map((s, i) => (
                  <tr key={s.id} className={`${i % 2 === 1 ? 'bg-gray-50/50' : ''} hover:bg-blue-50/30 transition-colors`}>
                    <td className="px-6 py-3 text-slate-500 text-sm">{i + 1}</td>
                    <td className="px-6 py-3 font-medium text-slate-800">{s.name}</td>
                    <td className="px-6 py-3 font-mono text-slate-600 text-sm">{s.short_value || '—'}</td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(s)} title="Edit"
                          className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-emerald-500 hover:bg-emerald-50">
                          <SquarePen className="h-4 w-4" />
                        </button>
                        <button onClick={() => handleDelete(s)} title="Delete"
                          className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-rose-500 hover:bg-rose-50">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!stores.length && (
                  <tr><td colSpan={4} className="py-16 text-center text-slate-400">No data available in table</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-400">
          Showing 0 to {stores.length} of {stores.length} entries
        </p>
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-slate-800">
                {editing ? 'Edit Store Location' : 'Add Store Location'}
              </h3>
              <button onClick={close} className="text-2xl text-rose-400 hover:text-rose-600 leading-none">×</button>
            </div>
            <div className="space-y-4 mb-5">
              <label className="block">
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Location Name
                </span>
                <input value={form.name} onChange={(e) => set('name', e.target.value)}
                  placeholder="e.g. Main Warehouse, POP-Mirpur"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400" />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Location Short Value
                </span>
                <input value={form.short_value} onChange={(e) => set('short_value', e.target.value)}
                  placeholder="e.g. HQ, POP-1"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400" />
              </label>
            </div>
            <div className="flex gap-3">
              <button onClick={close}
                className="flex-1 rounded-lg bg-rose-500 hover:bg-rose-600 text-white py-2.5 text-sm font-semibold transition-all">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 rounded-lg bg-[#2d8fe4] hover:bg-[#2681d5] text-white py-2.5 text-sm font-semibold transition-all disabled:opacity-50">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
