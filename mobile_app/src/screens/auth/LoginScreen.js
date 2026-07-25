import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Image, Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import axios from 'axios';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

import { BASE_URL } from '../../config';

export default function LoginScreen({ navigation }) {
  const { login } = useAuth();
  const [code, setCode]         = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd]   = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [logo, setLogo]         = useState('');
  const [company, setCompany]   = useState('');

  useEffect(() => {
    // logo + company name admin System Settings থেকে
    axios.get(`${BASE_URL}/app/config/`).then(r => {
      setLogo(r.data?.company_logo || '');
      setCompany(r.data?.company_name || '');
    }).catch(() => {});
    SecureStore.getItemAsync('remember_code').then(v => { if (v) setCode(v); }).catch(() => {});
  }, []);

  const handleLogin = async () => {
    if (!code.trim() || !password) { setError('Client Code ও Password দিন।'); return; }
    setError(''); setLoading(true);
    try {
      // identifier পাঠাই — backend Client (Customer Code) ও Staff (Username) auto-detect করে
      const r = await api.post('/app/auth/login/', { identifier: code.trim(), password });
      if (remember) await SecureStore.setItemAsync('remember_code', code.trim());
      else await SecureStore.deleteItemAsync('remember_code');
      await login(r.data);
    } catch (e) {
      setError(e.response?.data?.detail || 'লগইন ব্যর্থ হয়েছে।');
    } finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#fff' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        {/* Blob header + logo */}
        <View style={styles.blob}>
          <Text style={styles.welcome}>Welcome,</Text>
          {logo
            ? <Image source={{ uri: logo }} style={styles.logo} resizeMode="contain" />
            : <Text style={styles.logoText}>{company || 'ISP'}</Text>}
        </View>

        <View style={styles.form}>
          {/* Client Code/User Name — অক্ষর-সহ সাধারণ কিবোর্ড (code-এ R-এর মত letter থাকে) */}
          <TextInput style={styles.input} placeholder="Client Code/User Name"
            value={code} onChangeText={setCode} autoCapitalize="none"
            keyboardType="default" placeholderTextColor="#9ca3af" />

          <View style={styles.pwdRow}>
            {/* Password — number pad (password সংখ্যা/PIN) */}
            <TextInput style={styles.pwdInput} placeholder="Password" value={password}
              onChangeText={setPassword} secureTextEntry={!showPwd}
              keyboardType="number-pad" placeholderTextColor="#9ca3af" />
            <TouchableOpacity onPress={() => setShowPwd(s => !s)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={{ fontSize: 18 }}>{showPwd ? '🙈' : '👁️'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.rememberRow}>
            <TouchableOpacity style={styles.remember} onPress={() => setRemember(r => !r)} activeOpacity={0.7}>
              <View style={[styles.checkbox, remember && styles.checkboxOn]}>
                {remember && <Text style={styles.checkTick}>✓</Text>}
              </View>
              <Text style={styles.rememberTxt}>Remember me?</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => Alert.alert('Forgot Password', 'Password রিসেট করতে অফিসে যোগাযোগ করুন।')}>
              <Text style={styles.forgot}>Forgot Password?</Text>
            </TouchableOpacity>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity style={[styles.btn, loading && { opacity: 0.6 }]} onPress={handleLogin} disabled={loading} activeOpacity={0.85}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Log In</Text>}
          </TouchableOpacity>

          <Text style={styles.footer}>
            Are you a customer of <Text style={{ fontWeight: '800', color: '#0f2d42' }}>{company || 'us'}</Text>?
          </Text>
          <Text style={styles.footer}>
            Ensure your account is{' '}
            <Text style={styles.regLink} onPress={() => navigation.navigate('ClientCode')}>Registered</Text>
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  blob: {
    backgroundColor: '#3b5998', height: 250,
    borderBottomLeftRadius: 90, borderBottomRightRadius: 220,
    paddingTop: 56, paddingHorizontal: 30, alignItems: 'flex-start',
  },
  welcome:  { color: '#fff', fontSize: 26, fontWeight: '900', fontStyle: 'italic' },
  logo:     { width: 220, height: 90, marginTop: 6 },
  logoText: { color: '#fff', fontSize: 30, fontWeight: '900', marginTop: 10 },

  form: { paddingHorizontal: 28, paddingTop: 40 },
  input: {
    borderWidth: 1.3, borderColor: '#cbd5e1', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 15, fontSize: 15, color: '#111827', marginBottom: 18,
  },
  pwdRow: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1.3, borderColor: '#cbd5e1',
    borderRadius: 12, paddingHorizontal: 16, marginBottom: 14,
  },
  pwdInput: { flex: 1, paddingVertical: 15, fontSize: 15, color: '#111827' },
  rememberRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 26 },
  remember: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#94a3b8', alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: '#3b5998', borderColor: '#3b5998' },
  checkTick: { color: '#fff', fontSize: 13, fontWeight: '900' },
  rememberTxt: { color: '#475569', fontSize: 14 },
  forgot: { color: '#0f2d42', fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
  error: { color: '#ef4444', fontSize: 13, marginBottom: 12, textAlign: 'center' },
  btn: { backgroundColor: '#3b5998', borderRadius: 30, paddingVertical: 15, alignItems: 'center', marginBottom: 22 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  footer: { textAlign: 'center', color: '#475569', fontSize: 13, lineHeight: 22 },
  regLink: { color: '#0f2d42', fontWeight: '800', textDecorationLine: 'underline' },
});
