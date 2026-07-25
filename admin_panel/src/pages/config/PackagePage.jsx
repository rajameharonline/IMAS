import { useEffect, useState, useMemo } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const BILLING_LABELS = { monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half Yearly', yearly: 'Yearly' };

const EMPTY = {
  name: '', speed_name: '', mikrotik_profile: '', ip_pool_name: '',
  price: '', billing_cycle: 'monthly', description: '', is_free: false, is_active: true,
};

/* ── Package Modal ── */
function PackageModal({ pkg, onClose, onSaved }) {
  const isEdit = !!pkg;
  const [form, setForm] = useState(isEdit ? { ...pkg } : { ...EMPTY });
  const [servers, setServers] = useState([]);
  const [selectedServer, setSelectedServer] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [pools, setPools] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/mikrotik/servers/').then(r => {
      const list = r.data.results || r.data;
      setServers(list);
      // edit mode-এ existing router pre-select; নইলে একটাই থাকলে সেটা select
      if (isEdit && pkg.router) setSelectedServer(String(pkg.router));
      else if (list.length === 1) setSelectedServer(String(list[0].id));
    });
  }, []);

  useEffect(() => {
    if (!selectedServer) { setProfiles([]); setPools([]); return; }
    setLoading(true);
    Promise.all([
      api.get(`/mikrotik/servers/${selectedServer}/pppoe-profiles/`).catch(() => ({ data: { profiles: [] } })),
      api.get(`/mikrotik/servers/${selectedServer}/ip-pools/`).catch(() => ({ data: { pools: [] } })),
    ]).then(([profRes, poolRes]) => {
      setProfiles(profRes.data.profiles || []);
      setPools(poolRes.data.pools || []);
    }).finally(() => setLoading(false));
  }, [selectedServer]);

  const set = e => {
    const { name, value, type, checked } = e.target;
    setForm(f => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
  };

  const selectProfile = e => {
    const profileName = e.target.value;
    const prof = profiles.find(p => p.name === profileName);
    const autoPool = prof?.remote_address || '';
    setForm(f => ({ ...f, mikrotik_profile: profileName, ip_pool_name: autoPool || f.ip_pool_name }));
  };

  const save = async e => {
    e.preventDefault(); setSaving(true);
    try {
      const payload = { ...form, router: selectedServer || null };
      if (isEdit) await api.patch(`/config/packages/${pkg.id}/`, payload);
      else await api.post('/config/packages/', payload);
      toast.success(isEdit ? 'Package updated.' : 'Package added.');
      onSaved();
    } catch (err) {
      const data = err.response?.data;
      toast.error(data ? Object.values(data).flat().join(' | ') : 'Failed to save.');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-bold text-gray-800">{isEdit ? 'Edit Package' : 'New Package'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={save} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Package Name <span className="text-red-500">*</span></label>
            <input name="name" value={form.name} onChange={set} required
              className="h-8 w-full border border-gray-300 rounded px-2.5 text-sm text-gray-800 outline-none focus:border-teal-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Package Speed <span className="text-red-500">*</span></label>
            <input name="speed_name" value={form.speed_name} onChange={set} required
              className="h-8 w-full border border-gray-300 rounded px-2.5 text-sm text-gray-800 outline-none focus:border-teal-500"
              placeholder="e.g. 10 Mbps, 20M/10M" />
          </div>

          {/* Mikrotik Settings */}
          <div className="border rounded-lg p-4 space-y-3 bg-gray-50">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-700">Mikrotik Settings</p>
              {loading && <span className="text-xs text-gray-400 animate-pulse">Loading from router...</span>}
            </div>
            {servers.length > 1 && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Select Router</label>
                <select value={selectedServer} onChange={e => setSelectedServer(e.target.value)}
                  className="h-8 w-full border border-gray-300 rounded px-2.5 text-sm text-gray-800 outline-none">
                  <option value="">— Select Router —</option>
                  {servers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.host})</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                PPPoE Profile <span className="text-red-500">*</span>
                {profiles.length > 0 && <span className="text-gray-400 font-normal ml-1">({profiles.length} found)</span>}
              </label>
              {profiles.length > 0 ? (
                <select name="mikrotik_profile" value={form.mikrotik_profile} onChange={selectProfile}
                  className="h-8 w-full border border-gray-300 rounded px-2.5 text-sm text-gray-800 outline-none">
                  <option value="">— Select Profile —</option>
                  {profiles.map(p => (
                    <option key={p.name} value={p.name}>
                      {p.name}{p.rate_limit ? ` · ${p.rate_limit}` : ''}{p.remote_address ? ` · pool: ${p.remote_address}` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input name="mikrotik_profile" value={form.mikrotik_profile} onChange={set}
                  className="h-8 w-full border border-gray-300 rounded px-2.5 text-sm text-gray-800 outline-none"
                  placeholder={selectedServer ? 'No profiles found — type manually' : 'Select a router or type manually'} />
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                RADIUS IP Pool (Framed-Pool)
                {pools.length > 0 && <span className="text-gray-400 font-normal ml-1">({pools.length} found)</span>}
              </label>
              {pools.length > 0 ? (
                <select name="ip_pool_name" value={form.ip_pool_name || ''} onChange={set}
                  className="h-8 w-full border border-gray-300 rounded px-2.5 text-sm text-gray-800 outline-none">
                  <option value="">— Select Pool —</option>
                  {pools.map(p => <option key={p.name} value={p.name}>{p.name} · {p.ranges}</option>)}
                </select>
              ) : (
                <input name="ip_pool_name" value={form.ip_pool_name || ''} onChange={set}
                  className="h-8 w-full border border-gray-300 rounded px-2.5 text-sm text-gray-800 outline-none"
                  placeholder={selectedServer ? 'No pools found — type manually' : 'Select a router or type manually'} />
              )}
              {form.ip_pool_name && (
                <p className="text-xs text-green-600 mt-1">✓ Framed-Pool = "{form.ip_pool_name}"</p>
              )}
              {!form.ip_pool_name && form.mikrotik_profile && (
                <p className="text-xs text-amber-600 mt-1">⚠ No pool — profile name "{form.mikrotik_profile}" used as fallback</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Price (৳) {!form.is_free && <span className="text-red-500">*</span>}
              </label>
              <input name="price" type="number" value={form.is_free ? 0 : form.price} onChange={set}
                required={!form.is_free} disabled={form.is_free}
                className={`h-8 w-full border border-gray-300 rounded px-2.5 text-sm text-gray-800 outline-none ${form.is_free ? 'bg-gray-100 text-gray-400' : ''}`}
                min="0" step="0.01" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Billing Cycle</label>
              <select name="billing_cycle" value={form.billing_cycle} onChange={set}
                className="h-8 w-full border border-gray-300 rounded px-2.5 text-sm text-gray-800 outline-none">
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="half_yearly">Half Yearly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Description</label>
            <textarea name="description" value={form.description} onChange={set} rows={2}
              className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm text-gray-800 outline-none resize-none" />
          </div>

          {/* Free package — কোনো বিল generate হবে না; speed/profile client-ভেদে আলাদা */}
          <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <input type="checkbox" name="is_free" checked={!!form.is_free}
              onChange={(e) => { set(e); if (e.target.checked) setForm(f => ({ ...f, is_free: true, price: 0 })); }}
              className="mt-0.5 w-4 h-4 accent-amber-600" />
            <span className="text-sm text-gray-700">
              <span className="font-semibold text-amber-700">Free Package (no bill)</span>
              <span className="block text-[11px] text-gray-500">টিক দিলে price 0 ও এই package-এর client-দের কোনো মাসিক বিল generate হবে না। Profile (speed) প্রতিটি client-এ আলাদা দেওয়া যায়।</span>
            </span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" name="is_active" checked={form.is_active} onChange={set} className="w-4 h-4 accent-teal-600" />
            <span className="text-sm text-gray-700">Active</span>
          </label>

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving}
              className="flex-1 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded transition-colors disabled:opacity-60">
              {saving ? 'Saving...' : isEdit ? 'Update Package' : 'Add Package'}
            </button>
            <button type="button" onClick={onClose}
              className="py-2 px-5 border border-gray-300 text-gray-600 text-sm font-medium rounded hover:bg-gray-50 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── IP Pool Modal ── */
function IpPoolModal({ servers, onClose }) {
  const [serverId, setServerId] = useState(servers.length === 1 ? String(servers[0].id) : '');
  const [form, setForm] = useState({ pool_name: '', network: '', next_pool: '' });
  const [existingPools, setExistingPools] = useState([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!serverId) return;
    api.get(`/mikrotik/servers/${serverId}/ip-pools/`).then(r => setExistingPools(r.data.pools || [])).catch(() => {});
  }, [serverId]);

  const set = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const create = async e => {
    e.preventDefault();
    if (!serverId) { toast.error('Please select a router.'); return; }
    setCreating(true);
    try {
      const res = await api.post(`/mikrotik/servers/${serverId}/create-ip-pool/`, form);
      toast.success(`IP Pool "${res.data.pool_name}" ${res.data.action === 'created' ? 'created' : 'updated'}. Total IPs: ${res.data.total_ips}`);
      setForm({ pool_name: '', network: '', next_pool: '' });
      api.get(`/mikrotik/servers/${serverId}/ip-pools/`).then(r => setExistingPools(r.data.pools || []));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create IP pool.');
    } finally { setCreating(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-bold text-gray-800">Create Mikrotik IP Pool</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <div className="p-5 space-y-4">
          {servers.length > 1 && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Select Router <span className="text-red-500">*</span></label>
              <select value={serverId} onChange={e => setServerId(e.target.value)}
                className="h-8 w-full border border-gray-300 rounded px-2.5 text-sm text-gray-800 outline-none">
                <option value="">— Select Router —</option>
                {servers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.host})</option>)}
              </select>
            </div>
          )}
          {existingPools.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs font-semibold text-gray-500 mb-2">Existing IP Pools in Mikrotik:</p>
              <div className="space-y-1">
                {existingPools.map(p => (
                  <div key={p.name} className="flex justify-between text-sm px-1">
                    <span className="font-medium text-gray-700">{p.name}</span>
                    <span className="text-gray-500 font-mono text-xs">{p.ranges}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <form onSubmit={create} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Pool Name <span className="text-red-500">*</span></label>
              <input name="pool_name" value={form.pool_name} onChange={set} required
                className="h-8 w-full border border-gray-300 rounded px-2.5 text-sm outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">IP Address (CIDR) <span className="text-red-500">*</span></label>
              <input name="network" value={form.network} onChange={set} required
                className="h-8 w-full border border-gray-300 rounded px-2.5 text-sm font-mono outline-none" placeholder="e.g. 10.10.10.0/24" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Next Pool</label>
              <input name="next_pool" value={form.next_pool} onChange={set}
                className="h-8 w-full border border-gray-300 rounded px-2.5 text-sm outline-none" />
            </div>
            <div className="flex gap-3 pt-1">
              <button type="submit" disabled={creating}
                className="flex-1 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded transition-colors disabled:opacity-60">
                {creating ? 'Creating...' : 'Create IP Pool'}
              </button>
              <button type="button" onClick={onClose}
                className="py-2 px-5 border border-gray-300 text-gray-600 text-sm font-medium rounded hover:bg-gray-50">
                Close
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ── */
export default function PackagePage() {
  const [packages, setPackages] = useState([]);
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [showPool, setShowPool] = useState(false);
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/config/packages/'),
      api.get('/mikrotik/servers/'),
    ]).then(([pkgRes, srvRes]) => {
      setPackages(pkgRes.data.results || pkgRes.data);
      setServers(srvRes.data.results || srvRes.data);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return packages;
    const q = search.toLowerCase();
    return packages.filter(p =>
      p.name?.toLowerCase().includes(q) ||
      p.speed_name?.toLowerCase().includes(q) ||
      p.mikrotik_profile?.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q)
    );
  }, [packages, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const del = async (pkg) => {
    if (!window.confirm(`"${pkg.name}" প্যাকেজটি মুছে ফেলবেন?`)) return;
    try {
      await api.delete(`/config/packages/${pkg.id}/`);
      toast.success('Package deleted.');
      load();
    } catch { toast.error('Failed to delete.'); }
  };

  return (
    <div className="min-h-full bg-gray-100">
      {modal && (
        <PackageModal pkg={modal === 'new' ? null : modal}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />
      )}
      {showPool && <IpPoolModal servers={servers} onClose={() => setShowPool(false)} />}

      {/* ── Page Header ── */}
      <div className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          <span className="font-bold text-gray-800 text-base">Package</span>
          <span className="text-gray-400 text-sm">Configure Package</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">Configuration &gt; Package</span>
          {servers.length > 0 && (
            <button onClick={() => setShowPool(true)}
              className="px-3 py-1.5 border border-teal-600 text-teal-600 text-xs font-semibold rounded hover:bg-teal-50 transition-colors">
              🌐 IP Pool
            </button>
          )}
          <button onClick={() => setModal('new')}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded transition-colors">
            <span className="text-base leading-none">+</span> Package
          </button>
        </div>
      </div>

      {/* ── Table Card ── */}
      <div className="p-6">
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
                placeholder="Search packages..." />
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#1e2d3d] text-white text-xs uppercase">
                  <th className="px-4 py-3 text-center font-semibold w-16">Serial</th>
                  <th className="px-4 py-3 text-left font-semibold">Package Name</th>
                  <th className="px-4 py-3 text-center font-semibold">Package Type</th>
                  <th className="px-4 py-3 text-center font-semibold">Speed</th>
                  <th className="px-4 py-3 text-center font-semibold">Price (৳)</th>
                  <th className="px-4 py-3 text-center font-semibold">IP Pool</th>
                  <th className="px-4 py-3 text-left font-semibold">Router</th>
                  <th className="px-4 py-3 text-left font-semibold">Description</th>
                  <th className="px-4 py-3 text-center font-semibold w-24">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="text-center py-10 text-gray-400">Loading...</td>
                  </tr>
                ) : paginated.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-12 text-gray-400">
                      {search ? 'No packages match your search.' : 'No packages found.'}
                    </td>
                  </tr>
                ) : (
                  paginated.map((pkg, i) => (
                    <tr key={pkg.id} className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${i % 2 === 1 ? 'bg-gray-50/50' : 'bg-white'}`}>
                      <td className="px-4 py-3 text-center text-gray-600 font-medium">
                        {(currentPage - 1) * pageSize + i + 1}
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-800">
                        {pkg.name}
                        {pkg.is_free && (
                          <span className="ml-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 align-middle">FREE · No Bill</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block px-3 py-0.5 rounded text-xs font-bold text-white ${pkg.is_active ? 'bg-green-500' : 'bg-gray-400'}`}>
                          {pkg.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-gray-700 font-mono text-xs">
                        {pkg.speed_name || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center font-semibold text-gray-800">
                        {pkg.price}
                      </td>
                      <td className="px-4 py-3 text-center text-gray-600 text-xs font-mono">
                        {pkg.ip_pool_name || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {pkg.router_name
                          ? <span className="inline-block rounded bg-blue-50 border border-blue-200 px-2 py-0.5 text-[11px] font-semibold text-blue-700">🔌 {pkg.router_name}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate"
                        title={pkg.description || (pkg.mikrotik_profile ? `Profile: ${pkg.mikrotik_profile}` : '')}>
                        {pkg.description || (pkg.mikrotik_profile ? `Profile: ${pkg.mikrotik_profile}` : '—')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => setModal(pkg)}
                            className="w-7 h-7 flex items-center justify-center rounded border border-green-300 bg-green-50 hover:bg-green-100 text-green-600 transition-colors"
                            title="Edit">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button onClick={() => del(pkg)}
                            className="w-7 h-7 flex items-center justify-center rounded border border-red-300 bg-red-50 hover:bg-red-100 text-red-600 transition-colors"
                            title="Delete">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50 text-sm text-gray-500">
            <div>
              {filtered.length === 0 ? 'No entries' : (
                <>Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} entries
                  {search && packages.length !== filtered.length && ` (filtered from ${packages.length} total entries)`}
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
      </div>
    </div>
  );
}
