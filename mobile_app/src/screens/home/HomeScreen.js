import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, RefreshControl, ActivityIndicator,
  Dimensions, LayoutAnimation, Image, Linking, AppState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import Svg, { Path, Defs, LinearGradient, Stop, Line as SvgLine, Rect, Circle } from 'react-native-svg';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { fmtDateEn, fmtCurrencyEn } from '../../utils/helpers';
import MarqueeTicker  from '../../components/MarqueeTicker';

import { BASE_URL } from '../../config';
const { width: SW } = Dimensions.get('window');
const CHART_W  = SW - 64;
const AXIS_W   = 44;            // ডানপাশের scale-এর জন্য সংরক্ষিত প্রস্থ
const PLOT_W   = CHART_W - AXIS_W;   // আসল graph আঁকার প্রস্থ
const CHART_H  = 90;            // collapsed উচ্চতা
const CHART_H_EXPANDED = 200;   // expand করলে উচ্চতা
const POINTS   = 40;

// New Architecture (Fabric)-এ LayoutAnimation নিজেই কাজ করে — আলাদা enable লাগে না

// ─── Helpers ──────────────────────────────────────────────────────────────
function fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}
function fmtSpeed(bps) {
  if (!bps || bps <= 0) return '0 Kb/s';
  const kbps = (bps * 8) / 1000;
  return kbps < 1000 ? `${kbps.toFixed(1)} Kb/s` : `${(kbps / 1000).toFixed(2)} Mb/s`;
}
// ডানপাশের scale-এর জন্য সংক্ষিপ্ত format (যেমন 4.5M, 120K)
function fmtSpeedShort(bps) {
  if (!bps || bps <= 0) return '0';
  const kbps = (bps * 8) / 1000;
  if (kbps < 1000) return `${kbps < 10 ? kbps.toFixed(1) : Math.round(kbps)}K`;
  return `${(kbps / 1000).toFixed(1)}M`;
}

// ─── SVG Area Chart ────────────────────────────────────────────────────────
// max বাইরে থেকে আসে → upload ও download একই scale-এ থাকে (সঠিক তুলনা)
function FlowChart({ data, color, gradId, max, w = PLOT_W, h = CHART_H }) {
  const safeMax = max && max > 0 ? max : 1;
  if (data.every(v => v === 0)) {
    return (
      <Svg width={w} height={h}>
        <SvgLine x1={0} y1={h - 2} x2={w} y2={h - 2} stroke={color} strokeWidth={1.5} opacity={0.4} />
      </Svg>
    );
  }
  const step = w / (data.length - 1);
  const pts  = data.map((v, i) => ({ x: i * step, y: h - 4 - (Math.min(v / safeMax, 1) * (h - 8)) }));
  let linePath = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const cx = (pts[i-1].x + pts[i].x) / 2;
    linePath += ` C ${cx.toFixed(1)} ${pts[i-1].y.toFixed(1)} ${cx.toFixed(1)} ${pts[i].y.toFixed(1)} ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
  }
  const areaPath = linePath + ` L ${pts[pts.length-1].x.toFixed(1)} ${h} L 0 ${h} Z`;
  return (
    <Svg width={w} height={h}>
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity="0.55" />
          <Stop offset="1" stopColor={color} stopOpacity="0.02" />
        </LinearGradient>
      </Defs>
      <Path d={areaPath} fill={`url(#${gradId})`} />
      <Path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

// ─── Traffic Widget ────────────────────────────────────────────────────────
function TrafficWidget({ onPress, onStatus }) {
  const [data, setData]      = useState(null);
  const [downSpeed, setDown] = useState(0);
  const [upSpeed,   setUp]   = useState(0);
  const [downHist,  setDownH] = useState(Array(POINTS).fill(0));
  const [upHist,    setUpH]   = useState(Array(POINTS).fill(0));
  const [expanded, setExpanded] = useState(false);
  const prevRef = useRef(null);
  const INTV = 3;

  const toggleExpand = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(e => !e);
  };

  // ── Scale হিসাব: upload+download উভয়ের সর্বোচ্চ peak (bytes/sec) ──
  const peak = Math.max(...downHist, ...upHist, 0);
  // peak-এর উপর ২০% headroom যাতে graph একদম উপরে আটকে না যায়
  const scaleMax = peak > 0 ? peak * 1.2 : 0;
  const chartH   = expanded ? CHART_H_EXPANDED : CHART_H;
  // peak কোন উচ্চতায় আছে (line আঁকার জন্য, Svg coord অনুযায়ী)
  const peakY    = scaleMax > 0 ? (chartH - 4 - (peak / scaleMax) * (chartH - 8)) : 0;
  // ডানপাশের ৫টি tick (উপর→নিচ): scaleMax এর 100/75/50/25/0%
  const ticks = [1, 0.75, 0.5, 0.25, 0];

  useEffect(() => {
    const doFetch = async () => {
      try {
        const r = await api.get('/app/me/traffic/');
        const d = r.data;
        setData(d);
        // live Mikrotik online (ground truth) header status-এ পাঠাই — প্রতি ৩s আপডেট
        onStatus?.(Boolean(d.online));
        if (prevRef.current && d.online) {
          const dl = Math.max(0, (d.bytes_in  - prevRef.current.in)  / INTV);
          const ul = Math.max(0, (d.bytes_out - prevRef.current.out) / INTV);
          setDown(dl); setUp(ul);
          setDownH(h => [...h.slice(1), dl]);
          setUpH(h =>   [...h.slice(1), ul]);
        }
        if (d.online) prevRef.current = { in: d.bytes_in, out: d.bytes_out };
      } catch {}
    };
    doFetch();
    const id = setInterval(doFetch, INTV * 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <View style={styles.trafficCard}>
      {/* Stats row — tap করলে full Traffic screen খোলে */}
      <TouchableOpacity onPress={onPress} activeOpacity={0.92} style={styles.tcTop}>
        <View style={styles.tcStat}>
          <View style={[styles.tcArrow, { backgroundColor: '#eff6ff' }]}>
            <Text style={[styles.tcArrowText, { color: '#3b82f6' }]}>↑</Text>
          </View>
          <Text style={styles.tcLabel}>Upload</Text>
          <Text style={[styles.tcVal, { fontSize: 12 }]}>{fmtBytes(data?.bytes_out || 0)}</Text>
        </View>
        <View style={[styles.tcStat, { alignItems: 'center' }]}>
          <View style={[styles.tcArrow, { backgroundColor: '#f1f5f9' }]}>
            <Text style={[styles.tcArrowText, { color: '#64748b', fontSize: 12 }]}>↕</Text>
          </View>
          <Text style={styles.tcLabel}>Uptime</Text>
          <Text style={[styles.tcVal, { fontSize: 11 }]}>{data?.uptime || '—'}</Text>
        </View>
        <View style={[styles.tcStat, { alignItems: 'flex-end' }]}>
          <View style={[styles.tcArrow, { backgroundColor: '#eff6ff' }]}>
            <Text style={[styles.tcArrowText, { color: '#3b82f6' }]}>↓</Text>
          </View>
          <Text style={styles.tcLabel}>Download</Text>
          <Text style={styles.tcVal}>{fmtBytes(data?.bytes_in || 0)}</Text>
        </View>
      </TouchableOpacity>

      {/* Chart */}
      <View style={[styles.tcChartBox, { height: chartH + 4 }]}>
        {/* আঁকার এলাকা (গ্রিড + দুই graph + peak line) */}
        <View style={{ width: PLOT_W, height: chartH, position: 'relative' }}>
          {/* উল্লম্ব grid (সময়) */}
          {[0,1,2,3,4,5].map(i => (
            <View key={`v${i}`} style={[styles.gridLineV, { left: (i / 5) * PLOT_W }]} />
          ))}
          {/* অনুভূমিক grid (scale tick অনুযায়ী) */}
          {ticks.map((_, i) => (
            <View key={`h${i}`} style={[styles.gridLineH, { top: (i / (ticks.length - 1)) * (chartH - 1) }]} />
          ))}

          <View style={StyleSheet.absoluteFill}>
            <FlowChart data={upHist} color="#10b981" gradId="upGrad" max={scaleMax} h={chartH} />
          </View>
          <FlowChart data={downHist} color="#3b82f6" gradId="downGrad" max={scaleMax} h={chartH} />

          {/* Peak line + badge — সর্বোচ্চ কত speed হয়েছে */}
          {scaleMax > 0 && (
            <View style={[styles.peakLine, { top: peakY }]}>
              <View style={styles.peakBadge}>
                <Text style={styles.peakBadgeTxt}>▲ {fmtSpeed(peak)}</Text>
              </View>
            </View>
          )}
        </View>

        {/* ডানপাশের scale (dynamic, আসল মান) */}
        <View style={styles.yAxis}>
          {ticks.map((f, i) => (
            <Text key={i} style={styles.yLabel}>{fmtSpeedShort(scaleMax * f)}</Text>
          ))}
        </View>

        {/* Expand / Collapse button */}
        <TouchableOpacity onPress={toggleExpand} activeOpacity={0.8} style={styles.expandBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.expandIcon}>{expanded ? '⌃' : '⌄'}</Text>
        </TouchableOpacity>
      </View>

      {/* Speed labels */}
      <View style={styles.tcSpeedRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={[styles.tcDot, { backgroundColor: '#3b82f6' }]} />
          <Text style={styles.tcSpeedTxt}>Download : </Text>
          <Text style={[styles.tcSpeedVal, { color: '#3b82f6' }]}>{fmtSpeed(downSpeed)}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={[styles.tcDot, { backgroundColor: '#10b981' }]} />
          <Text style={styles.tcSpeedTxt}>Upload : </Text>
          <Text style={[styles.tcSpeedVal, { color: '#10b981' }]}>{fmtSpeed(upSpeed)}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Home Screen ───────────────────────────────────────────────────────────
export default function HomeScreen({ navigation }) {
  const { client, preloadedBill, refreshClient } = useAuth();
  const insets = useSafeAreaInsets();
  // preloadedBill → login/restore-এ fetch করা — সাথে সাথে দেখাবে
  const [billData, setBillData]     = useState(preloadedBill);
  const [loading, setLoading]       = useState(!preloadedBill);
  const [refreshing, setRefreshing] = useState(false);
  const [unread,     setUnread]     = useState(0);   // bell badge — unread push notification
  const [ticker,     setTicker]     = useState({ notice: '', color: '#1e3a8a', bg: '#dbeafe' });
  const [banners,    setBanners]    = useState([]);
  const [activeBanner, setActiveBanner] = useState(0); // carousel-এর সক্রিয় slide
  const [liveOnline, setLiveOnline] = useState(null);  // live Mikrotik online (TrafficWidget থেকে)

  // preloadedBill পরে update হলে sync করা
  useEffect(() => {
    if (preloadedBill) setBillData(preloadedBill);
  }, [preloadedBill]);

  const fetchData = useCallback(async () => {
    try {
      // Banners ও Config একসাথে fetch
      const [bannerR, cfgR] = await Promise.allSettled([
        axios.get(`${BASE_URL}/app/banners/`),
        axios.get(`${BASE_URL}/app/config/`),
      ]);
      if (bannerR.status === 'fulfilled') setBanners(bannerR.value.data || []);
      if (cfgR.status === 'fulfilled') {
        const cfg = cfgR.value.data;
        if (cfg.ticker_notice) {
          setTicker({ notice: cfg.ticker_notice, color: cfg.ticker_color || '#1e3a8a', bg: cfg.ticker_bg || '#dbeafe' });
        }
      }
      // unread push notification count (bell badge)
      try {
        const nR = await api.get('/app/me/notifications/');
        const notifs = nR.data || [];
        const lastSeen = parseInt((await AsyncStorage.getItem('notif_last_seen_id')) || '0', 10);
        setUnread(notifs.filter(n => n.id > lastSeen).length);
      } catch {}
    } catch {}
    setLoading(false);
  }, []);

  // screen-এ ঢুকলে (focus) + অ্যাপ আবার সামনে এলে (foreground) অটো-refresh —
  // admin-এ banner/notice/package/bill/logo বদলালে client manual refresh ছাড়াই নতুনটা পায়।
  useFocusEffect(
    useCallback(() => {
      fetchData();
      refreshClient();
    }, [fetchData])
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') { fetchData(); refreshClient(); }
    });
    return () => sub.remove();
  }, [fetchData]);

  // চলন্ত নোটিশ (ticker) + banner/notice প্রতি ১০ সেকেন্ডে অটো-poll —
  // admin-এ নোটিশ বদলালে client সেকেন্ডের মধ্যেই দেখবে (manual কিছু না করেই)।
  useEffect(() => {
    const id = setInterval(() => { fetchData(); }, 10000);
    return () => clearInterval(id);
  }, [fetchData]);

  const onRefresh = async () => { setRefreshing(true); await Promise.all([fetchData(), refreshClient()]); setRefreshing(false); };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#3b5998" /></View>;

  // Connected/Disconnected = live Mikrotik session (TrafficWidget প্রতি ৩s এনে
  // onStatus দিয়ে দেয় — ground truth, real-time)। traffic এখনো না এলে account
  // status-এ fallback (radacct stale হতে পারে, তাই সেটা ব্যবহার করি না)।
  const connected = liveOnline ?? (client?.status === 'active');

  // ── Expiry date + কত দিন বাকি (color-coded) ──
  const expiryRaw = billData?.expiry_date || client?._expiry_date || client?.expiry_date;
  const expiry = (() => {
    if (!expiryRaw) return { date: '—', days: null, theme: { accent: '#64748b', bg: '#f1f5f9', soft: '#e2e8f0' }, badge: '' };
    const d = new Date(expiryRaw);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dd = new Date(d); dd.setHours(0, 0, 0, 0);
    const days = Math.round((dd - today) / 86400000);
    let theme, badge;
    if (isNaN(days)) {
      theme = { accent: '#64748b', bg: '#f1f5f9', soft: '#e2e8f0' }; badge = '';
    } else if (days < 0) {
      theme = { accent: '#dc2626', bg: '#fef2f2', soft: '#fee2e2' }; badge = `${Math.abs(days)} দিন আগে শেষ`;
    } else if (days === 0) {
      theme = { accent: '#ea580c', bg: '#fff7ed', soft: '#ffedd5' }; badge = 'আজ শেষ হচ্ছে';
    } else if (days <= 7) {
      theme = { accent: '#d97706', bg: '#fffbeb', soft: '#fef3c7' }; badge = `${days} দিন বাকি`;
    } else {
      theme = { accent: '#0f766e', bg: '#ecfdf5', soft: '#d1fae5' }; badge = `${days} দিন বাকি`;
    }
    return { date: fmtDateEn(expiryRaw), days, theme, badge };
  })();

  return (
    <View style={{ flex: 1, backgroundColor: '#eef2f7' }}>
      <StatusBar style="light" />
      {/* status bar এলাকা header-এর রঙে — edge-to-edge-এ আইকন দৃশ্যমান রাখে */}
      <View style={{ height: insets.top, backgroundColor: '#4a6cb5' }} />

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b5998" />}
        showsVerticalScrollIndicator={false}
      >
        {/* ── HEADER ────────────────────────────────────────── */}
        <View style={styles.header}>
          {/* gradient background + subtle decorative circles */}
          <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
            <Defs>
              <LinearGradient id="hdrGrad" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0"   stopColor="#4a6cb5" />
                <Stop offset="0.55" stopColor="#395a9f" />
                <Stop offset="1"   stopColor="#2a4173" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#hdrGrad)" />
            <Circle cx="92%" cy="12%" r="55"  fill="rgba(255,255,255,0.07)" />
            <Circle cx="100%" cy="95%" r="85" fill="rgba(255,255,255,0.05)" />
            <Circle cx="8%"  cy="100%" r="40" fill="rgba(255,255,255,0.04)" />
          </Svg>
          {/* avatar */}
          {client?.photo ? (
            <Image source={{ uri: client.photo }} style={styles.avatar} resizeMode="cover" />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarTxt}>{(client?.full_name || 'C').charAt(0).toUpperCase()}</Text>
            </View>
          )}
          {/* info */}
          <View style={{ flex: 1 }}>
            <Text style={styles.hName}>{client?.full_name || '—'}</Text>
            <Text style={styles.hCode}>Client Code : {client?.customer_id}</Text>
            {client?.phone ? (
              <TouchableOpacity onPress={() => Linking.openURL(`tel:${client.phone}`)} activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 }}>
                <Text style={{ fontSize: 11 }}>📞</Text>
                <Text style={styles.hPhone}>{client.phone}</Text>
              </TouchableOpacity>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
              <View style={[styles.statusDot, { backgroundColor: connected ? '#4ade80' : '#f87171' }]} />
              <Text style={styles.hStatus}>Status : </Text>
              <Text style={[styles.hStatusVal, { color: connected ? '#4ade80' : '#f87171' }]}>
                {connected ? 'Connected' : 'Disconnected'}
              </Text>
            </View>
          </View>
          {/* icons */}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TouchableOpacity style={styles.hIcon} onPress={() => { setUnread(0); navigation.navigate('Notifications'); }} activeOpacity={0.75}>
              <Text style={{ fontSize: 18 }}>🔔</Text>
              {unread > 0 && (
                <View style={styles.hBadge}><Text style={styles.hBadgeTxt}>{unread > 9 ? '9+' : unread}</Text></View>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.hIcon} onPress={() => navigation.navigate('Profile')} activeOpacity={0.75}>
              <Text style={{ fontSize: 18 }}>👤</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── TICKER / NOTICE — banner-এর জায়গায় ─────────────── */}
        {ticker.notice
          ? <MarqueeTicker text={ticker.notice} color={ticker.color} bg={ticker.bg} />
          : null}

        {/* ── QUICK ACTIONS ─────────────────────────────────── */}
        <View style={styles.actionRow}>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#3b5998' }]}
            onPress={() => navigation.navigate('Invoice')} activeOpacity={0.85}>
            <Text style={styles.actionIcon}>💳</Text>
            <View>
              <Text style={styles.actionTitle}>Recharge / Payment</Text>
              <Text style={styles.actionSub}>Pay your bill</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* ── INFO STATS ─────────────────────────────────────── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 10, paddingBottom: 4 }}>
          {[
            { icon: '💰', label: 'Monthly Bill', val: fmtCurrencyEn(billData?.monthly_bill  || client?._monthly_bill || client?.monthly_bill), bg: '#eff6ff', color: '#1d4ed8', onPress: null },
            { icon: '✅', label: 'Paid',         val: fmtCurrencyEn(billData?.current_bill?.paid_amount), bg: '#f0fdf4', color: '#15803d', onPress: null },
            { icon: '📶', label: 'Package',      val: billData?.package_name || client?._package_name || client?.package_name || '—', bg: '#faf5ff', color: '#7e22ce', onPress: () => navigation.navigate('Package') },
          ].map((s, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.statPill, { backgroundColor: s.bg, borderColor: s.color + '22' }]}
              onPress={s.onPress || undefined}
              activeOpacity={s.onPress ? 0.75 : 1}
            >
              <View style={styles.statIcon}>
                <Text style={{ fontSize: 18 }}>{s.icon}</Text>
              </View>
              <Text style={[styles.statLabel, { color: s.color + 'aa' }]}>{s.label}</Text>
              <Text style={[styles.statVal, { color: s.color }]}>{s.val}</Text>
              {s.onPress && <Text style={{ color: s.color, fontSize: 9, marginTop: 1 }}>আপগ্রেড ↗</Text>}
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ── EXPIRY DATE — তিন কার্ডের নিচে ──────────────────── */}
        <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
          <View style={[styles.expiryCard, { backgroundColor: expiry.theme.bg, borderColor: expiry.theme.soft }]}>
            <View style={[styles.expiryIcon, { backgroundColor: expiry.theme.soft }]}>
              <Text style={{ fontSize: 22 }}>📅</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.expiryLabel}>প্যাকেজ মেয়াদ শেষ</Text>
              <Text style={[styles.expiryDate, { color: expiry.theme.accent }]}>{expiry.date}</Text>
            </View>
            {expiry.badge ? (
              <View style={[styles.expiryBadge, { backgroundColor: expiry.theme.accent }]}>
                <Text style={styles.expiryBadgeTxt}>{expiry.badge}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* ── LIVE TRAFFIC ───────────────────────────────────── */}
        <View style={{ paddingHorizontal: 16, marginTop: 4 }}>
          <TrafficWidget onPress={() => navigation.navigate('Traffic')} onStatus={setLiveOnline} />
        </View>

        {/* ── BANNERS — পুরো-প্রস্থ swipeable carousel ─────────── */}
        {banners.length > 0 && (
          <View style={{ marginTop: 16, marginBottom: 28 }}>
            <Text style={styles.bannerSectionTitle}>📋 Notice / Offer</Text>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={e => setActiveBanner(Math.round(e.nativeEvent.contentOffset.x / SW))}
            >
              {banners.map(b => {
                // image_url (নতুন serializer) বা image (DRF absolute) — যেটা থাকে
                const imgUri = b.image_url || b.image || '';
                return (
                  <View key={b.id} style={{ width: SW, paddingHorizontal: 16 }}>
                    <TouchableOpacity style={styles.bannerCard} activeOpacity={0.85}
                      onPress={() => navigation.navigate('BannerDetail', { banner: b })}>
                      {/* বাঁয়ে ছবি */}
                      {imgUri ? (
                        <Image source={{ uri: imgUri }} style={styles.bannerImg} resizeMode="cover" />
                      ) : (
                        <View style={[styles.bannerImg, styles.bannerImgEmpty]}>
                          <Text style={{ fontSize: 30 }}>📢</Text>
                        </View>
                      )}
                      {/* ডানে লেখা */}
                      <View style={styles.bannerContent}>
                        <Text style={styles.bannerTitle} numberOfLines={2}>{b.title}</Text>
                        {b.body ? <Text style={styles.bannerBody} numberOfLines={3}>{b.body}</Text> : null}
                        <View style={styles.bannerCta}>
                          <Text style={styles.bannerCtaTxt}>বিস্তারিত  ›</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>
            {/* Dots indicator */}
            {banners.length > 1 && (
              <View style={styles.bannerDots}>
                {banners.map((_, i) => (
                  <View key={i} style={[styles.bannerDot, i === activeBanner && styles.bannerDotActive]} />
                ))}
              </View>
            )}
          </View>
        )}

      </ScrollView>

      {/* ── AI সহকারী — পুরো স্ক্রিনে ভাসমান গোল চ্যাট বোতাম (FAB) ───────── */}
      <TouchableOpacity
        style={[styles.aiFab, { bottom: 22 }]}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('Support', { screen: 'AIChat' })}>
        <Text style={styles.aiFabIcon}>🤖</Text>
        <View style={styles.aiFabDot} />
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#eef2f7' },

  // Header
  header: {
    backgroundColor: '#3b5998',
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 18, paddingTop: 18, paddingBottom: 24,
    borderBottomLeftRadius: 28, borderBottomRightRadius: 28,
    overflow: 'hidden',
    shadowColor: '#2a4173', shadowOpacity: 0.4, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 10,
  },
  avatar: {
    width: 58, height: 58, borderRadius: 29,
    backgroundColor: 'rgba(255,255,255,0.22)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, elevation: 4,
  },
  avatarTxt:  { color: '#fff', fontSize: 23, fontWeight: '900' },
  hName:      { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: 0.3 },
  hCode:      { color: '#cdd9f0', fontSize: 11.5, marginTop: 2, fontWeight: '500' },
  hPhone:     { color: '#fff', fontSize: 12.5, fontWeight: '700', textDecorationLine: 'underline' },
  statusDot:  { width: 7, height: 7, borderRadius: 3.5 },
  hStatus:    { color: '#cdd9f0', fontSize: 11.5 },
  hStatusVal: { fontSize: 11.5, fontWeight: '800' },
  hIcon: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  hBadge: {
    position: 'absolute', top: -3, right: -3,
    backgroundColor: '#ef4444', borderRadius: 8,
    minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3, borderWidth: 1.5, borderColor: '#3b5998',
  },
  hBadgeTxt: { color: '#fff', fontSize: 9, fontWeight: '900' },

  // AppBanner card
  bannerSectionTitle: {
    fontSize: 12, fontWeight: '700', color: '#64748b',
    textTransform: 'uppercase', letterSpacing: 0.5,
    paddingHorizontal: 16, marginBottom: 6,
  },
  bannerCard: {
    backgroundColor: '#fff', borderRadius: 16, width: '100%',
    flexDirection: 'row', alignItems: 'stretch', minHeight: 116,
    shadowColor: '#3b5998', shadowOpacity: 0.12, shadowRadius: 10, elevation: 4,
    overflow: 'hidden',
  },
  bannerDots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 },
  bannerDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#cbd5e1' },
  bannerDotActive: { width: 18, backgroundColor: '#3b5998' },
  // বাঁয়ের ছবি — fixed প্রস্থ, card-এর পুরো উচ্চতা জুড়ে
  bannerImg: { width: 118, alignSelf: 'stretch', backgroundColor: '#e2e8f0' },
  bannerImgEmpty: { alignItems: 'center', justifyContent: 'center' },
  // ডানের লেখা
  bannerContent: { flex: 1, paddingVertical: 14, paddingHorizontal: 14, justifyContent: 'center' },
  bannerTitle:  { color: '#0f2d42', fontWeight: '800', fontSize: 15, marginBottom: 4, lineHeight: 20 },
  bannerBody:   { color: '#64748b', fontSize: 12, lineHeight: 17 },
  bannerCta: {
    alignSelf: 'flex-start', marginTop: 10,
    backgroundColor: '#eef2fb', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  bannerCtaTxt: { color: '#3b5998', fontSize: 11, fontWeight: '800' },

  // Quick Actions (2 large buttons)
  actionRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginTop: 10, marginBottom: 10 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 16, paddingVertical: 14, paddingHorizontal: 14,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, elevation: 4,
  },
  actionIcon:  { fontSize: 26 },
  actionTitle: { color: '#fff', fontWeight: '800', fontSize: 13 },
  actionSub:   { color: 'rgba(255,255,255,0.65)', fontSize: 10, marginTop: 1 },
  // AI সহকারী floating chat button (গোল FAB, স্ক্রিনের উপর ভাসমান)
  aiFab: {
    position: 'absolute', right: 18,
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: '#6d28d9', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#6d28d9', shadowOpacity: 0.45, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }, elevation: 9,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)',
  },
  aiFabIcon: { fontSize: 28 },
  aiFabDot: {
    position: 'absolute', top: 6, right: 6,
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: '#22c55e', borderWidth: 2, borderColor: '#fff',
  },

  // Stat Pills (horizontal scroll)
  statPill: {
    borderRadius: 16, paddingHorizontal: 14, paddingVertical: 14,
    alignItems: 'center', gap: 5, minWidth: 116, borderWidth: 1,
    shadowColor: '#64748b', shadowOpacity: 0.08, shadowRadius: 6, elevation: 2,
  },
  statIcon: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#ffffff',
    alignItems: 'center', justifyContent: 'center', marginBottom: 2,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 3, elevation: 1,
  },
  statLabel: { fontSize: 11, fontWeight: '700' },
  statVal:   { fontSize: 15, fontWeight: '900' },

  // Expiry date card
  expiryCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  expiryIcon:  { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  expiryLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', marginBottom: 2 },
  expiryDate:  { fontSize: 17, fontWeight: '900' },
  expiryBadge: { borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5 },
  expiryBadgeTxt: { color: '#fff', fontSize: 11, fontWeight: '800' },

  // Feature Grid
  featGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
    paddingHorizontal: 16, marginBottom: 14,
  },
  featCard: {
    width: (SW - 42) / 2, borderRadius: 18, minHeight: 100,
    overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, elevation: 4,
  },
  featInner: { flex: 1, padding: 16, alignItems: 'center', justifyContent: 'center' },
  featLabel: { color: '#fff', fontSize: 13, fontWeight: '700', textAlign: 'center', lineHeight: 18 },

  // Traffic Widget
  trafficCard: {
    backgroundColor: '#fff', borderRadius: 18, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 3,
  },
  tcTop:       { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  tcStat:      { alignItems: 'flex-start' },
  tcArrow:     { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  tcArrowText: { fontSize: 14, fontWeight: '900' },
  tcLabel:     { fontSize: 10, color: '#94a3b8', fontWeight: '500' },
  tcVal:       { fontSize: 14, fontWeight: '800', color: '#1e293b', marginTop: 1 },
  tcChartBox: {
    marginBottom: 10,
    backgroundColor: '#f8fafc', borderRadius: 10,
    overflow: 'hidden', paddingHorizontal: 4, paddingVertical: 2,
    flexDirection: 'row', position: 'relative',
  },
  gridLineV: {
    position: 'absolute', top: 0, bottom: 0, width: 1,
    borderLeftWidth: 0.5, borderColor: '#cbd5e1',
    borderStyle: 'dashed', opacity: 0.6,
  },
  gridLineH: {
    position: 'absolute', left: 0, right: 0, height: 1,
    borderTopWidth: 0.5, borderColor: '#e2e8f0',
  },
  peakLine: {
    position: 'absolute', left: 0, right: 0, height: 0,
    borderTopWidth: 1, borderColor: '#f59e0b', borderStyle: 'dashed',
    justifyContent: 'center', alignItems: 'flex-start',
  },
  peakBadge: {
    position: 'absolute', left: 2, top: -9,
    backgroundColor: '#fffbeb', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1,
    borderWidth: 0.5, borderColor: '#fcd34d',
  },
  peakBadgeTxt: { fontSize: 9, color: '#b45309', fontWeight: '800' },
  yAxis:      { width: AXIS_W - 8, marginLeft: 4, justifyContent: 'space-between', paddingVertical: 2, alignItems: 'flex-end' },
  yLabel:     { fontSize: 9, color: '#94a3b8', fontWeight: '700' },
  expandBtn: {
    position: 'absolute', top: 5, right: 5,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 3, elevation: 2,
  },
  expandIcon: { fontSize: 14, fontWeight: '900', color: '#475569', lineHeight: 16 },
  tcSpeedRow: { flexDirection: 'row', justifyContent: 'space-between' },
  tcDot:      { width: 8, height: 8, borderRadius: 4 },
  tcSpeedTxt: { fontSize: 12, color: '#94a3b8' },
  tcSpeedVal: { fontSize: 12, fontWeight: '700' },
});
