from django.apps import AppConfig


class OltMgmtConfig(AppConfig):
    name = 'olt_mgmt'

    def ready(self):
        from olt_mgmt import signals  # noqa: F401 — Client mac-change → link signal
