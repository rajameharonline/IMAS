// Floating softphone widget — incoming/active কল UI। Layout-এ globally mount।
import { useEffect, useState } from 'react';
import { SessionState } from 'sip.js';
import { useSoftphone } from '../voip/SoftphoneContext';

function CallTimer({ startedAt }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  if (!startedAt) return null;
  const s = Math.floor((Date.now() - startedAt) / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return <span className="font-mono text-sm">{mm}:{ss}</span>;
}

export default function SoftphoneWidget() {
  const sp = useSoftphone();
  if (!sp) return null;
  const { status, call, answer, hangup, toggleMute } = sp;

  // কল না থাকলে শুধু একটা ছোট status dot (registered হলে)।
  if (!call) {
    if (status === 'disabled') return null; // VoIP বন্ধ → কিছুই দেখাই না
    const color = status === 'registered' ? 'bg-green-500'
                : status === 'failed' ? 'bg-rose-500' : 'bg-amber-400';
    const label = status === 'registered' ? 'ফোন প্রস্তুত'
                : status === 'failed' ? 'ফোন সংযোগ নেই' : 'সংযোগ হচ্ছে…';
    return (
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 shadow-md border border-slate-200">
        <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
        <span className="text-xs text-gray-600">{label}</span>
      </div>
    );
  }

  const incoming = call.direction === 'inbound'
    && (call.state === SessionState.Initial || call.state === SessionState.Establishing);
  const established = call.state === SessionState.Established;
  const ringingOut = call.direction === 'outbound' && !established;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
      <div className="bg-[#173d59] text-white px-4 py-3">
        <div className="text-xs uppercase tracking-wider opacity-70">
          {incoming ? 'ইনকামিং কল' : ringingOut ? 'কল করা হচ্ছে…' : 'কল চলছে'}
        </div>
        <div className="text-lg font-semibold truncate">{call.displayName || call.peer}</div>
        <div className="text-xs opacity-80">
          {established ? <CallTimer startedAt={call.startedAt} /> : (call.peer)}
        </div>
      </div>

      <div className="flex items-center justify-center gap-3 px-4 py-4">
        {incoming && (
          <button
            onClick={answer}
            className="flex-1 min-h-[44px] rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
          >
            উত্তর দিন
          </button>
        )}
        {established && (
          <button
            onClick={toggleMute}
            className={`min-h-[44px] min-w-[44px] rounded-full text-sm font-semibold border ${
              call.muted ? 'bg-amber-100 border-amber-400 text-amber-700' : 'bg-white border-slate-300 text-gray-700'
            }`}
            title={call.muted ? 'Unmute' : 'Mute'}
          >
            {call.muted ? '🔇' : '🎤'}
          </button>
        )}
        <button
          onClick={hangup}
          className="flex-1 min-h-[44px] rounded-full bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold"
        >
          {incoming ? 'প্রত্যাখ্যান' : 'কল কাটুন'}
        </button>
      </div>
    </div>
  );
}
