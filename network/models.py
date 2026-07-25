# এই ফাইলটি নেটওয়ার্ক ডায়াগ্রাম ও POP ম্যানেজমেন্টের জন্য।
from django.db import models
from django.conf import settings


class NetworkPOP(models.Model):
    # নেটওয়ার্ক POP (Point of Presence) / MAC Reseller
    POP_TYPE_CHOICES = [
        ('main',         'Main POP'),
        ('reseller',     'Reseller'),
        ('mac_reseller', 'MAC Reseller'),
        ('sub_pop',      'Sub POP'),
    ]
    code        = models.CharField(max_length=30, unique=True, blank=True, default='')
    name        = models.CharField(max_length=100, unique=True)
    pop_type    = models.CharField(max_length=20, choices=POP_TYPE_CHOICES, default='mac_reseller')
    owner_name  = models.CharField(max_length=100, blank=True)
    mobile      = models.CharField(max_length=20, blank=True)
    address     = models.TextField(blank=True)
    latitude    = models.DecimalField(max_digits=10, decimal_places=8, null=True, blank=True)
    longitude   = models.DecimalField(max_digits=11, decimal_places=8, null=True, blank=True)
    description = models.TextField(blank=True)
    is_active   = models.BooleanField(default=True)
    restrict_online_payment = models.BooleanField(default=False)
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'network_pops'
        indexes  = [models.Index(fields=['pop_type']), models.Index(fields=['is_active'])]

    def __str__(self):
        return f'{self.code} - {self.name}' if self.code else self.name

    def save(self, *args, **kwargs):
        # code auto-generate করো যদি না থাকে
        if not self.code:
            prefix  = 'POP'
            last    = NetworkPOP.objects.filter(code__startswith=prefix).order_by('-id').first()
            num     = (int(last.code[len(prefix):]) + 1) if last and last.code[len(prefix):].isdigit() else 1
            self.code = f'{prefix}{num:04d}'
        super().save(*args, **kwargs)


class NetworkConnection(models.Model):
    # দুটি নেটওয়ার্ক পয়েন্টের মধ্যে সংযোগ
    CONNECTION_TYPE_CHOICES = [
        ('fiber', 'Fiber Optic'), ('ethernet', 'Ethernet'),
        ('wireless', 'Wireless'), ('other', 'Other'),
    ]
    name = models.CharField(max_length=100)
    from_pop = models.ForeignKey(NetworkPOP, on_delete=models.CASCADE, related_name='outgoing_connections')
    to_pop = models.ForeignKey(NetworkPOP, on_delete=models.CASCADE, related_name='incoming_connections')
    connection_type = models.CharField(max_length=20, choices=CONNECTION_TYPE_CHOICES, default='fiber')
    bandwidth_gbps = models.FloatField(null=True, blank=True)
    distance_km = models.FloatField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'network_connections'


class NetworkDiagram(models.Model):
    # নেটওয়ার্ক ডায়াগ্রাম canvas data
    name = models.CharField(max_length=100)
    diagram_data = models.JSONField(default=dict)  # canvas JSON data
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'network_diagrams'


class DistributedInventoryItem(models.Model):
    # নেটওয়ার্কে বিতরণকৃত ইনভেন্টরি আইটেম (যেমন: কেব্ল, সুইচ, রাউটার)
    item = models.ForeignKey('inventory.Item', on_delete=models.CASCADE)
    pop = models.ForeignKey(NetworkPOP, on_delete=models.SET_NULL, null=True, blank=True)
    quantity = models.IntegerField(default=0)
    installation_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'distributed_inventory'


# ─────────────────────────────────────────────────────────────────────────────
# Module 9 — Network GIS Map & Topology
# NetworkNode: মানচিত্রে প্রতিটি নেটওয়ার্ক ডিভাইসের ভৌগোলিক অবস্থান সংরক্ষণ।
# NetworkLink: দুটি নোডের মধ্যে ফিজিক্যাল কানেকশন (ফাইবার/ইথারনেট/ওয়্যারলেস),
#              Google Maps/Leaflet পলিলাইনের পুরো coordinate path JSON আকারে রাখা হয়।
# ─────────────────────────────────────────────────────────────────────────────

class NetworkNode(models.Model):
    """
    নেটওয়ার্কের প্রতিটি physical বা logical ডিভাইস — Router, OLT, Splitter, Box, Client।
    latitude/longitude ব্যবহার করে Leaflet মানচিত্রে মার্কার বসানো হয়।
    router/client FK দিয়ে বিদ্যমান MikrotikServer ও Client ডেটার সাথে সম্পর্ক তৈরি হয়।
    pos_x/pos_y React Flow topology canvas-এ নোডের অবস্থান।
    """
    NODE_TYPE_CHOICES = [
        ('ROUTER',   'Core Router'),
        ('OLT',      'OLT Device'),
        ('SPLITTER', 'Fiber Splitter'),
        ('BOX',      'Distribution Box'),
        ('CLIENT',   'End Client'),
    ]
    STATUS_CHOICES = [
        ('active',      'Active'),
        ('inactive',    'Inactive'),
        ('maintenance', 'Maintenance'),
        ('unknown',     'Unknown'),
    ]

    name      = models.CharField(max_length=200, verbose_name='Node Name')
    node_type = models.CharField(max_length=20, choices=NODE_TYPE_CHOICES, verbose_name='Type')
    ip_address = models.GenericIPAddressField(null=True, blank=True, verbose_name='IP Address')
    status     = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')

    # ভৌগোলিক স্থানাংক — Leaflet মানচিত্রে মার্কার রেন্ডারিংয়ের জন্য অপরিহার্য
    latitude  = models.DecimalField(max_digits=10, decimal_places=8, null=True, blank=True)
    longitude = models.DecimalField(max_digits=11, decimal_places=8, null=True, blank=True)

    # বিদ্যমান মডেলের সাথে optional relational link
    # router FK → মানে এই নোডটি একটি নির্দিষ্ট MikrotikServer প্রতিনিধিত্ব করে
    router = models.ForeignKey(
        'mikrotik_app.MikrotikServer',
        on_delete=models.SET_NULL, null=True, blank=True,
        related_name='network_nodes', verbose_name='Linked Router',
    )
    # client FK → মানে এই নোডটি একটি নির্দিষ্ট End Client (PPPoE গ্রাহক) প্রতিনিধিত্ব করে
    client = models.ForeignKey(
        'clients.Client',
        on_delete=models.SET_NULL, null=True, blank=True,
        related_name='network_nodes', verbose_name='Linked Client',
    )

    # React Flow topology canvas-এ এই নোডের pixel অবস্থান (ব্যবহারকারী drag করে সেট করতে পারবেন)
    pos_x = models.FloatField(default=0, verbose_name='Topology X Position')
    pos_y = models.FloatField(default=0, verbose_name='Topology Y Position')

    # Port configuration — device type অনুযায়ী port count
    # OLT: pon_count=8 (PON-1..8), uplink_count=2 (UP-1..2)
    # ROUTER: port_count=4 (Port-1..4), uplink_count=1 (WAN-1)
    # BOX: port_count=8 (Port-1..8), uplink_count=1 (In)
    port_count    = models.PositiveSmallIntegerField(
        null=True, blank=True, verbose_name='Output/PON Port Count',
        help_text='OLT-এর PON count, Router/BOX-এর output port count',
    )
    uplink_count  = models.PositiveSmallIntegerField(
        null=True, blank=True, verbose_name='Uplink Port Count',
        help_text='OLT UP-Link, Router WAN port count',
    )

    # Splitter node-এর ratio — শুধু SPLITTER type-এর জন্য প্রযোজ্য
    SPLITTER_RATIO_CHOICES = [
        # Tap splitters (asymmetric)
        ('1:99', '1:99'), ('2:98', '2:98'), ('3:97', '3:97'), ('4:94', '4:94'),
        ('5:95', '5:95'), ('10:90', '10:90'), ('15:85', '15:85'), ('20:80', '20:80'),
        ('25:75', '25:75'), ('30:70', '30:70'), ('35:65', '35:65'), ('40:60', '40:60'),
        ('45:55', '45:55'),
        # PLC splitters (symmetric)
        ('1:2', '1:2'), ('1:4', '1:4'), ('1:8', '1:8'), ('1:16', '1:16'),
        ('1:32', '1:32'), ('1:64', '1:64'),
    ]
    splitter_ratio = models.CharField(
        max_length=10, blank=True, default='',
        choices=SPLITTER_RATIO_CHOICES,
        verbose_name='Splitter Ratio',
    )

    description = models.TextField(blank=True)
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'network_nodes'
        ordering = ['node_type', 'name']
        verbose_name = 'Network Node'
        verbose_name_plural = 'Network Nodes'

    def __str__(self):
        return f"{self.name} [{self.node_type}]"


class NetworkLink(models.Model):
    """
    দুটি NetworkNode-এর মধ্যে ফিজিক্যাল/লজিক্যাল সংযোগ।
    paths JSONField-এ Google Maps/Leaflet-এর পলিলাইন waypoints সংরক্ষিত হয়:
      [{"lat": 23.8103, "lng": 90.4125}, {"lat": 23.815, "lng": 90.420}, ...]
    এই coordinate array দিয়ে মানচিত্রে সঠিক রাস্তা অনুযায়ী ফাইবার ক্যাবল রুট দেখানো হয়।
    """
    LINK_TYPE_CHOICES = [
        ('FIBER',    'Fiber Optic'),
        ('ETHERNET', 'Ethernet'),
        ('WIRELESS', 'Wireless'),
    ]
    STATUS_CHOICES = [
        ('active',      'Active'),
        ('inactive',    'Inactive'),
        ('maintenance', 'Maintenance'),
    ]

    # source → target: দিকভিত্তিক সংযোগ (upstream থেকে downstream)
    source_node = models.ForeignKey(
        NetworkNode, on_delete=models.CASCADE,
        related_name='outgoing_links', verbose_name='Source Node',
    )
    target_node = models.ForeignKey(
        NetworkNode, on_delete=models.CASCADE,
        related_name='incoming_links', verbose_name='Target Node',
    )

    link_type  = models.CharField(max_length=20, choices=LINK_TYPE_CHOICES, default='FIBER')
    color_code = models.CharField(max_length=20, default='#00bcd4')
    distance   = models.FloatField(null=True, blank=True, help_text='Distance in meters')

    # ── Port info — কোন port/interface থেকে কানেক্ট করা হয়েছে ──────────────────
    source_port = models.CharField(max_length=50,  blank=True, default='', verbose_name='Source Port')
    target_port = models.CharField(max_length=50,  blank=True, default='', verbose_name='Target Port')

    # ── Fiber cable details — FIBER type-এর জন্য বিস্তারিত তথ্য ────────────────
    # MySQL strict mode-এ NOT NULL CharField-এ explicit default='' আবশ্যক
    fiber_company    = models.CharField(max_length=100, blank=True, default='', verbose_name='Cable Company')
    cable_code       = models.CharField(max_length=100, blank=True, default='', verbose_name='Cable Code/Batch')
    fiber_core_count = models.PositiveSmallIntegerField(null=True, blank=True, verbose_name='Total Core Count')
    fiber_used_cores = models.CharField(max_length=100, blank=True, default='', verbose_name='Used Cores (e.g. 1-2, 3-4)')
    fiber_core_color = models.CharField(max_length=200, blank=True, default='', verbose_name='Core Colors')
    fiber_core_details = models.CharField(max_length=255, blank=True, default='', verbose_name='Additional Notes')

    # Leaflet পলিলাইনের waypoints — JSON array of {lat, lng} objects
    # এই data সরাসরি Leaflet <Polyline positions={...}> -এ ব্যবহার হবে
    paths = models.JSONField(
        default=list,
        help_text='Array of {lat, lng} waypoints for map polyline routing',
    )

    status     = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'network_links'
        ordering = ['source_node__name']
        verbose_name = 'Network Link'
        verbose_name_plural = 'Network Links'

    def __str__(self):
        return f"{self.source_node.name} → {self.target_node.name} ({self.link_type})"
