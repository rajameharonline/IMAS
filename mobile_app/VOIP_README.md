# Mobile App — VoIP (WebRTC কল) সংযোজন

ক্লায়েন্ট অ্যাপে app-to-app ভয়েস কল (admin panel → client app)। সম্পূর্ণ প্রসঙ্গ: `../VOIP_PLAN.md`।

## ⚠️ গুরুত্বপূর্ণ: Expo Go-তে চলবে না

`react-native-webrtc` একটি **native module** — তাই **Expo Go সাপোর্ট করে না**। VoIP টেস্ট/ব্যবহার করতে
**dev build বা preview APK** লাগবে (EAS Build)। বাকি ফিচার আগের মতোই Expo Go-তে চলবে, শুধু কল অংশ নয়।

## কী যোগ হয়েছে

| ফাইল | কাজ |
|---|---|
| `src/services/sipPhone.js` | sip.js + react-native-webrtc softphone (register/call/answer/hangup/mute) |
| `src/context/CallContext.js` | login হলে SIP register; incoming/outgoing state |
| `src/screens/call/CallScreen.js` | full-screen incoming/active কল UI (Modal) |
| `App.js` | `CallProvider` + `CallScreen` root-এ |
| `app.json` | `@config-plugins/react-native-webrtc` plugin + RECORD_AUDIO/mic permission |
| package.json | `react-native-webrtc`, `@config-plugins/react-native-webrtc`, `sip.js` |

creds আসে: `GET /api/v1/app/voip/sip-credentials/` (JWT — client নিজের `client_<id>` endpoint)।

## Build ও টেস্ট

```bash
cd mobile_app
# ১) প্রথমবার বা native dep বদলালে — preview APK build
eas build --platform android --profile preview
# ২) APK ফোনে install → client হিসেবে login
# ৩) admin panel-এ ওই client-এর profile → "কল করুন" → ফোনে CallScreen ring করবে
```

> dev iteration-এর জন্য: `eas build --profile development` (dev client) + `npx expo start --dev-client`।

## এখন যা কাজ করে / যা বাকি

- ✅ অ্যাপ **foreground/খোলা** থাকলে: admin কল করলে CallScreen-এ ring → answer → দুমুখী audio।
- ✅ অ্যাপ থেকে register (login-এ স্বয়ংক্রিয়)।
- ⏳ **App বন্ধ থাকলে ring (background wake)** — FCM push + `react-native-callkeep` দরকার (পরের ধাপ)।
  এখন অ্যাপ খোলা/recent থাকলেই কল আসে; OS অ্যাপ kill করলে আসবে না।
- ⏳ অডিও routing (earpiece/speaker/proximity) — `react-native-incall-manager` যোগ করলে উন্নত হবে।
- ⏳ client→office "কল করুন" বাটন (incoming-ই মূল flow; outgoing helper `startCall` প্রস্তুত)।

## ⚠️ Version gotcha (EAS build fail হলে)

`@config-plugins/react-native-webrtc`-এর ভার্সন **Expo SDK-এর সাথে মিলতে হবে** (peer `expo`):
- SDK **54** → `@config-plugins/react-native-webrtc@13.0.0` (peer `expo@^54`) ✅
- SDK 55 → v14 ; SDK 56 → v15
ভুল ভার্সনে `npm ci` ERESOLVE করে EAS build "Install dependencies"-এ ফেল করে। এছাড়া `.npmrc`-এ
`legacy-peer-deps=true` আছে (React 19 peer warning-এ npm ci যেন না আটকায়)।

## Troubleshooting

- **কল আসে না:** ফোনে mic permission দিন; অ্যাপ dev/preview build কিনা নিশ্চিত করুন (Expo Go নয়)।
- **register হয় না:** `/app/voip/sip-credentials/` `enabled:true` ও `wss_url` দিচ্ছে কিনা; firewall 8089 খোলা কিনা।
- **audio আসে না কিন্তু connect হয়:** TURN (coturn) creds/পোর্ট; NAT হলে Asterisk external address।
