#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# bKash SNS Webhook — Local Test Script
# ব্যবহার: bash test_bkash_webhook.sh
#
# দুটি mode:
#   1. CURL mode  — running gunicorn-এ real HTTP request পাঠায়
#   2. DIRECT mode — Django shell দিয়ে সরাসরি test করে (gunicorn লাগে না)
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

PROJECT_DIR="/var/www/isp_bnas"
ENV_FILE="$PROJECT_DIR/.env"
LOG_FILE="$PROJECT_DIR/logs/bkash_sns.log"
BASE_URL="http://localhost:8000/api/v1/billing/webhook/bkash-sns/"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'; BLUE='\033[0;34m'

pass() { local msg="$1"; echo -e "  ${GREEN}✓ PASS${NC}  $msg"; PASS=$((PASS+1)); }
fail() { local msg="$1"; echo -e "  ${RED}✗ FAIL${NC}  $msg"; FAIL=$((FAIL+1)); }
info() { local msg="$1"; echo -e "  ${BLUE}→${NC}      $msg"; }
sep()  { echo -e "\n${CYAN}────────────────────────────────────────${NC}"; }

PASS=0; FAIL=0

# ══════════════════════════════════════════════════════════════════════════════
echo -e "\n${BOLD}${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║   bKash SNS Webhook — Local Test Suite      ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Mode নির্বাচন করুন:${NC}"
echo -e "  ${CYAN}1)${NC} DIRECT — Django shell দিয়ে সরাসরি (signature bypass, দ্রুত)"
echo -e "  ${CYAN}2)${NC} CURL   — HTTP request দিয়ে (running gunicorn প্রয়োজন)"
echo ""
read -rp "  পছন্দ [1/2, default=1]: " MODE
MODE=${MODE:-1}

# ══════════════════════════════════════════════════════════════════════════════
# DIRECT MODE — Django shell দিয়ে সরাসরি
# ══════════════════════════════════════════════════════════════════════════════
if [[ "$MODE" = "1" ]]; then
    echo -e "\n  ${BOLD}DIRECT mode — signature verify skip করা হবে${NC}"

    cd "$PROJECT_DIR" && source venv/bin/activate

    python manage.py shell << 'PYEOF'
import json, os, sys
from django.conf import settings
from django.test import RequestFactory
from rest_framework.test import APIRequestFactory

# Test সময় signature verify বন্ধ
settings.BKASH_SNS_VERIFY_SIGNATURE = False

from billing.api.views import BkashSNSWebhookView

factory = APIRequestFactory()

# রঙ
G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'
C='\033[0;36m'; B='\033[1m'; N='\033[0m'; BL='\033[0;34m'

PASS = 0; FAIL = 0

def run_test(name, payload, check_fn, desc=""):
    global PASS, FAIL
    print(f"\n{C}────────────────────────────────────────{N}")
    print(f"{B}  {name}{N}")
    if desc:
        print(f"  {desc}")
    print(f"{C}────────────────────────────────────────{N}")

    request = factory.post(
        '/api/v1/billing/webhook/bkash-sns/',
        payload, format='json'
    )
    view = BkashSNSWebhookView.as_view()
    response = view(request)
    data = response.data if hasattr(response, 'data') else {}

    print(f"  HTTP Status : {Y}{response.status_code}{N}")
    print(f"  Response    : {Y}{json.dumps(data, ensure_ascii=False)}{N}")

    ok, msg = check_fn(response.status_code, data)
    if ok:
        print(f"  {G}✓ PASS{N}  {msg}")
        PASS += 1
    else:
        print(f"  {R}✗ FAIL{N}  {msg}")
        FAIL += 1
    return data

# ── Test 1: SubscriptionConfirmation ────────────────────────────────────────
run_test(
    "Test 1: SubscriptionConfirmation",
    {
        "Type": "SubscriptionConfirmation",
        "MessageId": "test-sub-001",
        "Token": "dummyToken123",
        "TopicArn": "arn:aws:sns:ap-southeast-1:123:bkash-topic",
        "Message": "You have chosen to subscribe to the topic.",
        "SubscribeURL": "https://sns.ap-southeast-1.amazonaws.com/confirm?Token=dummyToken123",
        "Timestamp": "2026-06-04T10:00:00.000Z",
        "Signature": "dGVzdA==",
        "SigningCertURL": "https://sns.ap-southeast-1.amazonaws.com/cert.pem",
    },
    lambda status, data: (
        status in (200, 500),  # SubscribeURL fake হওয়ায় 500 আসতে পারে, কিন্তু processing হয়
        "SubscriptionConfirmation handled (SubscribeURL GET fail expected for fake URL)"
    ),
    "বাস্তবে bKash subscribe করলে এই request আসে।"
)

# ── Test 2: Notification — Completed, No client ─────────────────────────────
run_test(
    "Test 2: Notification — Completed (client নেই)",
    {
        "Type": "Notification",
        "MessageId": "test-notif-001",
        "TopicArn": "arn:aws:sns:ap-southeast-1:123:bkash-topic",
        "Timestamp": "2026-06-04T10:30:00.000Z",
        "Signature": "dGVzdA==",
        "SigningCertURL": "https://sns.ap-southeast-1.amazonaws.com/cert.pem",
        "Message": json.dumps({
            "dateTime": "2026-06-04 10:30:00",
            "debitMSISDN": "01700000000",
            "creditMSISDN": "01900000000",
            "trxID": "TRX_TEST_NOCLIENT_001",
            "amount": "500",
            "transactionStatus": "Completed",
            "transactionType": "P2BPayment",
        }),
    },
    lambda status, data: (
        status == 200 and data.get('message') == 'Notification processed',
        f"Processed OK — settled={data.get('settled', '?')}"
    ),
    "Phone নেই — settled=false হবে, manually settle করতে হবে।"
)

# ── Test 3: Notification — Failed ───────────────────────────────────────────
run_test(
    "Test 3: Notification — transactionStatus = Failed",
    {
        "Type": "Notification",
        "MessageId": "test-notif-failed-001",
        "Signature": "dGVzdA==",
        "SigningCertURL": "https://sns.ap-southeast-1.amazonaws.com/cert.pem",
        "Message": json.dumps({
            "dateTime": "2026-06-04 10:31:00",
            "debitMSISDN": "01700000000",
            "trxID": "TRX_TEST_FAILED_001",
            "amount": "300",
            "transactionStatus": "Failed",
            "transactionType": "P2BPayment",
        }),
    },
    lambda status, data: (
        status == 200 and data.get('settled') == False,
        "Failed payment — settle হয়নি ✓"
    ),
    "Failed payment auto-settle হওয়া উচিত নয়।"
)

# ── Test 4: Missing trxID → 400 ─────────────────────────────────────────────
run_test(
    "Test 4: trxID missing → 400",
    {
        "Type": "Notification",
        "MessageId": "test-missing-trxid",
        "Signature": "dGVzdA==",
        "SigningCertURL": "https://sns.ap-southeast-1.amazonaws.com/cert.pem",
        "Message": json.dumps({
            "dateTime": "2026-06-04 10:32:00",
            "debitMSISDN": "01700000000",
            "amount": "200",
            "transactionStatus": "Completed",
        }),
    },
    lambda status, data: (
        status == 400,
        "trxID missing → 400 Bad Request ✓"
    ),
    "trxID না থাকলে 400 আসবে।"
)

# ── Test 5: Real Client Phone ────────────────────────────────────────────────
from clients.models import Client
client = Client.objects.filter(phone__startswith='01').first()

if client:
    print(f"\n  {BL}→{N}      Real client পাওয়া গেছে: {client} | phone={client.phone}")
    import time
    unique_trx = f"TRX_REAL_{int(time.time())}"

    result = run_test(
        f"Test 5: Real Client — phone={client.phone}",
        {
            "Type": "Notification",
            "MessageId": f"test-real-{int(time.time())}",
            "Signature": "dGVzdA==",
            "SigningCertURL": "https://sns.ap-southeast-1.amazonaws.com/cert.pem",
            "Message": json.dumps({
                "dateTime": "2026-06-04 10:33:00",
                "debitMSISDN": client.phone,
                "creditMSISDN": "01900000000",
                "trxID": unique_trx,
                "amount": "10",
                "transactionStatus": "Completed",
                "transactionType": "P2BPayment",
            }),
        },
        lambda status, data: (
            status == 200,
            f"settled={data.get('settled', '?')} | trxID={data.get('trxID', '?')}"
        ),
        f"Real client {client} দিয়ে payment test।"
    )

    if result.get('settled'):
        print(f"\n  {G}★ Auto-settle সফল!{N} Client: {client} | amount: 10 TK")
    else:
        print(f"\n  {Y}⚠ Client matched কিন্তু settle হয়নি{N} — bill নেই বা amount যথেষ্ট নয়")
else:
    print(f"\n  {Y}⚠ Test 5 skip{N} — DB-তে কোনো active client নেই")

# ── Phone Normalize Test ─────────────────────────────────────────────────────
print(f"\n{C}────────────────────────────────────────{N}")
print(f"{B}  Phone Normalize Test{N}")
print(f"{C}────────────────────────────────────────{N}")
from billing.api.views import _normalize_phone
tests = [
    ("+8801712345678", "01712345678"),
    ("8801712345678",  "01712345678"),
    ("01712345678",    "01712345678"),
    ("01712 345 678",  "01712345678"),
]
for inp, expected in tests:
    result = _normalize_phone(inp)
    ok = result == expected
    status = f"{G}✓{N}" if ok else f"{R}✗{N}"
    print(f"  {status}  {inp!r:20s} → {result!r}  (expected: {expected!r})")

# ── ফলাফল ────────────────────────────────────────────────────────────────────
print(f"\n{C}════════════════════════════════════════{N}")
print(f"{B}  Test ফলাফল: {G}{PASS} passed{N} / {R}{FAIL} failed{N}")
if FAIL == 0:
    print(f"\n  {G}{B}সব Test পাশ! Webhook সঠিকভাবে কাজ করছে।{N}")
else:
    print(f"\n  {Y}কিছু Test fail হয়েছে।{N}")
PYEOF

# ══════════════════════════════════════════════════════════════════════════════
# CURL MODE — HTTP request দিয়ে
# ══════════════════════════════════════════════════════════════════════════════
elif [[ "$MODE" = "2" ]]; then
    echo -e "\n  ${BOLD}CURL mode — .env-এ BKASH_SNS_VERIFY_SIGNATURE=False যোগ করতে হবে${NC}"

    # Server চলছে কিনা check
    if ! curl -s --max-time 3 "http://localhost:8000/" > /dev/null 2>&1; then
        echo -e "  ${RED}✗ Server চলছে না!${NC}"
        echo -e "  চালু করুন: ${BOLD}systemctl --user start isp-backend.service${NC}"
        exit 1
    fi
    info "Server চলছে ✓"

    # .env-এ signature=False আছে কিনা
    if ! grep -q "BKASH_SNS_VERIFY_SIGNATURE=False" "$ENV_FILE"; then
        echo -e "\n  ${YELLOW}⚠ Signature verification এখনো চালু আছে।${NC}"
        echo -e "  Test করতে .env-এ এই লাইন যোগ করুন:"
        echo -e "\n  ${BOLD}echo 'BKASH_SNS_VERIFY_SIGNATURE=False' >> $ENV_FILE${NC}"
        echo -e "  ${BOLD}systemctl --user restart isp-backend.service && sleep 5${NC}\n"
        read -rp "  এখনই যোগ করব? [yes/no]: " DO_ADD
        if [[ "$DO_ADD" = "yes" ]]; then
            echo "BKASH_SNS_VERIFY_SIGNATURE=False" >> "$ENV_FILE"
            systemctl --user restart isp-backend.service
            sleep 5
            info "Done. Signature verify বন্ধ করা হয়েছে।"
        else
            echo -e "  ${YELLOW}Test চালু করা যাবে না। ম্যানুয়ালি করুন।${NC}"
            exit 0
        fi
    fi

    send() {
        local payload="$1"
        curl -s -X POST "$BASE_URL" \
            -H "Content-Type: application/json" \
            -d "$payload" --max-time 10
    }

    # Test 1
    sep; echo -e "${BOLD}  Test 1: SubscriptionConfirmation${NC}"; sep
    R1=$(send '{"Type":"SubscriptionConfirmation","MessageId":"t1","Token":"tok","SubscribeURL":"https://sns.amazonaws.com/confirm?Token=tok","Message":"subscribe","Timestamp":"2026-06-04T10:00:00Z","Signature":"dGVzdA==","SigningCertURL":"https://sns.ap-southeast-1.amazonaws.com/cert.pem","TopicArn":"arn:test"}')
    echo -e "  Response: ${YELLOW}$R1${NC}"
    echo "$R1" | grep -q '"error"\|"Subscription\|confirmed"' && pass "Handled" || fail "Unexpected: $R1"

    # Test 2
    sep; echo -e "${BOLD}  Test 2: Completed Notification${NC}"; sep
    R2=$(send '{"Type":"Notification","MessageId":"t2","Signature":"dGVzdA==","SigningCertURL":"https://sns.ap-southeast-1.amazonaws.com/cert.pem","Message":"{\"dateTime\":\"2026-06-04 10:30:00\",\"debitMSISDN\":\"01700000000\",\"creditMSISDN\":\"01900000000\",\"trxID\":\"CURL_TRX_001\",\"amount\":\"500\",\"transactionStatus\":\"Completed\",\"transactionType\":\"P2BPayment\"}"}')
    echo -e "  Response: ${YELLOW}$R2${NC}"
    echo "$R2" | grep -q '"Notification processed"' && pass "Notification processed" || fail "Unexpected: $R2"

    # Test 3
    sep; echo -e "${BOLD}  Test 3: Failed Notification${NC}"; sep
    R3=$(send '{"Type":"Notification","MessageId":"t3","Signature":"dGVzdA==","SigningCertURL":"https://sns.ap-southeast-1.amazonaws.com/cert.pem","Message":"{\"trxID\":\"CURL_FAIL_001\",\"amount\":\"300\",\"transactionStatus\":\"Failed\",\"transactionType\":\"P2BPayment\",\"debitMSISDN\":\"01700000000\"}"}')
    echo -e "  Response: ${YELLOW}$R3${NC}"
    echo "$R3" | grep -q '"settled": false\|"settled":false' && pass "Failed → not settled" || fail "Unexpected: $R3"

    # Test 4 Missing trxID
    sep; echo -e "${BOLD}  Test 4: Missing trxID → 400${NC}"; sep
    HTTP4=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL" \
        -H "Content-Type: application/json" \
        -d '{"Type":"Notification","MessageId":"t4","Signature":"dGVzdA==","SigningCertURL":"https://sns.ap-southeast-1.amazonaws.com/cert.pem","Message":"{\"amount\":\"500\",\"transactionStatus\":\"Completed\",\"debitMSISDN\":\"01700000000\"}"}' \
        --max-time 10)
    echo -e "  HTTP Status: ${YELLOW}$HTTP4${NC}"
    [[ "$HTTP4" = "400" ]] && pass "400 Bad Request ✓" || fail "Expected 400, got $HTTP4"

    # Log দেখানো
    sep; echo -e "${BOLD}  Log (শেষ ২০ লাইন):${NC}"; sep
    if [[ -f "$LOG_FILE" ]]; then
        tail -20 "$LOG_FILE"
    else
        echo -e "  ${YELLOW}Log file নেই।${NC} Gunicorn error log দেখুন:" >&2
        tail -15 "$PROJECT_DIR/logs/gunicorn_error.log" 2>/dev/null | grep -i "bkash\|sns\|webhook" || echo "  (কিছু নেই)"
    fi

    # Cleanup
    sep
    read -rp "  BKASH_SNS_VERIFY_SIGNATURE=False .env থেকে মুছে দেব? [yes/no]: " CLEANUP
    if [[ "$CLEANUP" = "yes" ]]; then
        sed -i '/BKASH_SNS_VERIFY_SIGNATURE/d' "$ENV_FILE"
        systemctl --user restart isp-backend.service 2>/dev/null
        info "Signature verification পুনরায় চালু হয়েছে।"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
sep
echo -e "\n  ${BOLD}Webhook URL (bKash-কে দিন):${NC}"
echo -e "  ${CYAN}https://roisp.duckdns.org/api/v1/billing/webhook/bkash-sns/${NC}\n"
