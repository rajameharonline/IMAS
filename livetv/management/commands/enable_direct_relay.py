# url-type চ্যানেলগুলোর source codec probe করে যেগুলো আগে থেকেই H.264/AAC
# (browser/mobile-compatible), সেগুলোতে direct_relay=True সেট করে দেয় —
# ফলে local FFmpeg mirror ছাড়াই zero-CPU/RAM upstream proxy হবে
# (mobile_api.AppLiveTVStreamProxyView._serve_direct, token-gated প্রক্সিই থাকে,
# raw source_url client-কে দেওয়া হয় না)।
# HEVC/exotic codec চ্যানেল ইচ্ছাকৃতভাবে বাদ রাখা হয় — direct_relay মোডে auto
# transcode fallback নেই, তাই ভুলভাবে enable করলে playback ভেঙে যাবে।
import concurrent.futures

from django.core.management.base import BaseCommand

from livetv.models import TVChannel
from livetv.services.stream_service import StreamService


class Command(BaseCommand):
    help = 'Codec-compatible url-type LiveTV চ্যানেলে direct_relay auto-enable করে (zero-ffmpeg)।'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='শুধু রিপোর্ট করবে, DB আপডেট করবে না')
        parser.add_argument('--workers', type=int, default=8, help='সমান্তরাল ffprobe সংখ্যা')

    def handle(self, *args, **opts):
        dry_run = opts['dry_run']
        channels = list(
            TVChannel.objects.filter(
                input_type='url', is_active=True, direct_relay=False,
            ).exclude(source_url='')
        )
        self.stdout.write(f'পরীক্ষা করা হচ্ছে {len(channels)}টি url-type চ্যানেল...')

        def probe(ch):
            vcodec, acodec = StreamService._probe_codecs(ch.source_url)
            video_ok = vcodec in StreamService._SAFE_VIDEO_CODECS
            audio_ok = acodec in StreamService._SAFE_AUDIO_CODECS
            return ch, vcodec, acodec, (video_ok and audio_ok)

        eligible = []
        skipped = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=opts['workers']) as ex:
            for ch, vcodec, acodec, ok in ex.map(probe, channels):
                if ok:
                    eligible.append(ch)
                else:
                    skipped.append((ch, vcodec, acodec))

        if not dry_run and eligible:
            ids = [c.id for c in eligible]
            TVChannel.objects.filter(id__in=ids).update(direct_relay=True)

        self.stdout.write(self.style.SUCCESS(
            f'H.264/AAC উপযুক্ত: {len(eligible)}টি'
            + (' → direct_relay চালু করা হলো' if not dry_run else ' (dry-run, কোনো পরিবর্তন হয়নি)')
        ))
        self.stdout.write(f'বাদ পড়েছে (HEVC/exotic/unreachable): {len(skipped)}টি')
        for ch, vcodec, acodec in skipped[:30]:
            self.stdout.write(f'  - {ch.name} (id={ch.id}): video={vcodec} audio={acodec}')
