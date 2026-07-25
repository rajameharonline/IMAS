import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  ScrollView, SafeAreaView,
} from 'react-native';

export default function NoticeModal({ visible, onClose, notices, onOpen }) {
  // notices: [{icon, title, note, url, type}]
  // External browser নয় — parent থেকে আসা onOpen দিয়ে অ্যাপের ভিতরেই খোলে (URL দেখায় না)
  const handleOpen = (n) => {
    if (n.url && onOpen) { onClose(); onOpen(n.url, n.title); }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>📢 নোটিশ বোর্ড</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          {notices.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📭</Text>
              <Text style={styles.emptyText}>কোনো নোটিশ নেই।</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.list}>
              {notices.map((n, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.card}
                  onPress={() => handleOpen(n)}
                  activeOpacity={n.url ? 0.75 : 1}
                >
                  <View style={styles.cardLeft}>
                    <View style={[styles.iconBox, { backgroundColor: n.type === 'ftp' ? '#eff6ff' : '#fef3c7' }]}>
                      <Text style={{ fontSize: 22 }}>{n.icon || '📢'}</Text>
                    </View>
                  </View>
                  <View style={styles.cardBody}>
                    <View style={styles.cardTopRow}>
                      <Text style={styles.cardTitle}>{n.title}</Text>
                      <View style={[styles.typeBadge, { backgroundColor: n.type === 'ftp' ? '#dbeafe' : '#fef3c7' }]}>
                        <Text style={[styles.typeText, { color: n.type === 'ftp' ? '#1d4ed8' : '#92400e' }]}>
                          {n.type === 'ftp' ? 'FTP' : 'TV'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.cardNote}>{n.note}</Text>
                    {n.url && (
                      <Text style={styles.cardHint}>অ্যাপেই খুলতে ট্যাপ করুন  ›</Text>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '80%',
    paddingBottom: 32,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#e2e8f0', alignSelf: 'center', marginTop: 10, marginBottom: 4,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  title:     { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  closeBtn:  { width: 32, height: 32, borderRadius: 16, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 14, color: '#64748b' },
  empty:     { alignItems: 'center', padding: 40 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyText: { color: '#94a3b8', fontSize: 14 },
  list: { padding: 16, gap: 12 },
  card: {
    flexDirection: 'row', gap: 12,
    backgroundColor: '#f8fafc', borderRadius: 14, padding: 14,
    borderLeftWidth: 3, borderLeftColor: '#f59e0b',
  },
  cardLeft:    { },
  iconBox:     { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardBody:    { flex: 1 },
  cardTopRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardTitle:   { fontSize: 14, fontWeight: '700', color: '#1e293b', flex: 1, marginRight: 8 },
  typeBadge:   { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  typeText:    { fontSize: 10, fontWeight: '700' },
  cardNote:    { fontSize: 13, color: '#475569', lineHeight: 19 },
  cardHint:    { fontSize: 11, color: '#3b82f6', fontWeight: '700', marginTop: 5 },
});
