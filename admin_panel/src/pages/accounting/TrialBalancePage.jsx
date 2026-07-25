// Trial Balance — সব account-এর cumulative Dr/Cr till_date।
import { useEffect, useState, useCallback, useMemo, Fragment } from 'react';
import toast from 'react-hot-toast';
import api from '../../utils/api';

const today = () => new Date().toISOString().slice(0,10);
const fmt   = (n) => Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

export default function TrialBalancePage() {
  const [tillDate, setTillDate] = useState(today());
  const [search,   setSearch]   = useState('');
  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/accounting/daily-accounts/trial-balance/', { params: { till_date: tillDate } });
      setRows(Array.isArray(r.data) ? r.data : []);
    } catch { toast.error('লোড ব্যর্থ।'); }
    finally { setLoading(false); }
  }, [tillDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() =>
    rows.filter(r =>
      !search ||
      r.account_name?.toLowerCase().includes(search.toLowerCase()) ||
      r.account_code?.toLowerCase().includes(search.toLowerCase())
    ), [rows, search]);

  // Group by account_type
  const grouped = useMemo(() => {
    const g = {};
    filtered.forEach(r => {
      const t = r.account_type || 'Other';
      if (!g[t]) g[t] = { items: [], dr: 0, cr: 0 };
      g[t].items.push(r);
      g[t].dr += r.debit;
      g[t].cr += r.credit;
    });
    return g;
  }, [filtered]);

  const totalDr = filtered.reduce((s, r) => s + r.debit, 0);
  const totalCr = filtered.reduce((s, r) => s + r.credit, 0);
  const balanced = Math.abs(totalDr - totalCr) < 0.01;

  const inp = 'border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#173d59] focus:outline-none';

  return (
    <div className="p-4 md:p-6 bg-gray-100 min-h-screen">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Trial Balance</h1>
          <p className="text-sm text-gray-500">Accounting Report</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">Accounting Report &gt; Trial Balance</span>
          <button className="px-3 py-2 text-xs font-medium bg-[#23445f] text-white rounded-full">Generate PDF</button>
          <button className="px-3 py-2 text-xs font-medium bg-[#23445f] text-white rounded-full">Generate CSV</button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex flex-wrap items-end gap-4 mb-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Till Date</label>
            <input type="date" value={tillDate} onChange={e => setTillDate(e.target.value)} className={inp} />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Search</label>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Account code or name…"
              className={inp + ' w-full'} />
          </div>
        </div>
        <div className="flex gap-3 mb-6">
          <button onClick={fetchData}
            className="px-4 py-2.5 text-sm font-medium bg-[#173d59] hover:bg-[#1f5075] text-white rounded-full transition-all">
            Update Report
          </button>
          <button onClick={() => { setTillDate(today()); setSearch(''); }}
            className="px-4 py-2.5 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-full transition-all">
            Clear Filters
          </button>
        </div>

        {/* Balance status */}
        {!loading && rows.length > 0 && (
          <div className={`mb-4 px-4 py-2.5 rounded-xl text-sm font-medium ${balanced ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
            {balanced ? '✓ Balanced — Total Debit = Total Credit' : `⚠️ Not Balanced — Difference: ${fmt(Math.abs(totalDr - totalCr))}`}
          </div>
        )}

        {loading ? <p className="text-center text-gray-400 py-12">Loading…</p>
        : (
          <div className="border border-gray-200 rounded-xl overflow-x-auto shadow-sm">
            {/* colgroup → Account 50%, Debit/Credit 25% করে; numeric right-aligned +
                tabular-nums + column divider → প্রতিটি column header-এর নিচে স্পষ্ট। */}
            <table className="w-full min-w-[600px] text-sm tabular-nums border-collapse">
              <colgroup>
                <col style={{ width: '50%' }} />
                <col style={{ width: '25%' }} />
                <col style={{ width: '25%' }} />
              </colgroup>
              <thead className="bg-[#23445f] text-white">
                <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wider [&>th]:border-l [&>th]:border-white/10">
                  <th className="text-left !border-l-0">Account</th>
                  <th className="text-right text-emerald-300">Debit</th>
                  <th className="text-right text-rose-300">Credit</th>
                </tr>
              </thead>
              <tbody className="[&_td]:border-l [&_td]:border-gray-100 [&_td:first-child]:border-l-0">
                {filtered.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400 !border-l-0">No data</td></tr>
                ) : (
                  Object.entries(grouped).map(([typeName, group]) => (
                    <Fragment key={typeName}>
                      {/* Type header */}
                      <tr className="bg-[#eef3f7]">
                        <td colSpan={3} className="px-4 py-2 text-[#23445f] text-[11px] font-bold uppercase tracking-wider !border-l-0">{typeName}</td>
                      </tr>
                      {/* Account rows */}
                      {group.items.map((r, i) => (
                        <tr key={r.account_id} className={`${i%2===0?'bg-white':'bg-gray-50/60'} hover:bg-blue-50/40 transition-colors`}>
                          <td className="px-4 py-2.5">
                            <span className="text-gray-400 font-mono text-xs mr-2">{r.account_code}</span>
                            <span className="text-blue-600 font-medium">{r.account_name}</span>
                          </td>
                          <td className="px-4 py-2.5 text-right text-emerald-700 whitespace-nowrap">{r.debit > 0 ? fmt(r.debit) : <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-2.5 text-right text-rose-700 whitespace-nowrap">{r.credit > 0 ? fmt(r.credit) : <span className="text-gray-300">—</span>}</td>
                        </tr>
                      ))}
                      {/* Type total */}
                      <tr className="bg-gray-100 font-bold border-t-2 border-gray-300">
                        <td className="px-4 py-2.5 text-gray-700">Total {typeName}</td>
                        <td className="px-4 py-2.5 text-right text-emerald-700 whitespace-nowrap">{group.dr > 0 ? fmt(group.dr) : <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-2.5 text-right text-rose-700 whitespace-nowrap">{group.cr > 0 ? fmt(group.cr) : <span className="text-gray-300">—</span>}</td>
                      </tr>
                    </Fragment>
                  ))
                )}
                {/* Grand total */}
                <tr className="bg-[#23445f] text-white font-bold [&>td]:border-white/10">
                  <td className="px-4 py-3 !border-l-0">Total for all accounts</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{fmt(totalDr)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">{fmt(totalCr)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
