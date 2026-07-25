import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';
const CompanyContext = createContext(null);

export function CompanyProvider({ children }) {
  const [company, setCompany] = useState({ name: 'ISP Admin', logo_url: '' });

  const refresh = useCallback(() => {
    // /public/ endpoint — auth token ছাড়াই কাজ করে, login page-এও safe
    axios.get(`${API_BASE}/system/company/public/`)
      .then(r => {
        if (r.data) setCompany({ name: r.data.name || 'ISP Admin', logo_url: r.data.logo_url || '' });
      })
      .catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <CompanyContext.Provider value={{ company, refreshCompany: refresh }}>
      {children}
    </CompanyContext.Provider>
  );
}

export const useCompany = () => useContext(CompanyContext);
