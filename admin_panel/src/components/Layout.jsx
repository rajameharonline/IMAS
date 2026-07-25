import { Outlet, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCompany } from '../context/CompanyContext';
import { usePermission } from '../context/PermissionContext';
import { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from './Sidebar';
import api from '../utils/api';

function TopBar({ onToggleSidebar }) {
  const { user, logout } = useAuth();
  const { company } = useCompany();
  const { isSuper, hasModule } = usePermission();
  const navigate = useNavigate();
  // Online Monitoring — admin panel role অনুযায়ী (client module access থাকলে)
  const canSeeMonitoring = isSuper || hasModule('client');
  const [search, setSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const dropdownRef = useRef(null);
  const searchRef = useRef(null);
  const searchTimerRef = useRef(null);

  // Module 6 — Support notifications state (bell badge feed)।
  // unreadCount = bell badge সংখ্যা; notifBox = dropdown শো-করছে কি না।
  // notifs    = সাম্প্রতিক ২০টি unread/all। প্রতি ৩০s-এ background fetch।
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifs, setNotifs]           = useState([]);
  const [notifOpen, setNotifOpen]     = useState(false);
  const notifRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Notifications fetcher — mount-এ + প্রতি ৩০s background poll।
  // কেন polling: Web socket নেই, ৩০s gap লো-cost এবং practically real-time।
  const fetchNotifs = useCallback(async () => {
    try {
      const [cntR, listR] = await Promise.all([
        api.get('/support/notifications/unread-count/'),
        api.get('/support/notifications/', { params: { page_size: 20, ordering: '-created_at' } }),
      ]);
      setUnreadCount(cntR.data?.unread_count || 0);
      setNotifs(Array.isArray(listR.data) ? listR.data : (listR.data?.results || []));
    } catch { /* silent — auth expire / network blip */ }
  }, []);

  useEffect(() => {
    fetchNotifs();
    const id = setInterval(fetchNotifs, 30000);
    return () => clearInterval(id);
  }, [fetchNotifs]);

  const handleNotifClick = async (n) => {
    // Mark single as read এবং relevant link-এ navigate।
    try {
      await api.post(`/support/notifications/${n.id}/mark-read/`);
      fetchNotifs();
    } catch { /* silent */ }
    setNotifOpen(false);
    if (n.link_url) navigate(n.link_url);
  };

  const handleMarkAllRead = async () => {
    try {
      await api.post('/support/notifications/mark-all-read/');
      fetchNotifs();
    } catch { /* silent */ }
  };

  const doSearch = useCallback(async (q) => {
    if (!q.trim()) { setSearchResults([]); setSearchOpen(false); return; }
    setSearchLoading(true);
    try {
      const r = await api.get('/clients/', { params: { search: q.trim(), page_size: 8 } });
      const list = Array.isArray(r.data) ? r.data : (r.data.results || []);
      setSearchResults(list);
      setSearchOpen(true);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearch(val);
    clearTimeout(searchTimerRef.current);
    if (!val.trim()) { setSearchResults([]); setSearchOpen(false); return; }
    searchTimerRef.current = setTimeout(() => doSearch(val), 300);
  };

  const handleSelectClient = (client) => {
    setSearch('');
    setSearchOpen(false);
    setSearchResults([]);
    navigate(`/search?client=${client.id}`);
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Escape') { setSearchOpen(false); setSearch(''); }
    if (e.key === 'Enter' && search.trim()) {
      setSearchOpen(false);
      navigate(`/search?q=${encodeURIComponent(search.trim())}`);
      setSearch('');
    }
  };

  return (
    <header className="bg-[#1c2333] h-[56px] flex items-center px-3 gap-3 shrink-0 z-[1300] relative">

      {/* ── Hamburger button — শুধু mobile-এ দেখাবে ── */}
      <button
        onClick={onToggleSidebar}
        className="lg:hidden flex flex-col items-center justify-center gap-1 w-8 h-8 shrink-0 rounded hover:bg-[#2a3347] transition-colors"
        aria-label="Toggle sidebar"
      >
        <span className="block w-5 h-0.5 bg-gray-300" />
        <span className="block w-5 h-0.5 bg-gray-300" />
        <span className="block w-5 h-0.5 bg-gray-300" />
      </button>

      {/* ── Left: Company / user ──────────────────────────────── */}
      <div className="hidden lg:flex items-center gap-2 w-[185px] shrink-0 border-r border-[#2a3347] pr-3 h-full">
        <div className="w-9 h-9 rounded-full bg-teal-600 flex items-center justify-center text-white text-sm font-bold shrink-0 overflow-hidden">
          {company.logo_url
            ? <img src={company.logo_url} alt="logo" className="w-full h-full object-contain bg-white p-0.5" />
            : <span>{company.name[0]?.toUpperCase() || 'I'}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-white text-xs font-semibold leading-tight truncate">{company.name}</p>
          <div className="flex items-center gap-1 mt-0.5">
            <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
            <span className="text-green-400 text-[11px] leading-none">online</span>
          </div>
        </div>
      </div>

      {/* ── Search with live dropdown ─────────────────────────── */}
      <div className="relative min-w-0 flex-1 lg:flex-none" ref={searchRef}>
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          value={search}
          onChange={handleSearchChange}
          onKeyDown={handleSearchKeyDown}
          onFocus={() => search.trim() && searchResults.length > 0 && setSearchOpen(true)}
          placeholder="Search Customer"
          autoComplete="off"
          className="bg-[#2a3347] text-white text-sm placeholder-gray-400 rounded pl-8 pr-7 py-2 w-full lg:w-64 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {searchLoading ? (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}

        {/* Search results dropdown */}
        {searchOpen && (
          <div className="absolute left-0 top-[40px] w-[min(20rem,calc(100vw-2rem))] sm:w-80 bg-white rounded-lg shadow-2xl border border-gray-200 z-50 overflow-hidden">
            {searchResults.length === 0 ? (
              <div className="px-4 py-3 text-sm text-gray-400 text-center">কোনো ক্লায়েন্ট পাওয়া যায়নি</div>
            ) : (
              searchResults.map(c => (
                <button
                  key={c.id}
                  onClick={() => handleSelectClient(c)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50 transition-colors text-left border-b border-gray-50 last:border-0"
                >
                  <div className="w-8 h-8 rounded-full bg-[#1c2333] flex items-center justify-center text-white text-xs font-bold shrink-0">
                    {(c.full_name || '?')[0].toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-800 truncate">
                      {c.customer_id} ({c.id})
                    </p>
                    <p className="text-xs text-gray-500 truncate">{c.full_name} · {c.phone}</p>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 capitalize ${
                    c.status === 'active'   ? 'bg-green-100 text-green-700' :
                    c.status === 'inactive' ? 'bg-gray-100 text-gray-500' :
                    'bg-red-100 text-red-600'
                  }`}>{c.status}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* ── Middle spacer (শুধু lg+; মোবাইলে search জায়গা পূরণ করে) ── */}
      <div className="hidden lg:block lg:flex-1" />

      {/* ── Right icons ──────────────────────────────────────── */}
      <div className="flex items-center gap-2 shrink-0">
        {/* কল ডায়ালার সরানো হয়েছে — কল এখন admin/superadmin/employee মোবাইল অ্যাপে আসে। */}

        {/* Open Support Ticket — reference: rajameharonline.ispdigital.cloud topbar quick-link */}
        {(isSuper || hasModule('support_ticketing')) && (
          <button onClick={() => navigate('/support/tickets')} className="hidden sm:flex items-center gap-1 text-gray-300 hover:text-white text-xs whitespace-nowrap transition-colors" title="Open Support Ticket">
            <i className="fas fa-ticket-alt text-sm shrink-0" />
            <span className="hidden lg:inline">Open Support Ticket</span>
          </button>
        )}

        {/* Online Client Monitoring — role অনুযায়ী (client access) + মোবাইল WebView-এ hide (.topbar-monitoring) */}
        {canSeeMonitoring && (
          <button onClick={() => navigate('/radius/online')} className="topbar-monitoring flex items-center gap-1 text-gray-300 hover:text-white text-xs whitespace-nowrap transition-colors" title="Online Client Monitoring">
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2" />
            </svg>
            <span className="hidden lg:inline">Online Client Monitoring</span>
          </button>
        )}

        {/* Bell — Module 6 notifications */}
        <div className="relative" ref={notifRef}>
          <button onClick={() => setNotifOpen(v => !v)} className="relative p-1">
            <svg className="w-[18px] h-[18px] text-gray-300 hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <span className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] rounded-full text-white text-[9px] flex items-center justify-center font-bold leading-none px-0.5 ${unreadCount > 0 ? 'bg-red-500 animate-pulse' : 'bg-teal-500'}`}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          </button>

          {/* Dropdown panel */}
          {notifOpen && (
            <div className="absolute right-0 top-9 w-80 bg-white rounded-lg shadow-2xl border border-gray-200 z-50 overflow-hidden">
              <div className="px-4 py-2.5 bg-[#1c2333] text-white flex items-center justify-between">
                <span className="text-sm font-semibold">Notifications</span>
                {unreadCount > 0 && (
                  <button onClick={handleMarkAllRead}
                    className="text-[11px] text-teal-300 hover:text-white">
                    Mark all read
                  </button>
                )}
              </div>
              <div className="max-h-96 overflow-y-auto">
                {notifs.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-gray-400 text-center">No notifications.</div>
                ) : (
                  notifs.map(n => (
                    <button key={n.id}
                      onClick={() => handleNotifClick(n)}
                      className={`w-full text-left px-4 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-0 transition-colors ${n.is_read ? 'opacity-60' : ''}`}>
                      <div className="flex items-start gap-2">
                        {!n.is_read && <span className="w-2 h-2 rounded-full bg-teal-500 mt-1.5 shrink-0" />}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-gray-800 truncate">{n.title}</p>
                          <p className="text-[11px] text-gray-500 truncate">{n.message}</p>
                          <p className="text-[10px] text-gray-400 mt-0.5">{new Date(n.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
              <button onClick={() => { setNotifOpen(false); navigate('/support/tickets'); }}
                className="w-full px-4 py-2.5 text-xs font-semibold text-teal-700 hover:bg-teal-50 border-t border-gray-100">
                View all tickets →
              </button>
            </div>
          )}
        </div>

        {/* Info */}
        <button className="relative p-1">
          <svg className="w-[18px] h-[18px] text-gray-300 hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] bg-teal-500 rounded-full text-white text-[9px] flex items-center justify-center font-bold leading-none px-0.5">0</span>
        </button>

        {/* User avatar dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(v => !v)}
            className="w-8 h-8 rounded-full bg-[#2a3347] hover:bg-[#374151] flex items-center justify-center text-white text-sm font-bold transition-colors">
            {(user?.full_name || user?.username || 'A')[0].toUpperCase()}
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 top-9 w-44 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100">
                <svg className="w-4 h-4 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                </svg>
                <span className="text-sm font-semibold text-gray-800">{user?.username || 'admin'}</span>
              </div>
              <button
                onClick={() => { setDropdownOpen(false); navigate('/account'); }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                My Profile
              </button>
              <button
                onClick={() => { setDropdownOpen(false); logout(); }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default function Layout() {
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  if (!user) return <Navigate to="/login" replace />;

  return (
    // SoftphoneProvider সরানো হয়েছে — কল এখন শুধু admin/superadmin/employee
    // মোবাইল অ্যাপে আসে; web panel SIP register করে না (double-register conflict এড়াতে)।
    <div className="flex flex-col h-screen overflow-hidden">
      <TopBar onToggleSidebar={() => setSidebarOpen(v => !v)} />
      <div className="flex flex-1 min-h-0">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex-1 min-w-0 overflow-auto bg-gray-100 p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
