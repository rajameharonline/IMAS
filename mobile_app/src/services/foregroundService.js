// Foreground Service — অ্যাপ background/lock অবস্থাতেও প্রসেস চালু রাখে, যাতে SIP
// registration (sip.js WSS) জীবিত থাকে এবং staff "সবসময় অনলাইন" থাকে।
// notifee-এর registerForegroundService একটি দীর্ঘস্থায়ী টাস্ক চালায় (কখনো resolve হয় না),
// ফলে Android প্রসেসটিকে foreground priority-তে রাখে → JS thread (ও WSS) suspend হয় না।
//
// ⚠️ native module — Expo Go-তে নয়, EAS build লাগবে। require গার্ডেড।
// ⚠️ registerForegroundService() অবশ্যই module load-এই (top-level) call হতে হবে —
//    index.js-এ App register-এর আগে import করা হয়।
import { Platform } from 'react-native';

let notifee = null;
let AndroidImportance = null;
let AndroidForegroundServiceType = null;
try {
  const m = require('@notifee/react-native');
  notifee = m.default || m;
  AndroidImportance = m.AndroidImportance;
  AndroidForegroundServiceType = m.AndroidForegroundServiceType;
} catch {
  notifee = null;
}

const CHANNEL_ID = 'voip-online';
let _running = false;

// দীর্ঘস্থায়ী টাস্ক — stopForegroundService() না ডাকা পর্যন্ত pending থাকে।
// ভেতরে keepalive setInterval — এটা FGS task হিসেবে background-এও চলে (Android একে
// "active work" ধরে), ফলে JS thread জীবিত থাকে ও SIP সংযোগ মরে গেলে reconnect হয়।
// (শুধু main-context watchdog যথেষ্ট নয় — কিছু ROM background-এ main JS throttle করে।)
if (notifee && Platform.OS === 'android') {
  try {
    notifee.registerForegroundService(() => new Promise(() => {
      setInterval(() => {
        try { require('./sipPhone').default?.ensureAlive?.(); } catch { /* ignore */ }
      }, 15000);
      // promise কখনো resolve হয় না → service চলতে থাকে।
    }));
  } catch { /* ignore */ }
}

export async function startForegroundService() {
  if (!notifee || Platform.OS !== 'android' || _running) return;
  _running = true;
  try {
    // IMPORTANCE_MIN — FGS-এ অনুমোদিত সর্বনিম্ন। status bar-এ আইকন দেখায় না, শব্দ/
    // heads-up নেই; শুধু drawer টেনে নামালে নিচে collapsed থাকে। (FGS-এ নোটিফিকেশন
    // সম্পূর্ণ মুছে ফেলা Android-এ সম্ভব নয় — এটাই সবচেয়ে কম দৃশ্যমান বিকল্প।)
    await notifee.createChannel({
      id: CHANNEL_ID,
      name: 'Background',
      importance: AndroidImportance?.MIN ?? 1,
      sound: undefined,
      vibration: false,
    });
    await notifee.displayNotification({
      title: 'Rajamehar Online',
      body: 'অনলাইন',
      android: {
        channelId: CHANNEL_ID,
        asForegroundService: true,
        // VoIP keepalive — DATA_SYNC টাইপ (শুধু FOREGROUND_SERVICE_DATA_SYNC perm লাগে)।
        foregroundServiceTypes: AndroidForegroundServiceType
          ? [AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_DATA_SYNC]
          : undefined,
        ongoing: true,           // user swipe করে সরাতে পারবে না (non-dismissible)
        autoCancel: false,       // tap করলেও নিজে নিজে মুছবে না
        smallIcon: 'ic_launcher',
        importance: AndroidImportance?.MIN ?? 1,  // notification-level-এও MIN
        pressAction: { id: 'default' },
      },
    });
  } catch (e) {
    _running = false;
    // eslint-disable-next-line no-console
    console.warn('[FGS] start failed:', e?.message || e);
  }
}

export async function stopForegroundService() {
  if (!notifee || Platform.OS !== 'android' || !_running) return;
  _running = false;
  try { await notifee.stopForegroundService(); } catch { /* ignore */ }
}
