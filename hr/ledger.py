# hr/ledger.py — Salary payment ও Employee Advance → double-entry accounting integration।
#
# Salary পরিশোধ = নগদ বের হওয়া (cash outflow)। প্রতিটি PayslipPayment-এ post হয়:
#     Debit  : Salary & Wages Expense (5200)  — বেতন খরচ
#     Credit : Cash On Hand (1010)             — নগদ কমলো
# সাথে একটি Expense record (Expense module/report-এর জন্য)।
#
# Employee Advance দেওয়া/রিকভারি একটা receivable-এর মাধ্যমে ট্র্যাক হয়:
#     দেওয়া হলে   — Debit Employee Advance Receivable (1050) / Credit Cash On Hand (1010)
#     রিকভারি হলে — Debit Cash On Hand (1010) / Credit Employee Advance Receivable (1050)
#                    (অর্থাৎ রিকভারি সরাসরি Cash On Hand — company-র মূল ব্যালেন্সে যোগ হয়)
#
# idempotent: reference 'SALPAY-<id>' / 'ADVGIVE-<id>' / 'ADVRECOV-<id>' unique — দুবার post হয় না।
from decimal import Decimal

_CASH_NAME = 'Cash On Hand'
_CASH_DESC = 'Operating cash balance'
_RECEIVABLE_NAME = 'Employee Advance Receivable'
_RECEIVABLE_DESC = 'Employee-কে দেওয়া অগ্রিম — recovery বাকি'


def _get_asset_accounts():
    """Cash On Hand (1010) ও Employee Advance Receivable (1050) — দুটোই না থাকলে তৈরি করে।"""
    from accounting.models import ChartOfAccount, AccountType

    asset_type, _ = AccountType.objects.get_or_create(
        code='ASSET', defaults={'name': 'Asset', 'is_debit_normal': True})
    cash, _ = ChartOfAccount.objects.get_or_create(
        code='1010', defaults={'account_type': asset_type, 'name': _CASH_NAME,
                                'description': _CASH_DESC, 'is_active': True})
    receivable, _ = ChartOfAccount.objects.get_or_create(
        code='1050', defaults={'account_type': asset_type, 'name': _RECEIVABLE_NAME,
                                'description': _RECEIVABLE_DESC, 'is_active': True})
    return cash, receivable


def _emp_label(emp):
    return getattr(emp, 'full_name', '') or getattr(emp, 'employee_id', '') or '—'


def post_salary_to_ledger(payment):
    """একটি PayslipPayment-কে accounting ledger-এ post করে। ব্যর্থ/অপ্রযোজ্য হলে চুপচাপ ফেরে।"""
    try:
        if payment is None:
            return
        amount = Decimal(str(getattr(payment, 'amount', 0) or 0))
        if amount <= 0:
            return

        from accounting.models import (
            JournalEntry, JournalLine, ChartOfAccount, AccountType,
            Expense, ExpenseCategory,
        )

        reference = f'SALPAY-{payment.id}'
        if JournalEntry.objects.filter(reference=reference).exists():
            return

        cash, _ = _get_asset_accounts()
        exp_type, _ = AccountType.objects.get_or_create(
            code='EXP', defaults={'name': 'Expense', 'is_debit_normal': True})
        salary_acc, _ = ChartOfAccount.objects.get_or_create(
            code='5200', defaults={'account_type': exp_type, 'name': 'Salary & Wages Expense',
                                   'description': 'Employee salary payment expense', 'is_active': True})

        pdate = getattr(payment, 'paid_date', None)
        pdate = pdate.date() if hasattr(pdate, 'date') else pdate
        emp = None
        try:
            emp = payment.payslip.employee
        except Exception:
            pass
        ename = _emp_label(emp)
        month = getattr(getattr(payment, 'payslip', None), 'month', '') or ''
        try:
            method = payment.get_payment_method_display()
        except Exception:
            method = getattr(payment, 'payment_method', 'cash')
        desc = f'বেতন পরিশোধ — {ename}{(" (" + month + ")") if month else ""} ({method})'

        je = JournalEntry.objects.create(
            reference=reference, date=pdate, description=desc,
            total_debit=amount, total_credit=amount, is_posted=True,
        )
        JournalLine.objects.create(journal=je, account=salary_acc,
                                   debit=amount, credit=Decimal('0.00'),
                                   description=desc)
        JournalLine.objects.create(journal=je, account=cash,
                                   debit=Decimal('0.00'), credit=amount,
                                   description='বেতন বাবদ নগদ পরিশোধ')

        cat, _ = ExpenseCategory.objects.get_or_create(
            name='Salary & Wages', defaults={'account': salary_acc})
        if not Expense.objects.filter(reference=reference).exists():
            Expense.objects.create(
                account=salary_acc, category=cat, amount=amount, date=pdate,
                description=desc, reference=reference, is_approved=True)
    except Exception:
        import logging
        logging.getLogger(__name__).warning('post_salary_to_ledger failed for payment %s',
                                             getattr(payment, 'id', None), exc_info=True)


def post_advance_given_to_ledger(advance):
    """একটি EmployeeAdvance (দেওয়া) ledger-এ post করে — Cash On Hand কমে, Receivable বাড়ে।
    ব্যর্থ/অপ্রযোজ্য হলে চুপচাপ ফেরে।"""
    try:
        if advance is None:
            return
        amount = Decimal(str(getattr(advance, 'amount', 0) or 0))
        if amount <= 0:
            return

        from accounting.models import JournalEntry, JournalLine

        reference = f'ADVGIVE-{advance.id}'
        if JournalEntry.objects.filter(reference=reference).exists():
            return

        cash, receivable = _get_asset_accounts()
        desc = f'Employee Advance দেওয়া হলো — {_emp_label(advance.employee)} (Adv#{advance.id})'

        je = JournalEntry.objects.create(
            reference=reference, date=advance.taken_date, description=desc,
            total_debit=amount, total_credit=amount, is_posted=True,
        )
        JournalLine.objects.create(journal=je, account=receivable,
                                   debit=amount, credit=Decimal('0.00'), description=desc)
        JournalLine.objects.create(journal=je, account=cash,
                                   debit=Decimal('0.00'), credit=amount,
                                   description='অগ্রিম বাবদ নগদ পরিশোধ')
    except Exception:
        import logging
        logging.getLogger(__name__).warning('post_advance_given_to_ledger failed for advance %s',
                                             getattr(advance, 'id', None), exc_info=True)


def post_advance_recovery_to_ledger(recovery):
    """একটি AdvanceRecovery ledger-এ post করে — Cash On Hand (মূল ব্যালেন্স) বাড়ে, Receivable কমে।
    ব্যর্থ/অপ্রযোজ্য হলে চুপচাপ ফেরে।"""
    try:
        if recovery is None:
            return
        amount = Decimal(str(getattr(recovery, 'amount', 0) or 0))
        if amount <= 0:
            return

        from accounting.models import JournalEntry, JournalLine

        reference = f'ADVRECOV-{recovery.id}'
        if JournalEntry.objects.filter(reference=reference).exists():
            return

        cash, receivable = _get_asset_accounts()
        adv = getattr(recovery, 'advance', None)
        emp = getattr(adv, 'employee', None) if adv else None
        adv_id = getattr(adv, 'id', None)
        desc = f'Employee Advance রিকভারি — {_emp_label(emp)} (Adv#{adv_id})'

        je = JournalEntry.objects.create(
            reference=reference, date=recovery.recovered_date, description=desc,
            total_debit=amount, total_credit=amount, is_posted=True,
        )
        JournalLine.objects.create(journal=je, account=cash,
                                   debit=amount, credit=Decimal('0.00'),
                                   description='অগ্রিম রিকভারি বাবদ নগদ (মূল ব্যালেন্স) জমা')
        JournalLine.objects.create(journal=je, account=receivable,
                                   debit=Decimal('0.00'), credit=amount, description=desc)
    except Exception:
        import logging
        logging.getLogger(__name__).warning('post_advance_recovery_to_ledger failed for recovery %s',
                                             getattr(recovery, 'id', None), exc_info=True)
