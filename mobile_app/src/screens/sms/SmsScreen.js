import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import api from '../../services/api';
import ScreenHeader from '../../components/ScreenHeader';

const SMS_STATUS = {
  sent:      { label: 'SENT',      color: '#2563eb', bg: '#eff6ff' },
  delivered: { label: 'DELIVERED', color: '#16a34a', bg: '#f0fdf4' },
  failed:    { label: 'FAILED',    color: '#dc2626', bg: '#fef2f2' },
  pending:   { label: 'PENDING',   color: '#d97706', bg: '#fffbeb' },
};
const fmtSmsDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB')} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};

export default function SmsScreen() {
  const [list, setList]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/app/me/sms/');
      setList(r.data || []);
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
      <ScreenHeader title="📩 SMS History" subtitle={list.length ? `${list.length} message${list.length > 1 ? 's' : ''}` : null} />

      {loading ? (
        <ActivityIndicator color="#173d59" style={{ marginTop: 48 }} />
      ) : list.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyTxt}>No SMS found.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#173d59" />}
        >
          {list.map(s => {
            const st = SMS_STATUS[s.status] || SMS_STATUS.pending;
            return (
              <View key={s.id} style={styles.item}>
                <View style={styles.itemTop}>
                  <View style={[styles.status, { backgroundColor: st.bg }]}>
                    <Text style={[styles.statusTxt, { color: st.color }]}>{st.label}</Text>
                  </View>
                  <Text style={styles.date}>{fmtSmsDate(s.sent_at)}</Text>
                </View>
                <Text style={styles.msg}>{s.message}</Text>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  emptyBox:    { alignItems: 'center', marginTop: 64 },
  emptyIcon:   { fontSize: 44, marginBottom: 10 },
  emptyTxt:    { color: '#94a3b8', fontSize: 14 },
  item: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  itemTop:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  status:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusTxt: { fontSize: 10, fontWeight: '800' },
  date:      { fontSize: 10, color: '#94a3b8' },
  msg:       { fontSize: 13, color: '#334155', lineHeight: 19 },
});
