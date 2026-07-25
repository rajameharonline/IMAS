// Purchase Bill page.
// কেন এই file আলাদা: screenshot-এর মতো একসাথে summary cards, filter strip,
// line-item based create/edit modal, payment flow, invoice download, duplicate
// action, আর export buttons একই screen-এ রাখতে হলে dedicated component দরকার।

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, RefreshCw, SquarePen, Trash2, Download, CreditCard, Copy, ChevronDown, FileText } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import api from '../../utils/api';
import { asList, downloadBlob, formatApiError, money, toInputDate } from './bandwidthHelpers';

const today = new Date();

function monthLabel(date = new Date()) {
  // UI-এর summary chips-এ screenshot-এর মতো month label দেখানোর জন্য helper।
  const m = date.toLocaleString('en-US', { month: 'short' });
  return `${m}-${date.getFullYear()}`;
}

function currentBillingMonth() {
  // Sample অনুযায়ী input-এ 05/2026 format রাখা হচ্ছে।
  return `${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
}

function calcLineTotal(line) {
  const qty = Number(line.quantity || 0);
  const rate = Number(line.rate || 0);
  const vat = Number(line.vat_percent || 0);
  const amount = qty * rate;
  const tax = amount * (vat / 100);
  return amount + tax;
}

function calcSummary(rows) {
  return rows.reduce(
    (acc, bill) => {
      const amount = Number(bill.amount || 0);
      const paid = Number(bill.paid_amount || 0);
      const due = Number(bill.due_amount || 0);
      const discount = Number(bill.discount_amount || 0);
      acc.billCount += 1;
      acc.amount += amount;
      acc.paid += paid;
      acc.due += due;
      acc.discount += discount;
      if (String(bill.status) === 'paid') acc.paidCount += 1;
      if (String(bill.status) === 'partial') acc.partialCount += 1;
      if (String(bill.status) === 'unpaid') acc.unpaidCount += 1;
      if (['unpaid', 'partial'].includes(String(bill.status))) acc.dueCount += 1;
      return acc;
    },
    { billCount: 0, amount: 0, paid: 0, due: 0, discount: 0, dueCount: 0, paidCount: 0, partialCount: 0, unpaidCount: 0 },
  );
}

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
  billing_month: currentBillingMonth(),
  payment_due: '',
  discount_amount: 0,
  issue_date: today.toISOString().slice(0, 10),
  due_date: '',
  notes: '',
  file_attachment: null,
};

function Modal({ open, title, onClose, children, footer, widthClass = 'max-w-7xl' }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-4">
      <div className={`w-full ${widthClass} max-h-[92vh] overflow-auto rounded-2xl bg-white shadow-2xl`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h3 className="text-lg font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="p-4 sm:p-6">{children}</div>
        <div className="border-t border-slate-200 bg-slate-50 px-5 py-4">{footer}</div>
      </div>
    </div>
  );
}

function StatCard({ label, leftValue, rightValue, month, rightLabel = 'Filtered Invoice', accent = 'sky', onClick }) {
  const accents = {
    sky: 'from-sky-500 to-cyan-600',
    teal: 'from-teal-500 to-emerald-600',
    violet: 'from-violet-500 to-indigo-600',
    slate: 'from-slate-500 to-slate-600',
  };
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-md p-3 text-left text-white shadow-sm transition hover:shadow-md bg-gradient-to-br ${accents[accent]}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide opacity-95">{label}</p>
          <p className="mt-2 text-2xl font-bold leading-none">{leftValue}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold opacity-95">{rightValue}</p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] font-medium opacity-95">
        <span>{month}</span>
        <span>{rightLabel}</span>
      </div>
    </button>
  );
}

function StatusBadge({ status }) {
  const cls = status === 'paid'
    ? 'bg-emerald-600 text-white'
    : status === 'partial'
      ? 'bg-amber-500 text-white'
      : 'bg-rose-500 text-white';
  return <span className={`inline-flex rounded px-2 py-1 text-xs font-semibold capitalize ${cls}`}>{status}</span>;
}

/* ── Mobile Purchase Bill Card ── */
function MobilePurchaseBillCard({ bill, idx, navigate, money, renderActionButtons, setPaymentTarget, setPaymentAmount, setPaymentMethod, setPaymentDesc, setPaymentOpen }) {
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
      {/* Header: Provider + Bill No + Status */}
      <div className="flex items-start justify-between gap-2 px-3 py-2.5 bg-[#23445f]/5 border-b border-gray-200">
        <div className="min-w-0">
          <button onClick={() => navigate(`/bandwidth/buy/providers/${bill.provider}`)}
            className="font-bold text-[13px] text-sky-700 hover:underline truncate block">{bill.provider_name}</button>
          <p className="text-[11px] text-gray-400 truncate">{bill.provider_contact_person || ''}</p>
        </div>
        <StatusBadge status={bill.status} />
      </div>
      {/* 2-col: Bill No + Invoice No */}
      <div className="grid grid-cols-2 divide-x divide-gray-200 border-b border-gray-200">
        <div className="flex flex-col min-w-0 px-3 py-2.5">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Bill No</span>
          <span className="font-mono text-[12px] font-semibold text-gray-800 truncate">{bill.bill_no}</span>
        </div>
        <div className="flex flex-col min-w-0 px-3 py-2.5">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Invoice No</span>
          <span className="font-mono text-[12px] text-gray-700 truncate">{bill.invoice_no || '—'}</span>
        </div>
      </div>
      {/* Financial FRows */}
      <div>
        <FRow label="Bill Month"><span className="text-[12px] text-gray-700">{bill.billing_month || '—'}</span></FRow>
        <FRow label="Bill Amount"><span className="font-mono text-[12px] font-semibold text-gray-800">{money(bill.amount)}</span></FRow>
        <FRow label="Paid"><span className="font-mono text-[12px] text-emerald-600">{money(bill.paid_amount)}</span></FRow>
        <FRow label="Discount"><span className="font-mono text-[12px] text-gray-600">{money(bill.discount_amount)}</span></FRow>
        <FRow label="Due">
          <span className="font-mono text-[12px] font-bold text-rose-600">{money(bill.due_amount)}</span>
        </FRow>
      </div>
      {/* Footer: Pay + Actions */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50/60 border-t border-gray-200 flex-wrap">
        {(bill.status === 'unpaid' || bill.status === 'partial') && (
          <button
            onClick={() => { setPaymentTarget(bill); setPaymentAmount(String(bill.due_amount || 0)); setPaymentMethod('cash'); setPaymentDesc(''); setPaymentOpen(true); }}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[#173d59] text-white hover:bg-[#1c2f44]">
            Pay
          </button>
        )}
        <div className="ml-auto">{renderActionButtons(bill)}</div>
      </div>
    </div>
  );
}

export default function ProviderBillListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [bills, setBills] = useState([]);
  const [providers, setProviders] = useState([]);
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({
    bill_count: 0,
    bill_amount: 0,
    discount_amount: 0,
    due_count: 0,
    due_amount: 0,
    paid_count: 0,
    paid_amount: 0,
    cash_on_hand: 0,
  });
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [pageSize, setPageSize] = useState(25);
  const [filters, setFilters] = useState({
    status: searchParams.get('status') || '',
    provider: searchParams.get('provider') || '',
    month: searchParams.get('month') || '',
    search: searchParams.get('search') || '',
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentDesc, setPaymentDesc] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [billRes, provRes, itemRes, summaryRes] = await Promise.all([
        api.get('/purchase/provider-bills/?page_size=500'),
        api.get('/purchase/providers/?page_size=500'),
        api.get('/inventory/items/?page_size=500'),
        api.get('/purchase/provider-bills/dashboard-stats/'),
      ]);
      setBills(asList(billRes.data));
      setProviders(asList(provRes.data));
      setItems(asList(itemRes.data));
      setSummary((prev) => ({ ...prev, ...(summaryRes.data || {}) }));
    } catch (err) {
      toast.error(formatApiError(err, 'Bill list লোড করা যায়নি।'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    setFilters({
      status: searchParams.get('status') || '',
      provider: searchParams.get('provider') || '',
      month: searchParams.get('month') || '',
      search: searchParams.get('search') || '',
    });
  }, [searchParams]);

  const filteredBills = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return bills.filter((bill) => {
      const statusMatch = !filters.status
        ? true
        : filters.status === 'due'
          ? ['unpaid', 'partial'].includes(String(bill.status))
          : String(bill.status) === filters.status;
      const providerMatch = !filters.provider || String(bill.provider) === String(filters.provider);
      const monthMatch = !filters.month || String(bill.billing_month || '').toLowerCase().includes(filters.month.toLowerCase());
      const searchMatch = !q || [
        bill.bill_no,
        bill.invoice_no,
        bill.provider_name,
        bill.provider_contact_person,
        bill.billing_month,
      ].some((value) => String(value || '').toLowerCase().includes(q));
      return statusMatch && providerMatch && monthMatch && searchMatch;
    });
  }, [bills, filters]);

  const filteredSummary = useMemo(() => calcSummary(filteredBills), [filteredBills]);
  const totalSummary = useMemo(() => calcSummary(bills), [bills]);
  const visibleBills = useMemo(() => filteredBills.slice(0, pageSize), [filteredBills, pageSize]);
  const currentMonthText = monthLabel(today);

  const syncUrlFilters = (patch) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    const params = new URLSearchParams();
    Object.entries(next).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    setSearchParams(params, { replace: true });
  };

  const openCreate = () => {
    // Screenshot-এর মতো dedicated form page-এ নেওয়া হচ্ছে; modal flow আর রাখা হচ্ছে না।
    navigate('/bandwidth/buy/bills/new');
  };

  const openEdit = (bill) => {
    navigate(`/bandwidth/buy/bills/${bill.id}/edit`);
  };

  const openDuplicate = (bill) => {
    // Duplicate button-এর উদ্দেশ্য: same provider + same line items দ্রুত clone করা।
    navigate('/bandwidth/buy/bills/new', { state: { duplicateFrom: bill } });
  };

  const addLine = () => setLines((prev) => [...prev, { ...EMPTY_LINE }]);
  const removeLine = (index) => setLines((prev) => prev.filter((_, i) => i !== index));
  const updateLine = (index, key, value) => setLines((prev) => prev.map((line, i) => (i === index ? { ...line, [key]: value } : line)));

  const buildPayload = () => {
    const fd = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (key === 'file_attachment') {
        if (value) fd.append(key, value);
        return;
      }
      if (value !== null && value !== undefined && value !== '') fd.append(key, value);
    });
    fd.set('provider', form.provider || '');
    fd.set('discount_amount', String(form.discount_amount || 0));
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
      if (editing) {
        await api.patch(`/purchase/provider-bills/${editing.id}/`, payload);
        toast.success('Bill updated.');
      } else {
        await api.post('/purchase/provider-bills/', payload);
        toast.success('Bill created.');
      }
      setModalOpen(false);
      fetchData();
    } catch (err) {
      toast.error(formatApiError(err, 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  const handlePayment = async () => {
    if (!paymentTarget) return;
    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) return toast.error('Valid payment amount দিন।');
    try {
      await api.post(`/purchase/provider-bills/${paymentTarget.id}/pay/`, {
        amount,
        payment_date: today.toISOString().slice(0, 10),
        payment_method: paymentMethod,
        description: paymentDesc,
      });
      toast.success('Payment posted.');
      setPaymentOpen(false);
      fetchData();
    } catch (err) {
      toast.error(formatApiError(err, 'Payment failed.'));
    }
  };

  const handleDelete = async (bill) => {
    if (!confirm(`Delete bill ${bill.bill_no}?`)) return;
    try {
      await api.delete(`/purchase/provider-bills/${bill.id}/`);
      toast.success('Deleted.');
      fetchData();
    } catch (err) {
      toast.error(formatApiError(err, 'Delete failed.'));
    }
  };

  const openInvoice = (bill) => {
    // Direct download-এর বদলে invoice preview screen-এ নিয়ে যাচ্ছি।
    // সেখানে top-right button থেকেই sample-এর মতো Download PDF action হবে।
    navigate(`/bandwidth/buy/bills/${bill.id}/invoice`);
  };

  const exportCsv = () => {
    // Screenshot button-এর CSV action: filtered rows থেকে quick spreadsheet export।
    const rows = filteredBills.map((bill, index) => ({
      SN: index + 1,
      Provider: bill.provider_name,
      ContactPerson: bill.provider_contact_person,
      BillNo: bill.bill_no,
      ProviderInvoice: bill.invoice_no,
      BillMonth: bill.billing_month,
      BillAmount: Number(bill.amount || 0),
      PaidAmount: Number(bill.paid_amount || 0),
      Discount: Number(bill.discount_amount || 0),
      Due: Number(bill.due_amount || 0),
      Status: bill.status,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Purchase Bills');
    XLSX.writeFile(wb, `purchase-bills-${today.toISOString().slice(0, 10)}.csv`, { bookType: 'csv' });
  };

  const exportPdf = () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    doc.setFontSize(16);
    doc.text('Purchase Bill', 40, 36);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 52);
    autoTable(doc, {
      startY: 70,
      head: [[
        'SN',
        'Provider',
        'Contact Person',
        'Bill No',
        'Provider Invoice',
        'Bill Month',
        'Bill Amount',
        'Paid Amount',
        'Discount',
        'Due',
        'Status',
      ]],
      body: filteredBills.map((bill, index) => ([
        index + 1,
        bill.provider_name,
        bill.provider_contact_person || '',
        bill.bill_no,
        bill.invoice_no,
        bill.billing_month || '',
        money(bill.amount),
        money(bill.paid_amount),
        money(bill.discount_amount),
        money(bill.due_amount),
        bill.status,
      ])),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [35, 68, 95] },
    });
    doc.save(`purchase-bills-${today.toISOString().slice(0, 10)}.pdf`);
  };

  const renderActionButtons = (bill) => (
    <div className="flex items-center justify-end gap-1.5">
      <button
        onClick={() => openInvoice(bill)}
        className="rounded border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-50"
        title="Open Invoice"
      >
        <FileText className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => openDuplicate(bill)}
        className="rounded border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-50"
        title="Duplicate"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => openEdit(bill)}
        className="rounded border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-50"
        title="Edit"
      >
        <SquarePen className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => handleDelete(bill)}
        className="rounded border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-50"
        title="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Purchase Bill</h1>
          <p className="text-xs text-slate-500">Provider invoice lifecycle, due tracking, payment posting, and invoice download</p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <button
            onClick={exportPdf}
            className="inline-flex items-center gap-2 rounded-full bg-[#173d59] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:shadow"
          >
            Generate PDF
          </button>
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-2 rounded-full bg-[#173d59] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:shadow"
          >
            Generate CSV
          </button>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-full bg-[#173d59] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:shadow"
          >
            <Plus className="h-4 w-4" /> Bill
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <StatCard
              label="Total Purchase Amount"
              leftValue={`৳ ${money(filteredSummary.amount)}`}
              rightValue={`৳ ${money(totalSummary.amount)}`}
              month={currentMonthText}
              accent="sky"
              onClick={() => syncUrlFilters({ status: '', provider: '', month: '', search: '' })}
            />
            <StatCard
              label="Paid Amount"
              leftValue={`৳ ${money(filteredSummary.paid)}`}
              rightValue={`৳ ${money(totalSummary.paid)}`}
              month={currentMonthText}
              accent="teal"
              onClick={() => syncUrlFilters({ status: 'paid' })}
            />
            <StatCard
              label="Due Amount"
              leftValue={`৳ ${money(filteredSummary.due)}`}
              rightValue={`৳ ${money(totalSummary.due)}`}
              month={currentMonthText}
              accent="violet"
              onClick={() => syncUrlFilters({ status: 'due' })}
            />
            <StatCard
              label="Discount Amount"
              leftValue={`৳ ${money(filteredSummary.discount)}`}
              rightValue={`৳ ${money(totalSummary.discount)}`}
              month={currentMonthText}
              accent="slate"
              onClick={() => syncUrlFilters({})}
            />
          </div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3">
            <StatCard
              label="Total Invoice"
              leftValue={filteredSummary.billCount}
              rightValue={summary.bill_count || 0}
              month={currentMonthText}
              rightLabel="Filtered Invoice"
              accent="sky"
              onClick={() => syncUrlFilters({})}
            />
            <StatCard
              label="Paid Invoice"
              leftValue={filteredSummary.paidCount}
              rightValue={summary.paid_count || 0}
              month={currentMonthText}
              accent="teal"
              onClick={() => syncUrlFilters({ status: 'paid' })}
            />
            <StatCard
              label="Due Invoice"
              leftValue={filteredSummary.dueCount}
              rightValue={summary.due_count || 0}
              month={currentMonthText}
              accent="violet"
              onClick={() => syncUrlFilters({ status: 'due' })}
            />
            <StatCard
              label="Unpaid Invoice"
              leftValue={filteredSummary.unpaidCount}
              rightValue={summary.unpaid_count || filteredSummary.unpaidCount}
              month={currentMonthText}
              accent="slate"
              onClick={() => syncUrlFilters({ status: 'unpaid' })}
            />
          </div>
        </div>

        <div className="px-4 py-4">
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => setShowFilters((prev) => !prev)}
              className="inline-flex items-center gap-2 rounded-full bg-[#173d59] px-5 py-2 text-sm font-semibold text-white shadow-sm"
            >
              {showFilters ? 'Hide' : 'Show'}
              {/* বাংলায় মন্তব্য: বোতাম ক্লিক করলে ফিল্টার strip খুলবে/বন্ধ হবে,
                  তাই arrow icon-ও একই state অনুযায়ী rotate হচ্ছে। */}
              <ChevronDown className={`h-4 w-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {showFilters && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Month</span>
                <input
                  value={filters.month}
                  onChange={(e) => syncUrlFilters({ month: e.target.value })}
                  placeholder="MM/YYYY"
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500/20"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Status</span>
                <select
                  value={filters.status}
                  onChange={(e) => syncUrlFilters({ status: e.target.value })}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm bg-white"
                >
                  <option value="">Select</option>
                  <option value="paid">Paid</option>
                  <option value="partial">Partial</option>
                  <option value="unpaid">Unpaid</option>
                  <option value="due">Due</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Provider</span>
                <select
                  value={filters.provider}
                  onChange={(e) => syncUrlFilters({ provider: e.target.value })}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm bg-white"
                >
                  <option value="">Select</option>
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.name}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span>Show</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm bg-white"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span>entries</span>
            </div>
            <div className="md:w-64">
              <input
                value={filters.search}
                onChange={(e) => syncUrlFilters({ search: e.target.value })}
                placeholder="Search..."
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          {loading ? (
            <div className="py-16 text-center text-slate-400 text-sm">লোড হচ্ছে...</div>
          ) : (
            <>
            {/* Mobile Cards */}
            <div className="md:hidden space-y-2 p-3">
              {visibleBills.length === 0
                ? <p className="text-center py-8 text-slate-400 text-sm">No bill found.</p>
                : visibleBills.map((bill, idx) => (
                    <MobilePurchaseBillCard key={bill.id} bill={bill} idx={idx}
                      navigate={navigate} money={money}
                      renderActionButtons={renderActionButtons}
                      setPaymentTarget={setPaymentTarget} setPaymentAmount={setPaymentAmount}
                      setPaymentMethod={setPaymentMethod} setPaymentDesc={setPaymentDesc}
                      setPaymentOpen={setPaymentOpen} />
                  ))}
            </div>
            {/* Desktop Table */}
            <div className="hidden md:block mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-[#23445f] text-white">
                  <tr>
                    <th className="px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wide">SN</th>
                    <th className="px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wide">Provider</th>
                    <th className="px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wide">Contact Person</th>
                    <th className="px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wide">Bill No</th>
                    <th className="px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wide">Provider Invoice</th>
                    <th className="px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wide">Bill Month</th>
                    <th className="px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wide">Bill Amount</th>
                    <th className="px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wide">Paid Amount</th>
                    <th className="px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wide">Discount</th>
                    <th className="px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wide">Due</th>
                    <th className="px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wide">Status</th>
                    <th className="px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wide">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleBills.map((bill, index) => (
                    <tr key={bill.id} className="border-b hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-sm">{index + 1}</td>
                      <td className="px-4 py-2.5">
                        <button onClick={() => navigate(`/bandwidth/buy/providers/${bill.provider}`)} className="text-[13px] font-medium text-sky-700 hover:underline">
                          {bill.provider_name}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-[13px]">{bill.provider_contact_person || '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-[12px]">{bill.bill_no}</td>
                      <td className="px-4 py-2.5 font-mono text-[12px]">{bill.invoice_no}</td>
                      <td className="px-4 py-2.5 text-[13px]">{bill.billing_month || '—'}</td>
                      <td className="px-4 py-2.5 text-[13px]">{money(bill.amount)}</td>
                      <td className="px-4 py-2.5 text-[13px]">{money(bill.paid_amount)}</td>
                      <td className="px-4 py-2.5 text-[13px]">{money(bill.discount_amount)}</td>
                      <td className="px-4 py-2.5 text-[13px]">{money(bill.due_amount)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {(bill.status === 'unpaid' || bill.status === 'partial') && (
                            <button
                              onClick={() => {
                                setPaymentTarget(bill);
                                setPaymentAmount(String(bill.due_amount || 0));
                                setPaymentMethod('cash');
                                setPaymentDesc('');
                                setPaymentOpen(true);
                              }}
                              className="rounded bg-slate-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-slate-600"
                            >
                              Pay
                            </button>
                          )}
                          <StatusBadge status={bill.status} />
                        </div>
                      </td>
                      <td className="px-4 py-2.5">{renderActionButtons(bill)}</td>
                    </tr>
                  ))}

                  {visibleBills.length === 0 && (
                    <tr>
                      <td colSpan="12" className="py-16 text-center text-slate-400">No bill found.</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-white font-semibold">
                    <td colSpan="6" className="px-4 py-3 text-right text-[13px]">Total</td>
                    <td className="px-4 py-3 text-[13px]">{money(filteredSummary.amount)}</td>
                    <td className="px-4 py-3 text-[13px]">{money(filteredSummary.paid)}</td>
                    <td className="px-4 py-3 text-[13px]">{money(filteredSummary.discount)}</td>
                    <td className="px-4 py-3 text-[13px]">{money(filteredSummary.due)}</td>
                    <td className="px-4 py-3" colSpan="2" />
                  </tr>
                </tfoot>
              </table>
            </div>
            </>
          )}

          <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
            <p>Showing 1 to {Math.min(visibleBills.length, filteredBills.length)} of {filteredBills.length} entries</p>
            <div className="flex items-center gap-2">
              <button className="text-slate-400" disabled>Previous</button>
              <span className="rounded bg-sky-500 px-3 py-1 text-white font-semibold">1</span>
              <button className="text-slate-400" disabled>Next</button>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={paymentOpen}
        title={`Payment - ${paymentTarget?.bill_no || ''}`}
        onClose={() => setPaymentOpen(false)}
        widthClass="max-w-lg"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setPaymentOpen(false)} className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold">Cancel</button>
            <button onClick={handlePayment} className="rounded-xl bg-[#173d59] px-5 py-2 text-sm font-semibold text-white">Post Payment</button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-50 p-4 text-sm">
            <p><span className="font-semibold">Provider:</span> {paymentTarget?.provider_name || '—'}</p>
            <p><span className="font-semibold">Due:</span> ৳ {money(paymentTarget?.due_amount)}</p>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</span>
            <input
              type="number"
              step="0.01"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Method</span>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white"
            >
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
              <option value="mobile_banking">Mobile Banking</option>
              <option value="cheque">Cheque</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Description</span>
            <textarea
              value={paymentDesc}
              onChange={(e) => setPaymentDesc(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}
