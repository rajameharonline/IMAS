// Multi-channel Messaging Gateway Setup — Local SMS / WhatsApp / Telegram / Email।
import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../../utils/api';

const PROVIDERS = [
  { value: 'sms_http', label: '📱 Local SMS Provider (HTTP API)' },
  { value: 'whatsapp', label: '🟢 WhatsApp API' },
  { value: 'telegram', label: '✈️ Telegram Bot' },
  { value: 'email',    label: '✉️ Email (SMTP)' },
];

// প্রতিটি provider-এর জন্য কোন কোন field দেখাবে
// {key, label, group: 'top'|'config', type, placeholder, help}
const FIELDS = {
  sms_http: [
    { key: 'api_url',   label: 'API URL', help: 'Provider-এর send endpoint' },
    { key: 'api_key',   label: 'API Key / Token', secret: true },
    { key: 'sender_id', label: 'Sender ID', placeholder: 'যেমন: ISP-BNAS' },
    { key: 'c.http_method', label: 'HTTP Method', type: 'select', options: ['POST', 'GET'] },
    { key: 'c.send_as', label: 'Body Format', type: 'select', options: ['json', 'form', 'query'] },
    { key: 'c.to_param', label: 'Recipient param', placeholder: 'to / recipient / number' },
    { key: 'c.msg_param', label: 'Message param', placeholder: 'message / text / sms' },
    { key: 'c.sender_param', label: 'Sender param', placeholder: 'sender_id / from' },
    { key: 'c.key_param', label: 'API-key param', placeholder: 'api_key (খালি → Authorization header)' },
  ],
  whatsapp: [
    { key: 'api_key', label: 'Access Token', secret: true, help: 'WhatsApp Cloud API permanent token' },
    { key: 'c.phone_number_id', label: 'Phone Number ID', help: 'WhatsApp Business phone number id' },
    { key: 'api_url', label: 'API URL (ঐচ্ছিক)', placeholder: 'খালি → graph.facebook.com Cloud API' },
  ],
  telegram: [
    { key: 'api_key', label: 'Bot Token', secret: true, help: 'BotFather থেকে পাওয়া token' },
    { key: 'c.chat_id', label: 'Default Chat ID', help: 'group/channel/user chat id (যেমন -1001234567)' },
  ],
  email: [
    { key: 'c.smtp_host', label: 'SMTP Host', placeholder: 'smtp.gmail.com' },
    { key: 'c.smtp_port', label: 'SMTP Port', placeholder: '587 (TLS) / 465 (SSL)' },
    { key: 'c.smtp_user', label: 'SMTP Username' },
    { key: 'c.smtp_password', label: 'SMTP Password', secret: true },
    { key: 'c.from_email', label: 'From Email', placeholder: 'noreply@yourisp.com' },
    { key: 'c.use_tls', label: 'Use TLS', type: 'checkbox' },
    { key: 'c.subject', label: 'Default Subject', placeholder: 'Notification' },
  ],
};

const EMPTY = { name: '', provider_type: 'sms_http', api_url: '', api_key: '',
                sender_id: '', config: { http_method: 'POST', send_as: 'json', use_tls: true },
                is_active: true, is_default: false };

const inp = 'w-full h-9 border border-gray-300 rounded-lg px-3 text-sm focus:ring-2 focus:ring-[#173d59] focus:outline-none';
const lbl = 'block text-xs font-semibold text-gray-600 mb-1';

export default function SmsGatewayPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(null);   // null = modal বন্ধ
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get('/sms/gateways/'); setRows(r.data?.results || r.data || []); }
    catch { toast.error('লোড ব্যর্থ।'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // form helper — 'c.x' হলে config-এ, নইলে top-level
  const getVal = (key) => key.startsWith('c.')
    ? (form.config?.[key.slice(2)] ?? '') : (form[key] ?? '');
  const setVal = (key, val) => {
    if (key.startsWith('c.')) setForm(f => ({ ...f, config: { ...f.config, [key.slice(2)]: val } }));
    else setForm(f => ({ ...f, [key]: val }));
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error('Gateway নাম দিন।'); return; }
    setSaving(true);
    try {
      if (form.id) await api.patch(`/sms/gateways/${form.id}/`, form);
      else await api.post('/sms/gateways/', form);
      toast.success('সেভ হয়েছে।'); setForm(null); load();
    } catch (e) { toast.error(e.response?.data?.name?.[0] || 'সেভ ব্যর্থ।'); }
    finally { setSaving(false); }
  };

  const remove = async (g) => {
    if (!window.confirm(`"${g.name}" মুছবেন?`)) return;
    try { await api.delete(`/sms/gateways/${g.id}/`); toast.success('মুছে ফেলা হয়েছে।'); load(); }
    catch { toast.error('মুছতে ব্যর্থ।'); }
  };

  const test = async (g) => {
    const to = window.prompt('Test প্রাপক (phone / chat_id / email):');
    if (!to) return;
    setTesting(g.id);
    try {
      const r = await api.post(`/sms/gateways/${g.id}/test/`, { to, message: 'Test message — ISP BNAS ✅' });
      r.data?.success ? toast.success('✅ পাঠানো হয়েছে!') : toast.error('ব্যর্থ: ' + (r.data?.response || ''));
    } catch (e) { toast.error('ব্যর্থ: ' + (e.response?.data?.response || e.response?.data?.error || 'send error')); }
    finally { setTesting(null); }
  };

  return (
    <div className="p-4 md:p-6 bg-gray-100 min-h-screen">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-800">SMS / Messaging Gateway</h1>
          <p className="text-sm text-gray-500">Local SMS · WhatsApp · Telegram · Email — সব চ্যানেল setup</p>
        </div>
        <button onClick={() => setForm({ ...EMPTY, config: { ...EMPTY.config } })}
          className="px-4 py-2 text-sm font-semibold bg-[#173d59] text-white rounded-full hover:bg-[#1f5075]">
          + নতুন Gateway
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-[#23445f] text-white text-xs uppercase">
            <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:text-left">
              <th>Name</th><th>Channel</th><th>Sender / From</th>
              <th className="!text-center">Default</th><th className="!text-center">Active</th>
              <th className="!text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? <tr><td colSpan={6} className="text-center py-10 text-gray-400">Loading…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={6} className="text-center py-10 text-gray-400">কোনো gateway নেই — "নতুন Gateway" দিয়ে যোগ করুন।</td></tr>
            : rows.map(g => (
              <tr key={g.id} className="hover:bg-blue-50/40">
                <td className="px-4 py-3 font-semibold text-gray-800">{g.name}</td>
                <td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{g.provider_label}</span></td>
                <td className="px-4 py-3 text-gray-600">{g.sender_id || g.config?.from_email || g.config?.phone_number_id || g.config?.chat_id || '—'}</td>
                <td className="px-4 py-3 text-center">{g.is_default ? <span className="text-amber-600 font-bold">★</span> : '—'}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${g.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                    {g.is_active ? 'Active' : 'Off'}
                  </span>
                </td>
                <td className="px-4 py-3 text-center whitespace-nowrap">
                  <button onClick={() => test(g)} disabled={testing === g.id}
                    className="mr-2 rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-100">
                    {testing === g.id ? '...' : 'Test'}
                  </button>
                  <button onClick={() => setForm({ ...g, config: g.config || {} })}
                    className="mr-2 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200">Edit</button>
                  <button onClick={() => remove(g)}
                    className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-100">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* ── Add/Edit Modal ── */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-[#1d435d] px-5 py-3 sticky top-0">
              <span className="font-bold text-white">{form.id ? 'Edit' : 'নতুন'} Gateway</span>
              <button onClick={() => setForm(null)} className="text-xl text-white/70 hover:text-white">×</button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={lbl}>Gateway Name <span className="text-red-500">*</span></label>
                  <input className={inp} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <label className={lbl}>Channel</label>
                  <select className={inp} value={form.provider_type}
                    onChange={e => setForm(f => ({ ...f, provider_type: e.target.value }))}>
                    {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
              </div>

              {/* provider-ভেদে dynamic fields */}
              <div className="grid grid-cols-2 gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="col-span-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  {PROVIDERS.find(p => p.value === form.provider_type)?.label} — Settings
                </p>
                {(FIELDS[form.provider_type] || []).map(fld => (
                  <div key={fld.key} className={fld.type === 'checkbox' ? 'col-span-2 flex items-center gap-2' : ''}>
                    {fld.type === 'checkbox' ? (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" className="w-4 h-4 accent-[#173d59]"
                          checked={!!getVal(fld.key)} onChange={e => setVal(fld.key, e.target.checked)} />
                        <span className="text-sm text-gray-700">{fld.label}</span>
                      </label>
                    ) : fld.type === 'select' ? (
                      <>
                        <label className={lbl}>{fld.label}</label>
                        <select className={inp} value={getVal(fld.key) || fld.options[0]}
                          onChange={e => setVal(fld.key, e.target.value)}>
                          {fld.options.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </>
                    ) : (
                      <>
                        <label className={lbl}>{fld.label}</label>
                        <input className={inp} type={fld.secret ? 'password' : 'text'}
                          placeholder={fld.placeholder || ''} value={getVal(fld.key)}
                          onChange={e => setVal(fld.key, e.target.value)} />
                        {fld.help && <p className="text-[10px] text-gray-400 mt-0.5">{fld.help}</p>}
                      </>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 accent-green-600"
                    checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                  <span className="text-sm text-gray-700">Active</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 accent-amber-600"
                    checked={form.is_default} onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))} />
                  <span className="text-sm text-gray-700">★ Default channel (পাঠানোর জন্য)</span>
                </label>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-gray-200 bg-gray-50 px-5 py-3 sticky bottom-0">
              <button onClick={() => setForm(null)} className="rounded-full border border-gray-300 px-5 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-100">Cancel</button>
              <button onClick={save} disabled={saving}
                className="rounded-full bg-[#173d59] px-5 py-1.5 text-sm font-semibold text-white hover:bg-[#1f5075] disabled:opacity-60">
                {saving ? 'সেভ হচ্ছে…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
