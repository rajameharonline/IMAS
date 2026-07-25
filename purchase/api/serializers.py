# Purchase module serializers — দুটো flow পরিচালনা করে:
# 1) ISP hardware flow: Vendor → Requisition → Order → Bill
# 2) Bandwidth provider flow: Provider → ProviderBill → Payment
from decimal import Decimal
import json

from rest_framework import serializers

from inventory.models import Item, Unit, StoreLocation
from purchase.models import (
    Vendor, PurchaseRequisition, PurchaseRequisitionItem,
    PurchaseOrder, PurchaseOrderItem, PurchaseBill,
    Provider, ProviderBill, ProviderBillLine, ProviderBillPayment,
)


def _next_code(prefix, queryset, field='bill_no', digits=6):
    # Auto-numbering: UI-তে blank দিলেও serial generate হবে।
    last = queryset.order_by(f'-{field}').values_list(field, flat=True).first()
    if last:
        raw = ''.join(ch for ch in str(last) if ch.isdigit())
        try:
            return f'{prefix}{int(raw) + 1:0{digits}d}'
        except (TypeError, ValueError):
            pass
    return f'{prefix}{1:0{digits}d}'


# ─── Vendor Serializers ──────────────────────────────────────────────────────

class VendorSerializer(serializers.ModelSerializer):
    logo_url = serializers.SerializerMethodField()
    balance_due = serializers.SerializerMethodField()

    def get_logo_url(self, obj):
        request = self.context.get('request')
        if obj.logo and request:
            return request.build_absolute_uri(obj.logo.url)
        return ''

    def get_balance_due(self, obj):
        # Annotation থাকলে ব্যবহার করো, না থাকলে property fallback।
        annotated = getattr(obj, 'total_due', None)
        if annotated is not None:
            return float(annotated or 0)
        return float(obj.balance_due)

    class Meta:
        model = Vendor
        fields = '__all__'


# ─── Requisition Serializers ─────────────────────────────────────────────────

class PurchaseRequisitionItemSerializer(serializers.ModelSerializer):
    item_name = serializers.ReadOnlyField(source='item.name')
    unit_name = serializers.ReadOnlyField(source='unit.name')
    vendor_name = serializers.ReadOnlyField(source='vendor_suggestion.name')
    item = serializers.PrimaryKeyRelatedField(
        queryset=Item.objects.all(), required=False, allow_null=True,
    )
    unit = serializers.PrimaryKeyRelatedField(
        queryset=Unit.objects.all(), required=False, allow_null=True,
    )
    vendor_suggestion = serializers.PrimaryKeyRelatedField(
        queryset=Vendor.objects.all(), required=False, allow_null=True,
    )

    class Meta:
        model = PurchaseRequisitionItem
        fields = '__all__'
        read_only_fields = ['requisition', 'total']


class PurchaseRequisitionSerializer(serializers.ModelSerializer):
    req_items = PurchaseRequisitionItemSerializer(many=True, required=False)
    req_items_payload = serializers.JSONField(write_only=True, required=False)
    requisition_no = serializers.CharField(required=False, allow_blank=True)
    requested_by_name = serializers.SerializerMethodField()
    total_amount = serializers.SerializerMethodField()

    def get_requested_by_name(self, obj):
        u = obj.requested_by
        if not u:
            return ''
        return u.get_full_name() or u.username

    def get_total_amount(self, obj):
        return float(obj.total_amount)

    class Meta:
        model = PurchaseRequisition
        fields = '__all__'
        read_only_fields = ['created_at']

    def _save_items(self, requisition, items_data):
        # পুরোনো items মুছে নতুন save করি (upsert pattern নয়, clean replace)।
        requisition.req_items.all().delete()
        for line in items_data:
            line = {k: v for k, v in line.items() if k != 'id'}
            # item/unit/vendor_suggestion তিন ফরম্যাটে আসতে পারে — সব handle।
            for fk in ('item', 'unit', 'vendor_suggestion'):
                val = line.pop(f'{fk}_id', None)
                if val is None:
                    val = line.pop(fk, None)
                if val is not None:
                    line[f'{fk}_id'] = val
            PurchaseRequisitionItem.objects.create(
                requisition=requisition, **line,
            )

    def create(self, validated_data):
        items_data = validated_data.pop('req_items_payload', None)
        if items_data is None:
            items_data = validated_data.pop('req_items', [])
        if isinstance(items_data, str):
            items_data = json.loads(items_data or '[]')
        if not validated_data.get('requisition_no'):
            validated_data['requisition_no'] = _next_code(
                'REQ-', PurchaseRequisition.objects.all(), 'requisition_no',
            )
        req = PurchaseRequisition.objects.create(**validated_data)
        self._save_items(req, items_data)
        return req

    def update(self, instance, validated_data):
        items_data = validated_data.pop('req_items_payload', None)
        if items_data is None and 'req_items' in validated_data:
            items_data = validated_data.pop('req_items', None)
        if isinstance(items_data, str):
            items_data = json.loads(items_data or '[]')
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if items_data is not None:
            self._save_items(instance, items_data)
        return instance


# ─── Purchase Order Serializers ───────────────────────────────────────────────

class PurchaseOrderItemSerializer(serializers.ModelSerializer):
    item_name = serializers.ReadOnlyField(source='item.name')
    unit_name = serializers.ReadOnlyField(source='unit.name')
    store_name = serializers.ReadOnlyField(source='store.name')
    item = serializers.PrimaryKeyRelatedField(
        queryset=Item.objects.all(), required=False, allow_null=True,
    )
    unit = serializers.PrimaryKeyRelatedField(
        queryset=Unit.objects.all(), required=False, allow_null=True,
    )
    store = serializers.PrimaryKeyRelatedField(
        queryset=StoreLocation.objects.all(), required=False, allow_null=True,
    )

    class Meta:
        model = PurchaseOrderItem
        fields = '__all__'
        read_only_fields = ['order', 'total_price', 'total_amount']


class PurchaseBillSerializer(serializers.ModelSerializer):
    vendor_name = serializers.SerializerMethodField()
    vendor_id = serializers.SerializerMethodField()

    def get_vendor_name(self, obj):
        try:
            return obj.order.vendor.name
        except Exception:
            return ''

    def get_vendor_id(self, obj):
        try:
            return obj.order.vendor_id
        except Exception:
            return None

    class Meta:
        model = PurchaseBill
        fields = '__all__'


class PurchaseOrderSerializer(serializers.ModelSerializer):
    vendor_name = serializers.ReadOnlyField(source='vendor.name')
    items = PurchaseOrderItemSerializer(many=True, required=False)
    items_payload = serializers.JSONField(write_only=True, required=False)
    bills = PurchaseBillSerializer(many=True, read_only=True)
    order_no = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = PurchaseOrder
        fields = '__all__'
        read_only_fields = ['total_amount', 'created_at', 'updated_at']

    def _save_items(self, order, items_data):
        # Replace strategy: পুরোনো items মুছে নতুন।
        order.items.all().delete()
        for line in items_data:
            line = {k: v for k, v in line.items() if k != 'id'}
            for fk in ('item', 'unit', 'store'):
                val = line.pop(f'{fk}_id', None)
                if val is None:
                    val = line.pop(fk, None)
                if val is not None:
                    line[f'{fk}_id'] = val
            PurchaseOrderItem.objects.create(order=order, **line)
        order.recalculate_total(save=True)

    def _auto_create_bill(self, order):
        # Purchase order save হলে automatically একটি bill তৈরি করি।
        # কেন: screenshot-এর Purchase List-এ bill_no দেখা যায়, তাই
        # order তৈরির সাথে সাথে bill তৈরি হওয়া দরকার।
        if not order.bills.exists():
            bill_no = _next_code('PO-BILL-', PurchaseBill.objects.all(), 'bill_no')
            bill = PurchaseBill.objects.create(
                order=order,
                bill_no=bill_no,
                bill_date=order.order_date,
                total_amount=order.total_amount,
                paid_amount=Decimal('0.00'),
                discount_amount=Decimal('0.00'),
                due_amount=order.total_amount,
                status='unpaid',
            )
            return bill
        else:
            # Existing bill total update।
            bill = order.bills.first()
            bill.total_amount = order.total_amount
            bill.due_amount = max(
                order.total_amount - (bill.paid_amount or 0) - (bill.discount_amount or 0),
                Decimal('0.00'),
            )
            bill.save(update_fields=['total_amount', 'due_amount', 'updated_at'])
            return bill

    def create(self, validated_data):
        items_data = validated_data.pop('items_payload', None)
        if items_data is None:
            items_data = validated_data.pop('items', [])
        if isinstance(items_data, str):
            items_data = json.loads(items_data or '[]')
        if not validated_data.get('order_no'):
            validated_data['order_no'] = _next_code(
                'PO-', PurchaseOrder.objects.all(), 'order_no',
            )
        order = PurchaseOrder.objects.create(**validated_data)
        self._save_items(order, items_data)
        self._auto_create_bill(order)
        order.refresh_from_db()
        return order

    def update(self, instance, validated_data):
        items_data = validated_data.pop('items_payload', None)
        if items_data is None and 'items' in validated_data:
            items_data = validated_data.pop('items', None)
        if isinstance(items_data, str):
            items_data = json.loads(items_data or '[]')
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if items_data is not None:
            self._save_items(instance, items_data)
        self._auto_create_bill(instance)
        instance.refresh_from_db()
        return instance


# ─── Provider / Bandwidth Bill Serializers ───────────────────────────────────

class ProviderSerializer(serializers.ModelSerializer):
    bill_count = serializers.SerializerMethodField()
    current_due = serializers.SerializerMethodField()
    logo_url = serializers.SerializerMethodField()

    def get_bill_count(self, obj):
        return int(getattr(obj, 'total_bills', None) or obj.bills.count())

    def get_current_due(self, obj):
        annotated = getattr(obj, 'total_due', None)
        if annotated is not None:
            return float(annotated or 0)
        return float(obj.current_due)

    def get_logo_url(self, obj):
        request = self.context.get('request')
        if obj.logo and request:
            return request.build_absolute_uri(obj.logo.url)
        return ''

    class Meta:
        model = Provider
        fields = '__all__'


class ProviderBillLineSerializer(serializers.ModelSerializer):
    # Bandwidth Buy line — item FK নেই, শুধু description।
    class Meta:
        model = ProviderBillLine
        fields = '__all__'


class ProviderBillPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProviderBillPayment
        fields = '__all__'
        read_only_fields = ['bill', 'journal_entry', 'created_at', 'created_by']


def _normalize_bill_line(line_data):
    """provider bill line payload cleanup — id বাদ, item_id/item → item_id normalize।"""
    line_data.pop('id', None)
    item_value = line_data.pop('item_id', None)
    if item_value is None:
        item_value = line_data.pop('item', None)
    if item_value:
        line_data['item_id'] = item_value
    return line_data


class ProviderBillSerializer(serializers.ModelSerializer):
    provider_name = serializers.ReadOnlyField(source='provider.name')
    provider_contact_person = serializers.ReadOnlyField(source='provider.contact_person')
    lines = ProviderBillLineSerializer(many=True, required=False)
    lines_payload = serializers.JSONField(write_only=True, required=False)
    payments = ProviderBillPaymentSerializer(many=True, read_only=True)
    bill_no = serializers.CharField(required=False, allow_blank=True)
    invoice_no = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = ProviderBill
        fields = '__all__'
        read_only_fields = ['paid_amount', 'due_amount', 'status', 'created_at', 'updated_at']

    def create(self, validated_data):
        lines_data = validated_data.pop('lines_payload', None)
        if lines_data is None:
            lines_data = validated_data.pop('lines', [])
        if isinstance(lines_data, str):
            lines_data = json.loads(lines_data or '[]')
        if not validated_data.get('bill_no'):
            validated_data['bill_no'] = _next_code(
                'PB-', ProviderBill.objects.all(), 'bill_no',
            )
        if not validated_data.get('invoice_no'):
            validated_data['invoice_no'] = _next_code(
                'INV-', ProviderBill.objects.all(), 'invoice_no',
            )
        bill = ProviderBill.objects.create(**validated_data)
        for line_data in lines_data:
            ProviderBillLine.objects.create(bill=bill, **_normalize_bill_line(line_data))
        bill.recalculate_totals(save=True)
        return bill

    def update(self, instance, validated_data):
        lines_data = validated_data.pop('lines_payload', None)
        if lines_data is None and 'lines' in validated_data:
            lines_data = validated_data.pop('lines', None)
        if isinstance(lines_data, str):
            lines_data = json.loads(lines_data or '[]')
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if lines_data is not None:
            instance.lines.all().delete()
            for line_data in lines_data:
                ProviderBillLine.objects.create(bill=instance, **_normalize_bill_line(line_data))
        instance.recalculate_totals(save=True)
        return instance
