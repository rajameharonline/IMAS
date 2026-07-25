# Inventory API views — ISP hardware item management।
# Bandwidth Buy থেকে সম্পূর্ণ আলাদা।
from django.db import transaction
from django.db.models import Sum, Count
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response


class UnlimitedPagination(PageNumberPagination):
    # Inventory master data (Unit, Category, Item ইত্যাদি) ছোট dataset।
    # কেন: tree view build করতে সব data একবারে দরকার; page-by-page আনলে
    # root category miss হয় এবং tree empty দেখায়।
    page_size = 1000
    page_size_query_param = 'page_size'
    max_page_size = 2000

from inventory.models import ItemCategory, Item, Unit, StoreLocation, Stock, StockTransaction
from inventory.api.serializers import (
    ItemCategorySerializer, ItemSerializer, UnitSerializer,
    StoreLocationSerializer, StockSerializer, StockTransactionSerializer,
)

# ── ISP Sample Category data ─────────────────────────────────────────────────
# এই data-টি "Copy This Data" button press করলে database-এ insert হবে।
# কেন hardcode: নতুন ISP installation-এ প্রতিবার category manually তৈরি করা
# সময়সাপেক্ষ; pre-built ISP taxonomy একটি common standard হিসেবে কাজ করে।
ISP_SAMPLE_CATEGORIES = [
    {
        "name": "UTP Cable",
        "description": "Unshielded-Twisted-Pair (UTP) Cable",
        "children": [
            {"name": "Cat 5 Cable",  "description": "Ethernet Cable Cat 5"},
            {"name": "Cat 6 Cable",  "description": "Ethernet Cable Cat 6"},
        ],
    },
    {
        "name": "Fiber Optic Cable",
        "description": "Fiber Optic Cable",
        "children": [
            {"name": "2 Core Fiber Optic Cable",  "description": "2 Core Fiber Optic Cable"},
            {"name": "4 Core Fiber Optic Cable",  "description": "4 Core Fiber Optic Cable"},
            {"name": "6 Core Fiber Optic Cable",  "description": "6 Core Fiber Optic Cable"},
            {"name": "12 Core Fiber Optic Cable", "description": "12 Core Fiber Optic Cable"},
            {"name": "16 Core Fiber Optic Cable", "description": "16 Core Fiber Optic Cable"},
            {"name": "24 Core Fiber Optic Cable", "description": "24 Core Fiber Optic Cable"},
        ],
    },
    {
        "name": "Server",
        "description": "Bandwidth Management Server",
        "children": [
            {"name": "MikroTik Router", "description": "MikroTik router"},
            {"name": "Cisco",           "description": "Cisco"},
        ],
    },
    {
        "name": "Switch",
        "description": "Network Switch",
        "children": [
            {
                "name": "Manageable Switch",
                "description": "Managed switches",
                "children": [
                    {"name": "L2 Managed Switch", "description": "Layer 2 Managed Switch"},
                    {"name": "L3 Managed Switch", "description": "Layer 3 Managed Switch"},
                ],
            },
            {
                "name": "Unmanaged Switch",
                "description": "Unmanageable Switch",
                "children": [
                    {"name": "5 Port Unmanaged Switch",  "description": "5 Port"},
                    {"name": "8 Port Unmanaged Switch",  "description": "8 Port"},
                    {"name": "16 Port Unmanaged Switch", "description": "16 Port"},
                ],
            },
        ],
    },
    {
        "name": "OLT",
        "description": "Optical line termination",
        "children": [
            {
                "name": "GEPON OLT",
                "description": "GEPON OLT",
                "children": [
                    {"name": "GEPON OLT 4 Port",  "description": "4 Port GEPON OLT"},
                    {"name": "GEPON OLT 8 Port",  "description": "8 Port GEPON OLT"},
                    {"name": "GEPON OLT 16 Port", "description": "16 Port GEPON OLT"},
                ],
            },
            {
                "name": "EPON OLT",
                "description": "EPON OLT",
                "children": [
                    {"name": "EPON OLT 4 Port",  "description": "4 Port EPON OLT"},
                    {"name": "EPON OLT 8 Port",  "description": "8 Port EPON OLT"},
                    {"name": "EPON OLT 16 Port", "description": "16 Port EPON OLT"},
                ],
            },
        ],
    },
    {
        "name": "ONU",
        "description": "Optical Network Units",
        "children": [
            {
                "name": "EPON ONU",
                "description": "EPON ONU",
                "children": [
                    {"name": "EPON ONU 1 Port", "description": "1 Port EPON ONU"},
                    {"name": "EPON ONU 4 Port", "description": "4 Port EPON ONU"},
                ],
            },
            {"name": "GEPON ONU", "description": "GEPON ONU"},
        ],
    },
    {
        "name": "Router",
        "description": "WiFi Router",
        "children": [
            {"name": "1 Antenna Wireless Router", "description": "1 Antenna Wireless Router"},
            {"name": "2 Antenna Wireless Router", "description": "2 Antenna Wireless Router"},
            {"name": "3 Antenna Wireless Router", "description": "3 Antenna Wireless Router"},
            {"name": "4 Antenna Wireless Router", "description": "4 Antenna Wireless Router"},
        ],
    },
    {
        "name": "Equipment",
        "description": "Network Service Equipment",
        "children": [
            {"name": "Ethernet Crimp Tool", "description": "RJ45 Crimping Tool"},
        ],
    },
    {
        "name": "PON Module",
        "description": "PON Module",
        "children": [
            {"name": "EPON OLT PON Module", "description": "EPON OLT PON Module"},
            {"name": "GPON OLT PON Module", "description": "GPON OLT PON Module"},
        ],
    },
    {
        "name": "Splitter",
        "description": "Fiber Optic Cable FTTH Splitter",
        "children": [
            {"name": "1*2 Optical Fiber Splitter",  "description": "1x2 Splitter"},
            {"name": "1*4 Optical Fiber Splitter",  "description": "1x4 Splitter"},
            {"name": "1*8 Optical Fiber Splitter",  "description": "1x8 Splitter"},
            {"name": "1*16 Optical Fiber Splitter", "description": "1x16 Splitter"},
            {"name": "1*32 Optical Fiber Splitter", "description": "1x32 Splitter"},
            {"name": "1*64 Optical Fiber Splitter", "description": "1x64 Splitter"},
        ],
    },
]


def _create_categories_recursive(items_data, parent=None):
    # Recursive helper: parent category তৈরি করে তারপর children।
    created = 0
    for item_data in items_data:
        children = item_data.pop('children', [])
        obj, _ = ItemCategory.objects.get_or_create(
            name=item_data['name'],
            defaults={**item_data, 'parent': parent, 'is_active': True},
        )
        created += 1
        created += _create_categories_recursive(children, parent=obj)
    return created


class UnitViewSet(viewsets.ModelViewSet):
    queryset = Unit.objects.all().order_by('name')
    serializer_class = UnitSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = UnlimitedPagination
    search_fields = ['name', 'symbol']


class StoreLocationViewSet(viewsets.ModelViewSet):
    queryset = StoreLocation.objects.filter(is_active=True).order_by('name')
    serializer_class = StoreLocationSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = UnlimitedPagination
    search_fields = ['name', 'short_value', 'address']
    filterset_fields = ['is_active']


class ItemCategoryViewSet(viewsets.ModelViewSet):
    queryset = ItemCategory.objects.select_related('parent').prefetch_related('children').all()
    serializer_class = ItemCategorySerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = UnlimitedPagination
    filterset_fields = ['is_active', 'parent']
    search_fields = ['name', 'description']

    @action(detail=False, methods=['get'], url_path='sample-data')
    def sample_data(self, request):
        # Sample ISP category tree preview-এর জন্য।
        # কেন flat list না: UI-তে tree hierarchy দেখাতে হবে।
        def build_tree(items, depth=0):
            result = []
            for item in items:
                children = item.get('children', [])
                result.append({
                    'name': item['name'],
                    'description': item.get('description', ''),
                    'depth': depth,
                    'children_count': len(children),
                })
                result.extend(build_tree(children, depth + 1))
            return result

        import copy
        flat = build_tree(copy.deepcopy(ISP_SAMPLE_CATEGORIES))
        return Response({'categories': flat, 'total': len(flat)})

    @action(detail=False, methods=['post'], url_path='copy-sample-data')
    def copy_sample_data(self, request):
        # "Copy This Data" button — সব sample category database-এ insert করে।
        import copy
        with transaction.atomic():
            data = copy.deepcopy(ISP_SAMPLE_CATEGORIES)
            created = _create_categories_recursive(data)
        return Response({
            'message': f'{created} categories created/verified.',
            'total': created,
        })


class ItemViewSet(viewsets.ModelViewSet):
    queryset = Item.objects.select_related(
        'category', 'unit',
    ).prefetch_related('stocks').all()
    serializer_class = ItemSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = UnlimitedPagination
    filterset_fields = ['category', 'unit', 'is_active', 'item_type', 'is_serialized']
    search_fields = ['code', 'name', 'description']

    def perform_create(self, serializer):
        # code auto-generate করি যদি blank দেওয়া হয়।
        import uuid
        data = serializer.validated_data
        if not data.get('code'):
            prefix = 'ITM'
            last = Item.objects.order_by('-id').values_list('id', flat=True).first() or 0
            data['code'] = f'{prefix}-{last + 1:05d}'
        serializer.save()

    @action(detail=False, methods=['get'], url_path='by-category')
    def by_category(self, request):
        # Stock page + Item page tree view-এর জন্য category-grouped items।
        categories = ItemCategory.objects.prefetch_related('items__stocks').order_by('name')
        result = []
        for cat in categories:
            items = cat.items.filter(is_active=True).select_related('unit')
            if items.exists():
                result.append({
                    'category_id': cat.id,
                    'category_name': cat.name,
                    'parent_id': cat.parent_id,
                    'items': ItemSerializer(items, many=True).data,
                })
        return Response(result)


class StockViewSet(viewsets.ModelViewSet):
    queryset = Stock.objects.select_related('item__category', 'store').all()
    serializer_class = StockSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['item', 'store']

    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request):
        # Stock page stat cards।
        agg = Stock.objects.aggregate(
            total_items=Count('item', distinct=True),
            total_qty=Sum('quantity'),
            total_value=Sum('quantity'),
        )
        return Response({
            'total_items': agg['total_items'] or 0,
            'total_qty': float(agg['total_qty'] or 0),
            'stores': StoreLocation.objects.filter(is_active=True).count(),
        })

    @action(detail=False, methods=['get'], url_path='by-category')
    def by_category(self, request):
        # Stock tree view — category → items → stores with qty।
        stocks = Stock.objects.select_related(
            'item__category', 'item__unit', 'store',
        ).order_by('item__category__name', 'item__name')

        tree = {}
        for s in stocks:
            cat_name = s.item.category.name if s.item.category else 'Uncategorized'
            cat_id = s.item.category_id or 0
            if cat_id not in tree:
                tree[cat_id] = {
                    'category_id': cat_id,
                    'category_name': cat_name,
                    'items': {},
                }
            item_id = s.item_id
            if item_id not in tree[cat_id]['items']:
                tree[cat_id]['items'][item_id] = {
                    'item_id': item_id,
                    'item_name': s.item.name,
                    'item_code': s.item.code,
                    'unit_name': s.item.unit.name if s.item.unit else '',
                    'is_serialized': s.item.is_serialized,
                    'total_qty': 0,
                    'stores': [],
                }
            tree[cat_id]['items'][item_id]['total_qty'] += float(s.quantity or 0)
            tree[cat_id]['items'][item_id]['stores'].append({
                'store_id': s.store_id,
                'store_name': s.store.name,
                'store_short': s.store.short_value,
                'qty': float(s.quantity or 0),
            })

        result = []
        for cat_data in tree.values():
            cat_data['items'] = list(cat_data['items'].values())
            result.append(cat_data)
        return Response(result)


def models_sum_helper():
    from django.db.models import F
    return F('item__minimum_stock')


class StockTransactionViewSet(viewsets.ModelViewSet):
    queryset = StockTransaction.objects.select_related('item', 'store', 'created_by').order_by('-created_at')
    serializer_class = StockTransactionSerializer
    permission_classes = [permissions.IsAuthenticated]
    filterset_fields = ['item', 'store', 'transaction_type']

    def perform_create(self, serializer):
        # Stock transaction save করার পর Stock table update।
        with transaction.atomic():
            txn = serializer.save(created_by=self.request.user)
            stock, _ = Stock.objects.get_or_create(
                item=txn.item, store=txn.store,
                defaults={'quantity': 0, 'unit_price': txn.unit_price},
            )
            if txn.transaction_type == 'in':
                stock.quantity += txn.quantity
            elif txn.transaction_type == 'out':
                stock.quantity = max(stock.quantity - txn.quantity, 0)
            elif txn.transaction_type == 'adjustment':
                stock.quantity = txn.quantity
            if txn.unit_price:
                stock.unit_price = txn.unit_price
            stock.save()
