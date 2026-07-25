#!/bin/bash
# Redis password rotation — কারণ: `celery -A config report` কমান্ড settings.CACHES['default']['LOCATION']
# মাস্ক করেনি (Celery-এর censor শুধু পরিচিত CELERY_*/BROKER_URL key চেনে, custom Django CACHES dict না),
# ফলে আসল Redis password একটা AI conversation transcript-এ plaintext-এ চলে গেছে।
# এই স্ক্রিপ্ট নতুন password generate করে redis.conf + .env + .env.docker — তিন জায়গায় sync করে,
# তারপর সব Redis client (systemd + docker) restart করে। Password কখনো stdout-এ প্রিন্ট হয় না।
#
# ⚠️ DOWNTIME: redis-server restart-এর সময় কয়েক সেকেন্ড সব ক্লায়েন্ট (billing cache, celery broker,
#    session cache) সংক্ষিপ্তভাবে ডিসকানেক্ট হবে। Low-traffic window-এ চালান।
#
# ব্যবহার:
#   sudo bash docker/rotate_redis_password.sh --dry-run
#   sudo bash docker/rotate_redis_password.sh              # apply, "APPLY" টাইপ করে নিশ্চিত করতে হবে
#   sudo bash docker/rotate_redis_password.sh --rollback    # সর্বশেষ ব্যাকআপ থেকে ফিরিয়ে আনা

set -euo pipefail

REDIS_CNF="/etc/redis/redis.conf"
ENV_FILE="/var/www/isp_bnas/.env"
ENV_DOCKER_FILE="/var/www/isp_bnas/.env.docker"
TS="$(date +%Y%m%d_%H%M%S)"
DRY_RUN=false
ROLLBACK=false

for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=true ;;
        --rollback) ROLLBACK=true ;;
        *) echo "অজানা argument: $arg" >&2; exit 1 ;;
    esac
done

if [[ $EUID -ne 0 ]]; then
    echo "root/sudo দিয়ে চালান: sudo bash $0 [--dry-run|--rollback]" >&2
    exit 1
fi

if [[ "$ROLLBACK" == true ]]; then
    latest_redis=$(ls -t "${REDIS_CNF}.bak.rotate."* 2>/dev/null | head -1 || true)
    latest_env=$(ls -t "${ENV_FILE}.bak.rotate."* 2>/dev/null | head -1 || true)
    latest_env_docker=$(ls -t "${ENV_DOCKER_FILE}.bak.rotate."* 2>/dev/null | head -1 || true)
    if [[ -z "$latest_redis" ]]; then
        echo "কোনো rotation ব্যাকআপ পাওয়া যায়নি।" >&2
        exit 1
    fi
    read -r -p "রোলব্যাক নিশ্চিত করতে 'APPLY' টাইপ করুন (পুরনো password ফিরে আসবে, সার্ভিস restart হবে): " c </dev/tty
    [[ "$c" != "APPLY" ]] && { echo "বাতিল।"; exit 0; }
    cp "$latest_redis" "$REDIS_CNF"
    [[ -n "$latest_env" ]] && cp "$latest_env" "$ENV_FILE"
    [[ -n "$latest_env_docker" ]] && cp "$latest_env_docker" "$ENV_DOCKER_FILE"
    systemctl restart redis-server
    systemctl restart isp-gunicorn isp-celery isp-celery-beat
    echo "রোলব্যাক সম্পন্ন। docker django-app কন্টেইনার আলাদাভাবে recreate করতে হবে:"
    echo "  cd /var/www/isp_bnas && docker compose up -d --force-recreate django-app"
    exit 0
fi

# নতুন password — কখনো echo/print করা হয় না, শুধু ভেরিয়েবলে থাকে।
# hex (শুধু 0-9a-f) ব্যবহার করা হচ্ছে, base64 না — কারণ base64-এ +, /, = থাকতে পারে
# যেগুলো redis:// URL-এর ভেতর ভাঙন ধরায় (password/port/path ভুলভাবে split হয়ে যায়) —
# এটাই আগের rotation attempt-এ ভেঙেছিল এবং error traceback-এ password-এর অংশ leak হয়েছিল।
NEW_PASS="$(openssl rand -hex 32)"

# defense-in-depth: hex ছাড়া অন্য কিছু এলে (কোনো কারণে openssl-এর আচরণ বদলালে) থামিয়ে দেওয়া
if [[ ! "$NEW_PASS" =~ ^[0-9a-f]+$ ]]; then
    echo "গুরুতর: generated password প্রত্যাশিত hex ফরম্যাটে নেই — থামানো হলো (URL-এ ভাঙন এড়াতে)।" >&2
    unset NEW_PASS
    exit 1
fi

echo "নতুন password generate হয়েছে (দৈর্ঘ্য: ${#NEW_PASS} অক্ষর, শুধু 0-9a-f, URL-safe; মান দেখানো হবে না)।"

update_redis_conf() {
    local tmp before_perms
    tmp=$(mktemp)
    sed "s|^requirepass .*|requirepass ${NEW_PASS}|" "$REDIS_CNF" > "$tmp"
    if ! grep -q "^requirepass " "$REDIS_CNF"; then
        echo "সতর্কতা: redis.conf-এ বিদ্যমান 'requirepass' লাইন পাওয়া যায়নি — কিছু বদলানো হবে না।" >&2
        rm -f "$tmp"; return 1
    fi
    if [[ "$DRY_RUN" == true ]]; then
        echo "[dry-run] redis.conf-এ requirepass আপডেট হতো।"
        rm -f "$tmp"
    else
        before_perms=$(stat -c '%U:%G:%a' "$REDIS_CNF")
        cat "$tmp" > "$REDIS_CNF"
        rm -f "$tmp"
        local after_perms; after_perms=$(stat -c '%U:%G:%a' "$REDIS_CNF")
        if [[ "$before_perms" != "$after_perms" ]]; then
            echo "গুরুতর: permission বদলে গেছে ($before_perms -> $after_perms), থামানো হলো।" >&2
            exit 1
        fi
        echo "redis.conf আপডেট হয়েছে (permission অক্ষত)।"
    fi
}

update_url_password() {
    # $1 = file, $2 = KEY name (REDIS_URL / CELERY_BROKER_URL)
    local file="$1" key="$2" tmp
    tmp=$(mktemp)
    sed -E "s|^${key}=redis://:[^@]*@|${key}=redis://:${NEW_PASS}@|" "$file" > "$tmp"
    if [[ "$DRY_RUN" == true ]]; then
        echo "[dry-run] ${file}-এ ${key} আপডেট হতো।"
        rm -f "$tmp"
    else
        cat "$tmp" > "$file"
        rm -f "$tmp"
        echo "${file}-এ ${key} আপডেট হয়েছে।"
    fi
}

echo "=== ধাপ ১: ব্যাকআপ ==="
if [[ "$DRY_RUN" == false ]]; then
    cp "$REDIS_CNF" "${REDIS_CNF}.bak.rotate.${TS}"
    cp "$ENV_FILE" "${ENV_FILE}.bak.rotate.${TS}"
    [[ -f "$ENV_DOCKER_FILE" ]] && cp "$ENV_DOCKER_FILE" "${ENV_DOCKER_FILE}.bak.rotate.${TS}"
    echo "ব্যাকআপ নেওয়া হয়েছে (.bak.rotate.${TS})"
else
    echo "[dry-run] ব্যাকআপ নেওয়া হতো।"
fi

echo "=== ধাপ ২: redis.conf ==="
update_redis_conf

echo "=== ধাপ ৩: .env ==="
update_url_password "$ENV_FILE" "REDIS_URL"
update_url_password "$ENV_FILE" "CELERY_BROKER_URL"

if [[ -f "$ENV_DOCKER_FILE" ]]; then
    echo "=== ধাপ ৪: .env.docker ==="
    update_url_password "$ENV_DOCKER_FILE" "REDIS_URL"
    update_url_password "$ENV_DOCKER_FILE" "CELERY_BROKER_URL"
fi

if [[ "$DRY_RUN" == true ]]; then
    echo ""
    echo "DRY-RUN শেষ। সব ঠিক থাকলে: sudo bash $0"
    unset NEW_PASS
    exit 0
fi

echo ""
echo "=== ধাপ ৫: সার্ভিস restart ==="
echo "এই ধাপে redis-server + isp-gunicorn + isp-celery + isp-celery-beat restart হবে,"
echo "এবং docker django-app কন্টেইনার recreate করতে হবে (আলাদা কমান্ড, নিচে দেখুন)।"
read -r -p "নিশ্চিত করতে 'APPLY' টাইপ করুন: " confirm </dev/tty
if [[ "$confirm" != "APPLY" ]]; then
    echo "রিস্টার্ট বাতিল করা হলো — ফাইল পরিবর্তিত থেকে যাবে (পুরনো password দিয়ে সার্ভিস এখনো চলছে, mismatch হবে না যতক্ষণ restart না হয়)।"
    unset NEW_PASS
    exit 0
fi

systemctl restart redis-server
sleep 2
systemctl restart isp-gunicorn isp-celery isp-celery-beat
sleep 2
systemctl is-active redis-server isp-gunicorn isp-celery isp-celery-beat

unset NEW_PASS

echo ""
echo "সম্পন্ন। docker django-app কন্টেইনার নতুন password পেতে recreate করতে হবে:"
echo "  cd /var/www/isp_bnas && docker compose up -d --force-recreate django-app"
echo ""
echo "রোলব্যাক করতে: sudo bash $0 --rollback"
