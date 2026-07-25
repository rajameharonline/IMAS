// Purchase Requisition Entry Form — multi-item, vendor suggestion per line।
// কেন আলাদা page: form-এ dynamic row add/remove, item lookup, vendor suggestion
// এবং rich-text notes — এগুলো modal-এ রাখা যায় না; full-page দরকার।

import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Plus, Trash2, CircleCheck } from 'lucide-react';
import api from '../../utils/api';
import { money, formatApiError } from '../bandwidth/bandwidthHelpers';

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY_LINE = {
  _key: Date.now(),
  item: '',
  vendor_suggestion: '',
  description: '',
  unit: '',
  quantity: 0,
  rate: 0,
  total: 0,
};

function newLine() {
  return { ...EMPTY_LINE, _key: Date.now() + Math.random() };
}

/* ── Field wrapper ─────────────────────────────────────── */
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

export default function RequisitionEntryPage() {
  const navigate   = useNavigate();
  const { id }     = useParams();
  const isEdit     = Boolean(id);

  const [items,   setItems]   = useState([]);   // inventory items lookup
  const [vendors, setVendors] = useState([]);   // vendor lookup
  const [units,   setUnits]   = useState([]);   // unit lookup

  const [header, setHeader] = useState({
    requisition_no:  '',
    requisition_date: today(),
    required_by:      today(),
    notes:            '',
    status:           'pending',
  });
  const [lines, setLines] = useState([newLine()]);
  const [saving, setSaving] = useState(false);

  /* ── Lookup data fetch ────────────────────────────────── */
  const fetchLookups = useCallback(async () => {
    try {
      const [iRes, vRes, uRes] = await Promise.all([
        api.get('/inventory/items/?page_size=500'),
        api.get('/purchase/vendors/?page_size=500'),
        api.get('/inventory/units/?page_size=200'),
      ]);
      const toArr = (d) => Array.isArray(d) ? d : (d?.results || []);
      setItems(toArr(iRes.data));
      setVendors(toArr(vRes.data));
      setUnits(toArr(uRes.data));
    } catch {
      toast.error('Lookup data লোড করা যায়নি।');
    }
  }, []);

  /* ── Load existing requisition for edit ─────────────── */
  useEffect(() => {
    fetchLookups();
    if (isEdit) {
      api.get(`/purchase/requisitions/${id}/`).then(({ data }) => {
        setHeader({
          requisition_no:   data.requisition_no || '',
          requisition_date: data.requisition_date || today(),
          required_by:      data.required_by || today(),
          notes:            data.notes || '',
          status:           data.status || 'pending',
        });
        const existingLines = (data.req_items || []).map((l) => ({
          _key:              l.id || Date.now() + Math.random(),
          item:              l.item || '',
          vendor_suggestion: l.vendor_suggestion || '',
          description:       l.description || '',
          unit:              l.unit || '',
          quantity:          l.quantity || 0,
          rate:              l.rate || 0,
          total:             l.total || 0,
        }));
        setLines(existingLines.length ? existingLines : [newLine()]);
      }).catch(() => toast.error('Requisition লোড করা যায়নি।'));
    }
  }, [id, isEdit, fetchLookups]);

  /* ── Line handlers ────────────────────────────────────── */
  const updateLine = (key, field, value) => {
    setLines((prev) => prev.map((l) => {
      if (l._key !== key) return l;
      const updated = { ...l, [field]: value };
      // Auto-fill unit from item selection
      if (field === 'item' && value) {
        const found = items.find((i) => String(i.id) === String(value));
        if (found?.unit) updated.unit = found.unit;
      }
      // Recalc total on qty/rate change
      if (field === 'quantity' || field === 'rate') {
        const qty  = parseFloat(field === 'quantity' ? value : l.quantity) || 0;
        const rate = parseFloat(field === 'rate'     ? value : l.rate)     || 0;
        updated.total = qty * rate;
      }
      return updated;
    }));
  };

  const addLine  = () => setLines((p) => [...p, newLine()]);
  const delLine  = (key) => setLines((p) => p.filter((l) => l._key !== key));

  const grandTotal = lines.reduce((s, l) => s + (parseFloat(l.total) || 0), 0);

  /* ── Submit ───────────────────────────────────────────── */
  const handleSave = async () => {
    if (!header.requisition_date) { toast.error('Requisition Date required.'); return; }
    const validLines = lines.filter((l) => l.item || l.description);
    if (!validLines.length) { toast.error('At least one item is required.'); return; }

    setSaving(true);
    const payload = {
      ...header,
      req_items_payload: validLines.map(({ _key, ...l }) => ({
        item:              l.item || null,
        vendor_suggestion: l.vendor_suggestion || null,
        description:       l.description,
        unit:              l.unit || null,
        quantity:          parseFloat(l.quantity) || 0,
        rate:              parseFloat(l.rate) || 0,
      })),
    };

    try {
      if (isEdit) {
        await api.patch(`/purchase/requisitions/${id}/`, payload);
        toast.success('Requisition updated.');
      } else {
        await api.post('/purchase/requisitions/', payload);
        toast.success('Requisition created.');
      }
      navigate('/purchase/requisition');
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
        <button onClick={() => navigate('/purchase/requisition')}
          className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 transition-all">
          <ArrowLeft className="h-4 w-4" /> Back to List
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Requisition Entry</h1>
          <p className="text-xs text-slate-500">Create Purchasable Requisition</p>
        </div>
      </div>

      {/* Main Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">

        {/* Header Fields */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Requisition ID">
            <input readOnly value={header.requisition_no || 'Auto Generated'}
              className={`${inputCls} bg-gray-50 text-slate-400 cursor-not-allowed`} />
          </Field>
          <Field label="Requisition Date" required>
            <input type="date" value={header.requisition_date}
              onChange={(e) => setHeader((h) => ({ ...h, requisition_date: e.target.value }))}
              className={inputCls} />
          </Field>
          <Field label="Requisition Need By Date">
            <input type="date" value={header.required_by}
              onChange={(e) => setHeader((h) => ({ ...h, required_by: e.target.value }))}
              className={inputCls} />
          </Field>
        </div>

        {/* Line Items Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead className="bg-[#23445f] text-white">
              <tr>
                {['Item', 'Vendor Suggestion', 'Description', 'Unit', 'Quantity', 'Rate', 'Total', 'Action']
                  .map((h) => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">
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
                    <div className="flex items-center gap-1">
                      <select value={line.item} onChange={(e) => updateLine(line._key, 'item', e.target.value)}
                        className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs w-36 outline-none focus:ring-1 focus:ring-sky-400 bg-white">
                        <option value="">— Select —</option>
                        {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                      </select>
                    </div>
                  </td>
                  {/* Vendor Suggestion */}
                  <td className="px-2 py-2">
                    <select value={line.vendor_suggestion}
                      onChange={(e) => updateLine(line._key, 'vendor_suggestion', e.target.value)}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs w-36 outline-none focus:ring-1 focus:ring-sky-400 bg-white">
                      <option value="">Select</option>
                      {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </td>
                  {/* Description */}
                  <td className="px-2 py-2">
                    <input value={line.description}
                      onChange={(e) => updateLine(line._key, 'description', e.target.value)}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs w-40 outline-none focus:ring-1 focus:ring-sky-400" />
                  </td>
                  {/* Unit */}
                  <td className="px-2 py-2">
                    <select value={line.unit} onChange={(e) => updateLine(line._key, 'unit', e.target.value)}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs w-24 outline-none focus:ring-1 focus:ring-sky-400 bg-white">
                      <option value="">Select</option>
                      {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </td>
                  {/* Quantity */}
                  <td className="px-2 py-2">
                    <input type="number" min="0" value={line.quantity}
                      onChange={(e) => updateLine(line._key, 'quantity', e.target.value)}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs w-20 outline-none focus:ring-1 focus:ring-sky-400 text-right" />
                  </td>
                  {/* Rate */}
                  <td className="px-2 py-2">
                    <input type="number" min="0" value={line.rate}
                      onChange={(e) => updateLine(line._key, 'rate', e.target.value)}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs w-24 outline-none focus:ring-1 focus:ring-sky-400 text-right" />
                  </td>
                  {/* Total */}
                  <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-slate-700 whitespace-nowrap">
                    {money(line.total)}
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
                <td colSpan={5} className="px-4 py-3 text-right font-semibold text-slate-700 text-sm">Total</td>
                <td className="px-3 py-3 text-right font-bold font-mono text-slate-800 whitespace-nowrap">
                  {money(grandTotal)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Add Row Button */}
        <div className="flex justify-end">
          <button onClick={addLine}
            className="inline-flex items-center gap-2 rounded-xl bg-[#173d59] hover:bg-[#1f5075] px-4 py-2 text-sm font-semibold text-white transition-all">
            <Plus className="h-4 w-4" /> Add New
          </button>
        </div>

        {/* Remarks / Note */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Remarks / Note
          </label>
          <textarea rows={4} value={header.notes}
            onChange={(e) => setHeader((h) => ({ ...h, notes: e.target.value }))}
            placeholder="Optional notes or remarks..."
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400 resize-none" />
        </div>

        {/* Save Button */}
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
