import { useEffect, useState } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

function NoticeModal({ notice, pops, onClose, onSaved }) {
  const isEdit = !!notice;
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState(isEdit ? {
    pop: notice.pop || '', title: notice.title, details: notice.details,
    start_date: notice.start_date || today, end_date: notice.end_date || today,
    status: notice.status,
  } : { pop: '', title: '', details: '', start_date: today, end_date: today, status: 'enable' });
  const [saving, setSaving] = useState(false);
  const set = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const save = async e => {
    e.preventDefault();
    if (!form.title || !form.details) return toast.error('Title ও Details দিন');
    setSaving(true);
    try {
      if (isEdit) await api.put(`/pop/notices/${notice.id}/`, form);
      else await api.post('/pop/notices/', form);
      toast.success(isEdit ? 'আপডেট হয়েছে' : 'Notice যোগ হয়েছে');
      onSaved();
    } catch { toast.error('সংরক্ষণ ব্যর্থ'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-800">{isEdit ? 'Edit Notice' : 'Add Notice'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={save} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">POP (Optional)</label>
            <select name="pop" value={form.pop} onChange={set} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">All POPs</option>
              {pops.map(p => <option key={p.id} value={p.id}>{p.code} — {p.business_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">TITLE <span className="text-red-500">*</span></label>
            <input name="title" value={form.title} onChange={set} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">DETAILS <span className="text-red-500">*</span></label>
            <textarea name="details" value={form.details} onChange={set} rows={4}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">START DATE</label>
              <input name="start_date" type="date" value={form.start_date} onChange={set} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">END DATE</label>
              <input name="end_date" type="date" value={form.end_date} onChange={set} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">STATUS</label>
            <select name="status" value={form.status} onChange={set} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="enable">Enable</option>
              <option value="disable">Disable</option>
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving}
              className="px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button type="button" onClick={onClose}
              className="px-5 py-2 rounded-lg bg-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-300">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function POPNoticePage() {
  const [notices, setNotices] = useState([]);
  const [pops, setPops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/pop/notices/?page_size=500'),
      api.get('/pop/pops/?page_size=500'),
    ]).then(([n, p]) => {
      setNotices(n.data.results || n.data);
      setPops(p.data.results || p.data);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const del = async n => {
    if (!confirm(`"${n.title}" মুছে দিবেন?`)) return;
    try {
      await api.delete(`/pop/notices/${n.id}/`);
      toast.success('মুছে গেছে');
      load();
    } catch { toast.error('মুছতে ব্যর্থ'); }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">POP Notice</h1>
          <p className="text-sm text-gray-500">POP-specific notices</p>
        </div>
        <button onClick={() => setModal('add')}
          className="px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800">
          + Add Notice
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="bg-[#1e3a5f] text-white">
              {['#','POP','Title','Start Date','End Date','Status','Created','Action'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left font-semibold text-xs">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="py-12 text-center text-gray-400">লোড হচ্ছে...</td></tr>
            ) : notices.length === 0 ? (
              <tr><td colSpan={8} className="py-12 text-center text-gray-400">No data available in table</td></tr>
            ) : notices.map((n, i) => (
              <tr key={n.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="px-3 py-2">{i + 1}</td>
                <td className="px-3 py-2 text-gray-600">{n.pop_name || 'All POPs'}</td>
                <td className="px-3 py-2 font-medium text-gray-800 max-w-[240px] truncate" title={n.title}>{n.title}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{n.start_date || '—'}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{n.end_date || '—'}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${n.status === 'enable' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {n.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">{n.created_at?.slice(0,10)}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <button onClick={() => setModal(n)}
                      className="px-2 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600">Edit</button>
                    <button onClick={() => del(n)}
                      className="px-2 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600">Del</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-2 text-sm text-gray-500 border-t">Showing {notices.length} entries</div>
      </div>

      {modal && (
        <NoticeModal
          notice={modal === 'add' ? null : modal} pops={pops}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}
