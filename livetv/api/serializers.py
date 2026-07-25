from rest_framework import serializers
from urllib.parse import quote
from ..models import TVChannel, TVCategory


class TVCategorySerializer(serializers.ModelSerializer):
    channel_count = serializers.SerializerMethodField()

    class Meta:
        model  = TVCategory
        fields = ['slug', 'name', 'color', 'sort_order', 'channel_count']

    def get_channel_count(self, obj):
        return TVChannel.objects.filter(category=obj.slug).count()

    def validate_slug(self, value):
        from django.utils.text import slugify
        return slugify(value)


class TVChannelSerializer(serializers.ModelSerializer):
    hls_url            = serializers.SerializerMethodField()
    status_display     = serializers.SerializerMethodField()
    status             = serializers.SerializerMethodField()
    logo_url_encoded   = serializers.SerializerMethodField()
    category_display   = serializers.SerializerMethodField()
    resolution_display = serializers.CharField(source='get_resolution_display', read_only=True)
    input_type_display = serializers.CharField(source='get_input_type_display', read_only=True)
    uptime_seconds     = serializers.SerializerMethodField()

    class Meta:
        model  = TVChannel
        fields = [
            'id', 'name', 'slug', 'category', 'category_display',
            'logo_url', 'logo_url_encoded', 'description',

            # ইনপুট
            'input_type', 'input_type_display',

            # Backup URLs
            'extra_urls',

            # V4L2
            'device_path', 'audio_device', 'framerate',

            # DVB
            'dvb_adapter', 'dvb_frequency', 'dvb_symbol_rate',
            'dvb_polarization', 'dvb_video_pid', 'dvb_audio_pid',

            # URL
            'source_url', 'direct_relay',

            # এনকোডিং
            'resolution', 'resolution_display',
            'video_bitrate', 'audio_bitrate', 'use_qsv',
            'hls_segment_time', 'hls_list_size',

            # স্ট্যাটাস
            'status', 'status_display', 'ffmpeg_pid', 'tuner_pid',
            'error_message', 'stream_started_at',
            'hls_url', 'uptime_seconds',

            'is_active', 'sort_order', 'created_at', 'updated_at',

            # শেষ ping result — dashboard immediate দেখানোর জন্য
            'last_ping_ms', 'last_ping_ok', 'last_pinged_at',

            # Deep content check result
            'last_content_ok', 'last_content_checked_at',
        ]
        read_only_fields = [
            'slug', 'ffmpeg_pid', 'tuner_pid', 'error_message',
            'stream_started_at', 'created_at', 'updated_at',
        ]

    def get_category_display(self, obj):
        try:
            return TVCategory.objects.get(slug=obj.category).name
        except TVCategory.DoesNotExist:
            return obj.category.capitalize() if obj.category else ''

    def _url_has_ffmpeg(self, obj):
        """URL-type চ্যানেলে FFmpeg transcoding চলছে কিনা।
        direct_relay চালু থাকলে ffmpeg_pid থাকলেও False — কেননা এই মোডে ffmpeg
        কখনো spawn করানোই হবে না, সবসময় সরাসরি সোর্স থেকে proxy হবে (RAM বাঁচাতে)।
        """
        import os
        if obj.direct_relay:
            return False
        return bool(obj.ffmpeg_pid and os.path.exists(obj.hls_playlist_path))

    def get_status(self, obj):
        if obj.input_type == 'url' and obj.source_url:
            # FFmpeg transcode চলছে → actual status ব্যবহার করো
            if not obj.direct_relay and obj.ffmpeg_pid:
                return obj.status
            # Direct passthrough mode (direct_relay বা ffmpeg না থাকা) → is_active দিয়ে judge করো
            return 'live' if obj.is_active else 'stopped'
        return obj.status

    def get_status_display(self, obj):
        if obj.input_type == 'url' and obj.source_url:
            if not obj.direct_relay and obj.ffmpeg_pid:
                return obj.get_status_display()
            return 'লাইভ' if obj.is_active else 'বন্ধ'
        return obj.get_status_display()

    def get_hls_url(self, obj):
        request = self.context.get('request')
        if obj.input_type == 'url' and obj.source_url:
            # FFmpeg transcode চলছে ও local HLS আছে → local URL দাও
            if self._url_has_ffmpeg(obj):
                url = obj.hls_url
                return request.build_absolute_uri(url) if request else url
            # Direct passthrough — HLS proxy দিয়ে serve হবে (master playlist resolve সেখানে হবে)
            return obj.source_url
        url = obj.hls_url
        return request.build_absolute_uri(url) if request else url

    def get_logo_url_encoded(self, obj):
        # space-সহ URL encode করো (display-only, writable নয়)
        if not obj.logo_url:
            return ''
        return quote(obj.logo_url, safe=':/?=&%#+@!')

    def get_uptime_seconds(self, obj):
        if obj.stream_started_at and obj.status == 'live':
            from django.utils import timezone
            return int((timezone.now() - obj.stream_started_at).total_seconds())
        return None
