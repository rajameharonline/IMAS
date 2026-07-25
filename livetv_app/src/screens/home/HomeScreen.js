import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  StatusBar, Platform, useWindowDimensions, TextInput, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../../services/api';

const RECENT_KEY = 'livetv_recent_channels';

// ChannelListScreen-এর _cachedChannels shared module cache ব্যবহার করে
// HomeScreen নিজের lightweight version রাখে
let _homeCatCache   = null;
let _homeCacheStamp = 0;
const HOME_CACHE_MS = 60_000;

const CAT_META = {
  recent:        { label: 'Recent Watch' },
  all:           { label: 'ALL CHANNELS' },
  news:          { label: 'NEWS' },
  sports:        { label: 'SPORTS' },
  entertainment: { label: 'ENTERTAINMENT' },
  movies:        { label: 'MOVIES HD' },
  music:         { label: 'MUSIC' },
  kids:          { label: 'KIDS' },
  religious:     { label: 'RELIGIOUS' },
  documentary:   { label: 'DOCUMENTARY' },
  'bd tv':       { label: 'BD TV' },
  other:         { label: 'OTHER' },
};
const meta = k => CAT_META[k] || { label: k.toUpperCase() };

export default function HomeScreen({ navigation }) {
  const { width } = useWindowDimensions();
  const [categories, setCategories] = useState(_homeCatCache || []);
  const [loading, setLoading]       = useState(!_homeCatCache);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const fetchingRef = useRef(false);

  const fetchData = useCallback(async () => {
    const now = Date.now();
    const raw = await AsyncStorage.getItem(RECENT_KEY).catch(() => null);
    const recent = (() => { try { return JSON.parse(raw) || []; } catch { return []; } })();

    if (_homeCatCache && (now - _homeCacheStamp) < HOME_CACHE_MS) {
      setLoading(false);
      return;
    }
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const res  = await api.get('/app/livetv/channels/');
      const data = Array.isArray(res.data) ? res.data : (res.data?.results || []);
      const catCounts = {};
      data.forEach(c => {
        const k = (c.category || 'other').toLowerCase();
        catCounts[k] = (catCounts[k] || 0) + 1;
      });
      const cats = [
        { key: 'recent', count: recent.length },
        { key: 'all',    count: data.length },
        ...Object.entries(catCounts).map(([k, n]) => ({ key: k, count: n })),
      ];
      _homeCatCache   = cats;
      _homeCacheStamp = Date.now();
      setCategories(cats);
    } catch (e) {
      console.warn('HomeScreen fetch:', e.message);
    } finally {
      fetchingRef.current = false;
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  const openCategory = cat => navigation.navigate('ChannelList', { category: cat.key });

  const displayCats = searchQuery.trim()
    ? categories.filter(c =>
        meta(c.key).label.toLowerCase().includes(searchQuery.toLowerCase()))
    : categories;

  // স্ক্রিন সাইজ অনুযায়ী font scale
  const fs = Math.max(12, Math.min(width * 0.042, 18));

  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />

      {/* ── Header ──────────────────────────────────────────────────── */}
      <View style={[s.header, { paddingTop: Platform.OS === 'android' ? 20 : 52 }]}>
        <View style={s.headerLeft}>
          <TouchableOpacity style={s.iconBtn} activeOpacity={0.7} onPress={() => navigation.navigate('Menu')}>
            <Text style={[s.menuIcon, { fontSize: fs * 1.15 }]}>☰</Text>
          </TouchableOpacity>
          <Text style={[s.headerTitle, { fontSize: fs * 1.35 }]}>Live TV</Text>
        </View>
        <View style={s.headerRight}>
          <TouchableOpacity
            style={s.iconBtn}
            activeOpacity={0.7}
            onPress={() => { setShowSearch(v => !v); if (showSearch) setSearchQuery(''); }}>
            <Text style={[s.headerIcon, { fontSize: fs * 1.1 }]}>{showSearch ? '✕' : '🔍'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.iconBtn} activeOpacity={0.7}>
            <Text style={[s.headerIcon, { fontSize: fs * 1.1 }]}>⊟</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Search bar (toggle) ─────────────────────────────────────── */}
      {showSearch && (
        <View style={s.searchWrap}>
          <TextInput
            style={[s.searchInput, { fontSize: fs }]}
            placeholder="Search categories..."
            placeholderTextColor="#555"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
            returnKeyType="search"
          />
        </View>
      )}

      {/* ── Loading ─────────────────────────────────────────────────── */}
      {loading && (
        <View style={s.loadingWrap}>
          <ActivityIndicator size="small" color="#e55a00" />
        </View>
      )}

      {/* ── Category list ───────────────────────────────────────────── */}
      <FlatList
        data={displayCats}
        keyExtractor={item => item.key}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={s.row}
            onPress={() => openCategory(item)}
            activeOpacity={0.65}>
            <Text style={[s.rowLabel, { fontSize: fs * 1.05 }]}>
              {meta(item.key).label}
            </Text>
            <View style={s.rowRight}>
              <Text style={[s.rowCount, { fontSize: fs * 1.05 }]}>{item.count}</Text>
              <Text style={[s.chevron, { fontSize: fs * 1.5 }]}>›</Text>
            </View>
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => <View style={s.sep} />}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: '#0a0a0a',
  },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  menuIcon:    { color: '#fff', fontWeight: '600' },
  headerTitle: { color: '#fff', fontWeight: '800' },
  headerIcon:  { color: '#fff' },
  iconBtn:     { padding: 10 },

  // Search
  searchWrap: {
    backgroundColor: '#1c1c1c',
    marginHorizontal: 16, marginBottom: 8,
    borderRadius: 10, paddingHorizontal: 14,
  },
  searchInput: {
    color: '#fff',
    paddingVertical: Platform.OS === 'android' ? 10 : 13,
  },

  // Category rows
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 22,
    backgroundColor: '#0a0a0a',
  },
  rowLabel: { color: '#fff', fontWeight: '600' },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowCount: { color: '#aaa' },
  chevron:  { color: '#666' },
  sep:         { height: 1, backgroundColor: '#191919' },
  loadingWrap: { paddingVertical: 12, alignItems: 'center' },
});
