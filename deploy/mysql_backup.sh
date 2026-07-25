#!/bin/bash
# ISP-BNAS দৈনিক ব্যাকআপ — DB + config/secret ফাইল।
#
# গুরুত্বপূর্ণ স্থাপত্য নোট (২০২৬-০৭-১০ DR review-এ ধরা পড়েছে): এই প্রজেক্টে
# .env-এর DB_NAME এবং RADIUS_DB_NAME দুটোই আসলে "radius" — একই MySQL host,
# একই port, একই ডাটাবেস নাম। অর্থাৎ Django app (billing/client/HR/livetv)
# আর FreeRADIUS (radcheck/radacct) টেবিল **একই একটা ডাটাবেসে** একসাথে আছে,
# আলাদা দুটো DB না (ঐতিহাসিক naming — ভুল বোঝা সহজ)। তাই এখানে শুধু একটাই
# mysqldump যথেষ্ট — আগে ভুলবশত দুইবার (একই আউটপুট ফাইলে overwrite) dump
# নেওয়া হচ্ছিল, যেটা দ্বিতীয়বার auth/lock সমস্যায় fail করে পুরো script
# (set -e কারণে) থামিয়ে দিচ্ছিল — ফলে config/system ব্যাকআপ কখনো তৈরিই
# হচ্ছিল না। এখন ঠিক করা হলো।
#
# retention: কোনো auto-delete নেই (ইচ্ছাকৃত — client billing history যাতে হারিয়ে না যায়)।
# cron: /etc/cron.d/isp-bnas-backup (root, daily 03:00)
#
# ⚠️ এই স্ক্রিপ্ট শুধু LOCAL ডিস্কে (/var/backups/isp_bnas) ব্যাকআপ রাখে —
# পুরো মেশিন/ডিস্ক নষ্ট হলে এই ব্যাকআপও হারিয়ে যাবে। তাই প্রতিদিন এই
# BACKUP_DIR অন্য কোনো মেশিনে (অফসাইট) sync/copy করা আবশ্যক —
# docker/DR_MIGRATION_PLAN.md দেখুন।
set -euo pipefail

ENV_FILE="/var/www/isp_bnas/.env"
BACKUP_DIR="/var/backups/isp_bnas"
DATE="$(date +%F)"

DB_HOST="$(grep -E '^DB_HOST=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
DB_PORT="$(grep -E '^DB_PORT=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
DB_NAME="$(grep -E '^DB_NAME=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
DB_USER="$(grep -E '^DB_USER=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
DB_PASSWORD="$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"

mkdir -p "$BACKUP_DIR" "$BACKUP_DIR/config"

# ── ১) মূল DB (Django app + FreeRADIUS, একসাথে একই ডাটাবেসে) ─────────────────
export MYSQL_PWD="$DB_PASSWORD"
mysqldump --single-transaction --quick --routines --triggers \
  -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" \
  | gzip > "$BACKUP_DIR/${DB_NAME}_${DATE}.sql.gz"
unset MYSQL_PWD
echo "[$(date '+%F %T')] backup ok: $BACKUP_DIR/${DB_NAME}_${DATE}.sql.gz ($(du -h "$BACKUP_DIR/${DB_NAME}_${DATE}.sql.gz" | cut -f1))"

# ── ৩) Secret/config ফাইল — git-এ নেই (.gitignore), তাই আলাদা ব্যাকআপ ছাড়া
#      নতুন মেশিনে migrate করলে এগুলো হারিয়ে যাবে (SECRET_KEY বদলালে সব
#      session/token invalid হয়ে যাবে, DB password না থাকলে app চলবেই না)।
CONFIG_TAR="$BACKUP_DIR/config/isp_bnas_secrets_${DATE}.tar.gz"
tar -czf "$CONFIG_TAR" -C /var/www/isp_bnas \
  --ignore-failed-read \
  .env .env.docker .env.sonarqube .mcp.json \
  admin_panel/.env.production \
  firebase-service-account.json \
  livetv_app/google-services.json \
  livetv_app/android/app/google-services.json \
  mobile_app/google-services.json \
  2>/dev/null || true
echo "[$(date '+%F %T')] backup ok: $CONFIG_TAR ($(du -h "$CONFIG_TAR" 2>/dev/null | cut -f1))"

# ── ৪) সিস্টেম কনফিগ (nginx/systemd) — git-এ নেই কিন্তু migrate-এ লাগবে ───────
SYS_TAR="$BACKUP_DIR/config/system_config_${DATE}.tar.gz"
tar -czf "$SYS_TAR" \
  --ignore-failed-read \
  /etc/nginx/sites-available/isp_bnas \
  /etc/systemd/system/isp-*.service \
  /etc/cron.d/isp-bnas-backup \
  /etc/freeradius/3.0/ \
  /etc/asterisk/ \
  2>/dev/null || true
echo "[$(date '+%F %T')] backup ok: $SYS_TAR ($(du -h "$SYS_TAR" 2>/dev/null | cut -f1))"
