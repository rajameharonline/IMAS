import { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Vibration,
  Platform, StatusBar, Image, Animated, TextInput, ScrollView, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useCall } from '../../context/CallContext';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';

const DEFAULT_SUPPORT_TARGET = '100';
const DEFAULT_SUPPORT_NAME   = 'ISP Support';

const KEYS = [
  [{ d: '1', s: '' },     { d: '2', s: 'ABC' },  { d: '3', s: 'DEF' }],
  [{ d: '4', s: 'GHI' }, { d: '5', s: 'JKL' },  { d: '6', s: 'MNO' }],
  [{ d: '7', s: 'PQRS'}, { d: '8', s: 'TUV' },  { d: '9', s: 'WXYZ'}],
  [{ d: '*', s: '' },     { d: '0', s: '+' },     { d: '#', s: '' }],
];

const STATUS_COLORS = {
  registered: '#22c55e',
  connecting: '#f59e0b',
  idle:       '#f59e0b',
  failed:     '#ef4444',
  disabled:   '#64748b',
};
const STATUS_LABELS = {
  registered: 'অনলাইন',
  connecting: 'সংযোগ হচ্ছে…',
  idle:       'সংযোগ হচ্ছে…',
  failed:     'সংযোগ হচ্ছে…',
  disabled:   'VoIP নিষ্ক্রিয়',
};

// একবার online হওয়ার পর সাময়িক blip-এ "connecting" না দেখিয়ে কত সেকেন্ড "online"
// ধরে রাখব (WhatsApp/IMO-র মতো)। এর বেশি down থাকলে তবেই connecting দেখায়।
const ONLINE_GRACE_MS = 18000;

// connecting/idle-এ call button-এ pulse animation
function usePulse(active) {
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) { anim.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1.12, duration: 700, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 1,    duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active]);
  return anim;
}

function DialKey({ digit, sub, onPress }) {
  return (
    <TouchableOpacity style={s.key} onPress={() => onPress(digit)} activeOpacity={0.55}>
      <Text style={s.keyDigit}>{digit}</Text>
      {sub ? <Text style={s.keySub}>{sub}</Text> : <View style={s.keySubSpacer} />}
    </TouchableOpacity>
  );
}

export default function DialPadScreen() {
  const { status, startCall, call, supportContacts, speakerOn, toggleSpeaker, toggleMute, hangup } = useCall();
  const { isClient } = useAuth();   // client → tab nav; staff/superadmin → back to panel
  const navigation = useNavigation();
  const [digits,      setDigits]      = useState('');
  const [companyLogo, setCompanyLogo] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [logoError,   setLogoError]   = useState(false);
  const insets = useSafeAreaInsets();

  // ── Dial / Client Search মোড (staff/admin/employee-এর জন্য; client app dial-only) ──
  const [mode,          setMode]          = useState('dial');   // 'dial' | 'search'
  const [searchQ,       setSearchQ]       = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [onlineClients, setOnlineClients] = useState(new Set());  // SIP-registered client endpoint
  const searchTimer = useRef(null);

  // search মোডে client online presence poll (১৫s) — কাকে কল করলে ধরবে দেখাতে
  useEffect(() => {
    if (isClient || mode !== 'search') return undefined;
    let active = true;
    const load = async () => {
      try {
        const r = await api.get('/voip/registered-clients/');
        if (active) setOnlineClients(new Set(r.data?.clients || []));
      } catch { /* silent */ }
    };
    load();
    const id = setInterval(load, 15000);
    return () => { active = false; clearInterval(id); };
  }, [mode, isClient]);

  const doSearch = useCallback(async (val) => {
    if (!val.trim()) { setSearchResults([]); return; }
    setSearchLoading(true);
    try {
      const r = await api.get(`/app/staff/clients/?search=${encodeURIComponent(val.trim())}&page=1`);
      setSearchResults(r.data?.results || []);
    } catch { setSearchResults([]); } finally { setSearchLoading(false); }
  }, []);

  const onSearchChange = useCallback((val) => {
    setSearchQ(val);
    clearTimeout(searchTimer.current);
    if (!val.trim()) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(() => doSearch(val), 350);
  }, [doSearch]);

  // ক্লায়েন্টকে কল — SIP endpoint = client_<id> (web SoftphoneDialer-এর মতো)
  const callClient = useCallback((c) => {
    if (!startCall || call) return;
    startCall(`client_${c.id}`, c.full_name || c.customer_id || `client_${c.id}`);
  }, [startCall, call]);

  const firstContact  = supportContacts?.[0];
  const supportTarget = firstContact?.endpoint || DEFAULT_SUPPORT_TARGET;
  const supportName   = firstContact?.name     || DEFAULT_SUPPORT_NAME;

  useEffect(() => {
    api.get('/app/config/').then(r => {
      setCompanyLogo(r.data?.company_logo || '');
      setCompanyName(r.data?.company_name || '');
      setLogoError(false);
    }).catch(() => {});
  }, []);

  const pressKey = useCallback(d => {
    if (Platform.OS === 'android') Vibration.vibrate(16);
    setDigits(prev => (prev.length < 15 ? prev + d : prev));
  }, []);

  const backspace = useCallback(() => {
    if (Platform.OS === 'android') Vibration.vibrate(16);
    setDigits(prev => prev.slice(0, -1));
  }, []);

  const handleCall = useCallback(() => {
    if (!startCall || call) return;
    // টাইপ করা নম্বর থাকলে সেটাই ডায়াল; নাহলে support hotline
    const target = digits.trim() || supportTarget;
    startCall(target);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call, startCall, supportContacts, digits]);

  // ── Smoothed/sticky online status (WhatsApp/IMO-র মতো) ──────────────────
  // একবার 'registered' হলে সাময়িক reconnect blip-এ "connecting" না দেখিয়ে
  // ONLINE_GRACE_MS পর্যন্ত "online" ধরে রাখি; এর বেশি down থাকলে তবেই connecting।
  const [displayStatus, setDisplayStatus] = useState(status);
  const everRegistered = useRef(false);
  const graceTimer = useRef(null);
  useEffect(() => {
    if (status === 'registered') {
      everRegistered.current = true;
      if (graceTimer.current) { clearTimeout(graceTimer.current); graceTimer.current = null; }
      setDisplayStatus('registered');
    } else if (status === 'disabled') {
      if (graceTimer.current) { clearTimeout(graceTimer.current); graceTimer.current = null; }
      setDisplayStatus('disabled');
    } else if (everRegistered.current) {
      // আগে অন্তত একবার online হয়েছিল → grace period-এ "online" ধরে রাখি
      if (!graceTimer.current) {
        graceTimer.current = setTimeout(() => {
          graceTimer.current = null;
          setDisplayStatus('connecting');   // দীর্ঘ সময় down → এবার connecting দেখাই
        }, ONLINE_GRACE_MS);
      }
    } else {
      // cold start — কখনো register হয়নি, তাই আসল status-ই দেখাই
      setDisplayStatus(status);
    }
    return undefined;
  }, [status]);
  useEffect(() => () => { if (graceTimer.current) clearTimeout(graceTimer.current); }, []);

  const isRegistered = displayStatus === 'registered';
  const isConnecting = displayStatus === 'connecting' || displayStatus === 'idle';
  const isFailed     = displayStatus === 'failed' || displayStatus === 'disabled';
  const inCall       = !!call;
  // grace-এ "online" দেখালে call button-ও সবুজ/সক্রিয় রাখি (WhatsApp-এর মতো);
  // আসল transport তখনো down থাকলে invite নিজেই দ্রুত fail করবে ও watchdog reconnect করবে
  const canCall      = isRegistered && !inCall;

  const dotColor   = STATUS_COLORS[displayStatus] || '#22c55e';
  const statusText = STATUS_LABELS[displayStatus] || displayStatus;

  // call চলাকালীন state text
  const callStateText = call
    ? call.state === 'Established'  ? 'কথা হচ্ছে…'
    : call.state === 'Establishing' ? 'কানেক্ট হচ্ছে…'
    : call.direction === 'outbound' ? 'রিং হচ্ছে…'
    : ''
    : '';

  // connecting state-এ call button pulse
  const pulseScale = usePulse(isConnecting && !inCall);

  const topPad = insets.top || (Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0);

  // call button-এর visual — state অনুযায়ী আলাদা
  const callBtnBg = canCall
    ? '#16a34a'                        // active → bright green
    : isConnecting
      ? 'rgba(22,163,74,0.35)'         // connecting → semi-transparent green
      : 'rgba(100,116,139,0.18)';      // failed/disabled → neutral gray

  const callBtnBorder = canCall
    ? 'rgba(255,255,255,0.15)'
    : isConnecting
      ? 'rgba(34,197,94,0.4)'
      : 'rgba(100,116,139,0.2)';

  const callBtnGlow = canCall ? 0.55 : isConnecting ? 0.2 : 0;

  return (
    <View style={[s.screen, { paddingTop: topPad }]}>
      <StatusBar barStyle="light-content" backgroundColor="#0c1a2e" />

      {/* ── Status chip ──────────────────────────────────────────── */}
      <View style={s.statusChip}>
        <View style={[s.statusDot, { backgroundColor: dotColor }]} />
        <Text style={[s.statusTxt, { color: dotColor }]}>{statusText}</Text>
      </View>

      {/* ── Logo + contact ───────────────────────────────────────── */}
      <View style={s.contactArea}>
        <View style={s.avatarOuter}>
          <View style={s.avatarInner}>
            {companyLogo && !logoError ? (
              <Image
                source={{ uri: companyLogo }}
                style={s.logoImg}
                resizeMode="contain"
                onError={() => setLogoError(true)}
              />
            ) : (
              <Text style={s.avatarFallback}>🎧</Text>
            )}
          </View>
          <View style={s.headsetBadge}>
            <Text style={s.headsetBadgeIcon}>🎧</Text>
          </View>
        </View>

        <Text style={s.companyName} numberOfLines={1}>
          {companyName || supportName}
        </Text>

        {/* হটলাইন নম্বর */}
        <View style={s.hotlineRow}>
          <Text style={s.hotlineIcon}>☎</Text>
          <Text style={s.hotlineLabel}>হটলাইন</Text>
          <View style={s.hotlineBadge}>
            <Text style={s.hotlineBadgeTxt}>{supportTarget}</Text>
          </View>
        </View>

        {/* কল চলাকালে state */}
        {inCall && callStateText ? (
          <View style={s.callStatePill}>
            <View style={s.callStateDot} />
            <Text style={s.callStateTxt}>{callStateText}</Text>
          </View>
        ) : null}
      </View>

      {/* ── Mode toggle: Dial | Client Search (staff/admin/employee only) ── */}
      {!isClient && !inCall && (
        <View style={s.modeRow}>
          <TouchableOpacity
            style={[s.modeBtn, mode === 'dial' && s.modeBtnActive]}
            onPress={() => setMode('dial')} activeOpacity={0.8}>
            <Text style={[s.modeTxt, mode === 'dial' && s.modeTxtActive]}>⌨ ডায়াল</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.modeBtn, mode === 'search' && s.modeBtnActive]}
            onPress={() => setMode('search')} activeOpacity={0.8}>
            <Text style={[s.modeTxt, mode === 'search' && s.modeTxtActive]}>🔍 ক্লায়েন্ট সার্চ</Text>
          </TouchableOpacity>
        </View>
      )}

      {mode === 'search' && !isClient && !inCall ? (
        /* ── Client Search মোড ── */
        <View style={s.searchWrap}>
          <View style={s.searchBox}>
            <Text style={s.searchIcon}>🔍</Text>
            <TextInput
              value={searchQ}
              onChangeText={onSearchChange}
              placeholder="নাম / কোড / নম্বর দিয়ে খুঁজুন"
              placeholderTextColor="#475569"
              style={s.searchInput}
              autoCorrect={false}
            />
            {searchLoading && <ActivityIndicator size="small" color="#22c55e" />}
          </View>
          <ScrollView style={s.searchList} keyboardShouldPersistTaps="handled">
            {searchQ.trim().length === 0 ? (
              <Text style={s.searchHint}>ক্লায়েন্ট খুঁজে কল করুন</Text>
            ) : !searchLoading && searchResults.length === 0 ? (
              <Text style={s.searchHint}>কোনো ক্লায়েন্ট পাওয়া যায়নি</Text>
            ) : (
              searchResults.map((c) => {
                const online = onlineClients.has(`client_${c.id}`);
                return (
                  <TouchableOpacity key={c.id} style={s.resultRow}
                    onPress={() => callClient(c)} activeOpacity={0.7}>
                    <View style={s.resultAvatar}>
                      <Text style={s.resultAvatarTxt}>{(c.full_name || '?')[0]?.toUpperCase()}</Text>
                      {/* WhatsApp-স্টাইল online dot */}
                      <View style={[s.onlineDot, { backgroundColor: online ? '#22c55e' : '#64748b' }]} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.resultName} numberOfLines={1}>{c.full_name || '—'}</Text>
                      <Text style={s.resultSub} numberOfLines={1}>
                        {online ? '🟢 অনলাইন' : (c.customer_id || c.id)}{!online && c.phone ? ` · ${c.phone}` : ''}
                      </Text>
                    </View>
                    <Text style={s.resultCall}>📞</Text>
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        </View>
      ) : (
        <>
          {/* ── Digit display ────────────────────────────────────────── */}
          <View style={s.displayWrap}>
            <View style={s.display}>
              <Text
                style={[s.displayTxt, !digits && s.displayPlaceholder]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {digits || (inCall ? '' : 'Support')}
              </Text>
              {digits.length > 0 && (
                <TouchableOpacity
                  onPress={backspace}
                  style={s.bsBtn}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Text style={s.bsIcon}>⌫</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* ── Keypad ───────────────────────────────────────────────── */}
          <View style={s.keypad}>
            {KEYS.map((row, ri) => (
              <View key={ri} style={s.keyRow}>
                {row.map(({ d, s: sub }) => (
                  <DialKey key={d} digit={d} sub={sub} onPress={pressKey} />
                ))}
              </View>
            ))}
          </View>

          {/* ── Call action ──────────────────────────────────────────── */}
          {/* কলের সময়: 🎤 মিউট | 📞 কাটুন (লাল) | 🔊 স্পিকার।
              কল না থাকলে: ✕ মুছুন | 📞 কল | 🔊 স্পিকার। */}
          <View style={s.actionsRow}>

        {inCall ? (
          <>
            {/* মিউট/আনমিউট — মাইক বন্ধ/চালু */}
            <View style={s.actionCol}>
              <TouchableOpacity
                style={[s.speakerBtn, call?.muted && s.muteBtnOn]}
                onPress={toggleMute}
                activeOpacity={0.7}
              >
                <Text style={[s.speakerIcon, call?.muted && { opacity: 1 }]}>
                  {call?.muted ? '🔇' : '🎙️'}
                </Text>
              </TouchableOpacity>
              <Text style={s.actionLabel}>{call?.muted ? 'আনমিউট' : 'মিউট'}</Text>
            </View>

            {/* কল কাটুন (লাল) */}
            <View style={s.actionCol}>
              <TouchableOpacity
                style={[s.callBtn, { backgroundColor: '#dc2626', borderColor: '#ef4444', shadowOpacity: 0.45 }]}
                onPress={hangup}
                activeOpacity={0.85}
              >
                <Text style={s.callIcon}>📞</Text>
              </TouchableOpacity>
              <Text style={s.actionLabel}>কাটুন</Text>
            </View>

            {/* স্পিকার (লাউড) — চালু হলে সবুজ */}
            <View style={s.actionCol}>
              <TouchableOpacity
                style={[s.speakerBtn, speakerOn && s.speakerBtnOn]}
                onPress={toggleSpeaker}
                activeOpacity={0.7}
              >
                <Text style={[s.speakerIcon, speakerOn && { opacity: 1 }]}>🔊</Text>
              </TouchableOpacity>
              <Text style={[s.actionLabel, speakerOn && { color: '#22c55e' }]}>স্পিকার</Text>
            </View>
          </>
        ) : (
          <>
        {/* বাতিল — টাইপ করা নম্বর মুছে দেয় */}
        <View style={s.actionCol}>
          <TouchableOpacity
            style={[s.cancelBtn, !digits && s.cancelBtnDim]}
            onPress={() => setDigits('')}
            disabled={!digits}
            activeOpacity={0.7}
          >
            <View style={s.xWrap}>
              <View style={[s.xBar, s.xBar1, !digits && { backgroundColor: '#475569' }]} />
              <View style={[s.xBar, s.xBar2, !digits && { backgroundColor: '#475569' }]} />
            </View>
          </TouchableOpacity>
        </View>

        {/* কল বাটন — connecting-এ pulse, disabled-এ semi-transparent */}
        <View style={s.actionCol}>
          <Animated.View style={{ transform: [{ scale: pulseScale }] }}>
            <TouchableOpacity
              style={[
                s.callBtn,
                {
                  backgroundColor: callBtnBg,
                  borderColor: callBtnBorder,
                  shadowOpacity: callBtnGlow,
                },
              ]}
              onPress={handleCall}
              disabled={!canCall}
              activeOpacity={0.85}
            >
              {isConnecting && !canCall ? (
                /* connecting indicator — তিনটি ডট */
                <View style={s.dotsRow}>
                  {[0, 1, 2].map(i => (
                    <View key={i} style={[s.dot, { opacity: 0.5 + i * 0.25 }]} />
                  ))}
                </View>
              ) : (
                <Text style={[s.callIcon, !canCall && { opacity: 0.5 }]}>📞</Text>
              )}
            </TouchableOpacity>
          </Animated.View>
        </View>

        {/* ডান পাশে — লাউড স্পিকার বাটন */}
        <View style={s.actionCol}>
          <TouchableOpacity
            style={[s.speakerBtn, speakerOn && s.speakerBtnOn]}
            onPress={toggleSpeaker}
            activeOpacity={0.7}
          >
            <Text style={[s.speakerIcon, speakerOn && { opacity: 1 }]}>🔊</Text>
          </TouchableOpacity>
        </View>
          </>
        )}
      </View>
        </>
      )}

      {/* ── Bottom navigation ── client → tab links; staff/superadmin → back to panel ── */}
      {isClient ? (
        <View style={[s.miniNav, { paddingBottom: insets.bottom || 8 }]}>
          {[
            { icon: '🏠', label: 'Home',    screen: 'Home' },
            { icon: '💵', label: 'Bills',   screen: 'Bills' },
            { icon: '🎫', label: 'Support', screen: 'Support' },
            { icon: '📨', label: 'SMS',     screen: 'SMS' },
          ].map(({ icon, label, screen }) => (
            <TouchableOpacity
              key={screen}
              style={s.miniNavItem}
              onPress={() => navigation.navigate(screen)}
              activeOpacity={0.7}
            >
              <Text style={s.miniNavIcon}>{icon}</Text>
              <Text style={s.miniNavLabel}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <View style={[s.staffBackBar, { paddingBottom: insets.bottom || 10 }]}>
          <TouchableOpacity style={s.staffBackBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
            <Text style={s.staffBackTxt}>‹ অ্যাডমিন প্যানেলে ফিরে যান</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

/* ─── Constants ─────────────────────────────────────────────────── */
const KEY_H   = 62;
const CALL_SZ = 70;
const CNCL_SZ = 52;

/* ─── Styles ─────────────────────────────────────────────────────── */
const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0c1a2e',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 0,
  },

  /* Status */
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-end',
    marginTop: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusTxt: { fontSize: 11.5, fontWeight: '600', letterSpacing: 0.3 },

  /* Contact */
  contactArea: {
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 12,
  },
  avatarOuter: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 2,
    borderColor: 'rgba(34,197,94,0.4)',
    backgroundColor: 'rgba(34,197,94,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    shadowColor: '#22c55e',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  avatarInner: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImg: { width: 54, height: 54 },
  avatarFallback: { fontSize: 28 },
  headsetBadge: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#16a34a',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#0c1a2e',
  },
  headsetBadgeIcon: { fontSize: 11 },
  companyName: {
    fontSize: 19,
    fontWeight: '800',
    color: '#f0f9ff',
    letterSpacing: 0.2,
    maxWidth: '88%',
    textAlign: 'center',
  },
  hotlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
  },
  hotlineIcon: { fontSize: 12, color: '#64748b' },
  hotlineLabel: { fontSize: 12, color: '#64748b', fontWeight: '500' },
  hotlineBadge: {
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.3)',
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 2,
  },
  hotlineBadgeTxt: { fontSize: 13, fontWeight: '800', color: '#4ade80', letterSpacing: 0.5 },

  callStatePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 7,
    backgroundColor: 'rgba(34,197,94,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
  },
  callStateDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' },
  callStateTxt: { fontSize: 12, fontWeight: '600', color: '#86efac' },

  /* Display */
  displayWrap: { width: '100%', marginBottom: 12 },
  display: {
    backgroundColor: '#071221',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(100,130,170,0.1)',
    paddingHorizontal: 18,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
  },
  displayTxt: {
    flex: 1,
    fontSize: 26,
    fontWeight: '700',
    color: '#7dd3fc',
    letterSpacing: 3,
    fontVariant: ['tabular-nums'],
  },
  displayPlaceholder: {
    color: 'rgba(125,211,252,0.2)',
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: 1,
  },
  bsBtn: { marginLeft: 8, padding: 4 },
  bsIcon: { fontSize: 18, color: '#475569' },

  /* Keypad */
  keypad: { width: '100%', gap: 6, marginBottom: 16 },
  keyRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  key: {
    flex: 1,
    height: KEY_H,
    borderRadius: 15,
    backgroundColor: 'rgba(30,58,90,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(100,130,170,0.1)',
    elevation: 2,
  },
  keyDigit: { fontSize: 22, fontWeight: '300', color: '#e2e8f0' },
  keySub:   { fontSize: 8.5, fontWeight: '700', color: '#475569', letterSpacing: 1.5, marginTop: 1 },
  keySubSpacer: { height: 11 },

  /* Actions */
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 12,
  },
  actionCol: { alignItems: 'center', gap: 7 },
  actionLbl: { fontSize: 11, fontWeight: '600', color: '#64748b', letterSpacing: 0.3 },
  actionLblDim: { opacity: 0.35 },

  /* Cancel */
  cancelBtn: {
    width: CNCL_SZ,
    height: CNCL_SZ,
    borderRadius: CNCL_SZ / 2,
    backgroundColor: 'rgba(239,68,68,0.13)',
    borderWidth: 1.5,
    borderColor: 'rgba(239,68,68,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnDim: {
    backgroundColor: 'rgba(71,85,105,0.12)',
    borderColor: 'rgba(71,85,105,0.18)',
  },

  /* Speaker button — নিরপেক্ষ base, on হলে সবুজ */
  speakerBtn: {
    width: CNCL_SZ, height: CNCL_SZ, borderRadius: CNCL_SZ / 2,
    backgroundColor: 'rgba(100,116,139,0.15)', borderWidth: 1.5,
    borderColor: 'rgba(148,163,184,0.3)', alignItems: 'center', justifyContent: 'center',
  },
  speakerBtnOn: {
    backgroundColor: 'rgba(34,197,94,0.18)',
    borderColor: 'rgba(34,197,94,0.5)',
  },
  /* মিউট চালু হলে লাল */
  muteBtnOn: {
    backgroundColor: 'rgba(239,68,68,0.18)',
    borderColor: 'rgba(239,68,68,0.5)',
  },
  speakerIcon: { fontSize: 20, opacity: 0.7 },
  /* কল-কন্ট্রোল বাটনের নিচে ছোট লেবেল */
  actionLabel: { color: '#94a3b8', fontSize: 11, fontWeight: '600', marginTop: 6 },

  /* Mode toggle (Dial / Client Search) */
  modeRow: {
    flexDirection: 'row', gap: 8, width: '100%', marginBottom: 12,
  },
  modeBtn: {
    flex: 1, paddingVertical: 9, borderRadius: 12, alignItems: 'center',
    backgroundColor: 'rgba(30,58,90,0.5)', borderWidth: 1, borderColor: 'rgba(100,130,170,0.12)',
  },
  modeBtnActive: { backgroundColor: '#16a34a', borderColor: 'rgba(34,197,94,0.5)' },
  modeTxt: { fontSize: 13, fontWeight: '700', color: '#94a3b8' },
  modeTxtActive: { color: '#fff' },

  /* Client search */
  searchWrap: { width: '100%', flex: 1, marginBottom: 10 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#071221', borderRadius: 12, borderWidth: 1,
    borderColor: 'rgba(100,130,170,0.12)', paddingHorizontal: 14, paddingVertical: 10,
  },
  searchIcon: { fontSize: 15 },
  searchInput: { flex: 1, fontSize: 15, color: '#e2e8f0', padding: 0 },
  searchList: { marginTop: 10, flex: 1 },
  searchHint: { textAlign: 'center', color: '#475569', fontSize: 13, marginTop: 24 },
  resultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    paddingVertical: 10, paddingHorizontal: 8, borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  resultAvatar: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(30,58,90,0.9)',
    alignItems: 'center', justifyContent: 'center',
  },
  resultAvatarTxt: { color: '#cbd5e1', fontWeight: '800', fontSize: 15 },
  onlineDot: {
    position: 'absolute', right: -1, bottom: -1, width: 11, height: 11,
    borderRadius: 6, borderWidth: 2, borderColor: '#0c1a2e',
  },
  resultName: { color: '#f0f9ff', fontWeight: '700', fontSize: 14 },
  resultSub: { color: '#64748b', fontSize: 11.5, marginTop: 1 },
  resultCall: { fontSize: 20 },
  xWrap: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  xBar: {
    position: 'absolute',
    width: 18,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#ef4444',
  },
  xBar1: { transform: [{ rotate: '45deg' }] },
  xBar2: { transform: [{ rotate: '-45deg' }] },

  /* Call button */
  callBtn: {
    width: CALL_SZ,
    height: CALL_SZ,
    borderRadius: CALL_SZ / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    shadowColor: '#22c55e',
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
  },
  callIcon: { fontSize: 28 },

  /* Connecting dots */
  dotsRow: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#86efac',
  },

  /* Mini bottom nav — tab bar hide থাকায় navigation link */
  miniNav: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  // staff/superadmin — back to admin panel
  staffBackBar: {
    width: '100%', marginTop: 10, paddingTop: 10, alignItems: 'center',
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)',
  },
  staffBackBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 22, paddingVertical: 11, borderRadius: 24,
  },
  staffBackTxt: { color: '#cbd5e1', fontSize: 14, fontWeight: '700' },
  miniNavItem: {
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  miniNavIcon:  { fontSize: 18 },
  miniNavLabel: { fontSize: 9.5, fontWeight: '600', color: '#64748b', letterSpacing: 0.3 },
});
