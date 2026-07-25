import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';

const TK = (n) => '৳' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

function StatCard({ icon, label, value, color }) {
  return (
    <View style={[styles.stat, { backgroundColor: color }]}>
      <Text style={styles.statIcon}>{icon}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function StaffDashboardScreen({ navigation }) {
  const { staffUser, permissions, isSuper, hasModule, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/app/staff/dashboard/');
      setData(r.data);
    } catch { setData(null); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const isAdmin = data?.scope === 'admin';

  // ── Admin Panel module launcher (WebView deep-link) — permission অনুযায়ী ──
  // key = permission module_key; isSuper হলে সব, নাহলে hasModule(key) থাকলে।
  const PANEL_MODULES = [
    { key: 'client',          icon: '👥', label: 'ক্লায়েন্ট',    path: '/clients' },
    { key: 'billing',         icon: '🧾', label: 'বিলিং',        path: '/billing/bills' },
    { key: 'mikrotik_server', icon: '📡', label: 'মনিটরিং',      path: '/radius/online' },
    { key: 'pop',             icon: '🏢', label: 'POP',          path: '/pop/list' },
    { key: 'accounting',      icon: '💰', label: 'অ্যাকাউন্টিং', path: '/accounting/dashboard' },
    { key: 'report',          icon: '📈', label: 'রিপোর্ট',      path: '/accounting/profit-loss' },
    { key: 'sms_service',     icon: '📩', label: 'SMS',          path: '/sms/send' },
    { key: 'hr',              icon: '🧑‍💼', label: 'HR',           path: '/hr/employees' },
    { key: 'network_diagram', icon: '🌐', label: 'নেটওয়ার্ক',   path: '/network/map' },
    { key: 'olt_management',  icon: '🔌', label: 'OLT',          path: '/olt/list' },
    { key: 'support_ticketing', icon: '🎫', label: 'সাপোর্ট',    path: '/support/tickets' },
    { key: 'configuration',   icon: '⚙️', label: 'কনফিগ',        path: '/config' },
  ].filter(m => isSuper || hasModule(m.key));

  // Admin module tiles — permission অনুযায়ী (admin সব দেখে; অন্যরা module থাকলে)
  const adminTiles = [
    { key: 'pay',  icon: '✅', label: 'পেমেন্ট অনুমোদন', screen: 'StaffPendingPayments',
      show: isSuper || ['admin','manager','accountant'].includes(staffUser?.role) },
    { key: 'pop',  icon: '🏢', label: 'POP তালিকা', screen: 'StaffPOPList',
      show: isSuper || hasModule('pop') || ['admin','manager'].includes(staffUser?.role) },
    { key: 'bill', icon: '🧾', label: 'বিল', screen: 'StaffBills',
      show: isSuper || ['admin','manager','accountant'].includes(staffUser?.role) },
    { key: 'hr',   icon: '🧑‍💼', label: 'আমার HR', screen: 'StaffHR', show: true },
  ].filter(t => t.show);

  return (
    <View style={{ flex: 1, backgroundColor: '#0f2d42' }}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.hi}>স্বাগতম,</Text>
          <Text style={styles.name}>{staffUser?.full_name || staffUser?.username}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleTxt}>{isSuper ? 'Super Admin' : (permissions?.role_name || staffUser?.role)}</Text>
          </View>
        </View>
        <TouchableOpacity onPress={logout} style={styles.logoutBtn}>
          <Text style={styles.logoutTxt}>লগআউট</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={{ padding: 16, paddingBottom: 30 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        {loading ? (
          <ActivityIndicator size="large" color="#3b5998" style={{ marginTop: 40 }} />
        ) : !data ? (
          <Text style={styles.err}>ডেটা লোড ব্যর্থ। টেনে রিফ্রেশ করুন।</Text>
        ) : (
          <>
            {/* Collection cards */}
            <View style={styles.grid}>
              <StatCard icon="💵" label="আজকের কালেকশন" value={TK(data.today_collection)} color="#0ea5e9" />
              <StatCard icon="📅" label="এ মাসের কালেকশন" value={TK(data.month_collection)} color="#16a34a" />
            </View>
            <View style={styles.grid}>
              <StatCard icon="🧾" label="আজকের পেমেন্ট সংখ্যা" value={data.today_count} color="#8b5cf6" />
              {isAdmin
                ? <StatCard icon="⚠️" label="মোট বকেয়া" value={TK(data.total_due)} color="#f59e0b" />
                : <StatCard icon="📅" label="এ মাসের সংখ্যা" value={data.month_count} color="#f59e0b" />}
            </View>

            {/* Admin-only client stats */}
            {isAdmin && data.clients && (
              <>
                <Text style={styles.section}>ক্লায়েন্ট</Text>
                <View style={styles.grid}>
                  <StatCard icon="👥" label="মোট ক্লায়েন্ট" value={data.clients.total} color="#06b6d4" />
                  <StatCard icon="🟢" label="অনলাইন" value={data.online_clients} color="#10b981" />
                </View>
                <View style={styles.grid}>
                  <StatCard icon="✅" label="Active" value={data.clients.active} color="#22c55e" />
                  <StatCard icon="⛔" label="Expired" value={data.clients.expired} color="#ef4444" />
                </View>
              </>
            )}
            {!isAdmin && (
              <View style={styles.scopeNote}>
                <Text style={styles.scopeTxt}>আপনি শুধু নিজের কালেকশন দেখছেন।</Text>
              </View>
            )}

            {/* Reports button */}
            <TouchableOpacity style={styles.reportBtn} onPress={() => navigation.navigate('StaffReport')} activeOpacity={0.85}>
              <Text style={styles.reportTxt}>📊 কালেকশন রিপোর্ট দেখুন</Text>
            </TouchableOpacity>

            {/* Full Admin Panel (WebView) — superadmin সব; staff permitted module */}
            <TouchableOpacity style={styles.panelBtn} onPress={() => navigation.navigate('AdminPanel', { path: '/' })} activeOpacity={0.85}>
              <Text style={styles.panelTxt}>🖥️ অ্যাডমিন প্যানেল (সম্পূর্ণ)</Text>
              <Text style={styles.panelSub}>{isSuper ? 'সব অপশন' : 'আপনার role অনুযায়ী module'}</Text>
            </TouchableOpacity>

            {/* Admin module launcher — সরাসরি নির্দিষ্ট module-এ */}
            {PANEL_MODULES.length > 0 && (
              <>
                <Text style={[styles.section, { marginTop: 18 }]}>মডিউল</Text>
                <View style={styles.modGrid}>
                  {PANEL_MODULES.map(m => (
                    <TouchableOpacity key={m.key} style={styles.modTile}
                      onPress={() => navigation.navigate('AdminPanel', { path: m.path })} activeOpacity={0.85}>
                      <Text style={styles.modIcon}>{m.icon}</Text>
                      <Text style={styles.modLabel}>{m.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* Admin module tiles (permission-gated) */}
            {adminTiles.length > 0 && (
              <>
                <Text style={[styles.section, { marginTop: 18 }]}>অ্যাডমিন</Text>
                <View style={styles.adminGrid}>
                  {adminTiles.map(t => (
                    <TouchableOpacity key={t.key} style={styles.adminTile}
                      onPress={() => navigation.navigate(t.screen)} activeOpacity={0.85}>
                      <Text style={styles.adminIcon}>{t.icon}</Text>
                      <Text style={styles.adminLabel}>{t.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 22, paddingBottom: 22, flexDirection: 'row', alignItems: 'flex-start' },
  hi:   { color: '#94a3b8', fontSize: 13 },
  name: { color: '#fff', fontSize: 21, fontWeight: '900', marginTop: 2 },
  roleBadge: { alignSelf: 'flex-start', marginTop: 8, backgroundColor: '#3b5998', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 },
  roleTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
  logoutBtn: { backgroundColor: '#ef4444', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  logoutTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },

  body: { flex: 1, backgroundColor: '#f1f5f9', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  grid: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  stat: { flex: 1, borderRadius: 16, padding: 16 },
  statIcon: { fontSize: 22, marginBottom: 8 },
  statValue: { color: '#fff', fontSize: 22, fontWeight: '900' },
  statLabel: { color: '#fff', fontSize: 12, opacity: 0.9, marginTop: 2 },

  section: { fontSize: 15, fontWeight: '800', color: '#334155', marginTop: 6, marginBottom: 10 },
  scopeNote: { backgroundColor: '#fff7ed', borderRadius: 10, padding: 12, marginTop: 4, marginBottom: 8 },
  scopeTxt: { color: '#9a3412', fontSize: 13 },
  reportBtn: { backgroundColor: '#0f2d42', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 12 },
  reportTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
  panelBtn: { backgroundColor: '#3b5998', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  panelTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
  panelSub: { color: '#dbe4f5', fontSize: 11.5, marginTop: 2 },
  modGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  modTile: { width: '30.5%', backgroundColor: '#fff', borderRadius: 14, paddingVertical: 16, alignItems: 'center', elevation: 1 },
  modIcon: { fontSize: 24, marginBottom: 6 },
  modLabel: { fontSize: 11.5, fontWeight: '700', color: '#334155', textAlign: 'center' },
  adminGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  adminTile: { width: '47%', backgroundColor: '#fff', borderRadius: 16, paddingVertical: 20, alignItems: 'center', elevation: 2 },
  adminIcon: { fontSize: 28, marginBottom: 8 },
  adminLabel: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  err: { color: '#ef4444', textAlign: 'center', marginTop: 40, fontSize: 14 },
});
