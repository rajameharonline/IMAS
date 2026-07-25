# Client-এর mac_address যোগ/পরিবর্তন হলে সাথে সাথে ONU↔Client link refresh —
# ১৫-মিনিট beat-এর অপেক্ষা ছাড়াই নতুন client টেবিলে চলে আসে।
#
# bridge walk ভারী বলে signal সরাসরি walk করে না — debounce করে link_onu_clients
# task enqueue করে (cache lock দিয়ে bulk-import-এ স্প্যাম রোধ)। ~২০s পর task চলে।
import logging

from django.db.models.signals import pre_save, post_save
from django.dispatch import receiver

from clients.models import Client

logger = logging.getLogger(__name__)

# pre_save snapshot — শুধু mac_address আসলেই বদলালে enqueue করতে
_OLD_MAC = {}


@receiver(pre_save, sender=Client)
def _capture_old_mac(sender, instance, **kwargs):
    if not instance.pk:
        return
    try:
        _OLD_MAC[instance.pk] = (
            Client.objects.filter(pk=instance.pk)
            .values_list('mac_address', flat=True).first()
        )
    except Exception:
        _OLD_MAC.pop(instance.pk, None)


@receiver(post_save, sender=Client)
def _link_on_mac_change(sender, instance, created, **kwargs):
    old = (_OLD_MAC.pop(instance.pk, None) or '').strip()
    new = (instance.mac_address or '').strip()
    if not new:
        return
    if created or old != new:
        _enqueue_link()


def _enqueue_link():
    """debounce — cache lock দিয়ে ১২০s-এ একবার link task enqueue (২০s countdown)।"""
    try:
        from django.core.cache import cache
        from olt_mgmt.tasks import link_onu_clients
        # cache.add → key না থাকলে True (lock নিল), থাকলে False (skip)
        if cache.add('olt_link_pending', 1, 120):
            link_onu_clients.apply_async(countdown=20)
            logger.info('Client mac change → link_onu_clients enqueued (20s)')
    except Exception as exc:
        logger.warning('link enqueue failed: %s', exc)
        try:
            from olt_mgmt.tasks import link_onu_clients
            link_onu_clients.delay()
        except Exception:
            pass
