import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar,
  Platform, Animated, Pressable, TextInput, ScrollView,
  Alert, KeyboardAvoidingView, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../context/AuthContext';

// ── সময় hook ─────────────────────────────────────────────────────────────────
function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// ── ইউজারের নামের প্রথম অক্ষর থেকে avatar রঙ ──────────────────────────────
const AVATAR_COLORS = [
  ['#6366f1', '#8b5cf6'], ['#0ea5e9', '#38bdf8'],
  ['#10b981', '#34d399'], ['#f59e0b', '#fbbf24'],
  ['#ef4444', '#f87171'], ['#ec4899', '#f472b6'],
];
function avatarGradient(name = '') {
  const idx = (name.charCodeAt(0) || 0) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
}

export default function MenuScreen({ navigation }) {
  const { user, logout, updateProfile } = useAuth();
  const now = useClock();

  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  // ── Card press animations ──────────────────────────────────────────────────
  const scaleTV  = useRef(new Animated.Value(1)).current;
  const scaleFTP = useRef(new Animated.Value(1)).current;

  const pressIn  = (sc) => Animated.spring(sc, { toValue: 0.965, useNativeDriver: true, speed: 30 }).start();
  const pressOut = (sc) => Animated.spring(sc, { toValue: 1,     useNativeDriver: true, speed: 20 }).start();

  // ── Profile bottom sheet ───────────────────────────────────────────────────
  const [profileOpen, setProfileOpen]   = useState(false);
  const [editMode, setEditMode]         = useState(false);
  const [newName, setNewName]           = useState('');
  const [newPass, setNewPass]           = useState('');
  const [saving, setSaving]             = useState(false);
  const sheetAnim = useRef(new Animated.Value(600)).current; // translateY — 600 off-screen

  const openProfile = useCallback(() => {
    setProfileOpen(true);
    setEditMode(false);
    setNewName(user?.name || '');
    setNewPass('');
    Animated.spring(sheetAnim, {
      toValue: 0, useNativeDriver: true, tension: 65, friction: 12,
    }).start();
  }, [sheetAnim, user]);

  const closeProfile = useCallback(() => {
    Animated.timing(sheetAnim, { toValue: 600, duration: 260, useNativeDriver: true })
      .start(() => { setProfileOpen(false); setEditMode(false); });
  }, [sheetAnim]);

  const handleSave = async () => {
    const fields = {};
    if (newName.trim() && newName.trim() !== user?.name) fields.name = newName.trim();
    if (newPass.trim()) fields.password = newPass.trim();
    if (!Object.keys(fields).length) { setEditMode(false); return; }
    setSaving(true);
    try {
      await updateProfile(fields);
      setEditMode(false);
      setNewPass('');
      Alert.alert('সফল', 'তথ্য আপডেট হয়েছে।');
    } catch (e) {
      Alert.alert('ব্যর্থ', e?.response?.data?.detail || 'আপডেট করা যায়নি।');
    } finally { setSaving(false); }
  };

  const handleLogout = () => {
    Alert.alert('লগ আউট', 'আপনি কি লগ আউট করতে চান?', [
      { text: 'বাতিল', style: 'cancel' },
      { text: 'লগ আউট', style: 'destructive', onPress: () => { closeProfile(); logout(); } },
    ]);
  };

  const initial = (user?.name || 'U').charAt(0).toUpperCase();
  const gradColors = avatarGradient(user?.name || '');

  // expiry ফরম্যাট
  let expiryStr = '';
  if (user?.expires_at) {
    try {
      expiryStr = new Date(user.expires_at).toLocaleDateString('bn-BD', {
        year: 'numeric', month: 'long', day: 'numeric',
      });
    } catch (_) { expiryStr = user.expires_at; }
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* ── Background gradient ────────────────────────────────────────────── */}
      <LinearGradient
        colors={['#080c1a', '#0d1228', '#080c1a']}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
      {/* Decorative circles */}
      <View style={s.decCircle1} />
      <View style={s.decCircle2} />

      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <View style={[s.topBar, { paddingTop: Platform.OS === 'android' ? 44 : 60 }]}>
        <View>
          <Text style={s.logoTxt}>📺 Rajamehar</Text>
          <Text style={s.logoSub}>Live TV</Text>
        </View>

        {/* User avatar button */}
        <TouchableOpacity onPress={openProfile} activeOpacity={0.8} style={s.avatarBtn}>
          <LinearGradient colors={gradColors} style={s.avatarGrad}>
            <Text style={s.avatarInitial}>{initial}</Text>
          </LinearGradient>
          <View style={s.avatarRing} />
        </TouchableOpacity>
      </View>

      {/* ── Clock + Date ─────────────────────────────────────────────────── */}
      <View style={s.clockSection}>
        <Text style={s.clockTime}>{timeStr}</Text>
        <Text style={s.clockDate}>{dateStr}</Text>
        {!!user?.name && (
          <View style={s.welcomeRow}>
            <View style={s.welcomeDot} />
            <Text style={s.welcomeTxt}>স্বাগতম, {user.name}</Text>
          </View>
        )}
      </View>

      {/* ── Cards ────────────────────────────────────────────────────────── */}
      <View style={s.cardsSection}>

        {/* Live TV */}
        <Animated.View style={{ transform: [{ scale: scaleTV }] }}>
          <TouchableOpacity
            activeOpacity={1}
            onPressIn={() => pressIn(scaleTV)}
            onPressOut={() => pressOut(scaleTV)}
            onPress={() => navigation.navigate('Home')}
          >
            <LinearGradient
              colors={['#1a3a5c', '#0f2340', '#071629']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={s.card}
            >
              {/* Glow top-left */}
              <View style={[s.cardGlow, { backgroundColor: 'rgba(56,189,248,0.12)' }]} />

              <View style={s.cardLeft}>
                <LinearGradient colors={['#0ea5e9', '#0284c7']} style={s.cardIconBox}>
                  <Text style={s.cardIconEmoji}>📺</Text>
                </LinearGradient>
              </View>

              <View style={s.cardBody}>
                <Text style={s.cardLabel}>Live TV</Text>
                <Text style={s.cardSub}>সকল চ্যানেল লাইভ দেখুন</Text>
              </View>

              <View style={s.cardArrow}>
                <Text style={s.cardArrowTxt}>›</Text>
              </View>

              {/* Bottom accent line */}
              <View style={[s.cardAccent, { backgroundColor: '#0ea5e9' }]} />
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>

        {/* FTP Movie Server */}
        <Animated.View style={{ transform: [{ scale: scaleFTP }] }}>
          <TouchableOpacity
            activeOpacity={1}
            onPressIn={() => pressIn(scaleFTP)}
            onPressOut={() => pressOut(scaleFTP)}
            onPress={() => navigation.navigate('FTPList')}
          >
            <LinearGradient
              colors={['#3a1f0d', '#261408', '#160b03']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={s.card}
            >
              <View style={[s.cardGlow, { backgroundColor: 'rgba(251,191,36,0.1)' }]} />

              <View style={s.cardLeft}>
                <LinearGradient colors={['#f59e0b', '#d97706']} style={s.cardIconBox}>
                  <Text style={s.cardIconEmoji}>🎬</Text>
                </LinearGradient>
              </View>

              <View style={s.cardBody}>
                <Text style={s.cardLabel}>FTP Movie Server</Text>
                <Text style={s.cardSub}>মুভি ও সিরিজ ব্রাউজ করুন</Text>
              </View>

              <View style={s.cardArrow}>
                <Text style={s.cardArrowTxt}>›</Text>
              </View>

              <View style={[s.cardAccent, { backgroundColor: '#f59e0b' }]} />
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>

      </View>

      {/* ── Profile bottom sheet ──────────────────────────────────────────── */}
      {profileOpen && (
        <>
          {/* Backdrop */}
          <Pressable style={s.backdrop} onPress={closeProfile} />

          <Animated.View style={[s.sheet, { transform: [{ translateY: sheetAnim }] }]}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              {/* Handle */}
              <View style={s.sheetHandle} />

              {/* Avatar + Name header */}
              <View style={s.sheetHeader}>
                <LinearGradient colors={gradColors} style={s.sheetAvatar}>
                  <Text style={s.sheetAvatarTxt}>{initial}</Text>
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <Text style={s.sheetName}>{user?.name || '—'}</Text>
                  <View style={s.sheetStatusRow}>
                    <View style={s.sheetStatusDot} />
                    <Text style={s.sheetStatusTxt}>Active</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={closeProfile} style={s.sheetClose}>
                  <Text style={s.sheetCloseTxt}>✕</Text>
                </TouchableOpacity>
              </View>

              <View style={s.sheetDivider} />

              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {/* Info rows */}
                {!editMode && (
                  <View style={s.infoSection}>
                    <InfoRow icon="📞" label="ফোন নম্বর"   value={user?.phone      || '—'} />
                    <InfoRow icon="🆔" label="কাস্টমার আইডি" value={user?.customer_id || '—'} />
                    {!!expiryStr && (
                      <InfoRow icon="📅" label="মেয়াদ"       value={expiryStr} />
                    )}
                  </View>
                )}

                {/* Edit form */}
                {editMode ? (
                  <View style={s.editSection}>
                    <Text style={s.editLabel}>নতুন নাম</Text>
                    <TextInput
                      style={s.editInput}
                      value={newName}
                      onChangeText={setNewName}
                      placeholder="নাম লিখুন"
                      placeholderTextColor="#555"
                      autoCapitalize="words"
                    />
                    <Text style={s.editLabel}>নতুন পাসওয়ার্ড</Text>
                    <TextInput
                      style={s.editInput}
                      value={newPass}
                      onChangeText={setNewPass}
                      placeholder="পরিবর্তন না করলে খালি রাখুন"
                      placeholderTextColor="#555"
                      secureTextEntry
                    />

                    <View style={s.editBtnRow}>
                      <TouchableOpacity style={s.cancelBtn} onPress={() => setEditMode(false)} activeOpacity={0.8}>
                        <Text style={s.cancelBtnTxt}>বাতিল</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.saveBtn} onPress={handleSave} activeOpacity={0.8} disabled={saving}>
                        {saving
                          ? <ActivityIndicator color="#fff" size="small" />
                          : <Text style={s.saveBtnTxt}>সংরক্ষণ করুন</Text>
                        }
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity style={s.editToggleBtn} onPress={() => setEditMode(true)} activeOpacity={0.8}>
                    <Text style={s.editToggleIcon}>✏️</Text>
                    <Text style={s.editToggleTxt}>তথ্য আপডেট করুন</Text>
                  </TouchableOpacity>
                )}

                <View style={s.sheetDivider} />

                {/* Logout */}
                <TouchableOpacity style={s.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
                  <Text style={s.logoutIcon}>⏻</Text>
                  <Text style={s.logoutTxt}>লগ আউট</Text>
                </TouchableOpacity>

                <View style={{ height: 32 }} />
              </ScrollView>
            </KeyboardAvoidingView>
          </Animated.View>
        </>
      )}
    </View>
  );
}

// ── Info row component ────────────────────────────────────────────────────────
function InfoRow({ icon, label, value }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.infoLabel}>{label}</Text>
        <Text style={s.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#080c1a' },

  // Decorative background circles
  decCircle1: {
    position: 'absolute', width: 280, height: 280, borderRadius: 140,
    backgroundColor: 'rgba(99,102,241,0.07)',
    top: -60, right: -80,
  },
  decCircle2: {
    position: 'absolute', width: 220, height: 220, borderRadius: 110,
    backgroundColor: 'rgba(14,165,233,0.06)',
    bottom: 80, left: -60,
  },

  // Top bar
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 8,
  },
  logoTxt: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 0.3 },
  logoSub: { color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '600', marginTop: -2 },

  // User avatar button
  avatarBtn: { position: 'relative' },
  avatarGrad: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { color: '#fff', fontSize: 17, fontWeight: '900' },
  avatarRing: {
    position: 'absolute', top: -2, left: -2, right: -2, bottom: -2,
    borderRadius: 23, borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },

  // Clock section
  clockSection: {
    alignItems: 'center', paddingTop: 20, paddingBottom: 24,
  },
  clockTime: {
    color: '#fff', fontSize: 52, fontWeight: '200', letterSpacing: -1,
    includeFontPadding: false,
  },
  clockDate: {
    color: 'rgba(255,255,255,0.38)', fontSize: 13, fontWeight: '500',
    marginTop: 2, letterSpacing: 0.2,
  },
  welcomeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
  },
  welcomeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4ade80' },
  welcomeTxt: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '500' },

  // Cards
  cardsSection: { paddingHorizontal: 20, gap: 14, flex: 1, justifyContent: 'center', paddingBottom: 40 },
  card: {
    borderRadius: 18, padding: 20, flexDirection: 'row', alignItems: 'center', gap: 16,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    overflow: 'hidden', minHeight: 86,
  },
  cardGlow: {
    position: 'absolute', top: -40, left: -20,
    width: 180, height: 180, borderRadius: 90,
  },
  cardLeft: {},
  cardIconBox: {
    width: 48, height: 48, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  cardIconEmoji: { fontSize: 24 },
  cardBody: { flex: 1 },
  cardLabel: { color: '#fff', fontSize: 16, fontWeight: '800', marginBottom: 3 },
  cardSub:   { color: 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: '500' },
  cardArrow: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  cardArrowTxt: { color: 'rgba(255,255,255,0.6)', fontSize: 20, lineHeight: 24 },
  cardAccent: { position: 'absolute', bottom: 0, left: 20, right: 20, height: 1.5, borderRadius: 1 },

  // Backdrop
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },

  // Bottom sheet
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#0e1220',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)',
    // shadow
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.5, shadowRadius: 20, elevation: 30,
    maxHeight: '88%',
  },
  sheetHandle: {
    alignSelf: 'center', width: 36, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)', marginTop: 10, marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 20, paddingBottom: 18,
  },
  sheetAvatar: {
    width: 54, height: 54, borderRadius: 27,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetAvatarTxt: { color: '#fff', fontSize: 22, fontWeight: '900' },
  sheetName:   { color: '#fff', fontSize: 17, fontWeight: '700' },
  sheetStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  sheetStatusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4ade80' },
  sheetStatusTxt: { color: '#4ade80', fontSize: 12, fontWeight: '600' },
  sheetClose:    { padding: 8 },
  sheetCloseTxt: { color: 'rgba(255,255,255,0.4)', fontSize: 18 },
  sheetDivider:  { height: 1, backgroundColor: 'rgba(255,255,255,0.07)', marginHorizontal: 20, marginVertical: 4 },

  // Info rows
  infoSection: { paddingHorizontal: 20, paddingTop: 12, gap: 4 },
  infoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 12, borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  infoIcon:  { fontSize: 18, width: 24, textAlign: 'center' },
  infoLabel: { color: 'rgba(255,255,255,0.38)', fontSize: 11, fontWeight: '600', marginBottom: 2 },
  infoValue: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '600' },

  // Edit toggle button
  editToggleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 20, marginVertical: 16,
    backgroundColor: 'rgba(99,102,241,0.12)',
    borderWidth: 1, borderColor: 'rgba(99,102,241,0.3)',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
  },
  editToggleIcon: { fontSize: 16 },
  editToggleTxt:  { color: '#a5b4fc', fontSize: 14, fontWeight: '600' },

  // Edit form
  editSection: { paddingHorizontal: 20, paddingTop: 16, gap: 8 },
  editLabel:   { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '700', marginBottom: -2, marginTop: 6 },
  editInput: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11,
    color: '#fff', fontSize: 14,
  },
  editBtnRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
  },
  cancelBtnTxt: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '600' },
  saveBtn: {
    flex: 2, paddingVertical: 12, borderRadius: 12,
    backgroundColor: '#6366f1', alignItems: 'center',
  },
  saveBtnTxt: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // Logout
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 20, marginTop: 16,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13,
  },
  logoutIcon: { fontSize: 17 },
  logoutTxt:  { color: '#f87171', fontSize: 14, fontWeight: '700' },
});
