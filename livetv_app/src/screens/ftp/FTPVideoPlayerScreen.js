import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar,
  Platform, Animated, PanResponder, Dimensions,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

const { width: SW } = Dimensions.get('window');
const SKIP_SEC  = 10;
const HIDE_MS   = 5000;
const ACCENT    = '#f5a623';

// ── সময় format ───────────────────────────────────────────────────────────────
function fmtTime(sec) {
  if (!sec || isNaN(sec) || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Player-এ absolute seek ────────────────────────────────────────────────────
// expo-video 2.x-এ currentTime setter কাজ করে না — seekBy(delta) ব্যবহার করতে হয়
function seekToAbsolute(player, targetSec) {
  try {
    if (typeof player.seekBy === 'function') {
      const current = (typeof player.currentTime === 'number' ? player.currentTime : 0);
      player.seekBy(targetSec - current);
    } else {
      player.currentTime = targetSec;
    }
  } catch (_) {}
}

// ── Circular button ───────────────────────────────────────────────────────────
function CircleBtn({ label, onPress, size = 56, fontSize = 22 }) {
  const scale = useRef(new Animated.Value(1)).current;
  const press = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.82, duration: 80,  useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1.0,  duration: 130, useNativeDriver: true }),
    ]).start();
    onPress?.();
  };
  return (
    <TouchableOpacity onPress={press} activeOpacity={0.8}>
      <Animated.View style={[s.circleBtn, { width: size, height: size, borderRadius: size / 2, transform: [{ scale }] }]}>
        <Text style={[s.circleBtnTxt, { fontSize }]}>{label}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

// ── SeekBar — ref-based callbacks যাতে PanResponder stale closure না হয় ──────
function SeekBar({ progress, totalSec, onSeek, onSeekStart, width }) {
  const [touching, setTouching] = useState(false);
  const [touchPct, setTouchPct] = useState(0);

  // PanResponder একবারই create হয়, তাই ref দিয়ে সর্বশেষ values রাখো
  const onSeekRef      = useRef(onSeek);
  const onSeekStartRef = useRef(onSeekStart);
  const widthRef       = useRef(width);
  const totalSecRef    = useRef(totalSec);
  const touchingRef    = useRef(false);

  useEffect(() => { onSeekRef.current      = onSeek;      }, [onSeek]);
  useEffect(() => { onSeekStartRef.current = onSeekStart; }, [onSeekStart]);
  useEffect(() => { widthRef.current       = width;       }, [width]);
  useEffect(() => { totalSecRef.current    = totalSec;    }, [totalSec]);

  const pct       = touching ? touchPct : Math.min(Math.max(progress, 0), 1);
  const thumbLeft = Math.min(Math.max(pct * 100, 0), 100);

  const TOOLTIP_W  = 56;
  const tooltipLeft = Math.min(
    Math.max(pct * (widthRef.current || SW) - TOOLTIP_W / 2, 0),
    (widthRef.current || SW) - TOOLTIP_W,
  );

  const getRatio = (e) =>
    Math.max(0, Math.min(1, e.nativeEvent.locationX / (widthRef.current || SW)));

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder:        () => true,
      onStartShouldSetPanResponderCapture: () => true, // parent touch 가로채기 방지
      onMoveShouldSetPanResponder:         () => true,
      onPanResponderGrant: (e) => {
        const ratio = getRatio(e);
        touchingRef.current = true;
        setTouching(true);
        setTouchPct(ratio);
        onSeekStartRef.current?.();
        // click-এ সাথে সাথে seek — totalSec>0 হলেই
        if (totalSecRef.current > 0) onSeekRef.current?.(ratio, true);
      },
      onPanResponderMove: (e) => {
        const ratio = getRatio(e);
        setTouchPct(ratio);
        // drag চলাকালীন শুধু visual, seek নয় (smooth drag experience)
        onSeekRef.current?.(ratio, false);
      },
      onPanResponderRelease: (e) => {
        const ratio = getRatio(e);
        touchingRef.current = false;
        setTouching(false);
        if (totalSecRef.current > 0) onSeekRef.current?.(ratio, true);
      },
      onPanResponderTerminate: () => {
        touchingRef.current = false;
        setTouching(false);
      },
    })
  ).current;

  return (
    <View style={[s.seekOuter, { width: width || SW }]} {...panResponder.panHandlers}>
      {/* Tooltip — touch/drag-এ দেখাবে */}
      {touching && totalSec > 0 && (
        <View style={[s.seekTooltip, { left: tooltipLeft, width: TOOLTIP_W }]}>
          <Text style={s.seekTooltipTxt}>{fmtTime(touchPct * totalSec)}</Text>
          <View style={s.seekTooltipArrow} />
        </View>
      )}
      <View style={s.seekTrack}>
        <View style={[s.seekFill, { width: `${thumbLeft}%` }]} />
        <View style={[s.seekThumb, { left: `${thumbLeft}%` }, touching && s.seekThumbActive]} />
      </View>
    </View>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
export default function FTPVideoPlayerScreen({ navigation, route }) {
  const { item } = route.params || {};

  const [isPlaying,  setIsPlaying]  = useState(false);
  const [buffering,  setBuffering]  = useState(true);
  const [failed,     setFailed]     = useState(false);
  const [currentSec, setCurrentSec] = useState(0);
  const [totalSec,   setTotalSec]   = useState(0);
  const [muted,      setMuted]      = useState(false);
  const [ctrlVisible, setCtrlVisible] = useState(true);

  const ctrlAnim   = useRef(new Animated.Value(1)).current;
  const hideTimer  = useRef(null);
  const seekingRef = useRef(false);       // poll pause during seek
  const seekTimer  = useRef(null);        // seek settle timeout
  const [skipFlash, setSkipFlash] = useState(null);
  const skipAnim   = useRef(new Animated.Value(0)).current;
  const [barWidth, setBarWidth]   = useState(SW - 120);

  const player = useVideoPlayer(null, p => { p.loop = false; p.muted = false; });

  // ── Load video ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!item?.video_url) { setFailed(true); return; }
    try { player.replace({ uri: item.video_url }); player.play(); }
    catch (_) { setFailed(true); }
  }, []);

  // ── Status listener ─────────────────────────────────────────────────────────
  useEffect(() => {
    let sub;
    try {
      sub = player.addListener('statusChange', ({ status }) => {
        setBuffering(status === 'loading');
        if (status === 'error')      setFailed(true);
        if (status === 'readyToPlay') setBuffering(false);
      });
    } catch (_) {}
    return () => { try { sub?.remove(); } catch (_) {} };
  }, [player]);

  // ── Playing state ───────────────────────────────────────────────────────────
  useEffect(() => {
    let sub;
    try {
      sub = player.addListener('playingChange', ({ isPlaying: p }) => setIsPlaying(p));
    } catch (_) {}
    return () => { try { sub?.remove(); } catch (_) {} };
  }, [player]);

  // ── Time poll: 500ms — seek চলাকালীন skip ──────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      if (seekingRef.current) return;
      try {
        const ct  = player.currentTime;
        const dur = player.duration;
        if (typeof ct  === 'number' && !isNaN(ct)  && ct  >= 0) setCurrentSec(ct);
        if (typeof dur === 'number' && !isNaN(dur) && dur > 0)   setTotalSec(dur);
      } catch (_) {}
    }, 500);
    return () => clearInterval(id);
  }, [player]);

  // ── Cleanup on unmount ──────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearTimeout(hideTimer.current);
      clearTimeout(seekTimer.current);
    };
  }, []);

  // ── Controls show / hide ────────────────────────────────────────────────────
  const hideCtrl = useCallback(() => {
    Animated.timing(ctrlAnim, { toValue: 0, duration: 300, useNativeDriver: true })
      .start(() => setCtrlVisible(false));
  }, [ctrlAnim]);

  const showCtrl = useCallback(() => {
    clearTimeout(hideTimer.current);
    setCtrlVisible(true);
    Animated.timing(ctrlAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    hideTimer.current = setTimeout(hideCtrl, HIDE_MS);
  }, [ctrlAnim, hideCtrl]);

  useEffect(() => { showCtrl(); }, []); // mount-এ controls দেখাও

  const handleScreenTap = useCallback(() => {
    ctrlVisible ? hideCtrl() : showCtrl();
  }, [ctrlVisible, hideCtrl, showCtrl]);

  // ── Play / Pause ────────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    try { isPlaying ? player.pause() : player.play(); }
    catch (_) {}
    showCtrl();
  }, [isPlaying, player, showCtrl]);

  // ── Skip flash helper ────────────────────────────────────────────────────────
  const flash = useCallback((dir) => {
    setSkipFlash(dir);
    skipAnim.setValue(1);
    Animated.timing(skipAnim, { toValue: 0, duration: 700, useNativeDriver: true })
      .start(() => setSkipFlash(null));
  }, [skipAnim]);

  // ── Seek absolute ───────────────────────────────────────────────────────────
  const doSeek = useCallback((targetSec) => {
    clearTimeout(seekTimer.current);
    seekingRef.current = true;
    setCurrentSec(targetSec);
    seekToAbsolute(player, targetSec);
    // 1.2s পর poll আবার চালু — player position settle হওয়ার সময়
    seekTimer.current = setTimeout(() => { seekingRef.current = false; }, 1200);
  }, [player]);

  // SeekBar callback — isFinal=true মানে player-এ actually seek করো
  const handleSeek = useCallback((ratio, isFinal) => {
    if (!totalSec) return;
    const target = Math.max(0, Math.min(ratio * totalSec, totalSec));
    if (isFinal) {
      doSeek(target);
      showCtrl();
    } else {
      // drag চলাকালীন শুধু UI update, player seek নয়
      seekingRef.current = true;
      setCurrentSec(target);
    }
  }, [totalSec, doSeek, showCtrl]);

  const handleSeekStart = useCallback(() => {
    clearTimeout(hideTimer.current); // drag চলাকালীন controls hide বন্ধ
    seekingRef.current = true;
  }, []);

  // ── Rewind / Forward ────────────────────────────────────────────────────────
  const skip = useCallback((sec) => {
    const target = Math.max(0, Math.min(currentSec + sec, totalSec || Infinity));
    doSeek(target);
    flash(sec < 0 ? 'back' : 'fwd');
    showCtrl();
  }, [currentSec, totalSec, doSeek, flash, showCtrl]);

  // ── Mute ────────────────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    const next = !muted;
    try { player.muted = next; } catch (_) {}
    setMuted(next);
    showCtrl();
  }, [muted, player, showCtrl]);

  // ── Meta ────────────────────────────────────────────────────────────────────
  const TYPE_LABEL = { movie: 'MOVIE', drama: 'DRAMA', series: 'SERIES' };
  const subtitle = item?.content_type === 'series' && item?.episode
    ? `S${item.season || 1}E${item.episode}${item.series_title ? ' — ' + item.series_title : ''}`
    : [item?.year, item?.language].filter(Boolean).join(' • ');

  const progress = totalSec > 0 ? currentSec / totalSec : 0;

  // ── Retry ────────────────────────────────────────────────────────────────────
  const retry = useCallback(() => {
    setFailed(false); setBuffering(true); setCurrentSec(0); setTotalSec(0);
    try { player.replace({ uri: item.video_url }); player.play(); } catch (_) {}
  }, [player, item]);

  return (
    <View style={s.root}>
      <StatusBar hidden />

      {/* Video */}
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls={false}
      />

      {/* Buffering */}
      {buffering && !failed && <BufferingSpinner />}

      {/* Skip flash */}
      {skipFlash && (
        <Animated.View
          pointerEvents="none"
          style={[
            s.skipFlash,
            skipFlash === 'back' ? s.skipFlashLeft : s.skipFlashRight,
            { opacity: skipAnim },
          ]}
        >
          <Text style={s.skipFlashTxt}>{skipFlash === 'back' ? `◀◀ ${SKIP_SEC}s` : `${SKIP_SEC}s ▶▶`}</Text>
        </Animated.View>
      )}

      {/* Error */}
      {failed && (
        <View style={s.failBox}>
          <Text style={{ fontSize: 48 }}>📡</Text>
          <Text style={s.failTitle}>ভিডিও চালানো যায়নি</Text>
          <Text style={s.failSub}>
            {item?.video_url ? 'URL বা ফাইল সমস্যা — নেটওয়ার্ক চেক করুন' : 'কোনো ভিডিও URL নেই'}
          </Text>
          <TouchableOpacity style={s.retryBtn} onPress={retry}>
            <Text style={s.retryTxt}>↺ আবার চেষ্টা</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 14 }}>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>← ফিরে যান</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Full-screen tap — controls toggle */}
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={handleScreenTap}
      />

      {/* Controls overlay — box-none: container pass-through, children catch touches */}
      <Animated.View
        style={[s.overlay, { opacity: ctrlAnim }]}
        pointerEvents={ctrlVisible ? 'box-none' : 'none'}
      >
        {/* Top bar */}
        <View style={s.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <Text style={s.backArrow}>←</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.titleTxt} numberOfLines={1}>{item?.title || 'ভিডিও'}</Text>
            {!!subtitle && <Text style={s.subtitleTxt} numberOfLines={1}>{subtitle}</Text>}
          </View>
          <View style={s.badgeRow}>
            {item?.content_type && (
              <View style={s.badge}>
                <Text style={s.badgeTxt}>{TYPE_LABEL[item.content_type] || item.content_type.toUpperCase()}</Text>
              </View>
            )}
            {item?.language && (
              <View style={[s.badge, s.badgeGray]}>
                <Text style={s.badgeTxt}>{item.language.substring(0, 3).toUpperCase()}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Center controls */}
        <View style={s.centerRow}>
          <CircleBtn label="◀◀" onPress={() => skip(-SKIP_SEC)} size={54} fontSize={20} />
          <CircleBtn
            label={buffering ? '…' : isPlaying ? '⏸' : '▶'}
            onPress={togglePlay}
            size={72}
            fontSize={28}
          />
          <CircleBtn label="▶▶" onPress={() => skip(+SKIP_SEC)} size={54} fontSize={20} />
        </View>

        {/* Bottom */}
        <View style={s.bottomArea}>
          {/* Time + Seekbar row */}
          <View style={s.timeRow}>
            <Text style={s.timeTxt}>{fmtTime(currentSec)}</Text>
            <Text style={[s.timeTxt, { color: 'rgba(255,255,255,0.4)', marginHorizontal: 2 }]}>/</Text>
            <Text style={s.timeTxt}>{fmtTime(totalSec)}</Text>
          </View>

          <View
            style={s.seekWrapper}
            onLayout={e => setBarWidth(e.nativeEvent.layout.width)}
          >
            <SeekBar
              progress={progress}
              totalSec={totalSec}
              onSeek={handleSeek}
              onSeekStart={handleSeekStart}
              width={barWidth}
            />
          </View>

          {/* Toolbar */}
          <View style={s.toolbar}>
            <TouchableOpacity style={s.toolBtn} onPress={toggleMute}>
              <Text style={s.toolIcon}>{muted ? '🔇' : '🔊'}</Text>
            </TouchableOpacity>

            <View style={{ flex: 1 }} />

            <View style={[s.badge, s.badgeGray, { marginRight: 4 }]}>
              <Text style={s.badgeTxt}>1080P</Text>
            </View>
            <View style={s.toolBtn}>
              <Text style={[s.toolIcon, { color: 'rgba(255,255,255,0.5)' }]}>⛶</Text>
            </View>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

// ── Buffering spinner ────────────────────────────────────────────────────────
function BufferingSpinner() {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 800, useNativeDriver: true })
    );
    anim.start();
    return () => anim.stop();
  }, []);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View style={s.bufWrap} pointerEvents="none">
      <Animated.View style={[s.bufRing, { transform: [{ rotate }] }]} />
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },

  bufWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  bufRing: {
    width: 52, height: 52, borderRadius: 26,
    borderWidth: 3, borderColor: 'transparent', borderTopColor: ACCENT,
  },

  skipFlash: {
    position: 'absolute', top: 0, bottom: 0, width: '40%',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  skipFlashLeft:  { left: 0,  borderTopRightRadius:    999, borderBottomRightRadius: 999 },
  skipFlashRight: { right: 0, borderTopLeftRadius:     999, borderBottomLeftRadius:  999 },
  skipFlashTxt:   { color: ACCENT, fontSize: 15, fontWeight: '800' },

  failBox: {
    ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.92)',
  },
  failTitle: { color: '#fff', fontSize: 17, fontWeight: '800', marginTop: 12, marginBottom: 6 },
  failSub:   { color: '#888', fontSize: 12, marginBottom: 22, textAlign: 'center', paddingHorizontal: 30 },
  retryBtn:  { backgroundColor: ACCENT, paddingHorizontal: 28, paddingVertical: 11, borderRadius: 24 },
  retryTxt:  { color: '#000', fontSize: 14, fontWeight: '800' },

  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between' },

  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingTop: Platform.OS === 'android' ? 16 : 18,
    paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  backBtn:     { padding: 8 },
  backArrow:   { color: '#fff', fontSize: 22, fontWeight: '900' },
  titleTxt:    { color: '#fff', fontSize: 14, fontWeight: '800' },
  subtitleTxt: { color: 'rgba(255,255,255,0.45)', fontSize: 11, marginTop: 2 },
  badgeRow:    { flexDirection: 'row', gap: 6 },
  badge:       { backgroundColor: ACCENT, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
  badgeGray:   { backgroundColor: 'rgba(255,255,255,0.18)' },
  badgeTxt:    { color: '#fff', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },

  centerRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 30,
  },
  circleBtn: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 2, borderColor: ACCENT,
    alignItems: 'center', justifyContent: 'center',
  },
  circleBtnTxt: { color: ACCENT, fontWeight: '700' },

  bottomArea: {
    paddingHorizontal: 14,
    paddingBottom: Platform.OS === 'android' ? 20 : 26,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },

  timeRow: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: 4, paddingHorizontal: 2,
  },
  timeTxt: { color: '#fff', fontSize: 12, fontWeight: '600' },

  seekWrapper: { width: '100%', marginBottom: 6 },

  seekOuter:  { height: 32, justifyContent: 'center', overflow: 'visible' },
  seekTrack: {
    height: 3, backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 2, position: 'relative',
  },
  seekFill:  { height: '100%', backgroundColor: ACCENT, borderRadius: 2 },
  seekThumb: {
    position: 'absolute', top: -6,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: ACCENT, marginLeft: -7,
    elevation: 5,
    shadowColor: ACCENT, shadowOpacity: 0.9, shadowRadius: 4,
  },
  seekThumbActive: {
    width: 20, height: 20, borderRadius: 10, top: -9, marginLeft: -10,
    elevation: 8, shadowRadius: 8,
  },

  seekTooltip: {
    position: 'absolute', bottom: 38,
    backgroundColor: 'rgba(15,15,15,0.92)',
    borderRadius: 6, paddingVertical: 5, paddingHorizontal: 2,
    alignItems: 'center',
  },
  seekTooltipTxt:   { color: '#fff', fontSize: 11, fontWeight: '700' },
  seekTooltipArrow: {
    width: 0, height: 0,
    borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 6,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    borderTopColor: 'rgba(15,15,15,0.92)',
    alignSelf: 'center', marginTop: 2,
  },

  toolbar:  { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  toolBtn:  { padding: 8 },
  toolIcon: { fontSize: 20 },
});
