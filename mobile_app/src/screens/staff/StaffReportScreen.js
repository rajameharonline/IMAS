import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../../services/api';

const TK = (n) => '৳' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const todayStr = () => new Date().toISOString().slice(0, 10);
const monthStart = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };

const METHOD_LABEL = {
  cash: 'নগদ', bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket',
  bank: 'ব্যাংক', sslcommerz: 'SSLCommerz', advance: 'Advance', other: 'অন্যান্য',
};

const RANGES = [
  { key: 'today', label: 'আজ' },
  { key: 'week',  label: '৭ দিন' },
  { key: 'month', label: 'এ মাস' },
];

export default function StaffReportScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [range, setRange] = useState('month');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const computeRange = (key) => {
    const to = todayStr();
    if (key === 'today') return { from: to, to };
    if (key === 'week') {
      const d = new Date(); d.setDate(d.getDate() - 6);
      return { from: d.toISOString().slice(0, 10), to };
    }
    return { from: monthStart(), to };
  };

  const load = useCallback(async (key) => {
    setLoading(true);
    const { from, to } = computeRange(key);
    try {
      const r = await api.get(`/app/staff/reports/daily-collection/?from=${from}&to=${to}`);
      setData(r.data);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(range); }, [range, load]);

  return (
    <View style={{ flex: 1, backgroundColor: '#f1f5f9' }}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>কালেকশন রিপোর্ট</Text>
      </View>

      {/* Range selector */}
      <View style={styles.ranges}>
        {RANGES.map(r => (
          <TouchableOpacity key={r.key} onPress={() => setRange(r.key)}
            style={[styles.rangeBtn, range === r.key && styles.rangeActive]}>
            <Text style={[styles.rangeTxt, range === r.key && styles.rangeTxtActive]}>{r.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#3b5998" style={{ marginTop: 40 }} />
      ) : !data ? (
        <Text style={styles.err}>ডেটা লোড ব্যর্থ।</Text>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
          {/* Grand total */}
          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>মোট কালেকশন</Text>
            <Text style={styles.totalValue}>{TK(data.grand_total)}</Text>
            <Text style={styles.totalSub}>{data.grand_count} টি পেমেন্ট · {data.from} → {data.to}</Text>
          </View>

          {/* Method breakdown */}
          <Text style={styles.section}>পেমেন্ট মাধ্যম</Text>
          {data.methods.length === 0 ? (
            <Text style={styles.empty}>কোনো পেমেন্ট নেই।</Text>
          ) : (
            <View style={styles.card}>
              {data.methods.map((m, i) => (
                <View key={m.method} style={[styles.row, i > 0 && styles.rowBorder]}>
                  <Text style={styles.rowLabel}>{METHOD_LABEL[m.method] || m.method}</Text>
                  <Text style={styles.rowCount}>{m.count} টি</Text>
                  <Text style={styles.rowAmt}>{TK(m.total)}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Daily breakdown */}
          <Text style={styles.section}>দৈনিক</Text>
          {data.daily.length === 0 ? (
            <Text style={styles.empty}>এই সময়ে কোনো কালেকশন নেই।</Text>
          ) : (
            <View style={styles.card}>
              {data.daily.map((d, i) => (
                <View key={d.date} style={[styles.row, i > 0 && styles.rowBorder]}>
                  <Text style={styles.rowLabel}>{d.date}</Text>
                  <Text style={styles.rowCount}>{d.count} টি</Text>
                  <Text style={styles.rowAmt}>{TK(d.total)}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: '#0f2d42', paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { color: '#cbd5e1', fontSize: 16, fontWeight: '600' },
  title: { color: '#fff', fontSize: 18, fontWeight: '800' },

  ranges: { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: '#fff' },
  rangeBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, backgroundColor: '#f1f5f9' },
  rangeActive: { backgroundColor: '#3b5998' },
  rangeTxt: { fontSize: 13, fontWeight: '700', color: '#475569' },
  rangeTxtActive: { color: '#fff' },

  totalCard: { backgroundColor: '#0f2d42', borderRadius: 16, padding: 20, alignItems: 'center', marginBottom: 18 },
  totalLabel: { color: '#94a3b8', fontSize: 13 },
  totalValue: { color: '#fff', fontSize: 34, fontWeight: '900', marginTop: 4 },
  totalSub: { color: '#cbd5e1', fontSize: 12, marginTop: 6 },

  section: { fontSize: 14, fontWeight: '800', color: '#334155', marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 14, marginBottom: 18, elevation: 1 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  rowBorder: { borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  rowLabel: { flex: 1, fontSize: 14, color: '#1e293b', fontWeight: '600' },
  rowCount: { fontSize: 12.5, color: '#94a3b8', marginRight: 14 },
  rowAmt: { fontSize: 14, fontWeight: '800', color: '#16a34a' },
  empty: { color: '#94a3b8', fontSize: 13, marginBottom: 18 },
  err: { color: '#ef4444', textAlign: 'center', marginTop: 40, fontSize: 14 },
});
