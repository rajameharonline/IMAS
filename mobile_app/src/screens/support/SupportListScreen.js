import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl, ActivityIndicator,
} from 'react-native';
import api from '../../services/api';
import StatusBadge from '../../components/StatusBadge';
import ScreenHeader from '../../components/ScreenHeader';
import { timeSince } from '../../utils/helpers';

export default function SupportListScreen({ navigation }) {
  const [tickets, setTickets]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchTickets = useCallback(async () => {
    try {
      const r = await api.get('/app/tickets/');
      setTickets(r.data);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchTickets();
    setRefreshing(false);
  };

  const priorityColor = { low: '#64748b', medium: '#f59e0b', high: '#ef4444', critical: '#dc2626', urgent: '#7c3aed' };

  const renderTicket = ({ item }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => navigation.navigate('SupportDetail', { ticketId: item.id })}
      activeOpacity={0.75}
    >
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.subject} numberOfLines={1}>{item.subject}</Text>
          <Text style={styles.category}>{item.category_name || 'General'}</Text>
        </View>
        <StatusBadge status={item.status} />
      </View>
      <View style={styles.cardBottom}>
        <View style={[styles.priorityDot, { backgroundColor: priorityColor[item.priority] || '#64748b' }]} />
        <Text style={[styles.priority, { color: priorityColor[item.priority] || '#64748b' }]}>
          {item.priority?.toUpperCase()}
        </Text>
        <Text style={styles.time}>{timeSince(item.created_at)}</Text>
      </View>
    </TouchableOpacity>
  );

  if (loading) return (
    <View style={styles.center}><ActivityIndicator size="large" color="#173d59" /></View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f1f5f9' }}>
      <ScreenHeader
        title="Support Tickets"
        right={
          <TouchableOpacity style={styles.newBtn} onPress={() => navigation.navigate('SupportCreate')}>
            <Text style={styles.newBtnText}>+ New</Text>
          </TouchableOpacity>
        }
      />
      <FlatList
        data={tickets}
        keyExtractor={item => String(item.id)}
        renderItem={renderTicket}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🎫</Text>
            <Text style={styles.emptyText}>No tickets yet.</Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('SupportCreate')}
              style={styles.emptyBtn}
            >
              <Text style={styles.emptyBtnText}>Report a new issue</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center:     { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f1f5f9' },
  headerBar:  {
    backgroundColor: '#0f2d42', paddingHorizontal: 20, paddingVertical: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  newBtn:      { backgroundColor: '#1f5075', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 },
  newBtnText:  { color: '#93c5fd', fontWeight: '700', fontSize: 13 },
  card: {
    backgroundColor: '#fff', borderRadius: 14,
    padding: 14,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  cardTop:    { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  subject:    { fontSize: 14, fontWeight: '700', color: '#1e293b', flex: 1 },
  category:   { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  priorityDot: { width: 7, height: 7, borderRadius: 3.5 },
  priority:   { fontSize: 10, fontWeight: '700', flex: 1 },
  time:       { fontSize: 11, color: '#94a3b8' },
  empty:      { alignItems: 'center', paddingTop: 60 },
  emptyIcon:  { fontSize: 40, marginBottom: 12 },
  emptyText:  { color: '#94a3b8', fontSize: 14, marginBottom: 16 },
  emptyBtn:   { backgroundColor: '#173d59', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  emptyBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});
