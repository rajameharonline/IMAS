from django.apps import AppConfig


class BillingConfig(AppConfig):
    name = 'billing'

    def ready(self):
        # Payment তৈরি বা আপডেট (approve) হলেই accounting ledger-এ post (Debit Cash /
        # Credit Revenue)। এতে Dashboard "Cash On Hand" ও Income-এ client collection
        # প্রতিফলিত হয়। শুধু created=True-তে fire করলে collector-received payment
        # (is_verified=False তৈরি হয়, পরে admin approve করলে .save() আপডেট — create নয়)
        # কখনো ledger-এ post হতো না — Cash/Revenue systematically কম দেখাত। এখন প্রতি
        # save-এই কল হয়; post_payment_to_ledger() নিজেই idempotent (reference
        # unique-check) ও is_verified guard করে, তাই repeat call নিরাপদ/no-op।
        from django.db.models.signals import post_save
        from billing.models import Payment
        from billing.ledger import post_payment_to_ledger

        def _payment_to_ledger(sender, instance, created, **kwargs):
            post_payment_to_ledger(instance)

        # weak=False জরুরি — local function না হলে weakref GC-তে signal খুলে যায়
        post_save.connect(_payment_to_ledger, sender=Payment,
                          dispatch_uid='billing_payment_ledger', weak=False)
