// Item master page.
// কেন এখানে `income_account` / `expense_account` exposed করছি:
// ভবিষ্যতে item-level accounting mapping, purchase reconciliation, আর report
// drill-down খুব সহজ হবে।

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { SquarePen, Plus, Trash2, RefreshCw } from 'lucide-react';
import api from '../../utils/api';
import { asList, money, formatApiError } from './bandwidthHelpers';

const EMPTY = {
  code: '',
  name: '',
  category: '',
  unit: '',
  minimum_stock: 0,
  vat_percent: 0,
  income_account: '',
  expense_account: '',
  description: '',
  is_active: true,
};

function Modal({ open, title, onClose, children, footer }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-lg font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="p-6">{children}</div>
        <div className="px-6 py-4 border-t bg-slate-50">{footer}</div>
      </div>
    </div>
  );
}

/* ── Mobile Item Card ── */
function MobileItemCard({ row, idx, openEdit, handleDelete }) {
  const isEven = idx % 2 === 0;
  const FRow = ({ label, children }) => (
    <div className="flex items-stretch border-b border-gray-200 last:border-0">
      <div className="w-24 shrink-0 bg-gray-50 px-3 py-2.5 flex items-center border-r border-gray-200">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex-1 min-w-0 px-3 py-2.5 flex items-center justify-end bg-white">
        <div className="min-w-0 truncate">{children}</div>
      </div>
    </div>
  );
  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${isEven ? 'bg-white border-gray-200' : 'bg-slate-50/40 border-gray-200'}`}>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-[#23445f]/5 border-b border-gray-200">
        <div className="min-w-0">
          <p className="font-bold text-gray-900 text-[13px] truncate">{row.name}</p>
          <p className="font-mono text-[11px] text-gray-400 truncate">{row.code}</p>
        </div>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold ${row.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          {row.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>
      <div>
        <FRow label="Category"><span className="text-[12px] text-gray-700">{row.category_name || '—'}</span></FRow>
        <FRow label="Unit"><span className="text-[12px] text-gray-700">{row.unit_name || '—'}</span></FRow>
        <FRow label="VAT"><span className="font-mono text-[12px] text-gray-800">{money(row.vat_percent)}%</span></FRow>
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50/60 border-t border-gray-200">
        <button onClick={() => openEdit(row)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100">Edit</button>
        <button onClick={() => handleDelete(row)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100">Delete</button>
      </div>
    </div>
  );
}

export default function ItemPage() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [units, setUnits] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [iRes, cRes, uRes, aRes] = await Promise.all([
        api.get('/inventory/items/?page_size=500'),
        api.get('/inventory/item-categories/?page_size=500'),
        api.get('/inventory/units/?page_size=500'),
        api.get('/accounting/chart-of-accounts/?page_size=500'),
      ]);
      setItems(asList(iRes.data));
      setCategories(asList(cRes.data));
      setUnits(asList(uRes.data));
      setAccounts(asList(aRes.data));
    } catch (err) {
      toast.error(formatApiError(err, 'Item list লোড করা যায়নি।'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((row) => {
      if (!q) return true;
      return [row.code, row.name, row.category_name, row.unit_name].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [items, search]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      code: row.code || '',
      name: row.name || '',
      category: row.category || '',
      unit: row.unit || '',
      minimum_stock: row.minimum_stock ?? 0,
      vat_percent: row.vat_percent ?? 0,
      income_account: row.income_account || '',
      expense_account: row.expense_account || '',
      description: row.description || '',
      is_active: row.is_active ?? true,
    });
    setModalOpen(true);
  };

  const handleClear = () => {
    // Sample-এর Add Item modal-এর Clear button-এর মতো পুরো form reset করছি।
    setEditing(null);
    setForm(EMPTY);
  };

  const handleDelete = async (row) => {
    if (!confirm(`Delete ${row.name}?`)) return;
    try {
      await api.delete(`/inventory/items/${row.id}/`);
      toast.success('Deleted.');
      fetchData();
    } catch {
      toast.error('Delete failed.');
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        code: String(form.code || '').trim(),
        name: String(form.name || '').trim(),
        category: form.category ? Number(form.category) : null,
        unit: form.unit ? Number(form.unit) : null,
        minimum_stock: Number(form.minimum_stock || 0),
        vat_percent: Number(form.vat_percent || 0),
        income_account: form.income_account ? Number(form.income_account) : null,
        expense_account: form.expense_account ? Number(form.expense_account) : null,
        description: String(form.description || '').trim(),
        is_active: !!form.is_active,
      };
      if (editing) await api.patch(`/inventory/items/${editing.id}/`, payload);
      else await api.post('/inventory/items/', payload);
      toast.success(editing ? 'Item updated.' : 'Item created.');
      setModalOpen(false);
      fetchData();
    } catch (err) {
      toast.error(formatApiError(err, 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Item</h1>
          <p className="text-xs text-slate-500">Bandwidth/stock item master with VAT and account mapping</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchData} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-200">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-[#173d59] px-4 py-2 text-sm font-semibold text-white">
            <Plus className="h-4 w-4" /> Item
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search item..."
          className="w-full rounded-xl border border-slate-300 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/30"
        />

        {loading ? (
          <div className="py-16 text-center text-slate-400 text-sm">লোড হচ্ছে...</div>
        ) : (
          <>
          <div className="md:hidden space-y-2 mt-4 px-2">
            {filtered.length === 0
              ? <p className="text-center py-8 text-slate-400 text-sm">No item found.</p>
              : filtered.map((row, idx) => (
                  <MobileItemCard key={row.id} row={row} idx={idx} openEdit={openEdit} handleDelete={handleDelete} />
                ))}
          </div>
          <div className="hidden md:block mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead className="bg-[#23445f] text-white">
                <tr>
                  <th className="px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wide">Code</th>
                  <th className="px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wide">Name</th>
                  <th className="px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wide">Category</th>
                  <th className="px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wide">Unit</th>
                  <th className="px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wide">VAT</th>
                  <th className="px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-right text-[12px] font-semibold uppercase tracking-wide">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id} className="border-b hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs">{row.code}</td>
                    <td className="px-4 py-3 font-semibold">{row.name}</td>
                    <td className="px-4 py-3">{row.category_name || '—'}</td>
                    <td className="px-4 py-3">{row.unit_name || '—'}</td>
                    <td className="px-4 py-3">{money(row.vat_percent)}%</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${row.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {row.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => openEdit(row)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-emerald-700 hover:bg-emerald-50" title="Edit">
                          <SquarePen className="h-4 w-4" />
                        </button>
                        <button onClick={() => handleDelete(row)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-rose-600 hover:bg-rose-50" title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan="7" className="py-16 text-center text-slate-400">No item found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      <Modal
        open={modalOpen}
        title={editing ? 'Edit Item' : 'Add Item'}
        onClose={() => setModalOpen(false)}
        footer={
          <div className="flex items-center justify-end gap-3">
            <button onClick={handleClear} className="rounded bg-[#ff4b3a] px-5 py-2.5 text-sm font-semibold text-white shadow-sm">
              Clear
            </button>
            <button onClick={handleSave} disabled={saving} className="rounded bg-[#2d8fe4] px-5 py-2.5 text-sm font-semibold text-white shadow-sm">
              {saving ? 'Saving...' : (editing ? 'Save' : 'Save')}
            </button>
            <button onClick={() => setModalOpen(false)} className="rounded bg-[#ff4b3a] px-5 py-2.5 text-sm font-semibold text-white shadow-sm">
              Close
            </button>
          </div>
        }
      >
        <form className="grid grid-cols-1 md:grid-cols-3 gap-4" onSubmit={handleSave}>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Item ID</span>
            <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Item Name</span>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Categories</span>
            <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white">
              <option value="">Select Category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Unit</span>
            <select value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white">
              <option value="">Select Unit</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}{u.symbol ? ` (${u.symbol})` : ''}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Status</span>
            <select value={form.is_active ? '1' : '0'} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.value === '1' }))} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white">
              <option value="1">Active</option>
              <option value="0">Inactive</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">VAT (%)</span>
            <input type="number" step="0.01" value={form.vat_percent} onChange={(e) => setForm((f) => ({ ...f, vat_percent: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Income Account</span>
            <select value={form.income_account} onChange={(e) => setForm((f) => ({ ...f, income_account: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white">
              <option value="">Select</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Expense Account</span>
            <select value={form.expense_account} onChange={(e) => setForm((f) => ({ ...f, expense_account: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white">
              <option value="">Select</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
            </select>
          </label>
          <label className="md:col-span-3 block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Description</span>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={4} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <button type="submit" className="hidden" />
        </form>
      </Modal>
    </div>
  );
}
