#!/bin/bash
# FreeRADIUS Configuration Fix — ISP BNAS
# চালানোর নিয়ম: sudo bash fix_freeradius_config.sh
# =========================================================

set -e
RADIUS_DIR="/etc/freeradius/3.0"
TS=$(date +%Y%m%d_%H%M%S)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  FreeRADIUS Configuration Fix — ISP BNAS            ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ─── 1. clients.conf backup ───────────────────────────────
CLIENTS="${RADIUS_DIR}/clients.conf"
echo "🔧 [1/4] clients.conf — BlastRADIUS fix..."

if [[ ! -f "${CLIENTS}" ]]; then
    echo "  ❌ ${CLIENTS} not found"
    exit 1
fi

cp "${CLIENTS}" "${CLIENTS}.bak.${TS}"
echo "  ✅ Backup: ${CLIENTS}.bak.${TS}"

python3 "${SCRIPT_DIR}/fix_clients_conf.py"

# ─── 2. SQL connection pool ───────────────────────────────
echo "🔧 [2/4] SQL module — connection pool..."
SQL="${RADIUS_DIR}/mods-enabled/sql"
if [[ -f "${SQL}" ]]; then
    cp "${SQL}" "${SQL}.bak.${TS}"
fi
python3 "${SCRIPT_DIR}/fix_sql_pool.py"

# ─── 3. Config validation ─────────────────────────────────
echo "🔧 [3/4] Config validation..."
if freeradius -Cx -lstdout 2>&1 | grep -qi "^Error\|^Fatal"; then
    echo "  ❌ Config error — rolling back..." >&2
    cp "${CLIENTS}.bak.${TS}" "${CLIENTS}"
    [[ -f "${SQL}.bak.${TS}" ]] && cp "${SQL}.bak.${TS}" "${SQL}"
    echo "  🔄 Rolled back"
    exit 1
fi
echo "  ✅ Config OK"

# ─── 4. Restart ───────────────────────────────────────────
echo "🔧 [4/4] FreeRADIUS restart..."
systemctl restart freeradius
sleep 4

if systemctl is-active --quiet freeradius; then
    echo "  ✅ FreeRADIUS চলছে"
else
    echo "  ❌ Restart failed — rolling back..."
    cp "${CLIENTS}.bak.${TS}" "${CLIENTS}"
    [[ -f "${SQL}.bak.${TS}" ]] && cp "${SQL}.bak.${TS}" "${SQL}"
    systemctl restart freeradius
    exit 1
fi

# ─── Test ─────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════"
echo "🧪 Authentication Test:"
radtest 1001 1234 localhost 0 010230 2>&1 | \
    grep -E "Access-Accept|Access-Reject|No reply|Acct-Interim|Mikrotik-Group|Framed-Pool"
echo ""
echo "✅ সম্পন্ন!"
