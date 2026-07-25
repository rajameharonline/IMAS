import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../utils/api';

const ROLE_LABELS = {
  general:  'General',
  billing:  'Billing Support',
  support:  'Technical Support',
  manager:  'Manager',
  operator: 'Operator',
};
const ROLE_CLS = {
  general:  'bg-gray-100 text-gray-600',
  billing:  'bg-sky-100 text-sky-700',
  support:  'bg-emerald-100 text-emerald-700',
  manager:  'bg-violet-100 text-violet-700',
  operator: 'bg-amber-100 text-amber-700',
};

const EMPTY = {
  display_name: '', extension: '', sip_endpoint_name: '',
  role_label: 'general', priority: 10, is_active: true, user: '',
};

const INPUT  = 'w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500';
const SELECT = 'w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500';

export default function PBXAgentPage() {
  const [agents,  setAgents]  = useState([]);
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [modal,   setModal]   = useState(false);
  const [form,    setForm]    = useState(EMPTY);
  const [editId,  setEditId]  = useState(null);
  const [saving,  setSaving]  = useState(false);
  // Asterisk-এ এই মুহূর্তে SIP register করা agent endpoint (online presence)
  const [onlineAgents, setOnlineAgents] = useState(new Set());
  const [reprovisioning, setReprovisioning] = useState(false);

  // online presence — প্রতি ১৫s poll করি (অ্যাপ চালু থাকলে register থাকে)
  const fetchOnline = useCallback(async () => {
    try {
      const r = await api.get('/voip/registered-clients/');
      setOnlineAgents(new Set(r.data?.agents || []));
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchOnline();
    const id = setInterval(fetchOnline, 15000);
    return () => clearInterval(id);
  }, [fetchOnline]);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/voip/pbx-agents/');
      setAgents(r.data.results ?? r.data);
    } catch { toast.error('এজেন্ট লোড ব্যর্থ।'); }
    finally { setLoading(false); }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const r = await api.get('/users/?page_size=200');
      setUsers(r.data.results ?? r.data ?? []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchAgents(); fetchUsers(); }, [fetchAgents, fetchUsers]);

  const openAdd = () => { setForm(EMPTY); setEditId(null); setModal(true); };
  const openEdit = (a) => {
    setForm({
      display_name: a.display_name, extension: a.extension,
      sip_endpoint_name: a.sip_endpoint_name, role_label: a.role_label,
      priority: a.priority, is_active: a.is_active, user: a.user ?? '',
    });
    setEditId(a.id);
    setModal(true);
  };

  const handleSave = async () => {
    if (!form.display_name.trim() || !form.extension.trim()) {
      toast.error('নাম ও extension আবশ্যক।'); return;
    }
    setSaving(true);
    try {
      if (editId) {
        await api.patch(`/voip/pbx-agents/${editId}/`, form);
        toast.success('আপডেট হয়েছে।');
      } else {
        await api.post('/voip/pbx-agents/', form);
        toast.success('এজেন্ট যোগ হয়েছে।');
      }
      setModal(false);
      fetchAgents();
    } catch (e) {
      toast.error(e.response?.data?.extension?.[0] || e.response?.data?.detail || 'ব্যর্থ হয়েছে।');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('এই এজেন্ট মুছে ফেলবেন?')) return;
    try {
      await api.delete(`/voip/pbx-agents/${id}/`);
      toast.success('মুছে ফেলা হয়েছে।');
      fetchAgents();
    } catch { toast.error('মুছতে ব্যর্থ।'); }
  };

  const toggleActive = async (a) => {
    try {
      await api.patch(`/voip/pbx-agents/${a.id}/`, { is_active: !a.is_active });
      fetchAgents();
    } catch { toast.error('আপডেট ব্যর্থ।'); }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <span className="text-teal-600">🎧</span> PBX Agents
          </h1>
          <p className="text-xs text-gray-500">স্টাফ → SIP extension ম্যাপিং পরিচালনা</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={async () => {
            setReprovisioning(true);
            try {
              await api.post('/voip/reprovision/');
              toast.success('PJSIP reprovision ও reload সম্পন্ন।');
              fetchOnline();
            } catch (e) {
              toast.error(e.response?.data?.detail || 'Reprovision ব্যর্থ।');
            } finally { setReprovisioning(false); }
          }} disabled={reprovisioning}
            className="px-3 py-1.5 text-sm rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold disabled:opacity-50">
            {reprovisioning ? 'Reprovisioning…' : '⟳ PJSIP Reprovision'}
          </button>
          <button onClick={openAdd}
            className="px-3 py-1.5 text-sm rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold flex items-center gap-1.5">
            + নতুন এজেন্ট
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-[11px] uppercase tracking-wide">
                <th className="text-left px-4 py-2.5 font-semibold">#</th>
                <th className="text-left px-4 py-2.5 font-semibold">নাম</th>
                <th className="text-left px-4 py-2.5 font-semibold">Extension</th>
                <th className="text-left px-4 py-2.5 font-semibold">SIP Endpoint</th>
                <th className="text-left px-4 py-2.5 font-semibold">ভূমিকা</th>
                <th className="text-left px-4 py-2.5 font-semibold">Priority</th>
                <th className="text-left px-4 py-2.5 font-semibold">অনলাইন</th>
                <th className="text-left px-4 py-2.5 font-semibold">স্ট্যাটাস</th>
                <th className="text-left px-4 py-2.5 font-semibold">কাজ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">লোড হচ্ছে…</td></tr>
              ) : agents.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">কোনো এজেন্ট নেই</td></tr>
              ) : agents.map((a, i) => (
                <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2.5 text-gray-400">{i + 1}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-gray-800">{a.display_name}</div>
                    {a.user_name && <div className="text-[11px] text-gray-500">{a.user_name}</div>}
                  </td>
                  <td className="px-4 py-2.5 font-mono font-semibold text-sky-700">{a.extension}</td>
                  <td className="px-4 py-2.5 font-mono text-gray-500 text-xs">{a.sip_endpoint_name || '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${ROLE_CLS[a.role_label] || 'bg-gray-100 text-gray-600'}`}>
                      {ROLE_LABELS[a.role_label] || a.role_label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">{a.priority}</td>
                  <td className="px-4 py-2.5">
                    {onlineAgents.has(a.sip_endpoint_name) ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> অনলাইন
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-400">
                        <span className="w-2 h-2 rounded-full bg-gray-300" /> অফলাইন
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => toggleActive(a)}
                      className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${a.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {a.is_active ? 'সক্রিয়' : 'নিষ্ক্রিয়'}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(a)}
                        className="text-xs px-2.5 py-1 rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 font-semibold">
                        সম্পাদনা
                      </button>
                      <button onClick={() => handleDelete(a.id)}
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

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-md p-6">
            <h2 className="text-base font-bold text-gray-800 mb-4">
              {editId ? 'এজেন্ট সম্পাদনা' : 'নতুন এজেন্ট'}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">নাম *</label>
                <input className={INPUT} value={form.display_name}
                  onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Extension *</label>
                  <input className={INPUT} value={form.extension}
                    onChange={e => setForm(f => ({ ...f, extension: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Priority</label>
                  <input type="number" className={INPUT} value={form.priority}
                    onChange={e => setForm(f => ({ ...f, priority: parseInt(e.target.value) || 10 }))} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">SIP Endpoint Name</label>
                <input className={INPUT} placeholder="যেমন: agent_1" value={form.sip_endpoint_name}
                  onChange={e => setForm(f => ({ ...f, sip_endpoint_name: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">ভূমিকা</label>
                <select className={SELECT} value={form.role_label}
                  onChange={e => setForm(f => ({ ...f, role_label: e.target.value }))}>
                  {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              {users.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">User (ঐচ্ছিক)</label>
                  <select className={SELECT} value={form.user ?? ''}
                    onChange={e => setForm(f => ({ ...f, user: e.target.value || null }))}>
                    <option value="">— নির্বাচন করুন —</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
                  </select>
                </div>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_active}
                  onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                <span className="text-sm text-gray-700">সক্রিয়</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">বাতিল</button>
              <button onClick={handleSave} disabled={saving}
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
