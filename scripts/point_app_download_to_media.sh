#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Walled garden + main HTTPS-এর "/app/download" (অ্যাপ ডাউনলোড করুন বাটন) এখন
# public_apk/ এর বদলে সরাসরি media/app/rajamehar-online.apk serve করবে।
#
# কেন: এক canonical APK location (media/app/) — SettingsPage, reminder {app_link}
# এবং walled garden বাটন সবাই একই ফাইল ব্যবহার করবে।
#
# চালান:  sudo bash scripts/point_app_download_to_media.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CONF=/etc/nginx/sites-available/isp_bnas
APK=/var/www/isp_bnas/media/app/rajamehar-online.apk

if [[ $EUID -ne 0 ]]; then
  echo "❌ root দরকার — চালান:  sudo bash $0"
  exit 1
fi

[[ -f "$CONF" ]] || { echo "❌ nginx config পাওয়া যায়নি: $CONF"; exit 1; }
[[ -f "$APK"  ]] || { echo "❌ APK ফাইল নেই: $APK (আগে media/app/-এ রাখুন)"; exit 1; }

# ── ব্যাকআপ ──────────────────────────────────────────────────────────────────
BAK="${CONF}.bak.$(date +%Y%m%d_%H%M%S)"
cp -a "$CONF" "$BAK"
echo "📦 ব্যাকআপ: $BAK"

# ── দুটো `location = /app/download { ... }` ব্লক (HTTP walled garden + HTTPS) →
#    সরাসরি media/app alias-এ রূপান্তর। ব্লকে nested brace নেই, তাই [^}]* নিরাপদ।
python3 - "$CONF" <<'PYEOF'
import re, sys
path = sys.argv[1]
src = open(path).read()
new_block = """location = /app/download {  # apk-download → media/app
        alias /var/www/isp_bnas/media/app/rajamehar-online.apk;
        default_type application/vnd.android.package-archive;
        add_header Content-Disposition 'attachment; filename=rajamehar-online.apk';
        add_header Cache-Control 'no-cache';
    }"""
pattern = re.compile(r'location\s*=\s*/app/download\s*\{[^}]*\}')
out, n = pattern.subn(new_block, src)
open(path, 'w').write(out)
print(f"🔧 পরিবর্তিত /app/download ব্লক: {n} টি (প্রত্যাশিত: 2)")
if n == 0:
    sys.exit("❌ কোনো /app/download ব্লক মেলেনি — config ইতিমধ্যে বদলানো বা ভিন্ন গঠন।")
PYEOF

# ── ভ্যালিডেট ও reload ───────────────────────────────────────────────────────
if nginx -t; then
  systemctl reload nginx || systemctl restart nginx
  echo "✅ সম্পন্ন — /app/download এখন media/app/rajamehar-online.apk serve করছে।"
  echo "   পরীক্ষা:  curl -sI https://roisp.duckdns.org/app/download | head"
else
  echo "❌ nginx -t ব্যর্থ — config ফেরত নেওয়া হচ্ছে।"
  cp -a "$BAK" "$CONF"
  exit 1
fi
