// Purchase List Page — 2 tabs:
//   Tab 1: Purchase List (Orders) — Router/ONU/Cable purchase history
//   Tab 2: Purchase Bills — payment tracking per order
// কেন দুটো tab: screenshot-এ দেখা গেছে, order creation আর
// bill payment tracking আলাদা workflow।

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, RefreshCw, SquarePen, Trash2, ShoppingCart, Banknote } from 'lucide-react';
import api from '../../utils/api';
import { asList, money, formatApiError } from '../bandwidth/bandwidthHelpers';

/* ── Helpers ───────────────────────────────────────────── */
function StatusBadge({ status }) {
  const map = {
    pending:   'bg-amber-500 text-white',
    received:  'bg-emerald-600 text-white',
    cancelled: 'bg-rose-600 text-white',
    unpaid:    'bg-rose-600 text-white',
    partial:   'bg-amber-500 text-white',
    paid:      'bg-emerald-600 text-white',
  };
  return (
    <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${map[status] || 'bg-slate-200 text-slate-600'}`}>
      {status?.charAt(0).toUpperCase() + status?.slice(1)}
    </span>
  );
}

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
      <ShoppingCart className="h-10 w-10 text-white/30 shrink-0" />
    </div>
  );
}

/* ── Pay Modal ─────────────────────────────────────────── */
function PayModal({ bill, onClose, onPaid }) {
  const [amount, setAmount]     = useState('');
  const [discount, setDiscount] = useState('');
  const [saving, setSaving]     = useState(false);

  const handlePay = async () => {
    const amt = parseFloat(amount) || 0;
    const dis = parseFloat(discount) || 0;
    if (amt <= 0 && dis <= 0) { toast.error('Enter amount or discount.'); return; }
    setSaving(true);
    try {
      await api.post(`/purchase/bills/${bill.id}/pay/`, {
        amount: amt || 0,
        discount_amount: dis || 0,
      });
      toast.success('Payment recorded.');
      onPaid();
      onClose();
    } catch (err) {
      toast.error(formatApiError(err, 'Payment failed.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-800">Record Payment</h3>
          <button onClick={onClose} className="text-2xl text-rose-400 hover:text-rose-600 leading-none">×</button>
        </div>
        <div className="space-y-3 mb-4 text-sm text-slate-600">
          <div className="flex justify-between"><span>Bill No:</span><span className="font-semibold">{bill.bill_no}</span></div>
          <div className="flex justify-between"><span>Total:</span><span className="font-mono">৳ {money(bill.total_amount)}</span></div>
          <div className="flex justify-between"><span>Paid:</span><span className="font-mono text-emerald-600">৳ {money(bill.paid_amount)}</span></div>
          <div className="flex justify-between"><span>Due:</span><span className="font-mono text-rose-600 font-bold">৳ {money(bill.due_amount)}</span></div>
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1 block">Pay Amount</span>
            <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400/30" />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1 block">Discount Amount</span>
            <input type="number" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400/30" />
          </label>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose}
            className="flex-1 rounded-lg border border-slate-300 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={handlePay} disabled={saving}
            className="flex-1 rounded-lg bg-[#173d59] text-white py-2.5 text-sm font-semibold hover:bg-[#1f5075] disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Tab 1: Purchase Orders ──────────────────────────────── */
function OrdersTab({ navigate }) {
  const [orders,  setOrders]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [vendors, setVendors] = useState([]);
  const [vendorF, setVendorF] = useState('');
  const [fromD,   setFromD]   = useState('');
  const [toD,     setToD]     = useState('');
  const [search,  setSearch]  = useState('');
  const [pageSize, setPageSize] = useState(25);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const [oRes, vRes] = await Promise.all([
        api.get('/purchase/orders/?page_size=500'),
        api.get('/purchase/vendors/?page_size=200'),
      ]);
      setOrders(asList(oRes.data));
      setVendors(asList(vRes.data));
    } catch {
      toast.error('Orders লোড করা যায়নি।');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      const matchSearch = !q || [o.order_no, o.vendor_name, o.notes]
        .some((x) => String(x || '').toLowerCase().includes(q));
      const matchVendor = !vendorF || String(o.vendor) === vendorF;
      const matchFrom   = !fromD || o.order_date >= fromD;
      const matchTo     = !toD   || o.order_date <= toD;
      return matchSearch && matchVendor && matchFrom && matchTo;
    });
  }, [orders, search, vendorF, fromD, toD]);

  const visible  = useMemo(() => filtered.slice(0, pageSize), [filtered, pageSize]);

  const totals = useMemo(() => ({
    total:  filtered.reduce((s, o) => s + parseFloat(o.total_amount || 0), 0),
  }), [filtered]);

  const handleDelete = async (o) => {
    if (!confirm(`Delete purchase order ${o.order_no}?`)) return;
    try {
      await api.delete(`/purchase/orders/${o.id}/`);
      toast.success('Deleted.');
      fetchOrders();
    } catch (err) {
      toast.error(formatApiError(err, 'Delete failed.'));
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 bg-gray-50 rounded-xl p-4">
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Vendor</label>
          <select value={vendorF} onChange={(e) => setVendorF(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-400/30">
            <option value="">Select Vendor</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">From Date</label>
          <input type="date" value={fromD} onChange={(e) => setFromD(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-400/30" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">To Date</label>
          <input type="date" value={toD} onChange={(e) => setToD(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-400/30" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Show</label>
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none">
            {[10, 25, 50].map((n) => <option key={n} value={n}>{n} entries</option>)}
          </select>
        </div>
        <div className="md:col-span-4">
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order no, vendor..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-400/30" />
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm">Loading...</div>
      ) : (
        <div className="w-full">
          {/* Desktop */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full min-w-full divide-y divide-gray-200">
              <thead className="bg-[#23445f]">
                <tr>
                  {['SN', 'Order No', 'Date', 'Vendor', 'Total Amount', 'Status', 'Action'].map((h) => (
                    <th key={h} className="px-4 py-4 text-white text-xs font-semibold uppercase tracking-wider text-left whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {visible.map((o, i) => (
                  <tr key={o.id} className={`${i % 2 === 1 ? 'bg-gray-50/50' : ''} hover:bg-blue-50/30 transition-colors`}>
                    <td className="px-4 py-3 text-slate-400 text-xs">{i + 1}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{o.order_no}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{o.order_date}</td>
                    <td className="px-4 py-3 text-slate-600">{o.vendor_name}</td>
                    <td className="px-4 py-3 font-mono font-semibold text-slate-800 whitespace-nowrap">৳ {money(o.total_amount)}</td>
                    <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => navigate(`/purchase/new/${o.id}/edit`)} title="Edit"
                          className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-sky-500 hover:bg-sky-50">
                          <SquarePen className="h-4 w-4" />
                        </button>
                        <button onClick={() => handleDelete(o)} title="Delete"
                          className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-rose-500 hover:bg-rose-50">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr><td colSpan={7} className="py-16 text-center text-slate-400">No orders found.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-gray-50">
                  <td colSpan={4} className="px-4 py-3 font-bold text-slate-700">Total</td>
                  <td className="px-4 py-3 font-bold font-mono text-slate-800 whitespace-nowrap">৳ {money(totals.total)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Mobile */}
          <div className="block md:hidden space-y-4">
            {visible.length === 0
              ? <p className="text-center py-12 text-slate-400 text-sm">No orders found.</p>
              : visible.map((o) => (
                  <div key={o.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                    <div className="flex justify-between items-center border-b border-gray-100 pb-3 mb-3">
                      <span className="text-sm font-bold text-gray-900">{o.order_no}</span>
                      <StatusBadge status={o.status} />
                    </div>
                    <div className="space-y-1.5 text-xs">
                      {[['Date', o.order_date], ['Vendor', o.vendor_name]].map(([l, v]) => (
                        <div key={l} className="flex justify-between">
                          <span className="text-gray-500 uppercase tracking-wider">{l}:</span>
                          <span className="font-semibold text-gray-900">{v}</span>
                        </div>
                      ))}
                      <div className="flex justify-between">
                        <span className="text-gray-500 uppercase tracking-wider">Total:</span>
                        <span className="font-bold text-[#173d59] font-mono">৳ {money(o.total_amount)}</span>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t flex justify-end gap-2">
                      <button onClick={() => navigate(`/purchase/new/${o.id}/edit`)}
                        className="px-3 py-2 bg-sky-50 text-sky-600 border border-sky-200 rounded-xl text-xs font-medium min-h-[44px]">
                        Edit
                      </button>
                      <button onClick={() => handleDelete(o)}
                        className="px-3 py-2 bg-red-50 text-red-600 border border-red-200 rounded-xl text-xs font-medium min-h-[44px]">
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
          </div>
          <p className="mt-3 text-xs text-slate-400">Showing {visible.length} of {filtered.length} entries</p>
        </div>
      )}
    </div>
  );
}

/* ── Tab 2: Purchase Bills ───────────────────────────────── */
function BillsTab() {
  const [bills,   setBills]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [vendors, setVendors] = useState([]);
  const [vendorF, setVendorF] = useState('');
  const [fromD,   setFromD]   = useState('');
  const [toD,     setToD]     = useState('');
  const [statusF, setStatusF] = useState('');
  const [pageSize, setPageSize] = useState(25);
  const [payBill, setPayBill] = useState(null);

  const fetchBills = useCallback(async () => {
    setLoading(true);
    try {
      const [bRes, vRes] = await Promise.all([
        api.get('/purchase/bills/?page_size=500'),
        api.get('/purchase/vendors/?page_size=200'),
      ]);
      setBills(asList(bRes.data));
      setVendors(asList(vRes.data));
    } catch {
      toast.error('Bills লোড করা যায়নি।');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBills(); }, [fetchBills]);

  const filtered = useMemo(() => {
    return bills.filter((b) => {
      const matchVendor = !vendorF || String(b.vendor_id) === vendorF;
      const matchFrom   = !fromD || b.bill_date >= fromD;
      const matchTo     = !toD   || b.bill_date <= toD;
      const matchStatus = !statusF || b.status === statusF;
      return matchVendor && matchFrom && matchTo && matchStatus;
    });
  }, [bills, vendorF, fromD, toD, statusF]);

  const visible = useMemo(() => filtered.slice(0, pageSize), [filtered, pageSize]);

  const totals = useMemo(() => ({
    total:    filtered.reduce((s, b) => s + parseFloat(b.total_amount  || 0), 0),
    paid:     filtered.reduce((s, b) => s + parseFloat(b.paid_amount   || 0), 0),
    discount: filtered.reduce((s, b) => s + parseFloat(b.discount_amount || 0), 0),
    due:      filtered.reduce((s, b) => s + parseFloat(b.due_amount    || 0), 0),
  }), [filtered]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 bg-gray-50 rounded-xl p-4">
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Vendor</label>
          <select value={vendorF} onChange={(e) => setVendorF(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-400/30">
            <option value="">Select Vendor</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">From Date</label>
          <input type="date" value={fromD} onChange={(e) => setFromD(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-400/30" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">To Date</label>
          <input type="date" value={toD} onChange={(e) => setToD(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-400/30" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Status</label>
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-400/30">
            <option value="">All Status</option>
            <option value="unpaid">Unpaid</option>
            <option value="partial">Partial</option>
            <option value="paid">Paid</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm">Loading...</div>
      ) : (
        <div className="w-full">
          {/* Desktop */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full min-w-full divide-y divide-gray-200">
              <thead className="bg-[#23445f]">
                <tr>
                  {['SN', 'Bill No', 'Date', 'Vendor', 'Total Amount', 'Paid Amount', 'Discount', 'Due', 'Status', 'Action'].map((h) => (
                    <th key={h} className="px-3 py-4 text-white text-xs font-semibold uppercase tracking-wider text-left whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {visible.map((b, i) => (
                  <tr key={b.id} className={`${i % 2 === 1 ? 'bg-gray-50/50' : ''} hover:bg-blue-50/30 transition-colors`}>
                    <td className="px-3 py-3 text-slate-400 text-xs">{i + 1}</td>
                    <td className="px-3 py-3 font-semibold text-slate-800">{b.bill_no}</td>
                    <td className="px-3 py-3 text-slate-600 whitespace-nowrap">{b.bill_date}</td>
                    <td className="px-3 py-3 text-slate-600">{b.vendor_name}</td>
                    <td className="px-3 py-3 font-mono text-slate-800 whitespace-nowrap">৳ {money(b.total_amount)}</td>
                    <td className="px-3 py-3 font-mono text-emerald-600 whitespace-nowrap">৳ {money(b.paid_amount)}</td>
                    <td className="px-3 py-3 font-mono text-slate-600 whitespace-nowrap">৳ {money(b.discount_amount)}</td>
                    <td className="px-3 py-3 font-mono font-bold text-rose-600 whitespace-nowrap">৳ {money(b.due_amount)}</td>
                    <td className="px-3 py-3"><StatusBadge status={b.status} /></td>
                    <td className="px-3 py-3">
                      {b.status !== 'paid' && (
                        <button onClick={() => setPayBill(b)} title="Pay"
                          className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-emerald-500 hover:bg-emerald-50">
                          <Banknote className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr><td colSpan={10} className="py-16 text-center text-slate-400">No data available in table</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-gray-50 font-semibold">
                  <td colSpan={4} className="px-3 py-3 text-slate-700">Total</td>
                  <td className="px-3 py-3 font-mono whitespace-nowrap">৳ {money(totals.total)}</td>
                  <td className="px-3 py-3 font-mono text-emerald-600 whitespace-nowrap">৳ {money(totals.paid)}</td>
                  <td className="px-3 py-3 font-mono whitespace-nowrap">৳ {money(totals.discount)}</td>
                  <td className="px-3 py-3 font-mono text-rose-600 whitespace-nowrap">৳ {money(totals.due)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Mobile */}
          <div className="block md:hidden space-y-4">
            {visible.length === 0
              ? <p className="text-center py-12 text-slate-400 text-sm">No bills found.</p>
              : visible.map((b) => (
                  <div key={b.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                    <div className="flex justify-between items-center border-b border-gray-100 pb-3 mb-3">
                      <span className="text-sm font-bold text-gray-900">{b.bill_no}</span>
                      <StatusBadge status={b.status} />
                    </div>
                    <div className="space-y-1.5 text-xs">
                      {[
                        ['Date',    b.bill_date],
                        ['Vendor',  b.vendor_name],
                        ['Total',   `৳ ${money(b.total_amount)}`],
                        ['Paid',    `৳ ${money(b.paid_amount)}`],
                        ['Due',     `৳ ${money(b.due_amount)}`],
                      ].map(([l, v]) => (
                        <div key={l} className="flex justify-between">
                          <span className="text-gray-500 uppercase tracking-wider">{l}:</span>
                          <span className="font-semibold text-gray-900">{v}</span>
                        </div>
                      ))}
                    </div>
                    {b.status !== 'paid' && (
                      <div className="mt-3 pt-3 border-t flex justify-end">
                        <button onClick={() => setPayBill(b)}
                          className="px-4 py-2 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-xl text-xs font-medium min-h-[44px]">
                          Pay Bill
                        </button>
                      </div>
                    )}
                  </div>
                ))}
          </div>
          <p className="mt-3 text-xs text-slate-400">Showing {visible.length} of {filtered.length} entries</p>
        </div>
      )}

      {payBill && (
        <PayModal bill={payBill} onClose={() => setPayBill(null)} onPaid={fetchBills} />
      )}
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────── */
export default function PurchaseListPage() {
  const navigate  = useNavigate();
  const [tab, setTab] = useState('orders');
  const [stats, setStats] = useState({});

  useEffect(() => {
    api.get('/purchase/orders/stats/').then(({ data }) => setStats(data)).catch(() => {});
  }, []);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Purchase List</h1>
          <p className="text-xs text-slate-500">All Purchase List</p>
        </div>
        <button onClick={() => navigate('/purchase/new')}
          className="inline-flex items-center gap-2 rounded-xl bg-[#173d59] hover:bg-[#1f5075] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all">
          <Plus className="h-4 w-4" /> Purchase
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox tone="blue"   label="Total Orders"  value={stats.total_orders  || 0} sub="All purchase orders" />
        <StatBox tone="green"  label="Total Paid"    value={`৳ ${money(stats.total_paid)}`} sub="Bills settled" />
        <StatBox tone="purple" label="Total Due"     value={`৳ ${money(stats.total_due)}`}  sub="Outstanding bills" />
        <StatBox tone="slate"  label="Order Value"   value={`৳ ${money(stats.total_value)}`} sub="Gross purchase value" />
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex gap-2 mb-5 border-b border-slate-200 pb-4">
          <button onClick={() => setTab('orders')}
            className={`inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition-all
              ${tab === 'orders' ? 'bg-[#173d59] text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>
            <ShoppingCart className="h-4 w-4" /> Purchase List
          </button>
          <button onClick={() => setTab('bills')}
            className={`inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition-all
              ${tab === 'bills' ? 'bg-[#173d59] text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>
            <Banknote className="h-4 w-4" /> Purchase Bills
          </button>
        </div>

        {tab === 'orders' ? <OrdersTab navigate={navigate} /> : <BillsTab />}
      </div>
    </div>
  );
}
