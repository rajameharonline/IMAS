// এই ফাইলটি authentication service।
import api from '../utils/api';

export const authService = {
  login: async (username, password) => {
    const res = await api.post('/auth/login/', { username, password });
    localStorage.setItem('access_token', res.data.access);
    localStorage.setItem('refresh_token', res.data.refresh);
    localStorage.setItem('user', JSON.stringify(res.data.user));
    return res.data;
  },
  logout: async () => {
    try {
      await api.post('/auth/logout/', { refresh: localStorage.getItem('refresh_token') });
    } finally {
      localStorage.clear();
      window.location.href = '/login';
    }
  },
  getCurrentUser: () => {
    const u = localStorage.getItem('user');
    return u ? JSON.parse(u) : null;
  },
  isAuthenticated: () => !!localStorage.getItem('access_token'),
};
