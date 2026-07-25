import { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../../services/api';

const STATUS_TABS = [
  { key: '',            label: 'সব' },
  { key: 'open',        label: 'Open' },
  { key: 'in_progress', label: 'চলমান' },
  { key: 'resolved',    label: 'সমাধান' },
  { key: 'closed',      label: 'বন্ধ' },
];

const PRIORITY_COLOR = {
  low: '#64748b', medium: '#0ea5e9', high: '#f59e0b',
  critical: '#dc2626', urgent: '#dc2626',
};
const STATUS_COLOR = {
  open: '#f59e0b', in_progress: '#0ea5e9', resolved: '#16a34a', closed: '#64748b',
};

export default function StaffSupportListScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [tickets, setTickets]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(async (status = statusFilter) => {
    try {
      const params = status ? `?status=${status}` : '';
      const r = await api.get(`/support/tickets/${params}`);
      setTickets(r.data.results || r.data);
    } catch {
      setTickets([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [statusFilter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onTab = (key) => { setStatusFilter(key); setLoading(true); load(key); };

  const renderItem = ({ item }) => (
    <TouchableOpacity style={styles.card}
      onPress={() => navigation.navigate('StaffTicketDetail', { id: item.id })}
      activeOpacity={0.85}>
      <View style={styles.cardTop}>
        <Text style={styles.ticketNo}>{item.ticket_no || item.ticket_id}</Text>
        <View style={[styles.badge, { backgroundColor: STATUS_COLOR[item.status] || '#64748b' }]}>
          <Text style={styles.badgeTxt}>{item.status_display || item.status}</Text>
        </View>
      </View>
      <Text style={styles.subject} numberOfLines={1}>{item.subject}</Text>
      <View style={styles.cardBottom}>
        <Text style={styles.client}>👤 {item.client_name || '—'}</Text>
        <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLOR[item.priority] || '#64748b' }]} />
        <Text style={styles.priority}>{item.priority_display || item.priority}</Text>
      </View>
      {item.assigned_employee_name ? (
        <Text style={styles.assigned}>🧑‍💼 {item.assigned_employee_name}</Text>
      ) : <Text style={styles.unassigned}>● Unassigned</Text>}
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f1f5f9' }}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Text style={styles.title}>Support Inbox</Text>
      </View>

      {/* Status filter tabs */}
      <View style={styles.tabs}>
        {STATUS_TABS.map(t => (
          <TouchableOpacity key={t.key} onPress={() => onTab(t.key)}
            style={[styles.tab, statusFilter === t.key && styles.tabActive]}>
            <Text style={[styles.tabTxt, statusFilter === t.key && styles.tabTxtActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#3b5998" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={tickets}
          keyExtractor={t => String(t.id)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 14, paddingBottom: 30 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={<Text style={styles.empty}>কোনো ticket নেই।</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: '#0f2d42', paddingHorizontal: 20, paddingBottom: 16 },
  title: { color: '#fff', fontSize: 20, fontWeight: '900' },
  tabs: { flexDirection: 'row', backgroundColor: '#fff', paddingHorizontal: 8, paddingVertical: 8, gap: 6 },
  tab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#f1f5f9' },
  tabActive: { backgroundColor: '#3b5998' },
  tabTxt: { fontSize: 12.5, color: '#475569', fontWeight: '700' },
  tabTxtActive: { color: '#fff' },

  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, elevation: 1 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  ticketNo: { fontSize: 12, fontWeight: '800', color: '#3b5998' },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  badgeTxt: { color: '#fff', fontSize: 10.5, fontWeight: '800' },
  subject: { fontSize: 15, fontWeight: '700', color: '#1e293b', marginBottom: 8 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  client: { fontSize: 13, color: '#475569', flex: 1 },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  priority: { fontSize: 12, color: '#64748b', fontWeight: '600' },
  assigned: { marginTop: 6, fontSize: 12, color: '#16a34a' },
  unassigned: { marginTop: 6, fontSize: 12, color: '#dc2626' },
  empty: { textAlign: 'center', color: '#94a3b8', marginTop: 50, fontSize: 14 },
});
