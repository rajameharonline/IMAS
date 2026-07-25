// Manifest merge fix — expo-notifications ও @react-native-firebase/messaging
// দুটোই `com.google.firebase.messaging.default_notification_color` meta-data
// declare করে (ভিন্ন value: notification_icon_color vs white) → merger fail।
// সমাধান: app manifest-এ একটাই রেখে `tools:replace="android:resource"` দিই, যাতে
// library-র value override হয়। (একইভাবে default_notification_channel_id থাকলে।)
//
// ⚠️ এই plugin app.json-এ plugins array-র **শেষে** রাখতে হবে, যাতে এর manifest mod
//    expo-notifications-এর পরে চলে (নইলে duplicate/ordering সমস্যা)।
const { withAndroidManifest } = require('@expo/config-plugins');

const COLOR_META = 'com.google.firebase.messaging.default_notification_color';
const CHANNEL_META = 'com.google.firebase.messaging.default_notification_channel_id';

function _dedupeWithReplace(app, name, attr, value) {
  app['meta-data'] = app['meta-data'] || [];
  const existing = app['meta-data'].find((m) => m.$?.['android:name'] === name);
  // আগের value ধরে রাখি (expo-notifications যা সেট করেছে), নইলে fallback।
  const keepValue = existing?.$?.[attr] || value;
  app['meta-data'] = app['meta-data'].filter((m) => m.$?.['android:name'] !== name);
  if (keepValue) {
    app['meta-data'].push({
      $: { 'android:name': name, [attr]: keepValue, 'tools:replace': attr },
    });
  }
}

function withFirebaseMessagingFix(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    manifest.manifest.$ = manifest.manifest.$ || {};
    if (!manifest.manifest.$['xmlns:tools']) {
      manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }
    const app = manifest.manifest.application?.[0];
    if (!app) return cfg;
    _dedupeWithReplace(app, COLOR_META, 'android:resource', '@color/notification_icon_color');
    // channel_id থাকলে সেটাও (না থাকলে কিছু যোগ হয় না)।
    if ((app['meta-data'] || []).some((m) => m.$?.['android:name'] === CHANNEL_META)) {
      _dedupeWithReplace(app, CHANNEL_META, 'android:value', '');
    }
    return cfg;
  });
}

module.exports = withFirebaseMessagingFix;
