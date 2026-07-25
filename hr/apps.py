from django.apps import AppConfig


class HrConfig(AppConfig):
    name = 'hr'

    def ready(self):
        # Salary payment (PayslipPayment) তৈরি হলেই accounting ledger-এ post
        # (Debit Salary Expense / Credit Cash On Hand) — Cash On Hand ও Expense-এ প্রতিফলিত।
        from django.db.models.signals import post_save
        from hr.models import PayslipPayment, EmployeeAdvance, AdvanceRecovery
        from hr.ledger import (
            post_salary_to_ledger, post_advance_given_to_ledger, post_advance_recovery_to_ledger,
        )

        def _salary_to_ledger(sender, instance, created, **kwargs):
            if created:
                post_salary_to_ledger(instance)

        def _advance_given_to_ledger(sender, instance, created, **kwargs):
            if created:
                post_advance_given_to_ledger(instance)

        def _advance_recovery_to_ledger(sender, instance, created, **kwargs):
            if created:
                post_advance_recovery_to_ledger(instance)

        # weak=False — local function না হলে weakref GC-তে signal খুলে যায়
        post_save.connect(_salary_to_ledger, sender=PayslipPayment,
                          dispatch_uid='hr_salary_ledger', weak=False)
        # Employee Advance দেওয়া হলে — Cash On Hand কমে, Receivable বাড়ে
        post_save.connect(_advance_given_to_ledger, sender=EmployeeAdvance,
                          dispatch_uid='hr_advance_given_ledger', weak=False)
        # Advance recovery হলে — Cash On Hand (মূল ব্যালেন্স) বাড়ে, Receivable কমে
        post_save.connect(_advance_recovery_to_ledger, sender=AdvanceRecovery,
                          dispatch_uid='hr_advance_recovery_ledger', weak=False)
