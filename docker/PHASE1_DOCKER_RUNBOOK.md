# Phase-1 Docker Runbook — ISP-BNAS

> এই ডকুমেন্ট দৈনন্দিন অপারেশনের জন্য quick-reference। ইতিহাস/রিসার্চের জন্য
> `PHASE1_STABILITY_SCORECARD.md` দেখুন, ভবিষ্যৎ কাজের জন্য `DOCKER_REMAINING_WORK.md`।

## ১. বর্তমান আর্কিটেকচার (২০২৬-০৭-০৯ পর্যন্ত)

```
Internet → 80/443 → হোস্ট Nginx (systemd, SSL/HSTS/walled-garden)
                        │  upstream isp_django → 127.0.0.1:8001
                        ▼
              Docker django-app (গানিকর্ন, ৩ workers)  ← PRODUCTION ACTIVE
              Docker celery-worker                       ← PRODUCTION ACTIVE
              Docker celery-beat                          ← PRODUCTION ACTIVE
              Docker nginx (টেস্ট, 8081/8091)              ← EXITED, অব্যবহৃত

হোস্ট-নেটিভ (কখনো ডকারাইজ হবে না এই ফেজে):
  MySQL (isp_bnas + radius DB), Redis, FreeRADIUS, Asterisk, coturn, SNMP listener

Safety net (idle, রোলব্যাকের জন্য চালু রাখা আছে, disable করা হয়নি):
  systemd isp-gunicorn.service   → active কিন্তু ট্রাফিক পাচ্ছে না (127.0.0.1:8000)
  systemd isp-celery.service     → failed অবস্থায় (ইচ্ছাকৃত, রোলব্যাক নথিভুক্ত)
  systemd isp-celery-beat.service → inactive (ইচ্ছাকৃত — duplicate scheduler এড়াতে)
```

## ১.১ Resource Limits (২০২৬-০৭-০৯ থেকে সক্রিয়)

`docker-compose.yml`-এ `deploy.resources.limits` যোগ করে recreate করা হয়েছে ও `docker inspect`
দিয়ে verified:

| সার্ভিস | Memory limit | CPU limit |
|---|---|---|
| django-app | 1GiB | 1.0 |
| celery-worker | **10GiB** (২০২৬-০৭-০৯ ১৮:৫৩-এ 768MiB থেকে বাড়ানো হয়েছে — কারণ নিচে দেখুন) | 1.0 |
| celery-beat | 512MiB | 0.5 |

> **🔴 CRITICAL INCIDENT (২০২৬-০৭-০৯ ১৮:৩৬-১৮:৫৩):** celery-worker-এ 512MiB/768MiB memory limit
> সেট করা **production outage সৃষ্টি করেছিল**। Root cause: LiveTV `url`-টাইপ চ্যানেলের ffmpeg relay
> subprocess-গুলো celery-worker container-এর child process — প্রতিবার container recreate হলে সব
> relay killed হয়ে যায় এবং পুনরায় শুরু হতে হয়। ৪০-৫০টা সমান্তরাল ffmpeg relay চালু করতে প্রকৃতপক্ষে
> **~2-4GiB+ মেমরি লাগে** (768MiB-তে মাত্র ১৪টা চ্যানেল চালু হতেই ১.২৬GiB ব্যবহার হয়ে গিয়েছিল) —
> ফলে 768MiB limit-এ পৌঁছেই বারবার **`OOMKill → auto-restart → সব relay মুছে যাওয়া → আবার চেষ্টা →
> আবার OOMKill`** crash-loop শুরু হয় (`docker events`-এ একাধিক `container oom`/`die exitCode=137`
> নিশ্চিত হয়েছে), যার ফলে viewer-রা `503 Service Unavailable` পেতে থাকেন (৫ মিনিটে ৮২% request
> fail)। **সমাধান:** limit 10GiB-এ বাড়ানো হয়েছে (host-এ তখন 6.2Gi available ছিল, ceiling হিসেবে
> ব্যবহৃত হয়, pre-allocate হয় না) — এরপর crash-loop বন্ধ হয়ে যায় এবং চ্যানেলগুলো স্বাভাবিকভাবে warm
> হতে শুরু করে (৭ মিনিটে ৯৬%+ request সফল, ~1.9GiB প্রকৃত ব্যবহার ৩৬/৫০ চ্যানেল warm অবস্থায়)।
>
> **শিক্ষা — ভবিষ্যতে যেকোনো celery-worker recreate করার আগে মনে রাখুন:**
> 1. celery-worker recreate করলে **সব চলমান LiveTV ffmpeg relay killed হয়ে যাবে** — এটা এখন
>    known/expected side effect, viewer-facing 503 spike হতে পারে যতক্ষণ না relay গুলো পুনরায়
>    warm হয় (স্বয়ংক্রিয়ভাবে `keep_warm_channels` scheduled task দিয়ে, অথবা ম্যানুয়ালি
>    `keep_warm_channels.delay()` ট্রিগার করে দ্রুত করা যায়)
> 2. memory limit **কখনো conservatively কম রাখবেন না** এই সার্ভিসের জন্য — বাস্তব peak load
>    (সব চ্যানেল সমান্তরাল warm) অনুযায়ী generous headroom রাখা জরুরি, নাহলে crash-loop হবে
> 3. recreate করার পর **অবশ্যই** `docker events --filter container=<id>` বা `docker inspect
>    --format RestartCount` দিয়ে OOM-loop চেক করুন, শুধু "Up X seconds" দেখে সন্তুষ্ট হবেন না

> **বর্তমান অবস্থা (10GiB limit-এর পর):** ~1.9GiB প্রকৃত ব্যবহার ৩৬+/৫০ চ্যানেল warm অবস্থায়,
> কোনো OOMKill/restart হয়নি। নিয়মিত `docker stats`/`docker inspect RestartCount` দিয়ে monitor
> করুন; আবার crash-loop দেখা গেলে (সব চ্যানেল একসাথে warm হলে পিক ব্যবহার আরও বাড়তে পারে) limit
> আরও বাড়ানো বা root-cause (কোন channel/library কতটা মেমরি নিচ্ছে) investigate করা প্রয়োজন হবে।

## ১.২ `.env.docker` SECRET_KEY `$` Escaping (২০২৬-০৭-০৯)

`.env.docker`-এর `SECRET_KEY`-তে literal `$` character ছিল যেগুলোকে Docker Compose
`${VAR}`-স্টাইল interpolation হিসেবে ভুল পড়ছিল (`"px5"`/`"y8" variable is not set` warning)।
প্রতিটা একক `$`-কে `$$`-এ escape করা হয়েছে (Compose-এর standard literal-dollar escaping) —
এতে container-এ inject হওয়া actual SECRET_KEY value অপরিবর্তিত থাকে, শুধু Compose-এর নিজের
parsing layer-এ ভুল substitution বন্ধ হয়।

- Backup রাখা হয়েছে: `.env.docker.bak-<timestamp>` (permission 600, secret-safe)
- **host `.env` ইচ্ছাকৃতভাবে touch করা হয়নি এবং ভবিষ্যতেও করা উচিত না** — কারণ systemd/native
  gunicorn ও django-environ `.env`-কে literal parse করে, `$$` escaping বুঝবে না; সেখানে `$$`
  লিখলে real host SECRET_KEY-ই ভুল/corrupt হয়ে যাবে (Compose-স্পেসিফিক escaping convention
  non-Docker consumer-এর জন্য প্রযোজ্য না)
- `.env`-এর নিজের SECRET_KEY-এর কারণে `px5`/`y8` warning সম্পূর্ণ যাবে না (Compose default
  project `.env` সবসময় auto-load করে) — এটা এখন **cosmetic-only noise**, container-এর actual
  env-এ কোনো প্রভাব নেই (যেহেতু `.env` কোনো সার্ভিসের `env_file:` না, শুধু `.env.docker`-ই)
- `COMPOSE_DISABLE_ENV_FILE=1` **অনির্ভরযোগ্য প্রমাণিত** (এই Compose v5.2.0-এ officially
  documented flag না — `docker compose --help`-এ নেই, `ps`/`config` sub-command-এ ভিন্ন আচরণ
  দেখিয়েছে) — এটা ভবিষ্যতের কমান্ডে সুপারিশ করা হচ্ছে না

**Apply/re-apply করতে (শুধু approved ৩টা সার্ভিস, nginx/DB টাচ হবে না):**
```bash
docker compose up -d --no-deps django-app celery-worker celery-beat
```

**Limit verify করতে:**
```bash
docker stats --no-stream $(docker compose ps -q django-app celery-worker celery-beat)
docker inspect $(docker compose ps -q django-app) --format 'Memory={{.HostConfig.Memory}} NanoCpus={{.HostConfig.NanoCpus}}'
```

## ২. দৈনন্দিন কমান্ড

**স্ট্যাটাস চেক (read-only):**
```bash
docker compose ps
docker compose logs --tail=50 django-app celery-worker celery-beat
sudo systemctl is-active isp-gunicorn isp-celery isp-celery-beat
bash docker/observe_phase1_celery.sh
```

**কোড পরিবর্তনের পর rebuild + redeploy (approval নিয়ে):**
```bash
docker compose build
docker compose up -d
```
> মাইগ্রেশন/collectstatic কখনো auto চলে না (entrypoint.sh ইচ্ছাকৃতভাবে চালায় না) —
> প্রয়োজনে ম্যানুয়ালি: `docker compose exec django-app python manage.py migrate`

**Django/Celery ইন্টারনাল কিছু চেক করতে হলে — কখনো host python নয়:**
```bash
# ✅ সঠিক
docker compose exec django-app python manage.py shell -c "..."
# ❌ ভুল — .env.sonarqube parse এরর দিয়ে টোকেন leak করে
python manage.py check
```

## ৩. রোলব্যাক (Rollback Commands)

**Nginx শুধু (upstream আবার 8000-এ):**
```bash
sudo bash docker/nginx_option1_upstream_patch.sh --rollback
```

**Celery শুধু:**
```bash
docker compose stop celery-beat celery-worker
sudo systemctl start isp-celery.service isp-celery-beat.service
systemctl is-active isp-celery.service isp-celery-beat.service
```

**সম্পূর্ণ Phase-1 রোলব্যাক (nginx + celery, gunicorn আগে থেকেই idle-active আছে):**
```bash
sudo bash docker/nginx_option1_upstream_patch.sh --rollback
docker compose stop celery-beat celery-worker
sudo systemctl start isp-celery.service isp-celery-beat.service
systemctl is-active isp-celery.service isp-celery-beat.service
```

## ৪. কখনো যা করা যাবে না (স্থায়ী নিয়ম)

- `.env.docker` ছাড়া `environment:` ব্লকে `REDIS_URL`/`CELERY_BROKER_URL` hardcode — env_file override করে auth ভেঙে দেয় (একবার ঘটেছিল)
- `docker context use desktop-linux` — bind-mount খালি দেখাবে
- Docker subnet unpin করা — MySQL/Redis GRANT/bind-address ভেঙে যাবে
- একসাথে systemd + docker celery-beat দুটোই চালু রাখা (duplicate scheduler risk)
- `celery -A config report` (Redis password leak করে — নিষিদ্ধ)
- host-side `python manage.py check`/`django.setup()` সরাসরি চালানো (`.env.sonarqube` টোকেন leak)

## ৫. Escalation

যেকোনো critical production anomaly (5xx spike, RADIUS/MikroTik auth ব্যর্থতা, billing task miss,
duplicate celery-beat) দেখা গেলে — অবিলম্বে থামুন, রিপোর্ট করুন, উপরের রোলব্যাক approval ছাড়া চালাবেন না।
