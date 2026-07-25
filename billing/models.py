# এই ফাইলটি বিলিং, পেমেন্ট, ইনভয়েস ও বকেয়া হিসাব পরিচালনার জন্য।
from django.db import models
from django.conf import settings



# পুনরাবৃত্ত literal — S1192 এড়াতে module constant
_CLIENT_MODEL = 'clients.Client'

class Bill(models.Model):
    # মাসিক বিল - auto-generate অথবা manual তৈরি হয়।
    # is_auto=True  → স্বয়ংক্রিয় (expiry/disable থেকে): মাসে একটিমাত্র
    # is_auto=False → ম্যানুয়াল (admin/collector): একই মাসে যত খুশি তৈরি যাবে
    STATUS_CHOICES = [
        ('unpaid', 'Unpaid'), ('paid', 'Paid'),
        ('partial', 'Partial'), ('waived', 'Waived'),
    ]
    client = models.ForeignKey(_CLIENT_MODEL, on_delete=models.CASCADE, related_name='bills')
    bill_month = models.CharField(max_length=7)  # format: YYYY-MM
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    discount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    net_amount = models.DecimalField(max_digits=10, decimal_places=2)
    paid_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    due_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='unpaid')
    due_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    # Auto vs Manual flag
    is_auto = models.BooleanField(
        default=True,
        db_index=True,
        help_text='True = স্বয়ংক্রিয় (expiry/disable), False = ম্যানুয়াল (admin)',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'bills'
        # Auto bill: মাসে একটিমাত্র (unique_together সরিয়ে conditional constraint দেওয়া হয়েছে)
        constraints = [
            models.UniqueConstraint(
                fields=['client', 'bill_month'],
                condition=models.Q(is_auto=True),
                name='unique_auto_bill_per_client_month',
            )
        ]
        ordering = ['-bill_month', '-id']

    def __str__(self):
        tag = 'Auto' if self.is_auto else 'Manual'
        return f"{self.client} - {self.bill_month} [{tag}] - {self.net_amount}৳"


class Payment(models.Model):
    # পেমেন্ট ট্রানজেকশন রেকর্ড
    PAYMENT_METHOD_CHOICES = [
        ('cash',       'Cash'),
        ('bkash',      'bKash'),
        ('nagad',      'Nagad'),
        ('rocket',     'Rocket'),
        ('bank',       'Bank Transfer'),
        ('sslcommerz', 'SSLCommerz'),
        ('advance',    'Advance Balance'),   # advance_balance থেকে auto-apply হলে
        ('other',      'Other'),
    ]
    # null=True: pure advance receipt-এ কোনো bill নাও থাকতে পারে
    bill = models.ForeignKey(
        Bill, on_delete=models.CASCADE, related_name='payments',
        null=True, blank=True,
    )
    # সরাসরি client link — advance payment-এও Bill History-তে দেখানোর জন্য
    client = models.ForeignKey(
        _CLIENT_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='direct_payments',
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES, default='cash')
    transaction_id = models.CharField(max_length=100, blank=True)
    payment_date = models.DateTimeField(auto_now_add=True)
    received_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                    null=True, related_name='received_payments')
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                    null=True, blank=True, related_name='approved_payments')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                  null=True, blank=True, related_name='created_payments')
    notes = models.TextField(blank=True)
    is_verified = models.BooleanField(default=True)

    class Meta:
        db_table = 'payments'
        ordering = ['-payment_date']

    @staticmethod
    def recalculate_bill_and_client(bill):
        # শুধুমাত্র অনুমোদিত (is_verified=True) পেমেন্টগুলো bill-এ count হবে
        if bill is None:
            return
        total_paid = bill.payments.filter(is_verified=True).aggregate(
            total=models.Sum('amount'))['total'] or 0
        bill.paid_amount = total_paid
        bill.due_amount = max(bill.net_amount - total_paid, 0)
        if bill.due_amount <= 0:
            bill.status = 'paid'
            bill.due_amount = 0
        elif bill.paid_amount > 0:
            bill.status = 'partial'
        else:
            bill.status = 'unpaid'
        bill.save(update_fields=['paid_amount', 'due_amount', 'status'])

        # client-এর মোট due_amount = তার সব bill-এর due_amount-এর সমষ্টি
        recalc_client_due_amount(bill.client)

    def save(self, *args, **kwargs):
        # skip_auto_process=True হলে auto-recalculate/enable/log চলবে না।
        # BillingService.receive_payment() এটা ব্যবহার করে — নিজেই batch-এ recalculate করে।
        skip_auto_process = kwargs.pop('skip_auto_process', False)

        is_new = self.pk is None
        just_verified = False
        amount_changed = False
        old = None

        # পুরনো record চেক করি — unverified → verified transition হচ্ছে কিনা,
        # অথবা already-verified payment-এর amount edit হচ্ছে কিনা
        if not is_new:
            try:
                old = Payment.objects.get(pk=self.pk)
                just_verified = (not old.is_verified) and self.is_verified
                amount_changed = old.amount != self.amount
            except Payment.DoesNotExist:
                pass

        super().save(*args, **kwargs)

        if skip_auto_process:
            return  # caller নিজেই সব handle করবে

        # bill না থাকলে (pure advance receipt) auto-process স্কিপ
        if not self.bill_id:
            return

        if is_new:
            self._process_new_payment()
        elif just_verified:
            self._process_just_verified_payment()
        elif amount_changed and self.is_verified:
            # already-verified payment-এর amount admin correct করেছে — is_new/
            # just_verified কোনোটাই True না বলে আগে recalculate_bill_and_client
            # কখনো re-run হতো না, bill/client due_amount পুরনো (ভুল) amount-এই
            # চিরস্থায়ীভাবে থেকে যেত।
            self._process_amount_correction(old.amount if old else None)

    def _process_amount_correction(self, old_amount):
        """Already-verified payment-এর amount edit হলে bill/client due_amount
        recalculate করে (auto-enable/collector-cash re-trigger করে না — সেগুলো
        শুধু নতুন/just-verified payment-এর জন্য প্রযোজ্য)।"""
        self.recalculate_bill_and_client(self.bill)
        try:
            from clients.activity import log_client_activity
            log_client_activity(
                self.bill.client, 'payment_amount_corrected',
                title=f'পেমেন্ট Amount সংশোধন — {self.bill.bill_month}',
                description=f'৳{old_amount} → ৳{self.amount} (bill/client due_amount recalculate হয়েছে)',
                amount=self.amount,
            )
        except Exception:
            pass

    def _process_new_payment(self):
        """নতুন payment auto-process — verified হলে recalc+enable, unverified হলে
        expiry update + collector cash; সবসময় activity log।"""
        if self.is_verified:
            # সরাসরি verified payment → bill recalculate + client auto-enable
            self.recalculate_bill_and_client(self.bill)
            _auto_enable_client_if_paid(self.bill.client, self.payment_date)
        else:
            # Unverified (collector রিসিভ করেছে) → শুধু expiry update ও RADIUS enable
            # bill-এর paid_amount/due_amount/status এখনই পরিবর্তন হবে না
            _update_expiry_and_enable_for_unverified(self.bill.client, self.payment_date, self.amount)
            # Collector-এর cash-in-hand বাড়াও
            _update_collector_cash(self.received_by, self.amount, 'collected',
                                   self.id, self.bill.client.full_name if self.bill else '')

        # Activity log সবসময় তৈরি হবে
        self._log_payment_received()

    def _log_payment_received(self):
        """নতুন payment গ্রহণের activity log (collector নাম notes/received_by থেকে)।"""
        try:
            import re as _re
            from clients.activity import log_client_activity
            # notes-এ [গৃহীত: Name] থাকলে সেই employee নাম ব্যবহার করো
            _m = _re.match(r'^\[গৃহীত: (.+?)\]', self.notes or '')
            if _m:
                _collector = _m.group(1)
            elif self.received_by:
                _collector = self.received_by.full_name or self.received_by.username
            else:
                _collector = 'System'
            log_client_activity(
                self.bill.client, 'payment_received',
                title=f'পেমেন্ট গ্রহণ — {self.bill.bill_month}',
                description=(
                    f'Collector: {_collector} | '
                    f'Method: {self.get_payment_method_display()} | '
                    f'TxnID: {self.transaction_id or "N/A"} | '
                    f'Status: {"Verified" if self.is_verified else "Pending Approval"}'
                ),
                amount=self.amount,
                performed_by=_collector,
                user=self.received_by,
            )
        except Exception:
            pass

    def _process_just_verified_payment(self):
        """Admin approve করেছে → bill recalculate + auto-enable + collector cash কমানো + log।"""
        self.recalculate_bill_and_client(self.bill)
        _auto_enable_client_if_paid(self.bill.client, self.payment_date)
        # Collector-এর cash-in-hand কমাও (approve = টাকা জমা দিয়েছে)
        _update_collector_cash(self.received_by, self.amount, 'approved',
                               self.id, self.bill.client.full_name if self.bill else '')
        self._log_payment_approved()

    def _log_payment_approved(self):
        """payment approve-এর activity log।"""
        try:
            from clients.activity import log_client_activity
            log_client_activity(
                self.bill.client, 'payment_approved',
                title=f'পেমেন্ট অনুমোদিত — {self.bill.bill_month}',
                description=(
                    f'Amount: {self.amount}৳ | '
                    f'Method: {self.get_payment_method_display()} | '
                    f'Approved by: {self.approved_by.full_name or self.approved_by.username if self.approved_by else "Admin"}'
                ),
                amount=self.amount,
                performed_by=(
                    (self.approved_by.full_name or self.approved_by.username)
                    if self.approved_by else 'Admin'
                ),
                user=self.approved_by,
            )
        except Exception:
            pass

    def delete(self, *args, **kwargs):
        bill = self.bill  # cascade হওয়ার আগে রেফারেন্স রাখো
        result = super().delete(*args, **kwargs)
        if bill:
            self.recalculate_bill_and_client(bill)
        return result


def recalc_client_due_amount(client):
    """client-এর সব bill-এর due_amount যোগ করে client.due_amount আপডেট করে।

    আগে এই ৩ লাইন billing/models.py, billing/services.py, billing/api/views.py
    মিলিয়ে ৮ জায়গায় হাতে-লেখা ছিল — future-এ formula বদলাতে হলে (যেমন waived
    bill exclude করা) সব জায়গায় আলাদাভাবে edit করতে হতো, একটা জায়গা miss হলে
    client.due_amount silently ভুল থেকে যেত। এখন এই একটাই helper সব জায়গা থেকে
    কল হয়।
    """
    from django.db.models import Sum as _Sum
    from decimal import Decimal as _Decimal
    total_due = client.bills.aggregate(total=_Sum('due_amount'))['total'] or _Decimal('0')
    client.due_amount = total_due
    client.save(update_fields=['due_amount'])
    return total_due


def _update_collector_cash(user, amount, txn_type, payment_id, client_name=''):
    """Collector-এর cash-in-hand balance আপডেট করে।"""
    if not user:
        return
    try:
        from hr.models import Employee, CollectorCashBalance, CollectorCashTransaction
        emp = Employee.objects.filter(user=user).first()
        if not emp:
            return
        balance, _ = CollectorCashBalance.objects.get_or_create(employee=emp)
        amount = abs(amount)
        if txn_type == 'collected':
            balance.cash_in_hand   = balance.cash_in_hand + amount
            balance.total_collected = balance.total_collected + amount
        elif txn_type == 'approved':
            balance.cash_in_hand   = max(balance.cash_in_hand - amount, 0)
            balance.total_approved  = balance.total_approved + amount
        balance.save()
        CollectorCashTransaction.objects.create(
            employee=emp, txn_type=txn_type, amount=amount,
            payment_id=payment_id, client_name=client_name or '',
        )
    except Exception:
        pass


def _set_next_expiry(client, as_of_date=None):
    """পেমেন্ট তারিখ (as_of_date, default আজ) থেকে পরের মাসের একই দিনে expiry set করে।
    fixed expiry_day-র বদলে পেমেন্টের দিন ব্যবহার করে, এবং expiry_day-ও সেই দিনে আপডেট
    করে যাতে পরবর্তী cycle ও একই দিনে পড়ে। মাসে দিনটি না থাকলে (যেমন 31 → এপ্রিল)
    মাসের শেষ দিনে clamp হয়।"""
    import calendar as _cal
    from datetime import date as _date
    from datetime import datetime as _datetime
    from django.utils import timezone as _tz
    base = as_of_date or _tz.localdate()  # Asia/Dhaka তারিখ (now().date() UTC দেয়)
    if isinstance(base, _datetime):
        # datetime হলে Asia/Dhaka-তে রূপান্তর করে date নাও — না হলে UTC-stored
        # payment_date মধ্যরাতের কাছাকাছি দিন এক দিন পিছিয়ে যেতে পারত (off-by-one)
        if _tz.is_aware(base):
            base = _tz.localtime(base)
        base = base.date()
    if base.month == 12:
        next_year, next_month = base.year + 1, 1
    else:
        next_year, next_month = base.year, base.month + 1
    max_day = _cal.monthrange(next_year, next_month)[1]
    day = min(base.day, max_day)
    client.expiry_date = _date(next_year, next_month, day)
    client.expiry_day = base.day


def _update_expiry_and_enable_for_unverified(client, as_of_date=None, amount=None):
    """
    Collector বিল রিসিভ করলে (approval pending) শুধু expiry date আপডেট হবে
    এবং RADIUS/Mikrotik enable হবে। Bill-এর paid_amount/due_amount পরিবর্তন হবে না।
    as_of_date = পেমেন্টের তারিখ; expiry এই তারিখ থেকে পরের মাসের একই দিনে set হয়।
    amount = পেমেন্ট amount (optional, backward-compatible) — client-এর বর্তমান
    due_amount কভার না করলে (token/আংশিক payment) expiry extend করা হয় না, শুধু
    courtesy RADIUS/Mikrotik enable হয়। নইলে ১০ টাকা token payment-এও পুরো এক
    মাস expiry "কেনা" যেত, admin approve করার আগেই।
    """
    from decimal import Decimal
    ACTIVATE_STATUSES = ('inactive', 'suspended', 'expired')

    # amount client-এর বর্তমান due_amount-এর কমপক্ষে সমান হলেই full-cycle expiry
    # extend করি — নইলে শুধু temporary enable (নিচে), expiry অপরিবর্তিত থাকে।
    sufficient_for_extension = amount is None or Decimal(str(amount)) >= (client.due_amount or Decimal('0'))

    # expiry_date আপডেট — পেমেন্ট তারিখ থেকে পরের মাসের একই দিন (শুধু sufficient হলে)
    if sufficient_for_extension:
        _set_next_expiry(client, as_of_date)

    # RADIUS enable + Blocked_Group থেকে আসল package group-এ ফেরানো
    # radius_enabled ট্র্যাক করি — fail করলে নিচে status='active' সেট হবে না
    # (client-এর আসলে network access নেই, status মিথ্যা "active" দেখানো ঠিক না)।
    radius_enabled = False
    try:
        from radius_app.services.radius_service import RadiusService
        svc = RadiusService.for_client(client)
        svc.enable_user(client.username)
        original_group = (client.package.mikrotik_profile
                          if client.package and client.package.mikrotik_profile else '')
        if original_group:
            svc.restore_user_group(client.username, original_group)
        radius_enabled = True
    except Exception as e:
        import logging
        logging.getLogger(__name__).exception(
            "Unverified-payment enable-এ RADIUS enable ব্যর্থ (client=%s): %s",
            client.username, e
        )

    # Mikrotik PPPoE enable + পুরোনো session kick (best-effort)
    # profile/IP-pool শুধু PPPoE auth-এ নির্ধারিত হয় বলে expired-pool-এ আটকে থাকা live
    # session disconnect করে redial বাধ্য করি — তখনই আসল package profile/pool apply হয়।
    try:
        if client.router:
            from mikrotik_app.services.mikrotik_service import MikrotikService
            svc_mt = MikrotikService.from_server_model(client.router)
            svc_mt.enable_pppoe_user(client.username)
            svc_mt.disconnect_active_session(client.username)
    except Exception:
        pass

    # শুধুমাত্র due_amount=0 এবং RADIUS enable সফল হলে active করো
    # Collector আংশিক payment নিলে expiry extend হবে কিন্তু client enable হবে না
    client.refresh_from_db(fields=['due_amount'])
    if client.status in ACTIVATE_STATUSES and client.due_amount <= 0 and radius_enabled:
        client.status = 'active'

    client.save(update_fields=['status', 'expiry_date', 'expiry_day'])

    try:
        from clients.activity import log_client_activity
        if sufficient_for_extension:
            log_client_activity(
                client, 'expiry_extended',
                title=f'Expiry Date আপডেট (Approval Pending) — {client.expiry_date}',
                description=(
                    f'পেমেন্ট রিসিভ হয়েছে কিন্তু এখনো অনুমোদন হয়নি। '
                    f'নতুন Expiry Date: {client.expiry_date}'
                ),
            )
        else:
            log_client_activity(
                client, 'expiry_extended',
                title='আংশিক পেমেন্ট রিসিভ (Approval Pending) — Expiry অপরিবর্তিত',
                description=(
                    f'পেমেন্ট (৳{amount}) বর্তমান বকেয়া (৳{client.due_amount}) পুরোপুরি '
                    f'কভার করেনি, তাই Expiry Date বাড়ানো হয়নি — শুধু temporary access দেওয়া হয়েছে।'
                ),
            )
    except Exception:
        pass


def _auto_enable_client_if_paid(client, as_of_date=None):
    # সব due শোধ হলে (due_amount=0) এবং status inactive/suspended/expired হলে client auto-enable করে
    # cancelled বা left হলে enable করা উচিত নয়
    # as_of_date = পেমেন্টের তারিখ; expiry এই তারিখ থেকে পরের মাসের একই দিনে set হয়
    DISABLE_STATUSES = ('inactive', 'suspended', 'expired')
    if client.due_amount > 0 or client.status not in DISABLE_STATUSES:
        return

    # RADIUS enable + Blocked_Group থেকে আসল package group-এ ফেরানো
    # radius_enabled ট্র্যাক করি — fail করলে নিচে status='active' সেট করা হবে না।
    # RADIUS-ই authoritative auth system (CLAUDE.md-এর Client Status → RADIUS
    # Mapping টেবিল অনুযায়ী); enable আসলে ব্যর্থ হলেও status='active' দেখালে DB
    # আর বাস্তব network access-এর মধ্যে মিথ্যা সামঞ্জস্য তৈরি হয় — client "active,
    # paid" দেখাবে কিন্তু internet পাবে না, কোনো retry/alert ছাড়াই।
    radius_enabled = False
    try:
        from radius_app.services.radius_service import RadiusService
        svc = RadiusService.for_client(client)
        svc.enable_user(client.username)
        original_group = (client.package.mikrotik_profile
                          if client.package and client.package.mikrotik_profile else '')
        if original_group:
            svc.restore_user_group(client.username, original_group)
        radius_enabled = True
    except Exception as e:
        import logging
        logging.getLogger(__name__).exception(
            "Auto-enable-এ RADIUS enable ব্যর্থ (client=%s) — status 'active' করা হচ্ছে "
            "না, পরের payment/manual Enable-এ retry হবে: %s", client.username, e
        )

    # Mikrotik PPPoE enable + পুরোনো session kick (best-effort — RADIUS-ই
    # authoritative, MikroTik fail হলে status flip আটকানো হয় না)।
    # গুরুত্বপূর্ণ: profile/IP-pool শুধু PPPoE auth-এর সময় নির্ধারিত হয়। expired থাকাকালীন
    # চলমান session Expired pool-এ আটকে থাকে; RADIUS group ঠিক করলেও live session নিজে
    # থেকে নতুন profile নেয় না। তাই active session disconnect করে redial বাধ্য করি —
    # ক্লায়েন্ট সাথে সাথেই আসল package profile (5_Mbps pool) পায়, ৫ মিনিট বা manual
    # redial-এর ভরসায় থাকতে হয় না।
    try:
        if client.router:
            from mikrotik_app.services.mikrotik_service import MikrotikService
            svc_mt = MikrotikService.from_server_model(client.router)
            svc_mt.enable_pppoe_user(client.username)
            svc_mt.disconnect_active_session(client.username)
    except Exception:
        pass

    if not radius_enabled:
        return  # status/expiry আপডেট হবে না — পরের সফল enable-এ (retry) সম্পন্ন হবে

    # next expiry_date = পেমেন্ট তারিখ থেকে পরের মাসের একই দিন
    # (fixed expiry_day নয় — পেমেন্টের দিন অনুযায়ী; expiry_day-ও সেই দিনে আপডেট হয়)
    _set_next_expiry(client, as_of_date)

    client.status = 'active'
    client.save(update_fields=['status', 'expiry_date', 'expiry_day'])

    try:
        from clients.activity import log_client_activity
        log_client_activity(
            client, 'client_enabled',
            title='সংযোগ স্বয়ংক্রিয়ভাবে সক্রিয়',
            description=(
                f'সব বকেয়া পরিশোধের পর RADIUS ও Mikrotik enable হয়েছে। '
                f'নতুন Expiry Date: {client.expiry_date}'
            ),
        )
        log_client_activity(
            client, 'expiry_extended',
            title=f'Expiry Date আপডেট — {client.expiry_date}',
            description='পেমেন্ট সম্পন্ন হওয়ায় পরবর্তী মাসে expiry set হয়েছে।',
        )
    except Exception:
        pass


class InstallationFee(models.Model):
    # ইন্টারনেট সংযোগ স্থাপনের সময় নেওয়া ফি
    client = models.ForeignKey(_CLIENT_MODEL, on_delete=models.CASCADE, related_name='installation_fees')
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    paid_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    payment_method = models.CharField(max_length=20, default='cash')
    payment_date = models.DateField(null=True, blank=True)
    received_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'installation_fees'


class DailyCollection(models.Model):
    # দৈনিক বিল কালেকশন রিপোর্ট
    date = models.DateField(unique=True)
    total_collected = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    cash_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    online_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_payments = models.IntegerField(default=0)
    collected_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'daily_collections'
        ordering = ['-date']


class WebhookPayment(models.Model):
    """
    Payment gateway (bKash, Nagad, Rocket, SSLCommerz ইত্যাদি) থেকে
    আসা webhook payment রেকর্ড।
    """
    GATEWAY_CHOICES = [
        ('BKASH_WEBHOOK',           'bKash Webhook'),
        ('NAGAD_WEBHOOK',           'Nagad Webhook'),
        ('ROCKET_WEBHOOK',          'Rocket Webhook'),
        ('FOSTERPAYMENTS_WEBHOOK',  'FosterPayments Webhook'),
        ('SSLCOMMERZ_WEBHOOK',      'SSLCommerz Webhook'),
    ]
    TRANS_STATUS_CHOICES = [
        ('Completed', 'Completed'),
        ('Initiated',  'Initiated'),
        ('Failed',    'Failed'),
        ('Cancelled', 'Cancelled'),
    ]
    SETTLEMENT_CHOICES = [
        ('payment_requested',     'Payment Requested'),
        ('automatically_settled', 'Automatically Settled'),
        ('manually_settled',      'Manually Settled'),
        ('payment_transferred',   'Payment Transferred'),
        ('payment_retransferred', 'Payment Retransferred'),
    ]

    # ── Gateway data ──────────────────────────────────────────────────────────
    gateway_type    = models.CharField(max_length=50, choices=GATEWAY_CHOICES, default='BKASH_WEBHOOK', db_index=True)
    trans_msg_inv_no = models.CharField(max_length=255, blank=True)   # paymentID / msgID
    transaction_id  = models.CharField(max_length=100, unique=True)   # trxID
    payment_amount  = models.DecimalField(max_digits=10, decimal_places=2)
    from_wallet     = models.CharField(max_length=50, blank=True)     # sender phone
    to_wallet_org   = models.CharField(max_length=200, blank=True)    # merchant name
    trans_reference = models.CharField(max_length=100, blank=True, db_index=True)  # merchantInvoiceNumber
    trans_timestamp = models.DateTimeField(null=True, blank=True)     # gateway timestamp
    trans_status    = models.CharField(max_length=30, choices=TRANS_STATUS_CHOICES, default='Completed')
    raw_data        = models.JSONField(default=dict, blank=True)      # full webhook payload

    # ── Settlement ────────────────────────────────────────────────────────────
    settlement_status = models.CharField(max_length=30, choices=SETTLEMENT_CHOICES,
                                         default='payment_requested', db_index=True)
    matched_client    = models.ForeignKey(_CLIENT_MODEL, on_delete=models.SET_NULL,
                                          null=True, blank=True, related_name='webhook_payments')
    transferred_to    = models.ForeignKey(_CLIENT_MODEL, on_delete=models.SET_NULL,
                                          null=True, blank=True, related_name='webhook_transfers')
    linked_payment    = models.ForeignKey('billing.Payment', on_delete=models.SET_NULL,
                                          null=True, blank=True, related_name='webhook_source')
    remarks_note      = models.TextField(blank=True)

    # ── Audit ─────────────────────────────────────────────────────────────────
    update_by  = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                   null=True, blank=True, related_name='webhook_updates')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'webhook_payments'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.gateway_type} | {self.transaction_id} | {self.payment_amount}৳ | {self.settlement_status}"


class ReminderRule(models.Model):
    """পেমেন্ট রিমাইন্ডার নিয়ম — কখন, কাকে, কোন channel-এ, কী বার্তা পাঠানো হবে।

    auto task প্রতিদিন নির্দিষ্ট ঘণ্টায় চলে; প্রতিটি active rule-এর জন্য যোগ্য
    client বের করে enabled channel-গুলোতে reminder পাঠায়। manual "Send Now"-ও
    একই rule ব্যবহার করে।
    """
    TRIGGER_CHOICES = [
        ('before_expiry', 'মেয়াদ শেষের আগে'),
        ('on_due',        'বকেয়া থাকলে'),
        ('after_expiry',  'মেয়াদ শেষের পরে'),
    ]
    name        = models.CharField(max_length=120, verbose_name='নিয়মের নাম')
    is_active   = models.BooleanField(default=True, verbose_name='সক্রিয়')
    trigger     = models.CharField(max_length=20, choices=TRIGGER_CHOICES, default='before_expiry')
    offset_days = models.IntegerField(default=3, verbose_name='দিন (before/after)',
                                      help_text='before_expiry/after_expiry-এর জন্য কত দিন')

    # channels — যেগুলো টিক করা সেগুলোতেই reminder যাবে
    via_sms   = models.BooleanField(default=True,  verbose_name='SMS')
    via_push  = models.BooleanField(default=False, verbose_name='App Push')
    via_email = models.BooleanField(default=False, verbose_name='Email')

    # target filter
    only_active = models.BooleanField(default=True, verbose_name='শুধু active client')
    min_due     = models.DecimalField(max_digits=10, decimal_places=2, default=0,
                                      verbose_name='ন্যূনতম বকেয়া', help_text='এর বেশি বকেয়া হলে')
    zone        = models.ForeignKey('configuration.Zone', null=True, blank=True,
                                    on_delete=models.SET_NULL, related_name='reminder_rules')
    package     = models.ForeignKey('configuration.Package', null=True, blank=True,
                                    on_delete=models.SET_NULL, related_name='reminder_rules')

    # message — placeholder: {name} {due} {expiry_date} {customer_id} {package} {phone} {app_link}
    message_template = models.TextField(
        default='প্রিয় {name}, আপনার বকেয়া বিল {due}৳ (মেয়াদ {expiry_date})। অনুগ্রহ করে দ্রুত পরিশোধ করুন।',
        help_text='placeholder: {name} {due} {expiry_date} {customer_id} {package} {phone} {app_link}')
    email_subject = models.CharField(max_length=200, blank=True, default='পেমেন্ট রিমাইন্ডার',
                                     verbose_name='Email বিষয়')
    send_hour = models.IntegerField(default=10, verbose_name='পাঠানোর ঘণ্টা (0-23)',
                                    help_text='auto task দিনের কোন ঘণ্টায় চালাবে')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'reminder_rules'
        ordering = ['-created_at']
        verbose_name = 'Reminder Rule'

    def __str__(self):
        return f"{self.name} ({self.get_trigger_display()})"


class ReminderLog(models.Model):
    """প্রতিটি reminder পাঠানোর রেকর্ড — কে, কখন, কোন channel, status।"""
    STATUS_CHOICES = [('sent', 'Sent'), ('failed', 'Failed')]
    CHANNEL_CHOICES = [('sms', 'SMS'), ('push', 'App Push'), ('email', 'Email')]

    rule      = models.ForeignKey(ReminderRule, null=True, blank=True,
                                  on_delete=models.SET_NULL, related_name='logs')
    client    = models.ForeignKey(_CLIENT_MODEL, null=True,
                                  on_delete=models.SET_NULL, related_name='reminder_logs')
    channel   = models.CharField(max_length=10, choices=CHANNEL_CHOICES)
    recipient = models.CharField(max_length=160, blank=True)
    message   = models.TextField(blank=True)
    status    = models.CharField(max_length=10, choices=STATUS_CHOICES, default='sent')
    detail    = models.TextField(blank=True, help_text='error বা response বিবরণ')
    triggered_by = models.CharField(max_length=20, default='auto',
                                    help_text="auto বা manual:<username>")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'reminder_logs'
        ordering = ['-created_at']
        verbose_name = 'Reminder Log'

    def __str__(self):
        return f"{self.channel} → {self.recipient} [{self.status}]"
