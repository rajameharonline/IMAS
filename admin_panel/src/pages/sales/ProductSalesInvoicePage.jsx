// Product Sales Invoice পেজ।
// কেন দুটো tab: Invoice tab = invoice headers list (status/filter/create),
//               Bills tab = সব payment receipts list (received amount, discount ইত্যাদি)।
// Design: ai.md-এর Purchase Bill layout অনুসরণ করে।

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, RefreshCw, SquarePen, Trash2, CreditCard } from 'lucide-react';
import api from '../../utils/api';

// ── helpers ──────────────────────────────────────────────────────────────────

const today = () => {
  const d = new Date();
  return d.toISOString().slice(0, 10);
};

const firstOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const statusBadge = (s) => {
  if (s === 'paid')    return 'inline-flex px-3 py-1 rounded-full text-xs font-semibold bg-emerald-600 text-white';
  if (s === 'partial') return 'inline-flex px-3 py-1 rounded-full text-xs font-semibold bg-amber-500 text-white';
  return 'inline-flex px-3 py-1 rounded-full text-xs font-semibold bg-rose-600 text-white';
};

// ── Payment Modal ─────────────────────────────────────────────────────────────

function PaymentModal({ invoice, onClose, onSuccess, users }) {
  // Invoice-এর বিপরীতে payment receive করার modal।
  const [form, setForm] = useState({
    amount: invoice ? String(Number(invoice.due || 0).toFixed(2)) : '',
    payment_method: 'cash',
    received_by: '',
    receive_date: today(),
    description: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.amount || Number(form.amount) <= 0) {
      toast.error('Amount অবশ্যই 0-এর বেশি হতে হবে।');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/sales/product-invoices/${invoice.id}/receive-payment/`, {
        amount: Number(form.amount),
        payment_method: form.payment_method,
        received_by: form.received_by || undefined,
        receive_date: form.receive_date,
        description: form.description,
      });
      toast.success('Payment সফলভাবে সেভ হয়েছে।');
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Payment সেভ ব্যর্থ হয়েছে।');
    } finally {
      setSaving(false);
    }
  };

  if (!invoice) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-0 md:p-4">
      <div className="w-full md:max-w-lg bg-white rounded-t-2xl md:rounded-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h3 className="text-lg font-bold text-slate-800">Payment Receive</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="bg-blue-50 rounded-xl p-3 text-sm">
            <span className="text-gray-600">Invoice: </span>
            <span className="font-bold text-[#173d59]">{invoice.invoice_no}</span>
            <span className="mx-2">|</span>
            <span className="text-gray-600">Due: </span>
            <span className="font-bold text-rose-600">৳{fmt(invoice.due)}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Amount *</label>
              <input
                type="number" step="0.01" min="0.01" max={invoice.due}
                value={form.amount}
                onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#173d59] focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Payment Method</label>
              <select
                value={form.payment_method}
                onChange={(e) => setForm((p) => ({ ...p, payment_method: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#173d59] focus:outline-none"
              >
                {[['cash','Cash'],['bkash','bKash'],['nagad','Nagad'],['rocket','Rocket'],['bank','Bank Transfer'],['other','Other']].map(([v,l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Receive Date</label>
              <input
                type="date"
                value={form.receive_date}
                onChange={(e) => setForm((p) => ({ ...p, receive_date: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#173d59] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Received By</label>
              <select
                value={form.received_by}
                onChange={(e) => setForm((p) => ({ ...p, received_by: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#173d59] focus:outline-none"
              >
                <option value="">Select</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Note</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#173d59] focus:outline-none resize-none"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2.5 text-sm font-medium bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 rounded-lg transition-all">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-5 py-2.5 text-sm font-semibold bg-[#173d59] hover:bg-[#1f5075] text-white rounded-full transition-all disabled:opacity-60">
              {saving ? 'Saving…' : 'Confirm Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ gradient, label, value, sub }) {
  return (
    <div className={`${gradient} p-6 rounded-2xl text-white shadow-sm flex items-center justify-between`}>
      <div>
        <p className="text-sm opacity-80">{label}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
        {sub && <p className="text-xs opacity-70 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ProductSalesInvoicePage() {
  const navigate = useNavigate();

  // activeTab: 'invoice' = Invoice list, 'bills' = Payment receipts list
  const [activeTab, setActiveTab] = useState('invoice');

  // ── Invoice tab state ──
  const [invoices, setInvoices]   = useState([]);
  const [summary,  setSummary]    = useState({});
  const [invLoading, setInvLoading] = useState(false);
  const [invFilters, setInvFilters] = useState({
    customer: '', username: '', created_by: '', status: '',
    from_date: firstOfMonth(), to_date: today(), search: '',
  });

  // ── Bills tab state ──
  const [bills, setBills]         = useState([]);
  const [billLoading, setBillLoading] = useState(false);
  const [billFilters, setBillFilters] = useState({
    customer: '', username: '', received_by: '', created_by: '',
    receive_from: firstOfMonth(), receive_to: today(),
    create_from: '', create_to: '', search: '',
  });

  // ── Shared lookup state ──
  const [customers, setCustomers] = useState([]);
  const [users,     setUsers]     = useState([]);

  // ── Payment modal ──
  const [payInvoice, setPayInvoice] = useState(null);

  // ── Pagination ──
  const [invPage,  setInvPage]  = useState(1);
  const [billPage, setBillPage] = useState(1);
  const PAGE_SIZE = 25;

  // ── Fetch lookups ──
  useEffect(() => {
    api.get('/clients/', { params: { page_size: 2000 } })
      .then((r) => setCustomers(Array.isArray(r.data) ? r.data : (r.data?.results || [])))
      .catch(() => {});
    api.get('/auth/users/', { params: { page_size: 500 } })
      .then((r) => setUsers(Array.isArray(r.data) ? r.data : (r.data?.results || [])))
      .catch(() => {});
  }, []);

  // ── Fetch invoices ──
  const fetchInvoices = useCallback(async () => {
    setInvLoading(true);
    try {
      const [listRes, sumRes] = await Promise.all([
        api.get('/sales/product-invoices/', { params: { ...invFilters } }),
        api.get('/sales/product-invoices/summary/', { params: { ...invFilters } }),
      ]);
      setInvoices(Array.isArray(listRes.data) ? listRes.data : (listRes.data?.results || []));
      setSummary(sumRes.data || {});
    } catch {
      toast.error('Invoice লোড ব্যর্থ হয়েছে।');
    } finally {
      setInvLoading(false);
    }
  }, [invFilters]);

  // ── Fetch bills ──
  const fetchBills = useCallback(async () => {
    setBillLoading(true);
    try {
      const res = await api.get('/sales/product-payments/', { params: { ...billFilters } });
      setBills(Array.isArray(res.data) ? res.data : (res.data?.results || []));
    } catch {
      toast.error('Bills লোড ব্যর্থ হয়েছে।');
    } finally {
      setBillLoading(false);
    }
  }, [billFilters]);

  useEffect(() => { if (activeTab === 'invoice') fetchInvoices(); }, [activeTab, fetchInvoices]);
  useEffect(() => { if (activeTab === 'bills')   fetchBills();    }, [activeTab, fetchBills]);

  // ── Pagination slices ──
  const pagedInvoices = useMemo(() => invoices.slice((invPage - 1) * PAGE_SIZE, invPage * PAGE_SIZE), [invoices, invPage]);
  const pagedBills    = useMemo(() => bills.slice((billPage - 1) * PAGE_SIZE, billPage * PAGE_SIZE),  [bills, billPage]);

  // ── Bills totals ──
  const billTotals = useMemo(() => bills.reduce(
    (acc, b) => ({ paid: acc.paid + Number(b.paid_amount || 0), discount: acc.discount + Number(b.discount || 0) }),
    { paid: 0, discount: 0 }
  ), [bills]);

  // ── Delete invoice ──
  const handleDelete = async (id) => {
    if (!window.confirm('এই invoice মুছে দেবেন?')) return;
    try {
      await api.delete(`/sales/product-invoices/${id}/`);
      toast.success('Invoice মুছে গেছে।');
      fetchInvoices();
    } catch {
      toast.error('মুছতে পারা যায়নি।');
    }
  };

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#173d59] focus:outline-none bg-white';

  return (
    <div className="p-4 md:p-6 bg-gray-100 min-h-screen">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <svg className="w-5 h-5 text-[#173d59]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Product Sales Invoice
          </h1>
          <p className="text-sm text-gray-500">All Product Sales Invoices</p>
        </div>
        <div className="text-xs text-gray-400">Sales &amp; Service &gt; Product Sales Invoice</div>
      </div>

      {/* ── Main card ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">

        {/* ── Tab buttons ── */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setActiveTab('invoice')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-full transition-all border ${
              activeTab === 'invoice'
                ? 'bg-[#23445f] text-white border-[#23445f]'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
            Product Sales Invoice
          </button>
          <button
            onClick={() => setActiveTab('bills')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-full transition-all border ${
              activeTab === 'bills'
                ? 'bg-[#23445f] text-white border-[#23445f]'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Product Sales Invoice Bills
          </button>
          {activeTab === 'invoice' && (
            <button
              onClick={() => navigate('/sales/product-invoice/new')}
              className="ml-auto flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-[#173d59] hover:bg-[#1f5075] text-white rounded-full transition-all"
            >
              <Plus className="w-4 h-4" />
              Create Invoice
            </button>
          )}
        </div>

        {/* ══════════════ INVOICE TAB ══════════════ */}
        {activeTab === 'invoice' && (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <StatCard gradient="bg-gradient-to-r from-sky-500 to-cyan-600"
                label="Total Invoices" value={summary.count || 0} sub={`৳${fmt(summary.total_amount)}`} />
              <StatCard gradient="bg-gradient-to-r from-teal-500 to-emerald-600"
                label="Total Received" value={`৳${fmt(summary.total_received)}`} sub={`${summary.paid_count || 0} Paid`} />
              <StatCard gradient="bg-gradient-to-r from-violet-500 to-indigo-600"
                label="Total Due" value={`৳${fmt(summary.total_due)}`} sub={`${summary.unpaid_count || 0} Unpaid`} />
              <StatCard gradient="bg-gradient-to-r from-slate-500 to-slate-600"
                label="Discount" value={`৳${fmt(summary.total_discount)}`} sub={`${summary.partial_count || 0} Partial`} />
            </div>

            {/* Filters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-xl mb-6">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Customer</label>
                <select value={invFilters.customer} onChange={(e) => setInvFilters((p) => ({ ...p, customer: e.target.value }))} className={inputCls}>
                  <option value="">Select</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Username</label>
                <input value={invFilters.username} onChange={(e) => setInvFilters((p) => ({ ...p, username: e.target.value }))}
                  placeholder="Username" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Created By</label>
                <select value={invFilters.created_by} onChange={(e) => setInvFilters((p) => ({ ...p, created_by: e.target.value }))} className={inputCls}>
                  <option value="">Select</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Payment Status</label>
                <select value={invFilters.status} onChange={(e) => setInvFilters((p) => ({ ...p, status: e.target.value }))} className={inputCls}>
                  <option value="">Select</option>
                  <option value="unpaid">Unpaid</option>
                  <option value="partial">Partial</option>
                  <option value="paid">Paid</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">From Date</label>
                <input type="date" value={invFilters.from_date} onChange={(e) => setInvFilters((p) => ({ ...p, from_date: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">To Date</label>
                <input type="date" value={invFilters.to_date} onChange={(e) => setInvFilters((p) => ({ ...p, to_date: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Search</label>
                <input value={invFilters.search} onChange={(e) => setInvFilters((p) => ({ ...p, search: e.target.value }))}
                  placeholder="Invoice No / Customer…" className={inputCls} />
              </div>
              <div className="flex items-end">
                <button onClick={fetchInvoices}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-[#173d59] hover:bg-[#1f5075] text-white rounded-full transition-all">
                  <RefreshCw className="w-4 h-4" /> Refresh
                </button>
              </div>
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-full divide-y divide-gray-200">
                <thead className="bg-[#23445f]">
                  <tr>
                    {['CustomerName','UserName','InvoiceNo','Total','ReceiveAmount','Discount','Due','CreatedBy','CreationDate','Status','Action'].map((h) => (
                      <th key={h} className="px-4 py-3 text-white text-xs font-semibold uppercase tracking-wider text-left whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {invLoading ? (
                    <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
                  ) : pagedInvoices.length === 0 ? (
                    <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">No data available in table</td></tr>
                  ) : pagedInvoices.map((inv, i) => (
                    <tr key={inv.id} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-blue-50/30 transition-colors`}>
                      <td className="px-4 py-3 text-sm text-gray-900 font-medium whitespace-nowrap">{inv.customer_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{inv.username}</td>
                      <td className="px-4 py-3 text-sm text-[#173d59] font-semibold whitespace-nowrap">{inv.invoice_no}</td>
                      <td className="px-4 py-3 text-sm font-bold text-gray-900 whitespace-nowrap">৳{fmt(inv.total)}</td>
                      <td className="px-4 py-3 text-sm text-emerald-700 font-semibold whitespace-nowrap">৳{fmt(inv.receive_amount)}</td>
                      <td className="px-4 py-3 text-sm text-amber-600 whitespace-nowrap">৳{fmt(inv.discount)}</td>
                      <td className="px-4 py-3 text-sm text-rose-700 font-semibold whitespace-nowrap">৳{fmt(inv.due)}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{inv.created_by_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{inv.created_at?.slice(0,10)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={statusBadge(inv.status)}>{inv.status_display || inv.status}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {inv.status !== 'paid' && (
                            <button onClick={() => setPayInvoice(inv)} title="Receive Payment"
                              className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">
                              <CreditCard className="w-4 h-4" />
                            </button>
                          )}
                          <button onClick={() => navigate(`/sales/product-invoice/${inv.id}/edit`)} title="Edit"
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                            <SquarePen className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDelete(inv.id)} title="Delete"
                            className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {/* Totals row */}
                  {pagedInvoices.length > 0 && (
                    <tr className="bg-gray-100 font-bold">
                      <td colSpan={3} className="px-4 py-3 text-sm text-gray-700">Total</td>
                      <td className="px-4 py-3 text-sm text-gray-900">৳{fmt(summary.total_amount)}</td>
                      <td className="px-4 py-3 text-sm text-emerald-700">৳{fmt(summary.total_received)}</td>
                      <td className="px-4 py-3 text-sm text-amber-600">৳{fmt(summary.total_discount)}</td>
                      <td className="px-4 py-3 text-sm text-rose-700">৳{fmt(summary.total_due)}</td>
                      <td colSpan={4}></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="block md:hidden space-y-4">
              {invLoading ? (
                <p className="text-center text-gray-400 py-8">Loading…</p>
              ) : pagedInvoices.length === 0 ? (
                <p className="text-center text-gray-400 py-8">No data available</p>
              ) : pagedInvoices.map((inv) => (
                <div key={inv.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 hover:border-slate-300 transition-all">
                  <div className="flex justify-between items-center border-b border-gray-100 pb-3 mb-3">
                    <span className="text-sm font-bold text-gray-900">{inv.invoice_no}</span>
                    <span className={statusBadge(inv.status)}>{inv.status_display || inv.status}</span>
                  </div>
                  <div className="space-y-2.5 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500 font-medium uppercase tracking-wider">Customer:</span>
                      <span className="text-gray-900 font-semibold text-right">{inv.customer_name}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500 font-medium uppercase tracking-wider">Username:</span>
                      <span className="text-gray-700 text-right">{inv.username}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500 font-medium uppercase tracking-wider">Total:</span>
                      <span className="text-gray-900 font-bold text-sm text-[#173d59] text-right">৳{fmt(inv.total)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500 font-medium uppercase tracking-wider">Received:</span>
                      <span className="text-emerald-700 font-semibold text-right">৳{fmt(inv.receive_amount)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500 font-medium uppercase tracking-wider">Due:</span>
                      <span className="text-rose-700 font-semibold text-right">৳{fmt(inv.due)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500 font-medium uppercase tracking-wider">Date:</span>
                      <span className="text-gray-700 text-right">{inv.created_at?.slice(0,10)}</span>
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-gray-100 flex justify-end gap-2">
                    {inv.status !== 'paid' && (
                      <button onClick={() => setPayInvoice(inv)}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-medium min-h-[44px] transition-all">
                        <CreditCard className="w-4 h-4" /> Pay
                      </button>
                    )}
                    <button onClick={() => navigate(`/sales/product-invoice/${inv.id}/edit`)}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-xl text-xs font-medium min-h-[44px] transition-all">
                      <SquarePen className="w-4 h-4" /> Edit
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
              <span>Showing {Math.min((invPage-1)*PAGE_SIZE+1, invoices.length)}–{Math.min(invPage*PAGE_SIZE, invoices.length)} of {invoices.length}</span>
              <div className="flex gap-2">
                <button onClick={() => setInvPage((p) => Math.max(1, p-1))} disabled={invPage===1}
                  className="px-3 py-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50">Previous</button>
                <button onClick={() => setInvPage((p) => p*PAGE_SIZE < invoices.length ? p+1 : p)} disabled={invPage*PAGE_SIZE >= invoices.length}
                  className="px-3 py-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50">Next</button>
              </div>
            </div>
          </>
        )}

        {/* ══════════════ BILLS TAB ══════════════ */}
        {activeTab === 'bills' && (
          <>
            {/* Filters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-xl mb-6">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Customer</label>
                <select value={billFilters.customer} onChange={(e) => setBillFilters((p) => ({ ...p, customer: e.target.value }))} className={inputCls}>
                  <option value="">Select</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Username</label>
                <input value={billFilters.username} onChange={(e) => setBillFilters((p) => ({ ...p, username: e.target.value }))} placeholder="Username" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Received By</label>
                <select value={billFilters.received_by} onChange={(e) => setBillFilters((p) => ({ ...p, received_by: e.target.value }))} className={inputCls}>
                  <option value="">Select</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Created By</label>
                <select value={billFilters.created_by} onChange={(e) => setBillFilters((p) => ({ ...p, created_by: e.target.value }))} className={inputCls}>
                  <option value="">Select</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Receive From Date</label>
                <input type="date" value={billFilters.receive_from} onChange={(e) => setBillFilters((p) => ({ ...p, receive_from: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Receive To Date</label>
                <input type="date" value={billFilters.receive_to} onChange={(e) => setBillFilters((p) => ({ ...p, receive_to: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Create From Date</label>
                <input type="date" value={billFilters.create_from} onChange={(e) => setBillFilters((p) => ({ ...p, create_from: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Create To Date</label>
                <input type="date" value={billFilters.create_to} onChange={(e) => setBillFilters((p) => ({ ...p, create_to: e.target.value }))} className={inputCls} />
              </div>
              <div className="sm:col-span-2 md:col-span-3">
                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Search</label>
                <input value={billFilters.search} onChange={(e) => setBillFilters((p) => ({ ...p, search: e.target.value }))} placeholder="Receipt No / Invoice No / Customer…" className={inputCls} />
              </div>
              <div className="flex items-end">
                <button onClick={fetchBills}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-[#173d59] hover:bg-[#1f5075] text-white rounded-full transition-all">
                  <RefreshCw className="w-4 h-4" /> Refresh
                </button>
              </div>
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-full divide-y divide-gray-200">
                <thead className="bg-[#23445f]">
                  <tr>
                    {['CustomerName','UserName','InvoiceNo','ReceiptNo','PaidAmount','Discount','PaymentMethod','PaidBy','ReceiveDate','ReceivedBy','CreationDate','CreatedBy'].map((h) => (
                      <th key={h} className="px-4 py-3 text-white text-xs font-semibold uppercase tracking-wider text-left whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {billLoading ? (
                    <tr><td colSpan={12} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
                  ) : pagedBills.length === 0 ? (
                    <tr><td colSpan={12} className="px-4 py-8 text-center text-gray-400">No data available in table</td></tr>
                  ) : pagedBills.map((b, i) => (
                    <tr key={b.id} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-blue-50/30 transition-colors`}>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">{b.customer_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{b.username}</td>
                      <td className="px-4 py-3 text-sm text-[#173d59] font-semibold whitespace-nowrap">{b.invoice_no}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{b.receipt_no}</td>
                      <td className="px-4 py-3 text-sm font-bold text-emerald-700 whitespace-nowrap">৳{fmt(b.paid_amount)}</td>
                      <td className="px-4 py-3 text-sm text-amber-600 whitespace-nowrap">৳{fmt(b.discount)}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{b.payment_method_display}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{b.paid_by_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{b.receive_date}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{b.received_by_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{b.created_at?.slice(0,10)}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{b.created_by_name}</td>
                    </tr>
                  ))}
                  {/* Totals row */}
                  <tr className="bg-gray-100 font-bold">
                    <td colSpan={4} className="px-4 py-3 text-sm text-gray-700">Total</td>
                    <td className="px-4 py-3 text-sm text-emerald-700">৳{fmt(billTotals.paid)}</td>
                    <td className="px-4 py-3 text-sm text-amber-600">৳{fmt(billTotals.discount)}</td>
                    <td colSpan={6}></td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="block md:hidden space-y-4">
              {billLoading ? (
                <p className="text-center text-gray-400 py-8">Loading…</p>
              ) : pagedBills.length === 0 ? (
                <p className="text-center text-gray-400 py-8">No data available</p>
              ) : pagedBills.map((b) => (
                <div key={b.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 hover:border-slate-300 transition-all">
                  <div className="flex justify-between items-center border-b border-gray-100 pb-3 mb-3">
                    <span className="text-sm font-bold text-gray-900">{b.receipt_no}</span>
                    <span className="text-xs text-gray-500">{b.receive_date}</span>
                  </div>
                  <div className="space-y-2.5 text-xs">
                    <div className="flex justify-between"><span className="text-gray-500 uppercase tracking-wider">Customer:</span><span className="font-semibold text-right">{b.customer_name}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500 uppercase tracking-wider">Invoice:</span><span className="text-[#173d59] font-semibold text-right">{b.invoice_no}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500 uppercase tracking-wider">Paid:</span><span className="text-emerald-700 font-bold text-sm text-right">৳{fmt(b.paid_amount)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500 uppercase tracking-wider">Method:</span><span className="text-right">{b.payment_method_display}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500 uppercase tracking-wider">Received By:</span><span className="text-right">{b.received_by_name}</span></div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
              <span>Showing {Math.min((billPage-1)*PAGE_SIZE+1, bills.length)}–{Math.min(billPage*PAGE_SIZE, bills.length)} of {bills.length}</span>
              <div className="flex gap-2">
                <button onClick={() => setBillPage((p) => Math.max(1, p-1))} disabled={billPage===1}
                  className="px-3 py-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50">Previous</button>
                <button onClick={() => setBillPage((p) => p*PAGE_SIZE < bills.length ? p+1 : p)} disabled={billPage*PAGE_SIZE >= bills.length}
                  className="px-3 py-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50">Next</button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Payment modal */}
      {payInvoice && (
        <PaymentModal
          invoice={payInvoice}
          users={users}
          onClose={() => setPayInvoice(null)}
          onSuccess={fetchInvoices}
        />
      )}
    </div>
  );
}
