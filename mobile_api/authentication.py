# Mobile Client-এর JWT authentication — user_id নেই, client_id আছে
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, AuthenticationFailed
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed as DRFAuthFailed
import jwt
from django.conf import settings
from clients.models import Client


class MobileClientUser:
    # Django User-এর মতো behave করে, কিন্তু Client-এর জন্য
    def __init__(self, client):
        self.client   = client
        self.id       = f'client_{client.id}'
        self.pk       = client.id
        self.is_active = True

    @property
    def is_authenticated(self):
        return True

    @property
    def is_anonymous(self):
        return False

    def __str__(self):
        return f'MobileClient:{self.client.customer_id}'


class MobileClientAuthentication(BaseAuthentication):
    # Authorization: Bearer <token> header থেকে client_id extract করা
    def authenticate(self, request):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return None

        token_str = auth_header[7:]
        try:
            # simplejwt signing key ব্যবহার করে decode
            from rest_framework_simplejwt.settings import api_settings
            payload = jwt.decode(
                token_str,
                settings.SECRET_KEY,
                algorithms=['HS256'],
                options={'verify_exp': True},
            )
        except jwt.ExpiredSignatureError:
            raise DRFAuthFailed('Token মেয়াদোত্তীর্ণ।')
        except jwt.InvalidTokenError:
            raise DRFAuthFailed('Token অবৈধ।')

        client_id = payload.get('client_id')
        if not client_id:
            return None  # staff token — অন্য authenticator handle করবে

        try:
            client = Client.objects.select_related('router', 'package', 'zone', 'subzone').get(
                pk=client_id, app_enabled=True
            )
        except Client.DoesNotExist:
            raise DRFAuthFailed('Client পাওয়া যায়নি বা app access নেই।')

        user = MobileClientUser(client)
        # request.auth-এ payload রাখা যাতে views client_id access করতে পারে
        return (user, payload)

    def authenticate_header(self, request):
        return 'Bearer'


class MobilePOPUser:
    # POP reseller-এর জন্য Django User-সদৃশ wrapper (pop_id দিয়ে চেনা যায়)।
    def __init__(self, pop):
        self.pop       = pop
        self.id        = f'pop_{pop.id}'
        self.pk        = pop.id
        self.is_active = True

    @property
    def is_authenticated(self):
        return True

    @property
    def is_anonymous(self):
        return False

    def __str__(self):
        return f'MobilePOP:{self.pop.code}'


class MobilePOPAuthentication(BaseAuthentication):
    # POP token (pop_id claim) → POP resolve। staff/client token হলে None ফেরায়।
    def authenticate(self, request):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return None
        token_str = auth_header[7:]
        try:
            payload = jwt.decode(
                token_str, settings.SECRET_KEY, algorithms=['HS256'],
                options={'verify_exp': True},
            )
        except jwt.ExpiredSignatureError:
            raise DRFAuthFailed('Token মেয়াদোত্তীর্ণ।')
        except jwt.InvalidTokenError:
            raise DRFAuthFailed('Token অবৈধ।')

        pop_id = payload.get('pop_id')
        if not pop_id:
            return None  # staff/client token — অন্য authenticator handle করবে

        from pop.models import POP
        try:
            pop = POP.objects.get(pk=pop_id, is_active=True)
        except POP.DoesNotExist:
            raise DRFAuthFailed('POP পাওয়া যায়নি বা নিষ্ক্রিয়।')
        return (MobilePOPUser(pop), payload)

    def authenticate_header(self, request):
        return 'Bearer'
