import { useEffect, useState } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

/* ── Fund Transaction Modal (স্ক্রিনশট: "Fund Transaction") ── */
function FundModal({ pops, employees, onClose, onSaved }) {
  const [form, setForm] = useState({
    pop: '', fund_amount: '', received_amount: '', discount: '',
    invoice_number: '', received_by: '',
    received_date: new Date().toISOString().slice(0, 10),
    remarks: '', payment_by: 'cash', trans_status: 'pending',
  });
  const [saving, setSaving] = useState(false);
  const set = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const save = async e => {
    e.preventDefault();
    if (!form.pop || !form.fund_amount) return toast.error('Reseller ও Funding Amount দিন');
    if (!form.received_amount) return toast.error('Received Amount দিন');
    setSaving(true);
    try {
      await api.post('/pop/fundings/', {
        pop: form.pop, fund_amount: form.fund_amount,
        received_amount: form.received_amount, discount: form.discount || 0,
        received_by: form.received_by || null,
        received_date: form.received_date, remarks: form.remarks,
        payment_by: form.payment_by, trans_status: form.trans_status,
      });
      toast.success('ফান্ড যোগ হয়েছে');
      onSaved();
    } catch { toast.error('সংরক্ষণ ব্যর্থ'); }
    finally { setSaving(false); }
  };

  const Lbl = ({ children, req }) => (
    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
      {children}{req && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h2 className="text-lg font-bold text-gray-800">Fund Transaction</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={save} className="p-6 space-y-4 overflow-y-auto">
          <div>
            <Lbl req>RESELLER NAME</Lbl>
            <select name="pop" value={form.pop} onChange={set} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">Select MACReseller</option>
              {pops.map(p => <option key={p.id} value={p.id}>{p.code} — {p.business_name}</option>)}
            </select>
          </div>
          <div><Lbl req>FUNDING AMOUNT</Lbl>
            <input name="fund_amount" type="number" value={form.fund_amount} onChange={set} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div><Lbl req>RECEIVED AMOUNT</Lbl>
            <input name="received_amount" type="number" value={form.received_amount} onChange={set} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div><Lbl>DISCOUNT</Lbl>
            <input name="discount" type="number" value={form.discount} onChange={set} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div><Lbl>INVOICE NUMBER</Lbl>
            <input name="invoice_number" value={form.invoice_number} onChange={set} placeholder="Auto-generated"
              className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50" disabled />
          </div>
          <div><Lbl req>RECEIVED BY</Lbl>
            <select name="received_by" value={form.received_by} onChange={set} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">Select Employee</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name || e.full_name || e.username}</option>)}
            </select>
          </div>
          <div><Lbl>RECEIVED DATE</Lbl>
            <input name="received_date" type="date" value={form.received_date} onChange={set} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div><Lbl>REMARKS</Lbl>
            <textarea name="remarks" value={form.remarks} onChange={set} rows={2} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex items-center justify-between pt-2">
            <button type="button" onClick={onClose}
              className="px-6 py-2 border-2 border-red-400 text-red-500 rounded-full text-sm font-semibold hover:bg-red-50">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 px-6 py-2 border-2 border-gray-300 text-gray-700 rounded-full text-sm font-semibold hover:bg-gray-100 disabled:opacity-60">
              <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-700',
  partial: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function POPFundingPage() {
  const [tab, setTab] = useState('fund');           // fund | history
  const [fundings, setFundings] = useState([]);
  const [history, setHistory]   = useState([]);
  const [pops, setPops]         = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [filters, setFilters] = useState({ pop: '', status: '', from_date: '', to_date: '' });

  const load = () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (filters.pop) p.append('pop', filters.pop);
    if (filters.status) p.append('status', filters.status);
    if (filters.from_date) p.append('from_date', filters.from_date);
    if (filters.to_date) p.append('to_date', filters.to_date);
    Promise.all([
      api.get(`/pop/fundings/?${p}&page_size=500`),
      api.get('/pop/fund-transactions/?page_size=500'),
      api.get('/pop/pops/?page_size=500'),
      api.get('/hr/employees/?page_size=500').catch(() => ({ data: [] })),
    ]).then(([f, t, pp, e]) => {
      setFundings(f.data.results || f.data);
      setHistory(t.data.results || t.data);
      setPops(pp.data.results || pp.data);
      setEmployees(e.data.results || e.data || []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [filters]);

  const setFilter = e => setFilters(f => ({ ...f, [e.target.name]: e.target.value }));

  const totals = fundings.reduce((a, f) => ({
    fund: a.fund + Number(f.fund_amount || 0),
    paid: a.paid + Number(f.received_amount || 0),
    fee: a.fee + Number(f.p_processing_fee || 0),
    vat: a.vat + Number(f.vat || 0),
    disc: a.disc + Number(f.discount || 0),
    due: a.due + Number(f.due_amount || 0),
  }), { fund: 0, paid: 0, fee: 0, vat: 0, disc: 0, due: 0 });

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <span>Mac Reseller</span><span>&gt;</span><span>Reseller Funding</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">🚀 MAC Reseller Funding</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="px-4 py-2 bg-[#1e3a5f] text-white rounded-full text-xs font-semibold hover:opacity-90">📄 Download PDF</button>
          <button className="px-4 py-2 bg-[#1e3a5f] text-white rounded-full text-xs font-semibold hover:opacity-90">📄 Download Excel</button>
          <button onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-gray-800 text-white rounded-full text-xs font-semibold hover:bg-black">+ Give Fund</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button onClick={() => setTab('fund')}
          className={`px-4 py-2 rounded-full text-sm font-semibold ${tab === 'fund' ? 'bg-[#1e3a5f] text-white' : 'bg-white border text-gray-600'}`}>
          ☰ MACReseller Fund
        </button>
        <button onClick={() => setTab('history')}
          className={`px-4 py-2 rounded-full text-sm font-semibold ${tab === 'history' ? 'bg-[#1e3a5f] text-white' : 'bg-white border text-gray-600'}`}>
          ☰ MACReseller Fund History
        </button>
      </div>

      {tab === 'fund' && (
        <button className="mb-4 px-4 py-2 bg-[#1e3a5f] text-white rounded-full text-xs font-semibold hover:opacity-90">
          ⊘ BulkOnlineFundRechargeRestriction(Block/Unblock)
        </button>
      )}

      <div className="bg-white rounded-xl shadow-sm border p-4">
        {/* Filters */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">MAC Resellers</label>
            <select name="pop" value={filters.pop} onChange={setFilter} className="w-full border rounded-lg px-2 py-1.5 text-sm">
              <option value="">Select MACReseller</option>
              {pops.map(p => <option key={p.id} value={p.id}>{p.code} — {p.business_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Transaction Status</label>
            <select name="status" value={filters.status} onChange={setFilter} className="w-full border rounded-lg px-2 py-1.5 text-sm">
              <option value="">Select</option>
              <option value="pending">Pending</option>
              <option value="partial">Partial</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">From Date</label>
            <input type="date" name="from_date" value={filters.from_date} onChange={setFilter} className="w-full border rounded-lg px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">To Date</label>
            <input type="date" name="to_date" value={filters.to_date} onChange={setFilter} className="w-full border rounded-lg px-2 py-1.5 text-sm" />
          </div>
        </div>

        {/* Show/Search */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 text-sm text-gray-600">
          <div className="flex items-center gap-2"><span>SHOW</span><select className="border rounded px-2 py-1"><option>25</option></select><span>ENTRIES</span></div>
          <div className="flex items-center gap-2"><span>SEARCH:</span><input className="border rounded px-2 py-1 w-44" /></div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto border rounded-lg">
          {tab === 'fund' ? (
            <table className="w-full text-xs whitespace-nowrap">
              <thead>
                <tr className="bg-[#1e3a5f] text-white">
                  {['☐','ResellerName','InvoiceNumber','FundAmount','Payment','P.Processing Fee','Vat','Discount','DueAmount','FundingDate','FundGivenBy','ReceivedDate(Last)','ReceivedBy(Last)','Remarks','Trans.Status','RestrictOnlinePayment','Action'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={17} className="py-10 text-center text-gray-400">লোড হচ্ছে...</td></tr>
                ) : fundings.length === 0 ? (
                  <tr><td colSpan={17} className="py-10 text-center text-gray-400">No data available in table</td></tr>
                ) : fundings.map((f, i) => (
                  <tr key={f.id} className={i % 2 ? 'bg-gray-50' : 'bg-white'}>
                    <td className="px-3 py-2"><input type="checkbox" /></td>
                    <td className="px-3 py-2 font-medium">{f.pop_name}</td>
                    <td className="px-3 py-2 font-mono text-blue-600">{f.invoice_number}</td>
                    <td className="px-3 py-2 text-right">{Number(f.fund_amount).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{Number(f.received_amount).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{Number(f.p_processing_fee).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{Number(f.vat).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{Number(f.discount).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{Number(f.due_amount).toFixed(2)}</td>
                    <td className="px-3 py-2">{f.funding_date}</td>
                    <td className="px-3 py-2">{f.fund_given_name}</td>
                    <td className="px-3 py-2">{f.received_date}</td>
                    <td className="px-3 py-2">{f.received_by_name}</td>
                    <td className="px-3 py-2">{f.remarks}</td>
                    <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[f.trans_status] || ''}`}>{f.trans_status}</span></td>
                    <td className="px-3 py-2">{f.restrict_online_payment ? 'Blocked' : 'Allowed'}</td>
                    <td className="px-3 py-2"><button className="w-6 h-6 bg-blue-500 text-white rounded text-xs">+</button></td>
                  </tr>
                ))}
                {/* Total row */}
                <tr className="bg-gray-100 font-semibold">
                  <td className="px-3 py-2" colSpan={3}>Total</td>
                  <td className="px-3 py-2 text-right">{totals.fund.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{totals.paid.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{totals.fee.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{totals.vat.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{totals.disc.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{totals.due.toFixed(2)}</td>
                  <td className="px-3 py-2" colSpan={8}></td>
                </tr>
              </tbody>
            </table>
          ) : (
            <table className="w-full text-xs whitespace-nowrap">
              <thead>
                <tr className="bg-[#1e3a5f] text-white">
                  {['ResellerName','InvoiceNumber','ReceiptNumber','Trans.Type','Fund(+)','Refund(-)','Paid','P.Processing Fee','Vat','Discount','Due','Remarks','ReceivedOn','ReceivedBy','CreatedOn','CreatedBy','Action'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={17} className="py-10 text-center text-gray-400">লোড হচ্ছে...</td></tr>
                ) : history.length === 0 ? (
                  <tr><td colSpan={17} className="py-10 text-center text-gray-400">No data available in table</td></tr>
                ) : history.map((t, i) => (
                  <tr key={t.id} className={i % 2 ? 'bg-gray-50' : 'bg-white'}>
                    <td className="px-3 py-2">{t.funding}</td>
                    <td className="px-3 py-2 font-mono text-blue-600">{t.invoice_number || '—'}</td>
                    <td className="px-3 py-2 font-mono">{t.receipt_number}</td>
                    <td className="px-3 py-2">{t.trans_type}</td>
                    <td className="px-3 py-2 text-right">{Number(t.fund_amount).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{Number(t.refund_amount).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{Number(t.paid_amount).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{Number(t.p_processing_fee).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{Number(t.vat).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{Number(t.discount).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{Number(t.due).toFixed(2)}</td>
                    <td className="px-3 py-2">{t.remarks}</td>
                    <td className="px-3 py-2">{t.received_on}</td>
                    <td className="px-3 py-2">{t.received_by_name}</td>
                    <td className="px-3 py-2">{t.created_at?.slice(0,10)}</td>
                    <td className="px-3 py-2">{t.created_by_name}</td>
                    <td className="px-3 py-2"><button className="w-6 h-6 bg-blue-500 text-white rounded text-xs">✎</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="mt-2 text-sm text-gray-500">
          Showing {(tab === 'fund' ? fundings : history).length} entries
        </div>
      </div>

      {showModal && (
        <FundModal pops={pops} employees={employees}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); }} />
      )}
    </div>
  );
}
