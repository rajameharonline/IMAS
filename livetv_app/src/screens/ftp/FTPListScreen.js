import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  StatusBar, Platform, Animated, ActivityIndicator, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import api from '../../services/api';

export default function FTPListScreen({ navigation }) {
  const [servers,     setServers]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(false);
  const [listOpen,    setListOpen]    = useState(false); // server list expand/collapse

  const scaleWeb  = useRef(new Animated.Value(1)).current;
  const scaleDb   = useRef(new Animated.Value(1)).current;
  // প্রতিটি server row-এর জন্য press scale
  const rowScales = useRef({}).current;

  const pressIn  = (sc) => Animated.spring(sc, { toValue: 0.97, useNativeDriver: true, speed: 30 }).start();
  const pressOut = (sc) => Animated.spring(sc, { toValue: 1,    useNativeDriver: true, speed: 20 }).start();

  const getRowScale = (idx) => {
    if (!rowScales[idx]) rowScales[idx] = new Animated.Value(1);
    return rowScales[idx];
  };

  useEffect(() => {
    api.get('/app/config/')
      .then(res => setServers(res.data?.ftp_servers || []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  // FTP Web Server card press
  const handleWebServerPress = () => {
    if (servers.length === 0 || error) return;
    if (servers.length === 1) {
      // একটা থাকলে সরাসরি WebView
      navigation.navigate('WebView', { url: servers[0].url, title: servers[0].name || 'FTP Server' });
    } else {
      // একাধিক থাকলে list toggle
      setListOpen(o => !o);
    }
  };

  const openServer = (item) =>
    navigation.navigate('WebView', { url: item.url, title: item.name || 'FTP Server' });

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <LinearGradient
        colors={['#0a0c18', '#0e1228', '#0a0c18']}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={s.decCircle1} />
      <View style={s.decCircle2} />

      {/* Header */}
      <View style={[s.header, { paddingTop: Platform.OS === 'android' ? 44 : 60 }]}>
        <TouchableOpacity style={s.headerBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={s.headerBtnTxt}>‹</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>FTP Movie Server</Text>
          <Text style={s.headerSub}>মুভি • নাটক • সিরিজ</Text>
        </View>
        <TouchableOpacity style={s.headerBtn} onPress={() => navigation.navigate('Menu')} activeOpacity={0.7}>
          <Text style={s.headerBtnTxt}>⌂</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color="#f59e0b" />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* ══ Card 1: FTP Web Server ══════════════════════════════════════ */}
          <Animated.View style={{ transform: [{ scale: scaleWeb }] }}>
            <TouchableOpacity
              activeOpacity={1}
              onPressIn={() => pressIn(scaleWeb)}
              onPressOut={() => pressOut(scaleWeb)}
              onPress={handleWebServerPress}
              disabled={servers.length === 0 || error}
            >
              <LinearGradient
                colors={['#0a1a35', '#071228', '#040c1a']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={[s.card, (servers.length === 0 || error) && s.cardDisabled]}
              >
                <View style={s.cardGlowBlue} />

                <LinearGradient colors={['#0ea5e9', '#0284c7']} style={s.iconBox}>
                  <Text style={s.iconEmoji}>🌐</Text>
                </LinearGradient>

                <View style={s.cardBody}>
                  <Text style={s.cardTitle}>FTP Web Server</Text>
                  <Text style={s.cardSub}>
                    {error
                      ? 'লোড করা যায়নি'
                      : servers.length === 0
                        ? 'কোনো সার্ভার যোগ করা হয়নি'
                        : servers.length === 1
                          ? servers[0].name || 'সার্ভার ব্রাউজ করুন'
                          : `${servers.length}টি সার্ভার উপলব্ধ`}
                  </Text>
                  <View style={s.tagRow}>
                    <View style={[s.tag, s.tagBlue]}><Text style={[s.tagTxt, s.tagTxtBlue]}>Web</Text></View>
                    <View style={[s.tag, s.tagBlue]}><Text style={[s.tagTxt, s.tagTxtBlue]}>Browser</Text></View>
                    {servers.length > 0 && (
                      <View style={[s.tag, s.tagBlue]}>
                        <Text style={[s.tagTxt, s.tagTxtBlue]}>{servers.length} Server</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Arrow — একাধিক server হলে ▼/▲ toggle, নইলে › */}
                <View style={s.arrowBox}>
                  <Text style={[s.arrowTxt, (servers.length === 0 || error) && { opacity: 0.25 }]}>
                    {servers.length > 1 ? (listOpen ? '▲' : '▼') : '›'}
                  </Text>
                </View>

                <View style={[s.cardAccent, { backgroundColor: '#0ea5e9' }]} />
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>

          {/* ── Server list (একাধিক server থাকলে expand) ─────────────────── */}
          {listOpen && servers.length > 1 && (
            <View style={s.serverList}>
              {/* লিস্ট হেডার */}
              <View style={s.listHeader}>
                <Text style={s.listHeaderTxt}>সার্ভার বেছে নিন</Text>
                <Text style={s.listHeaderCount}>{servers.length}টি</Text>
              </View>

              {servers.map((item, idx) => {
                const sc = getRowScale(idx);
                const isLast = idx === servers.length - 1;
                return (
                  <Animated.View key={`${item.url}-${idx}`} style={{ transform: [{ scale: sc }] }}>
                    <TouchableOpacity
                      activeOpacity={1}
                      onPressIn={() => pressIn(sc)}
                      onPressOut={() => pressOut(sc)}
                      onPress={() => openServer(item)}
                      style={[s.serverRow, isLast && s.serverRowLast]}
                    >
                      {/* Number badge */}
                      <View style={s.serverNumBadge}>
                        <Text style={s.serverNumTxt}>{idx + 1}</Text>
                      </View>

                      {/* Icon */}
                      <View style={s.serverRowIcon}>
                        <Text style={{ fontSize: 18 }}>{item.icon || '🗄️'}</Text>
                      </View>

                      {/* Info */}
                      <View style={{ flex: 1 }}>
                        <Text style={s.serverRowName}>{item.name || `Server ${idx + 1}`}</Text>
                        {!!item.note && (
                          <Text style={s.serverRowNote} numberOfLines={1}>{item.note}</Text>
                        )}
                        <Text style={s.serverRowUrl} numberOfLines={1}>{item.url}</Text>
                      </View>

                      {/* Open arrow */}
                      <View style={s.openBtn}>
                        <Text style={s.openBtnTxt}>›</Text>
                      </View>

                      {/* Divider */}
                      {!isLast && <View style={s.rowDivider} />}
                    </TouchableOpacity>
                  </Animated.View>
                );
              })}
            </View>
          )}

          {/* ══ Card 2: FTP Cash Server ══════════════════════════════════════ */}
          <Animated.View style={{ transform: [{ scale: scaleDb }], marginTop: 16 }}>
            <TouchableOpacity
              activeOpacity={1}
              onPressIn={() => pressIn(scaleDb)}
              onPressOut={() => pressOut(scaleDb)}
              onPress={() => navigation.navigate('FTPContent')}
            >
              <LinearGradient
                colors={['#2a1500', '#1e1000', '#120900']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={s.card}
              >
                <View style={s.cardGlowAmber} />

                <LinearGradient colors={['#f59e0b', '#d97706']} style={s.iconBox}>
                  <Text style={s.iconEmoji}>🎬</Text>
                </LinearGradient>

                <View style={s.cardBody}>
                  <Text style={s.cardTitle}>FTP Cash Server</Text>
                  <Text style={s.cardSub}>কন্টেন্ট ডেটাবেজ থেকে দেখুন</Text>
                  <View style={s.tagRow}>
                    <View style={[s.tag, s.tagAmber]}><Text style={[s.tagTxt, s.tagTxtAmber]}>মুভি</Text></View>
                    <View style={[s.tag, s.tagAmber]}><Text style={[s.tagTxt, s.tagTxtAmber]}>নাটক</Text></View>
                    <View style={[s.tag, s.tagAmber]}><Text style={[s.tagTxt, s.tagTxtAmber]}>সিরিজ</Text></View>
                  </View>
                </View>

                <View style={s.arrowBox}>
                  <Text style={s.arrowTxt}>›</Text>
                </View>

                <View style={[s.cardAccent, { backgroundColor: '#f59e0b' }]} />
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>

        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0c18' },

  decCircle1: {
    position: 'absolute', width: 300, height: 300, borderRadius: 150,
    backgroundColor: 'rgba(14,165,233,0.05)', top: -80, right: -80,
  },
  decCircle2: {
    position: 'absolute', width: 240, height: 240, borderRadius: 120,
    backgroundColor: 'rgba(245,158,11,0.05)', bottom: 100, left: -70,
  },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerBtn:    { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  headerBtnTxt: { color: '#fff', fontSize: 26, fontWeight: '600' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle:  { color: '#fff', fontSize: 16, fontWeight: '900', letterSpacing: 0.2 },
  headerSub:    { color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 1 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  scrollContent: { paddingHorizontal: 18, paddingTop: 28, paddingBottom: 48 },

  // ── Main cards ──────────────────────────────────────────────────────────────
  card: {
    borderRadius: 20, padding: 20,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    overflow: 'hidden', minHeight: 106,
  },
  cardDisabled: { opacity: 0.5 },

  cardGlowBlue: {
    position: 'absolute', top: -60, left: -30,
    width: 200, height: 200, borderRadius: 100,
    backgroundColor: 'rgba(14,165,233,0.08)',
  },
  cardGlowAmber: {
    position: 'absolute', top: -60, left: -30,
    width: 200, height: 200, borderRadius: 100,
    backgroundColor: 'rgba(245,158,11,0.08)',
  },

  iconBox: {
    width: 56, height: 56, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  iconEmoji: { fontSize: 26 },

  cardBody:  { flex: 1 },
  cardTitle: { color: '#fff', fontSize: 17, fontWeight: '900', marginBottom: 4 },
  cardSub:   { color: 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: '500', marginBottom: 10 },

  tagRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  tag: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },

  tagBlue:     { backgroundColor: 'rgba(14,165,233,0.12)', borderColor: 'rgba(14,165,233,0.28)' },
  tagTxtBlue:  { color: '#38bdf8' },
  tagAmber:    { backgroundColor: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.28)' },
  tagTxtAmber: { color: '#f59e0b' },
  tagTxt:      { fontSize: 10, fontWeight: '700' },

  arrowBox: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  arrowTxt: { color: 'rgba(255,255,255,0.55)', fontSize: 18, lineHeight: 22 },

  cardAccent: { position: 'absolute', bottom: 0, left: 20, right: 20, height: 1.5, borderRadius: 1 },

  // ── Server list (expanded) ──────────────────────────────────────────────────
  serverList: {
    marginTop: 8, marginBottom: 4,
    backgroundColor: '#0d1525',
    borderRadius: 16,
    borderWidth: 1, borderColor: 'rgba(14,165,233,0.2)',
    overflow: 'hidden',
  },
  listHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: 'rgba(14,165,233,0.08)',
    borderBottomWidth: 1, borderBottomColor: 'rgba(14,165,233,0.12)',
  },
  listHeaderTxt:   { color: '#38bdf8', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  listHeaderCount: { color: 'rgba(56,189,248,0.6)', fontSize: 11, fontWeight: '700' },

  serverRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 14,
  },
  serverRowLast: { borderBottomWidth: 0 },

  rowDivider: {
    position: 'absolute', bottom: 0, left: 14, right: 14,
    height: 1, backgroundColor: 'rgba(255,255,255,0.05)',
  },

  serverNumBadge: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(14,165,233,0.18)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  serverNumTxt: { color: '#38bdf8', fontSize: 11, fontWeight: '900' },

  serverRowIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: 'rgba(14,165,233,0.1)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },

  serverRowName: { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 2 },
  serverRowNote: { color: 'rgba(255,255,255,0.4)', fontSize: 11, marginBottom: 2 },
  serverRowUrl:  { color: 'rgba(56,189,248,0.45)', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  openBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(14,165,233,0.15)',
    borderWidth: 1, borderColor: 'rgba(14,165,233,0.25)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  openBtnTxt: { color: '#38bdf8', fontSize: 16, lineHeight: 20 },
});
