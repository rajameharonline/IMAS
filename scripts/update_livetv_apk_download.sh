#!/usr/bin/env bash
# লাইভ টিভি APK ডাউনলোড লিংক আপডেট করে।
# নতুন APK বিল্ড করার পর এটি চালান — public_apk/ থেকে সবচেয়ে নতুন rajamehar-livetv-*.apk
# খুঁজে media/app/rajamehar-livetv.apk-এ কপি করে।
#
# ব্যবহার:
#   bash scripts/update_livetv_apk_download.sh                 # auto: সবচেয়ে নতুন APK
#   bash scripts/update_livetv_apk_download.sh <file.apk|dir>  # নির্দিষ্ট APK বা ডিরেক্টরি
set -euo pipefail
shopt -s nullglob

ROOT="/var/www/isp_bnas"
DEST_DIR="$ROOT/media/app"
DEST="$DEST_DIR/rajamehar-livetv.apk"
PUBLIC_APK_DIR="$ROOT/mobile_app/public_apk"
GRADLE_OUTPUT="$ROOT/livetv_app/android/app/build/outputs/apk/release/app-release.apk"

# ── candidate APK তালিকা তৈরি ────────────────────────────────────────────────
candidates=()
if [[ "${1:-}" != "" ]]; then
  if [[ -d "$1" ]]; then
    candidates+=("$1"/rajamehar-livetv-*.apk)
    candidates+=("$1"/*.apk)
  elif [[ -f "$1" ]]; then
    candidates+=("$1")
  else
    echo "❌ পাওয়া যায়নি: $1" >&2; exit 1
  fi
else
  candidates+=(
    "$PUBLIC_APK_DIR"/rajamehar-livetv-*.apk
    "$GRADLE_OUTPUT"
  )
fi

# ── mtime-এ সবচেয়ে নতুনটা বেছে নিই ──────────────────────────────────────────
LATEST=""
for f in "${candidates[@]}"; do
  [[ -f "$f" ]] || continue
  if [[ -z "$LATEST" ]] || [[ "$f" -nt "$LATEST" ]]; then LATEST="$f"; fi
done

if [[ -z "$LATEST" ]]; then
  echo "❌ কোনো rajamehar-livetv APK পাওয়া যায়নি (build করেছেন তো?)।" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
cp -f "$LATEST" "$DEST"
chmod 644 "$DEST"
SIZE="$(du -h "$DEST" | cut -f1)"
echo "✅ আপডেট হয়েছে (${SIZE}): $(basename "$LATEST")"
echo "   → $DEST"
echo "   ডাউনলোড লিংক: https://roisp.duckdns.org/media/app/rajamehar-livetv.apk"
