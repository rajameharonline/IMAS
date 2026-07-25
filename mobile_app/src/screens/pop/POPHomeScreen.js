import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';

// POP reseller menu key → label + icon (hierarchical key গুলোর top-level mapping)।
// pop.menus list-এ থাকা key অনুযায়ী tile দেখানো হয় (role-based)।
const MENU_TILES = [
  { key: 'configuration', icon: '⚙️', label: 'Configuration' },
  { key: 'mikrotik_client', icon: '🌐', label: 'Mikrotik Client' },
  { key: 'employee',     icon: '🧑‍💼', label: 'Employee' },
  { key: 'client',       icon: '👥', label: 'Client' },
  { key: 'billing',      icon: '💵', label: 'Billing' },
  { key: 'monitoring',   icon: '📡', label: 'Monitoring' },
  { key: 'client_support', icon: '🎫', label: 'Support' },
  { key: 'sms_service',  icon: '📩', label: 'SMS Service' },
  { key: 'report',       icon: '📊', label: 'Report' },
  { key: 'fund_history', icon: '💰', label: 'Fund History' },
  { key: 'tutorials',    icon: '🎓', label: 'Tutorials' },
];

// POP Reseller Home (Phase 1: menus-driven dashboard; module screens পরের ধাপে)।
export default function POPHomeScreen() {
  const { popUser, popMenus, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const allowed = MENU_TILES.filter(t => (popMenus || []).includes(t.key));

  return (
    <View style={{ flex: 1, backgroundColor: '#0f2d42' }}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.hi}>POP Reseller</Text>
          <Text style={styles.name}>{popUser?.business_name}</Text>
          <Text style={styles.code}>Code: {popUser?.code} · {popUser?.pop_type === 'prepaid' ? 'Prepaid' : 'Postpaid'}</Text>
        </View>
        <TouchableOpacity onPress={logout} style={styles.logoutBtn}>
          <Text style={styles.logoutTxt}>লগআউট</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={{ padding: 18 }}>
        <Text style={styles.section}>আপনার Menu</Text>
        {allowed.length === 0 ? (
          <View style={styles.empty}><Text style={styles.emptyTxt}>কোনো menu access নেই। অ্যাডমিনের সাথে যোগাযোগ করুন।</Text></View>
        ) : (
          <View style={styles.grid}>
            {allowed.map(t => (
              <TouchableOpacity key={t.key} style={styles.tile} activeOpacity={0.85}>
                <Text style={styles.tileIcon}>{t.icon}</Text>
                <Text style={styles.tileLabel}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <Text style={styles.note}>
          Phase 1: role-based dashboard প্রস্তুত। পরবর্তী ধাপে প্রতিটি menu-এর ভেতরের কাজ
          (client, billing, recharge ইত্যাদি) যুক্ত হবে।
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 22, paddingBottom: 22, flexDirection: 'row', alignItems: 'flex-start' },
  hi:   { color: '#94a3b8', fontSize: 13 },
  name: { color: '#fff', fontSize: 21, fontWeight: '900', marginTop: 2 },
  code: { color: '#cbd5e1', fontSize: 12.5, marginTop: 4 },
  logoutBtn: { backgroundColor: '#ef4444', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  logoutTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },

  body: { flex: 1, backgroundColor: '#f1f5f9', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  section: { fontSize: 15, fontWeight: '800', color: '#334155', marginBottom: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: {
    width: '47%', backgroundColor: '#fff', borderRadius: 16, paddingVertical: 22,
    alignItems: 'center', elevation: 2,
  },
  tileIcon: { fontSize: 30, marginBottom: 8 },
  tileLabel: { fontSize: 13.5, fontWeight: '700', color: '#1e293b' },
  empty: { backgroundColor: '#fff', borderRadius: 14, padding: 20 },
  emptyTxt: { color: '#64748b', fontSize: 14, textAlign: 'center' },
  note: { marginTop: 20, fontSize: 12.5, color: '#94a3b8', lineHeight: 19 },
});
