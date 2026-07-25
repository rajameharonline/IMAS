# billing/ledger.py — Client bill payment → double-entry accounting integration।
#
# কেন: Dashboard "Cash On Hand" (ও Income) accounting ledger (JournalLine) থেকে
# আসে, কিন্তু আগে billing collection ledger-এ post হত না — তাই Cash On Hand-এ
# client income অদৃশ্য ছিল। এখন প্রতিটি প্রকৃত নগদ payment-এ journal entry post হয়:
#     Debit  : Cash On Hand (1010)      — নগদ আসলো
#     Credit : Internet Revenue (4010)  — সেবা আয়
# সাথে একটি Income record (Income module/report-এর জন্য)।
#
# idempotent: reference 'BILLPAY-<payment_id>' unique — দুবার post হয় না।
# advance-application payment (payment_method='advance') নতুন নগদ নয় → skip।
from decimal import Decimal


def post_payment_to_ledger(payment):
    """একটি client Payment-কে accounting ledger-এ post করে। ব্যর্থ/অপ্রযোজ্য হলে চুপচাপ ফেরে।"""
    try:
        if payment is None:
            return
        amount = Decimal(str(payment.amount or 0))
        if amount <= 0:
            return
        # advance প্রয়োগ = আগের নগদ ব্যবহার, নতুন নগদ নয় → ledger-এ নতুন inflow নয়
        if (payment.payment_method or '') == 'advance':
            return
        if not payment.is_verified:
            return

        from accounting.models import (
            JournalEntry, JournalLine, ChartOfAccount, AccountType,
            Income, IncomeCategory,
        )

        reference = f'BILLPAY-{payment.id}'
        if JournalEntry.objects.filter(reference=reference).exists():
            return   # ইতিমধ্যে post করা

        asset_type, _ = AccountType.objects.get_or_create(
            code='ASSET', defaults={'name': 'Asset', 'is_debit_normal': True})
        cash, _ = ChartOfAccount.objects.get_or_create(
            code='1010', defaults={'account_type': asset_type, 'name': 'Cash On Hand',
                                    'description': 'Operating cash balance', 'is_active': True})
        rev_type, _ = AccountType.objects.get_or_create(
            code='REV', defaults={'name': 'Revenue', 'is_debit_normal': False})
        revenue, _ = ChartOfAccount.objects.get_or_create(
            code='4010', defaults={'account_type': rev_type, 'name': 'Internet Service Revenue',
                                   'description': 'Client bill / internet service income', 'is_active': True})

        # তারিখ ও client
        pdate = payment.payment_date
        pdate = pdate.date() if hasattr(pdate, 'date') else pdate
        client = payment.client or (payment.bill.client if payment.bill_id else None)
        uname  = getattr(client, 'username', '') or getattr(client, 'customer_id', '') or '—'
        try:
            method = payment.get_payment_method_display()
        except Exception:
            method = payment.payment_method or 'cash'
        desc = f'বিল পরিশোধ — {uname} ({method})'

        je = JournalEntry.objects.create(
            reference=reference, date=pdate, description=desc,
            total_debit=amount, total_credit=amount, is_posted=True,
        )
        JournalLine.objects.create(journal=je, account=cash,
                                   debit=amount, credit=Decimal('0.00'),
                                   description='গ্রাহকের বিল থেকে নগদ প্রাপ্তি')
        JournalLine.objects.create(journal=je, account=revenue,
                                   debit=Decimal('0.00'), credit=amount,
                                   description=desc)

        # Income record (Income module/report-এ দেখাতে) — reference দিয়ে duplicate রোধ
        cat, _ = IncomeCategory.objects.get_or_create(
            name='Internet Bill', defaults={'account': revenue})
        if not Income.objects.filter(reference=reference).exists():
            Income.objects.create(
                account=revenue, category=cat, amount=amount, date=pdate,
                description=desc, reference=reference, is_approved=True)
    except Exception:
        # accounting ব্যর্থ হলেও billing payment যেন না ভাঙে
        import logging
        logging.getLogger(__name__).warning('post_payment_to_ledger failed for payment %s',
                                             getattr(payment, 'id', None), exc_info=True)
