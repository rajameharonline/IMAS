import { useState, useCallback, useEffect } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../../services/api';

const STATUS_TABS = [
  { key: '',          label: 'সব' },
  { key: 'active',    label: 'Active' },
  { key: 'expired',   label: 'Expired' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'inactive',  label: 'Inactive' },
];
const STATUS_COLOR = {
  active: '#16a34a', expired: '#ef4444', suspended: '#f59e0b', inactive: '#64748b',
};
const TK = (n) => '৳' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export default function StaffClientListScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [search, setSearch]   = useState('');
  const [status, setStatus]   = useState('');
  const [rows, setRows]       = useState([]);
  const [page, setPage]       = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [count, setCount]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (pg = 1, append = false) => {
    if (pg === 1) setLoading(true); else setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.append('search', search.trim());
      if (status) params.append('status', status);
      params.append('page', pg);
      const r = await api.get(`/app/staff/clients/?${params}`);
      const data = r.data.results || [];
      setRows(append ? [...rows, ...data] : data);
      setHasNext(r.data.has_next);
      setCount(r.data.count);
      setPage(pg);
    } catch { if (!append) setRows([]); }
    finally { setLoading(false); setLoadingMore(false); }
  }, [search, status, rows]);

  // status পরিবর্তনে reload
  useEffect(() => { load(1, false); /* eslint-disable-next-line */ }, [status]);
  useFocusEffect(useCallback(() => { load(1, false); /* eslint-disable-next-line */ }, [status]));

  const renderItem = ({ item }) => (
    <TouchableOpacity style={styles.card}
      onPress={() => navigation.navigate('StaffClientDetail', { id: item.id })}
      activeOpacity={0.85}>
      <View style={{ flex: 1 }}>
        <View style={styles.topRow}>
          <Text style={styles.name} numberOfLines={1}>{item.full_name}</Text>
          <View style={[styles.badge, { backgroundColor: STATUS_COLOR[item.status] || '#64748b' }]}>
            <Text style={styles.badgeTxt}>{item.status}</Text>
          </View>
        </View>
        <Text style={styles.sub}>🆔 {item.customer_id} · {item.username}</Text>
        <Text style={styles.sub}>📦 {item.package || '—'} · 📍 {item.zone || '—'}</Text>
        <View style={styles.botRow}>
          <Text style={styles.bill}>মাসিক {TK(item.monthly_bill)}</Text>
          {item.due_amount > 0
            ? <Text style={styles.due}>বকেয়া {TK(item.due_amount)}</Text>
            : <Text style={styles.noDue}>বকেয়া নেই</Text>}
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f1f5f9' }}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Text style={styles.title}>ক্লায়েন্ট</Text>
        <Text style={styles.count}>{count} জন</Text>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <TextInput style={styles.searchInput} placeholder="Code, নাম, username, mobile..."
          value={search} onChangeText={setSearch} returnKeyType="search"
          onSubmitEditing={() => load(1, false)} placeholderTextColor="#9ca3af" />
        <TouchableOpacity style={styles.searchBtn} onPress={() => load(1, false)}>
          <Text style={{ fontSize: 16 }}>🔍</Text>
        </TouchableOpacity>
      </View>

      {/* Status tabs */}
      <View style={styles.tabs}>
        {STATUS_TABS.map(t => (
          <TouchableOpacity key={t.key} onPress={() => setStatus(t.key)}
            style={[styles.tab, status === t.key && styles.tabActive]}>
            <Text style={[styles.tabTxt, status === t.key && styles.tabTxtActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#3b5998" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={r => String(r.id)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 14, paddingBottom: 30 }}
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (hasNext && !loadingMore) load(page + 1, true); }}
          ListFooterComponent={loadingMore ? <ActivityIndicator color="#3b5998" style={{ marginVertical: 14 }} /> : null}
          ListEmptyComponent={<Text style={styles.empty}>কোনো ক্লায়েন্ট পাওয়া যায়নি।</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: '#0f2d42', paddingHorizontal: 20, paddingBottom: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  title: { color: '#fff', fontSize: 20, fontWeight: '900' },
  count: { color: '#94a3b8', fontSize: 13 },
  searchWrap: { flexDirection: 'row', padding: 12, backgroundColor: '#fff', gap: 8 },
  searchInput: { flex: 1, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, fontSize: 14, color: '#1e293b' },
  searchBtn: { width: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9', borderRadius: 10 },
  tabs: { flexDirection: 'row', backgroundColor: '#fff', paddingHorizontal: 8, paddingBottom: 10, gap: 6, flexWrap: 'wrap' },
  tab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#f1f5f9' },
  tabActive: { backgroundColor: '#3b5998' },
  tabTxt: { fontSize: 12.5, color: '#475569', fontWeight: '700' },
  tabTxtActive: { color: '#fff' },

  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', elevation: 1 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  name: { flex: 1, fontSize: 15.5, fontWeight: '800', color: '#1e293b' },
  badge: { paddingHorizontal: 9, paddingVertical: 2.5, borderRadius: 10, marginLeft: 8 },
  badgeTxt: { color: '#fff', fontSize: 10, fontWeight: '800' },
  sub: { fontSize: 12.5, color: '#64748b', marginTop: 2 },
  botRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  bill: { fontSize: 13, color: '#475569', fontWeight: '600' },
  due: { fontSize: 13, color: '#dc2626', fontWeight: '800' },
  noDue: { fontSize: 12.5, color: '#16a34a', fontWeight: '600' },
  empty: { textAlign: 'center', color: '#94a3b8', marginTop: 50, fontSize: 14 },
});
