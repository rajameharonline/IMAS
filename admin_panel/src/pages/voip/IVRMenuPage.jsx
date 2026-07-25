import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../utils/api';

const ROUTE_LABELS = {
  ring_group: 'Ring Group',
  agent:      'Agent',
  forward:    'Forward Number',
  voicemail:  'Voicemail',
  hangup:     'Hangup',
};
const DIGITS = ['1','2','3','4','5','6','7','8','9','0','*','#'];

const EMPTY_MENU   = { name: '', timeout_seconds: 7, is_active: true };
const EMPTY_OPTION = { digit: '1', label: '', route_type: 'ring_group', ring_group: '', agent: '', forward_number: '', order: 1 };

const INPUT  = 'w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500';
const SELECT = 'w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500';

export default function IVRMenuPage() {
  const [menus,      setMenus]      = useState([]);
  const [groups,     setGroups]     = useState([]);
  const [agents,     setAgents]     = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [modal,      setModal]      = useState(null); // null | 'menu' | 'options' | 'greeting'
  const [form,       setForm]       = useState(EMPTY_MENU);
  const [editId,     setEditId]     = useState(null);
  const [saving,     setSaving]     = useState(false);
  const [activeMenu, setActiveMenu] = useState(null);
  const [options,    setOptions]    = useState([{ ...EMPTY_OPTION }]);
  const [audioFile,  setAudioFile]  = useState(null);
  const [uploading,  setUploading]  = useState(false);
  const fileRef = useRef();

  const fetchMenus = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/voip/ivr-menus/');
      setMenus(r.data.results ?? r.data);
    } catch { toast.error('IVR মেনু লোড ব্যর্থ।'); }
    finally { setLoading(false); }
  }, []);

  const fetchRefs = useCallback(async () => {
    try {
      const [gr, ar] = await Promise.all([
        api.get('/voip/ring-groups/'),
        api.get('/voip/pbx-agents/?is_active=true'),
      ]);
      setGroups(gr.data.results ?? gr.data ?? []);
      setAgents(ar.data.results ?? ar.data ?? []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchMenus(); fetchRefs(); }, [fetchMenus, fetchRefs]);

  const openAdd  = () => { setForm(EMPTY_MENU); setEditId(null); setModal('menu'); };
  const openEdit = (m) => {
    setForm({ name: m.name, timeout_seconds: m.timeout_seconds, is_active: m.is_active });
    setEditId(m.id);
    setModal('menu');
  };
  const openOptions = (m) => {
    setActiveMenu(m);
    setOptions(m.options?.length > 0
      ? m.options.map(o => ({ digit: o.digit, label: o.label, route_type: o.route_type, ring_group: o.ring_group ?? '', agent: o.agent ?? '', forward_number: o.forward_number, order: o.order }))
      : [{ ...EMPTY_OPTION }]
    );
    setModal('options');
  };
  const openGreeting = (m) => { setActiveMenu(m); setAudioFile(null); setModal('greeting'); };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('নাম আবশ্যক।'); return; }
    setSaving(true);
    try {
      if (editId) {
        await api.patch(`/voip/ivr-menus/${editId}/`, form);
        toast.success('আপডেট হয়েছে।');
      } else {
        await api.post('/voip/ivr-menus/', form);
        toast.success('IVR মেনু তৈরি হয়েছে।');
      }
      setModal(null);
      fetchMenus();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'ব্যর্থ।');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('এই IVR মেনু মুছবেন?')) return;
    try {
      await api.delete(`/voip/ivr-menus/${id}/`);
      toast.success('মুছে ফেলা হয়েছে।');
      fetchMenus();
    } catch { toast.error('মুছতে ব্যর্থ।'); }
  };

  const handleSaveOptions = async () => {
    setSaving(true);
    try {
      const payload = options.filter(o => o.digit && o.label).map((o, i) => ({
        ...o, order: i + 1,
        ring_group: o.ring_group || null,
        agent: o.agent || null,
      }));
      await api.post(`/voip/ivr-menus/${activeMenu.id}/set_options/`, { options: payload });
      toast.success('অপশন সংরক্ষিত হয়েছে।');
      setModal(null);
      fetchMenus();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'ব্যর্থ।');
    } finally { setSaving(false); }
  };

  const handleUploadGreeting = async () => {
    if (!audioFile) { toast.error('ফাইল নির্বাচন করুন।'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('audio', audioFile);
      await api.post(`/voip/ivr-menus/${activeMenu.id}/upload_greeting/`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Greeting আপলোড ও convert হয়েছে।');
      setModal(null);
      fetchMenus();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'আপলোড ব্যর্থ।');
    } finally { setUploading(false); }
  };

  const updOpt = (i, field, val) =>
    setOptions(prev => prev.map((o, idx) => idx === i ? { ...o, [field]: val } : o));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <span className="text-teal-600">🔢</span> IVR Menu
          </h1>
          <p className="text-xs text-gray-500">অটোমেটেড ভয়েস মেনু (Press 1 for Billing…)</p>
        </div>
        <button onClick={openAdd}
          className="px-3 py-1.5 text-sm rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold flex items-center gap-1.5">
          + নতুন IVR মেনু
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
                <th className="text-left px-4 py-2.5 font-semibold">Timeout</th>
                <th className="text-left px-4 py-2.5 font-semibold">Greeting</th>
                <th className="text-left px-4 py-2.5 font-semibold">অপশন</th>
                <th className="text-left px-4 py-2.5 font-semibold">স্ট্যাটাস</th>
                <th className="text-left px-4 py-2.5 font-semibold">কাজ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">লোড হচ্ছে…</td></tr>
              ) : menus.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">কোনো IVR মেনু নেই</td></tr>
              ) : menus.map((m, i) => (
                <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2.5 text-gray-400">{i + 1}</td>
                  <td className="px-4 py-2.5 font-semibold text-gray-800">{m.name}</td>
                  <td className="px-4 py-2.5 text-gray-500">{m.timeout_seconds}s</td>
                  <td className="px-4 py-2.5">
                    {m.greeting_file
                      ? <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700">✓ সেট আছে</span>
                      : <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700">⚠ নেই</span>
                    }
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {m.options?.length > 0
                        ? m.options.map(o => (
                            <span key={o.id} className="inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold bg-gray-100 text-gray-700">
                              {o.digit}→{o.label}
                            </span>
                          ))
                        : <span className="text-[11px] text-gray-400 italic">নেই</span>
                      }
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${m.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {m.is_active ? 'সক্রিয়' : 'নিষ্ক্রিয়'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openGreeting(m)}
                        className="text-xs px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 font-semibold">
                        Greeting
                      </button>
                      <button onClick={() => openOptions(m)}
                        className="text-xs px-2.5 py-1 rounded-lg bg-sky-50 text-sky-700 hover:bg-sky-100 font-semibold">
                        অপশন
                      </button>
                      <button onClick={() => openEdit(m)}
                        className="text-xs px-2.5 py-1 rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 font-semibold">
                        সম্পাদনা
                      </button>
                      <button onClick={() => handleDelete(m.id)}
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

      {/* Menu Form Modal */}
      {modal === 'menu' && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-sm p-6">
            <h2 className="text-base font-bold text-gray-800 mb-4">
              {editId ? 'IVR মেনু সম্পাদনা' : 'নতুন IVR মেনু'}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">নাম *</label>
                <input className={INPUT} value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Timeout (সেকেন্ড)</label>
                <input type="number" className={INPUT} value={form.timeout_seconds}
                  onChange={e => setForm(f => ({ ...f, timeout_seconds: parseInt(e.target.value) || 7 }))} />
              </div>
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

      {/* Options Modal */}
      {modal === 'options' && activeMenu && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-base font-bold text-gray-800 mb-4">{activeMenu.name} — ডায়াল অপশন</h2>

            <div className="space-y-2 mb-4">
              {options.map((opt, i) => (
                <div key={i} className="bg-gray-50 rounded-xl border border-gray-200 p-3 grid grid-cols-2 sm:grid-cols-12 gap-2 items-end">
                  <div className="sm:col-span-1">
                    <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Digit</label>
                    <select className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500"
                      value={opt.digit} onChange={e => updOpt(i, 'digit', e.target.value)}>
                      {DIGITS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">লেবেল</label>
                    <input className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500"
                      placeholder="যেমন: Billing"
                      value={opt.label} onChange={e => updOpt(i, 'label', e.target.value)} />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Route</label>
                    <select className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500"
                      value={opt.route_type} onChange={e => updOpt(i, 'route_type', e.target.value)}>
                      {Object.entries(ROUTE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2 sm:col-span-4">
                    {opt.route_type === 'ring_group' && (
                      <>
                        <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Ring Group</label>
                        <select className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500"
                          value={opt.ring_group ?? ''} onChange={e => updOpt(i, 'ring_group', e.target.value)}>
                          <option value="">— নির্বাচন —</option>
                          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                      </>
                    )}
                    {opt.route_type === 'agent' && (
                      <>
                        <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Agent</label>
                        <select className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500"
                          value={opt.agent ?? ''} onChange={e => updOpt(i, 'agent', e.target.value)}>
                          <option value="">— নির্বাচন —</option>
                          {agents.map(a => <option key={a.id} value={a.id}>{a.display_name} ({a.extension})</option>)}
                        </select>
                      </>
                    )}
                    {opt.route_type === 'forward' && (
                      <>
                        <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">নম্বর</label>
                        <input className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500"
                          value={opt.forward_number} onChange={e => updOpt(i, 'forward_number', e.target.value)} />
                      </>
                    )}
                    {(opt.route_type === 'voicemail' || opt.route_type === 'hangup') && (
                      <div className="text-xs text-gray-400 italic pt-5">{ROUTE_LABELS[opt.route_type]}</div>
                    )}
                  </div>
                  <div className="col-span-1 flex justify-center">
                    <button onClick={() => setOptions(p => p.filter((_, idx) => idx !== i))}
                      className="w-7 h-7 flex items-center justify-center rounded-lg bg-rose-50 text-rose-500 hover:bg-rose-100 text-lg leading-none">
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={() => setOptions(p => [...p, { ...EMPTY_OPTION, order: p.length + 1 }])}
              className="text-sm text-teal-600 hover:text-teal-800 font-semibold mb-5">
              + অপশন যোগ করুন
            </button>

            <div className="flex justify-end gap-2">
              <button onClick={() => setModal(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">বাতিল</button>
              <button onClick={handleSaveOptions} disabled={saving}
                className="px-4 py-2 text-sm rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold disabled:opacity-50">
                {saving ? 'সংরক্ষণ হচ্ছে…' : 'সংরক্ষণ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Greeting Modal */}
      {modal === 'greeting' && activeMenu && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-sm p-6">
            <h2 className="text-base font-bold text-gray-800 mb-1">{activeMenu.name} — Greeting</h2>
            {activeMenu.greeting_file && (
              <p className="text-xs text-emerald-600 mb-3">বর্তমান: {activeMenu.greeting_file}</p>
            )}
            <p className="text-xs text-gray-500 mb-4">
              অডিও আপলোড করুন (MP3/WAV/WebM)। Server 8kHz mono WAV-এ convert করবে।
            </p>
            <input ref={fileRef} type="file" accept="audio/*" className="hidden"
              onChange={e => setAudioFile(e.target.files[0])} />
            <button onClick={() => fileRef.current.click()}
              className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-teal-400 hover:text-teal-600 transition-colors">
              {audioFile ? audioFile.name : 'ক্লিক করে ফাইল নির্বাচন করুন'}
            </button>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setModal(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">বাতিল</button>
              <button onClick={handleUploadGreeting} disabled={uploading}
                className="px-4 py-2 text-sm rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold disabled:opacity-50">
                {uploading ? 'আপলোড হচ্ছে…' : 'আপলোড'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
