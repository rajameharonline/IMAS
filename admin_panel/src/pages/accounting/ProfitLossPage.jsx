// Profit Loss — Income, COGS, Gross Profit, Expense, Net Profit।
import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../../utils/api';

const today      = () => new Date().toISOString().slice(0,10);
const firstMonth = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; };
const fmt        = (n) => Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const pct        = (a,b) => b ? `${((a/b)*100).toFixed(0)}%` : '0%';

export default function ProfitLossPage() {
  const [from,    setFrom]    = useState(firstMonth());
  const [to,      setTo]      = useState(today());
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/accounting/daily-accounts/profit-loss/', { params: { from_date: from, to_date: to } });
      setData(r.data);
    } catch { toast.error('লোড ব্যর্থ।'); }
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#173d59] focus:outline-none';
  const dateHeader = from && to ? `${from.split('-').reverse().join('/')} to ${to.split('-').reverse().join('/')}` : '';

  return (
    <div className="p-4 md:p-6 bg-gray-100 min-h-screen">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Profit Loss</h1>
          <p className="text-sm text-gray-500">Accounting Report</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">Accounting Report &gt; Profit Loss Report</span>
          <button className="px-3 py-2 text-xs font-medium bg-[#23445f] text-white rounded-full">Generate PDF</button>
          <button className="px-3 py-2 text-xs font-medium bg-[#23445f] text-white rounded-full">Generate CSV</button>
        </div>
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
          <button onClick={() => { setFrom(firstMonth()); setTo(today()); }}
            className="px-4 py-2.5 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-full transition-all">
            Clear Filters
          </button>
        </div>

        {loading ? <p className="text-center text-gray-400 py-12">Loading…</p>
        : !data ? null
        : (
          <div className="border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full min-w-[500px] text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Account</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">{dateHeader}</th>
                </tr>
              </thead>
              <tbody>
                {/* Income */}
                <tr className="bg-[#23445f]"><td colSpan={2} className="px-4 py-2.5 text-white text-xs font-bold uppercase tracking-wider">Income</td></tr>
                {(data.income_by_category || []).map((r, i) => (
                  <tr key={i} className={i%2===0?'bg-white':'bg-gray-50/50'}>
                    <td className="px-8 py-2.5 text-blue-600">{r.name}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-gray-700">{fmt(r.amount)}</td>
                  </tr>
                ))}
                <tr className="bg-gray-100 font-bold border-t border-gray-300">
                  <td className="px-4 py-3 text-gray-700">Total Income</td>
                  <td className="px-4 py-3 text-right text-[#173d59]">{fmt(data.total_income)}</td>
                </tr>

                {/* Cost of Goods Sold */}
                <tr className="bg-[#23445f]"><td colSpan={2} className="px-4 py-2.5 text-white text-xs font-bold uppercase tracking-wider">Cost of Goods Sold</td></tr>
                <tr className="bg-gray-100 font-bold">
                  <td className="px-4 py-3 text-gray-700">Total Cost of Goods Sold</td>
                  <td className="px-4 py-3 text-right text-gray-700">0</td>
                </tr>

                {/* Gross Profit */}
                <tr className="bg-blue-50 font-bold border-t border-blue-200">
                  <td className="px-4 py-3 text-gray-800">
                    Gross Profit
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      As a percentage of Total Income — {pct(data.total_income, data.total_income)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-[#173d59] font-bold">{fmt(data.total_income)}</td>
                </tr>

                {/* Expense */}
                <tr className="bg-[#23445f]"><td colSpan={2} className="px-4 py-2.5 text-white text-xs font-bold uppercase tracking-wider">Expense</td></tr>
                {(data.expense_by_category || []).map((r, i) => (
                  <tr key={i} className={i%2===0?'bg-white':'bg-gray-50/50'}>
                    <td className="px-8 py-2.5 text-blue-600">{r.name}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-gray-700">{fmt(r.amount)}</td>
                  </tr>
                ))}
                <tr className="bg-gray-100 font-bold border-t border-gray-300">
                  <td className="px-4 py-3 text-gray-700">Total Expense</td>
                  <td className="px-4 py-3 text-right text-rose-700">{fmt(data.total_expense)}</td>
                </tr>

                {/* Net Profit */}
                <tr className="bg-blue-50 font-bold border-t-2 border-blue-300">
                  <td className="px-4 py-3 text-gray-800">
                    Net Profit
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      As a percentage of Total Income — {pct(data.net_profit, data.total_income)}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-right font-bold text-lg ${data.net_profit < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                    {fmt(data.net_profit)}
                  </td>
                </tr>
              </tbody>
            </table>

            <p className="px-4 py-3 text-xs text-gray-500 border-t border-gray-200 bg-gray-50">
              ℹ Asset, Liabilities and Owner's Equity are not shown on the Profit Loss. Go to{' '}
              <a href="/accounting/balance-sheet" className="text-blue-600 hover:underline">Balance Sheet</a> to view them.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
