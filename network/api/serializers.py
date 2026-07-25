# network/api/serializers.py
# ─────────────────────────────────────────────────────────────────────────────
# এই ফাইলে NetworkNode ও NetworkLink মডেলের DRF serializer সংজ্ঞায়িত।
#
# কেন আলাদা serializer:
#  • NetworkNodeSerializer — মানচিত্রের মার্কার ডেটা + topology card ডেটা উভয়ের জন্য।
#  • NetworkLinkSerializer — Leaflet পলিলাইনের paths array সহ সংযোগের বিস্তারিত।
#  • NetworkNodeMinimalSerializer — Topology edge-এর source/target label
#    render করতে ব্যবহার হয় (nested নেস্টেড হলে data ছোট থাকে)।
# ─────────────────────────────────────────────────────────────────────────────

from rest_framework import serializers
from network.models import NetworkNode, NetworkLink


class NetworkNodeMinimalSerializer(serializers.ModelSerializer):
    """
    Topology edge label ও dropdown-এ নাম দেখানোর জন্য ন্যূনতম ক্ষেত্র।
    পুরো serializer nest করলে payload বড় হয়ে যায়, তাই আলাদা।
    """
    class Meta:
        model = NetworkNode
        fields = ['id', 'name', 'node_type', 'status']


class NetworkNodeSerializer(serializers.ModelSerializer):
    """
    GIS মানচিত্র ও topology উভয় ক্ষেত্রে নোডের সম্পূর্ণ তথ্য।
    display field গুলো read-only — frontend-এ human-readable label দেখাতে সাহায্য করে।
    """
    node_type_display = serializers.CharField(
        source='get_node_type_display', read_only=True
    )
    status_display = serializers.CharField(
        source='get_status_display', read_only=True
    )
    router_name = serializers.CharField(
        source='router.name', read_only=True, default=None
    )
    client_name = serializers.CharField(
        source='client.full_name', read_only=True, default=None
    )
    # CharField ব্যবহার করা হচ্ছে কারণ IPAddressField allow_blank=True দিলেও
    # built-in IP validator empty string reject করে। validate_ip_address-এ
    # empty string → None convert করার পরে model-level validation চলে।
    ip_address = serializers.CharField(
        allow_null=True, allow_blank=True, required=False
    )

    class Meta:
        model = NetworkNode
        fields = [
            'id', 'name', 'node_type', 'node_type_display',
            'ip_address', 'status', 'status_display',
            'splitter_ratio', 'port_count', 'uplink_count',
            'latitude', 'longitude',
            'router', 'router_name',
            'client', 'client_name',
            'pos_x', 'pos_y',
            'description',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']

    def validate_ip_address(self, value):
        if not value:
            return None
        from django.core.validators import validate_ipv46_address
        from django.core.exceptions import ValidationError as DjangoValidationError
        try:
            validate_ipv46_address(value)
        except DjangoValidationError:
            raise serializers.ValidationError('Enter a valid IPv4 or IPv6 address.')
        return value


# ── NetworkLink.validate() helpers (প্রতিটি check আলাদা, ব্যর্থ হলে ValidationError) ──
def _link_validate_port_unique(base_qs, node, port, field):
    """একটি node-port জোড়া অন্য কোনো link-এ ব্যবহৃত হলে ValidationError।"""
    if not (port and node):
        return
    from django.db.models import Q
    conflict = base_qs.filter(
        Q(source_node=node, source_port=port) | Q(target_node=node, target_port=port)
    ).first()
    if conflict:
        peer = conflict.target_node.name if conflict.source_node == node else conflict.source_node.name
        raise serializers.ValidationError({
            field: f'Port "{port}" on {node.name} is already connected to "{peer}".'
        })


def _link_validate_client_single(base_qs, nodes):
    """CLIENT node (ONU = single optical port)-এ ইতিমধ্যে connection থাকলে ValidationError।"""
    from django.db.models import Q
    for node, field in nodes:
        if node and getattr(node, 'node_type', None) == 'CLIENT':
            if base_qs.filter(Q(source_node=node) | Q(target_node=node)).exists():
                raise serializers.ValidationError({
                    field: (
                        f'Client "{node.name}"-এর ONU-তে একটিমাত্র optical port আছে। '
                        f'ইতিমধ্যে একটি fiber connection বিদ্যমান।'
                    )
                })


def _link_validate_pair_duplicate(base_qs, src_node, tgt_node, src_port, tgt_port):
    """port উভয়ই খালি হলে একই node-pair-এ duplicate link block।"""
    if not (src_node and tgt_node and not src_port and not tgt_port):
        return
    from django.db.models import Q
    if base_qs.filter(
        Q(source_node=src_node, target_node=tgt_node) |
        Q(source_node=tgt_node, target_node=src_node)
    ).exists():
        raise serializers.ValidationError(
            f'{src_node.name} ↔ {tgt_node.name} ইতিমধ্যে connected। '
            f'নতুন link তৈরি করতে উভয় node-এর port নির্ধারণ করুন।'
        )


def _link_validate_core_unique(base_qs, src_node, tgt_node, core, force_override):
    """একই cable-এ same fiber core duplicate block (force_override হলে skip)।"""
    if not (core and src_node and tgt_node and '→' not in core and not force_override):
        return
    from django.db.models import Q
    conflict = base_qs.filter(
        Q(source_node=src_node, target_node=tgt_node) |
        Q(source_node=tgt_node, target_node=src_node),
        fiber_core_color__icontains=core,
    ).first()
    if conflict:
        raise serializers.ValidationError({
            'fiber_core_color': (
                f'Core "{core}" is already used on the cable between '
                f'{src_node.name} and {tgt_node.name}. '
                f'Use force_core_override=true to override.'
            )
        })


class NetworkLinkSerializer(serializers.ModelSerializer):
    """
    দুই নোডের মধ্যে সংযোগ — paths JSONField Leaflet পলিলাইনে সরাসরি ব্যবহার হয়।
    source_node_name / target_node_name → map tooltip ও topology edge label।
    """
    source_node_name = serializers.CharField(
        source='source_node.name', read_only=True
    )
    target_node_name = serializers.CharField(
        source='target_node.name', read_only=True
    )
    source_node_type = serializers.CharField(
        source='source_node.node_type', read_only=True
    )
    target_node_type = serializers.CharField(
        source='target_node.node_type', read_only=True
    )
    source_node_ip = serializers.CharField(
        source='source_node.ip_address', read_only=True, default=None
    )
    target_node_ip = serializers.CharField(
        source='target_node.ip_address', read_only=True, default=None
    )
    link_type_display = serializers.CharField(
        source='get_link_type_display', read_only=True
    )
    status_display = serializers.CharField(
        source='get_status_display', read_only=True
    )

    class Meta:
        model = NetworkLink
        fields = [
            'id',
            'source_node', 'source_node_name', 'source_node_type', 'source_node_ip',
            'target_node', 'target_node_name', 'target_node_type', 'target_node_ip',
            'source_port', 'target_port',
            'link_type', 'link_type_display',
            'fiber_company', 'cable_code',
            'fiber_core_count', 'fiber_used_cores', 'fiber_core_color',
            'fiber_core_details',
            'color_code', 'distance',
            'paths', 'status', 'status_display',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']

    def validate(self, data):
        from network.models import NetworkLink as NL
        instance_pk = self.instance.pk if self.instance else None
        base_qs = NL.objects.exclude(pk=instance_pk) if instance_pk else NL.objects.all()

        src_node = data.get('source_node')
        tgt_node = data.get('target_node')
        src_port = (data.get('source_port') or '').strip()
        tgt_port = (data.get('target_port') or '').strip()
        core     = (data.get('fiber_core_color') or '').strip()
        # force_core_override=true পাঠালে core-uniqueness check skip হবে (manual override)
        force_override = str(self.initial_data.get('force_core_override', '')).lower() in ('true', '1', 'yes')

        _link_validate_port_unique(base_qs, src_node, src_port, 'source_port')
        _link_validate_port_unique(base_qs, tgt_node, tgt_port, 'target_port')
        _link_validate_client_single(base_qs, [(src_node, 'source_node'), (tgt_node, 'target_node')])
        _link_validate_pair_duplicate(base_qs, src_node, tgt_node, src_port, tgt_port)
        _link_validate_core_unique(base_qs, src_node, tgt_node, core, force_override)
        return data

    def validate_paths(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("paths must be a list of {lat, lng} objects.")
        for point in value:
            if not isinstance(point, dict) or 'lat' not in point or 'lng' not in point:
                raise serializers.ValidationError(
                    "Each path point must have 'lat' and 'lng' keys."
                )
        return value
