# LiveTV Keep-Warm Bug — Root Cause ও Fix Plan

**স্ট্যাটাস: প্রস্তুত, প্রয়োগ করা হয়নি। আলাদা অনুমোদন লাগবে।**

## Bug কোথায়

`livetv/tasks.py` — `@shared_task(name='livetv.keep_warm_channels')` decorator
ভুল ফাংশনে বসানো ছিল।

```python
# আগে (ভুল):
@shared_task(name='livetv.keep_warm_channels')   # ← এখানে ভুল বসানো
def _warm_channel(ch):        # প্রতি-চ্যানেল হেল্পার, 'ch' argument বাধ্যতামূলক
    ...

def keep_warm_channels():     # ← আসল periodic entry-point — কোনো @shared_task নেই!
    ...
    for ch in targets:
        ...
        result = _warm_channel(ch)   # ভেতরে সঠিকভাবে ch দিয়েই কল হয়
```

## Root Cause (বিস্তারিত)

1. Celery-এর task registry নাম (`livetv.keep_warm_channels`) দিয়ে function খোঁজে — decorator যেখানে বসানো, সেই function-ই register হয়।
2. যেহেতু decorator ভুলভাবে `_warm_channel(ch)`-এ বসানো, Celery registry-তে `livetv.keep_warm_channels` নামটা **`_warm_channel`-এর সাথে ম্যাপ হয়ে গেছে**, `keep_warm_channels()`-এর সাথে না।
3. `config/settings.py`-এর `CELERY_BEAT_SCHEDULE['keep-warm-livetv-channels']` এন্ট্রি কোনো `args` ছাড়াই এই task periodically পাঠায় (প্রতি ১২০ সেকেন্ড)।
4. Beat যখন `livetv.keep_warm_channels` পাঠায় (০ argument সহ), Celery সেটাকে `_warm_channel()` হিসেবে কল করে — কিন্তু `_warm_channel` একটা positional argument (`ch`) ছাড়া কল করা যায় না।
5. ফলাফল: `TypeError: _warm_channel() missing 1 required positional argument: 'ch'`, যেটা `celery.beat.SchedulingError` হিসেবে beat log-এ প্রতি ২ মিনিটে দেখা যায়।
6. আসল orchestrator `keep_warm_channels()` — যেটা `LIVETV_KEEP_WARM_COUNT` চেক করে, visible channel list বানায়, এবং প্রতিটার জন্য সঠিকভাবে `_warm_channel(ch)` কল করে — **কখনোই periodic task হিসেবে register-ই হয়নি**, তাই এই পুরো keep-warm ফিচারটাই কার্যকরভাবে **নিষ্ক্রিয়** ছিল (এমনকি `LIVETV_KEEP_WARM_COUNT` non-zero সেট করা থাকলেও)।

## Task একটা চ্যানেল না অনেকগুলো warm করার কথা

**অনেকগুলো** — `keep_warm_channels()` visible channel list থেকে top-N (বা সব, `count < 0` হলে) নিয়ে প্রতিটার জন্য `_warm_channel(ch)` কল করে loop-এ। `_warm_channel(ch)` হলো per-channel internal helper, কখনোই সরাসরি periodic task হিসেবে কল হওয়ার কথা না।

## Bug-এর প্রভাব

- **শুধু LiveTV keep-warm ফিচার-নির্দিষ্ট** — billing, RADIUS, MikroTik, OLT, VOIP-এর কোনো কোড পথ এই ফাংশনের সাথে সম্পর্কিত না।
- কার্যকর প্রভাব: `LIVETV_KEEP_WARM_COUNT` (ডিফল্ট `0`, অর্থাৎ ফিচার এমনিতেই বন্ধ) non-zero সেট করা থাকলেও, keep-warm আসলে কখনো চলেনি — শুধু log-এ error noise তৈরি করেছে প্রতি ২ মিনিটে।
- Docker migration-এর সাথে সম্পূর্ণ সম্পর্কহীন — systemd beat-এর পুরনো লগেই ১২০০+ বার এই একই error ছিল migration শুরুর অনেক আগে থেকে।

## প্রস্তাবিত Fix

`docker/patches/livetv_keep_warm_fix.patch` — একলাইনের decorator relocation:
- `_warm_channel(ch)` থেকে `@shared_task` সরানো
- `keep_warm_channels()`-এ `@shared_task(name='livetv.keep_warm_channels')` বসানো

**যাচাই করা হয়েছে:**
- `python3 -m py_compile` — syntax OK
- `git apply --check` — patch পরিষ্কারভাবে apply হয় (dry-run)

**যা পরিবর্তন হয় না:** কোনো migration, কোনো model, কোনো অন্য task, কোনো Docker/nginx/DB config।
