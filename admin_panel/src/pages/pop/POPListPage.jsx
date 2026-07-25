import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const POP_TYPE_LABELS = { prepaid: 'Prepaid', postpaid: 'Postpaid' };

function StatCard({ icon, label, value, color }) {
  return (
    <div className={`${color} text-white rounded-xl p-5 flex items-center gap-4 shadow`}>
      <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center text-2xl">
        {icon}
      </div>
      <div>
        <div className="text-sm font-semibold leading-tight">{label}</div>
        <div className="text-3xl font-bold leading-tight">{value}</div>
        <div className="text-xs opacity-80 mt-0.5">{label === 'Total POPs' ? 'Total POPs of admin' : label === 'Total POP Client' ? 'Total running client of POPs' : 'Total exported online client of POPs'}</div>
      </div>
    </div>
  );
}

function Toggle({ on, onClick, title }) {
  return (
    <button onClick={onClick} title={title}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${on ? 'bg-blue-600' : 'bg-gray-300'}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

function ActionMenu({ pop, onView, onEdit, onToggleActive, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();

  useEffect(() => {
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)}
        className="w-7 h-7 rounded hover:bg-gray-200 flex items-center justify-center text-gray-600 font-bold">
        ⋮
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-36 bg-white border rounded-lg shadow-lg overflow-hidden text-sm">
          <button onClick={() => { onView(); setOpen(false); }}
            className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700">👁 View Profile</button>
          <button onClick={() => { onEdit(); setOpen(false); }}
            className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700">✎ Edit</button>
          <button onClick={() => { onToggleActive(); setOpen(false); }}
            className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700">
            {pop.is_active ? '⛔ Disable' : '✓ Enable'}
          </button>
          <button onClick={() => { onDelete(); setOpen(false); }}
            className="w-full text-left px-3 py-2 hover:bg-red-50 text-red-600">🗑 Delete</button>
        </div>
      )}
    </div>
  );
}

export default function POPListPage() {
  const navigate = useNavigate();
  const [pops, setPops] = useState([]);
  const [stats, setStats] = useState({ total_pops: 0, total_clients: 0, online_clients: 0 });
  const [loading, setLoading] = useState(true);
  const [perPage, setPerPage] = useState(100);
  const [filters, setFilters] = useState({
    fund_start: '', pop_type: '', is_active: '', is_locked: '',
    client_enabled: '', created_from: '', created_to: '', search: '',
  });

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v && k !== 'fund_start') params.append(k, v); });
    Promise.all([
      api.get(`/pop/pops/?${params}&page_size=500`),
      api.get('/pop/pops/stats/'),
    ]).then(([list, st]) => {
      setPops(list.data.results || list.data);
      setStats(st.data);
    }).finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const setFilter = e => {
    const { name, value } = e.target;
    setFilters(f => ({ ...f, [name]: value }));
  };

  const toggleLock = async pop => {
    await api.post(`/pop/pops/${pop.id}/toggle-lock/`);
    toast.success(pop.is_locked ? 'Unlocked' : 'Locked');
    load();
  };

  const toggleActive = async pop => {
    await api.post(`/pop/pops/${pop.id}/toggle-active/`);
    toast.success(pop.is_active ? 'Deactivated' : 'Activated');
    load();
  };

  const toggleClientEnabled = async pop => {
    await api.patch(`/pop/pops/${pop.id}/`, { client_enabled: !pop.client_enabled });
    toast.success(pop.client_enabled ? 'Client Disabled' : 'Client Enabled');
    load();
  };

  const del = async pop => {
    if (!confirm(`POP "${pop.business_name}" মুছে দিবেন?`)) return;
    try {
      await api.delete(`/pop/pops/${pop.id}/`);
      toast.success('মুছে গেছে');
      load();
    } catch { toast.error('মুছতে ব্যর্থ'); }
  };

  const visible = pops.slice(0, perPage);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <span>POP</span><span>&gt;</span><span>POP List</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">POPs</h1>
          <p className="text-sm text-gray-400">All POPs</p>
        </div>
        <button onClick={() => navigate('/pop/add')}
          className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-full text-sm font-semibold hover:bg-black">
          + POP
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard icon="👥" label="Total POPs" value={stats.total_pops} color="bg-cyan-500" />
        <StatCard icon="👨‍👩‍👦" label="Total POP Client" value={stats.total_clients} color="bg-emerald-500" />
        <StatCard icon="👤✓" label="Online Clients" value={stats.online_clients} color="bg-purple-500" />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border p-4 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Fund Start</label>
            <select name="fund_start" value={filters.fund_start} onChange={setFilter}
              className="w-full border rounded-lg px-2 py-1.5 text-sm">
              <option value="">Select</option>
              <option value="started">Started</option>
              <option value="not_started">Not Started</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">POP Type</label>
            <select name="pop_type" value={filters.pop_type} onChange={setFilter}
              className="w-full border rounded-lg px-2 py-1.5 text-sm">
              <option value="">Select</option>
              <option value="prepaid">Prepaid</option>
              <option value="postpaid">Postpaid</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Login Status</label>
            <select name="is_active" value={filters.is_active} onChange={setFilter}
              className="w-full border rounded-lg px-2 py-1.5 text-sm">
              <option value="">Select</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Client Enabled</label>
            <select name="client_enabled" value={filters.client_enabled} onChange={setFilter}
              className="w-full border rounded-lg px-2 py-1.5 text-sm">
              <option value="">Select</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">POP Status</label>
            <select name="is_locked" value={filters.is_locked} onChange={setFilter}
              className="w-full border rounded-lg px-2 py-1.5 text-sm">
              <option value="">Select</option>
              <option value="false">Active</option>
              <option value="true">Locked</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Creation From</label>
            <input type="text" placeholder="DD-MM-YYYY" name="created_from" value={filters.created_from} onChange={setFilter}
              onFocus={e => e.target.type = 'date'} onBlur={e => { if (!e.target.value) e.target.type = 'text'; }}
              className="w-full border rounded-lg px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Creation To</label>
            <input type="text" placeholder="DD-MM-YYYY" name="created_to" value={filters.created_to} onChange={setFilter}
              onFocus={e => e.target.type = 'date'} onBlur={e => { if (!e.target.value) e.target.type = 'text'; }}
              className="w-full border rounded-lg px-2 py-1.5 text-sm" />
          </div>
          <div />
        </div>
      </div>

      {/* Table card */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        {/* Show / Search */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>SHOW</span>
            <select value={perPage} onChange={e => setPerPage(+e.target.value)}
              className="border rounded px-2 py-1 text-sm">
              {[10,25,50,100].map(n => <option key={n}>{n}</option>)}
            </select>
            <span>ENTRIES</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>SEARCH:</span>
            <input name="search" value={filters.search} onChange={setFilter}
              placeholder="Code, name, mobile..." className="border rounded px-2 py-1 text-sm w-48" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs whitespace-nowrap">
            <thead>
              <tr className="bg-[#1e3a5f] text-white">
                {['Code','POP Name','POP Type','ContactPerson','Server Name','Mobile',
                  'Company Name','Level','TarifName','Clients(Running)','Clients(Enabled)',
                  'Clients(Disabled)','Clients(Left)','RemainingFund','ClientEnabled',
                  'FundStart','IsLocked?','Action'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={18} className="py-12 text-center text-gray-400">লোড হচ্ছে...</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={18} className="py-12 text-center text-gray-400">No data available in table</td></tr>
              ) : visible.map((pop, i) => (
                <tr key={pop.id} className={i % 2 === 0 ? 'bg-white hover:bg-blue-50' : 'bg-gray-50 hover:bg-blue-50'}>
                  <td className="px-3 py-2 font-mono font-bold text-blue-700">
                    <button onClick={() => navigate(`/pop/${pop.id}/profile`)} className="hover:underline">
                      {pop.code}
                    </button>
                  </td>
                  <td className="px-3 py-2 font-medium text-gray-800">
                    <button onClick={() => navigate(`/pop/${pop.id}/profile`)} className="hover:underline text-left">
                      {pop.business_name}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${pop.pop_type === 'prepaid' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                      {POP_TYPE_LABELS[pop.pop_type]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{pop.contact_person}</td>
                  <td className="px-3 py-2 text-gray-600">{pop.server_name || '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{pop.mobile}</td>
                  <td className="px-3 py-2 text-gray-600">{pop.business_name || 'N/A'}</td>
                  <td className="px-3 py-2 text-gray-600">Level {pop.level}</td>
                  <td className="px-3 py-2 text-gray-600">{pop.tariff_name || '—'}</td>
                  <td className="px-3 py-2 text-center text-gray-600">{pop.clients_running}</td>
                  <td className="px-3 py-2 text-center text-gray-600">{pop.clients_enabled}</td>
                  <td className="px-3 py-2 text-center text-gray-600">{pop.clients_disabled}</td>
                  <td className="px-3 py-2 text-center text-gray-600">{pop.clients_left}</td>
                  <td className="px-3 py-2 text-right text-gray-700 font-medium">
                    {Number(pop.remaining_fund || 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Toggle on={!!pop.client_enabled} onClick={() => toggleClientEnabled(pop)} title="Client Enabled" />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Toggle on={Number(pop.fund_start) > 0} onClick={() => {}} title="Fund Start" />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Toggle on={!!pop.is_locked} onClick={() => toggleLock(pop)} title="Is Locked" />
                  </td>
                  <td className="px-3 py-2">
                    <ActionMenu
                      pop={pop}
                      onView={() => navigate(`/pop/${pop.id}/profile`)}
                      onEdit={() => navigate(`/pop/${pop.id}/edit`)}
                      onToggleActive={() => toggleActive(pop)}
                      onDelete={() => del(pop)}
                    />
                  </td>
                </tr>
              ))}
              {/* Totals row */}
              {!loading && visible.length > 0 && (
                <tr className="bg-gray-100 font-semibold text-gray-600 border-t-2">
                  <td className="px-3 py-2" colSpan={9}><strong>Total</strong></td>
                  <td className="px-3 py-2 text-center">{visible.reduce((s, p) => s + (p.clients_running || 0), 0)}</td>
                  <td className="px-3 py-2 text-center">{visible.reduce((s, p) => s + (p.clients_enabled || 0), 0)}</td>
                  <td className="px-3 py-2 text-center">{visible.reduce((s, p) => s + (p.clients_disabled || 0), 0)}</td>
                  <td className="px-3 py-2 text-center">{visible.reduce((s, p) => s + (p.clients_left || 0), 0)}</td>
                  <td className="px-3 py-2" colSpan={4}></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-2.5 text-sm text-gray-500 border-t flex items-center justify-between">
          <span>Showing {visible.length === 0 ? 0 : 1} to {visible.length} of {pops.length} entries</span>
          <div className="flex gap-2">
            <button className="px-3 py-1 text-xs border rounded text-gray-500 hover:bg-gray-100">Previous</button>
            <button className="px-3 py-1 text-xs bg-blue-600 text-white rounded">1</button>
            <button className="px-3 py-1 text-xs border rounded text-gray-500 hover:bg-gray-100">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}
