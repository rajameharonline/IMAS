# network/api/views.py
# ─────────────────────────────────────────────────────────────────────────────
# এই ফাইলে দুটি ViewSet এবং একটি বিশেষ topology endpoint রয়েছে।
#
#  NetworkNodeViewSet  — CRUD + node_type/status filter
#  NetworkLinkViewSet  — CRUD + link_type/status filter + bulk_paths PATCH
#  topology_data       — React Flow-এর জন্য formatted nodes/edges
#
# কেন আলাদা topology endpoint:
#   React Flow-এর জন্য প্রতিটি node-এ 'id', 'type', 'position', 'data' লাগে।
#   আর প্রতিটি edge-এ 'id', 'source', 'target', 'style' লাগে।
#   এই transformation backend-এ করলে frontend-এ extra mapping loop লাগে না।
# ─────────────────────────────────────────────────────────────────────────────

from collections import defaultdict

from rest_framework import viewsets, status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from network.models import NetworkNode, NetworkLink
from .serializers import NetworkNodeSerializer, NetworkLinkSerializer

# নোড type অনুযায়ী hierarchy level — topology-তে উপরে/নিচে সাজাতে
NODE_TYPE_LEVEL = {
    'ROUTER':   0,
    'OLT':      1,
    'SPLITTER': 2,
    'BOX':      3,
    'CLIENT':   4,
}

# Topology canvas-এ প্রতিটি type-এর background color
NODE_TYPE_BG = {
    'ROUTER':   '#1e3a5f',
    'OLT':      '#4c1d95',
    'SPLITTER': '#0c4a6e',
    'BOX':      '#064e3b',
    'CLIENT':   '#78350f',
}

# Status অনুযায়ী border color — node কতটা সুস্থ তা বোঝাতে
STATUS_BORDER = {
    'active':      '#10b981',   # সবুজ = সচল
    'inactive':    '#ef4444',   # লাল = বন্ধ
    'maintenance': '#f59e0b',   # হলুদ = রক্ষণাবেক্ষণ
    'unknown':     '#6b7280',   # ধূসর = অজানা
}

# Topology-তে level-এর উল্লম্ব ব্যবধান (pixel)
LEVEL_Y_STEP = 180
# একই level-এর নোডের আনুভূমিক ব্যবধান
LEVEL_X_STEP = 220


class NetworkNodeViewSet(viewsets.ModelViewSet):
    """
    নেটওয়ার্ক নোড CRUD।
    query params:
      ?node_type=ROUTER|OLT|SPLITTER|BOX|CLIENT
      ?status=active|inactive|maintenance|unknown
    এই filter ব্যবহার করে sidebar-এর node list দ্রুত load করা যায়।
    """
    serializer_class = NetworkNodeSerializer

    def get_queryset(self):
        qs = NetworkNode.objects.select_related('router', 'client').all()
        node_type = self.request.query_params.get('node_type')
        node_status = self.request.query_params.get('status')
        if node_type:
            qs = qs.filter(node_type=node_type)
        if node_status:
            qs = qs.filter(status=node_status)
        return qs


class NetworkLinkViewSet(viewsets.ModelViewSet):
    """
    নেটওয়ার্ক লিংক CRUD।
    query params:
      ?link_type=FIBER|ETHERNET|WIRELESS
      ?status=active|inactive|maintenance
      ?source_node=<id>   — নির্দিষ্ট source থেকে সব link দেখতে
      ?target_node=<id>   — নির্দিষ্ট target-এ আসা সব link দেখতে
    """
    serializer_class = NetworkLinkSerializer

    def get_queryset(self):
        qs = NetworkLink.objects.select_related(
            'source_node', 'target_node'
        ).all()
        link_type = self.request.query_params.get('link_type')
        link_status = self.request.query_params.get('status')
        source_id = self.request.query_params.get('source_node')
        target_id = self.request.query_params.get('target_node')
        if link_type:
            qs = qs.filter(link_type=link_type)
        if link_status:
            qs = qs.filter(status=link_status)
        if source_id:
            qs = qs.filter(source_node_id=source_id)
        if target_id:
            qs = qs.filter(target_node_id=target_id)
        return qs


@api_view(['GET'])
def topology_data(request):
    """
    React Flow canvas-এর জন্য প্রস্তুত nodes ও edges ফেরত দেয়।

    Algorithm:
    1. সব NetworkNode fetch করে node_type অনুযায়ী group করা হয়।
    2. প্রতিটি group-কে LEVEL_Y_STEP দিয়ে উল্লম্বভাবে সাজানো হয়।
    3. একই level-এর nodes-কে সমান আনুভূমিক ব্যবধানে সাজানো হয়।
    4. ব্যবহারকারী topology-তে drag করে pos_x/pos_y save করলে সেই
       stored position ব্যবহার হয়, না হলে auto-calculated position ব্যবহার হয়।
    5. প্রতিটি NetworkLink → React Flow edge হিসেবে convert হয়।
       animated=True হলে edge-এ flowing animation দেখা যায় (active link)।

    এই endpoint শুধু GET — React Flow state management পুরোটা frontend-এ।
    """
    nodes = list(NetworkNode.objects.select_related('router', 'client').all())
    links = list(NetworkLink.objects.select_related(
        'source_node', 'target_node'
    ).filter(status='active'))

    # type অনুযায়ী group করা
    type_groups = defaultdict(list)
    for node in nodes:
        type_groups[node.node_type].append(node)

    rf_nodes = []
    for node_type, group in sorted(
        type_groups.items(), key=lambda x: NODE_TYPE_LEVEL.get(x[0], 99)
    ):
        level = NODE_TYPE_LEVEL.get(node_type, 99)
        count = len(group)
        for i, node in enumerate(group):
            # pos_x/pos_y saved থাকলে ব্যবহার করো, না হলে auto-layout
            if node.pos_x or node.pos_y:
                x = node.pos_x
                y = node.pos_y
            else:
                # নোডগুলো center-aligned করতে offset calculation
                x = (i - (count - 1) / 2) * LEVEL_X_STEP + 600
                y = level * LEVEL_Y_STEP + 80

            rf_nodes.append({
                'id': str(node.id),
                'type': 'networkNode',   # custom node type — frontend-এ registered
                'position': {'x': float(x), 'y': float(y)},
                'data': {
                    'label':      node.name,
                    'nodeType':   node.node_type,
                    'typeLabel':  node.get_node_type_display(),
                    'status':     node.status,
                    'ip':         node.ip_address or '',
                    'routerName': node.router.name if node.router else None,
                    'bgColor':    NODE_TYPE_BG.get(node.node_type, '#374151'),
                    'borderColor': STATUS_BORDER.get(node.status, '#6b7280'),
                },
            })

    rf_edges = []
    for link in links:
        rf_edges.append({
            'id':     f'link-{link.id}',
            'source': str(link.source_node_id),
            'target': str(link.target_node_id),
            'label':  link.link_type,
            'animated': link.status == 'active',
            'style': {
                'stroke':      link.color_code or '#00bcd4',
                'strokeWidth': 2,
            },
            'labelStyle': {
                'fontSize': 10,
                'fill': '#94a3b8',
            },
            'data': {
                'linkId':    link.id,
                'fiberCore': link.fiber_core_details,
                'distance':  link.distance,
            },
        })

    return Response({'nodes': rf_nodes, 'edges': rf_edges}, status=status.HTTP_200_OK)


@api_view(['PATCH'])
def flip_link_direction(request, pk):
    """
    Topology-তে edge click করে "Flip" বললে source_node ↔ target_node swap হয়।
    এটি দরকার হয় যখন Network Map-এ link ভুল দিকে তৈরি হয়েছে।
    """
    try:
        link = NetworkLink.objects.get(pk=pk)
    except NetworkLink.DoesNotExist:
        return Response({'detail': 'Link not found.'}, status=status.HTTP_404_NOT_FOUND)

    link.source_node, link.target_node = link.target_node, link.source_node
    link.save(update_fields=['source_node', 'target_node', 'updated_at'])
    return Response({
        'id':     link.id,
        'source': link.source_node_id,
        'target': link.target_node_id,
    })


@api_view(['GET'])
def client_map_markers(request):
    """
    lat/lng থাকা সব Client কে GIS map-এ dynamic marker হিসেবে return করে।
    NetworkNode table থেকে আলাদা — শুধু Client model থেকে সরাসরি।
    """
    from clients.models import Client
    qs = Client.objects.filter(
        map_lat__isnull=False,
        map_lng__isnull=False,
    ).select_related('zone', 'subzone', 'package', 'router')

    data = [{
        'id':           c.id,
        'customer_id':  c.customer_id,
        'full_name':    c.full_name,
        'phone':        c.phone,
        'status':       c.status,
        'monthly_bill': str(c.monthly_bill),
        'due_amount':   str(c.due_amount),
        'latitude':     float(c.map_lat),
        'longitude':    float(c.map_lng),
        'zone_name':    c.zone.name    if c.zone    else '—',
        'subzone_name': c.subzone.name if c.subzone else '—',
        'package_name': c.package.name if c.package else '—',
        'router_name':  c.router.name  if c.router  else '—',
        'expiry_date':  str(c.expiry_date) if c.expiry_date else '—',
    } for c in qs]

    return Response(data)


@api_view(['PATCH'])
def update_node_position(request, pk):
    """
    React Flow-এ ব্যবহারকারী node drag করলে pos_x/pos_y update।
    শুধু position পরিবর্তন — পুরো node serialize করার দরকার নেই।
    """
    try:
        node = NetworkNode.objects.get(pk=pk)
    except NetworkNode.DoesNotExist:
        return Response({'detail': 'Node not found.'}, status=status.HTTP_404_NOT_FOUND)

    node.pos_x = request.data.get('pos_x', node.pos_x)
    node.pos_y = request.data.get('pos_y', node.pos_y)
    node.save(update_fields=['pos_x', 'pos_y', 'updated_at'])
    return Response({'id': node.id, 'pos_x': node.pos_x, 'pos_y': node.pos_y})
