"""FFmpeg stream process ম্যানেজমেন্ট সার্ভিস।

তিন ধরনের ইনপুট:
  1. v4l2 — HDMI PCIe capture কার্ড (/dev/video0 … /dev/video7)
  2. dvb  — DVB-S2 স্যাটেলাইট কার্ড (/dev/dvb/adapter0/dvr0 …)
  3. url  — RTSP / HTTP / UDP / IPTV stream

DVB-S2 ও HDMI কার্ড একই সার্ভারে একসাথে চলতে পারে —
device namespace সম্পূর্ণ আলাদা:
  DVB  → /dev/dvb/adapterX/  (dvb subsystem)
  HDMI → /dev/videoX         (v4l2 subsystem)
তাই কোনো conflict নেই।
"""
import os
import glob
import signal
import subprocess
import logging
import time
from django.utils import timezone

logger = logging.getLogger(__name__)


class StreamService:
    """FFmpeg-ভিত্তিক HLS stream lifecycle manager।"""

    # ── Device Validation ───────────────────────────────────────────

    @staticmethod
    def _validate_v4l2(channel):
        """v4l2 চ্যানেল device path + conflict check → error str বা None।"""
        if not channel.device_path:
            return 'V4L2 ডিভাইস পাথ দেওয়া নেই।'
        if not os.path.exists(channel.device_path):
            return (
                f'ডিভাইস পাওয়া যায়নি: {channel.device_path}\n'
                'HDMI কার্ড PCIe-তে লাগানো আছে ও kernel driver load হয়েছে কিনা চেক করুন।\n'
                'কমান্ড: v4l2-ctl --list-devices'
            )
        # অন্য চ্যানেল কি এই device ব্যবহার করছে?
        from ..models import TVChannel
        conflict = TVChannel.objects.filter(
            input_type='v4l2',
            device_path=channel.device_path,
            status__in=['live', 'starting'],
        ).exclude(pk=channel.pk).first()
        if conflict:
            return f'এই ডিভাইস ({channel.device_path}) ইতিমধ্যে "{conflict.name}" চ্যানেল ব্যবহার করছে।'
        return None

    @staticmethod
    def _validate_dvb(channel):
        """dvb চ্যানেল frontend/dvr device + adapter conflict check → error str বা None।"""
        frontend = channel.dvb_frontend_device
        dvr      = channel.dvr_device
        if not os.path.exists(frontend):
            return (
                f'DVB frontend পাওয়া যায়নি: {frontend}\n'
                'DVB-S2 কার্ড PCIe-তে লাগানো ও driver load হয়েছে কিনা চেক করুন।\n'
                'কমান্ড: ls /dev/dvb/'
            )
        if not os.path.exists(dvr):
            return f'DVB DVR device পাওয়া যায়নি: {dvr}'
        # একই adapter-এ দুটো চ্যানেল চালানো যাবে না
        from ..models import TVChannel
        conflict = TVChannel.objects.filter(
            input_type='dvb',
            dvb_adapter=channel.dvb_adapter,
            status__in=['live', 'starting'],
        ).exclude(pk=channel.pk).first()
        if conflict:
            return (
                f'DVB Adapter {channel.dvb_adapter} ইতিমধ্যে "{conflict.name}" ব্যবহার করছে।\n'
                'একটি adapter = একটি frequency। ভিন্ন চ্যানেলের জন্য আলাদা adapter লাগাতে হবে।'
            )
        return None

    @staticmethod
    def validate_channel(channel):
        """চ্যানেল start করার আগে device/URL পরীক্ষা করে।
        সমস্যা থাকলে (str error_msg, ) tuple ফেরত দেয়; OK হলে None।
        """
        if channel.input_type == 'v4l2':
            return StreamService._validate_v4l2(channel)
        if channel.input_type == 'dvb':
            return StreamService._validate_dvb(channel)
        if channel.input_type == 'url' and not channel.source_url:
            return 'সোর্স URL দেওয়া নেই।'
        return None  # সব ঠিক আছে

    # ── Input builders ──────────────────────────────────────────────

    @staticmethod
    def _input_v4l2(channel):
        res = channel.resolution if channel.resolution != 'passthrough' else '1920x1080'
        video_in = [
            '-f', 'v4l2',
            '-video_size', res,
            '-framerate', channel.framerate,
            '-i', channel.device_path,
        ]
        audio_in = ['-f', 'alsa', '-i', channel.audio_device] if channel.audio_device else []
        return video_in, audio_in, []

    @staticmethod
    def _input_dvb(channel):
        video_in = ['-i', channel.dvr_device]
        map_args = []
        if channel.dvb_video_pid:
            map_args += ['-map', f'0:p:{channel.dvb_video_pid}']
        else:
            map_args += ['-map', '0:v:0?']
        if channel.dvb_audio_pid:
            map_args += ['-map', f'0:a:{channel.dvb_audio_pid}']
        else:
            map_args += ['-map', '0:a:0?']
        return video_in, [], map_args

    @staticmethod
    def _best_variant_url(base_url, lines):
        """muxed master playlist-এর lines থেকে best-bandwidth rendition-এর absolute URL
        (না পেলে None)।"""
        import re
        import urllib.parse as _up
        best_url = None
        best_bw  = 0
        for i, raw in enumerate(lines):
            line = raw.strip()
            if not line.startswith('#EXT-X-STREAM-INF:'):
                continue
            if i + 1 >= len(lines):
                continue
            rendition = lines[i + 1].strip()
            if not rendition or rendition.startswith('#'):
                continue
            m = re.search(r'BANDWIDTH=(\d+)', line)
            bw = int(m.group(1)) if m else 0
            if bw >= best_bw:
                best_bw  = bw
                best_url = rendition
        if not best_url:
            return None
        # Relative URL → absolute
        return _up.urljoin(base_url, best_url)

    @staticmethod
    def _resolve_hls_url(url):
        """Master HLS playlist-এ external audio rendition থাকলে direct video URL বের করো।
        CMAF/fMP4 streams-এ external audio track-এর segment 404 দিলে FFmpeg fail করে।
        Direct media playlist ব্যবহার করলে সেই সমস্যা এড়ানো যায়।
        """
        import re
        import urllib.request as _ur

        if not url.lower().endswith('.m3u8') and '.m3u8?' not in url.lower():
            return url

        try:
            req = _ur.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with _ur.urlopen(req, timeout=8) as r:
                text = r.read().decode('utf-8', errors='ignore')
        except Exception:
            return url  # fetch fail → original URL ব্যবহার করো

        # Master playlist-এ EXT-X-STREAM-INF থাকে, media playlist-এ থাকে না
        if '#EXT-X-STREAM-INF' not in text:
            return url  # ইতিমধ্যে media playlist — সরাসরি ব্যবহার করো

        # আলাদা audio rendition থাকলে (CMAF: `#EXT-X-MEDIA:TYPE=AUDIO`) video rendition
        # গুলো video-only — তখন সেটায় resolve করলে audio বাদ পড়ে (BTV FIFA fmp4-এর মতো)।
        # master-ই ffmpeg-কে দাও যাতে সে audio+video দুটো track নিয়ে mux করে।
        if re.search(r'#EXT-X-MEDIA:\s*TYPE=AUDIO', text):
            return url

        # (muxed variant master) → best rendition URL বের করো
        return StreamService._best_variant_url(url, text.splitlines()) or url

    @staticmethod
    def _input_url(channel):
        # CMAF/fMP4 master playlist-এ external audio rendition থাকলে direct video URL ব্যবহার করো
        src = StreamService._resolve_hls_url(channel.source_url)
        video_in = [
            # অনেক CDN/worker endpoint browser User-Agent ছাড়া 400/403 দেয় —
            # ffmpeg-এর default UA গোপন করে সাধারণ browser UA পাঠাই।
            '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                           '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            # fMP4/CMAF HLS-এ segment extension অস্বাভাবিক হতে পারে (যেমন `.hls.fmp4`) —
            # ffmpeg default-এ সেগুলো reject করে ("Invalid data")। picky বন্ধ করলে
            # allowed_extensions ALL-এর সাথে এসব fmp4 segment ঠিকমতো লোড হয়।
            '-extension_picky', '0',
            # দ্রুত startup (cold-start loading কমাতে): ছোট analyzeduration/probesize-এ
            # ইনপুট দ্রুত খোলে (warm-up ~৪-৫s → ~২s)। `nobuffer` বাদ দেওয়া হলো — সেটা
            # ইনপুট buffering কমিয়ে startup সামান্য দ্রুত করত, কিন্তু flaky source-এ mirror
            # output-এ jitter/gap আনত (playback আটকাত)। `genpts` রাখা — timestamp gap
            # পূরণ করে মসৃণ playback দেয়।
            '-analyzeduration', '1500000',   # 1.5s
            '-probesize', '1500000',         # 1.5MB
            '-fflags', '+genpts',
            # HTTP reconnect: segment expire হলে retry করবে
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '3',
            # fMP4/CMAF HLS: extension mismatch warning এবং protocol whitelist
            '-allowed_extensions', 'ALL',
            '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
            # Live stream: latest segment থেকে শুরু করো
            '-live_start_index', '-1',
            '-i', src,
        ]
        return video_in, [], []

    # ── Video encoder ───────────────────────────────────────────────

    @staticmethod
    def _video_encoder(channel):
        if channel.resolution == 'passthrough':
            return [], ['-c:v', 'copy']

        scale = f'scale={channel.resolution}'
        bv    = channel.video_bitrate

        if channel.use_qsv:
            hw   = ['-init_hw_device', 'qsv=qsv:hw', '-filter_hw_device', 'qsv']
            enc  = [
                '-vf', scale, '-c:v', 'h264_qsv', '-preset', 'medium',
                '-b:v', f'{bv}k', '-maxrate', f'{int(bv*1.2)}k',
                '-bufsize', f'{bv*2}k', '-g', '50',
            ]
        else:
            hw  = []
            enc = [
                '-vf', scale, '-c:v', 'libx264', '-preset', 'ultrafast',
                '-tune', 'zerolatency', '-b:v', f'{bv}k', '-g', '50',
            ]
        return hw, enc

    # ── DVB tuning ──────────────────────────────────────────────────

    @staticmethod
    def _tune_dvb(channel):
        """dvbv5-zap দিয়ে DVB-S2 adapter tune করে।"""
        freq_mhz = channel.dvb_frequency // 1000
        cmd = [
            'dvbv5-zap',
            '-a', str(channel.dvb_adapter),
            '-f', str(freq_mhz),
            '-S', str(channel.dvb_symbol_rate),
            '-p', channel.dvb_polarization,
            '-s', 'DVB-S2',
            '-r',
        ]
        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            time.sleep(2)  # tune হতে ২ সেকেন্ড
            return proc.pid
        except FileNotFoundError:
            # dvbv5-zap নেই — Tvheadend আগে tune করে রেখেছে বলে ধরা হচ্ছে
            logger.warning(
                "dvbv5-zap পাওয়া যায়নি — adapter %d ইতিমধ্যে tune আছে বলে ধরা হচ্ছে।",
                channel.dvb_adapter,
            )
            return None

    # ── Codec probe (auto-transcode decision) ─────────────────────────
    @staticmethod
    def _probe_codecs(url):
        """ffprobe দিয়ে video/audio codec_name বের করে (একই call-এ দুটোই)।
        HEVC/AC3/MP2 ইত্যাদি mobile app (ExoPlayer/AVPlayer)-এ প্রায়ই চলে না —
        audio শোনা যায় কিন্তু video কালো থাকে, বা পুরো playback fail করে। তাই
        pure `-c copy` করার আগে জেনে নেওয়া দরকার source আসলে H.264/AAC কিনা।
        protected stream/timeout/geo-block হলে (None, None) ফেরত দেয় — caller
        সেক্ষেত্রে আগের নিরাপদ default (compatible ধরে নিয়ে copy) ব্যবহার করবে,
        যাতে ffprobe fail করলে existing কাজ করা চ্যানেল ভেঙে না যায়।
        """
        try:
            r = subprocess.run([
                'ffprobe', '-v', 'error',
                '-user_agent', 'Mozilla/5.0',
                '-allowed_extensions', 'ALL',
                '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
                '-show_entries', 'stream=codec_type,codec_name',
                '-of', 'csv=p=0',
                url,
            ], capture_output=True, text=True, timeout=12)
        except (OSError, subprocess.TimeoutExpired):
            return None, None
        if r.returncode != 0:
            return None, None

        vcodec = acodec = None
        for line in r.stdout.strip().splitlines():
            parts = [p.strip().lower() for p in line.split(',')]
            if len(parts) != 2:
                continue
            # ffprobe csv আউটপুট request করা field order (codec_type,codec_name) মানে না —
            # আসলে সবসময় codec_name,codec_type দেয় (alphabetical মনে হয়)। position-নির্ভর
            # unpack না করে কোন value 'video'/'audio' তা দেখে চিনি — যেটা নয় সেটাই codec name।
            if 'video' in parts:
                ctype, cname = 'video', next(p for p in parts if p != 'video')
            elif 'audio' in parts:
                ctype, cname = 'audio', next(p for p in parts if p != 'audio')
            else:
                continue
            if ctype == 'video' and vcodec is None:
                vcodec = cname
            elif ctype == 'audio' and acodec is None:
                acodec = cname
        return vcodec, acodec

    # HLS mobile player (expo-video/ExoPlayer/AVPlayer)-এ নিরাপদে চলে এমন codec —
    # এর বাইরে কিছু পেলে auto-transcode ট্রিগার হবে।
    _SAFE_VIDEO_CODECS = {'h264'}
    _SAFE_AUDIO_CODECS = {'aac'}

    @staticmethod
    def _forced_video_encoder(channel):
        """Codec mismatch (HEVC ইত্যাদি) auto-detect হলে বাধ্যতামূলক transcode —
        _video_encoder-এর মতো passthrough=copy fallback নেই। URL/IPTV সোর্সে QSV
        driver অনেক সময় থাকে না (Intel HW নাও থাকতে পারে), তাই start_transcode
        manual action-এর মতোই এখানেও নির্ভরযোগ্য software libx264 ব্যবহার করা হয়।
        """
        bv = channel.video_bitrate
        vf = [] if channel.resolution == 'passthrough' else ['-vf', f'scale={channel.resolution}']
        # preset veryfast (ultrafast নয়) — একই bitrate-এ স্পষ্টতর ছবি; CPU সামান্য বেশি
        # কিন্তু auto-transcode শুধু incompatible-codec চ্যানেলে হয় (হাতেগোনা), তাই গ্রহণযোগ্য।
        # High profile + যথেষ্ট maxrate/bufsize দিয়ে macroblocking কমে, motion clean থাকে।
        return vf + [
            '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
            '-profile:v', 'high', '-level', '4.1',
            '-b:v', f'{bv}k', '-maxrate', f'{int(bv * 1.5)}k', '-bufsize', f'{bv * 2}k',
            '-pix_fmt', 'yuv420p', '-g', '50',
        ]

    # ── URL/IPTV shared relay (mirror) ───────────────────────────────
    # কেন আলাদা builder: url-type চ্যানেল হাজার subscriber একসাথে দেখতে পারে।
    # প্রতি viewer আলাদা upstream fetch করলে bandwidth ও gunicorn worker দুটোই
    # শেষ হয়ে যায় (10k viewer = ~50 Gbps + worker starvation)। v4l2/dvb-এর মতো
    # এখানেও একবার FFmpeg upstream থেকে পড়ে local HLS লেখে — সব subscriber সেই
    # এক কপি থেকে পড়ে (mobile_api.AppLiveTVStreamProxyView)। সোর্স ইতিমধ্যে
    # H.264/AAC হলে pure `-c copy` (re-encode নয়, CPU cost প্রায় শূন্য), আর নাহলে
    # _probe_codecs auto-detect করে শুধু incompatible track-টাই transcode করে
    # (বাকি track copy থাকে) — manual "Transcode" action আর দরকার হবে না বেশিরভাগ ক্ষেত্রে।
    @staticmethod
    def _build_relay_cmd(channel):
        out_dir  = channel.hls_output_dir
        os.makedirs(out_dir, exist_ok=True)
        playlist = os.path.join(out_dir, 'index.m3u8')
        segment  = os.path.join(out_dir, 'seg%05d.ts')

        vin, ain, map_a = StreamService._input_url(channel)
        src = vin[-1]  # _input_url-এর শেষ argument resolved source URL

        vcodec, acodec = StreamService._probe_codecs(src)
        video_ok = vcodec is None or vcodec in StreamService._SAFE_VIDEO_CODECS
        audio_ok = acodec is None or acodec in StreamService._SAFE_AUDIO_CODECS

        if video_ok:
            venc = ['-c:v', 'copy']
        else:
            logger.info(
                "'%s' — video codec '%s' mobile-compatible নয়, auto libx264 transcode শুরু হচ্ছে।",
                channel.name, vcodec,
            )
            venc = StreamService._forced_video_encoder(channel)

        if audio_ok:
            aenc = ['-c:a', 'copy']
        else:
            logger.info(
                "'%s' — audio codec '%s' mobile-compatible নয়, auto AAC transcode শুরু হচ্ছে।",
                channel.name, acodec,
            )
            aenc = ['-c:a', 'aac', '-b:a', f'{channel.audio_bitrate}k', '-ar', '44100', '-ac', '2']

        # live window কমপক্ষে ~১২ সেগমেন্ট (~৩৬s) রাখা — player-এর buffer headroom বাড়ে,
        # client network dip-এ সাময়িক পিছিয়ে পড়লেও চাওয়া segment disk-এ থাকে (404/rebuffer
        # কম, playback মসৃণ)। player live edge-এর কাছেই শুরু করে, তাই বড় window latency
        # বাড়ায় না — শুধু recover করার জায়গা বেশি দেয়।
        list_size = max(channel.hls_list_size, 12)
        hls = [
            '-f', 'hls',
            '-hls_time', str(channel.hls_segment_time),
            '-hls_list_size', str(list_size),
            '-hls_flags', 'delete_segments+append_list',
            '-hls_segment_filename', segment,
            playlist,
        ]
        return ['ffmpeg', '-y'] + vin + ain + map_a + venc + aenc + hls

    # ── FFmpeg command builder ──────────────────────────────────────

    @staticmethod
    def _build_cmd(channel):
        out_dir  = channel.hls_output_dir
        os.makedirs(out_dir, exist_ok=True)
        playlist = os.path.join(out_dir, 'index.m3u8')
        segment  = os.path.join(out_dir, 'seg%05d.ts')

        if channel.input_type == 'v4l2':
            vin, ain, map_a = StreamService._input_v4l2(channel)
        elif channel.input_type == 'dvb':
            vin, ain, map_a = StreamService._input_dvb(channel)
        else:
            vin, ain, map_a = StreamService._input_url(channel)

        hw, venc = StreamService._video_encoder(channel)
        aenc = ['-c:a', 'aac', '-b:a', f'{channel.audio_bitrate}k', '-ar', '44100', '-ac', '2']
        hls  = [
            '-f', 'hls',
            '-hls_time', str(channel.hls_segment_time),
            '-hls_list_size', str(channel.hls_list_size),
            '-hls_flags', 'delete_segments+append_list',
            '-hls_segment_filename', segment,
            playlist,
        ]

        return ['ffmpeg', '-y'] + hw + vin + ain + map_a + venc + aenc + hls

    # ── Lifecycle ───────────────────────────────────────────────────

    @staticmethod
    def start_stream(channel):
        """স্ট্রিম শুরু করে। validate → DVB tune → FFmpeg launch।"""
        StreamService.stop_stream(channel)

        # device/URL validation
        err = StreamService.validate_channel(channel)
        if err:
            channel.status = 'error'
            channel.error_message = err
            channel.save(update_fields=['status', 'error_message'])
            return False, err

        tuner_pid = None
        if channel.input_type == 'dvb':
            try:
                tuner_pid = StreamService._tune_dvb(channel)
            except OSError as exc:
                channel.status = 'error'
                channel.error_message = str(exc)
                channel.save(update_fields=['status', 'error_message'])
                return False, str(exc)

        cmd = (
            StreamService._build_relay_cmd(channel) if channel.input_type == 'url'
            else StreamService._build_cmd(channel)
        )
        log_path = os.path.join(channel.hls_output_dir, 'ffmpeg.log')

        try:
            with open(log_path, 'a', encoding='utf-8') as lf:
                ts = timezone.now()
                lf.write(f'\n\n=== {ts} | {channel.input_type.upper()} ===\n')
                lf.write('CMD: ' + ' '.join(cmd) + '\n\n')
                proc = subprocess.Popen(
                    cmd, stdout=lf, stderr=lf,
                    close_fds=True, start_new_session=True,
                )
            channel.ffmpeg_pid = proc.pid
            channel.tuner_pid  = tuner_pid
            channel.status     = 'starting'
            channel.error_message     = ''
            channel.stream_started_at = timezone.now()
            channel.save(update_fields=[
                'ffmpeg_pid', 'tuner_pid', 'status', 'error_message', 'stream_started_at',
            ])
            logger.info("'%s' [%s] started PID=%s", channel.name, channel.input_type, proc.pid)
            return True, proc.pid
        except OSError as exc:
            channel.status = 'error'
            channel.error_message = str(exc)
            channel.ffmpeg_pid = None
            channel.save(update_fields=['status', 'error_message', 'ffmpeg_pid'])
            return False, str(exc)

    @staticmethod
    def _kill_tracked_pids(channel):
        """DB-তে ট্র্যাক করা ffmpeg_pid/tuner_pid-কে SIGTERM পাঠায়, কারা সফলভাবে
        signal পেয়েছে তার set রিটার্ন করে।"""
        pids = set()
        for attr in ('ffmpeg_pid', 'tuner_pid'):
            pid = getattr(channel, attr)
            if not pid:
                continue
            try:
                os.killpg(os.getpgid(pid), signal.SIGTERM)
                pids.add(pid)
            except OSError:
                pass
        return pids

    @staticmethod
    def _kill_orphan_pids(channel, already_killed):
        """DB-তে ট্র্যাক করা pid ছাড়াও, একই hls_output_dir-এ লেখা কোনো orphan
        ffmpeg থাকলে (check_status ভুলে ffmpeg_pid wipe করে ফেলেছিল এমন পুরনো
        process) সেটাও খুঁজে বন্ধ করে — নইলে নতুন start_stream() একই ডিরেক্টরিতে
        দ্বিতীয় ffmpeg চালু করে duplicate তৈরি করে। নতুন করে মারা pid-গুলোর set রিটার্ন করে।"""
        killed = set()
        try:
            out_dir = channel.hls_output_dir
            found = subprocess.run(
                ['pgrep', '-f', f'-hls_segment_filename {out_dir}/'],
                capture_output=True, text=True, timeout=5,
            ).stdout.split()
            for pid_str in found:
                pid = int(pid_str)
                if pid in already_killed:
                    continue
                try:
                    os.killpg(os.getpgid(pid), signal.SIGTERM)
                    killed.add(pid)
                except OSError:
                    pass
        except (OSError, subprocess.SubprocessError, ValueError):
            pass
        return killed

    @staticmethod
    def _schedule_sigkill_escalation(pids):
        """SIGTERM-এ কিছু ffmpeg instance সাথে সাথে মরে না (network I/O-তে আটকে
        থাকতে পারে) — reaping apps.py-এর SIGCHLD handler করে, কিন্তু ৫ সেকেন্ড
        পরও বেঁচে থাকলে SIGKILL পাঠানো দরকার যাতে ঝুলে না থাকে।"""
        import threading

        def _escalate(pids_to_check):
            time.sleep(5)
            for pid in pids_to_check:
                try:
                    os.kill(pid, 0)  # এখনো বেঁচে আছে কিনা
                    os.killpg(os.getpgid(pid), signal.SIGKILL)
                except OSError:
                    pass  # ইতিমধ্যে মারা গেছে ও reap হয়ে গেছে

        threading.Thread(target=_escalate, args=(pids,), daemon=True).start()

    @staticmethod
    def stop_stream(channel):
        """FFmpeg ও tuner process বন্ধ করে।"""
        pids = StreamService._kill_tracked_pids(channel)
        pids |= StreamService._kill_orphan_pids(channel, pids)

        if pids:
            StreamService._schedule_sigkill_escalation(pids)

        channel.ffmpeg_pid = channel.tuner_pid = None
        channel.status = 'stopped'
        channel.stream_started_at = None
        channel.save(update_fields=['ffmpeg_pid', 'tuner_pid', 'status', 'stream_started_at'])

    @staticmethod
    def check_status(channel):
        if channel.status in ('stopped', 'error') or not channel.ffmpeg_pid:
            return channel.status
        try:
            os.kill(channel.ffmpeg_pid, 0)
            if os.path.exists(channel.hls_playlist_path) and channel.status != 'live':
                channel.status = 'live'
                channel.save(update_fields=['status'])
        except ProcessLookupError:
            # PID সত্যিই মৃত (ESRCH) — এখানেই শুধু error mark ও pid clear করা নিরাপদ।
            channel.status = 'error'
            channel.ffmpeg_pid = None
            channel.error_message = StreamService._extract_error_reason(channel)
            channel.save(update_fields=['status', 'ffmpeg_pid', 'error_message'])
        except OSError:
            # অন্য কোনো OSError (যেমন EPERM — ভিন্ন user থেকে চেক করলে হতে পারে)
            # মানে process এখনো বেঁচে আছে, শুধু signal করার permission নেই। এটাকে
            # "মৃত" ধরে ffmpeg_pid wipe করলে retry task একই channel-এর জন্য নতুন
            # ffmpeg spawn করে যেত অথচ পুরনোটা কখনো মরত না — duplicate process
            # জমে RAM ফুরিয়ে যাওয়ার মূল কারণ ছিল এটা।
            pass
        return channel.status

    @staticmethod
    def _extract_error_reason(channel):
        """ffmpeg.log-এর শেষ অংশ থেকে আসল error line বের করে — জেনেরিক মেসেজের
        বদলে debugging-এর জন্য কার্যকর কারণ (যেমন 404, token expired, timeout)।
        """
        log_tail = StreamService.get_ffmpeg_log(channel, lines=40)
        if not log_tail:
            return 'FFmpeg process unexpectedly terminated.'

        # সবচেয়ে informative error line খুঁজে বের করো (নিচ থেকে উপরে)
        markers = ('Error opening input', 'HTTP error', 'Connection timed out',
                   'Invalid data found', 'Server returned', 'No route to host',
                   'Connection refused', 'error', 'Error')
        for line in reversed(log_tail.splitlines()):
            line = line.strip()
            if line and any(m in line for m in markers):
                return line[:300]
        return 'FFmpeg process unexpectedly terminated.'

    @staticmethod
    def get_ffmpeg_log(channel, lines=80):
        log_path = os.path.join(channel.hls_output_dir, 'ffmpeg.log')
        if not os.path.exists(log_path):
            return ''
        try:
            with open(log_path, 'r', encoding='utf-8', errors='replace') as f:
                return ''.join(f.readlines()[-lines:])
        except OSError:
            return ''

    # ── Hardware Scanner ────────────────────────────────────────────

    @staticmethod
    def scan_v4l2_devices():
        """উপলব্ধ HDMI V4L2 capture device তালিকা।"""
        from ..models import TVChannel
        in_use = set(TVChannel.objects.filter(
            input_type='v4l2', status__in=['live', 'starting'],
        ).values_list('device_path', flat=True))

        devices = []
        for dev in sorted(glob.glob('/dev/video*')):
            info = {'path': dev, 'name': dev, 'driver': '', 'in_use': dev in in_use}
            try:
                r = subprocess.run(
                    ['v4l2-ctl', '--device', dev, '--info'],
                    capture_output=True, text=True, timeout=3, check=False,
                )
                for line in r.stdout.splitlines():
                    if 'Card type' in line:
                        info['name'] = line.partition(':')[2].strip()
                    elif 'Driver name' in line:
                        info['driver'] = line.partition(':')[2].strip()
            except (OSError, subprocess.TimeoutExpired):
                pass
            devices.append(info)
        return devices

    @staticmethod
    def scan_dvb_adapters():
        """উপলব্ধ DVB-S2 adapter তালিকা।"""
        from ..models import TVChannel
        in_use = set(TVChannel.objects.filter(
            input_type='dvb', status__in=['live', 'starting'],
        ).values_list('dvb_adapter', flat=True))

        adapters = []
        for frontend in sorted(glob.glob('/dev/dvb/adapter*/frontend0')):
            num = int(frontend.split('adapter')[1].split('/')[0])
            info = {
                'adapter': num,
                'path': os.path.dirname(frontend),
                'dvr': f'/dev/dvb/adapter{num}/dvr0',
                'name': f'DVB Adapter {num}',
                'type': 'DVB-S2',
                'in_use': num in in_use,
            }
            try:
                r = subprocess.run(
                    ['dvb-fe-tool', '-a', str(num)],
                    capture_output=True, text=True, timeout=3, check=False,
                )
                for line in r.stdout.splitlines():
                    for t in ('DVB-S2', 'DVB-S', 'DVB-T2', 'DVB-T', 'DVB-C'):
                        if t in line:
                            info['type'] = t
                            break
            except (OSError, subprocess.TimeoutExpired):
                pass
            adapters.append(info)
        return adapters

    @staticmethod
    def scan_alsa_devices():
        try:
            r = subprocess.run(['arecord', '-l'], capture_output=True, text=True, timeout=3)
            return [l for l in r.stdout.splitlines() if 'card' in l.lower()]
        except (OSError, subprocess.TimeoutExpired):
            return []

    # ── M3U Parser ──────────────────────────────────────────────────

    # ক্যাটাগরি mapping — group-title → আমাদের category
    _M3U_CAT_MAP = {
        'news': 'news', 'সংবাদ': 'news', 'বার্তা': 'news',
        'sport': 'sports', 'sports': 'sports', 'খেলা': 'sports',
        'entertainment': 'entertainment', 'বিনোদন': 'entertainment',
        'music': 'music', 'সঙ্গীত': 'music', 'মিউজিক': 'music',
        'religious': 'religious', 'ধর্ম': 'religious', 'islamic': 'religious',
        'international': 'international', 'foreign': 'international',
    }

    @staticmethod
    def _m3u_channel_info(line, cat_map):
        """একটি #EXTINF line থেকে {name, logo_url, group, category, tvg_name} info dict
        (source_url caller পরে যোগ করে)।"""
        import re
        info = {}
        for pat, key in [
            (r'tvg-name="([^"]*)"', 'tvg_name'),
            (r'tvg-logo="([^"]*)"', 'logo_url'),
            (r'group-title="([^"]*)"', 'group'),
        ]:
            m = re.search(pat, line, re.IGNORECASE)
            info[key] = m.group(1).strip() if m else ''

        display = line.split(',', 1)[-1].strip() if ',' in line else ''
        info['name'] = info.get('tvg_name') or display or 'Channel'

        # group → category mapping
        group_lower = info.get('group', '').lower()
        info['category'] = next(
            (v for k, v in cat_map.items() if k in group_lower),
            'other',
        )
        return info

    @staticmethod
    def parse_m3u(content):
        """M3U/M3U8 playlist থেকে চ্যানেল তালিকা বের করে।
        ফেরত: [{'name', 'source_url', 'logo_url', 'category', 'group'}, …]
        """
        channels = []
        lines = content.strip().splitlines()
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            if line.startswith('#EXTINF'):
                info = StreamService._m3u_channel_info(line, StreamService._M3U_CAT_MAP)
                # পরবর্তী non-empty line = stream URL
                j = i + 1
                while j < len(lines) and not lines[j].strip():
                    j += 1
                if j < len(lines):
                    url = lines[j].strip()
                    if url and not url.startswith('#'):
                        info['source_url'] = url
                        channels.append(info)
                        i = j + 1
                        continue
            i += 1

        return channels
