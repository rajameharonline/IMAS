import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../../services/api';

const STATUS_FLOW = [
  { key: 'open',        label: 'Open' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'resolved',    label: 'Resolved' },
  { key: 'closed',      label: 'Closed' },
];
const STATUS_COLOR = {
  open: '#f59e0b', in_progress: '#0ea5e9', resolved: '#16a34a', closed: '#64748b',
};

export default function StaffTicketDetailScreen({ route, navigation }) {
  const { id } = route.params;
  const insets = useSafeAreaInsets();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [changing, setChanging] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/support/tickets/${id}/`);
      setTicket(r.data);
    } catch {
      Alert.alert('ত্রুটি', 'Ticket লোড ব্যর্থ।');
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const sendReply = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try {
      await api.post(`/support/tickets/${id}/reply/`, { message: reply.trim() });
      setReply('');
      await load();
    } catch { Alert.alert('ত্রুটি', 'Reply পাঠানো ব্যর্থ।'); }
    finally { setSending(false); }
  };

  const changeStatus = async (status) => {
    if (status === ticket.status) return;
    setChanging(true);
    try {
      await api.post(`/support/tickets/${id}/change-status/`, { status });
      await load();
    } catch (e) {
      Alert.alert('পরিবর্তন ব্যর্থ', e.response?.data?.detail || 'আবার চেষ্টা করুন।');
    } finally { setChanging(false); }
  };

  if (loading || !ticket) {
    return <ActivityIndicator size="large" color="#3b5998" style={{ marginTop: 60 }} />;
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#f1f5f9' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.ticketNo}>{ticket.ticket_no || ticket.ticket_id}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 20 }}>
        {/* Ticket info */}
        <View style={styles.card}>
          <Text style={styles.subject}>{ticket.subject}</Text>
          <Text style={styles.desc}>{ticket.description}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>👤 {ticket.client_name} ({ticket.client_customer_id})</Text>
          </View>
          {ticket.client_phone ? <Text style={styles.meta}>📱 {ticket.client_phone}</Text> : null}
          <Text style={styles.meta}>🏷️ {ticket.ticket_type_name || '—'} · {ticket.priority_display}</Text>
          <Text style={styles.meta}>🧑‍💼 {ticket.assigned_employee_name || 'Unassigned'}</Text>
        </View>

        {/* Status changer */}
        <Text style={styles.section}>Status পরিবর্তন</Text>
        <View style={styles.statusRow}>
          {STATUS_FLOW.map(s => (
            <TouchableOpacity key={s.key} disabled={changing}
              onPress={() => changeStatus(s.key)}
              style={[styles.statusBtn,
                ticket.status === s.key && { backgroundColor: STATUS_COLOR[s.key], borderColor: STATUS_COLOR[s.key] }]}>
              <Text style={[styles.statusBtnTxt, ticket.status === s.key && { color: '#fff' }]}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Replies thread */}
        <Text style={styles.section}>কথোপকথন</Text>
        {(ticket.replies || []).length === 0 ? (
          <Text style={styles.noReply}>এখনো কোনো reply নেই।</Text>
        ) : (
          ticket.replies.map(r => (
            <View key={r.id}
              style={[styles.bubble, r.is_client_reply ? styles.bubbleClient : styles.bubbleStaff]}>
              <Text style={styles.bubbleWho}>{r.is_client_reply ? 'গ্রাহক' : (r.replied_by_name || 'Staff')}</Text>
              <Text style={styles.bubbleMsg}>{r.message}</Text>
              <Text style={styles.bubbleTime}>{(r.created_at || '').slice(0, 16).replace('T', ' ')}</Text>
            </View>
          ))
        )}
      </ScrollView>

      {/* Reply box */}
      <View style={[styles.replyBar, { paddingBottom: insets.bottom + 8 }]}>
        <TextInput style={styles.replyInput} placeholder="Reply লিখুন..."
          value={reply} onChangeText={setReply} multiline placeholderTextColor="#9ca3af" />
        <TouchableOpacity style={[styles.sendBtn, (!reply.trim() || sending) && { opacity: 0.5 }]}
          onPress={sendReply} disabled={!reply.trim() || sending}>
          {sending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.sendTxt}>পাঠান</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: '#0f2d42', paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { color: '#cbd5e1', fontSize: 16, fontWeight: '600' },
  ticketNo: { color: '#fff', fontSize: 16, fontWeight: '800' },

  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 16, elevation: 1 },
  subject: { fontSize: 17, fontWeight: '800', color: '#1e293b', marginBottom: 6 },
  desc: { fontSize: 14, color: '#475569', lineHeight: 21, marginBottom: 10 },
  metaRow: { marginTop: 2 },
  meta: { fontSize: 13, color: '#64748b', marginTop: 3 },

  section: { fontSize: 14, fontWeight: '800', color: '#334155', marginBottom: 8, marginTop: 4 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  statusBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.3, borderColor: '#cbd5e1', backgroundColor: '#fff' },
  statusBtnTxt: { fontSize: 13, fontWeight: '700', color: '#475569' },

  noReply: { color: '#94a3b8', fontSize: 13, marginBottom: 10 },
  bubble: { borderRadius: 12, padding: 12, marginBottom: 10, maxWidth: '88%' },
  bubbleStaff: { backgroundColor: '#dbeafe', alignSelf: 'flex-end' },
  bubbleClient: { backgroundColor: '#fff', alignSelf: 'flex-start', borderWidth: 1, borderColor: '#e2e8f0' },
  bubbleWho: { fontSize: 11, fontWeight: '800', color: '#3b5998', marginBottom: 3 },
  bubbleMsg: { fontSize: 14, color: '#1e293b', lineHeight: 20 },
  bubbleTime: { fontSize: 10, color: '#94a3b8', marginTop: 5, textAlign: 'right' },

  replyBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  replyInput: { flex: 1, maxHeight: 100, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#1e293b' },
  sendBtn: { backgroundColor: '#3b5998', borderRadius: 18, paddingHorizontal: 18, paddingVertical: 11 },
  sendTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
