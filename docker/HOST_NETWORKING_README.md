# Host Networking — Docker কন্টেইনার থেকে host MySQL/Redis

এই ডকুমেন্ট `docker/setup_host_networking.sh` স্ক্রিপ্টের ব্যবহারবিধি।

## কেন এই পরিবর্তন দরকার

Phase-1 Docker স্ট্যাক-এ (`docker-compose.yml`) শুধু `django-app`, `celery-worker`,
`celery-beat`, `nginx` কন্টেইনারাইজড — MySQL, Redis, FreeRADIUS, Asterisk/VOIP
**host-এই native থাকছে** (আর্কিটেকচার সিদ্ধান্ত)।

সমস্যা: MySQL ও Redis বর্তমানে শুধু `127.0.0.1`-এ bind করা (`bind-address`/`bind`),
অর্থাৎ শুধু host নিজে কানেক্ট করতে পারে। Docker কন্টেইনার আলাদা নেটওয়ার্ক namespace-এ
চলে (docker bridge, সাধারণত `172.17.0.0/16`), তাই কন্টেইনার থেকে `127.0.0.1`
মানে কন্টেইনারের নিজের ভেতর — host-এর MySQL/Redis-এ পৌঁছাতে পারে না।

সমাধান: MySQL/Redis-কে `127.0.0.1` **এবং** docker bridge gateway (যেমন `172.17.0.1`)
— এই দুটোতেই bind করা, `0.0.0.0` (সব ইন্টারফেস, পুরো ইন্টারনেট-facing হলে বিপজ্জনক) নয়।
সাথে MySQL-এ docker subnet-scoped GRANT (`'user'@'172.17.%.%'`, `'%'` নয়) এবং
Redis-এ `requirepass` বাধ্যতামূলক রাখা হচ্ছে যাতে bind খোলার পরও কেউ password ছাড়া
কানেক্ট করতে না পারে।

## Dry-run কীভাবে চালাবেন

কোনো ফাইল/সার্ভিস পরিবর্তন হয় না — শুধু কী হবে তা দেখায় (diff, SQL, ufw rule সব প্রিন্ট হয়):

```bash
sudo bash docker/setup_host_networking.sh --dry-run
```

আউটপুট চেক করুন:
- Docker bridge gateway/subnet ঠিকমতো detect হয়েছে কিনা
- `mysqld.cnf` bind-address diff ঠিক আছে কিনা
- `redis.conf` bind diff ঠিক আছে কিনা (এবং `requirepass: SET` দেখাচ্ছে কিনা)
- GRANT SQL preview-তে সঠিক `DB_USER`/`RADIUS_DB_USER`/DB নাম আসছে কিনা

## Apply করার আগে

- Low-traffic window বেছে নিন — শেষ ধাপে MySQL ও Redis restart হয়, কয়েক সেকেন্ডের downtime।
- নিশ্চিত করুন `redis.conf`-এ `requirepass` সেট আছে। না থাকলে স্ক্রিপ্ট নিজে থেকেই থেমে
  যাবে (ইচ্ছাকৃত সেফটি) — override করতে `--allow-no-requirepass`, কিন্তু production-এ
  এটা অনুমোদিত নয়, শুধু isolated/lab টেস্টের জন্য।
- `.env` ফাইলে `DB_USER`, `DB_NAME`, `RADIUS_DB_USER`, `RADIUS_DB_NAME` সঠিক আছে
  নিশ্চিত করুন (স্ক্রিপ্ট এখান থেকেই username/db name পড়ে, password নয়)।

## Apply

```bash
sudo bash docker/setup_host_networking.sh
```

- Backup, bind পরিবর্তন, GRANT SQL preview — সব দেখাবে।
- শেষে **"APPLY" টাইপ করতে বলবে** — এটা টাইপ না করলে কিছুই পরিবর্তন হবে না।
- MySQL GRANT ধাপে root পাসওয়ার্ড ইন্টারঅ্যাক্টিভভাবে চাইবে (`mysql -u root -p`) —
  এই পাসওয়ার্ড স্ক্রিপ্টে কোথাও সংরক্ষিত/প্রিন্ট হয় না।
- সবশেষে `mysql` ও `redis-server` restart হবে।

## রোলব্যাক

সর্বশেষ ব্যাকআপ থেকে `mysqld.cnf`/`redis.conf` ফিরিয়ে আনে এবং সার্ভিস restart করে
(এখানেও "APPLY" নিশ্চিতকরণ লাগবে):

```bash
sudo bash docker/setup_host_networking.sh --rollback
```

এটি docker-subnet-scoped MySQL user (`'DB_USER'@'172.17.%.%'` ইত্যাদি) নিজে থেকে
বাদ দেয় না — স্ক্রিপ্টের আউটপুটে দেখানো `DROP USER` কমান্ড ম্যানুয়ালি চালাতে হবে।

## Django কন্টেইনার থেকে টেস্ট

আগে `.env.docker` তৈরি করুন (`.env.docker.example` দেখুন), তারপর:

```bash
docker compose build
docker compose up -d django-app
docker compose exec django-app python manage.py check --database default
docker compose exec django-app python -c "
import redis, os
r = redis.from_url(os.environ['REDIS_URL'])
print(r.ping())
"
```

দুটোই সফল হলে MySQL/Redis কন্টেইনার থেকে reachable।

## সাধারণ Error ও সমাধান

**MySQL connection refused**
- `mysqld.cnf`-এ `bind-address` আপডেট হয়নি বা `mysql` restart হয়নি — `sudo systemctl status mysql` চেক করুন।
- Docker bridge subnet স্ক্রিপ্ট রান করার সময়কার subnet-এর থেকে পরে পরিবর্তন হয়েছে কিনা
  (docker network পুনরায় তৈরি হলে gateway IP বদলাতে পারে) — `docker network inspect bridge` দিয়ে
  বর্তমান gateway যাচাই করুন এবং প্রয়োজনে স্ক্রিপ্ট আবার চালান।

**MySQL access denied for user '...'@'172.x.x.x'**
- GRANT ধাপ চলেনি বা fail হয়েছে (root পাসওয়ার্ড ভুল দেওয়া হয়েছিল) — `--dry-run` দিয়ে SQL preview
  দেখে ম্যানুয়ালি `mysql -u root -p` দিয়ে চালান।
- Container-এর actual source IP GRANT-এ ব্যবহৃত pattern (`172.17.%.%`)-এর সাথে না মিললে —
  `docker inspect <container>` দিয়ে actual IP চেক করুন, subnet বদলে থাকলে re-run করুন।

**Redis connection refused**
- `redis.conf`-এ `bind` লাইন আপডেট হয়নি বা `redis-server` restart হয়নি —
  `sudo systemctl status redis-server` চেক করুন।

**Redis protected-mode / password issue (NOAUTH / WRONGPASS)**
- `requirepass` সেট থাকলে `REDIS_URL`/`CELERY_BROKER_URL`-এ password অন্তর্ভুক্ত করতে হবে:
  `redis://:<password>@host.docker.internal:6379/1` — `.env.docker`-এ এই ফরম্যাটে থাকা আবশ্যক।

**UFW blocking docker subnet**
- `sudo ufw status numbered` দিয়ে 3306/6379-এর rule আছে কিনা দেখুন।
- ufw active থাকা অবস্থায় স্ক্রিপ্ট চালানো না হলে rule যোগ হয়নি — ম্যানুয়ালি:
  `sudo ufw allow from 172.17.0.0/16 to any port 3306 proto tcp`
  `sudo ufw allow from 172.17.0.0/16 to any port 6379 proto tcp`
- মনে রাখবেন: Docker নিজে iptables ম্যানিপুলেট করে exposed container port-এর জন্য,
  কিন্তু host-এ MySQL/Redis-এর মতো host-bound port-এ INPUT chain-এর মাধ্যমে ufw rule
  কার্যকর থাকে — তাই এই rule গুলো এখানে প্রাসঙ্গিক।
