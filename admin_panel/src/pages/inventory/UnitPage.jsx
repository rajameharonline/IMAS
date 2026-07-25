// Unit List — ISP item unit management (Piece, Meter, Roll, Box ইত্যাদি)।
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, RefreshCw, SquarePen, Trash2 } from 'lucide-react';
import api from '../../utils/api';
import { formatApiError } from '../bandwidth/bandwidthHelpers';

export default function UnitPage() {
  const [units,   setUnits]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(false);
  const [editing, setEditing] = useState(null);
  const [name,    setName]    = useState('');
  const [saving,  setSaving]  = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/inventory/units/?page_size=500');
      setUnits(Array.isArray(data) ? data : (data?.results || []));
    } catch { toast.error('Unit list লোড করা যায়নি।'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);

  const openAdd = () => { setEditing(null); setName(''); setModal(true); };
  const openEdit = (u) => { setEditing(u); setName(u.name); setModal(true); };
  const close = () => { setModal(false); setEditing(null); setName(''); };

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Unit name required.'); return; }
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/inventory/units/${editing.id}/`, { name: name.trim() });
        toast.success('Unit updated.');
      } else {
        await api.post('/inventory/units/', { name: name.trim() });
        toast.success('Unit created.');
      }
      close(); fetch();
    } catch (err) { toast.error(formatApiError(err, 'Save failed.')); }
    finally { setSaving(false); }
  };

  const handleDelete = async (u) => {
    if (!confirm(`Delete unit "${u.name}"?`)) return;
    try {
      await api.delete(`/inventory/units/${u.id}/`);
      toast.success('Deleted.'); fetch();
    } catch (err) { toast.error(formatApiError(err, 'Delete failed.')); }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Unit</h1>
          <p className="text-xs text-slate-500">Unit List</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetch}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 transition-all">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button onClick={openAdd}
            className="inline-flex items-center gap-2 rounded-xl bg-[#173d59] hover:bg-[#1f5075] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all">
            <Plus className="h-4 w-4" /> Unit
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-500 uppercase tracking-wider">
            <span>Show</span>
            <span className="font-semibold text-slate-700">{units.length}</span>
            <span>entries</span>
          </div>
        </div>

        {loading ? (
          <div className="py-20 text-center text-slate-400 text-sm">Loading...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-full divide-y divide-gray-200">
              <thead className="bg-[#23445f]">
                <tr>
                  {['Sl.No.', 'Unit', 'Action'].map((h) => (
                    <th key={h} className="px-6 py-4 text-white text-xs font-semibold uppercase tracking-wider text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {units.map((u, i) => (
                  <tr key={u.id} className={`${i % 2 === 1 ? 'bg-gray-50/50' : ''} hover:bg-blue-50/30 transition-colors`}>
                    <td className="px-6 py-3 text-slate-500 text-sm">{i + 1}</td>
                    <td className="px-6 py-3 font-medium text-slate-800">{u.name}</td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(u)} title="Edit"
                          className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-emerald-500 hover:bg-emerald-50">
                          <SquarePen className="h-4 w-4" />
                        </button>
                        <button onClick={() => handleDelete(u)} title="Delete"
                          className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-rose-500 hover:bg-rose-50">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!units.length && (
                  <tr><td colSpan={3} className="py-16 text-center text-slate-400">No data available in table</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-400">Showing 0 to {units.length} of {units.length} entries</p>
      </div>

      {/* Add/Edit Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-slate-800">{editing ? 'Edit Unit' : 'Add Unit'}</h3>
              <button onClick={close} className="text-2xl text-rose-400 hover:text-rose-600 leading-none">×</button>
            </div>
            <label className="block mb-5">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Unit Name
              </span>
              <input value={name} onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                placeholder="e.g. Piece, Meter, Roll, Box"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400" />
            </label>
            <div className="flex gap-3">
              <button onClick={() => setName('')}
                className="flex-1 rounded-lg bg-rose-500 hover:bg-rose-600 text-white py-2.5 text-sm font-semibold transition-all">
                Clear
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
