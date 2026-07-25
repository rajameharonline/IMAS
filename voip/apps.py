# VoIP (IP-phone) মডিউলের Django app configuration।
# app-to-app কলিং: admin panel ↔ client app (Asterisk + WebRTC)। বিস্তারিত: VOIP_PLAN.md
from django.apps import AppConfig


class VoipConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'voip'
    verbose_name = 'VoIP / IP Phone'

    def ready(self):
        # Client তৈরি হলে স্বয়ংক্রিয়ভাবে SIP endpoint provision করার signal যুক্ত করি।
        # ⚠️ এটি payment/RADIUS/MikroTik chain থেকে সম্পূর্ণ আলাদা — শুধু VoIP provisioning।
        from . import signals  # noqa: F401
