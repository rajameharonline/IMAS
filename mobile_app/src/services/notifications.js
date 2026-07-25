// Push Notification — FCM device token register করে backend-এ পাঠায়।
// Backend (mobile_api/services/push_service.py) Firebase Cloud Messaging দিয়ে পাঠায়।
//
// ⚠️ Expo Go-তে remote push token কাজ করে না (SDK 53+) — শুধু EAS build (dev/production)-এ চলে।
//    তাই Expo Go-তে এই কোড নিরাপদে কিছু না করে ফিরে আসে (crash করে না)।
//    iOS-এ FCM token পেতে Firebase iOS সেটআপ (GoogleService-Info.plist) লাগবে।
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import api from './api';

// Expo Go (SDK 53+)-এ expo-notifications-এর remote push সরিয়ে দেওয়া হয়েছে —
// এমনকি module import করলেও Console Error দেখায়। তাই Expo Go হলে পুরো
// notifications কোড skip করি; শুধু dev/production build-এ lazy-load হয়।
function isExpoGo() {
  return Constants.appOwnership === 'expo'
      || Constants.executionEnvironment === 'storeClient';
}

let _Notifications = null;
let _handlerSet = false;
function getNotifications() {
  // Expo Go-তে import-ই error দেয় — তাই কখনো load করি না
  if (isExpoGo()) return null;
  if (_Notifications === null) {
    try {
      _Notifications = require('expo-notifications');
      // foreground banner handler — একবার সেট করি
      if (!_handlerSet) {
        _Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowBanner: true, shouldShowList: true,
            shouldPlaySound: true, shouldSetBadge: false,
          }),
        });
        _handlerSet = true;
      }
    } catch {
      _Notifications = false;  // load ব্যর্থ — আর চেষ্টা নয়
    }
  }
  return _Notifications || null;
}

export async function registerForPushNotifications(accountType = 'client') {
  try {
    // Expo Go-তে device push token নেওয়া যায় না — skip
    const Notifications = getNotifications();
    if (!Notifications) return null;
    if (!Device.isDevice) return null;

    // Android channel (HIGH importance)
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#3b5998',
      });
    }

    // অনুমতি
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return null;

    // FCM/APNs device token — backend fcm_token হিসেবে সংরক্ষণ করে
    const tokenData = await Notifications.getDevicePushTokenAsync();
    const token = tokenData?.data;
    if (token) {
      // account type অনুযায়ী সঠিক endpoint (client/staff)। POP-এর জন্য আপাতত skip।
      const url = accountType === 'staff' ? '/app/staff/fcm-token/' : '/app/me/fcm-token/';
      if (accountType !== 'pop') {
        try { await api.post(url, { fcm_token: token }); } catch {}
      }
    }
    return token;
  } catch {
    // কোনো ত্রুটি হলেও অ্যাপ যেন crash না করে
    return null;
  }
}

export function setupNotificationListeners(navRef) {
  const Notifications = getNotifications();
  if (!Notifications) return () => {};   // Expo Go — no-op cleanup
  // foreground-এ notification এলে
  const recvSub = Notifications.addNotificationReceivedListener(() => {});
  // notification tap করলে — data.screen থাকলে সেই screen-এ navigate
  const respSub = Notifications.addNotificationResponseReceivedListener(response => {
    try {
      const data = response?.notification?.request?.content?.data || {};
      if (data?.screen && navRef?.current) {
        navRef.current.navigate(data.screen);
      }
    } catch {}
  });
  return () => {
    recvSub.remove();
    respSub.remove();
  };
}
