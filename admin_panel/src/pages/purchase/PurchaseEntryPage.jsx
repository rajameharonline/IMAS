// Purchase Entry Form — ISP hardware purchase (Router, ONU, Cable, Accessories)।
// কেন এই fields: ISP-এ Router/ONU কিনলে serial number track করতে হয়,
// cable/fiber কিনলে store room record রাখতে হয়, VAT প্রতি item-এ আলাদা।
// Sequenceable toggle: serial/MAC track করার জন্য।

import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Plus, Trash2, CircleCheck } from 'lucide-react';
import api from '../../utils/api';
import { money, formatApiError } from '../bandwidth/bandwidthHelpers';

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY_LINE = {
  _key: Date.now(),
  item: '', description: '',
  sequenceable: false, starts_with: '', serial_mac: '',
  store: '', unit: '',
  quantity: 0, unit_price: 0, vat_percent: 0,
  total_price: 0, total_amount: 0,
};

function newLine() {
  return { ...EMPTY_LINE, _key: Date.now() + Math.random() };
}

function calcLine(l) {
  const qty  = parseFloat(l.quantity)   || 0;
  const rate = parseFloat(l.unit_price) || 0;
  const vat  = parseFloat(l.vat_percent) || 0;
  const tp   = qty * rate;
  return { ...l, total_price: tp, total_amount: tp + (tp * vat / 100) };
}

/* ── Toggle Switch ─────────────────────────────────────── */
function Toggle({ checked, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none
        ${checked ? 'bg-teal-500' : 'bg-gray-200'}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform
        ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

/* ── Field label ───────────────────────────────────────── */
function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ' +
  'focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400 bg-white';

export default function PurchaseEntryPage() {
  const navigate = useNavigate();
  const { id }   = useParams();
  const isEdit   = Boolean(id);

  /* Lookup data */
  const [items,   setItems]   = useState([]);
  const [vendors, setVendors] = useState([]);
  const [units,   setUnits]   = useState([]);
  const [stores,  setStores]  = useState([]);

  /* Form state */
  const [header, setHeader] = useState({
    order_no:   '',
    vendor:     '',
    order_date: today(),
    notes:      '',
  });
  const [lines, setLines] = useState([newLine()]);
  const [saving, setSaving] = useState(false);

  /* ── Load lookup data ─────────────────────────────────── */
  const fetchLookups = useCallback(async () => {
    try {
      const [iR, vR, uR, sR] = await Promise.all([
        api.get('/inventory/items/?page_size=500'),
        api.get('/purchase/vendors/?page_size=500'),
        api.get('/inventory/units/?page_size=200'),
        api.get('/inventory/stores/?page_size=200'),
      ]);
      const arr = (d) => Array.isArray(d) ? d : (d?.results || []);
      setItems(arr(iR.data));
      setVendors(arr(vR.data));
      setUnits(arr(uR.data));
      setStores(arr(sR.data));
    } catch {
      toast.error('Lookup data লোড করা যায়নি।');
    }
  }, []);

  /* ── Load existing order for edit ─────────────────────── */
  useEffect(() => {
    fetchLookups();
    if (isEdit) {
      api.get(`/purchase/orders/${id}/`).then(({ data }) => {
        setHeader({
          order_no:   data.order_no   || '',
          vendor:     data.vendor     || '',
          order_date: data.order_date || today(),
          notes:      data.notes      || '',
        });
        const existingLines = (data.items || []).map((l) => ({
          _key:         l.id || Date.now() + Math.random(),
          item:         l.item         || '',
          description:  l.description  || '',
          sequenceable: !!l.sequenceable,
          starts_with:  l.starts_with  || '',
          serial_mac:   l.serial_mac   || '',
          store:        l.store        || '',
          unit:         l.unit         || '',
          quantity:     l.quantity     || 0,
          unit_price:   l.unit_price   || 0,
          vat_percent:  l.vat_percent  || 0,
          total_price:  l.total_price  || 0,
          total_amount: l.total_amount || 0,
        }));
        setLines(existingLines.length ? existingLines : [newLine()]);
      }).catch(() => toast.error('Order লোড করা যায়নি।'));
    }
  }, [id, isEdit, fetchLookups]);

  /* ── Line update ──────────────────────────────────────── */
  const updateLine = (key, field, value) => {
    setLines((prev) => prev.map((l) => {
      if (l._key !== key) return l;
      let updated = { ...l, [field]: value };
      // Auto-fill unit from selected item
      if (field === 'item' && value) {
        const found = items.find((i) => String(i.id) === String(value));
        if (found?.unit) updated.unit = found.unit;
        if (found?.vat_percent != null) updated.vat_percent = found.vat_percent;
      }
      return calcLine(updated);
    }));
  };

  const addLine  = () => setLines((p) => [...p, newLine()]);
  const delLine  = (key) => setLines((p) => p.length > 1 ? p.filter((l) => l._key !== key) : p);

  const grandTotal    = lines.reduce((s, l) => s + (parseFloat(l.total_amount) || 0), 0);
  const grandSubtotal = lines.reduce((s, l) => s + (parseFloat(l.total_price)  || 0), 0);
  const grandVAT      = grandTotal - grandSubtotal;

  /* ── Save ─────────────────────────────────────────────── */
  const handleSave = async () => {
    if (!header.vendor)      { toast.error('Vendor required.');       return; }
    if (!header.order_date)  { toast.error('Purchase Date required.'); return; }
    const validLines = lines.filter((l) => l.item || l.description);
    if (!validLines.length)  { toast.error('At least one item required.'); return; }

    setSaving(true);
    const payload = {
      ...header,
      items_payload: validLines.map(({ _key, ...l }) => ({
        item:         l.item        || null,
        description:  l.description,
        sequenceable: !!l.sequenceable,
        starts_with:  l.starts_with,
        serial_mac:   l.serial_mac,
        store:        l.store       || null,
        unit:         l.unit        || null,
        quantity:     parseFloat(l.quantity)    || 0,
        unit_price:   parseFloat(l.unit_price)  || 0,
        vat_percent:  parseFloat(l.vat_percent) || 0,
      })),
    };

    try {
      if (isEdit) {
        await api.patch(`/purchase/orders/${id}/`, payload);
        toast.success('Purchase updated.');
      } else {
        await api.post('/purchase/orders/', payload);
        toast.success('Purchase created.');
      }
      navigate('/purchase/list');
    } catch (err) {
      toast.error(formatApiError(err, 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  /* ── Render ───────────────────────────────────────────── */
  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex items-center gap-4 flex-wrap">
        <button onClick={() => navigate('/purchase/list')}
          className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 transition-all">
          <ArrowLeft className="h-4 w-4" /> Back to List
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Purchase Entry</h1>
          <p className="text-xs text-slate-500">Purchase Entry</p>
        </div>
      </div>

      {/* Main Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">

        {/* Header Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Purchase ID">
            <input readOnly value={header.order_no || 'Auto Generated'}
              className={`${inputCls} bg-gray-50 text-slate-400 cursor-not-allowed`} />
          </Field>
          <Field label="Purchase Date" required>
            <input type="date" value={header.order_date}
              onChange={(e) => setHeader((h) => ({ ...h, order_date: e.target.value }))}
              className={inputCls} />
          </Field>
          <Field label="Vendor" required>
            <select value={header.vendor}
              onChange={(e) => setHeader((h) => ({ ...h, vendor: e.target.value }))}
              className={inputCls}>
              <option value="">Select</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
        </div>

        {/* Line Items Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[1100px] border-collapse text-xs">
            <thead className="bg-[#23445f] text-white">
              <tr>
                {[
                  'Item', 'Description', 'Sequenceable', 'Starts with',
                  'Serial/Mac', 'Store Room', 'Unit', 'Quantity',
                  'Rate', 'VAT(%)', 'Total', 'Action',
                ].map((h) => (
                  <th key={h} className="px-2 py-3 text-left text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((line, idx) => (
                <tr key={line._key}
                  className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                  {/* Item */}
                  <td className="px-2 py-2">
                    <select value={line.item}
                      onChange={(e) => updateLine(line._key, 'item', e.target.value)}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs w-36 outline-none focus:ring-1 focus:ring-sky-400 bg-white">
                      <option value="">Select</option>
                      {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                  </td>
                  {/* Description */}
                  <td className="px-2 py-2">
                    <input value={line.description}
                      onChange={(e) => updateLine(line._key, 'description', e.target.value)}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs w-32 outline-none focus:ring-1 focus:ring-sky-400" />
                  </td>
                  {/* Sequenceable toggle */}
                  <td className="px-2 py-2 text-center">
                    <Toggle
                      checked={line.sequenceable}
                      onChange={(v) => updateLine(line._key, 'sequenceable', v)}
                    />
                  </td>
                  {/* Starts with */}
                  <td className="px-2 py-2">
                    <input value={line.starts_with}
                      disabled={!line.sequenceable}
                      onChange={(e) => updateLine(line._key, 'starts_with', e.target.value)}
                      placeholder={line.sequenceable ? 'e.g. RTR-' : '—'}
                      className={`rounded-lg border border-slate-300 px-2 py-1.5 text-xs w-24 outline-none focus:ring-1 focus:ring-sky-400
                        ${!line.sequenceable ? 'bg-gray-50 text-slate-300 cursor-not-allowed' : ''}`} />
                  </td>
                  {/* Serial/MAC */}
                  <td className="px-2 py-2">
                    <input value={line.serial_mac}
                      disabled={!line.sequenceable}
                      onChange={(e) => updateLine(line._key, 'serial_mac', e.target.value)}
                      placeholder={line.sequenceable ? 'Serial / MAC' : '—'}
                      className={`rounded-lg border border-slate-300 px-2 py-1.5 text-xs w-32 outline-none focus:ring-1 focus:ring-sky-400
                        ${!line.sequenceable ? 'bg-gray-50 text-slate-300 cursor-not-allowed' : ''}`} />
                  </td>
                  {/* Store Room */}
                  <td className="px-2 py-2">
                    <select value={line.store}
                      onChange={(e) => updateLine(line._key, 'store', e.target.value)}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs w-28 outline-none focus:ring-1 focus:ring-sky-400 bg-white">
                      <option value=""></option>
                      {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </td>
                  {/* Unit */}
                  <td className="px-2 py-2">
                    <select value={line.unit}
                      onChange={(e) => updateLine(line._key, 'unit', e.target.value)}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs w-20 outline-none focus:ring-1 focus:ring-sky-400 bg-white">
                      <option value="">Select</option>
                      {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </td>
                  {/* Quantity */}
                  <td className="px-2 py-2">
                    <input type="number" min="0" value={line.quantity}
                      onChange={(e) => updateLine(line._key, 'quantity', e.target.value)}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs w-16 outline-none focus:ring-1 focus:ring-sky-400 text-right" />
                  </td>
                  {/* Rate */}
                  <td className="px-2 py-2">
                    <input type="number" min="0" value={line.unit_price}
                      onChange={(e) => updateLine(line._key, 'unit_price', e.target.value)}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs w-24 outline-none focus:ring-1 focus:ring-sky-400 text-right" />
                  </td>
                  {/* VAT(%) */}
                  <td className="px-2 py-2">
                    <input type="number" min="0" max="100" value={line.vat_percent}
                      onChange={(e) => updateLine(line._key, 'vat_percent', e.target.value)}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs w-16 outline-none focus:ring-1 focus:ring-sky-400 text-right" />
                  </td>
                  {/* Total */}
                  <td className="px-2 py-2 text-right font-mono font-semibold text-slate-700 whitespace-nowrap">
                    {money(line.total_amount)}
                  </td>
                  {/* Delete */}
                  <td className="px-2 py-2 text-center">
                    <button onClick={() => delLine(line._key)}
                      className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-rose-500 hover:bg-rose-50">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-gray-50">
                <td colSpan={9} className="px-3 py-3 text-right font-semibold text-slate-700 text-xs">Total</td>
                <td colSpan={2} className="px-2 py-3 text-right font-bold font-mono text-slate-800 whitespace-nowrap text-sm">
                  {money(grandTotal)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Add Row + Summary */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <button onClick={addLine}
            className="inline-flex items-center gap-2 rounded-xl bg-[#173d59] hover:bg-[#1f5075] px-4 py-2 text-sm font-semibold text-white transition-all">
            <Plus className="h-4 w-4" /> Add New
          </button>
          {/* Running totals summary */}
          <div className="flex items-center gap-4 text-sm text-slate-600 font-mono">
            <span>Subtotal: <strong className="text-slate-800">৳ {money(grandSubtotal)}</strong></span>
            <span>VAT: <strong className="text-amber-600">৳ {money(grandVAT)}</strong></span>
            <span>Total: <strong className="text-[#173d59] text-base">৳ {money(grandTotal)}</strong></span>
          </div>
        </div>

        {/* Remarks */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Remarks / Note
          </label>
          <textarea rows={4} value={header.notes}
            onChange={(e) => setHeader((h) => ({ ...h, notes: e.target.value }))}
            placeholder="Optional notes..."
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400 resize-none" />
        </div>

        {/* Save */}
        <div className="flex justify-end">
          <button onClick={handleSave} disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-[#173d59] hover:bg-[#1f5075] px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all disabled:opacity-50">
            <CircleCheck className="h-5 w-5" />
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
