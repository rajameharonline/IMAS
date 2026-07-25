# ISP-BNAS — VoIP / IP Phone System ইমপ্লিমেন্টেশন প্ল্যান

> **স্ট্যাটাস:** Phase 1–5.5 ✅ সম্পন্ন (2026-06-21) — register/call/answer/killed-app incoming/extension dialing লাইভ; অডিও infra (coturn/Asterisk/MikroTik) ঠিক, admin→device অডিও যাচাইকৃত; পূর্ণ দুমুখী অডিও = ২টা আসল ফোনে বাকি। Phase 6 (hardening) বাকি।
> **সিদ্ধান্ত (lock করা):** App-to-app কলিং (admin panel ↔ client app)। PSTN পরে — তখন শুধু একটা SIP trunk যোগ হবে।
> **স্ট্যাক:** Asterisk (PJSIP realtime/MySQL) + coturn (TURN) + SIP.js (web) + React Native SIP/CallKeep/FCM (mobile) + Django integration layer।
> **এই ডকুমেন্ট কীভাবে পড়বেন:** Phase 0 → 6 ক্রমানুসারে। প্রতিটি Phase-এ "Deliverable" ও "Done যখন" দেওয়া আছে।

---

## SECTION A: কেন এই স্ট্যাক (সংক্ষিপ্ত যুক্তি)

- **Asterisk vs Twilio:** App-to-app কলে Twilio per-minute চার্জ করে এবং ডেটা বিদেশি ক্লাউডে যায়। ISP হিসেবে আপনার নিজস্ব Linux সার্ভার ও পাবলিক IP আছে — তাই self-hosted Asterisk ফ্রি, full control, ডেটা দেশেই থাকে।
- **PJSIP realtime (MySQL):** Asterisk endpoint config `.conf` ফাইলে না রেখে MySQL table-এ রাখা হবে। Django সরাসরি ঐ table-এ row insert/update করলেই endpoint তৈরি/পরিবর্তন হয় — কোনো reload লাগে না। এটাই provisioning-কে clean রাখে।
- **WebRTC-only (WSS + DTLS-SRTP):** Browser ও app উভয়ই WebRTC দিয়ে connect করবে। প্লেইন SIP UDP 5060 firewall-এ বন্ধ থাকবে → attack surface প্রায় শূন্য।
- **ARI (Asterisk REST Interface):** কল originate ও event (call log) ধরার জন্য AMI-এর চেয়ে আধুনিক, JSON/WebSocket-ভিত্তিক।

---

## SECTION B: টার্গেট আর্কিটেকচার

```
┌────────────────────┐  WSS/DTLS-SRTP   ┌──────────────────────┐
│ React Admin Panel  │◄────────────────►│      Asterisk        │
│ (SIP.js softphone) │                  │  chan_pjsip          │
└─────────┬──────────┘                  │  WSS:8089  ARI:8088  │
          │ JWT → ephemeral SIP creds   │  (ARI = localhost)   │
          ▼                             └────┬─────────────┬───┘
┌────────────────────┐  ARI WebSocket event  │             │ media (SRTP)
│   Django DRF        │◄──────────────────────┘             │  via coturn
│  voip/ app          │   localhost only                    ▼
│  - provisioning     │                          ┌──────────────────────┐
│  - ARI listener     │   FCM push (incoming)    │  Client App (RN)     │
│  - call logs/vmail  │─────────────────────────►│  SIP + CallKeep      │
└─────────┬───────────┘                          └──────────────────────┘
          ▼
   MySQL: isp_call_logs, isp_voice_messages  → FK isp_clients
   MySQL (radius DB pattern): ps_endpoints / ps_auths / ps_aors (Asterisk realtime)
```

**Endpoint নামকরণ কনভেনশন (call ↔ client correlation-এর জন্য জরুরি):**
- Client endpoint: `client_<client_id>` (যেমন `client_4521`)
- Agent/admin endpoint: `agent_<user_id>` (যেমন `agent_7`)
- ARI event থেকে regex দিয়ে এই নাম পার্স করে `Client`/`User` map করা হবে।

---

## SECTION C: Phase-ভিত্তিক টাস্ক ব্রেকডাউন

### Phase 0 — সিদ্ধান্ত ও পরিবেশ প্রস্তুতি (server-side, কোড নয়)
**লক্ষ্য:** কোথায় Asterisk বসবে ঠিক করা।
- [ ] Asterisk কোথায় চলবে ঠিক করুন — একই VPS-এ নাকি আলাদা VM (সুপারিশ: প্রথমে একই সার্ভার, আলাদা service)।
- [ ] একটা subdomain ঠিক করুন: `voip.<yourdomain>` → Let's Encrypt cert।
- [ ] Firewall প্ল্যান: পাবলিকে শুধু `8089/tcp` (WSS) + coturn পোর্ট (`3478`, `5349`, relay range)। `5060`, `5038(AMI)`, `8088(ARI)` → localhost/বন্ধ।
- **Done যখন:** subdomain + cert প্ল্যান চূড়ান্ত, firewall rule লেখা।

### Phase 1 — Asterisk + coturn সেটআপ (server) ✅ সম্পন্ন ও যাচাইকৃত (2026-06-16); firewall (MikroTik port-forward) + end-to-end কল+অডিও test ✅ DONE
**Deliverable:** WebRTC-capable Asterisk + TURN, **file-based PJSIP provisioning** সহ।
**সম্পূর্ণ deployment bundle:** [`deploy/asterisk/`](deploy/asterisk/) — এক কমান্ডে:
`sudo bash deploy/asterisk/install.sh roisp.duckdns.org` (বিস্তারিত: `deploy/asterisk/README.md`)।
> ⚠️ পরিবেশ: Ubuntu 26.04, Asterisk 22.5/coturn 4.6 apt-এ; domain `roisp.duckdns.org`।

**🔴 realtime/ODBC বাদ দেওয়া হয়েছে (২০২৬-০৬-১৬):** এই সার্ভারে `mysql-server-8.4` প্যাকেজে
`Conflicts: mariadb-common`; `odbc-mariadb` → `libmariadb3` → `mariadb-common`। প্রথম install-এ
এটি **mysql-server remove করে দিয়েছিল → প্রোডাকশন DB ডাউন** (ডেটা purge হয়নি বলে recover হয়েছে,
`apt-get install mysql-server` দিয়ে)। তাই **file-based provisioning**-এ পিভট:
- [x] Asterisk + coturn install (`odbc-mariadb` **বাদ**; install.sh-এ DB-remove গার্ড যোগ)।
- [x] **File-based PJSIP** — প্রতিটি endpoint `/etc/asterisk/pjsip_isp.d/<name>.conf`; Django লেখে
  (gunicorn user `isp`, dir setgid `asterisk`), **AMI দিয়ে `pjsip reload`**। `pjsip.conf`-এ
  `#include "pjsip_isp.d/*.conf"`। কোনো `asterisk` DB/ODBC নেই।
- [x] WSS transport (8089) + DTLS-SRTP (`webrtc=yes`) + Let's Encrypt (`certbot --nginx`, renewal hook)।
- [x] ARI **localhost** (127.0.0.1:8088) + AMI **localhost** (127.0.0.1:5038); creds generate → `.env`।
- [x] coturn + `use-auth-secret` (ephemeral HMAC) — `coturn/turnserver.conf`।
- [x] `.env`-এ `VOIP_ENABLED=True` + ARI/AMI/TURN/`VOIP_PJSIP_DIR` keys (generated secrets)।
- [x] `manage.py voip_provision_all` — বিদ্যমান client/agent একবারে provision (install শেষে চলে)।
- **Done ✅ (যাচাইকৃত):** ৪ endpoint (agent_1, client_1/2/4) pjsip-এ দৃশ্যমান; WSS bound 0.0.0.0:8089
  (`/ws`,`/ari/`); ARI 127.0.0.1:8088; AMI user isp_django; asterisk+coturn active।
  **বাকি:** firewall পোর্ট খোলা + Phase 4 softphone দিয়ে real কল+অডিও test।
  > শিক্ষা: provisioning root হিসেবে চালাতে হয় (`.env` mode 600, isp পড়তে পারে না; gunicorn systemd
  > EnvironmentFile দিয়ে পায়)। install.sh step 9 এখন root-এ চালায় + isp:asterisk chown করে।

### Phase 2 — Django `voip/` app (backend core) ✅ সম্পন্ন (2026-06-16)
**Deliverable:** Provisioning + models + DRF endpoints (server install ছাড়াই dev-এ লেখা যায়)।
- [x] নতুন app: `voip/` — `config/settings.py` INSTALLED_APPS-এ append করা হয়েছে।
- [x] **Models** (`db_table = 'isp_*'` pattern): `voip/models.py`
  - `CallLog` → `isp_call_logs` (client FK, agent FK, direction, sip_channel, caller/callee, started/answered/ended, duration, status, recording)
  - `VoiceMessage` → `isp_voice_messages` (client FK, sent_by FK, audio, duration, is_heard, heard_at)
  - `SipEndpoint` → `isp_sip_endpoints` (client/user OneToOne, endpoint_name, secret_encrypted, max_contacts, is_active)
- [x] `makemigrations voip && migrate voip` — `0001_initial` applied (additive, শুধু নতুন table)।
- [x] **Provisioning service** (`voip/services/asterisk_provision.py`):
  - `provision_endpoint(client=/user=)` → `SipEndpoint` get-or-create + secret। `VOIP_ENABLED=True` হলে `_push_to_realtime()` দিয়ে `ps_auths/ps_aors/ps_endpoints`-এ push (pymysql, আলাদা `asterisk` DB)।
  - secret auto-generate (`secrets.token_urlsafe`) + `role_permissions.utils.encrypt_password` দিয়ে এনক্রিপ্ট (বিদ্যমান `PASSWORD_ENCRYPT_KEY` reuse)।
  - `deprovision_endpoint()` — client left/deleted/agent disable।
- [x] **Provisioning hook:** `voip/signals.py` — `Client` post_save (created) → `provision_endpoint`। ⚠️ আলাদা signal, payment/RADIUS chain-এ স্পর্শ নেই; try/except-এ মোড়া যেন client save না ভাঙে।
- [x] **DRF endpoints** (`voip/api/`):
  - `GET /api/v1/voip/sip-credentials/` → JWT user-এর ephemeral SIP creds + wssUrl + coturn iceServers (HMAC ephemeral)।
  - `POST /api/v1/voip/call/originate/` → ARI Originate (VOIP_ENABLED=False হলে 503; ARI client Phase 3-এ → 501 stub)।
  - `GET /api/v1/voip/call-logs/?client=&direction=&status=` → read-only কল হিস্ট্রি।
  - `voice-messages/` ViewSet (upload/list/`mark_heard`) — FCM push TODO (Phase 5)।
- [x] **settings.py** — `VOIP_ENABLED` (default False) + ARI/realtime-DB/TURN env keys (সব `.env` থেকে, hardcode নয়)।
- **Done ✓:** `sip-credentials` JWT দিয়ে valid creds ফেরত দেয় (যাচাই করা — agent_1, 32-char secret decrypt OK)। `VOIP_ENABLED=False` তাই realtime push inert; Asterisk চালু হলে (Phase 1) `True` করলেই `ps_endpoints`-এ row যাবে।

### Phase 3 — Call Logging (AMI listener) ✅ কোড সম্পন্ন (2026-06-16); service চালু বাকি
**Deliverable:** আলাদা long-running process যা কল event ধরে `CallLog` লেখে।
> **পরিবর্তন:** ARI Stasis নয়, **AMI** ব্যবহার করা হয়েছে — কারণ আসল কল `voip-internal` dialplan
> দিয়ে যায় (Stasis-এ নয়); passive logging-এ AMI সঠিক, dialplan reroute লাগে না।
- [x] `python manage.py voip_call_listener` — AMI (127.0.0.1:5038) socket; `Events: call` শোনে।
- [x] Event → endpoint নাম parse (`PJSIP/client_4-xxx`→`client_4`) → `Client`/`User` map:
  `DialBegin`→CallLog তৈরি (ringing); `DialEnd`→status (ANSWER/BUSY/NOANSWER/...)+answered_at;
  `Hangup`→ended_at+duration+ (answered হলে) completed। Linkedid দিয়ে correlate।
- [x] `voip/services/ari_client.py` — `originate_call()` (server-initiated, ARI REST/urllib) — originate endpoint-এর জন্য।
- [x] systemd `isp-voip-listener.service` (User=isp + EnvironmentFile=.env, gunicorn-এর মতো)। install.sh step 9b enable করে।
- [x] `manager.conf` read perms-এ **`call`** যোগ (নইলে listener Dial/Hangup event পায় না)।
- [ ] Recording (ঐচ্ছিক, পরে)।
- **Done যখন:** listener service running; একটা কল attempt করলে `isp_call_logs`-এ row তৈরি হয়
  (device না থাকলেও DialBegin→CHANUNAVAIL log হয়, তাই এখনই যাচাইযোগ্য)।

### Phase 4 — React Admin Softphone (SIP.js) ✅ build সম্পন্ন (2026-06-16); browser test বাকি
**Deliverable:** admin panel থেকে client-কে কল।
- [x] `sip.js@0.21.2` install (`--legacy-peer-deps` — React 19 peer conflict)।
- [x] `admin_panel/src/voip/SoftphoneContext.jsx` — UserAgent/Registerer/Inviter; creds `/voip/sip-credentials/`
  থেকে; incoming (`onInvite`), outbound (`startCall`), `answer`/`hangup`/`toggleMute`; remote অডিও
  peerConnection receivers থেকে; coturn iceServers।
- [x] `admin_panel/src/components/SoftphoneWidget.jsx` — floating widget: status dot, incoming/active
  call UI, timer, answer/hangup/mute। `Layout.jsx`-এ `SoftphoneProvider` + widget globally mount।
- [x] `ClientProfile.jsx` breadcrumb-এ **"কল করুন"** বাটন → `startCall('client_<id>', name)`
  (status='registered' ও কোনো active call না থাকলে enabled)।
- [x] **Build OK** (`vite build` — 1605 modules)।
- [ ] (পরে) Call History tab `/voip/call-logs/?client=` — Phase 3-এর log আসার পর।
- [ ] (পরে) Voice message recorder (MediaRecorder) → upload।
- **Done ✅ (2026-06-16):** admin panel (HTTPS) থেকে client app-এ কল → ফোন বাজে → answer → **দুমুখী
  অডিও কাজ করছে**। (MikroTik-এ 8089/TURN/RTP port-forward করার পর।)

### Phase 5 — Mobile App (Expo RN, mobile_app/) ✅ EAS APK build + device কল+অডিও test সফল (2026-06-16)
**Deliverable:** client app-এ incoming কল।
> **স্ট্যাক:** Expo SDK 54 + **react-native-webrtc** + **sip.js** (Linphone/react-native-sip2 নয়)।
> ⚠️ native module — **Expo Go-তে নয়, EAS dev/preview build লাগবে**। বিস্তারিত: `mobile_app/VOIP_README.md`।
- [x] `react-native-webrtc@124` + `@config-plugins/react-native-webrtc@15` + `sip.js@0.21` install; app.json-এ
  config plugin + RECORD_AUDIO/mic permission।
- [x] `src/services/sipPhone.js` — registerGlobals + sip.js (register/call/answer/hangup/mute; remote audio auto)।
- [x] `src/context/CallContext.js` — login হলে `/app/voip/sip-credentials/` থেকে creds নিয়ে register; state।
- [x] `src/screens/call/CallScreen.js` — full-screen incoming/active UI (Modal); `App.js`-এ CallProvider+CallScreen।
- [x] **Backend:** `mobile_api` → `AppSipCredentialsView` (`GET /api/v1/app/voip/sip-credentials/`, JWT client)।
- [x] **FCM push + react-native-callkeep** ✅ (2026-06-16) — অ্যাপ বন্ধ থাকলেও full-screen incoming
  call UI + দুমুখী audio। data-only high-priority FCM (AMI listener) → bg handler → CallKeep self-managed →
  dialplan retry (~২৪s) client register window → answer → audio। ⚠️ শর্ত: callkeep New-Arch patch,
  READ_PHONE_NUMBERS perm, FG notificationIcon, selfManaged (managed নয়)। বিল্ড: নতুন Expo account
  `rajameharonlineapp`। বাকি: killed-app registration timing reliability।
- [ ] react-native-incall-manager (audio routing), client→office outgoing বাটন, voice message — পরে।
- **Done ✅ (2026-06-16):** EAS preview APK → device (LTE) client login → register (public IP) →
  admin "কল করুন" → CallScreen ring + answer → **দুমুখী audio**। 🔑 শর্ত: MikroTik-এ 8089/TURN/RTP
  port-forward; ফোন register fail করলে অ্যাপ restart লাগে (auto-retry এখনো নেই)।

### Phase 5.5 — Reliability hardening + অডিও NAT infra + extension dialing ✅ (2026-06-21)
**Deliverable:** কল নির্ভরযোগ্যতা, NAT অডিও, ও numeric extension dial — আসল ডিভাইসে production-ready।

**App (সব JS → OTA-able; `feat/mobile-app-overhaul`):**
- [x] `sipPhone.js`: `wakeRegister()` (FCM-এ instant register), `_startStatusSync()` reconciler ("সংযোগ হচ্ছে"-তে আটকে থাকা fix), reconnect backoff 30s→6s (flicker fix)।
- [x] `CallContext.js` watchdog: non-registered ≈80s → hardReset (auto-recover; reopen লাগে না)।
- [x] `AuthContext.js`: auto-logout role-based — **staff/admin always-online**, client/pop ৮ঘণ্টা।
- [x] `backgroundService.js`: battery exemption + OEM auto-start (notifee API)।
- [x] DialPad grace 12s→18s।
- [x] Emulator টেস্ট: `EMULATOR_BUILD=1` (x86_64 ABI opt-in, `withGradleMemory.js`)।

**🔴 অডিও (NAT) — মূল কারণ ছিল সার্ভার infra (কল connect হতো, অডিও আসত না):**
- লক্ষণ: SDP-তে `c=127.0.1.1` + শুধু internal/docker candidate; **coturn DOWN + turnserver.conf placeholder**।
- [x] `deploy/asterisk/coturn/setup_coturn.sh` — .env TURN_SECRET → /etc/turnserver.conf (external-ip সহ) + enable/start।
- [x] `deploy/asterisk/fix_media_nat.sh` — pjsip `external_media_address`/`external_signaling_address`+`local_net`, rtp `stunaddr`, reload।
- ⚠️ **public IP আর্গুমেন্ট দিয়ে চালাতে হয়:** `sudo bash ...setup_coturn.sh 103.214.202.17` ও `...fix_media_nat.sh 103.214.202.17` (domain locally LAN-এ resolve করে)।
- MikroTik forward (আগে থেকেই): 3478/5349 + relay 49152-65535 + RTP 10000-20000।
- **ফলাফল:** coturn active, relay candidate আসে, admin→emulator অডিও PC স্পিকারে ✓। **পূর্ণ দুমুখী = ২টা আসল ফোন** (emulator-এ mic নেই, double-NAT)।

**Extension dialing (staff-to-staff):**
- [x] PBX Agents পেজ (VoIP→PBX Agents) → প্রতি staff-এর extension (101/102/103…) সেট → save → `pbx_provision._write_all_hotlines()` `exten => <number>` (wake-dial) generate করে। যাচাই: `102`→admin ring ✓। `100`=hotline ring group।

**Build/deploy:** EAS local build (`build_and_publish_apk.sh`) + OTA (`eas update --branch preview`); সার্ভার↔build-clone sync = git (সার্ভারে sshd নেই)। বিস্তারিত: `mobile_app/public_apk/README.md`।

---

### Phase 6 — Security Hardening ও Production
**Deliverable:** নিরাপদ, monitored production setup।
- [ ] `alwaysauthreject=yes`, `allowguest=no`; প্রতি endpoint `max_contacts=1-2`।
- [ ] fail2ban jail (Asterisk security log → failed registration ban)।
- [ ] ARI/AMI `127.0.0.1` bind নিশ্চিত; firewall audit।
- [ ] coturn ephemeral creds TTL যাচাই; rate limiting।
- [ ] কল permission `role_permissions`-এ নতুন permission node (`voip.can_call`, `voip.can_voicemail`)।
- [ ] Load/concurrency test; monitoring (active channels, registration count)।
- **Done যখন:** security checklist পাস; অননুমোদিত registration fail2ban-এ block হয়।

---

## SECTION D: নিরাপত্তা চেকলিস্ট (সারাংশ)

| ব্যবস্থা | কারণ |
|---|---|
| WebRTC-only, UDP 5060 বন্ধ | SIP scanner/brute-force attack surface সরানো |
| Ephemeral SIP creds (JWT endpoint), hardcode নয় | frontend-এ static পাসওয়ার্ড leak রোধ |
| Endpoint পাসওয়ার্ড encrypted (PASSWORD_ENCRYPT_KEY) | DB leak হলেও creds সুরক্ষিত |
| ARI/AMI localhost-only | কন্ট্রোল API বাইরে expose নয় |
| `alwaysauthreject` + `allowguest=no` | user enumeration ও guest call রোধ |
| fail2ban | repeated failed auth IP ban |
| TLS (Let's Encrypt) WSS/DTLS | browser-required + encrypted media |
| coturn REST ephemeral creds | TURN relay abuse রোধ |
| App-to-app only (PSTN নেই) | toll-fraud ঝুঁকি কার্যত শূন্য |
| role_permissions কল gating | শুধু অনুমোদিত role কল করতে পারে |

---

## SECTION E: ⚠️ যা ভাঙা যাবে না (এই ফিচার যোগ করার সময়)

- `billing/models.py` Payment chain, `radius_service.py`, `mikrotik_service.py` — অপরিবর্তিত। VoIP সম্পূর্ণ আলাদা app।
- `config/settings.py` — INSTALLED_APPS-এ শুধু `'voip'` **append**; DATABASES/AUTH_USER_MODEL অপরিবর্তিত।
- Asterisk realtime table আলাদা DB (`asterisk`)-এ — `isp_*` বা `radius` DB-তে নয়।
- Client provisioning signal হবে **আলাদা**; payment/enable chain reaction-এ ঢুকবে না।
- নতুন `.env` keys: `ASTERISK_ARI_URL`, `ASTERISK_ARI_USER`, `ASTERISK_ARI_PASS`, `VOIP_WSS_URL`, `TURN_SECRET`, `TURN_URLS` (hardcode নয়)।

---

## SECTION F: ক্রম সুপারিশ (recommended execution order)

1. **Phase 2 (Django voip/ skeleton)** — server install ছাড়াই শুরু করা যায়, কোনো prod ঝুঁকি নেই। ✅ নিরাপদ প্রথম ধাপ।
2. **Phase 1 (Asterisk + coturn)** — server setup।
3. **Phase 3 (ARI listener)** — logging চালু।
4. **Phase 4 (React softphone)** — admin দিক end-to-end।
5. **Phase 5 (mobile)** — client দিক।
6. **Phase 6 (hardening)** — production-ready।

> পরবর্তী agent/session: এই ডকুমেন্টের checkbox আপডেট করুন এবং `ai.md` Section 14-এ work log entry যোগ করুন।
