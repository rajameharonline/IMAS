# এই ফাইলটি Mikrotik router backup ও traffic sync Celery task।
from celery import shared_task
from django.utils import timezone
import logging

logger = logging.getLogger(__name__)


@shared_task(name='mikrotik.router_backup')
def router_backup_task():
    # সব active Mikrotik router-এর backup নেয় - প্রতিদিন রাত ২টায় চলবে
    from mikrotik_app.models import MikrotikServer, RouterBackup
    from mikrotik_app.services.mikrotik_service import MikrotikService

    servers = MikrotikServer.objects.filter(is_active=True)
    results = []
    for server in servers:
        try:
            service = MikrotikService.from_server_model(server)
            backup_name = service.create_backup()
            if backup_name:
                RouterBackup.objects.create(
                    server=server,
                    filename=backup_name,
                    backup_type='auto',
                )
                results.append({'server': server.name, 'status': 'success', 'file': backup_name})
            else:
                results.append({'server': server.name, 'status': 'failed'})
        except Exception as e:
            logger.exception(f"Backup error for {server.name}: {e}")
            results.append({'server': server.name, 'status': 'error', 'error': str(e)})

    return results


@shared_task(name='mikrotik.sync_active_users')
def sync_active_users():
    # FreeRADIUS online users ও Mikrotik active connections sync করে
    from radius_app.services.radius_service import RadiusService
    from radius_app.models import RadiusSession

    online_users = RadiusService.all_online_users()

    RadiusSession.objects.filter(is_online=True).update(is_online=False)

    for user in online_users:
        RadiusSession.objects.update_or_create(
            username=user['username'],
            defaults={
                'nas_ip': user.get('nas_ip', ''),
                'framed_ip': user.get('ip', ''),
                'session_id': user.get('session_id', ''),
                'bytes_in': user.get('bytes_in', 0),
                'bytes_out': user.get('bytes_out', 0),
                'is_online': True,
            }
        )

    return {'synced': len(online_users)}
