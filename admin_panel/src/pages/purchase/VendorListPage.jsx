// ISP Hardware Vendor List — Router/ONU/Cable supplier management।
// কেন custom page: vendor logo upload, multi-field modal, balance due aggregate
// এবং mobile card view — এগুলো GenericListPage দিয়ে সম্ভব নয়।

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { SquarePen, Plus, Trash2, Eye, RefreshCw, Image, Store } from 'lucide-react';
import api from '../../utils/api';
import { asList, money, formatApiError } from '../bandwidth/bandwidthHelpers';

const EMPTY = {
  name: '', contact_person: '', email: '',
  phone_number: '', mobile_number: '',
  facebook_url: '', skype_id: '', website: '',
  address: '', is_active: true, logo_file: null,
};

/* ── Stat Card ─────────────────────────────────────────── */
function StatBox({ label, value, sub, tone = 'blue' }) {
  const map = {
    blue:   'bg-gradient-to-r from-sky-500 to-cyan-600',
    green:  'bg-gradient-to-r from-teal-500 to-emerald-600',
    purple: 'bg-gradient-to-r from-violet-500 to-indigo-600',
    slate:  'bg-gradient-to-r from-slate-500 to-slate-600',
  };
  return (
    <div className={`${map[tone]} rounded-2xl p-6 text-white shadow-sm flex items-center justify-between gap-2`}>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-white/80 truncate">{label}</p>
        <p className="mt-1 text-2xl font-bold truncate">{value}</p>
        <p className="text-xs text-white/70 mt-1 truncate">{sub}</p>
      </div>
      <Store className="h-10 w-10 text-white/30 shrink-0" />
    </div>
  );
}

/* ── Modal ──────────────────────────────────────────────── */
function Modal({ open, title, onClose, children, footer }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-0 md:p-4">
      <div className="w-full md:max-w-3xl bg-white rounded-t-2xl md:rounded-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-xl font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-2xl leading-none text-rose-400 hover:text-rose-600">×</button>
        </div>
        <div className="px-6 pb-4 pt-4">{children}</div>
        {footer && <div className="px-6 pb-5">{footer}</div>}
      </div>
    </div>
  );
}

/* ── Mobile Card ────────────────────────────────────────── */
function VendorMobileCard({ v, openEdit, handleDelete }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 hover:border-slate-300 transition-all">
      <div className="flex justify-between items-center border-b border-gray-100 pb-3 mb-3">
        <div className="flex items-center gap-3">
          {v.logo_url
            ? <img src={v.logo_url} alt={v.name} className="h-10 w-10 rounded-full object-cover" />
            : <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center">
                <Store className="h-6 w-6 text-slate-300" />
              </div>
          }
          <span className="text-sm font-bold text-gray-900 truncate max-w-[150px]">{v.name}</span>
        </div>
        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold
          ${v.is_active ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
          {v.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>
      <div className="space-y-2 text-xs">
        {[
          ['Contact', v.contact_person],
          ['Mobile',  v.mobile_number || v.phone_number],
          ['Email',   v.email],
        ].map(([label, val]) => val && (
          <div key={label} className="flex justify-between items-center">
            <span className="text-gray-500 font-medium uppercase tracking-wider">{label}:</span>
            <span className="text-gray-900 font-semibold text-right truncate max-w-[180px]">{val}</span>
          </div>
        ))}
        <div className="flex justify-between items-center">
          <span className="text-gray-500 font-medium uppercase tracking-wider">Balance Due:</span>
          <span className="text-rose-600 font-bold text-sm">৳ {money(v.balance_due)}</span>
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-gray-100 flex justify-end gap-2">
        <button onClick={() => openEdit(v)}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-50 text-blue-600 border border-blue-200 rounded-xl text-xs font-medium min-h-[44px]">
          <SquarePen className="h-4 w-4" /> Edit
        </button>
        <button onClick={() => handleDelete(v)}
          className="flex items-center gap-1.5 px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-xl text-xs font-medium min-h-[44px]">
          <Trash2 className="h-4 w-4" /> Delete
        </button>
      </div>
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────── */
export default function VendorListPage() {
  const [vendors, setVendors]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatus]   = useState('');
  const [pageSize, setPageSize]     = useState(10);
  const [modalOpen, setModalOpen]   = useState(false);
  const [saving, setSaving]         = useState(false);
  const [editing, setEditing]       = useState(null);
  const [form, setForm]             = useState(EMPTY);
  const [logoPreview, setLogoPreview] = useState('');

  const fetchVendors = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/purchase/vendors/?page_size=500');
      setVendors(asList(data));
    } catch {
      toast.error('Vendor list লোড করা যায়নি।');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchVendors(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vendors.filter((v) => {
      const matchSearch = !q || [v.name, v.contact_person, v.email, v.mobile_number, v.phone_number, v.address]
        .some((x) => String(x || '').toLowerCase().includes(q));
      const matchStatus = !statusFilter ? true
        : statusFilter === 'active' ? !!v.is_active : !v.is_active;
      return matchSearch && matchStatus;
    });
  }, [vendors, search, statusFilter]);

  const visible  = useMemo(() => filtered.slice(0, pageSize), [filtered, pageSize]);
  const summary  = useMemo(() => ({
    total:    vendors.length,
    active:   vendors.filter((v) => v.is_active).length,
    due:      vendors.reduce((s, v) => s + Number(v.balance_due || 0), 0),
    inactive: vendors.filter((v) => !v.is_active).length,
  }), [vendors]);

  const field = (key, label, type = 'text') => (
    <label key={key} className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <input
        type={type}
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400"
      />
    </label>
  );

  const openCreate = () => {
    setEditing(null); setForm(EMPTY); setLogoPreview(''); setModalOpen(true);
  };
  const openEdit = (v) => {
    setEditing(v);
    setForm({
      name: v.name || '', contact_person: v.contact_person || '',
      email: v.email || '', phone_number: v.phone_number || v.phone || '',
      mobile_number: v.mobile_number || '', facebook_url: v.facebook_url || '',
      skype_id: v.skype_id || '', website: v.website || '',
      address: v.address || '', is_active: v.is_active ?? true, logo_file: null,
    });
    setLogoPreview(v.logo_url || '');
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Company Name required.'); return; }
    setSaving(true);
    try {
      const payload = new FormData();
      Object.entries(form).forEach(([k, v]) => {
        if (k === 'logo_file') { if (v) payload.append('logo', v); return; }
        if (v !== null && v !== undefined && v !== '') payload.append(k, v);
      });
      if (editing) {
        await api.patch(`/purchase/vendors/${editing.id}/`, payload);
        toast.success('Vendor updated.');
      } else {
        await api.post('/purchase/vendors/', payload);
        toast.success('Vendor created.');
      }
      setModalOpen(false);
      fetchVendors();
    } catch (err) {
      toast.error(formatApiError(err, 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (v) => {
    if (!confirm(`Delete "${v.name}"?`)) return;
    try {
      await api.delete(`/purchase/vendors/${v.id}/`);
      toast.success('Deleted.');
      fetchVendors();
    } catch (err) {
      toast.error(formatApiError(err, 'Delete failed.'));
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Vendor List</h1>
          <p className="text-xs text-slate-500">All Vendors for Purchase</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchVendors}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 transition-all">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-xl bg-[#173d59] hover:bg-[#1f5075] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all">
            <Plus className="h-4 w-4" /> Vendor
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox tone="blue"   label="Total Vendors"  value={summary.total}            sub="All vendor accounts" />
        <StatBox tone="green"  label="Active"         value={summary.active}           sub="Enabled vendors" />
        <StatBox tone="purple" label="Balance Due"    value={`৳ ${money(summary.due)}`} sub="Aggregate outstanding" />
        <StatBox tone="slate"  label="Inactive"       value={summary.inactive}          sub="Disabled vendors" />
      </div>

      {/* Table Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 bg-gray-50 rounded-xl p-4 mb-5">
          <div className="md:col-span-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Search</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search vendor name, contact, email..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-400/30" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Status</label>
            <select value={statusFilter} onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-400/30">
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Show</label>
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none">
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} entries</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="py-20 text-center text-slate-400 text-sm">Loading...</div>
        ) : (
          <div className="w-full">
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-full divide-y divide-gray-200">
                <thead className="bg-[#23445f]">
                  <tr>
                    {['Logo', 'Company', 'Contact Person', 'Email', 'Mobile Number', 'Balance Due', 'Action'].map((h) => (
                      <th key={h} className="px-4 py-4 text-white text-xs font-semibold uppercase tracking-wider text-left">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {visible.map((v, i) => (
                    <tr key={v.id} className={`${i % 2 === 1 ? 'bg-gray-50/50' : 'bg-white'} hover:bg-blue-50/30 transition-colors`}>
                      <td className="px-4 py-3">
                        <div className="h-12 w-12 rounded-full overflow-hidden bg-slate-100 flex items-center justify-center">
                          {v.logo_url
                            ? <img src={v.logo_url} alt={v.name} className="h-full w-full object-cover" />
                            : <Store className="h-7 w-7 text-slate-300" />}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900 truncate max-w-[200px]">{v.name}</td>
                      <td className="px-4 py-3 text-slate-600">{v.contact_person || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 truncate max-w-[160px]">{v.email || '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{v.mobile_number || v.phone_number || '—'}</td>
                      <td className="px-4 py-3 font-mono font-semibold text-rose-600 whitespace-nowrap">
                        ৳ {money(v.balance_due)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(v)} title="Edit"
                            className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-emerald-500 hover:bg-emerald-50">
                            <SquarePen className="h-4 w-4" />
                          </button>
                          <button onClick={() => handleDelete(v)} title="Delete"
                            className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-rose-500 hover:bg-rose-50">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {visible.length === 0 && (
                    <tr><td colSpan={7} className="py-16 text-center text-slate-400">No vendors found.</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-gray-50">
                    <td colSpan={5} className="px-4 py-3 font-bold text-slate-700">Total Due</td>
                    <td className="px-4 py-3 font-bold font-mono text-rose-600 whitespace-nowrap">
                      ৳ {money(summary.due)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="block md:hidden space-y-4">
              {visible.length === 0
                ? <p className="text-center py-12 text-slate-400 text-sm">No vendors found.</p>
                : visible.map((v) => (
                    <VendorMobileCard key={v.id} v={v} openEdit={openEdit} handleDelete={handleDelete} />
                  ))}
            </div>

            <p className="mt-4 text-xs text-slate-400">
              Showing {visible.length} of {filtered.length} entries
            </p>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal open={modalOpen} title={editing ? 'Edit Vendor' : 'Add Vendor'} onClose={() => setModalOpen(false)}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-gray-100">
            <button onClick={() => { setEditing(null); setForm(EMPTY); setLogoPreview(''); }}
              className="w-full md:w-auto rounded-lg bg-rose-500 hover:bg-rose-600 px-6 py-2.5 text-sm font-semibold text-white transition-all">
              Clear
            </button>
            <button onClick={handleSave} disabled={saving}
              className="w-full md:w-auto rounded-lg bg-[#2d8fe4] hover:bg-[#2681d5] px-6 py-2.5 text-sm font-semibold text-white transition-all disabled:opacity-50">
              {saving ? 'Saving...' : editing ? 'Update' : 'Save'}
            </button>
            <button onClick={() => setModalOpen(false)}
              className="w-full md:w-auto rounded-lg bg-rose-500 hover:bg-rose-600 px-6 py-2.5 text-sm font-semibold text-white transition-all">
              Close
            </button>
          </div>
        }
      >
        <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
          {/* Logo Upload */}
          <div className="flex flex-col items-center pt-2">
            <div className="relative">
              <div className="h-44 w-44 rounded-full overflow-hidden bg-slate-100 border-4 border-slate-200 flex items-center justify-center shadow-inner">
                {logoPreview
                  ? <img src={logoPreview} alt="logo" className="h-full w-full object-cover" />
                  : <Store className="h-20 w-20 text-slate-300" />}
              </div>
              <label className="absolute right-2 top-8 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-white shadow border border-slate-200 text-slate-400 hover:text-slate-600">
                <Image className="h-4 w-4" />
                <input type="file" accept="image/*" className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setForm((f) => ({ ...f, logo_file: file }));
                    setLogoPreview(file ? URL.createObjectURL(file) : (editing?.logo_url || ''));
                  }} />
              </label>
              {logoPreview && (
                <button type="button"
                  onClick={() => { setForm((f) => ({ ...f, logo_file: null })); setLogoPreview(''); }}
                  className="absolute right-0 top-0 flex h-7 w-7 items-center justify-center rounded-full bg-rose-500 text-white text-lg leading-none shadow">
                  ×
                </button>
              )}
            </div>
          </div>

          {/* Fields */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Company Name — required */}
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Company Name <span className="text-rose-500">*</span>
                </span>
                <input required value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400" />
              </label>
              {/* Contact Person — required */}
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Contact Person <span className="text-rose-500">*</span>
                </span>
                <input required value={form.contact_person}
                  onChange={(e) => setForm((f) => ({ ...f, contact_person: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400" />
              </label>
              {field('email', 'Email', 'email')}
              {field('phone_number', 'Phone Number')}
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Mobile Number <span className="text-rose-500">*</span>
                </span>
                <input required value={form.mobile_number}
                  onChange={(e) => setForm((f) => ({ ...f, mobile_number: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400" />
              </label>
              {field('facebook_url', 'Facebook URL')}
              {field('skype_id', 'Skype ID')}
              {field('website', 'Website')}
            </div>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Address</span>
              <textarea rows={3} value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400 resize-none" />
            </label>
          </div>
          <button type="submit" className="hidden" />
        </form>
      </Modal>
    </div>
  );
}
