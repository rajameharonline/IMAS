# Nginx Option 1 Cutover — শুধু Django Upstream পরিবর্তন

## কেন Option 1 নিরাপদ

Host nginx (`/etc/nginx/sites-available/isp_bnas`)-এ ইতিমধ্যে যা আছে তার সবকিছু —
SSL/Let's Encrypt সার্টিফিকেট, HSTS, `roisp.duckdns.org` domain, walled-garden
(expired client detection), `/media/hls/` IP-restriction (লাইভ TV স্ট্রিম সুরক্ষা),
livetv video upload-এর জন্য আলাদা body-size/timeout, APK download, phpMyAdmin
LAN-restriction — এগুলোর কোনোটাই Docker nginx (`docker/nginx.conf`)-এ এখনো নেই।
তাই Docker nginx-কে সরাসরি 80/443-এ বসানো (Option 2) মানে এই সবকিছু হারানো।

Option 1-এ **host nginx-ই থাকছে** production authority হিসেবে — শুধু এটা কোন
Django process-এ request পাঠাচ্ছে সেটা বদলায়:

```
আগে:  nginx (80/443) -> upstream isp_django -> 127.0.0.1:8000 (systemd gunicorn)
পরে:  nginx (80/443) -> upstream isp_django -> 127.0.0.1:8001 (docker django-app)
```

## কী বদলায়, কী বদলায় না

**বদলায়:**
- `upstream isp_django { server 127.0.0.1:8000; }` → `server 127.0.0.1:8001;` (একটাই লাইন)

**বদলায় না:**
- SSL certificate, HSTS, security headers
- walled-garden default_server ব্লক
- `/media/hls/` IP-restriction
- livetv upload endpoint-এর body-size/timeout
- APK download, phpMyAdmin
- `/static/`, `/media/` (এগুলো সরাসরি disk থেকে `alias` দিয়ে serve হয়, Django-কে ছোঁয়ও না)
- domain, DNS, firewall

## প্রি-রিকুইজিট

- Docker `django-app` কন্টেইনার `127.0.0.1:8001`-এ চলমান ও স্বাস্থ্যবান থাকতে হবে
- `docker compose exec django-app python manage.py check --database default` পাস করতে হবে
- Celery worker/beat cutover আগে থেকেই সফল (এই cutover Django web-layer-নির্দিষ্ট, Celery-র সাথে সরাসরি সম্পর্কহীন)

## Dry-run

```bash
sudo bash docker/nginx_option1_upstream_patch.sh --dry-run
```
কিছুই পরিবর্তন করে না — শুধু diff দেখায়।

## Apply

```bash
sudo bash docker/nginx_option1_upstream_patch.sh --apply
```
- ব্যাকআপ নেয় (timestamped)
- diff দেখায়
- **"APPLY" টাইপ করে নিশ্চিত করতে হবে** — না করলে কিছুই বদলাবে না
- `nginx -t` পাস করলেই শুধু `systemctl reload nginx` (restart না — zero-downtime, বিদ্যমান connection ভাঙে না)
- `nginx -t` ব্যর্থ হলে বা permission বদলে গেলে স্বয়ংক্রিয়ভাবে ব্যাকআপ থেকে পুনরুদ্ধার করে

## Post-check (reload-এর পরে চালানোর জন্য — এখনই না)

```bash
curl -I https://roisp.duckdns.org/admin/
curl -I https://roisp.duckdns.org/api/
curl -I https://roisp.duckdns.org/static/admin/css/base.css
curl -I https://roisp.duckdns.org/media/
sudo journalctl -u nginx -n 30 --no-pager
docker compose logs --tail=120 django-app
sudo journalctl -u isp-gunicorn -n 20 --no-pager   # নিশ্চিত করতে পুরনো gunicorn আর নতুন request পাচ্ছে না
```

## Rollback

```bash
sudo bash docker/nginx_option1_upstream_patch.sh --rollback
```
সর্বশেষ ব্যাকআপ ফিরিয়ে আনে, `nginx -t` চালায়, তারপর `reload` করে। "APPLY" নিশ্চিতকরণ এখানেও লাগে।

ম্যানুয়াল রোলব্যাক (স্ক্রিপ্ট ছাড়া):
```bash
sudo cp /etc/nginx/sites-available/isp_bnas.bak.<timestamp> /etc/nginx/sites-available/isp_bnas
sudo nginx -t && sudo systemctl reload nginx
```

## ঝুঁকি

- এটা production web traffic (billing UI, API, admin panel) সরাসরি প্রভাবিত করে — ভুল upstream মানে পুরো সাইট ডাউন
- `reload` zero-downtime হলেও, যদি docker `django-app` কন্টেইনার cutover-এর মুহূর্তে অস্বাস্থ্যকর থাকে, সব production request ব্যর্থ হবে — তাই apply করার ঠিক আগে django-app-এর health নিশ্চিত করা আবশ্যক
- systemd `isp-gunicorn.service` cutover-এর পরও চলতে থাকবে (এই script সেটা বন্ধ করে না) — এটা ইচ্ছাকৃত, রোলব্যাক দ্রুত করার জন্য; পরে চাইলে আলাদাভাবে বন্ধ করা যাবে

## Docker nginx কেন এখনো 80/443-এর জন্য প্রস্তুত না (Option 2)

Missing: SSL cert mount, real domain, walled-garden, HLS restriction, livetv
upload limits, APK download, phpMyAdmin। এগুলো ছাড়া Docker nginx সরাসরি
80/443 নিলে security ও functionality দুটোই ক্ষতিগ্রস্ত হবে। Option 2 ভবিষ্যতের
জন্য আলাদা, বড় কাজ — এই cutover-এর অংশ না।
