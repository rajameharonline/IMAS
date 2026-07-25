import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Image, Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import axios from 'axios';
import api from '../../services/api';

import { BASE_URL } from '../../config';

export default function ClientCodeScreen({ navigation }) {
  const [code, setCode]       = useState('');
  const [loading, setLoading] = useState(false);
  const [logo, setLogo]       = useState('');
  const [company, setCompany] = useState('');

  useEffect(() => {
    axios.get(`${BASE_URL}/app/config/`).then(r => {
      setLogo(r.data?.company_logo || '');
      setCompany(r.data?.company_name || '');
    }).catch(() => {});
  }, []);

  const handleContinue = async () => {
    if (!code.trim()) { Alert.alert('!', 'Client Code দিন।'); return; }
    setLoading(true);
    try {
      const r = await api.post('/app/auth/register/check/', { customer_id: code.trim() });
      // eligible — Register screen-এ (OTP registered phone-এ পাঠানো হয়েছে)
      navigation.navigate('Register', {
        customer_id: r.data.customer_id,
        full_name:   r.data.full_name,
        phone_masked: r.data.phone_masked,
        email:       r.data.email || '',
        otp_code:    r.data.otp_code || '',   // dev mode-এ থাকলে
      });
    } catch (e) {
      Alert.alert('Issue !', e.response?.data?.detail || 'যাচাই ব্যর্থ হয়েছে।');
    } finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#fff' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View style={styles.blob}>
          {logo
            ? <Image source={{ uri: logo }} style={styles.logo} resizeMode="contain" />
            : <Text style={styles.logoText}>{company || 'ISP'}</Text>}
        </View>

        <View style={styles.form}>
          <Text style={styles.title}>Provide Your Client Code</Text>
          <TextInput style={styles.input} placeholder="Client Code/User Name"
            value={code} onChangeText={setCode} autoCapitalize="none" placeholderTextColor="#9ca3af" />

          <TouchableOpacity style={[styles.btn, loading && { opacity: 0.6 }]} onPress={handleContinue} disabled={loading} activeOpacity={0.85}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Continue</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 18 }}>
            <Text style={styles.back}>← Login-এ ফিরে যান</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  blob: {
    backgroundColor: '#3b5998', height: 230,
    borderBottomLeftRadius: 90, borderBottomRightRadius: 220,
    paddingTop: 60, alignItems: 'center', justifyContent: 'center',
  },
  logo:     { width: 240, height: 110 },
  logoText: { color: '#fff', fontSize: 30, fontWeight: '900' },
  form:     { paddingHorizontal: 28, paddingTop: 60, alignItems: 'center' },
  title:    { fontSize: 20, fontWeight: '900', color: '#0f2d42', marginBottom: 24 },
  input: {
    width: '100%', borderWidth: 1.3, borderColor: '#cbd5e1', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 15, fontSize: 15, color: '#111827', marginBottom: 28,
  },
  btn: { backgroundColor: '#3b5998', borderRadius: 30, paddingVertical: 14, paddingHorizontal: 56, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  back: { color: '#64748b', fontSize: 13 },
});
