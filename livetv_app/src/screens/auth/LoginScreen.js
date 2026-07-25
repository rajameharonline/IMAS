import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, StatusBar,
  Alert, ScrollView,
} from 'react-native';
import { useAuth } from '../../context/AuthContext';

export default function LoginScreen() {
  const { login, logoutReason, clearLogoutReason } = useAuth();

  // Login state
  const [phone, setPhone]       = useState('');
  const [password, setPassword] = useState('');

  const [loading, setLoading] = useState(false);

  // deactivate/expire হয়ে auto-logout হলে কারণ একবার দেখাও
  useEffect(() => {
    if (logoutReason) {
      Alert.alert('লগ আউট হয়েছে', logoutReason, [
        { text: 'ঠিক আছে', onPress: clearLogoutReason },
      ]);
    }
  }, [logoutReason, clearLogoutReason]);

  const handleLogin = async () => {
    if (!phone.trim() || !password.trim()) {
      Alert.alert('Error', 'ফোন নম্বর ও পাসওয়ার্ড দিন।');
      return;
    }
    setLoading(true);
    try {
      await login(phone.trim(), password);
    } catch (e) {
      const msg = e.response?.data?.detail || 'Login failed. Check your credentials.';
      Alert.alert('Login Failed', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar barStyle="light-content" backgroundColor="#0f0f0f" />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Logo */}
        <View style={styles.logoContainer}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoIcon}>📺</Text>
          </View>
          <Text style={styles.appName}>Rajamehar Live TV</Text>
          <Text style={styles.tagline}>Watch Live Channels</Text>
        </View>

        {/* Login Form */}
        <View style={styles.formContainer}>
          <Text style={styles.label}>Phone Number</Text>
          <TextInput
            style={styles.input}
            placeholder="01XXXXXXXXX"
            placeholderTextColor="#555"
            value={phone}
            onChangeText={setPhone}
            autoCapitalize="none"
            keyboardType="phone-pad"
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your password"
            placeholderTextColor="#555"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity
            style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.loginBtnText}>Sign In</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.helpText}>
            নতুন সংযোগের জন্য অফিসে যোগাযোগ করুন। Self-registration বন্ধ আছে।
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f0f',
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 40,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#1a1a1a',
    borderWidth: 2,
    borderColor: '#e50914',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  logoIcon: { fontSize: 40 },
  appName: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  tagline: {
    color: '#888',
    fontSize: 13,
    marginTop: 4,
  },
  formContainer: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 24,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  label: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  input: {
    backgroundColor: '#0f0f0f',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 15,
  },
  loginBtn: {
    backgroundColor: '#e50914',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  loginBtnDisabled: { opacity: 0.6 },
  loginBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  helpText: {
    color: '#555',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 16,
  },
});
