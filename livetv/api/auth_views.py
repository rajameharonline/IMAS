# Live TV App Authentication — subscriber login/register/me
import jwt
from django.conf import settings
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import permissions

from ..models import LiveTVSubscriber

_ALG = 'HS256'
_EXP_DAYS = 90  # token 90 দিনের জন্য valid


def _make_token(subscriber):
    import datetime
    payload = {
        'sub_id': subscriber.id,
        'phone':  subscriber.phone,
        'exp':    timezone.now() + datetime.timedelta(days=_EXP_DAYS),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=_ALG)


def verify_livetv_token(request):
    """Authorization: Bearer <token> header অথবা ?token= query param থেকে subscriber বের করো।
    Returns subscriber বা None। কারণ-সহ বার্তা দরকার হলে verify_livetv_token_verbose() ব্যবহার করুন।
    """
    sub, _reason = verify_livetv_token_verbose(request)
    return sub


# reason → subscriber-কে দেখানোর মতো স্পষ্ট বাংলা বার্তা। payment/deactivation-এর
# ক্ষেত্রে user যেন বুঝতে পারে ঠিক কেন access বন্ধ হয়েছে (শুধু generic "login করুন" নয়)।
REASON_MESSAGES = {
    'missing':               'Live TV access-এর জন্য login করুন।',
    'invalid':                'সেশন অবৈধ। আবার লগইন করুন।',
    'token_expired':          'আপনার সেশনের মেয়াদ শেষ হয়েছে। আবার লগইন করুন।',
    'deactivated':            'আপনার Live TV অ্যাকাউন্ট নিষ্ক্রিয় করা হয়েছে। বিল পরিশোধ বা অফিসে যোগাযোগ করুন।',
    'subscription_expired':   'আপনার Live TV সাবস্ক্রিপশনের মেয়াদ শেষ হয়েছে। নবায়নের জন্য অফিসে যোগাযোগ করুন।',
}


def verify_livetv_token_verbose(request):
    """verify_livetv_token-এর মতোই, কিন্তু ব্যর্থ হলে কারণও ফেরত দেয় —
    client-facing endpoint (channel list, stream proxy) friendly 401 message দেখাতে ব্যবহার করে।
    Returns (subscriber_or_None, reason_key_or_None)। reason_key → REASON_MESSAGES-এ lookup করুন।
    """
    auth = request.headers.get('Authorization', '')
    if auth.startswith('Bearer '):
        token = auth[7:]
    else:
        token = request.query_params.get('token') if hasattr(request, 'query_params') else request.GET.get('token')
        if not token:
            return None, 'missing'
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[_ALG])
    except jwt.ExpiredSignatureError:
        return None, 'token_expired'
    except Exception:
        return None, 'invalid'
    try:
        sub = LiveTVSubscriber.objects.get(pk=payload['sub_id'])
    except LiveTVSubscriber.DoesNotExist:
        return None, 'invalid'
    if not sub.is_active:
        return None, 'deactivated'
    if sub.is_expired:
        return None, 'subscription_expired'
    return sub, None


class LiveTVLoginView(APIView):
    """POST /api/v1/livetv/app/auth/login/
    Body: { phone, password }
    """
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        phone    = (request.data.get('phone') or '').strip()
        password = (request.data.get('password') or '').strip()
        if not phone or not password:
            return Response({'detail': 'Phone ও password দিন।'}, status=400)

        sub = LiveTVSubscriber.objects.filter(phone=phone).first()
        if not sub or not sub.check_password(password):
            return Response({'detail': 'Phone নম্বর বা password ভুল।'}, status=401)
        if not sub.is_active:
            return Response({'detail': 'আপনার অ্যাকাউন্ট নিষ্ক্রিয়। অফিসে যোগাযোগ করুন।'}, status=403)
        if sub.is_expired:
            return Response({'detail': 'আপনার Live TV অ্যাক্সেসের মেয়াদ শেষ হয়েছে।'}, status=403)

        token = _make_token(sub)
        return Response({
            'token': token,
            'subscriber': {
                'id':    sub.id,
                'name':  sub.name,
                'phone': sub.phone,
            },
        })


class LiveTVRegisterView(APIView):
    """POST /api/v1/livetv/app/auth/register/
    Body: { name, phone, password, customer_id (optional) }
    Admin approval ছাড়া self-registration বন্ধ — is_active=False দিয়ে pending রাখা হয়।
    অথবা LIVETV_OPEN_REGISTRATION=True হলে সাথে সাথে active।
    """
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        name        = (request.data.get('name') or '').strip()
        phone       = (request.data.get('phone') or '').strip()
        password    = (request.data.get('password') or '').strip()
        customer_id = (request.data.get('customer_id') or '').strip()

        if not name or not phone or not password:
            return Response({'detail': 'নাম, phone ও password দিন।'}, status=400)
        if len(password) < 6:
            return Response({'detail': 'Password কমপক্ষে ৬ অক্ষরের হতে হবে।'}, status=400)
        if LiveTVSubscriber.objects.filter(phone=phone).exists():
            return Response({'detail': 'এই phone নম্বর দিয়ে ইতিমধ্যে রেজিস্ট্রেশন হয়েছে।'}, status=400)

        open_reg = getattr(settings, 'LIVETV_OPEN_REGISTRATION', False)
        sub = LiveTVSubscriber(
            name=name, phone=phone, customer_id=customer_id,
            is_active=open_reg,  # False হলে admin approval দরকার
        )
        sub.set_password(password)
        sub.save()

        if open_reg:
            token = _make_token(sub)
            return Response({
                'detail': 'রেজিস্ট্রেশন সফল।',
                'token':  token,
                'subscriber': {'id': sub.id, 'name': sub.name, 'phone': sub.phone},
            }, status=201)

        return Response({
            'detail': 'রেজিস্ট্রেশন সফল। Admin approval-এর পর আপনি লগইন করতে পারবেন।',
            'pending': True,
        }, status=201)


class LiveTVMeView(APIView):
    """GET /api/v1/livetv/app/auth/me/  — subscriber info
    PATCH /api/v1/livetv/app/auth/me/ — name বা password আপডেট
    DRF authentication বন্ধ — নিজস্ব verify_livetv_token() দিয়ে token check হয়
    """
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def _sub_data(self, sub):
        return {
            'id':          sub.id,
            'name':        sub.name,
            'phone':       sub.phone,
            'customer_id': sub.customer_id,
            'expires_at':  sub.expires_at,
        }

    def get(self, request):
        sub = verify_livetv_token(request)
        if not sub:
            return Response({'detail': 'Invalid or expired token.'}, status=401)
        return Response(self._sub_data(sub))

    def patch(self, request):
        sub = verify_livetv_token(request)
        if not sub:
            return Response({'detail': 'Invalid or expired token.'}, status=401)

        name     = (request.data.get('name') or '').strip()
        password = (request.data.get('password') or '').strip()

        if not name and not password:
            return Response({'detail': 'name বা password দিন।'}, status=400)

        fields_to_update = []
        if name:
            sub.name = name
            fields_to_update.append('name')
        if password:
            if len(password) < 6:
                return Response({'detail': 'Password কমপক্ষে ৬ অক্ষরের হতে হবে।'}, status=400)
            sub.set_password(password)
            fields_to_update.append('password')

        sub.save(update_fields=fields_to_update)
        return Response(self._sub_data(sub))
