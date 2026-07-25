import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../utils/api';

const PROVIDER_LABELS = {
  sip_trunk:    'SIP Trunk',
  did_provider: 'DID Provider',
  internal:     'Internal (Asterisk)',
  other:        'Other',
};
const ROUTE_LABELS = {
  ring_group: 'Ring Group',
  ivr:        'IVR Menu',
  agent:      'Direct Agent',
  forward:    'External Forward',
};
const ROUTE_CLS = {
  ring_group: 'bg-sky-100 text-sky-700',
  ivr:        'bg-violet-100 text-violet-700',
  agent:      'bg-teal-100 text-teal-700',
  forward:    'bg-amber-100 text-amber-700',
};
const WEEKDAYS = ['সোমবার','মঙ্গলবার','বুধবার','বৃহস্পতিবার','শুক্রবার','শনিবার','রবিবার'];

const EMPTY = {
  title: '', number: '', provider_type: 'internal',
  sip_trunk_host: '', sip_trunk_username: '',
  default_route_type: 'ring_group',
  default_ring_group: '', default_ivr: '', default_agent: '', forward_number: '',
  business_hours_enabled: false, after_hours_message: '', is_active: true,
};

const INPUT  = 'w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500';
const SELECT = 'w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500';

function StatCard({ label, value, color = 'text-gray-800' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value ?? '—'}</p>
    </div>
  );
}

export default function HotlineControlPage() {
  const [hotlines, setHotlines] = useState([]);
  const [groups,   setGroups]   = useState([]);
  const [ivrs,     setIvrs]     = useState([]);
  const [agents,   setAgents]   = useState([]);
  const [stats,    setStats]    = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [modal,    setModal]    = useState(null); // null | 'form' | 'hours'
  const [form,     setForm]     = useState(EMPTY);
  const [editId,   setEditId]   = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [applying, setApplying] = useState(null);
  const [activeHotline, setActiveHotline] = useState(null);
  const [hours,    setHours]    = useState([]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [hn, gr, iv, ag, st] = await Promise.all([
        api.get('/voip/hotline-numbers/'),
        api.get('/voip/ring-groups/'),
        api.get('/voip/ivr-menus/'),
        api.get('/voip/pbx-agents/?is_active=true'),
        api.get('/voip/pbx/dashboard-stats/').catch(() => ({ data: null })),
      ]);
      setHotlines(hn.data.results ?? hn.data);
      setGroups(gr.data.results ?? gr.data ?? []);
      setIvrs(iv.data.results ?? iv.data ?? []);
      setAgents(ag.data.results ?? ag.data ?? []);
      setStats(st.data);
    } catch { toast.error('ডেটা লোড ব্যর্থ।'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const openAdd = () => { setForm(EMPTY); setEditId(null); setModal('form'); };
  const openEdit = (h) => {
    setForm({
      title: h.title, number: h.number, provider_type: h.provider_type,
      sip_trunk_host: h.sip_trunk_host, sip_trunk_username: h.sip_trunk_username,
      default_route_type: h.default_route_type,
      default_ring_group: h.default_ring_group ?? '',
      default_ivr: h.default_ivr ?? '',
      default_agent: h.default_agent ?? '',
      forward_number: h.forward_number,
      business_hours_enabled: h.business_hours_enabled,
      after_hours_message: h.after_hours_message,
      is_active: h.is_active,
    });
    setEditId(h.id);
    setModal('form');
  };

  const openHours = (h) => {
    setActiveHotline(h);
    const existing = h.business_hours ?? [];
    setHours(existing.length > 0
      ? existing.map(bh => ({ weekday: bh.weekday, start_time: bh.start_time, end_time: bh.end_time, is_open: bh.is_open }))
      : WEEKDAYS.map((_, i) => ({ weekday: i, start_time: '09:00', end_time: '18:00', is_open: i < 5 }))
    );
    setModal('hours');
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.number.trim()) {
      toast.error('শিরোনাম ও নম্বর আবশ্যক।'); return;
    }
    setSaving(true);
    try {
      const payload = { ...form };
      ['default_ring_group','default_ivr','default_agent'].forEach(k => {
        if (!payload[k]) payload[k] = null;
      });
      if (editId) {
        await api.patch(`/voip/hotline-numbers/${editId}/`, payload);
        toast.success('আপডেট হয়েছে।');
      } else {
        await api.post('/voip/hotline-numbers/', payload);
        toast.success('হটলাইন তৈরি হয়েছে।');
      }
      setModal(null);
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.number?.[0] || e.response?.data?.detail || 'ব্যর্থ হয়েছে।');
    } finally { setSaving(false); }
  };

  const handleToggle = async (h) => {
    const url = h.is_active
      ? `/voip/hotline-numbers/${h.id}/deactivate/`
      : `/voip/hotline-numbers/${h.id}/activate/`;
    try {
      await api.post(url);
      fetchAll();
    } catch { toast.error('স্ট্যাটাস পরিবর্তন ব্যর্থ।'); }
  };

  const handleDelete = async (id) => {
    if (!confirm('এই হটলাইন মুছবেন?')) return;
    try {
      await api.delete(`/voip/hotline-numbers/${id}/`);
      toast.success('মুছে ফেলা হয়েছে।');
      fetchAll();
    } catch { toast.error('মুছতে ব্যর্থ।'); }
  };

  const handleApply = async (id) => {
    setApplying(id);
    try {
      const res = await api.post(`/voip/hotline-numbers/${id}/apply_asterisk/`);
      toast.success(res.data.status === 'dry_run'
        ? 'Config তৈরি হয়েছে (VOIP_ENABLED=False — dry run)।'
        : 'Asterisk dialplan apply হয়েছে।');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Apply ব্যর্থ।');
    } finally { setApplying(null); }
  };

  const handleSaveHours = async () => {
    setSaving(true);
    try {
      await api.post(`/voip/hotline-numbers/${activeHotline.id}/set_business_hours/`, { hours });
      toast.success('ব্যবসায়িক সময় সংরক্ষিত হয়েছে।');
      setModal(null);
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'ব্যর্থ।');
    } finally { setSaving(false); }
  };

  const routeDetail = (h) => {
    if (h.default_route_type === 'ring_group') return h.ring_group_name || '—';
    if (h.default_route_type === 'ivr')        return h.ivr_name || '—';
    if (h.default_route_type === 'agent')      return h.agent_name || '—';
    if (h.default_route_type === 'forward')    return h.forward_number || '—';
    return '—';
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <span className="text-teal-600">☎️</span> IP PBX / Hotline Control
          </h1>
          <p className="text-xs text-gray-500">Rajamehar Online হটলাইন নম্বর ও রাউটিং পরিচালনা</p>
        </div>
        <button onClick={openAdd}
          className="px-3 py-1.5 text-sm rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold flex items-center gap-1.5">
          + নতুন হটলাইন
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="মোট হটলাইন"      value={stats.total_hotlines} />
          <StatCard label="সক্রিয় এজেন্ট"   value={stats.active_agents}  color="text-teal-600" />
          <StatCard label="আজকের কল"         value={stats.today_inbound_calls} color="text-sky-700" />
          <StatCard label="Missed কল"         value={stats.missed_calls}   color="text-rose-600" />
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-[11px] uppercase tracking-wide">
                <th className="text-left px-4 py-2.5 font-semibold">#</th>
                <th className="text-left px-4 py-2.5 font-semibold">শিরোনাম / নম্বর</th>
                <th className="text-left px-4 py-2.5 font-semibold">Provider</th>
                <th className="text-left px-4 py-2.5 font-semibold">Route</th>
                <th className="text-left px-4 py-2.5 font-semibold">বিজনেস আওয়ার</th>
                <th className="text-left px-4 py-2.5 font-semibold">স্ট্যাটাস</th>
                <th className="text-left px-4 py-2.5 font-semibold">কাজ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">লোড হচ্ছে…</td></tr>
              ) : hotlines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                    কোনো হটলাইন নম্বর নেই। প্রথমে PBX Agents ও Ring Groups তৈরি করুন।
                  </td>
                </tr>
              ) : hotlines.map((h, i) => (
                <tr key={h.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2.5 text-gray-400">{i + 1}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-gray-800">{h.title}</div>
                    <div className="text-[11px] font-mono text-sky-700">{h.number}</div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{PROVIDER_LABELS[h.provider_type]}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${ROUTE_CLS[h.default_route_type] || 'bg-gray-100 text-gray-600'}`}>
                      {ROUTE_LABELS[h.default_route_type]}
                    </span>
                    <div className="text-[11px] text-gray-500 mt-0.5">{routeDetail(h)}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${h.business_hours_enabled ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-500'}`}>
                      {h.business_hours_enabled ? `সক্রিয় (${h.business_hours?.length || 0}টি)` : 'নিষ্ক্রিয়'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => handleToggle(h)}
                      className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${h.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {h.is_active ? 'চালু' : 'বন্ধ'}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => handleApply(h.id)} disabled={applying === h.id}
                        className="text-xs px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-semibold disabled:opacity-50">
                        {applying === h.id ? '…' : 'Apply'}
                      </button>
                      <button onClick={() => openHours(h)}
                        className="text-xs px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 font-semibold">
                        সময়
                      </button>
                      <button onClick={() => openEdit(h)}
                        className="text-xs px-2.5 py-1 rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 font-semibold">
                        সম্পাদনা
                      </button>
                      <button onClick={() => handleDelete(h.id)}
                        className="text-xs px-2.5 py-1 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 font-semibold">
                        মুছুন
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Hotline Form Modal */}
      {modal === 'form' && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-base font-bold text-gray-800 mb-4">
              {editId ? 'হটলাইন সম্পাদনা' : 'নতুন হটলাইন নম্বর'}
            </h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">শিরোনাম *</label>
                  <input className={INPUT} placeholder="যেমন: Rajamehar Online Hotline"
                    value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">নম্বর *</label>
                  <input className={INPUT} placeholder="যেমন: 01700000000"
                    value={form.number} onChange={e => setForm(f => ({ ...f, number: e.target.value }))} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Provider Type</label>
                <select className={SELECT} value={form.provider_type}
                  onChange={e => setForm(f => ({ ...f, provider_type: e.target.value }))}>
                  {Object.entries(PROVIDER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>

              {form.provider_type === 'sip_trunk' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">SIP Trunk Host</label>
                    <input className={INPUT} value={form.sip_trunk_host}
                      onChange={e => setForm(f => ({ ...f, sip_trunk_host: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Username</label>
                    <input className={INPUT} value={form.sip_trunk_username}
                      onChange={e => setForm(f => ({ ...f, sip_trunk_username: e.target.value }))} />
                  </div>
                </div>
              )}

              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">ডিফল্ট রাউটিং</p>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Route Type</label>
                  <select className={SELECT} value={form.default_route_type}
                    onChange={e => setForm(f => ({ ...f, default_route_type: e.target.value }))}>
                    {Object.entries(ROUTE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              </div>

              {form.default_route_type === 'ring_group' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Ring Group</label>
                  <select className={SELECT} value={form.default_ring_group ?? ''}
                    onChange={e => setForm(f => ({ ...f, default_ring_group: e.target.value || null }))}>
                    <option value="">— নির্বাচন করুন —</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
              )}
              {form.default_route_type === 'ivr' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">IVR Menu</label>
                  <select className={SELECT} value={form.default_ivr ?? ''}
                    onChange={e => setForm(f => ({ ...f, default_ivr: e.target.value || null }))}>
                    <option value="">— নির্বাচন করুন —</option>
                    {ivrs.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              )}
              {form.default_route_type === 'agent' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Agent</label>
                  <select className={SELECT} value={form.default_agent ?? ''}
                    onChange={e => setForm(f => ({ ...f, default_agent: e.target.value || null }))}>
                    <option value="">— নির্বাচন করুন —</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.display_name} ({a.extension})</option>)}
                  </select>
                </div>
              )}
              {form.default_route_type === 'forward' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">ফরওয়ার্ড নম্বর</label>
                  <input className={INPUT} value={form.forward_number}
                    onChange={e => setForm(f => ({ ...f, forward_number: e.target.value }))} />
                </div>
              )}

              <div className="border-t border-gray-100 pt-3 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.business_hours_enabled}
                    onChange={e => setForm(f => ({ ...f, business_hours_enabled: e.target.checked }))} />
                  <span className="text-sm text-gray-700">ব্যবসায়িক সময় সক্রিয়</span>
                </label>
                {form.business_hours_enabled && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">অফ-আওয়ার মেসেজ (Playback path)</label>
                    <input className={INPUT} placeholder="যেমন: office-closed"
                      value={form.after_hours_message}
                      onChange={e => setForm(f => ({ ...f, after_hours_message: e.target.value }))} />
                  </div>
                )}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                  <span className="text-sm text-gray-700">সক্রিয়</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setModal(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">বাতিল</button>
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-2 text-sm rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold disabled:opacity-50">
                {saving ? 'সংরক্ষণ হচ্ছে…' : 'সংরক্ষণ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Business Hours Modal */}
      {modal === 'hours' && activeHotline && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-md p-6">
            <h2 className="text-base font-bold text-gray-800 mb-4">
              {activeHotline.title} — ব্যবসায়িক সময়
            </h2>
            <div className="space-y-2">
              {hours.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 w-28 shrink-0">
                    <input type="checkbox" checked={h.is_open}
                      onChange={e => setHours(prev => prev.map((r, idx) => idx === i ? { ...r, is_open: e.target.checked } : r))} />
                    <span className="text-xs text-gray-700">{WEEKDAYS[h.weekday]}</span>
                  </label>
                  <input type="time" disabled={!h.is_open} value={h.start_time}
                    className="flex-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-40"
                    onChange={e => setHours(prev => prev.map((r, idx) => idx === i ? { ...r, start_time: e.target.value } : r))} />
                  <span className="text-gray-400 text-xs shrink-0">—</span>
                  <input type="time" disabled={!h.is_open} value={h.end_time}
                    className="flex-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-40"
                    onChange={e => setHours(prev => prev.map((r, idx) => idx === i ? { ...r, end_time: e.target.value } : r))} />
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3">সময় সংরক্ষণের পর হটলাইনটি Apply করুন।</p>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setModal(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">বাতিল</button>
              <button onClick={handleSaveHours} disabled={saving}
                className="px-4 py-2 text-sm rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold disabled:opacity-50">
                {saving ? 'সংরক্ষণ হচ্ছে…' : 'সংরক্ষণ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
