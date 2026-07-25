import { useEffect, useState } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const EMPTY_FORM = { host: '', port: 8728, username: 'admin', password: '', description: '', is_active: true };

function ServerModal({ server, onClose, onSaved }) {
  const isEdit = !!server;
  const [form, setForm] = useState(isEdit ? { ...server, password: '' } : { ...EMPTY_FORM });
  const [verified, setVerified] = useState(isEdit ? { name: server.name, model: '', version: '' } : null);
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleChange = e => {
    const { name, value, type, checked } = e.target;
    setForm(f => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
    if (!isEdit && ['host', 'port', 'username', 'password'].includes(name)) setVerified(null);
  };

  const verify = async () => {
    if (!form.host || !form.username || !form.password) {
      toast.error('Enter Host, Username and Password.');
      return;
    }
    setVerifying(true);
    try {
      const res = await api.post('/mikrotik/fetch-router-info/', {
        host: form.host, port: form.port,
        username: form.username, password: form.password,
      });
      setVerified(res.data.info);
      toast.success(`Connected! Router: ${res.data.info.name}`);
    } catch (err) {
      setVerified(null);
      toast.error(err.response?.data?.error || 'Could not connect to router.');
    } finally {
      setVerifying(false);
    }
  };

  const handleSubmit = async e => {
    e.preventDefault();
    if (!isEdit && !verified) { toast.error('Click "Verify Router" before saving.'); return; }
    setSaving(true);
    try {
      const payload = { ...form, name: verified?.name || server?.name };
      if (isEdit && !payload.password) delete payload.password;
      if (isEdit) {
        await api.patch(`/mikrotik/servers/${server.id}/`, payload);
        toast.success('Server updated.');
        onSaved();
      } else {
        const res = await api.post('/mikrotik/servers/', payload);
        const radiusResult = res.data.radius_auto_config;
        if (radiusResult?.configured) {
          toast.success(`"${payload.name}" added. RADIUS (${radiusResult.radius_server}) configured.`);
        } else {
          toast.success(`"${payload.name}" added.`);
          if (radiusResult?.message) toast.error(`RADIUS: ${radiusResult.message}`, { duration: 5000 });
        }
        onSaved();
      }
    } catch (err) {
      const data = err.response?.data;
      toast.error(data ? Object.values(data).flat().join(' | ') : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-bold text-gray-900">
            {isEdit ? 'Edit Server' : 'New Mikrotik Server'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Host / IP *</label>
              <input name="host" value={form.host} onChange={handleChange} required
                className="input-field w-full" placeholder="192.168.1.1" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Port</label>
              <input name="port" type="number" value={form.port} onChange={handleChange}
                className="input-field w-full" min="1" max="65535" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Username *</label>
              <input name="username" value={form.username} onChange={handleChange} required
                className="input-field w-full" placeholder="admin" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password *{isEdit && <span className="text-gray-400 font-normal text-xs ml-1">(blank = unchanged)</span>}
              </label>
              <input name="password" type="password" value={form.password} onChange={handleChange}
                required={!isEdit} className="input-field w-full" placeholder="••••••••" />
            </div>
          </div>

          {!isEdit && (
            <button type="button" onClick={verify} disabled={verifying}
              className={`w-full py-2 rounded-lg font-medium transition-colors border ${
                verified ? 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100'
                         : 'bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100'
              }`}>
              {verifying ? 'Connecting...' : verified ? '✓ Verified — re-verify' : 'Verify Router'}
            </button>
          )}

          {verified && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-1">
              <p className="text-sm font-semibold text-green-800">Router Info (name will be set automatically):</p>
              <p className="text-sm text-green-700">Name: <span className="font-bold">{verified.name}</span></p>
              {verified.model && <p className="text-sm text-green-700">Model: {verified.model}</p>}
              {verified.version && <p className="text-sm text-green-700">RouterOS: {verified.version}</p>}
              {verified.uptime && <p className="text-sm text-green-700">Uptime: {verified.uptime}</p>}
              {!isEdit && (
                <p className="text-xs text-green-600 mt-2 pt-2 border-t border-green-200">
                  After saving, the default RADIUS server will be automatically configured on this router.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea name="description" value={form.description} onChange={handleChange} rows={2}
              className="input-field w-full" placeholder="Optional description..." />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" name="is_active" checked={form.is_active} onChange={handleChange} className="w-4 h-4" />
            <span className="text-sm text-gray-700">Active</span>
          </label>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving || (!isEdit && !verified)}
              className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                !isEdit && !verified ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                     : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}>
              {saving ? 'Saving...' : isEdit ? 'Update' : 'Add Server'}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          </div>
          {!isEdit && !verified && (
            <p className="text-xs text-center text-gray-400">First "Verify Router" — then save</p>
          )}
        </form>
      </div>
    </div>
  );
}

function RadiusBadge({ server, onConfigured }) {
  const [loading, setLoading] = useState(false);

  const configure = async () => {
    setLoading(true);
    try {
      const res = await api.post(`/mikrotik/servers/${server.id}/configure-radius/`);
      toast.success(res.data.message);
      onConfigured();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to configure RADIUS.');
    } finally {
      setLoading(false);
    }
  };

  if (server.radius_configured) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
        RADIUS: {server.radius_server_name || 'Configured'}
      </span>
    );
  }

  return (
    <button onClick={configure} disabled={loading}
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium hover:bg-orange-200 transition-colors">
      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 inline-block"></span>
      {loading ? 'Configuring...' : 'Configure RADIUS'}
    </button>
  );
}

/* ─────────────────────────────────────────
   Icons + Test Button
───────────────────────────────────────── */
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
const RouterIcon = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

function TestButton({ onTest, label = 'Test' }) {
  const [phase, setPhase] = useState('idle');
  const run = async () => {
    setPhase('testing');
    const ok = await onTest();
    setPhase(ok ? 'ok' : 'fail');
    setTimeout(() => setPhase('idle'), 2500);
  };
  const cfg = {
    idle:    { cls: 'bg-white hover:bg-slate-50 text-slate-600 border-slate-300 hover:border-slate-400 hover:shadow-sm', icon: <RouterIcon />, text: label },
    testing: { cls: 'bg-blue-50 text-blue-500 border-blue-200 cursor-not-allowed', icon: <Spinner />, text: 'Testing…' },
    ok:      { cls: 'bg-emerald-50 text-emerald-700 border-emerald-300', icon: <CheckIcon />, text: 'Connected' },
    fail:    { cls: 'bg-red-50 text-red-700 border-red-300', icon: <XIcon />, text: 'Failed' },
  }[phase];
  return (
    <button onClick={run} disabled={phase === 'testing'}
      className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border transition-all duration-200 ${cfg.cls}`}>
      {cfg.icon}
      <span>{cfg.text}</span>
    </button>
  );
}

export default function ServerList() {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [traffic, setTraffic] = useState({});
  const [deleting, setDeleting] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/mikrotik/servers/')
      .then(res => setServers(res.data.results || res.data))
      .catch(() => toast.error('Failed to load servers.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const testConnection = async (server) => {
    try {
      const res = await api.post(`/mikrotik/servers/${server.id}/test-connection/`);
      toast.success(res.data.message);
      return true;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Test connection failed.');
      return false;
    }
  };

  const checkTraffic = async (server) => {
    try {
      const res = await api.get(`/mikrotik/servers/${server.id}/live-traffic/`);
      setTraffic(t => ({ ...t, [server.id]: res.data }));
    } catch { toast.error('Failed to get live traffic.'); }
  };

  const createBackup = async (server) => {
    try {
      const res = await api.post(`/mikrotik/servers/${server.id}/create-backup/`);
      toast.success(res.data.message);
    } catch { toast.error('Failed to create backup.'); }
  };

  const importUsers = async (server) => {
    try {
      const res = await api.post(`/mikrotik/servers/${server.id}/import-users/`);
      toast.success(res.data.message);
    } catch { toast.error('Import failed.'); }
  };

  const deleteServer = async (server) => {
    if (!window.confirm(`Delete server "${server.name}"?`)) return;
    setDeleting(server.id);
    try {
      await api.delete(`/mikrotik/servers/${server.id}/`);
      toast.success('Server deleted.');
      load();
    } catch { toast.error('Failed to delete.'); }
    finally { setDeleting(null); }
  };

  return (
    <div className="space-y-4">
      {modal && (
        <ServerModal
          server={modal === 'add' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-gray-900">Mikrotik Servers</h1>
        <button onClick={() => setModal('add')} className="btn-primary">+ New Server</button>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : servers.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">
          <p className="text-lg mb-1">No Mikrotik servers added yet.</p>
          <p className="text-sm mb-4">Enter IP, Username and Password — the router name will be fetched automatically and RADIUS will be configured.</p>
          <button onClick={() => setModal('add')} className="btn-primary">Add First Server</button>
        </div>
      ) : (
        <div className="grid gap-4">
          {servers.map(server => (
            <div key={server.id} className={`card border-l-4 ${server.radius_configured ? 'border-l-emerald-400' : 'border-l-orange-300'}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-semibold text-gray-900">{server.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${server.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {server.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <RadiusBadge server={server} onConfigured={load} />
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">{server.host}:{server.port} — {server.username}</p>
                  {server.description && <p className="text-xs text-gray-400 mt-1">{server.description}</p>}
                  {server.radius_configured && server.radius_configured_at && (
                    <p className="text-xs text-emerald-600 mt-1">
                      RADIUS configured: {new Date(server.radius_configured_at).toLocaleString()}
                    </p>
                  )}
                  {server.last_connected && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      Last connected: {new Date(server.last_connected).toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 justify-end shrink-0">
                  <TestButton onTest={() => testConnection(server)} />
                  <button onClick={() => checkTraffic(server)} className="btn-secondary text-sm py-1 px-3">Traffic</button>
                  <button onClick={() => createBackup(server)} className="btn-secondary text-sm py-1 px-3">Backup</button>
                  <button onClick={() => importUsers(server)} className="btn-secondary text-sm py-1 px-3">Import</button>
                  <button onClick={() => setModal(server)} className="btn-secondary text-sm py-1 px-3 text-blue-600">Edit</button>
                  <button onClick={() => deleteServer(server)} disabled={deleting === server.id}
                    className="btn-secondary text-sm py-1 px-3 text-red-600">Delete</button>
                </div>
              </div>

              {traffic[server.id] && (
                <div className="mt-4 grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg text-sm">
                  <div>
                    <p className="text-xs text-gray-500">Download (RX)</p>
                    <p className="font-medium">{Number(traffic[server.id].rx_byte || 0).toLocaleString()} bytes</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Upload (TX)</p>
                    <p className="font-medium">{Number(traffic[server.id].tx_byte || 0).toLocaleString()} bytes</p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
