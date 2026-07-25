import { useEffect, useState } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-700',
  success: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-600',
};

export default function ClientPGWPaymentsPage() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (status) params.append('status', status);
    api.get(`/pop/pgw-payments/?${params}&page_size=500`)
      .then(r => setPayments(r.data.results || r.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [search, status]);

  const settle = async pay => {
    try {
      await api.post(`/pop/pgw-payments/${pay.id}/settle/`);
      toast.success('Settlement হয়েছে');
      load();
    } catch { toast.error('ব্যর্থ'); }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Client PGW Payments</h1>
          <p className="text-sm text-gray-500">Payment Gateway Transaction Records</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border p-4 mb-4 flex gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Client name / Transaction ID..." className="border rounded px-3 py-1.5 text-sm flex-1" />
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm">
          <option value="">All Status</option>
          <option value="pending">Pending</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
        <table className="w-full min-w-[1200px] text-sm">
          <thead>
            <tr className="bg-[#1e3a5f] text-white">
              {['#','Client Code','Client Name','Gateway','Amount','Transaction ID',
                'Receipt No','Processing Fee','Status','Initiated At','Action'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left font-semibold text-xs">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="py-12 text-center text-gray-400">লোড হচ্ছে...</td></tr>
            ) : payments.length === 0 ? (
              <tr><td colSpan={11} className="py-12 text-center text-gray-400">No data available in table</td></tr>
            ) : payments.map((p, i) => (
              <tr key={p.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="px-3 py-2">{i + 1}</td>
                <td className="px-3 py-2 font-mono text-blue-600">{p.client_code}</td>
                <td className="px-3 py-2 font-medium">{p.client_name}</td>
                <td className="px-3 py-2">{p.gateway_name} {p.gateway_type && `(${p.gateway_type})`}</td>
                <td className="px-3 py-2 text-right font-semibold">{Number(p.amount).toFixed(2)}</td>
                <td className="px-3 py-2 font-mono text-xs">{p.transaction_id || '—'}</td>
                <td className="px-3 py-2 font-mono text-xs">{p.money_receipt_no || '—'}</td>
                <td className="px-3 py-2 text-right">{Number(p.processing_fee).toFixed(2)}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[p.status] || ''}`}>
                    {p.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">{p.initiated_at?.slice(0,16).replace('T',' ')}</td>
                <td className="px-3 py-2">
                  {p.status === 'pending' && (
                    <button onClick={() => settle(p)}
                      className="px-2 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600">
                      Settle
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-2 text-sm text-gray-500 border-t">Showing {payments.length} entries</div>
      </div>
    </div>
  );
}
