// এই কম্পোনেন্টটি Support → Ticket Type (SupportCategory) admin CRUD page।
// লক্ষ্য: "Fiber Cut", "Router Issue", "Billing Query" ইত্যাদি lookup
// টাইপ-গুলো এখান থেকে create/edit/delete করা — যা OpenTicketModal-এর
// dropdown-এ দেখাবে। ai.md design baseline মেনে: teal accent header,
// dark table header, SVG icons, English display labels।

import { useEffect, useState } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

function getList(d) { return Array.isArray(d) ? d : (d?.results || []); }

/* ── Mobile Ticket Type Card ── */
function MobileTicketTypeCard({ t, idx, toggleActive, openEdit, handleDelete }) {
  const isEven = idx % 2 === 0;
  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${isEven ? 'bg-white border-gray-200' : 'bg-slate-50/40 border-gray-200'}`}>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-[#23445f]/5 border-b border-gray-200">
        <p className="font-bold text-gray-900 text-[13px] truncate">{t.name}</p>
        <button onClick={() => toggleActive(t)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${t.is_active ? 'bg-teal-500' : 'bg-gray-300'}`}>
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${t.is_active ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
        </button>
      </div>
      <div className="flex items-stretch border-b border-gray-200">
        <div className="w-28 shrink-0 bg-gray-50 px-3 py-2.5 flex items-center border-r border-gray-200">
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Description</span>
        </div>
        <div className="flex-1 px-3 py-2.5 flex items-center justify-end bg-white">
          <span className="text-[12px] text-gray-600">{t.description || <span className="text-gray-300">—</span>}</span>
        </div>
      </div>
      <div className="flex items-stretch border-b border-gray-200">
        <div className="w-28 shrink-0 bg-gray-50 px-3 py-2.5 flex items-center border-r border-gray-200">
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Tickets</span>
        </div>
        <div className="flex-1 px-3 py-2.5 flex items-center justify-end bg-white">
          <span className="font-mono text-[13px] font-bold text-gray-800">{t.ticket_count ?? 0}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50/60 border-t border-gray-200">
        <button onClick={() => openEdit(t)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100">Edit</button>
        <button onClick={() => handleDelete(t)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100">Delete</button>
      </div>
    </div>
  );
}

export default function TicketTypePage() {
  // টিকেট-টাইপ list ও modal control state।
  const [types, setTypes]       = useState([]);
  const [loading, setLoading]   = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [form, setForm] = useState({ name: '', description: '', is_active: true });
  const [saving, setSaving]     = useState(false);

  // প্রথম মাউন্ট-এ ও create/update-এর পর re-fetch।
  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/support/categories/', { params: { page_size: 200 } });
      setTypes(getList(r.data));
    } catch { toast.error('Failed to load ticket types.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // Add / Edit handlers — একই modal reuse।
  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', description: '', is_active: true });
    setShowModal(true);
  };
  const openEdit = (t) => {
    setEditing(t);
    setForm({ name: t.name, description: t.description || '', is_active: !!t.is_active });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Name is required.'); return; }
    setSaving(true);
    try {
      const payload = { ...form, name: form.name.trim() };
      if (editing) await api.patch(`/support/categories/${editing.id}/`, payload);
      else         await api.post('/support/categories/', payload);
      toast.success(editing ? 'Ticket type updated.' : 'Ticket type created.');
      setShowModal(false);
      load();
    } catch (e) {
      const msg = e?.response?.data ? JSON.stringify(e.response.data).slice(0, 150) : 'Save failed.';
      toast.error(msg);
    } finally { setSaving(false); }
  };

  const handleDelete = async (t) => {
    if (!window.confirm(`Delete ticket type "${t.name}"?`)) return;
    try {
      await api.delete(`/support/categories/${t.id}/`);
      toast.success('Deleted.');
      load();
    } catch {
      toast.error('Cannot delete — already linked to tickets.');
    }
  };

  // Auto-save toggle — toggle change হলে instantly PATCH; আলাদা Save দরকার নেই।
  const toggleActive = async (t) => {
    try {
      await api.patch(`/support/categories/${t.id}/`, { is_active: !t.is_active });
      setTypes(prev => prev.map(x => x.id === t.id ? { ...x, is_active: !x.is_active } : x));
    } catch { toast.error('Toggle failed.'); }
  };

  return (
    <div className="p-4 sm:p-6 min-h-screen bg-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center shadow-sm">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold font-slab text-gray-800">Ticket Types</h1>
            <p className="text-xs text-teal-600">Support &gt; Ticket Types</p>
          </div>
        </div>
        <button onClick={openAdd}
          className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-lg shadow-sm">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Ticket Type
        </button>
      </div>

      {/* Card */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <>
        <div className="hidden space-y-2 p-3">
          {loading ? <p className="text-center py-6 text-gray-400 text-sm">Loading...</p>
           : types.length === 0 ? <p className="text-center py-6 text-gray-400 text-sm">No ticket types yet.</p>
           : types.map((t, idx) => (
             <MobileTicketTypeCard key={t.id} t={t} idx={idx}
               toggleActive={toggleActive} openEdit={openEdit} handleDelete={handleDelete} />
           ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead className="bg-[#23445f] text-white">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold uppercase text-xs tracking-wide">Name</th>
                <th className="px-4 py-2.5 text-left font-semibold uppercase text-xs tracking-wide">Description</th>
                <th className="px-4 py-2.5 text-center font-semibold uppercase text-xs tracking-wide">Tickets</th>
                <th className="px-4 py-2.5 text-center font-semibold uppercase text-xs tracking-wide">Active</th>
                <th className="px-4 py-2.5 text-right font-semibold uppercase text-xs tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan="5" className="text-center py-8 text-gray-400">Loading...</td></tr>
              ) : types.length === 0 ? (
                <tr><td colSpan="5" className="text-center py-8 text-gray-400">No ticket types yet.</td></tr>
              ) : types.map((t) => (
                <tr key={t.id} className="hover:bg-teal-50/40">
                  <td className="px-4 py-2.5 font-semibold text-gray-800">{t.name}</td>
                  <td className="px-4 py-2.5 text-gray-600">{t.description || <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-2.5 text-center font-mono">{t.ticket_count ?? 0}</td>
                  <td className="px-4 py-2.5 text-center">
                    <button onClick={() => toggleActive(t)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${t.is_active ? 'bg-teal-500' : 'bg-gray-300'}`}>
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${t.is_active ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => openEdit(t)} title="Edit"
                      className="p-1.5 rounded hover:bg-blue-50 text-blue-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    <button onClick={() => handleDelete(t)} title="Delete"
                      className="p-1.5 rounded hover:bg-red-50 text-red-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      </div>

      {/* Add/Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-0 md:p-4">
          <div className="w-full md:max-w-md bg-white rounded-t-2xl md:rounded-2xl max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-5 py-3 flex items-center justify-between">
              <h3 className="text-base font-semibold font-slab">
                {editing ? 'Edit Ticket Type' : 'Add Ticket Type'}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-white/80 hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Fiber Cut, Billing Query"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Description</label>
                <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                  rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none" />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.is_active}
                  onChange={e => setForm({ ...form, is_active: e.target.checked })}
                  className="rounded text-teal-600 focus:ring-teal-500" />
                Active
              </label>
            </div>

            <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 bg-gray-50">
              <button onClick={() => setShowModal(false)} disabled={saving}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="px-5 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
