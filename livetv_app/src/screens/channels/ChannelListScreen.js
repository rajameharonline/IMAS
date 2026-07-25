import React, { useState, useCallback, useRef, memo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Image, StatusBar, useWindowDimensions, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import api from '../../services/api';

const RECENT_KEY    = 'livetv_recent_channels';
const MAX_RECENT    = 20;
const GRID_COLS     = 2;
const SIDEBAR_RATIO = 0.28;
const CARD_H_APPROX = 148; // getItemLayout-এ ব্যবহার হয় (pixel)

// Module-level cache — screen unmount হলেও data থাকে
let _cachedChannels  = null;
let _cacheTimestamp  = 0;
const CACHE_TTL_MS   = 60_000; // 60s

const CAT_META = {
  recent:        { label: 'RECENT',        emoji: '🕐' },
  all:           { label: 'ALL',            emoji: '📺' },
  news:          { label: 'NEWS',           emoji: '📰' },
  sports:        { label: 'SPORTS',         emoji: '⚽' },
  entertainment: { label: 'ENTERTAINMENT',  emoji: '🎬' },
  movies:        { label: 'MOVIES',         emoji: '🎥' },
  music:         { label: 'MUSIC',          emoji: '🎵' },
  kids:          { label: 'KIDS',           emoji: '🧒' },
  religious:     { label: 'RELIGIOUS',      emoji: '🕌' },
  documentary:   { label: 'DOCUMENTARY',    emoji: '🌍' },
  'bd tv':       { label: 'BD TV',          emoji: '🇧🇩' },
  other:         { label: 'OTHER',          emoji: '📡' },
};
const catLabel = k => (CAT_META[k] || { label: k.toUpperCase(), emoji: '📡' });

const AVATAR_COLORS = [
  '#c0392b','#1a5276','#1e8449','#6c3483',
  '#d35400','#148f77','#7f8c00','#884ea0',
];
const avatarColor = n => AVATAR_COLORS[(n?.charCodeAt(0) || 0) % AVATAR_COLORS.length];

// ─── Channel Grid Card ────────────────────────────────────────────────────────
const ChannelCard = memo(({ item, index, cardW, onPress }) => {
  const [imgErr, setImgErr] = useState(false);
  const logoSize = cardW * 0.48;
  const ac = avatarColor(item.name);
  const hasLogo = !!(item.logo_url && !imgErr);

  return (
    <TouchableOpacity
      style={[s.card, { width: cardW }]}
      onPress={onPress}
      activeOpacity={0.72}>

      {/* Serial number badge — top-left */}
      <View style={s.serialBadge}>
        <Text style={s.serialTxt}>{index + 1}</Text>
      </View>

      {/* LIVE badge — top-right */}
      {item.status === 'live' && (
        <View style={s.liveBadge}>
          <View style={s.liveDot} />
          <Text style={s.liveTxt}>LIVE</Text>
        </View>
      )}

      {/* Logo circle */}
      <View style={[s.logoRing, {
        width: logoSize + 10, height: logoSize + 10,
        borderRadius: (logoSize + 10) / 2,
      }]}>
        <View style={[s.logoCircle, {
          width: logoSize, height: logoSize,
          borderRadius: logoSize / 2,
          backgroundColor: hasLogo ? '#ffffff' : ac,
        }]}>
          {hasLogo ? (
            <Image
              source={{ uri: item.logo_url_encoded || item.logo_url }}
              style={{ width: '92%', height: '92%' }}
              resizeMode="contain"
              onError={() => setImgErr(true)}
            />
          ) : (
            <Text style={[s.logoLtr, { fontSize: logoSize * 0.42 }]}>
              {item.name?.charAt(0)?.toUpperCase()}
            </Text>
          )}
        </View>
      </View>

      {/* Channel name */}
      <Text style={s.cardName} numberOfLines={2}>{item.name}</Text>
    </TouchableOpacity>
  );
});

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function ChannelListScreen({ navigation, route }) {
  const { category: initCat = 'all' } = route.params || {};
  const { width }  = useWindowDimensions();
  const insets     = useSafeAreaInsets();

  const [channels, setChannels]        = useState(_cachedChannels || []);
  const [recentIds, setRecentIds]      = useState([]);
  const [categories, setCategories]    = useState([]);
  const [activeCategory, setActiveCat] = useState(initCat);
  const [loading, setLoading]          = useState(!_cachedChannels);
  const fetchingRef                    = useRef(false);

  const SIDEBAR_W = Math.floor(width * SIDEBAR_RATIO);
  const PANE_W    = width - SIDEBAR_W;
  const GAP       = 8;
  const CARD_W    = Math.floor((PANE_W - GAP * (GRID_COLS + 1)) / GRID_COLS);

  const buildCategories = useCallback((data, recent) => {
    const counts = {};
    data.forEach(c => {
      const k = (c.category || 'other').toLowerCase();
      counts[k] = (counts[k] || 0) + 1;
    });
    setCategories([
      { key: 'recent', count: recent.length },
      { key: 'all',    count: data.length   },
      ...Object.entries(counts).map(([k, n]) => ({ key: k, count: n })),
    ]);
  }, []);

  const fetchData = useCallback(async (force = false) => {
    if (fetchingRef.current) return;
    const now = Date.now();
    const raw = await AsyncStorage.getItem(RECENT_KEY).catch(() => null);
    const recent = (() => { try { return JSON.parse(raw) || []; } catch { return []; } })();
    setRecentIds(recent);

    // module cache আছে এবং fresh → re-fetch করো না
    if (!force && _cachedChannels && (now - _cacheTimestamp) < CACHE_TTL_MS) {
      buildCategories(_cachedChannels, recent);
      setLoading(false);
      return;
    }

    fetchingRef.current = true;
    try {
      const res  = await api.get('/app/livetv/channels/');
      const data = Array.isArray(res.data) ? res.data : (res.data?.results || []);
      _cachedChannels = data;
      _cacheTimestamp = Date.now();
      setChannels(data);
      buildCategories(data, recent);
    } catch (e) {
      console.warn('ChannelList fetch:', e.message);
      // cache আছে তাহলে সেটাই দেখাও
      if (_cachedChannels) buildCategories(_cachedChannels, recent);
    } finally {
      fetchingRef.current = false;
      setLoading(false);
    }
  }, [buildCategories]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  const getFiltered = useCallback((cat) => {
    if (cat === 'recent') {
      const map = Object.fromEntries(channels.map(c => [c.id, c]));
      return recentIds.map(id => map[id]).filter(Boolean);
    }
    if (cat === 'all') return channels;
    return channels.filter(c => (c.category || 'other').toLowerCase() === cat);
  }, [channels, recentIds]);

  const openChannel = useCallback(async (channel) => {
    // recent তালিকা update (AsyncStorage write non-blocking)
    AsyncStorage.getItem(RECENT_KEY).then(raw => {
      const prev = (() => { try { return JSON.parse(raw) || []; } catch { return []; } })();
      const next = [channel.id, ...prev.filter(id => id !== channel.id)].slice(0, MAX_RECENT);
      AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next));
    }).catch(() => {});
    navigation.navigate('Player', { channel, playlist: getFiltered(activeCategory) });
  }, [navigation, getFiltered, activeCategory]);

  const filtered   = getFiltered(activeCategory);
  const activeMeta = catLabel(activeCategory);

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* ── Glass background layers ───────────────────────────────────── */}
      <View style={[s.bgOrb1, { width: width * 0.7, height: width * 0.7, borderRadius: width * 0.35 }]} />
      <View style={[s.bgOrb2, { width: width * 0.55, height: width * 0.55, borderRadius: width * 0.275 }]} />

      {/* ── Top header ────────────────────────────────────────────────── */}
      <View style={[s.topBar, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Text style={s.backArrow}>←</Text>
        </TouchableOpacity>
        <View style={s.titleBlock}>
          <Text style={s.topEmoji}>{activeMeta.emoji}</Text>
          <Text style={s.topTitle} numberOfLines={1}>{activeMeta.label}</Text>
        </View>
        <View style={s.countBadge}>
          <Text style={s.countTxt}>{filtered.length}</Text>
        </View>
      </View>

      {/* ── Body: sidebar + grid ─────────────────────────────────────── */}
      <View style={s.body}>

        {/* Left sidebar — categories */}
        <View style={[s.sidebar, { width: SIDEBAR_W }]}>
          <FlatList
            data={categories}
            keyExtractor={item => item.key}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const active = item.key === activeCategory;
              const meta   = catLabel(item.key);
              return (
                <TouchableOpacity
                  style={[s.catItem, active && s.catItemActive]}
                  onPress={() => setActiveCat(item.key)}
                  activeOpacity={0.7}>
                  {active && <View style={s.catLine} />}
                  <Text style={s.catEmoji}>{meta.emoji}</Text>
                  <View style={s.catTextBlock}>
                    <Text style={[s.catLabel, active && s.catLabelActive]} numberOfLines={2}>
                      {meta.label}
                    </Text>
                    <Text style={[s.catCount, active && s.catCountActive]}>{item.count}</Text>
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        </View>

        {/* Right: channel grid */}
        <View style={s.pane}>
          {loading ? (
            <View style={s.center}>
              <ActivityIndicator size="large" color="#e55a00" />
              <Text style={s.loadingTxt}>Loading...</Text>
            </View>
          ) : filtered.length === 0 ? (
            <View style={s.center}>
              <Text style={s.emptyIcon}>📡</Text>
              <Text style={s.emptyTxt}>No channels</Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={item => String(item.id)}
              numColumns={GRID_COLS}
              key={`grid-${GRID_COLS}`}
              columnWrapperStyle={s.gridRow}
              contentContainerStyle={[s.gridContent, { paddingBottom: insets.bottom + 16 }]}
              showsVerticalScrollIndicator={false}
              /* ── Performance ── */
              initialNumToRender={10}
              maxToRenderPerBatch={8}
              updateCellsBatchingPeriod={50}
              windowSize={5}
              removeClippedSubviews={Platform.OS === 'android'}
              getItemLayout={(_, index) => ({
                length: CARD_H_APPROX + GAP,
                offset: (CARD_H_APPROX + GAP) * Math.floor(index / GRID_COLS),
                index,
              })}
              renderItem={({ item, index }) => (
                <ChannelCard
                  item={item}
                  index={index}
                  cardW={CARD_W}
                  onPress={() => openChannel(item)}
                />
              )}
            />
          )}
        </View>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#08080e' },

  // Background glass orbs
  bgOrb1: {
    position: 'absolute', top: -80, right: -60,
    backgroundColor: 'rgba(100,60,200,0.12)',
  },
  bgOrb2: {
    position: 'absolute', bottom: 60, left: -80,
    backgroundColor: 'rgba(229,90,0,0.08)',
  },

  // Top header
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  backBtn: {
    padding: 8,
    justifyContent: 'center', alignItems: 'center',
  },
  backArrow:  { color: '#fff', fontSize: 24, fontWeight: '900' },
  titleBlock: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
  topEmoji:   { fontSize: 18 },
  topTitle:   { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
  countBadge: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4,
  },
  countTxt: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '700' },

  // Body
  body: { flex: 1, flexDirection: 'row' },

  // Sidebar
  sidebar: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.07)',
  },
  catItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 13, paddingHorizontal: 10, gap: 7,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)',
    position: 'relative',
  },
  catItemActive: {
    backgroundColor: 'rgba(229,90,0,0.18)',
  },
  catLine: {
    position: 'absolute', left: 0, top: 0, bottom: 0,
    width: 3, backgroundColor: '#e55a00', borderRadius: 2,
  },
  catEmoji:  { fontSize: 14 },
  catTextBlock: { flex: 1 },
  catLabel: {
    color: 'rgba(255,255,255,0.4)', fontSize: 10,
    fontWeight: '700', letterSpacing: 0.3,
  },
  catLabelActive: { color: '#fff' },
  catCount: { color: 'rgba(255,255,255,0.22)', fontSize: 10, fontWeight: '600', marginTop: 1 },
  catCountActive: { color: 'rgba(229,90,0,0.85)' },

  // Grid pane
  pane:        { flex: 1 },
  gridContent: { paddingHorizontal: 8, paddingTop: 10 },
  gridRow:     { justifyContent: 'space-between', marginBottom: 8, paddingHorizontal: 0 },

  // Channel card — glass design
  card: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 8,
    overflow: 'hidden',
    elevation: 2,
  },

  // Serial number
  serialBadge: {
    position: 'absolute', top: 7, left: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2,
  },
  serialTxt: { color: 'rgba(255,255,255,0.6)', fontSize: 9, fontWeight: '800' },

  // LIVE badge
  liveBadge: {
    position: 'absolute', top: 7, right: 8,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(46,204,113,0.2)',
    borderWidth: 1, borderColor: 'rgba(46,204,113,0.5)',
    borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2,
  },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#2ecc71' },
  liveTxt: { color: '#2ecc71', fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },

  // Logo
  logoRing: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center', alignItems: 'center',
    marginTop: 12,
    elevation: 3,
  },
  logoCircle: {
    justifyContent: 'center', alignItems: 'center',
    overflow: 'hidden',
    padding: 4,
  },
  logoLtr: { color: '#fff', fontWeight: '900' },

  // Channel name
  cardName: {
    color: 'rgba(255,255,255,0.88)', fontSize: 11, fontWeight: '600',
    textAlign: 'center', paddingHorizontal: 6, marginTop: 2,
  },

  // States
  center:     { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 },
  emptyIcon:  { fontSize: 36 },
  emptyTxt:   { color: 'rgba(255,255,255,0.3)', fontSize: 14, fontWeight: '600' },
  loadingTxt: { color: 'rgba(255,255,255,0.3)', fontSize: 12, marginTop: 8 },
});
