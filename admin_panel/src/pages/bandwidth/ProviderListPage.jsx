// Bandwidth Provider master list.
// কেন custom page: provider master শুধু টেবিল না, create/edit modal + detail drilldown
// দরকার; generic list page হলে ওই workflow ভেঙে যাবে।

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { SquarePen, Plus, Trash2, Eye, RefreshCw, Image, Building2, ChevronDown } from 'lucide-react';
import api from '../../utils/api';
import { asList, money } from './bandwidthHelpers';

const EMPTY = {
  name: '',
  contact_person: '',
  email: '',
  phone_number: '',
  mobile_number: '',
  facebook_url: '',
  skype_id: '',
  website: '',
  account_name: '',
  account_number: '',
  bank_name: '',
  account_details: '',
  address: '',
  is_active: true,
  logo_file: null,
};

const PROVIDER_TABLE_COLUMNS = [
  '8%',
  '19%',
  '12%',
  '16%',
  '12%',
  '10%',
  '11%',
  '12%',
];

function StatBox({ label, value, sub, onClick, tone = 'blue' }) {
  const toneMap = {
    blue: 'bg-gradient-to-br from-sky-500 to-cyan-600',
    green: 'bg-gradient-to-br from-teal-500 to-emerald-600',
    purple: 'bg-gradient-to-br from-violet-500 to-indigo-600',
    slate: 'bg-gradient-to-br from-slate-500 to-slate-600',
  };

  return (
    <button
      onClick={onClick}
      className={`text-left rounded-[5px] p-4 text-white shadow-sm transition-transform hover:-translate-y-[1px] hover:shadow-md ${toneMap[tone] || toneMap.blue}`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-white/95">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
      <p className="text-[11px] text-white/80 mt-1">{sub}</p>
    </button>
  );
}

function Modal({ open, title, onClose, children, footer }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
      <div className="w-full max-w-[760px] max-h-[92vh] overflow-auto rounded-sm bg-white shadow-[0_8px_30px_rgba(15,23,42,0.28)]">
        <div className="flex items-center justify-between px-8 py-5">
          <h3 className="text-[22px] font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-2xl leading-none text-rose-300 hover:text-rose-400">×</button>
        </div>
        <div className="px-8 pb-6">{children}</div>
        {footer && <div className="px-8 pb-6">{footer}</div>}
      </div>
    </div>
  );
}

/* ── Mobile Provider Card ── */
function MobileProviderCard({ p, idx, navigate, openEdit, handleDelete }) {
  const isEven = idx % 2 === 0;
  const FRow = ({ label, children }) => (
    <div className="flex items-stretch border-b border-gray-200 last:border-0">
      <div className="w-28 shrink-0 bg-gray-50 px-3 py-2.5 flex items-center border-r border-gray-200">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex-1 min-w-0 px-3 py-2.5 flex items-center justify-end bg-white">
        <div className="min-w-0 truncate">{children}</div>
      </div>
    </div>
  );
  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${isEven ? 'bg-white border-gray-200' : 'bg-slate-50/40 border-gray-200'}`}>
      <div className="flex items-center gap-3 px-3 py-2.5 bg-[#23445f]/5 border-b border-gray-200">
        <button onClick={() => navigate(`/bandwidth/buy/providers/${p.id}`)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100">
          {p.logo_url
            ? <img src={p.logo_url} alt={p.name} className="h-full w-full rounded-full object-cover" />
            : <Building2 className="h-6 w-6 text-slate-300" />}
        </button>
        <div className="flex-1 min-w-0">
          <button onClick={() => navigate(`/bandwidth/buy/providers/${p.id}`)}
            className="font-bold text-[13px] text-gray-900 hover:underline truncate block">{p.name}</button>
        </div>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold ${p.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          {p.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>
      <div>
        <FRow label="Contact"><span className="text-[12px] text-gray-700">{p.contact_person || '—'}</span></FRow>
        <FRow label="Mobile"><span className="text-[12px] text-gray-700">{p.mobile_number || p.phone_number || '—'}</span></FRow>
        <FRow label="Email"><span className="text-[12px] text-gray-700 truncate">{p.email || '—'}</span></FRow>
        <FRow label="Balance Due">
          <span className="font-mono text-[12px] font-bold text-rose-600">৳ {money(p.current_due)}</span>
        </FRow>
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50/60 border-t border-gray-200">
        <button onClick={() => navigate(`/bandwidth/buy/providers/${p.id}`)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-sky-50 text-sky-600 border border-sky-200 hover:bg-sky-100">View</button>
        <button onClick={() => openEdit(p)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100">Edit</button>
        <button onClick={() => handleDelete(p)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100">Delete</button>
      </div>
    </div>
  );
}

export default function ProviderListPage() {
  const navigate = useNavigate();
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(true);
  const [pageSize, setPageSize] = useState(10);
  const [filters, setFilters] = useState({
    search: '',
    status: '',
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [logoPreview, setLogoPreview] = useState('');

  const fetchProviders = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/purchase/providers/?page_size=500');
      setProviders(asList(data));
    } catch {
      toast.error('Provider list লোড করা যায়নি।');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchProviders(); }, []);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return providers.filter((p) => {
      const searchMatch = !q || [
        p.name, p.contact_person, p.email, p.mobile_number, p.phone_number, p.address,
      ].some((v) => String(v || '').toLowerCase().includes(q));
      const statusMatch = !filters.status
        ? true
        : filters.status === 'active'
          ? !!p.is_active
          : !p.is_active;
      return searchMatch && statusMatch;
    });
  }, [providers, filters]);

  const summary = useMemo(() => ({
    total: providers.length,
    active: providers.filter((p) => p.is_active).length,
    due: providers.reduce((sum, p) => sum + Number(p.current_due || 0), 0),
    bills: providers.reduce((sum, p) => sum + Number(p.bill_count || 0), 0),
  }), [providers]);

  const visible = useMemo(() => filtered.slice(0, pageSize), [filtered, pageSize]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setLogoPreview('');
    setModalOpen(true);
  };

  const openEdit = (provider) => {
    setEditing(provider);
    setForm({
      name: provider.name || '',
      contact_person: provider.contact_person || '',
      email: provider.email || '',
      phone_number: provider.phone_number || '',
      mobile_number: provider.mobile_number || '',
      facebook_url: provider.facebook_url || '',
      skype_id: provider.skype_id || '',
      website: provider.website || '',
      account_name: provider.account_name || '',
      account_number: provider.account_number || '',
      bank_name: provider.bank_name || '',
      account_details: provider.account_details || '',
      address: provider.address || '',
      is_active: provider.is_active ?? true,
      logo_file: null,
    });
    setLogoPreview(provider.logo_url || '');
    setModalOpen(true);
  };

  const handleClear = () => {
    // Sample-এর Clear button-এর মতো form reset করছি।
    // create/edit mode দুটোতেই একটাই আচরণ রাখলে UI predictable থাকে।
    setEditing(null);
    setForm(EMPTY);
    setLogoPreview('');
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = new FormData();
      Object.entries(form).forEach(([key, value]) => {
        if (key === 'logo_file') {
          if (value) payload.append('logo', value);
          return;
        }
        if (value !== null && value !== undefined && value !== '') {
          payload.append(key, value);
        }
      });
      if (editing) {
        await api.patch(`/purchase/providers/${editing.id}/`, payload);
        toast.success('Provider updated.');
      } else {
        await api.post('/purchase/providers/', payload);
        toast.success('Provider created.');
      }
      setModalOpen(false);
      fetchProviders();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (provider) => {
    if (!confirm(`Delete ${provider.name}?`)) return;
    try {
      await api.delete(`/purchase/providers/${provider.id}/`);
      toast.success('Deleted.');
      fetchProviders();
    } catch {
      toast.error('Delete failed.');
    }
  };

  return (
      <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-bold text-slate-900">Provider</h1>
          <p className="text-xs text-slate-500">Provider List</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchProviders} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-[#173d59] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:brightness-110">
            <Plus className="h-4 w-4" /> Provider
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <StatBox tone="blue" label="Total Provider" value={summary.total} sub="All provider accounts" onClick={() => setFilters((prev) => ({ ...prev, search: '' }))} />
        <StatBox tone="green" label="Active" value={summary.active} sub="Enabled provider records" onClick={() => setFilters((prev) => ({ ...prev, status: 'active' }))} />
        <StatBox tone="purple" label="Current Due" value={`৳ ${money(summary.due)}`} sub="Aggregate provider due" onClick={() => navigate('/bandwidth/buy/bills?status=due')} />
        <StatBox tone="slate" label="Total Bills" value={summary.bills} sub="All provider invoices" onClick={() => navigate('/bandwidth/buy/bills')} />
      </div>

      <div className="rounded-[4px] border border-slate-200 bg-white shadow-sm">
        <div className="flex justify-center px-4 pt-4">
          <button
            onClick={() => setShowFilters((prev) => !prev)}
            className="inline-flex items-center gap-2 rounded-full bg-[#173d59] px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110"
          >
            Show
            <ChevronDown className={`h-4 w-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 gap-4 px-4 pt-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-[12px] font-semibold uppercase tracking-wide text-slate-500">Search</span>
              <input
                value={filters.search}
                onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                placeholder="Search provider..."
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/20"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-[12px] font-semibold uppercase tracking-wide text-slate-500">Status</span>
              <select
                value={filters.status}
                onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/20"
              >
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          </div>
        )}

        <div className="flex items-center justify-between gap-4 px-4 pt-4">
          <div className="flex items-center gap-2 text-[12px] uppercase text-slate-500">
            <span>Show</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
            <span>entries</span>
          </div>
        </div>

        {loading ? (
          <div className="py-16 text-center text-slate-400 text-sm">লোড হচ্ছে...</div>
        ) : (
          <>
          <div className="md:hidden space-y-2 p-3">
            {visible.length === 0
              ? <p className="text-center py-8 text-slate-400 text-sm">No provider found.</p>
              : visible.map((p, idx) => (
                  <MobileProviderCard key={p.id} p={p} idx={idx}
                    navigate={navigate} openEdit={openEdit} handleDelete={handleDelete} />
                ))}
          </div>
          <div className="hidden md:block overflow-x-auto px-4 pb-4 pt-4">
            <table className="w-full table-fixed border-collapse border border-slate-300 text-sm">
              <colgroup>
                {PROVIDER_TABLE_COLUMNS.map((width, index) => (
                  // বাংলায় মন্তব্য:
                  // প্রতিটি কলামের width fixed রাখছি, যাতে header/body/footer
                  // একই grid-এ থাকে এবং sample-এর মতো পুরো টেবিলটা ভেঙে না যায়।
                  <col key={width + index} style={{ width }} />
                ))}
              </colgroup>
              <thead className="bg-[#23445f] text-white">
                <tr>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Logo</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Company</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Contact Person</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Email</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Mobile Number</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Balance Due</th>
                  <th className="px-4 py-3 text-center whitespace-nowrap">Status</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Action</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id} className="border-b hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center">
                        <button onClick={() => navigate(`/bandwidth/buy/providers/${p.id}`)} className="flex h-[58px] w-[58px] items-center justify-center rounded-full bg-slate-100">
                          {p.logo_url ? <img src={p.logo_url} alt={p.name} className="h-full w-full rounded-full object-cover" /> : <Building2 className="h-10 w-10 text-slate-300" />}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center truncate">
                      <button onClick={() => navigate(`/bandwidth/buy/providers/${p.id}`)} className="font-normal text-slate-900 hover:underline">
                        {p.name}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center truncate">{p.contact_person || '—'}</td>
                    <td className="px-4 py-3 text-center truncate">{p.email || '—'}</td>
                    <td className="px-4 py-3 text-center truncate">{p.mobile_number || p.phone_number || '—'}</td>
                    <td className="px-4 py-3 text-center font-medium whitespace-nowrap">৳ {money(p.current_due)}</td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${p.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {p.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-1 py-3 text-center whitespace-nowrap overflow-hidden">
                      <div className="flex w-full items-center justify-center gap-0.5 overflow-hidden">
                        <button onClick={() => navigate(`/bandwidth/buy/providers/${p.id}`)} className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-sky-500 hover:text-sky-600" title="View">
                          <Eye className="h-4 w-4" />
                        </button>
                        <button onClick={() => openEdit(p)} className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-emerald-500 hover:text-emerald-600" title="Edit">
                          <SquarePen className="h-4 w-4" />
                        </button>
                        <button onClick={() => handleDelete(p)} className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-rose-500 hover:text-rose-600" title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan="8" className="py-16 text-center text-slate-400">No provider found.</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t">
                  <td colSpan="5" className="px-4 py-3 text-center font-semibold">Total Due</td>
                  <td className="px-4 py-3 text-center font-semibold whitespace-nowrap">৳ {money(summary.due)}</td>
                  <td />
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          </>
        )}
      </div>

      <Modal
        open={modalOpen}
        title={editing ? 'Edit Provider' : 'Add Provider'}
        onClose={() => setModalOpen(false)}
        footer={
          <div className="flex items-center justify-end gap-4">
            <button onClick={handleClear} className="rounded bg-[#ff4b3a] px-5 py-2.5 text-sm font-semibold text-white shadow-sm">
              Clear
            </button>
            <button onClick={handleSave} disabled={saving} className="rounded bg-[#2d8fe4] px-5 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50">
              {saving ? 'Saving...' : (editing ? 'Update' : 'Save')}
            </button>
            <button onClick={() => setModalOpen(false)} className="rounded bg-[#ff4b3a] px-5 py-2.5 text-sm font-semibold text-white shadow-sm">
              Close
            </button>
          </div>
        }
      >
        <form className="grid grid-cols-1 gap-4 md:grid-cols-[250px_1fr]" onSubmit={handleSave}>
          <div className="flex flex-col items-center pt-6">
            <div className="relative">
              <div className="flex h-[188px] w-[188px] items-center justify-center rounded-full border-4 border-slate-100 bg-slate-100 shadow-inner">
                {logoPreview ? (
                  <img src={logoPreview} alt="logo preview" className="h-full w-full rounded-full object-cover" />
                ) : (
                  <Building2 className="h-24 w-24 text-slate-300" />
                )}
              </div>
              <label className="absolute right-2 top-8 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-white text-slate-400 shadow">
                <Image className="h-4 w-4" />
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setForm((f) => ({ ...f, logo_file: file }));
                    setLogoPreview(file ? URL.createObjectURL(file) : (editing?.logo_url || ''));
                  }}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {[
                ['name', 'Company Name'],
                ['contact_person', 'Contact Person'],
                ['email', 'Email'],
                ['phone_number', 'Phone Number'],
                ['mobile_number', 'Mobile Number'],
                ['facebook_url', 'Facebook URL'],
                ['skype_id', 'Skype ID'],
                ['website', 'Website'],
              ].map(([key, label]) => (
                <label key={key} className="block">
                  <span className="mb-1 block text-[12px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
                  <input
                    value={form[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/20"
                  />
                </label>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold uppercase tracking-wide text-slate-500">Account Name</span>
                <input
                  value={form.account_name}
                  onChange={(e) => setForm((f) => ({ ...f, account_name: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/20"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold uppercase tracking-wide text-slate-500">Account Number</span>
                <input
                  value={form.account_number}
                  onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/20"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold uppercase tracking-wide text-slate-500">Bank Name</span>
                <input
                  value={form.bank_name}
                  onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/20"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold uppercase tracking-wide text-slate-500">Active</span>
                <div className="flex h-[38px] items-center px-1">
                  <input
                    type="checkbox"
                    checked={!!form.is_active}
                    onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                    className="h-4 w-4"
                  />
                </div>
              </label>
            </div>

            <div className="mt-4">
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold uppercase tracking-wide text-slate-500">Address</span>
                <textarea
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  rows={3}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/20"
                />
              </label>
            </div>

            <div className="mt-4">
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold uppercase tracking-wide text-slate-500">Account Details</span>
                <textarea
                  value={form.account_details}
                  onChange={(e) => setForm((f) => ({ ...f, account_details: e.target.value }))}
                  rows={3}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/20"
                />
              </label>
            </div>
          </div>

          <button type="submit" className="hidden" />
        </form>
      </Modal>
    </div>
  );
}
