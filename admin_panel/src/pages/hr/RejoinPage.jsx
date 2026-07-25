// HR & Payroll — Rejoin পেজ (পুনঃযোগদান)
// resigned কর্মচারী আবার join করলে এখান থেকে rejoin record তৈরি;
// create হলেই backend Employee.status='active' করে দেয় (join_date অপরিবর্তিত)
import { useEffect, useState, useCallback, useMemo } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition';
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => d
  ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  : '—';

/* ─── Rejoin Modal ──────────────────────────────────────────────────────── */
function RejoinModal({ employee, resignations, onClose, onDone }) {
  const [resignationId, setResignationId] = useState('');
  const [rejoinDate,    setRejoinDate]    = useState(today());
  const [notes,         setNotes]         = useState('');
  const [busy,          setBusy]          = useState(false);

  // এই employee-এর approved resignation auto-pick (latest)
  useEffect(() => {
    const my = resignations
      .filter(r => r.employee === employee.id && r.status === 'approved')
      .sort((a, b) => (b.resign_date || '').localeCompare(a.resign_date || ''));
    if (my.length > 0) setResignationId(String(my[0].id));
  }, [employee.id, resignations]);

  const empResignations = useMemo(
    () => resignations.filter(r => r.employee === employee.id && r.status === 'approved'),
    [resignations, employee.id],
  );

  const submit = async () => {
    if (!rejoinDate) { toast.error('Rejoin date দিন।'); return; }
    setBusy(true);
    try {
      await api.post('/hr/rejoins/', {
        employee:             employee.id,
        previous_resignation: resignationId || null,
        rejoin_date:          rejoinDate,
        notes,
      });
      toast.success(`✅ ${employee.full_name} আবার active`);
      onDone();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Rejoin ব্যর্থ।');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
          <h2 className="text-base font-bold font-slab">Rejoin Employee</h2>
          <button onClick={onClose} className="text-white/80 hover:text-white text-2xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="px-6 pt-4 pb-3 space-y-4">
          {/* Employee summary */}
          <div className="rounded-lg bg-emerald-50/60 border border-emerald-100 px-3 py-2.5">
            <p className="font-semibold text-gray-800">{employee.full_name}</p>
            <p className="text-[11px] text-gray-500 font-mono">
              {employee.employee_id} · {employee.designation || '—'}
            </p>
            <p className="text-[10.5px] text-gray-500 mt-1">
              Original Join Date: <span className="font-mono">{fmtDate(employee.join_date)}</span>
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1.5">Previous Resignation</label>
            <select className={inp} value={resignationId} onChange={e => setResignationId(e.target.value)}>
              <option value="">— Not linked —</option>
              {empResignations.map(r => (
                <option key={r.id} value={r.id}>
                  Resigned {fmtDate(r.resign_date)} ({r.resign_rule_name || 'no rule'})
                </option>
              ))}
            </select>
            {empResignations.length === 0 && (
              <p className="text-[10.5px] text-gray-400 mt-1">এই employee-এর কোনো approved resignation নেই — তবু rejoin record করা যাবে।</p>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1.5">
              Rejoin Date <span className="text-rose-500">*</span>
            </label>
            <input type="date" className={inp} value={rejoinDate} onChange={e => setRejoinDate(e.target.value)} />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1.5">Notes</label>
            <textarea rows={2} className={inp + ' resize-none'} placeholder="Optional remarks..."
              value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            ⚠ Confirm করলে Employee.status = <strong>active</strong> হয়ে যাবে; original join date অপরিবর্তিত থাকবে।
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 pb-5 pt-1">
          <button onClick={onClose} className="px-6 py-2 rounded-lg text-sm font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="px-6 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60">
            {busy ? '...' : 'Confirm Rejoin'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Page ─────────────────────────────────────────────────────────── */
/* ── Mobile Rejoin Cards ── */
function MobileRejoinEmpCard({ e, idx, setTarget, fmtDate }) {
  const isEven = idx % 2 === 0;
  const FRow = ({ label, children }) => (
    <div className="flex items-stretch border-b border-gray-200 last:border-0">
      <div className="w-28 shrink-0 bg-gray-50 px-3 py-2.5 flex items-center border-r border-gray-200">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex-1 min-w-0 px-3 py-2.5 flex items-center justify-end bg-white">{children}</div>
    </div>
  );
  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${isEven ? 'bg-white border-gray-200' : 'bg-slate-50/40 border-gray-200'}`}>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-[#23445f]/5 border-b border-gray-200">
        <div className="min-w-0">
          <p className="font-bold text-gray-900 text-[13px] truncate">{e.full_name}</p>
          <p className="font-mono text-[11px] text-gray-400">{e.employee_id}</p>
        </div>
        <button onClick={() => setTarget(e)}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 shrink-0">
          Rejoin
        </button>
      </div>
      <div>
        <FRow label="Designation"><span className="text-[12px] text-gray-700">{e.designation || '—'}</span></FRow>
        <FRow label="Department"><span className="text-[12px] text-gray-700">{e.department_name_display || '—'}</span></FRow>
        <FRow label="Join Date"><span className="font-mono text-[12px] text-gray-600">{fmtDate(e.join_date)}</span></FRow>
      </div>
    </div>
  );
}

function MobileRejoinHistoryCard({ r, idx, fmtDate, handleDeleteRejoin }) {
  const isEven = idx % 2 === 0;
  const FRow = ({ label, children }) => (
    <div className="flex items-stretch border-b border-gray-200 last:border-0">
      <div className="w-28 shrink-0 bg-gray-50 px-3 py-2.5 flex items-center border-r border-gray-200">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex-1 min-w-0 px-3 py-2.5 flex items-center justify-end bg-white">{children}</div>
    </div>
  );
  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${isEven ? 'bg-white border-gray-200' : 'bg-slate-50/40 border-gray-200'}`}>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-[#23445f]/5 border-b border-gray-200">
        <div className="min-w-0">
          <p className="font-bold text-gray-900 text-[13px] truncate">{r.employee_name}</p>
          <p className="font-mono text-[11px] text-gray-400">{r.employee_code}</p>
        </div>
        <button onClick={() => handleDeleteRejoin(r)}
          className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 border border-rose-200 shrink-0">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
      <div>
        <FRow label="Designation"><span className="text-[12px] text-gray-700">{r.employee_designation || '—'}</span></FRow>
        <FRow label="Prev. Resign"><span className="font-mono text-[12px] text-gray-600">{fmtDate(r.previous_resign_date)}</span></FRow>
        <FRow label="Rejoin Date"><span className="font-mono text-[12px] font-semibold text-emerald-700">{fmtDate(r.rejoin_date)}</span></FRow>
        <FRow label="Notes"><span className="text-[12px] text-gray-500 truncate">{r.notes || '—'}</span></FRow>
        <FRow label="Created By"><span className="text-[12px] text-gray-700">{r.created_by_name || '—'}</span></FRow>
      </div>
    </div>
  );
}

export default function RejoinPage() {
  const [resigned,     setResigned]     = useState([]);    // Employee[] status=resigned
  const [rejoins,      setRejoins]      = useState([]);    // Rejoin[]
  const [resignations, setResignations] = useState([]);    // Resignation[]
  const [loading,      setLoading]      = useState(true);
  const [target,       setTarget]       = useState(null);  // employee → Rejoin modal
  const [search,       setSearch]       = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [empRes, rjRes, resRes] = await Promise.all([
        api.get('/hr/employees/?status=resigned&page_size=500&ordering=full_name'),
        api.get('/hr/rejoins/?page_size=200&ordering=-rejoin_date'),
        api.get('/hr/resignations/?page_size=500&ordering=-resign_date'),
      ]);
      setResigned(empRes.data?.results ?? empRes.data ?? []);
      setRejoins(rjRes.data?.results ?? rjRes.data ?? []);
      setResignations(resRes.data?.results ?? resRes.data ?? []);
    } catch { toast.error('ডেটা লোড ব্যর্থ।'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredResigned = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return resigned;
    return resigned.filter(e =>
      e.full_name?.toLowerCase().includes(q) ||
      e.employee_id?.toLowerCase().includes(q) ||
      e.designation?.toLowerCase().includes(q),
    );
  }, [resigned, search]);

  const summary = useMemo(() => {
    const thisYear = new Date().getFullYear();
    const yrCount = rejoins.filter(r => (r.rejoin_date || '').startsWith(String(thisYear))).length;
    return { resigned: resigned.length, total: rejoins.length, year: yrCount };
  }, [resigned, rejoins]);

  const handleDeleteRejoin = async (r) => {
    if (!window.confirm(`${r.employee_name}-এর rejoin রেকর্ড মুছবেন? (Employee status পরিবর্তন হবে না)`)) return;
    try {
      await api.delete(`/hr/rejoins/${r.id}/`);
      toast.success('Rejoin record মুছে ফেলা হয়েছে।');
      load();
    } catch { toast.error('মুছতে ব্যর্থ।'); }
  };

  return (
    <div className="p-4 sm:p-6 min-h-screen bg-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="font-slab text-2xl font-bold text-gray-900 flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-sm">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          </span>
          Rejoin
        </h1>
        <div className="text-xs text-gray-400 hidden sm:flex items-center gap-1">
          <span className="text-teal-600 font-medium">HR &amp; Payroll</span><span>›</span><span>Rejoin</span>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <div className="rounded-xl bg-white border border-rose-100 p-4 shadow-sm">
          <p className="text-[10px] uppercase font-bold text-rose-600 tracking-wider">Resigned Employees</p>
          <p className="text-2xl font-bold font-slab text-rose-600 mt-1">{summary.resigned}</p>
        </div>
        <div className="rounded-xl bg-white border border-emerald-100 p-4 shadow-sm">
          <p className="text-[10px] uppercase font-bold text-emerald-600 tracking-wider">Total Rejoins</p>
          <p className="text-2xl font-bold font-slab text-emerald-600 mt-1">{summary.total}</p>
        </div>
        <div className="rounded-xl bg-white border border-teal-100 p-4 shadow-sm">
          <p className="text-[10px] uppercase font-bold text-teal-600 tracking-wider">This Year</p>
          <p className="text-2xl font-bold font-slab text-teal-700 mt-1">{summary.year}</p>
        </div>
      </div>

      {/* Section 1: Resigned employees waiting to rejoin */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-5">
        <div className="bg-[#1c2333] text-white px-4 py-3 flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-bold font-slab">Resigned Employees</h3>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, ID, designation..."
            className="border border-[#2a3347] bg-[#2a3347] text-white placeholder-gray-400 rounded-lg px-3 py-1 text-xs w-64 focus:outline-none focus:ring-2 focus:ring-teal-500" />
        </div>
        <>
        <div className="md:hidden space-y-2 p-3">
          {loading ? <p className="text-center py-6 text-gray-400 text-sm">লোড হচ্ছে...</p>
           : filteredResigned.length === 0 ? <p className="text-center py-6 text-gray-400 text-sm">কোনো resigned employee নেই।</p>
           : filteredResigned.map((e, idx) => (
             <MobileRejoinEmpCard key={e.id} e={e} idx={idx} setTarget={setTarget} fmtDate={fmtDate} />
           ))}
        </div>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#23445f] text-white text-xs uppercase tracking-wide">
                <th className="px-4 py-2.5 text-center font-semibold w-12">SN</th>
                <th className="px-4 py-2.5 text-left font-semibold">Employee</th>
                <th className="px-4 py-2.5 text-left font-semibold">Designation</th>
                <th className="px-4 py-2.5 text-left font-semibold">Department</th>
                <th className="px-4 py-2.5 text-center font-semibold">Original Join</th>
                <th className="px-4 py-2.5 text-center font-semibold w-32">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-10 text-gray-400">লোড হচ্ছে...</td></tr>
              ) : filteredResigned.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-10 text-gray-400">{search ? 'কোনো ফলাফল নেই।' : 'কোনো resigned employee নেই।'}</td></tr>
              ) : filteredResigned.map((e, idx) => (
                <tr key={e.id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'} hover:bg-teal-50/40 transition-colors border-b border-gray-100`}>
                  <td className="px-4 py-2.5 text-center font-mono text-xs text-gray-500">{idx + 1}</td>
                  <td className="px-4 py-2.5">
                    <p className="font-semibold text-gray-800">{e.full_name}</p>
                    <p className="text-[11px] text-gray-500 font-mono">{e.employee_id}</p>
                  </td>
                  <td className="px-4 py-2.5 text-gray-700 text-sm">{e.designation || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-700 text-sm">{e.department_name_display || '—'}</td>
                  <td className="px-4 py-2.5 text-center font-mono text-xs text-gray-600">{fmtDate(e.join_date)}</td>
                  <td className="px-4 py-2.5 text-center">
                    <button onClick={() => setTarget(e)}
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Rejoin
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      </div>

      {/* Section 2: Rejoin history */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="bg-[#23445f] text-white px-4 py-3">
          <h3 className="text-sm font-bold font-slab">Rejoin History ({rejoins.length})</h3>
        </div>
        <>
        <div className="md:hidden space-y-2 p-3">
          {rejoins.length === 0 ? <p className="text-center py-6 text-gray-400 text-sm">কোনো rejoin history নেই।</p>
           : rejoins.map((r, idx) => (
             <MobileRejoinHistoryCard key={r.id} r={r} idx={idx} fmtDate={fmtDate} handleDeleteRejoin={handleDeleteRejoin} />
           ))}
        </div>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#23445f] text-white text-xs uppercase tracking-wide">
                <th className="px-4 py-2.5 text-center font-semibold w-12">SN</th>
                <th className="px-4 py-2.5 text-left font-semibold">Employee</th>
                <th className="px-4 py-2.5 text-left font-semibold">Designation</th>
                <th className="px-4 py-2.5 text-center font-semibold">Previous Resign</th>
                <th className="px-4 py-2.5 text-center font-semibold">Rejoin Date</th>
                <th className="px-4 py-2.5 text-left font-semibold">Notes</th>
                <th className="px-4 py-2.5 text-left font-semibold">Created By</th>
                <th className="px-4 py-2.5 text-center font-semibold w-16">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-10 text-gray-400">লোড হচ্ছে...</td></tr>
              ) : rejoins.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-gray-400">কোনো rejoin history নেই।</td></tr>
              ) : rejoins.map((r, idx) => (
                <tr key={r.id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'} hover:bg-teal-50/40 transition-colors border-b border-gray-100`}>
                  <td className="px-4 py-2.5 text-center font-mono text-xs text-gray-500">{idx + 1}</td>
                  <td className="px-4 py-2.5">
                    <p className="font-semibold text-gray-800">{r.employee_name}</p>
                    <p className="text-[11px] text-gray-500 font-mono">{r.employee_code}</p>
                  </td>
                  <td className="px-4 py-2.5 text-gray-700 text-sm">{r.employee_designation || '—'}</td>
                  <td className="px-4 py-2.5 text-center font-mono text-xs text-gray-600">{fmtDate(r.previous_resign_date)}</td>
                  <td className="px-4 py-2.5 text-center font-mono text-xs text-emerald-700 font-semibold">{fmtDate(r.rejoin_date)}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs max-w-xs truncate" title={r.notes}>{r.notes || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-700 text-xs">{r.created_by_name || '—'}</td>
                  <td className="px-4 py-2.5 text-center">
                    <button onClick={() => handleDeleteRejoin(r)} title="Delete record"
                      className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 transition border border-rose-200 mx-auto">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      </div>

      {target && (
        <RejoinModal employee={target} resignations={resignations}
          onClose={() => setTarget(null)}
          onDone={() => { setTarget(null); load(); }} />
      )}
    </div>
  );
}
