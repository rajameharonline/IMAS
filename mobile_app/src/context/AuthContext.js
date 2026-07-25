import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import api, { setLogoutCallback } from '../services/api';

const AuthContext = createContext(null);

// অ্যাপ থেকে বের হয়ে (background/বন্ধ) ৮ ঘণ্টা পার হলে auto-logout।
// ৮ ঘণ্টা: সারাদিন ব্যাগে থাকলেও VoIP কল পাবে; রাতে phone তুলে অন্য কেউ দেখতে পাবে না।
const AUTO_LOGOUT_MS = 8 * 60 * 60 * 1000;

export function AuthProvider({ children }) {
  const [client,        setClient]        = useState(null);
  const [staffUser,     setStaffUser]     = useState(null); // staff/admin হলে User object
  const [permissions,   setPermissions]   = useState(null); // staff role permissions snapshot
  const [popUser,       setPopUser]       = useState(null); // POP reseller হলে POP object
  const [popMenus,      setPopMenus]      = useState([]);   // POP-এর allowed menu keys
  const [accountType,   setAccountType]   = useState(null); // 'client' | 'staff' | 'pop'
  const [preloadedBill, setPreloadedBill] = useState(null); // login-এ pre-fetch করা bill data
  const [loading,       setLoading]       = useState(true);

  // App শুরুতে token থেকে restore
  useEffect(() => {
    const restore = async () => {
      try {
        const token = await SecureStore.getItemAsync('access_token');
        const stored = token ? await SecureStore.getItemAsync('account_type') : null;
        // Cold start auto-logout:
        //   - client/pop → ৮ ঘণ্টা নিষ্ক্রিয়তায় token মুছে logged-out (নিরাপত্তা)।
        //   - staff/admin → কখনো auto-logout নয় (সবসময় online থাকা জরুরি — কল ধরতে)।
        if (token && stored !== 'staff') {
          const bg = await SecureStore.getItemAsync('bg_since');
          if (bg && Date.now() - Number(bg) >= AUTO_LOGOUT_MS) {
            await SecureStore.deleteItemAsync('access_token');
            await SecureStore.deleteItemAsync('refresh_token');
            await SecureStore.deleteItemAsync('bg_since');
            setLoading(false);
            return;
          }
        }
        if (token) {
          // account_type অনুযায়ী সঠিক profile endpoint
          if (stored === 'staff') {
            const meR = await api.get('/app/staff/me/');
            setStaffUser(meR.data.user);
            setPermissions(meR.data.permissions);
            setAccountType('staff');
          } else if (stored === 'pop') {
            const meR = await api.get('/app/pop/me/');
            setPopUser(meR.data.pop);
            setPopMenus(meR.data.menus || []);
            setAccountType('pop');
          } else {
            // Client (default) — profile ও bill একসাথে
            const [meR, billR] = await Promise.allSettled([
              api.get('/app/me/'),
              api.get('/app/bills/current/'),
            ]);
            if (meR.status === 'fulfilled')   setClient(meR.value.data);
            if (billR.status === 'fulfilled') setPreloadedBill(billR.value.data);
            setAccountType('client');
          }
        }
      } catch {
        await SecureStore.deleteItemAsync('access_token');
        await SecureStore.deleteItemAsync('refresh_token');
      } finally {
        setLoading(false);
      }
    };
    restore();
  }, []);

  // login — role-aware: পুরো login response object নেয় (account_type সহ)।
  const login = async (data) => {
    // Token store — api interceptor এখান থেকে পড়বে
    await SecureStore.setItemAsync('access_token', data.access);
    await SecureStore.setItemAsync('refresh_token', data.refresh);
    const type = data.account_type || 'client';
    await SecureStore.setItemAsync('account_type', type);
    setAccountType(type);

    // ── Staff/Admin path ──
    if (type === 'staff') {
      // login response-এ user+permissions আছে; তাজা snapshot-এর জন্য /staff/me/ও পারি
      setStaffUser(data.user || null);
      setPermissions(data.permissions || null);
      try {
        const meR = await api.get('/app/staff/me/');
        setStaffUser(meR.data.user);
        setPermissions(meR.data.permissions);
      } catch {}
      return;
    }

    // ── POP reseller path ──
    if (type === 'pop') {
      setPopUser(data.pop || null);
      setPopMenus(data.menus || []);
      try {
        const meR = await api.get('/app/pop/me/');
        setPopUser(meR.data.pop);
        setPopMenus(meR.data.menus || []);
      } catch {}
      return;
    }

    // ── Client path ──
    try {
      const [meR, billR] = await Promise.allSettled([
        api.get('/app/me/'),
        api.get('/app/bills/current/'),
      ]);
      if (billR.status === 'fulfilled') setPreloadedBill(billR.value.data);
      if (meR.status === 'fulfilled') setClient(meR.value.data);
      else setClient(data.client);
    } catch {
      setClient(data.client);
    }
  };

  const logout = async () => {
    try { await api.post('/app/auth/logout/'); } catch {}
    await SecureStore.deleteItemAsync('access_token');
    await SecureStore.deleteItemAsync('refresh_token');
    await SecureStore.deleteItemAsync('account_type');
    setClient(null);
    setStaffUser(null);
    setPermissions(null);
    setPopUser(null);
    setPopMenus([]);
    setAccountType(null);
    setPreloadedBill(null);
  };

  // ── Permission helpers (staff) — backend-ই আসল enforcer; এগুলো UI guard ──
  const isStaff  = accountType === 'staff';
  const isClient = accountType === 'client';
  const isPop    = accountType === 'pop';
  const isSuper  = !!permissions?.is_super;

  // POP menu guard — pop.menus list-এ key আছে কিনা (hierarchical key)
  const hasMenu = (key) => isPop && (popMenus || []).includes(key);

  const hasModule = (moduleKey, subModuleKey = null) => {
    if (!isStaff) return false;
    if (isSuper) return true;
    const mods = permissions?.modules || [];
    return mods.some(m =>
      m.module_key === moduleKey &&
      (subModuleKey ? m.sub_module_key === subModuleKey : true)
    );
  };

  const hasGranular = (contextKey, permissionKey) => {
    if (!isStaff) return false;
    if (isSuper) return true;
    const gr = permissions?.granular || [];
    return gr.some(g => g.context_key === contextKey && g.permission_key === permissionKey);
  };

  useEffect(() => { setLogoutCallback(logout); }, []);

  // ── Auto-logout: অ্যাপ থেকে বের হয়ে (background/inactive) ৮ ঘণ্টা পার হলে ──
  // background-এ যাওয়ার সময় timestamp রাখি; ফিরে এলে elapsed ≥ ৮ ঘণ্টা হলে logout।
  // SecureStore-এও রাখি যাতে অ্যাপ পুরো বন্ধ হলেও cold start-এ (restore) ধরা পড়ে।
  const bgSince = useRef(null);
  const authed = !!client || !!staffUser || !!popUser;   // যেকোনো logged-in
  useEffect(() => {
    if (!authed) return undefined;
    const sub = AppState.addEventListener('change', async (s) => {
      if (s === 'background' || s === 'inactive') {
        bgSince.current = Date.now();
        try { await SecureStore.setItemAsync('bg_since', String(bgSince.current)); } catch {}
      } else if (s === 'active') {
        let since = bgSince.current;
        if (since == null) {
          try { const v = await SecureStore.getItemAsync('bg_since'); since = v ? Number(v) : null; } catch {}
        }
        bgSince.current = null;
        try { await SecureStore.deleteItemAsync('bg_since'); } catch {}
        if (since && Date.now() - since >= AUTO_LOGOUT_MS) logout();
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  // লগইন থাকা অবস্থায় প্রতি ৬০s + অ্যাপ foreground-এ ফিরলে client/bill auto-refresh।
  // ৬০s: 5000 client-এ server load অর্ধেক করে (প্রতি 30s-এ দ্বিগুণ request হতো)।
  // শুধু client account-এর জন্য (staff data refresh Phase 2-এ)।
  useEffect(() => {
    if (!client) return undefined;
    const id = setInterval(() => { refreshClient(); }, 60000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refreshClient();
    });
    return () => { clearInterval(id); sub.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!client]);

  const refreshClient = async () => {
    try {
      const [meR, billR] = await Promise.allSettled([
        api.get('/app/me/'),
        api.get('/app/bills/current/'),
      ]);
      if (meR.status === 'fulfilled')   setClient(meR.value.data);
      if (billR.status === 'fulfilled') setPreloadedBill(billR.value.data);
    } catch {}
  };

  return (
    <AuthContext.Provider value={{
      client, staffUser, permissions, popUser, popMenus, accountType,
      isStaff, isClient, isPop, isSuper, hasModule, hasGranular, hasMenu,
      preloadedBill, loading, login, logout, refreshClient,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
