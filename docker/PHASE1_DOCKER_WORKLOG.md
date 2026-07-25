# Phase-1 Docker Work Log

> Format: প্রতিটি session-এর শেষে entry যোগ করুন। সবচেয়ে নতুন এন্ট্রি উপরে।

---

### [2026-07-09] — ✅ স্থায়ী FIX: LiveTV lazy-start এখন celery-worker-এ dispatch হয় (django-app OOM root cause সমাধান)

**পরিবর্তিত ফাইল:** `livetv/tasks.py` (নতুন task `livetv.start_channel_relay`),
`mobile_api/api/views.py` (`AppLiveTVStreamProxyView._maybe_start_relay`,
`._prewarm_one_neighbor`) — Docker image rebuild + django-app/celery-worker recreate।

**কী করা হয়েছে:** আগের entry-তে চিহ্নিত root cause (ffmpeg relay django-app-এর নিজের
gunicorn request-thread-এ spawn হচ্ছিল, HTTP/admin traffic-এর সাথে memory প্রতিযোগিতা করে
বারবার OOM crash-loop করছিল) সমাধান করা হয়েছে ব্যবহারকারীর explicit approval নিয়ে:

1. `livetv/tasks.py`-এ নতুন `@shared_task(name='livetv.start_channel_relay')` যোগ করা
   হয়েছে — `StreamService.start_stream()` এখন এই task-এর ভেতরে চলে (celery-worker-এর
   process/cgroup-এ, django-app-এর না)
2. `mobile_api/api/views.py`-এর `_maybe_start_relay()` (মূল viewer lazy-start) থেকে
   `threading.Thread(...).start()` সরিয়ে `start_channel_relay.delay(channel.id)` দিয়ে
   প্রতিস্থাপন করা হয়েছে
3. `_prewarm_one_neighbor()` (adjacent-channel prewarm, viewer Prev/Next করলে ট্রিগার হয় —
   একসাথে কয়েকটা চ্যানেল শুরু করানোর সবচেয়ে বড় contributor ছিল) থেকেও একইভাবে সরাসরি
   `StreamService.start_stream()` কল সরিয়ে celery dispatch করা হয়েছে
4. Duplicate-start guard (`cache.add(lock_key, ...)`) অপরিবর্তিত রাখা হয়েছে — শুধু heavy
   কাজ (ffmpeg spawn) django-app থেকে সরানো হয়েছে, locking logic টাচ হয়নি
5. `docker compose build` + `docker compose up -d --no-deps django-app celery-worker`
   (celery-beat টাচ হয়নি)
6. Verified: টেস্ট চ্যানেল (9XM TV) manually dispatch করে নিশ্চিত করা হয়েছে ffmpeg এখন
   celery-worker-এর লগে `started PID=...` দেখাচ্ছে, django-app-এ কোনো `stream_service`
   লগ আসছে না

**Side Effect / সতর্কতা:**
- এই ফিক্সের ফলে django-app-এর memory ব্যবহার এখন থেকে LiveTV viewer সংখ্যার সাথে বাড়বে না
  — শুধু celery-worker-এর (১০GiB budget) সাথে scale করবে, যেটা এই কাজের জন্যই ডিজাইন করা
- django-app-এর memory limit (2GiB, আগের incident-এ বাড়ানো হয়েছিল) আপাতত এভাবেই রাখা হয়েছে
  — এখন সেটা শুধু ওয়েব/admin/billing traffic-এর জন্য যথেষ্ট হওয়া উচিত, কমানো হয়নি (রক্ষণশীল)
- `keep-warm-livetv-channels` periodic task এখনো disabled (আগের incident থেকে) — lazy-start
  আর্কিটেকচারের সাথে এটা সামঞ্জস্যপূর্ণ, re-enable করার দরকার নেই
- host nginx/MySQL/Redis/FreeRADIUS/Asterisk/SNMP টাচ হয়নি। billing/RADIUS/MikroTik কোড টাচ
  হয়নি (CLAUDE.md constraint অনুযায়ী)

**Tested:** হ্যাঁ — syntax check (`ast.parse`), `docker compose build` সফল, django-app/
celery-worker recreate-এর পর HTTPS 302 ✅, `observe_phase1_celery.sh` exit 0, manual task
dispatch দিয়ে confirm করা হয়েছে ffmpeg এখন celery-worker-এ spawn হচ্ছে (django-app-এ না)।

**Next:** কিছুক্ষণ real viewer traffic-এর সাথে পর্যবেক্ষণ করে নিশ্চিত হওয়া উচিত django-app আর
কখনো OOM crash-loop করছে না viewer সংখ্যা বাড়লেও। celery-worker-এর ১০GiB budget-ও পর্যবেক্ষণে
রাখা উচিত (এখন এটাই একমাত্র জায়গা যেখানে LiveTV memory pressure যাবে)।

---

### [2026-07-09] — 🔴 django-app OOM পুনরায় ঘটেছে (~২ ঘণ্টার মধ্যে ৩য়বার) — architectural root cause চিহ্নিত, স্থায়ী কোড-ফিক্স প্রয়োজন

**পরিবর্তিত ফাইল:** কোনো ফাইল পরিবর্তন হয়নি এই entry-তে — শুধু আবার mass channel-stop (data-only
action, `StreamService.stop_stream()`)। `docker-compose.yml`/কোড টাচ হয়নি।

**কী হয়েছিল:** django-app-এর memory limit 1G→2G বাড়ানোর ~১ ঘণ্টা পর আবার SIGKILL crash-loop শুরু
হয় (django-app 1.674GiB/2GiB, 285 PIDs, ১৫ SIGKILL/মিনিট, host RAM আবার ৮০৮Mi-তে নেমে যায়)।

**🔑 Root cause চিহ্নিত (এবার নিশ্চিত):** django-app-এর নিজের লগে দেখা যায়
`INFO ... stream_service '<channel>' [url] started PID=...` লাইনগুলো **django-app কন্টেইনার
থেকেই** আসছে, celery-worker থেকে না। অর্থাৎ বর্তমান lazy-start আর্কিটেকচারে (অন্য session/agent-এর
করা `livetv/tasks.py`/`mobile_api` রিফ্যাক্টর) **ffmpeg relay subprocess সরাসরি django-app-এর
gunicorn request-handling process থেকে spawn হয়** — HTTP/admin traffic-এর সাথে একই memory
budget-এর জন্য প্রতিযোগিতা করে। এটাই কেন শুধু memory limit বাড়ানো সাময়িক সমাধান মাত্র — viewer
সংখ্যা বাড়লেই আবার crash-loop ফিরে আসবে (এই session-এই ২ ঘণ্টায় ৩ বার ঘটেছে)।

**তাৎক্ষণিক মিটিগেশন:** ব্যবহারকারীর approval নিয়ে আবার সব active LiveTV চ্যানেল বন্ধ করা হয়
(`StreamService.stop_stream()`)। django-app 1.362GiB/2GiB-এ নেমেছে, SIGKILL বন্ধ, কিন্তু PIDs
এখনো তুলনামূলক বেশি (২২৫)।

**⚠️ এটা স্থায়ী সমাধান না — শুধু symptom suppress করা হয়েছে।** প্রকৃত ফিক্সের জন্য কোড-লেভেল
পরিবর্তন দরকার (এই session-এর scope-এর বাইরে, developer approval/review প্রয়োজন):
- `mobile_api.AppLiveTVStreamProxyView`-এর lazy-start call synchronous ভাবে django-app
  process-এ ffmpeg spawn না করে, celery task হিসেবে dispatch করা উচিত (celery-worker-এর আলাদা
  ১০GiB বাজেটে, django-app-এর web-serving বাজেট থেকে সম্পূর্ণ আলাদা)
- অথবা: relay-management-এর জন্য django-app/celery-worker থেকে সম্পূর্ণ আলাদা একটা dedicated
  service/container বিবেচনা করা যেতে পারে (বড় refactor, এই ফেজের বাইরে)

**Side Effect / সতর্কতা:** পরবর্তী agent/developer — এই প্যাটার্ন আবার দেখা দিলে (django-app
নিজের limit-এ crash করছে, PID সংখ্যা বেশি, লগে `stream_service ... started PID=` django-app
কন্টেইনার থেকে) — এটা একই root cause, শুধু আবার memory বাড়িয়ে/চ্যানেল বন্ধ করে সাময়িক relief
দেওয়া যথেষ্ট না, কোড-লেভেল ফিক্সের জন্য escalate করা উচিত।

**Tested:** হ্যাঁ — SIGKILL count (আগে/পরে), `docker stats`, `free -h`, django-app লগ গ্রেপ করে
`stream_service` লাইনের উৎস নিশ্চিত করা হয়েছে।

**Next:** কোড-লেভেল architectural fix নিয়ে ডেভেলপার/user-এর সাথে আলোচনা প্রয়োজন — এই worklog
entry সেই আলোচনার জন্য প্রেক্ষাপট প্রদান করে।

---

### [2026-07-09] — 🔴 CRITICAL INCIDENT ২: Host RAM সংকট → django-app OOM crash-loop → mass channel-stop + django-app memory 1G→2G

**পরিবর্তিত ফাইল:** `docker-compose.yml`, `docker/PHASE1_STABILITY_SCORECARD.md`,
`docker/PHASE1_DOCKER_WORKLOG.md`। এছাড়া `django_celery_beat.PeriodicTask` (id=15,
keep-warm-livetv-channels) DB-তে `enabled=False` করা হয়েছে (কোড পরিবর্তন না, ইতিমধ্যে অন্য
কেউ/agent `livetv/tasks.py`-ও lazy-start আর্কিটেকচারে রিফ্যাক্টর করেছে — keep_warm সরিয়ে
mobile_api ভিউ থেকে সরাসরি lazy-start, ও retry_error_url_channels-এ duplicate-spawn lock)।

**কী হয়েছিল:**
1. আগের incident resolve হওয়ার পর ব্যবহারকারী জানান host RAM ব্যবহার না করে LiveTV দেখানো দরকার
2. তদন্তে দেখা যায় host RAM মাত্র ৮০৮Mi ফ্রি (১২Gi/১৪Gi ব্যবহৃত), celery-worker একাই ৩.৭-৪GiB
   ব্যবহার করছিল bulk-recovery-এর ফলে অনেক চ্যানেল সমান্তরালে চালু থাকায়
3. `keep-warm-livetv-channels` periodic task disable করা হয় (DB flag), কিন্তু RAM কমেনি —
   `sweep_idle_url_relays` চেক করে দেখা যায় সব active চ্যানেলে real viewer ping ছিল (waste না,
   real demand)
4. ব্যবহারকারী প্রথমে "বর্তমান অবস্থা মেনে নিন" সিদ্ধান্ত নেন, কিন্তু এর কিছুক্ষণ পর admin panel-এ
   "Failed to delete channel"/"Failed to load data" স্ক্রিনশট আসে
5. লগে পাওয়া যায় **django-app নিজেই OOM-kill হচ্ছে**: `Worker (pid:...) was sent SIGKILL!
   Perhaps out of memory?` — কারণ host-এর physical RAM প্রায় শেষ হওয়ায় kernel OOM-killer
   container boundary না মেনে django-app-এর gunicorn worker-ও kill করছিল
6. ব্যবহারকারীর approval নিয়ে সব active (live+starting) LiveTV চ্যানেল (২৩টা) `StreamService.
   stop_stream()` দিয়ে একসাথে বন্ধ করা হয় — host RAM ৮০৮Mi→২.৫Gi ফ্রি-তে ফিরে আসে, celery-worker
   ৪GiB→৯৬০MiB-এ নামে
7. কিন্তু django-app তখনো SIGKILL হচ্ছিল — দেখা যায় এবার **django-app নিজের ১GiB cgroup
   limit**-এই crash-loop করছে (৯৯.৯২% ব্যবহার, host RAM headroom থাকা সত্ত্বেও)
8. ব্যবহারকারীর approval নিয়ে django-app memory limit **1024M→2048M** বাড়িয়ে শুধু django-app
   recreate করা হয় (`--no-deps`, celery-worker/celery-beat অক্ষত)। SIGKILL সম্পূর্ণ বন্ধ হয়

**Side Effect / সতর্কতা:**
- ২৩টা active LiveTV চ্যানেল জোরপূর্বক বন্ধ হয়েছে — real viewer-রা সাময়িক বিচ্ছিন্ন হয়েছেন,
  পরের request-এই lazy-start দিয়ে আবার চালু হবে (নতুন lazy-start আর্কিটেকচার অনুযায়ী)
- django-app recreate-এর সময় সংক্ষিপ্ত downtime হতে পারে (কয়েক সেকেন্ড)
- **মূল শিক্ষা:** Docker container-level memory limit (cgroup) শুধু সেই কন্টেইনারকে protect করে
  — host-এর নিজের physical RAM শেষ হয়ে গেলে kernel OOM-killer **সব কন্টেইনারের প্রসেস**-কে
  এলোমেলোভাবে kill করতে পারে, শুধু "অপরাধী" কন্টেইনারকে না। তাই celery-worker-এর real (উচ্চ)
  মেমরি ব্যবহার পরোক্ষভাবে django-app-কে ভাঙতে পেরেছিল
- host nginx/MySQL/Redis/FreeRADIUS/Asterisk/SNMP টাচ হয়নি

**Tested:** হ্যাঁ — `free -h` (RAM trend), `docker stats`/`docker inspect RestartCount/OOMKilled`,
django-app লগে SIGKILL count (আগে ১৫/মিনিট, পরে ০), HTTPS 302 চেক।

**Next:** LiveTV-র সামগ্রিক concurrent-channel RAM চাহিদা host capacity-র তুলনায় এখনো বেশি হতে
পারে — viewer বাড়লে আবার চাপ আসতে পারে। ভবিষ্যতে বিবেচনা করা উচিত: (ক) max-concurrent-relay
hard cap কোড-লেভেলে, (খ) per-channel ffmpeg মেমরি কমানো, (গ) host RAM upgrade। django-app
2GiB limit-ও ভবিষ্যতে চাপে পড়লে আরও বাড়ানো লাগতে পারে।

---

### [2026-07-09] — 🔴 CRITICAL INCIDENT: celery-worker OOM crash-loop → LiveTV outage → memory limit 768M→10G দিয়ে সমাধান

**পরিবর্তিত ফাইল:** `docker-compose.yml`, `docker/PHASE1_DOCKER_RUNBOOK.md`,
`docker/PHASE1_STABILITY_SCORECARD.md`, `docker/PHASE1_DOCKER_WORKLOG.md`

**কী হয়েছিল:**
1. ব্যবহারকারী রিপোর্ট করেন: "লাইভ টিভি অ্যাপসে নিরবিচ্ছিন্ন ভিডিও চলছে না"
2. তদন্তে পাওয়া যায়: গত ৫ মিনিটে ৪৫/৫৫ (৮২%) LiveTV `.m3u8` request `503 Service Unavailable`
3. Root cause: আগের session-এ celery-worker-এর memory limit 512M→768M বাড়াতে container
   recreate করা হয়েছিল — কিন্তু LiveTV `url`-টাইপ চ্যানেলের ffmpeg relay subprocess-গুলো
   celery-worker container-এরই child process, তাই recreate সব relay killed করে দেয়
4. `docker events` দিয়ে নিশ্চিত হয় celery-worker **768MiB limit-এও crash-loop করছিল**
   (একাধিক `container oom` ইভেন্ট, `die exitCode=137`, `RestartCount` ক্রমাগত বাড়ছিল ০→১→২→৩)
   — কারণ ৪০-৫০টা সমান্তরাল ffmpeg relay চালাতে বাস্তবে ২-৪GiB+ লাগে (৭৬৮MiB-তে মাত্র ১৪টা
   চ্যানেল চালু হতেই ১.২৬GiB ব্যবহার হয়ে গিয়েছিল)
5. ব্যবহারকারীর approval নিয়ে `keep_warm_channels` task ম্যানুয়ালি ট্রিগার করা হয় (কোনো কোড
   পরিবর্তন ছাড়া, `.delay()` দিয়ে) — এটা আংশিক সাহায্য করে কিন্তু crash-loop অব্যাহত থাকে
6. ব্যবহারকারীর approval নিয়ে (AskUserQuestion-এ "10GB" উত্তর) memory limit 768M→**10G**-এ
   বাড়ানো হয় — host-এ তখন 6.2Gi available ছিল, 10G শুধু ceiling হিসেবে ব্যবহৃত হয় (pre-allocate
   হয় না)। এরপর crash-loop সম্পূর্ণ বন্ধ হয়ে যায় (`RestartCount=0` স্থিতিশীল)

**Side Effect / সতর্কতা:**
- **এই ঘটনা প্রমাণ করেছে celery-worker recreate করা এখন থেকে risky** — যেকোনো ভবিষ্যৎ recreate
  (memory limit পরিবর্তন, কোড deploy, ইত্যাদি) সব LiveTV relay বন্ধ করে দেবে এবং পুনরায় warm
  হওয়া পর্যন্ত viewer-রা সাময়িক 503 পেতে পারেন — এটা এখন known/expected, `PHASE1_DOCKER_RUNBOOK.md`-এ
  documented
- Memory limit 10GiB — অনেক generous, কিন্তু host-এর 14Gi RAM-এর তুলনায় এটা শুধু একটা ceiling/
  guardrail, বাস্তব ব্যবহার এখন পর্যন্ত ~1.9GiB (৩৬+/৫০ চ্যানেল warm)
- host `.env`/`.env.docker` টাচ করা হয়নি এই session-এ (আগের session-এর SECRET_KEY fix অক্ষত)
- host nginx/MySQL/Redis/FreeRADIUS/Asterisk/SNMP টাচ হয়নি

**Tested:** হ্যাঁ — HTTPS m3u8 request status-code distribution (আগে ৪৫/৫৫ fail, পরে ~৫২/৫৪ সফল),
`docker events`/`docker inspect RestartCount`/`docker stats` দিয়ে crash-loop নিশ্চিতকরণ ও পরে
স্থিতিশীলতা যাচাই, `keep_warm_channels` task ফলাফল (already_warm ক্রমাগত বৃদ্ধি: ০→১০→৩৬)।

**Next:** সব ৫০টা চ্যানেল পুরোপুরি warm হওয়া পর্যন্ত পর্যবেক্ষণ চালিয়ে যাওয়া, পিক মেমরি ব্যবহার
নোট করা (ভবিষ্যতে limit fine-tune করার জন্য ডেটা)। ভবিষ্যতে celery-worker recreate করার আগে
runbook-এর নতুন সতর্কতা অনুসরণ করা আবশ্যক।

---

### [2026-07-09] — celery-worker memory limit বাড়ানো (512M→768M) + `.env.docker` SECRET_KEY `$` escape fix

**পরিবর্তিত ফাইল:** `docker-compose.yml`, `.env.docker`, `docker/PHASE1_DOCKER_RUNBOOK.md`,
`docker/PHASE1_STABILITY_SCORECARD.md`, `docker/PHASE1_DOCKER_WORKLOG.md`

**কী করা হয়েছে:**
1. `docker-compose.yml`-এ শুধু `celery-worker`-এর `deploy.resources.limits.memory` 512M থেকে
   768M-এ বাড়ানো হয়েছে (CPU 1.0 অপরিবর্তিত, django-app/celery-beat টাচ হয়নি)
2. Pre-check স্বাস্থ্যকর নিশ্চিত করে শুধু `docker compose up -d --no-deps celery-worker`
   চালানো হয়েছে — django-app ও celery-beat "Running" (recreate হয়নি)
3. `docker inspect` দিয়ে নতুন limit verified: `Memory=805306368` (=768MiB exactly),
   `NanoCpus=1000000000` (=1.0, অপরিবর্তিত)
4. `.env.docker`-এর `SECRET_KEY`-তে থাকা ২টা literal `$` (px5, y8 substring-এর অংশ) `$$`-এ
   escape করা হয়েছে — Python script দিয়ে শুধু length compare করে verify (কোনো value print
   করা হয়নি), backup রাখা হয়েছে (`.env.docker.bak-20260709-183827`, permission 600)
5. Ownership/permission অক্ষত রাখতে `cat tmp > .env.docker` ব্যবহার হয়েছে (mv না করে —
   আগের mv-bug লেসন অনুসরণ করে)

**Side Effect / সতর্কতা:**
- celery-worker recreate-এর সময় সংক্ষিপ্ত task-processing gap হয়েছে (সেকেন্ড কয়েক), django-app/
  celery-beat/HTTPS/host nginx/MySQL/Redis টাচ হয়নি
- **⚠️ celery-worker মেমরি এখনো tight:** 768MiB limit-এও baseline usage ~98% (৭৫৩-৭৫৪MiB) —
  কিন্তু ৪+ মিনিট পর্যবেক্ষণে (একটা ভারী ৩-OLT sync task সহ) সম্পূর্ণ স্থির ছিল, বাড়েনি। সম্ভবত
  page-cache-প্রধান, active leak না — কিন্তু নিশ্চিত না, নিবিড় পর্যবেক্ষণ চালিয়ে যেতে হবে
- **host `.env` ইচ্ছাকৃতভাবে touch করা হয়নি** — systemd/native gunicorn/django-environ literal
  parse করে, `$$` escaping বুঝবে না, escape করলে real host SECRET_KEY corrupt হয়ে যাবে
- `.env`-এর নিজের SECRET_KEY অপরিবর্তিত থাকায় `px5`/`y8` warning সম্পূর্ণ যায়নি — এটা এখন
  cosmetic-only (container env-এ প্রভাব নেই, শুধু `.env.docker`-ই `env_file:`-এ ব্যবহৃত হয়)
- `COMPOSE_DISABLE_ENV_FILE=1` টেস্ট করা হয়েছিল কিন্তু অনির্ভরযোগ্য প্রমাণিত (officially
  documented না, sub-command ভেদে ভিন্ন আচরণ) — ভবিষ্যতে ব্যবহারের সুপারিশ করা হচ্ছে না

**Tested:** হ্যাঁ — pre/post HTTPS admin/API/static status, `docker compose ps`,
`observe_phase1_celery.sh` (দুইবার, exit 0 উভয়বার), `docker inspect`/`docker stats` দিয়ে নতুন
limit ও memory trend (৪+ মিনিট), duplicate-beat guard, worker/beat task success log।

**Next:** celery-worker মেমরি ট্রেন্ড আরও লম্বা সময় (কয়েক ঘণ্টা+) পর্যবেক্ষণ করা, OOMKill হলে
আরও limit বাড়ানো বা root-cause (কোন task/library baseline memory নিচ্ছে) investigate করা।
SECRET_KEY-এর host `.env` অংশ নিয়ে কোনো নতুন approval ছাড়া কিছু করা হবে না।

---

### [2026-07-09] — Docker resource limits applied to production containers

**পরিবর্তিত ফাইল:** `docker-compose.yml`, `docker/PHASE1_STABILITY_SCORECARD.md`, `docker/PHASE1_DOCKER_WORKLOG.md`, `docker/PHASE1_DOCKER_RUNBOOK.md`

**কী করা হয়েছে:**
- `django-app`/`celery-worker`/`celery-beat`-এ `deploy.resources.limits` (CPU/memory) যোগ করা হয়েছিল আগের turn-এ (django-app: 1GiB/1.0 CPU, celery-worker: 512MiB/1.0 CPU, celery-beat: 512MiB/0.5 CPU)
- এই session-এ approval অনুযায়ী শুধু ঐ ৩টা সার্ভিস recreate করে limit apply করা হয়েছে: `docker compose up -d --no-deps django-app celery-worker celery-beat`
- Pre-apply ও post-apply health snapshot, `docker stats`/`docker inspect` দিয়ে limit সত্যিই কার্যকর হয়েছে কিনা যাচাই করা হয়েছে — নিশ্চিত হয়েছে (django-app Memory=1073741824/NanoCpus=1e9, celery-worker Memory=536870912/NanoCpus=1e9, celery-beat Memory=536870912/NanoCpus=5e8)

**Side Effect / সতর্কতা:**
- django-app recreate-এর সময় সংক্ষিপ্ত (কয়েক সেকেন্ড) সম্ভাব্য web disruption হতে পারে — HTTPS চেক recreate-এর পরপরই ঠিক response দিয়েছে (302/404/200), কোনো downtime observe করা যায়নি
- host nginx/MySQL/Redis/FreeRADIUS/Asterisk/SNMP টাচ করা হয়নি; পুরনো systemd gunicorn/celery/celery-beat আগের রোলব্যাক-সেফটি অবস্থাতেই আছে
- **⚠️ ঝুঁকি চিহ্নিত:** `celery-worker` recreate-এর পর থেকে ক্রমাগত ~510MiB/512MiB (~99.7-99.9%) মেমরি ব্যবহার করছে — লিমিটের একদম কিনারায়। ২ মিনিট পর্যবেক্ষণে কোনো OOMKill/restart হয়নি, কিন্তু ভবিষ্যতে load spike (একাধিক ffmpeg subprocess/ভারী OLT sync একসাথে) হলে OOMKill হওয়ার সম্ভাবনা আছে। পরবর্তী পদক্ষেপ: memory limit বাড়ানো (যেমন 768MiB) বিবেচনা করা উচিত অথবা নিবিড়ভাবে পর্যবেক্ষণ চালিয়ে যাওয়া
- **⚠️ পৃথক পূর্ব-বিদ্যমান ইস্যু চিহ্নিত (এই কাজের সাথে সম্পর্কহীন):** `docker compose` কমান্ডের `"px5"`/`"y8"` variable-not-set warning-এর উৎস পাওয়া গেছে — `.env` ও `.env.docker`-এর `SECRET_KEY` (লাইন ৫)-এ `$` সংবলিত substring আছে যেগুলো Compose `${px5}`/`${y8}` হিসেবে interpolate করার চেষ্টা করছে। এটা সম্ভবত `SECRET_KEY`-কে silently ভুল/truncated ভ্যালুতে পরিণত করতে পারে যখন `env_file:` দিয়ে container-এ লোড হয় — যাচাই করার জন্য container-এর ভেতরে exec করে actual env var length compare করার চেষ্টা করা হয়েছিল কিন্তু auto-mode permission classifier সেটা block করেছে (production secret runtime state পড়া, explicit user approval ছাড়া)। **কোনো fix apply করা হয়নি — শুধু চিহ্নিত করা হয়েছে, ব্যবহারকারীর সিদ্ধান্তের অপেক্ষায়।**

**Tested:** হ্যাঁ — pre/post HTTPS admin/API/static status, `docker compose ps`, `observe_phase1_celery.sh` (দুইবার, exit 0), `docker stats`/`docker inspect` দিয়ে limit ভ্যালু, django-app/worker/beat লগ (task success/scheduler/error filtered)।

**Next:** celery-worker-এর মেমরি ব্যবহার নিবিড়ভাবে পর্যবেক্ষণ করা (limit বাড়ানো লাগতে পারে), SECRET_KEY `$` ইস্যু নিয়ে ব্যবহারকারীর সিদ্ধান্ত নেওয়া (escape with `$$` নাকি অন্য fix), দৈনিক billing window observe করা চালিয়ে যাওয়া।

---

### [2026-07-09] — Master audit (Tasks A–H): health snapshot, duplicate-infra audit, compose hardening review, disable-readiness, future roadmap docs

**পরিবর্তিত ফাইল:**
- `docker/PHASE1_DOCKER_RUNBOOK.md` (নতুন — দৈনন্দিন কমান্ড/রোলব্যাক quick-reference)
- `docker/DOCKER_REMAINING_WORK.md` (নতুন — duplicate-infra audit ফলাফল, MySQL/Redis/nginx/
  FreeRADIUS/Asterisk/SNMP ভবিষ্যৎ roadmap, compose hardening review ফলাফল)
- `docker/PHASE1_DOCKER_WORKLOG.md` (নতুন — এই ফাইল)
- `docker/PHASE1_STABILITY_SCORECARD.md` (আপডেট — এই session-এর observation entry)

**কী করা হয়েছে (শুধু read-only audit, কোনো config/কোড পরিবর্তন হয়নি):**
- সম্পূর্ণ production health snapshot: সব systemd সার্ভিস, HTTPS endpoint curl test,
  `observe_phase1_celery.sh`, django-app/celery-worker লগ — সব স্বাভাবিক, কোনো anomaly নেই
- Duplicate infrastructure audit: কোনো পুরনো/duplicate Docker MySQL বা Redis container নেই
  (কখনো ছিলই না), Docker Desktop VM চলছে না, Docker nginx টেস্ট container `Exited (0)`
  অবস্থায় (harmless, প্রোডাকশনে ব্যবহৃত হয় না)। মেমরি/swap pressure সম্পূর্ণ desktop
  অ্যাপ (SonarLint/Chrome/VS Code) থেকে, Docker-বহির্ভূত
- Safe cleanup command প্রস্তুত করা হয়েছে (`docker compose rm -f nginx`) কিন্তু **এক্সিকিউট করা হয়নি**
  — জরুরি না, exited container রিসোর্স খরচ করছে না
- `docker-compose.yml` hardening review: restart policy, pinned subnet, extra_hosts,
  env_file/no-hardcoded-secrets, single celery-beat definition — সব ঠিক আছে, কোনো গ্যাপ পাওয়া যায়নি
- systemd disable-readiness পুনর্মূল্যায়ন: celery ও gunicorn দুটোই **এখনো প্রস্তুত না**
  (দৈনিক billing window এখনো cover হয়নি, cutover থেকে মাত্র কয়েক ঘণ্টা পার হয়েছে)
- ভবিষ্যৎ roadmap ডকুমেন্টেড (কোনো এক্সিকিউশন না): MySQL/Redis containerization নিম্ন/মাঝারি
  অগ্রাধিকার, Docker nginx full hardening (Option 2) নিম্ন অগ্রাধিকার, FreeRADIUS/Asterisk/SNMP
  স্থায়ীভাবে host-native রাখার সুপারিশ (UDP/NAT/CAP_NET_BIND_SERVICE ঝুঁকির কারণে)

**Side Effect / সতর্কতা:**
- কোনো side effect নেই — এই session-এ শুধু read-only কমান্ড ও নতুন documentation ফাইল লেখা হয়েছে।
  Docker কন্টেইনার, systemd সার্ভিস, nginx config, MySQL/Redis config — কিছুই টাচ করা হয়নি।
- পরবর্তী agent-এর জন্য: `docker/DOCKER_REMAINING_WORK.md` সেকশন C-তে systemd disable-এর জন্য
  পরবর্তী চেকপয়েন্ট বলা আছে (পরের রাত ১২টার পরের billing task verify করা)।

**Tested:** হ্যাঁ — সব audit কমান্ড read-only ভাবে চালিয়ে যাচাই করা হয়েছে (`docker ps`,
`docker inspect`, `systemctl is-active`, `ps aux`, `docker context ls`, compose ফাইল পাঠ)।
কোনো write/mutating কমান্ড এই session-এ চালানো হয়নি।

---

*এর আগের সব কাজের ইতিহাসের জন্য `PHASE1_STABILITY_SCORECARD.md`-এর Observation Timeline দেখুন।*
