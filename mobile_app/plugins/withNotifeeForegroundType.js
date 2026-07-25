// Expo config plugin — notifee-এর ForegroundService-এ Android manifest-এ
// foregroundServiceType="dataSync" সেট করে (tools:replace দিয়ে override)।
//
// কেন দরকার: notifee লাইব্রেরির merged manifest-এ ForegroundService শুধু
// "shortService" type নিয়ে ঘোষিত থাকে। কিন্তু আমরা runtime-এ DATA_SYNC type দিয়ে
// startForeground() করি (persistent keepalive — shortService ৩ মিনিটে বন্ধ হয়ে যায়)।
// টাইপ না মিললে Android 14 "foregroundServiceType ... not a subset" বলে crash করে।
// এই plugin app-এর নিজের manifest-এ একই service tools:replace দিয়ে দিয়ে dataSync
// টাইপ বসায়, manifest merger তখন এটাই ব্যবহার করে।
const { withAndroidManifest } = require('@expo/config-plugins');

const SERVICE_NAME = 'app.notifee.core.ForegroundService';

module.exports = function withNotifeeForegroundType(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    // tools namespace নিশ্চিত করি (tools:replace ব্যবহারের জন্য)
    manifest.$ = manifest.$ || {};
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';

    const app = manifest.application && manifest.application[0];
    if (!app) return cfg;
    app.service = app.service || [];

    let svc = app.service.find(
      (s) => s.$ && s.$['android:name'] === SERVICE_NAME,
    );
    if (!svc) {
      svc = { $: { 'android:name': SERVICE_NAME } };
      app.service.push(svc);
    }
    svc.$['android:foregroundServiceType'] = 'dataSync';
    svc.$['tools:replace'] = 'android:foregroundServiceType';
    return cfg;
  });
};
