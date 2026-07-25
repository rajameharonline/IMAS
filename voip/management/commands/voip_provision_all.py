# বিদ্যমান সব client + (ঐচ্ছিক) active user-এর জন্য SIP endpoint একবারে provision করে।
# install.sh শেষে চালায়; পরে নতুন agent যোগ করতে হাতেও চালানো যায়:
#   python manage.py voip_provision_all
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from clients.models import Client
from voip.services.asterisk_provision import provision_endpoint


class Command(BaseCommand):
    help = 'সব client (ও active staff user)-এর জন্য SIP endpoint provision করে।'

    def add_arguments(self, parser):
        parser.add_argument('--clients-only', action='store_true',
                            help='শুধু client endpoint (agent বাদ)।')

    def handle(self, *args, **opts):
        n_c = n_u = 0
        for c in Client.objects.all().iterator():
            provision_endpoint(client=c)
            n_c += 1
        self.stdout.write(self.style.SUCCESS(f'Client endpoint provisioned: {n_c}'))

        if not opts['clients_only']:
            user_model = get_user_model()
            # শুধু active staff (কল করতে পারে এমন) — চাইলে role filter যোগ করা যায়।
            qs = user_model.objects.filter(is_active=True)
            for u in qs.iterator():
                provision_endpoint(user=u)
                n_u += 1
            self.stdout.write(self.style.SUCCESS(f'Agent endpoint provisioned: {n_u}'))
