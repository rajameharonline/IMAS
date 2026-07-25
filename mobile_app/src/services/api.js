import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

import { BASE_URL } from '../config';

// Logout callback — AuthContext থেকে set করা হবে
let _logoutCallback = null;
export const setLogoutCallback = (cb) => { _logoutCallback = cb; };

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 25000,  // গ্রামীণ/দুর্বল নেটওয়ার্কের জন্য 25s (আগে 15s ছিল)
  headers: { 'Content-Type': 'application/json' },
});

// Public endpoints — token পাঠাবে না (token থাকলেও)
const PUBLIC_PATHS = ['/app/config/', '/app/banners/', '/app/auth/login/', '/app/auth/register/check/', '/app/auth/register/', '/app/auth/refresh/'];

// প্রতিটি request-এ JWT token auto-attach (public endpoints বাদে)
api.interceptors.request.use(async (config) => {
  const isPublic = PUBLIC_PATHS.some(p => config.url?.includes(p));
  if (!isPublic) {
    try {
      const token = await SecureStore.getItemAsync('access_token');
      if (token) config.headers.Authorization = `Bearer ${token}`;
    } catch {}
  }
  return config;
});

// 401 হলে mobile custom refresh endpoint দিয়ে নতুন token নেওয়া
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const refresh = await SecureStore.getItemAsync('refresh_token');
        if (refresh) {
          // mobile custom refresh endpoint
          const r = await axios.post(`${BASE_URL}/app/auth/refresh/`, { refresh });
          const newAccess = r.data.access;
          await SecureStore.setItemAsync('access_token', newAccess);
          original.headers.Authorization = `Bearer ${newAccess}`;
          return api(original);
        }
      } catch {
        // refresh fail — token clear + logout
        await SecureStore.deleteItemAsync('access_token');
        await SecureStore.deleteItemAsync('refresh_token');
        if (_logoutCallback) _logoutCallback();
      }
    }
    return Promise.reject(error);
  }
);

export default api;
