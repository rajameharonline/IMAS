import { useState, useRef } from 'react';
import {
  View, Text, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';
import api from '../../services/api';
import BkashLogo from '../../components/BkashLogo';

// আমাদের callback URL-এর prefix — এটা detect হলে payment শেষ
import { BASE_URL } from '../../config';
const CALLBACK_BASE = BASE_URL + '/app/payments/bkash/callback/';

export default function BkashWebViewScreen({ route, navigation }) {
  const { bkashUrl, paymentId, amount } = route.params;
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const webviewRef = useRef(null);

  const handleUrlChange = async ({ url }) => {
    // Callback URL detect হলে payment শেষ হয়েছে
    if (!url || done) return;
    if (!url.startsWith(CALLBACK_BASE)) return;

    setDone(true); // duplicate call ঠেকানো

    // URL থেকে status ও paymentID parse করা
    const urlObj   = new URL(url);
    const status   = urlObj.searchParams.get('status') || '';
    const pId      = urlObj.searchParams.get('paymentID') || paymentId;

    if (status === 'cancel') {
      navigation.replace('PaymentCancelled', {
        message: 'The payment was cancelled.',
        canRetry: true,
      });
      return;
    }

    if (status === 'failure') {
      navigation.replace('PaymentCancelled', {
        message: 'The payment failed.',
        canRetry: true,
      });
      return;
    }

    // success — backend callback execute করবে, আমরা result দেখাব
    if (status === 'success') {
      navigation.replace('PaymentSuccess', {
        paymentId: pId,
        amount,
      });
    }
  };

  const handleError = () => {
    if (done) return;
    Alert.alert(
      'Connection Issue',
      'The bKash page did not load. Please try again.',
      [{ text: 'Go Back', onPress: () => navigation.goBack() }]
    );
  };

  return (
    <View style={s.screen}>
      <StatusBar style="light" />
      {/* Header — শুধু brand ও amount, bKash নিজেই cancel handle করে */}
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={{ width: 60 }} />
        <View style={s.titleBox}>
          <View style={s.brandBadge}><BkashLogo height={16} /></View>
          <Text style={s.titleSub}>Secure Payment</Text>
        </View>
        <View style={s.amountBox}>
          <Text style={s.amountTxt}>৳{amount}</Text>
        </View>
      </View>

      {/* Progress bar */}
      {loading && (
        <View style={s.progressBar}>
          <View style={[s.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
      )}

      {/* WebView */}
      <WebView
        ref={webviewRef}
        source={{ uri: bkashUrl }}
        onNavigationStateChange={handleUrlChange}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onLoadProgress={({ nativeEvent }) => setProgress(nativeEvent.progress)}
        onError={handleError}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        renderLoading={() => (
          <View style={s.loader}>
            <View style={s.loaderCard}>
              <BkashLogo height={30} />
              <ActivityIndicator size="large" color="#E2136E" style={{ marginTop: 16 }} />
              <Text style={s.loaderTxt}>Loading payment page...</Text>
            </View>
          </View>
        )}
        style={{ flex: 1 }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },

  header: {
    backgroundColor: '#E2136E',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12,
  },
  titleBox:   { alignItems: 'center', gap: 3 },
  brandBadge: { borderRadius: 7, backgroundColor: '#fff', paddingHorizontal: 9, paddingVertical: 5, alignItems: 'center', justifyContent: 'center' },
  titleSub:   { color: 'rgba(255,255,255,0.75)', fontSize: 10 },
  amountBox:  { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  amountTxt:  { color: '#fff', fontWeight: '800', fontSize: 14 },

  progressBar: { height: 3, backgroundColor: '#ffd1e3' },
  progressFill: { height: 3, backgroundColor: '#fff' },

  loader: { ...StyleSheet.absoluteFillObject, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  loaderCard:  { alignItems: 'center', padding: 32 },
  loaderBrand: { fontSize: 28, fontWeight: '900', color: '#E2136E', marginBottom: 8 },
  loaderTxt:   { color: '#94a3b8', marginTop: 12, fontSize: 14 },
});
