#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# coturn (TURN server) সেটআপ ও চালু — VoIP NAT অডিওর জন্য আবশ্যক।
# সমস্যা: coturn down + /etc/turnserver.conf-এ placeholder (@@TURN_SECRET@@) →
# কোনো TURN relay candidate নেই → NAT-এর পেছনের ডিভাইসে (mobile data/emulator)
# RTP প্রবাহিত হয় না → কল connect হয় কিন্তু অডিও আসে না।
#
# এই স্ক্রিপ্ট (root):
#   1. .env থেকে TURN_SECRET পড়ে।
#   2. /etc/turnserver.conf লেখে (secret + realm + external-ip সহ)।
#   3. coturn enable + (re)start করে status দেখায়।
#
# চালান:  sudo bash deploy/asterisk/coturn/setup_coturn.sh [public_ip] [domain]
#   public_ip না দিলে: roisp.duckdns.org resolve করে নেয়।
#   domain না দিলে: roisp.duckdns.org।
# ⚠️ এরপর MikroTik/firewall-এ UDP/TCP 3478, 5349 + RTP 10000-20000 → এই সার্ভারে forward করুন।
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="/var/www/isp_bnas"
ENV="$ROOT/.env"
CONF=/etc/turnserver.conf
DOMAIN="${2:-roisp.duckdns.org}"
LAN_IP="$(hostname -I | awk '{print $1}')"

[[ $EUID -eq 0 ]] || { echo "❌ root দরকার:  sudo bash $0"; exit 1; }
[[ -f "$ENV" ]] || { echo "❌ .env পাওয়া যায়নি: $ENV"; exit 1; }

# ── TURN_SECRET .env থেকে ─────────────────────────────────────────────────────
SECRET="$(grep -E '^TURN_SECRET=' "$ENV" | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
[[ -n "$SECRET" ]] || { echo "❌ .env-এ TURN_SECRET নেই/খালি।"; exit 1; }

# ── public IP ─────────────────────────────────────────────────────────────────
PUB="${1:-}"
if [[ -z "$PUB" ]]; then
  PUB="$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)"
fi
[[ -n "$PUB" ]] || { echo "❌ public IP নির্ণয় করা যায়নি — আর্গুমেন্টে দিন: sudo bash $0 <public_ip>"; exit 1; }

echo "🌐 public IP: $PUB | LAN: $LAN_IP | domain: $DOMAIN"

# ── ব্যাকআপ + লেখা ───────────────────────────────────────────────────────────
[[ -f "$CONF" ]] && cp -a "$CONF" "${CONF}.bak.$(date +%Y%m%d_%H%M%S)"
cat > "$CONF" <<EOF
# coturn — ISP VoIP (Django ephemeral HMAC creds; static placeholder নয়)।
listening-port=3478
tls-listening-port=5349
listening-ip=0.0.0.0
# NAT-এর পেছনে: public/LAN ম্যাপিং — relay candidate-এ public IP advertise হয়।
external-ip=$PUB/$LAN_IP
realm=$DOMAIN
use-auth-secret
static-auth-secret=$SECRET
# relay পোর্ট রেঞ্জ (firewall-এ UDP খুলুন)
min-port=49152
max-port=65535
fingerprint
no-cli
log-file=/var/log/turnserver/turn.log
simple-log
EOF
chmod 600 "$CONF"
mkdir -p /var/log/turnserver 2>/dev/null || true
echo "🔧 লেখা হয়েছে: $CONF"

# Ubuntu-তে /etc/default/coturn-এ TURNSERVER_ENABLED=1 লাগে
if [[ -f /etc/default/coturn ]]; then
  sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn || true
  grep -q TURNSERVER_ENABLED /etc/default/coturn || echo "TURNSERVER_ENABLED=1" >> /etc/default/coturn
fi

# ── enable + restart ─────────────────────────────────────────────────────────
systemctl enable coturn 2>/dev/null || true
systemctl restart coturn || systemctl start coturn || true
sleep 2
echo "── coturn status ──"
systemctl is-active coturn && echo "✅ coturn চলছে।" || {
  echo "❌ coturn চালু হয়নি — লগ দেখুন:  journalctl -u coturn -n 40 --no-pager"
  exit 1
}
echo "✅ সম্পন্ন। এরপর: (১) MikroTik-এ 3478/5349 + relay(49152-65535) + RTP(10000-20000) forward,"
echo "   (২) sudo bash $ROOT/deploy/asterisk/fix_media_nat.sh  (Asterisk media),"
echo "   (৩) আসল ফোনে (mobile data) কল করে অডিও যাচাই।"
