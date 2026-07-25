import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../../services/api';

const TK = (n) => '৳' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const ATT_COLOR = { present: '#16a34a', absent: '#ef4444', leave: '#f59e0b', late: '#0ea5e9' };

export default function StaffHRScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('attendance');

  const load = useCallback(async () => {
    try { const r = await api.get('/app/staff/hr/me/'); setData(r.data); }
    catch { setData(null); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <ActivityIndicator size="large" color="#3b5998" style={{ marginTop: 60 }} />;

  const noEmp = !data || !data.employee;

  return (
    <View style={{ flex: 1, backgroundColor: '#f1f5f9' }}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>আমার HR</Text>
      </View>

      {noEmp ? (
        <Text style={styles.empty}>আপনার সাথে কোনো employee profile যুক্ত নেই।{'\n'}অ্যাডমিনের সাথে যোগাযোগ করুন।</Text>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
          {/* Employee card */}
          <View style={styles.empCard}>
            <Text style={styles.empName}>{data.employee.full_name}</Text>
            <Text style={styles.empMeta}>🆔 {data.employee.employee_id} · {data.employee.status}</Text>
            <Text style={styles.empMeta}>📱 {data.employee.phone || '—'}</Text>
            <Text style={styles.empMeta}>📅 যোগদান: {data.employee.join_date || '—'}</Text>
          </View>

          {/* Month summary */}
          <Text style={styles.section}>এ মাসের উপস্থিতি</Text>
          <View style={styles.summaryRow}>
            <Sum label="উপস্থিত" value={data.month_summary.present} color="#16a34a" />
            <Sum label="অনুপস্থিত" value={data.month_summary.absent} color="#ef4444" />
            <Sum label="ছুটি" value={data.month_summary.leave} color="#f59e0b" />
          </View>

          {/* Tab switch */}
          <View style={styles.tabs}>
            <TouchableOpacity onPress={() => setTab('attendance')} style={[styles.tab, tab === 'attendance' && styles.tabActive]}>
              <Text style={[styles.tabTxt, tab === 'attendance' && styles.tabTxtActive]}>হাজিরা</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setTab('payslip')} style={[styles.tab, tab === 'payslip' && styles.tabActive]}>
              <Text style={[styles.tabTxt, tab === 'payslip' && styles.tabTxtActive]}>বেতন</Text>
            </TouchableOpacity>
          </View>

          {tab === 'attendance' ? (
            data.attendance.length === 0 ? <Text style={styles.empty2}>কোনো রেকর্ড নেই।</Text> : (
              <View style={styles.card}>
                {data.attendance.map((a, i) => (
                  <View key={a.date} style={[styles.row, i > 0 && styles.rowB]}>
                    <Text style={styles.rowDate}>{a.date}</Text>
                    <Text style={styles.rowTime}>{a.check_in || '—'} - {a.check_out || '—'}</Text>
                    <View style={[styles.attBadge, { backgroundColor: ATT_COLOR[a.status] || '#64748b' }]}>
                      <Text style={styles.attTxt}>{a.status}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )
          ) : (
            data.payslips.length === 0 ? <Text style={styles.empty2}>কোনো বেতন শিট নেই।</Text> : (
              data.payslips.map(p => (
                <View key={p.month} style={styles.payCard}>
                  <View style={styles.payTop}>
                    <Text style={styles.payMonth}>{p.month}</Text>
                    <View style={[styles.payBadge, { backgroundColor: p.is_paid ? '#16a34a' : '#f59e0b' }]}>
                      <Text style={styles.attTxt}>{p.is_paid ? 'পরিশোধিত' : 'অপেক্ষমাণ'}</Text>
                    </View>
                  </View>
                  <View style={styles.payRow}>
                    <Text style={styles.payLbl}>মূল {TK(p.basic_salary)}</Text>
                    <Text style={styles.payLbl}>বোনাস {TK(p.bonus)}</Text>
                    <Text style={styles.payLbl}>কর্তন {TK(p.deduction)}</Text>
                  </View>
                  <Text style={styles.payNet}>নিট: {TK(p.net_salary)}{p.paid_date ? `  ·  ${p.paid_date}` : ''}</Text>
                </View>
              ))
            )
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Sum({ label, value, color }) {
  return (
    <View style={styles.sumCard}>
      <Text style={[styles.sumVal, { color }]}>{value}</Text>
      <Text style={styles.sumLbl}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: '#0f2d42', paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { color: '#cbd5e1', fontSize: 16, fontWeight: '600' },
  title: { color: '#fff', fontSize: 18, fontWeight: '800' },
  empCard: { backgroundColor: '#fff', borderRadius: 16, padding: 18, marginBottom: 16, elevation: 1 },
  empName: { fontSize: 18, fontWeight: '900', color: '#1e293b' },
  empMeta: { fontSize: 13, color: '#64748b', marginTop: 4 },
  section: { fontSize: 14, fontWeight: '800', color: '#334155', marginBottom: 10 },
  summaryRow: { flexDirection: 'row', gap: 12, marginBottom: 18 },
  sumCard: { flex: 1, backgroundColor: '#fff', borderRadius: 14, paddingVertical: 16, alignItems: 'center', elevation: 1 },
  sumVal: { fontSize: 24, fontWeight: '900' },
  sumLbl: { fontSize: 12, color: '#64748b', marginTop: 2 },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center' },
  tabActive: { backgroundColor: '#3b5998' },
  tabTxt: { fontSize: 14, fontWeight: '700', color: '#475569' },
  tabTxtActive: { color: '#fff' },
  card: { backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 14, elevation: 1 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  rowB: { borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  rowDate: { fontSize: 13.5, color: '#1e293b', fontWeight: '600', width: 100 },
  rowTime: { flex: 1, fontSize: 12.5, color: '#64748b' },
  attBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  attTxt: { color: '#fff', fontSize: 10.5, fontWeight: '800' },
  payCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, elevation: 1 },
  payTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  payMonth: { fontSize: 15, fontWeight: '800', color: '#1e293b' },
  payBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  payRow: { flexDirection: 'row', justifyContent: 'space-between' },
  payLbl: { fontSize: 12.5, color: '#64748b' },
  payNet: { fontSize: 15, fontWeight: '900', color: '#16a34a', marginTop: 8 },
  empty: { textAlign: 'center', color: '#94a3b8', marginTop: 50, fontSize: 14, lineHeight: 22 },
  empty2: { textAlign: 'center', color: '#94a3b8', marginTop: 20, fontSize: 13 },
});
