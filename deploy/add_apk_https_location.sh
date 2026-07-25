#!/bin/bash
# ────────────────────────────────────────────────────────────────────────────
# Main HTTPS server (roisp.duckdns.org:443) block-এ /app/download location যোগ করে,
# যাতে non-expired user-ও (যেমন Payment Reminder page থেকে) APK download করতে পারে।
# APK serve হয়: /var/www/isp_bnas/mobile_app/public_apk/rajamehar-online.apk
#
# নিরাপদ: backup নেয়, nginx -t fail করলে rollback করে, idempotent (দুবার চালালেও
# ডুপ্লিকেট যোগ হয় না)।
#
# চালানোর নিয়ম:  sudo bash /var/www/isp_bnas/deploy/add_apk_https_location.sh
# ────────────────────────────────────────────────────────────────────────────
set -e
CONF=/etc/nginx/sites-available/isp_bnas
APK=/var/www/isp_bnas/mobile_app/public_apk/rajamehar-online.apk
MARK="# apk-download-https"   # idempotency marker

if [[ $EUID -ne 0 ]]; then echo "❌ sudo দিয়ে চালান।"; exit 1; fi
[[ -f "$CONF" ]] || { echo "❌ nginx config পাওয়া যায়নি: $CONF"; exit 1; }
[[ -f "$APK"  ]] || echo "⚠️  সতর্কতা: APK ফাইল এখনো নেই: $APK"

if grep -q "$MARK" "$CONF"; then
    echo "ℹ️  ইতিমধ্যে যোগ করা আছে (HTTPS block-এ /app/download) — কিছু করার দরকার নেই।"
    exit 0
fi

# ── backup ──
BAK="${CONF}.bak.$(date +%Y%m%d_%H%M%S)"
cp "$CONF" "$BAK"
echo "📦 backup: $BAK"

# ── 443 block-এর প্রথম location-এর আগে location = /app/download বসাই ──
awk -v mark="$MARK" '
  /listen[ \t]+443[ \t]+ssl/ { in443=1 }
  in443 && /^[ \t]*location[ \t]/ && !done {
      print "    location = /app/download {  " mark
      print "        alias /var/www/isp_bnas/mobile_app/public_apk/rajamehar-online.apk;"
      print "        default_type application/vnd.android.package-archive;"
      print "        add_header Content-Disposition '\''attachment; filename=rajamehar-online.apk'\'';"
      print "        add_header Cache-Control '\''no-cache'\'';"
      print "    }"
      print ""
      done=1
  }
  { print }
' "$CONF" > "${CONF}.new"

# ভেরিফাই: marker যোগ হয়েছে কিনা
if ! grep -q "$MARK" "${CONF}.new"; then
    echo "❌ insert ব্যর্থ (443 block বা location খুঁজে পায়নি)। কোনো পরিবর্তন হয়নি।"
    rm -f "${CONF}.new"; exit 1
fi

mv "${CONF}.new" "$CONF"

# ── nginx test; fail হলে rollback ──
if nginx -t 2>/dev/null; then
    systemctl reload nginx
    echo "✅ সম্পন্ন — HTTPS server-এও /app/download যোগ হয়েছে ও nginx reload হয়েছে।"
    echo "   যাচাই:  curl -sI https://roisp.duckdns.org/app/download | head -4"
else
    echo "❌ nginx -t fail — rollback করা হচ্ছে।"
    cp "$BAK" "$CONF"
    nginx -t && systemctl reload nginx || true
    exit 1
fi
