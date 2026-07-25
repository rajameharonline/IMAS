# Phase-1 Docker Cutover — স্থিতিশীলতা Scorecard

> এই ফাইলটি observation-এর সাথে সাথে আপডেট হবে। কোনো সার্ভিস disable/restart/reload
> করার আগে এখানকার checklist পূরণ হওয়া আবশ্যক।

## ⚠️ ইনসিডেন্ট: LiveTV mobile app — চ্যানেল লিস্ট/ভিডিও কাজ করছিল না (সমাধান হয়েছে)

**সময়:** ~১৫:৪০-১৫:৫২ (২০২৬-০৭-০৯), ব্যবহারকারীর রিপোর্ট থেকে শুরু, ১৫:৫২-এর মধ্যে সমাধান।

**Root cause:** `Dockerfile`-এ `ffmpeg` প্যাকেজ ছিল না (`snmp` যোগ করা হয়েছিল আগে, কিন্তু `ffmpeg` মিস হয়ে গিয়েছিল)। ফলে Docker `celery-worker` (14:15 থেকে সক্রিয়) 'url'-টাইপ LiveTV চ্যানেলের জন্য real video relay চালাতে পারছিল না — কোনো visible crash ছাড়াই, কারণ `_warm_channel()`-এর `except Exception: pass` নীরবে সব গিলে ফেলছিল।

**Cascade effect:** ffmpeg না থাকায় → HLS content তৈরি হচ্ছিল না → `livetv/services/app_visibility.py`-এর `_channel_visibility()` filter (`last_content_ok is False` বা ping unreachable হলে বাদ) url-টাইপ চ্যানেল বাদ দিয়ে দিচ্ছিল → মোবাইল অ্যাপের `/api/v1/app/livetv/channels/` endpoint-এ চ্যানেল কম/খালি দেখাচ্ছিল, এবং ভিডিও একদমই চলছিল না।

**Fix:** `Dockerfile`-এ `ffmpeg` প্যাকেজ যোগ (একই প্যাটার্নে `snmp`-এর মতো), rebuild, নিয়ন্ত্রিত recreate (worker আগে যাচাই, তারপর beat, duplicate scheduler window এড়িয়ে)।

**Verification:** `ffmpeg version 7.1.5` ইমেজে নিশ্চিত। Worker log-এ real channel start (`'Deshe Bideshe' [url] started PID=60` ইত্যাদি) ও error-status channel recovery (`Error চ্যানেল retry: '...' → True`, ১৬+ চ্যানেল)। **৪৬টা চ্যানেলের HLS playlist সক্রিয়ভাবে আপডেট হচ্ছে** (fix apply-এর ১৫ মিনিটের মধ্যে) — সরাসরি ফাইল-সিস্টেমে নতুন `.ts` segment ও `index.m3u8` mtime দিয়ে নিশ্চিত।

**শিক্ষা:** Docker migration-এর সময় প্রতিটা external binary dependency (snmpwalk, ffmpeg) আলাদাভাবে অডিট করা দরকার ছিল — কোড কোথায় `subprocess`/`Popen` ব্যবহার করে তার একটা সম্পূর্ণ তালিকা আগে থেকে বানানো উচিত ছিল ভবিষ্যতের যেকোনো নতুন Docker migration-এর জন্য।

## ১. বর্তমান সক্রিয় Architecture

```
Internet → host nginx (80/443, SSL/HSTS/walled-garden/HLS-security/APK/phpMyAdmin)
              │
              ├─ /admin/, /api/  → 127.0.0.1:8001 (Docker django-app)  [production traffic]
              └─ /static/, /media/ → সরাসরি disk থেকে (nginx alias, Django ছোঁয় না)

Docker celery-worker  → host MySQL + host Redis (broker/cache)
Docker celery-beat    → DatabaseScheduler, host MySQL-এ schedule সংরক্ষিত

Rollback safety net (idle, চলমান কিন্তু traffic পাচ্ছে না):
  - systemd isp-gunicorn.service   (active, 127.0.0.1:8000, idle since cutover)
  - systemd isp-celery.service     (stopped/failed — ইচ্ছাকৃত)
  - systemd isp-celery-beat.service (stopped/inactive — ইচ্ছাকৃত)

Host MySQL, host Redis, FreeRADIUS, Asterisk, SNMP trap listener — অপরিবর্তিত, native।
```

## ২. Observation Timeline

| ইভেন্ট | সময় (আনুমানিক, ২০২৬-০৭-০৯) |
|---|---|
| Celery worker cutover (Docker) | ~১৪:১৫ |
| Celery beat cutover (Docker) | ~১৪:২০ |
| Nginx Option 1 cutover (production web traffic) | ১৪:৫৮:২৫ |
| LiveTV keep-warm bug fix applied (patch: `docker/patches/livetv_keep_warm_fix.patch`) | ১৫:২৬-১৫:২৭ — celery-worker ও celery-beat নতুন ইমেজ দিয়ে recreate করা হয়েছে (django-app-ও পার্শ্ব-প্রতিক্রিয়ায় recreate হয়েছে, একই ইমেজ ট্যাগ শেয়ার করায়) |
| LiveTV ffmpeg missing bug fix applied (Dockerfile: `ffmpeg` প্যাকেজ যোগ) | ~১৫:৪০-১৫:৫২ — মোবাইল অ্যাপে LiveTV channel list/video না দেখানোর রিপোর্ট থেকে diagnose, worker+django-app recreate, commit `1eee3f1` |
| Mobile app login সমস্যা — root cause নিশ্চিত ও **সমাধান হয়েছে** (Docker migration-এর সাথে সম্পর্কহীন ছিল) | ~১৬:০০-১৬:৩০ — **Split-DNS + public IP unreachable**: local resolver `roisp.duckdns.org`-কে internal IP (`172.16.3.254`) দেখায় (তাই local machine browser/curl সবসময় সফল হয়েছে), কিন্তু প্রকৃত public DNS record (Cloudflare/Google দিয়ে verified) দেখায় `103.214.202.17` — যেটার port 80/443 বাইরে থেকে অগম্য ছিল। MikroTik/network টিম port-forwarding rule ঠিক করে — **~১৬:৪৫-এ ব্যবহারকারী নিজে mobile data (WiFi বন্ধ)-তে সরাসরি পরীক্ষা করে নিশ্চিত করেছেন এখন কাজ করছে।** Docker/Django/nginx কনফিগের কোনো সম্পর্ক ছিল না |
| **RADIUS DB `localhost` bug — Docker migration-জনিত, সমাধান হয়েছে** | ১৬:৪৩-১৬:৫১ — real user traffic ফিরে আসার পর `radius_service.py`-তে `get_user_live_ip`/`get_online_users`/`_get_last_stop_times` বারবার `pymysql.err.OperationalError: Can't connect to MySQL server on 'localhost'` দিচ্ছিল। কারণ: `RadiusServer` DB টেবিলের active row (id=5)-এর `db_host='localhost'` — এটা `settings.RADIUS_DB`/env var-কে override করে, Docker-পূর্ব যুগের ডেটা, container থেকে অগম্য। **Fix: শুধু DB row-এর `db_host` মান `'172.19.0.1'` (docker gateway, host নিজেই owns করে — container ও systemd rollback path দুটোতেই কাজ করবে) এ আপডেট — কোনো কোড/method signature ছোঁয়া হয়নি।** `_get_last_stop_times()` সরাসরি টেস্ট করে সফল নিশ্চিত করা হয়েছে, fix-এর পরের ৩ মিনিটে একটাও নতুন error নেই |
| LiveTV keep-warm patch **স্থায়ীভাবে committed** নিশ্চিত (git diff খালি, reverse-apply সফল) | ১৭:০৫ — ১০+ consecutive সফল cycle (১৬:৪৮-১৭:০৬), একবারও পুরনো `TypeError`/`SchedulingError` দেখা যায়নি |
| RADIUS DB fix স্থায়ী নিশ্চিত (৩০ মিনিট window-এ ০ error) | ১৭:৩৯ |
| Docker nginx test container (non-production, 8081/8091) gracefully exited | ~১৭:২৯ — clean exit code 0, crash না। **Production traffic অপ্রভাবিত** (host nginx-ই production authority, django-app সরাসরি অক্ষত)। restart করা হয়নি (এই observation-এর scope-এ restart অনুমোদিত না) |
| সর্বশেষ সফল observation | ১৭:৩৯ |
| মোট চলমান সময় (এই লেখার সময় পর্যন্ত) | worker/django-app ~২৪ মিনিট (ffmpeg fix rebuild-এর পর থেকে), beat ~২৪ মিনিট, nginx cutover ~৭৬ মিনিট (১ ঘণ্টা ১৬ মিনিট) |

**LiveTV keep-warm fix স্ট্যাটাস: ✅ সম্পূর্ণ সফল ও নিশ্চিত।** patch apply + rebuild + controlled recreate (worker আগে, তারপর beat, duplicate scheduler window এড়িয়ে) সম্পন্ন। ১৫:২৮, ১৫:৩০, ১৫:৩২-এ তিনটা due run cleanly পাঠানো হয়েছে — পুরনো `SchedulingError`/`TypeError` একবারও দেখা যায়নি। Worker log নিশ্চিত করেছে task **প্রকৃতপক্ষে কার্যকরভাবে চলছে**: `Task livetv.keep_warm_channels[...] succeeded ... {'targets': 50, 'started': 50, 'already_warm': 0, 'count': 50}` — production-এ `LIVETV_KEEP_WARM_COUNT=50` সক্রিয় ছিল, এই bug-এর কারণে এতদিন কখনো চলেনি। এখন থেকে প্রতি ১২০ সেকেন্ডে ৫০টা visible channel keep-warm হবে।

## ৩. Health Checklist (সর্বশেষ observation অনুযায়ী)

| আইটেম | অবস্থা |
|---|---|
| Docker django-app production traffic পাচ্ছে | ✅ নিশ্চিত (real admin session, মিনিটে-মিনিটে polling, সব 200 OK) |
| পুরনো systemd gunicorn idle | ✅ নিশ্চিত (cutover-এর পর কোনো নতুন request নেই) |
| Docker celery-worker task প্রসেস করছে | ✅ নিশ্চিত (OLT, LiveTV, VOIP, billing সব task সফল) |
| Docker celery-beat schedule পাঠাচ্ছে | ✅ নিশ্চিত (নিয়মিত interval-এ) |
| Duplicate beat scheduler নেই | ✅ নিশ্চিত (প্রতি cycle-এ যাচাই করা হয়েছে) |
| OLT/SNMP row count স্থিতিশীল | ✅ নিশ্চিত (৭৩/১১৯/৩৭৯, একাধিক cycle) |
| Billing task পর্যবেক্ষিত | ✅ `process_payment_reminders` সফল (hour=15, rules_run=0) — **`auto_generate_monthly_bills`, `disable_expired_clients` এখনো observe করা হয়নি (দৈনিক/মাসিক schedule)** |
| MySQL/Redis/nginx নতুন error | ✅ নেই (সর্বশেষ চেকে) |
| LiveTV keep-warm bug | ✅ সমাধান হয়েছে (patch applied ১৫:২৬, ৬+ consecutive সফল cycle, স্থিতিশীল steady-state `already_warm: 47/50`) |
| LiveTV ffmpeg missing bug | ✅ সমাধান হয়েছে (Dockerfile fix ~১৫:৪০-৫২, ৪৬টা চ্যানেল সক্রিয়ভাবে HLS produce করছে) |
| RADIUS DB `localhost` bug (get_user_live_ip/online_users/last_stop_times) | ✅ সমাধান হয়েছে (DB data fix ১৬:৫১, `RadiusServer.db_host` → `172.19.0.1`, কোড অপরিবর্তিত) |

**⚠️ সীমাবদ্ধতা:** এই স্ক্রিপ্ট চালানোর টুল-সেশনে মাঝেমধ্যে sudo interactive password ছাড়া কাজ করে না, ফলে MySQL/Redis/gunicorn error-check অংশ কখনো কখনো false-positive "কোনো error নেই" দেখাতে পারে। Docker-side চেক (worker/beat/django-app status, duplicate guard, OLT ডেটা, HTTPS response) সবসময় নির্ভরযোগ্য।

## ৪. systemd Celery Services Disable করার আগে যা লাগবে

- [x] একাধিক সফল observation cycle (✅ ১০+ cycle, keep-warm/OLT/billing সব)
- [ ] কমপক্ষে কয়েক ঘণ্টা স্থিতিশীলতা (⏳ এখন পর্যন্ত ~৩ ঘণ্টা ২৪ মিনিট — worker/beat ১৪:১৫/১৪:২০ থেকে)
- [ ] দৈনিক billing cycle পর্যবেক্ষণ — `disable-expired-clients` (প্রতিদিন ০০:০৫), `auto-generate-monthly-bills` (মাসের ১ তারিখ ০০:০০) (❌ এখনো cover হয়নি, `process_payment_reminders` hourly task ২ বার সফল দেখা গেছে)
- [x] Duplicate scheduler কখনো দেখা যায়নি (✅)
- [x] কোনো missed periodic task নেই (✅ এখন পর্যন্ত)
- [x] OLT/SNMP anomaly নেই (✅ একাধিক cycle-এ ৭৩/১২০/৩৭৯ স্থিতিশীল)
- [x] RADIUS DB bug fix করা হয়েছে ও স্থায়ী নিশ্চিত (✅)
- [x] LiveTV keep-warm fix স্থায়ী committed ও ১০+ cycle সফল (✅)
- [x] Rollback command টেস্ট করা ও ডকুমেন্টেড (✅ — `docker compose stop celery-beat celery-worker && sudo systemctl start isp-celery.service isp-celery-beat.service`)

**সিদ্ধান্ত: এখনো disable করার সময় হয়নি — কমপক্ষে দৈনিক billing window (রাত ১২টার পর `disable-expired-clients`) cover না হওয়া পর্যন্ত অপেক্ষা করা উচিত।**

## ৫. systemd Gunicorn Disable করার আগে যা লাগবে

- [ ] Production traffic দীর্ঘ সময় (কয়েক ঘণ্টা+) স্থিতিশীলভাবে Docker django-app-এ (⏳ এখন পর্যন্ত ~২ ঘণ্টা ৪১ মিনিট, cutover ১৪:৫৮:২৫ থেকে)
- [x] কোনো নতুন 5xx/error নেই (✅ এখন পর্যন্ত, RADIUS DB bug ছাড়া — সেটাও fix হয়ে গেছে)
- [x] Admin/API workflow verified (✅ real admin + real mobile app session দিয়ে নিশ্চিত)
- [x] Nginx rollback script উপলব্ধ (✅ `docker/nginx_option1_upstream_patch.sh --rollback`)
- [ ] পুরনো gunicorn কয়েক ঘণ্টা idle থেকেছে প্রমাণসহ (⏳ এখন পর্যন্ত ~২ ঘণ্টা ৮ মিনিট)

**সিদ্ধান্ত: এখনো disable করার সময় হয়নি — আরও কিছু ঘণ্টা স্থিতিশীলতা দেখা ভালো।**

## ৬. এখনো Approval ছাড়া করা যাবে না

- systemd `isp-celery`/`isp-celery-beat` disable/mask
- systemd `isp-gunicorn` disable
- Docker nginx-কে 80/443-এ বসানো (Option 2 / full hardening)
- MySQL কন্টেইনারাইজেশন
- LiveTV keep-warm bug fix (`livetv/tasks.py`)
- যেকোনো restart/reload/config-change

## ৭. Rollback Commands (রেফারেন্স — এখনো প্রয়োজন হয়নি)

**Nginx rollback:**
```bash
sudo bash docker/nginx_option1_upstream_patch.sh --rollback
```

**Celery rollback:**
```bash
docker compose stop celery-beat celery-worker
sudo systemctl start isp-celery.service isp-celery-beat.service
systemctl is-active isp-celery.service isp-celery-beat.service
```

**সম্পূর্ণ Phase-1 rollback:**
```bash
sudo bash docker/nginx_option1_upstream_patch.sh --rollback
docker compose stop celery-beat celery-worker
sudo systemctl start isp-celery.service isp-celery-beat.service
systemctl is-active isp-celery.service isp-celery-beat.service
```

## ৮. [2026-07-09 ~১৭:৪৫] — Master Audit (Tasks A–H)

**Task A — Health snapshot:** সব সবুজ। systemd সার্ভিস প্রত্যাশিত অবস্থায় (nginx/isp-gunicorn active,
isp-celery failed/isp-celery-beat inactive — ইচ্ছাকৃত রোলব্যাক-সেফটি অবস্থা)। কন্টেইনার uptime
~২ ঘণ্টা (django-app/celery-worker ০৯:৫০ থেকে, celery-beat ০৯:৫০:৩৮ থেকে)।

**Task B — Duplicate infra audit:** কোনো duplicate MySQL/Redis Docker container নেই (কখনো ছিলও না)।
Docker Desktop VM চলছে না। Docker nginx টেস্ট container `Exited (0)` (~২৭ মিনিট আগে থেকে তখন,
harmless)। Memory/swap pressure সম্পূর্ণ desktop অ্যাপ (SonarLint/Chrome/VS Code)-এর কারণে,
Docker-এর সাথে সম্পর্কহীন।

**Task C — Cleanup plan:** `docker compose rm -f nginx` প্রস্তুত করা হয়েছে কিন্তু **এক্সিকিউট করা হয়নি**
(অপ্রয়োজনীয়, exited container রিসোর্স নিচ্ছে না)। বিস্তারিত: `DOCKER_REMAINING_WORK.md` সেকশন B।

**Task D — Docker Desktop cleanup:** প্রসেস আগে থেকেই বন্ধ, কিছু করার নেই।

**Task E — Compose hardening review:** `docker-compose.yml` অডিট করা হয়েছে (কোনো পরিবর্তন হয়নি) —
restart policy/pinned subnet/extra_hosts/env_file/no-hardcoded-secrets/single-beat সব ঠিক আছে,
কোনো গ্যাপ পাওয়া যায়নি। বিস্তারিত: `DOCKER_REMAINING_WORK.md` সেকশন E। নতুন ডকুমেন্ট তৈরি:
`PHASE1_DOCKER_RUNBOOK.md`, `DOCKER_REMAINING_WORK.md`।

**Task F — systemd disable readiness:** **এখনো প্রস্তুত না** (celery ও gunicorn দুটোই) — দৈনিক
billing window এখনো cover হয়নি, cutover থেকে মাত্র কয়েক ঘণ্টা পার হয়েছে। বিস্তারিত সেকশন ৪-৫ দেখুন
(অপরিবর্তিত সিদ্ধান্ত)।

**Task G — ভবিষ্যৎ roadmap:** MySQL containerization (নিম্ন অগ্রাধিকার), Redis containerization
(মাঝারি), Docker nginx full hardening/Option 2 (নিম্ন), FreeRADIUS/Asterisk/SNMP host-native
রাখার স্থায়ী সুপারিশ (UDP/NAT/CAP_NET_BIND_SERVICE ঝুঁকির কারণে) — সব ডকুমেন্টেড, কোনো এক্সিকিউশন না।
বিস্তারিত: `DOCKER_REMAINING_WORK.md` সেকশন D।

**Task H — Work log:** `PHASE1_DOCKER_WORKLOG.md` তৈরি করা হয়েছে দিনাঙ্কিত এন্ট্রি সহ।

**এই cycle-এ কোনো mutating/write কমান্ড চালানো হয়নি — শুধু read-only audit + নতুন documentation।**

## ৯. [2026-07-09 ~১৮:২৬] — Resource Limits Apply (django-app/celery-worker/celery-beat)

**Pre-check:** সব সবুজ (systemd/HTTPS/observe script/logs — কোনো anomaly নেই)।

**Apply:** `docker compose up -d --no-deps django-app celery-worker celery-beat` — শুধু এই ৩টা
সার্ভিস recreate হয়েছে, nginx/MySQL/Redis টাচ হয়নি। Recreate-এর পরপরই HTTPS চেক ঠিক response
দিয়েছে (302/404/200), downtime observe করা যায়নি।

**Verify (`docker inspect`):**
- django-app: Memory=1073741824 (1GiB) ✅, NanoCpus=1000000000 (1.0) ✅
- celery-worker: Memory=536870912 (512MiB) ✅, NanoCpus=1000000000 (1.0) ✅
- celery-beat: Memory=536870912 (512MiB) ✅, NanoCpus=500000000 (0.5) ✅

**⚠️ নতুন ঝুঁকি চিহ্নিত:** `celery-worker` recreate-এর পর থেকে ক্রমাগত ~99.7-99.9% (510/512MiB)
মেমরি ব্যবহার করছে — ২ মিনিট পর্যবেক্ষণে stable (OOMKill/restart হয়নি) কিন্তু headroom প্রায় শূন্য।
Load spike-এ OOMKill হওয়ার ঝুঁকি আছে। **Follow-up দরকার:** limit বাড়ানো (768MiB প্রস্তাবিত) বিবেচনা করুন।

**⚠️ পৃথক পূর্ব-বিদ্যমান ইস্যু চিহ্নিত:** `.env`/`.env.docker`-এর `SECRET_KEY`-তে `$px5`/`$y8` জাতীয়
substring আছে যা Compose variable-interpolation ওয়ার্নিং তৈরি করছে (`px5`/`y8` variable not set)।
সম্ভাব্য প্রভাব: `SECRET_KEY` silently truncated/ভুল হয়ে container-এ লোড হতে পারে। যাচাই করার
জন্য container-এর ভেতরে exec করার চেষ্টা auto-mode permission classifier ব্লক করেছে (production
secret runtime state, explicit approval ছাড়া)। **কোনো fix apply করা হয়নি — ব্যবহারকারীর
সিদ্ধান্তের অপেক্ষায়।**

**Duplicate beat risk:** ✅ নেই (systemd beat: inactive, docker beat: running, একটাই সক্রিয়)।

**সিদ্ধান্ত:** Resource limits সফলভাবে apply হয়েছে ও verified। celery-worker মেমরি হেডরুম ও
SECRET_KEY ইস্যু — দুটোই পরবর্তী পদক্ষেপ হিসেবে ট্র্যাক করা হচ্ছে, কোনোটাই এখনই critical outage না।

**[১৮:৩১ ফলো-আপ]:** ~৫ মিনিট পর্যবেক্ষণ, একটা ভারী `olt-auto-sync-mac-table` cycle (413 CPE MAC
entries সহ) resource-limited অবস্থাতেই সফল হয়েছে (73/120/379 rows স্থিতিশীল)। celery-worker মেমরি
এখনো ~99.7% (510.8/512MiB) কিন্তু কোনো OOMKill/restart হয়নি। HTTPS/observe script/duplicate-beat
guard সব ✅। এখনো নিবিড় পর্যবেক্ষণ চলছে।

## ১০. [2026-07-09 ~১৮:৩৬-১৮:৪১] — celery-worker Memory Limit 512M→768M + SECRET_KEY `$` Fix

**Pre-check:** সব সবুজ (HTTPS/observe script/stats — celery-worker তখনো ~99.55%)।

**Change ১ — Memory limit বৃদ্ধি:** `docker-compose.yml`-এ শুধু `celery-worker`-এর memory limit
512M→768M করে `docker compose up -d --no-deps celery-worker` — শুধু celery-worker recreate
হয়েছে (django-app/celery-beat "Running", টাচ হয়নি)। `docker inspect` verified:
`Memory=805306368` (768MiB exactly), `NanoCpus=1000000000` (অপরিবর্তিত)।

**⚠️ পর্যবেক্ষণ:** নতুন limit-এও baseline usage ~98% (৭৫৩-৭৫৪MiB/768MiB) — limit বাড়ার সাথে usage-ও
সমানুপাতে বেড়েছে। তবে ৪+ মিনিট (একটা ভারী ৩-OLT sync সহ) সম্পূর্ণ স্থির ছিল (বাড়েনি) — সম্ভবত
page-cache-প্রধান accounting, active leak না বলে মনে হচ্ছে, কিন্তু নিশ্চিত না (cgroup breakdown
করা হয়নি, exec অনুমোদিত ছিল না)।

**Change ২ — `.env.docker` SECRET_KEY `$` escape:** ২টা literal `$` (px5/y8 warning-এর উৎস)
`$$`-এ escape করা হয়েছে Python script দিয়ে (length compare-only verify, কোনো value print
হয়নি)। Backup: `.env.docker.bak-20260709-183827` (perm 600)। Ownership/permission preserve
করতে `cat tmp > file` ব্যবহার হয়েছে (mv না করে)।

**host `.env` টাচ করা হয়নি** — systemd/native gunicorn `$$` বুঝবে না, escape করলে real
SECRET_KEY corrupt হতো। ফলে `.env`-এর অংশের জন্য warning পুরোপুরি যায়নি — এখন cosmetic-only
(container env-এ প্রভাব নেই)। `COMPOSE_DISABLE_ENV_FILE=1` টেস্ট করে অনির্ভরযোগ্য পাওয়া গেছে
(officially documented flag না, ভবিষ্যতে সুপারিশ করা হচ্ছে না)।

**Post-check:** HTTPS 302/404/200 ✅, observe script exit 0 (দুইবার) ✅, duplicate beat guard ✅,
django-app/celery-beat অক্ষত (recreate হয়নি) ✅।

**সিদ্ধান্ত:** দুটো ফিক্সই apply ও verified। celery-worker মেমরি এখনো নিবিড় পর্যবেক্ষণে থাকবে
(এখনই critical না, কিন্তু headroom কম)। SECRET_KEY-এর host `.env` অংশ ইচ্ছাকৃতভাবে অপরিবর্তিত।

## ১১. [2026-07-09 ~১৮:৪৩-১৮:৫৫] — 🔴 CRITICAL INCIDENT: celery-worker OOM Crash-Loop → LiveTV Outage

**ট্রিগার:** ব্যবহারকারী রিপোর্ট করেন "লাইভ টিভি অ্যাপসে নিরবিচ্ছিন্ন ভিডিও চলছে না"।

**তদন্ত:** গত ৫ মিনিটে ৪৫/৫৫ (৮২%) LiveTV `.m3u8` request `503`। Root cause: ffmpeg relay
subprocess-গুলো celery-worker container-এর child, ✅ সেকশন ১০-এর recreate (768M limit) সব relay
killed করেছিল। `docker events` দিয়ে প্রমাণিত: 768MiB limit-এও **সক্রিয় crash-loop**
(`container oom` x৫+, `die exitCode=137`, `RestartCount` ০→১→২→৩)। প্রকৃত প্রয়োজন ২-৪GiB+
(৭৬৮MiB-তে মাত্র ১৪ চ্যানেলেই ১.২৬GiB ব্যবহার)।

**পদক্ষেপ ১:** ব্যবহারকারীর approval নিয়ে `keep_warm_channels.delay()` ম্যানুয়ালি ট্রিগার —
আংশিক সাহায্য, crash-loop অব্যাহত ছিল।

**পদক্ষেপ ২:** ব্যবহারকারীর approval (AskUserQuestion → "10GB") অনুযায়ী memory limit
768M→**10G**। Host-এ তখন 6.2Gi available ছিল; 10G শুধু ceiling, pre-allocate না। `docker compose
up -d --no-deps celery-worker` — শুধু celery-worker recreate, django-app/celery-beat অক্ষত।

**ফলাফল:** `RestartCount=0` স্থিতিশীল, কোনো নতুন OOM নেই। ৭ মিনিটে m3u8 success rate ৪৫/৫৫ fail
থেকে ~৯৬%+ সফলে উন্নীত। `keep_warm_channels`: already_warm ০→১০→৩৬ (৫০-এর মধ্যে) ক্রমবর্ধমান।
মেমরি ব্যবহার ~1.9GiB/10GiB (১৯%), যথেষ্ট headroom।

**শিক্ষা (RUNBOOK-এ documented):** celery-worker recreate = সব LiveTV relay killed = viewer-facing
503 spike পুনরায় warm হওয়া পর্যন্ত। ভবিষ্যতে যেকোনো celery-worker recreate-এর পর `docker events`/
`RestartCount` দিয়ে crash-loop চেক করা আবশ্যক, শুধু "Up X seconds" দেখে সন্তুষ্ট হওয়া যাবে না।

**সিদ্ধান্ত:** Incident resolved। পূর্ণ ৫০/৫০ চ্যানেল warm হওয়া ও পিক মেমরি পর্যবেক্ষণ চলছে।

## ১২. [2026-07-09 ~১৮:৫৯-১৯:১১] — পৃথক আবিষ্কার: ৯২টা LiveTV চ্যানেল persistent "error" state (Docker-অসম্পর্কিত)

**প্রেক্ষাপট:** OOM incident resolve হওয়ার পরও ব্যবহারকারী রিপোর্ট করেন ভিডিও এখনো চলছে না।
তদন্তে channel 554 (Bein Sports 2)-এর relay/playlist সম্পূর্ণ সুস্থ পাওয়া যায় (segment ২ সেকেন্ড
পুরনো, playlist advancing) — অর্থাৎ user-এর নির্দিষ্ট সমস্যা backend infra না।

**নতুন আবিষ্কার:** DB query করে দেখা যায় মোট ৩৬৫ চ্যানেলের মধ্যে status বিভাজন:
`live=22, starting=21, stopped=230, error=92`। ৯২টা error-এর মধ্যে ৫৭টা "FFmpeg process
unexpectedly terminated", ২১টা পুরনো "ffmpeg not found" (pre-ffmpeg-fix stale error), বাকিগুলো
বিভিন্ন HTTP/demux error।

**Manual retry পরীক্ষা:** `retry_error_url_channels.delay()` দুইবার ট্রিগার করে ~১৩টা চ্যানেল
retry করা হয় — প্রতিটা নতুন PID নিয়ে চালু হয় (যেমন 9XM TV: PID=474→PID=512, মাত্র ২৪ সেকেন্ডে)
কিন্তু **প্রতিবারই দ্রুত আবার "unexpectedly terminated" status-এ ফিরে যায়**। celery-worker তখন
মাত্র ~2.2GiB/10GiB ব্যবহার করছিল (headroom প্রচুর) — তাই এটা memory/OOM কারণ না।

**সিদ্ধান্ত:** এটা persistent source-URL সমস্যা (dead/broken upstream IPTV link বা কোডেক
অসামঞ্জস্য) — **Docker/infra-এর কাজ না, content-management/admin panel review প্রয়োজন।**
এই ৯২টা চ্যানেলের source URL individually verify করা দরকার। কোনো Docker/কোড পরিবর্তন করা হয়নি
এই ফাইন্ডিং-এর জন্য — শুধু existing task manually trigger করে diagnose করা হয়েছে।

**[১৯:১৮-১৯:২৩ ফলো-আপ] Group-1 রিকভারি:** ব্যবহারকারীর অনুরোধে জানা যায় `retry_error_url_channels`
task ইচ্ছাকৃতভাবে শুধু recent-viewer-interest (`livetv_viewer_ping_{id}` cache key) থাকা চ্যানেলই
retry করে — dead feed-এ বৃথা বারবার hit এড়াতে (কোড পড়ে নিশ্চিত করা হয়েছে, `livetv/tasks.py:43-61`,
কোনো পরিবর্তন করা হয়নি)। তাই ২৮টা "ffmpeg not found" (stale, pre-fix) চ্যানেল কখনো auto-retry
হয়নি — কোনো viewer সাম্প্রতিক request করেনি বলে। ব্যবহারকারীর approval নিয়ে ২১টা এই ধরনের চ্যানেলে
সরাসরি `StreamService.start_stream()` কল করা হয় (viewer-ping gate bypass করে, ম্যানুয়াল
one-time bulk retry, কোনো কোড পরিবর্তন ছাড়া)। **ফলাফল: ১৮/২১ (৮৬%) সফলভাবে `stopped` (সুস্থ)
অবস্থায় ফিরেছে।** শুধু ৩টা (ATN NEWS, B4U Kadak, Desh TV) genuinely broken প্রমাণিত (আবার
"unexpectedly terminated")। সামগ্রিক error count ৯২→৭০-এ নেমেছে। বাকি ~৭০টা চ্যানেল (মূলত group
২-৩, "unexpectedly terminated"/HTTP/demux error) সত্যিকারের dead/broken link — admin panel-এ
source URL review প্রয়োজন, Docker-side আর কিছু করার নেই।

## ১৩. [2026-07-09 ~১৯:৩৬-১৯:৫৯] — 🔴 CRITICAL INCIDENT ২: Host RAM সংকট → django-app OOM crash-loop

**ট্রিগার:** host RAM মাত্র ৮০৮Mi ফ্রি, celery-worker একাই ৩.৭-৪GiB ব্যবহার করছিল (bulk-recovered
চ্যানেল + real viewer demand)। `keep-warm-livetv-channels` disable করেও (DB flag) RAM কমেনি —
সব active চ্যানেলে real viewer ping ছিল, waste না।

**Escalation:** admin panel-এ "Failed to delete channel"/"Failed to load data" — লগে নিশ্চিত হয়
**django-app নিজেই OOM-kill হচ্ছে** (`Worker was sent SIGKILL! Perhaps out of memory?`)। Root
cause: host physical RAM শেষ হলে kernel OOM-killer কন্টেইনার boundary না মেনে যেকোনো প্রসেস kill
করে — celery-worker-এর উচ্চ (কিন্তু বৈধ) ব্যবহার পরোক্ষভাবে django-app-কে ভেঙেছে।

**পদক্ষেপ ১:** ব্যবহারকারীর approval নিয়ে সব active (live+starting) LiveTV চ্যানেল (২৩টা)
`StreamService.stop_stream()` দিয়ে একসাথে বন্ধ — RAM ৮০৮Mi→২.৫Gi ফ্রি, celery-worker ৪GiB→৯৬০MiB।

**পদক্ষেপ ২:** তবু django-app SIGKILL হচ্ছিল — দেখা যায় **django-app নিজের ১GiB limit**-এই crash-loop
করছে (৯৯.৯২%, RestartCount বাড়েনি কারণ gunicorn master worker auto-respawn করছিল, কিন্তু
`OOMKilled=true`)। ব্যবহারকারীর approval নিয়ে django-app memory 1024M→**2048M**, শুধু django-app
recreate (`--no-deps`, celery-worker/beat অক্ষত)।

**ফলাফল:** SIGKILL সম্পূর্ণ বন্ধ (১৫/মিনিট → ০), HTTPS 302 ✅, host RAM স্থিতিশীল (~২.৩Gi ফ্রি)।

**শিক্ষা:** cgroup memory limit শুধু নিজ কন্টেইনার protect করে, host-wide OOM থেকে না। ভবিষ্যতে
LiveTV-র concurrent-channel সংখ্যা host capacity ছাড়িয়ে গেলে আবার এই ধরনের cascade হতে পারে —
max-concurrent-relay cap বা per-channel মেমরি অপ্টিমাইজেশন ভবিষ্যতে বিবেচনা করা উচিত।
