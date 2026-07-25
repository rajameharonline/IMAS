import { useEffect, useRef, useState, useCallback } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { useCompany } from '../../context/CompanyContext';

/* ── shared helpers ──────────────────────────────────────────────────── */
const inp =
  'w-full border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm text-gray-800 bg-white ' +
  'placeholder:text-gray-300 transition-all ' +
  'hover:border-gray-300 ' +
  'focus:outline-none focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500';
const sel = inp + ' cursor-pointer';

function Fl({ label, hint, required, children }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{label}</label>
        {required && <span className="text-rose-400 text-xs">*</span>}
      </div>
      {children}
      {hint && <p className="text-[11px] text-gray-400 leading-relaxed">{hint}</p>}
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer select-none flex-shrink-0">
      <input type="checkbox" checked={!!checked} onChange={onChange} className="sr-only peer" />
      <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:bg-teal-500 transition-colors duration-200" />
      <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow-md peer-checked:translate-x-5 transition-transform duration-200" />
    </label>
  );
}

function SaveBtn({ saving, label = 'Save Changes', onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className="inline-flex items-center gap-2 bg-teal-600 hover:bg-teal-700 active:scale-[0.98]
        disabled:opacity-60 disabled:hover:bg-teal-600 disabled:active:scale-100
        text-white text-sm font-semibold px-6 py-2.5 rounded-xl
        transition-all shadow-sm shadow-teal-500/20 hover:shadow-md hover:shadow-teal-500/25"
    >
      {saving ? (
        <>
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Saving…
        </>
      ) : (
        <>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          {label}
        </>
      )}
    </button>
  );
}

/* Modern light card with teal accent chip */
function Card({ icon, title, subtitle, children, className = '', accent = 'teal' }) {
  const accentMap = {
    teal:   'bg-teal-50 text-teal-600',
    slate:  'bg-slate-100 text-slate-600',
    amber:  'bg-amber-50 text-amber-600',
    blue:   'bg-blue-50 text-blue-600',
    indigo: 'bg-indigo-50 text-indigo-600',
    red:    'bg-red-50 text-red-600',
  };
  const accentCls = accentMap[accent] || accentMap.teal;
  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow ${className}`}>
      <div className="px-5 pt-5 pb-4 border-b border-gray-50 flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${accentCls}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-gray-900 leading-tight">{title}</h3>
          {subtitle && <p className="text-[11.5px] text-gray-400 mt-0.5 leading-relaxed">{subtitle}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20 gap-3 text-gray-400">
      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span className="text-sm">Loading…</span>
    </div>
  );
}

/* ── SVG icon set ────────────────────────────────────────────────────── */
const Ic = {
  building: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  ),
  phone: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  ),
  license: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  id: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
    </svg>
  ),
  invoice: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
    </svg>
  ),
  palette: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
    </svg>
  ),
  text: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
    </svg>
  ),
  clock: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  settings: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  warn: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  check: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  mobile: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a1 1 0 001-1V4a1 1 0 00-1-1H8a1 1 0 00-1 1v16a1 1 0 001 1z" />
    </svg>
  ),
};

/* ══════════════════════════════════════════════════════════════════════
   COMPANY TAB
══════════════════════════════════════════════════════════════════════ */
function CompanyTab() {
  const { refreshCompany } = useCompany();
  const [form, setForm]           = useState(null);
  const [logoPreview, setLogoPreview] = useState('');
  const [logoFile, setLogoFile]   = useState(null);
  const [saving, setSaving]       = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(() => {
    api.get('/system/company/current/')
      .then(r => { setForm(r.data); setLogoPreview(r.data.logo_url || ''); })
      .catch(() => toast.error('Company info লোড হয়নি'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  // APK download URLs — media/app/-এ থাকে, nginx serve করে
  const appDownloadUrl     = `${window.location.origin}/media/app/rajamehar-online.apk`;
  const liveTVDownloadUrl  = `${window.location.origin}/media/app/rajamehar-livetv.apk`;

  const copyLink = async (url, label) => {
    const success = () => toast.success(`${label} লিংক কপি হয়েছে!`);
    const fail    = () => toast.error('কপি করা যায়নি — লিংকটি ম্যানুয়ালি কপি করুন');
    try {
      await navigator.clipboard.writeText(url);
      success();
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        success();
      } catch { fail(); }
    }
  };
  const copyAppLink    = () => copyLink(appDownloadUrl,    'মোবাইল অ্যাপ');
  const copyLiveTVLink = () => copyLink(liveTVDownloadUrl, 'লাইভ টিভি অ্যাপ');

  const handleSave = async () => {
    setSaving(true);
    try {
      const fd = new FormData();
      const skip = new Set(['logo', 'logo_url', 'id', 'updated_at']);
      Object.entries(form).forEach(([k, v]) => {
        if (!skip.has(k) && v != null) fd.append(k, v);
      });
      if (logoFile) fd.append('logo', logoFile);
      const r = await api.patch('/system/company/current/', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setForm(r.data);
      setLogoPreview(r.data.logo_url || '');
      setLogoFile(null);
      refreshCompany();
      toast.success('Company info সংরক্ষিত হয়েছে!');
    } catch {
      toast.error('সংরক্ষণ ব্যর্থ হয়েছে');
    } finally {
      setSaving(false);
    }
  };

  if (!form) return <Spinner />;

  // Customer ID — শুধু numeric (যেমন 00001 / 00100)
  // value = padded(start_number, digits), edit করলে digits + start auto-parse হয়
  const digs            = Math.max(1, Math.min(20, form.customer_id_digits || 5));
  const startNum        = Math.max(1, form.customer_id_start_number || 1);
  const customerIdValue = String(startNum).padStart(digs, '0');

  const handleCustomerIdChange = e => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 20);
    if (!raw) {
      setForm(f => ({ ...f, customer_id_digits: 5, customer_id_start_number: 1 }));
      return;
    }
    setForm(f => ({
      ...f,
      customer_id_digits:       raw.length,
      customer_id_start_number: parseInt(raw, 10) || 1,
      customer_id_prefix:       '',
    }));
  };

  const handleEditableToggle = async e => {
    const val = e.target.checked;
    setForm(f => ({ ...f, customer_id_editable: val }));
    try {
      await api.patch('/system/company/current/', { customer_id_editable: val },
        { headers: { 'Content-Type': 'application/json' } });
      toast.success(val
        ? 'Customer ID Edit চালু হয়েছে'
        : 'Customer ID Edit বন্ধ হয়েছে');
    } catch { toast.error('সংরক্ষণ ব্যর্থ হয়েছে'); }
  };

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto">

      {/* ── Row 1: Identity + Contact ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">

        {/* Identity */}
        <Card icon={Ic.building} title="Company Identity" subtitle="Brand name, logo and website" accent="teal">
          <div className="flex gap-4 items-start">
            {/* Logo upload */}
            <div className="flex flex-col items-center gap-2 flex-shrink-0">
              <div
                onClick={() => fileRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}
                className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 flex flex-col items-center justify-center cursor-pointer hover:border-teal-400 hover:bg-teal-50 transition overflow-hidden group focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {logoPreview
                  ? <img src={logoPreview} alt="logo" className="w-full h-full object-contain p-1" />
                  : (
                    <div className="flex flex-col items-center gap-1 text-gray-400 group-hover:text-teal-500 transition">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M14 8h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span className="text-[10px] font-medium">Logo</span>
                    </div>
                  )}
              </div>
              <p className="text-[10px] text-gray-400 text-center leading-tight">PNG / JPG / SVG</p>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={e => {
                  const f = e.target.files[0];
                  if (f) { setLogoFile(f); setLogoPreview(URL.createObjectURL(f)); }
                }} />
              {logoFile && (
                <button
                  onClick={() => { setLogoFile(null); setLogoPreview(form.logo_url || ''); fileRef.current.value = ''; }}
                  className="text-[10px] text-red-400 hover:text-red-600"
                >
                  Cancel
                </button>
              )}
            </div>
            {/* Name + website + Customer ID */}
            <div className="flex-1 space-y-3">
              <Fl label="Company Name" required>
                <input className={inp} value={form.name ?? ''} onChange={set('name')} placeholder="Rajamehar Online" />
              </Fl>
              <Fl label="Website">
                <input className={inp} value={form.website ?? ''} onChange={set('website')} placeholder="https://example.com" />
              </Fl>
              <Fl label="Customer ID" hint="যে নম্বর থেকে নতুন Client-এর ID শুরু হবে (যেমন 00001)">
                <div className="flex items-center gap-3">
                  <input
                    className={inp + ' font-mono font-bold tracking-widest'}
                    value={customerIdValue}
                    onChange={handleCustomerIdChange}
                    placeholder="00001"
                    maxLength={20}
                    inputMode="numeric"
                  />
                  <div
                    className="flex-shrink-0"
                    title={form.customer_id_editable
                      ? 'Edit Client form-এ Customer ID পরিবর্তন করা যাবে'
                      : 'Edit Client form-এ Customer ID lock — পরিবর্তন করা যাবে না'}
                  >
                    <Toggle checked={!!form.customer_id_editable} onChange={handleEditableToggle} />
                  </div>
                </div>
              </Fl>
            </div>
          </div>
        </Card>

        {/* Contact */}
        <Card icon={Ic.phone} title="Contact Details" subtitle="Phone, email and office address" accent="blue">
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Fl label="Phone">
                <input className={inp} value={form.phone ?? ''} onChange={set('phone')} placeholder="+8801XXXXXXXXX" />
              </Fl>
              <Fl label="Email">
                <input type="email" className={inp} value={form.email ?? ''} onChange={set('email')} placeholder="info@company.com" />
              </Fl>
            </div>
            <Fl label="Office Address">
              <textarea className={inp + ' resize-none'} rows={3}
                value={form.address ?? ''} onChange={set('address')}
                placeholder="Full company address…" />
            </Fl>
          </div>
        </Card>
      </div>

      {/* ── Row 2: License (full width) ── */}
      <Card icon={Ic.license} title="License Information" subtitle="Trade license and BTRC registration numbers" accent="amber">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Fl label="Trade License No.">
            <input className={inp} value={form.trade_license ?? ''} onChange={set('trade_license')} placeholder="TL-XXXXXXXX" />
          </Fl>
          <Fl label="BTRC License No.">
            <input className={inp} value={form.btrc_license ?? ''} onChange={set('btrc_license')} placeholder="BTRC-XXXXXXXX" />
          </Fl>
        </div>
      </Card>

      {/* ── Row 3: Mobile App download link (full width) ── */}
      <Card icon={Ic.mobile} title="মোবাইল অ্যাপ" subtitle="গ্রাহক অ্যাপ ডাউনলোড লিংক — কপি করে ইউজারকে পাঠান" accent="teal">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <input
            className={inp + ' font-mono text-xs flex-1'}
            value={appDownloadUrl}
            readOnly
            onFocus={e => e.target.select()}
          />
          <div className="flex gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={copyAppLink}
              className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold transition whitespace-nowrap"
            >
              📋 লিংক কপি করুন
            </button>
            <a
              href={appDownloadUrl}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 rounded-lg border border-teal-600 text-teal-700 hover:bg-teal-50 text-sm font-semibold transition whitespace-nowrap"
            >
              ⬇️ ডাউনলোড
            </a>
          </div>
        </div>
        <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
          এই লিংকটি ইউজারকে পাঠান — ইউজার লিংকে ক্লিক করলেই APK ফাইলটি ডাউনলোড হবে।
          নতুন বিল্ড আপলোড করলে একই লিংকে স্বয়ংক্রিয়ভাবে নতুন সংস্করণ পাওয়া যাবে।
        </p>
      </Card>

      {/* ── Live TV App download link ── */}
      <Card icon="📺" title="লাইভ টিভি অ্যাপ" subtitle="Live TV চ্যানেল দেখার আলাদা অ্যাপ — ডাউনলোড লিংক কপি করে ইউজারকে পাঠান" accent="red">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <input
            className={inp + ' font-mono text-xs flex-1'}
            value={liveTVDownloadUrl}
            readOnly
            onFocus={e => e.target.select()}
          />
          <div className="flex gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={copyLiveTVLink}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition whitespace-nowrap"
            >
              📋 লিংক কপি করুন
            </button>
            <a
              href={liveTVDownloadUrl}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 rounded-lg border border-red-600 text-red-700 hover:bg-red-50 text-sm font-semibold transition whitespace-nowrap"
            >
              ⬇️ ডাউনলোড
            </a>
          </div>
        </div>
        <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
          এই অ্যাপটি শুধুমাত্র Live TV চ্যানেল দেখার জন্য — মূল গ্রাহক অ্যাপ থেকে সম্পূর্ণ আলাদা।
          নতুন বিল্ড আপলোড করলে একই লিংকে স্বয়ংক্রিয়ভাবে নতুন সংস্করণ পাওয়া যাবে।
        </p>
      </Card>

      <div className="flex justify-end pt-1">
        <SaveBtn saving={saving} label="Save Company Info" onClick={handleSave} />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   INVOICE TAB
══════════════════════════════════════════════════════════════════════ */
function InvoiceTab() {
  const [form, setForm]     = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.get('/system/invoice-setup/current/')
      .then(r => setForm(r.data))
      .catch(() => toast.error('Invoice setup লোড হয়নি'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = k => e => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm(f => ({ ...f, [k]: val }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch('/system/invoice-setup/current/', form);
      toast.success('Invoice setup সংরক্ষিত হয়েছে!');
    } catch {
      toast.error('সংরক্ষণ ব্যর্থ হয়েছে');
    } finally {
      setSaving(false);
    }
  };

  if (!form) return <Spinner />;

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto">

      {/* ── Row 1: Numbering + Header Design ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">

        {/* Numbering */}
        <Card icon={Ic.invoice} title="Invoice Numbering" subtitle="Prefix and starting serial number" accent="teal">
          <div className="space-y-3">
            <Fl label="Invoice Prefix" hint="যেমন: INV, BILL, RC">
              <input className={inp} value={form.prefix ?? ''} onChange={set('prefix')} placeholder="INV" />
            </Fl>
            <Fl label="Start Number" hint="এই নম্বর থেকে invoice serial শুরু হবে">
              <input type="number" className={inp} value={form.start_number ?? ''} onChange={set('start_number')} />
            </Fl>
          </div>
        </Card>

        {/* Header Design */}
        <Card icon={Ic.palette} title="Invoice Header Design" subtitle="Header color and logo settings" accent="indigo">
          <div className="space-y-3">
            <Fl label="Header Color">
              <div className="flex items-center gap-2">
                <label className="w-10 h-10 rounded-lg border-2 border-gray-200 overflow-hidden cursor-pointer flex-shrink-0 shadow-sm">
                  <input type="color" value={form.header_color || '#DC5014'} onChange={set('header_color')}
                    className="w-12 h-12 -m-1 cursor-pointer border-0 p-0" />
                </label>
                <input className={inp + ' font-mono'} value={form.header_color ?? ''} onChange={set('header_color')} placeholder="#DC5014" />
              </div>
            </Fl>
            {/* Live preview */}
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-1.5">Preview</p>
              <div className="bg-white rounded border border-gray-100 px-3 py-2">
                <p className="text-base font-bold leading-tight" style={{ color: form.header_color || '#DC5014' }}>
                  Your Company Name
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">invoice@company.com · +880 1700 000000</p>
              </div>
            </div>
            {/* Logo toggle */}
            <div className="bg-gray-50 rounded-lg border border-gray-100 px-3 py-2.5 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-gray-700">Invoice-এ Company Logo দেখাবে</p>
                <p className="text-[10px] text-gray-400">Company logo আপলোড করুন</p>
              </div>
              <Toggle checked={!!form.show_logo} onChange={set('show_logo')} />
            </div>
          </div>
        </Card>
      </div>

      {/* ── Row 2: Invoice Text (full width, 2-col inside) ── */}
      <Card icon={Ic.text} title="Invoice Text" subtitle="Note and footer printed on every invoice" accent="blue">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Fl label="Invoice Note" hint="Payment summary-র নিচে দেখাবে">
            <textarea className={inp + ' resize-y'} rows={4}
              value={form.note_text ?? ''} onChange={set('note_text')}
              placeholder="This is a computerized Invoice and doesn't need any signature." />
          </Fl>
          <Fl label="Footer Text" hint="Invoice-এর একদম নিচে center-এ print হবে">
            <textarea className={inp + ' resize-y'} rows={4}
              value={form.footer_text ?? ''} onChange={set('footer_text')}
              placeholder="Thank you for your payment!" />
          </Fl>
        </div>
      </Card>

      <div className="flex justify-end pt-1">
        <SaveBtn saving={saving} label="Save Invoice Setup" onClick={handleSave} />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   AUTOMATION TAB
══════════════════════════════════════════════════════════════════════ */
const PROCESS_META = {
  expire_disable: {
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
    ),
    title: 'Client Auto Disconnect',
    desc: 'প্রতিমাসে ক্লায়েন্টের expiry day-এ এই নির্ধারিত সময়ে RADIUS ও Mikrotik থেকে auto-disconnect হবে।',
    iconBg: 'bg-red-100 text-red-600',
    timeLabel: 'Disconnect Time',
  },
  auto_bill: {
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
      </svg>
    ),
    title: 'Auto Bill Generation',
    desc: 'প্রতিদিন নির্ধারিত সময়ে expiry day অনুযায়ী মাসিক বিল auto-generate হবে।',
    iconBg: 'bg-blue-100 text-blue-600',
    timeLabel: 'Run Time',
  },
  sms_due: {
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
    title: 'Payment Reminder (Due SMS)',
    desc: 'বকেয়া ক্লায়েন্টদের রিমাইন্ডার (SMS/Push/Email) পাঠায়। Reminder Rule অনুযায়ী নির্দিষ্ট সময়ে চলে।',
    iconBg: 'bg-amber-100 text-amber-600',
    timeLabel: 'Run Time',
  },
  router_backup: {
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
      </svg>
    ),
    title: 'Router Auto Backup',
    desc: 'নির্ধারিত সময়ে Mikrotik router-এর configuration backup নেবে।',
    iconBg: 'bg-purple-100 text-purple-600',
    timeLabel: 'Backup Time',
  },
  daily_close: {
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    title: 'Daily Account Closing',
    desc: 'প্রতিদিন শেষে দৈনিক হিসাব-নিকাশ স্বয়ংক্রিয়ভাবে সম্পন্ন করবে।',
    iconBg: 'bg-green-100 text-green-600',
    timeLabel: 'Close Time',
  },
  radacct_aggregate: {
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    title: 'RADIUS Traffic Aggregate',
    desc: 'প্রতিদিন নির্ধারিত সময়ে RADIUS session ডেটা থেকে ক্লায়েন্টের মাসিক ট্রাফিক হিসাব করে রাখে (purge-এর আগে)।',
    iconBg: 'bg-indigo-100 text-indigo-600',
    timeLabel: 'Run Time',
  },
  radacct_purge: {
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    ),
    title: 'RADIUS Session Purge',
    desc: 'প্রতিদিন নির্ধারিত সময়ে ৩০ দিনের পুরনো বন্ধ RADIUS session মুছে storage বাঁচায়।',
    iconBg: 'bg-rose-100 text-rose-600',
    timeLabel: 'Run Time',
  },
  olt_mac_sync: {
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    ),
    title: 'OLT MAC Table Sync',
    desc: 'সব active OLT থেকে SNMP দিয়ে ONU ডেটা ও সিগন্যাল নিয়মিত sync করে (Monitoring পেজের লাইভ ডেটা)।',
    iconBg: 'bg-cyan-100 text-cyan-600',
    timeLabel: 'Sync Interval / Time',
  },
  olt_link_onu: {
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
    ),
    title: 'OLT ONU↔Client Link',
    desc: 'MAC-ভিত্তিক ONU ↔ ক্লায়েন্ট auto-link করে (Monitoring-এর Client/Zone কলাম populate করে)।',
    iconBg: 'bg-teal-100 text-teal-600',
    timeLabel: 'Link Interval / Time',
  },
  voip_schedule: {
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M12 6a7 7 0 010 12M8.464 8.464a5 5 0 000 7.072M3 9v6m18-6v6" />
      </svg>
    ),
    title: 'Voice Call Auto Scheduler',
    desc: 'নির্ধারিত সময়ে সব active voice call schedule চেক করে ক্লায়েন্টদের এক্সপায়ারি অনুযায়ী স্বয়ংক্রিয় কল করে।',
    iconBg: 'bg-orange-100 text-orange-600',
    timeLabel: 'Run Time',
  },
  mikrotik_sync: {
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    ),
    title: 'MikroTik Active User Sync',
    desc: 'RADIUS ও MikroTik-এর active session ডেটা নিয়মিত sync করে Online Client Monitoring-এর live ডেটা আপডেট রাখে।',
    iconBg: 'bg-sky-100 text-sky-600',
    timeLabel: 'Sync Interval / Time',
  },
};

/* 5-field cron string parse করে freq_type, hour, minute, dayOfWeek, dayOfMonth, intervalMinutes বের করে */
function parseCron(cronStr) {
  const parts = (cronStr || '0 0 * * *').split(' ');
  while (parts.length < 5) parts.push('*');
  const [rawMin, rawHour, rawDom, , rawDow] = parts;

  // Interval pattern: */N * * * *  বা  */N */M * * * style
  if (rawMin && rawMin.startsWith('*/')) {
    return {
      freqType: 'interval',
      intervalMinutes: parseInt(rawMin.slice(2), 10) || 5,
      minute: 0, hour: 0, dayOfWeek: '1', dayOfMonth: '1',
    };
  }

  const minute = parseInt(rawMin, 10) || 0;
  const hour   = parseInt(rawHour, 10) || 0;
  let freqType   = 'daily';
  let dayOfWeek  = '1';
  let dayOfMonth = '1';

  if (rawDow && rawDow !== '*') {
    freqType  = 'weekly';
    dayOfWeek = rawDow;
  } else if (rawDom && rawDom !== '*') {
    freqType   = 'monthly';
    dayOfMonth = rawDom;
  }
  return { freqType, minute, hour, dayOfWeek, dayOfMonth, intervalMinutes: 5 };
}

const DOW_LABELS = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];

function ProcessCard({ proc, onSave }) {
  const meta = PROCESS_META[proc.process_type] || {
    icon: Ic.settings, title: proc.process_type, desc: '', iconBg: 'bg-gray-100 text-gray-500', timeLabel: 'Run Time',
  };

  const init = parseCron(proc.schedule_cron);
  const [hour,            setHour]           = useState(init.hour);
  const [minute,          setMinute]         = useState(init.minute);
  const [freqType,        setFreqType]       = useState(init.freqType);
  const [dayOfWeek,       setDayOfWeek]      = useState(init.dayOfWeek);
  const [dayOfMonth,      setDayOfMonth]     = useState(init.dayOfMonth);
  const [intervalMinutes, setIntervalMinutes]= useState(init.intervalMinutes || 5);
  const [enabled,         setEnabled]        = useState(proc.is_enabled);
  const [saving,          setSaving]         = useState(false);

  const handleToggle = (val) => setEnabled(val);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch(`/system/automation/${proc.id}/set-schedule/`, {
        hour, minute, is_enabled: enabled,
        freq_type:        freqType,
        interval_minutes: intervalMinutes,
        day_of_week:      freqType === 'weekly'   ? dayOfWeek  : '*',
        day_of_month:     freqType === 'monthly'  ? dayOfMonth : '*',
      });
      onSave();
      toast.success(`"${meta.title}" সেটিং সংরক্ষিত হয়েছে!`);
    } catch {
      toast.error('সংরক্ষণ ব্যর্থ হয়েছে');
    } finally {
      setSaving(false);
    }
  };

  const pad = n => String(n).padStart(2, '0');

  const cronPreview = freqType === 'interval'
    ? `*/${intervalMinutes} * * * *`
    : freqType === 'weekly'
    ? `${minute} ${hour} * * ${dayOfWeek}`
    : freqType === 'monthly'
    ? `${minute} ${hour} ${dayOfMonth} * *`
    : `${minute} ${hour} * * *`;

  return (
    <div className={`rounded-xl border-2 overflow-hidden transition-all ${enabled ? 'border-teal-200 shadow-sm' : 'border-gray-100'}`}>

      {/* Card header */}
      <div className={`px-4 py-3 flex items-center justify-between ${enabled ? 'bg-gradient-to-r from-[#1c2333] to-[#1d3a50]' : 'bg-gray-50 border-b border-gray-100'}`}>
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
            ${enabled ? 'bg-white/15 text-white' : meta.iconBg}`}>
            {meta.icon}
          </div>
          <div>
            <p className={`text-sm font-bold leading-tight ${enabled ? 'text-white' : 'text-gray-700'}`}>
              {meta.title}
            </p>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full inline-block mt-0.5
              ${enabled ? 'bg-teal-400/20 text-teal-200' : 'bg-gray-200 text-gray-500'}`}>
              {enabled ? '● Active' : '○ Inactive'}
            </span>
          </div>
        </div>
        <Toggle checked={enabled} onChange={e => handleToggle(e.target.checked)} />
      </div>

      {/* Card body */}
      <div className="bg-white px-4 py-3 space-y-3">
        <p className="text-xs text-gray-500 leading-relaxed">{meta.desc}</p>

        {/* ── Frequency type selector ── */}
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Frequency Type</p>
          <div className="grid grid-cols-4 gap-1">
            {[
              ['daily',    'প্রতিদিন',   '📅'],
              ['weekly',   'সাপ্তাহিক',  '🗓️'],
              ['monthly',  'মাসিক',      '📆'],
              ['interval', 'ইন্টারভাল',  '⏱️'],
            ].map(([v, label, emoji]) => (
              <button
                key={v}
                onClick={() => setFreqType(v)}
                className={`text-[11px] font-semibold py-2 rounded-lg border transition-all flex flex-col items-center gap-0.5
                  ${freqType === v
                    ? 'bg-[#1c2333] text-white border-[#1c2333] shadow-sm'
                    : 'bg-gray-50 text-gray-500 border-gray-200 hover:border-gray-300 hover:bg-gray-100'}`}
              >
                <span className="text-base leading-none">{emoji}</span>
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Interval input ── */}
        {freqType === 'interval' && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-3">
            <p className="text-[10px] font-semibold text-indigo-600 uppercase tracking-wide mb-2">প্রতি কত মিনিট পর চলবে?</p>
            <div className="flex items-center gap-3">
              <input
                type="number" min="1" max="1440"
                value={intervalMinutes}
                onChange={e => setIntervalMinutes(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-24 text-center text-2xl font-bold font-mono text-indigo-700 border-2 border-indigo-200 rounded-xl py-2 focus:outline-none focus:border-indigo-500 bg-white"
              />
              <div>
                <p className="text-sm font-bold text-indigo-800">মিনিট</p>
                <p className="text-[10px] text-indigo-500 mt-0.5">
                  {intervalMinutes < 60
                    ? `প্রতি ${intervalMinutes} মিনিটে`
                    : `প্রতি ${Math.floor(intervalMinutes / 60)} ঘণ্টা ${intervalMinutes % 60 > 0 ? `${intervalMinutes % 60} মিনিটে` : ''}`}
                </p>
              </div>
              <div className="ml-auto">
                <p className="text-[10px] text-indigo-400 mb-1">Quick</p>
                <div className="flex gap-1">
                  {[5, 10, 15, 30, 60].map(m => (
                    <button key={m} onClick={() => setIntervalMinutes(m)}
                      className={`text-[10px] px-1.5 py-0.5 rounded font-semibold border transition-all
                        ${intervalMinutes === m ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-indigo-500 border-indigo-200 hover:bg-indigo-100'}`}>
                      {m}m
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Day of Week (weekly only) ── */}
        {freqType === 'weekly' && (
          <div>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">দিন নির্বাচন</p>
            <div className="flex gap-1">
              {DOW_LABELS.map((label, i) => (
                <button
                  key={i}
                  onClick={() => setDayOfWeek(String(i))}
                  className={`flex-1 text-[10px] font-semibold py-1.5 rounded-lg border transition-all
                    ${dayOfWeek === String(i)
                      ? 'bg-teal-600 text-white border-teal-600'
                      : 'bg-gray-50 text-gray-500 border-gray-200 hover:border-teal-300 hover:bg-teal-50'}`}
                >
                  {label.slice(0, 2)}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-1">✔ {DOW_LABELS[Number(dayOfWeek)] || '—'}</p>
          </div>
        )}

        {/* ── Day of Month (monthly only) ── */}
        {freqType === 'monthly' && (
          <div>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">মাসের তারিখ</p>
            <select className={sel + ' font-bold text-[#1d3a50]'} value={dayOfMonth} onChange={e => setDayOfMonth(e.target.value)}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                <option key={d} value={d}>প্রতি মাসের {d} তারিখ</option>
              ))}
            </select>
          </div>
        )}

        {/* ── Time picker (daily / weekly / monthly) ── */}
        {freqType !== 'interval' && (
          <div>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{meta.timeLabel || 'Run Time'}</p>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <p className="text-[10px] text-gray-400 mb-1 text-center">Hour (ঘণ্টা)</p>
                <select className={sel + ' text-center font-mono font-bold text-[#1d3a50]'}
                  value={hour} onChange={e => setHour(Number(e.target.value))}>
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{pad(i)}</option>
                  ))}
                </select>
              </div>
              <span className="text-xl font-bold text-gray-300 mt-4">:</span>
              <div className="flex-1">
                <p className="text-[10px] text-gray-400 mb-1 text-center">Minute (মিনিট)</p>
                <select className={sel + ' text-center font-mono font-bold text-[#1d3a50]'}
                  value={minute} onChange={e => setMinute(Number(e.target.value))}>
                  {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => (
                    <option key={m} value={m}>{pad(m)}</option>
                  ))}
                </select>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-gray-400 mb-1">Preview</p>
                <div className="bg-[#1c2333] text-white font-mono font-bold text-base px-3 py-2 rounded-lg tracking-widest shadow-sm">
                  {pad(hour)}:{pad(minute)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer: cron + Save */}
        <div className="flex items-center justify-between pt-1">
          <code className="text-[10px] bg-gray-100 text-gray-500 px-2 py-1 rounded font-mono">
            {cronPreview}
          </code>
          <SaveBtn saving={saving} label="Save" onClick={handleSave} />
        </div>
      </div>
    </div>
  );
}

/* ── Voice Call Schedule — এক্সপায়ারি-ভিত্তিক স্বয়ংক্রিয় ভয়েস কল ─────────────
   রেকর্ডিং লাইব্রেরি (VoIP → Voice SMS) থেকে সংরক্ষিত রেকর্ডিং বেছে শিডিউল তৈরি। */
function VoiceScheduleManager() {
  const [schedules, setSchedules]   = useState([]);
  const [recordings, setRecordings] = useState([]);
  const [form, setForm] = useState({ name: '', recording: '', days: '', timing: 'before', run_time: '10:00', status_filter: '' });
  const [busy, setBusy] = useState(false);

  const loadSched = useCallback(() => {
    api.get('/voip/voice-schedules/').then(r => setSchedules(Array.isArray(r.data) ? r.data : (r.data.results || []))).catch(() => setSchedules([]));
  }, []);
  const loadRecs = useCallback(() => {
    api.get('/voip/voice-recordings/').then(r => setRecordings(Array.isArray(r.data) ? r.data : (r.data.results || []))).catch(() => setRecordings([]));
  }, []);
  useEffect(() => { loadSched(); loadRecs(); }, [loadSched, loadRecs]);

  const create = async () => {
    if (!form.name.trim()) return toast.error('শিডিউল নাম দিন');
    if (!form.recording)    return toast.error('একটি রেকর্ডিং নির্বাচন করুন');
    setBusy(true);
    try {
      await api.post('/voip/voice-schedules/', {
        name: form.name.trim(), recording: form.recording, days: form.days || 0,
        timing: form.timing, run_time: form.run_time || '10:00', status_filter: form.status_filter,
      });
      toast.success('অটো শিডিউল তৈরি হয়েছে');
      setForm({ name: '', recording: '', days: '', timing: 'before', run_time: '10:00', status_filter: '' });
      loadSched();
    } catch (e) { toast.error(e.response?.data?.detail || 'তৈরি করা যায়নি'); }
    finally { setBusy(false); }
  };
  const toggleActive = async (s) => { try { await api.patch(`/voip/voice-schedules/${s.id}/`, { is_active: !s.is_active }); loadSched(); } catch { toast.error('পরিবর্তন ব্যর্থ'); } };
  const remove = async (id) => { if (!window.confirm('শিডিউল মুছবেন?')) return; try { await api.delete(`/voip/voice-schedules/${id}/`); loadSched(); } catch { toast.error('মোছা যায়নি'); } };
  const runNow = async (s) => {
    if (!window.confirm(`"${s.name}" এখনই চালাবেন?`)) return;
    try { const r = await api.post(`/voip/voice-schedules/${s.id}/run_now/`); toast.success(r.data.queued != null ? `${r.data.queued} জনকে কল পাঠানো হচ্ছে (target ${r.data.target_expiry})` : (r.data.detail || 'চালানো হয়েছে')); }
    catch (e) { toast.error(e.response?.data?.detail || 'চালানো যায়নি'); }
  };

  return (
    <div className="rounded-xl border-2 border-gray-100 overflow-hidden">
      <div className="px-4 py-3 bg-gradient-to-r from-[#1c2333] to-[#1d3a50] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-white/15 text-white flex items-center justify-center">🔊</div>
          <div>
            <p className="text-sm font-bold text-white leading-tight">অটোমেটিক ভয়েস কল শিডিউল</p>
            <p className="text-[10px] text-teal-200 mt-0.5">এক্সপায়ারি অনুযায়ী · প্রতিদিন নিজ সময়ে স্বয়ংক্রিয় কল</p>
          </div>
        </div>
        <span className="text-[11px] text-teal-200">{schedules.length} টি শিডিউল</span>
      </div>

      <div className="bg-white p-4 space-y-3">
        {recordings.length === 0 ? (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            ⚠️ কোনো সংরক্ষিত রেকর্ডিং নেই। আগে <strong>VoIP → Voice SMS Service</strong> পেজে রেকর্ডিং সংরক্ষণ করুন।
          </p>
        ) : (
          <div className="bg-gray-50 rounded-lg p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="শিডিউল নাম"
              className="lg:col-span-2 text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <select value={form.recording} onChange={e => setForm({ ...form, recording: e.target.value })}
              className="lg:col-span-2 text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500">
              <option value="">🎙️ রেকর্ডিং বাছুন</option>
              {recordings.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
            <div className="flex items-center gap-1">
              <input type="number" min="0" value={form.days} onChange={e => setForm({ ...form, days: e.target.value })} placeholder="দিন"
                className="w-14 text-sm border border-gray-300 rounded-lg px-2 py-1.5" />
              <select value={form.timing} onChange={e => setForm({ ...form, timing: e.target.value })} className="flex-1 text-sm border border-gray-300 rounded-lg px-1 py-1.5">
                <option value="before">আগে</option><option value="after">পরে</option>
              </select>
            </div>
            <input type="time" value={form.run_time} onChange={e => setForm({ ...form, run_time: e.target.value })} title="কোন সময়ে চলবে"
              className="text-sm border border-gray-300 rounded-lg px-2 py-1.5" />
            <select value={form.status_filter} onChange={e => setForm({ ...form, status_filter: e.target.value })} className="text-sm border border-gray-300 rounded-lg px-2 py-1.5">
              <option value="">সব স্ট্যাটাস</option><option value="active">Active</option><option value="expired">Expired</option><option value="inactive">Inactive</option>
            </select>
            <button onClick={create} disabled={busy} className="lg:col-span-6 sm:col-span-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white font-semibold px-3 py-1.5">+ শিডিউল যোগ করুন</button>
          </div>
        )}

        {schedules.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-3">কোনো শিডিউল নেই</p>
        ) : (
          <div className="space-y-1.5">
            {schedules.map(s => (
              <div key={s.id} className="flex flex-wrap items-center gap-2 border border-gray-100 rounded-lg px-3 py-2">
                <button onClick={() => toggleActive(s)} title={s.is_active ? 'চালু' : 'বন্ধ'}
                  className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ${s.is_active ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${s.is_active ? 'left-4' : 'left-0.5'}`} />
                </button>
                <span className="font-semibold text-gray-800 text-sm">{s.name}</span>
                <span className="text-xs text-gray-500">🎙️ {s.recording_title || '—'} · এক্সপায়ারির {s.days} দিন {s.timing === 'before' ? 'আগে' : 'পরে'} · 🕐 {s.run_time?.slice(0, 5)}{s.status_filter ? ` · ${s.status_filter}` : ''}</span>
                {s.audio_url && <audio src={s.audio_url} controls className="h-7 max-w-[150px]" />}
                <span className="text-[11px] text-gray-400">শেষ: {s.last_run_date || '—'}</span>
                <div className="flex-1" />
                <button onClick={() => runNow(s)} className="text-xs px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold">▶ এখনই</button>
                <button onClick={() => remove(s.id)} className="text-xs px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600">মুছুন</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AutomationTab() {
  const [processes, setProcesses] = useState(null);

  const load = useCallback(() => {
    api.get('/system/automation/all/')
      .then(r => setProcesses(r.data))
      .catch(() => toast.error('Automation settings লোড হয়নি'));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!processes) return <Spinner />;

  const order = [
    'expire_disable', 'auto_bill', 'router_backup', 'daily_close',
    'radacct_aggregate', 'radacct_purge',
    'voip_schedule', 'sms_due',
    'olt_mac_sync', 'olt_link_onu', 'mikrotik_sync',
  ];
  const sorted = [...processes].sort((a, b) => order.indexOf(a.process_type) - order.indexOf(b.process_type));

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
        <span className="text-amber-500 flex-shrink-0 mt-0.5">{Ic.warn}</span>
        <div>
          <p className="text-sm font-semibold text-amber-800">Automation সম্পর্কে গুরুত্বপূর্ণ তথ্য</p>
          <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
            Celery Worker এবং Celery Beat চালু থাকলে এই সেটিংস কার্যকর হবে।
            Client Auto Disconnect — প্রতিমাসে client-এর <strong>expiry day</strong>-তে এই সময়ে disconnect হবে।
          </p>
        </div>
      </div>

      {/* 2-column grid of process cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {sorted.map(proc => (
          <ProcessCard key={proc.id} proc={proc} onSave={load} />
        ))}
      </div>

      {/* Voice Call Schedule — এক্সপায়ারি-ভিত্তিক স্বয়ংক্রিয় ভয়েস কল */}
      <VoiceScheduleManager />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   TAB CONFIG
══════════════════════════════════════════════════════════════════════ */
const TABS = [
  {
    id: 'company',
    label: 'Company Info',
    desc: 'Brand, logo, contact & Customer ID',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
  },
  {
    id: 'invoice',
    label: 'Invoice Setup',
    desc: 'Numbering, design & footer text',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
      </svg>
    ),
  },
  {
    id: 'automation',
    label: 'Automation',
    desc: 'Scheduled tasks & Celery jobs',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

/* ══════════════════════════════════════════════════════════════════════
   MAIN PAGE — full-bleed, left sidebar + content
══════════════════════════════════════════════════════════════════════ */
export default function SettingsPage() {
  // URL hash query (যেমন #/settings?tab=automation) থেকে initial tab — deep-link সাপোর্ট।
  const [tab, setTab] = useState(() => {
    const q = (window.location.hash.split('?')[1]) || '';
    const t = new URLSearchParams(q).get('tab');
    return TABS.some(x => x.id === t) ? t : 'company';
  });
  const active = TABS.find(t => t.id === tab);

  return (
    /* -m-4 cancels the p-4 from Layout's <main>, giving full-bleed */
    <div className="-m-4 flex flex-col lg:flex-row bg-slate-50" style={{ minHeight: 'calc(100vh - 56px)' }}>

      {/* ── Mobile: horizontal tab pills (small screens only) ── */}
      <div className="lg:hidden px-3 py-2 flex gap-2 overflow-x-auto shrink-0"
           style={{ background: 'linear-gradient(135deg, #1c2333 0%, #161b29 100%)' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0
              ${tab === t.id
                ? 'bg-teal-500 text-white shadow-md shadow-teal-500/30'
                : 'bg-white/10 text-white/70 hover:bg-white/15'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Left sidebar — Desktop only ──────────────────────────────── */}
      <div className="hidden lg:flex w-56 flex-shrink-0 flex-col"
           style={{ background: 'linear-gradient(180deg, #1c2333 0%, #161b29 100%)' }}>

        {/* Sidebar header */}
        <div className="px-5 pt-6 pb-5 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-500/15 ring-1 ring-teal-400/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <p className="text-[14px] font-bold text-white leading-tight tracking-tight">System Settings</p>
              <p className="text-[10.5px] text-white/40 mt-0.5">Configuration</p>
            </div>
          </div>
        </div>

        {/* Tab navigation */}
        <nav className="flex-1 px-3 pt-4 pb-4 space-y-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full flex items-start gap-3 px-3 py-3 rounded-xl text-left transition-all group relative
                ${tab === t.id
                  ? 'bg-white/[0.07] ring-1 ring-teal-400/20'
                  : 'hover:bg-white/[0.04]'}`}
            >
              {tab === t.id && (
                <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full bg-teal-400" />
              )}
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-all
                ${tab === t.id
                  ? 'bg-teal-500/20 text-teal-300'
                  : 'bg-white/[0.06] text-white/45 group-hover:bg-white/10 group-hover:text-white/75'}`}>
                {t.icon}
              </div>
              <div className="min-w-0 pt-0.5">
                <p className={`text-[13px] font-semibold leading-tight
                  ${tab === t.id ? 'text-white' : 'text-white/65 group-hover:text-white/90'}`}>
                  {t.label}
                </p>
                <p className={`text-[10px] leading-tight mt-0.5 truncate
                  ${tab === t.id ? 'text-teal-300/70' : 'text-white/30'}`}>
                  {t.desc}
                </p>
              </div>
            </button>
          ))}
        </nav>
      </div>

      {/* ── Right content area ────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Content top bar */}
        <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center flex-shrink-0">
              {active?.icon}
            </div>
            <div>
              <h1 className="text-[16px] font-semibold text-gray-900 leading-tight tracking-tight">{active?.label}</h1>
              <p className="text-[11.5px] text-gray-400 mt-0.5">{active?.desc}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-[11px] text-emerald-700 font-medium ring-1 ring-emerald-100">
            <span className="text-emerald-500">{Ic.check}</span>
            Changes are saved instantly
          </div>
        </div>

        {/* Scrollable tab content */}
        <div className="flex-1 overflow-auto p-6 bg-slate-50">
          {tab === 'company'    && <CompanyTab />}
          {tab === 'invoice'    && <InvoiceTab />}
          {tab === 'automation' && <AutomationTab />}
        </div>
      </div>
    </div>
  );
}
