// Expo config plugin — android/gradle.properties টিউন করে কম-RAM মেশিনে build চালাতে।
// কেন: ৭.৭GB মেশিনে gradle default Metaspace (~512m) ছোট পড়ে "OutOfMemoryError: Metaspace"
// দেয়, আর ৪টি ABI (x86/x86_64/armeabi-v7a/arm64-v8a) একসাথে native compile হলে RAM শেষ।
//   - Metaspace 1GB + heap 3GB
//   - parallel off (একসাথে কম project → কম RAM)
//   - default শুধু আসল-ফোনের ABI (arm64-v8a,armeabi-v7a → native compile প্রায় অর্ধেক)
//   - EMULATOR_BUILD=1 env দিলে x86_64 যোগ হয় (এমুলেটরে টেস্টের জন্য)
const { withGradleProperties } = require('@expo/config-plugins');

module.exports = function withGradleMemory(config) {
  return withGradleProperties(config, (cfg) => {
    const props = cfg.modResults;
    const set = (key, value) => {
      const found = props.find((p) => p.type === 'property' && p.key === key);
      if (found) found.value = value;
      else props.push({ type: 'property', key, value });
    };
    set('org.gradle.jvmargs', '-Xmx3072m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8');
    set('org.gradle.parallel', 'false');
    set('org.gradle.workers.max', '2');
    // আসল ফোনের ABI (default)। বেশিরভাগ আধুনিক ফোন arm64-v8a; armeabi-v7a পুরনো ৩২-বিট ফোনের জন্য।
    // x86_64 = এমুলেটর-only; শুধু EMULATOR_BUILD=1 env দিলে যোগ হয় (default build অপরিবর্তিত,
    // production/আসল-ফোন বিল্ডে x86_64 ঢোকে না — native compile time/RAM বাড়ে না)।
    const archs = ['arm64-v8a', 'armeabi-v7a'];
    if (process.env.EMULATOR_BUILD === '1' || process.env.EMULATOR_BUILD === 'true') {
      archs.push('x86_64');
    }
    set('reactNativeArchitectures', archs.join(','));
    return cfg;
  });
};
