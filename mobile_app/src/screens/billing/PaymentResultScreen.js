import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

// Success ও Cancel দুটোই এই screen handle করে
export function PaymentSuccessScreen({ route, navigation }) {
  const { paymentId, amount } = route.params || {};
  return (
    <SafeAreaView style={[s.screen, { backgroundColor: '#f0fdf4' }]}>
      <StatusBar style="dark" />
      <View style={s.card}>
        <Text style={s.icon}>✅</Text>
        <Text style={[s.title, { color: '#15803d' }]}>Payment Successful!</Text>
        <View style={s.detailBox}>
          <Text style={s.detailLabel}>Amount</Text>
          <Text style={[s.detailVal, { color: '#15803d', fontSize: 28 }]}>৳{amount}</Text>
        </View>
        <View style={s.infoBox}>
          <Text style={s.infoTxt}>
            🔔 Your internet connection will be activated after admin verification.{'\n\n'}
            It usually activates within 15-30 minutes.
          </Text>
        </View>
        <TouchableOpacity
          style={[s.btn, { backgroundColor: '#15803d' }]}
          onPress={() => navigation.popToTop()}
          activeOpacity={0.85}
        >
          <Text style={s.btnTxt}>Go Home</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

export function PaymentCancelledScreen({ route, navigation }) {
  const { message, canRetry } = route.params || {};
  return (
    <SafeAreaView style={[s.screen, { backgroundColor: '#fff5f5' }]}>
      <StatusBar style="dark" />
      <View style={s.card}>
        <Text style={s.icon}>❌</Text>
        <Text style={[s.title, { color: '#dc2626' }]}>Payment Failed</Text>
        <View style={s.infoBox}>
          <Text style={s.infoTxt}>{message || 'The payment was not completed.'}</Text>
        </View>
        <View style={{ gap: 10, width: '100%' }}>
          {canRetry && (
            <TouchableOpacity
              style={[s.btn, { backgroundColor: '#E2136E' }]}
              onPress={() => navigation.goBack()}
              activeOpacity={0.85}
            >
              <Text style={s.btnTxt}>Try Again</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[s.btn, { backgroundColor: '#94a3b8' }]}
            onPress={() => navigation.popToTop()}
            activeOpacity={0.85}
          >
            <Text style={s.btnTxt}>Go Home</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: {
    backgroundColor: '#fff', borderRadius: 24, padding: 28,
    alignItems: 'center', width: '100%', maxWidth: 360,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 16, elevation: 4,
    gap: 16,
  },
  icon:  { fontSize: 56 },
  title: { fontSize: 22, fontWeight: '900' },
  detailBox: { alignItems: 'center' },
  detailLabel: { fontSize: 12, color: '#94a3b8' },
  detailVal:   { fontSize: 24, fontWeight: '900' },
  infoBox: { backgroundColor: '#f8fafc', borderRadius: 12, padding: 14, width: '100%' },
  infoTxt: { color: '#475569', fontSize: 13, lineHeight: 20, textAlign: 'center' },
  btn:    { width: '100%', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
