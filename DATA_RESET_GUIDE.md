# ISP BNAS — Operational Data Reset Guide

> **উদ্দেশ্য:** নতুন (production) শুরু করার আগে DB-র সব **test/operational টেবিল খালি**
> করা — কিন্তু config, users, RADIUS setup, migrations **অক্ষত** রেখে।
> এর জন্য management command: `reset_test_data`
> (কোড: `system_settings/management/commands/reset_test_data.py`)

---

## ⚠️ আগে অবশ্যই Backup নিন

```bash
sudo bash /var/www/isp_bnas/install.sh backup
```
Backup তৈরি হবে: `/root/isp_bnas_backup_YYYYMMDD_HHMMSS.tar.gz`

> Reset **irreversible** — backup ছাড়া চালাবেন না।

---

## ১. প্রথমে Preview (কী মুছবে শুধু দেখায়, কিছু মুছে না)

```bash
cd /var/www/isp_bnas
venv/bin/python manage.py reset_test_data
```
এটি শুধু **তালিকা** দেখায় — কোন কোন টেবিল খালি হবে। কিছুই মুছে না।

## ২. সত্যিই খালি করতে (নিশ্চিত হলে)

```bash
cd /var/www/isp_bnas
venv/bin/python manage.py reset_test_data --yes
```

> `--yes` ছাড়া কখনো মুছবে না — তাই ভুলে চালালেও নিরাপদ (শুধু preview)।

---

## কী মুছে / কী রাখে

| ✅ মুছে দেয় (operational/test) | 🔒 অক্ষত রাখে (config/setup) |
|---|---|
| Clients, Bills, Payments, WebhookPayments | admin/staff **users** |
| Support tickets ও reply | `django_migrations` |
| Accounting transactions (Journal/Income/Expense) | Zone / SubZone / Box / Package / Type |
| OLT signals, ONU, SNMP logs | Chart of Accounts + Account types |
| HR payroll, attendance, collector cash | role permissions |
| Sales / Purchase / POP / Assets / Inventory | Mikrotik / RADIUS **servers** |
| Tasks, SMS logs, activity logs | RADIUS group profiles (`nas`, `radgroupreply`, `radgroupcheck`) |
| RADIUS client টেবিল (`radacct`, `radcheck`, `radreply`, `radusergroup`, `radpostauth`) | company / system settings, categories |

---

## Reset-এর পর করণীয়
1. Admin login করুন (user অক্ষত আছে)।
2. নতুন (production) data দিয়ে শুরু করুন — অথবা Bulk Import দিয়ে client আনুন।
3. Config (Zone/Package/Server) আগের মতোই আছে — আবার সেট করতে হবে না।

---

*নোট: এই command production-safe — child→parent order, `FOREIGN_KEY_CHECKS=0`,
DELETE + `AUTO_INCREMENT=1` reset ব্যবহার করে। তবুও **সবসময় আগে backup নিন**।*
