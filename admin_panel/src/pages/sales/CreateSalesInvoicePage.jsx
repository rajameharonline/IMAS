// Create / Edit Sales Invoice পেজ।
// type prop: 'product' → Product Sales Invoice, 'service' → Service Sales Invoice।
// screenshot-এর Create Invoice form হুবহু অনুসরণ করা হয়েছে।
// কেন shared: Product ও Service-এর form structure প্রায় identical;
//             শুধু type-ভেদে endpoint ও Invoice Type field আলাদা।

import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Plus, Trash2, Table } from 'lucide-react';
import api from '../../utils/api';

// ── constants ─────────────────────────────────────────────────────────────────

const INVOICE_TYPES = [
  { value: 'installation',  label: 'Installation' },
  { value: 'maintenance',   label: 'Maintenance' },
  { value: 'configuration', label: 'Configuration' },
  { value: 'support',       label: 'Support' },
  { value: 'other',         label: 'Other' },
];

const EMPTY_LINE = {
  item: '', item_name: '', description: '',
  quantity: 1, rate: 0, vat_percent: 0, total: 0,
};

// ── helpers ───────────────────────────────────────────────────────────────────

const calcLineTotal = (l) => {
  const base = Number(l.quantity || 0) * Number(l.rate || 0);
  return base + (base * Number(l.vat_percent || 0) / 100);
};

const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Item Picker Modal ─────────────────────────────────────────────────────────

function ItemPickerModal({ type, onSelect, onClose }) {
  // Inventory-এর Item browse/search করার mini modal।
  // type='product' → item_type=product, type='service' → item_type=service
  const [items,   setItems]   = useState([]);
  const [search,  setSearch]  = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get('/inventory/items/', {
      params: {
        item_type: type === 'service' ? 'service' : 'product',
        is_active: true,
        page_size: 500,
      },
    })
      .then((r) => setItems(Array.isArray(r.data) ? r.data : (r.data?.results || [])))
      .catch(() => toast.error('Items লোড ব্যর্থ।'))
      .finally(() => setLoading(false));
  }, [type]);

  const filtered = items.filter(
    (item) =>
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.code.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h3 className="text-base font-bold text-slate-800">Select Item</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <div className="p-4 border-b">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or code…"
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#173d59] focus:outline-none"
          />
        </div>
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <p className="text-center text-gray-400 py-8">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-gray-400 py-8">No items found</p>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 bg-[#23445f]">
                <tr>
                  <th className="px-4 py-3 text-white text-xs font-semibold uppercase tracking-wider text-left">Code</th>
                  <th className="px-4 py-3 text-white text-xs font-semibold uppercase tracking-wider text-left">Name</th>
                  <th className="px-4 py-3 text-white text-xs font-semibold uppercase tracking-wider text-right">Rate</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, i) => (
                  <tr
                    key={item.id}
                    onClick={() => onSelect(item)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(item); }
                    }}
                    className={`cursor-pointer ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#173d59]`}
                  >
                    <td className="px-4 py-2.5 text-xs text-gray-600">{item.code}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-900 font-medium">{item.name}</td>
                    <td className="px-4 py-2.5 text-sm text-gray-700 text-right">৳{fmt(item.approximate_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CreateSalesInvoicePage({ type = 'product' }) {
  const navigate = useNavigate();
  const { id }   = useParams(); // edit mode হলে id থাকবে
  const isEdit   = Boolean(id);

  const endpoint      = type === 'service' ? '/sales/service-invoices/' : '/sales/product-invoices/';
  const listPath      = type === 'service' ? '/sales/service-invoice' : '/sales/product-invoice';
  const nextNoPath    = type === 'service'
    ? '/sales/service-invoices/next-invoice-no/'
    : '/sales/product-invoices/next-invoice-no/';
  const pageTitle     = type === 'service' ? 'Service Sales Invoice' : 'Product Sales Invoice';
  const breadcrumb    = type === 'service' ? 'Service Invoice' : 'Product Invoice';

  // ── Form state ──
  const [form, setForm] = useState({
    customer: '',
    invoice_no: '',
    invoice_type: 'installation',
    payment_due: '',
    remarks: '',
  });
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);
  const [saving, setSaving] = useState(false);

  // ── Lookup state ──
  const [customers, setCustomers] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLineIdx, setPickerLineIdx] = useState(null);

  // Grand total
  const grandTotal = lines.reduce((s, l) => s + calcLineTotal(l), 0);

  // ── Fetch auto invoice number ──
  const fetchNextNo = useCallback(async () => {
    if (isEdit) return; // edit mode-এ generate দরকার নেই
    try {
      const res = await api.get(nextNoPath);
      setForm((p) => ({ ...p, invoice_no: res.data.invoice_no }));
    } catch { /* silent */ }
  }, [isEdit, nextNoPath]);

  // ── Load customers ──
  useEffect(() => {
    api.get('/clients/', { params: { page_size: 2000 } })
      .then((r) => setCustomers(Array.isArray(r.data) ? r.data : (r.data?.results || [])))
      .catch(() => {});
    fetchNextNo();
  }, [fetchNextNo]);

  // ── Load existing invoice (edit mode) ──
  useEffect(() => {
    if (!isEdit) return;
    api.get(`${endpoint}${id}/`)
      .then((r) => {
        const d = r.data;
        setForm({
          customer:     d.customer || '',
          invoice_no:   d.invoice_no || '',
          invoice_type: d.invoice_type || 'installation',
          payment_due:  d.payment_due || '',
          remarks:      d.remarks || '',
        });
        if (d.lines && d.lines.length > 0) {
          setLines(d.lines.map((l) => ({
            item:        l.item || '',
            item_name:   l.item_name || '',
            description: l.description || '',
            quantity:    l.quantity || 1,
            rate:        l.rate || 0,
            vat_percent: l.vat_percent || 0,
            total:       l.total || 0,
          })));
        }
      })
      .catch(() => toast.error('Invoice লোড ব্যর্থ হয়েছে।'));
  }, [isEdit, id, endpoint]);

  // ── Line item handlers ──
  const addLine = () => setLines((prev) => [...prev, { ...EMPTY_LINE }]);

  const removeLine = (idx) => {
    if (lines.length === 1) { setLines([{ ...EMPTY_LINE }]); return; }
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateLine = (idx, field, value) => {
    setLines((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      updated[idx].total = calcLineTotal(updated[idx]);
      return updated;
    });
  };

  const openPicker = (idx) => {
    setPickerLineIdx(idx);
    setPickerOpen(true);
  };

  const handleItemSelect = (item) => {
    setLines((prev) => {
      const updated = [...prev];
      updated[pickerLineIdx] = {
        ...updated[pickerLineIdx],
        item:        item.id,
        item_name:   item.name,
        description: item.name,
        rate:        item.approximate_rate || 0,
        vat_percent: item.vat_percent || 0,
      };
      updated[pickerLineIdx].total = calcLineTotal(updated[pickerLineIdx]);
      return updated;
    });
    setPickerOpen(false);
  };

  // ── Submit ──
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.customer) {
      toast.error('Customer নির্বাচন করুন।');
      return;
    }
    if (lines.every((l) => !l.item && !l.description)) {
      toast.error('কমপক্ষে একটি item বা description দিন।');
      return;
    }

    setSaving(true);
    const payload = {
      customer:     form.customer,
      invoice_no:   form.invoice_no || undefined,
      payment_due:  form.payment_due || null,
      remarks:      form.remarks,
      lines_payload: lines.map((l) => ({
        item:        l.item || null,
        description: l.description,
        quantity:    Number(l.quantity) || 0,
        rate:        Number(l.rate) || 0,
        vat_percent: Number(l.vat_percent) || 0,
      })),
    };
    if (type === 'service') payload.invoice_type = form.invoice_type;

    try {
      if (isEdit) {
        await api.patch(`${endpoint}${id}/`, payload);
        toast.success('Invoice আপডেট হয়েছে।');
      } else {
        await api.post(endpoint, payload);
        toast.success('Invoice সফলভাবে তৈরি হয়েছে।');
      }
      navigate(listPath);
    } catch (err) {
      const errData = err?.response?.data;
      if (errData && typeof errData === 'object') {
        const msg = Object.values(errData).flat().join(' | ');
        toast.error(msg || 'Save ব্যর্থ হয়েছে।');
      } else {
        toast.error('Save ব্যর্থ হয়েছে।');
      }
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#173d59] focus:outline-none bg-white';

  return (
    <div className="p-4 md:p-6 bg-gray-100 min-h-screen">
      {/* Breadcrumb header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <svg className="w-5 h-5 text-[#173d59]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            {isEdit ? 'Edit Invoice' : 'Create Invoice'}
          </h1>
          <p className="text-sm text-gray-500">{pageTitle}</p>
        </div>
        <div className="text-xs text-gray-400">{breadcrumb} &gt; {isEdit ? 'Edit Invoice' : 'Create Invoice'}</div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">

        {/* Back button */}
        <div className="mb-6">
          <button
            onClick={() => navigate(listPath)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 rounded-full transition-all"
          >
            <ArrowLeft className="w-4 h-4" /> Back to List
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Header fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Customer <span className="text-rose-500">*</span>
              </label>
              <select
                value={form.customer}
                onChange={(e) => setForm((p) => ({ ...p, customer: e.target.value }))}
                required
                className={inputCls}
              >
                <option value="">Select</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name} ({c.username})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Invoice No</label>
              <input
                value={form.invoice_no}
                onChange={(e) => setForm((p) => ({ ...p, invoice_no: e.target.value }))}
                placeholder="Auto-generated"
                className={inputCls + ' bg-gray-50'}
                readOnly={!isEdit}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Payment Due <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                value={form.payment_due}
                onChange={(e) => setForm((p) => ({ ...p, payment_due: e.target.value }))}
                className={inputCls}
              />
            </div>
            {type === 'service' && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Invoice Type</label>
                <select
                  value={form.invoice_type}
                  onChange={(e) => setForm((p) => ({ ...p, invoice_type: e.target.value }))}
                  className={inputCls}
                >
                  {INVOICE_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Line items table */}
          <div className="overflow-x-auto mb-4">
            <table className="w-full min-w-[700px] border border-gray-200 rounded-xl overflow-hidden">
              <thead className="bg-[#23445f]">
                <tr>
                  <th className="px-4 py-3 text-white text-xs font-semibold uppercase tracking-wider text-left w-[220px]">Item</th>
                  <th className="px-4 py-3 text-white text-xs font-semibold uppercase tracking-wider text-left">Description</th>
                  <th className="px-4 py-3 text-white text-xs font-semibold uppercase tracking-wider text-right w-[100px]">Quantity</th>
                  <th className="px-4 py-3 text-white text-xs font-semibold uppercase tracking-wider text-right w-[120px]">Rate</th>
                  <th className="px-4 py-3 text-white text-xs font-semibold uppercase tracking-wider text-right w-[100px]">VAT(%)</th>
                  <th className="px-4 py-3 text-white text-xs font-semibold uppercase tracking-wider text-right w-[130px]">Total</th>
                  <th className="px-4 py-3 text-white text-xs font-semibold uppercase tracking-wider text-center w-[60px]">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lines.map((line, idx) => (
                  <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                    {/* Item picker */}
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <span className="flex-1 text-sm text-gray-800 truncate min-w-0">
                          {line.item_name || (
                            <span className="text-gray-400 italic">Select</span>
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => openPicker(idx)}
                          title="Browse Items"
                          className="flex-shrink-0 p-1.5 text-[#173d59] bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
                        >
                          <Table className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                    {/* Description */}
                    <td className="px-3 py-2">
                      <input
                        value={line.description}
                        onChange={(e) => updateLine(idx, 'description', e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:ring-1 focus:ring-[#173d59] focus:outline-none"
                        placeholder="Description"
                      />
                    </td>
                    {/* Quantity */}
                    <td className="px-3 py-2">
                      <input
                        type="number" min="0" step="0.01"
                        value={line.quantity}
                        onChange={(e) => updateLine(idx, 'quantity', e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm text-right focus:ring-1 focus:ring-[#173d59] focus:outline-none"
                      />
                    </td>
                    {/* Rate */}
                    <td className="px-3 py-2">
                      <input
                        type="number" min="0" step="0.01"
                        value={line.rate}
                        onChange={(e) => updateLine(idx, 'rate', e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm text-right focus:ring-1 focus:ring-[#173d59] focus:outline-none"
                      />
                    </td>
                    {/* VAT */}
                    <td className="px-3 py-2">
                      <input
                        type="number" min="0" max="100" step="0.01"
                        value={line.vat_percent}
                        onChange={(e) => updateLine(idx, 'vat_percent', e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm text-right focus:ring-1 focus:ring-[#173d59] focus:outline-none"
                      />
                    </td>
                    {/* Total (readonly) */}
                    <td className="px-3 py-2 text-right text-sm font-semibold text-gray-900">
                      {fmt(calcLineTotal(line))}
                    </td>
                    {/* Delete */}
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 border-t-2 border-gray-200">
                  <td colSpan={5} className="px-4 py-3 text-sm font-bold text-gray-700 text-right">Total</td>
                  <td className="px-3 py-3 text-right text-base font-bold text-[#173d59]">
                    {fmt(grandTotal)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Add New line button */}
          <div className="flex justify-end mb-6">
            <button
              type="button"
              onClick={addLine}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold bg-[#173d59] hover:bg-[#1f5075] text-white rounded-full transition-all"
            >
              <Plus className="w-4 h-4" /> Add New
            </button>
          </div>

          {/* Remarks / Note */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">
              Remarks / Note
            </label>
            <div className="border border-gray-300 rounded-xl overflow-hidden">
              {/* Simple toolbar */}
              <div className="flex items-center gap-1 px-3 py-2 bg-gray-50 border-b border-gray-200">
                <span className="text-xs text-gray-500 font-medium">Formats ▾</span>
                <div className="w-px h-4 bg-gray-300 mx-1" />
                <button type="button" onClick={() => {}} className="px-2 py-1 text-sm font-bold text-gray-600 hover:bg-gray-200 rounded">B</button>
                <button type="button" onClick={() => {}} className="px-2 py-1 text-sm italic text-gray-600 hover:bg-gray-200 rounded">I</button>
                <button type="button" onClick={() => {}} className="px-2 py-1 text-sm text-gray-600 hover:bg-gray-200 rounded">≡</button>
                <button type="button" onClick={() => {}} className="px-2 py-1 text-sm text-gray-600 hover:bg-gray-200 rounded">•</button>
                <button type="button" onClick={() => {}} className="px-2 py-1 text-sm text-gray-600 hover:bg-gray-200 rounded">1.</button>
              </div>
              <textarea
                value={form.remarks}
                onChange={(e) => setForm((p) => ({ ...p, remarks: e.target.value }))}
                rows={4}
                className="w-full px-4 py-3 text-sm focus:ring-0 focus:outline-none resize-none"
                placeholder="Add remarks or notes here…"
              />
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-6 py-3 text-sm font-semibold bg-[#173d59] hover:bg-[#1f5075] text-white rounded-full transition-all disabled:opacity-60"
            >
              {saving ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Saving…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Save
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Item picker modal */}
      {pickerOpen && (
        <ItemPickerModal
          type={type}
          onSelect={handleItemSelect}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
