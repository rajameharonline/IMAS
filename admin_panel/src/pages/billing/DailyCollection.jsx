import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// UTC-নয়, browser local date ব্যবহার করতে হবে (Asia/Dhaka timezone match করতে)
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const money = v => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
const userLabel = u => u ? ((u.get_full_name || u.full_name || '').trim() || u.username || u.email || `User ${u.id}`) : '';
const btn = 'inline-flex items-center gap-1.5 rounded-full bg-[#173d59] px-4 py-2 text-xs font-bold text-white shadow-md hover:bg-[#0f3048] disabled:opacity-50';
const input = 'h-[27px] w-full border border-gray-300 bg-white px-2 text-xs text-gray-800 outline-none focus:border-[#173d59]';
const label = 'mb-1.5 block text-[11px] font-bold uppercase text-[#466078]';

function StatCard({ icon, title, value, foot, tone }) {
  const tones = {
    cyan: 'from-sky-500 to-cyan-500',
    teal: 'from-teal-400 to-teal-600',
    violet: 'from-violet-500 to-indigo-500',
  };
  return (
    <div className={`overflow-hidden rounded-md bg-gradient-to-r ${tones[tone]} text-white shadow-lg`}>
      <div className="flex h-16 items-center gap-4 px-4">
        <div className="text-4xl leading-none">{icon}</div>
        <div>
          <div className="text-xs font-semibold">{title}</div>
          <div className="text-sm font-bold">{value}</div>
        </div>
      </div>
      <div className="bg-black/12 px-4 py-2 text-center text-[11px]">{foot}</div>
    </div>
  );
}


/* ── BillList-এর মতো tooltip button ── */
function ActionTooltipBtn({ onClick, tooltip, color, disabled, children }) {
  return (
    <div className="relative group">
      <button onClick={onClick} disabled={disabled}
        className={`flex items-center justify-center w-9 h-9 rounded-xl border transition-all duration-150 hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed ${color}`}>
        {children}
      </button>
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold text-white bg-gray-800 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-[60]">
        {tooltip}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
      </span>
    </div>
  );
}

/* ── Three-dot Action Menu (BillList-এর মতো design) ── */
function PaymentActionsMenu({ r, canApprove, approvingId, onApprove, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="flex justify-center">
      <div ref={ref} className="relative">
        {/* Three dots trigger */}
        <button onClick={() => setOpen(v => !v)}
          className="flex flex-col items-center justify-center gap-[4px] w-8 h-8 rounded-lg hover:bg-gray-100 transition-colors group">
          <span className="w-[5px] h-[5px] rounded-full bg-gray-400 group-hover:bg-gray-600 transition-colors" />
          <span className="w-[5px] h-[5px] rounded-full bg-gray-400 group-hover:bg-gray-600 transition-colors" />
          <span className="w-[5px] h-[5px] rounded-full bg-gray-400 group-hover:bg-gray-600 transition-colors" />
        </button>

        {/* Popup — dots-এর বামে */}
        {open && (
          <div className="absolute right-full top-1/2 -translate-y-1/2 mr-1 z-50 flex items-center gap-1 bg-white rounded-xl shadow-lg border border-gray-100 px-1.5 py-1.5">

            {/* Approve / Approved status */}
            {r.is_verified ? (
              <ActionTooltipBtn tooltip="Approved" color="bg-green-50 text-green-600 border-green-100" disabled>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </ActionTooltipBtn>
            ) : canApprove ? (
              <ActionTooltipBtn tooltip="Approve" color="bg-green-50 text-green-600 border-green-100 hover:bg-green-100 hover:border-green-300"
                disabled={approvingId === r.id}
                onClick={() => { setOpen(false); onApprove(r.id); }}>
                {approvingId === r.id
                  ? <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
              </ActionTooltipBtn>
            ) : null}

            {/* Edit — admin/superadmin only */}
            {canApprove && (
              <ActionTooltipBtn tooltip="Edit Bill Receive" color="bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-100 hover:border-blue-300"
                onClick={() => { setOpen(false); onEdit(r); }}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </ActionTooltipBtn>
            )}

            {/* Delete */}
            <ActionTooltipBtn tooltip="Delete" color="bg-red-50 text-red-500 border-red-100 hover:bg-red-100 hover:border-red-300"
              onClick={() => { setOpen(false); onDelete(r.id); }}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </ActionTooltipBtn>

            {/* Arrow → dots-এর দিকে */}
            <span className="absolute left-full top-1/2 -translate-y-1/2 border-[5px] border-transparent border-l-white drop-shadow-sm" />
          </div>
        )}
      </div>
    </div>
  );
}

function SelectClientBox({ value, onPick }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setItems([]);
      setLoading(false);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get(`/clients/?search=${encodeURIComponent(trimmed)}&page_size=20`);
        const list = res.data.results || res.data || [];
        let merged = list;
        if (/^\d+$/.test(trimmed)) {
          try {
            const byId = await api.get(`/clients/${trimmed}/`);
            if (byId.data?.id && !merged.some(c => c.id === byId.data.id)) {
              merged = [byId.data, ...merged];
            }
          } catch { /* numeric query might be username, not primary key */ }
        }
        setItems(merged);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query, open]);

  return (
    <div className="relative">
      <label className={label}>USER NAME (ID)</label>
      <button type="button" onClick={() => setOpen(v => !v)} className="flex h-7 w-full items-center justify-between border border-gray-400 bg-white px-2 text-left text-xs text-gray-700 outline-none">
        <span>{value ? `${value.username || value.customer_id}(${value.customer_id})` : ''}</span>
        <span className={`text-[10px] text-gray-500 ${open ? 'rotate-180' : ''}`}>▲</span>
      </button>
      {open && (
        <div className="mt-1 overflow-hidden border border-gray-400 bg-white">
          <input autoFocus className="h-7 w-full border-b border-gray-300 px-2 text-xs outline-none"
              value={query} onChange={e => setQuery(e.target.value)} />
          <div className="max-h-36 overflow-y-auto text-xs">
            {loading && <div className="px-2 py-1.5 text-gray-400">Searching...</div>}
            {items.map((c, idx) => (
              <button key={c.id} type="button"
                onClick={() => { onPick(c); setOpen(false); setQuery(''); }}
                className={`block w-full px-2 py-1.5 text-left ${idx === 0 ? 'bg-blue-500 text-white' : 'bg-white text-gray-800 hover:bg-blue-500 hover:text-white'}`}>
                {c.username || c.customer_id}({c.customer_id})
              </button>
            ))}
            {!loading && !query.trim() && <div className="px-2 py-1.5 text-gray-400">Type client ID to search</div>}
            {!loading && query.trim() && !items.length && <div className="px-2 py-1.5 text-gray-400">No client found</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Webhook Status Badge ── */
function WebhookStatusBadge({ status }) {
  const map = {
    'automatically_settled': 'bg-green-100 text-green-700 border border-green-200',
    'payment_requested':     'bg-yellow-100 text-yellow-700 border border-yellow-200',
    'manually_settled':      'bg-blue-100 text-blue-700 border border-blue-200',
    'payment_transferred':   'bg-purple-100 text-purple-700 border border-purple-200',
    'payment_retransferred': 'bg-orange-100 text-orange-700 border border-orange-200',
  };
  const labels = {
    'automatically_settled': 'Automatically Settled',
    'payment_requested':     'Payment Requested',
    'manually_settled':      'Manually Settled',
    'payment_transferred':   'Payment Transferred',
    'payment_retransferred': 'Payment Retransferred',
  };
  const cls = map[status] || 'bg-gray-100 text-gray-600 border border-gray-200';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {labels[status] || status || '—'}
    </span>
  );
}

/* ── Webhook Transfer Modal ── */
function WebhookTransferModal({ record, onClose, onSuccess }) {
  const [userType, setUserType]       = useState('Admin');
  const [client, setClient]           = useState(null);
  const [query, setQuery]             = useState('');
  const [clientList, setClientList]   = useState([]);
  const [searching, setSearching]     = useState(false);
  const [dropOpen, setDropOpen]       = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const dropRef = useRef(null);

  /* client search */
  useEffect(() => {
    if (!dropOpen) return;
    const q = query.trim();
    if (!q) { setClientList([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get(`/clients/?search=${encodeURIComponent(q)}&page_size=20`);
        setClientList(res.data.results || res.data || []);
      } catch { setClientList([]); }
      finally { setSearching(false); }
    }, 180);
    return () => clearTimeout(t);
  }, [query, dropOpen]);

  /* click-outside close */
  useEffect(() => {
    if (!dropOpen) return;
    const h = e => { if (dropRef.current && !dropRef.current.contains(e.target)) setDropOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [dropOpen]);

  const payable  = Number(client?.due_amount || 0);
  const received = Number(record?.amount || 0);
  const balDue   = payable - received;

  const submit = async () => {
    if (!client) return toast.error('Client সিলেক্ট করুন।');
    setSubmitting(true);
    try {
      await api.post(`/billing/webhook-payments/${record.id}/transfer/`, { client_id: client.id });
      toast.success('Webhook payment transferred successfully.');
      onSuccess();
      onClose();
    } catch (err) {
      const d = err.response?.data;
      if (d && typeof d === 'object') Object.values(d).forEach(m => toast.error(Array.isArray(m) ? m[0] : m));
      else toast.error('Transfer failed.');
    } finally { setSubmitting(false); }
  };

  const rdCls = 'flex h-8 w-full items-center overflow-hidden truncate rounded border border-gray-200 bg-[#f4f7fa] px-2.5 text-xs text-gray-700';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between bg-[#1d435d] px-5 py-3">
          <span className="font-bold text-white">Webhook Payment Transferring</span>
          <button onClick={onClose} className="text-xl text-white/70 hover:text-white">×</button>
        </div>
        {/* Body */}
        <div className="space-y-4 p-5">
          {/* USER TYPE */}
          <div>
            <label className={label}>USER TYPE</label>
            <select className={input} value={userType} onChange={e => { setUserType(e.target.value); setClient(null); setQuery(''); }}>
              <option>Admin</option>
              <option>POPs</option>
            </select>
          </div>

          {/* USER NAME (ID) — searchable */}
          <div ref={dropRef} className="relative">
            <label className={label}>USER NAME (ID)</label>
            {client ? (
              <div className="flex h-8 w-full items-center justify-between border border-gray-300 bg-white px-2.5 text-xs text-gray-700">
                <span>{client.username || client.customer_id} ({client.customer_id})</span>
                <button onClick={() => setClient(null)} className="ml-2 text-gray-400 hover:text-red-500">×</button>
              </div>
            ) : (
              <>
                <input
                  className={input}
                  placeholder="Search by name or ID..."
                  value={query}
                  onFocus={() => setDropOpen(true)}
                  onChange={e => { setQuery(e.target.value); setDropOpen(true); }}
                />
                {dropOpen && (
                  <div className="absolute z-10 mt-0.5 w-full overflow-hidden border border-gray-300 bg-white shadow-lg">
                    <div className="max-h-40 overflow-y-auto text-xs">
                      {searching && <div className="px-3 py-2 text-gray-400">Searching...</div>}
                      {!searching && !query.trim() && <div className="px-3 py-2 text-gray-400">Type to search clients...</div>}
                      {!searching && query.trim() && !clientList.length && <div className="px-3 py-2 text-gray-400">No client found</div>}
                      {clientList.map((c, i) => (
                        <button key={c.id} type="button"
                          className={`block w-full px-3 py-1.5 text-left ${i === 0 ? 'bg-blue-500 text-white' : 'hover:bg-blue-500 hover:text-white text-gray-800'}`}
                          onClick={() => { setClient(c); setDropOpen(false); setQuery(''); }}>
                          {c.username || c.customer_id} ({c.customer_id})
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Client info read-only */}
          {client && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><label className={label}>CUSTOMER NAME</label><div className={rdCls}>{client.full_name || '—'}</div></div>
              <div><label className={label}>MOBILE NUMBER</label><div className={rdCls}>{client.phone || '—'}</div></div>
              <div><label className={label}>CUSTOMER ZONE</label><div className={rdCls}>{client.zone_name || '—'}</div></div>
              <div><label className={label}>ADDRESS</label><div className={rdCls} title={client.address || ''}>{client.address || '—'}</div></div>
              <div><label className={label}>CUSTOMER PACKAGE</label><div className={rdCls}>{client.package_name || '—'}</div></div>
              <div><label className={label}>MONTHLY BILL</label><div className={rdCls}>৳ {money(client.monthly_bill)}</div></div>
            </div>
          )}

          {/* Amount info table */}
          <div className="overflow-hidden rounded border border-gray-200">
            <div className="grid grid-cols-2 bg-[#1d435d] px-3 py-1.5 text-[10px] font-bold uppercase text-white">
              <span>Details</span><span className="text-right">Amount</span>
            </div>
            <div className="divide-y divide-gray-100 text-xs">
              <div className="grid grid-cols-2 px-3 py-2">
                <span className="text-gray-500">Payable Amount (client due)</span>
                <span className="text-right font-medium">{money(payable)}</span>
              </div>
              <div className="grid grid-cols-2 px-3 py-2">
                <span className="text-gray-500">Received Amount (webhook amount)</span>
                <span className="text-right font-medium">{money(received)}</span>
              </div>
              <div className={`grid grid-cols-2 px-3 py-2 font-semibold ${balDue < 0 ? 'text-emerald-600' : balDue > 0 ? 'text-red-600' : 'text-gray-700'}`}>
                <span>Balance Due</span>
                <span className="text-right">{balDue < 0 ? `(${money(Math.abs(balDue))})` : money(balDue)}</span>
              </div>
              <div className="grid grid-cols-2 px-3 py-2 text-gray-500">
                <span>Remarks/Note</span>
                <span className="text-right text-gray-400 text-[10px]">Webhook payment auto-transfer</span>
              </div>
            </div>
          </div>
        </div>
        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-gray-200 bg-gray-50 px-5 py-3">
          <button onClick={onClose}
            className="flex-1 rounded-full border border-red-400 px-4 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50">
            ✕ Cancel
          </button>
          <button onClick={submit} disabled={submitting || !client}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full bg-[#1d435d] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#0f3048] disabled:opacity-50">
            {submitting ? <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> : '⊕'}
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Webhook Info Modal ── */
function WebhookInfoModal({ record, onClose, onOpenTransfer }) {
  if (!record) return null;
  const rdCls = 'flex h-8 w-full items-center overflow-hidden truncate rounded border border-gray-200 bg-[#f4f7fa] px-2.5 text-xs text-gray-700';
  const Field = ({ lbl, val, full }) => (
    <div className={full ? 'col-span-1 sm:col-span-3' : ''}>
      <label className={label}>{lbl}</label>
      <div className={rdCls} title={typeof val === 'string' ? val : undefined}>{val || '—'}</div>
    </div>
  );
  const gwType = (record.gateway || record.payment_from || 'WEBHOOK').toUpperCase().replace('_', ' ');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between bg-[#1d435d] px-5 py-3 shrink-0">
          <span className="font-bold text-white">{gwType} Payment Information</span>
          <button onClick={onClose} className="text-xl text-white/70 hover:text-white">×</button>
        </div>
        {/* Body */}
        <div className="p-5 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field lbl="TRANS./MSG/INV. NO."     val={record.invoice_no || record.transaction_ref} />
            <Field lbl="TRANSACTION ID"           val={record.transaction_id} />
            <Field lbl="PAYMENT AMOUNT"           val={money(record.amount)} />
            <Field lbl="FROM WALLET"              val={record.from_wallet} />
            <Field lbl="TO WALLET/ORG"            val={record.to_wallet || record.org_wallet} />
            <Field lbl="TRANS. REFERENCE"         val={record.transaction_ref || record.trx_ref} />
            <Field lbl="P.METHOD TYPE"            val={record.gateway || record.payment_from} />
            <Field lbl="TRANS. TIMESTAMP"         val={record.transaction_timestamp || record.trx_time} />
            <Field lbl="TRANS. STATUS"            val={record.transaction_status || record.trx_status} />
            <Field lbl="CREATED ON"               val={record.created_at ? new Date(record.created_at).toLocaleString('en-US') : ''} />
            <Field lbl="UPDATE BY"                val={record.updated_by_name} />
            <Field lbl="UPDATED ON"               val={record.updated_at ? new Date(record.updated_at).toLocaleString('en-US') : ''} />
            <Field lbl="SETTLEMENT STATUS"        val={record.settlement_status} full />
            <Field lbl="REMARKS/NOTE"             val={record.remarks_note || record.notes} full />
          </div>

          {/* ── Transfer History (Log) — প্রতিটি transfer/re-transfer ── */}
          <div>
            <label className={label}>TRANSFER HISTORY (LOG)</label>
            {(record.transfer_history && record.transfer_history.length > 0) ? (
              <div className="max-h-44 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                {record.transfer_history.map((h, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-2 text-xs">
                    <span className={`mt-0.5 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${h.action === 're-transfer' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      #{h.seq} {h.action}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-gray-800">
                        <span className="text-gray-500">{h.from}</span>
                        <span className="mx-1 text-[#1d435d]">→</span>
                        <span className="text-[#1d435d]">{h.to}</span>
                        <span className="ml-1 text-gray-400">| ৳{h.amount}</span>
                      </div>
                      <div className="text-[10px] text-gray-400">
                        by {h.by} • {h.at}
                        {h.reversed_previous ? <span className="ml-1 text-amber-600">(আগেরটা ফেরত নেওয়া হয়েছে)</span> : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={rdCls}>কোনো transfer log নেই</div>
            )}
          </div>
        </div>
        {/* Footer */}
        <div className="flex shrink-0 items-center gap-3 border-t border-gray-200 bg-gray-50 px-5 py-3">
          <button onClick={onClose}
            className="rounded-full border border-red-400 px-5 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50">
            ✕ Cancel
          </button>
          <button onClick={() => { onClose(); onOpenTransfer(record); }}
            className="rounded-full border border-[#1d435d] px-5 py-1.5 text-xs font-bold text-[#1d435d] hover:bg-[#1d435d] hover:text-white">
            ⊕ Payment Transfer
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DailyCollection() {
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();
  // superadmin ও admin approve করতে পারবে
  const canApprove = currentUser?.role === 'superadmin' || currentUser?.role === 'admin';

  /* ── Active Tab ── */
  const [activeTab, setActiveTab] = useState('collected');

  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState({});
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [approvingId, setApprovingId] = useState(null);
  const [page, setPage] = useState(1);
  const [payUsers,        setPayUsers]        = useState([]);
  const [editingPayment,  setEditingPayment]  = useState(null); // edit mode-এ যে payment টি edit হচ্ছে
  const [perPage, setPerPage] = useState(25);
  const [count, setCount] = useState(0);
  const [selected, setSelected] = useState([]);

  const [filters, setFilters] = useState({
    username: '',
    date_from: today(),
    date_to: today(),
    received_by: '',
    approved_by: '',
    created_by: '',
    trans_status: '',
    payment_method: '',
    search: '',
  });

  /* ── Webhook tab state ── */
  const [webhookRecords, setWebhookRecords]     = useState([]);
  const [webhookSummary, setWebhookSummary]     = useState({});
  const [webhookLoading, setWebhookLoading]     = useState(false);
  const [webhookPage, setWebhookPage]           = useState(1);
  const [webhookPerPage, setWebhookPerPage]     = useState(25);
  const [webhookCount, setWebhookCount]         = useState(0);
  // প্রতিটি webhook table column অনুযায়ী filter (backend param নামের সাথে হুবহু মিল)
  const WEBHOOK_FILTER_INIT = {
    gateway: '',            // TypeFor কলাম
    settlement_status: '',  // Status কলাম
    trans_status: '',       // Trxn.Status কলাম
    from_wallet: '',        // FromWallet কলাম
    trans_reference: '',    // Trxn.Ref. কলাম
    amount_min: '',         // Amount কলাম (min)
    amount_max: '',         // Amount কলাম (max)
    date_from: '',          // Trxn.Date কলাম (from) — default খালি, সব দেখাবে
    date_to: '',            // Trxn.Date কলাম (to)
    search: '',
  };
  const [webhookFilters, setWebhookFilters]     = useState({ ...WEBHOOK_FILTER_INIT });
  const [webhookApplied, setWebhookApplied]     = useState({ ...WEBHOOK_FILTER_INIT });
  const [webhookInfoRecord, setWebhookInfoRecord]       = useState(null);
  const [webhookTransferRecord, setWebhookTransferRecord] = useState(null);

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [client, setClient] = useState(null);
  const [clientBills, setClientBills] = useState([]);
  const [pay, setPay] = useState({
    bill: '',
    amount: '',
    payment_method: 'cash',
    received_by: '',
    transaction_id: '',
    notes: '',
    send_sms: true,
    next_billing: false,
  });
  const [saving, setSaving] = useState(false);

  const userOptions = useMemo(() => users.map(u => ({ id: u.id, name: userLabel(u) })), [users]);
  const params = useMemo(() => {
    const p = new URLSearchParams({ page, page_size: perPage });
    Object.entries(filters).forEach(([k, v]) => { if (v) p.append(k, v); });
    return p.toString();
  }, [filters, page, perPage]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payRes = await api.get(`/billing/payments/?${params}`);
      const list = payRes.data.results || payRes.data || [];
      setRecords(list);
      setCount(payRes.data.count ?? list.length);
      setSelected([]);
      try {
        const sumRes = await api.get(`/billing/payments/collection-summary/?${params}`);
        setSummary(sumRes.data || {});
      } catch {
        try {
          const fallback = await api.get(`/billing/payments/summary/?${params}`);
          setSummary({
            received: fallback.data.total_amount || 0,
            discount: 0,
            due: 0,
            total: fallback.data.total_payments || 0,
          });
        } catch {
          setSummary({});
        }
      }
    } catch (err) {
      if (err.response?.status !== 401) toast.error('Daily bill collection load failed.');
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => { load(); }, [load]);

  /* ── Webhook load ── */
  const webhookParams = useMemo(() => {
    const p = new URLSearchParams({ page: webhookPage, page_size: webhookPerPage });
    Object.entries(webhookApplied).forEach(([k, v]) => { if (v) p.append(k, v); });
    return p.toString();
  }, [webhookApplied, webhookPage, webhookPerPage]);

  const loadWebhook = useCallback(async () => {
    setWebhookLoading(true);
    try {
      const res = await api.get(`/billing/webhook-payments/?${webhookParams}`);
      const list = res.data.results || res.data || [];
      setWebhookRecords(list);
      setWebhookCount(res.data.count ?? list.length);
      /* summary totals from list */
      const totRec  = list.reduce((a, r) => a + Number(r.amount || 0), 0);
      const totDisc = list.reduce((a, r) => a + Number(r.discount || 0), 0);
      const totDue  = list.reduce((a, r) => a + Number(r.due_amount || 0), 0);
      setWebhookSummary({ received: totRec, discount: totDisc, due: totDue });
    } catch (err) {
      if (err.response?.status !== 401) toast.error('Webhook payments load failed.');
      setWebhookRecords([]);
    } finally { setWebhookLoading(false); }
  }, [webhookParams]);

  useEffect(() => { if (activeTab === 'webhook') loadWebhook(); }, [loadWebhook, activeTab]);

  useEffect(() => {
    Promise.all([
      api.get('/auth/users/?page_size=500').catch(() => ({ data: [] })),
      api.get('/hr/employees/?status=active&page_size=500').catch(() => ({ data: [] })),
    ]).then(([userRes, empRes]) => {
      const allUsers = userRes.data.results || userRes.data || [];
      const emps     = empRes.data.results  || empRes.data  || [];
      setUsers(allUsers);
      // payUsers: admin/superadmin আগে, তারপর employees (duplicate এড়াতে)
      const empUserIds = new Set(emps.map(e => e.user).filter(Boolean));
      const adminUsers = allUsers
        .filter(u => ['admin', 'superadmin'].includes(u.role) && !empUserIds.has(u.id) && u.is_active !== false)
        .map(u => ({ _type: 'user', id: u.id, full_name: u.full_name || u.username, designation: u.role === 'superadmin' ? 'Super Admin' : 'Admin' }));
      const empList = emps.map(e => ({ _type: 'emp', ...e }));
      setPayUsers([...adminUsers, ...empList]);
    });
  }, []);

  const setFilter = (key, value) => {
    setFilters(f => ({ ...f, [key]: value }));
    setPage(1);
  };

  const selectedBill = clientBills.find(b => String(b.id) === String(pay.bill));
  const payable = Number(selectedBill?.client_balance_due ?? selectedBill?.due_amount ?? client?.due_amount ?? 0);
  const received = Number(pay.amount || 0);
  const balance = Math.max(payable - received, 0);

  const pickClient = async c => {
    setClient(c);
    try {
      const res = await api.get(`/billing/bills/?client=${c.id}&page_size=500`);
      const bills = res.data.results || res.data || [];
      const dueBill = bills.find(b => Number(b.due_amount) > 0) || bills[0];
      setClientBills(bills);
      setPay(f => ({
        ...f,
        bill: dueBill?.id || '',
        amount: dueBill ? String(Number(dueBill.due_amount || c.due_amount || 0)) : '',
        received_by: f.received_by || '',
        notes: 'Received in hand',
      }));
    } catch {
      setClientBills([]);
      toast.error('Client bill load failed.');
    }
  };

  const openReceive = () => {
    setEditingPayment(null);
    setClient(null);
    setClientBills([]);
    setPay({ bill: '', amount: '', payment_method: 'cash', received_by: '', transaction_id: '', notes: '', send_sms: true, next_billing: false });
    setReceiveOpen(true);
  };

  // Edit mode: Bill Receive modal pre-fill করে খোলো
  const openEditAsReceive = (r) => {
    setEditingPayment(r);
    // payment record থেকে client mock তৈরি (read-only display-এর জন্য)
    setClient({
      id:           r.client_id,
      username:     r.client_username || r.client_customer_id,
      customer_id:  r.client_customer_id,
      full_name:    r.client_name,
      phone:        r.client_phone,
      monthly_bill: r.client_monthly_bill,
      due_amount:   r.client_due_amount,
      status:       '', zone_name: '', address: '', package_name: '',
      bill_date:    r.bill_month,
    });
    // bill mock
    setClientBills(r.bill ? [{ id: r.bill, due_amount: r.bill_due_amount, discount: r.bill_discount, net_amount: r.bill_net_amount }] : []);
    // form pre-fill — notes থেকে [গৃহীত: ...] tag বাদ দাও
    const cleanNotes = (r.notes || '').replace(/^\[গৃহীত: .+?\]\s*/, '').trim();
    setPay({
      bill:           r.bill ? String(r.bill) : '',
      amount:         String(r.amount || ''),
      payment_method: r.payment_method || 'cash',
      received_by:    r.received_by ? String(r.received_by) : '',
      transaction_id: r.transaction_id || '',
      notes:          cleanNotes,
      send_sms:       false,
      next_billing:   false,
    });
    setReceiveOpen(true);
  };

  const submitReceive = async () => {
    if (!pay.amount || Number(pay.amount) <= 0) return toast.error('Enter received amount.');
    setSaving(true);
    try {
      if (editingPayment) {
        // ── Edit mode: PATCH existing payment ──
        await api.patch(`/billing/payments/${editingPayment.id}/update-info/`, {
          amount:         pay.amount,
          payment_method: pay.payment_method,
          received_by:    pay.received_by || undefined,
          transaction_id: pay.transaction_id,
          notes:          pay.notes,
        });
        toast.success('Payment আপডেট হয়েছে।');
      } else {
        // ── Create mode: POST new payment ──
        if (!client) return toast.error('Select a client.');
        if (!pay.bill) return toast.error('This client has no bill to receive payment.');
        await api.post('/billing/payments/', {
          bill:           pay.bill,
          amount:         pay.amount,
          payment_method: pay.payment_method,
          received_by:    pay.received_by || undefined,
          transaction_id: pay.transaction_id,
          notes:          pay.notes,
          is_verified:    false,
        });
        toast.success('Bill received successfully.');
      }
      setReceiveOpen(false);
      setEditingPayment(null);
      load();
    } catch (err) {
      const data = err.response?.data;
      if (data && typeof data === 'object') Object.values(data).forEach(m => toast.error(Array.isArray(m) ? m[0] : m));
      else toast.error(editingPayment ? 'আপডেট ব্যর্থ হয়েছে।' : 'Bill receive failed.');
    } finally {
      setSaving(false);
    }
  };

  const approveSelected = async () => {
    if (!selected.length) return toast.error('Select transaction first.');
    await api.post('/billing/payments/approve-selected/', { ids: selected });
    toast.success('Selected transaction approved.');
    load();
  };

  const deleteSelected = async () => {
    if (!selected.length) return toast.error('Select transaction first.');
    if (!window.confirm('Delete selected transaction?')) return;
    await api.post('/billing/payments/delete-selected/', { ids: selected });
    toast.success('Selected transaction deleted.');
    load();
  };

  const deleteOne = async id => {
    if (!window.confirm('Delete this transaction?')) return;
    try {
      await api.delete(`/billing/payments/${id}/`);
      toast.success('Transaction deleted.');
      load();
    } catch { toast.error('Delete failed.'); }
  };

  /* ── Single approve ── */
  const approveOne = async (id) => {
    setApprovingId(id);
    try {
      await api.post('/billing/payments/approve-selected/', { ids: [id] });
      toast.success('Transaction approved.');
      load();
    } catch { toast.error('Approval failed.'); }
    finally { setApprovingId(null); }
  };

  const rows = records.filter(r => {
    const q = filters.search.trim().toLowerCase();
    if (!q) return true;
    return [r.client_customer_id, r.client_username, r.client_name, r.client_phone, r.notes, r.payment_method]
      .some(v => String(v || '').toLowerCase().includes(q));
  });

  const totals = rows.reduce((a, r) => ({
    bill: a.bill + Number(r.bill_net_amount || 0),
    received: a.received + Number(r.amount || 0),
    vat: a.vat,
    discount: a.discount + Number(r.bill_discount || 0),
    due: a.due + Number(r.bill_due_amount || 0),
  }), { bill: 0, received: 0, vat: 0, discount: 0, due: 0 });

  const exportRows = rows.map(r => [
    new Date(r.payment_date).toLocaleDateString('en-US'),
    r.client_id,
    r.client_username || r.client_customer_id,
    r.client_name,
    r.client_phone,
    r.notes || '',
    money(r.bill_net_amount),
    money(r.amount),
    '0.00',
    money(r.bill_discount),
    money(r.bill_due_amount),
    r.payment_method,
    r.received_by_name || '',
    r.approved_by_name || '',
    r.created_by_name || '',
  ]);

  const generateCSV = () => {
    const headers = ['Date','Customer ID','UserName','Cus.Name','MobileNo.','Note/Remarks','M.Bill','Received','VAT','Discount','BalanceDue','PaymentMethod','ReceivedBy','ApprovedBy','CreatedBy'];
    const csv = [headers, ...exportRows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `daily-bill-collection-${filters.date_from || today()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const generatePDF = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(14);
    doc.text('Daily Bill Collection', 14, 14);
    autoTable(doc, {
      head: [['Date','Customer ID','UserName','Cus.Name','Mobile','Note','M.Bill','Received','VAT','Discount','BalanceDue','Method','ReceivedBy','ApprovedBy','CreatedBy']],
      body: exportRows,
      startY: 20,
      styles: { fontSize: 7 },
      headStyles: { fillColor: [29, 67, 93] },
    });
    doc.save(`daily-bill-collection-${filters.date_from || today()}.pdf`);
  };

  const allSelected = rows.length > 0 && selected.length === rows.length;
  const toggleAll = () => setSelected(allSelected ? [] : rows.map(r => r.id));
  const toggleOne = id => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  return (
    <div className="-mt-2 space-y-3 bg-[#e9e9e9] pb-10">
      <div className="flex items-center justify-between px-2">
        <div className="flex items-end gap-2">
          <h1 className="text-xl font-bold text-[#0f3048]">▣ Daily Bill Collection</h1>
          <span className="pb-1 text-xs text-gray-500">All Daily Collected Bills</span>
        </div>
        <div className="text-xs text-gray-500">▣ Billing &nbsp; &gt; &nbsp; Daily Bill Collection</div>
      </div>

      <div className="mx-1 rounded-md bg-white p-3 shadow-md">
        <div className="mb-6 flex gap-3 border-b border-gray-200 pb-3">
          <button
            onClick={() => setActiveTab('collected')}
            className={`rounded-full px-4 py-2 text-xs font-bold transition ${activeTab === 'collected' ? 'bg-[#173d59] text-white' : 'border border-[#173d59] text-[#173d59] hover:bg-[#173d59]/10'}`}>
            ☷ Collected Bills
          </button>
          <button
            onClick={() => setActiveTab('webhook')}
            className={`rounded-full px-4 py-2 text-xs font-bold transition ${activeTab === 'webhook' ? 'bg-[#173d59] text-white' : 'border border-[#173d59] text-[#173d59] hover:bg-[#173d59]/10'}`}>
            ☷ Webhook Payments
          </button>
        </div>

        {/* ════════════════ COLLECTED BILLS TAB ════════════════ */}
        {activeTab === 'collected' && (<>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <StatCard icon="💵" title="Recieve" value={money(summary.received)} foot="Monthly paid client" tone="cyan" />
          <StatCard icon="🏷" title="Discount" value={money(summary.discount)} foot="Monthly unpaid client" tone="teal" />
          <StatCard icon="💵" title="Due" value={money(summary.due)} foot="Monthly recived bill" tone="violet" />
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-3">
            <button onClick={generateCSV} className={btn}>Generate CSV</button>
            <button onClick={generatePDF} className={btn}>Generate PDF</button>
          </div>
          <button onClick={openReceive} className={btn}>✚ Receive Bill</button>
          <button onClick={approveSelected} className={btn}>✓ Approve Selected Transaction</button>
          <button onClick={deleteSelected} className={btn}>▥ Delete Selected Transaction</button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label className={label}>USERNAME</label>
            <input className={input} value={filters.username} onChange={e => setFilter('username', e.target.value)} placeholder="All User" />
          </div>
          <div>
            <label className={label}>FROM DATE</label>
            <input type="date" className={input} value={filters.date_from} onChange={e => setFilter('date_from', e.target.value)} />
          </div>
          <div>
            <label className={label}>TO DATE</label>
            <input type="date" className={input} value={filters.date_to} onChange={e => setFilter('date_to', e.target.value)} />
          </div>
          <div>
            <label className={label}>RECEIVED BY</label>
            <select className={input} value={filters.received_by} onChange={e => setFilter('received_by', e.target.value)}>
              <option value="">Select</option>
              {userOptions.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>APPROVED BY</label>
            <select className={input} value={filters.approved_by} onChange={e => setFilter('approved_by', e.target.value)}>
              <option value="">Select</option>
              {userOptions.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>CREATED BY</label>
            <select className={input} value={filters.created_by} onChange={e => setFilter('created_by', e.target.value)}>
              <option value="">Select</option>
              {userOptions.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>TRANS. STATUS</label>
            <select className={input} value={filters.trans_status} onChange={e => setFilter('trans_status', e.target.value)}>
              <option value="">Select</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
            </select>
          </div>
          <div>
            <label className={label}>PAYMENT METHOD</label>
            <select className={input} value={filters.payment_method} onChange={e => setFilter('payment_method', e.target.value)}>
              <option value="">Select</option>
              <option value="cash">Cash</option>
              <option value="bkash">bKash</option>
              <option value="nagad">Nagad</option>
              <option value="rocket">Rocket</option>
              <option value="bank">Bank</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        <div className="mt-8 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs uppercase text-[#466078]">
            Show
            <select className="h-8 border border-gray-300 px-2" value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setPage(1); }}>
              {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            Entries
          </div>
          <div className="flex items-center gap-2 text-xs uppercase text-[#466078]">
            Search:
            <input className="h-8 w-44 border border-gray-300 px-2 outline-none" value={filters.search} onChange={e => setFilter('search', e.target.value)} />
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[1500px] border-collapse text-xs">
            <thead>
              <tr className="bg-[#1d435d] text-white">
                {['Date↕','Customer ID','UserName','Cus.Name','MobileNo.','Note/Remarks','M.Bill','Received','VAT','Discount','BalanceDue','PaymentMethod','ReceivedBy↕','ApprovedBy↕','CreatedBy↕','Action'].map(h => (
                  <th key={h} className="border-r border-white/40 px-3 py-3 text-center font-bold">{h}</th>
                ))}
                <th className="px-3 py-3"><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={17} className="py-8 text-center text-gray-400">Loading...</td></tr>
              ) : rows.length ? rows.map(r => (
                <tr key={r.id} className="border-b border-gray-200 text-center hover:bg-sky-50">
                  <td className="px-3 py-3">{new Date(r.payment_date).toLocaleDateString('en-US')}</td>
                  <td className="px-3 py-3">{r.client_id}</td>
                  <td className="px-3 py-3">{r.client_username || r.client_customer_id}</td>
                  <td className="px-3 py-3">{r.client_name}</td>
                  <td className="px-3 py-3">{r.client_phone}</td>
                  <td className="px-3 py-3">{r.notes || '—'}</td>
                  <td className="px-3 py-3">{money(r.bill_net_amount)}</td>
                  <td className="px-3 py-3 font-semibold">{money(r.amount)}</td>
                  <td className="px-3 py-3">0.00</td>
                  <td className="px-3 py-3">{money(r.bill_discount)}</td>
                  <td className="px-3 py-3">{money(r.bill_due_amount)}</td>
                  <td className="px-3 py-3 capitalize">{r.payment_method}</td>
                  <td className="px-3 py-3">{r.received_by_name || '—'}</td>
                  <td className="px-3 py-3">{r.approved_by_name || '—'}</td>
                  <td className="px-3 py-3">{r.created_by_name || '—'}</td>

                  {/* ── Action: three-dot menu (BillList design) ── */}
                  <td className="px-3 py-3">
                    <PaymentActionsMenu
                      r={r}
                      canApprove={canApprove}
                      approvingId={approvingId}
                      onApprove={approveOne}
                      onEdit={openEditAsReceive}
                      onDelete={deleteOne}
                    />
                  </td>
                  <td className="px-3 py-3"><input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleOne(r.id)} /></td>
                </tr>
              )) : (
                <tr><td colSpan={17} className="px-4 py-5 text-left text-sm">No data<br />available in<br />table</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 text-center font-bold text-[#1d435d]">
                <td colSpan={6} className="border border-gray-200 px-3 py-3">TOTAL</td>
                <td className="border border-gray-200">{money(totals.bill)}</td>
                <td className="border border-gray-200">{money(totals.received)}</td>
                <td className="border border-gray-200">{money(totals.vat)}</td>
                <td className="border border-gray-200">{money(totals.discount)}</td>
                <td className="border border-gray-200">{money(totals.due)}</td>
                <td colSpan={6} className="border border-gray-200"></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-4 flex justify-between text-xs">
          <span>Showing {rows.length ? 1 : 0} to {rows.length} of {count} entries</span>
          <div className="flex gap-5 text-gray-400">
            <button disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</button>
            <button disabled={rows.length < perPage} onClick={() => setPage(p => p + 1)}>Next</button>
          </div>
        </div>

        </>)}
        {/* ════════════════ WEBHOOK PAYMENTS TAB ════════════════ */}
        {activeTab === 'webhook' && (<>

        {/* Stat Cards */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <StatCard icon="💵" title="Receive" value={money(webhookSummary.received)} foot="Total webhook received" tone="cyan" />
          <StatCard icon="🏷" title="Discount" value={money(webhookSummary.discount)} foot="Total webhook discount" tone="teal" />
          <StatCard icon="💵" title="Due" value={money(webhookSummary.due)} foot="Total webhook due" tone="violet" />
        </div>

        {/* CSV / PDF */}
        <div className="mt-8 flex items-center justify-between gap-3">
          <div className="flex gap-3">
            <button className={btn} onClick={() => {
              const headers = ['Trxn.Date','Trxn.ID','FromWallet','Amount','Trxn.Status','Trxn.Ref.','TimeStamp','TypeFor','Status','UpdateBy','UpdatedOn'];
              const rows2 = webhookRecords.map(r => [
                r.created_at ? new Date(r.created_at).toLocaleDateString('en-US') : '',
                r.transaction_id || '', r.from_wallet || '', money(r.amount),
                r.transaction_status || '', r.transaction_ref || '',
                r.transaction_timestamp || '', r.gateway || '',
                r.settlement_status || '', r.updated_by_name || '',
                r.updated_at ? new Date(r.updated_at).toLocaleDateString('en-US') : '',
              ]);
              const csv = [headers, ...rows2].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
              const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
              const a = document.createElement('a'); a.href = url;
              a.download = `webhook-payments-${webhookApplied.date_from || today()}.csv`; a.click();
              URL.revokeObjectURL(url);
            }}>Generate CSV</button>
            <button className={btn} onClick={() => {
              const doc = new jsPDF({ orientation: 'landscape' });
              doc.setFontSize(14); doc.text('Webhook Payments', 14, 14);
              autoTable(doc, {
                head: [['Trxn.Date','Trxn.ID','FromWallet','Amount','Trxn.Status','Trxn.Ref.','Gateway','Status','UpdateBy']],
                body: webhookRecords.map(r => [
                  r.created_at ? new Date(r.created_at).toLocaleDateString('en-US') : '',
                  r.transaction_id || '', r.from_wallet || '', money(r.amount),
                  r.transaction_status || '', r.transaction_ref || '',
                  r.gateway || '', r.settlement_status || '', r.updated_by_name || '',
                ]),
                startY: 20, styles: { fontSize: 7 }, headStyles: { fillColor: [29, 67, 93] },
              });
              doc.save(`webhook-payments-${webhookApplied.date_from || today()}.pdf`);
            }}>Generate PDF</button>
          </div>
        </div>

        {/* Filters — প্রতিটি টেবিল কলাম অনুযায়ী column-aligned ফিল্টার */}
        <div className="mt-5 space-y-3">
          {/* Row 1 — Gateway / Settlement / Trxn Status / FromWallet */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <label className={label}>TYPE FOR (GATEWAY)</label>
              <select className={input} value={webhookFilters.gateway} onChange={e => setWebhookFilters(f => ({ ...f, gateway: e.target.value }))}>
                <option value="">All Gateways</option>
                <option value="BKASH_WEBHOOK">bKash Webhook</option>
                <option value="NAGAD_WEBHOOK">Nagad Webhook</option>
                <option value="ROCKET_WEBHOOK">Rocket Webhook</option>
                <option value="FOSTERPAYMENTS_WEBHOOK">FosterPayments Webhook</option>
                <option value="SSLCOMMERZ_WEBHOOK">SSLCommerz Webhook</option>
              </select>
            </div>
            <div>
              <label className={label}>STATUS (SETTLEMENT)</label>
              <select className={input} value={webhookFilters.settlement_status} onChange={e => setWebhookFilters(f => ({ ...f, settlement_status: e.target.value }))}>
                <option value="">All Settlement</option>
                <option value="payment_requested">Payment Requested</option>
                <option value="automatically_settled">Automatically Settled</option>
                <option value="manually_settled">Manually Settled</option>
                <option value="payment_transferred">Payment Transferred</option>
                <option value="payment_retransferred">Payment Retransferred</option>
              </select>
            </div>
            <div>
              <label className={label}>TRXN. STATUS</label>
              <select className={input} value={webhookFilters.trans_status} onChange={e => setWebhookFilters(f => ({ ...f, trans_status: e.target.value }))}>
                <option value="">All Trxn Status</option>
                <option value="Completed">Completed</option>
                <option value="Initiated">Initiated</option>
                <option value="Failed">Failed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>
            <div>
              <label className={label}>FROM WALLET</label>
              <input type="text" placeholder="01XXXXXXXXX" className={input} value={webhookFilters.from_wallet} onChange={e => setWebhookFilters(f => ({ ...f, from_wallet: e.target.value }))} />
            </div>
          </div>
          {/* Row 2 — Trxn Ref / Amount min-max / Date range */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <label className={label}>TRXN. REF.</label>
              <input type="text" placeholder="Customer ID / Username" className={input} value={webhookFilters.trans_reference} onChange={e => setWebhookFilters(f => ({ ...f, trans_reference: e.target.value }))} />
            </div>
            <div>
              <label className={label}>AMOUNT (MIN – MAX)</label>
              <div className="flex gap-2">
                <input type="number" min="0" placeholder="Min" className={input} value={webhookFilters.amount_min} onChange={e => setWebhookFilters(f => ({ ...f, amount_min: e.target.value }))} />
                <input type="number" min="0" placeholder="Max" className={input} value={webhookFilters.amount_max} onChange={e => setWebhookFilters(f => ({ ...f, amount_max: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className={label}>TRXN. DATE FROM</label>
              <input type="date" className={input} value={webhookFilters.date_from} onChange={e => setWebhookFilters(f => ({ ...f, date_from: e.target.value }))} />
            </div>
            <div>
              <label className={label}>TRXN. DATE TO</label>
              <input type="date" className={input} value={webhookFilters.date_to} onChange={e => setWebhookFilters(f => ({ ...f, date_to: e.target.value }))} />
            </div>
          </div>
          {/* Row 3: actions */}
          <div className="flex justify-end gap-3">
            <button className="inline-flex items-center gap-1.5 rounded-full bg-red-500 px-4 py-2 text-xs font-bold text-white shadow-md hover:bg-red-600"
              onClick={() => {
                const reset = { ...WEBHOOK_FILTER_INIT };
                setWebhookFilters(reset);
                setWebhookApplied(reset);
                setWebhookPage(1);
              }}>
              ✕ Clear Filter
            </button>
            <button className={btn}
              onClick={() => { setWebhookApplied({ ...webhookFilters }); setWebhookPage(1); }}>
              &#128269; Apply Filter
            </button>
          </div>
        </div>

        {/* Show entries + Search */}
        <div className="mt-6 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs uppercase text-[#466078]">
            Show
            <select className="h-8 border border-gray-300 px-2" value={webhookPerPage} onChange={e => { setWebhookPerPage(Number(e.target.value)); setWebhookPage(1); }}>
              {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            Entries
          </div>
          <div className="flex items-center gap-2 text-xs uppercase text-[#466078]">
            Search:
            <input className="h-8 w-44 border border-gray-300 px-2 outline-none"
              value={webhookFilters.search}
              onChange={e => {
                setWebhookFilters(f => ({ ...f, search: e.target.value }));
                setWebhookApplied(f => ({ ...f, search: e.target.value }));
                setWebhookPage(1);
              }} />
          </div>
        </div>

        {/* Table */}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[1400px] border-collapse text-xs">
            <thead>
              <tr className="bg-[#1d435d] text-white">
                {['Trxn.Date ↕','Trxn.ID','FromWallet','Amount','Trxn.Status','Trxn.Ref.','TimeStamp','TypeFor','Status','UpdateBy','UpdatedOn','Action'].map(h => (
                  <th key={h} className="border-r border-white/40 px-3 py-3 text-center font-bold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {webhookLoading ? (
                <tr><td colSpan={12} className="py-8 text-center text-gray-400">Loading...</td></tr>
              ) : webhookRecords.length ? webhookRecords.map((r, idx) => (
                <tr key={r.id} className={`border-b border-gray-200 text-center ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-sky-50`}>
                  <td className="px-3 py-2 whitespace-nowrap text-[10px]">{r.created_at ? new Date(r.created_at).toLocaleString('en-GB', {day:'2-digit',month:'short',year:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true}) : '—'}</td>
                  <td className="px-3 py-2 font-mono text-[10px]">{r.transaction_id || '—'}</td>
                  <td className="px-3 py-2">{r.from_wallet || '—'}</td>
                  <td className="px-3 py-2 font-semibold">{money(r.amount)}</td>
                  <td className="px-3 py-2">{r.transaction_status || '—'}</td>
                  <td className="px-3 py-2 font-mono text-[10px]">{r.transaction_ref || r.trx_ref || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-[10px]">{r.transaction_timestamp || r.trx_time || '—'}</td>
                  <td className="px-3 py-2 capitalize">{r.gateway || r.payment_from || '—'}</td>
                  <td className="px-3 py-2"><WebhookStatusBadge status={r.settlement_status} /></td>
                  <td className="px-3 py-2">{r.updated_by_name || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-[10px]">{r.updated_at ? new Date(r.updated_at).toLocaleString('en-GB', {day:'2-digit',month:'short',year:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true}) : '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-center gap-1.5">
                      <ActionTooltipBtn tooltip="Payment Transfer"
                        color="bg-green-500 border-green-600 text-white hover:bg-green-600"
                        onClick={() => setWebhookTransferRecord(r)}>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                      </ActionTooltipBtn>
                      <ActionTooltipBtn tooltip="View Details"
                        color="bg-white border border-blue-400 text-blue-500 hover:bg-blue-50"
                        onClick={() => setWebhookInfoRecord(r)}>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      </ActionTooltipBtn>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={12} className="px-4 py-5 text-left text-sm">No data<br />available in<br />table</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 text-center font-bold text-[#1d435d]">
                <td colSpan={3} className="border border-gray-200 px-3 py-3">TOTAL</td>
                <td className="border border-gray-200">{money(webhookRecords.reduce((a, r) => a + Number(r.amount || 0), 0))}</td>
                <td colSpan={8} className="border border-gray-200"></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Pagination */}
        <div className="mt-4 flex justify-between text-xs">
          <span>Showing {webhookRecords.length ? (webhookPage - 1) * webhookPerPage + 1 : 0} to {(webhookPage - 1) * webhookPerPage + webhookRecords.length} of {webhookCount} entries</span>
          <div className="flex gap-5 text-gray-400">
            <button disabled={webhookPage === 1} onClick={() => setWebhookPage(p => Math.max(1, p - 1))}>Previous</button>
            <span className="font-bold text-[#1d435d]">{webhookPage}</span>
            <button disabled={webhookRecords.length < webhookPerPage} onClick={() => setWebhookPage(p => p + 1)}>Next</button>
          </div>
        </div>

        </>)}
      </div>

      {receiveOpen && (() => {
        const rdCls  = 'flex h-9 w-full items-center overflow-hidden truncate rounded-lg border border-gray-200 bg-[#f4f7fa] px-3 text-sm text-gray-700';
        const lbl2   = 'mb-1 block text-[10px] font-bold uppercase tracking-wider text-[#5a7a90]';
        const edCls  = 'h-9 w-full rounded-lg border border-[#b8d0e0] bg-white px-3 text-sm text-gray-800 outline-none transition focus:border-[#1d435d] focus:ring-2 focus:ring-[#1d435d]/15';
        const balDue = Math.max(payable - received, 0);
        const advAdd = Math.max(received - payable, 0);
        const statusBadge = { active:'bg-emerald-100 text-emerald-700', inactive:'bg-gray-100 text-gray-500', suspended:'bg-orange-100 text-orange-600', expired:'bg-red-100 text-red-600' }[client?.status] || 'bg-gray-100 text-gray-500';
        return (
          <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-0 md:px-3 md:py-4 backdrop-blur-sm">
            <div className="flex w-full md:w-[800px] max-h-[90vh] flex-col overflow-hidden rounded-t-2xl md:rounded-2xl bg-white shadow-2xl">

              {/* Header */}
              <div className="shrink-0 bg-gradient-to-r from-[#1d435d] to-[#245f84] px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-2xl select-none">
                      {editingPayment ? '✏️' : '💳'}
                    </div>
                    <div>
                      <p className="text-lg font-bold leading-tight text-white">
                        {editingPayment ? 'Edit Bill Receive' : 'Bill Receive'}
                      </p>
                      <p className="mt-0.5 text-xs text-blue-200">
                        {editingPayment
                          ? `${new Date(editingPayment.payment_date).toLocaleDateString('en-US')} · ${editingPayment.client_name || editingPayment.client_username || editingPayment.client_customer_id || '—'}`
                          : (client ? `${client.username || client.customer_id} · ${client.full_name || ''}` : 'ক্লায়েন্ট সিলেক্ট করুন')}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => { setReceiveOpen(false); setEditingPayment(null); }}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xl text-white/60 transition hover:bg-white/25 hover:text-white">×</button>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 space-y-4 overflow-y-auto p-5">

                {/* Create mode: client search */}
                {!editingPayment && !client && (
                  <div className="rounded-xl border border-[#d0e4f0] bg-[#f0f6fa] p-4">
                    <p className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#1d435d]">
                      <span className="h-px flex-1 bg-[#1d435d]/20"/>Client Search<span className="h-px flex-1 bg-[#1d435d]/20"/>
                    </p>
                    <SelectClientBox value={client} onPick={pickClient} />
                  </div>
                )}

                {/* Client Info Card — edit mode-এ দেখাবে না */}
                {client && !editingPayment && (
                  <div className="rounded-xl border border-[#d0e4f0] bg-[#f0f6fa] p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="h-px flex-1 bg-[#1d435d]/20"/>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#1d435d]">Client Information</span>
                      <span className="h-px flex-1 bg-[#1d435d]/20"/>
                      {/* কাস্টমার সার্চ পেজে নিয়ে যাওয়ার বাটন */}
                      <button
                        type="button"
                        onClick={() => navigate(`/search?client=${client.id}`)}
                        className="inline-flex items-center gap-1 rounded-full border border-[#1d435d]/30 bg-white px-3 py-1 text-[10px] font-bold text-[#1d435d] shadow-sm hover:bg-[#1d435d] hover:text-white transition"
                      >
                        View Profile
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                      <div><label className={lbl2}>Username</label><div className={rdCls} title={client.username || client.customer_id || ''}>{client.username || client.customer_id || '—'}</div></div>
                      <div><label className={lbl2}>Mobile</label><div className={rdCls}>{client.phone || '—'}</div></div>
                      <div><label className={lbl2}>Bill Date</label><div className={rdCls}>{client.bill_date || '—'}</div></div>
                      <div>
                        <label className={lbl2}>Status</label>
                        <div><span className={`inline-flex items-center rounded-full px-3 py-0.5 text-xs font-semibold capitalize ${statusBadge}`}>{client.status || '—'}</span></div>
                      </div>
                      <div><label className={lbl2}>Zone</label><div className={rdCls}>{client.zone_name || '—'}</div></div>
                      <div className="col-span-2"><label className={lbl2}>Address</label><div className={rdCls} title={client.address || ''}>{client.address || '—'}</div></div>
                      <div><label className={lbl2}>Package</label><div className={rdCls}>{client.package_name || '—'}</div></div>
                      <div><label className={lbl2}>Received From</label><div className={`${rdCls} font-medium`} title={client.full_name || ''}>{client.full_name || '—'}</div></div>
                      <div><label className={lbl2}>Monthly Bill (৳)</label><div className={`${rdCls} font-semibold text-[#1d435d]`}>৳ {money(client.monthly_bill)}</div></div>
                      <div><label className={lbl2}>Already Paid (৳)</label><div className={`${rdCls} font-semibold text-emerald-600`}>৳ {money(selectedBill?.paid_amount ?? 0)}</div></div>
                      <div><label className={lbl2}>Total Balance Due (৳)</label><div className={`${rdCls} font-bold text-red-600`}>৳ {money(client.due_amount)}</div></div>
                    </div>
                  </div>
                )}

                {/* Payment Details Card */}
                {client && (
                  <div className="overflow-hidden rounded-xl border border-gray-200">
                    <div className="bg-[#1d435d] px-4 py-2.5">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-white/90">Payment Details</p>
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-4 p-4">

                      {/* Received By */}
                      <div>
                        <label className={lbl2}>Received By <span className="text-red-500">*</span></label>
                        <select className={edCls} value={pay.received_by} onChange={e => setPay(f => ({ ...f, received_by: e.target.value }))}>
                          <option value="">— কে গ্রহণ করেছে —</option>
                          {payUsers.map(item => (
                            <option key={(item._type==='user'?'u':'e')+item.id}
                              value={item._type==='user' ? String(item.id) : (item.user ? String(item.user) : `emp:${item.id}`)}>
                              {item.full_name}{item.designation ? ` — ${item.designation}` : ''}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Payment Method */}
                      <div>
                        <label className={lbl2}>Payment Method</label>
                        <select className={edCls} value={pay.payment_method} onChange={e => setPay(f => ({ ...f, payment_method: e.target.value }))}>
                          <option value="cash">💵 Cash</option>
                          <option value="bkash">📱 bKash</option>
                          <option value="nagad">📱 Nagad</option>
                          <option value="rocket">📱 Rocket</option>
                          <option value="bank">🏦 Bank Transfer</option>
                          <option value="other">🔖 Other</option>
                        </select>
                      </div>

                      {/* Bill select — create mode only */}
                      {!editingPayment && clientBills.length > 0 && (
                        <>
                          <div>
                            <label className={lbl2}>Bill Month</label>
                            <select className={edCls} value={pay.bill} onChange={e => {
                              const b = clientBills.find(x => String(x.id) === e.target.value);
                              setPay(f => ({ ...f, bill: e.target.value, amount: b ? String(Number(b.due_amount||0)) : f.amount }));
                            }}>
                              {clientBills.map(b => <option key={b.id} value={b.id}>{b.bill_month} — Due ৳{money(b.due_amount)}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className={lbl2}>Bill Amount (৳)</label>
                            <div className={`${rdCls} font-semibold`}>৳ {money(selectedBill?.net_amount ?? 0)}</div>
                          </div>
                          <div>
                            <label className={lbl2}>Discount (৳)</label>
                            <div className={`${rdCls}`}>৳ {money(selectedBill?.discount ?? 0)}</div>
                          </div>
                          <div>
                            <label className={lbl2}>Payable Amount (৳)</label>
                            <div className={`${rdCls} font-semibold text-[#1d435d]`}>৳ {money(payable)}</div>
                          </div>
                        </>
                      )}

                      {/* Edit mode: show bill month read-only */}
                      {editingPayment && (
                        <>
                          <div>
                            <label className={lbl2}>Bill Month</label>
                            <div className={rdCls}>
                              {editingPayment.bill_month
                                ? editingPayment.bill_month
                                : <span className="text-gray-400 italic text-xs">Advance Payment</span>}
                            </div>
                          </div>
                          <div>
                            <label className={lbl2}>Bill Amount (৳)</label>
                            <div className={`${rdCls} font-semibold`}>৳ {money(editingPayment.bill_net_amount)}</div>
                          </div>
                        </>
                      )}

                      {/* Received Amount */}
                      <div>
                        <label className={lbl2}>Received Amount (৳) <span className="text-red-500">*</span></label>
                        <input
                          className="h-11 w-full rounded-lg border-2 border-[#1d435d]/40 bg-white px-3 text-lg font-bold text-[#1d435d] outline-none transition focus:border-[#1d435d] focus:ring-2 focus:ring-[#1d435d]/15"
                          type="number" min="0" step="0.01"
                          value={pay.amount}
                          onChange={e => setPay(f => ({ ...f, amount: e.target.value }))}
                        />
                      </div>

                      {/* Transaction No */}
                      <div>
                        <label className={lbl2}>Transaction / Receipt No.</label>
                        <input className={edCls} value={pay.transaction_id}
                          onChange={e => setPay(f => ({ ...f, transaction_id: e.target.value }))}
                          placeholder="TXN-XXXXXXXX" />
                      </div>

                      {/* Balance Due / Advance */}
                      <div>
                        <label className={lbl2}>
                          {advAdd > 0 ? 'Advance Balance Added (৳)' : 'Balance Due (৳)'}
                          {advAdd === 0 && balDue === 0 && received > 0 && (
                            <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold normal-case tracking-normal text-emerald-700">Cleared</span>
                          )}
                        </label>
                        {advAdd > 0 ? (
                          <div className="flex h-11 w-full items-center rounded-lg border-2 border-blue-200 bg-blue-50 px-3 text-lg font-bold text-blue-600">
                            ৳ {money(advAdd)}<span className="ml-2 text-xs font-normal text-blue-400">→ advance_balance</span>
                          </div>
                        ) : (
                          <div className={`flex h-11 w-full items-center rounded-lg border-2 px-3 text-lg font-bold ${balDue > 0 ? 'border-red-200 bg-red-50 text-red-600' : 'border-emerald-200 bg-emerald-50 text-emerald-600'}`}>
                            ৳ {money(balDue)}
                          </div>
                        )}
                      </div>

                      {/* Notes */}
                      <div>
                        <label className={lbl2}>Remarks / Note</label>
                        <input className={edCls} value={pay.notes}
                          onChange={e => setPay(f => ({ ...f, notes: e.target.value }))}
                          placeholder="Received in hand" />
                      </div>

                      {/* Checkboxes — create mode only */}
                      {!editingPayment && (
                        <div className="col-span-2 flex items-center justify-end gap-6 text-sm text-[#173d59]">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input className="h-4 w-4 accent-[#1d435d]" type="checkbox" checked={pay.next_billing} onChange={e => setPay(f => ({ ...f, next_billing: e.target.checked }))} />
                            Is it next billing date?
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input className="h-4 w-4 accent-[#1d435d]" type="checkbox" checked={pay.send_sms} onChange={e => setPay(f => ({ ...f, send_sms: e.target.checked }))} />
                            Send SMS
                          </label>
                        </div>
                      )}

                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="shrink-0 flex items-center gap-3 border-t border-gray-200 bg-gray-50 px-6 py-3">
                <button onClick={() => { setReceiveOpen(false); setEditingPayment(null); }}
                  className="h-10 flex-1 rounded-xl border-2 border-gray-300 text-sm font-semibold text-gray-600 transition hover:border-red-400 hover:bg-red-50 hover:text-red-600">
                  Cancel
                </button>
                {client && (
                  <button onClick={submitReceive} disabled={saving}
                    className="h-10 flex-1 rounded-xl bg-[#1d435d] text-sm font-bold text-white shadow-sm transition hover:bg-[#245f84] disabled:opacity-50">
                    {saving ? 'সংরক্ষণ হচ্ছে...' : editingPayment ? '✓ আপডেট করুন' : '✓ Submit Payment'}
                  </button>
                )}
              </div>

            </div>
          </div>
        );
      })()}

      {/* ── Webhook Info Modal ── */}
      {webhookInfoRecord && (
        <WebhookInfoModal
          record={webhookInfoRecord}
          onClose={() => setWebhookInfoRecord(null)}
          onOpenTransfer={r => setWebhookTransferRecord(r)}
        />
      )}

      {/* ── Webhook Transfer Modal ── */}
      {webhookTransferRecord && (
        <WebhookTransferModal
          record={webhookTransferRecord}
          onClose={() => setWebhookTransferRecord(null)}
          onSuccess={loadWebhook}
        />
      )}
    </div>
  );
}
