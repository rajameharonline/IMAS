# Mobile App API views — Client auth (OTP), profile, bills, tickets, banners
import uuid
from datetime import datetime

from django.db.models import Q
from django.utils import timezone
from django.views.decorators.http import require_GET
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.authentication import JWTAuthentication

from billing.models import Bill, Payment
from clients.models import Client
from configuration.models import Zone
from mobile_api.authentication import MobileClientAuthentication
from mobile_api.models import OTPRecord, PushNotificationLog
from mobile_api.services import push_service
from sms_service.models import SMSLog
from sms_service.services import SMSService
from support.models import SupportTicket, SupportCategory
from system_settings.models import AppBanner, MobileAppConfig, PaymentGatewayConfig, CompanySetup

from .serializers import (
    AppBannerSerializer,
    AppBillSerializer,
    AppClientProfileSerializer,
    AppConfigSerializer,
    AppTicketCreateSerializer,
    AppTicketDetailSerializer,
    AppTicketListSerializer,
    AppLoginSerializer,
    RegisterCheckSerializer,
    AppRegisterSerializer,
    FCMTokenSerializer,
    PushNotificationSendSerializer,
)

# পুনরাবৃত্ত error message — S1192 (duplicate literal) এড়াতে module constant
_ERR_STAFF_TOKEN = 'Staff token প্রয়োজন।'
_ERR_CLIENT_NOT_FOUND = 'Client পাওয়া যায়নি।'
_ERR_ADMIN_ACCESS = 'Admin-level access প্রয়োজন।'
_ERR_INVALID_TOKEN = 'অবৈধ token।'


# ─── Mobile Client Authentication ───────────────────────────────────────────

class MobileClientPermission(permissions.BasePermission):
    # JWT token-এ 'client_id' থাকলে client authenticated ধরা হয়
    def has_permission(self, request, view):
        return bool(
            request.user and
            request.user.is_authenticated and
            hasattr(request, 'mobile_client') and
            request.mobile_client is not None
        )


class MobileClientMiddlewareMixin:
    # JWT payload থেকে client_id বের করে request.mobile_client set করে
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        client_id = None
        if hasattr(request, 'auth') and request.auth:
            try:
                client_id = request.auth.get('client_id')
            except Exception:
                pass
        if client_id:
            try:
                request.mobile_client = Client.objects.select_related(
                    'package', 'zone', 'subzone'
                ).get(pk=client_id, app_enabled=True)
            except Client.DoesNotExist:
                request.mobile_client = None
        else:
            request.mobile_client = None


def _create_client_token(client: Client) -> RefreshToken:
    # Client-এর জন্য custom JWT token (staff User ব্যবহার না করে)
    # simplejwt-এর UntypedToken সরাসরি ব্যবহার করা হচ্ছে
    from rest_framework_simplejwt.tokens import RefreshToken as RT
    from accounts.models import User

    # Client-linked User থাকলে সেটা ব্যবহার, না থাকলে একটি dummy bearer
    # আমরা token payload-এ client_id inject করি
    class ClientToken(RT):
        @classmethod
        def for_client(cls, client):
            token = cls()
            token['client_id']   = client.id
            token['customer_id'] = client.customer_id
            token['token_type']  = 'client_access'
            return token

    return ClientToken.for_client(client)


def _create_pop_token(pop) -> RefreshToken:
    # POP reseller-এর জন্য custom JWT (client token-এর মতো, pop_id claim সহ)।
    from rest_framework_simplejwt.tokens import RefreshToken as RT

    class POPToken(RT):
        @classmethod
        def for_pop(cls, pop):
            token = cls()
            token['pop_id'] = pop.id
            token['code']   = pop.code
            return token

    return POPToken.for_pop(pop)


def _pop_check_password(pop, raw) -> bool:
    # POP password hashed বা plain — উভয় সাপোর্ট (পুরনো record plain হতে পারে)।
    from django.contrib.auth.hashers import check_password, identify_hasher
    stored = pop.password or ''
    if not stored:
        return False
    try:
        identify_hasher(stored)
        return check_password(raw, stored)
    except Exception:
        return stored == raw


def _pop_login_payload(pop) -> dict:
    refresh = _create_pop_token(pop)
    return {
        'refresh': str(refresh),
        'access':  str(refresh.access_token),
        'account_type': 'pop',
        'pop': {
            'id':            pop.id,
            'code':          pop.code,
            'business_name': pop.business_name,
            'contact_person': pop.contact_person,
            'email':         pop.email,
            'mobile':        pop.mobile,
            'pop_type':      pop.pop_type,
            'username':      pop.username,
        },
        'menus': pop.menus or [],
    }


def _create_staff_token(user) -> RefreshToken:
    # Staff/Admin User-এর জন্য standard simplejwt token (user_id সহ) + role claim।
    # role claim refresh→access-এ propagate হয় (token_type override করি না, নাহলে
    # standard refresh endpoint validation ভাঙবে)। অ্যাপ role দিয়ে UI branch করে।
    token = RefreshToken.for_user(user)
    token['role'] = user.role
    return token


def staff_permissions(user) -> dict:
    """Staff user-এর permission snapshot — role_permissions/MyPermissionsView-এর সমতুল্য।
    অ্যাপ এই data দিয়ে role অনুযায়ী menu/route guard করবে (backend-ই আসল enforcer)।"""
    if user.role in ('superadmin', 'admin'):
        return {'is_super': True, 'role_name': user.role, 'modules': [], 'granular': []}

    assignment = getattr(user, 'role_assignment', None)
    if not assignment or not assignment.role_group:
        return {'is_super': False, 'role_name': user.role, 'modules': [], 'granular': []}

    role = assignment.role_group
    modules = list(role.module_permissions.filter(is_enabled=True).values(
        'module_key', 'sub_module_key', 'access_level',
    ))
    granular = list(role.granular_permissions.filter(is_enabled=True).values(
        'context_key', 'permission_key',
    ))
    return {
        'is_super':  False,
        'role_name': role.name,
        'modules':   modules,
        'granular':  granular,
    }


def _staff_login_payload(user) -> dict:
    refresh = _create_staff_token(user)
    return {
        'refresh': str(refresh),
        'access':  str(refresh.access_token),
        'account_type': 'staff',
        'user': {
            'id':        user.id,
            'username':  user.username,
            'full_name': user.full_name or user.username,
            'email':     user.email,
            'phone':     user.phone,
            'role':      user.role,
            'avatar':    user.avatar.url if getattr(user, 'avatar', None) else '',
        },
        'permissions': staff_permissions(user),
    }


def _client_login_payload(client) -> dict:
    client.app_last_seen = timezone.now()
    client.save(update_fields=['app_last_seen'])
    refresh = _create_client_token(client)
    return {
        'refresh': str(refresh),
        'access':  str(refresh.access_token),
        'account_type': 'client',
        'client': {
            'id':          client.id,
            'customer_id': client.customer_id,
            'full_name':   client.full_name,
            'phone':       client.phone,
            'status':      client.status,
        },
    }


class AppLoginView(APIView):
    # POST /app/auth/login/ — role-aware: Client (Customer Code) বা Staff (Username)
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = AppLoginSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        data       = serializer.validated_data
        identifier = data['identifier']
        password   = data['password']
        login_type = data.get('login_type') or ''

        # ── Explicit login_type ────────────────────────────────────
        if login_type == 'staff':
            return self._staff_response(identifier, password)
        if login_type == 'pop':
            return self._pop_response(identifier, password)
        if login_type == 'client':
            return self._client_response(identifier, password)

        # ── Auto-detect: client → pop → staff ──────────────────────
        if Client.objects.filter(customer_id=identifier).exists():
            return self._client_response(identifier, password)

        from pop.models import POP
        pop = POP.objects.filter(username=identifier).first()
        if pop:
            return self._pop_response(identifier, password)

        user = self._auth_staff(identifier, password)
        if user is not None:
            if not user.is_active:
                return Response({'detail': 'আপনার account নিষ্ক্রিয়।'}, status=403)
            return Response(_staff_login_payload(user))
        return Response({'detail': 'Customer Code/Username বা Password ভুল।'}, status=400)

    def _auth_staff(self, username, password):
        from django.contrib.auth import authenticate
        return authenticate(username=username, password=password)

    def _staff_response(self, username, password):
        user = self._auth_staff(username, password)
        if user is None:
            return Response({'detail': 'Username বা Password ভুল।'}, status=400)
        if not user.is_active:
            return Response({'detail': 'আপনার account নিষ্ক্রিয়।'}, status=403)
        return Response(_staff_login_payload(user))

    def _pop_response(self, username, password):
        from pop.models import POP
        pop = POP.objects.filter(username=username).first()
        if not pop or not _pop_check_password(pop, password):
            return Response({'detail': 'Username বা Password ভুল।'}, status=400)
        if not pop.is_active:
            return Response({'detail': 'আপনার POP account নিষ্ক্রিয়।'}, status=403)
        if pop.is_locked:
            return Response({'detail': 'আপনার POP account locked। অফিসে যোগাযোগ করুন।'}, status=403)
        return Response(_pop_login_payload(pop))

    def _client_response(self, customer_id, password):
        client = Client.objects.filter(customer_id=customer_id).first()
        if not client or not client.check_app_password(password):
            return Response({'detail': 'Customer Code বা Password ভুল।'}, status=400)
        if not client.app_enabled:
            return Response({'detail': 'আপনার app access বন্ধ আছে। অফিসে যোগাযোগ করুন।'}, status=403)
        return Response(_client_login_payload(client))


class AppStaffProfileView(APIView):
    # GET /app/staff/me/ — staff token দিয়ে নিজের profile + permission
    # (default JWTAuthentication user_id resolve করে; client token এখানে কাজ করবে না)
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        # client token দিয়ে এলে (MobileClientUser) — staff নয়
        if not hasattr(user, 'role'):
            return Response({'detail': _ERR_STAFF_TOKEN}, status=403)
        return Response({
            'account_type': 'staff',
            'user': {
                'id':        user.id,
                'username':  user.username,
                'full_name': user.full_name or user.username,
                'email':     user.email,
                'phone':     user.phone,
                'role':      user.role,
                'avatar':    user.avatar.url if getattr(user, 'avatar', None) else '',
            },
            'permissions': staff_permissions(user),
        })


class AppStaffDashboardView(APIView):
    # GET /app/staff/dashboard/ — staff/admin summary (আয়/কালেকশন/online/client)।
    # admin/superadmin → global; অন্যরা → নিজের collection scope।
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        if not hasattr(user, 'role'):
            return Response({'detail': _ERR_STAFF_TOKEN}, status=403)

        from django.db.models import Sum, Count, Q
        from billing.models import Payment
        from clients.models import Client

        is_admin = user.role in ('superadmin', 'admin', 'manager', 'accountant')
        today = timezone.localdate()

        # ── Collection (today + this month) ──
        pay_qs = Payment.objects.all()
        if not is_admin:
            pay_qs = pay_qs.filter(received_by=user)   # collector → নিজের কালেকশন
        today_agg = pay_qs.filter(payment_date__date=today).aggregate(
            total=Sum('amount'), count=Count('id'))
        month_agg = pay_qs.filter(
            payment_date__year=today.year, payment_date__month=today.month,
        ).aggregate(total=Sum('amount'), count=Count('id'))

        # ── Client counts (admin দেখে সব) ──
        client_counts = {}
        total_due = 0
        if is_admin:
            cagg = Client.objects.aggregate(
                total=Count('id'),
                active=Count('id', filter=Q(status='active')),
                expired=Count('id', filter=Q(status='expired')),
                suspended=Count('id', filter=Q(status='suspended')),
                inactive=Count('id', filter=Q(status='inactive')),
                due=Sum('due_amount'),
            )
            client_counts = {
                'total':     cagg['total'] or 0,
                'active':    cagg['active'] or 0,
                'expired':   cagg['expired'] or 0,
                'suspended': cagg['suspended'] or 0,
                'inactive':  cagg['inactive'] or 0,
            }
            total_due = float(cagg['due'] or 0)

        # ── Online clients (RADIUS — optional, error-safe) ──
        online_count = 0
        try:
            from radius_app.services.radius_service import RadiusService
            online_count = len(RadiusService().get_online_users())
        except Exception:
            online_count = 0

        return Response({
            'scope': 'admin' if is_admin else 'self',
            'role': user.role,
            'today_collection':  float(today_agg['total'] or 0),
            'today_count':       today_agg['count'] or 0,
            'month_collection':  float(month_agg['total'] or 0),
            'month_count':       month_agg['count'] or 0,
            'total_due':         total_due,
            'online_clients':    online_count,
            'clients':           client_counts,
        })


class AppStaffCollectionReportView(APIView):
    # GET /app/staff/reports/daily-collection/?from=YYYY-MM-DD&to=YYYY-MM-DD
    # তারিখ অনুযায়ী গ্রুপড কালেকশন + payment-method breakdown।
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        if not hasattr(user, 'role'):
            return Response({'detail': _ERR_STAFF_TOKEN}, status=403)

        from django.db.models import Sum, Count
        from django.db.models.functions import TruncDate
        from billing.models import Payment

        is_admin = user.role in ('superadmin', 'admin', 'manager', 'accountant')
        today = timezone.localdate()
        d_from = request.query_params.get('from') or str(today.replace(day=1))
        d_to   = request.query_params.get('to') or str(today)

        qs = Payment.objects.filter(payment_date__date__gte=d_from, payment_date__date__lte=d_to)
        if not is_admin:
            qs = qs.filter(received_by=user)

        # দিন অনুযায়ী গ্রুপ
        daily = list(
            qs.annotate(day=TruncDate('payment_date')).values('day')
              .annotate(total=Sum('amount'), count=Count('id')).order_by('-day')
        )
        # payment method breakdown
        methods = list(
            qs.values('payment_method').annotate(total=Sum('amount'), count=Count('id')).order_by('-total')
        )
        grand = qs.aggregate(total=Sum('amount'), count=Count('id'))

        return Response({
            'from': str(d_from), 'to': str(d_to),
            'scope': 'admin' if is_admin else 'self',
            'grand_total': float(grand['total'] or 0),
            'grand_count': grand['count'] or 0,
            'daily':   [{'date': str(d['day']), 'total': float(d['total'] or 0), 'count': d['count']} for d in daily],
            'methods': [{'method': m['payment_method'], 'total': float(m['total'] or 0), 'count': m['count']} for m in methods],
        })


def _staff_can_manage_clients(user) -> bool:
    # Client management access — superadmin/admin সব; অন্যরা role_permissions-এ
    # 'client' module থাকলে। (backend-ই আসল গার্ড)।
    if user.role in ('superadmin', 'admin', 'manager'):
        return True
    assignment = getattr(user, 'role_assignment', None)
    if not assignment or not assignment.role_group:
        return False
    return assignment.role_group.module_permissions.filter(
        module_key='client', is_enabled=True,
    ).exists()


class AppStaffClientListView(APIView):
    # GET /app/staff/clients/?search=&status=&page= — mobile-optimized client list
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        if not hasattr(user, 'role'):
            return Response({'detail': _ERR_STAFF_TOKEN}, status=403)
        if not _staff_can_manage_clients(user):
            return Response({'detail': 'Client management access নেই।'}, status=403)

        from clients.models import Client
        qs = Client.objects.select_related('package', 'zone', 'router').all()
        q = request.query_params
        if q.get('search'):
            s = q['search']
            qs = qs.filter(
                Q(customer_id__icontains=s) | Q(full_name__icontains=s) |
                Q(username__icontains=s) | Q(phone__icontains=s)
            )
        if q.get('status'):
            qs = qs.filter(status=q['status'])

        total = qs.count()
        try:
            page = max(1, int(q.get('page', 1)))
        except (TypeError, ValueError):
            page = 1
        size = 30
        start = (page - 1) * size
        rows = qs.order_by('-id')[start:start + size]

        data = [{
            'id':          c.id,
            'customer_id': c.customer_id,
            'full_name':   c.full_name,
            'username':    c.username,
            'phone':       c.phone,
            'status':      c.status,
            'package':     c.package.name if c.package else '',
            'zone':        c.zone.name if c.zone else '',
            'monthly_bill': float(c.monthly_bill or 0),
            'due_amount':  float(c.due_amount or 0),
            'expiry_date': str(c.expiry_date) if c.expiry_date else '',
        } for c in rows]
        return Response({
            'count': total, 'page': page, 'page_size': size,
            'has_next': start + size < total,
            'results': data,
        })


class AppStaffClientDetailView(APIView):
    # GET /app/staff/clients/<id>/ — profile + bill summary + recent payments
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        user = request.user
        if not hasattr(user, 'role'):
            return Response({'detail': _ERR_STAFF_TOKEN}, status=403)
        if not _staff_can_manage_clients(user):
            return Response({'detail': 'Client management access নেই।'}, status=403)

        from clients.models import Client
        from billing.models import Bill, Payment
        try:
            c = Client.objects.select_related('package', 'zone', 'router').get(pk=pk)
        except Client.DoesNotExist:
            return Response({'detail': _ERR_CLIENT_NOT_FOUND}, status=404)

        recent_payments = [{
            'amount':  float(p.amount or 0),
            'method':  p.payment_method,
            'date':    p.payment_date.strftime('%Y-%m-%d %H:%M') if p.payment_date else '',
            'verified': p.is_verified,
        } for p in Payment.objects.filter(
            Q(bill__client=c) | Q(client=c)
        ).order_by('-payment_date')[:10]]

        unpaid = Bill.objects.filter(client=c).exclude(status='paid').count()

        return Response({
            'id':            c.id,
            'customer_id':   c.customer_id,
            'full_name':     c.full_name,
            'username':      c.username,
            'phone':         c.phone,
            'alt_phone':     c.alt_phone,
            'address':       c.address,
            'status':        c.status,
            'package':       c.package.name if c.package else '',
            'zone':          c.zone.name if c.zone else '',
            'router':        c.router.name if c.router else '',
            'ip_address':    c.ip_address or '',
            'mac_address':   c.mac_address or '',
            'monthly_bill':  float(c.monthly_bill or 0),
            'due_amount':    float(c.due_amount or 0),
            'expiry_date':   str(c.expiry_date) if c.expiry_date else '',
            'unpaid_bills':  unpaid,
            'recent_payments': recent_payments,
            'can_collect':   True,
        })


def _staff_is_admin_level(user) -> bool:
    return user.role in ('superadmin', 'admin', 'manager', 'accountant')


def _unverified_payment_row(p):
    """একটি unverified Payment → mobile staff list row dict।"""
    cl = (p.bill.client if p.bill else None) or p.client
    return {
        'id':       p.id,
        'amount':   float(p.amount or 0),
        'method':   p.payment_method,
        'client_name': cl.full_name if cl else '',
        'customer_id': cl.customer_id if cl else '',
        'received_by': (p.received_by.full_name or p.received_by.username) if p.received_by else '',
        'date':     p.payment_date.strftime('%Y-%m-%d %H:%M') if p.payment_date else '',
    }


class AppStaffPendingPaymentsView(APIView):
    # GET  /app/staff/pending-payments/ — অনুমোদন-অপেক্ষমাণ (is_verified=False) পেমেন্ট
    # POST /app/staff/pending-payments/ {ids:[...]} — নির্বাচিত পেমেন্ট approve
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        if not hasattr(user, 'role') or not _staff_is_admin_level(user):
            return Response({'detail': _ERR_ADMIN_ACCESS}, status=403)
        from billing.models import Payment
        qs = Payment.objects.filter(is_verified=False).select_related(
            'bill__client', 'client', 'received_by', 'created_by',
        ).order_by('-payment_date')[:100]
        data = [_unverified_payment_row(p) for p in qs]
        total = sum(d['amount'] for d in data)
        return Response({'count': len(data), 'total': total, 'results': data})

    def post(self, request):
        user = request.user
        if not hasattr(user, 'role') or not _staff_is_admin_level(user):
            return Response({'detail': _ERR_ADMIN_ACCESS}, status=403)
        ids = request.data.get('ids') or []
        if not ids:
            return Response({'detail': 'ids প্রয়োজন।'}, status=400)
        from billing.models import Payment
        payments = Payment.objects.filter(id__in=ids, is_verified=False).select_related(
            'bill', 'bill__client',
        )
        updated = 0
        for p in payments:
            p.is_verified = True
            p.approved_by = user
            p.save()   # recalculate_bill_and_client + auto-enable trigger হয়
            updated += 1
        return Response({'updated': updated})


class AppStaffBillsView(APIView):
    # GET /app/staff/bills/?search=&status= — mobile-optimized bill list (admin-level)
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        if not hasattr(user, 'role') or not _staff_is_admin_level(user):
            return Response({'detail': _ERR_ADMIN_ACCESS}, status=403)
        from billing.models import Bill
        qs = Bill.objects.select_related('client').order_by('-created_at')
        q = request.query_params
        if q.get('status'):
            qs = qs.filter(status=q['status'])
        if q.get('search'):
            s = q['search']
            qs = qs.filter(
                Q(client__full_name__icontains=s) | Q(client__customer_id__icontains=s) |
                Q(client__username__icontains=s)
            )
        total = qs.count()
        try:
            page = max(1, int(q.get('page', 1)))
        except (TypeError, ValueError):
            page = 1
        size = 30
        start = (page - 1) * size
        rows = qs[start:start + size]
        data = [{
            'id':        b.id,
            'client_name': b.client.full_name if b.client else '',
            'customer_id': b.client.customer_id if b.client else '',
            'bill_month': b.bill_month,
            'net_amount': float(b.net_amount or 0),
            'paid_amount': float(b.paid_amount or 0),
            'due_amount': float(b.due_amount or 0),
            'status':    b.status,
            'due_date':  str(b.due_date) if b.due_date else '',
        } for b in rows]
        return Response({
            'count': total, 'page': page, 'has_next': start + size < total, 'results': data,
        })


class AppStaffHRView(APIView):
    # GET /app/staff/hr/me/ — staff নিজের employee profile + attendance + payslip
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        if not hasattr(user, 'role'):
            return Response({'detail': _ERR_STAFF_TOKEN}, status=403)
        from hr.models import Employee, Attendance, PayrollSheet

        emp = Employee.objects.filter(user=user).select_related('payroll').first()
        if not emp:
            return Response({'employee': None, 'detail': 'আপনার কোনো employee profile যুক্ত নেই।'})

        attendance = [{
            'date':      str(a.date),
            'status':    a.status,
            'check_in':  a.check_in.strftime('%H:%M') if a.check_in else '',
            'check_out': a.check_out.strftime('%H:%M') if a.check_out else '',
        } for a in Attendance.objects.filter(employee=emp).order_by('-date')[:30]]

        payslips = [{
            'month':       p.month,
            'basic_salary': float(p.basic_salary or 0),
            'bonus':       float(p.bonus or 0),
            'deduction':   float(p.deduction or 0),
            'net_salary':  float(p.net_salary or 0),
            'is_paid':     p.is_paid,
            'paid_date':   str(p.paid_date) if p.paid_date else '',
        } for p in PayrollSheet.objects.filter(employee=emp).order_by('-month')[:12]]

        # attendance summary (চলতি মাস)
        today = timezone.localdate()
        month_att = Attendance.objects.filter(
            employee=emp, date__year=today.year, date__month=today.month,
        )
        summary = {
            'present': month_att.filter(status='present').count(),
            'absent':  month_att.filter(status='absent').count(),
            'leave':   month_att.filter(status='leave').count(),
        }

        return Response({
            'employee': {
                'employee_id': emp.employee_id,
                'full_name':   emp.full_name,
                'phone':       emp.phone,
                'email':       emp.email,
                'status':      emp.status,
                'join_date':   str(emp.join_date) if emp.join_date else '',
            },
            'month_summary': summary,
            'attendance': attendance,
            'payslips':   payslips,
        })


class AppPOPProfileView(APIView):
    # GET /app/pop/me/ — POP token দিয়ে নিজের profile + menus
    from mobile_api.authentication import MobilePOPAuthentication as _POPAuth
    authentication_classes = [_POPAuth]
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        pop = getattr(request.user, 'pop', None)
        if pop is None:
            return Response({'detail': 'POP token প্রয়োজন।'}, status=403)
        return Response({
            'account_type': 'pop',
            'pop': {
                'id':             pop.id,
                'code':           pop.code,
                'business_name':  pop.business_name,
                'contact_person': pop.contact_person,
                'email':          pop.email,
                'mobile':         pop.mobile,
                'pop_type':       pop.pop_type,
                'username':       pop.username,
                'is_locked':      pop.is_locked,
            },
            'menus': pop.menus or [],
        })


class AppStaffFCMTokenView(APIView):
    # POST /app/staff/fcm-token/ — staff device FCM token সংরক্ষণ (push-এর জন্য)
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        user = request.user
        if not hasattr(user, 'role'):
            return Response({'detail': _ERR_STAFF_TOKEN}, status=403)
        token = (request.data.get('fcm_token') or '').strip()
        if not token:
            return Response({'detail': 'fcm_token প্রয়োজন।'}, status=400)
        user.fcm_token = token
        user.save(update_fields=['fcm_token'])
        return Response({'detail': 'FCM token আপডেট হয়েছে।'})


def _ensure_pbx_agent(user, ep):
    """user-এর PBXAgent নিশ্চিত করে — না থাকলে তৈরি (extension auto max+1, শুরু 101),
    endpoint বদলালে/inactive হলে update। Returns (agent, dialplan_dirty)।"""
    from voip.models import PBXAgent
    agent = PBXAgent.objects.filter(user=user).first()
    if not agent:
        from django.db.models import Max
        last = PBXAgent.objects.aggregate(m=Max('extension'))['m']
        try:
            next_ext = str(max(100, int(last)) + 1) if last and str(last).isdigit() else '101'
        except (TypeError, ValueError):
            next_ext = '101'
        agent = PBXAgent.objects.create(
            user=user,
            display_name=user.full_name or user.username,
            extension=next_ext,
            sip_endpoint_name=ep.endpoint_name,
            role_label='support' if user.role == 'support' else 'general',
            is_active=True,
        )
        return agent, True
    if agent.sip_endpoint_name != ep.endpoint_name or not agent.is_active:
        agent.sip_endpoint_name = ep.endpoint_name
        agent.is_active = True
        agent.save(update_fields=['sip_endpoint_name', 'is_active'])
        return agent, True
    return agent, False


def _ensure_ring_group_membership(agent):
    """agent কোনো ring group-এ না থাকলে প্রথম active ring group-এ যোগ করে (auto-routing)।
    Returns dialplan_dirty bool।"""
    from voip.models import RingGroup, RingGroupMember
    if RingGroupMember.objects.filter(agent=agent).exists():
        return False
    rg = RingGroup.objects.filter(is_active=True).order_by('id').first()
    if rg:
        RingGroupMember.objects.get_or_create(ring_group=rg, agent=agent)
        return True
    return False


class AppStaffSipCredentialsView(APIView):
    # GET /app/staff/voip/sip-credentials/ — staff agent endpoint (agent_<userid>) creds।
    # default JWTAuthentication staff token (user_id) resolve করে।
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        if not hasattr(user, 'role'):
            return Response({'detail': _ERR_STAFF_TOKEN}, status=403)
        from django.conf import settings
        from voip.services.asterisk_provision import provision_endpoint
        from role_permissions.utils import decrypt_password
        from voip.api.views import _turn_ice_servers
        from voip.models import HotlineNumber

        ep = provision_endpoint(user=user)

        # ── Auto PBXAgent mapping — যাতে client→hotline কল এই staff-কে রিং করে ──
        # dialplan_dirty: agent তৈরি/endpoint বদল/ring-group যোগ হলে dialplan পুনরায়
        # লিখতে হবে (নইলে extension → পুরনো endpoint Dial করে CHANUNAVAIL দেয়)।
        agent, dirty_agent = _ensure_pbx_agent(user, ep)
        dirty_ring = _ensure_ring_group_membership(agent)

        # endpoint/extension/ring-group বদলালে Asterisk dialplan পুনরায় লিখি (gunicorn=isp
        # লিখতে পারে), যাতে staff-to-staff extension কল সঠিক endpoint-এ যায়।
        if dirty_agent or dirty_ring:
            try:
                from voip.services.pbx_provision import apply_full_dialplan
                apply_full_dialplan()
            except Exception:
                pass
        # agent যাকে কল করতে পারে — active hotline + (পরে অন্য agent)
        hotlines = HotlineNumber.objects.filter(is_active=True).order_by('id')
        support_contacts = [{'endpoint': h.number, 'name': h.title} for h in hotlines]
        return Response({
            'sip_user':         ep.endpoint_name,
            'sip_pass':         decrypt_password(ep.secret_encrypted),
            'wss_url':          getattr(settings, 'VOIP_WSS_URL', ''),
            'sip_domain':       getattr(settings, 'VOIP_SIP_DOMAIN', ''),
            'ice_servers':      _turn_ice_servers(),
            'enabled':          getattr(settings, 'VOIP_ENABLED', False),
            'support_contacts': support_contacts,
        })


class AppRegisterCheckView(APIView):
    # POST /app/auth/register/check/ — Self-registration ধাপ ১: Client Code eligibility + OTP পাঠানো
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = RegisterCheckSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)
        customer_id = serializer.validated_data['customer_id']

        client = Client.objects.filter(customer_id=customer_id).first()
        if not client:
            return Response({'detail': 'এই Client Code পাওয়া যায়নি।'}, status=404)
        if client.is_app_user:
            # screenshot: "You're already registered with this Client Code!"
            return Response({'detail': 'You\'re already registered with this Client Code!'}, status=400)
        if not client.phone:
            return Response({'detail': 'এই client-এর কোনো মোবাইল নম্বর নেই। অফিসে যোগাযোগ করুন।'}, status=400)

        # registered phone-এ OTP পাঠানো (verification code)
        otp = OTPRecord.generate(client.phone)
        message = f"ISP App registration OTP: {otp.otp_code}। ১০ মিনিট পর্যন্ত বৈধ।"
        # OTP-ও history-তে থাকবে (expiry আছে — ঝুঁকি নেই)
        sms_sent = SMSService.send_sms(client.phone, message, client=client)

        # phone mask: 01XXX****XXX
        ph = client.phone
        masked = (ph[:3] + '****' + ph[-3:]) if len(ph) >= 7 else ph

        resp = {
            'detail': 'Verified! You are eligible for registration.',
            'customer_id': client.customer_id,
            'full_name':   client.full_name,
            'phone_masked': masked,
            'email':        client.email or '',
            'sms_sent':     bool(sms_sent),
        }
        from django.conf import settings
        # OTP কোথায় দেখাবে:
        #  • SMS সফলভাবে গেলে (sms_sent=True) → OTP শুধু client-এর phone-এ, response-এ নয়।
        #  • SMS না গেলে (gateway নেই/ব্যর্থ) বা DEBUG → OTP response-এ ফেরত যায়,
        #    অ্যাপ সেটি OTP field-এ auto pre-fill করে (in-app delivery)।
        #  ভবিষ্যতে SMS gateway সেট হলে sms_sent=True হবে → নিজে থেকেই SMS-এ চলে যাবে।
        if settings.DEBUG or not sms_sent:
            resp['otp_code'] = otp.otp_code
            resp['otp_in_app'] = True   # অ্যাপ চাইলে স্পষ্ট বার্তা দেখাতে পারে
        return Response(resp)


class AppRegisterView(APIView):
    # POST /app/auth/register/ — Self-registration ধাপ ২: OTP verify করে password সেট → auto login
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = AppRegisterSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)
        data = serializer.validated_data

        client = Client.objects.filter(customer_id=data['customer_id']).first()
        if not client:
            return Response({'detail': 'এই Client Code পাওয়া যায়নি।'}, status=404)
        if client.is_app_user:
            return Response({'detail': 'You\'re already registered with this Client Code!'}, status=400)

        # OTP verify (registered phone-এ পাঠানো হয়েছিল)
        otp_record = OTPRecord.objects.filter(
            phone=client.phone, otp_code=data['otp_code'], is_used=False
        ).order_by('-created_at').first()
        if not otp_record or not otp_record.is_valid():
            return Response({'detail': 'Verification Code ভুল বা মেয়াদোত্তীর্ণ।'}, status=400)
        otp_record.is_used = True
        otp_record.save(update_fields=['is_used'])

        # password সেট + register
        if data.get('email'):
            client.email = data['email'].strip()
        client.set_app_password(data['password'])
        client.app_enabled = True
        client.app_registered_on = timezone.now()
        client.app_last_seen = timezone.now()
        client.save(update_fields=['email', 'app_password', 'app_enabled', 'app_registered_on', 'app_last_seen'])

        # auto login — JWT
        refresh = _create_client_token(client)
        return Response({
            'detail': 'Registration সফল হয়েছে।',
            'refresh': str(refresh),
            'access':  str(refresh.access_token),
            'client': {
                'id':          client.id,
                'customer_id': client.customer_id,
                'full_name':   client.full_name,
                'phone':       client.phone,
                'status':      client.status,
            },
        })


class AppTokenRefreshView(APIView):
    # POST /app/auth/refresh/ — client refresh token দিয়ে নতুন access token
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        refresh_str = request.data.get('refresh')
        if not refresh_str:
            return Response({'detail': 'refresh token দেওয়া হয়নি।'}, status=400)
        try:
            import jwt
            from django.conf import settings
            payload = jwt.decode(refresh_str, settings.SECRET_KEY, algorithms=['HS256'])
            client_id = payload.get('client_id')
            if client_id:
                # ── Client refresh ──
                client = Client.objects.get(pk=client_id, app_enabled=True)
                refresh = _create_client_token(client)
                return Response({'access': str(refresh.access_token)})

            # ── POP refresh (pop_id token) ──
            pop_id = payload.get('pop_id')
            if pop_id:
                from pop.models import POP
                pop = POP.objects.get(pk=pop_id, is_active=True)
                refresh = _create_pop_token(pop)
                return Response({'access': str(refresh.access_token)})

            # ── Staff refresh (user_id token) ──
            user_id = payload.get('user_id')
            if user_id:
                from accounts.models import User
                user = User.objects.get(pk=user_id, is_active=True)
                refresh = _create_staff_token(user)
                return Response({'access': str(refresh.access_token)})

            return Response({'detail': _ERR_INVALID_TOKEN}, status=401)
        except jwt.ExpiredSignatureError:
            return Response({'detail': 'Refresh token মেয়াদোত্তীর্ণ। আবার login করুন।'}, status=401)
        except (jwt.InvalidTokenError, Client.DoesNotExist):
            return Response({'detail': _ERR_INVALID_TOKEN}, status=401)
        except Exception:
            return Response({'detail': _ERR_INVALID_TOKEN}, status=401)


class AppLogoutView(APIView):
    # POST /app/auth/logout/ — FCM token clear করা
    authentication_classes = [MobileClientAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        client_id = None
        if hasattr(request, 'auth') and request.auth:
            try:
                client_id = request.auth.get('client_id')
            except Exception:
                pass
        if client_id:
            Client.objects.filter(pk=client_id).update(fcm_token='')
        return Response({'detail': 'Logout সফল।'})


# ─── Client Self-Service ─────────────────────────────────────────────────────

def _get_mobile_client(request):
    # MobileClientAuthentication দিয়ে authenticate হলে request.user.client থাকবে
    from mobile_api.authentication import MobileClientUser
    if isinstance(request.user, MobileClientUser):
        return request.user.client
    # fallback: JWT payload থেকে client_id
    if request.auth and isinstance(request.auth, dict):
        client_id = request.auth.get('client_id')
        if client_id:
            try:
                return Client.objects.select_related('package', 'zone', 'subzone').get(
                    pk=client_id, app_enabled=True
                )
            except Client.DoesNotExist:
                pass
    return None


def _validate_profile_payload(vd):
    """profile patch validated_data-তে required field খালি কিনা → error Response বা None।"""
    # email বাধ্যতামূলক — payload-এ থাকলে খালি রাখা যাবে না
    if 'email' in vd and not (vd['email'] or '').strip():
        return Response({'email': ['ইমেইল বাধ্যতামূলক।']}, status=400)
    # map_lat/map_lng বাধ্যতামূলক — map view-এর জন্য (payload-এ থাকলে খালি নয়)
    for geo in ['map_lat', 'map_lng']:
        if geo in vd and vd[geo] in (None, ''):
            return Response({geo: ['Latitude/Longitude বাধ্যতামূলক।']}, status=400)
    return None


def _apply_writable_profile_fields(client, vd):
    """শুধু writable field গুলো client-এ set করে save।"""
    writable = ['father_name', 'alt_phone', 'email', 'area', 'house_name', 'address', 'map_lat', 'map_lng']
    for field in writable:
        if field in vd:
            setattr(client, field, vd[field])
    client.save(update_fields=[f for f in writable if f in vd])


class ClientProfileView(APIView):
    # GET /app/me/  PATCH /app/me/
    authentication_classes = [MobileClientAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        client = _get_mobile_client(request)
        if not client:
            return Response({'detail': _ERR_CLIENT_NOT_FOUND}, status=403)
        return Response(AppClientProfileSerializer(client, context={'request': request}).data)

    def patch(self, request):
        client = _get_mobile_client(request)
        if not client:
            return Response({'detail': _ERR_CLIENT_NOT_FOUND}, status=403)
        serializer = AppClientProfileSerializer(
            client, data=request.data, partial=True, context={'request': request}
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)
        vd = serializer.validated_data
        err = _validate_profile_payload(vd)
        if err is not None:
            return err
        _apply_writable_profile_fields(client, vd)
        return Response(AppClientProfileSerializer(client, context={'request': request}).data)


class AppSipCredentialsView(APIView):
    # GET /app/voip/sip-credentials/ — client-এর softphone (অ্যাপ) register করার ephemeral creds।
    # ⚠️ client নিজের endpoint (client_<id>)-এর creds পায়; অন্য কারো নয়।
    authentication_classes = [MobileClientAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        client = _get_mobile_client(request)
        if not client:
            return Response({'detail': _ERR_CLIENT_NOT_FOUND}, status=403)
        from django.conf import settings
        from voip.services.asterisk_provision import provision_endpoint
        from role_permissions.utils import decrypt_password
        from voip.api.views import _turn_ice_servers
        ep = provision_endpoint(client=client)
        # active hotline নম্বর — client dialpad-এ যে নম্বরে কল করবে
        # (agent endpoint name-এর বদলে hotline number ব্যবহার করা হয়,
        #  যাতে PBX routing (ring group/IVR) কাজ করে)
        from voip.models import HotlineNumber
        hotlines = HotlineNumber.objects.filter(is_active=True).order_by('id')
        support_contacts = [
            {'endpoint': h.number, 'name': h.title}
            for h in hotlines
        ] or [{'endpoint': '100', 'name': 'ISP Support'}]
        return Response({
            'sip_user':        ep.endpoint_name,
            'sip_pass':        decrypt_password(ep.secret_encrypted),
            'wss_url':         getattr(settings, 'VOIP_WSS_URL', ''),
            'sip_domain':      getattr(settings, 'VOIP_SIP_DOMAIN', ''),
            'ice_servers':     _turn_ice_servers(),
            'enabled':         getattr(settings, 'VOIP_ENABLED', False),
            'support_contacts': support_contacts,
        })


class FCMTokenUpdateView(APIView):
    # POST /app/me/fcm-token/ — device FCM token আপডেট
    authentication_classes = [MobileClientAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = FCMTokenSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)
        client = _get_mobile_client(request)
        if not client:
            return Response({'detail': _ERR_CLIENT_NOT_FOUND}, status=403)
        client.fcm_token = serializer.validated_data['fcm_token']
        client.save(update_fields=['fcm_token'])
        return Response({'detail': 'FCM token আপডেট হয়েছে।'})


class AppBillListView(APIView):
    # GET /app/bills/ — bill history
    authentication_classes = [MobileClientAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        client = _get_mobile_client(request)
        if not client:
            return Response({'detail': _ERR_CLIENT_NOT_FOUND}, status=403)
        bills = Bill.objects.filter(client=client).order_by('-created_at')[:24]
        return Response(AppBillSerializer(bills, many=True).data)


class AppCurrentBillView(APIView):
    # GET /app/bills/current/ — current month bill + account summary
    authentication_classes = [MobileClientAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        client = _get_mobile_client(request)
        if not client:
            return Response({'detail': _ERR_CLIENT_NOT_FOUND}, status=403)
        current = Bill.objects.filter(client=client).order_by('-created_at').first()

        # Invoice-এর জন্য payment history
        payments_data = []
        if current:
            for p in current.payments.order_by('-payment_date'):
                payments_data.append({
                    'id':             p.id,
                    'payment_method': p.payment_method,
                    'amount':         str(p.amount),
                    'date':           p.payment_date,
                    'is_verified':    p.is_verified,
                    'transaction_id': p.transaction_id,
                })

        return Response({
            'current_bill':    AppBillSerializer(current).data if current else None,
            'due_amount':      str(client.due_amount),
            'advance_balance': str(client.advance_balance),
            'expiry_date':     client.expiry_date,
            'status':          client.status,
            # Invoice fields
            'client_name':     client.full_name,
            'client_code':     client.customer_id,
            'username':        client.username,
            'phone':           client.phone,
            'package_name':    client.package.name if client.package else '—',
            'monthly_bill':    str(client.monthly_bill),
            'payments':        payments_data,
        })


class AppTicketListCreateView(APIView):
    # GET /app/tickets/   POST /app/tickets/
    authentication_classes = [MobileClientAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def _gen_ticket_no(self):
        today = timezone.now().strftime('%Y%m%d')
        rand  = uuid.uuid4().hex[:6].upper()
        return f'TKT-{today}-{rand}'

    def get(self, request):
        client = _get_mobile_client(request)
        if not client:
            return Response({'detail': _ERR_CLIENT_NOT_FOUND}, status=403)
        tickets = SupportTicket.objects.filter(client=client).order_by('-created_at')
        return Response(AppTicketListSerializer(tickets, many=True).data)

    def post(self, request):
        client = _get_mobile_client(request)
        if not client:
            return Response({'detail': _ERR_CLIENT_NOT_FOUND}, status=403)
        serializer = AppTicketCreateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        # Unique ticket_id generate
        for _ in range(5):
            tid = self._gen_ticket_no()
            if not SupportTicket.objects.filter(ticket_id=tid).exists():
                break

        ticket = serializer.save(
            client=client,
            ticket_id=tid,
            source='portal',
        )
        # AI auto-categorize (background)
        try:
            from support.tasks import ai_categorize_ticket
            ai_categorize_ticket.delay(ticket.id)
        except Exception:
            pass
        return Response(AppTicketDetailSerializer(ticket).data, status=201)


class AppAIChatView(APIView):
    # POST /app/ai/chat/ — গ্রাহকের প্রশ্নের instant AI উত্তর (account-context সহ)
    # 🔒 শুধু non-sensitive data (status/বকেয়া/online) AI-তে যায়; local Ollama।
    authentication_classes = [MobileClientAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        client = _get_mobile_client(request)
        if not client:
            return Response({'detail': _ERR_CLIENT_NOT_FOUND}, status=403)
        message = (request.data.get('message') or '').strip()
        if not message:
            return Response({'detail': 'অনুগ্রহ করে আপনার প্রশ্ন লিখুন।'}, status=400)
        # সাম্প্রতিক কথোপকথন history — multi-turn context (app থেকে আসে)
        history = request.data.get('history')
        if not isinstance(history, list):
            history = []
        try:
            from support.ai_service import answer_client_query
            return Response(answer_client_query(message, client, history=history))
        except Exception:
            return Response({
                'reply': ('দুঃখিত, এই মুহূর্তে AI সহকারী পাওয়া যাচ্ছে না। অনুগ্রহ করে '
                          'একটি টিকেট তৈরি করুন বা আমাদের হটলাইনে কল করুন।'),
                'intent': 'general', 'suggest_ticket': True,
            })


class AppTicketDetailView(APIView):
    # GET /app/tickets/<pk>/
    authentication_classes = [MobileClientAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        client = _get_mobile_client(request)
        if not client:
            return Response({'detail': _ERR_CLIENT_NOT_FOUND}, status=403)
        try:
            ticket = SupportTicket.objects.get(pk=pk, client=client)
        except SupportTicket.DoesNotExist:
            return Response({'detail': 'Ticket পাওয়া যায়নি।'}, status=404)
        return Response(AppTicketDetailSerializer(ticket).data)

    def post(self, request, pk):
        # POST /app/tickets/<pk>/ — গ্রাহক নিজে ticket-এ reply দেয় (two-way thread)।
        from support.models import TicketReply
        client = _get_mobile_client(request)
        if not client:
            return Response({'detail': _ERR_CLIENT_NOT_FOUND}, status=403)
        try:
            ticket = SupportTicket.objects.get(pk=pk, client=client)
        except SupportTicket.DoesNotExist:
            return Response({'detail': 'Ticket পাওয়া যায়নি।'}, status=404)
        msg = (request.data.get('message') or '').strip()
        if not msg:
            return Response({'detail': 'অনুগ্রহ করে আপনার উত্তর লিখুন।'}, status=400)

        # replied_by=None — mobile client হলো Client model, AUTH User নয়।
        # is_client_reply=True দিয়েই client/staff পার্থক্য বোঝানো হয়।
        TicketReply.objects.create(
            ticket=ticket,
            message=msg,
            is_client_reply=True,
            replied_by=None,
        )
        # গ্রাহক reply দিলে resolved/closed ticket আবার open — staff নজরে আসবে।
        if ticket.status in ('resolved', 'closed'):
            ticket.status = 'open'
            ticket.save(update_fields=['status'])

        return Response(AppTicketDetailSerializer(ticket).data, status=201)


class BkashInitiateView(APIView):
    # POST /app/payments/bkash/initiate/ — bKash payment URL তৈরি করা
    authentication_classes = [MobileClientAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        client = _get_mobile_client(request)
        if not client:
            return Response({'detail': _ERR_CLIENT_NOT_FOUND}, status=403)

        amount     = request.data.get('amount')
        if not amount or float(amount) <= 0:
            return Response({'detail': 'সঠিক পরিমাণ দিন।'}, status=400)

        invoice_no  = f'ISP-{client.customer_id}-{timezone.now().strftime("%Y%m%d%H%M%S")}'
        callback_url = request.build_absolute_uri('/api/v1/app/payments/bkash/callback/')

        try:
            from mobile_api.services.bkash_service import BkashTokenizedService
            svc   = BkashTokenizedService()
            token = svc.grant_token()
            result = svc.create_payment(
                token       = token,
                amount      = float(amount),
                invoice_no  = invoice_no,
                callback_url= callback_url,
                payer_ref   = client.customer_id,
            )
            # Payment session DB-তে store করা (pending)
            from mobile_api.models import BkashPaymentSession
            BkashPaymentSession.objects.create(
                client      = client,
                payment_id  = result['payment_id'],
                amount      = float(amount),
                invoice_no  = invoice_no,
                token       = token,
            )
            return Response({
                'bkash_url':  result['bkash_url'],
                'payment_id': result['payment_id'],
                'amount':     str(amount),
            })
        except Exception as e:
            logger.exception(f'bKash initiate error: {e}')
            return Response({'detail': f'bKash সংযোগ ব্যর্থ: {str(e)}'}, status=502)


class BkashCallbackView(APIView):
    # GET /app/payments/bkash/callback/ — bKash payment-এর পর redirect
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        from django.http import HttpResponse
        payment_id = request.GET.get('paymentID')
        status_val = request.GET.get('status', '')

        if status_val == 'cancel':
            return HttpResponse(self._page(
                'পেমেন্ট বাতিল হয়েছে।', '#ef4444',
                'আপনি bKash পেমেন্ট বাতিল করেছেন।\nঅ্যাপে ফিরে আবার চেষ্টা করুন।'
            ))

        if status_val == 'failure':
            return HttpResponse(self._page(
                'পেমেন্ট ব্যর্থ হয়েছে।', '#ef4444',
                'পেমেন্ট সম্পন্ন হয়নি।\nঅ্যাপে ফিরে আবার চেষ্টা করুন।'
            ))

        try:
            from mobile_api.models import BkashPaymentSession
            session = BkashPaymentSession.objects.get(payment_id=payment_id)
            from mobile_api.services.bkash_service import BkashTokenizedService
            svc    = BkashTokenizedService()
            result = svc.execute_payment(session.token, payment_id)

            # bKash tokenizer = যাচাইকৃত gateway payment → approval ছাড়াই auto-settle।
            # BillingService দিয়ে due bills oldest-first পরিশোধ (is_verified=True),
            # বাকি থাকলে advance_balance-এ যোগ — standard webhook receiver-এর মতোই।
            from billing.services import BillingService
            from billing.models import WebhookPayment
            from django.utils import timezone as _tz
            from decimal import Decimal as _D

            notes = f'[bKash App] PaymentID: {payment_id}'
            res = BillingService.receive_payment(
                client         = session.client,
                amount         = _D(str(session.amount)),
                payment_method = 'bkash',
                transaction_id = result['trx_id'],
                notes          = notes,
                is_verified    = True,
            )
            # তৈরি প্রথম payment-কে WebhookPayment-এ link → Collected Bills থেকে বাদ
            # (webhook_source__isnull) এবং Webhook Payments tab-এ দেখাবে।
            linked = None
            pay_ids = res.get('payment_ids') or []
            if pay_ids:
                linked = Payment.objects.filter(id=pay_ids[0]).first()

            # একই trxID-তে duplicate WebhookPayment এড়াই
            if not WebhookPayment.objects.filter(transaction_id=result['trx_id']).exists():
                WebhookPayment.objects.create(
                    gateway_type      = 'BKASH_WEBHOOK',
                    transaction_id    = result['trx_id'],
                    payment_amount    = _D(str(session.amount)),
                    from_wallet       = result.get('customer_msisdn', ''),
                    trans_msg_inv_no  = payment_id,
                    trans_reference   = session.client.customer_id or session.client.username or '',
                    trans_timestamp   = _tz.now(),
                    trans_status      = 'Completed',
                    settlement_status = 'automatically_settled',
                    matched_client    = session.client,
                    linked_payment    = linked,
                    raw_data          = {'source': 'bkash_app_tokenized',
                                         'payment_id': payment_id,
                                         'trx_id': result['trx_id']},
                )

            session.is_completed = True
            session.trx_id       = result['trx_id']
            session.save(update_fields=['is_completed', 'trx_id'])

            # Package upgrade হলে পেমেন্টের পরে package পরিবর্তন করো
            success_detail = f'Transaction ID: {result["trx_id"]}\nআপনার বিল পরিশোধ হয়েছে — সংযোগ চালু।\n\nঅ্যাপে ফিরে যান।'
            if session.purpose == 'package_upgrade' and session.new_package:
                try:
                    _apply_package_change_mobile(session.client, session.new_package, 'bkash_upgrade')
                    success_detail = (
                        f'Transaction ID: {result["trx_id"]}\n'
                        f'প্যাকেজ {session.new_package.name}-এ আপগ্রেড সফল হয়েছে!\n\n'
                        f'অ্যাপে ফিরে যান।'
                    )
                except Exception as pkg_err:
                    logger.exception(f'Package upgrade after bKash payment failed: {pkg_err}')

            return HttpResponse(self._page('✅ পেমেন্ট সফল!', '#10b981', success_detail))
        except Exception as e:
            logger.exception(f'bKash callback error: {e}')
            return HttpResponse(self._page('⚠️ যাচাই করা যায়নি।', '#f59e0b', str(e)))

    def _page(self, title, color, msg, auto_close=True):
        close_script = '''
<script>
  // Android/iOS back button simulate করা
  function goBack() {
    // History-তে আগের page থাকলে সেখানে যাওয়া (app-এ ফিরবে)
    if (window.history.length > 1) {
      window.history.go(-1);
    } else {
      window.close();
    }
  }
  // ৩ সেকেন্ড পর auto-redirect
  setTimeout(function() { goBack(); }, 3000);
</script>''' if auto_close else ''

        # status color → icon (nested ternary এড়াতে আলাদা, S3358)
        if '#10b981' in color:
            icon = '✅'
        elif '#ef4444' in color:
            icon = '❌'
        else:
            icon = '⚠️'

        return f'''<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>bKash Payment</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: -apple-system, sans-serif; background: #f8fafc;
           display: flex; align-items: center; justify-content: center;
           min-height: 100vh; padding: 20px; }}
    .card {{ background: #fff; border-radius: 20px; padding: 32px 24px;
             max-width: 360px; width: 100%;
             box-shadow: 0 4px 24px rgba(0,0,0,.1); text-align: center; }}
    .brand {{ font-size: 28px; font-weight: 900; color: #E2136E; margin-bottom: 20px; }}
    .icon  {{ font-size: 56px; margin-bottom: 16px; }}
    .title {{ font-size: 20px; font-weight: 800; color: {color}; margin-bottom: 12px; }}
    .msg   {{ color: #64748b; line-height: 1.7; white-space: pre-line; font-size: 14px; margin-bottom: 24px; }}
    .btn   {{ display: inline-block; background: {color}; color: #fff;
             border: none; border-radius: 12px; padding: 14px 32px;
             font-size: 15px; font-weight: 700; cursor: pointer;
             width: 100%; text-decoration: none; }}
    .timer {{ color: #94a3b8; font-size: 12px; margin-top: 12px; }}
  </style>
  {close_script}
</head>
<body>
  <div class="card">
    <div class="brand">বিকাশ</div>
    <div class="icon">{icon}</div>
    <div class="title">{title}</div>
    <div class="msg">{msg}</div>
    <button class="btn" onclick="goBack() if typeof goBack !== 'undefined' else window.history.back()">
      ← অ্যাপে ফিরে যান
    </button>
    {'<div class="timer">৩ সেকেন্ডে স্বয়ংক্রিয়ভাবে ফিরবে...</div>' if auto_close else ''}
  </div>
  <script>
    function goBack() {{
      if (window.history.length > 1) {{ window.history.go(-1); }}
      else {{ window.close(); }}
    }}
    document.querySelector('.btn').onclick = goBack;
    {'setTimeout(goBack, 3000);' if auto_close else ''}
  </script>
</body>
</html>'''


import logging
logger = logging.getLogger(__name__)


class AppPaymentGatewayListView(APIView):
    # GET /app/payment-gateways/ — client app-এ দেখানোর জন্য active gateway list
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        from django.db.models import Q
        labels = {
            'bkash':  {'label': 'bKash',        'color': '#E2136E'},
            'nagad':  {'label': 'Nagad',         'color': '#F7941D'},
            'rocket': {'label': 'Rocket',        'color': '#8B2FC9'},
            'bank':   {'label': 'Bank Transfer', 'color': '#1565c0'},
        }
        # is_active=True এবং merchant_number বা username যেকোনো একটা থাকলেই দেখাবে
        gw_objs = PaymentGatewayConfig.objects.filter(
            is_active=True
        ).filter(
            Q(merchant_number__gt='') | Q(username__gt='') | Q(config__payment_url__isnull=False)
        )
        result = []
        for obj in gw_objs:
            meta = labels.get(obj.gateway, {'label': obj.gateway.title(), 'color': '#374151'})
            cfg = obj.config or {}
            payment_url = cfg.get('payment_url', '')
            # merchant_number বা username — যেটা আছে সেটা দেখাবে
            display_number = obj.merchant_number or obj.username or ''
            if not display_number and not payment_url:
                continue  # কিছুই নেই — skip
            result.append({
                'gateway':        obj.gateway,
                'label':          meta['label'],
                'color':          meta['color'],
                'merchant_number': display_number,
                'username':       obj.username,
                'payment_url':    payment_url,
            })
        return Response(result)


class AppReportPaymentView(APIView):
    # POST /app/payments/report/ — client payment জমা দেওয়া (pending approval)
    authentication_classes = [MobileClientAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        client = _get_mobile_client(request)
        if not client:
            return Response({'detail': _ERR_CLIENT_NOT_FOUND}, status=403)

        amount         = request.data.get('amount')
        payment_method = request.data.get('payment_method', 'bkash')
        transaction_id = request.data.get('transaction_id', '').strip()

        if not amount or float(amount) <= 0:
            return Response({'detail': 'সঠিক পরিমাণ দিন।'}, status=400)
        if not transaction_id:
            return Response({'detail': 'Transaction ID দিন।'}, status=400)

        # Current bill খোঁজা
        bill = Bill.objects.filter(
            client=client, status__in=['unpaid', 'partial']
        ).order_by('-created_at').first()

        # Pending payment তৈরি করা (is_verified=False → collector/pending)
        payment = Payment.objects.create(
            bill=bill,
            client=client,
            amount=float(amount),
            payment_method=payment_method,
            transaction_id=transaction_id,
            is_verified=False,
            notes=f'[App Payment] TxID: {transaction_id}',
        )

        return Response({
            'detail': 'পেমেন্ট জমা দেওয়া হয়েছে। Admin যাচাই করবে।',
            'payment_id': payment.id,
            'amount': str(payment.amount),
            'status': 'pending',
        }, status=201)


class AppPaymentHistoryView(APIView):
    # GET /app/payments/ — client payment history
    authentication_classes = [MobileClientAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        client = _get_mobile_client(request)
        if not client:
            return Response({'detail': _ERR_CLIENT_NOT_FOUND}, status=403)
        payments = Payment.objects.filter(client=client).order_by('-payment_date')[:20]
        data = [{
            'id':             p.id,
            'amount':         str(p.amount),
            'payment_method': p.payment_method,
            'transaction_id': p.transaction_id,
            'is_verified':    p.is_verified,
            'date':           p.payment_date,
        } for p in payments]
        return Response(data)


class AppSmsHistoryView(APIView):
    # GET /app/me/sms/ — client-কে পাঠানো SMS history
    authentication_classes = [MobileClientAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        client = _get_mobile_client(request)
        if not client:
            return Response({'detail': _ERR_CLIENT_NOT_FOUND}, status=403)
        # client FK দিয়ে অথবা phone মিলে এমন সব SMS (FK না থাকলেও ধরা পড়বে)
        logs = SMSLog.objects.filter(
            Q(client=client) | Q(recipient_phone=client.phone)
        ).order_by('-created_at')[:50]
        data = [{
            'id':      s.id,
            'message': s.message,
            'status':  s.status,
            'sent_at': (s.sent_at or s.created_at).isoformat(),
        } for s in logs]
        return Response(data)


class AppNotificationHistoryView(APIView):
    # GET /app/me/notifications/ — এই client-কে পাঠানো push notification history (in-app inbox)
    authentication_classes = [MobileClientAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        client = _get_mobile_client(request)
        if not client:
            return Response({'detail': _ERR_CLIENT_NOT_FOUND}, status=403)
        # যে notification-গুলো এই client পেয়েছে: সকলকে, তার zone-কে, বা সরাসরি তাকে
        logs = PushNotificationLog.objects.filter(
            Q(target_type='all') |
            Q(target_type='zone', target_id=client.zone_id) |
            Q(target_type='client', target_id=client.id)
        ).order_by('-sent_at')[:50]
        data = [{
            'id':      l.id,
            'title':   l.title,
            'body':    l.body,
            'sent_at': l.sent_at.isoformat(),
        } for l in logs]
        return Response(data)


class AppBannerListView(APIView):
    # GET /app/banners/ — active banners (public, no token needed)
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        now = timezone.now()
        banners = AppBanner.objects.filter(
            is_active=True
        ).exclude(
            expires_at__lt=now
        ).order_by('-priority', '-created_at')[:10]
        return Response(AppBannerSerializer(banners, many=True, context={'request': request}).data)


class AppConfigView(APIView):
    # GET /app/config/ — app version, maintenance mode, FTP, Live TV (public, no token needed)
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        config = MobileAppConfig.get_config()
        data   = AppConfigSerializer(config).data

        # Ticker expiry check — মেয়াদ পেরিয়ে গেলে empty করা
        if config.ticker_expires_at and config.ticker_notice:
            if timezone.now() > config.ticker_expires_at:
                data['ticker_notice'] = ''  # expired, client-এ দেখাবে না

        # Company logo + name (System Settings → Company Setup থেকে)
        # admin logo বদলালে app-এর login পেজের logo-ও বদলাবে
        company = CompanySetup.objects.first()
        data['company_name'] = company.name if company else ''
        # helpline/hotline — app-এর payment block ও অন্যান্য স্ক্রিনে দেখানো হয়
        data['company_phone'] = (company.phone or '') if company else ''
        data['company_logo'] = (
            request.build_absolute_uri(company.logo.url)
            if (company and company.logo) else ''
        )

        return Response(data)


class AppLiveTrafficView(APIView):
    # GET /app/me/traffic/ — client-এর real-time bandwidth usage
    authentication_classes = [MobileClientAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        client = _get_mobile_client(request)
        if not client:
            return Response({'detail': _ERR_CLIENT_NOT_FOUND}, status=403)

        if not client.router:
            return Response({'online': False, 'detail': 'Router সংযুক্ত নেই।'})

        try:
            from mikrotik_app.services.mikrotik_service import MikrotikService
            svc  = MikrotikService.from_server_model(client.router)
            data = svc.get_user_traffic(client.username)
            if not data:
                return Response({'online': False, 'detail': 'Client offline।'})

            # এই মাসের মোট usage — RADIUS radacct থেকে (RadiusService connection ব্যবহার)
            monthly_dl = monthly_ul = 0
            try:
                from radius_app.services.radius_service import RadiusService
                from django.utils import timezone as tz
                month_start = tz.now().date().replace(day=1)

                rsvc = RadiusService.for_client(client)
                conn = rsvc._conn()
                with conn.cursor() as cur:
                    cur.execute('''
                        SELECT
                          COALESCE(SUM(acctoutputoctets), 0),
                          COALESCE(SUM(acctinputoctets),  0)
                        FROM radacct
                        WHERE username = %s
                          AND acctstarttime >= %s
                    ''', [client.username, month_start])
                    row = cur.fetchone()
                    if row:
                        monthly_dl = int(row[0] or 0)
                        monthly_ul = int(row[1] or 0)
                conn.close()
                # চলমান session bytes যোগ (radacct-এ এখনো close হয়নি)
                monthly_dl += data.get('bytes_in', 0)
                monthly_ul += data.get('bytes_out', 0)
            except Exception as re:
                logger.warning(f'Monthly usage fetch error: {re}')
                # fallback: শুধু session data
                monthly_dl = data.get('bytes_in', 0)
                monthly_ul = data.get('bytes_out', 0)

            return Response({
                'online':      True,
                'ip':          data.get('ip', ''),
                'uptime':      data.get('uptime', ''),
                # Session data
                'bytes_in':    data.get('bytes_in', 0),
                'bytes_out':   data.get('bytes_out', 0),
                'mb_in':       round(data.get('bytes_in', 0)  / 1024 / 1024, 2),
                'mb_out':      round(data.get('bytes_out', 0) / 1024 / 1024, 2),
                # Monthly data
                'monthly_dl':  monthly_dl,
                'monthly_ul':  monthly_ul,
                'monthly_dl_mb': round(monthly_dl / 1024 / 1024, 2),
                'monthly_ul_mb': round(monthly_ul / 1024 / 1024, 2),
            })
        except Exception as e:
            return Response({'online': False, 'detail': str(e)})


# ─── Admin Push Notification ──────────────────────────────────────────────────

class SendPushNotificationView(APIView):
    # POST /app/admin/push/send/ — admin push notification পাঠানো
    # admin panel থেকে কল হয় → admin JWT (MobileClientAuthentication নয়)
    authentication_classes = [JWTAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if request.user.role not in ('superadmin', 'admin', 'manager'):
            return Response({'detail': 'এই কাজের অনুমতি নেই।'}, status=403)

        serializer = PushNotificationSendSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        data        = serializer.validated_data
        title       = data['title']
        body        = data['body']
        target_type = data['target_type']
        target_id   = data.get('target_id')
        extra_data  = data.get('extra_data', {})

        tokens, target_name = _get_tokens_for_target(target_type, target_id)

        result = push_service.send_to_multiple(tokens, title, body, extra_data)

        PushNotificationLog.objects.create(
            title=title, body=body,
            target_type=target_type, target_id=target_id,
            target_name=target_name,
            sent_count=result['success'],
            fail_count=result['failure'],
            sent_by=request.user,
            extra_data=extra_data,
        )

        return Response({
            'detail': f"{result['success']} জন-কে notification পাঠানো হয়েছে।",
            'success': result['success'],
            'failure': result['failure'],
        })


class PushNotificationLogListView(APIView):
    # GET /app/admin/push/history/ — push notification history
    # admin panel থেকে কল হয় → admin JWT (MobileClientAuthentication নয়)
    authentication_classes = [JWTAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if request.user.role not in ('superadmin', 'admin', 'manager'):
            return Response({'detail': 'অনুমতি নেই।'}, status=403)
        logs = PushNotificationLog.objects.select_related('sent_by').order_by('-sent_at')[:50]
        data = [
            {
                'id': l.id, 'title': l.title, 'body': l.body,
                'target_type': l.target_type, 'target_name': l.target_name,
                'sent_count': l.sent_count, 'fail_count': l.fail_count,
                'sent_by': l.sent_by.full_name if l.sent_by else 'System',
                'sent_at': l.sent_at,
            }
            for l in logs
        ]
        return Response(data)


def _get_tokens_for_target(target_type: str, target_id) -> tuple:
    # target_type/id অনুযায়ী FCM token list ও target নাম ফেরত দেওয়া
    if target_type == 'all':
        tokens = list(
            Client.objects.filter(app_enabled=True).exclude(fcm_token='')
            .values_list('fcm_token', flat=True)
        )
        return tokens, 'সকল Client'

    elif target_type == 'zone':
        try:
            zone = Zone.objects.get(pk=target_id)
            tokens = list(
                Client.objects.filter(zone=zone, app_enabled=True).exclude(fcm_token='')
                .values_list('fcm_token', flat=True)
            )
            return tokens, zone.name
        except Zone.DoesNotExist:
            return [], 'Unknown Zone'

    elif target_type == 'client':
        try:
            client = Client.objects.get(pk=target_id, app_enabled=True)
            tokens = [client.fcm_token] if client.fcm_token else []
            return tokens, client.full_name
        except Client.DoesNotExist:
            return [], 'Unknown Client'

    return [], ''


# ── Package Upgrade/Downgrade (Mobile Self-Service) ─────────────────────────

def _calc_upgrade_amount(client, new_pkg):
    """আজ থেকে মেয়াদ শেষের দিন পর্যন্ত pro-rated মূল্য হিসেব করে।"""
    from datetime import date
    from decimal import Decimal

    today    = date.today()
    expiry   = client.expiry_date
    if not expiry or expiry <= today:
        return Decimal('0')
    remaining = (expiry - today).days
    old_price = client.package.price if client.package else Decimal('0')
    new_price = new_pkg.price
    diff      = new_price - old_price
    if diff <= Decimal('0'):
        return Decimal('0')
    return (diff * remaining / 30).quantize(Decimal('0.01'))


def _pkg_change_radius(client, new_prof, group_changed):
    """package change-এ RADIUS group update (active client হলে)।"""
    try:
        from radius_app.services.radius_service import RadiusService
        svc = RadiusService.for_client(client)
        if svc.user_exists(client.username) and group_changed and client.status == 'active':
            # Mikrotik-Group attribute নিশ্চিত করো
            try:
                svc.set_group_attribute(new_prof, 'Mikrotik-Group', ':=', new_prof)
            except Exception:
                pass
            svc.set_user_group(client.username, new_prof)
    except Exception:
        pass


def _pkg_change_mikrotik(client, new_prof, group_changed):
    """package change-এ MikroTik PPPoE secret profile update।"""
    try:
        if client.router and group_changed:
            from mikrotik_app.services.mikrotik_service import MikrotikService
            MikrotikService.from_server_model(client.router).update_pppoe_user(
                username=client.username,
                profile=new_prof or 'default',
            )
    except Exception:
        pass


def _pkg_change_kick_sessions(client, group_changed):
    """active session kick — reconnect করলে সাথে সাথে নতুন profile পাবে।"""
    if group_changed and client.status == 'active':
        try:
            from clients.api.views import _kick_session_via_coa_or_api
            from mikrotik_app.models import MikrotikServer
            for s in MikrotikServer.objects.filter(is_active=True):
                _kick_session_via_coa_or_api(s, client.username)
        except Exception:
            pass


def _apply_package_change_mobile(client, new_pkg, source='app'):
    """Package পরিবর্তন — RADIUS group + MikroTik PPPoE profile + session kick।"""
    from clients.activity import log_client_activity

    old_pkg   = client.package
    old_prof  = (getattr(client, 'pppoe_profile', '') or '').strip()
    if not old_prof and old_pkg and old_pkg.mikrotik_profile:
        old_prof = old_pkg.mikrotik_profile.strip()

    client.package     = new_pkg
    client.monthly_bill = new_pkg.price
    # pppoe_profile → নতুন package-এর mikrotik_profile (router-specific নাম নাও হতে পারে,
    # কিন্তু RADIUS group হিসেবে সঠিক)
    if new_pkg.mikrotik_profile:
        client.pppoe_profile = new_pkg.mikrotik_profile
    client.save(update_fields=['package', 'monthly_bill', 'pppoe_profile', 'updated_at'])

    new_prof = (client.pppoe_profile or '').strip() or (new_pkg.mikrotik_profile or '').strip()
    group_changed = bool(new_prof and old_prof != new_prof)

    _pkg_change_radius(client, new_prof, group_changed)
    _pkg_change_mikrotik(client, new_prof, group_changed)
    _pkg_change_kick_sessions(client, group_changed)

    # Activity log
    try:
        log_client_activity(
            client, 'package_changed',
            f'[App {source}] {old_pkg} → {new_pkg}',
        )
    except Exception:
        pass


def _available_packages_qs(client, bc):
    """client-এর router-এ assigned active packages (billing_cycle মিলিয়ে);
    না থাকলে সব router-এর fallback।"""
    from configuration.models import Package
    if client.router:
        qs = Package.objects.filter(is_active=True, billing_cycle=bc, router=client.router)
        if qs.exists():
            return qs
    return Package.objects.filter(is_active=True, billing_cycle=bc)


def _pkg_change_option(pkg, cur_price, remaining, client):
    """package upgrade/downgrade option dict (prorated upgrade_amount সহ)।"""
    price = float(pkg.price)
    diff  = price - cur_price
    if diff > 0:
        ctype  = 'upgrade'
        amount = round(diff * remaining / 30, 2)
    elif diff < 0:
        ctype  = 'downgrade'
        amount = 0
    else:
        ctype  = 'current'
        amount = 0
    return {
        'id':            pkg.id,
        'name':          pkg.name,
        'speed_name':    pkg.speed_name or '',
        'price':         str(pkg.price),
        'billing_cycle': pkg.get_billing_cycle_display(),
        'description':   pkg.description or '',
        'is_current':    (client.package_id == pkg.id),
        'change_type':   ctype,
        'upgrade_amount': amount,
        'remaining_days': remaining,
    }


class AppPackageListView(MobileClientMiddlewareMixin, APIView):
    """GET /app/packages/ — ক্লায়েন্টের router-এ available packages + upgrade amount।"""
    authentication_classes = [MobileClientAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        client = _get_mobile_client(request)
        if not client:
            return Response({'detail': _ERR_CLIENT_NOT_FOUND}, status=403)

        from datetime import date

        # client-এর router-এ assigned packages দেখাও; fallback: billing_cycle
        bc = client.package.billing_cycle if client.package else 'monthly'
        qs = _available_packages_qs(client, bc)

        today    = date.today()
        expiry   = client.expiry_date
        remaining = max(0, (expiry - today).days) if expiry else 0
        cur_price = float(client.package.price) if client.package else 0

        packages = [_pkg_change_option(pkg, cur_price, remaining, client)
                    for pkg in qs.order_by('price')]

        return Response({
            'packages':       packages,
            'current_package': {
                'id':   client.package_id,
                'name': client.package.name if client.package else '',
            },
            'expiry_date': str(client.expiry_date) if client.expiry_date else None,
        })


class AppPackageUpgradeInitiateView(MobileClientMiddlewareMixin, APIView):
    """POST /app/packages/upgrade/initiate/ — bKash payment শুরু করে package upgrade-এর জন্য।"""
    authentication_classes = [MobileClientAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        client = _get_mobile_client(request)
        if not client:
            return Response({'detail': _ERR_CLIENT_NOT_FOUND}, status=403)

        from configuration.models import Package
        from decimal import Decimal

        pkg_id = request.data.get('package_id')
        if not pkg_id:
            return Response({'detail': 'package_id প্রয়োজন।'}, status=400)

        try:
            new_pkg = Package.objects.get(id=pkg_id, is_active=True)
        except Package.DoesNotExist:
            return Response({'detail': 'প্যাকেজ পাওয়া যায়নি।'}, status=404)

        if client.package_id == new_pkg.id:
            return Response({'detail': 'এটি আপনার বর্তমান প্যাকেজ।'}, status=400)

        old_price = client.package.price if client.package else Decimal('0')
        if new_pkg.price <= old_price:
            return Response({'detail': 'ডাউনগ্রেড-এ পেমেন্ট লাগে না। /packages/downgrade/ ব্যবহার করুন।'}, status=400)

        amount = _calc_upgrade_amount(client, new_pkg)
        if amount <= Decimal('0'):
            # মেয়াদ শেষ বা আজকেই — minimum ১ টাকা
            amount = Decimal('1')

        invoice_no   = f'PKG-{client.customer_id}-{timezone.now().strftime("%Y%m%d%H%M%S")}'
        callback_url = request.build_absolute_uri('/api/v1/app/payments/bkash/callback/')

        try:
            from mobile_api.services.bkash_service import BkashTokenizedService
            from mobile_api.models import BkashPaymentSession
            svc    = BkashTokenizedService()
            token  = svc.grant_token()
            result = svc.create_payment(
                token       = token,
                amount      = float(amount),
                invoice_no  = invoice_no,
                callback_url= callback_url,
                payer_ref   = client.customer_id,
            )
            BkashPaymentSession.objects.create(
                client      = client,
                payment_id  = result['payment_id'],
                amount      = float(amount),
                invoice_no  = invoice_no,
                token       = token,
                purpose     = 'package_upgrade',
                new_package = new_pkg,
            )
            return Response({
                'bkash_url':  result['bkash_url'],
                'payment_id': result['payment_id'],
                'amount':     str(amount),
                'new_package_name': new_pkg.name,
            })
        except Exception as e:
            logger.exception(f'Package upgrade bKash initiate error: {e}')
            return Response({'detail': f'bKash সংযোগ ব্যর্থ: {str(e)}'}, status=502)


class AppPackageDowngradeView(MobileClientMiddlewareMixin, APIView):
    """POST /app/packages/downgrade/ — তাৎক্ষণিক downgrade, কোনো পেমেন্ট নেই।"""
    authentication_classes = [MobileClientAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        client = _get_mobile_client(request)
        if not client:
            return Response({'detail': _ERR_CLIENT_NOT_FOUND}, status=403)

        from configuration.models import Package

        pkg_id = request.data.get('package_id')
        if not pkg_id:
            return Response({'detail': 'package_id প্রয়োজন।'}, status=400)

        try:
            new_pkg = Package.objects.get(id=pkg_id, is_active=True)
        except Package.DoesNotExist:
            return Response({'detail': 'প্যাকেজ পাওয়া যায়নি।'}, status=404)

        if client.package_id == new_pkg.id:
            return Response({'detail': 'এটি আপনার বর্তমান প্যাকেজ।'}, status=400)

        old_price = client.package.price if client.package else 0
        if new_pkg.price >= old_price:
            return Response({'detail': 'আপগ্রেড-এ পেমেন্ট করতে হবে।'}, status=400)

        _apply_package_change_mobile(client, new_pkg, 'downgrade')

        return Response({
            'success': True,
            'message': f'প্যাকেজ সফলভাবে {new_pkg.name}-এ পরিবর্তন হয়েছে।',
            'new_package': {'id': new_pkg.id, 'name': new_pkg.name, 'price': str(new_pkg.price)},
        })


# ── Live TV — client-facing channel list (only live + active) ───────────────
class AppLiveTVChannelsView(APIView):
    """Live TV channels — subscriber auth প্রয়োজন। Redis 45s cache।"""
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    _CACHE_KEY = 'mobile_livetv_channels'
    _CACHE_TTL = 45  # seconds

    PING_THRESHOLD_MS = 200  # এর বেশি ping হলে app-এ দেখাবে না

    def get(self, request):
        from django.core.cache import cache
        from livetv.models import TVChannel, TVCategory
        from livetv.api.auth_views import verify_livetv_token_verbose, REASON_MESSAGES
        from urllib.parse import quote

        # Subscriber authentication — valid token না থাকলে 401 (কারণ-সহ স্পষ্ট বার্তা)
        sub, reason = verify_livetv_token_verbose(request)
        if not sub:
            return Response(
                {'detail': REASON_MESSAGES.get(reason, REASON_MESSAGES['missing']), 'auth_required': True},
                status=401,
            )

        cached = cache.get(self._CACHE_KEY)
        if cached is not None:
            resp = Response(cached)
            resp['Cache-Control'] = 'public, max-age=30'
            resp['X-Cache'] = 'HIT'
            return resp

        # category slug → display name lookup (একবার query করো)
        cat_names = {c.slug: c.name for c in TVCategory.objects.all()}

        # কোন চ্যানেলগুলো দেখানো হবে তার হিসাব shared function-এ (filter + name dedup) —
        # admin panel stats endpoint-ও একই function ব্যবহার করে, তাই সংখ্যা সবসময় মিলবে।
        from livetv.services.app_visibility import get_visible_channels
        visible = get_visible_channels()  # [(channel, ms), …] already filtered+deduped+sorted

        # ── URL সহ চূড়ান্ত list build করো ──────────────────────────────────
        data = []
        for ch, _ms in visible:
            logo = ch.logo_url or ''
            if logo:
                logo = quote(logo, safe=':/?=&%#+@!')

            cat = (ch.category or '').lower()
            # URL-এর শেষে index.m3u8 — expo-video যাতে extension দেখে HLS চিনতে পারে
            stream_url = request.build_absolute_uri(f'/api/v1/app/livetv/stream/{ch.id}/index.m3u8')
            data.append({
                'id':               ch.id,
                'name':             ch.name,
                'slug':             ch.slug,
                'category':         cat,
                'category_display': cat_names.get(cat, cat.capitalize()),
                'logo_url':         logo,
                'description':      ch.description or '',
                'input_type':       ch.input_type,
                'status':           'live',
                'hls_url':          stream_url,
                'is_active':        ch.is_active,
                'sort_order':       ch.sort_order,
                'backup_urls': [
                    {
                        'label': u.get('label', 'Backup'),
                        'url': request.build_absolute_uri(f'/api/v1/app/livetv/stream/{ch.id}/index.m3u8?backup={i}'),
                    }
                    for i, u in enumerate(ch.extra_urls or []) if u.get('url')
                ],
            })

        payload = {'results': data, 'count': len(data)}
        cache.set(self._CACHE_KEY, payload, timeout=self._CACHE_TTL)
        resp = Response(payload)
        resp['Cache-Control'] = 'public, max-age=30'
        resp['X-Cache'] = 'MISS'
        return resp


# ── Live TV — subscriber-authenticated stream proxy ──────────────────────────
# কেন এই proxy দরকার: আগে AppLiveTVChannelsView সরাসরি upstream IPTV URL বা
# /media/hls/... path হ্যান্ড আউট করত — subscriber inactive/expired হয়ে গেলেও
# আগে থেকে জানা সেই URL চিরকাল কাজ করত (login/payment bypass)। এখন channel
# list শুধু এই proxy URL দেয় (token ছাড়া — 45s shared cache-এ subscriber-token
# leak এড়াতে), আর প্রতিটা manifest/segment fetch-এ subscriber token re-verify
# হয় — deactivate/expire করলে পরের request-এই বন্ধ হয়ে যাবে।
def _livetv_mirror_ready(channel):
    """playlist file সদ্য (৩০s-এর মধ্যে) আপডেট হচ্ছে কিনা — DB status নয়, এটাই আসল
    'ready' সংকেত (relay মরে গিয়ে stale হলে serve না করে lazy-start করবে)।"""
    import os
    import time
    pl = channel.hls_playlist_path
    try:
        return os.path.isfile(pl) and (time.time() - os.path.getmtime(pl)) < 30
    except OSError:
        return False


class AppLiveTVStreamProxyView(APIView):
    """GET /api/v1/app/livetv/stream/<channel_id>/[?url=<sub-resource>|&backup=<idx>][&token=<jwt>]
    Authorization: Bearer <token> header অথবা ?token= query param — দুটোই সাপোর্টেড
    (native HLS player headers সব segment request-এ propagate নাও করতে পারে)।
    """
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    # কতক্ষণ viewer ছাড়া relay চালু থাকবে idle অবস্থায় — livetv.tasks.sweep_idle_url_relays
    # এই cache key-ই চেক করে বন্ধ করে দেয় (bandwidth/CPU বাঁচাতে সব চ্যানেল সবসময় চালু রাখা যাবে না)।
    # কতক্ষণ request না এলে viewer "চলে গেছে" ধরা হবে। আগে ১৮০s ছিল — কিন্তু player
    # সাময়িক stall/buffering-এ কয়েক মিনিট segment fetch না করলেও viewer আসলে দেখছে;
    # তখন idle-sweep relay বন্ধ করে দিত → "Stream Unavailable"। ১০ মিনিট দিলে stall
    # থেকে recover (বা user Retry) করার সময় relay জীবিত থাকে, তবু পরিত্যক্ত relay
    # ১০-১২ মিনিটে পরিষ্কার হয়।
    VIEWER_PING_TTL = 600  # 10 minutes
    _START_LOCK_TTL = 20   # duplicate lazy-start রোধ করতে সংক্ষিপ্ত lock

    def get(self, request, channel_id):
        from django.core.cache import cache
        from django.http import HttpResponse, HttpResponseNotFound
        from livetv.models import TVChannel
        from livetv.api.auth_views import verify_livetv_token_verbose, REASON_MESSAGES

        sub, reason = verify_livetv_token_verbose(request)
        if not sub:
            return Response(
                {'detail': REASON_MESSAGES.get(reason, REASON_MESSAGES['missing']), 'auth_required': True},
                status=401,
            )

        channel = TVChannel.objects.filter(pk=channel_id, is_active=True).first()
        if not channel:
            return HttpResponseNotFound('চ্যানেল পাওয়া যায়নি বা বন্ধ আছে।')

        token = request.query_params.get('token') or (request.headers.get('Authorization', '')[7:] or None)
        proxy_base = request.build_absolute_uri(
            f'/api/v1/app/livetv/stream/{channel_id}/?token={token}&url='
        )
        url_param = request.query_params.get('url')

        if channel.input_type != 'url':
            # হার্ডওয়্যার (v4l2/dvb) চ্যানেল — সবসময় local FFmpeg output থেকে সরাসরি serve
            return self._serve_local(channel, url_param, proxy_base)

        # ── URL/IPTV চ্যানেল — সবসময় shared local mirror দিয়ে serve করা হয় (clean muxed
        # h264+aac local mirror; upstream 302/proxy নয় — flaky segment/AV-split এড়াতে)। ──
        cache.set(f'livetv_viewer_ping_{channel.id}', True, timeout=self.VIEWER_PING_TTL)

        if channel.direct_relay:
            # সরাসরি সোর্স মোড — কোনো local FFmpeg mirror নেই, শুধু upstream-কে
            # লাইভ HTTP proxy করে দেওয়া হয় (RAM/CPU-তে ffmpeg cost নেই)।
            return self._serve_direct(channel, url_param, proxy_base, request)

        # Adjacent pre-warm: user Prev/Next দিয়ে surf করে — আশেপাশের চ্যানেল background-এ
        # আগেভাগে warm করি (শুধু manifest request-এ, প্রতি চ্যানেলে ৪৫s-এ একবার)।
        if url_param is None and cache.add(f'livetv_prewarm_{channel.id}', True, timeout=45):
            self._prewarm_neighbors(channel)

        if _livetv_mirror_ready(channel):
            return self._serve_local(channel, url_param, proxy_base)

        # mirror চালু নেই — lazy-start + প্রথম segment পর্যন্ত অল্প অপেক্ষা
        self._maybe_start_relay(channel, cache)
        served = self._wait_for_mirror(channel, url_param, proxy_base)
        if served is not None:
            return served

        # এখনো mirror প্রস্তুত নয় → 503, player Retry-After মেনে একটু পরে refetch করবে।
        resp = HttpResponse('স্ট্রিম চালু হচ্ছে, একটু পরে আবার চেষ্টা হবে…', status=503)
        resp['Retry-After'] = '3'
        return resp

    def _maybe_start_relay(self, channel, cache):
        """mirror চালু নেই — celery task দিয়ে relay lazy-start (duplicate-start guard সহ)।
        আগে django-app-এর নিজের thread-এ ffmpeg spawn হতো — django-app-এর নিজস্ব memory
        budget-এ (admin panel/billing serve করার budget) ffmpeg জমে OOM crash-loop করত
        (২০২৬-০৭-০৯ ইনসিডেন্ট)। এখন celery-worker-এর আলাদা budget-এ dispatch করা হয়।"""
        from livetv.tasks import start_channel_relay
        lock_key = f'livetv_relay_starting_{channel.id}'
        if channel.status != 'starting' and cache.add(lock_key, True, timeout=self._START_LOCK_TTL):
            start_channel_relay.delay(channel.id)

    def _wait_for_mirror(self, channel, url_param, proxy_base):
        """manifest request হলে প্রথম segment তৈরি হওয়া পর্যন্ত (≤10s) অপেক্ষা করে local
        mirror serve করে — প্রস্তুত না হলে None (caller 503 দেয়)।"""
        import time
        if not url_param:
            deadline = time.monotonic() + 10.0
            while time.monotonic() < deadline:
                time.sleep(0.5)
                if _livetv_mirror_ready(channel):
                    return self._serve_local(channel, None, proxy_base)
        return None

    # app-এর list order-এ current চ্যানেলের ঠিক আগে/পরের কয়েকটা (position-ভিত্তিক, sort_order
    # value নয় — কারণ bulk-import-এ প্রায় সব চ্যানেলের sort_order=0)। PREWARM_EACH_SIDE=2
    # মানে সর্বোচ্চ ৪টা neighbor warm হবে (Prev/Next surf instant করতে)। PREWARM_PING_TTL:
    # watch ছাড়া কতক্ষণ টিকবে — surf-এর মতো যথেষ্ট, কিন্তু বেশি নয় (resource বাঁচাতে)।
    PREWARM_EACH_SIDE = 2
    PREWARM_PING_TTL = 200  # ~3.5 min

    def _prewarm_one_neighbor(self, ch, cache):
        """একটি neighbor channel warm করে — ইতিমধ্যে warm হলে শুধু ping refresh,
        নাহলে lazy-start (duplicate-start guard সহ)।"""
        import os
        import time
        from livetv.tasks import start_channel_relay
        if ch.direct_relay:
            return  # direct mode-এ warm করার কিছু নেই — প্রতি request-এ live proxy হয়
        pl = ch.hls_playlist_path
        try:
            if os.path.isfile(pl) and (time.time() - os.path.getmtime(pl)) < 30:
                cache.set(f'livetv_viewer_ping_{ch.id}', True, timeout=self.PREWARM_PING_TTL)
                return  # ইতিমধ্যে warm — শুধু ping refresh
        except OSError:
            pass
        lock = f'livetv_relay_starting_{ch.id}'
        if ch.status != 'starting' and cache.add(lock, True, timeout=self._START_LOCK_TTL):
            # celery-worker-এ dispatch — django-app-এর নিজের thread-এ ffmpeg spawn করলে
            # prewarm (একসাথে কয়েকটা neighbor) django-app-এর memory budget দ্রুত শেষ
            # করে দিতে পারত (২০২৬-০৭-০৯ ইনসিডেন্টের একটা বড় কারণ এটাই ছিল)।
            start_channel_relay.delay(ch.id)
            cache.set(f'livetv_viewer_ping_{ch.id}', True, timeout=self.PREWARM_PING_TTL)

    def _prewarm_neighbors(self, channel):
        import threading
        from django.db import close_old_connections
        from livetv.services.app_visibility import get_visible_channels

        ch_id = channel.id

        def _run():
            from django.core.cache import cache
            close_old_connections()
            try:
                # app যে ঠিক অর্ডারে চ্যানেল দেখায় (get_visible_channels) সেই list-এ current
                # চ্যানেলের index বের করে ±N position-এর neighbor নিই — এটাই app-এর Prev/Next।
                ordered = [c for c, _ in get_visible_channels()]
                idx = next((i for i, c in enumerate(ordered) if c.id == ch_id), None)
                if idx is None:
                    return
                n = self.PREWARM_EACH_SIDE
                neighbors = ordered[max(0, idx - n):idx] + ordered[idx + 1:idx + 1 + n]
                for ch in neighbors:
                    self._prewarm_one_neighbor(ch, cache)
            finally:
                close_old_connections()

        threading.Thread(target=_run, daemon=True).start()

    def _serve_direct(self, channel, url_param, proxy_base, request):
        """channel.direct_relay চালু থাকলে ব্যবহৃত — কোনো local ffmpeg mirror ছাড়াই
        সরাসরি upstream source_url থেকে live HTTP proxy করে (livetv-এর staff
        hls-proxy action-এর মতোই proxy_and_rewrite_hls ব্যবহার করে, subprocess নেই)।
        """
        import urllib.parse as _urlparse
        from django.http import HttpResponseBadRequest
        from livetv.services.hls_proxy_service import proxy_and_rewrite_hls
        from livetv.services.netloc_allowlist import get_allowed_netlocs

        target_url = url_param or channel.source_url
        # SSRF protection: url_param client-controlled, তাই শুধু channel-এর নিজের
        # source_url/extra_urls netloc allow করি (livetv hls_proxy action-এর মতোই)।
        target_netloc = _urlparse.urlparse(target_url).netloc
        if target_netloc not in get_allowed_netlocs():
            return HttpResponseBadRequest('অনুমোদিত নয়।')
        return proxy_and_rewrite_hls(target_url, proxy_base, request)

    def _serve_local(self, channel, url_param, proxy_base):
        """channel-এর নিজস্ব FFmpeg output (hls_output_dir) থেকে সরাসরি serve করে —
        হার্ডওয়্যার চ্যানেল সবসময়, URL চ্যানেল shared mirror প্রস্তুত থাকলে।
        (public /media/hls/ nginx alias আর directly hand out করা হয় না)

        .ts segment (m3u8 ছাড়া অন্য যেকোনো ফাইল) — X-Accel-Redirect দিয়ে nginx-কে
        দেওয়া হয় (`_serve_apk`-এর মতো একই pattern)। Django/gunicorn worker শুধু
        subscriber token verify করে সাথে সাথে ফিরে যায় — কোনো file read/in-memory
        buffer নেই, তাই 100+ concurrent viewer একই চ্যানেল দেখলেও Python-এর CPU/RAM-এ
        কোনো চাপ পড়ে না। আসল bytes nginx sendfile/open_file_cache দিয়ে সরাসরি সার্ভ
        করে (`/internal-hls/` location, `internal;` marked — token verify ছাড়া বাইরে
        থেকে সরাসরি hit করা যায় না, ২০২৬-০৭-১৭ তারিখে সরাসরি curl করে 404 confirm করা
        হয়েছে)।

        (২০২৬-০৭-১৭ ইতিহাস: এই optimization একবার আগে চালু করা হয়েছিল nginx config
        সঙ্গে সঙ্গে apply না হওয়ায় — Django কোড auto-reload হয়ে লাইভ হয়ে গিয়েছিল কিন্তু
        nginx-এর /internal-hls/ location তখনো ছিল না, ফলে mobile app-এ real outage
        হয়েছিল। এবার nginx config independently grep + worker-restart-timestamp দিয়ে
        confirm করার পরই এই কোড আবার চালু করা হলো — ভবিষ্যতে এই দুই পাশ একসাথে বদলাতে
        হলে সবসময় nginx আগে, verify, তারপর Django।)

        m3u8 এখনো Python-এই থাকে (এড়ানো যায় না) কারণ প্রতিটা segment line-এ subscriber
        token বসিয়ে proxy URL-এ rewrite করতে হয় — কিন্তু ফাইলটা কয়েকশ বাইট মাত্র এবং
        segment-এর তুলনায় অনেক কম ঘন ঘন fetch হয়, তাই CPU/RAM cost নগণ্য।
        """
        import os
        from urllib.parse import quote
        from django.http import HttpResponse, HttpResponseNotFound, HttpResponseBadRequest
        from livetv.services.hls_proxy_service import apply_stream_cors

        base_dir = channel.hls_output_dir
        fname = os.path.basename(url_param) if url_param else 'index.m3u8'
        path = os.path.join(base_dir, fname)
        # traversal check — resolved path base_dir-এর ভিতরেই থাকতে হবে
        if not os.path.abspath(path).startswith(os.path.abspath(base_dir) + os.sep) and fname != 'index.m3u8':
            return HttpResponseBadRequest('অবৈধ ফাইল।')
        if not os.path.isfile(path):
            return HttpResponseNotFound('স্ট্রিম এখনো প্রস্তুত নয়।')

        if fname.endswith('.m3u8'):
            with open(path, 'r') as f:
                text = f.read()
            result = []
            for line in text.splitlines():
                stripped = line.strip()
                if not stripped or stripped.startswith('#'):
                    result.append(line)
                else:
                    result.append(proxy_base + os.path.basename(stripped))
            resp = HttpResponse('\n'.join(result), content_type='application/vnd.apple.mpegurl')
        else:
            # এই পয়েন্টে subscriber token ইতিমধ্যে verify হয়ে গেছে (caller-এর get()
            # মেথডে) — auth বাইপাস হচ্ছে না, শুধু byte-serving nginx-কে অর্পণ করা হচ্ছে।
            content_type = 'video/MP2T' if fname.endswith('.ts') else 'application/octet-stream'
            resp = HttpResponse(content_type=content_type)
            resp['X-Accel-Redirect'] = f'/internal-hls/{quote(channel.slug)}/{quote(fname)}'
        apply_stream_cors(resp, getattr(self, 'request', None))
        resp['Cache-Control'] = 'no-cache, no-store'
        return resp


# ── App APK dynamic download ────────────────────────────────────────────────
# public_apk/ ফোল্ডারের সবচেয়ে নতুন .apk (যে নামেই হোক) serve করে।
# X-Accel-Redirect → আসল ফাইল bytes nginx পাঠায় (gunicorn worker আটকায় না,
# তাই 85MB+ ফাইলেও timeout হয় না)। নতুন version দিলে শুধু ফোল্ডারে .apk রাখুন।
def _serve_apk(apk_dir, prefix, fallback_all=False):
    import os, glob
    from urllib.parse import quote
    from django.http import HttpResponse
    apks = glob.glob(os.path.join(apk_dir, f'{prefix}*.apk'))
    if not apks and fallback_all:
        apks = glob.glob(os.path.join(apk_dir, '*.apk'))
    if not apks:
        return HttpResponse('APK এখনো পাওয়া যায়নি।', status=404)
    latest = max(apks, key=os.path.getmtime)
    fname = os.path.basename(latest)
    resp = HttpResponse()
    resp['Content-Type'] = 'application/vnd.android.package-archive'
    resp['Content-Disposition'] = f'attachment; filename="{fname}"'
    resp['Cache-Control'] = 'no-cache'
    resp['X-Accel-Redirect'] = '/protected-apk/' + quote(fname)
    return resp


@require_GET
def app_apk_download(request):
    from django.conf import settings
    import os
    apk_dir = os.path.join(str(settings.BASE_DIR), 'mobile_app', 'public_apk')
    return _serve_apk(apk_dir, 'rajamehar-online')


@require_GET
def livetv_apk_download(request):
    from django.conf import settings
    import os
    apk_dir = os.path.join(str(settings.BASE_DIR), 'mobile_app', 'public_apk')
    return _serve_apk(apk_dir, 'rajamehar-livetv')
