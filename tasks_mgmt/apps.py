from django.apps import AppConfig


class TasksMgmtConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'tasks_mgmt'

    def ready(self):
        # signal handler import — app load হলে Task assign/status notification
        # ও audit-log wire up হয়। ready()-তে import করা Django best practice
        # (circular import এড়াতে)।
        import tasks_mgmt.signals  # noqa
