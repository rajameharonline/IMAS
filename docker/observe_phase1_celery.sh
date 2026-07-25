#!/bin/bash
# Phase-1 Docker celery-worker/celery-beat cutover — read-only observation script।
# কিছুই restart/modify করে না। ম্যানুয়ালি চালানোর জন্য (cron/systemd-এ install করা হয়নি)।
#
# ব্যবহার: bash docker/observe_phase1_celery.sh
#
# Exit code non-zero হবে যদি:
#   - docker celery-worker চলমান না থাকে
#   - docker celery-beat চলমান না থাকে
#   - systemd isp-celery-beat active থাকে অবস্থায় docker celery-beat-ও Up (duplicate scheduler!)
#   - লগে traceback/exception/snmpwalk-not-found/0 CPE anomaly পাওয়া যায়

set -uo pipefail
cd /var/www/isp_bnas

EXIT_CODE=0
TS="$(date '+%Y-%m-%d %H:%M:%S')"

echo "================================================================"
echo "Phase-1 Celery Observation — ${TS}"
echo "================================================================"

echo ""
echo "--- docker compose ps ---"
docker compose ps 2>&1 | grep -v "px5\|y8"

echo ""
echo "--- systemd (পুরনো) celery সার্ভিসের অবস্থা ---"
# systemctl is-active ব্যর্থ (non-active) হলেও নিজেই "failed"/"inactive" প্রিন্ট করে —
# তাই আলাদা fallback দরকার নেই (fallback থাকলে ডাবল-প্রিন্ট হয়ে যেত)
SYSTEMD_CELERY=$(systemctl is-active isp-celery.service 2>/dev/null)
SYSTEMD_BEAT=$(systemctl is-active isp-celery-beat.service 2>/dev/null)
[[ -z "$SYSTEMD_CELERY" ]] && SYSTEMD_CELERY="unknown"
[[ -z "$SYSTEMD_BEAT" ]] && SYSTEMD_BEAT="unknown"
echo "isp-celery.service      : ${SYSTEMD_CELERY}"
echo "isp-celery-beat.service : ${SYSTEMD_BEAT}"

echo ""
echo "--- Docker worker/beat অবস্থা ---"
WORKER_STATUS=$(docker compose ps celery-worker --format '{{.State}}' 2>/dev/null || echo "missing")
BEAT_STATUS=$(docker compose ps celery-beat --format '{{.State}}' 2>/dev/null || echo "missing")
echo "docker celery-worker : ${WORKER_STATUS}"
echo "docker celery-beat   : ${BEAT_STATUS}"

if [[ "$WORKER_STATUS" != "running" ]]; then
    echo "❌ docker celery-worker চলছে না!"
    EXIT_CODE=1
fi
if [[ "$BEAT_STATUS" != "running" ]]; then
    echo "❌ docker celery-beat চলছে না!"
    EXIT_CODE=1
fi

echo ""
echo "--- Duplicate scheduler guard ---"
if [[ "$SYSTEMD_BEAT" == "active" && "$BEAT_STATUS" == "running" ]]; then
    echo "🚨 বিপজ্জনক: systemd isp-celery-beat.service active AND docker celery-beat Up — DUPLICATE SCHEDULER!"
    EXIT_CODE=2
else
    echo "✅ একটাই scheduler সক্রিয় (systemd beat: ${SYSTEMD_BEAT}, docker beat: ${BEAT_STATUS})"
fi

echo ""
echo "--- Worker log (শেষ ১০০ লাইন, task success/error filtered) ---"
docker compose logs --tail=100 celery-worker 2>&1 | grep -v "px5\|y8" | \
    grep -Ei "Task .*received|Task .*succeeded|Task .*failed|OLT auto-sync|Bridge table|error|traceback|exception|snmpwalk" | tail -25

echo ""
echo "--- Beat log (শেষ ১০০ লাইন, scheduler/error filtered) ---"
docker compose logs --tail=100 celery-beat 2>&1 | grep -v "px5\|y8" | \
    grep -Ei "Sending due task|error|traceback|exception" | tail -25

echo ""
echo "--- Data-quality anomaly check ---"
# সতর্কতা: "0 CPE MAC entries" plain grep দিয়ে "380 CPE MAC entries"-এর মতো লাইনেও
# false-positive ম্যাচ করে (substring match) — তাই -P lookbehind দিয়ে সত্যিকারের
# শূন্য (কোনো ডিজিট আগে নেই) নিশ্চিত করা হচ্ছে
ANOMALY=$(docker compose logs --tail=200 celery-worker 2>&1 | grep -v "px5\|y8" | \
    grep -Pci "snmpwalk.*not found|(?<!\d)0 CPE MAC entries|traceback \(most recent")
if [[ "$ANOMALY" -gt 0 ]]; then
    echo "🚨 সন্দেহজনক: snmpwalk-not-found বা 0-CPE anomaly বা traceback পাওয়া গেছে (${ANOMALY} বার)"
    EXIT_CODE=3
else
    echo "✅ কোনো data-quality anomaly পাওয়া যায়নি"
fi

echo ""
echo "--- MySQL/Redis/gunicorn সাম্প্রতিক error (শুধু error/fail/warn) ---"
sudo journalctl -u mysql -n 20 --no-pager 2>/dev/null | grep -iE "error|fail|warn" || echo "mysql: কোনো error নেই"
sudo journalctl -u redis-server -n 20 --no-pager 2>/dev/null | grep -iE "error|fail|warn" || echo "redis: কোনো error নেই"
sudo journalctl -u isp-gunicorn -n 20 --no-pager 2>/dev/null | grep -iE "error|fail|warn" || echo "gunicorn: কোনো error নেই"

echo ""
echo "================================================================"
echo "সারসংক্ষেপ: exit code ${EXIT_CODE} ($([[ $EXIT_CODE -eq 0 ]] && echo 'সব ঠিক আছে' || echo 'সমস্যা পাওয়া গেছে, উপরে দেখুন'))"
echo "================================================================"

exit "$EXIT_CODE"
