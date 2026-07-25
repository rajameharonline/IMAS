import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';

export default function Login() {
  const [form, setForm]       = useState({ username: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw]   = useState(false);
  const [company, setCompany] = useState({ name: 'ISP Admin', logo_url: '' });

  const { login }  = useAuth();
  const navigate   = useNavigate();

  useEffect(() => {
    axios.get(`${API_BASE}/system/company/public/`)
      .then(r => setCompany(r.data))
      .catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(form.username, form.password);
      toast.success('Login successful!');
      navigate('/');
    } catch {
      toast.error('Incorrect username or password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    /* ── Page background ─────────────────────────────────── */
    <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center p-4 relative overflow-hidden">

      {/* Ambient glow blobs */}
      <div className="absolute top-[-10%] left-[-5%]  w-[400px] h-[400px] bg-blue-700/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] bg-indigo-600/15 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-[40%] left-[45%] w-[250px] h-[250px] bg-blue-500/10 rounded-full blur-[80px] pointer-events-none" />

      {/* Subtle dot grid */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.07]"
        style={{
          backgroundImage: 'radial-gradient(circle, #94a3b8 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      {/* ── Card ─────────────────────────────────────────── */}
      <div className="relative z-10 w-full max-w-[900px] flex rounded-3xl overflow-hidden shadow-[0_32px_80px_rgba(0,0,0,0.6)]">

        {/* ── Left: Branding ─────────────────────────────── */}
        <div className="hidden lg:flex w-[42%] flex-col bg-gradient-to-br from-[#1a2744] to-[#0f172a] p-10 relative overflow-hidden">

          {/* Decorative ring top-right */}
          <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full border border-white/5" />
          <div className="absolute -top-8 -right-8  w-32 h-32 rounded-full border border-white/5" />
          <div className="absolute -bottom-20 -left-20 w-64 h-64 rounded-full border border-white/5" />

          {/* Logo */}
          <div className="flex-1 flex flex-col justify-center items-center text-center">
            <div className="mb-6 relative">
              {company.logo_url ? (
                <div className="w-24 h-24 rounded-3xl bg-white shadow-2xl flex items-center justify-center overflow-hidden p-2">
                  <img src={company.logo_url} alt="logo" className="w-full h-full object-contain" />
                </div>
              ) : (
                <div className="w-24 h-24 rounded-3xl bg-blue-600 flex items-center justify-center shadow-2xl">
                  <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z"/>
                  </svg>
                </div>
              )}
              {/* Online dot */}
              <span className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-400 rounded-full border-2 border-[#1a2744]" />
            </div>

            <h1 className="text-white text-2xl font-bold tracking-tight mb-1">{company.name}</h1>
            <p className="text-slate-400 text-sm mb-10">ISP Billing & Network Automation</p>

            {/* Feature list */}
            <div className="space-y-3 w-full text-left">
              {[
                { icon: '⚡', label: 'Real-time network monitoring' },
                { icon: '💰', label: 'Automated billing & invoicing' },
                { icon: '📡', label: 'Mikrotik & RADIUS control' },
              ].map(({ icon, label }) => (
                <div key={label} className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3">
                  <span className="text-base">{icon}</span>
                  <span className="text-slate-300 text-sm">{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom tag */}
          <p className="text-slate-600 text-xs text-center mt-6">
            &copy; {new Date().getFullYear()} {company.name}
          </p>
        </div>

        {/* ── Right: Login Form ───────────────────────────── */}
        <div className="flex-1 bg-white flex flex-col justify-center px-10 py-12">

          {/* Mobile logo */}
          <div className="lg:hidden flex flex-col items-center mb-8">
            {company.logo_url ? (
              <img src={company.logo_url} alt="logo"
                className="w-16 h-16 rounded-2xl object-contain bg-gray-50 border border-gray-100 p-1 mb-3 shadow" />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center mb-3 shadow">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z"/>
                </svg>
              </div>
            )}
            <p className="font-bold text-gray-900 text-lg">{company.name}</p>
          </div>

          {/* Heading */}
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-1">Welcome back 👋</h2>
            <p className="text-gray-400 text-sm">Sign in to your admin dashboard</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Username */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Username
              </label>
              <div className="relative">
                <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                  fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                </svg>
                <input
                  type="text"
                  value={form.username}
                  onChange={e => setForm({ ...form, username: e.target.value })}
                  placeholder="Your username"
                  required autoFocus
                  className="w-full pl-11 pr-4 py-3.5 rounded-xl border border-gray-200 bg-gray-50
                    text-sm text-gray-800 placeholder-gray-400
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-white
                    transition-all duration-200"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Password
              </label>
              <div className="relative">
                <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                  fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                </svg>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  placeholder="Your password"
                  required
                  className="w-full pl-11 pr-12 py-3.5 rounded-xl border border-gray-200 bg-gray-50
                    text-sm text-gray-800 placeholder-gray-400
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-white
                    transition-all duration-200"
                />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                  {showPw ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3.5 rounded-xl font-semibold text-sm text-white
                bg-gradient-to-r from-blue-600 to-blue-700
                hover:from-blue-700 hover:to-blue-800
                disabled:opacity-60 transition-all duration-200
                shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40
                flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Signing in...
                </>
              ) : (
                <>
                  Sign In
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6"/>
                  </svg>
                </>
              )}
            </button>
          </form>

          <p className="text-center text-xs text-gray-300 mt-10">
            Secure admin access · {company.name}
          </p>
        </div>
      </div>
    </div>
  );
}
