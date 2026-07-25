import { useState, useCallback, useEffect } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../../services/api';

const TK = (n) => '৳' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const TABS = [
  { key: '', label: 'সব' }, { key: 'unpaid', label: 'Unpaid' },
  { key: 'partial', label: 'Partial' }, { key: 'paid', label: 'Paid' },
];
const STATUS_COLOR = { unpaid: '#ef4444', partial: '#f59e0b', paid: '#16a34a' };

export default function StaffBillsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [rows, setRows]       = useState([]);
  const [page, setPage]       = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [count, setCount]     = useState(0);
  const [search, setSearch]   = useState('');
  const [status, setStatus]   = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (pg = 1, append = false) => {
    if (pg === 1) setLoading(true); else setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.append('search', search.trim());
      if (status) params.append('status', status);
      params.append('page', pg);
      const r = await api.get(`/app/staff/bills/?${params}`);
      const data = r.data.results || [];
      setRows(append ? prev => [...prev, ...data] : data);
      setHasNext(r.data.has_next); setCount(r.data.count); setPage(pg);
    } catch { if (!append) setRows([]); }
    finally { setLoading(false); setLoadingMore(false); }
  }, [search, status]);

  useEffect(() => { load(1, false); }, [status]); // eslint-disable-line

  const renderItem = ({ item }) => (
    <View style={styles.card}>
      <View style={styles.top}>
        <Text style={styles.name} numberOfLines={1}>{item.client_name}</Text>
        <View style={[styles.badge, { backgroundColor: STATUS_COLOR[item.status] || '#64748b' }]}>
          <Text style={styles.badgeTxt}>{item.status}</Text>
        </View>
      </View>
      <Text style={styles.sub}>🆔 {item.customer_id} · 📅 {item.bill_month}</Text>
      <View style={styles.amts}>
        <Amt label="বিল" value={TK(item.net_amount)} />
        <Amt label="পরিশোধ" value={TK(item.paid_amount)} green />
        <Amt label="বকেয়া" value={TK(item.due_amount)} red={item.due_amount > 0} />
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f1f5f9' }}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>বিল</Text>
        <Text style={styles.count}>{count}</Text>
      </View>
      <View style={styles.searchWrap}>
        <TextInput style={styles.searchInput} placeholder="নাম, code, username..."
          value={search} onChangeText={setSearch} returnKeyType="search"
          onSubmitEditing={() => load(1, false)} placeholderTextColor="#9ca3af" />
        <TouchableOpacity style={styles.searchBtn} onPress={() => load(1, false)}><Text style={{ fontSize: 16 }}>🔍</Text></TouchableOpacity>
      </View>
      <View style={styles.tabs}>
        {TABS.map(t => (
          <TouchableOpacity key={t.key} onPress={() => setStatus(t.key)}
            style={[styles.tab, status === t.key && styles.tabActive]}>
            <Text style={[styles.tabTxt, status === t.key && styles.tabTxtActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {loading ? (
        <ActivityIndicator size="large" color="#3b5998" style={{ marginTop: 40 }} />
      ) : (
        <FlatList data={rows} keyExtractor={r => String(r.id)} renderItem={renderItem}
          contentContainerStyle={{ padding: 14, paddingBottom: 30 }}
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (hasNext && !loadingMore) load(page + 1, true); }}
          ListFooterComponent={loadingMore ? <ActivityIndicator color="#3b5998" style={{ marginVertical: 14 }} /> : null}
          ListEmptyComponent={<Text style={styles.empty}>কোনো বিল নেই।</Text>} />
      )}
    </View>
  );
}

function Amt({ label, value, green, red }) {
  return (
    <View style={styles.amt}>
      <Text style={[styles.amtVal, green && { color: '#16a34a' }, red && { color: '#dc2626' }]}>{value}</Text>
      <Text style={styles.amtLbl}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: '#0f2d42', paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { color: '#cbd5e1', fontSize: 16, fontWeight: '600' },
  title: { color: '#fff', fontSize: 18, fontWeight: '800', flex: 1 },
  count: { color: '#94a3b8', fontSize: 13 },
  searchWrap: { flexDirection: 'row', padding: 12, backgroundColor: '#fff', gap: 8 },
  searchInput: { flex: 1, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, fontSize: 14, color: '#1e293b' },
  searchBtn: { width: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9', borderRadius: 10 },
  tabs: { flexDirection: 'row', backgroundColor: '#fff', paddingHorizontal: 8, paddingBottom: 10, gap: 6 },
  tab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: '#f1f5f9' },
  tabActive: { backgroundColor: '#3b5998' },
  tabTxt: { fontSize: 12.5, color: '#475569', fontWeight: '700' },
  tabTxtActive: { color: '#fff' },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, elevation: 1 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { flex: 1, fontSize: 15, fontWeight: '800', color: '#1e293b' },
  badge: { paddingHorizontal: 9, paddingVertical: 2.5, borderRadius: 10, marginLeft: 8 },
  badgeTxt: { color: '#fff', fontSize: 10, fontWeight: '800' },
  sub: { fontSize: 12.5, color: '#64748b', marginTop: 3 },
  amts: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 10 },
  amt: { alignItems: 'center', flex: 1 },
  amtVal: { fontSize: 14, fontWeight: '800', color: '#1e293b' },
  amtLbl: { fontSize: 10.5, color: '#94a3b8', marginTop: 2 },
  empty: { textAlign: 'center', color: '#94a3b8', marginTop: 50, fontSize: 14 },
});
