"""FreeRADIUS নেটিভ টেবিল (Django model নয়) — পুরনো MySQL থেকে সরাসরি raw copy।"""
import pymysql
import psycopg
from django.conf import settings

MYSQL_CFG = dict(
    host='127.0.0.1', port=3307, user='radius', password='010230',
    database='radius', charset='utf8mb4', cursorclass=pymysql.cursors.DictCursor,
)

TABLES = {
    'radcheck': ['username', 'attribute', 'op', 'value'],
    'radreply': ['username', 'attribute', 'op', 'value'],
    'radusergroup': ['username', 'groupname', 'priority'],
    'radgroupcheck': ['groupname', 'attribute', 'op', 'value'],
    'radgroupreply': ['groupname', 'attribute', 'op', 'value'],
    'nas': ['nasname', 'shortname', 'type', 'ports', 'secret', 'server', 'community', 'description'],
}

mysql_conn = pymysql.connect(**MYSQL_CFG)
cfg = settings.RADIUS_DB
pg_conn = psycopg.connect(
    host=cfg['host'], port=cfg['port'], user=cfg['user'],
    password=cfg['password'], dbname=cfg['name'],
)
# autocommit: একটি row fail করলে আগের uncommitted row-ও rollback হয়ে যাওয়ার bug এড়াতে
# (প্রতিটি INSERT নিজে থেকেই commit হবে, একটির ব্যর্থতা অন্যকে প্রভাবিত করবে না)
pg_conn.autocommit = True

for table, cols in TABLES.items():
    with mysql_conn.cursor() as cur:
        try:
            cur.execute(f"SELECT * FROM `{table}`")
            rows = cur.fetchall()
        except pymysql.err.ProgrammingError as e:
            print(f'{table}: skip ({e})')
            continue
    if not rows:
        print(f'{table}: 0 rows (empty)')
        continue

    col_list = ', '.join(cols)
    placeholders = ', '.join(['%s'] * len(cols))
    inserted = 0
    with pg_conn.cursor() as pcur:
        for row in rows:
            # MySQL column names case may differ (GroupName vs groupname) — case-insensitive lookup
            row_ci = {k.lower(): v for k, v in row.items()}
            values = [row_ci.get(c) for c in cols]
            try:
                pcur.execute(
                    f"INSERT INTO {table} ({col_list}) VALUES ({placeholders})",
                    values,
                )
                inserted += 1
            except Exception as e:
                print(f'  {table} row error: {e}')
                continue
    print(f'{table}: {inserted}/{len(rows)} inserted')

mysql_conn.close()
pg_conn.close()
