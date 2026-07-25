// Account Balances Report — Starting, Dr, Cr, Net Movement, Ending Balance।
import { useEffect, useState, useCallback, Fragment } from 'react';
import toast from 'react-hot-toast';
import api from '../../utils/api';

const today      = () => new Date().toISOString().slice(0,10);
const firstMonth = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; };
const fmt        = (n) => Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

export default function AccountBalancesPage() {
  const [from,    setFrom]    = useState(firstMonth());
  const [to,      setTo]      = useState(today());
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/accounting/account-balances/', { params: { from_date: from, to_date: to } });
      setData(r.data);
    } catch { toast.error('লোড ব্যর্থ।'); }
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#173d59] focus:outline-none';

  const grandTotals = data?.sections
    ? Object.values(data.sections).reduce((acc, s) => ({
        start: acc.start + s.total.starting_balance,
        dr:    acc.dr    + s.total.debit,
        cr:    acc.cr    + s.total.credit,
        net:   acc.net   + s.total.net_movement,
        end:   acc.end   + s.total.ending_balance,
      }), { start: 0, dr: 0, cr: 0, net: 0, end: 0 })
    : null;

  return (
    <div className="p-4 md:p-6 bg-gray-100 min-h-screen">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Account Balances Report</h1>
          <p className="text-sm text-gray-500">Accounting Report</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">Accounting Report &gt; Account Balances Report</span>
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
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-[#173d59] hover:bg-[#1f5075] text-white rounded-full transition-all">
            Update Report
          </button>
          <button onClick={() => { setFrom(firstMonth()); setTo(today()); }}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-full transition-all">
            Clear Filters
          </button>
        </div>

        {loading ? <p className="text-center text-gray-400 py-12">Loading…</p>
        : !data ? null
        : (
          <div className="border border-gray-200 rounded-xl overflow-x-auto shadow-sm">
            {/* tabular-nums = সব সংখ্যা সমান প্রস্থে; numeric column right-aligned ও
                সরু vertical divider দিয়ে প্রতিটি column স্পষ্ট। */}
            <table className="w-full min-w-[800px] text-sm tabular-nums border-collapse">
              <colgroup>
                <col style={{ width: '28%' }} />
                <col style={{ width: '14.4%' }} />
                <col style={{ width: '14.4%' }} />
                <col style={{ width: '14.4%' }} />
                <col style={{ width: '14.4%' }} />
                <col style={{ width: '14.4%' }} />
              </colgroup>
              <thead className="bg-[#23445f] text-white">
                <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wider [&>th]:whitespace-nowrap [&>th]:border-l [&>th]:border-white/10">
                  <th className="text-left !border-l-0">Account</th>
                  <th className="text-right">Starting Balance</th>
                  <th className="text-right text-emerald-300">Debit</th>
                  <th className="text-right text-rose-300">Credit</th>
                  <th className="text-right">Net Movement</th>
                  <th className="text-right">Ending Balance</th>
                </tr>
              </thead>
              <tbody className="[&_td]:border-l [&_td]:border-gray-100 [&_td:first-child]:border-l-0">
                {Object.entries(data.sections || {}).map(([typeName, section]) => (
                  <Fragment key={typeName}>
                    <tr className="bg-[#eef3f7]">
                      <td colSpan={6} className="px-4 py-2 text-[#23445f] text-[11px] font-bold uppercase tracking-wider !border-l-0">{typeName}</td>
                    </tr>
                    {section.items.map((item, i) => (
                      <tr key={item.id} className={`${i%2===0?'bg-white':'bg-gray-50/60'} hover:bg-blue-50/40 transition-colors`}>
                        <td className="px-4 py-2.5 text-blue-600 font-medium">{item.name}</td>
                        <td className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap">{fmt(item.starting_balance)}</td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap text-emerald-700">{item.debit > 0 ? fmt(item.debit) : <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap text-rose-700">{item.credit > 0 ? fmt(item.credit) : <span className="text-gray-300">—</span>}</td>
                        <td className={`px-4 py-2.5 text-right font-semibold whitespace-nowrap ${item.net_movement < 0 ? 'text-rose-600' : 'text-gray-800'}`}>{fmt(item.net_movement)}</td>
                        <td className={`px-4 py-2.5 text-right font-bold whitespace-nowrap ${item.ending_balance < 0 ? 'text-rose-600' : 'text-[#173d59]'}`}>{fmt(item.ending_balance)}</td>
                      </tr>
                    ))}
                    <tr className="bg-gray-100 font-bold border-t-2 border-gray-300">
                      <td className="px-4 py-2.5 text-gray-700">Total {typeName}</td>
                      <td className="px-4 py-2.5 text-right text-gray-800 whitespace-nowrap">{fmt(section.total.starting_balance)}</td>
                      <td className="px-4 py-2.5 text-right text-emerald-700 whitespace-nowrap">{fmt(section.total.debit)}</td>
                      <td className="px-4 py-2.5 text-right text-rose-700 whitespace-nowrap">{fmt(section.total.credit)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-800 whitespace-nowrap">{fmt(section.total.net_movement)}</td>
                      <td className="px-4 py-2.5 text-right text-[#173d59] whitespace-nowrap">{fmt(section.total.ending_balance)}</td>
                    </tr>
                  </Fragment>
                ))}
                {grandTotals && (
                  <tr className="bg-[#23445f] text-white font-bold [&>td]:border-white/10">
                    <td className="px-4 py-3 !border-l-0">Total for all accounts</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{fmt(grandTotals.start)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{fmt(grandTotals.dr)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{fmt(grandTotals.cr)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{fmt(grandTotals.net)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{fmt(grandTotals.end)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
