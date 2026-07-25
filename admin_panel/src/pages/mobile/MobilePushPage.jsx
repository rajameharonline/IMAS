import { useState, useEffect } from 'react';
import api from '../../utils/api';

export default function MobilePushPage() {
  const [form, setForm]       = useState({ title: '', body: '', target_type: 'all', target_id: '' });
  const [zones, setZones]     = useState([]);
  const [clients, setClients] = useState([]);
  const [logs, setLogs]       = useState([]);
  const [sending, setSending] = useState(false);
  const [msg, setMsg]         = useState(null);

  useEffect(() => {
    api.get('/config/zones/').then(r => setZones(r.data.results || r.data));
    loadLogs();
  }, []);

  const loadLogs = () => {
    api.get('/app/admin/push/history/').then(r => setLogs(r.data)).catch(() => {});
  };

  const handleTargetChange = (type) => {
    setForm(f => ({ ...f, target_type: type, target_id: '' }));
    if (type === 'client') {
      api.get('/clients/?page_size=200').then(r => setClients(r.data.results || r.data));
    }
  };

  const handleSend = async () => {
    if (!form.title.trim() || !form.body.trim()) {
      setMsg({ type: 'error', text: 'Title ও Body অবশ্যই দিতে হবে।' });
      return;
    }
    setSending(true);
    setMsg(null);
    try {
      const payload = {
        title:       form.title,
        body:        form.body,
        target_type: form.target_type,
      };
      if (form.target_type !== 'all' && form.target_id) {
        payload.target_id = parseInt(form.target_id);
      }
      const r = await api.post('/app/admin/push/send/', payload);
      setMsg({ type: 'success', text: r.data.detail });
      setForm({ title: '', body: '', target_type: 'all', target_id: '' });
      loadLogs();
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.detail || 'পাঠানো ব্যর্থ হয়েছে।' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-4 md:p-6 bg-gray-100 min-h-screen">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Push Notification পাঠানো</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Send Form */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">নতুন Notification</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Title</label>
              <input
                type="text"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#173d59]"
                placeholder="Notification শিরোনাম"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Body / বার্তা</label>
              <textarea
                value={form.body}
                onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                rows={4}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#173d59] resize-none"
                placeholder="Notification-এর বিস্তারিত বার্তা"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">পাঠাবেন কাকে?</label>
              <div className="flex gap-2 flex-wrap">
                {[
                  { value: 'all', label: 'সকলকে' },
                  { value: 'zone', label: 'নির্দিষ্ট Zone' },
                  { value: 'client', label: 'নির্দিষ্ট Client' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => handleTargetChange(opt.value)}
                    className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
                      form.target_type === opt.value
                        ? 'bg-[#173d59] text-white border-[#173d59]'
                        : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {form.target_type === 'zone' && (
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Zone নির্বাচন করুন</label>
                <select
                  value={form.target_id}
                  onChange={e => setForm(f => ({ ...f, target_id: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#173d59]"
                >
                  <option value="">-- Zone নির্বাচন --</option>
                  {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
              </div>
            )}

            {form.target_type === 'client' && (
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Client নির্বাচন করুন</label>
                <select
                  value={form.target_id}
                  onChange={e => setForm(f => ({ ...f, target_id: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#173d59]"
                >
                  <option value="">-- Client নির্বাচন --</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.customer_id} — {c.full_name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {msg && (
              <div className={`rounded-lg px-4 py-3 text-sm ${
                msg.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
              }`}>
                {msg.text}
              </div>
            )}

            <button
              onClick={handleSend}
              disabled={sending}
              className="w-full bg-[#173d59] hover:bg-[#1f5075] text-white py-2.5 rounded-full font-medium text-sm transition-colors disabled:opacity-50"
            >
              {sending ? 'পাঠানো হচ্ছে...' : 'Notification পাঠান'}
            </button>
          </div>
        </div>

        {/* History */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">পাঠানো Notification ইতিহাস</h2>
          {logs.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">এখনো কোনো notification পাঠানো হয়নি।</p>
          ) : (
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {logs.map(l => (
                <div key={l.id} className="border border-gray-100 rounded-xl p-4">
                  <div className="flex justify-between items-start gap-2 mb-1">
                    <p className="font-semibold text-gray-800 text-sm">{l.title}</p>
                    <span className="text-xs text-gray-400 whitespace-nowrap">
                      {new Date(l.sent_at).toLocaleString('bn-BD')}
                    </span>
                  </div>
                  <p className="text-gray-600 text-xs mb-2">{l.body}</p>
                  <div className="flex gap-3 text-xs text-gray-500">
                    <span>🎯 {l.target_name}</span>
                    <span className="text-emerald-600">✓ {l.sent_count}</span>
                    {l.fail_count > 0 && <span className="text-rose-500">✗ {l.fail_count}</span>}
                    <span>👤 {l.sent_by}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
