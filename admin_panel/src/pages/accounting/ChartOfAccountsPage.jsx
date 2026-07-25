// Chart of Accounts — Account Type tab-এ grouped, Add Account modal সহ।
import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Plus, SquarePen } from 'lucide-react';
import api from '../../utils/api';

function AccountModal({ open, onClose, onSave, accountTypes, editData }) {
  const [form, setForm] = useState({ account_type: '', name: '', code: '', description: '', is_active: true });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editData) {
      setForm({ account_type: editData.account_type || '', name: editData.name || '',
        code: editData.code || '', description: editData.description || '', is_active: editData.is_active !== false });
    } else {
      setForm({ account_type: '', name: '', code: '', description: '', is_active: true });
    }
  }, [editData, open]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.account_type || !form.name) { toast.error('Account Type ও Name আবশ্যক।'); return; }
    setSaving(true);
    try {
      if (editData?.id) {
        await api.patch(`/accounting/chart-of-accounts/${editData.id}/`, form);
        toast.success('Account আপডেট হয়েছে।');
      } else {
        await api.post('/accounting/chart-of-accounts/', form);
        toast.success('Account তৈরি হয়েছে।');
      }
      onSave(); onClose();
    } catch (err) {
      const d = err?.response?.data;
      toast.error(d ? JSON.stringify(d).slice(0,120) : 'Save ব্যর্থ।');
    } finally { setSaving(false); }
  };

  if (!open) return null;
  const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#173d59] focus:outline-none';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b bg-[#23445f] rounded-t-2xl">
          <h3 className="text-base font-bold text-white">{editData?.id ? 'Edit Account' : 'Add Account'}</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSave} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Account Type <span className="text-rose-500">*</span></label>
            <select value={form.account_type} onChange={e=>setForm(p=>({...p,account_type:e.target.value}))} required className={inp}>
              <option value="">Select Account Type</option>
              {accountTypes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Account Name <span className="text-rose-500">*</span></label>
            <input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} required className={inp} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Account Description</label>
            <textarea value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))} rows={3} className={inp+' resize-none'} />
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-rose-600 border border-rose-300 rounded-lg hover:bg-rose-50">Cancel</button>
            <button type="submit" disabled={saving} className="px-5 py-2 text-sm font-semibold bg-[#173d59] hover:bg-[#1f5075] text-white rounded-full disabled:opacity-60">
              {saving?'Saving…':'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ChartOfAccountsPage() {
  const [accounts,     setAccounts]     = useState([]);
  const [accountTypes, setAccountTypes] = useState([]);
  const [activeType,   setActiveType]   = useState(null);
  const [statusFilter, setStatusFilter] = useState('active');
  const [modalOpen,    setModalOpen]    = useState(false);
  const [editData,     setEditData]     = useState(null);
  const [loading,      setLoading]      = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [acctR,typeR] = await Promise.all([
        api.get('/accounting/chart-of-accounts/', {params:{page_size:500}}),
        api.get('/accounting/account-types/'),
      ]);
      const all   = Array.isArray(acctR.data) ? acctR.data : (acctR.data?.results||[]);
      const types = Array.isArray(typeR.data) ? typeR.data : (typeR.data?.results||[]);
      setAccounts(all); setAccountTypes(types);
      if (types.length>0) setActiveType(p=>p||types[0].id);
    } catch { toast.error('লোড ব্যর্থ।'); }
    finally { setLoading(false); }
  }, []);

  useEffect(()=>{ fetchData(); },[fetchData]);

  const openAdd  = () => { setEditData(null); setModalOpen(true); };
  const openEdit = (a) => { setEditData(a); setModalOpen(true); };

  const handleToggle = async (a) => {
    try {
      await api.patch(`/accounting/chart-of-accounts/${a.id}/`,{is_active:!a.is_active});
      toast.success(`Account ${a.is_active?'নিষ্ক্রিয়':'সক্রিয়'} হয়েছে।`);
      fetchData();
    } catch { toast.error('Update ব্যর্থ।'); }
  };

  const filtered = accounts.filter(a=>{
    if(statusFilter==='active')   return a.is_active;
    if(statusFilter==='inactive') return !a.is_active;
    return true;
  });
  const typeAccounts = filtered.filter(a=>a.account_type===activeType);
  const grouped = {};
  typeAccounts.forEach(a=>{
    const par = accounts.find(p=>p.id===a.parent);
    const key = par ? par.name : 'General';
    if(!grouped[key]) grouped[key]=[];
    grouped[key].push(a);
  });
  const typeCounts = {};
  accountTypes.forEach(t=>{ typeCounts[t.id]=filtered.filter(a=>a.account_type===t.id).length; });

  return (
    <div className="p-4 md:p-6 bg-gray-100 min-h-screen">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Chart of Accounts</h1>
          <p className="text-sm text-gray-500">List of Accounts</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">Accounting &gt; Chart of Accounts</span>
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-[#173d59] hover:bg-[#1f5075] text-white rounded-full transition-all">
            <Plus className="w-4 h-4"/> Create New Account
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-3 mb-5">
          <label className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Filter by Status</label>
          <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#173d59] focus:outline-none">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </div>

        <div className="flex flex-wrap gap-2 mb-6 border-b border-gray-200 pb-4">
          {accountTypes.map(t=>(
            <button key={t.id} onClick={()=>setActiveType(t.id)}
              className={`px-4 py-2 text-sm font-semibold rounded-full border transition-all ${activeType===t.id?'bg-[#23445f] text-white border-[#23445f]':'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
              {t.name}{typeCounts[t.id]?` (${typeCounts[t.id]})`:' (0)'}
            </button>
          ))}
        </div>

        {loading ? <p className="text-center text-gray-400 py-12">Loading…</p>
        : typeAccounts.length===0 ? <p className="text-center text-gray-400 py-12">এই category-তে কোনো account নেই।</p>
        : Object.entries(grouped).map(([groupName,items])=>(
          <div key={groupName} className="mb-6">
            <div className="flex items-center justify-between bg-[#23445f] text-white px-4 py-3 rounded-t-xl">
              <span className="text-sm font-bold flex items-center gap-2">
                {groupName}
                <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">{items.length} accounts</span>
              </span>
              <button onClick={()=>{setEditData({account_type:activeType});setModalOpen(true);}}
                className="flex items-center gap-1 text-xs px-3 py-1 bg-white/20 hover:bg-white/30 rounded-full transition-all">
                <Plus className="w-3 h-3"/> Create New Account
              </button>
            </div>
            <div className="border border-gray-200 rounded-b-xl overflow-x-auto">
              {items.length===0 ? <p className="px-4 py-4 text-sm text-gray-400">No Data Found</p>
              : <table className="w-full min-w-[500px] text-sm divide-y divide-gray-100">
                <tbody>
                  {items.map((acct,i)=>(
                    <tr key={acct.id} className={`${i%2===0?'bg-white':'bg-gray-50/50'} hover:bg-blue-50/30 transition-colors`}>
                      <td className="px-4 py-3 text-gray-500 w-20 font-mono text-xs">{acct.code}</td>
                      <td className="px-4 py-3 text-blue-600 font-medium">{acct.name}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs truncate max-w-xs">{acct.description}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={()=>openEdit(acct)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                            <SquarePen className="w-4 h-4"/>
                          </button>
                          <button onClick={()=>handleToggle(acct)}
                            className={`text-xs px-2 py-1 rounded-full font-medium transition-all ${acct.is_active?'bg-emerald-100 text-emerald-700 hover:bg-emerald-200':'bg-rose-100 text-rose-700 hover:bg-rose-200'}`}>
                            {acct.is_active?'Active':'Inactive'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>}
            </div>
          </div>
        ))}
      </div>
      <AccountModal open={modalOpen} onClose={()=>setModalOpen(false)} onSave={fetchData} accountTypes={accountTypes} editData={editData} />
    </div>
  );
}
