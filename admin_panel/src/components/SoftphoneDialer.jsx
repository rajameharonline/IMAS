// Top-bar আধুনিক softphone — ডিজিটাল ডিসপ্লে (লাইনের নাম/নম্বর/সময়) + dial pad +
// client search (SIP online indicator) + ring sound + context-aware action।
import { useState, useRef, useEffect, useCallback } from 'react';
import { useSoftphone } from '../voip/SoftphoneContext';
import api from '../utils/api';

const STATUS = {
  registered: { color: 'bg-emerald-400', label: 'প্রস্তুত' },
  connecting: { color: 'bg-amber-400',   label: 'সংযোগ হচ্ছে…' },
  failed:     { color: 'bg-rose-500',     label: 'সংযোগ নেই' },
  disabled:   { color: 'bg-slate-400',    label: 'বন্ধ' },
};

const PADS = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['*', ''], ['0', '+'], ['#', ''],
];

function fmtTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// ── Web Audio ring tone (outgoing call) ───────────────────────────────────────
// ক্লাসিক dual-tone ring: 440Hz + 480Hz, ২s বাজে → ৩s বিরতি → repeat।
function useRingTone(active) {
  const ctxRef    = useRef(null);
  const timerRef  = useRef(null);
  const aliveRef  = useRef(false);

  useEffect(() => {
    if (!active) {
      aliveRef.current = false;
      clearTimeout(timerRef.current);
      try { ctxRef.current?.close(); } catch { /* ignore */ }
      ctxRef.current = null;
      return;
    }

    aliveRef.current = true;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    ctxRef.current = ctx;

    function ring() {
      if (!aliveRef.current || !ctxRef.current) return;
      const now = ctx.currentTime;
      [440, 480].forEach((freq) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        // ২s ring: fade-in ০.০৫s, full ১.৯s, fade-out ০.০৫s।
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.25, now + 0.05);
        gain.gain.setValueAtTime(0.25, now + 1.95);
        gain.gain.linearRampToValueAtTime(0, now + 2.0);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 2.0);
      });
      // ২s + ৩s বিরতি = ৫s পর পর ring।
      timerRef.current = setTimeout(ring, 5000);
    }

    // AudioContext suspended হলে (browser autoplay policy) resume করি।
    const tryStart = () => {
      if (ctx.state === 'suspended') ctx.resume().then(ring).catch(() => {});
      else ring();
    };
    tryStart();

    return () => {
      aliveRef.current = false;
      clearTimeout(timerRef.current);
      try { ctx.close(); } catch { /* ignore */ }
      ctxRef.current = null;
    };
  }, [active]);
}

// ── Registered clients hook — Asterisk-এ কোন client SIP online আছে ────────────
// popover খোলা থাকলে ১৫s পর পর poll করে।
function useRegisteredClients(open) {
  const [registered, setRegistered] = useState(new Set());
  const timerRef = useRef(null);

  const fetch = useCallback(async () => {
    try {
      const { data } = await api.get('/voip/registered-clients/');
      setRegistered(new Set(data.registered || []));
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (!open) return;
    fetch();
    timerRef.current = setInterval(fetch, 15000);
    return () => clearInterval(timerRef.current);
  }, [open, fetch]);

  return registered;
}

export default function SoftphoneDialer() {
  const { status, call, startCall, answer, hangup, toggleMute } = useSoftphone();
  const [open, setOpen]       = useState(false);
  const [q, setQ]             = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const ref      = useRef(null);
  const timerRef = useRef(null);

  const st = STATUS[status] || STATUS.connecting;

  const ringingOut = call && call.direction === 'outbound'
    && call.state !== 'Established' && call.state !== 'Terminated';
  const incoming  = call && call.direction === 'inbound'
    && (call.state === 'Initial' || call.state === 'Establishing');
  const active    = call?.state === 'Established';

  // outgoing ring sound।
  useRingTone(!!ringingOut);

  // registered clients indicator।
  const registered = useRegisteredClients(open);

  // কল এলে popover খুলি।
  useEffect(() => { if (call) setOpen(true); }, [!!call]);

  // কল timer।
  useEffect(() => {
    if (!call?.startedAt) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.floor((Date.now() - call.startedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [call?.startedAt]);

  // বাইরে ক্লিক।
  useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !call) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [!!call]);

  const doSearch = useCallback(async (val) => {
    if (!val.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const r = await api.get('/clients/', { params: { search: val.trim(), page_size: 8 } });
      setResults(Array.isArray(r.data) ? r.data : (r.data.results || []));
    } catch { setResults([]); } finally { setLoading(false); }
  }, []);

  const onChange = (val) => {
    setQ(val);
    clearTimeout(timerRef.current);
    if (!val.trim()) { setResults([]); return; }
    timerRef.current = setTimeout(() => doSearch(val), 300);
  };

  const callClient = (c) => {
    startCall(`client_${c.id}`, c.full_name || c.customer_id || `client_${c.id}`);
    setQ(''); setResults([]);
  };
  const callFirst = () => { if (results[0]) callClient(results[0]); };

  const lineName   = call ? (call.displayName || call.peer || 'অজানা') : '';
  const lineNum    = call ? (call.peer || '') : '';
  const stateLabel = incoming  ? 'ইনকামিং কল…'
    : ringingOut ? 'কল করা হচ্ছে…'
    : active     ? fmtTime(elapsed)
    : call       ? 'কল শেষ হচ্ছে…' : '';

  return (
    <div className="relative" ref={ref}>
      {/* ── ফোন বাটন ── */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="কল করুন"
        className={`relative p-1.5 rounded-lg transition-colors ${call ? 'bg-emerald-600/30' : 'hover:bg-[#2a3347]'}`}
      >
        <svg className={`w-[18px] h-[18px] transition-colors ${call ? 'text-emerald-300' : 'text-gray-300 hover:text-white'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
        </svg>
        <span className={`absolute -bottom-0 -right-0 w-2.5 h-2.5 rounded-full border-2 border-[#1c2333] ${call ? 'bg-emerald-400 animate-pulse' : st.color}`} />
      </button>

      {/* ── popover ── */}
      {open && (
        <div className="absolute right-0 top-11 w-[300px] bg-slate-900 rounded-2xl shadow-2xl border border-slate-700 z-[1400] overflow-hidden">

          {/* হেডার */}
          <div className="px-4 py-2.5 flex items-center justify-between border-b border-slate-800">
            <span className="text-sm font-bold text-white tracking-wide">📞 সফটফোন</span>
            <span className="flex items-center gap-1.5 text-[11px] text-slate-300">
              <span className={`w-2 h-2 rounded-full ${st.color}`} /> {st.label}
            </span>
          </div>

          {/* ── ডিজিটাল ডিসপ্লে ── */}
          <div className="mx-3 mt-3 rounded-xl bg-gradient-to-br from-slate-800 to-slate-950 border border-slate-700 px-4 py-3 shadow-inner">
            {call ? (
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-widest text-emerald-400/80">{
                  incoming ? 'ইনকামিং' : ringingOut ? 'আউটগোয়িং' : active ? 'সংযুক্ত' : '—'
                }</div>
                <div className="text-lg font-bold text-white truncate mt-0.5">{lineName}</div>
                <div className="text-xs text-slate-400 font-mono truncate">{lineNum}</div>
                <div className={`text-2xl font-mono mt-1 tabular-nums ${active ? 'text-emerald-300' : 'text-amber-300 animate-pulse'}`}>
                  {stateLabel}
                </div>
              </div>
            ) : (
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-widest text-slate-500">ডায়াল / সার্চ</div>
                <div className="text-2xl font-mono text-white truncate mt-1 min-h-[32px]">{q || <span className="text-slate-600">—</span>}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{results.length ? `${results.length} ক্লায়েন্ট পাওয়া গেছে` : 'নাম / কোড / নম্বর'}</div>
              </div>
            )}
          </div>

          {/* ── কল চলাকালীন actions / idle: search+dialpad ── */}
          {call ? (
            <div className="p-4">
              {/* রিং হচ্ছে — info banner */}
              {ringingOut && (
                <div className="mb-3 flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-400" />
                  </span>
                  <span className="text-xs text-amber-300 font-medium">ক্লায়েন্টের ফোনে রিং হচ্ছে…</span>
                </div>
              )}
              <div className="flex items-center justify-center gap-5">
                {incoming ? (
                  <>
                    <ActionBtn onClick={hangup} color="bg-rose-600 hover:bg-rose-700" label="প্রত্যাখ্যান" icon="reject" />
                    <ActionBtn onClick={answer} color="bg-emerald-600 hover:bg-emerald-700 animate-bounce" label="গ্রহণ" icon="accept" />
                  </>
                ) : (
                  <>
                    <ActionBtn onClick={toggleMute} color={call.muted ? 'bg-amber-600 hover:bg-amber-700' : 'bg-slate-700 hover:bg-slate-600'} label={call.muted ? 'মিউট' : 'মাইক'} icon={call.muted ? 'muted' : 'mic'} />
                    <ActionBtn onClick={hangup} color="bg-rose-600 hover:bg-rose-700" label="কাটুন" icon="reject" />
                  </>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* সার্চ ইনপুট */}
              <div className="px-3 pt-3">
                <div className="relative">
                  <input
                    value={q}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') callFirst(); }}
                    placeholder="নাম / কোড / নম্বর দিয়ে খুঁজুন"
                    className="w-full text-sm bg-slate-800 text-white placeholder-slate-500 border border-slate-700 rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    autoFocus
                  />
                  {q && (
                    <button onClick={() => onChange(q.slice(0, -1))} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white" title="মুছুন">⌫</button>
                  )}
                </div>
              </div>

              {/* ── সার্চ ফলাফল (online indicator সহ) ── */}
              {q.trim() && (
                <div className="max-h-36 overflow-y-auto mx-3 mt-2 rounded-lg bg-slate-800/60">
                  {loading ? (
                    <div className="px-4 py-3 text-xs text-slate-400 text-center">খুঁজছি…</div>
                  ) : results.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-slate-500 text-center">পাওয়া যায়নি</div>
                  ) : (
                    results.map((c) => {
                      const epName  = `client_${c.id}`;
                      const online  = registered.has(epName);
                      return (
                        <button key={c.id} onClick={() => callClient(c)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-emerald-600/20 border-b border-slate-700/50 last:border-0 text-left transition-colors">

                          {/* SIP online indicator — WhatsApp-স্টাইল */}
                          <div className="relative shrink-0">
                            <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-[11px] font-bold text-slate-300 uppercase">
                              {(c.full_name || '?')[0]}
                            </div>
                            {/* online dot */}
                            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-800 ${
                              online ? 'bg-emerald-400' : 'bg-slate-500'
                            }`} title={online ? 'অ্যাপ চালু — কল নিতে প্রস্তুত' : 'অ্যাপ বন্ধ'} />
                          </div>

                          {/* নাম ও নম্বর */}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-white truncate">{c.full_name || '—'}</p>
                            <p className="text-[10px] truncate flex items-center gap-1">
                              <span className="text-slate-400">{c.customer_id || c.id}{c.phone ? ` · ${c.phone}` : ''}</span>
                              {online
                                ? <span className="text-emerald-400 font-medium">● প্রস্তুত</span>
                                : <span className="text-slate-500">● অফলাইন</span>
                              }
                            </p>
                          </div>

                          {/* call বাটন */}
                          <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                            online ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-slate-600 hover:bg-slate-500'
                          }`}>
                            <PhoneSvg className="w-3.5 h-3.5 text-white" />
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}

              {/* registered count hint — dialer খোলা থাকলে */}
              {!q.trim() && registered.size > 0 && (
                <div className="mx-3 mt-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[11px] text-emerald-400">{registered.size} ক্লায়েন্ট অ্যাপ চালু আছে</span>
                </div>
              )}

              {/* dial pad */}
              <div className="grid grid-cols-3 gap-2 p-3">
                {PADS.map(([d, sub]) => (
                  <button key={d} onClick={() => onChange(q + d)}
                    className="flex flex-col items-center justify-center h-12 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-emerald-700 transition-colors">
                    <span className="text-lg font-bold text-white leading-none">{d}</span>
                    {sub && <span className="text-[8px] text-slate-400 tracking-widest mt-0.5">{sub}</span>}
                  </button>
                ))}
              </div>

              {/* কল করুন বাটন */}
              <div className="px-3 pb-4">
                <button onClick={callFirst}
                  disabled={status !== 'registered' || results.length === 0}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-sm font-bold transition-colors shadow-lg shadow-emerald-900/40">
                  <PhoneSvg className="w-4 h-4" /> কল করুন
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PhoneSvg({ className }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  );
}

function ActionBtn({ onClick, color, label, icon }) {
  const icons = {
    accept: <PhoneSvg className="w-6 h-6 text-white" />,
    reject: <svg className="w-6 h-6 text-white rotate-[135deg]" fill="currentColor" viewBox="0 0 24 24"><path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>,
    mic: <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3z" /><path d="M5 11a1 1 0 112 0 5 5 0 0010 0 1 1 0 112 0 7 7 0 01-6 6.93V20h2a1 1 0 110 2H9a1 1 0 110-2h2v-2.07A7 7 0 015 11z" /></svg>,
    muted: <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M3.28 2.22a.75.75 0 00-1.06 1.06l18.5 18.5a.75.75 0 101.06-1.06L3.28 2.22zM12 14a3 3 0 003-3v-.88L9.12 4.24A3 3 0 009 5v6a3 3 0 003 3z" /><path d="M5 11a1 1 0 112 0 5 5 0 007.5 4.33l1.46 1.46A7 7 0 0113 17.93V20h2a1 1 0 110 2H9a1 1 0 110-2h2v-2.07A7 7 0 015 11z" /></svg>,
  };
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5">
      <span className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-colors ${color}`}>
        {icons[icon]}
      </span>
      <span className="text-[11px] text-slate-300 font-medium">{label}</span>
    </button>
  );
}
