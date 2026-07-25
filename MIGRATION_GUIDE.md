# ISP BNAS — পেনড্রাইভ দিয়ে অন্য মেশিনে স্থানান্তর (Migration Guide)

> এই ফাইল দেখে ধাপে ধাপে সম্পূর্ণ project এক মেশিন থেকে আরেক মেশিনে নেওয়া যাবে।
> **শর্ত:** নতুন মেশিনে **Ubuntu 26.04** ও **ইন্টারনেট** আছে।

---

## ০. মূল ধারণা (আগে পড়ুন)

স্থানান্তরে **তিনটা জিনিস** লাগে:

| জিনিস | কোথায় থাকে | পেনড্রাইভে নেব? |
|---|---|---|
| **Code** (project ফাইল) | `/opt/isp_bnas` (বা `/var/www/isp_bnas`) | দরকার নেই — নতুন মেশিন git clone করবে |
| **Database** (client/bill/payment সব) | MySQL `radius` DB — *folder-এ নয়* | **হ্যাঁ — backup tarball-এ** |
| **Media** (client ছবি, NID, reg form) | `<project>/media/` | **হ্যাঁ — backup tarball-এ** |
| **firebase-service-account.json** (FCM push) | project root, git-এ নেই | **হ্যাঁ — আলাদা করে** |

> ⚠️ শুধু project folder কপি করলে **data যাবে না** (database আলাদা)। তাই নিচের `backup` ধাপটাই আসল।
> ⚠️ `venv/` ও `node_modules/` **কখনো কপি করবেন না** — নতুন মেশিনে নতুন করে তৈরি হবে।

---

## ১. পুরনো মেশিনে — Backup তৈরি

পুরনো মেশিনে টার্মিনালে চালান:

```bash
sudo bash /var/www/isp_bnas/install.sh backup
```

> ℹ️ পাথ নোট: এই মেশিনে project আছে `/var/www/isp_bnas`-এ। আপনার project অন্য কোথাও
> (যেমন `/opt/isp_bnas`) থাকলে সেই পাথ দিন। নিশ্চিত না হলে:
> `ls /var/www/isp_bnas/.env /opt/isp_bnas/.env 2>/dev/null` — যেটায় `.env` আছে সেটিই project।
> (install.sh ভেতরে নিজেই সঠিক PROJECT_DIR autodetect করে, শুধু script পাথটা ঠিক দিন।)

এটি তৈরি করবে:
```
/root/isp_bnas_backup_YYYYMMDD_HHMMSS.tar.gz
```
এর ভেতরে থাকবে: **পুরো Database dump + সব media ফাইল + .env reference**।

> শেষে স্ক্রিনে backup ফাইলের পুরো path দেখাবে — সেটা মনে রাখুন।

---

## ২. পেনড্রাইভে কপি

পেনড্রাইভ লাগান (ধরা যাক mount path `/media/usb`)। এই দুটো কপি করুন:

```bash
# (ক) Backup tarball — অবশ্যই (এতেই সব data)
cp /root/isp_bnas_backup_*.tar.gz /media/usb/

# (খ) Firebase key — FCM push ব্যবহার করলে (নাহলে skip)
cp /var/www/isp_bnas/firebase-service-account.json /media/usb/ 2>/dev/null || true
```

> পেনড্রাইভ নিরাপদে খুলুন: `sudo umount /media/usb`

*(ঐচ্ছিক — যদি code-ও সাথে নিতে চান, venv/node_modules ছাড়া:)*
```bash
rsync -a --exclude venv --exclude node_modules --exclude 'logs/*' \
      --exclude '*.pid' --exclude 'mobile_app/public_apk' \
      /var/www/isp_bnas/ /media/usb/isp_bnas_code/
```
*(সাধারণত দরকার নেই — নতুন মেশিন git থেকেই code আনবে।)*

---

## ৩. নতুন মেশিনে — প্রস্তুতি

নতুন Ubuntu 26.04 মেশিনে শুধু git থাকলেই হবে (না থাকলে):
```bash
sudo apt-get update && sudo apt-get install -y git
```

পেনড্রাইভ থেকে backup ফাইল `/root/`-এ কপি করুন:
```bash
sudo cp /media/usb/isp_bnas_backup_*.tar.gz /root/
```

---

## ৪. নতুন মেশিনে — Code আনা ও Install

```bash
# Code clone (নিচের branch সবচেয়ে আপডেটেড — main-এ merge করা থাকলে main দিন)
git clone -b feat/mobile-app-overhaul \
    https://github.com/rajameharonline1-afk/isp_bnas.git

# Installer চালান
sudo bash isp_bnas/install.sh
```

> **branch নোট:** সব সাম্প্রতিক কাজ `feat/mobile-app-overhaul`-এ আছে। main-এ merge করা থাকলে
> `-b feat/mobile-app-overhaul` বাদ দিয়ে শুধু `git clone <url>` দিলেই হবে।

ইনস্টলার যা যা জিজ্ঞেস করবে (Enter দিলে default নেবে):
- MySQL root password — নতুন একটা দিন
- DB password / RADIUS secret — পুরনো মেশিনের **একই** দিন হলে সবচেয়ে নিরাপদ
- Mikrotik IP/নাম, Server IP, Admin user/password, কোম্পানির নাম
- **Backup file path** ← এখানে পেনড্রাইভ থেকে কপি করা tarball-এর path দিন:
  ```
  /root/isp_bnas_backup_YYYYMMDD_HHMMSS.tar.gz
  ```

এরপর installer **নিজে থেকেই** করবে:
1. MySQL, FreeRADIUS, Redis, Nginx, Python, Node — সব install
2. RADIUS schema + indexes + NAS registration
3. Python venv + সব package, frontend build
4. **Backup থেকে Database + media auto-restore** (আপনার সব পুরনো data ফিরে আসবে)
5. Systemd services (gunicorn, celery, celery-beat, snmptrap) auto-start

---

## ৫. Firebase key বসানো (FCM push ব্যবহার করলে)

install শেষে, পেনড্রাইভ থেকে firebase key project-এ কপি করুন:
```bash
sudo cp /media/usb/firebase-service-account.json /opt/isp_bnas/
sudo chown isp:isp /opt/isp_bnas/firebase-service-account.json
sudo systemctl restart isp-gunicorn isp-celery
```

---

## ৬. যাচাই (সব ঠিক আছে কিনা)

```bash
sudo bash /opt/isp_bnas/install.sh status
```
সব service-এ সবুজ ✓ থাকা উচিত (mysql, freeradius, redis, nginx, isp-gunicorn, isp-celery, isp-celery-beat)।

তারপর ব্রাউজারে:
- **Admin Panel:** `http://<নতুন-মেশিনের-IP>/`  → পুরনো admin user/password দিয়ে login
- Client/Bill/Payment সব **পুরনো data দেখা যাচ্ছে কিনা** মিলিয়ে নিন।
- phpMyAdmin: `http://<IP>/phpmyadmin/`

সব credentials সংরক্ষিত থাকে: `/root/isp_bnas_credentials.txt`

---

## ৭. Domain + HTTPS — `https://roisp.duckdns.org` সরাসরি অ্যাক্সেস

> install.sh চালালে শুধু `http://<IP>/` রেডি হয়। ডোমেইন দিয়ে HTTPS অ্যাক্সেসের জন্য
> **নিচের ৩টি ধাপ আলাদাভাবে** করতে হবে।

### ৭.১ — DuckDNS-কে নতুন মেশিনের Public IP-তে point করান
1. নতুন মেশিনের public IP বের করুন:
   ```bash
   curl -s https://api.ipify.org; echo
   ```
2. https://www.duckdns.org -এ login → আপনার `roisp` domain-এর **current ip** ঘরে ওই IP বসিয়ে **update** দিন।
3. *(Dynamic IP হলে)* IP বদলালে যাতে নিজে থেকে আপডেট হয় — DuckDNS updater cron বসান
   (token DuckDNS account থেকে নিন):
   ```bash
   ( crontab -l 2>/dev/null; echo "*/5 * * * * curl -s 'https://www.duckdns.org/update?domains=roisp&token=<আপনার-TOKEN>&ip=' >/dev/null" ) | crontab -
   ```

### ৭.২ — Router-এ Port Forward (NAT-এর পিছনে থাকলে)
সার্ভার যদি রাউটারের পিছনে থাকে, রাউটারে **80 ও 443 (TCP)** পোর্ট নতুন সার্ভারের LAN IP-তে forward করুন।
(Let's Encrypt-এর HTTP-01 challenge ও বাইরের অ্যাক্সেস — দুটোর জন্যই দরকার।)

### ৭.৩ — HTTPS সেটআপ (এক কমান্ড)
নতুন মেশিনে চালান:
```bash
sudo bash /opt/isp_bnas/setup_https.sh roisp.duckdns.org
```
এটি নিজে থেকেই করবে: Certbot install → Let's Encrypt certificate → Nginx 443 (SSL) config →
`.env`-এ ALLOWED_HOSTS + CSRF_TRUSTED_ORIGINS (এই মেশিনের আসল IP দিয়ে) → certbot auto-renew cron।

শেষে `https://roisp.duckdns.org` খুললেই সরাসরি প্রজেক্ট আসবে। ✅

> **মনে রাখুন:**
> - DuckDNS IP ঠিকমতো point না করলে বা port-forward না থাকলে certbot **certificate দিতে ব্যর্থ** হবে।
> - HTTPS সেটআপের পর Mikrotik/ব্যবহারকারীর bookmark সব `https://roisp.duckdns.org`-এ দিন।
> - মোবাইল অ্যাপের API base URL এই domain-এ থাকলে app আগের মতোই কাজ করবে।

---

## ৮. শেষ ধাপ — Mikrotik ও DNS

- **Mikrotik RADIUS:** নতুন মেশিনের IP + একই RADIUS secret router-এ বসান (Server IP বদলেছে)।
- **পুরনো মেশিন বন্ধ** করার আগে নিশ্চিত হন নতুনটায় সব ঠিক চলছে (অন্তত ১ দিন)।
- ডোমেইন/HTTPS থাকলে: `change_domain.sh` ও `setup_https.sh` ব্যবহার করুন।

---

## ⚠️ সাধারণ ভুল ও সমাধান

| সমস্যা | সমাধান |
|---|---|
| Data আসেনি (খালি dashboard) | install-এ backup path দেননি → `sudo bash install.sh` আবার চালিয়ে backup path দিন |
| `venv` কপি করেছিলাম, error | venv কপি করবেন না; installer নতুন তৈরি করে |
| নতুন মেশিনে clone fail | internet/repo access চেক করুন; private হলে GitHub token লাগবে |
| FCM push কাজ করছে না | `firebase-service-account.json` কপি হয়নি (ধাপ ৫) |
| App (মোবাইল) update | code git-এ; app-এ `eas update --branch preview` আলাদাভাবে push করুন |
| Service restart apply হচ্ছে না | `sudo systemctl restart isp-gunicorn` (hard restart) |

---

## দ্রুত রেফারেন্স (এক নজরে)

```
পুরনো মেশিন:
  sudo bash /var/www/isp_bnas/install.sh backup
  cp /root/isp_bnas_backup_*.tar.gz  /media/usb/
  cp /var/www/isp_bnas/firebase-service-account.json /media/usb/   # ঐচ্ছিক

নতুন মেশিন:
  sudo cp /media/usb/isp_bnas_backup_*.tar.gz /root/
  git clone -b feat/mobile-app-overhaul https://github.com/rajameharonline1-afk/isp_bnas.git
  sudo bash isp_bnas/install.sh          # backup path দিন
  sudo cp /media/usb/firebase-service-account.json /opt/isp_bnas/   # ঐচ্ছিক
  sudo bash /opt/isp_bnas/install.sh status
```

---

*তৈরি: ISP BNAS migration helper • install.sh-এর backup/restore mode ব্যবহার করে।*