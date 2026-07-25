# VoIP মডিউলের মডেল — SIP endpoint, call log ও voice message।
# নকশার মূল কথা (VOIP_PLAN.md Section B):
#   - প্রতিটি client/agent-এর একটি SIP endpoint থাকে (client_<id> / agent_<id>)।
#   - Asterisk-এর আসল endpoint config আলাদা `asterisk` MySQL DB-তে (realtime) থাকে;
#     এখানে শুধু provisioning state ও encrypted secret রাখি।
#   - CallLog/VoiceMessage সরাসরি isp_clients-এর সাথে FK দিয়ে যুক্ত — তাই client
#     profile-এ কল হিস্ট্রি দেখানো যায়।
from django.conf import settings
from django.db import models



# পুনরাবৃত্ত literal — S1192 এড়াতে module constant
_CLIENT_MODEL = 'clients.Client'
_RING_GROUP = 'Ring Group'

class SipEndpoint(models.Model):
    # একটি SIP endpoint = একজন client বা একজন agent/user-এর কলিং পরিচয়।
    # কেন owner দুই রকম: একই table-এ client ও agent উভয়ের endpoint রাখি,
    # endpoint_name prefix (client_/agent_) দিয়ে আলাদা করা হয়।
    KIND_CHOICES = [
        ('client', 'Client'),
        ('agent', 'Agent/User'),
    ]

    endpoint_name = models.CharField(max_length=80, unique=True)  # যেমন client_4521
    kind          = models.CharField(max_length=10, choices=KIND_CHOICES)

    # owner — যেকোনো একটি set থাকবে (kind অনুযায়ী)।
    client = models.OneToOneField(
        _CLIENT_MODEL, null=True, blank=True,
        on_delete=models.CASCADE, related_name='sip_endpoint',
    )
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.CASCADE, related_name='sip_endpoint',
    )

    # SIP digest auth password — role_permissions.utils দিয়ে এনক্রিপ্ট করে রাখা।
    # কখনো plaintext store করা হয় না; runtime-এ decrypt করে ephemeral creds দেওয়া হয়।
    secret_encrypted = models.TextField(blank=True, default='')

    max_contacts = models.PositiveSmallIntegerField(default=1)  # একসাথে কত device register
    is_active    = models.BooleanField(default=True)
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'sip_endpoints'
        verbose_name = 'SIP Endpoint'
        verbose_name_plural = 'SIP Endpoints'

    def __str__(self):
        return self.endpoint_name


class CallLog(models.Model):
    # প্রতিটি কলের রেকর্ড। ARI event listener (Phase 3) এটি create/update করে।
    DIRECTION_CHOICES = [
        ('outbound', 'Outbound (panel→client)'),
        ('inbound', 'Inbound (client→panel)'),
    ]
    STATUS_CHOICES = [
        ('initiated', 'Initiated'),
        ('ringing', 'Ringing'),
        ('answered', 'Answered'),
        ('completed', 'Completed'),
        ('no_answer', 'No Answer'),
        ('busy', 'Busy'),
        ('failed', 'Failed'),
    ]

    client = models.ForeignKey(
        _CLIENT_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='call_logs',
    )
    agent = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='call_logs',
    )
    direction = models.CharField(max_length=10, choices=DIRECTION_CHOICES, default='outbound')

    # Asterisk correlation — channel uniqueid/linkedid (ARI event থেকে আসে)।
    sip_channel     = models.CharField(max_length=120, blank=True, default='', db_index=True)
    caller_endpoint = models.CharField(max_length=80, blank=True, default='')
    callee_endpoint = models.CharField(max_length=80, blank=True, default='')

    started_at  = models.DateTimeField(null=True, blank=True)
    answered_at = models.DateTimeField(null=True, blank=True)
    ended_at    = models.DateTimeField(null=True, blank=True)
    duration    = models.PositiveIntegerField(default=0)  # সেকেন্ডে (answered→ended)

    status    = models.CharField(max_length=12, choices=STATUS_CHOICES, default='initiated')
    recording = models.FileField(upload_to='call_recordings/', null=True, blank=True)
    note      = models.CharField(max_length=255, blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'call_logs'
        verbose_name = 'Call Log'
        verbose_name_plural = 'Call Logs'
        ordering = ['-started_at', '-created_at']
        indexes = [
            models.Index(fields=['client', '-started_at']),
        ]

    def __str__(self):
        return f'{self.direction} {self.caller_endpoint}→{self.callee_endpoint} ({self.status})'


class VoiceMessage(models.Model):
    # admin/agent → client-কে পাঠানো async ভয়েস মেসেজ (recorded audio)।
    # app push (FCM) দিয়ে client-কে জানানো হয়; client শুনলে is_heard=True।
    client = models.ForeignKey(
        _CLIENT_MODEL, on_delete=models.CASCADE, related_name='voice_messages',
    )
    sent_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='sent_voice_messages',
    )
    audio    = models.FileField(upload_to='voice_messages/')
    duration = models.PositiveIntegerField(default=0)  # সেকেন্ডে
    is_heard = models.BooleanField(default=False)
    heard_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'voice_messages'
        verbose_name = 'Voice Message'
        verbose_name_plural = 'Voice Messages'
        ordering = ['-created_at']

    def __str__(self):
        return f'VoiceMsg → {self.client_id} ({self.duration}s)'


class VoiceRecording(models.Model):
    # রেকর্ডিং লাইব্রেরি — একবার আপলোড/রেকর্ড করে সংরক্ষণ করা ভয়েস ফাইল।
    # এই সংরক্ষিত রেকর্ডিং দিয়েই ম্যানুয়াল broadcast ও auto schedule চলে (reuse)।
    title    = models.CharField(max_length=120)
    audio    = models.FileField(upload_to='voice_library/')
    duration = models.PositiveIntegerField(default=0)  # সেকেন্ডে
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='voice_recordings',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'voice_recordings'
        verbose_name = 'Voice Recording'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.title} ({self.duration}s)'


class VoiceCallSchedule(models.Model):
    # এক্সপায়ারি-ভিত্তিক স্বয়ংক্রিয় ভয়েস কল রুল। Celery beat প্রতিদিন চালায়:
    # timing=before → expiry_date == today + days; after → expiry_date == today - days।
    # মিলে যাওয়া client-দের রেকর্ডিং বাজিয়ে কল করে।
    TIMING_CHOICES = (('before', 'এক্সপায়ারির আগে'), ('after', 'এক্সপায়ারির পরে'))

    name     = models.CharField(max_length=120)
    # নতুন: লাইব্রেরি থেকে সংরক্ষিত রেকর্ডিং। পুরনো schedule-এ inline `audio` থাকতে পারে,
    # তাই backward-compat-এ দুটোই রাখা — audio_path() যেটা আছে সেটা ব্যবহার করে।
    recording = models.ForeignKey(
        'VoiceRecording', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='schedules',
    )
    audio    = models.FileField(upload_to='voice_announce_sched/', null=True, blank=True)
    days     = models.PositiveIntegerField(default=0)          # কত দিন
    timing   = models.CharField(max_length=8, choices=TIMING_CHOICES, default='before')
    run_time = models.TimeField(default='10:00')               # প্রতিদিন কোন সময়ে চলবে
    status_filter = models.CharField(max_length=20, blank=True, default='')  # '' = সব
    is_active = models.BooleanField(default=True)
    last_run_date = models.DateField(null=True, blank=True)     # একই দিনে দুবার নয়
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='voice_schedules',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'voice_call_schedules'
        verbose_name = 'Voice Call Schedule'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.name} ({self.timing} {self.days}d)'

    def target_expiry_date(self, today):
        import datetime
        d = datetime.timedelta(days=self.days)
        return today + d if self.timing == 'before' else today - d

    def audio_path(self):
        # broadcast/convert-এ ব্যবহারের জন্য — recording থাকলে সেটা, নইলে inline audio।
        if self.recording and self.recording.audio:
            return self.recording.audio.path
        if self.audio:
            return self.audio.path
        return None


# ═══════════════════════════════════════════════════════════════════════════════
# IP-PBX / Hotline Control — Rajamehar Online হটলাইন নম্বর ব্যবস্থাপনা।
# এই মডেলগুলো পরিচালনা করে: হটলাইন নম্বর, রিং গ্রুপ, IVR মেনু, PBX এজেন্ট, ব্যবসায়িক সময়।
# ═══════════════════════════════════════════════════════════════════════════════

class PBXAgent(models.Model):
    # একজন স্টাফ → SIP extension ম্যাপিং। রিং গ্রুপে এই এজেন্টরা থাকে।
    ROLE_CHOICES = [
        ('general',   'General'),
        ('billing',   'Billing Support'),
        ('support',   'Technical Support'),
        ('manager',   'Manager'),
        ('operator',  'Operator'),
    ]
    user         = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='pbx_agents',
    )
    display_name      = models.CharField(max_length=80)
    extension         = models.CharField(max_length=20, unique=True)  # যেমন: 101
    sip_endpoint_name = models.CharField(max_length=80, blank=True, default='')  # যেমন: agent_1
    role_label        = models.CharField(max_length=20, choices=ROLE_CHOICES, default='general')
    is_active         = models.BooleanField(default=True)
    priority          = models.PositiveSmallIntegerField(default=10)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        db_table     = 'pbx_agents'
        verbose_name = 'PBX Agent'
        ordering     = ['priority', 'display_name']

    def __str__(self):
        return f'{self.display_name} ({self.extension})'


class RingGroup(models.Model):
    # একটি রিং গ্রুপ — একসাথে বা পর্যায়ক্রমে একাধিক এজেন্টকে রিং করে।
    STRATEGY_CHOICES = [
        ('ring_all',    'সবাইকে একসাথে রিং (Ring All)'),
        ('sequential',  'একের পর এক (Sequential)'),
        ('random',      'এলোমেলো (Random)'),
    ]
    NO_ANSWER_CHOICES = [
        ('ivr',      'IVR মেনুতে পাঠাও'),
        ('forward',  'নম্বরে ফরওয়ার্ড করো'),
        ('voicemail','Voicemail'),
        ('hangup',   'কল কেটে দাও'),
    ]
    name                  = models.CharField(max_length=80)
    strategy              = models.CharField(max_length=12, choices=STRATEGY_CHOICES, default='ring_all')
    timeout_seconds       = models.PositiveSmallIntegerField(default=25)
    retry_seconds         = models.PositiveSmallIntegerField(default=3)
    no_answer_route_type  = models.CharField(max_length=12, choices=NO_ANSWER_CHOICES, default='hangup')
    no_answer_forward_num = models.CharField(max_length=30, blank=True, default='')
    is_active             = models.BooleanField(default=True)
    created_at            = models.DateTimeField(auto_now_add=True)
    updated_at            = models.DateTimeField(auto_now=True)

    class Meta:
        db_table     = 'pbx_ring_groups'
        verbose_name = _RING_GROUP
        ordering     = ['name']

    def __str__(self):
        return self.name


class RingGroupMember(models.Model):
    # রিং গ্রুপে একজন এজেন্টের সদস্যপদ।
    ring_group = models.ForeignKey(RingGroup, on_delete=models.CASCADE, related_name='members')
    agent      = models.ForeignKey(PBXAgent, on_delete=models.CASCADE, related_name='ring_memberships')
    order      = models.PositiveSmallIntegerField(default=1)
    enabled    = models.BooleanField(default=True)

    class Meta:
        db_table         = 'pbx_ring_group_members'
        verbose_name     = 'Ring Group Member'
        unique_together  = [('ring_group', 'agent')]
        ordering         = ['order']

    def __str__(self):
        return f'{self.ring_group.name} → {self.agent.display_name}'


class IVRMenu(models.Model):
    # IVR (Interactive Voice Response) মেনু — অটোমেটেড ভয়েস গাইড।
    name              = models.CharField(max_length=80)
    greeting_file     = models.CharField(max_length=200, blank=True, default='')  # Asterisk Playback path (ext ছাড়া)
    greeting_upload   = models.FileField(upload_to='ivr_greetings/', null=True, blank=True)  # raw upload
    timeout_seconds   = models.PositiveSmallIntegerField(default=7)
    invalid_msg_file  = models.CharField(max_length=200, blank=True, default='')
    is_active         = models.BooleanField(default=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        db_table     = 'pbx_ivr_menus'
        verbose_name = 'IVR Menu'
        ordering     = ['name']

    def __str__(self):
        return self.name


class IVROption(models.Model):
    # IVR মেনুর একটি ডায়াল অপশন (যেমন: ১ চাপুন বিলিং-এর জন্য)।
    ROUTE_CHOICES = [
        ('ring_group', _RING_GROUP),
        ('agent',      'Agent'),
        ('forward',    'Forward Number'),
        ('voicemail',  'Voicemail'),
        ('hangup',     'Hangup'),
    ]
    ivr          = models.ForeignKey(IVRMenu, on_delete=models.CASCADE, related_name='options')
    digit        = models.CharField(max_length=2)   # 0-9, *, #
    label        = models.CharField(max_length=80)
    route_type   = models.CharField(max_length=12, choices=ROUTE_CHOICES, default='ring_group')
    ring_group   = models.ForeignKey(RingGroup, null=True, blank=True, on_delete=models.SET_NULL, related_name='ivr_options')
    agent        = models.ForeignKey(PBXAgent,  null=True, blank=True, on_delete=models.SET_NULL, related_name='ivr_options')
    forward_number = models.CharField(max_length=30, blank=True, default='')
    order        = models.PositiveSmallIntegerField(default=1)

    class Meta:
        db_table     = 'pbx_ivr_options'
        verbose_name = 'IVR Option'
        ordering     = ['order', 'digit']

    def __str__(self):
        return f'{self.ivr.name}: {self.digit} → {self.label}'


class HotlineNumber(models.Model):
    # একটি হটলাইন নম্বর এবং তার রাউটিং কনফিগারেশন।
    PROVIDER_CHOICES = [
        ('sip_trunk',    'SIP Trunk'),
        ('did_provider', 'DID Provider'),
        ('internal',     'Internal (Asterisk)'),
        ('other',        'Other'),
    ]
    ROUTE_CHOICES = [
        ('ring_group', _RING_GROUP),
        ('ivr',        'IVR Menu'),
        ('agent',      'Direct Agent'),
        ('forward',    'External Forward'),
    ]
    title             = models.CharField(max_length=100)
    number            = models.CharField(max_length=30, unique=True)
    provider_type     = models.CharField(max_length=16, choices=PROVIDER_CHOICES, default='internal')
    sip_trunk_host    = models.CharField(max_length=120, blank=True, default='')
    sip_trunk_username = models.CharField(max_length=80, blank=True, default='')
    sip_trunk_password_enc = models.TextField(blank=True, default='')  # role_permissions.utils দিয়ে encrypt
    is_active         = models.BooleanField(default=True)

    # ডিফল্ট রাউটিং (ব্যবসায়িক সময়ে)
    default_route_type   = models.CharField(max_length=12, choices=ROUTE_CHOICES, default='ring_group')
    default_ring_group   = models.ForeignKey(RingGroup, null=True, blank=True, on_delete=models.SET_NULL, related_name='hotline_defaults')
    default_ivr          = models.ForeignKey(IVRMenu,   null=True, blank=True, on_delete=models.SET_NULL, related_name='hotline_defaults')
    default_agent        = models.ForeignKey(PBXAgent,  null=True, blank=True, on_delete=models.SET_NULL, related_name='hotline_defaults')
    forward_number       = models.CharField(max_length=30, blank=True, default='')

    # অফ-আওয়ার রাউটিং
    business_hours_enabled = models.BooleanField(default=False)
    after_hours_message    = models.CharField(max_length=200, blank=True, default='')  # Playback file path

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table     = 'pbx_hotline_numbers'
        verbose_name = 'Hotline Number'
        ordering     = ['title']

    def __str__(self):
        return f'{self.title} ({self.number})'


class PBXBusinessHour(models.Model):
    # হটলাইনের ব্যবসায়িক সময় (প্রতি বারের জন্য একটি রেকর্ড)।
    WEEKDAY_CHOICES = [
        (0, 'সোমবার'), (1, 'মঙ্গলবার'), (2, 'বুধবার'),
        (3, 'বৃহস্পতিবার'), (4, 'শুক্রবার'), (5, 'শনিবার'), (6, 'রবিবার'),
    ]
    hotline    = models.ForeignKey(HotlineNumber, on_delete=models.CASCADE, related_name='business_hours')
    weekday    = models.PositiveSmallIntegerField(choices=WEEKDAY_CHOICES)
    start_time = models.TimeField()
    end_time   = models.TimeField()
    is_open    = models.BooleanField(default=True)

    class Meta:
        db_table     = 'pbx_business_hours'
        verbose_name = 'PBX Business Hour'
        ordering     = ['hotline', 'weekday', 'start_time']

    def __str__(self):
        return f'{self.hotline.title}: {self.get_weekday_display()} {self.start_time}-{self.end_time}'
