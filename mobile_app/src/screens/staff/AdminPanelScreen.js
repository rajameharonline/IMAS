import { useState, useEffect, useRef } from 'react';
import { View, Text, Image, TouchableOpacity, ActivityIndicator, StyleSheet, BackHandler } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as SecureStore from 'expo-secure-store';
import axios from 'axios';
import { useAuth } from '../../context/AuthContext';
import { BASE_URL } from '../../config';

// admin panel origin = BASE_URL থেকে /api/v1 বাদ
const PANEL_URL = BASE_URL.replace(/\/api\/v1\/?$/, '');

// ── Admin Panel WebView ──
// staff/admin token localStorage-এ inject করে web admin panel auto-login হয়।
// role-permission web panel-এই enforce হয় (superadmin সব, staff permitted module)।
export default function AdminPanelScreen({ navigation, route }) {
  const { staffUser, logout } = useAuth();
  const startPath = route?.params?.path || '/';   // deep-link module route
  // home param থাকলে (staff home tab) বা stack root হলে → brand header (admin app-এর মতো)
  const isHome = route?.params?.home === true || !navigation.canGoBack();
  const [injectJS, setInjectJS] = useState(null);
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const [logo, setLogo] = useState('');
  const [company, setCompany] = useState('');
  const webRef = useRef(null);

  useEffect(() => {
    // company logo + name (public config — LoginScreen-এর মতোই)
    axios.get(`${BASE_URL}/app/config/`)
      .then(r => { setLogo(r.data?.company_logo || ''); setCompany(r.data?.company_name || ''); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      const access  = await SecureStore.getItemAsync('access_token');
      const refresh = await SecureStore.getItemAsync('refresh_token');
      const user    = JSON.stringify(staffUser || {});
      // panel index.html load হওয়ার আগে localStorage সেট → app authenticated দেখবে
      const js = `
        try {
          localStorage.setItem('access_token', ${JSON.stringify(access || '')});
          localStorage.setItem('refresh_token', ${JSON.stringify(refresh || '')});
          localStorage.setItem('user', ${JSON.stringify(user)});
          // অ্যাপে web header-এর কল ডায়ালার + monitoring hide (topbar overflow কমাতে;
          // নিচে native call button আছে)
          var st = document.createElement('style');
          st.innerHTML = '.topbar-softphone,.topbar-monitoring{display:none !important;}';
          document.documentElement.appendChild(st);
        } catch (e) {}
        true;
      `;
      setInjectJS(js);
    })();
  }, [staffUser]);

  // Android hardware back → WebView-এর ভেতরে back, না পারলে screen back
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack && webRef.current) { webRef.current.goBack(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [canGoBack]);

  if (!injectJS) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#3b5998" /></View>;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0f2d42' }} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        {isHome ? (
          <>
            {/* Brand: logo + Rajamehar Online */}
            <View style={styles.brand}>
              {logo
                ? <Image source={{ uri: logo }} style={styles.logoImg} resizeMode="contain" />
                : <View style={styles.logoFallback}><Text style={styles.logoFallbackTxt}>R</Text></View>}
              <Text style={styles.brandTxt} numberOfLines={1}>{company || 'Rajamehar Online'}</Text>
            </View>
            {/* কল button — header-এ (ডান পাশে) */}
            <TouchableOpacity onPress={() => navigation.navigate('DialPad')} style={styles.callHeaderBtn} activeOpacity={0.85}>
              <Text style={styles.callHeaderIcon}>📞</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => webRef.current?.reload()} style={styles.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.reload}>↻</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.back}>‹ ফিরে যান</Text>
            </TouchableOpacity>
            <Text style={styles.title}>অ্যাডমিন প্যানেল</Text>
            <TouchableOpacity onPress={() => webRef.current?.reload()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.reload}>↻</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* WebView — header ও bottom bar-এর মাঝে (overlap নেই) */}
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <WebView
          ref={webRef}
          source={{ uri: PANEL_URL + startPath }}
          injectedJavaScriptBeforeContentLoaded={injectJS}
          onLoadEnd={() => setLoading(false)}
          onNavigationStateChange={(s) => {
            setCanGoBack(s.canGoBack);
            // web panel-এর avatar→logout /login-এ redirect করে → native logout-ও করি
            if (/\/login\b/.test(s.url || '')) logout();
          }}
          startInLoadingState
          domStorageEnabled
          javaScriptEnabled
          originWhitelist={['*']}
          setSupportMultipleWindows={false}
          renderLoading={() => (
            <View style={styles.center}><ActivityIndicator size="large" color="#3b5998" /></View>
          )}
        />
        {loading && (
          <View style={styles.overlay}><ActivityIndicator size="large" color="#3b5998" /></View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#0f2d42',
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1 },
  logoImg: { width: 30, height: 30, borderRadius: 7, backgroundColor: '#fff' },
  logoFallback: { width: 30, height: 30, borderRadius: 7, backgroundColor: '#3b5998', alignItems: 'center', justifyContent: 'center' },
  logoFallbackTxt: { color: '#fff', fontSize: 16, fontWeight: '900' },
  brandTxt: { color: '#fff', fontSize: 15.5, fontWeight: '800', flexShrink: 1 },
  iconBtn: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  // compact, professional logout (icon-only power button)
  logoutBtn: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ef4444' },
  logoutTxt: { color: '#fff', fontWeight: '900', fontSize: 16 },
  back: { color: '#cbd5e1', fontSize: 15, fontWeight: '600', flex: 1 },
  title: { color: '#fff', fontSize: 16, fontWeight: '800' },
  reload: { color: '#fff', fontSize: 18 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.7)',
  },
  // header call button (green)
  callHeaderBtn: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#16a34a' },
  callHeaderIcon: { fontSize: 16 },
});
