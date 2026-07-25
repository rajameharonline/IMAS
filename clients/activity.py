# Client activity log helper — billing, tasks, views যেকোনো জায়গা থেকে import করা যাবে।
from decimal import Decimal


def log_client_activity(
    client,
    event_type: str,
    title: str,
    description: str = '',
    amount=None,
    performed_by: str = 'System',
    user=None,
):
    try:
        from clients.models import ClientActivityLog
        ClientActivityLog.objects.create(
            client=client,
            event_type=event_type,
            title=title,
            description=description,
            amount=Decimal(str(amount)) if amount is not None else None,
            performed_by=performed_by,
            performed_by_user=user,
        )
    except Exception:
        pass  # log failure কখনো main flow ভাঙবে না
