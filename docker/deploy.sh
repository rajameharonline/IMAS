#!/bin/bash
# Docker stack (Phase-1) auto-deploy script — GitHub Actions self-hosted runner
# push-to-main-এ এটাই চালায়, অথবা সার্ভারে সরাসরি ম্যানুয়ালি চালানো যায়:
#   bash docker/deploy.sh
#
# গুরুত্বপূর্ণ: /var/www/isp_bnas নিজেই production server-এর live git checkout —
# আলাদা কোনো "build server" নেই। তাই ধ্বংসাত্মক `git reset --hard` ব্যবহার করা
# হয় না; সার্ভারে uncommitted local change থাকলে script থেমে যাবে (silently
# overwrite করবে না) — কারণ এই একই ডিরেক্টরিতে প্রায়ই সরাসরি hotfix করা হয়।
set -euo pipefail
cd /var/www/isp_bnas

echo "[deploy] uncommitted change check..."
if [[ -n "$(git status --porcelain)" ]]; then
    echo "[deploy] সার্ভারে uncommitted local change আছে — deploy বন্ধ করা হলো।"
    echo "         আগে commit/stash করুন, নইলে git pull conflict দিতে পারে:"
    git status --short
    exit 1
fi

echo "[deploy] git pull origin main..."
git fetch origin main
git merge --ff-only origin/main

echo "[deploy] docker image rebuild..."
docker compose build

echo "[deploy] migrations (explicit, auto নয় — CLAUDE.md নিয়ম)..."
docker compose run --rm django-app python manage.py migrate --noinput

echo "[deploy] container recreate (django-app, celery-worker, celery-beat)..."
docker compose up -d --force-recreate django-app celery-worker celery-beat

echo "[deploy] health check..."
sleep 5
for svc in django-app celery-worker celery-beat; do
    state=$(docker inspect -f '{{.State.Status}}' "isp_bnas-${svc}-1" 2>/dev/null || echo "missing")
    if [[ "$state" != "running" ]]; then
        echo "[deploy] ❌ ${svc} চালু নেই (state=${state}) — লগ দেখুন: docker logs isp_bnas-${svc}-1"
        exit 1
    fi
    echo "[deploy] ✅ ${svc}: running"
done

echo "[deploy] ✅ Deploy সম্পন্ন — $(git rev-parse --short HEAD)"
