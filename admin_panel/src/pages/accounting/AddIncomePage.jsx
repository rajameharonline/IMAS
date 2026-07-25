// Add Income — multi-line income voucher form।
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import api from '../../utils/api';

const today = () => new Date().toISOString().slice(0,10);
const fmt = (n) => Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

export default function AddIncomePage() {
  const navigate = useNavigate();
  const [accounts,  setAccounts]  = useState([]);
  const [categories,setCategories]= useState([]);
  const [date,      setDate]      = useState(today());
  const [account,   setAccount]   = useState('');
  const [description,setDesc]     = useState('');
  const [lines,     setLines]     = useState([{category:'',amount:0}]);
  const [attachment,setAttachment]= useState(null);
  const [saving,    setSaving]    = useState(false);

  useEffect(()=>{
    api.get('/accounting/chart-of-accounts/',{params:{page_size:500}})
      .then(r=>setAccounts(Array.isArray(r.data)?r.data:(r.data?.results||[])));
    api.get('/accounting/income-categories/')
      .then(r=>setCategories(Array.isArray(r.data)?r.data:(r.data?.results||[])));
  },[]);

  const addLine    = () => setLines(p=>[...p,{category:'',amount:0}]);
  const removeLine = (i) => setLines(p=>p.length===1?[{category:'',amount:0}]:p.filter((_,idx)=>idx!==i));
  const updateLine = (i,k,v) => setLines(p=>{ const u=[...p]; u[i]={...u[i],[k]:v}; return u; });

  const grandTotal = lines.reduce((s,l)=>s+Number(l.amount||0),0);

  const handleSave = async (e) => {
    e.preventDefault();
    if(!account){ toast.error('Account নির্বাচন করুন।'); return; }
    if(lines.every(l=>!l.amount)){ toast.error('অন্তত একটি Amount দিন।'); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('date', date);
      fd.append('account', account);
      fd.append('description', description);
      fd.append('lines', JSON.stringify(lines.filter(l=>Number(l.amount)>0)));
      if(attachment) fd.append('attachment', attachment);
      await api.post('/accounting/income/create-voucher/', fd, {headers:{'Content-Type':'multipart/form-data'}});
      toast.success('Income Voucher সেভ হয়েছে।');
      navigate('/accounting/income');
    } catch(err) {
      toast.error(err?.response?.data?.detail || 'Save ব্যর্থ।');
    } finally { setSaving(false); }
  };

  const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#173d59] focus:outline-none';

  return (
    <div className="p-4 md:p-6 bg-gray-100 min-h-screen">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Add Income</h1>
          <p className="text-sm text-gray-500">Income</p>
        </div>
        <span className="text-xs text-gray-400">Transaction &gt; Add Income</span>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="mb-6">
          <button onClick={()=>navigate('/accounting/income')}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 rounded-full transition-all">
            <ArrowLeft className="w-4 h-4"/> Back to List
          </button>
        </div>

        <form onSubmit={handleSave}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1 uppercase tracking-wide">Date</label>
              <input type="date" value={date} onChange={e=>setDate(e.target.value)} required className={inp} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1 uppercase tracking-wide">Account <span className="text-rose-500">*</span></label>
              <select value={account} onChange={e=>setAccount(e.target.value)} required className={inp}>
                <option value="">Cash on Hand</option>
                {accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>

          {/* Line items */}
          <div className="overflow-x-auto mb-4">
            <table className="w-full border border-gray-200 rounded-xl overflow-hidden">
              <thead className="bg-[#23445f]">
                <tr>
                  <th className="px-4 py-3 text-white text-xs font-semibold uppercase tracking-wider text-left">Category</th>
                  <th className="px-4 py-3 text-white text-xs font-semibold uppercase tracking-wider text-right w-40">Amount</th>
                  <th className="px-4 py-3 text-white text-xs font-semibold uppercase tracking-wider text-center w-16">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lines.map((line,i)=>(
                  <tr key={i} className={i%2===0?'bg-white':'bg-gray-50/50'}>
                    <td className="px-3 py-2">
                      <select value={line.category} onChange={e=>updateLine(i,'category',e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:ring-1 focus:ring-[#173d59] focus:outline-none">
                        <option value="">Uncategorized Income</option>
                        {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min="0" step="0.01" value={line.amount}
                        onChange={e=>updateLine(i,'amount',e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm text-right focus:ring-1 focus:ring-[#173d59] focus:outline-none" />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button type="button" onClick={()=>removeLine(i)}
                        className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors">
                        <Trash2 className="w-4 h-4"/>
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="bg-gray-50 border-t-2 border-gray-200">
                  <td className="px-4 py-3 text-sm font-bold text-gray-700 text-right">Total</td>
                  <td className="px-3 py-3 text-right text-base font-bold text-[#173d59]">{fmt(grandTotal)}</td>
                  <td/>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex justify-end mb-6">
            <button type="button" onClick={addLine}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-full transition-all">
              <Plus className="w-4 h-4"/> Add Row
            </button>
          </div>

          {/* Description */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">Description <span className="text-rose-500">*</span></label>
            <div className="border border-gray-300 rounded-xl overflow-hidden">
              <div className="flex items-center gap-1 px-3 py-2 bg-gray-50 border-b border-gray-200">
                <span className="text-xs text-gray-500 font-medium">Formats ▾</span>
                <div className="w-px h-4 bg-gray-300 mx-1"/>
                <button type="button" className="px-2 py-1 text-sm font-bold text-gray-600 hover:bg-gray-200 rounded">B</button>
                <button type="button" className="px-2 py-1 text-sm italic text-gray-600 hover:bg-gray-200 rounded">I</button>
                <button type="button" className="px-2 py-1 text-sm text-gray-600 hover:bg-gray-200 rounded">≡</button>
                <button type="button" className="px-2 py-1 text-sm text-gray-600 hover:bg-gray-200 rounded">•</button>
                <button type="button" className="px-2 py-1 text-sm text-gray-600 hover:bg-gray-200 rounded">1.</button>
              </div>
              <textarea value={description} onChange={e=>setDesc(e.target.value)} rows={4}
                className="w-full px-4 py-3 text-sm focus:ring-0 focus:outline-none resize-none"
                placeholder="Income description…" />
            </div>
          </div>

          {/* Attachment */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">Attachment</label>
            <input type="file" onChange={e=>setAttachment(e.target.files[0])}
              className="text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-[#173d59] file:text-white hover:file:bg-[#1f5075]" />
          </div>

          <div className="flex justify-end">
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 px-6 py-3 text-sm font-semibold bg-[#173d59] hover:bg-[#1f5075] text-white rounded-full transition-all disabled:opacity-60">
              {saving?<><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Saving…</>
              :<><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>Save</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
