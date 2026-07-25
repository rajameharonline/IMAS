// Incoming/active কল overlay — নেটিভ ফোন অ্যাপের মতো full-screen in-call UI।
// call থাকলেই দেখায় (CallKeep/AppState gate নেই — gate foreground-এ answer button লুকাত)।
import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Vibration, Platform } from 'react-native';

import { useCall } from '../../context/CallContext';

const ESTABLISHED = 'Established';
const TERMINATED = 'Terminated';

function Timer({ active }) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!active) { setS(0); return undefined; }
    const id = setInterval(() => setS((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return <Text style={styles.timer}>{active ? `${mm}:${ss}` : ' '}</Text>;
}

// call → প্রদর্শনের নাম + নম্বর/সাবটাইটেল।
function resolvePeer(call) {
  const peer = call.peer || '';
  if (call.direction === 'inbound') {
    // আসল caller নাম (FCM caller_name → callKeepState → call.displayName) অগ্রাধিকার;
    // নইলে agent_/raw endpoint হলে generic 'অফিস', নইলে peer।
    const name = call.displayName
      || (/^(agent_|client_)/.test(peer) ? 'অফিস' : (peer || 'কল'));
    return { name, sub: 'ইনকামিং কল' };
  }
  const name = call.displayName || peer || 'কল';
  // displayName থাকলে (আসল নাম) আর peer নম্বর হলে নম্বরটা সাবটাইটেলে; নইলে 'VoIP কল'
  // (নাম-নম্বর duplicate এড়াতে — যেমন extension 103 ডায়াল করলে দুবার 103 দেখাবে না)।
  const sub = (call.displayName && /^\d+$/.test(peer)) ? peer : 'VoIP কল';
  return { name, sub };
}

// একটি গ্রিড অ্যাকশন বাটন (আইকন + লেবেল)। active=সবুজ, disabled=ম্লান।
function GridBtn({ icon, label, onPress, active, disabled }) {
  return (
    <TouchableOpacity
      style={styles.gridCol}
      onPress={disabled ? undefined : onPress}
      activeOpacity={disabled ? 1 : 0.7}
      disabled={disabled}
    >
      <View style={[styles.gridBtn, active && styles.gridBtnActive, disabled && styles.gridBtnDim]}>
        <Text style={[styles.gridIcon, disabled && { opacity: 0.4 }]}>{icon}</Text>
      </View>
      <Text style={[styles.gridLabel, disabled && { opacity: 0.4 }, active && { color: '#22c55e' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function CallScreen() {
  const cc = useCall();
  const [showPad, setShowPad] = useState(false);
  const [dtmf, setDtmf] = useState('');
  if (!cc || !cc.call) return null;
  const { call, answer, hangup, toggleMute, toggleSpeaker, speakerOn, sendDtmf } = cc;

  const incoming = call.direction === 'inbound'
    && call.state !== ESTABLISHED && call.state !== TERMINATED;
  const established = call.state === ESTABLISHED;
  const { name, sub } = resolvePeer(call);
  const initial = (name.match(/[A-Za-z0-9]/)?.[0] || '📞').toUpperCase();

  const statusText = incoming ? 'ইনকামিং কল…' : established ? '' : 'কল করা হচ্ছে…';

  const pressDtmf = (d) => {
    if (Platform.OS === 'android') Vibration.vibrate(14);
    setDtmf((p) => (p + d).slice(-20));
    sendDtmf?.(d);
  };

  const PAD = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['*', '0', '#']];

  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent>
      <View style={styles.bg}>

        {/* ── উপরে: caller তথ্য ── */}
        <View style={styles.top}>
          <Text style={styles.statusTop}>{statusText}</Text>
          <View style={styles.avatar}>
            <Text style={styles.avatarTxt}>{initial}</Text>
          </View>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <Text style={styles.sub} numberOfLines={1}>{sub}</Text>
          <Timer active={established} />
        </View>

        {/* ── নিচে: কন্ট্রোল ── */}
        {incoming ? (
          /* ইনকামিং — Accept / Reject */
          <View style={styles.incomingRow}>
            <View style={styles.incCol}>
              <TouchableOpacity style={[styles.roundBig, styles.reject]} onPress={hangup} activeOpacity={0.85}>
                <Text style={styles.roundIcon}>📞</Text>
              </TouchableOpacity>
              <Text style={styles.incLabel}>প্রত্যাখ্যান</Text>
            </View>
            <View style={styles.incCol}>
              <TouchableOpacity style={[styles.roundBig, styles.accept]} onPress={answer} activeOpacity={0.85}>
                <Text style={styles.roundIcon}>📞</Text>
              </TouchableOpacity>
              <Text style={styles.incLabel}>উত্তর দিন</Text>
            </View>
          </View>
        ) : (
          <View style={styles.bottom}>
            {/* DTMF প্যাড (Keypad চাপলে) */}
            {showPad ? (
              <View style={styles.padWrap}>
                <Text style={styles.padDisplay} numberOfLines={1}>{dtmf || ' '}</Text>
                {PAD.map((row, ri) => (
                  <View key={ri} style={styles.padRow}>
                    {row.map((d) => (
                      <TouchableOpacity key={d} style={styles.padKey} onPress={() => pressDtmf(d)} activeOpacity={0.6}>
                        <Text style={styles.padKeyTxt}>{d}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ))}
                <TouchableOpacity style={styles.padClose} onPress={() => setShowPad(false)} activeOpacity={0.7}>
                  <Text style={styles.padCloseTxt}>লুকান</Text>
                </TouchableOpacity>
              </View>
            ) : (
              /* অ্যাকশন গ্রিড — প্রজেক্ট-প্রাসঙ্গিক ৩টি কার্যকর বাটন */
              <View style={styles.card}>
                <View style={styles.gridRow}>
                  <GridBtn icon="🔊" label="স্পিকার" onPress={toggleSpeaker} active={speakerOn} />
                  <GridBtn icon={call.muted ? '🔇' : '🎙️'} label={call.muted ? 'আনমিউট' : 'মিউট'} onPress={toggleMute} active={call.muted} />
                  <GridBtn icon="🔢" label="কীপ্যাড" onPress={() => setShowPad(true)} />
                </View>
              </View>
            )}

            {/* লাল hangup */}
            <TouchableOpacity style={[styles.roundBig, styles.end]} onPress={hangup} activeOpacity={0.85}>
              <Text style={styles.roundIcon}>📞</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#0c1424', justifyContent: 'space-between', paddingTop: 70, paddingBottom: 44 },

  /* উপরের caller অংশ */
  top: { alignItems: 'center', gap: 8, paddingHorizontal: 24 },
  statusTop: { color: '#94a3b8', fontSize: 14, letterSpacing: 0.5, marginBottom: 14, minHeight: 18 },
  avatar: {
    width: 112, height: 112, borderRadius: 56, backgroundColor: '#1e3a5f',
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
    borderWidth: 2, borderColor: 'rgba(34,197,94,0.4)',
  },
  avatarTxt: { color: '#e2e8f0', fontSize: 46, fontWeight: '700' },
  name: { color: '#fff', fontSize: 26, fontWeight: '700', maxWidth: '90%' },
  sub: { color: '#94a3b8', fontSize: 15, fontWeight: '500' },
  timer: { color: '#7dd3fc', fontSize: 17, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', marginTop: 6 },

  /* নিচের কন্ট্রোল */
  bottom: { alignItems: 'center', gap: 26 },
  card: {
    backgroundColor: 'rgba(30,41,59,0.55)', borderRadius: 28, paddingVertical: 22,
    paddingHorizontal: 16, marginHorizontal: 18, gap: 18, width: '88%',
  },
  gridRow: { flexDirection: 'row', justifyContent: 'space-around' },
  gridCol: { alignItems: 'center', gap: 7, width: 92 },
  gridBtn: {
    width: 58, height: 58, borderRadius: 29, backgroundColor: 'rgba(148,163,184,0.16)',
    alignItems: 'center', justifyContent: 'center',
  },
  gridBtnActive: { backgroundColor: 'rgba(34,197,94,0.22)', borderWidth: 1.5, borderColor: 'rgba(34,197,94,0.55)' },
  gridBtnDim: { backgroundColor: 'rgba(148,163,184,0.07)' },
  gridIcon: { fontSize: 24 },
  gridLabel: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },

  /* DTMF প্যাড */
  padWrap: { alignItems: 'center', gap: 12, width: '82%' },
  padDisplay: { color: '#7dd3fc', fontSize: 26, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', letterSpacing: 3, minHeight: 34 },
  padRow: { flexDirection: 'row', gap: 26 },
  padKey: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(148,163,184,0.14)',
    alignItems: 'center', justifyContent: 'center',
  },
  padKeyTxt: { color: '#fff', fontSize: 26, fontWeight: '600' },
  padClose: { marginTop: 4, paddingVertical: 8, paddingHorizontal: 22, borderRadius: 18, backgroundColor: 'rgba(148,163,184,0.14)' },
  padCloseTxt: { color: '#cbd5e1', fontSize: 14, fontWeight: '700' },

  /* বড় গোল বাটন (accept/reject/end) */
  roundBig: {
    width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },
  roundIcon: { fontSize: 30, color: '#fff' },
  end: { backgroundColor: '#dc2626' },
  accept: { backgroundColor: '#16a34a' },
  reject: { backgroundColor: '#dc2626', transform: [{ rotate: '135deg' }] },

  /* ইনকামিং সারি */
  incomingRow: { flexDirection: 'row', justifyContent: 'space-evenly', paddingHorizontal: 30 },
  incCol: { alignItems: 'center', gap: 10 },
  incLabel: { color: '#cbd5e1', fontSize: 14, fontWeight: '600' },
});
