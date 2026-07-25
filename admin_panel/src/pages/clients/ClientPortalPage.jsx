import { useState, useEffect, useRef } from 'react';
import api from '../../utils/api';

const fmtDateTime = (s) => {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleDateString('en-GB') + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const EMPTY_FORM = { client_id: null, customer_id: '', full_name: '', zone: '', phone: '', email: '', password: '', confirm_password: '' };

export default function ClientPortalPage() {
  const [stats, setStats]     = useState({ total: 0, app_users: 0, non_app_users: 0 });
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [userType, setUserType] = useState('all');   // all | app | non_app
  const [search, setSearch]   = useState('');

  // Registration modal
  const [modal, setModal]   = useState(false);
  const [form, setForm]     = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [lookupQ, setLookupQ]   = useState('');
  const [lookupList, setLookupList] = useState([]);
  const [showLookup, setShowLookup] = useState(false);
  const lookupTimer = useRef(null);

  // Reset password modal
  const [pwdModal, setPwdModal] = useState(null);   // {id, customer_id} | null
  const [newPwd, setNewPwd]     = useState('');

  const loadStats = () => api.get('/clients/portal-stats/').then(r => setStats(r.data)).catch(() => {});
  const loadRows = () => {
    setLoading(true);
    api.get('/clients/portal-registered/', { params: { user_type: userType } })
      .then(r => setRows(r.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadStats(); }, []);
  useEffect(() => { loadRows(); }, [userType]);

  // client-side search filter
  const visible = rows.filter(r => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return [r.customer_id, r.username, r.full_name, r.phone, r.zone]
      .some(v => (v || '').toString().toLowerCase().includes(q));
  });

  // ─── Registration modal ───────────────────────────────────────────
  const openModal = () => { setForm(EMPTY_FORM); setLookupQ(''); setLookupList([]); setModal(true); };

  const onLookupChange = (q) => {
    setLookupQ(q); setShowLookup(true);
    clearTimeout(lookupTimer.current);
    lookupTimer.current = setTimeout(() => {
      if (!q.trim()) { setLookupList([]); return; }
      api.get('/clients/portal-lookup/', { params: { search: q } })
        .then(r => setLookupList(r.data || [])).catch(() => setLookupList([]));
    }, 300);
  };

  const pickClient = (c) => {
    setForm(f => ({
      ...f, client_id: c.id, customer_id: c.customer_id, full_name: c.full_name,
      zone: c.zone, phone: c.phone || '', email: c.email || '',
    }));
    setLookupQ(`${c.username} (${c.customer_id})`);
    setShowLookup(false);
  };

  const handleRegister = async () => {
    if (!form.client_id) { alert('Client নির্বাচন করুন।'); return; }
    if (!(form.email || '').trim()) { alert('ইমেইল বাধ্যতামূলক।'); return; }
    if ((form.password || '').length < 4) { alert('Password কমপক্ষে ৪ অক্ষরের হতে হবে।'); return; }
    if (form.password !== form.confirm_password) { alert('Password ও Confirm Password মেলেনি।'); return; }
    setSaving(true);
    try {
      await api.post('/clients/portal-register/', {
        client_id: form.client_id, phone: form.phone, email: form.email,
        password: form.password, confirm_password: form.confirm_password,
      });
      setModal(false); loadStats(); loadRows();
    } catch (e) {
      alert(e.response?.data?.detail || 'Registration ব্যর্থ হয়েছে।');
    } finally { setSaving(false); }
  };

  // ─── Actions ──────────────────────────────────────────────────────
  const toggleApp = async (row) => {
    try {
      await api.post(`/clients/${row.id}/portal-toggle-app/`);
      loadRows(); loadStats();
    } catch { alert('আপডেট ব্যর্থ।'); }
  };

  const handleResetPwd = async () => {
    if ((newPwd || '').length < 4) { alert('Password কমপক্ষে ৪ অক্ষরের হতে হবে।'); return; }
    try {
      await api.post(`/clients/${pwdModal.id}/portal-reset-password/`, { password: newPwd });
      setPwdModal(null); setNewPwd(''); loadRows(); loadStats();
    } catch { alert('রিসেট ব্যর্থ।'); }
  };

  const STAT_CARDS = [
    { label: 'Total Registered Clients', value: stats.total, sub: 'Clients registered in your system.', from: 'from-sky-500', to: 'to-blue-600' },
    { label: 'App Users', value: stats.app_users, sub: 'Clients who can log into the app.', from: 'from-teal-500', to: 'to-emerald-600' },
    { label: 'Non-App Users', value: stats.non_app_users, sub: 'Clients who cannot use the app.', from: 'from-slate-600', to: 'to-slate-700' },
  ];

  return (
    <div className="p-4 md:p-6 bg-gray-100 min-h-screen">
      <div className="flex justify-between items-center mb-5">
        <h1 className="text-2xl font-bold text-gray-800">Registered Clients <span className="text-sm font-normal text-gray-400">Portal Management</span></h1>
        <button onClick={openModal}
          className="bg-[#173d59] hover:bg-[#1f5075] text-white px-5 py-2 rounded-full text-sm font-medium flex items-center gap-1">
          + Register New Client
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {STAT_CARDS.map((s, i) => (
          <div key={i} className={`rounded-2xl p-5 text-white bg-gradient-to-r ${s.from} ${s.to} shadow`}>
            <p className="text-sm opacity-90">{s.label}</p>
            <p className="text-3xl font-extrabold mt-1">{s.value}</p>
            <p className="text-xs opacity-80 mt-2">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Filter + Search */}
      <div className="flex flex-wrap gap-3 items-end mb-4">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">USER TYPE</label>
          <select value={userType} onChange={e => setUserType(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white min-w-[180px]">
            <option value="all">All User</option>
            <option value="app">App User</option>
            <option value="non_app">Non-App User</option>
          </select>
        </div>
        <div className="ml-auto">
          <label className="block text-xs font-semibold text-gray-500 mb-1">SEARCH</label>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Code / Name / Mobile..."
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white min-w-[220px]" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#0f2d42] text-white text-left">
              {['Sr', 'DateTime', 'C.Code', 'ID/IP', 'Name', 'MobileNo.', 'Zone', 'Package/Speed', 'Server', 'B.Status', 'L.Status', 'RegisteredOn', 'Is App User', 'Action'].map(h => (
                <th key={h} className="px-3 py-3 font-semibold whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={14} className="text-center text-gray-400 py-12">লোড হচ্ছে...</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={14} className="text-center text-gray-400 py-12">কোনো client পাওয়া যায়নি।</td></tr>
            ) : visible.map((r, i) => (
              <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2.5">{i + 1}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{fmtDateTime(r.datetime)}</td>
                <td className="px-3 py-2.5 font-semibold">{r.customer_id}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{r.username || r.ip_address || '—'}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{r.full_name}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{r.phone || '—'}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{r.zone || '—'}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{r.package || '—'}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{r.server || '—'}</td>
                <td className="px-3 py-2.5">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${r.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <button onClick={() => toggleApp(r)}
                    className={`relative w-10 h-5 rounded-full transition ${r.app_enabled ? 'bg-blue-500' : 'bg-gray-300'}`} title="App access on/off">
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition ${r.app_enabled ? 'left-5' : 'left-0.5'}`} />
                  </button>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{fmtDate(r.app_registered_on)}</td>
                <td className="px-3 py-2.5 text-center">
                  {r.is_app_user
                    ? <span className="text-emerald-500 text-lg">✔</span>
                    : <span className="text-gray-300 text-lg">✕</span>}
                </td>
                <td className="px-3 py-2.5">
                  <button onClick={() => { setPwdModal({ id: r.id, customer_id: r.customer_id }); setNewPwd(''); }}
                    className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 whitespace-nowrap">
                    {r.is_app_user ? 'Reset Pwd' : 'Set Pwd'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Registration Modal ─────────────────────────────────────── */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl max-h-[92vh] overflow-y-auto">
            <div className="bg-[#0f2d42] text-white px-6 py-4 rounded-t-2xl flex justify-between items-center">
              <h2 className="text-lg font-semibold">Client Registration</h2>
              <button onClick={() => setModal(false)} className="text-white/80 hover:text-white text-xl">✕</button>
            </div>
            <div className="p-6 space-y-4">
              {/* USER NAME (ID) lookup */}
              <div className="relative">
                <label className="text-xs font-bold text-gray-500">USER NAME (ID)</label>
                <input value={lookupQ} onChange={e => onLookupChange(e.target.value)} onFocus={() => setShowLookup(true)}
                  placeholder="Search Customer (Code / Name)"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-[#173d59]" />
                {showLookup && lookupList.length > 0 && (
                  <div className="absolute z-10 left-0 right-0 bg-white border border-gray-200 rounded-lg mt-1 shadow-lg max-h-52 overflow-y-auto">
                    {lookupList.map(c => (
                      <button key={c.id} onClick={() => pickClient(c)}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm border-b border-slate-50 flex justify-between">
                        <span>{c.username} <span className="text-gray-400">({c.customer_id})</span> — {c.full_name}</span>
                        {c.is_app_user && <span className="text-emerald-500 text-xs">app ✔</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <Field label="CUSTOMER NAME" value={form.full_name} readOnly />
              <Field label="ZONE" value={form.zone} readOnly />
              <Field label="MOBILE NUMBER" required value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} />
              <Field label="EMAIL ADDRESS" required value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} />
              <Field label="PASSWORD" required type="password" value={form.password} onChange={v => setForm(f => ({ ...f, password: v }))} />
              <Field label="CONFIRM PASSWORD" required type="password" value={form.confirm_password} onChange={v => setForm(f => ({ ...f, confirm_password: v }))} />

              <div className="flex gap-3 pt-2">
                <button onClick={() => setModal(false)}
                  className="flex-1 py-2.5 rounded-full border border-rose-300 text-rose-500 text-sm font-semibold">✖ Cancel</button>
                <button onClick={handleRegister} disabled={saving}
                  className="flex-1 py-2.5 rounded-full bg-[#173d59] text-white text-sm font-semibold disabled:opacity-50">
                  {saving ? 'সংরক্ষণ হচ্ছে...' : '✔ Submit'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Reset Password Modal ───────────────────────────────────── */}
      {pwdModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-1">Password সেট/রিসেট</h2>
            <p className="text-xs text-gray-500 mb-4">Customer Code: <b>{pwdModal.customer_id}</b></p>
            <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="নতুন password"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#173d59]" />
            <div className="flex gap-3 mt-5">
              <button onClick={() => setPwdModal(null)} className="flex-1 py-2.5 rounded-full border border-gray-300 text-gray-600 text-sm font-medium">বাতিল</button>
              <button onClick={handleResetPwd} className="flex-1 py-2.5 rounded-full bg-[#173d59] text-white text-sm font-medium">সংরক্ষণ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, readOnly, required, type = 'text' }) {
  return (
    <div>
      <label className="text-xs font-bold text-gray-500">{label} {required && <span className="text-rose-500">*</span>}</label>
      <input
        type={type} value={value || ''} readOnly={readOnly}
        onChange={e => onChange && onChange(e.target.value)}
        className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-[#173d59] ${readOnly ? 'bg-gray-100 text-gray-600' : ''}`}
      />
    </div>
  );
}
