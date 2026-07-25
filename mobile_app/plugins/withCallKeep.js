// Custom Expo config plugin — react-native-callkeep-এর জন্য (official plugin নেই)।
// কাজ: Android manifest-এ ConnectionService (VoiceConnectionService) declare করা +
//      foreground-service ও telecom permission যোগ করা। নইলে CallKeep-এর
//      self-managed ইনকামিং কল UI (full-screen রিং) কাজ করে না।
//
// lib নিজে যা declare করে (callkeep/android/AndroidManifest.xml): CALL_PHONE,
// READ_PHONE_STATE, READ_PHONE_NUMBERS, MANAGE_OWN_CALLS। কিন্তু <service> ও
// FOREGROUND_SERVICE permission consuming app-কে যোগ করতে হয় — সেটাই এখানে।
const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

const SERVICE_NAME = 'io.wazo.callkeep.VoiceConnectionService';

function withCallKeep(config) {
  // ── permission (FCM background → CallKeep foreground service) ──
  // FOREGROUND_SERVICE_MICROPHONE — background-এ mic চালাতে আবশ্যক (Android 11+),
  // নইলে অ্যাপ background থাকলে ক্লায়েন্টের mic capture block হয় → outgoing audio আসে না।
  config = AndroidConfig.Permissions.withPermissions(config, [
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_PHONE_CALL',
    'android.permission.FOREGROUND_SERVICE_MICROPHONE',
    'android.permission.BIND_TELECOM_CONNECTION_SERVICE',
  ]);

  // ── ConnectionService manifest-এ declare ──
  config = withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.service = app.service || [];
    const exists = app.service.some(
      (s) => s.$ && s.$['android:name'] === SERVICE_NAME,
    );
    if (!exists) {
      app.service.push({
        $: {
          'android:name': SERVICE_NAME,
          'android:label': 'Rajamehar Online',
          'android:permission': 'android.permission.BIND_TELECOM_CONNECTION_SERVICE',
          // phoneCall + microphone — background-এ call FGS + mic capture দুটোই।
          'android:foregroundServiceType': 'phoneCall|microphone',
          'android:exported': 'true',
        },
        'intent-filter': [
          { action: [{ $: { 'android:name': 'android.telecom.ConnectionService' } }] },
        ],
      });
    }
    return cfg;
  });

  return config;
}

module.exports = withCallKeep;
