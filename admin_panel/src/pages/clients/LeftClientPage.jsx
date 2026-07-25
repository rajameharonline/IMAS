import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import toast from 'react-hot-toast';

/* ── Tooltip icon button (same pattern as ClientList) ── */
function TipBtn({ onClick, tooltip, color, children }) {
  return (
    <div className="relative group">
      <button onClick={onClick}
        className={`flex items-center justify-center w-8 h-8 rounded-lg border transition-all duration-150 hover:scale-105 ${color}`}>
        {children}
      </button>
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded px-2 py-0.5 text-[10px] font-semibold text-white bg-gray-800 opacity-0 group-hover:opacity-100 transition-opacity z-[60]">
        {tooltip}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
      </span>
    </div>
  );
}

/* ── Three-dot Actions menu ── */
function RowActions({ rec, onEdit, onDelete, onRecovery }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  return (
    <div className="flex justify-center">
      <div ref={ref} className="relative">
        <button onClick={() => setOpen(v => !v)}
          className="flex flex-col items-center justify-center gap-[4px] w-8 h-8 rounded-lg hover:bg-gray-100 transition-colors group">
          <span className="w-[5px] h-[5px] rounded-full bg-gray-400 group-hover:bg-gray-600" />
          <span className="w-[5px] h-[5px] rounded-full bg-gray-400 group-hover:bg-gray-600" />
          <span className="w-[5px] h-[5px] rounded-full bg-gray-400 group-hover:bg-gray-600" />
        </button>
        {open && (
          <div className="absolute right-full top-1/2 -translate-y-1/2 mr-1 z-50 flex items-center gap-1 bg-white rounded-xl shadow-lg border border-gray-100 px-1.5 py-1.5">
            {/* Delete */}
            <TipBtn onClick={() => { setOpen(false); onDelete(); }} tooltip="Delete"
              color="bg-red-50 text-red-500 border-red-100 hover:bg-red-100 hover:border-red-300">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </TipBtn>
            {/* Recovery Info */}
            <TipBtn onClick={() => { setOpen(false); onRecovery(); }} tooltip="Recovery Info"
              color="bg-amber-50 text-amber-600 border-amber-100 hover:bg-amber-100 hover:border-amber-300">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </TipBtn>
            {/* Edit */}
            <TipBtn onClick={() => { setOpen(false); onEdit(); }} tooltip="Edit"
              color="bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-100 hover:border-blue-300">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </TipBtn>
            <span className="absolute left-full top-1/2 -translate-y-1/2 border-[5px] border-transparent border-l-white drop-shadow-sm" />
          </div>
        )}
      </div>
    </div>
  );
}

const FLABEL = 'text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1';
const FINPUT = 'w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500';

export default function LeftClientPage() {
  const navigate = useNavigate();
  const [records, setRecords]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [page, setPage]         = useState(1);
  const [perPage, setPerPage]   = useState(100);
  const [count, setCount]       = useState(0);

  /* filters */
  const [fZone, setFZone]           = useState('');
  const [fConnType, setFConnType]   = useState('');
  const [fClientType, setFClientType] = useState('');
  const [fPackage, setFPackage]     = useState('');
  const [fProtocol, setFProtocol]   = useState('');
  const [fFromDate, setFFromDate]   = useState('');
  const [fToDate, setFToDate]       = useState('');
  const [fRecovery, setFRecovery]   = useState('');

  /* filter option lists */
  const [zones, setZones]           = useState([]);
  const [protocols, setProtocols]   = useState([]);
  const [clientTypes, setClientTypes] = useState([]);
  const [packages, setPackages]     = useState([]);

  /* modals */
  const [deleteId, setDeleteId]     = useState(null);
  const [recoveryRec, setRecoveryRec] = useState(null);
  const [saving, setSaving]         = useState(false);
  const [deleting, setDeleting]     = useState(false);

  /* recovery form */
  const [recForm, setRecForm] = useState({
    cable_recovered: false, device_recovered: false,
    recovery_status: 'pending', recovery_notes: '',
  });

  /* employees for recovered_by dropdown */
  const [employees, setEmployees] = useState([]);

  /* ── Load filter options once ── */
  useEffect(() => {
    Promise.all([
      api.get('/config/zones/').catch(() => null),
      api.get('/config/protocol-types/').catch(() => null),
      api.get('/config/client-types/').catch(() => null),
      api.get('/config/packages/').catch(() => null),
      api.get('/hr/employees/').catch(() => null),
    ]).then(([z, p, ct, pk, emp]) => {
      const ex = (r) => r?.data?.results || r?.data || [];
      setZones(ex(z));
      setProtocols(ex(p));
      setClientTypes(ex(ct));
      setPackages(ex(pk));
      setEmployees(ex(emp));
    });
  }, []);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, page_size: perPage });
      if (search)   params.append('search', search);
      if (fRecovery) params.append('recovery_status', fRecovery);
      const res = await api.get(`/left-clients/?${params}`);
      setRecords(res.data.results || res.data);
      setCount(res.data.count || 0);
    } catch {
      toast.error('Failed to load records.');
    } finally {
      setLoading(false);
    }
  }, [page, perPage, search, fRecovery]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  /* ── Edit ── */
  const openEdit = (rec) => {
    navigate(`/clients/${rec.client}?from=left`);
  };

  /* ── Delete ── */
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/left-clients/${deleteId}/`);
      toast.success('Record deleted.');
      setDeleteId(null);
      fetchRecords();
    } catch { toast.error('Delete failed.'); }
    finally { setDeleting(false); }
  };

  /* ── Recovery Info ── */
  const openRecovery = (rec) => {
    setRecoveryRec(rec);
    setRecForm({
      cable_recovered:  rec.cable_recovered  || false,
      device_recovered: rec.device_recovered || false,
      recovery_status:  rec.recovery_status  || 'pending',
      recovered_by:     rec.recovered_by     || '',
      recovery_notes:   rec.recovery_notes   || '',
    });
  };

  const handleSaveRecovery = async () => {
    setSaving(true);
    try {
      await api.patch(`/left-clients/${recoveryRec.id}/`, recForm);
      toast.success('Recovery info updated.');
      setRecoveryRec(null);
      fetchRecords();
    } catch { toast.error('Failed to update recovery info.'); }
    finally { setSaving(false); }
  };

  const setRF = (k) => (e) => setRecForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  /* ── Recovery status badge ── */
  const recoveryBadge = (status) => {
    if (status === 'recovered') return 'bg-green-500 text-white';
    if (status === 'partial')   return 'bg-yellow-500 text-white';
    return 'bg-gray-400 text-white';
  };
  const recoveryLabel = (status) => {
    if (status === 'recovered') return 'Recovered';
    if (status === 'partial')   return 'Partial';
    return 'Pending';
  };

  return (
    <div className="space-y-3 -mt-2">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          <div>
            <h1 className="text-lg font-bold text-gray-900 leading-none">Left Clients</h1>
            <p className="text-[11px] text-gray-400 mt-0.5">View All Left Client</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-gray-400">Client &rsaquo; Left Clients</div>
        </div>
      </div>

      {/* ── Filter section ── */}
      <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        {/* Row 1 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><p className={FLABEL}>ZONE</p>
            <select className={FINPUT} value={fZone} onChange={e => { setFZone(e.target.value); setPage(1); }}>
              <option value="">Select</option>
              {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </div>
          <div><p className={FLABEL}>CONNECTION TYPE</p>
            <select className={FINPUT} value={fConnType} onChange={e => { setFConnType(e.target.value); setPage(1); }}>
              <option value="">Select</option>
              {protocols.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div><p className={FLABEL}>CLIENT TYPE</p>
            <select className={FINPUT} value={fClientType} onChange={e => { setFClientType(e.target.value); setPage(1); }}>
              <option value="">Select</option>
              {clientTypes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div><p className={FLABEL}>PACKAGE</p>
            <select className={FINPUT} value={fPackage} onChange={e => { setFPackage(e.target.value); setPage(1); }}>
              <option value="">Select</option>
              {packages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        {/* Row 2 */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div><p className={FLABEL}>PROTOCOL TYPE</p>
            <select className={FINPUT} value={fProtocol} onChange={e => { setFProtocol(e.target.value); setPage(1); }}>
              <option value="">Select</option>
              {protocols.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div><p className={FLABEL}>FROM LEFT DATE</p>
            <input type="date" className={FINPUT} value={fFromDate}
              onChange={e => { setFFromDate(e.target.value); setPage(1); }}
              placeholder="DD-MM-YYYY" />
          </div>
          <div><p className={FLABEL}>TO LEFT DATE</p>
            <input type="date" className={FINPUT} value={fToDate}
              onChange={e => { setFToDate(e.target.value); setPage(1); }}
              placeholder="DD-MM-YYYY" />
          </div>
        </div>
        {/* Row 3 */}
        <div className="grid grid-cols-2 md:grid-cols-2 gap-3 max-w-lg">
          <div><p className={FLABEL}>RECOVERY STATUS</p>
            <select className={FINPUT} value={fRecovery} onChange={e => { setFRecovery(e.target.value); setPage(1); }}>
              <option value="">Select</option>
              <option value="pending">Pending</option>
              <option value="partial">Partial</option>
              <option value="recovered">Recovered</option>
            </select>
          </div>
          <div><p className={FLABEL}>RECOVERED BY</p>
            <select className={FINPUT}>
              <option value="">Select</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.full_name || e.name || e.username}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* ── Table card ── */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">

        {/* Table top bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2 text-xs text-gray-600 font-medium">
            SHOW
            <select value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setPage(1); }}
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              {[20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            ENTRIES
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-600 font-medium">
            SEARCH:
            <input type="text" placeholder="client name / ID..."
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs w-40 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-center py-16 text-gray-400 text-sm">Loading...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#1c2333] text-white text-[11px] font-semibold uppercase tracking-wide">
                  <th className="px-2 py-3 text-center w-8">
                    <input type="checkbox" className="w-3.5 h-3.5 rounded cursor-pointer accent-blue-500" />
                  </th>
                  <th className="px-3 py-3 text-center whitespace-nowrap">
                    Customer ID <span className="opacity-60 text-[10px]">&#8597;</span>
                  </th>
                  <th className="px-3 py-3 text-left whitespace-nowrap">
                    ID/IP <span className="opacity-60 text-[10px]">&#8597;</span>
                  </th>
                  <th className="px-3 py-3 text-left whitespace-nowrap">Client Name</th>
                  <th className="px-3 py-3 text-left whitespace-nowrap">Mobile</th>
                  <th className="px-3 py-3 text-left whitespace-nowrap">
                    Zone <span className="opacity-60 text-[10px]">&#8597;</span>
                  </th>
                  <th className="px-3 py-3 text-left whitespace-nowrap">Connection Type</th>
                  <th className="px-3 py-3 text-left whitespace-nowrap">Client Type</th>
                  <th className="px-3 py-3 text-left whitespace-nowrap">Package/Speed</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">M.Bill</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">Due</th>
                  <th className="px-3 py-3 text-left whitespace-nowrap">Server</th>
                  <th className="px-3 py-3 text-center whitespace-nowrap">B.Status</th>
                  <th className="px-3 py-3 text-center whitespace-nowrap">Left Date</th>
                  <th className="px-3 py-3 text-center whitespace-nowrap">Action</th>
                </tr>
              </thead>
              <tbody>
                {records.length === 0 ? (
                  <tr><td colSpan={15} className="text-center py-16 text-gray-400">No left client records found.</td></tr>
                ) : records.map((rec, idx) => {
                  const isEven = idx % 2 === 0;
                  const rStatus = rec.recovery_status || 'pending';
                  return (
                    <tr key={rec.id}
                      className={`border-b border-gray-100 hover:bg-blue-50/30 transition-colors align-middle ${isEven ? 'bg-white' : 'bg-gray-50/50'}`}>

                      {/* Checkbox */}
                      <td className="px-2 py-2.5 text-center">
                        <input type="checkbox" className="w-3.5 h-3.5 rounded cursor-pointer accent-blue-500" />
                      </td>

                      {/* C.Code */}
                      <td className="px-3 py-2.5 text-center">
                        <span className="font-mono font-bold text-gray-800">{rec.client_customer_id || rec.client}</span>
                      </td>

                      {/* ID/IP */}
                      <td className="px-3 py-2.5">
                        <p className="font-mono font-semibold text-gray-800 leading-tight">
                          {rec.client_username || '—'}
                        </p>
                      </td>

                      {/* Client Name */}
                      <td className="px-3 py-2.5 max-w-[160px]">
                        <p className="truncate font-medium text-gray-800" title={rec.client_name || ''}>
                          {rec.client_name || '—'}
                        </p>
                      </td>

                      {/* Mobile */}
                      <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                        {rec.client_phone || '—'}
                      </td>

                      {/* Zone */}
                      <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                        {rec.client_zone || '—'}
                      </td>

                      {/* Connection Type — two stacked badges */}
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col gap-1 items-start">
                          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-teal-700 text-white whitespace-nowrap">
                            {rec.client_protocol || 'Optical Fiber'}
                          </span>
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${recoveryBadge(rStatus)}`}>
                            {recoveryLabel(rStatus)}
                          </span>
                        </div>
                      </td>

                      {/* Client Type */}
                      <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                        {rec.client_type || '—'}
                      </td>

                      {/* Package/Speed */}
                      <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                        {rec.client_package || '—'}
                      </td>

                      {/* M.Bill */}
                      <td className="px-3 py-2.5 text-right font-medium text-gray-800">
                        {rec.client_monthly_bill ?? '—'}
                      </td>

                      {/* Due */}
                      <td className="px-3 py-2.5 text-right">
                        {Number(rec.final_due) > 0
                          ? <span className="text-red-600 font-semibold">{Number(rec.final_due).toFixed(2)}</span>
                          : <span className="text-gray-400">0.00</span>}
                      </td>

                      {/* Server */}
                      <td className="px-3 py-2.5 text-gray-600 text-[10px] max-w-[120px] truncate" title={rec.client_server || ''}>
                        {rec.client_server || '—'}
                      </td>

                      {/* B.Status */}
                      <td className="px-3 py-2.5 text-center">
                        <span className="inline-block px-2.5 py-1 rounded text-[10px] font-bold bg-gray-600 text-white">Left</span>
                      </td>

                      {/* Left Date */}
                      <td className="px-3 py-2.5 text-center text-gray-600 whitespace-nowrap">
                        {rec.left_date
                          ? new Date(rec.left_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                          : '—'}
                      </td>

                      {/* Action */}
                      <td className="px-3 py-2.5 text-center">
                        <RowActions
                          rec={rec}
                          onEdit={() => openEdit(rec)}
                          onDelete={() => setDeleteId(rec.id)}
                          onRecovery={() => openRecovery(rec)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-gray-100">
          <span className="text-xs text-gray-500">{count} total records</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
              ← Prev
            </button>
            <span className="text-xs text-gray-600 px-1">Page {page}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={records.length < perPage}
              className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
              Next →
            </button>
          </div>
        </div>
      </div>

      {/* ── Connection Recovery Info Modal ── */}
      {recoveryRec && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 bg-[#1c2333] rounded-t-2xl">
              <h2 className="text-sm font-semibold text-white">Connection Recovery Information</h2>
              <button onClick={() => setRecoveryRec(null)} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="space-y-3 text-sm text-gray-700">
                <div className="flex items-center justify-between">
                  <span className="font-medium">• Cable Recovered:</span>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={recForm.cable_recovered} onChange={setRF('cable_recovered')} className="w-4 h-4 accent-blue-600" />
                    <span className="text-xs">{recForm.cable_recovered ? 'Yes' : 'No'}</span>
                  </label>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">• Device Recovered:</span>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={recForm.device_recovered} onChange={setRF('device_recovered')} className="w-4 h-4 accent-blue-600" />
                    <span className="text-xs">{recForm.device_recovered ? 'Yes' : 'No'}</span>
                  </label>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium shrink-0">• Recovery Status:</span>
                  <select className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={recForm.recovery_status} onChange={setRF('recovery_status')}>
                    <option value="pending">Pending</option>
                    <option value="partial">Partial</option>
                    <option value="recovered">Recovered</option>
                  </select>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium shrink-0">• Recovered By:</span>
                  <select className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={recForm.recovered_by || ''} onChange={setRF('recovered_by')}>
                    <option value="">— Select —</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.full_name || e.name || e.username}</option>)}
                  </select>
                </div>
                <div>
                  <p className="font-medium mb-1">• Remarks/Notes:</p>
                  <textarea className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    rows={3} value={recForm.recovery_notes} onChange={setRF('recovery_notes')}
                    placeholder="Any remarks..." />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 pb-5">
              <button onClick={() => setRecoveryRec(null)}
                className="px-5 py-2 text-sm font-medium bg-red-500 text-white rounded-lg hover:bg-red-600">
                Cancel
              </button>
              <button onClick={handleSaveRecovery} disabled={saving}
                className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ── */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 bg-[#1c2333] rounded-t-2xl">
              <h2 className="text-sm font-semibold text-white">Delete Record</h2>
              <button onClick={() => setDeleteId(null)} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-gray-600">এই record মুছে ফেলবেন? <strong className="text-red-600">এই action undo করা যাবে না।</strong> Client এবং RADIUS/Mikrotik থেকে সম্পূর্ণ মুছে যাবে।</p>
            </div>
            <div className="flex justify-end gap-2 px-6 pb-5">
              <button onClick={() => setDeleteId(null)} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">বাতিল</button>
              <button onClick={handleDelete} disabled={deleting}
                className="px-4 py-2 text-sm font-semibold bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50">
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
