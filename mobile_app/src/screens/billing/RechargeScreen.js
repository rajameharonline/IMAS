import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import api from '../../services/api';
import ScreenHeader from '../../components/ScreenHeader';
import BkashLogo from '../../components/BkashLogo';

export default function RechargeScreen({ route, navigation }) {
  const [months, setMonths]           = useState(1);
  const [loading, setLoading]         = useState(false);   // bKash initiate loading
  const [billData, setBillData]       = useState(route.params?.billData || null);
  const [dataLoading, setDataLoading] = useState(!route.params?.billData);

  // params-এ data না থাকলে বা monthly_bill = 0 হলে নতুন করে fetch
  useEffect(() => {
    const params = route.params?.billData;
    const needsFetch = !params || parseFloat(params?.monthly_bill || 0) === 0;
    if (needsFetch) {
      setDataLoading(true);
      api.get('/app/bills/current/').then(r => {
        setBillData(r.data);
      }).catch(() => {}).finally(() => setDataLoading(false));
    }
  }, []);

  const monthly     = parseFloat(billData?.monthly_bill || 0);
  const due         = parseFloat(billData?.due_amount || 0);
  const rechargeAmt = due > 0 ? due + monthly * (months - 1) : monthly * months;
  const pkg         = billData?.package_name || '—';

  // bKash Tokenized Checkout — সরাসরি initiate করে in-app WebView খোলে
  const handleRecharge = async () => {
    if (rechargeAmt <= 0) { Alert.alert('Error', 'Invalid recharge amount.'); return; }
    setLoading(true);
    try {
      const initR = await api.post('/app/payments/bkash/initiate/', {
        amount: rechargeAmt.toFixed(0),
        months,
      });
      navigation.navigate('BkashWebView', {
        bkashUrl:  initR.data.bkash_url,
        paymentId: initR.data.payment_id,
        amount:    rechargeAmt.toFixed(0),
      });
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Could not connect to bKash. Please try again.';
      Alert.alert('bKash Issue', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={s.screen}>
      <ScreenHeader title="Recharge" onBack={() => navigation.goBack()} color="#1e3a5f" />

      <ScrollView contentContainerStyle={s.body}>
        <Text style={s.pageTitle}>Bill Recharge Summary</Text>

        {dataLoading && (
          <View style={{ alignItems: 'center', paddingVertical: 12 }}>
            <ActivityIndicator color="#4a6741" />
          </View>
        )}

        {/* Total Amount Card */}
        <View style={s.totalCard}>
          <Text style={s.totalCardLabel}>Total Rechargeable Amount</Text>
          <Text style={s.totalCardAmount}>৳ {rechargeAmt.toFixed(0)}</Text>
          <Text style={s.totalCardNote}>Amount includes all taxes</Text>
        </View>

        {/* Package */}
        <View style={s.infoSection}>
          <View style={s.infoRow}>
            <Text style={s.infoKey}>Package : </Text>
            <Text style={s.infoVal}>{pkg}</Text>
          </View>
          <Text style={s.infoHint}>You're currently using internet package :</Text>
          <View style={[s.infoRow, { marginTop: 16 }]}>
            <Text style={s.infoKey}>Monthly Bill : </Text>
            <Text style={s.infoVal}>{monthly.toFixed(1)}  TK</Text>
          </View>
          <Text style={s.infoHint}>
            This is your monthly internet bill, you have to pay this amount every month if you want to continue this package
          </Text>
        </View>

        {/* Month Selector */}
        <View style={s.monthSection}>
          <Text style={s.monthTitle}>No. of Month You Want to Recharge?</Text>
          <View style={s.monthRow}>
            <TouchableOpacity style={s.monthBtn} onPress={() => setMonths(m => Math.max(1, m - 1))} activeOpacity={0.7}>
              <Text style={s.monthMinus}>—</Text>
            </TouchableOpacity>
            <Text style={s.monthCount}>{months}</Text>
            <TouchableOpacity style={s.monthBtn} onPress={() => setMonths(m => Math.min(12, m + 1))} activeOpacity={0.7}>
              <Text style={s.monthPlus}>+</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.infoHint}>
            This is the number of your billing month, choose how many number of months internet bill you want to pay as advance
          </Text>
        </View>
      </ScrollView>

      {/* Bottom Buttons */}
      <View style={s.bottomRow}>
        <TouchableOpacity style={s.cancelBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <Text style={s.cancelTxt}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.rechargeBtn, loading && { opacity: 0.7 }]}
          onPress={handleRecharge}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : (
              <>
                <Text style={s.rechargeTxt}>Pay with</Text>
                <View style={s.bkashBadge}><BkashLogo height={16} /></View>
              </>
            )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },

  body:      { padding: 20, gap: 20, paddingBottom: 20 },
  pageTitle: { fontSize: 17, fontWeight: '800', color: '#1e293b' },

  totalCard: { backgroundColor: '#4a6741', borderRadius: 14, padding: 20, gap: 6 },
  totalCardLabel:  { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '600' },
  totalCardAmount: { color: '#fff', fontSize: 30, fontWeight: '900' },
  totalCardNote:   { color: 'rgba(255,255,255,0.65)', fontSize: 12 },

  infoSection: { gap: 4 },
  infoRow:  { flexDirection: 'row', alignItems: 'baseline' },
  infoKey:  { fontSize: 16, fontWeight: '800', color: '#1e293b' },
  infoVal:  { fontSize: 16, fontWeight: '800', color: '#1e293b' },
  infoHint: { fontSize: 13, color: '#94a3b8', lineHeight: 19, marginTop: 2 },

  monthSection: { gap: 12 },
  monthTitle:   { fontSize: 16, fontWeight: '800', color: '#1e293b' },
  monthRow:     { flexDirection: 'row', alignItems: 'center', gap: 20 },
  monthBtn:     { width: 100, height: 50, backgroundColor: '#e9ecef', borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  monthMinus:   { color: '#ef4444', fontSize: 22, fontWeight: '900' },
  monthPlus:    { color: '#22c55e', fontSize: 22, fontWeight: '900' },
  monthCount:   { fontSize: 22, fontWeight: '900', color: '#1e293b', minWidth: 36, textAlign: 'center' },

  bottomRow: {
    flexDirection: 'row', gap: 12,
    paddingHorizontal: 20, paddingVertical: 16,
    borderTopWidth: 1, borderTopColor: '#f1f5f9', backgroundColor: '#fff',
  },
  cancelBtn:  { flex: 1, backgroundColor: '#c0392b', borderRadius: 10, paddingVertical: 16, alignItems: 'center' },
  cancelTxt:  { color: '#fff', fontWeight: '800', fontSize: 15 },
  rechargeBtn:{ flex: 1, backgroundColor: '#E2136E', borderRadius: 10, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  rechargeTxt:{ color: '#fff', fontWeight: '800', fontSize: 15 },
  bkashBadge: { borderRadius: 7, backgroundColor: '#fff', paddingHorizontal: 8, paddingVertical: 5, alignItems: 'center', justifyContent: 'center' },
});
