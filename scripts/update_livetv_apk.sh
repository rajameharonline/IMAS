#!/usr/bin/env bash
# "Rajamehar Live TV" app (livetv_app, com.rajameharonline.livetv) ডাউনলোড লিংক আপডেট করে।
# livetv_app-এ `cd android && ./gradlew assembleRelease` করার পর এটি চালান।
#
# ⚠️ এটা "Rajamehar Online" client app (mobile_app)-এর script নয় — সেটার জন্য
#    scripts/update_apk_download.sh ব্যবহার করুন (media/app/rajamehar-online.apk)।
#
# Source: livetv_app/android/app/build/outputs/apk/release/app-release.apk
# Dest:   media/app/rajamehar-livetv.apk
set -euo pipefail

ROOT="/var/www/isp_bnas"
SRC="$ROOT/livetv_app/android/app/build/outputs/apk/release/app-release.apk"
DEST_DIR="$ROOT/media/app"
DEST="$DEST_DIR/rajamehar-livetv.apk"

if [[ ! -f "$SRC" ]]; then
  echo "❌ Build পাওয়া যায়নি: $SRC (আগে 'cd livetv_app/android && ./gradlew assembleRelease' চালান)" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
cp -f "$SRC" "$DEST"
chmod 644 "$DEST"
SIZE="$(du -h "$DEST" | cut -f1)"
echo "✅ Live TV APK আপডেট হয়েছে (${SIZE}): $SRC"
echo "   → $DEST"
echo "   ডাউনলোড লিংক: https://roisp.duckdns.org/media/app/rajamehar-livetv.apk"
