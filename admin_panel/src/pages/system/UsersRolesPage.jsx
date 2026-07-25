// Users & Roles Management Page — ISP Admin System
import { useEffect, useState, useCallback, useMemo } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

/* ─── Constants ─────────────────────────────────────────────────────────── */
const ROLES = [
  { value: 'superadmin', label: 'Super Admin',    color: 'bg-purple-100 text-purple-700 border-purple-200' },
  { value: 'admin',      label: 'Admin',           color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { value: 'manager',    label: 'Manager',         color: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  { value: 'accountant', label: 'Accountant',      color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { value: 'support',    label: 'Support',         color: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  { value: 'collector',  label: 'Bill Collector',  color: 'bg-orange-100 text-orange-700 border-orange-200' },
];

const ROLE_MAP = Object.fromEntries(ROLES.map(r => [r.value, r]));

const EMPTY_FORM = {
  username: '', email: '', full_name: '', phone: '',
  role: 'admin', password: '', is_active: true,
};

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function getInitials(name, username) {
  const src = name || username || '?';
  return src.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function avatarColor(str) {
  const colors = [
    'bg-violet-500','bg-blue-500','bg-emerald-500','bg-rose-500',
    'bg-amber-500','bg-cyan-500','bg-pink-500','bg-teal-500',
  ];
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % colors.length;
  return colors[Math.abs(h) % colors.length];
}

const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition';
const sel = `${inp} bg-white appearance-none`;

/* ─── Sub-components ─────────────────────────────────────────────────────── */

function StatCard({ icon, label, value, sub, gradient }) {
  return (
    <div className={`rounded-2xl p-5 text-white shadow-lg bg-gradient-to-br ${gradient} flex items-start justify-between`}>
      <div>
        <p className="text-sm font-medium opacity-85">{label}</p>
        <p className="text-3xl font-bold mt-1">{value}</p>
        {sub && <p className="text-xs opacity-70 mt-1">{sub}</p>}
      </div>
      <span className="text-4xl opacity-30 select-none">{icon}</span>
    </div>
  );
}

function RoleBadge({ role }) {
  const r = ROLE_MAP[role] || { label: role, color: 'bg-gray-100 text-gray-600 border-gray-200' };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${r.color}`}>
      {r.label}
    </span>
  );
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors
        ${checked ? 'bg-blue-500' : 'bg-gray-300'} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform
        ${checked ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
    </button>
  );
}

function Modal({ title, subtitle, onClose, children, size = 'md' }) {
  const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
      <div className={`bg-white rounded-2xl shadow-2xl w-full my-4 ${sizes[size]}`}>
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
            {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none mt-0.5">×</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function FieldWrap({ label, required, children, hint }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

/* ─── User Form Modal ─────────────────────────────────────────────────────── */
function UserFormModal({ editUser, onClose, onSaved }) {
  const isEdit = Boolean(editUser);
  const [form, setForm] = useState(isEdit ? {
    username: editUser.username || '',
    email: editUser.email || '',
    full_name: editUser.full_name || '',
    phone: editUser.phone || '',
    role: editUser.role || 'admin',
    password: '',
    is_active: editUser.is_active ?? true,
  } : { ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.username.trim()) { toast.error('Username আবশ্যক'); return; }
    if (!form.email.trim())    { toast.error('Email আবশ্যক'); return; }
    if (!isEdit && !form.password) { toast.error('Password আবশ্যক'); return; }

    setSaving(true);
    try {
      const payload = { ...form };
      if (isEdit && !payload.password) delete payload.password;
      if (isEdit) {
        await api.patch(`/auth/users/${editUser.id}/`, payload);
        toast.success('ইউজার আপডেট হয়েছে');
      } else {
        await api.post('/auth/users/', payload);
        toast.success('নতুন ইউজার তৈরি হয়েছে');
      }
      onSaved();
    } catch (err) {
      const d = err.response?.data;
      if (d && typeof d === 'object') {
        Object.entries(d).forEach(([k, v]) => toast.error(`${k}: ${Array.isArray(v) ? v[0] : v}`));
      } else {
        toast.error('সংরক্ষণ ব্যর্থ হয়েছে');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={isEdit ? 'ইউজার সম্পাদনা' : 'নতুন ইউজার যোগ'}
      subtitle={isEdit ? `@${editUser.username}` : 'নতুন অ্যাডমিন ইউজার তৈরি করুন'}
      onClose={onClose}
      size="lg"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FieldWrap label="পূর্ণ নাম" required>
          <input className={inp} placeholder="Full Name"
            value={form.full_name} onChange={e => set('full_name', e.target.value)} />
        </FieldWrap>

        <FieldWrap label="Username" required>
          <input className={inp} placeholder="username"
            value={form.username} onChange={e => set('username', e.target.value.toLowerCase().replace(/\s/g, ''))}
            disabled={isEdit} />
        </FieldWrap>

        <FieldWrap label="Email" required>
          <input className={inp} type="email" placeholder="email@example.com"
            value={form.email} onChange={e => set('email', e.target.value)} />
        </FieldWrap>

        <FieldWrap label="ফোন নম্বর">
          <input className={inp} placeholder="01XXXXXXXXX"
            value={form.phone} onChange={e => set('phone', e.target.value)} />
        </FieldWrap>

        <FieldWrap label="Role / ভূমিকা" required>
          <select className={sel} value={form.role} onChange={e => set('role', e.target.value)}>
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </FieldWrap>

        <FieldWrap label={isEdit ? 'নতুন Password (ঐচ্ছিক)' : 'Password'} required={!isEdit}
          hint={isEdit ? 'খালি রাখলে পুরনো পাসওয়ার্ড থাকবে' : 'কমপক্ষে ৬ অক্ষর'}>
          <div className="relative">
            <input className={inp} type={showPass ? 'text' : 'password'}
              placeholder={isEdit ? 'নতুন পাসওয়ার্ড দিন (ঐচ্ছিক)' : 'পাসওয়ার্ড দিন'}
              value={form.password} onChange={e => set('password', e.target.value)} />
            <button type="button" onClick={() => setShowPass(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">
              {showPass ? '🙈' : '👁️'}
            </button>
          </div>
        </FieldWrap>

        <div className="sm:col-span-2">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <Toggle checked={form.is_active} onChange={() => set('is_active', !form.is_active)} />
            <span className="text-sm font-medium text-gray-700">
              অ্যাকাউন্ট সক্রিয় ({form.is_active ? 'Active' : 'Inactive'})
            </span>
          </label>
        </div>
      </div>

      <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
        <button onClick={onClose} disabled={saving}
          className="px-5 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition">
          বাতিল
        </button>
        <button onClick={handleSubmit} disabled={saving}
          className="px-6 py-2 text-sm font-semibold rounded-lg bg-gradient-to-r from-blue-600 to-blue-500
            text-white hover:from-blue-700 hover:to-blue-600 shadow-sm disabled:opacity-60 transition flex items-center gap-2">
          {saving && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {isEdit ? 'আপডেট করুন' : 'তৈরি করুন'}
        </button>
      </div>
    </Modal>
  );
}

/* ─── Password Reset Modal ────────────────────────────────────────────────── */
function PasswordResetModal({ user, onClose }) {
  const [form, setForm] = useState({ old_password: '', new_password: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [show, setShow] = useState({ old: false, new: false, conf: false });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggleShow = k => setShow(s => ({ ...s, [k]: !s[k] }));

  const handleReset = async () => {
    if (!form.new_password || form.new_password.length < 6) {
      toast.error('পাসওয়ার্ড কমপক্ষে ৬ অক্ষর হতে হবে'); return;
    }
    if (form.new_password !== form.confirm) {
      toast.error('পাসওয়ার্ড মিলছে না'); return;
    }
    setSaving(true);
    try {
      // Admin direct password set via patch
      await api.patch(`/auth/users/${user.id}/`, { password: form.new_password });
      toast.success(`${user.username}-এর পাসওয়ার্ড রিসেট হয়েছে`);
      onClose();
    } catch (err) {
      const d = err.response?.data;
      if (d?.error) toast.error(d.error);
      else toast.error('পাসওয়ার্ড রিসেট ব্যর্থ হয়েছে');
    } finally { setSaving(false); }
  };

  return (
    <Modal title="পাসওয়ার্ড রিসেট" subtitle={`@${user.username}`} onClose={onClose} size="sm">
      <div className="space-y-4">
        <FieldWrap label="নতুন পাসওয়ার্ড" required hint="কমপক্ষে ৬ অক্ষর">
          <div className="relative">
            <input className={inp} type={show.new ? 'text' : 'password'}
              placeholder="নতুন পাসওয়ার্ড" value={form.new_password}
              onChange={e => set('new_password', e.target.value)} />
            <button type="button" onClick={() => toggleShow('new')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">
              {show.new ? '🙈' : '👁️'}
            </button>
          </div>
        </FieldWrap>

        <FieldWrap label="পাসওয়ার্ড নিশ্চিত করুন" required>
          <div className="relative">
            <input className={inp} type={show.conf ? 'text' : 'password'}
              placeholder="পাসওয়ার্ড আবার দিন" value={form.confirm}
              onChange={e => set('confirm', e.target.value)} />
            <button type="button" onClick={() => toggleShow('conf')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">
              {show.conf ? '🙈' : '👁️'}
            </button>
          </div>
        </FieldWrap>
      </div>

      <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
        <button onClick={onClose} disabled={saving}
          className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition">
          বাতিল
        </button>
        <button onClick={handleReset} disabled={saving}
          className="px-5 py-2 text-sm font-semibold rounded-lg bg-gradient-to-r from-red-500 to-rose-500
            text-white hover:from-red-600 hover:to-rose-600 shadow-sm disabled:opacity-60 flex items-center gap-2">
          {saving && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          রিসেট করুন
        </button>
      </div>
    </Modal>
  );
}

/* ─── Delete Confirm Modal ───────────────────────────────────────────────── */
function DeleteModal({ user, onClose, onDeleted }) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/auth/users/${user.id}/`);
      toast.success('ইউজার মুছে ফেলা হয়েছে');
      onDeleted();
    } catch {
      toast.error('মুছতে ব্যর্থ হয়েছে');
    } finally { setDeleting(false); }
  };

  return (
    <Modal title="ইউজার মুছুন" onClose={onClose} size="sm">
      <div className="text-center py-2">
        <div className="text-5xl mb-4">⚠️</div>
        <p className="text-gray-700 text-sm font-medium">
          আপনি কি <span className="font-bold text-red-600">@{user.username}</span> ইউজারটি
          মুছে ফেলতে চান?
        </p>
        <p className="text-gray-400 text-xs mt-2">এই কাজটি পূর্বাবস্থায় ফেরানো যাবে না।</p>
      </div>
      <div className="flex gap-3 mt-6">
        <button onClick={onClose} disabled={deleting}
          className="flex-1 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition">
          বাতিল
        </button>
        <button onClick={handleDelete} disabled={deleting}
          className="flex-1 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white
            hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-2 transition">
          {deleting && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          মুছুন
        </button>
      </div>
    </Modal>
  );
}

/* ─── User Detail Modal ──────────────────────────────────────────────────── */
function UserDetailModal({ user, onClose, onEdit }) {
  const initials = getInitials(user.full_name, user.username);
  const bgColor  = avatarColor(user.username);

  return (
    <Modal title="ইউজার বিস্তারিত" onClose={onClose} size="md">
      <div className="flex flex-col items-center text-center pb-4 border-b border-gray-100 mb-4">
        {user.avatar ? (
          <img src={user.avatar} alt={user.username}
            className="w-20 h-20 rounded-full object-cover shadow-md border-4 border-white ring-2 ring-blue-200" />
        ) : (
          <div className={`w-20 h-20 rounded-full flex items-center justify-center text-white font-bold text-2xl ${bgColor} shadow-md`}>
            {initials}
          </div>
        )}
        <h3 className="text-lg font-semibold text-gray-900 mt-3">{user.full_name || user.username}</h3>
        <p className="text-sm text-gray-500">@{user.username}</p>
        <div className="mt-2 flex items-center gap-2">
          <RoleBadge role={user.role} />
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border
            ${user.is_active ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
            {user.is_active ? '✓ Active' : '✗ Inactive'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        {[
          { label: 'Email',     value: user.email || '—' },
          { label: 'Phone',     value: user.phone || '—' },
          { label: 'যোগদানের তারিখ', value: user.created_at ? new Date(user.created_at).toLocaleDateString('bn-BD') : '—' },
          { label: 'Last Login', value: '—' },
        ].map(({ label, value }) => (
          <div key={label} className="bg-gray-50 rounded-xl p-3">
            <p className="text-xs text-gray-400 mb-1">{label}</p>
            <p className="font-medium text-gray-800 text-xs break-all">{value}</p>
          </div>
        ))}
      </div>

      <button onClick={onEdit}
        className="mt-5 w-full py-2.5 text-sm font-semibold rounded-xl bg-gradient-to-r from-blue-600 to-blue-500
          text-white hover:from-blue-700 hover:to-blue-600 shadow-sm transition">
        সম্পাদনা করুন
      </button>
    </Modal>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────────── */
export default function UsersRolesPage() {
  const [users,    setUsers]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [roleF,    setRoleF]    = useState('');
  const [statusF,  setStatusF]  = useState('');
  const [toggling, setToggling] = useState(null);

  // Modals
  const [showForm,    setShowForm]    = useState(false);
  const [editUser,    setEditUser]    = useState(null);
  const [deleteUser,  setDeleteUser]  = useState(null);
  const [viewUser,    setViewUser]    = useState(null);
  const [resetUser,   setResetUser]   = useState(null);

  /* Fetch all users */
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/auth/users/');
      setUsers(res.data.results || res.data);
    } catch {
      toast.error('ইউজার লোড করতে ব্যর্থ হয়েছে');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  /* Filtered list */
  const filtered = useMemo(() => {
    let list = [...users];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(u =>
        u.username?.toLowerCase().includes(q) ||
        u.full_name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.phone?.includes(q)
      );
    }
    if (roleF)   list = list.filter(u => u.role === roleF);
    if (statusF) list = list.filter(u => statusF === 'active' ? u.is_active : !u.is_active);
    return list;
  }, [users, search, roleF, statusF]);

  /* Stats */
  const stats = useMemo(() => {
    const total  = users.length;
    const active = users.filter(u => u.is_active).length;
    const admins = users.filter(u => ['superadmin', 'admin'].includes(u.role)).length;
    const staff  = total - admins;
    return { total, active, admins, staff };
  }, [users]);

  /* Toggle active */
  const handleToggle = async (user) => {
    setToggling(user.id);
    try {
      await api.patch(`/auth/users/${user.id}/`, { is_active: !user.is_active });
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, is_active: !u.is_active } : u));
      toast.success(`${user.username} ${user.is_active ? 'নিষ্ক্রিয়' : 'সক্রিয়'} করা হয়েছে`);
    } catch {
      toast.error('পরিবর্তন ব্যর্থ হয়েছে');
    } finally { setToggling(null); }
  };

  const openEdit = (user) => { setEditUser(user); setShowForm(true); setViewUser(null); };

  return (
    <div className="p-4 sm:p-6 min-h-screen bg-gray-50">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <span className="text-2xl">👥</span> Users &amp; Roles
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">সিস্টেম ইউজার ও তাদের ভূমিকা পরিচালনা করুন</p>
        </div>
        <button
          onClick={() => { setEditUser(null); setShowForm(true); }}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600
            to-blue-500 text-white text-sm font-semibold shadow-md hover:from-blue-700 hover:to-blue-600
            transition active:scale-95"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          নতুন ইউজার
        </button>
      </div>

      {/* ── Stats Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard icon="👤" label="মোট ইউজার"    value={stats.total}  sub="সকল অ্যাকাউন্ট"  gradient="from-blue-600 to-blue-400" />
        <StatCard icon="✅" label="সক্রিয় ইউজার"  value={stats.active} sub="লগইন করতে পারবে" gradient="from-emerald-600 to-emerald-400" />
        <StatCard icon="🛡️" label="অ্যাডমিন"     value={stats.admins} sub="সুপার+অ্যাডমিন"   gradient="from-purple-600 to-purple-400" />
        <StatCard icon="🧑‍💼" label="স্টাফ"        value={stats.staff}  sub="Manager ও নিচে"  gradient="from-orange-500 to-amber-400" />
      </div>

      {/* ── Role Distribution Bar ── */}
      {!loading && users.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 mb-5">
          <p className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">Role বিতরণ</p>
          <div className="flex flex-wrap gap-3">
            {ROLES.map(r => {
              const count = users.filter(u => u.role === r.value).length;
              return count > 0 ? (
                <div key={r.value} className="flex items-center gap-2 cursor-pointer"
                  role="button" tabIndex={0}
                  onClick={() => setRoleF(prev => prev === r.value ? '' : r.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setRoleF(prev => prev === r.value ? '' : r.value);
                    }
                  }}>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${r.color}
                    ${roleF === r.value ? 'ring-2 ring-offset-1 ring-blue-500' : ''}`}>
                    {r.label} · {count}
                  </span>
                </div>
              ) : null;
            })}
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm mb-5">
        <div className="flex flex-col sm:flex-row gap-3 p-4">
          {/* Search */}
          <div className="flex-1 relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-xl
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="নাম, ইউজারনেম, ইমেইল বা ফোন খুঁজুন..."
              value={search} onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Role Filter */}
          <select
            className="px-3 py-2 text-sm border border-gray-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[150px]"
            value={roleF} onChange={e => setRoleF(e.target.value)}
          >
            <option value="">সব Role</option>
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>

          {/* Status Filter */}
          <select
            className="px-3 py-2 text-sm border border-gray-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[140px]"
            value={statusF} onChange={e => setStatusF(e.target.value)}
          >
            <option value="">সব Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>

          {(search || roleF || statusF) && (
            <button onClick={() => { setSearch(''); setRoleF(''); setStatusF(''); }}
              className="px-3 py-2 text-xs text-gray-500 hover:text-red-500 border border-gray-200 rounded-xl hover:border-red-200 transition whitespace-nowrap">
              ✕ ক্লিয়ার
            </button>
          )}
        </div>

        {/* Result count */}
        <div className="px-4 pb-3 flex items-center justify-between text-xs text-gray-400">
          <span>{filtered.length} ইউজার পাওয়া গেছে</span>
          {filtered.length !== users.length && (
            <span className="text-blue-500">মোট {users.length} থেকে ফিল্টার করা হয়েছে</span>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-400">লোড হচ্ছে...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <span className="text-5xl">👤</span>
            <p className="text-gray-500 font-medium">কোনো ইউজার পাওয়া যায়নি</p>
            <p className="text-xs text-gray-400">ফিল্টার পরিবর্তন করুন বা নতুন ইউজার যোগ করুন</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">#</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">ইউজার</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">Email</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell">ফোন</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden xl:table-cell">যোগদান</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">অ্যাকশন</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((user, idx) => {
                  const initials = getInitials(user.full_name, user.username);
                  const bgColor  = avatarColor(user.username);
                  return (
                    <tr key={user.id}
                      className="hover:bg-blue-50/30 transition-colors group">

                      {/* # */}
                      <td className="px-4 py-3 text-gray-400 text-xs">{idx + 1}</td>

                      {/* User info */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {user.avatar ? (
                            <img src={user.avatar} alt={user.username}
                              className="w-9 h-9 rounded-full object-cover shadow-sm border-2 border-white ring-1 ring-gray-200 shrink-0" />
                          ) : (
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold ${bgColor} shadow-sm shrink-0`}>
                              {initials}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-900 text-sm truncate">
                              {user.full_name || user.username}
                            </p>
                            <p className="text-xs text-gray-400 truncate">@{user.username}</p>
                          </div>
                        </div>
                      </td>

                      {/* Email */}
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="text-xs text-gray-600 break-all">{user.email || '—'}</span>
                      </td>

                      {/* Phone */}
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="text-xs text-gray-600">{user.phone || '—'}</span>
                      </td>

                      {/* Role */}
                      <td className="px-4 py-3">
                        <RoleBadge role={user.role} />
                      </td>

                      {/* Status toggle */}
                      <td className="px-4 py-3 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <Toggle
                            checked={user.is_active}
                            onChange={() => handleToggle(user)}
                            disabled={toggling === user.id}
                          />
                          <span className={`text-[10px] font-medium ${user.is_active ? 'text-green-600' : 'text-red-400'}`}>
                            {toggling === user.id ? '...' : (user.is_active ? 'Active' : 'Inactive')}
                          </span>
                        </div>
                      </td>

                      {/* Joined */}
                      <td className="px-4 py-3 hidden xl:table-cell">
                        <span className="text-xs text-gray-500">
                          {user.created_at ? new Date(user.created_at).toLocaleDateString('en-GB', {
                            day: '2-digit', month: 'short', year: 'numeric'
                          }) : '—'}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {/* View */}
                          <button onClick={() => setViewUser(user)} title="বিস্তারিত দেখুন"
                            className="p-1.5 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </button>
                          {/* Edit */}
                          <button onClick={() => openEdit(user)} title="সম্পাদনা"
                            className="p-1.5 rounded-lg text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 transition">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          {/* Password Reset */}
                          <button onClick={() => setResetUser(user)} title="পাসওয়ার্ড রিসেট"
                            className="p-1.5 rounded-lg text-gray-500 hover:text-amber-600 hover:bg-amber-50 transition">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                            </svg>
                          </button>
                          {/* Delete */}
                          <button onClick={() => setDeleteUser(user)} title="মুছুন"
                            className="p-1.5 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                        {/* Mobile: always visible dots */}
                        <div className="flex items-center justify-end gap-1 sm:hidden">
                          <button onClick={() => openEdit(user)}
                            className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button onClick={() => setDeleteUser(user)}
                            className="p-1.5 rounded-lg text-red-500 hover:bg-red-50">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Role Reference Card ── */}
      <div className="mt-5 bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
        <p className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">Role রেফারেন্স</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {ROLES.map(r => (
            <div key={r.value} className="text-center">
              <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold border ${r.color}`}>
                {r.label}
              </span>
              <p className="text-[10px] text-gray-400 mt-1">
                {r.value === 'superadmin' && 'সর্বোচ্চ অ্যাক্সেস'}
                {r.value === 'admin' && 'সম্পূর্ণ অ্যাক্সেস'}
                {r.value === 'manager' && 'ব্যবস্থাপনা'}
                {r.value === 'accountant' && 'হিসাব-নিকাশ'}
                {r.value === 'support' && 'সাপোর্ট টিম'}
                {r.value === 'collector' && 'বিল সংগ্রহ'}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Modals ── */}
      {showForm && (
        <UserFormModal
          editUser={editUser}
          onClose={() => { setShowForm(false); setEditUser(null); }}
          onSaved={() => { setShowForm(false); setEditUser(null); fetchUsers(); }}
        />
      )}
      {viewUser && (
        <UserDetailModal
          user={viewUser}
          onClose={() => setViewUser(null)}
          onEdit={() => openEdit(viewUser)}
        />
      )}
      {resetUser && (
        <PasswordResetModal user={resetUser} onClose={() => setResetUser(null)} />
      )}
      {deleteUser && (
        <DeleteModal
          user={deleteUser}
          onClose={() => setDeleteUser(null)}
          onDeleted={() => { setDeleteUser(null); fetchUsers(); }}
        />
      )}
    </div>
  );
}
