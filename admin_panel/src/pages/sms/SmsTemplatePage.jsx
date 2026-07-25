// SMS Template management — {placeholder} সহ template তৈরি/সম্পাদনা।
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import toast from 'react-hot-toast';
import api from '../../utils/api';

// ক্লিক করে body-তে বসানো যায় এমন placeholder (variable)
const PLACEHOLDERS = [
  'CompanyName', 'CompanyMobile', 'CustomerName', 'ClientID', 'UserName', 'Password',
  'Package', 'MonthlyBillAmount', 'Due', 'PaidAmount', 'BillingLastDate', 'PaymentDue',
  'InvoiceId', 'ReceiptAmount', 'Zone', 'Address', 'CustomerNumber', 'MonthName',
  'VerificationCode', 'TicketNo', 'Problem', 'EmpName', 'PaymentDate', 'BaseSiteURL',
];

const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#173d59] focus:outline-none';

export default function SmsTemplatePage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(null);   // null = modal বন্ধ
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get('/sms/templates/'); setRows(r.data?.results || r.data || []); }
    catch { toast.error('লোড ব্যর্থ।'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => rows.filter(t =>
    !search || t.name?.toLowerCase().includes(search.toLowerCase())
            || t.content?.toLowerCase().includes(search.toLowerCase())), [rows, search]);

  // cursor অবস্থানে placeholder বসায়
  const insertPlaceholder = (ph) => {
    const tag = `{${ph}}`;
    const el = bodyRef.current;
    const cur = form.content || '';
    if (el && typeof el.selectionStart === 'number') {
      const s = el.selectionStart, e = el.selectionEnd;
      const next = cur.slice(0, s) + tag + cur.slice(e);
      setForm(f => ({ ...f, content: next }));
      requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = s + tag.length; });
    } else {
      setForm(f => ({ ...f, content: cur + tag }));
    }
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error('Template Name দিন।'); return; }
    if (!form.content.trim()) { toast.error('Message Body দিন।'); return; }
    setSaving(true);
    try {
      if (form.id) await api.patch(`/sms/templates/${form.id}/`, form);
      else await api.post('/sms/templates/', { ...form, template_type: 'custom' });
      toast.success('সেভ হয়েছে।'); setForm(null); load();
    } catch (e) { toast.error(e.response?.data?.name?.[0] || 'সেভ ব্যর্থ।'); }
    finally { setSaving(false); }
  };

  const remove = async (t) => {
    if (!window.confirm(`"${t.name}" মুছবেন?`)) return;
    try { await api.delete(`/sms/templates/${t.id}/`); toast.success('মুছে ফেলা হয়েছে।'); load(); }
    catch { toast.error('মুছতে ব্যর্থ।'); }
  };

  return (
    <div className="p-4 md:p-6 bg-gray-100 min-h-screen">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-800">SMS Template</h1>
          <p className="text-sm text-gray-500">{'{'}placeholder{'}'} সহ বার্তার টেমপ্লেট তৈরি ও সম্পাদনা</p>
        </div>
        <button onClick={() => setForm({ name: '', content: '', is_active: true })}
          className="px-4 py-2 text-sm font-semibold bg-[#173d59] text-white rounded-full hover:bg-[#1f5075]">
          + Add Template
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <span className="text-xs text-slate-500">মোট: <strong>{filtered.length}</strong> টেমপ্লেট</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
            className="h-8 w-56 border border-gray-300 rounded-lg px-3 text-sm outline-none" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-[#23445f] text-white text-xs uppercase">
              <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:text-left [&>th]:border-r [&>th]:border-white/10">
                <th className="!text-center w-14">#</th>
                <th className="w-56">Template Name</th>
                <th className="!text-center w-24">Type</th>
                <th>Template</th>
                <th className="!text-center w-24 !border-r-0">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? <tr><td colSpan={5} className="text-center py-10 text-gray-400">Loading…</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={5} className="text-center py-10 text-gray-400">কোনো টেমপ্লেট নেই — "Add Template" দিয়ে যোগ করুন।</td></tr>
              : filtered.map((t, i) => (
                <tr key={t.id} className="hover:bg-blue-50/40 align-top">
                  <td className="px-4 py-3 text-center text-gray-400 font-mono">{i + 1}</td>
                  <td className="px-4 py-3 font-semibold text-gray-800">{t.name}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${t.template_type === 'default' ? 'bg-slate-200 text-slate-700' : 'bg-blue-100 text-blue-700'}`}>
                      {t.template_type === 'default' ? 'Default' : 'Custom'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 leading-relaxed">
                    {/* {placeholder}-গুলো হাইলাইট করে দেখাই */}
                    {String(t.content || '').split(/(\{[^}]+\})/g).map((part, j) =>
                      /^\{[^}]+\}$/.test(part)
                        ? <span key={j} className="rounded bg-amber-100 px-1 text-amber-700 font-medium">{part}</span>
                        : <span key={j}>{part}</span>)}
                  </td>
                  <td className="px-4 py-3 text-center whitespace-nowrap">
                    <button onClick={() => setForm({ ...t })}
                      className="mr-2 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">Edit</button>
                    <button onClick={() => remove(t)}
                      className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-100">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Add/Edit Modal ── */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-[#1d435d] px-5 py-3 sticky top-0">
              <span className="font-bold text-white">{form.id ? 'Edit' : 'Add'} SMS Template</span>
              <button onClick={() => setForm(null)} className="text-xl text-white/70 hover:text-white">×</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase">Template Name</label>
                <input className={inp} value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase">Message Body</label>
                <textarea ref={bodyRef} rows={5} className={inp + ' resize-none'} value={form.content}
                  onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                  placeholder="প্রিয় {CustomerName}, ..." />
                <p className="text-[11px] text-gray-400 mt-1">
                  {(form.content || '').length} অক্ষর ≈ {Math.max(1, Math.ceil((form.content || '').length / 70))} SMS part
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase">Variables (ক্লিক করে বসান)</label>
                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                  {PLACEHOLDERS.map(ph => (
                    <button key={ph} type="button" onClick={() => insertPlaceholder(ph)}
                      className="rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-100">
                      {'{'}{ph}{'}'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-gray-200 bg-gray-50 px-5 py-3 sticky bottom-0">
              <button onClick={() => setForm(f => ({ ...f, content: '' }))}
                className="rounded-full bg-red-500 px-5 py-1.5 text-sm font-semibold text-white hover:bg-red-600">Clear</button>
              <button onClick={save} disabled={saving}
                className="rounded-full bg-[#173d59] px-6 py-1.5 text-sm font-semibold text-white hover:bg-[#1f5075] disabled:opacity-60">
                {saving ? 'সেভ হচ্ছে…' : 'Save'}
              </button>
              <button onClick={() => setForm(null)}
                className="rounded-full border border-gray-300 px-5 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-100">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
