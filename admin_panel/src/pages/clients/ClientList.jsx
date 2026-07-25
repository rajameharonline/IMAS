import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../utils/api';
import toast from 'react-hot-toast';

/* ── Dark pill action button ── */
function ActionBtn({ icon, label, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 px-3 py-[7px] rounded-full text-[11px]
        font-medium border border-[#24364d] text-white bg-[#1d3a50]
        hover:bg-[#23445f] disabled:opacity-50 transition-colors whitespace-nowrap"
    >
      {icon && <span className="text-[13px] leading-none">{icon}</span>}
      {label}
    </button>
  );
}

/* ── Colored summary card ── */
function SummCard({ icon, label, value, sub, from, to }) {
  return (
    <div className={`rounded-xl text-white flex items-center gap-4 px-5 py-4 bg-gradient-to-br ${from} ${to} shadow-sm`}>
      <div className="text-4xl opacity-75 shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-sm font-semibold truncate">{label}</p>
        <p className="text-2xl font-bold leading-tight">{value ?? 0}</p>
        <p className="text-[10px] opacity-75 truncate mt-0.5">{sub}</p>
      </div>
    </div>
  );
}

/* ── M.Status toggle switch ── */
function MStatusToggle({ isActive, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        isActive ? 'bg-blue-500' : 'bg-gray-300'
      }`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
        isActive ? 'translate-x-[18px]' : 'translate-x-[3px]'
      }`} />
    </button>
  );
}

const PAYMENT_METHODS = [
  { value: 'cash',       label: 'Cash' },
  { value: 'bkash',      label: 'bKash' },
  { value: 'nagad',      label: 'Nagad' },
  { value: 'rocket',     label: 'Rocket' },
  { value: 'bank',       label: 'Bank Transfer' },
  { value: 'sslcommerz', label: 'SSLCommerz' },
  { value: 'other',      label: 'Other' },
];

const normalizeUsername = (value) => String(value || '').trim().toLowerCase();

function PayModal({ client, onClose, onSuccess }) {
  const [bill, setBill]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying]   = useState(false);
  const [form, setForm] = useState({
    amount: '', payment_method: 'cash', transaction_id: '', notes: '',
  });

  useEffect(() => {
    // fetch the latest unpaid/partial bill for this client
    api.get(`/billing/bills/?client=${client.id}&status=unpaid&page=1`)
      .then(r => {
        const bills = r.data.results || r.data;
        if (bills.length > 0) {
          const b = bills[0];
          setBill(b);
          setForm(f => ({ ...f, amount: String(Number(b.due_amount)) }));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [client.id]);

  const fmt = (v) => '৳' + Number(v || 0).toLocaleString();

  const handlePay = async () => {
    if (!bill) { toast.error('No unpaid bill found for this client.'); return; }
    if (!form.amount || Number(form.amount) <= 0) { toast.error('Please enter an amount.'); return; }
    setPaying(true);
    try {
      await api.post('/billing/payments/', { bill: bill.id, ...form });
      toast.success('Payment recorded successfully.');
      onSuccess();
      onClose();
    } catch (err) {
      const d = err.response?.data;
      if (d && typeof d === 'object') Object.values(d).forEach(m => toast.error(Array.isArray(m) ? m[0] : m));
      else toast.error('Payment failed.');
    } finally { setPaying(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-0 md:p-4">
    <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">Receive Payment</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-5">
          {loading ? (
            <div className="text-center py-8 text-gray-400 text-sm">Loading bill...</div>
          ) : !bill ? (
            <div className="text-center py-8 text-gray-400 text-sm">No unpaid bill found for this client.</div>
          ) : (
            <>
              {/* Bill summary */}
              <div className="bg-slate-50 rounded-xl p-4 mb-4 space-y-1 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 shrink-0">Client</span>
                  <span className="font-medium truncate">{client.full_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Month</span>
                  <span className="font-medium">{bill.bill_month}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Net Bill</span>
                  <span className="font-medium">{fmt(bill.net_amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Paid</span>
                  <span className="text-green-600 font-medium">{fmt(bill.paid_amount)}</span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-1 mt-1">
                  <span className="text-slate-700 font-semibold">Due</span>
                  <span className="text-red-600 font-bold">{fmt(bill.due_amount)}</span>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="label">Amount (৳) <span className="text-red-500">*</span></label>
                  <input className="input" type="number" min="1" step="0.01"
                    value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" />
                </div>
                <div>
                  <label className="label">Payment Method <span className="text-red-500">*</span></label>
                  <select className="input" value={form.payment_method} onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}>
                    {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Transaction ID <span className="text-gray-400 text-xs font-normal">(optional)</span></label>
                  <input className="input" value={form.transaction_id} onChange={e => setForm(f => ({ ...f, transaction_id: e.target.value }))} placeholder="TXN-XXXXXXXX" />
                </div>
                <div>
                  <label className="label">Notes <span className="text-gray-400 text-xs font-normal">(optional)</span></label>
                  <textarea className="input" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any notes..." />
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-5">
                <button onClick={onClose} className="btn-secondary">Cancel</button>
                <button onClick={handlePay} disabled={paying} className="btn-primary disabled:opacity-50">
                  {paying ? 'Saving...' : '✓ Confirm Payment'}
                </button>
              </div>
            </>
          )}
          {!loading && !bill && (
            <div className="flex justify-end mt-4">
              <button onClick={onClose} className="btn-secondary">Close</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const MONTH_OPTIONS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
].map((label, i) => ({
  label,
  value: `${new Date().getFullYear()}-${String(i + 1).padStart(2, '0')}`,
}));

function GenBillModal({ client, onClose, onSuccess }) {
  const [genMonth, setGenMonth]   = useState(new Date().toISOString().slice(0, 7));
  const [amount, setAmount]       = useState(String(Number(client.monthly_bill || 0) || ''));
  const [notes, setNotes]         = useState('');
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    if (!genMonth) { toast.error('Please select a month.'); return; }
    setGenerating(true);
    try {
      const payload = { client_id: client.id, bill_month: genMonth, notes };
      if (amount && Number(amount) > 0) payload.amount = amount;
      const res = await api.post('/billing/bills/generate-for-client/', payload);
      const action = res.data.action === 'updated' ? 'updated' : 'created';
      toast.success(`Bill ${action} for ${client.full_name} (${genMonth}).`);
      onSuccess();
      onClose();
    } catch (err) {
      const d = err.response?.data;
      toast.error(d?.error || 'Failed to generate bill.');
    } finally { setGenerating(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-0 md:p-4">
    <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-2 px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900 truncate min-w-0">Generate Bill — {client.full_name}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none shrink-0">×</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="label">Bill Month <span className="text-red-500">*</span></label>
            <select className="input" value={genMonth} onChange={e => setGenMonth(e.target.value)}>
              {MONTH_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Amount (৳)</label>
            <input className="input" type="number" min="1" step="0.01"
              value={amount} onChange={e => setAmount(e.target.value)} />
          </div>

          <div>
            <label className="label">Notes <span className="text-gray-400 text-xs font-normal">(optional)</span></label>
            <textarea className="input" rows={2} placeholder="Any notes about this bill..."
              value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={handleGenerate} disabled={generating} className="btn-primary disabled:opacity-50">
              {generating ? 'Generating...' : '⚡ Generate Bill'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MacCell({ clientId, mac: initialMac }) {
  const [mac, setMac] = useState(initialMac || '');
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await api.post(`/clients/${clientId}/sync-mac/`);
      setMac(res.data.mac_address || '');
      toast.success('MAC address সংগ্রহ হয়েছে।');
    } catch {
      toast.error('Client অনলাইনে নেই বা MAC পাওয়া যায়নি।');
    } finally {
      setSyncing(false);
    }
  };

  const SyncBtn = (
    <button
      onClick={handleSync}
      disabled={syncing}
      title="Sync MAC from Mikrotik"
      className={`flex items-center justify-center w-6 h-6 rounded-full border transition-colors ${
        syncing
          ? 'border-blue-300 text-blue-400 cursor-not-allowed'
          : 'border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50'
      }`}
    >
      <svg
        className={`w-3 h-3 ${syncing ? 'animate-spin text-blue-400' : ''}`}
        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    </button>
  );

  if (!mac) {
    return <div className="flex justify-center">{SyncBtn}</div>;
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="font-mono text-xs text-gray-600">{mac}</span>
      {SyncBtn}
    </div>
  );
}

function PasswordCell({ password }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-xs text-gray-600">
        {show ? password : '••••••••'}
      </span>
      <button
        onClick={() => setShow(v => !v)}
        className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
        tabIndex={-1}
      >
        {show ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        )}
      </button>
    </div>
  );
}

function ActionTooltipBtn({ onClick, tooltip, color, children }) {
  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={`flex items-center justify-center w-9 h-9 rounded-xl border transition-all duration-150 hover:scale-105 ${color}`}
      >
        {children}
      </button>
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold text-white bg-gray-800 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-[60]">
        {tooltip}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
      </span>
    </div>
  );
}

function ActionsMenu({ client, onEdit, onToggle, onGenerateBill, onView, onKick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const isActive = ['active', 'expired'].includes(client.status);

  return (
    <div className="flex justify-center">
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex flex-col items-center justify-center gap-[4px] w-7 h-7 rounded hover:bg-gray-100 transition-colors group"
        >
          <span className="w-[4px] h-[4px] rounded-full bg-gray-500 group-hover:bg-gray-700" />
          <span className="w-[4px] h-[4px] rounded-full bg-gray-500 group-hover:bg-gray-700" />
          <span className="w-[4px] h-[4px] rounded-full bg-gray-500 group-hover:bg-gray-700" />
        </button>

        {open && (
          <div className="absolute right-full top-1/2 -translate-y-1/2 mr-1 z-50
            flex items-center gap-1 bg-white rounded-xl shadow-xl border border-gray-100 px-1.5 py-1.5">

            {/* Generate Bill */}
            <ActionTooltipBtn
              onClick={() => { setOpen(false); onGenerateBill(); }}
              tooltip="Generate Bill"
              color="bg-orange-50 text-orange-500 border-orange-100 hover:bg-orange-100 hover:border-orange-300"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </ActionTooltipBtn>

            {/* Scheduler (placeholder) */}
            <ActionTooltipBtn tooltip="Scheduler" color="bg-purple-50 text-purple-600 border-purple-100 hover:bg-purple-100 hover:border-purple-300">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </ActionTooltipBtn>

            {/* Bill History (placeholder) */}
            <ActionTooltipBtn tooltip="Bill History" color="bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100 hover:border-gray-300">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </ActionTooltipBtn>

            {/* SMS (placeholder) */}
            <ActionTooltipBtn tooltip="Send SMS" color="bg-green-50 text-green-600 border-green-100 hover:bg-green-100 hover:border-green-300">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </ActionTooltipBtn>

            {/* Edit */}
            <ActionTooltipBtn
              onClick={() => { setOpen(false); onEdit(); }}
              tooltip="Edit"
              color="bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-100 hover:border-blue-300"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </ActionTooltipBtn>

            {/* View profile */}
            <ActionTooltipBtn
              onClick={() => { setOpen(false); onView && onView(); }}
              tooltip="Profile"
              color="bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100 hover:border-indigo-300"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </ActionTooltipBtn>

            {/* Kick Session — CoA/PoD পাঠিয়ে current PPPoE session বাতিল করে।
                Status পরিবর্তন হয় না, user পরবর্তী মুহূর্তে auto-reconnect-এ
                নতুন IP/policy পায়। Troubleshooting ও speed/IP renew-এর জন্য। */}
            <ActionTooltipBtn
              onClick={() => { setOpen(false); onKick && onKick(); }}
              tooltip="Kick Session"
              color="bg-red-50 text-red-600 border-red-100 hover:bg-red-100 hover:border-red-300"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </ActionTooltipBtn>

            <span className="absolute left-full top-1/2 -translate-y-1/2 border-[5px] border-transparent border-l-white drop-shadow-sm" />
          </div>
        )}
      </div>
    </div>
  );
}

function PaymentStatusCell({ dueAmount, onPay }) {
  const [due, setDue] = useState(Number(dueAmount) || 0);

  useEffect(() => {
    setDue(Number(dueAmount) || 0);
  }, [dueAmount]);

  if (due > 0) {
    return (
      <div className="flex items-center justify-center gap-1.5">
        <button
          onClick={onPay}
          className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm"
        >
          Pay
        </button>
        <span className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-red-50 text-red-600 border border-red-200 cursor-default select-none">
          Due ৳{due.toLocaleString()}
        </span>
      </div>
    );
  }

  return (
    <div className="flex justify-center">
      <span className="px-3 py-1 text-xs font-semibold rounded-lg bg-green-50 text-green-700 border border-green-200 cursor-default select-none">
        Paid
      </span>
    </div>
  );
}

const statusStyles = {
  active:    'bg-green-50 text-green-700 border-green-200',
  expired:   'bg-red-50 text-red-600 border-red-200',
  suspended: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  inactive:  'bg-gray-100 text-gray-500 border-gray-200',
  cancelled: 'bg-gray-100 text-gray-400 border-gray-200',
  left:      'bg-purple-50 text-purple-700 border-purple-200',
};

const statusLabels = {
  active: 'Active', expired: 'Expired',
  suspended: 'Suspended', inactive: 'Inactive',
  cancelled: 'Cancelled', left: 'Left',
};

function StatusBadge({ status }) {
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full border ${statusStyles[status] || statusStyles.inactive}`}>
      {statusLabels[status] || status}
    </span>
  );
}

/* ── Mobile Client Card — মোবাইলে প্রতিটি client একটি কার্ড হিসেবে দেখায় ── */
function MobileClientCard({
  client, idx, isOnline, isActive, isSyncingOnline,
  onOnlineSync, onToggle, onEdit, onGenerateBill, onView, onKick,
}) {
  const bStatusCls =
    client.status === 'active'    ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
    client.status === 'suspended' ? 'bg-amber-100 text-amber-700 border-amber-200' :
    client.status === 'expired'   ? 'bg-rose-100 text-rose-600 border-rose-200' :
                                    'bg-slate-100 text-slate-500 border-slate-200';
  const bStatusLabel =
    client.status === 'active'    ? 'Active'   :
    client.status === 'suspended' ? 'Inactive' :
    client.status === 'expired'   ? 'Expired'  : 'Inactive';
  const isEven = idx % 2 === 0;

  /* একটি label-value row — label বাম (gray bg), value ডান (white bg), border দিয়ে আলাদা */
  const Row = ({ label, children }) => (
    <div className="flex items-stretch border-b border-gray-200 last:border-0">
      <div className="w-24 shrink-0 bg-gray-50 px-3 py-2.5 flex items-center border-r border-gray-200">
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex-1 min-w-0 px-3 py-2.5 flex items-center justify-end bg-white">
        <span className="text-[12px] text-gray-800 font-medium text-right truncate">{children}</span>
      </div>
    </div>
  );

  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${isEven ? 'bg-white border-gray-100' : 'bg-slate-50/40 border-gray-100'}`}>

      {/* ── Header: checkbox + ↺ + ● + ID + Name + M.Status + Status + Actions ── */}
      <div className="flex items-center gap-1.5 px-3 py-2.5 bg-[#23445f]/5 border-b border-gray-100">
        <input type="checkbox" className="w-3.5 h-3.5 rounded accent-blue-500 shrink-0 cursor-pointer" />
        <button onClick={() => onOnlineSync(client.id)} disabled={isSyncingOnline}
          className={`shrink-0 ${isSyncingOnline ? 'text-blue-400 cursor-wait' : 'text-blue-400 hover:text-blue-600'}`}>
          <svg className={`w-3.5 h-3.5 ${isSyncingOnline ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 transition-colors ${
          isSyncingOnline ? 'bg-blue-400 animate-pulse ring-2 ring-blue-100'
          : isOnline      ? 'bg-green-500 ring-2 ring-green-100'
          :                 'bg-gray-300 ring-2 ring-gray-100'
        }`} />
        {/* ID + Name */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="font-mono text-[11px] font-bold text-[#23445f] shrink-0">
              {client.customer_id || client.id}
              {client.is_app_user && (
                <span title="অ্যাপে রেজিস্টার্ড" className="text-emerald-600 font-black text-[15px] ml-0.5 relative -top-[2px] leading-none">®</span>
              )}
            </span>
            <span className="text-[13px] font-bold text-gray-900 truncate">{client.full_name}</span>
          </div>
        </div>
        {/* M.Status + Status badge + Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <MStatusToggle isActive={isActive} onToggle={onToggle} />
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${bStatusCls}`}>{bStatusLabel}</span>
          <ActionsMenu
            client={client}
            onEdit={onEdit} onToggle={onToggle}
            onGenerateBill={onGenerateBill} onView={onView} onKick={onKick}
          />
        </div>
      </div>

      {/* ── Detail Rows — প্রতিটি field আলাদা row ── */}
      <div>
        <Row label="UserName">
          <span className="font-mono font-semibold text-gray-700">{client.username || '—'}</span>
        </Row>
        <Row label="Password">
          <PasswordCell password={client.password || ''} />
        </Row>
        <Row label="Mobile">
          {client.phone || '—'}
        </Row>
        <Row label="Zone">
          <span className="truncate">
            {client.zone_name || '—'}
            {client.subzone_name ? <span className="text-gray-400 font-normal"> · {client.subzone_name}</span> : ''}
          </span>
        </Row>
        <Row label="Package">
          {client.package_name || '—'}
        </Row>
        <Row label="Conn.">
          {client.protocol_name || '—'}
        </Row>
        <Row label="M.Bill">
          <span className="font-semibold text-gray-900">৳ {Number(client.monthly_bill || 0).toLocaleString()}</span>
        </Row>
        <Row label="Server">
          <span className="truncate">{client.router_name || '—'}</span>
        </Row>
        <Row label="Type">
          {client.client_type_name || '—'}
        </Row>
      </div>
    </div>
  );
}

export default function ClientList() {
  const [clients, setClients]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [page, setPage]             = useState(1);
  const [searchParams, setSearchParams] = useSearchParams();
  // URL-এর ?status= param থেকে filter নেওয়া হচ্ছে — Dashboard card click করলে auto-filter হবে
  const statusF = searchParams.get('status') || '';
  // ?new=1 → চলতি মাসের নতুন ক্লায়েন্ট
  const isNewFilter    = searchParams.get('new')    === '1';
  // ?online=1 → Mikrotik-এ এখন online আছে এমন ক্লায়েন্ট
  const isOnlineFilter  = searchParams.get('online')  === '1';
  // ?renewed=1 → Left list থেকে ফিরে আসা ক্লায়েন্ট
  const isRenewedFilter = searchParams.get('renewed') === '1';
  const [perPage, setPerPage]       = useState(20);
  const [count, setCount]           = useState(0);
  const [onlineSet, setOnlineSet]   = useState(new Set());
  const [payClient, setPayClient]   = useState(null);
  const [genClient, setGenClient]   = useState(null);
  const [summary, setSummary]       = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [syncingList, setSyncingList] = useState(false);
  const [syncingOnlineId, setSyncingOnlineId] = useState(null);
  const navigate = useNavigate();

  // ── Filter dropdown state + option lists (backend /clients/ filterset-এ যায়) ──
  const [fServer, setFServer]         = useState('');
  const [fProtocol, setFProtocol]     = useState('');
  const [fZone, setFZone]             = useState('');
  const [fSubzone, setFSubzone]       = useState('');
  const [fBox, setFBox]               = useState('');
  const [fPackage, setFPackage]       = useState('');
  const [fClientType, setFClientType] = useState('');
  const [fMStatus, setFMStatus]       = useState('');   // '' | 'online' | 'offline'
  const [fFromDate, setFFromDate]     = useState('');
  const [fToDate, setFToDate]         = useState('');
  const [opts, setOpts] = useState({ zones: [], subzones: [], boxes: [], packages: [], protocols: [], clientTypes: [], servers: [] });

  useEffect(() => {
    const L = (d) => d.data?.results || d.data || [];
    Promise.all([
      api.get('/config/zones/').catch(() => ({ data: [] })),
      api.get('/config/subzones/').catch(() => ({ data: [] })),
      api.get('/config/boxes/').catch(() => ({ data: [] })),
      api.get('/config/packages/').catch(() => ({ data: [] })),
      api.get('/config/protocol-types/').catch(() => ({ data: [] })),
      api.get('/config/client-types/').catch(() => ({ data: [] })),
      api.get('/mikrotik/servers/').catch(() => ({ data: [] })),
    ]).then(([z, sz, b, pk, pr, ct, sv]) => {
      setOpts({ zones: L(z), subzones: L(sz), boxes: L(b), packages: L(pk), protocols: L(pr), clientTypes: L(ct), servers: L(sv) });
    });
  }, []);

  // cascading option lists — selected parent অনুযায়ী
  const subzoneOpts = opts.subzones.filter(s => !fZone || String(s.zone ?? s.zone_id) === String(fZone));
  const boxOpts     = opts.boxes.filter(b => !fSubzone || String(b.subzone ?? b.subzone_id) === String(fSubzone));

  const clearFilters = () => {
    setFServer(''); setFProtocol(''); setFZone(''); setFSubzone(''); setFBox('');
    setFPackage(''); setFClientType(''); setFMStatus(''); setFFromDate(''); setFToDate('');
    const p = new URLSearchParams(searchParams); p.delete('status'); setSearchParams(p, { replace: true });
    setSearch(''); setPage(1);
  };

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, page_size: perPage });
      if (search)          params.append('search', search);
      if (statusF)         params.append('status', statusF);
      if (isNewFilter)     params.append('new', '1');
      if (isRenewedFilter) params.append('renewed', '1');
      // Filter panel dropdowns → backend filterset
      if (fServer)     params.append('router', fServer);
      if (fProtocol)   params.append('protocol', fProtocol);
      if (fZone)       params.append('zone', fZone);
      if (fSubzone)    params.append('subzone', fSubzone);
      if (fBox)        params.append('box', fBox);
      if (fPackage)    params.append('package', fPackage);
      if (fClientType) params.append('client_type', fClientType);
      if (fFromDate)   params.append('date_from', fFromDate);
      if (fToDate)     params.append('date_to', fToDate);
      // M.STATUS — URL ?online=1 (Dashboard card) থাকলে সেটা; নাহলে panel-এর M.STATUS
      if (isOnlineFilter)            params.append('online', '1');
      else if (fMStatus === 'online')  params.append('online', '1');
      else if (fMStatus === 'offline') params.append('online', '0');
      const res = await api.get(`/clients/?${params}`);
      setClients(res.data.results || res.data);
      setCount(res.data.count || 0);
    } catch {
      toast.error('Failed to load clients.');
    } finally {
      setLoading(false);
    }
  }, [page, perPage, search, statusF, isNewFilter, isOnlineFilter, isRenewedFilter,
      fServer, fProtocol, fZone, fSubzone, fBox, fPackage, fClientType, fMStatus, fFromDate, fToDate]);

  const fetchOnlineUsers = useCallback(async () => {
    try {
      const res = await api.get('/mikrotik/online-usernames/');
      const usernames = (res.data.usernames || []).map(normalizeUsername).filter(Boolean);
      setOnlineSet(new Set(usernames));
    } catch { /* silently ignore */ }
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await api.get('/clients/client-stats/');
      setSummary(res.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchClients(); }, [fetchClients]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => {
    fetchOnlineUsers();
    const timer = setInterval(fetchOnlineUsers, 10000);
    window.addEventListener('focus', fetchOnlineUsers);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', fetchOnlineUsers);
    };
  }, [fetchOnlineUsers]);

  const handleSyncList = async () => {
    setSyncingList(true);
    try {
      await Promise.all([fetchClients(), fetchOnlineUsers(), fetchSummary()]);
      toast.success('Client list and online status synced.');
    } catch {
      toast.error('Sync failed.');
    } finally {
      setSyncingList(false);
    }
  };

  const handleOnlineSync = async (clientId) => {
    setSyncingOnlineId(clientId);
    try {
      await fetchOnlineUsers();
    } finally {
      setSyncingOnlineId(null);
    }
  };

  const handleToggle = async (client) => {
    // লাইন "on" = active বা expired (mikrotik enabled — পূর্ণ বা walled-garden)।
    // off = suspended/inactive (admin manually বন্ধ — সম্পূর্ণ block)।
    //   Deactivate → disable: সম্পূর্ণ ইন্টারনেট বন্ধ (Auth-Reject)।
    //   Activate   → enable : expiry-aware (expired হলে Expired profile-এ সীমিত)।
    const isOn = ['active', 'expired'].includes(client.status);
    const actionName = isOn ? 'disable' : 'enable';
    const label = isOn ? 'Deactivate করবেন? (ইন্টারনেট সম্পূর্ণ বন্ধ হবে)'
                       : 'Activate করবেন?';
    if (!window.confirm(`${client.full_name || client.username} — ${label}`)) return;
    try {
      const { data } = await api.post(`/clients/${client.id}/${actionName}/`);
      toast.success(data?.message || (isOn ? 'Client deactivated.' : 'Client activated.'));
      fetchClients();
      fetchSummary();
    } catch {
      toast.error('Operation failed.');
    }
  };

  // CoA/PoD দিয়ে current PPPoE session বাতিল — status অপরিবর্তিত।
  // Backend route: POST /clients/<id>/kick-session/
  const handleKick = async (client) => {
    if (!window.confirm(`Kick ${client.username}-এর current session?`)) return;
    try {
      const { data } = await api.post(`/clients/${client.id}/kick-session/`);
      if (data?.success) {
        toast.success(`Session terminated for ${client.username}`);
      } else {
        toast.warning(data?.message || 'No active session to kick');
      }
      // online status refresh — kick হলে instantly offline দেখাবে
      fetchOnlineUsers();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Kick failed');
    }
  };

  return (
    <div className="space-y-3 -mt-2">

      {/* ── Page header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <div>
            <h1 className="text-lg font-bold text-gray-900 leading-none flex items-center gap-2">
              Client List
              {/* নতুন ক্লায়েন্ট filter badge — চলতি মাসের নাম দেখাবে */}
              {isOnlineFilter && (
                <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
                  Online এখন
                </span>
              )}
              {isRenewedFilter && !isOnlineFilter && (
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                  🔄 Renewed Clients
                </span>
              )}
              {isNewFilter && !isOnlineFilter && !isRenewedFilter && (
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-teal-100 text-teal-700 border border-teal-200">
                  ➕ নতুন — {new Date().toLocaleString('bn-BD', { month: 'long', year: 'numeric' })}
                </span>
              )}
              {statusF && !isNewFilter && !isOnlineFilter && !isRenewedFilter && (
                <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
                  statusF === 'active'    ? 'bg-green-100 text-green-700 border-green-200' :
                  statusF === 'inactive'  ? 'bg-gray-100 text-gray-600 border-gray-300' :
                  statusF === 'suspended' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' :
                  statusF === 'expired'   ? 'bg-red-100 text-red-600 border-red-200' :
                  'bg-blue-100 text-blue-700 border-blue-200'
                }`}>
                  {statusF === 'active' ? '🟢 Active' :
                   statusF === 'inactive' ? '⚫ Inactive' :
                   statusF === 'suspended' ? '🟡 Suspended' :
                   statusF === 'expired' ? '🔴 Expired' : statusF}
                </span>
              )}
            </h1>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {isOnlineFilter
                ? 'Mikrotik-এ এখন PPPoE Active আছে'
                : isRenewedFilter
                ? 'Left list থেকে ফিরে আসা ক্লায়েন্ট'
                : isNewFilter
                ? `${new Date().toLocaleString('en-US', { month: 'long' })} মাসে যোগ দেওয়া ক্লায়েন্ট`
                : 'View All Client'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ActionBtn icon="🔄" label={syncingList ? 'Syncing...' : 'Sync Clients & Servers'} onClick={handleSyncList} disabled={syncingList} />
          <span className="text-xs text-gray-400">Client &rsaquo; Client List</span>
          {/* <Link to="/clients/new" className="btn-primary text-xs py-1.5 px-3">+ New Client</Link> */}
        </div>
      </div>

      {/* ── Summary cards (4 wide) ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummCard icon="👥" label="Running Clients"  value={summary?.running ?? '…'}          sub="Number of clients without LeftOut status"   from="from-cyan-400"   to="to-teal-600" />
        <SummCard icon="👤" label="New Clients"      value={summary?.new_this_month ?? '…'}   sub="Monthly number of clients those are new"    from="from-teal-400"   to="to-emerald-600" />
        <SummCard icon="👥" label="Expired Clients"  value={summary?.expired ?? '…'}           sub="Monthly number of newly expired clients"    from="from-purple-400" to="to-purple-700" />
        <SummCard icon="🚫" label="Inactive Clients" value={summary?.inactive ?? '…'}          sub="Number of suspended or inactive clients"    from="from-gray-500"   to="to-gray-800" />
      </div>

      {/* ── Filters panel (সব dropdown আসল data দিয়ে কাজ করে) ── */}
      {showFilters && (() => {
        const selCls = 'w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500';
        const lblCls = 'block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1';
        const onF = (setter, reset) => (e) => { setter(e.target.value); if (reset) reset(); setPage(1); };
        return (
        <div className="bg-white rounded-xl shadow-sm px-4 py-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div>
              <label className={lblCls}>Server</label>
              <select className={selCls} value={fServer} onChange={onF(setFServer)}>
                <option value="">All</option>
                {opts.servers.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lblCls}>Protocol Type</label>
              <select className={selCls} value={fProtocol} onChange={onF(setFProtocol)}>
                <option value="">All</option>
                {opts.protocols.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lblCls}>Zone</label>
              <select className={selCls} value={fZone} onChange={onF(setFZone, () => { setFSubzone(''); setFBox(''); })}>
                <option value="">All</option>
                {opts.zones.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lblCls}>Sub Zone</label>
              <select className={selCls} value={fSubzone} onChange={onF(setFSubzone, () => setFBox(''))}>
                <option value="">All</option>
                {subzoneOpts.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lblCls}>Box</label>
              <select className={selCls} value={fBox} onChange={onF(setFBox)}>
                <option value="">All</option>
                {boxOpts.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lblCls}>Package</label>
              <select className={selCls} value={fPackage} onChange={onF(setFPackage)}>
                <option value="">All</option>
                {opts.packages.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mt-3">
            <div>
              <label className={lblCls}>Client Type</label>
              <select className={selCls} value={fClientType} onChange={onF(setFClientType)}>
                <option value="">All</option>
                {opts.clientTypes.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lblCls}>B.Status</label>
              <select className={selCls} value={statusF}
                onChange={e => {
                  const val = e.target.value;
                  const p = new URLSearchParams(searchParams);
                  if (val) p.set('status', val); else p.delete('status');
                  setSearchParams(p, { replace: true }); setPage(1);
                }}>
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="expired">Expired</option>
                <option value="suspended">Suspended</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div>
              <label className={lblCls}>M.Status</label>
              <select className={selCls} value={fMStatus} onChange={onF(setFMStatus)} disabled={isOnlineFilter}>
                <option value="">All</option>
                <option value="online">Online</option>
                <option value="offline">Offline</option>
              </select>
            </div>
            <div>
              <label className={lblCls}>From Date</label>
              <input type="date" className={selCls} value={fFromDate} onChange={onF(setFFromDate)} />
            </div>
            <div>
              <label className={lblCls}>To Date</label>
              <input type="date" className={selCls} value={fToDate} onChange={onF(setFToDate)} />
            </div>
            <div className="flex items-end">
              <button onClick={clearFilters}
                className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
                Clear Filters
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* ── Show/Hide toggle ── */}
      <div className="flex justify-center">
        <button
          onClick={() => setShowFilters(v => !v)}
          className="flex items-center gap-2 px-6 py-2 rounded-full bg-[#1c2333] text-white text-xs font-semibold hover:bg-[#2a3347] transition-colors shadow"
        >
          {showFilters ? 'Hide' : 'Show'}
          <svg className={`w-3.5 h-3.5 transition-transform ${showFilters ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* ── Table card ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

        {/* SHOW entries + SEARCH */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2 text-xs text-gray-600 font-medium">
            SHOW
            <select
              value={perPage}
              onChange={e => { setPerPage(Number(e.target.value)); setPage(1); }}
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            ENTRIES
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-600 font-medium">
            SEARCH:
            <input
              type="text"
              placeholder=""
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs w-44 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-center py-16 text-gray-400 text-sm">Loading...</div>
        ) : (
          <>
          {/* ── Mobile Card List — বন্ধ (সব স্ক্রিনে টেবিল দেখানো হয়) ── */}
          <div className="hidden space-y-2 p-3">
            {clients.length === 0
              ? <div className="text-center py-10 text-gray-400 text-sm">No clients found.</div>
              : clients.map((client, idx) => {
                  const isOnline = onlineSet.has(normalizeUsername(client.username));
                  const isActive = ['active', 'expired'].includes(client.status);
                  const isSyncingOnline = syncingOnlineId === client.id;
                  return (
                    <MobileClientCard
                      key={client.id}
                      client={client}
                      idx={idx}
                      isOnline={isOnline}
                      isActive={isActive}
                      isSyncingOnline={isSyncingOnline}
                      onOnlineSync={handleOnlineSync}
                      onToggle={() => handleToggle(client)}
                      onEdit={() => navigate(`/clients/${client.id}`)}
                      onGenerateBill={() => setGenClient(client)}
                      onView={() => navigate(`/clients/${client.id}/profile`)}
                      onKick={() => handleKick(client)}
                    />
                  );
                })
            }
          </div>
          {/* ── Table (সব স্ক্রিন; মোবাইলে অনুভূমিক স্ক্রল) ── */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-xs tabular-nums border-collapse">
              <thead>
                <tr className="bg-[#23445f] text-white text-[11px] font-semibold uppercase tracking-wider [&>th]:px-3 [&>th]:py-3 [&>th]:border-r [&>th]:border-white/10 [&>th:last-child]:border-r-0">
                  <th className="text-center w-7">
                    <input type="checkbox" className="rounded" />
                  </th>
                  <th className="text-center whitespace-nowrap">
                    Cus. ID <span className="opacity-60">⇅</span>
                  </th>
                  <th className="text-left whitespace-nowrap">
                    UserName/Password <span className="opacity-60">⇅</span>
                  </th>
                  <th className="text-left whitespace-nowrap">Name/Mobile</th>
                  <th className="text-left whitespace-nowrap">Zone <span className="opacity-60">⇅</span></th>
                  <th className="text-left whitespace-nowrap">Type/Conn</th>
                  <th className="text-left whitespace-nowrap">Package/Speed</th>
                  <th className="text-right">M.Bill</th>
                  <th className="text-center whitespace-nowrap">MAC Addrs</th>
                  <th className="text-left">Server</th>
                  <th className="text-center">B.Status</th>
                  <th className="text-center">M.Status</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client, idx) => {
                  const isOnline = onlineSet.has(normalizeUsername(client.username));
                  const isActive = ['active', 'expired'].includes(client.status);
                  const isEven   = idx % 2 === 0;
                  const rowNum   = (page - 1) * perPage + idx + 1;
                  const isSyncingOnline = syncingOnlineId === client.id;
                  return (
                    <tr key={client.id}
                      className={`border-b border-slate-200/70 hover:bg-blue-50/40 transition-colors align-middle [&>td]:border-r [&>td]:border-gray-100 [&>td:last-child]:border-r-0 ${isEven ? 'bg-white' : 'bg-slate-50/60'}`}
                    >
                      {/* Checkbox */}
                      <td className="px-3 py-2.5 text-center">
                        <input type="checkbox" className="rounded" />
                      </td>

                      {/* C.Code */}
                      <td className="px-3 py-2.5 text-center font-mono font-bold text-gray-800">
                        {client.customer_id || client.id}
                        {client.is_app_user && (
                          <span title="অ্যাপে রেজিস্টার্ড" className="text-emerald-600 font-black text-[15px] ml-0.5 relative -top-[2px] leading-none">®</span>
                        )}
                      </td>

                      {/* ID/IP */}
                      <td className="px-3 py-2.5">
                        <p className="font-mono font-semibold text-gray-800 leading-tight" title={client.ip_address || ''}>
                          {client.username || '—'}
                        </p>
                        <div className="mt-1 flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOnlineSync(client.id)}
                            disabled={isSyncingOnline}
                            title={isSyncingOnline ? 'Refreshing online status...' : 'Refresh online status'}
                            className={`inline-flex h-4 w-4 items-center justify-center transition-colors ${
                              isSyncingOnline
                                ? 'text-blue-400 cursor-wait'
                                : 'text-blue-500 hover:text-blue-600'
                            }`}
                          >
                            <svg className={`w-3 h-3 ${isSyncingOnline ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          </button>
                          <span
                            title={isSyncingOnline ? 'Checking online status...' : (isOnline ? 'Online' : 'Offline')}
                            className={`w-3 h-3 rounded-full inline-block shrink-0 transition-all duration-300 ${
                              isSyncingOnline
                                ? 'bg-blue-400 ring-4 ring-blue-100 animate-pulse'
                                : isOnline
                                  ? 'bg-green-500 ring-4 ring-green-100'
                                  : 'bg-gray-400 ring-4 ring-gray-100'
                            }`}
                          />
                        </div>
                        {/* Password — username-এর নিচে */}
                        <div className="mt-1">
                          <PasswordCell password={client.password || ''} />
                        </div>
                      </td>

                      {/* Name / Mobile — নামের নিচে মোবাইল */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          <p className="font-medium text-gray-800 leading-tight whitespace-nowrap">{client.full_name}</p>
                          <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <p className="text-[11px] text-gray-500 leading-tight">{client.phone || '—'}</p>
                      </td>

                      {/* Zone — zone-এর নিচে subzone • box */}
                      <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">
                        <p className="font-medium leading-tight">{client.zone_name || '—'}</p>
                        {(client.subzone_name || client.box_name) && (
                          <p className="text-[11px] text-gray-500 leading-tight">
                            {[client.subzone_name, client.box_name].filter(Boolean).join(' • ')}
                          </p>
                        )}
                      </td>

                      {/* Type / Conn — Type • Conn */}
                      <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                        {[client.client_type_name, client.protocol_name].filter(Boolean).join(' • ') || '—'}
                      </td>

                      {/* Package/Speed */}
                      <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{client.package_name || '—'}</td>

                      {/* M.Bill */}
                      <td className="px-3 py-2.5 text-right font-medium text-gray-800">
                        {Number(client.monthly_bill || 0).toLocaleString()}
                      </td>

                      {/* MAC Addrs */}
                      <td className="px-3 py-2.5 text-center">
                        <MacCell clientId={client.id} mac={client.mac_address} />
                      </td>

                      {/* Server */}
                      <td className="px-3 py-2.5 text-gray-600 text-[10px] max-w-[120px] truncate">
                        {client.router_name || '—'}
                      </td>

                      {/* B.Status */}
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          client.status === 'active'    ? 'bg-green-100 text-green-700 border border-green-200' :
                          client.status === 'suspended' ? 'bg-yellow-100 text-yellow-700 border border-yellow-200' :
                          client.status === 'expired'   ? 'bg-red-100 text-red-600 border border-red-200' :
                          'bg-slate-100 text-slate-500 border border-slate-200'
                        }`}>
                          {client.status === 'active' ? 'Active' :
                           client.status === 'suspended' ? 'Inactive' :
                           client.status === 'expired' ? 'Expired' : 'Inactive'}
                        </span>
                      </td>

                      {/* M.Status toggle */}
                      <td className="px-3 py-2.5 text-center">
                        <MStatusToggle
                          isActive={isActive}
                          onToggle={() => handleToggle(client)}
                        />
                      </td>

                      {/* Action */}
                      <td className="px-3 py-2.5 text-center">
                        <ActionsMenu
                          client={client}
                          onEdit={() => navigate(`/clients/${client.id}`)}
                          onToggle={() => handleToggle(client)}
                          onGenerateBill={() => setGenClient(client)}
                          onView={() => navigate(`/clients/${client.id}/profile`)}
                          onKick={() => handleKick(client)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {clients.length === 0 && (
              <div className="text-center py-16 text-gray-400 text-sm">No clients found.</div>
            )}
          </div>
          </>
        )}

        {/* Pagination */}
        <div className="flex flex-wrap justify-between items-center gap-2 px-4 py-3 border-t border-slate-100 text-xs text-slate-500">
          <span className="whitespace-nowrap">
            Showing {clients.length > 0 ? (page - 1) * perPage + 1 : 0}–{(page - 1) * perPage + clients.length} of {count} entries
          </span>
          <div className="flex flex-wrap gap-1 items-center">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors">
              ← Prev
            </button>
            {[...Array(Math.min(5, Math.ceil(count / perPage)))].map((_, i) => {
              const pg = i + 1;
              return (
                <button key={pg} onClick={() => setPage(pg)}
                  className={`w-7 h-7 rounded-lg border text-xs font-medium transition-colors ${page === pg ? 'bg-[#1d3a50] text-white border-[#1d3a50]' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                  {pg}
                </button>
              );
            })}
            <button onClick={() => setPage(p => p + 1)} disabled={clients.length < perPage}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors">
              Next →
            </button>
          </div>
        </div>
      </div>

      {/* ── Pay Modal ── */}
      {payClient && (
        <PayModal
          client={payClient}
          onClose={() => setPayClient(null)}
          onSuccess={fetchClients}
        />
      )}

      {/* ── Generate Bill Modal ── */}
      {genClient && (
        <GenBillModal
          client={genClient}
          onClose={() => setGenClient(null)}
          onSuccess={fetchClients}
        />
      )}

    </div>
  );
}
