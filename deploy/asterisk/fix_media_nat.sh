#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# VoIP no-audio fix — Asterisk media/NAT।
# সমস্যা: কল connect হয় কিন্তু কথা শোনা যায় না। কারণ Asterisk-এর SDP-তে media
# ঠিকানা unreachable: c=IN IP4 127.0.1.1 (hostname→loopback) + শুধু internal/docker
# host candidate, কোনো external/relay candidate নেই → RTP প্রবাহিত হয় না।
#
# এই স্ক্রিপ্ট (root):
#   1. pjsip.conf [transport-wss]-এ external_media_address/external_signaling_address
#      + local_net সেট করে (NAT-এর পেছনে public IP advertise করতে)।
#   2. rtp.conf-এ stunaddr সেট করে (srflx candidate gather)।
#   3. Asterisk reload করে।
#
# ⚠️ পূর্বশর্ত (এগুলো না থাকলে শুধু এই স্ক্রিপ্টে অডিও আসবে না):
#   - coturn চালু ও পৌঁছানো যায় (TURN relay)।
#   - MikroTik/firewall-এ RTP UDP 10000-20000 + TURN (3478/5349) → এই সার্ভারে forward।
#
# চালান:  sudo bash deploy/asterisk/fix_media_nat.sh [public_host_or_ip]
#         (না দিলে default: roisp.duckdns.org)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PUBLIC="${1:-roisp.duckdns.org}"
PJSIP=/etc/asterisk/pjsip.conf
RTP=/etc/asterisk/rtp.conf

[[ $EUID -eq 0 ]] || { echo "❌ root দরকার:  sudo bash $0 [public]"; exit 1; }
[[ -f "$PJSIP" ]] || { echo "❌ পাওয়া যায়নি: $PJSIP"; exit 1; }
[[ -f "$RTP"   ]] || { echo "❌ পাওয়া যায়নি: $RTP"; exit 1; }

TS=$(date +%Y%m%d_%H%M%S)
cp -a "$PJSIP" "${PJSIP}.bak.${TS}"
cp -a "$RTP"   "${RTP}.bak.${TS}"
echo "📦 ব্যাকআপ: ${PJSIP}.bak.${TS} , ${RTP}.bak.${TS}"

# ── pjsip.conf: [transport-wss]-এ external/local_net নিশ্চিত করি ───────────────
python3 - "$PJSIP" "$PUBLIC" <<'PYEOF'
import re, sys
path, pub = sys.argv[1], sys.argv[2]
src = open(path).read().splitlines()
out, in_wss, done = [], False, set()
want = {
    'external_media_address': f'external_media_address={pub}',
    'external_signaling_address': f'external_signaling_address={pub}',
}
local_nets = ['local_net=172.16.0.0/12','local_net=10.0.0.0/8','local_net=192.168.0.0/16']

def flush_extras(out):
    for k,v in want.items():
        if k not in done:
            out.append(v); done.add(k)
    # local_net (একবারই)
    if 'local_net' not in done:
        out.extend(local_nets); done.add('local_net')

for line in src:
    s = line.strip()
    # নতুন section বা #include শুরু → আগের wss সেকশনে বাকি লাইন যোগ করি
    # (#include-এর পরে যোগ করলে included endpoint section-এ ভুলভাবে লেগে যেত)
    if (s.startswith('[') or s.startswith('#include')) and in_wss:
        flush_extras(out); in_wss = False
    if s.startswith('[transport-wss]'):
        in_wss = True
        out.append(line); continue
    if in_wss:
        # কমেন্টেড/পুরনো external_* বা local_net বাদ দিয়ে আমাদেরটা বসাব
        m = re.match(r';?\s*(external_media_address|external_signaling_address)\s*=', s)
        if m:
            key = m.group(1)
            if key not in done:
                out.append(want[key]); done.add(key)
            continue
        if re.match(r';?\s*local_net\s*=', s):
            if 'local_net' not in done:
                out.extend(local_nets); done.add('local_net')
            continue
    out.append(line)

if in_wss:        # ফাইল wss সেকশনেই শেষ হলে
    flush_extras(out)

open(path,'w').write('\n'.join(out) + '\n')
print('🔧 pjsip.conf: external_media/signaling + local_net সেট →', pub)
PYEOF

# ── rtp.conf: stunaddr + icesupport নিশ্চিত করি ───────────────────────────────
python3 - "$RTP" "$PUBLIC" <<'PYEOF'
import re, sys
path, pub = sys.argv[1], sys.argv[2]
lines = open(path).read().splitlines()
out, in_gen, have_stun, have_ice = [], False, False, False
for line in lines:
    s = line.strip()
    if s.startswith('[') :
        if in_gen and not have_stun: out.append(f'stunaddr={pub}:3478')
        if in_gen and not have_ice:  out.append('icesupport=yes')
        in_gen = s.startswith('[general]')
        out.append(line); continue
    if in_gen:
        if re.match(r';?\s*stunaddr\s*=', s): out.append(f'stunaddr={pub}:3478'); have_stun=True; continue
        if re.match(r';?\s*icesupport\s*=', s): out.append('icesupport=yes'); have_ice=True; continue
    out.append(line)
if in_gen:
    if not have_stun: out.append(f'stunaddr={pub}:3478')
    if not have_ice:  out.append('icesupport=yes')
open(path,'w').write('\n'.join(out) + '\n')
print('🔧 rtp.conf: stunaddr + icesupport সেট →', pub)
PYEOF

# ── Asterisk reload ───────────────────────────────────────────────────────────
if command -v asterisk >/dev/null 2>&1; then
  asterisk -rx "module reload res_pjsip.so"        || true
  asterisk -rx "module reload res_rtp_asterisk.so" || true
  asterisk -rx "core reload"                        || true
  echo "✅ Asterisk reload হয়েছে।"
else
  echo "⚠️ asterisk CLI পাওয়া যায়নি — ম্যানুয়ালি reload করুন:  asterisk -rx 'core reload'"
fi

echo "✅ সম্পন্ন। এখন একটা আসল ফোন থেকে কল করে অডিও যাচাই করুন।"
echo "   নতুন কলের SDP-তে c=/candidate-এ public IP (${PUBLIC}) দেখা উচিত, 127.0.1.1 নয়।"
echo "   সমস্যা হলে ফেরত:  cp ${PJSIP}.bak.${TS} ${PJSIP} && cp ${RTP}.bak.${TS} ${RTP} && asterisk -rx 'core reload'"
