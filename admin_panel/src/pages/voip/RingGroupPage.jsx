import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../utils/api';

const STRATEGY_LABELS = {
  ring_all:   'সবাইকে একসাথে',
  sequential: 'একের পর এক',
  random:     'এলোমেলো',
};
const NO_ANSWER_LABELS = {
  ivr:       'IVR মেনু',
  forward:   'ফরওয়ার্ড',
  voicemail: 'Voicemail',
  hangup:    'Hangup',
};
const STRATEGY_CLS = {
  ring_all:   'bg-sky-100 text-sky-700',
  sequential: 'bg-amber-100 text-amber-700',
  random:     'bg-violet-100 text-violet-700',
};

const EMPTY = {
  name: '', strategy: 'ring_all', timeout_seconds: 25, retry_seconds: 3,
  no_answer_route_type: 'hangup', no_answer_forward_num: '', is_active: true,
};
const INPUT  = 'w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500';
const SELECT = 'w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500';

export default function RingGroupPage() {
  const [groups,  setGroups]  = useState([]);
  const [agents,  setAgents]  = useState([]);
  const [loading, setLoading] = useState(false);
  const [modal,   setModal]   = useState(null); // null | 'group' | 'members'
  const [form,    setForm]    = useState(EMPTY);
  const [editId,  setEditId]  = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [activeGroup, setActiveGroup] = useState(null);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/voip/ring-groups/');
      setGroups(r.data.results ?? r.data);
    } catch { toast.error('রিং গ্রুপ লোড ব্যর্থ।'); }
    finally { setLoading(false); }
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const r = await api.get('/voip/pbx-agents/?is_active=true');
      setAgents(r.data.results ?? r.data ?? []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchGroups(); fetchAgents(); }, [fetchGroups, fetchAgents]);

  const openAdd = () => { setForm(EMPTY); setEditId(null); setModal('group'); };
  const openEdit = (g) => {
    setForm({
      name: g.name, strategy: g.strategy,
      timeout_seconds: g.timeout_seconds, retry_seconds: g.retry_seconds,
      no_answer_route_type: g.no_answer_route_type,
      no_answer_forward_num: g.no_answer_forward_num,
      is_active: g.is_active,
    });
    setEditId(g.id);
    setModal('group');
  };
  const openMembers = (g) => { setActiveGroup(g); setModal('members'); };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('নাম আবশ্যক।'); return; }
    setSaving(true);
    try {
      if (editId) {
        await api.patch(`/voip/ring-groups/${editId}/`, form);
        toast.success('আপডেট হয়েছে।');
      } else {
        await api.post('/voip/ring-groups/', form);
        toast.success('রিং গ্রুপ তৈরি হয়েছে।');
      }
      setModal(null);
      fetchGroups();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'ব্যর্থ হয়েছে।');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('এই রিং গ্রুপ মুছবেন?')) return;
    try {
      await api.delete(`/voip/ring-groups/${id}/`);
      toast.success('মুছে ফেলা হয়েছে।');
      fetchGroups();
    } catch { toast.error('মুছতে ব্যর্থ।'); }
  };

  const refreshActive = async () => {
    const r = await api.get('/voip/ring-groups/');
    const all = r.data.results ?? r.data;
    setGroups(all);
    if (activeGroup) setActiveGroup(all.find(g => g.id === activeGroup.id) || null);
  };

  const handleAddMember = async (agentId) => {
    const order = (activeGroup?.members?.length || 0) + 1;
    try {
      await api.post(`/voip/ring-groups/${activeGroup.id}/add_member/`, { agent: agentId, order });
      toast.success('এজেন্ট যোগ হয়েছে।');
      await refreshActive();
    } catch (e) { toast.error(e.response?.data?.detail || 'ব্যর্থ।'); }
  };

  const handleRemoveMember = async (agentId) => {
    try {
      await api.post(`/voip/ring-groups/${activeGroup.id}/remove_member/`, { agent: agentId });
      toast.success('সরানো হয়েছে।');
      await refreshActive();
    } catch { toast.error('ব্যর্থ।'); }
  };

  const memberIds = activeGroup?.members?.map(m => m.agent) || [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <span className="text-teal-600">📋</span> Ring Groups
          </h1>
          <p className="text-xs text-gray-500">এজেন্ট গ্রুপ — ইনকামিং কল কে রিসিভ করবে</p>
        </div>
        <button onClick={openAdd}
          className="px-3 py-1.5 text-sm rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold flex items-center gap-1.5">
          + নতুন গ্রুপ
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-[11px] uppercase tracking-wide">
                <th className="text-left px-4 py-2.5 font-semibold">#</th>
                <th className="text-left px-4 py-2.5 font-semibold">নাম</th>
                <th className="text-left px-4 py-2.5 font-semibold">কৌশল</th>
                <th className="text-left px-4 py-2.5 font-semibold">Timeout</th>
                <th className="text-left px-4 py-2.5 font-semibold">No-Answer</th>
                <th className="text-left px-4 py-2.5 font-semibold">এজেন্ট</th>
                <th className="text-left px-4 py-2.5 font-semibold">স্ট্যাটাস</th>
                <th className="text-left px-4 py-2.5 font-semibold">কাজ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">লোড হচ্ছে…</td></tr>
              ) : groups.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">কোনো রিং গ্রুপ নেই</td></tr>
              ) : groups.map((g, i) => (
                <tr key={g.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2.5 text-gray-400">{i + 1}</td>
                  <td className="px-4 py-2.5 font-semibold text-gray-800">{g.name}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${STRATEGY_CLS[g.strategy] || 'bg-gray-100 text-gray-600'}`}>
                      {STRATEGY_LABELS[g.strategy] || g.strategy}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">{g.timeout_seconds}s</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{NO_ANSWER_LABELS[g.no_answer_route_type]}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {g.members?.length > 0 ? g.members.map(m => (
                        <span key={m.id} className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold bg-teal-50 text-teal-700">
                          {m.agent_name}
                        </span>
                      )) : <span className="text-[11px] text-gray-400 italic">কেউ নেই</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${g.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {g.is_active ? 'সক্রিয়' : 'নিষ্ক্রিয়'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openMembers(g)}
                        className="text-xs px-2.5 py-1 rounded-lg bg-sky-50 text-sky-700 hover:bg-sky-100 font-semibold">
                        এজেন্ট
                      </button>
                      <button onClick={() => openEdit(g)}
                        className="text-xs px-2.5 py-1 rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 font-semibold">
                        সম্পাদনা
                      </button>
                      <button onClick={() => handleDelete(g.id)}
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

      {/* Group Form Modal */}
      {modal === 'group' && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-md p-6">
            <h2 className="text-base font-bold text-gray-800 mb-4">
              {editId ? 'রিং গ্রুপ সম্পাদনা' : 'নতুন রিং গ্রুপ'}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">নাম *</label>
                <input className={INPUT} value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">কৌশল</label>
                <select className={SELECT} value={form.strategy}
                  onChange={e => setForm(f => ({ ...f, strategy: e.target.value }))}>
                  {Object.entries(STRATEGY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Timeout (সেকেন্ড)</label>
                  <input type="number" className={INPUT} value={form.timeout_seconds}
                    onChange={e => setForm(f => ({ ...f, timeout_seconds: parseInt(e.target.value) || 25 }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Retry (সেকেন্ড)</label>
                  <input type="number" className={INPUT} value={form.retry_seconds}
                    onChange={e => setForm(f => ({ ...f, retry_seconds: parseInt(e.target.value) || 3 }))} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">No-answer এ কী করবে</label>
                <select className={SELECT} value={form.no_answer_route_type}
                  onChange={e => setForm(f => ({ ...f, no_answer_route_type: e.target.value }))}>
                  {Object.entries(NO_ANSWER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              {form.no_answer_route_type === 'forward' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">ফরওয়ার্ড নম্বর</label>
                  <input className={INPUT} value={form.no_answer_forward_num}
                    onChange={e => setForm(f => ({ ...f, no_answer_forward_num: e.target.value }))} />
                </div>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_active}
                  onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                <span className="text-sm text-gray-700">সক্রিয়</span>
              </label>
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

      {/* Members Modal */}
      {modal === 'members' && activeGroup && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-md p-6 max-h-[85vh] overflow-y-auto">
            <h2 className="text-base font-bold text-gray-800 mb-4">{activeGroup.name} — এজেন্ট সদস্য</h2>

            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">বর্তমান সদস্য</p>
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 mb-4">
              {activeGroup.members?.length === 0 && (
                <p className="px-4 py-3 text-xs text-gray-400 italic">কেউ নেই</p>
              )}
              {activeGroup.members?.map(m => (
                <div key={m.id} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-sm text-gray-800">
                    {m.agent_name}
                    <span className="text-gray-400 ml-1 text-xs">({m.agent_extension})</span>
                  </span>
                  <button onClick={() => handleRemoveMember(m.agent)}
                    className="text-xs px-2.5 py-1 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 font-semibold">
                    বাদ দিন
                  </button>
                </div>
              ))}
            </div>

            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">যোগ করুন</p>
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
              {agents.filter(a => !memberIds.includes(a.id)).length === 0 && (
                <p className="px-4 py-3 text-xs text-gray-400 italic">সব এজেন্ট ইতিমধ্যে যোগ করা।</p>
              )}
              {agents.filter(a => !memberIds.includes(a.id)).map(a => (
                <div key={a.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50">
                  <span className="text-sm text-gray-800">
                    {a.display_name}
                    <span className="text-gray-400 ml-1 text-xs">({a.extension})</span>
                  </span>
                  <button onClick={() => handleAddMember(a.id)}
                    className="text-xs px-2.5 py-1 rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 font-semibold">
                    + যোগ
                  </button>
                </div>
              ))}
            </div>

            <div className="flex justify-end mt-5">
              <button onClick={() => setModal(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">বন্ধ করুন</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
