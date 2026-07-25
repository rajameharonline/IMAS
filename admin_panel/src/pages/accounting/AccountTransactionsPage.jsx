// Account Transactions — নির্দিষ্ট account-এর ledger view।
import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../../utils/api';

const today      = () => new Date().toISOString().slice(0,10);
const firstMonth = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; };
const fmt        = (n) => Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

export default function AccountTransactionsPage() {
  const [accounts,     setAccounts]     = useState([]);
  const [accountNature,setAccountNature]= useState('');
  const [accountId,    setAccountId]    = useState('');
  const [from,         setFrom]         = useState(firstMonth());
  const [to,           setTo]           = useState(today());
  const [data,         setData]         = useState(null);
  const [loading,      setLoading]      = useState(false);

  const ACCOUNT_TYPES = [
    {code:'ASSET',name:'Asset'},{code:'LIA',name:'Liability'},
    {code:'EXP',name:'Expense'},{code:'INC',name:'Income'},{code:'EQU',name:'Owner\'s Equity'},
  ];

  useEffect(()=>{
    api.get('/accounting/chart-of-accounts/',{params:{page_size:500}})
      .then(r=>setAccounts(Array.isArray(r.data)?r.data:(r.data?.results||[])));
  },[]);

  const filteredAccounts = accountNature
    ? accounts.filter(a=>a.account_type_code===accountNature)
    : accounts;

  const fetchData = useCallback(async()=>{
    if(!accountId){ toast.error('Account নির্বাচন করুন।'); return; }
    setLoading(true);
    try {
      const r = await api.get('/accounting/account-transactions/',{params:{account_id:accountId,from_date:from,to_date:to}});
      setData(r.data);
    } catch { toast.error('লোড ব্যর্থ।'); }
    finally { setLoading(false); }
  },[accountId,from,to]);

  const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#173d59] focus:outline-none';

  return (
    <div className="p-4 md:p-6 bg-gray-100 min-h-screen">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Account Transactions</h1>
          <p className="text-sm text-gray-500">Accounting Report</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">Account Transactions &gt; Accounting Report</span>
          <button className="px-3 py-2 text-xs font-medium bg-[#23445f] text-white rounded-full">Generate PDF</button>
          <button className="px-3 py-2 text-xs font-medium bg-[#23445f] text-white rounded-full">Generate CSV</button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-4 p-4 bg-gray-50 rounded-xl">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Account Nature</label>
            <select value={accountNature} onChange={e=>setAccountNature(e.target.value)} className={inp}>
              <option value="">All Types</option>
              {ACCOUNT_TYPES.map(t=><option key={t.code} value={t.code}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Account</label>
            <select value={accountId} onChange={e=>setAccountId(e.target.value)} className={inp}>
              <option value="">Select Account</option>
              {filteredAccounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">From Date</label>
            <input type="date" value={from} onChange={e=>setFrom(e.target.value)} className={inp}/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">To Date</label>
            <input type="date" value={to} onChange={e=>setTo(e.target.value)} className={inp}/>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-6">
          <button onClick={fetchData}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-[#173d59] hover:bg-[#1f5075] text-white rounded-full transition-all">
            Update Report
          </button>
          <button onClick={()=>{setAccountNature('');setAccountId('');setFrom(firstMonth());setTo(today());setData(null);}}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-full transition-all">
            Clear Filters
          </button>
        </div>

        {loading ? <p className="text-center text-gray-400 py-12">Loading…</p>
        : !data ? <p className="text-center text-gray-400 py-12">Filter apply করে "Update Report" চাপুন।</p>
        : (
          <>
            <div className="mb-4">
              <h3 className="text-base font-bold text-gray-800">{data.account?.name}</h3>
              <p className="text-sm text-gray-500">{data.account?.type}{data.account?.parent?` > ${data.account.parent}`:''}</p>
            </div>

            <div className="border border-gray-200 rounded-xl overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead className="bg-[#23445f]">
                  <tr>
                    {['Date','Description','Debit','Credit','Balance'].map(h=>(
                      <th key={h} className="px-4 py-3 text-white text-xs font-semibold uppercase tracking-wider text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {/* Starting balance row */}
                  <tr className="bg-gray-50 font-semibold">
                    <td colSpan={2} className="px-4 py-3 text-gray-700">Starting Balance</td>
                    <td className="px-4 py-3"></td>
                    <td className="px-4 py-3"></td>
                    <td className="px-4 py-3 text-right font-bold text-[#173d59]">{fmt(data.starting_balance)}</td>
                  </tr>

                  {data.transactions?.length===0 ? (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">এই period-এ কোনো transaction নেই।</td></tr>
                  ) : data.transactions?.map((t,i)=>(
                    <tr key={i} className={`${i%2===0?'bg-white':'bg-gray-50/50'} hover:bg-blue-50/30 transition-colors`}>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{t.date}</td>
                      <td className="px-4 py-3 text-gray-700">{t.description||t.reference}</td>
                      <td className="px-4 py-3 text-emerald-700 font-semibold">{t.debit>0?fmt(t.debit):'-'}</td>
                      <td className="px-4 py-3 text-rose-700 font-semibold">{t.credit>0?fmt(t.credit):'-'}</td>
                      <td className={`px-4 py-3 font-bold text-right whitespace-nowrap ${t.balance<0?'text-rose-600':'text-[#173d59]'}`}>{fmt(t.balance)}</td>
                    </tr>
                  ))}

                  {/* Total row */}
                  <tr className="bg-gray-100 font-bold border-t-2 border-gray-300">
                    <td className="px-4 py-3 text-gray-700">Total and Ending Balance</td>
                    <td className="px-4 py-3"></td>
                    <td className="px-4 py-3 text-emerald-700">{fmt(data.total_debit)}</td>
                    <td className="px-4 py-3 text-rose-700">{fmt(data.total_credit)}</td>
                    <td className="px-4 py-3 text-right text-[#173d59]">{fmt(data.ending_balance)}</td>
                  </tr>
                  <tr className="bg-gray-50 text-sm">
                    <td className="px-4 py-3 text-gray-600 font-semibold">Balance Difference</td>
                    <td colSpan={4} className="px-4 py-3 text-right font-bold text-gray-700">
                      {fmt(data.ending_balance - data.starting_balance)}
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
