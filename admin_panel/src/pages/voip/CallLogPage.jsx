// VoIP কল লগ — প্রতিটি কলের সময়/বিস্তারিত টেবিলে; উপরে filter + search।
// API: GET /voip/call-logs/?search=&direction=&status=&date_from=&date_to=&page=
import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../utils/api';

const DIRECTION = { inbound: { label: 'ইনকামিং', cls: 'bg-sky-100 text-sky-700' },
                    outbound: { label: 'আউটগোয়িং', cls: 'bg-violet-100 text-violet-700' } };
const STATUS = {
  completed: { label: 'সম্পন্ন',     cls: 'bg-emerald-100 text-emerald-700' },
  answered:  { label: 'উত্তর দেওয়া', cls: 'bg-emerald-100 text-emerald-700' },
  ringing:   { label: 'রিং হচ্ছে',   cls: 'bg-amber-100 text-amber-700' },
  initiated: { label: 'শুরু',        cls: 'bg-amber-100 text-amber-700' },
  no_answer: { label: 'উত্তর নেই',   cls: 'bg-orange-100 text-orange-700' },
  busy:      { label: 'ব্যস্ত',      cls: 'bg-orange-100 text-orange-700' },
  failed:    { label: 'ব্যর্থ',       cls: 'bg-rose-100 text-rose-700' },
};

function fmtDateTime(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
function fmtDuration(sec) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

function Badge({ map, value }) {
  const it = map[value];
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${it ? it.cls : 'bg-gray-100 text-gray-600'}`}>
      {it ? it.label : (value || '—')}
    </span>
  );
}

export default function CallLogPage() {
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ search: '', direction: '', status: '', date_from: '', date_to: '' });
  const searchTimer = useRef(null);

  const load = useCallback(async (pg, f) => {
    setLoading(true);
    try {
      const params = { page: pg };
      Object.entries(f).forEach(([k, v]) => { if (v) params[k] = v; });
      const r = await api.get('/voip/call-logs/', { params });
      if (Array.isArray(r.data)) { setRows(r.data); setCount(r.data.length); }
      else { setRows(r.data.results || []); setCount(r.data.count || 0); }
    } catch { setRows([]); setCount(0); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(page, filters); /* eslint-disable-next-line */ }, [page]);

  const applyFilters = (next) => {
    setFilters(next); setPage(1); load(1, next);
  };
  const onFilterChange = (k, v) => {
    const next = { ...filters, [k]: v };
    if (k === 'search') {
      setFilters(next);
      clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(() => { setPage(1); load(1, next); }, 350);
    } else {
      applyFilters(next);
    }
  };
  const reset = () => applyFilters({ search: '', direction: '', status: '', date_from: '', date_to: '' });

  const pageSize = 20; // DRF default
  const totalPages = Math.max(1, Math.ceil(count / pageSize));

  return (
    <div className="space-y-4">
      {/* হেডার */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <span className="text-teal-600">📞</span> Call Log
          </h1>
          <p className="text-xs text-gray-500">প্রতিটি ভয়েস কলের সময় ও বিস্তারিত</p>
        </div>
        <button onClick={() => load(page, filters)} className="px-3 py-1.5 text-sm rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          রিফ্রেশ
        </button>
      </div>

      {/* ── filter bar ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
        <div className="lg:col-span-2 relative">
          <input value={filters.search} onChange={(e) => onFilterChange('search', e.target.value)}
            placeholder="নাম / কোড / নম্বর / endpoint খুঁজুন"
            className="w-full text-sm border border-gray-300 rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500" />
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        </div>
        <select value={filters.direction} onChange={(e) => onFilterChange('direction', e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500">
          <option value="">সব দিক</option>
          <option value="inbound">ইনকামিং</option>
          <option value="outbound">আউটগোয়িং</option>
        </select>
        <select value={filters.status} onChange={(e) => onFilterChange('status', e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500">
          <option value="">সব স্ট্যাটাস</option>
          <option value="completed">সম্পন্ন</option>
          <option value="no_answer">উত্তর নেই</option>
          <option value="busy">ব্যস্ত</option>
          <option value="failed">ব্যর্থ</option>
          <option value="ringing">রিং</option>
        </select>
        <input type="date" value={filters.date_from} onChange={(e) => onFilterChange('date_from', e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500" title="শুরুর তারিখ" />
        <div className="flex gap-2">
          <input type="date" value={filters.date_to} onChange={(e) => onFilterChange('date_to', e.target.value)}
            className="flex-1 text-sm border border-gray-300 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500" title="শেষ তারিখ" />
          <button onClick={reset} className="px-2 py-2 text-xs rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600" title="রিসেট">✕</button>
        </div>
      </div>

      {/* ── table ── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-[11px] uppercase tracking-wide">
                <th className="text-left px-4 py-2.5 font-semibold">#</th>
                <th className="text-left px-4 py-2.5 font-semibold">সময়</th>
                <th className="text-left px-4 py-2.5 font-semibold">ক্লায়েন্ট</th>
                <th className="text-left px-4 py-2.5 font-semibold">দিক</th>
                <th className="text-left px-4 py-2.5 font-semibold">এজেন্ট</th>
                <th className="text-left px-4 py-2.5 font-semibold">সময়কাল</th>
                <th className="text-left px-4 py-2.5 font-semibold">স্ট্যাটাস</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">লোড হচ্ছে…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">কোনো কল লগ পাওয়া যায়নি</td></tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2.5 text-gray-400">{(page - 1) * pageSize + i + 1}</td>
                    <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">{fmtDateTime(r.started_at)}</td>
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-gray-800 flex items-center gap-1.5">
                        {r.client_name || '—'}
                        {r.caller_endpoint === 'voice_sms' && <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full font-semibold">🔊 Voice SMS</span>}
                      </div>
                      <div className="text-[11px] text-gray-500">{r.client_customer_id || r.callee_endpoint || '—'}</div>
                    </td>
                    <td className="px-4 py-2.5"><Badge map={DIRECTION} value={r.direction} /></td>
                    <td className="px-4 py-2.5 text-gray-700">{r.agent_name || '—'}</td>
                    <td className="px-4 py-2.5 text-gray-700 font-mono">{fmtDuration(r.duration)}</td>
                    <td className="px-4 py-2.5"><Badge map={STATUS} value={r.status} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* pagination */}
        {count > pageSize && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 text-sm">
            <span className="text-gray-500 text-xs">মোট {count} টি কল</span>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-40 text-gray-700">← আগে</button>
              <span className="text-xs text-gray-600">{page} / {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-40 text-gray-700">পরে →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
