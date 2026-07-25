// Cash Book — Debit (incoming) ও Credit (outgoing) দুই কলাম।
import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../../utils/api';

const today      = () => new Date().toISOString().slice(0,10);
const firstMonth = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; };
const lastDay    = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-30`; };
const fmt        = (n) => Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

export default function CashBookPage() {
  const [from,    setFrom]    = useState(firstMonth());
  const [to,      setTo]      = useState(lastDay());
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/accounting/cash-book/', { params: { from_date: from, to_date: to } });
      setData(r.data);
    } catch { toast.error('লোড ব্যর্থ।'); }
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#173d59] focus:outline-none';

  const debitRows = data ? [
    { label: 'Collected Bill',      value: data.debit?.collected_bill },
    { label: 'Installation Charge', value: data.debit?.installation_charge },
    { label: 'Other Service Sales', value: data.debit?.other_service_sales },
    { label: 'Product Sales',       value: data.debit?.product_sales },
    { label: 'Income',              value: data.debit?.income },
  ] : [];

  const creditRows = data ? [
    { label: 'Paid Salary',          value: data.credit?.paid_salary },
    { label: 'Expense',              value: data.credit?.expense },
    { label: 'Bandwidth Provider Bill', value: data.credit?.bandwidth_provider },
    { label: 'Purchase Paid Amount', value: data.credit?.purchase_paid },
  ] : [];

  const maxRows = Math.max(debitRows.length, creditRows.length);

  return (
    <div className="p-4 md:p-6 bg-gray-100 min-h-screen">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Cash Book</h1>
          <p className="text-sm text-gray-500">Cash Book</p>
        </div>
        <span className="text-xs text-gray-400">Accounts &gt; Cash Book</span>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">From Date</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inp} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">To Date</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inp} />
          </div>
        </div>
        <div className="flex gap-3 mb-6">
          <button onClick={fetchData}
            className="px-4 py-2.5 text-sm font-medium bg-[#173d59] hover:bg-[#1f5075] text-white rounded-full transition-all">
            Update Report
          </button>
          <button onClick={() => { setFrom(firstMonth()); setTo(lastDay()); }}
            className="px-4 py-2.5 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-full transition-all">
            Clear Filters
          </button>
        </div>

        {loading ? <p className="text-center text-gray-400 py-12">Loading…</p>
        : !data ? null
        : (
          <>
            <div className="border border-gray-200 rounded-xl overflow-x-auto mb-4">
              <table className="w-full min-w-[600px] text-sm">
                <thead>
                  <tr>
                    <th colSpan={2} className="px-4 py-3 text-[#23445f] text-sm font-bold text-center bg-gray-50 border-r border-gray-200">Debit</th>
                    <th colSpan={2} className="px-4 py-3 text-[#23445f] text-sm font-bold text-center bg-gray-50">Credit</th>
                  </tr>
                  <tr className="bg-[#23445f]">
                    <th className="px-4 py-3 text-white text-xs font-semibold uppercase tracking-wider text-left">Particular</th>
                    <th className="px-4 py-3 text-white text-xs font-semibold uppercase tracking-wider text-right border-r border-white/20">Taka</th>
                    <th className="px-4 py-3 text-white text-xs font-semibold uppercase tracking-wider text-left">Particular</th>
                    <th className="px-4 py-3 text-white text-xs font-semibold uppercase tracking-wider text-right">Taka</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {Array.from({ length: maxRows }, (_, i) => {
                    const dr = debitRows[i];
                    const cr = creditRows[i];
                    return (
                      <tr key={i} className={i%2===0?'bg-white':'bg-gray-50/50'}>
                        <td className="px-4 py-3 text-gray-700">{dr?.label || ''}</td>
                        <td className="px-4 py-3 text-right font-medium text-emerald-700 border-r border-gray-200">
                          {dr ? fmt(dr.value) : ''}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{cr?.label || ''}</td>
                        <td className="px-4 py-3 text-right font-medium text-rose-700">
                          {cr ? fmt(cr.value) : ''}
                        </td>
                      </tr>
                    );
                  })}
                  {/* Total row */}
                  <tr className="bg-gray-100 font-bold border-t-2 border-gray-300">
                    <td className="px-4 py-3 text-gray-700">Total</td>
                    <td className="px-4 py-3 text-right text-emerald-700 border-r border-gray-200">{fmt(data.debit?.total)}</td>
                    <td className="px-4 py-3 text-gray-700">Total</td>
                    <td className="px-4 py-3 text-right text-rose-700">{fmt(data.credit?.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Cash on Hand footer */}
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <tbody>
                  <tr className="bg-[#23445f]">
                    <td className="px-4 py-3 text-white font-bold text-center">Cash on Hand</td>
                    <td className="px-4 py-3 text-white font-bold text-center text-xl">
                      {fmt(data.cash_on_hand)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
