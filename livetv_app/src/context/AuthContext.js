import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import * as SecureStore from 'expo-secure-store';
import api, { setUnauthorizedHandler } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]               = useState(null);
  const [token, setToken]             = useState(null);
  const [loading, setLoading]         = useState(true);
  const [logoutReason, setLogoutReason] = useState(null);
  const loggingOutRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const t = await SecureStore.getItemAsync('livetv_token');
        const s = await SecureStore.getItemAsync('livetv_subscriber');
        if (t && s) {
          setToken(t);
          setUser(JSON.parse(s));
          // api default header set করো
          api.defaults.headers.common['Authorization'] = `Bearer ${t}`;
        }
      } catch (_) {}
      setLoading(false);
    })();
  }, []);

  // deactivate/expire/invalid token — যেকোনো screen-এর API call 401 দিলে
  // এখানে ধরা পড়বে, auto logout করে Login screen-এ স্পষ্ট কারণ দেখানো হবে।
  useEffect(() => {
    setUnauthorizedHandler((message) => {
      if (loggingOutRef.current) return; // একসাথে একাধিক 401 এলে একবারই handle করো
      loggingOutRef.current = true;
      setLogoutReason(message || 'আপনার সেশন আর বৈধ নেই। আবার লগইন করুন।');
      SecureStore.deleteItemAsync('livetv_token').catch(() => {});
      SecureStore.deleteItemAsync('livetv_subscriber').catch(() => {});
      delete api.defaults.headers.common['Authorization'];
      setToken(null);
      setUser(null);
      setTimeout(() => { loggingOutRef.current = false; }, 1000);
    });
  }, []);

  const login = async (phone, password) => {
    const res = await api.post('/livetv/app/auth/login/', { phone, password });
    const { token: t, subscriber } = res.data;
    await SecureStore.setItemAsync('livetv_token', t);
    await SecureStore.setItemAsync('livetv_subscriber', JSON.stringify(subscriber));
    api.defaults.headers.common['Authorization'] = `Bearer ${t}`;
    setToken(t);
    setUser(subscriber);
    setLogoutReason(null); // নতুন সফল login-এ আগের logout বার্তা মুছে দাও
    return subscriber;
  };

  const register = async (name, phone, password, customer_id = '') => {
    const res = await api.post('/livetv/app/auth/register/', { name, phone, password, customer_id });
    // open registration হলে token আসে, না হলে pending
    if (res.data.token) {
      const { token: t, subscriber } = res.data;
      await SecureStore.setItemAsync('livetv_token', t);
      await SecureStore.setItemAsync('livetv_subscriber', JSON.stringify(subscriber));
      api.defaults.headers.common['Authorization'] = `Bearer ${t}`;
      setToken(t);
      setUser(subscriber);
    }
    return res.data;
  };

  const logout = async () => {
    await SecureStore.deleteItemAsync('livetv_token');
    await SecureStore.deleteItemAsync('livetv_subscriber');
    delete api.defaults.headers.common['Authorization'];
    setToken(null);
    setUser(null);
  };

  const clearLogoutReason = () => setLogoutReason(null);

  const updateProfile = async (fields) => {
    const res = await api.patch('/livetv/app/auth/me/', fields);
    const updated = res.data;
    await SecureStore.setItemAsync('livetv_subscriber', JSON.stringify(updated));
    setUser(updated);
    return updated;
  };

  return (
    <AuthContext.Provider value={{
      user, token, loading, login, register, logout, updateProfile,
      logoutReason, clearLogoutReason,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
