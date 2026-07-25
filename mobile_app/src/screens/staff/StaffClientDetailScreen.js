import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
  Modal, TextInput, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../../services/api';

const TK = (n) => '৳' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const STATUS_COLOR = {
  active: '#16a34a', expired: '#ef4444', suspended: '#f59e0b', inactive: '#64748b',
};
const METHODS = [
  { key: 'cash', label: 'নগদ' }, { key: 'bkash', label: 'bKash' },
  { key: 'nagad', label: 'Nagad' }, { key: 'bank', label: 'ব্যাংক' },
];

function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value || '—'}</Text>
    </View>
  );
}

export default function StaffClientDetailScreen({ route, navigation }) {
  const { id } = route.params;
  const insets = useSafeAreaInsets();
  const [c, setC] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showCollect, setShowCollect] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/app/staff/clients/${id}/`);
      setC(r.data);
      setAmount(String(r.data.due_amount || r.data.monthly_bill || ''));
    } catch { Alert.alert('ত্রুটি', 'Client লোড ব্যর্থ।'); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (action) => {
    setBusy(true);
    try {
      // বিদ্যমান admin endpoint reuse (staff JWT) — radius/mikrotik logic backend-এ
      await api.post(`/clients/${id}/${action}/`);
      Alert.alert('সফল', action === 'enable' ? 'ক্লায়েন্ট চালু হয়েছে।' : 'ক্লায়েন্ট বন্ধ হয়েছে।');
      await load();
    } catch (e) {
      Alert.alert('ব্যর্থ', e.response?.data?.error || e.response?.data?.detail || 'আবার চেষ্টা করুন।');
    } finally { setBusy(false); }
  };

  const collect = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { Alert.alert('ত্রুটি', 'সঠিক পরিমাণ দিন।'); return; }
    setBusy(true);
    try {
      // বিদ্যমান billing payment endpoint reuse — collector হলে admin approval লাগবে
      await api.post('/billing/payments/', { client: id, amount: amt, payment_method: method });
      setShowCollect(false);
      Alert.alert('সফল', `${TK(amt)} কালেকশন রেকর্ড হয়েছে।`);
      await load();
    } catch (e) {
      Alert.alert('ব্যর্থ', e.response?.data?.detail || 'কালেকশন ব্যর্থ।');
    } finally { setBusy(false); }
  };

  if (loading || !c) return <ActivityIndicator size="large" color="#3b5998" style={{ marginTop: 60 }} />;

  return (
    <View style={{ flex: 1, backgroundColor: '#f1f5f9' }}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.htitle} numberOfLines={1}>{c.full_name}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
        {/* Status + due summary */}
        <View style={styles.summary}>
          <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[c.status] || '#64748b' }]}>
            <Text style={styles.statusTxt}>{c.status.toUpperCase()}</Text>
          </View>
          <Text style={styles.due}>{c.due_amount > 0 ? `বকেয়া ${TK(c.due_amount)}` : 'কোনো বকেয়া নেই'}</Text>
          {c.expiry_date ? <Text style={styles.expiry}>মেয়াদ: {c.expiry_date}</Text> : null}
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          {c.status === 'active' ? (
            <TouchableOpacity style={[styles.actBtn, { backgroundColor: '#f59e0b' }]} disabled={busy} onPress={() => doAction('disable')}>
              <Text style={styles.actTxt}>⛔ Disable</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.actBtn, { backgroundColor: '#16a34a' }]} disabled={busy} onPress={() => doAction('enable')}>
              <Text style={styles.actTxt}>✅ Enable</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.actBtn, { backgroundColor: '#0ea5e9' }]} disabled={busy} onPress={() => setShowCollect(true)}>
            <Text style={styles.actTxt}>💵 কালেকশন</Text>
          </TouchableOpacity>
        </View>

        {/* Profile */}
        <Text style={styles.section}>প্রোফাইল</Text>
        <View style={styles.card}>
          <Row label="Customer Code" value={c.customer_id} />
          <Row label="Username" value={c.username} />
          <Row label="মোবাইল" value={c.phone} />
          <Row label="প্যাকেজ" value={c.package} />
          <Row label="জোন" value={c.zone} />
          <Row label="সার্ভার" value={c.router} />
          <Row label="IP" value={c.ip_address} />
          <Row label="MAC" value={c.mac_address} />
          <Row label="মাসিক বিল" value={TK(c.monthly_bill)} />
          <Row label="ঠিকানা" value={c.address} />
        </View>

        {/* Recent payments */}
        <Text style={styles.section}>সাম্প্রতিক পেমেন্ট</Text>
        {c.recent_payments.length === 0 ? (
          <Text style={styles.empty}>কোনো পেমেন্ট নেই।</Text>
        ) : (
          <View style={styles.card}>
            {c.recent_payments.map((p, i) => (
              <View key={i} style={[styles.payRow, i > 0 && styles.payBorder]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.payAmt}>{TK(p.amount)} <Text style={styles.payMethod}>· {p.method}</Text></Text>
                  <Text style={styles.payDate}>{p.date}</Text>
                </View>
                <Text style={[styles.payStatus, { color: p.verified ? '#16a34a' : '#f59e0b' }]}>
                  {p.verified ? '✓ Verified' : '⏳ Pending'}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Collect modal */}
      <Modal visible={showCollect} transparent animationType="fade" onRequestClose={() => setShowCollect(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>কালেকশন — {c.full_name}</Text>
            <Text style={styles.modalLabel}>পরিমাণ (৳)</Text>
            <TextInput style={styles.modalInput} value={amount} onChangeText={setAmount}
              keyboardType="number-pad" placeholder="0" placeholderTextColor="#9ca3af" />
            <Text style={styles.modalLabel}>মাধ্যম</Text>
            <View style={styles.methodRow}>
              {METHODS.map(m => (
                <TouchableOpacity key={m.key} onPress={() => setMethod(m.key)}
                  style={[styles.methodBtn, method === m.key && styles.methodActive]}>
                  <Text style={[styles.methodTxt, method === m.key && styles.methodTxtActive]}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowCollect(false)} disabled={busy}>
                <Text style={styles.cancelTxt}>বাতিল</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={collect} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveTxt}>রেকর্ড করুন</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: '#0f2d42', paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { color: '#cbd5e1', fontSize: 16, fontWeight: '600' },
  htitle: { color: '#fff', fontSize: 17, fontWeight: '800', flex: 1 },

  summary: { backgroundColor: '#fff', borderRadius: 16, padding: 18, alignItems: 'center', marginBottom: 14, elevation: 1 },
  statusBadge: { paddingHorizontal: 16, paddingVertical: 5, borderRadius: 20 },
  statusTxt: { color: '#fff', fontSize: 12, fontWeight: '900' },
  due: { fontSize: 17, fontWeight: '800', color: '#1e293b', marginTop: 10 },
  expiry: { fontSize: 13, color: '#64748b', marginTop: 4 },

  actions: { flexDirection: 'row', gap: 12, marginBottom: 18 },
  actBtn: { flex: 1, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  actTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },

  section: { fontSize: 14, fontWeight: '800', color: '#334155', marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 14, marginBottom: 18, elevation: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 11, borderTopWidth: 1, borderTopColor: '#f5f7fa' },
  rowLabel: { fontSize: 13, color: '#64748b' },
  rowValue: { fontSize: 13.5, color: '#1e293b', fontWeight: '600', flex: 1, textAlign: 'right', marginLeft: 12 },

  payRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  payBorder: { borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  payAmt: { fontSize: 14.5, fontWeight: '800', color: '#16a34a' },
  payMethod: { fontSize: 12, color: '#94a3b8', fontWeight: '600' },
  payDate: { fontSize: 11.5, color: '#94a3b8', marginTop: 2 },
  payStatus: { fontSize: 12, fontWeight: '700' },
  empty: { color: '#94a3b8', fontSize: 13, marginBottom: 18 },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#fff', borderRadius: 18, padding: 20 },
  modalTitle: { fontSize: 16, fontWeight: '900', color: '#1e293b', marginBottom: 14 },
  modalLabel: { fontSize: 12.5, fontWeight: '700', color: '#64748b', marginBottom: 6, marginTop: 6 },
  modalInput: { borderWidth: 1.3, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 18, fontWeight: '800', color: '#1e293b' },
  methodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  methodBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#f1f5f9' },
  methodActive: { backgroundColor: '#3b5998' },
  methodTxt: { fontSize: 13, fontWeight: '700', color: '#475569' },
  methodTxtActive: { color: '#fff' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 18 },
  cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: '#e2e8f0', alignItems: 'center' },
  cancelTxt: { color: '#475569', fontWeight: '800', fontSize: 14 },
  saveBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: '#16a34a', alignItems: 'center' },
  saveTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
