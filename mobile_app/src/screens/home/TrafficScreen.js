import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Animated, Dimensions, ScrollView,
} from 'react-native';
import Svg, { Path, Defs, LinearGradient as SvgGrad, Stop, Circle } from 'react-native-svg';
import api from '../../services/api';
import ScreenHeader from '../../components/ScreenHeader';

const { width: SW } = Dimensions.get('window');
const CHART_W = SW - 48;
const CHART_H = 110;
const POINTS  = 50;

// ─── Helpers ─────────────────────────────────────────────────────────────
function fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(2)} ${u[i]}`;
}
function fmtSpeed(bps) {
  if (!bps || bps <= 0) return '0 bps';
  const bits = bps * 8;
  if (bits < 1000)      return `${bits.toFixed(0)} bps`;
  if (bits < 1_000_000) return `${(bits/1000).toFixed(1)} Kbps`;
  return `${(bits/1_000_000).toFixed(2)} Mbps`;
}

// ─── SVG Chart ─────────────────────────────────────────────────────────────
function LineChart({ data, color, gradId }) {
  const max  = Math.max(...data, 1);
  const w = CHART_W, h = CHART_H;
  const pts  = data.map((v, i) => ({
    x: (i / (data.length - 1)) * w,
    y: h - 8 - ((v / max) * (h - 16)),
  }));

  if (data.every(v => v === 0)) return null;

  let line = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const cx = (pts[i-1].x + pts[i].x) / 2;
    line += ` C ${cx.toFixed(1)} ${pts[i-1].y.toFixed(1)} ${cx.toFixed(1)} ${pts[i].y.toFixed(1)} ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
  }
  const area = line + ` L ${w} ${h} L 0 ${h} Z`;
  const last = pts[pts.length - 1];

  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
      <Defs>
        <SvgGrad id={gradId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity="0.25" />
          <Stop offset="1" stopColor={color} stopOpacity="0.02" />
        </SvgGrad>
      </Defs>
      <Path d={area} fill={`url(#${gradId})`} />
      <Path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      <Circle cx={last.x} cy={last.y} r={5} fill={color} />
      <Circle cx={last.x} cy={last.y} r={10} fill={color} fillOpacity={0.15} />
    </Svg>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────
export default function TrafficScreen({ navigation }) {
  const [data,      setData]    = useState(null);
  const [loading,   setLoading] = useState(true);
  const [downHist,  setDownH]   = useState(Array(POINTS).fill(0));
  const [upHist,    setUpH]     = useState(Array(POINTS).fill(0));
  const [downSpeed, setDown]    = useState(0);
  const [upSpeed,   setUp]      = useState(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const prevRef   = useRef(null);
  const INTV = 3;

  const pulse = useCallback(() => {
    Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.15, duration: 200, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,    duration: 200, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    const doFetch = async () => {
      try {
        const r = await api.get('/app/me/traffic/');
        const d = r.data;
        setData(d);
        setLoading(false);
        if (prevRef.current && d.online) {
          const dl = Math.max(0, (d.bytes_in  - prevRef.current.in)  / INTV);
          const ul = Math.max(0, (d.bytes_out - prevRef.current.out) / INTV);
          setDown(dl); setUp(ul);
          setDownH(h => [...h.slice(1), dl]);
          setUpH(h =>   [...h.slice(1), ul]);
          if (dl > 0 || ul > 0) pulse();
        }
        if (d.online) prevRef.current = { in: d.bytes_in, out: d.bytes_out };
      } catch { setLoading(false); }
    };
    doFetch();
    const id = setInterval(doFetch, INTV * 1000);
    return () => clearInterval(id);
  }, []);

  const online = data?.online;

  return (
    <View style={s.screen}>
      <ScreenHeader
        title="Live Traffic"
        onBack={() => navigation.goBack()}
        color="#3b5998"
        right={
          <Animated.View style={[s.badge, { backgroundColor: online ? '#10b981' : '#ef4444', transform: [{ scale: pulseAnim }] }]}>
            <View style={[s.badgeDot, { backgroundColor: online ? '#6ee7b7' : '#fca5a5' }]} />
            <Text style={s.badgeTxt}>{online ? 'LIVE' : 'OFFLINE'}</Text>
          </Animated.View>
        }
      />

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color="#3b5998" />
          <Text style={s.loadTxt}>Verifying connection...</Text>
        </View>
      ) : !online ? (
        <View style={s.center}>
          <Text style={{ fontSize: 52, marginBottom: 16 }}>📡</Text>
          <Text style={s.offTxt}>You are currently offline</Text>
          <Text style={s.offSub}>No PPPoE connection</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.body}>

          {/* Speed Cards */}
          <View style={s.speedRow}>
            <View style={s.speedCard}>
              <View style={[s.speedIcon, { backgroundColor: '#f0fdf4' }]}>
                <Text style={{ fontSize: 24 }}>⬇️</Text>
              </View>
              <Text style={s.speedLabel}>Download</Text>
              <Text style={[s.speedVal, { color: '#059669' }]}>{fmtSpeed(downSpeed)}</Text>
              <Text style={s.speedTotal}>Running Session: {fmtBytes(data?.bytes_in || 0)}</Text>
              <View style={s.monthlyRow}>
                <Text style={s.monthlyIcon}>📅</Text>
                <Text style={s.monthlyTxt}>Monthly: {fmtBytes(data?.monthly_dl || 0)}</Text>
              </View>
            </View>
            <View style={s.speedCard}>
              <View style={[s.speedIcon, { backgroundColor: '#eff6ff' }]}>
                <Text style={{ fontSize: 24 }}>⬆️</Text>
              </View>
              <Text style={s.speedLabel}>Upload</Text>
              <Text style={[s.speedVal, { color: '#2563eb' }]}>{fmtSpeed(upSpeed)}</Text>
              <Text style={s.speedTotal}>Running Session: {fmtBytes(data?.bytes_out || 0)}</Text>
              <View style={s.monthlyRow}>
                <Text style={s.monthlyIcon}>📅</Text>
                <Text style={s.monthlyTxt}>Monthly: {fmtBytes(data?.monthly_ul || 0)}</Text>
              </View>
            </View>
          </View>

          {/* Real-time Chart */}
          <View style={s.chartCard}>
            <View style={s.chartHeader}>
              <Text style={s.chartTitle}>📊 Real-time Graph</Text>
              <View style={s.legend}>
                <View style={[s.legendDot, { backgroundColor: '#059669' }]} />
                <Text style={s.legendTxt}>Download</Text>
                <View style={[s.legendDot, { backgroundColor: '#2563eb' }]} />
                <Text style={s.legendTxt}>Upload</Text>
              </View>
            </View>
            <View style={s.chartArea}>
              <LineChart data={downHist} color="#059669" gradId="dlG" />
              <LineChart data={upHist}   color="#2563eb" gradId="ulG" />
            </View>
            <Text style={s.refreshNote}>Every {INTV} seconds, the data auto-refreshes</Text>
          </View>

          {/* Connection Info */}
          <View style={s.infoCard}>
            <Text style={s.infoTitle}>Connection information</Text>
            {[
              { icon: '📍', label: 'IP Address', val: data?.ip || '—' },
              { icon: '⏱️', label: 'Uptime',     val: data?.uptime || '—' },
              { icon: '🟢', label: 'Status',     val: 'Connected', color: '#059669' },
            ].map(({ icon, label, val, color }) => (
              <View key={label} style={s.infoRow}>
                <Text style={s.infoIcon}>{icon}</Text>
                <Text style={s.infoLabel}>{label}</Text>
                <Text style={[s.infoVal, color && { color }]}>{val}</Text>
              </View>
            ))}
          </View>

        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#eef2f7' },

  // Header — App-এর #3b5998 theme
  header: {
    backgroundColor: '#3b5998',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
    shadowColor: '#3b5998', shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
  },
  backBtn:     { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backTxt:     { color: '#c8d4ee', fontSize: 22, fontWeight: '700' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
  },
  badgeDot: { width: 7, height: 7, borderRadius: 3.5 },
  badgeTxt: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 1 },

  center:  { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadTxt: { color: '#94a3b8', marginTop: 12, fontSize: 13 },
  offTxt:  { color: '#1e293b', fontSize: 20, fontWeight: '800', marginBottom: 6 },
  offSub:  { color: '#94a3b8', fontSize: 13 },

  body: { padding: 16, gap: 14, paddingBottom: 32 },

  // Speed Cards
  speedRow: { flexDirection: 'row', gap: 12 },
  speedCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 18,
    padding: 16, alignItems: 'center', gap: 6,
    shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
  },
  speedIcon:  { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  speedLabel: { fontSize: 11, color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  speedVal:   { fontSize: 20, fontWeight: '900' },
  speedTotal: { fontSize: 11, color: '#94a3b8', fontWeight: '500' },
  monthlyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#f0f9ff', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
    marginTop: 2,
  },
  monthlyIcon: { fontSize: 11 },
  monthlyTxt:  { fontSize: 11, color: '#0369a1', fontWeight: '700' },

  // Chart
  chartCard: {
    backgroundColor: '#fff', borderRadius: 18, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  chartTitle:  { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  legend:      { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot:   { width: 8, height: 8, borderRadius: 4 },
  legendTxt:   { fontSize: 11, color: '#64748b', fontWeight: '600', marginRight: 6 },
  chartArea: {
    height: CHART_H, backgroundColor: '#f8fafc',
    borderRadius: 12, overflow: 'hidden', position: 'relative',
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  refreshNote: { textAlign: 'center', color: '#94a3b8', fontSize: 11, marginTop: 10 },

  // Info Card
  infoCard: {
    backgroundColor: '#fff', borderRadius: 18, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  infoTitle: { fontSize: 13, fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  infoRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  infoIcon:  { fontSize: 18, width: 30 },
  infoLabel: { flex: 1, fontSize: 13, color: '#64748b' },
  infoVal:   { fontSize: 13, fontWeight: '700', color: '#1e293b' },
});
