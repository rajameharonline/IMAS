# এই ফাইলটি billing business logic service - মাসিক বিল তৈরি ও হিসাব করার জন্য।
from decimal import Decimal
from django.utils import timezone
from clients.models import Client
from billing.models import Bill


def _create_auto_bill(client, bill_month, due_date, source_label):
    """auto invoice তৈরি + client.due_amount update + activity log + advance auto-apply।
    এই মাসে ইতিমধ্যে বিল থাকলে (double monthly charge রোধে) 'skipped', নাহলে 'created'।"""
    if Bill.objects.filter(client=client, bill_month=bill_month).exists():
        return 'skipped'
    amount = client.monthly_bill or client.package.price
    discount = client.discount or Decimal('0')
    net_amount = max(amount - discount, Decimal('0'))
    Bill.objects.create(
        client=client, bill_month=bill_month,
        amount=amount, discount=discount, net_amount=net_amount,
        due_amount=net_amount, status='unpaid', due_date=due_date,
        is_auto=True,   # ← স্বয়ংক্রিয় invoice flag
    )
    client.due_amount = client.due_amount + net_amount
    client.save(update_fields=['due_amount'])
    # ── Activity Log ──
    try:
        from clients.activity import log_client_activity
        log_client_activity(
            client, 'bill_generated',
            title=f'বিল তৈরি — {bill_month}',
            description=(
                f'Package: {client.package.name} | Amount: ৳{amount} | '
                f'Discount: ৳{discount} | Net: ৳{net_amount} | '
                f'Due Date: {due_date} | Source: {source_label}'
            ),
            amount=net_amount,
        )
    except Exception:
        pass
    # নতুন বিল তৈরির পর advance_balance থেকে auto-apply
    BillingService.apply_advance_to_bills(client)
    return 'created'


def _create_monthly_batch_bill(client, month, due_date):
    """monthly-batch auto bill তৈরি + client.due_amount = সব bill-এর SUM + log + advance।
    এই মাসে বিল থাকলে 'skipped', নাহলে 'created'।"""
    from django.db.models import Sum as _Sum
    if Bill.objects.filter(client=client, bill_month=month).exists():
        return 'skipped'
    amount = client.monthly_bill or client.package.price
    discount = client.discount or Decimal('0')
    net_amount = max(amount - discount, Decimal('0'))
    Bill.objects.create(
        client=client,
        bill_month=month,
        amount=amount,
        discount=discount,
        net_amount=net_amount,
        due_amount=net_amount,
        status='unpaid',
        due_date=due_date,
        is_auto=True,   # auto invoice flag
    )
    from billing.models import recalc_client_due_amount
    recalc_client_due_amount(client)
    try:
        from clients.activity import log_client_activity
        log_client_activity(
            client, 'bill_generated',
            title=f'বিল তৈরি — {month}',
            description=(
                f'Package: {client.package.name} | Amount: ৳{amount} | '
                f'Discount: ৳{discount} | Net: ৳{net_amount} | '
                f'Due Date: {due_date} | Source: Auto (Monthly Batch)'
            ),
            amount=net_amount,
        )
    except Exception:
        pass
    # নতুন বিল তৈরির পর advance_balance থেকে auto-apply
    BillingService.apply_advance_to_bills(client)
    return 'created'


def _pay_due_bills(client, remaining, pm, txn_id, notes, received_by, is_verified, approved_by):
    """due bills oldest-first পরিশোধ (skip_auto_process — batch শেষে recalc)।
    Returns (created_payments, bills_paid, remaining)।"""
    from billing.models import Bill, Payment
    created = []
    bills_paid = []
    # ১. Due bills oldest-first
    due_bills = list(
        Bill.objects.filter(
            client=client,
            status__in=('unpaid', 'partial'),
        ).order_by('bill_month')   # পুরনো বিল আগে
    )
    for bill in due_bills:
        if remaining <= Decimal('0'):
            break
        bill_due = bill.due_amount
        if bill_due <= Decimal('0'):
            continue
        pay_amount = min(remaining, bill_due)
        remaining -= pay_amount
        payment = Payment(
            bill=bill,
            client=client,
            amount=pay_amount,
            payment_method=pm,
            transaction_id=txn_id,
            notes=notes,
            received_by=received_by,
            is_verified=is_verified,
            approved_by=approved_by if is_verified else None,
        )
        payment.save(skip_auto_process=True)
        created.append(payment)
        bills_paid.append(bill)
    return created, bills_paid, remaining


def _create_advance_payment(client, remaining, pm, txn_id, notes, received_by, approved_by):
    """অবশিষ্ট টাকা → advance receipt (bill=None) + advance_balance update।
    Returns (payment, advance_added)।"""
    from billing.models import Payment
    pure_advance_payment = Payment(
        bill=None,
        client=client,
        amount=remaining,
        payment_method=pm,
        transaction_id=txn_id,
        notes=(notes + ' [Advance]').strip() if notes else 'Advance Balance',
        received_by=received_by,
        is_verified=True,
        approved_by=approved_by,
    )
    pure_advance_payment.save(skip_auto_process=True)
    client.advance_balance = (client.advance_balance or Decimal('0')) + remaining
    client.save(update_fields=['advance_balance'])
    return pure_advance_payment, remaining


def _finalize_payment(client, bills_paid, is_verified, amount=None):
    """verified → প্রতিটি bill recalc + advance apply + auto-enable;
    unverified → expiry update ও RADIUS enable (temporary)।
    amount = মোট received amount (unverified path-এ due-এর সাথে তুলনা করে
    expiry extend করা উচিত কিনা ঠিক করতে ব্যবহৃত হয়)।"""
    from billing.models import (Payment, _auto_enable_client_if_paid,
                                _update_expiry_and_enable_for_unverified)
    if is_verified:
        for bill in bills_paid:
            Payment.recalculate_bill_and_client(bill)
        client.refresh_from_db()
        # advance_balance থাকলে অবশিষ্ট due bills-এ apply
        if (client.advance_balance or Decimal('0')) > Decimal('0'):
            BillingService.apply_advance_to_bills(client)
            client.refresh_from_db()
        _auto_enable_client_if_paid(client)
    else:
        _update_expiry_and_enable_for_unverified(client, amount=amount)


def _log_payment_received(client, amount, bills_paid, advance_added, transaction_id,
                          is_verified, payment_method, received_by):
    """payment রিসিভের একটাই সারাংশ activity log (fail হলে চুপচাপ)।"""
    from billing.models import Payment
    from clients.activity import log_client_activity
    try:
        bill_summary = ', '.join(b.bill_month for b in bills_paid) or 'N/A'
        log_client_activity(
            client, 'payment_received',
            title=f'পেমেন্ট রিসিভ — ৳{amount}',
            description=(
                f'Method: {dict(Payment.PAYMENT_METHOD).get(payment_method, payment_method)} | '
                f'Bills: {bill_summary} | '
                f'Advance: ৳{advance_added} | '
                f'TxnID: {transaction_id or "N/A"} | '
                f'Status: {"Verified" if is_verified else "Pending Approval"}'
            ),
            amount=amount,
            performed_by=(
                (received_by.full_name or received_by.username)
                if received_by else 'System'
            ),
            user=received_by,
        )
    except Exception:
        pass


class BillingService:
    @staticmethod
    def generate_bills_by_expiry_date() -> dict:
        # প্রতিটি active ক্লায়েন্টের expiry_day (বা পুরনো expiry_date) অনুযায়ী বিল তৈরি করে।
        # প্রতিদিন চলে — আজকের তারিখ == expiry_day হলে বিল তৈরি হয়।
        import calendar as _cal
        today = timezone.localdate()  # Asia/Dhaka তারিখ (now().date() UTC দেয়)

        created = 0
        skipped = 0

        # expiry_day-ভিত্তিক ক্লায়েন্ট (নতুন লজিক)
        # মাসের শেষ দিনে expiry_day > today.day হলেও bill তৈরি করে (e.g. expiry_day=31, এপ্রিলের 30 তারিখ)
        last_day = _cal.monthrange(today.year, today.month)[1]
        is_last_day = (today.day == last_day)
        from django.db.models import Q as _Q
        if is_last_day:
            day_q = _Q(expiry_day__gte=today.day)
        else:
            day_q = _Q(expiry_day=today.day)

        day_clients = Client.objects.filter(
            day_q,
            status='active',
            expiry_day__isnull=False,
        ).select_related('package')

        for client in day_clients:
            if not client.package:
                skipped += 1
                continue
            bill_month = today.strftime('%Y-%m')
            # due_date = আজকের মাসে expiry_day তারিখ (মাসের সর্বোচ্চ দিন সীমাবদ্ধ)
            max_day = _cal.monthrange(today.year, today.month)[1]
            due_day = min(client.expiry_day, max_day)
            due_date = today.replace(day=due_day)
            if _create_auto_bill(client, bill_month, due_date, 'Auto (Expiry Day)') == 'created':
                created += 1
            else:
                skipped += 1

        # পুরনো expiry_date-ভিত্তিক (expiry_day না থাকা ক্লায়েন্টদের ফলব্যাক)
        date_clients = Client.objects.filter(
            status='active',
            expiry_day__isnull=True,
            expiry_date__lte=today,
        ).select_related('package')

        for client in date_clients:
            if not client.package or not client.expiry_date:
                skipped += 1
                continue
            bill_month = client.expiry_date.strftime('%Y-%m')
            if _create_auto_bill(client, bill_month, client.expiry_date, 'Auto (Expiry Date)') == 'created':
                created += 1
            else:
                skipped += 1

        return {
            'message': 'Expiry Day/Date অনুযায়ী বিল তৈরি সম্পন্ন।',
            'created': created,
            'skipped': skipped,
        }

    @staticmethod
    def generate_bill_for_client(
        client_id: int,
        bill_month: str = None,
        custom_amount: Decimal = None,
        notes: str = '',
    ) -> dict:
        """
        ম্যানুয়াল invoice তৈরি — সবসময় নতুন bill create করে (is_auto=False)।
        একই মাসে একাধিক manual invoice তৈরি করা যাবে।
        Auto invoice-এর সাথে কোনো conflict নেই।
        """
        from django.db.models import Sum as _Sum
        try:
            client = Client.objects.select_related('package').get(id=client_id)
        except Client.DoesNotExist:
            return {'error': 'Client not found.'}

        if not client.package:
            return {'error': 'Client has no package assigned.'}

        if not bill_month:
            bill_month = (client.expiry_date.strftime('%Y-%m')
                          if client.expiry_date else timezone.now().strftime('%Y-%m'))

        # custom_amount দিলে সেটাই net_amount, না দিলে package থেকে calculate
        if custom_amount is not None and custom_amount > 0:
            amount     = Decimal(str(custom_amount))
            discount   = Decimal('0')
            net_amount = amount
        else:
            amount     = client.monthly_bill or client.package.price
            discount   = client.discount or Decimal('0')
            net_amount = max(amount - discount, Decimal('0'))

        # ── সবসময় নতুন manual bill তৈরি করো (is_auto=False) ──
        bill = Bill.objects.create(
            client=client,
            bill_month=bill_month,
            amount=amount,
            discount=discount,
            net_amount=net_amount,
            due_amount=net_amount,
            status='unpaid',
            due_date=client.expiry_date,
            notes=notes,
            is_auto=False,   # manual invoice — একই মাসে একাধিক হতে পারে
        )
        from billing.models import recalc_client_due_amount
        recalc_client_due_amount(client)
        # ── Activity Log ──
        try:
            from clients.activity import log_client_activity
            log_client_activity(
                client, 'bill_generated',
                title=f'বিল তৈরি — {bill_month} (Manual)',
                description=(
                    f'Package: {client.package.name} | Amount: ৳{amount} | '
                    f'Discount: ৳{discount} | Net: ৳{net_amount} | '
                    f'Notes: {notes or "N/A"} | Source: Manual'
                ),
                amount=net_amount,
            )
        except Exception:
            pass
        # নতুন manual bill-এ advance balance apply করো
        BillingService.apply_advance_to_bills(client)
        return {
            'message': f'Manual bill created for {client.full_name} ({bill_month}).',
            'bill_id': bill.id,
            'action': 'created',
            'is_auto': False,
        }

    @staticmethod
    def generate_bills_for_active_clients(month: str = None) -> dict:
        # প্রতি মাসের ১ তারিখে চলে — সব active ক্লায়েন্টের বিল তৈরি করে।
        # expiry_day থাকলে due_date = সেই মাসের expiry_day তারিখ।
        import calendar as _cal
        from datetime import date as _date
        today = timezone.localdate()  # Asia/Dhaka তারিখ (now().date() UTC দেয়)
        if not month:
            month = today.strftime('%Y-%m')
        year, mon = int(month[:4]), int(month[5:7])

        active_clients = Client.objects.filter(status='active').select_related('package')

        created = 0
        skipped = 0
        for client in active_clients:
            if not client.package:
                skipped += 1
                continue
            # Free package → কোনো বিল generate হবে না
            if getattr(client.package, 'is_free', False):
                skipped += 1
                continue

            if client.expiry_day:
                max_day = _cal.monthrange(year, mon)[1]
                due_day = min(client.expiry_day, max_day)
                due_date = _date(year, mon, due_day)
            else:
                due_date = client.expiry_date

            if _create_monthly_batch_bill(client, month, due_date) == 'created':
                created += 1
            else:
                skipped += 1

        return {
            'message': f'{month} মাসের বিল তৈরি সম্পন্ন।',
            'created': created,
            'skipped': skipped,
        }

    @staticmethod
    def generate_monthly_bills(month: str) -> dict:
        # manual override — নির্দিষ্ট মাসের বিল API থেকে তৈরি করার জন্য
        return BillingService.generate_bills_for_active_clients(month)

    # ─────────────────────────────────────────────────────────────
    # পেমেন্ট রিসিভ — Due bills oldest-first, বাকি → advance_balance
    # ─────────────────────────────────────────────────────────────

    @staticmethod
    def receive_payment(
        client,
        amount: Decimal,
        payment_method: str = 'cash',
        received_by=None,
        notes: str = '',
        transaction_id: str = '',
        is_verified: bool = True,
        approved_by=None,
    ) -> dict:
        """
        একটি ক্লায়েন্টের জন্য পেমেন্ট রিসিভ করে।

        নিয়ম:
        ১. Due bills গুলো oldest (bill_month) থেকে শুরু করে কাটা হয়।
        ২. সব due শোধ হওয়ার পর বাকি টাকা client.advance_balance-এ যোগ হয়।
        ৩. is_verified=True (admin/superadmin): সাথে সাথেই bill update ও client enable।
           is_verified=False (collector): Payment record তৈরি হয়, enable হয় কিন্তু
           bill amount admin approve করার আগে পরিবর্তন হয় না।
        """
        from django.db import transaction as _tx

        remaining = Decimal(str(amount))
        created_payments = []
        bills_paid = []
        advance_added = Decimal('0')

        with _tx.atomic():
            # client row lock করি (select_for_update) — নইলে দুইটা concurrent
            # receive_payment() (যেমন webhook retry + manual entry একসাথে) একই
            # advance_balance/due_amount stale read করে একজনের credit হারিয়ে
            # যেতে পারত (lost update)। lock না পাওয়া পর্যন্ত দ্বিতীয় transaction
            # এখানে wait করবে, তারপর প্রথমটার commit করা fresh data পড়বে।
            client = type(client).objects.select_for_update().get(pk=client.pk)

            # ১. Due bills oldest-first পরিশোধ
            created_payments, bills_paid, remaining = _pay_due_bills(
                client, remaining, payment_method, transaction_id, notes,
                received_by, is_verified, approved_by)

            # ২. বাকি টাকা advance_balance-এ (শুধু verified payment-এ)
            if remaining > Decimal('0') and is_verified:
                adv_payment, advance_added = _create_advance_payment(
                    client, remaining, payment_method, transaction_id, notes,
                    received_by, approved_by)
                created_payments.append(adv_payment)

            # ৩. Verified → recalc + advance apply + enable; Unverified → temp enable
            _finalize_payment(client, bills_paid, is_verified, amount)

            # ৪. Activity log — একটাই, সারাংশ সহ
            _log_payment_received(client, amount, bills_paid, advance_added,
                                  transaction_id, is_verified, payment_method, received_by)

        return {
            'payments_created': len(created_payments),
            'payment_ids':      [p.id for p in created_payments],
            'bills_covered':    [b.bill_month for b in bills_paid],
            'advance_added':    str(advance_added),
            'remaining_due':    str(client.due_amount),
            'advance_balance':  str(client.advance_balance),
        }

    @staticmethod
    def apply_advance_to_bills(client) -> Decimal:
        """
        client.advance_balance থেকে oldest due bill(s)-এ auto-apply করে।
        বিল তৈরির পরে call করা হয় — advance থাকলে নতুন বিল এখনই আংশিক/সম্পূর্ণ পরিশোধ হয়।
        Returns: মোট apply হওয়া amount।
        """
        from billing.models import Bill, Payment, _auto_enable_client_if_paid
        from django.db import transaction as _tx

        # client row lock করি (select_for_update) — receive_payment()-এর মতোই,
        # concurrent call-এ advance_balance-এর stale read/lost-update এড়াতে।
        with _tx.atomic():
            client = type(client).objects.select_for_update().get(pk=client.pk)

            advance = client.advance_balance or Decimal('0')
            if advance <= Decimal('0'):
                return Decimal('0')

            applied_total = Decimal('0')
            due_bills = list(
                Bill.objects.filter(
                    client=client,
                    status__in=('unpaid', 'partial'),
                ).order_by('bill_month')
            )

            for bill in due_bills:
                if advance <= Decimal('0'):
                    break
                bill_due = bill.due_amount
                if bill_due <= Decimal('0'):
                    continue

                pay_amount = min(advance, bill_due)
                advance -= pay_amount
                applied_total += pay_amount

                # Advance থেকে auto-apply — payment_method='advance'
                payment = Payment(
                    bill=bill,
                    amount=pay_amount,
                    payment_method='advance',
                    notes='Advance Balance থেকে স্বয়ংক্রিয় প্রয়োগ',
                    is_verified=True,
                )
                payment.save(skip_auto_process=True)
                Payment.recalculate_bill_and_client(bill)

                try:
                    from clients.activity import log_client_activity
                    log_client_activity(
                        client, 'payment_received',
                        title=f'Advance Balance প্রয়োগ — {bill.bill_month}',
                        description=f'৳{pay_amount} advance balance থেকে {bill.bill_month} বিলে apply হয়েছে।',
                        amount=pay_amount,
                    )
                except Exception:
                    pass

            # advance_balance আপডেট করো
            client.advance_balance = advance
            client.save(update_fields=['advance_balance'])
            client.refresh_from_db()
            _auto_enable_client_if_paid(client)

        return applied_total
