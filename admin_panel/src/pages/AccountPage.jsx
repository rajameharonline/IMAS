import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import toast from 'react-hot-toast';

const TABS = [
  'Personal Information',
  'Change Password',
  'Change Mobile Number',
  'Change Email',
  'Activity Log',
  'Login History',
];

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[#2a3347] last:border-0">
      <span className="text-gray-400 text-xs">{label}</span>
      <span className="text-white text-xs font-medium">{value || '—'}</span>
    </div>
  );
}

function SectionTitle({ children }) {
  return <h3 className="text-sm font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-200">{children}</h3>;
}

function InputField({ label, required, ...props }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        {...props}
        className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
      />
    </div>
  );
}

// ── Tab 1: Personal Information ───────────────────────────────────────────────
function PersonalInfoTab({ profile, onRefresh }) {
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
  });
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setForm({
        full_name: profile.full_name || '',
        email: profile.email || '',
        phone: profile.phone || '',
      });
      setAvatarPreview(profile.avatar || null);
    }
  }, [profile]);

  const handleAvatar = (e) => {
    const f = e.target.files[0];
    if (f) {
      setAvatarFile(f);
      setAvatarPreview(URL.createObjectURL(f));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('full_name', form.full_name);
      fd.append('phone', form.phone);
      if (avatarFile) fd.append('avatar', avatarFile);
      await api.patch(`/auth/users/${profile.id}/`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('প্রোফাইল আপডেট হয়েছে।');
      onRefresh();
    } catch {
      toast.error('আপডেট ব্যর্থ হয়েছে।');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionTitle>Personal Information</SectionTitle>
      <div className="flex items-center gap-4 mb-4">
        <div className="relative">
          <div className="w-20 h-20 rounded-full border-2 border-dashed border-gray-300 overflow-hidden flex items-center justify-center bg-gray-50">
            {avatarPreview
              ? <img src={avatarPreview} alt="avatar" className="w-full h-full object-cover" />
              : <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
            }
          </div>
          <label className="absolute bottom-0 right-0 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center cursor-pointer">
            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <input type="file" accept="image/*" className="hidden" onChange={handleAvatar} />
          </label>
        </div>
        <div>
          <p className="font-semibold text-gray-800">{profile?.username}</p>
          <p className="text-xs text-gray-500 capitalize">{profile?.role}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <InputField label="Full Name" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Full name" />
        <InputField label="Username" value={profile?.username || ''} disabled className="bg-gray-100 cursor-not-allowed" />
        <InputField label="Email" value={form.email} disabled className="bg-gray-100 cursor-not-allowed" />
        <InputField label="Phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone number" />
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Role</label>
          <input value={profile?.role || ''} disabled className="border border-gray-300 rounded px-3 py-2 text-sm bg-gray-100 cursor-not-allowed capitalize" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Status</label>
          <input value={profile?.is_active ? 'Active' : 'Inactive'} disabled className="border border-gray-300 rounded px-3 py-2 text-sm bg-gray-100 cursor-not-allowed" />
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <button onClick={handleSave} disabled={saving}
          className="bg-[#1c2333] hover:bg-[#0f6fec] text-white px-6 py-2 rounded text-sm font-medium transition-colors disabled:opacity-60">
          {saving ? 'সংরক্ষণ হচ্ছে...' : 'Update Profile'}
        </button>
      </div>
    </div>
  );
}

// ── Tab 2: Change Password ────────────────────────────────────────────────────
function ChangePasswordTab() {
  const [form, setForm] = useState({ old_password: '', new_password: '', confirm_password: '' });
  const [saving, setSaving] = useState(false);

  const handleChange = async () => {
    if (form.new_password !== form.confirm_password) {
      toast.error('নতুন পাসওয়ার্ড মিলছে না।');
      return;
    }
    if (form.new_password.length < 6) {
      toast.error('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।');
      return;
    }
    setSaving(true);
    try {
      await api.post('/auth/users/change-password/', {
        old_password: form.old_password,
        new_password: form.new_password,
      });
      toast.success('পাসওয়ার্ড পরিবর্তন হয়েছে।');
      setForm({ old_password: '', new_password: '', confirm_password: '' });
    } catch (err) {
      toast.error(err?.response?.data?.error || 'পাসওয়ার্ড পরিবর্তন ব্যর্থ হয়েছে।');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-md">
      <SectionTitle>Change Password</SectionTitle>
      <InputField label="Current Password" type="password" value={form.old_password}
        onChange={e => setForm(f => ({ ...f, old_password: e.target.value }))} placeholder="Current password" required />
      <InputField label="New Password" type="password" value={form.new_password}
        onChange={e => setForm(f => ({ ...f, new_password: e.target.value }))} placeholder="New password (min 6 chars)" required />
      <InputField label="Confirm New Password" type="password" value={form.confirm_password}
        onChange={e => setForm(f => ({ ...f, confirm_password: e.target.value }))} placeholder="Confirm new password" required />
      <div className="flex justify-end pt-2">
        <button onClick={handleChange} disabled={saving}
          className="bg-[#1c2333] hover:bg-[#0f6fec] text-white px-6 py-2 rounded text-sm font-medium transition-colors disabled:opacity-60">
          {saving ? 'পরিবর্তন হচ্ছে...' : 'Change Password'}
        </button>
      </div>
    </div>
  );
}

// ── Tab 3: Change Mobile Number ───────────────────────────────────────────────
function ChangeMobileTab({ profile, onRefresh }) {
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (profile) setPhone(profile.phone || ''); }, [profile]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch(`/auth/users/${profile.id}/`, { phone });
      toast.success('মোবাইল নম্বর আপডেট হয়েছে।');
      setEditing(false);
      onRefresh();
    } catch {
      toast.error('আপডেট ব্যর্থ হয়েছে।');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-md">
      <SectionTitle>Change Mobile Number</SectionTitle>
      <div className="flex flex-col gap-2">
        <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
          Current Mobile Number
        </label>
        <div className="flex items-center gap-2">
          <input value={phone} onChange={e => setPhone(e.target.value)} disabled={!editing}
            className={`flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${!editing ? 'bg-gray-100' : 'bg-white'}`}
            placeholder="Mobile number" />
          {!editing && (
            <button onClick={() => setEditing(true)}
              className="p-2 text-blue-600 hover:bg-blue-50 rounded transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {editing && (
        <div className="flex gap-2 justify-end">
          <button onClick={() => { setEditing(false); setPhone(profile?.phone || ''); }}
            className="border border-gray-300 text-gray-600 px-4 py-2 rounded text-sm hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="bg-[#1c2333] hover:bg-[#0f6fec] text-white px-6 py-2 rounded text-sm font-medium transition-colors disabled:opacity-60">
            {saving ? 'সংরক্ষণ হচ্ছে...' : 'Update'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Tab 4: Change Email ───────────────────────────────────────────────────────
function ChangeEmailTab({ profile, onRefresh }) {
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (profile) setEmail(profile.email || ''); }, [profile]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch(`/auth/users/${profile.id}/`, { email });
      toast.success('ইমেইল আপডেট হয়েছে।');
      setEditing(false);
      onRefresh();
    } catch (err) {
      toast.error(err?.response?.data?.email?.[0] || 'আপডেট ব্যর্থ হয়েছে।');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-md">
      <SectionTitle>Change Email</SectionTitle>
      <div className="flex flex-col gap-2">
        <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
          Current Email Address
        </label>
        <div className="flex items-center gap-2">
          <input value={email} onChange={e => setEmail(e.target.value)} disabled={!editing} type="email"
            className={`flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${!editing ? 'bg-gray-100' : 'bg-white'}`}
            placeholder="Email address" />
          {!editing && (
            <button onClick={() => setEditing(true)}
              className="p-2 text-blue-600 hover:bg-blue-50 rounded transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {editing && (
        <div className="flex gap-2 justify-end">
          <button onClick={() => { setEditing(false); setEmail(profile?.email || ''); }}
            className="border border-gray-300 text-gray-600 px-4 py-2 rounded text-sm hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="bg-[#1c2333] hover:bg-[#0f6fec] text-white px-6 py-2 rounded text-sm font-medium transition-colors disabled:opacity-60">
            {saving ? 'সংরক্ষণ হচ্ছে...' : 'Update'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Shared: simple table for logs ─────────────────────────────────────────────
function LogTable({ columns, rows, search, onSearch, show, onShow }) {
  const filtered = rows.filter(r =>
    Object.values(r).some(v => String(v).toLowerCase().includes(search.toLowerCase()))
  );
  const pageSize = parseInt(show, 10) || 10;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const sliced = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">SHOW</span>
          <select value={show} onChange={e => { onShow(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded px-2 py-1 text-xs">
            {[10, 25, 50, 100].map(n => <option key={n}>{n}</option>)}
          </select>
          <span className="text-xs text-gray-600">entries</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">SEARCH:</span>
          <input value={search} onChange={e => { onSearch(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded px-3 py-1 text-xs w-40 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[#1c2333] text-white">
              {columns.map(c => <th key={c} className="px-3 py-2 text-left font-medium">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {sliced.length === 0
              ? <tr><td colSpan={columns.length} className="px-3 py-6 text-center text-gray-400">কোনো ডেটা নেই</td></tr>
              : sliced.map((r, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  {Object.values(r).map((v, j) => <td key={j} className="px-3 py-2 text-gray-700">{v}</td>)}
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">
          Showing {filtered.length === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}
        </span>
        <div className="flex gap-1">
          <button onClick={() => setPage(1)} disabled={page === 1}
            className="px-2 py-1 text-xs border rounded hover:bg-gray-50 disabled:opacity-40">First</button>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-2 py-1 text-xs border rounded hover:bg-gray-50 disabled:opacity-40">Prev</button>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-2 py-1 text-xs border rounded hover:bg-gray-50 disabled:opacity-40">Next</button>
          <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
            className="px-2 py-1 text-xs border rounded hover:bg-gray-50 disabled:opacity-40">Last</button>
        </div>
      </div>
    </div>
  );
}

// ── Tab 5: Activity Log ───────────────────────────────────────────────────────
function ActivityLogTab() {
  const [search, setSearch] = useState('');
  const [show, setShow] = useState('10');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [changedType, setChangedType] = useState('');

  const rows = [];

  const columns = ['#', 'Date & Time', 'Changed Type', 'Old Value', 'New Value', 'Changed By'];

  return (
    <div className="space-y-4">
      <SectionTitle>Activity Log</SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Date From</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Date To</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Changed Type</label>
          <select value={changedType} onChange={e => setChangedType(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="">All Types</option>
            <option>Profile Update</option>
            <option>Password Change</option>
            <option>Email Change</option>
            <option>Phone Change</option>
          </select>
        </div>
        <div className="flex items-end">
          <button className="bg-[#1c2333] text-white px-4 py-2 rounded text-xs font-medium hover:bg-[#0f6fec] transition-colors w-full">
            Search
          </button>
        </div>
      </div>
      <LogTable columns={columns} rows={rows} search={search} onSearch={setSearch} show={show} onShow={setShow} />
    </div>
  );
}

// ── Tab 6: Login History ──────────────────────────────────────────────────────
function LoginHistoryTab() {
  const [search, setSearch] = useState('');
  const [show, setShow] = useState('10');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [authStatus, setAuthStatus] = useState('');

  const rows = [];

  const columns = ['#', 'Date & Time', 'IP Address', 'Location', 'Browser', 'OS', 'Status'];

  return (
    <div className="space-y-4">
      <SectionTitle>Login History</SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Date From</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Date To</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">User Auth Status</label>
          <select value={authStatus} onChange={e => setAuthStatus(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="">All</option>
            <option>Success</option>
            <option>Failed</option>
          </select>
        </div>
        <div className="flex items-end">
          <button className="bg-[#1c2333] text-white px-4 py-2 rounded text-xs font-medium hover:bg-[#0f6fec] transition-colors w-full">
            Search
          </button>
        </div>
      </div>
      <LogTable columns={columns} rows={rows} search={search} onSearch={setSearch} show={show} onShow={setShow} />
    </div>
  );
}

// ── Main AccountPage ──────────────────────────────────────────────────────────
export default function AccountPage() {
  const { user: authUser } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async () => {
    try {
      const r = await api.get('/auth/users/me/');
      setProfile(r.data);
    } catch {
      toast.error('প্রোফাইল লোড ব্যর্থ হয়েছে।');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchProfile(); }, []);

  const joinedDate = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">লোড হচ্ছে...</div>;
  }

  return (
    <div className="min-h-full">
      <div className="mb-4">
        <h1 className="text-lg font-bold text-gray-800">Account Manage</h1>
        <p className="text-xs text-gray-500">Manage your account settings and preferences</p>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        {/* ── Left Card ─────────────────────────────────────────────── */}
        <div className="w-full shrink-0 rounded-lg overflow-hidden shadow border border-gray-200 lg:w-56">
          {/* Card header */}
          <div className="bg-[#1c2333] px-4 py-5 flex flex-col items-center gap-3">
            <div className="w-20 h-20 rounded-full border-2 border-dashed border-gray-500 overflow-hidden flex items-center justify-center bg-[#2a3347]">
              {profile?.avatar
                ? <img src={profile.avatar} alt="avatar" className="w-full h-full object-cover" />
                : <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
              }
            </div>
            <div className="text-center">
              <p className="text-white font-semibold text-sm">{profile?.username || authUser?.username}</p>
              <p className="text-gray-400 text-[11px] capitalize mt-0.5">{profile?.role}</p>
            </div>
          </div>

          {/* Info rows */}
          <div className="bg-white px-4 py-3">
            <InfoRow label="Login UserName" value={profile?.username} />
            <InfoRow label="Status" value={
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${profile?.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {profile?.is_active ? 'Active' : 'Inactive'}
              </span>
            } />
            <InfoRow label="Mobile Number" value={profile?.phone} />
            <InfoRow label="Email Address" value={profile?.email && profile.email.length > 18 ? profile.email.slice(0, 18) + '…' : profile?.email} />
            <InfoRow label="Joined On" value={joinedDate} />
          </div>

          {/* Social icons */}
          <div className="bg-white px-4 py-3 border-t border-gray-100 flex gap-3 justify-center">
            {['facebook', 'twitter', 'linkedin'].map(s => (
              <button key={s} className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors">
                {s === 'facebook' && <svg className="w-3.5 h-3.5 text-blue-600" fill="currentColor" viewBox="0 0 24 24"><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/></svg>}
                {s === 'twitter' && <svg className="w-3.5 h-3.5 text-sky-500" fill="currentColor" viewBox="0 0 24 24"><path d="M23 3a10.9 10.9 0 01-3.14 1.53 4.48 4.48 0 00-7.86 3v1A10.66 10.66 0 013 4s-4 9 5 13a11.64 11.64 0 01-7 2c9 5 20 0 20-11.5a4.5 4.5 0 00-.08-.83A7.72 7.72 0 0023 3z"/></svg>}
                {s === 'linkedin' && <svg className="w-3.5 h-3.5 text-blue-700" fill="currentColor" viewBox="0 0 24 24"><path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2z"/><circle cx="4" cy="4" r="2"/></svg>}
              </button>
            ))}
          </div>
        </div>

        {/* ── Right Panel ───────────────────────────────────────────── */}
        <div className="flex-1 bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-gray-200 bg-gray-50 overflow-x-auto">
            {TABS.map((t, i) => (
              <button key={t} onClick={() => setActiveTab(i)}
                className={`px-4 py-3 text-xs font-medium whitespace-nowrap transition-colors border-b-2 ${
                  activeTab === i
                    ? 'border-[#0f6fec] text-[#0f6fec] bg-white'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                }`}>
                {t}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="p-4 sm:p-6">
            {activeTab === 0 && <PersonalInfoTab profile={profile} onRefresh={fetchProfile} />}
            {activeTab === 1 && <ChangePasswordTab />}
            {activeTab === 2 && <ChangeMobileTab profile={profile} onRefresh={fetchProfile} />}
            {activeTab === 3 && <ChangeEmailTab profile={profile} onRefresh={fetchProfile} />}
            {activeTab === 4 && <ActivityLogTab />}
            {activeTab === 5 && <LoginHistoryTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
