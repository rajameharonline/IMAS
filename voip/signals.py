# VoIP provisioning signals।
# নতুন Client তৈরি হলে স্বয়ংক্রিয়ভাবে SIP endpoint provision করি।
# ⚠️ গুরুত্বপূর্ণ: এটি billing/RADIUS/MikroTik chain থেকে সম্পূর্ণ আলাদা signal।
#    provisioning ব্যর্থ হলেও যেন client create না ভাঙে — তাই try/except।
import logging

from django.db.models.signals import post_save
from django.dispatch import receiver

from clients.models import Client
from voip.services.asterisk_provision import provision_endpoint

logger = logging.getLogger(__name__)


@receiver(post_save, sender=Client, dispatch_uid='voip_provision_client_endpoint')
def _provision_client_endpoint(sender, instance, created, **kwargs):
    # শুধু নতুন client-এর জন্য endpoint তৈরি (update-এ বারবার নয়)।
    if not created:
        return
    try:
        provision_endpoint(client=instance)
    except Exception as exc:
        # কখনোই client save ভাঙতে দেব না — শুধু log।
        logger.warning('Client %s-এর SIP endpoint provision ব্যর্থ: %s', instance.pk, exc)
