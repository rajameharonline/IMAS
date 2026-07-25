import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Image, StatusBar, RefreshControl,
  Dimensions, ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import api from '../../services/api';

const POLL_INTERVAL_MS = 30000;
const { width: SCREEN_W } = Dimensions.get('window');
const COLS = 3;
const CARD_W = (SCREEN_W - 24) / COLS;

const AVATAR_COLORS = ['#e50914','#0f79af','#2ecc71','#9b59b6','#e67e22','#1abc9c'];
const avatarColor = (name) => AVATAR_COLORS[(name?.charCodeAt(0) || 0) % AVATAR_COLORS.length];

const ChannelCard = memo(({ item, onPress }) => {
  const [imgError, setImgError] = useState(false);
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.cardThumb, { backgroundColor: item.logo_url && !imgError ? '#111' : avatarColor(item.name) }]}>
        {item.logo_url && !imgError ? (
          <Image source={{ uri: item.logo_url }} style={styles.logo} resizeMode="contain"
            onError={() => setImgError(true)} />
        ) : (
          <Text style={styles.avatarText}>{item.name?.charAt(0)?.toUpperCase() || '📺'}</Text>
        )}
        {item.status === 'live' && (
          <View style={styles.liveBadge}>
            <Text style={styles.liveBadgeText}>LIVE</Text>
          </View>
        )}
      </View>
      <Text style={styles.cardName} numberOfLines={2}>{item.name}</Text>
    </TouchableOpacity>
  );
});

const ALL_CATEGORIES = [
  { key: 'all',           label: 'All' },
  { key: 'recent',        label: 'Recent' },
  { key: 'news',          label: 'News' },
  { key: 'sports',        label: 'Sports' },
  { key: 'entertainment', label: 'Entertainment' },
  { key: 'movies',        label: 'Movies' },
  { key: 'music',         label: 'Music' },
  { key: 'kids',          label: 'Kids' },
  { key: 'religious',     label: 'Religious' },
  { key: 'documentary',   label: 'Documentary' },
  { key: 'other',         label: 'Other' },
];

const RECENT_KEY = 'livetv_recent_channels';
const MAX_RECENT = 20;

export default function ChannelGridScreen({ navigation }) {
  const [channels, setChannels] = useState([]);
  const [recentIds, setRecentIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeCategory, setActiveCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [availableCategories, setAvailableCategories] = useState(['all', 'recent']);
  const pollTimer = useRef(null);

  const loadRecent = async () => {
    try {
      const raw = await AsyncStorage.getItem(RECENT_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  };

  const fetchChannels = useCallback(async (silent = false) => {
    try {
      const res = await api.get('/app/livetv/channels/');
      const data = res.data.results || [];
      setChannels(data);
      const cats = new Set(data.map((c) => c.category).filter(Boolean));
      setAvailableCategories(['all', 'recent', ...Array.from(cats)]);
    } catch (e) {
      console.warn('Channel fetch error', e.message);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const recent = await loadRecent();
      setRecentIds(recent);
      await fetchChannels();
      setLoading(false);
    })();
  }, [fetchChannels]);

  useFocusEffect(
    useCallback(() => {
      fetchChannels(true);
      pollTimer.current = setInterval(() => fetchChannels(true), POLL_INTERVAL_MS);
      return () => { if (pollTimer.current) clearInterval(pollTimer.current); };
    }, [fetchChannels])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    const recent = await loadRecent();
    setRecentIds(recent);
    await fetchChannels();
    setRefreshing(false);
  };

  const openChannel = async (channel) => {
    try {
      const prev = await loadRecent();
      const updated = [channel.id, ...prev.filter((id) => id !== channel.id)].slice(0, MAX_RECENT);
      await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(updated));
      setRecentIds(updated);
    } catch (_) {}
    navigation.navigate('Player', { channel });
  };

  const filteredChannels = () => {
    let list = channels;
    if (activeCategory === 'recent') {
      const map = Object.fromEntries(channels.map((c) => [c.id, c]));
      list = recentIds.map((id) => map[id]).filter(Boolean);
    } else if (activeCategory !== 'all') {
      list = channels.filter((c) => c.category === activeCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q));
    }
    return list;
  };

  const catLabel = (key) => ALL_CATEGORIES.find((c) => c.key === key)?.label || key;

  const list = filteredChannels();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f0f0f" />

      {/* Search bar */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search channels..."
          placeholderTextColor="#555"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
      </View>

      {/* Category tabs — horizontal scroll */}
      <View style={styles.tabsWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsContent}
        >
          {availableCategories.map((key) => (
            <TouchableOpacity
              key={key}
              style={[styles.tab, activeCategory === key && styles.tabActive]}
              onPress={() => setActiveCategory(key)}
            >
              <Text style={[styles.tabText, activeCategory === key && styles.tabTextActive]}>
                {catLabel(key)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Channel grid */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#e50914" />
        </View>
      ) : list.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>📡</Text>
          <Text style={styles.emptyText}>No channels available</Text>
          <Text style={styles.emptySubText}>Pull down to refresh</Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <ChannelCard item={item} onPress={() => openChannel(item)} />}
          numColumns={COLS}
          key={`grid-${COLS}`}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#e50914"
              colors={['#e50914']}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },

  searchRow: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    backgroundColor: '#0f0f0f',
  },
  searchInput: {
    backgroundColor: '#1f1f1f',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
  },

  tabsWrapper: {
    borderBottomWidth: 1,
    borderBottomColor: '#1f1f1f',
    backgroundColor: '#0f0f0f',
  },
  tabsContent: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  tabActive: {
    backgroundColor: '#e50914',
    borderColor: '#e50914',
  },
  tabText: { color: '#888', fontSize: 13, fontWeight: '500' },
  tabTextActive: { color: '#fff', fontWeight: '700' },

  grid: {
    padding: 8,
    paddingBottom: 24,
  },
  card: {
    width: CARD_W,
    marginHorizontal: 4,
    marginBottom: 12,
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    overflow: 'hidden',
  },
  cardThumb: {
    height: CARD_W * 0.6,
    backgroundColor: '#111',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  logo: { width: '75%', height: '75%' },
  logoPlaceholder: {
    width: '100%', height: '100%',
    justifyContent: 'center', alignItems: 'center',
  },
  logoEmoji: { fontSize: 30 },
  avatarText: { color: '#fff', fontSize: 28, fontWeight: '800' },
  liveBadge: {
    position: 'absolute',
    top: 6, left: 6,
    backgroundColor: '#e50914',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  liveBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  cardName: {
    color: '#ddd',
    fontSize: 11,
    textAlign: 'center',
    paddingHorizontal: 6,
    paddingVertical: 7,
    lineHeight: 15,
  },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: '#555', fontSize: 15, fontWeight: '600', marginBottom: 4 },
  emptySubText: { color: '#333', fontSize: 12 },
});
