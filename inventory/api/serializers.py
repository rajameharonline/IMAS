# Inventory serializers — ISP hardware item, category, unit, store, stock।
# Bandwidth Buy-এর সাথে কোনো সম্পর্ক নেই।
from rest_framework import serializers
from inventory.models import ItemCategory, Item, Unit, StoreLocation, Stock, StockTransaction


class UnitSerializer(serializers.ModelSerializer):
    class Meta:
        model = Unit
        fields = '__all__'


class StoreLocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = StoreLocation
        fields = '__all__'


class ItemCategorySerializer(serializers.ModelSerializer):
    parent_name = serializers.ReadOnlyField(source='parent.name')
    children_count = serializers.SerializerMethodField()

    def get_children_count(self, obj):
        return obj.children.filter(is_active=True).count()

    class Meta:
        model = ItemCategory
        fields = '__all__'


class ItemSerializer(serializers.ModelSerializer):
    category_name = serializers.ReadOnlyField(source='category.name')
    unit_name = serializers.ReadOnlyField(source='unit.name')
    total_stock = serializers.SerializerMethodField()

    def get_total_stock(self, obj):
        return float(obj.total_stock)

    class Meta:
        model = Item
        fields = '__all__'


class StockSerializer(serializers.ModelSerializer):
    item_name = serializers.ReadOnlyField(source='item.name')
    item_code = serializers.ReadOnlyField(source='item.code')
    store_name = serializers.ReadOnlyField(source='store.name')
    category_name = serializers.SerializerMethodField()

    def get_category_name(self, obj):
        return obj.item.category.name if obj.item.category else ''

    class Meta:
        model = Stock
        fields = '__all__'


class StockTransactionSerializer(serializers.ModelSerializer):
    item_name = serializers.ReadOnlyField(source='item.name')
    store_name = serializers.ReadOnlyField(source='store.name')

    class Meta:
        model = StockTransaction
        fields = '__all__'
        read_only_fields = ['created_at', 'created_by']
