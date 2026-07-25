#!/usr/bin/env bash
# "Rajamehar Online" (mobile_app — ISP client app, com.rajameharonline.client) ডাউনলোড লিংক আপডেট করে।
# নতুন APK বিল্ড করার পর এটি চালান — কয়েকটি সম্ভাব্য জায়গা থেকে সবচেয়ে নতুন *.apk
# খুঁজে media/app/rajamehar-online.apk-এ কপি করে, যাতে Company Info পেজ ও
# walled-garden/reminder লিংক স্বয়ংক্রিয়ভাবে নতুন সংস্করণ দেয়।
#
# ⚠️ এই script শুধু "Rajamehar Online" client app-এর জন্য। Live TV app
#    (livetv_app, com.rajameharonline.livetv) আলাদা — সেটার জন্য
#    scripts/update_livetv_apk.sh ব্যবহার করুন (media/app/rajamehar-livetv.apk)।
#
# খোঁজে (mtime-এ সবচেয়ে নতুনটা বেছে নেয়):
#   - <repo>/mobile_app/public_apk/*.apk          (পুরোনো রীতি)
#   - <repo>/mobile_app/build-*.apk               (eas build --local output)
#   - $HOME/isp_bnas/mobile_app/build-*.apk        (আলাদা build-clone-এ local build)
#   - $HOME/isp_bnas/mobile_app/public_apk/*.apk
#
# ব্যবহার:
#   bash scripts/update_apk_download.sh                 # auto: সবচেয়ে নতুন APK
#   bash scripts/update_apk_download.sh <file.apk|dir>  # নির্দিষ্ট APK বা ডিরেক্টরি
set -euo pipefail
shopt -s nullglob

ROOT="/var/www/isp_bnas"
DEST_DIR="$ROOT/media/app"
DEST="$DEST_DIR/rajamehar-online.apk"

# ── candidate APK তালিকা তৈরি ────────────────────────────────────────────────
candidates=()
if [[ "${1:-}" != "" ]]; then
  # আর্গুমেন্ট: ফাইল হলে সরাসরি, ডিরেক্টরি হলে ভেতরের *.apk
  if [[ -d "$1" ]]; then
    candidates+=("$1"/*.apk)
  elif [[ -f "$1" ]]; then
    candidates+=("$1")
  else
    echo "❌ পাওয়া যায়নি: $1" >&2; exit 1
  fi
else
  candidates+=(
    "$ROOT/mobile_app/public_apk/"*.apk
    "$ROOT/mobile_app/"build-*.apk
    "$HOME/isp_bnas/mobile_app/"build-*.apk
    "$HOME/isp_bnas/mobile_app/public_apk/"*.apk
  )
fi

# ── mtime-এ সবচেয়ে নতুনটা বেছে নিই ───────────────────────────────────────────
# ⚠️ public_apk/ ফোল্ডারে LiveTV app-এর APK-ও (rajamehar-livetv*.apk) থাকে —
# আগে এই filter না থাকায় একবার ভুলবশত LiveTV APK "online" app-এর ডাউনলোড
# লিংকে বসে গিয়েছিল (২০২৬-০৭-১০)। তাই filename-এ "livetv" থাকা ফাইল এখন
# স্পষ্টভাবে বাদ দেওয়া হয়, শুধু mtime না, filename-ও চেক করে।
LATEST=""
for f in "${candidates[@]}"; do
  [[ -f "$f" ]] || continue
  base="$(basename "$f")"
  if [[ "${base,,}" == *livetv* ]]; then
    continue
  fi
  if [[ -z "$LATEST" ]] || [[ "$f" -nt "$LATEST" ]]; then LATEST="$f"; fi
done

if [[ -z "$LATEST" ]]; then
  echo "❌ কোনো .apk পাওয়া যায়নি (build করেছেন তো?)।" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
cp -f "$LATEST" "$DEST"
chmod 644 "$DEST"
SIZE="$(du -h "$DEST" | cut -f1)"
echo "✅ আপডেট হয়েছে (${SIZE}): $LATEST"
echo "   → $DEST"
echo "   ডাউনলোড লিংক: https://roisp.duckdns.org/media/app/rajamehar-online.apk"
