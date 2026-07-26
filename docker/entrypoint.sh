#!/bin/bash
# Container entrypoint — শুধু PostgreSQL/Redis reachable কিনা যাচাই করে, তারপর CMD চালায়।
# গুরুত্বপূর্ণ: এখানে auto migrate/collectstatic ইচ্ছাকৃতভাবে নেই —
# CLAUDE.md নিয়ম অনুযায়ী migration সবসময় explicit/manual হওয়া উচিত:
#   docker compose exec django-app python manage.py migrate
set -e

echo "[entrypoint] PostgreSQL (${DB_HOST}:${DB_PORT}) reachability check..."
for i in $(seq 1 15); do
    if (echo > /dev/tcp/"${DB_HOST}"/"${DB_PORT}") >/dev/null 2>&1; then
        echo "[entrypoint] PostgreSQL reachable."
        break
    fi
    echo "[entrypoint] waiting for PostgreSQL... ($i/15)"
    sleep 2
done

exec "$@"
