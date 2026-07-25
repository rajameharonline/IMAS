// Stock Monitor — ISP hardware stock tree view by category।
// প্রতিটি item-এর store-wise stock quantity দেখা যাবে।
// Stock adjustment করার জন্য transaction modal।
import { useEffect, useState, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import { RefreshCw, ChevronRight, Plus, Box, Search, SlidersHorizontal } from 'lucide-react';
import api from '../../utils/api';
import { asList, money, formatApiError } from '../bandwidth/bandwidthHelpers';

// ── Stat Card ─────────────────────────────────────────────────────
function StatBox({ label, value, sub, tone = 'blue' }) {
  const map = {
    blue:   'bg-gradient-to-r from-sky-500 to-cyan-600',
    green:  'bg-gradient-to-r from-teal-500 to-emerald-600',
    purple: 'bg-gradient-to-r from-violet-500 to-indigo-600',
    slate:  'bg-gradient-to-r from-slate-500 to-slate-600',
  };
  return (
    <div className={`${map[tone]} rounded-2xl p-6 text-white shadow-sm flex items-center justify-between`}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-white/80">{label}</p>
        <p className="mt-1 text-2xl font-bold">{value}</p>
        <p className="text-xs text-white/70 mt-1">{sub}</p>
      </div>
      <Box className="h-10 w-10 text-white/30" />
    </div>
  );
}

// ── Stock Adjustment Modal ─────────────────────────────────────────
function AdjustModal({ item, stores, onClose, onSaved }) {
  const [form, setForm] = useState({
    store: '', transaction_type: 'in', quantity: 0,
    unit_price: item?.approximate_rate || 0, reference: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.store)    { toast.error('Store required.');    return; }
    if (!form.quantity) { toast.error('Quantity required.'); return; }
    setSaving(true);
    try {
      await api.post('/inventory/stock-transactions/', {
        item:             item.item_id,
        store:            form.store,
        transaction_type: form.transaction_type,
        quantity:         parseFloat(form.quantity) || 0,
        unit_price:       parseFloat(form.unit_price) || 0,
        reference:        form.reference,
        notes:            form.notes,
      });
      toast.success('Stock updated.');
      onSaved();
    } catch (err) { toast.error(formatApiError(err, 'Failed.')); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-800">Stock Adjustment</h3>
          <button onClick={onClose} className="text-2xl text-rose-400 hover:text-rose-600 leading-none">×</button>
        </div>
        <p className="text-sm text-slate-600 font-medium mb-4 pb-3 border-b">{item?.item_name}</p>
        <div className="space-y-3 mb-4">
          {[
            ['Store', 'store', 'select', stores],
            ['Type',  'transaction_type', 'select', [
              { id: 'in', name: 'Stock In' }, { id: 'out', name: 'Stock Out' },
              { id: 'adjustment', name: 'Adjustment' },
            ]],
          ].map(([label, key, type, opts]) => (
            <label key={key} className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{label}</span>
              <select value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400/30 bg-white">
                <option value="">Select</option>
                {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
          ))}
          {[['Quantity', 'quantity'], ['Unit Price', 'unit_price'], ['Reference', 'reference']].map(([label, key]) => (
            <label key={key} className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{label}</span>
              <input type={key === 'reference' ? 'text' : 'number'} min="0"
                value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400/30" />
            </label>
          ))}
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Notes</span>
            <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none resize-none" />
          </label>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 rounded-lg border border-slate-300 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 rounded-lg bg-[#173d59] text-white py-2.5 text-sm font-semibold hover:bg-[#1f5075] disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────
export default function StockPage() {
  const [stockTree,  setStockTree]  = useState([]);
  const [stores,     setStores]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [expandedCats, setExpandedCats] = useState(new Set());
  const [adjustItem, setAdjustItem] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, stRes] = await Promise.all([
        api.get('/inventory/stocks/by-category/'),
        api.get('/inventory/stores/?page_size=200'),
      ]);
      setStockTree(Array.isArray(sRes.data) ? sRes.data : []);
      setStores(asList(stRes.data));
    } catch { toast.error('Stock data লোড করা যায়নি।'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const toggleCat = (id) => setExpandedCats((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return stockTree;
    return stockTree
      .map((cat) => ({
        ...cat,
        items: cat.items.filter((it) =>
          it.item_name.toLowerCase().includes(q) || it.item_code.toLowerCase().includes(q)
        ),
      }))
      .filter((cat) => cat.items.length > 0 || cat.category_name.toLowerCase().includes(q));
  }, [stockTree, search]);

  const totalItems = stockTree.reduce((s, c) => s + c.items.length, 0);
  const totalQty   = stockTree.reduce((s, c) => s + c.items.reduce((ss, it) => ss + it.total_qty, 0), 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Stock</h1>
          <p className="text-xs text-slate-500">Stock Monitor</p>
        </div>
        <button onClick={fetchAll}
          className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 transition-all">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox tone="blue"   label="Total Items"      value={totalItems}            sub="Distinct items in stock" />
        <StatBox tone="green"  label="Total Quantity"   value={totalQty.toFixed(0)}   sub="Aggregate stock units" />
        <StatBox tone="purple" label="Categories"       value={stockTree.length}       sub="Categories with stock" />
        <StatBox tone="slate"  label="Store Locations"  value={stores.length}          sub="Active warehouses" />
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

        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b">
            <span className="text-sm font-semibold text-slate-700">Items</span>
          </div>
          <div className="max-h-[65vh] overflow-y-auto divide-y divide-gray-100">
            {loading ? (
              <div className="py-12 text-center text-slate-400 text-sm">Loading...</div>
            ) : filtered.length === 0 ? (
              <p className="py-12 text-center text-slate-400 text-sm">No stock data. Add items and record stock-in first.</p>
            ) : (
              filtered.map((cat) => {
                const isOpen = expandedCats.has(cat.category_id) || search.trim();
                return (
                  <div key={cat.category_id}>
                    {/* Category row */}
                    <button
                      className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50 transition-colors text-left"
                      onClick={() => toggleCat(cat.category_id)}>
                      <ChevronRight className={`h-3.5 w-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                      <span className="font-semibold text-slate-700 text-sm">{cat.category_name}</span>
                    </button>

                    {/* Items */}
                    {isOpen && (
                      <div className="border-l border-slate-200 ml-6">
                        {cat.items.map((it, i) => (
                          <div key={it.item_id}
                            className={`px-4 py-2.5 group ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'} hover:bg-blue-50/30 transition-colors`}>
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-slate-300 text-xs">└→</span>
                                <div>
                                  <p className="text-sm font-medium text-slate-800">{it.item_name}</p>
                                  <p className="text-[11px] text-slate-400 font-mono">{it.item_code}
                                    {it.unit_name && <span className="ml-1 text-slate-400">· {it.unit_name}</span>}
                                  </p>
                                </div>
                                {it.is_serialized && (
                                  <span className="px-1.5 py-0.5 bg-sky-100 text-sky-700 text-[10px] font-semibold rounded-full">
                                    Serialized
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3">
                                {/* Store-wise stock chips */}
                                <div className="flex flex-wrap gap-1">
                                  {it.stores.map((st) => (
                                    <span key={st.store_id}
                                      className="px-2.5 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-semibold rounded-full whitespace-nowrap">
                                      {st.store_short || st.store_name}: {st.qty}
                                    </span>
                                  ))}
                                  <span className="px-2.5 py-1 bg-[#173d59]/10 text-[#173d59] text-[11px] font-bold rounded-full whitespace-nowrap">
                                    Total: {it.total_qty}
                                  </span>
                                </div>
                                {/* Adjust button */}
                                <button
                                  onClick={() => setAdjustItem(it)}
                                  className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#173d59] text-white text-[11px] font-semibold transition-opacity hover:bg-[#1f5075]">
                                  <SlidersHorizontal className="h-3.5 w-3.5" />
                                  Adjust
                                </button>
                              </div>
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
      </div>

      {adjustItem && (
        <AdjustModal
          item={adjustItem}
          stores={stores}
          onClose={() => setAdjustItem(null)}
          onSaved={() => { setAdjustItem(null); fetchAll(); }}
        />
      )}
    </div>
  );
}
