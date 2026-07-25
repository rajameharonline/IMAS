# এই ফাইলটি পুরো Django প্রজেক্টের settings/configuration পরিচালনা করে।
# সব গোপন তথ্য .env ফাইল থেকে লোড হবে — কোনো credential এখানে হার্ডকোড করা নেই।

import environ
from pathlib import Path
from datetime import timedelta
from celery.schedules import crontab

# Base directory
BASE_DIR = Path(__file__).resolve().parent.parent

# environ দিয়ে .env ফাইল থেকে settings লোড করা হচ্ছে
env = environ.Env(
    DEBUG=(bool, True),
    ALLOWED_HOSTS=(list, ['localhost', '127.0.0.1']),
)
environ.Env.read_env(BASE_DIR / '.env')

SECRET_KEY = env('SECRET_KEY', default='django-insecure-change-this-in-production')
DEBUG = env('DEBUG')
ALLOWED_HOSTS = env('ALLOWED_HOSTS')

# HTTPS domain-এ Django admin/form POST-এর জন্য (setup_https.sh .env-এ সেট করে)।
# কমা দিয়ে একাধিক origin দেওয়া যায়, যেমন: https://roisp.duckdns.org
CSRF_TRUSTED_ORIGINS = env('CSRF_TRUSTED_ORIGINS', cast=list, default=[])

# nginx (443 server block) request প্রক্সি করার সময় X-Forwarded-Proto: https পাঠায়,
# তাই Django-কে বলে দিতে হবে এই header দেখে request secure কিনা বুঝতে (request.is_secure())।
# সতর্কতা: walled-garden default_server (nginx, expired client notice, port 80) ইচ্ছাকৃতভাবে
# X-Forwarded-Proto: http পাঠায় — তাই এখানে SECURE_SSL_REDIRECT চালু করা হয়নি, করলে সেই
# flow ভেঙে যাবে (nginx আগে থেকেই মূল ডোমেইনে HTTP→HTTPS redirect করে, তাই প্রয়োজনও নেই)।
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_CONTENT_TYPE_NOSNIFF = True

# App user password — reversible Fernet encryption (admin panel-এ দেখানোর জন্য)
PASSWORD_ENCRYPT_KEY = env('PASSWORD_ENCRYPT_KEY', default='')

# ─── VoIP / IP-phone (Asterisk) settings — বিস্তারিত: VOIP_PLAN.md ──────────────
# VOIP_ENABLED=False (default) হলে Asterisk realtime push ও কল originate বন্ধ থাকে;
# শুধু SipEndpoint/CallLog DB অংশ কাজ করে (Phase 2)। Asterisk চালু হলে (Phase 1)
# .env-এ True ও বাকি key গুলো সেট করতে হবে — কোনো credential hardcode নয়।
VOIP_ENABLED      = env.bool('VOIP_ENABLED', default=False)
VOIP_SIP_DOMAIN   = env('VOIP_SIP_DOMAIN', default='')       # যেমন voip.example.com
VOIP_WSS_URL      = env('VOIP_WSS_URL', default='')          # wss://voip.example.com:8089/ws
# Asterisk ARI (Asterisk REST Interface) — localhost-only রাখতে হবে
ASTERISK_ARI_URL  = env('ASTERISK_ARI_URL', default='http://127.0.0.1:8088')
ASTERISK_ARI_USER = env('ASTERISK_ARI_USER', default='')
ASTERISK_ARI_PASS = env('ASTERISK_ARI_PASS', default='')
ASTERISK_ARI_APP  = env('ASTERISK_ARI_APP', default='isp-voip')
# Asterisk AMI — file-based provisioning-এ `pjsip reload` ট্রিগার করতে (localhost-only)।
# কেন AMI/file, realtime/ODBC নয়: mysql-server-8.4 ⨯ mariadb-common conflict (memory গোটচা)।
ASTERISK_AMI_HOST = env('ASTERISK_AMI_HOST', default='127.0.0.1')
ASTERISK_AMI_PORT = env.int('ASTERISK_AMI_PORT', default=5038)
ASTERISK_AMI_USER = env('ASTERISK_AMI_USER', default='')
ASTERISK_AMI_PASS = env('ASTERISK_AMI_PASS', default='')
# PJSIP endpoint config dir (pjsip.conf এটি include করে; gunicorn user `isp` এখানে লেখে)
VOIP_PJSIP_DIR    = env('VOIP_PJSIP_DIR', default='/etc/asterisk/pjsip_isp.d')
# coturn TURN — ephemeral REST credentials (static long-term secret frontend-এ নয়)
TURN_URLS   = env.list('TURN_URLS', default=[])             # ['turn:voip.example.com:3478']
TURN_SECRET = env('TURN_SECRET', default='')
TURN_TTL    = env.int('TURN_TTL', default=3600)

# অ্যাপ্লিকেশন সংজ্ঞা
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    # Third party
    'rest_framework',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',
    'corsheaders',
    'django_filters',
    'django_celery_beat',
    'django_celery_results',

    # ISP অ্যাপ মডিউলসমূহ
    'accounts',         # ইউজার ও অথেন্টিকেশন ম্যানেজমেন্ট
    'configuration',    # জোন, সাবজোন, বক্স, ক্লায়েন্ট টাইপ, প্রটোকল, প্যাকেজ
    'clients',          # ক্লায়েন্ট ম্যানেজমেন্ট
    'billing',          # বিলিং, পেমেন্ট, ইনভয়েস
    'radius_app',       # FreeRADIUS ইন্টিগ্রেশন
    'mikrotik_app',     # Mikrotik RouterOS API ইন্টিগ্রেশন
    'olt_mgmt',         # OLT ম্যানেজমেন্ট ও SNMP
    'hr',               # HR ও Payroll
    'inventory',        # ইনভেন্টরি ম্যানেজমেন্ট
    'accounting',       # একাউন্টিং মডিউল
    'reports',          # রিপোর্ট মডিউল
    'sms_service',      # SMS সার্ভিস
    'support',          # সাপোর্ট ও টিকেটিং
    'network',          # নেটওয়ার্ক ডায়াগ্রাম
    'pop',              # POP ম্যানেজমেন্ট
    'system_settings',  # সিস্টেম সেটিংস
    'tasks_mgmt',       # টাস্ক ম্যানেজমেন্ট
    'purchase',         # ক্রয় ও ভেন্ডর ম্যানেজমেন্ট
    'assets',           # সম্পদ ব্যবস্থাপনা
    'sales',            # Product ও Service Sales Invoice
    'role_permissions', # Role Group ও Module Permission management
    'mobile_api',       # Mobile App Client API
    'voip',             # VoIP / IP-phone কলিং (Asterisk app-to-app) — VOIP_PLAN.md
    'livetv',           # Live TV চ্যানেল ব্রডকাস্ট (DVB + FFmpeg QSV HLS)
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',   # CORS middleware
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        # APP_DIRS এবং explicit loaders একসাথে রাখা যায় না। তাই APP_DIRS বাদ দিয়ে
        # non-cached loaders দিচ্ছি — cached.Loader না থাকায় DEBUG=False (production)-এও
        # template edit সঙ্গে সঙ্গে দেখায়, gunicorn reload লাগে না।
        # (সামান্য খরচ: প্রতি request-এ template disk থেকে পড়ে — এই সাইটে negligible)
        'OPTIONS': {
            'loaders': [
                'django.template.loaders.filesystem.Loader',
                'django.template.loaders.app_directories.Loader',
            ],
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'

# PostgreSQL ডাটাবেস কনফিগারেশন - FreeRADIUS এর সাথে একই ডাটাবেস ব্যবহার করা হচ্ছে
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': env('DB_NAME', default='radius'),
        'USER': env('DB_USER', default='radius'),
        'PASSWORD': env('DB_PASSWORD', default=''),
        'HOST': env('DB_HOST', default='localhost'),
        'PORT': env('DB_PORT', default='5432'),
    }
}

# Django REST Framework কনফিগারেশন
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 20,
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ],
}

# JWT Token কনফিগারেশন
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=env.int('JWT_ACCESS_TOKEN_LIFETIME_MINUTES', default=60)),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=env.int('JWT_REFRESH_TOKEN_LIFETIME_DAYS', default=7)),
    'ROTATE_REFRESH_TOKENS': False,
    'BLACKLIST_AFTER_ROTATION': False,
    'UPDATE_LAST_LOGIN': True,
    'ALGORITHM': 'HS256',
    'AUTH_HEADER_TYPES': ('Bearer',),
}

# CORS কনফিগারেশন - React frontend এর জন্য
CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://ro.online",
    "https://ro.online",
    "http://www.ro.online",
    "https://www.ro.online",
]
CORS_ALLOW_CREDENTIALS = True

# Celery কনফিগারেশন - background task এর জন্য
CELERY_BROKER_URL = env('CELERY_BROKER_URL', default='redis://localhost:6379/0')
CELERY_RESULT_BACKEND = env('CELERY_RESULT_BACKEND', default='django-db')
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = 'Asia/Dhaka'
CELERY_BEAT_SCHEDULER = 'django_celery_beat.schedulers:DatabaseScheduler'

# OLT-গুলো কোন NTP সার্ভার ব্যবহার করবে — sync_olt_clocks task এটি ডিভাইসে সেট করে।
# খালি রাখলে `ntp server` কমান্ড skip হয় (ঘড়ি তবুও আমাদের সার্ভার থেকে push হয়)।
# নোট: OLT-গুলো ইন্টারনেট NTP-তে পৌঁছাতে পারে না, তাই এখানে **এই সার্ভারের**
# LAN IP দেওয়া হয় (যেমন 172.16.3.254)। ডিভাইস নিজে থেকে sync করতে হলে
# সার্ভারের chrony-তে `allow` দরকার (root) — নইলে শুধু push-ই কাজ করবে।
OLT_NTP_SERVER = env('OLT_NTP_SERVER', default='')

# Periodic task schedules
CELERY_BEAT_SCHEDULE = {
    'auto-generate-monthly-bills': {
        'task': 'billing.auto_generate_monthly_bills',
        # প্রতি মাসের ১ তারিখ রাত ১২টায় — সব active ক্লায়েন্টের বিল তৈরি হবে
        'schedule': crontab(hour=0, minute=0, day_of_month=1),
    },
    'disable-expired-clients': {
        'task': 'billing.disable_expired_clients',
        'schedule': crontab(hour=0, minute=5),  # প্রতিদিন রাত ১২:০৫ — expiry_day চেক
    },
    # OLT MAC table sync — প্রতি 5 মিনিটে সব active OLT-এর fresh ONU data SNMP
    # দিয়ে ফেচ করে OLTMacCache + ONUSignal update করে। ONU Monitoring page
    # frontend auto-refresh (1 min)-এ DB থেকে সরাসরি latest data পায়।
    'olt-auto-sync-mac-table': {
        'task': 'olt_mgmt.sync_all_olts_mac_table',
        'schedule': 300.0,  # প্রতি 300 সেকেন্ড = 5 মিনিট
    },
    # ONU ↔ Client MAC-ভিত্তিক auto-link (Monitoring-এর Client/Zone কলাম populate করে)।
    # bridge walk ভারী বলে RX sync থেকে আলাদা — প্রতি ১৫ মিনিট (সম্পর্ক কম বদলায়)।
    'olt-link-onu-clients': {
        'task': 'olt_mgmt.link_onu_clients',
        'schedule': 900.0,  # ১৫ মিনিট
    },
    # নোট: OLT ঘড়ি sync ইচ্ছাকৃতভাবে **scheduled নয়** — ব্যবহারকারীর সিদ্ধান্ত
    # (2026-07-20): সময় সেট শুধু OLT Management পেজের বাটন থেকে ম্যানুয়ালি হবে
    # (POST /olt/olts/{id}/sync-clock/), কোনো automatic process নয়।
    # RADIUS radacct → ClientMonthlyTraffic daily aggregate (purge-এর আগে চলে)
    'aggregate-radacct-monthly-traffic': {
        'task': 'billing.aggregate_radacct_to_monthly_traffic',
        'schedule': crontab(hour=1, minute=0),  # প্রতিদিন রাত ১টায় — purge-এর ১ ঘণ্টা আগে
    },
    # RADIUS radacct daily purge — ৩০ দিনের পুরনো বন্ধ session মুছে storage বাঁচায়
    'purge-old-radacct-sessions': {
        'task': 'billing.purge_old_radacct_sessions',
        'schedule': crontab(hour=2, minute=0),  # প্রতিদিন রাত ২টায় — aggregate-এর ১ ঘণ্টা পরে
    },
    # Disk usage warning — mysqldump backup কখনো delete হয় না (client history রক্ষা করতে
    # ইচ্ছাকৃত), তাই ডিস্ক ধীরে ধীরে ভরে যেতে পারে। থ্রেশহোল্ড পার হলে superadmin/admin-দের
    # bell notification পাঠায় (system_settings/tasks.py)।
    'check-disk-usage': {
        'task': 'system_settings.check_disk_usage',
        'schedule': crontab(hour=6, minute=0),  # প্রতিদিন সকাল ৬টায়
    },
    # পেমেন্ট রিমাইন্ডার — প্রতি ঘণ্টায় চলে; যেসব ReminderRule-এর send_hour
    # এখনকার ঘণ্টার সাথে মেলে সেগুলোর reminder পাঠায় (SMS/Push/Email)।
    'process-payment-reminders': {
        'task': 'billing.process_payment_reminders',
        'schedule': crontab(minute=0),  # প্রতি ঘণ্টার শুরুতে
    },
    # এক্সপায়ারি-ভিত্তিক স্বয়ংক্রিয় ভয়েস কল — প্রতি ৫ মিনিটে চেক; প্রতিটি active
    # VoiceCallSchedule তার নিজস্ব run_time-এ (দিনে একবার) চলে। timing/days অনুযায়ী
    # মিলে যাওয়া client-দের রেকর্ডিং বাজিয়ে কল করে।
    'run-voice-call-schedules': {
        'task': 'voip.run_voice_call_schedules',
        'schedule': crontab(minute='*/5'),  # প্রতি ৫ মিনিট
    },
    # Live TV — idle URL/IPTV relay বন্ধ করা। AppLiveTVStreamProxyView প্রথম viewer
    # এলে on-demand FFmpeg mirror চালায় (bandwidth-efficient shared relay); viewer
    # চলে গেলে ৩ মিনিট idle থাকলে এই task সেটা বন্ধ করে দেয়, নাহলে সব চ্যানেল
    # সবসময় চালু থেকে bandwidth/CPU নষ্ট হতো।
    'sweep-idle-livetv-relays': {
        'task': 'livetv.sweep_idle_url_relays',
        'schedule': 120.0,  # প্রতি ২ মিনিট
    },
    # Live TV — "error" status-এ আটকে থাকা url চ্যানেল স্বয়ংক্রিয়ভাবে retry করা।
    # অনেক upstream IPTV feed flaky (segment সাময়িকভাবে expire/404) — retry করলে
    # প্রায়ই নিজে থেকেই সুস্থ হয়ে যায়, admin-কে ম্যানুয়ালি Start ক্লিক করতে হয় না।
    'retry-error-livetv-channels': {
        'task': 'livetv.retry_error_url_channels',
        'schedule': 180.0,  # প্রতি ৩ মিনিট
    },
    # Live TV — dead/AV-হীন/ধীর url চ্যানেল app-list থেকে স্বয়ংক্রিয় বাদ। প্রতিটা
    # active url চ্যানেল ffprobe করে video/audio ও loading-time যাচাই করে; ব্যর্থ হলে
    # last_content_ok=False → app থেকে hidden (admin-কে আর "Auto Check" চাপতে হয় না)।
    'auto-prune-livetv-channels': {
        'task': 'livetv.auto_prune_channels',
        'schedule': crontab(minute=0, hour='*/4'),  # প্রতি ৪ ঘণ্টায়
    },
    # Live TV — keep-warm pool: top-N (বা সব) visible চ্যানেল সবসময় চালু রেখে
    # cold-start loading শূন্য করা। bandwidth-নির্ভর — LIVETV_KEEP_WARM_COUNT দিয়ে
    # নিয়ন্ত্রিত (0=বন্ধ)। প্রতি ২ মিনিটে চেক করে বন্ধ থাকা target relay চালু করে ও
    # ping refresh করে (sweep যাতে না মারে)।
    'keep-warm-livetv-channels': {
        'task': 'livetv.keep_warm_channels',
        'schedule': 120.0,  # প্রতি ২ মিনিট
    },
    # Live TV — বন্ধ/orphan হয়ে যাওয়া url চ্যানেলের leftover .ts/.m3u8 ফাইল ডিস্ক থেকে
    # sweep করে (mtime-ভিত্তিক, ৩০ মিনিটের বেশি পুরনো হলেই মুছে যায়)। Active channel-এর
    # ffmpeg প্রতি কয়েক সেকেন্ডে file rewrite করে বলে mtime সবসময় fresh থাকে — তাই এই
    # task কখনো live viewer-দের প্রভাবিত করে না। celery worker যেহেতু `isp` user-এই চলে
    # (ffmpeg-ও সেই user-এই ফাইল লেখে), কোনো sudo/permission সমস্যা ছাড়াই ডিলিট করতে পারে।
    'sweep-stale-livetv-hls-cache': {
        'task': 'livetv.sweep_stale_hls_files',
        'schedule': 1800.0,  # প্রতি ৩০ মিনিট
    },
}

# ── Live TV keep-warm pool size ──────────────────────────────────────────────
# কতগুলো (top) visible চ্যানেল সবসময় warm (relay চালু) রাখা হবে → ওই চ্যানেলগুলো
# খুললে ০ loading। bandwidth-নির্ভর (প্রতি relay ~2.5 Mbps upstream টানে):
#   0   → বন্ধ (default; বর্তমান সীমিত bandwidth-এ নিরাপদ)
#   N   → তালিকার প্রথম N টি চ্যানেল সবসময় warm (যেমন 50 ≈ ~125 Mbps)
#   -1  → সব visible চ্যানেল warm (bandwidth upgrade-এর পর, যেমন 1 Gbps+/1 Tbps)
# .env-এ LIVETV_KEEP_WARM_COUNT সেট করে isp-celery(+beat) restart করলেই কার্যকর।
LIVETV_KEEP_WARM_COUNT = env.int('LIVETV_KEEP_WARM_COUNT', default=0)

# Redis Cache কনফিগারেশন
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": env('REDIS_URL', default='redis://127.0.0.1:6379/1'),
    }
}

# Email কনফিগারেশন
EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = env('EMAIL_HOST', default='smtp.gmail.com')
EMAIL_PORT = env.int('EMAIL_PORT', default=587)
EMAIL_HOST_USER = env('EMAIL_HOST_USER', default='')
EMAIL_HOST_PASSWORD = env('EMAIL_HOST_PASSWORD', default='')
EMAIL_USE_TLS = env.bool('EMAIL_USE_TLS', default=True)
DEFAULT_FROM_EMAIL = env('DEFAULT_FROM_EMAIL', default='no-reply@isp.local')

# Static & Media files
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# Internationalization
LANGUAGE_CODE = 'en-us'
TIME_ZONE = env('TIME_ZONE', default='Asia/Dhaka')
USE_I18N = True
USE_TZ = True

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Custom User Model
AUTH_USER_MODEL = 'accounts.User'

# কোম্পানি তথ্য - ISP এর মূল তথ্য সংরক্ষণ
COMPANY_NAME = env('COMPANY_NAME', default='ISP Company')
COMPANY_ADDRESS = env('COMPANY_ADDRESS', default='')
COMPANY_PHONE = env('COMPANY_PHONE', default='')

# Mikrotik RouterOS API সেটিংস (ডিফল্ট - প্রতিটি রাউটারের জন্য DB-তে আলাদা সেটিং থাকবে)
MIKROTIK_DEFAULT_HOST = env('MIKROTIK_HOST', default='192.168.1.1')
MIKROTIK_DEFAULT_USER = env('MIKROTIK_USER', default='admin')
MIKROTIK_DEFAULT_PASSWORD = env('MIKROTIK_PASSWORD', default='')
MIKROTIK_DEFAULT_PORT = env.int('MIKROTIK_PORT', default=8728)

# SMS Gateway সেটিংস
SMS_GATEWAY_URL = env('SMS_GATEWAY_URL', default='')
SMS_GATEWAY_API_KEY = env('SMS_GATEWAY_API_KEY', default='')
SMS_SENDER_ID = env('SMS_SENDER_ID', default='ISPNAME')

# Firebase Admin (FCM push) — service account private key JSON-এর path।
# ⚠️ এটা google-services.json নয় — Firebase Console → Project Settings →
#    Service accounts → "Generate new private key" থেকে পাওয়া JSON।
FIREBASE_CREDENTIALS_PATH = env('FIREBASE_CREDENTIALS_PATH', default='')

# FreeRADIUS PostgreSQL সেটিংস - বিলিং স্ট্যাটাস ও authentication এর জন্য
RADIUS_DB = {
    'host': env('RADIUS_DB_HOST', default='localhost'),
    'port': env.int('RADIUS_DB_PORT', default=5432),
    'name': env('RADIUS_DB_NAME', default='radius'),
    'user': env('RADIUS_DB_USER', default='radius'),
    'password': env('RADIUS_DB_PASSWORD', default=''),
}

# Payment Gateway সেটিংস
BKASH_CONFIG = {
    'app_key': env('BKASH_APP_KEY', default=''),
    'app_secret': env('BKASH_APP_SECRET', default=''),
    'username': env('BKASH_USERNAME', default=''),
    'password': env('BKASH_PASSWORD', default=''),
    'base_url': env('BKASH_BASE_URL', default='https://tokenized.sandbox.bka.sh/v1.2.0-beta'),
}

# False করলে local/dev test-এ SNS signature verify skip হবে
BKASH_SNS_VERIFY_SIGNATURE = env.bool('BKASH_SNS_VERIFY_SIGNATURE', default=True)

# generic webhook receiver (/api/v1/billing/webhook/receive/{gateway}/) — SMS-forwarder
# app/service থেকে payment notification আসার জন্য shared-secret। খালি রাখলে (default)
# endpoint সব request reject করবে (fail-closed) — .env-এ সেট করে forwarder app-এও একই
# secret (header X-Webhook-Secret বা query param ?secret=) দিতে হবে।
WEBHOOK_SHARED_SECRET = env('WEBHOOK_SHARED_SECRET', default='')

# ── AI / LLM (local Ollama, dedicated মেশিনে — data বাইরে যায় না) ──────
# provider-agnostic: পরে cloud/বড় GPU-তে নিতে শুধু এই value গুলো বদলালেই হবে।
AI_ENABLED  = env.bool('AI_ENABLED', default=True)
AI_PROVIDER = env('AI_PROVIDER', default='ollama')          # ollama | openai | anthropic
AI_BASE_URL = env('AI_BASE_URL', default='http://172.16.6.10:11434')  # laptop Ollama
AI_MODEL    = env('AI_MODEL',    default='qwen2.5:3b')
AI_API_KEY  = env('AI_API_KEY',  default='')                # cloud provider হলে
AI_TIMEOUT  = env.int('AI_TIMEOUT', default=150)            # CPU-only বলে বড় timeout
# App AI সহকারীতে full LLM কথোপকথন (multi-turn) চালু কিনা। ollama-CPU ধীর বলে default
# বন্ধ — fast provider (openai/anthropic) দিলে নিজে থেকেই চালু হয়। জোর করে চালু করতে True।
AI_CHAT_CONVERSATION = env.bool('AI_CHAT_CONVERSATION', default=False)
# নতুন portal ticket-এ খুব নিরাপদ/সাধারণ intent (যেমন billing) হলে AI স্বয়ংক্রিয় draft
# উত্তর ticket-এ পোস্ট করবে কিনা। default বন্ধ (staff approval-নির্ভর রাখতে)।
AI_TICKET_AUTOREPLY = env.bool('AI_TICKET_AUTOREPLY', default=False)

SSLCOMMERZ_CONFIG = {
    'store_id': env('SSLCOMMERZ_STORE_ID', default=''),
    'store_pass': env('SSLCOMMERZ_STORE_PASS', default=''),
    'is_sandbox': env.bool('SSLCOMMERZ_IS_SANDBOX', default=True),
}

# Logging কনফিগারেশন
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '{levelname} {asctime} {module} {message}',
            'style': '{',
        },
    },
    'handlers': {
        'file': {
            'level': 'INFO',
            'class': 'logging.FileHandler',
            'filename': BASE_DIR / 'logs' / 'isp_bnas.log',
            'formatter': 'verbose',
        },
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'verbose',
        },
        # bKash SNS-এর জন্য আলাদা log file
        'bkash_sns_file': {
            'level': 'DEBUG',
            'class': 'logging.FileHandler',
            'filename': BASE_DIR / 'logs' / 'bkash_sns.log',
            'formatter': 'verbose',
        },
    },
    'root': {
        'handlers': ['console', 'file'],
        'level': 'INFO',
    },
    'loggers': {
        'django': {
            'handlers': ['console', 'file'],
            'level': 'WARNING',
            'propagate': False,
        },
        # bKash SNS webhook — আলাদা file + console-এ সব log দেখাবে
        'billing.bkash_sns': {
            'handlers': ['bkash_sns_file', 'console'],
            'level': 'DEBUG',
            'propagate': False,
        },
    },
}
