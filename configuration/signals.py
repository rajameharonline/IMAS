from django.db.models.signals import post_save
from django.dispatch import receiver
from configuration.models import Package


@receiver(post_save, sender=Package)
def sync_package_to_radius(sender, instance, **kwargs):
    """Package save হলে radgroupreply-তে Mikrotik-Group ও Framed-Pool upsert করে।
    PackageViewSet.perform_create/perform_update-ও এটি করে — signal শুধু
    Admin panel বা shell-এ সরাসরি save()-এর জন্য fallback হিসেবে থাকে।
    API-তে double-sync এড়াতে 'from_api' flag চেক করা হয়।
    """
    # API থেকে save হলে ViewSet perform_create/update-ই sync করে — এখানে skip
    if getattr(instance, '_radius_synced', False):
        return

    group = instance.mikrotik_profile
    if not group or not instance.is_active:
        return

    pool = instance.ip_pool_name or ''

    try:
        from radius_app.services.radius_service import RadiusService
        RadiusService.sync_package_to_all_servers(
            group_name=group,
            attribute='Mikrotik-Group',
            op=':=',
            value=group,
            pool_name=pool,
        )
    except Exception:
        pass
