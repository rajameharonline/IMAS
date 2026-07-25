# Staff/Admin Mobile App — Implementation Plan

> **সিদ্ধান্ত (2026-06-17):** একই mobile_app codebase, **role-based login**। Client app-ই
> role অনুযায়ী Client / Staff / Support / Admin UI দেখাবে। Scope = সম্পূর্ণ
> (Calling+Support → Client Mgmt → Dashboard/Reports → Full Admin), phased delivery।

## আর্কিটেকচার সিদ্ধান্ত

- **এক অ্যাপ, role-aware:** login-এ account type সনাক্ত → AuthContext-এ role/permissions →
  navigation ও tab bar role অনুযায়ী branch।
- **দুই auth একত্র:** Client = `customer_id + app_password` (custom JWT)। Staff =
  Django `User` + `role_permissions` (User JWT)। একটি unified `/app/auth/login/` দুটোই
  হ্যান্ডল করবে, token-এ `role` claim থাকবে।
- **VoIP রেডি:** `SipEndpoint` আগেই client+agent সাপোর্ট করে; `PBXAgent` staff→extension
  ম্যাপ করে। Staff calling-এ নতুন backend infra কম লাগবে। দেখুন [[project_voip_live]]।
- **Permission single source of truth:** backend role_permissions; অ্যাপ শুধু backend থেকে
  আসা permission list অনুযায়ী UI দেখাবে (client-side guard cosmetic, backend enforce আসল)।

---

## Phase 0 — Auth Foundation (role-aware login) 🔑 ✅ সম্পন্ন (2026-06-17)

**Backend (`mobile_api`)**
- [x] `/app/auth/login/` role-aware: explicit `login_type` বা auto-detect (client আগে,
      না পেলে staff)। Response-এ `account_type` + (staff হলে) `user` + `permissions`।
- [x] Staff `/app/staff/me/` endpoint — User profile + role_permissions snapshot।
- [x] JWT access token-এ `role` claim (refresh→access propagate)।
- [x] `AppTokenRefreshView` staff token (user_id) handle করে।
- [x] `staff_permissions()` helper — MyPermissionsView সমতুল্য (UI guard; backend-ই enforcer)।

**Mobile (`mobile_app`)**
- [x] `LoginScreen` — identifier পাঠায় (Client Code/Username auto-detect)।
- [x] `AuthContext` — accountType/staffUser/permissions store; `isStaff/isClient/hasModule/hasGranular` helper; role-aware login/restore/logout; auto-logout staff-এও।
- [x] Root navigator role branch: `Login` → (staff) `StaffMain` / (client) `MainTabs`।
- [x] `StaffHomeScreen` placeholder (Phase 1-এ Calls/Support tab আসবে)।

> **পরবর্তী:** Phase 1 — Calling + Support।

---

## Phase 1 — Calling + Support (staff v1) 📞 ✅ অনেকটা সম্পন্ন (2026-06-17)

**Backend**
- [x] `/app/staff/voip/sip-credentials/` — `provision_endpoint(user=)` দিয়ে agent_<userid>
      endpoint auto-provision + creds (wss/domain/ice/hotlines)।
- [x] Support staff API — বিদ্যমান `/support/tickets/` (list/detail/reply/change-status/assign)
      staff JWT দিয়েই কাজ করে (নতুন endpoint লাগেনি)।
- [~] Incoming call routing client→staff: backend infra রেডি (SipEndpoint agent + ring group),
      কিন্তু কোন agent কোন ring group-এ তা **admin PBX config** নির্ভর (mobile-side রেডি)।
- [ ] FCM push: incoming call + new ticket notification staff-কে (পরে; client infra reuse করা যাবে)।

**Mobile**
- [x] Staff tab bar: হোম / Calls (raised) / সাপোর্ট।
- [x] DialPad + CallScreen reuse — `CallContext` accountType অনুযায়ী staff creds endpoint দিয়ে register।
- [x] Support inbox (`StaffSupportListScreen`) + detail/reply/status (`StaffTicketDetailScreen`)।
- [~] Incoming call UI — CallKeep/CallScreen client থেকেই reuse হয় (staff registered থাকলে INVITE পাবে)।

> **POP reseller (user request):** একই অ্যাপে role-based — backend POP login + `/app/pop/me/`
> + POP JWT (pop_id); mobile AuthContext 'pop' type + `hasMenu()` + `POPHomeScreen`
> (pop.menus অনুযায়ী dashboard)। ✅ সম্পন্ন। POP-এর module screens (client/billing/recharge)
> Phase 3+ এ। POP calling SIP পরে।

---

## Phase 2 — Dashboard + Reports 📊 ✅ সম্পন্ন (2026-06-17)

**Backend**
- [x] `/app/staff/dashboard/` — today/month collection, online clients (RADIUS), total due,
      client counts (admin scope) / নিজের collection (collector scope)।
- [x] `/app/staff/reports/daily-collection/?from=&to=` — দিন-ভিত্তিক গ্রুপ + payment-method breakdown + grand total।

**Mobile**
- [x] `StaffDashboardScreen` (Home tab) — stat cards (collection/online/client) + pull-refresh + Reports button।
- [x] `StaffReportScreen` — range selector (আজ/৭দিন/মাস) + grand total + method + daily breakdown।
- [x] Home tab → `StaffHomeStack` (Dashboard + Report)।

---

## Phase 3 — Client Management 👥 ✅ সম্পন্ন (2026-06-17)

**Backend**
- [x] `/app/staff/clients/?search=&status=&page=` — mobile-optimized lightweight list (paginated 30)।
- [x] `/app/staff/clients/<id>/` — profile + bill summary + recent payments।
- [x] `_staff_can_manage_clients()` permission gate (admin/manager + role_permissions 'client' module)।
- [x] Enable/Disable + collection — বিদ্যমান `/clients/<id>/enable|disable/` ও `/billing/payments/`
      reuse (staff JWT; complex radius/mikrotik logic duplicate করিনি)।
- [ ] Change request / package change — পরে (Phase 4 বা প্রয়োজনে)।

**Mobile**
- [x] `StaffClientListScreen` — search + status tabs + infinite scroll।
- [x] `StaffClientDetailScreen` — profile + Enable/Disable + Collect modal (amount+method) + recent payments।
- [x] Staff tab bar-এ 'ক্লায়েন্ট' tab যোগ (Home/Clients/Calls/Support)।

---

## Phase 4 — Full Admin (POP, billing, HR) 🏢 ✅ সম্পন্ন (2026-06-17)

> Dashboard-এ "অ্যাডমিন" section permission অনুযায়ী tile দেখায়।
- [x] **Payment Approval** — `/app/staff/pending-payments/` (GET list + POST approve);
      `StaffPendingPaymentsScreen` (multi-select)। admin/manager/accountant।
- [x] **POP তালিকা + profile/funding** — `/pop/pops/` + `/pop/pops/<id>/` + `/pop/fundings/?pop=`
      reuse; `StaffPOPListScreen` (tap →) `StaffPOPDetailScreen` (profile + funding history)।
- [x] **Billing** — `/app/staff/bills/?search=&status=`; `StaffBillsScreen` (status tab + infinite scroll)। admin-level।
- [x] **HR self-service** — `/app/staff/hr/me/` (employee + attendance + payslip);
      `StaffHRScreen` (month summary + হাজিরা/বেতন tab)। যেকোনো staff (employee যুক্ত থাকলে)।
- [ ] SMS, monitoring ইত্যাদি — প্রয়োজন অনুযায়ী ভবিষ্যতে।

## ✅ সব Phase সম্পন্ন (Phase 0–4)। বাকি cross-cutting নিচে।

---

## Cross-cutting (সব phase জুড়ে)

- [x] **Backend permission enforcement** — প্রতিটি staff endpoint role/role_permissions দিয়ে গার্ড।
- [x] **Incoming call routing (auto)** — `/app/staff/voip/sip-credentials/` এখন auto PBXAgent তৈরি করে
      (extension auto-assign + agent endpoint) এবং কোনো ring group-এ না থাকলে প্রথম active ring group-এ
      যোগ করে → client→hotline কল staff app-এ রিং করবে (admin manual config ছাড়াই)।
- [x] **Push notification (ticket)** — User-এ `fcm_token` field; `/app/staff/fcm-token/`;
      `support/signals.py`-এ ticket created/status/assigned-এ `_push_fcm_to_users` (transaction.on_commit)।
      Mobile `registerForPushNotifications(accountType)` staff endpoint-এ token পাঠায়।
- [~] **Push notification (incoming call)** — server-side ARI/dialplan trigger বাকি (call ring হলে
      FCM)। বর্তমানে registered থাকলে WSS দিয়ে INVITE পায়; app killed হলে FCM call-push বাকি।
- [ ] **App size** — staff কোড lazy-load/conditional (পরে, প্রয়োজনে)।
- [x] **Security** — staff token role claim; POP password hashed/plain tolerant; sensitive endpoint role-gated।
- [ ] **POP calling SIP** + POP module screens (POP reseller-এর জন্য) — পরে।

## অগ্রগতি ট্র্যাকিং
প্রতিটি phase শেষে `ai.md` Section 14-এ entry + এই ফাইলের checkbox আপডেট।
