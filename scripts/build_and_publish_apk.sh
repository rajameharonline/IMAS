#!/usr/bin/env bash
# এক কমান্ডে: মোবাইল অ্যাপের standalone APK (EAS local) build + ডাউনলোড লিংক আপডেট।
#
# ব্যবহার:
#   bash /var/www/isp_bnas/scripts/build_and_publish_apk.sh
#
# build clone অন্য পথে হলে:
#   MOBILE_DIR=/path/to/mobile_app bash /var/www/isp_bnas/scripts/build_and_publish_apk.sh
#
# কী করে:
#   1) mobile_app-এ EAS local build (arm ABI — আসল ফোনের জন্য; ক্লাউড কোটা লাগে না)
#   2) সদ্য তৈরি build-*.apk → media/app/rajamehar-online.apk (ডাউনলোড লিংক আপডেট)
set -euo pipefail

ROOT="/var/www/isp_bnas"
MOBILE_DIR="${MOBILE_DIR:-$HOME/isp_bnas/mobile_app}"

# /tmp = tmpfs (7.5GB) — Gradle native build-এ জায়গা শেষ হয়; main disk ব্যবহার করি
export TMPDIR="${TMPDIR:-/var/tmp/eas-build-amir}"
mkdir -p "$TMPDIR"

# ── prechecks ────────────────────────────────────────────────────────────────
if [[ ! -f "$MOBILE_DIR/package.json" ]]; then
  echo "❌ mobile_app পাওয়া যায়নি: $MOBILE_DIR" >&2
  echo "   সঠিক পথ দিয়ে চালান:  MOBILE_DIR=/সঠিক/পথ bash $0" >&2
  exit 1
fi
if ! command -v eas >/dev/null 2>&1; then
  echo "❌ eas-cli নেই। ইনস্টল করুন:  npm install -g eas-cli  (অথবা npx eas-cli)" >&2
  exit 1
fi

echo "📦 Build dir : $MOBILE_DIR"
cd "$MOBILE_DIR"

# emulator চালু থাকলে RAM-এর জন্য সতর্ক করি (build একা চালানোই ভালো)
if pgrep -f "qemu-system" >/dev/null 2>&1; then
  echo "⚠️  Emulator চলছে — build-এর সময় RAM চাপ বাড়বে। বন্ধ করে নেওয়া ভালো।"
fi

# ── 1) EAS local build ───────────────────────────────────────────────────────
echo "🔨 EAS local build শুরু (preview / arm) — কয়েক মিনিট লাগবে..."
eas build -p android --profile preview --local

# ── 2) ডাউনলোড লিংক আপডেট (newest build-*.apk auto) ──────────────────────────
echo "🔗 ডাউনলোড লিংক আপডেট..."
bash "$ROOT/scripts/update_apk_download.sh"

echo "✅ সম্পন্ন — নতুন APK build + publish হয়েছে।"
echo "   ফোনে: https://roisp.duckdns.org/media/app/rajamehar-online.apk"
