import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, StatusBar, Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';

export default function WebViewScreen({ route, navigation }) {
  const { url, title } = route.params || {};
  const [loading, setLoading]   = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError]       = useState(false);
  const ref = useRef(null);

  const reload = () => { setError(false); setLoading(true); ref.current?.reload(); };

  return (
    <View style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />

      <View style={[s.header, { paddingTop: Platform.OS === 'android' ? 20 : 52 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.hBtn} activeOpacity={0.7}>
          <Text style={s.hBtnTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={s.title} numberOfLines={1}>{title || 'FTP Server'}</Text>
        <TouchableOpacity onPress={reload} style={s.hBtn} activeOpacity={0.7}>
          <Text style={{ fontSize: 17, color: '#fff' }}>↻</Text>
        </TouchableOpacity>
      </View>

      {loading && !error && (
        <View style={s.progressTrack}>
          <View style={[s.progressBar, { width: `${Math.max(progress * 100, 8)}%` }]} />
        </View>
      )}

      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        {error ? (
          <View style={s.errBox}>
            <Text style={{ fontSize: 46, marginBottom: 12 }}>⚠️</Text>
            <Text style={s.errTitle}>পেজটি লোড করা যায়নি</Text>
            <Text style={s.errText}>ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।</Text>
            <TouchableOpacity style={s.retryBtn} onPress={reload} activeOpacity={0.85}>
              <Text style={s.retryTxt}>আবার চেষ্টা</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <WebView
            ref={ref}
            source={{ uri: url }}
            originWhitelist={['*']}
            onLoadStart={() => setLoading(true)}
            onLoadProgress={({ nativeEvent }) => setProgress(nativeEvent.progress)}
            onLoadEnd={() => setLoading(false)}
            onError={() => { setError(true); setLoading(false); }}
            startInLoadingState
            allowsFullscreenVideo
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            mixedContentMode="always"
            domStorageEnabled
            javaScriptEnabled
            style={{ flex: 1 }}
          />
        )}

        {loading && !error && (
          <View style={s.loadingOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color="#173d59" />
            <Text style={s.loadingTxt}>লোড হচ্ছে...</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    backgroundColor: '#0a0a0a', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 10, paddingBottom: 14,
  },
  hBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  hBtnTxt: { color: '#fff', fontSize: 26, fontWeight: '800', marginTop: -3 },
  title:   { color: '#fff', fontSize: 15, fontWeight: '800', flex: 1, textAlign: 'center' },

  progressTrack: { height: 3, backgroundColor: '#222' },
  progressBar:   { height: 3, backgroundColor: '#e55a00' },

  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  loadingTxt:     { marginTop: 10, fontSize: 13, fontWeight: '600', color: '#64748b' },

  errBox:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errTitle: { fontSize: 16, fontWeight: '800', color: '#0f2d42', marginBottom: 6 },
  errText:  { fontSize: 13, color: '#64748b', textAlign: 'center', lineHeight: 19 },
  retryBtn: { backgroundColor: '#3b5998', borderRadius: 12, paddingHorizontal: 22, paddingVertical: 12, marginTop: 20 },
  retryTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
