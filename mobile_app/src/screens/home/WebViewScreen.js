import { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

// video/stream URL কিনা detect করা
const isVideoUrl = (u = '') =>
  /\.(m3u8|m3u|mpd|mp4|m4v|mov|webm|ogg|ogv|ts|mkv|avi|flv|3gp)(\?|$)/i.test(u);

// যেকোনো ফরম্যাটের ভিডিও অ্যাপের ভিতরেই চালানোর জন্য HTML5 player (m3u8 → hls.js)
function buildPlayerHtml(url) {
  const isHls = /\.(m3u8|m3u)(\?|$)/i.test(url);
  const src = JSON.stringify(url);
  return `<!DOCTYPE html><html><head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <style>
    html,body{margin:0;padding:0;height:100%;background:#000;overflow:hidden}
    #wrap{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#000}
    video{width:100%;height:100%;background:#000}
    #msg{color:#fff;font-family:sans-serif;font-size:15px;text-align:center;padding:24px}
  </style></head>
  <body><div id="wrap"><video id="v" controls autoplay playsinline webkit-playsinline></video></div>
  ${isHls ? `<script src="https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js"></script>` : ''}
  <script>
    var v=document.getElementById('v'), src=${src};
    ${isHls ? `
    if(window.Hls && Hls.isSupported()){
      var hls=new Hls();hls.loadSource(src);hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED,function(){ v.play().catch(function(){}); });
    } else if(v.canPlayType('application/vnd.apple.mpegurl')){
      v.src=src; v.addEventListener('loadedmetadata',function(){ v.play().catch(function(){}); });
    } else {
      document.getElementById('wrap').innerHTML='<div id="msg">এই স্ট্রিমটি এই ডিভাইসে চালানো যাচ্ছে না।</div>';
    }
    ` : `
    v.src=src;
    v.addEventListener('loadedmetadata',function(){ v.play().catch(function(){}); });
    `}
  </script></body></html>`;
}

export default function WebViewScreen({ route, navigation }) {
  const { url, title } = route.params || {};
  const [loading, setLoading]   = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError]       = useState(false);
  const ref = useRef(null);

  const isVideo = isVideoUrl(url);
  // video হলে inject করা HTML player, নাহলে সরাসরি পেজ
  const source  = isVideo ? { html: buildPlayerHtml(url), baseUrl: url } : { uri: url };

  const reload = () => { setError(false); setLoading(true); ref.current?.reload(); };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0f2d42' }} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.hBtn} activeOpacity={0.7}>
          <Text style={styles.hBtnTxt}>‹</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, paddingHorizontal: 6 }}>
          <Text style={styles.title} numberOfLines={1}>{title || 'সার্ভিস'}</Text>
        </View>
        <TouchableOpacity onPress={reload} style={styles.hBtn} activeOpacity={0.7}>
          <Text style={{ fontSize: 17, color: '#fff' }}>↻</Text>
        </TouchableOpacity>
      </View>

      {/* Progress bar */}
      {loading && !error && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressBar, { width: `${Math.max(progress * 100, 8)}%` }]} />
        </View>
      )}

      <View style={{ flex: 1, backgroundColor: isVideo ? '#000' : '#fff' }}>
        {error ? (
          <View style={styles.errBox}>
            <Text style={{ fontSize: 46, marginBottom: 12 }}>⚠️</Text>
            <Text style={styles.errTitle}>পেজটি লোড করা যায়নি</Text>
            <Text style={styles.errText}>ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={reload} activeOpacity={0.85}>
              <Text style={styles.retryTxt}>আবার চেষ্টা</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <WebView
            ref={ref}
            source={source}
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
            setSupportMultipleWindows={false}
            domStorageEnabled
            javaScriptEnabled
            style={{ flex: 1, backgroundColor: isVideo ? '#000' : '#fff' }}
          />
        )}

        {loading && !error && (
          <View style={[styles.loadingOverlay, { backgroundColor: isVideo ? '#000' : '#fff' }]} pointerEvents="none">
            <ActivityIndicator size="large" color={isVideo ? '#fff' : '#173d59'} />
            <Text style={[styles.loadingTxt, { color: isVideo ? '#cbd5e1' : '#64748b' }]}>লোড হচ্ছে...</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: '#0f2d42', flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 10,
  },
  hBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center', justifyContent: 'center',
  },
  hBtnTxt: { color: '#fff', fontSize: 26, fontWeight: '800', marginTop: -3 },
  title:   { color: '#fff', fontSize: 15, fontWeight: '800' },
  url:     { color: '#93c5fd', fontSize: 11, marginTop: 1 },

  progressTrack: { height: 3, backgroundColor: '#e2e8f0' },
  progressBar:   { height: 3, backgroundColor: '#3b82f6' },

  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  loadingTxt:     { marginTop: 10, fontSize: 13, fontWeight: '600' },

  errBox:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errTitle: { fontSize: 16, fontWeight: '800', color: '#0f2d42', marginBottom: 6 },
  errText:  { fontSize: 13, color: '#64748b', textAlign: 'center', lineHeight: 19 },
  retryBtn: { backgroundColor: '#3b5998', borderRadius: 12, paddingHorizontal: 22, paddingVertical: 12, marginTop: 20 },
  retryTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
