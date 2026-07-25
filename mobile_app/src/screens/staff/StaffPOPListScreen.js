import { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../../services/api';

const TK = (n) => '৳' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

// POP তালিকা — বিদ্যমান /pop/pops/ endpoint reuse (staff JWT)।
export default function StaffPOPListScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [rows, setRows]       = useState([]);
  const [search, setSearch]   = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = search.trim() ? `?search=${encodeURIComponent(search.trim())}&page_size=200` : '?page_size=200';
      const r = await api.get(`/pop/pops/${params}`);
      setRows(r.data.results || r.data);
    } catch { setRows([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, [search]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const renderItem = ({ item }) => (
    <TouchableOpacity style={styles.card} activeOpacity={0.85}
      onPress={() => navigation.navigate('StaffPOPDetail', { id: item.id })}>
      <View style={styles.topRow}>
        <Text style={styles.code}>{item.code}</Text>
        <View style={[styles.typeBadge, { backgroundColor: item.pop_type === 'prepaid' ? '#0ea5e9' : '#f59e0b' }]}>
          <Text style={styles.typeTxt}>{item.pop_type === 'prepaid' ? 'Prepaid' : 'Postpaid'}</Text>
        </View>
        {item.is_locked ? <Text style={styles.locked}>🔒</Text> : null}
      </View>
      <Text style={styles.name}>{item.business_name}</Text>
      <Text style={styles.sub}>👤 {item.contact_person || '—'} · 📱 {item.mobile || '—'}</Text>
      <Text style={styles.sub}>🖥️ {item.server_name || '—'} · {item.tariff_name || '—'}</Text>
      <View style={styles.statRow}>
        <Stat label="Running" value={item.clients_running} />
        <Stat label="Enabled" value={item.clients_enabled} />
        <Stat label="Disabled" value={item.clients_disabled} />
        <Stat label="Fund" value={TK(item.remaining_fund)} green />
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f1f5f9' }}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>POP তালিকা</Text>
      </View>

      <View style={styles.searchWrap}>
        <TextInput style={styles.searchInput} placeholder="Code, নাম, mobile..."
          value={search} onChangeText={setSearch} returnKeyType="search"
          onSubmitEditing={load} placeholderTextColor="#9ca3af" />
        <TouchableOpacity style={styles.searchBtn} onPress={load}><Text style={{ fontSize: 16 }}>🔍</Text></TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#3b5998" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={r => String(r.id)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 14, paddingBottom: 30 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Text style={styles.empty}>কোনো POP নেই।</Text>}
        />
      )}
    </View>
  );
}

function Stat({ label, value, green }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, green && { color: '#16a34a' }]}>{value ?? 0}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: '#0f2d42', paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { color: '#cbd5e1', fontSize: 16, fontWeight: '600' },
  title: { color: '#fff', fontSize: 18, fontWeight: '800' },
  searchWrap: { flexDirection: 'row', padding: 12, backgroundColor: '#fff', gap: 8 },
  searchInput: { flex: 1, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, fontSize: 14, color: '#1e293b' },
  searchBtn: { width: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9', borderRadius: 10 },

  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, elevation: 1 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  code: { fontSize: 13, fontWeight: '900', color: '#3b5998' },
  typeBadge: { paddingHorizontal: 9, paddingVertical: 2.5, borderRadius: 10 },
  typeTxt: { color: '#fff', fontSize: 10, fontWeight: '800' },
  locked: { fontSize: 13, marginLeft: 'auto' },
  name: { fontSize: 15.5, fontWeight: '800', color: '#1e293b', marginBottom: 4 },
  sub: { fontSize: 12.5, color: '#64748b', marginTop: 2 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 10 },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 15, fontWeight: '900', color: '#1e293b' },
  statLabel: { fontSize: 10.5, color: '#94a3b8', marginTop: 2 },
  empty: { textAlign: 'center', color: '#94a3b8', marginTop: 50, fontSize: 14 },
});
