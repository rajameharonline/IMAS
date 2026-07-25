#!/bin/bash
# Nginx Option 1 cutover — শুধু Django upstream পরিবর্তন (127.0.0.1:8000 -> 127.0.0.1:8001)
# Host nginx (SSL/walled-garden/HLS-security/APK/phpMyAdmin সব) অক্ষত থাকে —
# শুধু কোন Django process request পাবে সেটাই বদলায় (systemd gunicorn -> docker django-app)।
#
# ⚠️ DOWNTIME ঝুঁকি: প্রায় শূন্য — `reload` (restart না) ব্যবহার হয়, nginx worker
#    graceful ভাবে নতুন config নেয়, বিদ্যমান connection ভাঙে না। তবু production
#    traffic-এর route পরিবর্তন হচ্ছে, তাই ভুল হলে ALL web traffic (billing UI,
#    API, admin) ভাঙতে পারে — তাই ডিফল্ট dry-run, "APPLY" নিশ্চিতকরণ বাধ্যতামূলক।
#
# ব্যবহার:
#   sudo bash docker/nginx_option1_upstream_patch.sh              # dry-run (ডিফল্ট)
#   sudo bash docker/nginx_option1_upstream_patch.sh --dry-run    # explicit dry-run
#   sudo bash docker/nginx_option1_upstream_patch.sh --apply      # আসল পরিবর্তন
#   sudo bash docker/nginx_option1_upstream_patch.sh --rollback   # সর্বশেষ ব্যাকআপে ফেরা

set -euo pipefail

NGINX_CONF="/etc/nginx/sites-available/isp_bnas"
OLD_TARGET="server 127.0.0.1:8000;"
NEW_TARGET="server 127.0.0.1:8001;"
TS="$(date +%Y%m%d_%H%M%S)"
MODE="dry-run"

for arg in "$@"; do
    case "$arg" in
        --dry-run) MODE="dry-run" ;;
        --apply) MODE="apply" ;;
        --rollback) MODE="rollback" ;;
        -h|--help)
            grep -E "^#( |$)" "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *) echo "অজানা argument: $arg (--dry-run | --apply | --rollback)" >&2; exit 1 ;;
    esac
done

if [[ $EUID -ne 0 ]]; then
    echo "root/sudo দিয়ে চালান: sudo bash $0 [--dry-run|--apply|--rollback]" >&2
    exit 1
fi

if [[ ! -f "$NGINX_CONF" ]]; then
    echo "$NGINX_CONF পাওয়া যায়নি।" >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# রোলব্যাক মোড
# ---------------------------------------------------------------------------
if [[ "$MODE" == "rollback" ]]; then
    latest_backup=$(ls -t "${NGINX_CONF}.bak."* 2>/dev/null | head -1 || true)
    if [[ -z "$latest_backup" ]]; then
        echo "কোনো ব্যাকআপ পাওয়া যায়নি — রোলব্যাক করার কিছু নেই।" >&2
        exit 1
    fi
    echo "রোলব্যাক করা হবে: ${latest_backup} -> ${NGINX_CONF}"
    read -r -p "নিশ্চিত করতে 'APPLY' টাইপ করুন: " confirm </dev/tty
    if [[ "$confirm" != "APPLY" ]]; then
        echo "বাতিল করা হলো।"
        exit 0
    fi
    before_perms=$(stat -c '%U:%G:%a' "$NGINX_CONF")
    cat "$latest_backup" > "$NGINX_CONF"
    after_perms=$(stat -c '%U:%G:%a' "$NGINX_CONF")
    if [[ "$before_perms" != "$after_perms" ]]; then
        echo "গুরুতর: permission বদলে গেছে, থামানো হলো।" >&2
        exit 1
    fi
    nginx -t
    systemctl reload nginx
    echo "রোলব্যাক সম্পন্ন — nginx পুরনো upstream (127.0.0.1:8000, systemd gunicorn)-এ ফিরে গেছে।"
    exit 0
fi

# ---------------------------------------------------------------------------
# নিশ্চিত করা: ঠিক একটাই safe replacement target আছে
# ---------------------------------------------------------------------------
MATCH_COUNT=$(grep -cF "$OLD_TARGET" "$NGINX_CONF" || true)
if [[ "$MATCH_COUNT" -ne 1 ]]; then
    echo "থামানো হলো: '${OLD_TARGET}' প্যাটার্ন ঠিক ১ বার না পেয়ে ${MATCH_COUNT} বার পাওয়া গেছে।" >&2
    echo "নিরাপদভাবে single-target replace করা যাচ্ছে না — ম্যানুয়ালি যাচাই করুন।" >&2
    exit 1
fi
if grep -qF "$NEW_TARGET" "$NGINX_CONF"; then
    echo "লক্ষ্য করা গেছে: '${NEW_TARGET}' ইতিমধ্যে কনফিগে আছে — সম্ভবত আগেই cutover হয়ে গেছে।" >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# diff তৈরি ও দেখানো (apply/dry-run উভয় মোডেই)
# ---------------------------------------------------------------------------
tmp=$(mktemp)
sed "s|${OLD_TARGET}|${NEW_TARGET}|" "$NGINX_CONF" > "$tmp"

echo "=== প্রস্তাবিত পরিবর্তন (শুধু upstream target, বাকি সব অপরিবর্তিত) ==="
diff -U2 "$NGINX_CONF" "$tmp" || true
echo "================================================================"

if [[ "$MODE" == "dry-run" ]]; then
    echo ""
    echo "[dry-run] উপরের diff অনুযায়ী পরিবর্তন হতো — কিছুই এখনো বদলায়নি।"
    echo "[dry-run] আসল প্রয়োগের জন্য: sudo bash $0 --apply"
    rm -f "$tmp"
    exit 0
fi

# ---------------------------------------------------------------------------
# APPLY মোড
# ---------------------------------------------------------------------------
echo ""
echo "এই ধাপে production nginx-এর Django upstream 127.0.0.1:8000 (systemd gunicorn)"
echo "থেকে 127.0.0.1:8001 (docker django-app)-এ বদলাবে। SSL/walled-garden/HLS-security/"
echo "APK/phpMyAdmin/static/media — এই কোনো কিছুই ছোঁয়া হবে না।"
read -r -p "নিশ্চিত করতে 'APPLY' টাইপ করুন: " confirm </dev/tty
if [[ "$confirm" != "APPLY" ]]; then
    echo "বাতিল করা হলো — কিছু পরিবর্তন হয়নি।"
    rm -f "$tmp"
    exit 0
fi

echo "=== ব্যাকআপ ==="
cp "$NGINX_CONF" "${NGINX_CONF}.bak.${TS}"
echo "ব্যাকআপ: ${NGINX_CONF}.bak.${TS}"

before_perms=$(stat -c '%U:%G:%a' "$NGINX_CONF")
cat "$tmp" > "$NGINX_CONF"
rm -f "$tmp"
after_perms=$(stat -c '%U:%G:%a' "$NGINX_CONF")
if [[ "$before_perms" != "$after_perms" ]]; then
    echo "গুরুতর: permission বদলে গেছে ($before_perms -> $after_perms) — সাথে সাথে ব্যাকআপ থেকে পুনরুদ্ধার করা হচ্ছে।" >&2
    cp "${NGINX_CONF}.bak.${TS}" "$NGINX_CONF"
    exit 1
fi

echo "=== nginx -t ==="
if ! nginx -t; then
    echo "nginx config test ব্যর্থ — স্বয়ংক্রিয়ভাবে ব্যাকআপ থেকে পুনরুদ্ধার করা হচ্ছে।" >&2
    cp "${NGINX_CONF}.bak.${TS}" "$NGINX_CONF"
    nginx -t
    exit 1
fi

echo "=== systemctl reload nginx (restart না, zero-downtime) ==="
systemctl reload nginx

echo ""
echo "সম্পন্ন। production nginx এখন docker django-app (127.0.0.1:8001)-এ proxy করছে।"
echo "রোলব্যাক করতে: sudo bash $0 --rollback"
