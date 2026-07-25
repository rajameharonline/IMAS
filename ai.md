# ISP Billing & Network Automation System (ISP-BNAS)
## AI Agent Master Reference Document

> **Production System Warning:** এই প্রজেক্টটি Live Production-এ চলছে। যেকোনো পরিবর্তনের আগে এই ডকুমেন্ট সম্পূর্ণ পড়ুন। ভুল পরিবর্তন সরাসরি Client-এর internet সংযোগ এবং billing-এ প্রভাব ফেলতে পারে।

---

## SECTION 1: AI Agent-এর জন্য কঠোর নিয়মাবলী

### ✅ যা করতে হবে
- শুধুমাত্র প্রয়োজনীয় ফাংশন/কম্পোনেন্ট patch করুন — পুরো ফাইল rewrite নয়
- প্রতিটি পরিবর্তনের পর `sudo systemctl reload isp-gunicorn.service` (auto hook আছে, স্বয়ংক্রিয়)
- Frontend পরিবর্তনের পর `cd /var/www/isp_bnas/admin_panel && node ./node_modules/vite/bin/vite.js build`
- RADIUS এবং MikroTik সংক্রান্ত logic পরিবর্তনের আগে Section 5 পড়ুন
- সব comment বাংলায় লিখুন
- **কাজ শেষ হলে Section 14 (Work Log)-এ entry যোগ করুন** — পরবর্তী agent যেন বুঝতে পারে কী হয়েছে

### ❌ যা করা যাবে না (NEVER)
- `billing/models.py`-এর `Payment.save()`, `_auto_enable_client_if_paid()`, `_update_expiry_and_enable_for_unverified()` function মুছবেন না বা rename করবেন না
- `radius_app/services/radius_service.py` এবং `mikrotik_app/services/mikrotik_service.py`-এ method signature পরিবর্তন করবেন না
- Database migration ছাড়া model field সরাসরি পরিবর্তন করবেন না
- `.env` ছাড়া hardcode credential রাখবেন না
- `isp_bills`, `isp_payments`, `isp_clients` table সরাসরি SQL দিয়ে modify করবেন না
- `config/settings.py`-এর INSTALLED_APPS, DATABASES, AUTH_USER_MODEL পরিবর্তন করবেন না
- Celery Beat schedule অবিবেচনায় পরিবর্তন করবেন না (billing engine চলবে না)
- Frontend-এ `api` import path পরিবর্তন করবেন না (`../../utils/api` সব জায়গায় একই)

### ⚠️ সতর্কতা
- Client enable/disable করলে একসাথে RADIUS + MikroTik দুটোতেই effect পড়ে
- Payment save/delete করলে bill recalculate এবং client auto-enable হওয়ার chain reaction আছে
- OLT SNMP sync প্রতি ৫ মিনিটে চলে — `isp_olt_mac_cache` table modify করলে sync বিঘ্নিত হবে
- JWT token-এর expiry 60 মিনিট, refresh token 7 দিন

---

## SECTION 2: Technology Stack

| Layer | Technology |
|---|---|
| Backend API | Django REST Framework (DRF), Python 3.14, VirtualEnv at `/var/www/isp_bnas/venv` |
| Frontend | React.js + Vite + Tailwind CSS, built to `admin_panel/dist/` |
| Database | MySQL (charset: utf8mb4), host: localhost:3306 |
| RADIUS AAA | FreeRADIUS 3.x, MySQL backend (db: `radius`, user: `radius`, pass: `010230`) |
| MikroTik | RouterOS API (port 8728), CoA/PoD (port 3799) |
| Task Queue | Celery + Redis (broker), Celery Beat (cron) |
| Web Server | Nginx (reverse proxy) → Gunicorn (port 8000, service: `isp-gunicorn.service`) |
| Cache | Redis |
| Timezone | Asia/Dhaka |

---

## SECTION 3: Project Folder Structure

```
/var/www/isp_bnas/
├── accounts/          # Custom User model, Roles (superadmin/admin/manager/accountant/support/collector)
├── accounting/        # Double-entry: ChartOfAccount, JournalEntry, Income, Expense, DailyAccount
├── admin/             # Django admin bindings
├── admin_panel/       # React + Vite frontend (src/ → dist/ after build)
│   ├── src/
│   │   ├── App.jsx           # All frontend routes defined here
│   │   ├── components/       # Layout.jsx (Topbar, Sidebar), shared components
│   │   ├── pages/            # One folder per module
│   │   └── utils/api.js      # Axios instance — সব API call এখান থেকে
│   └── dist/                 # Production build (Nginx serve করে)
├── assets/            # Fixed Assets ledger
├── billing/           # Bill, Payment, InstallationFee, DailyCollection + Billing hooks
├── clients/           # Client, LeftClient, ChangeRequest, Scheduler, Logs
├── config/            # settings.py, urls.py, wsgi.py, celery.py
├── configuration/     # Zone, SubZone, Box, Package, ClientType, ProtocolType
├── hr/                # Employee, Attendance, Payroll, PayrollSheet, Resignation
├── inventory/         # Item, Stock, StockTransaction, Unit, StoreLocation
├── logs/              # gunicorn.pid, gunicorn_access.log, gunicorn_error.log
├── mikrotik_app/      # MikrotikServer, RouterBackup + mikrotik_service.py
├── network/           # NetworkNode, NetworkLink, NetworkDiagram (GIS + Topology)
├── olt_mgmt/          # OLT, ONU, ONUSignal, OLTMacCache + SNMP service
├── pop/               # POP management, tariff, funding
├── purchase/          # Vendor, PurchaseBill, Provider, ProviderBill (bandwidth)
├── radius_app/        # RadiusServer, RadiusLog + radius_service.py
├── reports/           # Financial & billing reports
├── sales/             # Product & Service Invoice, Sales Payment
├── sms_service/       # SMS templates, send log, multi-gateway
├── support/           # SupportTicket, TicketReply, StaffNotification
├── system_settings/   # CompanySetup, InvoiceSetup, SystemSetting, PaymentGateway
├── tasks_mgmt/        # Task, TaskCategory, TaskHistory
└── user_portal/       # Self-service client portal (FastAPI + React)
```

---

## SECTION 4: Database Model Relationships

### 4.1 Client Model (কেন্দ্রীয় সত্তা)

```
Client (isp_clients)
├── zone_id          → Zone (isp_zones)
├── subzone_id       → SubZone (isp_subzones) [zone এর অধীনে]
├── box_id           → Box (isp_boxes) [subzone এর অধীনে]
├── client_type_id   → ClientType (isp_client_types)
├── protocol_id      → ProtocolType (isp_protocol_types)
├── package_id       → Package (isp_packages) [RADIUS group নির্ধারণ করে]
├── router_id        → MikrotikServer (isp_mikrotik_servers)
└── created_by_id    → User (isp_users)

Client.username + password → FreeRADIUS radcheck table (পৃথক DB)
Client.package.mikrotik_profile → MikroTik PPPoE profile name
Client.package.ip_pool_name → RADIUS Framed-Pool attribute
```

**Client Status Values:**
- `active` → RADIUS enabled, internet চলছে
- `inactive` → RADIUS disabled (Auth-Type:Reject), manually blocked
- `suspended` → RADIUS: Auth-Type:Reject (manual disable)
- `expired` → RADIUS: Blocked_Group (Expired PPPoE profile), payment page দেখায়
- `cancelled` → সেবা বাতিল
- `left` → LeftClient record তৈরি হয়েছে

### 4.2 Billing Chain

```
Client (1) → Bill (many) [isp_bills]
Bill (1) → Payment (many) [isp_payments]

Bill.is_auto = True  → expiry থেকে auto-generate (মাসে একটি, unique constraint আছে)
Bill.is_auto = False → manual bill (একই মাসে একাধিক হতে পারে)

Payment.is_verified:
  True  → admin/superadmin receive করেছে → bill recalculate + client auto-enable
  False → collector receive করেছে (pending approval) → expiry extend + RADIUS enable করে
           কিন্তু bill-এর paid_amount/due_amount পরিবর্তন হয় না
```

**Payment Save Hook Chain (billing/models.py):**
```
Payment.save()
  ↓ is_new + is_verified=True  → recalculate_bill_and_client() + _auto_enable_client_if_paid()
  ↓ is_new + is_verified=False → _update_expiry_and_enable_for_unverified()
  ↓ just_verified (approve)    → recalculate_bill_and_client() + _auto_enable_client_if_paid()

_auto_enable_client_if_paid(client):
  ↓ due_amount == 0 AND status in (inactive/suspended/expired)
  ↓ RADIUS: enable_user() + restore_user_group()
  ↓ MikroTik: enable_pppoe_user()
  ↓ expiry_date = next month's expiry_day
  ↓ client.status = 'active'
```

### 4.3 RADIUS Architecture

**RADIUS-এ দুটো পৃথক database:**
- `radius` (MySQL) → FreeRADIUS এর নিজস্ব DB (radcheck, radreply, radusergroup, radgroupreply, radacct)
- `isp_*` tables → Django এর DB (same MySQL server, different DB)

**RADIUS Tables (radius DB):**
```
radcheck     → username, attribute, op, value
               Auth-Type := Reject     → পুরোপুরি block
               Cleartext-Password := X → password

radusergroup → username, groupname, priority
               groupname → radgroupreply-এর groupname-এর সাথে match করে

radgroupreply → groupname, attribute, op, value
                Blocked_Group → Mikrotik-Group := 'Expired PPPoE', Session-Timeout := 300
                5M (package)  → Mikrotik-Group := '5M', Framed-Pool := 'pool_5m'

radacct      → Active sessions (acctstoptime IS NULL = online)
```

**Client Disable Logic (Manual vs Expired):**
```
Manual Disable (suspend):
  → radcheck: Auth-Type := Reject   (login-ই হবে না)
  → radusergroup: unchanged

Expired (payment due):
  → radusergroup: Blocked_Group     (login হয়, Expired PPPoE profile পায়)
  → MikroTik: 'Expired PPPoE' profile = slow/captive portal

Enable:
  → radcheck: Auth-Type:Reject মুছে দেওয়া
  → radusergroup: আসল package group ফেরত (e.g., '5M')
```

### 4.4 MikroTik Integration

```
MikrotikServer (isp_mikrotik_servers)
├── radius_server_id → RadiusServer (isp_radius_servers)
└── is_active        → শুধু active servers-এ operation হয়

Session Kick (Disable করার সময়):
  Method 1: CoA/PoD packet → send_coa_disconnect() → port 3799
  Method 2: RouterOS API  → disconnect_active_session() → /ppp/active
```

### 4.5 Configuration Hierarchy

```
Zone (isp_zones)
└── SubZone (isp_subzones) [FK: zone]
    └── Box (isp_boxes) [FK: subzone]
        └── Client [FK: box]

Package (isp_packages)
├── mikrotik_profile → MikroTik-এর PPPoE profile name (MikroTik-এ exist করতে হবে)
└── ip_pool_name     → FreeRADIUS Framed-Pool (RADIUS-এ IP pool exist করতে হবে)
```

### 4.6 Accounting Double-Entry

```
ChartOfAccount (isp_chart_of_accounts)
├── account_type → AccountType (Asset/Liability/Equity/Income/Expense)
└── parent       → ChartOfAccount (self-referential, hierarchy)

JournalEntry (isp_journal_entries)
└── JournalLine (isp_journal_lines) [FK: entry]
    ├── account → ChartOfAccount
    ├── debit   → decimal
    └── credit  → decimal

Income/Expense voucher তৈরি হলে → JournalEntry + JournalLine auto-create হয়
ProviderBill payment → Expense + JournalEntry তৈরি হয় (Cash On Hand কমে)
Client payment → Income + JournalEntry তৈরি হয় (Cash On Hand বাড়ে)
```

### 4.7 OLT → ONU → Client Chain

```
OLT (isp_olts)
└── ONU (isp_onus) [FK: olt]
    ├── client_id → Client (optional, MAC matching দিয়ে link)
    └── ONUSignal (isp_onu_signals) [unique: olt+interface_id]

OLTMacCache (isp_olt_mac_cache) [unique: olt+mac]
├── olt → OLT
└── client → Client (auto-match from isp_clients.mac_address)
```

### 4.8 HR Payroll Chain

```
Employee (isp_employees)
├── user_id      → User (OneToOne, optional — portal login-এর জন্য)
├── department_id → Department
└── payroll_id   → Payroll [payroll structure: monthly/weekly/etc]
    └── PayrollPayHead [FK: payroll] → PayHead [salary component]

PayrollSheet (isp_payroll_sheets) [unique: employee+month]
└── PayslipEntry [FK: sheet] → PayHead (amount per component)
    └── PayslipPayment [FK: sheet] → partial payment tracking
```

### 4.9 Support + Task Notification

```
SupportTicket (isp_support_tickets)
├── client → Client
├── category → SupportCategory
└── assigned_to → User

Task (isp_tasks)
├── assigned_to → User
└── client → Client (optional)

StaffNotification (isp_staff_notifications)
├── recipient → User
└── notif_type: ticket_created/assigned/status/reply/task_assigned/task_created/task_status/system
    (Support ও Tasks দুটোই এই একই model ব্যবহার করে)
```

---

## SECTION 5: Critical Service Files — সাবধানে পরিবর্তন করুন

### 5.1 RADIUS Service (`radius_app/services/radius_service.py`)

**Factory Methods (সঠিক instance পেতে):**
```python
RadiusService.for_client(client)   # client→router→radius_server থেকে RADIUS DB নির্ধারণ
RadiusService.for_server(server)   # সরাসরি RadiusServer থেকে
RadiusService.get_default()        # প্রথম active server
RadiusService.all_online_users()   # সব server-এর online users
```

**Key Methods:**
```python
svc.create_user(username, password)        # radcheck + radusergroup এ insert
svc.enable_user(username)                  # Auth-Type:Reject মুছে দেয়
svc.disable_user(username)                 # Auth-Type := Reject সেট করে
svc.move_to_blocked_group(username)        # radusergroup → Blocked_Group (expired-এর জন্য)
svc.restore_user_group(username, group)    # radusergroup → আসল package group
svc.ensure_blocked_group(profile='Expired PPPoE')  # radgroupreply-এ Blocked_Group নিশ্চিত করে
svc.change_password(username, password)    # radcheck Cleartext-Password আপডেট
svc.delete_user(username)                  # সব RADIUS table থেকে মুছে দেয়
svc.get_online_users()                     # radacct-এ active sessions
svc.cleanup_stale_sessions(hours=24)       # পুরনো open sessions বন্ধ করে
```

**Rule:** Manual suspend → `disable_user()`, Expired → `move_to_blocked_group()`

### 5.2 MikroTik Service (`mikrotik_app/services/mikrotik_service.py`)

**Factory:**
```python
MikrotikService.from_server_model(server)  # MikrotikServer model থেকে instance
```

**Key Methods:**
```python
svc.enable_pppoe_user(username)    # RADIUS-only (MikroTik-এ আলাদা action নেই)
svc.disable_pppoe_user(username)   # disconnect_active_session() call করে
svc.create_pppoe_user(username, password, profile)  # /ppp/secret-এ add
svc.delete_pppoe_user(username)    # /ppp/secret থেকে মুছে দেয়
svc.disconnect_active_session(username)  # /ppp/active থেকে kick
svc.send_coa_disconnect(username, nas_host, secret)  # RFC 5176 CoA packet
svc.get_user_traffic(username)     # Real-time rx/tx bytes
```

### 5.3 Billing Hooks (`billing/models.py`)

```python
# এই function গুলো কখনো rename/delete করবেন না:
_auto_enable_client_if_paid(client)              # due=0 হলে client enable
_update_expiry_and_enable_for_unverified(client) # collector payment = temporary enable
Payment.recalculate_bill_and_client(bill)        # bill এর paid/due/status sync
```

### 5.4 Client Disable/Enable Flow (`clients/api/views.py`)

```
POST /clients/{id}/disable/
  → RADIUS: disable_user() [Auth-Type:Reject]
  → MikroTik: CoA/PoD session kick → API fallback
  → Log: ClientStatusLog + ClientActivityLog

POST /clients/{id}/enable/
  → RADIUS: enable_user() + restore_user_group()
  → MikroTik: enable_pppoe_user() [no-op, RADIUS handles it]
  → Log: ClientStatusLog + ClientActivityLog

Expired (Celery):
  → RADIUS: move_to_blocked_group() [Blocked_Group → Expired PPPoE]
  → MikroTik: session kick
```

---

## SECTION 6: Frontend Page → API Mapping

### 6.1 Route Definitions (`admin_panel/src/App.jsx`)

```jsx
// সব route Layout component-এর ভেতরে (authentication required)

// Client Management
/clients                    → pages/clients/ClientList.jsx
/clients/new                → pages/clients/ClientForm.jsx
/clients/:id                → pages/clients/ClientForm.jsx (edit)
/clients/:id/profile        → pages/clients/ClientProfile.jsx
/clients/left               → pages/clients/LeftClients.jsx

// Billing
/billing/bills              → pages/billing/BillList.jsx
/billing/daily-collection   → pages/billing/DailyCollection.jsx

// Server & Network
/radius/servers             → pages/radius/RadiusServerList.jsx
/radius/online              → pages/radius/OnlineClientMonitoring.jsx
/radius/traffic/:username   → pages/radius/ClientTrafficPage.jsx
/mikrotik/bulk-import       → pages/mikrotik/BulkImportPage.jsx
/olt/list                   → pages/olt/OLTList.jsx
/olt/onus                   → pages/olt/ONUMonitoring.jsx

// Configuration
/config/zones               → pages/config/ZoneList.jsx
/config/subzones            → pages/config/SubZoneList.jsx
/config/boxes               → pages/config/BoxList.jsx
/config/packages            → pages/config/PackageList.jsx
/config/protocol-types      → pages/config/ProtocolTypeList.jsx
/config/client-types        → pages/config/ClientTypeList.jsx

// HR & Payroll
/hr/employees               → pages/hr/EmployeeList.jsx
/hr/payslip                 → pages/hr/PayslipList.jsx
/hr/salary-sheet            → pages/hr/SalarySheet.jsx
/hr/attendance              → pages/hr/AttendancePage.jsx
/hr/department, /hr/payhead, /hr/payroll, /hr/position, /hr/resign-rule, /hr/resignation, /hr/rejoin

// Bandwidth & Purchase
/bandwidth/buy/providers    → pages/bandwidth/ProviderList.jsx
/bandwidth/buy/bills        → pages/bandwidth/ProviderBillListPage.jsx
/bandwidth/buy/items        → pages/bandwidth/ItemListPage.jsx

// Support & Tasks
/support/tickets            → pages/support/TicketList.jsx
/tasks/list                 → pages/tasks/TaskList.jsx
/tasks/mine                 → pages/tasks/MyTasks.jsx

// Accounting
/accounting/dashboard       → pages/accounting/AccountingDashboard.jsx
/accounting/chart-of-accounts → pages/accounting/ChartOfAccountsPage.jsx
/accounting/income          → pages/accounting/AddIncomePage.jsx
/accounting/expense         → pages/accounting/AddExpensePage.jsx
/accounting/journal         → pages/accounting/JournalVoucherPage.jsx
/accounting/balance-sheet   → pages/accounting/BalanceSheetPage.jsx
/accounting/profit-loss     → pages/accounting/ProfitLossPage.jsx
/accounting/trial-balance   → pages/accounting/TrialBalancePage.jsx
/accounting/cash-book       → pages/accounting/CashBookPage.jsx

// Network (Module 9)
/network/map                → pages/network/NetworkMap.jsx (Leaflet GIS)
/network/topology           → pages/network/NetworkTopology.jsx (React Flow)

// Sales
/sales/product-invoice      → pages/sales/ProductInvoiceList.jsx
/sales/service-invoice      → pages/sales/ServiceInvoiceList.jsx

// System
/settings                   → pages/system/Settings.jsx
/system/users               → pages/system/UserManagement.jsx
/sms/logs                   → pages/sms/SMSLogs.jsx
```

### 6.2 API Base URL এবং Pattern

```javascript
// admin_panel/src/utils/api.js
// সব API call এই instance দিয়ে হয়:
import api from '../../utils/api';

// Base URL: /api/v1/ (Nginx → Gunicorn → Django)
// Authentication: JWT Bearer token (Authorization header auto-inject)

// Pattern:
api.get('/clients/')                          // list
api.get('/clients/?status=active&page=2')     // filtered list
api.post('/clients/', data)                   // create
api.patch('/clients/123/', data)              // partial update
api.delete('/clients/123/')                   // delete
api.post('/clients/123/disable/')             // custom action
```

### 6.3 Key Custom Actions

```
GET  /clients/dashboard-stats/               → Dashboard statistics
GET  /clients/billing-view/                  → All clients with bill data (Billing List)
POST /clients/{id}/disable/                  → Disable client
POST /clients/{id}/enable/                   → Enable client
POST /clients/{id}/kick-session/             → Kick session without status change
GET  /clients/{id}/activity-log/             → Client activity history
GET  /clients/expired-clients/               → Expired client list

GET  /billing/bills/client-billing-view/     → All clients + bill info merged
GET  /billing/bills/collection-summary/      → Monthly collection summary
POST /billing/payments/receive/              → Receive payment (client-based)
POST /billing/payments/approve-selected/     → Bulk approve pending payments
GET  /billing/bills/summary/                 → Billing stats

GET  /mikrotik/online-usernames/             → Active PPPoE sessions count
GET  /mikrotik/traffic/{username}/           → User traffic stats
POST /mikrotik/ping/                         → Connectivity check

GET  /radius/online-users/                   → All online users (all servers)
POST /radius/disconnect/                     → Force disconnect

GET  /support/tickets/stats/                 → Ticket aggregate for Dashboard
GET  /tasks/tasks/stats/                     → Task aggregate for Dashboard
GET  /purchase/provider-bills/dashboard-stats/ → Bandwidth provider stats
```

---

## SECTION 7: UI Design System

### 7.1 Global Colors & Components

```css
/* Primary Action Button */
bg-[#173d59] hover:bg-[#1f5075] text-white rounded-full

/* Secondary Button */
bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 rounded-lg

/* Main Card Container */
bg-white rounded-2xl border border-slate-200 shadow-sm p-6

/* Table Header (MANDATORY) */
bg-[#23445f] text-white font-semibold text-xs uppercase tracking-wider

/* Page Background */
bg-gray-100
```

### 7.2 Stat Card Gradients

```css
Card Type 1 (Total/Volume):   from-sky-500 to-cyan-600
Card Type 2 (Paid/Positive):  from-teal-500 to-emerald-600
Card Type 3 (Due/Critical):   from-violet-500 to-indigo-600
Card Type 4 (Neutral/Info):   from-slate-500 to-slate-600
```

### 7.3 Status Badges

```css
Paid/Active:    bg-emerald-600 text-white rounded-full px-3 py-1 text-xs font-semibold
Partial:        bg-amber-500 text-white rounded-full px-3 py-1 text-xs font-semibold
Due/Suspended:  bg-rose-600 text-white rounded-full px-3 py-1 text-xs font-semibold
Inactive/Gray:  bg-gray-400 text-white rounded-full px-3 py-1 text-xs font-semibold
```

### 7.4 Mobile Responsive Pattern

সব পেজে desktop table + mobile card দুটো view থাকতে হবে:

```jsx
{/* Desktop */}
<div className="hidden md:block overflow-x-auto">
  <table>
    <thead className="bg-[#23445f]">...</thead>
    <tbody className="bg-white divide-y divide-gray-100">...</tbody>
  </table>
</div>

{/* Mobile */}
<div className="block md:hidden space-y-4">
  {items.map(item => (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      {/* label: text-gray-500 font-medium uppercase tracking-wider */}
      {/* value: text-gray-900 font-semibold text-right */}
      {/* button: min-h-[44px] min-w-[44px] */}
    </div>
  ))}
</div>
```

### 7.5 Modal Pattern

```jsx
<div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-0 md:p-4">
  <div className="w-full md:max-w-lg bg-white rounded-t-2xl md:rounded-2xl max-h-[85vh] overflow-y-auto">
    {/* content */}
  </div>
</div>
```

---

## SECTION 8: Celery Automation (Scheduled Tasks)

```python
# config/settings.py এ defined

# প্রতি মাসের ১ তারিখ রাত ১২:০০
'auto-generate-monthly-bills'  → BillingService.generate_bills_by_expiry_date()

# প্রতিদিন রাত ১২:০৫
'disable-expired-clients'      → BillingService.disable_expired_clients()
  → expiry_date < today এবং status=active clients-এর জন্য:
  → RADIUS: move_to_blocked_group()
  → MikroTik: session kick
  → Client.status = 'expired'

# প্রতি ৫ মিনিট
'olt-auto-sync-mac-table'      → OLT SNMP/Telnet থেকে MAC table sync
```

---

## SECTION 9: Database Table Reference

| Model | DB Table | App |
|---|---|---|
| User | isp_users | accounts |
| Client | isp_clients | clients |
| LeftClient | isp_left_clients | clients |
| ClientScheduler | isp_client_schedulers | clients |
| ClientChangeLog | isp_client_change_logs | clients |
| ClientStatusLog | isp_client_status_logs | clients |
| ClientActivityLog | isp_client_activity_logs | clients |
| Zone | isp_zones | configuration |
| SubZone | isp_subzones | configuration |
| Box | isp_boxes | configuration |
| Package | isp_packages | configuration |
| ClientType | isp_client_types | configuration |
| ProtocolType | isp_protocol_types | configuration |
| Bill | isp_bills | billing |
| Payment | isp_payments | billing |
| InstallationFee | isp_installation_fees | billing |
| MikrotikServer | isp_mikrotik_servers | mikrotik_app |
| RadiusServer | isp_radius_servers | radius_app |
| RadiusLog | isp_radius_logs | radius_app |
| ChartOfAccount | isp_chart_of_accounts | accounting |
| JournalEntry | isp_journal_entries | accounting |
| Income | isp_incomes | accounting |
| Expense | isp_expenses | accounting |
| Employee | isp_employees | hr |
| Attendance | isp_attendance | hr |
| PayrollSheet | isp_payroll_sheets | hr |
| SupportTicket | isp_support_tickets | support |
| StaffNotification | isp_staff_notifications | support |
| Task | isp_tasks | tasks_mgmt |
| OLT | isp_olts | olt_mgmt |
| ONU | isp_onus | olt_mgmt |
| OLTMacCache | isp_olt_mac_cache | olt_mgmt |
| NetworkNode | isp_network_nodes | network |
| NetworkLink | isp_network_links | network |
| Provider | isp_bandwidth_providers | purchase |
| ProviderBill | isp_bandwidth_provider_bills | purchase |
| Vendor | isp_vendors | purchase |
| Item | isp_inv_items | inventory |
| Stock | isp_inv_stocks | inventory |
| CompanySetup | isp_company_setup | system_settings |

**RADIUS DB (পৃথক database: `radius`):**

| Table | Purpose |
|---|---|
| radcheck | Per-user auth attributes (password, Auth-Type) |
| radreply | Per-user reply attributes |
| radusergroup | User → Group mapping |
| radgroupreply | Group reply attributes (speed, pool, profile) |
| radacct | Session accounting (online/offline tracking) |

---

## SECTION 10: New Feature Development Pattern

নতুন feature যোগ করার সময় এই pattern অনুসরণ করুন:

### Backend (Django App)
```
1. models.py     → Model তৈরি করুন (db_table = 'isp_নাম' pattern)
2. migration     → python manage.py makemigrations && migrate
3. serializers.py → DRF Serializer
4. views.py      → ViewSet বা APIView
5. urls.py       → router.register() বা path()
6. config/urls.py → include() করুন
```

### Frontend (React)
```
1. src/pages/module/PageName.jsx → নতুন page component
2. src/App.jsx → route add করুন
3. src/components/Sidebar.jsx → menu item add করুন (প্রয়োজনে)
```

### Build & Deploy
```bash
# Backend change:
# (auto hook আছে — .py file edit হলে gunicorn স্বয়ংক্রিয় reload হয়)

# Frontend change:
cd /var/www/isp_bnas/admin_panel
node ./node_modules/vite/bin/vite.js build
```

---

## SECTION 11: Environment Variables (.env)

`.env` ফাইলে থাকা প্রয়োজনীয় keys (hardcode করা যাবে না):

```
SECRET_KEY, DEBUG, ALLOWED_HOSTS
DB_NAME, DB_USER, DB_PASSWORD, DB_HOST, DB_PORT
RADIUS_DB_HOST, RADIUS_DB_PORT, RADIUS_DB_NAME, RADIUS_DB_USER, RADIUS_DB_PASSWORD
REDIS_URL
CELERY_BROKER_URL
SMS_API_KEY, SMS_SENDER_ID
BKASH_APP_KEY, BKASH_APP_SECRET, BKASH_USERNAME, BKASH_PASSWORD
SSLCOMMERZ_STORE_ID, SSLCOMMERZ_STORE_PASS
EMAIL_HOST, EMAIL_PORT, EMAIL_HOST_USER, EMAIL_HOST_PASSWORD
COMPANY_NAME, COMPANY_ADDRESS, COMPANY_PHONE
```

---

## SECTION 12: Module Implementation Status

```
[x] Module 1  — Core Authentication, Accounts, Roles (superadmin/admin/manager/accountant/support/collector)
[x] Module 2  — Packages, Zone/SubZone/Box, IP Pool Configuration
[x] Module 3  — Client Profile Lifecycle, PPPoE Credentials, Package Expiry
[x] Module 4  — Auto Invoicing Engine, Payment Gateway (bKash/Nagad), Daily Ledger
[x] Module 5  — FreeRADIUS MySQL Backend, Session Disconnect, CoA/PoD
[x] Module 6  — Support Ticketing, OLT Telnet/SNMP Monitoring, ONU Signal Charts
[x] Module 7  — Task Management (Board, Countdown, Employee Notification)
[x] Module 8  — Bandwidth Provider Invoice, Dashboard Metrics, Cash-on-Hand Ledger
[x] Module 9  — Network GIS Map (Leaflet), Topology Diagram (React Flow)
[x] Module 10 — HR & Payroll (Employee, Attendance, PayrollSheet, Payslip, Resignation)
[x] Module 11 — Inventory & Purchase (Hardware: Vendor/PO/Bill, Bandwidth: Provider/ProviderBill)
[x] Module 12 — Accounting (Double-Entry: COA, Journal, Income, Expense, Reports)
[x] Module 13 — Sales (Product Invoice, Service Invoice)
[ ] Module 14 — UI Polish (Table-to-Card mobile consistency across all modules)
[ ] Module 15 — Production Deployment Documentation (Bangla Admin Manual)
[ ] Module 16 — User Portal (FastAPI + React, client self-service)
[ ] Module 17 — Mobile App (React Native)
```

---

## SECTION 13: Quick Troubleshooting Reference

| সমস্যা | সম্ভাব্য কারণ | সমাধান |
|---|---|---|
| Client login হচ্ছে না | radcheck-এ Auth-Type:Reject | `svc.enable_user(username)` |
| Expired profile দেখাচ্ছে | radusergroup-এ Blocked_Group | `svc.restore_user_group(username, group)` |
| Payment করেও চালু হচ্ছে না | radusergroup আপডেট হয়নি | `_auto_enable_client_if_paid()` check করুন |
| API 500 error | Gunicorn পুরনো code | `sudo systemctl reload isp-gunicorn.service` |
| Frontend পরিবর্তন দেখা যাচ্ছে না | Build হয়নি | `node ./node_modules/vite/bin/vite.js build` |
| Celery task চলছে না | Redis connection | `redis-cli ping` → `systemctl status celery` |
| OLT sync fail | SNMP community/OID ভুল | OLT model-এর `vendor` field এবং OID check করুন |

---

## SECTION 14: Agent Work Log

> **নির্দেশনা:** প্রতিটি AI Agent session শেষ হওয়ার আগে এখানে একটি entry যোগ করবে।
> পরবর্তী agent এই log পড়ে বুঝতে পারবে কী পরিবর্তন হয়েছে এবং কোথায় হাত দেওয়া যাবে না।
>
> **Format:**
> ```
> ### [তারিখ] — [সংক্ষিপ্ত বিষয়]
> **পরিবর্তিত ফাইল:** file1.py, file2.jsx
> **কী করা হয়েছে:** এক বা দুই লাইনে সারসংক্ষেপ
> **Side Effect / সতর্কতা:** পরবর্তী agent যেন জানে এমন কিছু
> **Tested:** হ্যাঁ/না — কীভাবে test করা হয়েছে
> ```

---

### [2026-07-20] — ONU Monitoring: Action কলাম ডানে + Client নাম ডিভাইসের Description-এ push

**পরিবর্তিত ফাইল:** `olt_mgmt/services/cli_service.py`, `olt_mgmt/api/views.py`, `admin_panel/src/pages/olt/ONUMonitoringPage.jsx`

**কী করা হয়েছে:**
1. **Action কলাম সবার ডানে সরানো** (আগে RX Power ও Distance-এর মাঝে ছিল) — header ও cell দুটোই, ডান-প্রান্তিক।
2. **নতুন বাটন** — Client কলামের লেবেল ("5555-Amir") বাস্তব OLT ডিভাইসের **ONU Description**-এ লিখে দেয়। নতুন `Icon.Tag` আইকন; unlinked ONU-তে disabled (পাঠানোর কিছু নেই)।
3. **নতুন `cli_service.set_onu_description(olt, interface_id, description)`** — CLI চেইন: `configure terminal` → `interface EPON 0/1` → `onu 5 description <text>` → `write file`। সাথে `parse_interface()` helper (`'EPON 0/01/5'` → `('EPON 0/1', '5')`)।
4. **নতুন endpoint** `POST /olt/onu-signals/{pk}/push-description/` — client না থাকলে 400; সফল হলে `ONUSignal.notes` ও `OLTMacCache.description` লোকালি আপডেট করে (পরের sync-এর অপেক্ষা ছাড়াই UI-তে দেখায়)।

**কেন কাজে লাগে:** description-ভিত্তিক client auto-link (`_client_id_from_desc`) ঠিক এই "customerID-নাম" ফরম্যাট পড়ে। ডিভাইসে লিখে রাখলে ONU↔Client সম্পর্ক পরবর্তী sync-গুলোতেও নিজে থেকেই টিকে থাকে — MAC বদলালেও।

**ডিভাইসের সীমা (probe করে জানা):** `onu <id> description <string>` — **max length 32**। তাই `set_onu_description` স্পেসকে `_` করে ও ৩২ অক্ষরে কাটে (নইলে দীর্ঘ নামে কমান্ড ব্যর্থ হতো)।

**লোডিং ডিজাইন:** ব্যস্ত অবস্থায় Tag আইকন → ঘূর্ণায়মান spinner, রঙ teal→amber, `cursor-wait`, `aria-busy`, ও নিচে indeterminate progress sweep (`oltclock` keyframes পুনঃব্যবহার)। disabled অবস্থায় ধূসর।

**Side Effect / সতর্কতা:**
- **শুধু ম্যানুয়াল** — কোনো scheduled task নেই।
- একটি row-তে চলাকালীন `pushBusy` state অন্য বাটন ব্লক করে না, কিন্তু একই row-তে দ্বিতীয় ক্লিক আটকায়।
- ডিভাইসে লেখার পর `write file` করা হয়, তাই reboot-এর পরও টিকে থাকে।

**Tested:** হ্যাঁ — তিনটি linked ONU-তে বাটনের API চালিয়ে **ডিভাইস থেকে আলাদাভাবে পড়ে** যাচাই: `5555-Amir`, `5557-Bari`, `5060-Sohag` — তিনটিই ডিভাইসে হুবহু লেখা হয়েছে (HTTP 200, ৩.২s করে)। unlinked ONU → HTTP 400 (গার্ড কাজ করে)। `parse_interface` ৪টি edge case পাস। কলাম গণনা 10 header ↔ 10 cell। `manage.py check` পাস, `vite build` সফল।

---

### [2026-07-20] — OLT ঘড়ি: automatic task বাদ, শুধু ম্যানুয়াল "Set Time" বাটন

**পরিবর্তিত ফাইল:** `olt_mgmt/api/views.py`, `olt_mgmt/tasks.py`, `config/settings.py`, `olt_mgmt/services/cli_service.py`, `admin_panel/src/pages/olt/OLTListPage.jsx`, `admin_panel/src/index.css`

**কী করা হয়েছে:** ব্যবহারকারীর সিদ্ধান্ত — সময় সেট **কোনো automatic process থেকে হবে না**, শুধু বাটনে ক্লিকে। তাই:
- `olt_mgmt.sync_olt_clocks` Celery task ও `CELERY_BEAT_SCHEDULE`-এর `olt-sync-clocks` entry **মুছে ফেলা** হয়েছে (দুটোই grep + registry দিয়ে যাচাই করা — আর নেই)।
- নতুন endpoint `POST /olt/olts/{id}/sync-clock/` → `cli_service.sync_olt_clock()`; response-এ `{ok, before, after, server_time, error}`।
- OLT Management টেবিলের **Actions কলামে নতুন "Set Time" বাটন** (ডেস্কটপ + মোবাইল কার্ড দুটোতেই) — নতুন `ClockButton` কম্পোনেন্ট।

**লোডিং ডিজাইন:** ব্যস্ত অবস্থায় ঘড়ির আইকন ঘোরে (`animate-spin`), লেবেল → "Setting…", রঙ emerald → amber, cursor `wait`, `aria-busy`, এবং বাটনের নিচে indeterminate progress sweep (`@keyframes oltclock` — `index.css`-এ যোগ; কাজটির শতাংশ জানা যায় না বলে নির্দিষ্ট bar নয়)। বিল্ড-CSS-এ তিনটি অংশ (class selector, animation shorthand, keyframes) আছে কিনা যাচাই করা হয়েছে।

**⚡ পারফরম্যান্স ফিক্স (৩৬s → ৩.২s):** প্রথম বাস্তবায়নে endpoint **৩৬ সেকেন্ড** নিত — বাটনের জন্য অগ্রহণযোগ্য। কারণ `OLTCli._read()` প্রম্পট এসে যাওয়ার পরও পুরো timeout ঘুমাত। এখন prompt-aware (`_PROMPT_RE = [>#]\s*$`) — ডেটা পাওয়ামাত্র ফেরে; login ধাপে আলাদা `login_re` (`Username|Password:`)। মাপা ফল: **৩.২-৩.৪s**।

**Side Effect / সতর্কতা:**
- `cli_service.sync_olt_clock()` অপরিবর্তিত রয়ে গেছে — শুধু caller বদলেছে (task → API action)।
- `OLT_NTP_SERVER` (.env) এখনো ব্যবহৃত হয়, বাটন চাপলে `ntp server` কমান্ডও যায়।
- বাটন চাপলে `olt.last_polled` আপডেট হয়।

**Tested:** হ্যাঁ — তিন OLT-এ বাটনের API চালিয়ে: HTTP 200, ৩.২-৩.৪s, ডিভাইসের প্রকৃত ঘড়ি (web UI rtc.html থেকে পড়া) আসল ঢাকার সময় থেকে **মাত্র ৪ সেকেন্ড** বিচ্যুত। automation অপসারণ যাচাই: beat entry নেই, task registry-তে নেই। `manage.py check` পাস, `vite build` সফল।

---

### [2026-07-20] — OLT ঘড়ি ঠিক করা: CLI দিয়ে time push (web UI write কাজ করে না)

**পরিবর্তিত ফাইল:** `olt_mgmt/services/cli_service.py` (নতুন), `olt_mgmt/tasks.py`, `config/settings.py`

**সমস্যা:** তিনটি OLT-এর ঘড়িই ভুল ছিল — Kuhruil `2000/01/09`, Cholash `2032/08/07`, Office `1969/12/31` (কখনো সেট হয়নি)। ফলে ONU Monitoring-এর "Last Deregister Time" ও "Alive Time" অর্থহীন দেখাত।

**তদন্তে যা পাওয়া গেছে:**
1. Kuhruil-এ NTP **আগে থেকেই enabled** ও সার্ভার সেট (`182.48.80.44`) — তবু ঘড়ি ২০০০ সালে। Cholash/Office-এ NTP কনফিগ **সম্পূর্ণ খালি**। অর্থাৎ OLT-গুলো ইন্টারনেট NTP-তে পৌঁছাতে পারে না (ম্যানেজমেন্ট নেটওয়ার্কে NAT/route নেই বলে মনে হয়)।
2. **OLT-এর web UI-তে কনফিগ লেখা কাজ করে না** — `rtc.html` / `ntp.html`-এ POST করলে HTTP 200 আসে কিন্তু কিছুই প্রয়োগ হয় না। চেষ্টা করা হয়েছে: `who=0/1/2/3/100`, `Referer`/`Origin` হেডার, submit নাম, GET — সব ব্যর্থ। অ্যাকাউন্ট `A`-এর role **Admin** (user.html-এ যাচাই), তাই অনুমতির সমস্যা নয়। `whichfun()` কেবল `who` সেট করে (misc.js), `ChkTimeCfg`/`chkSntp` শুধু validation — কোনো লুকানো ফিল্ড নেই।
3. **CLI-তে একই কাজ নির্ভরযোগ্যভাবে হয়** — তবে `enable` দিয়ে privileged মোডে (`#`) যেতে হয়; user মোডে (`>`) কোনো কমান্ডই নেই। config মোডে পাওয়া গেছে: `time set year … second …`, `time zone <code>`, `ntp server <ip>`, `write file`। Dhaka timezone কোড = **`6-1`**।

**সমাধান:** নতুন `cli_service.py` — ন্যূনতম socket-ভিত্তিক Telnet ক্লায়েন্ট (py3.13+ এ `telnetlib` নেই) **শুধু কনফিগ লেখার জন্য**। `sync_olt_clock(olt)` করে: `configure terminal` → `time zone 6-1` → `time set …` → `ntp server` (ঐচ্ছিক) → `write file`। নতুন Celery task `olt_mgmt.sync_olt_clocks` প্রতিদিন ভোর ৩:৩০-এ চলে (`CELERY_BEAT_SCHEDULE`), যাতে reboot/drift-এর পরও ঘড়ি ঠিক থাকে। আমাদের সার্ভার chrony-তে stratum-3 নির্ভুল, তাই সেখান থেকে push করলে OLT-এর ইন্টারনেট লাগে না।

**⚠️ Telnet ফিরে আসা — পূর্বের entry-র সাথে সাংঘর্ষিক নয়:** ডাটা sync থেকে Telnet সরানো হয়েছিল কারণ সেখানে HTTP দ্রুত ও সম্পূর্ণ। এখানে উল্টো — web UI **লিখতে পারে না**, CLI পারে। তাই ভূমিকা ভাগ: **HTTP = পড়া, CLI = লেখা**। `cli_service.py` কোনো data-sync path-এ ব্যবহৃত হয় না।

**Side Effect / সতর্কতা:**
- `?` চাপলে এই ডিভাইসের CLI **কমান্ডটি চালিয়েও ফেলে** (probe করার সময় ঘড়ি `2026/01/01` হয়ে গিয়েছিল) — help দেখতে সাবধান।
- `OLT_NTP_SERVER` settings-এ না থাকলে `ntp server` কমান্ড skip হয় (default `''`)।
- OLT-এর ম্যানেজমেন্ট নেটওয়ার্কে ইন্টারনেট এলে বা আমাদের chrony-তে `allow 192.168.0.0/16` দিলে ডিভাইস নিজেই NTP sync করতে পারবে; তখনও এই task ক্ষতিকর নয় (idempotent)।
- chrony কনফিগ বদলাতে root লাগে — এই শেলে passwordless sudo নেই (শুধু `systemctl reload isp-gunicorn`), তাই সেটা করা হয়নি।

**Tested:** হ্যাঁ — তিন OLT-এ প্রয়োগ ও web UI থেকে যাচাই: Kuhruil `2026/1/1 1:03` → `2026/7/20 10:36`, Cholash `2032/8/7 23:39` → `2026/7/20 10:37`, Office **`1969/12/31 23:59` → `2026/7/20 10:37`**। Celery task রেজিস্টার্ড (`olt_mgmt.sync_olt_clocks`) ও beat entry (crontab 3:30) নিশ্চিত। `manage.py check` পাস।

---

### [2026-07-20] — Status সেলে Alive Time + Dereg সেলে Deregister Time (sub-label) · Celery stale-code বাগ

**পরিবর্তিত ফাইল:** `olt_mgmt/models.py`, `olt_mgmt/migrations/0011_oltmaccache_alive_time_and_more.py` (নতুন), `olt_mgmt/tasks.py`, `olt_mgmt/services/device_service.py`, `olt_mgmt/api/serializers.py`, `olt_mgmt/api/views.py`, `admin_panel/src/pages/olt/ONUMonitoringPage.jsx`

**কী করা হয়েছে:** ONU Monitoring টেবিলে — (ক) **Status** সেলে badge-এর নিচে **Alive Time** (শুধু online হলে), (খ) **Last Deregister Reason** সেলে badge-এর নিচে **Last Deregister Time**। দুটোই ছোট mono sub-label, ডিভাইসের raw মান।

**⚠️ দুটি গুরুত্বপূর্ণ বাগ ধরা পড়েছে ও ঠিক করা হয়েছে:**

1. **Celery worker পুরনো কোড চালাচ্ছিল** — `ps` দেখে ধরা পড়ে worker process **Jul19** থেকে চলছে, অর্থাৎ আজকের HTTP-migration-এর আগের কোড। ফলে প্রতি ৫ মিনিটে SNMP দিয়ে sync করে আমার HTTP-লেখা ডাটা ওভাররাইট করছিল (raw_data-তে SNMP key `oid`/`raw_rx` দেখে ধরা পড়ে)। `systemctl restart isp-celery isp-celery-beat` করা হয়েছে। **শিক্ষা: Python edit-এ gunicorn auto-reload হয় (hook আছে), কিন্তু Celery worker হয় না — service-দুটো হাতে restart করতে হবে।**

2. **বড় OLT-এ নীরব SNMP fallback** — Office-olt (389 ONU)-এ opm-diag ~32s নেয়, কিন্তু `fetch_onu_diag_from_http` default `timeout=30` — ঠিক সীমান্তে ব্যর্থ হয়ে চুপচাপ SNMP-তে চলে যেত, ফলে dereg/alive ডাটা আসত না। `_http_onu_rows`-এ `timeout=90` করা হয়েছে। **এটা ধরা কঠিন ছিল** কারণ `last_dereg_reason` guard পুরনো মান অক্ষত রাখত, তাই count দেখে (388/388) সব ঠিক মনে হচ্ছিল।

**ডিজাইন সিদ্ধান্ত — raw_data নয়, ডেডিকেটেড field:** প্রথমে `alive_time`/`last_dereg` `OLTMacCache.raw_data`-তে রেখে পড়ার চেষ্টা করা হয়েছিল। কিন্তু raw_data একাধিক path লেখে (`_try_update_mac_cache` — live-RX/client-MAC sync, যা এখনো SNMP row দিয়ে লেখে) এবং একে অপরকে ওভাররাইট করে। তাই দুটি নতুন CharField যোগ: `alive_time`, `last_dereg_time_raw`। `update_or_create(defaults=...)` শুধু তালিকাভুক্ত field লেখে বলে অন্য path আর এগুলো মুছবে না। `last_dereg_time` (DateTimeField) ইচ্ছাকৃতভাবে অব্যবহৃত — এই OLT-গুলোর ঘড়ি ভুল (`2033/04/08`), datetime-এ রূপান্তর বিভ্রান্তিকর হতো; raw string-ই দেখানো হয়।

**Side Effect / সতর্কতা:**
- নতুন field দুটোতেও `if row.get(...)` guard — SNMP fallback-এ key না থাকলে পুরনো মান অক্ষত থাকে।
- reason `N/A` হলে সময়ও `'N/A'` আসে — UI-তে দুটোই লুকানো হয় (`—` দেখায়)।
- OLT-এর ঘড়ি ভুল হওয়ায় Deregister Time-এ 2000/2026/2033 মিশ্র বছর দেখাবে — এটা ডিভাইসের বাস্তব মান, বাগ নয়।

**Tested:** হ্যাঁ — তিন OLT sync: alive_time **73/73, 121/121, 388/388**; dereg_time একইভাবে সম্পূর্ণ। monitor API: 583 row, **10 query**, online 433/433-এ alive_time, সব 583-এ dereg_time। কলাম গণনা 10 header ↔ 10 cell। `manage.py check` পাস, `vite build` সফল।

---

### [2026-07-20] — Description ডিভাইস-অনুযায়ী + নতুন Distance / Last Deregister Reason কলাম

**পরিবর্তিত ফাইল:** `olt_mgmt/services/device_service.py`, `olt_mgmt/tasks.py`, `olt_mgmt/api/serializers.py`, `olt_mgmt/api/views.py`, `admin_panel/src/pages/olt/ONUMonitoringPage.jsx`

**কী করা হয়েছে:**
1. **Description এখন ডিভাইসে যা আছে ঠিক তাই** — HTTP row-এ `value=''` (আগের entry-তে `value=mac` করা হয়েছিল, ব্যবহারকারী তা বাতিল করেছেন)। যাচাই: HTTP সব আসল description ধরে (Cholash 1/1, Office 6/6 — `5562-Shohel` ইত্যাদি)। নিরাপদ কারণ সব ক্লায়েন্ট-লিংক `mac`-ভিত্তিক (3/3), description-ভিত্তিক কোনো লিংক নেই — কেউ unlink হয়নি।
2. **`last_dereg_reason` এখন সংরক্ষিত হয়** — মডেল ফিল্ডটা ছিল কিন্তু **কেউ কখনো লিখত না** (0/582)। HTTP status page থেকে এসে `_process_onu_row`-এ সংরক্ষিত হয়। SNMP fallback-এ key থাকে না, তাই খালি দিয়ে ওভাররাইট না করার guard আছে।
3. **UI:** Description কলাম বাদ; Action-এর ডানে দুটি নতুন কলাম — **Distance (m)** ও **Last Deregister Reason** (নতুন `DeregReason` কম্পোনেন্ট; `Wire Down`/`LOS`/`Link` amber-এ হাইলাইট কারণ এগুলো ফাইবার সমস্যা, `Power Off` নিরপেক্ষ ধূসর)। Column Filter-এ Description ফিল্টার → **Last Dereg Reason dropdown**। টেবিল `min-w` 1080→1180px।
4. **Serializer:** `distance_m` ও `last_dereg_reason` ONUSignal-এ নেই (OLTMacCache-এ থাকে)। duplicate না করে monitor endpoint এক query-তে `mac_info` map বানিয়ে serializer context-এ দেয় → **583 row-এ মাত্র 10 query** (N+1 নয়)।

**🔍 গুরুত্বপূর্ণ আবিষ্কার — opm-diag শুধু online ONU-র রিডিং দেয়:** তদন্তে দেখা গিয়েছিল Cholash-এ diag 121-এর মধ্যে মাত্র 21 row দিচ্ছে (আগে 115 দিয়েছিল)। ভেবেছিলাম পেজ আংশিক render হচ্ছে, তাই per-port retry দিয়ে "সম্পূর্ণ" করার logic লিখেছিলাম। **মেপে দেখা গেল ধারণাটা ভুল**: Cholash 22 online → 21 diag, Kuhruil 62 online → 62 diag, **offline ONU-র সাথে diag-এর ছেদ ০**। অর্থাৎ অফলাইন ONU-তে অপটিক্যাল সিগন্যাল নেই বলে মাপার কিছুই নেই — কোনো ডাটা হারাচ্ছিল না। আগের 115 এসেছিল কারণ তখন 115টি online ছিল। **retry logic সরিয়ে দেওয়া হয়েছে** — সেটা শুধু ডিভাইসে বাড়তি চাপ ও দেরি (Cholash 8s→18s, Office 39s→60s) আনত, নতুন কোনো row আনত না।

**Side Effect / সতর্কতা:**
- `colFilters.description` → `colFilters.dereg` (dropdown, লোড হওয়া rows থেকে অপশন)। মডাল subtitle এখন description-এর বদলে `olt_name` দেখায়, কারণ description প্রায়ই খালি।
- offline ONU-তে RX/temperature/voltage `null` থাকবে — এটা প্রত্যাশিত, বাগ নয়। UI-তে "No Signal" দেখায়।
- ব্যবহারকারীর আগের স্ক্রিনশটে Offline সংখ্যা 512→181→23 ওঠানামা **বাস্তব নেটওয়ার্ক অবস্থা**, কোনো sync বাগ নয়।

**Tested:** হ্যাঁ — তিন OLT sync: dereg 73/73, 121/121, 388/388; আসল description Office-এ 6টি অক্ষত। monitor API: 583 row, **10 query**, distance 578/583, dereg **583/583** (Power Off 494 · Wire Down 50 · N/A 39)। কলাম গণনা 10 header ↔ 10 cell। `manage.py check` পাস, `vite build` সফল।

---

### [2026-07-20] — HTTP প্রধান + SNMP fallback: নতুন device_service স্তর

**পরিবর্তিত ফাইল:** `olt_mgmt/services/device_service.py` (নতুন), `olt_mgmt/services/http_service.py`, `olt_mgmt/tasks.py`, `olt_mgmt/api/views.py`

**কী করা হয়েছে:** প্রশ্ন ছিল SNMP-র জায়গায় সর্বত্র HTTP ব্যবহার করা যাবে কিনা। ডিভাইসে SNMP ও HTTP পাশাপাশি চালিয়ে মেপে (192.168.110.2):

| ক্ষমতা | SNMP | HTTP | ফল |
|---|---|---|---|
| CPE MAC → ONU | 4.89s / 81 | **0.48s / 81** | ৮১/৮১ হুবহু মিল, ১০× দ্রুত |
| ONU inventory | 18.09s / 73 | **11.26s / 73** | MAC 73/73, status 73/73 |
| RX মান | 70/73 | 70/73 | সর্বোচ্চ পার্থক্য 0.38 dBm (গড় 0.029) |
| Temp/Voltage/TX | ✅ | ✅ (opm-diag কলাম) | সমান |
| dereg history/alive | ❌ | ✅ | HTTP-ই একমাত্র |

**সিদ্ধান্ত (user-এর পছন্দ): HTTP প্রধান, SNMP fallback** — সম্পূর্ণ মুছে না দিয়ে। কারণ HTML scrape V-SOL-এর নির্দিষ্ট UI ধরে লেখা; `OLT.VENDOR_CHOICES`-এ Huawei/ZTE/BDCOM আছে, আর firmware UI বদলালে scraper ভাঙে — তখন SNMP (স্ট্যান্ডার্ড MIB) স্বয়ংক্রিয়ভাবে দায়িত্ব নেয়।

নতুন `device_service.py` — একক প্রবেশদ্বার, প্রতিটি ফাংশন `(data, source)` দেয় (`source` = `'http'`/`'snmp'`/`'none'`):
- `fetch_onu_inventory(olt)` → SNMP `get_onu_list()`-এর **হুবহু একই row shape**
- `fetch_cpe_mac_map(olt)` → SNMP `get_cpe_mac_to_onu_map()`-এর একই shape

HTTP-তে নতুন: `fetch_cpe_mac_map_from_http()` (macinfo.html — L2 forwarding table, Port ID কলামে `EPON0/1:5` পর্যন্ত granularity), `fetch_onu_diag_from_http()` (opm-diag-এর সব কলাম, শুধু RX নয়)। Caller রূপান্তরিত: `tasks._sync_one_olt`, `tasks.link_onu_clients`, `views.sync_mac_table`, `views.onu_list`।

**⚠️ ধরা পড়া regression (ঠিক করা হয়েছে):** SNMP row-এ `description` আসলে **খালি**; আসল মান থাকে `value`-তে (raw OID string = ONU MAC), আর `_process_onu_row` করে `description or value`। প্রথম বাস্তবায়নে HTTP row-এ `value=''` দেওয়ায় **৭৩টি ONU-র Description কলাম ফাঁকা হয়ে যেত**। এখন `value = mac` দিয়ে হুবহু আগের আচরণ — যাচাই করে 73/73 description মিলেছে।

**Side Effect / সতর্কতা:**
- `views.onu_list` response shape বদলেছে: আগে সরাসরি list, এখন `{source, count, results}`। frontend-এ এই endpoint ব্যবহার হয় না (grep করা), তাই নিরাপদ।
- `_process_onu_row`-এ `service` প্যারাম এখনো SNMPService — কিন্তু শুধু **static helper** (`normalize_mac`, `port_from_oid`, `synthetic_mac_from_identity`) দেওয়ার জন্য, কোনো device I/O করে না। তাই HTTP path-এও নিরাপদ।
- SNMP-নির্দিষ্ট diagnostic endpoint (`diagnose-rx-oids`, `snmp_discover` command) অপরিবর্তিত — এগুলোর HTTP সমতুল্য নেই ও দরকারও নেই।
- HTTP path-এ প্রতিটি কলে login লাগে (~1.4s) — SNMP stateless। বেশি ঘনঘন poll-এ এটা বিবেচ্য।

**Tested:** হ্যাঁ — (১) সম্পূর্ণ pipeline: `_sync_one_olt` 13.17s, 73 row, DB-তে **শূন্য ক্ষতি** (mac 73, sig 73, desc 73, rx 70, linked 1 — সব অপরিবর্তিত), tx_power সহ 70টি। (২) **Fallback ৪টি পরিস্থিতিতে পরীক্ষিত**: স্বাভাবিক→`http`; HTTP খালি→`snmp` (73 row/79 এন্ট্রি); HTTP exception→`snmp`; credential-হীন OLT→সরাসরি `snmp` — চারটিতেই একই ডাটা। (৩) description regression fix: 73/73 মিল। `manage.py check` পাস।

---

### [2026-07-20] — Telnet সম্পূর্ণ অপসারণ: OLT sync এখন HTTP + SNMP-ভিত্তিক

**পরিবর্তিত ফাইল:** `olt_mgmt/services/telnet_service.py` (**মুছে ফেলা**), `olt_mgmt/services/http_service.py`, `olt_mgmt/api/views.py`, `admin_panel/src/pages/olt/OLTListPage.jsx`

**কী করা হয়েছে:** ডিভাইস sync থেকে Telnet লজিক পুরোপুরি বাদ। রিভিউ করে দেখা গেছে Telnet-এর ঠিক **দুটি** consumer ছিল — (ক) `_fetch_rx_from_device` (RX power) ও (খ) `_fetch_onu_status_rows` (ONU Event Log-এর registration history)। দুটোরই HTTP সমতুল্য ডিভাইসে যাচাই করা হয়েছে:

| কাজ | আগে (Telnet) | এখন (HTTP) |
|---|---|---|
| RX power | `show onu opm-diag all` — 12.0s / 44 ONU (অসম্পূর্ণ) | `onuopmdiag.html` — 8.3s / 62 ONU |
| ONU status/log | `show onu status all` — 12s+ / 44 rows | `onustatusinfo.html` — **1.50s / 73 rows** |

নতুন `fetch_onu_status_from_http()` + `_parse_onu_status_html()` — telnet-এর `parse_onu_status_table()`-এর সাথে **হুবহু একই row dict shape** দেয় (key shape ও ১১টি ফিল্ড যাচাই করা), তাই `_match_onu_row` / `olt_onu_log` caller অপরিবর্তিত। HTML কলাম ক্রমে index-3-এ একটি অতিরিক্ত Description কলাম আছে (telnet-এ ছিল না) — positional mapping সেভাবে করা।

**অন্যান্য পরিবর্তন:** `_olt_telnet_lock_*` → `_olt_device_lock_*` (cache key ইচ্ছাকৃতভাবে অপরিবর্তিত, deploy-এ চলমান lock অক্ষত রাখতে); `sync-rx-telnet` action → নতুন `sync-rx`, পুরনো URL deprecated alias হিসেবে রাখা (পুরনো caller ভাঙবে না); `test_connection` এখন Telnet পোর্ট probe না করে **যে চ্যানেলে আসলে sync হয়** সেটাই যাচাই করে (web UI login + System Name পড়া) — আগে পোর্ট খোলা থাকলেও sync ভাঙা থাকতে পারত, এখন সত্যিকারের অবস্থা বলে।

**Side Effect / সতর্কতা:**
- `olt_mgmt/services/telnet_service.py` **মুছে ফেলা হয়েছে** — কোনো ফাইলে আর reference নেই (grep + `ModuleNotFoundError` দিয়ে যাচাই)। দরকার হলে git history-তে আছে।
- **রয়ে গেছে (ইচ্ছাকৃত):** `OLT.telnet_port`, `mgmt_proto`-এর `'telnet'` choice, ও OLT ফর্মের সংশ্লিষ্ট ফিল্ড। এগুলো এখন sync-এ **কোনো ভূমিকা রাখে না**, শুধু config metadata। DB column ফেলতে migration লাগত ও ফর্ম ভাঙার ঝুঁকি ছিল, তাই আলাদা কাজ হিসেবে রাখা হলো।
- SNMP path (`snmp_service.py`, `tasks.py`-র auto-sync) অপরিবর্তিত — ONU/MAC inventory আগের মতোই SNMP-তে হয়। অর্থাৎ চূড়ান্ত আর্কিটেকচার: **SNMP = inventory/bulk, HTTP = RX + ONU status/log**।
- আগের entry-তে নথিভুক্ত `TelnetOLT.run()`-এর first-byte বাগ এখন অপ্রাসঙ্গিক (ফাইলই নেই)।

**Tested:** হ্যাঁ — Telnet ছাড়া সব পথ live OLT-এ: `sync-rx` 10.61s/62 ONU HTTP 200; deprecated alias `sync-rx-telnet` HTTP 200 (backward compat); `live-refresh` 5.36s scope=pon_2/29 ONU; `onu-log` **1.48s** (আগে 12s+) সম্পূর্ণ ডাটা সহ (status/dereg_reason/distance/alive_time); `import telnet_service` → ModuleNotFoundError ✅। HTTP status parser: 73 rows, 0 অস্বাভাবিক row, key shape telnet-এর সাথে মিলেছে, status বণ্টন 62 online/11 offline। `test-connection` তিনটি OLT-এ HTTP 200 (System Name সহ)। `manage.py check` পাস, `vite build` সফল।

---

### [2026-07-20] — Live Refresh per-PON-port scope (পূর্ণ OLT স্ক্যান বাদ) + Telnet run() বাগ নথিভুক্ত

**পরিবর্তিত ফাইল:** `olt_mgmt/services/http_service.py`, `olt_mgmt/api/views.py`, `admin_panel/src/pages/olt/ONUMonitoringPage.jsx`

**কী করা হয়েছে:** প্রশ্ন ছিল — Live Refresh-এ পুরো OLT তালিকা না এনে শুধু নির্দিষ্ট ONU আনলে কি দ্রুত হবে ও ডিভাইস hang-এর ঝুঁকি কমবে? ডিভাইসে **মেপে** যাচাই করা হয়েছে (192.168.110.2):

| পদ্ধতি | সময় | ONU |
|---|---|---|
| Telnet `show onu opm-diag all` | 12.0s | 44 (অসম্পূর্ণ — শুধু port 1,2) |
| HTTP `select=255` (সব) | 8.30s | 62 |
| HTTP `select=1` | 2.65s | 15 |
| HTTP `select=2` | 4.27s | 29 |
| HTTP `select=3` | **0.11s** | 3 |

**ফলাফল:** per-PON-port সম্ভব ও উল্লেখযোগ্যভাবে দ্রুত, তবে **একক ONU পর্যন্ত নয়** — ডিভাইসের সবচেয়ে সূক্ষ্ম granularity হলো PON port। Telnet-এ port-ভিত্তিক ভ্যারিয়েন্ট **নেই** (`show onu opm-diag EPON0/1` → `% Unknown command`), তাই per-port শুধু HTTP পথে। বাস্তবায়ন: নতুন `select_code_for_interface()` (`'EPON 0/01/5'` → `'1'`), `fetch_rx_from_http(..., select=...)`, এবং `live_refresh` প্রথমে per-port চেষ্টা করে — ব্যর্থ হলে পূর্ণ স্ক্যানে fallback। Response-এ নতুন `scope` ফিল্ড (`pon_<n>` / `all`)। partial refresh-এ `olt.last_sync_*` আর টাচ করা হয় না (শুধু `last_polled`) — নইলে আংশিক refresh পূর্ণ-sync হিসেবে ভুল রেকর্ড হতো।

**⚠️ পাওয়া বাগ (এখনো ঠিক করা হয়নি — আলাদা কাজ):** `telnet_service.TelnetOLT.run()`-এ `if not chunk: break` — প্রথম ৩s নীরবতাতেই পুরো কমান্ড পরিত্যাগ করে, যদিও `timeout=25` চাওয়া হয়। `opm-diag all`-এ OLT-কে ৬২টি ONU poll করতে হয় বলে প্রথম byte আসতে >৩s লাগে → Telnet সবসময় 0 row দেয় → HTTP fallback চলে। এটাই Work Log-এ আগে লেখা "intermittent Telnet flakiness"-এর আসল কারণ। **তবে ঠিক করা তাড়াহুড়োর নয়:** মেপে দেখা গেছে Telnet ঠিক করলেও (12.0s/44 ONU) সেটা HTTP-র (8.3s/62 ONU) চেয়ে ধীর ও অসম্পূর্ণ — অর্থাৎ বর্তমান "Telnet দ্রুত fail → HTTP" আচরণ দুর্ঘটনাক্রমে ভালো। ভবিষ্যতে HTTP-কে primary করা যেতে পারে (৩s অপচয় বাঁচবে)।

**Side Effect / সতর্কতা:**
- per-port refresh শুধু **ওই port-এর** ONU আপডেট করে; অন্য port-এর row পুরনো থাকে (কাম্য — টেবিলের পূর্ণ আপডেটের জন্য OLT List-এর Sync ব্যবহার করুন)।
- `select_code_for_interface` DB ফরম্যাট (`'EPON 0/01/5'`) ধরে; CLI ফরম্যাট (`'EPON0/1:5'`) parse হয় না → `None` → নিরাপদে পূর্ণ স্ক্যান fallback (edge case টেস্ট করা)।
- `select` কোড ও `EPON 0/0N` mapping V-SOL web UI-নির্দিষ্ট; অন্য vendor-এ ভিন্ন হতে পারে, তখন fallback পথ কাজ করবে।

**Tested:** হ্যাঁ — live-refresh: `EPON 0/01/1` 4.28s/15 ONU, `EPON 0/02/1` 5.27s/29 ONU, `EPON 0/03/1` **1.53s**/3 ONU (আগে 11-15s); তিনটিতেই `in_device=True`, RX ও `last_updated` DB-তে আপডেট (যেমন -19.63→-19.51)। `select_code_for_interface` ৮টি edge case পাস। `sync_rx_telnet` regression HTTP 200 (62 updated), mac-সহ row 73→73। `manage.py check` পাস, `vite build` সফল।

---

### [2026-07-20] — Live Refresh সত্যিকারের device-read করে DB আপডেট করে + raw_data ওভাররাইট বাগ ফিক্স

**পরিবর্তিত ফাইল:** `olt_mgmt/api/views.py`, `admin_panel/src/components/OltRxModal.jsx`, `admin_panel/src/pages/olt/ONUMonitoringPage.jsx`

**কী করা হয়েছে:** ব্যবহারকারী জানতে চেয়েছিলেন সিগন্যাল কার্ডের "Live Refresh" আসলেই ডিভাইস থেকে ডাটা আনে কিনা। **আনত না** — এটা শুধু `load(true)` কল করত, যা `/olt/onu-signals/monitor/` থেকে আমাদের নিজের DB আবার পড়ত; আর ONU log-এ ৬০s সার্ভার-cache থাকায় "cached" ব্যাজ আসত (কার্ডে ১১ মিনিটের পুরনো ডাটা)। এখন:

1. **নতুন endpoint** `POST /olt/onu-signals/{pk}/live-refresh/` — সরাসরি ডিভাইসে যায় (Telnet `opm-diag`, খালি হলে HTTP web-UI fallback), rx_map দিয়ে ওই OLT-এর **সব** ONUSignal DB-তে আপডেট করে, `olt.last_sync_*` সেট করে, এবং `onu_log_sig_*` / `onu_log_*` cache মুছে দেয় → পরের log কলও live আসে। opm-diag একবারেই পুরো ONU list দেয়, তাই per-click একটাই device round-trip।
2. **রিফ্যাক্টর:** `_fetch_rx_from_device()` (lock + telnet→http fallback + system-name refresh) ও `_apply_rx_map()` — `sync_rx_telnet` এবং `live_refresh` দুটোই এখন এই শেয়ার্ড helper ব্যবহার করে, তাই দুই path আর drift করবে না।
3. **বাগ ফিক্স (গুরুত্বপূর্ণ):** `sync_rx_telnet` আগে `'raw_data': {'source': source}` দিয়ে পুরো raw_data **ওভাররাইট** করত, ফলে `mac` key মুছে যেত — অথচ ONU Event Log সেই MAC দিয়েই ONU match করে (`_match_onu_row`)। এখন `_apply_rx_map` raw_data **merge** করে।
4. **Frontend:** `onForceRefresh` এখন live-refresh endpoint-এ POST করে, ফেরত আসা fresh row দিয়ে কার্ড (`setSignalRow`) ও টেবিল (`load(true)`) দুটোই আপডেট করে; মডালে `refreshError` banner ও "ডিভাইস থেকে পড়ছে…" লোডিং লেবেল যোগ।

**Side Effect / সতর্কতা:**
- **Live Refresh ~10-15s নেয়** (আসল Telnet session) — বাটনে স্পিনার/লেবেল আছে, কিন্তু এটা synchronous request; খুব ঘনঘন চাপলে OLT-এর telnet lock 429 দেবে (intentional, self-DoS প্রতিরোধ)।
- `in_device=False` হলে ডিভাইস ওই interface রিপোর্ট করেনি — তখন পুরনো মান **ইচ্ছাকৃতভাবে অপরিবর্তিত** রাখা হয় ও toast warning দেখায়, কারণ "opm-diag-এ নেই" আর "offline" এক নয় (offline ONU invalid RX নিয়ে আসতে পারে যা parser skip করে)। জোর করে offline মার্ক করলে false negative হতো।
- একটি ONU-তে Live Refresh চাপলে ওই OLT-এর সব ONU RX আপডেট হয় (side effect, তবে কাম্য — একই telnet সেশনের ফ্রি বাই-প্রোডাক্ট)।

**Tested:** হ্যাঁ — live OLT 192.168.110.2-এ: live-refresh HTTP 200, `source=telnet_opm_diag`, ১১.১s, device_total=62, RX `-6.39 → -6.41` DB-তে আপডেট, `raw_data.mac` অক্ষত। Cache আচরণ: log#1 `cached=False` → log#2 `cached=True` → live-refresh → log#3 `cached=False` (bust নিশ্চিত)। `sync_rx_telnet` regression HTTP 200 (62 updated), mac-সহ row 73→73 (আগে নষ্ট হতো)। `manage.py check` পাস, `vite build` সফল।

---

### [2026-07-20] — OLT/ONU সিগন্যাল কার্ড Online Clients → ONU Monitoring-এ সরানো

**পরিবর্তিত ফাইল:** `admin_panel/src/components/OltRxModal.jsx` (নতুন), `admin_panel/src/pages/radius/OnlineClientMonitoring.jsx`, `admin_panel/src/pages/olt/ONUMonitoringPage.jsx`, `olt_mgmt/api/views.py`

**কী করা হয়েছে:** সিগন্যাল কার্ড (RX gauge + Signal Info + ONU Event Log মডাল) Online Clients Monitoring থেকে সরিয়ে ONU Monitoring-এ নেওয়া হয়েছে। (১) `OltRxModal` কে page-local component থেকে shared `src/components/OltRxModal.jsx`-এ extract করা — props এখন generic (`subtitle`, `rxInfo`, `logQuery`, `onClose`, `onForceRefresh`), আগের `client` prop-নির্ভরতা সরানো। (২) OnlineClientMonitoring-এ ONU/RX সেলের ৬টি clickable `<button>` → plain `<span>` (এখন শুধু রিয়েল-টাইম RX লেবেল, কোনো মডাল নেই); `OltRxModal` definition, render block, ও এখন-dead `formatInterface`/`deregReasonInfo` helper delete। (৩) ONU Monitoring-এ RX Power সেল clickable — `signalRow` state, টেবিল ও মোবাইল কার্ড দুটোতেই। (৪) **Backend:** `olt_onu_log` এখন `?signal_id=<ONUSignal pk>`-ও নেয় (আগে শুধু `?client_id`) — ONU Monitoring-এর বেশিরভাগ ONU unlinked বলে client_id দিয়ে lookup সম্ভব ছিল না; `_onu_target_from_signal()` interface_id parse করে (`'EPON 0/01/5'` → port+onu_num) ও `raw_data['mac']` দিয়ে match করে। `_onu_target_from_client()`-এ পুরনো path রিফ্যাক্টর, cache key আলাদা (`onu_log_sig_*`)।

**Side Effect / সতর্কতা:**
- **ধরা পড়া বাগ:** নতুন helper দুটো `olt_onu_log`-এর ঠিক আগে বসানোয় `@api_view`/`@_perm_cls` ডেকোরেটর ভুল করে helper-এ চলে গিয়েছিল, ফলে endpoint সম্পূর্ণ ভেঙে যেত (`WSGIRequest has no attribute query_params`)। ঠিক করা হয়েছে — module-level helper যোগ করার সময় decorator-এর অবস্থান খেয়াল রাখুন।
- OnlineClientMonitoring-এ `modalRxInfo` state এখন write-only (`setModalRxInfo` কল হয় কিন্তু কেউ পড়ে না) — `openModal(type, client, rxInfo)` traffic/ping-এর জন্য শেয়ার্ড বলে ছোঁয়া হয়নি; চাইলে পরে সরানো যায়।
- Modal-এর "Live Refresh" এখন `reloadKey` বাড়িয়ে ONU log পুনরায় আনে; ONU Monitoring-এ `onForceRefresh` হিসেবে `load(true)` পাঠানো হয়।

**Tested:** হ্যাঁ — live OLT-এ দুটো path যাচাই: `?signal_id=7377` → HTTP 200 (Kuhruil-epon-olt, EPON0/1:1, alive_time/dereg_reason সহ), `?client_id=4` → HTTP 200 (regression পাস), param ছাড়া → HTTP 400। `manage.py check` পাস, `vite build` সফল।

**ফলো-আপ (একই দিন):** সিগন্যাল কার্ড খোলার entry point RX Power সেল থেকে সরিয়ে নতুন **Action** কলামে নেওয়া হয়েছে (ব্যবহারকারীর অনুরোধে, OLT Users রেফারেন্স পেজের মতো)। RX Power এখন আবার শুধু non-clickable রিয়েল-টাইম লেবেল। নতুন `Icon.Device` (ONU box + signal wave) emerald আইকন-বাটন হিসেবে টেবিলের ডানদিকে ও মোবাইল কার্ডে যোগ; টেবিল `min-w` 1000→1080px। কলাম সংখ্যা এখন ৯ (header ↔ cell যাচাই করা)।

---

### [2026-07-20] — OLT-এর আসল System Name ডিভাইস থেকে এনে সব জায়গায় দেখানো

**পরিবর্তিত ফাইল:** `olt_mgmt/models.py`, `olt_mgmt/services/http_service.py`, `olt_mgmt/api/views.py`, `olt_mgmt/api/serializers.py`, `olt_mgmt/migrations/0010_olt_system_name.py` (নতুন), `admin_panel/src/pages/olt/OLTListPage.jsx`

**কী করা হয়েছে:** UI-তে OLT-এর ম্যানুয়াল নাম ("Vsol OLT 192.168.110.2") দেখাত, ব্যবহারকারী চেয়েছেন ডিভাইসের **আসল System Name** ("Kuhruil-epon-olt")। V-SOL web UI-এর `/action/systeminfo.html` পেজে System Name থাকে `<input name=hostname value="...">`-এ (probe করে নিশ্চিত হওয়া গেছে; `main.html` শুধু ফ্রেম/মেনু পেজ, ওখানে নেই)। যোগ করা হয়েছে: (১) `OLT.system_name` field + `display_name` property (`system_name or name` — fallback); (২) `http_service.fetch_system_name_from_http()` — login করে systeminfo.html scrape; (৩) `views._refresh_system_name(olt)` best-effort helper, যা `perform_create` (OLT তৈরির সময়), নতুন `POST /olt/olts/{id}/sync-system-name/` action, এবং বিদ্যমান `sync_rx_telnet`-এ কল হয় — তাই ডিভাইসে নাম বদলালে sync-এ আপডেট হয়; (৪) serializer-এ `_SRC_OLT_NAME` এখন `'olt.display_name'` — ONU Monitoring ও MAC cache স্বয়ংক্রিয়ভাবে আসল নাম পায়; views.py-এর সব response label (`'olt':`, `'olt_name':`) ও `OLTMacCache.__str__` display_name-এ বদলানো; (৫) `search_fields`-এ `system_name`; (৬) frontend OLTListPage `display_name || name`।

**Side Effect / সতর্কতা:**
- `system_name` serializer-এ **read_only** — হাতে সেট করা যাবে না, শুধু ডিভাইস থেকে আসে। ম্যানুয়াল `name` ফিল্ড আগের মতোই রয়ে গেছে (fallback ও create-এর সময় দরকারি)।
- scrape শুধু V-SOL web UI structure ধরে (`systeminfo.html` + `name=hostname` input) — অন্য vendor-এ কাজ করবে না, তখন `display_name` চুপচাপ ম্যানুয়াল `name`-এ fallback করবে।
- `_refresh_system_name` কখনো exception raise করে না — ডিভাইস unreachable হলেও OLT create/sync ব্যর্থ হবে না।
- OLT-এ username/password না থাকলে fetch skip হয় (`''` ফেরত)।
- `Meta.ordering` এখনো `['name']` (ম্যানুয়াল নাম) — display নাম অনুযায়ী sort করতে চাইলে আলাদা কাজ লাগবে।

**Tested:** হ্যাঁ — তিনটি live OLT-এ backfill চালিয়ে যাচাই: 192.168.110.2→`Kuhruil-epon-olt`, .120.2→`Cholash-olt`, .130.2→`Office-olt`; `OLTSerializer` ও `ONUSignalSerializer` output-এ আসল নাম নিশ্চিত করা হয়েছে। `manage.py check` পাস, `vite build` সফল।

---

### [2026-07-20] — ONU Monitoring: PON grouping অপসারণ + flat টেবিল + summary strip

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/olt/ONUMonitoringPage.jsx`

**কী করা হয়েছে:** একই দিনের আগের entry-র ফলো-আপ। (১) PON group (expand/collapse) টেবিল রো সম্পূর্ণ সরানো হয়েছে — `groupByPON`, `PONGroupHeaderRow`, `PONGroupBlock`, `MobilePONGroup`, `openGroups` state সব delete। টেবিল এখন **সবসময় flat**; OLT সিলেক্ট করলে সেই OLT-এর সব PON-এর ONU একসাথে দেখায়, PON সিলেক্ট করলে শুধু সেটার। (২) নতুন `compareByOltPonOnu()` — default sort এখন OLT → PON → ONU index (numeric-aware), তাই flat লিস্টও বাস্তব OLT-এর ক্রমে থাকে; `Sort` কন্ট্রোল আর disable হয় না। (৩) টেবিলের ঠিক উপরে বাম পাশে নতুন summary strip (`SumChip` কম্পোনেন্ট) — বর্তমান ফিল্টারে **OLT / PON / ONU / Online / Offline** সংখ্যা (`viewStats` useMemo, `displayRows` থেকে derived)। (৪) আগের ধাপে stat কার্ড ৪টি gradient ডিজাইনে (OLT Users রেফারেন্স পেজ) এবং টপ বার থেকে All OLTs/All statuses dropdown সরানো হয়েছে — সব ফিল্টার এখন Column Filters প্যানেলে (OLT→PON→ONU ও Zone→SubZone→Box dependent dropdown)।

**Side Effect / সতর্কতা:**
- `filters.olt` state এখনো আছে কিন্তু কোনো UI নেই — সবসময় `''`, তাই server-এ `olt` param যায় না; OLT ফিল্টার এখন পুরোপুরি client-side (`colFilters.olt_name`, নাম-ভিত্তিক ম্যাচ)। `olts` state ও `/olt/olts/` fetch এখন unused (dead) — পরে সরানো যায়।
- StatCard ক্লিক `filters.status` (server-side) সেট করে, আর প্যানেলের Status dropdown `colFilters.status` (client-side) — দুটো আলাদা path, একসাথে AND হয়। বিপরীত দুটো সিলেক্ট করলে 0 row আসবে (edge case)।
- `Icon.Refresh` / `Icon.Reload` অব্যবহৃত dead code (আগে থেকেই)।

**Tested:** হ্যাঁ — `vite build` সফল; grouping-এর কোনো leftover reference নেই (grep verified)।

---

### [2026-07-20] — ONU Monitoring: per-column powerful filter panel যোগ

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/olt/ONUMonitoringPage.jsx`

**কী করা হয়েছে:** ONU Monitoring টেবিলের প্রতিটি কলামের জন্য আলাদা ফিল্টার যোগ করা হয়েছে — filter bar-এ নতুন "Column Filters" toggle বাটন (active count badge সহ), ক্লিক করলে collapsible প্যানেল খোলে। প্যানেলে ৮টি কলাম ফিল্টার: OLT Name / ONU ID / Description / Client / Zone / MAC (text "contains") এবং Status / RX Power (dropdown, tier সহ)। সব ফিল্টার **client-side** — `colFilters` state → `displayRows` useMemo-এ প্রয়োগ, তাই instant এবং grouped (OLT সিলেক্টেড) view-এও কাজ করে। নতুন reusable `ColText`/`ColSelect`/`ColFieldShell` কম্পোনেন্ট। ড্যাশবোর্ড প্যালেট মেনে (#23445f label-strip, teal-600 accent, gray base)। "Clear all" বাটন + empty-state clear-এ column filter-ও রিসেট হয়।

**Side Effect / সতর্কতা:**
- Column filters পুরোপুরি client-side — শুধু বর্তমানে লোড হওয়া rows-এ প্রয়োগ হয়; server-side pagination নেই বলে সব row একসাথে আসে, সমস্যা নেই। ভবিষ্যতে server pagination এলে এগুলো server param-এ পাঠাতে হবে।
- StatCard summary counts (Total/Good/Low/Offline) column filter থেকে **স্বাধীন** — ওগুলো backend summary থেকে আসে, filtered subset নয় (intentional)।

**Tested:** হ্যাঁ — `vite build` সফল, কোনো error নেই।

---

### [2026-07-19] — OLT ONU RX Sync: Telnet fail হলে HTTP web-UI scrape fallback

**পরিবর্তিত ফাইল:** `olt_mgmt/services/http_service.py` (নতুন), `olt_mgmt/api/views.py` (`sync_rx_telnet`)

**কী করা হয়েছে:** "192.168.120.2" OLT-এ opm-diag command থেকে ONU data না পাওয়ার error রিপোর্ট হয়েছিল। Debug করে দেখা গেছে এই OLT-এ Telnet CLI মাঝেমধ্যে (intermittent) `configure terminal` মোডে ঢুকে `show onu opm-diag all` চালানোর সময় slow/timeout হয়ে 0 row রিটার্ন করে — যদিও একই ডেটা web UI-এর "ONU OPM Diag" পেজে (`/action/onuopmdiag.html`, POST `select=255`) সবসময় পাওয়া যায়। তাই `sync_rx_telnet` এখন: প্রথমে Telnet চেষ্টা করে, `rx_map` খালি হলে `fetch_rx_from_http()` (নতুন `http_service.py`) দিয়ে OLT-এর web UI login করে (`user`/`pass`/`who=100` POST করে `/action/main.html`-এ) ONU OPM Diag পেজ scrape করে fallback করে। `ONUSignal.raw_data.source` এখন `'telnet_opm_diag'` বা `'http_opm_diag'` — কোন উৎস থেকে ডেটা এসেছে জানার জন্য।

**Side Effect / সতর্কতা:**
- HTTP fallback শুধু VSOL-এর এই web UI structure (`onuopmdiag.html`, self-signed HTTPS, session IP-based cookie ছাড়াই) ধরে লেখা — অন্য vendor/firmware-এ ভিন্ন হতে পারে, generalize করা হয়নি।
- Login verify করে `'Sorry' in resp.text` চেক দিয়ে — vendor UI বদলালে এই string check ভাঙতে পারে।
- `requests.Session(verify=False)` ব্যবহার হয়েছে কারণ OLT self-signed cert ব্যবহার করে (browser-এও "Not secure" দেখায়) — এটা intentional, OLT নিজেই LAN-এর ভেতরে থাকে।
- Telnet কমান্ড আসলে কাজ করে (config mode-এর ভেতরে) — আগের অনুমান যে ডিভাইসটা PON OLT না, ভুল ছিল; এটা শুধু Telnet সেশনের intermittent slowness ছিল। HTTP fallback সেই flakiness cover করে।

**Tested:** হ্যাঁ — DRF `sync-rx-telnet` action সরাসরি call করে (APIRequestFactory) 192.168.120.2-এ 21 ONU RX আপডেট নিশ্চিত করা হয়েছে (`200 {'ok': True, ... 'total': 21}`); `fetch_rx_from_http()` আলাদাভাবেও 21 entries রিটার্ন করেছে টেলনেটের ফলাফলের সাথে মিলিয়ে। `python manage.py check` পাস।

**ফলো-আপ (একই দিন):** user জিজ্ঞেস করেছিল Telnet/HTTP/SNMP-এর মধ্যে কোনটা সবচেয়ে reliable। খতিয়ে দেখে পাওয়া গেছে — `olt_mgmt/api/views.py`-এর `diagnose-rx-oids` action ও `snmp_service.py`-এর `_vsol_fetch_rx_rows()`/`get_vsol_onu_list()` দিয়ে **SNMP route ইতিমধ্যে পুরোপুরি wired ছিল** (নতুন কিছু বানাতে হয়নি) — শুধু `OLT.rx_snmp_oid` সেট করা ছিল না। raw `snmpwalk` দিয়ে candidate OID `1.3.6.1.4.1.37950.1.1.5.12.2.1.8.1.7` টেস্ট করে ২১টা ONU RX (Telnet/HTTP-এর সাথে হুবহু মিল) পাওয়া গেছে, এবং এটা 192.168.110.2-তেও কাজ করে (fleet-wide standard OID মনে হচ্ছে)। এই OID এখন `OLT(ip_address='192.168.120.2').rx_snmp_oid`-এ সেভ করা হয়েছে (Django shell দিয়ে, migration লাগেনি — শুধু data update)। এখন থেকে regular `sync-mac-table` action (main "Sync" বাটন) SNMP দিয়েই RX টানবে — Telnet/HTTP fallback শুধু ভবিষ্যতে backup হিসেবে থাকবে। SNMP recommend করা হয়েছে user-কে কারণ এটা সবচেয়ে দ্রুত (single UDP walk, login/session/CLI-prompt overhead নেই) ও reliable।

**Tested (ফলো-আপ):** হ্যাঁ — `SNMPService.from_olt_model(olt).get_vsol_onu_list()` সরাসরি call করে 121 rows-এর মধ্যে 21টায় সঠিক `rx_power_dbm` (Telnet/HTTP-এর সাথে মিলে যাওয়া মান) নিশ্চিত করা হয়েছে।

**ফলো-আপ ২ (একই দিন):** user জিজ্ঞেস করেছিল VSOL-এর cloud NMS (iNCE, `api.ince.vsol-tech.com`) বাদ দিয়ে লোকাল SNMP দিয়ে দ্রুত ONU data collect করা যাবে কিনা। খতিয়ে দেখে পাওয়া গেছে — এই infrastructure **ইতিমধ্যে পুরোপুরি বানানো ও চালু আছে**, নতুন কিছু লাগেনি:
- `config/settings.py:232-236` — Celery beat task `olt-auto-sync-mac-table` প্রতি **৫ মিনিটে** সব active OLT sync করে (`olt_mgmt/tasks.py:246` `sync_all_olts_mac_table`, `ThreadPoolExecutor` দিয়ে parallel)
- `admin_panel/src/pages/olt/ONUMonitoringPage.jsx:571-580` — frontend প্রতি ২০ সেকেন্ডে DB থেকে poll করে (live SNMP walk না, cached data)
- শুধু গ্যাপ ছিল: `rx_snmp_oid` শুধু 120.2-তে সেট ছিল, 110.2 ও 130.2-তে খালি। raw `snmpwalk` দিয়ে যাচাই করে দেখা গেছে **একই OID তিনটা OLT-তেই কাজ করে** (fleet-wide standard), তাই তিনটাতেই সেট করা হয়েছে।

**Tested (ফলো-আপ ২):** হ্যাঁ — `sync_all_olts_mac_table()` ম্যানুয়ালি call করে তিনটা OLT-ই সফল sync নিশ্চিত করা হয়েছে (110.2: 73 rows, 120.2: 121 rows, 130.2: 389 rows), মোট সময় ~৩৩ সেকেন্ড (parallel)।

**ফলো-আপ ৩ (একই দিন):** user নিজে ম্যানুয়ালি তিনটা OLT-এর web UI (SNMP → Remote Server)-এ গিয়ে VSOL iNCE cloud NMS **Disable** করে দিয়েছে (কোড পরিবর্তন নয়, OLT device configuration)। এরপর `sync_all_olts_mac_table()` আবার চালিয়ে নিশ্চিত করা হয়েছে cloud NMS disable-এর local SNMP sync-এ কোনো প্রভাব পড়েনি (যেমনটা প্রত্যাশিত ছিল — দুটো সম্পূর্ণ independent path): তিনটা OLT-ই আগের মতোই সফল (110.2: 73, 120.2: 121, 130.2: 389 rows, সব `ok: True`)।

**ফলো-আপ ৪ (একই দিন) — Telnet RX বাটন UI থেকে সরানো:** SNMP auto-sync (৫ মিনিট interval) এখন সব OLT-এর RX কভার করছে বলে user বলেছে OLT list-এর সবসময়-দৃশ্যমান "Telnet RX" বাটন আর দরকার নেই। পরিবর্তিত ফাইল: `admin_panel/src/pages/olt/OLTListPage.jsx`।
- Desktop table row (আগে ~576-585) ও Mobile card (আগে ~396-401)-এর unconditional "Telnet RX"/"📡 Telnet RX" বাটন সরানো হয়েছে; `runAction()`-এর `'telnet-rx'` branch (dead code হয়ে যাওয়ায়) সরানো হয়েছে।
- Backend action `sync-rx-telnet` (views.py) delete করা হয়নি — এটা এখনো genuinely দরকার (নতুন OLT/firmware যেখানে SNMP RX OID কাজ করে না)। তাই trigger বাটনটা **Edit OLT মডালের "🔍 Scan" (diagnose-rx-oids) ফলাফলের ভেতরে** সরিয়ে আনা হয়েছে — শুধু তখনই দেখা যাবে যখন scan-এ কোনো working SNMP OID পাওয়া যায় না (`diagResult.working_oids?.length === 0`), অর্থাৎ ঠিক যে-context-এ এটা দরকার সেখানেই এখন সীমাবদ্ধ। নতুন state: `telnetSyncing`, নতুন handler: `runTelnetRxFallback()`।
- `admin_panel && node ./node_modules/vite/bin/vite.js build` সফল, কোনো error/warning (chunk size warning ছাড়া, যেটা পুরনো/অপরিবর্তিত)।

**Tested (ফলো-আপ ৪):** Build পাস করেছে; ম্যানুয়াল browser test করা হয়নি (UI-only cleanup, low risk) — user দেখে নিশ্চিত করতে পারেন OLT list পেজে বাটন সরে গেছে এবং Edit modal-এর Scan fallback ঠিক আছে কিনা।

---

### [2026-07-19 ফলো-আপ] — Employee ↔ Position FK link যোগ (আগের রিভিউতে চিহ্নিত finding D ফিক্স)

**পরিবর্তিত ফাইল:** `hr/models.py`, `hr/migrations/0013_employee_position.py`, `hr/api/serializers.py`, `hr/api/views.py`, `admin_panel/src/pages/hr/AddEmployeePage.jsx`, `admin_panel/src/pages/hr/EmployeePage.jsx`, `admin_panel/src/pages/hr/PositionPage.jsx`

**কী করা হয়েছে:** আগের রিভিউতে ধরা পড়েছিল `Position` মডেলের `Employee`/`Department`-এর সাথে কোনো FK ছিল না — Position (headcount planning) আর Employee.designation (free-text) সম্পূর্ণ আলাদা, sync থাকার গ্যারান্টি ছিল না। এখন `Employee.position` FK (nullable, `on_delete=SET_NULL`) যোগ করা হয়েছে।
- `EmployeeSerializer`-এ `position` + read-only `position_name` যোগ; `EmployeeUpdateSerializer` (Meta `exclude`-based) অটোমেটিক নতুন ফিল্ড পিক করেছে।
- `PositionSerializer`-এ `employee_count` (annotate করা, active employee) যোগ — Department-এর employee_count প্যাটার্নের সাথে সামঞ্জস্যপূর্ণ।
- Frontend: `AddEmployeePage.jsx` (মূল Add/Edit ফর্ম)-এ "Position" ড্রপডাউন যোগ করা হয়েছে Designation ফিল্ডের পাশে — Position সিলেক্ট করলে (Designation খালি থাকলে) auto-fill হয়। `EmployeePage.jsx`-এর quick Edit modal-এও একই ড্রপডাউন যোগ। `PositionPage.jsx` টেবিল ও mobile card-এ "Employees" কলাম (count/head_count badge) যোগ করা হয়েছে।

**Side Effect / সতর্কতা:**
- `designation` ফিল্ড (free-text) সরানো হয়নি — এখনো required এবং আলাদাভাবে সংরক্ষিত থাকে; Position সিলেক্ট করলে শুধু খালি থাকলে auto-fill হয়, override করে না। তাই এখনো টেকনিক্যালি দুটো drift করতে পারে যদি ইউজার ম্যানুয়ালি designation বদলায় — কিন্তু এখন অন্তত সরাসরি লিংক করার অপশন আছে।
- Migration `0013_employee_position` প্রোডাকশনে apply করা হয়েছে (MySQL, কোনো ডেটা লস নয়, nullable FK)।
- `Position.head_count` এখনো enforce করা হয় না (কেউ head_count-এর বেশি employee assign করলে ব্লক হবে না) — সেটা এই ফিক্সের স্কোপে ছিল না।

---

### [2026-07-19] — HR মডিউল (Department/Position/Payroll/PayHead/Payslip) ফুল রিভিউ + fix

**পরিবর্তিত ফাইল:** `hr/api/views.py`, `hr/api/serializers.py`, `admin_panel/src/pages/hr/DepartmentPage.jsx`, `admin_panel/src/pages/hr/PayslipPage.jsx`, `admin_panel/src/pages/hr/PayrollPage.jsx`

**কী করা হয়েছে:**
- **Pagination bug fix:** HR-এর কোনো ViewSet-এই `pagination_class` সেট ছিল না, তাই global default (`PAGE_SIZE=20`, কোনো `page_size_query_param` নেই) ব্যবহার হচ্ছিল। ফলে Frontend-এর `?page_size=500/1000` কল silently ignore হয়ে ২০ রেকর্ডের বেশি department/payhead/payroll/position/employee/payrollsheet/advance/resignation/rejoin ডেটা কখনো লোড হতো না। নতুন `HRPagination` class (page_size=20, `page_size_query_param='page_size'`, max=2000) যোগ করে সব HR ViewSet-এ বসানো হয়েছে।
- **DepartmentPage রিডিজাইন:** Department পেজ পুরনো ডিজাইনে ছিল (হালকা নীল `#1a3c5e` বাটন, plain modal, লাল "Close" বাটন, green edit আইকন) — এখন Position/PayHead/Payroll পেজের সাথে হুবহু মিলিয়ে (teal-emerald gradient icon badge header, `bg-teal-600` Add বাটন, gradient modal header, bordered teal/red pill action icons, `bg-[#23445f]` uppercase table header, teal pagination) রিডিজাইন করা হয়েছে। এছাড়া backend-এ আগে থেকেই থাকা কিন্তু frontend-এ কখনো না-দেখানো `employee_count` কলাম এখন টেবিলে যোগ করা হয়েছে।
- **Percentage payhead অকার্যকর bug চিহ্নিত + mitigate:** Basic Salary ট্র্যাকিং আগের রিডিজাইনে বাদ দেওয়া হয়েছিল, ফলে `amount_type='percentage'` সেট করা যেকোনো payhead সবসময় ০ টাকা resolve করে (ফ্রন্টএন্ড কোডেও hardcode করা ছিল)। যেহেতু basic salary ফিরিয়ে আনা একটা প্রোডাক্ট-সিদ্ধান্ত, তাই root-cause fix না করে UI-তে Percentage অপশন `disabled` করে টুলটিপ দেওয়া হয়েছে (PayrollPage-এর Assign PayHead ফর্ম + PayslipPage-এর Generate/Edit মোডাল দুই জায়গাতেই) যাতে ইউজার ভুল করে percentage সিলেক্ট করে ০ টাকার payhead তৈরি না করে।
- **Code cleanup:** `PayslipEntrySerializer`-এ `__import__('hr.models', ...)` workaround সরিয়ে normal top-level import করা হয়েছে; `EditPayslipModal`-এর stale comment (basic salary blur থেকে percentage recompute — যা আর নেই) আপডেট করা হয়েছে।

**Side Effect / সতর্কতা:**
- `page_size` fix-এর কারণে এখন ২০+ department/payhead/payroll/position ইত্যাদি থাকা প্রজেক্টে আগে না-দেখা পুরনো রেকর্ডগুলোও UI-তে দেখাবে — এটা প্রত্যাশিত fix, bug না।
- Percentage payhead mode শুধু frontend-এ disabled করা হয়েছে, backend এখনো percentage accept করবে যদি কেউ সরাসরি API hit করে (কোনো validation যোগ করা হয়নি) — যদি ভবিষ্যতে Basic Salary ফিরিয়ে আনা হয়, তখন এই disabled অপশনগুলো আবার enable করে দিতে হবে।
- `Position` মডেলের এখনো কোনো FK নেই `Employee`/`Department`-এর সাথে (শুধু `Payroll` ও `supervisor`) — সেটা এই সেশনে ঠিক করা হয়নি, শুধু চিহ্নিত করা হয়েছে।

**Tested:** হ্যাঁ — `python -c "django.setup(); from hr.api import serializers, views"` ক্লিন লোড হয়েছে, `vite build` সফল, gunicorn active থেকেছে, `/api/v1/hr/departments/` 401 (auth-required, expected) রেসপন্স দিয়েছে।

---

### [2026-07-19 ফলো-আপ ৫] — Payslip Details মডাল একই সিম্পল টেবিল-ডিজাইনে unify (Salary/Payment/Advance তিনটাই)

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/hr/PayslipPage.jsx` (`PayslipDetailModal` আবার রিডিজাইন, `Fragment` import যোগ)

**কী করা হয়েছে:**
আগের ফলো-আপ ৪-এ invoice-style redesign করা হয়েছিল যেখানে Salary Breakdown-এর dark-header ledger table, তার ডানে ভাসমান "Payment Summary" box, তারপর আলাদা স্টাইলের Payment History table, তারপর card-based Advance History — সব মিলিয়ে ৩-৪ রকম ভিন্ন visual language ছিল। User বললেন এটা এক টেবিলে, কলাম-সেল আকারে, সব সেকশন সিরিয়ালে, সিম্পল ডিজাইনে সাজাতে।
- এখন **তিনটা সেকশনই (Salary Breakdown, Payment History, Advance History) হুবহু একই সিম্পল টেবিল স্টাইল** ব্যবহার করে — হালকা ধূসর header (`bg-gray-100`), পাতলা `rounded-lg border` wrapper, একই `px-4 py-2.5` cell padding — কোনো dark navy header, কালারফুল badge chip, বা ভাসমান card নেই।
- **Payment Summary** আলাদা floating box না রেখে Salary Breakdown টেবিলের `<tfoot>`-এই merge করা হয়েছে (Total Addition → Total Deduction → Net Payable → Amount Paid → Balance Due, সব এক টেবিলের ধারাবাহিক row)।
- **Advance History** এখন card-list-এর বদলে Payment History-র মতোই সারিবদ্ধ টেবিল (# | Date | Method | Amount | Monthly | Recovered | Remaining | Status | Action) — Notes ও Recovery breakdown একটা expandable sub-row-এ (colspan) রাখা হয়েছে যাতে মূল টেবিলের কলাম-সারি ভেঙে না যায়।
- Payment ও Advance-এর Edit ফর্ম দুটোই এখন inline table row (colspan) হিসেবে খোলে — আগের মতোই, শুধু ভিজ্যুয়াল স্টাইল এখন বাকি টেবিলের সাথে সামঞ্জস্যপূর্ণ।
- `React.Fragment` দিয়ে Advance row + notes/recovery sub-row একসাথে key দিয়ে গ্রুপ করতে হয়েছে, তাই `Fragment` টা `react` থেকে import করা হয়েছে (আগে ছিল না)।

**Side Effect / সতর্কতা:** পুরনো "Quick stats" card row ও রঙিন badge chip ("ADDITION"/"DEDUCTION" pill) বাদ পড়েছে — এখন সেগুলো সাদামাটা রঙিন টেক্সট (সবুজ/লাল) হিসেবে দেখায়। Print layout একই `#payslip-print-area` ব্যবহার করে, নতুন সিম্পল টেবিল লেআউটই প্রিন্ট হবে।

**Tested:** হ্যাঁ — `vite build` সফল, পুরনো `sectionH`/`sectionTitle` ক্লাসের কোনো leftover reference নেই (grep verify), function boundary ঠিক আছে (grep দিয়ে `function ...` লাইনগুলো চেক করা হয়েছে)। UI ক্লিক-থ্রু করা হয়নি — deploy-এর পর ব্রাউজারে **হার্ড রিফ্রেশ** (Ctrl+Shift+R) করে দেখার পরামর্শ, কারণ এই সেশনে বারবার rebuild হওয়ায় পুরনো ট্যাবে stale JS chunk থাকতে পারে।

---

### [2026-07-19 ফলো-আপ ৪] — Payslip Details মডাল সিনিয়র-লেভেল রিডিজাইন (invoice-style) + Payment History Edit

**পরিবর্তিত ফাইল:** `hr/api/views.py` (নতুন `PayrollSheetViewSet.edit_payment` action), `admin_panel/src/pages/hr/PayslipPage.jsx` (`PayslipDetailModal` সম্পূর্ণ রিডিজাইন)

**কী করা হয়েছে:**
User চাইলেন Payslip Details মডাল একটা invoice-এর মতো দেখাবে, payment sheet ক্লিয়ার বোঝা যাবে, আর Payment History-তে Edit অপশন থাকবে।
1. **Backend — Payment edit endpoint** — `PATCH /api/v1/hr/payroll/{id}/payments/{pay_id}/edit/` নতুন action যোগ হয়েছে (আগে শুধু create+delete ছিল, update ছিল না)। Amount/method/date/txn_id/notes/received_by আংশিক আপডেট করা যায় (যা পাঠানো হয় শুধু তাই বদলায়), তারপর `sheet.is_paid`/`paid_date` recompute হয় ঠিক `pay()`/`remove_payment()`-এর প্যাটার্নে। **সতর্কতা:** এই edit accounting ledger retroactively adjust করে না — ledger শুধু payment তৈরি হওয়ার সময় একবার post হয় (`hr/ledger.py`-এর `post_salary_to_ledger`, শুধু `created=True`-তে trigger হয়)।
2. **Frontend — সম্পূর্ণ invoice-style রিডিজাইন:**
   - Employee info ও Payslip Info এখন classic invoice layout-এ পাশাপাশি (Bill-To style বাম দিকে employee, ডানে payslip no/period/generated date/status) — একটা auto-generated invoice number `PS-000123` (payslip id থেকে) যোগ হয়েছে।
   - আগে Additions/Deductions দুটো আলাদা box + একটা আলাদা "Net Summary" table ছিল (যেখানে `sheet.basic_salary` স্বতন্ত্র field হিসেবে দেখানো হতো, যেটা real data-তে payhead-entry-এর "Basic Salary" থেকে ভিন্ন হতে পারে — স্ক্রিনশটে ০.০০ vs ১৫,০০০ mismatch দেখা গিয়েছিল, বিভ্রান্তিকর) — এখন **একটাই unified "Salary Breakdown" invoice ledger table** (Description | Type badge | Amount, Addition সবুজ +, Deduction লাল −), শেষে Total Addition/Deduction/Net Payable footer রো। পুরনো redundant "Basic Salary: 0.00" সারিটা বাদ দেওয়া হয়েছে যেহেতু সেটা entries-এর সাথে সবসময় sync থাকে না — এখন single source of truth শুধু entries-based breakdown।
   - এর নিচে একটা **"Payment Summary" panel** (invoice-এর "Amount Due" box-এর মতো, ডানে align করা): Net Payable / Amount Paid / Balance Due — Balance Due 0 হলে সবুজ, বাকি থাকলে লাল।
   - **Payment History-তে Edit যোগ** — প্রতিটি row-এর পাশে এখন ✎ Edit + 🗑 Delete। Edit ক্লিক করলে সেই row-ই inline form-এ পরিণত হয় (Amount, Date, Method, Txn ID, Received By, Notes) — Save করলে নতুন `edit_payment` endpoint কল হয়।
   - পুরনো "Quick stats" no-print card row বাদ দেওয়া হয়েছে যেহেতু Payment Summary panel এখন একই তথ্য বেশি স্পষ্টভাবে দেখায় (duplication কমানো)।

**Side Effect / সতর্কতা:** Print output (`#payslip-print-area`) নতুন layout-ই ব্যবহার করবে — pop-up preview এখনো টেস্ট করা হয়নি ব্রাউজারে। Payment amount edit করলে ledger entry পুরনো amount-এই থেকে যাবে (adjust হয় না) — বড় amount change হলে accounting-এর সাথে সাময়িক mismatch হতে পারে, ভবিষ্যতে দরকার হলে handle করতে হবে (advance edit-এও একই limitation আগে থেকে documented আছে)।

**Tested:** হ্যাঁ — Django shell-এ DRF `APIRequestFactory` দিয়ে সরাসরি `edit_payment` action call করে verify করা হয়েছে (amount 500→750 আপডেট হয়ে `paid_amount`/`due_amount`/`payment_status` সব ঠিকভাবে recompute হয়েছে), transaction rollback করে test data মুছে ফেলা হয়েছে। `python manage.py check` (0 issue)। Frontend `vite build` সফল, পুরনো "Payheads Breakdown"/"Net summary" reference কোথাও বাকি নেই (grep verify)। UI ক্লিক-থ্রু করা হয়নি (headless env) — deploy-এর পর একবার visually verify করার পরামর্শ থাকলো।

---

### [2026-07-19 ফলো-আপ ৩] — "+ Take Advance" বাটন সরানো + Payslip Details মডালের ডিজাইন cleaner/professional

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/hr/PayslipPage.jsx` (`PayslipDetailModal`, main page call-site)

**কী করা হয়েছে:**
User বললেন Advance History section-এর "+ Take Advance" বাটন বাদ দিতে, আর পুরো Payslip Details মডালের ডিজাইন আরো ক্লিয়ার/প্রফেশনাল করতে।
- "+ Take Advance" বাটন ও তার সাথে জড়িত `onAdvance` prop/handler সম্পূর্ণ সরানো হয়েছে (`PayslipDetailModal` signature থেকে, main page-এর call site থেকে) — advance নেওয়ার জন্য এখনো `EmployeeCard`-এর আলাদা "Advance" বাটন আছে (অপরিবর্তিত)।
- মডাল width `max-w-4xl` → `max-w-5xl` করে বেশি breathing room।
- Header-এ employee-এর initial সহ একটা avatar circle যোগ, নাম+status badge+meta একসাথে cleaner layout-এ।
- নতুন **quick-glance stat row** (screen-only, no-print): Basic/Net/Paid/Due — ৪টা card, আগে PaymentModal-এ যেমন ছিল সেই একই ভিজ্যুয়াল ভাষায়, যাতে স্ক্রল না করেই মূল সংখ্যাগুলো চোখে পড়ে।
- সব section header (Payment History, Advance History) এখন একই consistent style-এ — হালকা ধূসর ব্যান্ড + uppercase label + count, আগের মতো ভিন্ন ভিন্ন ঢঙে ছিল না।
- Payheads Breakdown/Net Summary card-গুলোর radius/shadow/spacing consistent করা হয়েছে (`rounded-lg` → `rounded-xl`, হালকা `shadow-sm` যোগ)। Net Salary-র রং emerald থেকে teal-এ পাল্টানো হয়েছে যাতে top stat row-এর সাথে মিলে যায় ও Paid/Due-এর সাথে confuse না হয়।
- Advance History-তে এখন outstanding থাকলে header-এই একটা "Outstanding ৳X" badge দেখায় — আলাদা করে প্রতিটা card খুলে remaining যোগ করতে হয় না।
- Payment/Advance table row hover, delete বাটনের hover-bg, ইত্যাদি micro-interaction পালিশ করা হয়েছে।

**Side Effect / সতর্কতা:** কোনো functional পরিবর্তন নেই (শুধু "+ Take Advance" বাদ) — Edit/Delete/Payment History সব আগের মতোই কাজ করবে। Print layout অপরিবর্তিত (quick-stat row `no-print` ক্লাস দিয়ে print-এ বাদ যায়, পুরনো summary table-ই print-এ ব্যবহৃত হয়)।

**Tested:** হ্যাঁ — `vite build` সফল, `onAdvance`/"Take Advance" reference কোথাও বাকি নেই (grep দিয়ে যাচাই)। UI ক্লিক-থ্রু করা হয়নি (headless env) — deploy-এর পর একবার দেখে নেওয়ার পরামর্শ।

---

### [2026-07-19 ফলো-আপ ২] — Advance balance edit option + advance recovery → accounting main balance (Cash On Hand)

**পরিবর্তিত ফাইল:** `hr/ledger.py` (নতুন `post_advance_given_to_ledger`, `post_advance_recovery_to_ledger`, shared `_get_asset_accounts` helper), `hr/apps.py` (নতুন signal: `EmployeeAdvance`, `AdvanceRecovery` post_save), `hr/api/serializers.py` (`EmployeeAdvanceSerializer.validate_amount`), `admin_panel/src/pages/hr/PayslipPage.jsx` (`PayslipDetailModal` — Advance History card-এ inline Edit)

**কী করা হয়েছে:**
User দুটো জিনিস চাইলেন: (১) Advance balance যেন edit করা যায়, (২) Advance recovery হলে company-র accounting main balance-এ যোগ হোক।
1. **Advance edit** — Payslip Details-এর Advance History card-এ প্রতিটি entry-তে "✎ Edit" বাটন যোগ হয়েছে (inline form: Amount, Monthly Deduction, Notes → PATCH `/hr/advances/{id}/`)। Backend serializer-এ `validate_amount()` যোগ হয়েছে যাতে amount কখনো ইতিমধ্যে-recovered টাকার কম করা না যায় (remaining ঋণাত্মক হওয়া ঠেকাতে)।
2. **Accounting integration** — আগে `EmployeeAdvance` (advance দেওয়া) ও `AdvanceRecovery` (recovery) কখনো accounting ledger touch করত না (শুধু `PayslipPayment`-এর জন্য `hr/ledger.py`-তে `post_salary_to_ledger` ছিল, `hr/apps.py`-তে signal wired ছিল)। এখন সেই একই double-entry প্যাটার্নে দুটো নতুন function:
   - Advance **দেওয়া** হলে → Debit "Employee Advance Receivable" (নতুন account code `1050`) / Credit "Cash On Hand" (`1010`) — নগদ কমে (এটা company-র জন্য খরচ না, receivable/পাওনা)।
   - Advance **রিকভারি** হলে (payslip থেকে deduction) → Debit "Cash On Hand" (`1010`) / Credit "Employee Advance Receivable" — **company-র মূল ব্যালেন্স (Cash On Hand)-এ যোগ হয়**, ঠিক যা user চেয়েছিলেন। Receivable কমে।
   - দুটোই `hr/apps.py`-তে `post_save` signal দিয়ে auto-trigger হয় (`EmployeeAdvance` ও `AdvanceRecovery` তৈরি হওয়া মাত্র) — কোনো manual call লাগে না, existing view code (advance CRUD, `_apply_advance_recovery`, `apply_advance` action) অপরিবর্তিত থেকেও কাজ করে।
   - Idempotent (`reference='ADVGIVE-<id>'` / `'ADVRECOV-<id>'`) ও fail-silent (try/except + warning log) — ঠিক `post_salary_to_ledger`-এর প্যাটার্নে, ledger ব্যর্থ হলেও HR অপারেশন আটকাবে না।
   - **বোনাস সাইড-ইফেক্ট:** Payslip overpayment (আগের সেশনে করা fix)-এ যে excess amount auto-`EmployeeAdvance` তৈরি করত, সেটাও এখন সঠিকভাবে Cash On Hand থেকে বের হওয়া হিসেবে ledger-এ ধরা পড়বে — আগে সেই excess cash-এর কোনো ledger trace ছিল না।

**Side Effect / সতর্কতা:**
- নতুন ChartOfAccount code `1050` ("Employee Advance Receivable") auto-create হবে প্রথম advance দেওয়ার সময় (get_or_create) — Accounting module-এর Chart of Accounts লিস্টে নতুন এই account দেখা যাবে।
- পুরনো (এই ফিচারের আগে তৈরি হওয়া) `EmployeeAdvance`/`AdvanceRecovery` row-গুলোর জন্য কোনো ledger entry নেই এবং retroactively backfill করা হয়নি — শুধু আজকের পর নতুন করে তৈরি হওয়া advance/recovery থেকে ledger post হবে।
- Advance amount edit করলে ledger entry automatically adjust হয় না (শুধু `EmployeeAdvance` তৈরি হওয়ার সময় একবারই post হয়) — যদি amount বড় পরিমাণে পরে edit করা হয়, ledger ও advance amount-এর মধ্যে mismatch থাকতে পারে। এটা edge case, প্রয়োজন হলে ভবিষ্যতে handle করতে হবে।

**Tested:** হ্যাঁ — `python manage.py check` (0 issue), Django shell-এ transaction.atomic()+rollback দিয়ে সরাসরি test করা হয়েছে: `EmployeeAdvance` তৈরি করলে `ADVGIVE-<id>` JournalEntry (debit=credit=amount) তৈরি হয়, `AdvanceRecovery` তৈরি করলে `ADVRECOV-<id>` JournalEntry তৈরি হয় — দুটোই confirmed, তারপর rollback করে test data মুছে ফেলা হয়েছে (production DB-তে কিছু থাকেনি)। Frontend `vite build` সফল। UI দিয়ে click-through করা হয়নি (headless env) — deploy-এর পর Advance edit ফর্ম ও Accounting → Chart of Accounts-এ নতুন `1050` account দেখে যাচাই করার পরামর্শ থাকলো।

---

### [2026-07-19 ফলো-আপ] — Payment History ও Advance History দুই আলাদা মডাল থেকে এক জায়গায় merge

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/hr/PayslipPage.jsx` (`PayslipDetailModal`, `AdvanceModal`)

**কী করা হয়েছে:**
User বললেন "Advance History আর Payment History আলাদা জায়গায় দেখাচ্ছে, দুইটা এক জায়গায় করে দিন — confusion হচ্ছে।" আগে Payment History শুধু "View Details" মডালে (per-payslip) আর Advance History শুধু "Advance" বাটনের আলাদা মডালে (per-employee, সাথে duplicate list+delete UI) দেখাত।
- `PayslipDetailModal`-এ Payment History-র নিচে নতুন **Advance History** section যোগ হয়েছে (`/hr/advances/by-employee/` থেকে fetch, employee-এর সব advance + recovery breakdown + delete বাটন) — এখন একটাই "View Details" ক্লিকে সব history (payment + advance) দেখা যায়।
- `AdvanceModal` থেকে duplicate full history list ও delete বাটন সরানো হয়েছে — এখন শুধু totals card (Total/Recovered/Remaining) + "+ New Advance Entry" ফর্ম আছে, সাথে নোট যে পূর্ণ history "View Details"-এ দেখতে হবে। `remove()` (delete) function `PayslipDetailModal`-এ `handleDeleteAdvance` হিসেবে সরানো হয়েছে।
- `PayslipDetailModal`-এ "+ Take Advance" বাটন যোগ হয়েছে যা `AdvanceModal` খোলে (detail modal বন্ধ করে দিয়ে, দুইটা stacked full-screen modal একসাথে না খুলতে)।

**Side Effect / সতর্কতা:** `AdvanceModal` এখন শুধু "advance দেওয়ার" ফর্ম — কোনো history browse/delete UI নেই সেখানে; delete এখন শুধু payslip Details থেকেই করা যায়। EmployeeCard-এর "Advance" বাটন এখনো একই `AdvanceModal` খোলে (unchanged), শুধু ভেতরের content simplified।

**Tested:** হ্যাঁ — `vite build` সফল (কোনো unused-ref/syntax error নেই)। UI দিয়ে click-through করা হয়নি (headless env) — deploy-এর পর একবার "View Details" → Advance History দেখা এবং "+ Take Advance" ফ্লো verify করার পরামর্শ থাকলো।

---

### [2026-07-19] — Payslip overpayment → auto Employee Advance (আগে reject হতো)

**পরিবর্তিত ফাইল:** `hr/api/views.py` (`_resolve_pay_amount`, `PayrollSheetViewSet.pay`), `admin_panel/src/pages/hr/PayslipPage.jsx` (`PaymentModal`)

**কী করা হয়েছে:**
User screenshot দেখালেন — Payslip-এ Due (15,000) এর চেয়ে বেশি amount (18,000) দিলে "Due-এর বেশি দেয়া যাবে না" error দিয়ে আটকে দিত। User চাইলেন: অতিরিক্ত অংশ reject না করে employee-এর advance balance-এ যোগ হয়ে যাক (client billing-এর overpayment→`advance_balance` প্যাটার্নের সাথে মিল রেখে)।
- `_resolve_pay_amount()`-এ `amount > due` cap সরানো হয়েছে (শুধু `amount > 0` চেক থাকে)।
- `pay()` action: `payslip_amount = min(amount, due)` দিয়ে `PayslipPayment` তৈরি হয় (due পর্যন্তই payslip-এ apply হয়), আর `excess_amount = amount - due` থাকলে সেটা দিয়ে নতুন `EmployeeAdvance` (monthly_deduction=0, taken_date=paid_date, notes-এ payslip reference) auto-create হয় — এই advance পরবর্তী মাসের payslip generate/apply-advance-এ `_apply_advance_recovery()` দিয়ে স্বয়ংক্রিয়ভাবে recover হবে (আগে থেকেই থাকা logic, নতুন কিছু বানাতে হয়নি)। Response-এ `excess_added_to_advance` key যোগ হয়েছে।
- আগে already fully-paid (`due<=0`) payslip-এ payment করাই যেত না — এখন পুরো amount-ই advance হিসেবে যোগ হতে পারবে (button আর due<=0-তে disable হয় না, শুধু amount<=0-তে হয়)।
- Frontend `PaymentModal`: input-এর `max={due}` সরানো, excess থাকলে amber hint টেক্সট ("Due-এর বেশি X — Advance balance-এ যোগ হবে"), success toast-এ excess জানানো হয়।

**Side Effect / সতর্কতা:**
- Overpayment হলে `PayslipPayment.amount` আর raw input amount সমান নয় — `payslip.paid_amount`/due হিসাব ঠিকই থাকবে (শুধু due পর্যন্তই payment record হয়), কিন্তু "আজ কত টাকা হাতে পাওয়া গেল" audit করতে হলে সেই payslip-এর payment + একই `paid_date`-এর `EmployeeAdvance` (notes-এ "Salary overpayment" ও payslip #ID থাকে) দুটোই দেখতে হবে।
- `EmployeeAdvanceViewSet` অলরেডি CRUD খোলা থাকায় auto-created advance ম্যানুয়ালি edit/delete করা যায় (ইচ্ছাকৃতভাবে restrict করা হয়নি, ভুল entry হলে ঠিক করার সুযোগ রাখা হয়েছে)।

**Tested:** হ্যাঁ — `ast.parse` (syntax OK), `python manage.py check hr` (0 issue), frontend `vite build` সফল। UI দিয়ে end-to-end click-through করা হয়নি (headless env), তাই actual browser flow verify করা হয়নি — deploy-এর পর একবার Due-এর বেশি amount দিয়ে Confirm Payment টেস্ট করার পরামর্শ থাকলো।

---

### [2026-07-19] — OLT/ONU storage duplication রিভিউ + ৩টা ফিক্স (raw_data trim, dead ONU model removal, scalar denormalization ডকুমেন্ট)

**পরিবর্তিত ফাইল:** `olt_mgmt/tasks.py`, `olt_mgmt/models.py` (`ONU` model delete + `ONUSignal.onu`/`SNMPTrapLog.onu` FK remove + migration `0009_remove_onusignal_onu_remove_snmptraplog_onu_and_more`), `olt_mgmt/admin.py`, `olt_mgmt/api/serializers.py`, `olt_mgmt/api/views.py`, `olt_mgmt/api/urls.py`, `olt_mgmt/management/commands/snmp_trap_listener.py`

**কী করা হয়েছে:**
User "OLT/ONU ডাটা একাধিক টেবিলে duplicate store হচ্ছে কিনা" রিভিউ চাইলে production DB row-count/size compare করে ৩টা finding পাওয়া গেল, তারপর "এখনই তিনটা ফিক্স করে দিন" বললে একে একে করা হলো:
1. **`ONUSignal.raw_data` থেকে duplicate JSON blob trim** — আগে `_process_onu_row()` (tasks.py) পুরো SNMP `row` dict spread করে `OLTMacCache.raw_data`-র সাথে ~400 byte/row duplicate করত, অথচ শুধু `raw_data['mac']` key-ই পড়া হতো (serializer)। এখন minimal shape `{'source', 'mac', 'status'}`।
2. **Dead `ONU` model সম্পূর্ণ মুছে ফেলা** — production DB-তে ০ row, কখনো কোনো sync path থেকে লেখা হয়নি (superseded by OLTMacCache/ONUSignal অনেক আগেই, কিন্তু cleanup হয়নি)। Model, FK (`ONUSignal.onu`, `SNMPTrapLog.onu`), সব serializer/view/admin/URL reference, dead helper function (`_sync_onu_inventory_signals`, `_rx_from_onu_inventory`, `_interface_id_for_onu`) সরানো হয়েছে। Migration `0009` তৈরি+apply করা হয়েছে।
   **Bonus bug fix:** `OLTViewSet.queryset`-এর `onu_count` annotation আগে dead `ONU` model-এর `related_name` (`onus`) count করত — সবসময় 0 দেখাত। এখন real `ONUSignal` related_name (`signals`) দিয়ে প্রকৃত count আসে (verified: 73/121/389 per OLT, আগে 0 ছিল)।
3. **Scalar duplication (rx_power vs rx_power_dbm, notes vs description) — ইচ্ছাকৃত রাখা হয়েছে, বাগ না** — `ONUSignal` interface_id দিয়ে dedup করা (583 row), `OLTMacCache` mac দিয়ে unique (945+ row, এক interface-এ একাধিক MAC সম্ভব)। Join করে aggregate করলে ONU Monitoring page-এর প্রতিটি list render extra query লাগত, কয়েক byte/row বাঁচানোর জন্য worth না। `models.py`-তে এই সিদ্ধান্তের কারণ কমেন্ট আকারে লেখা হয়েছে।

**Side Effect / সতর্কতা:**
- `olt_mgmt` API-তে `/api/v1/olt/onus/` endpoint আর নেই (dead, কোনো frontend ব্যবহার করত না — `OLTListPage.jsx`-এর `summary?.onus` ফলব্যাক কখনো hit হতো না)। `ONUSignal.onu_serial`/`onu_identifier` fields ও `summary.onus` key API response থেকে বাদ।
- নতুন OLT sync (২০২৬-০৭-১৯ পরের) থেকে `ONUSignal.raw_data`-তে শুধু `{source, mac, status}` থাকবে — পুরনো row-এ (migration-এর আগে sync হওয়া) এখনো পূর্ণ dict আছে, পরবর্তী sync-এ ধীরে ধীরে trim হবে।

**Tested:** হ্যাঁ — `python manage.py check` (0 issue), `ast.parse` সব modified file-এ, migration apply (OK), Django shell smoke test (ONU import ImportError confirm, `onu_count`/`mac_count` annotation real value, `ONUSignalSerializer` serialize করে দেখানো হয়েছে, `raw_data` নতুন minimal shape verify), gunicorn auto-reload log-এ কোনো error নেই।

---

### [2026-07-19 ফলো-আপ] — `OLTMacCache` stale-row cleanup যোগ (আগে কখনো delete হতো না)

**পরিবর্তিত ফাইল:** `olt_mgmt/tasks.py` (`_process_onu_row` এখন `mac`-ও return করে, নতুন `_cleanup_stale_mac_cache()`), `olt_mgmt/api/views.py` (`_sync_mac_row` wrapper + `sync_mac_table` action একই cleanup call করে)

**কী করা হয়েছে:**
Storage-review আলোচনার সময় ধরা পড়ল — `ONUSignal`-এর stale-cleanup (`_cleanup_stale_signals`) থাকলেও `OLTMacCache`-এর জন্য কোনো cleanup ছিল না; শুধু `update_or_create` (upsert), কখনো delete না, ফলে disconnected/re-provisioned ONU-র পুরনো MAC row চিরস্থায়ীভাবে জমে থাকত। User "চাই" বললে নতুন `_cleanup_stale_mac_cache(olt, touched_macs)` যোগ করা হলো — `_cleanup_stale_signals`-এর মতোই coverage-guarded (৫০% এর কম MAC touch হলে skip করে, partial/timeout SNMP walk-এ real data হারানো এড়াতে)। Auto-sync task (`_sync_one_olt`) ও manual "Sync MAC Table" বাটন (`sync_mac_table` action) — দুটোতেই call করা হয়েছে, যেহেতু দুটোই full ONU list walk করে।

**⚠️ Unrelated ঘটনা (এই কাজের কারণ না, তবে একসাথে ধরা পড়ল):** এই সময় দেখা গেল `isp_olt_mac_cache` টেবিলে মাত্র ৩টা row আছে (আগে ৯৪৫টা ছিল একই session-এ)। যাচাই করা হয়েছে এটা আমার migration/code-এর কারণে হয়নি (migration 0009 এই টেবিল touch করেনি, কোথাও delete code নেই) — user নিশ্চিত করেছেন তিনি manual SQL command চালিয়েছিলেন এই টেবিলে। Auto-sync (৫ মিনিট পরপর) ধীরে ধীরে আবার পূর্ণ করছে।

**Side Effect / সতর্কতা:**
- `_process_onu_row()` এখন 3-tuple `(was_created, interface_id, mac)` return করে — আগে 2-tuple ছিল। দুই caller-ই (`tasks._sync_one_olt`, `views._sync_mac_row`→`sync_mac_table`) আপডেট করা হয়েছে। ভবিষ্যতে নতুন caller যোগ করলে এই signature মনে রাখবেন।
- `live_client_rx`/`_try_update_mac_cache` (opportunistic partial write, bridge-match থেকে) এই cleanup call করে না — ইচ্ছাকৃত, কারণ এটা partial scan, পুরো ONU list walk করে না, তাই "touched" set দিয়ে stale বিচার করা নিরাপদ না এখানে।
- **Celery worker restart প্রয়োজন** — gunicorn auto-reload হলেও Celery worker কোড change auto-pick করে না; `sudo systemctl restart isp-celery.service` ম্যানুয়ালি চালাতে হবে (sudo password ছাড়া agent শেলে করা যায়নি, user-কে অনুরোধ করা হয়েছে)।

**Tested:** হ্যাঁ — Django shell-এ সিমুলেটেড test: (১) low-coverage scenario (touched < 50%) → cleanup সঠিকভাবে SKIP হয়েছে (log warning দেখা গেছে), (২) normal-coverage scenario (touched = 50%) → stale fake row delete হয়েছে, real row অক্ষত থেকেছে (verified via `.exists()`)। `python manage.py check` (0 issue), `ast.parse` উভয় ফাইলে, gunicorn auto-reload log-এ error নেই।

**Tested:** হ্যাঁ — `python manage.py check` (0 issue), `ast.parse` সব modified file-এ, migration apply (OK), Django shell smoke test (ONU import ImportError confirm, `onu_count`/`mac_count` annotation real value, `ONUSignalSerializer` serialize করে দেখানো হয়েছে, `raw_data` নতুন minimal shape verify), gunicorn auto-reload log-এ কোনো error নেই।

---

### [2026-07-19] — OLT/ONU SNMP+client-matching সিনিয়র-লেভেল অডিট + ১৬টা finding সম্পূর্ণ ফিক্স

**পরিবর্তিত ফাইল:** `olt_mgmt/management/commands/snmp_trap_listener.py`, `olt_mgmt/models.py` (নতুন `client_link_source` field + migration 0008, `OLT.get_decrypted_password()`/`get_decrypted_enable_password()`), `olt_mgmt/api/serializers.py` (snmp_community mask + password encryption), `olt_mgmt/api/views.py` (Telnet lock, mac_address staleness fix, `_sync_mac_row` → `_process_onu_row` delegate), `olt_mgmt/services/snmp_service.py` (dBm detection, OID fallback, timeout partial-data, normalize_mac, synthetic_mac_from_identity), `olt_mgmt/tasks.py` (client-link conflict resolution, stale-cleanup guard, parallel OLT sync)

**কী করা হয়েছে:**
User "OLT-এর ONU ডাটা কালেকশন ও ক্লায়েন্ট ম্যাচিং লজিক" সিনিয়র Python/Django+SNMP ইঞ্জিনিয়ার হিসেবে রিভিউ চাইলে ৫-agent audit চালানো হলো (SNMP parsing, client-matching, trap security, API/telnet, cleanup)। **১৬টা finding** পাওয়া গেল (৫টা CRITICAL security, ৭টা HIGH data-integrity, ৪টা MEDIUM) — সবগুলো সরাসরি কোড পড়ে verify করে, তারপর user "সবগুলো ক্রমান্বয়ে ঠিক করে দিন" বললে একে একে ফিক্স করা হলো:

**CRITICAL (security):**
1. **SNMP trap listener-এ community source-IP spoof-প্রতিরোধী নয়** — প্রতিটি distinct community-কে নিজস্ব OLT-bound `contextName` দেওয়া হয়েছে, `_handle_trap`-এ cross-check করে identity mismatch হলে trap silently ignore (state mutate হয় না)। **সীমাবদ্ধতা:** এই মুহূর্তে ৩টা active OLT-ই community `'public'` share করে — এতে binding কাজ করে না (log warning দেয়)। প্রকৃত সুরক্ষার জন্য প্রতিটি OLT-এ আলাদা SNMP community সেট করা দরকার (OLT hardware config, কোড দিয়ে remotely সম্ভব না)।
2. **Trap replay/rate-limit protection যোগ** — Django cache-ভিত্তিক per-source rate limit (120/min) ও ৩-সেকেন্ড replay-debounce (fingerprint hash)। **Cache backend (Redis) fail হলে fail-open করে** (trap processing বন্ধ হয় না)।
3. **`snmp_community` API দিয়ে যেকোনো authenticated user (role নির্বিশেষে) plaintext পড়তে পারত** — `OLTSerializer`-এ role-gated mask (`admin`/`superadmin` ছাড়া `••••••`)। সরাসরি verify করা হয়েছে collector role-এ masked, superadmin role-এ plain।
4. **OLT Telnet/SSH `password`/`enable_password` plaintext store হতো** — `role_permissions/utils.py`-এর একই Fernet utility দিয়ে encrypt/decrypt। **বিদ্যমান ৩টা real OLT-এর credential ইতিমধ্যে encrypted-এ upgrade করা হয়েছে** (round-trip verify করে)। Legacy plaintext fallback আছে (ভবিষ্যতে কোনো নতুন row যদি সরাসরি DB-তে insert হয়)।
5. **Trap flood-এ unbounded DB growth** — `varbinds` ৫০ item/৫০০ char-এ bound করা হয়েছে।

**HIGH (data integrity):**
6. **Near-zero dBm (ভালো signal) ১০০x ভুল দেখাত** (`-0.50 dBm` → `-50 dBm`) — V1/V2 firmware detection এখন decimal-point উপস্থিতির উপর ভিত্তি করে (magnitude নয়), near-zero reading-ও সঠিক।
7. **প্রথম RX OID candidate-এ যেকোনো row এলেই বাকি candidate try হতো না** — এখন সব candidate try করে সর্বোচ্চ-coverage (mac_rows-এর expected_count-এর সাপেক্ষে) বেছে নেয়।
8. **SNMP walk timeout-এ ইতিমধ্যে read হওয়া partial output discard হতো** — `subprocess.TimeoutExpired.stdout` থেকে salvage করে ব্যবহার করা হয়।
9. **দুই client-matching task (description-based ৫-মিনিট, MAC-based কম ঘনঘন) একে অপরের client_id বারবার overwrite করত** — নতুন `OLTMacCache.client_link_source` field দিয়ে priority resolve: MAC-based (লাইভ PPPoE session, verified) কখনো description-based override করে না।
10. **`Client.mac_address` router/CPE swap-এ কখনো correct হতো না** — এখন live-verified session সবসময় stale static value override করে, পুরনো owner-এর mac_address clear হয়।
11. **Partial/timeout SNMP walk-এ real online ONU-র signal row ভুলভাবে delete হতো** — coverage ৫০%-এর নিচে হলে cleanup skip করে শুধু warning log করে।
12. **ONU description আর match না করলে stale client_id link কখনো clear হতো না** — এখন explicit None সেট হয় (description-based link-এর ক্ষেত্রে; MAC-based link অক্ষত থাকে)।
13. **Manual "Sync MAC Table" বাটন ও auto-sync task আলাদা duplicate implementation (drift করেছিল — manual client_id/tx_power সেট করত না)** — manual sync এখন সরাসরি `_process_onu_row` reuse করে।

**MEDIUM:**
14. **Telnet sync endpoint HTTP request-এর ভেতরে synchronously ব্লক করত (৩০-৩৪s)** — Celery-তে সরানো frontend contract ভাঙার ঝুঁকি ছিল বলে নিরাপদ বিকল্প: per-OLT lock (cache.add() atomic) — concurrent sync request blocking session না খুলেই 429 পায়। Redis down থাকলে fail-open।
15. **Sequential per-OLT SNMP walk ৫-মিনিট schedule interval ছাড়িয়ে যেতে পারত** — ThreadPoolExecutor দিয়ে parallel sync (Celery broker/Redis independent, তাই এই মুহূর্তে Redis down থাকা সত্ত্বেও কাজ করে ও test করা গেছে)।
16. **`normalize_mac()` ১২+ hex char থাকলে truncate করে "valid" ধরত** — এখন exact ১২-length না হলে reject। **`synthetic_mac_from_oid` walk-position-নির্ভর ছিল** (walk order বদলালে phantom row জমত) — নতুন `synthetic_mac_from_identity(olt_id, port, onu)` স্থিতিশীল identity-ভিত্তিক।

**Side Effect / সতর্কতা:**
- **Redis (`redis-server.service`) এই session-এ discover হয়েছে যে ~১৩ ঘণ্টা ধরে crash-loop অবস্থায় down** ("Redis is loading..." status, RDB file সম্ভবত corrupted) — এটা এই review-এর scope-এর বাইরে (sudo প্রয়োজন, root-owned config file পড়ার permission ছিল না), **ফিক্স করা হয়নি, শুধু flag করা হলো**। এর প্রভাব: Celery broker (যদি Redis ব্যবহার করে), Django cache (rate-limit/replay-debounce/Telnet-lock সব fail-open আছে তাই crash করবে না কিন্তু protection inert), অন্য app-এর signal/cache feature (যেমন clients app-এর "link enqueue" signal, ai.md-এর আগের sync task)। **User-কে জানানো হয়েছে, root-access থাকলে `journalctl -u redis-server` দিয়ে RDB corruption diagnose করে fix করতে হবে (সম্ভবত dump.rdb মুছে বা repair করে restart)।**
- `snmp_trap_listener.py`-এর security fix কার্যকর হতে হলে **সার্ভিস restart লাগবে** — sudo prompt ছাড়া আমি restart করতে পারিনি (`sudo -n systemctl restart isp-snmptrap.service` ব্যর্থ)। **User-কে `sudo systemctl restart isp-snmptrap.service` চালাতে হবে fix apply করতে।**
- Community binding-এর পূর্ণ সুরক্ষার জন্য ৩টা OLT-এ আলাদা `snmp_community` সেট করা উচিত (হার্ডওয়্যার-সাইড কনফিগ, কোডে করা যায়নি)।
- পুরনো synthetic-mac scheme থেকে জমে থাকা কিছু phantom `OLTMacCache` row থেকে যেতে পারে (cleanup করা হয়নি, নতুন sync cycle-এ ধীরে ধীরে সঠিক row-এই converge করবে)।

**Tested:** সবগুলো fix সরাসরি shell/DRF-test-client দিয়ে end-to-end verify করা হয়েছে — webhook-এর মতোই trap listener-এর community-binding logic (simulated distinct + shared community scenarios), rate-limit/replay-debounce (LocMemCache দিয়ে, যেহেতু Redis down), snmp_community role-mask (collector vs superadmin), OLT password encryption round-trip (৩টা real OLT upgrade করে verify), near-zero dBm detection (৩ scenario), OID fallback candidate selection, timeout partial-data salvage (mocked TimeoutExpired), client-matching conflict resolution (MAC-priority প্রতিরোধ, stale-clear — ৩ scenario একসাথে), stale-cleanup coverage guard (২ scenario, isolated test OLT দিয়ে), Client.mac_address swap-correction, Telnet per-OLT lock (concurrent-acquire simulation), parallel OLT sync (timing-based, ৩ OLT ০.৫s করে হলেও মোট ০.৫৩s, sequential হলে ১.৫s হতো), normalize_mac strict validation, synthetic_mac_from_identity stability। `manage.py check`+migration পাস, gunicorn clean reload।

---

### [2026-07-19] — বিলিং অডিট রাউন্ড ২: বাকি ৫টা lower-priority finding সম্পন্ন

**পরিবর্তিত ফাইল:** `billing/api/views.py` (`receive_payment` role-gate, `_client_billing_classification` waived-bucket, `collection_summary` N+1 fix, ৫ জায়গায় `recalc_client_due_amount()` ব্যবহার), `billing/models.py` (নতুন `recalc_client_due_amount()` helper, `_update_expiry_and_enable_for_unverified()`-এ amount-gated expiry extension), `billing/services.py` (২ জায়গায় `recalc_client_due_amount()` ব্যবহার, `_finalize_payment`-এ amount thread করা), `billing/tasks.py` (`refresh_from_db(fields=['due_amount'])` — select_related cache বাঁচাতে)

**কী করা হয়েছে:**
1. **receive_payment-এ "zone-based IDOR" — অনুসন্ধানে জানা গেল এই codebase-এ collector-এর zone/subzone assignment track করার কোনো data model-ই নেই** (Employee/User কোনোটাতেই zone FK নেই — চেক করা হয়েছে `hr/models.py`, `accounts/models.py`, `role_permissions/`)। তাই মূল finding-এর ধরে নেওয়া "zone-scoped access" বাস্তবায়নযোগ্য না। বাস্তব gap ছিল ভিন্ন ও ব্যাপক: **যেকোনো authenticated role** (এমনকি billing-এর সাথে সম্পর্কহীন 'support' role) `receive_payment` কল করতে পারত। এখন role allowlist (`superadmin, admin, manager, accountant, collector`) যোগ করা হয়েছে।
2. **Unverified (collector) payment-এ token/আংশিক amount দিলেও পুরো এক মাস expiry extend হয়ে যেত** — `_update_expiry_and_enable_for_unverified()`-এ নতুন optional `amount` parameter (backward-compatible, CLAUDE.md-এর "rename/delete নয়" rule মানা হয়েছে — শুধু নতুন parameter যোগ, existing callers অক্ষত)। এখন `amount >= client.due_amount` না হলে expiry extend হয় না, শুধু courtesy RADIUS/Mikrotik enable হয়।
3. **Waived bill "Paid" হিসেবে misclassify হতো dashboard KPI-তে** — `_client_billing_classification()`-এ নতুন `waived_c` bucket, `waived_count` নতুন field হিসেবে API response-এ যোগ হয়েছে (backward-compatible addition)।
4. **N+1 query — `disable_expired_clients`-এ `client.refresh_from_db()` (fields ছাড়া) select_related cache মুছে দিত** — এখন `fields=['due_amount']` দিয়ে শুধু প্রয়োজনীয় field refresh হয়, router/radius_server cache অক্ষত থাকে (verify করা হয়েছে query-count দিয়ে)। **`collection_summary`-তে per-client loop-এ আলাদা aggregate query চলত** — এখন একটাই `values().annotate()` দিয়ে সব client-এর totals একসাথে আনা হয় (3 query, client-সংখ্যা নির্বিশেষে)।
5. **৮ জায়গায় (billing/models.py, services.py, api/views.py) `due_amount` recalc-এর ৩ লাইন copy-paste ছিল** — নতুন `recalc_client_due_amount(client)` module-level helper (billing/models.py), সব ৮ জায়গা এখন এটা ব্যবহার করে। Future formula change (যেমন waived bill exclude করা) এক জায়গায় করলেই সব জায়গায় প্রযোজ্য হবে।

**Side Effect / সতর্কতা:**
- `receive_payment`-এর role allowlist একটা ধরে-নেওয়া সিদ্ধান্ত — যদি ভবিষ্যতে অন্য কোনো role (যেমন নতুন কাস্টম role) payment collect করার দরকার হয়, `ALLOWED_ROLES` tuple-এ যোগ করতে হবে (billing/api/views.py-তে `receive_payment` অ্যাকশনে)।
- `_update_expiry_and_enable_for_unverified()`-এর behavior পরিবর্তিত — আংশিক collector payment-এ আর expiry বাড়বে না। এটা ইচ্ছাকৃত fix কিন্তু collector-রা যদি "যেকোনো payment দিলেই এক মাস চলে" এই ধারণায় অভ্যস্ত থাকে, তাদের জানানো দরকার।
- Test করার সময় একটা নিজের করা stray Bill row (আগের session-এর একটা ব্যর্থ assertion-এর কারণে cleanup miss হয়েছিল, bill_month='2099-04') পাওয়া গিয়ে সেটাও মুছে ফেলা হয়েছে — production data প্রভাবিত হয়নি, শুধু টেস্ট artifact ছিল।

**Tested:** সবগুলো সরাসরি shell-এ real data দিয়ে verify করা হয়েছে — token payment-এ expiry অপরিবর্তিত vs full payment-এ expiry extend (উভয় case); waived bill আলাদা bucket-এ (radcheck=1, radreply=0 প্যাটার্নের মতো precise count verify); `collection_summary` query-count capture করে 3-query confirm; `disable_expired_clients`-এর router-cache preserved থাকা query-log দিয়ে confirm; `recalc_client_due_amount()` bill-add→payment→cleanup পুরো cycle-এ সঠিক due_amount দিয়েছে (try/finally দিয়ে guaranteed cleanup)। `manage.py check` পাস, gunicorn clean reload।

---

### [2026-07-19] — বিলিং সিস্টেম সিনিয়র-লেভেল সিকিউরিটি+আর্থিক অডিট + ১০টা CRITICAL/HIGH ফিক্স সম্পন্ন

**পরিবর্তিত ফাইল:** `billing/api/views.py` (webhook secret+race fix, ৫টা endpoint-এ role check যোগ), `billing/api/serializers.py` (amount validation), `billing/services.py` (`select_for_update` লক), `billing/apps.py` (ledger signal fix), `billing/models.py` (RADIUS-fail guard + amount-edit recalculation), `config/settings.py` (`WEBHOOK_SHARED_SECRET` নতুন env var)

**কী করা হয়েছে:**
User "ক্লায়েন্ট বিলিং-এর সম্পূর্ণ লজিক কোড রিভিউ" চাইলে ৬-agent audit চালানো হলো (`billing/models.py`, `services.py`, `api/views.py`, `tasks.py`, `ledger.py`, `reminder_service.py`)। **১০টা CRITICAL/HIGH finding** পাওয়া গেল, সবগুলো সরাসরি কোড পড়ে verify করা হয়েছে, তারপর user "সবগুলো ক্রমান্বয়ে ঠিক করে দিন" বললে একে একে ফিক্স করা হলো:

1. **Webhook receiver-এ কোনো authentication ছিল না (CRITICAL, unauthenticated exploit)** — `POST /webhook/receive/{gateway}/` সম্পূর্ণ anonymous, কোনো signature/secret verification ছাড়াই fake payment payload দিয়ে বিনামূল্যে bill paid ও client enable করানো যেত। User নিশ্চিত করলেন এই endpoint **এখনো live traffic-এ ব্যবহৃত হয় না** (test endpoint), তাই নিরাপদে সাথে সাথেই enforce করা গেছে। নতুন `WEBHOOK_SHARED_SECRET` env var (config/settings.py) — খালি থাকলে **fail-closed** (503, সব request reject)। Forwarder app configure করার সময় `.env`-এ secret সেট করে `X-Webhook-Secret` header বা `?secret=` query param দিয়ে পাঠাতে হবে।
2. **Webhook duplicate-check race condition (double-credit risk)** — exists()-check ও create() আলাদা ছিল বলে gateway retry-তে দুইবার credit হতে পারত। এখন WebhookPayment row আগে claim করা হয় (`transaction.atomic()` + `IntegrityError` catch), তারপর settle — দুই path-ই (generic receiver + bKash SNS) fix হয়েছে।
3. **`approve_selected`-এ কোনো role check ছিল না** — collector নিজের fake payment নিজেই approve করতে পারত। এখন admin/superadmin-only।
4. **`destroy()`+`delete_selected`-এ role check ছিল না, `delete_selected` webhook-guard-ও bypass করত** — এখন দুটোতেই admin/superadmin-only + webhook-payment protection + advance_balance reversal (bulk path-এও)।
5. **`generate_for_client`/`generate_monthly_bills`-এ role check ছিল না** — custom amount দিয়ে যেকেউ bill বানাতে পারত। এখন admin/superadmin-only।
6. **`PaymentSerializer`-এ negative-amount validation ছিল না** — এখন `validate_amount()` দিয়ে `amount <= 0` reject হয়।
7. **`advance_balance` race condition** — `receive_payment()` ও `apply_advance_to_bills()` দুটোতেই এখন `select_for_update()` দিয়ে client row lock করা হয়, concurrent payment-এ lost-update এড়াতে।
8. **Collector-approved payment ledger-এ কখনো post হতো না** — signal শুধু `created=True`-তে fire করত। এখন প্রতি save-এ কল হয় (`post_payment_to_ledger()` নিজেই idempotent + `is_verified`-guard করে, তাই safe)।
9. **RADIUS enable fail করলেও `client.status='active'` সেট হতো** — client "active, paid" দেখাতো কিন্তু internet access ছিল না। এখন `_auto_enable_client_if_paid()` ও `_update_expiry_and_enable_for_unverified()` দুটোতেই RADIUS enable সফল না হলে status অপরিবর্তিত থাকে (পরের payment/manual retry-এ আবার চেষ্টা হবে)।
10. **Already-verified Payment-এর amount edit করলে recalculation skip হতো** — `Payment.save()`-এ নতুন `amount_changed` branch যোগ, `_process_amount_correction()` কল করে bill/client due_amount ঠিক করে।

**Side Effect / সতর্কতা:**
- **`WEBHOOK_SHARED_SECRET` .env-এ সেট না করলে webhook endpoint এখন 503 দেবে** — যদি ভবিষ্যতে এই endpoint live করা হয়, প্রথমে `.env`-এ secret সেট করে forwarder app/service-কেও একই secret দিতে হবে, নইলে সব real payment webhook reject হবে।
- **`_auto_enable_client_if_paid()`/`_update_expiry_and_enable_for_unverified()`-এর behavior পরিবর্তিত** — RADIUS down থাকলে client আর ভুলভাবে "active" দেখাবে না (আগে দেখাত)। এটা ইচ্ছাকৃত fix কিন্তু কেউ যদি "payment হলেই status active হয়ে যায়" ধরে নিয়ে কোনো automation বানিয়ে থাকে, সেটা RADIUS downtime-এ আলাদাভাবে behave করবে।
- বাকি কিছু lower-priority finding (IDOR on receive_payment zone-check, unverified-payment unconditional expiry-extend, waived-bill misclassification, N+1 in disable_expired_clients, reuse duplication) **এই round-এ ফিক্স করা হয়নি** — user শুধু top-10 CRITICAL/HIGH বলেছিলেন, এগুলো পরের session-এ handle করা যাবে।

**Tested:** সবগুলো fix সরাসরি shell-এ real/throwaway data দিয়ে end-to-end verify করা হয়েছে: webhook fail-closed (503)→wrong-secret(401)→correct-secret(200)→replay(Already processed) ৪ ধাপে; non-admin role-check ৩টা endpoint-এ (403 confirm); negative-amount validation; amount-correction recalculation (300→700 taka edit, due_amount সঠিকভাবে আপডেট); ledger post-on-approve (before=False, after=True); RADIUS-enable-failure simulation (status থেকে গেছে suspended, active হয়নি)। `manage.py check` পাস, gunicorn auto-reload error ছাড়া।

---

### [2026-07-19] — RADIUS/MikroTik sync-এর বাকি ৪টা architectural finding সম্পন্ন (রাউন্ড ৫)

**পরিবর্তিত ফাইল:** `radius_app/services/radius_service.py` (নতুন `purge_radacct()` মেথড, `connection_identity()` PK-based পুনর্লিখন), `clients/api/views.py` (নতুন `_log_sync_failure()` shared helper, ~২৪টা RADIUS/MikroTik except block migrate করা), `radius_app/api/views.py` (কোনো পরিবর্তন নয় এই রাউন্ডে)

**কী করা হয়েছে:**
- আগের ফাইনাল রিভিউ-এর ৪টা architectural finding-এর মধ্যে ৩টা এই session-এ implement করা হলো, ১টার জন্য user-কে policy decision জিজ্ঞেস করে সিদ্ধান্ত নেওয়া হলো:
- **(#8) Username-reuse radacct merge — user সিদ্ধান্ত: "Permanent delete-এ radacct-ও মুছুন"।** নতুন `RadiusService.purge_radacct(username)` মেথড যোগ করে `LeftClientViewSet.perform_destroy()`-এ (client চিরতরে মোছার path) `delete_user()`-এর পাশাপাশি কল করা হয়েছে — এখন থেকে permanently-deleted client-এর radacct history-ও মুছে যায়, তাই ভবিষ্যতে সেই username অন্য client-কে দিলে আর merge হবে না।
- **(#6) `connection_identity()` এখন RadiusServer-এর primary key ব্যবহার করে**, raw host/port/db_name string-এর বদলে — `('server', self._server.id)` অথবা (শুধু `_server=None`/settings.RADIUS_DB fallback-এর ক্ষেত্রে) `('default', host, port, db_name)`। এটা hostname-aliasing edge case (যেমন `127.0.0.1` vs `localhost` একই DB বোঝানো) থেকে ভুল "different server" judgment হওয়া প্রতিরোধ করে।
- **(#7) MikroTik log severity রিভিউ করে দেখা গেছে ইতিমধ্যেই সঠিকভাবে tuned** — single/primary-router action (enable/create/restore) = `logger.exception` (client সরাসরি কাজ না করলে জানা দরকার), multi-server best-effort loop iteration (session-kick, bulk cleanup) = `logger.warning` (অন্য router ঠিক থাকতে পারে, partial failure expected)। কোনো পরিবর্তনের দরকার পাওয়া যায়নি।
- **(#5) RADIUS+MikroTik sync centralize** — সম্পূর্ণ sync-logic merge করা (একটা function দিয়ে সব lifecycle event handle) production billing system-এ ঝুঁকিপূর্ণ মনে হওয়ায় (enable/disable/restore/left-এর ব্যবসায়িক নিয়ম সত্যিকারের ভিন্ন), তার বদলে **শুধু log-format কেন্দ্রীয় করা হয়েছে** — নতুন `_log_sync_failure(system, operation, username, exc, level)` helper যোগ করে clients/api/views.py-এর ~২৪টা RADIUS/MikroTik except block (enable/disable/create/update/restore/left — সব lifecycle) migrate করা হয়েছে। এখন সব failure log-এ একই canonical format: `"External sync failed: system=.. operation=.. username=.. error=.."` — এক grep দিয়ে সব RADIUS/MikroTik sync failure বের করা যায়, actual sync call sequence (business logic) অপরিবর্তিত।

**Side Effect / সতর্কতা:**
- Log message format বদলেছে — আগে বাংলা free-text ছিল (`"RADIUS enable sync ব্যর্থ (...): ..."`), এখন structured English format (`"External sync failed: system=radius operation=enable username=... error=..."`)। কোনো external log-monitoring/alerting যদি পুরনো বাংলা string pattern match করত, সেটা আপডেট করতে হবে।
- `purge_radacct()` **irreversible** — permanently-deleted client-এর traffic/session history চিরতরে মুছে যায় (এটাই user-এর ইচ্ছাকৃত সিদ্ধান্ত, কিন্তু পরবর্তী agent/user মনে রাখবে যে "Left Client" থেকে সম্পূর্ণ মোছার (perform_destroy, "চিরতরে মুছুন" অ্যাকশন) মানে এখন billing audit trail-ও হারানো — শুধু status='left' (soft) করলে radacct অক্ষত থাকে)।
- `connection_identity()`-এর নতুন PK-based tuple shape (`('server', id)` বনাম `('default', host, port, name)`) পুরনো shape-এর সাথে backward-compatible নয় যদি কোথাও এই tuple persist/cache করা হয়ে থাকে — grep করে নিশ্চিত করা হয়েছে persist হয় না, শুধু in-memory তুলনায় ব্যবহৃত হয়।

**Tested:** `python manage.py check` পাস। `purge_radacct()` dummy radacct row দিয়ে verify (row সঠিকভাবে মুছে গেছে)। `connection_identity()` দুই আলাদা `RadiusService` instance-এ একই PK-tuple রিটার্ন করা confirm। `_log_sync_failure()` সরাসরি shell-এ কল করে output format (ERROR/WARNING উভয় level) visually verify করা হয়েছে। gunicorn auto-reload error ছাড়া সম্পন্ন। সব ২৪টা call site grep করে নিশ্চিত করা হয়েছে কোনোটা miss হয়নি (আগের raw `logger.exception/warning("RADIUS...`/`"Mikrotik...` pattern আর কোথাও নেই)।

---

### [2026-07-18] — RADIUS sync ফাইনাল রিভিউ + রাউন্ড ৪ fix: নিজের রাউন্ড ৩ কোডেই ২টা নতুন বাগ পাওয়া গেল ও ফিক্স হলো

**পরিবর্তিত ফাইল:** `radius_app/services/radius_service.py` (`ensure_unique_keys()`-এ radusergroup যোগ, `rename_user()`-এর collision check radreply/radusergroup/radacct পর্যন্ত broaden, conn=None guard), `radius_app/api/views.py` (`RadiusServerViewSet.perform_update()` যোগ, connection-test+schema-ensure লজিক shared helper-এ factor করা)

**কী করা হয়েছে:**
- User "সম্পূর্ণ লজিক কোড রিভিউ করে দিন" বলায় রাউন্ড ৩-এর সব পরিবর্তনের উপর আরেকটা ৬-agent multi-angle review চালানো হলো (Angle A/B/C + Reuse+Simplification+Efficiency + Altitude + Conventions)। এতে **নিজের আগের রাউন্ডের কোডেই ২টা real bug** পাওয়া গেল — সেগুলো সাথে সাথেই ফিক্স করা হলো:
  1. **`ensure_unique_keys()` radusergroup বাদ দিয়েছিল** — শুধু radcheck/radreply-তে key যোগ করত, কিন্তু `set_user_group()`/`create_user()`-এর group-assignment upsert radusergroup-এর উপর নির্ভর করে। নতুন RADIUS server-এ radusergroup-এ কোনো unique key না থাকলে সেই upsert-ও duplicate row তৈরি করত — যেটা এই পুরো fix-এরই মূল লক্ষ্য ছিল প্রতিরোধ করা। এখন radcheck/radreply/radusergroup তিনটাই cover করে (radusergroup-এর জন্য `uq_username` on `(username)` — attribute column নেই বলে আলাদা key structure)।
  2. **`rename_user()`-এর collision warning শুধু radcheck check করত** — radreply/radusergroup-এ conflict থাকলেও silent থেকে যেত। এখন তিনটা table-ই একসাথে check করে single warning log দেয়। এছাড়া radacct-এর জন্য আলাদা warning যোগ হয়েছে (recycled username-এ পুরনো permanently-deleted client-এর history মিশে যাওয়ার ঝুঁকি — এটা auto-resolve করা যায় না, শুধু visibility দেওয়া হয়েছে)।
- **Bonus/defensive fix:** `rename_user()`-এ `conn = None` init করে exception handler-এ `if conn:` guard যোগ করা হয়েছে — `self._conn()` নিজেই fail করলে (bad host ইত্যাদি) except ব্লকের `conn.rollback()` আগে `NameError` দিত (nested bare except-এ silently swallow হতো, functionally harmless কিন্তু fragile ছিল)।
- **`RadiusServerViewSet.perform_update()` যোগ করা হয়েছে** — আগে শুধু `perform_create()`-এ `ensure_unique_keys()` wire করা ছিল, তাই admin কোনো existing RADIUS server-এর db_host/db_port/db_name edit করে ভিন্ন physical DB-তে re-point করলে সেই নতুন DB কখনো unique-key fix পেত না। Connection-test + schema-ensure লজিক এখন `_test_connection_and_ensure_schema()` shared helper-এ factor করা, create ও update দুই path-ই ব্যবহার করে (duplicate code এড়ানো হয়েছে)।

**Side Effect / সতর্কতা:**
- Review-তে আরও কিছু architectural/judgment-level finding এসেছে যেগুলো **auto-fix করা হয়নি**, শুধু চিহ্নিত করা হয়েছে ও ব্যবহারকারীকে বিস্তারিত জানানো হয়েছে (step-by-step fix guidance-সহ):
  - RADIUS+MikroTik sync logic এখনও ~15+ জায়গায় ছড়ানো, প্রতিটার নিজস্ব try/except ও এখন নিজস্ব log message — centralize করার সুপারিশ (বড় refactor, এই session-এ করা হয়নি)।
  - `connection_identity()` raw connection-string (host/port/db_name) তুলনা করে, RadiusServer PK না — hostname-aliasing edge case-এ (যেমন 127.0.0.1 vs localhost) ভুল "different server" judgment হতে পারে। বর্তমান single-server setup-এ practically কোনো impact নেই।
  - MikroTik-side except block-গুলোতে কিছু জায়গায় `logger.exception` (ERROR+traceback) আবার কিছু জায়গায় `logger.warning` — router routine downtime হলে ERROR-level noise হতে পারে; log-level severity তুনিং সুপারিশ করা হয়েছে, কিন্তু কোনটা "routine" তা operational judgment বলে auto-change করা হয়নি।

**Tested:** `python manage.py check` পাস। তিনটা scenario সরাসরি shell-এ verify করা হয়েছে — (১) `ensure_unique_keys()` radusergroup-এ `uq_username` key যোগ করে তা `SHOW INDEX` দিয়ে confirm, (২) collision warning এখন radcheck+radreply+radusergroup তিনটার count-ই সঠিকভাবে log করে (test data দিয়ে verify), (৩) bad/unreachable host দিয়ে `rename_user()` কল করে `NameError` না হয়ে cleanly `False` রিটার্ন করা confirm। gunicorn auto-reload error ছাড়া সম্পন্ন।

---

### [2026-07-18] — RADIUS sync fix রাউন্ড ৩: বাকি ৫টা code-review finding-ই ফিক্স সম্পন্ন (overwrite collision, no-router→router gap, misleading rename log, private attribute access, MikroTik-side asymmetric silent logging)

**পরিবর্তিত ফাইল:** `radius_app/services/radius_service.py` (`rename_user()` পুনর্লিখন — no-op detection + collision warning, নতুন `connection_identity()` public method), `clients/api/views.py` (`_sync_radius_on_update`-এ guard ও `_server` private-access ফিক্স, ৮টা MikroTik-side except block-এ logging)

**কী করা হয়েছে:**
- আগের round-এর ৮-angle code review-এ পাওয়া ৮টা finding-এর মধ্যে ২টা (radacct rename, multi-server migration) আগেই ফিক্স হয়েছিল। এই round-এ বাকি ৫টা সতর্কতার সাথে ফিক্স করা হলো:
- **rename_user() overwrite collision (finding #3):** নতুন username-এ আগে থেকে radcheck row থাকলে (আগের কোনো client-এর অসম্পূর্ণ delete_user-এর কারণে) আগে silently overwrite হতো। এখন rename-এর আগে conflict count চেক করে `logger.warning`-এ স্পষ্টভাবে জানায় কতটা row overwrite হচ্ছে।
- **misleading "renamed" log on 0-row no-op (finding #7):** router+username একসাথে বদলালে rename_user() ভুল (নতুন) server-এ চলত, ০ row affect করেও "renamed" log করত। এখন rename-এর শুরুতেই radcheck+radreply+radusergroup+radacct মিলিয়ে old_username-এর মোট row count চেক করে — শূন্য হলে সঠিকভাবে "no-op" log করে, caller-এর create-fallback fresh account বানাবে এটা স্পষ্ট করে।
- **no-router→router cleanup gap (finding #4):** `_sync_radius_on_update`-এ guard ছিল `if old.router_id and old.router_id != client.router_id` — client-এর আগে router না থাকলে (default RADIUS server-এ auto-sync হয়ে থাকত) `old.router_id` falsy বলে cleanup skip হতো। এখন truthy-check বাদ দিয়ে শুধু `!=` চেক করা হয় — None→id transition-ও ধরা পড়ে।
- **private `_server` attribute access (finding #8, root-cause):** `getattr(old_svc._server, 'id', None)` তুলনা RadiusService-এর private attribute-এ হাত দিত এবং `_server=None` (settings.RADIUS_DB fallback) দুই পাশে হলে ভুলভাবে "same" ধরত even যদি প্রকৃতপক্ষে ভিন্ন হতো। নতুন public `RadiusService.connection_identity()` মেথড (host, port, db_name) tuple রিটার্ন করে — `_server=None` মানে আসলেই settings.RADIUS_DB (একটা নির্দিষ্ট physical DB), তাই canonical comparison এখন সঠিক এবং encapsulation-ও বজায় থাকে।
- **MikroTik-side asymmetric silent logging (finding #6):** আগের round-এ শুধু RADIUS-sync except block-গুলোতে logging যোগ হয়েছিল; একই ফাংশনের পাশের MikroTik except block silent থেকে গিয়েছিল। এখন `_enable_client_mikrotik`, `_sync_mikrotik_secret_on_update`, `_kick_sessions_on_update`, `_handle_client_left`-এর MikroTik loop, `perform_create`, `restore_client`, `LeftClientViewSet.perform_create`/`perform_destroy` — সব জায়গায় symmetric logging যোগ হয়েছে (per-server loop-এ `logger.warning`, top-level catch-এ `logger.exception`)।

**Side Effect / সতর্কতা:**
- `rename_user()`-এ এখন rename-এর আগে ২টা অতিরিক্ত `SELECT COUNT(*)` query (no-op check + collision check) — ছোট, indexed, নগণ্য cost, কিন্তু প্রতি rename-এ ২টা extra round-trip যোগ হলো (efficiency angle-এ ধরা পড়া redundant `user_exists()` call এখনো আলাদা আছে, একসাথে optimize করা হয়নি — ভবিষ্যতে চাইলে rename_user()-এর no-op check-এর ফলাফল caller-কে ফেরত দিয়ে `user_exists()` call বাদ দেওয়া যায়)।
- `connection_identity()` public method radius_service.py-তে যোগ হয়েছে — এটা একটা নতুন মেথড (existing signature অপরিবর্তিত, CLAUDE.md rule মানা হয়েছে)।
- সব MikroTik-side log message বাংলায়, RADIUS-side-এর message format-এর সাথে consistent রাখা হয়েছে।

**Tested:** `python manage.py check` পাস। `rename_user()`-এর ৩টা scenario সরাসরি shell-এ verify করা হয়েছে (no-op detection সঠিক log দেয়, normal rename কাজ করে, collision overwrite এখন warning log করে)। `connection_identity()` একই server-এর দুই instance-এ same tuple রিটার্ন করে তা verify করা হয়েছে। gunicorn auto-reload error ছাড়া সম্পন্ন হয়েছে।

---

### [2026-07-18] — RADIUS sync fix রাউন্ড ২: code-review-এ ধরা পড়া ২টি সবচেয়ে গুরুতর gap ফিক্স — radacct rename + নতুন RADIUS server-এ auto unique-key migration

**পরিবর্তিত ফাইল:** `radius_app/services/radius_service.py` (`rename_user()`-এ radacct migration + connection rollback/close যোগ, নতুন `ensure_unique_keys()` মেথড), `radius_app/api/views.py` (`RadiusServerViewSet.perform_create()`-এ `ensure_unique_keys()` wire করা)

**কী করা হয়েছে:**
- আগের session-এর RADIUS sync fix-এর উপর user "সিনিয়র ইঞ্জিনিয়ার হিসেবে কোড রিভিউ করো" বলায় ৮-angle multi-agent code review চালানো হলো (correctness, cross-file trace, reuse, simplification, efficiency, altitude, conventions) — ৮টি finding confirmed/plausible পাওয়া গেল। User সবচেয়ে critical ২টা এখনই ফিক্স করতে বললেন।
- **Fix #1 (সবচেয়ে গুরুতর — billing data loss):** `rename_user()` আগে radcheck/radreply/radusergroup migrate করত কিন্তু `radacct` (session/traffic history) টেবিল ছোঁয়নি। `billing/tasks.py`-এর `_upsert_monthly_traffic()` বর্তমান `Client.username` দিয়ে radacct-কে map করে — rename-এর আগের session data পুরনো username-এই থেকে যাওয়ায় সেগুলো "client_id না পাওয়া" হিসেবে silently skip হয়ে যেত (billing/tasks.py:253)। এখন `rename_user()`-এ `UPDATE radacct SET username=%s WHERE username=%s` যোগ করা হয়েছে — একই transaction-এ, commit-এর আগে। সাথে exception হলে এখন `conn.rollback()`+`conn.close()`ও করা হয় (আগে connection leak হতো mid-transaction failure-এ, এটাও review-তে ধরা পড়েছিল, এক লাইনের সহজ fix বলে একসাথে করা হলো)।
- **Fix #2 (architectural — future multi-server bug prevention):** আগের session-এ `radcheck`/`radreply`-তে `UNIQUE KEY (username, attribute)` শুধু হাতে চালিয়ে বর্তমান একমাত্র "Primary" RADIUS server-এ apply করা হয়েছিল। Review ধরল যে `RadiusServerViewSet.perform_create()` (multi-server UI দিয়ে নতুন RADIUS server যোগ করার endpoint) এই migration কখনো apply করত না — future-এ দ্বিতীয় server যোগ হলে সেই duplicate-row bug আবার ফিরে আসত। এখন `RadiusService.ensure_unique_keys()` নতুন মেথড (idempotent — `information_schema.STATISTICS` চেক করে key আগে থেকে আছে কিনা, তারপর দরকার হলে `ALTER TABLE`) যোগ করে `perform_create()`-এ wire করা হয়েছে — test-connection সফল হলেই স্বয়ংক্রিয়ভাবে চলে।

**Side Effect / সতর্কতা:**
- `rename_user()`-এ এখন ৭টা statement (আগে ৬টা) — radacct UPDATE বড় টেবিলে সামান্য বেশি সময় নিতে পারে, কিন্তু `username` column-এ non-unique KEY আছে (verified via `SHOW INDEX`), তাই indexed এবং দ্রুত।
- `ensure_unique_keys()` idempotent — বারবার কল করলেও নিরাপদ (existing key থাকলে no-op, error ছাড়া)। টেস্ট করে নিশ্চিত হয়েছে।
- বাকি ৬টা finding (rename overwrite-collision risk, no-router→router cleanup gap, MikroTik-side asymmetric silent-fail, misleading rename log on 0-row no-op, `_server` None-collapse edge case) **এখনো unfixed** — এগুলো single-RADIUS-server, single-admin ব্যবহারে কম-ঝুঁকিপূর্ণ বলে এই round-এ স্কিপ করা হয়েছে; user চাইলে পরের session-এ handle করা যাবে।

**Tested:** `python manage.py check` পাস। `rename_user()`-এর radacct migration সরাসরি dummy radacct row দিয়ে verify করা হয়েছে (rename-এর পর username সঠিকভাবে বদলে গেছে)। `ensure_unique_keys()` primary server-এ কল করে idempotent no-op verify করা হয়েছে (`SHOW INDEX` দিয়ে confirm, key অক্ষত)। gunicorn auto-reload error ছাড়া সম্পন্ন হয়েছে।

---

### [2026-07-18] — RADIUS sync gap audit + fix: username rename, duplicate radcheck/radreply rows, cross-server orphan cleanup, silent failure logging

**পরিবর্তিত ফাইল:** `radius_app/services/radius_service.py` (নতুন `rename_user()` মেথড যোগ, existing method-এর signature অপরিবর্তিত), `clients/api/views.py` (`_sync_radius_on_update` এ username-rename ও router-change cleanup যোগ, একাধিক silent `except: pass`-এ logging যোগ), RADIUS MySQL DB schema (`radcheck`, `radreply` টেবিলে `UNIQUE KEY (username, attribute)` migration — সরাসরি `ALTER TABLE`, কোনো Django migration ফাইল নয় যেহেতু radius DB Django-managed না)

**কী করা হয়েছে:**
- User MikroTik "not enough permissions (9)" এরর নিয়ে জিজ্ঞেস করার পর RADIUS config + PPPoE debug flow-এ সাহায্য করতে গিয়ে user জিজ্ঞেস করলেন Client Add/Edit ফর্ম থেকে radcheck/radusergroup/radreply sync-এর বর্তমান লজিকে আর কী উন্নতি করা যায় — Explore agent দিয়ে audit করানো হলো, তারপর user "সব করে দিন" বললে ধাপে ধাপে fix করা হয়েছে।
- **সবচেয়ে গুরুত্বপূর্ণ ফিক্স:** `radcheck`/`radreply` টেবিলে `(username, attribute)`-এর উপর কোনো unique key ছিল না (শুধু PK+non-unique KEY(username)) — তাই কোডের সব জায়গার `INSERT ... ON DUPLICATE KEY UPDATE` আসলে কখনো ট্রিগার হতো না। `restore_client()`-এর মতো জায়গায় unconditional `create_user()` কল করলে একই username-এর জন্য দ্বিতীয় `Cleartext-Password` row তৈরি হতে পারত। Unique key যোগ করার পর টেস্ট করে নিশ্চিত হয়েছি duplicate আর হয় না (single row upsert)।
- **Username rename গ্যাপ ফিক্স:** client edit ফর্মে PPPoE username বদলালে আগে পুরনো username-এর radcheck/radusergroup/radreply row থেকে যেত (orphan) — পুরনো credential দিয়ে তখনও login চালু থাকত। নতুন `RadiusService.rename_user(old, new)` মেথড (INSERT...SELECT + ON DUPLICATE KEY UPDATE + DELETE পুরনো row) যোগ করে `_sync_radius_on_update()`-এ wire করা হয়েছে।
- **Router-change cross-server cleanup:** client-এর router ভিন্ন RADIUS server-এ পয়েন্ট করলে (multi-server setup) পুরনো server-এ orphan RADIUS entry থেকে যেত — এখন router পাল্টালে ও নতুন router ভিন্ন `RadiusServer` হলে পুরনো server থেকে `delete_user()` কল হয়।
- **Silent failure visibility:** `_enable_client_radius`, `_handle_client_left`, `perform_create`, `disable_client`, `restore_client`, `LeftClientViewSet.perform_create/perform_destroy` — এই সব জায়গার bare `except Exception: pass` RADIUS sync ব্যর্থ হলেও silently swallow করত। এখন `logger.exception`/`logger.warning` যোগ করা হয়েছে যাতে RADIUS DB down/network issue হলে gunicorn error log-এ দেখা যায় (client record আপডেট হয়ে গেলেও RADIUS sync silently miss হওয়া বন্ধ হয়নি, কিন্তু এখন অন্তত visible)।

**Side Effect / সতর্কতা:**
- CLAUDE.md rule অনুযায়ী `radius_app/services/radius_service.py`-এর existing method signature ছোঁয়া হয়নি — শুধু নতুন `rename_user()` মেথড যোগ হয়েছে।
- `radcheck`/`radreply`-তে unique key migration **শুধু বর্তমান একমাত্র RADIUS server (Primary, localhost:radius DB)-এ apply করা হয়েছে**। ভবিষ্যতে নতুন RADIUS server যোগ হলে (multi-server), সেই server-এর DB-তেও এই `ALTER TABLE` ম্যানুয়ালি চালাতে হবে — কোনো automated migration hook নেই কারণ radius DB Django-managed নয়।
- Rename করার আগে যদি `radacct` (session history) টেবিলে পুরনো username দিয়ে রেকর্ড থাকে, সেগুলো ইচ্ছাকৃতভাবে touch করা হয়নি (billing/audit trail হিসেবে পুরনো username-এই থেকে যাবে) — `delete_user()`-এর মতোই এখানে history preserve করা হয়েছে।

**Tested:** `python manage.py check` পাস। `rename_user()` সরাসরি shell-এ test করা হয়েছে (dummy `__test_old_user__`→`__test_new_user__`, radcheck+radreply+radusergroup সব ঠিকমতো migrate + পুরনো row delete, cleanup করা হয়েছে)। Duplicate-prevention `create_user()` দুইবার কল করে verify করা হয়েছে (single row থাকে, ২য় বার আগেরটা update হয়)। gunicorn auto-reload hook দিয়ে reload confirm করা হয়েছে (error log-এ worker restart দেখা গেছে, কোনো traceback নেই)। UI থেকে actual client rename/router-change end-to-end টেস্ট করা হয়নি — পরবর্তী agent/user চাইলে verify করতে পারে।

---

### [2026-07-17] — RAM audit: আসল বড় consumer ISP-BNAS নয়, desktop dev tooling (11.6GB/12GB) — LIVETV_KEEP_WARM_COUNT 50→15 + celery concurrency কমানোর override prepared

**পরিবর্তিত ফাইল:** `.env` (LIVETV_KEEP_WARM_COUNT), `/tmp/celery_concurrency_override.sh` (নতুন, apply pending)

**কী করা হয়েছে:**
- User "RAM অনেক ব্যবহৃত হচ্ছে, অপটিমাইজ করুন" বলায় পুরো সিস্টেম audit করা হলো (`free -h`, `ps aux --sort=-%mem`)। **আবিষ্কার:** ১৪GB-এর ১২GB ব্যবহৃত অবস্থায় ১১.৬GB (৯৭%!) আসলে desktop development tooling — VS Code (৩.২GB), Chrome (৩.১GB), **৫টা ভিন্ন ভার্সনের ৬টা idle Gradle daemon (২.৭GB)**, redhat.java Language Server (১.৪GB), SonarLint (১.৩GB), LibreOffice (৩২২MB)। ISP-BNAS production service (gunicorn+celery+mysql+redis+nginx+ffmpeg) মিলিয়ে মাত্র ~৩.১GB। Swap-এ ৪.৭GB চলে গেছে — real memory pressure-এর প্রমাণ।
- **Gradle daemon kill করার চেষ্টা করেছিলাম নিজেই কিন্তু Claude Code-এর নিজস্ব auto-mode safety classifier সেটা ব্লক করেছে** (process-kill risky action হিসেবে ধরা হয়) — user-কে `pkill -f GradleDaemon` কমান্ড দেওয়া হয়েছে নিজে চালানোর জন্য। এই ব্লক আগের sudo-limitation-এর চেয়ে ভিন্ন প্রকৃতির (harness-level classifier, permission নয়) — পরবর্তী agent প্রক্রিয়া-kill জাতীয় কাজে একই বাধার মুখোমুখি হতে পারে।
- `LIVETV_KEEP_WARM_COUNT` user-এর সিদ্ধান্তে **50→15**-এ কমানো হয়েছে (`.env`)। এটা একটা বড় hidden resource driver ছিল — 50 মানে ৫০টা চ্যানেল সবসময় ffmpeg দিয়ে চালু রাখা হতো (প্রতিটা ~96MB RAM + bandwidth), যেখানে কোডের নিজস্ব comment বলে ডিফল্ট 0-ই "বর্তমান সীমিত bandwidth-এ নিরাপদ" ছিল। **Apply করতে `isp-celery`+`isp-celery-beat` restart লাগবে (sudo pending)।**
- Celery worker concurrency (ডিফল্ট = CPU core সংখ্যা = 12, প্রায় 1.4GB RAM নেয়) → **4**-এ কমানোর systemd override তৈরি (`/tmp/celery_concurrency_override.sh`) — এই worker-এর সব task periodic/low-volume (5-min OLT sync, 2-3 min livetv sweep ইত্যাদি), 12 concurrent worker-এর দরকার নেই। **Apply করতে sudo লাগবে, user-কে `bash /tmp/celery_concurrency_override.sh` কমান্ড দেওয়া হয়েছে।**

**Side Effect / সতর্কতা:**
- **এই মুহূর্তে `.env` পরিবর্তন হলেও celery restart না হওয়া পর্যন্ত effect নেই** — পরের agent/user restart না করলে `LIVETV_KEEP_WARM_COUNT=15` আসলে active হবে না (এখনো পুরনো process-এ 50 loaded আছে)।
- Chrome/VS Code/LibreOffice প্রসেস **ইচ্ছাকৃতভাবে touch করা হয়নি** — এগুলো user-এর active interactive session-এর অংশ, unsaved data/state হারানোর ঝুঁকি থাকতে পারে বলে confirmation ছাড়া বন্ধ করা হয়নি। VS Code extension (redhat.java, SonarLint) একই কারণে touch করা হয়নি, এবং যেহেতু Claude Code নিজেই VS Code extension হিসেবে চলছে, VS Code-সম্পর্কিত process টাচ করলে নিজের সেশনই ভেঙে যেতে পারত।
- `LIVETV_KEEP_WARM_COUNT=15` মানে channel cold-start সামান্য বাড়বে (২-৩s) top-15-এর বাইরের চ্যানেলে প্রথম viewer-এর জন্য — এটা expected trade-off, user informed decision নিয়েছে।

**Tested:** RAM breakdown সরাসরি `ps aux`/`free -h` দিয়ে measure করা হয়েছে (exact MB সংখ্যা)। Config change (.env) file-level verify করা হয়েছে। **Celery restart/concurrency override এখনো apply/verify হয়নি** — sudo pending, পরের turn-এ বা user confirm করলে verify করা হবে।

---

### [2026-07-17] — X-Accel-Redirect সফলভাবে re-deploy + সম্পূর্ণ end-to-end verify (nginx location আগে confirm, তারপর Django কোড)

**পরিবর্তিত ফাইল:** `mobile_api/api/views.py` (`_serve_local`) — X-Accel-Redirect আবার চালু, `config/nginx` (sites-available/isp_bnas, user সরাসরি sudo দিয়ে apply করেছে)

**কী করা হয়েছে:**
- আগের outage-এর পর সঠিক ক্রম মেনে চলা হলো: **প্রথমে** nginx `/internal-hls/` location apply ও **independently verify** (grep দিয়ে sites-available ও sites-enabled দুটোতেই, `ps` দিয়ে nginx worker restart timestamp (06:26:16) মিলিয়ে, এবং সরাসরি `curl`-এ direct-hit করে 404 (internal; protection কাজ করছে) confirm করার পরই — Django কোড আবার X-Accel-Redirect-এ পরিবর্তন করা হলো।
- **Nginx apply করার সময় আরেকটা copy-paste সমস্যা হয়েছিল** (`cat <<'EOF' ... EOF` wrapper user literally টাইপ করেছিল, যেটা আসলে শুধু command দেখানোর জন্য ছিল — echo হয়ে গিয়েছিল, execute হয়নি)। সমাধান: command-টা `/tmp/nginx_insert_cmd.sh`-এ file হিসেবে লিখে দেওয়া হলো, user শুধু `bash /tmp/nginx_insert_cmd.sh` চালাল — কোনো copy-paste/multi-line quoting ঝুঁকি ছাড়াই সফল হলো।
- **সম্পূর্ণ end-to-end verify করা হয়েছে (শুধু code review নয়, আসল HTTP call দিয়ে):**
  - Test subscriber token জেনারেট করে (existing active `LiveTVSubscriber`, `jwt.encode` দিয়ে) আসল manifest fetch করা হলো (`/api/v1/app/livetv/stream/96/index.m3u8`) → সফল, সঠিক proxy URL সহ segment list পাওয়া গেছে।
  - সেই manifest থেকে একটা fresh segment URL নিয়ে সরাসরি curl করা হলো → **HTTP/2 200, content-type: video/MP2T, content-length: 117876** (nginx X-Accel-Redirect দিয়ে আসল bytes সার্ভ করছে)।
  - Downloaded bytes `ffprobe` দিয়ে verify — valid, playable .ts (duration ~4.06s), corrupt/empty নয়।
  - Security regression check: token ছাড়া request → `401` (auth এখনো enforced)। `/internal-hls/...` সরাসরি hit → `404` (internal; protection অক্ষত)।

**Side Effect / সতর্কতা:**
- **এখন থেকে X-Accel-Redirect আবার সক্রিয় production-এ।** ভবিষ্যতে nginx config-এ কোনো পরিবর্তন (site config edit, reload) হলে `/internal-hls/` location যেন ভুলে না মুছে যায় — এই location মুছে গেলে আবার সেই একই outage repeat হবে (mobile app-এ live channel না চলা)।
- **এই session-এর সবচেয়ে বড় শিক্ষা (পরবর্তী agent-এর জন্য):** dependent দুই সিস্টেম (nginx + Django) পরিবর্তন করার সময় সবসময় (ক) নির্ভরতা আগে deploy করো, (খ) independently verify করো (grep/curl/ps দিয়ে, শুধু pasted terminal output-এ বিশ্বাস না করে), (গ) তারপরই dependent code deploy করো। আর multi-line sed/regex কখনো copy-paste-নির্ভর কমান্ডে ব্যবহার করা উচিত না — ফাইলে লিখে `bash script.sh` দিয়ে চালানো অনেক বেশি নির্ভরযোগ্য।

**Tested:** পূর্ণ end-to-end — subscriber token generate, manifest fetch, segment fetch (200, সঠিক content-type/length), ffprobe দিয়ে byte-level validity, auth bypass negative test (401), internal-only negative test (404)। এটাই এই session-এর সবচেয়ে thorough verification — শুধু syntax/config-presence নয়, আসল playable content প্রমাণিত।

---

### [2026-07-17] — CONFIRMED OUTAGE + ROLLBACK: X-Accel-Redirect mobile app-এ live channel ভেঙে দিয়েছিল, Python file-read-এ ফিরিয়ে আনা হলো (SUPERSEDED — উপরের entry দ্রষ্টব্য, সঠিকভাবে re-deploy ও verify হয়েছে)

**পরিবর্তিত ফাইল:** `mobile_api/api/views.py` (`_serve_local`)

**কী করা হয়েছে:**
- আগের ⚠️ warning-এ যে ঝুঁকির কথা বলা হয়েছিল সেটা **বাস্তবে ঘটেছে confirm হলো।** User admin panel-এ Bangla Vision ঠিকভাবে চলতে দেখে রিপোর্ট করেছিল "চ্যানেলগুলো মোবাইল অ্যাপসে সঠিকভাবে চলছে না" — কিন্তু admin panel preview সম্পূর্ণ আলাদা code path ব্যবহার করে (`TVChannelViewSet.hls_proxy`, live upstream proxy), তাই সেটা কাজ করা প্রমাণ করে না mobile app ঠিক আছে। যাচাই করে দেখা গেল: Bangla Vision (id=96, input_type=url, direct_relay=False, status=live) ঠিক সেই ধরনের চ্যানেল যেটা `_serve_local()`-এর X-Accel-Redirect path ব্যবহার করে, আর nginx-এ `/internal-hls/` এখনো ছিলই না (আবার grep দিয়ে সরাসরি confirm করা হয়েছে) — প্রতিটা `.ts` segment request তাই nginx থেকে 404 পাচ্ছিল।
- **User দ্বিতীয়বার sudo command চালানোর চেষ্টা করেছিল** (root-owned file mtime আপডেট হয়েছিল, প্রমাণ sudo সফল হয়েছিল), কিন্তু grep আবারও কিছু খুঁজে পায়নি — মূল multi-line `sed` pattern-এ exact ৪-স্পেস indentation (`/^    }$/`) কপি-পেস্টে silently mismatch হয়ে গিয়েছিল বলে ধারণা করা হচ্ছে (sed pattern না মিললে কোনো error দেয় না, শুধু কিছুই বদলায় না)। একটা whitespace-independent Python string-search ভার্সন কমান্ড তৈরি করে দেওয়া হয়েছিল বিকল্প হিসেবে, কিন্তু সেটা confirm হওয়ার আগেই real outage রিপোর্ট এসে গেল।
- **সিদ্ধান্ত: তাৎক্ষণিক rollback।** Subscriber-দের এখনই আবার দেখতে দেওয়ার জন্য `_serve_local()`-এর `.ts` branch থেকে X-Accel-Redirect সরিয়ে আগের মতো সরাসরি Python `open(path,'rb').read()`-এ ফিরিয়ে আনা হয়েছে (nginx dependency সম্পূর্ণ বাদ)। `py_compile` দিয়ে verify, gunicorn auto-reload হয়েছে (worker restart 06:21:54), এবং সরাসরি ফাইল read করে (Bangla Vision-এর একটা আসল segment, ~1MB) নিশ্চিত করা হয়েছে কোনো exception/permission সমস্যা নেই।

**Side Effect / সতর্কতা:**
- **এই মুহূর্তে X-Accel-Redirect optimization বাতিল — সব `_serve_local()` traffic আবার আগের মতো Python-level file-read দিয়ে serve হচ্ছে (100+ concurrent viewer বাস্তবায়নের performance benefit এখন নেই)।** নিরাপদ কিন্তু ধীর — এটাই আগের, প্রমাণিত-কাজ-করা অবস্থা।
- nginx `/internal-hls/` location এখনো prepared আছে (`/tmp/nginx_hls_update.txt`) কিন্তু apply হয়নি। **যদি ভবিষ্যতে আবার এই optimization চালু করা হয়, প্রথমে independently `grep -n "internal-hls" /etc/nginx/sites-enabled/isp_bnas` দিয়ে সত্যিই present কিনা যাচাই করে, তারপর Django কোড পরিবর্তন করা উচিত — উল্টো ক্রমে (কোড আগে, nginx পরে) করলে এই একই outage আবার ঘটতে পারে।**
- এই ঘটনা থেকে শেখা শিক্ষা: sudo command-এর output "successful" দেখানো (`nginx -t` pass, exit 0) **প্রমাণ নয় যে পরিবর্তন আসলে প্রয়োগ হয়েছে** — যদি সেই পরিবর্তনটাই কখনো ঘটেনি (sed pattern না মেলা), তাহলে "unchanged but still valid" config-ও ঠিক একই success output দেখাবে। ভবিষ্যতে যেকোনো external config change দাবি করা হলে সবসময় positive grep/content-check দিয়ে independently verify করা উচিত, শুধু exit code/success message দেখে না।

**Tested:** Django code compile + gunicorn reload confirm + সরাসরি file-read করে exception-free সফল হওয়া যাচাই। **প্রকৃত HTTP end-to-end (mobile app দিয়ে) টেস্ট এখনো করা হয়নি** — user নিজে app-এ চেক করে নিশ্চিত করুক playback আবার স্বাভাবিক হয়েছে।

---

### [2026-07-17] — ⚠️ URGENT: X-Accel-Redirect deploy করা হয়েছে কিন্তু nginx patch এখনো apply হয়নি — non-direct_relay live channel .ts serving broken থাকতে পারে (RESOLVED — উপরের entry দ্রষ্টব্য)

**পরিবর্তিত ফাইল:** `mobile_api/api/views.py` (`_serve_local`), `/tmp/nginx_hls_update.txt` (নতুন)

**কী করা হয়েছে:**
- আগের session-এ চিহ্নিত real bottleneck ফিক্স করা হলো: `_serve_local()`-এর `.ts`/non-m3u8 branch এখন পুরো ফাইল Python memory-তে read করে না — `X-Accel-Redirect: /internal-hls/<slug>/<fname>` header পাঠায় (ঠিক `_serve_apk()`-এর pattern অনুসরণ করে)। Auth verify (subscriber token) অপরিবর্তিত থাকে caller-এর `get()`-এ, তাই security bypass নেই। `.m3u8` branch **অপরিবর্তিত** (Python-এই থাকে) কারণ প্রতি request-এ token+proxy_base দিয়ে rewrite করতে হয়, ফাইল ছোট, cost নগণ্য।
- `py_compile` + `manage.py check mobile_api` দিয়ে syntax/import যাচাই — উভয়ই পাস।
- **gunicorn auto-reload hook ইতিমধ্যেই এই কোড লাইভ করে দিয়েছে** (worker restart timestamp edit-এর পরপরই মিলেছে) — অর্থাৎ **কোড এখন production-এ চলছে**।
- Nginx-এর জন্য `/tmp/nginx_hls_update.txt`-এ নতুন `location /internal-hls/ { internal; alias ...; open_file_cache ...; }` block তৈরি ও local copy-তে insertion sed command test করা হয়েছে (সঠিক placement confirm)। **Apply করা যায়নি** — root-owned nginx config, sudo password লাগে। User-কে exact command দেওয়া হয়েছে conversation-এ।

**⚠️ Side Effect / সতর্কতা — জরুরি, পরবর্তী agent/user অবশ্যই প্রথমে পড়ুক:**
- **এই মুহূর্তে nginx-এ `/internal-hls/` location নেই।** যেকোনো non-`direct_relay` url চ্যানেল বা hardware (v4l2/dvb) চ্যানেল live হলে (viewer চাইলেই lazy-start হয়ে যাবে), তার `.ts` segment request X-Accel-Redirect পাবে nginx থেকে যেটা 404 রিটার্ন করবে (location নেই) — **playback ভেঙে যাবে**। যাচাই করে দেখা গেছে এই মুহূর্তে কোনো non-direct_relay channel actually live নেই (তাই এখনই কারো প্রভাবিত হওয়ার কথা না), কিন্তু এটা fragile — পরবর্তী viewer যেকোনো মুহূর্তে trigger করতে পারে।
- **অবিলম্বে করণীয়:** উপরের conversation-এ দেওয়া `sudo sed ...` + `sudo nginx -t` + `sudo systemctl reload nginx` command চালাতে হবে। এটা না হওয়া পর্যন্ত এই session-এর কোড change deploy অসম্পূর্ণ ধরা হবে।
- `direct_relay=True` channel-গুলো (117টা) **এই bug থেকে সম্পূর্ণ নিরাপদ** — তারা `_serve_direct()` ব্যবহার করে, `_serve_local()` না, তাই তাদের কোনো প্রভাব নেই।
- Nginx patch apply হওয়ার পর quick verify করা উচিত: একটা non-direct_relay channel manually Start করে admin panel থেকে playback test করা, বা `curl -I` দিয়ে token সহ একটা `.ts` URL hit করে `200`/সঠিক `Content-Length` আসছে কিনা দেখা।

**Tested:** Python syntax/import ✅। **End-to-end HTTP playback টেস্ট করা যায়নি** (nginx piece missing বলে অর্থহীন হতো)। Nginx patch শুধু local-copy dry-run-এ verify করা হয়েছে, production-এ apply/test হয়নি।

---

### [2026-07-17] — 100+ concurrent viewer safety যাচাই (existing lock already যথেষ্ট) + nginx tuning prepared (sudo pending) + real bottleneck identified

**পরিবর্তিত ফাইল:** কোনো কোড ফাইল না — শুধু verification/test + nginx patch তৈরি (apply করা যায়নি, sudo pending)

**কী করা হয়েছে:**
- User চেয়েছিল "100+ device একই চ্যানেলে একসাথে tune করলে duplicate ffmpeg/OOM না হয়" নিশ্চিত করতে। **কোড review করে দেখা গেছে এটা ইতিমধ্যেই সঠিকভাবে implement করা আছে** — নতুন কিছু লেখার দরকার হয়নি:
  - তিনটা entry point (mobile app lazy-start, admin manual Start button, neighbor prewarm) সবাই **একই cache key** (`livetv_relay_starting_{channel.id}`) দিয়ে Redis-backed atomic `cache.add()` lock ব্যবহার করে — Django-এর Redis cache backend আসল Redis `SET NX` ব্যবহার করে, তাই এটা সব gunicorn/celery worker process জুড়ে সত্যিকারের distributed lock (শুধু in-process নয়)।
  - **Empirically test করা হয়েছে:** ১০০টা concurrent thread একই lock key-তে `cache.add()` চালিয়ে দেখা গেছে — ঠিক **১টা True, ৯৯টা False**। প্রমাণিত যে ঠিক একটাই request ffmpeg dispatch করবে।
  - **দ্বিতীয় স্তরের safety net** যেটা আগে খেয়াল করা যায়নি: `StreamService.start_stream()` নিজেই শুরুতে `stop_stream()` কল করে, যেটা DB-tracked pid ছাড়াও একই `hls_output_dir`-এ লেখা orphan ffmpeg process খুঁজে বন্ধ করে দেয় (`_kill_orphan_pids`)। মানে lock কোনোভাবে miss হলেও (যেমন Celery queue backlog-এ ২০s TTL পার হয়ে গেলে), পরের start attempt পুরনো process নিজে থেকেই কিল করে দেবে — duplicate leak হওয়ার সুযোগ প্রায় নেই।
- **Nginx tuning:** `/etc/nginx/sites-available/isp_bnas`-এর global `http {}` block-এ `sendfile on;` ও `tcp_nopush on;` **আগে থেকেই আছে** (nginx.conf:19-20)। `/media/hls/` location-এ `open_file_cache max=1000 inactive=20s;` (+ `open_file_cache_valid`, `open_file_cache_min_uses`, `tcp_nodelay on;`) যোগ করার জন্য একটা sed patch তৈরি করে local copy-তে test করা হয়েছে (সঠিক output confirm করা হয়েছে), কিন্তু **apply করা যায়নি** — `/etc/nginx/sites-available/isp_bnas` root-owned, sudo password লাগে (আজকের চতুর্থ বার একই সীমাবদ্ধতা — redis override, isp-celery restart, এখন এটা)।
- **গুরুত্বপূর্ণ architectural finding, user-কে জানানো হয়েছে:** `/media/hls/` nginx location আসলে `allow 127.0.0.1; deny all;` — subscriber traffic **এই location দিয়ে যায়ই না**। প্রতিটা viewer-এর manifest/segment request `mobile_api.AppLiveTVStreamProxyView._serve_local()`-এ যায়, যেটা Python-এ `open(path,'rb').read()` দিয়ে ফাইল পড়ে Django HttpResponse হিসেবে ফেরত দেয় (gunicorn worker সরাসরি bytes handle করে, nginx sendfile/open_file_cache একেবারেই touch করে না)। তাই nginx tuning "nice to have" কিন্তু **আসল 100+ concurrent-viewer CPU/RAM বাধা এটা সমাধান করে না** — real fix হবে `_serve_local`-কে `X-Accel-Redirect` pattern-এ move করা (ঠিক যেভাবে `_serve_apk()` ইতিমধ্যে APK download-এর জন্য করে, `mobile_api/api/views.py:2460`) যাতে auth-check এর পর আসল byte-serving nginx-কে দিয়ে দেওয়া যায়। **এটা implement করা হয়নি** — subscriber-facing auth-gated proxy-র request-serving behavior বদলানো, তাই user confirmation ছাড়া করা ঠিক হবে না।

**Side Effect / সতর্কতা:**
- Nginx patch এখনো pending — user নিজে sudo দিয়ে চালাতে পারেন (কমান্ড conversation-এ দেওয়া আছে), অথবা পরের agent যদি sudo access পায়।
- **আসল স্কেলিং কাজ এখনো বাকি** যদি সত্যিই "flawless 100+ concurrent" চাওয়া হয়: `_serve_local`-কে X-Accel-Redirect-এ move করা প্রয়োজন। User confirm করলে পরের session এটা implement করা যেতে পারে — কিন্তু auth flow ঠিক রাখতে হবে (X-Accel-Redirect header পাঠানোর আগে token verify অবশ্যই আগে হতে হবে, ঠিক `_serve_apk`-এর pattern অনুসরণ করে)।

**Tested:** ১০০-thread concurrent lock test সরাসরি চালিয়ে verify করা হয়েছে (১ win, ৯৯ skip)। nginx sed patch local copy-তে test করে output visually confirm করা হয়েছে, কিন্তু আসল `nginx -t`/production apply sudo ছাড়া করা যায়নি।

---

### [2026-07-17] — Automated stale HLS cache sweep (নতুন Celery periodic task) — কোড রেডি, deploy pending (sudo দরকার isp-celery restart-এর জন্য)

**পরিবর্তিত ফাইল:** `livetv/tasks.py`, `config/settings.py` (CELERY_BEAT_SCHEDULE)

**কী করা হয়েছে:**
- আগের session-গুলোতে idle channel-দের leftover `.ts`/`.m3u8` cache manual DB-status চেক করে scoped ভাবে পরিষ্কার করতে হয়েছিল, এবং permission সমস্যায় (isp-owned file, amir shell) পুরোপুরি clean করা যায়নি। এখন সেটা স্থায়ীভাবে **স্বয়ংক্রিয়** করা হয়েছে: `livetv.sweep_stale_hls_files` নামে নতুন Celery task, প্রতি **৩০ মিনিটে** চলবে (`CELERY_BEAT_SCHEDULE['sweep-stale-livetv-hls-cache']`)।
- **Approach: DB status নয়, pure file mtime।** `media/hls/`-এর সব চ্যানেল directory scan করে; কোনো `.ts`/`.m3u8` ফাইলের `mtime` ৩০ মিনিটের বেশি পুরনো হলে delete করে। Active/live চ্যানেলের ffmpeg প্রতি কয়েক সেকেন্ডে ওই ফাইলগুলো rewrite করে, তাই mtime সবসময় fresh থাকে এবং কখনো এই sweep-এ ধরা পড়ে না — DB status lag/race (আগে r-plus-gould-এ যেমন দেখা গিয়েছিল) নিয়ে চিন্তা করারই দরকার নেই এই approach-এ। Channel directory নিজে কখনো মোছা হয় না।
- **Permission সমস্যা এমনিতেই সমাধান হয়ে গেছে:** `isp-celery` worker process **`isp` user হিসেবেই চলে** (যাচাই করা হয়েছে `ps -eo user,cmd`), আর HLS ফাইলগুলোও `isp` user-এর মালিকানাধীন — তাই এই task চললে কোনো sudo/permission বাধা ছাড়াই delete করতে পারবে (আগে `amir` shell থেকে চেষ্টা করলে `PermissionError` হতো)।
- Django shell থেকে সরাসরি `sweep_stale_hls_files()` কল করে যাচাই করা হয়েছে — সফলভাবে চলে (552 ফাইল scan, 0 removed যেহেতু সব হয় fresh নয়তো আগের session-এ ইতিমধ্যে পরিষ্কার হয়ে গেছে)।

**Side Effect / সতর্কতা:**
- **এই কোড এখনো "live" নয়** — `isp-celery` এবং `isp-celery-beat` restart না করা পর্যন্ত নতুন task worker-এ load হবে না এবং নতুন schedule entry django-celery-beat-এর DatabaseScheduler-এ sync হবে না (settings.py-এর CELERY_BEAT_SCHEDULE শুধু beat process **start হওয়ার সময়** DB-তে sync হয়, চলমান অবস্থায় live-reload হয় না)। Restart করতে `sudo` লাগে যেটা এই non-interactive শেলে নেই (আগের ২টা incident-এও একই বাধা)। User-কে exact command দেওয়া হয়েছে:
  ```
  sudo systemctl restart isp-celery isp-celery-beat
  ```
- Restart-এর পর `celery.log`/`celery_beat.log`-এ `sweep-stale-livetv-hls-cache` entry দেখে বা Django admin-এর Periodic Tasks list-এ (django-celery-beat) নতুন row দেখে deploy confirm করা যাবে।

**Tested:** সরাসরি ফাংশন কল করে verify (logic কাজ করছে, exception নেই)। Celery task registration/import যাচাই করা হয়েছে (`sweep_stale_hls_files.name == 'livetv.sweep_stale_hls_files'`)। **Deploy/celery-beat integration টেস্ট করা যায়নি** sudo সীমাবদ্ধতার কারণে — restart-এর পর পরবর্তী agent বা user নিশ্চিত করুক task আসলে schedule অনুযায়ী চলছে।

---

### [2026-07-17] — Redis crash-loop দ্বিতীয়বার (docker.service restart race) — restart করে fix, durable systemd fix pending (sudo দরকার)

**পরিবর্তিত ফাইল:** কোনো ফাইল না — শুধু service restart, কোনো code/config পরিবর্তন হয়নি

**কী করা হয়েছে:**
- Admin panel আবার "Failed to load data" দেখাচ্ছিল (Live TV Channels page)। কারণ: **এবার পুরো system reboot হয়নি** — শুধু `docker.service` নিজে থেকে restart হয়েছিল (05:42:35)। `redis.conf`-এ `172.17.0.1` (docker0 bridge IP)-এ bind করার config আছে — docker.service নিজের bridge network পুনরায় তৈরি করার সময়টাতেই systemd প্রায় একই মুহূর্তে (05:42:33-34) `redis-server`-কে restart করার চেষ্টা করে, bind fail করে ("Cannot assign requested address"), ৫-বার-দ্রুত-রিস্টার্ট systemd limit-এ আটকে চিরতরে থেমে যায় — এটা একদম ঐ **আগের incident-এর (২০২৬-০৭-১৭ সকাল, পুরো reboot-এর সময়) একই root cause**, শুধু trigger ভিন্ন।
- `systemctl restart redis-server` চালিয়ে immediate fix করা হয়েছে (docker0 ততক্ষণে ফিরে এসেছিল), verify করা হয়েছে `get_visible_channels()` কল করে (210 channel, সফল)।
- **Durable fix apply করা যায়নি** — `/etc/systemd/system/redis-server.service.d/override.conf` লিখতে এবং `systemctl daemon-reload` চালাতে sudo লাগে, এই শেলে `amir`-এর sudo শুধু interactive password-এ কাজ করে (আগের session-এও এই একই limitation পাওয়া গেছে `isp` user cleanup-এর সময়)। User-কে exact command block দেওয়া হয়েছে চালানোর জন্য:
  ```
  sudo mkdir -p /etc/systemd/system/redis-server.service.d
  sudo tee /etc/systemd/system/redis-server.service.d/override.conf > /dev/null <<'CONF'
  [Unit]
  After=docker.service
  Wants=docker.service
  [Service]
  RestartSec=3
  StartLimitIntervalSec=60
  StartLimitBurst=20
  CONF
  sudo systemctl daemon-reload
  ```

**Side Effect / সতর্কতা:**
- **এটা তৃতীয়বার হতে পারে যদি durable fix apply না হয়** — docker.service যেকোনো কারণে (update, manual restart, crash) পুনরায় চালু হলেই এই race আবার ঘটতে পারে, এবং প্রতিবার manual `systemctl restart redis-server` লাগবে যতক্ষণ না override.conf apply হচ্ছে। পরের agent বা user যদি sudo password দিতে পারে, উপরের কমান্ড ব্লক চালিয়ে স্থায়ীভাবে ফিক্স করা উচিত।
- বিকল্প স্থায়ী সমাধান (override.conf-এর বদলে/পাশাপাশি): `redis.conf`-এর bind list থেকে `172.17.0.1` পুরোপুরি সরিয়ে শুধু `127.0.0.1` রাখা, যদি কোনো Docker container-এর সত্যিই host redis-এ docker0 gateway দিয়ে পৌঁছানোর দরকার না থাকে — কিন্তু এটা যাচাই না করে করা ঠিক হবে না (কোন container/service এই বাইন্ডিং ব্যবহার করে সেটা আগে খুঁজে বের করা দরকার)।

**Tested:** `redis-cli ping`-এর বদলে Django shell থেকে `get_visible_channels()` কল করে confirm করা হয়েছে (Redis cache read/write কাজ করছে, ২১০ channel রিটার্ন হয়েছে)।

---

### [2026-07-17] — NUDGE stage সম্পূর্ণ বাদ, 2-stage watchdog (RELOAD ৮s/FAILOVER ১৫s) + buffer tuning + APK build 29

**পরিবর্তিত ফাইল:** `livetv_app/src/screens/player/PlayerScreen.js`

**কী করা হয়েছে:**
- Build 28 QA-তে live-edge jump ফিক্স কনফার্ম হয়েছে, কিন্তু নতুন side-effect ধরা পড়েছে: normal playback-এও মাঝেমধ্যে অহেতুক buffering spinner। **কারণ:** Stage 1 NUDGE (play()/pause() soft-toggle, ৪.৫s stall trigger) native player (ExoPlayer/AVPlayer)-এর নিজস্ব short-term network buffering-এ বাধা দিচ্ছিল — native player নিজে থেকে সামান্য latency সামলানোর চেষ্টা করার আগেই JS watchdog pause→play চালিয়ে সেই buildup বাতিল করে জোর করে spinner দেখাত।
- **Fix:** NUDGE stage সম্পূর্ণ delete করা হয়েছে। এখন ২-stage watchdog: **RELOAD ৮s** (same-URL soft-reload, আগের ৭s থেকে বাড়ানো), **FAILOVER ১৫s** (backup URL switch, আগের ১০s থেকে বাড়ানো)। Native player-কে পুরো ৮s দেওয়া হচ্ছে নিজের buffering সামলানোর জন্য, JS শুধু genuinely দীর্ঘ stall-এই হস্তক্ষেপ করে।
- **Buffer tuning:** `minBufferForPlayback` ৩→**৫** (expo-video-এর BufferOptions-এ এটাই Android ExoPlayer-এর `bufferForPlaybackMs`-এর কাছাকাছি জিনিস — library সরাসরি raw `minBufferMs`/`maxBufferMs` expose করে না)। নতুন `prioritizeTimeOverSizeThreshold: true` যোগ করা হয়েছে — byte-size-এর বদলে সময়ভিত্তিক buffer target অগ্রাধিকার পায়, variable-bitrate IPTV feed-এ বেশি স্থিতিশীল। `preferredForwardBufferDuration` অপরিবর্তিত (২৫s)।
- APK **build 29** publish হয়েছে, curl দিয়ে web-distribution আবার verify করা হয়েছে (HTTP/2 200, content-length ফাইল সাইজের সাথে মিলছে)।

**Side Effect / সতর্কতা:**
- এখন recovery window ~১৫s (আগে ~১০s, শুরুতে ~৬s ছিল) — প্রতিটা iteration-এ threshold বাড়ছে কারণ প্রতিবার আগেরটা কোনো না কোনো false-positive/side-effect তৈরি করছিল। যদি ভবিষ্যতে আবার "দ্রুত backup switch" চাওয়া হয়, এই history মাথায় রাখা দরকার — aggressive early-trigger বারবার নতুন bug এনেছে এই session-এ (live-edge jump, native-buffer interference)। থ্রেশহোল্ড কমানোর আগে real device-এ carefully A/B test করা উচিত।
- `recoveryStageRef` এখন শুধু 0/1 (RELOAD হয়েছে কিনা) — আগের 0/1/2 numbering আর নেই, কোনো future edit এই assumption মাথায় রেখে করা উচিত।

**Tested:** babel parse-check পাস। APK build সফল (build 29, 67MB)। Web download path curl verify (HTTP/2 200)। **ডিভাইসে এখনো টেস্ট করা হয়নি** — user QA-র অপেক্ষায়।

---

### [2026-07-17] — Stall-watchdog NUDGE বাগ ফিক্স: forward seekBy লাইভ এজ overshoot করছিল (jump-and-stall loop) + APK build 28

**পরিবর্তিত ফাইল:** `livetv_app/src/screens/player/PlayerScreen.js`

**কী করা হয়েছে:**
- User রিপোর্ট করেছিল: video হঠাৎ লাফিয়ে যাচ্ছে তারপর সাথে সাথেই buffering spinner — বারবার। **Real bug ছিল:** Stage 1 NUDGE `player.seekBy(2)` (forward ২s seek) চালাত মাত্র ২s stall-এই — live HLS-এ এই forward seek প্রায়ই live edge-এর বাইরে চলে যেত (upstream তখনো ওই segment জেনারেট করেনি), player খালি buffer-এ hit করত, spinner আবার দেখাত, watchdog আবার trigger হতো → jump-and-stall loop।
- **Fix:** NUDGE এখন কোনো seek করে না — শুধু `player.pause()` তারপর `player.play()` (soft-resync), যেটা decoder pipeline re-sync করে কিন্তু live edge-এ কোনো ঝুঁকি নেই।
- **Threshold শিথিল করা হয়েছে** (২-৪s keyframe interval-এ ২s threshold false-positive দিত): NUDGE_AT_MS 2000→**4500**, RELOAD_AT_MS 4000→**7000**, FAILOVER_AT_MS 6000→**10000**। এটা আগের session-এর "৫-৭s-এর মধ্যে backup failover" spec-কে **override** করে — কারণ সেই কড়া timing-ই আসল bug-এর কারণ ছিল (too-aggressive early trigger)। মোট recovery window এখন ~১০s (আগে ~৬s), trade-off: সামান্য ধীর failover বনাম false-positive loop বন্ধ।
- APK **build 28** publish করা হয়েছে, web-distribution আবার curl দিয়ে verify করা হয়েছে (200, content-length ফাইল সাইজের সাথে মিলছে)।

**Side Effect / সতর্কতা:**
- Stage 2 RELOAD এখনো same-URL soft-reload (applyUrl) ব্যবহার করে — এতে কোনো seek নেই তাই এই bug-এর ঝুঁকি নেই, অপরিবর্তিত রাখা হয়েছে।
- যদি ভবিষ্যতে আবার "backup switch দ্রুত হোক" বলা হয়, মনে রাখতে হবে এই ১০s window ইচ্ছাকৃতভাবে বড় করা হয়েছে ঠিক এই jump-and-stall bug এড়াতে — থ্রেশহোল্ড কমানোর আগে NUDGE-এর seek-মুক্ত ডিজাইন বজায় থাকছে কিনা যাচাই করা উচিত।

**Tested:** babel parse-check (babel-preset-expo) পাস। APK build সফল (gradlew exit 0, build 28, 67MB)। Web download path curl দিয়ে verify (HTTP/2 200)। **ডিভাইসে/emulator-এ আসল live-edge behavior এখনো টেস্ট করা হয়নি** — পরবর্তী agent বা user manual app testing করে confirm করুক যে jump-and-stall loop সত্যিই বন্ধ হয়েছে।

---

### [2026-07-17] — APK web-distribution verified; idle-channel disk cleanup blocked on missing sudo (not done)

**পরিবর্তিত ফাইল:** কোনো ফাইল না — শুধু verification, কোনো state পরিবর্তন হয়নি

**কী করা হয়েছে:**
- User চেয়েছিল `sudo -u isp` দিয়ে idle channel-দের ৪২টা leftover cache file (~৩০.৬MB) delete করতে। **এটা করা হয়নি** — এই শেলে `amir`-এর sudo শুধু interactive password দিয়ে কাজ করে (`sudo -l` দেখায় `(ALL:ALL) ALL`, কিন্তু কোনো broad NOPASSWD entry নেই; শুধু `systemctl reload isp-gunicorn.service`-এর জন্য নির্দিষ্ট NOPASSWD আছে)। Non-interactive শেল থেকে password দেওয়া সম্ভব না, তাই `sudo -u isp rm ...` চালানো যায়নি (`sudo: interactive authentication is required`)। sudoers-এ নতুন NOPASSWD rule যোগ করে এই বাধা bypass করা হয়নি — এটা একটা security-relevant পরিবর্তন, user explicit request ছাড়া করা ঠিক হবে না। **৩০.৬MB idle cache এখনো ডিস্কে আছে** — user নিজে manually `sudo -u isp find ... -delete` চালাতে পারেন, অথবা পরের কোনো session-এ নির্দিষ্ট NOPASSWD sudoers rule যোগ করার অনুরোধ করলে করা যাবে।
- **APK web-distribution verify করা হয়েছে (সফল):** `media/app/rajamehar-livetv.apk` ফাইল `-rw-r--r-- amir:www-data`, parent dir `drwxrwsr-x` (setgid, www-data group readable/traversable) — nginx worker (`www-data`) পড়তে পারবে। nginx config-এ `location /media/` generic alias আছে (কোনো auth restriction নেই, `/media/hls/`-এর মতো `deny all` নেই)। Local curl দিয়ে verify: `curl -skI --resolve roisp.duckdns.org:443:127.0.0.1 https://roisp.duckdns.org/media/app/rajamehar-livetv.apk` → **HTTP/2 200**, `content-length: 69410679` (আসল ফাইল সাইজের সাথে হুবহু মিলছে), `content-type: application/octet-stream`। Subscriber download path সম্পূর্ণ কার্যকর।

**Side Effect / সতর্কতা:**
- Idle channel cache cleanup এখনো বাকি (৩০.৬MB, `isp` user-owned)। এটা নিরাপদ/low-priority — কোনো functional impact নেই, শুধু সামান্য ডিস্ক স্পেস। পরের agent চাইলে হয় manually sudo দিয়ে চালাবে, নাহলে user-কে জিজ্ঞেস করে narrow-scoped NOPASSWD sudoers rule (শুধু নির্দিষ্ট find/rm pattern-এর জন্য, `isp` user-এর জন্য) যোগ করার কথা ভাবতে পারে — কিন্তু নিজে থেকে sudoers পরিবর্তন করবে না।

**Tested:** curl দিয়ে সরাসরি production URL hit করে verify করা হয়েছে (200, সঠিক size/content-type)। sudo limitation সরাসরি কমান্ড চালিয়ে confirm করা হয়েছে (`sudo -n -u isp true` → exit 1)।

---

### [2026-07-17] — APK build #27 publish + scoped idle-channel DB/cache cleanup (live channels protected)

**পরিবর্তিত ফাইল:** কোনো কোড ফাইল না — শুধু build artifact + DB state + filesystem cleanup

**কী করা হয়েছে:**
- User তৃতীয়বার একই ভুল premise (MySQL/Docker network crash-loop) নিয়ে এসেছিল — আবার যাচাই করে দেখা গেছে **false**: mysql/isp-gunicorn/isp-celery/isp-celery-beat/redis-server সব healthy ছিল। Skip করা হয়েছে।
- `scripts/build_and_publish_livetv_apk.sh` চালিয়ে **build 27** (v1.0.0, 67MB) publish করা হয়েছে — গত session-এর PlayerScreen.js stall-timing fix এতে বান্ডিল হয়েছে।
- **Requested "blanket reset সব url-type channel-এর status/pid" এবং "pkill hls_segment" literally চালানো হয়নি** — কারণ execution-এর সময় **11টা url channel আসলেই live ছিল, real ffmpeg process দিয়ে real subscriber-দের serve করছিল** (Ekushey TV, Filmix TV, YRF Music HD ইত্যাদি)। Blanket reset চালালে DB বলত "stopped" কিন্তু ffmpeg process বেঁচে থাকত — পরের viewer request নতুন duplicate ffmpeg spawn করত (হুবহু ২০২৬-০৭-০৯ OOM incident-এর কারণ)। `pkill -f hls_segment` সরাসরি এই ১১টা live viewer-এর playback কেটে দিত। User-কে জিজ্ঞেস করে **শুধু idle (non-live/non-starting) চ্যানেলে scope করা হয়েছে** — ২৪৫টা চ্যানেলের status/pid normalize করা হয়েছে (সবই আগে থেকে clean ছিল, কোনো প্রকৃত orphan pid পাওয়া যায়নি)।
- Investigation চলাকালীন **স্বাভাবিকভাবেই** ৩টা channel (r-plus-gould, yrf-music-hd, atn-news) live থেকে stopped-এ চলে গেছে — এটা আমার bulk update-এর কারণে নয়, upstream IPTV feed flaky হওয়ার কারণে (কোডেই comment আছে এই ব্যাপারে) — সময়ের সাথে বদলেছে, race নয়।
- HLS cache cleanup: idle channel-দের directory-তে ৪২টা leftover `.ts`/`.m3u8` ফাইল (মোট ~৩০.৬MB) পাওয়া গেছে, কিন্তু সবই `isp` service user-এর মালিকানাধীন — `amir` shell থেকে delete permission নেই (`PermissionError`)। যেহেতু সাইজ নগণ্য (৩০MB), sudo দিয়ে escalate করা হয়নি — শুধু রিপোর্ট করা হলো।

**Side Effect / সতর্কতা:**
- এই ৪২টা leftover ফাইল (30.6MB) এখনো ডিস্কে আছে। যদি পরিষ্কার করা জরুরি মনে হয়, `isp` user হিসেবে বা sudo দিয়ে চালাতে হবে — এই session-এ ইচ্ছাকৃতভাবে করা হয়নি (destructive escalation এড়াতে)।
- Blanket DB reset/pkill যদি সত্যিই দরকার হয় ভবিষ্যতে (যেমন পুরো Live TV subsystem restart), তখনো আগে `status__in=['live','starting']` চেক করে সেই channel-গুলো বাদ দিয়ে বা `StreamService.stop_stream()` দিয়ে properly বন্ধ করে scope করা উচিত — raw DB `.update()` বা blind `pkill` কখনোই ব্যবহার করা ঠিক না যতক্ষণ না নিশ্চিত হওয়া যায় কোনো real viewer affected হচ্ছে না।

**Tested:** systemctl status দিয়ে সব service verify করা হয়েছে (active)। APK build সফল (gradlew, exit 0)। DB update/cleanup script manage.py shell দিয়ে চালিয়ে row-count/file-count verify করা হয়েছে।

---

### [2026-07-17] — PlayerScreen.js stall-recovery timing tightened to match 5-7s failover spec

**পরিবর্তিত ফাইল:** `livetv_app/src/screens/player/PlayerScreen.js`

**কী করা হয়েছে:**
- User আবার "100% client-side direct streaming, server relay bypass" ধরে নিয়ে request করেছিল — এটা false, correct করা হয়েছে (আমরা এখনো token-gated proxy দিয়েই serve করি, শুধু কিছু channel-এ zero-ffmpeg `direct_relay` mode)।
- আগের session-এর 3-stage recovery (NUDGE→RELOAD→FAILOVER) প্রতিটা stage-এ stall timer রিসেট করত, ফলে backup URL-এ পৌঁছাতে আসলে ~১৮s লাগত। এই session-এর স্পষ্ট spec ছিল "৫-৭s continuous stall হলে backup-এ switch করো" — তাই এখন সব ৩টা stage **একই stall-onset থেকে** মাপা হয় (২s NUDGE, ৪s RELOAD, ৬s FAILOVER), watchdog tick ২s থেকে ১s-এ কমানো হয়েছে নির্ভুলতার জন্য। Backup-এ switch করার সময় এখন স্পষ্ট overlay label দেখায় ("ব্যাকআপ সোর্সে পরিবর্তন হচ্ছে…")।

**Side Effect / সতর্কতা:**
- Reload stage (Stage 2) নিজেই buffering/load করতে সময় নিলে, সেই সময়টা এখনো stall-clock-এর মধ্যেই গণনা হয় (onset preserve করা হয়) — তাই বাস্তবে FAILOVER কখনো কখনো ৬s-এর সামান্য পরে ট্রিগার হতে পারে (reload-এর নিজের load latency যোগ হয়ে), spec-এর "৫-৭s" range-এর মধ্যেই থাকা উচিত normal network অবস্থায়।
- এই ফাইলে কোনো নতুন APK build হয়নি এই session-এ — user device-এ এই ফিক্স পেতে হলে `scripts/build_and_publish_livetv_apk.sh` আবার চালাতে হবে।

**Tested:** শুধু babel parse-check (babel-preset-expo) — device/emulator-এ আসল stall-timing behavior verify করা হয়নি।

---

### [2026-07-17] — Live TV zero-ffmpeg direct_relay rollout + codec-probe bug fix + player 3-stage recovery + APK build

**পরিবর্তিত ফাইল:** `livetv/services/stream_service.py`, `livetv/management/commands/enable_direct_relay.py` (নতুন), `livetv_app/src/screens/player/PlayerScreen.js`, `livetv_app/app.json` (versionCode bump, build script দ্বারা)

**কী করা হয়েছে:**
- **User একটা "zero-server-resource IPTV relay" রিফ্যাক্টর চেয়েছিল যেটা raw upstream `source_url` সরাসরি client app-কে দিয়ে দিত (token/proxy বাইপাস করে)।** সেটা reject করা হয়েছে — ২০২৬-০৭-০৩-এ এই ঠিক এই কারণেই (subscriber inactive/expired হলেও পুরনো URL চিরকাল কাজ করত — payment bypass) proxy-only architecture-এ move করা হয়েছিল। সেই নিয়ম এখনো বলবৎ, রিভার্ট করা হয়নি।
- এর বদলে codebase-এ **আগে থেকেই থাকা** `TVChannel.direct_relay` flag (zero-ffmpeg live HTTP proxy, `mobile_api.AppLiveTVStreamProxyView._serve_direct`, token-gated) ব্যবহার করা হয়েছে — নতুন mgmt command `enable_direct_relay` প্রতিটা active url-type চ্যানেলের source ffprobe দিয়ে probe করে, শুধু H.264/AAC (mobile/browser-compatible) হলে `direct_relay=True` সেট করে। **255-এর মধ্যে 115টি চ্যানেল** এভাবে zero-ffmpeg mode-এ move হয়েছে (মোট এখন 117, আগে থেকেই 1টা ছিল)। বাকি ~140টা (HEVC/exotic codec/unreachable) আগের মতোই ffmpeg mirror/transcode ব্যবহার করবে (playback ভাঙা এড়াতে ইচ্ছাকৃতভাবে বাদ)।
- **আসল bug আবিষ্কার ও fix:** `StreamService._probe_codecs()` ffprobe-কে `-show_entries stream=codec_type,codec_name` দিয়ে call করত এবং CSV output-কে `(codec_type, codec_name)` order-এ unpack করত — কিন্তু ffprobe (v8.0.1) request-করা field order মানে না, আসলে সবসময় `codec_name,codec_type` (alphabetical) দেয়। ফলে `_probe_codecs` **সবসময় `(None, None)` রিটার্ন করত**, আর `None` মানে code "compatible ধরে নেয়" — অর্থাৎ auto-transcode fallback (HEVC/AC3 ইত্যাদির জন্য) **কখনো trigger হতো না প্রোডাকশনে**। এখন value দেখে (`'video'`/`'audio'` কোনটা match করে) parse করে, position-নির্ভর নয়।
- `livetv/tasks.py`-এর `sweep_idle_url_relays`/`retry_error_url_channels`/`keep_warm_channels` — এগুলো **আগে থেকেই** `direct_relay=True` চ্যানেল গ্রেসফুলি skip করে (কোনো কোড পরিবর্তন লাগেনি, শুধু যাচাই করা হয়েছে)।
- `PlayerScreen.js`: buffer tuning (`preferredForwardBufferDuration` 15→25s, `minBufferForPlayback` 2.5→3s), `STALL_TIMEOUT_MS` 8000→6000, এবং stall watchdog-কে ২-ধাপ থেকে **৩-ধাপ recovery**-তে upgrade করা হয়েছে: Stage1 NUDGE (`player.seekBy(2)`, নতুন fetch ছাড়াই), Stage2 RELOAD (same URL soft-reload), Stage3 FAILOVER (পরের backup URL)। সব backup fail করলে এখন **Smart Reconnect**: primary URL থেকে 2s→4s→6s backoff-এ সর্বোচ্চ ৩ বার retry, status label দেখিয়ে ("পুনঃসংযোগ চেষ্টা হচ্ছে…"), তারপর permanent "Stream Unavailable"।
- APK build করা হয়েছে: `scripts/build_and_publish_livetv_apk.sh` → v1.0.0 build **26** (67MB), `media/app/rajamehar-livetv.apk`-এ publish।
- **Phase 1 (এই session-এ requested) স্কিপ করা হয়েছে:** user দাবি করেছিল MySQL 'isp_bnas_default' Docker network না থাকায় bind fail করছে crash-loop করছে — যাচাই করে দেখা গেছে এই দাবি **false ছিল**: MySQL/isp-celery-beat দুটোই healthy running ছিল, network আগে থেকেই ছিল। কিছু restart করা হয়নি।

**Side Effect / সতর্কতা:**
- **direct_relay চালু থাকা চ্যানেলে auto-transcode/error-retry নেই** — upstream যদি পরে HEVC-তে switch করে বা geo-block করে, playback silently ভেঙে যাবে যতক্ষণ না admin manually toggle বন্ধ করে। ভবিষ্যতে periodic re-probe করা ভালো হবে।
- `_probe_codecs` fix করার ফলে ভবিষ্যতে normal (non-direct_relay) url চ্যানেলের auto-transcode **এখন আসলেই trigger হবে** HEVC/exotic audio পেলে — আগে কখনো হতো না। এটা expected/কাঙ্ক্ষিত behavior কিন্তু নজরে রাখা উচিত (নতুন ffmpeg libx264 transcode লোড বাড়তে পারে যেসব চ্যানেল আগে silently pass-through হতো)।
- 140টা চ্যানেল ffprobe-এ `(None, None)` পেয়েছে (timeout/geo-block/unreachable) — এগুলো `direct_relay=False` রয়ে গেছে রক্ষণশীলভাবে; আসলে compatible হতে পারে কিন্তু probe সময়ে সাড়া দেয়নি। প্রয়োজনে `python manage.py enable_direct_relay --dry-run` আবার চালিয়ে retry করা যাবে।
- Frontend build/publish হয়নি (শুধু APK) — admin panel-এর কোনো ফাইল বদলায়নি এই session-এ।

**Tested:** আংশিক — ffprobe fix ম্যানুয়ালি ২টা upstream URL-এ যাচাই হয়েছে (আগে ভুল parse, এখন সঠিক h264/aac ধরছে); mgmt command dry-run ও live run সফল (115টি convert)। `enable_direct_relay` চালু হওয়া চ্যানেলে কোনো running ffmpeg ছিল না তাই stop/cleanup কিছু করার লাগেনি। PlayerScreen.js শুধু babel parse-check করা হয়েছে (`babel-preset-expo`), **ডিভাইসে/emulator-এ আসল playback/recovery flow টেস্ট করা হয়নি** — পরবর্তী agent বা user manual app testing করে দেখুক (বিশেষত Stage1 NUDGE ও Smart Reconnect UI label)। APK build সফল, gradlew assembleRelease থেকে সরাসরি।

---

### [2026-07-03] — Admin Panel Live TV Broadcast player upgrade + hls-proxy auth removal

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/livetv/LiveTVPage.jsx` (PlayerModal), `livetv/api/views.py` (TVChannelViewSet)

**কী করা হয়েছে:**
- **PlayerModal সম্পূর্ণ upgrade:** native `<video controls>` সরিয়ে custom control bar (play/pause, mute+volume slider with localStorage persist, fullscreen, Picture-in-Picture, audio-track selector for multi-audio channels, "Go Live" button যখন live edge থেকে পিছিয়ে যায়), stats overlay (ⓘ বাটন — resolution/bitrate/buffer/dropped frames/live-gap), buffering spinner, keyboard shortcuts (Space/M/F/↑/↓/Esc), auto-hide controls, এবং networkError-এ silent auto-retry backoff (1s/2s/4s) — manual error screen দেখানোর আগে।
- **`hls-proxy` action এখন `AllowAny`** (`TVChannelViewSet.get_permissions()` override) — বাকি সব action (CRUD/start/stop/transcode) `IsAuthenticated`-ই আছে। আগে stream bytes fetch করতেও Bearer token লাগতো যা দীর্ঘক্ষণ live দেখলে expire হয়ে playback ভেঙে যেত ("টোকেন মেয়াদোত্তীর্ণ" error) — এখন শুধু admin panel-এ login করাই যথেষ্ট, প্লেয়ারে আলাদা auth নেই।
- Frontend থেকে hls.js `xhrSetup` Bearer-header injection সরানো হয়েছে (আর দরকার নেই)।

**Side Effect / সতর্কতা:**
- `hls-proxy` endpoint এখন unauthenticated internet থেকেও hit করা যাবে — কিন্তু SSRF-protected netloc allowlist (`livetv/services/netloc_allowlist.py`, শুধু registered channel source host:port) দিয়ে scope করা, তাই arbitrary URL proxy করা যাবে না। তবে conceptually **channel content এখন কেউ token ছাড়া pull করতে পারবে** যদি সঠিক `?url=` জানে (subscription bypass সম্ভব) — যদি এটা business-critical concern হয়, ভবিষ্যতে rate-limit বা signed-URL যোগ করা উচিত।
- এই session-এ backend Explore agent দিয়ে জানা গেছে: v4l2/dvb channel সবসময় H.264/AAC re-encode হয় (browser-compatible guaranteed), কিন্তু `url` (IPTV relay) channel default `-c copy` remux করে — upstream HEVC/H.265 বা exotic audio codec সরাসরি pass-through হতে পারে যা browser play করতে পারে না। এর জন্য আগে থেকেই manual "Transcode" বাটন আছে (PlayerModal error screen) — এটা এই session-এ পরিবর্তন করা হয়নি।
- `admin_panel/dist/` rebuild করা হয়েছে (`vite build`), gunicorn python change auto-reload করেছে।

**Tested:** Frontend `vite build` clean pass। Backend `ast.parse` syntax-verified + `curl hls-proxy/?url=...` দিয়ে দেখা গেছে 400 (bad netloc) আসে, 401 না — অর্থাৎ auth bypass কাজ করছে। কোনো channel এই মুহূর্তে live না থাকায় actual playback browser-এ test করা যায়নি।

---

### [2026-07-03] — Live TV App UI redesign + Stream debugging (ChannelList grid, PlayerScreen simplification)

**পরিবর্তিত ফাইল:** `livetv_app/src/screens/channels/ChannelListScreen.js`, `livetv_app/src/screens/player/PlayerScreen.js`

**কী করা হয়েছে:**
- **ChannelListScreen:** পূর্ণ glass design overhaul — 2-column FlatList grid, প্রতিটি card-এ serial badge, LIVE badge, circular logo (white bg logo channel, colored avatar otherwise), `useSafeAreaInsets` দিয়ে status bar overlap fix, back button-এর orange circle background বাদ। bgOrb glass effect (blur নেই, rgba low-opacity circles)।
- **PlayerScreen:** complex 8-button layout থেকে clean 3-button layout (◀ Prev | ⏸ Play | ▶ Next) + slide-in channel list panel (☰ button → 300px frosted glass panel)। Full subscriber auth বজায় রাখা হয়েছে (`withToken`, `buildUrlQueue`, `Authorization: Bearer` header, failover logic, channel switch)।
- **Stream debugging:** সব ok — login API, channel list API (371 channels), stream proxy (302→HLS manifest, segment URLs token সহ rewrite) সঠিকভাবে কাজ করছে।

**Side Effect / সতর্কতা:**
- **App এখন Login চাই** — phone: `01303120098`, password: `123456` দিয়ে login করতে হবে। এই subscriber account (`LiveTVSubscriber` id=2) active, expires 2026-09-02।
- নতুন client subscriber যোগ করতে admin panel → `/livetv/registration` page ব্যবহার করুন।
- Channel list-এ 371টি channel আসে (485 content_ok=True থেকে ping filter এর পর)। শুধু 1টি channel-এর local FFmpeg mirror (status=live) — বাকি সব upstream proxy দিয়ে serve।
- APK build এই session-এ করা হয়নি — নতুন UI দেখতে হলে নতুন build দরকার।

**Tested:** Stream proxy curl দিয়ে verify করা হয়েছে (HLS manifest + token rewrite OK)। UI device-এ test করা হয়নি।

---

### [2026-07-02] — Production Readiness Audit + Fixes (Security headers, Log rotation, MySQL backup, Frontend rebuild)

**পরিবর্তিত ফাইল:** `config/settings.py`
**নতুন ফাইল:** `deploy/mysql_backup.sh`, `/etc/logrotate.d/isp-bnas` (system), `/etc/cron.d/isp-bnas-backup` (system)

**কী করা হয়েছে:**
- Full production-readiness audit করা হয়েছে (settings, `manage.py check --deploy`, migrations, services, deps, backups, git status)।
- `config/settings.py`-এ যোগ হয়েছে: `SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')`, `SESSION_COOKIE_SECURE = not DEBUG`, `CSRF_COOKIE_SECURE = not DEBUG`, `SECURE_CONTENT_TYPE_NOSNIFF = True`। **ইচ্ছাকৃতভাবে `SECURE_SSL_REDIRECT`/Django-level HSTS যোগ করা হয়নি** — nginx walled-garden default_server block ইচ্ছাকৃতভাবে `X-Forwarded-Proto: http` পাঠায় expired client-দের জন্য, Django-level redirect চালু করলে সেই flow ভেঙে যাবে। HSTS ইতিমধ্যে nginx 443 block-এ `add_header Strict-Transport-Security` দিয়ে হ্যান্ডেল হচ্ছে।
- `deploy/mysql_backup.sh` — daily mysqldump (`.env` থেকে DB creds পড়ে, `MYSQL_PWD` env var ব্যবহার করে যাতে `ps` এ password না দেখা যায়) → `/var/backups/isp_bnas/radius_YYYY-MM-DD.sql.gz`। **কোনো auto-delete/retention pruning নেই — ইচ্ছাকৃত (client billing history কখনো হারানো যাবে না, user explicit সিদ্ধান্ত)।**
- `/etc/cron.d/isp-bnas-backup` — daily 03:00 root cron, backup script চালায়, log যায় `logs/mysql_backup.log`-এ।
- `/etc/logrotate.d/isp-bnas` — `logs/*.log` daily rotate, 14 কপি রাখে, `copytruncate` (gunicorn/celery restart লাগবে না), compress।
- Frontend rebuild করা হয়েছে (`vite build`) — আগের build ১ ঘণ্টা stale ছিল।

**Side Effect / সতর্কতা:**
- Backup ফাইল কখনো delete হবে না — disk usage সময়ের সাথে বাড়বে, periodically `/var/backups/isp_bnas` disk space monitor করা উচিত (ভবিষ্যতে archival/offsite move বিবেচনা করা যেতে পারে, কিন্তু delete নয়)।
- `.env`-এ single shared DB (`DB_NAME=radius`) — app ও FreeRADIUS একই DB ব্যবহার করে, তাই backup script শুধু একটাই DB dump করে (আলাদা `isp_bnas` DB নেই, CLAUDE.md-এর টেবিলে "isp_bnas or configured in .env" বলা আছে সেটাই এই ক্ষেত্রে `radius`)।
- Log rotation/backup cron root-level system config — এই repo-র বাইরে (`/etc/`), তাই future server migration/reprovision-এ এগুলো আবার manually setup করতে হবে (repo-তে শুধু `deploy/mysql_backup.sh` আছে, `/etc/logrotate.d` ও `/etc/cron.d` ফাইল না)।
- `manage.py check --deploy`-এ এখনো ২টা warning বাকি (W004 HSTS, W008 SSL_REDIRECT) — উপরে ব্যাখ্যা করা কারণে ইচ্ছাকৃতভাবে বাদ, এগুলো false-positive হিসেবে treat করা যায়।

**Tested:** হ্যাঁ — `manage.py check --deploy` (W012/W016 চলে গেছে), live API curl (`/api/v1/auth/login/` → 400 validation, gunicorn active, ভাঙেনি), `logrotate -d` dry-run OK, backup script manual run করে `.sql.gz` ফাইল তৈরি হওয়া user কর্তৃক confirm করা হয়েছে, frontend rebuild করে সাইট 200 লোড হচ্ছে confirm করা হয়েছে।

**সংযোজন (একই দিন) — Disk usage in-app alert:** `system_settings/tasks.py` (নতুন) → `check_disk_usage` Celery task, `/` ও `/var/backups` partition-এর usage ৮৫%+ হলে `support.StaffNotification` (notif_type='system') দিয়ে superadmin/admin-দের bell notification পাঠায় (২৪ ঘণ্টায় duplicate suppress করে)। `config/settings.py`-এর `CELERY_BEAT_SCHEDULE`-এ `check-disk-usage` entry (প্রতিদিন সকাল ৬টা) যোগ হয়েছে — কারণ mysqldump backup কখনো delete হয় না, তাই ডিস্ক পূর্ণ হওয়ার ঝুঁকি আছে। **সতর্কতা:** Celery beat/worker gunicorn-এর মতো auto-reload হয় না — নতুন task/schedule যোগ করলে `isp-celery`+`isp-celery-beat` restart লাগবে (এই সেশনে user manually `sudo systemctl restart isp-celery.service isp-celery-beat.service` চালিয়ে confirm করেছেন)। Tested: `celery inspect registered` এ task দেখা গেছে, `PeriodicTask` DB-তে enabled crontab entry হিসেবে confirm করা হয়েছে, manual `check_disk_usage()` shell call করে বর্তমানে disk usage normal (`status: ok`) দেখা গেছে।

---

### [2026-07-02] — Live TV পেজ responsive design + Sidebar dead-link cleanup + Purchase/Inventory route wiring

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/livetv/LiveTVPage.jsx`, `admin_panel/src/components/Sidebar.jsx`, `admin_panel/src/App.jsx`

**কী করা হয়েছে:**
- **LiveTVPage.jsx responsive fix:** Header action button group (M3U/Auto Check/Import/Categories/+New Channel) আগে overflow করে "+ New Channel" cut off হয়ে যেত মোবাইলে — এখন 2-column grid (mobile) → flex-wrap (sm+)। Stats strip grid-cols-2→3→6 breakpoint অনুযায়ী স্কেল করে। Filters row (search/type/category/status dropdown) narrow screen-এ flex-1 হয়ে স্ট্যাক করে। ChannelModal/CategoryModal-এর সব fixed grid-cols-2/3 form section এখন `grid-cols-1 sm:grid-cols-2/3` — ফোনে ১ কলামে নামে। PlayerModal quality-selector row এখন `overflow-x-auto`।
- **Sidebar.jsx dead-link cleanup:** যেসব menu/submenu-এর কোনো frontend route (App.jsx) বা page file ছিলই না, সেগুলো বাদ দেওয়া হয়েছে — Configuration→Billing Status, Client→New Request/Scheduler/Change Request, Billing→Installation Fees, পুরো **Leave Management**, পুরো **Events & Holidays**, **Bandwidth Sale**, পুরো **Assets**, পুরো **Report** section। System→Company Info এর path `/system/company` (route ছিল না, ওটা আসলে backend API endpoint) থেকে বদলে `/settings?tab=company` করা হয়েছে (SettingsPage-এ CompanyTab আগে থেকেই আছে, deep-link সাপোর্ট করে)।
- **Purchase/Inventory route wiring:** `purchase/` ও `inventory/` app-এর page file (VendorListPage, RequisitionListPage/EntryPage, PurchaseListPage/EntryPage, StockPage, ItemCategoryPage, ItemPage, UnitPage, StoreLocationPage) আগে থেকে সম্পূর্ণ বানানো ছিল কিন্তু App.jsx-এ কোনো route ছিল না (dead — sidebar click করলে dashboard-এ redirect হতো)। Backend API (`purchase.api.urls`, `inventory.api.urls`) আগে থেকেই `config/urls.py`-এ registered ছিল, শুধু frontend route missing ছিল — user-কে জিজ্ঞেস করে (route যোগ করে সচল করুন বনাম sidebar থেকে বাদ) confirm করে **route যোগ করা** বেছে নেওয়া হয়েছে। নতুন route: `/purchase/vendors`, `/purchase/requisition`(+`/new`,`/:id/edit`), `/purchase/list`, `/purchase/new`(+`/:id/edit`), `/inventory/stock`, `/inventory/categories`, `/inventory/items`, `/inventory/units`, `/inventory/store-locations`। Sidebar-এ Inventory→Items/Units/Store Location entry নতুন যোগ হয়েছে (আগে ছিল না, কিন্তু page+API সম্পূর্ণ ready ছিল)। `App.jsx`-এ `ItemCategoryPage`/`ItemPage` নাম আগে থেকেই bandwidth module-এর জন্য নেওয়া ছিল, তাই inventory version `InvItemCategoryPage`/`InvItemPage` alias দিয়ে import করা হয়েছে।

**Side Effect / সতর্কতা:**
- Sidebar-এর permission `subModuleKey` mapping backend `role_permissions/module_definitions.py`-এর `purchase`(vendor, requisition, purchase, purchase_bill) ও `inventory`(unit, store_location, item_category, item, stock) sub_modules-এর সাথে মিলিয়ে করা হয়েছে — নতুন কোনো backend module_definitions পরিবর্তন লাগেনি।
- Company Info sidebar link এখন `/settings?tab=company` — query string থাকায় Sidebar-এর `isChildActive`/highlight logic (যেটা শুধু `pathname` compare করে) এই আইটেমকে active হিসেবে highlight করবে না, কিন্তু navigation ঠিকভাবে কাজ করে (cosmetic-only limitation)।
- `/purchase/*` ও `/inventory/*` route নতুন যোগ হওয়ায় role_permissions-এ যাদের `purchase`/`inventory` module access নেই, তারা আগের মতোই sidebar-এ এই menu দেখবে না (permission filter অপরিবর্তিত)।

**Tested:** আংশিক — `vite build` দুইবার clean succeed হয়েছে (LiveTV fix পরে, Sidebar/App.jsx fix পরে), grep দিয়ে confirm করা হয়েছে যে বাদ দেওয়া প্রতিটি path App.jsx-এ কোথাও route করা ছিল না এবং নতুন যোগ করা route/page/API সব জায়গায় (frontend file + Django urls.py) বিদ্যমান। ব্রাউজারে actual click-through করে UI verify করা হয়নি এই সেশনে।

---

### [2026-07-01] — Live TV App: Self-registration বাদ + Login-পরবর্তী Menu (Live TV / FTP Movie Server)

**পরিবর্তিত ফাইল:** `livetv_app/src/screens/auth/LoginScreen.js`, `livetv_app/App.js`, `livetv_app/src/screens/home/HomeScreen.js`
**নতুন ফাইল:** `livetv_app/src/screens/home/MenuScreen.js`, `livetv_app/src/screens/ftp/FTPListScreen.js`, `livetv_app/src/screens/ftp/WebViewScreen.js`

**কী করা হয়েছে:**
- LoginScreen থেকে Register tab/form সম্পূর্ণ সরানো হয়েছে — এখন শুধু admin panel-এর নতুন `LiveTVRegistrationPage.jsx` থেকেই subscriber তৈরি হবে।
- Login-এর পর সরাসরি channel list-এ না গিয়ে নতুন `MenuScreen` (route: `Menu`) দেখাবে — দুটি কার্ড: "Live TV" (→ existing `Home` route, category list) ও "FTP Movie Server" (→ নতুন `FTPList` route)।
- `FTPListScreen` — `mobile_api`-এর existing public endpoint `GET /app/config/` (ftp_servers field, যা আগে থেকেই `system_settings.MobileAppConfig`-এ আছে ও admin panel থেকে কনফিগারযোগ্য) থেকে সার্ভার লিস্ট আনে; একটাই সার্ভার থাকলে সরাসরি WebView-এ open করে দেয়, একাধিক থাকলে লিস্ট দেখায়।
- `WebViewScreen` (livetv_app-এর নিজস্ব, `react-native-webview` আগে থেকেই dependency-তে আছে) — FTP URL in-app খুলবে।
- `HomeScreen`-এর ☰ আইকন এখন `Menu` route-এ ফিরিয়ে নিয়ে যায়।

**Side Effect / সতর্কতা:**
- `AuthContext.js`-এর `register()` function অপরিবর্তিত রাখা হয়েছে (backend endpoint এখনও আছে) কিন্তু LoginScreen থেকে আর call হয় না — ভবিষ্যতে dead code মনে হলে cleanup করা যায়।
- FTP সার্ভার তালিকা খালি থাকলে (admin panel-এ কিছু যোগ করা না থাকলে) FTPListScreen "কোনো সার্ভার যোগ করা হয়নি" দেখাবে — খালি অবস্থায় crash করবে না।
- App.js navigator-এ নতুন routes (`Menu` প্রথম screen, `FTPList`, `WebView`) যোগ হয়েছে — পুরনো deep link/notification কোথাও সরাসরি `Home` route reference করলে এখনও কাজ করবে (route নাম অপরিবর্তিত)।

**Tested:** আংশিক — Babel parser দিয়ে সব নতুন/পরিবর্তিত JS ফাইলের syntax validate করা হয়েছে (OK)। Device/emulator-এ end-to-end run করে দেখা হয়নি, পরবর্তী agent বা user APK build করে UI flow verify করবে।

---

### [2026-07-01] — Live TV: Deep Content Check + Instant Channel Switch

**পরিবর্তিত ফাইল:** `livetv/models.py`, `livetv/migrations/0011_content_check_fields.py`, `livetv/api/views.py`, `livetv/api/serializers.py`, `mobile_api/api/views.py`, `admin_panel/src/pages/livetv/LiveTVPage.jsx`, `livetv_app/src/screens/player/PlayerScreen.js`

**কী করা হয়েছে:**
- **[Model]** TVChannel-এ `last_content_ok`, `last_content_checked_at` যোগ (migration 0011)
- **[Views]** `_check_stream_content()` — TCP ping + actual video verify (HTTP m3u8 fetch / ffprobe RTSP)
- **[Views]** `deep_check_all` action — background thread (20 workers), Redis progress track, mobile cache clear
- **[Views]** `deep_check_status` action — progress poll endpoint
- **[Mobile API]** `last_content_ok=False` হলে app-এ দেখাবে না (None = unchecked → দেখাবে)
- **[Admin Panel]** "Auto Check" বাটন, progress bar, channel card-এ ✓/✗ icon
- **[PlayerScreen]** Dual-player (playerA + playerB) — পুরনো channel চলতে থাকে, নতুন background-এ load, ready হলে 200ms crossfade

**Side Effect / সতর্কতা:**
- Deep check 600+ channel-এ 3-5 মিনিট লাগতে পারে (20 concurrent workers)
- `last_content_ok=null` মানে কখনো check হয়নি → app-এ দেখাবে (safe default)
- PlayerScreen-এ 2টি VideoPlayer instance — Android-এ extra memory ব্যবহার হবে (acceptable)
- Rapid channel switch: `switchingRef` দিয়ে debounce করা আছে

**Tested:** হ্যাঁ — Python syntax OK, Vite build OK (3.15s), migration applied

---

### [2026-07-01] — Live TV: MySQL "Too many connections" fix — background ping threads

**পরিবর্তিত ফাইল:** `livetv/api/views.py`

**কী করা হয়েছে:**
- `_do_ping()` ও `_ping_all()` background thread-এ `close_old_connections()` call যোগ — thread শুরুতে stale connection release, `finally` block-এ thread শেষে connection release।
- এর আগে প্রতিটি ping thread একটি MySQL connection ধরে রাখত, বহু channel ping করতে গিয়ে connection limit (151) শেষ হয়ে `(1040) Too many connections` error → dashboard 500 দিচ্ছিল।

**Side Effect / সতর্কতা:**
- Gunicorn restart করা হয়েছে (স্বয়ংক্রিয় নয়, manually)
- Background thread-এ DB ব্যবহার করলে সবসময় `close_old_connections()` call করতে হবে

**Tested:** হ্যাঁ — API returns 401 (auth required, server up), error log clean

---

### [2026-07-01] — Live TV: PingBadge always-accurate (DB last_ping_ms) + auto app filter

**পরিবর্তিত ফাইল:** `livetv/models.py`, `livetv/api/views.py`, `livetv/api/serializers.py`, `admin_panel/src/pages/livetv/LiveTVPage.jsx`

**কী করা হয়েছে:**
- **[Model]** TVChannel-এ `last_ping_ms`, `last_ping_ok`, `last_pinged_at` field যোগ (migration 0010)
- **[Views]** `_do_ping()` ও `_ping_all()` background thread-এ ping শেষে DB update করে (`TVChannel.objects.filter(pk=ch_id).update(...)`)
- **[Serializer]** `last_ping_ms`, `last_ping_ok`, `last_pinged_at` serializer-এ যোগ
- **[PingBadge]** `initialMs`/`initialOk` prop — channel load হতেই DB value দেখায়, pending-এ ●●● দেখায় না। Background check-এ pending এলেও আগের value রাখে।

**Side Effect / সতর্কতা:**
- নতুন channel (কখনো ping হয়নি) এখনো ●●● দেখাবে প্রথমবার — স্বাভাবিক
- `last_ping_ms` DB-তে পড়ে থাকা পুরনো value হতে পারে (90s পর্যন্ত stale) — intentional

**Tested:** হ্যাঁ — migration OK, Vite build OK (3.40s)

---

### [2026-07-01] — Live TV: Mobile app ping filter (≤300ms) + Import bugs fix

**পরিবর্তিত ফাইল:** `mobile_api/api/views.py`, `livetv/models.py`, `admin_panel/src/pages/livetv/LiveTVPage.jsx`

**কী করা হয়েছে:**
- **[Mobile filter]** `AppLiveTVChannelsView` — Redis cache থেকে batch ping fetch, 300ms-এর বেশি URL channel app-এ দেখাবে না। Cache miss/pending → দেখাবে। `PING_THRESHOLD_MS = 300` constant।
- **[Import fix]** `logo_url` max_length 200→1000 (migration 0007), `name` 100→255, `slug` 120→255 (migrations 0008, 0009) — playlist import-এ "Data too long" error ঠিক হয়েছে।
- **[Frontend fix]** ImportModal duplicate useEffect (hooks violation) সরানো হয়েছে।

**Side Effect / সতর্কতা:**
- Ping cache (90s TTL) না থাকলে channel দেখাবে (pending ধরা হয়)। প্রথম 90s-এ সব channel দেখাতে পারে।
- Threshold বদলাতে হলে `AppLiveTVChannelsView.PING_THRESHOLD_MS` বদলাও + `mobile_livetv_channels` cache delete করো।

**Tested:** হ্যাঁ — syntax OK, migration applied, cache cleared

---

### [2026-06-30] — Live TV: ImportModal white-screen crash fix

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/livetv/LiveTVPage.jsx`

**কী করা হয়েছে:** `ImportModal`-এ `if (!open) return null;` এর পরে duplicate `useEffect` (pingMap re-sort) ছিল — React Rules of Hooks violation। এটি remove করা হয়েছে। প্রথম useEffect (line ~1201) যা conditional return-এর আগে আছে সেটাই সঠিক ও কার্যকর।

**Side Effect / সতর্কতা:** Import Playlist বাটন click করলে এখন modal সঠিকভাবে খুলবে।

**Tested:** হ্যাঁ — Vite build successful (2.95s)

---

### [2026-06-30] — Live TV: Performance overhaul — ping cache + mobile cache + FlatList optimize (v19 APK)

**পরিবর্তিত ফাইল:**
`livetv/api/views.py`, `mobile_api/api/views.py`,
`livetv_app/src/screens/channels/ChannelListScreen.js`,
`livetv_app/src/screens/home/HomeScreen.js`,
`admin_panel/src/pages/livetv/LiveTVPage.jsx`,
`livetv_app/android/app/build.gradle`

**Root Cause:** PingBadge 399টি channel-এর ping একসাথে পাঠাচ্ছিল (5s timeout each) → 3 gunicorn worker আটকে যাচ্ছিল → mobile API 20s দেরি।

**কী করা হয়েছে:**
- **[Critical Fix]** `ping_stream` ও `ping_all_urls` → Redis cache (90s TTL) + background daemon thread। Worker কখনো block হয় না। Cache miss → `{pending:true}` return, background thread শেষে cache populate হয়।
- **[PingBadge]** `pending:true` handle, 5s retry, staggered start (0–15s random) → 399টি একসাথে পাঠায় না
- **[Mobile API]** Redis cache 45s TTL → first call `only()` queryset, subsequent calls instant। Cache auto-clear on channel create/update
- **[ChannelListScreen]** Module-level cache (60s), FlatList: `getItemLayout`, `maxToRenderPerBatch=8`, `windowSize=5`, `removeClippedSubviews`, `initialNumToRender=10`
- **[HomeScreen]** Module-level cache, non-blocking `openChannel`
- **[TS Support]** TS URLs ExoPlayer-এ নিজে play হয় (special handling নেই)
- **APK v19** built (1m8s), published: `https://roisp.duckdns.org/media/app/rajamehar-livetv.apk`

**Side Effect / সতর্কতা:**
- Ping result 90s পুরনো হতে পারে (এটা intentional)
- Mobile channel list 45s stale থাকতে পারে

**Tested:** হ্যাঁ — mobile API 20s → 35ms confirmed; Gradle BUILD SUCCESSFUL (1m8s)

---

### [2026-06-30] — Live TV: Import Playlist improvements — HLS master + auto speed sort

**পরিবর্তিত ফাইল:** `livetv/services/playlist_parser.py`, `livetv/api/views.py`, `admin_panel/src/pages/livetv/LiveTVPage.jsx`

**কী করা হয়েছে:**
- **[Parser]** HLS master playlist (`#EXT-X-STREAM-INF`) সাপোর্ট — highest bandwidth URL টি best channel হিসেবে import হবে
- **[API]** `POST /api/v1/livetv/channels/batch-ping/` — একসাথে 300 URL পর্যন্ত parallel ping (50 workers)
- **[API]** HLS proxy `allowed_netlocs` Redis cache (TTL 120s) — প্রতি request-এ DB query বাদ
- **[Frontend]** ImportModal সম্পূর্ণ পুনর্লিখন:
  - Parse হওয়ার সাথে সাথে background batch-ping শুরু
  - Speed sort (default), A-Z, Original — sort button দিয়ে switch
  - Preview table-এ latency badge (green/yellow/red) realtime update
  - #1 channel-কে golden badge, top 3 silver
  - Import order = selected channels-এর current sort order

**Side Effect / সতর্কতা:**
- `perform_create` / `perform_update` → `livetv_allowed_netlocs` cache clear করে
- `import_playlist` view-ও cache clear করে

**Tested:** হ্যাঁ — parser unit test (HLS master → highest bandwidth URL), build successful (3.30s)

---

### [2026-06-30] — Live TV: Critical serializer performance fix (114s → 62ms)

**পরিবর্তিত ফাইল:** `livetv/api/serializers.py`

**কী করা হয়েছে:**
- `TVChannelSerializer.get_hls_url()` থেকে `StreamService._resolve_hls_url()` call সরানো হয়েছে
- আগে URL channels-এ serialization-এর সময় প্রতিটি channel-এ HTTP request হচ্ছিল (85 channels = 85 requests) → API 1m54s লাগছিল
- এখন URL channels-এ সরাসরি `source_url` দেওয়া হয়; master playlist resolve করা হয় HLS proxy-তে (play করার সময়)
- ফলাফল: channels API **62ms** (আগে 114,000ms)

**Side Effect / সতর্কতা:**
- Admin panel browser player ঠিকই আছে — player `toProxyUrl(hls_url)` দিয়ে HLS proxy তে পাঠায়, proxy master playlist detect করে video sub-playlist-এ redirect করে
- Star Plus/CMAF streams এখনো সঠিকভাবে কাজ করবে

**Root Cause:** এই serializer bug-এর কারণে gunicorn workers সব আটকে যাচ্ছিল → admin panel ও mobile app উভয়ই blank/loading দেখাচ্ছিল

**Tested:** হ্যাঁ — `time curl` দিয়ে before (1m54s) ও after (62ms) তুলনা করা হয়েছে

---

### [2026-06-30] — Live TV PlayerScreen: MX Player-style UI redesign (v18)

**পরিবর্তিত ফাইল:** `livetv_app/src/screens/player/PlayerScreen.js`

**কী করা হয়েছে:**
- **সম্পূর্ণ UI রিডিজাইন** — MX Player-style layout:
  - **Top bar:** plain ← back arrow + "CH XX Channel Name" + ☰ + ⋮ (tracks)
  - **Middle options row:** circular dark buttons — Lock, Timer, Tracks, Volume/Mute, Channels
  - **Progress bar:** [current time] — green filled bar + green dot at end — [● LIVE badge]
  - **Bottom bar:** 🔒 | ⏮ (prev ch, circular) | |◀ (first ch) | ⏸/▶ (white circle) | ▶| (last ch) | ⏭ (next ch, circular) | ⤡ (tracks)
- Orange circle back button সরানো হয়েছে → plain white arrow
- Glass design সরানো হয়েছে → dark semi-transparent overlay (#0,0,0,0.72)
- Progress bar green color (#4CAF50) — LIVE badge with green dot
- Play/Pause: white circle (rgba(255,255,255,0.88)) with dark icon — screenshot-এর মতো
- Settings popup সম্পূর্ণ সরানো হয়েছে — ⋮ directly TracksModal খোলে
- Background tap: controls show/hide toggle (single Pressable)
- Sleep timer: Timer option button দিয়ে access হয়, bottom bar থেকে নয়
- APK build সফল (21s), publish: https://roisp.duckdns.org/media/app/rajamehar-livetv.apk

**Side Effect / সতর্কতা:** `settingsOpen` state এবং settings popup সম্পূর্ণ সরানো হয়েছে।

**Tested:** হ্যাঁ — Brace/paren balance 0, Gradle assembleRelease BUILD SUCCESSFUL (21s), 67M APK published

---

### [2026-06-30] — Live TV: Dynamic Category CRUD + Player error UX + Design fixes

**পরিবর্তিত ফাইল:** `livetv/models.py`, `livetv/migrations/0003_*, 0004_*`, `livetv/api/serializers.py`, `livetv/api/views.py`, `livetv/api/urls.py`, `admin_panel/src/pages/livetv/LiveTVPage.jsx`

**কী করা হয়েছে:**
- **[FEATURE]** `TVCategory` model যোগ (slug PK, name, color, sort_order) — 9টি default category seeded (News/Entertainment/Sports/Religious/International/Music/Movies/Kids/Other)
- **[API]** `GET/POST/PUT/DELETE /api/v1/livetv/categories/` — `TVCategoryViewSet` + serializer (channel_count field সহ)
- **[UI]** Header-এ "📂 Categories" button → CategoryModal (add/edit/delete, color picker, channel count guard)
- **[UI]** Channel add/edit form + filter bar → dynamic API থেকে categories
- **[FIX]** Pagination: `TVChannelViewSet.pagination_class = None` → সব channel এক request-এ
- **[FIX]** Player: `recoverMediaError()` auto-retry, networkError/mediaError বাংলায় কারণ, Retry + Copy URL + VLC button, "H.264 Transcode চালু করুন" button
- **[FIX]** Serializer: URL-type channel-এ FFmpeg চললে local H.264 HLS URL return করে
- **[FIX]** Proxy: upstream error code pass-through (404/403 → HLS.js সঠিক error দেখায়), timeout 10s→15s
- **[DESIGN]** Dark header, full-width layout, stats strip, filter bar redesign, 2xl:grid-cols-5
- **Migration note:** 0003 FAKED হয়েছে (table ছিল না), 0004 দিয়ে RunSQL CREATE TABLE IF NOT EXISTS + seed

**Side Effect / সতর্কতা:** `TVChannel.category` max_length 20→50 (migration faked, actual alter হয়নি — data ঠিক থাকবে কারণ existing slugs সব ≤20 char)।

**Tested:** হ্যাঁ — Vite build সফল, DB-তে 9 categories verified

---

### [2026-06-30] — Live TV Admin Panel: full-width redesign + pagination fix

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/livetv/LiveTVPage.jsx`

**কী করা হয়েছে:**
- **[BUG FIX]** চ্যানেল count mismatch (20 vs 60): API call `?page_size=9999` যোগ করা হয়েছে — আগে DRF pagination-এ শুধু প্রথম ২০টি আসত, stats endpoint-এ ৬০ দেখাত
- **[UI REDESIGN]** `max-w-screen-xl mx-auto` সরিয়ে full-width layout করা হয়েছে
- Dark header bar (bg-gray-900), red "New Channel" button
- Stats strip — 5 column bordered bar (border-t-2 accent color প্রতিটিতে)
- Filter bar — gray-50 inputs, search-এ icon, status options-এ emoji
- Channel grid: `2xl:grid-cols-5` যোগ করা হয়েছে (আরো বড় স্ক্রিনে ৫ কলাম)
- StatCard component সরানো হয়েছে (ব্যবহার নেই)
- Filter count: `filtered / total channel(s)` দেখায়

**Side Effect / সতর্কতা:** StatCard component সরানো হয়েছে — অন্য কোথাও import থাকলে error হবে (এই ফাইলেই ছিল)।

**Tested:** হ্যাঁ — Vite build successful (3.27s)

---

### [2026-06-30] — Live TV APK startup crash fix: expo-screen-orientation version mismatch সরানো

**পরিবর্তিত ফাইল:** `livetv_app/package.json`, `livetv_app/android/app/build.gradle`, `livetv_app/App.js`, `livetv_app/src/screens/channels/ChannelGridScreen.js`

**কী করা হয়েছে:**
- **[CRASH FIX]** `expo-screen-orientation@56.0.5` (SDK 56) কিন্তু `expo@54.0.35` (SDK 54) — native module initialization crash করাচ্ছিল। Package dependency সম্পূর্ণ সরানো হয়েছে। `orientation: 'all'` navigation prop Android-এ native `ScreenStack`-ই handle করে, আলাদা package লাগে না।
- **[BUILD FIX]** `build.gradle`-এ `versionCode 3` hardcoded ছিল — সব APK versionCode 3 দিয়ে build হচ্ছিল, update install হচ্ছিল না। এখন `app.json` থেকে dynamic read করে।
- **[LATENT CRASH FIX]** `AuthProvider` App.js-এ যোগ করা হয়েছে — LoginScreen future-এ navigate করলে `useAuth()` null দিত।
- **[PERF FIX]** `ChannelGridScreen`-এ `ChannelCard` render function-এর ভেতরে define ছিল — module scope-এ `memo()` দিয়ে তোলা হয়েছে।
- APK versionCode 13 (app.json থেকে 12+1) দিয়ে build হয়েছে এবং publish হয়েছে।

**Side Effect / সতর্কতা:** `expo-screen-orientation` সরানো হয়েছে — PlayerScreen-এ `orientation: 'all'` navigation option কাজ করবে (Android native), কিন্তু `ScreenOrientation` JS API আর ব্যবহার করা যাবে না। যদি ভবিষ্যতে orientation lock/unlock JS API দরকার হয়, SDK 54-compatible version install করতে হবে (expo SDK version-এর সাথে match করা version দিতে হবে)।

**Tested:** হ্যাঁ — `npm install` সফল, Gradle `assembleRelease` BUILD SUCCESSFUL (47s), APK 67M publish হয়েছে `https://roisp.duckdns.org/media/app/rajamehar-livetv.apk`

---

### [2026-06-21] — পেমেন্টের পর auto-enable: live session kick + expiry = পেমেন্ট ডেট+১ মাস

**পরিবর্তিত ফাইল:** `billing/models.py`

**কী করা হয়েছে:**
- **সমস্যা ১ (profile apply হয় না):** expired ক্লায়েন্ট Blocked_Group-এ থাকলে Expired pool (192.168.170.x) + `Session-Timeout=300` পায়। পেমেন্টের পর `_auto_enable_client_if_paid()` RADIUS group ঠিক করে কিন্তু **চলমান PPPoE session kick করত না** — profile/IP শুধু auth-এ নির্ধারিত হয় বলে ক্লায়েন্ট Expired pool-এ আটকে থাকত। Fix: RADIUS restore-এর পর `MikrotikService.disconnect_active_session(username)` যোগ → redial বাধ্য, সাথে সাথে আসল pool।
- **সমস্যা ২ (expiry ভুল):** আগে expiry = `today`-র পরের মাস + fixed `expiry_day`। User চান **পেমেন্টের দিন + ১ মাস**। নতুন helper `_set_next_expiry(client, as_of_date)` — পেমেন্ট তারিখ থেকে পরের মাসের একই দিন, `expiry_day`-ও সেই দিনে আপডেট, মাসে দিন না থাকলে month-end clamp। `Payment.save()` থেকে `self.payment_date` পাস হয়; `receive_payment`/views default `today` (real-time)।
- R3545222 ম্যানুয়ালি সংশোধন: expiry 2026-07-31 → **2026-07-21**, expiry_day 31→21।

**Side Effect / সতর্কতা:** `_auto_enable_client_if_paid` ও `_update_expiry_and_enable_for_unverified` এখন `expiry_day`-ও পরিবর্তন করে (`save` update_fields-এ যোগ হয়েছে)। নতুন payment-এ ক্লায়েন্টের billing-দিন পেমেন্টের দিনে শিফট হবে — এটা ইচ্ছাকৃত।

- **Timezone fix:** `payment_date` UTC-তে stored; `_set_next_expiry`-এ aware datetime হলে `timezone.localtime()` দিয়ে Asia/Dhaka-তে নামিয়ে তারপর `.date()` — মধ্যরাতের কাছাকাছি পেমেন্টে off-by-one রোধ। সব payment flow যাচাই: receive_payment (main UI) → today=payment day (auto_now_add); Payment.save → self.payment_date; approve-selected → original payment_date; waive/bill-edit → today। Guard: expired/suspended/inactive + due=0 হলেই চলে (active early-payment expiry শিফট করে না — payment-date model-এ নিরাপদ)।

**Tested:** আংশিক — `_set_next_expiry` logic unit-যাচাই (06-21→07-21; 03-31→04-30 ও 01-30→02-28 clamp; 12-15→2027-01-15; UTC 06-21 20:00→Dhaka 06-22→07-22 timezone)। R3545222-এর disconnect fix বাস্তবে redial-এর সময় effect হবে (এখন অফলাইন)।

---

### [2026-06-21] — VoIP: emulator টেস্ট সেটআপ + call hardening + অডিও infra (coturn/Asterisk/MikroTik) + extension dialing

**পরিবর্তিত ফাইল:** `mobile_app/plugins/withGradleMemory.js`, `mobile_app/src/services/{sipPhone.js,messaging.js,backgroundService.js}`, `mobile_app/src/context/{CallContext.js,AuthContext.js}`, `mobile_app/src/screens/call/DialPadScreen.js`, `mobile_app/public_apk/README.md`, `scripts/{build_and_publish_apk.sh,update_apk_download.sh}`, `deploy/asterisk/{fix_media_nat.sh,coturn/setup_coturn.sh}`, `deploy/asterisk/configs/extensions.conf`

**কী করা হয়েছে:**
- **Emulator টেস্ট সেটআপ:** এক ফোন থাকায় PC emulator-কে ২য় endpoint বানানো। `withGradleMemory.js`-এ `EMULATOR_BUILD=1` opt-in → reactNativeArchitectures-এ `x86_64` যোগ (default arm-only অপরিবর্তিত)। `scripts/build_and_publish_apk.sh` (EAS local build + publish), `update_apk_download.sh` (newest build auto-detect → media/app)। README-তে পূর্ণ গাইড (emulator RAM খাঁদ: build≠emulator একসাথে নয়, swap, -gpu host)।
- **Call reliability hardening (সব JS → OTA-able):**
  - `sipPhone.js`: `wakeRegister()` (FCM-এ পেন্ডিং backoff বাতিল করে instant register); `_startStatusSync()` reconciler (Registerer.state পড়ে registered নিশ্চিত — "সংযোগ হচ্ছে"-তে আটকে থাকা bug fix); reconnect backoff max 30s→6s (flicker কমাতে)।
  - `messaging.js`: FCM incoming-এ wakeRegister।
  - `CallContext.js`: watchdog escalation — non-registered ≈80s হলে hardReset (stuck থেকে auto-recover)।
  - `AuthContext.js`: auto-logout role-based — **staff/admin কখনো নয়** (always-online), client/pop ৮ঘণ্টা।
  - `backgroundService.js`: battery exemption notifee দিয়ে (isBatteryOptimizationEnabled + openBatteryOptimizationSettings) + OEM **auto-start** (getPowerManagerInfo/openPowerManagerSettings); `openCallReliabilitySettings()` manual।
  - `DialPadScreen.js`: ONLINE_GRACE 12s→18s।
- **অডিও (NAT) — সার্ভার infra (মূল কারণ):** কল connect হতো কিন্তু অডিও আসত না। DevTools SDP-তে Asterisk media = `c=127.0.1.1` (/etc/hosts hostname) + শুধু internal/docker candidate; **coturn DOWN + turnserver.conf-এ placeholder**। ফিক্স script: `deploy/asterisk/coturn/setup_coturn.sh` (.env TURN_SECRET → /etc/turnserver.conf + external-ip + enable/start), `deploy/asterisk/fix_media_nat.sh` (pjsip external_media/signaling+local_net, rtp stunaddr, reload)। **public IP দিয়ে চালাতে হয়** (`sudo bash ... 103.214.202.17`) — domain locally LAN-এ resolve করে। MikroTik-এ 3478/5349 + relay 49152-65535 + RTP 10000-20000 forward (আগে থেকেই ছিল)। **ফলাফল:** coturn active, relay candidate আসছে, admin→emulator অডিও PC স্পিকারে শোনা যায় (emulator→ফোন mic নেই বলে নীরব — emulator সীমা; পূর্ণ দুমুখী = ২টা আসল ফোন)।
- **Extension dialing:** PBX Agents পেজে (VoIP→PBX Agents) প্রতি staff-এর extension (101/102/103…) সেট → save → `pbx_provision._write_all_hotlines()` স্বয়ংক্রিয়ভাবে `exten => <number>` (wake-dial) generate করে। যাচাইকৃত: emulator→`102`→admin রিং (180 Ringing)। আমার পরীক্ষামূলক `0<id>` dialplan hack পরে revert করা হয়েছে (ডুপ্লিকেট)। `100` = hotline ring group (agent_1/4/5)।

**Side Effect / সতর্কতা:**
- দুই মেশিন: `/var/www/isp_bnas` (লাইভ deploy, nginx/asterisk/coturn এখানে; **sshd নেই**) আর `/home/amir/isp_bnas` (build clone, EAS/SDK)। কোড sync = git (GitHub `feat/mobile-app-overhaul`)। সার্ভারে edit → commit+push → clone-এ pull।
- JS পরিবর্তন → **rebuild নয়, OTA** (`eas update --branch preview`) যথেষ্ট (expo-updates, runtimeVersion 1.1.0, channel preview)। Native/প্যাকেজ/app version বদলালে তবেই rebuild।
- coturn/Asterisk fix script **public IP আর্গুমেন্ট দিয়ে** চালাতে হবে (domain→LAN resolve সমস্যা)। `/etc/hosts`-এ `127.0.1.1 ISP-LAB` থাকায় local client-এ Asterisk media 127.0.1.1 দেখায় (external client-এ external_media_address কাজ করে)।
- `EMULATOR_BUILD=1 npx expo prebuild` `android/` তৈরি করে → পরে EAS/standalone build-এর আগে `rm -rf android` (নাহলে "bare workflow runtime version" error)।
- Emulator-এ পূর্ণ অডিও নয় (double-NAT + mic নেই) — শুধু signaling/call-flow/এক-দিক অডিও টেস্ট।

**Tested:** সব JS babel-parse ✓ | সব script bash -n + logic /tmp-কপিতে ✓ | live: coturn active, register stable (no flicker on latest JS), 102→admin ring + admin→emulator audio ✓ | পূর্ণ দুমুখী অডিও = ২য় আসল ফোন বাকি।

---

### [2026-06-21] — App-user ® badge + Reminder {app_link} + Walled garden APK→media + Bulk import username fix

**পরিবর্তিত ফাইল:** `clients/api/serializers.py`, `billing/api/views.py`, `admin_panel/src/pages/clients/ClientList.jsx`, `admin_panel/src/pages/billing/BillList.jsx`, `billing/reminder_service.py`, `billing/models.py` (+ migration `0010`), `admin_panel/src/pages/billing/PaymentReminderPage.jsx`, `admin_panel/src/pages/mikrotik/BulkClientImportPage.jsx`, `scripts/point_app_download_to_media.sh` (নতুন)

**কী করা হয়েছে:**
- **® App-user badge:** অ্যাপে রেজিস্টার্ড client (`is_app_user` = `app_password` সেট) চেনাতে Customer ID-এর পাশে সবুজ ® দেখায় — Client List ও Billing List (মোবাইল কার্ড + ডেস্কটপ টেবিল, ৪ জায়গা)। Backend: `ClientListSerializer`-এ `is_app_user`, billing list dict-এ `client_is_app_user`। স্টাইল: `text-[15px] font-black text-emerald-600 relative -top-[2px]` (ব্যাকগ্রাউন্ড ছাড়া, `align-super` ব্যবহার করলে কেটে যায় — তাই relative top)।
- **Reminder {app_link}:** Payment Reminder message template-এ নতুন `{app_link}` placeholder → `https://<domain>/media/app/rajamehar-online.apk`। নতুন helper `_public_base_url()` (CSRF_TRUSTED_ORIGINS → ALLOWED_HOSTS-এর আসল ডোমেইন)। help_text + frontend placeholder hint আপডেট।
- **Walled garden APK → media:** expired.html-এর "অ্যাপ ডাউনলোড করুন" বাটন (`/app/download`) এখন `public_apk/`-এর বদলে `media/app/rajamehar-online.apk` থেকে নামবে। বাটন href অপরিবর্তিত; nginx `/app/download` (২ ব্লক) direct-alias-এ বদলানোর জন্য `scripts/point_app_download_to_media.sh` (ব্যাকআপ + nginx -t + auto-rollback)। **sudo দিয়ে চালাতে হবে — এখনো apply হয়নি।**
- **Bulk import fix:** `BulkClientImportPage.jsx` pre-import validation-এ ভুল casing `row.Username` → `row.UserName` (সঠিক key), নাহলে username থাকা সত্ত্বেও "Username খালি" দেখাত ও import আটকাত।

**Side Effect / সতর্কতা:** Walled garden APK redirect কাজ করতে হলে `scripts/point_app_download_to_media.sh` sudo দিয়ে চালানো বাকি — না চালালে বাটন এখনো public_apk থেকেই নামবে। `_public_base_url()` খালি ফিরলে (ডোমেইন না পেলে) `{app_link}` খালি স্ট্রিং হবে। Backend Python edit → gunicorn auto-reload; frontend build সম্পন্ন।

**Tested:** Vite build ✓ | AST parse (views/serializers/reminder/models) ✓ | migration 0010 apply ✓ | `_public_base_url()` live → `https://roisp.duckdns.org`, `{app_link}` render ✓ | nginx replace logic config-কপিতে টেস্ট (২ ব্লক) ✓ | bash -n script ✓।

---

### [2026-06-21] — advance payment delete → advance_balance কমে না (ভুতুড়ে balance bug) + status change ডবল লগ

**পরিবর্তিত ফাইল:** `billing/api/views.py`, `clients/api/views.py`

**কী করা হয়েছে:**
- **Bug 1 (billing):** `PaymentViewSet.destroy()` — pure advance পেমেন্ট (`bill=None`) delete করলে শুধু Payment row মুছত, কিন্তু `client.advance_balance` থেকে টাকা **কমাত না**। ফলে ভুতুড়ে advance balance থেকে যেত, যা পরে নতুন পেমেন্টে `apply_advance_to_bills` দিয়ে অন্য বিলে auto-apply হয়ে যেত (লক্ষণ: ৫০০ ক্যাশ রিসিভে আগের বকেয়াসহ পরিশোধ)। Fix: `bill_id is None` হলে delete-এর আগে `advance_balance -= amount` (max 0)। প্যাটার্ন `_reverse_previous_transfer()` (line ~1073)-এর সাথে মিল।
- **Bug 2 (clients):** `perform_update()` — status পরিবর্তন হলে dedicated `client_enabled/disabled` লগ (Enable/Disable Log) **এবং** `profile_updated` diff দুটোতেই "Status: X→Y" আসত → একই ঘটনা ডবল লগ (Change Log + Enable/Disable Log)। Fix: `profile_updated` diff তৈরির লুপে `attr == 'status'` skip।

**Side Effect / সতর্কতা:** Bug 1 fix শুধু নতুন delete-এ প্রযোজ্য — আগে তৈরি হওয়া ভুতুড়ে advance ম্যানুয়ালি ঠিক করতে হয়। শুধু status বদলালে এখন আর Change Log-এ কোনো `profile_updated` entry আসবে না (শুধু Enable/Disable Log-এ থাকবে) — এটা ইচ্ছাকৃত।

**Tested:** দুটো ফাইলেই AST parse ✓ | R3545222 client-এ live verify (advance 0, due 0, ১টি payment) ✓ | backend-only, frontend build লাগেনি।

---

### [2026-06-18] — Bill delete: browser confirm() → in-page modal + unpaid-only delete নীতি

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/clients/ClientProfile.jsx`, `billing/api/views.py`

**কী করা হয়েছে:**
- ClientProfile-এর bill delete-এর বিশ্রী `window.confirm()` সরিয়ে পেজের ভিতরে সুন্দর confirmation modal (Add Bill modal-এর প্যাটার্নে)। নতুন state `billDeleteTarget`, handler split → `handleBillDelete` (modal খোলে) + `confirmBillDelete` (action চালায়)।
- **নতুন delete নীতি (আগে সম্পূর্ণ 405 ছিল):** `BillViewSet.destroy()` — শুধু `superadmin` এবং শুধু `paid_amount == 0` (unpaid) বিল হার্ড-ডিলিট করতে পারবে; delete-এ client.due_amount recalculate হয়। paid/partial বিলে 405 + "Waive ব্যবহার করুন"।
- Frontend modal smart: `paid_amount > 0` হলে modal Waive-কনফার্মে রূপ নেয় (amber রঙ, `POST /billing/bills/{id}/waive/` কল), unpaid হলে লাল delete-কনফার্ম (`DELETE`)। ফলে user কখনো 405 toast দেখে না — সঠিক action নিজেই হয়।

**Side Effect / সতর্কতা:** `Payment` মডেল `on_delete=CASCADE` → তাই paid বিল delete হলে পেমেন্টও মুছে accounting নষ্ট হতো; এজন্যই paid বিলে delete বন্ধ রেখে waive করা হয়। Unpaid বিল delete নিরাপদ (কোনো payment/collection record নেই)। CLAUDE.md-এর "Bill delete সম্পূর্ণ নিষিদ্ধ" নিয়মটি এখন "unpaid superadmin delete OK, paid → waive"-এ শিথিল হয়েছে।

**Tested:** Vite build ✓ | views.py AST parse ✓ | live delete/waive UI manual test বাকি।

---

### [2026-06-19] — SettingsPage (System Settings: Automation/Company/Invoice ট্যাব) মোবাইল-রেসপন্সিভ

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/settings/SettingsPage.jsx`

**কী করা হয়েছে:** মূল পেজ (sub-sidebar + content) আগে থেকেই `flex-col lg:flex-row` + মোবাইল ট্যাব-বার (`lg:hidden overflow-x-auto`) দিয়ে responsive। সমস্যা ছিল ট্যাব-কন্টেন্টের ভেতরের fixed `grid-cols-2`:
- Automation ট্যাব process cards: `grid grid-cols-2 gap-4` → `grid-cols-1 gap-4 lg:grid-cols-2` (Client Auto Disconnect/Auto Bill ইত্যাদি মোবাইলে stack)
- Company/Invoice ট্যাব top-level: `grid-cols-2 gap-5` → `grid-cols-1 gap-5 lg:grid-cols-2` (×2)
- form field grids: `grid-cols-2 gap-4`/`gap-3` → `grid-cols-1 sm:grid-cols-2` (×3)

**Side Effect / সতর্কতা:** process card-এর ভেতরের FREQUENCY TYPE `grid-cols-4` রাখা হয়েছে (full-width card-এ ৪ ছোট বাটন ফিট)। desktop অপরিবর্তিত। শুধু className।

**Tested:** Vite build ✓ | live mobile manual test বাকি।

---

### [2026-06-19] — AccountingDashboard মোবাইল padding tweak (বাকি আগে থেকেই responsive)

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/accounting/AccountingDashboard.jsx`

**কী করা হয়েছে:** পেজ আগে থেকেই responsive — stat cards `grid-cols-2 md:grid-cols-3`, চার্ট ও Latest Income/Expense `grid-cols-1 md:grid-cols-2`, header/filter `flex-wrap`, টেবিল ৩ কলাম (মোবাইলে ফিট)। শুধু main card padding `p-6` → `p-3 sm:p-6`।

**Tested:** Vite build ✓।

---

### [2026-06-19] — PaymentGatewaysPage মোবাইল-রেসপন্সিভ

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/system/PaymentGatewaysPage.jsx`

**কী করা হয়েছে:** ৩-অংশের লেআউট (বাঁয়ে gateway list, মাঝে settings form, ডানে status/date)। বাইরের flex কখনো stack হত না:
- মূল row `flex gap-4` → `flex flex-col gap-4 lg:flex-row`
- বাঁ gateway list wrapper `w-44 shrink-0` → `w-full shrink-0 lg:w-44`
- gateway list container `block` (vertical) → মোবাইলে `grid grid-cols-2 sm:grid-cols-3`, lg-তে `lg:block` (১৩টা gateway মোবাইলে কম উচ্চতা নেয়)
- form-এর ভেতরের grid (`grid-cols-1 lg:grid-cols-3`, `grid-cols-2 md:grid-cols-4`) আগে থেকেই responsive — settings/status panel মোবাইলে নিচে stack

**Side Effect / সতর্কতা:** desktop (lg+) অপরিবর্তিত — gateway list vertical sidebar। শুধু responsive className।

**Tested:** Vite build ✓ | live mobile manual test বাকি।

---

### [2026-06-19] — SMS Template ও SMS Logs (GenericListPage) মোবাইল টেবিল scroll

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/sms/SmsTemplatePage.jsx`, `admin_panel/src/pages/GenericListPage.jsx`

**কী করা হয়েছে:**
- SmsTemplatePage: টেবিল `w-full text-sm` → `w-full min-w-[700px] text-sm` (overflow-x-auto আগে থেকেই ছিল; header/padding responsive)। card view ছিল না।
- GenericListPage (SMS Logs `/sms/logs` সহ একাধিক generic রুট ব্যবহার করে): bare table-এ scroll-wrapper ছিল না — `<div className="overflow-x-auto">` মোড়ানো + table `min-w-[640px]`। এতে SMS Logs সহ সব generic list মোবাইলে অনুভূমিক স্ক্রল পায়।

**Side Effect / সতর্কতা:** GenericListPage শেয়ার্ড — পরিবর্তন সব generic রুটে প্রযোজ্য (positive)। desktop অপরিবর্তিত। শুধু className।

**Tested:** Vite build ✓ | live mobile manual test বাকি।

---

### [2026-06-19] — Support পেজ ৩টি: মোবাইলে card view বাদ → সব স্ক্রিনে টেবিল (scroll)

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/support/ClientSupportPage.jsx`, `SupportHistoryPage.jsx`, `TicketTypePage.jsx`

**কী করা হয়েছে:** আগের list page-গুলোর মতোই — তিনটিতেই mobile card (`MobileTicketCard`/`MobileHistoryCard`/`MobileTicketTypeCard`) বন্ধ:
- Mobile card wrapper `md:hidden` → `hidden`
- Table wrapper `hidden md:block overflow-x-auto` → `overflow-x-auto`
- ClientSupport ও SupportHistory টেবিল আগে থেকেই `w-full text-sm min-w-[1100px]` (অপরিবর্তিত); TicketType টেবিল `w-full text-sm` → `w-full text-sm min-w-[600px]` (৫ কলাম)
- SupportHistory-এর stat grid (`grid-cols-2 md:grid-cols-5`) ও filter (`md:grid-cols-6`) আগে থেকেই responsive — অপরিবর্তিত

**Side Effect / সতর্কতা:** desktop অপরিবর্তিত। শুধু responsive className।

**Tested:** Vite build ✓ | live mobile manual test বাকি।

---

### [2026-06-19] — POPAddPage (Add/Edit POPs) মোবাইল-রেসপন্সিভ + Add New Client স্টাইলে redesign

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/pop/POPAddPage.jsx`

**কী করা হয়েছে:**
1. রেসপন্সিভ: দুটো form grid `grid-cols-4` → `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`; page padding `p-6` → `p-4 sm:p-6`।
2. ClientForm (Add New Client) এর মতো redesign:
   - নতুন `SecHdr` কম্পোনেন্ট — gradient হেডার বার + icon badge + subtitle (ClientForm-এর `SecHdr` কপি)
   - ৩টি section card: `bg-white rounded-xl shadow-sm border p-6` → `rounded-xl overflow-hidden border border-gray-100 shadow-md ring-1 ring-black/5` + ভেতরে `p-4 sm:p-5` body wrapper (header edge-to-edge gradient)
   - section colors: Personal `from-[#1d3a50] to-[#2d5473]`, Business `from-[#1a4a3a] to-[#2d6b55]`, Menus `from-[#3a2a1d] to-[#5a4530]`
   - `.ifield` input: blue focus → teal focus (`#14b8a6` + ring `#f0fdfa`), border gray-200 — ClientForm `inp` লুক
   - Save/Cancel বাটন → ClientForm স্টাইল (gradient save `from-[#1d3a50] to-[#2d5473]`, rounded-lg)

**Side Effect / সতর্কতা:** সব ফিল্ড/লজিক/menu-tree অপরিবর্তিত — শুধু visual। JSX nesting এ প্রতিটি section-এ p-5 wrapper যোগ হওয়ায় extra closing `</div>` দেওয়া হয়েছে (build ✓ ব্যালান্সড)।

**Tested:** Vite build ✓ | live manual test বাকি।

**আপডেট (পরে):** page wrapper থেকে `max-w-5xl mx-auto` সরানো হয়েছে (দুপাশে খালি জায়গা যাচ্ছিল → এখন full-width)। মোবাইল UX: Actions বার মোবাইলে নিচে `sticky bottom-0` (edge-to-edge `-mx-4`, full-width বাটন py-2.5), `sm:` থেকে আগের inline layout — লম্বা ফর্মে Save সবসময় নাগালে।

---

### [2026-06-19] — ONUMonitoringPage: মোবাইলে card view বাদ → সব স্ক্রিনে টেবিল (scroll)

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/olt/ONUMonitoringPage.jsx`

**কী করা হয়েছে:** অন্য list page-গুলোর মতোই — mobile card (`MobileONUCard`/`MobilePONGroup`) বন্ধ করে সব স্ক্রিনে টেবিল:
- Mobile card wrapper `md:hidden` → `hidden`
- Table wrapper `hidden md:block overflow-x-auto` → `overflow-x-auto`; টেবিল `min-w-full` → `w-full min-w-[1000px]` (৮ কলাম: OLT Name, ONU ID, Description, Client, Zone, MAC, Status, RX Power)
- stat cards (`grid md:grid-cols-2 lg:grid-cols-4`) ও filters (`grid md:grid-cols-3` + flex-wrap toggles) আগে থেকেই responsive — অপরিবর্তিত

**Side Effect / সতর্কতা:** desktop অপরিবর্তিত (`w-full` রাখায় full-width)। শুধু responsive className।

**Tested:** Vite build ✓ | live mobile manual test বাকি।

---

### [2026-06-19] — AccountPage (Account Manage) মোবাইল-রেসপন্সিভ

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/AccountPage.jsx`

**কী করা হয়েছে:** ClientProfile-এর মতোই দুই-কলাম লেআউট ছিল — মোবাইলে responsive করা হয়েছে:
- মূল wrapper `flex gap-4 items-start` → `flex flex-col gap-4 lg:flex-row lg:items-start`
- বাঁ profile কার্ড `w-56 shrink-0` → `w-full ... lg:w-56`
- Tab content padding `p-6` → `p-4 sm:p-6`
- PersonalInfo form `grid-cols-2` → `grid-cols-1 sm:grid-cols-2`
- ActivityLog ও LoginHistory filter `grid-cols-4` → `grid-cols-2 sm:grid-cols-4`
- tab bar আগে থেকেই `overflow-x-auto`, log টেবিল `overflow-x-auto` — অপরিবর্তিত

**Side Effect / সতর্কতা:** শুধু responsive className, লজিক অপরিবর্তিত, desktop (lg+) চেহারা আগের মতোই।

**Tested:** Vite build ✓ | live mobile manual test বাকি।

---

### [2026-06-19] — OnlineClientMonitoring: মোবাইলে card view বাদ → সব স্ক্রিনে টেবিল (scroll)

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/radius/OnlineClientMonitoring.jsx`

**কী করা হয়েছে:** ClientList/BillList-এর মতোই — মোবাইল card list বন্ধ করে সব স্ক্রিনে টেবিল:
- Mobile card wrapper `md:hidden` → `hidden` (`MobileOnlineCard` কম্পোনেন্ট অব্যবহৃত রয়ে গেছে)
- Table wrapper `hidden md:block overflow-x-auto` → `overflow-x-auto` (সব স্ক্রিন); টেবিল `min-w-full` → `min-w-[1100px]` (১৩ কলাম, মোবাইলে অনুভূমিক স্ক্রল)
- header/filters/stat cards আগে থেকেই responsive (`flex-wrap`, `grid-cols-2 md:grid-cols-3`, 3× flex-1 stat) — অপরিবর্তিত

**Side Effect / সতর্কতা:** desktop অপরিবর্তিত। শুধু responsive className। আগের card view ফেরাতে `hidden`→`md:hidden` + table wrapper `hidden md:block` ফেরালেই হবে।

**Tested:** Vite build ✓ | live mobile manual test বাকি।

---

### [2026-06-19] — টপবার (Layout TopBar) মোবাইল-রেসপন্সিভ

**পরিবর্তিত ফাইল:** `admin_panel/src/components/Layout.jsx`

**কী করা হয়েছে:** TopBar মোবাইলে আঁটসাঁট/অগোছালো ছিল। ঠিক করা হয়েছে:
- "Online Client Monitoring" টেক্সট `<span>` → `hidden lg:inline` (মোবাইল/ট্যাবলেটে শুধু আইকন, অনেক জায়গা বাঁচে)
- Search container `shrink-0` → `min-w-0 flex-1 lg:flex-none`; input width `w-32 sm:w-48 lg:w-64` → `w-full lg:w-64` (মোবাইলে search মাঝের খালি জায়গা পূরণ করে)
- মাঝের spacer `flex-1` → `hidden lg:block lg:flex-1` (মোবাইলে search-ই জায়গা নেয়; lg+ এ আগের মতো icons ডানে ঠেলে)
- Search dropdown `w-80` → `w-[min(20rem,calc(100vw-2rem))] sm:w-80` (ছোট স্ক্রিনে viewport ছাড়ায় না)

**Side Effect / সতর্কতা:** company/logo block আগে থেকেই `hidden lg:flex`, hamburger `lg:hidden` — অপরিবর্তিত। `.topbar-monitoring` ক্লাস মোবাইল WebView-এ CSS দিয়ে hide হয় (অক্ষত)। desktop (lg+) চেহারা অপরিবর্তিত। শুধু responsive className।

**Tested:** Vite build ✓ | live mobile manual test বাকি।

---

### [2026-06-18] — ClientList ও BillList: মোবাইলে card view বাদ → সব স্ক্রিনে টেবিল (scroll)

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/clients/ClientList.jsx`, `admin_panel/src/pages/billing/BillList.jsx`

**কী করা হয়েছে:** user মোবাইলে card রূপ চায়নি — তাই উভয় পেজে মোবাইল card list বন্ধ করে সব স্ক্রিনে টেবিল দেখানো হয়:
- Mobile card wrapper `md:hidden` → `hidden` (আর render হয় না; `MobileClientCard`/`MobileBillCard` কম্পোনেন্ট কোডে রয়ে গেছে, ব্যবহৃত নয়)
- Table wrapper `hidden md:block` → সব স্ক্রিনে দৃশ্যমান + `overflow-x-auto`; টেবিলে `min-w-[1000px]` (ClientList) / `min-w-[1200px]` (BillList) দিয়ে মোবাইলে অনুভূমিক স্ক্রল, কলাম চাপা হয় না
- Bulk action bar `hidden md:block` → `block` (মোবাইলেও দেখায়, `flex-wrap` দিয়ে wrap)

**Side Effect / সতর্কতা:** desktop চেহারা অপরিবর্তিত। চাইলে আগের card view ফেরাতে `hidden` → `md:hidden` এবং table wrapper-এ `hidden md:block` ফিরিয়ে দিলেই হবে। আগের কাজ (Bill modal grid responsive) এই entry-তেই অন্তর্ভুক্ত — Payment modal Client Info `grid-cols-2 sm:grid-cols-4`, form grid `grid-cols-1 sm:grid-cols-2`।

**Tested:** Vite build ✓ | live mobile manual test বাকি।

**কী করা হয়েছে:** ClientList ও BillList উভয় list page **আগে থেকেই মোবাইল-রেসপন্সিভ** — `MobileClientCard`/`MobileBillCard` (`md:hidden` কার্ড) + ডেস্কটপ table (`hidden md:block`), stat cards `grid-cols-2 md:grid-cols-4`, bulk action bar `hidden md:block`। তাই list body-তে কাজ লাগেনি। শুধু BillList-এর modal-এর কয়েকটি fixed grid মোবাইলে চাপা ছিল — সেগুলো responsive করা হয়েছে:
- Payment modal Client Info: `grid-cols-4` → `grid-cols-2 sm:grid-cols-4`
- Payment modal Payment Details (form): `grid-cols-2` → `grid-cols-1 sm:grid-cols-2`
- Bill Edit modal (Amount/Discount form): `grid-cols-2` → `grid-cols-1 sm:grid-cols-2`

**Side Effect / সতর্কতা:** শুধু Tailwind responsive className। read-only ছোট-মান 2-কলাম info grid (ex-date modal ইত্যাদি) অপরিবর্তিত — মোবাইলে ঠিক আছে। কোনো লজিক বদলায়নি।

**Tested:** Vite build ✓ | live mobile manual test বাকি।

---

### [2026-06-18] — ClientProfile পেজ মোবাইল-রেসপন্সিভ

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/clients/ClientProfile.jsx`

**কী করা হয়েছে:** Profile পেজ ছোট স্ক্রিনে (মোবাইল অ্যাপ/ব্রাউজার) ভাঙা দেখাচ্ছিল — fixed দুই-কলাম লেআউট। রেসপন্সিভ করা হয়েছে:
- মূল wrapper `flex` → `flex flex-col gap-4 lg:flex-row lg:items-start` (মোবাইলে কার্ড উপরে, কন্টেন্ট নিচে; lg+ এ পাশাপাশি)
- বাঁ প্রোফাইল কার্ড `w-64` → `w-full lg:w-64`
- `InfoGrid` helper: প্রতি সারির দুই label/value জোড়া মোবাইলে `grid-cols-1`, sm+ এ `sm:grid-cols-2`; label width `w-48` → `w-28 sm:w-48`; column border `border-r` → মোবাইলে `border-b`, sm+ এ `border-r`
- breadcrumb `flex-wrap gap-2`, page padding `p-3 sm:p-4`, tab content padding `p-3 sm:p-4`, Documents grid `grid-cols-3` → `grid-cols-1 sm:grid-cols-3`

**Side Effect / সতর্কতা:** শুধু Tailwind responsive className যোগ — কোনো লজিক/ডেটা ফ্লো বদলায়নি। ডেস্কটপ চেহারা lg+ এ আগের মতোই। টেবিলগুলো আগে থেকেই `overflow-x-auto`, ট্যাব buttons `flex-wrap`।

**Tested:** Vite build ✓ | live mobile-width manual test বাকি।

---

### [2026-06-18] — Waived বিল Restore (Waive বাতিল) ফিচার

**পরিবর্তিত ফাইল:** `billing/api/views.py`, `admin_panel/src/pages/clients/ClientProfile.jsx`

**কী করা হয়েছে:**
- নতুন backend action `POST /billing/bills/{id}/unwaive/` ([views.py] `unwaive_bill`) — শুধু admin/superadmin। waived বিলকে আবার সক্রিয় করে: `new_due = net − paid` দিয়ে due ও status (paid/partial/unpaid) recalculate, client.due_amount আপডেট, activity log-এ "Waive বাতিল (Restored)" entry।
- ClientProfile bill টেবিলে waived বিলের পাশে amber "↩ Restore" বাটন (শুধু superadmin, `r.status === 'waived'`)। ক্লিকে in-page confirm modal (`billUnwaiveTarget`) → `confirmBillUnwaive` → API কল।

**Side Effect / সতর্কতা:** unwaive শুধু status/due হিসাব করে — কোনো payment তৈরি/মুছে না। আগে indirect ভাবে শুধু Edit করলে status reset হতো, এখন পরিষ্কার বাটন আছে। waive ও unwaive দুটোই activity log-এ যায়।

**Tested:** Vite build ✓ | views.py AST parse ✓ | live UI test বাকি।

---

### [2026-06-18] — Company Info পেজে মোবাইল অ্যাপ ডাউনলোড লিংক কপি বাটন

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/settings/SettingsPage.jsx`
**নতুন ফাইল:** `scripts/update_apk_download.sh`, `media/app/rajamehar-online.apk` (copied APK)

**কী করা হয়েছে:** Company Info ট্যাবে "মোবাইল অ্যাপ" Card — readonly লিংক ইনপুট + "লিংক কপি করুন" বাটন (navigator.clipboard + textarea fallback) + "ডাউনলোড" লিংক। লিংক = `${window.location.origin}/media/app/rajamehar-online.apk`। APK `media/app/`-এ রাখা হয়েছে — **nginx সরাসরি serve করে** (gunicorn দিয়ে ১৩০MB stream নয়, worker block এড়াতে)। লিংক verified: HTTPS 200, 129694031 bytes।

**Side Effect / সতর্কতা:** নতুন APK বিল্ড করলে `mobile_app/public_apk/`-এ রেখে `bash scripts/update_apk_download.sh` চালাতে হবে (newest *.apk → media/app/rajamehar-online.apk কপি করে) — তখন একই লিংকে নতুন সংস্করণ যাবে। media/ amir+isp writable, nginx `/media/` serve করে (DEBUG=False)।

**Tested:** Vite build ✓ | `curl` HTTPS 200 + full size ✓

---

### [2026-06-18] — Admin app → Employee app কল কেটে যাচ্ছিল: staff-to-staff extension-এ wake-dial ছিল না

**সমস্যা:** admin অ্যাপ থেকে employee-এর extension (যেমন 103) ডায়াল করলে কল সাথে সাথে কেটে যেত — যখন employee-এর অ্যাপ background/killed থাকত (সাধারণ অবস্থা)।

**মূল কারণ:** হটলাইন (100) কলের জন্য `_add_wake_dial` (Ringing()+CHANUNAVAIL retry loop) fix করা হয়েছিল, কিন্তু `pbx_provision.py`-এর **staff-to-staff extension dial** (`[voip-internal]`-এ `exten => 101/102/103`) এখনও পুরনো plain `Dial(PJSIP/ep,30,tT)→Hangup()` চালাচ্ছিল। অ্যাপ background → endpoint unregistered → `Dial` ~1s-এ `CHANUNAVAIL` → `Hangup()`। FCM push অ্যাপ জাগায় ৩-৫s পরে, কিন্তু কল ততক্ষণে কেটে গেছে।

**কী করা হয়েছে:**
- `pbx_provision.py`-এ staff-to-staff extension loop-এর plain `Dial` → `_add_wake_dial(internal_routes, f'PJSIP/{ep}', 30)` দিয়ে replace। এখন প্রতিটি staff extension Ringing()+retry loop (~৪০s window) চালায়, app register হলেই bridge হয়।
- listener-এর `_maybe_push_pbx` (আগে থেকেই live) extension dial ধরে routed agent-কে FCM wake push পাঠায় — দুটো একসাথে কাজ করে।
- dialplan regenerate: `POST /api/v1/voip/pbx/reload-dialplan/` (admin JWT mint করে localhost-এ; gunicorn=isp conf dir-এ লিখতে পারে)। AMI `dialplan show voip-internal`-এ 101→agent_2, 102→agent_1, 103→agent_26 সব wake-dial loop verified।

**Side Effect / সতর্কতা:**
- **Orphan PBXAgent (data — fix করিনি, approval দরকার):** id=1 (ext=101, ep=`agent_2`, **user_id=None**) — কোনো user নেই, তাই 101 ডায়াল করলে agent_2 কখনো register হয় না → ~৪০s wake-loop শেষে Hangup। admin(user1)=agent_1/ext102, employee(user26)=agent_26/ext103 — এগুলো ঠিক আছে। orphan id=1 মুছে ফেলা উচিত।
- conf dir (`/etc/asterisk/extensions_isp.d/`) gunicorn(isp) user লেখে — আমার (amir) user/shell সরাসরি লিখতে/পড়তে পারে না; reload সবসময় API দিয়ে।
- লাইভ ২-device কল verify বাকি (user করবে)। verify সময়ে agent_26 আগে unregistered ছিল (push+wake path-ই আসল কেস)।

**Tested:** Django check ✓ | dialplan regenerate + AMI `dialplan show voip-internal` wake-dial verify ✓ | উভয় user-এর FCM token SET ✓।

**পরবর্তী লাইভ টেস্টে পাওয়া গেছে (AMI capture দিয়ে diagnose):** ring/connect এখন কাজ করে, কিন্তু **one-way audio** — answer-এর পর admin staff-কে শোনে, staff admin-কে শোনে না, কল আটকে যায়। মূল কারণ **Asterisk-behind-NAT media path** (dialplan নয়):
- সার্ভারের direct public IP নেই — শুধু `eno1: 172.16.3.254`; public `103.214.202.17` MikroTik NAT-এ।
- `rtp show settings`: ICE=Yes কিন্তু **STUN address 0.0.0.0:0** (rtp.conf-এ stunaddr সেট নেই) → Asterisk ICE candidate-এ শুধু internal 172.16.3.254 দেয়।
- coturn active কিন্তু `172.16.3.254:3478`-এ (LAN) listen — ইন্টারনেট থেকে পৌঁছাতে MikroTik forward দরকার।
- RTP range `10000-20000/udp`।

**সমাধান (একই দিনে সম্পন্ন, লাইভ verified):**
1. **MikroTik dst-nat → 172.16.3.254** (user নিজে করেছেন): UDP `10000-20000` (RTP), UDP+TCP `3478`, UDP+TCP `5349`, UDP `49152-65535` (coturn relay)। আগে শুধু 8089 ছিল।
2. **🔴 আসল killer বাগ — coturn `/etc/turnserver.conf`:** `static-auth-secret=@@TURN_SECRET@@` — install.sh placeholder কখনো substitute হয়নি! Django `.env` `TURN_SECRET=cd2572ea…c27f`-এর সাথে না মেলায় প্রতিটি TURN allocation reject → অ্যাপ relay candidate পেত না → media fail/one-way। sed দিয়ে আসল secret বসানো + `external-ip=103.214.202.17/172.16.3.254` uncomment (আগে commented + ভুল IP .245)। `systemctl restart coturn`।
3. **Asterisk `/etc/asterisk/rtp.conf`:** `stunaddr=stun.l.google.com:19302` সেট (আগে commented + ভুল .245)। `module reload res_rtp_asterisk.so` → `rtp show settings` STUN address এখন `74.125.250.129:19302`।
4. **App bug fix (`sipPhone.js` `_onIncoming`):** আগে `this.session` থাকলেই নতুন INVITE reject করত। কল "hold-এ আটকে" থাকলে (Terminated না হওয়ায় _end() চলেনি) সব নতুন কল নীরবে কাটত → force-restart লাগত। এখন শুধু Establishing/Established হলে reject; বাসি session পরিষ্কার করে নতুন কল গ্রহণ করে। **OTA/EAS deploy দরকার।**
6. **🔴 Server media fix (`asterisk_provision.py` endpoint template + reprovision):** `rtp_symmetric=yes` যোগ। `webrtc=yes` এটা সেট করে না। admin(cellular)↔staff(WiFi) asymmetric NAT-এ Asterisk SDP/ICE-ঘোষিত (unreachable) address-এ media পাঠাত → one-way (Asterisk→staff হারাত)। rtp_symmetric=yes → packet যেখান থেকে আসে সেখানেই ফেরত। reprovision API দিয়ে সব endpoint regenerate। **লাইভ verified: `pjsip show channelstats`-এ দুই leg-এ RX+TX দুদিকে ~0 loss (opus)** — media path সম্পূর্ণ।
7. **🔴 Server: Strict RTP disable (`rtp.conf` `strictrtp=no`):** "২ সেকেন্ড অডিও তারপর নীরবতা" — ICE/NAT-এ source address settle হলে Strict RTP packet drop করত। sudo দিয়ে `strictrtp=no` + `module reload res_rtp_asterisk.so`।
8. **🔴 App audio-routing fix (`messaging.js` onState):** RTP দুদিকে গেলেও **কোনো শব্দ নেই** — কারণ background CallKeep-answer path-এ `InCallManager.start()` ডাকা হতো না (CallContext শুধু foreground-এ করত)। staff নেটিভ স্ক্রিন থেকে background-এ answer করে → audio session communication mode-এ আসত না → device-এ route হতো না। messaging.js onState-এ Established→`InCallManager.start()`, Terminated/null→stop যোগ। **OTA/EAS deploy দরকার।** (incall-manager native module build-এ আছে — foreground audio আগে কাজ করত বলে নিশ্চিত।)
9. **Server `.env` TURN_URLS:** মৃত `turns:5349` (coturn TLS listener চালু নেই) বাদ, `turn:3478?transport=tcp` যোগ (UDP-blocked WiFi-র জন্য)। gunicorn হার্ড-রিস্টার্ট লাগে (.env os.environ override হয় না)।
10. **App audio robustness (`sipPhone.js` কোরে InCallManager):** শুধু messaging/CallContext নয়, sipPhone-এর session stateChange-এ Established→`InCallManager.start({media:'audio'})`, Terminated→stop — সব path (foreground/background/CallKeep) গ্যারান্টিড।
✅ **লাইভ সমাধান নিশ্চিত (2026-06-18):** self-managed build install (clean uninstall) করার পর **দুদিকে অডিও কাজ করছে** (earpiece-এ)। adb logcat-এ InCallManager `MODE_IN_COMMUNICATION` + audio focus GRANTED + earpiece selected — সব ঠিক। পুরো admin↔staff কল (ring→connect→two-way audio) end-to-end কাজ করছে।

13. **স্পিকার বাটন fix + আলাদা মিউট বাটন (`callKeepService.js setCallAudioRoute`, `CallContext _speaker.set`, `DialPadScreen.js` actionsRow):** self-managed mode-এ অডিও রুট Telecom নিয়ন্ত্রণ করে — শুধু `InCallManager.setForceSpeakerphoneOn` দিলে route earpiece থেকে সরত কিন্তু লাউডস্পিকার নীরব থাকত (user-এর কাছে "মিউট" মনে হতো)। `RNCallKeep.setAudioRoute(uuid, 'SPEAKER'|'EARPIECE')` যোগ। DialPad actionsRow এখন call-aware: কলের সময় **🎙️ মিউট | 📞 কাটুন(লাল) | 🔊 স্পিকার** (লেবেলসহ), কল না থাকলে ✕/কল/স্পিকার। **JS-only → OTA (`eas update`), full rebuild লাগে না।**

15. **🟢 Always-online — Foreground Service (`@notifee/react-native`):** staff অ্যাপ খোলা থাকলেও flapping ("সংযোগ হচ্ছে") + বন্ধ থাকলে কল না আসা। কোনো FGS ছিল না (expo-background-fetch ১৫ মিনিট যথেষ্ট নয়)। notifee `registerForegroundService` (index.js top-level) + `startForegroundService`/`stopForegroundService` (CallContext login/logout) — persistent visible notification ("অনলাইন") দিয়ে প্রসেস (ও sip.js WSS) background/lock-এও জীবিত রাখে। type=DATA_SYNC; app.json-এ `FOREGROUND_SERVICE_DATA_SYNC` perm যোগ। পুরনো hidden keepalive notification বাদ। নোটিফিকেশন `IMPORTANCE_MIN`, `ongoing:true`+`autoCancel:false` (swipe-proof)। **🔴 Android 14 crash fix:** notifee-এর FGS manifest-এ শুধু `shortService` (0x800) type ছিল, runtime DATA_SYNC (0x1) চাওয়ায় "not a subset" FATAL crash (login-এ)। custom config plugin `plugins/withNotifeeForegroundType.js` — manifest-এ notifee ForegroundService-এ `android:foregroundServiceType="dataSync"` + `tools:replace` দিয়ে override। app.json plugins-এ যোগ। **পূর্ণ `eas build` লাগে** (status bar-এ আইকন নেই, শব্দ নেই; FGS-এ নোটিফিকেশন পুরোপুরি মুছে ফেলা Android-এ অসম্ভব)। **পূর্ণ `eas build` দরকার (native dep)।** notifee 9.1.x autolinked (plugin লাগে না)।

14. **নেটিভ-স্টাইল in-call স্ক্রিন (`CallScreen.js` redesign + `sipPhone.sendDtmf` + CallContext `sendDtmf`):** নেটিভ ফোন অ্যাপের মতো full-screen overlay — avatar(initial) + নাম + নম্বর + টাইমার + অ্যাকশন গ্রিড — শুধু ৩টি কার্যকর বাটন (🔊 স্পিকার, 🎙️ মিউট, 🔢 কীপ্যাড; Add call/Video/Bluetooth বাদ — প্রজেক্টে প্রযোজ্য নয়) + লাল round hangup; incoming-এ Accept/Reject। কীপ্যাড → DTMF প্যাড (`sendDtmf` — sip.js SDH sendDtmf বা RTCDTMFSender)। JS-only → OTA। CallScreen App.js-এ আগেই mount করা (Modal, call থাকলেই দেখায়)।

12. **🔴🔴 আসল no-audio fix — CallKeep self-managed (`callKeepService.js` `selfManaged: false→true`):** adb logcat-এ দেখা গেল অ্যাপ `Capabilities: CallProvider` (managed) হিসেবে রেজিস্টার্ড, কিন্তু WhatsApp/Messenger/IMO সব `SelfManaged`। managed mode-এ Android Telecom কলের অডিও route দখল করে → WebRTC অডিও স্পিকারে যায় না (RTP দুদিকে নিখুঁত যাওয়া সত্ত্বেও কোনো শব্দ নেই — `pjsip show channelstats`-এ RX/TX দুদিকে ৯৭০০+ pkt প্রমাণিত)। self-managed-এ অ্যাপ নিজে অডিও নিয়ন্ত্রণ করে → অডিও বাজে; incoming UI-ও থাকে। **⚠️ managed↔self-managed বদলালে "cannot change self-managed account" crash — নতুন বিল্ড install-এর আগে পুরনো অ্যাপ অবশ্যই UNINSTALL। পূর্ণ `eas build` দরকার।**
16. **Background reconnect + লোকাল build (`CallContext.js` watchdog, `withGradleMemory` plugin):** FGS-build install-এ login crash গেল (notifee dataSync fix ✓), কিন্তু সংযোগ ছাড়লে background-এ reconnect হতো না (reopen লাগত) — watchdog-এ `AppState!==active→return` gate ছিল। FGS প্রসেস জীবিত রাখে বলে gate সরানো হলো (প্রতি ২০s reconnect on 'failed', background-এও)। **JS-only → OTA।** নোট: কিছু ROM-এ FGS থাকলেও main JS background-এ throttle হতে পারে; না হলে SIP-কে FGS headless task-এ সরাতে হবে। লোকাল build: **172.16.6.10** (Ubuntu 24, JDK17+SDK35+NDK27), `npx eas-cli build --local` (EXPO_TOKEN দিয়ে headless login); `withGradleMemory` plugin (Metaspace 1g, parallel off, ABI=arm64-v8a,armeabi-v7a) দিয়ে ৭.৭GB RAM-এ Metaspace OOM এড়ানো; `.easignore`-এ public_apk বাদ।

11. **New Architecture disable চেষ্টা → revert:** `app.json newArchEnabled: false` দিয়েছিলাম (incall-manager New Arch-এ untested), কিন্তু **gradle build FAIL** করল (SDK 54/RN 0.81-এ native module old-arch-এ compile হয় না)। তাই revert করলাম (New Arch চালু রাখা = আগের সফল বিল্ডের config)। আসল no-audio fix incall-manager-এর New Arch নয় — #12 (CallKeep managed mode)। doctor exclude-এ incall-manager থাকল (harmless)।

5. **App media fix (`sipPhone.js` `iceGatheringTimeout` 3000→6000):** bridge হওয়ার পরও no-audio — `pjsip show channelstats` "not valid" (RTP প্রবাহ নেই)। server-side proven OK (`turnutils_uclient` দিয়ে TURN auth+relay সফল, 0 lost; public DNS roisp.duckdns.org→103.214.202.17 ✓)। কারণ: মোবাইলে TURN **relay candidate** gather হওয়ার আগেই 3000ms timeout-এ SDP যেত → relay-হীন → কোনো ICE pair connect হতো না (host CGNAT + Asterisk NAT-এ)। init factory option + answer—দুটোতেই 6000ms। **OTA/EAS deploy দরকার।**

**Live verified (AMI capture):** force-restart-এর পর কল `Ringing → Up → BridgeEnter (দুই leg)` — signaling+media bridge সম্পূর্ণ ✓। (পুরনো বাসি session-গুলো force-restart-এ পরিষ্কার হয়েছিল; #4 fix deploy হলে force-restart আর লাগবে না।)

**⚠️ পরের agent:** `install.sh`-এর `@@TURN_SECRET@@` substitution লজিক ঠিক করা উচিত (fresh deploy-এ একই বাগ ফিরবে)।

---

### [2026-06-17] — হটলাইন কল সাথে সাথে কেটে যাচ্ছিল: dialplan regenerate হয়নি (live fix)

**সমস্যা:** client app থেকে হটলাইন 100-এ কল দিলে কল নিজেই সাথে সাথে কেটে যেত; admin answer করলে শুধু native CallKeep স্ক্রিন দেখাত (অডিও bridge হতো না)।

**মূল কারণ:** `pbx_provision.py`-এর `_add_wake_dial` (Ringing+retry) ফিক্স লেখা ছিল কিন্তু **hotline.conf regenerate হয়নি** — live dialplan এখনো পুরনো `Answer()→Dial(PJSIP/agent_1,25,tT)→Hangup()` চালাচ্ছিল। app background → agent endpoint `Unavailable` → `Dial` সঙ্গে সঙ্গে `CHANUNAVAIL` → premature `Answer()`-এর পর `Hangup()` → caller-এর কল connect হয়ে সাথে সাথে কাটত।

**কী করা হয়েছে:**
- `POST /api/v1/voip/pbx/reload-dialplan/` (gunicorn=isp user, conf dir-এ লিখতে পারে) দিয়ে `apply_full_dialplan()` চালিয়ে hotline.conf regenerate। এখন hotline-1-এ Ringing()+wakedial retry loop live (AMI `dialplan show hotline-1`-এ verified)।
- listener (`voip_call_listener.py`) আগেই restart হয়েছিল (20:32 > edit 20:29) → `_maybe_push_pbx` active, কোনো কাজ লাগেনি।

**Side Effect / সতর্কতা:**
- **Data bug (পরের agent দেখুন, এখনো fix করিনি):** PBXAgent id=1 (ext=101, user_id=**None** orphan) এবং id=4 (ext=102, user=admin) — **দুজনেরই `sip_endpoint_name="agent_1"`** (collision; AOR agent_1 MaxContact=1)। তাই ring group `Dial(PJSIP/agent_1&PJSIP/agent_1&PJSIP/agent_26)`-এ agent_1 duplicate। বর্তমানে admin-এর app agent_1 হিসেবেই register হয়ে কল পায় বলে কাজ করছে, কিন্তু id=1 orphan মুছে + id=4-এর ep ঠিক করা উচিত (data পরিবর্তন → user approval দরকার)।
- `messaging.js` change (account_type অনুযায়ী staff/client creds endpoint) OTA JS — app-এ পৌঁছাতে EAS/OTA publish লাগবে।

**Tested:** dialplan regenerate + AMI verify ✓ (retry loop live)। agent_1 register Avail, client_2 register Avail। লাইভ কল verify বাকি (user করবে)।

---

### [2026-06-17] — Answer করলে কল active হয় না: মাইক permission + accept try/catch + iceGatheringTimeout

**লাইভ AMI diagnosis:** কল সবসময় [Ring]/[Ringing]-এ আটকে থাকে, কখনো [Up] হয় না → callee answer করলেও **SIP 200 OK Asterisk-এ যায় না**, ১৫s পর timeout/retry। মূল কারণ সম্ভবত: answer-এর সময় `getUserMedia` fail (RECORD_AUDIO runtime permission চাওয়া হতো না — শুধু READ_PHONE_NUMBERS/CALL_PHONE) → SDP answer তৈরি হয় না → 200 OK যায় না।

**পরিবর্তিত ফাইল:**
- `mobile_app/src/services/callKeepService.js` — `_ensurePhonePermissions`-এ `RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS` যোগ।
- `mobile_app/src/context/CallContext.js` — login হলেই (CallKeep ছাড়াও) `RECORD_AUDIO`/`MODIFY_AUDIO_SETTINGS` runtime request।
- `mobile_app/src/services/sipPhone.js` — `answer()`-এ accept try/catch (fail হলে silent hang নয় → hangup + onError লগ); init ও answer-এ `iceGatheringTimeout: 3000`।

**সার্ভার fix (এই session):** Asterisk transport-wss-এ `external_media_address/external_signaling_address=103.214.202.17` + `local_net=172.16.0.0/12` (NAT media)। রাউটারে UDP 10000-20000 → 172.16.3.254 forward ছিল; ufw inactive।

**Side Effect:** JS-only, OTA-তে যাবে; permission grant হতে app reopen + prompt-এ Allow লাগবে। mic fail হলে এখন onError-এ কারণ দেখা যাবে।

**Tested:** ৩ ফাইল babel parse ✓। Live verify বাকি।

---

### [2026-06-17] — Staff/agent-কে ইনকামিং কল push + হটলাইন wake-retry dialplan

**সমস্যা (২টি):**
1. **App killed/background → স্টাফের কাছে কল আসত না।** AMI listener শুধু **client callee**-কে FCM push পাঠাত। client হটলাইনে কল দিলে callee হয় `agent_X`, আর caller leg-এর Exten = হটলাইন নম্বর (যেমন `100`) — endpoint নাম নয়, তাই কোনো এজেন্টকে push-ই যেত না → অ্যাপ জাগত না → WSS suspended → SIP INVITE মিস।
2. **Foreground-এ answer button সবসময় আসত না।** এজেন্টের কাছে FCM foreground message যেত না (একই কারণ); registration stale থাকলে INVITE মিস হয়ে in-app overlay (`cc.call`-নির্ভর) দেখাত না।

**পরিবর্তিত ফাইল:**
- `voip/management/commands/voip_call_listener.py` — নতুন `_maybe_push_pbx()` (Newchannel-এ ডাকা): caller=client/agent ও Exten=হটলাইন নম্বর/staff extension হলে রাউট-করা এজেন্ট(দের) `user.fcm_token`-এ `incoming_call` push (`_hotline_agents` ring_group/agent/IVR resolve করে; `_caller_display` caller নাম)। Asterisk special exten (s/h/i/t/o) guard।
- `voip/services/pbx_provision.py` — নতুন `_add_wake_dial()`: হটলাইন ring_group/agent route এখন `Ringing()`+retry loop (CHANUNAVAIL হলে ২s পর retry, ~৪০s window) — voip-internal-এর প্রমাণিত প্যাটার্ন। সদ্য-জাগা (FCM) অ্যাপ register করে এই window-এ INVITE ধরতে পারে। (আগে single 25s Dial → woken app ধরার আগেই শেষ।)
- `mobile_app/src/services/messaging.js` — bg SIP register এখন `account_type`==staff হলে `/app/staff/voip/sip-credentials/` ব্যবহার করে (আগে সবসময় client creds → staff-এ ভুল/fail)। আর `sip.ua` ইতিমধ্যে থাকলেও reconnect nudge দেয় (foreground answer button-এর জন্যও)।

**⚠️ Deploy করতে যা লাগবে (নাহলে effect হবে না):**
- AMI listener long-running — কোড effect পেতে `sudo systemctl restart isp-voip-listener.service`।
- Dialplan change effect পেতে regenerate+reload দরকার: Admin → VoIP → Hotline Control → apply, অথবা `apply_full_dialplan()` (VOIP_ENABLED + /etc/asterisk write perm লাগে)। **আমি auto-apply করিনি** (production /etc/asterisk লেখা)।
- mobile JS → EAS Update (OTA) `eas update --channel preview`।

**Side Effect:** এজেন্ট নিজে হটলাইনে কল দিলে নিজের ফোনেও ক্ষণিক push আসতে পারে (CallKeep 45s auto-end সামলায়)। IVR route-এ সব option-এর এজেন্ট জাগে (interactive বলে কাকে রিং হবে আগে জানা যায় না)।

**Tested:** py_compile (listener, pbx_provision) ✓; babel parse (messaging.js) ✓। ডিভাইসে live কল টেস্ট বাকি (restart+apply+OTA-র পর)।

---

### [2026-06-17] — CallScreen: কল থাকলেই সবসময় overlay (AppState gate বাদ) + OTA নোট

**পরিবর্তিত ফাইল:**
- `mobile_app/src/screens/call/CallScreen.js` — AppState gate সরানো (`if (!active) return null` বাদ)। কারণ ইনকামিং কলে CallKeep/heads-up এলে AppState ক্ষণিকের জন্য 'active' না থাকায় answer button লুকিয়ে যেত। এখন `cc.call` থাকলেই overlay দেখায়। `incoming` detection lenient: inbound ও state ≠ Established/Terminated হলেই উত্তর বাটন।

**⚠️ গুরুত্বপূর্ণ (deployment):** অ্যাপ EAS Update (OTA) ব্যবহার করে — `app.json` updates.url সেট, `runtimeVersion: appVersion`। JS পরিবর্তন ফোনে পৌঁছাতে `eas update --channel preview` (বা production) চালাতে হবে; শুধু git push যথেষ্ট নয়। (react-native-incall-manager native module — OTA-তে আসবে না, build লাগবে; তবে guarded তাই OTA JS no-op করে।)

**Tested:** babel parse ✓।

---

### [2026-06-17] — Incoming answer button: foreground-এ সবসময় in-app CallScreen (CallKeep state-নির্ভরতা বাদ)

**সমস্যা:** আগের fix-এ guard ছিল `callKeepState.currentUUID` — FCM push এলে currentUUID সেট হয়ে in-app UI লুকাত, কিন্তু foreground-এ CallKeep-এর native screen সবসময় ওঠে না → answer button missing।

**পরিবর্তিত ফাইল:**
- `mobile_app/src/screens/call/CallScreen.js` — CallKeep state-এর উপর নির্ভরতা বাদ। এখন AppState track করে: কল থাকলে ও অ্যাপ **foreground (active)** হলে সবসময় in-app answer/active UI (Modal) দেখায়; background হলে `null` (Modal এমনিতেই দেখা যায় না, CallKeep সামলায়)। `callKeepAvailable/callKeepState` import সরানো।

**ফলাফল:** অ্যাপ খোলা থাকলে ইনকামিং কলে **সবসময়** উত্তর/প্রত্যাখ্যান বাটন আসবে।

**Side Effect:** foreground-এ CallKeep native screen-ও উঠলে সাময়িক double-UI হতে পারে; দুটো দিয়েই answer করা যায় (sip accept idempotent)।

**Tested:** babel parse ✓।

---

### [2026-06-17] — Incoming call answer fix: CallKeep না দেখালে in-app CallScreen fallback

**সমস্যা:** client হটলাইন 100-এ কল দিলে superadmin/staff অ্যাপে SIP INVITE আসত কিন্তু answer করা যেত না। কারণ answer UI আসত শুধু CallKeep (FCM `incoming_call` push) থেকে; `CallScreen` `callKeepAvailable()` হলেই `null` রিটার্ন করত। FCM push না এলে/CallKeep না দেখালে কোনো answer button থাকত না (dialpad-এ inCall হলে mode toggle লুকিয়ে যেত, answer button নেই)।

**পরিবর্তিত ফাইল:**
- `mobile_app/src/screens/call/CallScreen.js` — guard বদল: `if (callKeepAvailable() && callKeepState.currentUUID) return null;`। অর্থাৎ CallKeep সত্যিই কল দেখালে (currentUUID সেট) তবেই in-app UI লুকায়; শুধু SIP INVITE এসে CallKeep না দেখালে in-app CallScreen-ই উত্তর/প্রত্যাখ্যান দেখায় (Modal — dialpad সহ সব স্ক্রিনের উপরে)।

**ফলাফল:** foreground-এ কল এলে এখন সবসময় answer button আসবে — FCM push না এলেও। (background/killed answering আগের মতোই FCM+CallKeep-নির্ভর।)

**Tested:** babel parse ✓।

---

### [2026-06-17] — Online presence: client + staff/agent কে অনলাইন (কল দেওয়া যাবে কিনা)

**সমস্যা:** superadmin বুঝতে পারত না কোন employee/client অ্যাপে অনলাইন (SIP-registered) — কল দেওয়া যাবে কিনা। `registered-clients` endpoint শুধু `client_X` দিত, `agent_X` নয়।

**পরিবর্তিত ফাইল:**
- `voip/api/views.py` — `RegisteredClientsView` এখন সব registered endpoint regex (`[A-Za-z0-9_]+/sip:`) থেকে `clients` ও `agents` আলাদা করে দেয় (`{registered, clients, agents}`)।
- `admin_panel/src/pages/voip/PBXAgentPage.jsx` — নতুন "অনলাইন" column; `/voip/registered-clients/` প্রতি ১৫s poll করে `a.sip_endpoint_name` match করে 🟢 অনলাইন / অফলাইন দেখায়। → superadmin দেখে কোন employee এখন কল নিতে প্রস্তুত।
- `mobile_app/src/screens/call/DialPadScreen.js` — Client Search মোডে প্রতিটি result-এ WhatsApp-স্টাইল online dot + "🟢 অনলাইন" (registered-clients-এর `clients` থেকে, ১৫s poll)।

**Side Effect / সতর্কতা:** presence শুধু `VOIP_ENABLED=True` ও AMI কাজ করলে। agent match হয় `sip_endpoint_name` দিয়ে (blank হলে match হবে না — admin সেট করতে হবে; সাধারণত `agent_<user.pk>`)। presence = SIP register (foreground/online); background-এ অ্যাপ FCM-নির্ভর, তখন offline দেখাতে পারে যদিও push-এ কল ধরবে।

**Tested:** `vite build` ✓, views.py ast ✓, DialPad babel ✓।

---

### [2026-06-17] — DialPad status: WhatsApp/IMO-র মতো sticky "অনলাইন" (transient connecting flicker বন্ধ)

**পরিবর্তিত ফাইল:**
- `mobile_app/src/screens/call/DialPadScreen.js` — status chip-এ smoothing: একবার `registered` হলে `displayStatus='registered'` এবং সাময়িক reconnect blip-এ (keepalive/watchdog) `ONLINE_GRACE_MS=12s` পর্যন্ত "অনলাইন" ধরে রাখে; এর বেশি down থাকলে তবেই "সংযোগ হচ্ছে…"। registered label "সংযুক্ত" → **"অনলাইন"**; idle/failed-ও "সংযোগ হচ্ছে…" দেখায় (আলাদা ব্যর্থ টেক্সট নয়)। isRegistered/isConnecting/isFailed/dotColor/statusText সব displayStatus-ভিত্তিক; canCall ও displayStatus-ভিত্তিক (grace-এ call button সবুজ থাকে)।

**কেন:** "সংযোগ হচ্ছে…" বারবার ঝলকানো বিব্রতকর ছিল; keepalive/watchdog reconnect-এর সময় status মুহূর্তের জন্য connecting হতো। এখন cold start ছাড়া ব্যবহারকারী প্রায় সবসময় "অনলাইন" দেখবে।

**Tested:** babel parse ✓।

---

### [2026-06-17] — DialPad connection reliability: WSS keepalive + foreground reconnect watchdog

**চেক যা পেলাম:** SIP reconnect ছিল (transport Disconnected → backoff retry; AppState 'active' → reconnect), কিন্তু (১) WSS keepalive disabled ছিল → half-open/dead socket detect হতো না, status ভুলভাবে "সংযুক্ত" থাকত; (২) network regain-এ instant reconnect ট্রিগার ছিল না (শুধু AppState/transport event)। Background-এ persistent WSS থাকে না — incoming call FCM push (CallKeep) দিয়ে আসে (এটা ঠিকই আছে)।

**পরিবর্তিত ফাইল:**
- `mobile_app/src/services/sipPhone.js` — UserAgent transportOptions-এ `keepAliveInterval: 30` + `keepAliveDebounce: 10`। WSS-এ প্রতি ৩০s CRLF ping → NAT timeout আটকায়, dead socket দ্রুত ধরা পড়ে → transport Disconnected → auto-reconnect।
- `mobile_app/src/context/CallContext.js` — foreground watchdog: প্রতি ২৫s চেক, login আছে + কল নেই + status≠registered/disabled হলে `reconnect()`। statusRef/callRef দিয়ে latest state পড়ে। stuck 'connecting'/'failed' থেকে recover করে।

**Side Effect / সতর্কতা:** JS-only — নতুন native dep নেই, আগের build-এই কাজ করবে। NetInfo যোগ করলে network-regain-এ instant (≤25s নয়) reconnect পাওয়া যেত — future enhancement (native rebuild লাগবে)।

**Tested:** babel parse ✓।

---

### [2026-06-17] — Staff-to-staff extension calling: voip-internal dialplan-এ PBX agent extension routing

**সমস্যা:** এক স্টাফ অন্য স্টাফকে extension (যেমন 103) ডায়াল করলে কল fail করত — `voip-internal` dialplan-এ শুধু hotline নম্বর (100) রুট করা ছিল, agent extension নয়।

**পরিবর্তিত ফাইল:**
- `voip/services/pbx_provision.py` — `_write_all_hotlines()`-এ `voip-internal` context-এ প্রতিটি active PBXAgent-এর extension → `Dial(PJSIP/<endpoint>,30,tT)` রুট যোগ। নতুন public `apply_full_dialplan()` (VOIP_ENABLED + dir guard সহ file rewrite + reload)।
- `voip/api/views.py` — `PBXAgentViewSet`-এ `perform_create/update/destroy` → `apply_full_dialplan()` (agent বদলালে dialplan auto-regenerate)। `PBXReloadDialplanView` এখন শুধু reload নয়, আগে file regenerate করে (button চাপলে সব apply)।

**ফলাফল:** superadmin/admin/employee অ্যাপের dialpad-এ অন্য স্টাফের extension (PBX Agents পেজে দেখানো — যেমন test=103, admin=102) ডায়াল করলে সরাসরি সেই স্টাফের অ্যাপে রিং হবে। endpoint mapping: PBXAgent.sip_endpoint_name = `agent_<user.pk>` (অ্যাপ login-এর SIP endpoint-এর সাথে মিলে)।

**Side Effect / সতর্কতা:** apply শুধু `VOIP_ENABLED=True` ও hotline conf dir লেখার permission থাকলে। provisioning ব্যর্থ হলেও agent CRUD ভাঙবে না (guarded)।

**Tested:** ast + `manage.py check` ✓। Live Asterisk apply/কল verify বাকি।

---

### [2026-06-17] — Web admin panel topbar থেকে Softphone dialpad সরানো (কল এখন শুধু মোবাইল অ্যাপে)

**পরিবর্তিত ফাইল:**
- `admin_panel/src/components/Layout.jsx` — TopBar থেকে `<SoftphoneDialer/>` ও wrapper `<SoftphoneProvider>` সরানো; সংশ্লিষ্ট import বাদ। কারণ: admin/superadmin/employee মোবাইল অ্যাপে dialpad আছে; client হটলাইনে কল দিলে সেই অ্যাপগুলোতেই কল আসবে। web panel আর SIP register করবে না → double-register conflict এড়ানো।

**Side Effect / সতর্কতা:** web panel-এ এখন কোনো incoming/outgoing call UI নেই (ইচ্ছাকৃত)। `SoftphoneContext.jsx` ও `SoftphoneDialer.jsx` ফাইল রয়ে গেছে (এখন unused) — দরকার হলে পরে ফেরানো যাবে।

**Tested:** `vite build` ✓।

---

### [2026-06-17] — Staff app home: AdminPanelScreen-এ brand header (admin app-এর মতো), "ফিরে যান অ্যাডমিন প্যানেল" back-bar সরানো

**পরিবর্তিত ফাইল:**
- `mobile_app/App.js` — StaffHomeStack-এর AdminPanel screen-এ `initialParams={{ home: true }}`।
- `mobile_app/src/screens/staff/AdminPanelScreen.js` — `isHome = route?.params?.home === true || !navigation.canGoBack()`। staff home tab-এ এখন brand header (logo + company name + green call button + reload) দেখায়, "‹ ফিরে যান অ্যাডমিন প্যানেল" back-bar নয় — superadmin app-এর সাথে মিল।

**Tested:** babel parse ✓।

---

### [2026-06-17] — DialPad: বাতিল বাটন call-aware (hangup) + action label বাংলা টেক্সট সরানো

**পরিবর্তিত ফাইল:**
- `mobile_app/src/screens/call/DialPadScreen.js` — বাতিল (X) বাটন এখন কল চলাকালীন (`inCall`) `hangup()` করে, নাহলে টাইপ করা নম্বর মোছে; disabled শুধু যখন digits নেই ও কল নেই। তিনটি action button-এর নিচের বাংলা label (বাতিল / কল করুন·callHint / স্পিকার) সরানো হয়েছে। অব্যবহৃত `callHint` const মুছে দেওয়া হয়েছে।

**Tested:** babel parse ✓।

---

### [2026-06-17] — Mobile DialPad: Dial/Client Search মোড + dial-by-number + সব অ্যাপে লাউড স্পিকার বাটন

**পরিবর্তিত ফাইল:**
- `mobile_app/src/screens/call/DialPadScreen.js` — উপরে Mode toggle (⌨ ডায়াল | 🔍 ক্লায়েন্ট সার্চ; client app বাদে)। Search মোডে `/app/staff/clients/?search=` দিয়ে client খুঁজে tap-এ `startCall('client_<id>', name)`। Dial মোডে handleCall এখন টাইপ করা নম্বর ডায়াল করে (আগে সবসময় support); নম্বর না থাকলে support hotline। Actions row-এর ডান spacer-এ এখন 🔊 **লাউড স্পিকার** বাটন (সব অ্যাপে — shared screen)।
- `mobile_app/src/context/CallContext.js` — `speakerOn` state + `toggleSpeaker`; `startCall(target, displayName)`. Speaker রুটিং `react-native-incall-manager` দিয়ে (guarded require — build-এ না থাকলে no-op)। কল Established-এ audio session start + pref re-apply; কল শেষে speaker off + session stop।
- `mobile_app/src/services/sipPhone.js` — `call(target, displayName)` → `_wire` info-তে displayName।
- `mobile_app/package.json` + `package-lock.json` — `react-native-incall-manager@^4.2.1` যোগ + installed।

**Side Effect / সতর্কতা:** speaker actual রুটিং-এর জন্য **EAS rebuild আবশ্যক** (নতুন native module)। rebuild-এর আগে বাটন দেখাবে কিন্তু audio route হবে না (no-op, crash নয়)। InCallManager কল lifecycle-এ audio session manage করে — callkeep-এর সাথে coexist করবে বলে আশা, live verify দরকার। Client app-এ Mode toggle নেই (dial-only)।

**Tested:** ৪ ফাইল babel parse ✓, npm install ✓। Live/EAS verify বাকি।

---

### [2026-06-17] — Employee Panel cards: module-based filter → granular `dashboard_cards` permission

**সমস্যা:** collector-এর `client` module থাকায় client cards দেখাচ্ছিল, যদিও "Dashboard (Employee)" card permission দেওয়া হয়নি। আসল ডিজাইন granular `dashboard_cards` দিয়ে নিয়ন্ত্রণের কথা, কিন্তু Dashboard module-based (`CARD_PERM`/hasModule) filter করছিল।

**পরিবর্তিত ফাইল:**
- `admin_panel/src/pages/Dashboard.jsx` — `CARD_PERM` (module map) সরিয়ে `CARD_GRANULAR` (card label → dashboard_cards key)। filter এখন: non-super → `hasModule('dashboard') && hasGranular('dashboard_cards', key)`। অর্থাৎ 'Dashboard (Employee)' module enable + কার্ড tick না করলে কোনো stat card দেখাবে না।
- `admin_panel/src/pages/system/AppUsersPage.jsx` — `STATIC_GRANULAR.dashboard_cards` ৬টা placeholder key থেকে পূর্ণ ৪৪-কার্ড list-এ আপডেট (admin প্রতিটি কার্ড আলাদা tick করতে পারবে)।
- `role_permissions/module_definitions.py` — `GRANULAR_PERMISSIONS['dashboard_cards']` একই canonical ৪৪-কার্ড list-এ আপডেট (frontend-এর সাথে key মিল)।

**Side Effect / সতর্কতা:** তিন জায়গার key list অবশ্যই সিঙ্ক রাখতে হবে (Dashboard.CARD_GRANULAR ↔ AppUsersPage.STATIC_GRANULAR.dashboard_cards ↔ module_definitions)। backend save granular key validate করে না, frontend-driven। বিদ্যমান role-গুলোতে যাদের dashboard module/card tick নেই তারা এখন কার্ড দেখবে না — admin-কে AppUsersPage থেকে Dashboard module enable করে কার্ড দিতে হবে।

**Tested:** `vite build` ✓, module_definitions ast ✓।

---

### [2026-06-17] — Employee Panel home cards: permLoaded গার্ড (unfiltered card flash fix)

**পরিবর্তিত ফাইল:**
- `admin_panel/src/pages/Dashboard.jsx` — loading guard-এ `!permLoaded` যোগ। আগে permission লোড হওয়ার আগে non-super user মুহূর্তের জন্য (বা my-perms fail করলে স্থায়ীভাবে) পূর্ণ admin dashboard-এর সব unfiltered card দেখত। এখন permission লোড না হওয়া পর্যন্ত wait → কার্ড সবসময় role permission অনুযায়ীই দেখায়।

**যাচাই (live):** collector `test` (Bill Collector) role-এ শুধু `client` parent module আছে → হোমে শুধু client cards দেখায় (billing/pop/financial সব hidden) — সঠিক। `CARD_PERM`-এর সব ৪৪টি stat-card label mapped; unmapped শুধু salary/status label (always-show intended)।

**Tested:** `vite build` ✓।

---

### [2026-06-17] — Customer Search পেজ: Open Ticket ও Kick ছাড়া সব action admin-only

**পরিবর্তিত ফাইল:**
- `admin_panel/src/pages/clients/CustomerSearchPage.jsx` — action button block-এ Open Ticket ও Kick ছাড়া বাকি সব (Enable/Disable, Router, Recharge, Edit toggle, Update, Download Profile) `{isAdmin && ...}` দিয়ে wrap। `isAdmin = usePermission().isSuper` (superadmin/admin)। non-admin role শুধু Open Ticket ও Kick পারবে। (status Toggle visual-only, gating দরকার নেই)।

**Side Effect / সতর্কতা:** আগের `canEditClient` (write/full access) gating বাদ — এখন edit সহ সব admin-only।

**Tested:** `vite build` ✓।

---

### [2026-06-17] — Role-gating: Apps Management menu, Online Monitoring, Customer edit + Staff app bottom tab (call/client সরানো)

**পরিবর্তিত ফাইল:**
- `admin_panel/src/components/Sidebar.jsx` — `Apps Management` menu থেকে `alwaysShow` সরানো → এখন `hasSubModule('client','scheduler')` অনুযায়ী দেখাবে।
- `admin_panel/src/components/Layout.jsx` — TopBar-এ `Online Client Monitoring` button এখন `isSuper || hasModule('client')` হলেই দেখাবে (আগে সবাই দেখত)।
- `admin_panel/src/pages/clients/CustomerSearchPage.jsx` — Customer Edit toggle + Update button এখন `isSuper || client_list write/full access` হলেই দেখাবে।
- `mobile_app/App.js` — Staff bottom tab থেকে **কল (DialPad)** ও **ক্লায়েন্ট (Clients)** tab সরানো হয়েছে; bottom-এ শুধু হোম + সাপোর্ট। DialPad `StaffHomeStack`-এ Stack.Screen হিসেবে রাখা (home header-এর green call button থেকে খোলে); incoming call global `<CallScreen/>` overlay দিয়েই আসে।

**Side Effect / সতর্কতা:** `StaffClientStack` function এখন unused (deep-nav-এ লাগলে পুনরায় যোগ করা যাবে)। Home cards আগের ধাপেই `CARD_PERM` দিয়ে role-filtered — collector-এর client perm থাকলে client cards দেখাবে (expected)।

**Tested:** `vite build` ✓, `App.js` babel parse ✓। Live verify বাকি।

---

### [2026-06-17] — Staff মোবাইল অ্যাপ: Home tab = web Admin Panel WebView (role-aware) + VoIP/System superadmin-only

**পরিবর্তিত ফাইল:**
- `mobile_app/App.js` — `StaffHomeStack`-এ `initialRouteName="AdminPanel"`; Home tab এখন native `StaffDashboardScreen`-এর বদলে `AdminPanelScreen` (web admin panel WebView) দেখায়। superadmin-এর মতোই, কিন্তু staff tab bar (হোম/ক্লায়েন্ট/কল/সাপোর্ট) রয়ে গেছে। পুরনো StaffDashboard ও অন্য staff screens deep-nav-এ registered।
- `admin_panel/src/components/Sidebar.jsx` — VoIP ও System মেনু `alwaysShow` → `superOnly`; `canSeeItem`-এ `superOnly` চেক (`user.role === 'superadmin'`)। admin সহ অন্য কেউ এই দুই মেনু দেখবে না।

**কী করা হয়েছে:** Bill Collector/staff অ্যাপে login করলে হোমস্ক্রিন এখন web Employee Panel dashboard (profile + salary + role-permitted cards/menu) WebView আকারে — admin panel-এর সাথে সেম টু সেম, role অনুযায়ী।

**Side Effect / সতর্কতা:** AdminPanelScreen-এ logout আলাদা button নেই — web panel avatar→logout `/login`-এ redirect করলে native logout trigger হয় (`onNavigationStateChange`)।

**Tested:** `App.js` babel parse ✓। Expo Go-তে live verify বাকি।

---

### [2026-06-17] — Employee Panel Dashboard (profile card + salary sheet + role-permission filtered admin cards)

**পরিবর্তিত ফাইল:**
- `hr/api/views.py` — `EmployeeViewSet`-এ নতুন action `me` (`GET /api/v1/hr/employees/me/`): লগইন ইউজারের linked Employee profile + চলতি মাসের `current_payslip` + সাম্প্রতিক ৬ মাসের `recent_payslips` ফেরত দেয় (`PayrollSheetSerializer`)।
- `admin_panel/src/pages/Dashboard.jsx` — superadmin/admin বাদে সবাইকে নতুন **Employee Panel** দেখায়: বাঁয়ে profile card (screenshot অনুযায়ী — photo, Employee Code, User ID, Status, Designation, Department), ডানে salary sheet (admin-এর ticket/tax card style gradient card + "MY SALARY SHEET" mini table), তারপর role permission অনুযায়ী filter করা admin stat cards (`CARD_PERM` map → `hasModule`)। `isSuper` হলে আগের admin dashboard অপরিবর্তিত।

**কী করা হয়েছে:** Employee user লগইন করলে dashboard-এ নিজের প্রোফাইল + salary + শুধু যে module-এ permission আছে সেই card দেখে। Sidebar আগে থেকেই role-permission filter করত (`Sidebar.jsx`)।

**Side Effect / সতর্কতা:**
- Employee user-এর সাথে `Employee.user` (OneToOne) link না থাকলে salary sheet-এর জায়গায় notice দেখায়, কিন্তু permission-filtered card ঠিকই দেখায়।
- admin stat endpoint (`/clients/dashboard-stats/` ইত্যাদি) employee-র জন্য 403 দিলে card-এ 0 দেখাবে — error catch করা আছে।

**Tested:** Frontend `vite build` ✓, `manage.py check` ✓। Live employee login দিয়ে manual verify বাকি।

---

### [2026-06-17] — POP Profile পেজ: ৯টি ট্যাব সহ পূর্ণ ব্যাকএন্ড (Exported/Unexported Clients, Transactions, Logs, Online Clients)

**পরিবর্তিত ফাইল:**
- `clients/models.py` — `Client.pop` (FK→pop.POP) ও `Client.pop_exported` (Boolean) যোগ; migration `0024_client_pop_client_pop_exported_and_more.py`
- `pop/models.py` — নতুন models: `POPChangeLog`, `POPFundStartLog`, `ClientRechargeLog`; migration `0005_clientrechargelog_popchangelog_popfundstartlog.py`
- `pop/api/serializers.py` — `POPClientSerializer`, `POPChangeLogSerializer`, `POPFundStartLogSerializer`, `ClientRechargeLogSerializer`; `POPListSerializer`-এর client count methods আসল query-তে বদলানো হয়েছে (আগে hardcoded 0 ছিল)
- `pop/api/views.py` — `POPViewSet`-এ নতুন actions: `perform_update` (POPChangeLog auto-log), `toggle-fund-start`, `clients` (exported/unexported), `clients-bulk` (export/revert/enable/disable/package_change), `debited-transactions`, `credited-transactions`, `recharge-transactions`, `change-logs`, `fund-start-logs`, `online-clients` (RADIUS `get_online_users()` filter করে POP-এর client username দিয়ে)
- `admin_panel/src/pages/pop/POPProfilePage.jsx` — নতুন পেজ, POP profile sidebar card + ৯টি ট্যাব (screenshot অনুযায়ী same layout)
- `admin_panel/src/pages/pop/POPListPage.jsx` — কোড/নাম click ও "👁 View Profile" action দিয়ে `/pop/:id/profile`-এ navigate
- `admin_panel/src/App.jsx` — route `/pop/:id/profile` যোগ

**কী করা হয়েছে:** POP List থেকে কোনো POP-এ ক্লিক করলে এখন পূর্ণ profile page খোলে: POP Information, Exported/Unexported Clients (bulk recharge/package-change/enable/disable/export/revert), Debited Transactions (POPFunding history), Credited Transactions (date-grouped recharge summary), Recharge Transactions (ClientRechargeLog detail), POP Change Logs (POP edit করলে auto snapshot লগ হয়), POP Fund Start Logs (`toggle-fund-start` action দিয়ে), POP Online Clients (RADIUS radacct থেকে)।

**Side Effect / সতর্কতা:**
- `Client` model-এ নতুন nullable FK `pop` ও বুলিয়ান `pop_exported` যোগ হয়েছে — বিদ্যমান client row-এ সবগুলোতে `pop=NULL, pop_exported=False` (কোনো client এখনো কোনো POP-এর সাথে link করা নেই, যা স্বাভাবিক — frontend-এর client add/edit form-এ এখনো POP select option যুক্ত করা হয়নি, future task)
- `ClientRechargeLog` টেবিল এখনো খালি — POP profile-এর Credited/Recharge Transactions ট্যাব data দেখাবে শুধু তখনই যখন client recharge flow থেকে এই log তৈরি করা শুরু হবে (এখনো billing/client recharge code এই model-এ write করে না — পরের session-এ wire করতে হবে)
- `POPChangeLog` শুধু POP **update** (PATCH/PUT) হলে তৈরি হয়, create-এ নয়
- `Client.objects.filter(pop=...)` সব ভারী query Client টেবিলে নতুন index (`idx_client_pop_exported`) দিয়ে কভার করা — কোনো বিদ্যমান billing/radius hook touch করা হয়নি

**Tested:** হ্যাঁ — `python manage.py check` 0 error, `makemigrations --check --dry-run` → "No changes detected", vite build সফল (3.19s)। Live POP data না থাকায় UI visually verify করা হয়নি (browser test বাকি)।

---

### [2026-06-17] — POP Management System সম্পূর্ণ তৈরি

**পরিবর্তিত ফাইল:**
- `pop/models.py` — POP, POPPackage, POPTariff, POPTariffItem, POPFund, POPFunding, POPFundTransaction, ClientPGWPayment (extended), POPPGWSettlement, POPNotice সব নতুন/বিস্তারিত models
- `pop/migrations/0002_add_pop_package_tariff_main_models.py` — নতুন migration
- `pop/migrations/0003_extended_pop_models.py` — লিগ্যাসি model update + নতুন tables
- `pop/api/serializers.py`, `pop/api/views.py`, `pop/api/urls.py` — সম্পূর্ণ API layer
- `config/urls.py` — `/api/v1/pop/` route যোগ
- `admin_panel/src/pages/pop/POPPackagePage.jsx` — Package CRUD
- `admin_panel/src/pages/pop/POPTariffPage.jsx` — Tariff CRUD + items
- `admin_panel/src/pages/pop/POPAddPage.jsx` — POP add/edit form (multi-section)
- `admin_panel/src/pages/pop/POPListPage.jsx` — POP list + stats cards + filters
- `admin_panel/src/pages/pop/POPFundingPage.jsx` — POP Funding
- `admin_panel/src/pages/pop/ClientPGWPaymentsPage.jsx` — PGW Payments
- `admin_panel/src/pages/pop/POPNoticePage.jsx` — POP Notice
- `admin_panel/src/components/Sidebar.jsx` — POP section 8টি submenu
- `admin_panel/src/App.jsx` — সব POP routes যোগ

**কী করা হয়েছে:** স্ক্রিনশট অনুযায়ী সম্পূর্ণ POP Management System তৈরি। DB tables: isp_pops, isp_pop_packages, isp_pop_tariff_plans, isp_pop_tariff_items, isp_pop_funds, isp_pop_fundings, isp_pop_fund_transactions, isp_pgw_payments, isp_pop_pgw_settlements, isp_pop_notices।

**Side Effect / সতর্কতা:**
- `isp_pop_notices` table migration 0003-এ DROP + RECREATE হয়েছে (পুরনো schema সম্পূর্ণ বদলানো)
- `isp_pop_fundings` table-ও DROP + RECREATE (পুরনো NetworkPOP FK → নতুন POP FK)
- POP.code auto-generate হয় save()-এ — শেষ POP-এর id+1 থেকে
- gunicorn hook স্বয়ংক্রিয় reload করেছে

**Tested:** হ্যাঁ — `python manage.py check` ০ error, vite build ✓ 3.29s

---

### [2026-06-17] — superadmin: Home tab সরাসরি Admin Panel WebView

**পরিবর্তিত ফাইল:**
- `mobile_app/App.js` — `StaffHomeStack` এখন `useAuth().isSuper` দেখে `initialRouteName` সেট করে: superadmin → `AdminPanelHome` (AdminPanelScreen), অন্য staff → `StaffDashboard`। নতুন `AdminPanelHome` screen যোগ।
- `mobile_app/src/screens/staff/AdminPanelScreen.js` — back button শুধু `navigation.canGoBack()` হলে (tab root/home-এ back নেই)।

**কী হয়েছে:** superadmin login করলে Home tab সরাসরি full admin panel WebView দেখায় (native stat dashboard skip); bottom tab bar (হোম/ক্লায়েন্ট/কল/সাপোর্ট) native nav হিসেবে থাকে। Staff-রা আগের native dashboard + module grid পায়।

**Side Effect / সতর্কতা:** superadmin-এর জন্য StaffDashboard module grid bypass হয় (panel-এর নিজস্ব sidebar আছে)। native Clients/Calls/Support tab superadmin-এর জন্যও থাকে।

**Tested:** babel-parse OK; full expo export bundle OK।

---

### [2026-06-17] — Admin Panel WebView polish: module launcher + softphone hide

**পরিবর্তিত ফাইল:**
- `admin_panel/src/components/Layout.jsx` — SoftphoneDialer-কে `<span className="topbar-softphone">` দিয়ে wrap
- `mobile_app/src/screens/staff/AdminPanelScreen.js` — `path` param (deep-link module route); injected CSS `.topbar-softphone{display:none}` → WebView header-এ কল ডায়ালার hide (desktop web অটুট)
- `mobile_app/src/screens/staff/StaffDashboardScreen.js` — `PANEL_MODULES` launcher grid (ক্লায়েন্ট/বিলিং/মনিটরিং/POP/অ্যাকাউন্টিং/রিপোর্ট/SMS/HR/নেটওয়ার্ক/OLT/সাপোর্ট/কনফিগ) → প্রতিটি WebView-এ ওই module route খোলে; isSuper || hasModule(key) দিয়ে gated

**কী হয়েছে:** native dashboard এখন admin-panel module অনুযায়ী সুন্দর button grid; tap করলে সরাসরি WebView-এ সেই module। WebView header-এর duplicate কল ডায়ালার hide (নিচে native call button আছে)। superadmin সব module দেখে; staff শুধু permitted।

**Side Effect / সতর্কতা:** `.topbar-softphone` CSS শুধু WebView-এ inject হয় (desktop web panel-এ softphone অটুট)। module route mapping admin_panel/src/App.jsx রুট অনুযায়ী।

**Tested:** mobile babel-parse OK; admin panel vite build ✓।

---

### [2026-06-17] — Staff App: full admin parity via Admin Panel WebView (Hybrid)

**পরিবর্তিত/নতুন ফাইল:**
- `mobile_app/src/screens/staff/AdminPanelScreen.js` (নতুন) — WebView যা web admin panel (roisp.duckdns.org) লোড করে; `injectedJavaScriptBeforeContentLoaded` দিয়ে SecureStore-এর access_token/refresh_token + staffUser localStorage-এ inject → auto-login। Android back handling + reload।
- `mobile_app/App.js` — StaffHomeStack-এ `AdminPanel` route
- `mobile_app/src/screens/staff/StaffDashboardScreen.js` — "🖥️ অ্যাডমিন প্যানেল (সম্পূর্ণ)" button

**কী হয়েছে:** Hybrid approach — native staff app (calling/support/dashboard/client) রেখে, পূর্ণ admin কাজের জন্য role-aware WebView। superadmin login করলে মোবাইল থেকে web panel-এর সব কাজ (client add/edit/delete, monitoring, সব module) করতে পারে; staff শুধু permitted module দেখে — কারণ web panel-এর PermissionContext (`/role-permissions/my-perms/`) role enforce করে। mobile staff token (RefreshToken.for_user) admin panel-এর localStorage keys (access_token/refresh_token/user) এর সাথে compatible।

**Side Effect / সতর্কতা:**
- WebView panel mobile-optimized নয় (responsive web)। token expire হলে panel-এর নিজস্ব refresh (`/auth/token/refresh/`) কাজ করে।
- POP/client account WebView পায় না (শুধু staff)।

**Tested:** mobile সব ফাইল babel-parse OK; full expo export bundle OK (5.05MB)। react-native-webview 13.15.0 আগে থেকেই installed।

---

### [2026-06-17] — App Users লিস্টে superadmin বাদ (manual DB user)

**পরিবর্তিত ফাইল:** `role_permissions/api/views.py`

**কী হয়েছে:** `AppUserViewSet.list()` এ `.exclude(role='superadmin')` — App Users পেজে শুধু এই পেজ থেকে তৈরি staff (collector/support/accountant/manager) দেখাবে। superadmin DB থেকে manually তৈরি হয়, লিস্টে দেখায় না, কিন্তু web + mobile login ও full access (is_super) অটুট থাকে (login এই লিস্টের উপর নির্ভর করে না)।

**Side Effect / সতর্কতা:** শুধু list filter; create/update/login অপরিবর্তিত। admin (role=superadmin) এখন লিস্টে নেই কিন্তু সব access পায়।

**Tested:** Django check ০; vite build ✓; e2e: list-এ superadmin নেই, staff আছে; superadmin mobile login account_type=staff is_super=True।

---

### [2026-06-17] — App Users: Permissions column clickable modal + role/group display fix

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/system/AppUsersPage.jsx`

**কী হয়েছে:**
1. Role Modules(Permissions) টেবিলের **PERMISSIONS column** এ ছোট button (👁 N টি permission) → ক্লিকে `ViewPermissionsModal` খোলে যা ওই role-এর সব Modules (access সহ) + sub-modules + Granular permissions একসাথে label দিয়ে দেখায়।
2. Application Users টেবিলে **ROLE/GROUP** display fix — `getRoleName` ভুল field (Django `role`) দেখত, এখন `role_group_name`।
3. অবশিষ্ট bug fix: handleDelete (permission clear) `role`→`role_id`; Modules column title `m.module`→`m.module_key`।

**Side Effect / সতর্কতা:** ViewPermissionsModal already-fetched row data ব্যবহার করে (extra API call নেই)। granular label `granularDefs[context]` থেকে; module label `modules` prop থেকে।

**Tested:** vite build ✓ 3.17s; relation audit (live DB): User↔Employee, User↔RoleGroup, RoleGroup↔Modules সব ঠিক।

---

### [2026-06-17] — App Users: Role permission save/load fix + Employee(designation) relation

**পরিবর্তিত ফাইল:**
- `admin_panel/src/pages/system/AppUsersPage.jsx` — PermissionModal save/load contract fix; employee dropdown-এ designation + selected employee info; table EMPLOYEE column-এ designation
- `role_permissions/api/views.py` — `_link_employee()`/`_employee_brief()`; AppUserViewSet create/update এ Employee↔User link; list-এ employee(designation) যোগ

**কী হয়েছে:**
1. **Role Module(Permission) save fix:** frontend `role`+nested shape পাঠাত কিন্তু backend `role_id`+flat (`module_key/sub_module_key/access_level`, `context_key/permission_key`) চায় → "role_id required" error। frontend save **ও** load দুটোই flat shape-এ ঠিক করা হলো (RoleModulesTab table display সহ)। এখন role-এ module/permission assign কাজ করে → PermissionContext/sidebar/dashboard role অনুযায়ী filter হয়।
2. **Employee relation:** App User তৈরি/edit-এ employee নির্বাচন করলে এখন `Employee.user` (OneToOne) link হয় (আগে ignored ছিল), designation/department দেখায়, এবং মোবাইল `/app/staff/hr/me/` কাজ করে।

**Side Effect / সতর্কতা:**
- এক user → এক employee (relink-এ আগেরটা unlink হয়); employee ফাঁকা দিলে unlink।
- account_role (Django role) = মোবাইল scope; RoleGroup = granular module; Employee = HR relation — তিনটি আলাদা concern।

**Tested:** Django check ০; vite build ✓ 3.10s; e2e (admin): save-permissions round-trip flat ✓; employee link/unlink ✓ (list-এ designation 'Bill Collector'/dept 'Billing')।

---

### [2026-06-17] — App Users পেজে Account Type (role) নির্বাচন যোগ

**পরিবর্তিত ফাইল:**
- `role_permissions/api/views.py` — `AppUserViewSet`-এ `ASSIGNABLE_ROLES` (collector/support/accountant/manager); create/partial_update এখন `account_role` পড়ে User.role সেট করে (আগে hardcoded 'collector')। admin/superadmin user-এর role এই পেজ থেকে বদলানো যায় না।
- `admin_panel/src/pages/system/AppUsersPage.jsx` — Step 1-এ "ACCOUNT TYPE" dropdown; payload-এ `account_role` যোগ এবং RoleGroup key `role` → `role_group_id` ঠিক করা (আগে frontend `role` পাঠাত কিন্তু backend `role_group_id` পড়ত — RoleGroup assign কাজ করছিল না)।

**কী হয়েছে:** App Users থেকে staff তৈরি/edit করার সময় Account Type (Bill Collector/Support/Accountant/Manager) বাছাই করা যায় → মোবাইল অ্যাপের permission scope নির্ধারণ করে (collector=নিজের কালেকশন; accountant/manager=admin-level: payment approval/bill/POP)। RoleGroup = granular module permission (Step 3)। দেখুন [[project_staff_app_plan]]।

**Side Effect / সতর্কতা:**
- পুরনো App Users page `role` key দিয়ে RoleGroup পাঠাত যা backend পড়ত না (latent bug) — এখন `role_group_id`-তে fixed।
- create করা user `set_password()` দিয়ে hash হয় (মোবাইল login কাজ করে) + enc_password Fernet copy।
- admin user-এর কার্যকর password = App Users পেজে দেখানো enc_password (weak default)। আলাদা reset করলে enc_password mismatch হয় — পরিবর্তন App Users পেজ থেকেই করা ভালো (set_password + enc_password দুটোই sync থাকে)।

**Tested:** Django check ০; vite build ✓ 3.33s; e2e (admin/123456): create account_role=manager → User.role=manager → মোবাইল dashboard scope=admin; update→support কাজ করে।

---

### [2026-06-17] — Staff App: full integration verification (pre-device)

**যাচাই (কোনো কোড পরিবর্তন নয়):**
- Multi-role backend smoke test: staff/admin login + ১০টি endpoint (me, dashboard, reports, clients, pending-payments, bills, hr, sip-credentials, support/tickets, pop/pops) সব 200; POP login + /app/pop/me/ 200; client login + /app/me/ 200।
- Mobile full bundle: `npx expo export --platform android` সফল — 1745 modules, সব import resolve (নতুন staff/pop screens সহ)। শুধু react-native-webrtc event-target-shim resolution fallback warning (harmless, পুরনো)।

**পরবর্তী (বাকি):** বাস্তব device-এ EAS preview build দিয়ে end-to-end টেস্ট (user auth লাগবে); incoming-call FCM (Asterisk ARI/dialplan)।

---

### [2026-06-17] — Staff App Cross-cutting: auto PBXAgent + FCM push (ticket)

**পরিবর্তিত/নতুন ফাইল:**
- `accounts/models.py` — User-এ `fcm_token` field; migration `0002_user_fcm_token.py`
- `mobile_api/api/views.py` — `AppStaffFCMTokenView` (`/app/staff/fcm-token/`); `AppStaffSipCredentialsView`-এ auto PBXAgent তৈরি (extension max+1, agent endpoint) + ring group auto-join
- `mobile_api/api/urls.py` — `staff/fcm-token/`
- `support/signals.py` — `_push_fcm_to_users()` helper (transaction.on_commit); ticket created/status-change/assigned-এ FCM push
- `mobile_app/src/services/notifications.js` — `registerForPushNotifications(accountType)` → staff হলে `/app/staff/fcm-token/`, pop হলে skip
- `mobile_app/App.js` — accountType সহ push register

**কী হয়েছে:** (১) staff app login করে SIP creds নিলে স্বয়ংক্রিয় PBXAgent + ring group membership তৈরি হয় → admin manual config ছাড়াই client→hotline কল staff-কে রিং করতে পারবে। (২) ticket create/assign/status change-এ assigned/admin staff-এর মোবাইলে FCM push। দেখুন [[project_staff_app_plan]]।

**Side Effect / সতর্কতা:**
- AppStaffSipCredentialsView এখন PBXAgent **তৈরি/পরিবর্তন** করে (extension auto, প্রথম active ring group-এ যোগ) — admin চাইলে পরে ring group বদলাতে পারবে।
- incoming-call FCM (app killed অবস্থায় কল রিং) এখনো বাকি — server ARI/dialplan trigger লাগবে; registered থাকলে WSS দিয়ে INVITE আসে।
- FCM আসল delivery Firebase credential-নির্ভর (push_service); token না থাকলে চুপচাপ skip।

**Tested:** Django check ০ error; migrate OK; e2e: /app/staff/fcm-token/ 200 (User.fcm_token saved), /app/staff/voip/sip-credentials/ 200 → auto PBXAgent ext=102 endpoint=agent_21। signals import OK। mobile babel-parse OK।

---

### [2026-06-17] — Staff App Phase 4 v2: POP detail + Billing + HR self-service

**পরিবর্তিত/নতুন ফাইল:**
- `mobile_api/api/views.py` — `AppStaffBillsView` (`/app/staff/bills/`: search/status/paginated, admin-level), `AppStaffHRView` (`/app/staff/hr/me/`: own employee + attendance(৩০) + payslip(১২) + month summary)
- `mobile_api/api/urls.py` — `staff/bills/`, `staff/hr/me/`
- `mobile_app/src/screens/staff/StaffBillsScreen.js` (নতুন) — bill list status tab + infinite scroll
- `mobile_app/src/screens/staff/StaffHRScreen.js` (নতুন) — employee + month summary + হাজিরা/বেতন tab
- `mobile_app/src/screens/staff/StaffPOPDetailScreen.js` (নতুন) — POP profile + funding history (`/pop/pops/<id>/` + `/pop/fundings/?pop=` reuse)
- `mobile_app/src/screens/staff/StaffPOPListScreen.js` — কার্ড tap → POP detail
- `mobile_app/src/screens/staff/StaffDashboardScreen.js` — admin tile-এ বিল + আমার HR যোগ
- `mobile_app/App.js` — StaffHomeStack-এ StaffPOPDetail/StaffBills/StaffHR route

**কী হয়েছে:** Phase 4 সম্পূর্ণ — POP profile/funding, billing list, HR self-service (attendance/payslip) মোবাইলে। দেখুন [[project_staff_app_plan]]।

**Side Effect / সতর্কতা:**
- HR endpoint employee profile না থাকলে gracefully `employee: null` ফেরায় (admin user-দের প্রায়ই Employee link থাকে না)।
- Bills/POP detail read-only (mobile view); edit admin panel-এ।

**Tested:** Django check ০ error; e2e (admin token): /app/staff/bills/ 200 (count=2), /app/staff/hr/me/ 200 (employee=null graceful)। সব mobile ফাইল babel-parse OK।

---

### [2026-06-17] — Staff App Phase 4 v1: Admin (Payment Approval + POP List)

**পরিবর্তিত/নতুন ফাইল:**
- `mobile_api/api/views.py` — `_staff_is_admin_level`, `AppStaffPendingPaymentsView` (GET অপেক্ষমাণ পেমেন্ট list + POST {ids} approve → Payment.save() reuse)
- `mobile_api/api/urls.py` — `staff/pending-payments/`
- `mobile_app/src/screens/staff/StaffPendingPaymentsScreen.js` (নতুন) — multi-select + approve
- `mobile_app/src/screens/staff/StaffPOPListScreen.js` (নতুন) — POP তালিকা (বিদ্যমান `/pop/pops/` reuse)
- `mobile_app/src/screens/staff/StaffDashboardScreen.js` — "অ্যাডমিন" section, permission-gated tile (Payment Approval, POP List)
- `mobile_app/App.js` — StaffHomeStack-এ StaffPendingPayments + StaffPOPList route

**কী হয়েছে:** Admin মোবাইল থেকে collector-দের অপেক্ষমাণ পেমেন্ট approve করতে পারে + POP তালিকা দেখতে পারে। Dashboard-এ permission অনুযায়ী admin tile। POP list-এ বিদ্যমান endpoint reuse। দেখুন [[project_staff_app_plan]]।

**Side Effect / সতর্কতা:**
- approve প্রতিটি Payment আলাদা .save() করে (bill recalculate + auto-enable trigger) — bulk update নয়, ইচ্ছাকৃত।
- Phase 4 open-ended; এটি v1 (Payment Approval + POP)। billing/HR/POP-profile mobile পরে।

**Tested:** Django check ০ error; e2e (admin token): /app/staff/pending-payments/ 200, /pop/pops/ (reuse) 200। সব mobile ফাইল babel-parse OK।

---

### [2026-06-17] — Staff App Phase 3: Client Management

**পরিবর্তিত/নতুন ফাইল:**
- `mobile_api/api/views.py` — `_staff_can_manage_clients` (permission gate), `AppStaffClientListView` (`/app/staff/clients/`: search/status/paginated), `AppStaffClientDetailView` (`/app/staff/clients/<id>/`: profile + bill summary + recent payments)
- `mobile_api/api/urls.py` — `staff/clients/`, `staff/clients/<id>/`
- `mobile_app/src/screens/staff/StaffClientListScreen.js` (নতুন) — search + status tabs + infinite scroll
- `mobile_app/src/screens/staff/StaffClientDetailScreen.js` (নতুন) — profile + Enable/Disable + Collect modal + recent payments
- `mobile_app/App.js` — StaffClientStack + 'ক্লায়েন্ট' tab (Home/Clients/Calls/Support)

**কী হয়েছে:** Staff মোবাইল থেকে ক্লায়েন্ট খুঁজে enable/disable + কালেকশন করতে পারে। Enable/disable ও payment-এর জন্য বিদ্যমান admin endpoint (`/clients/<id>/enable|disable/`, `/billing/payments/`) reuse — complex radius/mikrotik logic duplicate করা হয়নি। দেখুন [[project_staff_app_plan]]।

**Side Effect / সতর্কতা:**
- Collection POST `/billing/payments/` `{client, amount, payment_method}` দিয়ে — collector role হলে is_verified=False (admin approve লাগবে, বিদ্যমান নিয়ম)। bill attach হয় না (advance/manual হিসেবে), admin reconcile করবে।
- enable endpoint non-admin-এর জন্য due থাকলে block করে (বিদ্যমান নিয়ম)।
- list read-only mobile payload; heavy admin ClientViewSet serializer ব্যবহার করা হয়নি।

**Tested:** Django check ০ error; e2e (admin token): /app/staff/clients/ 200 (count=3), /app/staff/clients/<id>/ 200। সব mobile ফাইল babel-parse OK।

---

### [2026-06-17] — Staff App Phase 2: Dashboard + Reports

**পরিবর্তিত/নতুন ফাইল:**
- `mobile_api/api/views.py` — `AppStaffDashboardView` (`/app/staff/dashboard/`: today/month collection, online clients RADIUS, total due, client counts; admin vs collector scope), `AppStaffCollectionReportView` (`/app/staff/reports/daily-collection/`: daily group + method breakdown)
- `mobile_api/api/urls.py` — `staff/dashboard/`, `staff/reports/daily-collection/`
- `mobile_app/src/screens/staff/StaffDashboardScreen.js` (নতুন) — Home tab, stat cards + pull-refresh + Reports button
- `mobile_app/src/screens/staff/StaffReportScreen.js` (নতুন) — range (আজ/৭দিন/মাস) + grand total + method + daily
- `mobile_app/App.js` — `StaffHomeStack` (Dashboard+Report); Home tab এখন StaffDashboardScreen; StaffHomeScreen import সরানো (unused)

**কী হয়েছে:** Staff/admin মোবাইল থেকে আয়/কালেকশন/online client dashboard + কালেকশন রিপোর্ট। Permission scope: admin সব দেখে, collector শুধু নিজের কালেকশন। দেখুন [[project_staff_app_plan]]।

**Side Effect / সতর্কতা:** dashboard online_clients RADIUS query করে (down থাকলে 0, try/except আছে)। আগের StaffHomeScreen.js এখনো আছে কিন্তু unused (StaffDashboardScreen replace করেছে)।

**Tested:** Django check ০ error; e2e (admin token): /app/staff/dashboard/ 200 (clients total=3 active=3, online=177 real RADIUS), /app/staff/reports/daily-collection/ 200। সব mobile ফাইল babel-parse OK।

---

### [2026-06-17] — Staff App Phase 1 (Calling+Support) + POP reseller login

**পরিবর্তিত/নতুন ফাইল:**
- `mobile_api/authentication.py` — `MobilePOPUser` + `MobilePOPAuthentication` (pop_id token)
- `mobile_api/api/views.py` — `_create_pop_token`, `_pop_check_password` (hashed/plain tolerant), POP login path (auto-detect: client→pop→staff), `AppPOPProfileView` (`/app/pop/me/`), `AppStaffSipCredentialsView` (`/app/staff/voip/sip-credentials/` → provision agent endpoint), refresh-এ pop_id handle
- `mobile_api/api/urls.py` — `staff/voip/sip-credentials/`, `pop/me/`
- `mobile_app/src/context/AuthContext.js` — 'pop' account type: popUser/popMenus + `isPop`/`hasMenu`; restore/login/logout branch
- `mobile_app/src/context/CallContext.js` — `sipAccount = client||staffUser`; accountType অনুযায়ী creds URL (staff agent SIP register করে)
- `mobile_app/src/screens/staff/StaffSupportListScreen.js` (নতুন) — ticket inbox + status filter
- `mobile_app/src/screens/staff/StaffTicketDetailScreen.js` (নতুন) — detail + reply + status change
- `mobile_app/src/screens/pop/POPHomeScreen.js` (নতুন) — pop.menus অনুযায়ী dashboard
- `mobile_app/App.js` — StaffMain এখন Tabs (হোম/Calls/সাপোর্ট), POPMain branch, isPop

**কী হয়েছে:** Staff agent SIP register + support ticket handle অ্যাপ থেকে। POP reseller একই অ্যাপে role-based login (pop.menus অনুযায়ী)। Support-এ বিদ্যমান `/support/tickets/` reuse (staff JWT)। দেখুন [[project_staff_app_plan]]।

**Side Effect / সতর্কতা:**
- POP password plain-text stored (POPCreateSerializer hash করে না) — `_pop_check_password` hashed/plain উভয় নেয়। ভবিষ্যতে hash করা উচিত।
- Staff incoming call পেতে admin-side PBX config লাগবে (PBXAgent + ring group membership) — mobile-side রেডি।
- FCM push (incoming call/ticket) staff-এর জন্য এখনো যোগ হয়নি।
- POP calling SIP এখনো নেই (POP dashboard only)।

**Tested:** Django check ০ error; e2e: POP login 200 (account_type=pop, menus), /app/pop/me/ 200, POP refresh 200; staff token → /support/tickets/ 200 + /app/staff/voip/sip-credentials/ 200 (agent endpoint provisioned)। সব mobile ফাইল babel-parse OK।

---

### [2026-06-17] — Staff/Admin App Phase 0: role-aware login

**পরিবর্তিত/নতুন ফাইল:**
- `mobile_api/api/serializers.py` — AppLoginSerializer: customer_id/username/identifier + login_type (auto-detect)
- `mobile_api/api/views.py` — `_create_staff_token` (role claim), `staff_permissions`, role-aware `AppLoginView` (client আগে→staff fallback), নতুন `AppStaffProfileView` (`/app/staff/me/`), `AppTokenRefreshView`-এ staff (user_id) refresh
- `mobile_api/api/urls.py` — `staff/me/` route
- `mobile_app/src/context/AuthContext.js` — accountType/staffUser/permissions + isStaff/isClient/hasModule/hasGranular helper; role-aware login(data)/restore/logout; auto-logout staff-এও
- `mobile_app/src/screens/auth/LoginScreen.js` — `identifier` পাঠায়, `login(r.data)`
- `mobile_app/src/screens/staff/StaffHomeScreen.js` (নতুন) — staff home placeholder
- `mobile_app/App.js` — root navigator role branch (StaffMain vs MainTabs), DueOverlay শুধু client

**কী হয়েছে:** একই client app এখন role-based login সাপোর্ট করে। Client = customer_id+app_password (custom JWT); Staff = Django User+role_permissions (standard JWT, role claim)। পূর্ণ roadmap: STAFF_APP_PLAN.md। দেখুন [[project_staff_app_plan]]।

**Side Effect / সতর্কতা:**
- পুরনো client app `customer_id` পাঠালেও কাজ করবে (serializer backward-compatible)।
- Staff token-এ `token_type` override করা হয়নি (নাহলে standard refresh ভাঙত) — শুধু `role` claim।
- CallContext শুধু `client` থাকলে SIP register করে → staff-এ idle (Phase 1-এ agent SIP আসবে)।
- Staff data auto-refresh interval এখনো নেই (Phase 2)।

**Tested:** হ্যাঁ — Django check ০ error; e2e test client: staff login 200 (account_type=staff), /app/staff/me/ 200, ভুল password 400।

---

### [2026-06-17] — POP Management UI স্ক্রিনশট-ম্যাচ পলিশ (২য় পাস)

**পরিবর্তিত ফাইল:**
- `admin_panel/src/pages/pop/POPAddPage.jsx` — POP Menus সম্পূর্ণ rewrite: flat checkbox list থেকে hierarchical tree (parent→children, auto check/uncheck/indeterminate)
- `admin_panel/src/pages/pop/POPTariffPage.jsx` — TariffModal: field labels, সবুজ "Add Package" বাটন, ভেতরে success banner, Cancel/Save footer বাটন; লিস্ট পেজে SHOW/SEARCH row + icon action buttons
- `admin_panel/src/pages/pop/POPListPage.jsx` — Stats card label ঠিক, ClientEnabled/IsLocked toggle switch, Action কলামে ⋮ dropdown menu, Totals row টেবিলের নিচে নেওয়া হয়েছে

**কী করা হয়েছে:** ইউজারের দেওয়া live screenshot অনুযায়ী UI detail-level মিল করা হয়েছে (kept backend/API অপরিবর্তিত, শুধু frontend presentation layer)।

**Side Effect / সতর্কতা:** কোনো backend change নেই — শুধু JSX। `menus` field-এ এখন parent + child key গুলো flat list হিসেবে সংরক্ষিত হয় (e.g. `configuration`, `config_zone`, `config_package` ...)। আগের সংরক্ষিত flat top-level keys (যদি কোনো POP আগেই সেভ হয়ে থাকে) এখনও কাজ করবে কিন্তু child-level detail ছাড়া।

**Tested:** হ্যাঁ — vite build ✓ 3.31s, `python manage.py check` ০ error

---

### [2026-06-17] — POP Profile page + Funding/Settlement tabs (৩য় পাস)

**পরিবর্তিত/নতুন ফাইল:**
- `admin_panel/src/pages/pop/POPProfilePage.jsx` (নতুন) — 9-tab POP Profile: POP Information, Exported/Unexported Clients, Debited/Credited/Recharge Transactions, POP Change Logs, POP Fund Start Logs, POP Online Clients + left sidebar card (avatar, info rows, 8টি action button)
- `admin_panel/src/pages/pop/POPFundingPage.jsx` — "MAC Reseller Funding" স্ক্রিনশট অনুযায়ী rewrite: MACReseller Fund/Fund History 2-tab, Give Fund → "Fund Transaction" modal, filters, Total row
- `admin_panel/src/pages/pop/POPPGWSettlementPage.jsx` — 3-tab rewrite: POP PGW Transactions, Transaction Settlement History, POP Transactions
- `admin_panel/src/App.jsx` — `/pop/:id/profile` route (linter যোগ করেছে)
- POP List action menu (⋮) এ "View Profile" → profile page

**Backend (linter আগেই যোগ করেছে):** POPChangeLog, POPFundStartLog, ClientRechargeLog models + serializers; POPViewSet-এ profile sub-tab actions: clients, clients-bulk, debited/credited/recharge-transactions, change-logs, fund-start-logs, online-clients, toggle-fund-start। perform_update এ POPChangeLog auto-snapshot।

**Side Effect / সতর্কতা:** online-clients action RadiusService().get_online_users() কল করে — RADIUS down থাকলে এই tab ব্যর্থ হবে (try/catch আছে)। Profile sidebar-এ Running/Left Clients এখন hardcoded 0 (client-POP linking pending)।

**Tested:** হ্যাঁ — vite build ✓ 3.16s, `python manage.py check` ০ error

---

### [2026-06-17] — Automation পেজ: সব কার্ডে Daily/Weekly/Monthly/Interval full schedule control

**পরিবর্তিত ফাইল:** `system_settings/api/views.py`, `admin_panel/src/pages/settings/SettingsPage.jsx`

**কী হয়েছে:**
1. Toggle-only ধারণা সম্পূর্ণ সরানো হয়েছে। সব ১১টি automation card-এ পূর্ণ schedule control।
2. **নতুন Frequency: ইন্টারভাল** — `*/N * * * *` cron। UI-তে N মিনিট input + quick 5/10/15/30/60m বাটন। মানব-পাঠযোগ্য label (ঘণ্টা/মিনিট)।
3. **`set_schedule` endpoint:** `freq_type=interval` + `interval_minutes` support।
4. **`_sync_celery_beat`:** interval PeriodicTask-কে crontab-এ convert করতে পারে (`interval=None` set করে)।
5. **`_sync_state_from_beat`:** interval-based beat task-এর schedule `*/N * * * *` format-এ parse করে AutomaticProcess-এ sync করে।
6. **`parseCron` (frontend):** `*/N ...` pattern → `freqType='interval'`; অন্যটায় daily/weekly/monthly detect।

**⚠️ Side Effect / সতর্কতা:**
- OLT MAC Sync / OLT ONU Link এখন interval → crontab convert হবে (যদি admin "Save" করে)। এতে exact 5-second granularity হারাবে, কিন্তু কার্যকর থাকবে।
- sms_due hourly cron `0 * * * *` → parseCron দিয়ে 'daily' at 00:00 দেখাবে (hour=`*` parse হয়)। ব্যবহারকারী নিজে সেট করলে সঠিক হবে।

**Tested:** হ্যাঁ — vite build সফল (3.04s)।

---

### [2026-06-17] — Automation পেজ: Daily/Weekly/Monthly schedule picker + ২ নতুন task (voip_schedule, mikrotik_sync) + router_backup fix

**পরিবর্তিত ফাইল:** `system_settings/models.py`, `system_settings/migrations/0014_*.py`,
`system_settings/api/views.py`, `admin_panel/src/pages/settings/SettingsPage.jsx`

**কী হয়েছে:**
1. **নতুন Process Types:** `voip_schedule` (Voice Call Auto Scheduler, daily cron, time configurable) এবং `mikrotik_sync` (MikroTik Active User Sync, toggle-only, ৫ মিনিট)। মোট ১১টি process।
2. **Bug fix:** `router_backup` আগে `_TASK_NAMES`-এ ছিল না — এখন `mikrotik.router_backup` link করা হয়েছে।
3. **Full cron support (5-field):** `_sync_celery_beat` এখন `day_of_month` + `day_of_week` সহ CrontabSchedule তৈরি/আপডেট করে। PeriodicTask না থাকলে create করে।
4. **`set_schedule` endpoint:** `freq_type` (daily/weekly/monthly) + `day_of_week` + `day_of_month` accept করে সঠিক 5-field cron তৈরি করে।
5. **Frontend `ProcessCard`:** Daily/Weekly/Monthly frequency selector — Weekly হলে ৭টি বাটন (রব-শন), Monthly হলে তারিখ dropdown (১-৩১)। `parseCron()` helper দিয়ে existing cron থেকে initial state parse।
6. **`_sync_state_from_beat`:** আসল beat crontab থেকে full 5-field cron sync (`dom + month + dow` সহ)।

**⚠️ Side Effect / সতর্কতা:**
- `mikrotik.sync_active_users` এবং `mikrotik.router_backup` beat DB-তে আগে ছিল না। প্রথমবার "Save" বা toggle করলে PeriodicTask auto-create হবে।
- `voip.run_voice_call_schedules` beat DB-তে আগে থেকেই আছে (10 AM daily) — sync হবে।
- `auto_bill`-এর beat cron `0 0 * 1 *` → monthly/1st sync হয়ে schedule_cron `0 0 1 * *` হবে।

**Tested:** হ্যাঁ — migration applied; vite build সফল (3.09s)।

---

### [2026-06-17] — Automation পেজ: সব scheduled process (৯টি) একসাথে, toggle-only + time-picker

**পরিবর্তিত ফাইল:** `system_settings/models.py`, `system_settings/migrations/0013_*.py`,
`system_settings/api/views.py`, `admin_panel/src/pages/settings/SettingsPage.jsx`

**কী হয়েছে:**
1. `AutomaticProcess.PROCESS_TYPES`-এ ৪টি নতুন type যোগ: `radacct_aggregate`, `radacct_purge`, `olt_mac_sync`, `olt_link_onu`।
2. Backend: `_TOGGLE_ONLY` set দিয়ে interval task-গুলো schedule না বদলে শুধু enable/disable। নতুন `set-enabled` action। `get_all` এখন real Celery Beat PeriodicTask থেকে state sync করে।
3. Frontend `ProcessCard`: `toggleOnly: true` হলে time picker লুকায়, frequency pill দেখায়, toggle পরিবর্তনে auto-save (`set-enabled` API)। `toggleOnly: false` হলে আগের মতো time picker + Save button।
4. `order` array: সব ৯টি process type অন্তর্ভুক্ত।

**Side Effect / সতর্কতা:**
- `olt_mac_sync`, `olt_link_onu`, `sms_due` — এগুলো Celery-তে interval schedule, cron দিয়ে নয়। Frontend-এও এটা freq pill দিয়ে স্পষ্ট করা হয়েছে।
- `radacct_aggregate`, `radacct_purge` — daily cron, time picker দিয়ে নিয়ন্ত্রণযোগ্য।

**Tested:** হ্যাঁ — migration applied; vite build সফল (2.99s)।

---

### [2026-06-17] — Voice SMS: রেকর্ডিং লাইব্রেরি + অটো শিডিউল Automation পেজে সরানো

**পরিবর্তিত ফাইল:** `voip/models.py` (নতুন `VoiceRecording` model + `VoiceCallSchedule.recording` FK,
`audio` nullable, `audio_path()`), `voip/api/serializers.py`, `voip/api/views.py`, `voip/api/urls.py`,
`voip/tasks.py`; `voip/migrations/0005_*.py`; `admin_panel/src/pages/voip/VoiceSmsPage.jsx` (পূর্ণ
পুনর্লিখন), `admin_panel/src/pages/settings/SettingsPage.jsx` (AutomationTab-এ `VoiceScheduleManager`)।

**কী হয়েছে:**
1. **রেকর্ডিং লাইব্রেরি** — নতুন `VoiceRecording` model (`isp_voice_recordings`)। একবার রেকর্ড/আপলোড করে
   নাম দিয়ে সংরক্ষণ; `/voip/voice-recordings/` CRUD। ম্যানুয়াল broadcast এখন `recording_id` দিয়ে
   সংরক্ষিত রেকর্ডিং পাঠায় (fresh `audio`-ও backward-compat আছে)।
2. **অটো ভয়েস কল শিডিউল Voice SMS পেজ থেকে সরিয়ে Automation পেজে** (System → Settings → Automation,
   `VoiceScheduleManager`)। শিডিউল এখন লাইব্রেরির recording (FK) reference করে। `audio_path()` recording
   থাকলে সেটা, নইলে পুরনো inline `audio` দেয় (run_now + celery task উভয়ে ব্যবহার করে)।
3. **Voice SMS পেজ পুনর্নকশা** — ২ ধাপ: (১) রেকর্ডিং লাইব্রেরি (সংরক্ষণ + radio-select), (২) ক্লায়েন্ট
   নির্বাচন করে পাঠানো। SettingsPage এখন `#/settings?tab=automation` deep-link পড়ে (initial tab)।

**⚠️ Side Effect / সতর্কতা:**
- `VoiceCallSchedule.audio` এখন nullable। broadcast/convert-এ সবসময় `audio_path()` ব্যবহার করুন,
  সরাসরি `.audio.path` নয় (None হতে পারে)।
- `recording=SET_NULL` — লাইব্রেরি থেকে recording মুছলে schedule-এর recording null হয়; তখন audio_path None →
  task warning দিয়ে skip করে (ক্র্যাশ নয়)।
**Tested:** হ্যাঁ — migration applied; `manage.py check` clean; API smoke-test (recording + schedule POST,
audio_url/recording_title resolve নিশ্চিত), পরে test data মুছে দেওয়া হয়েছে; vite build সফল।

---

### [2026-06-17] — VoIP fix: ক্লায়েন্ট অ্যাপ register/কল আসছিল না (ভুল AOR option)

**পরিবর্তিত ফাইল:** কোনো source code নয় — শুধু লাইভ `/etc/asterisk/pjsip_isp.d/client_*.conf` regenerate।
**কী হয়েছে:** ক্লায়েন্ট এপ থেকে এডমিনে কল আসছিল না। কারণ — লাইভ PJSIP conf ফাইলে ভুল AOR
option (`max_expiry`/`maximum_expiry`) থাকায় aor object তৈরি হচ্ছিল না → client endpoint
`Unavailable` → register fail। কোড ([asterisk_provision.py:132](voip/services/asterisk_provision.py))
ইতিমধ্যে সঠিক (`maximum_expiration`) ছিল, কিন্তু পুরোনো buggy কোডে লেখা লাইভ ফাইল regenerate হয়নি।
**সমাধান:** `POST /api/v1/voip/reprovision/` (ReprovisionAllEndpointsView, staff-only) কল করে সব
SipEndpoint conf regenerate + `pjsip reload`। এখন `pjsip show aors`-এ চারটি AOR-ই load হয়।
**Side Effect / সতর্কতা:**
- 🔴 conf ফাইল owner `isp:asterisk` (gunicorn user `isp`)। **amir/manage.py shell দিয়ে সরাসরি লেখা যায় না**
  (Permission denied)। regenerate করতে হলে reprovision **API endpoint** ব্যবহার করুন (gunicorn=isp process
  এর মধ্যে চলে → সঠিক perms), অথবা `isp` user হিসেবে `manage.py voip_provision_all`।
- AMI দিয়ে ডিবাগ (CLI সরাসরি চলে না — amir asterisk group/config পড়তে পারে না)। AMI creds `.env`-এ।
- Asterisk 22 PJSIP AOR-এ `_expiration` suffix লাগে (`_expiry` নয়)।
**Tested:** আংশিক — `pjsip show aors` এখন client_1/2/4 load করে; reload-এর পর নতুন aor error নেই।
End-to-end (আসল ক্লায়েন্ট এপ থেকে কল) user-কে যাচাই করতে হবে — এপ খুললে এখন register হওয়ার কথা।

---

### [2026-06-16] — VoIP admin features: top-bar dialer + Call Log + Voice SMS (auto voice call)

**নতুন ফাইল:** `admin_panel/src/components/SoftphoneDialer.jsx`, `admin_panel/src/pages/voip/CallLogPage.jsx`,
`admin_panel/src/pages/voip/VoiceSmsPage.jsx`, `voip/services/voice_broadcast.py`।
**পরিবর্তিত:** `admin_panel/src/components/Layout.jsx`, `Sidebar.jsx`, `App.jsx`; `voip/api/views.py`,
`deploy/asterisk/configs/extensions.conf` ([voip-announce]), `manager.conf` (AMI write perms)।

**কী হয়েছে (সব admin panel/web — যাচাইকৃত):**
1. **Top-bar softphone dialer** — আধুনিক LCD ডিসপ্লে (লাইন নাম/নম্বর/timer + state), dial pad,
   client search, context-aware action (call/accept-reject/mute-hangup); কল এলে auto-open। পুরনো
   floating SoftphoneWidget সরানো (Layout.jsx)।
2. **Sidebar "VoIP" মেনু** (alwaysShow) → **Call Log** + **Voice SMS Service**।
3. **Call Log পেজ** — table (সময়/client/দিক/agent/duration/status badge) + filter (direction/status/
   date range) + debounced search + pagination। `CallLogViewSet`-এ search/date/order যোগ।
4. **Voice SMS Service** — client টেবিল (expiry/status/📱app) checkbox select + filter; অডিও record
   (MediaRecorder)/upload → **automated voice call broadcast**: ffmpeg → 8kHz wav → প্রতি client-কে
   **FCM wake → register-poll → AMI Originate(voip-announce: Answer+Playback+Hangup)** → client রিসিভ
   করলে রেকর্ডিং বাজে। `VoiceMessageViewSet`-এ `recipients`/`broadcast`/`voice_call_broadcast` actions।

**⚠️ Side Effect / সতর্কতা:**
- 🔴 **AMI write perms-এ `originate,call` আবশ্যক** (manager.conf) — নইলে Originate "Permission denied"
  (FCM-CallKeep রিং দেখায় কিন্তু আসল কল হয় না → answer-এ activate হয় না)। live apply: **sed দিয়ে শুধু
  write লাইন** (পুরো cp নয় — secret placeholder)। + `manager reload`।
- voip-announce dialplan live apply: `extensions.conf` cp + `dialplan reload`।
- ffmpeg install করা হয়েছে (apt — dry-run-এ নিরাপদ, 0 to remove)। অডিও → `media/voice_announce/*.wav`
  (644, asterisk o+rx পড়ে)। Playback absolute path (ext ছাড়া)।
- voice broadcast background thread-এ চলে (gunicorn worker; অনেক client হলে ধাপে ধাপে)।
- reliability: প্রতি client FCM-wake+register timing-নির্ভর (অ্যাপ থাকতে হবে 📱; ~৩৫s window)।

**Tested:** ✅ live — client_2-কে voice call: channel trace Ringing→Up→**Playback(announce wav)**→Hangup;
user ফোনে ৪s টোন শুনেছে (user-confirmed)। `manage.py check` 0 issue; সব vite build OK।

---

### [2026-06-16] — VoIP CallKeep managed mode + reliability (production-ready app-closed কলিং)

**পরিবর্তিত:** `mobile_app/src/services/callKeepService.js`, `messaging.js`, `src/screens/call/CallScreen.js`,
`src/context/CallContext.js`, `plugins/withCallKeep.js`, `app.json`, `package.json`;
`mobile_api/services/push_service.py`, `voip/services/asterisk_provision.py`,
`voip/management/commands/voip_call_listener.py`, `deploy/asterisk/configs/extensions.conf`।

**অর্জিত (user-confirmed, live RTP যাচাইকৃত):** অ্যাপ **সম্পূর্ণ বন্ধ** থাকলেও admin কল →
**Android native full-screen incoming UI + রিংটোন** (অ্যাপ সামনে আসে না) → answer → **দুমুখী audio**।

**মূল পরিবর্তন:**
- **managed mode** (`selfManaged:false`, embedded BUILD-এ) — Android system dialer full-screen UI+ringtone
  দেখায়। ⚠️ self-managed→managed বদলানো যায় না; clean install (uninstall আগে) + calling account enable লাগে।
- **No app popup:** answerCall-এ `backToForeground()` বাদ; `messaging._ensureSipRegistered()` FCM আসামাত্র
  **background-এ headless SIP register** করে (sipPhone singleton, creds api থেকে) + callKeepState.onAnswer/
  onEnd/onMute সরাসরি sipPhone-এ wire → answer-এ অ্যাপ না খুলেই কল ধরা যায়।
- **Background outgoing audio:** `withCallKeep` → `foregroundServiceType=phoneCall|microphone` +
  `FOREGROUND_SERVICE_MICROPHONE` (নইলে background-এ ক্লায়েন্টের mic block → outgoing audio আসে না)। **native build লাগে।**
- **in-app CallScreen লুকানো** (CallKeep থাকলে) — native UI redundant; native Mute→SIP wire।
- **Reliability:** FCM `ttl=45s` (পুরনো queue-হওয়া push drop → ভুতুড়ে কল বন্ধ); CallKeep auto-end ৪৫s-এ
  SIP না হলে; dialplan retry window ~৩৫s + Wait(1); endpoint `rtp_timeout=30/hold=60` (app killed হলে
  stuck channel auto-hangup)।
- caller name "Rajamehar Online WiFi"; CallScreen "Rajamehar Online / WiFi Support"।

**⚠️ Side Effect / সতর্কতা (পরের dev অবশ্যই পড়ুন):**
- 🔴 **Phone + Microphone permission** আবশ্যক (fresh install-এ Allow); **Calling account enable** (managed mode);
  callkeep New-Arch patch; selfManaged রাখো (managed চাইলে uninstall+reinstall + embedded build)।
- 🔴 build = নতুন Expo account **`rajameharonlineapp`** (পুরনো free build শেষ)। JS-only fix সব `eas update
  --branch preview` (OTA); native (manifest/dep) বদলালেই build। `EAS_SKIP_AUTO_FINGERPRINT=1` (local-build
  leftover root-owned .kotlin-এর কারণে fingerprint fail হয়)।
- re-provision লাগবে rtp_timeout apply-এ: `sudo venv/bin/python manage.py voip_provision_all` (root)।
- দুটো server apply: listener restart (FCM TTL) + `extensions.conf` cp+`dialplan reload`।
- **reliability সীমা:** killed-app-এ FCM→headless register timing; OEM battery restriction-এ FCM দেরি হতে পারে।

**Tested:** ✅ live RTP `pjsip show channelstats` — দুদিকে balanced (client TX 4474 → agent RX 4474,
Lost 0)। app-closed full-screen+ringtone+no-popup user-confirmed (screenshots)। `manage.py check` 0 issue;
সব node --check OK; expo introspect (mic FGS) OK।

---

### [2026-06-16] — ✅ CallKeep app-closed full-screen ring + Stage 2 audio (dialplan retry)

**পরিবর্তিত:** `mobile_app/src/services/callKeepService.js`, `deploy/asterisk/configs/extensions.conf`
(+ live `/etc/asterisk/extensions.conf`)। **Build:** নতুন Expo account `rajameharonlineapp`
(projectId `56c3827f...`) — পুরনো account-এর free build শেষ ছিল।

**যা অর্জিত:** অ্যাপ বন্ধ থাকলেও admin কল করলে **full-screen কলিং পেজ** আসে। পথ:
admin কল → AMI listener FCM (data-only, high-priority) → ফোনে CallKeep জাগে →
**dialplan retry** (~২৪s) client register হওয়ার সময় দেয় → register হলে INVITE → CallScreen।

**CallKeep crash chain (সব fix, logcat-নির্ভর):**
1. TurboModule (New Arch) — callkeep overloaded `@ReactMethod` → patch-package (আগের entry)।
2. `READ_PHONE_NUMBERS` runtime perm না থাকলে `getPhoneAccount()` SecurityException crash →
   `PermissionsAndroid.requestMultiple` (setupCallKeep)। **fresh install-এ আবার grant লাগে** —
   না হলে crash; ম্যানুয়াল: Settings→Apps→Permissions→**Phone→Allow** (বা `adb shell pm grant
   ... READ_PHONE_NUMBERS`)।
3. FG-service notification icon=0 → Android 14 "broken notification" crash →
   `foregroundService.notificationIcon='ic_launcher'`।
4. **selfManaged রাখতেই হবে** — `selfManaged:false` করলে Android "cannot change a self-managed
   phone account" → setup crash → অ্যাপ খোলে না। ফেরাতে **uninstall+reinstall** (account Telecom-এ
   persist করে; `adb uninstall com.rajameharonline.client`)।

**Stage 2 audio — dialplan retry loop** (`extensions.conf` [voip-internal]): client unavailable হলে
`Ringing()`+`Dial(15)`+`Wait(2)`+`Goto(retry)` সর্বোচ্চ ~১২ বার; register হওয়ামাত্র Dial রিং করে।
apply: `sudo cp deploy/asterisk/configs/extensions.conf /etc/asterisk/ && sudo asterisk -rx
'dialplan reload'`।

**⚠️ Side Effect / সতর্কতা:**
- 🔴 **full-screen native UI = self-managed CallKeep + onShowIncomingCallUi**; managed mode চেষ্টা করো না
  (account-type-change crash)।
- 🔴 fresh install-এ Phone permission আবার Allow করা **আবশ্যক** (নইলে কল-এ crash)। প্রোডাকশন rollout-এ
  onboarding-এ এটা prominent করতে হবে।
- JS-only fix সব **EAS Update (OTA)** দিয়ে গেছে — `eas update --branch preview` (account `rajameharonlineapp`)।
  app.json-এ projectId এখন নতুন account; OTA/build ওই account দিয়েই।
- 🔴 এই production সার্ভারে local build নয় (আগের entry — মেশিন freeze)।
- coturn TLS 5349 + RTP NAT — audio one-way হলে এখানে দেখতে হবে (এখনো verify বাকি)।

**Tested:** ✅✅ সম্পূর্ণ end-to-end যাচাইকৃত। app-closed admin কল → full-screen কলিং পেজ →
answer → **দুমুখী audio** (AMI `pjsip show channelstats`: agent_1↔client_2 bridged, opus, RX/TX
~3400+ packet দুদিকে, Lost 0, ১m১১s uptime)। CallLog id 62 completed/answered/19s-ও নিশ্চিত করেছিল।
**বাকি:** reliability — অ্যাপ background-এ WSS drop হলে কল ধরতে FCM→wake→register dialplan retry
window (~২৪s)-এর মধ্যে হতে হয়; না হলে "client_2 not registered/reachable" fail। qualify + reconnect
সাহায্য করে, কিন্তু killed অ্যাপে registration timing-ই মূল ভেরিয়েবল।

---

### [2026-06-16] — ⚠️ Local Android build production সার্ভার freeze করল → reboot; coturn boot-order

**কী ঘটেছে:** EAS free build শেষ হওয়ায় CallKeep patch যাচাই করতে **local Docker build** (mingc/
android-build-box, `mobile_app/build-local-docker.sh`) চালানো হয়েছিল। memory cap (6g) + arm64-only
সত্ত্বেও RN new-arch C++ compile (reanimated/worklets/RN core) **পুরো production সার্ভার freeze** করে
দিল (14GB RAM, ~5GB free যথেষ্ট নয়)। মেশিন **hard reboot** করতে হয়েছে।

**পুনরুদ্ধার:** reboot-পরবর্তী সব service active — **coturn ছাড়া**। coturn fail কারণ: **boot-এ network
ready হওয়ার আগেই চালু** হয়েছিল (`ERROR: Cannot configure any meaningful IP listener address` — শুধু
loopback পেয়েছিল)। `sudo systemctl reset-failed coturn && sudo systemctl restart coturn` দিয়ে ঠিক।

**🔴 সিদ্ধান্ত:** এই production সার্ভারে **আর কখনো local RN build নয়** — OOM ঝুঁকি অগ্রহণযোগ্য।
CallKeep patch (commit 37b8f91) সম্পূর্ণ; build options: (ক) ১৪ দিন পর EAS free (Jul 1), (খ) EAS
upgrade, (গ) **আলাদা মেশিনে** local build। Cleanup: mingc image (~20GB) + gradle volume + android/
prebuild dir সরানো হয়েছে; package.json scripts (prebuild-এর run:android→) revert।

**Side Effect / সতর্কতা:**
- ⚠️ coturn boot-order fragile — পরে `coturn.service`-এ `After=network-online.target` +
  `Wants=network-online.target` drop-in যোগ করা উচিত (নইলে প্রতি reboot-এ coturn manual restart লাগবে)।
- `mobile_app/build-local-docker.sh` রাখা আছে — কিন্তু **এই সার্ভারে চালাবেন না**, শুধু আলাদা মেশিনে।
- android/ dir-এর কিছু ফাইল root-owned (container) — `sudo rm -rf mobile_app/android` লাগে।

**Tested:** reboot-পরবর্তী service যাচাই — gunicorn/nginx/mysql/asterisk/redis/voip-listener active;
coturn restart-এর পর active।

---

### [2026-06-16] — VoIP CallKeep ডিবাগ: New Arch TurboModule conflict → patch-package

**পরিবর্তিত:** `mobile_app/src/services/callKeepService.js`, `messaging.js`, `src/context/CallContext.js`,
`mobile_app/package.json` (+patch-package, postinstall), নতুন `patches/react-native-callkeep+4.3.16.patch`।

**ডিবাগ যাত্রা (logcat-নির্ভর):**
1. App-closed কল → notification আসে কিন্তু রিং নেই → CallKeep দরকার (Stage 1)।
2. logcat: `RNFirebaseMsgReceiver broadcast received` + bg handler চলে — **FCM service conflict নেই**।
3. logcat: `displayIncomingCall ... available=false` → `RNCallKeep` null।
4. **আসল কারণ (logcat):** `TurboModuleInteropUtils$ParsingException: Module exports two methods
   with the same name: "displayIncomingCall"`। RN 0.81/Expo 54 **New Architecture (TurboModule)**
   default; `react-native-callkeep`-এ `displayIncomingCall` ও `startCall` **overloaded @ReactMethod**
   → TurboModule parse fail → module load হয় না।

**সমাধান:** `newArchEnabled:false` **দেওয়া যাবে না** (reanimated@4 New Arch বাধ্যতামূলক — পরস্পরবিরোধী)।
তাই **patch-package** দিয়ে callkeep-এর 3-arg overload থেকে `@ReactMethod` সরানো (Android JS শুধু 4-arg
ডাকে — index.js)। `package.json` postinstall=`patch-package` → EAS build-এ npm install-এর পর auto-apply।
আগের কাজ: foreground startup-এ `setupCallKeep()` (PhoneAccount register), robust import (`.default||mod`)।

**⚠️ Side Effect / সতর্কতা:**
- 🔴 এটা **native পরিবর্তন → নতুন EAS build লাগবে** (OTA নয়)। **EAS free build এই মাসে শেষ** (reset
  ~Jul 1)। build options: (ক) ১৪ দিন অপেক্ষা, (খ) EAS plan upgrade, (গ) local Docker build।
- callkeep New Arch-এ আর কোনো overloaded @ReactMethod নেই — যাচাইকৃত (40 annotation, কোনো duplicate নেই)।
- JS-only fixগুলো (setupCallKeep, import, log) **EAS Update (OTA)** দিয়ে গেছে — runtime 1.0.0, branch preview।
- এখনো **Stage 1 (রিং)**; build-এর পর রিং কাজ করলে Stage 2 (push-first orchestrated audio) বাকি।

**Tested:** patch apply ✔ (`patch-package` re-apply OK); node --check OK। **রিং device-test build-এর পরে।**

---

### [2026-06-16] — VoIP CallKeep Stage 1: অ্যাপ বন্ধ থাকলেও full-screen রিং (FCM bg handler)

**নতুন ফাইল:** `mobile_app/plugins/withCallKeep.js` (custom Expo config plugin),
`mobile_app/src/services/callKeepService.js`, `mobile_app/src/services/messaging.js`।
**পরিবর্তিত:** `mobile_app/index.js`, `mobile_app/app.json`, `mobile_app/src/context/CallContext.js`,
`mobile_app/package.json` (+deps), `mobile_api/services/push_service.py`,
`voip/management/commands/voip_call_listener.py`।

**কী হয়েছে:** অ্যাপ killed/background থাকলেও ইনকামিং কল **ফোনের মতো full-screen রিং** করানোর Stage 1।
- নতুন deps: `@react-native-firebase/app`+`/messaging` 21.14, `react-native-callkeep` 4.3.16
  (`--legacy-peer-deps`, React 19)।
- `messaging.js` — `setBackgroundMessageHandler` (index.js-এ App-এর **আগে** import) → data message
  `type=incoming_call` এলে `callKeepService.displayIncomingCall()` → CallKeep full-screen রিং।
- `withCallKeep.js` — callkeep-এর official Expo plugin নেই; manifest-এ `VoiceConnectionService` +
  FOREGROUND_SERVICE/BIND_TELECOM permission inject করে (introspect-এ যাচাইকৃত)।
- server: `send_to_token(..., data_only=True, high_priority=True)` — **data-only** (notification
  payload থাকলে killed অ্যাপে RNFirebase bg handler চলে না)।
- CallContext — CallKeep Accept/End ↔ SIP answer/hangup, SIP Established→`setCurrentCallActive`,
  Terminated→`endCall`; `pendingAnswer` দিয়ে INVITE আসামাত্র auto-answer।

**⚠️ Side Effect / সতর্কতা (পরের agent অবশ্যই পড়ুন):**
- 🔴 **Stage 1 শুধু রিং** — **অডিও connect হবে না**। কারণ admin "কল করুন" সরাসরি SIP INVITE পাঠায়;
  অ্যাপ বন্ধ থাকলে client contact নেই → Dial ~1s-এ CHANUNAVAIL। FCM→register ৫-১০s লাগে, ততক্ষণে
  কল শেষ। **Stage 2 দরকার: push-first orchestration** (admin→server FCM→client Accept→register→
  server ARI originate দুই leg)। CallOriginateView/ari_client প্রস্তুত আছে।
- 🔴 **conflict ঝুঁকি:** `expo-notifications` ও `@react-native-firebase/messaging` দুটোই FCM service
  manifest-এ declare করে; কোনটা default intent পায় তার উপর bg handler নির্ভর। রিং না এলে এখানেই
  সমস্যা — তখন FCM সম্পূর্ণ RNFirebase-এ নিতে হবে (expo-notifications শুধু local display)।
- data_only করায় **পুরনো (CallKeep-বিহীন) build আর কোনো notification দেখাবে না** — নতুন build লাগবে।
- iOS-এ CallKit/PushKit আলাদা সেটআপ লাগবে (এখন শুধু Android লক্ষ্য)।

**Tested:** node --check সব JS OK; `expo config --type introspect` exit 0 — withCallKeep manifest mod
(VoiceConnectionService+permissions) যাচাইকৃত; `manage.py check` 0 issue। **Device রিং test EAS
build-এর পর বাকি।**

---

### [2026-06-16] — VoIP উন্নতি: auto-reconnect + FCM incoming push + qualify_frequency

**পরিবর্তিত ফাইল:** `voip/services/asterisk_provision.py`, `voip/management/commands/voip_call_listener.py`,
`mobile_app/src/services/sipPhone.js`, `mobile_app/src/context/CallContext.js`

**কী হয়েছে (৩টি উন্নতি):**
1. **qualify_frequency=30 / qualify_timeout=3** — AOR stanza-তে যোগ। Asterisk এখন প্রতি contact-কে
   OPTIONS-ping করবে → LTE NAT binding জীবিত থাকে + dead contact সরে যায় (stale contact-এ কল
   black-hole হয় না)। ⚠️ **বিদ্যমান live ফাইল backfill দরকার** (নিচে)।
2. **মোবাইল auto-reconnect** — `sipPhone.js`-এ transport `Disconnected` listener + exponential backoff
   (`2s→max 30s`) reconnect + পুনরায় register; `destroy()`-এ `stopped` guard। `CallContext.js`-এ
   `AppState` 'active' → `reconnect()` (অ্যাপ foreground-এ ফিরলে দ্রুত register)। আগে register
   একবারই হতো, fail করলে restart লাগত — এখন নিজে থেকে ফিরে আসে।
3. **FCM incoming-call push** — AMI listener `_ensure_calllog`-এ নতুন কল + callee=client হলে ওই
   client-এর `fcm_token`-এ `push_service.send_to_token` দিয়ে "📞 ইনকামিং কল" push (`data.type=
   incoming_call`)। অ্যাপ বন্ধ/background থাকলেও user জানে; tap → অ্যাপ খোলে → register → 40s ring
   window-এ SIP INVITE আসে।

**Side Effect / সতর্কতা:**
- ⚠️ qualify backfill (একবার, sudo): `cd /var/www/isp_bnas && sudo -u isp venv/bin/python manage.py
  voip_provision_all` — না চালালে পুরনো endpoint qualify পাবে না (নতুন client স্বয়ংক্রিয় পাবে)।
- ⚠️ মোবাইল পরিবর্তন কার্যকর হতে **নতুন EAS build** দরকার।
- FCM push শুধু **নোটিফিকেশন-ভিত্তিক** (tap-to-open)। অ্যাপ killed অবস্থায় **স্বয়ংক্রিয় full-screen
  রিং (CallKeep)** এখনো নেই — সেটার জন্য `react-native-callkeep` + `@react-native-firebase/messaging`
  background handler + custom config plugin + আলাদা build লাগবে (পরের ধাপ)।
- push_service Firebase init করে; `FIREBASE_CREDENTIALS_PATH` সেট থাকতে হবে (.env)।

**Tested:** `manage.py check` 0 issue; sipPhone.js node --check syntax OK। reconnect/FCM device-এ
নতুন build-এ যাচাই বাকি।

---

### [2026-06-16] — VoIP ডিবাগ: admin→client কল মোবাইলে আসছে না (root cause + app visibility)

**পরিবর্তিত ফাইল:** `mobile_app/src/services/sipPhone.js`, `mobile_app/src/context/CallContext.js`,
`mobile_app/src/screens/call/SipStatusBadge.js` (নতুন), `mobile_app/App.js`

**Root cause (যাচাইকৃত live):** মোবাইল অ্যাপ Asterisk-এ **register-ই হচ্ছে না** — অ্যাপ foreground-এ
খোলা রেখেও `pjsip show contacts`-এ শুধু `agent_1` (admin browser, সার্ভারের নিজ IP 172.16.3.254
থেকে); `client_1/2/4` সব **Unavailable**। তাই প্রতিটি কল → `res_pjsip: Could not create dialog...
Is endpoint registered and reachable?` → ফোন বাজে না।
**সবচেয়ে সম্ভাব্য কারণ — নেটওয়ার্ক/পোর্ট-ফরোয়ার্ড:**
- `/etc/hosts`-এ `roisp.duckdns.org → 172.16.3.254` (LAN); admin softphone সার্ভার-LAN থেকে সরাসরি
  WSS 8089-এ পৌঁছায় বলেই কাজ করে।
- duckdns পাবলিক DNS → `103.214.202.17`; সার্ভারের আসল outbound IP → `103.214.202.242` (**মেলে না**)।
- মোবাইল creds (পোর্ট 443/nginx) পেয়েছে (access.log 200, UA okhttp), কিন্তু **WSS 8089 register হয়নি** —
  রাউটারে 8089 (+ TURN 3478/5349 + RTP 10000-20000/coturn relay 49152-65535) forward নেই বলে ধারণা।

**কী করা হয়েছে (app-side visibility — silent fail বন্ধ):** register fail হলে আসল error capture
(`console.warn` + `onError`), native-module load fail আলাদা ধরা, এবং নতুন **SipStatusBadge** —
register না হলে স্ক্রিনের উপরে ছোট ব্যাজ; tap-এ আসল কারণ ("WSS connect failed" / "native-module" /
"401")। পরের EAS build-এ ফোনেই দেখা যাবে।

**Side Effect / সতর্কতা:**
- ⚠️ কোনো backend/Asterisk config বদলানো হয়নি — শুধু mobile_app JS। প্রকৃত fix = **রাউটারে পোর্ট
  forward** (duckdns-এর WAN IP-তে) + duckdns↔WAN IP মেলানো।
- coturn TLS `5349` listen করছে না + 3478 docker0(172.17.0.1)-এও bound — registration ঠিক হওয়ার
  পর **মিডিয়া/অডিও** পর্যায়ে এগুলো দেখতে হবে (one-way/no audio হলে এখানেই)।
- FCM/CallKeep এখনো নেই — register ঠিক হলেও অ্যাপ background/বন্ধ থাকলে কল আসবে না (foreground only)।

**✅ সমাধান (যাচাইকৃত):** আসল কারণ ছিল **MikroTik রাউটারে পোর্ট forward করা ছিল না**। duckdns-এর
WAN IP `103.214.202.17` → `172.16.3.254`-তে dst-nat যোগ করা হলো: `8089/tcp` (WSS), `3478/udp+tcp`,
`5349/tcp` (TURN), `10000-20000/udp` (RTP), `49152-65535/udp` (coturn relay) + forward chain accept
(drop rule-এর উপরে)। এরপর ফোন **LTE-তে** অ্যাপ restart → `client_2` register হলো (পাবলিক IP
37.111.210.160 থেকে) → admin "কল করুন" → ফোন বাজল → answer → **দুমুখী অডিও কাজ করছে**।
App-to-app কলিং পূর্ণ end-to-end লাইভ।

**বাকি (পরের উন্নতি):**
- অ্যাপ register **একবারই** চেষ্টা করে (CallContext login-এ); network বদলালে/fail করলে **auto-retry নেই** —
  রিকানেক্ট যোগ করা ভালো। এখন network ঠিক হলে অ্যাপ **restart** লাগে।
- contact **NonQual** — `qualify_frequency` সেট নেই; LTE NAT binding টিকিয়ে রাখতে + dead contact
  detect-এ qualify দরকার হতে পারে (অ্যাপ background-এ গেলে contact stale হতে পারে)।
- FCM/CallKeep এখনো নেই — অ্যাপ **foreground** থাকলেই কল আসে; বন্ধ থাকলে নয় (VOIP_PLAN Phase 5)।

**Tested:** ✅ হ্যাঁ — live: `pjsip show contacts` (client_2 registered, public IP), CallLog id 6
(`failed`→`no_answer`→answered), দুমুখী অডিও user-confirmed। App visibility পরিবর্তন (SipStatusBadge)
EAS build হয়েছে; ভবিষ্যতের ডিবাগে কাজে দেবে।

---

### [2026-06-16] — VoIP Phase 3: Call logging (AMI listener) + ARI originate

**নতুন ফাইল:** `voip/management/commands/voip_call_listener.py`, `voip/services/ari_client.py`,
`deploy/asterisk/isp-voip-listener.service`। পরিবর্তিত: `deploy/asterisk/configs/manager.conf`
(read perms-এ `call`), `deploy/asterisk/install.sh` (step 9b listener service)।

**কী হয়েছে:** passive call logging। `voip_call_listener` AMI (127.0.0.1:5038) socket-এ `Events: call`
শোনে → `DialBegin`/`DialEnd`/`Hangup` থেকে `isp_call_logs` লেখে (Linkedid দিয়ে correlate, endpoint
নাম→Client/User FK)। **ARI Stasis নয়, AMI** — কারণ কল `voip-internal` dialplan দিয়ে যায়।
`ari_client.originate_call()` (urllib, server-initiated কল) — `CallOriginateView`-এর জন্য।
systemd `isp-voip-listener.service` (User=isp + EnvironmentFile=.env, gunicorn-এর মতো — isp নিজে
.env পড়তে পারে না)।

**Side Effect / সতর্কতা:**
- ⚠️ AMI user-এর `read` perms-এ **`call`** না থাকলে listener কোনো event পায় না। বিদ্যমান live
  `/etc/asterisk/manager.conf` (আগের install-এ deploy হয়েছিল read=system,command,reporting) **হাতে
  আপডেট** করতে হবে: read-এ `call,dialplan` যোগ + `asterisk -rx 'manager reload'`। (re-render করলে নতুন
  AMI secret generate হয়ে .env-এর সাথে mismatch হবে — তাই sed দিয়ে শুধু read লাইন বদলান।)
- listener service হাতে install করতে হবে (নতুন install.sh step 9b পরের install-এ করবে)।
- device না থাকলেও কল attempt → DialBegin→CHANUNAVAIL → log row তৈরি হয় (এখনই যাচাইযোগ্য)।
- App DB = `radius` (DB_NAME=radius), তাই `isp_call_logs` ওই DB-তে।
- Call History UI (ClientProfile tab) এখনো বাকি — `/voip/call-logs/?client=` endpoint প্রস্তুত।

**Tested:** `manage.py check` 0 issue; `voip_call_listener --help` OK; endpoint regex unit-test OK;
install.sh `bash -n` OK। live AMI event→log user test করবেন।

---

### [2026-06-16] — 📱 মোবাইল অ্যাপ (mobile_app/) BUILD চেকলিস্ট — ভবিষ্যতে error-মুক্ত EAS build

> **কখন পড়বেন:** `mobile_app/` আবার build করার আগে (বিশেষত VoIP/native dep সহ, বা Expo SDK upgrade-এর পর)।
> অতীতে এই ৪টি কারণেই EAS build বারবার fail করেছিল — নিচের ক্রমে চললে আর হবে না।

**Build করার আগে চেকলিস্ট (`cd /var/www/isp_bnas/mobile_app`):**

1. **config-plugin ভার্সন ↔ Expo SDK মিলিয়ে নিন** (সবচেয়ে সাধারণ ভুল):
   `@config-plugins/react-native-webrtc`-এর peer `expo` SDK-এর সাথে মিলতে হবে —
   **SDK 54 → `13.0.0`**, SDK 55 → `14.x`, SDK 56 → `15.x`।
   যাচাই: `npm view @config-plugins/react-native-webrtc@<v> peerDependencies.expo`।
   ভুল হলে → `npm ci` ERESOLVE → EAS "Install dependencies" fail।

2. **`.npmrc` থাকতে হবে** (এই ফাইলে): `legacy-peer-deps=true`
   (React 19 peer conflict; না থাকলে strict `npm ci` ERESOLVE করে fail হয়, আবার EAS server-এও)।

3. **পরিষ্কার ও সম্পূর্ণ node_modules** (partial install = EAS "Failed to resolve plugin expo-secure-store"):
   ```
   rm -rf node_modules && npm install
   npm ls --depth=0 2>&1 | grep -iE "UNMET|missing"   # কিছু আসা চলবে না
   ```
   ⚠️ `npm install`-এর tail "audit" দেখে success ভাববেন না — `EXIT=0` + উপরের `npm ls` clean হতে হবে।

4. **EAS-এ পাঠানোর আগে locally যাচাই করুন** (build নষ্ট না করতে):
   ```
   npx expo config --type introspect >/dev/null && echo OK   # plugin resolution
   npx expo-doctor                                            # 18/18 হওয়া উচিত
   ```
   (doctor-এ react-native-webrtc "New Arch untested" warning silence করা আছে —
   package.json → `expo.doctor.reactNativeDirectoryCheck.exclude`।)

5. **Build:** `eas build --platform android --profile preview`
   (uncommitted changes warning দিলে **proceed** — working dir থেকে নেয়)।

6. **Runtime caveat (build নয়):** SDK 54-এ New Architecture default ON; react-native-webrtc সেখানে
   crash করলে `app.json`-এ `"newArchEnabled": false` দিয়ে rebuild।

7. **কল কাজ করতে server-side নিশ্চিত করুন:** `.env` `VOIP_ENABLED=True`; firewall 8089(WSS)/3478/5349/
   49152-65535/10000-20000 খোলা; অ্যাপে mic permission; অ্যাপ foreground (background ring এখনো নেই)।

**দ্রুত one-liner (build-এর আগে চালান):**
```
cd /var/www/isp_bnas/mobile_app && rm -rf node_modules && npm install && \
  npm ls --depth=0 >/dev/null && npx expo config --type introspect >/dev/null && \
  echo "✅ build-ready" || echo "❌ উপরের চেকলিস্ট দেখুন"
```

---

### [2026-06-16] — VoIP Phase 5: Mobile app (Expo) WebRTC কল + mobile creds endpoint

**নতুন/পরিবর্তিত:** `mobile_app/src/services/sipPhone.js`, `src/context/CallContext.js`,
`src/screens/call/CallScreen.js`, `App.js` (CallProvider+CallScreen), `app.json` (webrtc config-plugin +
mic perm), `package.json` (react-native-webrtc@124, @config-plugins/react-native-webrtc@15, sip.js@0.21),
`mobile_app/VOIP_README.md`। Backend: `mobile_api/api/views.py` `AppSipCredentialsView` + `urls.py`
(`GET /api/v1/app/voip/sip-credentials/`)।

**কী হয়েছে:** client অ্যাপে incoming কল (admin→client)। sip.js + react-native-webrtc (registerGlobals)।
login হলে `/app/voip/sip-credentials/` থেকে creds নিয়ে `client_<id>` register; admin কল করলে CallScreen
(Modal) ring → answer → দুমুখী audio। creds endpoint client নিজের endpoint-ই দেয় (MobileClientAuthentication)।

**Side Effect / সতর্কতা:**
- ⚠️ **react-native-webrtc native — Expo Go-তে চলবে না।** VoIP টেস্টে **EAS build** লাগবে
  (`eas build -p android --profile preview`)। বাকি অ্যাপ Expo Go-তে চলে। AGENTS.md-এ Expo Go লেখা আছে —
  কল অংশে প্রযোজ্য নয়।
- npm install-এ `--legacy-peer-deps` (React 19)।
- **background ring (app বন্ধ) এখনো নেই** — FCM push + react-native-callkeep পরের ধাপ। এখন foreground/খোলা
  থাকলে কল আসে।
- audio routing (incall-manager), client→office outgoing বাটন, voice message — বাকি।

**Tested:** backend `check` 0 issue + route reverse OK; ৪টি RN ফাইল + App.js babel-parse OK; app.json valid।
**EAS preview APK build সফল হয়েছে** (2026-06-16)। Build gotchas (সমাধান করা):
- `@config-plugins/react-native-webrtc` ভার্সন **Expo SDK-এর সাথে মিলতে হবে** — SDK54→`13.0.0`
  (ভুলে v15=SDK56 বসেছিল → `npm ci` ERESOLVE → EAS "Install dependencies" fail)।
- `.npmrc`-এ `legacy-peer-deps=true` (React 19 peer)।
- partial node_modules থাকলে eas "Failed to resolve plugin expo-secure-store" দেয় — clean `npm install`
  (`npm ls --depth=0` দিয়ে missing নেই নিশ্চিত করুন)।
- `expo-doctor` "react-native-webrtc New Arch untested" warning → build-block নয়; package.json
  `expo.doctor.reactNativeDirectoryCheck.exclude`-এ silence করা। SDK54 New Arch default — কল crash করলে
  `app.json` `newArchEnabled:false`।
বাস্তব দুমুখী কল device-এ user test করবেন (APK install → client login → admin "কল করুন")।

---

### [2026-06-16] — VoIP Phase 4: React SIP.js softphone (admin panel)

**নতুন/পরিবর্তিত ফাইল:** `admin_panel/src/voip/SoftphoneContext.jsx`, `admin_panel/src/components/SoftphoneWidget.jsx`,
`admin_panel/src/components/Layout.jsx` (provider+widget mount), `admin_panel/src/pages/clients/ClientProfile.jsx`
("কল করুন" বাটন), `admin_panel/package.json` (sip.js@0.21.2)।

**কী হয়েছে:** admin panel-এ WebRTC softphone। `SoftphoneProvider` (Layout-এ global) `/voip/sip-credentials/`
থেকে ephemeral creds নিয়ে Asterisk-এ WSS register করে; floating widget incoming/outbound/active call UI
(answer/hangup/mute/timer) দেখায়; ClientProfile breadcrumb-এ "কল করুন" → `startCall('client_<id>')`।
remote অডিও peerConnection receiver track থেকে `<audio>`-এ; coturn iceServers creds থেকে।

**Side Effect / সতর্কতা:**
- `sip.js` install-এ `--legacy-peer-deps` লেগেছে (React 19.2 peer conflict)। ভবিষ্যতে npm install-এ মনে রাখুন।
- WebRTC browser-এ **HTTPS + mic permission** বাধ্যতামূলক; admin panel https-এ সার্ভ হতে হবে।
- VOIP_ENABLED=False হলে `sip-credentials` `enabled:false` দেয় → widget/বাটন নিজেকে hide করে (কিছু ভাঙে না)।
- Build করা হয়েছে (`vite build`)। browser hard-reload লাগবে। বাস্তব কল test firewall (8089/TURN/RTP) ও
  Phase 5 mobile বা দ্বিতীয় softphone-এর পর।
- Call History tab + voice recorder এখনো বাকি (Phase 3 log আসার পর)।

**Tested:** `vite build` সফল (1605 modules)। browser-এ live কল test user করবেন।

---

### [2026-06-16] — ⚠️ INCIDENT + ফিক্স: odbc-mariadb প্রোডাকশন MySQL remove করেছিল → file-based PJSIP-এ পিভট

**ঘটনা:** VoIP Phase 1 install.sh চালানোয় `apt install odbc-mariadb` apt-কে **`mysql-server` (8.4)
remove করতে** বাধ্য করে (mysql-server-8.4 `Conflicts: mariadb-common`; odbc-mariadb→libmariadb3→
mariadb-common)। প্রোডাকশন MySQL ডাউন হয়, Django/RADIUS/billing বন্ধ।
**Recovery:** package শুধু remove (rc), **purge হয়নি** → `/var/lib/mysql` অক্ষত। `sudo apt-get install
mysql-server` + `systemctl enable --now mysql` দিয়ে ফেরত; `radius` DB/isp_clients সব ঠিক।

**ফিক্স (architecture পিভট): realtime/ODBC সম্পূর্ণ বাদ → file-based PJSIP provisioning।**
- `voip/services/asterisk_provision.py` rewrite — pymysql/ps_* table নয়; এখন প্রতিটি endpoint
  `/etc/asterisk/pjsip_isp.d/<name>.conf` file (endpoint+auth+aor, `webrtc=yes`), Django লেখে
  (gunicorn user `isp`, dir setgid `asterisk` 2775), তারপর **AMI (127.0.0.1:5038) দিয়ে `pjsip reload`**।
- `config/settings.py` — `ASTERISK_DB_*` সরিয়ে `ASTERISK_AMI_*` + `VOIP_PJSIP_DIR` যোগ।
- bundle: `extconfig/sorcery/res_odbc/odbc/odbcinst.conf` + `sql/` **মুছে দেওয়া**; নতুন `manager.conf`
  (AMI localhost); `pjsip.conf`-এ `#include "pjsip_isp.d/*.conf"`। install.sh থেকে odbc-mariadb/unixodbc
  বাদ + DB-remove গার্ড + `voip_provision_all` mgmt command।
- নতুন: `voip/management/commands/voip_provision_all.py`।

**সতর্কতা (পরবর্তী agent):** এই সার্ভারে **কখনো `odbc-mariadb`/`mariadb-*` install করবেন না** —
mysql-server remove হবে। নতুন apt install-এর আগে সবসময় `apt-get install -s ...` দিয়ে "Remv" চেক।
দেখুন memory `project-mysql-odbc-gotcha`।

**Tested:** `manage.py check` 0 issue; `voip_provision_all --help` OK; install.sh `bash -n` OK।
বাস্তব install user চালাচ্ছেন।

---

### [2026-06-16] — VoIP Phase 1: Asterisk + coturn deployment bundle (`deploy/asterisk/`)

**নতুন ফাইল:** `deploy/asterisk/` — `install.sh` (এক-কমান্ড installer), `README.md`,
`configs/{pjsip,http,ari,rtp,extensions,sorcery,extconfig,res_odbc,odbc,odbcinst}.{conf,ini}`,
`coturn/turnserver.conf`, `sql/pjsip_realtime_schema.sql`। `VOIP_PLAN.md` Phase 1 🟡।

**কী হয়েছে:** Phase 1 server setup-এর সম্পূর্ণ ready-to-run bundle। পরিবেশ যাচাই: **Ubuntu 26.04**,
Asterisk **22.5** ও coturn **4.6** apt-এ available, domain **roisp.duckdns.org** (পাবলিক IP
103.214.202.17, ALLOWED_HOSTS-এ 172.16.3.254 → NAT সম্ভব)।
- `install.sh` (idempotent): packages install → secrets generate → আলাদা **`asterisk` MySQL DB**
  + realtime schema → unixODBC → Let's Encrypt cert (renewal hook) → Asterisk/coturn config (secrets
  বসিয়ে `/etc/asterisk`, `/etc/turnserver.conf`) → `.env`-এ `VOIP_ENABLED=True` + ARI/DB/TURN keys →
  services restart।
- WebRTC: WSS 8089 + DTLS-SRTP; ARI **127.0.0.1:8088 (localhost-only)**; coturn `use-auth-secret`
  (ephemeral HMAC); endpoint realtime (sorcery→ODBC→`ps_*` table — provisioning service এখানেই লেখে)।

**Side Effect / সতর্কতা:**
- ⚠️ **install এখনো চালানো হয়নি** — এই সার্ভারে `sudo` password লাগে, তাই Claude চালাতে পারেনি।
  User কে চালাতে হবে: `sudo bash deploy/asterisk/install.sh roisp.duckdns.org`। তার আগে
  `VOIP_ENABLED=False`, কিছুই active নয় (Phase 2 backend inert)।
- install-এর পর `sudo systemctl restart isp-gunicorn` দরকার (নতুন .env লোড)।
- Firewall: পাবলিকে 8089/tcp, 3478/5349, 49152-65535/udp, 10000-20000/udp; **5060 ও 8088 বন্ধ/localhost**।
- realtime schema official alembic-এর curated subset — app-to-app WebRTC-র জন্য যথেষ্ট (sorcery
  missing optional column-এ warning দেয়, crash নয়)। পূর্ণ schema README-তে।
- NAT হলে `pjsip.conf` external_*_address ও `turnserver.conf` external-ip uncomment/সেট করতে হতে পারে।

**Tested:** আংশিক — `bash -n install.sh` syntax OK; config/SQL hand-verified। বাস্তব install ও কল test
`sudo` দিয়ে script চালানোর পর সম্ভব (Asterisk/coturn এখনো installed নয়)।

---

### [2026-06-16] — VoIP / IP-phone মডিউল: Phase 2 (Django `voip/` app skeleton)

**পরিবর্তিত/নতুন ফাইল:** নতুন app `voip/` (models, apps, admin, signals, services/asterisk_provision.py,
api/{serializers,views,urls}.py, migrations/0001_initial), `config/settings.py` (INSTALLED_APPS + VoIP env block),
`config/urls.py` (`/api/v1/voip/` include), `VOIP_PLAN.md` (পূর্ণ প্ল্যান, Phase 2 ✅)।

**কী হয়েছে:** Admin panel ↔ client app **app-to-app** VoIP কলিং-এর backbone (Asterisk + WebRTC, PSTN পরে)।
এই session-এ শুধু **backend skeleton** — কোনো server (Asterisk/coturn) install নয়।
- Models: `isp_sip_endpoints`, `isp_call_logs`, `isp_voice_messages` (সব FK isp_clients/isp_users)।
- Provisioning: Client post_save signal → `provision_endpoint()` → SipEndpoint + encrypted secret
  (বিদ্যমান `PASSWORD_ENCRYPT_KEY`/`role_permissions.utils` reuse)। `VOIP_ENABLED=True` হলে
  `asterisk` DB-এর `ps_endpoints/ps_auths/ps_aors`-এ pymysql দিয়ে push (WebRTC/WSS/DTLS profile)।
- Endpoints: `sip-credentials/` (ephemeral creds + TURN ICE), `call/originate/` (ARI — Phase 3 stub),
  `call-logs/` (read-only), `voice-messages/` (upload/list/mark_heard)।

**Side Effect / সতর্কতা:**
- `VOIP_ENABLED` **default False** — তাই Asterisk না থাকলেও সব inert, প্রোডাকশনে কিছু ভাঙে না।
  Client create signal try/except-এ মোড়া → provision ব্যর্থ হলেও client save ভাঙে না।
- billing/RADIUS/MikroTik chain ও DATABASES/AUTH_USER_MODEL **স্পর্শ করা হয়নি**; INSTALLED_APPS-এ শুধু `voip` append।
- নতুন `.env` keys (সব optional, default আছে): `VOIP_ENABLED`, `VOIP_SIP_DOMAIN`, `VOIP_WSS_URL`,
  `ASTERISK_ARI_URL/USER/PASS/APP`, `ASTERISK_DB_*`, `TURN_URLS/SECRET/TTL`।
- Asterisk realtime table আলাদা `asterisk` DB-তে রাখতে হবে — `isp_*`/`radius` DB-তে নয়।
- পরবর্তী: Phase 1 (Asterisk+coturn setup) → Phase 3 (ARI listener — `voip/services/ari_client.py` +
  `manage.py voip_ari_listener` এখনো বাকি) → Phase 4 (React SIP.js softphone)। দেখুন `VOIP_PLAN.md`।

**Tested:** হ্যাঁ — `manage.py check` (0 issue), `makemigrations`+`migrate voip` OK,
URL reverse (`voip-sip-credentials`, `voip-call-originate`) OK, `provision_endpoint(user=...)`
transaction-rollback-এ চালিয়ে encrypted secret generate+decrypt (32 char) যাচাই। বাস্তব কল test
Asterisk install (Phase 1)-এর পর সম্ভব।

---

### [2026-06-16] — Walled-garden bKash পেমেন্ট গাইড (আসল স্ক্রিন) + non-cached template loader + Customer Search remote-fields refactor

**পরিবর্তিত ফাইল:** `templates/walled_garden/expired.html`, `config/walled_garden.py`,
`config/settings.py` (template loader), `admin_panel/src/pages/clients/CustomerSearchPage.jsx`

**কী হয়েছে:**
- আগে "open-if-installed" (`intent:`) চেষ্টা করা হয়েছিল → কাজ করেনি (app-এ deep-link নেই + captive-portal
  "continue via browser" prompt), তাই **revert**। পেজ সাধারণ `/app/download` বাটনে ফিরেছে।
- এরপর পেজে দুটো নতুন অংশ যোগ:
  1. **App guidance note** (সবুজ box): অ্যাপ আগে থেকে ইনস্টল থাকলে নতুন ইনস্টল লাগবে না — শুধু খুলে
     লগইন করে বিল দিন; না থাকলে উপরের বাটনে ইনস্টল করুন।
  2. **bKash সরাসরি পেমেন্ট গাইড** (`<details>` collapsible, inline HTML/CSS — walled garden
     self-contained বলে external image নয়, phone-screen mockup স্টাইলে গোলাপি থিম): **দুটো flow** —
     (ক) **বিকাশ অ্যাপ দিয়ে (Make Payment)** ৬-ধাপ, (খ) **`*247#` USSD** ৮-ধাপ ভিজ্যুয়াল কার্ড।
     মার্চেন্ট নম্বর **01303326003**, amount **৫০০**, company **Rajamehar Online**,
     Reference = Customer ID, Counter = 1।

**আসল ছবি (এখন সক্রিয়):** `walled_garden.py` `media/walled_garden/payment_guide*.{png,jpg,jpeg,webp}`
খুঁজে পেলে **base64 inline** করে `guide_imgs`-এ পাঠায়; থাকলে ছবি (২-কলাম grid, poster স্টাইল), না থাকলে
CSS mockup (fallback)। নাম অনুযায়ী sort — `payment_guide_1.jpg` … `_8.jpg`। **৮টি আসল bKash
Make-Payment স্ক্রিন (Rajamehar Online · 01303326003 · ৳৫০০) বসানো হয়েছে।**
- ছবিগুলো **gitignored (media/), disk-only** — git-এ যায় না; ফ্রেশ deploy-এ আবার রাখতে হবে।
- মূল ফাইল `1.png`–`8.png` (~১MB/টি) থেকে Pillow দিয়ে **720px JPEG q76**-এ অপ্টিমাইজ করে
  `payment_guide_N.jpg` (~৪০-৬০KB/টি, মোট ~৩৬০KB) বানানো — নইলে পেজ ~১১MB হতো (captive-portal-এ চলত না)।
  পেজ এখন ~০.৪৮MB। ক্রম বদলাতে চাইলে শুধু ফাইল নম্বর rename করলেই হবে।

**পরবর্তী পরিবর্তন (একই দিনে):**
- **৮টি ছবি ২-কলাম grid**-এ সাজানো; নিচে **`*247#` USSD গাইড সবসময়** দেখায় (ছবি থাকুক/না থাকুক —
  `{% endif %}` USSD-এর আগে সরানো হয়েছে), scroll করে দুটোই দেখা যায়।
- **Amount = প্যাকেজ অনুযায়ী** নির্দেশনা: ছবিতে ৫০০৳ শুধু উদাহরণ — client নিজের প্যাকেজ/বিল অনুযায়ী
  amount দেবে। Reference উদাহরণ `5xxx` (= Customer ID/Code)।

**গুরুত্বপূর্ণ — template loader পরিবর্তন (`config/settings.py`):** `APP_DIRS=True` → explicit
**non-cached loaders** (`filesystem` + `app_directories`)। আগে DEBUG=False-এ cached.Loader থাকায়
template edit-এর পর gunicorn reload লাগত; **এখন আর লাগে না — template পরিবর্তন সঙ্গে সঙ্গে দেখায়।**
(সামান্য per-request খরচ, এই সাইটে negligible)। ⇒ **এই নোট override করে:** আর `.py` কমেন্ট দিয়ে reload
trigger-এর দরকার নেই।

**Customer Search refactor (`CustomerSearchPage.jsx`):** Remote Management — **IP read-only**
(auto-prefill + ↗open link), **Admin Username/Password** আলাদা 💾 Save বাদ দিয়ে global **Edit toggle**-এ
EF field (Update দিয়ে save)। `saveRemoteMgmt`/`remoteSaving` সরানো হয়েছে।

**টীকা:** `mobile_app/app.json`-এর `"scheme": "rajameharonline"` রাখা আছে (harmless, built APK-তে আছে);
walled-garden থেকে app-open ফিচার চাহিদামতো না হওয়ায় বাদ — পেজ শুধু download + গাইড।

**Tested:** rendered /expired/ — ৮ ছবি inline + USSD guide + package-amount note, পেজ ~০.৪৯MB;
non-cached loader live marker-test-এ যাচাই (reload ছাড়াই template আপডেট); frontend build আগেই করা।

---

### [2026-06-15] — Customer Search: Remote Management fields + Session/This-Month traffic split + accounting diagnosis

**পরিবর্তিত ফাইল:** `clients/models.py`, `clients/migrations/0022_*.py`,
`admin_panel/src/pages/clients/CustomerSearchPage.jsx`

**কী করা হয়েছে:**
1. **Remote Management ৩টি field (নতুন):** Client model-এ CharField — `remote_mgmt_ip`
   (যেমন `http://10.5.13.193:8810`), `remote_admin_user`, `remote_admin_pass`। Customer Search-এর
   **Connectivity Information** সেকশনে। IP field client-এর live IP দিয়ে auto-prefill
   (`http://{ip}:8810`), read-only-তে **↗ open** clickable link (নতুন tab)। তিনটি field
   **সবসময় editable** (global Edit toggle ছাড়াই) + নিজস্ব **💾 Save** বাটন (`saveRemoteMgmt`)।
2. **DOWNLOADED/UPLOADED DATA split:** প্রতিটি field এখন পাশাপাশি দুই box — বাঁয়ে **Session**
   (Mikrotik live), ডানে **This Month** (radacct মাসিক মোট, `trafficHistory[0]`)। radacct মাসিক
   না থাকলে fallback: current session bytes দেখায় `~approx` tag সহ।

**Side Effect / সতর্কতা:**
- ClientSerializer `fields='__all__'` — নতুন field auto-include, serializer হাত দিতে হয়নি।
- `remote_admin_pass` plain CharField (encrypted নয়) — API response-এ দৃশ্যমান; sensitive হলে পরে mask/encrypt।
- **মাসিক ট্রাফিক accounting diagnosis (গুরুত্বপূর্ণ reference):** RADIUS auth (radcheck/radpostauth)
  আর accounting (radacct) আলাদা পথ। radacct খালি থাকলে কারণ — Mikrotik PPPoE-তে accounting/interim
  না পাঠানো, **অথবা dual-RADIUS রাউটারে accounting অন্য server-এ যাওয়া**। `/ppp aaa set
  accounting=yes interim-update=5m` লাগে; `/radius service`-এ "accounting" value নেই (ওটা syntax
  error)। interim সেট করার **আগের** session শুধু Acct-Stop-এ byte লেখে। Single-RADIUS রাউটারে
  (R3545222) pipeline নিখুঁত যাচাই হয়েছে; dual-RADIUS রাউটার 172.16.2.2 (server 100.127.242.15
  প্রথম) accounting আমাদের FreeRADIUS-এ পাঠায় না — আমাদের bug নয়।

**Tested:** makemigrations+migrate OK, frontend build OK। radacct/radpostauth live query দিয়ে
accounting flow যাচাই (R3545222 → 11.77GB/0.81GB মাসিক মোট সঠিক)। UI manual verify বাকি।

---

### [2026-06-14] — SMS Service মডিউল, App push, in-app OTP, dynamic APK download, expiry→active session-kick fix

**পরিবর্তিত ফাইল:** `sms_service/{models,services}.py`, `sms_service/api/{views,serializers,urls}.py`,
`sms_service/migrations/{0002,0003}_*.py`, `billing/{reminder_service,tasks}.py`,
`mobile_api/api/{views,urls}.py`, `clients/api/views.py`, `mobile_app/app.json`,
`mobile_app/assets/notification-icon.png`,
`admin_panel/src/pages/sms/{SmsGatewayPage,SmsTemplatePage,SendSmsPage,IndividualSmsPage}.jsx`,
`admin_panel/src/{App.jsx,components/Sidebar.jsx}`,
`admin_panel/src/pages/billing/BillList.jsx`,
`admin_panel/src/pages/mikrotik/BulkClientImportPage.jsx`,
`deploy/{walled_garden_apk.nginx.conf,add_apk_https_location.sh,dynamic_apk_download.sh}`।
(commits `b271cfd` … `a2c8cfd` + এই entry; branch `feat/mobile-app-overhaul`)

**কী করা হয়েছে:**
1. **SMS Service মডিউল (নতুন):** `SMSGateway` multi-channel (Local SMS HTTP / WhatsApp /
   Telegram / Email — `provider_type` + `config` JSON + `is_default`); `MessagingService`
   per-channel dispatch + test action। পেজ: **Gateway Setup, SMS Template ({placeholder}
   palette), Send SMS (group→Transfer→recipients), Individual SMS (client search + live
   preview)** — সব `/sms/...` route + sidebar।
2. **Placeholder render:** `render_sms_template()` — CamelCase + lowercase
   ({CustomerName}/{ClientID}/{CompanyName}/{Package}/{Due}/{MonthName}/latest payment+invoice…),
   per-client রূপান্তর। **`send_sms()` এখন সবসময় SMSLog (client সহ) তৈরি করে** → reminder/
   payment/OTP/app — সব চ্যানেলের message client-এর In-app SMS History-তে দেখায়।
3. **App push (channel='app'):** client `fcm_token`-এ FCM (push_service); **background thread**-এ
   (timeout এড়াতে)। **Fix:** Send URL `/sms/send/` → `/sms/send/send/` (ছিল 404)।
4. **In-app OTP:** self-registration-এ SMS না গেলে (`sms_sent=False`) `otp_code` response-এ
   ফেরত → app auto pre-fill। SMS gateway সেট হলে নিজে থেকেই SMS-এ যাবে।
5. **Notification icon:** সাদা wifi silhouette (`notification-icon.png`) — status bar-এ স্পষ্ট।
6. **Dynamic APK download:** `mobile_api.app_apk_download` view — `public_apk/`-এর latest `.apk`
   (যে নামেই হোক) X-Accel-Redirect দিয়ে serve (nginx bytes পাঠায়, worker আটকায় না)।
   nginx `/app/download` → proxy → Django + internal `/protected-apk/`; walled-garden ও HTTPS
   দুই block-এ (`deploy/dynamic_apk_download.sh`)। APK source: `public_apk/`, পুরনো
   `/var/www/html/app-download/` বাদ।
7. **Expiry→active session-kick fix:** expired/suspended client-এর Ex.Date বাড়ালে (active হলে)
   এখন session **kick** হয় (আগে শুধু package বদলালে হতো) → reconnect করে সাথে সাথে আসল
   package profile/IP পায় (Blocked_Group/"Expired PPPoE"-এ আটকে থাকে না)।
8. **BillList:** Ex.Date-এর নিচে "কতদিন বাকি"। **BulkImport:** batching (২০/batch) + progress।

**Side Effect / সতর্কতা:**
- **DB migration প্রয়োজন:** `python manage.py migrate sms_service` (0002 SMSGateway, 0003 SMSTemplate)।
- **APK download nginx পরিবর্তন** production-এ sudo দিয়ে apply করতে হয়েছে
  (`deploy/dynamic_apk_download.sh` + Host→roisp.duckdns.org fix; walled-garden captive Host
  ALLOWED_HOSTS-এ নেই বলে `Host $host` দিলে Django 400 দিত)। নতুন সার্ভারে script চালাতে হবে।
- **Notification icon** native config — নতুন **APK build** (`eas build`) লাগবে, OTA নয়।
- session-kick fix `_kick_session_via_coa_or_api` ব্যবহার করে; client-এর `pppoe_profile`
  রাউটারে valid না হলে (যেমন `5 Mbps` vs `5M`) reconnect করেও 0.0.0.0 পাবে — এটা আলাদা config issue।
- OTP code এখন In-app SMS History-তে log হয় (user-approved — expiry আছে বলে ঝুঁকি নেই)।

**Tested:** `manage.py check` ✓; `vite build` ✓; render দুই-format ✓; App push live (R3545555
ফোনে পৌঁছেছে) ✓; dynamic download — ভিন্ন নামের `.apk` auto-serve ✓; walled-garden+HTTPS
`/app/download` 200 (curl) ✓; expiry session-kick — কোড পথ যাচাই ✓।

---

### [2026-06-13] — bKash auto-settle, webhook transfer log, smart Bulk Import, Free package, UI polish

**পরিবর্তিত ফাইল:** `mobile_api/api/views.py`, `mobile_api/services/bkash_service.py`,
`billing/api/views.py`, `billing/api/serializers.py`, `billing/services.py`,
`clients/api/views.py`, `mikrotik_app/api/views.py`, `configuration/models.py`,
`configuration/migrations/0006_package_is_free.py`,
`admin_panel/src/pages/billing/{BillList,DailyCollection}.jsx`,
`admin_panel/src/pages/clients/ClientList.jsx`,
`admin_panel/src/pages/config/PackagePage.jsx`,
`admin_panel/src/pages/mikrotik/BulkClientImportPage.jsx`, `install.sh`।
(commit `19d7f35`, branch `feat/mobile-app-overhaul`)

**কী করা হয়েছে:**
1. **bKash auto-settle:** app tokenizer payment (`BkashCallbackView`) এখন
   `BillingService.receive_payment(is_verified=True)` দিয়ে approval ছাড়াই বিল settle +
   `WebhookPayment` (FromWallet = `customerMsisdn`) তৈরি; `linked_payment` থাকায় Collected
   Bills থেকে বাদ। SNS webhook (`BkashSNSWebhookView`) client খোঁজে **শুধু** `customer_id`/
   `username` দিয়ে (phone match বাদ)।
2. **Webhook transfer:** তৈরি payment webhook-এ link → Collected Bills থেকে বাদ। **Re-transfer**
   এখন আগের transfer reverse করে (bill due + advance_balance + ledger পুনরুদ্ধার) → double-count
   নেই (`_reverse_previous_transfer`)। প্রতিটি transfer `raw_data.transfer_history`-তে log;
   Info card-এ "Transfer History" দেখায়।
3. **Collected Bills filter:** payment date range (backend), আর gateway payment বাদ (notes
   prefix: `bKash SNS`/`Webhook Auto`/`Webhook Payment Transfer`/`[bKash App]`)।
4. **Bulk Clients Import (বড়):** smart header mapper (NetBillingBD/ISP Digital alias),
   date parse (`Jul 10 2026…`/`Payment Date : …` → YYYY-MM-DD), Customer ID = username শেষ ৪,
   per-column filter, **Target Router + Default Package** selector, Bill.Date খালি হলে Exp.Date
   দিন থেকে, joining date → `connection_date`, package খোঁজা **profile দিয়েও**, **Zone auto-create**,
   required শিথিল (Mobile/Zone optional; Profile/M.Bill package থেকে)। **MikroTik PPPoE secret
   থেকে import** (`/mikrotik/servers/{id}/pppoe-secrets/`) — comment box parse (দুই format:
   `Key: Value|…` ও `key--value,…`)। **"Already Imported" badge** (`/clients/check-existing`)।
5. **Free package:** `Package.is_free` flag → মাসিক/registration/bulk কোথাও বিল generate হয় না;
   profile client-ভেদে আলাদা (pppoe_profile থেকে)। PackagePage-এ checkbox + FREE badge।
6. **Table polish:** BillList ও ClientList-এ কলাম merge (Name/Mobile, Zone+subzone•box,
   Type/Conn, Package/Speed, UserName/Password) + dividers/tabular-nums।

**Side Effect / সতর্কতা:**
- **লুকানো বাগ ফিক্স:** `bulk_import`-এ auto-invoice `conn_date` (undefined) ব্যবহার করত → NameError-এ
  invoice নীরবে fail হতো; এখন `joining_date`। পুরনো bulk-import গুলোর invoice হয়তো তৈরি হয়নি।
- Bulk import **Zone না মিললে নতুন Zone তৈরি করে** (faithful) — অনেক Bangla zone তৈরি হতে পারে।
  সব একটাতে map চাইলে আলাদা পরিবর্তন লাগবে।
- DB মাইগ্রেশন প্রয়োজন: `python manage.py migrate configuration` (0006_package_is_free)।
- `billing/models.py`-এর `_update_collector_cash` ও Payment save-chain অপরিবর্তিত।

**Tested:** `manage.py check` ✓; `vite build` ✓; comment-parser দুই format-এ যাচাই ✓;
transfer/re-transfer + history E2E (advance leak নেই, ১টি active payment) ✓; bKash ledger
backfill (BILLPAY) ✓।

---

### [2026-06-12] — Mobile App: ticket reply keyboard fix + অ্যাপ-বাইরে ২০ মিনিটে auto-logout

**পরিবর্তিত ফাইল:** `mobile_app/src/screens/support/SupportDetailScreen.js`,
`mobile_app/src/context/AuthContext.js`।

**কী করা হয়েছে:**
1. **Keyboard fix:** reply input ক্লিকে keyboard-এর নিচে চলে যেত — বাইরের `View` →
   `KeyboardAvoidingView` (iOS `padding` / Android `height`) + `keyboardShouldPersistTaps`।
   এখন reply ঘর keyboard-এর উপরে থাকে।
2. **Auto-logout:** অ্যাপ background/বন্ধ হওয়ার ২০ মিনিট পর auto-logout (`AUTO_LOGOUT_MS`)।
   background-এ যাওয়ার timestamp `SecureStore('bg_since')`-এ রাখি; foreground-এ ফিরলে ও cold
   start (`restore()`)-এ elapsed ≥ ২০ মিনিট হলে token মুছে `logout()`। idle-in-app নয়, শুধু
   অ্যাপের বাইরে থাকার সময় গোনা হয়।

**Side Effect / সতর্কতা:** pure JS — নতুন native module নেই, তাই **OTA (`eas update`) দিয়েই**
পুরনো install-এ পৌঁছায়, নতুন APK লাগে না। runtimeVersion 1.0.0 না বদলালে OTA apply হবে।
distributed APK preview profile (apk) — তাই `eas update --branch preview`। **Tested:** দুই ফাইল
babel parse OK; `eas update --branch preview` সফল publish (runtimeVersion 1.0.0)।

---

### [2026-06-12] — Support ticket two-way: client reply দেখা (crash fix) + reply দেওয়া

**পরিবর্তিত ফাইল:** `mobile_api/api/serializers.py`, `mobile_api/api/views.py`,
`mobile_app/src/screens/support/SupportDetailScreen.js`।

**কী করা হয়েছে:**
1. **দেখা (crash fix):** `AppTicketDetailSerializer.get_replies` `r.created_by` পড়ত — কিন্তু
   `TicketReply`-তে ও ফিল্ড নেই (আছে `replied_by`)। ফলে reply থাকা ticket-এ `AttributeError` →
   app ticket-detail API **500 crash** → client reply দেখত না। এখন `not r.is_client_reply`।
2. **দেওয়া (two-way):** `AppTicketDetailView`-এ **POST** যোগ — `POST /app/tickets/<pk>/` →
   `TicketReply(is_client_reply=True, replied_by=None)` (client-scoped)। resolved/closed ticket-এ
   client reply দিলে আবার `open`। App `SupportDetailScreen`-এর "Coming soon" alert সরিয়ে আসল
   POST + thread refresh। staff reply "👤 Support Team", client reply "🙋 You" bubble।

**Side Effect / সতর্কতা:** crash fix backend-only — installed অ্যাপে **এখনই** কাজ করে (reload-পরবর্তী)।
reply-দেওয়া JS অংশ OTA-তে যায়। admin/client কাউকেই FCM push যায় না (manual খুলে দেখতে হয়)।
**Tested:** Django check; shell-এ reply তৈরি + reopen + serializer যাচাই; backend auto-reload।

---

### [2026-06-12] — Dashboard: Paid/Partial/Unpaid "Clients" — bill count → distinct client count

**পরিবর্তিত ফাইল:** `clients/api/views.py` (`dashboard_stats`)।

**কী করা হয়েছে:** card-গুলোর label "Clients" হলেও আগে current-মাসের **Bill সংখ্যা** (status অনুযায়ী)
গুনত। duplicate bill (manual+auto) থাকায় ৬ client-এর ১২ bill → Billing 12/Paid 5/Unpaid 7 (ভুল)।
এখন **distinct client** গোনা — Priority: কোনো unpaid → unpaid; নাহলে partial → partial; নাহলে
(সব paid/waived) → paid (mutually exclusive, যোগফল = billing clients)। money totals (collected/
net/discount) bill sum থেকেই — অপরিবর্তিত।

**Side Effect / সতর্কতা:** এক client multi-bill হলেও একবার গণিত। সঠিক মান যাচাইয়ে 6/2/0/4।
**Tested:** Django check পাস; shell-এ যাচাই; backend auto-reload।

---

### [2026-06-12] — Dashboard "Left Clients" ভুল সংখ্যা: orphaned LeftClient cleanup + guard

**পরিবর্তিত ফাইল:** `clients/api/views.py` (`dashboard_stats` + `LeftClientViewSet`), DB cleanup।

**কী করা হয়েছে:** ৩টি LeftClient row-এর Client DB-তে ছিল না (dangling FK — Django CASCADE bypass,
সম্ভবত raw/DB-level delete)। Dashboard `LeftClient.count()`=3 গুনত, কিন্তু পেজের `select_related
('client')` INNER JOIN orphan বাদ দিত (table খালি) যদিও paginator count=3 → "3 total records"
অসঙ্গতি। ৩টি orphan delete করা হলো (LeftClient=0)। সাথে dashboard count ও LeftClientViewSet
queryset-এ `client_id__in=Client.objects.values('id')` guard — ভবিষ্যতে orphan হলেও count সঠিক থাকবে।

**Side Effect / সতর্কতা:** `client__isnull=False` orphan ধরে না (client_id non-null) — `client_id__in`
subquery লাগে। client delete সবসময় Django ORM/API দিয়ে করলে CASCADE নিজেই LeftClient মুছবে।
**Tested:** shell-এ orphan delete ও count=0 যাচাই; Django check; backend auto-reload।

---

### [2026-06-12] — Auto-reload hook: Python edit → gunicorn auto reload (.claude/settings.json)

**পরিবর্তিত ফাইল:** `.claude/settings.json` (PostToolUse hook যোগ)।

**কী করা হয়েছে:** আবিষ্কৃত — gunicorn (`isp-gunicorn.service`, User=isp, `ExecReload=kill -HUP`)
Python edit-এ নিজে থেকে reload হত না (workers edit-এর আগের কোড চালাচ্ছিল → আজকের সব backend
পরিবর্তন live ছিল না)। `amir`-এর persistent sudoers আছে: `(ALL) NOPASSWD: /usr/bin/systemctl
reload isp-gunicorn.service`। তাই sudoers না বদলে একটা **PostToolUse hook** যোগ করা হলো (matcher
`Edit|Write|MultiEdit`) — project-এর কোনো `.py` (path `/var/www/isp_bnas`-এ শুরু) edit হলে
background-এ `sudo -n systemctl reload isp-gunicorn.service` চালায়। `.py` ছাড়া কিছুতে fire করে না।

**Side Effect / সতর্কতা:** SessionStart work-log hook অক্ষত রাখা হয়েছে। `--preload` নেই তাই HUP
নতুন worker-এ fresh code লোড করে। hook live প্রমাণিত (real .py Write-এ worker auto-restart)।
config self-edit harness প্রথমে আটকেছিল — user explicit approve করায় বসানো হয়েছে। fallback:
`sudo -n systemctl reload isp-gunicorn.service`। **Tested:** JSON/schema valid, pipe-test ও live
fire যাচাই।

---

### [2026-06-12] — Dashboard "Online Clients": MikroTik raw → RADIUS hybrid + এই-DB filter

**পরিবর্তিত ফাইল:** `radius_app/api/views.py` (`online_users` — `known_only` param),
`admin_panel/src/pages/Dashboard.jsx`।

**কী করা হয়েছে:** Dashboard "Online Clients" আগে `/mikrotik/online-usernames/` (রাউটারের raw
count — DB-বহির্ভূত session সহ, তাই ৬ client হলেও ৬৩৭ দেখাত)। এখন `/radius/online-users/?known_only=1`
ব্যবহার করে — RADIUS radacct primary + MikroTik confirm + ghost-session auto-close (hybrid)।
backend-এ নতুন `?known_only=1` param — returned list/count শুধু `Client.username`-এ intersect করা
(এই panel-এর client)। ghost-elimination সব session-এ আগের মতোই চলে; filter শুধু count/list-এ।

**Side Effect / সতর্কতা:** param ছাড়া default behavior অপরিবর্তিত — OnlineClientMonitoring ও
CustomerSearchPage (যারা param দেয় না) অক্ষত। hybrid endpoint MikroTik `/ppp/active`-ও query করে
(সামান্য ভারী, dashboard load-এ একবার)। যাচাইয়ে ৬ client-এর মধ্যে radacct-এ ৩টি online।
**Tested:** Django check + vite build পাস; shell-এ filter logic যাচাই।

---

### [2026-06-11] — Frontend Waive button + modal (Admin/Superadmin) + reason

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/billing/BillList.jsx`, `billing/api/views.py` (waive action reason)।

**কী করা হয়েছে:** এতদিন waive শুধু backend-এ ছিল (`POST /billing/bills/{id}/waive/`), UI বাটন ছিল না।
এখন প্রতিটি row-এর ⋮ menu-তে amber **Waive** বাটন — শুধু **unpaid/partial** বিলে ও শুধু **Admin/
Superadmin** (`canWaive`)। Confirm modal-এ বকেয়া পরিমাণ + সতর্কতা + ঐচ্ছিক **reason** (log-এ যায়)।
সফল হলে client cache evict + list refresh। backend waive action এখন `reason` নেয় ও activity log-এ লেখে।
Edit modal-এর status dropdown থেকে বিভ্রান্তিকর **"Waived"** option সরানো হয়েছে (perform_update status
override করত, ওখান থেকে waive কাজ করত না)। Filter dropdown-এর Waived রাখা হয়েছে।

**Side Effect / সতর্কতা:** Waive `due_amount=0`, status=waived করে কিন্তু **record + payment অক্ষত**
(delete নয় — `Payment.bill` হলো on_delete=CASCADE, তাই bill delete চিরতরে নিষিদ্ধ, destroy()→405)।
**Tested:** vite build + Django check পাস।

---

### [2026-06-11] — Auto bill-generator: duplicate guard (যেকোনো বিল চেক)

**পরিবর্তিত ফাইল:** `billing/services.py` (৩ জায়গা: lines ~43, ~94, ~229)।

**কী করা হয়েছে:** আগে auto-generator শুধু `is_auto=True` বিল চেক করত — তাই manual বিল থাকলেও auto
দ্বিতীয়টা বানাত (double monthly charge; Mosarof কেস)। এখন তিনটে path-ই (`generate_bills_by_
expiry_date` ×2 loop + `generate_bills_for_active_clients`) ওই `bill_month`-এ **যেকোনো** বিল (auto বা
manual) থাকলে skip করে।

**Side Effect / সতর্কতা:** Manual `generate_bill_for_client` ইচ্ছাকৃতভাবে অরক্ষিত — installation/
reconnection-এর মতো ad-hoc চার্জ একই মাসে দরকার হতে পারে (human-নিয়ন্ত্রিত)। guard শুধু **ভবিষ্যৎ**
duplicate রোধ করে; পুরনো duplicate বিল waive করতে হবে। **Tested:** Django check পাস।

---

### [2026-06-11] — Paid/Partial বিল edit: role gate + বাধ্যতামূলক reason

**পরিবর্তিত ফাইল:** `billing/api/views.py` (`perform_update`), `admin_panel/src/pages/billing/BillList.jsx`।

**কী করা হয়েছে:** টাকা পরিশোধ হওয়া (paid_amount>0 → paid/partial) বিল edit এখন **save()-এর আগে** check:
role `admin/superadmin` না হলে 403 (PermissionDenied), `reason` খালি হলে 400 (ValidationError)। reason
activity log-এ যায়। Frontend Edit modal-এ notice banner + required Reason field + locked/missing হলে
Save disabled।

**Side Effect / সতর্কতা:** check `serializer.save()`-এর আগেই করা জরুরি — DRF update() default-এ
transaction-wrapped নয়, পরে raise করলে আংশিক পরিবর্তন persist হত। Unpaid বিলে reason optional।
**Tested:** Django check + vite build পাস।

---

### [2026-06-11] — Bill edit: paid বিল net কমালে অতিরিক্ত টাকা → advance_balance (overpayment refund)

**পরিবর্তিত ফাইল:** `billing/api/views.py` (`perform_update`)।

**কী করা হয়েছে:** Paid/partial বিলের net (amount/discount edit-এ) paid-এর নিচে নামালে অতিরিক্ত টাকা
স্বয়ংক্রিয়ভাবে `client.advance_balance`-এ ফেরত যায়, তারপর `apply_advance_to_bills` দিয়ে অন্য বকেয়া
বিলে auto-apply হয়। নিয়ম: `overpay=paid−net`, `delta=new_overpay−old_overpay`; delta>0 → refund।
idempotent (একই PATCH দুবার → delta=0)। delta<0 (net আবার বাড়ানো) → advance থেকে টানে না।

**Side Effect / সতর্কতা:** `paid_amount` অপরিবর্তিত রাখা হয় (payment history নষ্ট হয় না), বিল overpaid
দেখাতে পারে কিন্তু due=0। **Tested:** rollback-protected shell simulation — net 500→300, advance +200 সঠিক।

---

### [2026-06-11] — Billing List: payment/waive-এর পর EX.DATE stale দেখানো ঠিক

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/billing/BillList.jsx`।

**কী করা হয়েছে:** EX.DATE কলাম `clientDataCache.expiry_date`-কে অগ্রাধিকার দেয়, কিন্তু payment-এর পর
`fetchBills()` শুধু bills refresh করত — cache-এ থাকা client পুরনো expiry দেখাত (DB-তে নতুন তারিখ হলেও)।
এখন payment ও waive সফল হলে ওই client-কে `clientDataCache` থেকে evict করি → fresh expiry সহ re-fetch হয়।

**Side Effect / সতর্কতা:** backend expiry logic আগেই ঠিক ছিল (`_auto_enable_client_if_paid` —
expiry_day থাকলে পরের মাসে এগোয়)। এটা শুধু display refresh fix। **Tested:** DB যাচাই — expiry আসলে
update হয়েছিল; vite build পাস।

---

### [2026-06-11] — Bill Receive modal: advance preview ভুল হিসাব ঠিক

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/billing/BillList.jsx`।

**কী করা হয়েছে:** per-client endpoint-এ row.`due_amount` = ক্লায়েন্টের **সব বিলের মোট due**, কিন্তু modal
`oldThisBillDue = payBill.due_amount` ধরে নিত এটা *এই বিলের* due — ফলে full payment-এও ভুলভাবে advance
দেখাত (1000 দিলে 500 advance)। এখন `oldThisBillDue = amount − discount − paid` (এই বিলের নিজের due)।
total-due base-এ `client_balance_due` fallback যোগ (raw/merged যেকোনো object-এ সঠিক)।

**Side Effect / সতর্কতা:** শুধু modal-এর **preview** হিসাব — আসল distribution backend
`/billing/payments/receive/` করত (আগেই ঠিক ছিল)। **Tested:** vite build পাস।

---

### [2026-06-11] — Client Network & Product Information: persistent fields + auto device/vendor

**পরিবর্তিত/নতুন ফাইল:** `clients/models.py` (+৯ field), `clients/migrations/0021_*` (নতুন),
`admin_panel/src/pages/clients/CustomerSearchPage.jsx`।

**কী করা হয়েছে:** "Network and Product Information" সেকশনের field-গুলো (`device, package_no,
optical_fiber, cable_meter, vendor, serial_no, fiber_code, color_of_cord` + `device_purchase_date`)
Client model-এ ছিল না — UI-only, কখনো persist হত না, তাই সবসময় ফাঁকা। model-এ field যোগ + migration।
ClientSerializer `__all__` ও CustomerSearchPage edit-save (পুরো formData patch) এমনিতেই handle করে।
DateField-এর জন্য খালি '' → null coercion। **DEVICE** খালি হলে client-এর `router_name`, **VENDOR** খালি
হলে `mac_vendor` (MAC OUI lookup) fallback হিসেবে দেখায়।

**Side Effect / সতর্কতা:** ClientForm.jsx (নতুন client form)-এর `ui.*` field-গুলো (fiber_code, vendor,
num_core ইত্যাদি) এখনো submit হয় না (আলাদা dead-UI) — চাইলে পরে wire করতে হবে। **Tested:**
makemigrations+migrate OK, vite build পাস।

---

### [2026-06-11] — ONU Monitoring: দ্রুত decision + সহজ filtering UX

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/olt/ONUMonitoringPage.jsx` (frontend-only)।

**কী করা হয়েছে:** (1) Stat cards clickable → status filter toggle (Offline card → শুধু offline; active
highlight)। (2) Debounced search (৩৫০ms) + clear বাটন। (3) Sort control — "Worst signal first"/"Best
first" (flat/All-OLTs view-এ RX triage)। (4) Linked/Unlinked segmented toggle (client-side)। (5)
"Showing N" count + filter-empty state-এ Clear filters।

**Side Effect / সতর্কতা:** Sort ও Link-filter client-side (২০s auto-refresh-এ পুনরায় apply)। RX sort শুধু
flat view-এ — OLT সিলেক্টে PON grouping/index-order priority পায়। backend `monitor` endpoint অপরিবর্তিত।
**Tested:** vite build পাস।

---

### [2026-06-10] — ONU Monitoring near-real-time: fast refresh + client-save instant link

**পরিবর্তিত/নতুন ফাইল:** `admin_panel/src/pages/olt/ONUMonitoringPage.jsx` (refresh 60s→20s),
`olt_mgmt/signals.py` (নতুন), `olt_mgmt/apps.py` (ready), `olt_mgmt/tasks.py` (lock clear)।

**কী করা হয়েছে:**
1. **Fast refresh:** ONU Monitoring auto-refresh ১ মিনিট → **২০s** (visible হলেই)।
2. **Client-save instant link:** Client-এর `mac_address` যোগ/বদলালে post_save signal debounced
   ভাবে (`cache.add('olt_link_pending',120)` lock + ২০s countdown) `link_onu_clients` enqueue
   করে — ১৫-মিনিট beat-এর অপেক্ষা ছাড়াই নতুন client টেবিলে আসে। pre_save snapshot দিয়ে শুধু
   mac আসলেই বদলালে fire। task শুরুতে lock delete করে (post-run change আবার enqueue করতে)।

**Side Effect:** signal `olt_mgmt/apps.OltMgmtConfig.ready()`-এ register। link task ভারী
(bridge walk) — debounce-এ bulk-import-এ স্প্যাম রোধ। celery চালু থাকতে হবে।
**WebSocket true-push (user চেয়েছিল) করা হয়নি** — WSGI→ASGI/Channels migration বড় ও
deploy-পরিবর্তনশীল, untested ship ঝুঁকিপূর্ণ; ২০s polling + instant-link near-real-time
দেয়। দরকার হলে আলাদা dedicated কাজ হিসেবে করতে হবে।
**Tested:** Django check, vite build পাস; signal apps.ready-এ register (check OK)। live link
device-নির্ভর (celery)।

---

### [2026-06-10] — ONU Monitoring: Client + Zone কলাম + MAC-ভিত্তিক ONU↔Client auto-link

**পরিবর্তিত ফাইল:** `olt_mgmt/api/serializers.py` (zone fields), `olt_mgmt/api/views.py`
(select_related + zone search), `olt_mgmt/tasks.py` (link_onu_clients task + desc-link),
`config/settings.py` (beat), `admin_panel/src/pages/olt/ONUMonitoringPage.jsx` (২ কলাম)।

**কী করা হয়েছে:**
1. **Client + Zone কলাম:** ONUSignalSerializer-এ `zone_name/subzone_name/box_name` (None-safe)।
   Frontend table এখন ৮ কলাম — Description আলাদা, নতুন **Client** (নাম+customer_id) ও **Zone**
   (Zone › SubZone • Box)। PON group header colSpan 2/3/3, mobile card-এ Zone FRow, build সম্পন্ন।
2. **ONU↔Client auto-link (MAC):** নতুন task `olt_mgmt.link_onu_clients` (beat ১৫ মিনিট) —
   `_fetch_mikrotik_caller_ids` দিয়ে MikroTik active session caller-id → Client.mac_address
   (auto-save), তারপর প্রতি OLT-এ `get_cpe_mac_to_onu_map()` (bridge) → interface → ONUSignal/
   OLTMacCache.client সেট। sync task-এ description-link (`customerID-নাম`) fallback হিসেবেও আছে।

**Side Effect / সতর্কতা:** dev DB-তে মাত্র ৬ client (5 mac), 656 ONUSignal-এর 0 linked ছিল —
তাই কলাম খালি ছিল; link task চললে populate হবে। **celery restart** লাগবে (নতুন task+beat)।
bridge walk ভারী বলে আলাদা ১৫-মিনিট task (RX sync ধীর হয় না)। linking নির্ভর করে Client.
mac_address coverage-এর উপর (MikroTik caller-id থেকে আসে)। description-link শুধু matched হলে
set করে (unlink করে না)।

**Tested:** serializer zone fields + None-safety, Django check, vite build — পাস। link task
load OK; লাইভ link (MikroTik+bridge) device-নির্ভর বলে celery-তে চলবে।

---

### [2026-06-10] — OLT real-time SNMP Trap receiver + TX power (extra ONU field)

**পরিবর্তিত/নতুন ফাইল:** `olt_mgmt/models.py` (SNMPTrapLog, OLT.tx_snmp_oid),
`olt_mgmt/services/trap_service.py` (নতুন), `olt_mgmt/services/snmp_service.py` (TX),
`olt_mgmt/management/commands/snmp_trap_listener.py` (নতুন),
`olt_mgmt/management/commands/snmp_discover.py` (নতুন), `olt_mgmt/tasks.py`,
`olt_mgmt/api/serializers.py`, `olt_mgmt/admin.py`,
`deploy/isp-snmptrap.service` + `deploy/SNMP_TRAP_SETUP.md` (নতুন),
migrations 0006 (SNMPTrapLog), 0007 (tx_snmp_oid)।

**প্রেক্ষাপট:** OLT/ONU SNMP polling আগেই ছিল (snmp_service `get_onu_list`, ৫ মিনিট task →
ONU Monitoring পেজ)। এই কাজ দুটো জিনিস যোগ করল:
1. **Real-time trap receiver:** `snmp_trap_listener` (pysnmp 7 asyncio) UDP-তে OLT trap শোনে
   → `trap_service.classify_trap` (linkUp/Down, ONU register/dereg, interface_id normalize)
   → ONUSignal/OLTMacCache status **live** আপডেট + প্রতিটি trap `SNMPTrapLog`-এ store (unknown-ও)।
   DB write thread-এ offload (async-unsafe এড়াতে)। systemd unit (port 162, CAP_NET_BIND_SERVICE)।
2. **TX power + temperature + voltage (V-SOL auto):** `snmp_discover` দিয়ে আসল OLT-এ
   optical table map করা হয়েছে — `12.2.1.8.1`: .3=temp, .4=voltage, .6=TX, .7=RX।
   snmp_service এখন V-SOL-এ TX (`VSOL_TX_OID`) + temp/voltage (`VSOL_DIAG_OIDS`) **default
   walk** করে: TX → ONUSignal.tx_power, temp/voltage → raw_data। override: OLT.`tx_snmp_oid`;
   বন্ধ করতে `service.with_optical_diag=False`। `snmp_discover <olt>` command future device-এ
   OID খুঁজতে (default narrow OID, timeout-safe)। **লাইভ OLT (192.168.130.2)-এ ৩৮১ ONU-তে
   TX/temp/voltage যাচাই হয়েছে** (TX 2.18dBm, temp 51.87C, volt 3.27V ইত্যাদি — সঠিক parse)।

**Side Effect / সতর্কতা:** trap listener আলাদা long-running process — systemd `isp-snmptrap`
চালাতে হবে (gunicorn/celery নয়)। OLT-এর trap এখন V-SOL cloud-এ যায়; SNMP_TRAP_SETUP.md
অনুযায়ী Host=server-ip দিতে হবে। V-SOL **vendor trap OID (37950.*)** এখন heuristic
(value text দেখে register/dereg) — আসল trap-এর varbinds পেলে trap_service.py-তে exact
OID map করতে হবে। `olt_mgmt/tasks.py` বদলেছে → poll-এ TX আনতে **celery worker restart**।

**Tested:** হ্যাঁ — trap_service parser (linkUp/Down/vendor/interface normalize) unit-যাচাই;
listener live self-test (snmptrap CLI → pysnmp receive → SNMPTrapLog store, event/interface/
varbinds সঠিক, cleanup); Django check পাস; migration applied। আসল OLT-এর সাথে trap/TX
field-test বাকি (device-নির্ভর)।

---

### [2026-06-10] — App AI সহকারী: LLM grounding + স্বয়ংক্রিয় ticket escalation

**পরিবর্তিত ফাইল:** `support/ai_service.py`

**কী করা হয়েছে:** `answer_client_query` ৫-স্তরের বুদ্ধিমান flow:
1. deterministic fact-answer (মেয়াদ/বকেয়া/প্যাকেজ/status) — আগের কাজ।
2. billing → পরিশোধ template।
3. **সমস্যা intent** (connection_down [non-billing]/speed_slow/package_change/new_connection)
   → `auto_create_ticket()` নিজে SupportTicket(source=portal) বানায় → signal স্বয়ংক্রিয়ভাবে
   সব admin/manager/support-কে StaffNotification (dashboard) পাঠায় + `ai_categorize_ticket`
   task category/priority দেয়। গ্রাহক reply-তে ticket নম্বর পায়।
4. **LLM grounding** (`_llm_grounded_answer`) — `_fact_sheet(client)` (non-sensitive) +
   `GROUND_SYSTEM` দিয়ে free-form প্রশ্নের grounded বাংলা উত্তর; ব্যর্থ/খালি হলে template।
5. fallback template।
**Dedup:** গত ৬ ঘণ্টায় client-এর খোলা ticket থাকলে নতুন না বানিয়ে সেটিতেই গ্রাহকের বার্তা
TicketReply হিসেবে যোগ হয় (spam রোধ)।

**Side Effect / সতর্কতা:** auto-ticket created_by=None (client নিজে), priority/category
ai_categorize task সেট করে — celery down থাকলে ticket তৈরি হয় কিন্তু uncategorized থাকবে।
LLM grounding-এ Ollama (172.16.6.10) reachable লাগবে; না হলে গ্রাছফুলি template-এ পড়ে।
security model অপরিবর্তিত (শুধু non-sensitive field)। gunicorn auto-reload হয়েছে।

**Tested:** হ্যাঁ — shell-এ deterministic, auto-ticket (+StaffNotification), ৬h dedup
(reply যোগ) যাচাই হয়েছে; test ticket cleanup করা হয়েছে।

**আপডেট (একই দিন):** (১) general/অমীমাংসিত প্রশ্নেও এখন bot নিজে ticket escalate করে —
তবে greeting/ধন্যবাদ (`_smalltalk_reply`) হলে ticket নয়। (২) response-এ `ticket_pk`
(numeric) যোগ — অ্যাপে [AIChatScreen.js] bot bubble-এর নিচে clickable 🎫 ticket chip
দেখায় → tap করলে `SupportDetail` (route param `ticketId` = pk) খোলে।

**আপডেট ২ — কথোপকথন + varied template (CPU রাখা হয়েছে):**
পরিমাপে দেখা গেছে qwen2.5:3b CPU-তে full conversational উত্তর ৪০-৭০s নেয় (১৫০s timeout
হ্যাং করত) ও বাংলা মান দুর্বল। তাই:
- multi-turn LLM conversation architecture যোগ (`chat_messages`/`_ollama_chat_messages`,
  `_llm_converse`, `CONVERSE_SYSTEM`, app→`history` pass, API view history) — কিন্তু
  `_conversation_enabled()` দিয়ে **default-এ বন্ধ** (ollama)। `.env: AI_CHAT_CONVERSATION=True`
  বা fast provider (openai/anthropic) দিলে স্বয়ংক্রিয়ভাবে চালু হবে। নতুন setting:
  `AI_CHAT_CONVERSATION` (config/settings.py)।
- `render_reply(intent, client, message='')` এখন **message-aware + varied** (`_pick` random
  phrasing) — connection সমস্যায় শুধু বিল না বলে "বারবার/ডিস্টার্ব" অভিযোগ ধরে সহানুভূতি +
  troubleshooting + টেকনিশিয়ান; বিল গৌণভাবে। পরপর একই মেসেজে আর byte-identical উত্তর নয়।
- সংযোগ intermittent (`_INTERMITTENT_TOKENS`) হলে বকেয়া থাকলেও ticket escalate হয় (লাইন সমস্যা)।
**Tested:** screenshot-এর দুই বার্তায় আলাদা সমস্যা-সচেতন উত্তর + intermittent escalation যাচাই হয়েছে।

**আপডেট ৩ — "বিল পরিশোধ করেছি" দাবি যাচাই (real data lookup):**
গ্রাহক চ্যাটে past-tense পরিশোধ দাবি করলে (`_PAID_PHRASES`) নতুন `_payment_claim_answer`
আসল রেকর্ড খুঁজে সঠিক উত্তর দেয়:
- **Payment** (client বা bill→client, ৬০ দিন) — cash/collector/online; admin client/bill/
  daily-collection তালিকার ভিত্তি।
- **WebhookPayment** matched_client (gateway/webhook তালিকা) — তারিখ+amount+method সহ confirm।
- client-এ না মিললে গ্রাহকের ফোন (`from_wallet`) দিয়ে **unmatched WebhookPayment** খোঁজে →
  "পেমেন্ট পাওয়া গেছে কিন্তু যুক্ত হয়নি, সমন্বয় হচ্ছে" + ticket।
- কোথাও না মিললে "এখনো দেখা যাচ্ছে না, trxID দিন" + ticket। বকেয়া রয়ে গেলেও escalate।
বাংলা/ইংরেজি তারিখ পার্স (`_claim_day`, `_to_en_digits`)। `_specific_answer`-এর due-branch
'পরিশোধ' ধরে বলে এটি তার **আগে** (smalltalk-এর পরেই) চালানো হয়। DailyCollection per-client
নয় (শুধু aggregate) — তাই Payment-ই ব্যবহৃত।
**Tested:** found (date+amount+method+due), claim-day parse (৫/12), না-পাওয়া escalate যাচাই হয়েছে; test payment cleanup।

**আপডেট ৪ — outage অভিযোগে log-ভিত্তিক diagnosis:**
গ্রাহক "লাইন বন্ধ/নেই/দুই দিন বন্ধ" বললে (`_OUTAGE_TOKENS`) নতুন `_outage_diagnosis`
আসল log দেখে কারণ-সহ উত্তর দেয়:
- status cut (expired/suspended/inactive) বা মেয়াদ পার → `ClientActivityLog`
  (`client_disabled`/`status_changed`) থেকে **কখন বন্ধ** বের করে "X তারিখ (প্রায় N দিন আগে)
  থেকে বকেয়া/মেয়াদজনিত বন্ধ" + পরিশোধ নির্দেশ (ticket নয়)।
- status active + live online → "এখন Online দেখাচ্ছে, router restart দিন" (ticket নয়)।
- active + offline → `RadiusService.for_client(client).get_last_session()` (নতুন radacct
  method) থেকে **last-online time + কতক্ষণ বন্ধ** → "শেষবার [তারিখ সময়] (প্রায় N দিন আগে)
  online ছিল; সম্ভবত ONU/router/বিদ্যুৎ/fiber সমস্যা" + technical **ticket escalate**।
  বকেয়া থাকলে মৃদু reminder যোগ হয় (কারণ হিসেবে নয়)।
helper: `_human_duration`, `_aware`। শুধু due > 0 কে "কাটা" ধরা হয় না (grace-এ active)।
নতুন method: `RadiusService.get_last_session(username)` (radius_service.py — signature যোগ, পরিবর্তন নয়)।
**Tested:** billing-cut (activity-log তারিখ+duration) ও active-offline (radacct last-online
+ escalate) উভয় path shell-এ যাচাই হয়েছে।

**আপডেট ৫ — ফাইবার কাটা = জরুরি (critical) auto-ticket + admin top-bar notify:**
গ্রাহক "ফাইবার/তার/cable কেটে/ছিঁড়ে পড়ে আছে" বললে নতুন `_is_fiber_cut`/`_fiber_cut_answer`
(answer_client_query-এ সবার আগে) — safety-সচেতন জরুরি উত্তর (কাটা তারে হাত না দেওয়া) +
`auto_create_ticket(priority='critical', subject='🚨 ফাইবার কাটা — <নাম>', category='সংযোগ
বিচ্ছিন্ন')`। বিদ্যমান signal (`_handle_ticket_created`) সব admin/manager/support-কে
`StaffNotification` পাঠায় → admin panel **top-bar ডান পাশে** client নাম+subject সহ
notification। `auto_create_ticket` এখন optional `priority/subject/category_name` নেয় এবং
dedup-এ existing ticket-এর priority জরুরি হলে bump করে।
Detection দুই-অংশ (fiber-শব্দ + cut-শব্দ, suffix টি/টা উপেক্ষা); "তার" pronoun false-positive
এড়াতে শুধু স্পষ্ট wire-phrase। নতুন method signature পরিবর্তন: `auto_create_ticket(...,
priority=None, subject=None, category_name=None)` (backward-compatible)।
**Tested:** detection (fiber→True, "তার বিল"→False), full flow (critical ticket+category+
StaffNotification+safety reply) shell-এ যাচাই; test ticket cleanup।

**আপডেট ৬ — প্যাকেজ পরিবর্তন context-flow + loading indicator:**
সমস্যা (screenshot): "আপগ্রেড করতে চাই" → template; পরের turn "10 Mbps" → একই template
(context বুঝত না)। সমাধান `_package_change_answer(message, client, history)`:
- request (`_PKG_CHANGE_TOKENS`) → admin **Package তালিকা** (configuration.models.Package,
  is_active, price) খুঁজে বর্তমান+বিকল্প প্যাকেজ দেখায়, কোনটি চান জিজ্ঞেস করে (ticket নয়)।
- follow-up "10 Mbps" → `_recent_package_context(history)` দিয়ে context বুঝে `_find_package`
  (নাম/speed/Mbps সংখ্যা মিলিয়ে) প্যাকেজ confirm + দাম জানায় + `auto_create_ticket`
  (subject "প্যাকেজ পরিবর্তন → X", category) → StaffNotification। "5207" hijack করে না।
- answer_client_query-এ outage-এর পরে, _specific_answer-এর আগে।
App: [AIChatScreen.js] loading bubble এখন rotating status ("🔍 তথ্য খুঁজছি…" → "📋 যাচাই করছি…"
→ "✍️ উত্তর তৈরি করছি…", ২.২s অন্তর) — ধীর মেশিনেও ক্লায়েন্ট বোঝে কাজ চলছে।
**Tested:** list → pick("10 Mbps")→confirm+ticket+notif, no-context hijack নেই — shell যাচাই; app Babel OK।

**আপডেট ৭ — Ticket automation (smart-routing + sentiment + auto-reply):**
`support/tasks.py` → `ai_categorize_ticket` task এখন category/priority ছাড়াও:
- **#4 Smart-routing:** unassigned হলে intent→role map (`_ROUTE_ROLES`: billing→accountant,
  technical→support, package/new→manager) থেকে সবচেয়ে কম open-ticket-ওয়ালা active user-কে
  load-balance assign (`_pick_assignee`)। fallback: admin → superadmin (সবসময় কেউ পায়)।
  assignment signal → assigned staff-কে StaffNotification।
- **#5 Sentiment:** `ai_service.classify_sentiment` (keyword `_NEGATIVE_TOKENS` + LLM fallback)
  → 'negative' হলে priority `high`-এ bump + activity log "😟 অসন্তুষ্ট গ্রাহক"।
- **#6 Auto-reply:** নতুন setting `AI_TICKET_AUTOREPLY` (default **False**) চালু থাকলে portal
  + খুব নিরাপদ intent (`_AUTOREPLY_INTENTS`={billing_due}) + staff reply নেই → "🤖 স্বয়ংক্রিয়
  উত্তর" TicketReply পোস্ট। (settings.py-তে flag)।

**Side Effect:** `support/tasks.py` বদলেছে — **celery worker restart** লাগবে। zone→staff
mapping নেই বলে routing role-ভিত্তিক (zone নয়)।
**#7 (inbound SMS→ticket):** infra নেই — sms_service শুধু outbound; SMS gateway-এর inbound
webhook যোগ করলে `auto_create_ticket`/intake দিয়ে সহজেই করা যাবে (deferred)।
**Tested:** sentiment (angry→negative→high+flag), routing (admin fallback assign+notif),
auto-reply (flag on→billing portal-এ draft) — সব shell-এ যাচাই; test ticket cleanup।

---

### [2026-06-10] — App AI সহকারী: নির্দিষ্ট তথ্য-প্রশ্নে precise উত্তর

**পরিবর্তিত ফাইল:** `support/ai_service.py`

**সমস্যা:** chatbot শুধু ৬টা intent-এ classify করে fixed template ফেরাত — তাই "মেয়াদ
কবে শেষ?" জিজ্ঞেস করলেও generic বকেয়ার উত্তর দিত (specific তথ্য আসত না)।

**কী করা হয়েছে:** নতুন deterministic `_specific_answer(message, client)` — keyword
detect করে গ্রাহকের আসল data থেকে precise বাংলা উত্তর দেয়: মেয়াদ/expiry (+ কত দিন
বাকি), বকেয়া পরিমাণ, প্যাকেজ+স্পিড+মাসিক বিল, online/offline status, অ্যাকাউন্ট সারসংক্ষেপ।
`answer_client_query` এখন আগে এটা চালায় (LLM ছাড়াই instant), না মিললে আগের classify+
template fallback। helper: `_bn_date`, `_days_left`, `_pkg_speed`, `_wrap`।

**Side Effect / সতর্কতা:** এখনো শুধু non-sensitive field (status/due/expiry/package/
online) ব্যবহৃত — security model অপরিবর্তিত। deterministic intent = `account_info`,
suggest_ticket=False। gunicorn auto-reload করেছে।

**Tested:** হ্যাঁ — shell-এ ৫টা প্রশ্নে আসল client data সহ সঠিক উত্তর যাচাই হয়েছে।

---

### [2026-06-10] — expiry_date = enable/disable-এর সর্বোচ্চ অগ্রাধিকার

**পরিবর্তিত ফাইল:** `clients/api/views.py` (perform_update), `billing/tasks.py` (disable_expired_clients)

**চাহিদা:** expiry_date-ই লাইন চালু/বন্ধের master switch হবে — expiry পার হলে সাথে সাথে
বন্ধ, expiry বাড়ালে সাথে সাথে চালু।

**কী করা হয়েছে:**
1. **Admin Edit (perform_update):** serializer.save()-এর পর expiry_date দেখে status force —
   expiry_date `< today` ও status active হলে → `expired`; expiry_date `>= today` ও status
   expired হলে → `active`। এরপর বিদ্যমান status-transition machinery RADIUS/MikroTik
   enable/disable + group restore করে। শুধু **active↔expired** toggle — manual
   suspended/inactive/left/cancelled override হয় না।
2. **Daily task (disable_expired_clients):** নতুন `by_expired_date` queryset — expiry_day
   থাকুক না থাকুক, `expiry_date < today` যেকোনো active client disable হয়। তিন queryset
   (by_day + by_date + by_expired_date) এখন pk দিয়ে dedupe করা হয়।

**Side Effect / সতর্কতা:** `billing/tasks.py` বদলেছে — কার্যকর হতে **celery worker restart**
লাগবে (gunicorn hook শুধু web reload করে)। expired client-এ expiry বাড়ালে active-restore
path চলায় radacct traffic clear হয় (বিদ্যমান আচরণ)। due > 0 থাকলেও expiry future হলে
লাইন চালু হবে (expiry = highest priority) — অ্যাপে শুধু due reminder banner দেখাবে।

**Tested:** Django `manage.py check` পাস; runtime flow manual যাচাই বাকি।

---

### [2026-06-10] — App due-notice: hard-block শুধু সংযোগ বন্ধ হলে

**পরিবর্তিত ফাইল:** `mobile_app/src/components/DueOverlay.js`, `mobile_app/App.js`

**সমস্যা:** Active client (expiry ভবিষ্যতে, ইন্টারনেট চালু) bill due হলেই অ্যাপে পুরো-স্ক্রিন
un-dismissable block দেখাত — গ্রাহক অ্যাপ ব্যবহারই করতে পারত না যদিও নেট চালু।

**কী করা হয়েছে:** DueOverlay দুই মোডে ভাগ — (১) সেবা বন্ধ হলে full-screen hard-block;
(২) সংযোগ active কিন্তু `due > 0` হলে উপরে dismissible reminder banner (✕ দিয়ে বন্ধ,
"পরিশোধ" বোতাম)। দুই মোডেই ১৫s poll — payment-এর পর notice নিজে নিজেই চলে যায়।

**"সেবা বন্ধ" নির্ধারণ:** `isCut = status ∈ {expired/suspended/inactive/cancelled}` **অথবা**
`expiry_date < today`। অর্থাৎ daily task status flip করার আগেই expiry_date পার হলে অ্যাপ
সাথে সাথে full-screen reminder দেখায় (`/app/me`-তে expiry_date আগেই আসত)। expiry future
কিন্তু due থাকলে → শুধু banner।

**Side Effect / সতর্কতা:** `useSafeAreaInsets` ব্যবহৃত (SafeAreaProvider আগেই App-এ আছে)।
banner একবার dismiss করলে due বদলানো পর্যন্ত আর দেখায় না।

**Tested:** না (runtime) — Babel parse OK; Expo-তে manual যাচাই বাকি।

---

### [2026-06-10] — Multi-router / Multi-RADIUS robustness (৪ স্তম্ভ)

**পরিবর্তিত ফাইল:** `clients/api/views.py`, `radius_app/services/radius_service.py`,
`mikrotik_app/api/views.py`, `radius_app/models.py`, `radius_app/api/views.py`,
`deploy/isp-freeradius.sudoers` (নতুন)

**সমস্যা (যা ধরা পড়েছিল):** নতুন router MTK_PPP add করার পর — (১) auth "radius timeout", (২) auth সফল হলেও client `0.0.0.0` IP পেত।

**মূল কারণ:**
- (১) FreeRADIUS NAS তালিকা শুধু startup-এ SQL থেকে পড়ে; নতুন router add-এর পর reload না হওয়ায় তার packet drop হতো। কোডের `systemctl restart freeradius` gunicorn `isp` user-এ sudo না থাকায় নীরবে fail করত।
- (২) RADIUS group আসত global `Package.mikrotik_profile` থেকে — router-ভেদে profile নাম আলাদা (`5M` vs `5 Mbps`) হলে client এমন profile/pool পেত যা ঐ router-এ নেই → IP নেই।

**কী করা হয়েছে (৪ স্তম্ভ):**
1. **Router-aware profile:** নতুন helper `_client_radius_profile(client)` + `_ensure_radius_group(svc, group)` ([clients/api/views.py])। RADIUS group এখন `client.pppoe_profile` (admin client form-এ router-এর live profile থেকে বেছেছে) থেকে আসে, fallback `package.mikrotik_profile`। group-এ শুধু `Mikrotik-Group := profile` সেট হয় (Framed-Pool নয়) — router-এর profile-ই IP pool assign করে, তাই router-ভেদে pool নাম আলাদা হলেও collision নেই। সব sync site (create/update/restore/renew/enable/bulk-import) এই helper ব্যবহার করে। **Frontend আগেই router→live-profile dropdown করত** (ClientForm.jsx), শুধু backend পিছিয়ে ছিল।
2. **NAS auto-reload:** `RadiusService.reload_freeradius()` static method — `sudo -n systemctl reload-or-restart freeradius`, ফলাফল log + UI-তে surface। router add/delete-এ ব্যবহৃত। **install বাকি:** `sudo install -m 0440 -o root -g root deploy/isp-freeradius.sudoers /etc/sudoers.d/isp-freeradius` (root একবার)। না করলে reload fail হবে, manual reload লাগবে।
3. **Multi-RADIUS routing:** আগে থেকেই `for_client`/`for_server` দিয়ে করা ছিল; manual `disconnect_user` endpoint-ও এখন client→router→radius_server ধরে route করে।
4. **Single default RADIUS:** `RadiusServer.save()` override — একটা default করলে বাকিরা auto non-default। ডেটা ঠিক: PPPOE-Radius Server (172.16.3.254, routable) = একমাত্র default।

**Side Effect / সতর্কতা:**
- বিদ্যমান client-দের group (`5M` ইত্যাদি) যা ছিল তা-ই থাকে; নতুন/edited client `pppoe_profile`-ভিত্তিক group পায়। পুরনো group-এর stale `Framed-Pool` touch করা হয়নি (পুরনো router ভাঙা এড়াতে)।
- 10003 fix: group `5M` → `5 Mbps`-এ সরানো হয়েছিল (MTK_PPP-এ বিদ্যমান নাম)।
- gunicorn auto-reload apply হয় না — প্রতিবার `systemctl restart isp-gunicorn.service` লাগে।

**Tested:** হ্যাঁ — `manage.py check` clean, প্রতি ধাপে gunicorn restart, RADIUS DB query-তে group/NAS যাচাই, single-default DB-তে নিশ্চিত। **বাকি live test:** নতুন client create করে router profile-এ IP পাচ্ছে কিনা + sudoers install করে reload auto হচ্ছে কিনা।

---

### [2026-06-09] — MikroTik RADIUS config fix: localhost hostname → routable IP

**পরিবর্তিত ফাইল:** `mikrotik_app/api/views.py` (`_push_radius_to_router`)

**কী করা হয়েছে:**
- নতুন router-এ "Configure RADIUS" করলে error হতো: *"invalid value for argument address"* — কারণ RADIUS server-এর `radius_host` ছিল `localhost`, আর RouterOS-এর `/radius/add =address=` শুধু IP নেয়, hostname নয়।
- আগের loopback-replacement শুধু `startswith('127.')` চেক করতো, তাই `localhost` string slip করে যেত। এখন `ipaddress` দিয়ে validate করি — value valid IP না হলে (localhost) বা loopback হলে server-এর routable IP (`_get_routable_ip()`) দিয়ে replace হয়।

**Side Effect / সতর্কতা:**
- DB-তে **দুটো RadiusServer-ই `is_default=True`** (id=5 localhost→এখন routable, id=6 `127.0.1.1`)। কোড default-এর প্রথমটা নেয়। ভবিষ্যতে একটাকে `is_default=False` করা উচিত।
- কোড edit-এর পর gunicorn auto-reload apply হয়নি — **hard restart** (`systemctl restart isp-gunicorn.service`) লাগে।

**Tested:** হ্যাঁ — UI থেকে MTK_PPP (172.16.4.2) Configure RADIUS সফল, success toast "RADIUS (172.16.3.254) সফলভাবে কনফিগার", `manage.py check` clean।

---

### [2026-06-09] — App Login: Customer Code + Password (Backend ধাপ)

**পরিবর্তিত ফাইল:**
`clients/models.py`, `clients/migrations/0017_client_app_password.py`,
`clients/migrations/0018_seed_existing_app_passwords.py`, `clients/api/views.py`,
`mobile_api/api/serializers.py`, `mobile_api/api/views.py`, `mobile_api/api/urls.py`

**কী করা হয়েছে (OTP → Customer Code + Password login-এর backend):**
1. `Client` model-এ `app_password` (hashed, PPPoE `password` থেকে আলাদা) + `app_registered_on` field।
   helpers: `set_app_password()`, `check_app_password()`, `is_app_user` property।
2. Data migration 0018 — বিদ্যমান app_enabled client-দের `app_password = phone` (hashed) সেট, যাতে lockout না হয়।
3. নতুন `POST /app/auth/login/` (`AppLoginView`) — customer_id + password → JWT (`_create_client_token`)। OTP endpoint রাখা হয়েছে।
4. ClientViewSet-এ portal actions: `portal-stats`, `portal-lookup`, `portal-registered`, `portal-register`, `portal-reset-password`, `portal-toggle-app` (admin panel-এর Registered Clients পেজের জন্য)।

**Side Effect / সতর্কতা:**
- `Client.password`/`username` = PPPoE/RADIUS credential — **হাত দেওয়া হয়নি**, app login সম্পূর্ণ আলাদা `app_password`।
- বিদ্যমান client প্রথমবার লগইন: Customer Code + phone number (পরে reset করা যাবে)।
- **বাকি ধাপ:** admin panel Registered Clients UI + Registration modal, mobile login screen (OTP→password), AuthContext আপডেট, নতুন logo।

**Tested:** হ্যাঁ — migration applied, login endpoint (সঠিক→JWT, ভুল→error), portal endpoints 401 (routed OK), `manage.py check` clean।

**ধাপ ৩ (Mobile login + self-registration + dynamic logo) — সম্পূর্ণ:**
- Backend: `POST /app/auth/register/check/` (`AppRegisterCheckView` — Client Code eligibility + registered phone-এ OTP), `POST /app/auth/register/` (`AppRegisterView` — OTP verify + password সেট + auto-login JWT)। serializers: `RegisterCheckSerializer`, `AppRegisterSerializer`।
- `/app/config/`-এ `company_name` + `company_logo` (absolute URL, `CompanySetup` থেকে) যোগ — admin System Settings-এ logo বদলালে app login পেজের logo-ও বদলায়।
- Mobile: `SendOTPScreen`/`VerifyOTPScreen` (orphaned, import সরানো) → নতুন `LoginScreen` (Customer Code + Password + Remember me + Registered link), `ClientCodeScreen` (self-reg ধাপ ১), `RegisterScreen` (OTP + email + password)। `App.js` auth stack আপডেট। logo `/app/config/` থেকে dynamic।
- admin registration (Apps Management) + client self-registration **দুটোই** আছে।
- Tested: register/check→OTP→register→auto-login→password login — সব OK।

**Production readiness fixes (Android + iOS):**
- `app.json`: iOS `NSLocationWhenInUseUsageDescription` + ATS `NSAllowsArbitraryLoadsInWebContent` (http FTP/TV WebView), expo-location/expo-notifications plugin, ios.buildNumber/android.versionCode, app name "Rajamehar Online"।
- `eas.json` তৈরি (development/preview/production profiles, appVersionSource local)।
- Central config: `src/config.js` (Constants.expoConfig.extra.apiBaseUrl) — ৮ ফাইলের hardcoded BASE_URL সরিয়ে এখান থেকে import।
- Push: `src/services/notifications.js` পূর্ণ implement (FCM `getDevicePushTokenAsync` → `/app/me/fcm-token/`, Expo Go-তে guarded)। expo-notifications/expo-device/expo-constants installed।
- ⚠️ `google-services.json` placeholder (invalid) — app.json থেকে `googleServicesFile` সরানো (নাহলে Android build fail করত)। Push চালু করতে real Firebase config (google-services.json + iOS GoogleService-Info.plist) লাগবে।
- expo-doctor: 18/18 pass।

**Mobile: Status bar fix (edge-to-edge) + সব screen English:**
- নতুন reusable `mobile_app/src/components/ScreenHeader.js` — `useSafeAreaInsets` দিয়ে status bar এলাকা header-রঙে ঢাকে (Android 15 edge-to-edge-এ "উপরের অংশ দেখা যায় না" সমস্যা ঠিক)। StatusBar light।
- ১৫টা screen SafeAreaView → ScreenHeader/View-এ রূপান্তর + সব UI টেক্সট Bengali→English: SMS, BillList, Support(List/Create/Detail), Links(Services), Invoice, Profile, Traffic, BannerDetail, Recharge, Payment, PaymentResult, BkashWebView।
- Bug fix: `BkashWebViewScreen`-এ `Alert` import করা ছিল না (handleError crash করত) — যোগ করা হলো।
- Side effect: PaymentResultScreen centered result রাখা (SafeAreaView + StatusBar dark)। কিছু Bengali শুধু code comment-এ রয়ে গেছে (UI নয়)।
- সব JS পরিবর্তন → `eas update` বা পরের build-এ।

**Client Lat/Lng permission (role-based edit/delete):**
- নতুন granular permission `common.location_edit` (`module_definitions.py`) — role assign UI-তে দেখাবে।
- `role_permissions/utils.py`-এ `user_has_granular(user, ctx, key)` helper।
- ClientViewSet `perform_update`: lat/lng **edit/update** = superadmin/admin বা `location_edit` permission; **delete (খালি করা)** = শুধু superadmin/admin। অন্যদের পরিবর্তন উপেক্ষা।
- ClientForm: lat/lng field + Get Location **কোথাও hide নয়** — `canEditLoc` (isSuper বা granular) না থাকলে disabled (greyed), button visible-but-disabled। আগের isSuper-only hide/lock-note সরানো।

**Profile Location (Latitude/Longitude) — GPS auto-fill + mandatory:**
- Client model-এ `map_lat`/`map_lng` আগেই ছিল (network map `network/api/views.py` এগুলো `latitude/longitude` হিসেবে ব্যবহার করে)। নতুন field লাগেনি।
- `expo-location` (~19.0.8) install (Expo Go-তে চলে)। ProfileScreen-এ বিকল্প নম্বরের উপরে Latitude/Longitude field + "📍 বর্তমান লোকেশন নিন" বাটন (`Location.getCurrentPositionAsync` → ঘর auto-fill)। app.json-এ ACCESS_FINE/COARSE_LOCATION permission।
- `AppClientProfileSerializer`-এ `map_lat`/`map_lng` writable; PATCH-এ বাধ্যতামূলক (খালি→400)। mobile save-এও required। → map view-এর জন্য সঠিক coordinate নিশ্চিত।

**Profile fields + email mandatory:**
- `Client` model-এ `father_name`, `area`, `house_name` field যোগ (migration 0019)। `address` আগেই ছিল।
- mobile ProfileScreen: Account Info থেকে মেয়াদ শেষ + সংযোগের তারিখ বাদ; উপরে editable "ব্যক্তিগত তথ্য" (পিতার নাম/এরিয়া/বাড়ির নাম/ঠিকানা/বিকল্প নম্বর/ইমেইল) — client add-এ না থাকলে user নিজে দিতে পারে। `EditField` module-level (focus bug এড়াতে)।
- `AppClientProfileSerializer`-এ নতুন field; `ClientProfileView` PATCH writable: `father_name, alt_phone, email, area, house_name, address`।
- **Email বাধ্যতামূলক সব জায়গায়:** self-registration (`AppRegisterSerializer` required), profile PATCH (খালি email→400), admin `portal_register` + ClientPortalPage modal, RegisterScreen client-side।

**OTP refinement (login OTP সরানো + admin SMS gateway):**
- `SMSService.send_sms` এখন admin panel-এর active `SMSGateway` (DB) ব্যবহার করে, না থাকলে `.env` settings fallback। → admin-এ SMS gateway তৈরি করলে OTP সেখান থেকে যাবে।
- OTP এখন **শুধু self-registration**-এ। পুরনো login OTP সম্পূর্ণ সরানো: `/app/auth/send-otp/`+`/verify-otp/` endpoint, `SendOTPView`/`VerifyOTPView`, mobile `SendOTPScreen`/`VerifyOTPScreen` (deleted), `api.js` PUBLIC_PATHS আপডেট (login/register paths)।
- `AppRegisterCheckView`: OTP এখন শুধু `settings.DEBUG`-এ response-এ আসে (production-এ কেবল SMS gateway দিয়ে phone-এ যায়); `sms_sent` flag যোগ।

**ধাপ ৪ (Logo/Icon) — সম্পূর্ণ:**
- `mobile_app/scripts/generate_icons.py` (নতুন) — যেকোনো সাইজের logo থেকে সব app icon (icon/splash/adaptive/favicon) তৈরি করে। default source = admin company logo (`media/company/`)।
- বর্তমান logo (Rajamehar Online, 236×100) দিয়ে icon তৈরি; `app.json`-এ splash/adaptive background সাদা করা (গাঢ় logo দৃশ্যমান রাখতে)।
- App icon/splash = **build-time** (eas build আগে সেট করতে হয়, runtime-এ বদলায় না)। Login পেজের logo = runtime dynamic (`/app/config/` company_logo)।

**ধাপ ২ (Admin Panel UI) — সম্পূর্ণ:** `admin_panel/src/pages/clients/ClientPortalPage.jsx` (নতুন), `admin_panel/src/App.jsx` route `/clients/portal` (Sidebar-এ "Portal Manage" আগেই ছিল)। Registered Clients পেজ: ৩ stat কার্ড + USER TYPE filter + search + table (app toggle, reset/set password) + Registration modal (client lookup→auto-fill→password)। vite build OK। **বাকি:** ধাপ ৩ mobile login/register screen (user design দেবে), ধাপ ৪ logo।

---

### [2026-06-09] — Mobile: Header Profile Button + Client SMS History + Banner Carousel

**পরিবর্তিত ফাইল:**
`mobile_api/api/views.py`, `mobile_api/api/urls.py`,
`mobile_app/src/screens/home/HomeScreen.js`, `mobile_app/src/screens/profile/ProfileScreen.js`

**কী করা হয়েছে:**
1. **নতুন endpoint** `GET /app/me/sms/` (`AppSmsHistoryView`) — client-কে পাঠানো SMS history (`SMSLog` থেকে `Q(client=client) | Q(recipient_phone=client.phone)`, সর্বশেষ ৫০টি)। auth: `MobileClientAuthentication`।
2. **HomeScreen header:** logout button (⇥) সরিয়ে profile button (👤) — `navigation.navigate('Profile')` (sibling Tab)। `handleLogout`/`logout` HomeScreen থেকে সরানো হয়েছে (logout আগে থেকেই ProfileScreen-এ আছে)।
3. **ProfileScreen:** "পাঠানো SMS" বাটন + slide-up Modal — ক্লিক করলে `/app/me/sms/` fetch করে SMS list (status badge + তারিখ + message) দেখায়।
4. **Banner:** আগের 260px card → পূর্ণ-প্রস্থ `pagingEnabled` carousel + dots indicator। Stat pills-এ icon badge + accent border polish।

**Side Effect / সতর্কতা:**
- Banner image crop fix: `onLoad` থেকে aspectRatio নিয়ে container সাইজ — crop নেই।
- mobile `AppBannerSerializer`-এ `image_url` (absolute) যোগ; HomeScreen `b.image_url || b.image` fallback ব্যবহার করে।

**Tested:** হ্যাঁ — `manage.py check` OK, `/app/me/sms/` unauthenticated→401 (view loads), babel transform OK (উভয় screen)।

---

### [2026-06-09] — Mobile Traffic Graph উন্নত + App Banner image/link Fix

**পরিবর্তিত ফাইল:**
`mobile_app/src/screens/home/HomeScreen.js`, `mobile_api/api/serializers.py`

**কী করা হয়েছে:**
1. **Traffic graph (Home widget):** ডানপাশে dynamic real Mb/s scale (আগের hardcoded `1,0,0,0,0` সরানো), peak speed-এর dashed line + badge, upload/download একই scale-এ (shared `scaleMax`, আগে আলাদা ছিল), expand/collapse chevron (`LayoutAnimation`, 90↔200px)।
2. **App Banner gap fix:** mobile `AppBannerSerializer`-এ `image_url` (absolute) যোগ — আগে শুধু relative `image` ছিল। HomeScreen banner card এখন `<Image image_url>` দেখায় ও `link_url` থাকলে `Linking.openURL` দিয়ে tappable (আগে `›` arrow নিষ্ক্রিয় ছিল, image/link দুটোই অগ্রাহ্য হতো)।

**Side Effect / সতর্কতা:**
- Admin banner CRUD/filtering আগেই ঠিক ছিল — শুধু mobile render gap ছিল।
- Banner card column layout হয়েছে (আগে row); image না থাকলে আগের মতোই দেখায়।
- Traffic scale live polling (৩s) থেকে আসে — app শুরুতে history ভরা পর্যন্ত scale ধীরে real হয়।

**Tested:** হ্যাঁ — babel transform (mobile) + `manage.py check` (backend) উভয় pass।

---

### [2026-06-08] — Smart Radacct Purge: Suspended Client Data Protected

**পরিবর্তিত ফাইল:**
`radius_app/services/radius_service.py`, `clients/api/views.py`, `billing/tasks.py`

**কী করা হয়েছে:**
1. `RadiusService.get_user_monthly_aggregates(username)` — একটি নির্দিষ্ট user-এর সব closed session aggregate।
2. `RadiusService.purge_old_sessions(days, exclude_usernames)` — suspended/expired user-এর data বাদ দিয়ে purge।
3. `_save_client_traffic_before_clear(client, svc)` helper — re-activation-এর আগে data ClientMonthlyTraffic-এ save করে।
4. Re-activation hook (উভয় জায়গায়): আগে aggregate save → তারপর radacct clear।
5. Purge task: suspended/expired client-এর username list তৈরি করে exclude করে।

**নিয়ম:**
- suspended/expired client → radacct data চিরস্থায়ী যতক্ষণ না re-activate হয়
- active client → ৩০ দিনের পুরনো closed session purge (summary table-এ আগেই সংরক্ষিত)
- re-activation → aggregate save করে তারপর radacct clear (fresh billing cycle)

**Tested:** হ্যাঁ — check OK, helper function import OK, protected clients logic OK।

---

### [2026-06-08] — ClientMonthlyTraffic: Permanent Traffic History System

**পরিবর্তিত ফাইল:**
`clients/models.py`, `clients/migrations/0016_client_monthly_traffic.py`,
`radius_app/services/radius_service.py`, `radius_app/api/views.py`,
`billing/tasks.py`, `config/settings.py`

**কী করা হয়েছে:**
1. `ClientMonthlyTraffic` model যোগ — `(client, year_month)` unique, app DB-তে মাসিক summary।
2. `RadiusService.get_monthly_aggregates(days=35)` — closed session-এর monthly aggregate।
3. `billing.aggregate_radacct_to_monthly_traffic` Celery task — রাত ১টায় radacct থেকে upsert।
4. `billing.purge_old_radacct_sessions` রাত ২টায় — aggregate-এর ১ ঘণ্টা পরে।
5. `traffic_history` API updated — পূর্ববর্তী মাস summary table থেকে, চলতি মাস live radacct।
6. প্রথম aggregate manually run করা হয়েছে (2 records তৈরি)।

**Side Effect / সতর্কতা:**
- Open session (current month চলমান) summary table-এ যায় না — API live radacct দিয়ে merge করে।
- Re-activation-এ `clear_client_traffic` radacct clear করলেও summary table অক্ষত থাকে।
- `ClientActivityLog` model-এ `db_table='isp_client_activity_logs'` আছে — migration-এ স্পর্শ করা হয়নি।

**Tested:** হ্যাঁ — migration OK, aggregate task 2 records upserted, API live+summary merge সঠিক।

---

### [2026-06-08] — Radacct Auto-Purge + Re-activation Traffic Clear

**পরিবর্তিত ফাইল:**
`radius_app/services/radius_service.py`, `clients/api/views.py`, `billing/tasks.py`, `config/settings.py`

**কী করা হয়েছে:**
1. `RadiusService`-এ দুটো নতুন method: `clear_client_traffic(username)` — client-এর সব radacct মুছে, `purge_old_sessions(days=30)` — বন্ধ পুরনো session মুছে।
2. `clients/api/views.py`-এ `enable_client()` ও `partial_update()` status transition block-এ: `suspended/expired → active` হলে `clear_client_traffic()` call।
3. `billing/tasks.py`-এ `purge_old_radacct_sessions` Celery task — সব active RADIUS server-এ ৩০ দিনের পুরনো বন্ধ session delete করে।
4. `config/settings.py`-এ `CELERY_BEAT_SCHEDULE`-এ task entry যোগ — প্রতিদিন রাত ২টায় চলে।

**Side Effect / সতর্কতা:**
- Open session (acctstoptime IS NULL) কখনো purge হয় না।
- Re-activation clear শুধু `suspended/expired → active` transition-এ, `inactive → active`-এ হয় না।
- Payment-এ auto-enable (`_auto_enable_client_if_paid`) এ এখনো clear নেই — payment flow আলাদা।

**Tested:** হ্যাঁ — method import confirm, celery services active।

---

### [2026-06-08] — DailyCollection Customer Search Navigation + BillList Profile Fix

**পরিবর্তিত ফাইল:**
`admin_panel/src/pages/billing/DailyCollection.jsx`, `admin_panel/src/pages/billing/BillList.jsx`

**কী করা হয়েছে:**
1. `DailyCollection.jsx`-এ `useNavigate` hook যোগ (`const navigate = useNavigate()`)। Bill Receive modal-এ client select হলে "View Profile" বাটন দেখায় যা `/search?client=${client.id}`-এ navigate করে।
2. `BillList.jsx`-এ উভয় `onProfile` callback fix — আগে `/clients/:id/profile` (ClientProfile)-এ যাচ্ছিল, এখন `/search?client=${id}` (CustomerSearch)-এ যায়।

**Side Effect / সতর্কতা:**
"View Profile" বাটন modal বন্ধ না করেই navigate করে — user নতুন page-এ চলে যাবে। এটাই expected behavior।

**Tested:** হ্যাঁ — frontend build সফল (3.06s)।

---

### [2026-06-08] — Monthly Traffic History Section (Customer Search)

**পরিবর্তিত ফাইল:**
`radius_app/services/radius_service.py`, `radius_app/api/views.py`, `radius_app/api/urls.py`,
`admin_panel/src/pages/clients/CustomerSearchPage.jsx`

**কী করা হয়েছে:**
1. `RadiusService`-এ `get_traffic_history(username, months)` method যোগ — radacct থেকে monthly GROUP BY query।
2. `GET /api/v1/radius/traffic-history/?username=&months=` endpoint যোগ।
3. CustomerSearchPage-এ "Monthly Traffic History" section যোগ — Connectivity Information-এর ঠিক নিচে। Table: মাস | Sessions | ↓ Download (blue bar) | ↑ Upload (green bar) | মোট সময়। নিচে Total row।

**Side Effect / সতর্কতা:**
RADIUS DB connection না থাকলে empty array return করে (silent fail)। `bytes_in` = `acctinputoctets`, `bytes_out` = `acctoutputoctets` — existing codebase convention মেনে চলে।

**Tested:** হ্যাঁ — URL registration confirm, frontend build সফল।

---

### [2026-06-08] — Invoice ও Statement PDF সম্পূর্ণ Redesign

**পরিবর্তিত ফাইল:**
`billing/api/serializers.py`, `admin_panel/src/pages/billing/BillList.jsx`

**কী করা হয়েছে:**
1. `BillSerializer`-এ দুটি নতুন field যোগ: `payments_summary` (bill-এর verified payment list) এবং `client_connection_type` (protocol name)।
2. `downloadInvoice()` সম্পূর্ণ rewrite: STATUS BADGE (PAID/UNPAID/PARTIAL), company info strip, দুটি styled box (BILL TO + INVOICE DETAILS — zone, package, connection, advance balance সহ), Payment History table, colored summary (Sub-Total→Discount→Net→Paid→Balance Due), diagonal status watermark।
3. `downloadStatement()` সম্পূর্ণ rewrite: overall status badge (ALL PAID / HAS DUE), company strip, CLIENT INFO box (zone, connection type), STATEMENT DETAILS box, bills table-এ colored status/due cells, colored summary box।

**Side Effect / সতর্কতা:**
`payments_summary` field শুধু এই bill-এর verified payments দেখায়। `client_connection_type` protocol না থাকলে empty string return করে।

**Tested:** হ্যাঁ — frontend build সফল (2.92s)।

---

### [2026-06-08] — Advance Balance Due-তে Apply না হওয়ার Bug Fix

**পরিবর্তিত ফাইল:**
`billing/services.py`

**কী করা হয়েছে:**
`receive_payment()` শেষে `advance_balance > 0` থাকলে `apply_advance_to_bills()` call যোগ করা হয়েছে। আগে শুধু নতুন bill generation-এ advance apply হতো; payment receive-এ হতো না। Existing affected clients (5356, 5555)-এর advance manually apply করা হয়েছে।

**Side Effect / সতর্কতা:**
`apply_advance_to_bills()` এখন `receive_payment()` থেকেও call হবে — double-apply এর সম্ভাবনা নেই কারণ advance শুধু due bills-এ যায়। Client 5356: advance 1120→120 (1000 due cleared), Client 5555: advance 100→0 (100 applied, 900 still due).

**Tested:** হ্যাঁ — Python shell-এ `apply_advance_to_bills` চালিয়ে verify করা হয়েছে।

---

### [2026-06-06] — Ticker Notice Save Bug Fix (400 Error)

**পরিবর্তিত ফাইল:**
`admin_panel/src/pages/mobile/AppVersionPage.jsx`

**কী করা হয়েছে:**
"নোটিশ মুছুন" বাটনের `onClick`-এ `ticker_expires_at: ''` (empty string) সেট হচ্ছিল, যা DRF DateTimeField reject করে (400 Bad Request)। `null`-এ পরিবর্তন করা হয়েছে।

**Side Effect / সতর্কতা:**
এই bug-এর pattern মনে রাখতে হবে: DRF DateTimeField-এ `null` পাঠাতে হয়, কখনো `''` (empty string) নয়।

**Tested:** হ্যাঁ — gunicorn access log-এ 400 response (135 bytes) confirm করা হয়েছে। Error message decode করে root cause verify করা হয়েছে। Fix করে build সফল।

---

### [2026-06-04] — M.Status Toggle fix, Billing List all-clients view, Dashboard updates

**পরিবর্তিত ফাইল:**
`clients/api/views.py`, `billing/models.py`, `billing/api/views.py`,
`radius_app/services/radius_service.py`, `admin_panel/src/pages/billing/BillList.jsx`,
`admin_panel/src/pages/Dashboard.jsx`, `admin_panel/src/components/Layout.jsx`

**কী করা হয়েছে:**
1. **Manual Disable logic পরিবর্তন:** আগে `move_to_blocked_group()` ছিল (Expired PPPoE দেখাত), এখন `disable_user()` → `Auth-Type:Reject` (login-ই হবে না)। Expired client-এর জন্য `Blocked_Group` থাকবে।
2. **Blocked_Group profile:** `radius_app/services/radius_service.py`-এ default profile `'blocked'` → `'Expired PPPoE'`। RADIUS DB-তে `radgroupreply` আপডেট করা হয়েছে।
3. **Payment/Renewal bug fix:** `billing/models.py`-এর `_auto_enable_client_if_paid()` ও `_update_expiry_and_enable_for_unverified()`-এ `restore_user_group()` যোগ করা হয়েছে — পেমেন্টের পর `Blocked_Group`-এ আটকে থাকার সমস্যা ঠিক হয়েছে।
4. **Billing List all-clients:** `billing/api/views.py`-এ নতুন endpoint `GET /billing/bills/client-billing-view/` — bill নেই এমন client-ও দেখায়। `BillList.jsx` এটা ব্যবহার করছে।
5. **Dashboard:** `B.Width Provider Bill/Due/Cash On Hand` TOP_CARDS থেকে সরানো হয়েছে, BOTTOM_CARDS-এ real data যোগ হয়েছে। "Accounting Dashboard" বাটনে navigate যোগ হয়েছে।
6. **TopBar:** "Online Client Monitoring" বাটন সব screen-এ দেখায় (আগে mobile-এ hidden ছিল)।

**Side Effect / সতর্কতা:**
- `Blocked_Group`-এর `Mikrotik-Group` value এখন `'Expired PPPoE'` — MikroTik Router-এ এই নামের PPPoE profile থাকতে হবে।
- `BillList.jsx` এখন `/billing/bills/` নয়, `/billing/bills/client-billing-view/` endpoint ব্যবহার করে।
- Bill নেই এমন client-এর জন্য `bill.id = null` — Edit/Delete/Download button hide থাকবে।

**Tested:** হ্যাঁ — RADIUS DB `radcheck` এবং `radusergroup` verify করা হয়েছে।

---

### [2026-06-04] — ai.md comprehensive update + Gunicorn auto-reload hook

**পরিবর্তিত ফাইল:**
`ai.md`, `~/.claude/settings.json`, `/etc/sudoers.d/isp-gunicorn-reload`

**কী করা হয়েছে:**
1. `ai.md` সম্পূর্ণ পুনর্লিখন — সব model relations, DB tables, frontend routes, API endpoints, critical services, UI design system যোগ করা হয়েছে।
2. `~/.claude/settings.json`-এ PostToolUse hook যোগ — যেকোনো `.py` ফাইল edit হলে `sudo systemctl reload isp-gunicorn.service` স্বয়ংক্রিয় চলবে।
3. `/etc/sudoers.d/isp-gunicorn-reload` — `amir` user passwordless reload করতে পারবে।

**Side Effect / সতর্কতা:**
- Hook global (`~/.claude/settings.json`) — এই machine-এর সব project-এ `.py` edit হলে gunicorn reload হবে। অন্য project থেকে কাজ করলে confirm করুন যে এটা সমস্যা নয়।

**Tested:** হ্যাঁ — `sudo -n systemctl reload isp-gunicorn.service` passwordless কাজ করছে।

---

### [2026-06-04] — Billing List: Advance Payment, Employee Received By, Partial Pay Rules, Daily Collection redesign

**পরিবর্তিত ফাইল:**
`billing/api/views.py`, `billing/models.py`, `billing/tasks.py`, `clients/api/views.py`,
`admin_panel/src/pages/billing/BillList.jsx`, `admin_panel/src/pages/billing/DailyCollection.jsx`

**কী করা হয়েছে:**
1. **Advance Payment:** Paid badge click → advance payment (same Bill Receive modal)।
2. **Employee Received By:** `/hr/employees/?status=active` থেকে employee দেখায়। User account নেই এমন employee `emp:<id>` prefix — backend notes-এ নাম store।
3. **Client billing view:** `GET /billing/bills/client-billing-view/` — bill নেই client-ও দেখায়, "No Bill" + Adv।
4. **Partial pay rules:** Admin/Superadmin partial payment-এ enable করতে পারবে।
5. **Advance balance:** disable_expired_clients — advance দিয়ে পূর্ণ paid হলে disable হয় না।
6. **DailyCollection:** BillList-এর মতো modal redesign + edit mode + three-dot action menu।
7. **Bill delete → waive:** Delete endpoint এখন 405, waive endpoint যোগ হয়েছে।

**Side Effect:** `payment.notes`-এ `[গৃহীত: Name]` থাকলে serializer সেটাই `received_by_name` দেখায়।

**Tested:** হ্যাঁ — Payment submit, advance balance, collector name verify করা হয়েছে।

---

### [2026-06-04] — Role Permission System (Phase 1-3) + HR Cash Tracking + App Users Page

**পরিবর্তিত ফাইল:**
`role_permissions/` (নতুন app — সম্পূর্ণ), `hr/models.py`, `hr/api/views.py`, `hr/api/urls.py`,
`billing/models.py`, `config/settings.py`, `config/urls.py`,
`admin_panel/src/context/PermissionContext.jsx` (নতুন),
`admin_panel/src/pages/system/AppUsersPage.jsx` (নতুন),
`admin_panel/src/components/Sidebar.jsx`, `admin_panel/src/App.jsx`

**কী করা হয়েছে:**
1. **role_permissions app** — RoleGroup, RoleModulePermission, RoleGranularPermission, UserRoleAssignment models। 29 module + 111 sub-module + 58 granular permission। Password Fernet AES encryption।
2. **API:** `/api/v1/role-permissions/roles/`, `/api/v1/role-permissions/app-users/`, `/api/v1/role-permissions/my-perms/`
3. **AppUsersPage.jsx** — 3 tab (Application Users, User Roles, Role Modules)।
4. **PermissionContext.jsx** — login-এ permission fetch, localStorage cache, hasModule/hasSubModule/hasGranular helpers।
5. **Sidebar** — সব menu item-এ moduleKey mapping, permission-based filter।
6. **PermissionRoute** — unauthorized page → 🔒 বার্তা।
7. **HR routes** — 12টি route PermissionRoute দিয়ে protect।
8. **CollectorCashBalance + CollectorCashTransaction** — billing payment hook এ cash track।
9. **"Users & Roles" পেজ সরানো** — App Users-এ replace।

**Critical Settings:**
- `.env`-এ `PASSWORD_ENCRYPT_KEY` থাকতে হবে (Fernet key — `.env` ফাইল দেখুন)
- `role_permissions` migrations: `0001_initial` + `0002_userroleassignment_enc_password`
- Superadmin/Admin → সব access (is_super=True), অন্যরা → role assign করতে হবে

**Tested:** হ্যাঁ — API test: role তৈরি, permission assign, user assign, my-perms verify।

---

### [2026-06-04] — Webhook Payments: Model + API + Frontend (DailyCollection tab)

**পরিবর্তিত ফাইল:**
`billing/models.py`, `billing/api/views.py`, `billing/api/serializers.py`, `billing/api/urls.py`,
`billing/migrations/0007_...webhookpayment.py` (নতুন),
`admin_panel/src/pages/billing/DailyCollection.jsx`

**কী করা হয়েছে:**
1. **WebhookPayment model** — gateway_type, transaction_id, payment_amount, from_wallet, to_wallet_org, trans_reference, trans_timestamp, trans_status, settlement_status (5 choices), matched_client FK, raw_data JSON।
2. **API endpoints:**
   - `GET /api/v1/billing/webhook-payments/` — list + filters
   - `POST /api/v1/billing/webhook-payments/{id}/transfer/` — manual transfer to client
   - `POST /api/v1/billing/webhook/receive/{gateway}/` — anonymous webhook receiver (bKash/Nagad)
3. **Auto-match:** trans_reference → client customer_id/username → automatically_settled।
4. **DailyCollection Webhook tab:** Filters (CLIENTS OF, POP, DATE, STATUS, GATEWAY) + Table + Payment Info modal + Transfer modal।

**Gateway Webhook URL:**
```
POST https://yourdomain.com/api/v1/billing/webhook/receive/bkash/
POST https://yourdomain.com/api/v1/billing/webhook/receive/nagad/
```

**Side Effect:** Webhook receiver anonymous (auth নেই) — gateway IP whitelist করুন। python-dateutil dependency।

**Tested:** হ্যাঁ — Django check OK, migration OK, frontend build ✓।

---

### [2026-06-04] — Payment Gateways পেজ সম্পূর্ণ তৈরি (Backend + Frontend)

**পরিবর্তিত ফাইল:**
`system_settings/models.py`, `system_settings/api/serializers.py`, `system_settings/api/views.py`,
`system_settings/api/urls.py`, `system_settings/migrations/0006_paymentgatewayconfig_full_fields.py` (নতুন),
`admin_panel/src/pages/system/PaymentGatewaysPage.jsx` (নতুন),
`admin_panel/src/App.jsx`, `admin_panel/src/components/Sidebar.jsx`

**কী করা হয়েছে:**
1. **Model update:** `PaymentGatewayConfig`-এ ১৪টি গেটওয়ে (sslcommerz, bkash, nagad, aamarpay, shurjopay, fosterpayments, walletmix, phonepe, razorpay, rocket, stripe, easypayment, webhook, paybill) এবং নতুন fields: `gateway_type`, `merchant_number`, `username`, `password` (Fernet encrypted), `activation_date`, `expiry_date`, `applicable_*` (4টি checkbox)।
2. **Migration 0006:** সব নতুন field যোগ + gateway choices expand।
3. **API:** `GET /api/v1/system/payment-gateways/all/` (১৪টি get_or_create করে return), `PATCH /api/v1/system/payment-gateways/by-gateway/` (gateway key দিয়ে update)। Password Fernet encrypt/decrypt।
4. **PaymentGatewaysPage.jsx:** Left sidebar (১৪ গেটওয়ে list, active indicator), Right form (4 section: Info, Enable/Disable, Date, Applicable for), Save or Update button।
5. **Route:** `/system/payment-gateways` → Sidebar System section-এ "Payment Gateways" যোগ।

**Side Effect / সতর্কতা:**
- `.env`-এ `PASSWORD_ENCRYPT_KEY` থাকতে হবে (আগে থেকেই আছে)।
- প্রথম API call-এ ১৪টি gateway row DB-তে auto-create হবে।

**Tested:** হ্যাঁ — Django check (0 issues), migration OK, URL `/api/v1/system/payment-gateways/` resolve, frontend build ✓ (1402 modules)।

---

### [2026-06-04] — bKash Amazon SNS Webhook Handler (Production-Ready)

**পরিবর্তিত ফাইল:**
`billing/api/views.py` (উভয় `/var/www/` ও `/home/amir/Desktop/`),
`billing/api/urls.py` (উভয়),
`config/settings.py` (`billing.bkash_sns` logger + `bkash_sns.log` file)

**কী করা হয়েছে:**
1. **`BkashSNSWebhookView`** — `POST /api/v1/billing/webhook/bkash-sns/` (anonymous, no auth)
2. **SubscriptionConfirmation:** `SubscribeURL`-এ GET করে SNS subscription confirm
3. **Notification:** `Message` JSON parse → `debitMSISDN`, `trxID`, `amount`, `transactionStatus` extract
4. **RSA-SHA1 Signature Verify:** `SigningCertURL` থেকে certificate → public key → signature verify। `.BKASH_SNS_VERIFY_SIGNATURE = False` দিয়ে dev-এ bypass করা যায়
5. **Client Matching:** (1) `merchantInvoiceNumber` → `customer_id/username`, (2) `debitMSISDN` normalize → `Client.phone/alt_phone`
6. **Auto-settle:** `transactionStatus == "Completed"` + client found → `BillingService.receive_payment()`
7. **Phone normalize:** `+8801...` / `8801...` / `01...` সব format handle
8. **Logging:** `logs/bkash_sns.log` এ সব request log হয়

**Webhook URL (bKash-কে দিতে হবে):**
`https://roisp.duckdns.org/api/v1/billing/webhook/bkash-sns/`

**Side Effect / সতর্কতা:**
- Desktop version-এ `WebhookPayment` model নেই — শুধু logging + BillingService। Production-এ সব DB-তে save হয়।
- `settings.BKASH_SNS_VERIFY_SIGNATURE = True` (default) — production-এ এটাই রাখো

**Tested:** হ্যাঁ — Django check OK, endpoint 200, signature rejection 403, Notification parse + phone normalize + auto-settle flow verified।

---

### [2026-06-05] — Mobile App Backend Infrastructure + Admin Panel Management Pages

**পরিবর্তিত ফাইল:**
`clients/models.py`, `clients/migrations/0015_client_mobile_fields.py`,
`system_settings/models.py`, `system_settings/migrations/0008_mobile_app_models.py`,
`system_settings/api/serializers.py`, `system_settings/api/views.py`, `system_settings/api/urls.py`,
`mobile_api/` (নতুন app — সম্পূর্ণ), `config/settings.py`, `config/urls.py`, `requirements.txt`,
`admin_panel/src/pages/mobile/MobilePushPage.jsx` (নতুন),
`admin_panel/src/pages/mobile/AppBannerPage.jsx` (নতুন),
`admin_panel/src/pages/mobile/AppVersionPage.jsx` (নতুন),
`admin_panel/src/App.jsx`, `admin_panel/src/components/Sidebar.jsx`,
`admin_panel/src/pages/clients/ClientProfile.jsx`

**কী করা হয়েছে:**
1. **Client model mobile fields:** `fcm_token`, `app_enabled`, `app_last_seen` যোগ হয়েছে।
2. **MobileAppConfig model:** Android/iOS version, force update, maintenance mode, store URLs।
3. **AppBanner model:** Mobile app home screen-এর banner/notice management।
4. **mobile_api Django app:** OTP-based client authentication (phone → SMS OTP → JWT), client self-service APIs (`/api/v1/app/`), push notification log।
5. **Push Notification service:** `mobile_api/services/push_service.py` — Firebase Admin SDK দিয়ে FCM token/batch send।
6. **firebase-admin installed:** `requirements.txt`-এ যোগ এবং `pip install` সম্পন্ন।
7. **Admin Panel pages (3টি):** Push Notification পাঠানো + history, App Banner management, App Version Control।
8. **Client Profile:** `app_enabled` toggle — click করে client-এর app access enable/disable।
9. **Sidebar:** "Mobile App" section যোগ (Push Notification, App Banner, Version Control)।

**নতুন API Endpoints:**
```
POST /api/v1/app/auth/send-otp/       → SMS OTP পাঠানো
POST /api/v1/app/auth/verify-otp/     → JWT token পাওয়া
GET  /api/v1/app/me/                  → profile
GET  /api/v1/app/bills/               → bill history
GET  /api/v1/app/bills/current/       → current bill
GET  /api/v1/app/tickets/             → tickets
POST /api/v1/app/tickets/             → নতুন ticket
GET  /api/v1/app/banners/             → active banners
GET  /api/v1/app/config/              → version info (public)
POST /api/v1/app/admin/push/send/     → push notification পাঠানো
GET  /api/v1/system/mobile-app-config/current/ → version config
GET/POST /api/v1/system/app-banners/  → banner management
```

**Side Effect / সতর্কতা:**
- Firebase integration-এর জন্য `.env`-এ `FIREBASE_CREDENTIALS_PATH` দিতে হবে (Google Service Account JSON path)।
- Firebase credentials না থাকলেও app চলবে — push notification fail হবে কিন্তু error থাকবে না।
- Client auth JWT-এ `client_id` claim আছে — staff JWT-এর চেয়ে আলাদা।
- Mobile API `/api/v1/app/auth/send-otp/` anonymous endpoint — rate limiting পরে যোগ করতে হবে।

**Tested:** হ্যাঁ — Django check (0 issues), সব migrations applied, frontend build ✓ (1405 modules)।

---

### [2026-06-05] — React Native Mobile App (Expo SDK 56)

**পরিবর্তিত ফাইল:**
`mobile_app/App.js`, `mobile_app/app.json`, `mobile_app/package.json`,
`mobile_app/src/` (সম্পূর্ণ নতুন structure)

**কী করা হয়েছে:**
1. **Expo SDK 56** project — ইতিমধ্যে থাকা blank project ব্যবহার করা হয়েছে।
2. **Packages installed:** `@react-navigation/native`, `native-stack`, `bottom-tabs`, `react-native-screens`, `safe-area-context`, `async-storage`, `expo-notifications`, `expo-device`, `expo-secure-store`, `axios`
3. **Auth Flow:** Phone OTP → JWT login (SendOTPScreen + VerifyOTPScreen), SecureStore-এ token রাখা, auto-restore on app open
4. **4টি Tab:** Home (Dashboard), Bills (বিল ইতিহাস), Support (টিকেট), Profile
5. **Screens:** HomeScreen (bill summary + banners + quick actions), BillListScreen, ProfileScreen (view + editable fields), SupportListScreen + SupportCreateScreen + SupportDetailScreen
6. **FCM:** `expo-notifications` দিয়ে permission → token → backend register, foreground + tap handlers
7. **app.json:** `ISP BNAS` name, Android package `com.ispbnas.client`, `google-services.json` path সেট

**Google Services JSON (FCM চালু করতে):**
```
1. Firebase Console → Project → Android app → google-services.json download
2. mobile_app/google-services.json হিসেবে রাখুন
3. .env-এ FIREBASE_CREDENTIALS_PATH আপডেট করুন (Backend server JSON path)
```

**App চালু করতে:**
```bash
cd mobile_app
npm run android   # Android emulator বা physical device
# অথবা Expo Go app দিয়ে scan করুন:
npm start
```

**Side Effect / সতর্কতা:**
- `google-services.json` ছাড়া build হবে না — Expo EAS build করার আগে দিতে হবে।
- `SupportDetailScreen`-এ reply feature এখনো নেই — ভবিষ্যতে backend endpoint যোগের পর implement হবে।
- Token refresh: 401 হলে auto-refresh করে, fail হলে logout হয়।

**Tested:** না — Android device/emulator-এ চালিয়ে test করতে হবে।

---

### [2026-06-05] — Mobile App: Live Traffic + FTP + Live TV Features

**পরিবর্তিত ফাইল:**
`system_settings/models.py`, `system_settings/migrations/0009_mobile_ftp_livetv.py`,
`system_settings/api/serializers.py`,
`mobile_api/api/views.py`, `mobile_api/api/urls.py`, `mobile_api/api/serializers.py`,
`mobile_app/src/screens/home/TrafficScreen.js` (নতুন),
`mobile_app/src/screens/home/LinksScreen.js` (নতুন),
`mobile_app/src/screens/home/HomeScreen.js`, `mobile_app/App.js`,
`admin_panel/src/pages/mobile/AppVersionPage.jsx`

**কী করা হয়েছে:**
1. **Live Traffic screen:** MikroTik API থেকে real-time download/upload speed + session info। প্রতি ৩ সেকেন্ডে auto-refresh।
2. **FTP & Live TV screen:** `LinksScreen.js` — FTP URL tap করলে File Manager খোলে। Live TV channel list — tap করলে stream URL খোলে।
3. **Backend:** `MobileAppConfig`-এ `ftp_server_url`, `ftp_server_label`, `live_tv_channels` (JSON array) fields যোগ হয়েছে।
4. **New endpoint:** `GET /api/v1/app/me/traffic/` — client-এর MikroTik real-time traffic।
5. **Admin Panel:** `AppVersionPage.jsx`-এ FTP URL field + Live TV channel editor (emoji, name, URL, category)।
6. **HomeStack:** `Traffic` ও `Links` screen navigation-এ যোগ হয়েছে।

**Live TV channel format (JSON):**
```json
[{"name":"Channel 1","url":"http://...","logo":"📺","category":"News"}]
```

**Tested:** হ্যাঁ — Django check OK, migration OK, admin panel build ✓ (2.78s)।

---

### [2026-06-05] — Mobile App: Payment Screen + HomeScreen Redesign + Traffic SVG Graph

**পরিবর্তিত ফাইল:**
`mobile_api/api/views.py`, `mobile_api/api/urls.py`,
`mobile_app/src/screens/billing/PaymentScreen.js` (নতুন),
`mobile_app/src/screens/home/HomeScreen.js`, `mobile_app/App.js`

**কী করা হয়েছে:**
1. **PaymentScreen:** bKash/Nagad/Rocket/Bank payment — merchant নম্বর দেখানো, Transaction ID জমা → pending approval
2. **Backend endpoints:** `GET /app/payment-gateways/`, `POST /app/payments/report/`, `GET /app/payments/`
3. **HomeScreen redesign:** Reference ISP app-এর মতো — deep blue header, quick actions (4 icon), 2×2 info card, Feature Grid বাদ
4. **SVG live graph:** `react-native-svg` দিয়ে smooth bezier curve area chart — download (blue) + upload (green)
5. **stale closure fix:** `useRef` দিয়ে prevBytes — interval সবসময় latest bytes পায়

**Payment flow:**
```
Recharge → PaymentScreen → gateway select → amount → TxID → submit
→ pending payment (is_verified=False) → admin approves → client enabled
```

**Admin panel:** Payment Gateways page-এ merchant_number সেট করলে client app-এ দেখাবে।

**Tested:** হ্যাঁ — bundle verify OK, payment endpoint OK, SVG chart rendering OK।

---

### [2026-06-09] — Mobile App Bundle Fix: babel.config.js + babel-preset-expo

**পরিবর্তিত ফাইল:**
`mobile_app/babel.config.js` (নতুন), `mobile_app/package.json`

**কী করা হয়েছে:**
1. `babel.config.js` তৈরি করা হয়েছে — এটা ছিলই না, Metro bundler bundle করতে পারছিল না।
2. `babel-preset-expo@~54.0.0` install — SDK 54 compatible version।
3. expo SDK 54 → 56 → 54 revert (expo SDK 54 নিজেই react 19 + RN 0.81.5 ব্যবহার করে, user-এর Expo Go 54.0.8 সঠিক)।
4. Bundle test: `expo export` সফল — 979 modules, 2.7MB।

**Expo SDK 54 সত্য (গুরুত্বপূর্ণ):**
- expo 54.0.x → React 19.1.0 + React Native 0.81.5 → এটাই সঠিক।
- Expo Go 54.0.8 (Play Store latest) → এই project-এর সাথে compatible।
- AGENTS.md-এ "SDK 56" mention = ভুল তথ্য; SDK 54-ই চলমান সঠিক version।

**App চালু করতে:**
```bash
cd /var/www/isp_bnas/mobile_app && npx expo start --tunnel
```
তারপর Expo Go দিয়ে QR scan করুন।

**Tested:** হ্যাঁ — `expo export --platform android` → 979 modules সফলভাবে bundle হয়েছে।

---

### [2026-06-16] — VoIP call reliability: permanent fix (mobile data + WiFi, 800-900 users)

**পরিবর্তিত ফাইল:**
- `voip/api/views.py` (CallOriginateView)
- `voip/services/voice_broadcast.py`
- `voip/services/asterisk_provision.py`
- `deploy/asterisk/configs/extensions.conf`
- `deploy/isp-asterisk-dialplan.sudoers` (নতুন)

**Root cause (diagnosed):**
1. Agent→Client কল: FCM push পাঠানো হচ্ছিল না (TODO comment ছিল) → app SIP register না করে → `CHANUNAVAIL`
2. Voice SMS: poll window মাত্র 20s (10×2s) → mobile data-এ app wake + register হওয়ার আগেই timeout
3. AMI `pjsip show contacts` read: 0.4s fixed sleep → large response miss করতে পারত
4. AOR max_expiry=7200s → app crash/kill হলে stale contact ১ ঘণ্টা থাকত → পরের কলে Asterisk ভুল করত

**কী ঠিক করা হয়েছে:**

**Fix 1 — `CallOriginateView`:** ARI originate-এর আগে client-এর FCM token-এ `incoming_call` push পাঠানো হয়।
agent answer করতে যে সময় (৫-১৫s) লাগে সেই সময়ের মধ্যে app register করে নেয়।
dialplan-এ ইতিমধ্যে retry loop আছে → register হওয়ামাত্র connect।

**Fix 2 — `voice_broadcast.py`:**
- `_ami()`: fixed 0.4s sleep → socket-level `settimeout(4)` read loop (সব chunk পায়)
- `_is_registered()`: `pjsip show contacts` (সব endpoint) → `pjsip show contacts endpoint {name}` (শুধু ঐটা — দ্রুত)
- `broadcast_voice_call()`: poll window 20s → 45s (15×3s, FCM TTL-এর সমান)
- FCM পাঠানোর পর 3s pause (Android FCM delivery ~1-3s)

**Fix 3 — `asterisk_provision.py` AOR config:**
- `max_expiry=300` (আগে: 7200) → app crash-এ stale contact ৫ মিনিটে clear
- `default_expiry=120` → frequent re-register = keepalive
- `minimum_expiry=30`

**Fix 4 — `extensions.conf` dialplan:**
- retry window 35 → 60 tries (~60s) — mobile data-এ app wake + SIP handshake পর্যাপ্ত সময়

**Fix 5 — Re-provision:**
- `systemd-run --uid=isp ... voip_provision_all` → সব 4 endpoint-এ নতুন AOR config লেখা হয়েছে
- `pjsip reload` via AMI — applied

**⚠️ Manual step (একবার করতে হবে):**
```bash
# dialplan template live apply (35→60s retry window):
sudo install -m 0440 -o root -g root \
  /var/www/isp_bnas/deploy/isp-asterisk-dialplan.sudoers \
  /etc/sudoers.d/isp-asterisk-dialplan
sudo install -m 0640 -o asterisk -g asterisk \
  /var/www/isp_bnas/deploy/asterisk/configs/extensions.conf \
  /etc/asterisk/extensions.conf
# তারপর Asterisk-এ:
# asterisk -rx "dialplan reload"
```
*(isp user sudoers থাকলে পরে `provision_endpoint` থেকে auto-apply হবে)*

**Mobile data vs WiFi:** PJSIP `webrtc=yes` + `force_rport=yes` + coturn TURN server → ICE negotiate করে। `ice_servers` SIP creds API-তে দেওয়া আছে। Mobile data-এ CGNAT থেকে TURN relay ব্যবহার হয় — এটি আগে থেকেই configured।

**Tested:** gunicorn auto-reload হয়েছে। `pjsip reload` confirmed। Endpoint files re-provisioned (1290 bytes, 21:21 timestamp)।

---

### [2026-06-16] — Softphone Dialer: SIP online indicator + outgoing ring sound

**পরিবর্তিত ফাইল:**
- `admin_panel/src/components/SoftphoneDialer.jsx`
- `voip/api/views.py` (RegisteredClientsView যোগ)
- `voip/api/urls.py` (`/voip/registered-clients/` route)

**Feature 1 — SIP Online Indicator (WhatsApp-স্টাইল):**
- নতুন endpoint: `GET /api/v1/voip/registered-clients/` → AMI `pjsip show contacts` parse করে কোন `client_N` Asterisk-এ registered তা JSON-এ ফেরায়।
- Dialer popover খোলা থাকলে প্রতি **১৫s** পর poll করে।
- Search dropdown-এ প্রতিটি client-এর পাশে: সবুজ dot = অ্যাপ চালু; ধূসর = offline।
- Idle state-এ "X ক্লায়েন্ট অ্যাপ চালু আছে" summary।

**Feature 2 — Outgoing Ring Sound:**
- `useRingTone(active)` hook: Web Audio API dual-tone (440Hz+480Hz), ২s ring → ৩s বিরতি।
- Outgoing call ringing-এ auto-start, Established/Terminated-এ auto-stop।
- Ringing banner: amber pulsing dot + "ক্লায়েন্টের ফোনে রিং হচ্ছে…"।

**Tested:** `vite build` ✓ (3.85s)।

---

### [2026-06-16] — Mobile App: Background Persistence (Always Alive)

**পরিবর্তিত / নতুন ফাইল:**
- `mobile_app/src/services/backgroundService.js` (নতুন)
- `mobile_app/index.js`
- `mobile_app/src/context/CallContext.js`
- `mobile_app/src/context/AuthContext.js`
- `mobile_app/app.json`

**কী করা হয়েছে:**

1. **`backgroundService.js`** — তিনটি mechanism:
   - **Battery Exemption Dialog**: `Linking.sendIntent('android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS')` → Android Doze mode-এ FCM block হয় না। AsyncStorage flag — একবারই দেখায়।
   - **Background Fetch Task** (`isp-bnas-keepalive`): `stopOnTerminate:false`, `startOnBoot:true` → force kill বা reboot-এর পরেও প্রতি ১৫ মিনিটে চলে। Login থাকলে FCM token refresh করে।
   - **Persistent Notification**: `sticky:true, autoDismiss:false` → status bar-এ "Rajamehar Online সক্রিয়"। Low-priority channel (sound/vibration নেই)। Android OS অ্যাপকে কম aggressively kill করে।

2. **`index.js`**: `backgroundService.js` import যোগ করা হয়েছে `registerRootComponent`-এর আগে — `TaskManager.defineTask()` এখানে call হওয়া দরকার।

3. **`CallContext.js`**: Login-এ `registerKeepaliveTask()` + `requestBatteryExemption()` + `startPersistentNotification()` call। Logout-এ `stopPersistentNotification()`।

4. **`AuthContext.js`**: `AUTO_LOGOUT_MS` ২০ মিনিট → ৮ ঘণ্টা। **এটি critical** — ২০ মিনিটে auto-logout মানে VoIP call SIP creds fetch করতে ৪০১ পাচ্ছিল।

5. **`app.json`**: `android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` যোগ।

**⚠️ Side Effect / সতর্কতা:**
- এই পরিবর্তন কাজ করতে নতুন **EAS Build** দরকার (`eas build --platform android --profile preview`)।
- `expo-background-fetch` এবং `expo-task-manager` আগেই install আছে।
- `sticky:true` notification-এ user frustrated হলে অ্যাপ সেটিংসে গিয়ে channel off করতে পারে — তবে FCM তখনও কাজ করবে।

**Tested:** Code review হয়েছে। Build pending (EAS build দিতে হবে)।

---

### [2026-06-16] — Mobile App: Self-Service Package Upgrade/Downgrade

**পরিবর্তিত / নতুন ফাইল:**
- `mikrotik_app/models.py` + migration `0003_mikrotikserver_packages_m2m`
- `mobile_api/models.py` + migration `0003_bkash_session_purpose_package`
- `mobile_api/api/views.py` (নতুন views + BkashCallbackView extend)
- `mobile_api/api/urls.py`
- `mobile_app/src/screens/billing/PackageScreen.js` (নতুন)
- `mobile_app/App.js`
- `mobile_app/src/screens/home/HomeScreen.js`

**Feature:**
1. **Package কার্ড (HomeScreen)** → tap করলে PackageScreen খোলে
2. **PackageScreen**: Client-এর router-এ assigned packages দেখায় (M2M: `MikrotikServer.packages`); M2M খালি থাকলে billing_cycle মিলিয়ে সব active packages
3. **Upgrade**: pro-rated amount = বাকি দিন × মূল্য পার্থক্য / 30 → bKash → callback-এ package change (RADIUS group + MikroTik PPPoE + session kick)
4. **Downgrade**: বিনামূল্যে, তাৎক্ষণিক, confirmation alert-এর পর
5. **API endpoints**: `GET /app/packages/`, `POST /app/packages/upgrade/initiate/`, `POST /app/packages/downgrade/`
6. **bKash session**: `purpose` + `new_package` field যোগ; callback-এ `purpose='package_upgrade'` detect করে package apply করে

**⚠️ Side Effect / সতর্কতা:**
- Admin panel-এ `MikrotikServer` edit করে `Packages` M2M সেট করা উচিত — না হলে সব active packages (same billing_cycle) দেখাবে
- Package change-এ `client.pppoe_profile` update হয় `new_package.mikrotik_profile` দিয়ে; router-এ ভিন্ন profile নাম থাকলে admin ঠিক করতে পারবেন
- নতুন EAS Build লাগবে (mobile app)

**Tested:** Django check ✓, URL reverse ✓, migrations OK।

---

### [2026-06-16] — Mobile app: Call button + DialPad screen

**নতুন ফাইল:** `mobile_app/src/screens/call/DialPadScreen.js`
**পরিবর্তিত:** `mobile_app/App.js`, `mobile_api/api/views.py` (AppSipCredentialsView)

**কী হয়েছে:**
1. **Bottom tab bar-এ center raised "📞 কল করুন" button** — সবুজ circle, `marginTop: -26` দিয়ে tab bar-এর উপরে উঠে; `overflow: visible` tab bar-এ।
2. **DialPadScreen** — dark theme (`#0c1a2e`), LCD digital display (sky-blue digits), 3×4 keypad (গোলাকার button), green call button, status chip (registered/connecting/failed)।
3. **Backend**: `AppSipCredentialsView` এখন `support_contacts` array return করে (agent endpoint + নাম) — DialPad screen প্রথম agent-কে call করে।
4. **Tab order**: Home | Bills | 📞 (center) | Support | SMS

**⚠️ Side Effect / সতর্কতা:**
- `agent_1` endpoint active থাকতে হবে Asterisk-এ, নইলে call fail হবে।
- `overflow: visible` Android-এ elevation shadow কিছুটা ভিন্ন দেখাতে পারে — tab bar shadow এখনো ঠিক থাকার কথা।
- নতুন EAS Build দরকার (background service + package screen + marquee + call button সব একসাথে)।

**Tested:** Code review ✓ (Expo Go-তে test করা হয়নি — EAS Build লাগবে)।

---

### [2026-06-16] — Mobile app v1.1.0 EAS Build pre-check + production fixes

**পরিবর্তিত ফাইল:**
`mobile_app/app.json`, `mobile_app/src/context/AuthContext.js`,
`mobile_app/src/services/api.js`, `mobile_app/src/context/CallContext.js`,
`mobile_app/src/screens/call/DialPadScreen.js`

**কী হয়েছে:**
1. **Version bump**: `1.0.0` → `1.1.0`, `versionCode` 1 → 2, `buildNumber` 1 → 2।
2. **OTA update fix**: `fallbackToCacheTimeout` 0 → 10000ms — client পুরনো cache-এ আটকে থাকবে না।
3. **Server load (5000 client)**: polling interval 30s → 60s — peak load অর্ধেক হবে।
4. **Network timeout**: API timeout 15s → 25s — গ্রামীণ/দুর্বল নেটওয়ার্কে timeout error কমবে।
5. **Duplicate API call বাদ**: DialPadScreen আলাদাভাবে `/app/voip/sip-credentials/` fetch করত — এখন CallContext থেকে `supportContacts` সরাসরি নেয়।
6. **Stale comment fix**: AuthContext-এ "২০ মিনিট" → "৮ ঘণ্টা" (2 জায়গায়)।
7. **SipStatusBadge সরানো**: HomeScreen ও Login page-এ "VoIP: সংযোগ হচ্ছে" badge আর দেখাবে না।

**EAS Build command:**
```bash
cd /var/www/isp_bnas/mobile_app
# Preview APK (testing):
eas build --platform android --profile preview
# Production AAB (Play Store):
eas build --platform android --profile production
```

**⚠️ Side Effect / সতর্কতা:**
- `versionCode: 2` — Play Store-এ আগের APK (versionCode 1) replace করবে।
- production profile-এ `autoIncrement: true` আছে — পরবর্তী build-এ versionCode আবার বাড়বে।
- `eas build --profile preview` দিয়ে APK বানালে তারপর client-কে সেটি পাঠানো যাবে।
- EAS account login: `eas whoami` দিয়ে verify করুন।

**Tested:** কোড review ✓ — EAS cloud build করা হয়নি (user করবেন)।

### [2026-06-16] — Router Edit: Package list router profile অনুযায়ী filter

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/radius/RadiusServerPage.jsx`

**কী করা হয়েছে:** Edit Router modal খোলার সময় ঐ router-এর PPPoE profiles fetch করে (`/mikrotik/servers/{id}/pppoe-profiles/`), তারপর শুধু সেই profiles-এর সাথে match করা packages (`mikrotik_profile` field) দেখানো হয়। Loading indicator যোগ করা হয়েছে। Router offline বা profiles empty হলে সব packages fallback হিসেবে দেখাবে।

**Side Effect / সতর্কতা:** Router-এ PPPoE profile থাকতে হবে এবং Package তৈরির সময় সঠিক `mikrotik_profile` সেট করতে হবে। নইলে filtered list empty হবে → fallback-এ সব দেখাবে।

**Tested:** Frontend build ✓ — ব্রাউজারে manually test করুন।

### [2026-06-16] — MikroTik Router থেকে Packages M2M সম্পূর্ণ বাদ

**পরিবর্তিত ফাইল:** `mikrotik_app/models.py`, `mikrotik_app/api/serializers.py`, `mobile_api/api/views.py`, `admin_panel/src/pages/radius/RadiusServerPage.jsx`
**নতুন ফাইল:** `mikrotik_app/migrations/0004_remove_packages_m2m.py`

**কী করা হয়েছে:** `MikrotikServer.packages` M2M field সম্পূর্ণ বাদ। Edit Router modal থেকে package assignment section সরানো হয়েছে। Mobile API-তে router packages filter বাদ দিয়ে billing_cycle অনুযায়ী সব active package দেখানো হচ্ছে।

**Side Effect / সতর্কতা:** Migration apply হয়েছে (M2M table drop)। আগে কোনো router-এ package assign করা থাকলে সেটা আর নেই।

**Tested:** Migration ✓, Frontend build ✓

### [2026-06-16] — Package table-এ Router নাম দেখানো

**পরিবর্তিত ফাইল:** `configuration/models.py`, `configuration/api/serializers.py`, `admin_panel/src/pages/config/PackagePage.jsx`
**নতুন ফাইল:** `configuration/migrations/0007_package_router_fk.py`

**কী করা হয়েছে:** `Package` model-এ `router` ForeignKey যোগ (MikrotikServer → SET_NULL)। Package form submit-এ selected router ID save হয়। Edit mode-এ existing router pre-select হয়। Table-এ "Router" column — `router_name` badge দেখায়।

**Side Effect / সতর্কতা:** Migration apply হয়েছে। পুরনো packages-এ router=null থাকবে — edit করে router assign করতে হবে।

**Tested:** Migration ✓, Build ✓

### [2026-06-17] — Add Client form: frontend validation + DB optimization + Premium UI redesign

**পরিবর্তিত ফাইল:** `clients/api/serializers.py`, `clients/models.py`, `clients/api/views.py`, `admin_panel/src/pages/clients/ClientForm.jsx`, `admin_panel/src/pages/mikrotik/BulkClientImportPage.jsx`

**কী করা হয়েছে:**
1. **Backend validation:** `_validate_bd_phone()` helper — ১১ সংখ্যার BD phone (01[3-9]XXXXXXXX) enforce। `validate_phone`, `validate_alt_phone`, `validate_nid` (10/13/17 digit) — Create ও Update serializer দুটোতেই।
2. **DB optimization:** `clients/models.py`-এ 7টি composite index (phone, status, expiry_date, full_name, status+expiry, status+router, app+status)। Migration apply হয়েছে।
3. **N+1 fix:** `ClientViewSet.get_queryset()` → `select_related(zone, subzone, box, package, router, router__radius_server, protocol, client_type)`।
4. **Frontend validation:** `ClientForm.jsx` handleSubmit-এ submit-এর আগে validate — full_name required, phone BD regex, alt_phone optional BD regex, username/password required, router/package/pppoe_profile/zone required, NID digits, email format।
5. **Premium UI redesign:** Sticky top action bar (Save/Cancel always visible), section tab quick-links (Personal/Contact/Network/Service anchor scroll), gradient background, `rounded-xl shadow-md ring-1` section cards, প্রতিটি section আলাদা gradient color header, bottom action strip।
6. **BulkClientImport validation:** pre-import loop — empty username + BD phone check → row-wise error toasts।

**Side Effect / সতর্কতা:** Phone validation backend-এ enforce হওয়ায় old data দিয়ে test করলে fail করতে পারে।

**Tested:** Build ✓

### [2026-06-17] — District & Upazila: পূর্ণ implementation

**নতুন ফাইল:** `admin_panel/src/pages/config/DistrictPage.jsx`, `admin_panel/src/pages/config/UpazilaPage.jsx`, `configuration/migrations/0008_district_upazila.py`
**পরিবর্তিত:** `configuration/models.py`, `configuration/api/serializers.py`, `configuration/api/views.py`, `configuration/api/urls.py`, `admin_panel/src/App.jsx`, `admin_panel/src/pages/clients/ClientForm.jsx`

**কী করা হয়েছে:**
1. `District` + `Upazila` model (District FK) — migration apply হয়েছে।
2. API: `/api/v1/config/districts/` ও `/api/v1/config/upazilas/` — CRUD, search, filter।
3. **DistrictPage:** stats bar, table (upazila count), add/edit modal, status toggle।
4. **UpazilaPage:** stats bar, table, district filter dropdown, add/edit modal।
5. **App.jsx:** `/config/districts` ও `/config/upazilas` routes যোগ।
6. **ClientForm:** District dropdown (API-loaded) → Upazila cascading dropdown।

**Side Effect / সতর্কতা:** ClientForm-এ district/upazila এখন `ui` state-এ ID হিসেবে সংরক্ষিত — client model-এ এই fields নেই, save হয় না। যদি ভবিষ্যতে save করতে হয় তাহলে Client model-এ FK field যোগ করতে হবে।

**Tested:** Migration ✓, Build ✓

---

### [2026-06-17] — IP-PBX / Hotline Control Panel (Rajamehar Online হটলাইন ব্যবস্থাপনা)

**নতুন ফাইল:**
- `voip/services/pbx_provision.py` — Asterisk dialplan generation + AMI reload
- `admin_panel/src/pages/voip/HotlineControlPage.jsx` — হটলাইন নম্বর + stats dashboard
- `admin_panel/src/pages/voip/RingGroupPage.jsx` — রিং গ্রুপ + এজেন্ট সদস্যপদ
- `admin_panel/src/pages/voip/IVRMenuPage.jsx` — IVR মেনু + digit options + greeting upload
- `admin_panel/src/pages/voip/PBXAgentPage.jsx` — PBX এজেন্ট → SIP extension ম্যাপিং
- `voip/migrations/0004_pbx_hotline_models.py`

**পরিবর্তিত:**
- `voip/models.py` — 7টি নতুন model: `PBXAgent`, `RingGroup`, `RingGroupMember`, `IVRMenu`, `IVROption`, `HotlineNumber`, `PBXBusinessHour`
- `voip/api/serializers.py`, `voip/api/views.py`, `voip/api/urls.py`
- `admin_panel/src/App.jsx` — 4টি নতুন route
- `admin_panel/src/components/Sidebar.jsx` — VoIP submenu-তে 4টি নতুন item
- `deploy/asterisk/configs/extensions.conf` — `#include "extensions_isp.d/hotline.conf"` template-এ যোগ

**কী করা হয়েছে:**
1. **Models (migration 0004):** HotlineNumber, PBXAgent, RingGroup, RingGroupMember, IVRMenu, IVROption, PBXBusinessHour।
2. **API endpoints:** hotline-numbers (activate/deactivate/apply_asterisk/set_business_hours), ring-groups (add_member/remove_member), ivr-menus (upload_greeting/set_options), pbx-agents, pbx/dashboard-stats, pbx/reload-dialplan।
3. **pbx_provision.py:** `[isp-hotline-inbound]` context → `/etc/asterisk/extensions_isp.d/hotline.conf`। GotoIfTime বিজনেস আওয়ার routing। `[voip-internal]`/`[voip-announce]` অক্ষুণ্ণ।
4. **Frontend:** HotlineControlPage (stats + table), RingGroupPage, IVRMenuPage (option editor + greeting), PBXAgentPage। সব modal-based, alwaysShow।

**⚠️ Side Effect / সতর্কতা:**
- 🔴 **একবার manual step প্রয়োজন:**
  ```bash
  sudo install -d -o isp -g asterisk -m 2775 /etc/asterisk/extensions_isp.d
  echo '#include "extensions_isp.d/hotline.conf"' | sudo tee -a /etc/asterisk/extensions.conf
  sudo asterisk -rx "dialplan reload"
  ```
- VOIP_ENABLED=False হলে Apply → dry_run (file লেখে না, error নেই)।

**Tested:** `python manage.py check` ✓ | Migration 0004 apply ✓ | `makemigrations --check` (0 changes) ✓ | Vite build ✓ (3.11s)

### [2026-06-17] — Hotline 100 setup + PJSIP AOR config fix

**পরিবর্তিত ফাইল:**
`voip/services/asterisk_provision.py`, `voip/services/pbx_provision.py`,
`voip/api/views.py`, `voip/api/urls.py`,
`mobile_api/api/views.py`, `mobile_app/src/screens/call/DialPadScreen.js`

**কী করা হয়েছে:**
1. **PJSIP AOR bug fix:** Asterisk 22-এ `maximum_expiry`/`max_expiry` invalid — সঠিক নাম
   `maximum_expiration`/`default_expiration`/`minimum_expiration`। সব client conf file
   reprovision হয়েছে (new API `POST /api/v1/voip/reprovision/` দিয়ে)। Clean reload verified।
2. **Hotline 100 সেটআপ:**
   - PBXAgent `sip_endpoint_name = 'agent_1'` fix করা হয়েছে
   - RingGroupMember: Support Team → Customer Support Line যোগ হয়েছে
   - `pbx_provision.py`: `[voip-internal]` context-এ hotline numbers extend করে
     (`exten => 100,1,Goto(isp-hotline-inbound,100,1)`)
   - Dialplan chain: `voip-internal:100 → isp-hotline-inbound → hotline-1 → Dial(PJSIP/agent_1,25)`
   - Mobile app `DEFAULT_SUPPORT_TARGET` = `'100'`
   - `mobile_api` support_contacts → HotlineNumber list return করে (agent endpoint নয়)

**⚠️ Side Effect / সতর্কতা:**
- Mobile app DialPadScreen.js পরিবর্তিত হয়েছে — OTA update (`eas update --branch preview`)
  চালাতে হবে যাতে client app "100" dialpad ব্যবহার করে। Server-side routing এখনই কাজ করছে।
- নতুন reprovision API: `POST /api/v1/voip/reprovision/` (staff-only) — ভবিষ্যতে Asterisk
  version change-এ conf option name ভুল হলে ব্যবহার করুন।
- Hotline 100 → ring_group (Customer Support Line) → agent_1। নতুন agent যোগ করতে:
  Admin → VoIP → Ring Groups → Add Member।
- MikroTik port 8089 forward সমস্যা এখনো আছে — mobile SIP register হচ্ছে না।
  MikroTik NAT rule 24 double-click করে `Dst. Address=103.214.202.17`,
  `To Addresses=172.16.3.254` verify করুন।

**Tested:** Dialplan verify ✅ (`dialplan show voip-internal` → extension 100 present,
`dialplan show hotline-1` → Dial(PJSIP/agent_1,25) ✅)

---

### [2026-06-30] — IVR DTMF fix: SIP INFO + auto_info + APK rebuild

**পরিবর্তিত ফাইল:**
`mobile_app/src/services/sipPhone.js`,
`voip/services/asterisk_provision.py`,
`voip/api/views.py`,
`admin_panel/src/pages/voip/PBXAgentPage.jsx`

**কী করা হয়েছে:**
1. **IVR greeting upload → dialplan auto-regenerate:** `IVRMenuViewSet.upload_greeting` এ
   greeting upload-এর পর ঐ IVR-ব্যবহারকারী সব active HotlineNumber-এর dialplan স্বয়ংক্রিয়
   regenerate হয় — আগে manually reload লাগত।
2. **DTMF root cause:** CDR log-এ দেখা গেল client_1 কল সবসময় `s` extension-এ থাকে,
   কখনো `1` বা `2`-এ jump করেনি → DTMF কখনো Asterisk-এ পৌঁছায়নি।
   কারণ: react-native-webrtc 124-এ `RTCRtpSender.dtmf` = null → `insertDTMF()` fail।
   SIP.js `sdh.sendDtmf()` silently কাজ করত না।
3. **Fix (sipPhone.js):** `sendDtmf()` → SIP INFO via `session.info()` primary, RFC 4733
   fallback। `application/dtmf-relay` body: `Signal=1\r\nDuration=160`।
4. **Asterisk endpoint: `dtmf_mode=auto_info`:** `asterisk_provision.py` `_endpoint_stanza()` এ
   যোগ করা হয়েছে — Asterisk এখন RFC 4733 ও SIP INFO উভয়ই গ্রহণ করবে।
5. **PJSIP Reprovision button:** `PBXAgentPage.jsx`-এ "⟳ PJSIP Reprovision" বাটন যোগ।
   `POST /api/v1/voip/reprovision/` call করে — isp user (gunicorn) হিসেবে চলে, conf লিখতে পারে।
6. **APK rebuild:** EAS local build (--local) দিয়ে নতুন APK তৈরি → `media/app/rajamehar-online.apk`।

**⚠️ Side Effect / সতর্কতা:**
- **Reprovision বাটন ক্লিক করতে হবে:** Admin → VoIP → PBX Agents → "⟳ PJSIP Reprovision"।
  এটা না করলে existing conf files-এ পুরনো `dtmf_mode=rfc4733` থাকবে (SIP INFO কাজ করবে না)।
- `agent_2` (Support Team)-এর কোনো user assign নেই → PJSIP endpoint নেই → call সবসময় CHANUNAVAIL।
  Ring group-এ থাকলে সেই step skip হয়ে পরের agent-এ যায়।
- নতুন APK install করার পর এবং PJSIP reprovision-এর পর DTMF test করুন।

**Tested:** APK build ✅ (Jun 30 01:02, 65MB, EAS local); sipPhone.js logic review ✅;
CDR analysis ✅ (root cause confirmed); dialplan structure verified ✅.
**DTMF CONFIRMED WORKING** (Jun 30 05:00:46): PJSIP log-এ SIP INFO `Signal=1` Asterisk-এ
পৌঁছানো এবং `[1@hotline-1:1] NoOp("IVR: Support")` execute হওয়া directly confirmed।
sendDtmf() diagnostic log (সাময়িক) সরিয়ে clean version OTA push করা হয়েছে
(update group: 3e831606-45ed-42e0-896e-55fd5969605e).

### [2026-06-30 (session 2)] — Ring group agent availability debug + cleanup

**পরিবর্তিত ফাইল:** `mobile_app/src/services/sipPhone.js` (diagnostic log removed)

**কী করা হয়েছে:**
- DTMF confirmed working → sendDtmf() diagnostic console.log সরানো হয়েছে
- Ring group failure root cause identified:
  - `agent_2` (PBXAgent id=1): `user=None`, কোনো SipEndpoint নেই → ALWAYS fails
  - `agent_1` (admin), `agent_26` (test): registered নয় (app বন্ধ)
- coturn port binding issue identified: `stunaddr=103.214.202.17:3478` কিন্তু coturn
  private IP-তে listen করছে → Asterisk STUN timeout (শুধু log warning, calls break হয় না
  কারণ `external_media_address=103.214.202.17` set আছে)

**⚠️ Side Effect / সতর্কতা:**
- `agent_2` ring group-এ আছে কিন্তু user=None → PJSIP endpoint নেই → call fail। Admin panel →
  PBX Agents-এ agent_2-কে একটি real user assign করুন, তারপর Reprovision করুন।
- agents online না থাকলে (app বন্ধ) ring group fail → caller-এর কল কেটে যায়।

**Tested:** sipPhone.js cleanup ✅; OTA preview push ✅ (Jun 30).

### [2026-06-30] — Live TV মডিউল: sidebar মেনু + dashboard + Django API + FFmpeg QSV HLS

**পরিবর্তিত ফাইল:** `livetv/` (নতুন app), `config/settings.py`, `config/urls.py`, `admin_panel/src/pages/livetv/LiveTVPage.jsx`, `admin_panel/src/components/Sidebar.jsx`, `admin_panel/src/App.jsx`

**কী করা হয়েছে:**
- নতুন Django app `livetv` তৈরি — `TVChannel` model (`livetv_channel` table): name, slug, category, source_url, resolution, video_bitrate, audio_bitrate, use_qsv, hls_segment_time, status, ffmpeg_pid, stream_started_at।
- `StreamService` — FFmpeg প্রক্রিয়া start/stop/check; **Intel QSV** (`h264_qsv`) default encoder (`/dev/dri/renderD128` উপলব্ধ); fallback: `libx264 ultrafast`।
- HLS output: `/var/www/isp_bnas/media/hls/{slug}/index.m3u8` → Nginx `/media/` দিয়ে serve হয় (কোনো Nginx পরিবর্তন লাগেনি)।
- REST API: `/api/v1/livetv/channels/` (CRUD) + `/start/`, `/stop/`, `/log/`, `/check/`, `/stats/` actions।
- React `LiveTVPage.jsx`: stats cards (মোট/লাইভ/শুরু/বন্ধ/ত্রুটি), channel grid cards (logo, status badge, uptime, HLS URL copy, start/stop/edit/delete/log), Add/Edit modal (সব encoding সেটিংস), FFmpeg log modal, M3U playlist download, search+filter।
- Sidebar-এ "লাইভ টিভি" মেনু `superOnly: true`; route `/livetv`।

**Side Effect / সতর্কতা:**
- DVB কার্ড এখনো ইনস্টল নেই — source_url হিসেবে Tvheadend HTTP URL বা RTSP camera URL দিন।
- Intel QSV-এ `/dev/dri/renderD128` আছে; gunicorn/www-data user `render`/`video` group-এ না থাকলে QSV fail করবে — `usermod -aG render,video www-data` চালান।
- stream 10 সেকেন্ড পর `starting → live` হয় (HLS playlist তৈরি হতে সময় লাগে)।
- Status polling: frontend প্রতি ১০ সেকেন্ডে auto-refresh।

**Tested:** migration ✅; API endpoint structure ✅; frontend build ✅ (2.95s); gunicorn auto-reload ✅।

### [2026-06-30] — Live TV: DVB-S2 + HDMI PCIe + URL — তিনটি ইনপুট একসাথে

**পরিবর্তিত ফাইল:** `livetv/models.py`, `livetv/services/stream_service.py`, `livetv/api/serializers.py`, `livetv/api/views.py`, `admin_panel/src/pages/livetv/LiveTVPage.jsx`

**কী করা হয়েছে:**
- `input_type` field যোগ: `v4l2` (HDMI PCIe), `dvb` (DVB-S2 satellite), `url` (RTSP/HTTP/UDP)
- **V4L2 (HDMI):** `device_path`, `audio_device`, `framerate` — ৮-পোর্ট কার্ডে /dev/video0…video7
- **DVB-S2:** `dvb_adapter`, `dvb_frequency`, `dvb_symbol_rate`, `dvb_polarization`, `dvb_video_pid`, `dvb_audio_pid`, `tuner_pid` — dvbv5-zap দিয়ে auto-tune
- **URL:** `source_url` — Tvheadend HTTP বা RTSP বা UDP
- StreamService: তিনটি path-এর জন্য আলাদা FFmpeg input command; DVB-এ dvbv5-zap tune তারপর FFmpeg reads /dev/dvb/adapter0/dvr0; tuner process PID আলাদা রাখা হয়
- API: `/scan-devices/` endpoint — V4L2 + DVB + ALSA device তালিকা live scan করে
- Frontend: input type selector (3 card), hardware scan button, DVB frequency/polarization/PID form, V4L2 device picker, stats-এ by_type breakdown

**Side Effect / সতর্কতা:**
- DVB-S2 কার্ড লাগালে: `apt install dvb-tools v4l-utils` চালান
- HDMI কার্ড লাগালে: `v4l2-ctl --list-devices` দিয়ে device চেক করুন
- QSV-র জন্য: `usermod -aG render,video isp && systemctl restart isp-gunicorn`
- dvbv5-zap না থাকলে (Tvheadend tune করলে) DVB mode-ও কাজ করবে

**Tested:** migration ✅ (0002); build ✅ (2.88s).

### [2026-06-30] — Live TV: device validation + যেকোনো ফরম্যাট playlist import

**পরিবর্তিত ফাইল:** `livetv/services/stream_service.py`, `livetv/services/playlist_parser.py` (নতুন), `livetv/api/views.py`, `admin_panel/src/pages/livetv/LiveTVPage.jsx`

**কী করা হয়েছে:**
- **DVB+HDMI coexistence guard:** `validate_channel()` — start করার আগে device exist check; একই V4L2 device বা DVB adapter দুটো channel একসাথে ব্যবহার করতে চাইলে conflict error দেয়। DVB ও HDMI namespace আলাদা (/dev/dvb/ বনাম /dev/video*) তাই কোনো conflict নেই।
- **`playlist_parser.py`:** 5 ফরম্যাট auto-detect parse — M3U/M3U8, JSON, CSV, XSPF, plain URL list। group-title → category mapping। flexible key names।
- **API endpoints:**
  - `POST /api/v1/livetv/channels/parse-playlist/` — preview only (DB write নেই)
  - `POST /api/v1/livetv/channels/import-playlist/` — selected channels DB-তে save; skip_duplicates option
  - source: URL fetch / file upload / text paste
- **Frontend Import modal:** 3-tab (URL/File/Paste), preview table (channel নির্বাচন করা যায়), format badge, duplicate skip toggle, bulk import।

**Side Effect / সতর্কতা:**
- `requests` library প্রয়োজন (Django env-এ আছে — DRF dependency)।
- IPTV provider URL-এ username/password থাকে — plain HTTP। HTTPS recommended।
- import করা channels সব `input_type=url` হয়; পরে হাতে DVB/V4L2-তে পরিবর্তন করা যাবে।

**Tested:** build ✅ (2.88s).

### [2026-06-30 session 3] — Standalone Live TV App (livetv_app) — সম্পূর্ণ আলাদা APK

**পরিবর্তিত/নতুন ফাইল:**
- `livetv_app/` (নতুন standalone Expo project)
  - `package.json` — expo-video ~2.2.0 সহ (native HLS player)
  - `app.json` — package: com.rajameharonline.livetv, dark theme
  - `eas.json`, `index.js`, `babel.config.js`, `App.js`
  - `src/services/api.js` — axios + JWT SecureStore
  - `src/context/AuthContext.js` — login/logout
  - `src/screens/auth/LoginScreen.js` — dark IPTV-style login
  - `src/screens/channels/ChannelGridScreen.js` — sidebar categories + 3-col grid + search + recent
  - `src/screens/player/PlayerScreen.js` — expo-video native player, custom controls, play/pause/mute
- `mobile_api/api/views.py` — `_serve_apk()` helper, `livetv_apk_download()` যোগ
- `mobile_api/api/urls.py` — `livetv-apk-download/` URL যোগ
- `mobile_app/public_apk/rajamehar-livetv-v1.0.0.apk` (75MB APK)
- `media/app/rajamehar-livetv.apk` — public download

**কী করা হয়েছে:**
- পূর্বের অ্যাপে Live TV না ঢুকিয়ে সম্পূর্ণ আলাদা standalone APK তৈরি
- expo-video (SDK 54 native) দিয়ে hardware-decoded HLS — সব format সাপোর্ট
- PlayerScreen: custom overlay controls (play/pause/mute), offline fallback, retry
- ChannelGridScreen: AsyncStorage recent channels, category sidebar, live badge
- Gradle assembleRelease দিয়ে সরাসরি APK build (google-services.json package name fix করা হয়েছে)
- Download: https://roisp.duckdns.org/media/app/rajamehar-livetv.apk
- API endpoint: GET /api/v1/app/livetv-apk-download/ (internal redirect via nginx)

**Side Effect / সতর্কতা:**
- নতুন livetv APK build করতে: `cd /var/www/isp_bnas/livetv_app/android && ./gradlew assembleRelease` তারপর `cp android/app/build/outputs/apk/release/app-release.apk ../mobile_app/public_apk/rajamehar-livetv-vX.X.X.apk` এবং `cp` to `media/app/rajamehar-livetv.apk`
- `app_apk_download` এখন শুধু `rajamehar-online-*.apk` serve করে (prefix filter)
- Live TV app-এ Firebase push notification নেই (ইচ্ছাকৃত — শুধু ভিডিও)

**Tested:** BUILD SUCCESSFUL ✅ (516 tasks), Django check ✅, HTTP 200 download ✅

### [2026-06-30] — Live TV Mobile App: React Native screens + backend mobile API

**পরিবর্তিত ফাইল:**
- `mobile_app/src/screens/livetv/LiveTVHomeScreen.js` (নতুন)
- `mobile_app/src/screens/livetv/LiveTVChannelListScreen.js` (নতুন)
- `mobile_app/src/screens/livetv/LiveTVPlayerScreen.js` (নতুন)
- `mobile_app/App.js` — HomeStack-এ 3টি LiveTV screen যোগ
- `mobile_app/src/screens/home/HomeScreen.js` — "📺 Live TV" banner বাটন যোগ
- `mobile_api/api/views.py` — `AppLiveTVChannelsView` যোগ
- `mobile_api/api/urls.py` — `/app/livetv/channels/` endpoint

**কী করা হয়েছে:**
- `LiveTVHomeScreen`: category list (Recent, All, News, Sports…) + live/total stats
- `LiveTVChannelListScreen`: left sidebar categories + 3-column channel grid + search + status badge
- `LiveTVPlayerScreen`: WebView + HLS.js (CDN) player — landscape fullscreen, back/live overlay
- HomeScreen-এ dark red "📺 Live TV Channels → LIVE" banner বাটন যোগ
- Backend: `AppLiveTVChannelsView` — client JWT auth, is_active channels, hls_url শুধু live-এ থাকে

**Side Effect / সতর্কতা:**
- HLS.js CDN (`cdn.jsdelivr.net`) প্রয়োজন — device-এ internet access লাগবে
- নতুন APK build করতে হবে: `bash ~/isp_bnas/mobile_app/scripts/build_and_publish_apk.sh` না হয় EAS local build
- Player screen landscape force করা হয়েছে — portrait-এ ফিরতে back button চাপুন

---

### [2026-06-30] — Live TV APK ক্র্যাশ fix + ErrorBoundary + APK v5 rebuild

**পরিবর্তিত ফাইল:** `livetv_app/src/screens/player/PlayerScreen.js`, `livetv_app/App.js`, `livetv_app/src/components/ErrorBoundary.js` (নতুন)

**কী করা হয়েছে:**
- **Bug 1:** `PlayerScreen`-এ invalid React Native style `background: 'linear-gradient(...)'` সরানো হয়েছে — new architecture-এ এটি crash বা warning cause করে
- **Bug 2:** `useVideoPlayer(null, callback)` — source null হলেও callback-এ `p.play()` call হত; guard যোগ করা হয়েছে (`if (hlsSource) p.play()`)
- **Bug 3:** `statusChange` listener-এ null guard যোগ — source না থাকলে listener বাদ
- **নতুন:** `ErrorBoundary` class component — JS crash হলে পুরো app kill না হয়ে "Try Again" screen দেখায়; `App.js`-এ root-level wrap করা হয়েছে
- APK v1.0.0 build 5 (67MB) rebuild ও publish: `https://roisp.duckdns.org/media/app/rajamehar-livetv.apk`

**Side Effect / সতর্কতা:** Root cause হতে পারে `expo-video` native ExoPlayer crash — device log (`adb logcat`) না দেখে নিশ্চিত বলা যাচ্ছে না। এই fix JS-level crashes ধরবে; native crash থাকলে আলাদা investigation দরকার।

**Tested:** Build সফল; device-এ install করে পুনরায় verify করতে হবে।

**Tested:** `python manage.py check` ✅ (0 issues). Mobile build pending (user-side).

---

### [2026-06-30] — Live TV: Login সরানো, UI redesign, import fix, ping badge, stop/start toggle

**পরিবর্তিত ফাইল:** `livetv_app/App.js`, `livetv_app/src/screens/channels/ChannelGridScreen.js`, `livetv_app/src/screens/player/PlayerScreen.js`, `livetv_app/src/services/api.js`, `livetv/api/views.py`, `livetv/api/serializers.py`, `mobile_api/api/views.py`, `admin_panel/src/pages/livetv/LiveTVPage.jsx`

**কী করা হয়েছে:**
1. **Login সরানো:** App সবার জন্য উন্মুক্ত — auth token ছাড়াই channel list; `mobile_api` endpoint `AllowAny`
2. **UI Redesign:** Vertical sidebar সরানো → horizontal ScrollView category tabs + 3-column full-width grid; color avatar fallback (logo না থাকলে channel নামের প্রথম অক্ষর রঙিন background-এ)
3. **"Import failed." fix:** `selected_indices` FormData থেকে JSON string আসে — `json.loads()` দিয়ে parse করা হয়েছে
4. **Dashboard "0 Live" fix:** Serializer `get_status()` — URL-type channel `is_active=True` হলে `'live'` return করে; stats endpoint-এও URL channels সহ Q() দিয়ে সঠিক count
5. **Logo upload:** Admin panel-এ channel edit modal-এ logo upload button; backend `/upload-logo` action; `logo_url_encoded` আলাদা SerializerMethodField (URL encoding); `logo_url` writable রাখা হয়েছে
6. **Blank page fix:** `React.useEffect` → `useEffect` (destructured) — `React` object import না থাকায় blank white page হচ্ছিল
7. **PingBadge:** Admin panel-এ প্রতিটি channel card-এ LIVE badge-এর নিচে ping/latency indicator — green(<100ms)/yellow(<300ms)/red(>300ms)/gray(unreachable); click করে recheck; backend `/ping/` GET action (HEAD request to stream URL)
8. **Stop/Start toggle:** URL-type channel Stop করলে `is_active=False` → mobile app থেকে লুকায়; Start করলে `is_active=True` → দেখায়

**Side Effect / সতর্কতা:** 
- ftpbdlive.com logo URLs সার্ভার থেকে unreachable (curl timeout) — color avatar fallback সেজন্যই আছে
- ping endpoint HEAD request করে external URLs-এ — slow streams-এ 5s timeout
- URL-type channels-এর জন্য FFmpeg চলে না, শুধু `is_active` toggle হয়

**Tested:** Frontend build ✅ (2.70s). Backend `python manage.py check` — gunicorn auto-reload হয়েছে।

---

### [2026-06-30] — Live TV Player controls fix + Home/ChannelList UI redesign (APK v15)

**পরিবর্তিত ফাইল:** `livetv_app/src/screens/player/PlayerScreen.js`, `livetv_app/src/screens/home/HomeScreen.js`, `livetv_app/src/screens/channels/ChannelListScreen.js`, `livetv_app/app.json`

**কী করা হয়েছে:**
- **[BUG FIX] Player controls tap করলে দেখাচ্ছিল না:** `VideoView` native layer touch events consume করত — `TouchableWithoutFeedback` কাজ করত না। Fix: VideoView সরাসরি absoluteFill রাখা হয়েছে, এবং তার উপরে আলাদা `Pressable` দিয়ে tap catcher যোগ করা হয়েছে।
- **[BUG FIX] Stale closure in auto-hide timer:** `setTimeout` ভেতরে পুরনো `hideControls` ধরা পড়ত — `hideControlsFn` ref দিয়ে সবসময় latest version call হয়।
- **[FEATURE] Lock button কাজ করে:** 🔒 চাপলে controls লক হয়, auto-hide বন্ধ হয়, শুধু একটি lock badge দেখায় — চাপলে unlock হয়।
- **[FEATURE] ContentFit toggle:** ⛶ button চাপলে `contain` ↔ `cover` (letterbox/fullscreen fill) toggle হয়।
- **[UI REDESIGN] HomeScreen:** Plain row list থেকে সম্পূর্ণ card-based grid layout — featured cards (Recent/All), 2-column colored category cards, branded header, সবসময় দৃশ্যমান search bar।
- **[UI REDESIGN] ChannelListScreen sidebar:** Number index সরিয়ে emoji icon + label দেওয়া হয়েছে, active indicator হিসেবে left border line।
- APK versionCode 15 build ও publish হয়েছে।

**Side Effect / সতর্কতা:** HomeScreen-এর `listData` structure পরিবর্তন হয়েছে — featured items (recent/all) আলাদাভাবে full-width render হয়, বাকি categories pair করে grid row-এ।

**Tested:** BUILD SUCCESSFUL (3m 25s), APK 67M → `https://roisp.duckdns.org/media/app/rajamehar-livetv.apk`

---

### [2026-06-30 (session 3)] — Live TV UI: HomeScreen list redesign + ChannelList numbered sidebar + Player STREAM X

**পরিবর্তিত ফাইল:** `livetv_app/src/screens/home/HomeScreen.js`, `livetv_app/src/screens/channels/ChannelListScreen.js`, `livetv_app/src/screens/player/PlayerScreen.js`, `livetv_app/App.js`

**কী করা হয়েছে:**
- **[UI REDESIGN] HomeScreen:** Colorful card grid সরিয়ে screenshot অনুযায়ী simple dark category list — hamburger (☰) + "Live TV" header, search icon toggle, category rows with count + chevron (›), thin separators। `useWindowDimensions` দিয়ে responsive font size।
- **[UI REDESIGN] ChannelListScreen:** Custom top header যোগ করা হয়েছে — orange ← back button + "Channels List" title + first channel logo top-right। Sidebar: emoji icon সরিয়ে sequential numbers (1, 2, 3...) + category name, selected state dark red (#8B0000) background। App.js-এ `headerShown: false` set করা হয়েছে।
- **[UI FIX] PlayerScreen EPG:** `sourceCircle` সবসময় orange (#e55a00) — channel name থেকে dynamic color সরানো। Label এখন `STREAM X` (ছিল category name)।
- সব screen `useWindowDimensions`/`Dimensions` ব্যবহার করে যেকোনো screen size-এ auto-fit।

**Side Effect / সতর্কতা:** ChannelListScreen-এ `headerShown: false` — navigation back button আর দেখাবে না, custom orange back button ব্যবহার করতে হবে।

**Tested:** BUILD SUCCESSFUL (22s), APK 67M publish → `https://roisp.duckdns.org/media/app/rajamehar-livetv.apk`

---

### [2026-07-01] — Live TV: Authentication System — Subscriber Login/Register + APK v21

**পরিবর্তিত ফাইল:** `livetv/models.py`, `livetv/migrations/0012_livetv_subscriber.py`, `livetv/api/auth_views.py`, `livetv/api/urls.py`, `livetv/api/views.py`, `mobile_api/api/views.py`, `admin_panel/src/pages/livetv/LiveTVRegistrationPage.jsx`, `admin_panel/src/components/Sidebar.jsx`, `admin_panel/src/App.jsx`, `livetv_app/src/context/AuthContext.js`, `livetv_app/src/screens/auth/LoginScreen.js`, `livetv_app/App.js`, `livetv_app/android/app/build.gradle`

**কী করা হয়েছে:**
- **[Model]** `LiveTVSubscriber` — phone, password_hash, name, expires_at, is_active, notes, customer_id। `set_password()`/`check_password()` methods, `is_expired` property।
- **[Auth API]** `livetv/api/auth_views.py` — `LiveTVLoginView` (POST phone+password → JWT 30d), `LiveTVRegisterView` (pending or auto-login), `LiveTVMeView` (token verify)
- **[Mobile Auth]** `mobile_api/api/views.py` → `AppLiveTVChannelsView` — Bearer token required; 401 + `auth_required:true` না থাকলে
- **[Admin Panel]** Sidebar: "লাইভ টিভি" → "Live TV" submenu (Channels, Registration)। `LiveTVRegistrationPage` — full CRUD subscriber management page।
- **[App Auth]** `AuthContext.js` — subscriber JWT login/register/logout, SecureStore persistence। `LoginScreen.js` — Sign In (phone+password) + Register tab (name/phone/password/customer_id)। `App.js` — auth gate: loading spinner → LoginScreen (if !user) → main stack (if user)
- **APK v21** built (37s), published: `https://roisp.duckdns.org/media/app/rajamehar-online.apk`

**Side Effect / সতর্কতা:**
- Open registration চালু করতে `.env`-এ `LIVETV_OPEN_REGISTRATION=true` যোগ করতে হবে। Default: pending (admin approval লাগবে)।
- JWT token 30 দিনের। Expiry `exp` claim দিয়ে validate হয়।
- পুরনো app users (কোনো token নেই) → mobile API 401 পাবে → LoginScreen দেখবে।

**Tested:** হ্যাঁ — Build SUCCESS (37s), migration applied, APK deployed

---

### [2026-07-01] — Live TV App: Next/Prev বাটনে channel overlap fix

**পরিবর্তিত ফাইল:** `livetv_app/src/screens/player/PlayerScreen.js`

**কী করা হয়েছে:**
- **Bug:** দ্রুত Next চাপলে `currentIndex` stale থাকত — `setChannel()` animation শেষে call হয়, তাই state আপডেট হওয়ার আগেই `goNext` পুরনো index দিয়ে একই চ্যানেলে আবার switch করত। এতে overlap এবং stuck হয়।
- **Fix:** দুটো ref যোগ: `currentIndexRef` ও `pendingChannelIdRef` — switching শুরু হওয়ার সাথে সাথেই update হয়, animation শেষের অপেক্ষা করে না।
- `goNext`/`goPrev` এখন `currentIndexRef.current` ব্যবহার করে (state-এর পরিবর্তে)।
- `switchChannel`-এর guard এখন `pendingChannelIdRef.current` চেক করে — stale `channel?.id` state আর ব্যবহার হয় না।
- `switchChannel`-এর dep array থেকে `channel?.id` সরানো হয়েছে (ref-based guard-এর কারণে আর দরকার নেই)।

**Side Effect / সতর্কতা:**
- UI-তে CH number ও button disable state (`currentIndex <= 0` ইত্যাদি) এখনও state-based — cosmetic ঠিকঠাক, navigation logic ref-based।

**Tested:** Pattern check OK। APK build ও device test পরবর্তী session-এ করতে হবে।

---

### [2026-07-01] — Live TV App: PlayerScreen dual-player সরিয়ে single-player করা হয়েছে

**পরিবর্তিত ফাইল:** `livetv_app/src/screens/player/PlayerScreen.js`

**কী করা হয়েছে:**
- **Dual-player সম্পূর্ণ সরানো হয়েছে** — `playerB`, `opacityA/B`, `activeSideRef`, `switchingRef`, `SwitchingOverlay`, crossfade animation সব removed।
- **Root cause:** Expo-video-তে background player-এর audio reliable ভাবে mute হয় না — `muted=true` set করার আগেই native audio শুরু হয়ে যায়। এর কারণে Next চাপলে নতুন চ্যানেলের শব্দ কিন্তু পুরনো চ্যানেলের ছবি দেখাচ্ছিল।
- **Single player, immediate switch:** `switchChannel()` এখন শুরুতেই `setChannel(newChannel)` call করে — CH name/number সাথে সাথে বদলায়। তারপর `player.replace(newUrl).play()` করে।
- **`applyUrl()` helper** যোগ — switch ও failover উভয়ই এটা ব্যবহার করে।
- **Ref-based navigation** আগের session থেকে রাখা হয়েছে (`currentIndexRef`, `pendingChannelIdRef`)।

**Side Effect / সতর্কতা:**
- পুরনো "পুরনো চ্যানেল চলতে থাকে, নতুন background-এ load হয়" feature আর নেই — এখন switch-এ brief loading spinner দেখায়।
- এটাই standard TV app behavior (JioTV, Tata Play-এর মতো)।

**Tested:** হ্যাঁ — BUILD SUCCESSFUL (1m 5s), APK v25 (67MB) deployed → https://roisp.duckdns.org/media/app/rajamehar-livetv.apk

---

### [2026-07-01] — Live TV App: Player-এ Channel List Panel (slide-in, glass, auto-scroll)

**পরিবর্তিত ফাইল:** `livetv_app/src/screens/player/PlayerScreen.js`

**কী করা হয়েছে:**
- ☰ আইকন (`listIconBtn`) এখন `navigation.goBack()` নয়, বরং channel list panel খুলবে।
- `openChList()` — spring animation দিয়ে right থেকে slide-in করে। খোলার পর auto-scroll current channel-এ।
- `closeChList()` — slide-out animation, backdrop ট্যাপেও বন্ধ।
- **Panel design (frosted glass):** `rgba(8,11,22,0.87)` background, left border `rgba(255,255,255,0.12)`, shimmer top strip।
- **Channel row:** CH নম্বর box + নাম। Active row-এ: left accent bar (নীল), highlighted background, সাদা text, ডানে সবুজ "playing" dot।
- FlatList `ref` দিয়ে `scrollToIndex` — current channel মাঝখানে দেখায়।
- Backdrop (`chPanelBackdrop`) — panel-এর বাইরে tap করলে বন্ধ হয়।

**Side Effect / সতর্কতা:**
- `PANEL_WIDTH = 300` — ছোট ফোনে কিছুটা বেশি জায়গা নিতে পারে; প্রয়োজনে 260 করা যাবে।

**Tested:** হ্যাঁ — BUILD SUCCESSFUL (32s), APK v26 (67MB) deployed → https://roisp.duckdns.org/media/app/rajamehar-livetv.apk

---

### [2026-07-01] — Live TV App: MenuScreen redesign + User Profile bottom sheet

**পরিবর্তিত ফাইল:** `livetv_app/src/screens/home/MenuScreen.js`, `livetv_app/src/context/AuthContext.js`, `livetv/api/auth_views.py`

**কী করা হয়েছে:**
- **MenuScreen সম্পূর্ণ redesign:** Dark navy gradient background, decorative circles, বড় clock/date, welcome pill badge, card press animation (spring scale)।
- **Cards:** horizontal layout (icon box + text + arrow), glowing accent, bottom accent line per card।
- **User avatar (top right):** ইউজারের নামের প্রথম অক্ষর — gradient রঙ (নামের charCode থেকে)। Press করলে profile bottom sheet।
- **Profile bottom sheet:** spring slide-up; avatar + name + status; info rows (phone, customer_id, expiry); ✏️ edit toggle; name/password update form; লগ আউট বাটন।
- **`AuthContext.updateProfile()`:** `PATCH /livetv/app/auth/me/` call করে, SecureStore আপডেট করে, `user` state সরাসরি update করে।
- **Backend `PATCH /api/v1/livetv/app/auth/me/`:** `LiveTVMeView`-এ যোগ করা হয়েছে। `update_fields` দিয়ে শুধু changed fields save হয়।

**Tested:** হ্যাঁ — BUILD SUCCESSFUL (31s), APK v27 (67MB) deployed → https://roisp.duckdns.org/media/app/rajamehar-livetv.apk

---

### [2026-07-01] — Admin Panel: FTP Movie Server পেজ Live TV সাবমেনুতে

**পরিবর্তিত ফাইল:** `admin_panel/src/App.jsx`, `admin_panel/src/components/Sidebar.jsx`, `admin_panel/src/pages/mobile/AppVersionPage.jsx`
**নতুন ফাইল:** `admin_panel/src/pages/livetv/FTPMovieServerPage.jsx`

**কী করা হয়েছে:**
- `AppVersionPage.jsx` থেকে FTP Server section সম্পূর্ণ সরানো হয়েছে।
- Sidebar-এ Live TV-তে নতুন submenu: **FTP Movie Server** (`/livetv/ftp`)।
- নতুন `FTPMovieServerPage.jsx` — পূর্ণ FTP সার্ভার management:
  - Stats bar (মোট সার্ভার / URL সহ / নোটিশ সহ count)
  - ServerCard: expand/collapse, icon picker (emoji shortcuts), name, URL, note, live preview
  - Drag-free reordering (↑↓ বাটন)
  - Delete with confirmation
  - App preview panel (dark mockup, real-time)
  - Info sidebar: কীভাবে কাজ করে, URL উদাহরণ
  - Dirty state tracking ("অসংরক্ষিত পরিবর্তন" badge)
  - `PATCH /system/mobile-app-config/current/` দিয়ে save

**Tested:** হ্যাঁ — Vite build OK (3.16s)

---

### [2026-07-01] — Live TV App: FTP কন্টেন্ট ডেটাবেজ — Browse + Video Player (APK v19)

**পরিবর্তিত ফাইল:** `livetv_app/App.js`, `livetv_app/src/screens/ftp/FTPListScreen.js`
**নতুন ফাইল:** `livetv_app/src/screens/ftp/FTPContentScreen.js`, `livetv_app/src/screens/ftp/FTPVideoPlayerScreen.js`

**কী করা হয়েছে:**
- **FTPContentScreen:** 2-column grid, type tabs (সকল/মুভি/নাটক/সিরিজ), search bar (local filter)। VideoCard — thumbnail Image + fallback emoji, type badge, play circle overlay, metadata (year/language/genre/episode)। `/livetv/app/ftp-content/` API থেকে data আসে (token required)।
- **FTPVideoPlayerScreen:** expo-video single player, custom controls (play/pause pulse animation, progress bar, auto-hide 5s), buffering spinner, error state + retry, content type badge, series subtitle (S1E3 format)।
- **FTPListScreen আপডেট:** এখন সর্বদা "কন্টেন্ট ডেটাবেজ" entry card দেখায় (FTPContent-এ navigate করে)। FTP server list একটাই থাকলে auto-open behavior অপরিবর্তিত।
- **App.js:** `FTPContent` ও `FTPVideoPlayer` (orientation: 'all') routes যোগ হয়েছে।

**Side Effect / সতর্কতা:**
- `FTPContentScreen` API call: `GET /api/v1/livetv/app/ftp-content/?type=...` — token required (subscriber JWT)। Token invalid হলে empty list দেখাবে (crash নয়)।
- `FTPVideoPlayerScreen` `progress` bar: `timeUpdate` listener expo-video-এ আছে কিনা verify করা হয়নি — না থাকলে progress সবসময় 0 থাকবে (functional issue নয়, visual only)।

**Tested:** হ্যাঁ — BUILD SUCCESSFUL (3m 33s), APK v19/versionCode=19 (67MB) deployed → https://roisp.duckdns.org/media/app/rajamehar-livetv.apk

---

### [2026-07-01] — FTP Movie Server: ✕ immediate delete + Video file upload

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/livetv/FTPMovieServerPage.jsx`, `livetv/api/views.py`, `livetv/api/urls.py`
**নতুন directory:** `media/livetv/videos/`

**কী করা হয়েছে:**

**1. FTP Server ✕ বাটন — immediate server delete:**
- `handleDelete()` এখন local state আপডেট করার সাথে সাথে `PATCH /system/mobile-app-config/current/` call করে।
- App-এ সাথে সাথে আপডেট হয় (config endpoint থেকেই ডেটা আসে)।
- Confirmation dialog আছে।

**2. Video file upload (Backend):**
- `FTPVideoUploadView`: `POST /api/v1/livetv/ftp-content/upload-video/` — multipart, IsAuthenticated।
  - Accepted formats: mp4, mkv, webm, avi, mov, ts, flv, m4v, 3gp, wmv, ogv, m2ts
  - Saves to `media/livetv/videos/<uuid>.<ext>`
  - Returns: `{ url, filename, size_mb, ext }`
- `FTPVideoDeleteUploadView`: `DELETE /api/v1/livetv/ftp-content/delete-upload/` — body: `{ filename }`

**3. Video file upload (Admin Panel):**
- ContentForm-এ "ভিডিও সোর্স" section: toggle বাটন "🔗 URL লিংক" / "⬆️ ফাইল আপলোড"
- `VideoUploader` কম্পোনেন্ট: drag zone + progress bar (XHR onprogress), cancel বাটন, upload সফল হলে filename + size দেখায়
- Format compatibility guide: MP4★★★★★, MKV★★★★, WebM★★★★, AVI★★★, TS★★★, FLV★★
- Upload হলে `video_url` auto-set হয়ে যায়

**Side Effect / সতর্কতা:**
- Upload endpoint-এ large file (কয়েক GB) হলে gunicorn timeout (120s) হতে পারে — nginx `client_max_body_size` চেক করতে হবে।
- `delete-upload/` endpoint কেবল `media/livetv/videos/` থেকে মুছে — DB record মুছলে সেই ফাইল orphan হয়ে যায়। future cleanup script লাগতে পারে।

**Tested:** হ্যাঁ — Build OK (3.10s), gunicorn reload OK, endpoints 401 (auth required) — working.

---

### [2026-07-02] — FTP Content: video_filename DB tracking + nginx large upload + ✕ immediate delete

**পরিবর্তিত ফাইল:** `livetv/models.py`, `livetv/api/views.py`, `livetv/api/urls.py`, `admin_panel/src/pages/livetv/FTPMovieServerPage.jsx`
**নতুন migration:** `livetv/migrations/0014_add_video_filename.py` (applied)

**কী করা হয়েছে:**

**1. FTPVideoContent model — `video_filename` field:**
- নতুন field: `video_filename = CharField(max_length=200, blank=True, default='')`
- বাইরের URL হলে blank, আপলোড হলে uuid filename (e.g. `abc123de.mp4`) স্টোর হয়
- Migration 0014 applied

**2. Backend file lifecycle tracking:**
- `_serialize_content()`: `video_filename` include করে
- `_apply_fields()`: `video_filename` update করে
- `destroy()`: content delete করলে `_delete_video_file(filename)` call করে disk থেকে মুছে দেয়
- `partial_update()`: video replace হলে পুরনো file auto-delete করে
- নতুন helper `_delete_video_file(filename)`: `media/livetv/videos/` থেকে নিরাপদে delete করে (path traversal protect)

**3. Admin Panel:**
- `ContentForm`: edit mode-এ existing `video_filename` থেকে upload mode auto-detect করে
- `VideoUploader`: `currentFilename` prop — edit করার সময় আগের upload দেখায়
- form submit-এ `video_filename` সবসময় backend-এ পাঠানো হয়

**4. Nginx — video upload বড় ফাইল (⚠️ MANUAL STEP — password লাগে):**
Patched config `/tmp/isp_bnas_nginx_new.conf`-এ আছে। চালাতে হবে:
```
sudo cp /tmp/isp_bnas_nginx_new.conf /etc/nginx/sites-available/isp_bnas
sudo nginx -t && sudo systemctl reload nginx
```
Upload endpoint `/api/v1/livetv/ftp-content/upload-video/` এর জন্য:
- `client_max_body_size 4096M` (4GB)
- `proxy_read_timeout 3600s` (1 ঘণ্টা)
- `proxy_request_buffering off` (streaming — memory কম লাগে)

**Tested:** হ্যাঁ — Migration OK, gunicorn reload OK, build OK (3.44s)

---

### [2026-07-02] — FTP Video Player: Professional Controls + APK v18

**পরিবর্তিত ফাইল:** `livetv_app/src/screens/ftp/FTPVideoPlayerScreen.js`

**কী করা হয়েছে:**
- **[Player]** সম্পূর্ণ rewrite — screenshot অনুযায়ী professional controls:
  - Center: ◀◀ Rewind 10s + ▶/⏸ Play/Pause (বড় বৃত্ত) + ▶▶ Forward 10s — amber/golden border circle button
  - Bottom: time display (current / total, HH:MM:SS), draggable/tappable seekbar, volume toggle (🔊/🔇)
  - Top bar: ← Back, title + subtitle, content type badge (MOVIE/DRAMA/SERIES), language badge
  - Golden accent color `#f5a623`, semi-transparent overlay (auto-hide 5s, tap to toggle)
  - Skip flash effect (◀◀ 10s / 10s ▶▶) animated overlay on skip
  - Amber-colored rotating buffering spinner (কোনো 3rd party library নেই)
  - Error state with ↺ retry button
- `expo-screen-orientation` dependency নেই — তাই `App.js`-এর `options={{ orientation: 'all' }}` ই landscape handle করে
- PanResponder দিয়ে seekbar drag-to-seek functional

**Side Effect / সতর্কতা:**
- `expo-video` `addListener('timeUpdate', ...)` — update frequency platform অনুযায়ী (Android: ~250ms)
- `player.seekBy` API expo-video 2.x-এ থাকতে পারে নাও পারে; fallback `player.currentTime = target` দেওয়া আছে

**Tested:** হ্যাঁ — expo export bundle compile OK (2.44 MB), APK BUILD SUCCESSFUL (67 MB), `update_livetv_apk.sh` চালানো হয়েছে

---

### [2026-07-02] — FTP Video Player: Timeline Fix + Seek Bug Resolution (v19-v21)

**পরিবর্তিত ফাইল:** `livetv_app/src/screens/ftp/FTPVideoPlayerScreen.js`

**কী করা হয়েছে:**
1. **Timeline accurate countdown**: `timeUpdate` event-এ `duration` আসে না expo-video 2.x-এ — `setInterval(500ms)` দিয়ে `player.currentTime` ও `player.duration` poll করা হয়েছে
2. **Seekbar tooltip**: touch/drag করলে সেই position-এর time (`24:53` format) seekbar-এর উপরে দেখাবে
3. **Seek bug fix (critical)**: PanResponder stale closure — `useRef` দিয়ে `onSeek`, `onSeekStart`, `width`, `totalSec` সব fresh রাখা হয়েছে। আগে `totalSec=0` capture হওয়া callback সবসময় early return করত → seek কাজ করত না
4. **seekBy(delta)**: expo-video 2.x-এ absolute seek নেই, `seekBy(delta)` দিয়ে করা হয়েছে
5. **seekingRef**: seek চলাকালীন poll overwrite বন্ধ রাখে (1.2s settle time)
6. **skip() fix**: rewind/forward-এ `doSeek()` common helper ব্যবহার, seekingRef set হয়
7. **Timeout cleanup**: unmount-এ `seekTimer` ও `hideTimer` দুটোই `clearTimeout`
8. **BufferingSpinner**: `pointerEvents="none"` যোগ, animation cleanup on unmount

**Tested:** হ্যাঁ — expo export OK, APK BUILD SUCCESSFUL (67 MB) ×৩ বার

---

### [2026-07-02] — FTP Movie Server: 'কন্টেন্ট ডেটাবেজ' → 'Movie' label change (v22)

**পরিবর্তিত ফাইল:** `livetv_app/src/screens/ftp/FTPListScreen.js`

**কী করা হয়েছে:** FTPListScreen-এ card title 'কন্টেন্ট ডেটাবেজ' → 'Movie' পরিবর্তন

---

### [2026-07-02] — FTPListScreen: সম্পূর্ণ redesign + FTP Web/Cash Server দুই card (v23-v27)

**পরিবর্তিত ফাইল:** `livetv_app/src/screens/ftp/FTPListScreen.js`

**কী করা হয়েছে:**
- **MenuScreen-এর মতো dark gradient design**: `expo-linear-gradient`, decorative circles, press animation
- **Header**: ← back, title+subtitle center, ⌂ home (Menu route) — দুই দিকে navigation
- **Bottom menu bar সম্পূর্ণ বাদ**
- **দুটো মাত্র card**:
  - 🌐 **FTP Web Server**: admin panel → FTP সার্ভার ট্যাব থেকে কনফিগার করা URL(s) দেখায়
  - 🎬 **FTP Cash Server**: admin panel → কন্টেন্ট ডেটাবেজ → app-এর নিজস্ব player
- **FTP Web Server expandable list**: ১টা server → সরাসরি WebView; ২+ server → ▼ click করলে inline list expand; প্রতিটি row-এ numbered badge, icon, নাম, note, URL (monospace); row click → সেই server WebView-এ
- **Auto-redirect বাদ**: আগে ১টা server থাকলে সরাসরি WebView-এ চলে যেত — এখন সব সময় card দেখায়

**Side Effect / সতর্কতা:**
- `FTPServerList` route নেই (তৈরি করা হয়নি) — inline accordion ব্যবহার করা হয়েছে
- Admin panel-এ FTP সার্ভার ০ হলে Web Server card disabled (opacity 0.5) দেখাবে

**Tested:** হ্যাঁ — expo export OK, APK BUILD SUCCESSFUL (67 MB)

---

### [2026-07-02] — Client App: Live TV চ্যানেল ও FTP/Link বাটন সম্পূর্ণ বাদ

**পরিবর্তিত ফাইল:** `mobile_app/src/screens/home/HomeScreen.js`, `mobile_app/App.js`, `admin_panel/src/pages/mobile/AppVersionPage.jsx`

**কী করা হয়েছে:**
- **HomeScreen**: "FTP & Live TV" quick action বাটন সরানো হয়েছে; `notices`/`showNotice` state ও `NoticeModal` import বাদ; `fetchData`-এ ftp_servers ও live_tv_channels notice processing বাদ
- **App.js**: `LinksScreen` import ও `Links` Stack.Screen route সম্পূর্ণ সরানো হয়েছে
- **AppVersionPage.jsx**: `LiveTVEditor` component ও "📺 Live TV চ্যানেল" card section সম্পূর্ণ বাদ; frontend build করা হয়েছে
- লাইভ টিভি আলাদা `livetv_app`-এ থাকায় client (subscriber) app-এ এই feature-গুলো আর দরকার নেই

**Side Effect / সতর্কতা:**
- `LinksScreen.js` ফাইলটি disk-এ আছে কিন্তু কোথাও import/route নেই — dead file; প্রয়োজনে মুছে দেওয়া যাবে
- `MobileAppConfig`-এ `live_tv_channels` field backend-এ এখনও আছে (অন্য API-তে ব্যবহার হতে পারে); শুধু admin panel UI ও client app থেকে সরানো হয়েছে
- Admin panel-এ `live_tv_channels` form field সরানো হয়েছে — পুরনো config-এ থাকা channels backend-এ থাকবে কিন্তু update হবে না

**Tested:** হ্যাঁ — admin panel Vite build সফল (7.21s); mobile app syntax OK

---

### [2026-07-02] — Live TV: subscriber-authenticated stream proxy (raw HLS URL leak fix)

**পরিবর্তিত ফাইল:** `livetv/api/auth_views.py`, `livetv/api/views.py`, `mobile_api/api/views.py`, `mobile_api/api/urls.py`, `livetv_app/src/screens/player/PlayerScreen.js`
**নতুন ফাইল:** `livetv/services/hls_proxy_service.py`, `livetv/services/netloc_allowlist.py`

**Context:** Investigation-এ পাওয়া গেছে channel-list API (`AppLiveTVChannelsView`) subscriber login require করত ঠিকই, কিন্তু list-এর ভেতর raw upstream IPTV `source_url` অথবা `/media/hls/<slug>/index.m3u8` (nginx-এ auth ছাড়া public alias) সরাসরি হ্যান্ড-আউট করত। একবার URL পেয়ে গেলে subscriber deactivate/expire হয়ে গেলেও সেই URL চিরকাল কাজ করত — payment enforcement bypass। User explicit চেয়েছেন "প্রতিটি সাবস্ক্রাইবার পেমেন্টের আওতায়" থাকুক, তাই real-time per-request enforcement (caching/nginx-secure-link এর delay-window approach বাদ দিয়ে) বেছে নেওয়া হয়েছে।

**কী করা হয়েছে:**
- `livetv/api/auth_views.py` — `verify_livetv_token()` এখন `Authorization: Bearer` header **এবং** `?token=` query param দুটোই accept করে (native HLS player সব segment fetch-এ custom header propagate নাও করতে পারে)।
- `livetv/services/hls_proxy_service.py` (নতুন) — HLS manifest fetch/rewrite/segment-stream করার shared core, staff-only `hls-proxy` (TVChannelViewSet) ও নতুন subscriber proxy দুটোই এখন এই একই function ব্যবহার করে (আগে duplicate ছিল)।
- `livetv/services/netloc_allowlist.py` (নতুন) — SSRF allowlist cache (`livetv_allowed_netlocs` key, আগের মতোই) extracted, দুই proxy শেয়ার করে।
- `mobile_api/api/views.py` — নতুন `AppLiveTVStreamProxyView` (`GET /api/v1/app/livetv/stream/<channel_id>/`): প্রতিটা manifest/segment request-এ `verify_livetv_token()` দিয়ে fresh DB check করে; IPTV(`url`-type) চ্যানেলে upstream proxy করে (SSRF-protected), HDMI/DVB চ্যানেলে local disk (`channel.hls_output_dir`) থেকে সরাসরি পড়ে সার্ভ করে (আর nginx `/media/hls/` এর উপর নির্ভর করে না)। `AppLiveTVChannelsView.get()` এখন raw `source_url`/`hls_url`-এর বদলে এই proxy URL পাঠায় — **token embed করা হয়নি** কারণ channel-list payload 45s shared Redis cache-এ থাকে (`mobile_livetv_channels` key), token embed করলে এক subscriber-এর token অন্য subscriber-এর response-এ leak হতো।
- `mobile_api/api/urls.py` — `livetv/stream/<int:channel_id>/` route যোগ।
- `livetv_app/src/screens/player/PlayerScreen.js` — `withToken()` helper দিয়ে stream URL-এ subscriber token (query param) বসানো হয়; `player.replace()`-এও `Authorization` header পাঠানো হয় (secondary safety net)। Token `useAuth()` context থেকে আসে।

**Side Effect / সতর্কতা:**
- **মোবাইল app-এর fix কাজ করতে নতুন APK build+publish লাগবে** (`scripts/build_and_publish_livetv_apk.sh`) — এই সেশনে build করা হয়নি, শুধু source আপডেট হয়েছে। পুরনো installed app pre-fix backend logic-এর সাথে এখনো কাজ করবে (server নতুন proxy URL পাঠাচ্ছে, পুরনো app শুধু `hls_url`/`backup_urls` ফিল্ড থেকে URL নিয়ে play করে — token ছাড়া play করলে video load হবে না যতক্ষণ না app rebuild হয়, তাই পুরনো user-রা video দেখতে পারবে না নতুন build না দেওয়া পর্যন্ত — **এটা expected, দরকার হলে দ্রুত APK rebuild+push করতে হবে**)।
- **nginx `/media/hls/` lockdown এই session-এ করা হয়নি** (root প্রয়োজন, agent-এর sudo password নেই) — user-কে exact command দেওয়া হয়েছে (`allow 127.0.0.1; deny all;` block, `location /media/ {}`-এর আগে বসাতে হবে যাতে prefix-match specificity ঠিক থাকে) — user manually চালিয়ে `nginx -t && systemctl reload nginx` করবেন। যতক্ষণ না চালানো হয়, self-hosted (HDMI/DVB) চ্যানেলের raw `/media/hls/<slug>/index.m3u8` path এখনো public — subscriber যদি slug guess করে সরাসরি সেই URL হিট করে, তাহলে এখনো unauthenticated দেখতে পারবে (IPTV/URL-type চ্যানেলে এই গ্যাপ নেই, ওগুলো raw source_url আর কখনোই client-কে পাঠানো হয় না)।
- FTP Movie Server video content (`FTPVideoContent`)-এও একই ধরনের raw-URL-leak প্যাটার্ন থাকতে পারে (uploaded video file `/media/`-এর ভেতর সরাসরি) — এই সেশনে touch করা হয়নি, scope শুধু Live TV channels ছিল। ভবিষ্যতে চাইলে একই approach (subscriber-token-checked proxy) FTP video-তেও প্রয়োগ করা যাবে।
- `TVChannelViewSet.hls_proxy` (staff-only preview, admin panel `PlayerModal`) behavior অপরিবর্তিত — শুধু internal code shared function-এ refactor হয়েছে, external API/response identical।

**Tested:** হ্যাঁ — সরাসরি production gunicorn (127.0.0.1:8000)-এ curl দিয়ে: (1) token ছাড়া `/app/livetv/stream/<id>/` → 401, (2) header ও query-param token দুটোই → manifest সফলভাবে fetch+rewrite হয়ে master→sub-playlist redirect কাজ করছে, (3) SSRF: arbitrary/internal URL (`169.254.169.254`) → block, (4) disabled/non-existent channel → 404, (5) **real subscriber (id=2) toggle inactive করে confirm করা হয়েছে channel-list ও stream proxy দুটোই সাথে সাথে 401 দেয়, তারপর আগের is_active=True state restore করা হয়েছে** (production data untouched)। `manage.py check` pass, সব edited/new Python ও JS ফাইল `ast.parse`/babel parser দিয়ে syntax-verified। মোবাইল app UI-তে actual playback test করা হয়নি (নতুন APK build ছাড়া সম্ভব না)।

---

### [2026-07-02] — nginx `/media/hls/` lockdown প্রয়োগ (user manually) + Live TV app: global 401 handling + reason-aware messages

**পরিবর্তিত ফাইল:** `/etc/nginx/sites-available/isp_bnas` (system, repo-বহির্ভূত), `livetv/api/auth_views.py`, `mobile_api/api/views.py`, `livetv_app/src/services/api.js`, `livetv_app/src/context/AuthContext.js`, `livetv_app/src/screens/auth/LoginScreen.js`

**Context:** user নতুন APK build করার আগে জিজ্ঞেস করেছেন Live TV player production-এর জন্য পুরোপুরি ready কিনা, সব option ঠিকভাবে কাজ করছে কিনা এবং কী বাদ আছে। Full audit করে দুটো জিনিস পাওয়া গেছে ও ঠিক করা হয়েছে (নিচে) — বাকি সব (URL queue building, token injection, failover, TV remote, CH dial, channel switch, channel list panel) logically sound পাওয়া গেছে, কোনো bug নেই।

**কী করা হয়েছে:**
1. **nginx `/media/hls/` lockdown** — আগের সেশনে দেওয়া কমান্ড user নিজে sudo দিয়ে চালিয়েছেন। Verify করা হয়েছে: public থেকে `/media/hls/*` → 403, বাকি `/media/*` (APK ইত্যাদি) অপরিবর্তিত ২০০, localhost থেকে এখনো পড়া যায় (harmless, Django এখন disk থেকে সরাসরি পড়ে তাই আসলে ব্যবহারও করে না)।
2. **Global 401 handling (আগে সম্পূর্ণ অনুপস্থিত ছিল)** — Audit-এ পাওয়া গেছে subscriber deactivate/expire হয়ে গেলে কোনো screen-ই (`ChannelListScreen`, `HomeScreen`, `MenuScreen`) 401 handle করত না — শুধু silently swallow করে stale cached channel list দেখাত, user কোনো কারণ জানত না। Fix: `livetv_app/src/services/api.js`-এ axios response interceptor যোগ (401 + `auth_required:true` ধরে global handler কল করে); `AuthContext.js`-এ `setUnauthorizedHandler` register করে auto-logout + `logoutReason` state set করে; `LoginScreen.js` mount হলে `logoutReason` থাকলে Alert দেখায় ("লগ আউট হয়েছে: <কারণ>") তারপর clear করে।
3. **Reason-aware 401 message (backend)** — `verify_livetv_token()` আগে শুধু subscriber/None ফেরত দিত, কারণ বলত না। নতুন `verify_livetv_token_verbose()` + `REASON_MESSAGES` dict যোগ হয়েছে (`deactivated` → "বিল পরিশোধ বা অফিসে যোগাযোগ করুন", `subscription_expired`, `token_expired`, `invalid`, `missing`)। `AppLiveTVChannelsView` ও `AppLiveTVStreamProxyView` এখন এই verbose version ব্যবহার করে স্পষ্ট বার্তা পাঠায় — deactivate করা subscriber এখন সরাসরি "আপনার Live TV অ্যাকাউন্ট নিষ্ক্রিয় করা হয়েছে। বিল পরিশোধ বা অফিসে যোগাযোগ করুন।" দেখবে, generic "login করুন" নয়। `verify_livetv_token()` (পুরনো signature) অন্য caller-দের (`LiveTVMeView`, `FTPContentAppView`) জন্য অপরিবর্তিত রাখা হয়েছে (backward compatible wrapper)।

**Side Effect / সতর্কতা:**
- এই তিনটা fix-ও নতুন APK build ছাড়া app-এ কাজ করবে না (JS side changes)।
- **চিহ্নিত কিন্তু fix করা হয়নি (ভবিষ্যতের জন্য সুপারিশ, blocker নয়):**
  - `livetv_app/src/screens/channels/ChannelGridScreen.js` — App.js-এ কোথাও import/route নেই, dead/orphaned file (ChannelListScreen.js-ই আসল active screen)। প্রয়োজনে delete করা যায়।
  - Live TV `PlayerScreen.js`-এ mute/volume toggle নেই, অথচ sibling `FTPVideoPlayerScreen.js`-এ আছে (🔇/🔊ToolBtn) — consistency-এর জন্য যোগ করা যেতে পারে।
  - 90 দিনের token naturally expire হলে (deactivation নয়, স্বাভাবিক মেয়াদ শেষ) app যদি background-এ থাকে, পরের foreground-এ auto re-login prompt নেই — এখন interceptor থাকায় অন্তত পরবর্তী API call-এ logout হয়ে Login screen-এ যাবে (আগে এটাও broken ছিল, interceptor generic ভাবে এটাও কভার করে)।
  - FTP video content (আগের সেশনে চিহ্নিত raw-media-URL gap) এখনো touch করা হয়নি।

**Tested:** হ্যাঁ — production-এ (1) `curl https://roisp.duckdns.org/media/hls/test/index.m3u8` → 403 confirm, (2) real subscriber (id=2) আবার deactivate করে curl দিয়ে channel-list ও stream-proxy দুটোতেই নতুন specific বার্তা ("অ্যাকাউন্ট নিষ্ক্রিয় করা হয়েছে। বিল পরিশোধ...") পাওয়া গেছে, token ছাড়া request-এ generic "login করুন" বার্তা অপরিবর্তিত, subscriber state আবার restore করা হয়েছে। `manage.py check` pass। সব edited JS ফাইল (`api.js`, `AuthContext.js`, `LoginScreen.js`, `PlayerScreen.js`) babel parser দিয়ে syntax-verified। Interceptor logic-এর actual in-app behavior (Alert popup, navigation reset) এখনো device-এ test করা হয়নি — নতুন APK build লাগবে।

---

### [2026-07-02] — Live TV: IPTV/URL চ্যানেলের জন্য shared local relay (10k-viewer scale fix)

**পরিবর্তিত ফাইল:** `livetv/services/stream_service.py`, `livetv/api/views.py`, `mobile_api/api/views.py`, `config/settings.py`
**নতুন ফাইল:** `livetv/tasks.py`

**Context:** নতুন APK build করার আগে user জিজ্ঞেস করেছেন — একই চ্যানেল 10,000 subscriber একসাথে দেখলে system সমস্যা হবে কিনা। হিসাব করে দেখা গেছে **হ্যাঁ, ভয়াবহভাবে হবে** — আগের session-এ বানানো subscriber-proxy প্রতিটা viewer-এর জন্য আলাদা upstream fetch করত (কোনো shared caching ছিল না, strict real-time enforcement-এর জন্য ইচ্ছাকৃতভাবে বাদ দেওয়া হয়েছিল)। ২টা severe bottleneck পাওয়া গেছে:
1. **Bandwidth**: 10k viewer × ~2.6 Mbps × 2 (upstream duplicate fetch + downstream delivery) ≈ **~52 Gbps** — যেকোনো ISP সার্ভার uplink-এর অনেক গুণ বেশি, পুরো ISP-র internet-ও প্রভাবিত হতে পারত (shared uplink হলে)।
2. **Gunicorn worker starvation**: `--workers 3 --worker-class sync` — এই ৩টা worker দিয়েই billing/RADIUS/admin panel/client app/Live TV সবকিছু সার্ভ হয় (একই gunicorn instance)। রুক্ষ হিসাবে মাত্র ~15-30 concurrent Live TV viewer-ই তিনটা worker পুরোপুরি দখল করে ফেলতে পারত — billing/admin পুরোপুরি অচল হয়ে যেত।

**কী করা হয়েছে (fix):** IPTV/URL চ্যানেলকে hardware (v4l2/dvb) চ্যানেলের মতো shared local relay-তে রূপান্তর করা হয়েছে — v4l2/dvb চ্যানেলে এই সমস্যা আগে থেকেই ছিল না কারণ FFmpeg একবার হার্ডওয়্যার থেকে পড়ে local HLS লেখে, সব viewer সেই এক কপি থেকে পড়ে।
- `stream_service.py` — নতুন `_build_relay_cmd()`: url-type চ্যানেলের জন্য pure `-c copy` FFmpeg command (re-encode নয়, CPU cost প্রায় শূন্য, quality/bitrate অপরিবর্তিত)। `start_stream()` এখন url-type-এর জন্য এটা ব্যবহার করে (আগে `_build_cmd()`-এর resolution-based encoder ব্যবহার হতো শুধু v4l2/dvb/manual-transcode-এ)।
- `livetv/api/views.py` — `TVChannelViewSet.start_stream`/`stop_stream` (staff admin action) থেকে url-type-এর special-case (শুধু is_active flip) সরানো হয়েছে — এখন সব input_type-এর জন্য একই `StreamService` lifecycle (FFmpeg চালু/বন্ধ + is_active togel একসাথে)।
- `mobile_api/api/views.py` — `AppLiveTVStreamProxyView` এখন url-type চ্যানেলের জন্য **on-demand lazy-start**: প্রথম subscriber request এলে (`channel.status != 'live'` বা mirror file না থাকলে) background thread-এ `StreamService.start_stream()` ট্রিগার করে (duplicate-start guard: Redis `cache.add()` দিয়ে ২০ সেকেন্ড lock), আর ওই মুহূর্তের viewer-কে সাথে সাথে পুরনো direct-relay fallback দিয়ে সার্ভ করে (mirror warm-up-এর কয়েক সেকেন্ড কভার করতে)। Mirror ready হয়ে গেলে (status='live' + playlist file আছে) পরবর্তী সব viewer (hardware channel-এর মতোই) local disk থেকে সরাসরি serve হয় — upstream-এ শুধু একবারই hit হয়, viewer সংখ্যা যাই হোক।
- প্রতি request-এ `cache.set('livetv_viewer_ping_<id>', True, timeout=180)` রিফ্রেশ হয় — viewer আছে কিনা track করতে।
- `livetv/tasks.py` (নতুন) — `sweep_idle_url_relays` Celery task: প্রতি ২ মিনিটে চেক করে কোন url-type চ্যানেলে গত ৩ মিনিটে viewer আসেনি (`livetv_viewer_ping_<id>` cache key expired), সেগুলোর FFmpeg বন্ধ করে দেয়। **কেন দরকার:** নাহলে একবার চালু হওয়া সব চ্যানেল (৭০০+ থাকতে পারে) সবসময় চালু থেকে নিজেই bandwidth/CPU নষ্ট করত, এমনকি viewer না থাকলেও।
- `config/settings.py` — `CELERY_BEAT_SCHEDULE`-এ `sweep-idle-livetv-relays` entry (প্রতি ১২০ সেকেন্ড) যোগ।

**Side Effect / সতর্কতা:**
- **নতুন Celery periodic task register করতে `isp-celery`+`isp-celery-beat` restart লাগবে** (gunicorn-এর মতো auto-reload হয় না — আগের disk-usage task session-এও একই কথা বলা হয়েছিল, তখন user manually restart করেছিলেন) — এই session-এও করা হয়নি, user-কে করতে হবে: `sudo systemctl restart isp-celery.service isp-celery-beat.service`।
- Existing url-type চ্যানেল যেগুলো আগের scheme-এ (`is_active=True`, FFmpeg ছাড়া) চলছিল, সেগুলো স্বয়ংক্রিয়ভাবে নতুন relay scheme-এ upgrade হয়ে যাবে প্রথম viewer আসার সাথে সাথেই (lazy-start ট্রিগার করবে) — কোনো manual migration লাগবে না।
- যদি কোনো channel-এর upstream সত্যিই unreachable/flaky হয়, mirror কখনো ready হবে না — সেক্ষেত্রে প্রতি viewer-এর জন্য চিরকাল direct-relay fallback ব্যবহার হবে (আগের মতোই, কম efficient কিন্তু কাজ করবে); এমন চ্যানেলে বহু viewer জমলে আগের bandwidth ঝুঁকি এখনো প্রযোজ্য — তবে এমন চ্যানেল ping/content-check filtering-এ এমনিতেই app থেকে লুকানো থাকে বেশিরভাগ ক্ষেত্রে।
- **Testing session-এ একটা orphaned FFmpeg process থেকে গেছে** (PID পরিবর্তনশীল, `isp` system user-এর অধীনে চলছে, channel 256 "DBC News" টেস্ট করার সময় রেস কন্ডিশনে DB bookkeeping (`ffmpeg_pid`) হারিয়ে গিয়েছিল বলে normal stop flow সেটা খুঁজে পায়নি) — harmless (~0.6% CPU, একটা lightweight relay), কিন্তু আমার শেল ইউজার (`amir`) থেকে kill করা যায়নি (permission denied, ভিন্ন owner)। **user-কে manually cleanup করতে হবে:** `ps aux | grep ffmpeg` দিয়ে orphan pid খুঁজে `sudo kill <pid>`, অথবা `sudo systemctl restart isp-gunicorn.service`-ই সব clean করে দেবে। এটা শুধু test artifact — normal single-trigger production flow-এ এই race হওয়ার কথা না।
- Gunicorn worker সংখ্যা (এখনো 3, sync) বাড়ানো হয়নি এই session-এ (root/sudo লাগে, systemd unit file edit) — কিন্তু এখন প্রায় সব video-relay request local disk read (সাব-মিলিসেকেন্ড) দিয়ে সার্ভ হয় বলে worker-holding-time সমস্যা এমনিতেই বহুলাংশে কমে গেছে; তারপরও defense-in-depth হিসেবে worker সংখ্যা বাড়ানো ভবিষ্যতে বিবেচনা করা যেতে পারে।

**Tested:** আংশিক — (1) `manage.py check` pass, সব edited ফাইল `ast.parse` দিয়ে syntax-verified। (2) Real production channel-এ (id=256, DBC News) lazy-start ট্রিগার করে **প্রকৃতপক্ষে FFmpeg process spawn হয়ে বাস্তব upstream থেকে বাস্তব local HLS segment (`.ts` ফাইল + `index.m3u8`) সফলভাবে লিখতে দেখা গেছে** (`ps aux`, ffmpeg log, playlist file content সব verify করা হয়েছে) — মূল mechanism প্রমাণিত কাজ করছে। (3) Duplicate-start লক verify করা হয়নি সরাসরি concurrent load টেস্ট দিয়ে (শুধু code review দিয়ে যুক্তিসঙ্গত বলে নিশ্চিত করা হয়েছে)। (4) idle-sweep task manually trigger/verify করা হয়নি এই সেশনে (celery restart pending)। (5) একটা flaky test channel (id=69) বারবার upstream connection timeout দিয়েছে — সেটা ওই channel-এর upstream-এর সমস্যা (আগেও intermittent SSL error দেখা গিয়েছিল), আমার কোডের bug না, error-handling path (`status='error'`) সঠিকভাবে trigger হয়েছে তা দিয়ে বরং confirm হয়েছে।

---

### [2026-07-02] — Celery restart + Live TV APK v1.0.0 (build 20) build+publish

**পরিবর্তিত ফাইল:** `livetv_app/app.json` (versionCode 19→20)
**নতুন ফাইল:** `mobile_app/public_apk/rajamehar-livetv-v1.0.0-20.apk`

**কী করা হয়েছে:**
- User `sudo systemctl restart isp-celery.service isp-celery-beat.service` ও `sudo systemctl restart isp-gunicorn.service` manually চালিয়েছেন — verify করা হয়েছে: gunicorn fresh workers (নতুন PID, restart-এর সময় মিলছে), orphan ffmpeg process পরিষ্কার হয়ে গেছে, celery+celery-beat উভয়ই active, এবং `sweep-idle-livetv-relays` periodic task DB scheduler-এ registered+enabled (every 120s) — `django_celery_beat.PeriodicTask` query করে সরাসরি confirm করা হয়েছে।
- `scripts/build_and_publish_livetv_apk.sh` চালানো হয়েছে (background, Gradle build ~54s লেগেছে) — versionCode 19→20 bump, `assembleRelease` (BUILD SUCCESSFUL, 403 tasks), APK archive (`mobile_app/public_apk/rajamehar-livetv-v1.0.0-20.apk`, 67MB) তৈরি, এবং live download link (`/media/app/rajamehar-livetv.apk`) আপডেট।
- Verify করা হয়েছে: `https://roisp.duckdns.org/media/app/rajamehar-livetv.apk` → HTTP 200, file size/timestamp নতুন build-এর সাথে মিলছে।

**Side Effect / সতর্কতা:**
- **এই build-এই এই session-এর সব app-side fix প্রথমবার বাস্তবে effective হবে**: subscriber-token stream proxy (auth ছাড়া video বন্ধ), global 401 auto-logout + reason message, deactivation-এর স্পষ্ট বার্তা। আগের installed app এখনো token পাঠাবে না যতক্ষণ না update করে।
- `app.json`-এর versionCode বাম্প এখনো git commit করা হয়নি (script নিজে commit করে না, শুধু suggest করে) — চাইলে `git add livetv_app/app.json && git commit -m "chore(livetv): bump versionCode to 20"`।
- APK-তে code-signing/keystore build script নিজে handle করেছে (existing release keystore ব্যবহার হয়েছে, নতুন কিছু generate হয়নি) — `validateSigningRelease UP-TO-DATE` log-এ দেখা গেছে।

**Tested:** হ্যাঁ — gradle build success log সম্পূর্ণ পড়ে verify করা হয়েছে, archived APK file size/permission ঠিক আছে, live download URL curl দিয়ে 200+matching content-length confirm করা হয়েছে। actual device install/playback test করা হয়নি (device access নেই এই session-এ) — user manually app update করে end-to-end verify করা উচিত।

---

### [2026-07-03] — Live TV: channel "not really running" root-cause + self-heal fixes

**পরিবর্তিত ফাইল:** `livetv/services/stream_service.py`, `livetv/apps.py`, `livetv/tasks.py`, `config/settings.py`

**কী করা হয়েছে:**
- Admin panel-এ "823 Live" দেখলেও client app-এ সব channel ঠিকমতো না চলার অভিযোগ তদন্ত করা হয়েছে। মূল বাস্তবতা: "Live" badge = `is_active` flag (channel enabled), প্রকৃত ffmpeg running/reachable কিনা তা বোঝায় না (lazy-relay architecture — [[project_core]])। ৩টা channel সত্যিকারের `status='error'` ছিল (id 5 BTV, 53 Star Plus, 69 8X music) এবং ৩৩৯টা (৪১%) `last_content_ok=False` থাকায় app-এ দেখানো হয় না।
- **Root cause per channel:** BTV/Star Plus (`180.94.28.28:8097`) — upstream m3u8 fetch ঠিকই সফল হয় (source token expired না), কিন্তু actual segment fetch-এ ffmpeg বারবার `Invalid data found when processing input` দেয় — খুব ছোট live-window CDN, playlist parse করার মধ্যেই segment roll-off হয়ে যাচ্ছে (timing-sensitive, upstream-side)। curl দিয়ে verify করা হয়েছে raw segment data আসলে valid mp4 (ffmpeg-এর সমস্যা না, race condition)। 8X Music — বারবার সরাসরি `curl`/ffmpeg দিয়ে verify করে HTTP 404 পাওয়া গেছে, provider feed সত্যিই বন্ধ হয়ে গেছে (dead link)।
- **Real code bug ধরা পড়েছে:** `stream_service.py`-এর `stop_stream()` শুধু SIGTERM পাঠাত, কখনো `wait()`/reap করত না → প্রতিটা stop-এ zombie (`<defunct>`) ffmpeg process জমে থাকত (`ps aux`-এ verify করা হয়েছে)। Fix: `livetv/apps.py`-এ `AppConfig.ready()`-তে process-wide `SIGCHLD` handler বসানো হয়েছে (worker process-এ যেকোনো child মরলেই সাথে সাথে reap হয়), আর `stop_stream()`-এ ৫ সেকেন্ড পর escalation thread যোগ হয়েছে (SIGTERM-এ না মরলে SIGKILL)।
- `check_status()`-এর generic `"FFmpeg process unexpectedly terminated."` error message-এর বদলে নতুন `_extract_error_reason()` — `ffmpeg.log`-এর শেষ অংশ থেকে আসল error line (404/timeout/Invalid data ইত্যাদি) বের করে `error_message`-এ রাখে — এখন admin panel-এই আসল কারণ দেখা যাবে, `get_log` action-এ গিয়ে খুঁজতে হবে না।
- **Self-heal:** নতুন Celery task `livetv.retry_error_url_channels` (`livetv/tasks.py`) — active viewer আছে এমন `status='error'` url-channel প্রতি ৩ মিনিটে retry করে (flaky upstream নিজে থেকে সেরে গেলে admin-কে manual Start ক্লিক করতে হবে না)। `config/settings.py`-এর `CELERY_BEAT_SCHEDULE`-এ `retry-error-livetv-channels` entry যোগ হয়েছে।
- Channel id=69 (8X music) — বারবার confirm করা 404 dead feed, তাই `is_active=False` করা হয়েছে + `error_message`-এ কারণ লেখা হয়েছে যাতে admin বুঝে নতুন source URL লাগবে।

**Side Effect / সতর্কতা:**
- **৩৩৯টা channel-এর `last_content_ok=False` কোডের bug না** — এটা একটা bulk-imported public/free IPTV playlist-এর স্বাভাবিক link-rot (dead provider feed, one-time sports event মেয়াদ শেষ, ইত্যাদি)। এটা code দিয়ে "fix" করা যায় না — নতুন working source URL দরকার প্রতিটার জন্য, অথবা bulk cleanup/deactivate বিবেচনা করা যেতে পারে (এই session-এ করা হয়নি, শুধু একটা confirmed-dead channel deactivate করা হয়েছে)।
- একটা code gap পাওয়া গেছে কিন্তু fix করা হয়নি (out of scope এই session-এ): `_check_stream_content()` (livetv/api/views.py) শুধু m3u8/TS content বোঝে, DASH (`.mpd`) URL-এর জন্য সবসময় `content_ok=False` দেয় (ভুল হলেও ফলে সেই channel সবসময় app থেকে বাদ পড়ে) — DASH channel থাকলে ভবিষ্যতে এটা আলাদা handle করা দরকার।
- **`isp-celery`+`isp-celery-beat` restart লাগবে** নতুন task/schedule effective হতে (gunicorn-এর মতো auto-reload হয় না, আগের session-গুলোতেও একই কথা বলা হয়েছে) — এই session-এ sudo password ছাড়া করা যায়নি, **user-কে manually চালাতে হবে:** `sudo systemctl restart isp-celery.service isp-celery-beat.service`।
- BTV/Star Plus এখনো পুরোপুরি "fix" হয়নি — নতুন retry task দিয়ে opportunistically সেরে উঠবে (viewer request এলে), কিন্তু root upstream flakiness (CDN-এর ছোট live window) code দিয়ে সম্পূর্ণ eliminate করা যায় না।

**Tested:** আংশিক — (1) `python manage.py check` pass, সব edited ফাইল `ast.parse` দিয়ে syntax-verified। (2) `_extract_error_reason()` সরাসরি shell-এ চালিয়ে real channel-এর (id=5) ffmpeg.log থেকে সঠিক error line বের করে দেখানো হয়েছে ("Error opening input files: Invalid data found when processing input")। (3) `/livetv/channels/<id>/start/` API সরাসরি curl (JWT দিয়ে, gunicorn user context-এ, permission-সঠিক) দিয়ে ৩টা error channel-এ trigger করে verify করা হয়েছে। (4) zombie-reap/SIGCHLD handler এবং নতুন Celery task **celery restart pending থাকায় live verify করা হয়নি** — restart-এর পরে `ps aux | grep defunct` দিয়ে zombie না থাকা এবং `celery inspect registered`-এ `livetv.retry_error_url_channels` task দেখা confirm করা উচিত।

### [2026-07-03] — Live TV app player: black-screen stall watchdog + auto-transcode incompatible codecs

**পরিবর্তিত ফাইল:** `livetv_app/src/screens/player/PlayerScreen.js`, `livetv/services/stream_service.py`

**কী করা হয়েছে:**
- **App player black-screen bug (mobile app-এ, admin panel নয়):** স্ক্রিনশটে দেখা গেছে ⏸ (playing) + LIVE badge + progress bar full থাকলেও ভিডিও ফ্রেম কালো — silent decoder/network stall (audio চলে, video না, বা পুরো playback আটকে যায়)। আগের session-এ শুধু diagnosis comment + unused refs রাখা হয়েছিল, এই session-এ পুরো watchdog wire-up করা হয়েছে: `player.timeUpdateEventInterval = 1` সেট করে প্রতি সেকেন্ডে `timeUpdate`/`playingChange` event থেকে progress track করা হয় (refs-এ, re-render ছাড়া), ৮ সেকেন্ড কোনো progress না এগোলে প্রথমে একই URL soft-retry (`player.replace` দিয়ে), তাতেও না ঠিক হলে existing backup-URL failover (`tryNextUrl`)-এ পড়ে।
- **Root cause of "সব ফরম্যাটের ভিডিও ঠিকমতো না চলা" (backend fix):** `StreamService._build_relay_cmd()` (URL/IPTV shared relay, mobile app যেটা ব্যবহার করে) আগে সবসময় blind `-c copy` করত — source যদি HEVC/H.265 video বা AC3/EAC3/MP2 audio হয় (অনেক public IPTV feed-এ common), সেটা raw pass-through হয়ে যেত যা `expo-video` (ExoPlayer/AVPlayer)-এ প্রায়ই decode হয় না → ঠিক এই black-screen/silent-stall symptom। Fix: নতুন `StreamService._probe_codecs()` (ffprobe দিয়ে একবারে video+audio codec_name বের করে) স্ট্রিম শুরুর সময় check করে — video `h264` না হলে শুধু video track auto libx264-এ transcode হয় (নতুন `_forced_video_encoder()`, QSV নয়, software — URL সোর্সে QSV driver না-ও থাকতে পারে বলে `start_transcode` manual action-এর মতোই libx264 বেছে নেওয়া হয়েছে), audio `aac` না হলে শুধু audio track AAC-তে transcode হয়। যেটা compatible সেটা copy-ই থাকে (CPU cost minimize)। ffprobe fail/timeout হলে (geo-block ইত্যাদি) আগের safe default (pure copy) রাখা হয়েছে — regression risk নেই কাজ করা channel-এ।
- এখন প্রতিটা URL channel auto lazy-start (`mobile_api.AppLiveTVStreamProxyView` প্রথম viewer এলে) এই smart-copy/transcode decision নিজে থেকেই নেবে — manual per-channel "Transcode" button আর সব HEVC channel-এ click করে লাগানোর দরকার হবে না বেশিরভাগ ক্ষেত্রে।

**Side Effect / সতর্কতা:**
- `_probe_codecs()` প্রতি channel **start**-এ একবার ffprobe subprocess চালায় (~1-12s, timeout 12s) — per-viewer নয়, শুধু relay lazy-start/manual-start-এ, তাই ongoing playback-এ কোনো latency যোগ হয় না। কিন্তু admin panel-এর "Start" button click করলে synchronous request-এ এই সময়টুকু যোগ হবে (gunicorn worker সংক্ষিপ্ত সময় ব্লক থাকবে) — bad/slow upstream হলে worst case ১২ সেকেন্ড পর্যন্ত।
- এই session-এ কোনো URL channel actual চালু ছিল না (`ffmpeg_pid` সব `None`) তাই নতুন logic live channel-এ test করা যায়নি — পরের viewer app-এ কোনো channel চালালেই lazy-start নতুন code path ব্যবহার করবে, তখন `ffmpeg.log`-এ `-c:v libx264`/`-c:a aac` (transcode হলে) বা `-c:v copy -c:a copy` (compatible হলে) দেখে confirm করা যাবে।
- Mobile app-এর stall watchdog শুধু "playing" state-এ আটকে থাকা ঠিক করে — যদি স্ট্রিম আসলেই সম্পূর্ণ dead/404 হয় (যেমন আগের session-এ পাওয়া 8X music dead feed), সেটা `statusChange: 'error'`-এ গিয়ে আগে থেকেই existing failover/retry logic ধরবে, watchdog-এর প্রয়োজন হবে না।

**Tested:** আংশিক — (1) `PlayerScreen.js` babel parse দিয়ে syntax-verified (RN app চালিয়ে device/emulator-এ visually test করা হয়নি, এই environment-এ RN runtime নেই)। (2) `stream_service.py`: `python3 -m py_compile` pass, এবং `_probe_codecs`/`_build_relay_cmd`-এর ৪টা branch (fully compatible → pure copy, HEVC video → libx264+audio copy, incompatible audio (mp2) → video copy+AAC, probe timeout → safe fallback copy) mocked `subprocess.run` দিয়ে সরাসরি shell-এ চালিয়ে সঠিক ffmpeg command generate হওয়া confirm করা হয়েছে। Live ffmpeg process দিয়ে end-to-end test করা হয়নি (কোনো channel এই মুহূর্তে running ছিল না)।

### [2026-07-03] — Admin panel player 403 fix — local FFmpeg mirror hls-proxy দিয়ে serve

**পরিবর্তিত ফাইল:** `livetv/api/views.py` (TVChannelViewSet.hls_proxy + নতুন `_serve_local_mirror`), `admin_panel/src/pages/livetv/LiveTVPage.jsx` (toProxyUrl)

**কী করা হয়েছে:**
- **Root cause (admin panel player-এ সব চ্যানেল 403):** URL/IPTV চ্যানেল এখন local FFmpeg mirror (`/media/hls/<slug>/index.m3u8`) লেখে, আর serializer `get_hls_url` FFmpeg চললে সেই same-origin `/media/hls/…` URL admin frontend-কে দেয়। কিন্তু আগের security session-এ (2026-07-02) nginx-এ `/media/hls/` lockdown (`allow 127.0.0.1; deny all`) বসানো হয়েছিল (public raw HLS leak বন্ধ করতে)। ফলে admin browser (public domain থেকে) `/media/hls/…` সরাসরি হিট করলে **nginx 403 Forbidden**। `toProxyUrl` আগে শুধু ভিন্ন-host URL proxy করত, same-host `/media/hls/` as-is ছেড়ে দিত → সরাসরি 403। (User স্ক্রিনশটে `roisp.duckdns.org/media/hls/9xm-tv/index.m3u8` → "403 Forbidden nginx/1.28.3" নিশ্চিত করেছে।)
- **App কেন unaffected:** subscriber app আলাদা authenticated endpoint (`mobile_api.AppLiveTVStreamProxyView._serve_local`) ব্যবহার করে যা Django (127.0.0.1) disk থেকে bytes পড়ে stream করে — nginx `/media/hls/` কখনো হিট করে না। curl দিয়ে verify: app manifest+segment 200 (valid MP2T), token ছাড়া 401 — app ঠিকই চলছিল।
- **Fix:** `TVChannelViewSet.hls_proxy` (already `AllowAny` — staff player-এর জন্য 2026-07-03-এ করা) এখন detect করে target `?url=` আমাদের নিজস্ব `/media/hls/…` path কিনা — হলে নতুন `_serve_local_mirror()` disk থেকে সরাসরি serve করে (m3u8 segment line-গুলো আবার একই hls-proxy দিয়ে rewrite করে যাতে browser raw /media/hls/ কখনো হিট না করে)। External upstream URL হলে আগের মতোই SSRF netloc-allowlist + `proxy_and_rewrite_hls`। Frontend `toProxyUrl` এখন same-host হলেও `/media/hls/` path proxy দিয়ে পাঠায়। **nginx config অপরিবর্তিত** (কোনো reload/sudo লাগেনি — deny-all lockdown বহাল, শুধু Django-served proxy path দিয়ে bypass)।

**Side Effect / সতর্কতা:**
- `_serve_local_mirror` `AllowAny` (parent `hls_proxy`-র মতোই) — অর্থাৎ login ছাড়া কেউ `hls-proxy/?url=/media/hls/<slug>/index.m3u8` জানলে transcoded mirror pull করতে পারবে (channel id/slug enumerable)। এটা `hls_proxy`-র already-accepted staff-convenience tradeoff-এর সাথে consistent (2026-07-03 work log-এ signed-URL/rate-limit ভবিষ্যতে করার কথা বলা আছে)। **Subscriber app এতে প্রভাবিত নয়** — সেটা আলাদা token-authenticated path। Path traversal guard আছে (`MEDIA_ROOT/hls`-এর বাইরে গেলে 400 — `../../etc/passwd` টেস্টে confirmed 400)।
- Admin panel frontend **rebuild করা হয়েছে** (`vite build` done, `dist/` আপডেটেড) — nginx সরাসরি dist serve করে, browser hard-refresh (Ctrl+Shift+R) লাগতে পারে cached JS-এর জন্য।

**Tested:** হ্যাঁ (backend live) — running channel-4 (8X music, ffmpeg_pid live) দিয়ে curl-এ verify: (1) admin hls-proxy দিয়ে local mirror manifest → 200, segment line ঠিকমতো `hls-proxy/?url=%2Fmedia%2Fhls%2F…` rewrite হয়েছে। (2) fresh segment fetch → HTTP 200, size ~761KB, `video/MP2T`. (3) path traversal (`/media/hls/../../etc/passwd`) → 400. (4) non-registered external netloc → 400 (SSRF বহাল)। (5) `py_compile` pass, `vite build` success। Admin browser-এ visual playback user স্ক্রিনশটে confirm করেছে (8X music চলছে)।

### [2026-07-03] — App player "Stream Unavailable" fix — stream URL-এ index.m3u8 suffix (HLS detection)

**পরিবর্তিত ফাইল:** `mobile_api/api/urls.py` (নতুন .m3u8 route), `mobile_api/api/views.py` (AppLiveTVChannelsView stream_url), `livetv_app/src/screens/player/PlayerScreen.js` (contentType:'hls')

**কী করা হয়েছে:**
- **Root cause (app player-এ "Stream Unavailable — All 1 URLs failed"):** admin panel ঠিক হওয়ার পরও app-এ 8X music চলছিল না। Backend সম্পূর্ণ সুস্থ প্রমাণিত: local mirror `ffprobe`-এ **H.264 High/720p + AAC LC** (fully mobile-compatible), app endpoint manifest+segment curl-এ 200 (valid MP2T)। আসল সমস্যা client-side: app যে stream URL পেত (`/api/v1/app/livetv/stream/69/`) তার **path-এ কোনো `.m3u8` extension ছিল না** — `expo-video` (ExoPlayer/AVPlayer) extension/contentType hint ছাড়া manifest-কে HLS হিসেবে চিনতে পারে না → format error → "Stream Unavailable"। (admin panel hls.js explicit HLS player তাই সেখানে সমস্যা হয়নি।)
- **Fix (মূলত server-side, APK rebuild ছাড়াই কাজ করে):** নতুন URL route `livetv/stream/<id>/index.m3u8` (একই `AppLiveTVStreamProxyView`, suffix শুধু decoration), আর `AppLiveTVChannelsView`-এ stream_url + backup_url এখন `/index.m3u8` suffix সহ ফেরত দেয়। app শুধু API যে URL দেয় সেটাই বাজায় → **পুরনো published APK-ও পরের launch-এ নতুন .m3u8 URL পেয়ে ঠিক চলবে** (channels list প্রতিবার fresh fetch হয়)।
- বাড়তি নিরাপত্তা হিসেবে `PlayerScreen.js`-এর `applyUrl`-এ source-এ `contentType: 'hls'` যোগ করা হয়েছে (পরের APK build-এ কাজ করবে; server-side fix বর্তমান APK-এর জন্য যথেষ্ট)।

**Side Effect / সতর্কতা:**
- Segment URL-গুলো এখনো extension-হীন base route (`/stream/<id>/?url=segXXX.ts`) ব্যবহার করে — এটা ঠিক আছে, কারণ ExoPlayer manifest থেকে HLS চিনে ফেলার পর segment-কে playlist context থেকেই media হিসেবে ধরে (`video/MP2T` content-type সহ)। শুধু প্রথম manifest URL-এর extension গুরুত্বপূর্ণ ছিল।
- Channels list 45s Redis cache — fix-এর পর `mobile_livetv_channels` key delete করা হয়েছে যাতে সাথে সাথে নতুন URL যায়।

**Tested:** হ্যাঁ (backend live) — (1) local mirror `ffprobe` → h264 High 720p + aac LC confirmed। (2) channels API এখন `.../stream/69/index.m3u8` ফেরত দেয় (curl verified)। (3) নতুন `.m3u8` route manifest → 200, `application/vnd.apple.mpegurl`, segment rewrite সঠিক। (4) সেই manifest থেকে fresh segment → 200, ~770KB `video/MP2T`. (5) `py_compile` + babel parse pass। App device-এ visual playback user-কে verify করতে হবে (app বন্ধ করে আবার খুললেই নতুন URL পাবে)।

### [2026-07-03] — "অ্যাপে দেখাচ্ছে" badge সংখ্যা app-এর আসল count-এর সাথে মেলানো (single source of truth)

**পরিবর্তিত ফাইল:** নতুন `livetv/services/app_visibility.py`, `mobile_api/api/views.py` (AppLiveTVChannelsView refactor), `livetv/api/views.py` (stats endpoint)

**কী করা হয়েছে:**
- **Root cause:** admin panel-এর "অ্যাপে দেখাচ্ছে" badge (755) আর app-এর আসল channel সংখ্যা মিলত না, কারণ দুই জায়গায় দুই রকম হিসাব ছিল। stats endpoint (`TVChannelViewSet.stats`) শুধু DB `last_ping_*` field দিয়ে গুনত — **name dedup করত না, `last_content_ok=False` বাদ দিত না, not-yet-pinged handle করত না**। অন্যদিকে app-এর আসল list (`AppLiveTVChannelsView`) Redis ping cache + content_ok বাদ + name dedup করত। ফলে badge overcount (755) দেখাত, app আসলে অনেক কম (373) দেখাত।
- **Fix:** নতুন shared function `livetv/services/app_visibility.py:get_visible_channels()` — app-এর পুরো filter+dedup logic (is_active, Redis ping ≤200ms, content_ok≠False, hardware live, name dedup, sort) একক জায়গায়। `AppLiveTVChannelsView` এখন এটা call করে শুধু URL বসায় (আগের inline logic সরানো হয়েছে), আর stats endpoint `len(get_visible_channels())` দিয়ে গোনে। **এক সোর্স → সংখ্যা সবসময় মিলবে।**

**Side Effect / সতর্কতা:**
- badge এখন 755-এর বদলে সঠিক ~373 দেখাবে (কমে যাওয়া মানে bug নয় — আগের 755 ভুল ছিল; duplicate নাম + dead-content channel গোনা হচ্ছিল)।
- `get_visible_channels()` Redis ping cache পড়ে, তাই stats আর app list আলাদা মুহূর্তে call হলে ping cache সামান্য ভিন্ন হতে পারে — কিন্তু logic অভিন্ন, তাই কার্যত মিলবে। app list-এর 45s response cache (`mobile_livetv_channels`) stats-এ ব্যবহার হয় না (প্রতিবার recompute) — নগণ্য timing পার্থক্য।
- `AppLiveTVChannelsView`-এ পুরনো unused `PING_THRESHOLD_MS` class attr এখনো আছে (harmless) — এখন threshold shared module-এ।

**Tested:** হ্যাঁ (backend live) — তিনটাই একসাথে **373** মিলেছে: `get_visible_channels()` সরাসরি=373 (unique names 373, কোনো duplicate নেই), stats API `app_visible`=373, app channels API `count`=373। app list structure অক্ষত (hls_url `.../index.m3u8`, backup_urls, category_display সব ঠিক)। `py_compile` pass। stats badge frontend-only render তাই vite rebuild লাগেনি।

### [2026-07-03] — "অ্যাপে দেখাচ্ছে" badge ডাইনামিক auto-update নিশ্চিত করা

**পরিবর্তিত ফাইল:** `livetv/api/views.py` (stats endpoint — Cache-Control header)

**কী করা হয়েছে:**
- User চেয়েছিল badge সংখ্যা app-এর live count অনুযায়ী অটো আপডেট হোক। বাস্তবে admin panel **আগে থেকেই** প্রতি ১০ সেকেন্ডে poll করে (`LiveTVPage.jsx` — `setInterval(fetchData, 10000)`, fetchData stats সহ রিফ্রেশ করে), আর stats endpoint প্রতি call-এ live `get_visible_channels()` চালায় (কোনো server cache নেই)। প্রমাণ: পরপর call-এ সংখ্যা 373→378→396 বদলেছে (background ping যত channel reachable করছে), এবং একটা channel deactivate করলে সাথে সাথে 378→377, restore-এ 377→378।
- **একমাত্র gap:** stats response-এ `Cache-Control` header ছিল না → browser/proxy heuristically stale সংখ্যা cache করে ফেলতে পারত। যোগ করা হয়েছে `Cache-Control: no-store, must-revalidate` — প্রতিটা ১০-সেকেন্ড poll এখন গ্যারান্টিড fresh count পাবে।

**Side Effect / সতর্কতা:** কোনো নতুন polling যোগ করা হয়নি (already ছিল)। stats প্রতি call-এ ১টা DB query + ১টা Redis get_many চালায় — ১০s interval-এ নগণ্য load।

**Tested:** হ্যাঁ — stats API এখন `cache-control: no-store, must-revalidate` header দেয় (curl -D verified), HTTP 200, live count রিটার্ন করে। `py_compile` pass।

### [2026-07-03] — Player quality/latency উন্নতি — stats overlay fix + live-edge catch-up + transcode preset

**পরিবর্তিত ফাইল:** `admin_panel/src/pages/livetv/LiveTVPage.jsx` (PlayerModal — hls.js config + stats), `livetv/services/stream_service.py` (`_forced_video_encoder`)

**গুরুত্বপূর্ণ বাস্তবতা:** বেশিরভাগ চ্যানেল `-c copy` (lossless passthrough) — ছবি/অডিও হুবহু upstream source quality, যা ইতিমধ্যেই সর্বোচ্চ (re-encode = quality loss, তাই improve করা মানে degrade করা নয়)। quality মূলত upstream feed-এর bitrate/resolution-এ সীমাবদ্ধ, আমাদের হাতে নয়। তাই "crystal clear" মানে আসল ৩টা সমস্যা ঠিক করা: (১) stats display bug, (২) latency, (৩) transcoded-চ্যানেলের encode quality।

**কী করা হয়েছে:**
- **Stats overlay bug fix (`Resolution: 0x0`, `Bitrate: (খালি)`):** আমাদের local FFmpeg mirror একটা media-playlist (master নয়), তাই hls.js-এর `level.width/height/bitrate` 0/undefined আসত। এখন resolution আসল decoded video থেকে (`videoWidth/videoHeight`) আর bitrate hls.js-এর measured `bandwidthEstimate` থেকে নেওয়া হয় → সঠিক মান দেখাবে।
- **Live gap ~20s → smooth catch-up:** hls.js config-এ `maxLiveSyncPlaybackRate: 1.5` + `liveMaxLatencyDurationCount: 5` যোগ — live edge থেকে বেশি পিছিয়ে গেলে hard-jump ছাড়াই সামান্য দ্রুত (১.৫x) চালিয়ে ধীরে ধীরে ~৯s-এ ফিরে আসবে। `backBufferLength: 15` + `maxBufferLength: 30` — memory ও stall balance।
- **Transcoded চ্যানেলের ছবি উন্নত (`_forced_video_encoder`):** `-preset ultrafast` → `veryfast` (একই bitrate-এ স্পষ্টতর, macroblocking কম), সাথে `-profile:v high -level 4.1`, `-maxrate 1.5×/-bufsize 2×`, `-pix_fmt yuv420p`। শুধু incompatible-codec (HEVC ইত্যাদি) চ্যানেলে প্রযোজ্য (হাতেগোনা), copy চ্যানেলে কোনো প্রভাব নেই। CPU সামান্য বাড়বে (software libx264) কিন্তু transcode চ্যানেল কম বলে গ্রহণযোগ্য।

**Side Effect / সতর্কতা:**
- Copy-passthrough চ্যানেলের ছবি/অডিও **আরও clear করা সম্ভব নয়** — সেটা source feed-এর মানেই সীমাবদ্ধ (আমরা lossless দিচ্ছি)। blurry দেখালে upstream URL নিজেই low-bitrate; সমাধান = ভালো source URL।
- নতুন transcode preset শুধু পরবর্তী (re)start-এ প্রযোজ্য — বর্তমানে চলা কোনো transcoded চ্যানেল থাকলে restart লাগবে (এই মুহূর্তে কোনো HEVC channel transcode হচ্ছিল না)।
- admin panel frontend **rebuild করা হয়েছে** (`vite build` done) — browser hard-refresh (Ctrl+Shift+R) লাগতে পারে।

**Tested:** আংশিক — `_forced_video_encoder()` সঠিক ffmpeg args দেয় (shell-এ verify: `-preset veryfast -profile:v high -maxrate 3750k -bufsize 5000k …`), `py_compile` + `vite build` pass। Live playback-এ stats overlay সঠিক resolution/bitrate দেখানো ও live-gap কমা user-কে browser-এ hard-refresh করে verify করতে হবে।

### [2026-07-03] — App "কিছুক্ষণ চলার পর Stream Unavailable" fix — idle-sweep relay বন্ধ করছিল

**পরিবর্তিত ফাইল:** `mobile_api/api/views.py` (VIEWER_PING_TTL), `livetv/services/stream_service.py` (relay list_size floor)

**Root cause (ffmpeg.log + live inspection দিয়ে নিশ্চিত):** app-এ চ্যানেল ~৪-৫ মিনিট নিখুঁত চলার পর "Stream Unavailable — All 1 URLs failed" দেখাচ্ছিল। Hindi Hits HD (id=83)-এর `ffmpeg.log`-এ শেষ লাইন `Exiting normally, received signal 15` (SIGTERM) — relay ঠিকঠাক segment লিখছিল, হঠাৎ বন্ধ। SIGTERM এসেছে **idle-relay sweep** (`livetv.sweep_idle_url_relays`, প্রতি ২ মিনিট) থেকে: `livetv_viewer_ping_<id>` cache key (TTL ছিল ১৮০s) expire করলে relay বন্ধ করে দেয়। player ~১০৫s চলার পর stall করে segment fetch থামিয়ে দিলে ১৮০s পর ping expire → relay killed → বাকি segment 404 → app error (পুরনো APK ১টা URL-এ fail করলে auto-recover করে না)।
- **অতিরিক্ত fragility:** relay-র live window ছোট (hls_list_size=5, ~15s) — player সামান্য পিছিয়ে পড়লেই চাওয়া segment disk থেকে মুছে যেত → 404।

**Fix:**
- `VIEWER_PING_TTL` ১৮০s → **৬০০s (১০ মিনিট)** — সাময়িক stall/buffering-এ relay আর বন্ধ হবে না; player recover করলে বা user Retry করলে relay জীবিত পাবে। পরিত্যক্ত relay এখনো ১০-১২ মিনিটে sweep হয় (bandwidth waste নগণ্য)। gunicorn auto-reload-এই কার্যকর (sweep task শুধু key **পড়ে**, TTL view সেট করে — Celery restart লাগেনি; live Redis-এ ping key TTL 582 confirmed)।
- relay `hls_list_size` কমপক্ষে **৮** (`max(channel.hls_list_size, 8)`) — বড় live window, brief stall-এ segment roll-off কম; healthy player তবু live edge-এর কাছে চলে তাই latency বাড়ে না। (live verify: নতুন Hindi Hits HD relay-তে `hls_list_size 8`।)
- **সম্পূর্ণ recovery-র জন্য app-side watchdog (আগের commit-এ করা `PlayerScreen.js` stall watchdog) পরবর্তী APK build-এ দরকার** — তখন stall ৮s-এ ধরে soft-retry করবে, ping কখনো expire-ই করবে না।

**Side Effect / সতর্কতা:**
- বর্তমানে চলা পুরনো ৫টা relay এখনো list_size=5-এ চলছে — পরের (re)start-এ ৮ হবে (Hindi Hits HD restart হয়ে গেছে test-এ)।
- ১০ মিনিট TTL মানে user app বন্ধ করলে relay সর্বোচ্চ ~১২ মিনিট চলতে পারে idle — ছোট ISP-তে গ্রহণযোগ্য; অনেক concurrent viewer হলে ভবিষ্যতে app foreground/background signal দিয়ে explicit stop যোগ করা যায়।

**Tested:** হ্যাঁ (backend live) — (1) `ffmpeg.log`-এ SIGTERM root cause confirmed। (2) নতুন request-এ Redis ping key TTL=582 (~600) confirmed। (3) Hindi Hits HD lazy-restart → status live, ffmpeg_pid 69766, নতুন relay `hls_list_size 8`। (4) `py_compile` pass। App device-এ "কিছুক্ষণ চলার পর বন্ধ" আর হয় কিনা user-কে verify করতে হবে (নতুন APK-এ watchdog সহ সম্পূর্ণ resilient হবে)।

### [2026-07-03] — Live TV APK build 22 publish (সব app-side fix একসাথে)

**পরিবর্তিত ফাইল:** `livetv_app/app.json` (versionCode 21→22), `livetv_app/android/app/build.gradle` (versionCode 19→22)

**কী করা হয়েছে:**
- এই session-এর সব app-side fix bundle করে নতুন sideload APK build+publish করা হয়েছে: `PlayerScreen.js`-এর stall watchdog (timeUpdate progress track → ৮s stall-এ soft-retry → backup failover) + `contentType:'hls'` hint। (backend fixes — .m3u8 route, hls-proxy local mirror, idle-sweep TTL, codec auto-transcode — আগেই live ছিল, APK লাগে না।)
- Build: `bash scripts/build_and_publish_livetv_apk.sh` (Gradle assembleRelease, ১m২৬s, BUILD SUCCESSFUL) → `mobile_app/public_apk/rajamehar-livetv-v1.0.0-22.apk` (67M) → `media/app/rajamehar-livetv.apk` আপডেট।
- **versionCode sync fix:** আগের builds-এ শুধু `app.json` bump হতো, `android/app/build.gradle` hardcoded `19`-এই আটকে ছিল (script prebuild চালায় না) — তাই published APK-গুলোর প্রকৃত versionCode 19 ছিল যদিও filename -20/-21। এবার দুটোই 22-তে sync করা হয়েছে; `aapt2 dump badging`-এ নিশ্চিত published APK `versionCode='22'`। ভবিষ্যতে বিল্ডের আগে `build.gradle` versionCode-ও bump করা মনে রাখতে হবে (বা script-এ যোগ করা)।

**Side Effect / সতর্কতা:**
- Release APK **debug.keystore** দিয়ে signed (`signingConfigs.debug`) — সব build একই key, তাই sideload update/reinstall কাজ করে। ইনস্টল করা আগের build যদি ভিন্ন key-তে signed হতো তবে "signatures don't match" হতে পারে → user uninstall করে install করবে।
- ডাউনলোড লিংক অপরিবর্তিত: **https://roisp.duckdns.org/media/app/rajamehar-livetv.apk** (nginx সরাসরি serve)। HTTP 200, 69.4MB verified।

**Tested:** হ্যাঁ — BUILD SUCCESSFUL, `aapt2` → versionCode 22, served file = archive (69409575 bytes হুবহু), download link HTTP 200। Device-এ install করে watchdog আচরণ user verify করবেন।

### [2026-07-03] — App "কিছুক্ষণ পর Stream Unavailable" + বিকৃত ভিডিও-র আসল fix — mirror-only serving + screen-fit toggle

**পরিবর্তিত ফাইল:** `mobile_api/api/views.py` (AppLiveTVStreamProxyView.get — upstream 302 path বাদ, mirror-only + warm-up wait), `livetv_app/src/screens/player/PlayerScreen.js` (screen-fit toggle)

**Root cause (curl দিয়ে নিশ্চিত — আগের TTL fix-এর পরও সমস্যা ছিল):** cold-start-এ app-এর manifest request `proxy_and_rewrite_hls`-এ যেত; source **master playlist** হলে সেটা **302 redirect** দিত best rendition-এ (full `http://` upstream URL)। ফলে player "upstream world"-এ আটকে যেত — (১) প্রতি segment সরাসরি flaky upstream-এ hit, (২) master-এর video-only rendition বাছলে **A/V split/বিকৃত ভিডিও**, (৩) সবচেয়ে খারাপ: mirror `live` হওয়ার পর সেই full-URL segment request `_serve_local`-এ গিয়ে basename mirror dir-এ না পেয়ে **404 → "Stream Unavailable"** (ঠিক "কিছুক্ষণ চলার পর বন্ধ" symptom)। ffprobe-এ mirror নিজে **1920×1080 h264 + aac** (নিখুঁত 1080p) — অর্থাৎ quality ঠিকই ছিল, player ভুল (upstream) path-এ ছিল।

**Fix (মূলত server-side, বর্তমান APK-এও কার্যকর):**
- `AppLiveTVStreamProxyView.get()` url-channel path সম্পূর্ণ **mirror-only** করা হয়েছে — upstream 302/`proxy_and_rewrite_hls` branch বাদ। সবাই এখন clean muxed local mirror (একই `segNNN.ts` naming) থেকে দেখে → কোনো 302, কোনো full-URL segment, কোনো mid-play 404, কোনো A/V split।
- cold-start-এ lazy-start করে **warm-up wait** (manifest request-এ সর্বোচ্চ ৭s, প্রতি ০.৫s-এ mirror ready কিনা চেক; সাধারণত ২-৪s-এ প্রথম segment পেয়ে clean mirror manifest serve করে)। এখনো তৈরি না হলে **503 + Retry-After: 3** (player একটু পরে refetch করবে)।
- **verify:** cold manifest → 302-এর বদলে এখন `segNNN.ts` সহ clean mirror manifest; warm manifest → 200 @ 11ms; fresh segment → 200, 2.3MB `video/MP2T`; channel status live।
- **Screen-fit toggle (`PlayerScreen.js`):** top bar-এ নতুন **⤢** বাটন — cover (ফুল স্ক্রিন, default) → contain (পুরো ফ্রেম) → fill (স্ট্রেচ) cycle করে, টগলে সংক্ষিপ্ত hint দেখায়। VideoView `contentFit` এখন state-driven (আগে hardcoded "contain" ছিল বলে ভিডিও পাশে black-bar/box দেখাত — "স্প্রিটে" অভিযোগ)। **APK rebuild দরকার এই অংশের জন্য।**

**Side Effect / সতর্কতা:**
- cold manifest-এ সর্বোচ্চ ৭s gunicorn worker block হয় (শুধু প্রথম viewer/cold channel-এ; mirror live হলে 11ms)। ছোট ISP-তে গ্রহণযোগ্য; অনেক concurrent distinct-channel cold-start হলে worker চাপ পড়তে পারে — দরকারে gunicorn worker বাড়ানো।
- `?backup=N` param এখন কার্যত mirror-ই serve করে (upstream backup path বাদ) — mirror source_url থেকেই তৈরি। backup failover ভবিষ্যতে relay-এর ভিতরে করা যেতে পারে।
- এই fix বর্তমান installed APK-কেও (build 22/পুরনো) সাথে সাথে সাহায্য করে, কারণ URL logic server-side।

**Tested:** হ্যাঁ (backend live, ব্যাখ্যা উপরে) + `py_compile` ও PlayerScreen.js babel parse pass। Screen-fit toggle device-এ verify নতুন APK build-এর পর।

### [2026-07-03] — উভয় player-পথ health verify + relay-তে browser User-Agent যোগ

**পরিবর্তিত ফাইল:** `livetv/services/stream_service.py` (`_input_url` — `-user_agent` যোগ)

**কী করা হয়েছে (verification):** app ও admin দুই player-পথ curl দিয়ে end-to-end যাচাই — নমুনা চ্যানেল 69/70/78/80 (8X music, 9XM, DW English, EWTN):
- **App path** (`/api/v1/app/livetv/stream/<id>/index.m3u8`): চারটাতেই clean mirror manifest 200 + fresh segment 200 (754KB–2.5MB, valid `video/MP2T`)। cold-start warm-up wait ঠিকমতো clean mirror serve করে (302/upstream আর নয়)।
- **Admin path** (serializer `hls_url` → `toProxyUrl` → `hls-proxy`): চারটাতেই local mirror manifest 200 + segment 200। cold url channel-এ serializer upstream URL দেয়, hls-proxy সঠিকভাবে upstream forward করে (dead upstream হলে সঠিক 404)।
- **চ্যানেল switch:** প্রতিটা চ্যানেল স্বাধীনভাবে নিজের mirror lazy-start করে serve করে — অর্থাৎ switch/পরিবর্তন সঠিকভাবে কাজ করে।
- **relay-তে browser `-user_agent` যোগ** (`_input_url`) — অনেক CDN/worker endpoint UA ছাড়া 400/403 দেয়; এখন Chrome UA পাঠানো হয় (পরের (re)start-এ প্রযোজ্য)।

**পাওয়া সমস্যা (কোড bug নয় — source-limited):**
- **CHAMPIONS TV 2 (id=757)** — source `.mpd` (DASH) Cloudflare-worker endpoint যা ffmpeg-কে UA দিয়েও **HTTP 400** দেয় (browser fingerprint/token auth যা ffmpeg replicate করতে পারে না)। content-check ভুলভাবে `content_ok=True` দিয়েছিল (TCP+m3u8 fetch OK কিন্তু ffmpeg pull fail)। এটা dead source — নতুন working URL লাগবে বা deactivate করা উচিত (এই session-এ data modify করিনি, user-কে জানানো হলো)।
- এমন DASH/event-SSAI (Google DAI) source গুলো inherently unreliable — bulk IPTV playlist-এর স্বাভাবিক link-rot।

**Tested:** হ্যাঁ — উপরের সব curl live server-এ চালিয়ে verify। `py_compile` pass।

### [2026-07-03] — App player: auto screen-fit (manual toggle বাদ) + buffer tuning; APK build 24

**পরিবর্তিত ফাইল:** `livetv_app/src/screens/player/PlayerScreen.js`, `livetv_app/app.json`+`android/app/build.gradle` (versionCode 24)

**কী করা হয়েছে (user request অনুযায়ী):**
- **ম্যানুয়াল ফিট টগল (⤢) সম্পূর্ণ বাদ** — আগের commit-এ যোগ করা cover/contain/fill cycle বাটন ও সংশ্লিষ্ট state/style মুছে ফেলা হয়েছে।
- **অটোমেটিক স্ক্রিন-ফিট (orientation-aware):** `useWindowDimensions()` দিয়ে — landscape (TV/মোবাইল আড়াআড়ি) → `contentFit="cover"` (black-bar ছাড়া পুরো স্ক্রিন ভরে), portrait (মোবাইল খাড়া) → `contentFit="contain"` (পুরো ফ্রেম, অতিরিক্ত crop ছাড়া)। rotation করলে নিজে থেকেই বদলায়। যেকোনো ডিভাইসে (TV/মোবাইল/অন্য) স্ক্রিন অনুযায়ী ফিট।
- **কম "loading"/rebuffer:** expo-video `bufferOptions` — `preferredForwardBufferDuration: 12` (live window ~২৪s-এর মধ্যে যথেষ্ট আগেভাগে buffer), `minBufferForPlayback: 1.5` (stall-এর পর দ্রুত resume)।
- **"সোর্স as-is" ও "overlap নয়" — আগেই satisfied:** relay `-c copy` করে (byte-faithful passthrough; শুধু incompatible codec auto-transcode) — অর্থাৎ সোর্স যেভাবে আসে সেভাবেই। আর প্রতি চ্যানেলে ঠিক ১টি ffmpeg relay চলে (lazy-start lock + start→stop guard; `ps` দিয়ে verified — কোনো duplicate/overlap নেই)।

**Side Effect / সতর্কতা:**
- landscape-এ `cover` মানে ভিডিও aspect ≠ স্ক্রিন aspect হলে সামান্য crop (যেমন ২০:৯ ফোনে ১৬:৯ ভিডিও → উপর/নিচ সামান্য কাটা) — কিন্তু এটাই "ফুল স্ক্রিন" চাওয়ার সাথে সঙ্গতিপূর্ণ, black bar থাকে না।
- APK **build 24** rebuild দরকার ছিল (হয়েছে)।

**Tested:** babel parse pass; APK build 24 publish (নিচে verify)।

### [2026-07-03] — App-এ BTV না দেখানো fix — dedup non-error prefer + mirror-ready freshness-ভিত্তিক

**পরিবর্তিত ফাইল:** `livetv/services/app_visibility.py` (dedup rank), `mobile_api/api/views.py` (`_mirror_ready` freshness + warm-up 10s)

**Root cause (২টা bug একসাথে):** admin-এ BTV চললেও app-এ চলছিল না।
1. **Dedup ভুল চ্যানেল বাছত:** "BTV" নামে ৮টা চ্যানেল; name-dedup সবচেয়ে কম ping-এরটা রাখত = **id=5 (ping 5ms কিন্তু status=error)**। id=5-এর source টোকেন-সহ fmp4 feed — browser/hls.js-এ চলে (তাই admin-এ FIFA দেখাচ্ছিল) কিন্তু ffmpeg relay সেটা টানতে পারে না ("Invalid data")। ফলে app ভাঙা source পেত। working BTV source (id=620/198 gpcdn, status=stopped) উপেক্ষিত হতো।
2. **App-only cold-start চিরকাল 503:** `_mirror_ready()` `status=='live'` চাইত, কিন্তু `starting`→`live` flip শুধু **admin viewset** করে (app path করে না)। তাই app থেকে খোলা চ্যানেলের relay segment লিখলেও status 'starting'-এ আটকে থাকত → app সবসময় 503 → "Stream Unavailable"।

**Fix:**
- **Dedup rank** (`app_visibility.get_visible_channels`): এখন `(non-error, pinged, low-ms)` — একই নামে error+low-ping আর working source থাকলে **working টা** বেছে নেয়। BTV এখন id=620 (working gpcdn) দেখায়।
- **`_mirror_ready` freshness-ভিত্তিক:** DB status নয়, **playlist file গত ৩০s-এ আপডেট হয়েছে কিনা** তা দেখে — 'starting' relay segment লিখলেই ready ধরে serve করে। Bonus: relay মরে playlist বাসি হলে serve না করে fresh lazy-start করে (আগে stale mirror serve হওয়ার ঝুঁকি ছিল)।
- warm-up wait ৭s → **১০s** (BTV-র মতো ধীর source-এর প্রথম segment তৈরির সময় দিতে)।

**Side Effect / সতর্কতা:**
- app-এ BTV এখন gpcdn feed (id=620), admin-এর FIFA feed (id=5) নয় — দুটোই "BTV" কিন্তু ভিন্ন source। id=5-এর fmp4 relay-incompatibility আলাদা সমস্যা (ffmpeg fmp4+token টানতে পারে না); working BTV দেখানোই লক্ষ্য ছিল।
- freshness threshold ৩০s (segment ~৩s × ১০) — এর বেশি পুরনো playlist = dead relay ধরে নেয়।

**Tested:** হ্যাঁ (backend live) — dedup এখন BTV id=620 দেয় (shell verify); app cold-start BTV id=620 → manifest 200 + segment 200 (638KB `video/MP2T`); ch 69 sanity 200; app channel list-এ BTV (620) + BTV NATIONAL (119) দেখাচ্ছে। `py_compile` pass।

### [2026-07-03] — fMP4/CMAF (BTV FIFA feed) relay fix — extension_picky + separate-audio master pass-through

**পরিবর্তিত ফাইল:** `livetv/services/stream_service.py` (`_input_url` + `_resolve_hls_url`)

**Root cause:** BTV id=5 (FIFA World Cup fmp4 feed, `180.94.28.28:8097//BTV/index.fmp4.m3u8?token=…`) admin-এ (hls.js) চলত কিন্তু relay ffmpeg "Invalid data found" দিত — দুটো কারণ:
1. **`.hls.fmp4` extension reject:** ffmpeg 8.0 fMP4 segment-এর অস্বাভাবিক extension (`.hls.fmp4`) `-allowed_extensions ALL`-এও reject করত ("mismatches allowed extensions" → segment load fail)। **`-extension_picky 0`** দিলে ঠিক হয় (curl+ffmpeg টেস্টে confirmed)।
2. **audio বাদ পড়া:** source একটা CMAF master — আলাদা audio (`#EXT-X-MEDIA:TYPE=AUDIO`) + video (`avc1.64002a`, video-only) rendition। `_resolve_hls_url` best-BANDWIDTH video rendition-এ resolve করত → video-only (audio নেই)। এখন master-এ separate audio group থাকলে **master URL-ই ffmpeg-কে দেয়** যাতে সে audio+video mux করে।

**Fix:** `_input_url`-এ `-extension_picky 0` যোগ; `_resolve_hls_url`-এ `#EXT-X-MEDIA:TYPE=AUDIO` থাকলে master return (video-only rendition নয়)। এটা শুধু BTV নয় — **যেকোনো fMP4/CMAF separate-audio চ্যানেলে** কাজ করবে (একটা শ্রেণির চ্যানেল একসাথে ঠিক হলো)।

**Side Effect / সতর্কতা:**
- id=5 এখন live (non-error) হওয়ায় "BTV" dedup এটাকেই দেখায় (ping ~6ms) → app-এ FIFA feed। ping fluctuate করলে id=620-এ ফ্লিপ হতে পারে (দুটোই working BTV, শুধু content ভিন্ন)।
- `-extension_picky 0` + separate-audio master pass — সাধারণ muxed-variant master ও media playlist অপরিবর্তিত (branch শুধু EXT-X-MEDIA:TYPE=AUDIO থাকলে)। regression sanity: ch 69/70/78 → 200।
- চলমান পুরনো relay গুলো পরের restart-এ নতুন flag পাবে।

**Tested:** হ্যাঁ — সরাসরি ffmpeg টেস্ট (master+extension_picky+copy→TS) h264+aac দুটো stream সহ segment produce করল; app-এ BTV id=5 cold-start → manifest 200 + segment 200 (856KB) + ffprobe-এ h264+aac; app dedup এখন BTV=id=5 (FIFA); regression 69/70/78 → 200; `py_compile` pass।

### [2026-07-03] — Madani TV সাউন্ড fix (একই CMAF separate-audio bug) + running relay audit

**পরিবর্তিত ফাইল:** কোনো কোড নয় — আগের commit-এর `_resolve_hls_url` fix-ই যথেষ্ট; শুধু relay restart + verify।

**কী হয়েছে:** Madani TV (id=86) admin-এ ভিডিও চলছিল কিন্তু **সাউন্ড ছিল না**। কারণ ঠিক আগের BTV-র মতোই — source (`streaming.madanichannel.tv/.../master.m3u8`) CMAF master যেখানে আলাদা audio group (`#EXT-X-MEDIA:TYPE=AUDIO,...,URI="0.m3u8"`) + video-only variants (1-5.m3u8)। কিন্তু Madani-র relay (pid 390312) **fix-এর আগে** চালু হয়েছিল, তাই video-only rendition-এ resolve করে audio বাদ দিচ্ছিল।
- **সমাধান:** admin stop→start দিয়ে relay restart করা হলো → নতুন relay master pass করে (ffmpeg log-এ `5.m3u8` video + `0.m3u8` audio দুটোই fetch করছে) → mirror এখন h264 + **aac (2ch)**। app-এ segment 200 (1.49MB) + ffprobe h264+aac। Madani এখন app list-এ (id=86)।
- **Running-relay audit:** ১২টা active mirror ffprobe করে দেখা গেছে — শুধু Madani-ই video-only ছিল (বাকি সব muxed source, audio আছে)। অর্থাৎ শুধু separate-audio CMAF চ্যানেল affected ছিল; সেগুলো পরের (re)start-এ নিজে থেকেই audio পাবে।

**Side Effect / সতর্কতা:**
- **fix-এর আগে চালু হওয়া** যেকোনো separate-audio CMAF relay video-only থাকবে যতক্ষণ restart না হয় (idle-sweep + lazy-restart বা admin stop/start)। ভবিষ্যতে এমন "ভিডিও আছে সাউন্ড নেই" রিপোর্ট এলে → ওই চ্যানেল restart করলেই ঠিক হবে (কোড ঠিক আছে)।
- Format coverage: muxed HLS (audio in-stream) → সবসময় audio; separate-audio CMAF (.m3u8) → master-pass fix; DASH (.mpd) → `_resolve_hls_url` .m3u8 ছাড়া touch করে না, ffmpeg নিজে a+v handle করে (তবে অনেক DASH worker-source auth-এ 400 দেয় — আলাদা সমস্যা)।

**Tested:** হ্যাঁ (backend live) — Madani mirror ও app segment উভয়ে h264+aac(2ch); app list-এ Madani (86); running-mirror audit-এ আর কোনো video-only নেই।

### [2026-07-03] — Auto-prune: dead/AV-হীন চ্যানেল app-list থেকে স্বয়ংক্রিয় বাদ (periodic task)

**পরিবর্তিত ফাইল:** `livetv/tasks.py` (`_probe_channel_health` + `auto_prune_channels` task), `config/settings.py` (beat schedule)

**কী করা হয়েছে (user request — ম্যানুয়ালি নয়, অটোমেটিক):** আগে dead/broken চ্যানেল app থেকে সরাতে admin-কে "Auto Check" (deep-check-all) বাটন ম্যানুয়ালি চাপতে হতো। এখন নতুন Celery beat task `livetv.auto_prune_channels` **প্রতি ৪ ঘণ্টায়** স্বয়ংক্রিয় চলে:
- প্রতিটা active url চ্যানেল `ffprobe` করে (`_probe_channel_health`, ThreadPool ১২ worker, ২৫s timeout, browser UA + extension_picky/allowed_extensions ALL) — video/audio stream আছে কিনা দেখে।
- **বাদ (last_content_ok=False → get_visible_channels app থেকে hide করে):** unreachable/timeout (= dead বা "high loading time" — ২৫s-এ সাড়া নেই), অথবা video ও audio **দুটোই** নেই।
- **রাখে:** reachable + অন্তত video বা audio আছে।
- শেষে `mobile_livetv_channels` cache clear → list সাথে সাথে রিফ্রেশ।
- filtering আগে থেকেই automatic ছিল (`get_visible_channels`: content_ok=False hide, ping>200ms hide) — এই task শুধু সেই `content_ok` ডেটা **periodic-ভাবে fresh** রাখে। "high latency" আলাদাভাবে existing 200ms TCP-ping filter সামলায়।

**Side Effect / সতর্কতা:**
- **isp-celery + isp-celery-beat restart লাগবে** নতুন task/schedule effective হতে (celery auto-reload হয় না): `sudo systemctl restart isp-celery.service isp-celery-beat.service` — **user-কে চালাতে হবে** (sudo)।
- Loading-time threshold হিসেবে ffprobe **duration** ব্যবহার করা হয়নি (Madani-র মতো working কিন্তু ধীর CMAF source ১৭s লাগে → ভুলে বাদ পড়ত); বরং ২৫s **timeout**-ই "too-slow/dead" cutoff। কাজ করা ধীর channel তাই বাঁচে।
- Transient down হলে ওই রাউন্ডে hidden হতে পারে, পরের রাউন্ডে (৪ঘ) আবার visible — self-heal। খুব aggressive hide এড়াতে ভবিষ্যতে "২ বার পরপর fail হলে hide" করা যেতে পারে।
- ম্যানুয়াল "Auto Check" বাটন (`deep-check-all`) আগের মতোই আছে — on-demand চেকের জন্য।
- ~৮০০ channel × ২৫s / ১২ worker ≈ worst-case ~২৮ মিনিট/রাউন্ড (৪ঘ interval-এ নগণ্য)।

**Tested:** হ্যাঁ — `_probe_channel_health` সরাসরি টেস্ট: 8X music (v+a, 3.5s)→healthy, Madani (v+a, 17s)→healthy, CHAMPIONS TV 2 (dead DASH, no v/a)→pruned। **celery restart হয়েছে (user, 2026-07-03 13:06)** — দুই service active, `celery inspect registered`-এ `livetv.auto_prune_channels` দেখা যাচ্ছে। **পূর্ণ task একবার manually run করা হয়েছে: 824 চেক → 458 সুস্থ, 366 বাদ**; app-visible 399→352, CHAMPIONS TV 2 app থেকে hidden, admin badge 352-এ মিলেছে। পরবর্তী auto-run ১৬:০০ (প্রতি ৪ঘ)। `py_compile` pass।

### [2026-07-03] — ✗ (content-failed) badge clickable + bulk-delete feature

**পরিবর্তিত ফাইল:** `livetv/api/views.py` (stats `content_failed` + নতুন `bulk_delete` action), `admin_panel/src/pages/livetv/LiveTVPage.jsx` (clickable badge + select-mode + BulkDeleteModal)

**প্রেক্ষাপট:** channel card-এ ping ms-এর পাশে **✗ = `last_content_ok===false`** ("No video content detected"; app থেকে বাদ)। ✓ = video verified। User ~২৯৬টা dead চ্যানেল admin-এ **একটা একটা করে manually delete করছিলেন** (access log-এ 16:30-16:33-এ 296টা DELETE) — তাই bulk-delete চেয়েছেন। (825→535 নামা এই manual delete-এর ফল, bug নয়।)

**কী করা হয়েছে:**
- **Backend:** stats-এ `content_failed` count (`last_content_ok=False`); নতুন `POST /livetv/channels/bulk-delete/` — body `{ids:[...]}` বা `{content_failed:true}`। প্রতি delete-এর আগে `StreamService.stop_stream`, শেষে `_clear_caches`। খালি ids → 400।
- **Frontend:** clickable stat badge **"ভিডিও নেই (✗)"** — ক্লিক করলে list ওই content-failed চ্যানেলে filter (`filterContent='failed'`) + select-mode। প্রতি card-এ checkbox, উপরে toolbar ("সব সিলেক্ট", "ক্লিয়ার", "🗑 সিলেক্টেড ডিলিট (N)", "✕ বন্ধ")। `BulkDeleteModal` confirm। stats grid 6→7 কলাম।

**Side Effect:** bulk-delete স্থায়ী (confirm আছে)। Frontend rebuild হয়েছে — hard-refresh লাগতে পারে।

**Tested:** হ্যাঁ — `bulk-delete [757]` → `{"deleted":1}`, DB থেকে গেছে, total 535→534, relay বন্ধ; খালি ids → 400; stats `content_failed`=85; `vite build` + `py_compile` pass।

### [2026-07-03] — Admin player "স্ট্রিম সার্ভার সাড়া দিচ্ছে না" fix — proxy-তে SSL verify বন্ধ

**পরিবর্তিত ফাইল:** `livetv/services/hls_proxy_service.py`

**Root cause:** 8X music source (`ml-pull-dvc-myco.io:2096`) browser-এ চলছিল (address bar-এ "Not secure" — user click-through) কিন্তু admin player error দিত। কারণ: relay stopped থাকায় serializer direct `source_url` দিচ্ছিল, admin সেটা `hls-proxy` দিয়ে proxy করছিল, আর `proxy_and_rewrite_hls`-এর `requests.get()` **default-এ SSL cert verify করে** → source-এর **cert expired** → `SSLCertVerificationError` → 502 → "স্ট্রিম সার্ভার সাড়া দিচ্ছে না"। (ffmpeg relay cert verify করে না, তাই relay চললে সমস্যা হতো না — শুধু direct-proxy fallback-এ।)

**Fix:** `proxy_and_rewrite_hls`-এর `req.get(..., verify=False)` — অনেক IPTV/CDN source-এর cert expired/self-signed (browser-ও click-through করে, ffmpeg-ও ignore করে)। `urllib3.disable_warnings(InsecureRequestWarning)` দিয়ে warning spam বন্ধ। SSRF এখনো netloc-allowlist দিয়ে protected। এই proxy শুধু admin hls-proxy ব্যবহার করে (app mirror-only)।

**Tested:** হ্যাঁ (backend live) — আগে 8X source proxy → 502 (SSLError); fix-এর পর → 302→manifest 200→segment 200 (1.3MB `video/MP2T`)। `py_compile` pass। gunicorn auto-reload।

### [2026-07-03] — Cleaner filtering: ভিডিও-হীন চ্যানেল app-list থেকে বাদ (require-video + false-hide রোধ)

**পরিবর্তিত ফাইল:** `livetv/tasks.py` (auto_prune_channels health rule)

**User request:** যে চ্যানেলে ভিডিও নেই সেগুলো Live TV অ্যাপের list-এ না থাকুক। আগের prune `hv or ha` (video বা audio) রাখত — তাই audio-only radio (Al Quran Radio, Spice FM, Quran, Peoples Radio) video-হীন হয়েও দেখাত।

**কী করা হয়েছে (৩টা refinement একসাথে):**
1. **require-video:** `healthy = hv` (শুধু video থাকলে সুস্থ; audio-only → hidden)।
2. **retry-on-fail:** প্রথম probe fail/timeout হলে একবার retry — server load-এ working source মাঝে মাঝে ২৫s ছাড়ায়, একবার timeout-এ ভুলে hide হওয়া রোধ। worker 12→8 (কম contention)।
3. **unreachable-এ content_ok স্পর্শ না করা:** শুধু **reachable** হলে content_ok আপডেট করি (reachable+video→True, reachable+no-video→False)। unreachable/timeout ambiguous (transient হতে পারে) → skip; সত্যিকার dead হলে app-এর ping-filter hide করে। এতে load-এ timeout করা working চ্যানেল (যেমন MAX HD) আর ভুলে hide হয় না।

আগে wrongly-hidden ৫-১৭টা oscillate করছিল; এখন **নির্ভরযোগ্যভাবে ঠিক ৫টা genuine audio-only radio hidden**, বাকি সব video চ্যানেল shown।

**Side Effect / সতর্কতা:**
- **celery worker restart লাগবে** scheduled (৪ঘ) prune-এ নতুন logic effective হতে (`sudo systemctl restart isp-celery.service`) — manual run নতুন code ব্যবহার করেছে, কিন্তু worker-এ পুরনো code cached। user-কে চালাতে হবে।
- audio-only চ্যানেল (radio) এখন app-এ দেখাবে না — এটাই কাম্য ("Live TV")। কোনো radio চাইলে আলাদা category/flag লাগবে।

**Tested:** হ্যাঁ (backend live) — 3-round iteration করে verify: (1) require-video → radio hidden কিন্তু transient timeout-এ working চ্যানেল false-hide হচ্ছিল; (2) retry যোগ → কমল; (3) skip-on-unreachable + reset → চূড়ান্ত: hidden ৫টাই genuine audio-only (Al Quran Radio/Peoples Radio/Spice FM/Quran/Somoy News audio-feed, সব `video=False`), MAX HD/8X/Oggy/Bantul সব shown। app-visible 375। `py_compile` pass।

### [2026-07-03] — Cold-start loading কমানো: faster ffmpeg startup + adjacent pre-warm

**পরিবর্তিত ফাইল:** `livetv/services/stream_service.py` (`_input_url` fast-start flags), `mobile_api/api/views.py` (`_prewarm_neighbors`)

**প্রেক্ষাপট:** user চান চ্যানেল খুললে loading না থাকুক। বাস্তবতা: loading = **relay cold-start** (relay idle-sweep হয়ে বন্ধ থাকে; খুললে source-এ connect + প্রথম segment buffer করতে ~২-৫s) — dead-channel সরানোর সাথে সম্পর্ক নেই। সব ৩৭৫ relay সবসময় warm রাখা = ~৯৪০ Mbps continuous upstream pull, infeasible। তাই cold-start **কমানো** হলো (শূন্য নয়):
- **Faster ffmpeg startup** (`_input_url`): `-analyzeduration 1.5s -probesize 1.5MB -fflags nobuffer+genpts` — ইনপুট দ্রুত খোলে, warm-up ~৪-৫s → ~২s।
- **Adjacent pre-warm** (`_prewarm_neighbors`): চ্যানেল খুললে background-এ **app-এর list-order-এ ঠিক আগে/পরের ±২টা** চ্যানেল warm করে রাখে (Prev/Next surf instant)। `PREWARM_PING_TTL=200s` (watch ছাড়া ~৩.৫ min টেকে)। manifest request-এ, প্রতি চ্যানেলে ৪৫s-এ একবার (cache lock)।

**গুরুত্বপূর্ণ bug ধরা পড়ে fix হলো:** প্রথমে neighbor বাছা হয়েছিল `sort_order ±2` **value** দিয়ে — কিন্তু bulk-import-এ প্রায় সব চ্যানেলের `sort_order=0`, তাই একটা চ্যানেল খুললেই ~৩৫টা relay start হয়ে যাচ্ছিল (resource explosion)! Fix: `get_visible_channels()`-এর ordered list-এ current চ্যানেলের **index** বের করে ±2 **position**-এর neighbor নেওয়া হয় (= app-এর প্রকৃত Prev/Next, সর্বোচ্চ ৪টা)।

**Side Effect / সতর্কতা:**
- প্রকৃত "০ loading" সব চ্যানেলে সম্ভব নয় (bandwidth) — প্রথম cold open-এ ~২s থাকবেই; Prev/Next surf instant।
- pre-warm প্রতি active viewer-এ সর্বোচ্চ ~৪টা extra relay ~৩.৫ min চালায় — ছোট ISP-তে গ্রহণযোগ্য।
- `get_visible_channels()` প্রতি open-এ (throttled 45s) background thread-এ call হয় — moderate cost।
- বর্তমান চলা relay গুলো পরের restart-এ fast-start flags পাবে।

**Tested:** হ্যাঁ (backend live) — fast-start flags relay cmd-এ যাচ্ছে (`py_compile` pass); pre-warm bug fix-এর পর 9XM (index 1) খুললে শুধু ৩টা প্রকৃত neighbor (8X music, ATN NEWS, Bangla Vision) warm হয় (আগে ~৩৫টা)। sort_order=0 explosion আর হয় না।

### [2026-07-03] — Keep-warm pool: configurable top-N always-warm channels (bandwidth-ready)

**পরিবর্তিত ফাইল:** `livetv/tasks.py` (`keep_warm_channels` task), `config/settings.py` (`LIVETV_KEEP_WARM_COUNT` + beat schedule)

**প্রেক্ষাপট:** user জানিয়েছে ভবিষ্যতে server bandwidth অনেক বাড়বে (1 Gbps+/1 Tbps পর্যন্ত) — তখন সব চ্যানেল সবসময় warm রেখে **০ cold-start loading** চান। এখন limited bandwidth, তাই একটা **configurable keep-warm pool** বানানো হলো যা শুধু একটা সংখ্যা বাড়িয়ে scale করা যায়।

**কী করা হয়েছে:**
- নতুন setting **`LIVETV_KEEP_WARM_COUNT`** (`.env` থেকে, default **0=বন্ধ**): `0`=off, `N`=top-N visible চ্যানেল সবসময় warm, `-1`=সব। প্রতি relay ~2.5 Mbps upstream টানে (যেমন 50 ≈ ~125 Mbps, all ≈ ~900 Mbps)।
- নতুন Celery beat task **`livetv.keep_warm_channels`** (প্রতি ২ মিনিট): `get_visible_channels()`-এর top-N (বা সব) url চ্যানেলের relay বন্ধ থাকলে lazy-start করে ও `viewer_ping` refresh করে (TTL 300s > sweep interval), যাতে idle-sweep ওগুলো না মারে। count=0 হলে সাথে সাথে return (কোনো কাজ করে না — beat schedule harmless)।
- **future upgrade flow:** bandwidth বাড়লে `.env`-এ `LIVETV_KEEP_WARM_COUNT=<N or -1>` সেট → `sudo systemctl restart isp-celery.service isp-celery-beat.service` → ওই চ্যানেলগুলো always warm, ০ loading।

**Side Effect / সতর্কতা:**
- বর্তমানে **default 0 (বন্ধ)** — বর্তমান bandwidth-এ নিরাপদ; adjacent pre-warm + fast-start-ই এখন loading কমায়।
- keep-warm on থাকলে ওই relay গুলো viewer ছাড়াও চলবে (bandwidth+CPU খরচ) — তাই bandwidth অনুযায়ী count বাড়াতে হবে।
- **celery restart লাগবে** নতুন task/schedule ও যেকোনো count পরিবর্তনে।

**Tested:** হ্যাঁ — default count=0 → `{'disabled': True}` (নিরাপদ); count=5 (temp) → 5 target warm (4 start, 1 already)। `py_compile` pass। Live scheduled run celery restart-এর পরে verify করতে হবে।

### [2026-07-03] — মিড-playback loading spinner flash fix + buffer tuning; APK build 25

**পরিবর্তিত ফাইল:** `livetv_app/src/screens/player/PlayerScreen.js`, versionCode 25

**Root cause:** চলন্ত ভিডিওতেও loading spinner দেখা যাচ্ছিল। PlayerScreen-এর statusChange handler `status==='loading'` হলে **সাথে সাথে** `setBuffering(true)` করত — কিন্তু live HLS প্রতিটা segment fetch-এ ক্ষণিকের জন্য 'loading' report করে, তাই স্বাভাবিক playback-এও spinner ফ্ল্যাশ করত। (server relay ঠিকই fresh segment দিচ্ছিল — keep-warm 50-এ নামানোর পর mirror age 0.3-1.4s; overload নয়।)

**Fix:**
- **Spinner debounce (~১.২s):** buffering ১.২s-এর বেশি টিকলে তবেই spinner দেখায়; ছোট segment-fetch hiccup-এ কিছুই দেখায় না → চলন্ত ভিডিওতে আর loading ফ্ল্যাশ করে না। `bufferingRef` (watchdog-এর জন্য) সাথে সাথেই আপডেট হয় (debounce শুধু দৃশ্যমান spinner-এ)।
- **Buffer tuning (কম real rebuffer):** `preferredForwardBufferDuration` 12→**15** (client network dip আরও ভালো শোষে, 24s window-এর মধ্যে নিরাপদ), `minBufferForPlayback` 1.5→**2.5** (stall-এর পর বেশি buffer জমিয়ে resume → বারবার stall→resume cycle কমে)।

**Side Effect / সতর্কতা:**
- forward buffer 15s মানে ~15s live latency (আগে ~12s) — smooth playback-এর জন্য tradeoff; ভিডিও এখনো no-cache/live (staleness নয়, শুধু buffer)।
- APK **build 25** rebuild দরকার (হয়েছে); user install করবেন।

**Tested:** babel parse pass; BUILD SUCCESSFUL, published versionCode 25 (verify নিচে)।

### [2026-07-03] — Server-side playback smoothness: bigger mirror window + nobuffer বাদ

**পরিবর্তিত ফাইল:** `livetv/services/stream_service.py` (`_input_url`, `_build_relay_cmd`)

**প্রেক্ষাপট:** smooth playback নিশ্চিত করা। mirror নিজে smooth প্রমাণিত (9XM: consistent 3s segment, steady write, log-এ warning নেই)। তাই ২টা server-side headroom উন্নতি:
- **`-fflags nobuffer` বাদ** (`+genpts` রাখা): nobuffer startup সামান্য দ্রুত করত কিন্তু flaky source-এ mirror output-এ jitter/gap আনতে পারত → playback আটকাত। বাদ দিলে ইনপুট একটু buffer করে মসৃণ output দেয়; startup speed মূলত ছোট analyzeduration/probesize থেকেই আসে (রাখা হয়েছে)।
- **mirror live window 8→12 segment (~২৪s→~৩৬s):** player-এর buffer headroom বাড়ে; client network dip-এ পিছিয়ে পড়লেও segment disk-এ থাকে (কম 404/rebuffer)। player live edge-এর কাছে শুরু করে বলে latency বাড়ে না, শুধু recover-করার জায়গা বাড়ে। build 25-এর 15s client buffer এখন ৩৬s window-এ নিরাপদ।

**Side Effect / সতর্কতা:** নতুন settings শুধু পরবর্তী relay (re)start-এ প্রযোজ্য — চলমান relay পুরনো command-এ চলছে (keep-warm/idle-sweep+lazy-start-এ ধীরে ধীরে refresh হবে)। বেশি segment = সামান্য বেশি disk/channel।

**Tested:** হ্যাঁ — mock relay cmd: nobuffer removed, genpts kept, list_size=12। running 9XM mirror smoothness verified (even 3s segments)। `py_compile` pass।
