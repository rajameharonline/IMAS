# network/api/urls.py
# ─────────────────────────────────────────────────────────────────────────────
# এই ফাইলে network module-এর সব API URL নিবন্ধিত।
#
# Router দিয়ে স্বয়ংক্রিয়ভাবে তৈরি endpoints:
#   GET/POST   /api/v1/network/nodes/
#   GET/PATCH/PUT/DELETE /api/v1/network/nodes/{id}/
#   GET/POST   /api/v1/network/links/
#   GET/PATCH/PUT/DELETE /api/v1/network/links/{id}/
#
# বিশেষ endpoints:
#   GET  /api/v1/network/topology/          — React Flow formatted data
#   PATCH /api/v1/network/nodes/{id}/position/ — Drag position save
# ─────────────────────────────────────────────────────────────────────────────

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    NetworkNodeViewSet,
    NetworkLinkViewSet,
    topology_data,
    update_node_position,
    flip_link_direction,
    client_map_markers,
)

router = DefaultRouter()
# নোড CRUD — মানচিত্রের মার্কার ডেটা
router.register(r'nodes', NetworkNodeViewSet, basename='network-node')
# লিংক CRUD — পলিলাইন ও সংযোগ ডেটা
router.register(r'links', NetworkLinkViewSet, basename='network-link')

urlpatterns = [
    path('', include(router.urls)),

    # React Flow topology-র জন্য formatted data
    path('topology/', topology_data, name='network-topology'),

    # Drag-and-drop position save — শুধু pos_x/pos_y update করে
    path('nodes/<int:pk>/position/', update_node_position, name='node-position-update'),

    # Link direction flip — source_node ↔ target_node swap করে
    path('links/<int:pk>/flip/', flip_link_direction, name='link-flip'),

    # Dynamic client markers — lat/lng থাকা সব client GIS map-এ দেখানোর জন্য
    path('client-markers/', client_map_markers, name='client-map-markers'),
]
