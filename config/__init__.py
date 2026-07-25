# Django startup-এ Celery app লোড করা হচ্ছে
from .celery import app as celery_app

__all__ = ('celery_app',)
