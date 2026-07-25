import { useState, useEffect, useCallback } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

/* পেমেন্ট রিমাইন্ডার — নিয়ম (rule) তৈরি/সম্পাদনা, manual Send Now, preview ও পাঠানোর লগ। */

const TRIGGERS = [
  { value: 'before_expiry', label: 'মেয়াদ শেষের আগে' },
  { value: 'on_due',        label: 'বকেয়া থাকলে' },
  { value: 'after_expiry',  label: 'মেয়াদ শেষের পরে' },
];

const EMPTY = {
  name: '', is_active: true, trigger: 'before_expiry', offset_days: 3,
  via_sms: true, via_push: false, via_email: false,
  only_active: true, min_due: 0, zone: '', package: '',
  message_template: 'প্রিয় {name}, আপনার বকেয়া বিল {due}৳ (মেয়াদ {expiry_date})। অনুগ্রহ করে দ্রুত পরিশোধ করুন।',
  email_subject: 'পেমেন্ট রিমাইন্ডার', send_hour: 10,
};

const inp = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400';
const lbl = 'block text-xs font-semibold text-gray-600 mb-1';

function ChannelBadges({ r }) {
  const items = [
    r.via_sms && ['SMS', 'bg-blue-100 text-blue-700'],
    r.via_push && ['Push', 'bg-purple-100 text-purple-700'],
    r.via_email && ['Email', 'bg-amber-100 text-amber-700'],
  ].filter(Boolean);
  return (
    <div className="flex gap-1 flex-wrap">
      {items.map(([t, c]) => <span key={t} className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${c}`}>{t}</span>)}
    </div>
  );
}

export default function PaymentReminderPage() {
  const [rules, setRules]   = useState([]);
  const [logs, setLogs]     = useState([]);
  const [zones, setZones]   = useState([]);
  const [packages, setPackages] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [modal, setModal]   = useState(null);   // null | {form}
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);   // send-now/preview চলছে
  const [preview, setPreview] = useState(null);  // {rule, eligible_count, sample}

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rR, lR, zR, pR] = await Promise.all([
        api.get('/billing/reminder-rules/'),
        api.get('/billing/reminder-logs/', { params: { page_size: 50 } }),
        api.get('/config/zones/'),
        api.get('/config/packages/'),
      ]);
      const list = d => d?.results || d || [];
      setRules(list(rR.data));
      setLogs(list(lR.data));
      setZones(list(zR.data));
      setPackages(list(pR.data));
    } catch { toast.error('তথ্য লোড করতে সমস্যা হয়েছে।'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew  = () => setModal({ ...EMPTY });
  const openEdit = (r) => setModal({ ...r, zone: r.zone || '', package: r.package || '' });

  const save = async () => {
    const f = modal;
    if (!f.name.trim()) { toast.error('নিয়মের নাম দিন।'); return; }
    if (!f.via_sms && !f.via_push && !f.via_email) { toast.error('অন্তত একটি channel নির্বাচন করুন।'); return; }
    setSaving(true);
    const payload = { ...f, zone: f.zone || null, package: f.package || null };
    try {
      if (f.id) await api.put(`/billing/reminder-rules/${f.id}/`, payload);
      else      await api.post('/billing/reminder-rules/', payload);
      toast.success('সংরক্ষিত হয়েছে।');
      setModal(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.response?.data?.non_field_errors?.[0] || 'সংরক্ষণ ব্যর্থ।');
    } finally { setSaving(false); }
  };

  const remove = async (r) => {
    if (!window.confirm(`"${r.name}" নিয়মটি মুছে ফেলবেন?`)) return;
    try { await api.delete(`/billing/reminder-rules/${r.id}/`); toast.success('মুছে ফেলা হয়েছে।'); load(); }
    catch { toast.error('মুছতে সমস্যা হয়েছে।'); }
  };

  const toggleActive = async (r) => {
    try { await api.patch(`/billing/reminder-rules/${r.id}/`, { is_active: !r.is_active }); load(); }
    catch { toast.error('পরিবর্তন ব্যর্থ।'); }
  };

  const doPreview = async (r) => {
    setBusyId('prev-' + r.id);
    try {
      const { data } = await api.get(`/billing/reminder-rules/${r.id}/preview/`);
      setPreview({ rule: r, ...data });
    } catch { toast.error('Preview ব্যর্থ।'); }
    finally { setBusyId(null); }
  };

  const sendNow = async (r) => {
    if (!window.confirm(`"${r.name}" — এখনই reminder পাঠানো হবে। নিশ্চিত?`)) return;
    setBusyId('send-' + r.id);
    try {
      const { data } = await api.post(`/billing/reminder-rules/${r.id}/send-now/`);
      const s = data.summary || {};
      toast.success(`পাঠানো হয়েছে — ${s.clients || 0} client | SMS ${s.sms || 0}, Push ${s.push || 0}, Email ${s.email || 0}, ব্যর্থ ${s.failed || 0}`);
      load();
    } catch (e) { toast.error(e?.response?.data?.error || 'পাঠানো ব্যর্থ।'); }
    finally { setBusyId(null); }
  };

  const upd = (k, v) => setModal(m => ({ ...m, [k]: v }));

  return (
    <div className="p-4 min-h-screen bg-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold text-gray-800">Payment Reminder</h1>
          <p className="text-xs text-gray-500">বকেয়া/মেয়াদের রিমাইন্ডার — SMS, App Push ও Email</p>
        </div>
        <button onClick={openNew} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-md shadow-sm">
          + নতুন নিয়ম
        </button>
      </div>

      {/* Rules */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mb-5">
        <div className="px-4 py-2.5 bg-[#23445f] text-white text-sm font-semibold">Reminder Rules</div>
        {loading ? (
          <div className="p-6 text-center text-gray-400 text-sm">লোড হচ্ছে...</div>
        ) : rules.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">কোনো নিয়ম নেই — "+ নতুন নিয়ম" দিয়ে শুরু করুন।</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left">নাম</th>
                  <th className="px-3 py-2 text-left">Trigger</th>
                  <th className="px-3 py-2 text-left">Channel</th>
                  <th className="px-3 py-2 text-left">সময়</th>
                  <th className="px-3 py-2 text-center">Active</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rules.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2.5 font-semibold text-gray-800">{r.name}</td>
                    <td className="px-3 py-2.5 text-gray-600">
                      {r.trigger_display}
                      {r.trigger !== 'on_due' && <span className="text-gray-400"> ({r.offset_days}d)</span>}
                    </td>
                    <td className="px-3 py-2.5"><ChannelBadges r={r} /></td>
                    <td className="px-3 py-2.5 text-gray-600">{String(r.send_hour).padStart(2, '0')}:00</td>
                    <td className="px-3 py-2.5 text-center">
                      <button onClick={() => toggleActive(r)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${r.is_active ? 'bg-green-500' : 'bg-gray-300'}`}>
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${r.is_active ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => doPreview(r)} disabled={busyId === 'prev-' + r.id}
                          className="text-xs px-2 py-1 rounded border border-gray-200 hover:bg-gray-100 disabled:opacity-50">Preview</button>
                        <button onClick={() => sendNow(r)} disabled={busyId === 'send-' + r.id}
                          className="text-xs px-2 py-1 rounded bg-green-600 hover:bg-green-700 text-white disabled:opacity-50">
                          {busyId === 'send-' + r.id ? '...' : 'Send Now'}</button>
                        <button onClick={() => openEdit(r)} className="text-xs px-2 py-1 rounded bg-blue-500 hover:bg-blue-600 text-white">Edit</button>
                        <button onClick={() => remove(r)} className="text-xs px-2 py-1 rounded bg-rose-500 hover:bg-rose-600 text-white">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Logs */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-4 py-2.5 bg-[#23445f] text-white text-sm font-semibold">সাম্প্রতিক পাঠানোর লগ</div>
        {logs.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">এখনো কোনো reminder পাঠানো হয়নি।</div>
        ) : (
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">সময়</th>
                  <th className="px-3 py-2 text-left">গ্রাহক</th>
                  <th className="px-3 py-2 text-left">Channel</th>
                  <th className="px-3 py-2 text-left">প্রাপক</th>
                  <th className="px-3 py-2 text-center">Status</th>
                  <th className="px-3 py-2 text-left">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map(l => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{new Date(l.created_at).toLocaleString('en-GB')}</td>
                    <td className="px-3 py-2 text-gray-700">{l.client_name || '—'} <span className="text-gray-400">{l.client_customer_id || ''}</span></td>
                    <td className="px-3 py-2 uppercase text-xs font-semibold text-gray-600">{l.channel}</td>
                    <td className="px-3 py-2 text-gray-500 font-mono text-xs">{l.recipient}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${l.status === 'sent' ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-700'}`}>{l.status}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{l.triggered_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Add/Edit Modal ── */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl my-8">
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <h2 className="font-bold text-gray-800">{modal.id ? 'নিয়ম সম্পাদনা' : 'নতুন রিমাইন্ডার নিয়ম'}</h2>
              <button onClick={() => setModal(null)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className={lbl}>নিয়মের নাম *</label>
                <input className={inp} value={modal.name} onChange={e => upd('name', e.target.value)} placeholder="যেমন: মেয়াদ শেষের ৩ দিন আগে" />
              </div>

              <div>
                <label className={lbl}>Trigger</label>
                <select className={inp} value={modal.trigger} onChange={e => upd('trigger', e.target.value)}>
                  {TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl}>দিন {modal.trigger === 'on_due' ? '(প্রযোজ্য নয়)' : '(আগে/পরে)'}</label>
                <input type="number" className={inp} value={modal.offset_days} disabled={modal.trigger === 'on_due'}
                  onChange={e => upd('offset_days', Number(e.target.value))} />
              </div>

              <div className="md:col-span-2">
                <label className={lbl}>Channel (অন্তত একটি)</label>
                <div className="flex gap-4">
                  {[['via_sms', 'SMS'], ['via_push', 'App Push'], ['via_email', 'Email']].map(([k, t]) => (
                    <label key={k} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input type="checkbox" checked={modal[k]} onChange={e => upd(k, e.target.checked)} className="accent-blue-600" />
                      {t}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className={lbl}>পাঠানোর ঘণ্টা (0-23)</label>
                <input type="number" min="0" max="23" className={inp} value={modal.send_hour}
                  onChange={e => upd('send_hour', Number(e.target.value))} />
              </div>
              <div>
                <label className={lbl}>ন্যূনতম বকেয়া (৳)</label>
                <input type="number" className={inp} value={modal.min_due} onChange={e => upd('min_due', e.target.value)} />
              </div>

              <div>
                <label className={lbl}>Zone (ঐচ্ছিক)</label>
                <select className={inp} value={modal.zone} onChange={e => upd('zone', e.target.value)}>
                  <option value="">সব Zone</option>
                  {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl}>Package (ঐচ্ছিক)</label>
                <select className={inp} value={modal.package} onChange={e => upd('package', e.target.value)}>
                  <option value="">সব Package</option>
                  {packages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={modal.only_active} onChange={e => upd('only_active', e.target.checked)} className="accent-blue-600" />
                  শুধু active client-দের পাঠাও
                </label>
              </div>

              <div className="md:col-span-2">
                <label className={lbl}>বার্তা (message template)</label>
                <textarea className={inp} rows={3} value={modal.message_template} onChange={e => upd('message_template', e.target.value)} />
                <p className="text-[11px] text-gray-400 mt-1">Placeholder: <code>{'{name} {due} {expiry_date} {customer_id} {package} {phone} {app_link}'}</code></p>
                <p className="text-[11px] text-emerald-600 mt-0.5"><code>{'{app_link}'}</code> = অ্যাপ ডাউনলোড লিংক (media/app/rajamehar-online.apk)</p>
              </div>

              {modal.via_email && (
                <div className="md:col-span-2">
                  <label className={lbl}>Email বিষয়</label>
                  <input className={inp} value={modal.email_subject} onChange={e => upd('email_subject', e.target.value)} />
                </div>
              )}

              <div className="md:col-span-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={modal.is_active} onChange={e => upd('is_active', e.target.checked)} className="accent-green-600" />
                  নিয়মটি সক্রিয় (auto পাঠাবে)
                </label>
              </div>
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2">
              <button onClick={() => setModal(null)} className="px-4 py-2 text-sm rounded-md border border-gray-300 hover:bg-gray-50">বাতিল</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 text-sm rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-50">
                {saving ? 'সংরক্ষণ...' : 'সংরক্ষণ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Preview Modal ── */}
      {preview && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto" onClick={() => setPreview(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-xl my-8" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <h2 className="font-bold text-gray-800">Preview — {preview.rule.name}</h2>
              <button onClick={() => setPreview(null)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
            </div>
            <div className="p-5">
              <p className="text-sm mb-3">যোগ্য গ্রাহক: <span className="font-bold text-blue-600">{preview.eligible_count}</span> জন</p>
              {preview.sample?.length ? (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500 font-semibold">নমুনা (প্রথম {preview.sample.length} জন):</p>
                  {preview.sample.map((s, i) => (
                    <div key={i} className="border border-gray-100 rounded p-2 bg-gray-50 text-xs">
                      <div className="font-semibold text-gray-700">{s.name} <span className="text-gray-400">({s.customer_id}) · {s.phone} · বকেয়া {s.due}৳</span></div>
                      <div className="text-gray-600 mt-1">{s.message}</div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-gray-400">এই মুহূর্তে কোনো যোগ্য গ্রাহক নেই।</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
