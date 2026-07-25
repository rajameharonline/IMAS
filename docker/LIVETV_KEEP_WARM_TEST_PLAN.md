# LiveTV Keep-Warm Fix — Test Plan

**এই প্ল্যান শুধু ভবিষ্যতের অনুমোদিত deploy-এর জন্য। এখনো apply করা হয়নি।**

## ১. Django check

```bash
docker compose exec django-app python manage.py check --database default
```
প্রত্যাশিত: শুধু pre-existing `billing.Bill (models.W036)` warning, নতুন কোনো error/warning না।

## ২. Import/syntax-level নিরাপদ যাচাই (কোনো task না চালিয়ে)

```bash
docker compose exec django-app python -c "
import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from livetv.tasks import keep_warm_channels, _warm_channel
import inspect
print('keep_warm_channels has shared_task wrapper:', hasattr(keep_warm_channels, 'delay'))
print('_warm_channel has shared_task wrapper:', hasattr(_warm_channel, 'delay'))
print('keep_warm_channels signature:', inspect.signature(keep_warm_channels))
"
```
প্রত্যাশিত (fix-এর পরে): `keep_warm_channels has shared_task wrapper: True`,
`_warm_channel has shared_task wrapper: False`, signature `()` (কোনো argument না)।

এটা **কোনো task চালায় না**, শুধু Celery registry-তে কোনটা task হিসেবে register হলো তা import-level যাচাই করে — সম্পূর্ণ non-destructive।

## ৩. ম্যানুয়ালি task চালানো (ঐচ্ছিক, শুধু যদি নিরাপদ প্রমাণিত হয়)

`keep_warm_channels()` নিজেই `LIVETV_KEEP_WARM_COUNT` চেক করে — যদি `0` (ডিফল্ট) থাকে,
task শুধু `{'kept_warm': 0, 'disabled': True}` রিটার্ন করে, কোনো FFmpeg/stream শুরু করে না।

```bash
# শুধু production .env-এ LIVETV_KEEP_WARM_COUNT আসলেই 0 কিনা আগে নিশ্চিত করুন (SET/NOT SET বা মান, secret না):
docker compose exec django-app python -c "
import os
print('LIVETV_KEEP_WARM_COUNT:', os.environ.get('LIVETV_KEEP_WARM_COUNT', '0 (default)'))
"

# 0 হলে নিরাপদে ম্যানুয়াল ট্রিগার করা যায় (কোনো stream শুরু হবে না):
docker compose exec django-app python -c "
import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from livetv.tasks import keep_warm_channels
print(keep_warm_channels())
"
```

⚠️ যদি `LIVETV_KEEP_WARM_COUNT` অ-শূন্য হয়, তাহলে ম্যানুয়াল ট্রিগার **আসলেই stream শুরু করতে পারে**
— সেক্ষেত্রে ম্যানুয়াল টেস্ট এড়িয়ে শুধু ধাপ ৪ (beat-এর স্বাভাবিক schedule পর্যবেক্ষণ) ব্যবহার করুন।

## ৪. Deploy-এর পর Docker celery-worker/beat লগ পর্যবেক্ষণ

```bash
docker compose logs --tail=50 celery-beat | grep -i "keep-warm\|keep_warm"
docker compose logs --tail=50 celery-worker | grep -i "keep_warm\|warm_channel"
bash docker/observe_phase1_celery.sh
```

## ৫. সফলতার মানদণ্ড

- `SchedulingError: ... keep-warm-livetv-channels ... missing 1 required positional argument` **আর দেখা যাবে না**
- পরিবর্তে হয় `{'kept_warm': 0, 'disabled': True}`-এর মতো সফল সমাপ্তি, অথবা (`LIVETV_KEEP_WARM_COUNT` non-zero হলে) প্রকৃত keep-warm কার্যকলাপ
- অন্য কোনো task (billing, OLT, VOIP, RADIUS)-এ কোনো নতুন error দেখা যাবে না
- `docker compose ps` — সব কন্টেইনার `Up` থাকা

## ৬. Rollback (fix কাজ না করলে)

```bash
# image rebuild-এর আগের অবস্থায় ফেরাতে, patch revert:
git apply -R docker/patches/livetv_keep_warm_fix.patch
docker compose build celery-worker celery-beat
docker compose up -d --force-recreate celery-worker celery-beat
```
অথবা শুধু পুরনো image ট্যাগে ফিরে যাওয়া, যদি রাখা থাকে।

## ৭. যা করা যাবে না

- Production `LIVETV_KEEP_WARM_COUNT`-কে টেস্টের জন্য non-zero-তে পরিবর্তন করা — এটা সরাসরি FFmpeg stream শুরু করে দিতে পারে, অনিচ্ছাকৃতভাবে
- Fix প্রয়োগের সাথে migration/collectstatic bundled করা — এই fix সম্পূর্ণ স্বাধীন, একসাথে করার দরকার নেই
- একই সময়ে celery-worker **এবং** celery-beat দুটোই force-recreate করা — একটার পর একটা করুন, মাঝে health check দিয়ে
