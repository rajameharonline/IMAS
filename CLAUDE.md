# ISP-BNAS Project — Claude Code Instructions

## Autonomous Work Mode (গুরুত্বপূর্ণ)

**User যা বলবে সাথে সাথে শুরু করো — অতিরিক্ত প্রশ্ন করার দরকার নেই।**

- Context এই ফাইল এবং Work Log থেকে নিজেই নাও
- Reasonable decision নিজেই নাও — ছোট বিষয়ে user-কে জিজ্ঞেস করো না
- শুধুমাত্র এই ক্ষেত্রে জিজ্ঞেস করো: destructive/irreversible কাজ (DB drop, force push, production config মুছে দেওয়া)

## প্রথমেই করণীয় (Session Start Protocol)

এই project-এ কাজ শুরু করার সাথে সাথে:

1. নিচের Critical Rules মেনে চলো
2. Work Log (session start-এ auto-inject হয়) দেখো — সাম্প্রতিক পরিবর্তন কী হয়েছে
3. বিস্তারিত দরকার হলে `/var/www/isp_bnas/ai.md` পড়ো
4. কাজ শেষে `ai.md`-এর **Section 14 (Work Log)**-এ entry যোগ করো

---

## Critical Rules (এগুলো ভুললে Production ভাঙবে)

### ❌ কখনো করবেন না
- `billing/models.py` এর `Payment.save()`, `_auto_enable_client_if_paid()`, `_update_expiry_and_enable_for_unverified()` — rename বা delete নয়
- `radius_app/services/radius_service.py` এবং `mikrotik_app/services/mikrotik_service.py` — method signature পরিবর্তন নয়
- `.env` ছাড়া credential hardcode নয়
- Migration ছাড়া model field পরিবর্তন নয়
- `config/settings.py` এর INSTALLED_APPS, DATABASES, AUTH_USER_MODEL পরিবর্তন নয়

### ✅ সবসময় করবেন
- Python file edit → gunicorn **স্বয়ংক্রিয়** reload হয় (hook আছে)
- Frontend edit → `cd /var/www/isp_bnas/admin_panel && node ./node_modules/vite/bin/vite.js build`
- সব comment বাংলায়
- কাজ শেষে `ai.md` Section 14-এ log entry

---

## Project Architecture (One-liner)

```
Django DRF (port 8000, gunicorn) ← Nginx → React Vite (admin_panel/dist/)
FreeRADIUS (MySQL: radius DB) ← radius_app/services/radius_service.py
MikroTik RouterOS API ← mikrotik_app/services/mikrotik_service.py
Celery + Redis (billing automation, OLT sync)
```

## Key File Locations

| কাজ | ফাইল |
|---|---|
| সব model relations | `ai.md` Section 4 |
| RADIUS logic | `radius_app/services/radius_service.py` |
| MikroTik logic | `mikrotik_app/services/mikrotik_service.py` |
| Billing hooks | `billing/models.py` |
| Client enable/disable | `clients/api/views.py` |
| Frontend routes | `admin_panel/src/App.jsx` |
| API base | `admin_panel/src/utils/api.js` |
| Recent changes | `ai.md` Section 14 (Work Log) |
| Permission system | `role_permissions/` app |
| Permission context | `admin_panel/src/context/PermissionContext.jsx` |
| App Users page | `admin_panel/src/pages/system/AppUsersPage.jsx` |
| Webhook payments | `billing/models.py` (WebhookPayment), `billing/api/views.py` |
| Collector cash tracking | `hr/models.py` (CollectorCashBalance) |

## নতুন গুরুত্বপূর্ণ নিয়ম (2026-06-04 থেকে)

- **Password Encryption:** `role_permissions/utils.py` — `.env`-এ `PASSWORD_ENCRYPT_KEY` থাকতে হবে
- **Webhook receiver:** `POST /api/v1/billing/webhook/receive/{gateway}/` — anonymous, auth নেই
- **Bill delete নিষিদ্ধ:** `billing/api/views.py` destroy() → 405। Waive ব্যবহার করুন।
- **App Users:** পুরনো `/system/users` সরানো হয়েছে। নতুন `/system/app-users` ব্যবহার করুন।
- **Permission enforcement:** Superadmin/Admin সব দেখে। অন্যরা role assign না হলে কিছু দেখে না।

## Client Status → RADIUS Mapping

| Status | RADIUS | MikroTik |
|---|---|---|
| `active` | Cleartext-Password set, আসল group | Normal profile |
| `suspended` (manual) | Auth-Type:=Reject | Session kicked |
| `expired` (payment due) | Blocked_Group → `Expired PPPoE` profile | Session kicked |
| `inactive` | Auth-Type:=Reject | — |

## Stack Info

- **Python:** 3.14, venv: `/var/www/isp_bnas/venv`
- **MySQL:** localhost:3306, app DB: `isp_bnas` (or configured in .env), RADIUS DB: `radius`
- **Redis:** localhost:6379
- **Gunicorn:** PID at `logs/gunicorn.pid`, service: `isp-gunicorn.service`
- **Frontend build:** `admin_panel/dist/` (Nginx serve করে)
