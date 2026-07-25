# VoIP Phase 1 — Asterisk + coturn Deployment

ISP-BNAS VoIP (app-to-app কলিং)-এর server-side setup। সম্পূর্ণ প্রসঙ্গ: [`VOIP_PLAN.md`](../../VOIP_PLAN.md)।

> এই bundle এক কমান্ডে চালানোর মতো, কিন্তু `sudo` লাগে বলে আপনাকে নিজে চালাতে হবে।

## ⚠️ গুরুত্বপূর্ণ: কেন realtime/ODBC ব্যবহার করা হয়নি

এই সার্ভারে Ubuntu **`mysql-server-8.4` প্যাকেজে `Conflicts: mariadb-common`**, আর Asterisk-এর ODBC
driver `odbc-mariadb` → `libmariadb3` → `mariadb-common`। ফলে `odbc-mariadb` ইনস্টল করলে apt
**`mysql-server` remove করে দেয় → প্রোডাকশন DB ডাউন** (একবার ঘটেছিল, ডেটা purge হয়নি বলে বাঁচা গেছে)।
apt-এ MySQL-এর নিজস্ব ODBC driver-ও নেই।

**তাই realtime বাদ → file-based PJSIP provisioning:** Django প্রতিটি SIP endpoint-কে একটি `.conf`
file হিসেবে `/etc/asterisk/pjsip_isp.d/`-এ লেখে (gunicorn user `isp`), তারপর **AMI দিয়ে `pjsip reload`**
করে (সক্রিয় কল/registration বিঘ্নিত হয় না)। কোনো আলাদা DB, ODBC, বা mariadb প্যাকেজ লাগে না।

## এক কমান্ডে install

```bash
cd /var/www/isp_bnas
sudo bash deploy/asterisk/install.sh roisp.duckdns.org
```

idempotent — আবার চালানো নিরাপদ। **কোনো MySQL DB তৈরি/পরিবর্তন করে না।**

## script যা করে (১০ ধাপ)

1. `asterisk`, `coturn`, `certbot` install — **`odbc-mariadb` নেই**; তবু গার্ড আছে: install কোনো DB
   server remove করতে চাইলে বাতিল হয়।
2. ARI password, AMI password, TURN secret **generate** (hardcode নয়)
3. PJSIP include dir `/etc/asterisk/pjsip_isp.d/` (owner `isp`, group `asterisk`, setgid `2775`)
4. **Let's Encrypt** cert (`certbot --nginx`) → `/etc/asterisk/keys/` (renewal hook সহ)
5. Asterisk config (`pjsip/http/ari/rtp/extensions/manager`) — secrets বসিয়ে `/etc/asterisk/`
6. coturn config → `/etc/turnserver.conf` + enable
7. project **`.env`** আপডেট (`VOIP_ENABLED=True` + ARI/AMI/TURN/PJSIP_DIR keys)
8. `asterisk` ও `coturn` service চালু
9. `isp-gunicorn` restart + **বিদ্যমান client/agent endpoint provision** (`manage.py voip_provision_all`)
10. যাচাই কমান্ড + firewall reminder প্রিন্ট

## install-এর পরে — যাচাই
```bash
sudo asterisk -rx 'pjsip show endpoints'  # provisioned client_*/agent_* দেখাবে
sudo asterisk -rx 'http show status'      # 8089 TLS bound
sudo asterisk -rx 'manager show users'    # AMI user
ls /etc/asterisk/pjsip_isp.d/             # প্রতি endpoint-এর .conf
```
> নতুন client তৈরি হলে Django signal স্বয়ংক্রিয়ভাবে `.conf` লেখে + `pjsip reload` করে।
> সব আবার provision করতে: `sudo -u isp bash -c 'cd /var/www/isp_bnas && source venv/bin/activate && python manage.py voip_provision_all'`

## Firewall (গুরুত্বপূর্ণ — VOIP_PLAN.md Section D)

| পোর্ট | দিক | কারণ |
|---|---|---|
| `8089/tcp` | পাবলিক | WSS (WebRTC signaling) |
| `3478/udp,tcp` `5349/tcp` | পাবলিক | TURN / TURN-TLS |
| `49152-65535/udp` | পাবলিক | TURN relay |
| `10000-20000/udp` | পাবলিক | Asterisk RTP media |
| `8088` (ARI) , `5038` (AMI) | **localhost-only** | Django লোকালি কথা বলে — বাইরে নয় |
| `5060` (plain SIP) | **বন্ধ** | app-to-app-এ দরকার নেই (attack surface সরানো) |

## NAT (Asterisk private IP-এর পেছনে থাকলে)

ALLOWED_HOSTS-এ `172.16.3.254` আছে → সার্ভার NAT-এর পেছনে হতে পারে। তাহলে:
- `/etc/asterisk/pjsip.conf` → `transport-wss`-এ `external_media_address` ও `external_signaling_address` = পাবলিক IP।
- `/etc/turnserver.conf` → `external-ip=<পাবলিক IP>`।
- রাউটারে উপরের পাবলিক পোর্টগুলো forward করুন।

## পরের ধাপ
Phase 3 — ARI listener (`voip/services/ari_client.py` + `manage.py voip_ari_listener`) ও
Phase 4 — React SIP.js softphone। দেখুন [`VOIP_PLAN.md`](../../VOIP_PLAN.md)।
