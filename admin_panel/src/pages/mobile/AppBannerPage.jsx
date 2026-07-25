import { useState, useEffect } from 'react';
import api from '../../utils/api';

const EMPTY = { title: '', body: '', link_url: '', priority: 0, is_active: true, expires_at: '', image: null };

export default function AppBannerPage() {
  const [banners, setBanners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]     = useState(null);   // null | 'add' | 'edit'
  const [form, setForm]       = useState(EMPTY);
  const [editId, setEditId]   = useState(null);
  const [saving, setSaving]   = useState(false);
  const [imageFile, setImageFile] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/system/app-banners/').then(r => {
      setBanners(r.data.results || r.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => {
    setForm(EMPTY);
    setEditId(null);
    setImageFile(null);
    setModal('edit');
  };

  const openEdit = (b) => {
    setForm({
      title:    b.title,
      body:     b.body || '',
      link_url: b.link_url || '',
      priority: b.priority || 0,
      is_active: b.is_active,
      expires_at: b.expires_at ? b.expires_at.substring(0, 16) : '',
      image: null,
    });
    setEditId(b.id);
    setImageFile(null);
    setModal('edit');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => {
        if (v !== null && v !== undefined) fd.append(k, v);
      });
      if (imageFile) fd.append('image', imageFile);

      if (editId) {
        await api.patch(`/system/app-banners/${editId}/`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      } else {
        await api.post('/system/app-banners/', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      load();
      setModal(null);
    } catch (e) {
      alert(e.response?.data?.title?.[0] || 'সংরক্ষণ ব্যর্থ হয়েছে।');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('এই banner মুছে ফেলবেন?')) return;
    await api.delete(`/system/app-banners/${id}/`);
    load();
  };

  const toggleActive = async (b) => {
    await api.patch(`/system/app-banners/${b.id}/`, { is_active: !b.is_active });
    load();
  };

  return (
    <div className="p-4 md:p-6 bg-gray-100 min-h-screen">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800">App Banner / Notice</h1>
        <button
          onClick={openAdd}
          className="bg-[#173d59] hover:bg-[#1f5075] text-white px-5 py-2 rounded-full text-sm font-medium"
        >
          + নতুন Banner
        </button>
      </div>

      {loading ? (
        <p className="text-gray-400 text-center py-16">লোড হচ্ছে...</p>
      ) : banners.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center text-gray-400">
          <p className="text-lg">কোনো banner নেই।</p>
          <p className="text-sm mt-1">উপরের বাটনে ক্লিক করে নতুন banner যোগ করুন।</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {banners.map(b => (
            <div key={b.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              {b.image_url ? (
                <img src={b.image_url} alt={b.title} className="w-full h-36 object-cover" />
              ) : (
                <div className="w-full h-36 bg-gradient-to-r from-sky-500 to-cyan-600 flex items-center justify-center">
                  <span className="text-white text-4xl">📢</span>
                </div>
              )}
              <div className="p-4">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-semibold text-gray-800 text-sm">{b.title}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                    b.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {b.is_active ? 'সক্রিয়' : 'নিষ্ক্রিয়'}
                  </span>
                </div>
                {b.body && <p className="text-xs text-gray-500 mb-2 line-clamp-2">{b.body}</p>}
                <div className="flex gap-2 justify-between items-center mt-3">
                  <div className="flex gap-1">
                    <button
                      onClick={() => openEdit(b)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                    >
                      সম্পাদনা
                    </button>
                    <button
                      onClick={() => toggleActive(b)}
                      className={`text-xs px-3 py-1.5 rounded-lg border ${
                        b.is_active
                          ? 'border-amber-200 text-amber-600 hover:bg-amber-50'
                          : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                      }`}
                    >
                      {b.is_active ? 'বন্ধ করুন' : 'চালু করুন'}
                    </button>
                  </div>
                  <button
                    onClick={() => handleDelete(b.id)}
                    className="text-xs px-3 py-1.5 rounded-lg border border-rose-200 text-rose-500 hover:bg-rose-50"
                  >
                    মুছুন
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal === 'edit' && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-0 md:p-4">
          <div className="w-full md:max-w-lg bg-white rounded-t-2xl md:rounded-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">
                {editId ? 'Banner সম্পাদনা' : 'নতুন Banner'}
              </h2>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-gray-600">Title *</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-[#173d59]"
                    placeholder="Banner শিরোনাম"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-600">Body / বর্ণনা</label>
                  <textarea
                    value={form.body}
                    onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                    rows={3}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-[#173d59] resize-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-600">Link URL</label>
                  <input
                    type="url"
                    value={form.link_url}
                    onChange={e => setForm(f => ({ ...f, link_url: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-[#173d59]"
                    placeholder="https://..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-gray-600">Priority</label>
                    <input
                      type="number"
                      value={form.priority}
                      onChange={e => setForm(f => ({ ...f, priority: parseInt(e.target.value) || 0 }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-[#173d59]"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-600">মেয়াদ শেষ</label>
                    <input
                      type="datetime-local"
                      value={form.expires_at}
                      onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-[#173d59]"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-600">ছবি</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={e => setImageFile(e.target.files[0])}
                    className="w-full mt-1 text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-gray-300 file:text-sm file:bg-white"
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                    className="w-4 h-4 rounded text-[#173d59]"
                  />
                  <span className="text-sm text-gray-600">সক্রিয়</span>
                </label>
              </div>
              <div className="flex gap-3 mt-5">
                <button
                  onClick={() => setModal(null)}
                  className="flex-1 py-2.5 rounded-full border border-gray-300 text-gray-600 text-sm font-medium"
                >
                  বাতিল
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-full bg-[#173d59] text-white text-sm font-medium disabled:opacity-50"
                >
                  {saving ? 'সংরক্ষণ হচ্ছে...' : 'সংরক্ষণ করুন'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
