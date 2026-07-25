// ════════════════════════════════════════════════════════════════════════
//  FinancialReports.jsx  —  Profit & Loss + Trial Balance dashboard
// ════════════════════════════════════════════════════════════════════════
//
//  ব্যাকএন্ড ম্যাপিং (read-only):
//    GET /api/v1/accounting/daily-accounts/profit-loss/
//          ?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
//        → { total_income, total_expense, net_profit, from_date, to_date }
//
//    GET /api/v1/accounting/daily-accounts/trial-balance/
//        → [ { account_code, account_name, debit, credit } ]
//
//  প্রপস:
//    initialTab='pnl' বা 'trial' — route অনুযায়ী ডিফল্ট ট্যাব।
//      /accounting/profit-loss   → 'pnl'
//      /accounting/trial-balance → 'trial'
//
//  কেন date range default month-to-date:
//    ১ তারিখ → আজ — সাধারণত ISP-এর monthly financial review-এ
//    most-used window। User চাইলে কাস্টম date select করতে পারবে।
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const fmt = (n) => Number(n || 0).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Helper: আজকের ১ তারিখ ও আজ — default range তৈরি ────────────────
const monthToDate = () => {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const toISO = (d) => d.toISOString().slice(0, 10);
  return { from: toISO(first), to: toISO(today) };
};

export default function FinancialReports({ initialTab = 'pnl' }) {
  // tab        → 'pnl' | 'trial' — কোন report দেখাবো
  // dateFrom/To → P&L-এর জন্য range (Trial Balance-এ ignored)
  const [tab,      setTab]      = useState(initialTab);
  const [dateFrom, setDateFrom] = useState(monthToDate().from);
  const [dateTo,   setDateTo]   = useState(monthToDate().to);

  useEffect(() => { setTab(initialTab); }, [initialTab]);

  return (
    <div className="space-y-4">
      {/* ── Header + tab switcher ──────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[#1c2333]">Financial Reports</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Profit & Loss statement এবং Trial Balance — live backend থেকে
          </p>
        </div>
        <div className="inline-flex rounded-lg overflow-hidden border border-gray-200">
          <button
            onClick={() => setTab('pnl')}
            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === 'pnl' ? 'bg-[#1d3a50] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            Profit & Loss
          </button>
          <button
            onClick={() => setTab('trial')}
            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === 'trial' ? 'bg-[#1d3a50] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            Trial Balance
          </button>
        </div>
      </div>

      {tab === 'pnl' ? (
        <ProfitLossSection dateFrom={dateFrom} dateTo={dateTo} setDateFrom={setDateFrom} setDateTo={setDateTo} />
      ) : (
        <TrialBalanceSection />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  Profit & Loss section
// ════════════════════════════════════════════════════════════════════════
function ProfitLossSection({ dateFrom, dateTo, setDateFrom, setDateTo }) {
  // report → API থেকে পাওয়া aggregated numbers
  const [report,  setReport]  = useState(null);
  const [loading, setLoading] = useState(true);

  // ── fetch on mount এবং date change-এ ───────────────────────────
  const fetchReport = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (dateFrom) qs.append('from_date', dateFrom);
      if (dateTo)   qs.append('to_date',   dateTo);
      const { data } = await api.get(`/accounting/daily-accounts/profit-loss/?${qs.toString()}`);
      setReport(data);
    } catch {
      toast.error('Profit/Loss লোড ব্যর্থ।');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchReport(); /* eslint-disable-line */ }, [dateFrom, dateTo]);

  // ── derived: net profit positive না negative — color হিসেব করতে ──
  const isProfit = report && Number(report.net_profit || 0) >= 0;

  return (
    <>
      {/* Date range filter */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 flex flex-wrap items-center gap-3">
        <label className="text-xs font-semibold text-gray-600">Range:</label>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md"
        />
        <span className="text-gray-400">→</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md"
        />
        <button
          onClick={fetchReport}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#1d3a50] text-white hover:bg-[#26536f] transition-colors ml-auto"
        >
          🔄 Refresh
        </button>
      </div>

      {/* 3-card summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard
          label="Total Income"
          value={loading ? '...' : `৳ ${fmt(report?.total_income)}`}
          color="emerald"
          icon="↑"
        />
        <SummaryCard
          label="Total Expense"
          value={loading ? '...' : `৳ ${fmt(report?.total_expense)}`}
          color="rose"
          icon="↓"
        />
        <SummaryCard
          label="Net Profit"
          value={loading ? '...' : `৳ ${fmt(report?.net_profit)}`}
          color={isProfit ? 'blue' : 'red'}
          icon={isProfit ? '✓' : '⚠'}
        />
      </div>

      {/* Detail explanation card */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-bold text-[#1c2333] mb-2">কীভাবে calculate হলো</h3>
        <ul className="text-xs text-gray-600 space-y-1 list-disc list-inside">
          <li>
            <span className="font-semibold">Total Income</span> — accounting.Income table থেকে
            <code className="mx-1 px-1 bg-gray-100 rounded">amount</code>-এর সমষ্টি
            (date filter সহ)।
          </li>
          <li>
            <span className="font-semibold">Total Expense</span> — accounting.Expense table থেকে
            <code className="mx-1 px-1 bg-gray-100 rounded">amount</code>-এর সমষ্টি।
          </li>
          <li>
            <span className="font-semibold">Net Profit</span> = Income − Expense।
            Negative হলে loss।
          </li>
          <li className="text-amber-700">
            ⚠ এই হিসাব <span className="font-semibold">শুধুমাত্র</span> accounting app-এর data থেকে —
            billing module (subscriber payments) আলাদা track হয়।
          </li>
        </ul>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  Trial Balance section
// ════════════════════════════════════════════════════════════════════════
function TrialBalanceSection() {
  // rows → প্রতিটি account-এর debit/credit total
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');

  const fetchRows = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/accounting/daily-accounts/trial-balance/');
      setRows(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Trial Balance লোড ব্যর্থ।');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchRows(); }, []);

  // ── filter + totals (memo) ─────────────────────────────────────
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      `${r.account_code || ''} ${r.account_name || ''}`.toLowerCase().includes(term)
    );
  }, [rows, search]);

  const totals = useMemo(() => {
    let d = 0, c = 0;
    filtered.forEach((r) => { d += Number(r.debit || 0); c += Number(r.credit || 0); });
    return { debit: d, credit: c, diff: d - c };
  }, [filtered]);

  return (
    <>
      {/* Top totals — balanced কিনা দেখানো */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard label="Total Debit"  value={loading ? '...' : `৳ ${fmt(totals.debit)}`}  color="blue"  icon="D" />
        <SummaryCard label="Total Credit" value={loading ? '...' : `৳ ${fmt(totals.credit)}`} color="amber" icon="C" />
        <SummaryCard
          label="Balance"
          value={loading ? '...' : (Math.abs(totals.diff) < 0.01 ? 'Balanced ✓' : `Diff ৳ ${fmt(Math.abs(totals.diff))}`)}
          color={Math.abs(totals.diff) < 0.01 ? 'emerald' : 'red'}
          icon={Math.abs(totals.diff) < 0.01 ? '✓' : '⚠'}
        />
      </div>

      {/* Search bar */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 flex items-center gap-3">
        <input
          type="text"
          placeholder="🔍 account code / name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-[#1d3a50]"
        />
        <button
          onClick={fetchRows}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#1d3a50] text-white hover:bg-[#26536f] transition-colors"
        >
          🔄 Refresh
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#1c2333] text-white text-[11px] uppercase tracking-wide">
            <tr>
              <th className="px-4 py-2.5 text-left w-32">Code</th>
              <th className="px-4 py-2.5 text-left">Account</th>
              <th className="px-4 py-2.5 text-right">Debit</th>
              <th className="px-4 py-2.5 text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="text-center py-10 text-gray-400">লোড হচ্ছে...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-10 text-gray-400">কোনো ledger movement নেই।</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.account_code} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2 font-mono text-xs">{r.account_code}</td>
                <td className="px-4 py-2 text-gray-700">{r.account_name}</td>
                <td className="px-4 py-2 text-right font-mono">{Number(r.debit) > 0 ? `৳ ${fmt(r.debit)}` : '—'}</td>
                <td className="px-4 py-2 text-right font-mono">{Number(r.credit) > 0 ? `৳ ${fmt(r.credit)}` : '—'}</td>
              </tr>
            ))}
            {!loading && filtered.length > 0 && (
              <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                <td colSpan={2} className="px-4 py-2 text-right text-[#1c2333]">Total</td>
                <td className="px-4 py-2 text-right font-mono text-[#1c2333]">৳ {fmt(totals.debit)}</td>
                <td className="px-4 py-2 text-right font-mono text-[#1c2333]">৳ {fmt(totals.credit)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Reusable summary card — color prop থেকে Tailwind class পেতে ─────
//    Tailwind JIT static class detection-এর কারণে full classname literal
//    রাখতে হয়; এজন্য একটি map ব্যবহার করছি।
const COLOR_MAP = {
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  rose:    { bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200'    },
  blue:    { bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200'    },
  amber:   { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200'   },
  red:     { bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200'     },
};

function SummaryCard({ label, value, color = 'blue', icon }) {
  const c = COLOR_MAP[color] || COLOR_MAP.blue;
  return (
    <div className={`bg-white rounded-lg border ${c.border} p-3 flex items-center gap-3`}>
      <div className={`w-12 h-12 rounded-lg ${c.bg} ${c.text} flex items-center justify-center text-xl font-bold`}>
        {icon}
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
        <p className={`text-xl font-bold ${c.text}`}>{value}</p>
      </div>
    </div>
  );
}
