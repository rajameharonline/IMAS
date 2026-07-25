#!/usr/bin/env bash
# এক কমান্ডে: লাইভ টিভি APK build (Gradle) + version bump + ডাউনলোড লিংক আপডেট।
#
# ব্যবহার:
#   bash /var/www/isp_bnas/scripts/build_and_publish_livetv_apk.sh
#
# কী করে:
#   1) app.json থেকে current version পড়ে
#   2) versionCode +1 করে (app.json আপডেট)
#   3) livetv_app/android-এ Gradle assembleRelease
#   4) APK → mobile_app/public_apk/rajamehar-livetv-vX.X.X.apk (archive)
#   5) media/app/rajamehar-livetv.apk আপডেট (ডাউনলোড লিংক সাথে সাথে নতুন APK দেবে)
set -euo pipefail

ROOT="/var/www/isp_bnas"
LIVETV_DIR="$ROOT/livetv_app"
APP_JSON="$LIVETV_DIR/app.json"
ANDROID_DIR="$LIVETV_DIR/android"
GRADLE_APK="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
PUBLIC_APK_DIR="$ROOT/mobile_app/public_apk"

# ── prechecks ─────────────────────────────────────────────────────────────────
if [[ ! -f "$APP_JSON" ]]; then
  echo "❌ app.json পাওয়া যায়নি: $APP_JSON" >&2; exit 1
fi
if [[ ! -f "$ANDROID_DIR/gradlew" ]]; then
  echo "❌ Gradle wrapper পাওয়া যায়নি: $ANDROID_DIR/gradlew" >&2
  echo "   আগে expo prebuild চালান:" >&2
  echo "   cd $LIVETV_DIR && npx expo prebuild --platform android --clean --no-install" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ python3 দরকার (version bump-এর জন্য)।" >&2; exit 1
fi

# ── 1) version পড়ি + versionCode bump ────────────────────────────────────────
echo "📋 Version তথ্য পড়ছি..."
VERSION=$(python3 -c "import json; d=json.load(open('$APP_JSON')); print(d['expo']['version'])")
OLD_CODE=$(python3 -c "import json; d=json.load(open('$APP_JSON')); print(d['expo']['android']['versionCode'])")
NEW_CODE=$((OLD_CODE + 1))

echo "   version    : $VERSION"
echo "   versionCode: $OLD_CODE → $NEW_CODE"

# app.json-এ versionCode আপডেট
python3 - <<PYEOF
import json
with open('$APP_JSON', 'r') as f:
    d = json.load(f)
d['expo']['android']['versionCode'] = $NEW_CODE
with open('$APP_JSON', 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
    f.write('\n')
print("   ✓ app.json versionCode আপডেট হয়েছে")
PYEOF

# ── 2) Gradle build ───────────────────────────────────────────────────────────
echo ""
echo "🔨 Gradle assembleRelease শুরু — কিছু সময় লাগবে..."
cd "$ANDROID_DIR"
./gradlew assembleRelease

if [[ ! -f "$GRADLE_APK" ]]; then
  echo "❌ Build সফল হয়নি — APK পাওয়া যায়নি: $GRADLE_APK" >&2; exit 1
fi

# ── 3) APK archive করি (versioned filename) ───────────────────────────────────
mkdir -p "$PUBLIC_APK_DIR"
ARCHIVE="$PUBLIC_APK_DIR/rajamehar-livetv-v${VERSION}-${NEW_CODE}.apk"
cp -f "$GRADLE_APK" "$ARCHIVE"
chmod 644 "$ARCHIVE"
SIZE="$(du -h "$ARCHIVE" | cut -f1)"
echo ""
echo "📦 Archive: $(basename "$ARCHIVE") (${SIZE})"

# ── 4) ডাউনলোড লিংক আপডেট ──────────────────────────────────────────────────
echo "🔗 ডাউনলোড লিংক আপডেট..."
bash "$ROOT/scripts/update_livetv_apk_download.sh" "$ARCHIVE"

echo ""
echo "✅ সম্পন্ন — লাইভ টিভি APK v${VERSION} (build ${NEW_CODE}) publish হয়েছে।"
echo "   ফোনে: https://roisp.duckdns.org/media/app/rajamehar-livetv.apk"
echo ""
echo "   পরবর্তী কাজ (optional):"
echo "   git add $APP_JSON && git commit -m \"chore(livetv): bump versionCode to $NEW_CODE\""
