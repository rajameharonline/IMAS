import { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../../services/api';

const TK = (n) => '৳' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export default function StaffPendingPaymentsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [rows, setRows]       = useState([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState({});   // { id: true }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/app/staff/pending-payments/');
      setRows(r.data.results || []);
      setTotal(r.data.total || 0);
      setSelected({});
    } catch { setRows([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = (id) => setSelected(s => ({ ...s, [id]: !s[id] }));
  const selectedIds = Object.keys(selected).filter(k => selected[k]).map(Number);
  const allSelected = rows.length > 0 && selectedIds.length === rows.length;
  const toggleAll = () => {
    if (allSelected) setSelected({});
    else setSelected(Object.fromEntries(rows.map(r => [r.id, true])));
  };

  const approve = async (ids) => {
    if (!ids.length) return;
    Alert.alert('নিশ্চিত করুন', `${ids.length} টি পেমেন্ট approve করবেন?`, [
      { text: 'বাতিল', style: 'cancel' },
      { text: 'Approve', onPress: async () => {
        setBusy(true);
        try {
          const r = await api.post('/app/staff/pending-payments/', { ids });
          Alert.alert('সফল', `${r.data.updated} টি approve হয়েছে।`);
          await load();
        } catch { Alert.alert('ব্যর্থ', 'আবার চেষ্টা করুন।'); }
        finally { setBusy(false); }
      }},
    ]);
  };

  const renderItem = ({ item }) => {
    const on = !!selected[item.id];
    return (
      <TouchableOpacity style={styles.card} onPress={() => toggle(item.id)} activeOpacity={0.8}>
        <View style={[styles.check, on && styles.checkOn]}>{on && <Text style={styles.checkTick}>✓</Text>}</View>
        <View style={{ flex: 1 }}>
          <View style={styles.topRow}>
            <Text style={styles.amt}>{TK(item.amount)}</Text>
            <Text style={styles.method}>{item.method}</Text>
          </View>
          <Text style={styles.client}>👤 {item.client_name} ({item.customer_id})</Text>
          <Text style={styles.meta}>গৃহীত: {item.received_by || '—'} · {item.date}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f1f5f9' }}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>পেমেন্ট অনুমোদন</Text>
      </View>

      {!loading && rows.length > 0 && (
        <View style={styles.bar}>
          <TouchableOpacity onPress={toggleAll} style={styles.selectAll}>
            <View style={[styles.check, allSelected && styles.checkOn]}>{allSelected && <Text style={styles.checkTick}>✓</Text>}</View>
            <Text style={styles.selectAllTxt}>সব নির্বাচন</Text>
          </TouchableOpacity>
          <Text style={styles.totalTxt}>মোট অপেক্ষমাণ: {TK(total)}</Text>
        </View>
      )}

      {loading ? (
        <ActivityIndicator size="large" color="#3b5998" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={r => String(r.id)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 14, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Text style={styles.empty}>অনুমোদন-অপেক্ষমাণ কোনো পেমেন্ট নেই। ✅</Text>}
        />
      )}

      {selectedIds.length > 0 && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}>
          <TouchableOpacity style={styles.approveBtn} disabled={busy} onPress={() => approve(selectedIds)}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.approveTxt}>{selectedIds.length} টি Approve করুন</Text>}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: '#0f2d42', paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { color: '#cbd5e1', fontSize: 16, fontWeight: '600' },
  title: { color: '#fff', fontSize: 18, fontWeight: '800' },
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 10 },
  selectAll: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectAllTxt: { fontSize: 13.5, color: '#475569', fontWeight: '700' },
  totalTxt: { fontSize: 13, color: '#dc2626', fontWeight: '800' },

  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, elevation: 1 },
  check: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: '#3b5998', borderColor: '#3b5998' },
  checkTick: { color: '#fff', fontSize: 13, fontWeight: '900' },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  amt: { fontSize: 16, fontWeight: '900', color: '#16a34a' },
  method: { fontSize: 12, color: '#64748b', fontWeight: '700' },
  client: { fontSize: 13.5, color: '#1e293b', marginTop: 4 },
  meta: { fontSize: 11.5, color: '#94a3b8', marginTop: 3 },
  empty: { textAlign: 'center', color: '#16a34a', marginTop: 50, fontSize: 14, fontWeight: '600' },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  approveBtn: { backgroundColor: '#16a34a', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  approveTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
