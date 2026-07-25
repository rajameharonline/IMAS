// PermissionContext — login user-এর role-based permission manage করে
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import api from '../utils/api';

const PermissionContext = createContext(null);

// localStorage key
const PERM_KEY = 'isp_user_permissions';

function loadCached() {
  try { return JSON.parse(localStorage.getItem(PERM_KEY) || 'null'); }
  catch { return null; }
}

export function PermissionProvider({ children }) {
  const { user } = useAuth();

  const [perms, setPerms] = useState(() => loadCached() || {
    is_super: false,
    role_name: '',
    modules: [],      // [{ module_key, sub_module_key, access_level }]
    granular: [],     // [{ context_key, permission_key }]
    loaded: false,
  });

  const fetchPermissions = useCallback(async () => {
    if (!user) {
      const empty = { is_super: false, role_name: '', modules: [], granular: [], loaded: true };
      setPerms(empty);
      localStorage.removeItem(PERM_KEY);
      return;
    }

    // superadmin/admin → সব access, API call দরকার নেই
    if (['superadmin', 'admin'].includes(user.role)) {
      const superPerms = { is_super: true, role_name: user.role, modules: [], granular: [], loaded: true };
      setPerms(superPerms);
      localStorage.setItem(PERM_KEY, JSON.stringify(superPerms));
      return;
    }

    try {
      const res = await api.get('/role-permissions/my-perms/');
      const data = { ...res.data, loaded: true };
      setPerms(data);
      localStorage.setItem(PERM_KEY, JSON.stringify(data));
    } catch {
      // API fail → cached থাকলে রাখো, নতুবা empty
      const cached = loadCached();
      if (cached) setPerms({ ...cached, loaded: true });
      else setPerms({ is_super: false, role_name: '', modules: [], granular: [], loaded: true });
    }
  }, [user]);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  // ── Helper: module access ──────────────────────────────────────────────
  // parent module enabled কিনা (sub_module_key = '' হলে parent)
  const hasModule = useCallback((moduleKey) => {
    if (perms.is_super) return true;
    if (!perms.loaded) return false;
    return perms.modules.some(
      m => m.module_key === moduleKey && m.sub_module_key === '' && m.is_enabled !== false
    );
  }, [perms]);

  // sub-module enabled কিনা
  const hasSubModule = useCallback((moduleKey, subModuleKey) => {
    if (perms.is_super) return true;
    if (!perms.loaded) return false;
    // parent off হলে sub-module-ও off
    if (!hasModule(moduleKey)) return false;
    return perms.modules.some(
      m => m.module_key === moduleKey && m.sub_module_key === subModuleKey && m.is_enabled !== false
    );
  }, [perms, hasModule]);

  // granular permission
  const hasGranular = useCallback((contextKey, permKey) => {
    if (perms.is_super) return true;
    if (!perms.loaded) return true; // default allow
    return perms.granular.some(
      g => g.context_key === contextKey && g.permission_key === permKey
    );
  }, [perms]);

  // access level (full/write/read)
  const getAccessLevel = useCallback((moduleKey, subModuleKey = '') => {
    if (perms.is_super) return 'full';
    const m = perms.modules.find(
      m => m.module_key === moduleKey && m.sub_module_key === subModuleKey
    );
    return m?.access_level || 'none';
  }, [perms]);

  const value = {
    perms,
    loaded: perms.loaded,
    isSuper: perms.is_super,
    hasModule,
    hasSubModule,
    hasGranular,
    getAccessLevel,
    refetch: fetchPermissions,
  };

  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
}

export const usePermission = () => useContext(PermissionContext);
