// Journal Voucher List — Approve, Delete, Add Journal।
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../../utils/api';

const today = () => new Date().toISOString().slice(0,10);
const firstMonth = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; };
const fmt = (n) => Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const statusBadge = (s) => s
  ? 'inline-flex px-3 py-1 rounded-full text-xs font-semibold bg-emerald-600 text-white'
  : 'inline-flex px-3 py-1 rounded-full text-xs font-semibold bg-amber-500 text-white';
const PAGE_SIZE = 25;

export default function JournalVoucherPage() {
  const navigate = useNavigate();
  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [selected, setSelected] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [users,    setUsers]    = useState([]);
  const [page,     setPage]     = useState(1);
  const [expanded, setExpanded] = useState(null);
  const [filters,  setFilters]  = useState({
    account:'', from_date:firstMonth(), to_date:today(), status:'', search:'',
  });

  useEffect(()=>{
    api.get('/accounting/chart-of-accounts/',{params:{page_size:500}}).then(r=>setAccounts(Array.isArray(r.data)?r.data:(r.data?.results||[])));
    api.get('/auth/users/',{params:{page_size:500}}).then(r=>setUsers(Array.isArray(r.data)?r.data:(r.data?.results||[])));
  },[]);

  const fetchRows = useCallback(async()=>{
    setLoading(true);
    try {
      const r = await api.get('/accounting/journal/',{params:{...filters}});
      setRows(Array.isArray(r.data)?r.data:(r.data?.results||[])); setPage(1);
    } catch { toast.error('লোড ব্যর্থ।'); }
    finally { setLoading(false); }
  },[filters]);

  useEffect(()=>{ fetchRows(); },[fetchRows]);

  const paged = useMemo(()=>rows.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE),[rows,page]);
  const toggleSelect = (id) => setSelected(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);
  const toggleAll = () => setSelected(selected.length===paged.length?[]:paged.map(r=>r.id));

  const bulkApprove = async () => {
    if(!selected.length){toast.error('কিছু select করুন।');return;}
    try { await api.post('/accounting/journal/bulk-approve/',{ids:selected}); toast.success(`${selected.length}টি approve।`); setSelected([]); fetchRows(); }
    catch { toast.error('ব্যর্থ।'); }
  };
  const bulkDelete = async () => {
    if(!selected.length){toast.error('কিছু select করুন।');return;}
    if(!window.confirm(`${selected.length}টি মুছবেন?`)) return;
    try { await api.post('/accounting/journal/bulk-delete/',{ids:selected}); toast.success('মুছে গেছে।'); setSelected([]); fetchRows(); }
    catch { toast.error('ব্যর্থ।'); }
  };

  const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#173d59] focus:outline-none bg-white';

  return (
    <div className="p-4 md:p-6 bg-gray-100 min-h-screen">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Journal Voucher</h1>
          <p className="text-sm text-gray-500">Journal Voucher List</p>
        </div>
        <span className="text-xs text-gray-400">Accounting &gt; Journal Voucher</span>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex flex-wrap gap-2 mb-5">
          <button onClick={bulkApprove} className="flex items-center gap-2 px-3 py-2 text-xs font-semibold bg-[#23445f] text-white rounded-full hover:bg-[#1f5075] transition-all">✓ Approve Selected Transaction</button>
          <button onClick={bulkDelete}  className="flex items-center gap-2 px-3 py-2 text-xs font-semibold bg-rose-600 text-white rounded-full hover:bg-rose-700 transition-all">🗑 Delete Selected Transaction</button>
          <button onClick={()=>navigate('/accounting/create-journal')} className="flex items-center gap-2 px-3 py-2 text-xs font-semibold bg-[#173d59] text-white rounded-full hover:bg-[#1f5075] transition-all">+ Add Journal</button>
          <div className="flex gap-2 ml-auto">
            <button className="px-3 py-2 text-xs font-medium bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">Generate PDF</button>
            <button className="px-3 py-2 text-xs font-medium bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">Generate CSV</button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-xl mb-6">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Account</label>
            <select value={filters.account} onChange={e=>setFilters(p=>({...p,account:e.target.value}))} className={inp}>
              <option value="">Select</option>
              {accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">From Date</label>
            <input type="date" value={filters.from_date} onChange={e=>setFilters(p=>({...p,from_date:e.target.value}))} className={inp}/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">To Date</label>
            <input type="date" value={filters.to_date} onChange={e=>setFilters(p=>({...p,to_date:e.target.value}))} className={inp}/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Status</label>
            <select value={filters.status} onChange={e=>setFilters(p=>({...p,status:e.target.value}))} className={inp}>
              <option value="">Select</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
            </select>
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Search</label>
            <input value={filters.search} onChange={e=>setFilters(p=>({...p,search:e.target.value}))} placeholder="Journal Ref / Description…" className={inp}/>
          </div>
          <div className="flex items-end">
            <button onClick={fetchRows} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-[#173d59] hover:bg-[#1f5075] text-white rounded-full transition-all">
              <RefreshCw className="w-4 h-4"/> Refresh
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between mb-3 text-sm">
          <span className="text-gray-500">SHOW <select className="border border-gray-200 rounded px-1 mx-1 text-xs" defaultValue={25}><option>25</option><option>50</option><option>100</option></select> ENTRIES</span>
          <div className="flex items-center gap-2 text-gray-500">SEARCH: <input className="border border-gray-200 rounded px-2 py-1 text-xs" value={filters.search} onChange={e=>setFilters(p=>({...p,search:e.target.value}))}/></div>
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full min-w-full divide-y divide-gray-200">
            <thead className="bg-[#23445f]">
              <tr>
                <th className="px-3 py-3"><input type="checkbox" checked={selected.length===paged.length&&paged.length>0} onChange={toggleAll} className="w-4 h-4"/></th>
                {['Journal Date','VoucherNumber','Account(Dr)','Account(Cr)','Amount','Description','CreatedBy','CreationDate','Approved By','ApprovedDate','Status','Action'].map(h=>(
                  <th key={h} className="px-4 py-3 text-white text-xs font-semibold uppercase tracking-wider text-left whitespace-nowrap">{h}</th>
                ))}
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {loading ? <tr><td colSpan={14} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
              : paged.length===0 ? <tr><td colSpan={14} className="px-4 py-8 text-center text-gray-400">No data available in table</td></tr>
              : paged.map((r,i)=>{
                const drLine = r.lines?.find(l=>Number(l.debit)>0);
                const crLine = r.lines?.find(l=>Number(l.credit)>0);
                return (
                  <>
                  <tr key={r.id} className={`${i%2===0?'bg-white':'bg-gray-50/50'} hover:bg-blue-50/30 transition-colors cursor-pointer`} onClick={()=>setExpanded(p=>p===r.id?null:r.id)}
                    role="button" tabIndex={0} aria-expanded={expanded===r.id}
                    onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); setExpanded(p=>p===r.id?null:r.id); } }}>
                    <td className="px-3 py-3" onClick={e=>e.stopPropagation()}><input type="checkbox" checked={selected.includes(r.id)} onChange={()=>toggleSelect(r.id)} className="w-4 h-4"/></td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{r.date}</td>
                    <td className="px-4 py-3 text-sm text-[#173d59] font-semibold whitespace-nowrap">{r.reference}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{drLine ? accounts.find(a=>a.id===drLine.account)?.name||`Acct#${drLine.account}` : '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{crLine ? accounts.find(a=>a.id===crLine.account)?.name||`Acct#${crLine.account}` : '-'}</td>
                    <td className="px-4 py-3 text-sm font-bold text-[#173d59] whitespace-nowrap">৳{fmt(r.total_debit)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-[150px] truncate">{r.description||'-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{r.created_by_name||'-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{r.created_at?.slice(0,10)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{r.approved_by_name||'-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{r.approved_at?r.approved_at.slice(0,10):'-'}</td>
                    <td className="px-4 py-3 whitespace-nowrap"><span className={statusBadge(r.is_posted)}>{r.is_posted?'Approved':'Pending'}</span></td>
                    <td className="px-4 py-3 whitespace-nowrap" onClick={e=>e.stopPropagation()}>
                      <button onClick={async()=>{ try{ await api.post('/accounting/journal/bulk-approve/',{ids:[r.id]}); toast.success('Approved'); fetchRows(); }catch{toast.error('ব্যর্থ।');} }}
                        disabled={r.is_posted} className="text-xs px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full disabled:opacity-40">✓</button>
                    </td>
                    <td className="px-3 py-3">
                      {expanded===r.id ? <ChevronUp className="w-4 h-4 text-gray-500"/> : <ChevronDown className="w-4 h-4 text-gray-500"/>}
                    </td>
                  </tr>
                  {expanded===r.id && (
                    <tr key={`exp-${r.id}`} className="bg-blue-50/30">
                      <td colSpan={14} className="px-8 py-4">
                        <p className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-2">Journal Lines</p>
                        <table className="w-full text-xs border border-gray-200 rounded-lg overflow-hidden">
                          <thead className="bg-gray-100">
                            <tr>
                              {['Account','Description','Debit','Credit'].map(h=><th key={h} className="px-3 py-2 text-left text-gray-600 font-semibold uppercase">{h}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {(r.lines||[]).map(l=>(
                              <tr key={l.id} className="border-t border-gray-100">
                                <td className="px-3 py-2">{accounts.find(a=>a.id===l.account)?.name||`#${l.account}`}</td>
                                <td className="px-3 py-2 text-gray-500">{l.description||'-'}</td>
                                <td className="px-3 py-2 text-emerald-700 font-semibold">{Number(l.debit)>0?`৳${fmt(l.debit)}`:'-'}</td>
                                <td className="px-3 py-2 text-rose-700 font-semibold">{Number(l.credit)>0?`৳${fmt(l.credit)}`:'-'}</td>
                              </tr>
                            ))}
                            <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold">
                              <td colSpan={2} className="px-3 py-2">Total</td>
                              <td className="px-3 py-2 text-emerald-700">৳{fmt(r.total_debit)}</td>
                              <td className="px-3 py-2 text-rose-700">৳{fmt(r.total_credit)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="block md:hidden space-y-4">
          {loading ? <p className="text-center text-gray-400 py-8">Loading…</p>
          : paged.length===0 ? <p className="text-center text-gray-400 py-8">No data available</p>
          : paged.map(r=>{
            const drLine = r.lines?.find(l=>Number(l.debit)>0);
            const crLine = r.lines?.find(l=>Number(l.credit)>0);
            const isOpen = expanded===r.id;
            return (
              <div key={r.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <div className="flex justify-between items-center border-b border-gray-100 pb-3 mb-3">
                  <span className="text-sm font-bold text-gray-900">{r.reference}</span>
                  <span className={statusBadge(r.is_posted)}>{r.is_posted?'Approved':'Pending'}</span>
                </div>
                <div className="space-y-2.5 text-xs">
                  <div className="flex justify-between"><span className="text-gray-500 uppercase tracking-wider">Date:</span><span>{r.date}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-gray-500 uppercase tracking-wider shrink-0">Dr:</span><span className="text-right truncate">{drLine ? accounts.find(a=>a.id===drLine.account)?.name||`Acct#${drLine.account}` : '-'}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-gray-500 uppercase tracking-wider shrink-0">Cr:</span><span className="text-right truncate">{crLine ? accounts.find(a=>a.id===crLine.account)?.name||`Acct#${crLine.account}` : '-'}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500 uppercase tracking-wider">Amount:</span><span className="text-[#173d59] font-bold text-sm">৳{fmt(r.total_debit)}</span></div>
                </div>
                <button
                  type="button"
                  onClick={()=>setExpanded(p=>p===r.id?null:r.id)}
                  className="mt-3 flex items-center gap-1 text-xs font-semibold text-[#173d59]"
                  aria-expanded={isOpen}
                >
                  {isOpen ? <ChevronUp className="w-4 h-4"/> : <ChevronDown className="w-4 h-4"/>}
                  {isOpen ? 'Hide Lines' : 'Show Lines'}
                </button>
                {isOpen && (
                  <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
                    {(r.lines||[]).map(l=>(
                      <div key={l.id} className="flex justify-between text-xs gap-2">
                        <span className="text-gray-600 truncate">{accounts.find(a=>a.id===l.account)?.name||`#${l.account}`}</span>
                        <span className="shrink-0">
                          {Number(l.debit)>0 && <span className="text-emerald-700 font-semibold">৳{fmt(l.debit)}</span>}
                          {Number(l.credit)>0 && <span className="text-rose-700 font-semibold">৳{fmt(l.credit)}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
          <span>Showing {Math.min((page-1)*PAGE_SIZE+1,rows.length)}–{Math.min(page*PAGE_SIZE,rows.length)} of {rows.length} entries</span>
          <div className="flex gap-2">
            <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1} className="px-3 py-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50">Previous</button>
            <button onClick={()=>setPage(p=>p*PAGE_SIZE<rows.length?p+1:p)} disabled={page*PAGE_SIZE>=rows.length} className="px-3 py-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}
