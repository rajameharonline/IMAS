# IMAS Django monolith — app + celery worker + celery beat একই image ব্যবহার করে
# (command শুধু docker-compose.yml-এ ভিন্ন হবে)
FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DJANGO_SETTINGS_MODULE=config.settings

# host-এ isp:isp (997:973) যেই UID/GID দিয়ে media/staticfiles/logs owned,
# container-ও একই UID/GID ব্যবহার করবে যাতে volume mount-এ permission mismatch না হয়
ARG APP_UID=997
ARG APP_GID=973

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        libpq-dev \
        ffmpeg \
        gcc \
        pkg-config \
        snmp \
    && rm -rf /var/lib/apt/lists/*
# libpq-dev = PostgreSQL client lib (psycopg[binary] wheel নিজেই libpq bundle করে,
# তবু psycopg source fallback/health-check টুলের জন্য রাখা হলো — MySQL client lib
# আর দরকার নেই যেহেতু প্রজেক্ট PostgreSQL-এ কনভার্ট হয়ে গেছে, settings.py দ্রষ্টব্য)
# snmp প্যাকেজ (snmpwalk binary) দরকার olt_mgmt/services/snmp_service.py-এর জন্য —
# এটা ছাড়া celery worker olt_mgmt.link_onu_clients/sync_all_olts_mac_table টাস্কে
# silently খালি/ভুল ফলাফল (0 CPE MAC entries) DB-তে লিখে দেয়, কোনো visible crash ছাড়াই।
#
# ffmpeg প্যাকেজ (ffmpeg + ffprobe binary) দরকার livetv/services/stream_service.py-এর
# জন্য — এটা ছাড়া 'url'-টাইপ LiveTV চ্যানেলের relay কখনো real video produce করতে
# পারে না, ফলে content/ping check fail হয়ে চ্যানেল app-এর visibility filter থেকে
# বাদ পড়ে যায় (মোবাইল অ্যাপে চ্যানেল লিস্ট/ভিডিও দেখা যায় না, কোনো visible crash ছাড়াই)।

RUN groupadd -g ${APP_GID} isp \
    && useradd -m -u ${APP_UID} -g ${APP_GID} -s /bin/bash isp \
    && usermod -aG www-data isp
# host-এ isp ইউজার www-data (gid 33)-এর সদস্য বলে group-writable log file (rwxrwxr-x,
# owner amir, group www-data) লিখতে পারে — কন্টেইনারেও একই সদস্যতা না দিলে
# PermissionError হবে (isp_bnas.log-এর মতো ফাইলে, যেগুলো world-writable না)

WORKDIR /var/www/IMAS

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# পুরো repo copy করা হচ্ছে (৪০+ Django app, প্রতিটা আলাদাভাবে COPY করা অবাস্তব) —
# .dockerignore-এ .env*/.mcp.json/secrets.py/firebase-service-account.json/
# google-services.json সব বাদ দেওয়া আছে, তাই কোনো secret image layer-এ ঢোকে না
# (SonarCloud docker:S6470 — .dockerignore-ই এখানে প্রকৃত সুরক্ষা)
COPY . .

RUN mkdir -p logs staticfiles media \
    && chown -R isp:isp /var/www/IMAS

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER isp

EXPOSE 8000

ENTRYPOINT ["entrypoint.sh"]
CMD ["gunicorn", \
     "--workers", "3", \
     "--worker-class", "sync", \
     "--bind", "0.0.0.0:8000", \
     "--timeout", "120", \
     "--access-logfile", "-", \
     "--error-logfile", "-", \
     "config.wsgi:application"]
