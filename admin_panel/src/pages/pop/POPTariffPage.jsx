import { useEffect, useState } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

/* ── Tariff Items Editor ─────────────────────────────────────────────────── */
function TariffItemsEditor({ tariffId, items, packages, servers, onItemsChange }) {
  const EMPTY = { package: '', server: '', rate: '', validity_days: 30, min_activation_days: 1 };
  const [row, setRow]     = useState({ ...EMPTY });
  const [adding, setAdding] = useState(false);

  const setR = e => setRow(r => ({ ...r, [e.target.name]: e.target.value }));

  const addItem = async () => {
    if (!row.package || !row.rate) return toast.error('Package ও Rate দিন');
    setAdding(true);
    try {
      const res = await api.post(`/pop/tariffs/${tariffId}/add-item/`, {
        package: row.package,
        server: row.server || null,
        rate: row.rate,
        validity_days: row.validity_days,
        min_activation_days: row.min_activation_days,
      });
      onItemsChange([...items, res.data]);
      setRow({ ...EMPTY });
      toast.success('Successfully added a new package for this tariff.');
    } catch { toast.error('আইটেম যোগ ব্যর্থ'); }
    finally { setAdding(false); }
  };

  const removeItem = async id => {
    await api.delete(`/pop/tariffs/${tariffId}/remove-item/${id}/`);
    onItemsChange(items.filter(i => i.id !== id));
    toast.success('সরানো হয়েছে');
  };

  return (
    <div className="mt-2">
      {/* Field labels */}
      <div className="hidden md:grid grid-cols-5 gap-2 mb-1">
        {['PACKAGE NAME','PACKAGE RATE','PACKAGE VALIDITY DAYS','PACKAGE MINIMUM ACTIVATION DAYS','SERVER NAME'].map(l => (
          <span key={l} className="text-xs font-semibold text-gray-500 uppercase">{l}</span>
        ))}
      </div>
      {/* Input row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2 mb-3">
        <select name="package" value={row.package} onChange={setR}
          className="border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400">
          <option value="">Select</option>
          {packages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input name="rate" type="number" value={row.rate} onChange={setR}
          placeholder="0" className="border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
        <input name="validity_days" type="number" value={row.validity_days} onChange={setR}
          className="border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
        <input name="min_activation_days" type="number" value={row.min_activation_days} onChange={setR}
          className="border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
        <select name="server" value={row.server} onChange={setR}
          className="border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400">
          <option value="">Select</option>
          {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <button onClick={addItem} disabled={adding}
        className="mb-4 px-5 py-1.5 bg-green-500 text-white text-sm font-semibold rounded-lg hover:bg-green-600 disabled:opacity-60">
        {adding ? 'যোগ হচ্ছে...' : 'Add Package'}
      </button>

      {/* Items table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-100">
              {['Sr. No.','Package','Server','Protocol','Profile','Rate','Validity Days','Minimum Activation Days','Action'].map(h => (
                <th key={h} className="border px-2 py-2 text-left text-gray-600 font-semibold whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={9} className="border px-2 py-4 text-center text-gray-400">কোনো আইটেম নেই</td></tr>
            ) : items.map((item, i) => (
              <tr key={item.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="border px-2 py-1.5">{i + 1}</td>
                <td className="border px-2 py-1.5">{item.package_name}</td>
                <td className="border px-2 py-1.5">{item.server_name || '—'}</td>
                <td className="border px-2 py-1.5">{item.protocol || 'pppoe'}</td>
                <td className="border px-2 py-1.5">{item.profile || item.package_name}</td>
                <td className="border px-2 py-1.5">{item.rate}</td>
                <td className="border px-2 py-1.5">{item.validity_days}</td>
                <td className="border px-2 py-1.5 text-center">{item.min_activation_days}</td>
                <td className="border px-2 py-1.5">
                  <div className="flex gap-1">
                    <button className="w-6 h-6 bg-blue-500 text-white rounded text-xs flex items-center justify-center hover:bg-blue-600" title="Edit">✎</button>
                    <button onClick={() => removeItem(item.id)}
                      className="w-6 h-6 bg-red-500 text-white rounded text-xs flex items-center justify-center hover:bg-red-600" title="Delete">✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Tariff Modal ───────────────────────────────────────────────────────── */
function TariffModal({ tariff, packages, servers, onClose, onSaved }) {
  const isEdit = !!tariff;
  const [form, setForm]     = useState({ tariff_type: tariff?.tariff_type || 'custom', name: tariff?.name || '' });
  const [items, setItems]   = useState(tariff?.items || []);
  const [savedId, setSavedId] = useState(tariff?.id || null);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const set = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const saveHeader = async () => {
    if (!form.name) return toast.error('Tariff Name দিন');
    setSaving(true);
    try {
      let res;
      if (savedId) {
        res = await api.put(`/pop/tariffs/${savedId}/`, form);
        toast.success('আপডেট হয়েছে');
      } else {
        res = await api.post('/pop/tariffs/', form);
        setSavedId(res.data.id);
        toast.success('Tariff তৈরি হয়েছে — এখন Package যোগ করুন');
      }
      onSaved();
    } catch { toast.error('সংরক্ষণ ব্যর্থ'); }
    finally { setSaving(false); }
  };

  const handleItemsChange = newItems => {
    setItems(newItems);
    if (newItems.length > items.length)
      setSuccessMsg('Successfully added a new package for this tariff.');
    else setSuccessMsg('');
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl mx-4 max-h-[92vh] flex flex-col">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h2 className="text-lg font-bold text-gray-800">{isEdit ? 'Edit Tariff' : 'Add Tariff'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {/* Success toast inside modal */}
          {successMsg && (
            <div className="mb-4 rounded-lg bg-green-500 text-white text-sm font-semibold text-center py-2.5 px-4">
              {successMsg}
            </div>
          )}

          {/* Tariff Type */}
          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">
              TARIFF TYPE <span className="text-red-500">*</span>
              <span className="ml-1 text-gray-400 cursor-help" title="Choose tariff billing type">ℹ</span>
            </label>
            <div className="flex gap-8">
              {[['custom','Custom'],['date_to_date','Date To Date']].map(([val, lbl]) => (
                <label key={val} className="flex items-center gap-2 cursor-pointer">
                  <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${form.tariff_type === val ? 'border-orange-500' : 'border-gray-300'}`}>
                    {form.tariff_type === val && <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />}
                  </span>
                  <input type="radio" name="tariff_type" value={val}
                    checked={form.tariff_type === val} onChange={set} className="hidden" />
                  <span className="text-sm text-gray-700">{lbl}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Tariff Name */}
          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">TARIFF NAME</label>
            <input name="name" value={form.name} onChange={set}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="Tariff" />
          </div>

          {/* Items editor — only after header saved */}
          {savedId ? (
            <TariffItemsEditor
              tariffId={savedId} items={items} packages={packages}
              servers={servers} onItemsChange={handleItemsChange}
            />
          ) : (
            <p className="text-xs text-gray-400 italic mb-4">Tariff header সেভ করুন, তারপর Package যোগ করতে পারবেন।</p>
          )}
        </div>

        {/* Footer buttons — স্ক্রিনশট অনুযায়ী Cancel (red, left) + Save (right) */}
        <div className="flex items-center justify-between px-6 py-4 border-t shrink-0 bg-gray-50 rounded-b-xl">
          <button onClick={onClose}
            className="px-6 py-2 bg-red-500 text-white rounded-lg text-sm font-semibold hover:bg-red-600">
            Cancel
          </button>
          <button onClick={saveHeader} disabled={saving}
            className="flex items-center gap-2 px-6 py-2 border-2 border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-100 disabled:opacity-60 bg-white">
            {saving ? 'Saving...' : (
              <>
                <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Save
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main List Page ──────────────────────────────────────────────────────── */
export default function POPTariffPage() {
  const [tariffs, setTariffs]   = useState([]);
  const [packages, setPackages] = useState([]);
  const [servers, setServers]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [modal, setModal]       = useState(null);
  const [search, setSearch]     = useState('');
  const [perPage, setPerPage]   = useState(100);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/pop/tariffs/?page_size=500'),
      api.get('/pop/packages/?page_size=500'),
      api.get('/mikrotik/servers/?page_size=500'),
    ]).then(([t, p, s]) => {
      setTariffs(t.data.results || t.data);
      setPackages(p.data.results || p.data);
      setServers(s.data.results || s.data);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const del = async t => {
    if (!confirm(`"${t.name}" মুছে দিবেন?`)) return;
    try {
      await api.delete(`/pop/tariffs/${t.id}/`);
      toast.success('মুছে গেছে');
      load();
    } catch { toast.error('মুছতে ব্যর্থ'); }
  };

  const filtered = tariffs.filter(t =>
    !search || t.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <span>POP</span><span>&gt;</span><span>Tariff Config</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">POP Tariffs</h1>
          <p className="text-sm text-gray-400">POP Tariff Config</p>
        </div>
        <button onClick={() => setModal('add')}
          className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800">
          + Add Tariff
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        {/* Show / Search row */}
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
            <input value={search} onChange={e => setSearch(e.target.value)}
              className="border rounded px-2 py-1 text-sm w-40 focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="Search..." />
          </div>
        </div>

        <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead>
            <tr className="bg-[#1e3a5f] text-white">
              {['S/N','Tariff Name','Assigned POPs','Packages','Servers','Profiles','CreatedOn','CreatedBy','DeletedPackageInfo','Action'].map(h => (
                <th key={h} className="px-3 py-3 text-left font-semibold text-xs whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="py-12 text-center text-gray-400">লোড হচ্ছে...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={10} className="py-12 text-center text-gray-400">No data available in table</td></tr>
            ) : filtered.slice(0, perPage).map((t, i) => (
              <tr key={t.id} className={i % 2 === 0 ? 'bg-white hover:bg-blue-50' : 'bg-gray-50 hover:bg-blue-50'}>
                <td className="px-3 py-2.5">{i + 1}</td>
                <td className="px-3 py-2.5 font-medium text-gray-800">{t.name}</td>
                <td className="px-3 py-2.5 text-gray-600 text-center">{t.pop_count ?? 0}</td>
                <td className="px-3 py-2.5 text-gray-600">{t.package_names || '—'}</td>
                <td className="px-3 py-2.5 text-gray-600">{t.server_names || '—'}</td>
                <td className="px-3 py-2.5 text-gray-600">{t.profile_names || '—'}</td>
                <td className="px-3 py-2.5 text-gray-500 text-xs whitespace-nowrap">{t.created_at?.slice(0,10)}</td>
                <td className="px-3 py-2.5 text-gray-600">{t.created_by_name || '—'}</td>
                <td className="px-3 py-2.5 text-gray-400">—</td>
                <td className="px-3 py-2.5">
                  <div className="flex gap-1">
                    {/* Sync / Copy / View / Edit / Delete icon buttons */}
                    <ActionBtn color="bg-teal-500 hover:bg-teal-600" title="Sync" icon="↻" />
                    <ActionBtn color="bg-cyan-500 hover:bg-cyan-600" title="Copy" icon="⧉" />
                    <ActionBtn color="bg-blue-500 hover:bg-blue-600" title="View" icon="👁" onClick={() => {}} />
                    <ActionBtn color="bg-yellow-500 hover:bg-yellow-600" title="Edit" icon="✎" onClick={() => setModal(t)} />
                    <ActionBtn color="bg-red-500 hover:bg-red-600" title="Delete" icon="✕" onClick={() => del(t)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        <div className="px-4 py-2.5 text-sm text-gray-500 border-t flex items-center justify-between">
          <span>Showing {Math.min(1, filtered.length)} to {Math.min(perPage, filtered.length)} of {filtered.length} entries</span>
          <div className="flex gap-2">
            <button className="px-3 py-1 text-xs border rounded text-gray-500 hover:bg-gray-100">Previous</button>
            <button className="px-3 py-1 text-xs bg-blue-600 text-white rounded">1</button>
            <button className="px-3 py-1 text-xs border rounded text-gray-500 hover:bg-gray-100">Next</button>
          </div>
        </div>
      </div>

      {modal && (
        <TariffModal
          tariff={modal === 'add' ? null : modal}
          packages={packages}
          servers={servers}
          onClose={() => setModal(null)}
          onSaved={() => load()}
        />
      )}
    </div>
  );
}

function ActionBtn({ color, title, icon, onClick }) {
  return (
    <button onClick={onClick}
      className={`w-6 h-6 ${color} text-white rounded text-xs flex items-center justify-center`}
      title={title}>
      {icon}
    </button>
  );
}
