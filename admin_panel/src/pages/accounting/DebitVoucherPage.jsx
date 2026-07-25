// Debit Voucher — Expense list। CreditVoucherPage-এর mirror — expense endpoint।
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { RefreshCw } from 'lucide-react';
import api from '../../utils/api';

const today = () => new Date().toISOString().slice(0,10);
const firstMonth = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; };
const fmt = (n) => Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const statusBadge = (s) => s==='approved'
  ? 'inline-flex px-3 py-1 rounded-full text-xs font-semibold bg-emerald-600 text-white'
  : 'inline-flex px-3 py-1 rounded-full text-xs font-semibold bg-amber-500 text-white';
const PAGE_SIZE = 25;

export default function DebitVoucherPage() {
  const navigate = useNavigate();
  const [rows,      setRows]      = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [selected,  setSelected]  = useState([]);
  const [accounts,  setAccounts]  = useState([]);
  const [categories,setCategories]= useState([]);
  const [users,     setUsers]     = useState([]);
  const [page,      setPage]      = useState(1);
  const [filters,   setFilters]   = useState({
    account:'', category:'', from_date:firstMonth(), to_date:today(), status:'', created_by:'', search:'',
  });

  const fetchLookups = useCallback(async () => {
    const [accR,catR,usrR] = await Promise.all([
      api.get('/accounting/chart-of-accounts/',{params:{page_size:500}}),
      api.get('/accounting/expense-categories/'),
      api.get('/auth/users/',{params:{page_size:500}}),
    ]);
    setAccounts(Array.isArray(accR.data)?accR.data:(accR.data?.results||[]));
    setCategories(Array.isArray(catR.data)?catR.data:(catR.data?.results||[]));
    setUsers(Array.isArray(usrR.data)?usrR.data:(usrR.data?.results||[]));
  },[]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/accounting/expense/',{params:{...filters}});
      setRows(Array.isArray(r.data)?r.data:(r.data?.results||[]));
      setPage(1);
    } catch { toast.error('লোড ব্যর্থ।'); }
    finally { setLoading(false); }
  },[filters]);

  useEffect(()=>{ fetchLookups(); },[fetchLookups]);
  useEffect(()=>{ fetchRows(); },[fetchRows]);

  const paged = useMemo(()=>rows.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE),[rows,page]);
  const total = useMemo(()=>rows.reduce((s,r)=>s+Number(r.amount||0),0),[rows]);
  const toggleSelect = (id) => setSelected(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);
  const toggleAll = () => setSelected(selected.length===paged.length?[]:paged.map(r=>r.id));

  const bulkApprove = async () => {
    if(!selected.length){toast.error('কিছু select করুন।');return;}
    try { await api.post('/accounting/expense/bulk-approve/',{ids:selected}); toast.success(`${selected.length}টি approve।`); setSelected([]); fetchRows(); }
    catch { toast.error('ব্যর্থ।'); }
  };
  const bulkDelete = async () => {
    if(!selected.length){toast.error('কিছু select করুন।');return;}
    if(!window.confirm(`${selected.length}টি মুছবেন?`)) return;
    try { await api.post('/accounting/expense/bulk-delete/',{ids:selected}); toast.success('মুছে গেছে।'); setSelected([]); fetchRows(); }
    catch { toast.error('ব্যর্থ।'); }
  };

  const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#173d59] focus:outline-none bg-white';

  return (
    <div className="p-4 md:p-6 bg-gray-100 min-h-screen">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Debit Voucher</h1>
          <p className="text-sm text-gray-500">Debit Voucher List</p>
        </div>
        <span className="text-xs text-gray-400">Accounting &gt; Debit Voucher</span>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex flex-wrap gap-2 mb-5">
          <button onClick={bulkApprove} className="flex items-center gap-2 px-3 py-2 text-xs font-semibold bg-[#23445f] text-white rounded-full hover:bg-[#1f5075] transition-all">✓ Approve Selected Transaction</button>
          <button onClick={bulkDelete}  className="flex items-center gap-2 px-3 py-2 text-xs font-semibold bg-rose-600 text-white rounded-full hover:bg-rose-700 transition-all">🗑 Delete Selected Transaction</button>
          <button onClick={()=>navigate('/accounting/add-expense')} className="flex items-center gap-2 px-3 py-2 text-xs font-semibold bg-[#173d59] text-white rounded-full hover:bg-[#1f5075] transition-all">+ Add Expense</button>
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
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Category</label>
            <select value={filters.category} onChange={e=>setFilters(p=>({...p,category:e.target.value}))} className={inp}>
              <option value="">Select</option>
              {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
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
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Created By</label>
            <select value={filters.created_by} onChange={e=>setFilters(p=>({...p,created_by:e.target.value}))} className={inp}>
              <option value="">Select</option>
              {users.map(u=><option key={u.id} value={u.id}>{u.full_name||u.username}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Search</label>
            <input value={filters.search} onChange={e=>setFilters(p=>({...p,search:e.target.value}))} placeholder="Voucher No…" className={inp}/>
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
                {['Expense Date','VoucherNumber','Account','Category','Amount','Description','CreatedBy','CreationDate','Approved By','ApprovedDate','Status','Action'].map(h=>(
                  <th key={h} className="px-4 py-3 text-white text-xs font-semibold uppercase tracking-wider text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {loading ? <tr><td colSpan={13} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
              : paged.length===0 ? <tr><td colSpan={13} className="px-4 py-8 text-center text-gray-400">No data available in table</td></tr>
              : paged.map((r,i)=>(
                <tr key={r.id} className={`${i%2===0?'bg-white':'bg-gray-50/50'} hover:bg-blue-50/30 transition-colors`}>
                  <td className="px-3 py-3"><input type="checkbox" checked={selected.includes(r.id)} onChange={()=>toggleSelect(r.id)} className="w-4 h-4"/></td>
                  <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{r.date}</td>
                  <td className="px-4 py-3 text-sm text-[#173d59] font-semibold whitespace-nowrap">{r.voucher_no||'-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{r.account_name||'-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{r.category_name||'-'}</td>
                  <td className="px-4 py-3 text-sm font-bold text-rose-700 whitespace-nowrap">৳{fmt(r.amount)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 max-w-[200px] truncate">{r.description||'-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{r.created_by_name||'-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{r.created_at?.slice(0,10)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{r.approved_by_name||'-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{r.approved_at?r.approved_at.slice(0,10):'-'}</td>
                  <td className="px-4 py-3 whitespace-nowrap"><span className={statusBadge(r.is_approved?'approved':'pending')}>{r.is_approved?'Approved':'Pending'}</span></td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <button onClick={async()=>{ try{ await api.post('/accounting/expense/bulk-approve/',{ids:[r.id]}); toast.success('Approved'); fetchRows(); } catch{toast.error('ব্যর্থ।');} }}
                      disabled={r.is_approved} className="text-xs px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full disabled:opacity-40">✓</button>
                  </td>
                </tr>
              ))}
              <tr className="bg-gray-100 font-bold">
                <td colSpan={5} className="px-4 py-3 text-sm text-gray-700">Total</td>
                <td className="px-4 py-3 text-sm text-rose-700">৳{fmt(total)}</td>
                <td colSpan={7}/>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="block md:hidden space-y-4">
          {paged.map(r=>(
            <div key={r.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex justify-between items-center border-b border-gray-100 pb-3 mb-3">
                <span className="text-sm font-bold">{r.voucher_no||'-'}</span>
                <span className={statusBadge(r.is_approved?'approved':'pending')}>{r.is_approved?'Approved':'Pending'}</span>
              </div>
              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between"><span className="text-gray-500 uppercase tracking-wider">Category:</span><span className="font-semibold">{r.category_name||'-'}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 uppercase tracking-wider">Amount:</span><span className="text-rose-700 font-bold text-sm">৳{fmt(r.amount)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 uppercase tracking-wider">Date:</span><span>{r.date}</span></div>
              </div>
            </div>
          ))}
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
