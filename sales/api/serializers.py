# Sales module serializers — Product ও Service উভয় flow।
# কেন nested line items: invoice create-এর সময় header + lines একসাথে POST হয়,
# ফলে frontend থেকে single request-এ সব data save করা যায়।
from decimal import Decimal

from rest_framework import serializers
from django.contrib.auth import get_user_model

from inventory.models import Item
from .utils import next_product_invoice_no, next_service_invoice_no
from sales.models import (
    ProductSalesInvoice, ProductSalesInvoiceLine, ProductSalesPayment,
    ServiceSalesInvoice, ServiceSalesInvoiceLine, ServiceSalesPayment,
)

User = get_user_model()


# ─── Shared helpers ──────────────────────────────────────────────────────────

class UserMiniSerializer(serializers.ModelSerializer):
    # List-এ created_by / received_by নাম দেখানোর জন্য।
    display_name = serializers.SerializerMethodField()

    def get_display_name(self, obj):
        return getattr(obj, 'full_name', '') or obj.username

    class Meta:
        model = User
        fields = ['id', 'display_name']


# ─── Product Sales ───────────────────────────────────────────────────────────

class ProductSalesInvoiceLineSerializer(serializers.ModelSerializer):
    item_name = serializers.ReadOnlyField(source='item.name')
    item = serializers.PrimaryKeyRelatedField(
        queryset=Item.objects.filter(is_active=True),
        required=False, allow_null=True,
    )

    class Meta:
        model = ProductSalesInvoiceLine
        fields = [
            'id', 'item', 'item_name', 'description',
            'quantity', 'rate', 'vat_percent', 'total',
        ]
        read_only_fields = ['total']


class ProductSalesPaymentSerializer(serializers.ModelSerializer):
    # Bills-list page-এর জন্য সব payment details flatten করা।
    customer_name  = serializers.ReadOnlyField(source='invoice.customer.full_name')
    customer_id    = serializers.ReadOnlyField(source='invoice.customer.customer_id')
    username       = serializers.ReadOnlyField(source='invoice.customer.username')
    invoice_no     = serializers.ReadOnlyField(source='invoice.invoice_no')
    invoice_id     = serializers.ReadOnlyField(source='invoice.id')
    invoice_total  = serializers.ReadOnlyField(source='invoice.total')
    invoice_due    = serializers.ReadOnlyField(source='invoice.due')
    paid_by_name   = serializers.SerializerMethodField()
    received_by_name = serializers.SerializerMethodField()
    created_by_name  = serializers.SerializerMethodField()
    payment_method_display = serializers.SerializerMethodField()

    def get_paid_by_name(self, obj):
        if obj.paid_by:
            return getattr(obj.paid_by, 'full_name', '') or obj.paid_by.username
        return ''

    def get_received_by_name(self, obj):
        if obj.received_by:
            return getattr(obj.received_by, 'full_name', '') or obj.received_by.username
        return ''

    def get_created_by_name(self, obj):
        if obj.created_by:
            return getattr(obj.created_by, 'full_name', '') or obj.created_by.username
        return ''

    def get_payment_method_display(self, obj):
        return obj.get_payment_method_display()

    class Meta:
        model = ProductSalesPayment
        fields = [
            'id', 'receipt_no', 'invoice_id', 'invoice_no',
            'customer_name', 'customer_id', 'username',
            'invoice_total', 'invoice_due',
            'paid_amount', 'discount', 'payment_method', 'payment_method_display',
            'paid_by', 'paid_by_name',
            'receive_date', 'received_by', 'received_by_name',
            'created_by', 'created_by_name', 'created_at',
        ]
        read_only_fields = [
            'receipt_no', 'payment_method_display',
            'customer_name', 'customer_id', 'username',
            'invoice_no', 'invoice_total', 'invoice_due',
            'paid_by_name', 'received_by_name', 'created_by_name', 'created_at',
        ]


class ProductSalesInvoiceSerializer(serializers.ModelSerializer):
    # Invoice list + create/edit এর জন্য।
    lines         = ProductSalesInvoiceLineSerializer(many=True, required=False)
    lines_payload = serializers.JSONField(write_only=True, required=False)
    invoice_no    = serializers.CharField(required=False, allow_blank=True)

    customer_name = serializers.ReadOnlyField(source='customer.full_name')
    customer_id_no = serializers.ReadOnlyField(source='customer.customer_id')
    username      = serializers.ReadOnlyField(source='customer.username')
    created_by_name = serializers.SerializerMethodField()
    status_display  = serializers.SerializerMethodField()

    def get_created_by_name(self, obj):
        if obj.created_by:
            return getattr(obj.created_by, 'full_name', '') or obj.created_by.username
        return ''

    def get_status_display(self, obj):
        return obj.get_status_display()

    def validate_invoice_no(self, value):
        # Blank হলে auto-generate করা হবে।
        return value

    @staticmethod
    def _resolve_line_item(item_id):
        if not item_id:
            return None
        try:
            return Item.objects.get(pk=item_id)
        except Item.DoesNotExist:
            return None

    def _create_line(self, ld, invoice, request):
        """একটা লাইন-আইটেম তৈরি, save (total auto-calc model.save()-এ), ও বিক্রি
        হলে stock OUT deduct করে। লাইনের total রিটার্ন করে (grand_total-এ যোগ হবে)।"""
        item_obj = self._resolve_line_item(ld.get('item'))
        line = ProductSalesInvoiceLine(
            invoice=invoice,
            item=item_obj,
            description=ld.get('description', ''),
            quantity=Decimal(str(ld.get('quantity', 0))),
            rate=Decimal(str(ld.get('rate', 0))),
            vat_percent=Decimal(str(ld.get('vat_percent', 0))),
        )
        line.save()  # total auto-calc in model.save()
        if item_obj:
            self._deduct_stock(item_obj, line.quantity, invoice, request)
        return line.total

    @staticmethod
    def _resolve_lines_data(validated_data):
        """lines_payload (JSON field, string বা dict) থাকলে সেটাই ব্যবহার হবে,
        নাহলে সরাসরি validated 'lines'।"""
        lines_payload = validated_data.pop('lines_payload', None)
        lines_data = validated_data.pop('lines', [])
        if lines_payload:
            if isinstance(lines_payload, str):
                import json
                return json.loads(lines_payload)
            return lines_payload
        return lines_data

    def create(self, validated_data):
        request = self.context.get('request')
        lines_data = self._resolve_lines_data(validated_data)

        # Auto invoice number
        if not validated_data.get('invoice_no'):
            validated_data['invoice_no'] = next_product_invoice_no()
        if request and not validated_data.get('created_by'):
            validated_data['created_by'] = request.user

        invoice = ProductSalesInvoice.objects.create(**validated_data)
        grand_total = sum(
            (self._create_line(ld, invoice, request) for ld in lines_data),
            Decimal('0.00'),
        )

        invoice.total = grand_total
        invoice.due   = max(grand_total - Decimal(str(invoice.discount or 0)), Decimal('0.00'))
        invoice.save(update_fields=['total', 'due'])
        return invoice

    def update(self, instance, validated_data):
        lines_payload = validated_data.pop('lines_payload', None)
        validated_data.pop('lines', None)

        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()

        if lines_payload is not None:
            if isinstance(lines_payload, str):
                import json
                lines_payload = json.loads(lines_payload)

            # পুরনো lines মুছে নতুন করে তৈরি
            instance.lines.all().delete()
            grand_total = Decimal('0.00')

            for ld in lines_payload:
                item_id = ld.get('item')
                item_obj = None
                if item_id:
                    try:
                        item_obj = Item.objects.get(pk=item_id)
                    except Item.DoesNotExist:
                        pass

                line = ProductSalesInvoiceLine(
                    invoice=instance,
                    item=item_obj,
                    description=ld.get('description', ''),
                    quantity=Decimal(str(ld.get('quantity', 0))),
                    rate=Decimal(str(ld.get('rate', 0))),
                    vat_percent=Decimal(str(ld.get('vat_percent', 0))),
                )
                line.save()
                grand_total += line.total

            instance.total = grand_total
            instance.due   = max(
                grand_total - Decimal(str(instance.discount or 0)) - Decimal(str(instance.receive_amount or 0)),
                Decimal('0.00'),
            )
            instance.save(update_fields=['total', 'due'])

        return instance

    def _deduct_stock(self, item, quantity, invoice, request):
        # Product sale হলে inventory stock OUT।
        # কেন: বিক্রির সাথে সাথে stock কমতে হবে।
        from inventory.models import Stock, StockTransaction
        from django.db.models import Sum

        # Default store (সবচেয়ে বেশি stock আছে এমন store)
        stock_entry = (
            Stock.objects.filter(item=item, quantity__gt=0)
            .order_by('-quantity')
            .first()
        )
        store = stock_entry.store if stock_entry else None

        StockTransaction.objects.create(
            item=item,
            store=store,
            transaction_type='out',
            quantity=quantity,
            unit_price=item.approximate_rate,
            reference=f'SALE-{invoice.invoice_no}',
            notes=f'Product sales invoice {invoice.invoice_no}',
            created_by=request.user if request else None,
        )

        if store:
            Stock.objects.filter(item=item, store=store).update(
                quantity=models.F('quantity') - quantity,
            )

    class Meta:
        model = ProductSalesInvoice
        fields = [
            'id', 'invoice_no', 'customer', 'customer_name', 'customer_id_no', 'username',
            'payment_due', 'total', 'receive_amount', 'discount', 'due', 'status',
            'status_display', 'remarks', 'created_by', 'created_by_name', 'created_at',
            'lines', 'lines_payload',
        ]
        read_only_fields = [
            'total', 'receive_amount', 'due', 'status', 'status_display',
            'customer_name', 'customer_id_no', 'username',
            'created_by_name', 'created_at',
        ]


# ─── Service Sales ───────────────────────────────────────────────────────────

class ServiceSalesInvoiceLineSerializer(serializers.ModelSerializer):
    item_name = serializers.ReadOnlyField(source='item.name')
    item = serializers.PrimaryKeyRelatedField(
        queryset=Item.objects.filter(is_active=True),
        required=False, allow_null=True,
    )

    class Meta:
        model = ServiceSalesInvoiceLine
        fields = [
            'id', 'item', 'item_name', 'description',
            'quantity', 'rate', 'vat_percent', 'total',
        ]
        read_only_fields = ['total']


class ServiceSalesPaymentSerializer(serializers.ModelSerializer):
    customer_name  = serializers.ReadOnlyField(source='invoice.customer.full_name')
    customer_id    = serializers.ReadOnlyField(source='invoice.customer.customer_id')
    username       = serializers.ReadOnlyField(source='invoice.customer.username')
    invoice_no     = serializers.ReadOnlyField(source='invoice.invoice_no')
    invoice_id     = serializers.ReadOnlyField(source='invoice.id')
    invoice_type   = serializers.ReadOnlyField(source='invoice.invoice_type')
    invoice_type_display = serializers.SerializerMethodField()
    invoice_total  = serializers.ReadOnlyField(source='invoice.total')
    invoice_due    = serializers.ReadOnlyField(source='invoice.due')
    paid_by_name   = serializers.SerializerMethodField()
    received_by_name = serializers.SerializerMethodField()
    created_by_name  = serializers.SerializerMethodField()
    payment_method_display = serializers.SerializerMethodField()

    def get_invoice_type_display(self, obj):
        return obj.invoice.get_invoice_type_display() if obj.invoice else ''

    def get_paid_by_name(self, obj):
        if obj.paid_by:
            return getattr(obj.paid_by, 'full_name', '') or obj.paid_by.username
        return ''

    def get_received_by_name(self, obj):
        if obj.received_by:
            return getattr(obj.received_by, 'full_name', '') or obj.received_by.username
        return ''

    def get_created_by_name(self, obj):
        if obj.created_by:
            return getattr(obj.created_by, 'full_name', '') or obj.created_by.username
        return ''

    def get_payment_method_display(self, obj):
        return obj.get_payment_method_display()

    class Meta:
        model = ServiceSalesPayment
        fields = [
            'id', 'receipt_no', 'invoice_id', 'invoice_no',
            'customer_name', 'customer_id', 'username',
            'invoice_type', 'invoice_type_display',
            'invoice_total', 'invoice_due',
            'paid_amount', 'discount', 'payment_method', 'payment_method_display',
            'paid_by', 'paid_by_name',
            'receive_date', 'received_by', 'received_by_name',
            'created_by', 'created_by_name', 'created_at',
        ]
        read_only_fields = [
            'receipt_no', 'payment_method_display',
            'customer_name', 'customer_id', 'username',
            'invoice_no', 'invoice_type', 'invoice_type_display',
            'invoice_total', 'invoice_due',
            'paid_by_name', 'received_by_name', 'created_by_name', 'created_at',
        ]


class ServiceSalesInvoiceSerializer(serializers.ModelSerializer):
    lines         = ServiceSalesInvoiceLineSerializer(many=True, required=False)
    lines_payload = serializers.JSONField(write_only=True, required=False)
    invoice_no    = serializers.CharField(required=False, allow_blank=True)

    customer_name  = serializers.ReadOnlyField(source='customer.full_name')
    customer_id_no = serializers.ReadOnlyField(source='customer.customer_id')
    username       = serializers.ReadOnlyField(source='customer.username')
    created_by_name    = serializers.SerializerMethodField()
    status_display     = serializers.SerializerMethodField()
    invoice_type_display = serializers.SerializerMethodField()

    def get_created_by_name(self, obj):
        if obj.created_by:
            return getattr(obj.created_by, 'full_name', '') or obj.created_by.username
        return ''

    def get_status_display(self, obj):
        return obj.get_status_display()

    def get_invoice_type_display(self, obj):
        return obj.get_invoice_type_display()

    def create(self, validated_data):
        lines_payload = validated_data.pop('lines_payload', None)
        lines_data    = validated_data.pop('lines', [])
        request       = self.context.get('request')

        if not validated_data.get('invoice_no'):
            validated_data['invoice_no'] = next_service_invoice_no()
        if request and not validated_data.get('created_by'):
            validated_data['created_by'] = request.user

        if lines_payload:
            if isinstance(lines_payload, str):
                import json
                lines_data = json.loads(lines_payload)
            else:
                lines_data = lines_payload

        invoice = ServiceSalesInvoice.objects.create(**validated_data)
        grand_total = Decimal('0.00')

        for ld in lines_data:
            item_id = ld.get('item')
            item_obj = None
            if item_id:
                try:
                    item_obj = Item.objects.get(pk=item_id)
                except Item.DoesNotExist:
                    pass

            line = ServiceSalesInvoiceLine(
                invoice=invoice,
                item=item_obj,
                description=ld.get('description', ''),
                quantity=Decimal(str(ld.get('quantity', 0))),
                rate=Decimal(str(ld.get('rate', 0))),
                vat_percent=Decimal(str(ld.get('vat_percent', 0))),
            )
            line.save()
            grand_total += line.total

        invoice.total = grand_total
        invoice.due   = max(grand_total - Decimal(str(invoice.discount or 0)), Decimal('0.00'))
        invoice.save(update_fields=['total', 'due'])
        return invoice

    def update(self, instance, validated_data):
        lines_payload = validated_data.pop('lines_payload', None)
        validated_data.pop('lines', None)

        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()

        if lines_payload is not None:
            if isinstance(lines_payload, str):
                import json
                lines_payload = json.loads(lines_payload)

            instance.lines.all().delete()
            grand_total = Decimal('0.00')

            for ld in lines_payload:
                item_id = ld.get('item')
                item_obj = None
                if item_id:
                    try:
                        item_obj = Item.objects.get(pk=item_id)
                    except Item.DoesNotExist:
                        pass

                line = ServiceSalesInvoiceLine(
                    invoice=instance,
                    item=item_obj,
                    description=ld.get('description', ''),
                    quantity=Decimal(str(ld.get('quantity', 0))),
                    rate=Decimal(str(ld.get('rate', 0))),
                    vat_percent=Decimal(str(ld.get('vat_percent', 0))),
                )
                line.save()
                grand_total += line.total

            instance.total = grand_total
            instance.due   = max(
                grand_total - Decimal(str(instance.discount or 0)) - Decimal(str(instance.receive_amount or 0)),
                Decimal('0.00'),
            )
            instance.save(update_fields=['total', 'due'])

        return instance

    class Meta:
        model = ServiceSalesInvoice
        fields = [
            'id', 'invoice_no', 'invoice_type', 'invoice_type_display',
            'customer', 'customer_name', 'customer_id_no', 'username',
            'payment_due', 'total', 'receive_amount', 'discount', 'due', 'status',
            'status_display', 'remarks', 'created_by', 'created_by_name', 'created_at',
            'lines', 'lines_payload',
        ]
        read_only_fields = [
            'total', 'receive_amount', 'due', 'status', 'status_display',
            'invoice_type_display',
            'customer_name', 'customer_id_no', 'username',
            'created_by_name', 'created_at',
        ]
