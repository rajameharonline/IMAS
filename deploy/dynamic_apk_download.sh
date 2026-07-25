#!/bin/bash
# ────────────────────────────────────────────────────────────────────────────
# Dynamic APK download — public_apk/ ফোল্ডারে *যে নামেই* .apk রাখুন, /app/download
# স্বয়ংক্রিয়ভাবে সবচেয়ে নতুন .apk serve করবে (আসল নামসহ)।
#
# কীভাবে: nginx /app/download → Django view (latest .apk বেছে X-Accel-Redirect দেয়)
#         → nginx internal /protected-apk/ ফাইল bytes efficient serve করে
#           (gunicorn worker আটকায় না, 85MB+ ফাইলেও timeout হয় না)।
#
# walled-garden ও HTTPS — দুই block-এই প্রয়োগ হয়।
# নিরাপদ: backup, nginx -t fail করলে rollback, idempotent (marker)।
#
# চালান:  sudo bash /var/www/isp_bnas/deploy/dynamic_apk_download.sh
# ────────────────────────────────────────────────────────────────────────────
set -e
CONF=/etc/nginx/sites-available/isp_bnas
MARK="# apk-download-dynamic"

if [[ $EUID -ne 0 ]]; then echo "❌ sudo দিয়ে চালান।"; exit 1; fi
[[ -f "$CONF" ]] || { echo "❌ nginx config নেই: $CONF"; exit 1; }

if grep -q "$MARK" "$CONF"; then
    echo "ℹ️  ইতিমধ্যে dynamic mode চালু আছে — কিছু করার দরকার নেই।"
    exit 0
fi

BAK="${CONF}.bak.$(date +%Y%m%d_%H%M%S)"
cp "$CONF" "$BAK"
echo "📦 backup: $BAK"

# প্রতিটি `location = /app/download { ... }` block → proxy + internal /protected-apk/
awk -v mark="$MARK" '
  /location = \/app\/download[ \t]*\{/ {
      print "    location = /app/download {  " mark
      print "        proxy_pass http://isp_django/api/v1/app/apk-download/;"
      # walled-garden-এ captive Host ALLOWED_HOSTS-এ নেই → fixed valid host দিই
      print "        proxy_set_header Host roisp.duckdns.org;"
      print "        proxy_set_header X-Real-IP $remote_addr;"
      print "    }"
      print "    location /protected-apk/ {"
      print "        internal;"
      print "        alias /var/www/isp_bnas/mobile_app/public_apk/;"
      print "        add_header Cache-Control \"no-cache\";"
      print "    }"
      inblk=1; next
  }
  inblk { if ($0 ~ /^[ \t]*\}[ \t]*$/) inblk=0; next }
  { print }
' "$CONF" > "${CONF}.new"

if ! grep -q "$MARK" "${CONF}.new"; then
    echo "❌ insert ব্যর্থ (/app/download block পাওয়া যায়নি)। কোনো পরিবর্তন হয়নি।"
    rm -f "${CONF}.new"; exit 1
fi

mv "${CONF}.new" "$CONF"

if nginx -t 2>/dev/null; then
    systemctl reload nginx
    echo "✅ সম্পন্ন — dynamic APK download চালু। যেকোনো নামের .apk এখন auto-serve হবে।"
    echo "   যাচাই:  curl -sI https://roisp.duckdns.org/app/download | head -5"
else
    echo "❌ nginx -t fail — rollback করা হচ্ছে।"
    cp "$BAK" "$CONF"
    nginx -t && systemctl reload nginx || true
    exit 1
fi
