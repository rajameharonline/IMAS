// VoIP কল state — client app-এ incoming/outgoing কল ম্যানেজ করে।
// login থাকলে SIP register করে; admin panel থেকে কল এলে CallScreen দেখায়।
import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';

import api from '../services/api';
import { useAuth } from './AuthContext';
import {
  callKeepState, endCallKeepCall, setCallKeepActive, callKeepAvailable, setupCallKeep,
  setCallAudioRoute,
} from '../services/callKeepService';
import { setupForegroundCallMessages } from '../services/messaging';
import {
  registerKeepaliveTask,
  requestBatteryExemption,
  startPersistentNotification,
  stopPersistentNotification,
} from '../services/backgroundService';
import { startForegroundService, stopForegroundService } from '../services/foregroundService';

const CallContext = createContext(null);
export const useCall = () => useContext(CallContext);

// লাউড স্পিকার রুটিং — react-native-incall-manager (native)। build-এ না থাকলে
// guarded require fail করে; তখন speaker toggle no-op (অ্যাপ crash করবে না)।
let InCallManager = null;
try {
  const m = require('react-native-incall-manager');
  InCallManager = m?.default || m || null;
} catch { InCallManager = null; }
const _speaker = {
  // active call-এ audio session শুরু (একবার), যাতে setForceSpeakerphoneOn কাজ করে
  start() {
    if (!InCallManager) return;
    try { InCallManager.start({ media: 'audio' }); } catch { /* ignore */ }
  },
  stop() {
    if (!InCallManager) return;
    try { InCallManager.setForceSpeakerphoneOn(false); } catch { /* ignore */ }
    try { InCallManager.stop(); } catch { /* ignore */ }
  },
  set(on) {
    // ১) Telecom রুট (self-managed CallKeep-এ এটাই আসল রুট বদলায় — লাউডস্পিকার বাজে)
    try { setCallAudioRoute(on); } catch { /* ignore */ }
    // ২) InCallManager-ও সেট করি (AudioManager flag — দুটো একসাথে নির্ভরযোগ্য)
    if (!InCallManager) return true;
    try { InCallManager.setForceSpeakerphoneOn(on); } catch { /* ignore */ }
    return true;
  },
};

// ── Ringtone (incoming) / Ringback (outgoing) — WhatsApp-এর মতো শব্দ ───────────
// incoming → system ringtone (উচ্চস্বরে); outgoing ring → ringback "tring-tring"।
// answer/established/শেষ-এ থামে। active guard restart spam রোধ করে।
const _ring = {
  active: null,   // 'in' | 'out' | null
  start(kind) {
    if (!InCallManager || this.active === kind) return;
    this.stop();
    try {
      if (kind === 'in') InCallManager.startRingtone('_DEFAULT_');
      else InCallManager.startRingback('_DTMF_');
      this.active = kind;
    } catch { /* ignore */ }
  },
  stop() {
    this.active = null;
    if (!InCallManager) return;
    try { InCallManager.stopRingtone(); } catch { /* ignore */ }
    try { InCallManager.stopRingback(); } catch { /* ignore */ }
  },
};

export function CallProvider({ children }) {
  const { client, staffUser, accountType } = useAuth();
  // SIP register যারা করবে: client (গ্রাহক) ও staff (agent)। creds endpoint আলাদা।
  const sipAccount = client || staffUser;
  const credsUrl = accountType === 'staff'
    ? '/app/staff/voip/sip-credentials/'
    : '/app/voip/sip-credentials/';
  const [status,          setStatus]          = useState('idle');  // idle|connecting|registered|failed|disabled
  const [call,            setCall]            = useState(null);   // null | { direction, peer, state, muted }
  const [error,           setError]           = useState(null);   // কেন register হলো না
  const [supportContacts, setSupportContacts] = useState([]);     // agent endpoint list (DialPad-এর জন্য)
  const [speakerOn,       setSpeakerOn]       = useState(false);  // লাউড স্পিকার চালু কিনা
  const phoneRef = useRef(null);
  const speakerRef = useRef(false);   // _onSipState-এ সর্বশেষ speaker pref re-apply করতে
  const statusRef = useRef('idle');   // watchdog-এ সর্বশেষ status পড়তে
  const callRef   = useRef(null);     // watchdog-এ চলমান কল আছে কিনা পড়তে
  statusRef.current = status;
  callRef.current   = call;

  // ── SIP state ↔ CallKeep সমন্বয় ──────────────────────────────────────────
  // SIP কলের state পরিবর্তনে CallKeep UI আপডেট করি (established→active, শেষ→endCall)।
  function _onSipState(st) {
    // inbound-এ আসল caller নাম (FCM caller_name → callKeepState) in-app screen-এ দেখাই।
    if (st && st.direction === 'inbound' && !st.displayName && callKeepState.callerName) {
      st = { ...st, displayName: callKeepState.callerName };
    }
    setCall(st ? { muted: false, ...st } : null);
    if (!st) {
      endCallKeepCall();
      _ring.stop();
      // কল শেষ → speaker বন্ধ + audio session ছেড়ে দাও
      _speaker.stop();
      speakerRef.current = false; setSpeakerOn(false);
      return;
    }
    if (st.state === 'Established') {
      _ring.stop();   // answer/connect → ring/ringback থামাও
      setCallKeepActive();
      // কল কানেক্ট → audio session শুরু, আগের speaker pref re-apply
      _speaker.start();
      _speaker.set(speakerRef.current);
    } else if (st.state === 'Terminated') {
      _ring.stop();
      endCallKeepCall();
      _speaker.stop();
      speakerRef.current = false; setSpeakerOn(false);
    } else {
      // ringing phase — inbound হলে ringtone, outbound হলে ringback।
      _ring.start(st.direction === 'inbound' ? 'in' : 'out');
    }
    // user ইতিমধ্যে CallKeep-এ Accept চেপে থাকলে, INVITE আসামাত্র auto-answer।
    if (st.direction === 'inbound'
        && (st.state === 'Initial' || st.state === 'Establishing')
        && callKeepState.pendingAnswer) {
      callKeepState.pendingAnswer = false;
      phoneRef.current?.answer();
    }
    // CallKeep-এ reject করা থাকলে INVITE আসামাত্র hangup।
    if (st.direction === 'inbound' && callKeepState.rejected) {
      callKeepState.rejected = false;
      phoneRef.current?.hangup();
    }
  }

  // login থাকলে background persistence সক্রিয় করো; logout-এ বন্ধ।
  useEffect(() => {
    if (sipAccount) {
      // মাইক permission আগেই নিশ্চিত করি — না থাকলে কল answer-এ getUserMedia fail করে
      // (200 OK যায় না, কল active হয় না)। CallKeep ছাড়াও এখানে চাই (নিরাপত্তা)।
      if (Platform.OS === 'android') {
        PermissionsAndroid.requestMultiple([
          'android.permission.RECORD_AUDIO',
          'android.permission.MODIFY_AUDIO_SETTINGS',
        ]).catch(() => {});
      }
      registerKeepaliveTask().catch(() => {});
      requestBatteryExemption().catch(() => {});   // একবার — AsyncStorage-এ flag রাখে
      // Foreground service — অ্যাপ background/lock-এও প্রসেস (ও SIP WSS) জীবিত রাখে →
      // staff সবসময় অনলাইন। notifee FGS persistent visible notification দেখায়।
      startForegroundService().catch(() => {});
      // পুরনো hidden keepalive notification আর দরকার নেই (FGS-ই এখন প্রসেস ধরে রাখে);
      // তবু পুরনো session-এর leftover মুছতে stop ডাকি।
      stopPersistentNotification().catch(() => {});
    } else {
      stopForegroundService().catch(() => {});
      stopPersistentNotification().catch(() => {});
    }
  }, [!!sipAccount]);

  // login থাকলে SIP register; logout-এ destroy।
  useEffect(() => {
    let active = true;
    if (!sipAccount) { _teardown(); return; }
    setError(null);
    (async () => {
      let sipPhone;
      try {
        // sipPhone native module load — Expo Go-তে fail করতে পারে, তাই lazy + guarded।
        sipPhone = require('../services/sipPhone').default;
        phoneRef.current = sipPhone;
      } catch (e) {
        // react-native-webrtc native module build-এ নেই → এখানেই throw।
        // eslint-disable-next-line no-console
        console.warn('[CallContext] sipPhone load failed (native module missing?):', e);
        if (active) { setStatus('failed'); setError('native-module: ' + (e?.message || e)); }
        return;
      }
      try {
        const { data } = await api.get(credsUrl);
        if (!active) return;
        // support agent list — DialPad screen-এ কাকে কল করবে তা জানাতে
        if (data.support_contacts?.length) {
          setSupportContacts(data.support_contacts);
        }
        await sipPhone.init(data, {
          onStatus: (s) => active && setStatus(s),
          onState: (st) => active && _onSipState(st),
          onIncoming: () => { /* CallScreen onState দিয়েই দেখাবে */ },
          onError: (msg) => active && setError(msg),
        });
        // CallKeep Accept/End বাটন → অ্যাপ-side answer/hangup।
        if (callKeepAvailable()) {
          callKeepState.onAnswer = () => phoneRef.current?.answer();
          callKeepState.onEnd    = () => phoneRef.current?.hangup();
          callKeepState.onMute   = (muted) => phoneRef.current?.setMuted(muted);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[CallContext] sip init failed:', e);
        if (active) { setStatus('failed'); setError(e?.message || String(e)); }
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!sipAccount, credsUrl]);

  // অ্যাপ foreground-এ ফিরলে registration হারিয়ে থাকলে আবার reconnect।
  // (Android background-এ WSS suspend হয়; ফিরে এলে দ্রুত register দরকার যাতে কল আসে।)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && sipAccount && phoneRef.current) {
        phoneRef.current.reconnect?.();
      }
    });
    return () => sub.remove();
  }, [!!sipAccount]);

  // ── Connection watchdog ──────────────────────────────────────────────────
  // foreground-এ প্রতি ২৫s চেক: login আছে, কল চলছে না, অথচ status 'registered'
  // নয় → reconnect ট্রিগার। keepAlive dead socket ধরলেও এটা belt-and-suspenders —
  // "সবসময় কানেক্টেড" নিশ্চিত করে (stuck 'connecting'/'failed' থেকে বের করে আনে)।
  useEffect(() => {
    if (!sipAccount) return undefined;
    let stuck = 0;   // পরপর কতবার non-registered পাওয়া গেল (escalation-এর জন্য)
    const id = setInterval(() => {
      // FGS প্রসেস জীবিত রাখে → background-এও চালাই (reopen ছাড়াই অনলাইন থাকে)।
      if (callRef.current) { stuck = 0; return; }         // কল চলাকালে disturb নয়
      if (statusRef.current === 'registered') { stuck = 0; return; }  // সব ঠিক
      stuck += 1;
      // 'failed' → সঙ্গে সঙ্গে সস্তা reconnect (transport+register)।
      if (statusRef.current === 'failed') {
        phoneRef.current?.reconnect?.();
      }
      // দীর্ঘক্ষণ (≈৮০s) registered হতে না পারলে — stuck 'connecting' বা বারবার fail →
      // hardReset (অ্যাপ reopen-এর সমতুল্য: পুরো UA নতুন করে তোলে)। তারপর counter রিসেট,
      // যাতে hardReset spam না হয় ও নতুন চেষ্টাকে সময় দেওয়া যায়। এতে user-কে কখনো
      // ম্যানুয়ালি reopen/re-login করতে হয় না — নিজে নিজেই always-connected ফিরে আসে।
      if (stuck >= 4) {
        stuck = 0;
        phoneRef.current?.hardReset?.();
      }
    }, 20000);
    return () => clearInterval(id);
  }, [!!sipAccount]);

  // foreground-এ FCM incoming-call message এলে CallKeep রিং দেখাই (background
  // handler index.js-এ আলাদা)।
  useEffect(() => {
    if (!sipAccount) return undefined;
    const unsub = setupForegroundCallMessages();
    return () => { try { unsub?.(); } catch { /* ignore */ } };
  }, [!!sipAccount]);

  // অ্যাপ চালু হলেই CallKeep PhoneAccount register করি (foreground)। একবার register
  // হলে Android Telecom-এ স্থায়ীভাবে থাকে → অ্যাপ killed হলেও background handler-এর
  // displayIncomingCall কাজ করে। (নইলে account না থাকায় রিং দেখায় না।)
  useEffect(() => {
    if (callKeepAvailable()) { setupCallKeep().catch(() => {}); }
  }, []);

  function _teardown() {
    try { phoneRef.current?.destroy?.(); } catch { /* ignore */ }
    phoneRef.current = null;
    setStatus('idle');
    setCall(null);
  }

  const answer    = useCallback(() => phoneRef.current?.answer(), []);
  const hangup    = useCallback(() => phoneRef.current?.hangup(), []);
  // target = SIP endpoint (যেমন support নম্বর বা client_<id>); displayName = UI নাম
  const startCall = useCallback((target, displayName) => phoneRef.current?.call(target, displayName), []);
  const sendDtmf  = useCallback((tone) => phoneRef.current?.sendDtmf(tone), []);
  const toggleMute = useCallback(() => {
    setCall((c) => {
      if (!c) return c;
      const muted = !c.muted;
      phoneRef.current?.setMuted(muted);
      return { ...c, muted };
    });
  }, []);
  // লাউড স্পিকার toggle — সব অ্যাপের dialpad/call screen থেকে ব্যবহৃত
  const toggleSpeaker = useCallback(() => {
    setSpeakerOn((prev) => {
      const next = !prev;
      _speaker.set(next);
      speakerRef.current = next;
      return next;
    });
  }, []);

  return (
    <CallContext.Provider value={{ status, error, call, supportContacts, answer, hangup, startCall, toggleMute, speakerOn, toggleSpeaker, sendDtmf }}>
      {children}
    </CallContext.Provider>
  );
}
