import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

export default function RegisterScreen({ navigation, route }) {
  const { login } = useAuth();
  const { customer_id, full_name, phone_masked, email: initEmail, otp_code } = route.params || {};

  const [otp, setOtp]       = useState(otp_code || '');   // dev mode-এ pre-fill
  const [email, setEmail]   = useState(initEmail || '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [showPwd, setShowPwd]   = useState(false);
  const [showConf, setShowConf] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [errOtp, setErrOtp]     = useState(false);

  const handleSignUp = async () => {
    if (!otp.trim()) { setErrOtp(true); return; }
    setErrOtp(false);
    if (!email.trim()) { Alert.alert('!', 'ইমেইল বাধ্যতামূলক।'); return; }
    if (password.length < 4) { Alert.alert('!', 'Password কমপক্ষে ৪ অক্ষরের হতে হবে।'); return; }
    if (password !== confirm) { Alert.alert('!', 'Password ও Confirm Password মেলেনি।'); return; }
    setLoading(true);
    try {
      const r = await api.post('/app/auth/register/', {
        customer_id, otp_code: otp.trim(), email, password, confirm_password: confirm,
      });
      // auto login
      await login(r.data.access, r.data.refresh, r.data.client);
    } catch (e) {
      Alert.alert('Issue !', e.response?.data?.detail || 'Registration ব্যর্থ হয়েছে।');
    } finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#fff' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View style={styles.blob}>
          <Text style={styles.hi}>Hi There</Text>
          <Text style={styles.sub}>Provide Your Personal and Required Information</Text>
        </View>

        <View style={styles.form}>
          {/* Verification Code (registered phone-এ পাঠানো OTP) */}
          <TextInput style={[styles.input, errOtp && styles.inputErr]} placeholder="Enter Verification Code"
            value={otp} onChangeText={setOtp} keyboardType="number-pad" placeholderTextColor={errOtp ? '#ef4444' : '#9ca3af'} />
          {errOtp && <Text style={styles.fieldErr}>Field can't be empty</Text>}
          <Text style={styles.codeHint}>
            Client Code: <Text style={{ fontWeight: '800' }}>{customer_id}</Text>
            {phone_masked ? `   •   OTP sent to ${phone_masked}` : ''}
          </Text>

          <TextInput style={styles.input} placeholder="Enter Your Email Address"
            value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholderTextColor="#9ca3af" />

          <View style={styles.pwdRow}>
            <TextInput style={styles.pwdInput} placeholder="Enter Your Password" value={password}
              onChangeText={setPassword} secureTextEntry={!showPwd} placeholderTextColor="#9ca3af" />
            <TouchableOpacity onPress={() => setShowPwd(s => !s)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={{ fontSize: 18 }}>{showPwd ? '🙈' : '👁️'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.pwdRow}>
            <TextInput style={styles.pwdInput} placeholder="Enter Confirm Password" value={confirm}
              onChangeText={setConfirm} secureTextEntry={!showConf} placeholderTextColor="#9ca3af" />
            <TouchableOpacity onPress={() => setShowConf(s => !s)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={{ fontSize: 18 }}>{showConf ? '🙈' : '👁️'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={[styles.btn, loading && { opacity: 0.6 }]} onPress={handleSignUp} disabled={loading} activeOpacity={0.85}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Sign Up</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  blob: {
    backgroundColor: '#0f2d42', height: 230,
    borderBottomLeftRadius: 90, borderBottomRightRadius: 220,
    paddingTop: 56, paddingHorizontal: 30,
  },
  hi:  { color: '#fff', fontSize: 28, fontWeight: '900', fontStyle: 'italic', marginBottom: 14 },
  sub: { color: '#fff', fontSize: 19, fontWeight: '800', lineHeight: 26 },

  form: { paddingHorizontal: 28, paddingTop: 36 },
  input: {
    borderWidth: 1.3, borderColor: '#cbd5e1', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 15, fontSize: 15, color: '#111827', marginBottom: 16,
  },
  inputErr: { borderColor: '#ef4444' },
  fieldErr: { color: '#ef4444', fontSize: 12, marginTop: -12, marginBottom: 8 },
  codeHint: { color: '#475569', fontSize: 13, marginBottom: 16 },
  pwdRow: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1.3, borderColor: '#cbd5e1',
    borderRadius: 12, paddingHorizontal: 16, marginBottom: 16,
  },
  pwdInput: { flex: 1, paddingVertical: 15, fontSize: 15, color: '#111827' },
  btn: { backgroundColor: '#0f2d42', borderRadius: 30, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
