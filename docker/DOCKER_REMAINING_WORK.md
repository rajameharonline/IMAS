# Docker Phase-1 পরবর্তী কাজ (Remaining Work / Roadmap)

> এই ডকুমেন্টের কোনো কমান্ডই এখনো এপ্রুভ/এক্সিকিউট হয়নি। শুধু পরিকল্পনা।

## A. Duplicate Infrastructure Audit ফলাফল (২০২৬-০৭-০৯)

| আইটেম | অবস্থা | Action দরকার? |
|---|---|---|
| পুরনো Docker MySQL container | নেই — কখনো ছিলই না | না |
| পুরনো Docker Redis container | নেই — কখনো ছিলই না | না |
| Docker Desktop VM | চলছে না (`ps aux \| grep docker.?desktop` খালি) | না |
| Docker nginx টেস্ট container (8081/8091) | `Exited (0)` ~২৭ মিনিট আগে থেকে, প্রোডাকশনে ব্যবহৃত হচ্ছে না | ঐচ্ছিক — নিচে দেখুন |
| Native isp-gunicorn (8000) | active কিন্তু idle (safety net) | না, ইচ্ছাকৃত |
| Docker django-app (8001) | production active | না |

**মেমরি/swap pressure** (10Gi/14Gi RAM, 11Gi/17Gi swap) সম্পূর্ণ Docker-বহির্ভূত — SonarLint Java (~1.18GB),
Chrome, VS Code প্রসেস থেকে। এটা ISP-BNAS বা Docker স্ট্যাক ঠিক করার scope-এর বাইরে (dev workstation ব্যবহার)।

## B. প্রস্তুত কিন্তু এক্সিকিউট-না-করা ক্লিনআপ কমান্ড (Task C)

শুধুমাত্র Docker nginx টেস্ট container নিয়ে — এটা ইতিমধ্যে exited, রিসোর্স খরচ করছে না,
তাই জরুরি কিছু না। যদি ভবিষ্যতে পরিষ্কার রাখতে চান (শুধু approval পেলে):

```bash
# Option 1: শুধু container সরান, image/network অক্ষত থাকবে (কম destructive)
docker compose rm -f nginx

# Option 2: compose ফাইল থেকেও nginx service সরিয়ে ফেলা (কোড পরিবর্তন, আলাদা review লাগবে)
# — docker-compose.yml-এ nginx: ব্লক মুছে ফেলা, Option 2 (Docker nginx প্রোডাকশনে) বাতিল হলে
```

**সুপারিশ: এখনই কিছু করার দরকার নেই।** Exited container কোনো RAM/CPU ব্যবহার করছে না, শুধু
`docker ps -a`-তে দেখা যায়। ভবিষ্যতে Option 2 (Docker nginx production hardening) নিয়ে
সিদ্ধান্ত হলে তখন এটা রিভিজিট করা যাবে (নিচে বিভাগ D দেখুন)।

## C. systemd Disable Readiness — বর্তমান সিদ্ধান্ত: এখনো প্রস্তুত নয়

বিস্তারিত checklist `PHASE1_STABILITY_SCORECARD.md` সেকশন ৪-৫-এ। সারাংশ:

- **Celery (worker+beat):** দৈনিক billing window (রাত ১২টার পর `disable-expired-clients`,
  মাসের ১ তারিখ `auto-generate-monthly-bills`) এখনো observe করা হয়নি। বাকি সব checklist item ✅।
- **Gunicorn:** cutover থেকে মাত্র ~৩ ঘণ্টা, আরও কিছু ঘণ্টা স্থিতিশীলতা দেখা দরকার।

**পরবর্তী চেকপয়েন্ট:** পরের রাত ১২টার পরে (২০২৬-০৭-১০ ০০:০৫) `disable-expired-clients` task সফল
হয়েছে কিনা `docker compose logs celery-beat celery-worker` দিয়ে যাচাই করুন। সফল হলে ও
আরও কয়েক ঘণ্টা নীরব থাকলে systemd disable বিবেচনা করা যেতে পারে (approval সহ)।

## D. ভবিষ্যৎ রোডম্যাপ (Phase 2+) — শুধু পরিকল্পনা, timeline নেই

### D1. MySQL Containerization
- **সুপারিশ: এখনই না, নিম্ন অগ্রাধিকার।**
- ঝুঁকি: RADIUS DB + billing DB উভয়ের জন্য critical, downtime tolerance প্রায় শূন্য।
- প্রয়োজন হলে ধাপ: (１) named volume-এ ডেটা migrate, (২) replication দিয়ে zero-downtime cutover,
  (৩) `RadiusServer.db_host` ও `settings.DATABASES` উভয়ই নতুন কন্টেইনার হোস্টনেমে পয়েন্ট করা,
  (৪) backup/restore procedure পুনরায় টেস্ট করা (containerized volume backup ভিন্ন হয়)।
- এই ফেজে **শুধুমাত্র** যদি হোস্ট-নেটিভ MySQL কোনো নির্দিষ্ট সমস্যা তৈরি করে তবেই বিবেচনা করা উচিত।

### D2. Redis Containerization
- **সুপারিশ: মাঝারি অগ্রাধিকার, কিন্তু এখনই না।**
- Redis স্টেটলেস cache/broker হিসেবে ব্যবহৃত (persistence critical না) — MySQL-এর চেয়ে সহজ migrate।
- ধাপ: pinned subnet-এ named container, `requirepass` env var থেকে (rotate script দিয়ে ইতিমধ্যে
  URL-safe hex পাসওয়ার্ড জেনারেশন প্রস্তুত আছে), Celery broker + Django cache উভয় URL আপডেট,
  এক observation window (কমপক্ষে একটা দৈনিক billing cycle) পার করা।

### D3. Docker Nginx Full Production Hardening (Option 2)
- **বর্তমান অবস্থা:** টেস্ট container শুধু, কখনো 80/443 বসানো হয়নি (Option 1 — host nginx-ই থেকে গেছে)।
- Option 2-এ যেতে হলে দরকার: `docker/nginx.conf`-কে আসল deployed
  `/etc/nginx/sites-available/isp_bnas`-এর সাথে feature-parity আনা (SSL/HSTS/walled-garden/
  HLS-restriction/livetv-upload-limits/APK-download/phpMyAdmin — এগুলো বর্তমান `docker/nginx.conf`-এ
  নেই), certbot-renewal container বা host-mounted cert path, এবং একটা পূর্ণ staging cutover টেস্ট।
- **সুপারিশ: নিম্ন অগ্রাধিকার।** Option 1 (host nginx + upstream পরিবর্তন) ইতিমধ্যে স্থিতিশীল ও কম ঝুঁকিপূর্ণ;
  Option 2 করার সুনির্দিষ্ট কারণ (যেমন nginx config-কে ভার্সন-কন্ট্রোলড deploy pipeline-এ আনা) না থাকলে
  বাড়তি জটিলতা যোগ করবে মাত্র।

### D4. FreeRADIUS / Asterisk / SNMP — Host-Native রাখার সুপারিশ (স্থায়ী)

**তিনটাই host-native থাকা উচিত, containerize না করাই ভালো:**

- **FreeRADIUS:** UDP পোর্ট 1812/1813 নিয়ে কাজ করে, MikroTik NAS ডিভাইসগুলো থেকে সরাসরি UDP ট্রাফিক
  আসে — Docker-এ UDP port mapping অতিরিক্ত ল্যাটেন্সি/complexity যোগ করে কোনো লাভ ছাড়াই।
  এছাড়া RADIUS module MySQL DB-তে radius স্কিমা সরাসরি অ্যাক্সেস করে যেটা host-এই আছে।
- **Asterisk/coturn (VoIP):** RTP/media স্ট্রিম NAT traversal-এর উপর নির্ভরশীল (STUN/TURN,
  external-ip detection) — containerized হলে NAT-এর ভেতরে আরেকটা NAT layer (Docker bridge)
  যোগ হয়, one-way audio/media bug-এর ঝুঁকি বহুগুণ বাড়ে (আগেই এই প্রজেক্টে stale-session/one-way
  audio বাগ হোস্ট-নেটিভ অবস্থাতেই সমাধান করতে যথেষ্ট কষ্ট হয়েছে)।
- **SNMP trap listener:** UDP 162 পোর্ট bind করতে `CAP_NET_BIND_SERVICE` লাগে (privileged পোর্ট,
  <1024), containerized হলে extra capability grant করতে হবে যা security surface বাড়ায়,
  আর OLT ডিভাইসগুলো থেকে সরাসরি host IP-তে trap পাঠানো routing-wise সহজ।

**উপসংহার:** MySQL/Redis (স্টেটফুল, network-simple) ভবিষ্যতে containerize করার যুক্তি আছে;
FreeRADIUS/Asterisk/SNMP (UDP/NAT/privileged-port নির্ভর) host-native থাকাই দীর্ঘমেয়াদে নিরাপদ,
containerize করার সুস্পষ্ট business/operational সুবিধা না দেখা পর্যন্ত।

## E. Compose Hardening Review ফলাফল (Task E)

`docker-compose.yml` পর্যালোচনা করে পাওয়া গেছে (কোনো পরিবর্তন করা হয়নি, শুধু audit):

- ✅ সব ৪টা সার্ভিসে `restart: unless-stopped`
- ✅ Subnet pinned (`172.19.0.0/16`, gateway `172.19.0.1`)
- ✅ `extra_hosts: host.docker.internal:host-gateway` সব app সার্ভিসে
- ✅ `env_file: .env.docker` ব্যবহৃত, `environment:` ব্লকে কোনো secret/URL hardcode নেই
  (শুধু non-secret override যেমন `DB_HOST`, `CELERY_RESULT_BACKEND`, `RADIUS_DB_HOST`)
- ✅ একটাই `celery-beat` সার্ভিস সংজ্ঞায়িত (duplicate scheduler risk কোডে নেই — systemd সাইডে
  সতর্কতা দরকার, উপরে দেখুন)
- ✅ Volumes bind-mount শুধু `media/`, `staticfiles/`, `logs/` — কোনো sensitive path exposed না
- ✅ `.gitignore`-এ `.env.docker`, `.env*.bak*` cover করা আছে — কোনো secret git history-তে যায়নি
- ℹ️ nginx সার্ভিস প্রোডাকশনে ব্যবহৃত হচ্ছে না (Option 1 সিদ্ধান্তের কারণে) — এটা bug না, ইচ্ছাকৃত অবস্থা

**কোনো hardening গ্যাপ পাওয়া যায়নি যেটা এখনই ফিক্স করা জরুরি।**
