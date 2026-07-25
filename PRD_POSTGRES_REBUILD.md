# IMAS — Product Requirements Document (PRD)
## ISP Management & Automation System — নতুন প্রজেক্ট (হুবহু রেপ্লিকা) — PostgreSQL + FreeRADIUS-on-PostgreSQL

> **নতুন প্রজেক্ট:** **IMAS** (ISP Management & Automation System) · **path:** `/var/www/IMAS`
> **রেফারেন্স প্রজেক্ট (আসল কোড):** `isp_bnas` — GitHub `rajameharonline1-afk/isp_bnas`, ক্লোন হবে `/opt/isp_bnas_reference`-এ
>
> **উদ্দেশ্য:** রেফারেন্স `isp_bnas` প্রজেক্টের **সব পেজ, লজিক, ফিচার, ফাংশন, ডাটাবেস টেবিল হুবহু একই রেখে** নতুন **IMAS** প্রজেক্ট তৈরি করা — শুধু ডাটাবেস ইঞ্জিন MySQL → **PostgreSQL**, FreeRADIUS-ও **PostgreSQL** backend-এ, এবং টেবিল নেমিং `isp_` প্রিফিক্স বাদ (§6)।
>
> **নীতি:** এই ডকুমেন্ট = single source of truth। এখানে যা লেখা আছে তার বাইরে ফিচার যোগ/বাদ দেওয়া যাবে না। শুধু DB-layer বদলাবে, business logic নয়।
>
> **তারিখ:** 2026-07-21 · **সংস্করণ:** 1.0

---

## ০. সূচিপত্র

1. প্রোডাক্ট পরিচিতি ও লক্ষ্য
2. স্কোপ (কী রিবিল্ড হবে / হবে না)
3. প্রযুক্তি স্ট্যাক (নতুন — PostgreSQL সহ)
4. সিস্টেম আর্কিটেকচার
5. মডিউল তালিকা (২৪টি Django অ্যাপ)
6. সম্পূর্ণ ডাটাবেস স্কিমা (সব টেবিল + ফিল্ড)
7. **FreeRADIUS → PostgreSQL** (সবচেয়ে গুরুত্বপূর্ণ পরিবর্তন)
8. Business Logic ও Hooks (হুবহু রাখতে হবে)
9. Client Status → RADIUS/MikroTik Mapping
10. Frontend পেজ ও রুট
11. API Endpoints
12. Celery Scheduled Tasks
13. External Integrations
14. Roles ও Permissions
15. UI ডিজাইন সিস্টেম
16. Environment Variables
17. Deployment ও Infrastructure
18. MySQL → PostgreSQL পার্থক্য (কোড-লেভেল কনভার্শন চেকলিস্ট)
19. Build Phases ও Acceptance Criteria
20. **AI Agent Bootstrap & Execution Protocol (ফ্রেশ মেশিন)**
21. **Docker Deployment (Compose টপোলজি + পরিষেবা কনফিগ)**
22. **Kickoff & Handoff (এজেন্টকে যা বলবেন + ম্যানুয়াল চেকলিস্ট)**

---

## ১. প্রোডাক্ট পরিচিতি ও লক্ষ্য

**IMAS** (ISP Management & Automation System) একটি সম্পূর্ণ ISP ব্যবস্থাপনা প্ল্যাটফর্ম — ক্লায়েন্ট ম্যানেজমেন্ট, অটো বিলিং, FreeRADIUS AAA, MikroTik অটোমেশন, OLT/ONU মনিটরিং, একাউন্টিং, HR/Payroll, ইনভেন্টরি, সাপোর্ট টিকেটিং, VoIP কলিং ও Live TV ব্রডকাস্ট একসাথে।

**প্রধান ব্যবহারকারী:** ISP অপারেটর (superadmin/admin), ম্যানেজার, একাউন্ট্যান্ট, সাপোর্ট এজেন্ট, কালেক্টর, এবং ক্লায়েন্ট (মোবাইল অ্যাপ)।

**লক্ষ্য (এই রিবিল্ডে):**
- বর্তমান সব ফিচার হুবহু বজায় রাখা
- MySQL-এর সব নির্ভরতা PostgreSQL-এ রূপান্তর
- FreeRADIUS-ও PostgreSQL backend-এ চালানো (একক DB ইঞ্জিন — পুরো স্ট্যাক PostgreSQL)

---

## ২. স্কোপ

### ✅ যা হুবহু রিবিল্ড হবে
- ২৪টি Django অ্যাপ, তাদের সব মডেল/টেবিল (নাম, ফিল্ড, relation অপরিবর্তিত)
- সব business logic (billing hooks, RADIUS enable/disable, payment chain)
- সব React পেজ ও রুট, UI ডিজাইন সিস্টেম হুবহু
- সব Celery scheduled task
- সব external integration (MikroTik, OLT, SMS, bKash/Nagad, VoIP, LiveTV)
- Role-permission সিস্টেম

### 🔄 যা বদলাবে (শুধু DB-layer)
- `django.db.backends.mysql` → `django.db.backends.postgresql`
- `mysqlclient` / `PyMySQL` → `psycopg2-binary` (বা `psycopg[binary]`)
- FreeRADIUS: `rlm_sql_mysql` → `rlm_sql_postgresql` + PostgreSQL schema
- সব raw SQL: MySQL সিনট্যাক্স → PostgreSQL সিনট্যাক্স (Section 7 ও 18)
- ২টি hardcoded-MySQL migration পুনর্লিখন
- ব্যাকআপ/ডিপ্লয় স্ক্রিপ্ট: `mysqldump`/`mysql` → `pg_dump`/`psql`
- **টেবিল নেমিং:** সব model-এর `db_table` থেকে `isp_` প্রিফিক্স বাদ (যেমন `isp_users` → `users`) — বিস্তারিত §6 নেমিং কনভেনশন

### ❌ স্কোপের বাইরে
- নতুন ফিচার যোগ করা
- UI redesign
- মডেল ফিল্ড রিনেম/রিমুভ

---

## ৩. প্রযুক্তি স্ট্যাক (নতুন)

| Layer | পুরনো (MySQL) | **নতুন (PostgreSQL)** |
|---|---|---|
| Backend API | Django REST Framework, Python 3.14 | **অপরিবর্তিত** |
| Frontend | React + TypeScript + Vite + Tailwind CSS → `admin_panel/dist/` | **অপরিবর্তিত** |
| Icons | `@heroicons/react` | **`lucide-react`** (§15.1) |
| Database | MySQL 8.4 (utf8mb4) | **PostgreSQL 16+ (UTF-8)** |
| DB Driver | mysqlclient, PyMySQL | **psycopg2-binary / psycopg3** |
| RADIUS AAA | FreeRADIUS 3.x + MySQL (`rlm_sql_mysql`) | **FreeRADIUS 3.x + PostgreSQL (`rlm_sql_postgresql`)** |
| MikroTik | RouterOS API (8728), CoA/PoD (3799) | **অপরিবর্তিত** |
| Task Queue | Celery + Redis + Celery Beat | **অপরিবর্তিত** |
| Web Server | Nginx → Gunicorn (8000) | **অপরিবর্তিত** |
| Cache/Broker | Redis (6379) | **অপরিবর্তিত** |
| VoIP | Asterisk (PJSIP) + coturn (TURN) | **অপরিবর্তিত** |
| Live TV | FFmpeg (QSV) + HLS | **অপরিবর্তিত** |
| Timezone | Asia/Dhaka | **অপরিবর্তিত** |

**PostgreSQL সংস্করণ:** ন্যূনতম 14, সুপারিশ 16। `jsonb` (JSONField-এর জন্য), `ON CONFLICT` upsert, এবং FreeRADIUS PostgreSQL schema সমর্থন থাকতে হবে।

---

## ৪. সিস্টেম আর্কিটেকচার

```
                        ┌────────────────────────┐
   Browser / Mobile ───▶│  Nginx (reverse proxy) │
                        └───────────┬────────────┘
                    ┌───────────────┼─────────────────┐
                    ▼               ▼                 ▼
          React (dist/)     Gunicorn:8000       HLS / media
                            (Django DRF)
                                 │
          ┌──────────────┬───────┼────────────┬──────────────┐
          ▼              ▼       ▼            ▼              ▼
     PostgreSQL     Redis    Celery      MikroTik API    Asterisk
     (app + rad*)  (broker)  (worker+    (RouterOS)      (PJSIP)
          ▲                   beat)          │
          │                                  ▼
     FreeRADIUS 3.x ◀──── rlm_sql_postgresql (একই PostgreSQL DB)
          ▲
          │ RADIUS Auth/Acct (1812/1813), CoA (3799)
     NAS = MikroTik routers
```

**মূল আর্কিটেকচার সিদ্ধান্ত (এই রিবিল্ডে):**
বর্তমান প্রজেক্টে Django অ্যাপ ও FreeRADIUS **একই MySQL `radius` DB** শেয়ার করে (Django টেবিল `isp_*` প্রিফিক্স, FreeRADIUS টেবিল `rad*`)। নতুন প্রজেক্টেও **একই আর্কিটেকচার বজায় থাকবে** — একটাই PostgreSQL ডাটাবেসে Django-managed অ্যাপ টেবিল (নতুন কনভেনশনে `isp_` প্রিফিক্স **ছাড়া** — যেমন `users`, `clients`, §6) এবং `rad*` (FreeRADIUS-native) টেবিল পাশাপাশি থাকবে। Django এই DB-তে ORM দিয়ে অ্যাপ টেবিল ও raw SQL (psycopg2) দিয়ে `rad*` টেবিল অ্যাক্সেস করবে।

---

## ৫. মডিউল তালিকা (২৪টি Django অ্যাপ)

| # | App | দায়িত্ব |
|---|---|---|
| 1 | `accounts` | Custom User model, Role (superadmin/admin/manager/accountant/support/collector), JWT auth |
| 2 | `configuration` | Zone, SubZone, Box, Package, ClientType, ProtocolType, District, Upazila |
| 3 | `clients` | Client lifecycle, PPPoE credential, expiry, LeftClient, ChangeRequest, Scheduler, সব log |
| 4 | `billing` | Bill, Payment, InstallationFee, DailyCollection, WebhookPayment, ReminderRule/Log + billing hooks |
| 5 | `radius_app` | RadiusServer, RadiusLog, RadiusSession + `radius_service.py` (FreeRADIUS DB access) |
| 6 | `mikrotik_app` | MikrotikServer, RouterBackup, ImportedClient + `mikrotik_service.py` (RouterOS API) |
| 7 | `olt_mgmt` | OLT, ONUSignal, OLTMacCache, SNMPTrapLog + HTTP/SNMP/CLI device service |
| 8 | `hr` | Employee, Attendance, Payroll, PayrollSheet, Payslip, Resignation, Collector cash tracking |
| 9 | `inventory` | Unit, StoreLocation, ItemCategory, Item, Stock, StockTransaction |
| 10 | `accounting` | Double-entry: AccountType, ChartOfAccount, JournalEntry/Line, Income, Expense, DailyAccount |
| 11 | `reports` | ReportLog + financial/billing report generation |
| 12 | `sms_service` | SMSGateway (multi-provider), SMSTemplate, SMSGroup, SMSLog |
| 13 | `support` | SupportCategory, SupportTicket, TicketReply, TicketActivityLog, StaffNotification |
| 14 | `network` | NetworkPOP, NetworkNode, NetworkLink, NetworkDiagram (GIS + topology) |
| 15 | `pop` | POP ব্যবস্থাপনা, tariff, funding, PGW payment settlement |
| 16 | `system_settings` | CompanySetup, InvoiceSetup, SystemSetting, PaymentGatewayConfig, MobileAppConfig, AppBanner |
| 17 | `tasks_mgmt` | TaskCategory, Task, TaskHistory |
| 18 | `purchase` | Vendor, PurchaseRequisition/Order/Bill, Provider (bandwidth), ProviderBill |
| 19 | `assets` | Asset, DestroyedItem (fixed assets ledger) |
| 20 | `sales` | ProductSalesInvoice, ServiceSalesInvoice + payment/line items |
| 21 | `role_permissions` | RoleGroup, RoleModulePermission, RoleGranularPermission, UserRoleAssignment |
| 22 | `mobile_api` | Client mobile app API — OTPRecord, BkashPaymentSession, PushNotificationLog |
| 23 | `voip` | SipEndpoint, CallLog, VoiceMessage, PBX (agent/ring group/IVR/hotline) — Asterisk |
| 24 | `livetv` | TVCategory, TVChannel, LiveTVSubscriber, FTPVideoContent — FFmpeg HLS |

Third-party অ্যাপ: `rest_framework`, `rest_framework_simplejwt` (+ token_blacklist), `corsheaders`, `django_filters`, `django_celery_beat`, `django_celery_results`।

---

## ৬. সম্পূর্ণ ডাটাবেস স্কিমা

> ### ⭐ টেবিল নেমিং কনভেনশন (নতুন প্রজেক্ট — গুরুত্বপূর্ণ পরিবর্তন)
> নতুন প্রজেক্টে টেবিলের নাম **সংক্ষিপ্ত ও সহজপাঠ্য** রাখা হবে — পুরনো `isp_` প্রিফিক্স **বাদ**:
> - `isp_users` → **`users`**, `isp_clients` → **`clients`**, `isp_bills` → **`bills`**, `isp_payments` → **`payments`** … এভাবে সব।
> - Compound-prefix টেবিলেও শুধু `isp_` বাদ যাবে, বাকি অংশ থাকবে: `isp_hr_employees` → **`hr_employees`**, `isp_inv_items` → **`inv_items`**, `isp_pop_fundings` → **`pop_fundings`**, `isp_bandwidth_providers` → **`bandwidth_providers`**।
> - **ব্যতিক্রম ১ — FreeRADIUS নেটিভ টেবিল** (`radcheck, radreply, radusergroup, radgroupcheck, radgroupreply, radacct, radpostauth, nas`): নাম **কখনো বদলানো যাবে না** — FreeRADIUS হার্ডকোডেড নামেই query করে।
> - **ব্যতিক্রম ২ — Framework টেবিল** (`django_migrations, auth_*, django_celery_*, token_blacklist_*`): Django/লাইব্রেরির নিজস্ব নাম অপরিবর্তিত।
> - **ব্যতিক্রম ৩ — `livetv_*`** টেবিল ইতিমধ্যে অ্যাপ-স্কোপড; generic নামে collision এড়াতে এগুলো `livetv_` প্রিফিক্সসহই থাকবে (`livetv_channel`, `livetv_tvcategory`, `livetv_subscriber`)।
> - **কীভাবে প্রয়োগ:** প্রতিটি model-এর `Meta.db_table` মান `'isp_xxx'` → `'xxx'` করতে হবে। Reserved-word সংঘর্ষ নেই (সব নাম plural/compound), তবু সন্দেহ হলে PostgreSQL-এ double-quote ব্যবহার্য।
>
> **নিয়ম:** নেমিং ছাড়া ফিল্ডের নাম/টাইপ ও relation হুবহু একই রাখতে হবে। নিচে প্রতিটি টেবিলের নাম নতুন কনভেনশনে (`isp_` বাদ) দেওয়া হলো। PostgreSQL টাইপ ম্যাপিং Section 18-এ।

### 6.1 accounts
**`users`** (User — AbstractBaseUser): username(uniq), email(uniq), full_name, phone, role[superadmin/admin/manager/accountant/support/collector], is_active, is_staff, avatar, fcm_token, created_at, updated_at.

### 6.2 configuration
- **`zones`**: name(uniq), description, is_active, created_at
- **`subzones`**: zone(FK), name, description, is_active, created_at
- **`boxes`**: subzone(FK), name, location, latitude(dec 10,8), longitude(dec 11,8), is_active, created_at
- **`client_types`**: name(uniq), description, image, is_active
- **`protocol_types`**: name(uniq), description, mikrotik_interface_type, radius_enabled, is_active
- **`packages`**: name(uniq), speed_name, router(FK MikrotikServer), mikrotik_profile, ip_pool_name, price(dec 10,2), billing_cycle, description, is_free, is_active, created_at, updated_at
- **`districts`**: name(uniq), is_active, created_at
- **`upazilas`**: district(FK), name, is_active, created_at

### 6.3 clients
- **`clients`** (কেন্দ্রীয় সত্তা): customer_id(uniq), full_name, father_name, phone, alt_phone, email, nid, area, house_name, address, zone(FK), subzone(FK), box(FK), client_type(FK), protocol(FK), package(FK), **username(uniq), password**, ip_address, mac_address, router(FK MikrotikServer), pppoe_profile, bill_date(int), expiry_day(int 1-30), billing_start_month, connection_date, expiry_date, status[active/inactive/suspended/expired/cancelled/left], monthly_bill(dec), discount, due_amount, advance_balance, photo, nid_photo, reg_form_pic, created_by(FK), created_at, updated_at, notes, map_lat, map_lng, is_vip, is_renewed, renewed_at, fcm_token, app_enabled, app_last_seen, app_password, app_registered_on, device, package_no, optical_fiber, cable_meter, vendor, serial_no, fiber_code, color_of_cord, device_purchase_date, remote_mgmt_ip, remote_admin_user, remote_admin_pass, pop(FK), pop_exported
- **`mac_vendors`**: oui(uniq), vendor, updated_at
- **`left_clients`**: client(OneToOne), left_date, reason, equipment_returned, balance_settled, final_due, created_by, created_at, cable_recovered, device_recovered, recovery_status, recovered_by, recovery_notes
- **`change_requests`**: client(FK), request_type, old_value, new_value, reason, status, requested_by, approved_by, created_at, updated_at
- **`client_schedulers`**: client(FK), action, scheduled_at, new_package(FK), is_executed, executed_at, created_by, created_at
- **`client_change_logs`**: client(FK) + snapshot fields (customer_id, username, password, full_name, phone, service, remarks, billing_status, mikrotik_status, server, speed, package, protocol, conn_type, client_type, monthly_bill, expiry_date, zone), changed_by, changed_at
- **`client_status_logs`**: client(FK), snapshot fields, mikrotik_status, changed_by, changed_at
- **`client_activity_logs`**: client(FK), event_type, title, description, amount, performed_by, performed_by_user(FK), created_at
- **`client_monthly_traffic`**: client(FK), year_month('YYYY-MM'), bytes_in(bigint), bytes_out(bigint), sessions, online_seconds(bigint), updated_at

### 6.4 billing
- **`bills`**: client(FK), bill_month('YYYY-MM'), amount, discount, net_amount, paid_amount, due_amount, status[unpaid/partial/paid], due_date, notes, **is_auto**, created_at, updated_at
- **`payments`**: bill(FK), client(FK), amount, payment_method, transaction_id, payment_date, received_by(FK), approved_by(FK), created_by(FK), notes, **is_verified**
- **`installation_fees`**: client(FK), amount, paid_amount, payment_method, payment_date, received_by, notes, created_at
- **`daily_collections`**: date(uniq), total_collected, cash_amount, online_amount, total_payments, collected_by, notes, created_at
- **`webhook_payments`**: gateway_type, trans_msg_inv_no, transaction_id(uniq), payment_amount, from_wallet, to_wallet_org, trans_reference, trans_timestamp, trans_status, **raw_data(JSONField)**, settlement_status, matched_client(FK), transferred_to(FK), linked_payment(FK), remarks_note, update_by, created_at, updated_at
- **`reminder_rules`**: name, is_active, trigger, offset_days, via_sms, via_push, via_email, only_active, min_due, zone(FK), package(FK), message_template, email_subject, send_hour, created_at, updated_at
- **`reminder_logs`**: rule(FK), client(FK), channel, recipient, message, status, detail, triggered_by, created_at

### 6.5 radius_app
- **`radius_logs`**: username, action, details, ip_address, created_at
- **`radius_sessions`**: username, nas_ip, framed_ip, session_id, start_time, bytes_in(bigint), bytes_out(bigint), is_online, last_updated
- **`radius_servers`**: name(uniq), server_type, **db_host, db_port, db_name, db_user, db_password**, radius_host, radius_auth_port(1812), radius_acct_port(1813), shared_secret, is_active, is_default, last_tested, last_test_status, description, created_at, updated_at
  - ⚠️ নতুন প্রজেক্টে `db_port` default 3306 → **5432**, `server_type`-এ 'postgresql' যোগ

### 6.6 mikrotik_app
- **`mikrotik_servers`**: name(uniq), host, port(8728), username, password, is_active, last_connected, description, radius_server(FK), radius_configured, radius_configured_at, created_at, updated_at
- **`router_backups`**: server(FK), filename, file_path, size_kb, backup_type, created_by, created_at
- **`mikrotik_imported`**: server(FK), username, service, profile, comment, is_imported, imported_client(FK), imported_at, raw_data(JSON), created_at

### 6.7 olt_mgmt
- **`olts`**: name, system_name, ip_address, snmp_community, snmp_version, vendor, model, fw_version, rx_snmp_oid, tx_snmp_oid, location, mgmt_proto, telnet_port(23), ssh_port(22), username, password, enable_password, prompt_regex, is_active, last_polled, last_sync_at, last_sync_status, last_sync_count, last_sync_message, created_at, updated_at
- **`onu_signals`**: olt(FK), client(FK), interface_id(idx), rx_power(float), tx_power(float), signal_status, last_updated, notes, raw_data(JSON), created_at, updated_at — **unique: (olt, interface_id)**
- **`olt_mac_cache`**: olt(FK), vendor, mac(idx), vlan, port, onu, status, description(idx), distance_m, rx_power_dbm, last_dereg_reason, last_dereg_time, last_dereg_time_raw, alive_time, client(FK), client_link_source, client_mac, client_mac_vlan, client_mac_learned_at, raw_data(JSON), learned_at, created_at, updated_at — **unique: (olt, mac)**
- **`snmp_trap_logs`**: olt(FK), source_ip, trap_oid, event, interface_id, summary, varbinds(JSON list), handled, created_at

### 6.8 hr
- **`hr_departments`**, **`hr_payheads`**, **`employees`** (employee_id uniq, user OneToOne, payroll FK, personal/education/job fields, basic_salary, photo, status), **`attendance`** (employee FK, date, status, check_in, check_out), **`hr_payrolls`**, **`hr_payroll_periods`**, **`hr_payroll_payheads`**, **`payroll_sheets`** (employee FK, month, basic_salary, bonus, deduction, net_salary, is_paid, ...), **`hr_positions`**, **`hr_payslip_entries`**, **`hr_employee_advances`**, **`hr_advance_recoveries`**, **`hr_payslip_payments`**, **`hr_resign_rules`**, **`hr_resignations`**, **`hr_rejoins`**, **`collector_cash_balance`** (employee OneToOne, cash_in_hand, total_collected, total_approved), **`collector_cash_transactions`**

### 6.9 inventory
- **`inv_units`**, **`inv_stores`**, **`inv_item_categories`** (self-parent), **`inv_items`** (code uniq, item_type, is_serialized, category FK, unit FK, minimum_stock, vat_percent, approximate_rate, income_account FK, expense_account FK), **`inv_stocks`** (item FK, store FK, quantity, unit_price), **`inv_transactions`** (item, store, transaction_type, quantity, unit_price, reference)

### 6.10 accounting
- **`account_types`** (name, code, is_debit_normal), **`chart_of_accounts`** (account_type FK, code uniq, name, parent self-FK, is_active), **`journal_entries`** (reference uniq, date, description, total_debit, total_credit, is_posted, approved_by, attachment, created_by), **`journal_lines`** (journal FK, account FK, debit, credit, description), **`income_categories`**, **`incomes`** (voucher_no, account FK, category FK, amount, date, is_approved, ...), **`expense_categories`**, **`expenses`**, **`daily_accounts`** (date uniq, total_income, total_expense, net, is_closed)

### 6.11 reports
- **`report_logs`**: report_type, parameters(JSON), file_path, generated_by, generated_at

### 6.12 sms_service
- **`sms_gateways`** (name, provider_type, api_url, api_key, sender_id, config(JSON), is_active, is_default), **`sms_templates`**, **`sms_groups`** (M2M clients), **`sms_logs`** (recipient_phone, client FK, template FK, message, status, gateway FK, sent_by, gateway_response, sent_at)

### 6.13 support
- **`support_categories`**, **`support_tickets`** (ticket_id uniq, client FK, category FK, subject, description, priority, status, source, assigned_to FK, created_by, resolved_at, closed_at), **`ticket_replies`** (ticket FK, message, is_client_reply, replied_by), **`ticket_activity_logs`**, **`staff_notifications`** (recipient FK, notif_type[ticket/task/system], read state)

### 6.14 network
- **`network_pops`**, **`network_connections`**, **`network_diagrams`**, **`distributed_inventory`**, **`network_nodes`** (GIS), **`network_links`** (topology)

### 6.15 pop
- **`pop_packages`**, **`pop_tariff_plans`**, **`pop_tariff_items`**, **`pops`**, **`pop_funds`**, **`pop_tariffs`**, **`pop_fundings`**, **`pop_fund_transactions`**, **`pgw_payments`**, **`pop_pgw_settlements`**, **`pop_notices`**, **`pop_change_logs`**, **`pop_fund_start_logs`**, **`pop_client_recharge_logs`**
  - ⚠️ `pop_fundings` টেবিল বর্তমানে **hardcoded MySQL RunSQL** দিয়ে তৈরি — নতুন প্রজেক্টে PostgreSQL DDL-এ লিখতে হবে (Section 18)

### 6.16 system_settings
- **`company_setup`**, **`invoice_setup`**, **`system_settings`**, **`activity_logs`**, **`payment_gateway_configs`**, **`mobile_app_config`**, **`app_banners`**, **`automatic_processes`**

### 6.17 tasks_mgmt
- **`task_categories`**, **`tasks`** (assigned_to FK, client FK optional, status, countdown), **`task_history`**

### 6.18 purchase
- **`vendors`**, **`purchase_requisitions`** + `_items`, **`purchase_orders`** + `_items`, **`purchase_bills`**, **`bandwidth_providers`**, **`bandwidth_provider_bills`** + `_lines` + `_payments`

### 6.19 assets
- **`assets`**, **`destroyed_items`**

### 6.20 sales
- **`product_sales_invoices`** + `_lines` + `_payments`, **`service_sales_invoices`** + `_lines` + `_payments`

### 6.21 role_permissions
- **`role_groups`**, **`role_module_permissions`**, **`role_granular_permissions`**, **`user_role_assignments`**

### 6.22 mobile_api
- **`mobile_otp_records`**, **`mobile_bkash_sessions`**, **`push_notification_logs`**

### 6.23 voip
- **`sip_endpoints`**, **`call_logs`**, **`voice_messages`**, **`voice_recordings`**, **`voice_call_schedules`** + PBX models (PBXAgent, RingGroup/Member, IVRMenu/Option, HotlineNumber, PBXBusinessHour)

### 6.24 livetv
- **`livetv_tvcategory`**, **`livetv_channel`**, **`livetv_subscriber`**, FTPVideoContent
  - ⚠️ `livetv_tvcategory` বর্তমানে **hardcoded MySQL RunSQL** — PostgreSQL DDL-এ পুনর্লিখন (Section 18)

### 6.25 FreeRADIUS Native Tables (একই PostgreSQL DB, Django-managed নয়)
| Table | Purpose |
|---|---|
| `radcheck` | per-user auth (Cleartext-Password, Auth-Type:=Reject) |
| `radreply` | per-user reply attributes |
| `radusergroup` | username → groupname mapping |
| `radgroupcheck` | group check attributes |
| `radgroupreply` | group reply (Mikrotik-Group, Framed-Pool, Session-Timeout) |
| `radacct` | session accounting (acctstoptime IS NULL = online) |
| `radpostauth` | auth attempt log |
| `nas` | NAS/router client list |

এগুলো FreeRADIUS-এর **PostgreSQL schema** (`mods-config/sql/main/postgresql/schema.sql`) থেকে তৈরি হবে — Section 7 দেখুন।

---

## ৭. FreeRADIUS → PostgreSQL (সবচেয়ে গুরুত্বপূর্ণ পরিবর্তন)

### 7.1 FreeRADIUS SQL module config
`mods-available/sql`-এ:
```
sql {
    driver = "rlm_sql_postgresql"
    dialect = "postgresql"
    server = "localhost"
    port = 5432
    login = "radius"
    password = "<pass>"
    radius_db = "radius"          # Django app-এর একই DB
}
```
`mods-enabled/sql` symlink সক্রিয় করতে হবে, এবং `rlm_sql_postgresql` মডিউল ইনস্টল (`freeradius-postgresql` package)।

### 7.2 Schema
FreeRADIUS-এর নিজস্ব PostgreSQL schema চালাতে হবে:
```
psql -U radius -d radius -f /etc/freeradius/3.0/mods-config/sql/main/postgresql/schema.sql
```
এতে `radcheck, radreply, radusergroup, radgroupcheck, radgroupreply, radacct, radpostauth, nas` টেবিল PostgreSQL-উপযোগীভাবে (SERIAL PK, bigint) তৈরি হবে।

### 7.3 Django-side raw SQL কনভার্শন (`radius_app/services/radius_service.py`)
এই ফাইলে ~১৫টি MySQL-নির্দিষ্ট `ON DUPLICATE KEY UPDATE` ও `DATE_FORMAT` আছে। PostgreSQL-এ প্রতিটি রূপান্তর:

| MySQL (বর্তমান) | PostgreSQL (নতুন) |
|---|---|
| `INSERT ... ON DUPLICATE KEY UPDATE col=%s` | `INSERT ... ON CONFLICT (<uniq_cols>) DO UPDATE SET col=EXCLUDED.col` |
| `ON DUPLICATE KEY UPDATE op=VALUES(op), value=VALUES(value)` | `ON CONFLICT (...) DO UPDATE SET op=EXCLUDED.op, value=EXCLUDED.value` |
| `DATE_FORMAT(acctstarttime, '%Y-%m')` | `to_char(acctstarttime, 'YYYY-MM')` |
| `IFNULL(x, 0)` | `COALESCE(x, 0)` |
| driver: `pymysql.connect(...)` | `psycopg2.connect(...)` |
| placeholder `%s` | `%s` (psycopg2-ও `%s` ব্যবহার করে — অপরিবর্তিত) |

> **গুরুত্বপূর্ণ:** `ON CONFLICT`-এর জন্য target টেবিলে সঠিক **UNIQUE constraint** থাকতে হবে (যেমন radusergroup-এ (username) বা (username, groupname))। FreeRADIUS-এর default PostgreSQL schema-তে এই unique key নেই — তাই radius_service যেখানে upsert করে, সেখানে unique index যোগ করতে হবে অথবা "SELECT → INSERT/UPDATE" প্যাটার্নে রূপান্তর করতে হবে (নিরাপদ বিকল্প)।

### 7.4 অন্যান্য raw-SQL ফাইল
- `mikrotik_app/api/views.py` (sync_to_radius) → pymysql→psycopg2, SQL portable (`%s` placeholder, standard INSERT/UPDATE)
- `radius_app/api/views.py` (৩টি connect point) → একই কনভার্শন
- `radius_app/management/commands/radius_maintenance.py` → `OPTIMIZE TABLE radpostauth` (MySQL) → PostgreSQL-এ `VACUUM (ANALYZE) radpostauth;`

### 7.5 Connection helper
নতুন `radius_service._get_conn()`:
```python
import psycopg2
conn = psycopg2.connect(
    host=cfg['host'], port=cfg['port'],
    user=cfg['user'], password=cfg['password'],
    dbname=cfg['name'],
)
# MySQL-এর charset='utf8mb4' বাদ (PostgreSQL DB-level UTF-8)
```

---

## ৮. Business Logic ও Hooks (হুবহু রাখতে হবে)

### 8.1 Payment Save Hook Chain (`billing/models.py`) — কখনো rename/delete নয়
```
Payment.save()
  ├─ is_new + is_verified=True  → recalculate_bill_and_client() + _auto_enable_client_if_paid()
  ├─ is_new + is_verified=False → _update_expiry_and_enable_for_unverified()
  └─ just_verified (approve)    → recalculate_bill_and_client() + _auto_enable_client_if_paid()

_auto_enable_client_if_paid(client):
  due_amount == 0 AND status in (inactive/suspended/expired)
   → RADIUS: enable_user() + restore_user_group()
   → MikroTik: enable_pppoe_user()
   → expiry_date = পরের মাসের expiry_day
   → client.status = 'active'
```
সংরক্ষিত ফাংশন: `_auto_enable_client_if_paid()`, `_update_expiry_and_enable_for_unverified()`, `Payment.recalculate_bill_and_client()`.

### 8.2 Verified vs Unverified Payment
- `is_verified=True` (admin/superadmin receive) → bill recalculate + client auto-enable
- `is_verified=False` (collector receive, pending approval) → expiry extend + RADIUS enable, কিন্তু bill-এর paid/due অপরিবর্তিত

### 8.3 RADIUS Service Methods (`radius_app/services/radius_service.py`)
Factory: `for_client(client)`, `for_server(server)`, `get_default()`, `all_online_users()`
Methods: `create_user`, `enable_user`, `disable_user`, `move_to_blocked_group`, `restore_user_group`, `ensure_blocked_group`, `change_password`, `delete_user`, `get_online_users`, `cleanup_stale_sessions`
> সব method signature হুবহু রাখতে হবে; শুধু ভেতরের SQL PostgreSQL-এ।

### 8.4 MikroTik Service (`mikrotik_app/services/mikrotik_service.py`)
Factory: `from_server_model(server)`
Methods: `enable_pppoe_user`, `disable_pppoe_user`, `create_pppoe_user`, `delete_pppoe_user`, `disconnect_active_session`, `send_coa_disconnect`, `get_user_traffic`
> RouterOS API — DB-নিরপেক্ষ, **অপরিবর্তিত থাকবে**।

### 8.5 Client Disable/Enable Flow (`clients/api/views.py`)
- Manual suspend → `disable_user()` (radcheck: Auth-Type:=Reject)
- Expired (payment due) → `move_to_blocked_group()` (radusergroup → Blocked_Group)
- Enable → Auth-Type:Reject মুছে + আসল package group ফেরত

### 8.6 Accounting Auto-posting
- Client payment → Income + JournalEntry (Cash On Hand বাড়ে)
- ProviderBill payment → Expense + JournalEntry (Cash On Hand কমে)
- Income/Expense voucher → JournalEntry + JournalLine auto-create

---

## ৯. Client Status → RADIUS/MikroTik Mapping

| Status | RADIUS (radcheck/radusergroup) | MikroTik |
|---|---|---|
| `active` | Cleartext-Password সেট, আসল group (যেমন '5M') | Normal profile |
| `suspended` (manual) | Auth-Type:=Reject | Session kicked |
| `expired` (payment due) | Blocked_Group → 'Expired PPPoE' profile | Session kicked |
| `inactive` | Auth-Type:=Reject | — |
| `cancelled` | সেবা বাতিল | — |
| `left` | LeftClient record | — |

RADIUS group logic:
- `radgroupreply.Blocked_Group` → Mikrotik-Group:='Expired PPPoE', Session-Timeout:=300
- `radgroupreply.<PackageGroup>` → Mikrotik-Group:=package, Framed-Pool:=ip_pool

---

## ১০. Frontend পেজ ও রুট (`admin_panel/src/App.jsx`)

সব রুট `Layout` component-এর ভেতরে (JWT auth required)। API base: `/api/v1/` (Axios instance `src/utils/api.js`)।

**Client:** `/clients`, `/clients/new`, `/clients/:id`, `/clients/:id/profile`, `/clients/left`
**Billing:** `/billing/bills`, `/billing/daily-collection`
**RADIUS/Network:** `/radius/servers`, `/radius/online`, `/radius/traffic/:username`, `/mikrotik/bulk-import`, `/olt/list`, `/olt/onus`
**Configuration:** `/config/zones`, `/config/subzones`, `/config/boxes`, `/config/packages`, `/config/protocol-types`, `/config/client-types`
**HR:** `/hr/employees`, `/hr/payslip`, `/hr/salary-sheet`, `/hr/attendance`, `/hr/department`, `/hr/payhead`, `/hr/payroll`, `/hr/position`, `/hr/resign-rule`, `/hr/resignation`, `/hr/rejoin`
**Bandwidth/Purchase:** `/bandwidth/buy/providers`, `/bandwidth/buy/bills`, `/bandwidth/buy/items`
**Support/Tasks:** `/support/tickets`, `/tasks/list`, `/tasks/mine`
**Accounting:** `/accounting/dashboard`, `/chart-of-accounts`, `/income`, `/expense`, `/journal`, `/balance-sheet`, `/profit-loss`, `/trial-balance`, `/cash-book`
**Network:** `/network/map` (Leaflet), `/network/topology` (React Flow)
**Sales:** `/sales/product-invoice`, `/sales/service-invoice`
**System:** `/settings`, `/system/app-users` (নতুন — পুরনো `/system/users` বাদ), `/sms/logs`
**POP, VoIP, LiveTV:** নিজস্ব রুট সেট (pages/pop, pages/voip, pages/livetv)

> সব পেজে **desktop table + mobile card** দুই view (Section 15)।

---

## ১১. API Endpoints (মূল Custom Actions)

```
# Clients
GET  /clients/dashboard-stats/
GET  /clients/billing-view/
POST /clients/{id}/disable/          POST /clients/{id}/enable/
POST /clients/{id}/kick-session/     GET  /clients/{id}/activity-log/
GET  /clients/expired-clients/

# Billing
GET  /billing/bills/client-billing-view/    GET /billing/bills/collection-summary/
POST /billing/payments/receive/             POST /billing/payments/approve-selected/
GET  /billing/bills/summary/
POST /billing/webhook/receive/{gateway}/    # anonymous, X-Webhook-Secret

# RADIUS / MikroTik
GET  /radius/online-users/           POST /radius/disconnect/
GET  /mikrotik/online-usernames/     GET  /mikrotik/traffic/{username}/     POST /mikrotik/ping/

# OLT
POST /olt/onu-signals/{pk}/push-description/

# Support / Tasks / Purchase
GET  /support/tickets/stats/         GET /tasks/tasks/stats/
GET  /purchase/provider-bills/dashboard-stats/
```
Standard REST: `GET/POST /clients/`, `PATCH/DELETE /clients/{id}/` (Bill destroy() → **405**, Waive ব্যবহার)।
Auth: JWT Bearer (SimpleJWT, HS256, access 60min / refresh 7day)।

---

## ১২. Celery Scheduled Tasks (`CELERY_BEAT_SCHEDULE`)

| Task | Schedule | কাজ |
|---|---|---|
| `billing.auto_generate_monthly_bills` | প্রতি মাসের ১ তারিখ 00:00 | expiry-অনুযায়ী মাসিক বিল |
| `billing.disable_expired_clients` | প্রতিদিন 00:05 | expired client → Blocked_Group + kick |
| `billing.aggregate_radacct_to_monthly_traffic` | প্রতিদিন 01:00 | radacct → monthly traffic aggregate |
| `billing.purge_old_radacct_sessions` | প্রতিদিন 02:00 | পুরনো radacct purge |
| `billing.process_payment_reminders` | প্রতি ঘণ্টা :00 | SMS/push/email reminder |
| `olt_mgmt.sync_all_olts_mac_table` | প্রতি ৫ মিনিট | OLT MAC table sync (HTTP+SNMP) |
| `olt_mgmt.link_onu_clients` | প্রতি ১৫ মিনিট | ONU ↔ Client auto-link |
| `system_settings.check_disk_usage` | প্রতিদিন 06:00 | disk warning bell |
| `voip.run_voice_call_schedules` | প্রতি ৫ মিনিট | scheduled voice call |
| `livetv.sweep_idle_url_relays` | প্রতি ২ মিনিট | idle relay বন্ধ |
| `livetv.retry_error_url_channels` | প্রতি ৩ মিনিট | error channel retry |
| `livetv.keep_warm_channels` | প্রতি ২ মিনিট | channel warm রাখা |
| `livetv.auto_prune_channels` | প্রতি ৪ ঘণ্টা | channel prune |
| `livetv.sweep_stale_hls_files` | প্রতি ৩০ মিনিট | HLS cache পরিষ্কার |

Scheduler: `django_celery_beat.schedulers:DatabaseScheduler`।

---

## ১৩. External Integrations

| Integration | প্রযুক্তি | নোট |
|---|---|---|
| **FreeRADIUS** | 3.x + `rlm_sql_postgresql` | Section 7 — DB backend বদল |
| **MikroTik** | RouterOS API (8728), CoA/PoD (3799) | DB-নিরপেক্ষ, অপরিবর্তিত |
| **OLT/ONU** | HTTP (প্রধান) + SNMP (fallback) + CLI (Telnet/SSH) | VSOL ইত্যাদি vendor; SNMP trap receiver |
| **SMS** | Multi-gateway (bulk/http/telegram) — config JSON-driven | অপরিবর্তিত |
| **Payment** | bKash (tokenized), Nagad, SSLCommerz, generic webhook | webhook receiver anonymous + shared secret |
| **VoIP** | Asterisk PJSIP + coturn TURN + AMI | app-to-app calling; media/NAT tuning |
| **Live TV** | FFmpeg (Intel QSV) → HLS; DVB + URL relay | idle sweep, keep-warm |
| **Push** | Firebase Cloud Messaging (FCM) | service account JSON path |
| **AI** | Ollama (local) / OpenAI / Anthropic — provider-agnostic | support/ai_service.py |

---

## ১৪. Roles ও Permissions

**Built-in roles (`accounts.User.role`):** superadmin, admin, manager, accountant, support, collector।

**Granular system (`role_permissions` app):**
- `RoleGroup` → `RoleModulePermission` (module-level) + `RoleGranularPermission` (action-level)
- `UserRoleAssignment` → user ↔ role group
- Enforcement: Superadmin/Admin সব দেখে; অন্যরা role assign না হলে কিছু দেখে না
- Frontend: `PermissionContext.jsx`; App Users পেজ: `/system/app-users`
- Password encryption: `role_permissions/utils.py` — `.env`-এ `PASSWORD_ENCRYPT_KEY`

---

## ১৫. UI ডিজাইন সিস্টেম

```css
Primary Button:   bg-[#173d59] hover:bg-[#1f5075] text-white rounded-full
Secondary Button: bg-white hover:bg-gray-50 text-gray-700 border rounded-lg
Card:             bg-white rounded-2xl border border-slate-200 shadow-sm p-6
Table Header:     bg-[#23445f] text-white font-semibold text-xs uppercase tracking-wider
Page BG:          bg-gray-100
```
**Stat Card gradients:** total→`from-sky-500 to-cyan-600`, paid→`from-teal-500 to-emerald-600`, due→`from-violet-500 to-indigo-600`, neutral→`from-slate-500 to-slate-600`
**Status badges:** active/paid→emerald, partial→amber, due/suspended→rose, inactive→gray (সব `rounded-full px-3 py-1 text-xs font-semibold`)
**Responsive:** প্রতি পেজে `hidden md:block` desktop table + `block md:hidden` mobile card; touch target `min-h-[44px]`
**Modal:** `fixed inset-0 z-50 ... items-end md:items-center bg-black/50`, sheet `rounded-t-2xl md:rounded-2xl max-h-[85vh]`

### ১৫.১ আইকন — Lucide React (নতুন প্রজেক্টের স্ট্যান্ডার্ড)
নতুন প্রজেক্টে **সব আইকন `lucide-react`** দিয়ে হবে (পুরনো প্রজেক্টের `@heroicons/react` **বাদ**)।
```bash
cd admin_panel && npm install lucide-react
```
**ব্যবহার:**
```jsx
import { Users, CreditCard, Wifi, Router, Tag, Bell, Search, Trash2, Pencil } from 'lucide-react';

<Users className="w-5 h-5 text-[#173d59]" />
<Tag className="w-4 h-4" strokeWidth={2} />
```
**নিয়ম:**
- সব icon **named import** (tree-shakeable — শুধু ব্যবহৃত আইকন bundle-এ যায়)
- সাইজ Tailwind দিয়ে: `w-4 h-4` (small), `w-5 h-5` (default), `w-6 h-6` (large); রং `text-*`
- stroke ডিফল্ট 2; দরকারে `strokeWidth={1.5}`
- **কাস্টম SVG (`Icon.Tag` ইত্যাদি) আর লিখতে হবে না** — Lucide-তে সমতুল্য আইকন আছে
- **Migration ম্যাপিং (Heroicons → Lucide):** `UserGroupIcon`→`Users`, `CurrencyBangladeshiIcon`/`BanknotesIcon`→`Wallet`/`CreditCard`, `TrashIcon`→`Trash2`, `PencilIcon`→`Pencil`/`PencilLine`, `MagnifyingGlassIcon`→`Search`, `BellIcon`→`Bell`, `Cog6ToothIcon`→`Settings`, `ArrowPathIcon`→`RefreshCw`, `CheckCircleIcon`→`CircleCheck`, `XMarkIcon`→`X`
- এজেন্ট রেফারেন্স কোডে যেখানে `@heroicons/react` import পাবে, সেটি Lucide equivalent-এ বদলাবে (নাম আলাদা, props প্রায় একই — `className` দিয়ে সাইজ/রং)

---

## ১৬. Environment Variables (.env)

```
SECRET_KEY, DEBUG, ALLOWED_HOSTS
# App DB (PostgreSQL)
DB_NAME=radius   DB_USER   DB_PASSWORD   DB_HOST   DB_PORT=5432
# FreeRADIUS DB (একই PostgreSQL DB)
RADIUS_DB_HOST   RADIUS_DB_PORT=5432   RADIUS_DB_NAME=radius   RADIUS_DB_USER   RADIUS_DB_PASSWORD
REDIS_URL   CELERY_BROKER_URL
PASSWORD_ENCRYPT_KEY   WEBHOOK_SHARED_SECRET
SMS_API_KEY   SMS_SENDER_ID
BKASH_APP_KEY   BKASH_APP_SECRET   BKASH_USERNAME   BKASH_PASSWORD   BKASH_BASE_URL   BKASH_SNS_VERIFY_SIGNATURE
SSLCOMMERZ_STORE_ID   SSLCOMMERZ_STORE_PASS
EMAIL_HOST   EMAIL_PORT   EMAIL_HOST_USER   EMAIL_HOST_PASSWORD
COMPANY_NAME   COMPANY_ADDRESS   COMPANY_PHONE
FIREBASE_CREDENTIALS_PATH
AI_ENABLED   AI_PROVIDER   AI_BASE_URL   AI_MODEL   AI_API_KEY   AI_TIMEOUT
```
> পরিবর্তন: `DB_PORT`/`RADIUS_DB_PORT` default **5432**।

**settings.py DATABASES (নতুন):**
```python
DATABASES = {
  'default': {
    'ENGINE': 'django.db.backends.postgresql',
    'NAME': env('DB_NAME', default='radius'),
    'USER': env('DB_USER', default='radius'),
    'PASSWORD': env('DB_PASSWORD', default=''),
    'HOST': env('DB_HOST', default='localhost'),
    'PORT': env('DB_PORT', default='5432'),
    # MySQL OPTIONS (init_command/charset) বাদ; প্রয়োজনে:
    # 'OPTIONS': {'options': '-c timezone=Asia/Dhaka'},
  }
}
```

---

## ১৭. Deployment ও Infrastructure

- **Python** 3.14, venv `/var/www/IMAS/venv`
- **PostgreSQL** 16, DB `radius`, user `radius`
- **Redis** localhost:6379 (broker + cache)
- **Gunicorn** port 8000, systemd `imas-gunicorn.service`
- **Nginx** reverse proxy → **upstream অবশ্যই 127.0.0.1:8000** (gunicorn এখানে; 8001 নয়)
- **Frontend build:** `cd admin_panel && node ./node_modules/vite/bin/vite.js build` → `dist/` (Nginx serve)
- **Celery:** worker + beat (systemd), FreeRADIUS + Asterisk + coturn আলাদা service
- **install.sh** পুনর্লিখন: `postgresql` install, `CREATE DATABASE ... ENCODING 'UTF8'`, `pg_dump` cron, FreeRADIUS postgresql schema load

---

## ১৮. MySQL → PostgreSQL পার্থক্য (কোড-লেভেল কনভার্শন চেকলিস্ট)

### 18.1 Driver ও settings
- [ ] `requirements.txt`: `mysqlclient`, `PyMySQL` বাদ → `psycopg2-binary==2.9.x` যোগ
- [ ] `settings.py`: ENGINE = postgresql, MySQL OPTIONS (init_command, charset) বাদ
- [ ] `RADIUS_DB` port default 3306 → 5432
- [ ] `RadiusServer.db_port` default 3306 → 5432, server_type choices-এ 'postgresql'

### 18.2 Field type ম্যাপিং (Django auto-handle করে, শুধু raw DDL-এ মনোযোগ)
| MySQL | PostgreSQL |
|---|---|
| `tinyint(1)` | `boolean` |
| `longtext` | `text` |
| `datetime(6)` | `timestamp` |
| `AUTO_INCREMENT` | `BIGSERIAL` / `GENERATED ... AS IDENTITY` |
| `bigint UNSIGNED` | `bigint` (unsigned নেই) |
| `smallint unsigned` | `smallint`/`integer` |
| backtick `` `col` `` | double-quote `"col"` বা কিছুই না |
| `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` | (বাদ) |

### 18.3 হাতে ঠিক করতে হবে এমন raw SQL
- [ ] `livetv/migrations/0004_create_category_table.py` — `CREATE TABLE ... ENGINE=InnoDB`, `INSERT IGNORE` → PostgreSQL DDL + `INSERT ... ON CONFLICT DO NOTHING`
- [ ] `pop/migrations/0003_extended_pop_models.py` — `pop_fundings` DDL (backtick, AUTO_INCREMENT, tinyint, longtext, ENGINE) → PostgreSQL
- [ ] `radius_app/services/radius_service.py` — ১৫× `ON DUPLICATE KEY UPDATE` → `ON CONFLICT DO UPDATE`, `DATE_FORMAT` → `to_char`, pymysql → psycopg2
- [ ] `radius_app/api/views.py` — ৩× pymysql connect
- [ ] `mikrotik_app/api/views.py` — sync_to_radius pymysql
- [ ] `radius_app/management/commands/radius_maintenance.py` — `OPTIMIZE TABLE` → `VACUUM`

### 18.4 SQL সিনট্যাক্স ম্যাপিং টেবিল
| MySQL | PostgreSQL |
|---|---|
| `INSERT ... ON DUPLICATE KEY UPDATE c=VALUES(c)` | `INSERT ... ON CONFLICT (uniq) DO UPDATE SET c=EXCLUDED.c` |
| `INSERT IGNORE` | `INSERT ... ON CONFLICT DO NOTHING` |
| `REPLACE INTO` | `INSERT ... ON CONFLICT DO UPDATE` |
| `DATE_FORMAT(x,'%Y-%m')` | `to_char(x,'YYYY-MM')` |
| `IFNULL(a,b)` | `COALESCE(a,b)` |
| `GROUP_CONCAT(x)` | `string_agg(x, ',')` |
| `UNIX_TIMESTAMP(x)` | `EXTRACT(EPOCH FROM x)` |
| `NOW() - INTERVAL 30 DAY` | `NOW() - INTERVAL '30 days'` |
| `OPTIMIZE TABLE t` | `VACUUM (ANALYZE) t` |
| `LIMIT n, m` | `LIMIT m OFFSET n` |
| case-insensitive `=` (default) | `ILIKE` / `LOWER()` compare প্রয়োজন হলে |

> ⚠️ **Case-sensitivity:** MySQL string compare default case-insensitive; PostgreSQL case-sensitive। username/lookup যেখানে case-insensitive ধরে নেওয়া হয়েছে, সেখানে `__iexact` বা `ILIKE` নিশ্চিত করতে হবে। FreeRADIUS radcheck lookup সাধারণত exact — সমস্যা কম, কিন্তু টেস্ট করতে হবে।

### 18.5 `ON CONFLICT` unique-constraint নিশ্চিতকরণ
`radius_service`-এর প্রতিটি upsert-এর জন্য target টেবিলে (radcheck, radreply, radusergroup, radgroupreply, nas) সঠিক UNIQUE constraint দরকার। FreeRADIUS-এর default PostgreSQL schema-তে এগুলো নেই — তাই হয় (a) unique index যোগ, নয়তো (b) নিরাপদ "SELECT → INSERT/UPDATE" প্যাটার্ন। **সুপারিশ:** প্রথম রিলিজে (b) নিরাপদ প্যাটার্ন, পরে optimize।

---

## ১৯. Build Phases ও Acceptance Criteria

### Phase 0 — Infra
- [ ] PostgreSQL 16 setup, DB `radius`, user, extensions
- [ ] FreeRADIUS + `freeradius-postgresql`, schema load, `mods-enabled/sql`
- [ ] Redis, venv, base project skeleton

### Phase 1 — Backend core
- [ ] settings.py (postgresql), requirements (psycopg2)
- [ ] সব ২৪ অ্যাপের models হুবহু port; ২টি hardcoded migration PostgreSQL-এ
- [ ] `migrate` সফল (কোনো MySQL DDL error নয়)
- [ ] radius_service + অন্যান্য raw SQL PostgreSQL-এ কনভার্ট

### Phase 2 — Integration
- [ ] FreeRADIUS auth end-to-end (radcheck/radusergroup/radacct)
- [ ] MikroTik enable/disable/kick, CoA
- [ ] Billing hook chain, payment verified/unverified
- [ ] Celery beat সব task চলছে

### Phase 3 — Frontend
- [ ] সব React পেজ ও রুট, UI ডিজাইন সিস্টেম হুবহু
- [ ] Vite build → dist, Nginx serve

### Phase 4 — Data migration (যদি লাইভ ডেটা আনতে হয়)
- [ ] MySQL → PostgreSQL ডেটা মাইগ্রেশন (pgloader বা custom ETL)
- [ ] অ্যাপ টেবিল (নতুন নাম) ও `rad*` উভয়ের ডেটা যাচাই; পুরনো `isp_xxx` → নতুন `xxx` ম্যাপিং টেবিল অনুযায়ী migrate

### Acceptance Criteria (সফল = হুবহু রেপ্লিকা)
1. প্রতিটি টেবিলের নাম/ফিল্ড বর্তমান প্রজেক্টের সাথে ১০০% মিল
2. Client create → RADIUS create_user → MikroTik profile → online হওয়া কাজ করে
3. Payment (verified) → auto-enable; expiry task → Blocked_Group কাজ করে
4. সব Celery task error ছাড়া চলে
5. সব frontend পেজ লোড ও CRUD কাজ করে
6. FreeRADIUS PostgreSQL backend-এ auth/acct লগ হয়
7. কোনো MySQL-নির্দিষ্ট SQL অবশিষ্ট নেই (grep পরিষ্কার)

---

## ২০. AI Agent Bootstrap & Execution Protocol (ফ্রেশ মেশিন)

> এই সেকশন একটি **সম্পূর্ণ নতুন/খালি মেশিনে (Ubuntu 22.04/24.04)** কোল্ড-স্টার্ট করা AI এজেন্টের জন্য। এজেন্টের কাছে আগে থেকে কোনো কোড নেই — নিচের ধাপগুলো ক্রমানুসারে চালালে পুরো প্রজেক্ট দাঁড়াবে।

### 20.0 এজেন্টের কাজের নীতি
- **Source of truth ২টি:** (১) এই PRD = ম্যাপ + PostgreSQL কনভার্শন স্পেক, (২) **GitHub রেপো `rajameharonline1-afk/isp_bnas`** = আসল কোড (models, views, serializers, React পেজ)।
- **নিয়ম:** আসল কোড GitHub থেকে ক্লোন করে **রেফারেন্স** হিসেবে পড়ো; নতুন প্রজেক্টে কোড কপি করে আনো, তারপর Section 7 ও 18 অনুযায়ী **শুধু DB-layer** PostgreSQL-এ বদলাও। Business logic, পেজ, ফিল্ড — হুবহু রাখো।
- অটোনমাস: ছোট সিদ্ধান্ত নিজে নাও; শুধু destructive/irreversible কাজে থামো।

### 20.1 ধাপ ১ — আসল কোড ক্লোন (রেফারেন্স)
```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/rajameharonline1-afk/isp_bnas.git /opt/isp_bnas_reference
# এই কপি শুধু পড়ার জন্য — এখান থেকে model/view/page হুবহু দেখো
cat /opt/isp_bnas_reference/PRD_POSTGRES_REBUILD.md   # এই PRD
cat /opt/isp_bnas_reference/ai.md                     # বিস্তারিত রেফারেন্স
```
> প্রাইভেট রেপো হলে Classic PAT দরকার: `git clone https://<PAT>@github.com/rajameharonline1-afk/isp_bnas.git ...`

### 20.2 ধাপ ২ — OS প্যাকেজ ও সিস্টেম নির্ভরতা
```bash
sudo apt-get update
sudo apt-get install -y build-essential curl wget unzip \
    python3.14 python3.14-venv python3.14-dev \
    libpq-dev pkg-config \
    redis-server \
    nginx \
    snmp snmpd \
    ffmpeg
# Python 3.14 না থাকলে deadsnakes PPA:
# sudo add-apt-repository ppa:deadsnakes/ppa && sudo apt-get update
```

### 20.3 ধাপ ৩ — PostgreSQL 16 ইনস্টল ও DB তৈরি
```bash
sudo apt-get install -y postgresql-16 postgresql-client-16
sudo systemctl enable --now postgresql

# DB + user (একটাই DB: app + FreeRADIUS একসাথে)
sudo -u postgres psql <<'SQL'
CREATE USER radius WITH PASSWORD 'CHANGE_ME_STRONG';
CREATE DATABASE radius WITH OWNER radius ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;
GRANT ALL PRIVILEGES ON DATABASE radius TO radius;
SQL
```
> ⚠️ `LC_COLLATE 'C'` দিলে string sort MySQL-এর কাছাকাছি আচরণ করে (case-sensitive lookup সহজ)।

### 20.4 ধাপ ৪ — FreeRADIUS + PostgreSQL backend
```bash
sudo apt-get install -y freeradius freeradius-postgresql freeradius-utils
sudo systemctl stop freeradius

# PostgreSQL schema লোড (FreeRADIUS-এর নিজস্ব)
sudo -u postgres psql -d radius \
  -f /etc/freeradius/3.0/mods-config/sql/main/postgresql/schema.sql

# SQL module enable
sudo ln -sf /etc/freeradius/3.0/mods-available/sql /etc/freeradius/3.0/mods-enabled/sql
```
`/etc/freeradius/3.0/mods-available/sql` এডিট করো:
```
sql {
    driver     = "rlm_sql_postgresql"
    dialect    = "postgresql"
    server     = "localhost"
    port       = 5432
    login      = "radius"
    password   = "CHANGE_ME_STRONG"
    radius_db  = "radius"
    read_clients = yes
}
```
তারপর `sites-enabled/default` ও `inner-tunnel`-এ `sql` মডিউল authorize/accounting/post-auth সেকশনে সক্রিয় আছে কিনা নিশ্চিত করো।
```bash
sudo freeradius -CX   # config syntax check (error না থাকলে OK)
sudo systemctl enable --now freeradius
```
> ⚠️ **Section 18.5:** radius_service upsert-এর জন্য radcheck/radusergroup/radgroupreply/nas টেবিলে unique index লাগবে অথবা "SELECT→INSERT/UPDATE" প্যাটার্ন। প্রথম রিলিজে নিরাপদ প্যাটার্ন ব্যবহার করো।

### 20.5 ধাপ ৫ — প্রজেক্ট স্ক্যাফোল্ড ও Python env
```bash
sudo mkdir -p /var/www/IMAS && sudo chown $USER /var/www/IMAS
# রেফারেন্স কোড নতুন প্রজেক্টে কপি করে শুরু করো (তারপর DB-layer বদলাবে)
cp -r /opt/isp_bnas_reference/* /var/www/IMAS/
cd /var/www/IMAS
python3.14 -m venv venv && source venv/bin/activate

# requirements: mysql driver বাদ, psycopg2 যোগ
sed -i '/mysqlclient/d;/PyMySQL/d' requirements.txt
echo "psycopg2-binary==2.9.9" >> requirements.txt
pip install -r requirements.txt
```

### 20.6 ধাপ ৬ — DB-layer কনভার্শন (Section 7 + 18 প্রয়োগ)
এজেন্ট এই ফাইলগুলো এডিট করবে:
1. `config/settings.py` → `DATABASES` ENGINE = `postgresql`, port 5432, MySQL OPTIONS বাদ (§16)
2. `radius_app/services/radius_service.py` → pymysql→psycopg2, সব `ON DUPLICATE KEY`→`ON CONFLICT`/SELECT-প্যাটার্ন, `DATE_FORMAT`→`to_char` (§7.3, §18.4)
3. `radius_app/api/views.py`, `mikrotik_app/api/views.py` → pymysql→psycopg2
4. `radius_app/management/commands/radius_maintenance.py` → `OPTIMIZE TABLE`→`VACUUM`
5. `livetv/migrations/0004...py`, `pop/migrations/0003...py` → hardcoded MySQL DDL→PostgreSQL DDL (§18.2, §18.3); DDL-এর টেবিল নামও নতুন কনভেনশনে (`isp_pop_fundings`→`pop_fundings`)
6. **সব model-এর `Meta.db_table`** → `isp_` প্রিফিক্স বাদ (§6 নেমিং কনভেনশন)। যেমন:
   ```bash
   # সব models.py-তে db_table = 'isp_xxx' → 'xxx' (livetv_/rad* বাদ)
   grep -rl "db_table = 'isp_" --include=models.py --exclude-dir=venv . | \
     xargs sed -i "s/db_table = 'isp_/db_table = '/g"
   # raw SQL-এও পুরনো টেবিল নাম থাকলে বদলাও (radcheck ইত্যাদি rad* বাদ)
   ```
   > ⚠️ `radius_service.py`/raw SQL-এ FreeRADIUS টেবিল (`rad*`, `nas`) **বদলানো যাবে না**।
7. `.env` তৈরি (§16 এর সব key, DB_PORT=5432)

যাচাই — কোনো MySQL-চিহ্ন বাকি নেই:
```bash
grep -rniE "pymysql|mysqlclient|ON DUPLICATE KEY|DATE_FORMAT|INSERT IGNORE|ENGINE=InnoDB|OPTIMIZE TABLE" \
   --include=*.py --exclude-dir=venv . || echo "CLEAN ✅"
```

### 20.7 ধাপ ৭ — Migrate ও seed
```bash
source venv/bin/activate
python manage.py makemigrations
python manage.py migrate            # কোনো MySQL DDL error হওয়া যাবে না
python manage.py createsuperuser
python manage.py collectstatic --noinput
```

### 20.8 ধাপ ৮ — Frontend build
```bash
# Node 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
cd /var/www/IMAS/admin_panel
npm install
node ./node_modules/vite/bin/vite.js build   # → dist/ (Nginx serve করবে)
```
> নোট: ফ্রন্টএন্ড স্ট্যাক React + TypeScript + Vite (§3)। রেফারেন্স কোড JSX হলে এজেন্ট প্রয়োজনে TS-এ পোর্ট করবে, কিন্তু পেজ/লজিক/রুট হুবহু।

### 20.9 ধাপ ৯ — Gunicorn + Celery + Nginx (systemd)
```bash
# Gunicorn service (port 8000) — reference-এর deploy/ ও install.sh দেখো
sudo systemctl enable --now imas-gunicorn.service
sudo systemctl enable --now imas-celery.service imas-celerybeat.service
# Nginx: upstream অবশ্যই 127.0.0.1:8000 (8001 নয়)
sudo nginx -t && sudo systemctl reload nginx
```
> Redis, FreeRADIUS, (প্রয়োজনে Asterisk+coturn, FFmpeg LiveTV) আলাদা service।

### 20.10 ধাপ ১০ — End-to-end যাচাই (Acceptance §19)
```bash
# 1. RADIUS auth টেস্ট
radtest <username> <password> localhost 0 <shared_secret>
# 2. DB টেবিল গোনা — সব অ্যাপ টেবিল (isp_ প্রিফিক্স ছাড়া) + FreeRADIUS টেবিল
sudo -u postgres psql -d radius -c "\dt"          # সব টেবিল দেখাবে (users, clients, bills…)
sudo -u postgres psql -d radius -c "\dt rad*"     # FreeRADIUS নেটিভ
# পুরনো নামের কোনো টেবিল যেন না থাকে:
sudo -u postgres psql -d radius -c "\dt isp_*"    # ফলাফল খালি হওয়া উচিত ✅
# 3. API health
curl -s http://127.0.0.1:8000/api/v1/ | head
```
প্রতিটি Acceptance Criteria (§19) টিক না হওয়া পর্যন্ত এজেন্ট পরের ফেজে যাবে না।

### 20.11 এজেন্টের জন্য দ্রুত রেফারেন্স ম্যাপ
| দরকার | রেফারেন্স কোথায় (clone করা রেপোতে) |
|---|---|
| সব model relation | `ai.md` §4, এই PRD §6 |
| RADIUS SQL (কনভার্ট করতে হবে) | `radius_app/services/radius_service.py` |
| MikroTik logic (অপরিবর্তিত) | `mikrotik_app/services/mikrotik_service.py` |
| Billing hooks (হুবহু) | `billing/models.py` |
| Frontend রুট | `admin_panel/src/App.jsx` |
| Celery schedule | `config/settings.py` (`CELERY_BEAT_SCHEDULE`) |
| Deploy/install | `install.sh`, `deploy/` |

---

## ২১. Docker Deployment (Compose টপোলজি + পরিষেবা কনফিগ)

> এই সেকশন §20-এর host-ভিত্তিক bootstrap-এর **Docker বিকল্প**। বর্তমান প্রজেক্টে Docker ইতিমধ্যে "primary production path" (django-app/celery-worker/celery-beat/nginx কন্টেইনারে) — নতুন প্রজেক্টে PostgreSQL সহ পুরো স্ট্যাক containerize করা যায়।

### 21.1 কেন Docker (সংক্ষেপে)
এক কমান্ডে পুরো স্ট্যাক, dev↔prod parity, version-pinned নির্ভরতা, সহজ PostgreSQL সুইচ (image বদল), per-service isolation ও rollback। App-tier-এ শূন্য ঝুঁকি; hardware/raw-network সার্ভিসে (নিচে) বিশেষ কনফিগ।

### 21.2 পরিষেবা টপোলজি

| Service | Image / Build | Network | বিশেষ কনফিগ |
|---|---|---|---|
| `db` | `postgres:16` | bridge | volume `pgdata`; app + `rad*` একই DB |
| `redis` | `redis:7-alpine` | bridge | broker + cache |
| `web` | build (app image) | bridge | gunicorn :8000; `depends_on: db, redis` |
| `celery-worker` | same app image | bridge | `celery -A config worker` |
| `celery-beat` | same app image | bridge | `celery -A config beat --scheduler django_celery_beat...` |
| `nginx` | `nginx:1.27-alpine` | bridge | `dist/` serve + reverse proxy → `web:8000`; ports 80/443 |
| `freeradius` | build (freeradius-postgresql) | **`host`** | UDP 1812/1813/3799; DB=`db`; NAS(MikroTik) থেকে reachable |
| `asterisk` *(ঐচ্ছিক)* | build (asterisk+coturn) | **`host`** | RTP UDP রেঞ্জ + NAT — host networking বাধ্যতামূলক |
| `livetv` *(ঐচ্ছিক)* | build (ffmpeg-qsv) | bridge/host | `devices: ["/dev/dri:/dev/dri"]` — Intel QSV GPU passthrough |

> **নিয়ম:** stateless app-tier (db/redis/web/celery/nginx) → bridge network-এ নিরাপদ। **FreeRADIUS/VoIP/SNMP** = raw UDP + NAS client-IP নির্ভর → `network_mode: host`। **LiveTV** = Intel QSV GPU → `/dev/dri` device passthrough (host-এ Intel driver থাকতে হবে)।

### 21.3 App image — `Dockerfile` (MySQL→PostgreSQL পরিবর্তন)
বর্তমান Dockerfile MySQL lib ব্যবহার করে; নতুন প্রজেক্টে বদলাবে:
```dockerfile
FROM python:3.14-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DJANGO_SETTINGS_MODULE=config.settings
ARG APP_UID=997
ARG APP_GID=973
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl gcc pkg-config snmp ffmpeg \
        libpq-dev \            # ← MySQL-এর default-libmysqlclient-dev বাদ, PostgreSQL client lib
    && rm -rf /var/lib/apt/lists/*
# snmp = olt_mgmt (snmpwalk), ffmpeg = livetv relay — দুটোই না থাকলে silent-fail
RUN groupadd -g ${APP_GID} isp && useradd -m -u ${APP_UID} -g ${APP_GID} -s /bin/bash isp \
    && usermod -aG www-data isp
WORKDIR /var/www/IMAS
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt   # requirements-এ psycopg2-binary (mysqlclient/PyMySQL বাদ)
COPY . .
USER isp
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "4"]
```
> APP_UID/GID host-এর `isp` user-এর সাথে মেলাতে হবে (media/logs/staticfiles volume permission mismatch এড়াতে)।

### 21.4 `docker-compose.yml` (কঙ্কাল)
```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: radius
      POSTGRES_USER: radius
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U radius"]
      interval: 10s
  redis:
    image: redis:7-alpine
  web:
    image: imas-app:latest
    build: .
    env_file: .env
    depends_on: {db: {condition: service_healthy}, redis: {condition: service_started}}
    volumes: ["media:/var/www/IMAS/media", "static:/var/www/IMAS/staticfiles"]
    ports: ["8000:8000"]
  celery-worker:
    image: imas-app:latest
    env_file: .env
    command: ["celery", "-A", "config", "worker", "--loglevel=info"]
    depends_on: [db, redis]
  celery-beat:
    image: imas-app:latest
    env_file: .env
    command: ["celery", "-A", "config", "beat", "--loglevel=info",
              "--scheduler", "django_celery_beat.schedulers:DatabaseScheduler"]
    depends_on: [db, redis]
  nginx:
    image: nginx:1.27-alpine
    volumes: ["./admin_panel/dist:/usr/share/nginx/html:ro", "./deploy/nginx.conf:/etc/nginx/conf.d/default.conf:ro"]
    ports: ["80:80", "443:443"]
    depends_on: [web]
  freeradius:
    build: ./docker/freeradius
    network_mode: host          # UDP 1812/1813/3799 + সঠিক NAS client-IP
    env_file: .env
    depends_on: [db]
volumes:
  pgdata: {}
  media: {}
  static: {}
```
> ⚠️ **`network_mode: host` + bridge একসাথে মেশে না** — freeradius/asterisk host-network-এ থাকলে `db`-কে `127.0.0.1:5432` (host-published) দিয়ে অ্যাক্সেস করতে হবে, `db:5432` hostname নয়। বিকল্প: db পোর্ট host-এ publish করো, অথবা freeradius-কেও bridge-এ রেখে শুধু UDP পোর্ট expose করো (NAS IP নিয়ে পরীক্ষা করে সিদ্ধান্ত)।

### 21.5 FreeRADIUS কন্টেইনার (`docker/freeradius/Dockerfile`)
```dockerfile
FROM freeradius/freeradius-server:3.2-alpine
# অথবা: FROM alpine + apk add freeradius freeradius-postgresql
COPY mods-available/sql /etc/raddb/mods-available/sql
RUN ln -sf /etc/raddb/mods-available/sql /etc/raddb/mods-enabled/sql
# schema entrypoint-এ db-তে load: psql -f .../postgresql/schema.sql (একবার)
CMD ["radiusd", "-X"]
```
schema প্রথমবার `db`-তে লোড করার জন্য init container/entrypoint script ব্যবহার করো (§20.4)।

### 21.6 Docker-ভিত্তিক bootstrap (§20-এর বিকল্প — সংক্ষিপ্ত)
```bash
# 1. Docker + compose plugin
curl -fsSL https://get.docker.com | sh
# 2. রেফারেন্স কোড ক্লোন
git clone https://github.com/rajameharonline1-afk/isp_bnas.git /opt/isp_bnas_reference
cp -r /opt/isp_bnas_reference /var/www/IMAS && cd /var/www/IMAS
# 3. DB-layer কনভার্শন (§7, §18) + Dockerfile/compose PostgreSQL-এ (§21.3-21.4) + .env
# 4. একবারে সব দাঁড় করাও
docker compose build
docker compose up -d db redis
docker compose run --rm web python manage.py migrate      # FreeRADIUS schema-ও লোড করো
docker compose run --rm web python manage.py createsuperuser
docker compose up -d
# 5. যাচাই
docker compose ps
docker compose exec db psql -U radius -d radius -c "\dt"   # users, clients… (isp_ ছাড়া) + rad*
```

### 21.7 সিদ্ধান্ত ম্যাট্রিক্স
| সার্ভিস | Docker সুপারিশ | নোট |
|---|---|---|
| db, redis, web, celery×2, nginx | ✅ অবশ্যই | শূন্য ঝুঁকি, সর্বোচ্চ সুবিধা |
| freeradius | ✅ (host network) | কাজ করবে; NAS client-IP যাচাই করো |
| asterisk/coturn (VoIP) | ⚠️ host network | RTP/NAT জটিল — প্রথমে host-এ রেখে পরে containerize নিরাপদ |
| livetv (FFmpeg QSV) | ⚠️ device passthrough | GPU-bound; `/dev/dri` + host Intel driver |

> **সংক্ষেপ:** app-tier পুরোপুরি Docker-এ নাও; FreeRADIUS host-network-এ; VoIP ও LiveTV প্রথম রিলিজে host-এ রেখে ধীরে ধীরে কন্টেইনারে আনো।

---

## ২২. Kickoff & Handoff (এজেন্টকে যা বলবেন + ম্যানুয়াল চেকলিস্ট)

> নতুন মেশিন (Ubuntu 24.04) প্রস্তুত হওয়ার পর প্রজেক্ট শুরু→সম্পূর্ণ করার হ্যান্ডঅফ গাইড। মূলনীতি: **সফটওয়্যার প্রায় সবকিছু এজেন্ট নিজেই ইনস্টল করবে (sudo থাকলে); মানুষ শুধু এজেন্ট-রানটাইম, sudo, সিক্রেট ও নেটওয়ার্ক অ্যাক্সেস দেবে।**

### 22.1 মানুষকে যা ম্যানুয়ালি দিতে হবে (এজেন্ট পারবে না)
| # | কাজ | কেন এজেন্ট পারবে না |
|---|---|---|
| ১ | **AI এজেন্ট টুল ইনস্টল + লগইন** (Claude Code) মেশিনে | এজেন্ট নিজেকে ইনস্টল করতে পারে না |
| ২ | **sudo অ্যাক্সেস** (পাসওয়ার্ড বা `NOPASSWD` sudoers) | apt/systemctl/postgres সব sudo লাগে |
| ৩ | **GitHub PAT** (রেপো প্রাইভেট হলে) | রেফারেন্স কোড clone করতে |
| ৪ | **সিক্রেট/ক্রেডেনশিয়াল** — bKash/Nagad/SSLCommerz key, SMS API key+sender, Firebase service-account JSON, **RADIUS shared-secret** (রাউটারের সাথে মিলতে হবে), AI provider key | গোপন — এজেন্ট বানাতে পারে না |
| ৫ | **নেটওয়ার্ক reachability** — MikroTik রাউটার ও OLT-তে পৌঁছানো (LAN/VPN/router NAT), SNMP trap UDP 162 | ফিজিক্যাল নেটওয়ার্ক |
| ৬ | **(শুধু LiveTV লাগলে)** Intel GPU + `/dev/dri` (QSV) | হার্ডওয়্যার |

> এজেন্ট **নিজেই বানাতে পারে** (মানুষের লাগবে না): `SECRET_KEY`, `PASSWORD_ENCRYPT_KEY`, `WEBHOOK_SHARED_SECRET`, DB password।

### 22.2 এজেন্ট নিজেই যা করবে (sudo থাকলে)
PostgreSQL 16, FreeRADIUS+postgresql, Redis, Nginx, Node, Python venv, ffmpeg, snmp, (চাইলে Docker) — **সব ইনস্টল**; কোড clone→কপি→PostgreSQL কনভার্শন (§7, §18); টেবিল rename `isp_` বাদ (§6); `.env` জেনারেট; migrate; frontend build (lucide-react); systemd সার্ভিস; end-to-end যাচাই (§19)।

### 22.3 এজেন্টকে দেওয়ার Kickoff মেসেজ (কপি-পেস্ট)
```
নতুন মেশিন Ubuntu 24.04। /opt/isp_bnas_reference-এ রেফারেন্স কোড clone করো
(GitHub: rajameharonline1-afk/isp_bnas), তারপর /opt/isp_bnas_reference/PRD_POSTGRES_REBUILD.md
পুরোটা পড়ো — এটাই single source of truth।

লক্ষ্য: PRD অনুযায়ী /var/www/IMAS-এ নতুন IMAS প্রজেক্ট তৈরি করে সম্পূর্ণ চালু করো —
রেফারেন্সের সব পেজ/লজিক/ফিচার/টেবিল হুবহু, শুধু DB = PostgreSQL, FreeRADIUS-ও
PostgreSQL, টেবিল নাম isp_ প্রিফিক্স ছাড়া, আইকন lucide-react।

কাজের নিয়ম:
- §20 (host) অথবা §21 (Docker) — যেকোনো একটি পথ বেছে ধাপে ধাপে সম্পূর্ণ করো।
- যা তুমি নিজে পারো (apt install, postgres/freeradius/redis/nginx setup, code
  conversion, build, migrate, systemd) — বিনা জিজ্ঞাসায় করো।
- শুধু যেগুলো আমার কাছ থেকে লাগবে (GitHub PAT, bKash/SMS/Firebase secret,
  RADIUS shared-secret, রাউটার/OLT IP ও credential) — একসাথে তালিকা করে
  আমাকে একবারে জিজ্ঞেস করো, অনুমান করো না।
- প্রতি ফেজ শেষে §19 Acceptance Criteria যাচাই করে জানাও, তারপর পরের ফেজে যাও।
- destructive/irreversible কাজ (DB drop, প্রোডাকশন ওভাররাইট) ছাড়া থেমো না।

শুরু করো এবং প্রথমেই তোমার যা যা লাগবে (secrets/network) তার পূর্ণ তালিকা দাও।
```

### 22.4 ওয়ার্কফ্লো (৪ ধাপ)
1. **আপনি:** মেশিনে এজেন্ট টুল ইনস্টল + লগইন, sudo নিশ্চিত
2. **আপনি:** §22.3 মেসেজ পেস্ট
3. **এজেন্ট:** প্রথমেই যা লাগবে তার তালিকা দেবে (PAT, secrets, রাউটার IP…) → আপনি দেবেন
4. **এজেন্ট:** বাকি সব নিজে করে ফেজ-বাই-ফেজ সম্পূর্ণ করবে, প্রতি ধাপে §19 যাচাই দেখাবে

### 22.5 এক-নজরে দায়িত্ব বণ্টন
| দায়িত্ব | মানুষ | এজেন্ট |
|---|---|---|
| এজেন্ট রানটাইম + লগইন + sudo | ✅ | — |
| সিক্রেট/ক্রেডেনশিয়াল সরবরাহ | ✅ | — |
| রাউটার/OLT নেটওয়ার্ক + শারীরিক হার্ডওয়্যার | ✅ | — |
| সফটওয়্যার ইনস্টল (postgres/freeradius/redis/nginx/node/docker) | — | ✅ |
| কোড clone→PostgreSQL কনভার্শন→টেবিল rename→build→deploy | — | ✅ |
| generated secrets (SECRET_KEY ইত্যাদি) | — | ✅ |
| যাচাই ও ফেজ রিপোর্ট (§19) | — | ✅ |

> **সারমর্ম:** মানুষের ভাগে ~৫% (রানটাইম, sudo, secret, নেটওয়ার্ক); বাকি **~৯৫% এজেন্ট** স্বয়ংক্রিয়ভাবে করবে।

---

## পরিশিষ্ট A — মূল ঝুঁকি
1. **`ON CONFLICT` unique constraint** — radius_service upsert-এর জন্য FreeRADIUS PostgreSQL schema-তে সঠিক unique key নিশ্চিত করা (সবচেয়ে সূক্ষ্ম কাজ)
2. **Case-sensitivity** — username lookup PostgreSQL-এ case-sensitive
3. **Data migration** — `radacct`-এর বড় ভলিউম; boolean (tinyint→bool) রূপান্তর
4. **FreeRADIUS reconfig** — postgresql module + schema + queries.conf

## পরিশিষ্ট B — রেফারেন্স ফাইল (বর্তমান প্রজেক্ট)
- বিস্তারিত: `ai.md` (Section 4 relations, 9 tables, 14 work log)
- RADIUS logic: `radius_app/services/radius_service.py`
- MikroTik logic: `mikrotik_app/services/mikrotik_service.py`
- Billing hooks: `billing/models.py`
- Frontend routes: `admin_panel/src/App.jsx`
