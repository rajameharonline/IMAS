# ════════════════════════════════════════════════════════════════════════════
# ISP-BNAS VoIP — MikroTik RouterOS port-forward rules
# ────────────────────────────────────────────────────────────────────────────
# কী: Asterisk VoIP সার্ভারে বাইরের (LTE/পাবলিক) ক্লায়েন্ট পৌঁছানোর জন্য dst-nat
#     + forward accept। এটা না থাকলে মোবাইল অ্যাপ SIP register করতে পারে না
#     (creds পোর্ট 443/nginx-এ পায়, কিন্তু WSS 8089 ব্লক → কল আসে না)।
#
# মান (পরিবর্তন হলে এখানে আপডেট করুন):
#   WAN/পাবলিক IP (duckdns roisp.duckdns.org যেটায় point করে) : 103.214.202.17
#   Asterisk সার্ভারের LAN IP                                   : 172.16.3.254
#
# পোর্ট ম্যাপ:
#   8089/tcp           → WSS (SIP registration + signaling)  ★ সবচেয়ে জরুরি
#   3478/udp+tcp       → TURN (coturn)
#   5349/tcp           → TURN TLS (turns:)
#   10000-20000/udp    → Asterisk RTP (অডিও)
#   49152-65535/udp    → coturn relay range (অডিও)
#
# কীভাবে বসাবেন: Winbox → New Terminal (অথবা SSH router), নিচের অংশ পুরোটা paste।
# ⚠️ Linux bash-এ নয় — এগুলো RouterOS command।
# ⚠️ forward chain-এর accept rule অবশ্যই drop rule-এর **উপরে** থাকতে হবে
#    (paste করার পর /ip firewall filter-এ Winbox দিয়ে উপরে drag করুন বা place-before দিন)।
# ════════════════════════════════════════════════════════════════════════════

# ─── DST-NAT (পাবলিক IP → সার্ভার) ─────────────────────────────────────────
# 1:1 ম্যাপিং — to-ports দেওয়া হয়নি (RouterOS মূল পোর্ট রাখে; range-এ to-ports দিলে error)।
/ip firewall nat
add chain=dstnat action=dst-nat protocol=tcp dst-address=103.214.202.17 dst-port=8089 to-addresses=172.16.3.254 comment="VoIP WSS (registration)"
add chain=dstnat action=dst-nat protocol=udp dst-address=103.214.202.17 dst-port=3478 to-addresses=172.16.3.254 comment="VoIP TURN udp"
add chain=dstnat action=dst-nat protocol=tcp dst-address=103.214.202.17 dst-port=3478 to-addresses=172.16.3.254 comment="VoIP TURN tcp"
add chain=dstnat action=dst-nat protocol=tcp dst-address=103.214.202.17 dst-port=5349 to-addresses=172.16.3.254 comment="VoIP TURN TLS"
add chain=dstnat action=dst-nat protocol=udp dst-address=103.214.202.17 dst-port=10000-20000 to-addresses=172.16.3.254 comment="Asterisk RTP"
add chain=dstnat action=dst-nat protocol=udp dst-address=103.214.202.17 dst-port=49152-65535 to-addresses=172.16.3.254 comment="coturn relay"

# ─── FORWARD FILTER (router-এর forward policy=drop হলে দরকার) ───────────────
# dst-nat-এর পরে filter translated dst-address (172.16.3.254) দেখে।
# ⚠️ এই rule-গুলো drop rule-এর উপরে রাখতে হবে।
/ip firewall filter
add chain=forward action=accept protocol=tcp dst-address=172.16.3.254 dst-port=8089 comment="VoIP WSS"
add chain=forward action=accept protocol=udp dst-address=172.16.3.254 dst-port=3478 comment="VoIP TURN udp"
add chain=forward action=accept protocol=tcp dst-address=172.16.3.254 dst-port=3478,5349 comment="VoIP TURN tcp"
add chain=forward action=accept protocol=udp dst-address=172.16.3.254 dst-port=10000-20000 comment="VoIP RTP"
add chain=forward action=accept protocol=udp dst-address=172.16.3.254 dst-port=49152-65535 comment="VoIP coturn relay"

# ─── (ঐচ্ছিক) HAIRPIN / NAT-loopback ───────────────────────────────────────
# শুধু দরকার যদি একই LAN/WiFi-এর ভেতরের ডিভাইস পাবলিক IP (103.214.202.17)-এ
# কানেক্ট করে। (ফোন LTE/মোবাইল ডেটায় থাকলে দরকার নেই।) LAN সাবনেট 172.16.0.0/16
# অনুযায়ী src-address মিলিয়ে নিন।
# /ip firewall nat
# add chain=srcnat action=masquerade protocol=tcp dst-address=172.16.3.254 dst-port=8089 src-address=172.16.0.0/16 comment="VoIP WSS hairpin"
# add chain=srcnat action=masquerade protocol=udp dst-address=172.16.3.254 dst-port=3478 src-address=172.16.0.0/16 comment="VoIP TURN hairpin"

# ─── যাচাই ─────────────────────────────────────────────────────────────────
# /ip firewall nat print where comment~"VoIP"
# /ip firewall filter print where comment~"VoIP"
# সার্ভারে (bash): AMI দিয়ে  pjsip show contacts  → client_<id> register হলে IP দেখা যাবে।
