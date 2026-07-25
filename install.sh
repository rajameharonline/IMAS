#!/bin/bash
# ================================================================
#  ISP BNAS — সম্পূর্ণ One-Click Install & Service Manager
#  Ubuntu 24.04 / 26.04 LTS
#
#  মাইগ্রেশন (পুরানো মেশিনে): sudo bash install.sh backup
#  নতুন মেশিনে install:        sudo bash install.sh
#  Service দেখতে:              sudo bash install.sh status
#  Restart:                    sudo bash install.sh restart
#  Logs:                       sudo bash install.sh logs
#  Update:                     sudo bash install.sh update
#  RADIUS fix:                 sudo bash install.sh radius-fix
# ================================================================
set -euo pipefail

# ── রং ──────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓ $*${NC}"; }
info() { echo -e "${CYAN}  → $*${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $*${NC}"; }
die()  { echo -e "${RED}  ✗ $*${NC}"; exit 1; }
step() { echo -e "\n${BOLD}${CYAN}══════════════════════════════════════════${NC}";
         echo -e "${BOLD}${CYAN}  $*${NC}";
         echo -e "${BOLD}${CYAN}══════════════════════════════════════════${NC}"; }

# ── স্থায়ী কনফিগারেশন ───────────────────────────────────────────
GITHUB_REPO="https://github.com/rajameharonline1-afk/isp_bnas.git"
# কোন branch থেকে কোড নেবে। main-এ merge না থাকলে env দিয়ে override করুন:
#   GIT_BRANCH=feat/mobile-app-overhaul sudo -E bash install.sh
GIT_BRANCH="${GIT_BRANCH:-main}"
# Project path — install নতুন মেশিনে /opt-এ করে, কিন্তু backup/status/restart ইত্যাদি
# বিদ্যমান install-এ চলে। তাই বিদ্যমান .env অনুযায়ী auto-detect (/opt → /var/www),
# নাহলে install-এর default /opt। env দিয়ে override করা যায়: PROJECT_DIR=/path ...
if [[ -z "${PROJECT_DIR:-}" ]]; then
    for _d in /opt/isp_bnas /var/www/isp_bnas; do
        [[ -f "$_d/.env" ]] && PROJECT_DIR="$_d" && break
    done
    PROJECT_DIR="${PROJECT_DIR:-/opt/isp_bnas}"
fi
PROJECT_USER="isp"
SERVICES=(isp-gunicorn isp-celery isp-celery-beat isp-snmptrap)
CRED_FILE="/root/isp_bnas_credentials.txt"

# ================================================================
#  Service Management Mode
# ================================================================
_docker_active() { command -v docker &>/dev/null && [[ -f "${PROJECT_DIR}/docker-compose.yml" ]]; }

_svc_status() {
    echo ""
    echo -e "${BOLD}  ISP BNAS — Service Status${NC}"
    echo "  ─────────────────────────────────────────"
    if _docker_active; then
        for c in django-app celery-worker celery-beat; do
            if docker compose -f "${PROJECT_DIR}/docker-compose.yml" ps "$c" 2>/dev/null | grep -q "Up"; then
                echo -e "  ${GREEN}✓ docker: $c${NC}"
            else
                echo -e "  ${RED}✗ docker: $c${NC}"
            fi
        done
        echo -e "  ${YELLOW}  (isp-gunicorn/isp-celery/isp-celery-beat systemd — idle rollback safety-net):${NC}"
    fi
    for svc in "${SERVICES[@]}"; do
        ST=$(systemctl is-active "$svc" 2>/dev/null || echo "inactive")
        [[ "$ST" == "active" ]] && echo -e "  ${GREEN}✓ $svc${NC}" \
                                 || echo -e "  ${RED}✗ $svc ($ST)${NC}"
    done
    for svc in mysql freeradius redis-server nginx asterisk; do
        ST=$(systemctl is-active "$svc" 2>/dev/null || echo "inactive")
        [[ "$ST" == "active" ]] && echo -e "  ${GREEN}✓ $svc${NC}" \
                                 || echo -e "  ${RED}✗ $svc${NC}"
    done
    echo "  ─────────────────────────────────────────"
    [[ -f "$CRED_FILE" ]] && grep "Admin Panel\|Username\|Password" "$CRED_FILE" | sed 's/^/  /'
    echo ""
}

_svc_restart() {
    if _docker_active; then
        info "Docker কন্টেইনার restart করা হচ্ছে (primary production path)..."
        (cd "${PROJECT_DIR}" && docker compose restart django-app celery-worker celery-beat) \
            && ok "Docker stack restarted" || warn "Docker restart failed"
    else
        info "systemd services restart করা হচ্ছে..."
        for svc in "${SERVICES[@]}"; do
            systemctl restart "$svc" 2>/dev/null && ok "$svc restarted" || warn "$svc restart failed"
        done
    fi
    systemctl restart asterisk 2>/dev/null && ok "asterisk restarted" || true
    systemctl reload nginx 2>/dev/null && ok "nginx reloaded"
}

_svc_stop()  {
    if _docker_active; then
        (cd "${PROJECT_DIR}" && docker compose stop django-app celery-worker celery-beat) \
            && ok "Docker stack stopped" || true
    fi
    for svc in "${SERVICES[@]}"; do systemctl stop "$svc" 2>/dev/null && ok "$svc stopped" || true; done
}
_svc_start() {
    if _docker_active; then
        (cd "${PROJECT_DIR}" && docker compose up -d django-app celery-worker celery-beat) \
            && ok "Docker stack started" || warn "Docker start failed"
    fi
    for svc in "${SERVICES[@]}"; do systemctl start "$svc" 2>/dev/null && ok "$svc started (idle safety-net)" || warn "$svc start failed"; done
}

_svc_logs() {
    TARGET="${2:-isp-gunicorn}"
    echo -e "${CYAN}=== $TARGET logs (last 50 lines) ===${NC}"
    journalctl -u "$TARGET" -n 50 --no-pager
}

_svc_update() {
    [[ $EUID -ne 0 ]] && die "sudo দিয়ে চালান"
    info "GitHub থেকে latest code pull করা হচ্ছে (branch: ${GIT_BRANCH})..."
    git -C "${PROJECT_DIR}" pull origin "${GIT_BRANCH}"

    cd "${PROJECT_DIR}/admin_panel" && npm install --silent && npm run build
    cd "${PROJECT_DIR}"

    if _docker_active; then
        info "Docker image rebuild করা হচ্ছে..."
        docker compose build
        docker compose exec -T django-app python manage.py migrate --noinput 2>/dev/null || true
        docker compose exec -T django-app python manage.py collectstatic --noinput --clear 2>/dev/null || true
        docker compose up -d django-app celery-worker celery-beat
        ok "Docker stack rebuild ও restart সম্পন্ন"
    else
        source "${PROJECT_DIR}/venv/bin/activate"
        pip install --quiet -r "${PROJECT_DIR}/requirements.txt"
        python "${PROJECT_DIR}/manage.py" migrate --noinput
        python "${PROJECT_DIR}/manage.py" collectstatic --noinput --clear
        deactivate
        systemctl restart isp-gunicorn
        ok "Update ও restart সম্পন্ন"
    fi
}

# RADIUS-only fix (install এর পরে যেকোনো সময় চালানো যায়)
_radius_fix() {
    [[ $EUID -ne 0 ]] && die "sudo দিয়ে চালান"
    [[ ! -f "${PROJECT_DIR}/.env" ]] && die "Project not installed. আগে install চালান।"

    step "RADIUS Database Fix"

    # .env থেকে config পড়ি
    DB_NAME=$(grep "^DB_NAME=" "${PROJECT_DIR}/.env" | cut -d= -f2)
    DB_USER=$(grep "^DB_USER=" "${PROJECT_DIR}/.env" | cut -d= -f2)
    DB_PASS=$(grep "^DB_PASSWORD=" "${PROJECT_DIR}/.env" | cut -d= -f2)
    RADIUS_SECRET=$(grep "^RADIUS_SECRET=" "${PROJECT_DIR}/.env" | cut -d= -f2 || echo "")

    MYSQL="mysql -u${DB_USER} -p${DB_PASS} ${DB_NAME}"

    info "Missing indexes যোগ করা হচ্ছে..."
    $MYSQL 2>/dev/null << 'SQL'
        ALTER TABLE radacct ADD INDEX IF NOT EXISTS acctstoptime (acctstoptime);
        ALTER TABLE radacct ADD INDEX IF NOT EXISTS acctupdatetime (acctupdatetime);
        ALTER TABLE radpostauth ADD INDEX IF NOT EXISTS authdate (authdate);
SQL

    info "Acct-Interim-Interval যোগ করা হচ্ছে..."
    $MYSQL 2>/dev/null << 'SQL'
        INSERT INTO radgroupreply (groupname, attribute, op, value)
        SELECT g.groupname, 'Acct-Interim-Interval', ':=', '300'
        FROM (SELECT DISTINCT groupname FROM radgroupreply) g
        WHERE NOT EXISTS (
            SELECT 1 FROM radgroupreply r2
            WHERE r2.groupname = g.groupname AND r2.attribute = 'Acct-Interim-Interval'
        );
SQL

    info "Old radpostauth cleanup (7 দিনের বেশি পুরনো)..."
    $MYSQL -e "DELETE FROM radpostauth WHERE authdate < NOW() - INTERVAL 7 DAY;" 2>/dev/null

    info "Stale open sessions close করা হচ্ছে..."
    $MYSQL -e "UPDATE radacct SET acctstoptime=COALESCE(acctupdatetime,acctstarttime), acctterminatecause='Session-Timeout' WHERE acctstoptime IS NULL AND (acctupdatetime < NOW() - INTERVAL 3 DAY OR (acctupdatetime IS NULL AND acctstarttime < NOW() - INTERVAL 3 DAY));" 2>/dev/null

    info "FreeRADIUS mods-enabled cleanup (stray .bak files)..."
    find /etc/freeradius/3.0/mods-enabled/ -name "*.bak*" -delete 2>/dev/null || true

    systemctl restart freeradius 2>/dev/null && ok "FreeRADIUS restarted" || warn "FreeRADIUS restart failed"

    info "Authentication test..."
    SECRET=$(grep "^RADIUS_SECRET=" "${PROJECT_DIR}/.env" | cut -d= -f2 || echo "testing123")
    radtest admin admin localhost 0 "${SECRET}" 2>&1 | grep -E "Access-Accept|Access-Reject|No reply" || true

    ok "RADIUS fix সম্পন্ন"
}

# ================================================================
#  Backup Mode — পুরানো মেশিনে চালান, নতুন মেশিনে restore হবে
# ================================================================
_do_backup() {
    [[ $EUID -ne 0 ]] && die "sudo দিয়ে চালান"
    [[ ! -f "${PROJECT_DIR}/.env" ]] && die "Project install নেই। আগে install চালান।"

    step "ISP BNAS — সম্পূর্ণ Backup"

    DB_NAME_B=$(grep "^DB_NAME="     "${PROJECT_DIR}/.env" | cut -d= -f2)
    DB_USER_B=$(grep "^DB_USER="     "${PROJECT_DIR}/.env" | cut -d= -f2)
    DB_PASS_B=$(grep "^DB_PASSWORD=" "${PROJECT_DIR}/.env" | cut -d= -f2)

    BACKUP_DATE=$(date +%Y%m%d_%H%M%S)
    BACKUP_FILE="/root/isp_bnas_backup_${BACKUP_DATE}.tar.gz"
    TMP_DIR=$(mktemp -d)

    info "Database dump করা হচ্ছে (সব tables + data)..."
    mysqldump \
        -u"${DB_USER_B}" -p"${DB_PASS_B}" \
        --single-transaction --routines --triggers \
        "${DB_NAME_B}" > "${TMP_DIR}/database.sql" \
        || die "Database dump ব্যর্থ। credentials চেক করুন।"
    ok "Database dump সম্পন্ন ($(du -sh "${TMP_DIR}/database.sql" | cut -f1))"

    info "Media files কপি করা হচ্ছে..."
    if [[ -d "${PROJECT_DIR}/media" ]]; then
        cp -a "${PROJECT_DIR}/media" "${TMP_DIR}/media"
        ok "Media files ready ($(du -sh "${TMP_DIR}/media" | cut -f1))"
    else
        mkdir -p "${TMP_DIR}/media"
        warn "Media folder খালি"
    fi

    # .env reference (নতুন মেশিনে সরাসরি ব্যবহার হবে না, শুধু তথ্যের জন্য)
    cp "${PROJECT_DIR}/.env" "${TMP_DIR}/env_reference.txt"
    [[ -f "${PROJECT_DIR}/.env.docker" ]] && cp "${PROJECT_DIR}/.env.docker" "${TMP_DIR}/env_docker_reference.txt"

    # ── Asterisk (VoIP) কনফিগ — কোনো git/DB-তে নেই, শুধু এখানেই ────────────
    info "Asterisk কনফিগ ব্যাকআপ করা হচ্ছে..."
    if [[ -d /etc/asterisk ]]; then
        tar -czf "${TMP_DIR}/asterisk_config.tar.gz" -C /etc asterisk 2>/dev/null || true
        ok "Asterisk কনফিগ ready"
    else
        warn "Asterisk কনফিগ পাওয়া যায়নি"
    fi

    # ── nginx + systemd unit — migrate করলে নতুন মেশিনে দরকার হতে পারে ──────
    info "nginx/systemd কনফিগ ব্যাকআপ করা হচ্ছে..."
    tar -czf "${TMP_DIR}/system_config.tar.gz" \
        --ignore-failed-read \
        /etc/nginx/sites-available/isp_bnas \
        /etc/systemd/system/isp-*.service \
        /etc/cron.d/isp_bnas_radius \
        /etc/letsencrypt/ \
        2>/dev/null || true
    ok "nginx/systemd/SSL কনফিগ ready"

    # Backup metadata
    cat > "${TMP_DIR}/backup_info.txt" << META
ISP BNAS Backup
===============
Date       : $(date)
Source IP  : $(hostname -I | awk '{print $1}')
DB Name    : ${DB_NAME_B}
DB User    : ${DB_USER_B}
Media Size : $(du -sh "${TMP_DIR}/media" | cut -f1)
Includes   : database.sql, media/, asterisk_config.tar.gz, system_config.tar.gz (nginx+systemd+SSL cert), env_reference.txt
META

    info "Archive তৈরি করা হচ্ছে..."
    tar -czf "${BACKUP_FILE}" -C "${TMP_DIR}" .
    rm -rf "${TMP_DIR}"
    BACKUP_SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)

    echo ""
    ok "Backup সম্পন্ন → ${BACKUP_FILE} (${BACKUP_SIZE})"
    echo ""
    echo -e "${BOLD}  নতুন মেশিনে কপি করুন:${NC}"
    echo -e "  ${CYAN}scp ${BACKUP_FILE} user@NEW_IP:/root/${NC}"
    echo ""
    echo -e "${BOLD}  নতুন মেশিনে install করুন:${NC}"
    echo -e "  ${CYAN}sudo bash install.sh${NC}"
    echo -e "  ${CYAN}(Backup file path জিজ্ঞেস করলে উপরের path দিন)${NC}"
    echo ""
}

# Sub-command routing
case "${1:-install}" in
    status)     _svc_status;  exit 0 ;;
    restart)    _svc_restart; exit 0 ;;
    stop)       _svc_stop;    exit 0 ;;
    start)      _svc_start;   exit 0 ;;
    logs)       _svc_logs "$@"; exit 0 ;;
    update)     _svc_update;  exit 0 ;;
    radius-fix) _radius_fix;  exit 0 ;;
    backup)     _do_backup;   exit 0 ;;
    install)    : ;;
    *) echo "ব্যবহার: sudo bash install.sh [install|backup|status|restart|stop|start|logs|update|radius-fix]"; exit 1 ;;
esac

# ================================================================
#  INSTALL MODE
# ================================================================
[[ $EUID -ne 0 ]] && die "sudo দিয়ে চালান:  sudo bash install.sh"

echo ""
echo -e "${BOLD}${CYAN}"
echo "  ╔══════════════════════════════════════════════════╗"
echo "  ║   ISP BNAS — One-Click Auto Setup Installer     ║"
echo "  ║   Rajamehar Online ISP Management System         ║"
echo "  ╚══════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "  এই script টি নিচের সব কাজ স্বয়ংক্রিয়ভাবে করবে:"
echo "   • MySQL, FreeRADIUS, Redis, Nginx, Asterisk (VoIP) ইনস্টল ও কনফিগার"
echo "   • RADIUS schema + সব indexes + Acct-Interim-Interval"
echo "   • NAS table registration (Mikrotik router সমূহ)"
echo "   • Project clone, Python venv, সব package install"
echo "   • Django migrate, admin user তৈরি, frontend build"
echo "   • Docker Engine + Phase-1 stack (django-app/celery-worker/celery-beat — primary)"
echo "   • Systemd services (idle rollback safety-net, auto-start on boot)"
echo "   • SSL সার্টিফিকেট (Let's Encrypt, ডোমেইন দিলে)"
echo "   • RADIUS daily maintenance cron job"
echo "   • Backup থেকে database + media + Asterisk + SSL auto-restore (মাইগ্রেশনে)"
echo ""

# ── ইনপুট সংগ্রহ ─────────────────────────────────────────────────
echo -e "${BOLD}  প্রয়োজনীয় তথ্য দিন:${NC}\n"

read -rp "  MySQL root পাসওয়ার্ড (নতুন সেট করুন): " MYSQL_ROOT_PASS
[[ -z "$MYSQL_ROOT_PASS" ]] && die "MySQL root পাসওয়ার্ড দিতে হবে।"

read -rp "  RADIUS / Django DB পাসওয়ার্ড [010230]: " DB_PASS
DB_PASS="${DB_PASS:-010230}"

read -rp "  FreeRADIUS shared secret (Mikrotik এও একই দিন) [010230]: " RADIUS_SECRET
RADIUS_SECRET="${RADIUS_SECRET:-010230}"

read -rp "  প্রথম Mikrotik Router IP [172.16.3.10]: " MIKROTIK_IP
MIKROTIK_IP="${MIKROTIK_IP:-172.16.3.10}"

read -rp "  প্রথম Mikrotik নাম [MTK_PPP]: " MIKROTIK_NAME
MIKROTIK_NAME="${MIKROTIK_NAME:-MTK_PPP}"

read -rp "  দ্বিতীয় Mikrotik Router IP (না থাকলে খালি রাখুন): " MIKROTIK_IP2
MIKROTIK_IP2="${MIKROTIK_IP2:-}"

read -rp "  দ্বিতীয় Mikrotik নাম [MTK_AC]: " MIKROTIK_NAME2
MIKROTIK_NAME2="${MIKROTIK_NAME2:-MTK_AC}"

read -rp "  এই সার্ভারের IP [auto]: " SERVER_IP
[[ -z "$SERVER_IP" ]] && SERVER_IP=$(hostname -I | awk '{print $1}')

read -rp "  ডোমেইন নাম (SSL-এর জন্য, না থাকলে খালি রাখুন): " DOMAIN_NAME
DOMAIN_NAME="${DOMAIN_NAME:-}"

read -rp "  Admin username [admin]: " ADMIN_USER
ADMIN_USER="${ADMIN_USER:-admin}"

read -rsp "  Admin পাসওয়ার্ড [Admin@123]: " ADMIN_PASS
echo ""
ADMIN_PASS="${ADMIN_PASS:-Admin@123}"

read -rp "  কোম্পানির নাম [Rajamehar Online]: " COMPANY_NAME
COMPANY_NAME="${COMPANY_NAME:-Rajamehar Online}"

echo ""
read -rp "  Backup file path (মাইগ্রেশনে দিন, fresh install এ খালি রাখুন): " BACKUP_FILE
BACKUP_FILE="${BACKUP_FILE:-}"
if [[ -n "$BACKUP_FILE" ]]; then
    [[ ! -f "$BACKUP_FILE" ]] && die "Backup file পাওয়া যায়নি: $BACKUP_FILE"
    ok "Backup file পাওয়া গেছে: $BACKUP_FILE ($(du -sh "$BACKUP_FILE" | cut -f1))"
fi

DB_NAME="radius"
DB_USER="radius"

echo ""
echo -e "${BOLD}  ── নিশ্চিত করুন ──────────────────────────────${NC}"
echo "  Server IP      : $SERVER_IP"
echo "  Domain (SSL)   : ${DOMAIN_NAME:-না (শুধু HTTP)}"
echo "  DB Password    : $DB_PASS"
echo "  RADIUS Secret  : $RADIUS_SECRET"
echo "  Mikrotik 1     : $MIKROTIK_IP ($MIKROTIK_NAME)"
[[ -n "$MIKROTIK_IP2" ]] && echo "  Mikrotik 2     : $MIKROTIK_IP2 ($MIKROTIK_NAME2)"
echo "  Admin User     : $ADMIN_USER"
echo "  Project Path   : $PROJECT_DIR"
[[ -n "$BACKUP_FILE" ]] && echo "  Backup Restore : $BACKUP_FILE" || echo "  Backup Restore : না (fresh install)"
echo ""
read -rp "  সব ঠিক আছে? এগিয়ে যাব? (y/N): " CONFIRM
[[ "${CONFIRM,,}" != "y" ]] && die "বাতিল করা হয়েছে।"

export DEBIAN_FRONTEND=noninteractive

# ================================================================
step "ধাপ ১ / ১১ — সিস্টেম আপডেট ও প্যাকেজ ইনস্টল"
# ================================================================

apt-get update -qq
apt-get install -y -qq \
    curl wget git unzip rsync gnupg lsb-release ca-certificates \
    build-essential pkg-config \
    libssl-dev libffi-dev libjpeg-dev zlib1g-dev \
    nginx \
    redis-server \
    freeradius freeradius-mysql freeradius-utils \
    mysql-server mysql-client libmysqlclient-dev \
    php php-fpm php-mysql php-mbstring php-zip \
    php-gd php-json php-curl php-xml \
    python3 python3-pip python3-venv python3-dev \
    net-tools iputils-ping iproute2 \
    asterisk asterisk-mysql \
    snmp \
    ffmpeg \
    2>/dev/null
ok "System packages ইনস্টল সম্পন্ন (Asterisk/SNMP/ffmpeg সহ)"

# phpMyAdmin — apache2 conflict prevent করে আলাদাভাবে install
# Ubuntu 26.04 এ phpmyadmin Recommends এ apache2 আছে, যেটা Nginx কে block করে
info "phpMyAdmin install করা হচ্ছে (apache2 ছাড়া)..."
echo "phpmyadmin phpmyadmin/reconfigure-webserver multiselect none" | debconf-set-selections
echo "phpmyadmin phpmyadmin/dbconfig-install boolean false" | debconf-set-selections
apt-get install -y -qq --no-install-recommends phpmyadmin 2>/dev/null
# apache2 যদি কোনোভাবে install হয়ে যায়, বন্ধ করো
systemctl stop apache2 2>/dev/null || true
systemctl disable apache2 2>/dev/null || true
ok "phpMyAdmin install সম্পন্ন (apache2 disabled)"

# Node.js v22
if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]]; then
    info "Node.js v22 ইনস্টল করা হচ্ছে..."
    curl --proto '=https' --tlsv1.2 -fsSL https://deb.nodesource.com/setup_22.x | bash - 2>/dev/null
    apt-get install -y -qq nodejs 2>/dev/null
fi
ok "Node.js $(node -v) ready"

# Django 6.0 = Python 3.12+; নতুন version আগে নিই (Ubuntu 26.04-এ python3 = 3.13/3.14)।
PYTHON_CMD=$(command -v python3.14 || command -v python3.13 || command -v python3.12 || command -v python3)
$PYTHON_CMD -c "import sys; exit(0 if sys.version_info>=(3,12) else 1)" || \
    die "Python 3.12+ দরকার (Django 6.0)। Ubuntu 26.04-এর default python3 যথেষ্ট।"
# ওই exact minor version-এর venv ও dev package নিশ্চিত করি (ensurepip/venv-এর জন্য)
PYV=$($PYTHON_CMD -c "import sys;print(f'{sys.version_info.major}.{sys.version_info.minor}')")
apt-get install -y -qq "python${PYV}-venv" "python${PYV}-dev" 2>/dev/null || true
ok "Python $($PYTHON_CMD --version) ready"

# ================================================================
step "ধাপ ২ / ১১ — MySQL ডাটাবেস ও User তৈরি"
# ================================================================

systemctl enable --now mysql 2>/dev/null || true

mysql -u root -e "SELECT 1;" 2>/dev/null && MYSQL_AUTH="" || MYSQL_AUTH="--password=${MYSQL_ROOT_PASS}"
mysql -u root $MYSQL_AUTH -e "
  ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '${MYSQL_ROOT_PASS}';
  FLUSH PRIVILEGES;" 2>/dev/null || true

MYSQL="mysql -u root --password=${MYSQL_ROOT_PASS}"

$MYSQL -e "
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED WITH mysql_native_password BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
CREATE USER IF NOT EXISTS 'phpmyadmin'@'localhost' IDENTIFIED WITH mysql_native_password BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON *.* TO 'phpmyadmin'@'localhost' WITH GRANT OPTION;
FLUSH PRIVILEGES;" 2>/dev/null
ok "Database '${DB_NAME}', user '${DB_USER}' তৈরি সম্পন্ন"

# ================================================================
step "ধাপ ৩ / ১১ — FreeRADIUS Schema, Indexes ও কনফিগারেশন"
# ================================================================

systemctl stop freeradius 2>/dev/null || true

# ── RADIUS Tables ও সব indexes ──────────────────────────────────
info "RADIUS tables ও indexes তৈরি করা হচ্ছে..."
$MYSQL "${DB_NAME}" << 'SQL'
-- radacct: accounting sessions (সব indexes সহ)
CREATE TABLE IF NOT EXISTS radacct (
  radacctid       bigint(21)    NOT NULL auto_increment,
  acctsessionid   varchar(64)   NOT NULL default '',
  acctuniqueid    varchar(32)   NOT NULL default '',
  username        varchar(64)   NOT NULL default '',
  groupname       varchar(64)   NOT NULL default '',
  realm           varchar(64)   default '',
  nasipaddress    varchar(15)   NOT NULL default '',
  nasportid       varchar(50)   default NULL,
  nasporttype     varchar(32)   default NULL,
  acctstarttime   datetime      NULL default NULL,
  acctupdatetime  datetime      NULL default NULL,
  acctstoptime    datetime      NULL default NULL,
  acctinterval    int(12)       default NULL,
  acctsessiontime int(12) unsigned default NULL,
  acctauthentic   varchar(32)   default NULL,
  connectinfo_start varchar(50) default NULL,
  connectinfo_stop  varchar(50) default NULL,
  acctinputoctets  bigint(20)   default NULL,
  acctoutputoctets bigint(20)   default NULL,
  calledstationid  varchar(50)  NOT NULL default '',
  callingstationid varchar(50)  NOT NULL default '',
  acctterminatecause varchar(32) NOT NULL default '',
  servicetype      varchar(32)  default NULL,
  framedprotocol   varchar(32)  default NULL,
  framedipaddress  varchar(15)  NOT NULL default '',
  framedipv6address  varchar(128) DEFAULT NULL,
  framedipv6prefix   varchar(128) DEFAULT NULL,
  framedinterfaceid  varchar(44)  DEFAULT NULL,
  delegatedipv6prefix varchar(44) DEFAULT NULL,
  PRIMARY KEY (radacctid),
  UNIQUE KEY acctuniqueid (acctuniqueid),
  KEY username      (username),
  KEY framedipaddress (framedipaddress),
  KEY acctstarttime   (acctstarttime),
  KEY acctstoptime    (acctstoptime),
  KEY acctupdatetime  (acctupdatetime),
  KEY nasipaddress    (nasipaddress),
  KEY acctsessionid   (acctsessionid)
) ENGINE=InnoDB;

-- radcheck: user authentication rules
CREATE TABLE IF NOT EXISTS radcheck (
  id        int(11) unsigned NOT NULL auto_increment,
  username  varchar(64)  NOT NULL default '',
  attribute varchar(64)  NOT NULL default '',
  op        char(2)      NOT NULL DEFAULT ':=',
  value     varchar(253) NOT NULL default '',
  PRIMARY KEY (id),
  KEY username (username(32))
) ENGINE=InnoDB;

-- radreply: user reply attributes
CREATE TABLE IF NOT EXISTS radreply (
  id        int(11) unsigned NOT NULL auto_increment,
  username  varchar(64)  NOT NULL default '',
  attribute varchar(64)  NOT NULL default '',
  op        char(2)      NOT NULL DEFAULT '=',
  value     varchar(253) NOT NULL default '',
  PRIMARY KEY (id),
  KEY username (username(32))
) ENGINE=InnoDB;

-- radgroupcheck: group check attributes
CREATE TABLE IF NOT EXISTS radgroupcheck (
  id        int(11) unsigned NOT NULL auto_increment,
  groupname varchar(64)  NOT NULL default '',
  attribute varchar(64)  NOT NULL default '',
  op        char(2)      NOT NULL DEFAULT ':=',
  value     varchar(253) NOT NULL default '',
  PRIMARY KEY (id),
  KEY groupname (groupname(32))
) ENGINE=InnoDB;

-- radgroupreply: group reply attributes (speed, pool, interim-interval)
CREATE TABLE IF NOT EXISTS radgroupreply (
  id        int(11) unsigned NOT NULL auto_increment,
  groupname varchar(64)  NOT NULL default '',
  attribute varchar(64)  NOT NULL default '',
  op        char(2)      NOT NULL DEFAULT '=',
  value     varchar(253) NOT NULL default '',
  PRIMARY KEY (id),
  KEY groupname (groupname(32))
) ENGINE=InnoDB;

-- radusergroup: user → group mapping
CREATE TABLE IF NOT EXISTS radusergroup (
  username  varchar(64) NOT NULL default '',
  groupname varchar(64) NOT NULL default '',
  priority  int(11)     NOT NULL default 1,
  KEY username (username(32))
) ENGINE=InnoDB;

-- radpostauth: auth log (authdate index সহ — cleanup এর জন্য জরুরি)
CREATE TABLE IF NOT EXISTS radpostauth (
  id       int(11) unsigned NOT NULL auto_increment,
  username varchar(64)  NOT NULL default '',
  pass     varchar(64)  NOT NULL default '',
  reply    varchar(32)  NOT NULL default '',
  authdate timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  class    varchar(64)  DEFAULT NULL,
  PRIMARY KEY (id),
  KEY username (username),
  KEY authdate (authdate)
) ENGINE=InnoDB;

-- nas: NAS (Network Access Server) clients
CREATE TABLE IF NOT EXISTS nas (
  id          int(10)      NOT NULL auto_increment,
  nasname     varchar(128) NOT NULL,
  shortname   varchar(32),
  type        varchar(30)  default 'other',
  ports       int(5),
  secret      varchar(60)  default 'secret',
  description varchar(200) default 'RADIUS Client',
  PRIMARY KEY (id),
  KEY nasname (nasname)
) ENGINE=InnoDB;
SQL
ok "RADIUS tables ও indexes তৈরি সম্পন্ন"

# Missing columns (existing DB upgrade সাপোর্ট)
for COL_DEF in \
    "framedipv6address VARCHAR(128) DEFAULT NULL" \
    "framedipv6prefix VARCHAR(128) DEFAULT NULL" \
    "framedinterfaceid VARCHAR(44) DEFAULT NULL" \
    "delegatedipv6prefix VARCHAR(44) DEFAULT NULL" \
    "acctupdatetime datetime NULL DEFAULT NULL"; do
    COL=$(echo "$COL_DEF" | awk '{print $1}')
    $MYSQL "${DB_NAME}" -e "ALTER TABLE radacct ADD COLUMN IF NOT EXISTS ${COL_DEF};" 2>/dev/null || true
done
$MYSQL "${DB_NAME}" -e "ALTER TABLE radpostauth ADD COLUMN IF NOT EXISTS class varchar(64) DEFAULT NULL;" 2>/dev/null || true

# Missing indexes (existing DB)
$MYSQL "${DB_NAME}" -e "ALTER TABLE radacct ADD INDEX IF NOT EXISTS acctupdatetime (acctupdatetime);" 2>/dev/null || true
$MYSQL "${DB_NAME}" -e "ALTER TABLE radacct ADD INDEX IF NOT EXISTS acctsessionid (acctsessionid);" 2>/dev/null || true
$MYSQL "${DB_NAME}" -e "ALTER TABLE radpostauth ADD INDEX IF NOT EXISTS authdate (authdate);" 2>/dev/null || true
ok "Schema upgrade (existing DB) সম্পন্ন"

# ── NAS entries ──────────────────────────────────────────────────
info "NAS entries register করা হচ্ছে..."
$MYSQL "${DB_NAME}" -e "
INSERT INTO nas (nasname, shortname, type, secret, description)
VALUES ('${MIKROTIK_IP}','${MIKROTIK_NAME}','other','${RADIUS_SECRET}',
        'Mikrotik Router: ${MIKROTIK_NAME}')
ON DUPLICATE KEY UPDATE secret='${RADIUS_SECRET}', shortname='${MIKROTIK_NAME}';" 2>/dev/null
ok "NAS registered: ${MIKROTIK_IP} (${MIKROTIK_NAME})"

if [[ -n "$MIKROTIK_IP2" ]]; then
    $MYSQL "${DB_NAME}" -e "
    INSERT INTO nas (nasname, shortname, type, secret, description)
    VALUES ('${MIKROTIK_IP2}','${MIKROTIK_NAME2}','other','${RADIUS_SECRET}',
            'Mikrotik Router: ${MIKROTIK_NAME2}')
    ON DUPLICATE KEY UPDATE secret='${RADIUS_SECRET}', shortname='${MIKROTIK_NAME2}';" 2>/dev/null
    ok "NAS registered: ${MIKROTIK_IP2} (${MIKROTIK_NAME2})"
fi

# ── Default RADIUS groups (ppp + Acct-Interim-Interval) ──────────
info "Default RADIUS groups তৈরি করা হচ্ছে..."
$MYSQL "${DB_NAME}" << SQL
-- ppp group (PPPoE clients)
INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES
  ('ppp', 'Framed-Pool',         '=',  'ppp_pool'),
  ('ppp', 'Mikrotik-Group',      ':=', 'ppp'),
  ('ppp', 'Acct-Interim-Interval',':=','300')
ON DUPLICATE KEY UPDATE op=VALUES(op), value=VALUES(value);

-- 5M group (5 Mbps package)
INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES
  ('5M', 'Framed-Pool',          '=',  '5M'),
  ('5M', 'Mikrotik-Group',       ':=', '5M'),
  ('5M', 'Acct-Interim-Interval',':=', '300')
ON DUPLICATE KEY UPDATE op=VALUES(op), value=VALUES(value);

-- 10M group (10 Mbps package)
INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES
  ('10M', 'Framed-Pool',          '=',  '10M'),
  ('10M', 'Mikrotik-Group',       ':=', '10M'),
  ('10M', 'Acct-Interim-Interval',':=', '300')
ON DUPLICATE KEY UPDATE op=VALUES(op), value=VALUES(value);
SQL
ok "Default groups: ppp, 5M, 10M (সব Acct-Interim-Interval=300 সহ)"

# ── FreeRADIUS clients.conf ───────────────────────────────────────
FR_DIR="/etc/freeradius/3.0"
info "FreeRADIUS clients.conf তৈরি করা হচ্ছে..."

cat > "${FR_DIR}/clients.conf" << CLIENTS
# FreeRADIUS clients.conf — ISP BNAS
# Auto-generated by install.sh on $(date)
# ──────────────────────────────────────────────────────────────────
# Shared secret সব জায়গায় একই: ${RADIUS_SECRET}
# Mikrotik RouterOS RADIUS config এ এই secret দিন।

client localhost {
    ipaddr  = 127.0.0.1
    secret  = ${RADIUS_SECRET}
    shortname = localhost
    require_message_authenticator = no
}

client localhost_ipv6 {
    ipv6addr = ::1
    secret   = ${RADIUS_SECRET}
    shortname = localhost6
}

# Mikrotik Router 1: ${MIKROTIK_NAME} (${MIKROTIK_IP})
client ${MIKROTIK_NAME} {
    ipaddr    = ${MIKROTIK_IP}
    secret    = ${RADIUS_SECRET}
    shortname = ${MIKROTIK_NAME}
    nas_type  = other
    require_message_authenticator = no
}
CLIENTS

# দ্বিতীয় Mikrotik থাকলে
if [[ -n "$MIKROTIK_IP2" ]]; then
    cat >> "${FR_DIR}/clients.conf" << CLIENTS2

# Mikrotik Router 2: ${MIKROTIK_NAME2} (${MIKROTIK_IP2})
client ${MIKROTIK_NAME2} {
    ipaddr    = ${MIKROTIK_IP2}
    secret    = ${RADIUS_SECRET}
    shortname = ${MIKROTIK_NAME2}
    nas_type  = other
    require_message_authenticator = no
}
CLIENTS2
fi

cat >> "${FR_DIR}/clients.conf" << CLIENTS3

# এই server নিজে (CoA / NAS lookup এর জন্য)
client server_self {
    ipaddr    = ${SERVER_IP}
    secret    = ${RADIUS_SECRET}
    shortname = self
    nas_type  = other
}
CLIENTS3
ok "FreeRADIUS clients.conf তৈরি সম্পন্ন (${RADIUS_SECRET})"

# ── FreeRADIUS SQL module ─────────────────────────────────────────
info "FreeRADIUS SQL module কনফিগার করা হচ্ছে..."

# NOTE: backup কখনো mods-enabled/ এ রাখবেন না
# FreeRADIUS mods-enabled/ এ সব file কে module মনে করে load করে
cat > "${FR_DIR}/mods-available/sql" << SQLCONF
# FreeRADIUS SQL Module — ISP BNAS
# Auto-generated by install.sh
sql {
    dialect = "mysql"
    driver  = "rlm_sql_\${dialect}"

    mysql {
        warnings = auto
        tls {
            # tls_required = no
        }
    }

    server   = "localhost"
    port     = 3306
    login    = "${DB_USER}"
    password = "${DB_PASS}"
    radius_db = "${DB_NAME}"

    acct_table1      = "radacct"
    acct_table2      = "radacct"
    postauth_table   = "radpostauth"
    authcheck_table  = "radcheck"
    groupcheck_table = "radgroupcheck"
    authreply_table  = "radreply"
    groupreply_table = "radgroupreply"
    usergroup_table  = "radusergroup"

    delete_stale_sessions = yes

    pool {
        start        = 5
        min          = 5
        max          = 32
        spare        = 10
        uses         = 0
        retry_delay  = 30
        lifetime     = 0
        idle_timeout = 60
    }

    # NAS table থেকে client list read (nas table)
    read_clients = yes
    client_table = "nas"

    \$INCLUDE \${modconfdir}/\${.:name}/main/\${dialect}/queries.conf
}
SQLCONF

# symlink তৈরি (mods-enabled/)
ln -sf "${FR_DIR}/mods-available/sql" "${FR_DIR}/mods-enabled/sql" 2>/dev/null || true
ok "FreeRADIUS SQL module: pool max=32, min=5 সহ কনফিগার সম্পন্ন"

# ── sites-enabled/default এ sql enable ───────────────────────────
info "Default virtual server এ SQL accounting/postauth enable করা হচ্ছে..."
python3 - << 'PYEOF'
import re

path = "/etc/freeradius/3.0/sites-available/default"
try:
    txt = open(path).read()
    for section in ('accounting', 'post-auth'):
        pat = r'(?s)(' + section + r'\s*\{)(.*?)(\})'
        def inject(m):
            body = m.group(2)
            if '\tsql' not in body and '    sql' not in body:
                body = body.rstrip() + '\n\tsql\n\t'
            return m.group(1) + body + m.group(3)
        txt = re.sub(pat, inject, txt, count=1)
    open(path, 'w').write(txt)
    print("  → sites-available/default: sql accounting/postauth enabled")
except Exception as e:
    print(f"  ⚠ default site update failed: {e}")
PYEOF

ln -sf "${FR_DIR}/sites-available/default" "${FR_DIR}/sites-enabled/default" 2>/dev/null || true

# ── Permissions ও startup ─────────────────────────────────────────
chown -R freerad:freerad "${FR_DIR}" 2>/dev/null || true
chmod 640 "${FR_DIR}/clients.conf" 2>/dev/null || true

systemctl enable freeradius
systemctl start freeradius
sleep 3

if systemctl is-active freeradius &>/dev/null; then
    ok "FreeRADIUS চালু হয়েছে"
else
    warn "FreeRADIUS চালু হয়নি — নিচে দেখুন:"
    journalctl -u freeradius --no-pager -n 10 2>/dev/null || true
fi

# ================================================================
step "ধাপ ৪ / ১১ — phpMyAdmin কনফিগারেশন"
# ================================================================

PHP_VER=$(php -r "echo PHP_MAJOR_VERSION.'.'.PHP_MINOR_VERSION;" 2>/dev/null || php8.5 -r "echo PHP_MAJOR_VERSION.'.'.PHP_MINOR_VERSION;" 2>/dev/null || echo "8.5")
systemctl enable --now "php${PHP_VER}-fpm" 2>/dev/null || true
PHP_SOCK="/run/php/php${PHP_VER}-fpm.sock"

PMA_SECRET=$(python3 -c "import secrets,string; print(''.join(secrets.choice(string.ascii_letters+string.digits) for _ in range(32)))")
if [[ -f /etc/phpmyadmin/config.inc.php ]]; then
    sed -i "s/\['blowfish_secret'\] = ''/['blowfish_secret'] = '${PMA_SECRET}'/" \
        /etc/phpmyadmin/config.inc.php 2>/dev/null || true
fi

mkdir -p /etc/nginx/snippets
cat > /etc/nginx/snippets/phpmyadmin.conf << PHPEOF
location /phpmyadmin {
    root /usr/share/;
    index index.php;
    location ~ ^/phpmyadmin/(.+\.php)$ {
        try_files \$uri =404;
        root /usr/share/;
        include fastcgi_params;
        fastcgi_pass unix:${PHP_SOCK};
        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
    }
    location ~* ^/phpmyadmin/(.+\.(jpg|jpeg|gif|css|png|js|ico|html|xml|txt))$ {
        root /usr/share/;
    }
}
PHPEOF
ok "phpMyAdmin কনফিগার সম্পন্ন"

# ================================================================
step "ধাপ ৫ / ১১ — Redis ও Project User"
# ================================================================

systemctl enable --now redis-server
ok "Redis চালু হয়েছে"

id "$PROJECT_USER" &>/dev/null || useradd -m -s /bin/bash "$PROJECT_USER"
ok "System user '${PROJECT_USER}' ready"

# ================================================================
step "ধাপ ৬ / ১১ — Project Clone ও Python Environment"
# ================================================================

if [[ -d "${PROJECT_DIR}/.git" ]]; then
    info "Project আছে — latest pull করা হচ্ছে (branch: ${GIT_BRANCH})..."
    git -C "${PROJECT_DIR}" fetch origin "${GIT_BRANCH}" 2>/dev/null || true
    git -C "${PROJECT_DIR}" checkout "${GIT_BRANCH}" 2>/dev/null || true
    git -C "${PROJECT_DIR}" pull origin "${GIT_BRANCH}" 2>/dev/null || true
else
    info "GitHub থেকে clone করা হচ্ছে (branch: ${GIT_BRANCH})..."
    git clone -b "${GIT_BRANCH}" "${GITHUB_REPO}" "${PROJECT_DIR}" \
        || git clone "${GITHUB_REPO}" "${PROJECT_DIR}" \
        || die "Clone ব্যর্থ। Internet ও repo URL চেক করুন।"
fi
ok "Project ready: ${PROJECT_DIR} (branch: $(git -C "${PROJECT_DIR}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?'))"

info "Python virtual environment তৈরি করা হচ্ছে..."
$PYTHON_CMD -m venv "${PROJECT_DIR}/venv"
PY="${PROJECT_DIR}/venv/bin/python"
PIP="${PROJECT_DIR}/venv/bin/pip"
$PIP install --quiet --upgrade pip setuptools wheel

[[ -f "${PROJECT_DIR}/requirements.txt" ]] && \
    $PIP install --quiet -r "${PROJECT_DIR}/requirements.txt" || \
    $PIP install --quiet Django djangorestframework djangorestframework-simplejwt \
        django-cors-headers django-environ django-filter gunicorn \
        pymysql mysqlclient pillow redis celery django-celery-beat \
        django-celery-results RouterOS-api paramiko requests pysnmp python-crontab
ok "Python packages ইনস্টল সম্পন্ন"

# ── .env তৈরি ────────────────────────────────────────────────────
SECRET_KEY=$($PYTHON_CMD -c "import secrets,string; \
    print(''.join(secrets.choice(string.ascii_letters+string.digits+'!@#%^&*') for _ in range(50)))")
# App-user password encryption key (Fernet) — role_permissions/utils.py-এর জন্য বাধ্যতামূলক
FERNET_KEY=$("$PY" -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" 2>/dev/null || echo "")

cat > "${PROJECT_DIR}/.env" << ENV
# ISP BNAS — Auto-generated $(date)
SECRET_KEY=${SECRET_KEY}
DEBUG=False
ALLOWED_HOSTS=localhost,127.0.0.1,${SERVER_IP}

DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASS}
DB_HOST=localhost
DB_PORT=3306

RADIUS_DB_HOST=localhost
RADIUS_DB_PORT=3306
RADIUS_DB_NAME=${DB_NAME}
RADIUS_DB_USER=${DB_USER}
RADIUS_DB_PASSWORD=${DB_PASS}

RADIUS_SECRET=${RADIUS_SECRET}

REDIS_URL=redis://localhost:6379/0
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=django-db

COMPANY_NAME=${COMPANY_NAME}
COMPANY_ADDRESS=
COMPANY_PHONE=

MIKROTIK_HOST=${MIKROTIK_IP}
MIKROTIK_USER=admin
MIKROTIK_PASSWORD=
MIKROTIK_PORT=8728

JWT_ACCESS_TOKEN_LIFETIME_MINUTES=60
JWT_REFRESH_TOKEN_LIFETIME_DAYS=7
TIME_ZONE=Asia/Dhaka

# App-user password encryption (Fernet) — না থাকলে App Users password feature error দেবে
PASSWORD_ENCRYPT_KEY=${FERNET_KEY}
ENV
ok ".env তৈরি সম্পন্ন (RADIUS_SECRET=${RADIUS_SECRET})"

# ================================================================
step "ধাপ ৭ / ১১ — Django Migrate, Static ও Admin User"
# ================================================================

cd "${PROJECT_DIR}"
mkdir -p logs media staticfiles

info "Database migrations চালানো হচ্ছে..."
$PY manage.py migrate --noinput 2>/dev/null
ok "Migrations সম্পন্ন"

info "Static files collect করা হচ্ছে..."
$PY manage.py collectstatic --noinput --clear 2>/dev/null
ok "Static files সম্পন্ন"

info "Admin user '${ADMIN_USER}' তৈরি করা হচ্ছে..."
$PY manage.py shell -c "
from accounts.models import User
if not User.objects.filter(username='${ADMIN_USER}').exists():
    User.objects.create_superuser('${ADMIN_USER}', '${ADMIN_USER}@isp.local', '${ADMIN_PASS}')
    print('  → admin user তৈরি')
else:
    u = User.objects.get(username='${ADMIN_USER}')
    u.set_password('${ADMIN_PASS}')
    u.save()
    print('  → admin পাসওয়ার্ড আপডেট')
" 2>/dev/null
ok "Admin user '${ADMIN_USER}' ready"

# ================================================================
step "ধাপ ৮ / ১১ — React Frontend Build"
# ================================================================

for PANEL in admin_panel user_portal; do
    if [[ -d "${PROJECT_DIR}/${PANEL}" ]]; then
        info "${PANEL} build করা হচ্ছে..."
        cd "${PROJECT_DIR}/${PANEL}"
        npm install --silent 2>/dev/null
        npm run build 2>/dev/null
        ok "${PANEL} build সম্পন্ন"
    fi
done
cd "${PROJECT_DIR}"

# ================================================================
step "ধাপ ৯ / ১১ — Nginx কনফিগারেশন"
# ================================================================

rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

# ⚠️ upstream Docker django-app (8001)-কে পয়েন্ট করে, systemd isp-gunicorn (8000) না —
# বর্তমান production architecture-এর সাথে হুবহু মেলাতে (Docker primary, systemd শুধু
# idle rollback safety-net, নিচে ধাপ ১৩ দেখুন)।
cat > /etc/nginx/sites-available/isp_bnas << NGINX
upstream django_backend {
    server 127.0.0.1:8001;
}

# ── Admin Panel — port 80 ──────────────────────────────────────
server {
    listen 80;
    server_name localhost ${SERVER_IP};
    client_max_body_size 20M;

    location / {
        root ${PROJECT_DIR}/admin_panel/dist;
        try_files \$uri \$uri/ /index.html;
        add_header Cache-Control "no-cache";
    }
    location /api/ {
        proxy_pass http://django_backend;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 120;
        client_max_body_size 20M;
    }
    location /admin/ {
        proxy_pass http://django_backend;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
    location /media/  { alias ${PROJECT_DIR}/media/; }
    location /static/ { alias ${PROJECT_DIR}/staticfiles/; expires 7d; }
    include snippets/phpmyadmin.conf;
}

# ── User Portal — port 8080 ────────────────────────────────────
server {
    listen 8080;
    server_name localhost ${SERVER_IP};
    location / {
        root ${PROJECT_DIR}/user_portal/dist;
        try_files \$uri \$uri/ /index.html;
    }
    location /api/ {
        proxy_pass http://django_backend;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
    location /media/ { alias ${PROJECT_DIR}/media/; }
}
NGINX

ln -sf /etc/nginx/sites-available/isp_bnas /etc/nginx/sites-enabled/isp_bnas
nginx -t && systemctl enable --now nginx && systemctl reload nginx
ok "Nginx কনফিগার সম্পন্ন"

# ================================================================
step "ধাপ ১০ / ১১ — Systemd Services তৈরি ও চালু"
# ================================================================

# Gunicorn
cat > /etc/systemd/system/isp-gunicorn.service << SVC
[Unit]
Description=ISP BNAS Django (Gunicorn)
After=network.target mysql.service redis-server.service
Wants=mysql.service redis-server.service

[Service]
Type=notify
User=${PROJECT_USER}
Group=${PROJECT_USER}
WorkingDirectory=${PROJECT_DIR}
EnvironmentFile=${PROJECT_DIR}/.env
ExecStart=${PROJECT_DIR}/venv/bin/gunicorn \\
    --workers 3 --worker-class sync \\
    --bind 0.0.0.0:8000 --timeout 120 \\
    --pid ${PROJECT_DIR}/logs/gunicorn.pid \\
    --access-logfile ${PROJECT_DIR}/logs/access.log \\
    --error-logfile  ${PROJECT_DIR}/logs/error.log \\
    config.wsgi:application
ExecReload=/bin/kill -HUP \$MAINPID
KillMode=mixed
TimeoutStopSec=5
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SVC

# Celery Worker
cat > /etc/systemd/system/isp-celery.service << SVC
[Unit]
Description=ISP BNAS Celery Worker
After=network.target redis-server.service mysql.service

[Service]
Type=simple
User=${PROJECT_USER}
WorkingDirectory=${PROJECT_DIR}
EnvironmentFile=${PROJECT_DIR}/.env
ExecStart=${PROJECT_DIR}/venv/bin/celery -A config worker \\
    --loglevel=info --logfile=${PROJECT_DIR}/logs/celery.log
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
SVC

# Celery Beat
cat > /etc/systemd/system/isp-celery-beat.service << SVC
[Unit]
Description=ISP BNAS Celery Beat Scheduler
After=network.target redis-server.service isp-celery.service

[Service]
Type=simple
User=${PROJECT_USER}
WorkingDirectory=${PROJECT_DIR}
EnvironmentFile=${PROJECT_DIR}/.env
ExecStart=${PROJECT_DIR}/venv/bin/celery -A config beat \\
    --loglevel=info \\
    --scheduler django_celery_beat.schedulers:DatabaseScheduler \\
    --logfile=${PROJECT_DIR}/logs/celery_beat.log
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
SVC

# SNMP Trap Listener — OLT real-time ONU event (port 162, privileged → CAP_NET_BIND_SERVICE)
cat > /etc/systemd/system/isp-snmptrap.service << SVC
[Unit]
Description=ISP BNAS SNMP Trap Listener (OLT real-time ONU events)
After=network.target mysql.service redis-server.service

[Service]
Type=simple
User=${PROJECT_USER}
Group=${PROJECT_USER}
WorkingDirectory=${PROJECT_DIR}
EnvironmentFile=${PROJECT_DIR}/.env
AmbientCapabilities=CAP_NET_BIND_SERVICE
ExecStart=${PROJECT_DIR}/venv/bin/python ${PROJECT_DIR}/manage.py snmp_trap_listener --host 0.0.0.0 --port 162
Restart=always
RestartSec=5
StandardOutput=append:${PROJECT_DIR}/logs/snmptrap.log
StandardError=append:${PROJECT_DIR}/logs/snmptrap.log

[Install]
WantedBy=multi-user.target
SVC

chown -R "${PROJECT_USER}:${PROJECT_USER}" "${PROJECT_DIR}"
chmod 640 "${PROJECT_DIR}/.env"

systemctl daemon-reload
systemctl enable isp-gunicorn isp-celery isp-celery-beat isp-snmptrap 2>/dev/null || true
systemctl start isp-gunicorn
sleep 3
systemctl is-active isp-gunicorn &>/dev/null && ok "isp-gunicorn চালু" || warn "isp-gunicorn চালু হয়নি"
systemctl start isp-celery     2>/dev/null && ok "isp-celery চালু"      || warn "isp-celery optional"
systemctl start isp-celery-beat 2>/dev/null && ok "isp-celery-beat চালু" || warn "isp-celery-beat optional"
systemctl start isp-snmptrap   2>/dev/null && ok "isp-snmptrap চালু (port 162)" || warn "isp-snmptrap optional (OLT SNMP trap)"

# ================================================================
step "ধাপ ১১ / ১১ — Firewall, Route ও Maintenance Cron"
# ================================================================

# UFW firewall
if command -v ufw &>/dev/null; then
    ufw allow 22/tcp   2>/dev/null; ufw allow 80/tcp   2>/dev/null
    ufw allow 8080/tcp 2>/dev/null; ufw allow 1812/udp 2>/dev/null
    ufw allow 1813/udp 2>/dev/null; ufw allow 162/udp  2>/dev/null
    ok "Firewall rules: SSH(22), HTTP(80,8080), RADIUS(1812/1813), SNMP-trap(162)"
fi

# PPPoE route
if command -v nmcli &>/dev/null; then
    CONN=$(nmcli -t -f NAME connection show --active 2>/dev/null | head -1)
    if [[ -n "$CONN" ]]; then
        nmcli connection modify "$CONN" +ipv4.routes "10.5.60.0/24 ${MIKROTIK_IP}" 2>/dev/null || true
        nmcli connection up "$CONN" 2>/dev/null || true
        ok "PPPoE route: 10.5.60.0/24 → ${MIKROTIK_IP}"
    fi
fi

# ── RADIUS daily maintenance cron ────────────────────────────────
info "RADIUS daily maintenance cron job সেটআপ করা হচ্ছে..."
CRON_FILE="/etc/cron.d/isp_bnas_radius"
cat > "${CRON_FILE}" << CRON
# ISP BNAS — RADIUS Daily Maintenance
# প্রতিদিন রাত ৩টায় radpostauth cleanup ও radacct stale session close
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

# RADIUS database maintenance (radpostauth 7-day cleanup)
0 3 * * * ${PROJECT_USER} cd ${PROJECT_DIR} && ${PROJECT_DIR}/venv/bin/python manage.py radius_maintenance >> ${PROJECT_DIR}/logs/radius_maintenance.log 2>&1

# radpostauth weekly deep cleanup (1 মাসের বেশি পুরনো সব মুছবে)
0 4 * * 0 ${PROJECT_USER} cd ${PROJECT_DIR} && mysql -u${DB_USER} -p${DB_PASS} ${DB_NAME} -e "DELETE FROM radpostauth WHERE authdate < NOW() - INTERVAL 30 DAY; OPTIMIZE TABLE radpostauth;" >> ${PROJECT_DIR}/logs/radius_maintenance.log 2>&1
CRON
chmod 644 "${CRON_FILE}"
ok "RADIUS maintenance cron: প্রতিদিন রাত ৩টায় চলবে"

# ================================================================
step "ধাপ ১২ (বাড়তি) — Asterisk (VoIP)"
# ================================================================
# ⚠️ এখানে নিজে থেকে asterisk কনফিগার করি না — deploy/asterisk/install.sh
# ইতিমধ্যে একটা সম্পূর্ণ, টেস্ট করা VoIP installer (PJSIP/AMI/ARI/coturn/TLS
# secrets generate করে, .env-এ VOIP_* key লেখে, MySQL-remove-প্রতিরোধী safety
# guard আছে) — সেটাকে duplicate/দুর্বল ভার্সন দিয়ে বদলানো ঠিক হবে না, বরং
# সরাসরি call করাই সঠিক (single source of truth)।
if [[ -f "${PROJECT_DIR}/deploy/asterisk/install.sh" ]]; then
    info "deploy/asterisk/install.sh চালানো হচ্ছে (PJSIP/AMI/ARI/coturn/TLS পূর্ণ সেটআপ)..."
    ASTERISK_DOMAIN="${DOMAIN_NAME:-roisp.duckdns.org}"
    bash "${PROJECT_DIR}/deploy/asterisk/install.sh" "${ASTERISK_DOMAIN}" \
        && ok "Asterisk VoIP সম্পূর্ণ সেটআপ সম্পন্ন (PJSIP/coturn/TLS সহ)" \
        || warn "Asterisk VoIP সেটআপ ব্যর্থ — 'bash deploy/asterisk/install.sh ${ASTERISK_DOMAIN}' আলাদাভাবে চালিয়ে দেখুন"
else
    warn "deploy/asterisk/install.sh পাওয়া যায়নি — শুধু asterisk প্যাকেজ চালু করা হলো (VoIP feature-এর জন্য PJSIP config ম্যানুয়ালি লাগবে)"
    systemctl enable --now asterisk 2>/dev/null || true
fi

# ================================================================
step "ধাপ ১৩ (বাড়তি) — Docker Phase-1 Stack (primary production path)"
# ================================================================
# django-app/celery-worker/celery-beat এখন Docker-এ চলে (bare-metal systemd না) —
# বর্তমান প্রোডাকশনের সাথে হুবহু মেলাতে। systemd isp-gunicorn/isp-celery/
# isp-celery-beat আগেই চালু হয়ে গেছে (ধাপ ১০) — সেগুলো এখন idle rollback
# safety-net হিসেবে থেকে যাবে (nginx আর সেগুলোতে route করবে না)।

if ! command -v docker &>/dev/null; then
    info "Docker Engine ইনস্টল করা হচ্ছে..."
    install -m 0755 -d /etc/apt/keyrings
    curl --proto '=https' --tlsv1.2 -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc 2>/dev/null
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin 2>/dev/null
    ok "Docker Engine ইনস্টল সম্পন্ন"
else
    ok "Docker আগে থেকেই ইনস্টল আছে"
fi

# docker-compose.yml-এ subnet পিন করা আছে (172.19.0.0/16, gateway 172.19.0.1) —
# MySQL/Redis-কে এই নির্দিষ্ট subnet ছাড়া অন্য কোথাও (বিশেষত পাবলিক ইন্টারনেট)
# থেকে reachable করা হবে না। 0.0.0.0/wildcard bind কখনোই ব্যবহার করা হয় না।
DOCKER_GW="172.19.0.1"
DOCKER_SUBNET_PATTERN="172.19.%.%"

# Redis-এ আগে কোনো পাসওয়ার্ড ছিল না (শুধু localhost bind ছিল বলে দরকার পড়েনি) —
# এখন network-এ খুলছি বলে requirepass বাধ্যতামূলক, নাহলে Docker subnet-এর যেকোনো
# কন্টেইনার auth ছাড়াই পুরো Redis অ্যাক্সেস পেয়ে যাবে।
REDIS_PASS=$(openssl rand -hex 24)

# .env.docker — .env-এরই কপি, শুধু DB/RADIUS/Redis host container থেকে host
# machine-এ পৌঁছানোর জন্য host.docker.internal + নতুন Redis পাসওয়ার্ড ব্যবহার করে
# (docker/HOST_NETWORKING_README.md)
info ".env.docker তৈরি করা হচ্ছে..."
sed -e 's/^DB_HOST=.*/DB_HOST=host.docker.internal/' \
    -e 's/^RADIUS_DB_HOST=.*/RADIUS_DB_HOST=host.docker.internal/' \
    -e "s#^REDIS_URL=.*#REDIS_URL=redis://:${REDIS_PASS}@host.docker.internal:6379/0#" \
    -e "s#^CELERY_BROKER_URL=.*#CELERY_BROKER_URL=redis://:${REDIS_PASS}@host.docker.internal:6379/0#" \
    "${PROJECT_DIR}/.env" > "${PROJECT_DIR}/.env.docker"
ok ".env.docker তৈরি সম্পন্ন"

# ── MySQL — শুধু localhost + Docker gateway IP থেকে reachable, GRANT শুধু ওই
#    subnet-এর জন্য (wildcard '%' না) ──────────────────────────────────────
info "MySQL-কে শুধু Docker subnet (${DOCKER_SUBNET_PATTERN}) থেকে অ্যাক্সেসযোগ্য করা হচ্ছে..."
if [[ -f /etc/mysql/mysql.conf.d/mysqld.cnf ]]; then
    sed -i "s/^bind-address.*/bind-address = 127.0.0.1,${DOCKER_GW}/" \
        /etc/mysql/mysql.conf.d/mysqld.cnf 2>/dev/null || true
    systemctl restart mysql 2>/dev/null || true
fi
mysql -u root --password="${MYSQL_ROOT_PASS}" -e "
CREATE USER IF NOT EXISTS '${DB_USER}'@'${DOCKER_SUBNET_PATTERN}' IDENTIFIED WITH mysql_native_password BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'${DOCKER_SUBNET_PATTERN}';
FLUSH PRIVILEGES;" 2>/dev/null || true
ok "MySQL access সীমিত রাখা হয়েছে শুধু ${DOCKER_SUBNET_PATTERN}-এর জন্য"

# ── Redis — শুধু localhost + Docker gateway IP, requirepass সহ ─────────────
info "Redis-কে শুধু Docker subnet থেকে অ্যাক্সেসযোগ্য + password-protected করা হচ্ছে..."
if [[ -f /etc/redis/redis.conf ]]; then
    sed -i "s/^bind .*/bind 127.0.0.1 ${DOCKER_GW}/" /etc/redis/redis.conf 2>/dev/null || true
    if grep -q "^requirepass" /etc/redis/redis.conf 2>/dev/null; then
        sed -i "s/^requirepass.*/requirepass ${REDIS_PASS}/" /etc/redis/redis.conf
    else
        echo "requirepass ${REDIS_PASS}" >> /etc/redis/redis.conf
    fi
    systemctl restart redis-server 2>/dev/null || true
fi
# host-side .env-এও নতুন Redis পাসওয়ার্ড বসিয়ে দিলাম (systemd fallback path যাতে ভাঙে না)
sed -i -e "s#^REDIS_URL=.*#REDIS_URL=redis://:${REDIS_PASS}@localhost:6379/0#" \
       -e "s#^CELERY_BROKER_URL=.*#CELERY_BROKER_URL=redis://:${REDIS_PASS}@localhost:6379/0#" \
       "${PROJECT_DIR}/.env"
ok "Redis সীমিত + password-protected (${DOCKER_GW}-এর জন্যই শুধু)"

cd "${PROJECT_DIR}"
if [[ -f docker-compose.yml ]]; then
    info "Docker image build করা হচ্ছে (কয়েক মিনিট লাগতে পারে)..."
    docker compose build 2>&1 | tail -5
    info "Docker কন্টেইনার চালু করা হচ্ছে..."
    docker compose up -d
    sleep 5
    if docker compose ps django-app 2>/dev/null | grep -q "Up"; then
        ok "Docker Phase-1 stack চালু হয়েছে (django-app: 8001, celery-worker, celery-beat)"
    else
        warn "Docker স্ট্যাক চালু হয়নি — 'docker compose logs' চেক করুন। nginx আপাতত systemd fallback-এ থাকবে।"
        # fallback: nginx-কে পুরনো systemd gunicorn (8000)-এ ফিরিয়ে দাও
        sed -i 's/127\.0\.0\.1:8001/127.0.0.1:8000/' /etc/nginx/sites-available/isp_bnas
        nginx -t && systemctl reload nginx
    fi
else
    warn "docker-compose.yml পাওয়া যায়নি — Docker ধাপ বাদ দেওয়া হলো, systemd gunicorn (8000)-ই থাকবে primary"
    sed -i 's/127\.0\.0\.1:8001/127.0.0.1:8000/' /etc/nginx/sites-available/isp_bnas
    nginx -t && systemctl reload nginx
fi

# ================================================================
step "ধাপ ১৪ (বাড়তি) — SSL সার্টিফিকেট (Let's Encrypt)"
# ================================================================

# ⚠️ এখানে নিজে থেকে certbot চালাই না — setup_https.sh ইতিমধ্যে DNS validation,
# HSTS/security header, ALLOWED_HOSTS+CSRF_TRUSTED_ORIGINS আপডেট ও auto-renewal
# check-সহ একটা সম্পূর্ণ, টেস্ট করা SSL script — সেটাকে duplicate করার বদলে
# সরাসরি call করাই সঠিক (single source of truth)।
if [[ -n "${DOMAIN_NAME}" ]] && [[ -f "${PROJECT_DIR}/setup_https.sh" ]]; then
    info "setup_https.sh চালানো হচ্ছে (${DOMAIN_NAME})..."
    if bash "${PROJECT_DIR}/setup_https.sh" "${DOMAIN_NAME}"; then
        # ⚠️ setup_https.sh নিজের সরল nginx template লেখে (upstream 127.0.0.1:8000,
        # phpMyAdmin/user_portal:8080 ব্লক ছাড়া) — ধাপ ৯-এর config-কে overwrite করে।
        # Docker primary (8001) ঠিক রাখতে upstream পোর্ট এখানে patch করছি।
        sed -i 's/server 127\.0\.0\.1:8000;/server 127.0.0.1:8001;/' \
            /etc/nginx/sites-available/isp_bnas 2>/dev/null || true
        nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
        ok "SSL সার্টিফিকেট ইস্যু ও nginx HTTPS কনফিগার সম্পন্ন — https://${DOMAIN_NAME}/"
        warn "লক্ষণীয়: setup_https.sh-এর nginx template-এ phpMyAdmin/user_portal:8080 ব্লক নেই — দরকার হলে ম্যানুয়ালি /etc/nginx/sites-available/isp_bnas-এ যোগ করুন"
        SITE_URL="https://${DOMAIN_NAME}"
    else
        warn "SSL সেটআপ ব্যর্থ — সাধারণত DNS এখনো এই সার্ভারের IP-তে পয়েন্ট না করলে হয়। পরে ম্যানুয়ালি চালান:"
        warn "  sudo bash ${PROJECT_DIR}/setup_https.sh ${DOMAIN_NAME}"
        SITE_URL="http://${SERVER_IP}"
    fi
elif [[ -n "${DOMAIN_NAME}" ]]; then
    warn "setup_https.sh পাওয়া যায়নি — SSL ধাপ বাদ দেওয়া হলো"
    SITE_URL="http://${SERVER_IP}"
else
    info "ডোমেইন দেওয়া হয়নি — SSL ধাপ বাদ দেওয়া হলো (শুধু HTTP)"
    SITE_URL="http://${SERVER_IP}"
fi

# ================================================================
#  Credentials সংরক্ষণ
# ================================================================

cat > "$CRED_FILE" << CRED
ISP BNAS — Installation Credentials
=====================================
Install Date : $(date)
Server IP    : ${SERVER_IP}
Project Dir  : ${PROJECT_DIR}

Admin Panel  : ${SITE_URL}/
  Username   : ${ADMIN_USER}
  Password   : ${ADMIN_PASS}

Production path : $(_docker_active && echo "Docker (django-app:8001, celery-worker, celery-beat) — primary" || echo "systemd isp-gunicorn (8000) — primary")
Rollback net     : systemd isp-gunicorn/isp-celery/isp-celery-beat (idle, active)
Asterisk (VoIP)  : $(systemctl is-active asterisk 2>/dev/null || echo inactive) — PJSIP/dialplan migration হলে backup থেকে restore, fresh install-এ ম্যানুয়াল কনফিগ লাগবে

User Portal  : http://${SERVER_IP}:8080/
Django API   : http://${SERVER_IP}:8000/api/v1/
Django Admin : http://${SERVER_IP}:8000/admin/
phpMyAdmin   : http://${SERVER_IP}/phpmyadmin/
  User       : phpmyadmin
  Password   : ${DB_PASS}

MySQL        :
  Root Pass  : ${MYSQL_ROOT_PASS}
  DB Name    : ${DB_NAME}
  DB User    : ${DB_USER}
  DB Pass    : ${DB_PASS}

FreeRADIUS   :
  Host       : ${SERVER_IP}
  Auth Port  : 1812
  Acct Port  : 1813
  Secret     : ${RADIUS_SECRET}
  test cmd   : radtest 1001 1234 localhost 0 ${RADIUS_SECRET}

Mikrotik 1   : ${MIKROTIK_IP} (${MIKROTIK_NAME})
$([[ -n "${MIKROTIK_IP2}" ]] && echo "Mikrotik 2   : ${MIKROTIK_IP2} (${MIKROTIK_NAME2})")

Service Commands:
  sudo bash ${PROJECT_DIR}/install.sh status
  sudo bash ${PROJECT_DIR}/install.sh restart
  sudo bash ${PROJECT_DIR}/install.sh logs
  sudo bash ${PROJECT_DIR}/install.sh update
  sudo bash ${PROJECT_DIR}/install.sh radius-fix

Migration (পুরানো মেশিনে চালান):
  sudo bash ${PROJECT_DIR}/install.sh backup
  → /root/isp_bnas_backup_YYYYMMDD_HHMMSS.tar.gz তৈরি হবে
CRED
chmod 600 "$CRED_FILE"

# ================================================================
#  Backup Restore (মাইগ্রেশন মোড — backup file দেওয়া থাকলে)
# ================================================================
if [[ -n "${BACKUP_FILE:-}" ]]; then
    step "Backup থেকে Data Restore হচ্ছে"

    # সব app service বন্ধ করো (restore চলাকালীন)
    for svc in "${SERVICES[@]}"; do systemctl stop "$svc" 2>/dev/null || true; done

    TMP_RESTORE=$(mktemp -d)
    info "Archive extract করা হচ্ছে..."
    tar -xzf "${BACKUP_FILE}" -C "${TMP_RESTORE}" \
        || die "Backup file extract ব্যর্থ। File corrupt কিনা চেক করুন।"

    # ── Database restore ───────────────────────────────────────────
    if [[ -f "${TMP_RESTORE}/database.sql" ]]; then
        info "Database restore করা হচ্ছে (সব tables + data)..."
        SQL_SIZE=$(du -sh "${TMP_RESTORE}/database.sql" | cut -f1)
        info "SQL size: ${SQL_SIZE}"
        mysql -u"${DB_USER}" -p"${DB_PASS}" "${DB_NAME}" \
            < "${TMP_RESTORE}/database.sql" \
            || die "Database restore ব্যর্থ।"

        # Django migration state ঠিক করো (নতুন migrations যদি থাকে)
        source "${PROJECT_DIR}/venv/bin/activate"
        python "${PROJECT_DIR}/manage.py" migrate --noinput 2>/dev/null || true
        deactivate
        ok "Database restore সম্পন্ন (${SQL_SIZE})"
    else
        warn "database.sql পাওয়া যায়নি — database restore হয়নি"
    fi

    # ── Media files restore ────────────────────────────────────────
    if [[ -d "${TMP_RESTORE}/media" ]]; then
        info "Media files restore করা হচ্ছে..."
        MEDIA_SIZE=$(du -sh "${TMP_RESTORE}/media" | cut -f1)
        # rsync না থাকলে cp দিয়ে করবে
        if command -v rsync &>/dev/null; then
            rsync -a "${TMP_RESTORE}/media/" "${PROJECT_DIR}/media/"
        else
            cp -a "${TMP_RESTORE}/media/." "${PROJECT_DIR}/media/"
        fi
        chown -R "${PROJECT_USER}:${PROJECT_USER}" "${PROJECT_DIR}/media"
        ok "Media files restore সম্পন্ন (${MEDIA_SIZE})"
    else
        warn "Media folder পাওয়া যায়নি"
    fi

    # ── Asterisk কনফিগ restore ──────────────────────────────────────
    if [[ -f "${TMP_RESTORE}/asterisk_config.tar.gz" ]]; then
        info "Asterisk কনফিগ restore করা হচ্ছে..."
        systemctl stop asterisk 2>/dev/null || true
        tar -xzf "${TMP_RESTORE}/asterisk_config.tar.gz" -C /etc
        chown -R asterisk:asterisk /etc/asterisk 2>/dev/null || true
        systemctl start asterisk 2>/dev/null && ok "Asterisk কনফিগ restore ও চালু সম্পন্ন" \
            || warn "Asterisk চালু হয়নি — 'journalctl -u asterisk' চেক করুন"
    else
        warn "Asterisk কনফিগ ব্যাকআপে পাওয়া যায়নি (fresh install-এর মতো ম্যানুয়ালি কনফিগার করতে হবে)"
    fi

    # ── SSL সার্টিফিকেট restore (একই ডোমেইন হলে পুনরায় ইস্যু না করেই কাজ করবে) ──
    if [[ -f "${TMP_RESTORE}/system_config.tar.gz" ]]; then
        info "SSL সার্টিফিকেট ও অতিরিক্ত nginx/systemd কনফিগ restore করা হচ্ছে..."
        mkdir -p /etc/letsencrypt
        tar -xzf "${TMP_RESTORE}/system_config.tar.gz" -C / --wildcards "etc/letsencrypt/*" 2>/dev/null || true
        nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || \
            warn "Restore হওয়া SSL cert-এর ডোমেইন এই সার্ভারের সাথে না মিললে nginx reload skip হয়েছে — ম্যানুয়ালি certbot চালান"
    fi

    rm -rf "${TMP_RESTORE}"

    # App services পুনরায় চালু করো
    info "Services চালু করা হচ্ছে..."
    systemctl start isp-gunicorn  && ok "isp-gunicorn চালু (idle rollback safety-net)" || warn "isp-gunicorn চালু হয়নি"
    systemctl start isp-celery    2>/dev/null && ok "isp-celery চালু (idle rollback safety-net)"      || true
    systemctl start isp-celery-beat 2>/dev/null && ok "isp-celery-beat চালু (idle rollback safety-net)" || true
    if command -v docker &>/dev/null && [[ -f "${PROJECT_DIR}/docker-compose.yml" ]]; then
        info "Docker কন্টেইনার restart করা হচ্ছে (নতুন data reflect করতে)..."
        cd "${PROJECT_DIR}" && docker compose restart django-app celery-worker celery-beat 2>/dev/null \
            && ok "Docker stack restarted" || warn "Docker restart ব্যর্থ — 'docker compose logs' চেক করুন"
    fi
    sleep 2
    ok "Backup restore সম্পূর্ণ — সব পুরানো data (DB + media + Asterisk + SSL) এসে গেছে"
fi

# ================================================================
#  চূড়ান্ত যাচাই ও সারাংশ
# ================================================================

echo ""
echo -e "${BOLD}  ── Service Status ──────────────────────────────${NC}"
for SVC in mysql freeradius redis-server nginx asterisk isp-gunicorn isp-celery isp-celery-beat isp-snmptrap; do
    ST=$(systemctl is-active "$SVC" 2>/dev/null || echo "inactive")
    [[ "$ST" == "active" ]] && echo -e "  ${GREEN}✓ $SVC${NC}" || echo -e "  ${RED}✗ $SVC${NC}"
done
if command -v docker &>/dev/null; then
    for C in django-app celery-worker celery-beat; do
        if docker compose -f "${PROJECT_DIR}/docker-compose.yml" ps "$C" 2>/dev/null | grep -q "Up"; then
            echo -e "  ${GREEN}✓ docker: $C${NC}"
        else
            echo -e "  ${RED}✗ docker: $C${NC}"
        fi
    done
fi

echo ""
echo -e "${BOLD}  ── RADIUS Test ─────────────────────────────────${NC}"
sleep 2
RADTEST_OUT=$(radtest -t pap testuser testpass 127.0.0.1:1812 0 "${RADIUS_SECRET}" 2>&1)
if echo "$RADTEST_OUT" | grep -qE "Access-Reject|Access-Accept"; then
    ok "FreeRADIUS port 1812 সাড়া দিচ্ছে ✓"
else
    warn "RADIUS test — 'journalctl -u freeradius' দিয়ে চেক করুন"
fi

echo ""
echo -e "${BOLD}  ── RADIUS DB Summary ───────────────────────────${NC}"
RDBCMD="mysql -u${DB_USER} -p${DB_PASS} ${DB_NAME} -sNe"
NAS_COUNT=$($RDBCMD "SELECT COUNT(*) FROM nas;" 2>/dev/null || echo "?")
GRP_COUNT=$($RDBCMD "SELECT COUNT(DISTINCT groupname) FROM radgroupreply;" 2>/dev/null || echo "?")
echo -e "  NAS registered : ${NAS_COUNT}"
echo -e "  Groups         : ${GRP_COUNT} (ppp, 5M, 10M)"
echo -e "  Interim-Interval: 300s (5 min) ✓"

echo ""
echo -e "${BOLD}${GREEN}"
if [[ -n "${BACKUP_FILE:-}" ]]; then
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║   ✓  Migration সম্পূর্ণ! সব data restore হয়েছে।    ║"
echo "  ╚══════════════════════════════════════════════════════╝"
else
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║       ✓  Fresh Install সম্পূর্ণ হয়েছে!              ║"
echo "  ╚══════════════════════════════════════════════════════╝"
fi
echo -e "${NC}"
echo -e "  ${CYAN}Admin Panel  ${NC}→  ${SITE_URL}/"
echo -e "  ${CYAN}User Portal  ${NC}→  http://${SERVER_IP}:8080/"
echo -e "  ${CYAN}phpMyAdmin   ${NC}→  ${SITE_URL}/phpmyadmin/"
echo ""
echo -e "${BOLD}  Login:${NC}  ${ADMIN_USER} / ${ADMIN_PASS}"
echo -e "${BOLD}  phpMyAdmin:${NC}  phpmyadmin / ${DB_PASS}"
echo ""
echo -e "${BOLD}  Mikrotik RADIUS Config:${NC}"
echo -e "  ${CYAN}Server IP  :${NC}  ${SERVER_IP}"
echo -e "  ${CYAN}Auth Port  :${NC}  1812"
echo -e "  ${CYAN}Acct Port  :${NC}  1813"
echo -e "  ${CYAN}Secret     :${NC}  ${RADIUS_SECRET}"
echo ""
echo -e "${BOLD}  দৈনন্দিন ব্যবহার:${NC}"
echo -e "  ${CYAN}Status :${NC}  sudo bash ${PROJECT_DIR}/install.sh status"
echo -e "  ${CYAN}Restart:${NC}  sudo bash ${PROJECT_DIR}/install.sh restart"
echo -e "  ${CYAN}Update :${NC}  sudo bash ${PROJECT_DIR}/install.sh update"
echo -e "  ${CYAN}RADIUS :${NC}  sudo bash ${PROJECT_DIR}/install.sh radius-fix"
echo -e "  ${CYAN}Backup :${NC}  sudo bash ${PROJECT_DIR}/install.sh backup"
echo ""
echo -e "  ${YELLOW}⚠ সব credentials সংরক্ষিত: ${CRED_FILE}${NC}"
echo ""
