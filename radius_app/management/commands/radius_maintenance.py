"""
RADIUS Database Maintenance Command
প্রতিদিন cron এ চালানো উচিত:
  0 3 * * * cd /path/to/project && python manage.py radius_maintenance >> /var/log/radius_maintenance.log 2>&1
"""
from django.core.management.base import BaseCommand
from django.db import connection
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'RADIUS database maintenance: cleanup old logs, fix stale sessions'

    def handle(self, *args, **options):
        self.stdout.write(f'\n=== RADIUS Maintenance [{datetime.now()}] ===')
        
        with connection.cursor() as cur:
            # 1. radpostauth পুরনো entries মুছি (শুধু 7 দিনের রাখি)
            cur.execute("SELECT COUNT(*) FROM radpostauth WHERE authdate < NOW() - INTERVAL '7 days'")
            count = cur.fetchone()[0]
            if count > 0:
                cur.execute("DELETE FROM radpostauth WHERE authdate < NOW() - INTERVAL '7 days'")
                connection.commit()
                self.stdout.write(f'  ✅ radpostauth: {count} old entries deleted (>7 days)')

            # 2. Stale open sessions বন্ধ করি (72 ঘণ্টা বা acctupdatetime অনুযায়ী)
            cur.execute('''
                UPDATE radacct
                SET acctstoptime = COALESCE(acctupdatetime, acctstarttime),
                    acctterminatecause = 'Session-Timeout'
                WHERE acctstoptime IS NULL
                AND (
                    acctupdatetime < NOW() - INTERVAL '3 days'
                    OR (acctupdatetime IS NULL AND acctstarttime < NOW() - INTERVAL '3 days')
                )
            ''')
            stale = cur.rowcount
            if stale > 0:
                connection.commit()
                self.stdout.write(f'  ✅ radacct: {stale} stale sessions closed')
            else:
                connection.commit()

            # 3. radacct/radpostauth VACUUM (ANALYZE) — PostgreSQL-এ VACUUM
            # transaction block-এর ভেতরে চলে না, তাই সাময়িকভাবে autocommit চালু করা হয়।
            raw_conn = connection.connection
            prev_autocommit = raw_conn.autocommit
            raw_conn.autocommit = True
            try:
                cur.execute('VACUUM (ANALYZE) radacct')
                cur.execute('VACUUM (ANALYZE) radpostauth')
            finally:
                raw_conn.autocommit = prev_autocommit

            # 4. Statistics
            cur.execute('SELECT COUNT(*) FROM radpostauth')
            pa_count = cur.fetchone()[0]

            cur.execute('SELECT COUNT(*) FROM radacct WHERE acctstoptime IS NULL')
            open_sessions = cur.fetchone()[0]

            cur.execute('''
                SELECT reply, COUNT(*) FROM radpostauth
                WHERE authdate >= NOW() - INTERVAL '1 hour'
                GROUP BY reply
            ''')
            last_hour = {r[0]: r[1] for r in cur.fetchall()}

            self.stdout.write(f'  📊 radpostauth: {pa_count} rows')
            self.stdout.write(f'  📊 Open sessions: {open_sessions}')
            self.stdout.write(f'  📊 Last 1h auth: {last_hour}')

        self.stdout.write('  ✅ Maintenance complete\n')
