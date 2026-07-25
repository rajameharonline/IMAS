import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import api from '../../utils/api';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatBitsPerSec(bps) {
  if (!bps || bps === 0) return '0.0 Bit/s';
  if (bps < 1000) return bps.toFixed(1) + ' Bit/s';
  if (bps < 1_000_000) return (bps / 1000).toFixed(1) + ' Kbit/s';
  return (bps / 1_000_000).toFixed(1) + ' Mbit/s';
}

function formatUptime(s) {
  if (!s) return '-';
  return s.replace(/(\d+[wdhms])/g, '$1 ').trim();
}

function timeLabel() {
  return new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function ReadonlyField({ label, value }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <div className="bg-gray-100 border border-gray-200 rounded px-3 py-2 text-sm text-gray-800 font-medium min-h-[36px] flex items-center">
        {value || '-'}
      </div>
    </div>
  );
}

function SectionHeader({ icon, title }) {
  return (
    <div className="bg-[#1c2333] px-4 py-3 flex items-center gap-2">
      {icon}
      <span className="text-white text-sm font-semibold">{title}</span>
    </div>
  );
}

const MAX_POINTS = 60;

export default function ClientTrafficPage() {
  const navigate = useNavigate();
  const { username } = useParams();
  const { state: clientInfo = {} } = useLocation();

  const [traffic, setTraffic] = useState(null);
  const [online, setOnline] = useState(true);
  const [chartData, setChartData] = useState([{ time: timeLabel(), download: 0, upload: 0 }]);
  const [currentDown, setCurrentDown] = useState(0);
  const [currentUp, setCurrentUp] = useState(0);
  const prevRef = useRef(null);

  const fetchTraffic = useCallback(async () => {
    try {
      const { data } = await api.get(`/mikrotik/traffic/${username}/`);
      setOnline(data.online !== false);
      if (!data.online) return;

      setTraffic(data);
      const now = Date.now();
      const bytesIn = data.bytes_in || 0;
      const bytesOut = data.bytes_out || 0;

      if (prevRef.current) {
        const elapsed = (now - prevRef.current.ts) / 1000;
        if (elapsed > 0) {
          const down = Math.max(0, (bytesIn - prevRef.current.bytesIn) * 8 / elapsed);
          const up = Math.max(0, (bytesOut - prevRef.current.bytesOut) * 8 / elapsed);
          setCurrentDown(down);
          setCurrentUp(up);
          setChartData(prev => [
            ...prev.slice(-(MAX_POINTS - 1)),
            { time: timeLabel(), download: Math.round(down), upload: Math.round(up) },
          ]);
        }
      }
      prevRef.current = { ts: now, bytesIn, bytesOut };
    } catch {
      /* silent */
    }
  }, [username]);

  useEffect(() => {
    fetchTraffic();
    const id = setInterval(fetchTraffic, 2000);
    return () => clearInterval(id);
  }, [fetchTraffic]);

  const yFmt = (v) => {
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(0) + 'M';
    if (v >= 1_000) return (v / 1_000).toFixed(0) + 'K';
    return v === 0 ? '0' : v;
  };

  const tooltipFmt = (v, key) => [
    formatBitsPerSec(v),
    key === 'download' ? 'Download' : 'Upload',
  ];

  return (
    <div className="space-y-4">

      {/* ── Page header ─────────────────────────────────────── */}
      <div className="bg-white rounded-lg shadow-sm px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <div>
            <h1 className="text-base font-bold text-gray-800">Clients Traffic Monitoring</h1>
            <p className="text-xs text-gray-400">Monitoring Online Clients Traffic</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2" />
          </svg>
          <span>Client Monitoring</span>
          <span className="text-gray-300">&rsaquo;</span>
          <span className="text-gray-700 font-medium">Clients Traffic Monitoring</span>
        </div>
      </div>

      {/* ── Back button ──────────────────────────────────────── */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 px-4 py-2 bg-[#1c2333] text-white text-sm font-medium rounded-lg hover:bg-[#2d3748] transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        Back to List
      </button>

      {/* ── Offline notice ───────────────────────────────────── */}
      {!online && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm font-medium">
          ⚠ User <span className="font-mono font-bold">{username}</span> is currently offline — no active session found.
        </div>
      )}

      {/* ── Connectivity Information ─────────────────────────── */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <SectionHeader
          icon={
            <svg className="w-4 h-4 text-teal-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
          title="Connectivity Information"
        />
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <ReadonlyField label="Client Name"       value={clientInfo.full_name} />
            <ReadonlyField label="Customer ID"        value={clientInfo.customer_id} />
            <ReadonlyField label="Username (ID/IP)"  value={username} />
            <ReadonlyField label="Mobile Number"     value={clientInfo.phone} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <ReadonlyField label="Uptime"            value={formatUptime(traffic?.uptime)} />
            <ReadonlyField label="Downloaded Data"   value={formatBytes(traffic?.bytes_in)} />
            <ReadonlyField label="Uploaded Data"     value={formatBytes(traffic?.bytes_out)} />
            <ReadonlyField label="IP Address"        value={traffic?.ip || clientInfo.displayIp || clientInfo.ip_address} />
          </div>
        </div>
      </div>

      {/* ── Live Traffic Chart ───────────────────────────────── */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <SectionHeader
          icon={
            <svg className="w-4 h-4 text-teal-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          }
          title="Live Traffic Monitoring (RealTime Graph)"
        />
        <div className="p-5">

          {/* Legend */}
          <div className="flex items-center justify-center gap-8 mb-5">
            <div className="flex items-center gap-2">
              <div className="w-9 h-3.5 rounded" style={{ background: 'rgba(99,102,241,0.75)' }} />
              <span className="text-xs text-gray-600 font-medium">
                Download Speed ({formatBitsPerSec(currentDown)})
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-9 h-3.5 rounded" style={{ background: 'rgba(239,68,68,0.75)' }} />
              <span className="text-xs text-gray-600 font-medium">
                Upload Speed ({formatBitsPerSec(currentUp)})
              </span>
            </div>
          </div>

          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
              <defs>
                <linearGradient id="dlGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.75} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="ulGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.75} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />

              <XAxis
                dataKey="time"
                tick={{ fontSize: 10, fill: '#9ca3af' }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={yFmt}
                tick={{ fontSize: 10, fill: '#9ca3af' }}
                tickLine={false}
                axisLine={false}
                width={55}
              />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                formatter={tooltipFmt}
                labelStyle={{ color: '#374151', fontWeight: 600 }}
              />

              <Area
                type="monotone"
                dataKey="download"
                stroke="#6366f1"
                strokeWidth={2}
                fill="url(#dlGrad)"
                dot={false}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="upload"
                stroke="#ef4444"
                strokeWidth={2}
                fill="url(#ulGrad)"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
