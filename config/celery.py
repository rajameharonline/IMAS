# এই ফাইলটি Celery configuration - background task এবং periodic task এর জন্য।
import os
from celery import Celery
from django.conf import settings

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

app = Celery('isp_bnas')

# Django settings থেকে Celery configuration লোড করা হচ্ছে
app.config_from_object('django.conf:settings', namespace='CELERY')

# সব installed app থেকে task auto-discover করা হবে
app.autodiscover_tasks()


@app.task(bind=True)
def debug_task(self):
    print(f'Request: {self.request!r}')
