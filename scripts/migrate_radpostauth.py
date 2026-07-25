"""radpostauth (৫,৪৪,৮৯৮ রো auth history) — স্ট্রিমিং cursor + psycopg COPY দিয়ে দ্রুত bulk migrate।"""
import pymysql
import psycopg
from django.conf import settings

MYSQL_CFG = dict(
    host='127.0.0.1', port=3307, user='radius', password='010230',
    database='radius', charset='utf8mb4', cursorclass=pymysql.cursors.SSCursor,
)

cfg = settings.RADIUS_DB
pg_conn = psycopg.connect(
    host=cfg['host'], port=cfg['port'], user=cfg['user'],
    password=cfg['password'], dbname=cfg['name'],
)

mysql_conn = pymysql.connect(**MYSQL_CFG)
snap_cur = mysql_conn.cursor(pymysql.cursors.Cursor)
snap_cur.execute("SELECT MAX(id) FROM radpostauth")
snapshot_max_id = snap_cur.fetchone()[0]
snap_cur.close()
print(f'snapshot bound: id <= {snapshot_max_id} (table still growing live, ignoring rows beyond this)')

cur = mysql_conn.cursor()
cur.execute(f"SELECT id, username, pass, reply, authdate, class FROM radpostauth WHERE id <= {snapshot_max_id} ORDER BY id")

total = 0
BATCH = 20000
with pg_conn.cursor() as pcur:
    with pcur.copy(
        "COPY radpostauth (id, username, pass, reply, authdate, class) FROM STDIN"
    ) as copy:
        batch_rows = cur.fetchmany(BATCH)
        while batch_rows:
            for row in batch_rows:
                copy.write_row(row)
            total += len(batch_rows)
            print(f'  streamed {total} rows...')
            batch_rows = cur.fetchmany(BATCH)
pg_conn.commit()

with pg_conn.cursor() as pcur:
    pcur.execute("SELECT setval('radpostauth_id_seq', COALESCE((SELECT MAX(id) FROM radpostauth), 1))")
    pcur.execute("SELECT COUNT(*) FROM radpostauth")
    print('final radpostauth count:', pcur.fetchone()[0])
pg_conn.commit()

cur.close()
mysql_conn.close()
pg_conn.close()
print(f'TOTAL streamed: {total}')
