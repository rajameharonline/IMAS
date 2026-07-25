"""radacct (session accounting) — পুরনো MySQL থেকে migrate। inet কলামে খালি
string থাকলে NULL-এ রূপান্তর করা হয় (PostgreSQL inet type খালি string নেয় না)।
"""
import pymysql
import psycopg
from django.conf import settings

MYSQL_CFG = dict(
    host='127.0.0.1', port=3307, user='radius', password='010230',
    database='radius', charset='utf8mb4', cursorclass=pymysql.cursors.DictCursor,
)

INET_COLUMNS = {'nasipaddress', 'framedipaddress', 'framedipv6address',
                'framedipv6prefix', 'delegatedipv6prefix'}

COLUMNS = [
    'radacctid', 'acctsessionid', 'acctuniqueid', 'username', 'realm',
    'nasipaddress', 'nasportid', 'nasporttype', 'acctstarttime', 'acctupdatetime',
    'acctstoptime', 'acctinterval', 'acctsessiontime', 'acctauthentic',
    'connectinfo_start', 'connectinfo_stop', 'acctinputoctets', 'acctoutputoctets',
    'calledstationid', 'callingstationid', 'acctterminatecause', 'servicetype',
    'framedprotocol', 'framedipaddress', 'framedipv6address', 'framedipv6prefix',
    'framedinterfaceid', 'delegatedipv6prefix',
]

mysql_conn = pymysql.connect(**MYSQL_CFG)
cfg = settings.RADIUS_DB
pg_conn = psycopg.connect(
    host=cfg['host'], port=cfg['port'], user=cfg['user'],
    password=cfg['password'], dbname=cfg['name'],
)
pg_conn.autocommit = True

with mysql_conn.cursor() as cur:
    cur.execute("SELECT * FROM radacct")
    rows = cur.fetchall()

col_list = ', '.join(COLUMNS)
placeholders = ', '.join(['%s'] * len(COLUMNS))
inserted = 0
with pg_conn.cursor() as pcur:
    for row in rows:
        row_ci = {k.lower(): v for k, v in row.items()}
        values = []
        for c in COLUMNS:
            v = row_ci.get(c)
            if c in INET_COLUMNS and v == '':
                v = None
            values.append(v)
        try:
            pcur.execute(f"INSERT INTO radacct ({col_list}) VALUES ({placeholders})", values)
            inserted += 1
        except Exception as e:
            print(f'  row {row_ci.get("radacctid")} error: {e}')

print(f'radacct: {inserted}/{len(rows)} inserted')

with pg_conn.cursor() as pcur:
    pcur.execute("SELECT setval('radacct_radacctid_seq', COALESCE((SELECT MAX(radacctid) FROM radacct), 1))")

mysql_conn.close()
pg_conn.close()
