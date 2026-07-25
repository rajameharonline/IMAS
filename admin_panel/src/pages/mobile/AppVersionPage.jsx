import { useState, useEffect } from 'react';
import api from '../../utils/api';

export default function AppVersionPage() {
  const [config, setConfig] = useState(null);
  const [form, setForm]     = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState(null);

  useEffect(() => {
    api.get('/system/mobile-app-config/current/').then(r => {
      setConfig(r.data);
      setForm(r.data);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const r = await api.patch('/system/mobile-app-config/current/', form);
      setConfig(r.data);
      setForm(r.data);
      setMsg({ type: 'success', text: 'সংরক্ষণ সফল হয়েছে।' });
    } catch (e) {
      setMsg({ type: 'error', text: 'সংরক্ষণ ব্যর্থ হয়েছে।' });
    } finally {
      setSaving(false);
    }
  };

  if (!form) return <div className="p-6 text-gray-400">লোড হচ্ছে...</div>;

  const Field = ({ label, name, type = 'text', hint }) => (
    <div>
      <label className="block text-sm font-medium text-gray-600 mb-1">{label}</label>
      {hint && <p className="text-xs text-gray-400 mb-1">{hint}</p>}
      <input
        type={type}
        value={form[name] || ''}
        onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#173d59]"
      />
    </div>
  );

  const Toggle = ({ label, name, hint }) => (
    <label className="flex items-start gap-3 cursor-pointer p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">
      <div className="relative mt-0.5">
        <input
          type="checkbox"
          checked={form[name] || false}
          onChange={e => setForm(f => ({ ...f, [name]: e.target.checked }))}
          className="sr-only"
        />
        <div className={`w-11 h-6 rounded-full transition-colors ${form[name] ? 'bg-[#173d59]' : 'bg-gray-300'}`}>
          <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform mt-0.5 mx-0.5 ${form[name] ? 'translate-x-5' : 'translate-x-0'}`} />
        </div>
      </div>
      <div>
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
    </label>
  );

  return (
    <div className="p-4 md:p-6 bg-gray-100 min-h-screen">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">App Version Control</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Version Settings */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-700 mb-4">Current Version</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Android Version" name="android_version" hint="যেমন: 1.2.0" />
              <Field label="iOS Version" name="ios_version" hint="যেমন: 1.2.0" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Min Android Version" name="min_android_version" hint="এর চেয়ে পুরনো → force update" />
              <Field label="Min iOS Version" name="min_ios_version" hint="এর চেয়ে পুরনো → force update" />
            </div>
          </div>
        </div>

        {/* Store URLs */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-700 mb-4">Store URLs</h2>
          <div className="space-y-4">
            <Field label="Google Play Store URL" name="store_url_android" type="url" />
            <Field label="Apple App Store URL" name="store_url_ios" type="url" />
          </div>
        </div>

        {/* Ticker / Scrolling Notice */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-700">📢 চলন্ত নোটিশ (Ticker)</h2>
            {form.ticker_notice && (
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, ticker_notice: '', ticker_expires_at: null }))}
                className="flex items-center gap-1.5 text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-1.5 hover:bg-rose-100 transition-colors"
              >
                🗑️ নোটিশ মুছুন
              </button>
            )}
          </div>
          <div className="space-y-3">
            {/* Notice Text */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">নোটিশ টেক্সট</label>
              <textarea
                value={form.ticker_notice || ''}
                onChange={e => setForm(f => ({ ...f, ticker_notice: e.target.value }))}
                rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#173d59] resize-none"
                placeholder="যেমন: আগামী ১০ তারিখ সার্ভার মেইনটেন্যান্স থাকবে। ইন্টারনেট সেবা সাময়িক বন্ধ থাকতে পারে।"
              />
              <p className="text-xs text-gray-400 mt-1">খালি রাখলে ticker দেখাবে না।</p>
            </div>

            {/* Expiry DateTime */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">
                ⏰ নোটিশ মেয়াদ শেষ (Expiry)
              </label>
              <div className="flex gap-2 items-center">
                <input
                  type="datetime-local"
                  value={form.ticker_expires_at ? form.ticker_expires_at.substring(0, 16) : ''}
                  onChange={e => setForm(f => ({ ...f, ticker_expires_at: e.target.value || null }))}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#173d59]"
                />
                {form.ticker_expires_at && (
                  <button type="button" onClick={() => setForm(f => ({ ...f, ticker_expires_at: null }))}
                    className="text-xs text-gray-400 hover:text-rose-500 px-2 py-2 border border-gray-200 rounded-lg">
                    ✕ Clear
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                এই সময়ের পর নোটিশ আপনাআপনি বন্ধ হবে। খালি রাখলে সবসময় দেখাবে।
              </p>
            </div>

            {/* Colors */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Text Color</label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={form.ticker_color || '#1e3a8a'}
                    onChange={e => setForm(f => ({ ...f, ticker_color: e.target.value }))}
                    className="w-10 h-9 rounded border border-gray-300 cursor-pointer" />
                  <input type="text" value={form.ticker_color || '#1e3a8a'}
                    onChange={e => setForm(f => ({ ...f, ticker_color: e.target.value }))}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Background Color</label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={form.ticker_bg || '#dbeafe'}
                    onChange={e => setForm(f => ({ ...f, ticker_bg: e.target.value }))}
                    className="w-10 h-9 rounded border border-gray-300 cursor-pointer" />
                  <input type="text" value={form.ticker_bg || '#dbeafe'}
                    onChange={e => setForm(f => ({ ...f, ticker_bg: e.target.value }))}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
            </div>

            {/* Status + Preview */}
            {form.ticker_notice && (
              <div className="space-y-2">
                {/* Expiry status */}
                {form.ticker_expires_at && (
                  <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
                    new Date(form.ticker_expires_at) > new Date()
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-rose-50 text-rose-600'
                  }`}>
                    {new Date(form.ticker_expires_at) > new Date()
                      ? `✅ সক্রিয় — ${new Date(form.ticker_expires_at).toLocaleString('bn-BD')} পর্যন্ত চলবে`
                      : `❌ মেয়াদ শেষ — Client-এ দেখাচ্ছে না`}
                  </div>
                )}
                {/* Preview */}
                <div className="rounded-lg p-3 overflow-hidden flex items-center gap-2" style={{ backgroundColor: form.ticker_bg || '#dbeafe' }}>
                  <span>📢</span>
                  <p className="text-sm font-semibold truncate" style={{ color: form.ticker_color || '#1e3a8a' }}>
                    {form.ticker_notice}
                  </p>
                  <span className="text-xs opacity-50 ml-auto whitespace-nowrap">→ স্ক্রল করবে</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Maintenance Mode */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 lg:col-span-2">
          <h2 className="text-base font-semibold text-gray-700 mb-4">Maintenance Mode</h2>
          <div className="space-y-4">
            <Toggle
              label="Maintenance Mode চালু"
              name="maintenance_mode"
              hint="চালু থাকলে app খুললে maintenance বার্তা দেখাবে, কোনো data নেই।"
            />
            {form.maintenance_mode && (
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Maintenance বার্তা</label>
                <textarea
                  value={form.maintenance_message || ''}
                  onChange={e => setForm(f => ({ ...f, maintenance_message: e.target.value }))}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#173d59] resize-none"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {msg && (
        <div className={`mt-4 rounded-xl px-4 py-3 text-sm ${
          msg.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
        }`}>
          {msg.text}
        </div>
      )}

      <div className="mt-6">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-[#173d59] hover:bg-[#1f5075] text-white px-8 py-2.5 rounded-full font-medium text-sm transition-colors disabled:opacity-50"
        >
          {saving ? 'সংরক্ষণ হচ্ছে...' : 'পরিবর্তন সংরক্ষণ করুন'}
        </button>
      </div>

      {/* Info Card */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-blue-700 mb-2">কীভাবে কাজ করে</h3>
        <ul className="text-xs text-blue-600 space-y-1 list-disc list-inside">
          <li>App open হলে <code>/api/v1/app/config/</code> endpoint check করে।</li>
          <li>App version &lt; Min version → Play Store/App Store-এ redirect।</li>
          <li>Maintenance mode চালু → বার্তা দেখিয়ে app block।</li>
        </ul>
      </div>
    </div>
  );
}
