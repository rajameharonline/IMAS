// Send SMS — Template → Message, Group select → Transfer → Users → Send Message।
import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../../utils/api';

const box = 'bg-white rounded-2xl border border-slate-200 shadow-sm';

export default function SendSmsPage() {
  const [channel, setChannel] = useState('sms');   // 'sms' | 'app'
  const [templates, setTemplates] = useState([]);
  const [tplId, setTplId] = useState('');
  const [message, setMessage] = useState('');

  const [groups, setGroups] = useState([]);
  const [selGroups, setSelGroups] = useState(new Set());

  const [users, setUsers] = useState([]);          // transferred recipients
  const [selUsers, setSelUsers] = useState(new Set());
  const [transferring, setTransferring] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api.get('/sms/templates/').then(r => setTemplates(r.data?.results || r.data || [])).catch(() => {});
    api.get('/sms/send/groups/').then(r => setGroups(r.data || [])).catch(() => {});
  }, []);

  const pickTemplate = (id) => {
    setTplId(id);
    const t = templates.find(x => String(x.id) === String(id));
    if (t) setMessage(t.content || '');
  };

  const toggleGroup = (k) => setSelGroups(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleUser  = (id) => setSelUsers(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const transfer = useCallback(async () => {
    if (selGroups.size === 0) { toast.error('আগে অন্তত একটি Group নির্বাচন করুন।'); return; }
    setTransferring(true);
    try {
      const r = await api.get('/sms/send/recipients/', { params: { groups: [...selGroups].join(',') } });
      const list = r.data || [];
      setUsers(list);
      setSelUsers(new Set(list.map(u => u.id)));   // সব auto-select
      toast.success(`${list.length} জন client লোড হয়েছে।`);
    } catch { toast.error('Recipient লোড ব্যর্থ।'); }
    finally { setTransferring(false); }
  }, [selGroups]);

  const allUsersSel = users.length > 0 && users.every(u => selUsers.has(u.id));
  const toggleAllUsers = () => setSelUsers(allUsersSel ? new Set() : new Set(users.map(u => u.id)));

  const isApp = channel === 'app';
  const send = async () => {
    if (!message.trim()) { toast.error('Message লিখুন।'); return; }
    let ids = users.filter(u => selUsers.has(u.id)).map(u => u.id);
    if (isApp) ids = users.filter(u => selUsers.has(u.id) && u.app).map(u => u.id);   // app আছে এমন
    if (ids.length === 0) {
      toast.error(isApp ? 'নির্বাচিতদের মধ্যে কারো অ্যাপ (token) নেই।' : 'অন্তত একজন প্রাপক নির্বাচন করুন।');
      return;
    }
    const where = isApp ? 'অ্যাপে (Push)' : 'SMS';
    if (!window.confirm(`${ids.length} জনকে ${where} পাঠাবেন? ({placeholder} আসল মানে রূপান্তরিত হবে)`)) return;
    setSending(true);
    try {
      const r = await api.post('/sms/send/send/', { client_ids: ids, message, channel });
      if (r.data?.queued) {
        // app push background-এ — সাথে সাথে confirm
        toast.success(`🔔 ${r.data.count} জনের অ্যাপে পাঠানো শুরু হয়েছে (background)। ফলাফল SMS Logs-এ।`);
      } else {
        const ok = (r.data?.results || []).filter(x => x.success).length;
        const fail = (r.data?.results || []).length - ok;
        ok > 0 ? toast.success(`✅ ${ok} টি ${where} পাঠানো হয়েছে${fail ? `, ${fail} ব্যর্থ` : ''}।`)
               : toast.error('কোনো SMS পাঠানো যায়নি — Gateway চেক করুন।');
      }
    } catch (e) { toast.error(e.response?.data?.error || 'পাঠানো ব্যর্থ।'); }
    finally { setSending(false); }
  };

  const th = 'bg-[#23445f] text-white text-xs uppercase';
  return (
    <div className="p-4 md:p-6 bg-gray-100 min-h-screen">
      <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Send Message</h1>
          <p className="text-sm text-gray-500">Template বেছে / লিখে → Group থেকে Transfer → প্রাপক বেছে Send</p>
        </div>
        {/* চ্যানেল: SMS / App Push */}
        <div className="inline-flex rounded-full bg-white border border-slate-200 p-1 shadow-sm">
          <button onClick={() => setChannel('sms')}
            className={`px-4 py-1.5 text-sm font-semibold rounded-full transition ${channel === 'sms' ? 'bg-[#173d59] text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            📱 SMS
          </button>
          <button onClick={() => setChannel('app')}
            className={`px-4 py-1.5 text-sm font-semibold rounded-full transition ${channel === 'app' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            🔔 App (Push)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── বাঁ পাশ: Template + Message + Groups ── */}
        <div className="space-y-4">
          <div className={box + ' p-4'}>
            <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-1">Template</label>
            <select value={tplId} onChange={e => pickTemplate(e.target.value)}
              className="w-full h-9 border border-gray-300 rounded-lg px-3 text-sm outline-none mb-3">
              <option value="">— Select (ঐচ্ছিক) —</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-1">
              Message <span className="text-gray-400 normal-case">({message.length} অক্ষর · {Math.max(1, Math.ceil(message.length / 70))} part)</span>
            </label>
            <textarea rows={5} value={message} onChange={e => setMessage(e.target.value)}
              placeholder="বার্তা লিখুন বা টেমপ্লেট বেছে নিন…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none resize-none focus:ring-2 focus:ring-[#173d59]" />
          </div>

          <div className={box + ' overflow-hidden'}>
            <div className="px-4 py-2.5 border-b border-slate-100 text-xs font-bold uppercase tracking-wide text-gray-500">Groups</div>
            <div className="max-h-72 overflow-y-auto overflow-x-auto">
              <table className="w-full min-w-[400px] text-sm">
                <thead className={th}><tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:text-left"><th className="w-20 !text-center">Select</th><th>Name</th><th className="!text-center w-24">Count</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {groups.map(g => (
                    <tr key={g.key} className="hover:bg-blue-50/40 cursor-pointer" onClick={() => toggleGroup(g.key)}>
                      <td className="px-4 py-2 text-center">
                        <input type="checkbox" checked={selGroups.has(g.key)} onChange={() => toggleGroup(g.key)}
                          className="w-4 h-4 accent-[#173d59]" onClick={e => e.stopPropagation()} />
                      </td>
                      <td className="px-4 py-2 text-gray-700">{g.name}</td>
                      <td className="px-4 py-2 text-center text-gray-400">{g.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end p-3 border-t border-slate-100">
              <button onClick={transfer} disabled={transferring}
                className="rounded-full bg-[#173d59] px-6 py-2 text-sm font-semibold text-white hover:bg-[#1f5075] disabled:opacity-60">
                {transferring ? 'লোড হচ্ছে…' : '➦ Transfer'}
              </button>
            </div>
          </div>
        </div>

        {/* ── ডান পাশ: Users + counts + Send ── */}
        <div className="space-y-4">
          <div className={box + ' overflow-hidden'}>
            <div className="px-4 py-2.5 border-b border-slate-100 text-xs font-bold uppercase tracking-wide text-gray-500">Users (প্রাপক)</div>
            <div className="max-h-[420px] overflow-y-auto overflow-x-auto">
              <table className="w-full min-w-[400px] text-sm">
                <thead className={th}>
                  <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:text-left">
                    <th className="w-20 !text-center">
                      <input type="checkbox" checked={allUsersSel} onChange={toggleAllUsers} className="w-4 h-4 accent-[#173d59]" />
                    </th>
                    <th>Name</th><th>Mobile</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {users.length === 0
                    ? <tr><td colSpan={3} className="text-center py-12 text-gray-400">Group বেছে <b>Transfer</b> চাপুন — প্রাপক এখানে আসবে।</td></tr>
                    : users.map(u => (
                      <tr key={u.id} className="hover:bg-blue-50/40 cursor-pointer" onClick={() => toggleUser(u.id)}>
                        <td className="px-4 py-2 text-center">
                          <input type="checkbox" checked={selUsers.has(u.id)} onChange={() => toggleUser(u.id)}
                            className="w-4 h-4 accent-[#173d59]" onClick={e => e.stopPropagation()} />
                        </td>
                        <td className="px-4 py-2 text-gray-700">
                          {u.name}
                          {u.app
                            ? <span className="ml-1.5 rounded bg-indigo-100 px-1.5 py-0.5 text-[9px] font-bold text-indigo-700 align-middle">🔔 App</span>
                            : isApp && <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-bold text-gray-400 align-middle">no app</span>}
                        </td>
                        <td className="px-4 py-2 text-gray-600 font-mono">{u.mobile}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl bg-[#173d59] text-white px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-white/70">Total Client</p>
              <p className="text-2xl font-bold">{users.length}</p>
            </div>
            <div className="rounded-2xl bg-emerald-600 text-white px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-white/70">Selected Client</p>
              <p className="text-2xl font-bold">{selUsers.size}</p>
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={send} disabled={sending || selUsers.size === 0}
              className={`rounded-full px-8 py-2.5 text-sm font-bold text-white disabled:opacity-50 ${isApp ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
              {sending ? 'পাঠানো হচ্ছে…' : (isApp ? '🔔 Send to App' : '✈ Send SMS')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
