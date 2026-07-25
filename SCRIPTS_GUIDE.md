# ISP-BNAS — সব Script ফাইলের গাইড (বাংলায়)

> এই ডকুমেন্ট প্রজেক্টের প্রতিটা `.sh` (shell script) ফাইল কী কাজ করে, কখন/কীভাবে
> চালাতে হয়, এবং কোনগুলোর মধ্যে ওভারল্যাপ/সম্পর্ক আছে — তা সহজ বাংলায় ব্যাখ্যা করে।
> কোনো প্রোগ্রামিং জ্ঞান ছাড়াই এই ডকুমেন্ট পড়ে বোঝা উচিত "কোন কাজে কোন script লাগবে"।
>
> **নিয়ম:** যেকোনো script চালানোর আগে বুঝে নিন এটা কী পরিবর্তন করবে। যেগুলোতে
> "⚠️ Downtime" লেখা আছে, সেগুলো production-এ কয়েক সেকেন্ডের জন্য সার্ভিস বন্ধ
> করতে পারে — ব্যস্ত সময়ে না চালানোই ভালো।

---

## ১. সবচেয়ে গুরুত্বপূর্ণ — মূল ইনস্টলার

### `install.sh` (root)
**কী করে:** নতুন মেশিনে পুরো ISP-BNAS সিস্টেম **এক কমান্ডে** ইনস্টল করে — MySQL,
FreeRADIUS, Redis, nginx, Asterisk (VoIP), Docker Phase-1 (django-app/celery-worker/
celery-beat), SSL সার্টিফিকেট — সবকিছু। এটাই এই প্রজেক্টের **সবচেয়ে গুরুত্বপূর্ণ**
script — বাকি অনেক script (`setup_https.sh`, `deploy/asterisk/install.sh`)
এর ভেতর থেকেই call হয়, আলাদাভাবে duplicate করা হয়নি।

**কখন ব্যবহার করবেন:**
- **নতুন মেশিনে fresh install করতে:** `sudo bash install.sh` (প্রশ্নের উত্তর দিন, বাকি সব স্বয়ংক্রিয়)
- **পুরনো মেশিন থেকে backup নিতে (migration-এর প্রথম ধাপ):** `sudo bash install.sh backup`
- **backup থেকে নতুন মেশিনে সব ফিরিয়ে আনতে:** `sudo bash install.sh` চালিয়ে backup file-এর path দিন
- **প্রতিদিনের সার্ভিস ম্যানেজমেন্ট:**
  - `sudo bash install.sh status` — সব সার্ভিস চলছে কিনা দেখুন
  - `sudo bash install.sh restart` — সব restart করুন
  - `sudo bash install.sh logs` — লগ দেখুন
  - `sudo bash install.sh update` — GitHub থেকে নতুন কোড এনে আপডেট করুন
  - `sudo bash install.sh radius-fix` — RADIUS-এর common সমস্যা ঠিক করুন

**গুরুত্বপূর্ণ:** এই script Docker-কে primary ধরে (`nginx → Docker django-app:8001`),
পুরনো systemd (`isp-gunicorn` ইত্যাদি) idle অবস্থায় রোলব্যাক safety-net হিসেবে থেকে যায়।

---

## ২. HTTPS / Domain সেটআপ

### `setup_https.sh` (root)
**কী করে:** একটা ডোমেইনের জন্য Let's Encrypt SSL সার্টিফিকেট ইস্যু করে ও nginx-কে
HTTPS-এর জন্য কনফিগার করে — DNS চেক, security header (HSTS), `.env`-এর
`ALLOWED_HOSTS`/`CSRF_TRUSTED_ORIGINS` আপডেট, ও auto-renewal সেটআপ সহ।

**ব্যবহার:** `sudo bash setup_https.sh roisp.duckdns.org`

**সম্পর্ক:** `install.sh`-এর SSL ধাপ থেকে **স্বয়ংক্রিয়ভাবে call হয়** — আলাদা করে
এটা চালানোর দরকার নেই যদি `install.sh` দিয়ে ইনস্টল করেন। শুধু domain বদলে
নতুন সার্টিফিকেট লাগলে সরাসরি চালান।

### `change_domain.sh` (root)
**কী করে:** এটা `setup_https.sh`-এর মতো না — এটা **বিদ্যমান** ডোমেইনকে **নতুন**
ডোমেইনে বদলায় (যেমন কেউ `oldsite.com` থেকে `newsite.com`-এ সরে যেতে চাইলে)।
`.env`, `config/settings.py`, nginx config — সব জায়গায় পুরনো ডোমেইন খুঁজে নতুনটা
বসায়, ব্যাকআপ রাখে (`$PROJECT_DIR/.domain_backup`)।

**ব্যবহার:** `bash change_domain.sh` (ইন্টারেক্টিভ — জিজ্ঞেস করবে)

**⚠️ লক্ষণীয়:** ডোমেইন বদলানোর পর নতুন ডোমেইনের জন্য SSL লাগবে — `setup_https.sh`
দিয়ে সেটা আলাদাভাবে করতে হবে, `change_domain.sh` নিজে SSL ইস্যু করে না।

---

## ৩. FreeRADIUS সমস্যা সমাধান

### `scripts/fix_freeradius_config.sh` (+ `fix_clients_conf.py`, `fix_sql_pool.py`)
**কী করে:** FreeRADIUS-এর দুটো নির্দিষ্ট, পরিচিত সমস্যা ঠিক করে:
1. `clients.conf`-এ BlastRADIUS নিরাপত্তা ফিক্স প্রয়োগ করে
2. SQL module-এর connection pool কনফিগ ঠিক করে

কনফিগ ভ্যালিডেট করে, ভুল হলে **স্বয়ংক্রিয়ভাবে ব্যাকআপ থেকে rollback** করে।

**ব্যবহার:** `sudo bash scripts/fix_freeradius_config.sh`

**সম্পর্ক `install.sh radius-fix`-এর সাথে:** এই দুটো **আলাদা সমস্যার** জন্য —
`install.sh radius-fix` করে index/cleanup/session-timeout-জাতীয় routine
maintenance, আর এই script করে BlastRADIUS/SQL-pool-এর মতো নির্দিষ্ট config bug fix।
প্রয়োজনে দুটোই আলাদাভাবে চালানো যায়, একটা আরেকটার বদলি না।

---

## ৪. VoIP (Asterisk) সেটআপ ও সমস্যা সমাধান

### `deploy/asterisk/install.sh`
**কী করে:** সম্পূর্ণ VoIP সিস্টেম সেটআপ করে — Asterisk, coturn (TURN server),
PJSIP endpoint কনফিগারেশন, AMI/ARI secret generate, TLS সার্টিফিকেট,
`.env`-এ VoIP key লেখা। **নিরাপত্তা গার্ড আছে** — MySQL/MariaDB সার্ভার remove
হওয়ার ঝুঁকি থাকলে ইনস্টল বন্ধ করে দেয় (আগে একবার প্রায় ঘটেছিল)। বারবার চালালেও
নিরাপদ (idempotent)।

**ব্যবহার:** `sudo bash deploy/asterisk/install.sh roisp.duckdns.org`
(ডোমেইন না দিলে ডিফল্ট `roisp.duckdns.org`)

**সম্পর্ক:** `install.sh`-এর Asterisk ধাপ থেকে **স্বয়ংক্রিয়ভাবে call হয়**।

### `deploy/asterisk/coturn/setup_coturn.sh`
**কী করে:** শুধু coturn (TURN relay server) ঠিক করে — যখন coturn বন্ধ থাকে বা
`turnserver.conf`-এ secret বসানো হয়নি, ফলে NAT-এর পেছনের ফোনে (mobile data)
কল কানেক্ট হয় কিন্তু **অডিও আসে না**।

**ব্যবহার:** `sudo bash deploy/asterisk/coturn/setup_coturn.sh`

### `deploy/asterisk/fix_media_nat.sh`
**কী করে:** VoIP-এ "কল কানেক্ট হয় কিন্তু কথা শোনা যায় না" সমস্যার একটা ভিন্ন
কারণ ঠিক করে — Asterisk-এর SDP media address ভুলভাবে `127.0.1.1` (internal/loopback)
সেট থাকলে, বা external/relay candidate না থাকলে।

**ব্যবহার:** `sudo bash deploy/asterisk/fix_media_nat.sh`

**তিনটার মধ্যে পার্থক্য:** `install.sh`/`deploy/asterisk/install.sh` = প্রথমবার
সম্পূর্ণ সেটআপ। `setup_coturn.sh` ও `fix_media_nat.sh` = অডিও-না-আসা সমস্যার
**দুইটা ভিন্ন সম্ভাব্য কারণ**-এর জন্য পরে ব্যবহার করার troubleshooting script —
প্রথমে `fix_media_nat.sh` চেষ্টা করুন, তাতেও না হলে `setup_coturn.sh`।

---

## ৫. Docker Phase-1 (django-app/celery) পরিচালনা

> এই সব script `docker/` ফোল্ডারে — বিস্তারিত `docker/PHASE1_DOCKER_RUNBOOK.md`-এও আছে।

### `docker/deploy.sh`
**কী করে:** GitHub-এ নতুন কোড push হলে (GitHub Actions দিয়ে) অথবা ম্যানুয়ালি
চালালে — নতুন কোড দিয়ে Docker image rebuild করে ও কন্টেইনার আপডেট করে। কোনো
`git reset --hard` ব্যবহার করে না (uncommitted change থাকলে থেমে যায়, ধ্বংস করে না)।

**ব্যবহার:** `bash docker/deploy.sh`

### `docker/entrypoint.sh`
**কী করে:** এটা আপনি সরাসরি চালাবেন না — এটা Docker container **নিজে থেকে** চালু
হওয়ার সময় ব্যবহার করে (Dockerfile-এ `ENTRYPOINT` হিসেবে সেট করা)। শুধু MySQL/Redis
reachable কিনা চেক করে, তারপর মূল কমান্ড (gunicorn/celery) চালায়। **স্বয়ংক্রিয়ভাবে
migration চালায় না** — সেটা ইচ্ছাকৃত, migration সবসময় ম্যানুয়ালি করতে হয়।

### `docker/nginx_option1_upstream_patch.sh`
**কী করে:** nginx-এর Django upstream পোর্ট বদলায় (systemd gunicorn `:8000` ↔
Docker django-app `:8001`) — শুধু এই একটা লাইন বদলায়, বাকি nginx config
(SSL/walled-garden ইত্যাদি) অক্ষত থাকে। Cutover বা rollback-এর জন্য।

**ব্যবহার:** `sudo bash docker/nginx_option1_upstream_patch.sh` (rollback করতে `--rollback` যোগ করুন)

### `docker/observe_phase1_celery.sh`
**কী করে:** **শুধু পড়ে, কিছুই পরিবর্তন করে না** — Docker celery-worker/celery-beat
ঠিকমতো চলছে কিনা, duplicate scheduler আছে কিনা, ডেটা ঠিক আসছে কিনা — সব চেক করে
রিপোর্ট দেয়। নিয়মিত স্বাস্থ্য-পরীক্ষার জন্য নিরাপদ, বারবার চালানো যায়।

**ব্যবহার:** `bash docker/observe_phase1_celery.sh`

### `docker/rotate_redis_password.sh`
**কী করে:** Redis-এর পাসওয়ার্ড বদলে দেয় — `redis.conf`, `.env`, `.env.docker`
তিন জায়গাতেই sync করে, সব ক্লায়েন্ট (systemd + Docker) restart করে। পাসওয়ার্ড
কখনো স্ক্রিনে print হয় না।

**ব্যবহার:** `sudo bash docker/rotate_redis_password.sh`
**⚠️ Downtime:** Redis restart-এর কয়েক সেকেন্ড সব ক্যাশ/broker সংযোগ বিচ্ছিন্ন হবে।

### `docker/setup_host_networking.sh`
**কী করে:** host-এর MySQL ও Redis-কে Docker network থেকে reachable করে (MySQL/Redis
নিজেরা Docker-এ যায় না, শুধু network access খুলে দেয়) — bind-address ও GRANT আপডেট করে।

**ব্যবহার:** `sudo bash docker/setup_host_networking.sh` (dry-run/apply/rollback মোড আছে)
**⚠️ Downtime:** apply মোডে শেষে MySQL/Redis restart হয়, কয়েক সেকেন্ডের জন্য সংযোগ বিচ্ছিন্ন হবে।

---

## ৬. মোবাইল অ্যাপ Build ও APK Download লিংক

> **দুটো আলাদা অ্যাপ আছে** — এই script-গুলো গুলিয়ে ফেলবেন না:
> - **"Rajamehar Online"** (`mobile_app/`) — মূল ক্লায়েন্ট অ্যাপ
> - **"Rajamehar Live TV"** (`livetv_app/`) — শুধু Live TV অ্যাপ

### `scripts/build_and_publish_apk.sh`
**কী করে:** এক কমান্ডে "Rajamehar Online" অ্যাপের নতুন APK build করে (EAS local
build) এবং download লিংক আপডেট করে (`update_apk_download.sh`-কেও নিজে থেকে call করে)।

**ব্যবহার:** `bash scripts/build_and_publish_apk.sh`

### `scripts/update_apk_download.sh`
**কী করে:** নতুন build হওয়া APK খুঁজে বের করে `media/app/rajamehar-online.apk`-এ
কপি করে — যাতে Company Info পেজ ও walled-garden/reminder লিংক নতুন ভার্সন দেখায়।
এটা **শুধু** `build_and_publish_apk.sh` চালানোর ফলাফল প্রকাশ করার ধাপ, নিজে build করে না।

**ব্যবহার:** `bash scripts/update_apk_download.sh`

**⚠️ ২০২৬-০৭-১০ bug fix:** আগে `public_apk/`-এর **সব** `.apk` ফাইল candidate ধরত
(শুধু mtime দিয়ে বাছাই করত, filename check ছিল না) — একবার এর ফলে LiveTV app-এর
APK ভুলে "Rajamehar Online"-এর ডাউনলোড লিংকে বসে গিয়েছিল production-এ। এখন
filename-এ `livetv` থাকা ফাইল স্পষ্টভাবে বাদ দেওয়া হয়। **তবু সাবধান থাকুন** —
`public_apk/` ফোল্ডারে দুই app-এরই পুরনো/নতুন build একসাথে জমে থাকে, তাই এই script
চালানোর পর সবসময় আউটপুটে দেখানো ফাইলের নাম/সাইজ চোখে দেখে নিশ্চিত হন এটা সত্যিই
সঠিক app-এর build কিনা।

### `scripts/build_and_publish_livetv_apk.sh`
**কী করে:** উপরেরটার Live TV অ্যাপ সংস্করণ — `livetv_app`-এর নতুন APK build করে
(version bump সহ) এবং download লিংক আপডেট করে।

### `scripts/update_livetv_apk_download.sh` ও `scripts/update_livetv_apk.sh`
**কী করে দুটোই প্রায় একই কাজ:** Live TV APK-কে `media/app/rajamehar-livetv.apk`-এ
কপি করা। **পার্থক্য:** `update_livetv_apk_download.sh` `public_apk/`-এর সবচেয়ে
নতুন APK auto-খুঁজে নেয়; `update_livetv_apk.sh` নির্দিষ্টভাবে
`livetv_app/android/.../app-release.apk` (মানে সরাসরি `gradlew assembleRelease`-এর
আউটপুট) থেকে কপি করে। **কোনটা ব্যবহার করবেন তা নির্ভর করে কীভাবে build করেছেন**
(EAS দিয়ে নাকি সরাসরি Gradle দিয়ে) — দুটোই একসাথে/redundant-ভাবে চালানোর দরকার নেই।

### `deploy/dynamic_apk_download.sh` ⚠️ vs `scripts/point_app_download_to_media.sh` ⚠️
**🔴 এই দুটো একই nginx location (`/app/download`) দুইভাবে বদলায় — একসাথে চালানো ঠিক না:**

| Script | পদ্ধতি |
|---|---|
| `deploy/dynamic_apk_download.sh` | `public_apk/` ফোল্ডারের **সবচেয়ে নতুন যেকোনো নামের** `.apk` স্বয়ংক্রিয়ভাবে সার্ভ করে |
| `scripts/point_app_download_to_media.sh` | সবসময় **নির্দিষ্ট একটা ফাইল** (`media/app/rajamehar-online.apk`) সার্ভ করে |

**বর্তমানে প্রকল্পে `media/app/rajamehar-online.apk`-ভিত্তিক পদ্ধতিই ব্যবহৃত হচ্ছে**
(`update_apk_download.sh` এই ফাইলেই কপি করে) — অর্থাৎ **`point_app_download_to_media.sh`-ই
এখন সঠিক/চালু approach**, `dynamic_apk_download.sh` পুরনো/superseded। **`dynamic_apk_download.sh`
আর চালাবেন না** — nginx config দুটো পরস্পরবিরোধী, শেষে যেটা চালানো হয়েছে সেটাই এখন active।

### `deploy/add_apk_https_location.sh`
**কী করে:** Main HTTPS server block-এ `/app/download` location **প্রথমবার যোগ করে**
(যদি আগে না থাকে) — যাতে non-expired ইউজারও Payment Reminder পেজ থেকে APK
download করতে পারে। Idempotent (দুবার চালালেও ডুপ্লিকেট হয় না), ব্যর্থ হলে rollback করে।

**সম্পর্ক:** এটা **one-time setup** — location block তৈরি করার জন্য। এরপর সেই
block-এর **ভেতরের content** (dynamic vs fixed-file) ঠিক করে উপরের দুটো script।

---

## ৭. ডাটাবেস ব্যাকআপ

### `deploy/mysql_backup.sh`
**কী করে:** প্রতিদিন রাত ৩টায় (cron দিয়ে, `/etc/cron.d/isp-bnas-backup`)
স্বয়ংক্রিয়ভাবে চলে — মূল ডাটাবেস (Django app + FreeRADIUS, দুটোই আসলে একই
DB-তে, বিস্তারিত script-এর ভেতরের কমেন্টে) + সব secret/config ফাইল (`.env`,
Firebase key, nginx/systemd config) ব্যাকআপ করে `/var/backups/isp_bnas/`-এ।

**ব্যবহার:** স্বয়ংক্রিয় (cron), ম্যানুয়ালি টেস্ট করতে চাইলে `sudo bash deploy/mysql_backup.sh`

**⚠️ এখনো local-only:** এই ব্যাকআপ শুধু এই মেশিনের নিজের ডিস্কে থাকে — মেশিন সম্পূর্ণ
নষ্ট হলে এটাও হারাবে। অফসাইট copy করা এখনো ম্যানুয়াল (`docker/DR_MIGRATION_PLAN.md` দেখুন)।

**সম্পর্ক `install.sh backup`-এর সাথে:** এই দুটো **ভিন্ন উদ্দেশ্যে** —
`deploy/mysql_backup.sh` = **নিয়মিত দৈনিক** ব্যাকআপ (একই মেশিনে থেকে যায়, DR-এর
জন্য)। `install.sh backup` = **এক-কালীন মাইগ্রেশন** ব্যাকআপ (নতুন মেশিনে scp করে
নিয়ে যাওয়ার জন্য, single tar.gz ফাইলে সব)। দুটোই দরকারি, একটা আরেকটার বদলি না।

---

## ৮. টেস্টিং

### `scripts/test_bkash_webhook.sh`
**কী করে:** bKash payment gateway-এর webhook সঠিকভাবে কাজ করছে কিনা লোকাল
টেস্ট করে — দুই মোডে: (১) CURL দিয়ে real HTTP request পাঠিয়ে, (২) Django shell
দিয়ে সরাসরি ফাংশন কল করে (gunicorn চালানোর দরকার নেই)।

**ব্যবহার:** `bash scripts/test_bkash_webhook.sh`

---

## সংক্ষিপ্ত সারণি — কোন কাজে কোন script

| আমি কী করতে চাই | কোন script চালাব |
|---|---|
| নতুন মেশিনে পুরো সিস্টেম বসাতে চাই | `install.sh` |
| এই মেশিনের সব ডেটা অন্য মেশিনে নিতে চাই | `install.sh backup` তারপর নতুন মেশিনে `install.sh` |
| শুধু daily DB ব্যাকআপ ঠিকমতো হচ্ছে কিনা দেখতে চাই | `deploy/mysql_backup.sh` (cron দিয়ে এমনিতেই চলে) |
| নতুন ডোমেইনে HTTPS চালু করতে চাই | `setup_https.sh` |
| ডোমেইন বদলাতে চাই | `change_domain.sh` |
| RADIUS-এ routine সমস্যা (index/cleanup) ঠিক করতে চাই | `install.sh radius-fix` |
| RADIUS-এ BlastRADIUS/SQL-pool bug ঠিক করতে চাই | `scripts/fix_freeradius_config.sh` |
| VoIP প্রথমবার সেটআপ করতে চাই | `deploy/asterisk/install.sh` |
| VoIP কলে অডিও আসছে না | প্রথমে `fix_media_nat.sh`, তাতেও না হলে `setup_coturn.sh` |
| Docker container-এর স্বাস্থ্য দেখতে চাই | `docker/observe_phase1_celery.sh` |
| Redis পাসওয়ার্ড বদলাতে চাই | `docker/rotate_redis_password.sh` |
| নতুন APK build করে প্রকাশ করতে চাই (client app) | `scripts/build_and_publish_apk.sh` |
| নতুন APK build করে প্রকাশ করতে চাই (LiveTV app) | `scripts/build_and_publish_livetv_apk.sh` |
| bKash webhook টেস্ট করতে চাই | `scripts/test_bkash_webhook.sh` |

## ⚠️ পাওয়া সমস্যা — এখনো সমাধান হয়নি, সিদ্ধান্ত দরকার

- **`deploy/dynamic_apk_download.sh` পুরনো/অব্যবহৃত** — `scripts/point_app_download_to_media.sh`
  এখন সঠিক approach। প্রথমটা মুছে ফেলা বা স্পষ্টভাবে "DEPRECATED" মার্ক করা উচিত
  যাতে ভুলবশত কেউ আবার না চালায়।
