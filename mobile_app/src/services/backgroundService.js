// Background persistence service — অ্যাপ background-এ থাকলেও কল/নোটিফিকেশন পায়।
// ⚠️ TaskManager.defineTask() অবশ্যই module load-এই (top-level) call করতে হবে।
//    index.js-এ App register-এর আগে এই file import করো।

import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform, Linking, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// notifee — battery optimization ও OEM power-manager (auto-start) এর সঠিক native API
// দেয় (Xiaomi/Oppo/Vivo/Realme ইত্যাদি)। guarded — না থাকলে Linking intent-এ fallback।
let _notifee = null;
try { _notifee = require('@notifee/react-native').default; } catch { _notifee = null; }

export const KEEPALIVE_TASK = 'isp-bnas-keepalive';
// নোট: Android-এ চ্যানেল তৈরি হয়ে গেলে importance আর কোড থেকে বদলানো যায় না।
// NONE-importance প্রয়োগ করতে নতুন channel id (-v3) — পুরনো MIN/LOW চ্যানেল bypass।
// IMPORTANCE_NONE = notification drawer-এও দেখায় না, status bar-এও না।
const KEEPALIVE_CHANNEL   = 'keepalive-bg-v3';
const NOTIF_ID_KEY         = 'bg_notif_id';
const BATTERY_ASKED_KEY    = 'battery_exempt_asked';

// ── Background Task ──────────────────────────────────────────────────────────
// প্রতি ১৫ মিনিটে চলে — force kill-এর পরেও (stopOnTerminate: false)।
// কাজ: login আছে কিনা নিশ্চিত করো + FCM token refresh।
TaskManager.defineTask(KEEPALIVE_TASK, async () => {
  try {
    const token = await SecureStore.getItemAsync('access_token');
    if (!token) return BackgroundFetch.BackgroundFetchResult.NoData;

    // FCM token — stale হলে Firebase নিজেই refresh করে; getToken() trigger করে।
    try {
      const messaging = require('@react-native-firebase/messaging').default;
      await messaging().getToken();
    } catch { /* native module না থাকলে (Expo Go) ignore */ }

    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// login-এর পরে একবার register করো
export async function registerKeepaliveTask() {
  try {
    const status = await BackgroundFetch.getStatusAsync();
    if (
      status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
      status === BackgroundFetch.BackgroundFetchStatus.Denied
    ) return;
    await BackgroundFetch.registerTaskAsync(KEEPALIVE_TASK, {
      minimumInterval: 15 * 60,  // 15 মিনিট (Android OS এটি adjust করতে পারে)
      stopOnTerminate: false,    // force kill-এর পরেও চলবে
      startOnBoot: true,         // device reboot-এর পরেও
    });
  } catch { /* ইতিমধ্যে registered হলে throw করে — safe to ignore */ }
}

// ── Battery Optimization Exemption ──────────────────────────────────────────
// Android Doze mode FCM high-priority message block করে।
// এই dialog-এ user "Allow" করলে Doze-এও FCM কাজ করে।
// একবারই দেখায়।
function _alert(title, message) {
  return new Promise((resolve) => {
    Alert.alert(title, message, [{ text: 'ঠিক আছে', onPress: resolve }], { cancelable: false });
  });
}

export async function requestBatteryExemption() {
  if (Platform.OS !== 'android') return;
  try {
    const asked = await AsyncStorage.getItem(BATTERY_ASKED_KEY);
    if (asked) return;

    // ── notifee path (সঠিক native dialog + OEM auto-start) ──────────────────────
    if (_notifee) {
      // ১) Battery optimization — শুধু এখনো optimized থাকলে guide করি
      let battOptimized = true;
      try { battOptimized = await _notifee.isBatteryOptimizationEnabled(); }
      catch { battOptimized = true; }
      if (battOptimized) {
        await _alert(
          'কল মিস না হতে — ব্যাটারি অপটিমাইজেশন বন্ধ করুন',
          'WhatsApp-এর মতো অ্যাপ বন্ধ/লক থাকলেও কল পেতে, পরের স্ক্রিনে এই অ্যাপের জন্য '
          + '“Don’t optimize / Allow” নির্বাচন করুন।',
        );
        try { await _notifee.openBatteryOptimizationSettings(); } catch { /* ignore */ }
      }

      // ২) OEM auto-start / power manager (Xiaomi/Oppo/Vivo/Realme...) — থাকলে guide করি।
      //    এই ব্র্যান্ডগুলো auto-start ছাড়া killed-app-এ FCM/কল ব্লক করে।
      try {
        const pm = await _notifee.getPowerManagerInfo();
        if (pm && pm.activity) {
          await _alert(
            'Auto-start চালু করুন',
            'আপনার ফোনে (' + (pm.manufacturer || 'এই ব্র্যান্ড') + ') অ্যাপ বন্ধ অবস্থায় কল পেতে '
            + '“Auto-start / স্বয়ংক্রিয় চালু” অনুমতি দিতে হয়। পরের স্ক্রিনে এই অ্যাপটি চালু করুন।',
          );
          try { await _notifee.openPowerManagerSettings(); } catch { /* ignore */ }
        }
      } catch { /* অনেক ফোনে power manager নেই — স্বাভাবিক */ }

      await AsyncStorage.setItem(BATTERY_ASKED_KEY, '1');
      return;
    }

    // ── Fallback (notifee নেই) — পুরনো system intent ────────────────────────────
    await AsyncStorage.setItem(BATTERY_ASKED_KEY, '1');
    await Linking.sendIntent('android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', [
      { key: 'package', value: 'com.rajameharonline.client' },
    ]);
  } catch { /* পুরনো Android বা iOS — ignore */ }
}

// Settings/Profile স্ক্রিন থেকে user নিজে আবার চালাতে পারে (flag উপেক্ষা করে) —
// একবার skip করলেও পরে reliability ঠিক করতে কাজে লাগে।
export async function openCallReliabilitySettings() {
  if (Platform.OS !== 'android') return;
  try {
    if (_notifee) {
      try { await _notifee.openBatteryOptimizationSettings(); } catch { /* ignore */ }
      try {
        const pm = await _notifee.getPowerManagerInfo();
        if (pm && pm.activity) { try { await _notifee.openPowerManagerSettings(); } catch { /* ignore */ } }
      } catch { /* ignore */ }
      return;
    }
    await Linking.sendIntent('android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', [
      { key: 'package', value: 'com.rajameharonline.client' },
    ]);
  } catch { /* ignore */ }
}

// ── Persistent Notification ──────────────────────────────────────────────────
// Login থাকলে status bar-এ low-priority notification — user dismiss করতে পারে না।
// Android OS অ্যাপকে "ব্যবহৃত" মনে করে → aggressively kill করে না।
export async function startPersistentNotification() {
  if (Platform.OS !== 'android') return;
  try {
    // পুরনো সব keepalive channel মুছি — settings-এ দৃশ্যমান entry থাকবে না।
    for (const old of ['keepalive-bg', 'keepalive-bg-v2']) {
      try { await Notifications.deleteNotificationChannelAsync(old); } catch { /* ignore */ }
    }

    // IMPORTANCE_NONE channel:
    //   - status bar-এ কোনো আইকন নেই
    //   - notification drawer-এ দেখায় না (Android অটো-suppress করে)
    //   - কিছু ROM-এ "Silenced notifications" collapse-এ লুকিয়ে থাকে (user খুঁজলে পাবে)
    // এটি IMPORTANCE_MIN-এর চেয়ে আরও বেশি লুকানো।
    await Notifications.setNotificationChannelAsync(KEEPALIVE_CHANNEL, {
      name: 'Background Service',
      importance: Notifications.AndroidImportance.NONE,
      sound: null,
      enableVibrate: false,
      showBadge: false,
    });

    // পুরনো notification dismiss (previous session থেকে)
    const oldId = await AsyncStorage.getItem(NOTIF_ID_KEY);
    if (oldId) {
      try { await Notifications.dismissNotificationAsync(oldId); } catch { /* ignore */ }
    }

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: '',          // খালি — কোনো text দেখাবে না
        body: '',
        sticky: false,      // sticky হলে কিছু ROM-এ force-visible হয়ে যায়
        autoDismiss: false,
        channelId: KEEPALIVE_CHANNEL,
        data: { type: 'keepalive' },
      },
      trigger: null,
    });
    await AsyncStorage.setItem(NOTIF_ID_KEY, id);
  } catch { /* ignore */ }
}

export async function stopPersistentNotification() {
  if (Platform.OS !== 'android') return;
  try {
    const id = await AsyncStorage.getItem(NOTIF_ID_KEY);
    if (id) {
      await Notifications.dismissNotificationAsync(id);
      await AsyncStorage.removeItem(NOTIF_ID_KEY);
    }
  } catch { /* ignore */ }
}
