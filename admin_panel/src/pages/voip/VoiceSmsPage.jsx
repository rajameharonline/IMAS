// Voice SMS Service — রেকর্ডিং লাইব্রেরি থেকে সংরক্ষিত ভয়েস বেছে, এক্সপায়ারি/স্ট্যাটাস
// অনুযায়ী client select করে স্বয়ংক্রিয় ভয়েস কল পাঠানো।
// (অটোমেটিক শিডিউল এখন System → Automation পেজে।)
import { useState, useRef, useCallback, useEffect } from 'react';
import api from '../../utils/api';

function fmtDate(s) { return s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
function fmtDur(sec) { const n = Number(sec) || 0; const m = Math.floor(n / 60); const s = n % 60; return `${m}:${String(s).padStart(2, '0')}`; }
const STATUS_CLS = {
  active: 'bg-emerald-100 text-emerald-700', expired: 'bg-rose-100 text-rose-700',
  inactive: 'bg-gray-100 text-gray-600', suspended: 'bg-amber-100 text-amber-700',
};

// রেকর্ড/আপলোড অডিও hook।
function useRecorder() {
  const [blob, setBlob] = useState(null);
  const [url, setUrl] = useState('');
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const mediaRef = useRef(null); const chunksRef = useRef([]); const secTimer = useRef(null);
  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream); chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = () => { const b = new Blob(chunksRef.current, { type: 'audio/webm' }); setBlob(b); setUrl(URL.createObjectURL(b)); stream.getTracks().forEach((t) => t.stop()); };
      mr.start(); mediaRef.current = mr; setRecording(true); setSecs(0);
      secTimer.current = setInterval(() => setSecs((s) => s + 1), 1000);
    } catch { /* mic denied */ }
  };
  const stopRec = () => { mediaRef.current?.stop(); setRecording(false); clearInterval(secTimer.current); };
  const onUpload = (e) => { const f = e.target.files?.[0]; if (!f) return; setBlob(f); setUrl(URL.createObjectURL(f)); setSecs(0); };
  const clear = () => { setBlob(null); setUrl(''); setSecs(0); };
  return { blob, url, recording, secs, startRec, stopRec, onUpload, clear };
}

export default function VoiceSmsPage() {
  // ── filter + client list ──
  const [filters, setFilters] = useState({ search: '', status: '', expire_from: '', expire_to: '' });
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const searchTimer = useRef(null);

  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState(null);
  const showToast = (type, msg) => { setToast({ type, msg }); setTimeout(() => setToast(null), 6000); };

  // ── রেকর্ডিং লাইব্রেরি ──
  const [library, setLibrary] = useState([]);
  const [selectedRec, setSelectedRec] = useState(null);   // পাঠানোর জন্য বেছে নেওয়া recording
  const [recTitle, setRecTitle] = useState('');
  const [savingRec, setSavingRec] = useState(false);
  const rec = useRecorder();

  const loadLibrary = useCallback(async () => {
    try {
      const r = await api.get('/voip/voice-recordings/');
      const list = Array.isArray(r.data) ? r.data : (r.data.results || []);
      setLibrary(list);
      // আগের selected হারিয়ে গেলে clear
      setSelectedRec((cur) => (cur && list.some((x) => x.id === cur.id) ? cur : (list[0] || null)));
    } catch { setLibrary([]); }
  }, []);

  const saveRecording = async () => {
    if (!recTitle.trim() || !rec.blob) { showToast('err', 'নাম ও অডিও ফাইল (আপলোড) দিন'); return; }
    setSavingRec(true);
    try {
      const fd = new FormData();
      fd.append('title', recTitle.trim());
      fd.append('duration', String(rec.secs || 0));
      fd.append('audio', rec.blob, rec.blob.name || `rec-${Date.now()}.webm`);
      await api.post('/voip/voice-recordings/', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      showToast('ok', 'রেকর্ডিং সংরক্ষিত হয়েছে');
      setRecTitle(''); rec.clear(); loadLibrary();
    } catch (e) { showToast('err', e.response?.data?.detail || 'সংরক্ষণ করা যায়নি'); }
    finally { setSavingRec(false); }
  };

  const deleteRecording = async (id) => {
    if (!window.confirm('এই রেকর্ডিং মুছবেন?')) return;
    try { await api.delete(`/voip/voice-recordings/${id}/`); loadLibrary(); } catch { showToast('err', 'মোছা যায়নি'); }
  };

  const load = useCallback(async (f) => {
    setLoading(true);
    try {
      const params = {}; Object.entries(f).forEach(([k, v]) => { if (v) params[k] = v; });
      const r = await api.get('/voip/voice-messages/recipients/', { params });
      setRows(r.data.results || []); setCount(r.data.count || 0);
    } catch { setRows([]); setCount(0); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(filters); loadLibrary(); /* eslint-disable-next-line */ }, []);

  // ── এক্সপায়ারির X দিন আগে/পরে — date filter compute ──
  const [offDays, setOffDays] = useState('');
  const [offWhen, setOffWhen] = useState('before');
  const applyOffset = () => {
    const n = parseInt(offDays, 10);
    if (Number.isNaN(n)) return;
    const d = new Date();
    d.setDate(d.getDate() + (offWhen === 'before' ? n : -n));
    const iso = d.toISOString().slice(0, 10);
    const next = { ...filters, expire_from: iso, expire_to: iso };
    setFilters(next); load(next);
  };

  const onFilter = (k, v) => {
    const next = { ...filters, [k]: v }; setFilters(next);
    if (k === 'search') { clearTimeout(searchTimer.current); searchTimer.current = setTimeout(() => load(next), 350); }
    else load(next);
  };
  const reset = () => { const f = { search: '', status: '', expire_from: '', expire_to: '' }; setFilters(f); load(f); };

  const toggle = (id) => { const s = new Set(selected); s.has(id) ? s.delete(id) : s.add(id); setSelected(s); };
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => {
    const s = new Set(selected);
    if (allOnPage) rows.forEach((r) => s.delete(r.id));
    else rows.forEach((r) => s.add(r.id));
    setSelected(s);
  };

  const canSend = selectedRec && selected.size > 0 && !sending;
  const send = async () => {
    if (!canSend) return;
    if (!window.confirm(`"${selectedRec.title}" — ${selected.size} জন ক্লায়েন্টের অ্যাপে স্বয়ংক্রিয় ভয়েস কল পাঠাবেন?`)) return;
    setSending(true);
    try {
      const fd = new FormData();
      fd.append('recording_id', String(selectedRec.id));
      fd.append('client_ids', [...selected].join(','));
      const r = await api.post('/voip/voice-messages/voice_call_broadcast/', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      showToast('ok', `${r.data.queued} জনকে ভয়েস কল পাঠানো হচ্ছে — প্রতিটি কলের ফলাফল VoIP → Call Log-এ দেখুন।`);
      setSelected(new Set());
    } catch (e) { showToast('err', e.response?.data?.detail || 'পাঠানো যায়নি'); }
    finally { setSending(false); }
  };

  return (
    <div className="space-y-4">
      {/* ── header ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2"><span className="text-teal-600">🔊</span> Voice SMS Service</h1>
          <p className="text-xs text-gray-500">সংরক্ষিত রেকর্ডিং বেছে, ক্লায়েন্ট নির্বাচন করে স্বয়ংক্রিয় ভয়েস কল পাঠান</p>
        </div>
        <a href="#/system/settings?tab=automation" className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium">🤖 অটো শিডিউল → Automation</a>
      </div>

      {toast && (
        <div className={`px-4 py-2.5 rounded-lg text-sm font-medium ${toast.type === 'ok' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>{toast.msg}</div>
      )}

      {/* ══ STEP 1 — রেকর্ডিং লাইব্রেরি ══ */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-gradient-to-r from-[#1c2333] to-[#1d3a50] flex items-center justify-between">
          <span className="font-bold text-white flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-teal-500 text-white text-xs flex items-center justify-center font-black">১</span>
            🎙️ রেকর্ডিং লাইব্রেরি
          </span>
          <span className="text-xs text-teal-200">{library.length} টি সংরক্ষিত</span>
        </div>

        {/* নতুন রেকর্ডিং সংরক্ষণ */}
        <div className="px-4 py-3 bg-teal-50/40 border-b border-gray-100 flex flex-wrap items-center gap-2">
          <input value={recTitle} onChange={(e) => setRecTitle(e.target.value)} placeholder="রেকর্ডিং নাম (যেমন: বিল রিমাইন্ডার)"
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 min-w-[200px] flex-1 focus:outline-none focus:ring-2 focus:ring-teal-500" />
          <label className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold cursor-pointer">📂 আপলোড<input type="file" accept="audio/*" onChange={rec.onUpload} className="hidden" /></label>
          {rec.url && (<><audio src={rec.url} controls className="h-8 max-w-[180px]" /><button onClick={rec.clear} className="text-gray-400 hover:text-rose-600" title="বাতিল">✕</button></>)}
          <button onClick={saveRecording} disabled={savingRec || !rec.blob || !recTitle.trim()}
            className="ml-auto px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-bold">{savingRec ? 'সংরক্ষণ…' : '💾 সংরক্ষণ করুন'}</button>
        </div>

        {/* সংরক্ষিত রেকর্ডিং তালিকা — radio দিয়ে একটি বেছে পাঠানো */}
        {library.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">কোনো সংরক্ষিত রেকর্ডিং নেই — উপরে আপলোড করে সংরক্ষণ করুন</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {library.map((lib) => {
              const isSel = selectedRec?.id === lib.id;
              return (
                <div key={lib.id} className={`flex flex-wrap items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${isSel ? 'bg-teal-50' : 'hover:bg-gray-50'}`} onClick={() => setSelectedRec(lib)}>
                  <input type="radio" checked={isSel} onChange={() => setSelectedRec(lib)} className="accent-teal-600 w-4 h-4" />
                  <span className="font-semibold text-gray-800 text-sm">{lib.title}</span>
                  <span className="text-xs text-gray-400">{fmtDur(lib.duration)}</span>
                  {lib.audio && <audio src={lib.audio} controls className="h-8 max-w-[200px]" onClick={(e) => e.stopPropagation()} />}
                  <div className="flex-1" />
                  {isSel && <span className="text-[11px] font-semibold text-teal-700 bg-teal-100 px-2 py-0.5 rounded-full">✓ পাঠানোর জন্য নির্বাচিত</span>}
                  <button onClick={(e) => { e.stopPropagation(); deleteRecording(lib.id); }} className="text-xs px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600">মুছুন</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ══ STEP 2 — ক্লায়েন্ট নির্বাচন ও পাঠানো ══ */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-gradient-to-r from-[#1c2333] to-[#1d3a50] flex items-center justify-between flex-wrap gap-2">
          <span className="font-bold text-white flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-teal-500 text-white text-xs flex items-center justify-center font-black">২</span>
            👥 ক্লায়েন্ট নির্বাচন করে পাঠান
          </span>
          <div className="flex items-center gap-3">
            <span className="text-xs text-teal-200">নির্বাচিত: <b className="text-white">{selected.size}</b> / {count}</span>
            <button onClick={send} disabled={!canSend}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:bg-white/20 disabled:cursor-not-allowed text-white text-sm font-bold transition-colors">
              {sending ? 'পাঠানো হচ্ছে…' : `📞 ভয়েস কল পাঠান (${selected.size})`}
            </button>
          </div>
        </div>

        {/* নির্বাচিত রেকর্ডিং নির্দেশক */}
        <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs flex items-center gap-2">
          {selectedRec
            ? <span className="text-gray-600">🎙️ পাঠানো হবে: <b className="text-teal-700">{selectedRec.title}</b> <span className="text-gray-400">({fmtDur(selectedRec.duration)})</span></span>
            : <span className="text-amber-600">⚠️ উপরে একটি রেকর্ডিং নির্বাচন করুন</span>}
        </div>

        {/* filter bar */}
        <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 border-b border-gray-100">
          <div className="lg:col-span-2 relative">
            <input value={filters.search} onChange={(e) => onFilter('search', e.target.value)} placeholder="নাম / কোড / ফোন খুঁজুন"
              className="w-full text-sm border border-gray-300 rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </div>
          <select value={filters.status} onChange={(e) => onFilter('status', e.target.value)} className="text-sm border border-gray-300 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500">
            <option value="">সব স্ট্যাটাস</option><option value="active">Active</option><option value="expired">Expired</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option>
          </select>
          <input type="date" value={filters.expire_from} onChange={(e) => onFilter('expire_from', e.target.value)} title="এক্সপায়ারি থেকে" className="text-sm border border-gray-300 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500" />
          <div className="flex gap-2">
            <input type="date" value={filters.expire_to} onChange={(e) => onFilter('expire_to', e.target.value)} title="এক্সপায়ারি পর্যন্ত" className="flex-1 text-sm border border-gray-300 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <button onClick={reset} className="px-2 py-2 text-xs rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600" title="রিসেট">✕</button>
          </div>
        </div>

        {/* এক্সপায়ারির X দিন আগে/পরে quick-filter */}
        <div className="px-3 py-2.5 bg-teal-50/50 border-b border-teal-100 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-teal-800">⏱️ এক্সপায়ারির</span>
          <input type="number" min="0" value={offDays} onChange={(e) => setOffDays(e.target.value)} placeholder="0"
            className="w-20 border border-teal-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500" />
          <span className="text-teal-800">দিন</span>
          <select value={offWhen} onChange={(e) => setOffWhen(e.target.value)} className="border border-teal-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500">
            <option value="before">আগে</option><option value="after">পরে</option>
          </select>
          <button onClick={applyOffset} className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold">দেখুন</button>
          <span className="text-xs text-gray-500">(এই তারিখে এক্সপায়ারি যাদের — filter হবে)</span>
        </div>

        {/* client টেবিল */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-[11px] uppercase tracking-wide">
                <th className="px-3 py-2.5 w-10"><input type="checkbox" checked={allOnPage} onChange={toggleAll} className="accent-teal-600 w-4 h-4" /></th>
                <th className="text-left px-3 py-2.5 font-semibold">ক্লায়েন্ট</th>
                <th className="text-left px-3 py-2.5 font-semibold">কোড</th>
                <th className="text-left px-3 py-2.5 font-semibold">ফোন</th>
                <th className="text-left px-3 py-2.5 font-semibold">এক্সপায়ারি</th>
                <th className="text-left px-3 py-2.5 font-semibold">স্ট্যাটাস</th>
                <th className="text-left px-3 py-2.5 font-semibold">অ্যাপ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">লোড হচ্ছে…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">কোনো ক্লায়েন্ট পাওয়া যায়নি</td></tr>
              ) : (
                rows.map((c) => (
                  <tr key={c.id} className={`hover:bg-gray-50 transition-colors cursor-pointer ${selected.has(c.id) ? 'bg-teal-50/60' : ''}`} onClick={() => toggle(c.id)}>
                    <td className="px-3 py-2.5"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} onClick={(e) => e.stopPropagation()} className="accent-teal-600 w-4 h-4" /></td>
                    <td className="px-3 py-2.5 font-semibold text-gray-800">{c.full_name || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{c.customer_id || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{c.phone || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{fmtDate(c.expiry_date)}</td>
                    <td className="px-3 py-2.5"><span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_CLS[c.status] || 'bg-gray-100 text-gray-600'}`}>{c.status || '—'}</span></td>
                    <td className="px-3 py-2.5">{c.has_app ? <span className="text-emerald-600" title="অ্যাপ আছে">📱</span> : <span className="text-gray-300" title="অ্যাপ নেই">—</span>}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-500">মোট {count} জন{count > rows.length ? ` (${rows.length} দেখানো হচ্ছে — filter দিয়ে কমান)` : ''}</div>
      </div>
    </div>
  );
}
