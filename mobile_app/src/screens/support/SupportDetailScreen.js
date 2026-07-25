import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  ActivityIndicator, TextInput, TouchableOpacity, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import api from '../../services/api';
import StatusBadge from '../../components/StatusBadge';
import ScreenHeader from '../../components/ScreenHeader';
import { timeSince } from '../../utils/helpers';

export default function SupportDetailScreen({ route, navigation }) {
  const { ticketId } = route.params;
  const [ticket, setTicket]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply]     = useState('');
  const [sending, setSending] = useState(false);

  const fetchTicket = async () => {
    try {
      const r = await api.get(`/app/tickets/${ticketId}/`);
      setTicket(r.data);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchTicket(); }, [ticketId]);

  const handleReply = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try {
      // গ্রাহকের reply পাঠাই → backend is_client_reply=True হিসেবে সেভ করে
      await api.post(`/app/tickets/${ticketId}/`, { message: reply.trim() });
      setReply('');
      await fetchTicket();   // নতুন reply সহ thread refresh
    } catch {
      Alert.alert('Error', 'উত্তর পাঠানো যায়নি। আবার চেষ্টা করুন।');
    }
    setSending(false);
  };

  if (loading) return (
    <View style={styles.center}><ActivityIndicator size="large" color="#173d59" /></View>
  );

  if (!ticket) return (
    <View style={styles.center}><Text style={{ color: '#94a3b8' }}>Ticket not found.</Text></View>
  );

  const priorityColor = { low: '#64748b', medium: '#f59e0b', high: '#ef4444', critical: '#dc2626' };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#f1f5f9' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      <ScreenHeader title={ticket.subject} onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Ticket Info */}
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.key}>Status</Text>
            <StatusBadge status={ticket.status} />
          </View>
          <View style={styles.row}>
            <Text style={styles.key}>Priority</Text>
            <Text style={[styles.val, { color: priorityColor[ticket.priority] || '#64748b', fontWeight: '700' }]}>
              {ticket.priority?.toUpperCase()}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.key}>Category</Text>
            <Text style={styles.val}>{ticket.category_name || '—'}</Text>
          </View>
          <View style={[styles.row, { borderBottomWidth: 0 }]}>
            <Text style={styles.key}>Created</Text>
            <Text style={styles.val}>{timeSince(ticket.created_at)}</Text>
          </View>
        </View>

        {/* Description */}
        <View style={styles.card}>
          <Text style={styles.descLabel}>Description</Text>
          <Text style={styles.descText}>{ticket.description}</Text>
        </View>

        {/* Replies */}
        {ticket.replies?.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>Conversation</Text>
            {ticket.replies.map((r, i) => (
              <View key={i} style={[styles.bubble, r.is_staff ? styles.staffBubble : styles.clientBubble]}>
                <Text style={[styles.bubbleFrom, r.is_staff ? { color: '#1d4ed8' } : { color: '#166534' }]}>
                  {r.is_staff ? '👤 Support Team' : '🙋 You'}
                </Text>
                <Text style={styles.bubbleText}>{r.message}</Text>
                <Text style={styles.bubbleTime}>{timeSince(r.created_at)}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Reply Input */}
      {ticket.status !== 'closed' && (
        <View style={styles.replyBar}>
          <TextInput
            style={styles.replyInput}
            value={reply}
            onChangeText={setReply}
            placeholder="Write a reply..."
            multiline
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!reply.trim() || sending) && { opacity: 0.4 }]}
            onPress={handleReply}
            disabled={!reply.trim() || sending}
          >
            <Text style={styles.sendBtnText}>Send</Text>
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center:     { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f1f5f9' },
  headerBar:  {
    backgroundColor: '#0f2d42', paddingHorizontal: 20, paddingVertical: 14,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  back:        { color: '#93c5fd', fontSize: 14 },
  headerTitle: { color: '#fff', fontSize: 15, fontWeight: '700', flex: 1, textAlign: 'center', marginHorizontal: 8 },
  card: {
    backgroundColor: '#fff', borderRadius: 14,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  key:      { fontSize: 13, color: '#64748b' },
  val:      { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  descLabel: { fontSize: 12, fontWeight: '700', color: '#475569', paddingHorizontal: 16, paddingTop: 14 },
  descText:  { fontSize: 14, color: '#374151', lineHeight: 22, padding: 16, paddingTop: 6 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#475569', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  bubble: {
    borderRadius: 14, padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 3, elevation: 1,
  },
  staffBubble:  { backgroundColor: '#eff6ff', marginRight: 20 },
  clientBubble: { backgroundColor: '#f0fdf4', marginLeft: 20 },
  bubbleFrom:   { fontSize: 11, fontWeight: '700', marginBottom: 4 },
  bubbleText:   { fontSize: 14, color: '#374151', lineHeight: 20 },
  bubbleTime:   { fontSize: 10, color: '#94a3b8', marginTop: 6 },
  replyBar: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: '#fff',
    borderTopWidth: 1, borderTopColor: '#e2e8f0',
  },
  replyInput: {
    flex: 1, borderWidth: 1.5, borderColor: '#e2e8f0',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
    fontSize: 14, maxHeight: 80,
  },
  sendBtn:     { backgroundColor: '#173d59', borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center' },
  sendBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
