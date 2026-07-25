# এই ফাইলটি Support module-এর সব DRF ViewSet ধারণ করে।
#
# Key responsibilities:
#   1. Role-based filtering — admin/superadmin সব ticket দেখবে, অন্যান্য
#      role (support/manager) শুধু তার নিজের assigned / created ticket দেখবে।
#   2. Action endpoint — assign / change_status / add_reply — অ্যাডমিন
#      panel থেকে এক-ক্লিকে operation এর জন্য।
#   3. StaffNotificationViewSet — bell badge feed; unread count, mark_read,
#      mark_all_read।
#
# কেন এভাবে: business logic signals.py-এ centralized — view শুধু permission
# এবং queryset filter সামলায়, যাতে future-এ মোবাইল API / client portal API
# একই business rule reuse করতে পারে।

import uuid
from collections import OrderedDict
from datetime import datetime, timedelta

from django.utils import timezone
from django.db.models import Q, Count
from rest_framework import viewsets, permissions, status, mixins
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter

from support.models import (
    SupportCategory,
    SupportTicket,
    TicketReply,
    StaffNotification,
)
from support.api.serializers import (
    SupportCategorySerializer,
    SupportTicketSerializer,
    SupportTicketListSerializer,
    TicketReplySerializer,
    StaffNotificationSerializer,
)


# ════════════════════════════════════════════════════════════════════
# Helper: কোন role-গুলো "admin-level visibility" পাবে।
# ════════════════════════════════════════════════════════════════════
ADMIN_ROLES = ('admin', 'superadmin')



# পুনরাবৃত্ত literal — S1192 এড়াতে module constant
_ERR_ADMIN_PERM = 'Admin permission required.'

def _is_admin_level(user):
    # is_superuser / staff সবসময় admin বিবেচিত।
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser or user.is_staff:
        return True
    return getattr(user, 'role', '') in ADMIN_ROLES


def _norm_mac(mac):
    """MAC address normalize — case + separator strip। FreeRADIUS-এর callingstationid
    ও Mikrotik /ppp/active-এর caller-id দু-জায়গায় বিভিন্ন format থাকতে পারে
    (AA:BB:CC, aa-bb-cc, AABBCC)। তাই comparison-এর আগে সব lowercase + separator-
    মুক্ত করে নিই।"""
    return (mac or '').lower().replace(':', '').replace('-', '').replace('.', '').strip()


def _client_match_keys(client):
    """একটি client-কে RADIUS/Mikrotik active session-এ চিনতে যত possible key লাগে
    সব collect — কেন: ISP-ভেদে PPPoE username বিভিন্ন format-এ থাকে (কখনো
    customer_id, কখনো R3545XXX, কখনো নাম)। যেকোনো একটি match হলেই online।"""
    if not client:
        return {'usernames': set(), 'macs': set(), 'ips': set()}
    usernames = set()
    macs = set()
    ips = set()
    for attr in ('username', 'customer_id'):
        v = getattr(client, attr, None)
        if v:
            usernames.add(str(v).lower().strip())
    mac = getattr(client, 'mac_address', None)
    if mac:
        m = _norm_mac(mac)
        if m:
            macs.add(m)
    ip = getattr(client, 'ip_address', None)
    if ip:
        ips.add(str(ip).strip())
    return {'usernames': usernames, 'macs': macs, 'ips': ips}


def _online_hit(verbose, matched_by, matched_value, source):
    """online match পাওয়া গেলে return value — verbose হলে dict, নাহলে True।"""
    if verbose:
        return {'is_online': True, 'matched_by': matched_by,
                'matched_value': matched_value, 'source': source}
    return True


def _online_miss(verbose):
    """কোনো match না পেলে return value — verbose হলে dict, নাহলে False।"""
    if verbose:
        return {'is_online': False, 'matched_by': '', 'matched_value': '', 'source': ''}
    return False


def _session_match(uname_raw, caller_raw, ip_raw, keys):
    """একটি session-এর username/caller-id(MAC)/ip keys-এর সাথে মিলিয়ে
    (matched_by, matched_value) বা None। priority: username > mac > ip।"""
    uname = str(uname_raw or '').lower().strip()
    if uname and uname in keys['usernames']:
        return 'username', uname
    cmac = _norm_mac(caller_raw or '')
    if cmac and cmac in keys['macs']:
        return 'mac', caller_raw
    ip = str(ip_raw or '').strip()
    if ip and ip in keys['ips']:
        return 'ip', ip
    return None


def _radius_online_match(keys):
    """RADIUS active sessions-এ প্রথম match → (matched_by, matched_value) বা None।"""
    try:
        from radius_app.services.radius_service import RadiusService
        radius_users = RadiusService.all_online_users() or []
    except Exception:
        radius_users = []
    for u in radius_users:
        hit = _session_match(u.get('username', ''), u.get('caller_id', ''), u.get('ip', ''), keys)
        if hit:
            return hit
    return None


def _mikrotik_online_match(keys):
    """Mikrotik /ppp/active-এ প্রথম match → (matched_by, matched_value) বা None।
    কেন fallback: কিছু client direct PPPoE secret-এ চলে (RADIUS dispatch নয়)।"""
    try:
        from mikrotik_app.services.mikrotik_service import MikrotikService
        from mikrotik_app.models import MikrotikServer
        servers = list(MikrotikServer.objects.filter(is_active=True))
        for srv in servers:
            try:
                connections = MikrotikService.from_server_model(srv).get_active_connections() or []
            except Exception:
                continue
            for c in connections:
                hit = _session_match(
                    c.get('name') or c.get('user'), c.get('caller-id', ''), c.get('address', ''), keys)
                if hit:
                    return hit
    except Exception:
        pass
    return None


def _client_online_status(client, verbose=False):
    """Client live online কিনা — RADIUS active session + Mikrotik /ppp/active
    উভয় source-এ multi-key (username / customer_id / MAC / IP) match করে decide।

    কেন বহু-key matching:
      • অনেক ISP-তে PPPoE username = R3545XXX format কিন্তু DB-তে customer_id
        আলাদা — শুধু username match করলে false-negative হবে।
      • Caller-ID (MAC) সরাসরি hardware identifier — username mismatch হলেও
        কাজ করে।
      • Framed IP allocated থাকলে IP-ও reliable signal।

    Returns:
      verbose=False → bool
      verbose=True  → dict { is_online, matched_by, matched_value, source }
    """
    keys = _client_match_keys(client)
    if not (keys['usernames'] or keys['macs'] or keys['ips']):
        return _online_miss(verbose)

    # ── 1. RADIUS active session check ─────────────────────────────
    hit = _radius_online_match(keys)
    if hit:
        return _online_hit(verbose, hit[0], hit[1], 'radius')

    # ── 2. Fallback — Mikrotik /ppp/active (যদি RADIUS-এ পাওয়া না যায়) ─
    hit = _mikrotik_online_match(keys)
    if hit:
        return _online_hit(verbose, hit[0], hit[1], 'mikrotik')

    return _online_miss(verbose)


# ════════════════════════════════════════════════════════════════════
# TicketType (SupportCategory) — admin CRUD
# ════════════════════════════════════════════════════════════════════
class SupportCategoryViewSet(viewsets.ModelViewSet):
    # Lookup table — সব authenticated user read করতে পারবে (dropdown-এর জন্য),
    # কিন্তু create/update/delete শুধু admin-level।
    queryset = SupportCategory.objects.all().order_by('name')
    serializer_class = SupportCategorySerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['is_active']
    search_fields = ['name', 'description']
    ordering_fields = ['name', 'created_at']

    def get_permissions(self):
        # নন-admin user-রা শুধু list/retrieve করতে পারবে।
        if self.action in ('list', 'retrieve'):
            return [permissions.IsAuthenticated()]
        return [permissions.IsAuthenticated()]   # actual role check in code

    def perform_create(self, serializer):
        if not _is_admin_level(self.request.user):
            raise permissions.exceptions.PermissionDenied(_ERR_ADMIN_PERM)
        serializer.save()

    # update-এ create-এর সাথে অভিন্ন admin-check (S4144) — alias
    perform_update = perform_create

    def perform_destroy(self, instance):
        if not _is_admin_level(self.request.user):
            raise permissions.exceptions.PermissionDenied(_ERR_ADMIN_PERM)
        instance.delete()


# ════════════════════════════════════════════════════════════════════
# Support Ticket — main viewset (role-based filter + actions)
# ════════════════════════════════════════════════════════════════════
class SupportTicketViewSet(viewsets.ModelViewSet):
    # base queryset — actual filtering get_queryset()-এ।
    queryset = SupportTicket.objects.select_related(
        'client', 'category', 'assigned_to', 'created_by',
    ).prefetch_related('replies', 'activity_logs').all()
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['status', 'priority', 'client', 'assigned_to', 'category', 'source']
    search_fields = ['ticket_id', 'subject', 'description',
                     'client__full_name', 'client__phone', 'client__customer_id']
    ordering_fields = ['created_at', 'updated_at', 'priority', 'status']

    def get_serializer_class(self):
        # list action-এ light-weight serializer — fast রেন্ডার এর জন্য।
        if self.action == 'list':
            return SupportTicketListSerializer
        return SupportTicketSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user

        # Admin-level user → পুরো queryset।
        if _is_admin_level(user):
            return qs

        # অন্যান্য staff (support/manager/accountant/collector) → শুধু নিজস্ব ticket।
        # নিজে create করেছেন বা নিজের কাছে assigned।
        return qs.filter(Q(assigned_to=user) | Q(created_by=user)).distinct()

    def perform_create(self, serializer):
        # Auto-generate ticket_no (TKT-YYYYMMDD-XXXXX) — uniqueness retry সহ।
        for _ in range(5):
            tid = self._generate_ticket_no()
            if not SupportTicket.objects.filter(ticket_id=tid).exists():
                break
        ticket = serializer.save(created_by=self.request.user, ticket_id=tid)
        # AI auto-categorize (background — response ধীর করে না)
        try:
            from support.tasks import ai_categorize_ticket
            ai_categorize_ticket.delay(ticket.id)
        except Exception:
            pass

    def _generate_ticket_no(self):
        # মানব-পাঠ্য + sortable format: TKT-20260530-A1B2C3।
        today_part = timezone.now().strftime('%Y%m%d')
        rand_part  = uuid.uuid4().hex[:6].upper()
        return f'TKT-{today_part}-{rand_part}'

    def perform_update(self, serializer):
        # signal handler-এ actor track করার জন্য — instance-এ inject।
        instance = serializer.instance
        # ── Guard: PATCH/PUT দিয়ে status='closed' হলেও online check প্রয়োগ ─
        new_status = serializer.validated_data.get('status')
        if new_status == 'closed' and instance.status != 'closed':
            if not _client_online_status(instance.client):
                from rest_framework.exceptions import ValidationError
                raise ValidationError({
                    'status': 'Cannot close ticket — client is currently offline. '
                              'Wait until the client is online.',
                })
        instance._actor_user = self.request.user
        serializer.save()

    # ── Action: assign / re-assign ────────────────────────────────
    @action(detail=True, methods=['post'], url_path='assign')
    def assign(self, request, pk=None):
        # Admin বা current assignee-ই re-assign করতে পারবে।
        ticket = self.get_object()
        if not _is_admin_level(request.user) and ticket.assigned_to_id != request.user.id:
            return Response({'detail': 'You cannot re-assign this ticket.'},
                            status=status.HTTP_403_FORBIDDEN)
        new_user_id = request.data.get('assigned_to') or request.data.get('assigned_employee')
        try:
            new_user_id = int(new_user_id) if new_user_id else None
        except (TypeError, ValueError):
            return Response({'detail': 'Invalid assigned_to id.'}, status=400)
        ticket._actor_user = request.user
        ticket.assigned_to_id = new_user_id
        ticket.save(update_fields=['assigned_to', 'updated_at'])
        return Response(SupportTicketSerializer(ticket, context={'request': request}).data)

    # ── Action: change status ─────────────────────────────────────
    @action(detail=True, methods=['post'], url_path='change-status')
    def change_status(self, request, pk=None):
        ticket = self.get_object()
        new_status = request.data.get('status')
        valid = [c for c, _ in SupportTicket.STATUS_CHOICES]
        if new_status not in valid:
            return Response({'detail': f'Invalid status. Allowed: {valid}'}, status=400)

        # ── Business rule: ticket close করতে হলে client কে অনলাইন থাকতে হবে।
        # কেন: সমস্যা সমাধান হয়েছে কিনা সেটার live verification।
        # 'resolved' status block করা হয় না — সেটা intermediate stage।
        # multi-key match (username/customer_id/MAC/IP) + Mikrotik fallback।
        if new_status == 'closed':
            info = _client_online_status(ticket.client, verbose=True)
            if not info['is_online']:
                username = getattr(ticket.client, 'username', '') or '—'
                client_name = getattr(ticket.client, 'full_name', '') or username
                return Response({
                    'detail': (f'Cannot close ticket. Client "{client_name}" '
                               f'({username}) is currently offline — please wait '
                               f'until the client is back online before closing.'),
                    'client_online': False,
                    'client_name':   client_name,
                    'username':      username,
                }, status=400)

        ticket._actor_user = request.user
        ticket.status = new_status
        ticket.save(update_fields=['status', 'updated_at'])
        # resolved_at / closed_at signal-এ set হয়, তবে কিছু DB driver delay
        # হতে পারে — refresh করে fresh data দিচ্ছি।
        ticket.refresh_from_db()
        return Response(SupportTicketSerializer(ticket, context={'request': request}).data)

    # ── Action: client online status check (pre-close UI hint) ───
    # Frontend ticket close-এর আগে এই endpoint hit করে user-কে দেখাবে
    # client এই মুহূর্তে online কিনা; offline হলে confirm dialog block।
    # matched_by/source ফেরত দিই — UI-তে কোন signal-এ match হলো দেখানোর জন্য।
    @action(detail=True, methods=['get'], url_path='client-online-status')
    def client_online_status(self, request, pk=None):
        ticket = self.get_object()
        info = _client_online_status(ticket.client, verbose=True)
        c = ticket.client
        return Response({
            'is_online':     info['is_online'],
            'can_close':     info['is_online'],
            'matched_by':    info['matched_by'],     # username / mac / ip
            'matched_value': info['matched_value'],
            'source':        info['source'],          # radius / mikrotik
            'username':      getattr(c, 'username', '') or '',
            'customer_id':   getattr(c, 'customer_id', '') or '',
            'client_name':   getattr(c, 'full_name', '') or '',
            'mac_address':   getattr(c, 'mac_address', '') or '',
            'ip_address':    getattr(c, 'ip_address', '') or '',
        })

    # ── Action: add reply ─────────────────────────────────────────
    @action(detail=True, methods=['post'], url_path='reply')
    def add_reply(self, request, pk=None):
        ticket = self.get_object()
        msg = (request.data.get('message') or '').strip()
        if not msg:
            return Response({'detail': 'Reply message is required.'}, status=400)
        reply = TicketReply.objects.create(
            ticket=ticket,
            message=msg,
            is_client_reply=False,
            replied_by=request.user,
        )
        return Response(TicketReplySerializer(reply).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='suggest-reply')
    def suggest_reply(self, request, pk=None):
        """AI খসড়া উত্তর — staff edit করে reply হিসেবে পাঠাবে।

        🔒 শুধু non-sensitive তথ্য (status/বকেয়া/online + ticket text) local
        Ollama-তে যায়; NID/password/ঠিকানা/পেমেন্ট details নয়।
        """
        import threading, logging
        from django.conf import settings as _settings
        from django.core.cache import cache
        from django.db import close_old_connections
        _lg = logging.getLogger(__name__)

        ticket = self.get_object()

        # ── Default: পরিষ্কার curated template — synchronous, তাৎক্ষণিক (~1s) ──
        # local মডেলের ভাঙা বাংলা এড়াতে LLM শুধু AI_DRAFT_USE_LLM=True হলে চলে।
        if not getattr(_settings, 'AI_DRAFT_USE_LLM', False):
            from support.ai_service import suggest_ticket_reply
            try:
                draft = suggest_ticket_reply(ticket)
                return Response({'draft': draft, 'ready': True})
            except Exception as e:
                return Response({'detail': f'AI খসড়া তৈরি ব্যর্থ: {e}'},
                                status=status.HTTP_503_SERVICE_UNAVAILABLE)

        # ── AI_DRAFT_USE_LLM=True: LLM ধীর হতে পারে (CPU Ollama), তাই request block
        # না করে background thread-এ generate করি ও cache-এ রাখি; frontend poll করে।
        #   POST {regenerate:true} → পুরনো cache মুছে নতুন (ভিন্ন) generation শুরু
        #   POST (regenerate ছাড়া)  → poll: রেডি হলে draft, নাহলে generating:true
        key  = f'ai_draft_{ticket.id}'
        lock = f'ai_draft_lock_{ticket.id}'

        if request.data.get('regenerate'):
            cache.delete(key)

        cached = cache.get(key)
        if cached:
            return Response({'draft': cached, 'ready': True})

        if cache.get(lock):
            return Response({'generating': True})

        cache.set(lock, True, 900)   # duplicate thread রোধ (১৫ মিনিট)
        tid = ticket.id

        def _bg():
            close_old_connections()
            try:
                from support.ai_service import suggest_ticket_reply
                t = (SupportTicket.objects
                     .select_related('client', 'client__package', 'category')
                     .get(pk=tid))
                draft = suggest_ticket_reply(t)
                if draft:
                    cache.set(key, draft, 600)   # ১০ মিনিট রাখা
            except Exception as exc:
                _lg.warning('suggest_reply bg failed: %s', exc)
            finally:
                cache.delete(lock)
                close_old_connections()

        threading.Thread(target=_bg, daemon=True).start()
        return Response({'generating': True})

    # ── Backward-compatible resolve action (পুরনো URL) ────────────
    @action(detail=True, methods=['post'], url_path='resolve')
    def resolve(self, request, pk=None):
        ticket = self.get_object()
        ticket._actor_user = request.user
        ticket.status = 'resolved'
        ticket.resolved_at = timezone.now()
        ticket.save(update_fields=['status', 'resolved_at', 'updated_at'])
        return Response({'message': 'Ticket marked resolved.'})

    # ── Action: dashboard statistics ──────────────────────────────
    # Dashboard widgets-এর জন্য aggregated data — তিনটি card count +
    # zone/sub-zone breakdown + last-12-month trend + top problem solvers।
    # role-based queryset reuse করি যেন employee dashboard-এ নিজের metric দেখায়।
    @action(detail=False, methods=['get'], url_path='stats')
    def stats(self, request):
        qs = self.get_queryset()
        now = timezone.now()

        # চলতি মাসের শুরু — Zone / Sub-Zone widget গুলো monthly view।
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        month_qs = qs.filter(created_at__gte=month_start)

        # ── Top-line counts ──────────────────────────────────────
        pending_count    = qs.filter(status='open').count()
        processing_count = qs.filter(status='in_progress').count()
        resolved_count   = qs.filter(status__in=['resolved', 'closed']).count()

        # ── Zone-wise problem occurrence (current month) ─────────
        zone_rows = list(
            month_qs.values('client__zone__name')
                    .annotate(count=Count('id'))
                    .order_by('-count')
        )
        zone_wise = [
            {'name': r['client__zone__name'] or 'Unknown', 'count': r['count']}
            for r in zone_rows
        ]

        # ── Sub-Zone-wise problem occurrence (current month) ─────
        sub_rows = list(
            month_qs.values('client__subzone__name')
                    .annotate(count=Count('id'))
                    .order_by('-count')
        )
        sub_zone_wise = [
            {'name': r['client__subzone__name'] or 'Unknown', 'count': r['count']}
            for r in sub_rows
        ]

        # ── Monthly trend — last 12 months bucket ────────────────
        # কেন: প্রতিমাসে কতগুলো ticket তৈরি হয়েছে chart-এ দেখানোর জন্য।
        # বিগত ১২ মাস-এর OrderedDict bucket তৈরি করে fill করি।
        monthly = OrderedDict()
        cursor = month_start
        for _ in range(12):
            key = cursor.strftime('%b-%y')
            monthly[key] = 0
            # পরবর্তী previous-month কম্পিউট — day=1 ধরে subtract করি।
            prev = cursor - timedelta(days=1)
            cursor = prev.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        # এখন reverse-order দরকার (chart-এ পুরনো→নতুন left→right)।
        ordered_keys = list(monthly.keys())[::-1]
        # tickets group by month
        year_start = (month_start - timedelta(days=380)).replace(day=1)
        for row in qs.filter(created_at__gte=year_start).values_list('created_at', flat=True):
            mk = row.strftime('%b-%y')
            if mk in monthly:
                monthly[mk] += 1
        monthly_trend = [{'month': k, 'count': monthly[k]} for k in ordered_keys]

        # ── Top problem solvers — resolved+closed count per assignee ─
        solver_rows = list(
            qs.filter(status__in=['resolved', 'closed'], assigned_to__isnull=False)
              .values('assigned_to__username', 'assigned_to__full_name')
              .annotate(count=Count('id'))
              .order_by('-count')[:10]
        )
        top_solvers = [
            {
                'name': (r['assigned_to__full_name'] or r['assigned_to__username'] or 'Unknown'),
                'count': r['count'],
            }
            for r in solver_rows
        ]

        return Response({
            'pending_count':    pending_count,
            'processing_count': processing_count,
            'resolved_count':   resolved_count,
            'zone_wise':        zone_wise,
            'sub_zone_wise':    sub_zone_wise,
            'monthly_trend':    monthly_trend,
            'top_solvers':      top_solvers,
        })


# ════════════════════════════════════════════════════════════════════
# Staff Notification — bell badge feed (read-only + mark actions)
# ════════════════════════════════════════════════════════════════════
class StaffNotificationViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    # Only recipient নিজের notifications দেখবে — কখনই অন্যের না।
    serializer_class = StaffNotificationSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ['notif_type', 'is_read']
    ordering_fields = ['created_at']

    def get_queryset(self):
        return StaffNotification.objects.select_related('related_ticket').filter(
            recipient=self.request.user,
        )

    # ── Action: unread count (bell badge-এর জন্য) ─────────────────
    @action(detail=False, methods=['get'], url_path='unread-count')
    def unread_count(self, request):
        cnt = self.get_queryset().filter(is_read=False).count()
        return Response({'unread_count': cnt})

    # ── Action: একটি mark as read ────────────────────────────────
    @action(detail=True, methods=['post'], url_path='mark-read')
    def mark_read(self, request, pk=None):
        notif = self.get_object()
        if not notif.is_read:
            notif.is_read = True
            notif.read_at = timezone.now()
            notif.save(update_fields=['is_read', 'read_at'])
        return Response(self.get_serializer(notif).data)

    # ── Action: সব mark as read ───────────────────────────────────
    @action(detail=False, methods=['post'], url_path='mark-all-read')
    def mark_all_read(self, request):
        now = timezone.now()
        updated = self.get_queryset().filter(is_read=False).update(
            is_read=True, read_at=now,
        )
        return Response({'updated': updated})
