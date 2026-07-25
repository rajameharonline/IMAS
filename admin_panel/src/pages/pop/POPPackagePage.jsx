import { useEffect, useState } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const EMPTY = { name: '', bandwidth_mb: '', details: '' };

function PackageModal({ pkg, onClose, onSaved }) {
  const isEdit = !!pkg;
  const [form, setForm] = useState(isEdit ? { ...pkg } : { ...EMPTY });
  const [saving, setSaving] = useState(false);

  const set = e => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  };

  const save = async e => {
    e.preventDefault();
    if (!form.name || !form.bandwidth_mb) return toast.error('নাম ও Bandwidth দিন');
    setSaving(true);
    try {
      if (isEdit) await api.put(`/pop/packages/${pkg.id}/`, form);
      else await api.post('/pop/packages/', form);
      toast.success(isEdit ? 'আপডেট হয়েছে' : 'প্যাকেজ যোগ হয়েছে');
      onSaved();
    } catch {
      toast.error('সংরক্ষণ ব্যর্থ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-800">{isEdit ? 'Edit Package' : 'Add Package'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={save} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
              PACKAGE NAME <span className="text-red-500">*</span>
            </label>
            <input
              name="name" value={form.name} onChange={set}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="Package name"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
              BANDWITH ALLOCATION MB (ONLY FOR BTRC REPORT) <span className="text-red-500">*</span>
            </label>
            <input
              name="bandwidth_mb" type="number" value={form.bandwidth_mb} onChange={set}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="e.g. 10240"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">DETAILS (OPTIONAL)</label>
            <textarea
              name="details" value={form.details} onChange={set} rows={3}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setForm({ ...EMPTY })}
              className="px-5 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold hover:bg-red-600">
              Clear
            </button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button type="button" onClick={onClose}
              className="px-5 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600">
              Close
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function POPPackagePage() {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | 'add' | pkg obj

  const load = () => {
    setLoading(true);
    api.get('/pop/packages/?page_size=500').then(r => {
      setPackages(r.data.results || r.data);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const del = async pkg => {
    if (!confirm(`"${pkg.name}" মুছে দিবেন?`)) return;
    try {
      await api.delete(`/pop/packages/${pkg.id}/`);
      toast.success('মুছে গেছে');
      load();
    } catch {
      toast.error('মুছতে ব্যর্থ');
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Package Configuration</h1>
          <p className="text-sm text-gray-500">Configure Packages</p>
        </div>
        <button onClick={() => setModal('add')}
          className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800">
          + Package
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
        <table className="w-full min-w-[700px] text-sm">
          <thead>
            <tr className="bg-[#1e3a5f] text-white">
              <th className="px-4 py-3 text-left font-semibold">Serial No.</th>
              <th className="px-4 py-3 text-left font-semibold">Package Name</th>
              <th className="px-4 py-3 text-left font-semibold">Bandwidth MB (BTRC)</th>
              <th className="px-4 py-3 text-left font-semibold">Details</th>
              <th className="px-4 py-3 text-center font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="py-12 text-center text-gray-400">লোড হচ্ছে...</td></tr>
            ) : packages.length === 0 ? (
              <tr><td colSpan={5} className="py-12 text-center text-gray-400">No data available in table</td></tr>
            ) : packages.map((pkg, i) => (
              <tr key={pkg.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="px-4 py-3 text-gray-600">{i + 1}</td>
                <td className="px-4 py-3 font-medium text-gray-800">{pkg.name}</td>
                <td className="px-4 py-3 text-gray-600">{pkg.bandwidth_mb?.toLocaleString()}</td>
                <td className="px-4 py-3 text-gray-600 max-w-[280px] truncate" title={pkg.details || ''}>{pkg.details || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-2">
                    <button onClick={() => setModal(pkg)}
                      className="px-3 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600">Edit</button>
                    <button onClick={() => del(pkg)}
                      className="px-3 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-2 text-sm text-gray-500 border-t">
          Showing {packages.length} entries
        </div>
      </div>

      {modal && (
        <PackageModal
          pkg={modal === 'add' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}
