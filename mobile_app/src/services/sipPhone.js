// ক্লায়েন্ট অ্যাপের WebRTC softphone — react-native-webrtc + sip.js।
// ⚠️ react-native-webrtc native module — Expo Go-তে চলবে না; EAS dev/preview build লাগবে।
// registerGlobals() RTCPeerConnection/mediaDevices ইত্যাদি global করে দেয়, যাতে sip.js
// (ব্রাউজার-মুখী লাইব্রেরি) RN-এ কাজ করে।
import { registerGlobals } from 'react-native-webrtc';
registerGlobals();

import {
  UserAgent, Registerer, RegistererState, Inviter, SessionState, TransportState,
} from 'sip.js';

// অডিও routing (earpiece/speaker + MODE_IN_COMMUNICATION)। কল connect হলে এটা চালু
// না করলে react-native-webrtc-এর remote audio ডিভাইসে route হয় না → RTP দুদিকে
// গেলেও কোনো শব্দ শোনা যায় না। এখানে (singleton-এর কোরে) রাখলে foreground (CallContext),
// background (messaging/CallKeep) — সব path-এই গ্যারান্টিড চালু হয়। guarded require।
let _ICM = null;
try { const m = require('react-native-incall-manager'); _ICM = m?.default || m || null; } catch { _ICM = null; }

// একটিমাত্র instance (singleton) — পুরো অ্যাপে একটাই registration।
class SipPhone {
  constructor() {
    this.ua = null;
    this.registerer = null;
    this.session = null;
    this.creds = null;
    this.handlers = {};        // { onStatus, onIncoming, onState, onError }
    this.stopped = false;      // destroy() হলে আর reconnect নয়
    this.reconnecting = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.statusTimer = null;   // registration status reconciler interval
  }

  // creds: { sip_user, sip_pass, wss_url, sip_domain, ice_servers, enabled }
  async init(creds, handlers = {}) {
    this.handlers = handlers;
    this.creds = creds;
    this.stopped = false;
    if (!creds?.enabled || !creds?.wss_url) {
      this._status('disabled');
      return;
    }
    const ua = new UserAgent({
      uri: UserAgent.makeURI(`sip:${creds.sip_user}@${creds.sip_domain}`),
      // transportOptions: শুধু server। (keepAliveInterval সরানো হয়েছে — এটা
      // registration চলাকালীন কিছু নেটওয়ার্কে transport flap ঘটাচ্ছিল → অ্যাপ
      // "সংযোগ হচ্ছে"-তে আটকে যেত।)
      transportOptions: { server: creds.wss_url },
      authorizationUsername: creds.sip_user,
      authorizationPassword: creds.sip_pass,
      delegate: { onInvite: (invitation) => this._onIncoming(invitation) },
      sessionDescriptionHandlerFactoryOptions: {
        peerConnectionConfiguration: { iceServers: creds.ice_servers || [] },
        // ICE gathering timeout। ৩০০০ms ছিল — কিন্তু মোবাইল নেটওয়ার্কে TURN relay
        // candidate gather হতে এর চেয়ে বেশি সময় লাগে, ফলে relay-হীন SDP যেত →
        // দুই CGNAT মোবাইল + NAT-এর পেছনের Asterisk-এ কোনো ICE pair connect হতো না
        // → bridge হলেও RTP প্রবাহিত হতো না (no audio)। ৬০০০ms দিলে relay candidate
        // gather হওয়ার সুযোগ থাকে; gathering আগে শেষ হলে এর আগেই offer/answer যায়।
        iceGatheringTimeout: 6000,
        constraints: { audio: true, video: false },
      },
    });
    this.ua = ua;

    // transport অপ্রত্যাশিতভাবে বিচ্ছিন্ন হলে (network বদল/সাসপেন্ড) auto-reconnect।
    ua.transport.stateChange.addListener((st) => {
      if (st === TransportState.Disconnected && !this.stopped) {
        this._status('failed');
        this._scheduleReconnect();
      }
    });

    this._status('connecting');
    try {
      await ua.start();            // WSS transport connect — fail হলে এখানে throw
      const reg = new Registerer(ua);
      this.registerer = reg;
      reg.stateChange.addListener((s) => {
        if (s === RegistererState.Registered) {
          this.reconnectAttempt = 0;
          this._status('registered');
        } else if (s === RegistererState.Unregistered) {
          this._status('failed');
        }
      });
      await reg.register();
      this._startStatusSync();   // Registered ইভেন্ট মিস হলেও UI sync রাখে
    } catch (e) {
      // আসল কারণ ধরে রাখি — silent fail নয়, যাতে কেন register হলো না দেখা যায়।
      const msg = (e && (e.message || e.toString())) || 'unknown';
      // eslint-disable-next-line no-console
      console.warn('[sipPhone] register failed:', msg, e);
      this.handlers.onError?.(msg);
      this._status('failed');
      this._scheduleReconnect();   // প্রথম attempt fail হলেও পরে চেষ্টা চালিয়ে যাই
    }
  }

  // ── auto-reconnect: exponential backoff (২s→অনুর্ধ্ব ৬s), destroy পর্যন্ত ────
  // max ৬s রাখা হয়েছে (আগে ৩০s) — ISP অ্যাপে "সবসময় online" দরকার, তাই দীর্ঘ
  // backoff-এ down-window grace (15s) ছাড়িয়ে "সংযোগ হচ্ছে" flicker দেখাত। ৬s-এ
  // দ্রুত re-register হয় → blip grace-এর ভেতরেই মাস্ক হয়, UI স্থির "অনলাইন" থাকে।
  _scheduleReconnect() {
    if (this.stopped || this.reconnecting || this.reconnectTimer) return;
    const delay = Math.min(2000 * 2 ** this.reconnectAttempt, 6000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnect();
    }, delay);
  }

  // transport reconnect + পুনরায় register। AppState 'active' হলেও (CallContext) ডাকা হয়।
  async reconnect() {
    if (this.stopped || this.reconnecting || !this.ua) return;
    this.reconnecting = true;
    this._status('connecting');
    try {
      if (this.ua.transport.state !== TransportState.Connected) {
        await this.ua.reconnect();          // WSS আবার তুলি
      }
      if (this.registerer) await this.registerer.register();  // আবার register
      else {
        const reg = new Registerer(this.ua);
        this.registerer = reg;
        reg.stateChange.addListener((s) => {
          if (s === RegistererState.Registered) { this.reconnectAttempt = 0; this._status('registered'); }
          else if (s === RegistererState.Unregistered) this._status('failed');
        });
        await reg.register();
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[sipPhone] reconnect failed:', e?.message || e);
      this._status('failed');
      this.reconnecting = false;
      this._scheduleReconnect();            // আবার চেষ্টা
      return;
    }
    this.reconnecting = false;
  }

  // ── FCM incoming-call wake: পেন্ডিং backoff বাতিল করে এখনই দ্রুত register ──────
  // কেন: killed/background-এ FCM এলে register দরকার তৎক্ষণাৎ (server dialplan ~৬০s
  // window-এ ধরা পড়তে)। আগে শুধু reconnect() ডাকা হতো — কিন্তু আগের ব্যর্থতায়
  // exponential backoff বড় (≤৩০s) delay-এ আটকে থাকতে পারত, তখন এই কল মিস হতো।
  // এটা পেন্ডিং timer clear করে, attempt counter রিসেট করে, সঙ্গে সঙ্গে reconnect চালায়।
  // নিরাপদ: শুধু একটি immediate reconnect — কোনো নতুন churn loop নয়।
  wakeRegister() {
    if (this.stopped || !this.ua) return;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.reconnectAttempt = 0;
    this.reconnect();
  }

  // Hard reset — পুরনো UserAgent পুরোপুরি ধ্বংস করে একদম নতুন বানায় (অ্যাপ reopen
  // করলে যা হয়, তাই)। কেন: vivo/aggressive ROM-এ কল-শেষে transport এমন ভাবে ভাঙে যে
  // ua.reconnect() আর তোলে না (reopen ছাড়া ঠিক হতো না)। এই method সেই reopen-কে
  // programmatically করে — creds/handlers singleton-এ আছে বলে আবার init() চালানো যায়।
  async hardReset() {
    if (this.stopped || !this.creds || this.reconnecting) return;
    this.reconnecting = true;
    this._status('connecting');
    try { this.registerer?.unregister?.(); } catch { /* ignore */ }
    try { this.ua?.stop?.(); } catch { /* ignore */ }
    this.ua = this.registerer = this.session = null;
    this.reconnecting = false;
    try {
      await this.init(this.creds, this.handlers);   // একদম নতুন UA — reopen-এর মতো
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[sipPhone] hardReset failed:', e?.message || e);
    }
  }

  // outbound (client→agent, বা staff→client)। displayName থাকলে UI-তে নাম দেখায়।
  async call(target, displayName) {
    if (!this.ua || this.session) return;
    const inviter = new Inviter(
      this.ua,
      UserAgent.makeURI(`sip:${target}@${this.creds.sip_domain}`),
      { sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } } },
    );
    this._wire(inviter, { direction: 'outbound', peer: target, displayName: displayName || target });
    try {
      await inviter.invite();
    } catch (e) {
      // invite fail (যেমন caller-এ mic permission নেই → getUserMedia throw, বা SDP/ICE) →
      // কল সাথে সাথে কেটে যেত নীরবে; এখন কারণ লগ + onError-এ দেখাই।
      // eslint-disable-next-line no-console
      console.warn('[sipPhone] outbound invite failed:', e?.message || e);
      this.handlers.onError?.('call-failed: ' + (e?.message || e));
      this._end();
    }
  }

  async answer() {
    const s = this.session;
    if (s && typeof s.accept === 'function'
        && (s.state === SessionState.Initial || s.state === SessionState.Establishing)) {
      try {
        await s.accept({
          sessionDescriptionHandlerOptions: {
            constraints: { audio: true, video: false },
            // relay candidate gather-এর জন্য যথেষ্ট সময় (init-এর factory option-এর সাথে মিল)।
            iceGatheringTimeout: 6000,
          },
        });
      } catch (e) {
        // accept fail (যেমন mic permission নেই → getUserMedia throw) → 200 OK যায় না।
        // silent hang না করে কল কেটে দিই + error দেখাই।
        // eslint-disable-next-line no-console
        console.warn('[sipPhone] answer/accept failed:', e?.message || e);
        this.handlers.onError?.('answer-failed: ' + (e?.message || e));
        this.hangup();
      }
    }
  }

  async hangup() {
    const s = this.session;
    if (!s) return;
    try {
      if (s.state === SessionState.Established) await s.bye();
      else if (typeof s.cancel === 'function' && s.state === SessionState.Establishing) await s.cancel();
      else if (typeof s.reject === 'function') await s.reject();
      else if (typeof s.cancel === 'function') await s.cancel();
    } catch { /* ignore */ }
    this._end();
  }

  setMuted(muted) {
    const pc = this.session?.sessionDescriptionHandler?.peerConnection;
    if (!pc) return;
    pc.getSenders().forEach((sender) => {
      if (sender.track && sender.track.kind === 'audio') sender.track.enabled = !muted;
    });
  }

  // foreground-service task থেকে প্রতি কয়েক সেকেন্ডে ডাকা হয় — transport/registration
  // মরে গেলে reconnect। background-এও (FGS task-এ) চলে বলে main JS throttle হলেও
  // সংযোগ জীবিত থাকে। কল চলাকালীন বা ইতিমধ্যে registered হলে কিছু করে না (disturb নয়)।
  ensureAlive() {
    if (this.stopped || !this.ua) return;
    // ⚠️ যেকোনো জীবন্ত/রিংিং session (Initial=ইনকামিং রিং, Establishing, Established)
    // থাকলে disturb নয় — নইলে answer করার আগেই ইনকামিং কল কেটে যেত।
    const s = this.session;
    if (s && s.state !== SessionState.Terminated) return;
    // শুধু Terminated (বাসি) session পরিষ্কার করি — নইলে reconnect আটকে reopen লাগত।
    if (s) { try { this._end(); } catch { /* ignore */ } }
    try {
      const transportOk = this.ua.transport?.state === TransportState.Connected;
      const regOk = this.registerer?.state === RegistererState.Registered;
      // down হলে hardReset (full re-init) — vivo-তে কল-শেষে ua.reconnect() তোলে না,
      // reopen-এর মতো নতুন UA-ই কাজ করে।
      if (!transportOk || !regOk) this.hardReset();
    } catch { try { this.hardReset(); } catch { /* ignore */ } }
  }

  // DTMF টোন পাঠায় (IVR/হটলাইন মেনুতে সংখ্যা চাপতে)।
  // react-native-webrtc 124-এ RTCDTMFSender.dtmf = null → RFC 4733 কাজ করে না।
  // strategy: SessionDialog.info() directly (session state check bypass) → session.info() →
  //           SDH sendDtmf fallback।
  sendDtmf(tone) {
    const t = String(tone);
    // ১ম চেষ্টা: SessionDialog.info() directly — session._dialog ব্যবহার করে
    // session.info() এ _state check pass হলেও dialog null/early হলে silently fail করে।
    // তাই dialog সরাসরি access করি।
    const dialog = this.session?._dialog ?? this.session?.dialog;
    if (dialog && !dialog.early) {
      try {
        dialog.info(undefined, {
          body: {
            contentDisposition: 'render',
            contentType: 'application/dtmf-relay',
            content: `Signal=${t}\r\nDuration=160`,
          },
        });
        return;
      } catch { /* dialog.info() fail → পরের fallback */ }
    }

    // ২য় চেষ্টা: session.info()
    if (this.session?.info) {
      try {
        this.session.info({
          requestOptions: {
            body: {
              contentDisposition: 'render',
              contentType: 'application/dtmf-relay',
              content: `Signal=${t}\r\nDuration=160`,
            },
          },
        }).catch?.(() => {});
      } catch { /* ignore */ }
    }

    // ৩য় চেষ্টা: RTCDTMFSender (RFC 4733) — browser WebRTC-তে কাজ করে
    try {
      const sdh = this.session?.sessionDescriptionHandler;
      const pc = sdh?.peerConnection;
      const sender = pc?.getSenders?.().find((s) => s.track && s.track.kind === 'audio');
      if (sender?.dtmf?.insertDTMF) { sender.dtmf.insertDTMF(t); return; }
      if (sdh?.sendDtmf) sdh.sendDtmf(t);
    } catch { /* ignore */ }
  }

  destroy() {
    this.stopped = true;                 // reconnect বন্ধ
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.statusTimer) { clearInterval(this.statusTimer); this.statusTimer = null; }
    try { this.session?.bye?.(); } catch { /* ignore */ }
    try { this.registerer?.unregister?.(); } catch { /* ignore */ }
    try { this.ua?.stop?.(); } catch { /* ignore */ }
    this.ua = this.registerer = this.session = null;
  }

  // ── Registration status reconciler ───────────────────────────────────────────
  // কিছু পরিবেশে Registerer-এর `Registered` ইভেন্ট UI-তে মিস হয় (race) → অ্যাপ
  // "সংযোগ হচ্ছে"-তে আটকে থাকে যদিও সার্ভারে registered (Asterisk OPTIONS qualify চলে)।
  // তাই প্রতি ৩s সরাসরি registerer.state পড়ে — Registered হলে status নিশ্চিত করি।
  // শুধু positive ('registered') emit করি; negative/reconnect আগের হ্যান্ডলারই সামলায়
  // (তাই কোনো churn নয়)। reconnect()-এ নতুন registerer-ও এই একই interval ধরবে।
  _startStatusSync() {
    if (this.statusTimer) return;   // ডবল interval নয়
    this.statusTimer = setInterval(() => {
      if (this.stopped) return;
      try {
        if (this.registerer && this.registerer.state === RegistererState.Registered) {
          this._status('registered');
        }
      } catch { /* ignore */ }
    }, 3000);
  }

  // ── internal ──────────────────────────────────────────────────────────────
  _status(s) { this.handlers.onStatus?.(s); }

  _onIncoming(invitation) {
    // আগের কল সত্যিই চলমান (Establishing/Established) হলে নতুন INVITE reject — busy।
    // কিন্তু this.session যদি বাসি হয় (আগের কল অস্বাভাবিকভাবে শেষ/"hold-এ আটকে" থাকায়
    // Terminated state কখনো আসেনি, তাই _end() চলেনি) তাহলে আগে reject করলে প্রতিটি
    // নতুন কল নীরবে কাটত — অ্যাপ force-restart ছাড়া আর কল ধরা যেত না। তাই বাসি session
    // পরিষ্কার করে নতুন কলটাই গ্রহণ করি।
    const s = this.session;
    if (s && (s.state === SessionState.Establishing || s.state === SessionState.Established)) {
      try { invitation.reject(); } catch { /* ignore */ } return;
    }
    if (s) { try { s.bye?.(); } catch { /* ignore */ } try { s.reject?.(); } catch { /* ignore */ } this._end(); }
    const peer = invitation.remoteIdentity?.uri?.user || 'Office';
    // INVITE From-এর display name (endpoint callerid থেকে আসা PBX নাম) — থাকলে UI-তে দেখাই।
    const displayName = invitation.remoteIdentity?.displayName || '';
    this._wire(invitation, { direction: 'inbound', peer, displayName });
    this.handlers.onIncoming?.({ peer });
  }

  _wire(session, info) {
    this.session = session;
    this.handlers.onState?.({ ...info, state: session.state });
    session.stateChange.addListener((state) => {
      this.handlers.onState?.({ ...info, state });
      // react-native-webrtc remote অডিও play করে — কিন্তু Android-এ ডিভাইসে route হতে
      // audio session communication mode-এ থাকতে হয়। কল connect হলেই চালু (সব path)।
      if (state === SessionState.Established) {
        try { _ICM?.start({ media: 'audio' }); } catch { /* ignore */ }
      }
      if (state === SessionState.Terminated) this._end();
    });
  }

  _end() {
    try { _ICM?.stop(); } catch { /* ignore */ }
    this.session = null;
    this.handlers.onState?.(null);
    // কল শেষ হলে সংযোগ মাঝে মাঝে ভেঙে যায় (transport flap/registrar)। ৩s পর
    // ensureAlive দিয়ে দ্রুত reconnect — ১৫s FGS-tick-এর জন্য অপেক্ষা না করেই
    // অনলাইন ফিরে আসে। (কল চলাকালীন হলে ensureAlive নিজেই কিছু করবে না।)
    if (!this.stopped) {
      try { clearTimeout(this._postCallTimer); } catch { /* ignore */ }
      this._postCallTimer = setTimeout(() => { try { this.ensureAlive(); } catch { /* ignore */ } }, 3000);
    }
  }
}

export default new SipPhone();
export { SessionState };
