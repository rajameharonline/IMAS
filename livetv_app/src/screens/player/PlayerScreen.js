import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar,
  Platform, Animated, Pressable, FlatList, useWindowDimensions,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useAuth } from '../../context/AuthContext';

const CONTROLS_HIDE_MS = 5000;
const PANEL_WIDTH = 300;

// ── 2-stage auto-recovery (stall watchdog) ──────────────────────────────────
// স্ট্রিম "playing" state দেখাচ্ছে কিন্তু আসলে ফ্রেম/সময় এগোচ্ছে না (silent decoder stall —
// audio চলে কিন্তু ভিডিও কালো, বা পুরো playback আটকে)। উভয় stage একই stall-onset থেকে
// মাপা হয় (stage-এ টাইমার রিসেট হয় না)।
//
// পুরনো ভার্সনে একটা Stage 1 NUDGE ছিল (play()/pause() soft-toggle, ৪.৫s stall-এ) —
// কিন্তু QA-তে ধরা পড়ে এই JS-level toggle native player (ExoPlayer/AVPlayer)-এর নিজস্ব
// short-term network buffering-এ বাধা দিচ্ছিল: সামান্য latency হলে native player নিজে থেকেই
// buffer করার চেষ্টা করত, কিন্তু তার আগেই JS watchdog pause→play চালিয়ে সেই buildup বাতিল
// করে দিত এবং জোর করে UI spinner দেখাত — ফলে normal playback-এও মাঝেমধ্যে অহেতুক buffering
// circle দেখা যেত। তাই NUDGE stage সম্পূর্ণ বাদ দেওয়া হয়েছে — native player-কে নিজের মতো
// ছোটখাটো network dip সামলাতে দেওয়া হচ্ছে (preferredForwardBufferDuration/minBufferForPlayback
// দিয়ে আগে থেকেই deep buffer pool দেওয়া আছে), JS শুধু genuinely দীর্ঘ stall-এই হস্তক্ষেপ করে।
//   Stage 1 RELOAD    (৮s stall)  → একই URL soft-reload (fresh manifest/segment session)।
//   Stage 2 FAILOVER  (১৫s stall) → পরের backup URL-এ যাও (তখনো আগের onset থেকেই মাপা)।
const RELOAD_AT_MS   = 8000;
const FAILOVER_AT_MS = 15000;

// ── Smart Reconnect ──────────────────────────────────────────────────────────
// সব backup URL fail করলে primary URL থেকে আবার শুরু করে — প্রতিবার আগেরটার চেয়ে
// বেশি অপেক্ষা করে (flaky আপস্ট্রিম রিকভার হওয়ার সময় দিতে), সর্বোচ্চ ৩ বার তারপর
// permanent "Stream Unavailable" দেখায়।
const RECONNECT_BACKOFF_MS = [2000, 4000, 6000];

// stream proxy URL-এ subscriber token বসানো — deactivate/expire হলে সাথে সাথে
// প্রতিটা manifest/segment fetch server-এ 401 পাবে (verify_livetv_token per-request check)।
function withToken(url, token) {
  if (!url || !token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

function useCurrentTime() {
  const fmt = () => new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
  const [t, setT] = useState(fmt);
  useEffect(() => {
    const id = setInterval(() => setT(fmt()), 15000);
    return () => clearInterval(id);
  }, []);
  return t;
}

function buildUrlQueue(ch, token) {
  if (!ch) return [];
  const q = [];
  if (ch.hls_url) q.push({ label: 'Primary', url: withToken(ch.hls_url, token) });
  (ch.backup_urls || []).forEach(b => {
    if (b.url) q.push({ label: b.label || 'Backup', url: withToken(b.url, token) });
  });
  return q;
}

export default function PlayerScreen({ navigation, route }) {
  const { channel: initChannel, playlist = [] } = route.params || {};
  const { token } = useAuth();

  const [channel, setChannel]                 = useState(initChannel);
  const [isPlaying, setIsPlaying]             = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [urlIndex, setUrlIndex]               = useState(0);
  const [urlQueue, setUrlQueue]               = useState(() => buildUrlQueue(initChannel, token));
  const [failedAll, setFailedAll]             = useState(false);
  const [activeLabel, setActiveLabel]         = useState('');
  const [buffering, setBuffering]             = useState(true);
  const [chInput, setChInput]                 = useState('');
  const [chListVisible, setChListVisible]     = useState(false);
  const [recoveryStatus, setRecoveryStatus]   = useState(''); // reconnect attempt status label

  // যেকোনো ডিভাইস/orientation-এ স্বয়ংক্রিয় স্ক্রিন-ফিট (ম্যানুয়াল অপশন নেই):
  //   landscape (TV/মোবাইল আড়াআড়ি) → cover: পুরো স্ক্রিন ভরে (black bar ছাড়া),
  //   portrait (মোবাইল খাড়া)        → contain: পুরো ফ্রেম দেখায় (অতিরিক্ত crop ছাড়া)।
  // rotation করলে useWindowDimensions রি-রেন্ডার করে fit নিজে থেকেই বদলে যায়।
  const { width: winW, height: winH } = useWindowDimensions();
  const fitMode = winW >= winH ? 'cover' : 'contain';

  const playPulse    = useRef(new Animated.Value(1)).current;
  const controlsAnim = useRef(new Animated.Value(1)).current;
  const chListAnim   = useRef(new Animated.Value(PANEL_WIDTH)).current; // translateX শুরুতে off-screen

  const hideTimer      = useRef(null);
  const chInputTimer   = useRef(null);
  const hideControlsFn = useRef(null);
  const failoverTimer  = useRef(null);
  const bufferShowTimer = useRef(null); // spinner debounce — সংক্ষিপ্ত buffering-এ flash রোধ
  const chListRef      = useRef(null); // FlatList ref — auto-scroll-এর জন্য

  // ── Stall watchdog refs ──────────────────────────────────────────────────────
  const isPlayingRef    = useRef(true);
  const bufferingRef    = useRef(true);
  const progressRef     = useRef({ time: 0, at: Date.now() }); // শেষ যেখানে currentTime এগিয়েছিল
  // 2-stage recovery progress: 0=কিছু হয়নি, 1=RELOAD হয়ে গেছে (পরের বার স্টল হলে
  // সরাসরি FAILOVER-এ যাবে)।
  const recoveryStageRef  = useRef(0);
  const reconnectAttemptRef = useRef(0); // Smart Reconnect: primary URL থেকে কতবার আবার শুরু করা হয়েছে

  const playlistRef         = useRef(playlist);
  const urlQueueRef         = useRef(urlQueue);
  const urlIndexRef         = useRef(0);
  const currentIndexRef     = useRef(playlistRef.current.findIndex(c => c.id === initChannel?.id));
  const pendingChannelIdRef = useRef(initChannel?.id);

  const currentTime  = useCurrentTime();
  const currentIndex = playlistRef.current.findIndex(c => c.id === channel?.id);

  const player = useVideoPlayer(null, p => {
    p.loop = true;
    p.timeUpdateEventInterval = 1; // stall watchdog-এর জন্য প্রতি সেকেন্ডে progress দরকার
    // মসৃণ playback (কম rebuffer, deep chunk pool): সামনে ২৫s পর্যন্ত buffer আগেভাগে
    // জমিয়ে রাখে যাতে ছোট network dip-এ ভিডিও না আটকায়। NUDGE stage বাদ দেওয়ার পর
    // native player-কেই পুরোপুরি নিজের buffering সামলাতে হচ্ছে, তাই minBufferForPlayback
    // (Android-এ ExoPlayer-এর bufferForPlaybackMs-এর কাছাকাছি) ৩s থেকে ৫s-এ বাড়ানো হয়েছে —
    // resume করার আগে বেশি চাঙ্ক জমিয়ে রাখলে বারবার stall→resume→stall cycle কমে।
    // prioritizeTimeOverSizeThreshold: true — byte-size limit-এর বদলে সময়ভিত্তিক buffer
    // target-কে অগ্রাধিকার দেয়, যা variable-bitrate live IPTV feed-এ বেশি স্থিতিশীল।
    p.bufferOptions = {
      preferredForwardBufferDuration: 25,
      minBufferForPlayback: 5,
      waitsToMinimizeStalling: true,
      prioritizeTimeOverSizeThreshold: true,
    };
  });

  const tryNextUrlRef = useRef(null); // watchdog interval থেকে সবচেয়ে সাম্প্রতিক callback access করার জন্য

  // ── URL apply ────────────────────────────────────────────────────────────────
  const applyUrl = useCallback((url, label = '') => {
    clearTimeout(failoverTimer.current);
    setActiveLabel(label);
    setBuffering(true);
    setFailedAll(false);
    // নতুন URL apply হচ্ছে — watchdog-এর progress/retry state রিসেট করো
    isPlayingRef.current = true;
    bufferingRef.current = true;
    recoveryStageRef.current = 0;
    progressRef.current = { time: 0, at: Date.now() };
    try {
      // token URL query-তে already আছে (withToken) — header দ্বিতীয় safety net,
      // native player যদি manifest fetch-এ query string strip করে দেয় কোনো কারণে।
      // contentType:'hls' — proxy URL সবসময় HLS manifest দেয়; extension না থাকলেও
      // expo-video (ExoPlayer/AVPlayer) যাতে format নিশ্চিতভাবে HLS হিসেবে চেনে।
      const source = { uri: url, contentType: 'hls' };
      if (token) source.headers = { Authorization: `Bearer ${token}` };
      player.replace(source);
      player.play();
      setIsPlaying(true);
    } catch (_) {}
  }, [player, token]);

  // ── Mount ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const url = urlQueue[0]?.url;
    if (url) applyUrl(url);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Failover (Stage 2) + Smart Reconnect ─────────────────────────────────────
  const tryNextUrl = useCallback(() => {
    const q   = urlQueueRef.current;
    const idx = urlIndexRef.current + 1;
    if (idx < q.length) {
      urlIndexRef.current = idx;
      setUrlIndex(idx);
      // স্পষ্ট overlay মেসেজ — broken screen-এর বদলে ব্যবহারকারী বুঝুক কী হচ্ছে
      setRecoveryStatus('ব্যাকআপ সোর্সে পরিবর্তন হচ্ছে…');
      applyUrl(q[idx].url, q[idx].label || 'Backup');
      return;
    }
    // সব backup URL fail — Smart Reconnect: primary URL থেকে backoff দিয়ে আবার
    // চেষ্টা করো (২s → ৪s → ৬s), সর্বোচ্চ ৩ বার, তারপর permanent error দেখাও।
    if (reconnectAttemptRef.current < RECONNECT_BACKOFF_MS.length) {
      const attempt = reconnectAttemptRef.current + 1;
      reconnectAttemptRef.current = attempt;
      const delay = RECONNECT_BACKOFF_MS[attempt - 1];
      setBuffering(true);
      setRecoveryStatus(`পুনঃসংযোগ চেষ্টা হচ্ছে (${attempt}/${RECONNECT_BACKOFF_MS.length})…`);
      clearTimeout(failoverTimer.current);
      failoverTimer.current = setTimeout(() => {
        urlIndexRef.current = 0;
        setUrlIndex(0);
        applyUrl(q[0]?.url, q[0]?.label || 'Primary');
      }, delay);
    } else {
      setRecoveryStatus('');
      setFailedAll(true);
      setBuffering(false);
    }
  }, [applyUrl]);
  tryNextUrlRef.current = tryNextUrl;

  // ── Player status listener ───────────────────────────────────────────────────
  useEffect(() => {
    let sub;
    try {
      sub = player.addListener('statusChange', ({ status }) => {
        const loading = status === 'loading';
        bufferingRef.current = loading;  // watchdog-এর জন্য সাথে সাথে (debounce ছাড়া)
        // Spinner debounce: live HLS প্রতিটা segment fetch-এ ক্ষণিকের জন্য 'loading' দেয় —
        // সাথে সাথে spinner দেখালে চলন্ত ভিডিওতেও লোডিং ফ্ল্যাশ করে। তাই buffering
        // ~১.২s-এর বেশি টিকলে তবেই spinner দেখাই; ছোট hiccup-এ কিছুই দেখায় না।
        clearTimeout(bufferShowTimer.current);
        if (loading) {
          bufferShowTimer.current = setTimeout(() => setBuffering(true), 1200);
        } else {
          setBuffering(false);
        }
        if (status === 'error') {
          clearTimeout(failoverTimer.current);
          failoverTimer.current = setTimeout(tryNextUrl, 4000);
        } else {
          clearTimeout(failoverTimer.current);
        }
      });
    } catch (_) {}
    return () => {
      clearTimeout(failoverTimer.current);
      clearTimeout(bufferShowTimer.current);
      try { sub?.remove(); } catch (_) {}
    };
  }, [channel?.id, urlIndex, tryNextUrl, player]);

  // ── playingChange / timeUpdate listener — watchdog-এর জন্য progress track ───
  useEffect(() => {
    const subs = [];
    try {
      subs.push(player.addListener('playingChange', ({ isPlaying: playing }) => {
        isPlayingRef.current = playing;
      }));
      subs.push(player.addListener('timeUpdate', ({ currentTime: ct }) => {
        // currentTime বাস্তবে এগোলেই progress-এর timestamp আপডেট করো (live stream-এ
        // ct প্রতি সেকেন্ডে বাড়বে — না বাড়লেই decoder/network স্টল হয়ে আছে বলে ধরে নেওয়া হবে)
        if (ct > progressRef.current.time) {
          progressRef.current = { time: ct, at: Date.now() };
        }
      }));
    } catch (_) {}
    return () => subs.forEach(sub => { try { sub?.remove(); } catch (_) {} });
  }, [player]);

  // ── Stall watchdog — "playing" অথচ progress আটকে থাকলে 2-stage auto-recover ──
  // ১s tick — থ্রেশহোল্ড (৮s/১৫s) নির্ভুলভাবে মানার জন্য finer granularity। stall onset
  // (progressRef.current.at) RELOAD-এর পরও কৃত্রিমভাবে রিসেট করা হয় না — ফলে মোট recovery
  // time সবসময় FAILOVER_AT_MS (১৫s)-এর মধ্যেই bound থাকে। NUDGE stage ইচ্ছাকৃতভাবে নেই
  // (উপরের কমেন্ট দ্রষ্টব্য) — native player-কে ৮s পর্যন্ত নিজের buffering সামলাতে দেওয়া হয়।
  useEffect(() => {
    const id = setInterval(() => {
      if (failedAll || bufferingRef.current || !isPlayingRef.current) return;
      const stalledMs = Date.now() - progressRef.current.at;

      if (stalledMs < RELOAD_AT_MS) {
        // সুস্থভাবে চলছে (বা native player নিজেই সামলাচ্ছে) — reconnect attempt counter,
        // stage, status label রিসেট করো
        if (reconnectAttemptRef.current !== 0) reconnectAttemptRef.current = 0;
        if (recoveryStageRef.current !== 0) recoveryStageRef.current = 0;
        if (recoveryStatus) setRecoveryStatus('');
        return;
      }

      if (stalledMs >= FAILOVER_AT_MS) {
        // Stage 2 — FAILOVER: পরের backup URL (অথবা সব শেষ হলে Smart Reconnect)
        tryNextUrlRef.current?.();
      } else if (stalledMs >= RELOAD_AT_MS && recoveryStageRef.current < 1) {
        // Stage 1 — RELOAD: একই URL soft-reload (fresh manifest/segment session)
        recoveryStageRef.current = 1;
        const onset = progressRef.current.at; // stall-এর আসল বয়স হারাতে দেওয়া যাবে না
        const url = urlQueueRef.current[urlIndexRef.current]?.url;
        if (url) {
          applyUrl(url, urlQueueRef.current[urlIndexRef.current]?.label);
          // applyUrl নতুন attempt ধরে নিয়ে progress/stage রিসেট করে দেয় — এখানে
          // overwrite করছি যাতে reload নিজে buffering/loading অবস্থায় সময় নিলেও
          // মোট stall clock আগের onset থেকেই চলতে থাকে (FAILOVER_AT_MS মিস না হয়)।
          progressRef.current = { time: 0, at: onset };
          recoveryStageRef.current = 1;
        }
      }
    }, 1000);
    return () => clearInterval(id);
  }, [applyUrl, failedAll, player, recoveryStatus]);

  // ── Channel switch ───────────────────────────────────────────────────────────
  const switchChannel = useCallback((newChannel) => {
    if (!newChannel || newChannel.id === pendingChannelIdRef.current) return;

    pendingChannelIdRef.current = newChannel.id;
    const newIdx = playlistRef.current.findIndex(c => c.id === newChannel.id);
    if (newIdx !== -1) currentIndexRef.current = newIdx;

    const q = buildUrlQueue(newChannel, token);
    urlQueueRef.current = q;
    urlIndexRef.current = 0;

    reconnectAttemptRef.current = 0;
    setChannel(newChannel);
    setUrlQueue(q);
    setUrlIndex(0);
    setFailedAll(false);
    setActiveLabel('');
    setRecoveryStatus('');

    const firstUrl = q[0]?.url;
    if (!firstUrl) { setFailedAll(true); setBuffering(false); return; }
    applyUrl(firstUrl);
  }, [applyUrl, token]);

  // ── Channel list panel ───────────────────────────────────────────────────────
  const openChList = useCallback(() => {
    clearTimeout(hideTimer.current); // list খোলা থাকলে controls hide হবে না
    setChListVisible(true);
    Animated.spring(chListAnim, {
      toValue: 0, useNativeDriver: true, tension: 70, friction: 12,
    }).start();
    // খোলার পর current channel-এ scroll করো
    setTimeout(() => {
      try {
        chListRef.current?.scrollToIndex({
          index: currentIndexRef.current >= 0 ? currentIndexRef.current : 0,
          animated: true, viewPosition: 0.4,
        });
      } catch (_) {}
    }, 350);
  }, [chListAnim]);

  const closeChList = useCallback(() => {
    Animated.timing(chListAnim, { toValue: PANEL_WIDTH, duration: 220, useNativeDriver: true })
      .start(() => setChListVisible(false));
  }, [chListAnim]);

  // ── Controls ─────────────────────────────────────────────────────────────────
  const hideControls = useCallback(() => {
    Animated.timing(controlsAnim, { toValue: 0, duration: 350, useNativeDriver: true })
      .start(() => setControlsVisible(false));
  }, []);
  hideControlsFn.current = hideControls;

  const showControls = useCallback(() => {
    clearTimeout(hideTimer.current);
    setControlsVisible(true);
    Animated.timing(controlsAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    hideTimer.current = setTimeout(() => hideControlsFn.current?.(), CONTROLS_HIDE_MS);
  }, []);

  useEffect(() => { showControls(); return () => clearTimeout(hideTimer.current); }, []);

  // ── TV Remote ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!Platform.isTV) return;
    let h;
    try {
      const { TVEventHandler } = require('react-native');
      h = new TVEventHandler();
      h.enable(null, (_, evt) => {
        if (!evt) return;
        switch (evt.eventType) {
          case 'up':        goNext();     break;
          case 'down':      goPrev();     break;
          case 'select':    togglePlay(); break;
          case 'playPause': togglePlay(); break;
          default:          showControls();
        }
      });
    } catch (_) {}
    return () => { try { h?.disable(); } catch (_) {} };
  }, []);

  // ── CH dial ───────────────────────────────────────────────────────────────────
  const dialNumber = useCallback(num => {
    clearTimeout(chInputTimer.current);
    setChInput(prev => {
      const next = (prev + String(num)).slice(-3);
      chInputTimer.current = setTimeout(() => {
        const idx = parseInt(next, 10) - 1;
        if (idx >= 0 && idx < playlistRef.current.length) {
          switchChannel(playlistRef.current[idx]);
          showControls();
        }
        setChInput('');
      }, 1800);
      return next;
    });
  }, [switchChannel, showControls]);

  // ── Play/Pause ────────────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    try {
      if (isPlaying) { player.pause(); setIsPlaying(false); }
      else           { player.play();  setIsPlaying(true); }
    } catch (_) {}
    Animated.sequence([
      Animated.timing(playPulse, { toValue: 1.25, duration: 100, useNativeDriver: true }),
      Animated.timing(playPulse, { toValue: 1.0,  duration: 150, useNativeDriver: true }),
    ]).start();
    showControls();
  }, [isPlaying, player, playPulse, showControls]);

  const handleBgTap = useCallback(() => {
    if (chListVisible) { closeChList(); return; }
    if (controlsVisible) hideControls();
    else showControls();
  }, [controlsVisible, chListVisible, hideControls, showControls, closeChList]);


  // ── Navigation ────────────────────────────────────────────────────────────────
  const goNext = useCallback(() => {
    const next = playlistRef.current[currentIndexRef.current + 1];
    if (next) { switchChannel(next); showControls(); }
  }, [switchChannel, showControls]);

  const goPrev = useCallback(() => {
    const prev = playlistRef.current[currentIndexRef.current - 1];
    if (prev) { switchChannel(prev); showControls(); }
  }, [switchChannel, showControls]);

  const chNum = currentIndex >= 0 ? String(currentIndex + 1).padStart(2, '0') : '--';

  // ── Channel list row renderer ─────────────────────────────────────────────────
  const renderChRow = useCallback(({ item, index }) => {
    const isActive = item.id === channel?.id;
    return (
      <TouchableOpacity
        style={[s.chRow, isActive && s.chRowActive]}
        onPress={() => { switchChannel(item); closeChList(); showControls(); }}
        activeOpacity={0.65}
      >
        {/* Active indicator bar — left edge */}
        {isActive && <View style={s.chRowBar} />}

        <View style={[s.chRowNumBox, isActive && s.chRowNumBoxActive]}>
          <Text style={[s.chRowNum, isActive && s.chRowNumActive]}>
            {String(index + 1).padStart(2, '0')}
          </Text>
        </View>

        <Text style={[s.chRowName, isActive && s.chRowNameActive]} numberOfLines={1}>
          {item.name}
        </Text>

        {isActive && (
          <View style={s.chRowPlayDot}>
            <View style={s.chRowPlayDotInner} />
          </View>
        )}
      </TouchableOpacity>
    );
  }, [channel?.id, switchChannel, closeChList, showControls]);

  return (
    <View style={s.root}>
      <StatusBar hidden />

      {/* ── Player ──────────────────────────────────────────────────────────── */}
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit={fitMode}
        nativeControls={false}
      />

      {/* ── Buffering ────────────────────────────────────────────────────────── */}
      {buffering && !failedAll && (
        <BufferingSpinner label={recoveryStatus || (activeLabel ? `Trying ${activeLabel}…` : null)} />
      )}

      {/* ── Stream failed ────────────────────────────────────────────────────── */}
      {failedAll && (
        <View style={s.failedBox}>
          <Text style={s.failedIcon}>📡</Text>
          <Text style={s.failedTitle}>Stream Unavailable</Text>
          <Text style={s.failedSub}>All {urlQueue.length} URLs failed</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => {
            reconnectAttemptRef.current = 0;
            setRecoveryStatus('');
            urlIndexRef.current = 0;
            setUrlIndex(0);
            const url = urlQueueRef.current[0]?.url;
            if (url) applyUrl(url);
          }}>
            <Text style={s.retryTxt}>↺ Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Background tap handler ───────────────────────────────────────────── */}
      <Pressable style={StyleSheet.absoluteFill} onPress={handleBgTap} />

      {/* ── Controls overlay ─────────────────────────────────────────────────── */}
      <Animated.View
        style={[s.overlay, { opacity: controlsAnim }]}
        pointerEvents={controlsVisible ? 'box-none' : 'none'}>

        <View style={s.gradTop} />
        <View style={s.gradBottom} />

        {/* Top bar */}
        <View style={s.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.8} style={s.backBtn}>
            <Text style={s.backArrow}>←</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.chTitle} numberOfLines={1}>
              {`CH ${chNum}  ${channel?.name || ''}`}
            </Text>
            {!!activeLabel && <Text style={s.urlLabel}>📡 {activeLabel}</Text>}
          </View>
          {/* ☰ → চ্যানেল লিস্ট panel খুলবে */}
          <TouchableOpacity style={s.listIconBtn} onPress={openChList} activeOpacity={0.7}>
            <View style={s.listIconWrap}>
              <View style={s.listLine} />
              <View style={[s.listLine, { width: 14 }]} />
              <View style={s.listLine} />
            </View>
          </TouchableOpacity>
        </View>

        <View style={{ flex: 1 }} />

        {/* Progress bar — LIVE */}
        <View style={s.progressArea}>
          <Text style={s.progressTime}>{currentTime}</Text>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: '100%' }]} />
            <View style={s.progressDot} />
          </View>
          <View style={s.liveBadge}>
            <View style={s.liveDotEl} />
            <Text style={s.liveTxt}>LIVE</Text>
          </View>
        </View>

        {/* Bottom: ◀ | ⏸ | ▶ */}
        <View style={s.bottomBar}>
          <TouchableOpacity
            style={[s.navBtn, currentIndex <= 0 && s.navBtnOff]}
            onPress={goPrev} activeOpacity={0.75}>
            <Text style={s.navIcon}>◀</Text>
            <Text style={s.navLabel}>Prev</Text>
          </TouchableOpacity>

          <Animated.View style={{ transform: [{ scale: playPulse }] }}>
            <TouchableOpacity style={s.playBtn} onPress={togglePlay} activeOpacity={0.85}>
              <Text style={s.playIcon}>{isPlaying ? '⏸' : '▶'}</Text>
            </TouchableOpacity>
          </Animated.View>

          <TouchableOpacity
            style={[s.navBtn, currentIndex >= playlistRef.current.length - 1 && s.navBtnOff]}
            onPress={goNext} activeOpacity={0.75}>
            <Text style={s.navIcon}>▶</Text>
            <Text style={s.navLabel}>Next</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* ── Channel list panel ────────────────────────────────────────────────── */}
      {chListVisible && (
        <>
          {/* Backdrop — panel ছাড়া বাকি এলাকায় ট্যাপ করলে বন্ধ হবে */}
          <Pressable style={s.chPanelBackdrop} onPress={closeChList} />

          {/* Slide-in glass panel */}
          <Animated.View style={[s.chPanel, { transform: [{ translateX: chListAnim }] }]}>
            {/* Glass shimmer top edge */}
            <View style={s.chPanelShimmer} />

            {/* Header */}
            <View style={s.chPanelHeader}>
              <Text style={s.chPanelTitle}>চ্যানেল তালিকা</Text>
              <Text style={s.chPanelCount}>{playlistRef.current.length}টি</Text>
              <TouchableOpacity onPress={closeChList} style={s.chPanelCloseBtn} activeOpacity={0.7}>
                <Text style={s.chPanelCloseIcon}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={s.chPanelDivider} />

            <FlatList
              ref={chListRef}
              data={playlistRef.current}
              keyExtractor={item => String(item.id)}
              renderItem={renderChRow}
              onScrollToIndexFailed={() => {}}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 24 }}
              initialNumToRender={20}
              windowSize={10}
            />
          </Animated.View>
        </>
      )}

      {/* ── CH number dial ────────────────────────────────────────────────────── */}
      {chInput.length > 0 && (
        <View style={s.chInputBox}>
          <Text style={s.chInputTxt}>{chInput}</Text>
          <Text style={s.chInputSub}>চ্যানেলে যাচ্ছে...</Text>
        </View>
      )}

    </View>
  );
}

// ── Buffering Spinner ─────────────────────────────────────────────────────────
function BufferingSpinner({ label }) {
  const outer = useRef(new Animated.Value(0)).current;
  const inner = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.timing(outer, { toValue: 1, duration: 900, useNativeDriver: true })).start();
    Animated.loop(Animated.timing(inner, { toValue: 1, duration: 600, useNativeDriver: true })).start();
  }, []);
  const rotOut = outer.interpolate({ inputRange: [0,1], outputRange: ['0deg','360deg'] });
  const rotIn  = inner.interpolate({ inputRange: [0,1], outputRange: ['360deg','0deg'] });
  return (
    <View style={s.bufWrap}>
      <Animated.View style={[s.bufOuter, { transform: [{ rotate: rotOut }] }]} />
      <Animated.View style={[s.bufInner, { transform: [{ rotate: rotIn }] }]} />
      {!!label && <Text style={s.bufLabel}>{label}</Text>}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },

  // Buffering
  bufWrap:  { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  bufOuter: {
    position: 'absolute', width: 56, height: 56, borderRadius: 28,
    borderWidth: 3, borderColor: 'transparent', borderTopColor: '#fff',
  },
  bufInner: {
    position: 'absolute', width: 36, height: 36, borderRadius: 18,
    borderWidth: 2, borderColor: 'transparent', borderTopColor: 'rgba(255,255,255,0.35)',
  },
  bufLabel: { position: 'absolute', top: 46, color: '#aaa', fontSize: 11 },

  // Failed
  failedBox: {
    ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  failedIcon:  { fontSize: 40, marginBottom: 10 },
  failedTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  failedSub:   { color: '#888', fontSize: 12, marginBottom: 20 },
  retryBtn:    { backgroundColor: '#333', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20 },
  retryTxt:    { color: '#fff', fontSize: 14, fontWeight: '600' },

  // Controls overlay
  overlay:    { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between' },
  gradTop: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 130,
    backgroundColor: 'rgba(0,0,0,0.68)',
  },
  gradBottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 160,
    backgroundColor: 'rgba(0,0,0,0.68)',
  },

  // Top bar
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingTop: Platform.OS === 'android' ? 16 : 52,
    paddingHorizontal: 14, paddingBottom: 12,
  },
  backBtn:   { padding: 8 },
  backArrow: { color: '#fff', fontSize: 24, fontWeight: '900' },
  chTitle:   { color: '#fff', fontSize: 15, fontWeight: '600' },
  urlLabel:  { color: '#facc15', fontSize: 10, marginTop: 1 },

  // ☰ list icon (custom — 3 lines)
  listIconBtn: { padding: 10 },
  listIconWrap: { gap: 4, alignItems: 'flex-end' },
  listLine: {
    width: 18, height: 2, borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },

  // Progress bar
  progressArea: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 18, gap: 10, marginBottom: 14,
  },
  progressTime:  { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '500', minWidth: 52 },
  progressTrack: { flex: 1, height: 3, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2 },
  progressFill:  { height: '100%', backgroundColor: '#4CAF50', borderRadius: 2 },
  progressDot:   {
    position: 'absolute', right: -6, top: -5,
    width: 13, height: 13, borderRadius: 7,
    backgroundColor: '#4CAF50', elevation: 3,
  },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(76,175,80,0.15)',
    borderWidth: 1, borderColor: 'rgba(76,175,80,0.5)',
    borderRadius: 4, paddingHorizontal: 7, paddingVertical: 3,
  },
  liveDotEl: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4CAF50' },
  liveTxt:   { color: '#4CAF50', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },

  // Bottom bar
  bottomBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly',
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === 'android' ? 22 : 40,
    paddingTop: 8,
  },
  navBtn:    { alignItems: 'center', gap: 6, padding: 12 },
  navBtnOff: { opacity: 0.25 },
  navIcon:   { color: '#fff', fontSize: 32 },
  navLabel:  { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '600' },
  playBtn:   {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  playIcon: { color: '#fff', fontSize: 28 },

  // ── Channel list panel (frosted glass) ──────────────────────────────────────
  chPanelBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  chPanel: {
    position: 'absolute', top: 0, right: 0, bottom: 0,
    width: PANEL_WIDTH,
    backgroundColor: 'rgba(8, 11, 22, 0.87)',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.12)',
    // Android elevation — subtle shadow
    elevation: 24,
    shadowColor: '#000',
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
  },
  // Top shimmer strip — glass look
  chPanelShimmer: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginHorizontal: 12,
    marginTop: Platform.OS === 'android' ? 0 : 0,
  },
  chPanelHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: Platform.OS === 'android' ? 20 : 56,
    paddingHorizontal: 16, paddingBottom: 14, gap: 6,
  },
  chPanelTitle: { color: '#fff', fontSize: 15, fontWeight: '700', flex: 1, letterSpacing: 0.3 },
  chPanelCount: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  chPanelCloseBtn: { padding: 6 },
  chPanelCloseIcon: { color: 'rgba(255,255,255,0.6)', fontSize: 16, fontWeight: '600' },
  chPanelDivider: {
    height: 1, backgroundColor: 'rgba(255,255,255,0.08)',
    marginHorizontal: 0, marginBottom: 4,
  },

  // Channel row
  chRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 11, paddingHorizontal: 16,
    gap: 10,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  chRowActive: {
    backgroundColor: 'rgba(99, 179, 237, 0.12)',
    borderBottomColor: 'rgba(99,179,237,0.15)',
  },
  // Active left bar indicator
  chRowBar: {
    position: 'absolute', left: 0, top: 6, bottom: 6,
    width: 3, borderRadius: 2,
    backgroundColor: '#63b3ed',
  },
  chRowNumBox: {
    width: 32, height: 22, borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center', justifyContent: 'center',
  },
  chRowNumBoxActive: {
    backgroundColor: 'rgba(99,179,237,0.2)',
  },
  chRowNum: { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '700' },
  chRowNumActive: { color: '#63b3ed' },
  chRowName: { flex: 1, color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '500' },
  chRowNameActive: { color: '#fff', fontWeight: '700' },
  // Live playing dot — active row-এর ডান প্রান্তে
  chRowPlayDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: 'rgba(74,222,128,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  chRowPlayDotInner: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: '#4ade80',
  },

  // CH number dial
  chInputBox: {
    position: 'absolute', bottom: 120, right: 20,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 12, paddingHorizontal: 20, paddingVertical: 14,
    alignItems: 'center',
  },
  chInputTxt: { color: '#fff', fontSize: 36, fontWeight: '900', letterSpacing: 6 },
  chInputSub: { color: '#aaa', fontSize: 11, marginTop: 4 },
});
