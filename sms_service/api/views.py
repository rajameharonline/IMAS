# এই ফাইলটি SMS service API views।
from rest_framework import viewsets, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from sms_service.models import SMSGateway, SMSTemplate, SMSGroup, SMSLog
from sms_service.api.serializers import (
    SMSGatewaySerializer, SMSTemplateSerializer, SMSGroupSerializer,
    SMSLogSerializer, SendSMSSerializer
)
from sms_service.services import SMSService, MessagingService


class SMSGatewayViewSet(viewsets.ModelViewSet):
    """Multi-channel messaging gateway CRUD + test send।"""
    queryset = SMSGateway.objects.all().order_by('-is_default', '-id')
    serializer_class = SMSGatewaySerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['provider_type', 'is_active']

    def _enforce_single_default(self, instance):
        # is_default=True হলে বাকিগুলো False (একটাই default)
        if instance.is_default:
            SMSGateway.objects.exclude(pk=instance.pk).filter(is_default=True).update(is_default=False)

    def perform_create(self, serializer):
        self._enforce_single_default(serializer.save())

    def perform_update(self, serializer):
        self._enforce_single_default(serializer.save())

    @action(detail=True, methods=['post'], url_path='test')
    def test_send(self, request, pk=None):
        """এই gateway দিয়ে test message। body: { to, message }"""
        gw = self.get_object()
        to = (request.data.get('to') or '').strip()
        message = (request.data.get('message') or 'Test message — ISP BNAS').strip()
        if not to:
            return Response({'error': 'প্রাপক (to) দিন — phone / chat_id / email।'}, status=400)
        ok, resp = MessagingService.send(gw, to, message)
        SMSLog.objects.create(
            recipient_phone=to, message=message,
            status='sent' if ok else 'failed', gateway=gw,
            sent_by=request.user, gateway_response=str(resp)[:1000],
        )
        return Response({'success': ok, 'response': resp}, status=200 if ok else 502)


class SMSTemplateViewSet(viewsets.ModelViewSet):
    queryset = SMSTemplate.objects.all()
    serializer_class = SMSTemplateSerializer
    permission_classes = [permissions.IsAuthenticated]


class SMSGroupViewSet(viewsets.ModelViewSet):
    queryset = SMSGroup.objects.all()
    serializer_class = SMSGroupSerializer
    permission_classes = [permissions.IsAuthenticated]


class SMSLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = SMSLog.objects.all()
    serializer_class = SMSLogSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['status', 'client']


def _bg_push_sms(ids, user_id, message):
    """background thread — নির্বাচিত client-দের render করা message FCM push + SMSLog +
    PushNotificationLog। (FCM cold-init ধীর → request block না করতে thread-এ)।"""
    from django.db import connection as _conn
    from mobile_api.services.push_service import send_to_token
    from mobile_api.models import PushNotificationLog
    from clients.models import Client
    from sms_service.services import render_sms_template
    try:
        from system_settings.models import CompanySetup
        title = (getattr(CompanySetup.objects.first(), 'name', '') or 'নোটিশ')
    except Exception:
        title = 'নোটিশ'
    sent = fail = 0
    for c in Client.objects.filter(id__in=ids):
        if not c.fcm_token:
            fail += 1
            continue
        body = render_sms_template(message, c)
        ok = send_to_token(c.fcm_token, title, body, data={'type': 'admin_message'})
        sent += 1 if ok else 0
        fail += 0 if ok else 1
        SMSLog.objects.create(recipient_phone=c.phone or '', client=c, message=body,
                              status='sent' if ok else 'failed', sent_by_id=user_id,
                              gateway_response='channel=app (push)')
    PushNotificationLog.objects.create(
        title=title, body=message, target_type='client',
        sent_count=sent, fail_count=fail, sent_by_id=user_id,
        extra_data={'source': 'sms_service_send'})
    _conn.close()   # thread-এর DB connection ছেড়ে দিই


def _handle_app_push_send(request, client_ids, message):
    """channel=app — background thread-এ FCM push spawn করে সাথে সাথে Response।"""
    import threading
    from clients.models import Client
    ids = list(Client.objects.filter(id__in=client_ids).values_list('id', flat=True))
    ids_with_token = list(Client.objects.filter(id__in=ids).exclude(fcm_token='')
                          .values_list('id', flat=True))
    threading.Thread(target=_bg_push_sms, args=(ids, request.user.id, message), daemon=True).start()
    return Response({'channel': 'app', 'queued': True,
                     'count': len(ids_with_token), 'no_app': len(ids) - len(ids_with_token)})


def _send_sms_to_clients(client_ids, message, request_user):
    """client_ids-দের template render করা SMS পাঠায় → results list (send_sms নিজেই log করে)।"""
    from clients.models import Client
    from sms_service.services import render_sms_template
    results = []
    for c in Client.objects.filter(id__in=client_ids):
        if not c.phone:
            continue
        text = render_sms_template(message, c)   # {placeholder} → আসল মান
        ok = SMSService.send_sms(c.phone, text, client=c, sent_by=request_user)
        results.append({'client_id': c.id, 'phone': c.phone, 'success': ok})
    return results


class SendSMSViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    # predefined client segment (group)
    PREDEFINED = [
        ('all',      'All Client'),
        ('active',   'Active Client'),
        ('inactive', 'Inactive Client'),
        ('expired',  'Expired Client'),
        ('paid',     'Paid Client'),
        ('unpaid',   'Unpaid / Due Client'),
    ]

    @staticmethod
    def _group_qs(key):
        from clients.models import Client
        qs = Client.objects.exclude(status__in=['left', 'cancelled'])
        if key == 'active':   return qs.filter(status='active')
        if key == 'inactive': return qs.filter(status__in=['suspended', 'inactive'])
        if key == 'expired':  return qs.filter(status='expired')
        if key == 'paid':     return qs.filter(due_amount__lte=0)
        if key == 'unpaid':   return qs.filter(due_amount__gt=0)
        return qs  # all

    @action(detail=False, methods=['get'], url_path='groups')
    def groups(self, request):
        """উপলব্ধ group তালিকা + count (predefined + custom SMSGroup)।"""
        from django.db.models import Count
        out = []
        for key, name in self.PREDEFINED:
            out.append({'key': key, 'name': name, 'count': self._group_qs(key).count()})
        # প্রতি group-এ আলাদা .clients.count() query চালালে N+1 হয় — একটাই query-তে
        # annotate করে নিলাম (SonarCloud pythonenterprise:S8440)।
        for g in SMSGroup.objects.annotate(clients_count=Count('clients')):
            out.append({'key': f'sg:{g.id}', 'name': f'{g.name} (Custom)',
                        'count': g.clients_count})
        return Response(out)

    @action(detail=False, methods=['get'], url_path='recipients')
    def recipients(self, request):
        """নির্বাচিত group(গুলো)-এর client → {id,name,mobile} (dedupe, phone থাকা)।
        query: ?groups=all,unpaid বা ?groups=sg:3"""
        from clients.models import Client
        keys = [k for k in (request.query_params.get('groups') or '').split(',') if k]
        ids = set()
        for k in keys:
            if k.startswith('sg:'):
                ids.update(SMSGroup.objects.filter(id=k[3:]).values_list('clients__id', flat=True))
            else:
                ids.update(self._group_qs(k).values_list('id', flat=True))
        ids.discard(None)
        rows = (Client.objects.filter(id__in=ids).exclude(phone='')
                .values('id', 'full_name', 'phone', 'fcm_token').order_by('full_name'))
        return Response([{'id': r['id'], 'name': r['full_name'], 'mobile': r['phone'],
                          'app': bool(r['fcm_token'])} for r in rows])

    @action(detail=False, methods=['post'], url_path='preview')
    def preview(self, request):
        """একটি client-এর জন্য template render করে দেখায় (live preview)।
        body: { client_id, message }"""
        from sms_service.services import render_sms_template
        from clients.models import Client
        message = request.data.get('message') or ''
        cid = request.data.get('client_id')
        client = Client.objects.filter(id=cid).first() if cid else None
        return Response({'rendered': render_sms_template(message, client)})

    @action(detail=False, methods=['post'], url_path='send')
    def send(self, request):
        """SMS পাঠানো — দুই মোড:
        (১) client_ids দিলে: প্রতিটি client-এর জন্য template-এর {placeholder} আসল
            মানে রূপান্তর করে (CustomerName/ClientID/CompanyName…) তারপর পাঠায়।
        (২) phones দিলে: হুবহু message (render ছাড়া) পাঠায়।"""
        message = (request.data.get('message') or '').strip()
        if not message:
            return Response({'error': 'message আবশ্যক।'}, status=400)

        client_ids = request.data.get('client_ids')
        channel = request.data.get('channel', 'sms')   # 'sms' | 'app'

        # ── App (Push) channel — ক্লায়েন্টের মোবাইল অ্যাপে FCM push (background) ──
        if channel == 'app' and client_ids:
            return _handle_app_push_send(request, client_ids, message)

        # send_sms নিজেই SMSLog তৈরি করে (client সহ) — তাই আলাদা log লাগে না
        if client_ids:
            return Response({'results': _send_sms_to_clients(client_ids, message, request.user)})

        # fallback: phones[] (render ছাড়া হুবহু)
        serializer = SendSMSSerializer(data=request.data)
        if serializer.is_valid():
            results = []
            for phone in serializer.validated_data['phones']:
                ok = SMSService.send_sms(phone, message, sent_by=request.user)
                results.append({'phone': phone, 'success': ok})
            return Response({'results': results})
        return Response(serializer.errors, status=400)
