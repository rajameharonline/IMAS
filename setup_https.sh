#!/bin/bash
# ================================================================
#  ISP BNAS — HTTPS Setup (Let's Encrypt)
#  ব্যবহার: sudo bash setup_https.sh roisp.duckdns.org
# ================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓ $*${NC}"; }
info() { echo -e "${CYAN}  → $*${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $*${NC}"; }
die()  { echo -e "${RED}  ✗ $*${NC}"; exit 1; }
step() { echo -e "\n${BOLD}${CYAN}══════════════════════════════════════════${NC}";
         echo -e "${BOLD}${CYAN}  $*${NC}";
         echo -e "${BOLD}${CYAN}══════════════════════════════════════════${NC}"; }

[[ $EUID -ne 0 ]] && die "sudo দিয়ে চালান: sudo bash setup_https.sh roisp.duckdns.org"
[[ $# -lt 1 ]] && die "Domain দিন: sudo bash setup_https.sh roisp.duckdns.org"

DOMAIN="$1"
DEPLOY_DIR="/var/www/isp_bnas"
EMAIL="rajameharonline1@gmail.com"

echo ""
echo -e "${BOLD}${CYAN}  ISP BNAS — HTTPS Setup${NC}"
echo -e "${CYAN}  Domain: ${BOLD}https://${DOMAIN}${NC}"
echo ""

# ── এই মেশিনের IP detect (hardcode নয় — নতুন মেশিনে নিজে থেকেই বের করে) ──
command -v dig &>/dev/null || apt-get install -y -qq dnsutils 2>/dev/null || true
PUBLIC_IP=$(curl -s --max-time 6 https://api.ipify.org 2>/dev/null \
            || curl -s --max-time 6 https://ifconfig.me 2>/dev/null || echo "")
LAN_IP=$(hostname -I | awk '{print $1}')

# ── Step 1: DNS Check ────────────────────────────────────────────
step "1. DNS Check"
echo -e "  ${CYAN}এই মেশিনের Public IP : ${PUBLIC_IP:-অজানা}${NC}"
echo -e "  ${CYAN}এই মেশিনের LAN IP    : ${LAN_IP}${NC}"
RESOLVED=$(dig +short "$DOMAIN" 2>/dev/null | tail -1 || true)
if [[ -z "$RESOLVED" ]]; then
    warn "DNS এখনো resolve হয়নি — DuckDNS-এ ${DOMAIN} এই IP-তে point করুন: ${PUBLIC_IP:-<public-ip>}"
else
    echo -e "  ${CYAN}${DOMAIN} → ${RESOLVED}${NC}"
    if [[ -n "$PUBLIC_IP" && "$RESOLVED" != "$PUBLIC_IP" ]]; then
        warn "IP mismatch: DuckDNS ${RESOLVED}-এ আছে, কিন্তু এই মেশিন ${PUBLIC_IP}। DuckDNS IP আপডেট করুন।"
    else
        ok "DNS সঠিক"
    fi
fi

# ── Step 2: Certbot Install ──────────────────────────────────────
step "2. Certbot Install"
if ! command -v certbot &>/dev/null; then
    info "Certbot install করা হচ্ছে..."
    apt-get update -qq
    apt-get install -y -qq certbot python3-certbot-nginx
    ok "Certbot installed"
else
    ok "Certbot: $(certbot --version 2>&1 | head -1)"
fi

# ── Step 3: HTTP Nginx (Certbot challenge এর জন্য) ──────────────
step "3. Nginx — HTTP Mode (cert নেওয়ার আগে)"
mkdir -p /var/www/html/.well-known/acme-challenge

cat > /etc/nginx/sites-available/isp_bnas <<NGINXEOF
upstream isp_django {
    server 127.0.0.1:8000;
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        root ${DEPLOY_DIR}/admin_panel/dist;
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://isp_django;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
        client_max_body_size 20M;
    }

    location /admin/ {
        proxy_pass http://isp_django;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /static/ {
        alias ${DEPLOY_DIR}/staticfiles/;
        expires 7d;
        access_log off;
    }

    location /media/ {
        alias ${DEPLOY_DIR}/media/;
        expires 7d;
    }

    location ~ /\.(?!well-known) { deny all; }
}
NGINXEOF

nginx -t && systemctl reload nginx
ok "Nginx HTTP mode ready"

# ── Step 4: SSL Certificate ──────────────────────────────────────
step "4. Let's Encrypt Certificate"
info "Certificate নেওয়া হচ্ছে (port 80 open থাকতে হবে)..."

certbot certonly \
    --webroot \
    --webroot-path /var/www/html \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    --non-interactive \
    -d "${DOMAIN}" || die "Certificate নেওয়া ব্যর্থ — port 80 forwarding ও DNS check করুন"

CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
ok "Certificate পাওয়া গেছে → ${CERT_DIR}"

# ── Step 5: HTTPS Nginx Config ───────────────────────────────────
step "5. Nginx — HTTPS Config"

cat > /etc/nginx/sites-available/isp_bnas <<NGINXEOF
upstream isp_django {
    server 127.0.0.1:8000;
    keepalive 32;
}

# HTTP → HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

# HTTPS
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${DOMAIN};

    ssl_certificate     ${CERT_DIR}/fullchain.pem;
    ssl_certificate_key ${CERT_DIR}/privkey.pem;
    ssl_trusted_certificate ${CERT_DIR}/chain.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_stapling on;
    ssl_stapling_verify on;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    location / {
        root ${DEPLOY_DIR}/admin_panel/dist;
        try_files \$uri \$uri/ /index.html;
        expires 1h;
    }

    location /assets/ {
        root ${DEPLOY_DIR}/admin_panel/dist;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location /api/ {
        proxy_pass http://isp_django;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 120s;
        client_max_body_size 20M;
    }

    location /admin/ {
        proxy_pass http://isp_django;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    location /static/ {
        alias ${DEPLOY_DIR}/staticfiles/;
        expires 7d;
        add_header Cache-Control "public";
        access_log off;
    }

    location /media/ {
        alias ${DEPLOY_DIR}/media/;
        expires 7d;
    }

    location ~ /\.(?!well-known) { deny all; }
}
NGINXEOF

nginx -t && ok "Nginx HTTPS config valid"

# ── Step 6: Django settings ──────────────────────────────────────
step "6. Django Settings Update"
# এই মেশিনের আসল IP দিয়ে ALLOWED_HOSTS (hardcode নয়)
AH="${DOMAIN},localhost,127.0.0.1"
[[ -n "$LAN_IP"    ]] && AH="${AH},${LAN_IP}"
[[ -n "$PUBLIC_IP" ]] && AH="${AH},${PUBLIC_IP}"
sed -i "s/^ALLOWED_HOSTS=.*/ALLOWED_HOSTS=${AH}/" "${DEPLOY_DIR}/.env"
# Django admin/form HTTPS POST-এর জন্য CSRF trusted origin (না থাকলে যোগ করি)
grep -q "^CSRF_TRUSTED_ORIGINS=" "${DEPLOY_DIR}/.env" \
    || echo "CSRF_TRUSTED_ORIGINS=https://${DOMAIN}" >> "${DEPLOY_DIR}/.env"
ok "ALLOWED_HOSTS updated: ${AH}"

# ── Step 7: Auto-Renewal ────────────────────────────────────────
step "7. Auto-Renewal"
if systemctl list-timers | grep -q certbot; then
    ok "Certbot systemd timer active (auto-renewal চলবে)"
else
    (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'") | sort -u | crontab -
    ok "Cron renewal set (প্রতিদিন রাত ৩টা)"
fi

# ── Step 8: Restart & Test ───────────────────────────────────────
step "8. Restart & Test"
systemctl reload nginx
systemctl restart isp-gunicorn
sleep 3

HTTP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" "https://${DOMAIN}/" 2>/dev/null || echo "000")
echo -e "  ${CYAN}https://${DOMAIN}/ → HTTP ${HTTP_CODE}${NC}"

EXPIRY=$(openssl x509 -enddate -noout -in "${CERT_DIR}/cert.pem" 2>/dev/null | cut -d= -f2 || echo "N/A")

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║   HTTPS Setup সম্পন্ন!                   ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}URL:${NC}         ${CYAN}https://${DOMAIN}${NC}"
echo -e "  ${BOLD}SSL Expires:${NC} ${EXPIRY}"
echo -e "  ${BOLD}Auto-renew:${NC}  হ্যাঁ (90 দিন পর পর auto)"
echo -e "  ${BOLD}Login:${NC}       admin / Admin@123"
echo ""
