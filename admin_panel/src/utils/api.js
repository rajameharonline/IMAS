// এই ফাইলটি সব API call-এর জন্য Axios instance।
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';
// Token expire-এর কত সেকেন্ড আগে proactive refresh করব
const REFRESH_BEFORE_EXPIRY_SEC = 60;

const api = axios.create({ baseURL: API_BASE_URL });

// একই সময়ে একাধিক request refresh চাইলে শুধু একটাই refresh হবে (race condition prevent)
let refreshPromise = null;

function getTokenSecondsRemaining(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return 0;
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) payload += '=';
    const { exp } = JSON.parse(atob(payload));
    return exp - Math.floor(Date.now() / 1000);
  } catch {
    return 0;
  }
}

function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;
  const refresh = localStorage.getItem('refresh_token');
  if (!refresh) return Promise.reject(new Error('no refresh token'));
  refreshPromise = axios
    .post(`${API_BASE_URL}/auth/token/refresh/`, { refresh })
    .then((res) => {
      localStorage.setItem('access_token', res.data.access);
      return res.data.access;
    })
    .finally(() => { refreshPromise = null; });
  return refreshPromise;
}

function forceLogout() {
  localStorage.clear();
  window.location.href = '/login';
}

api.interceptors.request.use(async (config) => {
  let token = localStorage.getItem('access_token');
  if (token && getTokenSecondsRemaining(token) < REFRESH_BEFORE_EXPIRY_SEC) {
    try {
      token = await refreshAccessToken();
    } catch {
      forceLogout();
      return Promise.reject(new Error('refresh failed'));
    }
  }
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const token = await refreshAccessToken();
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch {
        forceLogout();
      }
    }
    return Promise.reject(error);
  }
);

export default api;
