# সিস্টেম-লেভেল অপারেশনাল চেক (disk usage ইত্যাদি) — এই ফাইলে Celery task থাকবে।
from celery import shared_task
from django.utils import timezone
from datetime import timedelta
import logging
import shutil

logger = logging.getLogger(__name__)

# disk usage % এই থ্রেশহোল্ডের উপরে গেলে alert notification পাঠাবে
DISK_USAGE_WARN_PERCENT = 85

# চেক করা path গুলো (label, path) — root partition ও backup partition আলাদা হলে দুটোই ধরবে
DISK_CHECK_PATHS = [
    ('Root (/)', '/'),
    ('Backups (/var/backups)', '/var/backups'),
]


@shared_task(name='system_settings.check_disk_usage')
def check_disk_usage():
    # প্রতিদিন চলে (CELERY_BEAT_SCHEDULE)। কোনো path-এর usage থ্রেশহোল্ড পার হলে
    # superadmin/admin-দের StaffNotification বেল-এ alert দেখাবে (mysqldump backup
    # কখনো delete হয় না বলে ডিস্ক ধীরে ধীরে ভরে যেতে পারে — এই চেক সেটার জন্য)।
    from accounts.models import User
    from support.models import StaffNotification

    alerts = []
    for label, path in DISK_CHECK_PATHS:
        try:
            usage = shutil.disk_usage(path)
        except FileNotFoundError:
            continue
        percent_used = round(usage.used / usage.total * 100, 1)
        if percent_used >= DISK_USAGE_WARN_PERCENT:
            free_gb = round(usage.free / (1024 ** 3), 1)
            alerts.append(f'{label}: {percent_used}% ব্যবহৃত, মাত্র {free_gb} GB ফাঁকা আছে')

    if not alerts:
        return {'status': 'ok', 'alerts': []}

    message = ' | '.join(alerts)
    title = 'Disk Space Warning'

    # একই দিনে duplicate notification এড়াতে — গত ২৪ ঘণ্টায় একই title-এর unread
    # notification থাকলে আবার পাঠাবে না।
    recent_exists = StaffNotification.objects.filter(
        notif_type='system',
        title=title,
        created_at__gte=timezone.now() - timedelta(hours=24),
    ).exists()
    if recent_exists:
        logger.warning(f'Disk usage alert (duplicate suppressed): {message}')
        return {'status': 'warning_suppressed', 'alerts': alerts}

    recipients = User.objects.filter(is_active=True, role__in=['superadmin', 'admin'])
    StaffNotification.objects.bulk_create([
        StaffNotification(
            recipient_id=uid,
            notif_type='system',
            title=title,
            message=message,
            link_url='',
        )
        for uid in recipients.values_list('id', flat=True)
    ])
    logger.warning(f'Disk usage alert sent: {message}')
    return {'status': 'warning_sent', 'alerts': alerts}
