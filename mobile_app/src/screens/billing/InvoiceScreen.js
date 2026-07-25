import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator,
} from 'react-native';
import ScreenHeader from '../../components/ScreenHeader';
import { BkashBird } from '../../components/BkashLogo';
import api from '../../services/api';
import { fmtDate, fmtCurrency } from '../../utils/helpers';

const METHOD_LABEL = {
  cash: 'Cash', bkash: 'bKash', nagad: 'Nagad',
  rocket: 'Rocket', bank: 'Bank', advance: 'Advance', other: 'Other',
};
const METHOD_ICON = {
  cash: '💵', bkash: '💳', nagad: '💰',
  rocket: '🚀', bank: '🏦', advance: '💼', other: '💳',
};
const METHOD_COLOR = {
  cash: '#059669', bkash: '#E2136E', nagad: '#F7941D',
  rocket: '#8B2FC9', bank: '#1565c0', advance: '#0891b2', other: '#374151',
};

export default function InvoiceScreen({ navigation }) {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/app/bills/current/').then(r => {
      setData(r.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) return (
    <View style={[s.screen, { justifyContent: 'center', alignItems: 'center' }]}>
      <ActivityIndicator size="large" color="#3b5998" />
    </View>
  );

  const bill     = data?.current_bill;
  const due      = parseFloat(data?.due_amount || 0);
  const month    = bill?.bill_month || '—';
  const payments = data?.payments || [];
  const verified = payments.filter(p => p.is_verified);

  return (
    <View style={s.screen}>
      <ScreenHeader title={`Invoice of ${month}`} onBack={() => navigation.goBack()} color="#3b5998" />

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        {/* Total + Recharge button */}
        <View style={s.totalRow}>
          <View>
            <Text style={s.totalLabel}>Invoice Total :</Text>
            <Text style={[s.totalVal, { color: due > 0 ? '#e11d48' : '#059669' }]}>
              {fmtCurrency(due)}
            </Text>
          </View>
          <TouchableOpacity
            style={s.rechargeBtn}
            onPress={() => navigation.navigate('Recharge', { billData: data })}
            activeOpacity={0.85}
          >
            <Text style={s.rechargeTxt}>Recharge</Text>
          </TouchableOpacity>
        </View>

        {/* Date info */}
        <View style={s.dateCard}>
          <View style={s.dateRow}>
            <Text style={s.dateLabel}>Generation Date :</Text>
            <Text style={s.dateVal}>{fmtDate(bill?.created_at || data?.current_bill?.created_at)}</Text>
          </View>
          <View style={s.divider} />
          <View style={s.dateRow}>
            <Text style={s.dateLabel}>Expire Date :</Text>
            <Text style={s.dateVal}>{fmtDate(data?.expiry_date)}</Text>
          </View>

          <View style={s.dottedLine} />

          {/* Amounts */}
          {[
            { label: 'Sub-Total :',      val: fmtCurrency(data?.monthly_bill),                   color: '#1e293b' },
            { label: 'Previous Due :',   val: '0',                                                color: '#1e293b' },
            { label: 'Total Amount :',   val: bill ? fmtCurrency(parseFloat(bill.amount || 0)) : 'N/A', color: '#1e293b' },
            { label: 'Paid Amount :',    val: fmtCurrency(bill?.paid_amount),                     color: '#059669' },
          ].map((row, i) => (
            <View key={i} style={s.amountRow}>
              <Text style={s.amountLabel}>{row.label}</Text>
              <Text style={[s.amountVal, { color: row.color }]}>{row.val}</Text>
            </View>
          ))}

          <View style={s.dottedLine} />

          <View style={s.balanceRow}>
            <Text style={s.balanceLabel}>Balance Due :</Text>
            <Text style={[s.balanceVal, { color: due > 0 ? '#e67e22' : '#059669' }]}>
              {fmtCurrency(due)}
            </Text>
          </View>
        </View>

        {/* Client Info */}
        <View style={s.clientCard}>
          {[
            { icon: '👤', label: 'Name:',        val: data?.client_name },
            { icon: '🔢', label: 'Client Code',  val: data?.client_code },
            { icon: '🌐', label: 'Server',       val: data?.username },
            { icon: '📞', label: 'Mobile',       val: data?.phone },
          ].map((item, i) => (
            <View key={i} style={[s.clientRow, i % 2 === 0 && { borderRightWidth: 1, borderRightColor: '#e2e8f0' }]}>
              <Text style={{ fontSize: 22, marginBottom: 4 }}>{item.icon}</Text>
              <Text style={s.clientLabel}>{item.label}</Text>
              <Text style={s.clientVal}>{item.val || '—'}</Text>
            </View>
          ))}
        </View>

        {/* Payments */}
        {verified.length > 0 && (
          <View>
            <Text style={s.sectionTitle}>Payments</Text>
            {verified.map((p, i) => (
              <View key={i} style={s.paymentCard}>
                <View style={[s.payMethodBadge, { backgroundColor: (METHOD_COLOR[p.payment_method] || '#374151') + '18' }]}>
                  {p.payment_method === 'bkash'
                    ? <BkashBird size={26} />
                    : <Text style={{ fontSize: 24 }}>{METHOD_ICON[p.payment_method] || '💳'}</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.payMethodTxt}>{METHOD_LABEL[p.payment_method] || p.payment_method}</Text>
                  <Text style={s.payDateTxt}>{fmtDate(p.date)}</Text>
                  {p.transaction_id ? <Text style={s.payTxTxt}>TxID: {p.transaction_id}</Text> : null}
                </View>
                <Text style={[s.payAmount, { color: METHOD_COLOR[p.payment_method] || '#059669' }]}>
                  {fmtCurrency(p.amount)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Items */}
        <View>
          <Text style={s.sectionTitle}>Items</Text>
          <View style={s.itemCard}>
            <View style={[s.itemIconBox, { backgroundColor: '#eff6ff' }]}>
              <Text style={{ fontSize: 26 }}>📡</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.itemName}>Monthly Bill</Text>
              <Text style={s.itemSub}>{data?.package_name || '—'}</Text>
            </View>
            <Text style={[s.itemAmount, { color: '#059669' }]}>{fmtCurrency(data?.monthly_bill)}</Text>
          </View>
        </View>

        {/* Note */}
        {bill?.notes ? (
          <View>
            <Text style={s.sectionTitle}>Note</Text>
            <View style={s.noteCard}>
              <View style={s.noteDot} />
              <Text style={s.noteTxt}>{bill.notes}</Text>
            </View>
          </View>
        ) : (
          <View>
            <Text style={s.sectionTitle}>Note</Text>
            <View style={s.noteCard}>
              <View style={s.noteDot} />
              <Text style={s.noteTxt}>Thank you</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f0f4f8' },

  header: {
    backgroundColor: '#3b5998',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  backBtn:     { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backTxt:     { color: '#fff', fontSize: 22, fontWeight: '700' },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },

  body: { padding: 14, gap: 14, paddingBottom: 32 },

  // Total Row
  totalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 14,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  totalLabel:  { fontSize: 13, color: '#64748b', marginBottom: 2 },
  totalVal:    { fontSize: 18, fontWeight: '900' },
  rechargeBtn: { backgroundColor: '#3b5998', borderRadius: 22, paddingHorizontal: 22, paddingVertical: 10 },
  rechargeTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // Date Card
  dateCard: {
    backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 4,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  dateRow:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  dateLabel: { fontSize: 13, color: '#64748b' },
  dateVal:   { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  divider:   { height: 1, backgroundColor: '#f1f5f9' },
  dottedLine: { height: 1, borderWidth: 1, borderColor: '#e2e8f0', borderStyle: 'dashed', marginVertical: 4 },
  amountRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  amountLabel:{ fontSize: 13, color: '#64748b' },
  amountVal:  { fontSize: 13, fontWeight: '600' },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 },
  balanceLabel:{ fontSize: 15, fontWeight: '800', color: '#1e293b' },
  balanceVal:  { fontSize: 17, fontWeight: '900' },

  // Client Card
  clientCard: {
    backgroundColor: '#f8fafc', borderRadius: 14, flexDirection: 'row', flexWrap: 'wrap',
    borderWidth: 1, borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  clientRow: { width: '50%', padding: 14, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  clientLabel: { fontSize: 11, color: '#94a3b8' },
  clientVal:   { fontSize: 14, fontWeight: '700', color: '#1e293b', marginTop: 2 },

  sectionTitle: { fontSize: 13, color: '#64748b', fontWeight: '600', marginBottom: 8 },

  // Payment Card
  paymentCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    marginBottom: 8,
  },
  payMethodBadge: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  payMethodTxt:   { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  payDateTxt:     { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  payTxTxt:       { fontSize: 10, color: '#94a3b8', marginTop: 1 },
  payAmount:      { fontSize: 16, fontWeight: '900' },

  // Item Card
  itemCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  itemIconBox: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  itemName:    { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  itemSub:     { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  itemAmount:  { fontSize: 16, fontWeight: '900' },

  // Note
  noteCard:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  noteDot:   { width: 10, height: 10, borderRadius: 5, backgroundColor: '#94a3b8' },
  noteTxt:   { fontSize: 14, color: '#475569' },
});
