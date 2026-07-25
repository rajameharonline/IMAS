# Real-time SNMP trap receiver — OLT থেকে আসা link up/down, ONU register/dereg
# trap শোনে এবং ONUSignal/OLTMacCache live update করে (৫ মিনিট poll-এর অপেক্ষা নয়)।
#
# কেন pysnmp: net-snmp-এর snmptrapd এই সার্ভারে নেই; pysnmp 7 (venv-এ ইনস্টল) দিয়ে
# একটি self-contained UDP trap receiver চালানো যায়। প্রতিটি trap SNMPTrapLog-এ store
# হয় (unknown হলেও — পরে V-SOL trap OID mapping করতে)।
#
# চালানো:  python manage.py snmp_trap_listener --host 0.0.0.0 --port 1162
#   162 (standard) bind করতে root/CAP_NET_BIND_SERVICE লাগে — systemd unit দেখুন।
#   OLT-এর trap config-এ এই সার্ভারের IP ও port দিন (deploy/SNMP_TRAP_SETUP.md)।
import logging

from django.core.management.base import BaseCommand

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'OLT থেকে আসা SNMP trap শোনে এবং ONU status live আপডেট করে।'

    def add_arguments(self, parser):
        parser.add_argument('--host', default='0.0.0.0', help='Bind address (default 0.0.0.0)')
        parser.add_argument('--port', type=int, default=1162,
                            help='UDP port (default 1162; standard=162 root লাগে)')
        parser.add_argument('--community', default='',
                            help='অতিরিক্ত community (default: DB-র সব OLT community + public)')

    @staticmethod
    def _build_community_entries(opts, olt_model):
        """SNMP community → (communityIndex, contextName, olt_id) entries তৈরি করে।

        নিরাপত্তা: আগে সব OLT-এর community + 'public' একটা flat set-এ মিশিয়ে
        register করা হতো — অর্থাৎ যেকোনো community দিয়ে trap পাঠালে সেটা
        গ্রহণযোগ্য হতো, আর source_ip blindly trust করে কোন OLT আপডেট হবে তা ঠিক
        হতো (UDP source IP trivially spoofable)। এখন প্রতিটি distinct community-কে
        তার নিজস্ব OLT-bound contextName দেওয়া হয় — _handle_trap-এ সেই
        contextName cross-check করা হয় src_ip-থেকে-resolve-করা OLT-এর সাথে,
        দুটো না মিললে trap silently ignore করা হয় (state mutation হয় না,
        শুধু log-এ থাকে)।

        সীমাবদ্ধতা: একাধিক OLT একই community share করলে (যেমন সবগুলোতে ডিফল্ট
        'public') এই binding দিয়ে তাদের আলাদা করা সম্ভব না — সেক্ষেত্রে 'shared'
        contextName ব্যবহার হয় এবং _handle_trap শুধু IP-based lookup-এই fallback
        করে (আগের মতো, কম সুরক্ষিত)। প্রকৃত সুরক্ষার জন্য প্রতিটি OLT-এ আলাদা
        SNMP community সেট করার সুপারিশ করা হচ্ছে (OLT hardware config — কোড দিয়ে
        remotely করা সম্ভব না)।
        """
        olt_ids_by_community = {}   # community → set(olt_id)
        for olt_id, comm in olt_model.objects.filter(is_active=True).exclude(
            snmp_community=''
        ).values_list('id', 'snmp_community'):
            olt_ids_by_community.setdefault(comm, set()).add(olt_id)

        entries = []   # (communityIndex, community, contextName, bound_olt_id_or_None)
        idx = 0
        for comm, olt_ids in olt_ids_by_community.items():
            idx += 1
            if len(olt_ids) == 1:
                bound_olt_id = next(iter(olt_ids))
                entries.append((f'olt-{idx}', comm, f'olt-{bound_olt_id}', bound_olt_id))
            else:
                entries.append((f'shared-{idx}', comm, 'shared', None))

        seen_comms = set(olt_ids_by_community.keys())
        if opts['community'] and opts['community'] not in seen_comms:
            entries.append(('area-extra', opts['community'], 'shared', None))
            seen_comms.add(opts['community'])
        if 'public' not in seen_comms:
            entries.append(('area-public', 'public', 'shared', None))

        return entries

    @staticmethod
    def _varbinds_to_pairs(var_binds):
        """pysnmp var_binds → [(name_str, val_str)] (prettyPrint, fallback str)।"""
        pairs = []
        for name, val in var_binds:
            try:
                pairs.append((name.prettyPrint(), val.prettyPrint()))
            except Exception:
                pairs.append((str(name), str(val)))
        return pairs

    def handle(self, *args, **opts):
        # Python 3.12+/3.14-এ implicit event loop নেই; pysnmp UdpTransport construct-এর
        # সময় asyncio.get_event_loop() ডাকে — তাই আগেই একটি loop সেট করি।
        import asyncio
        try:
            asyncio.get_event_loop()
        except RuntimeError:
            asyncio.set_event_loop(asyncio.new_event_loop())

        try:
            from pysnmp.entity import engine, config
            from pysnmp.entity.rfc3413 import ntfrcv
            from pysnmp.carrier.asyncio.dgram import udp
        except Exception as e:
            self.stderr.write(self.style.ERROR(f'pysnmp import failed: {e}'))
            return

        from olt_mgmt.models import OLT
        from olt_mgmt.services import trap_service

        host, port = opts['host'], opts['port']

        # গ্রহণযোগ্য community + প্রতিটির bound OLT (contextName দিয়ে ট্র্যাক করা)
        community_entries = self._build_community_entries(opts, OLT)

        snmp_engine = engine.SnmpEngine()
        config.add_transport(
            snmp_engine, udp.DOMAIN_NAME,
            udp.UdpTransport().open_server_mode((host, port)),
        )
        shared_community_olts = []   # log-এর জন্য: কোন OLT-গুলো community share করছে
        for community_index, comm, context_name, bound_olt_id in community_entries:
            config.add_v1_system(
                snmp_engine, community_index, comm, contextName=context_name,
            )
            if context_name == 'shared':
                shared_community_olts.append(comm)
        if shared_community_olts:
            logger.warning(
                'SNMP trap listener: %d community এক বা একাধিক OLT-এ shared '
                '(%s) — এই OLT-গুলোর জন্য source_ip spoof-প্রতিরোধী community '
                'binding কাজ করবে না, শুধু IP-based lookup হবে। প্রতিটি OLT-এ '
                'আলাদা snmp_community সেট করার সুপারিশ করা হচ্ছে।',
                len(shared_community_olts), sorted(set(shared_community_olts)),
            )

        # প্রতিটি incoming message-এর উৎস IP ধরতে observer (cbFun-এ transport info থাকে না)
        shared = {'src': None}

        def _on_request(eng, execpoint, variables, cbCtx):
            try:
                ta = variables.get('transportAddress')
                if ta is not None:
                    shared['src'] = ta[0]
            except Exception:
                pass

        snmp_engine.observer.register_observer(_on_request, 'rfc3412.receiveMessage:request')

        # DB write async loop-এ ব্লক/async-unsafe হয় — তাই thread-এ offload করি।
        from concurrent.futures import ThreadPoolExecutor
        self._executor = ThreadPoolExecutor(max_workers=2)

        def _cb(eng, state_ref, ctx_engine_id, ctx_name, var_binds, cb_ctx):
            src_ip = shared.get('src') or ''
            try:
                ctx_name_str = ctx_name.prettyPrint()
            except Exception:
                ctx_name_str = str(ctx_name or '')
            varbinds = self._varbinds_to_pairs(var_binds)
            self._executor.submit(self._handle_trap, src_ip, ctx_name_str, varbinds, trap_service)

        ntfrcv.NotificationReceiver(snmp_engine, _cb)
        snmp_engine.transport_dispatcher.job_started(1)

        self.stdout.write(self.style.SUCCESS(
            f'SNMP trap listener — {host}:{port}/udp | '
            f'communities={sorted({c for _, c, _, _ in community_entries})}'))
        logger.info('snmp_trap_listener started on %s:%s', host, port)
        try:
            snmp_engine.open_dispatcher()
        except KeyboardInterrupt:
            self.stdout.write('Stopping…')
        except Exception as e:
            logger.exception('trap dispatcher error: %s', e)
        finally:
            snmp_engine.close_dispatcher()

    # varbinds JSONField-এ unbounded growth এড়াতে সীমা (trap flood/malformed device সুরক্ষা)
    _MAX_VARBINDS = 50
    _MAX_VARBIND_VALUE_LEN = 500
    # per-source rate limit ও replay-debounce window
    _RATE_LIMIT_PER_MIN = 120
    _REPLAY_DEBOUNCE_SECONDS = 3

    @classmethod
    def _bound_varbinds(cls, varbinds):
        """varbinds list/value size সীমাবদ্ধ করে (trap flood/malformed device থেকে
        অসীম DB growth এড়াতে)।"""
        trimmed = varbinds[:cls._MAX_VARBINDS]
        return [
            (str(o)[:255], str(v)[:cls._MAX_VARBIND_VALUE_LEN])
            for o, v in trimmed
        ]

    @classmethod
    def _rate_limited(cls, src_ip):
        """per-source-IP rate limit — trap flood (malicious বা malfunctioning
        device) থেকে DB/thread-pool exhaustion এড়াতে। True হলে drop করতে হবে।"""
        try:
            from django.core.cache import cache
            key = f'snmp_trap_rate:{src_ip}'
            count = cache.get(key, 0) + 1
            cache.set(key, count, timeout=60)
            return count > cls._RATE_LIMIT_PER_MIN
        except Exception:
            return False   # cache backend না থাকলে rate-limit skip (fail-open, প্রসেসিং বন্ধ না)

    @classmethod
    def _is_replay(cls, src_ip, info, varbinds):
        """একই trap অল্প সময়ে (network-layer duplicate delivery বা replay attack)
        দ্বিতীয়বার এলে debounce করে — state দুইবার mutate হওয়া বা log দুইবার
        তৈরি হওয়া এড়াতে। True হলে ইতিমধ্যে সাম্প্রতিক এই trap process হয়েছে।"""
        try:
            import hashlib
            from django.core.cache import cache
            fingerprint = hashlib.sha256(
                f"{src_ip}|{info['trap_oid']}|{info['event']}|{info['interface_id']}|{varbinds}".encode()
            ).hexdigest()
            key = f'snmp_trap_seen:{fingerprint}'
            if cache.get(key):
                return True
            cache.set(key, True, timeout=cls._REPLAY_DEBOUNCE_SECONDS)
            return False
        except Exception:
            return False

    # ── একটি trap প্রসেস করা: classify → store → ONU live update ──────────────
    def _handle_trap(self, src_ip, ctx_name, varbinds, trap_service):
        from django.utils import timezone
        from olt_mgmt.models import OLT, ONUSignal, OLTMacCache, SNMPTrapLog

        if self._rate_limited(src_ip):
            logger.warning('SNMP trap rate-limit exceeded, dropping: src=%s', src_ip)
            return

        info = trap_service.classify_trap(varbinds)

        if self._is_replay(src_ip, info, varbinds):
            logger.info('SNMP trap duplicate/replay within debounce window, skipped: '
                        'src=%s event=%s iface=%s', src_ip, info['event'], info['interface_id'])
            return

        olt = OLT.objects.filter(ip_address=src_ip).first()

        # community/contextName cross-check — নিরাপত্তা: এই trap-টা যে community দিয়ে
        # authenticate হয়েছে (ctx_name = 'olt-<id>' নির্দিষ্ট OLT-এ bound করা থাকলে),
        # সেটা src_ip থেকে resolve করা OLT-এর সাথে না মিললে identity mismatch — reject।
        # ctx_name == 'shared' মানে community একাধিক OLT-এ পুনরাবৃত্ত (বা unbound
        # fallback) — সেক্ষেত্রে binding সম্ভব না, আগের মতো শুধু IP-based trust।
        identity_mismatch = False
        if olt and ctx_name and ctx_name.startswith('olt-'):
            try:
                bound_olt_id = int(ctx_name[len('olt-'):])
            except ValueError:
                bound_olt_id = None
            if bound_olt_id is not None and bound_olt_id != olt.id:
                identity_mismatch = True

        sig_status, mac_status = trap_service.event_to_status(info['event'])

        handled = False
        if identity_mismatch:
            logger.warning(
                'SNMP trap community/source_ip mismatch — সম্ভাব্য spoofed trap, '
                'state mutate করা হলো না: src=%s ctx=%s resolved_olt=%s',
                src_ip, ctx_name, olt.name if olt else None,
            )
        elif olt and info['interface_id'] and sig_status:
            now = timezone.now()
            updated = ONUSignal.objects.filter(
                olt=olt, interface_id=info['interface_id']
            ).update(signal_status=sig_status, last_updated=now)
            if updated:
                handled = True
            # OLTMacCache status-ও আপডেট (interface_id = 'port/onu')
            try:
                parts = info['interface_id'].rsplit('/', 1)
                if len(parts) == 2:
                    OLTMacCache.objects.filter(
                        olt=olt, port=parts[0], onu=parts[1]
                    ).update(status=mac_status, updated_at=now)
            except Exception:
                pass

        try:
            SNMPTrapLog.objects.create(
                olt=olt, source_ip=src_ip or '0.0.0.0',
                trap_oid=info['trap_oid'], event=info['event'],
                interface_id=info['interface_id'],
                summary=info['summary'], varbinds=self._bound_varbinds(varbinds),
                handled=handled,
            )
        except Exception as e:
            logger.warning('SNMPTrapLog save failed: %s', e)

        logger.info('TRAP src=%s event=%s iface=%s handled=%s',
                    src_ip, info['event'], info['interface_id'], handled)
        self.stdout.write(
            f"[{timezone.now():%H:%M:%S}] {src_ip} → {info['event']} "
            f"{info['interface_id']} (handled={handled})")
        # thread-এর DB connection বন্ধ — leak এড়াতে
        try:
            from django.db import connection
            connection.close()
        except Exception:
            pass
