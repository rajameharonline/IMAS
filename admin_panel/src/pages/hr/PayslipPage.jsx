// এই কম্পোনেন্টটি Payslip Manager — per-employee Generate/Edit, Partial Pay, Payment History flow।
import { Fragment, useEffect, useState, useCallback, useMemo } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

/* ─── Constants & helpers ───────────────────────────────────────────────── */
const MONTHS_FULL = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);   // YYYY-MM

const fmtMoney = (v) =>
  Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d) => d
  ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  : '—';

const periodLabel = (month) => {
  if (!month) return '';
  const [y, m] = month.split('-');
  return `${MONTHS_SHORT[parseInt(m, 10) - 1]} ${y}`;
};

const PAY_METHODS = [
  { value: 'cash',       label: 'Cash',          color: 'bg-emerald-100 text-emerald-700 ring-emerald-200' },
  { value: 'bkash',      label: 'bKash',         color: 'bg-pink-100 text-pink-700 ring-pink-200' },
  { value: 'nagad',      label: 'Nagad',         color: 'bg-orange-100 text-orange-700 ring-orange-200' },
  { value: 'rocket',     label: 'Rocket',        color: 'bg-violet-100 text-violet-700 ring-violet-200' },
  { value: 'bank',       label: 'Bank Transfer', color: 'bg-blue-100 text-blue-700 ring-blue-200' },
  { value: 'sslcommerz', label: 'SSLCommerz',    color: 'bg-teal-100 text-teal-700 ring-teal-200' },
  { value: 'other',      label: 'Other',         color: 'bg-gray-100 text-gray-600 ring-gray-200' },
];
const methodCfg = (m) => PAY_METHODS.find(x => x.value === m) || PAY_METHODS[PAY_METHODS.length - 1];

/* ─── Status badge ──────────────────────────────────────────────────────── */
function StatusBadge({ status }) {
  const cfg = {
    paid:    { bg: 'bg-emerald-500',        text: 'text-white',         label: 'Fully Paid' },
    partial: { bg: 'bg-amber-400',          text: 'text-amber-900',     label: 'Partial'    },
    unpaid:  { bg: 'bg-rose-50 ring-1 ring-rose-200', text: 'text-rose-600', label: 'Unpaid' },
  }[status] || { bg: 'bg-gray-200', text: 'text-gray-700', label: status };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-semibold ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  );
}

/* ─── Method chip ───────────────────────────────────────────────────────── */
function MethodChip({ method }) {
  const c = methodCfg(method);
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ring-1 ${c.color}`}>{c.label}</span>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   PAYMENT MODAL — partial-aware
═══════════════════════════════════════════════════════════════════════════ */
function PaymentModal({ payslip, users, onClose, onPaid }) {
  const net   = Number(payslip.net_salary || 0);
  const paid  = Number(payslip.paid_amount || 0);
  const due   = Math.max(net - paid, 0);

  const [payType,   setPayType]   = useState(due > 0 ? 'full' : 'partial');
  const [amount,    setAmount]    = useState(String(due.toFixed(2)));
  const [method,    setMethod]    = useState('cash');
  const [paidDate,  setPaidDate]  = useState(today());
  const [txnId,     setTxnId]     = useState('');
  const [remarks,   setRemarks]   = useState('');
  const [receivedBy,setReceivedBy]= useState('');
  const [saving,    setSaving]    = useState(false);

  useEffect(() => {
    if (payType === 'full') setAmount(String(due.toFixed(2)));
  }, [payType, due]);

  const excess = Math.max(Number(amount || 0) - due, 0);

  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error('Amount সঠিক নয়'); return; }
    if (!paidDate) { toast.error('Payment Date আবশ্যক'); return; }
    setSaving(true);
    try {
      const res = await api.post(`/hr/payroll/${payslip.id}/pay/`, {
        amount: amt,
        payment_method: method,
        paid_date: paidDate,
        transaction_id: txnId,
        notes: remarks,
        received_by: receivedBy || undefined,
      });
      const addedAdvance = Number(res.data?.excess_added_to_advance || 0);
      if (addedAdvance > 0) {
        toast.success(`✅ Due (${fmtMoney(due)}) পরিশোধ + অতিরিক্ত ${fmtMoney(addedAdvance)} Advance হিসেবে যোগ হয়েছে`);
      } else {
        toast.success(amt + 0.001 >= due ? '✅ পূর্ণ পেমেন্ট সম্পন্ন' : '✅ Partial payment record হয়েছে');
      }
      onPaid();
    } catch (err) {
      toast.error(err.response?.data?.error || 'পেমেন্ট ব্যর্থ হয়েছে');
    } finally { setSaving(false); }
  };

  const inp = 'border border-gray-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-teal-600 to-emerald-600 text-white">
          <div>
            <h2 className="text-base font-bold">Receive Payment</h2>
            <p className="text-[11px] opacity-90 mt-0.5">{payslip.employee_name} · {periodLabel(payslip.month)}</p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-2xl leading-none">×</button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-2 px-6 py-4 bg-gray-50 border-b border-gray-100">
          <div className="text-center px-2 py-2 rounded-lg bg-white border border-gray-100">
            <p className="text-[10px] font-semibold text-gray-500 uppercase">Net</p>
            <p className="text-sm font-bold text-gray-900">{fmtMoney(net)}</p>
          </div>
          <div className="text-center px-2 py-2 rounded-lg bg-white border border-gray-100">
            <p className="text-[10px] font-semibold text-gray-500 uppercase">Paid</p>
            <p className="text-sm font-bold text-emerald-600">{fmtMoney(paid)}</p>
          </div>
          <div className="text-center px-2 py-2 rounded-lg bg-rose-50 border border-rose-100">
            <p className="text-[10px] font-semibold text-rose-600 uppercase">Due</p>
            <p className="text-sm font-bold text-rose-600">{fmtMoney(due)}</p>
          </div>
        </div>

        {/* Type toggle */}
        <div className="px-6 pt-4 flex gap-3">
          {[['full', 'Pay Full'], ['partial', 'Pay Partial']].map(([k, l]) => (
            <button key={k} onClick={() => setPayType(k)}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg border transition ${
                payType === k
                  ? 'bg-teal-50 border-teal-400 text-teal-700 ring-2 ring-teal-200'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
              }`}>{l}</button>
          ))}
        </div>

        {/* Form */}
        <div className="px-6 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Amount <span className="text-rose-500">*</span></label>
              <input type="number" min="0" step="0.01"
                className={inp + (payType === 'full' ? ' bg-gray-50' : '')}
                value={amount} readOnly={payType === 'full'}
                onChange={e => setAmount(e.target.value)} />
              {excess > 0 && (
                <p className="text-[11px] text-amber-600 mt-1">
                  Due-এর বেশি {fmtMoney(excess)} — Advance balance-এ যোগ হবে
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Payment Date <span className="text-rose-500">*</span></label>
              <input type="date" className={inp} value={paidDate} onChange={e => setPaidDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Method</label>
              <select className={inp} value={method} onChange={e => setMethod(e.target.value)}>
                {PAY_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Transaction ID</label>
              <input type="text" className={inp} placeholder="Optional"
                value={txnId} onChange={e => setTxnId(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Received By</label>
            <select className={inp} value={receivedBy} onChange={e => setReceivedBy(e.target.value)}>
              <option value="">— Current user —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.full_name || u.username}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Remarks / Notes</label>
            <textarea rows={2} className={inp} placeholder="Optional note..."
              value={remarks} onChange={e => setRemarks(e.target.value)} />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center gap-3 bg-gray-50">
          <button onClick={onClose}
            className="px-5 py-2 text-sm font-semibold bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={submit} disabled={saving || Number(amount || 0) <= 0}
            className="ml-auto inline-flex items-center gap-2 px-6 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition">
            {saving && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            Confirm Payment
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PAYSLIP DETAIL MODAL — entries + payments + print
═══════════════════════════════════════════════════════════════════════════ */
function PayslipDetailModal({ payslipId, users, onClose, onChanged }) {
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [advances, setAdvances] = useState([]);
  const [advLoading, setAdvLoading] = useState(true);
  const [editingAdvId, setEditingAdvId] = useState(null);
  const [editForm,     setEditForm]     = useState({ amount: '', monthly_deduction: '', notes: '' });
  const [savingAdv,    setSavingAdv]    = useState(false);
  const [editingPayId, setEditingPayId] = useState(null);
  const [payEditForm,  setPayEditForm]  = useState({
    amount: '', payment_method: 'cash', paid_date: '', transaction_id: '', notes: '', received_by: '',
  });
  const [savingPay,    setSavingPay]    = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/hr/payroll/${payslipId}/`);
      setData(r.data);
      setAdvLoading(true);
      try {
        const ra = await api.get(`/hr/advances/by-employee/?employee=${r.data.employee}`);
        setAdvances(ra.data || []);
      } catch { /* advance history না পেলেও payslip details দেখানো বন্ধ হবে না */ }
      finally { setAdvLoading(false); }
    } catch { toast.error('Payslip load ব্যর্থ'); }
    finally { setLoading(false); }
  }, [payslipId]);

  useEffect(() => { reload(); }, [reload]);

  const handleDeletePayment = async (payId) => {
    if (!window.confirm('এই payment record মুছবেন?')) return;
    try {
      await api.delete(`/hr/payroll/${payslipId}/payments/${payId}/remove/`);
      toast.success('Payment removed');
      reload();
      onChanged();
    } catch { toast.error('Remove ব্যর্থ'); }
  };

  const startEditPayment = (p) => {
    setEditingPayId(p.id);
    setPayEditForm({
      amount: String(p.amount), payment_method: p.payment_method || 'cash',
      paid_date: p.paid_date || '', transaction_id: p.transaction_id || '',
      notes: p.notes || '', received_by: p.received_by || '',
    });
  };

  const saveEditPayment = async (p) => {
    const amt = Number(payEditForm.amount);
    if (!amt || amt <= 0) { toast.error('Amount > 0 দিন'); return; }
    if (!payEditForm.paid_date) { toast.error('Payment Date আবশ্যক'); return; }
    setSavingPay(true);
    try {
      await api.patch(`/hr/payroll/${payslipId}/payments/${p.id}/edit/`, {
        amount: amt,
        payment_method: payEditForm.payment_method,
        paid_date: payEditForm.paid_date,
        transaction_id: payEditForm.transaction_id,
        notes: payEditForm.notes,
        received_by: payEditForm.received_by || undefined,
      });
      toast.success('✅ Payment আপডেট হয়েছে');
      setEditingPayId(null);
      reload();
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Update ব্যর্থ');
    } finally { setSavingPay(false); }
  };

  const handleDeleteAdvance = async (adv) => {
    if ((adv.recovered_amount || 0) > 0) {
      toast.error('Recovery শুরু হয়ে গেছে — delete করা যাবে না');
      return;
    }
    if (!window.confirm(`${fmtMoney(adv.amount)} tk advance entry মুছবেন?`)) return;
    try {
      await api.delete(`/hr/advances/${adv.id}/`);
      toast.success('Advance মুছে দেওয়া হয়েছে');
      reload();
      onChanged();
    } catch { toast.error('Delete ব্যর্থ'); }
  };

  const startEditAdvance = (adv) => {
    setEditingAdvId(adv.id);
    setEditForm({
      amount: String(adv.amount), monthly_deduction: String(adv.monthly_deduction || 0),
      notes: adv.notes || '',
    });
  };

  const saveEditAdvance = async (adv) => {
    const amt = Number(editForm.amount);
    if (!amt || amt <= 0) { toast.error('Amount > 0 দিন'); return; }
    if (amt < Number(adv.recovered_amount || 0)) {
      toast.error(`Amount ইতিমধ্যে recover হওয়া (${fmtMoney(adv.recovered_amount)})-এর কম করা যাবে না`);
      return;
    }
    setSavingAdv(true);
    try {
      await api.patch(`/hr/advances/${adv.id}/`, {
        amount: amt,
        monthly_deduction: Number(editForm.monthly_deduction) || 0,
        notes: editForm.notes,
      });
      toast.success('✅ Advance balance আপডেট হয়েছে');
      setEditingAdvId(null);
      reload();
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.amount?.[0] || err.response?.data?.error || 'Update ব্যর্থ');
    } finally { setSavingAdv(false); }
  };

  const handlePrint = () => {
    const w = window.open('', '_blank', 'width=820,height=900');
    if (!w) return toast.error('Pop-up blocker enabled');
    w.document.write(`<html><head><title>Payslip - ${data.employee_name}</title>
      <style>
        body { font-family: -apple-system, system-ui, sans-serif; padding: 32px; color: #111; }
        h1 { margin:0; font-size:20px; }
        h2 { margin:24px 0 8px; font-size:14px; border-bottom:2px solid #14b8a6; padding-bottom:4px; color:#0f766e; }
        table { width:100%; border-collapse:collapse; font-size:12px; }
        th, td { border:1px solid #e5e7eb; padding:8px; text-align:left; }
        th { background:#f3f4f6; font-weight:600; }
        .right { text-align:right; }
        .center { text-align:center; }
        .summary td { padding:6px 8px; font-size:13px; }
        .total td { font-weight:bold; background:#ecfdf5; color:#065f46; }
      </style></head><body>${document.getElementById('payslip-print-area').innerHTML}
      <script>window.print(); setTimeout(() => window.close(), 500);</script>
      </body></html>`);
    w.document.close();
  };

  if (loading || !data) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl p-12 shadow-2xl">
          <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-500 mt-3">Loading…</p>
        </div>
      </div>
    );
  }

  const additions  = data.entries.filter(e => e.payhead_type === 'addition');
  const deductions = data.entries.filter(e => e.payhead_type === 'deduction');
  const advRemainingTotal = advances.reduce((s, a) => s + Number(a.remaining_amount || 0), 0);
  const invoiceNo = `PS-${String(data.id).padStart(6, '0')}`;

  // ── একই সিম্পল টেবিল-স্টাইল সব সেকশনে (Salary Breakdown / Payment History / Advance History) ──
  const sectionLabel = 'px-6 pt-5 pb-2 text-xs font-bold text-gray-500 uppercase tracking-wider';
  const tableWrap = 'mx-6 rounded-lg border border-gray-200 overflow-hidden';
  const thCls = 'px-4 py-2.5 text-left font-semibold';
  const tdCls = 'px-4 py-2.5';
  const editInp = 'border border-gray-300 rounded-md px-2 py-1 text-xs w-full focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-800 via-slate-800 to-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-base font-bold shrink-0">
              {data.employee_name?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold truncate">{data.employee_name}</h2>
                <StatusBadge status={data.payment_status} />
              </div>
              <p className="text-[11px] text-slate-300 mt-0.5 truncate">
                {data.employee_id_code} · {data.employee_designation || '—'} · {periodLabel(data.month)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden sm:inline text-[11px] font-mono text-slate-400 tracking-wide mr-1">{invoiceNo}</span>
            <button onClick={handlePrint}
              className="px-3 py-1.5 text-xs font-semibold bg-white/10 hover:bg-white/20 rounded-lg border border-white/20 transition">
              🖨 Print
            </button>
            <button onClick={onClose} className="text-white/70 hover:text-white text-2xl leading-none ml-1">×</button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 pb-6" id="payslip-print-area">
          {/* Employee / Period info strip */}
          <div className="px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-4 border-b border-gray-100 bg-gray-50/50">
            <div>
              <p className="text-[10px] uppercase font-semibold text-gray-500">Employee</p>
              <p className="text-sm font-bold text-gray-900">{data.employee_name}</p>
              <p className="text-[11px] text-gray-500">{data.employee_id_code}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-semibold text-gray-500">Designation</p>
              <p className="text-sm font-semibold text-gray-800">{data.employee_designation || '—'}</p>
              <p className="text-[11px] text-gray-500">{data.payroll_name || '—'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-semibold text-gray-500">Period</p>
              <p className="text-sm font-semibold text-gray-800">{periodLabel(data.month)}</p>
              <p className="text-[11px] text-gray-500">Generated {fmtDate(data.created_at)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-semibold text-gray-500">Status</p>
              <div className="mt-1"><StatusBadge status={data.payment_status} /></div>
            </div>
          </div>

          {/* ── ১. Salary Breakdown — payment summary-সহ একটাই টেবিল ── */}
          <h3 className={sectionLabel}>Salary Breakdown</h3>
          <div className={tableWrap}>
            <table className="w-full text-xs">
              <thead className="bg-gray-100 text-gray-600">
                <tr>
                  <th className={thCls}>Description</th>
                  <th className={`${thCls} text-center w-28`}>Type</th>
                  <th className={`${thCls} text-right w-32`}>Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {additions.map(e => (
                  <tr key={`a-${e.id}`}>
                    <td className={`${tdCls} text-gray-700`}>{e.payhead_name}</td>
                    <td className={`${tdCls} text-center text-emerald-600 font-medium`}>Addition</td>
                    <td className={`${tdCls} text-right font-semibold text-emerald-700`}>+{fmtMoney(e.final_amount)}</td>
                  </tr>
                ))}
                {deductions.map(e => (
                  <tr key={`d-${e.id}`}>
                    <td className={`${tdCls} text-gray-700`}>{e.payhead_name}</td>
                    <td className={`${tdCls} text-center text-rose-600 font-medium`}>Deduction</td>
                    <td className={`${tdCls} text-right font-semibold text-rose-700`}>−{fmtMoney(e.final_amount)}</td>
                  </tr>
                ))}
                {additions.length === 0 && deductions.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400 italic">কোনো payhead entry নেই</td></tr>
                )}
              </tbody>
              <tfoot className="border-t border-gray-200">
                <tr className="bg-gray-50">
                  <td className={`${tdCls} text-gray-500`} colSpan={2}>Total Addition</td>
                  <td className={`${tdCls} text-right font-semibold text-emerald-700`}>+{fmtMoney(data.total_addition)}</td>
                </tr>
                <tr className="bg-gray-50">
                  <td className={`${tdCls} text-gray-500`} colSpan={2}>Total Deduction</td>
                  <td className={`${tdCls} text-right font-semibold text-rose-700`}>−{fmtMoney(data.total_deduction)}</td>
                </tr>
                <tr className="bg-teal-50 border-t border-teal-100">
                  <td className={`${tdCls} font-bold text-teal-800`} colSpan={2}>Net Payable</td>
                  <td className={`${tdCls} text-right font-bold text-teal-800`}>{fmtMoney(data.net_salary)}</td>
                </tr>
                <tr className="border-t border-gray-200">
                  <td className={`${tdCls} text-gray-500`} colSpan={2}>Amount Paid</td>
                  <td className={`${tdCls} text-right font-semibold text-emerald-600`}>{fmtMoney(data.paid_amount)}</td>
                </tr>
                <tr className={data.due_amount > 0 ? 'bg-rose-50' : 'bg-emerald-50'}>
                  <td className={`${tdCls} font-bold ${data.due_amount > 0 ? 'text-rose-700' : 'text-emerald-700'}`} colSpan={2}>
                    Balance Due
                  </td>
                  <td className={`${tdCls} text-right font-bold ${data.due_amount > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {fmtMoney(data.due_amount)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* ── ২. Payment History ── */}
          <h3 className={sectionLabel}>Payment History <span className="text-gray-400 font-semibold normal-case">({data.payments.length})</span></h3>
          <div className={tableWrap}>
            {data.payments.length === 0 ? (
              <div className="text-center py-6 text-gray-400 text-sm">এখনো কোনো payment হয়নি</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gray-100 text-gray-600">
                  <tr>
                    <th className={thCls}>#</th>
                    <th className={thCls}>Date</th>
                    <th className={thCls}>Method</th>
                    <th className={`${thCls} text-right`}>Amount</th>
                    <th className={thCls}>Txn ID</th>
                    <th className={thCls}>Received By</th>
                    <th className={`${thCls} text-center no-print`}>Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.payments.map((p, i) => (
                    editingPayId === p.id ? (
                      <tr key={p.id} className="bg-blue-50/40">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                            <div>
                              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">Amount</label>
                              <input type="number" min="0" step="0.01" value={payEditForm.amount}
                                onChange={e => setPayEditForm(f => ({ ...f, amount: e.target.value }))}
                                className={editInp} />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">Date</label>
                              <input type="date" value={payEditForm.paid_date}
                                onChange={e => setPayEditForm(f => ({ ...f, paid_date: e.target.value }))}
                                className={editInp} />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">Method</label>
                              <select value={payEditForm.payment_method}
                                onChange={e => setPayEditForm(f => ({ ...f, payment_method: e.target.value }))}
                                className={editInp}>
                                {PAY_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">Txn ID</label>
                              <input type="text" value={payEditForm.transaction_id}
                                onChange={e => setPayEditForm(f => ({ ...f, transaction_id: e.target.value }))}
                                className={editInp} />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">Received By</label>
                              <select value={payEditForm.received_by}
                                onChange={e => setPayEditForm(f => ({ ...f, received_by: e.target.value }))}
                                className={editInp}>
                                <option value="">— Current user —</option>
                                {(users || []).map(u => (
                                  <option key={u.id} value={u.id}>{u.full_name || u.username}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">Notes</label>
                              <input type="text" value={payEditForm.notes}
                                onChange={e => setPayEditForm(f => ({ ...f, notes: e.target.value }))}
                                className={editInp} />
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-2.5">
                            <button onClick={() => saveEditPayment(p)} disabled={savingPay}
                              className="px-3 py-1.5 text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50">
                              {savingPay ? 'Saving…' : 'Save'}
                            </button>
                            <button onClick={() => setEditingPayId(null)} disabled={savingPay}
                              className="px-3 py-1.5 text-[11px] font-semibold bg-white border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-md">
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={p.id} className="hover:bg-gray-50/80 transition-colors">
                        <td className={`${tdCls} text-gray-400`}>{i + 1}</td>
                        <td className={`${tdCls} text-gray-700`}>{fmtDate(p.paid_date)}</td>
                        <td className={tdCls}><MethodChip method={p.payment_method} /></td>
                        <td className={`${tdCls} text-right font-bold text-emerald-600`}>{fmtMoney(p.amount)}</td>
                        <td className={`${tdCls} text-gray-500 font-mono text-[10px]`}>{p.transaction_id || '—'}</td>
                        <td className={`${tdCls} text-gray-600`}>{p.received_by_name || '—'}</td>
                        <td className={`${tdCls} no-print`}>
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => startEditPayment(p)}
                              title="Edit payment"
                              className="w-6 h-6 inline-flex items-center justify-center rounded-md text-blue-600 hover:bg-blue-50 transition">✎</button>
                            <button onClick={() => handleDeletePayment(p.id)}
                              title="Remove payment"
                              className="w-6 h-6 inline-flex items-center justify-center rounded-md text-rose-500 hover:bg-rose-50 hover:text-rose-700 transition">🗑</button>
                          </div>
                        </td>
                      </tr>
                    )
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {data.payments.some(p => p.notes) && (
            <div className="mx-6 mt-2 space-y-1">
              {data.payments.filter(p => p.notes).map(p => (
                <p key={p.id} className="text-[11px] text-gray-500">
                  <span className="font-semibold text-gray-700">{fmtDate(p.paid_date)}:</span> {p.notes}
                </p>
              ))}
            </div>
          )}

          {/* ── ৩. Advance History — একই সিম্পল টেবিল স্টাইলে ── */}
          <h3 className={sectionLabel}>
            Advance History <span className="text-gray-400 font-semibold normal-case">({advances.length})</span>
            {advRemainingTotal > 0 && (
              <span className="no-print ml-2 text-[11px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 normal-case tracking-normal">
                Outstanding {fmtMoney(advRemainingTotal)}
              </span>
            )}
          </h3>
          <div className={tableWrap}>
            {advLoading ? (
              <div className="text-center py-6 text-gray-400 text-sm">Loading…</div>
            ) : advances.length === 0 ? (
              <div className="text-center py-6 text-gray-400 text-sm">এই employee-এর কোনো advance entry নেই</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gray-100 text-gray-600">
                  <tr>
                    <th className={thCls}>#</th>
                    <th className={thCls}>Date</th>
                    <th className={thCls}>Method</th>
                    <th className={`${thCls} text-right`}>Amount</th>
                    <th className={`${thCls} text-right`}>Monthly</th>
                    <th className={`${thCls} text-right`}>Recovered</th>
                    <th className={`${thCls} text-right`}>Remaining</th>
                    <th className={thCls}>Status</th>
                    <th className={`${thCls} text-center no-print`}>Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {advances.map((a, i) => (
                    editingAdvId === a.id ? (
                      <tr key={a.id} className="bg-blue-50/40">
                        <td colSpan={9} className="px-4 py-3">
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            <div>
                              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">Amount</label>
                              <input type="number" min="0" step="0.01"
                                value={editForm.amount}
                                onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))}
                                className={editInp} />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">Monthly Deduction</label>
                              <input type="number" min="0" step="0.01"
                                value={editForm.monthly_deduction}
                                onChange={e => setEditForm(f => ({ ...f, monthly_deduction: e.target.value }))}
                                className={editInp} />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">Notes</label>
                              <input type="text" value={editForm.notes}
                                onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                                className={editInp} />
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-2.5">
                            <button onClick={() => saveEditAdvance(a)} disabled={savingAdv}
                              className="px-3 py-1.5 text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50">
                              {savingAdv ? 'Saving…' : 'Save'}
                            </button>
                            <button onClick={() => setEditingAdvId(null)} disabled={savingAdv}
                              className="px-3 py-1.5 text-[11px] font-semibold bg-white border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-md">
                              Cancel
                            </button>
                            {Number(a.recovered_amount) > 0 && (
                              <span className="text-[10px] text-amber-600">ইতিমধ্যে {fmtMoney(a.recovered_amount)} recover হয়েছে — Amount তার কম করা যাবে না</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <Fragment key={a.id}>
                        <tr className="hover:bg-gray-50/80 transition-colors">
                          <td className={`${tdCls} text-gray-400`}>{i + 1}</td>
                          <td className={`${tdCls} text-gray-700`}>{fmtDate(a.taken_date)}</td>
                          <td className={tdCls}><MethodChip method={a.payment_method} /></td>
                          <td className={`${tdCls} text-right font-semibold text-gray-800`}>{fmtMoney(a.amount)}</td>
                          <td className={`${tdCls} text-right text-gray-600`}>{Number(a.monthly_deduction) > 0 ? fmtMoney(a.monthly_deduction) : '— full —'}</td>
                          <td className={`${tdCls} text-right font-semibold text-emerald-700`}>{fmtMoney(a.recovered_amount)}</td>
                          <td className={`${tdCls} text-right font-semibold text-rose-700`}>{fmtMoney(a.remaining_amount)}</td>
                          <td className={tdCls}>
                            {a.is_cleared
                              ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">CLEARED</span>
                              : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">ACTIVE</span>}
                          </td>
                          <td className={`${tdCls} no-print`}>
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => startEditAdvance(a)}
                                title="Edit advance"
                                className="w-6 h-6 inline-flex items-center justify-center rounded-md text-blue-600 hover:bg-blue-50 transition">✎</button>
                              {!a.recovered_amount && (
                                <button onClick={() => handleDeleteAdvance(a)}
                                  title="Delete advance"
                                  className="w-6 h-6 inline-flex items-center justify-center rounded-md text-rose-500 hover:bg-rose-50 hover:text-rose-700 transition">🗑</button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {(a.notes || (a.recoveries && a.recoveries.length > 0)) && (
                          <tr className="bg-gray-50/60">
                            <td colSpan={9} className="px-4 py-2">
                              {a.notes && <p className="text-[11px] text-gray-500">📝 {a.notes}</p>}
                              {a.recoveries && a.recoveries.length > 0 && (
                                <details className="text-[11px] mt-1">
                                  <summary className="cursor-pointer text-gray-600 hover:text-gray-800 font-semibold">
                                    Recovery history ({a.recoveries.length})
                                  </summary>
                                  <table className="w-full mt-1.5 text-[11px]">
                                    <thead className="text-gray-500">
                                      <tr><th className="text-left px-2 py-1">Date</th><th className="text-left px-2 py-1">Month</th><th className="text-right px-2 py-1">Amount</th></tr>
                                    </thead>
                                    <tbody>
                                      {a.recoveries.map(r => (
                                        <tr key={r.id} className="border-t border-gray-200">
                                          <td className="px-2 py-1">{fmtDate(r.recovered_date)}</td>
                                          <td className="px-2 py-1">{r.payslip_month ? periodLabel(r.payslip_month) : '—'}</td>
                                          <td className="px-2 py-1 text-right font-semibold text-emerald-700">{fmtMoney(r.amount)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </details>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ADVANCE MODAL — take advance + show recovery history
═══════════════════════════════════════════════════════════════════════════ */
function AdvanceModal({ emp, users, onClose, onChanged }) {
  const [list,    setList]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding,  setAdding]  = useState(false);
  const [form,    setForm]    = useState({
    amount: '', monthly_deduction: '', taken_date: today(),
    payment_method: 'cash', transaction_id: '', notes: '', received_by: '',
  });

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/hr/advances/by-employee/?employee=${emp.id}`);
      setList(r.data || []);
    } catch { toast.error('Advance load ব্যর্থ'); }
    finally { setLoading(false); }
  }, [emp.id]);

  useEffect(() => { reload(); }, [reload]);

  const submit = async () => {
    if (!form.amount || Number(form.amount) <= 0) { toast.error('Amount > 0 দিন'); return; }
    if (!form.taken_date) { toast.error('Taken date আবশ্যক'); return; }
    setAdding(true);
    try {
      await api.post('/hr/advances/', {
        employee:          emp.id,
        amount:            Number(form.amount),
        monthly_deduction: Number(form.monthly_deduction) || 0,
        taken_date:        form.taken_date,
        payment_method:    form.payment_method,
        transaction_id:    form.transaction_id,
        notes:             form.notes,
        received_by:       form.received_by || null,
      });
      toast.success(`✅ ${fmtMoney(form.amount)} tk advance entry হয়েছে`);
      setForm({
        amount: '', monthly_deduction: '', taken_date: today(),
        payment_method: 'cash', transaction_id: '', notes: '', received_by: '',
      });
      await reload();
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Advance save ব্যর্থ');
    } finally { setAdding(false); }
  };

  const totals = useMemo(() => {
    let total = 0, recovered = 0, remaining = 0;
    list.forEach(a => {
      total     += Number(a.amount || 0);
      recovered += Number(a.recovered_amount || 0);
      remaining += Number(a.remaining_amount || 0);
    });
    return { total, recovered, remaining };
  }, [list]);

  const inp = 'border border-gray-300 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-bold">Employee Advance</h2>
            <p className="text-[11px] opacity-90 mt-0.5">{emp.full_name} · {emp.employee_id}</p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-2xl leading-none">×</button>
        </div>

        {/* Totals */}
        <div className="grid grid-cols-3 gap-2 px-6 py-3 bg-amber-50/40 border-b border-amber-100 shrink-0">
          <div className="text-center px-2 py-2 rounded-lg bg-white border border-amber-100">
            <p className="text-[10px] font-semibold text-gray-500 uppercase">Total Given</p>
            <p className="text-sm font-bold text-gray-900">{fmtMoney(totals.total)}</p>
          </div>
          <div className="text-center px-2 py-2 rounded-lg bg-white border border-emerald-100">
            <p className="text-[10px] font-semibold text-emerald-600 uppercase">Recovered</p>
            <p className="text-sm font-bold text-emerald-600">{fmtMoney(totals.recovered)}</p>
          </div>
          <div className="text-center px-2 py-2 rounded-lg bg-white border border-rose-100">
            <p className="text-[10px] font-semibold text-rose-600 uppercase">Remaining</p>
            <p className="text-sm font-bold text-rose-600">{fmtMoney(totals.remaining)}</p>
          </div>
        </div>

        {/* Add new form */}
        <div className="px-6 py-3 bg-white border-b border-gray-100 shrink-0">
          <h3 className="text-[11px] font-bold text-gray-700 uppercase tracking-wide mb-2">+ New Advance Entry</h3>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">Amount <span className="text-rose-500">*</span></label>
              <input type="number" min="0" step="0.01" placeholder="0.00"
                value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                className={`${inp} w-full`} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">Monthly Deduction</label>
              <input type="number" min="0" step="0.01" placeholder="0 = full একবারে"
                value={form.monthly_deduction} onChange={e => setForm(f => ({ ...f, monthly_deduction: e.target.value }))}
                className={`${inp} w-full`} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">Taken Date <span className="text-rose-500">*</span></label>
              <input type="date" value={form.taken_date}
                onChange={e => setForm(f => ({ ...f, taken_date: e.target.value }))}
                className={`${inp} w-full`} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">Method</label>
              <select value={form.payment_method}
                onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}
                className={`${inp} w-full`}>
                {PAY_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">Txn ID</label>
              <input type="text" placeholder="Optional"
                value={form.transaction_id}
                onChange={e => setForm(f => ({ ...f, transaction_id: e.target.value }))}
                className={`${inp} w-full`} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">Given By</label>
              <select value={form.received_by}
                onChange={e => setForm(f => ({ ...f, received_by: e.target.value }))}
                className={`${inp} w-full`}>
                <option value="">— Current user —</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.full_name || u.username}</option>
                ))}
              </select>
            </div>
            <div className="col-span-3">
              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">Notes</label>
              <input type="text" placeholder="Reason / remarks (optional)"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className={`${inp} w-full`} />
            </div>
          </div>
          <div className="flex items-center mt-3">
            <p className="text-[10px] text-gray-500 italic">
              💡 Monthly Deduction 0 দিলে পরবর্তী একটি payslip-এ পুরোটা একবারে কাটবে। অন্যথায় প্রতি মাসে এই amount-টা।
            </p>
            <button onClick={submit} disabled={adding}
              className="ml-auto inline-flex items-center gap-2 px-4 py-1.5 text-xs font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50">
              {adding && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              + Save Advance
            </button>
          </div>
        </div>

        {/* Full advance history এখানে repeat করা হয় না — confusion এড়াতে সব history
            এখন একটাই জায়গায়: প্রতিটি payslip-এর "View Details" → Advance History। */}
        <div className="px-6 py-3 flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-center py-6 text-gray-400 text-sm">Loading…</div>
          ) : (
            <div className="text-center py-6 text-gray-500 text-xs bg-gray-50 rounded-lg border border-dashed border-gray-200">
              সম্পূর্ণ Advance History (recovery breakdown সহ) দেখতে ও পুরনো entry delete করতে —<br />
              যেকোনো payslip-এর <strong>View Details</strong>-এ যান।
              {list.length > 0 && <span className="block mt-1 text-gray-400">এই employee-এর {list.length} টি advance entry আছে।</span>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 shrink-0 flex justify-end">
          <button onClick={onClose}
            className="px-6 py-2 text-sm font-semibold bg-slate-800 text-white rounded-lg hover:bg-slate-900">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   EDIT PAY SLIP MODAL — existing payslip live-save edit (separate modal)
   - Row-এর Edit বাটন / existing-month Pay Slip বাটন থেকে খোলে
   - Basic salary ট্র্যাক করা হয় না (সবসময় 0), তাই percentage-type payhead সবসময় amount 0 দেখায়
   - Payhead add/update/remove → live API call
   - Apply Advance → এখনো recover হয়নি advance deduction যোগ করে net update
   - Auto advance-recovery entry (payhead=null) read-only দেখানো হয়
═══════════════════════════════════════════════════════════════════════════ */
function EditPayslipModal({ payslipId, employee, advanceBalance, onClose, onChanged }) {
  const [data,       setData]       = useState(null);
  const [items,      setItems]      = useState([]);
  const [assignable, setAssignable] = useState([]);  // payroll-assigned payheads (amount সহ) — dropdown source
  const [loading,    setLoading]    = useState(true);
  const [applying,   setApplying]   = useState(false);

  // server detail → local state hydrate
  const hydrate = (d) => {
    setData(d);
    setItems((d.entries || []).map(e => ({
      entry_id: e.id, payhead: e.payhead, payhead_name: e.payhead_name,
      payhead_type: e.payhead_type, amount_type: e.amount_type,
      unit_amount: String(e.unit_amount),
      is_advance: !e.payhead,   // payhead null = auto advance recovery entry
    })));
  };

  const reload = useCallback(async () => {
    try {
      const r = await api.get(`/hr/payroll/${payslipId}/`);
      hydrate(r.data);
    } catch { toast.error('Payslip load ব্যর্থ'); }
    finally { setLoading(false); }
  }, [payslipId]);

  useEffect(() => { reload(); }, [reload]);

  // dropdown source — employee-এর payroll-এ assign করা payhead (amount সহ)
  useEffect(() => {
    if (!employee) return;
    api.get(`/hr/payroll/assignable-payheads/?employee=${employee}`)
      .then(r => setAssignable(r.data || [])).catch(() => setAssignable([]));
  }, [employee]);

  // প্রতিটি live change-এর পর fresh data + parent list refresh
  const notify = async () => { await reload(); onChanged(); };

  // "+ Add Payhead" — assigned list থেকে amount সহ যোগ হয়, নতুন entry লাগে না
  const addItem = async (phId) => {
    const ph = assignable.find(p => Number(p.payhead) === Number(phId));
    if (!ph) return;
    if (items.some(it => Number(it.payhead) === Number(ph.payhead))) { toast.error(`${ph.payhead_name} ইতিমধ্যে যোগ আছে`); return; }
    try {
      await api.post(`/hr/payroll/${payslipId}/assign-payhead/`, {
        payhead: ph.payhead, amount_type: ph.amount_type, unit_amount: Number(ph.unit_amount) || 0,
      });
      await notify();
      toast.success(`${ph.payhead_name} যোগ হয়েছে (${fmtMoney(ph.unit_amount)})`);
    } catch { toast.error('Add ব্যর্থ'); }
  };

  const updateUnit = async (it, val) => {
    if (Number(val) === Number(it.unit_amount)) return;
    try {
      await api.patch(`/hr/payroll/${payslipId}/entries/${it.entry_id}/update/`, { unit_amount: Number(val) || 0 });
      await notify();
    } catch { toast.error('Update ব্যর্থ'); }
  };

  const updateAmountType = async (it, val) => {
    try {
      await api.post(`/hr/payroll/${payslipId}/assign-payhead/`, { payhead: it.payhead, amount_type: val, unit_amount: Number(it.unit_amount) || 0 });
      await notify();
    } catch { toast.error('Update ব্যর্থ'); }
  };

  const removeItem = async (it) => {
    if (!window.confirm('Entry টি মুছবেন?')) return;
    try {
      await api.delete(`/hr/payroll/${payslipId}/entries/${it.entry_id}/remove/`);
      await notify();
    } catch { toast.error('Remove ব্যর্থ'); }
  };

  // outstanding advance এই payslip-এ recover করি (idempotent — backend ঠেকায়)
  const applyAdvance = async () => {
    setApplying(true);
    try {
      const r = await api.post(`/hr/payroll/${payslipId}/apply-advance/`);
      const applied = Number(r.data?.applied || 0);
      toast.success(applied > 0 ? `✅ ${fmtMoney(applied)} tk advance recover হয়েছে` : 'নতুন করে recover করার মতো advance নেই');
      await notify();
    } catch (err) { toast.error(err.response?.data?.error || 'Apply ব্যর্থ'); }
    finally { setApplying(false); }
  };

  const inp = 'border border-gray-300 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500';
  const availablePh = assignable.filter(a => !items.some(it => Number(it.payhead) === Number(a.payhead)));
  const advRemaining = Number(advanceBalance || 0);
  const basicN = Number(data?.basic_salary) || 0;

  if (loading || !data) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl p-12 shadow-2xl">
          <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-500 mt-3">Loading…</p>
        </div>
      </div>
    );
  }

  const paid = Number(data.paid_amount || 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 text-white flex items-center justify-between shrink-0 bg-gradient-to-r from-blue-600 to-indigo-600">
          <div>
            <h2 className="text-base font-bold">Pay Slip</h2>
            <p className="text-[11px] opacity-90 mt-0.5">Edit · {data.employee_name} · {periodLabel(data.month)}</p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-2xl leading-none">×</button>
        </div>

        {/* Month (lock) — Basic Salary আর আলাদা নয়, payhead হিসেবে আসে */}
        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50/40 shrink-0">
          <label className="block text-[11px] font-semibold text-gray-600 mb-1">Month</label>
          <input type="text" value={periodLabel(data.month)} disabled
            className={`${inp} w-full max-w-xs text-sm py-1.5 bg-gray-100 cursor-not-allowed`} />
          <p className="text-[10px] text-gray-400 mt-0.5">Existing payslip — month lock</p>
        </div>

        {/* Status banner */}
        <div className={`px-6 py-2 text-xs flex items-center gap-3 border-b border-gray-100 ${
          paid > 0 ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
        }`}>
          <StatusBadge status={data.payment_status} />
          <span>Paid: <strong>{fmtMoney(paid)}</strong> / {fmtMoney(data.net_salary)}</span>
          {paid > 0 && <span className="ml-auto">⚠ Payment আছে — সাবধানে edit করুন</span>}
        </div>

        {/* Payheads */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wide">Pay Heads</h3>
            <select value="" onChange={e => { if (e.target.value) { addItem(e.target.value); e.target.value = ''; } }}
              className={`${inp} text-xs`}>
              <option value="">+ Add Payhead</option>
              {availablePh.map(a => (
                <option key={a.payhead} value={a.payhead}>
                  {a.payhead_name} ({a.payhead_type}) — {fmtMoney(a.unit_amount)}
                </option>
              ))}
            </select>
          </div>

          {items.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm bg-gray-50 rounded-lg border border-dashed border-gray-200">
              কোনো PayHead নেই — উপরের dropdown থেকে যোগ করুন
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Pay Head</th>
                    <th className="px-3 py-2 text-center font-semibold w-16">Type</th>
                    <th className="px-3 py-2 text-center font-semibold w-24">Mode</th>
                    <th className="px-3 py-2 text-right font-semibold w-24">Unit/%</th>
                    <th className="px-3 py-2 text-right font-semibold w-24">Final</th>
                    <th className="px-3 py-2 text-center font-semibold w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((it) => {
                    const u = Number(it.unit_amount) || 0;
                    const final = it.amount_type === 'percentage' ? basicN * u / 100 : u;
                    return (
                      <tr key={it.entry_id} className={it.is_advance ? 'bg-amber-50/40' : ''}>
                        <td className="px-3 py-1.5 text-gray-800 font-medium">
                          {it.payhead_name}
                          {it.is_advance && <span className="ml-1 text-[9px] font-bold px-1 py-0.5 rounded bg-amber-200 text-amber-800">AUTO</span>}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            it.payhead_type === 'addition' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'
                          }`}>{it.payhead_type === 'addition' ? '+' : '−'}</span>
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          {it.is_advance ? (
                            <span className="text-[10px] text-gray-400">Amount</span>
                          ) : (
                            <select value={it.amount_type} onChange={e => updateAmountType(it, e.target.value)}
                              className={`${inp} text-[11px] w-full`}>
                              <option value="amount">Amount</option>
                              <option value="percentage" disabled title="Basic salary ট্র্যাক করা হয় না, তাই এটি সবসময় 0 হবে">% (অকার্যকর)</option>
                              <option value="per_hour">Hour</option>
                            </select>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {it.is_advance ? (
                            <span className="text-gray-500 font-mono">{fmtMoney(u)}</span>
                          ) : (
                            <input type="number" min="0" step="0.01" value={it.unit_amount}
                              onChange={e => setItems(prev => prev.map(x => x.entry_id === it.entry_id ? { ...x, unit_amount: e.target.value } : x))}
                              onBlur={e => updateUnit(it, e.target.value)}
                              className={`${inp} text-right w-20`} />
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right font-semibold text-gray-800">{fmtMoney(final)}</td>
                        <td className="px-3 py-1.5 text-center">
                          {it.is_advance ? (
                            <span className="text-gray-300" title="Auto advance recovery — Advance modal থেকে নিয়ন্ত্রিত">🔒</span>
                          ) : (
                            <button onClick={() => removeItem(it)} className="text-rose-500 hover:text-rose-700 text-base">×</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 shrink-0">
          <div className="flex items-center justify-between text-xs mb-3 flex-wrap gap-2">
            <span className="text-gray-600">Additions: <strong className="ml-1 text-emerald-600">{fmtMoney(data.total_addition)}</strong></span>
            <span className="text-gray-600">Deductions: <strong className="ml-1 text-rose-600">−{fmtMoney(data.total_deduction)}</strong></span>
            <span className="text-gray-700 font-bold">Net Salary: <strong className="ml-1 text-teal-700 text-sm">{fmtMoney(data.net_salary)} tk</strong></span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onClose}
              className="px-5 py-2 text-sm font-semibold bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
              Close
            </button>
            {advRemaining > 0 && (
              <button onClick={applyAdvance} disabled={applying}
                title="এই employee-এর outstanding advance এই payslip থেকে recover করুন"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50">
                {applying && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Apply Advance ({fmtMoney(advRemaining)})
              </button>
            )}
            <button onClick={onClose}
              className="ml-auto inline-flex items-center gap-2 px-6 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              ✓ Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PAY SLIP MODAL — নতুন payslip Generate (create-only)
   - Local-state-এ payheads সাজিয়ে "Generate Payslip" বাটনে তৈরি হয়
   - Generate করলে backend নিজে থেকে outstanding advance recover করে নেয়
   - তৈরির পর modal বন্ধ; edit করতে row-এর Edit বাটন (EditPayslipModal)
═══════════════════════════════════════════════════════════════════════════ */
function PaySlipModal({ emp, month: initialMonth, advanceBalance, onClose, onGenerated }) {
  const [month,      setMonth]      = useState(initialMonth);
  const [items,      setItems]      = useState([]);
  const [assignable, setAssignable] = useState([]);  // assigned payhead list (amount সহ) — "+ Add Payhead" source
  const [loading,    setLoading]    = useState(true);
  const [busy,       setBusy]       = useState(false);

  /* ── Assigned payhead list load — "+ Add Payhead"-এর source ── */
  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setItems([]);
    api.get(`/hr/payroll/assignable-payheads/?employee=${emp.id}`).then(r => {
      if (!cancel) { setAssignable(r.data || []); setLoading(false); }
    }).catch(() => { if (!cancel) { setAssignable([]); setLoading(false); } });
    return () => { cancel = true; };
  }, [emp.id]);

  /* ── "+ Add Payhead" — assigned list থেকে amount সহ যোগ হয়, নতুন entry লাগে না ── */
  const addItem = (phId) => {
    const ph = assignable.find(p => Number(p.payhead) === Number(phId));
    if (!ph) return;
    if (items.some(it => Number(it.payhead) === Number(ph.payhead))) { toast.error(`${ph.payhead_name} ইতিমধ্যে যোগ আছে`); return; }
    setItems(prev => [...prev, {
      payhead: ph.payhead, payhead_name: ph.payhead_name, payhead_type: ph.payhead_type,
      amount_type: ph.amount_type, unit_amount: String(ph.unit_amount),
    }]);
    toast.success(`${ph.payhead_name} যোগ হয়েছে (${fmtMoney(ph.unit_amount)})`);
  };

  const removeItem = (i) => setItems(prev => prev.filter((_, idx) => idx !== i));

  /* ── Generate — basic_salary নেই; সব amount payhead থেকে, advance auto recover ── */
  const submitGenerate = async () => {
    if (!month) { toast.error('Month আবশ্যক'); return; }
    if (items.length === 0) { toast.error('অন্তত একটি Pay Head যোগ করুন'); return; }
    setBusy(true);
    try {
      await api.post('/hr/payroll/generate/', {
        employee: emp.id, month,
        basic_salary: 0,
        payheads: items.map(it => ({
          payhead: it.payhead,
          amount_type: it.amount_type,
          unit_amount: Number(it.unit_amount) || 0,
        })),
      });
      toast.success('✅ Payslip তৈরি হয়েছে');
      onGenerated();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Generate ব্যর্থ');
    } finally { setBusy(false); }
  };

  /* ── Live net preview (basic নেই — শুধু payhead-এর যোগফল) ── */
  const computed = useMemo(() => {
    let add = 0, ded = 0;
    items.forEach(it => {
      const u = Number(it.unit_amount) || 0;
      const f = it.amount_type === 'percentage' ? 0 : u;  // basic না থাকায় percentage base নেই
      if (it.payhead_type === 'addition') add += f; else ded += f;
    });
    return { add, ded, net: add - ded };
  }, [items]);

  const inp = 'border border-gray-300 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500';
  const availablePh = assignable.filter(a => !items.some(it => Number(it.payhead) === Number(a.payhead)));

  /* ── Render ── */
  const advRemaining = Number(advanceBalance || 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 text-white flex items-center justify-between shrink-0 bg-gradient-to-r from-emerald-600 to-teal-600">
          <div>
            <h2 className="text-base font-bold">Pay Slip</h2>
            <p className="text-[11px] opacity-90 mt-0.5">Generate · {emp.full_name} · {emp.employee_id}</p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-2xl leading-none">×</button>
        </div>

        {/* Month — Basic Salary আলাদা নেই, payhead list থেকে আসে */}
        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50/40 shrink-0">
          <label className="block text-[11px] font-semibold text-gray-600 mb-1">Month <span className="text-rose-500">*</span></label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            className={`${inp} w-full max-w-xs text-sm py-1.5`} />
        </div>

        {/* Outstanding advance note — generate করলে auto recover */}
        {advRemaining > 0 && (
          <div className="px-6 py-2 text-xs flex items-center gap-2 border-b border-gray-100 bg-amber-50 text-amber-700">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Outstanding advance <strong className="font-mono">{fmtMoney(advRemaining)} tk</strong> — Generate করলে এই payslip থেকে auto recover হবে।
          </div>
        )}

        {/* Payheads table */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wide">Pay Heads</h3>
            <select value="" onChange={e => { if (e.target.value) { addItem(e.target.value); e.target.value = ''; }}}
              className={`${inp} text-xs`}>
              <option value="">+ Add Payhead</option>
              {availablePh.map(a => (
                <option key={a.payhead} value={a.payhead}>
                  {a.payhead_name} ({a.payhead_type}) — {fmtMoney(a.unit_amount)}
                </option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="text-center py-8 text-gray-400 text-sm">লোড হচ্ছে…</div>
          ) : items.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm bg-gray-50 rounded-lg border border-dashed border-gray-200">
              {assignable.length === 0
                ? 'এই employee-এর Payroll-এ কোনো PayHead assign করা নেই — Payroll config থেকে assign করুন'
                : '"+ Add Payhead" থেকে select করুন — amount সহ যোগ হবে'}
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Pay Head</th>
                    <th className="px-3 py-2 text-center font-semibold w-16">Type</th>
                    <th className="px-3 py-2 text-center font-semibold w-24">Mode</th>
                    <th className="px-3 py-2 text-right font-semibold w-24">Unit/%</th>
                    <th className="px-3 py-2 text-right font-semibold w-24">Final</th>
                    <th className="px-3 py-2 text-center font-semibold w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((it, i) => {
                    const u = Number(it.unit_amount) || 0;
                    const final = it.amount_type === 'percentage' ? 0 : u;
                    return (
                      <tr key={`${it.payhead}-${i}`}>
                        <td className="px-3 py-1.5 text-gray-800 font-medium">{it.payhead_name}</td>
                        <td className="px-3 py-1.5 text-center">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            it.payhead_type === 'addition' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'
                          }`}>
                            {it.payhead_type === 'addition' ? '+' : '−'}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <select value={it.amount_type}
                            onChange={e => setItems(prev => prev.map((x, idx) => idx === i ? { ...x, amount_type: e.target.value } : x))}
                            className={`${inp} text-[11px] w-full`}>
                            <option value="amount">Amount</option>
                            <option value="percentage" disabled title="Basic salary ট্র্যাক করা হয় না, তাই এটি সবসময় 0 হবে">% (অকার্যকর)</option>
                            <option value="per_hour">Hour</option>
                          </select>
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <input type="number" min="0" step="0.01" value={it.unit_amount}
                            onChange={e => setItems(prev => prev.map((x, idx) => idx === i ? { ...x, unit_amount: e.target.value } : x))}
                            className={`${inp} text-right w-20`} />
                        </td>
                        <td className="px-3 py-1.5 text-right font-semibold text-gray-800">{fmtMoney(final)}</td>
                        <td className="px-3 py-1.5 text-center">
                          <button onClick={() => removeItem(i)}
                            className="text-rose-500 hover:text-rose-700 text-base">×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer: live totals + Generate */}
        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 shrink-0">
          <div className="flex items-center justify-between text-xs mb-3 flex-wrap gap-2">
            <span className="text-gray-600">Additions:
              <strong className="ml-1 text-emerald-600">{fmtMoney(computed.add)}</strong></span>
            <span className="text-gray-600">Deductions:
              <strong className="ml-1 text-rose-600">−{fmtMoney(computed.ded)}</strong></span>
            <span className="text-gray-700 font-bold">Net Salary:
              <strong className="ml-1 text-teal-700 text-sm">{fmtMoney(computed.net)} tk</strong></span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onClose}
              className="px-5 py-2 text-sm font-semibold bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            <button onClick={submitGenerate} disabled={busy || loading}
              className="ml-auto inline-flex items-center gap-2 px-6 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
              {busy && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              + Generate Payslip
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   EMPLOYEE CARD — modern compact card
═══════════════════════════════════════════════════════════════════════════ */
function EmployeeCard({ emp, payslips, currentMonth: cm, advanceBalance,
                       onPaySlip, onAdvance, onPay, onView, onEdit, onCancel }) {
  const empPayslips = useMemo(() =>
    payslips.filter(p => p.employee === emp.id).sort((a, b) => b.month.localeCompare(a.month)),
    [payslips, emp.id]);

  const totalGen  = empPayslips.reduce((s, p) => s + Number(p.net_salary || 0), 0);
  const totalPaid = empPayslips.reduce((s, p) => s + Number(p.paid_amount || 0), 0);
  const totalDue  = Math.max(totalGen - totalPaid, 0);

  // চলতি genMonth-এ payslip exists কি না — সেটা button-এর label/state ঠিক করে
  const monthExists = empPayslips.some(p => p.month === cm);
  const advRemaining = Number(advanceBalance || 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 hover:border-teal-200 hover:shadow-md transition-all overflow-hidden">
      {/* Top strip */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-slate-50 to-white">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-full overflow-hidden bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
          {emp.photo
            ? <img src={emp.photo} alt={emp.full_name} className="w-full h-full object-cover" />
            : (emp.full_name?.charAt(0) || '?').toUpperCase()}
        </div>

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">{emp.full_name}</p>
          <div className="flex items-center gap-3 text-[11px] text-gray-500 mt-0.5">
            <span>{emp.employee_id}</span>
            {emp.designation && <span>· {emp.designation}</span>}
            {emp.payroll_name
              ? <span className="px-1.5 py-0.5 rounded text-[10px] bg-teal-50 text-teal-700 font-medium">{emp.payroll_name}</span>
              : <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-700 font-medium">No payroll</span>}
          </div>
        </div>

        {/* Aggregate stats */}
        <div className="hidden md:flex items-center gap-4 text-xs shrink-0">
          <div className="text-right">
            <p className="text-[10px] text-gray-400 uppercase font-semibold">Total</p>
            <p className="font-bold text-gray-800">{fmtMoney(totalGen)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-emerald-500 uppercase font-semibold">Paid</p>
            <p className="font-bold text-emerald-600">{fmtMoney(totalPaid)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-rose-500 uppercase font-semibold">Due</p>
            <p className="font-bold text-rose-600">{fmtMoney(totalDue)}</p>
          </div>
          {advRemaining > 0 && (
            <div className="text-right">
              <p className="text-[10px] text-amber-600 uppercase font-semibold">Advance</p>
              <p className="font-bold text-amber-600">{fmtMoney(advRemaining)}</p>
            </div>
          )}
        </div>

        {/* Advance + Pay Slip buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => onAdvance(emp)}
            title="Take/view advance for this employee"
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition border ${
              advRemaining > 0
                ? 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100'
                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-amber-400 hover:text-amber-700'
            }`}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Advance
            {advRemaining > 0 && <span className="ml-0.5 text-[10px] bg-amber-500 text-white px-1 py-0.5 rounded">{fmtMoney(advRemaining)}</span>}
          </button>
          <button onClick={() => onPaySlip(emp)}
            title={monthExists ? 'Edit existing payslip for selected month' : 'Open modal to create payslip'}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition ${
              monthExists
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
            }`}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Pay Slip
            {monthExists && <span className="ml-0.5 text-[10px] opacity-80">✓</span>}
          </button>
        </div>
      </div>

      {/* Payslip list */}
      <div>
        {empPayslips.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-gray-400 italic">
            এখনো কোনো payslip তৈরি হয়নি — উপরের <strong>Pay Slip</strong> বাটনে ক্লিক করুন।
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {empPayslips.map(ps => {
              const net  = Number(ps.net_salary || 0);
              const paid = Number(ps.paid_amount || 0);
              const due  = Math.max(net - paid, 0);
              return (
                <div key={ps.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-gray-50/60 transition">
                  {/* Period bullet */}
                  <div className="flex items-center gap-2 min-w-[140px]">
                    <span className={`w-2 h-2 rounded-full ${
                      ps.payment_status === 'paid'    ? 'bg-emerald-500' :
                      ps.payment_status === 'partial' ? 'bg-amber-500'  : 'bg-rose-500'
                    }`} />
                    <p className="text-xs font-bold text-gray-800">{periodLabel(ps.month)}</p>
                  </div>

                  {/* Status */}
                  <StatusBadge status={ps.payment_status} />

                  {/* Amounts */}
                  <div className="text-xs text-gray-600 flex items-center gap-2">
                    <span className="font-semibold">{fmtMoney(paid)}</span>
                    <span className="text-gray-400">/</span>
                    <span className="text-gray-700 font-medium">{fmtMoney(net)}</span>
                    {ps.last_payment_method && <MethodChip method={ps.last_payment_method} />}
                  </div>

                  {/* Last payment date */}
                  {ps.last_payment_date && (
                    <span className="text-[10px] text-gray-400 hidden sm:inline">
                      last: {fmtDate(ps.last_payment_date)}
                    </span>
                  )}

                  {/* Actions */}
                  <div className="ml-auto flex items-center gap-1.5">
                    <button onClick={() => onView(ps)}
                      className="px-2.5 py-1 text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md transition">
                      View Details
                    </button>
                    {/* Edit — আলাদা EditPayslipModal খোলে (live-save) */}
                    <button onClick={() => onEdit(ps)}
                      className="px-2.5 py-1 text-[11px] font-semibold bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-md transition">
                      Edit
                    </button>
                    {due > 0 && (
                      <button onClick={() => onPay(ps)}
                        className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-md transition">
                        Pay {fmtMoney(due)}
                      </button>
                    )}
                    {ps.payment_count === 0 && (
                      <button onClick={() => onCancel(ps)}
                        title="Cancel (only if no payments)"
                        className="px-2 py-1 text-[11px] font-semibold border border-rose-200 text-rose-500 hover:bg-rose-50 rounded-md transition">
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════════════════════════════════════ */
export default function PayslipPage() {
  const [employees, setEmployees] = useState([]);
  const [payslips,  setPayslips]  = useState([]);
  const [users,     setUsers]     = useState([]);
  const [loading,   setLoading]   = useState(true);

  const [empType,   setEmpType]   = useState('active');
  const [search,    setSearch]    = useState('');
  const [genMonth,  setGenMonth]  = useState(currentMonth());

  const [paySlipEmp,   setPaySlipEmp]   = useState(null);  // create Pay Slip modal target
  const [editTarget,   setEditTarget]   = useState(null);  // {id, employee} — separate edit modal
  const [advanceEmp,   setAdvanceEmp]   = useState(null);
  const [advBalances,  setAdvBalances]  = useState({});    // { employee_id: remaining }
  const [payTarget,    setPayTarget]    = useState(null);
  const [detailId,     setDetailId]     = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);

  /* ── Initial load ── */
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const statusQ = empType === 'all' ? '' : empType === 'left' ? 'resigned' : 'active';
      const [empRes, usrRes] = await Promise.all([
        api.get(`/hr/employees/?${statusQ ? 'status=' + statusQ + '&' : ''}page_size=500`),
        api.get('/auth/users/?page_size=500'),
      ]);
      const emps = empRes.data?.results ?? empRes.data ?? [];
      setEmployees(emps);
      setUsers(usrRes.data?.results ?? usrRes.data ?? []);

      // load payslips per employee in parallel
      const sheets = [];
      await Promise.all(emps.map(async (e) => {
        try {
          const r = await api.get(`/hr/payroll/by-employee/?employee=${e.id}`);
          sheets.push(...(r.data || []));
        } catch { /* ignore single failure */ }
      }));
      setPayslips(sheets);
    } catch { toast.error('ডেটা লোড ব্যর্থ'); }
    finally { setLoading(false); }
  }, [empType]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const refreshPayslips = useCallback(async () => {
    const sheets = [];
    await Promise.all(employees.map(async (e) => {
      try {
        const r = await api.get(`/hr/payroll/by-employee/?employee=${e.id}`);
        sheets.push(...(r.data || []));
      } catch { /* ignore */ }
    }));
    setPayslips(sheets);
    // Advance balance-ও refresh — payslip generate করলে recovery হয়ে balance বদলায়
    try {
      const r = await api.get('/hr/advances/balance/');
      setAdvBalances(r.data || {});
    } catch { /* ignore */ }
  }, [employees]);

  /* ── Advance balance initial load ── */
  useEffect(() => {
    if (!employees.length) return;
    api.get('/hr/advances/balance/')
      .then(r => setAdvBalances(r.data || {}))
      .catch(() => setAdvBalances({}));
  }, [employees]);

  /* ── Filter ── */
  const filteredEmps = useMemo(() => {
    if (!search.trim()) return employees;
    const q = search.toLowerCase();
    return employees.filter(e =>
      e.full_name?.toLowerCase().includes(q) ||
      e.employee_id?.toLowerCase().includes(q) ||
      e.phone?.includes(q));
  }, [employees, search]);

  /* ── Stats ── */
  const summary = useMemo(() => {
    let gen = 0, paid = 0;
    payslips.forEach(p => {
      gen  += Number(p.net_salary  || 0);
      paid += Number(p.paid_amount || 0);
    });
    return { gen, paid, due: Math.max(gen - paid, 0),
             count: payslips.length,
             unpaidCount: payslips.filter(p => p.payment_status !== 'paid').length };
  }, [payslips]);

  /* ── Top "Pay Slip" বাটন ── genMonth-এ payslip থাকলে Edit modal,
     না থাকলে Generate (create) modal খোলে ── */
  const handleOpenPaySlip = (emp) => {
    const existing = payslips.find(p => p.employee === emp.id && p.month === genMonth);
    if (existing) setEditTarget({ id: existing.id, employee: emp.id });
    else setPaySlipEmp(emp);
  };

  /* ── Cancel ── */
  const handleCancel = async () => {
    if (!cancelTarget) return;
    try {
      await api.delete(`/hr/payroll/${cancelTarget.id}/cancel/`);
      toast.success('Payslip বাতিল হয়েছে');
      setCancelTarget(null);
      await refreshPayslips();
    } catch (err) {
      toast.error(err.response?.data?.error || 'বাতিল ব্যর্থ');
    }
  };

  /* ─── RENDER ──────────────────────────────────────────────────────────── */
  return (
    <div className="p-4 sm:p-6 min-h-screen bg-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="font-slab text-2xl font-bold text-gray-900 flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white text-base shadow-sm">💼</span>
          Payslip Manager
        </h1>
        <div className="text-xs text-gray-400 flex items-center gap-1">
          <span className="text-teal-600 font-medium">HR &amp; Payroll</span>
          <span>›</span><span>Payslip</span>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="rounded-xl bg-white border border-gray-200 p-4 shadow-sm">
          <p className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Total Payslips</p>
          <p className="text-2xl font-bold font-slab text-gray-900 mt-1">{summary.count}</p>
        </div>
        <div className="rounded-xl bg-white border border-gray-200 p-4 shadow-sm">
          <p className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Total Generated</p>
          <p className="text-2xl font-bold font-slab text-gray-900 mt-1">{fmtMoney(summary.gen)}</p>
        </div>
        <div className="rounded-xl bg-white border border-emerald-100 p-4 shadow-sm">
          <p className="text-[10px] uppercase font-bold text-emerald-600 tracking-wider">Total Paid</p>
          <p className="text-2xl font-bold font-slab text-emerald-600 mt-1">{fmtMoney(summary.paid)}</p>
        </div>
        <div className="rounded-xl bg-white border border-rose-100 p-4 shadow-sm">
          <p className="text-[10px] uppercase font-bold text-rose-600 tracking-wider">Outstanding Due</p>
          <p className="text-2xl font-bold font-slab text-rose-600 mt-1">{fmtMoney(summary.due)}</p>
          <p className="text-[10px] text-rose-500 mt-0.5">{summary.unpaidCount} payslip(s)</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          {/* Month picker */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-600 mb-1">Generation Month</label>
            <input type="month" value={genMonth} onChange={e => setGenMonth(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <p className="text-[10px] text-gray-400 mt-1">প্রতি row-এর Generate বাটন এই মাসের payslip তৈরি করবে</p>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-end gap-3 ml-auto">
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">Employee Type</label>
              <select value={empType} onChange={e => setEmpType(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                <option value="active">Active</option>
                <option value="left">Resigned</option>
                <option value="all">All</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">Search</label>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Name, ID, phone…"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
          </div>
        </div>
      </div>

      {/* Employee list */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
          <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-500 mt-3">লোড হচ্ছে…</p>
        </div>
      ) : filteredEmps.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-16 text-center text-sm text-gray-400">
          {search ? 'কোনো কর্মচারী পাওয়া যায়নি' : 'কোনো কর্মচারী নেই'}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredEmps.map(emp => (
            <EmployeeCard
              key={emp.id}
              emp={emp}
              payslips={payslips}
              currentMonth={genMonth}
              advanceBalance={advBalances[String(emp.id)] || advBalances[emp.id] || 0}
              onPaySlip={handleOpenPaySlip}
              onAdvance={setAdvanceEmp}
              onPay={setPayTarget}
              onView={(ps) => setDetailId(ps.id)}
              onEdit={(ps) => setEditTarget({ id: ps.id, employee: ps.employee })}
              onCancel={setCancelTarget}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {paySlipEmp && (
        <PaySlipModal emp={paySlipEmp} month={genMonth}
          advanceBalance={advBalances[String(paySlipEmp.id)] || advBalances[paySlipEmp.id] || 0}
          onClose={() => setPaySlipEmp(null)}
          onGenerated={refreshPayslips} />
      )}

      {editTarget && (
        <EditPayslipModal payslipId={editTarget.id} employee={editTarget.employee}
          advanceBalance={advBalances[String(editTarget.employee)] || advBalances[editTarget.employee] || 0}
          onClose={() => setEditTarget(null)}
          onChanged={refreshPayslips} />
      )}

      {advanceEmp && (
        <AdvanceModal emp={advanceEmp} users={users}
          onClose={() => setAdvanceEmp(null)}
          onChanged={refreshPayslips} />
      )}

      {payTarget && (
        <PaymentModal payslip={payTarget} users={users}
          onClose={() => setPayTarget(null)}
          onPaid={async () => { setPayTarget(null); await refreshPayslips(); }} />
      )}

      {detailId && (
        <PayslipDetailModal payslipId={detailId} users={users}
          onClose={() => setDetailId(null)}
          onChanged={refreshPayslips} />
      )}

      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <p className="text-sm font-bold text-gray-800 mb-1">
              <span className="text-rose-600">{periodLabel(cancelTarget.month)}</span> payslip বাতিল করবেন?
            </p>
            <p className="text-xs text-gray-500 mb-5">Net: {fmtMoney(cancelTarget.net_salary)} tk</p>
            <div className="flex gap-3">
              <button onClick={() => setCancelTarget(null)}
                className="flex-1 py-2 text-sm font-medium border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">না</button>
              <button onClick={handleCancel}
                className="flex-1 py-2 text-sm font-semibold bg-rose-600 text-white rounded-lg hover:bg-rose-700">
                হ্যাঁ, বাতিল
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
