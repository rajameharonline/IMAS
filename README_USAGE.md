# ISP Billing & Network Automation System - ব্যবহার নির্দেশিকা

## প্রথমবার চালু করার নিয়ম

### ১. .env ফাইল কনফিগার করুন
```bash
cp .env.example .env
nano .env   # আসল credentials দিন
```

### ২. Setup চালান
```bash
./setup.sh
```

### ৩. Django Backend চালু করুন
```bash
source venv/bin/activate
python manage.py runserver 0.0.0.0:8000
```

### ৪. Celery Worker চালু করুন (আলাদা terminal)
```bash
source venv/bin/activate
celery -A config worker -l info
celery -A config beat -l info  # periodic tasks
```

### ৫. Admin Panel চালু করুন (আলাদা terminal)
```bash
cd admin_panel
npm run dev
```

### ৬. User Portal চালু করুন (আলাদা terminal)
```bash
cd user_portal
npm run dev
```

## URL গুলো

| সার্ভিস | URL |
|---------|-----|
| Django API | http://localhost:8000/api/v1/ |
| Django Admin | http://localhost:8000/admin/ |
| Admin Panel | http://localhost:5173 |
| User Portal | http://localhost:5174 |

## Default Login

- **Admin Panel**: username: `admin`, password: `Admin@123`
- প্রথম লগইনের পরে অবশ্যই পাসওয়ার্ড পরিবর্তন করুন!

## Nginx দিয়ে Production Deploy

```bash
sudo cp nginx_config/isp_bnas.conf /etc/nginx/sites-available/isp_bnas
sudo ln -sf /etc/nginx/sites-available/isp_bnas /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## গুরুত্বপূর্ণ API Endpoints

### Authentication
- POST `/api/v1/auth/login/` - লগইন
- POST `/api/v1/auth/token/refresh/` - Token refresh
- POST `/api/v1/auth/logout/` - লগআউট

### Clients
- GET/POST `/api/v1/clients/` - ক্লায়েন্ট তালিকা ও তৈরি
- POST `/api/v1/clients/{id}/enable/` - সংযোগ চালু
- POST `/api/v1/clients/{id}/disable/` - সংযোগ বন্ধ

### Billing
- GET/POST `/api/v1/billing/bills/` - বিল তালিকা
- POST `/api/v1/billing/bills/generate-monthly/` - মাসিক বিল তৈরি
- POST `/api/v1/billing/payments/` - পেমেন্ট গ্রহণ

### FreeRADIUS
- GET `/api/v1/radius/online-users/` - Online user তালিকা
- POST `/api/v1/radius/disconnect/` - User disconnect

### Mikrotik
- GET `/api/v1/mikrotik/servers/{id}/live-traffic/` - Live traffic
- POST `/api/v1/mikrotik/servers/{id}/create-backup/` - Backup
- GET `/api/v1/mikrotik/servers/{id}/import-users/` - User import

### Reports
- GET `/api/v1/reports/bill-collection/` - বিল কালেকশন রিপোর্ট
- GET `/api/v1/reports/due-customers/` - বকেয়া ক্লায়েন্ট রিপোর্ট

## FreeRADIUS সংযোগ

সিস্টেম বিদ্যমান FreeRADIUS MySQL ডাটাবেসের সাথে সংযুক্ত।
- radcheck - user password ও auth control
- radreply - user attributes  
- radusergroup - package/group assignment
- radacct - accounting/session data

## Celery Periodic Tasks

| Task | Schedule |
|------|----------|
| Auto Bill Generation | প্রতি মাসের ১ তারিখ |
| Expire & Disable Clients | প্রতিদিন রাত ১২টা |
| Due SMS Send | প্রতি মাসের ৫ তারিখ |
| Router Backup | প্রতিদিন রাত ২টা |

## React প্রজেক্ট বিল্ড করার কমান্ড
cd /var/www/isp_bnas/admin_panel && node ./node_modules/vite/bin/vite.js build