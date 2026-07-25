import { useEffect, useState, useMemo } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

// ── Mikrotik interface type definitions ───────────────────────────────
const MK_TYPES = [
  {
    value: 'pppoe',
    label: 'PPPoE',
    color: 'bg-blue-500',
    badgeBg: 'bg-blue-100 text-blue-700',
    desc: 'Point-to-Point Protocol over Ethernet — username/password দিয়ে auth হয়',
    radius: true,
  },
  {
    value: 'dhcp',
    label: 'DHCP',
    color: 'bg-green-500',
    badgeBg: 'bg-green-100 text-green-700',
    desc: 'Dynamic Host Configuration Protocol — MAC address বা Option 82 দিয়ে IP বরাদ্দ',
    radius: false,
  },
  {
    value: 'static',
    label: 'Static IP',
    color: 'bg-orange-500',
    badgeBg: 'bg-orange-100 text-orange-700',
    desc: 'Fixed IP address — manually configure করা হয়',
    radius: false,
  },
  {
    value: 'hotspot',
    label: 'Hotspot',
    color: 'bg-purple-500',
    badgeBg: 'bg-purple-100 text-purple-700',
    desc: 'Web-based captive portal — browser দিয়ে login হয়',
    radius: true,
  },
  {
    value: 'other',
    label: 'Other',
    color: 'bg-gray-400',
    badgeBg: 'bg-gray-100 text-gray-600',
    desc: 'অন্যান্য connection পদ্ধতি',
    radius: false,
  },
];

function getMkType(value) {
  return MK_TYPES.find(t => t.value === value) ?? MK_TYPES[4];
}

// ── RADIUS info per type ──────────────────────────────────────────────
const RADIUS_INFO = {
  pppoe: [
    { table: 'radcheck', detail: 'username + Cleartext-Password' },
    { table: 'radusergroup', detail: 'username → package group' },
    { table: 'radgroupreply', detail: 'Mikrotik-Group, Framed-Pool' },
    { table: 'radacct', detail: 'session accounting (login/logout)' },
  ],
  hotspot: [
    { table: 'radcheck', detail: 'username + Cleartext-Password' },
    { table: 'radusergroup', detail: 'username → package group' },
    { table: 'radacct', detail: 'session accounting' },
  ],
  dhcp: [
    { table: 'radcheck', detail: '(optional) MAC-based auth' },
    { table: 'radusergroup', detail: '(optional) group assignment' },
  ],
  static: [],
  other: [],
};

const EMPTY = {
  name: '',
  description: '',
  mikrotik_interface_type: 'pppoe',
  radius_enabled: true,
  is_active: true,
};

// ── Modal ─────────────────────────────────────────────────────────────
function ConnectionTypeModal({ item, onClose, onSaved }) {
  const isEdit = !!item;
  const [form, setForm] = useState(isEdit ? { ...item } : { ...EMPTY });
  const [servers, setServers] = useState([]);
  const [radiusServers, setRadiusServers] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/mikrotik/servers/').then(r => setServers(r.data.results || r.data)).catch(() => {});
    api.get('/radius/servers/').then(r => setRadiusServers(r.data.results || r.data)).catch(() => {});
  }, []);

  const selectedType = getMkType(form.mikrotik_interface_type);
  const radiusInfo = RADIUS_INFO[form.mikrotik_interface_type] ?? [];

  const handleTypeChange = (val) => {
    const t = getMkType(val);
    setForm(f => ({ ...f, mikrotik_interface_type: val, radius_enabled: t.radius }));
  };

  const save = async e => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Connection type নাম দিন'); return; }
    setSaving(true);
    try {
      if (isEdit) await api.patch(`/config/protocol-types/${item.id}/`, form);
      else await api.post('/config/protocol-types/', form);
      toast.success(isEdit ? 'Connection type আপডেট হয়েছে।' : 'Connection type যোগ হয়েছে।');
      onSaved();
    } catch (err) {
      const data = err.response?.data;
      toast.error(data ? Object.values(data).flat().join(' | ') : 'Save করতে ব্যর্থ।');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-[#1e2d3d] rounded-t-xl">
          <div className="flex items-center gap-2">
            <span className="text-white text-base">🔌</span>
            <h2 className="text-sm font-bold text-white">
              {isEdit ? 'Connection Type সম্পাদনা' : 'নতুন Connection Type'}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-300 hover:text-white text-2xl leading-none">&times;</button>
        </div>

        <form onSubmit={save} className="p-5 space-y-4">

          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              Connection Type নাম <span className="text-red-500">*</span>
            </label>
            <input
              value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              required
              className="h-9 w-full border border-gray-300 rounded-lg px-3 text-sm text-gray-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-200"
              placeholder="e.g. PPPoE Broadband, DHCP Home, Static Corporate"
            />
          </div>

          {/* Mikrotik Interface Type */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-4 py-2.5 border-b">
              <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Mikrotik Interface Type</p>
            </div>
            <div className="p-4 space-y-2">
              {MK_TYPES.map(t => (
                <label key={t.value}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${form.mikrotik_interface_type === t.value ? 'border-teal-400 bg-teal-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}>
                  <input type="radio" name="mikrotik_interface_type" value={t.value}
                    checked={form.mikrotik_interface_type === t.value}
                    onChange={() => handleTypeChange(t.value)}
                    className="mt-0.5 accent-teal-600" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${t.color}`} />
                      <span className="text-sm font-semibold text-gray-800">{t.label}</span>
                      {t.radius && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-700 uppercase">RADIUS</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{t.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* RADIUS Configuration */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-4 py-2.5 border-b flex items-center justify-between">
              <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">RADIUS Authentication</p>
              {radiusServers.length > 0 ? (
                <span className="text-[10px] text-green-600 font-semibold">
                  ● {radiusServers.length} server সংযুক্ত
                </span>
              ) : (
                <span className="text-[10px] text-gray-400">কোনো RADIUS server নেই</span>
              )}
            </div>
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="radius_enabled" checked={form.radius_enabled}
                    onChange={() => setForm(f => ({ ...f, radius_enabled: true }))}
                    className="accent-blue-600" />
                  <span className="text-sm font-medium text-gray-700">
                    Enabled
                    <span className="ml-1.5 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">RADIUS</span>
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="radius_enabled" checked={!form.radius_enabled}
                    onChange={() => setForm(f => ({ ...f, radius_enabled: false }))}
                    className="accent-gray-500" />
                  <span className="text-sm font-medium text-gray-700">
                    Disabled
                    <span className="ml-1.5 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600">Local</span>
                  </span>
                </label>
              </div>

              {/* RADIUS tables info */}
              {form.radius_enabled && radiusInfo.length > 0 && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                  <p className="text-[11px] font-bold text-blue-700 mb-2 uppercase tracking-wide">
                    FreeRADIUS Database Tables
                  </p>
                  <div className="space-y-1">
                    {radiusInfo.map((r, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-[10px] font-mono font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded whitespace-nowrap">
                          {r.table}
                        </span>
                        <span className="text-[11px] text-blue-700">{r.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {form.radius_enabled && radiusInfo.length === 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs text-amber-700">
                    ⚠ এই connection type-এ RADIUS সাধারণত ব্যবহার হয় না। নিশ্চিত হয়ে Enabled করুন।
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Mikrotik Servers status */}
          {servers.length > 0 && (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-2.5 border-b">
                <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                  Mikrotik Routers ({servers.length})
                </p>
              </div>
              <div className="px-4 py-3 flex flex-wrap gap-2">
                {servers.map(s => (
                  <div key={s.id}
                    className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-xs font-semibold text-gray-700">{s.name}</span>
                    <span className="text-[10px] text-gray-400 font-mono">{s.host}</span>
                  </div>
                ))}
              </div>
              <div className="px-4 pb-3">
                <p className="text-[11px] text-gray-400">
                  {selectedType.label} interface type Mikrotik-এ{' '}
                  {form.mikrotik_interface_type === 'pppoe' && 'PPP → PPPoE Servers থেকে পরিচালিত হয়'}
                  {form.mikrotik_interface_type === 'dhcp' && 'IP → DHCP Server থেকে পরিচালিত হয়'}
                  {form.mikrotik_interface_type === 'static' && 'IP → Addresses থেকে manually set হয়'}
                  {form.mikrotik_interface_type === 'hotspot' && 'IP → Hotspot → Servers থেকে পরিচালিত হয়'}
                  {form.mikrotik_interface_type === 'other' && 'manually configured হয়'}
                </p>
              </div>
            </div>
          )}

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">বিবরণ (ঐচ্ছিক)</label>
            <textarea
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-200 resize-none"
              placeholder="Connection type সম্পর্কে বিস্তারিত..."
            />
          </div>

          {/* Active status */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_active}
              onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
              className="w-4 h-4 accent-teal-600" />
            <span className="text-sm text-gray-700">Active (ক্লায়েন্ট তৈরিতে ব্যবহারযোগ্য)</span>
          </label>

          {/* Buttons */}
          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60">
              {saving ? 'সংরক্ষণ হচ্ছে...' : isEdit ? 'Connection Type আপডেট করুন' : 'Connection Type যোগ করুন'}
            </button>
            <button type="button" onClick={onClose}
              className="py-2.5 px-5 border border-gray-300 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
              বাতিল
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────
export default function ConnectionTypePage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | 'new' | {item object}
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  const load = () => {
    setLoading(true);
    api.get('/config/protocol-types/')
      .then(r => setItems(r.data.results || r.data))
      .catch(() => toast.error('Connection type লোড করতে ব্যর্থ।'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(it =>
      it.name?.toLowerCase().includes(q) ||
      it.mikrotik_interface_type?.toLowerCase().includes(q) ||
      it.description?.toLowerCase().includes(q)
    );
  }, [items, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const del = async (it) => {
    if (!window.confirm(`"${it.name}" মুছে ফেলবেন?`)) return;
    try {
      await api.delete(`/config/protocol-types/${it.id}/`);
      toast.success('মুছে ফেলা হয়েছে।');
      load();
    } catch { toast.error('মুছতে ব্যর্থ — ক্লায়েন্টে ব্যবহৃত থাকলে মুছা যাবে না।'); }
  };

  const toggleActive = async (it) => {
    try {
      await api.patch(`/config/protocol-types/${it.id}/`, { is_active: !it.is_active });
      toast.success(it.is_active ? 'Inactive করা হয়েছে।' : 'Active করা হয়েছে।');
      load();
    } catch { toast.error('আপডেট করতে ব্যর্থ।'); }
  };

  return (
    <div className="min-h-full bg-gray-100">
      {modal && (
        <ConnectionTypeModal
          item={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}

      {/* ── Page Header ── */}
      <div className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className="font-bold text-gray-800 text-base">Connection Type</span>
          <span className="text-gray-400 text-sm">Mikrotik ও RADIUS কনফিগারেশন</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">Configuration &gt; Connection Type</span>
          <button onClick={() => setModal('new')}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded transition-colors">
            <span className="text-base leading-none">+</span> Connection Type
          </button>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="px-6 pt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {MK_TYPES.slice(0, 4).map(t => {
          const count = items.filter(it => it.mikrotik_interface_type === t.value).length;
          return (
            <div key={t.value} className="bg-white rounded-lg shadow-sm px-4 py-3 flex items-center gap-3">
              <span className={`w-3 h-3 rounded-full ${t.color} flex-shrink-0`} />
              <div>
                <p className="text-xs text-gray-500">{t.label}</p>
                <p className="text-lg font-bold text-gray-800">{count}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Table Card ── */}
      <div className="p-6 pt-4">
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">

          {/* Controls */}
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span>SHOW</span>
              <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="border border-gray-300 rounded px-2 py-0.5 text-sm outline-none">
                {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <span>ENTRIES</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span>SEARCH:</span>
              <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="border border-gray-300 rounded px-2.5 py-1 text-sm outline-none w-44 focus:border-teal-500"
                placeholder="Search..." />
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#1e2d3d] text-white text-xs uppercase">
                  <th className="px-4 py-3 text-center font-semibold w-16">Serial</th>
                  <th className="px-4 py-3 text-left font-semibold">Connection Type</th>
                  <th className="px-4 py-3 text-center font-semibold">Mikrotik Type</th>
                  <th className="px-4 py-3 text-center font-semibold">RADIUS Auth</th>
                  <th className="px-4 py-3 text-center font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">বিবরণ</th>
                  <th className="px-4 py-3 text-center font-semibold w-28">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="text-center py-10 text-gray-400">লোড হচ্ছে...</td>
                  </tr>
                ) : paginated.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-gray-400">
                      {search ? 'কোনো ফলাফল নেই।' : 'কোনো connection type নেই।'}
                    </td>
                  </tr>
                ) : (
                  paginated.map((it, i) => {
                    const t = getMkType(it.mikrotik_interface_type);
                    return (
                      <tr key={it.id}
                        className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${i % 2 === 1 ? 'bg-gray-50/50' : 'bg-white'}`}>
                        <td className="px-4 py-3 text-center text-gray-500 font-medium">
                          {(currentPage - 1) * pageSize + i + 1}
                        </td>
                        <td className="px-4 py-3 font-semibold text-gray-800">{it.name}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${t.badgeBg}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${t.color}`} />
                            {t.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {it.radius_enabled ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-700">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                              RADIUS
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-500">
                              <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                              Local
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button onClick={() => toggleActive(it)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold transition-opacity hover:opacity-80 ${it.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${it.is_active ? 'bg-green-500' : 'bg-red-500'}`} />
                            {it.is_active ? 'Active' : 'Inactive'}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate" title={it.description || ''}>
                          {it.description || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-2">
                            <button onClick={() => setModal(it)}
                              className="w-7 h-7 flex items-center justify-center rounded border border-green-300 bg-green-50 hover:bg-green-100 text-green-600 transition-colors"
                              title="Edit">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button onClick={() => del(it)}
                              className="w-7 h-7 flex items-center justify-center rounded border border-red-300 bg-red-50 hover:bg-red-100 text-red-600 transition-colors"
                              title="Delete">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Footer / Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50 text-sm text-gray-500">
            <div>
              {filtered.length === 0 ? 'কোনো এন্ট্রি নেই' : (
                <>
                  Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} entries
                  {search && items.length !== filtered.length && ` (filtered from ${items.length} total)`}
                </>
              )}
            </div>
            <div className="flex items-center gap-1">
              {[
                { label: 'First', action: () => setPage(1), disabled: currentPage === 1 },
                { label: 'Previous', action: () => setPage(p => Math.max(1, p - 1)), disabled: currentPage === 1 },
              ].map(btn => (
                <button key={btn.label} onClick={btn.action} disabled={btn.disabled}
                  className="px-3 py-1 border border-gray-300 rounded text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors">
                  {btn.label}
                </button>
              ))}
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
                const pg = start + i;
                if (pg > totalPages) return null;
                return (
                  <button key={pg} onClick={() => setPage(pg)}
                    className={`px-3 py-1 border rounded text-xs font-medium transition-colors ${pg === currentPage ? 'bg-teal-600 border-teal-600 text-white' : 'border-gray-300 hover:bg-gray-100'}`}>
                    {pg}
                  </button>
                );
              })}
              {[
                { label: 'Next', action: () => setPage(p => Math.min(totalPages, p + 1)), disabled: currentPage === totalPages },
                { label: 'Last', action: () => setPage(totalPages), disabled: currentPage === totalPages },
              ].map(btn => (
                <button key={btn.label} onClick={btn.action} disabled={btn.disabled}
                  className="px-3 py-1 border border-gray-300 rounded text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 transition-colors">
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── RADIUS Integration Info Card ── */}
        <div className="mt-4 bg-white rounded-lg shadow-sm p-4">
          <p className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-3">
            FreeRADIUS Integration Overview
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Object.entries(RADIUS_INFO).filter(([, v]) => v.length > 0).map(([type, tables]) => {
              const t = getMkType(type);
              return (
                <div key={type} className={`border rounded-lg p-3 ${t.badgeBg.includes('blue') ? 'border-blue-200 bg-blue-50' : t.badgeBg.includes('purple') ? 'border-purple-200 bg-purple-50' : 'border-gray-200'}`}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className={`w-2 h-2 rounded-full ${t.color}`} />
                    <span className="text-xs font-bold text-gray-800">{t.label}</span>
                    <span className="text-[10px] font-bold text-blue-600 bg-blue-100 px-1.5 rounded uppercase">RADIUS</span>
                  </div>
                  <div className="space-y-1">
                    {tables.map((r, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <code className="text-[10px] font-mono bg-white border border-gray-200 px-1.5 py-0.5 rounded text-gray-700">
                          {r.table}
                        </code>
                        <span className="text-[11px] text-gray-600">{r.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
