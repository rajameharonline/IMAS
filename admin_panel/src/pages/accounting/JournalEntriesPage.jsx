// ════════════════════════════════════════════════════════════════════════
//  JournalEntriesPage.jsx  —  জার্নাল এন্ট্রি লগ (debit/credit lines সহ)
// ════════════════════════════════════════════════════════════════════════
//
//  ব্যাকএন্ড ম্যাপিং:
//    GET /api/v1/accounting/journal/   → JournalEntry list
//      • prefetched lines (debit, credit, account FK)
//      • filter params: date, is_posted
//
//  মূল ডিজাইন সিদ্ধান্ত:
//    ১. List page-এ একটি সারি = একটি Journal Entry (reference, date,
//       description, total_debit, total_credit, posted-status)।
//    ২. row-এ ক্লিক করলে accordion-style expand হয়ে সেই entry-র সব
//       JournalLine (debit / credit) দেখানো হবে। আলাদা detail page
//       তৈরি না করে inline expand রাখা হলো — কারণ user-কে এক স্ক্রিনেই
//       multiple entries তুলনা করতে হয়।
//    ৩. read-only: backend-এ JournalEntry create করতে gracefully nested
//       JournalLine payload লাগে কিন্তু serializer-এ lines field
//       read_only — অর্থাৎ এই page থেকে নতুন entry তৈরি করা যাবে না।
//       (ভবিষ্যতে যোগ করার জন্য নোট রাখা হয়েছে — পারমিশন নিয়ে এগোবো।)
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

// ── টাকা formatter — সব amount-এ consistent BDT format রাখার জন্য ────
const fmt = (n) => {
  const v = Number(n || 0);
  return v.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function JournalEntriesPage() {
  // entries        → raw list backend থেকে
  // expandedId     → কোন entry এই মুহূর্তে expanded; null হলে কেউই না
  // filterPosted   → 'all' / 'yes' / 'no' — is_posted-এর উপর filter
  // dateFrom/To    → date range filter (server-side নয়, client-side simple)
  const [entries,       setEntries]       = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [expandedId,    setExpandedId]    = useState(null);
  const [search,        setSearch]        = useState('');
  const [filterPosted,  setFilterPosted]  = useState('all');
  const [dateFrom,      setDateFrom]      = useState('');
  const [dateTo,        setDateTo]        = useState('');

  // ── data fetch ──────────────────────────────────────────────────
  const fetchEntries = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/accounting/journal/?page_size=500');
      setEntries(Array.isArray(data) ? data : (data.results || []));
    } catch (err) {
      toast.error('জার্নাল লোড করা যায়নি।');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchEntries(); }, []);

  // ── ক্লায়েন্ট-সাইড filter (search/posted/date) ─────────────────────
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entries.filter((e) => {
      // posted filter — yes/no/all
      if (filterPosted === 'yes' && !e.is_posted) return false;
      if (filterPosted === 'no'  &&  e.is_posted) return false;
      // date range — string compare (YYYY-MM-DD format-এর জন্য safe)
      if (dateFrom && e.date < dateFrom) return false;
      if (dateTo   && e.date > dateTo)   return false;
      if (term) {
        const hay = `${e.reference || ''} ${e.description || ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [entries, search, filterPosted, dateFrom, dateTo]);

  // ── totals at top — quick glance ────────────────────────────────
  const totals = useMemo(() => {
    let d = 0, c = 0;
    filtered.forEach((e) => {
      d += Number(e.total_debit || 0);
      c += Number(e.total_credit || 0);
    });
    return { debit: d, credit: c, balanced: Math.abs(d - c) < 0.01 };
  }, [filtered]);

  return (
    <div className="space-y-4">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[#1c2333]">Journal Entries</h1>
          <p className="text-xs text-gray-500 mt-0.5">Double-entry bookkeeping log — debit/credit lines সহ</p>
        </div>
        <button
          onClick={fetchEntries}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#1d3a50] text-white hover:bg-[#26536f] transition-colors"
        >
          🔄 Refresh
        </button>
      </div>

      {/* ── Summary widgets (filtered range-এর totals) ─────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold">D</div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Total Debit</p>
            <p className="text-xl font-bold text-[#1c2333]">৳ {fmt(totals.debit)}</p>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center font-bold">C</div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Total Credit</p>
            <p className="text-xl font-bold text-[#1c2333]">৳ {fmt(totals.credit)}</p>
          </div>
        </div>
        <div className={`bg-white rounded-lg border p-3 flex items-center gap-3 ${totals.balanced ? 'border-green-200' : 'border-red-200'}`}>
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold ${totals.balanced ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
            {totals.balanced ? '✓' : '⚠'}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Balance</p>
            <p className={`text-xl font-bold ${totals.balanced ? 'text-green-700' : 'text-red-700'}`}>
              {totals.balanced ? 'Balanced' : `Diff ৳ ${fmt(Math.abs(totals.debit - totals.credit))}`}
            </p>
          </div>
        </div>
      </div>

      {/* ── Filter bar ─────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="🔍 Reference / description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-[#1d3a50]"
        />
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md"
          title="From date"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md"
          title="To date"
        />
        <select
          value={filterPosted}
          onChange={(e) => setFilterPosted(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white"
        >
          <option value="all">সব</option>
          <option value="yes">Posted</option>
          <option value="no">Draft</option>
        </select>
        <span className="text-xs text-gray-500 ml-auto">{filtered.length} / {entries.length}</span>
      </div>

      {/* ── Main table ─────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#1c2333] text-white text-[11px] uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2.5 text-left w-10"></th>
              <th className="px-3 py-2.5 text-left">Date</th>
              <th className="px-3 py-2.5 text-left">Reference</th>
              <th className="px-3 py-2.5 text-left">Description</th>
              <th className="px-3 py-2.5 text-right">Debit</th>
              <th className="px-3 py-2.5 text-right">Credit</th>
              <th className="px-3 py-2.5 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-10 text-gray-400">লোড হচ্ছে...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-10 text-gray-400">কোনো জার্নাল এন্ট্রি পাওয়া যায়নি।</td></tr>
            ) : filtered.map((e) => {
              const isOpen = expandedId === e.id;
              return (
                // React.Fragment-এর বদলে <tr> + collapsible <tr> দুটি
                // রো একসাথে render — multiple-row pattern (table-friendly)।
                <RowGroup key={e.id} entry={e} isOpen={isOpen} onToggle={() => setExpandedId(isOpen ? null : e.id)} />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── RowGroup: একটি journal entry → main row + (অপশনাল) detail row ────
//    Component-এ বিভক্ত করলাম যাতে inline JSX পড়তে সহজ থাকে।
function RowGroup({ entry, isOpen, onToggle }) {
  return (
    <>
      <tr
        className={`border-t border-gray-100 cursor-pointer hover:bg-gray-50 ${isOpen ? 'bg-blue-50/40' : ''}`}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      >
        <td className="px-3 py-2 text-gray-400">{isOpen ? '▼' : '▶'}</td>
        <td className="px-3 py-2 font-mono text-xs">{entry.date}</td>
        <td className="px-3 py-2 font-semibold text-[#1c2333]">{entry.reference}</td>
        <td className="px-3 py-2 text-gray-600 truncate max-w-[260px]">{entry.description}</td>
        <td className="px-3 py-2 text-right font-mono">৳ {fmt(entry.total_debit)}</td>
        <td className="px-3 py-2 text-right font-mono">৳ {fmt(entry.total_credit)}</td>
        <td className="px-3 py-2 text-center">
          {entry.is_posted ? (
            <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-green-50 text-green-700 border border-green-200">
              Posted
            </span>
          ) : (
            <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-yellow-50 text-yellow-700 border border-yellow-200">
              Draft
            </span>
          )}
        </td>
      </tr>
      {isOpen && (
        <tr className="bg-gray-50 border-t border-gray-100">
          <td colSpan={7} className="px-6 py-3">
            <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Lines</p>
            {!entry.lines || entry.lines.length === 0 ? (
              <p className="text-xs text-gray-400 italic">কোনো line নেই।</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-gray-500 uppercase text-[10px]">
                  <tr className="border-b border-gray-200">
                    <th className="py-1.5 text-left">Account</th>
                    <th className="py-1.5 text-left">Description</th>
                    <th className="py-1.5 text-right">Debit</th>
                    <th className="py-1.5 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.lines.map((ln) => (
                    <tr key={ln.id} className="border-b border-gray-100 last:border-0">
                      <td className="py-1 font-mono">#{ln.account}</td>
                      <td className="py-1 text-gray-600">{ln.description || '—'}</td>
                      <td className="py-1 text-right font-mono">{Number(ln.debit) > 0 ? `৳ ${fmt(ln.debit)}` : '—'}</td>
                      <td className="py-1 text-right font-mono">{Number(ln.credit) > 0 ? `৳ ${fmt(ln.credit)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
