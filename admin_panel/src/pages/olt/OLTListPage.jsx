import { useEffect, useMemo, useState } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const VENDORS = [
  { value: 'vsol', label: 'V-SOL' },
  { value: 'huawei', label: 'Huawei' },
  { value: 'zte', label: 'ZTE' },
  { value: 'bdcom', label: 'BDCOM' },
  { value: 'other', label: 'Other' },
];

const EMPTY_FORM = {
  name: '',
  vendor: 'vsol',
  ip_address: '',
  snmp_community: 'public',
  snmp_version: '2c',
  model: '',
  fw_version: 'auto',
  rx_snmp_oid: '',
  location: '',
  mgmt_proto: 'telnet',
  telnet_port: 23,
  ssh_port: 22,
  username: '',
  password: '',
  enable_password: '',
  prompt_regex: '',
  is_active: true,
};

/* OLT-এর DateTime সেট করার বাটন (CLI দিয়ে, ম্যানুয়াল-only)।
 *
 * লোডিং ডিজাইন: ব্যস্ত অবস্থায় ঘড়ির আইকন ঘুরতে থাকে, লেবেল বদলে
 * "Setting…" হয়, এবং বাটনের নিচে একটা indeterminate progress bar বাঁ→ডান
 * চলতে থাকে — কাজটি ~৩ সেকেন্ড নেয় (আসল ডিভাইসে Telnet সেশন), তাই
 * স্পষ্ট feedback জরুরি নইলে ব্যবহারকারী আবার ক্লিক করে ফেলে।
 */
function ClockButton({ olt, busy, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={`${olt.display_name || olt.name} — ডিভাইসের সময় এই সার্ভারের সময়ে সেট করুন`}
      aria-busy={busy}
      className={`relative overflow-hidden px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors
        ${busy
          ? 'bg-amber-50 text-amber-700 border-amber-300 cursor-wait'
          : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'}`}
    >
      <span className="inline-flex items-center gap-1.5">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round"
             className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`}>
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15.5 14" />
        </svg>
        {busy ? 'Setting…' : 'Set Time'}
      </span>
      {busy && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-amber-200">
          <span className="block h-full w-1/3 bg-amber-500 animate-[oltclock_1.1s_ease-in-out_infinite]" />
        </span>
      )}
    </button>
  );
}

function StatusPill({ active }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function SyncPill({ olt }) {
  if (!olt.last_sync_at) {
    return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">Never synced</span>;
  }
  const ok = olt.last_sync_status === 'success';
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${ok ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>
      {ok ? `Synced ${olt.last_sync_count || 0}` : 'Sync failed'}
    </span>
  );
}

function OLTModal({ olt, onClose, onSaved }) {
  const isEdit = !!olt;
  const [form, setForm] = useState(isEdit ? { ...EMPTY_FORM, ...olt, password: '', enable_password: '' } : EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState('');
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagResult, setDiagResult] = useState(null);
  const [rxSyncing, setRxSyncing] = useState(false);

  const set = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
    if (['ip_address', 'telnet_port'].includes(name)) setDetected('');
  };

  const detectPrompt = async () => {
    if (!form.ip_address) {
      toast.error('OLT IP দিন।');
      return;
    }
    setDetecting(true);
    setDetected('');
    try {
      const res = await api.post('/olt/olts/detect-prompt/', {
        host: form.ip_address,
        port: form.mgmt_proto === 'ssh' ? form.ssh_port : form.telnet_port,
      });
      setDetected(res.data.detected);
      toast.success('Prompt detected.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Prompt detect failed.');
    } finally {
      setDetecting(false);
    }
  };

  const diagnoseRx = async () => {
    if (!isEdit) return;
    setDiagnosing(true);
    setDiagResult(null);
    try {
      const res = await api.get(`/olt/olts/${olt.id}/diagnose-rx-oids/`);
      setDiagResult(res.data);
      if (res.data.working_oids?.length > 0) {
        toast.success(`কাজ করছে: ${res.data.working_oids[0]}`);
      } else {
        toast.error('কোনো RX OID থেকে ডেটা পাওয়া যায়নি।');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Diagnose failed.');
    } finally {
      setDiagnosing(false);
    }
  };

  const applyDiagOid = (oid) => {
    setForm((f) => ({ ...f, rx_snmp_oid: oid, fw_version: 'auto' }));
    setDiagResult(null);
    toast.success('OID সেট হয়েছে — Save করুন।');
  };

  // শুধু fallback: SNMP-এ কোনো RX OID কাজ না করলে (diagnose scan-এ working_oids
  // খালি এলে) এই OLT-এর জন্য web UI scrape দিয়ে RX আনা হয় — সাধারণ ব্যবহারে দরকার হয় না
  // কারণ SNMP auto-sync (প্রতি ৫ মিনিট) সব OLT-এর RX ইতিমধ্যে কভার করে।
  const runRxSync = async () => {
    if (!isEdit) return;
    setRxSyncing(true);
    try {
      const res = await api.post(`/olt/olts/${olt.id}/sync-rx/`);
      toast.success(res.data.message || 'RX sync completed.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'RX sync failed.');
    } finally {
      setRxSyncing(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        telnet_port: Number(form.telnet_port) || 23,
        ssh_port: Number(form.ssh_port) || 22,
      };
      if (isEdit && !payload.password) delete payload.password;
      if (isEdit && !payload.enable_password) delete payload.enable_password;
      if (isEdit) await api.patch(`/olt/olts/${olt.id}/`, payload);
      else await api.post('/olt/olts/', payload);
      toast.success(isEdit ? 'OLT updated.' : 'OLT added.');
      onSaved();
    } catch (err) {
      const data = err.response?.data;
      toast.error(data ? Object.values(data).flat().join(' | ') : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{isEdit ? 'Edit OLT' : 'Add New OLT'}</h2>
            <p className="text-sm text-slate-500">SNMP এবং Telnet/SSH automation credential</p>
          </div>
          <button type="button" onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-slate-600">&times;</button>
        </div>

        <form onSubmit={save} className="space-y-5 p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label">OLT Name *</label>
              <input name="name" value={form.name} onChange={set} required className="input-field w-full" placeholder="Main POP OLT" />
            </div>
            <div>
              <label className="label">Vendor *</label>
              <select name="vendor" value={form.vendor} onChange={set} className="input-field w-full">
                {VENDORS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">OLT IP *</label>
              <input name="ip_address" value={form.ip_address} onChange={set} required className="input-field w-full font-mono" placeholder="192.168.130.2" />
            </div>
            <div>
              <label className="label">Model</label>
              <input name="model" value={form.model || ''} onChange={set} className="input-field w-full" placeholder="Optional" />
            </div>
          </div>

          <div className="grid gap-4 rounded-lg border border-slate-200 p-4 md:grid-cols-3">
            <div>
              <label className="label">SNMP Community *</label>
              <input name="snmp_community" value={form.snmp_community} onChange={set} required className="input-field w-full" />
            </div>
            <div>
              <label className="label">SNMP Version</label>
              <select name="snmp_version" value={form.snmp_version} onChange={set} className="input-field w-full">
                <option value="2c">2c</option>
                <option value="1">1</option>
                <option value="3">3</option>
              </select>
            </div>
            <div>
              <label className="label">Management</label>
              <select name="mgmt_proto" value={form.mgmt_proto} onChange={set} className="input-field w-full">
                <option value="telnet">Telnet</option>
                <option value="ssh">SSH</option>
                <option value="snmp">SNMP only</option>
              </select>
            </div>
          </div>

          {/* ── V-SOL Firmware / RX OID (vendor=vsol হলেই দেখাবে) ── */}
          {form.vendor === 'vsol' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
              <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">
                📡 V-SOL Firmware / RX Power SNMP
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="label">Firmware Version</label>
                  <select name="fw_version" value={form.fw_version} onChange={set} className="input-field w-full">
                    <option value="auto">Auto-detect (সুপারিশকৃত)</option>
                    <option value="v1">V1 — পুরনো firmware (string dBm)</option>
                    <option value="v2">V2 — নতুন firmware (integer ÷100)</option>
                  </select>
                  <p className="mt-1 text-xs text-amber-700">
                    নতুন OLT-এ RX Signal না দেখালে <strong>Auto</strong> অথবা <strong>V2</strong> সিলেক্ট করুন।
                  </p>
                </div>
                <div>
                  <label className="label">
                    Custom RX OID{' '}
                    <span className="font-normal text-slate-400">(ফাঁকা = default)</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      name="rx_snmp_oid"
                      value={form.rx_snmp_oid || ''}
                      onChange={set}
                      className="input-field w-full font-mono text-xs"
                      placeholder="1.3.6.1.4.1.37950.1.1.5.12.2.1.8.1.7"
                    />
                    {isEdit && (
                      <button
                        type="button"
                        onClick={diagnoseRx}
                        disabled={diagnosing}
                        className="btn-secondary whitespace-nowrap text-xs"
                        title="কোন RX OID কাজ করছে খুঁজে বের করো"
                      >
                        {diagnosing ? 'Scanning...' : '🔍 Scan'}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Diagnose result */}
              {diagResult && (
                <div className="rounded-lg border border-amber-300 bg-white p-3 space-y-2 text-xs">
                  <p className="font-semibold text-slate-700">
                    🔎 Scan ফলাফল — {diagResult.olt} ({diagResult.ip})
                  </p>
                  <p className={`font-medium ${diagResult.working_oids?.length > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {diagResult.recommendation}
                  </p>
                  {Object.entries(diagResult.details).map(([oid, info]) => (
                    <div key={oid} className={`flex items-start gap-3 rounded p-2 ${info.count > 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-50'}`}>
                      <div className="flex-1">
                        <span className="font-mono text-slate-600 break-all">{oid}</span>
                        <span className={`ml-2 font-bold ${info.count > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
                          {info.count > 0 ? `✓ ${info.count} rows` : '✗ no data'}
                        </span>
                        {info.count > 0 && (
                          <span className="ml-2 text-amber-700">
                            {info.integer_format ? '(integer ÷100 format)' : '(string dBm format)'}
                          </span>
                        )}
                        {info.sample?.length > 0 && (
                          <p className="mt-0.5 text-slate-500">
                            Sample: {info.sample.map((s) => `${s.raw} → ${s.parsed_dbm ?? 'null'} dBm`).join(', ')}
                          </p>
                        )}
                      </div>
                      {info.count > 0 && (
                        <button
                          type="button"
                          onClick={() => applyDiagOid(oid)}
                          className="shrink-0 rounded border border-emerald-400 bg-emerald-100 px-2 py-1 font-medium text-emerald-800 hover:bg-emerald-200"
                        >
                          Use this OID
                        </button>
                      )}
                    </div>
                  ))}

                  {/* SNMP-এ কিছু না পেলে HTTP web-UI fallback — শুধু এখানেই দরকার */}
                  {diagResult.working_oids?.length === 0 && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                      <p className="font-semibold text-red-800">
                        ⚠️ SNMP দিয়ে RX Power পাওয়া যাচ্ছে না
                      </p>
                      <p className="text-red-700">
                        এই OLT নতুন firmware ব্যবহার করছে। OLT-এর web UI (<code className="bg-red-100 px-1 rounded">ONU OPM Diag</code>) থেকে RX Power আনা হবে (SNMP OID কাজ না করলে এই একবারই দরকার হয়)।
                      </p>
                      <button
                        type="button"
                        onClick={runRxSync}
                        disabled={rxSyncing}
                        className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100"
                      >
                        {rxSyncing ? 'RX Syncing...' : '📡 OLT থেকে RX Sync করো'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid gap-4 rounded-lg border border-slate-200 p-4 md:grid-cols-4">
            <div>
              <label className="label">Telnet Port</label>
              <input name="telnet_port" type="number" min="1" max="65535" value={form.telnet_port} onChange={set} className="input-field w-full" />
            </div>
            <div>
              <label className="label">SSH Port</label>
              <input name="ssh_port" type="number" min="1" max="65535" value={form.ssh_port} onChange={set} className="input-field w-full" />
            </div>
            <div>
              <label className="label">Username</label>
              <input name="username" value={form.username || ''} onChange={set} className="input-field w-full" placeholder="admin" />
            </div>
            <div>
              <label className="label">Password {isEdit && <span className="font-normal text-slate-400">(blank = unchanged)</span>}</label>
              <input name="password" type="password" value={form.password} onChange={set} className="input-field w-full" />
            </div>
            <div className="md:col-span-2">
              <label className="label">Enable Password {isEdit && <span className="font-normal text-slate-400">(blank = unchanged)</span>}</label>
              <input name="enable_password" type="password" value={form.enable_password || ''} onChange={set} className="input-field w-full" />
            </div>
            <div className="md:col-span-2">
              <label className="label">Prompt Regex</label>
              <div className="flex gap-2">
                <input name="prompt_regex" value={form.prompt_regex || ''} onChange={set} className="input-field w-full font-mono" placeholder="/[#>:] $/" />
                <button type="button" onClick={detectPrompt} disabled={detecting} className="btn-secondary whitespace-nowrap">
                  {detecting ? 'Detecting...' : 'Detect'}
                </button>
              </div>
              {detected && <p className="mt-1 text-xs text-emerald-600">{detected}</p>}
            </div>
          </div>

          <div>
            <label className="label">Location / Notes</label>
            <textarea name="location" value={form.location || ''} onChange={set} rows={2} className="input-field w-full" placeholder="POP, rack, or area details" />
          </div>

          <label className="inline-flex cursor-pointer items-center gap-2">
            <input name="is_active" type="checkbox" checked={!!form.is_active} onChange={set} className="h-4 w-4 rounded border-slate-300" />
            <span className="text-sm font-medium text-slate-700">OLT is Active</span>
          </label>

          <div className="flex gap-3 border-t pt-4">
            <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Saving...' : isEdit ? 'Update OLT' : 'Save OLT'}</button>
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Mobile OLT Card ── */
function MobileOLTCard({ olt, runAction, busy, setModal, remove }) {
  const FRow = ({ label, children }) => (
    <div className="flex items-stretch border-b border-gray-200 last:border-0">
      <div className="w-20 shrink-0 bg-gray-50 px-3 py-2.5 flex items-center border-r border-gray-200">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex-1 min-w-0 px-3 py-2.5 flex items-center justify-end bg-white">{children}</div>
    </div>
  );
  return (
    <div className="rounded-xl border border-gray-200 shadow-sm overflow-hidden bg-white">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 px-3 py-2.5 bg-[#23445f]/5 border-b border-gray-200">
        <div className="min-w-0">
          <p className="font-bold text-gray-900 text-[13px] truncate">{olt.display_name || olt.name}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">{olt.model || olt.location || '—'}</p>
        </div>
        <StatusPill active={olt.is_active} />
      </div>
      {/* 2-column: Vendor | Host IP */}
      <div className="grid grid-cols-2 divide-x divide-gray-200 border-b border-gray-200">
        <div className="flex flex-col px-3 py-2.5">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Vendor</span>
          <span className="text-[12px] font-semibold text-gray-800 uppercase">{olt.vendor}</span>
        </div>
        <div className="flex flex-col px-3 py-2.5">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Host IP</span>
          <span className="text-[12px] font-mono font-semibold text-gray-800">{olt.ip_address}</span>
        </div>
      </div>
      {/* Sync pill */}
      <div>
        <FRow label="Sync"><SyncPill olt={olt} /></FRow>
      </div>
      {/* Action buttons */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50/60 border-t border-gray-200 flex-wrap">
        <button onClick={() => runAction(olt, 'test')} disabled={busy[`test-${olt.id}`]}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-cyan-50 text-cyan-700 border border-cyan-200 hover:bg-cyan-100 transition-colors">
          {busy[`test-${olt.id}`] ? 'Testing...' : 'Test'}
        </button>
        <button onClick={() => runAction(olt, 'sync')} disabled={busy[`sync-${olt.id}`]}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors">
          {busy[`sync-${olt.id}`] ? 'Syncing...' : 'Sync'}
        </button>
        <ClockButton olt={olt} busy={!!busy[`clock-${olt.id}`]}
                     onClick={() => runAction(olt, 'clock')} />
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => setModal(olt)}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100">Edit</button>
          <button onClick={() => remove(olt)} disabled={busy[`delete-${olt.id}`]}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 disabled:opacity-50">Delete</button>
        </div>
      </div>
    </div>
  );
}

export default function OLTListPage() {
  const [olts, setOlts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [query, setQuery] = useState('');
  const [vendor, setVendor] = useState('');
  const [busy, setBusy] = useState({});

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return olts.filter((olt) => {
      const matchesVendor = !vendor || olt.vendor === vendor;
      const blob = `${olt.display_name || olt.name} ${olt.name} ${olt.ip_address} ${olt.vendor} ${olt.model || ''} ${olt.location || ''}`.toLowerCase();
      return matchesVendor && (!q || blob.includes(q));
    });
  }, [olts, query, vendor]);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/olt/olts/'),
      api.get('/olt/olts/summary/').catch(() => ({ data: null })),
    ])
      .then(([list, stats]) => {
        setOlts(list.data.results || list.data);
        setSummary(stats.data);
      })
      .catch(() => toast.error('OLT list load failed.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const runAction = async (olt, action) => {
    setBusy((b) => ({ ...b, [`${action}-${olt.id}`]: true }));
    try {
      if (action === 'test') {
        const res = await api.post(`/olt/olts/${olt.id}/test-connection/`);
        toast.success(res.data.description || res.data.message);
      } else if (action === 'clock') {
        // CLI দিয়ে ডিভাইসের DateTime + timezone এই সার্ভারের সময়ে সেট করে।
        // ম্যানুয়াল-only — কোনো scheduled task নেই।
        const res = await api.post(`/olt/olts/${olt.id}/sync-clock/`);
        toast.success(`${olt.display_name || olt.name}: সময় সেট হয়েছে → ${res.data.server_time}`);
        load();
      } else {
        const res = await api.post(`/olt/olts/${olt.id}/sync-mac-table/`);
        toast.success(res.data.message || 'Sync completed.');
        load();
      }
    } catch (err) {
      toast.error(err.response?.data?.error || err.response?.data?.message || `${action} failed.`);
    } finally {
      setBusy((b) => ({ ...b, [`${action}-${olt.id}`]: false }));
    }
  };

  const remove = async (olt) => {
    if (!window.confirm(`Delete OLT "${olt.display_name || olt.name}"?`)) return;
    setBusy((b) => ({ ...b, [`delete-${olt.id}`]: true }));
    try {
      await api.delete(`/olt/olts/${olt.id}/`);
      toast.success('OLT deleted.');
      load();
    } catch {
      toast.error('Delete failed.');
    } finally {
      setBusy((b) => ({ ...b, [`delete-${olt.id}`]: false }));
    }
  };

  return (
    <div className="space-y-5">
      {modal && (
        <OLTModal
          olt={modal === 'add' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">OLT Management</h1>
          <p className="text-sm text-slate-500">OLT list, connection test, MAC table sync এবং ONU cache</p>
        </div>
        <button onClick={() => setModal('add')} className="btn-primary">+ Add New OLT</button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {[
          ['Total OLT', summary?.total ?? olts.length],
          ['Active', summary?.active ?? olts.filter((o) => o.is_active).length],
          ['MAC Cache', summary?.mac_rows ?? olts.reduce((n, o) => n + (o.mac_count || 0), 0)],
          ['ONU Signals', summary?.signals ?? summary?.onus ?? olts.reduce((n, o) => n + (o.onu_count || 0), 0)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{Number(value || 0).toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 flex-col gap-3 md:flex-row">
            <input value={query} onChange={(e) => setQuery(e.target.value)} className="input-field w-full md:max-w-sm" placeholder="Search name, IP, vendor..." />
            <select value={vendor} onChange={(e) => setVendor(e.target.value)} className="input-field w-full md:max-w-48">
              <option value="">All vendors</option>
              {VENDORS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </div>
          <button onClick={load} className="btn-secondary">Refresh</button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-slate-500">Loading OLTs...</div>
        ) : filtered.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-lg font-semibold text-slate-700">No OLT found.</p>
            <p className="mt-1 text-sm text-slate-400">Add OLT IP, SNMP community and Telnet/SSH credential to start automation.</p>
          </div>
        ) : (
          <>
          {/* ── Mobile Card List (< md) ── */}
          <div className="md:hidden space-y-2 p-3">
            {filtered.map(olt => (
              <MobileOLTCard key={olt.id} olt={olt}
                runAction={runAction} busy={busy} setModal={setModal} remove={remove} />
            ))}
          </div>
          {/* ── Desktop Table (md+) ── */}
          <div className="hidden md:block overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-[#23445f] text-left text-xs uppercase tracking-wide text-white">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Vendor</th>
                  <th className="px-4 py-3">Host IP</th>
                  <th className="px-4 py-3">Connection</th>
                  <th className="px-4 py-3">Sync</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filtered.map((olt) => (
                  <tr key={olt.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">{olt.display_name || olt.name}</p>
                      <p className="text-xs text-slate-400">{olt.model || olt.location || 'No model/location set'}</p>
                    </td>
                    <td className="px-4 py-3 font-medium uppercase text-slate-700">{olt.vendor}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">{olt.ip_address}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => runAction(olt, 'test')} disabled={busy[`test-${olt.id}`]} className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-1.5 font-medium text-cyan-700 hover:bg-cyan-100">
                        {busy[`test-${olt.id}`] ? 'Testing...' : 'Test'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => runAction(olt, 'sync')} disabled={busy[`sync-${olt.id}`]} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 font-medium text-blue-700 hover:bg-blue-100">
                          {busy[`sync-${olt.id}`] ? 'Syncing...' : 'Sync'}
                        </button>
                        <SyncPill olt={olt} />
                      </div>
                    </td>
                    <td className="px-4 py-3"><StatusPill active={olt.is_active} /></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <ClockButton olt={olt} busy={!!busy[`clock-${olt.id}`]}
                                     onClick={() => runAction(olt, 'clock')} />
                        <button onClick={() => setModal(olt)} className="btn-secondary px-3 py-1.5 text-blue-600">Edit</button>
                        <button onClick={() => remove(olt)} disabled={busy[`delete-${olt.id}`]} className="btn-secondary px-3 py-1.5 text-red-600">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
