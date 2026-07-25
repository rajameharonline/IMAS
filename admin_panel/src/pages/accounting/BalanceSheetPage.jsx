// Balance Sheet — Assets, Liabilities, Owner's Equity till_date।
import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../../utils/api';

const today = () => new Date().toISOString().slice(0,10);
const fmt   = (n) => Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

export default function BalanceSheetPage() {
  const [tillDate, setTillDate] = useState(today());
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/accounting/balance-sheet/', { params: { till_date: tillDate } });
      setData(r.data);
    } catch { toast.error('লোড ব্যর্থ।'); }
    finally { setLoading(false); }
  }, [tillDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const inp = 'border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#173d59] focus:outline-none';

  // Group items by parent_name within each section
  const groupByParent = (items) => {
    const groups = {};
    items.forEach(item => {
      const key = item.parent_name || 'General';
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    return groups;
  };

  const SECTION_ORDER = ['Asset', 'Liabilities', "Owner's Equity"];

  return (
    <div className="p-4 md:p-6 bg-gray-100 min-h-screen">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Balance Sheet</h1>
          <p className="text-sm text-gray-500">Accounting Report</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">Accounting Report &gt; Balance Sheet</span>
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
        </div>
        <div className="flex gap-3 mb-6">
          <button onClick={fetchData}
            className="px-4 py-2.5 text-sm font-medium bg-[#173d59] hover:bg-[#1f5075] text-white rounded-full transition-all">
            Update Report
          </button>
          <button onClick={() => { setTillDate(today()); }}
            className="px-4 py-2.5 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-full transition-all">
            Clear Filters
          </button>
        </div>

        {loading ? <p className="text-center text-gray-400 py-12">Loading…</p>
        : !data ? null
        : (
          <div className="space-y-2">
            {SECTION_ORDER.map(sectionName => {
              const section = data.sections?.[sectionName];
              if (!section) return null;
              const groups = groupByParent(section.items || []);
              return (
                <div key={sectionName}>
                  {/* Section header */}
                  <div className="bg-[#23445f] text-white px-4 py-3 text-sm font-bold uppercase tracking-wider rounded-t-xl">
                    {sectionName}
                  </div>
                  <div className="border border-gray-200 rounded-b-xl overflow-hidden mb-4">
                    {Object.entries(groups).map(([groupName, items]) => (
                      <div key={groupName}>
                        {/* Group sub-header */}
                        <div className="flex items-center justify-between bg-gray-50 px-4 py-2.5 border-b border-gray-100">
                          <span className="text-sm font-semibold text-gray-700">{groupName}</span>
                        </div>
                        {items.map((item, i) => (
                          <div key={item.id || item.name}
                            className={`flex items-center justify-between px-8 py-2.5 border-b border-gray-50 ${i%2===0?'bg-white':'bg-gray-50/30'}`}>
                            <span className="text-sm text-blue-600">{item.name}</span>
                            <span className={`text-sm font-semibold ${item.balance < 0 ? 'text-rose-600' : 'text-gray-700'}`}>
                              {fmt(item.balance)}
                            </span>
                          </div>
                        ))}
                        {/* Group sub-total */}
                        <div className="flex items-center justify-between px-4 py-2.5 bg-gray-100 border-b border-gray-200">
                          <span className="text-sm font-bold text-gray-700">Total {groupName}</span>
                          <span className={`text-sm font-bold ${items.reduce((s,i)=>s+i.balance,0)<0?'text-rose-600':'text-gray-800'}`}>
                            {fmt(items.reduce((s, i) => s + i.balance, 0))}
                          </span>
                        </div>
                      </div>
                    ))}
                    {/* Section total */}
                    <div className="flex items-center justify-between px-4 py-3 bg-gray-200 border-t border-gray-300">
                      <span className="text-sm font-bold text-gray-800">Total {sectionName}</span>
                      <span className={`text-sm font-bold ${section.total < 0 ? 'text-rose-700' : 'text-[#173d59]'}`}>
                        {fmt(section.total)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
