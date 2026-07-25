import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';

// ── Staff/Admin Home (Phase 0 placeholder) ──
// role অনুযায়ী এখানে Phase 1+ এ Calls / Support / Client / Dashboard module আসবে।
export default function StaffHomeScreen() {
  const { staffUser, permissions, logout, isSuper } = useAuth();
  const insets = useSafeAreaInsets();

  const roleLabel = (staffUser?.role || '').replace(/^\w/, c => c.toUpperCase());
  const modules = permissions?.modules || [];

  return (
    <View style={{ flex: 1, backgroundColor: '#0f2d42' }}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View>
          <Text style={styles.hi}>স্বাগতম,</Text>
          <Text style={styles.name}>{staffUser?.full_name || staffUser?.username}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleTxt}>{isSuper ? 'Super Admin' : (permissions?.role_name || roleLabel)}</Text>
          </View>
        </View>
        <TouchableOpacity onPress={logout} style={styles.logoutBtn}>
          <Text style={styles.logoutTxt}>লগআউট</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={{ padding: 20 }}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📱 Staff App — Phase 0</Text>
          <Text style={styles.cardText}>
            Role-based login সফল। পরবর্তী ধাপে Calls + Support, Client Management,
            Dashboard ও Admin module এখানে যুক্ত হবে।
          </Text>
        </View>

        <Text style={styles.section}>আপনার Access</Text>
        {isSuper ? (
          <View style={styles.permRow}><Text style={styles.permTxt}>✅ সম্পূর্ণ access (Super Admin)</Text></View>
        ) : modules.length === 0 ? (
          <View style={styles.permRow}><Text style={styles.permTxt}>কোনো module assign করা নেই।</Text></View>
        ) : (
          modules.map((m, i) => (
            <View key={i} style={styles.permRow}>
              <Text style={styles.permTxt}>
                • {m.module_key}{m.sub_module_key ? ` → ${m.sub_module_key}` : ''}
                {m.access_level ? `  (${m.access_level})` : ''}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 22, paddingBottom: 22,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
  },
  hi:   { color: '#94a3b8', fontSize: 14 },
  name: { color: '#fff', fontSize: 22, fontWeight: '900', marginTop: 2 },
  roleBadge: {
    alignSelf: 'flex-start', marginTop: 8,
    backgroundColor: '#3b5998', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20,
  },
  roleTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
  logoutBtn: { backgroundColor: '#ef4444', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  logoutTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },

  body: { flex: 1, backgroundColor: '#f1f5f9', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 18, marginBottom: 20, elevation: 2 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#0f2d42', marginBottom: 8 },
  cardText: { fontSize: 14, color: '#475569', lineHeight: 22 },
  section: { fontSize: 14, fontWeight: '800', color: '#334155', marginBottom: 10 },
  permRow: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 },
  permTxt: { fontSize: 13, color: '#475569' },
});
