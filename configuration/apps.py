from django.apps import AppConfig


class ConfigurationConfig(AppConfig):
    name = 'configuration'

    def ready(self):
        import configuration.signals  # noqa: F401
