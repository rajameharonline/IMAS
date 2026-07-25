// Full-page Purchase Bill form.
// কেন আলাদা route: sample screenshot-এর মতো dedicated entry screen দরকার,
// যেখানে provider, bill info, line items, note editor, আর save button একই page-এ থাকে।

import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import api from '../../utils/api';
import { asList, formatApiError, money, toInputDate } from './bandwidthHelpers';

const today = new Date();

const EMPTY_LINE = {
  item: '',
  description: '',
  unit: '',
  quantity: 0,
  rate: 0,
  vat_percent: 0,
  from_date: '',
  to_date: '',
};

const EMPTY_FORM = {
  provider: '',
  bill_no: '',
  invoice_no: '',
  billing_month: `${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`,
  discount_amount: 0,
  issue_date: today.toISOString().slice(0, 10),
  due_date: '',
  notes: '',
  file_attachment: null,
};

function calcLineTotal(line) {
  const qty = Number(line.quantity || 0);
  const rate = Number(line.rate || 0);
  const vat = Number(line.vat_percent || 0);
  const subtotal = qty * rate;
  return subtotal + (subtotal * vat) / 100;
}

function FormHeader({ title, subtitle }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}

export default function PurchaseBillFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const location = useLocation();
  const duplicateBill = location.state?.duplicateFrom || null;
  const isEdit = Boolean(id);
  const [providers, setProviders] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);

  const totalAmount = useMemo(
    () => lines.reduce((sum, line) => sum + calcLineTotal(line), 0),
    [lines],
  );

  const fetchMasters = async () => {
    try {
      const [provRes, itemRes] = await Promise.all([
        api.get('/purchase/providers/?page_size=500'),
        api.get('/inventory/items/?page_size=500'),
      ]);
      setProviders(asList(provRes.data));
      setItems(asList(itemRes.data));
    } catch (err) {
      toast.error(formatApiError(err, 'Master data লোড করা যায়নি।'));
    }
  };

  const loadBill = async () => {
    if (!isEdit || duplicateBill) return;
    try {
      const { data } = await api.get(`/purchase/provider-bills/${id}/`);
      setForm({
        provider: data.provider || '',
        bill_no: data.bill_no || '',
        invoice_no: data.invoice_no || '',
        billing_month: data.billing_month || '',
        discount_amount: data.discount_amount || 0,
        issue_date: toInputDate(data.issue_date),
        due_date: toInputDate(data.due_date),
        notes: data.notes || '',
        file_attachment: null,
      });
      setLines((data.lines || []).length ? data.lines.map((line) => ({
        item: line.item || '',
        description: line.description || '',
        unit: line.unit || '',
        quantity: line.quantity || 0,
        rate: line.rate || 0,
        vat_percent: line.vat_percent || 0,
        from_date: toInputDate(line.from_date),
        to_date: toInputDate(line.to_date),
      })) : [{ ...EMPTY_LINE }]);
    } catch (err) {
      toast.error(formatApiError(err, 'Bill load করা যায়নি।'));
    }
  };

  const applyDuplicate = () => {
    if (!duplicateBill) return;
    setForm({
      provider: duplicateBill.provider || '',
      bill_no: '',
      invoice_no: '',
      billing_month: duplicateBill.billing_month || `${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`,
      discount_amount: duplicateBill.discount_amount || 0,
      issue_date: today.toISOString().slice(0, 10),
      due_date: toInputDate(duplicateBill.due_date),
      notes: duplicateBill.notes || '',
      file_attachment: null,
    });
    setLines((duplicateBill.lines || []).length ? duplicateBill.lines.map((line) => ({
      item: line.item || '',
      description: line.description || '',
      unit: line.unit || '',
      quantity: line.quantity || 0,
      rate: line.rate || 0,
      vat_percent: line.vat_percent || 0,
      from_date: toInputDate(line.from_date),
      to_date: toInputDate(line.to_date),
    })) : [{ ...EMPTY_LINE }]);
  };

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      await fetchMasters();
      if (duplicateBill) applyDuplicate();
      else if (isEdit) await loadBill();
      setLoading(false);
    };
    run();
    // duplicateBill state explicitly used once at mount time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const addLine = () => setLines((prev) => [...prev, { ...EMPTY_LINE }]);
  const removeLine = (index) => setLines((prev) => prev.filter((_, i) => i !== index));
  const updateLine = (index, key, value) => setLines((prev) => prev.map((line, i) => (i === index ? { ...line, [key]: value } : line)));

  const buildPayload = () => {
    const fd = new FormData();
    // Serializer কেবল whitelist করা field-ই বুঝবে; অতিরিক্ত UI-only field পাঠাব না।
    if (form.provider) fd.append('provider', form.provider);
    if (form.bill_no) fd.append('bill_no', form.bill_no);
    if (form.invoice_no) fd.append('invoice_no', form.invoice_no);
    if (form.billing_month) fd.append('billing_month', form.billing_month);
    if (form.issue_date) fd.append('issue_date', form.issue_date);
    if (form.due_date) fd.append('due_date', form.due_date);
    fd.append('discount_amount', String(form.discount_amount || 0));
    if (form.notes) fd.append('notes', form.notes);
    if (form.file_attachment) fd.append('file_attachment', form.file_attachment);
    fd.set('lines_payload', JSON.stringify(lines.map((line) => ({
      ...line,
      item: line.item || null,
      quantity: Number(line.quantity || 0),
      rate: Number(line.rate || 0),
      vat_percent: Number(line.vat_percent || 0),
    }))));
    return fd;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = buildPayload();
      if (isEdit && !duplicateBill) {
        await api.patch(`/purchase/provider-bills/${id}/`, payload);
        toast.success('Bill updated.');
      } else {
        await api.post('/purchase/provider-bills/', payload);
        toast.success('Bill created.');
      }
      navigate('/bandwidth/buy/bills');
    } catch (err) {
      toast.error(formatApiError(err, 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="py-20 text-center text-slate-400">লোড হচ্ছে...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <FormHeader
          title={isEdit && !duplicateBill ? 'Edit Purchase Bill' : 'Add Purchase Bill'}
          subtitle="Bandwidth Purchase Bill"
        />
        <div className="text-right text-xs text-slate-500">
          <div className="font-semibold text-slate-700">Purchase Bill</div>
          <div>{isEdit && !duplicateBill ? 'Edit Purchase Bill' : 'Add Purchase Bill'}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <button
            onClick={() => navigate('/bandwidth/buy/bills')}
            className="inline-flex items-center gap-2 rounded-full bg-[#173d59] px-4 py-2 text-sm font-semibold text-white shadow-sm"
          >
            <ArrowLeft className="h-4 w-4" /> Back to List
          </button>
        </div>

        <form onSubmit={handleSave} className="p-4 sm:p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <label className="block md:col-span-2">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Provider</span>
              <select
                value={form.provider}
                onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                <option value="">Select</option>
                {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Bill No</span>
              <input value={form.bill_no || 'Auto generated'} disabled className="w-full rounded border border-slate-300 bg-slate-100 px-3 py-2 text-sm" />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Billing Month</span>
              <input
                value={form.billing_month}
                onChange={(e) => setForm((f) => ({ ...f, billing_month: e.target.value }))}
                placeholder="05/2026"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Payment Due</span>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Invoice No</span>
              <input
                value={form.invoice_no}
                onChange={(e) => setForm((f) => ({ ...f, invoice_no: e.target.value }))}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="block md:col-span-2">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Attachment</span>
              <input
                type="file"
                onChange={(e) => setForm((f) => ({ ...f, file_attachment: e.target.files?.[0] || null }))}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm bg-white"
              />
            </label>
          </div>

          <div className="rounded-2xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-[#23445f] text-white">
                  <tr>
                    <th className="px-3 py-3 text-left">Item</th>
                    <th className="px-3 py-3 text-left">Description</th>
                    <th className="px-3 py-3 text-left">Unit</th>
                    <th className="px-3 py-3 text-left">Quantity</th>
                    <th className="px-3 py-3 text-left">Rate</th>
                    <th className="px-3 py-3 text-left">VAT(%)</th>
                    <th className="px-3 py-3 text-left">From Date</th>
                    <th className="px-3 py-3 text-left">To Date</th>
                    <th className="px-3 py-3 text-left">Total</th>
                    <th className="px-3 py-3 text-left">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => {
                    const selectedItem = items.find((item) => String(item.id) === String(line.item));
                    return (
                      <tr key={index} className="border-b">
                        <td className="px-2 py-2">
                          <select
                            value={line.item}
                            onChange={(e) => {
                              const nextItem = items.find((item) => String(item.id) === String(e.target.value));
                              updateLine(index, 'item', e.target.value);
                              if (nextItem?.unit_name) updateLine(index, 'unit', nextItem.unit_name);
                            }}
                            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm bg-white"
                          >
                            <option value="">Select</option>
                            {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            value={line.description}
                            onChange={(e) => updateLine(index, 'description', e.target.value)}
                            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            value={line.unit || selectedItem?.unit_name || ''}
                            onChange={(e) => updateLine(index, 'unit', e.target.value)}
                            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            step="0.01"
                            value={line.quantity}
                            onChange={(e) => updateLine(index, 'quantity', e.target.value)}
                            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-center"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            step="0.01"
                            value={line.rate}
                            onChange={(e) => updateLine(index, 'rate', e.target.value)}
                            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-center"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            step="0.01"
                            value={line.vat_percent}
                            onChange={(e) => updateLine(index, 'vat_percent', e.target.value)}
                            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-center"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="date"
                            value={line.from_date}
                            onChange={(e) => updateLine(index, 'from_date', e.target.value)}
                            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="date"
                            value={line.to_date}
                            onChange={(e) => updateLine(index, 'to_date', e.target.value)}
                            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                          />
                        </td>
                        <td className="px-2 py-2 text-right font-medium">{money(calcLineTotal(line))}</td>
                        <td className="px-2 py-2 text-right">
                          <button type="button" onClick={() => removeLine(index)} className="rounded border border-slate-200 p-2 text-rose-600 hover:bg-rose-50">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t">
                    <td colSpan="8" className="px-3 py-3 text-right font-semibold">Total</td>
                    <td className="px-3 py-3 text-right font-semibold">{money(totalAmount)}</td>
                    <td className="px-3 py-3" />
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex justify-end px-4 py-3">
              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center gap-2 rounded-full bg-[#173d59] px-4 py-2 text-sm font-semibold text-white shadow-sm"
              >
                <Plus className="h-4 w-4" /> Add New
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Remarks/Note
            </div>
            <div className="border-b border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-600">
              <span className="px-2 font-semibold">Formats</span>
              <span className="px-2">B</span>
              <span className="px-2 italic">I</span>
              <span className="px-2">•</span>
              <span className="px-2">•</span>
            </div>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={5}
              className="w-full rounded-b-2xl border-0 px-4 py-3 text-sm outline-none"
              placeholder="Write remarks/notes..."
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-full bg-[#173d59] px-5 py-2.5 text-sm font-semibold text-white shadow-sm"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
