// Compare Profit Loss — দুটো date range-এর P&L তুলনা।
import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../../utils/api';

const today      = () => new Date().toISOString().slice(0,10);
const firstMonth = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; };
const lastYear   = () => { const d=new Date(); return `${d.getFullYear()-1}-${String(d.getMonth()+1).padStart(2,'0')}-01`; };
const lastYearTo = () => { const d=new Date(); return `${d.getFullYear()-1}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const fmt        = (n) => Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

export default function CompareProfitLossPage() {
  const [from,    setFrom]    = useState(firstMonth());
  const [to,      setTo]      = useState(today());
  const [cFrom,   setCFrom]   = useState(lastYear());
  const [cTo,     setCTo]     = useState(lastYearTo());
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/accounting/compare-profit-loss/', {
        params: { from_date: from, to_date: to, compare_from_date: cFrom, compare_to_date: cTo },
      });
      setData(r.data);
    } catch { toast.error('লোড ব্যর্থ।'); }
    finally { setLoading(false); }
  }, [from, to, cFrom, cTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#173d59] focus:outline-none';

  const changeColor = (v) => v >= 0 ? 'text-emerald-700' : 'text-rose-600';

  return (
    <div className="p-4 md:p-6 bg-gray-100 min-h-screen">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Compare Profit Loss</h1>
          <p className="text-sm text-gray-500">Accounting Report</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">Accounting Report &gt; Compare Profit Loss</span>
          <button className="px-3 py-2 text-xs font-medium bg-[#23445f] text-white rounded-full">Generate PDF</button>
          <button className="px-3 py-2 text-xs font-medium bg-[#23445f] text-white rounded-full">Generate CSV</button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">From Date</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inp} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">To Date</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inp} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Compare From Date</label>
            <input type="date" value={cFrom} onChange={e => setCFrom(e.target.value)} className={inp} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Compare To Date</label>
            <input type="date" value={cTo} onChange={e => setCTo(e.target.value)} className={inp} />
          </div>
        </div>
        <div className="flex gap-3 mb-6">
          <button onClick={fetchData}
            className="px-4 py-2.5 text-sm font-medium bg-[#173d59] hover:bg-[#1f5075] text-white rounded-full transition-all">
            Update Report
          </button>
          <button onClick={() => { setFrom(firstMonth()); setTo(today()); setCFrom(lastYear()); setCTo(lastYearTo()); }}
            className="px-4 py-2.5 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-full transition-all">
            Clear Filters
          </button>
        </div>

        {loading ? <p className="text-center text-gray-400 py-12">Loading…</p>
        : !data ? null
        : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
                <p className="text-xs text-gray-500 mb-1">Net Profit For Date</p>
                <p className="text-2xl font-bold text-[#173d59]">{fmt(data.current?.net_profit)}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {data.current?.total_income > 0
                    ? `${((data.current.net_profit / data.current.total_income) * 100).toFixed(2)}% of Total Income`
                    : '0% of Total Income'}
                </p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
                <p className="text-xs text-gray-500 mb-1">Net Profit For Compare Date</p>
                <p className="text-2xl font-bold text-[#173d59]">{fmt(data.compare?.net_profit)}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {data.compare?.total_income > 0
                    ? `${((data.compare.net_profit / data.compare.total_income) * 100).toFixed(2)}% of Total Income`
                    : '0% of Total Income'}
                </p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
                <p className="text-xs text-gray-500 mb-1">Change In Net Profit</p>
                <p className={`text-2xl font-bold ${changeColor(data.profit_change)}`}>
                  {data.profit_change >= 0 ? '+' : ''}{fmt(data.profit_change)}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  An increase of {data.profit_change_pct >= 0 ? '+' : ''}{data.profit_change_pct?.toFixed(2)}%
                </p>
              </div>
            </div>

            {/* Detail table */}
            <div className="border border-gray-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Account</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                      {data.current?.from_date} to {data.current?.to_date}
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                      {data.compare?.from_date} to {data.compare?.to_date}
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Income */}
                  <tr className="bg-[#23445f]"><td colSpan={4} className="px-4 py-2.5 text-white text-xs font-bold uppercase tracking-wider">Income</td></tr>
                  {(data.income_rows || []).map((r, i) => (
                    <tr key={i} className={i%2===0?'bg-white':'bg-gray-50/50'}>
                      <td className="px-8 py-2.5 text-blue-600">{r.name}</td>
                      <td className="px-4 py-2.5 text-right">{fmt(r.current)}</td>
                      <td className="px-4 py-2.5 text-right">{fmt(r.compare)}</td>
                      <td className={`px-4 py-2.5 text-right font-semibold ${changeColor(r.change)}`}>
                        {r.change >= 0 ? '+' : ''}{fmt(r.change)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-100 font-bold border-t border-gray-300">
                    <td className="px-4 py-3">Total Income</td>
                    <td className="px-4 py-3 text-right text-[#173d59]">{fmt(data.current?.total_income)}</td>
                    <td className="px-4 py-3 text-right text-[#173d59]">{fmt(data.compare?.total_income)}</td>
                    <td className={`px-4 py-3 text-right font-bold ${changeColor(data.current?.total_income - data.compare?.total_income)}`}>
                      {fmt(data.current?.total_income - data.compare?.total_income)}
                    </td>
                  </tr>

                  {/* Cost of Goods Sold */}
                  <tr className="bg-[#23445f]"><td colSpan={4} className="px-4 py-2.5 text-white text-xs font-bold uppercase tracking-wider">Cost of Goods Sold</td></tr>
                  <tr className="bg-gray-100 font-bold">
                    <td className="px-4 py-3">Total Cost of Goods Sold</td>
                    <td className="px-4 py-3 text-right">0.00</td>
                    <td className="px-4 py-3 text-right">0.00</td>
                    <td className="px-4 py-3 text-right">0.00%</td>
                  </tr>

                  {/* Gross Profit */}
                  <tr className="bg-blue-50 font-bold">
                    <td className="px-4 py-3">Gross Profit</td>
                    <td className="px-4 py-3 text-right text-[#173d59]">{fmt(data.current?.total_income)}</td>
                    <td className="px-4 py-3 text-right text-[#173d59]">{fmt(data.compare?.total_income)}</td>
                    <td className={`px-4 py-3 text-right ${changeColor(data.current?.total_income - data.compare?.total_income)}`}>
                      {fmt(data.current?.total_income - data.compare?.total_income)}
                    </td>
                  </tr>

                  {/* Expense */}
                  <tr className="bg-[#23445f]"><td colSpan={4} className="px-4 py-2.5 text-white text-xs font-bold uppercase tracking-wider">Expense</td></tr>
                  {(data.expense_rows || []).map((r, i) => (
                    <tr key={i} className={i%2===0?'bg-white':'bg-gray-50/50'}>
                      <td className="px-8 py-2.5 text-blue-600">{r.name}</td>
                      <td className="px-4 py-2.5 text-right">{fmt(r.current)}</td>
                      <td className="px-4 py-2.5 text-right">{fmt(r.compare)}</td>
                      <td className={`px-4 py-2.5 text-right font-semibold ${changeColor(-r.change)}`}>
                        {r.change >= 0 ? '+' : ''}{fmt(r.change)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-100 font-bold border-t border-gray-300">
                    <td className="px-4 py-3">Total Expense</td>
                    <td className="px-4 py-3 text-right text-rose-700">{fmt(data.current?.total_expense)}</td>
                    <td className="px-4 py-3 text-right text-rose-700">{fmt(data.compare?.total_expense)}</td>
                    <td className={`px-4 py-3 text-right font-bold ${changeColor(data.compare?.total_expense - data.current?.total_expense)}`}>
                      {fmt(data.current?.total_expense - data.compare?.total_expense)}
                    </td>
                  </tr>

                  {/* Net Profit */}
                  <tr className="bg-blue-50 font-bold border-t-2 border-blue-300">
                    <td className="px-4 py-3 text-gray-800">Net Profit</td>
                    <td className={`px-4 py-3 text-right text-lg ${data.current?.net_profit < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                      {fmt(data.current?.net_profit)}
                    </td>
                    <td className={`px-4 py-3 text-right text-lg ${data.compare?.net_profit < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                      {fmt(data.compare?.net_profit)}
                    </td>
                    <td className={`px-4 py-3 text-right text-lg font-bold ${changeColor(data.profit_change)}`}>
                      {data.profit_change >= 0 ? '+' : ''}{fmt(data.profit_change)}
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
