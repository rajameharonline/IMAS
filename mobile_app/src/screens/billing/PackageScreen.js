// ক্লায়েন্ট প্যাকেজ আপগ্রেড / ডাউনগ্রেড স্ক্রিন।
// - Client-এর router-এ assigned packages দেখায়।
// - Upgrade: pro-rated bKash payment → সাথে সাথে package change।
// - Downgrade: confirmation-এর পরে তাৎক্ষণিক free change।
import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import api from '../../services/api';
import ScreenHeader from '../../components/ScreenHeader';

const BILLING_CYCLE_ICONS = {
  Monthly:      '📅',
  Quarterly:    '📆',
  'Half Yearly': '🗓️',
  Yearly:       '📋',
};

// প্যাকেজ কার্ড
function PackageCard({ pkg, onUpgrade, onDowngrade }) {
  const isCurrent  = pkg.is_current;
  const isUpgrade  = pkg.change_type === 'upgrade';
  const isDowngrade = pkg.change_type === 'downgrade';
  const cycleIcon  = BILLING_CYCLE_ICONS[pkg.billing_cycle] || '📅';

  return (
    <View style={[s.card, isCurrent && s.cardCurrent]}>
      {/* Current badge */}
      {isCurrent && (
        <View style={s.currentBadge}>
          <Text style={s.currentBadgeTxt}>✓ বর্তমান প্যাকেজ</Text>
        </View>
      )}

      <View style={s.cardRow}>
        {/* Left: Icon + Info */}
        <View style={s.cardLeft}>
          <View style={[s.iconWrap, isCurrent && s.iconWrapActive]}>
            <Text style={s.icon}>📶</Text>
          </View>
          <View style={s.cardMeta}>
            <Text style={[s.cardName, isCurrent && { color: '#1d4ed8' }]}>{pkg.name}</Text>
            <Text style={s.cardSpeed}>
              {pkg.speed_name ? pkg.speed_name : 'Speed N/A'}
            </Text>
            <Text style={s.cardCycle}>{cycleIcon} {pkg.billing_cycle}</Text>
            {isUpgrade && pkg.upgrade_amount > 0 && (
              <Text style={s.upgradeNote}>
                আপগ্রেড চার্জ: ৳{pkg.upgrade_amount.toFixed(0)}
              </Text>
            )}
            {isDowngrade && (
              <Text style={s.downgradeNote}>
                ডাউনগ্রেড — বিনামূল্যে
              </Text>
            )}
          </View>
        </View>

        {/* Right: Price + Action */}
        <View style={s.cardRight}>
          <Text style={[s.price, isCurrent && { color: '#1d4ed8' }]}>
            ৳ {parseInt(pkg.price).toLocaleString('en')}
          </Text>
          {!isCurrent && isUpgrade && (
            <TouchableOpacity style={s.btnUpgrade} onPress={() => onUpgrade(pkg)}>
              <Text style={s.btnTxt}>আপগ্রেড ↑</Text>
            </TouchableOpacity>
          )}
          {!isCurrent && isDowngrade && (
            <TouchableOpacity style={s.btnDowngrade} onPress={() => onDowngrade(pkg)}>
              <Text style={s.btnTxt}>ডাউনগ্রেড ↓</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Description */}
      {pkg.description ? (
        <Text style={s.cardDesc}>{pkg.description}</Text>
      ) : null}
    </View>
  );
}

export default function PackageScreen({ navigation }) {
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchPackages = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const r = await api.get('/app/packages/');
      setData(r.data);
    } catch {
      if (!quiet) Alert.alert('Error', 'প্যাকেজ তালিকা লোড হয়নি।');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchPackages(); }, [fetchPackages]);

  // Upgrade — bKash payment initiate করো
  const handleUpgrade = async (pkg) => {
    Alert.alert(
      `প্যাকেজ আপগ্রেড`,
      `${pkg.name} (৳${parseInt(pkg.price).toLocaleString('en')}/মাস)-এ আপগ্রেড করতে চান?\n\n` +
      `আজ থেকে মেয়াদ (${data?.expiry_date || '?'}) পর্যন্ত বাকি ${pkg.remaining_days} দিনের চার্জ:\n` +
      `৳${pkg.upgrade_amount.toFixed(0)}`,
      [
        { text: 'বাতিল', style: 'cancel' },
        {
          text: `bKash-এ পে করুন`,
          onPress: async () => {
            setActionLoading(true);
            try {
              const r = await api.post('/app/packages/upgrade/initiate/', {
                package_id: pkg.id,
              });
              navigation.navigate('BkashWebView', {
                bkashUrl:  r.data.bkash_url,
                paymentId: r.data.payment_id,
                amount:    r.data.amount,
              });
            } catch (e) {
              const msg = e?.response?.data?.detail || 'bKash সংযোগ ব্যর্থ।';
              Alert.alert('Error', msg);
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  };

  // Downgrade — বিনামূল্যে, confirmation alert
  const handleDowngrade = async (pkg) => {
    Alert.alert(
      `প্যাকেজ ডাউনগ্রেড`,
      `${pkg.name} (৳${parseInt(pkg.price).toLocaleString('en')}/মাস)-এ ডাউনগ্রেড করতে চান?\n\n` +
      `এটি বিনামূল্যে। আপনার ইন্টারনেট সংযোগ কিছুক্ষণের জন্য বিচ্ছিন্ন হয়ে নতুন স্পিডে পুনরায় সংযুক্ত হবে।`,
      [
        { text: 'না', style: 'cancel' },
        {
          text: 'হ্যাঁ, পরিবর্তন করুন',
          style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            try {
              await api.post('/app/packages/downgrade/', { package_id: pkg.id });
              Alert.alert(
                '✅ সফল',
                `প্যাকেজ ${pkg.name}-এ পরিবর্তন হয়েছে।\n\nকিছুক্ষণের মধ্যে আপনার সংযোগ নতুন স্পিডে চালু হবে।`,
                [{ text: 'ঠিক আছে', onPress: () => fetchPackages(true) }]
              );
            } catch (e) {
              const msg = e?.response?.data?.detail || 'পরিবর্তন ব্যর্থ হয়েছে।';
              Alert.alert('Error', msg);
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={s.screen}>
      <ScreenHeader title="Package" onBack={() => navigation.goBack()} color="#1d4ed8" />

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color="#1d4ed8" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.body}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); fetchPackages(true); }}
              colors={['#1d4ed8']}
            />
          }
        >
          {/* বর্তমান প্যাকেজ summary */}
          {data?.current_package && (
            <View style={s.summaryCard}>
              <View>
                <Text style={s.summaryLabel}>বর্তমান প্যাকেজ</Text>
                <Text style={s.summaryName}>{data.current_package.name}</Text>
              </View>
              {data.expiry_date && (
                <View style={s.expiryWrap}>
                  <Text style={s.expiryLabel}>মেয়াদ শেষ</Text>
                  <Text style={s.expiryDate}>{data.expiry_date}</Text>
                </View>
              )}
            </View>
          )}

          {/* Package list */}
          {data?.packages?.length > 0 ? (
            data.packages.map((pkg) => (
              <PackageCard
                key={pkg.id}
                pkg={pkg}
                onUpgrade={handleUpgrade}
                onDowngrade={handleDowngrade}
              />
            ))
          ) : (
            <View style={s.empty}>
              <Text style={s.emptyTxt}>কোনো প্যাকেজ পাওয়া যায়নি।</Text>
            </View>
          )}

          {/* Note */}
          <View style={s.noteBox}>
            <Text style={s.noteTxt}>
              📌 আপগ্রেড করলে আজ থেকে মেয়াদ শেষ পর্যন্ত বাকি দিনের pro-rated চার্জ প্রযোজ্য।{'\n'}
              ডাউনগ্রেড সম্পূর্ণ বিনামূল্যে। সংযোগ কিছুক্ষণের জন্য বিচ্ছিন্ন হতে পারে।
            </Text>
          </View>
        </ScrollView>
      )}

      {/* Global action loading overlay */}
      {actionLoading && (
        <View style={s.overlay}>
          <View style={s.overlayCard}>
            <ActivityIndicator size="large" color="#1d4ed8" />
            <Text style={s.overlayTxt}>প্রক্রিয়াকরণ হচ্ছে…</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f1f5f9' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  body: { padding: 16, paddingBottom: 40, gap: 12 },

  summaryCard: {
    backgroundColor: '#1d4ed8', borderRadius: 16,
    padding: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 4,
  },
  summaryLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 12 },
  summaryName:  { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 2 },
  expiryWrap:   { alignItems: 'flex-end' },
  expiryLabel:  { color: 'rgba(255,255,255,0.75)', fontSize: 11 },
  expiryDate:   { color: '#fff', fontSize: 14, fontWeight: '700', marginTop: 2 },

  card: {
    backgroundColor: '#fff', borderRadius: 14,
    padding: 14, shadowColor: '#1e293b',
    shadowOpacity: 0.06, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
    borderWidth: 1.5, borderColor: 'transparent',
  },
  cardCurrent: { borderColor: '#1d4ed8', backgroundColor: '#eff6ff' },

  currentBadge: {
    backgroundColor: '#1d4ed8', borderRadius: 20, alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 3, marginBottom: 8,
  },
  currentBadgeTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },

  cardRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardLeft: { flexDirection: 'row', alignItems: 'flex-start', flex: 1, gap: 10 },
  cardRight:{ alignItems: 'flex-end', minWidth: 90 },

  iconWrap: {
    width: 46, height: 46, borderRadius: 12,
    backgroundColor: '#f1f5f9',
    alignItems: 'center', justifyContent: 'center',
  },
  iconWrapActive: { backgroundColor: '#dbeafe' },
  icon:     { fontSize: 22 },

  cardMeta:    { flex: 1 },
  cardName:    { fontSize: 15, fontWeight: '700', color: '#1e293b' },
  cardSpeed:   { fontSize: 12, color: '#64748b', marginTop: 2 },
  cardCycle:   { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  upgradeNote: { fontSize: 11, color: '#d97706', fontWeight: '600', marginTop: 4 },
  downgradeNote:{ fontSize: 11, color: '#0891b2', fontWeight: '600', marginTop: 4 },

  price: { fontSize: 16, fontWeight: '800', color: '#1e293b', marginBottom: 6 },

  btnUpgrade:   {
    backgroundColor: '#1d4ed8', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  btnDowngrade: {
    backgroundColor: '#0891b2', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  btnTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },

  cardDesc: {
    fontSize: 12, color: '#64748b', marginTop: 8,
    paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f1f5f9',
  },

  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyTxt: { color: '#94a3b8', fontSize: 15 },

  noteBox: {
    backgroundColor: '#fff7ed', borderRadius: 10,
    padding: 12, borderWidth: 1, borderColor: '#fed7aa', marginTop: 4,
  },
  noteTxt: { fontSize: 12, color: '#92400e', lineHeight: 20 },

  overlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  overlayCard: {
    backgroundColor: '#fff', borderRadius: 16,
    padding: 28, alignItems: 'center', gap: 14,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, elevation: 8,
  },
  overlayTxt: { color: '#374151', fontSize: 15, fontWeight: '600' },
});
