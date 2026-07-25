import { useEffect, useState } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

/* ── Icons ── */
const Spinner = () => (
  <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);
const CheckIcon = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);
const XIcon = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);
const WifiIcon = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
  </svg>
);

/* ── Test Button ── */
function TestBtn({ onTest, label = 'Test' }) {
  const [phase, setPhase] = useState('idle');
  const run = async () => {
    setPhase('testing');
    const ok = await onTest();
    setPhase(ok ? 'ok' : 'fail');
    setTimeout(() => setPhase('idle'), 2500);
  };
  const cfg = {
    idle:    { cls: 'bg-white hover:bg-slate-50 text-slate-600 border-slate-300', icon: <WifiIcon />, text: label },
    testing: { cls: 'bg-blue-50 text-blue-500 border-blue-200 cursor-not-allowed', icon: <Spinner />, text: 'Testing…' },
    ok:      { cls: 'bg-emerald-50 text-emerald-700 border-emerald-300', icon: <CheckIcon />, text: 'Connected' },
    fail:    { cls: 'bg-red-50 text-red-700 border-red-300', icon: <XIcon />, text: 'Failed' },
  }[phase];
  return (
    <button onClick={run} disabled={phase === 'testing'}
      className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md border transition-all ${cfg.cls}`}>
      {cfg.icon}<span>{cfg.text}</span>
    </button>
  );
}

/* ── FRow (mobile card label|value) ── */
const FRow = ({ label, children }) => (
  <div className="flex items-stretch border-b border-gray-100 last:border-0">
    <div className="w-28 shrink-0 bg-gray-50 px-3 py-2 flex items-center border-r border-gray-100">
      <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
    </div>
    <div className="flex-1 min-w-0 px-3 py-2 flex items-center text-xs text-gray-700">{children}</div>
  </div>
);

/* ── Shared Status Badges ── */
const DB_STATUS = {
  ok:      'bg-green-100 text-green-700',
  failed:  'bg-red-100 text-red-700',
  unknown: 'bg-gray-100 text-gray-500',
};
const DB_LABEL = { ok: 'DB: OK', failed: 'DB: Failed', unknown: 'DB: Unknown' };

/* ═══════════════════════════════════════════════
   ① RADIUS SERVER
═══════════════════════════════════════════════ */

/* Quick Setup */
function QuickSetup({ onSaved }) {
  const [secret, setSecret]   = useState('');
  const [defaults, setDefaults] = useState(null);
  const [step, setStep]       = useState('idle');
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    api.get('/radius/auto-detect/').then(r => setDefaults(r.data)).catch(() => {});
  }, []);

  const handleTest = async () => {
    if (!secret) { toast.error('Enter Shared Secret.'); return; }
    setStep('testing'); setTestResult(null);
    try {
      const res = await api.post('/radius/quick-test/', { ...defaults, db_password: defaults?.db_password || '' });
      setTestResult({ ok: true, msg: res.data.message, version: res.data.db_version, users: res.data.user_count });
    } catch (err) {
      setTestResult({ ok: false, msg: err.response?.data?.message || 'Connection failed.' });
    } finally { setStep('idle'); }
  };

  const handleSave = async () => {
    if (!secret) { toast.error('Enter Shared Secret.'); return; }
    setStep('saving');
    try {
      await api.post('/radius/servers/', {
        ...defaults, db_password: defaults?.db_password || '',
        shared_secret: secret, is_default: true, is_active: true,
        description: 'Created via Quick Setup',
      });
      toast.success('RADIUS server configured!');
      setStep('done'); onSaved();
    } catch (err) {
      const data = err.response?.data;
      toast.error(data ? Object.values(data).flat().join(' | ') : 'Failed to save.');
      setStep('idle');
    }
  };

  if (!defaults) return <div className="bg-white rounded-xl border border-gray-200 shadow-sm h-32 flex items-center justify-center text-gray-400 animate-pulse">Loading...</div>;

  return (
    <div className="bg-blue-50/40 border-2 border-blue-100 rounded-xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-lg font-bold">⚡</div>
        <div>
          <h3 className="text-base font-bold text-gray-900">Quick Setup</h3>
          <p className="text-xs text-gray-500">Enter Shared Secret — everything else is automated</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3 p-3 bg-white rounded-lg border text-sm">
        <div><span className="text-gray-400">DB Host:</span> <span className="font-medium">{defaults.db_host}:{defaults.db_port}</span></div>
        <div><span className="text-gray-400">Database:</span> <span className="font-medium">{defaults.db_name}</span></div>
        <div><span className="text-gray-400">DB User:</span> <span className="font-medium">{defaults.db_user}</span></div>
        <div><span className="text-gray-400">RADIUS Host:</span> <span className="font-medium">{defaults.radius_host}</span></div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="label">Auth Port</label>
          <input type="number" value={defaults.radius_auth_port}
            onChange={e => setDefaults(d => ({ ...d, radius_auth_port: parseInt(e.target.value) || 1812 }))}
            className="input-field w-full" />
        </div>
        <div>
          <label className="label">Acct Port</label>
          <input type="number" value={defaults.radius_acct_port}
            onChange={e => setDefaults(d => ({ ...d, radius_acct_port: parseInt(e.target.value) || 1813 }))}
            className="input-field w-full" />
        </div>
      </div>
      <div className="mb-3">
        <label className="label">DB Password</label>
        <input type="password" value={defaults.db_password || ''}
          onChange={e => setDefaults(d => ({ ...d, db_password: e.target.value }))}
          className="input-field w-full" placeholder="DB password" />
      </div>
      <div className="mb-4">
        <label className="label">Shared Secret <span className="text-red-500">*</span>
          <span className="text-gray-400 font-normal ml-1 text-xs">(from FreeRADIUS clients.conf)</span>
        </label>
        <input type="text" value={secret} onChange={e => setSecret(e.target.value)}
          className="input-field w-full font-mono" placeholder="e.g. 010230" />
        <p className="text-xs text-gray-400 mt-1">
          Terminal: <code className="bg-gray-100 px-1 rounded">sudo grep secret /etc/freeradius/clients.conf</code>
        </p>
      </div>
      {testResult && (
        <div className={`mb-3 p-3 rounded-lg text-sm ${testResult.ok ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          {testResult.ok
            ? <p className="text-green-700">✓ {testResult.msg} — MySQL {testResult.version} / {testResult.users} users</p>
            : <p className="text-red-700">✗ {testResult.msg}</p>}
        </div>
      )}
      <div className="flex gap-3">
        <button onClick={handleTest} disabled={step !== 'idle'} className="btn-secondary flex-1 py-2">
          {step === 'testing' ? 'Testing...' : 'DB Test'}
        </button>
        <button onClick={handleSave} disabled={step !== 'idle' || !testResult?.ok}
          className={`flex-1 py-2 rounded-lg font-medium ${testResult?.ok ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
          {step === 'saving' ? 'Saving...' : '✓ Configure & Save'}
        </button>
      </div>
    </div>
  );
}

/* RADIUS Modal */
const RADIUS_EMPTY = {
  name: '', server_type: 'local',
  db_host: 'localhost', db_port: 3306, db_name: 'radius', db_user: 'radius', db_password: '',
  radius_host: 'localhost', radius_auth_port: 1812, radius_acct_port: 1813, shared_secret: '',
  is_active: true, is_default: false, description: '',
};

function RadiusModal({ server, onClose, onSaved }) {
  const isEdit = !!server;
  const [form, setForm]   = useState(server ? { ...server, db_password: '', shared_secret: '' } : { ...RADIUS_EMPTY });
  const [testing, setTesting]   = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving]   = useState(false);

  const set = e => {
    const { name, value, type, checked } = e.target;
    setForm(f => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
    setTestResult(null);
  };

  const test = async () => {
    setTesting(true); setTestResult(null);
    try {
      const res = await api.post('/radius/quick-test/', form);
      setTestResult({ ok: true, msg: res.data.message, version: res.data.db_version, users: res.data.user_count });
    } catch (err) {
      setTestResult({ ok: false, msg: err.response?.data?.message || 'Connection failed.' });
    } finally { setTesting(false); }
  };

  const save = async e => {
    e.preventDefault(); setSaving(true);
    try {
      const payload = { ...form };
      if (isEdit && !payload.db_password) delete payload.db_password;
      if (isEdit && !payload.shared_secret) delete payload.shared_secret;
      if (isEdit) await api.patch(`/radius/servers/${server.id}/`, payload);
      else await api.post('/radius/servers/', payload);
      toast.success(isEdit ? 'Updated successfully.' : 'RADIUS server added.');
      onSaved();
    } catch (err) {
      const data = err.response?.data;
      toast.error(data ? Object.values(data).flat().join(' | ') : 'Failed to save.');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-bold">{isEdit ? 'Edit RADIUS Server' : 'New RADIUS Server'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
        </div>
        <form onSubmit={save} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Server Name *</label>
              <input name="name" value={form.name} onChange={set} required className="input-field w-full" placeholder="Primary RADIUS" /></div>
            <div><label className="label">Type</label>
              <select name="server_type" value={form.server_type} onChange={set} className="input-field w-full">
                <option value="local">Local (this server)</option>
                <option value="remote">Remote (another server)</option>
              </select></div>
          </div>
          <fieldset className="border rounded-lg p-4">
            <legend className="text-xs font-semibold text-gray-500 px-2 uppercase tracking-wide">MySQL DB</legend>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div><label className="label">Host</label><input name="db_host" value={form.db_host} onChange={set} className="input-field w-full" /></div>
              <div><label className="label">Port</label><input name="db_port" type="number" value={form.db_port} onChange={set} className="input-field w-full" /></div>
              <div><label className="label">Database</label><input name="db_name" value={form.db_name} onChange={set} className="input-field w-full" /></div>
              <div><label className="label">User</label><input name="db_user" value={form.db_user} onChange={set} className="input-field w-full" /></div>
              <div className="col-span-2">
                <label className="label">Password {isEdit && <span className="text-gray-400 font-normal">(blank = unchanged)</span>}</label>
                <input name="db_password" type="password" value={form.db_password} onChange={set}
                  required={!isEdit} className="input-field w-full" placeholder="••••••••" />
              </div>
            </div>
          </fieldset>
          <fieldset className="border rounded-lg p-4">
            <legend className="text-xs font-semibold text-gray-500 px-2 uppercase tracking-wide">FreeRADIUS</legend>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div><label className="label">RADIUS Host</label><input name="radius_host" value={form.radius_host} onChange={set} className="input-field w-full" /></div>
              <div><label className="label">Auth Port</label><input name="radius_auth_port" type="number" value={form.radius_auth_port} onChange={set} className="input-field w-full" /></div>
              <div><label className="label">Acct Port</label><input name="radius_acct_port" type="number" value={form.radius_acct_port} onChange={set} className="input-field w-full" /></div>
              <div><label className="label">Shared Secret {isEdit && <span className="text-gray-400 font-normal">(optional)</span>}</label>
                <input name="shared_secret" value={form.shared_secret} onChange={set} className="input-field w-full font-mono" placeholder="010230" /></div>
            </div>
          </fieldset>
          {testResult && (
            <div className={`p-3 rounded-lg text-sm ${testResult.ok ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
              {testResult.ok
                ? <p className="text-green-700">✓ {testResult.msg} — MySQL {testResult.version} / {testResult.users} users</p>
                : <p className="text-red-700">✗ {testResult.msg}</p>}
            </div>
          )}
          <div><label className="label">Description</label>
            <textarea name="description" value={form.description} onChange={set} rows={2} className="input-field w-full" /></div>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input type="checkbox" name="is_active" checked={form.is_active} onChange={set} className="w-4 h-4" /> Active</label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input type="checkbox" name="is_default" checked={form.is_default} onChange={set} className="w-4 h-4" /> Default Server</label>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={test} disabled={testing} className="btn-secondary py-2 px-4">
              {testing ? 'Testing...' : 'DB Test'}</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 py-2">
              {saving ? 'Saving...' : isEdit ? 'Update' : 'Add'}</button>
            <button type="button" onClick={onClose} className="btn-secondary py-2 px-4">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* RADIUS Server Row (desktop) */
function RadiusRow({ server, idx, onEdit, onDeleted, onRefresh }) {
  const [deleting, setDeleting] = useState(false);
  const doTest = async () => {
    try { const res = await api.post(`/radius/servers/${server.id}/test-connection/`); toast.success(res.data.message); onRefresh(); return true; }
    catch (err) { toast.error(err.response?.data?.message || 'Test failed.'); onRefresh(); return false; }
  };
  const setDefault = async () => {
    try { await api.post(`/radius/servers/${server.id}/set-default/`); toast.success(`${server.name} is now default.`); onRefresh(); }
    catch { toast.error('Failed to set default.'); }
  };
  const del = async () => {
    if (!window.confirm(`Delete "${server.name}"?`)) return;
    setDeleting(true);
    try { await api.delete(`/radius/servers/${server.id}/`); toast.success('Deleted.'); onDeleted(); }
    catch { toast.error('Failed to delete.'); }
    finally { setDeleting(false); }
  };
  const dbCls = DB_STATUS[server.last_test_status] || DB_STATUS.unknown;
  const dbLbl = DB_LABEL[server.last_test_status] || DB_LABEL.unknown;
  return (
    <tr className={idx % 2 === 0 ? 'bg-white hover:bg-blue-50/30' : 'bg-gray-50/60 hover:bg-blue-50/30'}>
      <td className="px-4 py-3 font-semibold text-gray-800 text-sm whitespace-nowrap">
        {server.name}
        <div className="flex gap-1 mt-1 flex-wrap">
          {server.is_default && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold">Default</span>}
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${server.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {server.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-gray-600 font-mono whitespace-nowrap">{server.radius_host}</td>
      <td className="px-4 py-3 text-sm text-gray-600 font-mono whitespace-nowrap">{server.radius_auth_port} / {server.radius_acct_port}</td>
      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{server.db_user}@{server.db_host}/{server.db_name}</td>
      <td className="px-4 py-3">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${dbCls}`}>{dbLbl}</span>
      </td>
      <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
        {server.last_tested ? new Date(server.last_tested).toLocaleString() : '—'}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5 justify-end flex-wrap">
          <TestBtn onTest={doTest} label="DB Test" />
          {!server.is_default && (
            <button onClick={setDefault} className="text-xs px-2.5 py-1 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 font-medium">Set Default</button>
          )}
          <button onClick={onEdit} className="text-xs px-2.5 py-1 rounded-md bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200 font-medium">Edit</button>
          <button onClick={del} disabled={deleting} className="text-xs px-2.5 py-1 rounded-md bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 font-medium">Delete</button>
        </div>
      </td>
    </tr>
  );
}

/* RADIUS Mobile Card */
function RadiusMobileCard({ server, idx, onEdit, onDeleted, onRefresh }) {
  const [deleting, setDeleting] = useState(false);
  const doTest = async () => {
    try { const res = await api.post(`/radius/servers/${server.id}/test-connection/`); toast.success(res.data.message); onRefresh(); return true; }
    catch (err) { toast.error(err.response?.data?.message || 'Test failed.'); onRefresh(); return false; }
  };
  const setDefault = async () => {
    try { await api.post(`/radius/servers/${server.id}/set-default/`); toast.success(`${server.name} is now default.`); onRefresh(); }
    catch { toast.error('Failed to set default.'); }
  };
  const del = async () => {
    if (!window.confirm(`Delete "${server.name}"?`)) return;
    setDeleting(true);
    try { await api.delete(`/radius/servers/${server.id}/`); toast.success('Deleted.'); onDeleted(); }
    catch { toast.error('Failed to delete.'); }
    finally { setDeleting(false); }
  };
  const dbCls = DB_STATUS[server.last_test_status] || DB_STATUS.unknown;
  const dbLbl = DB_LABEL[server.last_test_status] || DB_LABEL.unknown;
  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${idx % 2 === 0 ? 'bg-white border-gray-200' : 'bg-slate-50/40 border-gray-200'}`}>
      <div className="flex items-start justify-between gap-2 px-3 py-2.5 border-b border-gray-200" style={{ backgroundColor: 'rgba(35,68,95,0.06)' }}>
        <div className="min-w-0">
          <p className="font-bold text-gray-900 text-[13px] truncate">{server.name}</p>
          <div className="flex gap-1 mt-0.5 flex-wrap">
            {server.is_default && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold">Default</span>}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${server.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {server.is_active ? 'Active' : 'Inactive'}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${dbCls}`}>{dbLbl}</span>
          </div>
        </div>
      </div>
      <FRow label="RADIUS Host"><span className="font-mono">{server.radius_host}</span></FRow>
      <FRow label="Auth / Acct"><span className="font-mono">{server.radius_auth_port} / {server.radius_acct_port}</span></FRow>
      <FRow label="DB"><span className="font-mono text-[11px]">{server.db_user}@{server.db_host}/{server.db_name}</span></FRow>
      <FRow label="Last Test"><span>{server.last_tested ? new Date(server.last_tested).toLocaleString() : '—'}</span></FRow>
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2.5 bg-gray-50/60 border-t border-gray-200">
        <TestBtn onTest={doTest} label="DB Test" />
        {!server.is_default && (
          <button onClick={setDefault} className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100">Set Default</button>
        )}
        <button onClick={onEdit} className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100">Edit</button>
        <button onClick={del} disabled={deleting} className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100">Delete</button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   ② MIKROTIK ROUTERS
═══════════════════════════════════════════════ */
const MTK_EMPTY = { host: '', port: 8728, username: 'admin', password: '', description: '', is_active: true };

function MikrotikModal({ server, onClose, onSaved }) {
  const isEdit = !!server;
  const [form, setForm]         = useState(isEdit ? { ...server, password: '' } : { ...MTK_EMPTY });
  const [verified, setVerified] = useState(isEdit ? { name: server.name } : null);
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving]     = useState(false);
  const handleChange = e => {
    const { name, value, type, checked } = e.target;
    setForm(f => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
    if (!isEdit && ['host', 'port', 'username', 'password'].includes(name)) setVerified(null);
  };

  const verify = async () => {
    if (!form.host || !form.username || !form.password) { toast.error('Enter Host, Username and Password.'); return; }
    setVerifying(true);
    try {
      const res = await api.post('/mikrotik/fetch-router-info/', {
        host: form.host, port: form.port, username: form.username, password: form.password,
      });
      setVerified(res.data.info);
      toast.success(`Connected! Router: ${res.data.info.name}`);
    } catch (err) {
      setVerified(null);
      toast.error(err.response?.data?.error || 'Could not connect to router.');
    } finally { setVerifying(false); }
  };

  const handleSubmit = async e => {
    e.preventDefault();
    if (!isEdit && !verified) { toast.error('Click "Verify Router" first.'); return; }
    setSaving(true);
    try {
      const payload = { ...form, name: verified?.name || server?.name };
      if (isEdit && !payload.password) delete payload.password;
      if (isEdit) {
        await api.patch(`/mikrotik/servers/${server.id}/`, payload);
        toast.success('Router updated.');
      } else {
        const res = await api.post('/mikrotik/servers/', payload);
        const rc = res.data.radius_auto_config;
        if (rc?.configured) toast.success(`"${payload.name}" added. RADIUS (${rc.radius_server}) configured.`);
        else { toast.success(`"${payload.name}" added.`); if (rc?.message) toast.error(`RADIUS: ${rc.message}`, { duration: 5000 }); }
      }
      onSaved();
    } catch (err) {
      const data = err.response?.data;
      toast.error(data ? Object.values(data).flat().join(' | ') : 'Failed to save.');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-bold text-gray-900">{isEdit ? 'Edit Router' : 'Add Mikrotik Router'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Host / IP *</label>
              <input name="host" value={form.host} onChange={handleChange} required className="input-field w-full" placeholder="192.168.1.1" /></div>
            <div><label className="label">API Port</label>
              <input name="port" type="number" value={form.port} onChange={handleChange} className="input-field w-full" min="1" max="65535" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Username *</label>
              <input name="username" value={form.username} onChange={handleChange} required className="input-field w-full" placeholder="admin" /></div>
            <div><label className="label">Password *{isEdit && <span className="text-gray-400 font-normal text-xs ml-1">(blank = unchanged)</span>}</label>
              <input name="password" type="password" value={form.password} onChange={handleChange}
                required={!isEdit} className="input-field w-full" placeholder="••••••••" /></div>
          </div>
          {!isEdit && (
            <button type="button" onClick={verify} disabled={verifying}
              className={`w-full py-2 rounded-lg font-medium transition-colors border ${
                verified ? 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100'
                         : 'bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100'}`}>
              {verifying ? 'Connecting...' : verified ? '✓ Verified — re-verify' : '→ Verify Router'}
            </button>
          )}
          {verified && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-1">
              <p className="text-sm font-semibold text-green-800">Router Connected:</p>
              <p className="text-sm text-green-700">Name: <span className="font-bold">{verified.name}</span></p>
              {verified.model && <p className="text-sm text-green-700">Model: {verified.model}</p>}
              {verified.version && <p className="text-sm text-green-700">RouterOS: {verified.version}</p>}
              {!isEdit && <p className="text-xs text-green-600 border-t border-green-200 pt-2 mt-1">
                Default RADIUS server will be configured automatically on save.
              </p>}
            </div>
          )}
          <div><label className="label">Description</label>
            <textarea name="description" value={form.description} onChange={handleChange} rows={2}
              className="input-field w-full" placeholder="Optional..." /></div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" name="is_active" checked={form.is_active} onChange={handleChange} className="w-4 h-4" />
            <span className="text-sm text-gray-700">Active</span>
          </label>
          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={saving || (!isEdit && !verified)}
              className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                !isEdit && !verified ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                     : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
              {saving ? 'Saving...' : isEdit ? 'Update' : 'Add Router'}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          </div>
          {!isEdit && !verified && <p className="text-xs text-center text-gray-400">Click "Verify Router" first, then save.</p>}
        </form>
      </div>
    </div>
  );
}

/* RADIUS Badge on Mikrotik */
function RadiusBadge({ server, onConfigured }) {
  const [loading, setLoading] = useState(false);
  const configure = async () => {
    setLoading(true);
    try { const res = await api.post(`/mikrotik/servers/${server.id}/configure-radius/`); toast.success(res.data.message); onConfigured(); }
    catch (err) { toast.error(err.response?.data?.error || 'RADIUS configure failed.'); }
    finally { setLoading(false); }
  };
  if (server.radius_configured) return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
      RADIUS: {server.radius_server_name || 'Configured'}
    </span>
  );
  return (
    <button onClick={configure} disabled={loading}
      className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-semibold hover:bg-orange-200 transition-colors">
      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 inline-block" />
      {loading ? 'Configuring...' : 'Configure RADIUS'}
    </button>
  );
}

/* Mikrotik Row (desktop) */
function MikrotikRow({ server, idx, onEdit, onRefresh }) {
  const [traffic, setTraffic]   = useState(null);
  const [deleting, setDeleting] = useState(false);

  const doTest = async () => {
    try { const res = await api.post(`/mikrotik/servers/${server.id}/test-connection/`); toast.success(res.data.message); return true; }
    catch (err) { toast.error(err.response?.data?.message || 'Test failed.'); return false; }
  };
  const checkTraffic = async () => {
    try { const res = await api.get(`/mikrotik/servers/${server.id}/live-traffic/`); setTraffic(res.data); }
    catch { toast.error('Failed to fetch traffic data.'); }
  };
  const createBackup = async () => {
    try { const res = await api.post(`/mikrotik/servers/${server.id}/create-backup/`); toast.success(res.data.message); }
    catch { toast.error('Backup failed.'); }
  };
  const importUsers = async () => {
    try { const res = await api.post(`/mikrotik/servers/${server.id}/import-users/`); toast.success(res.data.message); }
    catch { toast.error('Import failed.'); }
  };
  const del = async () => {
    if (!window.confirm(`Delete "${server.name}"?`)) return;
    setDeleting(true);
    try { await api.delete(`/mikrotik/servers/${server.id}/`); toast.success('Deleted.'); onRefresh(); }
    catch { toast.error('Failed to delete.'); }
    finally { setDeleting(false); }
  };

  return (
    <>
      <tr className={idx % 2 === 0 ? 'bg-white hover:bg-blue-50/30' : 'bg-gray-50/60 hover:bg-blue-50/30'}>
        <td className="px-4 py-3 font-semibold text-gray-800 text-sm whitespace-nowrap">
          {server.name}
          <div className="flex gap-1 mt-1 flex-wrap">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${server.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {server.is_active ? 'Active' : 'Inactive'}
            </span>
            <RadiusBadge server={server} onConfigured={onRefresh} />
          </div>
        </td>
        <td className="px-4 py-3 text-sm text-gray-600 font-mono whitespace-nowrap">{server.host}:{server.port}</td>
        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{server.username}</td>
        <td className="px-4 py-3 text-xs text-gray-500">
          {server.radius_configured && server.radius_configured_at
            ? new Date(server.radius_configured_at).toLocaleString()
            : '—'}
        </td>
        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
          {server.last_connected ? new Date(server.last_connected).toLocaleString() : '—'}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5 justify-end flex-wrap">
            <TestBtn onTest={doTest} label="Test" />
            <button onClick={checkTraffic} className="text-xs px-2.5 py-1 rounded-md bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200 font-medium">Traffic</button>
            <button onClick={createBackup} className="text-xs px-2.5 py-1 rounded-md bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200 font-medium">Backup</button>
            <button onClick={importUsers} className="text-xs px-2.5 py-1 rounded-md bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200 font-medium">Import</button>
            <button onClick={onEdit} className="text-xs px-2.5 py-1 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 font-medium">Edit</button>
            <button onClick={del} disabled={deleting} className="text-xs px-2.5 py-1 rounded-md bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 font-medium">Delete</button>
          </div>
        </td>
      </tr>
      {traffic && (
        <tr className="bg-blue-50/30">
          <td colSpan={6} className="px-4 py-2">
            <div className="flex gap-6 text-sm">
              <span className="text-gray-500">Download (RX): <strong>{Number(traffic.rx_byte || 0).toLocaleString()} bytes</strong></span>
              <span className="text-gray-500">Upload (TX): <strong>{Number(traffic.tx_byte || 0).toLocaleString()} bytes</strong></span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* Mikrotik Mobile Card */
function MikrotikMobileCard({ server, idx, onEdit, onRefresh }) {
  const [traffic, setTraffic]   = useState(null);
  const [deleting, setDeleting] = useState(false);

  const doTest = async () => {
    try { const res = await api.post(`/mikrotik/servers/${server.id}/test-connection/`); toast.success(res.data.message); return true; }
    catch (err) { toast.error(err.response?.data?.message || 'Test failed.'); return false; }
  };
  const checkTraffic = async () => {
    try { const res = await api.get(`/mikrotik/servers/${server.id}/live-traffic/`); setTraffic(res.data); }
    catch { toast.error('Failed to fetch traffic data.'); }
  };
  const createBackup = async () => {
    try { const res = await api.post(`/mikrotik/servers/${server.id}/create-backup/`); toast.success(res.data.message); }
    catch { toast.error('Backup failed.'); }
  };
  const importUsers = async () => {
    try { const res = await api.post(`/mikrotik/servers/${server.id}/import-users/`); toast.success(res.data.message); }
    catch { toast.error('Import failed.'); }
  };
  const del = async () => {
    if (!window.confirm(`Delete "${server.name}"?`)) return;
    setDeleting(true);
    try { await api.delete(`/mikrotik/servers/${server.id}/`); toast.success('Deleted.'); onRefresh(); }
    catch { toast.error('Failed to delete.'); }
    finally { setDeleting(false); }
  };

  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${idx % 2 === 0 ? 'bg-white border-gray-200' : 'bg-slate-50/40 border-gray-200'}`}>
      <div className="flex items-start justify-between gap-2 px-3 py-2.5 border-b border-gray-200" style={{ backgroundColor: 'rgba(35,68,95,0.06)' }}>
        <div className="min-w-0">
          <p className="font-bold text-gray-900 text-[13px] truncate">{server.name}</p>
          <div className="flex gap-1 mt-0.5 flex-wrap">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${server.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {server.is_active ? 'Active' : 'Inactive'}
            </span>
            <RadiusBadge server={server} onConfigured={onRefresh} />
          </div>
        </div>
      </div>
      <FRow label="Host : Port"><span className="font-mono">{server.host}:{server.port}</span></FRow>
      <FRow label="Username"><span>{server.username}</span></FRow>
      <FRow label="RADIUS At"><span className="text-[11px]">{server.radius_configured && server.radius_configured_at ? new Date(server.radius_configured_at).toLocaleString() : '—'}</span></FRow>
      <FRow label="Last Connected"><span className="text-[11px]">{server.last_connected ? new Date(server.last_connected).toLocaleString() : '—'}</span></FRow>
      {traffic && (
        <div className="grid grid-cols-2 divide-x divide-gray-100 border-b border-gray-100">
          <div className="px-3 py-2"><p className="text-[10px] text-gray-400 uppercase">Download (RX)</p><p className="text-xs font-medium">{Number(traffic.rx_byte || 0).toLocaleString()} B</p></div>
          <div className="px-3 py-2"><p className="text-[10px] text-gray-400 uppercase">Upload (TX)</p><p className="text-xs font-medium">{Number(traffic.tx_byte || 0).toLocaleString()} B</p></div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2.5 bg-gray-50/60 border-t border-gray-200">
        <TestBtn onTest={doTest} label="Test" />
        <button onClick={checkTraffic} className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100">Traffic</button>
        <button onClick={createBackup} className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100">Backup</button>
        <button onClick={importUsers} className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100">Import</button>
        <button onClick={onEdit} className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100">Edit</button>
        <button onClick={del} disabled={deleting} className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100">Delete</button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Main Page
═══════════════════════════════════════════════ */
export default function RadiusServerPage() {
  const [tab, setTab] = useState('radius');

  const [radiusServers, setRadiusServers] = useState([]);
  const [radiusLoading, setRadiusLoading] = useState(true);
  const [radiusModal, setRadiusModal]     = useState(null);
  const [showQuick, setShowQuick]         = useState(false);

  const [mtkServers, setMtkServers] = useState([]);
  const [mtkLoading, setMtkLoading] = useState(true);
  const [mtkModal, setMtkModal]     = useState(null);

  const loadRadius = () => {
    setRadiusLoading(true);
    api.get('/radius/servers/')
      .then(r => setRadiusServers(r.data.results || r.data))
      .catch(() => toast.error('Failed to load RADIUS servers.'))
      .finally(() => setRadiusLoading(false));
  };

  const loadMikrotik = () => {
    setMtkLoading(true);
    api.get('/mikrotik/servers/')
      .then(r => setMtkServers(r.data.results || r.data))
      .catch(() => toast.error('Failed to load Mikrotik servers.'))
      .finally(() => setMtkLoading(false));
  };

  useEffect(() => { loadRadius(); loadMikrotik(); }, []);
  useEffect(() => { if (!radiusLoading && radiusServers.length === 0) setShowQuick(true); }, [radiusLoading, radiusServers.length]);

  const tabs = [
    { id: 'radius',   label: '📡 RADIUS Servers',   count: radiusServers.length },
    { id: 'mikrotik', label: '🖧 Mikrotik Routers', count: mtkServers.length },
  ];

  return (
    <div className="space-y-5">
      {/* Modals */}
      {radiusModal && (
        <RadiusModal
          server={radiusModal === 'new' ? null : radiusModal}
          onClose={() => setRadiusModal(null)}
          onSaved={() => { setRadiusModal(null); loadRadius(); }}
        />
      )}
      {mtkModal && (
        <MikrotikModal
          server={mtkModal === 'add' ? null : mtkModal}
          onClose={() => setMtkModal(null)}
          onSaved={() => { setMtkModal(null); loadMikrotik(); }}
        />
      )}

      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">RADIUS Servers</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage FreeRADIUS &amp; Mikrotik Routers</p>
        </div>
        {tab === 'radius' ? (
          <div className="flex gap-2">
            <button onClick={() => setShowQuick(q => !q)}
              className={`btn-secondary py-2 px-4 text-sm ${showQuick ? 'bg-blue-50 border-blue-300 text-blue-700' : ''}`}>
              ⚡ Quick Setup
            </button>
            <button onClick={() => setRadiusModal('new')} className="btn-primary py-2 px-4 text-sm">
              + Add RADIUS Server
            </button>
          </div>
        ) : (
          <button onClick={() => setMtkModal('add')} className="btn-primary py-2 px-4 text-sm">
            + Add Router
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-1">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}>
              {t.label}
              <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
                tab === t.id ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
              }`}>{t.count}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* ── RADIUS tab ── */}
      {tab === 'radius' && (
        <div className="space-y-4">
          {showQuick && <QuickSetup onSaved={() => { setShowQuick(false); loadRadius(); }} />}

          {radiusLoading ? (
            <div className="text-center py-10 text-gray-400">Loading...</div>
          ) : radiusServers.length === 0 && !showQuick ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm text-center py-12 text-gray-400">
              <p className="text-lg mb-1">No RADIUS server configured.</p>
              <button onClick={() => setShowQuick(true)} className="btn-primary mt-3">⚡ Start Quick Setup</button>
            </div>
          ) : radiusServers.length > 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              {/* Mobile cards */}
              <div className="md:hidden space-y-2 p-3">
                {radiusServers.map((s, idx) => (
                  <RadiusMobileCard key={s.id} server={s} idx={idx}
                    onEdit={() => setRadiusModal(s)}
                    onDeleted={loadRadius}
                    onRefresh={loadRadius} />
                ))}
              </div>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: '#23445f' }} className="text-white text-xs uppercase tracking-wide">
                      <th className="px-4 py-3 text-left font-semibold">Server Name</th>
                      <th className="px-4 py-3 text-left font-semibold">RADIUS Host</th>
                      <th className="px-4 py-3 text-left font-semibold">Auth / Acct Port</th>
                      <th className="px-4 py-3 text-left font-semibold">DB Connection</th>
                      <th className="px-4 py-3 text-left font-semibold">DB Status</th>
                      <th className="px-4 py-3 text-left font-semibold">Last Test</th>
                      <th className="px-4 py-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {radiusServers.map((s, idx) => (
                      <RadiusRow key={s.id} server={s} idx={idx}
                        onEdit={() => setRadiusModal(s)}
                        onDeleted={loadRadius}
                        onRefresh={loadRadius} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {radiusServers.length === 0 && showQuick && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
              <p className="font-semibold mb-1">Where to find Shared Secret?</p>
              <code className="block bg-amber-100 rounded px-3 py-2 mt-1 font-mono text-xs">
                sudo grep -A5 "client localhost" /etc/freeradius/clients.conf
              </code>
              <p className="mt-2">For Mikrotik NAS IP, a separate client entry is needed in clients.conf.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Mikrotik tab ── */}
      {tab === 'mikrotik' && (
        <div className="space-y-4">
          {mtkLoading ? (
            <div className="text-center py-10 text-gray-400">Loading...</div>
          ) : mtkServers.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm text-center py-12 text-gray-400">
              <p className="text-lg mb-1">No Mikrotik router added.</p>
              <p className="text-sm mb-4">Enter IP, Username and Password — router name will be fetched automatically and RADIUS will be configured.</p>
              <button onClick={() => setMtkModal('add')} className="btn-primary">+ Add First Router</button>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              {/* Mobile cards */}
              <div className="md:hidden space-y-2 p-3">
                {mtkServers.map((s, idx) => (
                  <MikrotikMobileCard key={s.id} server={s} idx={idx}
                    onEdit={() => setMtkModal(s)}
                    onRefresh={loadMikrotik} />
                ))}
              </div>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: '#23445f' }} className="text-white text-xs uppercase tracking-wide">
                      <th className="px-4 py-3 text-left font-semibold">Router Name</th>
                      <th className="px-4 py-3 text-left font-semibold">Host : Port</th>
                      <th className="px-4 py-3 text-left font-semibold">Username</th>
                      <th className="px-4 py-3 text-left font-semibold">RADIUS Configured</th>
                      <th className="px-4 py-3 text-left font-semibold">Last Connected</th>
                      <th className="px-4 py-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {mtkServers.map((s, idx) => (
                      <MikrotikRow key={s.id} server={s} idx={idx}
                        onEdit={() => setMtkModal(s)}
                        onRefresh={loadMikrotik} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {mtkServers.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
              💡 <strong>Tip:</strong> Adding a new router automatically configures the default RADIUS server.
              You can also do it manually via the "Configure RADIUS" badge.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
