// HR & Payroll — Pay Rolls পেইজ (স্ক্রিনশট অনুযায়ী)
import { useEffect, useState, useCallback, useMemo } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition';

// ── Constants ─────────────────────────────────────────────────
const PAYMENT_TYPES = [
  { value: '',           label: 'Select Payment Type' },
  { value: 'other',     label: 'Other' },
  { value: 'cash',      label: 'Cash' },
  { value: 'bkash',     label: 'bKash' },
  { value: 'bank',      label: 'Bank' },
  { value: 'rocket',    label: 'Rocket' },
  { value: 'sslcommerz',label: 'SSL Commerz' },
  { value: 'foster',    label: 'Foster Payments' },
  { value: 'walletmix', label: 'Walletmix' },
  { value: 'surecash',  label: 'SureCash' },
  { value: 'nagad',     label: 'Nagad' },
  { value: 'mcash',     label: 'MCash' },
  { value: 'ucash',     label: 'UCash' },
  { value: 'aamarpay',  label: 'aamarPay' },
  { value: 'phonepe',   label: 'PhonePe' },
  { value: 'razorpay',  label: 'Razorpay' },
  { value: 'stripe',    label: 'Stripe' },
];

const PAYROLL_TYPES = [
  { value: 'monthly',  label: 'Monthly' },
  { value: 'weekly',   label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-Weekly' },
  { value: 'daily',    label: 'Daily' },
];

const AMOUNT_TYPES = [
  { value: '',          label: 'Select Option' },
  { value: 'amount',    label: 'Amount' },
  { value: 'percentage',label: 'Percentage' },
  { value: 'per_hour',  label: 'Per Hour' },
];

// ── Date helpers ──────────────────────────────────────────────
const fmtISO = (d) => {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

// Monthly periods auto-generate করে
const genMonthlyPeriods = (year) => {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months.map((mon, i) => {
    const start  = new Date(year, i, 1);
    const end    = new Date(year, i + 1, 0);
    const issue  = new Date(year, i + 1, 1);
    return {
      period_name: `${mon}-${String(year).slice(2)}`,
      start_date:  fmtISO(start),
      end_date:    fmtISO(end),
      issue_date:  fmtISO(issue),
    };
  });
};

// ══════════════════════════════════════════════════════════════
// Add Payroll Modal
// ══════════════════════════════════════════════════════════════
function AddPayrollModal({ onSave, onClose, saving }) {
  const [form, setForm] = useState({ name: '', payment_type: '' });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
          <h2 className="text-base font-bold font-slab text-white">Add Payroll</h2>
          <button onClick={onClose}
            className="text-white/80 hover:text-white text-2xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="px-5 pt-4 pb-3 space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              Payroll Name <span className="text-red-500">*</span>
            </label>
            <input className={inp} value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Payment Type</label>
            <select className={inp + ' bg-white'} value={form.payment_type}
              onChange={e => setForm(f => ({ ...f, payment_type: e.target.value }))}>
              {PAYMENT_TYPES.map(pt => (
                <option key={pt.value} value={pt.value}>{pt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-center gap-3 px-5 pb-5">
          <button onClick={() => onSave(form)} disabled={saving}
            className="px-8 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60">
            {saving ? 'সেভ হচ্ছে...' : 'Add'}
          </button>
          <button onClick={onClose}
            className="px-8 py-2 rounded-lg text-sm font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Edit Payroll Modal
// ══════════════════════════════════════════════════════════════
function EditPayrollModal({ payroll, onSave, onClose, saving }) {
  const [form, setForm] = useState({
    name:         payroll.name         || '',
    payroll_type: payroll.payroll_type || 'monthly',
    payment_type: payroll.payment_type || '',
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
          <h2 className="text-base font-bold font-slab text-white">Edit Payroll</h2>
          <button onClick={onClose}
            className="text-white/80 hover:text-white text-2xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="px-5 pt-4 pb-3 space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              Payroll Name <span className="text-red-500">*</span>
            </label>
            <input className={inp} value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Payroll Type</label>
            <select className={inp + ' bg-white'} value={form.payroll_type}
              onChange={e => setForm(f => ({ ...f, payroll_type: e.target.value }))}>
              {PAYROLL_TYPES.map(pt => (
                <option key={pt.value} value={pt.value}>{pt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Payment Type</label>
            <select className={inp + ' bg-white'} value={form.payment_type}
              onChange={e => setForm(f => ({ ...f, payment_type: e.target.value }))}>
              {PAYMENT_TYPES.map(pt => (
                <option key={pt.value} value={pt.value}>{pt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-center gap-3 px-5 pb-5">
          <button onClick={() => onSave(form)} disabled={saving}
            className="px-8 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60">
            {saving ? 'আপডেট হচ্ছে...' : 'Update'}
          </button>
          <button onClick={onClose}
            className="px-8 py-2 rounded-lg text-sm font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Assign Period Modal
// ══════════════════════════════════════════════════════════════
function AssignPeriodModal({ payroll, onClose }) {
  const curYear = new Date().getFullYear();
  const [ptype,   setPtype]   = useState('monthly');
  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);

  // Load existing periods on open
  useEffect(() => {
    setLoading(true);
    api.get(`/hr/payrolls/${payroll.id}/periods/`)
      .then(res => {
        const data = res.data?.results ?? res.data ?? [];
        if (data.length > 0) {
          // payroll_type থেকে type set করো
          const matchType = PAYROLL_TYPES.find(t => t.value === payroll.payroll_type);
          if (matchType) setPtype(matchType.value);
          setPeriods(data.map(p => ({
            period_name: p.period_name,
            start_date:  p.start_date,
            end_date:    p.end_date,
            issue_date:  p.issue_date,
          })));
        } else {
          setPeriods(genMonthlyPeriods(curYear));
        }
      })
      .catch(() => setPeriods(genMonthlyPeriods(curYear)))
      .finally(() => setLoading(false));
  }, [payroll.id, payroll.payroll_type, curYear]);

  // Type পরিবর্তনে নতুন periods generate করো
  const handleTypeChange = (t) => {
    setPtype(t);
    if (t === 'monthly') setPeriods(genMonthlyPeriods(curYear));
  };

  const updatePeriod = (idx, field, val) =>
    setPeriods(prev => prev.map((p, i) => i === idx ? { ...p, [field]: val } : p));

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.post(`/hr/payrolls/${payroll.id}/periods/`, {
        periods,
        payroll_type: ptype,
      });
      toast.success('Periods আপডেট হয়েছে।');
      onClose();
    } catch {
      toast.error('Periods সেভ ব্যর্থ।');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white flex-shrink-0">
          <h2 className="text-base font-bold font-slab text-white">Assign Periods for Pay slip Structure</h2>
          <button onClick={onClose}
            className="text-white/80 hover:text-white text-2xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="px-5 pt-4 flex-1 overflow-hidden flex flex-col">
          {/* Type dropdown */}
          <div className="mb-4 w-64">
            <label className="block text-xs font-bold text-gray-700 mb-1">
              Type : <span className="text-red-500">*</span>
            </label>
            <select className={inp + ' bg-white'} value={ptype}
              onChange={e => handleTypeChange(e.target.value)}>
              {PAYROLL_TYPES.map(pt => (
                <option key={pt.value} value={pt.value}>{pt.label}</option>
              ))}
            </select>
          </div>

          {/* Bill Periods scrollable grid */}
          {loading ? (
            <div className="text-center py-6 text-gray-400">Loading...</div>
          ) : periods.length > 0 && (
            <div className="border border-gray-200 rounded flex-1 overflow-hidden flex flex-col">
              <div className="bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700 border-b border-gray-200 flex-shrink-0">
                Bill Periods
              </div>
              <div className="overflow-y-auto flex-1">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0 z-10">
                    <tr>
                      <th className="px-2 py-2 text-left text-gray-600 font-semibold border-b border-gray-200">Period Name</th>
                      <th className="px-2 py-2 text-left text-gray-600 font-semibold border-b border-gray-200">Start Date</th>
                      <th className="px-2 py-2 text-left text-gray-600 font-semibold border-b border-gray-200">End Date</th>
                      <th className="px-2 py-2 text-left text-gray-600 font-semibold border-b border-gray-200">Issue Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periods.map((p, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-1 py-1">
                          <input className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                            value={p.period_name}
                            onChange={e => updatePeriod(i, 'period_name', e.target.value)} />
                        </td>
                        <td className="px-1 py-1">
                          <input type="date" className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                            value={p.start_date}
                            onChange={e => updatePeriod(i, 'start_date', e.target.value)} />
                        </td>
                        <td className="px-1 py-1">
                          <input type="date" className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                            value={p.end_date}
                            onChange={e => updatePeriod(i, 'end_date', e.target.value)} />
                        </td>
                        <td className="px-1 py-1">
                          <input type="date" className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                            value={p.issue_date}
                            onChange={e => updatePeriod(i, 'issue_date', e.target.value)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end px-5 py-4 flex-shrink-0">
          <button onClick={handleSave} disabled={saving}
            className="px-6 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60">
            {saving ? 'সেভ হচ্ছে...' : 'Update Periods'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Assign PayHead Modal
// ══════════════════════════════════════════════════════════════
function AssignPayHeadModal({ payroll, onClose }) {
  const [allPayheads, setAllPayheads] = useState([]);
  const [assigned,    setAssigned]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [form, setForm] = useState({ payhead: '', amount_type: '', unit_amount: '' });

  // Inline edit state
  const [editingId, setEditingId] = useState(null);
  const [editVal,   setEditVal]   = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [phRes, asnRes] = await Promise.all([
        api.get('/hr/payheads/?ordering=id'),
        api.get(`/hr/payrolls/${payroll.id}/payheads/`),
      ]);
      setAllPayheads(phRes.data?.results ?? phRes.data ?? []);
      setAssigned(asnRes.data?.results ?? asnRes.data ?? []);
    } catch {
      toast.error('ডেটা লোড ব্যর্থ।');
    } finally {
      setLoading(false);
    }
  }, [payroll.id]);

  useEffect(() => { loadData(); }, [loadData]);

  // PayHead assign করো
  const handleAssign = async () => {
    if (!form.payhead)      { toast.error('PayHead সিলেক্ট করুন।'); return; }
    if (!form.amount_type)  { toast.error('Type সিলেক্ট করুন।'); return; }
    setSaving(true);
    try {
      await api.post(`/hr/payrolls/${payroll.id}/payheads/`, {
        payhead:     form.payhead,
        amount_type: form.amount_type,
        unit_amount: form.unit_amount || 0,
      });
      toast.success('PayHead assign হয়েছে।');
      setForm({ payhead: '', amount_type: '', unit_amount: '' });
      loadData();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Assign ব্যর্থ।');
    } finally {
      setSaving(false);
    }
  };

  // Inline edit save
  const saveInlineEdit = async (asnId) => {
    try {
      await api.patch(`/hr/payrolls/${payroll.id}/payheads/${asnId}/update/`, {
        unit_amount: editVal,
      });
      setEditingId(null);
      loadData();
    } catch {
      toast.error('Update ব্যর্থ।');
    }
  };

  // Remove assigned payhead
  const handleRemove = async (asnId) => {
    try {
      await api.delete(`/hr/payrolls/${payroll.id}/payheads/${asnId}/remove/`);
      toast.success('Remove হয়েছে।');
      loadData();
    } catch {
      toast.error('Remove ব্যর্থ।');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white flex-shrink-0">
          <h2 className="text-base font-bold font-slab text-white">Assign a PayHead</h2>
          <button onClick={onClose}
            className="text-white/80 hover:text-white text-2xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="px-5 pt-4 flex-1 overflow-hidden flex flex-col">

          {/* Top assign form */}
          <div className="flex items-end gap-2 mb-2 flex-wrap">
            {/* PayHead */}
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs font-bold text-gray-700 mb-1">
                PayHead: <span className="text-red-500">*</span>
              </label>
              <select className={inp + ' bg-white'} value={form.payhead}
                onChange={e => setForm(f => ({ ...f, payhead: e.target.value }))}>
                <option value="">Select PayHead</option>
                {allPayheads.map(ph => (
                  <option key={ph.id} value={ph.id}>{ph.name}</option>
                ))}
              </select>
            </div>
            {/* Type */}
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Type : <span className="text-red-500">*</span>
              </label>
              <select className={inp + ' bg-white'} value={form.amount_type}
                onChange={e => setForm(f => ({ ...f, amount_type: e.target.value }))}>
                {AMOUNT_TYPES.map(at => (
                  <option key={at.value} value={at.value}
                    disabled={at.value === 'percentage'}
                    title={at.value === 'percentage' ? 'Basic salary ট্র্যাক করা হয় না, তাই এটি সবসময় 0 হবে' : undefined}>
                    {at.value === 'percentage' ? `${at.label} (অকার্যকর)` : at.label}
                  </option>
                ))}
              </select>
            </div>
            {/* Amount/Unit */}
            <div className="flex-1 min-w-[120px]">
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Amount/Unit : <span className="text-red-500">*</span>
              </label>
              <input type="number" className={inp} value={form.unit_amount}
                onChange={e => setForm(f => ({ ...f, unit_amount: e.target.value }))} />
            </div>
            {/* Assign button */}
            <button onClick={handleAssign} disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white whitespace-nowrap disabled:opacity-60 mb-0.5">
              {saving ? '...' : 'Assign PayHead'}
            </button>
          </div>

          {/* Info notes */}
          <div className="text-xs text-gray-500 mb-3 space-y-0.5">
            <p>ℹ You can update any Unit/Amount by simply click on its value.</p>
            <p>ℹ Provide Late Fee, Early out fee &amp; Overtime fee amount as per hour.</p>
          </div>

          {/* Assigned PayHead List */}
          <div className="border border-gray-200 rounded flex-1 overflow-hidden flex flex-col">
            <div style={{ backgroundColor: '#23445f' }} className="text-white px-3 py-2 text-sm font-semibold font-slab flex-shrink-0">
              Assigned PayHead List
            </div>
            <div className="overflow-y-auto flex-1">
              {loading ? (
                <div className="text-center py-6 text-gray-400 text-sm">Loading...</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left   text-gray-600 text-xs font-semibold">PayHead Name</th>
                      <th className="px-3 py-2 text-center text-gray-600 text-xs font-semibold">Unit/Amount</th>
                      <th className="px-3 py-2 text-center text-gray-600 text-xs font-semibold">PayHead Type</th>
                      <th className="px-3 py-2 text-center text-gray-600 text-xs font-semibold">Type</th>
                      <th className="px-3 py-2 text-center text-gray-600 text-xs font-semibold">Final Amount</th>
                      <th className="px-3 py-2 text-center text-gray-600 text-xs font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assigned.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-6 text-gray-400 text-xs">
                          No PayHead assigned yet.
                        </td>
                      </tr>
                    ) : assigned.map(asn => (
                      <tr key={asn.id} className="border-t border-gray-100 hover:bg-gray-50">
                        {/* Name */}
                        <td className="px-3 py-2 text-gray-700">{asn.payhead_name}</td>

                        {/* Unit/Amount — click to edit inline */}
                        <td className="px-3 py-2 text-center">
                          {editingId === asn.id ? (
                            <input
                              className="w-20 border border-teal-400 rounded-lg px-2 py-0.5 text-center text-sm focus:ring-2 focus:ring-teal-400 focus:outline-none"
                              type="number"
                              value={editVal}
                              onChange={e => setEditVal(e.target.value)}
                              onBlur={() => saveInlineEdit(asn.id)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') saveInlineEdit(asn.id);
                                if (e.key === 'Escape') setEditingId(null);
                              }}
                              autoFocus
                            />
                          ) : (
                            <span
                              onClick={() => { setEditingId(asn.id); setEditVal(String(asn.unit_amount)); }}
                              className="cursor-pointer font-mono hover:text-teal-600 hover:underline"
                              title="Click to edit"
                            >
                              {Number(asn.unit_amount)}
                            </span>
                          )}
                        </td>

                        {/* PayHead Type — Addition green, Deduction red */}
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            asn.payhead_type === 'addition' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                          }`}>
                            {asn.payhead_type_display || (asn.payhead_type === 'addition' ? 'Addition' : 'Deduction')}
                          </span>
                        </td>

                        {/* Amount Type */}
                        <td className="px-3 py-2 text-center text-gray-600">
                          {AMOUNT_TYPES.find(a => a.value === asn.amount_type)?.label || 'Amount'}
                        </td>

                        {/* Final Amount */}
                        <td className="px-3 py-2 text-center text-gray-600">
                          {Number(asn.unit_amount)}
                        </td>

                        {/* Delete */}
                        <td className="px-3 py-2 text-center">
                          <button onClick={() => handleRemove(asn.id)} title="Remove"
                            className="w-6 h-6 flex items-center justify-center rounded bg-red-100 hover:bg-red-200 text-red-600 mx-auto transition-colors">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Footer spacer */}
        <div className="h-4 flex-shrink-0" />
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Main PayrollPage
// ══════════════════════════════════════════════════════════════
export default function PayrollPage() {
  const [payrolls,  setPayrolls]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [modal,     setModal]     = useState(null);  // 'add' | 'period' | 'payhead'
  const [selected,  setSelected]  = useState(null);  // payroll for period/payhead modals
  const [saving,    setSaving]    = useState(false);

  // Table controls
  const [search,   setSearch]   = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [page,     setPage]     = useState(1);

  // ── Load ──────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/hr/payrolls/?ordering=id');
      setPayrolls(res.data?.results ?? res.data ?? []);
    } catch {
      toast.error('Pay Rolls লোড ব্যর্থ।');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Filter + Paginate ──────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return q
      ? payrolls.filter(p =>
          p.name.toLowerCase().includes(q) ||
          (p.payroll_type_display || '').toLowerCase().includes(q)
        )
      : payrolls;
  }, [payrolls, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  // ── Add payroll ────────────────────────────────────────────
  const handleAdd = async (form) => {
    if (!form.name.trim()) { toast.error('Payroll নাম দিন।'); return; }
    setSaving(true);
    try {
      await api.post('/hr/payrolls/', {
        name:         form.name.trim(),
        payment_type: form.payment_type,
      });
      toast.success('নতুন Payroll তৈরি হয়েছে।');
      setModal(null);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.name?.[0] || 'তৈরি ব্যর্থ।');
    } finally {
      setSaving(false);
    }
  };

  // ── Edit payroll ───────────────────────────────────────────
  const handleEdit = async (form) => {
    if (!form.name.trim()) { toast.error('Payroll নাম দিন।'); return; }
    setSaving(true);
    try {
      await api.patch(`/hr/payrolls/${selected.id}/`, {
        name:         form.name.trim(),
        payroll_type: form.payroll_type,
        payment_type: form.payment_type,
      });
      toast.success('Payroll আপডেট হয়েছে।');
      setModal(null);
      setSelected(null);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.name?.[0] || 'আপডেট ব্যর্থ।');
    } finally {
      setSaving(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 min-h-screen bg-gray-100">

      {/* Page header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="font-slab text-2xl font-bold text-gray-900 flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-sm">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m-6 4h6m-6 4h4M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
            </svg>
          </span>
          Pay Rolls
        </h1>
        <div className="flex items-center gap-3">
          <div className="text-xs text-gray-400 hidden sm:flex items-center gap-1">
            <span className="text-teal-600 font-medium">HR &amp; Payroll</span>
            <span>›</span><span>Payroll</span>
          </div>
          <button
            onClick={() => setModal('add')}
            className="inline-flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New PayRoll
          </button>
        </div>
      </div>

      {/* Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">

        {/* Table controls */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-wrap gap-2">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>Show</span>
            <select value={pageSize}
              onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="border border-gray-300 rounded px-2 py-1 text-sm">
              {[10, 25, 50, 100].map(n => <option key={n}>{n}</option>)}
            </select>
            <span>entries</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>Search:</span>
            <input type="text" value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-44 focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr style={{ backgroundColor: '#23445f' }} className="text-white text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-center font-semibold w-24">Serial No.</th>
                <th className="px-4 py-3 text-center font-semibold">PayRoll Name</th>
                <th className="px-4 py-3 text-center font-semibold">Payroll Type</th>
                <th className="px-4 py-3 text-center font-semibold">Payment Type</th>
                <th className="px-4 py-3 text-center font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="text-center py-10 text-gray-400">Loading...</td></tr>
              ) : paged.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-10 text-gray-400">No payroll found.</td></tr>
              ) : paged.map((pr, idx) => {
                const serial = (page - 1) * pageSize + idx + 1;
                const isEven = serial % 2 === 0;
                return (
                  <tr key={pr.id} className={`${isEven ? 'bg-gray-50/60' : 'bg-white'} hover:bg-teal-50/40 transition-colors`}>
                    <td className="px-4 py-3 text-center text-gray-700 font-mono text-xs">{serial}</td>
                    <td className="px-4 py-3 text-center font-medium text-gray-800">{pr.name}</td>
                    <td className="px-4 py-3 text-center text-gray-700">
                      {pr.payroll_type_display || '—'}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">
                      {pr.payment_type_display && pr.payment_type ? pr.payment_type_display : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2 flex-wrap">
                        {/* Assign Period */}
                        <button
                          onClick={() => { setSelected(pr); setModal('period'); }}
                          style={{ backgroundColor: '#23445f' }} className="px-3 py-1 rounded-lg text-xs font-semibold hover:opacity-90 text-white transition-opacity"
                        >
                          Assign Period
                        </button>
                        {/* Assign PayHead */}
                        <button
                          onClick={() => { setSelected(pr); setModal('payhead'); }}
                          style={{ backgroundColor: '#23445f' }} className="px-3 py-1 rounded-lg text-xs font-semibold hover:opacity-90 text-white transition-opacity"
                        >
                          Assign PayHead
                        </button>
                        {/* Edit */}
                        <button
                          title="Edit"
                          onClick={() => { setSelected(pr); setModal('edit'); }}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-600 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 flex-wrap gap-2">
          <span className="text-xs text-gray-500">
            {filtered.length === 0
              ? 'No entries'
              : `Showing ${(page - 1) * pageSize + 1} to ${Math.min(page * pageSize, filtered.length)} of ${filtered.length} entries`
            }
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1 rounded border border-gray-300 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
              Previous
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button key={p} onClick={() => setPage(p)}
                className={`px-3 py-1 rounded-lg border text-xs font-medium transition-colors ${
                  p === page
                    ? 'bg-teal-600 border-teal-600 text-white'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}>
                {p}
              </button>
            ))}
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-3 py-1 rounded border border-gray-300 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
              Next
            </button>
          </div>
        </div>
      </div>

      {/* ── Modals ── */}
      {modal === 'add' && (
        <AddPayrollModal
          onSave={handleAdd}
          onClose={() => setModal(null)}
          saving={saving}
        />
      )}
      {modal === 'edit' && selected && (
        <EditPayrollModal
          payroll={selected}
          onSave={handleEdit}
          onClose={() => { setModal(null); setSelected(null); }}
          saving={saving}
        />
      )}
      {modal === 'period' && selected && (
        <AssignPeriodModal
          payroll={selected}
          onClose={() => { setModal(null); setSelected(null); load(); }}
        />
      )}
      {modal === 'payhead' && selected && (
        <AssignPayHeadModal
          payroll={selected}
          onClose={() => { setModal(null); setSelected(null); }}
        />
      )}
    </div>
  );
}
