// FCM background handler — অ্যাপ killed/background থাকলেও incoming-call data message
// এলে CallKeep full-screen রিং দেখায়। index.js-এ App register-এর **আগে** import হয়,
// নইলে killed অবস্থায় background handler চলে না।
// ⚠️ @react-native-firebase/messaging native — Expo Go-তে নয়, EAS build লাগবে।
//
// Server (voip_call_listener) data-only high-priority message পাঠায়:
//   data = { type: 'incoming_call', caller, channel }
let messaging = null;
try {
  messaging = require('@react-native-firebase/messaging').default;
} catch (e) {
  messaging = null;
}

import * as SecureStore from 'expo-secure-store';

import {
  displayIncomingCall, bindCallKeepEvents, callKeepState,
  setCallKeepActive, endCallKeepCall,
} from './callKeepService';
import api from './api';

// লাউড-স্পিকার/earpiece routing — background CallKeep-answer path-এও audio session
// চালু করতে হয়, নইলে RTP দুদিকে গেলেও কোনো শব্দ শোনা যায় না (CallContext শুধু
// foreground-এ start করত)। guarded require — native module build-এ না থাকলে skip।
let _InCallManager = null;
try {
  const m = require('react-native-incall-manager');
  _InCallManager = m?.default || m || null;
} catch { _InCallManager = null; }
function _audioStart() {
  if (!_InCallManager) return;
  try { _InCallManager.start({ media: 'audio' }); } catch { /* ignore */ }
}
function _audioStop() {
  if (!_InCallManager) return;
  try { _InCallManager.stop(); } catch { /* ignore */ }
}

// CallKeep answer/end event background-এও দরকার — module load-এই bind।
bindCallKeepEvents();

// ── ring চলাকালীন background-এ SIP register (foreground না এনে) ───────────────
// কেন: managed mode-এ native UI কল দেখায়; answer-এ অ্যাপ foreground আনলে (backToForeground)
// home screen পপ-আপ হয় (বিরক্তিকর)। FCM আসামাত্র এখানে headless register করলে answer-এ
// অ্যাপ না খুলেও SIP কল ধরা যায় → home screen আসে না, audio-ও connect হয়।
// callKeepState.onAnswer/onEnd/onMute সরাসরি sipPhone singleton-এ wire করি (CallContext-ও
// একই singleton wire করে — foreground হলে)।
let _sip = null;
function _sipPhone() {
  if (_sip === null) {
    try { _sip = require('./sipPhone').default; } catch { _sip = false; }
  }
  return _sip || null;
}

async function _ensureSipRegistered() {
  const sip = _sipPhone();
  if (!sip) return;
  // CallKeep native UI বাটন → SIP (singleton)।
  callKeepState.onAnswer = () => sip.answer();
  callKeepState.onEnd    = () => sip.hangup();
  callKeepState.onMute   = (m) => sip.setMuted(m);
  if (sip.ua) {
    // আগেই inited (foreground বা আগের কল) — double-init নয়। তবে background-এ WSS
    // suspend হয়ে থাকতে পারে → wakeRegister: পেন্ডিং backoff বাতিল করে এখনই register
    // (নাহলে বড় backoff delay-এ এই কল মিস হতে পারত)। wakeRegister না থাকলে (পুরনো
    // build) reconnect-এ fallback।
    try { (sip.wakeRegister || sip.reconnect)?.call(sip); } catch { /* ignore */ }
    return;
  }
  try {
    // account_type অনুযায়ী সঠিক creds endpoint — staff হলে agent endpoint (নইলে
    // background-এ staff সবসময় client creds দিয়ে register করত → ভুল/fail)।
    let credsUrl = '/app/voip/sip-credentials/';
    try {
      const t = await SecureStore.getItemAsync('account_type');
      if (t === 'staff') credsUrl = '/app/staff/voip/sip-credentials/';
    } catch { /* ignore — default client */ }
    const { data } = await api.get(credsUrl);
    await sip.init(data, {
      onStatus: () => {},
      onIncoming: () => {},
      onState: (st) => {
        if (!st) { endCallKeepCall(); _audioStop(); return; }
        if (st.state === 'Established') { setCallKeepActive(); _audioStart(); }
        else if (st.state === 'Terminated') { endCallKeepCall(); _audioStop(); }
        // user CallKeep-এ Accept চেপে থাকলে INVITE আসামাত্র auto-answer।
        if (st.direction === 'inbound'
            && (st.state === 'Initial' || st.state === 'Establishing')
            && callKeepState.pendingAnswer) {
          callKeepState.pendingAnswer = false;
          sip.answer();
        }
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[messaging] bg SIP register failed:', e?.message || e);
  }
}

// RFC4122 v4 (crypto ছাড়া — call UUID-এর জন্য যথেষ্ট)।
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// channel → CallKeep UUID ম্যাপ (answer/end correlate করতে)।
const _byChannel = {};
export function uuidForChannel(channel) {
  return channel ? _byChannel[channel] : null;
}

async function _handleIncoming(data) {
  // eslint-disable-next-line no-console
  console.log('[messaging] _handleIncoming data=', JSON.stringify(data || {}));
  if (!data || data.type !== 'incoming_call') return;
  const channel = data.channel || '';
  let uuid = (channel && _byChannel[channel]) || uuidv4();
  if (channel) _byChannel[channel] = uuid;
  callKeepState.currentChannel = channel;
  // caller display নাম — server caller_name পাঠালে সেটা, নইলে ব্র্যান্ড নাম।
  // (কাঁচা "agent_1" দিলে Android "Suspected Spam / 1" দেখায়।)
  const callerName = data.caller_name || 'Rajamehar Online WiFi';
  // in-app CallScreen-ও যেন আসল নাম পায় (SIP INVITE-এ display name না থাকলে)।
  callKeepState.callerName = data.caller_name || '';
  await displayIncomingCall(uuid, callerName);
  // ring চলাকালীন background-এ register (answer-এ অ্যাপ না খুলেই কল ধরা যাবে)।
  _ensureSipRegistered();
}

if (messaging) {
  // killed/background — system JS context-এ চলে।
  messaging().setBackgroundMessageHandler(async (remoteMessage) => {
    try { await _handleIncoming(remoteMessage?.data); } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[messaging] bg handler error:', e?.message || e);
    }
  });
}

// foreground-এ এলে (অ্যাপ খোলা) — এখানেও CallKeep রিং দেখাই।
export function setupForegroundCallMessages() {
  if (!messaging) return () => {};
  return messaging().onMessage(async (remoteMessage) => {
    try { await _handleIncoming(remoteMessage?.data); } catch { /* ignore */ }
  });
}

// FCM registration token (backend-এ পাঠানোর জন্য — expo-notifications-এর বিকল্প/পরিপূরক)।
export async function getFcmToken() {
  if (!messaging) return null;
  try {
    await messaging().registerDeviceForRemoteMessages?.();
    return await messaging().getToken();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[messaging] getToken failed:', e?.message || e);
    return null;
  }
}
