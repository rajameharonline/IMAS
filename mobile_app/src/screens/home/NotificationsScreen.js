import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../../services/api';
import ScreenHeader from '../../components/ScreenHeader';
import { timeSince } from '../../utils/helpers';

// HomeScreen-এর bell badge (unread) এই key দিয়ে হিসাব করে
export const NOTIF_LAST_SEEN_KEY = 'notif_last_seen_id';

export default function NotificationsScreen({ navigation }) {
  const [list, setList]             = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/app/me/notifications/');
      const data = r.data || [];
      setList(data);
      // সর্বোচ্চ id = "last seen" → unread badge clear
      if (data.length) {
        const maxId = Math.max(...data.map(n => n.id));
        await AsyncStorage.setItem(NOTIF_LAST_SEEN_KEY, String(maxId));
      }
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return (
    <View style={{ flex: 1, backgroundColor: '#f1f5f9' }}>
      <ScreenHeader
        title="🔔 Notifications"
        subtitle={list.length ? `${list.length} total` : null}
        onBack={() => navigation.goBack()}
      />

      {loading ? (
        <ActivityIndicator color="#173d59" style={{ marginTop: 48 }} />
      ) : (
        <FlatList
          data={list}
          keyExtractor={i => String(i.id)}
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 28 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#173d59" />}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.iconWrap}><Text style={{ fontSize: 17 }}>🔔</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{item.title}</Text>
                {item.body ? <Text style={styles.body}>{item.body}</Text> : null}
                <Text style={styles.time}>{timeSince(item.sent_at)}</Text>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🔔</Text>
              <Text style={styles.emptyText}>No notifications yet.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', gap: 12, backgroundColor: '#fff',
    borderRadius: 14, padding: 14,
    shadowColor: '#0f2d42', shadowOpacity: 0.05, shadowRadius: 5, elevation: 2,
  },
  iconWrap: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#eef2fb',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 14, fontWeight: '800', color: '#0f2d42' },
  body:  { fontSize: 13, color: '#475569', lineHeight: 19, marginTop: 3 },
  time:  { fontSize: 11, color: '#94a3b8', marginTop: 6 },
  empty:     { alignItems: 'center', paddingTop: 70 },
  emptyIcon: { fontSize: 42, marginBottom: 10 },
  emptyText: { color: '#94a3b8', fontSize: 14 },
});
