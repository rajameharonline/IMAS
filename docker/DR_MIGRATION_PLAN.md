# ISP-BNAS Disaster Recovery / নতুন মেশিনে Migration পরিকল্পনা

> এই ডকুমেন্ট answer দেয়: "এই মেশিন হঠাৎ নষ্ট হয়ে গেলে/আর চালু না হলে, পুরো প্রজেক্ট
> (Django + MySQL + Redis + FreeRADIUS + Asterisk + SNMP + nginx + Docker) নতুন
> একটা মেশিনে হুবহু কীভাবে তুলব?"

> **✅ ২০২৬-০৭-১০ থেকে প্রস্তাবিত পদ্ধতি: `/var/www/isp_bnas/install.sh`**
> এখন MySQL, FreeRADIUS, Redis, nginx, Asterisk, SNMP, **Docker Phase-1 stack**, ও
> SSL (Let's Encrypt) — সবই এক script-এ কভার করে (backup mode + install/restore mode)।
> নিচের ম্যানুয়াল ধাপগুলো এখনো রেফারেন্স হিসেবে রাখা হয়েছে (script-এর ভেতরে আসলে কী
> হচ্ছে বোঝার জন্য, এবং script কোনো কারণে ব্যর্থ হলে ম্যানুয়াল fallback হিসেবে), কিন্তু
> সাধারণভাবে এখন থেকে শুধু:
> ```bash
> sudo bash install.sh backup      # পুরনো মেশিনে
> scp /root/isp_bnas_backup_*.tar.gz user@NEW_IP:/root/
> sudo bash install.sh             # নতুন মেশিনে, backup file path দিন
> ```

## ০. সংক্ষিপ্ত উত্তর — ৩টা জিনিস দরকার

1. **কোড** — GitHub-এ আছে (`rajameharonline1-afk/isp_bnas`), এমনিতেই নিরাপদ
2. **ডেটা** — MySQL (isp_bnas + radius DB), এগুলো GitHub-এ নেই, রোজ backup নিতে হয়
3. **Secret/Config** — `.env`, SSL cert, Firebase key, nginx/systemd/FreeRADIUS/Asterisk
   config — এগুলোও GitHub-এ নেই (`.gitignore`), backup নিতে হয়

**⚠️ ২০২৬-০৭-১০ পর্যন্ত পাওয়া গ্যাপ:** পুরনো backup script শুধু `isp_bnas` DB backup
করত, `radius` DB **বাদ ছিল**, এবং backup **শুধু এই মেশিনের নিজের ডিস্কে** (`/var/backups/`)
রাখা হতো — মেশিন/ডিস্ক পুরোপুরি নষ্ট হলে সেই backup-ও হারিয়ে যেত। এই দুটোই এখন ঠিক করা
হয়েছে (`deploy/mysql_backup.sh` আপডেট) — কিন্তু **অফসাইট কপি এখনো ম্যানুয়াল**, নিচে
সেকশন ২ দেখুন।

## ১. প্রতিদিন যা ব্যাকআপ হচ্ছে (আপডেটেড script অনুযায়ী)

`deploy/mysql_backup.sh` — cron: `/etc/cron.d/isp-bnas-backup` (রোজ রাত ৩টা, root)।
সংরক্ষণ হয় `/var/backups/isp_bnas/`-এ:

| ফাইল | বিষয়বস্তু |
|---|---|
| `isp_bnas_YYYY-MM-DD.sql.gz` | মূল অ্যাপ DB (billing/client/HR/livetv সব টেবিল) |
| `radius_YYYY-MM-DD.sql.gz` | FreeRADIUS auth/accounting DB (আগে বাদ ছিল, এখন যোগ) |
| `config/isp_bnas_secrets_YYYY-MM-DD.tar.gz` | `.env`, `.env.docker`, `.env.sonarqube`, `.mcp.json`, `admin_panel/.env.production`, `firebase-service-account.json`, `google-services.json` (mobile_app + livetv_app) |
| `config/system_config_YYYY-MM-DD.tar.gz` | nginx site config, `isp-*.service` systemd unit, cron file, FreeRADIUS `/etc/freeradius/3.0/`, Asterisk `/etc/asterisk/` |

**⚠️ Retention নেই (ইচ্ছাকৃত)** — client billing history হারানো যাবে না বলে পুরনো backup
কখনো auto-delete হয় না। ডিস্ক স্পেস (বর্তমানে ৮২% ব্যবহৃত, ৪১GB ফ্রি) নিয়মিত মনিটর
করা দরকার, নাহলে backup partition-ই ভরে যেতে পারে।

## ২. 🔴 এখনই করণীয় — অফসাইট কপি (ম্যানুয়াল, প্রতিদিন/সাপ্তাহিক)

Backup local ডিস্কে থাকলে "মেশিন সম্পূর্ণ নষ্ট" পরিস্থিতিতে কোনো কাজেই আসবে না।
আপাতত সবচেয়ে সহজ উপায় — **172.16.6.10 মেশিনে** (যেটার সাথে আমাদের SSH access
আছে) নিয়মিত rsync করা:

```bash
# আপনি নিজে চালান (host-to-host ফাইল ট্রান্সফার এজেন্ট নিজে থেকে করতে পারে না,
# নিরাপত্তা নীতির কারণে):
rsync -avz /var/backups/isp_bnas/ roisp@172.16.6.10:~/isp_bnas_offsite_backup/
```

এটা `cron`-এ বসিয়ে দিলে (roisp ইউজারের নিজের crontab, SSH key দিয়ে passwordless)
প্রতিদিন স্বয়ংক্রিয় হয়ে যাবে। আরও ভালো: Google Drive/S3/Backblaze-এর মতো তৃতীয়
কোনো true off-network location — 172.16.6.10 একই নেটওয়ার্ক/ISP-এর আওতায় থাকায়
আঞ্চলিক দুর্যোগ (বিদ্যুৎ/নেটওয়ার্ক আউটেজ পুরো এলাকায়) থেকে পুরোপুরি সুরক্ষা দেয় না।

## ৩. নতুন মেশিনে Restore — ধাপে ধাপে

### ধাপ ১ — OS ও বেসিক প্যাকেজ
```bash
# Ubuntu 24.04 LTS প্রস্তাবিত (বর্তমান মেশিনের মতোই)
sudo apt-get update
sudo apt-get install -y python3.14 python3.14-venv mysql-server redis-server \
  nginx freeradius freeradius-mysql asterisk snmp git curl
```

### ধাপ ২ — কোড
```bash
git clone https://github.com/rajameharonline1-afk/isp_bnas.git /var/www/isp_bnas
cd /var/www/isp_bnas
python3.14 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### ধাপ ৩ — Secret/config restore
```bash
tar -xzf config/isp_bnas_secrets_<date>.tar.gz -C /var/www/isp_bnas/
tar -xzf config/system_config_<date>.tar.gz -C /
```
তারপর `/var/www/isp_bnas/.env`-এ `DB_HOST`/`RADIUS_DB_HOST` ইত্যাদি নতুন মেশিনের
জন্য ঠিক আছে কিনা যাচাই করুন (আগে Docker subnet/IP-স্পেসিফিক মান থাকলে সেগুলো
নতুন মেশিনে ভিন্ন হতে পারে)।

### ধাপ ৪ — MySQL restore (দুটো DB)
```bash
mysql -u root -p -e "CREATE DATABASE isp_bnas CHARACTER SET utf8mb4;"
mysql -u root -p -e "CREATE DATABASE radius CHARACTER SET utf8mb4;"
gunzip -c isp_bnas_<date>.sql.gz | mysql -u root -p isp_bnas
gunzip -c radius_<date>.sql.gz | mysql -u root -p radius
# তারপর .env-এর DB_USER/DB_PASSWORD দিয়ে ইউজার+GRANT তৈরি করুন
```

### ধাপ ৫ — FreeRADIUS/Asterisk config বসানো
`system_config_<date>.tar.gz` থেকে `/etc/freeradius/3.0/` ও `/etc/asterisk/`
এক্সট্র্যাক্ট হয়ে গেছে (ধাপ ৩-এ)। শুধু পারমিশন ঠিক করুন:
```bash
sudo chown -R freerad:freerad /etc/freeradius/3.0/
sudo chown -R asterisk:asterisk /etc/asterisk/
sudo systemctl restart freeradius asterisk
```

### ধাপ ৬ — nginx + systemd services
```bash
sudo cp system_config_extract/etc/nginx/sites-available/isp_bnas /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/isp_bnas /etc/nginx/sites-enabled/
sudo cp system_config_extract/etc/systemd/system/isp-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now isp-gunicorn isp-snmptrap isp-voip-listener
sudo nginx -t && sudo systemctl reload nginx
```
**SSL সার্টিফিকেট** (Let's Encrypt/certbot) নতুন মেশিনে **নতুন করে ইস্যু করতে হবে**
(পুরনো সার্টিফিকেট ব্যাকআপে নেই, ডোমেইনের DNS নতুন মেশিনের IP-তে পয়েন্ট করার পর
`certbot --nginx -d roisp.duckdns.org` চালান)।

### ধাপ ৭ — Docker Phase-1 (django-app/celery-worker/celery-beat)
```bash
cd /var/www/isp_bnas
docker compose build
cp .env .env.docker  # তারপর docker/HOST_NETWORKING_README.md অনুযায়ী DB_HOST ইত্যাদি
                       # host.docker.internal-এ বদলান
docker compose up -d
```
বিস্তারিত: `docker/PHASE1_DOCKER_RUNBOOK.md`।

### ধাপ ৮ — SNMP/OLT, MikroTik কানেকশন
এগুলো DB-তে (isp_bnas DB, `RadiusServer`/OLT মডেল) সংরক্ষিত থাকায় DB restore
(ধাপ ৪)-এর সাথেই চলে আসবে — শুধু নিশ্চিত করুন নতুন মেশিনের IP MikroTik/OLT
ডিভাইসগুলোর allow-list/firewall-এ যোগ করা আছে (network-level, DB-তে না)।

### ধাপ ৯ — DNS কাটওভার
`roisp.duckdns.org`-এর A-record নতুন মেশিনের public IP-তে বদলান (DuckDNS হলে
`update_ip.sh`-জাতীয় script থাকলে সেটা নতুন মেশিনে চালান)।

## ৪. যাচাই checklist (নতুন মেশিন লাইভ করার আগে)

- [ ] `curl -sI https://<new-domain>/admin/` → 302
- [ ] Admin panel login কাজ করছে
- [ ] একটা টেস্ট client-এর billing/RADIUS status ঠিক দেখাচ্ছে
- [ ] MikroTik/OLT connectivity (SNMP poll সফল)
- [ ] LiveTV একটা চ্যানেল চলছে
- [ ] VoIP টেস্ট কল
- [ ] Celery beat duplicate scheduler নেই (`systemctl status isp-celery-beat` vs docker beat)
- [ ] mobile app-এর API base URL নতুন ডোমেইনে ঠিক আছে (না হলে app আপডেট লাগবে)

## ৫. যা ব্যাকআপে নেই, ভবিষ্যতে ভাবা উচিত

- **🔴 `media/` ফোল্ডার — ৩৩GB, কোনো ব্যাকআপ নেই!** এটাই সবচেয়ে বড় বাকি গ্যাপ। এতে
  client-uploaded ছবি/ডকুমেন্ট, LiveTV logo, APK ফাইল ইত্যাদি আছে — মেশিন নষ্ট হলে
  এই ৩৩GB **সম্পূর্ণ হারিয়ে যাবে**, কোনো restore সম্ভব না। ডিস্কে এখন মাত্র ৪১GB ফ্রি
  থাকায় local দ্বিতীয় কপিও ব্যবহারিক না — `rsync -avz /var/www/isp_bnas/media/
  roisp@172.16.6.10:~/isp_bnas_offsite_backup/media/` দিয়ে সাপ্তাহিক অফসাইট sync
  বিবেচনা করা উচিত (172.16.6.10-এ ৬৮GB ফ্রি আছে, জায়গা হবে)।
- SSL private key/সার্টিফিকেট (certbot দিয়ে নতুন করে নিতে হয়, এটাই সঠিক পদ্ধতি —
  পুরনো private key migrate করার দরকার নেই)
- Redis ডেটা — cache/broker হওয়ায় হারালেও app চলবে (শুধু সাময়িক session/cache miss),
  তাই ইচ্ছাকৃতভাবে backup-এ রাখা হয়নি
