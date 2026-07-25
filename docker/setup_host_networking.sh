#!/bin/bash
# ISP-BNAS Docker Phase-1 — Host networking prep: host MySQL + host Redis কে
# docker bridge subnet থেকে reachable করা (MySQL/Redis নিজেরা container হচ্ছে না)।
#
# ⚠️  DOWNTIME ঝুঁকি: apply mode-এ শেষ ধাপে `systemctl restart mysql` ও
#     `systemctl restart redis-server` চলে — এই কয়েক সেকেন্ডে সব active MySQL/Redis
#     connection ড্রপ হবে (billing writes, RADIUS auth lookup, session cache সহ)।
#     isp-gunicorn.service-এর Restart=on-failure থাকায় নিজে থেকে reconnect করবে,
#     কিন্তু in-flight request গুলো fail হতে পারে। Low-traffic window-এ চালান।
#
# এই স্ক্রিপ্ট নিজে থেকে কখনো restart/apply করে না যতক্ষণ না আপনি explicit apply mode-এ
# চালান এবং প্রম্পটে "APPLY" টাইপ করে নিশ্চিত করেন।
#
# ব্যবহার:
#   sudo bash docker/setup_host_networking.sh --dry-run          # কিছু পরিবর্তন হবে না, শুধু দেখাবে
#   sudo bash docker/setup_host_networking.sh                    # apply — চূড়ান্ত নিশ্চিতকরণ প্রম্পট আসবে
#   sudo bash docker/setup_host_networking.sh --allow-no-requirepass   # redis.conf-এ requirepass না থাকলেও এগিয়ে যাওয়ার override
#   sudo bash docker/setup_host_networking.sh --rollback         # সর্বশেষ ব্যাকআপ থেকে ফিরিয়ে আনা
#
# কখনো প্রিন্ট করে না: password, requirepass-এর মান, .env-এর কোনো value, mysql password hash।
# শুধু "SET" / "NOT SET" জানায় secret presence-এর জন্য।

set -euo pipefail

MYSQLD_CNF="/etc/mysql/mysql.conf.d/mysqld.cnf"
REDIS_CNF="/etc/redis/redis.conf"
ENV_FILE="/var/www/isp_bnas/.env"
TS="$(date +%Y%m%d_%H%M%S)"

DRY_RUN=false
ROLLBACK=false
ALLOW_NO_REQUIREPASS=false

for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=true ;;
        --rollback) ROLLBACK=true ;;
        --allow-no-requirepass) ALLOW_NO_REQUIREPASS=true ;;
        -h|--help)
            grep -E "^#( |$)" "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "অজানা argument: $arg (--dry-run | --rollback | --allow-no-requirepass | --help)" >&2
            exit 1
            ;;
    esac
done

if [[ $EUID -ne 0 ]]; then
    echo "এই স্ক্রিপ্ট root/sudo দিয়ে চালান: sudo bash $0 [options]" >&2
    exit 1
fi

log() { echo "[$([[ "$DRY_RUN" == true ]] && echo DRY-RUN || echo apply)] $*"; }

# ফাইলে content ওভাররাইট করার পর owner/permission অক্ষত আছে কিনা যাচাই — না থাকলে
# তৎক্ষণাৎ ব্যাকআপ থেকে পুনরুদ্ধার করে থেমে যায় (redis-server "Permission denied"
# ইনসিডেন্টের পুনরাবৃত্তি ঠেকাতে যোগ করা হয়েছে)।
assert_perms_unchanged() {
    local file="$1" before="$2" after
    after=$(stat -c '%U:%G:%a' "$file")
    if [[ "$before" != "$after" ]]; then
        echo "" >&2
        echo "গুরুতর: ${file}-এর owner/permission পরিবর্তন হয়ে গেছে (${before} -> ${after})।" >&2
        echo "এতে সার্ভিস বুট ফেইল করতে পারে — সর্বশেষ ব্যাকআপ থেকে স্বয়ংক্রিয় পুনরুদ্ধার করা হচ্ছে এবং restart স্কিপ করা হচ্ছে।" >&2
        local latest_backup
        latest_backup=$(ls -t "${file}.bak."* 2>/dev/null | head -1 || true)
        if [[ -n "$latest_backup" ]]; then
            cp "$latest_backup" "$file"
            chown "${before%%:*}":"$(echo "$before" | cut -d: -f2)" "$file" 2>/dev/null || true
            chmod "${before##*:}" "$file" 2>/dev/null || true
            echo "পুনরুদ্ধার সম্পন্ন: $file" >&2
        fi
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# ধাপ ০: Docker bridge gateway/subnet ডায়নামিক ডিটেকশন
# ---------------------------------------------------------------------------
detect_docker_network() {
    DOCKER_SUBNET=""
    DOCKER_GATEWAY=""

    if command -v docker >/dev/null 2>&1; then
        DOCKER_SUBNET=$(docker network inspect bridge --format '{{ (index .IPAM.Config 0).Subnet }}' 2>/dev/null || true)
        DOCKER_GATEWAY=$(docker network inspect bridge --format '{{ (index .IPAM.Config 0).Gateway }}' 2>/dev/null || true)
    fi

    if [[ -z "$DOCKER_GATEWAY" ]] && ip -4 addr show docker0 >/dev/null 2>&1; then
        local cidr
        cidr=$(ip -4 addr show docker0 | awk '/inet /{print $2}' | head -1)
        DOCKER_GATEWAY="${cidr%%/*}"
        if command -v python3 >/dev/null 2>&1 && [[ -n "$cidr" ]]; then
            DOCKER_SUBNET=$(python3 -c "import ipaddress; print(ipaddress.ip_network('${cidr}', strict=False))" 2>/dev/null || true)
        fi
    fi

    if [[ -z "$DOCKER_GATEWAY" || -z "$DOCKER_SUBNET" ]]; then
        echo "[warn] docker bridge auto-detect ব্যর্থ — ডিফল্ট fallback ব্যবহার হচ্ছে: 172.17.0.1 / 172.17.0.0/16" >&2
        DOCKER_GATEWAY="172.17.0.1"
        DOCKER_SUBNET="172.17.0.0/16"
    fi

    echo "Docker bridge gateway : ${DOCKER_GATEWAY}"
    echo "Docker bridge subnet  : ${DOCKER_SUBNET}"
}

# MySQL host-grant pattern subnet থেকে বানানো হয় (যেমন 172.17.0.0/16 -> '172.17.%.%')
# MySQL host-grant CIDR সাপোর্ট করে না, তাই wildcard pattern-এ রূপান্তর করা হচ্ছে।
subnet_to_mysql_pattern() {
    local subnet="$1"  # e.g. 172.17.0.0/16
    local base="${subnet%%/*}"
    local prefix="${subnet##*/}"
    if [[ "$prefix" -ge 24 ]]; then
        echo "${base%.*}.%"
    elif [[ "$prefix" -ge 16 ]]; then
        echo "$(echo "$base" | cut -d. -f1-2).%.%"
    else
        echo "$(echo "$base" | cut -d. -f1).%.%.%"
    fi
}

# ---------------------------------------------------------------------------
# রোলব্যাক মোড
# ---------------------------------------------------------------------------
do_rollback() {
    local latest_mysql_backup latest_redis_backup
    latest_mysql_backup=$(ls -t "${MYSQLD_CNF}.bak."* 2>/dev/null | head -1 || true)
    latest_redis_backup=$(ls -t "${REDIS_CNF}.bak."* 2>/dev/null | head -1 || true)

    if [[ -z "$latest_mysql_backup" && -z "$latest_redis_backup" ]]; then
        echo "কোনো ব্যাকআপ পাওয়া যায়নি — রোলব্যাক করার কিছু নেই।" >&2
        exit 1
    fi

    echo "রোলব্যাক করা হবে:"
    [[ -n "$latest_mysql_backup" ]] && echo "  mysqld.cnf  <- $latest_mysql_backup"
    [[ -n "$latest_redis_backup" ]] && echo "  redis.conf  <- $latest_redis_backup"
    read -r -p "নিশ্চিত করতে 'APPLY' টাইপ করুন (mysql ও redis-server restart হবে): " confirm </dev/tty
    if [[ "$confirm" != "APPLY" ]]; then
        echo "বাতিল করা হলো।"
        exit 0
    fi

    [[ -n "$latest_mysql_backup" ]] && cp "$latest_mysql_backup" "$MYSQLD_CNF" && echo "mysqld.cnf পুনরুদ্ধার হয়েছে।"
    [[ -n "$latest_redis_backup" ]] && cp "$latest_redis_backup" "$REDIS_CNF" && echo "redis.conf পুনরুদ্ধার হয়েছে।"

    systemctl restart mysql
    systemctl restart redis-server
    echo "mysql ও redis-server restart সম্পন্ন।"
    echo ""
    echo "মনে রাখবেন: docker-subnet-scoped MySQL user গুলো (host pattern সহ) এখনো থেকে যাবে।"
    echo "সেগুলো ম্যানুয়ালি বাদ দিতে DROP USER চালান (username/pattern আপনার নোটে আছে)।"
}

if [[ "$ROLLBACK" == true ]]; then
    do_rollback
    exit 0
fi

detect_docker_network
DOCKER_SUBNET_PATTERN="$(subnet_to_mysql_pattern "$DOCKER_SUBNET")"
echo "MySQL host grant pattern হবে: '${DOCKER_SUBNET_PATTERN}'"
echo ""

# ---------------------------------------------------------------------------
# ধাপ ১: Backup
# ---------------------------------------------------------------------------
backup_configs() {
    if [[ ! -f "$MYSQLD_CNF" ]]; then
        echo "$MYSQLD_CNF পাওয়া যায়নি।" >&2
        exit 1
    fi
    if [[ ! -f "$REDIS_CNF" ]]; then
        echo "$REDIS_CNF পাওয়া যায়নি — path যাচাই করুন।" >&2
        exit 1
    fi

    if [[ "$DRY_RUN" == true ]]; then
        log "backup নেওয়া হতো: ${MYSQLD_CNF}.bak.${TS}, ${REDIS_CNF}.bak.${TS}"
    else
        cp "$MYSQLD_CNF" "${MYSQLD_CNF}.bak.${TS}"
        cp "$REDIS_CNF" "${REDIS_CNF}.bak.${TS}"
        log "backup নেওয়া হয়েছে: ${MYSQLD_CNF}.bak.${TS}, ${REDIS_CNF}.bak.${TS}"
    fi
}

# ---------------------------------------------------------------------------
# ধাপ ২: MySQL bind-address — শুধু localhost + docker gateway (0.0.0.0 নয়)
# ---------------------------------------------------------------------------
update_mysql_bind() {
    local new_bind="127.0.0.1,${DOCKER_GATEWAY}"
    local tmp before_perms
    tmp=$(mktemp)
    sed "s/^bind-address\s*=.*/bind-address\t\t= ${new_bind}/" "$MYSQLD_CNF" > "$tmp"

    echo "--- MySQL bind-address diff (${MYSQLD_CNF}) ---"
    diff -U0 "$MYSQLD_CNF" "$tmp" || true
    echo "-----------------------------------------------"

    if [[ "$DRY_RUN" == true ]]; then
        rm -f "$tmp"
        log "mysqld.cnf পরিবর্তন হতো (উপরের diff অনুযায়ী)।"
    else
        # mv দিয়ে ফাইল replace করলে নতুন inode root-owned/default-mode হয়ে যায় —
        # আগে এই বাগেই redis.conf-এর owner/permission ভেঙে redis-server বুট হয়নি।
        # তাই এখানে বিদ্যমান ফাইলের ভেতরেই content লেখা হচ্ছে (owner/mode অপরিবর্তিত থাকে)।
        before_perms=$(stat -c '%U:%G:%a' "$MYSQLD_CNF")
        cat "$tmp" > "$MYSQLD_CNF"
        rm -f "$tmp"
        assert_perms_unchanged "$MYSQLD_CNF" "$before_perms"
        log "mysqld.cnf আপডেট হয়েছে (owner/permission অপরিবর্তিত রাখা হয়েছে)।"
    fi
}

# ---------------------------------------------------------------------------
# ধাপ ৩: Redis bind — শুধু localhost + docker gateway (0.0.0.0 নয়)
# requirepass না থাকলে ডিফল্টভাবে থামবে (unless --allow-no-requirepass)
# ---------------------------------------------------------------------------
check_redis_requirepass() {
    if grep -q "^requirepass" "$REDIS_CNF"; then
        echo "redis requirepass: SET"
        return 0
    else
        echo "redis requirepass: NOT SET"
        return 1
    fi
}

update_redis_bind() {
    local requirepass_set=true
    check_redis_requirepass || requirepass_set=false

    if [[ "$requirepass_set" == false && "$ALLOW_NO_REQUIREPASS" == false ]]; then
        echo "" >&2
        echo "থামানো হলো: redis.conf-এ requirepass সেট নেই।" >&2
        echo "bind খোলার পর password ছাড়া docker subnet-এর যেকোনো কন্টেইনার Redis-এ কানেক্ট করতে পারবে —" >&2
        echo "এটা ঝুঁকিপূর্ণ। আগে redis.conf-এ 'requirepass <strong-value>' সেট করুন এবং" >&2
        echo "REDIS_URL/CELERY_BROKER_URL-এ সেই password যোগ করুন, তারপর আবার চালান।" >&2
        echo "শুধু জেনে-বুঝে override করতে চাইলে: --allow-no-requirepass" >&2
        exit 1
    fi
    if [[ "$requirepass_set" == false && "$ALLOW_NO_REQUIREPASS" == true ]]; then
        echo "" >&2
        echo "⚠️  সতর্কতা: --allow-no-requirepass দিয়ে এগোনো হচ্ছে — Redis password ছাড়াই" >&2
        echo "   docker subnet থেকে reachable হবে। শুধু isolated/lab পরিবেশে গ্রহণযোগ্য।" >&2
    fi

    local new_bind="127.0.0.1 ${DOCKER_GATEWAY}"
    local tmp before_perms
    tmp=$(mktemp)
    if grep -q "^bind " "$REDIS_CNF"; then
        sed "s/^bind .*/bind ${new_bind}/" "$REDIS_CNF" > "$tmp"
    else
        cp "$REDIS_CNF" "$tmp"
        echo "bind ${new_bind}" >> "$tmp"
    fi

    echo "--- Redis bind diff (শুধু bind লাইন, requirepass কখনো দেখানো হয় না) ---"
    diff -U0 <(grep "^bind " "$REDIS_CNF" || echo "(কোনো bind লাইন নেই)") <(grep "^bind " "$tmp") || true
    echo "--------------------------------------------------------------------"

    if [[ "$DRY_RUN" == true ]]; then
        rm -f "$tmp"
        log "redis.conf পরিবর্তন হতো (উপরের diff অনুযায়ী)।"
    else
        # mv নয় — বিদ্যমান ফাইলের ভেতরেই content লেখা হচ্ছে যাতে redis:redis owner ও 640
        # mode অক্ষত থাকে (mv করলে redis-server 'Permission denied' দিয়ে বুট ফেইল করবে)।
        before_perms=$(stat -c '%U:%G:%a' "$REDIS_CNF")
        cat "$tmp" > "$REDIS_CNF"
        rm -f "$tmp"
        assert_perms_unchanged "$REDIS_CNF" "$before_perms"
        log "redis.conf আপডেট হয়েছে (owner/permission অপরিবর্তিত রাখা হয়েছে)।"
    fi
}

# ---------------------------------------------------------------------------
# ধাপ ৪: MySQL GRANT — docker-subnet-scoped host, password hash কপি করে
# (password/hash কখনো stdout-এ print হয় না — সবকিছু mysql session variable-এর ভেতরে)
# ---------------------------------------------------------------------------
prepare_mysql_grants() {
    if [[ ! -f "$ENV_FILE" ]]; then
        echo "$ENV_FILE পাওয়া যায়নি — GRANT তৈরি করা যাচ্ছে না।" >&2
        exit 1
    fi

    local DB_USER DB_NAME RADIUS_DB_USER RADIUS_DB_NAME
    DB_USER=$(grep -E "^DB_USER=" "$ENV_FILE" | head -1 | cut -d= -f2-)
    DB_NAME=$(grep -E "^DB_NAME=" "$ENV_FILE" | head -1 | cut -d= -f2-)
    RADIUS_DB_USER=$(grep -E "^RADIUS_DB_USER=" "$ENV_FILE" | head -1 | cut -d= -f2-)
    RADIUS_DB_NAME=$(grep -E "^RADIUS_DB_NAME=" "$ENV_FILE" | head -1 | cut -d= -f2-)

    if [[ -z "$DB_USER" || -z "$DB_NAME" || -z "$RADIUS_DB_USER" || -z "$RADIUS_DB_NAME" ]]; then
        echo "DB_USER/DB_NAME/RADIUS_DB_USER/RADIUS_DB_NAME .env-এ পাওয়া যায়নি।" >&2
        exit 1
    fi

    echo "--- এই SQL চালানো হবে (username/db name ছাড়া অন্য কোনো secret নেই) ---"
    cat <<SQL_PREVIEW
-- ${DB_USER}@'localhost'-এর বিদ্যমান password hash কপি করে নতুন docker-subnet-scoped ইউজার:
SET @pw_plugin = (SELECT plugin FROM mysql.user WHERE User='${DB_USER}' AND Host='localhost' LIMIT 1);
SET @pw_hash   = (SELECT authentication_string FROM mysql.user WHERE User='${DB_USER}' AND Host='localhost' LIMIT 1);
SET @sql = CONCAT("CREATE USER IF NOT EXISTS '${DB_USER}'@'${DOCKER_SUBNET_PATTERN}' IDENTIFIED WITH ", @pw_plugin, " AS '", @pw_hash, "'");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'${DOCKER_SUBNET_PATTERN}';

SET @pw_plugin2 = (SELECT plugin FROM mysql.user WHERE User='${RADIUS_DB_USER}' AND Host='localhost' LIMIT 1);
SET @pw_hash2   = (SELECT authentication_string FROM mysql.user WHERE User='${RADIUS_DB_USER}' AND Host='localhost' LIMIT 1);
SET @sql2 = CONCAT("CREATE USER IF NOT EXISTS '${RADIUS_DB_USER}'@'${DOCKER_SUBNET_PATTERN}' IDENTIFIED WITH ", @pw_plugin2, " AS '", @pw_hash2, "'");
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;
GRANT ALL PRIVILEGES ON \`${RADIUS_DB_NAME}\`.* TO '${RADIUS_DB_USER}'@'${DOCKER_SUBNET_PATTERN}';

FLUSH PRIVILEGES;
SQL_PREVIEW
    echo "----------------------------------------------------------------------"

    if [[ "$DRY_RUN" == true ]]; then
        log "উপরের SQL চালানো হতো (এখনো mysql-এ কানেক্ট করা হয়নি)।"
        return
    fi

    echo "mysql root পাসওয়ার্ড চাওয়া হবে (এই স্ক্রিপ্টে কোথাও hardcode/log হয় না):"
    mysql -u root -p <<SQL
SET @pw_plugin = (SELECT plugin FROM mysql.user WHERE User='${DB_USER}' AND Host='localhost' LIMIT 1);
SET @pw_hash   = (SELECT authentication_string FROM mysql.user WHERE User='${DB_USER}' AND Host='localhost' LIMIT 1);
SET @sql = CONCAT("CREATE USER IF NOT EXISTS '${DB_USER}'@'${DOCKER_SUBNET_PATTERN}' IDENTIFIED WITH ", @pw_plugin, " AS '", @pw_hash, "'");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'${DOCKER_SUBNET_PATTERN}';

SET @pw_plugin2 = (SELECT plugin FROM mysql.user WHERE User='${RADIUS_DB_USER}' AND Host='localhost' LIMIT 1);
SET @pw_hash2   = (SELECT authentication_string FROM mysql.user WHERE User='${RADIUS_DB_USER}' AND Host='localhost' LIMIT 1);
SET @sql2 = CONCAT("CREATE USER IF NOT EXISTS '${RADIUS_DB_USER}'@'${DOCKER_SUBNET_PATTERN}' IDENTIFIED WITH ", @pw_plugin2, " AS '", @pw_hash2, "'");
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;
GRANT ALL PRIVILEGES ON \`${RADIUS_DB_NAME}\`.* TO '${RADIUS_DB_USER}'@'${DOCKER_SUBNET_PATTERN}';

FLUSH PRIVILEGES;
SQL
    log "MySQL GRANT সম্পন্ন।"
    echo "রোলব্যাকের সময় বাদ দিতে: DROP USER '${DB_USER}'@'${DOCKER_SUBNET_PATTERN}'; DROP USER '${RADIUS_DB_USER}'@'${DOCKER_SUBNET_PATTERN}';"
}

# ---------------------------------------------------------------------------
# ধাপ ৫: UFW — active থাকলে শুধু তখনই docker subnet-এর জন্য rule যোগ
# ---------------------------------------------------------------------------
setup_ufw() {
    if ! command -v ufw >/dev/null 2>&1; then
        log "ufw ইনস্টল নেই — এই ধাপ স্কিপ।"
        return
    fi
    if ! ufw status | grep -q "Status: active"; then
        log "ufw active নয় — rule যোগ করা হচ্ছে না (স্কিপ)।"
        return
    fi

    echo "--- UFW rules যা যোগ হবে ---"
    echo "ufw allow from ${DOCKER_SUBNET} to any port 3306 proto tcp comment 'docker: mysql for isp-bnas'"
    echo "ufw allow from ${DOCKER_SUBNET} to any port 6379 proto tcp comment 'docker: redis for isp-bnas'"
    echo "-----------------------------"

    if [[ "$DRY_RUN" == true ]]; then
        log "UFW rule যোগ হতো (উপরে দেখানো)।"
    else
        ufw allow from "${DOCKER_SUBNET}" to any port 3306 proto tcp comment 'docker: mysql for isp-bnas'
        ufw allow from "${DOCKER_SUBNET}" to any port 6379 proto tcp comment 'docker: redis for isp-bnas'
        log "UFW rule যোগ হয়েছে।"
    fi
}

# ---------------------------------------------------------------------------
# ধাপ ৬: সার্ভিস restart — শুধু explicit "APPLY" নিশ্চিতকরণের পর
# ---------------------------------------------------------------------------
restart_services() {
    if [[ "$DRY_RUN" == true ]]; then
        log "mysql ও redis-server restart হতো (dry-run বলে হয়নি)।"
        return
    fi
    systemctl restart mysql
    systemctl restart redis-server
    log "mysql ও redis-server restart সম্পন্ন।"
    echo "যাচাই করুন isp-gunicorn আবার কানেক্ট করছে কিনা:"
    echo "  sudo journalctl -u isp-gunicorn -n 30 --no-pager"
}

# ---------------------------------------------------------------------------
# মূল প্রবাহ
# ---------------------------------------------------------------------------
if [[ "$DRY_RUN" == true ]]; then
    echo "=== DRY-RUN মোড — কোনো ফাইল/সার্ভিস পরিবর্তন হবে না ==="
    backup_configs
    update_mysql_bind
    update_redis_bind
    prepare_mysql_grants
    setup_ufw
    restart_services
    echo ""
    echo "DRY-RUN শেষ। সব ঠিক থাকলে সত্যিকারের apply চালান: sudo bash $0"
    exit 0
fi

echo "=== APPLY মোড ==="
echo "এই ধাপগুলো চলবে: backup -> mysqld.cnf bind পরিবর্তন -> redis.conf bind পরিবর্তন ->"
echo "MySQL GRANT (root পাসওয়ার্ড চাইবে) -> ufw rule (active থাকলে) -> mysql+redis-server restart"
echo ""
read -r -p "নিশ্চিত করতে 'APPLY' টাইপ করুন: " confirm </dev/tty
if [[ "$confirm" != "APPLY" ]]; then
    echo "বাতিল করা হলো — কিছু পরিবর্তন হয়নি।"
    exit 0
fi

backup_configs
update_mysql_bind
update_redis_bind
prepare_mysql_grants
setup_ufw
restart_services

echo ""
echo "সম্পন্ন। রোলব্যাক করতে: sudo bash $0 --rollback"
