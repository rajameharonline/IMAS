"""
পুরনো MySQL (isp_bnas, ISP-LAB) থেকে নতুন PostgreSQL (IMAS)-এ ডেটা মাইগ্রেশন।
এককালীন স্ক্রিপ্ট — চালাতে হবে: python manage.py shell < scripts/migrate_from_mysql.py
টানেল প্রয়োজন: ssh -L 3307:localhost:3306 amir@172.16.3.254

FK dependency-order জানার দরকার নেই — retry-loop পদ্ধতি: প্রতি pass-এ যা সফল হয়
বাদ দিয়ে বাকিগুলো পরের pass-এ retry হয় (dependency আপনাআপনি resolve হয়)।
সুপারইউজার/trigger-disable কোনো বিশেষ পারমিশন লাগে না।
"""
import json
import datetime
import pymysql
from django.apps import apps
from django.utils import timezone as dj_timezone
from django.db import connection as pg_connection, transaction

MYSQL_CFG = dict(
    host='127.0.0.1', port=3307, user='radius', password='010230',
    database='radius', charset='utf8mb4', cursorclass=pymysql.cursors.DictCursor,
)

SKIP_APPS = {
    'admin', 'auth', 'contenttypes', 'sessions',
    'token_blacklist', 'django_celery_beat', 'django_celery_results',
}


def old_table_name(new_table: str) -> str:
    if (new_table.startswith('livetv_') or new_table.startswith('django_')
            or new_table.startswith('auth_') or new_table.startswith('token_blacklist_')):
        return new_table
    return 'isp_' + new_table


def coerce_value(field, val):
    if val is None:
        return None
    internal = field.get_internal_type()
    if internal == 'BooleanField':
        return bool(val)
    if internal == 'JSONField':
        if isinstance(val, (dict, list)):
            return val
        if isinstance(val, str):
            try:
                return json.loads(val)
            except (json.JSONDecodeError, TypeError):
                return val
        return val
    if internal == 'DateTimeField' and isinstance(val, datetime.datetime):
        if dj_timezone.is_naive(val):
            return dj_timezone.make_aware(val, dj_timezone.get_default_timezone())
        return val
    if internal == 'TimeField' and isinstance(val, datetime.timedelta):
        # PyMySQL TIME কলাম timedelta হিসেবে ফেরত দেয়, Django TimeField-এর time() লাগে
        total_seconds = int(val.total_seconds())
        h, rem = divmod(total_seconds, 3600)
        m, s = divmod(rem, 60)
        return datetime.time(hour=h % 24, minute=m, second=s)
    return val


def fetch_objs(model, mysql_conn):
    table = model._meta.db_table
    old_table = old_table_name(table)
    with mysql_conn.cursor() as cur:
        try:
            cur.execute(f"SELECT COUNT(*) as c FROM `{old_table}`")
        except pymysql.err.ProgrammingError:
            return table, old_table, None, 0
        total = cur.fetchone()['c']
        if not total:
            return table, old_table, [], 0
        cur.execute(f"SELECT * FROM `{old_table}`")
        rows = cur.fetchall()

    field_by_column = {f.column: f for f in model._meta.fields}
    objs = []
    for row in rows:
        kwargs = {}
        for col, val in row.items():
            field = field_by_column.get(col)
            if field is None:
                continue
            kwargs[field.attname] = coerce_value(field, val)
        objs.append(model(**kwargs))
    return table, old_table, objs, total


def reset_sequence(table):
    with pg_connection.cursor() as cur:
        cur.execute(
            f'SELECT setval(pg_get_serial_sequence(%s, \'id\'), '
            f'COALESCE((SELECT MAX(id) FROM "{table}"), 1))',
            [table],
        )


def main():
    mysql_conn = pymysql.connect(**MYSQL_CFG)

    pending = []  # (model, table, old_table, objs, total)
    for model in apps.get_models():
        if model._meta.app_label in SKIP_APPS or not model._meta.managed:
            continue
        table, old_table, objs, total = fetch_objs(model, mysql_conn)
        if objs:
            pending.append([model, table, old_table, objs, total])
    mysql_conn.close()

    print(f'{len(pending)} tables have data to migrate. Starting retry-loop...')

    done = []
    last_error = {}
    max_passes = len(pending) + 2
    for pass_no in range(1, max_passes + 1):
        if not pending:
            break
        still_pending = []
        progressed = False
        for item in pending:
            model, table, old_table, objs, total = item
            try:
                with transaction.atomic():
                    created = model.objects.bulk_create(objs, ignore_conflicts=True, batch_size=500)
                has_id_pk = any(f.column == 'id' for f in model._meta.fields)
                if has_id_pk:
                    try:
                        reset_sequence(table)
                    except Exception as e:
                        print(f'  seq reset failed for {table}: {e}')
                done.append((table, f'{len(created)}/{total}'))
                progressed = True
            except Exception as e:
                last_error[table] = str(e)[:200]
                still_pending.append(item)
        pending = still_pending
        print(f'[pass {pass_no}] done={len(done)} pending={len(pending)}')
        if not progressed:
            break

    print('=' * 70)
    for table, status in done:
        print(f'OK   {table:40s} {status}')
    for item in pending:
        _, table, _, _, total = item
        print(f'FAIL {table:40s} rows={total} error={last_error.get(table)}')
    print('=' * 70)
    print(f'TOTAL migrated tables: {len(done)}, failed tables: {len(pending)}')


main()
