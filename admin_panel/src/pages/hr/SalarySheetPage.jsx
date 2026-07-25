// HR & Payroll — Salary Sheet পেজ (মাসিক salary report)
// নির্দিষ্ট মাসের সব active employee-র payslip data table আকারে দেখায়
// (payslip তৈরি না হলে "Not generated" দেখাবে); নিচে totals + print
import { useEffect, useState, useCallback, useMemo } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const currentMonth = () => new Date().toISOString().slice(0, 7);   // YYYY-MM
const fmtMoney = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const periodLabel = (m) => {
  if (!m) return '';
  const [y, mm] = m.split('-');
  return `${MONTHS_SHORT[parseInt(mm, 10) - 1]} ${y}`;
};

/* ─── Status badge ──────────────────────────────────────────────────────── */
function StatusBadge({ status }) {
  const cfg = {
    paid:    { bg: 'bg-emerald-100 text-emerald-700', label: 'Fully Paid' },
    partial: { bg: 'bg-amber-100 text-amber-700',     label: 'Partial'    },
    unpaid:  { bg: 'bg-rose-100 text-rose-700',       label: 'Unpaid'     },
    none:    { bg: 'bg-gray-100 text-gray-500',       label: 'Not Generated' },
  }[status] || { bg: 'bg-gray-100 text-gray-500', label: status };
  return <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${cfg.bg}`}>{cfg.label}</span>;
}

/* ── Mobile Salary Card ── */
function MobileSalaryCard({ r, idx }) {
  const isEven = idx % 2 === 0;
  const generated = r.payment_status !== 'none' && r.payment_status !== undefined;
  const FRow = ({ label, children }) => (
    <div className="flex items-stretch border-b border-gray-200 last:border-0">
      <div className="w-28 shrink-0 bg-gray-50 px-3 py-2.5 flex items-center border-r border-gray-200">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex-1 min-w-0 px-3 py-2.5 flex items-center justify-end bg-white">{children}</div>
    </div>
  );
  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${isEven ? 'bg-white border-gray-200' : 'bg-slate-50/40 border-gray-200'} ${!generated ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-[#23445f]/5 border-b border-gray-200">
        <div className="min-w-0">
          <p className="font-bold text-gray-900 text-[13px] truncate">{r.employee_name}</p>
          <p className="font-mono text-[11px] text-gray-400">{r.employee_code}</p>
        </div>
        <StatusBadge status={r.payment_status || 'none'} />
      </div>
      <div className="grid grid-cols-2 divide-x divide-gray-200 border-b border-gray-200">
        <div className="flex flex-col px-3 py-2.5">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Basic</span>
          <span className="font-mono text-[12px] font-semibold text-gray-800">{fmtMoney(r.basic_salary)}</span>
        </div>
        <div className="flex flex-col px-3 py-2.5">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Net Salary</span>
          <span className="font-mono text-[12px] font-bold text-gray-900">{fmtMoney(r.net_salary)}</span>
        </div>
      </div>
      <div>
        <FRow label="Designation"><span className="text-[12px] text-gray-700 truncate">{r.designation || '—'}</span></FRow>
        <FRow label="Payroll"><span className="text-[12px] text-gray-700">{r.payroll_name || '—'}</span></FRow>
        <FRow label="Additions"><span className="font-mono text-[12px] text-emerald-600">+{fmtMoney(r.total_addition)}</span></FRow>
        <FRow label="Deductions"><span className="font-mono text-[12px] text-rose-600">−{fmtMoney(r.total_deduction)}</span></FRow>
        <FRow label="Paid"><span className="font-mono text-[12px] font-semibold text-emerald-600">{fmtMoney(r.paid_amount)}</span></FRow>
        <FRow label="Due">
          {Number(r.due_amount) > 0
            ? <span className="font-mono text-[12px] font-bold text-rose-600">{fmtMoney(r.due_amount)}</span>
            : <span className="font-mono text-[12px] text-gray-300">—</span>}
        </FRow>
      </div>
    </div>
  );
}

export default function SalarySheetPage() {
  const [month,     setMonth]     = useState(currentMonth());
  const [employees, setEmployees] = useState([]);
  const [payslips,  setPayslips]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [empRes, psRes] = await Promise.all([
        api.get('/hr/employees/?status=active&page_size=500&ordering=full_name'),
        api.get(`/hr/payroll/?month=${month}&page_size=1000`),
      ]);
      setEmployees(empRes.data?.results ?? empRes.data ?? []);
      setPayslips(psRes.data?.results ?? psRes.data ?? []);
    } catch { toast.error('ডেটা লোড ব্যর্থ।'); }
    finally { setLoading(false); }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  /* ── Merge: প্রতিটি active employee-র জন্য একটি row (payslip থাকলে data, নয়তো blank) ── */
  const rows = useMemo(() => {
    const psMap = {};
    payslips.forEach(p => { psMap[p.employee] = p; });
    return employees.map(e => {
      const ps = psMap[e.id];
      if (!ps) {
        return {
          employee_id: e.id, employee_name: e.full_name, employee_code: e.employee_id,
          designation: e.designation, payroll_name: e.payroll_name || '—',
          basic_salary: 0, total_addition: 0, total_deduction: 0,
          net_salary: 0, paid_amount: 0, due_amount: 0,
          payment_status: 'none', generated: false,
        };
      }
      return {
        employee_id: e.id, employee_name: e.full_name, employee_code: e.employee_id,
        designation: e.designation, payroll_name: e.payroll_name || ps.payroll_name || '—',
        basic_salary: Number(ps.basic_salary), total_addition: Number(ps.total_addition),
        total_deduction: Number(ps.total_deduction), net_salary: Number(ps.net_salary),
        paid_amount: Number(ps.paid_amount), due_amount: Number(ps.due_amount),
        payment_status: ps.payment_status, generated: true,
      };
    });
  }, [employees, payslips]);

  /* ── Search ── */
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return rows;
    return rows.filter(r =>
      r.employee_name?.toLowerCase().includes(q) ||
      r.employee_code?.toLowerCase().includes(q) ||
      r.designation?.toLowerCase().includes(q),
    );
  }, [rows, search]);

  /* ── Totals + summary ── */
  const totals = useMemo(() => {
    let net = 0, paid = 0, due = 0, gen = 0;
    rows.forEach(r => {
      if (r.generated) gen++;
      net += r.net_salary; paid += r.paid_amount; due += r.due_amount;
    });
    return { net, paid, due, gen, total: rows.length };
  }, [rows]);

  /* ── Print ── */
  const handlePrint = () => {
    const w = window.open('', '_blank', 'width=1100,height=900');
    if (!w) return toast.error('Pop-up blocker enabled');
    const html = document.getElementById('salary-sheet-print').innerHTML;
    w.document.write(`<html><head><title>Salary Sheet - ${periodLabel(month)}</title>
      <style>
        body { font-family: -apple-system, system-ui, sans-serif; padding: 24px; color: #111; }
        h1 { margin: 0 0 4px; font-size: 18px; }
        h2 { margin: 0 0 16px; font-size: 13px; color: #555; font-weight: normal; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; }
        th { background: #1c2333; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
        td.right, th.right { text-align: right; font-family: ui-monospace, Menlo, monospace; }
        td.center { text-align: center; }
        tr.totals { font-weight: bold; background: #ecfdf5; }
        tr.totals td { border-top: 2px solid #0d9488; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 600; }
      </style></head><body>
      <h1>Salary Sheet — ${periodLabel(month)}</h1>
      <h2>Generated on ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</h2>
      ${html}
      <script>window.print(); setTimeout(() => window.close(), 500);</script>
      </body></html>`);
    w.document.close();
  };

  return (
    <div className="p-4 sm:p-6 min-h-screen bg-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="font-slab text-2xl font-bold text-gray-900 flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-sm">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </span>
          Salary Sheet
        </h1>
        <div className="flex items-center gap-3">
          <div className="text-xs text-gray-400 hidden sm:flex items-center gap-1">
            <span className="text-teal-600 font-medium">HR &amp; Payroll</span><span>›</span><span>Salary Sheet</span>
          </div>
          <button onClick={handlePrint}
            className="inline-flex items-center gap-1.5 bg-[#1c2333] hover:bg-[#2a3347] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <div className="rounded-xl bg-white border border-gray-200 p-4 shadow-sm">
          <p className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Total Employees</p>
          <p className="text-2xl font-bold font-slab text-gray-900 mt-1">{totals.total}</p>
        </div>
        <div className="rounded-xl bg-white border border-teal-100 p-4 shadow-sm">
          <p className="text-[10px] uppercase font-bold text-teal-600 tracking-wider">Generated</p>
          <p className="text-2xl font-bold font-slab text-teal-700 mt-1">{totals.gen}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">of {totals.total}</p>
        </div>
        <div className="rounded-xl bg-white border border-gray-200 p-4 shadow-sm">
          <p className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Total Net</p>
          <p className="text-2xl font-bold font-slab text-gray-900 mt-1">{fmtMoney(totals.net)}</p>
        </div>
        <div className="rounded-xl bg-white border border-emerald-100 p-4 shadow-sm">
          <p className="text-[10px] uppercase font-bold text-emerald-600 tracking-wider">Total Paid</p>
          <p className="text-2xl font-bold font-slab text-emerald-600 mt-1">{fmtMoney(totals.paid)}</p>
        </div>
        <div className="rounded-xl bg-white border border-rose-100 p-4 shadow-sm">
          <p className="text-[10px] uppercase font-bold text-rose-600 tracking-wider">Outstanding Due</p>
          <p className="text-2xl font-bold font-slab text-rose-600 mt-1">{fmtMoney(totals.due)}</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1.5">
              Month <span className="text-rose-500">*</span>
            </label>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <p className="text-[10.5px] text-gray-400 mt-1">{periodLabel(month)}</p>
          </div>
          <div className="ml-auto">
            <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1.5">Search</label>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Name, ID, designation..."
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
        </div>
      </div>

      {/* Sheet */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" id="salary-sheet-print">
        <>
        <div className="md:hidden space-y-2 p-3">
          {loading ? <p className="text-center py-6 text-gray-400 text-sm">লোড হচ্ছে...</p>
           : filtered.length === 0 ? <p className="text-center py-6 text-gray-400 text-sm">কোনো employee নেই।</p>
           : filtered.map((r, idx) => <MobileSalaryCard key={r.employee_id} r={r} idx={idx} />)}
        </div>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="bg-[#23445f] text-white text-xs uppercase tracking-wide">
                <th className="px-3 py-3 text-center font-semibold w-12">SN</th>
                <th className="px-3 py-3 text-left font-semibold">Employee</th>
                <th className="px-3 py-3 text-left font-semibold">Designation</th>
                <th className="px-3 py-3 text-left font-semibold">Payroll</th>
                <th className="px-3 py-3 text-right font-semibold">Basic</th>
                <th className="px-3 py-3 text-right font-semibold">Additions</th>
                <th className="px-3 py-3 text-right font-semibold">Deductions</th>
                <th className="px-3 py-3 text-right font-semibold">Net</th>
                <th className="px-3 py-3 text-right font-semibold">Paid</th>
                <th className="px-3 py-3 text-right font-semibold">Due</th>
                <th className="px-3 py-3 text-center font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} className="text-center py-10 text-gray-400">লোড হচ্ছে...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={11} className="text-center py-10 text-gray-400">কোনো employee নেই।</td></tr>
              ) : filtered.map((r, idx) => (
                <tr key={r.employee_id}
                    className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'} ${r.generated ? '' : 'opacity-70'} hover:bg-teal-50/40 transition-colors border-b border-gray-100`}>
                  <td className="px-3 py-2 text-center font-mono text-xs text-gray-500">{idx + 1}</td>
                  <td className="px-3 py-2">
                    <p className="font-semibold text-gray-800">{r.employee_name}</p>
                    <p className="text-[11px] text-gray-500 font-mono">{r.employee_code}</p>
                  </td>
                  <td className="px-3 py-2 text-gray-700 text-sm">{r.designation || '—'}</td>
                  <td className="px-3 py-2 text-gray-700 text-xs">{r.payroll_name}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-800">{fmtMoney(r.basic_salary)}</td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-700">{fmtMoney(r.total_addition)}</td>
                  <td className="px-3 py-2 text-right font-mono text-rose-600">{r.total_deduction > 0 ? '−' : ''}{fmtMoney(r.total_deduction)}</td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-gray-900">{fmtMoney(r.net_salary)}</td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-600">{fmtMoney(r.paid_amount)}</td>
                  <td className="px-3 py-2 text-right font-mono text-rose-600">{fmtMoney(r.due_amount)}</td>
                  <td className="px-3 py-2 text-center"><StatusBadge status={r.payment_status} /></td>
                </tr>
              ))}
            </tbody>
            {!loading && filtered.length > 0 && (
              <tfoot>
                <tr className="bg-emerald-50 border-t-2 border-emerald-200 font-bold">
                  <td colSpan={4} className="px-3 py-3 text-right text-emerald-700 uppercase text-xs tracking-wide">Totals</td>
                  <td className="px-3 py-3 text-right font-mono text-gray-900">
                    {fmtMoney(filtered.reduce((s, r) => s + r.basic_salary, 0))}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-emerald-700">
                    {fmtMoney(filtered.reduce((s, r) => s + r.total_addition, 0))}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-rose-600">
                    −{fmtMoney(filtered.reduce((s, r) => s + r.total_deduction, 0))}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-gray-900">
                    {fmtMoney(filtered.reduce((s, r) => s + r.net_salary, 0))}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-emerald-700">
                    {fmtMoney(filtered.reduce((s, r) => s + r.paid_amount, 0))}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-rose-600">
                    {fmtMoney(filtered.reduce((s, r) => s + r.due_amount, 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        </>
      </div>
    </div>
  );
}
