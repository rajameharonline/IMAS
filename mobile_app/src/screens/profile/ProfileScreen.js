import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  TextInput, StyleSheet, ActivityIndicator, Alert, Image,
} from 'react-native';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import StatusBadge from '../../components/StatusBadge';
import ScreenHeader from '../../components/ScreenHeader';
import * as Location from 'expo-location';

// module-level — render-এ re-create হলে TextInput focus হারায়, তাই বাইরে রাখা
function EditField({ label, value, onChange, placeholder, required, multiline, keyboardType }) {
  return (
    <View>
      <Text style={styles.fieldLabel}>
        {label}{required ? <Text style={{ color: '#ef4444' }}> *</Text> : null}
      </Text>
      <TextInput
        style={[styles.field, multiline && { minHeight: 70, textAlignVertical: 'top' }]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        multiline={!!multiline}
        keyboardType={keyboardType || 'default'}
        autoCapitalize={keyboardType === 'email-address' ? 'none' : 'sentences'}
      />
    </View>
  );
}

export default function ProfileScreen() {
  const { client, refreshClient, logout } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const [form, setForm]       = useState({
    father_name: client?.father_name || '',
    area:        client?.area || '',
    house_name:  client?.house_name || '',
    address:     client?.address || '',
    map_lat:     client?.map_lat != null ? String(client.map_lat) : '',
    map_lng:     client?.map_lng != null ? String(client.map_lng) : '',
    alt_phone:   client?.alt_phone || '',
    email:       client?.email || '',
  });

  // device GPS থেকে বর্তমান Latitude/Longitude নিয়ে ঘর ফিলাপ
  const getLocation = async () => {
    setLocLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('অনুমতি প্রয়োজন', 'বর্তমান লোকেশন পেতে GPS অনুমতি দিন।');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setForm(f => ({
        ...f,
        map_lat: pos.coords.latitude.toFixed(6),
        map_lng: pos.coords.longitude.toFixed(6),
      }));
    } catch {
      Alert.alert('ত্রুটি', 'লোকেশন পাওয়া যায়নি। GPS চালু আছে কিনা দেখুন।');
    } finally {
      setLocLoading(false);
    }
  };

  const handleSave = async () => {
    // অ্যাপের জন্য ইমেইল বাধ্যতামূলক
    if (!form.email.trim()) {
      Alert.alert('Email required', 'Email is mandatory to use the app.');
      return;
    }
    // map view-এর জন্য Latitude/Longitude বাধ্যতামূলক
    if (!String(form.map_lat).trim() || !String(form.map_lng).trim()) {
      Alert.alert('Location required', 'Enter Latitude/Longitude — tap the "Get Current Location" button.');
      return;
    }
    setSaving(true);
    try {
      await api.patch('/app/me/', form);
      await refreshClient();
      setEditing(false);
    } catch (e) {
      Alert.alert('Error', e.response?.data?.email?.[0] || 'Could not update your information.');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Logout', style: 'destructive', onPress: logout },
      ]
    );
  };

  const InfoRow = ({ icon, label, value }) => (
    <View style={styles.infoRow}>
      <Text style={styles.infoIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value || '—'}</Text>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f1f5f9' }}>
      <ScreenHeader
        title="My Profile"
        right={
          <TouchableOpacity onPress={() => setEditing(!editing)} style={styles.editBtn}>
            <Text style={styles.editBtnText}>{editing ? 'Cancel' : 'Edit'}</Text>
          </TouchableOpacity>
        }
      />

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          {client?.photo ? (
            <Image source={{ uri: client.photo }} style={styles.avatar} resizeMode="cover" />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{(client?.full_name || 'C').charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <Text style={styles.profileName}>{client?.full_name}</Text>
          <Text style={styles.profileId}>{client?.customer_id}</Text>
          <View style={{ marginTop: 8 }}>
            <StatusBadge status={client?.status} />
          </View>
        </View>

        {/* Personal & contact info — editable */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Personal Information</Text>
          <View style={styles.card}>
            {editing ? (
              <View style={{ gap: 12 }}>
                <EditField label="Father's Name" value={form.father_name} onChange={v => setForm(f => ({ ...f, father_name: v }))} placeholder="Father's name" />
                <EditField label="Area" value={form.area} onChange={v => setForm(f => ({ ...f, area: v }))} placeholder="Area / location" />
                <EditField label="House Name" value={form.house_name} onChange={v => setForm(f => ({ ...f, house_name: v }))} placeholder="House name" />
                <EditField label="Address" value={form.address} onChange={v => setForm(f => ({ ...f, address: v }))} placeholder="Your address" multiline />

                {/* Latitude/Longitude — required for map view */}
                <TouchableOpacity style={[styles.locBtn, locLoading && { opacity: 0.6 }]} onPress={getLocation} disabled={locLoading} activeOpacity={0.85}>
                  {locLoading
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.locBtnText}>📍 Get Current Location</Text>}
                </TouchableOpacity>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <EditField label="Latitude" required value={form.map_lat} onChange={v => setForm(f => ({ ...f, map_lat: v }))} placeholder="23.810600" keyboardType="numeric" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <EditField label="Longitude" required value={form.map_lng} onChange={v => setForm(f => ({ ...f, map_lng: v }))} placeholder="90.412500" keyboardType="numeric" />
                  </View>
                </View>

                <EditField label="Alternate Number" value={form.alt_phone} onChange={v => setForm(f => ({ ...f, alt_phone: v }))} placeholder="01XXXXXXXXX" keyboardType="phone-pad" />
                <EditField label="Email" required value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} placeholder="example@email.com" keyboardType="email-address" />
                <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                  {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <InfoRow icon="👤" label="Father's Name"    value={client?.father_name} />
                <InfoRow icon="📌" label="Area"             value={client?.area} />
                <InfoRow icon="🏠" label="House Name"       value={client?.house_name} />
                <InfoRow icon="📍" label="Address"          value={client?.address} />
                <InfoRow icon="🗺️" label="Map Location"     value={(client?.map_lat && client?.map_lng) ? `${client.map_lat}, ${client.map_lng}` : null} />
                <InfoRow icon="📱" label="Alternate Number" value={client?.alt_phone} />
                <InfoRow icon="✉️" label="Email"            value={client?.email} />
              </>
            )}
          </View>
        </View>

        {/* Account Info — read-only */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account Information</Text>
          <View style={styles.card}>
            <InfoRow icon="🗺️" label="Zone" value={client?.zone_name} />
          </View>
        </View>

        {/* Logout */}
        <View style={{ marginHorizontal: 16, marginTop: 16, marginBottom: 32 }}>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  headerBar: {
    backgroundColor: '#0f2d42',
    paddingHorizontal: 20, paddingVertical: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  editBtn:     { backgroundColor: '#1f5075', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  editBtnText: { color: '#93c5fd', fontSize: 12, fontWeight: '600' },
  profileHeader: {
    backgroundColor: '#0f2d42',
    alignItems: 'center',
    paddingBottom: 28,
    paddingTop: 8,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#1f5075',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: '#3b82f6',
    marginBottom: 10,
  },
  avatarText:   { color: '#fff', fontSize: 28, fontWeight: '900' },
  profileName:  { color: '#fff', fontSize: 18, fontWeight: '700' },
  profileId:    { color: '#64748b', fontSize: 12, marginTop: 2 },
  section:      { marginHorizontal: 16, marginTop: 16 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#475569', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  card: {
    backgroundColor: '#fff', borderRadius: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  infoRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9', gap: 12,
  },
  infoIcon:  { fontSize: 18, width: 24, textAlign: 'center' },
  infoLabel: { fontSize: 11, color: '#94a3b8', marginBottom: 1 },
  infoValue: { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: '#475569', marginBottom: 6 },
  field: {
    borderWidth: 1.5, borderColor: '#e2e8f0',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: '#1e293b',
  },
  locBtn: {
    backgroundColor: '#0f766e', borderRadius: 10, paddingVertical: 12,
    alignItems: 'center', marginTop: 2, marginBottom: 2,
  },
  locBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  saveBtn: {
    backgroundColor: '#173d59',
    borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', marginTop: 4,
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  logoutBtn: {
    borderWidth: 1.5, borderColor: '#fecaca',
    borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', backgroundColor: '#fff5f5',
  },
  logoutText: { color: '#ef4444', fontWeight: '700', fontSize: 14 },
});
