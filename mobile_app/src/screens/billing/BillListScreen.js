import { useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import api from '../../services/api';
import ScreenHeader from '../../components/ScreenHeader';
import BkashLogo from '../../components/BkashLogo';
import { fmtDateEn, fmtCurrencyEn } from '../../utils/helpers';

// bill status → English label + colors
const STATUS = {
  paid:           { label: 'PAID',    color: '#15803d', bg: '#dcfce7' },
  unpaid:         { label: 'UNPAID',  color: '#b91c1c', bg: '#fee2e2' },
  partial:        { label: 'PARTIAL', color: '#b45309', bg: '#fef3c7' },
  partially_paid: { label: 'PARTIAL', color: '#b45309', bg: '#fef3c7' },
};

// payment method → label + colors (bKash আলাদাভাবে logo সহ দেখানো হয়)
const METHOD_META = {
  cash:       { label: 'Cash',    icon: '💵', color: '#15803d', bg: '#dcfce7' },
  nagad:      { label: 'Nagad',   icon: '',   color: '#d97706', bg: '#fef3e0' },
  rocket:     { label: 'Rocket',  icon: '🚀', color: '#8B2FC9', bg: '#f3e8ff' },
  bank:       { label: 'Bank',    icon: '🏦', color: '#1565c0', bg: '#e3f0ff' },
  sslcommerz: { label: 'Card',    icon: '💳', color: '#1565c0', bg: '#e3f0ff' },
  advance:    { label: 'Advance', icon: '💰', color: '#0f766e', bg: '#ccfbf1' },
  other:      { label: 'Other',   icon: '',   color: '#64748b', bg: '#e2e8f0' },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "2026-06" → "Jun 2026"
function fmtMonth(ym) {
  if (!ym) return '—';
  const [y, m] = String(ym).split('-');
  const mi = parseInt(m, 10) - 1;
  return `${MONTHS[mi] || m} ${y}`;
}

export default function BillListScreen() {
  const [bills, setBills]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchBills = useCallback(async () => {
    try {
      const r = await api.get('/app/bills/');
      setBills(r.data || []);
    } catch {}
    setLoading(false);
  }, []);

  // screen-এ ঢুকলেই অটো-refresh
  useFocusEffect(useCallback(() => { fetchBills(); }, [fetchBills]));

  const onRefresh = async () => { setRefreshing(true); await fetchBills(); setRefreshing(false); };

  const renderBill = ({ item }) => {
    const st  = STATUS[item.status] || { label: String(item.status || '—').toUpperCase(), color: '#475569', bg: '#e2e8f0' };
    const due = Number(item.due_amount || 0);
    return (
      <View style={styles.card}>
        {/* status accent bar */}
        <View style={[styles.accent, { backgroundColor: st.color }]} />
        <View style={styles.cardBody}>
          {/* top: month + status */}
          <View style={styles.topRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.month}>{fmtMonth(item.bill_month)}</Text>
              <Text style={styles.date}>Created: {fmtDateEn(item.created_at)}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: st.bg }]}>
              <Text style={[styles.badgeTxt, { color: st.color }]}>{st.label}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* amounts */}
          <View style={styles.amountsRow}>
            <View style={styles.amtCol}>
              <Text style={styles.amtLabel}>BILL</Text>
              <Text style={styles.amtVal}>{fmtCurrencyEn(item.amount)}</Text>
            </View>
            <View style={styles.amtSep} />
            <View style={styles.amtCol}>
              <Text style={styles.amtLabel}>PAID</Text>
              <Text style={[styles.amtVal, { color: '#15803d' }]}>{fmtCurrencyEn(item.paid_amount)}</Text>
            </View>
            <View style={styles.amtSep} />
            <View style={styles.amtCol}>
              <Text style={styles.amtLabel}>DUE</Text>
              <Text style={[styles.amtVal, { color: due > 0 ? '#ef4444' : '#15803d' }]}>{fmtCurrencyEn(due)}</Text>
            </View>
          </View>

          {/* footer — payment method (bKash logo / Cash / ...) */}
          {(item.payment_methods || []).length > 0 && (
            <View style={styles.footer}>
              {item.payment_methods.map(m => {
                if (m === 'bkash') {
                  return (
                    <View key={m} style={styles.bkashChip}>
                      <BkashLogo height={13} />
                    </View>
                  );
                }
                const mt = METHOD_META[m] || { label: m, icon: '', color: '#64748b', bg: '#e2e8f0' };
                return (
                  <View key={m} style={[styles.chip, { backgroundColor: mt.bg }]}>
                    <Text style={[styles.chipTxt, { color: mt.color }]}>{mt.icon ? mt.icon + ' ' : ''}{mt.label}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </View>
    );
  };

  if (loading) return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color="#173d59" />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#eef2f7' }}>
      <ScreenHeader title="Bill History" subtitle={bills.length ? `${bills.length} record${bills.length > 1 ? 's' : ''}` : null} />
      <FlatList
        data={bills}
        keyExtractor={item => String(item.id)}
        renderItem={renderBill}
        contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#173d59" />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🧾</Text>
            <Text style={styles.emptyText}>No bills found.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#eef2f7' },
  headerBar:   { backgroundColor: '#0f2d42', paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  headerSub:   { color: '#93c5fd', fontSize: 12, fontWeight: '600' },

  // compact card with left accent
  card: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden',
    shadowColor: '#0f2d42', shadowOpacity: 0.07, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  accent:   { width: 5, alignSelf: 'stretch' },
  cardBody: { flex: 1, paddingVertical: 11, paddingHorizontal: 13 },

  topRow: { flexDirection: 'row', alignItems: 'flex-start' },
  month:  { fontSize: 15, fontWeight: '800', color: '#0f2d42' },
  date:   { fontSize: 11, color: '#94a3b8', marginTop: 1 },
  badge:  { borderRadius: 6, paddingHorizontal: 9, paddingVertical: 3 },
  badgeTxt: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },

  divider: { height: 1, backgroundColor: '#f1f5f9', marginVertical: 9 },

  amountsRow: { flexDirection: 'row', alignItems: 'center' },
  amtCol:   { flex: 1, alignItems: 'center' },
  amtSep:   { width: 1, height: 26, backgroundColor: '#f1f5f9' },
  amtLabel: { fontSize: 9.5, color: '#94a3b8', fontWeight: '700', letterSpacing: 0.5, marginBottom: 2 },
  amtVal:   { fontSize: 15, fontWeight: '900', color: '#1e293b' },

  footer: { flexDirection: 'row', gap: 7, marginTop: 10, flexWrap: 'wrap' },
  chip:   { borderRadius: 14, paddingHorizontal: 9, paddingVertical: 4 },
  chipTxt:{ fontSize: 10.5, fontWeight: '800' },
  // bKash chip — পূর্ণ official lockup (wordmark + পাখি)
  bkashChip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#f6c9dd',
    borderRadius: 14, paddingHorizontal: 9, paddingVertical: 4,
  },

  empty:     { alignItems: 'center', paddingTop: 70 },
  emptyIcon: { fontSize: 42, marginBottom: 10 },
  emptyText: { color: '#94a3b8', fontSize: 14 },
});
