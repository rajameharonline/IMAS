# Live TV চ্যানেল ম্যানেজমেন্ট মডেল
# তিন ধরনের ইনপুট: HDMI PCIe (V4L2), DVB-S2 কার্ড (DVB), URL (RTSP/HTTP)
from django.db import models
from django.utils.text import slugify


class TVCategory(models.Model):
    """Dynamic চ্যানেল ক্যাটাগরি — admin থেকে যোগ/সম্পাদনা করা যাবে।"""
    slug       = models.SlugField(max_length=50, unique=True, primary_key=True)
    name       = models.CharField(max_length=50, verbose_name='নাম')
    color      = models.CharField(max_length=100, default='bg-gray-100 text-gray-600', verbose_name='রঙ (Tailwind class)')
    sort_order = models.PositiveSmallIntegerField(default=0, verbose_name='ক্রম')

    class Meta:
        ordering = ['sort_order', 'name']
        verbose_name = 'চ্যানেল ক্যাটাগরি'

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)


class TVChannel(models.Model):
    CATEGORY_CHOICES = [
        ('news',          'সংবাদ'),
        ('entertainment', 'বিনোদন'),
        ('sports',        'খেলাধুলা'),
        ('religious',     'ধর্মীয়'),
        ('international', 'আন্তর্জাতিক'),
        ('music',         'মিউজিক'),
        ('other',         'অন্যান্য'),
    ]

    STATUS_CHOICES = [
        ('stopped',  'বন্ধ'),
        ('starting', 'শুরু হচ্ছে'),
        ('live',     'লাইভ'),
        ('error',    'ত্রুটি'),
    ]

    RESOLUTION_CHOICES = [
        ('1920x1080',   '1080p (Full HD)'),
        ('1280x720',    '720p (HD)'),
        ('854x480',     '480p (SD)'),
        ('640x360',     '360p'),
        ('passthrough', 'Passthrough (রি-এনকোড নেই)'),
    ]

    INPUT_TYPE_CHOICES = [
        ('v4l2', 'HDMI Capture Card (V4L2)'),
        ('dvb',  'DVB-S2 স্যাটেলাইট কার্ড'),
        ('url',  'URL (RTSP / HTTP / UDP)'),
    ]

    FRAMERATE_CHOICES = [
        ('25',    '25 fps (PAL — বাংলাদেশ)'),
        ('30',    '30 fps'),
        ('50',    '50 fps'),
        ('60',    '60 fps'),
        ('29.97', '29.97 fps (NTSC)'),
    ]

    POLARIZATION_CHOICES = [
        ('H', 'Horizontal (H)'),
        ('V', 'Vertical (V)'),
        ('L', 'Left Circular (L)'),
        ('R', 'Right Circular (R)'),
    ]

    name        = models.CharField(max_length=255, verbose_name='চ্যানেলের নাম')
    slug        = models.SlugField(max_length=255, unique=True, blank=True)
    category    = models.CharField(max_length=50, default='other')  # TVCategory.slug রেফারেন্স (soft FK)
    logo_url    = models.URLField(max_length=1000, blank=True, default='', verbose_name='লোগো URL')
    description = models.CharField(max_length=255, blank=True, default='')

    # ── ইনপুট টাইপ ─────────────────────────────────────────────────
    input_type = models.CharField(
        max_length=10, choices=INPUT_TYPE_CHOICES, default='v4l2',
        verbose_name='ইনপুট ধরন',
    )

    # ── V4L2 — HDMI PCIe Capture Card ──────────────────────────────
    device_path  = models.CharField(
        max_length=500, blank=True, default='',
        help_text='যেমন /dev/video0 (৮-পোর্ট কার্ডে /dev/video0…video7)',
        verbose_name='V4L2 ডিভাইস পাথ',
    )
    audio_device = models.CharField(
        max_length=80, blank=True, default='',
        help_text='যেমন hw:1,0 — ফাঁকা রাখলে V4L2 embedded audio ব্যবহার হবে',
        verbose_name='ALSA অডিও ডিভাইস',
    )
    framerate = models.CharField(
        max_length=10, choices=FRAMERATE_CHOICES, default='25',
        verbose_name='ফ্রেম রেট',
    )

    # ── DVB — স্যাটেলাইট কার্ড ─────────────────────────────────────
    dvb_adapter    = models.PositiveSmallIntegerField(
        default=0,
        help_text='কার্ড নম্বর: 0=প্রথম কার্ড, 1=দ্বিতীয় কার্ড…',
        verbose_name='DVB Adapter নম্বর',
    )
    dvb_frequency  = models.PositiveIntegerField(
        default=0,
        help_text='KHz এককে — যেমন 11538000 (11538 MHz)',
        verbose_name='Frequency (KHz)',
    )
    dvb_symbol_rate = models.PositiveIntegerField(
        default=27500,
        help_text='KSymbols/sec — যেমন 27500',
        verbose_name='Symbol Rate',
    )
    dvb_polarization = models.CharField(
        max_length=1, choices=POLARIZATION_CHOICES, default='H',
        verbose_name='Polarization',
    )
    dvb_video_pid = models.PositiveIntegerField(
        default=0, blank=True,
        help_text='Video PID — 0 হলে auto-detect',
        verbose_name='Video PID',
    )
    dvb_audio_pid = models.PositiveIntegerField(
        default=0, blank=True,
        help_text='Audio PID — 0 হলে auto-detect',
        verbose_name='Audio PID',
    )

    # ── URL — RTSP / HTTP / UDP ──────────────────────────────────────
    source_url = models.CharField(
        max_length=500, blank=True, default='',
        help_text='rtsp://… বা http://localhost:9981/stream/… বা udp://…',
        verbose_name='সোর্স URL (Primary)',
    )
    # একাধিক backup URL: [{"label": "Backup 1", "url": "http://..."}, ...]
    extra_urls = models.JSONField(
        default=list, blank=True,
        verbose_name='Backup URLs',
        help_text='Primary URL fail হলে এগুলো try করা হবে (best ping auto-select)',
    )

    # ── এনকোডিং সেটিংস ─────────────────────────────────────────────
    resolution    = models.CharField(max_length=20, choices=RESOLUTION_CHOICES, default='1920x1080')
    video_bitrate = models.PositiveIntegerField(default=2500, help_text='kbps')
    audio_bitrate = models.PositiveIntegerField(default=128,  help_text='kbps')
    use_qsv       = models.BooleanField(default=True, verbose_name='Intel QSV ব্যবহার করুন')

    # url-type চ্যানেলে সোর্স আগে থেকেই browser-compatible (H.264/AAC) হলে local
    # FFmpeg mirror চালানোর দরকার নেই — সরাসরি upstream URL হালকা HTTP proxy
    # (livetv/services/hls_proxy_service.py, কোনো subprocess/RAM খরচ নেই) দিয়ে
    # serve করা যায়। HEVC/exotic codec হলে এই mode-এ browser play করতে পারবে না —
    # সেক্ষেত্রে admin এটা বন্ধ রেখে আগের মতো ffmpeg relay/Transcode ব্যবহার করবে।
    direct_relay = models.BooleanField(
        default=False,
        verbose_name='সরাসরি সোর্স (No FFmpeg — RAM বাঁচায়)',
        help_text='চালু থাকলে local FFmpeg mirror ছাড়াই সরাসরি সোর্স URL থেকে proxy করে '
                   'দেখানো হবে। শুধু browser-compatible (H.264/AAC) সোর্সের জন্য কাজ করবে।',
    )

    # HLS সেটিংস
    hls_segment_time = models.PositiveSmallIntegerField(default=3, help_text='সেকেন্ড')
    hls_list_size    = models.PositiveSmallIntegerField(default=5)

    # ── স্ট্যাটাস ───────────────────────────────────────────────────
    status            = models.CharField(max_length=10, choices=STATUS_CHOICES, default='stopped')
    ffmpeg_pid        = models.IntegerField(null=True, blank=True)
    tuner_pid         = models.IntegerField(null=True, blank=True, help_text='DVB tune process PID')
    error_message     = models.TextField(blank=True, default='')
    stream_started_at = models.DateTimeField(null=True, blank=True)

    is_active  = models.BooleanField(default=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # শেষবার ping করা ফলাফল — dashboard সবসময় এটা দেখাবে (কখনো pending নয়)
    last_ping_ms      = models.IntegerField(null=True, blank=True, help_text='শেষ সফল ping latency (ms)')
    last_ping_ok      = models.BooleanField(null=True, blank=True, help_text='শেষ ping reachable ছিল কিনা')
    last_pinged_at    = models.DateTimeField(null=True, blank=True, help_text='শেষ ping সময়')

    # Deep content check — actual video stream আছে কিনা (ffprobe/HTTP দিয়ে verify)
    last_content_ok     = models.BooleanField(null=True, blank=True, help_text='video stream verify হয়েছে কিনা')
    last_content_checked_at = models.DateTimeField(null=True, blank=True, help_text='শেষ content check সময়')

    class Meta:
        db_table = 'livetv_channel'
        ordering = ['sort_order', 'name']
        verbose_name = 'TV চ্যানেল'

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.name) or f'channel-{self.pk or "new"}'
            slug = base
            n = 1
            while TVChannel.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug = f'{base}-{n}'
                n += 1
            self.slug = slug
        super().save(*args, **kwargs)

    @property
    def hls_output_dir(self):
        from django.conf import settings
        import os
        return os.path.join(settings.MEDIA_ROOT, 'hls', self.slug)

    @property
    def hls_playlist_path(self):
        import os
        return os.path.join(self.hls_output_dir, 'index.m3u8')

    @property
    def hls_url(self):
        from django.conf import settings
        return f"{settings.MEDIA_URL}hls/{self.slug}/index.m3u8"

    @property
    def dvr_device(self):
        """DVB মোডে DVR device পাথ।"""
        return f'/dev/dvb/adapter{self.dvb_adapter}/dvr0'

    @property
    def dvb_frontend_device(self):
        """DVB মোডে frontend device পাথ।"""
        return f'/dev/dvb/adapter{self.dvb_adapter}/frontend0'


class LiveTVSubscriber(models.Model):
    """Live TV App-এর registered subscriber — শুধু এরাই channel দেখতে পাবে।"""
    name        = models.CharField(max_length=100, verbose_name='নাম')
    phone       = models.CharField(max_length=20, unique=True, verbose_name='মোবাইল নম্বর')
    password    = models.CharField(max_length=255, verbose_name='পাসওয়ার্ড (hashed)')
    customer_id = models.CharField(max_length=50, blank=True, verbose_name='Customer ID (optional)')
    is_active   = models.BooleanField(default=True, verbose_name='সক্রিয়')
    expires_at  = models.DateTimeField(null=True, blank=True, verbose_name='মেয়াদ শেষ (খালি = unlimited)')
    notes       = models.TextField(blank=True, verbose_name='মন্তব্য')
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        db_table  = 'livetv_subscriber'
        ordering  = ['-created_at']
        verbose_name = 'Live TV Subscriber'

    def __str__(self):
        return f'{self.name} ({self.phone})'

    def set_password(self, raw):
        from django.contrib.auth.hashers import make_password
        self.password = make_password(raw)

    def check_password(self, raw):
        from django.contrib.auth.hashers import check_password
        return check_password(raw, self.password)

    @property
    def is_expired(self):
        if not self.expires_at:
            return False
        from django.utils import timezone
        return timezone.now() > self.expires_at


class FTPVideoContent(models.Model):
    """Live TV App-এ দেখানোর জন্য locally managed মুভি/নাটক/সিরিজ ডেটাবেজ।"""
    CONTENT_TYPES = [
        ('movie',  'মুভি'),
        ('drama',  'নাটক'),
        ('series', 'সিরিজ'),
    ]
    title        = models.CharField(max_length=300, verbose_name='শিরোনাম')
    content_type = models.CharField(max_length=20, choices=CONTENT_TYPES, default='movie', verbose_name='ধরন')
    thumbnail_url      = models.CharField(max_length=1000, blank=True, verbose_name='থাম্বনেইল URL')
    thumbnail_filename = models.CharField(max_length=200, blank=True, default='', verbose_name='আপলোড করা থাম্বনেইলের নাম')
    description  = models.TextField(blank=True, verbose_name='বিবরণ')
    year         = models.PositiveSmallIntegerField(null=True, blank=True, verbose_name='মুক্তির বছর')
    genre        = models.CharField(max_length=200, blank=True, verbose_name='ঘরানা (কমা দিয়ে)')
    language     = models.CharField(max_length=50, blank=True, default='বাংলা', verbose_name='ভাষা')
    video_url      = models.CharField(max_length=1000, blank=True, verbose_name='ভিডিও URL')
    # আপলোড করা ফাইলের uuid filename — disk-এ file track করার জন্য
    # বাইরের URL হলে blank, আপলোড হলে 'abc123.mp4' রকম value
    video_filename = models.CharField(max_length=200, blank=True, default='', verbose_name='আপলোড করা ফাইলের নাম')
    # সিরিজ/নাটক-এর জন্য এপিসোড তথ্য
    series_title = models.CharField(max_length=300, blank=True, verbose_name='সিরিজের নাম (এপিসোড হলে)')
    season       = models.PositiveSmallIntegerField(null=True, blank=True, verbose_name='সিজন নম্বর')
    episode      = models.PositiveSmallIntegerField(null=True, blank=True, verbose_name='এপিসোড নম্বর')
    is_active    = models.BooleanField(default=True, verbose_name='সক্রিয়')
    order        = models.PositiveIntegerField(default=0, verbose_name='ক্রম')
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order', '-created_at']
        verbose_name = 'FTP Video Content'

    def __str__(self):
        if self.content_type == 'series' and self.episode:
            return f'{self.series_title or self.title} S{self.season or 1}E{self.episode}'
        return self.title
