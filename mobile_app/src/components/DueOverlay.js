// DueOverlay — বকেয়া/সংযোগ বন্ধ হলে payment notice।
//
// দুই ধরনের আচরণ:
//   (১) সংযোগ বন্ধ (status expired/suspended/inactive/cancelled) → পুরো স্ক্রিন জুড়ে
//       hard-block। dismiss করা যায় না (back button নিষ্ক্রিয়)। শুধু "পরিশোধ করুন"/
//       "সাপোর্ট"/"রিফ্রেশ"/"লগআউট" করা যায়।
//   (২) সংযোগ এখনো active কিন্তু bill due (due > 0) → উপরে dismissible reminder
//       banner। ইন্টারনেট চালু থাকায় গ্রাহককে আটকানো হয় না, শুধু মনে করিয়ে দেওয়া হয়।
//
// দুই ক্ষেত্রেই payment-এর পর refreshClient/auto-poll due_amount/status আপডেট করে
// notice নিজে নিজেই চলে যায়।
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, BackHandler, StyleSheet, ScrollView, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { BASE_URL } from '../config';

const DEFAULT_HELPLINE = '01303120098';

const BLOCK_STATUSES = ['expired', 'suspended', 'inactive', 'cancelled'];

// এই পেজগুলোতে overlay লুকায় — যাতে গ্রাহক আসলে পরিশোধ/সাপোর্ট করতে পারে।
const ALLOW_ROUTES = [
  'Recharge', 'BkashWebView', 'PaymentSuccess', 'PaymentCancelled', 'Invoice',
  'SupportList', 'SupportCreate', 'SupportDetail',
];

const STATUS_LABEL = {
  expired:   'আপনার মেয়াদ শেষ হয়েছে',
  suspended: 'আপনার সংযোগ সাময়িক বন্ধ',
  inactive:  'আপনার সংযোগ নিষ্ক্রিয়',
  cancelled: 'আপনার সংযোগ বাতিল',
};

export default function DueOverlay({ navRef, routeName }) {
  const { client, refreshClient, logout } = useAuth();
  const insets  = useSafeAreaInsets();
  const status  = client?.status;
  const due     = Number(client?.due_amount || 0);
  // expiry_date পার হয়ে গেছে কিনা — backend status flip (daily task) হওয়ার আগেও
  // অ্যাপ যেন সাথে সাথে full-screen reminder দেখায় (expiry = সর্বোচ্চ অগ্রাধিকার)।
  const expiryPassed = (() => {
    if (!client?.expiry_date) return false;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const exp = new Date(`${client.expiry_date}T00:00:00`);
    return !isNaN(exp) && exp < t;
  })();
  // isCut = সেবা বন্ধ: status block অথবা মেয়াদ পার। (শুধু বকেয়া হলে isCut নয়)
  const isCut   = BLOCK_STATUSES.includes(status) || expiryPassed;
  // payment notice কখন? বকেয়া আছে অথবা মেয়াদ শেষ (expired) — গ্রাহক বুঝবে পরিশোধ/
  // নবায়ন দরকার। শুধু admin manually suspend/inactive + বকেয়া নেই হলে payment নয়,
  // তখন হেল্পলাইনে যোগাযোগের বার্তা (expired-এর due এখনো 0 হলেও payment page-ই থাকবে)।
  const showPayment = due > 0 || status === 'expired' || expiryPassed;
  // payment/support পেজে থাকলে কোনো notice নয় (গ্রাহক যেন পরিশোধ করতে পারে)।
  const onAllowedPage = ALLOW_ROUTES.includes(routeName);

  // dueOnly reminder banner একবার dismiss করলে সেশনে আর দেখাবে না (due বদলালে রিসেট)।
  const [bannerDismissed, setBannerDismissed] = useState(false);
  useEffect(() => { setBannerDismissed(false); }, [due]);

  // hard-block: সংযোগ আসলেই বন্ধ (expired/suspended/inactive/cancelled) হলেই পুরো স্ক্রিন।
  const hardBlock = !!client && isCut && !onAllowedPage;
  // dueOnly: সংযোগ এখনো active কিন্তু bill due — শুধু dismissible reminder banner।
  const dueBanner = !!client && !isCut && due > 0 && !onAllowedPage && !bannerDismissed;
  const blocked   = hardBlock;  // back-button/poll-এর জন্য (নিচে ব্যবহৃত)

  // helpline নম্বর — /app/config/ (admin Company Setup) থেকে, fallback default
  const [helpline, setHelpline] = useState(DEFAULT_HELPLINE);
  useEffect(() => {
    let alive = true;
    axios.get(`${BASE_URL}/app/config/`)
      .then(r => { if (alive && r.data?.company_phone) setHelpline(r.data.company_phone); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // blocked থাকলে hardware back button নিষ্ক্রিয় (dismiss এড়াতে)
  useEffect(() => {
    if (!blocked) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [blocked]);

  // block/banner থাকলে প্রতি ১৫s client status refresh — admin/গ্রাহক বিল পরিশোধ
  // করলে due_amount 0 / status active হয়ে notice নিজে নিজেই চলে যায়।
  useEffect(() => {
    if ((!hardBlock && !dueBanner) || !refreshClient) return;
    const id = setInterval(() => { refreshClient(); }, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hardBlock, dueBanner]);

  const goRecharge = () => {
    try {
      navRef?.current?.navigate('Main', { screen: 'Home', params: { screen: 'Recharge' } });
    } catch (e) { /* nav না থাকলে চুপ */ }
  };
  const goSupport = () => {
    try { navRef?.current?.navigate('Main', { screen: 'Support' }); } catch (e) {}
  };

  // ── (২) সংযোগ active, শুধু বকেয়া → dismissible reminder banner ──────────────
  if (dueBanner) {
    return (
      <View style={[s.banner, { top: insets.top + 6 }]} pointerEvents="box-none">
        <View style={s.bannerCard}>
          <Text style={s.bannerIcon}>⚠️</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.bannerTitle}>বিল বকেয়া: ৳ {due.toLocaleString('en-US')}</Text>
            <Text style={s.bannerSub}>সেবা চালু রাখতে অনুগ্রহ করে পরিশোধ করুন।</Text>
          </View>
          <TouchableOpacity style={s.bannerPay} onPress={goRecharge} activeOpacity={0.85}>
            <Text style={s.bannerPayText}>পরিশোধ</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.bannerClose} onPress={() => setBannerDismissed(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.bannerCloseText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── (১) সংযোগ বন্ধ → পুরো স্ক্রিন hard-block ────────────────────────────────
  if (!hardBlock) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={s.backdrop}>
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <View style={s.card}>
            <View style={s.iconWrap}><Text style={s.icon}>⚠️</Text></View>

            <Text style={s.title}>{STATUS_LABEL[status] || (expiryPassed ? STATUS_LABEL.expired : 'সংযোগ বন্ধ')}</Text>
            {/* বকেয়া/মেয়াদ শেষ হলে payment বার্তা; শুধু admin manually বন্ধ (বকেয়া
                নেই) হলে যোগাযোগের বার্তা */}
            <Text style={s.sub}>{showPayment
              ? 'ইন্টারনেট সেবা চালু রাখতে অনুগ্রহ করে বিল পরিশোধ করুন।'
              : 'সংযোগ পুনরায় চালু করতে অনুগ্রহ করে আমাদের হেল্পলাইনে যোগাযোগ করুন।'}</Text>

            {/* বিল box শুধু বকেয়া থাকলে (৳0 দেখাই না); পরিশোধ বাটন payment-কেসে */}
            {due > 0 && (
              <View style={s.dueBox}>
                <Text style={s.dueLabel}>বিল</Text>
                <Text style={s.dueAmount}>৳ {due.toLocaleString('en-US')}</Text>
              </View>
            )}

            {showPayment && (
              <TouchableOpacity style={s.payBtn} onPress={goRecharge} activeOpacity={0.85}>
                <Text style={s.payBtnText}>এখনই পরিশোধ করুন</Text>
              </TouchableOpacity>
            )}

            <View style={[s.row, showPayment ? null : { marginTop: 22 }]}>
              <TouchableOpacity style={s.secBtn} onPress={goSupport}><Text style={s.secText}>সাপোর্ট</Text></TouchableOpacity>
              <TouchableOpacity style={s.secBtn} onPress={() => refreshClient && refreshClient()}><Text style={s.secText}>রিফ্রেশ</Text></TouchableOpacity>
            </View>

            {/* হেল্পলাইন — চাপলে সরাসরি কল হবে */}
            {!!helpline && (
              <TouchableOpacity style={s.helpBtn} activeOpacity={0.8}
                onPress={() => Linking.openURL(`tel:${helpline}`)}>
                <Text style={s.helpText}>📞 হেল্পলাইন: {helpline}</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity onPress={() => logout && logout()}><Text style={s.logout}>লগআউট</Text></TouchableOpacity>

            <Text style={s.note}>{showPayment
              ? 'পরিশোধের পর সংযোগ চালু হতে কিছুক্ষণ সময় লাগতে পারে। "রিফ্রেশ" চাপুন।'
              : 'সংযোগ চালু হলে "রিফ্রেশ" চাপুন।'}</Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,45,66,0.97)' },
  scroll:   { flexGrow: 1, justifyContent: 'center', padding: 22 },
  card:     { backgroundColor: '#fff', borderRadius: 20, padding: 24, alignItems: 'center' },
  iconWrap: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#fef2f2', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  icon:     { fontSize: 38 },
  title:    { fontSize: 21, fontWeight: '800', color: '#b91c1c', textAlign: 'center' },
  sub:      { fontSize: 14, color: '#475569', textAlign: 'center', marginTop: 8, lineHeight: 21 },
  dueBox:   { backgroundColor: '#fff7ed', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 28, alignItems: 'center', marginTop: 18, borderWidth: 1, borderColor: '#fed7aa' },
  dueLabel: { fontSize: 12, color: '#9a3412', fontWeight: '700' },
  dueAmount:{ fontSize: 30, color: '#ea580c', fontWeight: '900', marginTop: 2 },
  payBtn:   { backgroundColor: '#16a34a', borderRadius: 14, paddingVertical: 15, width: '100%', alignItems: 'center', marginTop: 22 },
  payBtnText:{ color: '#fff', fontSize: 17, fontWeight: '800' },
  row:      { flexDirection: 'row', gap: 12, marginTop: 12, width: '100%' },
  secBtn:   { flex: 1, backgroundColor: '#f1f5f9', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  secText:  { color: '#334155', fontSize: 14, fontWeight: '700' },
  helpBtn:  { marginTop: 16, backgroundColor: '#eff6ff', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, width: '100%', alignItems: 'center', borderWidth: 1, borderColor: '#bfdbfe' },
  helpText: { color: '#1d4ed8', fontSize: 15, fontWeight: '800' },
  logout:   { color: '#94a3b8', fontSize: 13, marginTop: 18, fontWeight: '600' },
  note:     { fontSize: 11.5, color: '#94a3b8', textAlign: 'center', marginTop: 14, lineHeight: 17 },

  // dueOnly reminder banner (active client, শুধু বকেয়া)
  banner:     { position: 'absolute', left: 10, right: 10, zIndex: 50 },
  bannerCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff7ed', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#fdba74', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 5 },
  bannerIcon: { fontSize: 20, marginRight: 8 },
  bannerTitle:{ fontSize: 14, fontWeight: '800', color: '#9a3412' },
  bannerSub:  { fontSize: 11.5, color: '#b45309', marginTop: 1 },
  bannerPay:  { backgroundColor: '#16a34a', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, marginLeft: 8 },
  bannerPayText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  bannerClose:{ marginLeft: 6, paddingHorizontal: 4 },
  bannerCloseText: { color: '#9a3412', fontSize: 16, fontWeight: '700' },
});
