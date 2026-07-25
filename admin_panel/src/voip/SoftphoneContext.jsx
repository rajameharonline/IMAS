// WebRTC softphone — SIP.js দিয়ে Asterisk-এ WSS register করে app-to-app কল করে।
// creds আসে JWT-auth করা /voip/sip-credentials/ থেকে (ephemeral — frontend-এ static নয়)।
// বিস্তারিত: VOIP_PLAN.md Phase 4। কল হিস্ট্রি Phase 3 (ARI listener) লেখে।
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  UserAgent, Registerer, RegistererState, Inviter, SessionState,
} from 'sip.js';
import api from '../utils/api';

const SoftphoneContext = createContext(null);
export const useSoftphone = () => useContext(SoftphoneContext);

export function SoftphoneProvider({ children }) {
  const uaRef         = useRef(null);
  const registererRef = useRef(null);
  const sessionRef    = useRef(null);
  const audioRef      = useRef(null);   // remote অডিও element
  const credsRef      = useRef(null);

  // status: disabled | connecting | registered | failed
  const [status, setStatus] = useState('connecting');
  // call: null | { direction, peer, displayName, state, muted, startedAt }
  const [call, setCall]     = useState(null);

  // ── init: creds নিয়ে UserAgent তৈরি + register ──────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/voip/sip-credentials/');
        if (cancelled) return;
        if (!data.enabled || !data.wss_url) { setStatus('disabled'); return; }
        credsRef.current = data;

        const ua = new UserAgent({
          uri: UserAgent.makeURI(`sip:${data.sip_user}@${data.sip_domain}`),
          transportOptions: { server: data.wss_url },
          authorizationUsername: data.sip_user,
          authorizationPassword: data.sip_pass,
          delegate: { onInvite: (invitation) => wireSession(invitation, {
            direction: 'inbound',
            peer: invitation.remoteIdentity?.uri?.user || 'unknown',
            displayName: invitation.remoteIdentity?.displayName
                         || invitation.remoteIdentity?.uri?.user || 'Incoming',
          }) },
          sessionDescriptionHandlerFactoryOptions: {
            peerConnectionConfiguration: { iceServers: data.ice_servers || [] },
            constraints: { audio: true, video: false },
          },
        });
        uaRef.current = ua;
        await ua.start();
        if (cancelled) { ua.stop(); return; }

        const reg = new Registerer(ua);
        registererRef.current = reg;
        reg.stateChange.addListener((s) => {
          if (s === RegistererState.Registered) setStatus('registered');
          else if (s === RegistererState.Unregistered) setStatus('failed');
        });
        await reg.register();
      } catch {
        if (!cancelled) setStatus('failed');
      }
    })();
    return () => { cancelled = true; cleanup(); };
  }, []);

  // ── remote অডিও attach (established হলে) ─────────────────────────────────────
  function setupRemoteAudio(session) {
    const pc = session.sessionDescriptionHandler?.peerConnection;
    if (!pc || !audioRef.current) return;
    const remote = new MediaStream();
    pc.getReceivers().forEach((r) => r.track && remote.addTrack(r.track));
    audioRef.current.srcObject = remote;
    audioRef.current.play().catch(() => {});
  }

  // ── একটি session-এর state পরিবর্তন UI-তে map করি ────────────────────────────
  function wireSession(session, info) {
    if (sessionRef.current) {
      // অন্য কল চললে নতুন incoming reject
      if (typeof session.reject === 'function') session.reject().catch(() => {});
      return;
    }
    sessionRef.current = session;
    setCall({ ...info, state: session.state, muted: false, startedAt: null });
    session.stateChange.addListener((state) => {
      setCall((c) => {
        if (!c) return c;
        const next = { ...c, state };
        if (state === SessionState.Established && !c.startedAt) next.startedAt = Date.now();
        return next;
      });
      if (state === SessionState.Established) setupRemoteAudio(session);
      if (state === SessionState.Terminated) { sessionRef.current = null; setCall(null); }
    });
  }

  // ── outbound কল (client_<id> / agent_<id>) ──────────────────────────────────
  const startCall = useCallback(async (target, displayName) => {
    if (status !== 'registered' || !uaRef.current) {
      alert('Softphone এখনো register হয়নি।'); return;
    }
    if (sessionRef.current) { alert('আগের একটি কল চলছে।'); return; }
    const inviter = new Inviter(
      uaRef.current,
      UserAgent.makeURI(`sip:${target}@${credsRef.current.sip_domain}`),
      { sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } } },
    );
    wireSession(inviter, { direction: 'outbound', peer: target, displayName: displayName || target });
    try {
      await inviter.invite();
    } catch {
      sessionRef.current = null; setCall(null);
      alert('কল শুরু করা যায়নি।');
    }
  }, [status]);

  // ── incoming কল accept ──────────────────────────────────────────────────────
  const answer = useCallback(async () => {
    const s = sessionRef.current;
    if (s && typeof s.accept === 'function'
        && (s.state === SessionState.Initial || s.state === SessionState.Establishing)) {
      await s.accept({ sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } } });
    }
  }, []);

  // ── hangup / cancel / reject (state অনুযায়ী) ────────────────────────────────
  const hangup = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    try {
      if (s.state === SessionState.Established) await s.bye();
      else if (typeof s.cancel === 'function' && s.state === SessionState.Establishing) await s.cancel();
      else if (typeof s.reject === 'function') await s.reject();
      else if (typeof s.cancel === 'function') await s.cancel();
    } catch { /* ignore */ }
    sessionRef.current = null; setCall(null);
  }, []);

  // ── mute toggle (mic track) ─────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    const s = sessionRef.current;
    const pc = s?.sessionDescriptionHandler?.peerConnection;
    if (!pc) return;
    let muted = false;
    pc.getSenders().forEach((sender) => {
      if (sender.track && sender.track.kind === 'audio') {
        sender.track.enabled = !sender.track.enabled;
        muted = !sender.track.enabled;
      }
    });
    setCall((c) => (c ? { ...c, muted } : c));
  }, []);

  function cleanup() {
    try { sessionRef.current?.bye?.(); } catch { /* ignore */ }
    try { registererRef.current?.unregister?.(); } catch { /* ignore */ }
    try { uaRef.current?.stop?.(); } catch { /* ignore */ }
  }

  return (
    <SoftphoneContext.Provider value={{ status, call, startCall, answer, hangup, toggleMute }}>
      {children}
      {/* remote অডিও — সবসময় DOM-এ থাকে */}
      <audio ref={audioRef} autoPlay hidden />
    </SoftphoneContext.Provider>
  );
}
