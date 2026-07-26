#!/bin/bash
# FreeRADIUS entrypoint — PostgreSQL reachable কিনা যাচাই করে, প্রথমবার হলে
# FreeRADIUS-এর নিজস্ব radcheck/radreply/... schema লোড করে, তারপর radiusd চালায়।
#
# গুরুত্বপূর্ণ: schema.sql-এর path Alpine freeradius-postgresql প্যাকেজের সংস্করণ
# অনুযায়ী বদলাতে পারে — প্রথম build-এর পর নিশ্চিত করুন:
#   docker compose run --rm freeradius find / -name schema.sql -path '*postgresql*'
# path না মিললে নিচের SCHEMA_PATH ভ্যারিয়েবল আপডেট করুন।
set -e

SCHEMA_PATH="${SCHEMA_PATH:-/etc/raddb/mods-config/sql/main/postgresql/schema.sql}"

echo "[freeradius-entrypoint] PostgreSQL (${RADIUS_DB_HOST}:${RADIUS_DB_PORT}) reachability check..."
for i in $(seq 1 15); do
    if PGPASSWORD="${RADIUS_DB_PASSWORD}" psql -h "${RADIUS_DB_HOST}" -p "${RADIUS_DB_PORT}" \
        -U "${RADIUS_DB_USER}" -d "${RADIUS_DB_NAME}" -c '\q' >/dev/null 2>&1; then
        echo "[freeradius-entrypoint] PostgreSQL reachable."
        break
    fi
    echo "[freeradius-entrypoint] waiting for PostgreSQL... ($i/15)"
    sleep 2
done

TABLE_EXISTS=$(PGPASSWORD="${RADIUS_DB_PASSWORD}" psql -h "${RADIUS_DB_HOST}" -p "${RADIUS_DB_PORT}" \
    -U "${RADIUS_DB_USER}" -d "${RADIUS_DB_NAME}" -tAc "SELECT to_regclass('public.radcheck')")

if [ -z "$TABLE_EXISTS" ]; then
    echo "[freeradius-entrypoint] radcheck টেবিল পাওয়া যায়নি — প্রথমবার FreeRADIUS schema লোড হচ্ছে..."
    if [ -f "$SCHEMA_PATH" ]; then
        PGPASSWORD="${RADIUS_DB_PASSWORD}" psql -h "${RADIUS_DB_HOST}" -p "${RADIUS_DB_PORT}" \
            -U "${RADIUS_DB_USER}" -d "${RADIUS_DB_NAME}" -f "$SCHEMA_PATH"
        echo "[freeradius-entrypoint] schema লোড সম্পন্ন।"
    else
        echo "[freeradius-entrypoint] ERROR: schema.sql পাওয়া যায়নি ${SCHEMA_PATH}-এ।" >&2
        echo "[freeradius-entrypoint] 'find / -name schema.sql -path *postgresql*' দিয়ে আসল path বের করে SCHEMA_PATH env var সেট করুন।" >&2
        exit 1
    fi
else
    echo "[freeradius-entrypoint] radcheck টেবিল আগে থেকেই আছে, schema লোড skip করা হলো।"
fi

exec "$@"
