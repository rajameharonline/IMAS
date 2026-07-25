from rest_framework import viewsets, permissions, parsers, status
from rest_framework.decorators import action
from rest_framework.response import Response
from system_settings.models import (
    CompanySetup, InvoiceSetup, SystemSetting, ActivityLog, PaymentGatewayConfig,
    AutomaticProcess, MobileAppConfig, AppBanner,
)
from system_settings.api.serializers import (
    CompanySetupSerializer, InvoiceSetupSerializer,
    SystemSettingSerializer, ActivityLogSerializer, PaymentGatewayConfigSerializer,
    AutomaticProcessSerializer, MobileAppConfigSerializer, AppBannerSerializer,
)



# পুনরাবৃত্ত literal — S1192 এড়াতে module constant
_DEFAULT_COMPANY = 'ISP Company'

class CompanySetupViewSet(viewsets.ModelViewSet):
    queryset = CompanySetup.objects.all()
    serializer_class = CompanySetupSerializer
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [parsers.MultiPartParser, parsers.FormParser, parsers.JSONParser]

    @action(detail=False, methods=['get', 'patch', 'put'], url_path='current')
    def current(self, request):
        obj, _ = CompanySetup.objects.get_or_create(
            id=1,
            defaults={'name': _DEFAULT_COMPANY},
        )
        if request.method in ('PATCH', 'PUT'):
            partial = request.method == 'PATCH'
            ser = self.get_serializer(obj, data=request.data, partial=partial)
            ser.is_valid(raise_exception=True)
            ser.save()
            return Response(ser.data)
        return Response(self.get_serializer(obj).data)

    @action(detail=False, methods=['get'], url_path='public',
            permission_classes=[permissions.AllowAny])
    def public(self, request):
        obj, _ = CompanySetup.objects.get_or_create(
            id=1, defaults={'name': _DEFAULT_COMPANY},
        )
        logo_url = ''
        if obj.logo:
            logo_url = request.build_absolute_uri(obj.logo.url)
        return Response({'name': obj.name, 'logo_url': logo_url})

    @action(detail=False, methods=['get'], url_path='next-customer-id')
    def next_customer_id(self, request):
        """পরবর্তী নতুন Client-এর Customer ID preview করে (save করে না)"""
        from clients.models import Client
        obj, _ = CompanySetup.objects.get_or_create(
            id=1, defaults={'name': _DEFAULT_COMPANY}
        )
        digits    = max(1, min(20, obj.customer_id_digits or 5))
        start_num = max(1, obj.customer_id_start_number or 1)

        # শুধু pure-numeric customer_id-গুলো বিবেচনায় নাও
        last = (
            Client.objects.filter(customer_id__regex=r'^\d+$')
            .order_by('-customer_id')
            .values_list('customer_id', flat=True)
            .first()
        )
        try:
            last_num = int(last) if last else 0
        except (TypeError, ValueError):
            last_num = 0
        next_num = max(last_num + 1, start_num)
        fmt = f"{{:0{digits}d}}"
        while Client.objects.filter(customer_id=fmt.format(next_num)).exists():
            next_num += 1
        return Response({'next_customer_id': fmt.format(next_num)})


class InvoiceSetupViewSet(viewsets.ModelViewSet):
    queryset = InvoiceSetup.objects.all()
    serializer_class = InvoiceSetupSerializer
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=['get', 'patch', 'put'], url_path='current')
    def current(self, request):
        obj, _ = InvoiceSetup.objects.get_or_create(
            id=1,
            defaults={
                'prefix': 'INV',
                'start_number': 1000,
                'header_color': '#DC5014',
                'note_text': "This is a computerized Invoice and doesn't need any signature.",
                'show_logo': True,
            },
        )
        if request.method in ('PATCH', 'PUT'):
            partial = request.method == 'PATCH'
            ser = self.get_serializer(obj, data=request.data, partial=partial)
            ser.is_valid(raise_exception=True)
            ser.save()
            return Response(ser.data)
        return Response(self.get_serializer(obj).data)


class SystemSettingViewSet(viewsets.ModelViewSet):
    queryset = SystemSetting.objects.all()
    serializer_class = SystemSettingSerializer
    permission_classes = [permissions.IsAuthenticated]


class ActivityLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ActivityLog.objects.all()
    serializer_class = ActivityLogSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['user', 'model_name']


# AutomaticProcess default data (schedule_cron: "minute hour day_of_month month day_of_week")
_PROCESS_DEFAULTS = {
    'auto_bill':         {'schedule_cron': '0 0 1 * *',   'is_enabled': True},   # মাসের ১ তারিখ মধ্যরাতে
    'expire_disable':    {'schedule_cron': '5 0 * * *',   'is_enabled': True},
    'sms_due':           {'schedule_cron': '0 * * * *',   'is_enabled': False},  # প্রতি ঘণ্টায়
    'router_backup':     {'schedule_cron': '0 2 * * *',   'is_enabled': False},
    'daily_close':       {'schedule_cron': '0 23 * * *',  'is_enabled': False},
    'radacct_aggregate': {'schedule_cron': '0 1 * * *',   'is_enabled': True},
    'radacct_purge':     {'schedule_cron': '0 2 * * *',   'is_enabled': True},
    'olt_mac_sync':      {'schedule_cron': '*/5 * * * *', 'is_enabled': True},
    'olt_link_onu':      {'schedule_cron': '*/15 * * * *','is_enabled': True},
    'voip_schedule':     {'schedule_cron': '0 10 * * *',  'is_enabled': True},
    'mikrotik_sync':     {'schedule_cron': '*/5 * * * *', 'is_enabled': True},
}

# Celery task name mapping — process_type → registered Celery task name।
_TASK_NAMES = {
    'auto_bill':         'billing.auto_generate_monthly_bills',
    'expire_disable':    'billing.disable_expired_clients',
    'sms_due':           'billing.process_payment_reminders',
    'router_backup':     'mikrotik.router_backup',
    'radacct_aggregate': 'billing.aggregate_radacct_to_monthly_traffic',
    'radacct_purge':     'billing.purge_old_radacct_sessions',
    'olt_mac_sync':      'olt_mgmt.sync_all_olts_mac_table',
    'olt_link_onu':      'olt_mgmt.link_onu_clients',
    'voip_schedule':     'voip.run_voice_call_schedules',
    'mikrotik_sync':     'mikrotik.sync_active_users',
}

def _parse_cron(cron_str):
    """5-field cron string → dict (minute, hour, day_of_month, month_of_year, day_of_week)"""
    parts = (cron_str or '0 0 * * *').split()
    while len(parts) < 5:
        parts.append('*')
    return {
        'minute':        parts[0],
        'hour':          parts[1],
        'day_of_month':  parts[2],
        'month_of_year': parts[3],
        'day_of_week':   parts[4],
    }


def _sync_celery_beat(proc):
    """AutomaticProcess → django_celery_beat PeriodicTask sync।
    সব task-এ full CrontabSchedule set করে (interval task হলেও crontab-এ convert করে)।
    PeriodicTask না থাকলে create করে।"""
    task_name = _TASK_NAMES.get(proc.process_type)
    if not task_name:
        return
    try:
        from django_celery_beat.models import PeriodicTask, CrontabSchedule
        p = _parse_cron(proc.schedule_cron)
        cron, _ = CrontabSchedule.objects.get_or_create(
            minute=p['minute'], hour=p['hour'],
            day_of_week=p['day_of_week'], day_of_month=p['day_of_month'],
            month_of_year=p['month_of_year'],
            defaults={'timezone': 'Asia/Dhaka'},
        )
        qs = PeriodicTask.objects.filter(task=task_name)
        if qs.exists():
            # interval → crontab convert: interval field সরিয়ে crontab set করো
            qs.update(crontab=cron, interval=None, enabled=proc.is_enabled)
        else:
            PeriodicTask.objects.create(
                name=task_name, task=task_name,
                crontab=cron, enabled=proc.is_enabled,
            )
    except Exception:
        pass


def _interval_to_minutes(iv):
    """PeriodicTask interval → minutes (schedule_cron */N-এর জন্য)। না-mappable হলে None।"""
    if iv.period == 'seconds' and iv.every >= 60:
        return iv.every // 60
    if iv.period == 'minutes':
        return iv.every
    if iv.period == 'hours':
        return iv.every * 60
    return None


def _periodic_cron_string(pt):
    """PeriodicTask → 5-field cron string। crontab হলে full cron, interval হলে
    */N * * * *; কোনোটাই না মিললে None।"""
    if pt.crontab:
        c = pt.crontab
        return f'{c.minute} {c.hour} {c.day_of_month} {c.month_of_year} {c.day_of_week}'
    if pt.interval:
        mins = _interval_to_minutes(pt.interval)
        if mins:
            return f'*/{mins} * * * *'
    return None


def _sync_proc_from_task(proc, pt):
    """একটি AutomaticProcess-কে তার mapped PeriodicTask-এর enabled+schedule দিয়ে sync করে।"""
    changed = []
    if proc.is_enabled != pt.enabled:
        proc.is_enabled = pt.enabled
        changed.append('is_enabled')
    cron = _periodic_cron_string(pt)
    if cron and proc.schedule_cron != cron:
        proc.schedule_cron = cron
        changed.append('schedule_cron')
    if changed:
        proc.save(update_fields=changed + ['updated_at'])


class PaymentGatewayConfigViewSet(viewsets.ModelViewSet):
    queryset = PaymentGatewayConfig.objects.all()
    serializer_class = PaymentGatewayConfigSerializer
    permission_classes = [permissions.IsAuthenticated]

    # ১৪টি gateway-এর default data
    _ALL_GATEWAYS = [
        'sslcommerz', 'bkash', 'nagad', 'aamarpay', 'shurjopay',
        'fosterpayments', 'walletmix', 'phonepe', 'razorpay',
        'rocket', 'stripe', 'easypayment', 'webhook', 'paybill',
    ]

    @action(detail=False, methods=['get'], url_path='all')
    def get_all(self, request):
        """সব ১৪টি gateway ensure করে list return করে"""
        import datetime
        for gw in self._ALL_GATEWAYS:
            PaymentGatewayConfig.objects.get_or_create(
                gateway=gw,
                defaults={
                    'gateway_type': 'platform_connector',
                    'is_active': False,
                    'activation_date': datetime.date.today(),
                }
            )
        gateways = PaymentGatewayConfig.objects.filter(
            gateway__in=self._ALL_GATEWAYS
        ).order_by('gateway')
        # নির্দিষ্ট order বজায় রাখা
        order_map = {gw: i for i, gw in enumerate(self._ALL_GATEWAYS)}
        sorted_gateways = sorted(gateways, key=lambda g: order_map.get(g.gateway, 99))
        return Response(
            PaymentGatewayConfigSerializer(sorted_gateways, many=True, context={'request': request}).data
        )

    @action(detail=False, methods=['patch'], url_path='by-gateway')
    def update_by_gateway(self, request):
        """gateway name দিয়ে update করা"""
        gateway_key = request.data.get('gateway')
        if not gateway_key:
            return Response({'error': 'gateway field প্রয়োজন।'}, status=status.HTTP_400_BAD_REQUEST)
        obj, _ = PaymentGatewayConfig.objects.get_or_create(gateway=gateway_key)
        ser = PaymentGatewayConfigSerializer(obj, data=request.data, partial=True, context={'request': request})
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)


class AutomaticProcessViewSet(viewsets.ModelViewSet):
    queryset = AutomaticProcess.objects.all()
    serializer_class = AutomaticProcessSerializer
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=['get'], url_path='all')
    def get_all(self, request):
        """সব process ensure করে return করে। mapped task-এর জন্য is_enabled ও
        schedule আসল PeriodicTask থেকে sync করে — পেজ বাস্তব অবস্থা দেখায়।"""
        for pt, defaults in _PROCESS_DEFAULTS.items():
            AutomaticProcess.objects.get_or_create(
                process_type=pt, defaults=defaults,
            )
        procs = list(AutomaticProcess.objects.all().order_by('process_type'))
        self._sync_state_from_beat(procs)
        return Response(AutomaticProcessSerializer(procs, many=True).data)

    def _sync_state_from_beat(self, procs):
        # mapped PeriodicTask-এর enabled ও crontab/interval থেকে AutomaticProcess আপডেট —
        # যাতে পেজ Celery-র আসল চলমান অবস্থা দেখায় (display source of truth = beat)।
        try:
            from django_celery_beat.models import PeriodicTask
            by_task = {t.task: t for t in PeriodicTask.objects.select_related('crontab', 'interval')}
        except Exception:
            return
        for proc in procs:
            task_name = _TASK_NAMES.get(proc.process_type)
            pt = by_task.get(task_name) if task_name else None
            if pt:
                _sync_proc_from_task(proc, pt)

    @action(detail=True, methods=['patch'], url_path='set-schedule')
    def set_schedule(self, request, pk=None):
        """schedule cron আপডেট + Celery Beat sync।
        freq_type: 'daily' | 'weekly' | 'monthly' | 'interval'
        day_of_week: 0–6 (weekly; 0=রবিবার)
        day_of_month: 1–31 (monthly)
        interval_minutes: int (interval; যেমন 5 → */5 * * * *)"""
        proc = self.get_object()
        hour             = int(request.data.get('hour', 0))
        minute           = int(request.data.get('minute', 0))
        enabled          = request.data.get('is_enabled', proc.is_enabled)
        freq_type        = request.data.get('freq_type', 'daily')
        day_of_week      = str(request.data.get('day_of_week', '*'))
        day_of_month     = str(request.data.get('day_of_month', '*'))
        interval_minutes = int(request.data.get('interval_minutes', 5))
        if isinstance(enabled, str):
            enabled = enabled.lower() in ('true', '1', 'yes')

        if freq_type == 'interval':
            cron = f'*/{max(1, interval_minutes)} * * * *'
        elif freq_type == 'weekly':
            cron = f'{minute} {hour} * * {day_of_week}'
        elif freq_type == 'monthly':
            cron = f'{minute} {hour} {day_of_month} * *'
        else:
            cron = f'{minute} {hour} * * *'

        proc.schedule_cron = cron
        proc.is_enabled = enabled
        proc.save(update_fields=['schedule_cron', 'is_enabled', 'updated_at'])
        _sync_celery_beat(proc)
        return Response(AutomaticProcessSerializer(proc).data)

    @action(detail=True, methods=['patch'], url_path='set-enabled')
    def set_enabled(self, request, pk=None):
        """শুধু enable/disable টগল (toggle-only interval/hourly task-এর জন্য) —
        schedule/crontab অপরিবর্তিত রেখে শুধু on/off।"""
        proc = self.get_object()
        enabled = request.data.get('is_enabled', proc.is_enabled)
        if isinstance(enabled, str):
            enabled = enabled.lower() in ('true', '1', 'yes')
        proc.is_enabled = enabled
        proc.save(update_fields=['is_enabled', 'updated_at'])
        _sync_celery_beat(proc)
        return Response(AutomaticProcessSerializer(proc).data)


class MobileAppConfigViewSet(viewsets.ModelViewSet):
    # Mobile App version control ও maintenance mode
    serializer_class   = MobileAppConfigSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return MobileAppConfig.objects.all()

    @action(detail=False, methods=['get', 'patch'], url_path='current')
    def current(self, request):
        # সিঙ্গেলটন config — pk=1 সবসময় get_or_create
        config = MobileAppConfig.get_config()
        if request.method == 'PATCH':
            serializer = MobileAppConfigSerializer(config, data=request.data, partial=True)
            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data)
            return Response(serializer.errors, status=400)
        return Response(MobileAppConfigSerializer(config).data)


class AppBannerViewSet(viewsets.ModelViewSet):
    # Mobile App banner management
    queryset           = AppBanner.objects.all().order_by('-priority', '-created_at')
    serializer_class   = AppBannerSerializer
    permission_classes = [permissions.IsAuthenticated]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)
