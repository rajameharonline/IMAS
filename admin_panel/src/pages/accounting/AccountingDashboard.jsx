// Accounting Dashboard — Income, Expense, Profit, Receivables, Cash on Hand।
// Date range filter দিয়ে dynamic reload হয়।
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/api';

const today      = () => new Date().toISOString().slice(0, 10);
const firstMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; };
const fmt        = (n) => Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtShort   = (n) => { const v=Number(n||0); return v>=1000000?`৳${(v/1000000).toFixed(2)}M`:v>=1000?`৳${(v/1000).toFixed(1)}K`:`৳${fmt(v)}`; };

function StatCard({ gradient, label, value, sub, onClick }) {
  return (
    <div onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      className={`${gradient} p-5 rounded-2xl text-white shadow-sm flex flex-col gap-1 ${onClick?'cursor-pointer hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-white/70':''} transition-all`}>
      <p className="text-xs opacity-75 font-medium uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold leading-tight truncate">{value}</p>
      {sub && <p className="text-xs opacity-70 truncate">{sub}</p>}
    </div>
  );
}

function SimpleBarChart({ data, color = '#3b82f6' }) {
  if (!data || data.length === 0) return <p className="text-center text-gray-400 py-8 text-sm">No data</p>;
  const max = Math.max(...data.map(d => d.amount), 1);
  return (
    <div className="flex flex-col gap-2">
      {data.slice(0, 8).map((d, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="text-gray-600 w-36 truncate text-right">{d.name}</span>
          <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
            <div
              className="h-5 rounded-full flex items-center justify-end pr-2 text-white text-xs font-semibold"
              style={{ width: `${Math.max((d.amount/max)*100, 2)}%`, backgroundColor: color }}
            >
              {fmtShort(d.amount)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AccountingDashboard() {
  const navigate  = useNavigate();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [from,    setFrom]    = useState(firstMonth());
  const [to,      setTo]      = useState(today());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/accounting/dashboard/', { params: { from_date: from, to_date: to } });
      setData(r.data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const monthLabel = () => {
    const d = new Date(from);
    return `${d.toLocaleString('en-US',{month:'short'})}-${d.getFullYear()}`;
  };

  const inputCls = 'border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#173d59] focus:outline-none';

  return (
    <div className="p-4 md:p-6 bg-gray-100 min-h-screen">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Accounting Dashboard</h1>
          <p className="text-sm text-gray-500">Financial Summary</p>
        </div>
        <div className="text-xs text-gray-400">Accounts &gt; Accounting Dashboard</div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 sm:p-6">
        {/* Date filter */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="flex items-center gap-2 bg-[#23445f] text-white text-sm px-3 py-2 rounded-xl">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
            <span>{from} to {to}</span>
          </div>
          <input type="date" value={from} onChange={e=>setFrom(e.target.value)} className={inputCls} />
          <input type="date" value={to}   onChange={e=>setTo(e.target.value)}   className={inputCls} />
          <button onClick={fetchData}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#173d59] hover:bg-[#1f5075] text-white rounded-full transition-all">
            Filter by date
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">Loading…</div>
        ) : (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
              <StatCard gradient="bg-gradient-to-r from-sky-500 to-cyan-600"
                label="Total Income"
                value={`৳${fmt(data?.total_income)}`}
                sub={`৳${fmt(data?.total_income)} • ${monthLabel()}`}
                onClick={() => navigate('/accounting/income')} />
              <StatCard gradient="bg-gradient-to-r from-teal-500 to-emerald-600"
                label="Total Expense"
                value={`৳${fmt(data?.total_expense)}`}
                sub={`৳0.00 • ${monthLabel()}`}
                onClick={() => navigate('/accounting/expense')} />
              <StatCard gradient="bg-gradient-to-r from-violet-500 to-indigo-600"
                label="Total Profit"
                value={`৳${fmt(data?.net_profit)}`}
                sub={`৳${fmt(data?.net_profit)} • ${monthLabel()}`} />
              <StatCard gradient="bg-gradient-to-r from-sky-500 to-cyan-600"
                label="Expected Payments from Customers"
                value={`৳${fmt(data?.customer_receivable)}`}
                sub={`৳${fmt(data?.customer_receivable)} • ${monthLabel()}`} />
              <StatCard gradient="bg-gradient-to-r from-teal-500 to-emerald-600"
                label="Expected payments to vendors"
                value={`৳${fmt(data?.vendor_payable)}`}
                sub={`৳${fmt(data?.vendor_payable)} • ${monthLabel()}`} />
              <StatCard gradient="bg-gradient-to-r from-violet-500 to-indigo-600"
                label="Total Upcoming"
                value={`৳${fmt(data?.total_upcoming)}`}
                sub={`৳${fmt(data?.total_upcoming)} • ${monthLabel()}`} />
              <StatCard gradient="bg-gradient-to-r from-sky-400 to-blue-600"
                label="Cash on Hand"
                value={`৳${fmt(data?.cash_on_hand)}`}
                sub={`৳${fmt(data?.cash_on_hand)} • ${monthLabel()}`}
                onClick={() => navigate('/accounting/cash-book')} />
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="text-sm font-bold text-gray-700 mb-4">Income by Category</h3>
                <SimpleBarChart data={data?.income_by_category} color="#0ea5e9" />
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="text-sm font-bold text-gray-700 mb-4">Expense by Category</h3>
                <SimpleBarChart data={data?.expense_by_category} color="#14b8a6" />
              </div>
            </div>

            {/* Latest tables */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-bold bg-[#23445f] text-white px-4 py-3 rounded-t-xl uppercase tracking-wider">
                  Latest Incomes
                </h3>
                <div className="border border-gray-200 rounded-b-xl overflow-x-auto">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Category</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(data?.latest_income || []).length === 0 ? (
                        <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400">No data</td></tr>
                      ) : (data?.latest_income || []).map((r) => (
                        <tr key={r.id} className="hover:bg-blue-50/30 transition-colors">
                          <td className="px-4 py-2.5 text-gray-600">{r.date}</td>
                          <td className="px-4 py-2.5">
                            <button onClick={() => navigate('/accounting/income')}
                              className="text-blue-600 hover:underline">{r.category_name || 'Uncategorized'}</button>
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold text-emerald-700">{fmt(r.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold bg-[#23445f] text-white px-4 py-3 rounded-t-xl uppercase tracking-wider">
                  Latest Expenses
                </h3>
                <div className="border border-gray-200 rounded-b-xl overflow-x-auto">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Category</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(data?.latest_expense || []).length === 0 ? (
                        <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400">No data</td></tr>
                      ) : (data?.latest_expense || []).map((r) => (
                        <tr key={r.id} className="hover:bg-blue-50/30 transition-colors">
                          <td className="px-4 py-2.5 text-gray-600">{r.date}</td>
                          <td className="px-4 py-2.5">
                            <button onClick={() => navigate('/accounting/expense')}
                              className="text-blue-600 hover:underline">{r.category_name || 'Uncategorized'}</button>
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold text-rose-700">{fmt(r.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
