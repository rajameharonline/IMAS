// HR & Payroll — Attendance পেজ (date-wise bulk হাজিরা)
// নির্দিষ্ট তারিখের জন্য সব active employee-র status + check-in/out + notes
// একসাথে সেভ — /hr/attendance/bulk/ endpoint দিয়ে update-or-create
import { useEffect, useState, useCallback, useMemo } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const inp = 'w-full border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition';
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => d
  ? new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
  : '—';

const STATUS_OPTIONS = [
  { value: 'present',  label: 'Present',  color: 'bg-emerald-100 text-emerald-700' },
  { value: 'absent',   label: 'Absent',   color: 'bg-rose-100 text-rose-700' },
  { value: 'late',     label: 'Late',     color: 'bg-amber-100 text-amber-700' },
  { value: 'half_day', label: 'Half Day', color: 'bg-orange-100 text-orange-700' },
  { value: 'leave',    label: 'Leave',    color: 'bg-blue-100 text-blue-700' },
];
const statusCfg = (s) => STATUS_OPTIONS.find(o => o.value === s) || STATUS_OPTIONS[0];

/* ── Mobile Attendance Card (interactive inputs) ── */
function MobileAttendanceCard({ e, idx, rec, update }) {
  const isEven = idx % 2 === 0;
  const cfg = (STATUS_OPTIONS.find(o => o.value === rec.status) || STATUS_OPTIONS[0]);
  const FRow = ({ label, children }) => (
    <div className="flex items-stretch border-b border-gray-200 last:border-0">
      <div className="w-28 shrink-0 bg-gray-50 px-3 py-2.5 flex items-center border-r border-gray-200">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex-1 min-w-0 px-3 py-2 flex items-center justify-end bg-white">{children}</div>
    </div>
  );
  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${isEven ? 'bg-white border-gray-200' : 'bg-slate-50/40 border-gray-200'}`}>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-[#23445f]/5 border-b border-gray-200">
        <div className="min-w-0">
          <p className="font-bold text-gray-900 text-[13px] truncate">{e.full_name}</p>
          <p className="font-mono text-[11px] text-gray-400">{e.employee_id}</p>
        </div>
        <select value={rec.status} onChange={ev => update(e.id, 'status', ev.target.value)}
          className={`text-[11px] font-semibold rounded-lg px-2 py-1.5 border-0 outline-none focus:ring-1 focus:ring-teal-400 ${cfg.color}`}>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div>
        <FRow label="Designation"><span className="text-[12px] text-gray-700">{e.designation || '—'}</span></FRow>
        <FRow label="Check In">
          <input type="time" value={rec.check_in || ''} onChange={ev => update(e.id, 'check_in', ev.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-teal-400" />
        </FRow>
        <FRow label="Check Out">
          <input type="time" value={rec.check_out || ''} onChange={ev => update(e.id, 'check_out', ev.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-teal-400" />
        </FRow>
        <FRow label="Notes">
          <input type="text" value={rec.notes || ''} onChange={ev => update(e.id, 'notes', ev.target.value)}
            placeholder="Notes..." className="w-full border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-teal-400" />
        </FRow>
      </div>
    </div>
  );
}

export default function AttendancePage() {
  const [date,      setDate]      = useState(today());
  const [employees, setEmployees] = useState([]);
  const [records,   setRecords]   = useState({});  // { employee_id: {status, check_in, check_out, notes} }
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [search,    setSearch]    = useState('');

  /* ── এক তারিখের জন্য employees + existing attendance লোড ── */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [empRes, attRes] = await Promise.all([
        api.get('/hr/employees/?status=active&page_size=500&ordering=full_name'),
        api.get(`/hr/attendance/?date=${date}&page_size=500`),
      ]);
      const emps = empRes.data?.results ?? empRes.data ?? [];
      const atts = attRes.data?.results ?? attRes.data ?? [];
      setEmployees(emps);

      // existing attendance → records map; বাকিদের default 'present'
      const map = {};
      emps.forEach(e => { map[e.id] = { status: 'present', check_in: '', check_out: '', notes: '' }; });
      atts.forEach(a => {
        map[a.employee] = {
          status:    a.status,
          check_in:  a.check_in || '',
          check_out: a.check_out || '',
          notes:     a.notes || '',
        };
      });
      setRecords(map);
    } catch { toast.error('Attendance ডেটা লোড ব্যর্থ।'); }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const update = (empId, field, val) =>
    setRecords(prev => ({ ...prev, [empId]: { ...prev[empId], [field]: val } }));

  /* ── এক ক্লিকে সবার status set ── */
  const markAll = (status) => {
    setRecords(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(id => { next[id] = { ...next[id], status }; });
      return next;
    });
    toast.success(`সবাইকে ${statusCfg(status).label} mark করা হলো`);
  };

  /* ── Bulk save ── */
  const saveAll = async () => {
    setSaving(true);
    try {
      const payload = {
        date,
        records: employees.map(e => ({
          employee:  e.id,
          status:    records[e.id]?.status || 'present',
          check_in:  records[e.id]?.check_in || null,
          check_out: records[e.id]?.check_out || null,
          notes:     records[e.id]?.notes || '',
        })),
      };
      const r = await api.post('/hr/attendance/bulk/', payload);
      toast.success(`✅ ${r.data?.saved || 0} জনের হাজিরা সেভ হয়েছে`);
    } catch { toast.error('Save ব্যর্থ।'); }
    finally { setSaving(false); }
  };

  /* ── Search + summary ── */
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return employees;
    return employees.filter(e =>
      e.full_name?.toLowerCase().includes(q) ||
      e.employee_id?.toLowerCase().includes(q) ||
      e.designation?.toLowerCase().includes(q),
    );
  }, [employees, search]);

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, half_day: 0, leave: 0 };
    Object.values(records).forEach(r => { if (c[r.status] !== undefined) c[r.status]++; });
    return c;
  }, [records]);

  return (
    <div className="p-4 sm:p-6 min-h-screen bg-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="font-slab text-2xl font-bold text-gray-900 flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-sm">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </span>
          Attendance
        </h1>
        <div className="text-xs text-gray-400 hidden sm:flex items-center gap-1">
          <span className="text-teal-600 font-medium">HR &amp; Payroll</span><span>›</span><span>Attendance</span>
        </div>
      </div>

      {/* Summary cards — status counts */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {STATUS_OPTIONS.map(o => (
          <div key={o.value} className="rounded-xl bg-white border border-gray-200 p-4 shadow-sm">
            <p className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">{o.label}</p>
            <p className={`text-2xl font-bold font-slab mt-1 ${o.color.split(' ')[1]}`}>
              {counts[o.value] || 0}
            </p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1.5">
              Date <span className="text-rose-500">*</span>
            </label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <p className="text-[10.5px] text-gray-400 mt-1">{fmtDate(date)}</p>
          </div>

          <div className="flex items-end gap-2 ml-auto flex-wrap">
            <div>
              <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1.5">Mark All</label>
              <div className="flex items-center gap-1">
                {STATUS_OPTIONS.map(o => (
                  <button key={o.value} onClick={() => markAll(o.value)}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg ${o.color} hover:opacity-80`}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1.5">Search</label>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Name, ID, designation..."
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <button onClick={saveAll} disabled={saving || loading}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60">
              {saving && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Save All
            </button>
          </div>
        </div>
      </div>

      {/* Employee attendance table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <>
        <div className="md:hidden space-y-2 p-3">
          {loading ? <p className="text-center py-6 text-gray-400 text-sm">লোড হচ্ছে...</p>
           : filtered.length === 0 ? <p className="text-center py-6 text-gray-400 text-sm">কোনো active employee নেই।</p>
           : filtered.map((e, idx) => (
             <MobileAttendanceCard key={e.id} e={e} idx={idx}
               rec={records[e.id] || { status: 'present', check_in: '', check_out: '', notes: '' }}
               update={update} />
           ))}
        </div>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="bg-[#23445f] text-white text-xs uppercase tracking-wide">
                <th className="px-3 py-3 text-center font-semibold w-12">SN</th>
                <th className="px-3 py-3 text-left font-semibold">Employee</th>
                <th className="px-3 py-3 text-left font-semibold">Designation</th>
                <th className="px-3 py-3 text-center font-semibold w-32">Status</th>
                <th className="px-3 py-3 text-center font-semibold w-28">Check In</th>
                <th className="px-3 py-3 text-center font-semibold w-28">Check Out</th>
                <th className="px-3 py-3 text-left font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-10 text-gray-400">লোড হচ্ছে...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-10 text-gray-400">কোনো active employee নেই।</td></tr>
              ) : filtered.map((e, idx) => {
                const rec = records[e.id] || { status: 'present', check_in: '', check_out: '', notes: '' };
                const cfg = statusCfg(rec.status);
                return (
                  <tr key={e.id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'} hover:bg-teal-50/40 transition-colors border-b border-gray-100`}>
                    <td className="px-3 py-2 text-center font-mono text-xs text-gray-500">{idx + 1}</td>
                    <td className="px-3 py-2">
                      <p className="font-semibold text-gray-800">{e.full_name}</p>
                      <p className="text-[11px] text-gray-500 font-mono">{e.employee_id}</p>
                    </td>
                    <td className="px-3 py-2 text-gray-700 text-sm">{e.designation || '—'}</td>
                    <td className="px-3 py-2">
                      <select value={rec.status} onChange={ev => update(e.id, 'status', ev.target.value)}
                        className={`${inp} font-semibold ${cfg.color}`}>
                        {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input type="time" value={rec.check_in || ''} onChange={ev => update(e.id, 'check_in', ev.target.value)}
                        className={inp} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="time" value={rec.check_out || ''} onChange={ev => update(e.id, 'check_out', ev.target.value)}
                        className={inp} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="text" value={rec.notes || ''} onChange={ev => update(e.id, 'notes', ev.target.value)}
                        placeholder="Optional note..." className={inp} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      </div>
    </div>
  );
}
