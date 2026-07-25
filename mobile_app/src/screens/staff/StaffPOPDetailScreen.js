import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../../services/api';

const TK = (n) => '৳' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value || '—'}</Text>
    </View>
  );
}

export default function StaffPOPDetailScreen({ route, navigation }) {
  const { id } = route.params;
  const insets = useSafeAreaInsets();
  const [pop, setPop] = useState(null);
  const [fundings, setFundings] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [p, f] = await Promise.allSettled([
        api.get(`/pop/pops/${id}/`),
        api.get(`/pop/fundings/?pop=${id}&page_size=20`),
      ]);
      if (p.status === 'fulfilled') setPop(p.value.data);
      if (f.status === 'fulfilled') setFundings(f.value.data.results || f.value.data);
    } catch { setPop(null); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading || !pop) return <ActivityIndicator size="large" color="#3b5998" style={{ marginTop: 60 }} />;

  return (
    <View style={{ flex: 1, backgroundColor: '#f1f5f9' }}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{pop.business_name}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
        <View style={styles.summary}>
          <Text style={styles.code}>{pop.code}</Text>
          <Text style={styles.fund}>{TK(pop.fund_start)} ফান্ড</Text>
          <Text style={styles.type}>{pop.pop_type === 'prepaid' ? 'Prepaid' : 'Postpaid'} · {pop.is_locked ? '🔒 Locked' : '🔓 Active'}</Text>
        </View>

        <Text style={styles.section}>তথ্য</Text>
        <View style={styles.card}>
          <Row label="Contact Person" value={pop.contact_person} />
          <Row label="মোবাইল" value={pop.mobile} />
          <Row label="ইমেইল" value={pop.email} />
          <Row label="Tariff" value={pop.tariff_name} />
          <Row label="জেলা" value={pop.district_name} />
          <Row label="উপজেলা" value={pop.upazila_name} />
          <Row label="জোন" value={pop.zone_name} />
          <Row label="Min. Recharge" value={TK(pop.min_rechargeable_amount)} />
          <Row label="ঠিকানা" value={pop.address} />
        </View>

        <Text style={styles.section}>ফান্ডিং ইতিহাস</Text>
        {fundings.length === 0 ? (
          <Text style={styles.empty}>কোনো ফান্ডিং রেকর্ড নেই।</Text>
        ) : (
          <View style={styles.card}>
            {fundings.map((f, i) => (
              <View key={f.id} style={[styles.fundRow, i > 0 && styles.fundB]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fundAmt}>{TK(f.fund_amount)}</Text>
                  <Text style={styles.fundMeta}>{f.invoice_number} · {f.funding_date}</Text>
                </View>
                <Text style={styles.fundStatus}>{f.trans_status}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: '#0f2d42', paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { color: '#cbd5e1', fontSize: 16, fontWeight: '600' },
  title: { color: '#fff', fontSize: 17, fontWeight: '800', flex: 1 },
  summary: { backgroundColor: '#fff', borderRadius: 16, padding: 18, alignItems: 'center', marginBottom: 16, elevation: 1 },
  code: { fontSize: 14, fontWeight: '900', color: '#3b5998' },
  fund: { fontSize: 22, fontWeight: '900', color: '#16a34a', marginTop: 6 },
  type: { fontSize: 13, color: '#64748b', marginTop: 4 },
  section: { fontSize: 14, fontWeight: '800', color: '#334155', marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 14, marginBottom: 18, elevation: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 11, borderTopWidth: 1, borderTopColor: '#f5f7fa' },
  rowLabel: { fontSize: 13, color: '#64748b' },
  rowValue: { fontSize: 13.5, color: '#1e293b', fontWeight: '600', flex: 1, textAlign: 'right', marginLeft: 12 },
  fundRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  fundB: { borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  fundAmt: { fontSize: 15, fontWeight: '800', color: '#16a34a' },
  fundMeta: { fontSize: 11.5, color: '#94a3b8', marginTop: 2 },
  fundStatus: { fontSize: 12, fontWeight: '700', color: '#64748b' },
  empty: { color: '#94a3b8', fontSize: 13, marginBottom: 18 },
});
