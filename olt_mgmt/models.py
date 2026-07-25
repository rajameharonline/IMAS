# এই ফাইলটি OLT (Optical Line Terminal) ও ONU ম্যানেজমেন্টের জন্য।
from django.db import models



# পুনরাবৃত্ত literal — S1192 এড়াতে module constant
_CLIENT_MODEL = 'clients.Client'

class OLT(models.Model):
    # OLT ডিভাইস তথ্য - SNMP দিয়ে সংযুক্ত হবে
    VENDOR_CHOICES = [
        ('vsol', 'V-SOL'),
        ('huawei', 'Huawei'),
        ('zte', 'ZTE'),
        ('bdcom', 'BDCOM'),
        ('other', 'Other'),
    ]
    MGMT_CHOICES = [
        ('telnet', 'Telnet'),
        ('ssh', 'SSH'),
        ('snmp', 'SNMP only'),
    ]
    FW_VERSION_CHOICES = [
        ('auto', 'Auto-detect'),
        ('v1',   'পুরনো ফার্মওয়্যার (V1 — string dBm)'),
        ('v2',   'নতুন ফার্মওয়্যার (V2 — integer ÷100)'),
    ]

    name = models.CharField(max_length=100)
    # ডিভাইস থেকে পড়া আসল System Name (V-SOL web UI-এর hostname ফিল্ড)।
    # OLT create করার সময় ও প্রতিটি sync-এ auto আপডেট হয়; UI সব জায়গায়
    # এটাই দেখায় (খালি হলে ম্যানুয়াল `name`-এ fallback) — display_name দেখুন।
    system_name = models.CharField(
        max_length=150, blank=True,
        help_text='OLT ডিভাইস থেকে পড়া আসল System Name — স্বয়ংক্রিয়ভাবে সেট হয়',
    )
    ip_address = models.GenericIPAddressField()
    snmp_community = models.CharField(max_length=100, default='public')
    snmp_version = models.CharField(max_length=10, default='2c')
    vendor = models.CharField(max_length=100, choices=VENDOR_CHOICES, default='vsol')
    model = models.CharField(max_length=100, blank=True)
    # ফার্মওয়্যার ভার্সন: নতুন OLT-এর জন্য v2 সেট করুন (RX integer ÷100)
    fw_version = models.CharField(
        max_length=10, choices=FW_VERSION_CHOICES, default='auto',
        help_text='V-SOL নতুন firmware-এ v2 বা auto রাখুন',
    )
    # কাস্টম RX Power SNMP OID (ফাঁকা রাখলে vendor default ব্যবহার হবে)
    rx_snmp_oid = models.CharField(
        max_length=255, blank=True,
        help_text='Custom RX power OID override — ফাঁকা রাখলে default OID ব্যবহার হবে',
    )
    # TX Power SNMP OID — snmp_discover দিয়ে খুঁজে এখানে দিলে TX power আসবে (ফাঁকা=বন্ধ)
    tx_snmp_oid = models.CharField(
        max_length=255, blank=True,
        help_text='ONU TX power OID (snmp_discover দিয়ে খুঁজুন) — ফাঁকা রাখলে TX power আনা হবে না',
    )
    location = models.TextField(blank=True)
    mgmt_proto = models.CharField(max_length=20, choices=MGMT_CHOICES, default='telnet')
    telnet_port = models.PositiveIntegerField(default=23)
    ssh_port = models.PositiveIntegerField(default=22)
    username = models.CharField(max_length=100, blank=True)
    password = models.CharField(max_length=255, blank=True)
    enable_password = models.CharField(max_length=255, blank=True)
    prompt_regex = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True)
    last_polled = models.DateTimeField(null=True, blank=True)
    last_sync_at = models.DateTimeField(null=True, blank=True)
    last_sync_status = models.CharField(max_length=20, blank=True)
    last_sync_count = models.PositiveIntegerField(default=0)
    last_sync_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'olts'
        ordering = ['name']

    @property
    def display_name(self):
        """UI-তে দেখানোর নাম — ডিভাইসের আসল System Name, না থাকলে ম্যানুয়াল name।"""
        return self.system_name or self.name

    def __str__(self):
        return f"{self.display_name} ({self.ip_address})"

    def _decrypt_secret(self, value):
        """password/enable_password field-এর জন্য: encrypted হলে decrypt করে,
        legacy plaintext হলে (আগে থেকে DB-তে থাকা, encryption চালুর আগের) সেটাই
        ফেরত দেয় — role_permissions/utils.py-এর decrypt_password() decrypt
        ব্যর্থ হলে '' ফেরত দেয়, যা দিয়ে "legacy plaintext" আর "খালি value"
        আলাদা করা যায় না, তাই এখানে ফলব্যাক নিজে হ্যান্ডল করা হচ্ছে।
        """
        if not value:
            return ''
        from role_permissions.utils import decrypt_password
        decrypted = decrypt_password(value)
        return decrypted or value

    def get_decrypted_password(self):
        return self._decrypt_secret(self.password)

    def get_decrypted_enable_password(self):
        return self._decrypt_secret(self.enable_password)


class ONUSignal(models.Model):
    # Live ONU signal monitor: customer/interface এর সাথে latest optical signal
    #
    # নোট (storage-review, 2026-07-19): rx_power/tx_power/notes এখানে
    # OLTMacCache.rx_power_dbm/description-এর মান কপি করে (_process_onu_row,
    # tasks.py)। এটা ইচ্ছাকৃত denormalization, bug না — এই টেবিল interface_id
    # দিয়ে unique (583 row, dedup করা), আর OLTMacCache mac দিয়ে unique (945+
    # row, একই interface-এ একাধিক MAC থাকতে পারে)। ONU Monitoring page এই
    # টেবিল থেকে সরাসরি পড়ে; join করে aggregate করলে প্রতিটি list render-এ
    # extra query লাগত কয়েক byte/row storage বাঁচানোর জন্য — worth না।
    #
    # নোট: আগে এখানে একটা `onu` FK ছিল যেটা এখন-অপসারিত `ONU` model-কে (manual/
    # legacy ONU inventory, migration 0001-এ তৈরি) পয়েন্ট করত। সেই টেবিল কখনো কোনো
    # sync path থেকে লেখা হয়নি (0 row, চিরস্থায়ীভাবে খালি) — OLTMacCache/ONUSignal
    # (এই দুটোই SNMP sync-এর real, live source) এসে এটাকে সুপারসিড করেছিল কিন্তু
    # পুরনো টেবিল/FK কখনো পরিষ্কার করা হয়নি। FK খালি থাকায় dependent field
    # (onu_serial, onu_identifier) সবসময় ফাঁকা থাকত, এবং dead code path
    # (_sync_onu_inventory_signals ইত্যাদি) দরকারবিহীন loop চালাত। migration
    # 0009-এ পুরো ONU model + এই FK সরানো হয়েছে (storage-review, 2026-07-19)।
    STATUS_CHOICES = [
        ('good', 'Good'),
        ('low', 'Low Signal'),
        ('offline', 'Offline'),
        ('unknown', 'Unknown'),
    ]
    olt = models.ForeignKey(OLT, on_delete=models.CASCADE, related_name='signals')
    client = models.ForeignKey(_CLIENT_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='onu_signals')
    interface_id = models.CharField(max_length=120, db_index=True)
    rx_power = models.FloatField(null=True, blank=True)
    tx_power = models.FloatField(null=True, blank=True)
    signal_status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='unknown')
    last_updated = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    raw_data = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'onu_signals'
        ordering = ['client__full_name', 'interface_id']
        unique_together = [('olt', 'interface_id')]

    def __str__(self):
        return f"{self.interface_id} - {self.signal_status}"


class OLTMacCache(models.Model):
    # Telnet/SNMP sync থেকে শেখা ONU/MAC তথ্য cache করে রাখা হয়
    olt = models.ForeignKey(OLT, on_delete=models.CASCADE, related_name='mac_cache')
    vendor = models.CharField(max_length=100, blank=True)
    mac = models.CharField(max_length=20, db_index=True)
    vlan = models.CharField(max_length=50, blank=True)
    port = models.CharField(max_length=100, blank=True)
    onu = models.CharField(max_length=50, blank=True)
    status = models.CharField(max_length=30, default='online')
    description = models.CharField(max_length=255, blank=True, db_index=True)
    distance_m = models.PositiveIntegerField(null=True, blank=True)
    rx_power_dbm = models.FloatField(null=True, blank=True)
    last_dereg_reason = models.CharField(max_length=255, blank=True)
    last_dereg_time = models.DateTimeField(null=True, blank=True)
    # ডিভাইসের ONU Status টেবিলের raw string — OLT-এর নিজের ঘড়ি অনুযায়ী।
    # আলাদা CharField রাখা হয়েছে (raw_data-তে নয়) কারণ raw_data একাধিক
    # sync path লেখে (_try_update_mac_cache ইত্যাদি) ও একে অপরকে ওভাররাইট
    # করে — ডেডিকেটেড field সেই সমস্যা থেকে মুক্ত।
    # last_dereg_time (DateTime) parse করা হয় না: এই OLT-গুলোর ঘড়ি ভুল
    # (যেমন "2033/04/08"), তাই datetime-এ রূপান্তর বিভ্রান্তিকর হতো।
    last_dereg_time_raw = models.CharField(max_length=40, blank=True)
    alive_time = models.CharField(max_length=40, blank=True)
    client = models.ForeignKey(_CLIENT_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='olt_mac_rows')
    # client link কোন strategy দিয়ে বসানো হয়েছে — 'mac' (link_onu_clients, লাইভ
    # PPPoE session + CPE MAC bridge table, বেশি বিশ্বাসযোগ্য) বনাম 'description'
    # (sync_all_olts_mac_table, ONU description prefix parse, admin ভুলে description
    # আপডেট না করলে stale হয়ে যায়)। এটা না থাকলে দুই task একে অপরের client_id
    # বারবার overwrite করত (৫ মিনিট পরপর flip) — এখন 'mac' source-এর link
    # description-based sync কখনো override করে না।
    CLIENT_LINK_SOURCE_CHOICES = [
        ('', 'None'), ('description', 'ONU Description'), ('mac', 'CPE MAC (verified)'),
    ]
    client_link_source = models.CharField(
        max_length=20, blank=True, default='', choices=CLIENT_LINK_SOURCE_CHOICES,
    )
    client_mac = models.CharField(max_length=20, blank=True)
    client_mac_vlan = models.CharField(max_length=50, blank=True)
    client_mac_learned_at = models.DateTimeField(null=True, blank=True)
    raw_data = models.JSONField(default=dict, blank=True)
    learned_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'olt_mac_cache'
        ordering = ['olt__name', 'port', 'onu', 'mac']
        unique_together = [('olt', 'mac')]

    def __str__(self):
        return f"{self.olt.display_name} - {self.mac}"


class SNMPTrapLog(models.Model):
    # OLT থেকে আসা real-time SNMP trap-এর রেকর্ড — link up/down, ONU register/dereg।
    # snmp_trap_listener (pysnmp) প্রতিটি incoming trap এখানে store করে; recognized
    # event হলে ONUSignal/OLTMacCache live update হয়। unknown trap-ও store হয় যাতে
    # পরে V-SOL trap OID গুলো mapping করা যায়।
    EVENT_CHOICES = [
        ('link_up',       'Link Up'),
        ('link_down',     'Link Down'),
        ('onu_register',  'ONU Register'),
        ('onu_dereg',     'ONU Deregister'),
        ('cold_start',    'Cold Start / Reboot'),
        ('warm_start',    'Warm Start'),
        ('auth_fail',     'Auth Failure'),
        ('unknown',       'Unknown'),
    ]
    olt = models.ForeignKey(OLT, on_delete=models.SET_NULL, null=True, blank=True,
                            related_name='trap_logs')
    source_ip = models.GenericIPAddressField(db_index=True)
    trap_oid = models.CharField(max_length=255, blank=True)
    event = models.CharField(max_length=30, choices=EVENT_CHOICES, default='unknown', db_index=True)
    interface_id = models.CharField(max_length=120, blank=True, db_index=True)
    summary = models.CharField(max_length=255, blank=True)
    varbinds = models.JSONField(default=list, blank=True)   # [(oid, value), ...]
    handled = models.BooleanField(default=False)            # ONUSignal update হয়েছে কিনা
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = 'snmp_trap_logs'
        ordering = ['-created_at']
        indexes = [models.Index(fields=['source_ip', 'created_at'])]

    def __str__(self):
        return f"{self.source_ip} {self.event} {self.interface_id} @ {self.created_at:%Y-%m-%d %H:%M}"
