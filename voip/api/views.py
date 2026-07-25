# VoIP API views।
# এখানকার মূল endpoint:
#   GET  /api/v1/voip/sip-credentials/   → softphone-এর জন্য ephemeral SIP creds
#   POST /api/v1/voip/call/originate/    → agent→client কল শুরু (ARI)
#   GET  /api/v1/voip/call-logs/         → কল হিস্ট্রি (client profile-এ)
#   /api/v1/voip/voice-messages/         → ভয়েস মেসেজ upload/list
import logging
import time

from django.conf import settings
from rest_framework import permissions, viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from clients.models import Client
from role_permissions.utils import decrypt_password
from voip.models import (
    CallLog, VoiceMessage, VoiceRecording, SipEndpoint, VoiceCallSchedule,
    PBXAgent, RingGroup, RingGroupMember, IVRMenu, IVROption,
    HotlineNumber, PBXBusinessHour,
)
from voip.services.asterisk_provision import (
    provision_endpoint, endpoint_name_for,
)
from voip.api.serializers import (
    CallLogSerializer, VoiceMessageSerializer, VoiceRecordingSerializer,
    VoiceCallScheduleSerializer,
    PBXAgentSerializer, RingGroupSerializer, RingGroupMemberSerializer,
    IVRMenuSerializer, IVROptionSerializer,
    HotlineNumberSerializer, PBXBusinessHourSerializer,
)

logger = logging.getLogger(__name__)


def _turn_ice_servers():
    # coturn ephemeral (REST) credentials — TURN abuse রোধে time-limited HMAC token।
    # static long-term secret কখনো frontend-এ পাঠানো হয় না।
    import hashlib
    import hmac
    import base64

    urls = getattr(settings, 'TURN_URLS', [])
    secret = getattr(settings, 'TURN_SECRET', '')
    if not urls or not secret:
        return []
    ttl = int(getattr(settings, 'TURN_TTL', 3600))
    username = f'{int(time.time()) + ttl}'
    # coturn REST-credential স্পেক HMAC-SHA1 বাধ্যতামূলক করে (credential =
    # base64(HMAC-SHA1(secret, username)))। HMAC-SHA1 নিরাপদ — SHA1-এর collision
    # resistance-এর উপর নির্ভর করে না; এটা data hashing নয়, coturn-এর সাথে মেলাতে হয়।
    digest = hmac.new(secret.encode(), username.encode(), hashlib.sha1).digest()  # NOSONAR(python:S4790) — coturn REST API spec বাধ্যতামূলক করে HMAC-SHA1; HMAC-এর নিরাপত্তা SHA1 collision resistance-এর উপর নির্ভর করে না, অন্য hash দিলে coturn credential mismatch করবে
    credential = base64.b64encode(digest).decode()
    return [{'urls': urls, 'username': username, 'credential': credential}]


class SipCredentialsView(APIView):
    # JWT-auth করা user-এর জন্য runtime SIP creds।
    # কেন ephemeral: frontend-এ static SIP password রাখা হয় না (leak রোধ)।
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        # agent endpoint নিশ্চিত করি (না থাকলে তৈরি)।
        ep = provision_endpoint(user=user)
        return Response({
            'sip_user': ep.endpoint_name,
            'sip_pass': decrypt_password(ep.secret_encrypted),
            'wss_url':  getattr(settings, 'VOIP_WSS_URL', ''),
            'sip_domain': getattr(settings, 'VOIP_SIP_DOMAIN', ''),
            'ice_servers': _turn_ice_servers(),
            'enabled': getattr(settings, 'VOIP_ENABLED', False),
        })


class CallOriginateView(APIView):
    # agent → client কল শুরু করে (ARI Originate)। Asterisk চালু না থাকলে 503।
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        client_id = request.data.get('client')
        if not client_id:
            return Response({'detail': 'client আবশ্যক।'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            client = Client.objects.get(pk=client_id)
        except Client.DoesNotExist:
            return Response({'detail': 'Client পাওয়া যায়নি।'}, status=status.HTTP_404_NOT_FOUND)

        if not getattr(settings, 'VOIP_ENABLED', False):
            # Phase 1 (Asterisk setup) সম্পন্ন না হলে কল করা যাবে না।
            return Response(
                {'detail': 'VoIP সার্ভার এখনো চালু হয়নি (VOIP_ENABLED=False)।'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        # client ও agent endpoint নিশ্চিত করি।
        provision_endpoint(client=client)
        agent_ep = provision_endpoint(user=request.user)
        callee = endpoint_name_for(client=client)

        # FCM push → client app জাগানো (SIP register হওয়ার সুযোগ দেওয়া)।
        # agent-এর softphone ring হওয়া + agent answer করতে যে সময় লাগে (~5-15s)
        # সেই সময়ের মধ্যে client app register করে নিতে পারবে।
        # dialplan voip-internal ইতিমধ্যে ~60s retry করে → app register হলেই connect।
        fcm_token = getattr(client, 'fcm_token', '') or ''
        if fcm_token:
            try:
                from mobile_api.services.push_service import send_to_token
                send_to_token(
                    fcm_token, '📞 ইনকামিং কল', 'Rajamehar Online থেকে কল আসছে…',
                    data={'type': 'incoming_call', 'caller': agent_ep.endpoint_name},
                    high_priority=True, data_only=True,
                )
            except Exception as fcm_exc:
                logger.warning('CallOriginate FCM ব্যর্থ (%s): %s', callee, fcm_exc)

        # ARI Originate — agent softphone বাজে; answer করলে dialplan client-কে dial করে।
        try:
            from voip.services.ari_client import originate_call
            channel_id = originate_call(caller=agent_ep.endpoint_name, callee=callee)
        except ImportError:
            return Response(
                {'detail': 'ARI client এখনো implement হয়নি (Phase 3)।'},
                status=status.HTTP_501_NOT_IMPLEMENTED,
            )
        except Exception as exc:
            logger.warning('Originate ব্যর্থ: %s', exc)
            return Response({'detail': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        # initial CallLog তৈরি; বাকি state ARI listener আপডেট করবে।
        CallLog.objects.create(
            client=client, agent=request.user, direction='outbound',
            sip_channel=channel_id or '', caller_endpoint=agent_ep.endpoint_name,
            callee_endpoint=callee, status='initiated',
        )
        return Response({'channel': channel_id, 'callee': callee})


class RegisteredClientsView(APIView):
    """GET /api/v1/voip/registered-clients/
    Asterisk-এ SIP register করা endpoint-গুলোর তালিকা ফেরায় (client + staff agent)।
    Frontend এটা poll করে search dropdown / PBX Agents পেজে online indicator দেখায়।
    Response: {
      "registered": ["client_4", "agent_2", ...],   # সব (backward-compat)
      "clients":    ["client_4", ...],               # শুধু client endpoint
      "agents":     ["agent_2", "agent_26", ...]      # শুধু staff/agent endpoint
    }
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if not getattr(settings, 'VOIP_ENABLED', False):
            return Response({'registered': [], 'clients': [], 'agents': []})
        try:
            from voip.services.voice_broadcast import _ami
            import re
            resp = _ami(
                ['Action: Command\r\nCommand: pjsip show contacts\r\n\r\n'],
                read_timeout=3.0,
            )
            # "client_4/sip:client_4@.." বা "agent_2/sip:agent_2@.." → endpoint নাম
            all_eps  = list(set(re.findall(r'([A-Za-z0-9_]++)/sip:', resp)))
            clients  = [e for e in all_eps if e.startswith('client_')]
            agents   = [e for e in all_eps if e.startswith('agent_')]
            return Response({
                'registered': all_eps,
                'clients':    clients,
                'agents':     agents,
            })
        except Exception as exc:
            logger.warning('registered-clients check ব্যর্থ: %s', exc)
            return Response({'registered': [], 'clients': [], 'agents': []})


class CallLogViewSet(viewsets.ReadOnlyModelViewSet):
    # কল হিস্ট্রি (read-only — log ARI listener লেখে)।
    # filter: ?client=<id>&direction=&status=
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = CallLogSerializer

    def get_queryset(self):
        qs = CallLog.objects.select_related('client', 'agent')
        from django.db.models import Q
        p = self.request.query_params
        if p.get('client'):
            qs = qs.filter(client_id=p['client'])
        if p.get('direction'):
            qs = qs.filter(direction=p['direction'])
        if p.get('status'):
            qs = qs.filter(status=p['status'])
        # search — client নাম/কোড/ফোন বা endpoint দিয়ে।
        s = (p.get('search') or '').strip()
        if s:
            qs = qs.filter(
                Q(client__full_name__icontains=s)
                | Q(client__customer_id__icontains=s)
                | Q(client__phone__icontains=s)
                | Q(caller_endpoint__icontains=s)
                | Q(callee_endpoint__icontains=s)
            )
        # date range (started_at-এর তারিখ অনুযায়ী)।
        if p.get('date_from'):
            qs = qs.filter(started_at__date__gte=p['date_from'])
        if p.get('date_to'):
            qs = qs.filter(started_at__date__lte=p['date_to'])
        return qs.order_by('-started_at', '-id')


def _push_voice_notification(client, vm):
    """client-এর fcm token থাকলে voice message push নোটিফিকেশন → pushed bool।"""
    token = getattr(client, 'fcm_token', '') or ''
    if not token:
        return False
    try:
        from mobile_api.services.push_service import send_to_token
        return bool(send_to_token(
            token, '🔊 ভয়েস বার্তা',
            'Rajamehar Online থেকে একটি ভয়েস বার্তা এসেছে।',
            data={'type': 'voice_message', 'vm_id': str(vm.id)}))
    except Exception:  # pragma: no cover
        return False


def _resolve_broadcast_audio_source(request):
    """recording_id বা uploaded audio → (src_path, tmp_path, error_response)।
    tmp_path fresh upload হলে (পরে মুছতে হবে); source না পেলে error_response non-None।"""
    import os
    import tempfile
    recording_id = request.data.get('recording_id')
    audio = request.FILES.get('audio')
    if recording_id:
        rec = VoiceRecording.objects.filter(pk=recording_id).first()
        if not rec or not rec.audio:
            return None, None, Response({'detail': 'রেকর্ডিং পাওয়া যায়নি।'}, status=status.HTTP_400_BAD_REQUEST)
        return rec.audio.path, None, None
    if audio:
        # uploaded audio → temp ফাইল (পরে ffmpeg convert হবে)।
        suffix = os.path.splitext(audio.name or '')[1] or '.webm'
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        for chunk in audio.chunks():
            tmp.write(chunk)
        tmp.close()
        return tmp.name, tmp.name, None
    return None, None, Response({'detail': 'রেকর্ডিং বা audio ফাইল আবশ্যক।'}, status=status.HTTP_400_BAD_REQUEST)


class VoiceMessageViewSet(viewsets.ModelViewSet):
    # ভয়েস মেসেজ upload/list। create-এ sent_by = current user।
    # filter: ?client=<id>
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = VoiceMessageSerializer
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        qs = VoiceMessage.objects.select_related('client', 'sent_by')
        client_id = self.request.query_params.get('client')
        if client_id:
            qs = qs.filter(client_id=client_id)
        return qs

    def perform_create(self, serializer):
        serializer.save(sent_by=self.request.user)
        # TODO (Phase 5): client app-এ FCM push পাঠানো।

    @action(detail=True, methods=['post'])
    def mark_heard(self, request, pk=None):
        # client app থেকে শোনা হলে heard mark করার জন্য।
        from django.utils import timezone
        vm = self.get_object()
        if not vm.is_heard:
            vm.is_heard = True
            vm.heard_at = timezone.now()
            vm.save(update_fields=['is_heard', 'heard_at'])
        return Response({'status': 'ok'})

    # ── Voice SMS — recipient preview + broadcast ───────────────────────────
    def _recipient_qs(self, p):
        # expiry/status/search/zone অনুযায়ী client filter।
        from django.db.models import Q
        from clients.models import Client
        qs = Client.objects.all()
        if p.get('expire_from'):
            qs = qs.filter(expiry_date__gte=p['expire_from'])
        if p.get('expire_to'):
            qs = qs.filter(expiry_date__lte=p['expire_to'])
        if p.get('status'):
            qs = qs.filter(status=p['status'])
        if p.get('zone'):
            qs = qs.filter(zone_id=p['zone'])
        s = (p.get('search') or '').strip()
        if s:
            qs = qs.filter(
                Q(full_name__icontains=s) | Q(customer_id__icontains=s) | Q(phone__icontains=s)
            )
        return qs

    @action(detail=False, methods=['get'])
    def recipients(self, request):
        # group filter অনুযায়ী কোন client-রা পাবে — preview (count + list)।
        qs = self._recipient_qs(request.query_params).order_by('expiry_date')
        total = qs.count()
        rows = [{
            'id': c.id, 'full_name': c.full_name, 'customer_id': c.customer_id,
            'phone': c.phone, 'expiry_date': c.expiry_date,
            'has_app': bool(getattr(c, 'fcm_token', '')),
        } for c in qs[:300]]
        return Response({'count': total, 'results': rows})

    @action(detail=False, methods=['post'])
    def broadcast(self, request):
        # ভয়েস বার্তা পাঠানো — individual (client_ids) বা group (expiry filter)।
        from clients.models import Client
        audio = request.FILES.get('audio')
        if not audio:
            return Response({'detail': 'audio ফাইল আবশ্যক।'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            duration = int(request.data.get('duration') or 0)
        except (TypeError, ValueError):
            duration = 0

        ids_raw = request.data.get('client_ids', '')
        id_list = [int(x) for x in str(ids_raw).split(',') if str(x).strip().isdigit()]
        if id_list:
            clients = list(Client.objects.filter(pk__in=id_list))
        else:
            clients = list(self._recipient_qs(request.data))
        if not clients:
            return Response({'detail': 'কোনো প্রাপক পাওয়া যায়নি।'}, status=status.HTTP_400_BAD_REQUEST)

        sent, pushed, shared_name = 0, 0, None
        for c in clients:
            # অডিও একবার store করে বাকি সবার জন্য একই path reuse (storage সাশ্রয়)।
            vm = VoiceMessage(client=c, sent_by=request.user, duration=duration)
            if shared_name is None:
                vm.audio = audio
                vm.save()
                shared_name = vm.audio.name
            else:
                vm.audio.name = shared_name
                vm.save()
            sent += 1
            if _push_voice_notification(c, vm):
                pushed += 1
        return Response({'sent': sent, 'pushed': pushed})

    @action(detail=False, methods=['post'])
    def voice_call_broadcast(self, request):
        # নির্বাচিত client-দের অ্যাপে **স্বয়ংক্রিয় ভয়েস কল** — রিসিভ করলে রেকর্ডিং বাজে।
        import os
        import threading
        import uuid as _uuid

        from clients.models import Client
        from voip.services.voice_broadcast import convert_to_wav, broadcast_voice_call

        ids = [int(x) for x in str(request.data.get('client_ids', '')).split(',') if str(x).strip().isdigit()]
        if not ids:
            return Response({'detail': 'ক্লায়েন্ট নির্বাচন করুন।'}, status=status.HTTP_400_BAD_REQUEST)

        # উৎস দুই রকম: (১) লাইব্রেরির সংরক্ষিত recording_id, (২) তাৎক্ষণিক audio ফাইল।
        src_path, tmp_path, err = _resolve_broadcast_audio_source(request)
        if err is not None:
            return err

        try:
            announce = convert_to_wav(src_path, f'ann_{_uuid.uuid4().hex}')
        except Exception as exc:
            logger.warning('Voice convert ব্যর্থ: %s', exc)
            return Response({'detail': f'অডিও রূপান্তর ব্যর্থ: {exc}'},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        finally:
            if tmp_path:
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass

        clients = [
            (f'client_{c.pk}', getattr(c, 'fcm_token', '') or '')
            for c in Client.objects.filter(pk__in=ids)
        ]
        # background thread — অনেক client হলে request block না করে।
        threading.Thread(
            target=broadcast_voice_call, args=(announce, clients), daemon=True,
        ).start()
        return Response({'queued': len(clients)})


class VoiceRecordingViewSet(viewsets.ModelViewSet):
    # রেকর্ডিং লাইব্রেরি — একবার আপলোড/রেকর্ড করে সংরক্ষণ; broadcast/schedule-এ reuse।
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = VoiceRecordingSerializer
    queryset = VoiceRecording.objects.select_related('created_by').all()
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class VoiceCallScheduleViewSet(viewsets.ModelViewSet):
    # এক্সপায়ারি-ভিত্তিক স্বয়ংক্রিয় ভয়েস কল রুল — CRUD + run_now।
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = VoiceCallScheduleSerializer
    queryset = VoiceCallSchedule.objects.select_related('recording').all()

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=['post'])
    def run_now(self, request, pk=None):
        # ম্যানুয়ালি এখনই এই schedule চালাও (last_run guard বাদ দিয়ে)।
        import uuid as _uuid
        import threading
        from django.utils import timezone
        from clients.models import Client
        from voip.services.voice_broadcast import convert_to_wav, broadcast_voice_call

        sched = self.get_object()
        target = sched.target_expiry_date(timezone.localdate())
        qs = Client.objects.filter(expiry_date=target)
        if sched.status_filter:
            qs = qs.filter(status=sched.status_filter)
        clients = [(f'client_{c.pk}', getattr(c, 'fcm_token', '') or '') for c in qs]
        if not clients:
            return Response({'detail': f'{target} expiry-তে কোনো client নেই।', 'count': 0})
        audio_path = sched.audio_path()
        if not audio_path:
            return Response({'detail': 'এই শিডিউলে কোনো রেকর্ডিং নেই।'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            announce = convert_to_wav(audio_path, f'sched_{sched.id}_{_uuid.uuid4().hex[:8]}')
        except Exception as exc:
            return Response({'detail': f'অডিও রূপান্তর ব্যর্থ: {exc}'},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        threading.Thread(target=broadcast_voice_call, args=(announce, clients), daemon=True).start()
        return Response({'queued': len(clients), 'target_expiry': str(target)})


# ═══════════════════════════════════════════════════════════════════════════════
# IP-PBX / Hotline Control ViewSets
# ═══════════════════════════════════════════════════════════════════════════════

class PBXAgentViewSet(viewsets.ModelViewSet):
    # PBX এজেন্ট CRUD — স্টাফ/user → SIP extension ম্যাপিং।
    permission_classes = [permissions.IsAuthenticated]
    serializer_class   = PBXAgentSerializer
    queryset           = PBXAgent.objects.select_related('user').all()

    def get_queryset(self):
        qs = super().get_queryset()
        p  = self.request.query_params
        if p.get('is_active') is not None:
            qs = qs.filter(is_active=p['is_active'] in ('true', '1', 'True'))
        if p.get('role_label'):
            qs = qs.filter(role_label=p['role_label'])
        return qs

    @staticmethod
    def _sync_dialplan():
        # agent extension যোগ/বদল/মুছলে Asterisk dialplan পুনরায় লিখে reload করি,
        # যাতে staff-to-staff extension কল (যেমন 103) সাথে সাথে কাজ করে।
        try:
            from voip.services.pbx_provision import apply_full_dialplan
            apply_full_dialplan()
        except Exception:  # provisioning ব্যর্থ হলেও CRUD যেন না ভাঙে
            pass

    def perform_create(self, serializer):
        serializer.save()
        self._sync_dialplan()

    # update-এ create-এর সাথে অভিন্ন save+sync (S4144) — alias
    perform_update = perform_create

    def perform_destroy(self, instance):
        instance.delete()
        self._sync_dialplan()


class RingGroupViewSet(viewsets.ModelViewSet):
    # রিং গ্রুপ CRUD + সদস্য যোগ/বাদ।
    permission_classes = [permissions.IsAuthenticated]
    serializer_class   = RingGroupSerializer
    queryset           = RingGroup.objects.prefetch_related('members__agent').all()

    @action(detail=True, methods=['post'])
    def add_member(self, request, pk=None):
        # POST /api/v1/voip/ring-groups/{id}/add_member/ — এজেন্ট যোগ করো।
        rg      = self.get_object()
        agent_id = request.data.get('agent')
        order    = int(request.data.get('order', 1))
        if not agent_id:
            return Response({'detail': 'agent আবশ্যক।'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            agent = PBXAgent.objects.get(pk=agent_id)
        except PBXAgent.DoesNotExist:
            return Response({'detail': 'Agent পাওয়া যায়নি।'}, status=status.HTTP_404_NOT_FOUND)
        member, created = RingGroupMember.objects.get_or_create(
            ring_group=rg, agent=agent, defaults={'order': order},
        )
        if not created:
            member.order   = order
            member.enabled = True
            member.save(update_fields=['order', 'enabled'])
        return Response(RingGroupMemberSerializer(member).data)

    @action(detail=True, methods=['post'])
    def remove_member(self, request, pk=None):
        # POST /api/v1/voip/ring-groups/{id}/remove_member/ — এজেন্ট বাদ দাও।
        rg       = self.get_object()
        agent_id = request.data.get('agent')
        deleted, _ = RingGroupMember.objects.filter(ring_group=rg, agent_id=agent_id).delete()
        return Response({'deleted': deleted})


class IVRMenuViewSet(viewsets.ModelViewSet):
    # IVR মেনু CRUD + greeting অডিও আপলোড।
    permission_classes = [permissions.IsAuthenticated]
    serializer_class   = IVRMenuSerializer
    queryset           = IVRMenu.objects.prefetch_related('options__ring_group', 'options__agent').all()

    @action(detail=True, methods=['post'])
    def upload_greeting(self, request, pk=None):
        # POST /api/v1/voip/ivr-menus/{id}/upload_greeting/ — greeting অডিও আপলোড ও convert।
        import os, uuid as _uuid
        from voip.services.voice_broadcast import convert_to_wav

        ivr   = self.get_object()
        audio = request.FILES.get('audio')
        if not audio:
            return Response({'detail': 'audio ফাইল আবশ্যক।'}, status=status.HTTP_400_BAD_REQUEST)
        ivr.greeting_upload = audio
        ivr.save(update_fields=['greeting_upload', 'updated_at'])
        try:
            wav_name = convert_to_wav(ivr.greeting_upload.path, f'ivr_{ivr.pk}_{_uuid.uuid4().hex[:8]}')
            ivr.greeting_file = wav_name
            ivr.save(update_fields=['greeting_file', 'updated_at'])
        except Exception as exc:
            logger.warning('IVR greeting convert ব্যর্থ: %s', exc)
            return Response({'detail': f'অডিও রূপান্তর ব্যর্থ: {exc}'},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        # এই IVR ব্যবহারকারী সব hotline-এর dialplan regenerate করো।
        from voip.services.pbx_provision import generate_hotline_dialplan
        from voip.models import HotlineNumber
        for hn in HotlineNumber.objects.filter(default_ivr=ivr, is_active=True):
            try:
                generate_hotline_dialplan(hn)
            except Exception as exc:
                logger.warning('IVR greeting dialplan reload ব্যর্থ (%s): %s', hn.number, exc)

        return Response({'greeting_file': ivr.greeting_file})

    @action(detail=True, methods=['post'])
    def set_options(self, request, pk=None):
        # POST /api/v1/voip/ivr-menus/{id}/set_options/ — পুরো option list একসাথে সেট করো।
        ivr     = self.get_object()
        options = request.data.get('options', [])
        if not isinstance(options, list):
            return Response({'detail': 'options অবশ্যই list হতে হবে।'}, status=status.HTTP_400_BAD_REQUEST)
        ivr.options.all().delete()
        created = []
        for opt in options:
            obj = IVROption.objects.create(
                ivr=ivr,
                digit=str(opt.get('digit', '')),
                label=str(opt.get('label', '')),
                route_type=str(opt.get('route_type', 'hangup')),
                ring_group_id=opt.get('ring_group') or None,
                agent_id=opt.get('agent') or None,
                forward_number=str(opt.get('forward_number', '')),
                order=int(opt.get('order', 1)),
            )
            created.append(obj)
        return Response(IVROptionSerializer(created, many=True).data)


class HotlineNumberViewSet(viewsets.ModelViewSet):
    # হটলাইন নম্বর CRUD + activate/deactivate + apply to Asterisk।
    permission_classes = [permissions.IsAuthenticated]
    serializer_class   = HotlineNumberSerializer
    queryset           = HotlineNumber.objects.select_related(
        'default_ring_group', 'default_ivr', 'default_agent',
    ).prefetch_related('business_hours').all()

    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        hn = self.get_object()
        hn.is_active = True
        hn.save(update_fields=['is_active', 'updated_at'])
        return Response({'status': 'active'})

    @action(detail=True, methods=['post'])
    def deactivate(self, request, pk=None):
        hn = self.get_object()
        hn.is_active = False
        hn.save(update_fields=['is_active', 'updated_at'])
        return Response({'status': 'inactive'})

    @action(detail=True, methods=['post'])
    def apply_asterisk(self, request, pk=None):
        # Asterisk dialplan config জেনারেট করে reload করো।
        hn = self.get_object()
        try:
            from voip.services.pbx_provision import generate_hotline_dialplan
            result = generate_hotline_dialplan(hn)
            return Response(result)
        except Exception as exc:
            logger.warning('PBX provision ব্যর্থ (%s): %s', hn.number, exc)
            return Response({'detail': str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['post'])
    def set_business_hours(self, request, pk=None):
        # POST /api/v1/voip/hotline-numbers/{id}/set_business_hours/ — ব্যবসায়িক সময় সেট।
        hn    = self.get_object()
        hours = request.data.get('hours', [])
        if not isinstance(hours, list):
            return Response({'detail': 'hours অবশ্যই list হতে হবে।'}, status=status.HTTP_400_BAD_REQUEST)
        hn.business_hours.all().delete()
        created = []
        for h in hours:
            obj = PBXBusinessHour.objects.create(
                hotline=hn,
                weekday=int(h.get('weekday', 0)),
                start_time=h.get('start_time', '09:00'),
                end_time=h.get('end_time', '17:00'),
                is_open=bool(h.get('is_open', True)),
            )
            created.append(obj)
        return Response(PBXBusinessHourSerializer(created, many=True).data)


class PBXDashboardView(APIView):
    # GET /api/v1/voip/pbx/dashboard-stats/ — PBX ড্যাশবোর্ড পরিসংখ্যান।
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from django.utils import timezone
        from django.db.models import Avg, Count, Q

        today = timezone.localdate()
        today_logs = CallLog.objects.filter(
            started_at__date=today,
            direction='inbound',
        )
        total      = today_logs.count()
        missed     = today_logs.filter(status__in=['no_answer', 'failed']).count()
        answered   = today_logs.filter(status='answered').count()
        avg_dur    = today_logs.filter(status='answered').aggregate(
            avg=Avg('duration')
        )['avg'] or 0

        return Response({
            'total_hotlines':    HotlineNumber.objects.count(),
            'active_hotlines':   HotlineNumber.objects.filter(is_active=True).count(),
            'total_agents':      PBXAgent.objects.count(),
            'active_agents':     PBXAgent.objects.filter(is_active=True).count(),
            'today_inbound_calls': total,
            'missed_calls':      missed,
            'answered_calls':    answered,
            'average_duration':  round(avg_dur),
            'answered_rate':     round(answered / total * 100, 1) if total else 0,
        })


class PBXReloadDialplanView(APIView):
    # POST /api/v1/voip/pbx/reload-dialplan/ — AMI দিয়ে Asterisk dialplan reload।
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        try:
            # শুধু reload নয় — আগে hotline.conf পুনরায় লিখি (hotline + agent extension)
            # যাতে button চাপলে সব পরিবর্তন একসাথে apply হয়।
            from voip.services.pbx_provision import apply_full_dialplan
            result = apply_full_dialplan()
            return Response({'status': 'reloaded', **(result or {})})
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ReprovisionAllEndpointsView(APIView):
    # POST /api/v1/voip/reprovision/ — সব active SipEndpoint conf file পুনরায় লেখে ও pjsip reload করে।
    # conf file option name ভুল হলে (Asterisk version change) এটা দিয়ে fix করা যায়।
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if not request.user.is_staff:
            from rest_framework import status as drf_status
            return Response({'detail': 'Staff only.'}, status=drf_status.HTTP_403_FORBIDDEN)
        from voip.services.asterisk_provision import _write_endpoint_file, _reload_pjsip
        results = []
        for ep in SipEndpoint.objects.filter(is_active=True):
            try:
                _write_endpoint_file(ep)
                results.append({'endpoint': ep.endpoint_name, 'status': 'ok'})
            except Exception as exc:
                results.append({'endpoint': ep.endpoint_name, 'status': f'error: {exc}'})
        try:
            _reload_pjsip()
        except Exception as exc:
            return Response({'detail': f'pjsip reload failed: {exc}', 'endpoints': results}, status=500)
        return Response({'status': 'done', 'endpoints': results})
