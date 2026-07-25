import { useEffect, useState, useCallback } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const METHODS = [
  { value: 'cash',       label: 'Cash',          icon: '💵', color: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200' },
  { value: 'bkash',      label: 'bKash',          icon: '📱', color: 'bg-pink-50 text-pink-700 ring-1 ring-pink-200' },
  { value: 'nagad',      label: 'Nagad',          icon: '📱', color: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200' },
  { value: 'rocket',     label: 'Rocket',         icon: '📱', color: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200' },
  { value: 'bank',       label: 'Bank Transfer',  icon: '🏦', color: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' },
  { value: 'sslcommerz', label: 'SSLCommerz',     icon: '💳', color: 'bg-green-50 text-green-700 ring-1 ring-green-200' },
  { value: 'other',      label: 'Other',          icon: '🔖', color: 'bg-gray-50 text-gray-600 ring-1 ring-gray-200' },
];
const methodMap = Object.fromEntries(METHODS.map(m => [m.value, m]));
const fmt = v => '৳' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });

function Avatar({ name }) {
  const initials = (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const palette = ['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-500'];
  const bg = palette[(name?.charCodeAt(0) || 0) % palette.length];
  return (
    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${bg}`}>
      {initials}
    </div>
  );
}

const inp = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-[#1d435d] focus:ring-2 focus:ring-[#1d435d]/10';
const lbl = 'mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[#5a7a90]';

export default function PaymentList() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [summary, setSummary]   = useState(null);
  const [count, setCount]       = useState(0);
  const [page, setPage]         = useState(1);

  const [search,    setSearch]    = useState('');
  const [methodF,   setMethodF]   = useState('');
  const [dateFrom,  setDateFrom]  = useState('');
  const [dateTo,    setDateTo]    = useState('');
  const [billMonth, setBillMonth] = useState('');

  const [showNew,   setShowNew]   = useState(false);
  const [clientQ,   setClientQ]   = useState('');
  const [clientRes, setClientRes] = useState([]);
  const [selClient, setSelClient] = useState(null);
  const [bills,     setBills]     = useState([]);
  const [billsLoad, setBillsLoad] = useState(false);
  const [payForm,   setPayForm]   = useState({ bill: '', amount: '', payment_method: 'cash', transaction_id: '', notes: '' });
  const [saving,    setSaving]    = useState(false);

  const [deleteId, setDeleteId] = useState(null);

  const buildParams = useCallback(() => {
    const p = new URLSearchParams({ page });
    if (search)    p.append('search', search);
    if (methodF)   p.append('payment_method', methodF);
    if (dateFrom)  p.append('date_from', dateFrom);
    if (dateTo)    p.append('date_to', dateTo);
    if (billMonth) p.append('bill_month', billMonth);
    return p.toString();
  }, [page, search, methodF, dateFrom, dateTo, billMonth]);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildParams();
      const [payRes, sumRes] = await Promise.all([
        api.get(`/billing/payments/?${params}`),
        api.get(`/billing/payments/summary/?${params}`),
      ]);
      setPayments(payRes.data.results || payRes.data);
      setCount(payRes.data.count || 0);
      setSummary(sumRes.data);
    } catch {
      toast.error('পেমেন্ট তালিকা লোড হয়নি।');
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => { fetchPayments(); }, [fetchPayments]);

  useEffect(() => {
    if (!clientQ) { setClientRes([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await api.get(`/clients/?search=${encodeURIComponent(clientQ)}`);
        setClientRes(r.data.results || r.data);
      } catch { setClientRes([]); }
    }, 400);
    return () => clearTimeout(t);
  }, [clientQ]);

  const loadClientBills = async (clientId) => {
    setBillsLoad(true); setBills([]);
    setPayForm(f => ({ ...f, bill: '', amount: '' }));
    try {
      const r = await api.get(`/billing/bills/?client=${clientId}&page=1`);
      setBills((r.data.results || r.data).filter(b => b.status !== 'paid' && b.status !== 'waived'));
    } catch { toast.error('বিল লোড হয়নি।'); }
    finally { setBillsLoad(false); }
  };

  const selectClient = (c) => {
    setSelClient(c);
    setClientQ(`${c.customer_id} — ${c.full_name}`);
    setClientRes([]);
    loadClientBills(c.id);
  };

  const selectBill = (billId) => {
    const bill = bills.find(b => String(b.id) === String(billId));
    setPayForm(f => ({ ...f, bill: billId, amount: bill ? String(Number(bill.due_amount)) : '' }));
  };

  const openNew = () => {
    setShowNew(true);
    setClientQ(''); setClientRes([]); setSelClient(null);
    setBills([]);
    setPayForm({ bill: '', amount: '', payment_method: 'cash', transaction_id: '', notes: '' });
  };

  const handleSave = async () => {
    if (!payForm.bill)   { toast.error('বিল সিলেক্ট করুন।'); return; }
    if (!payForm.amount || Number(payForm.amount) <= 0) { toast.error('পরিমাণ দিন।'); return; }
    setSaving(true);
    try {
      await api.post('/billing/payments/', payForm);
      toast.success('পেমেন্ট সফলভাবে সংরক্ষিত হয়েছে।');
      setShowNew(false);
      fetchPayments();
    } catch (err) {
      const d = err.response?.data;
      if (d && typeof d === 'object') Object.values(d).forEach(m => toast.error(Array.isArray(m) ? m[0] : m));
      else toast.error('পেমেন্ট সংরক্ষণ ব্যর্থ।');
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    try {
      await api.delete(`/billing/payments/${deleteId}/`);
      toast.success('পেমেন্ট মুছে ফেলা হয়েছে।');
      setDeleteId(null);
      fetchPayments();
    } catch { toast.error('মুছে ফেলা ব্যর্থ হয়েছে।'); }
  };

  const clearFilters = () => { setSearch(''); setMethodF(''); setDateFrom(''); setDateTo(''); setBillMonth(''); setPage(1); };
  const hasFilter = search || methodF || dateFrom || dateTo || billMonth;

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Client Payments</h1>
          <p className="mt-0.5 text-sm text-gray-500">মোট {count} পেমেন্ট রেকর্ড</p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-2 rounded-xl bg-[#1d435d] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#245f84]">
          <span className="text-lg leading-none">+</span> নতুন পেমেন্ট
        </button>
      </div>

      {/* ── Summary Cards ── */}
      {summary && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1d435d] to-[#2a6090] p-5 text-white shadow-md">
            <div className="absolute right-3 top-3 text-4xl opacity-10 select-none">📊</div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-blue-200">মোট পেমেন্ট</p>
            <p className="mt-2 truncate text-4xl font-extrabold" title={String(summary.total_payments || 0)}>{summary.total_payments || 0}</p>
            <p className="mt-1 text-xs text-blue-200">পেমেন্ট এন্ট্রি</p>
          </div>
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-5 text-white shadow-md">
            <div className="absolute right-3 top-3 text-4xl opacity-10 select-none">💰</div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-100">মোট সংগ্রহ</p>
            <p className="mt-2 truncate text-2xl font-extrabold" title={fmt(summary.total_amount)}>{fmt(summary.total_amount)}</p>
            <p className="mt-1 text-xs text-emerald-100">সর্বমোট আদায়</p>
          </div>
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-600 to-slate-700 p-5 text-white shadow-md">
            <div className="absolute right-3 top-3 text-4xl opacity-10 select-none">💵</div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-300">নগদ (Cash)</p>
            <p className="mt-2 truncate text-2xl font-extrabold" title={fmt(summary.cash_amount)}>{fmt(summary.cash_amount)}</p>
            <p className="mt-1 text-xs text-slate-300">হাতে গ্রহীত</p>
          </div>
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 p-5 text-white shadow-md">
            <div className="absolute right-3 top-3 text-4xl opacity-10 select-none">📱</div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-blue-100">অনলাইন</p>
            <p className="mt-2 truncate text-2xl font-extrabold" title={fmt(summary.online_amount)}>{fmt(summary.online_amount)}</p>
            <p className="mt-1 truncate text-xs text-blue-100" title={`bKash ${fmt(summary.bkash_amount)} · Nagad ${fmt(summary.nagad_amount)}`}>bKash {fmt(summary.bkash_amount)} · Nagad {fmt(summary.nagad_amount)}</p>
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <p className={lbl}>সার্চ</p>
            <input type="text" placeholder="ক্লায়েন্ট নাম / আইডি / TXN..."
              className={inp}
              value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <div className="min-w-[150px]">
            <p className={lbl}>পদ্ধতি</p>
            <select className={`${inp} bg-white`}
              value={methodF} onChange={e => { setMethodF(e.target.value); setPage(1); }}>
              <option value="">সব পদ্ধতি</option>
              {METHODS.map(m => <option key={m.value} value={m.value}>{m.icon} {m.label}</option>)}
            </select>
          </div>
          <div>
            <p className={lbl}>বিলের মাস</p>
            <input type="month" className={inp}
              value={billMonth} onChange={e => { setBillMonth(e.target.value); setPage(1); }} />
          </div>
          <div>
            <p className={lbl}>তারিখ থেকে</p>
            <input type="date" className={inp}
              value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} />
          </div>
          <div>
            <p className={lbl}>তারিখ পর্যন্ত</p>
            <input type="date" className={inp}
              value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} />
          </div>
          {hasFilter && (
            <button onClick={clearFilters}
              className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-500 transition hover:bg-red-50 hover:text-red-700">
              ✕ Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-sm text-gray-400">
            <span className="mr-2 animate-spin text-xl">⟳</span> লোড হচ্ছে...
          </div>
        ) : payments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <span className="mb-3 text-5xl select-none">📋</span>
            <p className="text-sm">কোনো পেমেন্ট রেকর্ড পাওয়া যায়নি।</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#1d435d] text-left text-[10px] font-bold uppercase tracking-wider text-white/80">
                  <th className="px-4 py-3.5">Client ID</th>
                  <th className="px-4 py-3.5">ক্লায়েন্ট</th>
                  <th className="px-4 py-3.5">বিলের মাস</th>
                  <th className="px-4 py-3.5 text-right">পরিমাণ</th>
                  <th className="px-4 py-3.5">পদ্ধতি</th>
                  <th className="px-4 py-3.5">ট্রানজেকশন ID</th>
                  <th className="px-4 py-3.5">তারিখ</th>
                  <th className="px-4 py-3.5">গ্রহণকারী</th>
                  <th className="px-4 py-3.5">নোট</th>
                  <th className="px-4 py-3.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {payments.map((p, i) => {
                  const m = methodMap[p.payment_method] || methodMap.other;
                  return (
                    <tr key={p.id} className={`transition-colors hover:bg-[#f0f6fa] ${i % 2 === 1 ? 'bg-gray-50/60' : ''}`}>
                      <td className="px-4 py-3">
                        <span className="rounded-md bg-[#e8f0f7] px-2 py-0.5 font-mono text-xs font-semibold text-[#1d435d]">
                          {p.client_customer_id}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={p.client_name} />
                          <div>
                            <p className="font-semibold text-gray-900 leading-tight">{p.client_name}</p>
                            {p.client_phone && <p className="text-[11px] text-gray-400 mt-0.5">{p.client_phone}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100">
                          {p.bill_month}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-base font-bold text-emerald-600">{fmt(p.amount)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${m.color}`}>
                          <span className="text-sm leading-none">{m.icon}</span> {m.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {p.transaction_id
                          ? <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-600">{p.transaction_id}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-500">
                        {new Date(p.payment_date).toLocaleString('bn-BD', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">{p.received_by_name || '—'}</td>
                      <td className="px-4 py-3 max-w-[120px]">
                        <p className="truncate text-xs text-gray-500" title={p.notes}>
                          {p.notes || <span className="text-gray-300">—</span>}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => setDeleteId(p.id)}
                          className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-100">
                          মুছুন
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && count > 0 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
            <span className="text-xs text-gray-500">মোট <strong className="text-gray-700">{count}</strong> পেমেন্ট রেকর্ড</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-40">
                ← আগে
              </button>
              <span className="rounded-lg bg-[#1d435d] px-3 py-1.5 text-xs font-bold text-white">পেজ {page}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={payments.length < 20}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-40">
                পরে →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── New Payment Modal ── */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="flex w-[700px] max-w-full max-h-[90vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">

            {/* Header */}
            <div className="shrink-0 bg-gradient-to-r from-[#1d435d] to-[#245f84] px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 text-xl select-none">💳</div>
                  <div>
                    <p className="font-bold leading-tight text-white">নতুন পেমেন্ট গ্রহণ</p>
                    <p className="mt-0.5 text-xs text-blue-200">New Payment Entry</p>
                  </div>
                </div>
                <button onClick={() => setShowNew(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xl text-white/60 transition hover:bg-white/25 hover:text-white">×</button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5">
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">

                {/* Left: client + bill */}
                <div className="space-y-4">
                  <div>
                    <label className={lbl}>ক্লায়েন্ট <span className="text-red-400 normal-case text-xs">*</span></label>
                    <input className={inp} placeholder="নাম বা ID দিয়ে খুঁজুন..."
                      value={clientQ}
                      onChange={e => { setClientQ(e.target.value); setSelClient(null); setBills([]); setPayForm(f => ({ ...f, bill: '', amount: '' })); }}
                    />
                    {clientRes.length > 0 && !selClient && (
                      <ul className="mt-1 max-h-44 overflow-y-auto rounded-xl border border-gray-200 shadow-lg">
                        {clientRes.map(c => (
                          <li key={c.id} onClick={() => selectClient(c)}
                            role="button" tabIndex={0}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectClient(c); } }}
                            className="flex cursor-pointer items-center justify-between px-3 py-2.5 text-sm transition hover:bg-[#f0f6fa] focus:bg-[#f0f6fa] focus:outline-none">
                            <div className="flex min-w-0 items-center gap-2">
                              <Avatar name={c.full_name} />
                              <span className="truncate font-medium text-gray-800">{c.full_name}</span>
                            </div>
                            <span className="shrink-0 rounded bg-[#e8f0f7] px-2 py-0.5 font-mono text-xs text-[#1d435d]">{c.customer_id}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {selClient && (
                      <p className="mt-1.5 flex items-center gap-1 text-xs text-emerald-600">
                        ✓ {selClient.customer_id} — {selClient.full_name}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className={lbl}>বিল সিলেক্ট করুন <span className="text-red-400 normal-case text-xs">*</span></label>
                    {billsLoad ? (
                      <p className="py-2 text-xs text-gray-400">বিল লোড হচ্ছে...</p>
                    ) : bills.length === 0 && selClient ? (
                      <p className="rounded-lg bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700 ring-1 ring-emerald-100">✓ কোনো বকেয়া বিল নেই।</p>
                    ) : (
                      <select className={`${inp} bg-white`} value={payForm.bill} onChange={e => selectBill(e.target.value)}>
                        <option value="">— বিল সিলেক্ট করুন —</option>
                        {bills.map(b => (
                          <option key={b.id} value={b.id}>
                            {b.bill_month} · বকেয়া: ৳{Number(b.due_amount).toLocaleString()} · {b.status === 'partial' ? 'Partial' : 'Unpaid'}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {payForm.bill && (() => {
                    const b = bills.find(x => String(x.id) === String(payForm.bill));
                    if (!b) return null;
                    return (
                      <div className="rounded-xl border border-[#d0e4f0] bg-[#f0f6fa] p-4 space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-500">নেট বিল</span>
                          <span className="font-semibold text-gray-800">{fmt(b.net_amount)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">পরিশোধ</span>
                          <span className="font-semibold text-emerald-600">{fmt(b.paid_amount)}</span>
                        </div>
                        <div className="flex justify-between border-t border-[#c0d8e8] pt-2">
                          <span className="font-bold text-gray-700">বকেয়া</span>
                          <span className="text-lg font-extrabold text-red-600">{fmt(b.due_amount)}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Right: payment details */}
                <div className="space-y-4">
                  <div>
                    <label className={lbl}>পরিমাণ (৳) <span className="text-red-400 normal-case text-xs">*</span></label>
                    <input
                      className="h-11 w-full rounded-lg border-2 border-[#1d435d]/40 bg-white px-3 text-lg font-bold text-[#1d435d] outline-none transition focus:border-[#1d435d] focus:ring-2 focus:ring-[#1d435d]/15"
                      type="number" min="1" step="0.01"
                      value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
                  </div>
                  <div>
                    <label className={lbl}>পেমেন্ট পদ্ধতি <span className="text-red-400 normal-case text-xs">*</span></label>
                    <select className={`${inp} bg-white`} value={payForm.payment_method} onChange={e => setPayForm(f => ({ ...f, payment_method: e.target.value }))}>
                      {METHODS.map(m => <option key={m.value} value={m.value}>{m.icon} {m.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>ট্রানজেকশন ID <span className="text-[#9bb] text-[10px] font-normal normal-case">(optional)</span></label>
                    <input className={inp} value={payForm.transaction_id}
                      onChange={e => setPayForm(f => ({ ...f, transaction_id: e.target.value }))} placeholder="TXN-XXXXXXXX" />
                  </div>
                  <div>
                    <label className={lbl}>নোট <span className="text-[#9bb] text-[10px] font-normal normal-case">(optional)</span></label>
                    <textarea className={`${inp} resize-none`} rows={4}
                      value={payForm.notes} onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} placeholder="যেকোনো মন্তব্য..." />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="shrink-0 flex items-center gap-3 border-t border-gray-200 bg-gray-50 px-6 py-3">
              <button onClick={() => setShowNew(false)}
                className="h-10 flex-1 rounded-xl border-2 border-gray-300 text-sm font-semibold text-gray-600 transition hover:border-red-400 hover:bg-red-50 hover:text-red-600">
                বাতিল
              </button>
              <button onClick={handleSave} disabled={saving}
                className="h-10 flex-1 rounded-xl bg-[#1d435d] text-sm font-bold text-white shadow-sm transition hover:bg-[#245f84] disabled:opacity-50">
                {saving ? 'সংরক্ষণ হচ্ছে...' : '✓ পেমেন্ট সংরক্ষণ করুন'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ── */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="bg-red-50 px-6 py-6 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-3xl select-none">🗑️</div>
              <h3 className="text-base font-bold text-gray-900">পেমেন্ট মুছবেন?</h3>
              <p className="mt-1.5 text-sm text-gray-500">এই পেমেন্ট রেকর্ডটি মুছে ফেলবেন? বিলের paid/due amount পুনরায় হিসাব হবে না।</p>
            </div>
            <div className="flex gap-3 p-4">
              <button onClick={() => setDeleteId(null)}
                className="h-10 flex-1 rounded-xl border-2 border-gray-200 text-sm font-semibold text-gray-600 transition hover:bg-gray-50">
                বাতিল
              </button>
              <button onClick={handleDelete}
                className="h-10 flex-1 rounded-xl bg-red-600 text-sm font-bold text-white transition hover:bg-red-700">
                মুছে ফেলুন
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
