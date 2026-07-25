# VoIP Celery tasks — এক্সপায়ারি-ভিত্তিক স্বয়ংক্রিয় ভয়েস কল।
import logging
import uuid

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(name='voip.run_voice_call_schedules')
def run_voice_call_schedules():
    """প্রতিদিন (Celery beat) সব active VoiceCallSchedule চালায়:
    timing/days অনুযায়ী target expiry-date বের করে মিলে যাওয়া client-দের
    রেকর্ডিং বাজিয়ে স্বয়ংক্রিয় কল করে (broadcast_voice_call)।"""
    from clients.models import Client
    from voip.models import VoiceCallSchedule
    from voip.services.voice_broadcast import convert_to_wav, broadcast_voice_call

    today = timezone.localdate()
    now_time = timezone.localtime().time()
    ran = 0
    for sched in VoiceCallSchedule.objects.filter(is_active=True):
        if sched.last_run_date == today:
            continue  # আজ ইতিমধ্যে চলেছে
        if sched.run_time and now_time < sched.run_time:
            continue  # এখনো নির্ধারিত সময় হয়নি
        target = sched.target_expiry_date(today)
        qs = Client.objects.filter(expiry_date=target)
        if sched.status_filter:
            qs = qs.filter(status=sched.status_filter)
        clients = [(f'client_{c.pk}', getattr(c, 'fcm_token', '') or '') for c in qs]
        sched.last_run_date = today
        sched.save(update_fields=['last_run_date'])
        if not clients:
            logger.info('schedule "%s": target %s — কোনো client নেই', sched.name, target)
            continue
        audio_path = sched.audio_path()
        if not audio_path:
            logger.warning('schedule "%s": কোনো রেকর্ডিং নেই — বাদ', sched.name)
            continue
        try:
            announce = convert_to_wav(audio_path, f'sched_{sched.id}_{uuid.uuid4().hex[:8]}')
        except Exception as exc:  # pragma: no cover
            logger.warning('schedule "%s" audio convert ব্যর্থ: %s', sched.name, exc)
            continue
        logger.info('schedule "%s": %d client-কে কল (target expiry %s)', sched.name, len(clients), target)
        broadcast_voice_call(announce, clients)   # blocking — task worker-এ চলে
        ran += 1
    return f'{ran} schedule(s) চালানো হয়েছে'
