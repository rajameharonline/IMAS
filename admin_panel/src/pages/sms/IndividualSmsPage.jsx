// Individual SMS — একজন নির্দিষ্ট client খুঁজে message/template পাঠানো (SMS বা App)।
import { useEffect, useState, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../../utils/api';

const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#173d59] focus:outline-none';
const lbl = 'block text-xs font-bold uppercase tracking-wide text-gray-500 mb-1';

export default function IndividualSmsPage() {
  const [channel, setChannel] = useState('sms');   // 'sms' | 'app'
  const [templates, setTemplates] = useState([]);
  const [tplId, setTplId] = useState('');
  const [message, setMessage] = useState('');

  // client search
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [client, setClient] = useState(null);   // নির্বাচিত client
  const [open, setOpen] = useState(false);

  const [preview, setPreview] = useState('');
  const [sending, setSending] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => { api.get('/sms/templates/').then(r => setTemplates(r.data?.results || r.data || [])).catch(() => {}); }, []);

  // client search (debounced)
  useEffect(() => {
    if (!q.trim() || client) { setResults([]); return; }
    const t = setTimeout(() => {
      api.get('/clients/portal-lookup/', { params: { search: q.trim() } })
        .then(r => { setResults(r.data || []); setOpen(true); }).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [q, client]);

  // বাইরে ক্লিকে dropdown বন্ধ
  useEffect(() => {
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);

  const pickClient = (c) => { setClient(c); setQ(`${c.customer_id} — ${c.full_name}`); setOpen(false); };
  const clearClient = () => { setClient(null); setQ(''); setPreview(''); };

  const pickTemplate = (id) => {
    setTplId(id);
    const t = templates.find(x => String(x.id) === String(id));
    if (t) setMessage(t.content || '');
  };

  // live preview (client + message বদলালে)
  const refreshPreview = useCallback(async () => {
    if (!client || !message.trim()) { setPreview(''); return; }
    try {
      const r = await api.post('/sms/send/preview/', { client_id: client.id, message });
      setPreview(r.data?.rendered || '');
    } catch { setPreview(''); }
  }, [client, message]);
  useEffect(() => { const t = setTimeout(refreshPreview, 400); return () => clearTimeout(t); }, [refreshPreview]);

  const isApp = channel === 'app';
  const send = async () => {
    if (!client) { toast.error('আগে একজন client নির্বাচন করুন।'); return; }
    if (!message.trim()) { toast.error('Message লিখুন।'); return; }
    if (isApp && !client.app) { toast.error('এই client-এর অ্যাপ (token) নেই — SMS দিয়ে পাঠান।'); return; }
    setSending(true);
    try {
      const r = await api.post('/sms/send/send/', { client_ids: [client.id], message, channel });
      if (r.data?.queued) {
        toast.success('🔔 অ্যাপে পাঠানো শুরু হয়েছে (background)।');
      } else {
        const ok = (r.data?.results || []).filter(x => x.success).length;
        ok > 0 ? toast.success(`✅ ${isApp ? 'অ্যাপে' : 'SMS'} পাঠানো হয়েছে।`)
               : toast.error(isApp ? 'অ্যাপে পাঠানো যায়নি।' : 'SMS পাঠানো যায়নি — Gateway চেক করুন।');
      }
    } catch (e) { toast.error(e.response?.data?.error || 'পাঠানো ব্যর্থ।'); }
    finally { setSending(false); }
  };

  return (
    <div className="p-4 md:p-6 bg-gray-100 min-h-screen">
      <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Individual SMS</h1>
          <p className="text-sm text-gray-500">একজন নির্দিষ্ট client-কে SMS বা App message পাঠান</p>
        </div>
        <div className="inline-flex rounded-full bg-white border border-slate-200 p-1 shadow-sm">
          <button onClick={() => setChannel('sms')}
            className={`px-4 py-1.5 text-sm font-semibold rounded-full transition ${channel === 'sms' ? 'bg-[#173d59] text-white' : 'text-slate-600 hover:bg-slate-50'}`}>📱 SMS</button>
          <button onClick={() => setChannel('app')}
            className={`px-4 py-1.5 text-sm font-semibold rounded-full transition ${channel === 'app' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>🔔 App (Push)</button>
        </div>
      </div>

      <div className="max-w-2xl space-y-4">
        {/* Client search */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <label className={lbl}>Client (নাম / ID / মোবাইল দিয়ে খুঁজুন)</label>
          <div className="relative" ref={boxRef}>
            <input className={inp} value={q} placeholder="যেমন: 5555 বা Amir বা 01303…"
              onChange={e => { setQ(e.target.value); if (client) setClient(null); }}
              onFocus={() => results.length && setOpen(true)} />
            {client && (
              <button onClick={clearClient} className="absolute right-2 top-2 text-slate-400 hover:text-red-500 text-lg">×</button>
            )}
            {open && results.length > 0 && !client && (
              <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                {results.map(c => (
                  <button key={c.id} onClick={() => pickClient(c)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-blue-50">
                    <span><b className="text-gray-800">{c.customer_id}</b> · {c.full_name}
                      {c.app && <span className="ml-1.5 rounded bg-indigo-100 px-1 text-[9px] font-bold text-indigo-700">🔔</span>}
                    </span>
                    <span className="text-gray-400 font-mono text-xs">{c.phone}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {client && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
              <span>👤 <b>{client.full_name}</b></span>
              <span>📞 {client.phone || '—'}</span>
              <span>🗺 {client.zone || '—'}</span>
              <span className={client.app ? 'text-indigo-600' : 'text-gray-400'}>{client.app ? '🔔 App আছে' : 'App নেই'}</span>
            </div>
          )}
        </div>

        {/* Template + Message */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
          <div>
            <label className={lbl}>Template (ঐচ্ছিক)</label>
            <select className={inp} value={tplId} onChange={e => pickTemplate(e.target.value)}>
              <option value="">— Select —</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Message <span className="text-gray-400 normal-case">({message.length} অক্ষর · {Math.max(1, Math.ceil(message.length / 70))} part)</span></label>
            <textarea rows={4} className={inp + ' resize-none'} value={message}
              onChange={e => setMessage(e.target.value)} placeholder="বার্তা লিখুন বা template বেছে নিন… {CustomerName}, {Due} ইত্যাদি" />
          </div>
          {/* Live preview */}
          {client && preview && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <p className="text-[10px] font-bold uppercase text-emerald-600 mb-0.5">Preview ({client.full_name}-এর জন্য)</p>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{preview}</p>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <button onClick={send} disabled={sending || !client}
            className={`rounded-full px-8 py-2.5 text-sm font-bold text-white disabled:opacity-50 ${isApp ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
            {sending ? 'পাঠানো হচ্ছে…' : (isApp ? '🔔 Send to App' : '✈ Send SMS')}
          </button>
        </div>
      </div>
    </div>
  );
}
