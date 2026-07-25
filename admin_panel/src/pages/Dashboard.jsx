import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { usePermission } from '../context/PermissionContext';
import { useAuth } from '../context/AuthContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

// ── Card → granular permission (dashboard_cards) mapping ───────────────
// Employee Panel-এ কোন stat card দেখাবে তা admin "Dashboard (Employee)" module-এর
// granular card permission দিয়ে নিয়ন্ত্রিত। superadmin/admin (isSuper) সব দেখে।
// Non-super employee: 'dashboard' module enabled থাকতে হবে + সংশ্লিষ্ট card key
// granular-এ tick থাকতে হবে — নাহলে card দেখাবে না।
// এই key গুলো AppUsersPage-এর STATIC_GRANULAR.dashboard_cards ও backend
// module_definitions.GRANULAR_PERMISSIONS['dashboard_cards']-এর সাথে হুবহু মিলবে।
const CARD_GRANULAR = {
  // Top cards
  'Total Client': 'total_client', 'Running Clients': 'running_clients', 'Inactive Clients': 'inactive_clients', 'Waiver Clients': 'waiver_clients',
  'New Client': 'new_client', 'Renewed Clients': 'renewed_clients', 'Deactivated Clients': 'deactivated_clients', 'Left Clients': 'left_clients',
  'Billing Clients': 'billing_clients', 'Paid Clients': 'paid_clients', 'Partially Paid': 'partially_paid', 'Unpaid Clients': 'unpaid_clients',
  'Online Clients': 'online_clients', 'Blocked Clients': 'blocked_clients', 'Bill Date Expire': 'bill_date_expire', 'Unpaid Extension': 'unpaid_extension',
  'Total Pop': 'total_pop', 'Total Pop Clients': 'total_pop_clients', 'Enabled Pop Clients': 'enabled_pop_clients', 'Disabled Pop Clients': 'disabled_pop_clients',
  // Ticket / task cards
  'Pending Tickets': 'pending_tickets', 'Processing Tickets': 'processing_tickets',
  'Pending Task': 'pending_task', 'Processing Task': 'processing_task',
  // Bottom cards
  'Monthly Bill': 'monthly_bill', 'Collected Bill': 'collected_bill', 'Discount': 'discount', 'Total Due': 'total_due',
  'Service Sales Invoice': 'service_sales_invoice', 'Product Sales Invoice': 'product_sales_invoice', 'Income': 'income', 'Expense': 'expense',
  'Credited Amount': 'credited_amount', 'POP Fund': 'pop_fund', 'POP Bill': 'pop_bill', 'Receivable Amount': 'receivable_amount',
  'B.Width Provider Bill': 'bwidth_provider_bill', 'B.Width Provider Due': 'bwidth_provider_due', 'B.Width POP Bill': 'bwidth_pop_bill', 'Paid Salary': 'paid_salary',
  'SMS Balance': 'sms_balance', 'Purchase Payable Due': 'purchase_payable_due', 'Purchase Paid Amount': 'purchase_paid_amount', 'Cash On Hand': 'cash_on_hand',
};

// Module 6 — Dashboard widgets-এ ticket data রঙ-নির্দেশ; ধারাবাহিক palette।
const ZONE_COLORS = ['#0d9488', '#0ea5e9', '#a855f7', '#f59e0b', '#ef4444', '#22c55e', '#6366f1', '#ec4899'];

// ── Gradient stat card — boxed icon panel + content + footer caption ──
// Layout reference: rajameharonline.ispdigital.cloud .info-box-2 (icon block
// bg rgba(0,0,0,.12), content, absolute-style footer strip) — এখানে flex-col
// দিয়ে stack করা হয়েছে (responsive-friendly, variable-length sub টেক্সটেও ভাঙে না)।
function StatCard({ icon, label, value, sub, from, to, link }) {
  const navigate = useNavigate();
  const go = () => link && navigate(link);
  return (
    <div
      onClick={go}
      role={link ? 'button' : undefined}
      tabIndex={link ? 0 : undefined}
      onKeyDown={link ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } } : undefined}
      className={`stat-card-wipe rounded-[5px] shadow-[0_2px_10px_rgba(0,0,0,0.2)]
        ${link ? 'cursor-pointer hover:shadow-[0_3px_14px_rgba(0,0,0,0.3)] active:scale-[0.98] transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70' : ''}`}
      style={{ backgroundImage: `linear-gradient(45deg, ${from} 0%, ${to} 100%)` }}
    >
      <div className="flex items-stretch">
        <div className="w-16 sm:w-20 shrink-0 flex items-center justify-center py-3" style={{ backgroundColor: 'rgba(0,0,0,0.12)' }}>
          <i className={`${icon} text-white text-[32px] sm:text-[38px] leading-none`} />
        </div>
        <div className="min-w-0 flex-1 px-3 py-2 text-white">
          <p className="text-[12px] font-semibold leading-tight truncate">{label}</p>
          <p className="text-2xl font-bold leading-snug truncate">{value ?? 0}</p>
        </div>
      </div>
      <div className="text-white/90 text-[9px] text-center leading-snug px-2 py-1" style={{ backgroundColor: 'rgba(0,0,0,0.12)' }}>
        {sub}
      </div>
    </div>
  );
}

// ── Ticket / task card ────────────────────────────────────────────────
// link থাকলে card clickable হয়ে নির্দিষ্ট list page-এ (যেমন
// /support/tickets?status=open) navigate করে — Dashboard থেকে drill-down।
// একই boxed-icon layout, শুধু StatCard-এর তুলনায় compact (reference-এ
// cus-design-four-card-inone, height ~79px)।
function TicketCard({ icon, label, value, sub, from, to, link }) {
  const navigate = useNavigate();
  const go = () => link && navigate(link);
  return (
    <div
      onClick={go}
      role={link ? 'button' : undefined}
      tabIndex={link ? 0 : undefined}
      onKeyDown={link ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } } : undefined}
      className={`stat-card-wipe rounded-[5px] shadow-[0_2px_10px_rgba(0,0,0,0.2)]
        ${link ? 'cursor-pointer hover:shadow-[0_3px_14px_rgba(0,0,0,0.3)] active:scale-[0.98] transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70' : ''}`}
      style={{ backgroundImage: `linear-gradient(45deg, ${from} 0%, ${to} 100%)` }}
    >
      <div className="flex items-stretch">
        <div className="w-14 shrink-0 flex items-center justify-center py-2" style={{ backgroundColor: 'rgba(0,0,0,0.12)' }}>
          <i className={`${icon} text-white text-2xl leading-none`} />
        </div>
        <div className="min-w-0 flex-1 px-3 py-1.5 text-white">
          <p className="text-[11px] font-semibold leading-tight truncate">{label}</p>
          <p className="text-xl font-bold leading-tight truncate">{value ?? 0}</p>
        </div>
      </div>
      <div className="text-white/90 text-[9px] text-center leading-snug px-2 py-1 line-clamp-1" style={{ backgroundColor: 'rgba(0,0,0,0.12)' }}>
        {sub}
      </div>
    </div>
  );
}

// ── Module 6: Zone/Sub-zone donut chart ────────────────────────────────
// Recharts PieChart দিয়ে current month-এর zone-wise problem occurrence।
// কেন Pie: zone সাধারণত কম-সংখ্যক (৫-১০), donut ভালোভাবে proportion দেখায়।
function ProblemPieChart({ title, data = [], height = 180 }) {
  const hasData = data.some((d) => d.count > 0);
  return (
    <div className="bg-white rounded-lg shadow-sm p-4 flex flex-col">
      <p className="text-xs font-semibold text-gray-700 mb-2 text-center">{title}</p>
      {hasData ? (
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="name"
              innerRadius={32} outerRadius={62}
              paddingAngle={2} stroke="#fff" strokeWidth={1}>
              {data.map((_, i) => (
                <Cell key={i} fill={ZONE_COLORS[i % ZONE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v, n) => [v, n]}
              contentStyle={{ fontSize: 11, padding: '4px 8px' }} />
            <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
          </PieChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-xs" style={{ minHeight: height }}>
          No data
        </div>
      )}
    </div>
  );
}

// ── Module 6: Horizontal bar chart for Most Problem Solver ─────────────
// Top-10 employee leaderboard — কে কতগুলো ticket resolve করেছে।
function SolverBarChart({ title, data = [], height = 200 }) {
  const hasData = data.length > 0;
  return (
    <div className="bg-white rounded-lg shadow-sm p-4">
      <p className="text-xs font-semibold text-gray-700 mb-3 text-center">{title}</p>
      {hasData ? (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={90} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Bar dataKey="count" fill="#0d9488" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center text-gray-400 text-xs" style={{ height }}>
          No data
        </div>
      )}
    </div>
  );
}

// ── Module 6: Monthly Problem Occurrence (last 12 months) ──────────────
function MonthlyTrendChart({ title, data = [], height = 180 }) {
  const hasData = data.some((d) => d.count > 0);
  return (
    <div className="bg-white rounded-lg shadow-sm p-4">
      <p className="text-xs font-semibold text-gray-700 mb-3 text-center">{title}</p>
      {hasData ? (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} barSize={18}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={50} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Bar dataKey="count" fill="#a855f7" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center text-gray-400 text-xs" style={{ height }}>
          No data
        </div>
      )}
    </div>
  );
}

// ── Card color cycling helpers ────────────────────────────────────────
// হেক্স কালার হুবহু reference site (rajameharonline.ispdigital.cloud) থেকে
// নেওয়া — custom-style.css: .blue-gradiant/.orange-gradiant/.green-gradiant/
// .red-gradiant (নামগুলো ঐ সাইটেও প্রকৃত রঙের সাথে মেলে না, সেটাই মূল উৎসে আছে)।
const GRADIENTS = [
  { from: '#0288d1', to: '#26c6da' }, // blue-gradiant
  { from: '#2CB8B8', to: '#2EBABA' }, // orange-gradiant (teal)
  { from: '#825BEC', to: '#898CC6' }, // green-gradiant (purple)
  { from: '#555E65', to: '#585F65' }, // red-gradiant (slate)
];
function g(i) { return GRADIENTS[i % 4]; }
// Ticket/task card-এর জন্য reference-এর .pending-gradiant ও .processing-gradiant
const PENDING_GRADIANT    = { from: '#fb483a', to: '#b1261b' };
const PROCESSING_GRADIANT = { from: '#ff9600', to: '#a97224' };

// ── Employee profile card (screenshot অনুযায়ী) ─────────────────────────
function EmployeeProfileCard({ emp, user }) {
  const photo = emp?.photo;
  const statusCfg = {
    active:   { bg: 'bg-emerald-100 text-emerald-700', label: 'Active' },
    inactive: { bg: 'bg-gray-100 text-gray-500',       label: 'Inactive' },
    resigned: { bg: 'bg-rose-100 text-rose-700',       label: 'Resigned' },
  }[emp?.status] || { bg: 'bg-gray-100 text-gray-500', label: emp?.status || '—' };
  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      <h3 className="text-center font-bold text-gray-800 text-lg py-3 border-b border-gray-100">
        {emp?.full_name || user?.full_name || user?.username}
      </h3>
      <div className="flex justify-center py-4">
        {photo ? (
          <img src={photo} alt={emp?.full_name}
            className="w-36 h-36 object-cover rounded-md border border-gray-200" />
        ) : (
          <div className="w-36 h-36 rounded-md bg-gray-100 flex items-center justify-center text-gray-300">
            <svg className="w-24 h-24" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
            </svg>
          </div>
        )}
      </div>
      <div className="bg-cyan-50/60 px-5 py-4 space-y-2.5 text-sm text-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-gray-400">👤</span>
          <span className="font-semibold">Employee Code:</span>
          <span>{emp?.employee_id || '—'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-400">👤</span>
          <span className="font-semibold">User ID/IP:</span>
          <span>{user?.username || '—'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-400">👤</span>
          <span className="font-semibold">Status:</span>
          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${statusCfg.bg}`}>
            {statusCfg.label}
          </span>
        </div>
        {emp?.designation && (
          <div className="flex items-center gap-2">
            <span className="text-gray-400">💼</span>
            <span className="font-semibold">Designation:</span>
            <span>{emp.designation}</span>
          </div>
        )}
        {emp?.department_name_display && (
          <div className="flex items-center gap-2">
            <span className="text-gray-400">🏢</span>
            <span className="font-semibold">Department:</span>
            <span>{emp.department_name_display}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Employee Salary Sheet (admin-এর ticket/tax card style) ─────────────
function EmployeeSalarySheet({ emp }) {
  const fmt = (v) => `৳${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const ps = emp?.current_payslip;
  const recent = emp?.recent_payslips || [];
  const month = new Date().toLocaleString('en-US', { month: 'short', year: 'numeric' });

  // চলতি মাসের salary summary card (ticket card-এর মতো gradient)
  const SALARY_CARDS = [
    { icon: 'fas fa-money-bill-wave',  label: `Net Salary (${month})`, value: fmt(ps?.net_salary ?? emp?.basic_salary), sub: 'Current month net payable salary', from: GRADIENTS[0].from, to: GRADIENTS[0].to },
    { icon: 'fas fa-check-circle',     label: 'Paid Amount',           value: fmt(ps?.paid_amount),                     sub: 'Amount received this month',       from: GRADIENTS[1].from, to: GRADIENTS[1].to },
    { icon: 'fas fa-exclamation-triangle', label: 'Due Amount',        value: fmt(ps?.due_amount),                      sub: 'Remaining salary due this month',  from: PENDING_GRADIANT.from, to: PENDING_GRADIANT.to },
    { icon: 'fas fa-university',       label: 'Basic Salary',          value: fmt(emp?.basic_salary),                   sub: 'Your configured basic salary',     from: GRADIENTS[2].from, to: GRADIENTS[2].to },
  ];

  const statusBadge = (s) => {
    const cfg = {
      paid:    'bg-emerald-100 text-emerald-700',
      partial: 'bg-amber-100 text-amber-700',
      unpaid:  'bg-rose-100 text-rose-700',
    }[s] || 'bg-gray-100 text-gray-500';
    const label = { paid: 'Fully Paid', partial: 'Partial', unpaid: 'Unpaid' }[s] || (s || '—');
    return <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${cfg}`}>{label}</span>;
  };

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        {SALARY_CARDS.map((c, i) => (
          <TicketCard key={i} {...c} />
        ))}
      </div>

      {/* Recent salary sheet — admin-এর mini table style */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden flex flex-col">
        <div className="text-white text-xs font-bold px-4 py-2.5 tracking-wide uppercase shrink-0"
          style={{ backgroundImage: 'linear-gradient(45deg, #22425C 0%, #0288d1 100%)' }}>
          MY SALARY SHEET
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[360px]">
            <thead>
              <tr className="bg-[#1c2333] text-white">
                {['Month', 'Net Salary', 'Paid', 'Due', 'Status'].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-semibold border-r border-[#2a3347] last:border-r-0 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">No salary records</td></tr>
              ) : (
                recent.map((r, i) => (
                  <tr key={r.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-3 py-2 border-b border-gray-100">{r.month}</td>
                    <td className="px-3 py-2 border-b border-gray-100">{fmt(r.net_salary)}</td>
                    <td className="px-3 py-2 border-b border-gray-100 text-emerald-600">{fmt(r.paid_amount)}</td>
                    <td className="px-3 py-2 border-b border-gray-100 text-rose-600">{Number(r.due_amount) > 0 ? fmt(r.due_amount) : '—'}</td>
                    <td className="px-3 py-2 border-b border-gray-100">{statusBadge(r.payment_status)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Employee Panel (non-admin dashboard) ───────────────────────────────
// Profile card (বাঁয়ে) + Salary Sheet (ডানে) + role-permission-filtered
// admin stat cards — admin Dashboard-এর সাথে মিল রেখে।
function EmployeePanel({ emp, empLoading, user, topCards, ticketCards, bottomCards }) {
  return (
    <div className="space-y-3 pb-8">
      {/* Page header */}
      <div className="flex items-center gap-2">
        <i className="fas fa-tachometer-alt text-xl text-gray-500"></i>
        <h1 className="text-base font-semibold text-gray-700">Dashboard</h1>
        <span className="text-xs text-gray-400">Employee Panel</span>
      </div>

      {/* Profile + Salary Sheet */}
      {empLoading ? (
        <div className="flex items-center justify-center h-40 text-gray-400 text-sm">প্রোফাইল লোড হচ্ছে...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5">
          <div className="lg:col-span-1">
            <EmployeeProfileCard emp={emp} user={user} />
          </div>
          <div className="lg:col-span-2">
            {emp ? (
              <EmployeeSalarySheet emp={emp} />
            ) : (
              <div className="bg-white rounded-lg shadow-sm p-6 text-center text-gray-400 text-sm h-full flex items-center justify-center">
                আপনার সাথে কোনো Employee profile যুক্ত নেই — salary sheet দেখাতে অ্যাডমিনের সাথে যোগাযোগ করুন।
              </div>
            )}
          </div>
        </div>
      )}

      {/* Role-permission-filtered admin cards */}
      {topCards.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {topCards.map((c, i) => (
            <StatCard key={i} {...c} from={g(i).from} to={g(i).to} />
          ))}
        </div>
      )}

      {ticketCards.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {ticketCards.map((tc, i) => (
            <TicketCard key={i} {...tc} />
          ))}
        </div>
      )}

      {bottomCards.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {bottomCards.map((c, i) => (
            <StatCard key={i} {...c} from={g(i).from} to={g(i).to} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate();
  const { isSuper, loaded: permLoaded, hasModule, hasGranular } = usePermission();
  const { user } = useAuth();
  const [stats,        setStats]        = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [onlineCount,  setOnlineCount]  = useState(null);
  // Employee Panel — non-admin user-এর নিজের profile + salary
  const [emp,          setEmp]          = useState(null);
  const [empLoading,   setEmpLoading]   = useState(true);
  // Module 6 — Support ticket aggregate stats (Dashboard widgets-এর source)।
  const [supportStats, setSupportStats] = useState(null);
  // Module 7 — Task aggregate stats (Pending/Processing Task card-এর source)।
  const [taskStats, setTaskStats] = useState(null);
  // Module 8 — Bandwidth Buy aggregate stats (provider invoices, dues, cash on hand)।
  const [purchaseStats, setPurchaseStats] = useState(null);

  useEffect(() => {
    api.get('/clients/dashboard-stats/')
      .then(r => setStats(r.data))
      .finally(() => setLoading(false));
    // Online clients count — RADIUS hybrid (radacct primary + Mikrotik confirm +
    // ghost-elimination)। known_only=1 → শুধু এই DB-র client গোনে (রাউটারের
    // DB-বহির্ভূত session বাদ)।
    api.get('/radius/online-users/?known_only=1')
      .then(r => setOnlineCount(r.data.online_count ?? r.data.users?.length ?? 0))
      .catch(() => setOnlineCount(0));
    // Support module aggregated stats — Zone/SubZone/Monthly/Solver widgets।
    api.get('/support/tickets/stats/')
      .then(r => setSupportStats(r.data))
      .catch(() => setSupportStats(null));
    // Module 7 — Task stats: Pending/Processing Task card-এর live count।
    api.get('/tasks/tasks/stats/')
      .then(r => setTaskStats(r.data))
      .catch(() => setTaskStats(null));
    // Module 8 — Provider bill aggregate stats + cash-on-hand balance।
    api.get('/purchase/provider-bills/dashboard-stats/')
      .then(r => setPurchaseStats(r.data))
      .catch(() => setPurchaseStats(null));
  }, []);

  // Employee Panel — non-admin user হলে নিজের Employee profile + salary আনো
  useEffect(() => {
    if (!permLoaded) return;
    if (isSuper) { setEmpLoading(false); return; }
    api.get('/hr/employees/me/')
      .then(r => setEmp(r.data))
      .catch(() => setEmp(null))
      .finally(() => setEmpLoading(false));
  }, [permLoaded, isSuper]);

  // permission লোড হওয়ার আগেই render করলে non-super user মুহূর্তের জন্য পূর্ণ admin
  // dashboard (সব unfiltered card) দেখে ফেলত — তাই permLoaded না হওয়া পর্যন্ত wait।
  if (loading || !permLoaded) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        লোড হচ্ছে...
      </div>
    );
  }

  const s = stats || {};
  const monthlyNew  = s.monthly_new  || [];
  const monthlyPerf = s.monthly_perf || [];
  const top20       = s.top20_due    || [];

  const fmt = (v) => `৳${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const p   = purchaseStats || {};

  // ── Top 20 stat cards ───────────────────────────────────────────────
  const TOP_CARDS = [
    // Row 1
    { icon: 'fas fa-users',        label: 'Total Client',        value: s.total,           sub: 'All over the number of clients at present.',    link: '/clients' },
    { icon: 'fas fa-user-check',   label: 'Running Clients',      value: s.active,          sub: 'Number of clients without LeftOut status.',     link: '/clients?status=active' },
    { icon: 'fas fa-user-times',   label: 'Inactive Clients',     value: s.inactive,        sub: 'Number of clients whom status are inactive.',   link: '/clients?status=inactive' },
    { icon: 'fas fa-user-ninja',   label: 'Waiver Clients',       value: 0,                 sub: 'Number of clients those are free/personal.',    link: null },
    // Row 2
    { icon: 'fas fa-user-plus',    label: 'New Client',           value: s.new_this_month,  sub: 'Monthly number of clients those are new.',      link: '/clients?new=1' },
    { icon: 'fas fa-users-cog',    label: 'Renewed Clients',      value: s.renewed,         sub: 'Left list থেকে ফিরে আসা ক্লায়েন্ট।',         link: '/clients?renewed=1' },
    { icon: 'fas fa-user-shield',  label: 'Deactivated Clients',  value: s.suspended,       sub: 'Monthly number of newly deactivated clients.',  link: '/clients?status=suspended' },
    { icon: 'fas fa-user-minus',   label: 'Left Clients',         value: s.left,            sub: 'Number of clients those are not exist.',        link: '/clients/left' },
    // Row 3
    { icon: 'fas fa-user-check',   label: 'Billing Clients',      value: s.billing_count,   sub: 'Number of clients whom bill generated.',        link: '/billing/bills' },
    { icon: 'fas fa-receipt',      label: 'Paid Clients',         value: s.paid_count,      sub: 'Number of clients those are fully paid.',       link: '/billing/bills?pay_status=paid' },
    { icon: 'fas fa-handshake',    label: 'Partially Paid',       value: s.partial_count,   sub: 'Number of clients those are partially paid.',   link: '/billing/bills?pay_status=partial' },
    { icon: 'fas fa-search-dollar', label: 'Unpaid Clients',      value: s.unpaid_count,    sub: 'Number of clients those are fully unpaid.',     link: '/billing/bills?pay_status=unpaid' },
    // Row 4
    { icon: 'fas fa-signal',       label: 'Online Clients',       value: onlineCount,       sub: 'Number of clients those are connected.',        link: '/clients?online=1' },
    { icon: 'fas fa-user-slash',   label: 'Blocked Clients',      value: 0,                 sub: 'Number of clients those are active & disabled.', link: null },
    { icon: 'fas fa-user-clock',   label: 'Bill Date Expire',     value: s.expired,         sub: 'Number of clients whom billing date expired.',  link: '/clients?status=expired' },
    { icon: 'fas fa-clock',        label: 'Unpaid Extension',     value: 0,                 sub: 'Clients those are expired but extended.',       link: null },
    // Row 5
    { icon: 'fas fa-user-tie',     label: 'Total Pop',            value: 0,                 sub: 'Total number of POPs you have.',                link: null },
    { icon: 'fas fa-users',        label: 'Total Pop Clients',    value: 0,                 sub: 'Number of exported & unexported Pop clients.',  link: null },
    { icon: 'fas fa-user-check',   label: 'Enabled Pop Clients',  value: 0,                 sub: 'Number of exported Pop clients those are enabled.', link: null },
    { icon: 'fas fa-user-times',   label: 'Disabled Pop Clients', value: 0,                 sub: 'Number of exported Pop clients those are disabled.', link: null },
  ];

  // ── Ticket / task cards ─────────────────────────────────────────────
  // Module 6 — pending/processing tickets live count Support module থেকে।
  // Cards-এ link দিলে ক্লিক করে ক্লায়েন্ট সাপোর্ট পেজে নির্দিষ্ট status filter
  // সহ navigate করবে — drill-down অভিজ্ঞতা।
  const TICKET_CARDS = [
    { icon: 'fas fa-ticket-alt', label: 'Pending Tickets',    value: supportStats?.pending_count    ?? 0, sub: "Number of support tickets that're pending",    from: PENDING_GRADIANT.from,    to: PENDING_GRADIANT.to,    link: '/support/tickets?status=open' },
    { icon: 'fas fa-sync-alt',   label: 'Processing Tickets', value: supportStats?.processing_count ?? 0, sub: "Number of support tickets that're processing", from: PROCESSING_GRADIANT.from, to: PROCESSING_GRADIANT.to, link: '/support/tickets?status=in_progress' },
    { icon: 'fas fa-tasks',      label: 'Pending Task',       value: taskStats?.pending_count    ?? 0, sub: "Number of created task that're pending",     from: PENDING_GRADIANT.from,    to: PENDING_GRADIANT.to,    link: '/tasks/list?status=pending' },
    { icon: 'fas fa-sync-alt',   label: 'Processing Task',    value: taskStats?.processing_count ?? 0, sub: "Number of task that're processing",           from: PROCESSING_GRADIANT.from, to: PROCESSING_GRADIANT.to, link: '/tasks/list?status=processing' },
  ];

  // ── Bottom 20 stat cards ─────────────────────────────────────────────
  const BOTTOM_CARDS = [
    // Row 1
    { icon: 'fas fa-calendar-alt',      label: 'Monthly Bill',           value: fmt(s.net_billed),  sub: 'Current month total customer monthly bill',      link: '/billing/bills' },
    { icon: 'fas fa-calendar-check',    label: 'Collected Bill',         value: fmt(s.collected),   sub: 'Current month total received amount',            link: '/billing/bills?status=paid' },
    { icon: 'fas fa-money-check-alt',   label: 'Discount',               value: fmt(s.discount),    sub: 'Current month total discount amount',            link: null },
    { icon: 'fas fa-file-invoice-dollar', label: 'Total Due',            value: fmt(s.total_due),   sub: 'Total due bill of client',                      link: '/billing/bills?status=unpaid' },
    // Row 2
    { icon: 'fas fa-hand-holding-usd',  label: 'Service Sales Invoice',  value: fmt(0), sub: 'Monthly installation fee & others service sales', link: null },
    { icon: 'fas fa-chart-line',        label: 'Product Sales Invoice',  value: fmt(0), sub: 'Current month total product sales',               link: null },
    { icon: 'fas fa-chart-line',        label: 'Income',                 value: fmt(0), sub: 'Current month total income amount',               link: null },
    { icon: 'fas fa-chart-area',        label: 'Expense',                value: fmt(0), sub: 'Current month total expense amount',              link: null },
    // Row 3
    { icon: 'fas fa-money-check-alt',   label: 'Credited Amount',        value: fmt(0), sub: 'Monthly credited amount of POPs',                link: null },
    { icon: 'fas fa-credit-card',       label: 'POP Fund',               value: fmt(0), sub: 'Monthly given fund amount to POPs',              link: null },
    { icon: 'fas fa-money-check-alt',   label: 'POP Bill',               value: fmt(0), sub: 'Monthly received amount from POPs',              link: null },
    { icon: 'fas fa-funnel-dollar',     label: 'Receivable Amount',      value: fmt(0), sub: 'Monthly receivable amount from POPs',            link: null },
    // Row 4
    { icon: 'fas fa-chart-area',        label: 'B.Width Provider Bill',  value: fmt(p.bill_amount),  sub: `Total ${p.bill_count ?? 0} invoices to bandwidth providers`,   link: '/bandwidth/buy/bills' },
    { icon: 'fas fa-credit-card',       label: 'B.Width Provider Due',   value: fmt(p.due_amount),   sub: `Outstanding due — ${p.due_count ?? 0} unpaid provider invoices`, link: '/bandwidth/buy/bills?status=due' },
    { icon: 'fas fa-credit-card',       label: 'B.Width POP Bill',       value: fmt(0), sub: 'Monthly received amount from B.Width POPs',      link: null },
    { icon: 'fas fa-money-check-alt',   label: 'Paid Salary',            value: fmt(0), sub: 'Current month total paid salary amount',         link: null },
    // Row 5
    { icon: 'fas fa-envelope',          label: 'SMS Balance',            value: fmt(0), sub: 'This is your total sms balance amount',          link: null },
    { icon: 'fas fa-credit-card',       label: 'Purchase Payable Due',   value: fmt(0), sub: 'All over inventory purchase payable due',        link: null },
    { icon: 'fas fa-credit-card',       label: 'Purchase Paid Amount',   value: fmt(0), sub: 'Current month total inventory purchase paid',    link: null },
    { icon: 'fas fa-hand-holding-usd',  label: 'Cash On Hand',           value: fmt(p.cash_on_hand), sub: 'Current ledger balance after provider payments', link: '/accounting/chart-of-accounts' },
  ];

  // ── Employee Panel branch ───────────────────────────────────────────
  // superadmin/admin বাদে সবাই Employee Panel দেখবে — profile + salary +
  // role permission অনুযায়ী filter করা admin cards।
  if (permLoaded && !isSuper) {
    // 'dashboard' module enabled না থাকলে কোনো card-ই দেখাবে না;
    // থাকলে প্রতিটি card granular dashboard_cards permission অনুযায়ী।
    const canDash = hasModule('dashboard');
    const allow = (c) => canDash && hasGranular('dashboard_cards', CARD_GRANULAR[c.label]);
    return (
      <EmployeePanel
        emp={emp}
        empLoading={empLoading}
        user={user}
        topCards={TOP_CARDS.filter(allow)}
        ticketCards={TICKET_CARDS.filter(allow)}
        bottomCards={BOTTOM_CARDS.filter(allow)}
      />
    );
  }

  return (
    <div className="space-y-3 pb-8">

      {/* ── Page header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <i className="fas fa-tachometer-alt text-xl text-gray-500"></i>
          <h1 className="text-base font-semibold text-gray-700">Dashboard</h1>
          <span className="text-xs text-gray-400">Admin Panel</span>
        </div>
        <button onClick={() => navigate('/accounting/dashboard')} className="flex items-center gap-1.5 bg-[#1c2333] text-white text-xs font-medium px-4 py-2 rounded hover:bg-[#2a3347] transition-colors">
          <i className="fas fa-external-link-alt text-[10px]"></i>
          Accounting Dashboard
        </button>
      </div>

      {/* ── Top 20 stat cards (4 cols × 5 rows) ─────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {TOP_CARDS.map((c, i) => (
          <StatCard key={i} {...c} from={g(i).from} to={g(i).to} />
        ))}
      </div>

      {/* ── Charts row 1: Zone | SubZone | Tickets | Monthly ─────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {/* Module 6: zone-wise current-month ticket distribution */}
        <ProblemPieChart
          title="Zone Wise Problem Occurrence"
          data={supportStats?.zone_wise || []} />
        <ProblemPieChart
          title="Sub-Zone Wise Problem Occurrence"
          data={supportStats?.sub_zone_wise || []} />

        {/* Ticket / Task cards */}
        <div className="flex flex-col gap-2">
          {TICKET_CARDS.map((tc, i) => (
            <TicketCard key={i} {...tc} />
          ))}
        </div>

        {/* Module 6: last 12-months ticket bar trend */}
        <MonthlyTrendChart
          title="Monthly Problem Occurrence"
          data={supportStats?.monthly_trend || []} />
      </div>

      {/* ── Charts row 2: Problem Solver | Monthly New Client ─────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {/* Module 6: Top-10 employee leaderboard (resolved+closed ticket count) */}
        <SolverBarChart
          title="Most Problem Solver (Quantity)"
          data={supportStats?.top_solvers || []}
          height={200} />

        <div className="bg-white rounded-lg shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-700 mb-3 text-center">Monthly New Client</p>
          {monthlyNew.some(d => d.count > 0) ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={monthlyNew} barSize={28}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#06b6d4" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center" style={{ height: 180 }}>
              <span className="text-gray-400 text-xs">No data</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Performance chart + TOP 20 UNPAID ────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">

        {/* Company Performance */}
        <div className="bg-white rounded-lg shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-700 mb-3 text-center">
            Company Performance (Active Client)
          </p>
          {monthlyPerf.some(d => d.count > 0) ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyPerf} barSize={20}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={v => [v.toLocaleString(), 'Amount']} />
                <Bar dataKey="count" fill="#14b8a6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center" style={{ height: 200 }}>
              <span className="text-gray-400 text-xs">No data</span>
            </div>
          )}
        </div>

        {/* TOP 20 UNPAID CLIENT — header gradient reference: .todo-head (#22425C→#0288d1) */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden flex flex-col">
          <div className="text-white text-xs font-bold px-4 py-2.5 tracking-wide uppercase shrink-0"
            style={{ backgroundImage: 'linear-gradient(45deg, #22425C 0%, #0288d1 100%)' }}>
            TOP 20 UNPAID CLIENT
          </div>
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-xs min-w-[400px]">
              <thead className="sticky top-0">
                <tr className="bg-[#1c2333] text-white">
                  {['User Name', 'Mobile', 'Bill Amount', 'Due Amount'].map(h => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left font-semibold border-r border-[#2a3347] last:border-r-0 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {top20.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-gray-400">
                      No unpaid clients
                    </td>
                  </tr>
                ) : (
                  top20.map((c, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-3 py-2 border-b border-gray-100">{c.username}</td>
                      <td className="px-3 py-2 border-b border-gray-100">{c.phone}</td>
                      <td className="px-3 py-2 border-b border-gray-100">{c.monthly_bill.toFixed(2)}</td>
                      <td className="px-3 py-2 border-b border-gray-100">{c.due_amount.toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* ── Bottom 20 stat cards (4 cols × 5 rows) ───────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {BOTTOM_CARDS.map((c, i) => (
          <StatCard key={i} {...c} from={g(i).from} to={g(i).to} />
        ))}
      </div>

    </div>
  );
}
