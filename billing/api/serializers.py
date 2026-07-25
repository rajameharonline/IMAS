# এই ফাইলটি billing app-এর serializers - বিলিং, পেমেন্ট API-এর জন্য।
from rest_framework import serializers
from billing.models import (
    Bill, Payment, InstallationFee, DailyCollection, WebhookPayment,
    ReminderRule, ReminderLog,
)


class BillSerializer(serializers.ModelSerializer):
    client_name         = serializers.ReadOnlyField(source='client.full_name')
    client_customer_id  = serializers.ReadOnlyField(source='client.customer_id')
    client_phone        = serializers.ReadOnlyField(source='client.phone')
    client_address      = serializers.ReadOnlyField(source='client.address')
    client_package      = serializers.ReadOnlyField(source='client.package.name')
    client_zone         = serializers.ReadOnlyField(source='client.zone.name')
    client_username     = serializers.ReadOnlyField(source='client.username')
    client_ip           = serializers.ReadOnlyField(source='client.ip_address')
    client_expiry       = serializers.ReadOnlyField(source='client.expiry_date')
    client_monthly_bill = serializers.ReadOnlyField(source='client.monthly_bill')
    client_bill_date    = serializers.ReadOnlyField(source='client.bill_date')
    client_status           = serializers.ReadOnlyField(source='client.status')
    client_advance_balance  = serializers.ReadOnlyField(source='client.advance_balance')
    client_total_due        = serializers.SerializerMethodField()
    client_balance_due      = serializers.SerializerMethodField()
    advance_amount          = serializers.SerializerMethodField()
    last_payment_date       = serializers.SerializerMethodField()
    last_payment_method     = serializers.SerializerMethodField()
    has_pending_payment     = serializers.SerializerMethodField()
    payments_summary        = serializers.SerializerMethodField()
    client_connection_type  = serializers.SerializerMethodField()

    # Company & invoice settings — loaded once per serializer instance
    company_name         = serializers.SerializerMethodField()
    company_address      = serializers.SerializerMethodField()
    company_phone        = serializers.SerializerMethodField()
    company_email        = serializers.SerializerMethodField()
    company_logo_url     = serializers.SerializerMethodField()
    company_logo_b64     = serializers.SerializerMethodField()
    invoice_header_color = serializers.SerializerMethodField()
    invoice_note         = serializers.SerializerMethodField()
    invoice_footer       = serializers.SerializerMethodField()
    invoice_show_logo    = serializers.SerializerMethodField()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        import base64, mimetypes
        from system_settings.models import CompanySetup, InvoiceSetup
        self._co  = CompanySetup.objects.first()
        self._inv = InvoiceSetup.objects.first()
        # Pre-encode logo once per serializer instance (avoids repeated disk reads)
        self._logo_b64 = ''
        if self._co and self._co.logo:
            try:
                with open(self._co.logo.path, 'rb') as f:
                    raw = base64.b64encode(f.read()).decode('utf-8')
                mime = mimetypes.guess_type(self._co.logo.name)[0] or 'image/png'
                self._logo_b64 = f'data:{mime};base64,{raw}'
            except Exception:
                pass

    def get_client_total_due(self, obj):
        from django.db.models import Sum
        # সেই billing month পর্যন্ত (inclusive) সব unpaid due যোগ করা হচ্ছে।
        # এতে প্রতিটি invoice-এ সেই সময়ের সঠিক balance দেখাবে।
        return obj.client.bills.filter(
            bill_month__lte=obj.bill_month
        ).aggregate(t=Sum('due_amount'))['t'] or 0

    def get_client_balance_due(self, obj):
        from django.db.models import Sum
        return obj.client.bills.aggregate(t=Sum('due_amount'))['t'] or 0

    def get_advance_amount(self, obj):
        # client.advance_balance field সরাসরি ব্যবহার করা হচ্ছে
        return obj.client.advance_balance or 0

    def get_last_payment_date(self, obj):
        payment = Payment.objects.filter(
            bill__client=obj.client
        ).order_by('-payment_date').first()
        return payment.payment_date.date() if payment else None

    def get_last_payment_method(self, obj):
        # সর্বশেষ পেমেন্টের method (verified বা unverified যাই হোক)
        payment = Payment.objects.filter(
            bill__client=obj.client,
        ).order_by('-payment_date').first()
        return payment.payment_method if payment else None

    def get_has_pending_payment(self, obj):
        # Client-এর যেকোনো bill-এ is_verified=False payment থাকলে True
        return Payment.objects.filter(
            bill__client=obj.client,
            is_verified=False,
        ).exists()

    def get_payments_summary(self, obj):
        # এই bill-এর verified payment গুলোর সংক্ষিপ্ত তালিকা (invoice PDF-এর জন্য)
        result = []
        for p in obj.payments.filter(is_verified=True).order_by('-payment_date'):
            result.append({
                'date':        p.payment_date.strftime('%d %b %Y') if p.payment_date else '—',
                'method':      p.payment_method or '—',
                'amount':      str(p.amount),
                'received_by': (p.received_by.full_name or p.received_by.username or '—') if p.received_by else '—',
            })
        return result

    def get_client_connection_type(self, obj):
        # Client-এর connection protocol (PPPoE, DHCP ইত্যাদি)
        try:
            return obj.client.protocol.name if obj.client.protocol else ''
        except Exception:
            return ''

    # ── company helpers ──────────────────────────────────────
    def get_company_name(self, obj):
        return self._co.name if self._co else 'ISP Company'

    def get_company_address(self, obj):
        return self._co.address if self._co else ''

    def get_company_phone(self, obj):
        return self._co.phone if self._co else ''

    def get_company_email(self, obj):
        return self._co.email if self._co else ''

    def get_company_logo_url(self, obj):
        if self._co and self._co.logo:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(self._co.logo.url)
            return self._co.logo.url
        return ''

    def get_company_logo_b64(self, obj):
        return self._logo_b64

    # ── invoice setup helpers ────────────────────────────────
    def get_invoice_header_color(self, obj):
        return self._inv.header_color if self._inv else '#DC5014'

    def get_invoice_note(self, obj):
        return (
            self._inv.note_text if self._inv
            else "This is a computerized Invoice and doesn't need any signature."
        )

    def get_invoice_footer(self, obj):
        return self._inv.footer_text if self._inv else ''

    def get_invoice_show_logo(self, obj):
        return self._inv.show_logo if self._inv else True

    class Meta:
        model = Bill
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at', 'paid_amount', 'due_amount']


class BillCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Bill
        fields = ['client', 'bill_month', 'amount', 'discount', 'net_amount', 'due_date']


class PaymentSerializer(serializers.ModelSerializer):
    received_by_name   = serializers.SerializerMethodField()
    approved_by_name   = serializers.SerializerMethodField()
    created_by_name    = serializers.SerializerMethodField()
    client_id          = serializers.ReadOnlyField(source='bill.client.id')
    client_name        = serializers.ReadOnlyField(source='bill.client.full_name')
    client_customer_id = serializers.ReadOnlyField(source='bill.client.customer_id')
    client_username    = serializers.ReadOnlyField(source='bill.client.username')
    client_phone       = serializers.ReadOnlyField(source='bill.client.phone')
    client_monthly_bill= serializers.ReadOnlyField(source='bill.client.monthly_bill')
    client_due_amount  = serializers.ReadOnlyField(source='bill.client.due_amount')
    bill_month         = serializers.ReadOnlyField(source='bill.bill_month')
    bill_net_amount    = serializers.ReadOnlyField(source='bill.net_amount')
    bill_due_amount    = serializers.ReadOnlyField(source='bill.due_amount')
    bill_discount      = serializers.ReadOnlyField(source='bill.discount')
    # Payment Gateway বিস্তারিত — webhook payment-এ WebhookPayment থেকে populate হয়
    gateway_info       = serializers.SerializerMethodField()

    def get_gateway_info(self, obj):
        """
        linked WebhookPayment থেকে gateway details তুলে modal-এ দেখানোর জন্য।
        Manual payment-এ payment_method থেকে basic info দেখায়।
        """
        from billing.models import WebhookPayment
        # webhook_source reverse relation — এই payment-এর WebhookPayment আছে কিনা
        wp = WebhookPayment.objects.filter(linked_payment=obj).select_related('matched_client').first()
        if wp:
            raw  = wp.raw_data or {}
            # raw_data-এ sns_payload → parsed_msg nested থাকতে পারে
            msg  = raw.get('parsed_msg', raw)
            paid_amt   = float(obj.amount)
            proc_fee   = float(msg.get('serviceFee', msg.get('processingFee', 0)) or 0)
            stored_amt = paid_amt - proc_fee
            return {
                'is_gateway':        True,
                'card_type':         wp.get_gateway_type_display() or wp.gateway_type,
                'transaction_id':    wp.transaction_id,
                'bank_receiver_id':  wp.to_wallet_org or msg.get('creditMSISDN', ''),
                'bank_receiver_name': msg.get('receiverName', msg.get('orgName', wp.to_wallet_org or '')),
                'paid_amount':       paid_amt,
                'vat_amount':        float(msg.get('vatAmount', 0) or 0),
                'processing_fee':    proc_fee,
                'service_charge':    proc_fee,
                'stored_amount':     stored_amt,
                'card_holder':       msg.get('senderName', msg.get('cardHolder', '')),
                'card_number':       wp.from_wallet or msg.get('debitMSISDN', ''),
                'payment_status':    wp.trans_status,
                'gateway_type':      wp.gateway_type,
                'trans_timestamp':   str(wp.trans_timestamp) if wp.trans_timestamp else '',
            }
        # Manual payment — basic info
        method_label = {
            'cash': 'Cash Payment', 'bkash': 'bKash Manual',
            'nagad': 'Nagad Manual', 'rocket': 'Rocket Manual',
            'bank': 'Bank Transfer', 'cheque': 'Cheque Payment',
        }.get(obj.payment_method, obj.payment_method or 'Cash Payment')
        return {
            'is_gateway':    False,
            'card_type':     method_label,
            'payment_status': 'Completed' if obj.is_verified else 'Pending',
            'paid_amount':   float(obj.amount),
            'vat_amount':    0,
            'processing_fee': 0,
            'service_charge': 0,
            'stored_amount': float(obj.amount),
        }

    def _user_name(self, user):
        if not user:
            return ''
        name = getattr(user, 'full_name', '') or ''
        return name or user.username

    def get_received_by_name(self, obj):
        import re
        notes = obj.notes or ''
        # notes-এ [গৃহীত: EmployeeName] থাকলে সেটাই দেখাও
        m = re.match(r'^\[গৃহীত: (.+?)\]', notes)
        if m:
            return m.group(1)
        # bKash SNS Webhook payment → gateway name দেখাও
        if notes.startswith('bKash SNS'):
            return 'bKash'
        if notes.startswith(('Webhook Auto', 'Webhook')):
            # gateway type বের করো notes থেকে (যেমন "NAGAD_WEBHOOK")
            gw_match = re.search(r'Gateway:\s*(\w+)', notes)
            if gw_match:
                return gw_match.group(1).replace('_WEBHOOK', '').title()
            return 'Webhook'
        return self._user_name(obj.received_by)

    def get_approved_by_name(self, obj):
        return self._user_name(obj.approved_by)

    def get_created_by_name(self, obj):
        # explicit created_by থাকলে তা দেখাও
        if obj.created_by:
            return self._user_name(obj.created_by)
        notes = obj.notes or ''
        # bKash SNS Webhook → System (bKash)
        if notes.startswith('bKash SNS'):
            return 'System (bKash)'
        if notes.startswith(('Webhook Auto', 'Webhook')):
            return 'System (Webhook)'
        # manual payment — received_by থেকে নাও
        if obj.received_by:
            return self._user_name(obj.received_by)
        return 'System'

    def validate_amount(self, value):
        # নেগেটিভ/শূন্য amount দিলে hidden debit তৈরি হতে পারে (due_amount বাড়িয়ে দেয়)
        # — plain create endpoint (ModelViewSet default) সরাসরি amount নেয় বলে এখানে
        # validate করা জরুরি (receive_payment action আলাদাভাবে এটা চেক করে, কিন্তু
        # সেটা এই serializer দিয়ে যায় না)।
        if value <= 0:
            raise serializers.ValidationError('Payment amount অবশ্যই শূন্যের বেশি হতে হবে।')
        return value

    class Meta:
        model = Payment
        fields = '__all__'
        # is_verified ও approved_by frontend থেকে set করা যাবে না — backend নিজেই role অনুযায়ী ঠিক করে
        read_only_fields = ['id', 'payment_date', 'created_by', 'approved_by', 'is_verified']


class InstallationFeeSerializer(serializers.ModelSerializer):
    class Meta:
        model = InstallationFee
        fields = '__all__'


class DailyCollectionSerializer(serializers.ModelSerializer):
    collected_by_name = serializers.ReadOnlyField(source='collected_by.full_name')

    class Meta:
        model = DailyCollection
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'collected_by']


class WebhookPaymentSerializer(serializers.ModelSerializer):
    # ── Frontend field name aliases (frontend-এর সাথে মেলাতে) ──────────────
    amount               = serializers.DecimalField(source='payment_amount', max_digits=10, decimal_places=2, read_only=True)
    transaction_status   = serializers.CharField(source='trans_status',    read_only=True)
    transaction_ref      = serializers.CharField(source='trans_reference', read_only=True)
    transaction_timestamp = serializers.DateTimeField(source='trans_timestamp', read_only=True)
    gateway              = serializers.CharField(source='gateway_type',    read_only=True)
    # ── Extra computed fields ─────────────────────────────────────────────────
    update_by_name      = serializers.SerializerMethodField()
    updated_by_name     = serializers.SerializerMethodField()   # alias
    matched_client_name = serializers.SerializerMethodField()
    settlement_label    = serializers.SerializerMethodField()
    transfer_history    = serializers.SerializerMethodField()

    def get_transfer_history(self, obj):
        # raw_data-তে জমানো প্রতিটি transfer log (নতুন → পুরনো ক্রমে)
        hist = (obj.raw_data or {}).get('transfer_history', []) if isinstance(obj.raw_data, dict) else []
        return list(reversed(hist))

    def get_update_by_name(self, obj):
        if obj.update_by:
            return obj.update_by.full_name or obj.update_by.username
        return ''

    def get_updated_by_name(self, obj):
        return self.get_update_by_name(obj)

    def get_matched_client_name(self, obj):
        if obj.matched_client:
            return obj.matched_client.full_name
        return ''

    def get_settlement_label(self, obj):
        return obj.get_settlement_status_display()

    class Meta:
        model  = WebhookPayment
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']


class ReminderRuleSerializer(serializers.ModelSerializer):
    trigger_display = serializers.ReadOnlyField(source='get_trigger_display')
    zone_name       = serializers.ReadOnlyField(source='zone.name')
    package_name    = serializers.ReadOnlyField(source='package.name')

    class Meta:
        model = ReminderRule
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate(self, data):
        # অন্তত একটি channel টিক থাকতে হবে
        via_sms   = data.get('via_sms',   getattr(self.instance, 'via_sms', False))
        via_push  = data.get('via_push',  getattr(self.instance, 'via_push', False))
        via_email = data.get('via_email', getattr(self.instance, 'via_email', False))
        if not (via_sms or via_push or via_email):
            raise serializers.ValidationError('অন্তত একটি channel (SMS/Push/Email) নির্বাচন করুন।')
        return data


class ReminderLogSerializer(serializers.ModelSerializer):
    client_name        = serializers.ReadOnlyField(source='client.full_name')
    client_customer_id = serializers.ReadOnlyField(source='client.customer_id')
    rule_name          = serializers.ReadOnlyField(source='rule.name')

    class Meta:
        model = ReminderLog
        fields = '__all__'
        read_only_fields = ['id', 'created_at']
