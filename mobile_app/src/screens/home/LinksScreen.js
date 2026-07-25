import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, ActivityIndicator, ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import axios from 'axios';
import NoticeModal from '../../components/NoticeModal';
import ScreenHeader from '../../components/ScreenHeader';

import { BASE_URL } from '../../config';

export default function LinksScreen({ navigation }) {
  const [config, setConfig]       = useState(null);
  const [loading, setLoading]     = useState(true);
  const [activeTab, setTab]       = useState('ftp');
  const [notices, setNotices]     = useState([]);
  const [showNotice, setShowNotice] = useState(false);

  // screen-এ ঢুকলেই অটো-refresh — admin-এ FTP/Live TV বদলালে সাথে সাথে দেখাবে
  useFocusEffect(useCallback(() => {
    axios.get(`${BASE_URL}/app/config/`).then(r => {
      setConfig(r.data);
      const ftpServers = r.data.ftp_servers || [];
      const tvChannels = r.data.live_tv_channels || [];

      // note আছে এমন items থেকে notices তৈরি
      const list = [];
      ftpServers.forEach(s => {
        if (s.note?.trim()) list.push({ icon: s.icon || '🗄️', title: s.name || 'FTP Server', note: s.note, url: s.url, type: 'ftp' });
      });
      tvChannels.forEach(ch => {
        if (ch.note?.trim()) list.push({ icon: ch.logo || '📺', title: ch.name || 'TV Channel', note: ch.note, url: ch.url, type: 'tv' });
      });
      setNotices(list);

      if (ftpServers.length === 0 && tvChannels.length > 0) setTab('tv');
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []));

  // External browser নয় — অ্যাপের ভিতরেই in-app WebView-এ খোলে
  const openUrl = (url, title) => {
    if (!url) return;
    navigation.navigate('WebView', { url, title });
  };

  if (loading) return (
    <View style={{ flex: 1, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color="#173d59" />
    </View>
  );

  const ftpServers = config?.ftp_servers || [];
  const tvChannels = config?.live_tv_channels || [];
  const hasFTP = ftpServers.length > 0;
  const hasTV  = tvChannels.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: '#f1f5f9' }}>
      <ScreenHeader
        title="Services"
        onBack={() => navigation.goBack()}
        right={
          <TouchableOpacity onPress={() => setShowNotice(true)} style={styles.bellBtn} activeOpacity={0.75}>
            <Text style={{ fontSize: 18 }}>🔔</Text>
            {notices.length > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{notices.length}</Text>
              </View>
            )}
          </TouchableOpacity>
        }
      />

      <NoticeModal
        visible={showNotice}
        onClose={() => setShowNotice(false)}
        notices={notices}
        onOpen={(url, title) => navigation.navigate('WebView', { url, title })}
      />

      {/* Tabs */}
      {hasFTP && hasTV && (
        <View style={styles.tabRow}>
          {[
            { key: 'ftp', label: `🗄️ FTP Servers (${ftpServers.length})` },
            { key: 'tv',  label: `📺 Live TV (${tvChannels.length})` },
          ].map(t => (
            <TouchableOpacity
              key={t.key} onPress={() => setTab(t.key)}
              style={[styles.tab, activeTab === t.key && styles.tabActive]}
            >
              <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* FTP Servers */}
      {(activeTab === 'ftp' || !hasTV) && hasFTP && (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
          <Text style={styles.sectionTitle}>FTP Servers ({ftpServers.length})</Text>
          {ftpServers.map((s, i) => (
            <TouchableOpacity
              key={i} style={styles.ftpCard}
              onPress={() => openUrl(s.url, s.name || 'FTP Server')}
              activeOpacity={0.75}
            >
              <View style={styles.ftpIconBox}>
                <Text style={{ fontSize: 26 }}>{s.icon || '🗄️'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.ftpName}>{s.name || 'FTP Server'}</Text>
                <Text style={styles.ftpHint}>Tap to open in app</Text>
              </View>
              <Text style={styles.arrow}>›</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Live TV */}
      {(activeTab === 'tv' || !hasFTP) && hasTV && (
        <FlatList
          data={tvChannels}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
          ListHeaderComponent={
            <Text style={[styles.sectionTitle, { marginBottom: 6 }]}>
              Live TV Channels ({tvChannels.length})
            </Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.channelCard}
              onPress={() => openUrl(item.url, item.name || 'Live TV')}
              activeOpacity={0.75}
            >
              <View style={styles.channelIconBox}>
                <Text style={{ fontSize: 24 }}>{item.logo || '📺'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.channelName}>{item.name || 'Channel'}</Text>
                {item.category ? <Text style={styles.channelCat}>{item.category}</Text> : null}
              </View>
              <View style={styles.liveTag}>
                <Text style={styles.liveTagText}>LIVE</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      {/* কিছুই নেই */}
      {!hasFTP && !hasTV && (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>🔗</Text>
          <Text style={styles.emptyText}>No links configured.</Text>
          <Text style={styles.emptyHint}>Add FTP servers & Live TV channels from Admin Panel → Version Control.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: '#0f2d42', flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
  },
  back:     { color: '#93c5fd', fontSize: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title:    { color: '#fff', fontSize: 18, fontWeight: '700' },
  bellBtn: { position: 'relative', padding: 4 },
  badge: {
    position: 'absolute', top: -2, right: -2,
    backgroundColor: '#ef4444', borderRadius: 9,
    minWidth: 16, height: 16,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5, borderColor: '#0f2d42',
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '900' },
  tabRow: {
    flexDirection: 'row', backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#e2e8f0',
  },
  tab:           { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive:     { borderBottomColor: '#173d59' },
  tabText:       { fontSize: 13, fontWeight: '600', color: '#94a3b8' },
  tabTextActive: { color: '#173d59' },
  sectionTitle:  { fontSize: 13, fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5 },
  ftpCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 6, elevation: 3,
  },
  ftpIconBox: { width: 56, height: 56, borderRadius: 14, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center' },
  ftpName:    { fontSize: 15, fontWeight: '700', color: '#1e293b', marginBottom: 2 },
  ftpUrl:     { fontSize: 11, color: '#3b82f6', marginBottom: 2 },
  ftpHint:    { fontSize: 11, color: '#94a3b8' },
  arrow:      { color: '#94a3b8', fontSize: 22 },
  hintBox:    { backgroundColor: '#f0f9ff', borderRadius: 12, padding: 12, borderLeftWidth: 3, borderLeftColor: '#3b82f6' },
  hintText:   { fontSize: 12, color: '#1d4ed8', lineHeight: 18 },
  channelCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  channelIconBox: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#1e3a52', alignItems: 'center', justifyContent: 'center' },
  channelName:    { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  channelCat:     { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  liveTag:        { backgroundColor: '#ef4444', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  liveTagText:    { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  emptyBox:   { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyIcon:  { fontSize: 48, marginBottom: 14 },
  emptyText:  { fontSize: 15, fontWeight: '600', color: '#475569', marginBottom: 8, textAlign: 'center' },
  emptyHint:  { fontSize: 12, color: '#94a3b8', textAlign: 'center', lineHeight: 18 },
});
