#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# ISP-BNAS — VoIP Phase 1 installer (Asterisk + coturn + file-based PJSIP + TLS)।
# একবার sudo দিয়ে চালান:  sudo bash deploy/asterisk/install.sh [DOMAIN]
# DOMAIN না দিলে roisp.duckdns.org ধরা হয়।
#
# নকশা: realtime/ODBC ব্যবহার করা হয়নি (এই সার্ভারে mysql-server-8.4 ⨯ mariadb-common
# conflict — odbc-mariadb ইনস্টল করলে প্রোডাকশন MySQL remove হয়ে যায়)। তাই প্রতিটি SIP
# endpoint আলাদা .conf file (pjsip_isp.d/), Django লেখে ও AMI দিয়ে `pjsip reload` করে।
#
# এটি যা করে: প্যাকেজ install, PJSIP include dir (gunicorn user `isp` লিখতে পারে),
# Asterisk/coturn config (generated secrets সহ), Let's Encrypt cert, AMI (localhost),
# services চালু, এবং project .env-এ VoIP key গুলো লেখা (VOIP_ENABLED=True সহ)।
# Idempotent — বারবার চালানো নিরাপদ। কোনো MySQL DB তৈরি/পরিবর্তন করে না।
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

DOMAIN="${1:-roisp.duckdns.org}"
PROJECT_DIR="${PROJECT_DIR:-/var/www/isp_bnas}"
ENV_FILE="$PROJECT_DIR/.env"
BUNDLE="$PROJECT_DIR/deploy/asterisk"
GUNICORN_USER="isp"          # gunicorn যে user-এ চলে (file লেখে)
PJSIP_DIR="/etc/asterisk/pjsip_isp.d"

log()  { echo -e "\n\033[1;36m==> $*\033[0m"; }
warn() { echo -e "\033[1;33m[!] $*\033[0m"; }

[[ "$(id -u)" -eq 0 ]] || { echo "root হিসেবে চালান: sudo bash $0"; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo ".env পাওয়া যায়নি: $ENV_FILE (PROJECT_DIR ঠিক করুন)"; exit 1; }

set_env() {  # set_env KEY VALUE — .env upsert
  local k="$1" v="$2"
  if grep -qE "^${k}=" "$ENV_FILE"; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$ENV_FILE"
  else
    echo "${k}=${v}" >> "$ENV_FILE"
  fi
}

# ─── 1. প্যাকেজ (⚠️ odbc-mariadb নেই — mysql-server-এর সাথে conflict করে) ──────
log "প্যাকেজ install (asterisk, coturn, certbot)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
NEW_PKGS="asterisk asterisk-modules coturn certbot python3-certbot-nginx openssl"

# নিরাপত্তা গার্ড: install যেন কোনো DB server remove করতে না চায় (ডেটা বাঁচাতে)।
if apt-get install -s $NEW_PKGS 2>/dev/null \
     | grep -qiE "^Remv (mysql-server|mysql-server-core|mariadb-server)"; then
  warn "এই install বিদ্যমান DB server remove করতে চাইছে — বাতিল করা হলো।"
  apt-get install -s $NEW_PKGS 2>/dev/null | grep -iE "Remv" || true
  exit 1
fi
apt-get install -y $NEW_PKGS

# ─── 2. Secrets generate ─────────────────────────────────────────────────────
log "Secrets generate..."
ARI_USER="isp_django";  ARI_PASS="$(openssl rand -hex 24)"
AMI_USER="isp_django";  AMI_PASS="$(openssl rand -hex 24)"
TURN_SECRET="$(openssl rand -hex 32)"
ARI_APP="isp-voip"
PUBLIC_IP="$(curl -s --max-time 5 https://api.ipify.org || echo '')"

# ─── 3. PJSIP include dir (gunicorn user `isp` এখানে endpoint .conf লেখে) ─────
log "PJSIP include dir: $PJSIP_DIR ..."
id "$GUNICORN_USER" >/dev/null 2>&1 || { warn "user '$GUNICORN_USER' নেই — GUNICORN_USER ঠিক করুন।"; exit 1; }
install -d -o "$GUNICORN_USER" -g asterisk -m 2775 "$PJSIP_DIR"   # setgid → file asterisk group পায়

# ─── 4. Let's Encrypt cert (Asterisk + coturn একই cert) ──────────────────────
log "TLS cert ($DOMAIN)..."
if [[ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
  certbot certonly --nginx -d "$DOMAIN" --non-interactive --agree-tos \
          -m "admin@${DOMAIN}" || warn "certbot ব্যর্থ — পোর্ট 80 ও DNS চেক করে আবার চালান।"
fi
install -d -o asterisk -g asterisk -m 750 /etc/asterisk/keys
copy_certs() {
  cp "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" /etc/asterisk/keys/fullchain.pem
  cp "/etc/letsencrypt/live/$DOMAIN/privkey.pem"   /etc/asterisk/keys/privkey.pem
  chown asterisk:asterisk /etc/asterisk/keys/*.pem; chmod 640 /etc/asterisk/keys/*.pem
}
[[ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]] && copy_certs || warn "cert নেই — TLS/WSS চালু হবে না।"

cat > /etc/letsencrypt/renewal-hooks/deploy/asterisk-coturn.sh <<HOOK
#!/usr/bin/env bash
cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem /etc/asterisk/keys/fullchain.pem
cp /etc/letsencrypt/live/$DOMAIN/privkey.pem   /etc/asterisk/keys/privkey.pem
chown asterisk:asterisk /etc/asterisk/keys/*.pem; chmod 640 /etc/asterisk/keys/*.pem
systemctl reload asterisk 2>/dev/null || systemctl restart asterisk
systemctl restart coturn
HOOK
chmod +x /etc/letsencrypt/renewal-hooks/deploy/asterisk-coturn.sh

# ─── 5. Asterisk config (templated) ──────────────────────────────────────────
log "Asterisk config বসানো..."
render() {  # render SRC DST
  local src="$1" dst="$2"
  sed -e "s|@@ARI_USER@@|${ARI_USER}|g" -e "s|@@ARI_PASS@@|${ARI_PASS}|g" \
      -e "s|@@AMI_USER@@|${AMI_USER}|g" -e "s|@@AMI_PASS@@|${AMI_PASS}|g" \
      -e "s|@@ARI_APP@@|${ARI_APP}|g"   -e "s|@@DOMAIN@@|${DOMAIN}|g" \
      -e "s|@@PUBLIC_IP@@|${PUBLIC_IP}|g" "$src" > "$dst"
}
for f in pjsip http ari rtp extensions manager; do
  render "$BUNDLE/configs/$f.conf" "/etc/asterisk/$f.conf"
done
chown asterisk:asterisk /etc/asterisk/*.conf

# ─── 6. coturn config ────────────────────────────────────────────────────────
log "coturn config বসানো..."
render "$BUNDLE/coturn/turnserver.conf" /etc/turnserver.conf
mkdir -p /var/log/turnserver
sed -i 's/^#*TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn 2>/dev/null \
  || echo "TURNSERVER_ENABLED=1" > /etc/default/coturn

# ─── 7. project .env আপডেট ───────────────────────────────────────────────────
log ".env-এ VoIP key লেখা..."
set_env VOIP_ENABLED      True
set_env VOIP_SIP_DOMAIN   "$DOMAIN"
set_env VOIP_WSS_URL      "wss://${DOMAIN}:8089/ws"
set_env VOIP_PJSIP_DIR    "$PJSIP_DIR"
set_env ASTERISK_ARI_URL  "http://127.0.0.1:8088"
set_env ASTERISK_ARI_USER "$ARI_USER"
set_env ASTERISK_ARI_PASS "$ARI_PASS"
set_env ASTERISK_ARI_APP  "$ARI_APP"
set_env ASTERISK_AMI_HOST "127.0.0.1"
set_env ASTERISK_AMI_PORT "5038"
set_env ASTERISK_AMI_USER "$AMI_USER"
set_env ASTERISK_AMI_PASS "$AMI_PASS"
set_env TURN_URLS         "turn:${DOMAIN}:3478,turns:${DOMAIN}:5349"
set_env TURN_SECRET       "$TURN_SECRET"
set_env TURN_TTL          "3600"

# ─── 8. Services ─────────────────────────────────────────────────────────────
log "Services চালু..."
systemctl enable asterisk coturn >/dev/null 2>&1 || true
systemctl restart coturn
systemctl restart asterisk
sleep 3

# ─── 9. বিদ্যমান client/agent endpoint একবারে provision ──────────────────────
# ⚠️ root হিসেবে চালাই (isp নয়): .env mode 600 owner ভিন্ন — isp পড়তে পারে না, root পারে।
# Django settings BASE_DIR/.env নিজেই পড়ে, তাই DB creds পায়। তৈরি file পরে isp:asterisk-এ chown।
log "isp-gunicorn restart (নতুন .env: VOIP_ENABLED=True)..."
systemctl restart isp-gunicorn || warn "isp-gunicorn restart ব্যর্থ — হাতে করুন।"
log "বিদ্যমান client + active user endpoint provision..."
"$PROJECT_DIR/venv/bin/python" "$PROJECT_DIR/manage.py" voip_provision_all \
  || warn "voip_provision_all ব্যর্থ — পরে হাতে চালান।"
chown -R "$GUNICORN_USER":asterisk "$PJSIP_DIR" 2>/dev/null || true
chmod 640 "$PJSIP_DIR"/*.conf 2>/dev/null || true

# ─── 9b. VoIP call listener (AMI → call logs) systemd service ─────────────────
log "VoIP call listener service install..."
install -m 644 "$BUNDLE/isp-voip-listener.service" /etc/systemd/system/isp-voip-listener.service
systemctl daemon-reload
systemctl enable --now isp-voip-listener.service || warn "listener service চালু ব্যর্থ — লগ দেখুন।"

# ─── 10. সারাংশ ──────────────────────────────────────────────────────────────
log "সম্পন্ন। যাচাই:"
echo "  asterisk -rx 'pjsip show endpoints'   # provisioned client_/agent_ দেখাবে"
echo "  asterisk -rx 'http show status'        # 8089 TLS bound"
echo "  asterisk -rx 'manager show connected'  # AMI"
echo "  ls $PJSIP_DIR                          # প্রতি endpoint-এর .conf"
echo
warn "Firewall-এ খুলুন (পাবলিক):"
echo "  8089/tcp (WSS) , 3478/udp+tcp , 5349/tcp (TURN/TLS) , 49152-65535/udp (relay) , 10000-20000/udp (RTP)"
warn "বন্ধ/localhost-only: 8088 (ARI) , 5038 (AMI) , 5060 (plain SIP — দরকার নেই)"
echo
echo "Test:  curl -s -H 'Authorization: Bearer <JWT>' https://${DOMAIN}/api/v1/voip/sip-credentials/"
