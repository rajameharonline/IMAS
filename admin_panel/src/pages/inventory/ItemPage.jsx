// Item Page — ISP hardware item management।
// tree view by category, Product/Service type, SKU, Serialized toggle,
// category picker modal, screenshot-এর layout অনুসরণ করা হয়েছে।
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, RefreshCw, SquarePen, Trash2, ChevronRight, Search, Image } from 'lucide-react';
import api from '../../utils/api';
import { asList, money, formatApiError } from '../bandwidth/bandwidthHelpers';

// ── Build category tree for picker ───────────────────────────────
function buildCatTree(cats) {
  const map = {};
  const roots = [];
  cats.forEach((c) => { map[c.id] = { ...c, _ch: [] }; });
  cats.forEach((c) => {
    if (c.parent && map[c.parent]) map[c.parent]._ch.push(map[c.id]);
    else roots.push(map[c.id]);
  });
  return roots;
}

// ── Category picker node ──────────────────────────────────────────
function PickerNode({ node, depth, onSelect }) {
  const [open, setOpen] = useState(depth < 1);
  return (
    <div>
      <div className="flex items-center justify-between py-1.5 px-3 hover:bg-gray-50 rounded group"
        style={{ paddingLeft: `${12 + depth * 16}px` }}>
        <div className="flex items-center gap-1.5">
          {node._ch.length > 0 ? (
            <button onClick={() => setOpen((o) => !o)} className="text-slate-400 hover:text-slate-600">
              <ChevronRight className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} />
            </button>
          ) : <span className="w-3" />}
          <span className={`text-sm ${depth === 0 ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>
            {node.name}
          </span>
        </div>
        <button onClick={() => onSelect(node)}
          className="opacity-0 group-hover:opacity-100 px-2.5 py-0.5 rounded-full bg-teal-600 text-white text-[11px] font-semibold transition-opacity">
          Select
        </button>
      </div>
      {open && node._ch.map((child) => (
        <PickerNode key={child.id} node={child} depth={depth + 1} onSelect={onSelect} />
      ))}
    </div>
  );
}

// ── Item form modal ────────────────────────────────────────────────
const EMPTY = {
  code: '', name: '', item_type: 'product', is_serialized: false,
  category: '', unit: '', vat_percent: 0, approximate_rate: 0,
  minimum_stock: 0, description: '', is_active: true,
};

function ItemFormModal({ open, editing, units, categories, onClose, onSaved }) {
  const [form,    setForm]    = useState(EMPTY);
  const [saving,  setSaving]  = useState(false);
  const [catPicker, setCatPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        code:           editing.code           || '',
        name:           editing.name           || '',
        item_type:      editing.item_type      || 'product',
        is_serialized:  !!editing.is_serialized,
        category:       editing.category       || '',
        unit:           editing.unit           || '',
        vat_percent:    editing.vat_percent    ?? 0,
        approximate_rate: editing.approximate_rate ?? 0,
        minimum_stock:  editing.minimum_stock  ?? 0,
        description:    editing.description    || '',
        is_active:      editing.is_active      ?? true,
      });
    } else {
      setForm(EMPTY);
    }
  }, [open, editing]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const selectedCatName = useMemo(() => {
    if (!form.category) return 'Not selected';
    return categories.find((c) => String(c.id) === String(form.category))?.name || 'Not selected';
  }, [form.category, categories]);

  const catTree = useMemo(() => buildCatTree(categories), [categories]);

  const filteredCatTree = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return catTree;
    const matched = categories.filter((c) => c.name.toLowerCase().includes(q));
    return buildCatTree(matched);
  }, [catTree, categories, pickerSearch]);

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Item Name required.'); return; }
    setSaving(true);
    const payload = {
      name:             form.name.trim(),
      item_type:        form.item_type,
      is_serialized:    form.is_serialized,
      category:         form.category || null,
      unit:             form.unit     || null,
      vat_percent:      parseFloat(form.vat_percent)      || 0,
      approximate_rate: parseFloat(form.approximate_rate) || 0,
      minimum_stock:    parseInt(form.minimum_stock, 10)  || 0,
      description:      form.description,
      is_active:        form.is_active,
    };
    if (form.code.trim()) payload.code = form.code.trim();
    try {
      if (editing) {
        await api.patch(`/inventory/items/${editing.id}/`, payload);
        toast.success('Item updated.');
      } else {
        await api.post('/inventory/items/', payload);
        toast.success('Item created.');
      }
      onSaved();
    } catch (err) { toast.error(formatApiError(err, 'Save failed.')); }
    finally { setSaving(false); }
  };

  if (!open) return null;
  const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400';

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-0 md:p-4">
      <div className="w-full md:max-w-2xl bg-white rounded-t-2xl md:rounded-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-lg font-bold text-slate-800">
            {editing ? 'Edit Item' : 'Add Item'} &nbsp;
            <span className="text-xs text-slate-400 font-normal">Item List</span>
          </h3>
          <button onClick={onClose} className="text-2xl text-rose-400 hover:text-rose-600 leading-none">×</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Product / Service toggle */}
          <div className="flex items-center gap-4">
            {['product', 'service'].map((t) => (
              <label key={t} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.item_type === t}
                  onChange={() => set('item_type', t)}
                  className="h-4 w-4 rounded accent-teal-600" />
                <span className="text-sm font-semibold text-slate-700 uppercase tracking-wider">{t}</span>
              </label>
            ))}
          </div>

          {/* Logo placeholder + name/SKU/serialized */}
          <div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-5">
            {/* Image placeholder */}
            <div className="flex flex-col items-center gap-2">
              <div className="relative h-32 w-32 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 flex items-center justify-center">
                <div className="flex flex-col items-center gap-1 text-slate-300">
                  <Image className="h-10 w-10" />
                </div>
                <button className="absolute top-1 right-1 h-6 w-6 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 shadow-sm">
                  <SquarePen className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Fields */}
            <div className="space-y-3">
              <label className="block">
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Item Name <span className="text-rose-500">*</span>
                </span>
                <input value={form.name} onChange={(e) => set('name', e.target.value)} className={inp}
                  placeholder="e.g. GEPON ONU 4 Port" />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Stock Keeping Unit (SKU)
                    <span className="ml-1 text-[10px] text-slate-400">(optional)</span>
                  </span>
                  <input value={form.code} onChange={(e) => set('code', e.target.value)} className={inp}
                    placeholder="Auto-generated if blank" />
                </label>
                <label className="block">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Make it Serialized?
                  </span>
                  <select value={form.is_serialized ? 'yes' : 'no'}
                    onChange={(e) => set('is_serialized', e.target.value === 'yes')}
                    className={inp}>
                    <option value="no">NonSerialized</option>
                    <option value="yes">Serialized</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Description</span>
                <textarea value={form.description} onChange={(e) => set('description', e.target.value)}
                  rows={2} className={`${inp} resize-none`} placeholder="Optional description" />
              </label>
            </div>
          </div>

          {/* Category + Status + Unit + VAT + Rate */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Selected Categories <span className="text-rose-500">*</span>
              </span>
              <div className="flex gap-2">
                <input readOnly value={selectedCatName}
                  className={`${inp} flex-1 bg-gray-50 cursor-pointer`}
                  onClick={() => { setPickerSearch(''); setCatPicker(true); }} />
                <button onClick={() => { setPickerSearch(''); setCatPicker(true); }}
                  className="shrink-0 px-3 py-2 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700">
                  Select Category
                </button>
              </div>
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Item Status
              </span>
              <div className="flex items-center gap-3 h-[42px]">
                <select value={form.is_active ? 'active' : 'inactive'}
                  onChange={(e) => set('is_active', e.target.value === 'active')}
                  className={`${inp} flex-1`}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Unit</span>
              <select value={form.unit} onChange={(e) => set('unit', e.target.value)} className={inp}>
                <option value="">Select</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">VAT(%)</span>
              <input type="number" min="0" max="100" value={form.vat_percent}
                onChange={(e) => set('vat_percent', e.target.value)} className={inp} />
            </label>
            <label className="block sm:col-span-2">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Approximate Rate
              </span>
              <input type="number" min="0" value={form.approximate_rate}
                onChange={(e) => set('approximate_rate', e.target.value)} className={inp}
                placeholder="Default purchase rate" />
            </label>
          </div>
        </div>

        <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3">
          <button onClick={() => setForm(EMPTY)}
            className="px-5 py-2.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold transition-all">
            Clear
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-all disabled:opacity-50">
            {saving ? 'Saving...' : editing ? 'Update' : 'Save'}
          </button>
        </div>
      </div>

      {/* Category Picker Modal */}
      {catPicker && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl flex flex-col max-h-[70vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h4 className="font-bold text-slate-800">Select Parent Category</h4>
              <button onClick={() => setCatPicker(false)}
                className="text-xl text-rose-500 leading-none font-bold">×</button>
            </div>
            <div className="border border-slate-200 rounded-xl m-4 flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2.5 bg-gray-50 border-b">
                <span className="text-sm font-semibold text-slate-700">Item Categories</span>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <input value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)}
                    placeholder="Search"
                    className="pl-7 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs outline-none w-32" />
                </div>
              </div>
              <div className="overflow-y-auto flex-1 p-2">
                {filteredCatTree.map((node) => (
                  <PickerNode key={node.id} node={node} depth={0}
                    onSelect={(c) => { set('category', c.id); setCatPicker(false); }} />
                ))}
                {filteredCatTree.length === 0 && (
                  <p className="py-6 text-center text-slate-400 text-sm">No categories found.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────
export default function ItemPage() {
  const [items,      setItems]      = useState([]);
  const [categories, setCategories] = useState([]);
  const [units,      setUnits]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [modal,      setModal]      = useState(false);
  const [editing,    setEditing]    = useState(null);
  const [expandedCats, setExpandedCats] = useState(new Set());

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [iRes, cRes, uRes] = await Promise.all([
        api.get('/inventory/items/?page_size=500'),
        api.get('/inventory/item-categories/?page_size=500'),
        api.get('/inventory/units/?page_size=200'),
      ]);
      setItems(asList(iRes.data));
      setCategories(asList(cRes.data));
      setUnits(asList(uRes.data));
    } catch { toast.error('Data লোড করা যায়নি।'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const openAdd  = () => { setEditing(null); setModal(true); };
  const openEdit = (item) => { setEditing(item); setModal(true); };
  const closeModal = () => { setModal(false); setEditing(null); };
  const onSaved = () => { closeModal(); fetchAll(); };

  const handleDelete = async (item) => {
    if (!confirm(`Delete "${item.name}"?`)) return;
    try {
      await api.delete(`/inventory/items/${item.id}/`);
      toast.success('Deleted.'); fetchAll();
    } catch (err) { toast.error(formatApiError(err, 'Delete failed.')); }
  };

  const toggleCat = (id) => setExpandedCats((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Group items by category
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? items.filter((it) => [it.name, it.code, it.category_name].some((v) => String(v || '').toLowerCase().includes(q)))
      : items;

    const groups = {};
    filtered.forEach((it) => {
      const catId   = it.category || 0;
      const catName = it.category_name || 'Uncategorized';
      if (!groups[catId]) groups[catId] = { catId, catName, items: [] };
      groups[catId].items.push(it);
    });
    return Object.values(groups).sort((a, b) => a.catName.localeCompare(b.catName));
  }, [items, search]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Item</h1>
          <p className="text-xs text-slate-500">Item Tree</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchAll}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 transition-all">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button onClick={openAdd}
            className="inline-flex items-center gap-2 rounded-xl bg-[#173d59] hover:bg-[#1f5075] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all">
            <Plus className="h-4 w-4" /> Item
          </button>
        </div>
      </div>

      {/* Tree Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        {/* Search */}
        <div className="mb-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items..."
              className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-400/30" />
          </div>
        </div>

        {/* Tree */}
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-slate-200">
            <span className="text-sm font-semibold text-slate-700">Items</span>
          </div>
          <div className="divide-y divide-gray-100 max-h-[65vh] overflow-y-auto">
            {loading ? (
              <div className="py-12 text-center text-slate-400 text-sm">Loading...</div>
            ) : grouped.length === 0 ? (
              <p className="py-12 text-center text-slate-400 text-sm">No items found.</p>
            ) : (
              grouped.map((group) => {
                const isOpen = expandedCats.has(group.catId) || search.trim();
                return (
                  <div key={group.catId}>
                    {/* Category row */}
                    <button
                      className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50 transition-colors text-left"
                      onClick={() => toggleCat(group.catId)}>
                      <ChevronRight className={`h-3.5 w-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                      <span className="font-semibold text-slate-700 text-sm">
                        {group.catName}
                      </span>
                      <span className="text-xs text-slate-400 font-normal ml-1">
                        — {group.items.length} {group.items.length === 1 ? 'Item' : 'Items'}
                      </span>
                    </button>

                    {/* Items under category */}
                    {isOpen && (
                      <div className="border-l border-slate-200 ml-6">
                        {group.items.map((it, i) => (
                          <div key={it.id}
                            className={`flex items-center justify-between px-4 py-2 group ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'} hover:bg-blue-50/30 transition-colors`}>
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="text-slate-300 text-xs">└→</span>
                              <div className="min-w-0">
                                <span className="text-sm text-slate-800 font-medium truncate block">{it.name}</span>
                                <span className="text-[11px] text-slate-400 font-mono">{it.code}</span>
                              </div>
                              {it.is_serialized && (
                                <span className="shrink-0 px-2 py-0.5 bg-sky-100 text-sky-700 text-[10px] font-semibold rounded-full">
                                  Serialized
                                </span>
                              )}
                              <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold
                                ${it.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                {it.is_active ? 'Active' : 'Inactive'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                              <button onClick={() => openEdit(it)}
                                className="px-2.5 py-1 rounded border border-slate-200 text-[11px] font-semibold text-cyan-600 hover:bg-cyan-50">
                                Edit
                              </button>
                              <button onClick={() => handleDelete(it)}
                                className="px-2.5 py-1 rounded border border-slate-200 text-[11px] font-semibold text-rose-600 hover:bg-rose-50">
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-400">Total: {items.length} items in {grouped.length} categories</p>
      </div>

      {/* Form Modal */}
      <ItemFormModal
        open={modal}
        editing={editing}
        units={units}
        categories={categories}
        onClose={closeModal}
        onSaved={onSaved}
      />
    </div>
  );
}
