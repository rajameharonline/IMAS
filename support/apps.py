# Support app config — signals.py register করার জন্য ready() override করা হয়েছে।
from django.apps import AppConfig


class SupportConfig(AppConfig):
    name = 'support'
    default_auto_field = 'django.db.models.BigAutoField'

    def ready(self):
        # signals module import — Django startup-এ একবার চালু হয়, এতে
        # post_save / pre_save receiver-গুলো connect হয়ে যায়।
        from support import signals  # noqa: F401
