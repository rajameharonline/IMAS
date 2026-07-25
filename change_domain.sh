#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# ISP-BNAS Domain পরিবর্তন Script
# ব্যবহার: bash change_domain.sh
# লেখক: ISP-BNAS System
# cd /var/www/isp_bnas
# bash change_domain.sh
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── রঙ ───────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log_ok()   { local msg="$1"; echo -e "  ${GREEN}✓${NC}  $msg"; }
log_info() { local msg="$1"; echo -e "  ${BLUE}→${NC}  $msg"; }
log_warn() { local msg="$1"; echo -e "  ${YELLOW}⚠${NC}  $msg"; }
log_err()  { local msg="$1"; echo -e "  ${RED}✗${NC}  $msg"; }
section()  { local msg="$1"; echo -e "\n${BOLD}${CYAN}── $msg ──${NC}"; }

# ── ফাইল পাথ (auto-detect — নতুন মেশিনে /opt, dev-এ /var/www) ────────────────
# env দিয়ে override: PROJECT_DIR=/custom/path bash change_domain.sh
if [[ -z "${PROJECT_DIR:-}" ]]; then
    for _d in /opt/isp_bnas /var/www/isp_bnas; do
        [[ -f "$_d/.env" ]] && PROJECT_DIR="$_d" && break
    done
    PROJECT_DIR="${PROJECT_DIR:-/opt/isp_bnas}"
fi
ENV_FILE="$PROJECT_DIR/.env"
SETTINGS_FILE="$PROJECT_DIR/config/settings.py"
NGINX_CONF="/etc/nginx/sites-available/isp_bnas"
BACKUP_DIR="$PROJECT_DIR/.domain_backup"

# ── Banner ────────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${BLUE}║   ISP-BNAS Domain পরিবর্তন করার Tool   ║${NC}"
echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════╝${NC}\n"

# ── বর্তমান domain স্বয়ংক্রিয় খোঁজা ────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
    log_err ".env ফাইল পাওয়া যায়নি: $ENV_FILE"
    exit 1
fi

# .env থেকে ALLOWED_HOSTS-এর প্রথম non-IP, non-localhost domain বের করা
CURRENT_DOMAIN=$(grep "^ALLOWED_HOSTS=" "$ENV_FILE" \
    | cut -d= -f2 \
    | tr ',' '\n' \
    | grep -v "^[0-9]" \
    | grep -v "localhost" \
    | grep -v "127.0.0.1" \
    | head -1 \
    | tr -d '[:space:]')

if [[ -z "$CURRENT_DOMAIN" ]]; then
    log_err "বর্তমান domain .env থেকে বের করা যায়নি।"
    echo -e "  ALLOWED_HOSTS লাইনটি দেখুন: $(grep 'ALLOWED_HOSTS' "$ENV_FILE")"
    exit 1
fi

echo -e "  বর্তমান Domain: ${BOLD}${YELLOW}$CURRENT_DOMAIN${NC}"
echo ""

# ── নতুন domain ইনপুট ────────────────────────────────────────────────────────
read -rp "$(echo -e "  ${BOLD}নতুন Domain লিখুন${NC} (যেমন: myisp.com বা isp.example.com): ")" NEW_DOMAIN

NEW_DOMAIN=$(echo "$NEW_DOMAIN" | tr -d '[:space:]' | sed 's|https\?://||g' | sed 's|/$||')

if [[ -z "$NEW_DOMAIN" ]]; then
    log_err "Domain খালি দেওয়া যাবে না।"
    exit 1
fi

if [[ "$NEW_DOMAIN" = "$CURRENT_DOMAIN" ]]; then
    log_warn "নতুন এবং পুরনো domain একই। কিছু পরিবর্তন করা হয়নি।"
    exit 0
fi

# ── SSL Certificate option ────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}SSL Certificate:${NC}"
echo -e "  ${CYAN}1)${NC} certbot দিয়ে নতুন certificate তৈরি করো (domain DNS আগে point করতে হবে)"
echo -e "  ${CYAN}2)${NC} শুধু config পরিবর্তন করো (SSL পরে করব)"
echo ""
read -rp "  পছন্দ করুন [1/2]: " SSL_CHOICE
SSL_CHOICE=${SSL_CHOICE:-2}

# ── নিশ্চিতকরণ ───────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}  পরিবর্তনের সারসংক্ষেপ:${NC}"
echo -e "  পুরনো domain: ${RED}$CURRENT_DOMAIN${NC}"
echo -e "  নতুন domain:  ${GREEN}$NEW_DOMAIN${NC}"
echo ""
echo -e "  পরিবর্তন হবে:"
echo -e "   ${CYAN}1.${NC} $ENV_FILE (ALLOWED_HOSTS)"
echo -e "   ${CYAN}2.${NC} $SETTINGS_FILE (CORS_ALLOWED_ORIGINS)"
echo -e "   ${CYAN}3.${NC} $NGINX_CONF (server_name + SSL paths)"
[[ "$SSL_CHOICE" = "1" ]] && echo -e "   ${CYAN}4.${NC} certbot SSL certificate তৈরি করা হবে"
echo -e "   ${CYAN}5.${NC} Nginx reload + Gunicorn reload"
echo ""
read -rp "$(echo -e "  ${BOLD}${YELLOW}নিশ্চিত? [yes/no]:${NC} ")" CONFIRM

if [[ "$CONFIRM" != "yes" ]]; then
    log_warn "বাতিল করা হয়েছে।"
    exit 0
fi

# ── Backup তৈরি ───────────────────────────────────────────────────────────────
section "Backup তৈরি করা হচ্ছে"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR/$TIMESTAMP"

cp "$ENV_FILE"      "$BACKUP_DIR/$TIMESTAMP/env.bak"
cp "$SETTINGS_FILE" "$BACKUP_DIR/$TIMESTAMP/settings.py.bak"
sudo cp "$NGINX_CONF" "$BACKUP_DIR/$TIMESTAMP/nginx.conf.bak" 2>/dev/null || true

log_ok "Backup সংরক্ষিত: $BACKUP_DIR/$TIMESTAMP/"

# ── 1. .env আপডেট ─────────────────────────────────────────────────────────────
section ".env আপডেট করা হচ্ছে"

# ALLOWED_HOSTS-এ পুরনো domain → নতুন domain
sed -i "s|${CURRENT_DOMAIN}|${NEW_DOMAIN}|g" "$ENV_FILE"
log_ok "ALLOWED_HOSTS আপডেট: $CURRENT_DOMAIN → $NEW_DOMAIN"

# ── 2. settings.py CORS আপডেট ────────────────────────────────────────────────
section "settings.py (CORS) আপডেট করা হচ্ছে"

# পুরনো domain যদি CORS-এ থাকে — replace করো
if grep -q "$CURRENT_DOMAIN" "$SETTINGS_FILE"; then
    sed -i "s|${CURRENT_DOMAIN}|${NEW_DOMAIN}|g" "$SETTINGS_FILE"
    log_ok "CORS-এ পুরনো domain replace হয়েছে"
fi

# নতুন domain CORS-এ যোগ করো (যদি না থাকে)
if ! grep -q "\"https://${NEW_DOMAIN}\"" "$SETTINGS_FILE"; then
    # CORS_ALLOWED_ORIGINS list-এর শেষ ] এর আগে insert করো
    sed -i "/^CORS_ALLOWED_ORIGINS = \[/,/^\]/ {
        /^\]/ i\\    \"https://${NEW_DOMAIN}\",\n    \"http://${NEW_DOMAIN}\",
    }" "$SETTINGS_FILE"
    log_ok "CORS-এ নতুন domain যোগ হয়েছে: https://$NEW_DOMAIN"
fi

# ── 3. Nginx config আপডেট ────────────────────────────────────────────────────
section "Nginx config আপডেট করা হচ্ছে"

# server_name এবং ssl path-এ পুরনো domain replace করো
sudo sed -i "s|${CURRENT_DOMAIN}|${NEW_DOMAIN}|g" "$NGINX_CONF"
log_ok "server_name আপডেট: $CURRENT_DOMAIN → $NEW_DOMAIN"
log_ok "SSL certificate path আপডেট"

# ── 4. SSL Certificate (certbot) ─────────────────────────────────────────────
if [[ "$SSL_CHOICE" = "1" ]]; then
    section "SSL Certificate তৈরি করা হচ্ছে (certbot)"
    log_info "certbot চালানো হচ্ছে... (sudo প্রয়োজন)"

    if sudo certbot certonly --nginx -d "$NEW_DOMAIN" --non-interactive --agree-tos --email "admin@${NEW_DOMAIN}" 2>&1; then
        log_ok "SSL Certificate তৈরি হয়েছে: /etc/letsencrypt/live/$NEW_DOMAIN/"
    else
        log_warn "certbot সফল হয়নি। নিচের কারণ হতে পারে:"
        echo -e "     • DNS এখনো নতুন IP-তে point করেনি"
        echo -e "     • Port 80 বন্ধ আছে"
        echo -e "     • Email ভুল"
        echo ""
        log_warn "পরে নিজে চালাও: sudo certbot --nginx -d $NEW_DOMAIN"

        # SSL paths উল্টো দিকে রাখো (যাতে nginx crash না করে)
        sudo sed -i "s|/etc/letsencrypt/live/${NEW_DOMAIN}/|/etc/letsencrypt/live/${CURRENT_DOMAIN}/|g" "$NGINX_CONF"
        log_warn "Nginx SSL path সাময়িকভাবে পুরনো cert-এ রাখা হয়েছে"
    fi
else
    section "SSL Certificate (পরে করতে হবে)"
    log_warn "SSL এখন করা হয়নি। Nginx-এ পুরনো cert path আছে।"
    echo -e "     পরে চালাও: ${BOLD}sudo certbot --nginx -d $NEW_DOMAIN${NC}"
fi

# ── 5. ai.md-এ domain আপডেট ──────────────────────────────────────────────────
section "ai.md আপডেট করা হচ্ছে"
if grep -q "$CURRENT_DOMAIN" "$PROJECT_DIR/ai.md" 2>/dev/null; then
    sed -i "s|${CURRENT_DOMAIN}|${NEW_DOMAIN}|g" "$PROJECT_DIR/ai.md"
    log_ok "ai.md-এ domain আপডেট হয়েছে"
fi

# ── 6. Nginx test + reload ────────────────────────────────────────────────────
section "Nginx Test ও Reload"

if sudo nginx -t 2>&1; then
    sudo systemctl reload nginx
    log_ok "Nginx সফলভাবে reload হয়েছে"
else
    log_err "Nginx config-এ ত্রুটি! Backup থেকে restore করা হচ্ছে..."
    sudo cp "$BACKUP_DIR/$TIMESTAMP/nginx.conf.bak" "$NGINX_CONF"
    sudo systemctl reload nginx
    log_warn "Nginx পুরনো config-এ ফিরে গেছে। ম্যানুয়ালি চেক করুন।"
    exit 1
fi

# ── 7. Gunicorn reload ────────────────────────────────────────────────────────
section "Gunicorn Reload"
if sudo -n systemctl reload isp-gunicorn.service 2>/dev/null; then
    log_ok "Gunicorn reload হয়েছে"
else
    log_warn "Gunicorn reload করতে পারেনি (permission)। নিজে করুন:"
    echo -e "     ${BOLD}sudo systemctl reload isp-gunicorn.service${NC}"
fi

# ── চূড়ান্ত সারসংক্ষেপ ────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║        Domain পরিবর্তন সম্পন্ন!        ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}পুরনো:${NC} $CURRENT_DOMAIN"
echo -e "  ${BOLD}নতুন: ${NC} $NEW_DOMAIN"
echo ""
echo -e "  ${BOLD}পরিবর্তিত ফাইলসমূহ:${NC}"
echo -e "   ✓ $ENV_FILE"
echo -e "   ✓ $SETTINGS_FILE"
echo -e "   ✓ $NGINX_CONF"
echo ""
echo -e "  ${BOLD}Backup রাখা আছে:${NC} $BACKUP_DIR/$TIMESTAMP/"
echo ""

# bKash webhook reminder
echo -e "  ${YELLOW}${BOLD}⚠  মনে রাখুন:${NC}"
echo -e "   • bKash Webhook URL আপডেট করুন:"
echo -e "     ${CYAN}https://${NEW_DOMAIN}/api/v1/billing/webhook/bkash-sns/${NC}"
echo -e "   • অন্য কোনো payment gateway-এর webhook URL থাকলে সেটাও আপডেট করুন"
echo ""

# SSL reminder if not done
if [[ "$SSL_CHOICE" != "1" ]]; then
    echo -e "  ${RED}${BOLD}⚠  SSL Certificate এখনো করা হয়নি:${NC}"
    echo -e "     ${BOLD}sudo certbot --nginx -d $NEW_DOMAIN${NC}"
    echo ""
fi
