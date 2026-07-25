#!/bin/bash
# IMAS দৈনিক ব্যাকআপ — DB + config/secret ফাইল (PostgreSQL সংস্করণ)।
#
# .env-এর DB_NAME এবং RADIUS_DB_NAME দুটোই "radius" — একই PostgreSQL host,
# একই port, একই ডাটাবেস নাম। Django app (billing/client/HR/livetv) আর
# FreeRADIUS (radcheck/radacct) টেবিল একই একটা ডাটাবেসে একসাথে আছে —
# তাই একটাই pg_dump যথেষ্ট।
#
# retention: কোনো auto-delete নেই (ইচ্ছাকৃত — client billing history যাতে হারিয়ে না যায়)।
# cron: /etc/cron.d/imas-backup (root, daily 03:00)
#
# ⚠️ এই স্ক্রিপ্ট শুধু LOCAL ডিস্কে (/var/backups/imas) ব্যাকআপ রাখে —
# পুরো মেশিন/ডিস্ক নষ্ট হলে এই ব্যাকআপও হারিয়ে যাবে। প্রতিদিন BACKUP_DIR
# অন্য কোনো মেশিনে (অফসাইট) sync/copy করা আবশ্যক।
set -euo pipefail

ENV_FILE="/var/www/IMAS/.env"
BACKUP_DIR="/var/backups/imas"
DATE="$(date +%F)"

DB_HOST="$(grep -E '^DB_HOST=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
DB_PORT="$(grep -E '^DB_PORT=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
DB_NAME="$(grep -E '^DB_NAME=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
DB_USER="$(grep -E '^DB_USER=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
DB_PASSWORD="$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d "'\"")"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"

mkdir -p "$BACKUP_DIR" "$BACKUP_DIR/config"

# ── ১) মূল DB (Django app + FreeRADIUS, একসাথে একই ডাটাবেসে) ─────────────────
export PGPASSWORD="$DB_PASSWORD"
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" \
  | gzip > "$BACKUP_DIR/${DB_NAME}_${DATE}.sql.gz"
unset PGPASSWORD
echo "[$(date '+%F %T')] backup ok: $BACKUP_DIR/${DB_NAME}_${DATE}.sql.gz ($(du -h "$BACKUP_DIR/${DB_NAME}_${DATE}.sql.gz" | cut -f1))"

# ── ২) Secret/config ফাইল — git-এ নেই (.gitignore), তাই আলাদা ব্যাকআপ ছাড়া
#      নতুন মেশিনে migrate করলে এগুলো হারিয়ে যাবে (SECRET_KEY বদলালে সব
#      session/token invalid হয়ে যাবে, DB password না থাকলে app চলবেই না)।
CONFIG_TAR="$BACKUP_DIR/config/imas_secrets_${DATE}.tar.gz"
tar -czf "$CONFIG_TAR" -C /var/www/IMAS \
  --ignore-failed-read \
  .env .env.docker .env.sonarqube .mcp.json \
  admin_panel/.env.production \
  firebase-service-account.json \
  mobile_app/google-services.json \
  2>/dev/null || true
echo "[$(date '+%F %T')] backup ok: $CONFIG_TAR ($(du -h "$CONFIG_TAR" 2>/dev/null | cut -f1))"

# ── ৩) সিস্টেম কনফিগ (nginx/systemd) — git-এ নেই কিন্তু migrate-এ লাগবে ───────
SYS_TAR="$BACKUP_DIR/config/system_config_${DATE}.tar.gz"
tar -czf "$SYS_TAR" \
  --ignore-failed-read \
  /etc/nginx/sites-available/imas \
  /etc/systemd/system/imas-*.service \
  /etc/cron.d/imas-backup \
  /etc/freeradius/3.0/ \
  2>/dev/null || true
echo "[$(date '+%F %T')] backup ok: $SYS_TAR ($(du -h "$SYS_TAR" 2>/dev/null | cut -f1))"
