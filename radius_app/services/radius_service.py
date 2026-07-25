# FreeRADIUS PostgreSQL integration service।
# radcheck, radreply, radusergroup, radgroupreply, nas — সব table সরাসরি PostgreSQL-এ manage করা হয়।
#
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ব্যবহারের নিয়ম (একাধিক RADIUS server সাপোর্ট):
#   RadiusService.for_client(client)  → client-এর router→radius_server ধরে সঠিক DB
#   RadiusService.for_server(rs)      → নির্দিষ্ট RadiusServer instance-এর জন্য
#   RadiusService.get_default()       → default/প্রথম active server
#   RadiusService.all_online_users()  → সব active server-এর online user একসাথে
#   RadiusService.sync_package_to_all_servers(...) → সব server-এ package group sync
#
# পরবর্তী কাজ:
#   - CoA (Change of Authorization) support যোগ করা — session-এ live speed change
#   - Per-server radacct পড়ে bandwidth usage report তৈরি করা
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
import psycopg
from django.conf import settings
import logging

logger = logging.getLogger(__name__)

# ৩ জায়গায় হুবহু একই SQL পুনরাবৃত্তি হচ্ছিল — শুধু string বের করা হলো (কোনো
# method signature/behavior পরিবর্তন হয়নি, SonarCloud python:S1192)।
_UPSERT_RADUSERGROUP_SQL = (
    "INSERT INTO radusergroup (username, groupname, priority) "
    "VALUES (%s, %s, 1) "
    "ON CONFLICT (username) DO UPDATE SET groupname=EXCLUDED.groupname"
)


class RadiusService:
    """
    একটি RadiusServer instance-এর বিপরীতে কাজ করে।
    for_server(rs) / for_client(client) / get_default() দিয়ে তৈরি করুন।
    """

    def __init__(self, radius_server=None):
        self._server = radius_server  # RadiusServer model instance বা None

    # ──────────────────────────────────────────
    # Factory methods
    # ──────────────────────────────────────────

    @classmethod
    def for_server(cls, radius_server):
        """নির্দিষ্ট RadiusServer model instance-এর জন্য service তৈরি করে।"""
        return cls(radius_server)

    @classmethod
    def for_client(cls, client):
        """Client-এর router→radius_server chain ধরে সঠিক RADIUS DB নির্বাচন করে।"""
        try:
            if client.router_id and client.router and client.router.radius_server_id:
                return cls(client.router.radius_server)
        except Exception:
            pass
        return cls.get_default()

    @classmethod
    def get_default(cls):
        """Default বা প্রথম active RadiusServer ব্যবহার করে; না থাকলে settings.RADIUS_DB।"""
        try:
            from radius_app.models import RadiusServer
            server = (
                RadiusServer.objects.filter(is_default=True, is_active=True).first()
                or RadiusServer.objects.filter(is_active=True).first()
            )
            return cls(server)
        except Exception:
            return cls(None)

    @staticmethod
    def reload_freeradius() -> dict:
        """FreeRADIUS reload করে যাতে SQL nas table থেকে নতুন NAS/clients তালিকা
        load হয় — নতুন router add করার পর এটা না করলে router-এর auth packet
        FreeRADIUS নীরবে drop করে (radius timeout)।

        gunicorn `isp` user হিসেবে চলে, তাই sudo -n দরকার। নিচের sudoers drop-in
        একবার install করতে হয় (deploy/isp-freeradius.sudoers):
            isp ALL=(root) NOPASSWD: /usr/bin/systemctl reload-or-restart freeradius, \\
                                     /usr/bin/systemctl restart freeradius
        reload-or-restart: reload সম্ভব হলে auth interrupt ছাড়াই, না হলে restart।
        """
        import subprocess, logging
        log = logging.getLogger(__name__)
        candidates = [
            ['sudo', '-n', 'systemctl', 'reload-or-restart', 'freeradius'],
            ['systemctl', 'reload-or-restart', 'freeradius'],  # root হিসেবে চললে
        ]
        for cmd in candidates:
            try:
                r = subprocess.run(cmd, timeout=20, capture_output=True, text=True)
                if r.returncode == 0:
                    log.info("FreeRADIUS reloaded: %s", ' '.join(cmd))
                    return {'success': True, 'cmd': ' '.join(cmd)}
                log.warning("FreeRADIUS reload failed (%s): rc=%s %s",
                            ' '.join(cmd), r.returncode, (r.stderr or '').strip())
            except Exception as e:
                log.warning("FreeRADIUS reload error (%s): %s", ' '.join(cmd), e)
        return {'success': False,
                'error': 'FreeRADIUS reload ব্যর্থ — sudoers rule দরকার '
                         '(deploy/isp-freeradius.sudoers install করুন)।'}

    # ──────────────────────────────────────────
    # DB connection
    # ──────────────────────────────────────────

    def _conn(self):
        if self._server:
            return psycopg.connect(
                host=self._server.db_host,
                port=self._server.db_port,
                user=self._server.db_user,
                password=self._server.db_password,
                dbname=self._server.db_name,
            )
        cfg = settings.RADIUS_DB
        return psycopg.connect(
            host=cfg['host'], port=int(cfg.get('port', 5432)),
            user=cfg['user'], password=cfg['password'],
            dbname=cfg['name'],
        )

    def connection_identity(self) -> tuple:
        """দুইটা RadiusService instance সত্যিই একই RADIUS server-কে represent করছে কিনা
        তুলনা করতে ব্যবহার করুন (যেমন router-change-এ cross-server cleanup দরকার কিনা বের
        করা)। `RadiusServer` row থাকলে তার **primary key** দিয়ে identity ঠিক করা হয় —
        connection string (host/port/db_name) দিয়ে নয়, কারণ একই physical DB দুইটা ভিন্ন
        hostname দিয়ে (যেমন `127.0.0.1` বনাম `localhost`) দুইটা আলাদা RadiusServer row-এ
        রেজিস্টার করা থাকলে raw string তুলনা ভুলভাবে "আলাদা server" ধরে নিত; PK সবসময়
        সঠিক row identity দেয়। `self._server is None` মানে settings.RADIUS_DB ব্যবহৃত
        হচ্ছে (কোনো RadiusServer row ছাড়া fallback) — সেক্ষেত্রে PK নেই বলে connection
        string-ই একমাত্র উপায়, তাই সেই একটি case-এ string comparison-এ fallback করা হয়।
        Caller-কে RadiusService-এর private `_server` attribute-এ হাত না দিয়ে এই public
        method ব্যবহার করতে হবে।
        """
        if self._server:
            return ('server', self._server.id)
        cfg = settings.RADIUS_DB
        return ('default', cfg['host'], int(cfg.get('port', 5432)), cfg['name'])

    # ──────────────────────────────────────────
    # User management
    # ──────────────────────────────────────────

    def create_user(self, username: str, password: str, group: str = '') -> bool:
        # radcheck-এ password, radusergroup-এ group সেট করে নতুন PPPoE user তৈরি করে
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO radcheck (username, attribute, op, value) "
                    "VALUES (%s, 'Cleartext-Password', ':=', %s) "
                    "ON CONFLICT (username, attribute) DO UPDATE SET value=EXCLUDED.value",
                    (username, password)
                )
                if group:
                    cur.execute(
                        _UPSERT_RADUSERGROUP_SQL,
                        (username, group)
                    )
            conn.commit()
            conn.close()
            logger.info("Radius user created: %s", username)
            return True
        except Exception as e:
            logger.exception("Radius create_user error for %s: %s", username, e)
            return False

    def user_exists(self, username: str) -> bool:
        # radcheck-এ user আছে কিনা চেক করে
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM radcheck WHERE username=%s AND attribute='Cleartext-Password' LIMIT 1",
                    (username,)
                )
                exists = cur.fetchone() is not None
            conn.close()
            return exists
        except Exception as e:
            logger.exception("Radius user_exists error for %s: %s", username, e)
            return False

    def disable_user(self, username: str) -> bool:
        # Auth-Type := Reject যোগ করে user block করে
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO radcheck (username, attribute, op, value) "
                    "VALUES (%s, 'Auth-Type', ':=', 'Reject') "
                    "ON CONFLICT (username, attribute) DO UPDATE SET value='Reject'",
                    (username,)
                )
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            logger.exception("Radius disable_user error for %s: %s", username, e)
            return False

    def enable_user(self, username: str) -> bool:
        # Auth-Type := Reject মুছে user পুনরায় সক্রিয় করে
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM radcheck WHERE username=%s AND attribute='Auth-Type'",
                    (username,)
                )
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            logger.exception("Radius enable_user error for %s: %s", username, e)
            return False

    def delete_user(self, username: str) -> bool:
        # radcheck, radreply, radusergroup থেকে user সম্পূর্ণ মুছে দেয়।
        # radacct (session history) ইচ্ছাকৃতভাবে রাখা হয় — audit trail ও billing proof।
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                cur.execute("DELETE FROM radcheck WHERE username=%s", (username,))
                cur.execute("DELETE FROM radreply WHERE username=%s", (username,))
                cur.execute("DELETE FROM radusergroup WHERE username=%s", (username,))
                # Open session থাকলে সেটা close করা (delete নয়, acctstoptime সেট করা)
                cur.execute(
                    "UPDATE radacct SET acctstoptime=NOW(), acctterminatecause='Admin-Reset' "
                    "WHERE username=%s AND acctstoptime IS NULL",
                    (username,)
                )
            conn.commit()
            conn.close()
            logger.info("Radius user deleted (acct history kept): %s", username)
            return True
        except Exception as e:
            logger.exception("Radius delete_user error for %s: %s", username, e)
            return False

    def purge_radacct(self, username: str) -> bool:
        """radacct (session history) স্থায়ীভাবে মুছে দেয়। delete_user() ইচ্ছাকৃতভাবে এটা
        রাখে (audit/billing proof) — কিন্তু client permanently delete হওয়ার পর তার
        username অন্য কোনো (নতুন/renamed) client-কে দিলে rename_user() পুরনো এই history-র
        সাথে নতুন client-এর history মিশিয়ে দিত। LeftClientViewSet.perform_destroy()
        (client চিরতরে মোছার path) থেকে কল হয় — যেখানে audit trail রাখার প্রয়োজন শেষ,
        তাই future username-reuse-এ merge হওয়ার ঝুঁকি এড়াতে radacct-ও এখানে মুছে ফেলা হয়।
        """
        if not username:
            return True
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                cur.execute("DELETE FROM radacct WHERE username=%s", (username,))
            conn.commit()
            conn.close()
            logger.info("Radius radacct purged (permanent delete): %s", username)
            return True
        except Exception as e:
            logger.exception("Radius purge_radacct error for %s: %s", username, e)
            return False

    def rename_user(self, old_username: str, new_username: str) -> bool:
        """Client-এর PPPoE username edit করে বদলালে radcheck/radreply/radusergroup-এর
        পুরনো username-এর row গুলো নতুন username-এ migrate করে (পুরনো row মুছে দিয়ে) —
        নইলে পুরনো credential দিয়ে auth চালু থেকে যায়। radacct (session history) row-ও
        নতুন username-এ rename করা হয় — নইলে rename-এর আগের traffic/usage history
        billing monthly-aggregation-এ orphan হয়ে silently বাদ পড়ে যায় (পুরনো username
        আর কোনো Client-এর সাথে match করে না)।
        """
        if not old_username or not new_username or old_username == new_username:
            return True
        conn = None
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                # পুরনো username-এর কোনো row-ই যদি এই server-এ না থাকে (যেমন router ও
                # username একসাথে বদলালে — পুরনো server থেকে ইতিমধ্যে delete হয়ে গেছে,
                # নতুন server-এ কখনো sync হয়নি), migrate করার কিছু নেই — no-op হিসেবে
                # সঠিকভাবে log করি, ভুলভাবে "renamed" বলি না (caller-এর fallback fresh
                # create করবে)।
                cur.execute(
                    "SELECT "
                    "(SELECT COUNT(*) FROM radcheck WHERE username=%s) + "
                    "(SELECT COUNT(*) FROM radreply WHERE username=%s) + "
                    "(SELECT COUNT(*) FROM radusergroup WHERE username=%s) + "
                    "(SELECT COUNT(*) FROM radacct WHERE username=%s)",
                    (old_username, old_username, old_username, old_username)
                )
                (total_old_rows,) = cur.fetchone()
                if not total_old_rows:
                    conn.close()
                    logger.info(
                        "Radius rename_user no-op: %s-এর কোনো row এই server-এ নেই — "
                        "%s নামে fresh create caller-এর fallback করবে",
                        old_username, new_username
                    )
                    return True

                # নতুন username-এ আগে থেকে stale radcheck/radreply/radusergroup row থাকলে
                # (সম্ভবত আগের কোনো client-এর অসম্পূর্ণ delete_user) সেটা silently overwrite
                # না করে স্পষ্টভাবে log করি — অন্তত troubleshoot করা যায় (শুধু radcheck না,
                # তিনটা table-ই check করা হচ্ছে — নইলে radreply/radusergroup-এ conflict
                # থাকলেও warning miss হয়ে যেত)
                cur.execute(
                    "SELECT "
                    "(SELECT COUNT(*) FROM radcheck WHERE username=%s), "
                    "(SELECT COUNT(*) FROM radreply WHERE username=%s), "
                    "(SELECT COUNT(*) FROM radusergroup WHERE username=%s)",
                    (new_username, new_username, new_username)
                )
                (conflict_radcheck, conflict_radreply, conflict_radusergroup) = cur.fetchone()
                if conflict_radcheck or conflict_radreply or conflict_radusergroup:
                    logger.warning(
                        "Radius rename_user: নতুন username %s-এ আগে থেকে stale row ছিল "
                        "(radcheck=%d, radreply=%d, radusergroup=%d — সম্ভবত আগের কোনো "
                        "client-এর অসম্পূর্ণ delete_user) — rename-এ %s-এর data দিয়ে overwrite হচ্ছে",
                        new_username, conflict_radcheck, conflict_radreply, conflict_radusergroup, old_username
                    )

                # radacct আলাদা — এটা DELETE+INSERT নয়, UPDATE (session history)। নতুন
                # username-এ আগে থেকে radacct row থাকলে (যেমন কোনো permanently-deleted
                # client-এর পুরনো, চিরস্থায়ীভাবে রাখা history — delete_user() radacct
                # কখনো মোছে না) — সেটা এই rename-এর client-এর history-র সাথে মিশে যাবে,
                # যা billing/traffic aggregation-এ ভিন্ন দুই client-এর data মিশিয়ে দিতে
                # পারে। এটা code দিয়ে নিরাপদে auto-resolve করা যায় না (দুইটা vlaid client-এর
                # data — কোনটা রাখা ঠিক, সিদ্ধান্ত admin-এর), তাই শুধু সতর্ক করে দিই।
                cur.execute("SELECT COUNT(*) FROM radacct WHERE username=%s", (new_username,))
                (radacct_conflict,) = cur.fetchone()
                if radacct_conflict:
                    logger.warning(
                        "Radius rename_user: নতুন username %s-এ আগে থেকে %d-টা radacct "
                        "(session history) row ছিল — সম্ভবত কোনো permanently-deleted client-এর "
                        "পুরনো history, যেটা delete_user() ইচ্ছাকৃতভাবে রাখে (audit/billing proof)। "
                        "%s থেকে rename করা history এখন এর সাথে মিশে যাচ্ছে — billing/traffic "
                        "report manually verify করা উচিত",
                        new_username, radacct_conflict, old_username
                    )

                cur.execute(
                    "INSERT INTO radcheck (username, attribute, op, value) "
                    "SELECT %s, attribute, op, value FROM radcheck WHERE username=%s "
                    "ON CONFLICT (username, attribute) DO UPDATE SET op=EXCLUDED.op, value=EXCLUDED.value",
                    (new_username, old_username)
                )
                cur.execute("DELETE FROM radcheck WHERE username=%s", (old_username,))

                cur.execute(
                    "INSERT INTO radreply (username, attribute, op, value) "
                    "SELECT %s, attribute, op, value FROM radreply WHERE username=%s "
                    "ON CONFLICT (username, attribute) DO UPDATE SET op=EXCLUDED.op, value=EXCLUDED.value",
                    (new_username, old_username)
                )
                cur.execute("DELETE FROM radreply WHERE username=%s", (old_username,))

                cur.execute(
                    "INSERT INTO radusergroup (username, groupname, priority) "
                    "SELECT %s, groupname, priority FROM radusergroup WHERE username=%s "
                    "ON CONFLICT (username) DO UPDATE SET groupname=EXCLUDED.groupname",
                    (new_username, old_username)
                )
                cur.execute("DELETE FROM radusergroup WHERE username=%s", (old_username,))

                # radacct (session/traffic history) — billing aggregation বর্তমান
                # Client.username দিয়ে map করে, তাই এটাও rename না করলে পুরনো
                # username-এর ইতিহাস চিরতরে orphan হয়ে যাবে
                cur.execute(
                    "UPDATE radacct SET username=%s WHERE username=%s",
                    (new_username, old_username)
                )
            conn.commit()
            conn.close()
            logger.info("Radius user renamed: %s → %s", old_username, new_username)
            return True
        except Exception as e:
            if conn:
                try:
                    conn.rollback()
                    conn.close()
                except Exception:
                    pass
            logger.exception("Radius rename_user error (%s → %s): %s", old_username, new_username, e)
            return False

    def ensure_unique_keys(self) -> bool:
        """radcheck/radreply-এ (username, attribute), radusergroup-এ (username),
        radgroupreply-এ (groupname, attribute) এবং nas-এ (nasname) UNIQUE constraint
        নিশ্চিত করে — না থাকলে যোগ করে। এই constraint ছাড়া create_user()/disable_user()/
        rename_user()/set_user_group()/set_group_attribute()/add_nas()-এর সব
        ON CONFLICT ... DO UPDATE silently কাজ করে না (PostgreSQL-এর ON CONFLICT-এর জন্য
        target column(s)-এ প্রকৃত UNIQUE/EXCLUSION constraint বাধ্যতামূলক — FreeRADIUS-এর
        ডিফল্ট PostgreSQL schema.sql-এ এগুলো নেই, §18.5)। নতুন RadiusServer যোগ করার সময়
        (RadiusServerViewSet-এর perform_create/perform_update) স্বয়ংক্রিয়ভাবে কল হয়, যাতে
        এই fix প্রতিটি নতুন/পরিবর্তিত server-এ ম্যানুয়াল ALTER TABLE ছাড়াই প্রযোজ্য হয়।
        """
        server_label = self._server.name if self._server else 'default'
        # (table, key_name, columns) — radcheck/radreply/radgroupreply-এ attribute-সহ
        # composite key, radusergroup-এ শুধু username (এক user → এক group), nas-এ nasname।
        # PostgreSQL-এ constraint/index নাম পুরো schema-জুড়ে unique হতে হয় (MySQL-এর
        # মতো per-table নয়) — তাই প্রতিটি নামে table prefix যোগ করা হলো।
        specs = (
            ('radcheck', 'uq_radcheck_username_attribute', 'username, attribute'),
            ('radreply', 'uq_radreply_username_attribute', 'username, attribute'),
            ('radusergroup', 'uq_radusergroup_username', 'username'),
            ('radgroupreply', 'uq_radgroupreply_groupname_attribute', 'groupname, attribute'),
            ('nas', 'uq_nas_nasname', 'nasname'),
        )
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                for table, key_name, columns in specs:
                    cur.execute(
                        "SELECT COUNT(*) FROM information_schema.table_constraints "
                        "WHERE table_schema='public' AND table_name=%s "
                        "AND constraint_name=%s AND constraint_type='UNIQUE'",
                        (table, key_name)
                    )
                    (exists,) = cur.fetchone()
                    if not exists:
                        # table/key_name/columns hardcoded tuple থেকে আসে (user input নয়), তাই safe
                        cur.execute(
                            f"ALTER TABLE {table} ADD CONSTRAINT {key_name} UNIQUE ({columns})"
                        )
                        logger.info("Radius unique key added on %s (server=%s)", table, server_label)
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            logger.exception("Radius ensure_unique_keys error (server=%s): %s", server_label, e)
            return False

    def change_password(self, username: str, new_password: str) -> bool:
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE radcheck SET value=%s "
                    "WHERE username=%s AND attribute='Cleartext-Password'",
                    (new_password, username)
                )
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            logger.exception("Radius change_password error for %s: %s", username, e)
            return False

    def change_package(self, username: str, new_group: str) -> bool:
        # radusergroup আপডেট করে প্যাকেজ পরিবর্তন করে
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                cur.execute(
                    _UPSERT_RADUSERGROUP_SQL,
                    (username, new_group)
                )
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            logger.exception("Radius change_package error for %s: %s", username, e)
            return False

    def set_ip_pool(self, username: str, pool_name: str) -> bool:
        # radreply-তে Framed-Pool সেট করে
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                if pool_name:
                    cur.execute(
                        "INSERT INTO radreply (username, attribute, op, value) "
                        "VALUES (%s, 'Framed-Pool', '=', %s) "
                        "ON CONFLICT (username, attribute) DO UPDATE SET value=EXCLUDED.value",
                        (username, pool_name)
                    )
                else:
                    cur.execute(
                        "DELETE FROM radreply WHERE username=%s AND attribute='Framed-Pool'",
                        (username,)
                    )
            conn.commit()
            conn.close()
            logger.info("Radius Framed-Pool set: %s → %s", username, pool_name)
            return True
        except Exception as e:
            logger.exception("Radius set_ip_pool error for %s: %s", username, e)
            return False

    def set_static_ip(self, username: str, ip_address: str) -> bool:
        # radreply-তে Framed-IP-Address সেট করে static IP assign করে
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                if ip_address:
                    cur.execute(
                        "INSERT INTO radreply (username, attribute, op, value) "
                        "VALUES (%s, 'Framed-IP-Address', '=', %s) "
                        "ON CONFLICT (username, attribute) DO UPDATE SET value=EXCLUDED.value",
                        (username, ip_address)
                    )
                else:
                    cur.execute(
                        "DELETE FROM radreply WHERE username=%s AND attribute='Framed-IP-Address'",
                        (username,)
                    )
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            logger.exception("Radius set_static_ip error for %s: %s", username, e)
            return False

    def set_user_group(self, username: str, group_name: str) -> bool:
        """radusergroup-এ user-কে একটি group-এ assign করে।"""
        if not username or not group_name:
            return False
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                cur.execute(
                    _UPSERT_RADUSERGROUP_SQL,
                    (username, group_name)
                )
            conn.commit()
            conn.close()
            logger.info("User group assigned: %s → %s", username, group_name)
            return True
        except Exception as e:
            logger.exception("set_user_group error for %s: %s", username, e)
            return False

    # ──────────────────────────────────────────
    # Package/Group management (radgroupreply)
    # ──────────────────────────────────────────

    def set_group_framed_pool(self, group_name: str, pool_name: str) -> bool:
        # radgroupreply-তে Framed-Pool সেট করে
        if not group_name or not pool_name:
            return False
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO radgroupreply (groupname, attribute, op, value) "
                    "VALUES (%s, 'Framed-Pool', '=', %s) "
                    "ON CONFLICT (groupname, attribute) DO UPDATE SET op='=', value=EXCLUDED.value",
                    (group_name, pool_name)
                )
            conn.commit()
            conn.close()
            logger.info("Group Framed-Pool set: %s → %s", group_name, pool_name)
            return True
        except Exception as e:
            logger.exception("set_group_framed_pool error for %s: %s", group_name, e)
            return False

    def set_group_attribute(self, group_name: str, attribute: str, op: str, value: str) -> bool:
        # radgroupreply-তে group-level যেকোনো attribute upsert করে
        if not group_name or not attribute:
            return False
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO radgroupreply (groupname, attribute, op, value) "
                    "VALUES (%s, %s, %s, %s) "
                    "ON CONFLICT (groupname, attribute) DO UPDATE SET op=EXCLUDED.op, value=EXCLUDED.value",
                    (group_name, attribute, op, value)
                )
            conn.commit()
            conn.close()
            logger.info("Group attribute set: %s → %s %s %s", group_name, attribute, op, value)
            return True
        except Exception as e:
            logger.exception("set_group_attribute error for %s: %s", group_name, e)
            return False

    def setup_package_group(self, group_name: str, download_mbps: int, upload_mbps: int) -> bool:
        # radgroupreply-তে Mikrotik-Rate-Limit সেট করে
        rate_limit = f"{download_mbps}M/{upload_mbps}M"
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO radgroupreply (groupname, attribute, op, value) "
                    "VALUES (%s, 'Mikrotik-Rate-Limit', ':=', %s) "
                    "ON CONFLICT (groupname, attribute) DO UPDATE SET value=EXCLUDED.value",
                    (group_name, rate_limit)
                )
                cur.execute(
                    "INSERT INTO radgroupreply (groupname, attribute, op, value) "
                    "VALUES (%s, 'Session-Timeout', ':=', '2592000') "
                    "ON CONFLICT (groupname, attribute) DO UPDATE SET value='2592000'",
                    (group_name,)
                )
            conn.commit()
            conn.close()
            logger.info("Package group setup: %s = %s", group_name, rate_limit)
            return True
        except Exception as e:
            logger.exception("Radius setup_package_group error for %s: %s", group_name, e)
            return False

    def delete_package_group(self, group_name: str) -> bool:
        # radgroupreply থেকে group সম্পূর্ণ মুছে দেয়
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                cur.execute("DELETE FROM radgroupreply WHERE groupname=%s", (group_name,))
                cur.execute("DELETE FROM radgroupcheck WHERE groupname=%s", (group_name,))
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            logger.exception("Radius delete_package_group error for %s: %s", group_name, e)
            return False

    # ──────────────────────────────────────────
    # NAS management (nas table)
    # ──────────────────────────────────────────

    def add_nas(self, nas_ip: str, shared_secret: str, shortname: str = '', description: str = '') -> bool:
        # nas table-এ Mikrotik router-এর এন্ট্রি যোগ করে।
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO nas (nasname, shortname, type, secret, description) "
                    "VALUES (%s, %s, 'other', %s, %s) "
                    "ON CONFLICT (nasname) DO UPDATE SET "
                    "secret=EXCLUDED.secret, shortname=EXCLUDED.shortname, description=EXCLUDED.description",
                    (nas_ip, shortname or nas_ip, shared_secret, description)
                )
            conn.commit()
            conn.close()
            logger.info("NAS added: %s", nas_ip)
            return True
        except Exception as e:
            logger.exception("Radius add_nas error for %s: %s", nas_ip, e)
            return False

    def remove_nas(self, nas_ip: str) -> bool:
        # nas table থেকে NAS entry মুছে দেয়
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                cur.execute("DELETE FROM nas WHERE nasname=%s", (nas_ip,))
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            logger.exception("Radius remove_nas error for %s: %s", nas_ip, e)
            return False

    def get_nas_list(self) -> list:
        # nas table-এর সব NAS entry তালিকা
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                cur.execute("SELECT nasname, shortname, type, secret, description FROM nas")
                rows = cur.fetchall()
            conn.close()
            return [{'ip': r[0], 'name': r[1], 'type': r[2], 'description': r[4]} for r in rows]
        except Exception as e:
            logger.exception("Radius get_nas_list error: %s", e)
            return []

    # ──────────────────────────────────────────
    # Session / Online users
    # ──────────────────────────────────────────

    # Stale session threshold — এই সময়ের বেশি interim-update না আসলে session ghost।
    # Mikrotik default interim interval = 5 min। 3× buffer = 15 min।
    # Production-এ যদি interim বেশি হয় (30/60 min), এই value বাড়ানো যাবে।
    STALE_THRESHOLD_MINUTES = 90  # 90 min কোনো update না এলে stale ধরো

    def get_online_users(self) -> list:
        # radacct থেকে বর্তমানে online থাকা user তালিকা।
        # acctupdatetime অন্তর্ভুক্ত করা হয়েছে stale detection-এর জন্য।
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT username, nasipaddress, framedipaddress, acctsessionid, "
                    "acctstarttime, acctinputoctets, acctoutputoctets, "
                    "callingstationid, acctupdatetime, "
                    "EXTRACT(EPOCH FROM (NOW() - COALESCE(acctupdatetime, acctstarttime)))/60 AS idle_minutes "
                    "FROM radacct WHERE acctstoptime IS NULL ORDER BY acctstarttime DESC"
                )
                rows = cur.fetchall()
            conn.close()
            return [
                {
                    'username':       r[0],
                    'nas_ip':         r[1],
                    'ip':             r[2],
                    'session_id':     r[3],
                    'start_time':     str(r[4]) if r[4] else None,
                    'bytes_in':       r[5] if r[5] is not None else 0,
                    'bytes_out':      r[6] if r[6] is not None else 0,
                    'caller_id':      r[7] or '',
                    'nas_identifier': r[1] or '',
                    'last_update':    str(r[8]) if r[8] else None,
                    'idle_minutes':   int(r[9]) if r[9] is not None else 0,
                    # stale=True মানে এই session-টি Mikrotik থেকে confirm না হলে ghost
                    'stale':          (int(r[9]) if r[9] is not None else 0) > self.STALE_THRESHOLD_MINUTES,
                }
                for r in rows
            ]
        except Exception as e:
            logger.exception("Radius get_online_users error: %s", e)
            return []

    def get_user_live_ip(self, username: str) -> str:
        """একজন user-এর বর্তমান WAN IP (radacct framedipaddress) ফেরত দেয়।

        PPPoE IP dynamic (pool থেকে), client record-এ stored নয় — তাই live session
        থেকে নিতে হয়। চলমান session (acctstoptime IS NULL) আগে; না থাকলে সর্বশেষ
        session-এর IP (সবচেয়ে recent)। না পেলে খালি string।
        """
        if not username:
            return ''
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT framedipaddress FROM radacct "
                    "WHERE username=%s AND framedipaddress IS NOT NULL AND framedipaddress <> '' "
                    "ORDER BY (acctstoptime IS NULL) DESC, acctstarttime DESC LIMIT 1",
                    (username,)
                )
                row = cur.fetchone()
            conn.close()
            return (row[0] or '') if row else ''
        except Exception as e:
            logger.exception("Radius get_user_live_ip error for %s: %s", username, e)
            return ''

    def get_last_session(self, username: str):
        """একজন user-এর সর্বশেষ radacct session ফেরত দেয় — last-online/offline-duration নির্ণয়ে।

        Returns: dict {start, stop, update, online} অথবা None (কোনো session না থাকলে)।
          • online=True হলে চলমান session (acctstoptime IS NULL) — এখন online।
          • last_seen = stop বা update বা start (যেটা পাওয়া যায়)।
        """
        if not username:
            return None
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT acctstarttime, acctstoptime, acctupdatetime FROM radacct "
                    "WHERE username=%s ORDER BY acctstarttime DESC LIMIT 1",
                    (username,)
                )
                row = cur.fetchone()
            conn.close()
            if not row:
                return None
            start, stop, update = row[0], row[1], row[2]
            return {'start': start, 'stop': stop, 'update': update, 'online': stop is None}
        except Exception as e:
            logger.exception("Radius get_last_session error for %s: %s", username, e)
            return None

    def close_stale_sessions(self) -> int:
        """Stale open sessions গুলো close করে (acctstoptime সেট করে)।
        Returns: কতটা session close হয়েছে।
        """
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE radacct SET acctstoptime=NOW(), acctterminatecause='Lost-Carrier' "
                    "WHERE acctstoptime IS NULL "
                    "AND EXTRACT(EPOCH FROM (NOW() - COALESCE(acctupdatetime, acctstarttime)))/60 > %s",
                    [self.STALE_THRESHOLD_MINUTES]
                )
                count = cur.rowcount
                conn.commit()
            conn.close()
            logger.info("Closed %d stale RADIUS sessions", count)
            return count
        except Exception as e:
            logger.exception("close_stale_sessions error: %s", e)
            return 0

    def disconnect_user(self, username: str, nas_ip: str = None) -> bool:
        # Mikrotik API দিয়ে active PPPoE session disconnect করে।
        try:
            from mikrotik_app.models import MikrotikServer
            from mikrotik_app.services.mikrotik_service import MikrotikService

            servers = MikrotikServer.objects.filter(is_active=True)
            if nas_ip:
                servers = servers.filter(host=nas_ip)

            disconnected = False
            for server in servers:
                try:
                    svc = MikrotikService.from_server_model(server)
                    active = svc.get_active_connections()
                    for conn in active:
                        if conn.get('name') == username or conn.get('user') == username:
                            svc.disable_pppoe_user(username)
                            disconnected = True
                            break
                except Exception:
                    pass

            logger.info("Disconnect attempt for %s: %s", username, disconnected)
            return disconnected
        except Exception as e:
            logger.exception("Radius disconnect_user error for %s: %s", username, e)
            return False

    # ──────────────────────────────────────────
    # Blocked_Group lifecycle (suspended / expired)
    # ──────────────────────────────────────────
    #
    # ───── কেন আলাদা Blocked_Group দরকার ─────────────────────────
    # সাধারণ disable_user() Auth-Type:=Reject বসায় → user কানেক্টই
    # হতে পারে না (no auth at all)। কিন্তু "suspended/expired"
    # client-কে আমরা কানেক্ট হতে দিতে চাই — শুধু একটি restricted
    # profile-এ ফেলে দিই (walled garden / captive portal)।
    #
    # সেজন্য:
    #   • radusergroup-এ user-এর groupname → 'Blocked_Group'
    #   • radgroupreply-তে Blocked_Group-এর জন্য Mikrotik-Group =
    #     "blocked" (router-এ "blocked" নামক restrictive PPPoE profile
    #     লাগবে — খুব কম speed + captive portal বা notice page)
    #
    # পুনরায় active হলে → user-এর আসল প্যাকেজ group ফেরত দেওয়া হয়।
    # ──────────────────────────────────────────────────────────────

    BLOCKED_GROUP_NAME = 'Blocked_Group'

    def ensure_blocked_group(self, mikrotik_profile: str = 'Expired PPPoE',
                              session_timeout: int = 300) -> bool:
        """Blocked_Group-এর জন্য radgroupreply attributes নিশ্চিত করে।

        • Mikrotik-Group := Expired PPPoE  (router-এ 'Expired PPPoE' PPPoE profile-এ ফেলবে)
        • Session-Timeout := 300           (5 মিনিট পরপর re-auth, যাতে status
          revert হলে দ্রুত effect পায়)

        Why: একবার সেট করলেই হলো — পরবর্তীতে যেকোনো user-কে এই group-এ
        পাঠালে router অটো restrictive profile ব্যবহার করবে।
        """
        try:
            # দুটি attribute-ই upsert — duplicate এড়াতে UNIQUE constraint
            # আগেই radgroupreply-তে যোগ করা আছে (uq_group_attr)।
            self.set_group_attribute(
                self.BLOCKED_GROUP_NAME, 'Mikrotik-Group', ':=', mikrotik_profile
            )
            self.set_group_attribute(
                self.BLOCKED_GROUP_NAME, 'Session-Timeout', ':=', str(session_timeout)
            )
            # walled garden: router expired client-এর IP 'expired' address-list-এ
            # যোগ করবে → firewall ঐ list দেখে redirect/drop করে (pool-নির্ভর নয়)।
            self.set_group_attribute(
                self.BLOCKED_GROUP_NAME, 'Mikrotik-Address-List', ':=', 'expired'
            )
            logger.info("Blocked_Group attributes ensured (profile=%s)", mikrotik_profile)
            return True
        except Exception as e:
            logger.exception("ensure_blocked_group error: %s", e)
            return False

    def move_to_blocked_group(self, username: str) -> bool:
        """User-কে Blocked_Group-এ পাঠায় (suspended/expired status-এর জন্য)।

        Why: Auth-Type:Reject না বসিয়ে শুধু group পরিবর্তন করা হয় —
        user কানেক্ট হতে পারবে কিন্তু restrictive profile-এ থাকবে।
        পরবর্তী reconnect বা CoA-disconnect-এর পর effect আসবে।
        """
        # আগে নিশ্চিত করি Blocked_Group আছে — না থাকলে তৈরি হবে
        self.ensure_blocked_group()
        return self.set_user_group(username, self.BLOCKED_GROUP_NAME)

    def restore_user_group(self, username: str, original_group: str) -> bool:
        """suspended/expired থেকে active হলে আসল প্যাকেজ group ফেরত দেয়।

        Why: Blocked_Group থেকে বের করে original package group-এ ফেরালে
        next session-এ আসল IP pool ও speed profile কাজ করবে।
        """
        if not original_group:
            logger.warning("restore_user_group skipped: no original group for %s", username)
            return False
        return self.set_user_group(username, original_group)

    # ──────────────────────────────────────────
    # radacct cleanup (stale / orphaned sessions)
    # ──────────────────────────────────────────
    #
    # কেন cleanup দরকার:
    #   Mikrotik link drop হলে Accounting-Stop packet হারিয়ে যেতে পারে →
    #   radacct-এ session "open" থেকে যায় (acctstoptime IS NULL)।
    #   এর ফলে online user query ভুল ডেটা দেয়। নিয়মিত cleanup করলে
    #   dashboard-এর live count নির্ভুল থাকে।
    # ──────────────────────────────────────────────────────────────

    def cleanup_stale_sessions(self, username: str = None,
                                older_than_hours: int = 24) -> int:
        """পুরোনো open sessions বন্ধ ঘোষণা করে (acctstoptime সেট করে)।

        Returns: কতগুলো session close করা হলো (count)।

        Why DELETE নয়: audit/billing-এর জন্য historic ডেটা রাখা দরকার,
        শুধু stop time + terminate cause পূরণ করি।
        """
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                if username:
                    cur.execute(
                        "UPDATE radacct SET acctstoptime=NOW(), "
                        "acctterminatecause='Admin-Reset' "
                        "WHERE username=%s AND acctstoptime IS NULL",
                        (username,)
                    )
                else:
                    # যেসব session-এ acctupdatetime > older_than_hours আগে → stale
                    cur.execute(
                        "UPDATE radacct SET acctstoptime=NOW(), "
                        "acctterminatecause='NAS-Reboot' "
                        "WHERE acctstoptime IS NULL "
                        "AND (acctupdatetime IS NULL "
                        "     OR acctupdatetime < NOW() - (INTERVAL '1 hour' * %s))",
                        (older_than_hours,)
                    )
                count = cur.rowcount
            conn.commit()
            conn.close()
            logger.info("radacct cleanup: closed %d stale sessions (user=%s, hours=%s)",
                        count, username or 'ALL', older_than_hours)
            return count
        except Exception as e:
            logger.exception("cleanup_stale_sessions error: %s", e)
            return 0

    def get_traffic_history(self, username: str, months: int = 6) -> list:
        """নির্দিষ্ট user-এর মাসিক traffic সারাংশ (radacct থেকে)।
        Returns: list of {month, bytes_in, bytes_out, sessions, total_seconds}
        """
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT "
                    "  to_char(acctstarttime, 'YYYY-MM') AS month, "
                    "  SUM(acctinputoctets)  AS total_in, "
                    "  SUM(acctoutputoctets) AS total_out, "
                    "  COUNT(*)              AS session_count, "
                    "  SUM(acctsessiontime)  AS total_seconds "
                    "FROM radacct "
                    "WHERE username = %s "
                    "GROUP BY to_char(acctstarttime, 'YYYY-MM') "
                    "ORDER BY month DESC "
                    "LIMIT %s",
                    (username, months)
                )
                rows = cur.fetchall()
            conn.close()
            return [
                {
                    'month':         r[0],
                    'bytes_in':      int(r[1] or 0),
                    'bytes_out':     int(r[2] or 0),
                    'sessions':      int(r[3] or 0),
                    'total_seconds': int(r[4] or 0),
                }
                for r in rows
            ]
        except Exception as e:
            logger.exception("Radius get_traffic_history error: %s", e)
            return []

    def get_monthly_aggregates(self, days: int = 35) -> list:
        """radacct থেকে শেষ `days` দিনের সব user-এর মাসিক aggregate return করে।
        Returns: list of {username, month, bytes_in, bytes_out, sessions, total_seconds}
        শুধু closed session (acctstoptime IS NOT NULL) aggregate করে —
        চলমান session current_month live query-তে আলাদাভাবে যোগ হবে।
        """
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT username, "
                    "  to_char(acctstarttime, 'YYYY-MM') AS month, "
                    "  SUM(acctinputoctets)  AS bytes_in, "
                    "  SUM(acctoutputoctets) AS bytes_out, "
                    "  COUNT(*)              AS sessions, "
                    "  SUM(acctsessiontime)  AS total_seconds "
                    "FROM radacct "
                    "WHERE acctstoptime IS NOT NULL "
                    "  AND acctstarttime >= NOW() - (INTERVAL '1 day' * %s) "
                    "GROUP BY username, to_char(acctstarttime, 'YYYY-MM')",
                    (days,)
                )
                rows = cur.fetchall()
            conn.close()
            return [
                {
                    'username':      r[0],
                    'month':         r[1],
                    'bytes_in':      int(r[2] or 0),
                    'bytes_out':     int(r[3] or 0),
                    'sessions':      int(r[4] or 0),
                    'total_seconds': int(r[5] or 0),
                }
                for r in rows
            ]
        except Exception as e:
            logger.exception("Radius get_monthly_aggregates error: %s", e)
            return []

    def get_user_monthly_aggregates(self, username: str) -> list:
        """একটি নির্দিষ্ট user-এর সব closed session মাসিক aggregate করে।
        Re-activation-এ radacct clear করার আগে data save করতে ব্যবহার হয়।
        Returns: list of {month, bytes_in, bytes_out, sessions, total_seconds}
        """
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT to_char(acctstarttime, 'YYYY-MM') AS month, "
                    "  SUM(acctinputoctets)  AS bytes_in, "
                    "  SUM(acctoutputoctets) AS bytes_out, "
                    "  COUNT(*)              AS sessions, "
                    "  SUM(acctsessiontime)  AS total_seconds "
                    "FROM radacct "
                    "WHERE username = %s AND acctstoptime IS NOT NULL "
                    "GROUP BY to_char(acctstarttime, 'YYYY-MM')",
                    (username,)
                )
                rows = cur.fetchall()
            conn.close()
            return [
                {
                    'month':         r[0],
                    'bytes_in':      int(r[1] or 0),
                    'bytes_out':     int(r[2] or 0),
                    'sessions':      int(r[3] or 0),
                    'total_seconds': int(r[4] or 0),
                }
                for r in rows
            ]
        except Exception as e:
            logger.exception("Radius get_user_monthly_aggregates error for %s: %s", username, e)
            return []

    def clear_client_traffic(self, username: str) -> int:
        """Client-এর সব radacct history মুছে দেয় — re-activation-এ fresh start।
        Returns: deleted row count
        """
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                cur.execute("DELETE FROM radacct WHERE username = %s", (username,))
                deleted = cur.rowcount
            conn.commit()
            conn.close()
            logger.info("Radacct cleared for %s (%d rows)", username, deleted)
            return deleted
        except Exception as e:
            logger.exception("Radacct clear error for %s: %s", username, e)
            return 0

    def purge_old_sessions(self, days: int = 30, exclude_usernames: list = None) -> int:
        """বন্ধ session যেগুলো `days` দিনের বেশি পুরনো সেগুলো মুছে দেয়।
        Open session (acctstoptime IS NULL) কখনো মুছবে না।
        exclude_usernames: এই usernames-এর data কখনো মুছবে না (suspended/expired client)।
        Returns: deleted row count
        """
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                if exclude_usernames:
                    # suspended/expired client-এর data রেখে দেওয়া হয় যতক্ষণ না re-activate হয়
                    placeholders = ','.join(['%s'] * len(exclude_usernames))
                    cur.execute(
                        f"DELETE FROM radacct "
                        f"WHERE acctstoptime IS NOT NULL "
                        f"AND acctstoptime < NOW() - (INTERVAL '1 day' * %s) "
                        f"AND username NOT IN ({placeholders})",
                        [days] + list(exclude_usernames)
                    )
                else:
                    cur.execute(
                        "DELETE FROM radacct "
                        "WHERE acctstoptime IS NOT NULL "
                        "AND acctstoptime < NOW() - (INTERVAL '1 day' * %s)",
                        (days,)
                    )
                deleted = cur.rowcount
            conn.commit()
            conn.close()
            logger.info("Radacct purge: %d rows deleted (older than %d days, excluded %d users)",
                        deleted, days, len(exclude_usernames or []))
            return deleted
        except Exception as e:
            logger.exception("Radacct purge error: %s", e)
            return 0

    # ──────────────────────────────────────────
    # Multi-server helpers (class-level)
    # ──────────────────────────────────────────

    @classmethod
    def all_online_users(cls) -> list:
        """সব active RADIUS server-এর online user একসাথে।"""
        try:
            from radius_app.models import RadiusServer
            servers = list(RadiusServer.objects.filter(is_active=True))
        except Exception:
            servers = []

        if not servers:
            return cls(None).get_online_users()

        seen = set()
        users = []
        for rs in servers:
            for u in cls(rs).get_online_users():
                key = (u['username'], u['session_id'])
                if key not in seen:
                    seen.add(key)
                    users.append(u)
        return users

    @classmethod
    def get_all_last_stop_times(cls) -> dict:
        """সব active RADIUS server থেকে প্রতিটি user-এর শেষ logout সময় ও কারণ।
        Returns: {username: {'stop_time': str, 'terminate_cause': str}}
        """
        try:
            from radius_app.models import RadiusServer
            servers = list(RadiusServer.objects.filter(is_active=True))
        except Exception:
            servers = []

        targets = [cls(rs) for rs in servers] if servers else [cls(None)]
        result = {}
        for svc in targets:
            try:
                for username, info in svc._get_last_stop_times().items():
                    stop_time = info.get('stop_time', '')
                    if username not in result or stop_time > result[username].get('stop_time', ''):
                        result[username] = info
            except Exception:
                pass
        return result

    def _get_last_stop_times(self) -> dict:
        """radacct থেকে সর্বশেষ stop_time ও terminate_cause fetch করে।"""
        try:
            conn = self._conn()
            with conn.cursor() as cur:
                # প্রতিটি user-এর সর্বশেষ session এর stop_time ও terminate_cause
                cur.execute("""
                    SELECT r1.username,
                           r1.acctstoptime,
                           r1.acctterminatecause
                    FROM radacct r1
                    INNER JOIN (
                        SELECT username, MAX(acctstoptime) AS max_stop
                        FROM radacct
                        WHERE acctstoptime IS NOT NULL
                        GROUP BY username
                    ) r2 ON r1.username = r2.username
                           AND r1.acctstoptime = r2.max_stop
                """)
                rows = cur.fetchall()
            conn.close()
            return {
                r[0]: {
                    'stop_time':       str(r[1]) if r[1] else '',
                    'terminate_cause': str(r[2]) if r[2] else '',
                }
                for r in rows if r[1] is not None
            }
        except Exception as e:
            logger.exception("_get_last_stop_times error: %s", e)
            return {}

    @classmethod
    def sync_package_to_all_servers(cls, group_name: str, attribute: str, op: str, value: str,
                                    pool_name: str = '') -> None:
        """Package save হলে সব active RADIUS server-এ group attribute sync করে।"""
        try:
            from radius_app.models import RadiusServer
            servers = list(RadiusServer.objects.filter(is_active=True))
        except Exception:
            servers = []

        targets = [cls(rs) for rs in servers] if servers else [cls(None)]
        for svc in targets:
            try:
                svc.set_group_attribute(group_name, attribute, op, value)
                if pool_name:
                    svc.set_group_framed_pool(group_name, pool_name)
            except Exception as e:
                logger.exception("sync_package_to_all_servers error: %s", e)
