// CallKeep — অ্যাপ বন্ধ/background থাকলেও ফোনের মতো full-screen incoming-call UI।
// FCM background handler (index.js) এখান থেকে displayIncomingCall() ডাকে।
// ⚠️ native module — Expo Go-তে নয়, EAS build লাগবে। require গার্ডেড।
//
// ✅ end-to-end লাইভ (2026-06-16): app-closed → full-screen ring → answer → দুমুখী audio।
// গুরুত্বপূর্ণ শর্ত (পরের dev পড়ুন):
//   - selfManaged রাখতেই হবে (managed-এ বদলালে "cannot change self-managed account" crash;
//     ফেরাতে uninstall+reinstall)।
//   - READ_PHONE_NUMBERS runtime perm আবশ্যক (নইলে getPhoneAccount SecurityException crash) —
//     fresh install-এ Settings→Apps→Permissions→Phone→Allow।
//   - foregroundService.notificationIcon আবশ্যক (নইলে Android 14 broken-notification crash)।
//   - React Native New Arch (RN 0.81)-এ callkeep চলতে patches/react-native-callkeep+4.3.16.patch।
//
// Stage 1: শুধু রিং দেখানো + answer/end event ধরা। আসল SIP audio connect
// (Stage 2: server orchestrated ARI originate) পরে — এখানে pendingAnswer flag
// রাখা হয় যাতে অ্যাপ foreground-এ এসে register হলে কল answer করা যায়।
import { PermissionsAndroid, Platform } from 'react-native';

let RNCallKeep = null;
try {
  const mod = require('react-native-callkeep');
  // ES default (`export default new RNCallKeep()`) → mod.default; fallback mod।
  RNCallKeep = (mod && (mod.default || mod)) || null;
  if (RNCallKeep && typeof RNCallKeep.setup !== 'function') RNCallKeep = null;
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn('[callKeep] require react-native-callkeep failed:', e?.message || e);
  RNCallKeep = null;
}
// eslint-disable-next-line no-console
console.log('[callKeep] module init: present=', !!RNCallKeep,
  'hasSetup=', !!(RNCallKeep && RNCallKeep.setup));

let _endTimer = null;     // SIP establish না হলে auto-end timer

// module-level shared state — background handler ও CallContext উভয়ে পড়ে।
export const callKeepState = {
  currentUUID: null,      // চলমান CallKeep কলের UUID
  pendingAnswer: false,   // user CallKeep-এ Accept চেপেছে → অ্যাপ register হলে answer
  rejected: false,        // user reject করেছে
  established: false,      // SIP session সত্যিই connect হয়েছে কিনা (auto-end গার্ড)
  // CallContext register করে এগুলো সেট করবে:
  onAnswer: null,         // () => void  (অ্যাপ-side answer)
  onEnd: null,            // () => void  (অ্যাপ-side hangup)
  onMute: null,           // (muted) => void  (native mute → SIP mic)
};

let _setupDone = false;

const SETUP_OPTIONS = {
  ios: { appName: 'Rajamehar Online' },
  android: {
    alertTitle: 'অনুমতি প্রয়োজন',
    alertDescription: 'কল রিসিভ করতে অ্যাপটিকে ফোন কল ম্যানেজ করার অনুমতি দিন',
    cancelButton: 'বাতিল',
    okButton: 'ঠিক আছে',
    additionalPermissions: [],
    // ⭐ self-managed mode — WhatsApp/Messenger/IMO যেভাবে করে। managed mode (false)-এ
    // Android Telecom কলের অডিও route নিজে দখল করত, ফলে react-native-webrtc-এর অডিও
    // ডিভাইসের স্পিকারে যেত না — RTP দুদিকে গেলেও কোনো শব্দ শোনা যেত না (logcat-এ অ্যাপ
    // CallProvider হিসেবে রেজিস্টার্ড দেখা গিয়েছিল, SelfManaged নয়)। self-managed-এ অ্যাপ
    // নিজে অডিও নিয়ন্ত্রণ করে (InCallManager + WebRTC) → অডিও বাজে; full-screen incoming
    // UI-ও দেখায় (self-managed অ্যাপগুলোই native incoming UI দেখায়)।
    // ⚠️ managed↔self-managed বদলানো install-এ "cannot change self-managed account" crash
    // করে — তাই নতুন বিল্ড দেওয়ার আগে অবশ্যই পুরনো অ্যাপ UNINSTALL করতে হবে (clean install)।
    selfManaged: true,
    foregroundService: {
      channelId: 'com.rajameharonline.client.calls',
      channelName: 'ইনকামিং কল',
      notificationTitle: 'কল চলছে',
      // ⚠️ আবশ্যক — না দিলে CallKeep FG-service notification-এ icon=0 হয়ে
      // Android 14-এ "broken notification" crash করে (ring UI আসে না)।
      // mipmap resource নাম; প্রতি অ্যাপে ic_launcher থাকে।
      notificationIcon: 'ic_launcher',
    },
  },
};

// READ_PHONE_NUMBERS dangerous permission — runtime-এ না চাইলে CallKeep-এর
// VoiceConnectionService.getPhoneAccount() SecurityException-এ crash করে
// (onCreateIncomingConnection → process death → Telecom timeout)। তাই foreground-এ
// একবার grant নিশ্চিত করি; grant হলে background ConnectionService-ও কাজ করে।
async function _ensurePhonePermissions() {
  if (Platform.OS !== 'android') return;
  try {
    await PermissionsAndroid.requestMultiple([
      'android.permission.READ_PHONE_NUMBERS',
      'android.permission.CALL_PHONE',
      // মাইক — না থাকলে answer-এর সময় getUserMedia fail করে, 200 OK যায় না, কল active হয় না
      'android.permission.RECORD_AUDIO',
      'android.permission.MODIFY_AUDIO_SETTINGS',
    ]);
  } catch (e) {
    // headless/background-এ activity না থাকলে চাওয়া যায় না — foreground-এ আগেই grant হয়েছে।
    // eslint-disable-next-line no-console
    console.warn('[callKeep] permission request skipped:', e?.message || e);
  }
}

export async function setupCallKeep() {
  if (!RNCallKeep || _setupDone) return _setupDone;
  await _ensurePhonePermissions();
  try {
    await RNCallKeep.setup(SETUP_OPTIONS);
    RNCallKeep.setAvailable(true);
    _setupDone = true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[callKeep] setup failed:', e?.message || e);
  }
  return _setupDone;
}

// FCM background/foreground handler এটা ডাকে — full-screen রিং দেখায়।
export async function displayIncomingCall(uuid, callerName = 'অফিস') {
  // eslint-disable-next-line no-console
  console.log('[callKeep] displayIncomingCall called', uuid, 'available=', !!RNCallKeep);
  if (!RNCallKeep) return;
  const ok = await setupCallKeep();
  // eslint-disable-next-line no-console
  console.log('[callKeep] setup done=', ok);
  callKeepState.currentUUID = uuid;
  callKeepState.pendingAnswer = false;
  callKeepState.rejected = false;
  callKeepState.established = false;
  try {
    RNCallKeep.displayIncomingCall(uuid, callerName, callerName, 'generic', false);
    // eslint-disable-next-line no-console
    console.log('[callKeep] displayIncomingCall OK', uuid);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[callKeep] displayIncomingCall failed:', e?.message || e);
  }
  // ⚠️ auto-end — ৪৫s-এর মধ্যে SIP session established না হলে CallKeep কল বন্ধ।
  // (FCM দেরিতে/বাসি এলে পেছনে live কল না থাকলে ভুতুড়ে কল ঝুলে থাকবে না।)
  if (_endTimer) clearTimeout(_endTimer);
  _endTimer = setTimeout(() => {
    _endTimer = null;
    if (!callKeepState.established && callKeepState.currentUUID === uuid) {
      // eslint-disable-next-line no-console
      console.log('[callKeep] auto-end (no SIP established)', uuid);
      endCallKeepCall(uuid);
    }
  }, 45000);
}

// CallKeep UI বন্ধ (SIP কল শেষ হলে / reject হলে)।
export function endCallKeepCall(uuid) {
  if (!RNCallKeep) return;
  const id = uuid || callKeepState.currentUUID;
  if (!id) return;
  if (_endTimer) { clearTimeout(_endTimer); _endTimer = null; }
  try { RNCallKeep.endCall(id); } catch { /* ignore */ }
  if (id === callKeepState.currentUUID) {
    callKeepState.currentUUID = null;
    callKeepState.pendingAnswer = false;
    callKeepState.established = false;
  }
}

// স্পিকার/earpiece রুট পরিবর্তন — self-managed mode-এ অডিও রুট Telecom-এর
// CallAudioState নিয়ন্ত্রণ করে, তাই শুধু InCallManager.setForceSpeakerphoneOn যথেষ্ট নয়
// (route সরে গেলেও লাউডস্পিকার নীরব থাকত)। RNCallKeep.setAudioRoute() Telecom-এর
// মাধ্যমে আসল রুট বদলায় → লাউডস্পিকারে শব্দ আসে।
export function setCallAudioRoute(toSpeaker) {
  if (!RNCallKeep) return;
  const uuid = callKeepState.currentUUID;
  if (!uuid) return;
  // Android callkeep route নাম: 'SPEAKER' | 'EARPIECE'
  try { RNCallKeep.setAudioRoute(uuid, toSpeaker ? 'SPEAKER' : 'EARPIECE'); } catch { /* ignore */ }
}

// SIP কল established হলে CallKeep-কে জানাই (timer চালু হয়) + auto-end বাতিল।
export function setCallKeepActive(uuid) {
  if (!RNCallKeep) return;
  callKeepState.established = true;
  if (_endTimer) { clearTimeout(_endTimer); _endTimer = null; }
  const id = uuid || callKeepState.currentUUID;
  if (id) { try { RNCallKeep.setCurrentCallActive(id); } catch { /* ignore */ } }
}

// top-level event listener (background-এও কাজ করে — index.js থেকে একবার register)।
let _eventsBound = false;
export function bindCallKeepEvents() {
  if (!RNCallKeep || _eventsBound) return;
  _eventsBound = true;

  // user Accept চাপল। ⚠️ backToForeground ডাকি না — managed mode-এ native UI কল
  // দেখায়, অ্যাপ foreground আনলে home screen পপ-আপ হয় (বিরক্তিকর)। SIP register
  // background-এ (messaging._ensureSipRegistered) হয়, তাই foreground ছাড়াই answer চলে।
  RNCallKeep.addEventListener('answerCall', ({ callUUID }) => {
    callKeepState.currentUUID = callUUID;
    callKeepState.pendingAnswer = true;
    callKeepState.rejected = false;
    // INVITE ইতিমধ্যে এসে থাকলে সাথে সাথে answer; নইলে onState-এ pendingAnswer ধরবে।
    callKeepState.onAnswer?.();
  });

  // user reject/hangup করল।
  RNCallKeep.addEventListener('endCall', ({ callUUID }) => {
    callKeepState.rejected = true;
    callKeepState.pendingAnswer = false;
    callKeepState.onEnd?.();
    if (callUUID === callKeepState.currentUUID) callKeepState.currentUUID = null;
  });

  // native UI-র Mute বাটন → SIP mic mute।
  RNCallKeep.addEventListener('didPerformSetMutedCallAction', ({ muted }) => {
    callKeepState.onMute?.(muted);
  });
}

export function callKeepAvailable() {
  return !!RNCallKeep;
}
