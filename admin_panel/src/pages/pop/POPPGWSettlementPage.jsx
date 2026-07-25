import { useEffect, useState } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-700',
  settled: 'bg-green-100 text-green-700',
  partial: 'bg-blue-100 text-blue-700',
};

/* ── Settlement Modal ── */
function SettlementModal({ pops, onClose, onSaved }) {
  const [form, setForm] = useState({ pop: '', amount: '', remarks: '', status: 'pending' });
  const [saving, setSaving] = useState(false);
  const set = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const save = async e => {
    e.preventDefault();
    if (!form.pop || !form.amount) return toast.error('POP ও পরিমাণ দিন');
    setSaving(true);
    try {
      await api.post('/pop/pgw-settlements/', form);
      toast.success('Settlement entry যোগ হয়েছে');
      onSaved();
    } catch { toast.error('সংরক্ষণ ব্যর্থ'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-800">Add PGW Settlement</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={save} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">POP <span className="text-red-500">*</span></label>
            <select name="pop" value={form.pop} onChange={set} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">Select POP</option>
              {pops.map(p => <option key={p.id} value={p.id}>{p.code} — {p.business_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">AMOUNT <span className="text-red-500">*</span></label>
            <input name="amount" type="number" step="0.01" value={form.amount} onChange={set} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="0.00" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">STATUS</label>
            <select name="status" value={form.status} onChange={set} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="pending">Pending</option>
              <option value="partial">Partial</option>
              <option value="settled">Settled</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">REMARKS</label>
            <textarea name="remarks" value={form.remarks} onChange={set} rows={2} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">{saving ? 'Saving...' : 'Save'}</button>
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-300">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

const TodayStr = new Date().toISOString().slice(0, 10);

export default function POPPGWSettlementPage() {
  const [tab, setTab] = useState('pgw');   // pgw | history | transactions
  const [pops, setPops] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [from, setFrom] = useState(TodayStr);
  const [to, setTo] = useState(TodayStr);
  const [popFilter, setPopFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/pop/pops/?page_size=500'),
      api.get('/pop/pgw-settlements/?page_size=500'),
      api.get('/pop/pgw-payments/?page_size=500').catch(() => ({ data: [] })),
    ]).then(([p, s, pay]) => {
      setPops(p.data.results || p.data);
      setSettlements(s.data.results || s.data);
      setPayments(pay.data.results || pay.data || []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const markSettled = async id => {
    try {
      await api.post(`/pop/pgw-settlements/${id}/mark-settled/`);
      toast.success('Settled হিসেবে চিহ্নিত হয়েছে');
      load();
    } catch { toast.error('ব্যর্থ হয়েছে'); }
  };

  const popsFiltered = pops.filter(p =>
    (!typeFilter || p.pop_type === typeFilter) &&
    (!statusFilter || (statusFilter === 'active' ? p.is_active : !p.is_active))
  );

  const TabBtn = ({ id, icon, label }) => (
    <button onClick={() => setTab(id)}
      className={`px-4 py-2 rounded-full text-sm font-semibold ${tab === id ? 'bg-[#1e3a5f] text-white' : 'bg-white border text-gray-600'}`}>
      {icon} {label}
    </button>
  );

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <span>POP</span><span>&gt;</span><span>POP List</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">POPs <span className="text-sm font-normal text-gray-400">All POPs</span></h1>
        </div>
        {tab === 'history' && (
          <button onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-gray-800 text-white rounded-full text-sm font-semibold hover:bg-black">+ Add Settlement</button>
        )}
        {tab === 'transactions' && (
          <div className="flex flex-wrap gap-2">
            <button className="px-4 py-2 bg-white border rounded-full text-xs font-semibold text-gray-600">Generate CSV</button>
            <button className="px-4 py-2 bg-white border rounded-full text-xs font-semibold text-gray-600">Generate PDF</button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <TabBtn id="pgw" icon="☰" label="POP PGW Transactions" />
          <TabBtn id="history" icon="☰" label="Transaction Settlement History" />
          <TabBtn id="transactions" icon="☰" label="POP Transactions" />
        </div>

        {/* ── Tab 1: POP PGW Transactions ── */}
        {tab === 'pgw' && (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">POP Status</label>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm">
                  <option value="">Select</option><option value="active">Active</option><option value="inactive">Inactive</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">POP Type</label>
                <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm">
                  <option value="">Select</option><option value="prepaid">Prepaid</option><option value="postpaid">Postpaid</option>
                </select>
              </div>
            </div>
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-xs whitespace-nowrap">
                <thead>
                  <tr className="bg-[#1e3a5f] text-white">
                    {['Code','POP Name','POP Type','Mobile','Total Received Amount','Settled Amount','Remaining Amount','Payment Status'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={8} className="py-10 text-center text-gray-400">লোড হচ্ছে...</td></tr>
                  ) : popsFiltered.length === 0 ? (
                    <tr><td colSpan={8} className="py-10 text-center text-gray-400">No data available in table</td></tr>
                  ) : popsFiltered.map((p, i) => (
                    <tr key={p.id} className={i % 2 ? 'bg-gray-50' : 'bg-white'}>
                      <td className="px-3 py-2 font-mono font-bold text-blue-700">{p.code}</td>
                      <td className="px-3 py-2">{p.business_name}</td>
                      <td className="px-3 py-2">{p.pop_type === 'prepaid' ? 'Prepaid' : 'Postpaid'}</td>
                      <td className="px-3 py-2">{p.mobile}</td>
                      <td className="px-3 py-2 text-right">0.00</td>
                      <td className="px-3 py-2 text-right">0.00</td>
                      <td className="px-3 py-2 text-right">0.00</td>
                      <td className="px-3 py-2">—</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-100 font-semibold">
                    <td className="px-3 py-2" colSpan={4}>Total</td>
                    <td className="px-3 py-2 text-right">0.00</td>
                    <td className="px-3 py-2 text-right">0.00</td>
                    <td className="px-3 py-2 text-right">0.00</td>
                    <td className="px-3 py-2"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── Tab 2: Transaction Settlement History ── */}
        {tab === 'history' && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div><label className="block text-xs font-semibold text-gray-500 uppercase mb-1">From Date</label>
                <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm" /></div>
              <div><label className="block text-xs font-semibold text-gray-500 uppercase mb-1">To Date</label>
                <input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm" /></div>
              <div><label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Payment Settlement Status</label>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm">
                  <option value="">Select</option><option value="pending">Pending</option><option value="partial">Partial</option><option value="settled">Settled</option>
                </select></div>
              <div><label className="block text-xs font-semibold text-gray-500 uppercase mb-1">POPs</label>
                <select value={popFilter} onChange={e => setPopFilter(e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm">
                  <option value="">Select POP</option>
                  {pops.map(p => <option key={p.id} value={p.id}>{p.code} — {p.business_name}</option>)}
                </select></div>
            </div>
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-xs whitespace-nowrap">
                <thead>
                  <tr className="bg-[#1e3a5f] text-white">
                    {['POP Code','POPName','Amount','Invoice Number','Remarks','CreatedBy','CreatedOn','Status','Action'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const rows = settlements.filter(s =>
                      (!popFilter || String(s.pop) === popFilter) &&
                      (!statusFilter || s.status === statusFilter)
                    );
                    if (loading) return <tr><td colSpan={9} className="py-10 text-center text-gray-400">লোড হচ্ছে...</td></tr>;
                    if (rows.length === 0) return <tr><td colSpan={9} className="py-10 text-center text-gray-400">No data available in table</td></tr>;
                    return rows.map((s, i) => (
                      <tr key={s.id} className={i % 2 ? 'bg-gray-50' : 'bg-white'}>
                        <td className="px-3 py-2 font-mono text-blue-700">{s.pop_code || '—'}</td>
                        <td className="px-3 py-2">{s.pop_name}</td>
                        <td className="px-3 py-2 text-right font-semibold">{Number(s.amount).toFixed(2)}</td>
                        <td className="px-3 py-2 font-mono text-blue-600">{s.invoice_number}</td>
                        <td className="px-3 py-2">{s.remarks || '—'}</td>
                        <td className="px-3 py-2">{s.created_by_name}</td>
                        <td className="px-3 py-2">{s.created_at?.slice(0, 10)}</td>
                        <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[s.status] || ''}`}>{s.status}</span></td>
                        <td className="px-3 py-2">{s.status !== 'settled' && (
                          <button onClick={() => markSettled(s.id)} className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-semibold hover:bg-green-200">Mark Settled</button>
                        )}</td>
                      </tr>
                    ));
                  })()}
                  <tr className="bg-gray-100 font-semibold">
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2 text-right">{settlements.reduce((a, s) => a + Number(s.amount || 0), 0).toFixed(2)}</td>
                    <td className="px-3 py-2" colSpan={6}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── Tab 3: POP Transactions ── */}
        {tab === 'transactions' && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
              <div><label className="block text-xs font-semibold text-gray-500 uppercase mb-1">From Date</label>
                <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm" /></div>
              <div><label className="block text-xs font-semibold text-gray-500 uppercase mb-1">To Date</label>
                <input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm" /></div>
              <div><label className="block text-xs font-semibold text-gray-500 uppercase mb-1">POPs</label>
                <select value={popFilter} onChange={e => setPopFilter(e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm">
                  <option value="">Select POP</option>
                  {pops.map(p => <option key={p.id} value={p.id}>{p.code} — {p.business_name}</option>)}
                </select></div>
            </div>
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-xs whitespace-nowrap">
                <thead>
                  <tr className="bg-[#1e3a5f] text-white">
                    {['POP','ClientCode','Paid Amount','Settled Fund Amount','Remaining Amount','PaymentMethod','Remarks','CreatedBy','CreatedOn'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const rows = payments.filter(p => !popFilter || String(p.pop) === popFilter);
                    if (loading) return <tr><td colSpan={9} className="py-10 text-center text-gray-400">লোড হচ্ছে...</td></tr>;
                    if (rows.length === 0) return <tr><td colSpan={9} className="py-10 text-center text-gray-400">No data available in table</td></tr>;
                    return rows.map((p, i) => (
                      <tr key={p.id} className={i % 2 ? 'bg-gray-50' : 'bg-white'}>
                        <td className="px-3 py-2">{p.pop_name}</td>
                        <td className="px-3 py-2">{p.client_code}</td>
                        <td className="px-3 py-2 text-right">{Number(p.amount).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">0.00</td>
                        <td className="px-3 py-2 text-right">{Number(p.amount).toFixed(2)}</td>
                        <td className="px-3 py-2">{p.gateway_name}</td>
                        <td className="px-3 py-2">—</td>
                        <td className="px-3 py-2">{p.received_by_name}</td>
                        <td className="px-3 py-2">{p.initiated_at?.slice(0, 10)}</td>
                      </tr>
                    ));
                  })()}
                  <tr className="bg-gray-100 font-semibold">
                    <td className="px-3 py-2" colSpan={2}>Total</td>
                    <td className="px-3 py-2 text-right">{payments.reduce((a, p) => a + Number(p.amount || 0), 0).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">0.00</td>
                    <td className="px-3 py-2 text-right">{payments.reduce((a, p) => a + Number(p.amount || 0), 0).toFixed(2)}</td>
                    <td className="px-3 py-2" colSpan={4}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showModal && (
        <SettlementModal pops={pops} onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); load(); }} />
      )}
    </div>
  );
}
