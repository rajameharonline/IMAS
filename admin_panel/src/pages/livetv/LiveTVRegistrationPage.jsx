import { useState, useEffect, useCallback } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

// ── helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('bn-BD', { year: 'numeric', month: 'short', day: 'numeric' });
}

function ExpiryBadge({ expiresAt, isActive }) {
  if (!isActive) return <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-500 font-medium">নিষ্ক্রিয়</span>;
  if (!expiresAt) return <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700 font-medium">Unlimited</span>;
  const expired = new Date(expiresAt) < new Date();
  return (
    <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${expired ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
      {expired ? '⛔ মেয়াদ শেষ' : `📅 ${fmtDate(expiresAt)}`}
    </span>
  );
}

// ── Add/Edit Modal ───────────────────────────────────────────────────────────
function SubscriberModal({ sub, onClose, onSave }) {
  const isEdit = !!sub;
  const [form, setForm] = useState({
    name:           sub?.name        || '',
    phone:          sub?.phone       || '',
    customer_id:    sub?.customer_id || '',
    password_plain: '',
    is_active:      sub?.is_active   ?? true,
    expires_at:     sub?.expires_at  ? sub.expires_at.slice(0, 10) : '',
    notes:          sub?.notes       || '',
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      if (!payload.expires_at) payload.expires_at = null;
      if (!payload.password_plain) delete payload.password_plain;
      await onSave(payload);
      onClose();
    } catch (err) {
      const msg = err.response?.data ? JSON.stringify(err.response.data) : 'সংরক্ষণ ব্যর্থ।';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-600 flex items-center justify-center text-white text-lg">📱</div>
            <div>
              <h2 className="font-bold text-gray-900">{isEdit ? 'Subscriber সম্পাদনা' : 'নতুন Subscriber'}</h2>
              <p className="text-xs text-gray-400">Live TV App অ্যাক্সেস</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-bold">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Name + Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">পূর্ণ নাম *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="আব্দুল করিম" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">মোবাইল নম্বর *</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)} required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="01XXXXXXXXX" />
            </div>
          </div>

          {/* Customer ID */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Customer ID <span className="text-gray-400 font-normal">(optional)</span></label>
            <input value={form.customer_id} onChange={e => set('customer_id', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              placeholder="ISP Client code (যদি থাকে)" />
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              পাসওয়ার্ড {isEdit ? <span className="text-gray-400 font-normal">(খালি রাখলে পরিবর্তন হবে না)</span> : '*'}
            </label>
            <input type="password" value={form.password_plain} onChange={e => set('password_plain', e.target.value)}
              required={!isEdit} minLength={6}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              placeholder="কমপক্ষে ৬ অক্ষর" />
          </div>

          {/* Expires at + Active */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">মেয়াদ শেষ <span className="text-gray-400 font-normal">(খালি = unlimited)</span></label>
              <input type="date" value={form.expires_at} onChange={e => set('expires_at', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <div onClick={() => set('is_active', !form.is_active)}
                  role="switch" aria-checked={form.is_active} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); set('is_active', !form.is_active); } }}
                  className={`w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-offset-1 ${form.is_active ? 'bg-green-500' : 'bg-gray-300'}`}>
                  <div className={`w-5 h-5 bg-white rounded-full shadow m-0.5 transition-transform ${form.is_active ? 'translate-x-5' : ''}`} />
                </div>
                <span className="text-sm font-medium text-gray-700">{form.is_active ? 'সক্রিয়' : 'নিষ্ক্রিয়'}</span>
              </label>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">মন্তব্য</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
              placeholder="বাড়তি তথ্য (ঐচ্ছিক)" />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
              বাতিল
            </button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-60">
              {saving ? 'সংরক্ষণ হচ্ছে…' : isEdit ? 'আপডেট করুন' : 'যোগ করুন'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Delete Confirm ────────────────────────────────────────────────────────────
function DeleteConfirm({ sub, onClose, onConfirm, deleting }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
        <div className="text-4xl mb-3">🗑</div>
        <h3 className="font-bold text-gray-900 mb-1">Subscriber মুছে ফেলবেন?</h3>
        <p className="text-sm text-gray-500 mb-5">{sub.name} ({sub.phone}) — এই subscriber আর Live TV দেখতে পাবেন না।</p>
        <div className="flex gap-3 justify-center">
          <button onClick={onClose} className="px-5 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">বাতিল</button>
          <button onClick={onConfirm} disabled={deleting}
            className="px-5 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-60">
            {deleting ? 'মুছছে…' : 'হ্যাঁ, মুছুন'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function LiveTVRegistrationPage() {
  const [subscribers, setSubscribers] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [modalOpen, setModalOpen]     = useState(false);
  const [editTarget, setEditTarget]   = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting]       = useState(false);
  const [stats, setStats]             = useState({ total: 0, active: 0, expired: 0 });

  const fetchData = useCallback(async () => {
    try {
      const r = await api.get('/livetv/subscribers/');
      const data = r.data.results || r.data;
      setSubscribers(data);
      // stats compute
      const now = new Date();
      setStats({
        total:   data.length,
        active:  data.filter(s => s.is_active && (!s.expires_at || new Date(s.expires_at) > now)).length,
        expired: data.filter(s => s.expires_at && new Date(s.expires_at) <= now).length,
      });
    } catch { toast.error('Data load হয়নি।'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSave = async (payload) => {
    if (editTarget) {
      await api.put(`/livetv/subscribers/${editTarget.id}/`, payload);
      toast.success('Subscriber আপডেট হয়েছে।');
    } else {
      await api.post('/livetv/subscribers/', payload);
      toast.success('নতুন subscriber যোগ হয়েছে।');
    }
    fetchData();
  };

  const handleToggle = async (sub) => {
    try {
      await api.post(`/livetv/subscribers/${sub.id}/toggle-active/`);
      toast.success(sub.is_active ? `${sub.name} নিষ্ক্রিয় করা হয়েছে।` : `${sub.name} সক্রিয় করা হয়েছে।`);
      fetchData();
    } catch { toast.error('পরিবর্তন করা যায়নি।'); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/livetv/subscribers/${deleteTarget.id}/`);
      toast.success('Subscriber মুছে ফেলা হয়েছে।');
      setDeleteTarget(null);
      fetchData();
    } catch { toast.error('মুছতে ব্যর্থ।'); }
    finally { setDeleting(false); }
  };

  const filtered = subscribers.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.phone.includes(search) || (s.customer_id || '').includes(search)
  );

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-2 border-gray-200 border-t-red-600 rounded-full" />
    </div>
  );

  return (
    <div className="flex flex-col min-h-full bg-gray-50">

      {/* ── Header ── */}
      <div className="bg-gray-900 px-6 py-4 flex items-center justify-between flex-wrap gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-600 flex items-center justify-center text-white shrink-0 text-lg">📱</div>
          <div>
            <h1 className="text-base font-bold text-white leading-tight">Live TV Registration</h1>
            <p className="text-xs text-gray-400 mt-0.5">Subscriber management — যারা Live TV App ব্যবহার করতে পারবেন</p>
          </div>
        </div>
        <button onClick={() => { setEditTarget(null); setModalOpen(true); }}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors">
          + নতুন Subscriber
        </button>
      </div>

      {/* ── Stats strip ── */}
      <div className="bg-white border-b border-gray-200 grid grid-cols-3 divide-x divide-gray-100 shrink-0">
        {[
          { label: 'মোট Subscriber', value: stats.total,   icon: '👥', color: 'text-gray-800', accent: 'border-t-2 border-gray-400' },
          { label: 'সক্রিয়',         value: stats.active,  icon: '✅', color: 'text-green-600', accent: 'border-t-2 border-green-500' },
          { label: 'মেয়াদ শেষ',      value: stats.expired, icon: '⛔', color: 'text-red-600',   accent: 'border-t-2 border-red-500' },
        ].map(s => (
          <div key={s.label} className={`flex items-center gap-3 px-6 py-4 ${s.accent}`}>
            <span className="text-2xl shrink-0">{s.icon}</span>
            <div>
              <div className={`text-2xl font-bold leading-none ${s.color}`}>{s.value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Info banner ── */}
      <div className="bg-blue-50 border-b border-blue-100 px-6 py-2.5 flex items-center gap-2 text-xs text-blue-700 shrink-0">
        <span className="text-base">ℹ️</span>
        <span>Live TV App-এ login করতে হবে। শুধুমাত্র এখানে registered ও সক্রিয় subscriber-রাই channel দেখতে পাবেন।
        App login: <strong>phone + password</strong></span>
      </div>

      {/* ── Search ── */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 shrink-0">
        <div className="relative max-w-sm">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
            placeholder="নাম, phone বা Customer ID দিয়ে খুঁজুন…" />
        </div>
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <div className="text-5xl mb-3">📭</div>
            <div className="font-medium">{search ? 'কোনো subscriber পাওয়া যায়নি।' : 'এখনো কোনো subscriber নেই।'}</div>
            {!search && (
              <button onClick={() => { setEditTarget(null); setModalOpen(true); }}
                className="mt-4 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg">
                + প্রথম Subscriber যোগ করুন
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
              <tr>
                {['নাম', 'মোবাইল', 'Customer ID', 'স্ট্যাটাস', 'যোগের তারিখ', 'মন্তব্য', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {filtered.map(sub => (
                <tr key={sub.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{sub.name}</td>
                  <td className="px-4 py-3 text-gray-600 font-mono">{sub.phone}</td>
                  <td className="px-4 py-3 text-gray-500">{sub.customer_id || '—'}</td>
                  <td className="px-4 py-3">
                    <ExpiryBadge expiresAt={sub.expires_at} isActive={sub.is_active} />
                  </td>
                  <td className="px-4 py-3 text-gray-500">{fmtDate(sub.created_at)}</td>
                  <td className="px-4 py-3 text-gray-400 max-w-xs truncate">{sub.notes || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      {/* Toggle active */}
                      <button onClick={() => handleToggle(sub)} title={sub.is_active ? 'নিষ্ক্রিয় করুন' : 'সক্রিয় করুন'}
                        className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
                          sub.is_active
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}>
                        {sub.is_active ? '✓ Active' : '✗ Inactive'}
                      </button>
                      {/* Edit */}
                      <button onClick={() => { setEditTarget(sub); setModalOpen(true); }}
                        className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg" title="সম্পাদনা">
                        ✏️
                      </button>
                      {/* Delete */}
                      <button onClick={() => setDeleteTarget(sub)}
                        className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg" title="মুছুন">
                        🗑
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Modals ── */}
      {modalOpen && (
        <SubscriberModal
          sub={editTarget}
          onClose={() => { setModalOpen(false); setEditTarget(null); }}
          onSave={handleSave}
        />
      )}
      {deleteTarget && (
        <DeleteConfirm
          sub={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
          deleting={deleting}
        />
      )}
    </div>
  );
}
