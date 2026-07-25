import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  StatusBar, Platform, ActivityIndicator, TextInput,
  Image, Dimensions, RefreshControl,
} from 'react-native';
import api from '../../services/api';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = (SCREEN_W - 48) / 2;

const TYPE_TABS = [
  { key: '',       label: 'সকল',   emoji: '🎞️' },
  { key: 'movie',  label: 'মুভি',  emoji: '🎬' },
  { key: 'drama',  label: 'নাটক',  emoji: '📺' },
  { key: 'series', label: 'সিরিজ', emoji: '📂' },
];
const TYPE_COLORS = { movie: '#3b82f6', drama: '#8b5cf6', series: '#10b981' };

// ── Video thumbnail card ──────────────────────────────────────────────────────
function VideoCard({ item, onPress }) {
  const [imgErr, setImgErr] = useState(false);
  const color = TYPE_COLORS[item.content_type] || '#6b7280';

  return (
    <TouchableOpacity style={[st.card, { width: CARD_W }]} onPress={() => onPress(item)} activeOpacity={0.8}>
      {/* Thumbnail */}
      <View style={st.thumb}>
        {item.thumbnail_url && !imgErr
          ? <Image source={{ uri: item.thumbnail_url }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setImgErr(true)} />
          : <View style={[st.thumbFallback, { backgroundColor: color + '22' }]}>
              <Text style={st.thumbEmoji}>{item.content_type === 'drama' ? '📺' : item.content_type === 'series' ? '📂' : '🎬'}</Text>
            </View>
        }
        {/* Type badge */}
        <View style={[st.typeBadge, { backgroundColor: color }]}>
          <Text style={st.typeTxt}>{item.content_type === 'movie' ? 'MOVIE' : item.content_type === 'drama' ? 'DRAMA' : 'SERIES'}</Text>
        </View>
        {/* Play icon overlay */}
        <View style={st.playOverlay}>
          <View style={st.playCircle}>
            <Text style={st.playTri}>▶</Text>
          </View>
        </View>
      </View>
      {/* Info */}
      <View style={st.cardInfo}>
        <Text style={st.cardTitle} numberOfLines={2}>{item.title}</Text>
        <View style={st.cardMeta}>
          {item.year ? <Text style={st.metaTxt}>{item.year}</Text> : null}
          {item.language ? <Text style={st.metaTxt}>• {item.language}</Text> : null}
        </View>
        {item.content_type === 'series' && item.episode && (
          <Text style={st.epTxt}>S{item.season || 1}E{item.episode}</Text>
        )}
        {item.genre ? <Text style={st.genreTxt} numberOfLines={1}>{item.genre.split(',')[0]}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function FTPContentScreen({ navigation }) {
  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeType, setActiveType] = useState('');
  const [search, setSearch]     = useState('');
  const [filtered, setFiltered] = useState([]);

  const fetchContent = useCallback(async (type = activeType) => {
    try {
      const params = {};
      if (type) params.type = type;
      const res = await api.get('/livetv/app/ftp-content/', { params });
      setItems(res.data);
      setFiltered(res.data);
    } catch (_) {}
    finally { setLoading(false); setRefreshing(false); }
  }, [activeType]);

  useEffect(() => { fetchContent(); }, []);

  // Local search filter
  useEffect(() => {
    if (!search.trim()) { setFiltered(items); return; }
    const q = search.toLowerCase();
    setFiltered(items.filter(it =>
      it.title.toLowerCase().includes(q) ||
      (it.series_title || '').toLowerCase().includes(q) ||
      (it.genre || '').toLowerCase().includes(q)
    ));
  }, [search, items]);

  const handleTypeChange = (type) => {
    setActiveType(type);
    setSearch('');
    setLoading(true);
    fetchContent(type);
  };

  const handleRefresh = () => { setRefreshing(true); fetchContent(); };

  const handlePlay = (item) => {
    if (!item.video_url) {
      alert('এই কন্টেন্টের কোনো ভিডিও URL নেই।');
      return;
    }
    navigation.navigate('FTPVideoPlayer', { item });
  };

  const renderCard = ({ item }) => <VideoCard item={item} onPress={handlePlay} />;
  const keyExtractor = item => String(item.id);

  return (
    <View style={st.root}>
      <StatusBar barStyle="light-content" backgroundColor="#080c1a" />

      {/* Header */}
      <View style={[st.header, { paddingTop: Platform.OS === 'android' ? 36 : 56 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn} activeOpacity={0.7}>
          <Text style={st.backTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={st.headerTitle}>🎬 কন্টেন্ট ডেটাবেজ</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Search bar */}
      <View style={st.searchWrap}>
        <Text style={st.searchIcon}>🔍</Text>
        <TextInput
          style={st.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="মুভি / নাটক / সিরিজ খুঁজুন..."
          placeholderTextColor="#555"
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} style={st.searchClear}>
            <Text style={st.searchClearTxt}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Type tabs */}
      <View style={st.tabsRow}>
        {TYPE_TABS.map(t => (
          <TouchableOpacity key={t.key} onPress={() => handleTypeChange(t.key)}
            style={[st.tab, activeType === t.key && st.tabActive]} activeOpacity={0.75}>
            <Text style={st.tabEmoji}>{t.emoji}</Text>
            <Text style={[st.tabTxt, activeType === t.key && st.tabTxtActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {loading
        ? <View style={st.center}><ActivityIndicator size="large" color="#6366f1" /></View>
        : filtered.length === 0
          ? <View style={st.center}>
              <Text style={{ fontSize: 48, marginBottom: 12 }}>🎬</Text>
              <Text style={st.emptyTxt}>{search ? 'কোনো ফলাফল পাওয়া যায়নি' : 'কোনো কন্টেন্ট নেই'}</Text>
              <Text style={st.emptySubTxt}>Admin panel থেকে কন্টেন্ট যোগ করুন</Text>
            </View>
          : <FlatList
              data={filtered}
              keyExtractor={keyExtractor}
              renderItem={renderCard}
              numColumns={2}
              columnWrapperStyle={st.row}
              contentContainerStyle={st.listContent}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#6366f1" />}
              showsVerticalScrollIndicator={false}
            />
      }
    </View>
  );
}

const st = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#080c1a' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingBottom: 12,
  },
  backBtn:     { width: 40, padding: 8 },
  backTxt:     { color: '#fff', fontSize: 28, fontWeight: '600' },
  headerTitle: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 16, fontWeight: '800' },

  // Search
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
  },
  searchIcon:     { fontSize: 16, color: '#555', marginRight: 8 },
  searchInput:    { flex: 1, color: '#fff', fontSize: 14, paddingVertical: 11 },
  searchClear:    { padding: 4 },
  searchClearTxt: { color: '#555', fontSize: 16 },

  // Tabs
  tabsRow: {
    flexDirection: 'row', paddingHorizontal: 16,
    gap: 8, marginBottom: 16,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 8, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  tabActive: {
    backgroundColor: '#6366f1',
    borderColor: '#6366f1',
  },
  tabEmoji:    { fontSize: 13 },
  tabTxt:      { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600' },
  tabTxtActive: { color: '#fff' },

  // Grid
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  row:         { justifyContent: 'space-between', marginBottom: 14 },

  // Card
  card: { borderRadius: 14, backgroundColor: '#0f1224', overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  thumb: { width: '100%', aspectRatio: 2 / 3, position: 'relative', backgroundColor: '#1a1f35' },
  thumbFallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  thumbEmoji:    { fontSize: 36 },
  typeBadge: {
    position: 'absolute', top: 7, left: 7,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5,
  },
  typeTxt:     { color: '#fff', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0)',
  },
  playCircle:  {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  playTri: { color: '#fff', fontSize: 16, marginLeft: 3 },
  cardInfo:    { padding: 10 },
  cardTitle:   { color: '#fff', fontSize: 12, fontWeight: '700', lineHeight: 16, marginBottom: 4 },
  cardMeta:    { flexDirection: 'row', gap: 4, marginBottom: 2 },
  metaTxt:     { color: 'rgba(255,255,255,0.35)', fontSize: 10 },
  epTxt:       { color: '#6366f1', fontSize: 10, fontWeight: '700', marginBottom: 2 },
  genreTxt:    { color: 'rgba(255,255,255,0.3)', fontSize: 10, fontStyle: 'italic' },

  // Center
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTxt:    { color: '#aaa', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  emptySubTxt: { color: '#555', fontSize: 12, marginTop: 6, textAlign: 'center' },
});
