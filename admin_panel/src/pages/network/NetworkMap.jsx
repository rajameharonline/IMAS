// admin_panel/src/pages/network/NetworkMap.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Module 9 — Interactive Network GIS Map  (Updated)
//
// নতুন features:
//  1. Node Edit/Update/Delete — view mode-এ node ক্লিক করলে sidebar-এ info panel
//     খোলে, "Edit" button → EditNodeModal → PATCH /network/nodes/{id}/
//     "Delete" button → confirm → DELETE /network/nodes/{id}/
//
//  2. Satellite Tile Toggle — Dark | Satellite | Hybrid তিনটি tile layer।
//     Satellite: Esri World Imagery (Google Satellite-এর মতো, কোনো API key নেই)।
//     Hybrid: Esri imagery + CartoDB labels overlay।
//     key prop দিয়ে tile change-এ Leaflet forced remount হয়।
//
//  3. Manual Fiber Drawing UX উন্নতি:
//     - "Undo" button — শেষ waypoint মুছে ফেলে
//     - Waypoint counter — status bar-এ real-time count
//     - Drawing path thick yellow dashed line — স্পষ্ট দৃশ্যমান
//     - Clear Path button — সব waypoints একসাথে মুছে নতুন করে শুরু
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, CircleMarker, useMap, Popup, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import toast from 'react-hot-toast';
import api from '../../utils/api';

// ─── Tile layer configs ───────────────────────────────────────────────────────
// Hybrid mode: Google Maps tile server (lyrs=y = hybrid: satellite + full labels)
//   স্ক্রিনশটের মতো হুবহু বাংলা/ইংরেজি এলাকার নাম, মসজিদ/স্কুল/বাজার POI icon,
//   রাস্তার নাম সব দেখাবে — কারণ এটাই Google Maps-এর নিজস্ব tile।
//   subdomains '0123' — Google mt0..mt3 server load balance করে।
//   lyrs values: y=hybrid, s=satellite only, m=roadmap only
const TILE_LAYERS = {
  dark: {
    url:      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attrib:   '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
  },
  satellite: {
    // Esri — label ছাড়া pure satellite (ব্যাকআপ হিসেবে রাখা)
    url:      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attrib:   'Tiles &copy; Esri',
    subdomains: '',
  },
  hybrid: {
    // Google Maps hybrid tile — satellite + বাংলা label + সব POI icon
    url:      'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    attrib:   '&copy; <a href="https://maps.google.com">Google Maps</a>',
    subdomains: '0123',
  },
};

// ─── Node type visual config ──────────────────────────────────────────────────
const NODE_STYLE = {
  ROUTER:   { bg: '#1e3a8a', letter: 'R', shape: 'square',  label: 'Router' },
  OLT:      { bg: '#6d28d9', letter: 'O', shape: 'square',  label: 'OLT' },
  SPLITTER: { bg: '#0891b2', letter: 'S', shape: 'diamond', label: 'Splitter' },
  BOX:      { bg: '#059669', letter: 'B', shape: 'round',   label: 'Box' },
  CLIENT:   { bg: '#d97706', letter: 'C', shape: 'round',   label: 'Client' },
};

const STATUS_COLOR = {
  active:      '#10b981',
  inactive:    '#ef4444',
  maintenance: '#f59e0b',
  unknown:     '#6b7280',
};

// ─── Node type SVG icons ──────────────────────────────────────────────────────
// সব জায়গায় (map marker, badge, legend, popup header) একই SVG ব্যবহার হয়।
// getNodeSvg(type, w, h) → HTML string, dangerouslySetInnerHTML বা divIcon-এ embed করা হয়।
function getNodeSvg(type, w = 16, h = 16) {
  const s = `stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
  const icons = {
    ROUTER: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 24 24" fill="none" ${s}>
      <rect x="1" y="9" width="22" height="11" rx="2.5"/>
      <line x1="7" y1="9" x2="7" y2="4"/><line x1="17" y1="9" x2="17" y2="4"/>
      <circle cx="7" cy="3.5" r="1.5" fill="white" stroke="none"/>
      <circle cx="17" cy="3.5" r="1.5" fill="white" stroke="none"/>
      <rect x="4" y="13" width="4" height="2.5" rx="0.8" fill="white" stroke="none"/>
      <rect x="10" y="13" width="4" height="2.5" rx="0.8" fill="white" stroke="none"/>
      <rect x="16" y="13" width="4" height="2.5" rx="0.8" fill="white" stroke="none"/>
    </svg>`,
    OLT: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 24 24" fill="none" ${s}>
      <rect x="2" y="3" width="20" height="7.5" rx="2"/>
      <rect x="2" y="13.5" width="20" height="7.5" rx="2"/>
      <line x1="5.5" y1="6.75" x2="11" y2="6.75"/>
      <line x1="5.5" y1="17.25" x2="11" y2="17.25"/>
      <circle cx="17.5" cy="6.75" r="1.8" fill="white" stroke="none"/>
      <circle cx="17.5" cy="17.25" r="1.8" fill="white" stroke="none"/>
    </svg>`,
    SPLITTER: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round">
      <line x1="12" y1="2" x2="12" y2="9.5"/>
      <line x1="12" y1="9.5" x2="4" y2="21"/>
      <line x1="12" y1="9.5" x2="12" y2="21"/>
      <line x1="12" y1="9.5" x2="20" y2="21"/>
      <circle cx="12" cy="9.5" r="2.5" fill="white" stroke="none"/>
    </svg>`,
    BOX: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 24 24" fill="none" ${s}>
      <rect x="2" y="2" width="20" height="20" rx="3"/>
      <rect x="4.5" y="5.5" width="4" height="3" rx="0.8" fill="white" stroke="none"/>
      <rect x="10" y="5.5" width="4" height="3" rx="0.8" fill="white" stroke="none"/>
      <rect x="15.5" y="5.5" width="4" height="3" rx="0.8" fill="white" stroke="none"/>
      <rect x="4.5" y="10.5" width="4" height="3" rx="0.8" fill="white" stroke="none"/>
      <rect x="10" y="10.5" width="4" height="3" rx="0.8" fill="white" stroke="none"/>
      <rect x="15.5" y="10.5" width="4" height="3" rx="0.8" fill="white" stroke="none"/>
      <line x1="3" y1="16.5" x2="21" y2="16.5" stroke-opacity="0.5"/>
      <line x1="7" y1="18" x2="17" y2="18" stroke-opacity="0.4"/>
    </svg>`,
    CLIENT: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 24 24" fill="none" ${s}>
      <path d="M3 9.5L12 2l9 7.5V21a1 1 0 01-1 1H5a1 1 0 01-1-1z"/>
      <rect x="9" y="13" width="6" height="10" rx="0.5" fill="white" stroke="none"/>
      <rect x="4.5" y="10.5" width="4" height="4" rx="0.8" fill="white" fill-opacity="0.3" stroke="none"/>
      <rect x="15.5" y="10.5" width="4" height="4" rx="0.8" fill="white" fill-opacity="0.3" stroke="none"/>
    </svg>`,
  };
  return icons[type] || `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>`;
}

// ─── Path editing icons ───────────────────────────────────────────────────────
const waypointIcon = L.divIcon({
  className: '',
  html: `<div style="background:#0891b2;border:3px solid #fff;border-radius:50%;
    width:14px;height:14px;cursor:grab;
    box-shadow:0 2px 8px rgba(0,0,0,0.45);"></div>`,
  iconSize: [14, 14], iconAnchor: [7, 7],
});
const midpointIcon = L.divIcon({
  className: '',
  html: `<div style="background:rgba(8,145,178,0.45);border:2px solid rgba(255,255,255,0.9);
    border-radius:50%;width:10px;height:10px;cursor:crosshair;
    box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`,
  iconSize: [10, 10], iconAnchor: [5, 5],
});

// ─── DivIcon builder ──────────────────────────────────────────────────────────
// isDrawSource=true  → সোনালি border (drawing mode source node)
// isViewSelected=true → আকাশী নীল border (view mode-এ selected for edit)
function buildIcon(node, isDrawSource = false, isViewSelected = false) {
  const s = NODE_STYLE[node.node_type] || { bg: '#374151', letter: '?', shape: 'round' };
  let border;
  if (isDrawSource)    border = '#fbbf24';  // সোনালি
  else if (isViewSelected) border = '#38bdf8'; // আকাশী নীল
  else border = STATUS_COLOR[node.status] || '#6b7280';

  const radius  = s.shape === 'round' ? '50%' : s.shape === 'diamond' ? '5px' : '7px';
  const rotate  = s.shape === 'diamond' ? 'rotate(45deg)' : 'none';
  const innerRot = s.shape === 'diamond' ? 'rotate(-45deg)' : 'none';
  const shadow  = (isDrawSource || isViewSelected)
    ? `box-shadow:0 0 0 5px ${border}44,0 2px 10px rgba(0,0,0,0.6)`
    : 'box-shadow:0 2px 10px rgba(0,0,0,0.6)';

  return L.divIcon({
    className: '',
    html: `<div style="background:${s.bg};border:3px solid ${border};border-radius:${radius};
      width:34px;height:34px;display:flex;align-items:center;justify-content:center;
      ${shadow};transform:${rotate};cursor:pointer;transition:all 0.2s">
      <span style="display:flex;align-items:center;justify-content:center;transform:${innerRot}">
        ${getNodeSvg(node.node_type, 18, 18)}
      </span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -24],
  });
}

// ─── Dynamic Client Marker Icon ───────────────────────────────────────────────
const STATUS_DOT = { active: '#22c55e', inactive: '#ef4444', suspended: '#f59e0b', expired: '#6b7280' };
const STATUS_BG  = { active: '#052e16', inactive: '#2d0a0a', suspended: '#271900', expired: '#1a1a1a' };

function buildClientIcon(status, isSelected = false) {
  const dot  = STATUS_DOT[status] || '#6b7280';
  const bg   = STATUS_BG[status]  || '#0f172a';
  const size = isSelected ? 42 : 36;
  const half = size / 2;
  const glow = isSelected
    ? `box-shadow:0 0 0 4px ${dot}55,0 0 16px ${dot}88,0 3px 12px rgba(0,0,0,0.7)`
    : `box-shadow:0 0 0 2px ${dot}44,0 3px 10px rgba(0,0,0,0.6)`;
  const border = isSelected ? `3.5px solid ${dot}` : `2.5px solid ${dot}`;
  // WiFi signal SVG — 3 arcs + center dot
  const iconSz = isSelected ? 22 : 18;
  const wifiSvg = `<svg width="${iconSz}" height="${iconSz}" viewBox="0 0 24 24" fill="none"
    stroke="${dot}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="19" r="1.5" fill="${dot}" stroke="none"/>
    <path d="M8.5 15.5a5 5 0 0 1 7 0"/>
    <path d="M4.5 11.5a11 11 0 0 1 15 0"/>
    <path d="M1 7.5a17 17 0 0 1 22 0"/>
  </svg>`;
  return L.divIcon({
    className: '',
    html: `<div style="position:relative;width:${size}px;height:${size}px;cursor:pointer">
      <div style="background:${bg};border:${border};border-radius:50%;
        width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;
        ${glow};transition:all 0.2s">
        ${wifiSvg}
      </div>
      <div style="position:absolute;bottom:-1px;right:-1px;width:10px;height:10px;
        background:${dot};border-radius:50%;border:2px solid #0f172a;
        box-shadow:0 1px 4px rgba(0,0,0,0.5)"></div>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [half, half],
    popupAnchor: [0, -(half + 4)],
  });
}

// ─── ClientConnectSection — dynamic client popup এ network node connect করার UI ──
function ClientConnectSection({ client, allNodes, allLinks, onConnected }) {
  const [open,         setOpen]         = useState(false);
  const [targetId,     setTargetId]     = useState('');
  const [linkType,     setLinkType]     = useState('FIBER');
  const [srcPort,      setSrcPort]      = useState('');    // target node (Splitter) এর port
  const [fiberCore,    setFiberCore]    = useState('');    // fiber core color
  const [coreCount,    setCoreCount]    = useState(12);    // fiber cable total core count
  const [connecting,   setConnecting]   = useState(false);

  const connectableNodes = allNodes.filter(n =>
    ['SPLITTER', 'OLT', 'BOX', 'ROUTER'].includes(n.node_type) && n.latitude && n.longitude
  );
  const target        = connectableNodes.find(n => String(n.id) === String(targetId)) ?? null;
  const tgtUsedPorts  = target ? getUsedPorts(target.id, allLinks) : new Set();
  const tgtIsSplitter = target?.node_type === 'SPLITTER';
  // target null হলে getNodePorts call করা যাবে না — null check জরুরি
  const tgtPorts      = !target ? null
    : tgtIsSplitter ? getSplitterPorts(target.splitter_ratio)
    : getNodePorts(target);

  // target এর existing links থেকে port→peer mapping
  const tgtPortLink = {};
  if (target) {
    allLinks.filter(l => l.source_node === target.id || l.target_node === target.id).forEach(lk => {
      if (lk.source_node === target.id && lk.source_port) tgtPortLink[lk.source_port] = lk.target_node_name;
      if (lk.target_node === target.id && lk.target_port) tgtPortLink[lk.target_port] = lk.source_node_name;
    });
  }

  // coreCount অনুযায়ী dynamic fiber cores
  const dynamicCores  = generateFiberCores(Math.min(Math.max(coreCount, 1), 144));
  // target ও এই client 간 existing links (fiber core used check)
  const usedCores     = parseUsedCores(allLinks.filter(l =>
    l.source_node === (target?.id) || l.target_node === (target?.id)
  ));
  const freeCoreCount = dynamicCores.filter(c => !usedCores.has(c.name)).length;

  // target পরিবর্তন হলে port ও fiber reset
  const handleTargetChange = id => {
    setTargetId(id); setSrcPort(''); setFiberCore('');
    // Existing cable-এর core count auto-detect
    const tgt = connectableNodes.find(n => String(n.id) === id);
    if (tgt) {
      const existing = allLinks.filter(lk =>
        lk.link_type === 'FIBER' && (lk.source_node === tgt.id || lk.target_node === tgt.id)
      );
      const detected = existing.find(lk => lk.fiber_core_count)?.fiber_core_count;
      setCoreCount(detected || 12);
    } else {
      setCoreCount(12);
    }
  };

  const handleConnect = async () => {
    if (!targetId || !target) return toast.error('Node select করুন।');
    if (srcPort && tgtUsedPorts.has(srcPort)) {
      return toast.error(`⛔ Port "${srcPort}" ইতিমধ্যে used।`, { duration: 4000 });
    }
    setConnecting(true);
    try {
      // Step 1: Client এর NetworkNode তৈরি
      const nodeRes = await api.post('/network/nodes/', {
        name: client.full_name, node_type: 'CLIENT',
        latitude: client.latitude, longitude: client.longitude,
        client: client.id, status: client.status === 'active' ? 'active' : 'inactive',
      });
      const clientNode = nodeRes.data;

      // Step 2: Link তৈরি — target (Splitter/OLT) → clientNode
      const linkRes = await api.post('/network/links/', {
        source_node:      target.id,
        target_node:      clientNode.id,
        link_type:        linkType,
        color_code:       LINK_DEFAULT_COLOR[linkType] || '#00bcd4',
        status:           'active',
        source_port:      srcPort,
        target_port:      'ONT',
        fiber_core_color: fiberCore,
        fiber_core_count: linkType === 'FIBER' ? coreCount : undefined,
        paths: [
          { lat: parseFloat(target.latitude),  lng: parseFloat(target.longitude) },
          { lat: parseFloat(client.latitude),  lng: parseFloat(client.longitude) },
        ],
      });

      toast.success(`${client.full_name} ↔ ${target.name} (${srcPort || 'no port'}) connected!`);
      onConnected(clientNode, linkRes.data);
    } catch (err) {
      const msg = err?.response?.data
        ? Object.entries(err.response.data).map(([k, v]) => `${k}: ${[v].flat().join(', ')}`).join(' | ')
        : 'Connection failed.';
      toast.error(msg.slice(0, 150));
    } finally { setConnecting(false); }
  };

  const inpStyle = { width:'100%', border:'1px solid #e2e8f0', borderRadius:6,
    padding:'5px 8px', fontSize:11, outline:'none', background:'#f8fafc', color:'#1e293b' };
  const secLabel = { fontSize:9, color:'#64748b', fontWeight:700, textTransform:'uppercase',
    letterSpacing:'0.05em', marginBottom:4 };

  return (
    <div style={{ marginTop:10, borderTop:'1px solid #f1f5f9', paddingTop:8 }}>
      {/* Toggle button */}
      <button onClick={e => { e.stopPropagation(); setOpen(v => !v); if (open) { setTargetId(''); setSrcPort(''); setFiberCore(''); } }}
        style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'6px 10px', background: open ? '#eff6ff' : '#f8fafc',
          border:'1px solid '+(open ? '#bfdbfe' : '#e2e8f0'), borderRadius:7,
          fontSize:11, fontWeight:700, color: open ? '#1d4ed8' : '#475569', cursor:'pointer' }}>
        <span style={{ display:'flex', alignItems:'center', gap:5 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
          Connect to Network Node
        </span>
        <span style={{ fontSize:9, opacity:.5 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ marginTop:8, display:'flex', flexDirection:'column', gap:8,
          background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, padding:'10px 8px' }}>
          {connectableNodes.length === 0 ? (
            <p style={{ fontSize:10, color:'#94a3b8', textAlign:'center', padding:'6px 0' }}>
              Splitter/OLT/Box নেই। আগে node যোগ করুন।
            </p>
          ) : (<>
            {/* Target node select */}
            <div>
              <div style={secLabel}>Connect To</div>
              <select value={targetId} onChange={e => { e.stopPropagation(); handleTargetChange(e.target.value); }} onClick={e => e.stopPropagation()} style={inpStyle}>
                <option value="">-- Splitter / OLT / Box select করুন --</option>
                {connectableNodes.map(n => {
                  const ns       = NODE_STYLE[n.node_type] || { letter: '?', label: '?' };
                  const usedPorts = getUsedPorts(n.id, allLinks);
                  // শুধু downlink/output port-এর মধ্যে used count করা
                  let freePorts;
                  if (n.node_type === 'SPLITTER') {
                    const sp     = getSplitterPorts(n.splitter_ratio);
                    const usedOut = sp.out.filter(p => usedPorts.has(p)).length;
                    freePorts    = Math.max(0, sp.out.length - usedOut);
                  } else {
                    const np       = getNodePorts(n);
                    const downlinks = np?.downlinks || [];
                    const usedDown  = downlinks.filter(p => usedPorts.has(p)).length;
                    freePorts       = Math.max(0, downlinks.length - usedDown);
                  }
                  return (
                    <option key={n.id} value={String(n.id)}>
                      [{ns.letter}] {n.name} — {freePorts} port free
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Link type */}
            <div>
              <div style={secLabel}>Connection Type</div>
              <select value={linkType} onChange={e => { e.stopPropagation(); setLinkType(e.target.value); }} onClick={e => e.stopPropagation()} style={inpStyle}>
                <option value="FIBER">🔵 Fiber Optic</option>
                <option value="ETHERNET">🟢 Ethernet</option>
                <option value="WIRELESS">🟣 Wireless</option>
              </select>
            </div>

            {/* Port selection — target node এর available ports */}
            {target && (
              <div>
                <div style={{ ...secLabel, display:'flex', justifyContent:'space-between' }}>
                  <span>📍 {target.name} Port</span>
                  {srcPort && <span style={{ color:'#0891b2', textTransform:'none', letterSpacing:0 }}>Selected: {srcPort}</span>}
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:4, padding:2 }}>
                  {tgtIsSplitter ? (
                    <>
                      <PortChip label="📥 In" active={srcPort === 'In'}
                        used={tgtUsedPorts.has('In')} peer={tgtPortLink['In']}
                        onSelect={() => setSrcPort(srcPort === 'In' ? '' : 'In')} />
                      {tgtPorts.out.map(p => (
                        <PortChip key={p} label={p} small active={srcPort === p}
                          used={tgtUsedPorts.has(p)} peer={tgtPortLink[p]}
                          onSelect={() => setSrcPort(srcPort === p ? '' : p)} />
                      ))}
                    </>
                  ) : tgtPorts ? (
                    <>
                      {tgtPorts.uplinks?.map(p => (
                        <PortChip key={p} label={`🔼 ${p}`} active={srcPort === p}
                          used={tgtUsedPorts.has(p)} peer={tgtPortLink[p]}
                          onSelect={() => setSrcPort(srcPort === p ? '' : p)} />
                      ))}
                      {tgtPorts.downlinks?.map(p => (
                        <PortChip key={p} label={p} small active={srcPort === p}
                          used={tgtUsedPorts.has(p)} peer={tgtPortLink[p]}
                          onSelect={() => setSrcPort(srcPort === p ? '' : p)} />
                      ))}
                    </>
                  ) : (
                    <input placeholder="Port (e.g. Out-1)" value={srcPort}
                      onChange={e => setSrcPort(e.target.value)} onClick={e => e.stopPropagation()}
                      style={{ ...inpStyle, fontSize:10, padding:'4px 8px' }} />
                  )}
                </div>
              </div>
            )}

            {/* Fiber cable core count + core selection */}
            {target && linkType === 'FIBER' && (
              <div>
                {/* Core count input */}
                <div style={{ ...secLabel, marginBottom:5 }}>🔵 Fiber Cable — Total Cores</div>
                <div style={{ display:'flex', alignItems:'center', gap:4, marginBottom:8, flexWrap:'wrap' }}>
                  {[2, 4, 6, 8, 12, 24, 48, 96].map(n => (
                    <button key={n} type="button"
                      onClick={e => { e.stopPropagation(); setCoreCount(n); setFiberCore(''); }}
                      style={{ padding:'2px 6px', fontSize:10, fontWeight:700, borderRadius:5, cursor:'pointer',
                        border: coreCount === n ? '2px solid #0891b2' : '1px solid #e2e8f0',
                        background: coreCount === n ? '#0891b2' : '#fff',
                        color: coreCount === n ? '#fff' : '#475569', flexShrink:0 }}>
                      {n}C
                    </button>
                  ))}
                  <input type="number" min={1} max={144} value={coreCount}
                    onChange={e => { e.stopPropagation(); setCoreCount(Math.min(144, Math.max(1, parseInt(e.target.value) || 1))); setFiberCore(''); }}
                    onClick={e => e.stopPropagation()}
                    style={{ width:48, padding:'2px 4px', fontSize:10, border:'1px solid #e2e8f0',
                      borderRadius:5, outline:'none', background:'#f8fafc', textAlign:'center' }} />
                </div>
                {/* Core chips */}
                <div style={{ ...secLabel, display:'flex', justifyContent:'space-between' }}>
                  <span>Core select করুন</span>
                  <span style={{ color: freeCoreCount > 0 ? '#16a34a' : '#ef4444',
                    background: freeCoreCount > 0 ? '#dcfce7' : '#fee2e2',
                    borderRadius:4, padding:'1px 5px', textTransform:'none', letterSpacing:0 }}>
                    {freeCoreCount}/{coreCount} free
                  </span>
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:3, padding:2, maxHeight:80, overflowY:'auto' }}>
                  {dynamicCores.map(c => (
                    <CoreChip key={c.name} core={c}
                      active={fiberCore === c.name}
                      used={usedCores.has(c.name)}
                      onClick={() => setFiberCore(fiberCore === c.name ? '' : c.name)} />
                  ))}
                </div>
                {fiberCore && (
                  <div style={{ marginTop:4, fontSize:10, color:'#0891b2', fontWeight:600 }}>
                    ✓ Selected: {fiberCore} core
                  </div>
                )}
              </div>
            )}

            {/* Connect button */}
            <button onClick={e => { e.stopPropagation(); handleConnect(); }} disabled={connecting || !targetId}
              style={{ padding:'8px', background: !targetId ? '#e2e8f0' : connecting ? '#94a3b8' : '#0891b2',
                color: !targetId ? '#94a3b8' : '#fff', border:'none', borderRadius:7,
                fontSize:11, fontWeight:700, cursor: connecting || !targetId ? 'not-allowed' : 'pointer',
                display:'flex', alignItems:'center', justifyContent:'center', gap:5 }}>
              {connecting ? '⏳ Connecting...' : !targetId ? 'Node select করুন ↑' : (
                <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                Connect {srcPort ? `via ${srcPort}` : ''} {fiberCore ? `(${fiberCore})` : ''}</>
              )}
            </button>
          </>)}
        </div>
      )}
    </div>
  );
}

// ─── MapClickHandler ──────────────────────────────────────────────────────────
// কেন useMapEvents বাদ দিয়ে সরাসরি map.on/off:
//   react-leaflet useMapEvents-এ cleanup-এ arrow fn প্রতি render-এ নতুন reference
//   হয় → Leaflet map.off() মেলাতে পারে না → stale handler জমে।
//   সমাধান: useEffect([map]) দিয়ে handler একবারই register করা হয়।
//   handleMapClick function-টি ref দিয়ে সবসময় latest mode/sourceNode পড়ে।
function MapClickHandler({ mode, sourceNode, onMapClick }) {
  const map = useMap();
  const ref = useRef({ mode, sourceNode, onMapClick });
  ref.current = { mode, sourceNode, onMapClick };

  useEffect(() => {
    function handleMapClick(e) {
      const { mode: m, sourceNode: s, onMapClick: fn } = ref.current;
      if (m === 'addNode') {
        fn({ lat: e.latlng.lat, lng: e.latlng.lng });
      } else if (m === 'drawLink' && s) {
        fn({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    }
    map.on('click', handleMapClick);
    return () => map.off('click', handleMapClick);
  }, [map]); // [map] only — mode/sourceNode/onMapClick সব ref দিয়ে পড়া হয়

  return null;
}

// ─── CursorManager ────────────────────────────────────────────────────────────
// MapContainer-এর ভেতর থেকে useMap() দিয়ে Leaflet instance access করা হয়।
// Leaflet নিজে cursor control করে তাই MapContainer style.cursor কাজ করে না —
// getContainer() দিয়ে DOM element পেয়ে সরাসরি style.cursor set করতে হয়।
function CursorManager({ mode }) {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    if (mode === 'addNode')  el.style.cursor = 'crosshair';
    else if (mode === 'drawLink') el.style.cursor = 'cell';
    else el.style.cursor = '';
  }, [map, mode]);
  return null;
}

// ─── Map position persistence ─────────────────────────────────────────────────
const MAP_POS_KEY = 'gis_map_view_v1';
function savedMapView() {
  try {
    const v = localStorage.getItem(MAP_POS_KEY);
    if (v) return JSON.parse(v);
  } catch {}
  return null;
}
function MapPositionSaver() {
  const map = useMap();
  useEffect(() => {
    const save = () => {
      const c = map.getCenter();
      localStorage.setItem(MAP_POS_KEY, JSON.stringify({
        lat: c.lat, lng: c.lng, zoom: map.getZoom(),
      }));
    };
    map.on('moveend', save);
    map.on('zoomend', save);
    return () => { map.off('moveend', save); map.off('zoomend', save); };
  }, [map]);
  return null;
}

// ─── Link type → default color mapping ────────────────────────────────────────
const LINK_DEFAULT_COLOR = { FIBER: '#00bcd4', ETHERNET: '#10b981', WIRELESS: '#8b5cf6' };

// ─── Standard 12-core fiber color codes ──────────────────────────────────────
// Standard fiber core color sequence (ITU-T G.652 / TIA-598 color coding)
// 12-per-group, group prefix: 1st=plain, 2nd=striped, 3rd=dotted, 4th=dashed
const FIBER_BASE_COLORS = [
  { name: 'Blue',   hex: '#3b82f6' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Green',  hex: '#22c55e' },
  { name: 'Brown',  hex: '#92400e' },
  { name: 'Slate',  hex: '#94a3b8', border: '#64748b' },
  { name: 'White',  hex: '#f8fafc', border: '#cbd5e1' },
  { name: 'Red',    hex: '#ef4444' },
  { name: 'Black',  hex: '#1e293b' },
  { name: 'Yellow', hex: '#eab308' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Rose',   hex: '#f43f5e' },
  { name: 'Aqua',   hex: '#06b6d4' },
];
const GROUP_SUFFIX = ['', ' (B)', ' (Str)', ' (Dot)'];

// n কোর সংখ্যা অনুযায়ী fiber core list তৈরি করে
function generateFiberCores(n) {
  const cores = [];
  for (let i = 0; i < n; i++) {
    const base  = FIBER_BASE_COLORS[i % 12];
    const group = Math.floor(i / 12);
    cores.push({
      name:   base.name + GROUP_SUFFIX[group] || base.name + ` G${group + 1}`,
      hex:    base.hex,
      border: base.border,
    });
  }
  return cores;
}

const FIBER_CORE_12 = [
  { name: 'Blue',   hex: '#3b82f6' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Green',  hex: '#22c55e' },
  { name: 'Brown',  hex: '#a16207' },
  { name: 'Slate',  hex: '#94a3b8', border: '#64748b' },
  { name: 'White',  hex: '#f8fafc', border: '#cbd5e1' },
  { name: 'Red',    hex: '#ef4444' },
  { name: 'Black',  hex: '#1e293b' },
  { name: 'Yellow', hex: '#eab308' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Rose',   hex: '#f43f5e' },
  { name: 'Aqua',   hex: '#06b6d4' },
];

// ─── Shared UI chips (module-level — NodeActionCard ও ClientConnectSection উভয়ে ব্যবহার করে) ─
function PortChip({ label, active, used, peer, small, onSelect }) {
  return (
    <button type="button"
      onClick={e => {
        e.stopPropagation();
        if (used && !active) {
          toast.error(`⛔ Port "${label}" ইতিমধ্যে "${peer || '?'}"-এ connected।`, { duration: 4000 });
          return;
        }
        onSelect();
      }}
      title={used && !active ? `Connected to: ${peer || 'another node'}` : label}
      style={{
        fontSize: small ? 10 : 11, padding: small ? '3px 7px' : '4px 10px',
        borderRadius: 6, fontFamily: 'monospace', fontWeight: 700,
        transition: 'all 0.15s', flexShrink: 0,
        cursor: used && !active ? 'not-allowed' : 'pointer',
        border: active ? '2px solid #0891b2' : used ? '2px solid #fca5a5' : '1.5px solid #e2e8f0',
        background: active ? '#0891b2' : used ? '#fff1f2' : '#fff',
        color:      active ? '#fff'    : used ? '#b91c1c' : '#475569',
        opacity: used && !active ? 0.8 : 1,
        boxShadow: active ? '0 2px 6px rgba(8,145,178,0.35)' : used ? '0 0 0 1px #fecaca' : 'none',
      }}>
      {used && !active ? `${label} 🔒` : label}
    </button>
  );
}

function CoreChip({ core, active, used, onClick }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
      <button type="button"
        onClick={e => { e.stopPropagation(); onClick(); }}
        title={used ? `${core.name} — used` : `${core.name} — select`}
        style={{
          width: 28, height: 28, borderRadius: 6,
          border: active ? '3px solid #0f172a' : used ? `2px solid ${core.border || core.hex}` : `2px solid ${core.border || core.hex}`,
          background: core.hex, cursor: 'pointer', position: 'relative', flexShrink: 0,
          opacity: used ? 0.3 : 1,
          boxShadow: active ? '0 0 0 3px #0891b2' : 'none',
          transform: active ? 'scale(1.15)' : 'scale(1)',
          transition: 'all 0.12s',
        }}
      >
        {used && <span style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#1e293b', fontWeight:900 }}>✕</span>}
      </button>
      <span style={{ fontSize:8, fontWeight:600, color: active ? '#0891b2' : used ? '#94a3b8' : '#475569',
          whiteSpace:'nowrap' }}>
        {core.name.length > 5 ? core.name.substring(0,5) : core.name}
      </span>
    </div>
  );
}

// ─── Device port defaults ─────────────────────────────────────────────────────
// প্রতিটি node type-এর default port count ও label।
// user port_count/uplink_count সেট করলে সেটাই ব্যবহার হবে।
const NODE_PORT_DEFAULTS = {
  ROUTER: { upCnt: 1, downCnt: 4,  upPfx: 'WAN',     downPfx: 'Port' },
  OLT:    { upCnt: 2, downCnt: 8,  upPfx: 'UP-Link',  downPfx: 'PON'  },
  BOX:    { upCnt: 1, downCnt: 8,  upPfx: 'In',       downPfx: 'Port' },
  CLIENT: { upCnt: 1, downCnt: 0,  upPfx: 'ONT',      downPfx: ''     },
};

// node থেকে port list তৈরি করে।
function getNodePorts(node) {
  if (!node) return null;  // null/undefined guard
  if (node.node_type === 'SPLITTER') return null; // handled separately
  const def = NODE_PORT_DEFAULTS[node.node_type];
  if (!def) return null;
  const upCnt   = node.uplink_count ?? def.upCnt;
  const downCnt = node.port_count   ?? def.downCnt;
  const uplinks = upCnt  === 1
    ? [def.upPfx]
    : Array.from({ length: upCnt   }, (_, i) => `${def.upPfx}-${i + 1}`);
  const downlinks = Array.from({ length: downCnt }, (_, i) => `${def.downPfx}-${i + 1}`);
  return { uplinks, downlinks, def };
}

// node-এর existing links থেকে used port set বের করে।
function getUsedPorts(nodeId, links) {
  const used = new Set();
  links.forEach(lk => {
    if (lk.source_node === nodeId && lk.source_port) used.add(lk.source_port);
    if (lk.target_node === nodeId && lk.target_port) used.add(lk.target_port);
  });
  return used;
}

// ─── Splitter port helper ─────────────────────────────────────────────────────
// ratio থেকে Splitter-এর available output ports তৈরি করে।
// Tap (b>50): Main + Tap মাত্র ২টি output।
// PLC (1:N):  Out-1 … Out-N, minimum 64 পর্যন্ত সমর্থিত।
function getSplitterPorts(ratio) {
  if (!ratio) return { type: 'plc', out: Array.from({ length: 4 }, (_, i) => `Out-${i + 1}`) };
  const [a, b] = ratio.split(':').map(Number);
  if (b > 50) return { type: 'tap', out: [`Main (${b}%)`, `Tap (${a}%)`] };
  return { type: 'plc', out: Array.from({ length: b }, (_, i) => `Out-${i + 1}`) };
}

// ─── Parse used fiber cores from link list ────────────────────────────────────
// fiber_core_color field-এ store করা color names extract করে।
function parseUsedCores(links) {
  const used = new Set();
  links.forEach(l => {
    if (!l.fiber_core_color) return;
    l.fiber_core_color.split(/[,→\-–]/).forEach(s => {
      const cleaned = s.trim().replace(/\(.*\)/, '').trim();
      if (cleaned) used.add(cleaned);
    });
  });
  return used;
}

// ─── Cable group key ──────────────────────────────────────────────────────────
// Same node pair (regardless of direction) = same physical fiber cable.
// Used for multi-core cable tracking and grouped map popup.
function getCableKey(link) {
  const [a, b] = [link.source_node, link.target_node].sort((x, y) => x - y);
  return `${a}-${b}`;
}

function NodeActionCard({ node, allNodes, allLinks, clientMarkers = [], onEdit, onDeleted, onLinkCreated, onLinkDeleted, onLinkUpdated, onEditLink, onNodeCreated, onNodeUpdated, onNodeDeleted }) {
  const isClientNode = node.node_type === 'CLIENT';
  // CLIENT node-এর জন্য clientMarkers থেকে dynamic data খোঁজো
  const clientData = isClientNode && node.client
    ? clientMarkers.find(c => c.id === node.client) ?? null
    : null;

  const [view, setView]         = useState('main');
  const [deleting, setDeleting] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [linkType, setLinkType] = useState('FIBER');
  const [colorCode, setColor]   = useState(LINK_DEFAULT_COLOR.FIBER);
  const [connecting, setConn]   = useState(false);
  // Port selection for Splitter nodes
  const [srcPort,     setSrcPort]     = useState('');
  const [dstPort,     setDstPort]     = useState('');
  // Fiber core color — source end ও destination end আলাদাভাবে track করা হয়
  // দুই প্রান্ত একই physical fiber strand → একই color হওয়া উচিত
  const [srcFiberCore, setSrcFiberCore] = useState(''); // source node-এর end
  const [dstFiberCore, setDstFiberCore] = useState(''); // target node-এর end
  // Override toggle — same-cable core conflict bypass করতে (reconfiguration-এর সময়)
  const [coreOverride, setCoreOverride] = useState(false);
  // Fiber cable core count — user নির্ধারণ করবে কত কোরের ক্যাবল
  const [nodeCoreCount, setNodeCoreCount] = useState(12);
  // link delete tracking
  const [deletingLinkId, setDeletingLinkId] = useState(null);

  const s  = NODE_STYLE[node.node_type] || { bg: '#374151', letter: '?', label: 'Unknown' };
  const sc = STATUS_COLOR[node.status] || '#6b7280';

  // এই node থেকে/তে যাওয়া বিদ্যমান লিংক
  const myLinks = allLinks.filter(
    l => l.source_node === node.id || l.target_node === node.id
  );
  // lat/lng আছে এমন অন্য সব নোড — target dropdown
  const otherNodes = allNodes.filter(n => n.id !== node.id && n.latitude && n.longitude);
  // Dynamic clients যাদের NetworkNode নেই — id হবে 'dyn-{client.id}'
  const existingClientNodeIds = new Set(allNodes.filter(n => n.client).map(n => n.client));
  const dynClients = clientMarkers.filter(c => !existingClientNodeIds.has(c.id));

  // link type পরিবর্তনে color auto-set
  const handleTypeChange = (t) => { setLinkType(t); setColor(LINK_DEFAULT_COLOR[t] || '#00bcd4'); };

  // existing link delete
  const handleDeleteLink = async (linkId, peerName) => {
    if (!window.confirm(`"${node.name}" ↔ "${peerName}" link delete করবেন?`)) return;
    setDeletingLinkId(linkId);
    try {
      await api.delete(`/network/links/${linkId}/`);
      toast.success('Link deleted.');
      onLinkDeleted(linkId);
    } catch {
      toast.error('Link delete failed.');
    } finally {
      setDeletingLinkId(null);
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/network/nodes/${node.id}/`);
      toast.success(`"${node.name}" deleted.`);
      onDeleted(node.id);
    } catch {
      toast.error('Failed to delete node.');
      setDeleting(false);
    }
  };

  // ── Auto-create link — straight line between source & target lat/lng ────────
  // Manual waypoints-এর বদলে সরাসরি দুই নোডের position দিয়ে straight line তৈরি।
  // জটিল ফাইবার route-এর জন্য "Draw Link" mode আলাদাভাবে ব্যবহার করতে হবে।
  const handleCreateLink = async () => {
    if (!targetId) return toast.error('Target node select করুন।');

    // ── Step 1: Dynamic client → NetworkNode auto-create ─────────────────────
    let target = otherNodes.find(n => String(n.id) === String(targetId));

    if (!target && String(targetId).startsWith('dyn-')) {
      const clientId = parseInt(targetId.replace('dyn-', ''));
      const dynClient = dynClients.find(c => c.id === clientId);
      if (!dynClient) return toast.error('Client not found.');
      setConn(true);
      try {
        const nodeRes = await api.post('/network/nodes/', {
          name:      dynClient.full_name,
          node_type: 'CLIENT',
          latitude:  dynClient.latitude,
          longitude: dynClient.longitude,
          client:    dynClient.id,
          status:    dynClient.status === 'active' ? 'active' : 'inactive',
        });
        target = nodeRes.data;
        if (onNodeCreated) onNodeCreated(nodeRes.data);
      } catch {
        setConn(false);
        return toast.error('Client node তৈরি করতে সমস্যা হয়েছে।');
      }
    }

    if (!target) return;

    // ── CLIENT node max 1 connection check ───────────────────────────────────
    const checkClient = (nd) => {
      if (nd.node_type !== 'CLIENT') return false;
      const exists = allLinks.some(l => l.source_node === nd.id || l.target_node === nd.id);
      if (exists) {
        toast.error(`⛔ Client "${nd.name}"-এর ONU-তে একটিমাত্র optical port আছে। ইতিমধ্যে connected।`, { duration: 5000 });
        return true;
      }
      return false;
    };
    if (checkClient(node) || checkClient(target)) return;

    // ── Same node pair duplicate check (when port not specified) ─────────────
    const samePairExists = allLinks.some(l =>
      (l.source_node === node.id && l.target_node === target.id) ||
      (l.source_node === target.id && l.target_node === node.id)
    );
    // প্রতিটি link = আলাদা fiber cable। তবে port না দিলে complete duplicate ব্লক করা হয়।
    if (samePairExists && !srcPort && !dstPort && !srcFiberCore && !dstFiberCore) {
      return toast.error(
        `⚠ ${node.name} ↔ ${target.name} already connected. New cable-এর জন্য port বা fiber core select করুন।`,
        { duration: 6000 }
      );
    }

    // ── Port duplicate validation (client-side) ──────────────────────────────
    const myUsedPorts  = getUsedPorts(node.id,   allLinks);
    const tgtUsedPorts = getUsedPorts(target.id, allLinks);
    if (srcPort && myUsedPorts.has(srcPort)) {
      const lk = allLinks.find(l => (l.source_node === node.id && l.source_port === srcPort) || (l.target_node === node.id && l.target_port === srcPort));
      return toast.error(`⛔ Port "${srcPort}" is already connected to "${lk ? (lk.source_node === node.id ? lk.target_node_name : lk.source_node_name) : '?'}".`, { duration: 5000 });
    }
    if (dstPort && tgtUsedPorts.has(dstPort)) {
      const lk = allLinks.find(l => (l.source_node === target.id && l.source_port === dstPort) || (l.target_node === target.id && l.target_port === dstPort));
      return toast.error(`⛔ Port "${dstPort}" on ${target.name} is already connected to "${lk ? (lk.source_node === target.id ? lk.target_node_name : lk.source_node_name) : '?'}".`, { duration: 5000 });
    }

    // ── Same-cable fiber core duplicate validation ───────────────────────────
    const sameCableLinks = allLinks.filter(lk =>
      (lk.source_node === node.id && lk.target_node === target.id) ||
      (lk.source_node === target.id && lk.target_node === node.id)
    );
    const coreToCheck = srcFiberCore || dstFiberCore;
    if (coreToCheck && parseUsedCores(sameCableLinks).has(coreToCheck) && !coreOverride) {
      return toast.error(`⛔ Core "${coreToCheck}" already used on this cable.`, { duration: 5000 });
    }

    setConn(true);
    try {
      const fiberCoreColor = srcFiberCore && dstFiberCore
        ? (srcFiberCore === dstFiberCore ? srcFiberCore : `${srcFiberCore}→${dstFiberCore}`)
        : (srcFiberCore || dstFiberCore || '');
      const res = await api.post('/network/links/', {
        source_node:         node.id,
        target_node:         target.id,
        link_type:           linkType,
        color_code:          colorCode,
        status:              'active',
        source_port:         srcPort,
        target_port:         dstPort,
        fiber_core_color:    fiberCoreColor,
        fiber_core_count:    linkType === 'FIBER' ? nodeCoreCount : undefined,
        force_core_override: coreOverride ? 'true' : 'false',
        paths: [
          { lat: parseFloat(node.latitude),   lng: parseFloat(node.longitude) },
          { lat: parseFloat(target.latitude), lng: parseFloat(target.longitude) },
        ],
      });
      toast.success(`${node.name} → ${target.name} connected!`);
      onLinkCreated(res.data);
      setView('main');
      setTargetId('');
      setSrcPort(''); setDstPort(''); setSrcFiberCore(''); setDstFiberCore(''); setCoreOverride(false);
    } catch (err) {
      const detail = err?.response?.data
        ? Object.entries(err.response.data).map(([k, v]) => `${k}: ${[v].flat().join(', ')}`).join(' | ')
        : err?.message || 'Unknown error';
      toast.error(`Link error: ${detail}`, { duration: 6000 });
      console.error('Create link error:', err?.response?.data ?? err);
    } finally { setConn(false); }
  };

  // ── Shared node header (both views) ────────────────────────────────────────
  const Header = ({ title, onBack }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
        paddingBottom: 10, borderBottom: '1px solid #f1f5f9' }}>
      {onBack && (
        <button onClick={onBack} style={{ background: 'none', border: 'none',
            cursor: 'pointer', color: '#64748b', fontSize: 16, padding: '0 4px', lineHeight: 1 }}>
          ←
        </button>
      )}
      <div style={{ background: s.bg, width: 28, height: 28, borderRadius: 6, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        dangerouslySetInnerHTML={{ __html: getNodeSvg(node.node_type, 16, 16) }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 12, color: '#0f172a' }}>{node.name}</div>
        <div style={{ fontSize: 10, color: '#94a3b8' }}>{title || s.label}</div>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW: main
  // ══════════════════════════════════════════════════════════════════════════
  if (view === 'main') return (
    <div style={{ fontFamily: 'Inter, sans-serif', width: 295 }}>
      <Header />

      {/* ── NODE basic info (non-CLIENT) ── */}
      {!isClientNode && (
        <div style={{ fontSize: 11, marginBottom: 10, lineHeight: 1.9 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#94a3b8' }}>Status</span>
            <span style={{ color: sc, fontWeight: 600 }}>● {node.status_display || node.status}</span>
          </div>
          {node.ip_address && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>IP</span>
              <code style={{ color: '#475569', fontSize: 10 }}>{node.ip_address}</code>
            </div>
          )}
          {node.node_type === 'SPLITTER' && node.splitter_ratio && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Ratio</span>
              <span style={{ fontWeight: 700, color: '#0891b2', fontSize: 11,
                  background: '#e0f2fe', borderRadius: 4, padding: '0 5px' }}>
                {node.splitter_ratio}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── CLIENT dynamic info card ── */}
      {isClientNode && (() => {
        const cd = clientData;
        const STATUS_CFG = {
          active:    { bg: '#dcfce7', color: '#16a34a', label: 'Active' },
          inactive:  { bg: '#fee2e2', color: '#dc2626', label: 'Inactive' },
          suspended: { bg: '#fef3c7', color: '#d97706', label: 'Suspended' },
          expired:   { bg: '#f1f5f9', color: '#64748b', label: 'Expired' },
        };
        const stCfg = STATUS_CFG[cd?.status || node.status] || STATUS_CFG.inactive;
        const today = new Date();
        const expiry = cd?.expiry_date && cd.expiry_date !== '—' ? new Date(cd.expiry_date) : null;
        const daysLeft = expiry ? Math.ceil((expiry - today) / 86400000) : null;

        const Row = ({ label, value, valueStyle = {} }) => (
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', paddingBottom:4, marginBottom:4, borderBottom:'1px solid #f1f5f9' }}>
            <span style={{ color:'#94a3b8', fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.04em' }}>{label}</span>
            <span style={{ color:'#0f172a', fontSize:11, fontWeight:600, textAlign:'right', maxWidth:150, ...valueStyle }}>{value}</span>
          </div>
        );

        return (
          <div style={{ marginBottom:10 }}>
            {/* Status badge */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
              <span style={{ fontSize:10, color:'#64748b' }}>{cd?.customer_id || '—'}</span>
              <span style={{ fontSize:10, fontWeight:700, borderRadius:20, padding:'2px 10px',
                  background:stCfg.bg, color:stCfg.color }}>
                ● {stCfg.label}
              </span>
            </div>

            {/* Info rows */}
            {cd ? (
              <>
                <Row label="Package" value={cd.package_name} />
                <Row label="Zone" value={`${cd.zone_name}${cd.subzone_name !== '—' ? ' / '+cd.subzone_name : ''}`} />
                <Row label="Monthly Bill" value={`৳ ${parseFloat(cd.monthly_bill).toLocaleString()}`}
                  valueStyle={{ color:'#0891b2', fontWeight:700 }} />
                <Row label="Due Amount" value={`৳ ${parseFloat(cd.due_amount).toLocaleString()}`}
                  valueStyle={{ color: parseFloat(cd.due_amount) > 0 ? '#dc2626' : '#16a34a', fontWeight:700 }} />
                <Row label="Phone" value={cd.phone || '—'} />
                {expiry && (
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', paddingBottom:4, marginBottom:4, borderBottom:'1px solid #f1f5f9' }}>
                    <span style={{ color:'#94a3b8', fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.04em' }}>Expiry</span>
                    <span style={{ fontSize:11, fontWeight:700,
                        color: daysLeft < 0 ? '#dc2626' : daysLeft <= 5 ? '#d97706' : '#16a34a' }}>
                      {cd.expiry_date}
                      {daysLeft !== null && (
                        <span style={{ fontSize:9, marginLeft:4, fontWeight:400, color: daysLeft < 0 ? '#dc2626' : '#94a3b8' }}>
                          {daysLeft < 0 ? `(${Math.abs(daysLeft)}d ago)` : `(${daysLeft}d left)`}
                        </span>
                      )}
                    </span>
                  </div>
                )}
                {cd.router_name && cd.router_name !== '—' && (
                  <Row label="Router" value={cd.router_name} />
                )}
              </>
            ) : (
              <div style={{ fontSize:10, color:'#94a3b8', textAlign:'center', padding:'8px 0', fontStyle:'italic' }}>
                Client data loading...
              </div>
            )}

            {/* Optical connection */}
            {myLinks.length > 0 && (
              <div style={{ marginTop:8, background:'#f0f9ff', borderRadius:7, padding:'6px 10px',
                  border:'1px solid #bae6fd' }}>
                <div style={{ fontSize:9, color:'#0369a1', fontWeight:700, textTransform:'uppercase',
                    letterSpacing:1, marginBottom:4 }}>📡 Optical Connection</div>
                {myLinks.map(lk => {
                  const peer     = lk.source_node === node.id ? lk.target_node_name : lk.source_node_name;
                  const peerType = lk.source_node === node.id ? lk.target_node_type : lk.source_node_type;
                  const myPort   = lk.source_node === node.id ? lk.source_port : lk.target_port;
                  const peerPort = lk.source_node === node.id ? lk.target_port : lk.source_port;
                  const pSt      = NODE_STYLE[peerType] || { bg:'#374151' };
                  const cn       = lk.fiber_core_color?.split(/[,→\-–]/)[0]?.trim();
                  const co       = cn ? FIBER_BASE_COLORS.find(c => c.name.toLowerCase() === cn.toLowerCase()) : null;
                  return (
                    <div key={lk.id} style={{ display:'flex', alignItems:'center', gap:5, marginBottom:2 }}>
                      <div style={{ width:14, height:14, borderRadius:3, flexShrink:0, background:pSt.bg,
                          display:'flex', alignItems:'center', justifyContent:'center' }}
                        dangerouslySetInnerHTML={{ __html: getNodeSvg(peerType, 9, 9) }}
                      />
                      <span style={{ fontSize:10, fontWeight:600, color:'#0f172a', flex:1 }}>{peer}</span>
                      {peerPort && <code style={{ fontSize:8, color:'#0369a1', background:'#dbeafe', borderRadius:3, padding:'1px 4px' }}>{peerPort}</code>}
                      {co && <div style={{ width:9, height:9, borderRadius:1, background:co.hex, border:`1.5px solid ${co.border||co.hex}`, flexShrink:0 }} title={cn} />}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* Connected links — compact list */}
      {myLinks.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: '#475569', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.06em', marginBottom: 5 }}>
            Connections ({myLinks.length})
          </div>
          {myLinks.map(lk => {
            const isSource  = lk.source_node === node.id;
            const peer      = isSource ? lk.target_node_name : lk.source_node_name;
            const peerType  = isSource ? lk.target_node_type : lk.source_node_type;
            const myPort    = isSource ? lk.source_port : lk.target_port;
            const peerPort  = isSource ? lk.target_port : lk.source_port;
            const peerSt    = NODE_STYLE[peerType] || { bg: '#374151', letter: '?' };
            const typeColor = { FIBER: '#0891b2', ETHERNET: '#10b981', WIRELESS: '#8b5cf6' }[lk.link_type] || '#64748b';
            const isDeleting = deletingLinkId === lk.id;
            return (
              <div key={lk.id} style={{ background: '#f8fafc', borderRadius: 7, padding: '5px 8px',
                  marginBottom: 4, border: `1px solid ${lk.color_code || '#e2e8f0'}44` }}>
                {/* Peer row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: lk.color_code || '#00bcd4', flexShrink: 0 }} />
                  <div style={{ background: peerSt.bg, width: 17, height: 17, borderRadius: 4, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    dangerouslySetInnerHTML={{ __html: getNodeSvg(peerType, 11, 11) }}
                  />
                  <span style={{ fontWeight: 600, fontSize: 11, color: '#0f172a', flex: 1, minWidth: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{peer}</span>
                  <span style={{ fontSize: 9, background: `${typeColor}22`, color: typeColor,
                      borderRadius: 4, padding: '1px 5px', fontWeight: 700, flexShrink: 0 }}>{lk.link_type}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onEditLink && onEditLink(lk); }}
                    title="Edit fiber core / details"
                    style={{ background: 'none', border: 'none', cursor: 'pointer',
                      color: '#0891b2', fontSize: 11, padding: '0 2px', lineHeight: 1, flexShrink: 0,
                      opacity: 0.6, transition: 'opacity 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '0.6'}
                  >
                    ✏️
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteLink(lk.id, peer); }}
                    disabled={isDeleting}
                    title="Delete this link"
                    style={{ background: 'none', border: 'none', cursor: isDeleting ? 'not-allowed' : 'pointer',
                      color: '#e11d48', fontSize: 12, padding: '0 2px', lineHeight: 1, flexShrink: 0,
                      opacity: isDeleting ? 0.4 : 0.6, transition: 'opacity 0.15s' }}
                    onMouseEnter={e => { if (!isDeleting) e.currentTarget.style.opacity = '1'; }}
                    onMouseLeave={e => { if (!isDeleting) e.currentTarget.style.opacity = '0.6'; }}
                  >
                    {isDeleting ? '…' : '✕'}
                  </button>
                </div>
                {/* Port + fiber summary — compact single line */}
                {(myPort || peerPort || (lk.link_type === 'FIBER' && lk.fiber_core_count)) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, paddingLeft: 28, fontSize: 9, color: '#64748b', flexWrap:'wrap' }}>
                    {myPort && <code style={{ background:'#e0f2fe', color:'#0369a1', borderRadius:3, padding:'0 4px', fontFamily:'monospace' }}>📌 {myPort}</code>}
                    {myPort && peerPort && <span style={{ color: '#cbd5e1' }}>→</span>}
                    {peerPort && <code style={{ background:'#dcfce7', color:'#15803d', borderRadius:3, padding:'0 4px', fontFamily:'monospace' }}>{peerPort}</code>}
                    {lk.fiber_core_count && <span style={{ color:'#0891b2', fontFamily:'monospace', fontWeight:700 }}>{lk.fiber_core_count}C</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Splitter Port Panel — SPLITTER node-এর জন্য IN/OUT port management */}
      {node.node_type === 'SPLITTER' && (
        <SplitterPortPanel
          splitter={node}
          allLinks={allLinks}
          allNodes={allNodes}
          clientMarkers={clientMarkers}
          onLinkCreated={onLinkCreated}
          onLinkUpdated={onLinkUpdated}
          onNodeCreated={onNodeCreated}
        />
      )}

      {/* Join Box Panel — BOX node-এর জন্য cable junction view */}
      {node.node_type === 'BOX' && (
        <JoinBoxPanel
          node={node}
          allLinks={allLinks}
          allNodes={allNodes}
          clientMarkers={clientMarkers}
          onLinkCreated={onLinkCreated}
          onNodeCreated={onNodeCreated}
          onLinkUpdated={onLinkUpdated}
          onNodeUpdated={onNodeUpdated}
          onNodeDeleted={onNodeDeleted}
        />
      )}

      {/* 3 action buttons */}
      <div style={{ display: 'flex', gap: 5 }}>
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          style={{ flex: 1, background: '#173d59', color: '#fff', border: 'none',
            borderRadius: 8, padding: '8px 0', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
          onMouseEnter={e => e.currentTarget.style.background = '#1f5075'}
          onMouseLeave={e => e.currentTarget.style.background = '#173d59'}
        >
          ✏️ Edit
        </button>
        {/* CLIENT: Direction button — Google Maps-এ navigate */}
        {isClientNode && node.latitude && node.longitude && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              window.open(
                `https://www.google.com/maps/dir/?api=1&destination=${node.latitude},${node.longitude}`,
                '_blank'
              );
            }}
            title="Get directions to client location"
            style={{ flex: 1, background: '#16a34a', color: '#fff', border: 'none',
              borderRadius: 8, padding: '8px 0', fontSize: 11, fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
            onMouseEnter={e => e.currentTarget.style.background = '#15803d'}
            onMouseLeave={e => e.currentTarget.style.background = '#16a34a'}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="3 11 22 2 13 21 11 13 3 11"/>
            </svg>
            Direction
          </button>
        )}

        {/* Non-CLIENT: 🔗 Link button */}
        {!isClientNode && (
          <button
            onClick={(e) => { e.stopPropagation(); setView('connect'); }}
            style={{ flex: 1, background: '#0891b2', color: '#fff', border: 'none',
              borderRadius: 8, padding: '8px 0', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = '#0e7490'}
            onMouseLeave={e => e.currentTarget.style.background = '#0891b2'}
          >
            🔗 Link
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); setView('delConfirm'); }}
          style={{ background: '#fff1f2', color: '#e11d48', border: '1px solid #fecdd3',
            borderRadius: 8, padding: '8px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
        >
          🗑️
        </button>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW: delConfirm
  // ══════════════════════════════════════════════════════════════════════════
  if (view === 'delConfirm') return (
    <div style={{ fontFamily: 'Inter, sans-serif', width: 240 }}>
      <Header onBack={() => setView('main')} />
      <p style={{ fontSize: 12, color: '#dc2626', textAlign: 'center', margin: '8px 0 12px' }}>
        "{node.name}" স্থায়ীভাবে মুছে ফেলবেন?
      </p>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={handleDelete} disabled={deleting}
          style={{ flex: 1, background: '#dc2626', color: '#fff', border: 'none',
            borderRadius: 8, padding: '8px 0', fontSize: 11, fontWeight: 600,
            cursor: 'pointer', opacity: deleting ? 0.6 : 1 }}>
          {deleting ? 'Deleting...' : 'Confirm Delete'}
        </button>
        <button onClick={() => setView('main')}
          style={{ background: '#f8fafc', color: '#64748b', border: '1px solid #e2e8f0',
            borderRadius: 8, padding: '8px 12px', fontSize: 11, cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW: connect — dynamic node selector + link creation
  // ══════════════════════════════════════════════════════════════════════════
  const inp = { width: '100%', border: '1px solid #e2e8f0', borderRadius: 8,
    padding: '7px 10px', fontSize: 11, outline: 'none', boxSizing: 'border-box',
    fontFamily: 'Inter, sans-serif', color: '#0f172a', background: '#fff' };

  const typeColors = { FIBER: '#0891b2', ETHERNET: '#10b981', WIRELESS: '#8b5cf6' };

  return (
    // onClick stopPropagation — Leaflet popup যেন card-এর ভেতরের
    // click-এ বন্ধ না হয় (Leaflet click propagation intercept করে)
    <div
      style={{ fontFamily: 'Inter, sans-serif', width: 280 }}
      onClick={e => e.stopPropagation()}
    >
      <Header title="🔗 Connect to Node" onBack={() => setView('main')} />

      {/* ── No nodes available state ─────────────────────────────────────── */}
      {otherNodes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '10px 0 6px' }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>🗺️</div>
          <div style={{ fontSize: 12, color: '#475569', fontWeight: 600, marginBottom: 4 }}>
            কোনো target node নেই
          </div>
          <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.6, marginBottom: 12 }}>
            Map-এ <strong style={{ color: '#059669' }}>+ Add Node</strong> বাটন দিয়ে<br />
            আরও নোড যোগ করুন, তারপর এখান<br />থেকে fiber/cable connect করুন।
          </div>
          <button
            onClick={() => setView('main')}
            style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0',
              borderRadius: 8, padding: '7px 16px', fontSize: 11, cursor: 'pointer' }}
          >
            ← Back
          </button>
        </div>
      ) : (
        <>
          {/* Existing connections */}
          {myLinks.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>
                Existing Links
              </div>
              {myLinks.map(lk => {
                const peer = lk.source_node === node.id ? lk.target_node_name : lk.source_node_name;
                const isDel = deletingLinkId === lk.id;
                return (
                  <div key={lk.id} style={{ display: 'flex', alignItems: 'center', gap: 4,
                      background: '#f8fafc', borderRadius: 6,
                      padding: '4px 8px', marginBottom: 3, fontSize: 10 }}>
                    <span style={{ color: '#475569', fontWeight: 500, flex: 1 }}>↔ {peer}</span>
                    <span style={{ color: typeColors[lk.link_type] || '#64748b', fontWeight: 600,
                        fontSize: 9, background: `${typeColors[lk.link_type] || '#6b7280'}18`,
                        borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>
                      {lk.link_type}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); onEditLink && onEditLink(lk); }}
                      title="Edit fiber core / details"
                      style={{ background: 'none', border: 'none', cursor: 'pointer',
                        color: '#0891b2', fontSize: 11, padding: '0 2px', lineHeight: 1, flexShrink: 0,
                        opacity: 0.55, transition: 'opacity 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                      onMouseLeave={e => e.currentTarget.style.opacity = '0.55'}
                    >
                      ✏️
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteLink(lk.id, peer); }}
                      disabled={isDel}
                      title="Delete link"
                      style={{ background: 'none', border: 'none', cursor: isDel ? 'not-allowed' : 'pointer',
                        color: '#e11d48', fontSize: 12, padding: '0 2px', lineHeight: 1, flexShrink: 0,
                        opacity: isDel ? 0.4 : 0.55, transition: 'opacity 0.15s' }}
                      onMouseEnter={e => { if (!isDel) e.currentTarget.style.opacity = '1'; }}
                      onMouseLeave={e => { if (!isDel) e.currentTarget.style.opacity = '0.55'; }}
                    >
                      {isDel ? '…' : '✕'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Target node dropdown */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, marginBottom: 4,
                textTransform: 'uppercase', letterSpacing: 1 }}>
              Connect To
            </div>
            <select
              value={targetId}
              onChange={e => {
                e.stopPropagation();
                const newId = e.target.value;
                setTargetId(newId); setSrcFiberCore(''); setDstFiberCore('');
                // Existing cable core count auto-detect
                const tgt = otherNodes.find(n => String(n.id) === newId);
                if (tgt) {
                  const cableLks = allLinks.filter(lk =>
                    (lk.source_node === node.id && lk.target_node === tgt.id) ||
                    (lk.source_node === tgt.id && lk.target_node === node.id)
                  );
                  const detected = cableLks.find(lk => lk.fiber_core_count)?.fiber_core_count;
                  setNodeCoreCount(detected || 12);
                } else { setNodeCoreCount(12); }
              }}
              style={inp}
            >
              <option value="">-- Target node select করুন --</option>
              {otherNodes.map(n => {
                const ns = NODE_STYLE[n.node_type] || { letter: '?', label: 'Unknown' };
                const hasAnyLink = allLinks.some(l => l.source_node === n.id || l.target_node === n.id);
                const clientFull = n.node_type === 'CLIENT' && hasAnyLink;
                const samePair = allLinks.some(l =>
                  (l.source_node === node.id && l.target_node === n.id) ||
                  (l.source_node === n.id && l.target_node === node.id)
                );
                let label = `[${ns.letter}] ${n.name}`;
                if (clientFull) label += ' 🔒 ONU full';
                else if (samePair) label += ' ⚠ already linked';
                return (
                  <option key={n.id} value={String(n.id)} disabled={clientFull}>{label}</option>
                );
              })}
              {/* Dynamic clients — NetworkNode নেই, auto-create হবে */}
              {dynClients.length > 0 && (
                <option disabled>── Clients (GPS) ──</option>
              )}
              {dynClients.map(c => (
                <option key={`dyn-${c.id}`} value={`dyn-${c.id}`}>
                  [C] {c.full_name} ({c.customer_id})
                </option>
              ))}
            </select>
          </div>

          {/* ── Splitter port + fiber core section ───────────────────────── */}
          {(() => {
            const target = otherNodes.find(n => String(n.id) === String(targetId));
            const myIsSplitter     = node.node_type   === 'SPLITTER';
            const targetIsSplitter = target?.node_type === 'SPLITTER';
            const showPortSection  = true; // always show for port + fiber core tracking

            // ── Port data ────────────────────────────────────────────────────
            const myDevicePorts  = getNodePorts(node);
            const tgtDevicePorts = target ? getNodePorts(target) : null;
            const myPorts        = myIsSplitter ? getSplitterPorts(node.splitter_ratio) : null;
            const tgtPorts       = targetIsSplitter ? getSplitterPorts(target?.splitter_ratio) : null;

            // ── Used ports from existing links ───────────────────────────────
            const myUsedPorts  = getUsedPorts(node.id, allLinks);
            const tgtUsedPorts = target ? getUsedPorts(target.id, allLinks) : new Set();

            // ── Port → link map (who occupies each port) ─────────────────────
            const myPortLink = {};
            allLinks.forEach(lk => {
              if (lk.source_node === node.id && lk.source_port)
                myPortLink[lk.source_port] = lk.target_node_name;
              if (lk.target_node === node.id && lk.target_port)
                myPortLink[lk.target_port] = lk.source_node_name;
            });
            const tgtPortLink = {};
            if (target) allLinks.forEach(lk => {
              if (lk.source_node === target.id && lk.source_port)
                tgtPortLink[lk.source_port] = lk.target_node_name;
              if (lk.target_node === target.id && lk.target_port)
                tgtPortLink[lk.target_port] = lk.source_node_name;
            });

            // ── Dynamic fiber cores based on nodeCoreCount ───────────────────
            const activeCores = generateFiberCores(Math.min(Math.max(nodeCoreCount, 1), 144));
            // ── Used cores + which link uses each core ───────────────────────
            const usedCores = parseUsedCores(myLinks);
            const freeCores = activeCores.filter(c => !usedCores.has(c.name));

            // Same-cable: between same src+tgt pair, which cores are taken
            const sameCableLinks = target ? allLinks.filter(lk =>
              (lk.source_node === node.id && lk.target_node === target.id) ||
              (lk.source_node === target.id && lk.target_node === node.id)
            ) : [];
            const sameCableUsedCores = parseUsedCores(sameCableLinks);

            const coreMismatch = srcFiberCore && dstFiberCore && srcFiberCore !== dstFiberCore;
            const srcCoreConflict = srcFiberCore && sameCableUsedCores.has(srcFiberCore);
            const dstCoreConflict = dstFiberCore && sameCableUsedCores.has(dstFiberCore);

            // ── Chip components ──────────────────────────────────────────────
            // used=true → red, NON-clickable — shows who occupies it
            const PortChip = ({ label, active, used, peer, small, onSelect }) => (
              <button type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (used && !active) {
                    toast.error(`⛔ Port "${label}" is already connected to "${peer || '?'}". Cannot reuse.`, { duration: 4000 });
                    return;
                  }
                  onSelect();
                }}
                title={used && !active ? `Already connected to: ${peer || 'another node'}` : label}
                style={{
                  fontSize: small ? 8 : 9, padding: small ? '2px 5px' : '3px 8px',
                  borderRadius: 6, fontFamily: 'monospace', fontWeight: 600,
                  transition: 'all 0.12s', flexShrink: 0,
                  cursor: used && !active ? 'not-allowed' : 'pointer',
                  border: active ? '1px solid #0891b2'
                       : used   ? '1px solid #fca5a5'
                       :          '1px solid #e2e8f0',
                  background: active ? '#0891b2' : used ? '#fff1f2' : '#fff',
                  color:      active ? '#fff'    : used ? '#b91c1c' : '#475569',
                  opacity: used && !active ? 0.75 : 1,
                }}>
                {used && !active ? `${label} 🔒` : label}
              </button>
            );

            const CoreChip = ({ core, active, used, side, onClick }) => (
              <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }}
                title={used ? `Already used by another link` : core.name}
                style={{
                  width: 22, height: 22, borderRadius: 4,
                  border: active ? '2px solid #0f172a' : `2px solid ${core.border || core.hex}`,
                  background: core.hex,
                  cursor: 'pointer', position: 'relative', flexShrink: 0,
                  opacity: used && !active ? 0.4 : 1,
                  boxShadow: active ? '0 0 0 2px #fff, 0 0 0 4px #0891b2' : 'none',
                  transition: 'all 0.12s',
                }}>
                {used && !active && (
                  <span style={{ position: 'absolute', top: -1, right: -1, fontSize: 9,
                      background: '#ef4444', color: '#fff', borderRadius: '50%',
                      width: 9, height: 9, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontWeight: 700 }}>×</span>
                )}
              </button>
            );

            return (
              <div style={{ background: '#f0f9ff', borderRadius: 10, padding: '12px 12px',
                  marginBottom: 8, border: '1.5px solid #bae6fd',
                  boxShadow: '0 2px 8px rgba(14,116,144,0.08)' }}>

                {/* ── Header ── */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: '#0369a1', fontWeight: 800,
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                      display: 'flex', alignItems: 'center', gap: 5 }}>
                    🔌 Port & Fiber Core
                  </div>
                  {linkType === 'FIBER' && (
                    <div style={{ fontSize: 10, fontWeight: 700,
                        color: freeCores.length > 0 ? '#16a34a' : '#ef4444',
                        background: freeCores.length > 0 ? '#dcfce7' : '#fee2e2',
                        borderRadius: 5, padding: '2px 8px',
                        border: `1px solid ${freeCores.length > 0 ? '#86efac' : '#fca5a5'}` }}>
                      {freeCores.length}/{nodeCoreCount} cores free
                    </div>
                  )}
                </div>

                {/* ── Fiber cable core count selector ── */}
                {linkType === 'FIBER' && (
                  <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:10,
                      flexWrap:'wrap' }}>
                    <span style={{ fontSize:10, color:'#475569', fontWeight:700, whiteSpace:'nowrap' }}>Cable:</span>
                    {[2, 4, 6, 8, 12, 24, 48, 96].map(n => (
                      <button key={n} type="button"
                        onClick={e => { e.stopPropagation(); setNodeCoreCount(n); setSrcFiberCore(''); setDstFiberCore(''); }}
                        style={{ padding:'3px 8px', fontSize:10, fontWeight:700, borderRadius:5,
                          cursor:'pointer', flexShrink:0,
                          border: nodeCoreCount === n ? '2px solid #0891b2' : '1.5px solid #cbd5e1',
                          background: nodeCoreCount === n ? '#0891b2' : '#fff',
                          color: nodeCoreCount === n ? '#fff' : '#64748b',
                          boxShadow: nodeCoreCount === n ? '0 2px 5px rgba(8,145,178,0.3)' : 'none' }}>
                        {n}C
                      </button>
                    ))}
                    <input type="number" min={1} max={144} value={nodeCoreCount}
                      onChange={e => { e.stopPropagation(); setNodeCoreCount(Math.min(144, Math.max(1, parseInt(e.target.value) || 1))); setSrcFiberCore(''); setDstFiberCore(''); }}
                      onClick={e => e.stopPropagation()}
                      style={{ width:44, padding:'3px 5px', fontSize:10, border:'1.5px solid #cbd5e1',
                        borderRadius:5, outline:'none', background:'#fff', textAlign:'center', fontWeight:600 }} />
                  </div>
                )}

                {/* ── Source node ports ── */}
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: '#475569', marginBottom: 5, fontWeight: 700 }}>
                    📍 {node.name}
                    {myIsSplitter && node.splitter_ratio && ` (${node.splitter_ratio})`}
                  </div>
                  <div style={{ maxHeight: 110, overflowY: 'auto', display: 'flex',
                      flexWrap: 'wrap', gap: 5, padding: 2 }}>
                    {myIsSplitter ? (
                      <>
                        <PortChip label="📥 In" active={srcPort === 'In'}
                          used={myUsedPorts.has('In')} peer={myPortLink['In']}
                          onSelect={() => setSrcPort(srcPort === 'In' ? '' : 'In')} />
                        {myPorts.out.map(p => (
                          <PortChip key={p} label={p} small active={srcPort === p}
                            used={myUsedPorts.has(p)} peer={myPortLink[p]}
                            onSelect={() => setSrcPort(srcPort === p ? '' : p)} />
                        ))}
                      </>
                    ) : myDevicePorts ? (
                      <>
                        {myDevicePorts.uplinks.map(p => (
                          <PortChip key={p} label={`🔼 ${p}`} active={srcPort === p}
                            used={myUsedPorts.has(p)} peer={myPortLink[p]}
                            onSelect={() => setSrcPort(srcPort === p ? '' : p)} />
                        ))}
                        {myDevicePorts.downlinks.map(p => (
                          <PortChip key={p} label={p} small active={srcPort === p}
                            used={myUsedPorts.has(p)} peer={myPortLink[p]}
                            onSelect={() => setSrcPort(srcPort === p ? '' : p)} />
                        ))}
                      </>
                    ) : (
                      <input placeholder="Port (optional)" value={srcPort}
                        onChange={e => { e.stopPropagation(); setSrcPort(e.target.value); }}
                        onClick={e => e.stopPropagation()}
                        style={{ ...inp, fontSize: 10, padding: '4px 8px' }} />
                    )}
                  </div>
                </div>

                {/* ── Target node ports (only when target is selected) ── */}
                {target && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: '#475569', marginBottom: 5, fontWeight: 700 }}>
                      📍 {target.name}
                      {targetIsSplitter && target.splitter_ratio && ` (${target.splitter_ratio})`}
                    </div>
                    <div style={{ maxHeight: 110, overflowY: 'auto', display: 'flex',
                        flexWrap: 'wrap', gap: 5, padding: 2 }}>
                      {targetIsSplitter ? (
                        <>
                          <PortChip label="📥 In" active={dstPort === 'In'}
                            used={tgtUsedPorts.has('In')} peer={tgtPortLink['In']}
                            onSelect={() => setDstPort(dstPort === 'In' ? '' : 'In')} />
                          {tgtPorts.out.map(p => (
                            <PortChip key={p} label={p} small active={dstPort === p}
                              used={tgtUsedPorts.has(p)} peer={tgtPortLink[p]}
                              onSelect={() => setDstPort(dstPort === p ? '' : p)} />
                          ))}
                        </>
                      ) : tgtDevicePorts ? (
                        <>
                          {tgtDevicePorts.uplinks.map(p => (
                            <PortChip key={p} label={`🔼 ${p}`} active={dstPort === p}
                              used={tgtUsedPorts.has(p)} peer={tgtPortLink[p]}
                              onSelect={() => setDstPort(dstPort === p ? '' : p)} />
                          ))}
                          {tgtDevicePorts.downlinks.map(p => (
                            <PortChip key={p} label={p} small active={dstPort === p}
                              used={tgtUsedPorts.has(p)} peer={tgtPortLink[p]}
                              onSelect={() => setDstPort(dstPort === p ? '' : p)} />
                          ))}
                        </>
                      ) : (
                        <input placeholder="Target port (optional)" value={dstPort}
                          onChange={e => { e.stopPropagation(); setDstPort(e.target.value); }}
                          onClick={e => e.stopPropagation()}
                          style={{ ...inp, fontSize: 10, padding: '4px 8px' }} />
                      )}
                    </div>
                  </div>
                )}

                {/* ── Fiber core color (only for FIBER type) ── */}
                {linkType === 'FIBER' && (
                  <>
                    <div style={{ height: 1, background: '#bae6fd', margin: '8px 0' }} />

                    {/* Override toggle header */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: '#0369a1', fontWeight: 700,
                          textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Fiber Core Selection
                      </div>
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); setCoreOverride(v => !v); }}
                        style={{
                          fontSize: 10, padding: '3px 10px', borderRadius: 6, fontWeight: 700,
                          border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                          background: coreOverride ? '#fef3c7' : '#f1f5f9',
                          color:      coreOverride ? '#92400e' : '#64748b',
                          boxShadow: coreOverride ? '0 1px 4px rgba(245,158,11,0.3)' : 'none',
                        }}>
                        {coreOverride ? '🔓 Override ON' : '🔒 Override OFF'}
                      </button>
                    </div>
                    {coreOverride && (
                      <div style={{ background: '#fef3c7', border: '1px solid #fbbf24',
                          borderRadius: 7, padding: '6px 10px', fontSize: 10,
                          color: '#92400e', fontWeight: 600, marginBottom: 8, lineHeight: 1.5 }}>
                        ⚠️ Override mode — used cores-ও select করা যাবে।
                      </div>
                    )}

                    {/* Source end core */}
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: '#0369a1', fontWeight: 700,
                          marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                        🔵 Source-end core
                        {srcFiberCore && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#fff',
                              background: '#0891b2', borderRadius: 4, padding: '1px 7px' }}>
                            → {srcFiberCore}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight:80, overflowY:'auto' }}>
                        {activeCores.map(c => {
                          const cableConflict = !coreOverride && sameCableUsedCores.has(c.name) && srcFiberCore !== c.name;
                          return (
                            <CoreChip key={c.name} core={c}
                              active={srcFiberCore === c.name}
                              used={cableConflict}
                              onClick={() => {
                                if (cableConflict) {
                                  toast.error(`⛔ Core "${c.name}" already used. Override mode চালু করুন।`, { duration: 3000 });
                                  return;
                                }
                                setSrcFiberCore(srcFiberCore === c.name ? '' : c.name);
                              }}
                            />
                          );
                        })}
                      </div>
                    </div>

                    {/* Destination end core */}
                    <div style={{ marginBottom: (coreMismatch || srcCoreConflict || dstCoreConflict) ? 8 : 0 }}>
                      <div style={{ fontSize: 11, color: '#0369a1', fontWeight: 700,
                          marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                        🟢 Destination-end core
                        {dstFiberCore && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#fff',
                              background: '#16a34a', borderRadius: 4, padding: '1px 7px' }}>
                            → {dstFiberCore}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight:80, overflowY:'auto' }}>
                        {activeCores.map(c => {
                          const cableConflict = !coreOverride && sameCableUsedCores.has(c.name) && dstFiberCore !== c.name;
                          return (
                            <CoreChip key={c.name} core={c}
                              active={dstFiberCore === c.name}
                              used={cableConflict}
                              onClick={() => {
                                if (cableConflict) {
                                  toast.error(`⛔ Core "${c.name}" already used. Override mode চালু করুন।`, { duration: 3000 });
                                  return;
                                }
                                setDstFiberCore(dstFiberCore === c.name ? '' : c.name);
                              }}
                            />
                          );
                        })}
                      </div>
                    </div>

                    {/* Warnings */}
                    {coreMismatch && (
                      <div style={{ background: '#fef3c7', border: '1px solid #fbbf24',
                          borderRadius: 7, padding: '7px 10px', fontSize: 10, color: '#92400e',
                          fontWeight: 600, marginTop: 8, lineHeight: 1.5 }}>
                        ⚠️ Core mismatch — Source: <strong>{srcFiberCore}</strong> ≠ Dest: <strong>{dstFiberCore}</strong>
                        <div style={{ fontWeight: 400, marginTop: 2, fontSize: 10 }}>
                          Same physical fiber strand-এর দুই প্রান্তে same core হওয়া উচিত।
                        </div>
                      </div>
                    )}

                    {/* Same-cable used cores summary */}
                    {sameCableUsedCores.size > 0 && (
                      <div style={{ marginTop: 6, fontSize: 10, color: '#dc2626',
                          background: '#fef2f2', borderRadius: 6, padding: '5px 9px',
                          fontWeight: 600, border: '1px solid #fca5a5' }}>
                        🔒 Used cores: {[...sameCableUsedCores].join(', ')}
                      </div>
                    )}
                    {usedCores.size > 0 && sameCableUsedCores.size === 0 && (
                      <div style={{ marginTop: 6, fontSize: 10, color: '#64748b',
                          background: '#f8fafc', borderRadius: 5, padding: '4px 8px' }}>
                        Node cores: {[...usedCores].join(', ')}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })()}

          {/* Link type + color */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, marginBottom: 10 }}>
            <select
              value={linkType}
              onChange={e => { e.stopPropagation(); handleTypeChange(e.target.value); }}
              style={inp}
            >
              <option value="FIBER">🔵 Fiber Optic</option>
              <option value="ETHERNET">🟢 Ethernet</option>
              <option value="WIRELESS">🟣 Wireless</option>
            </select>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5,
                border: '1px solid #e2e8f0', borderRadius: 8, padding: '4px 8px' }}>
              <input
                type="color"
                value={colorCode}
                onChange={e => { e.stopPropagation(); setColor(e.target.value); }}
                style={{ width: 24, height: 24, border: 'none', borderRadius: 4,
                  cursor: 'pointer', padding: 0, background: 'none' }}
              />
              <span style={{ fontSize: 9, color: '#64748b', fontFamily: 'monospace' }}>
                {colorCode}
              </span>
            </div>
          </div>

          {/* Create Link button */}
          <button
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleCreateLink(); }}
            disabled={connecting || !targetId}
            style={{
              width: '100%',
              background: !targetId ? '#e2e8f0' : connecting ? '#94a3b8' : '#0891b2',
              color: !targetId ? '#94a3b8' : '#fff',
              border: `1px solid ${!targetId ? '#e2e8f0' : 'transparent'}`,
              borderRadius: 8, padding: '10px 0', fontSize: 12, fontWeight: 600,
              cursor: connecting || !targetId ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {connecting ? '⏳ Connecting...'
              : !targetId ? 'Target node select করুন ↑'
              : `🔗 Create ${linkType} Link`}
          </button>
        </>
      )}
    </div>
  );
}

// ─── Splitter ratio options ───────────────────────────────────────────────────
const SPLITTER_TAP_RATIOS = ['1:99','2:98','3:97','4:94','5:95','10:90','15:85','20:80','25:75','30:70','35:65','40:60','45:55'];
const SPLITTER_PLC_RATIOS = ['1:2','1:4','1:8','1:16','1:32','1:64'];

// ─── Shared node form fields ──────────────────────────────────────────────────
// IP field:     ROUTER/OLT → required | CLIENT → optional | SPLITTER/BOX → hidden
// Ratio field:  SPLITTER → shows splitter_ratio dropdown
function NodeFormFields({ form, setField }) {
  const ipRequired  = ['ROUTER', 'OLT'].includes(form.node_type);
  const showIp      = ['ROUTER', 'OLT', 'CLIENT'].includes(form.node_type);
  const isSplitter  = form.node_type === 'SPLITTER';
  return (
    <div className="space-y-3">
      <input
        className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#173d59]"
        placeholder="Node Name *"
        value={form.name}
        onChange={e => setField('name', e.target.value)}
        autoFocus
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <select
          className="border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#173d59]"
          value={form.node_type}
          onChange={e => setField('node_type', e.target.value)}
        >
          {Object.entries(NODE_STYLE).filter(([k]) => k !== 'SPLITTER').map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select
          className="border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#173d59]"
          value={form.status}
          onChange={e => setField('status', e.target.value)}
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="maintenance">Maintenance</option>
          <option value="unknown">Unknown</option>
        </select>
      </div>

      {/* Splitter ratio — SPLITTER type-এ inline chip selector */}
      {isSplitter && (
        <div className="border border-cyan-200 rounded-xl p-3 bg-cyan-50/30">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-cyan-600 font-semibold uppercase tracking-wider">
              Splitter Ratio
              {form.splitter_ratio && (
                <span className="ml-2 bg-cyan-500 text-white rounded px-1.5 py-0.5 font-bold">
                  {form.splitter_ratio}
                </span>
              )}
            </span>
            {form.splitter_ratio && (
              <button type="button" onClick={() => setField('splitter_ratio', '')}
                className="text-[10px] text-gray-400 hover:text-rose-500 transition-colors">
                × Clear
              </button>
            )}
          </div>

          <div className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide mb-1.5">
            Tap Splitter (Asymmetric)
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {SPLITTER_TAP_RATIOS.map(r => (
              <button key={r} type="button"
                onClick={() => setField('splitter_ratio', r)}
                className={`text-xs px-2 py-0.5 rounded-lg border font-mono transition-all ${
                  form.splitter_ratio === r
                    ? 'bg-cyan-500 text-white border-cyan-500 font-bold'
                    : 'text-gray-600 border-gray-200 hover:border-cyan-400 hover:bg-cyan-50 bg-white'
                }`}
              >{r}</button>
            ))}
          </div>

          <div className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide mb-1.5">
            PLC Splitter (Symmetric)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SPLITTER_PLC_RATIOS.map(r => (
              <button key={r} type="button"
                onClick={() => setField('splitter_ratio', r)}
                className={`text-xs px-2 py-0.5 rounded-lg border font-mono transition-all ${
                  form.splitter_ratio === r
                    ? 'bg-cyan-500 text-white border-cyan-500 font-bold'
                    : 'text-gray-600 border-gray-200 hover:border-cyan-400 hover:bg-cyan-50 bg-white'
                }`}
              >{r}</button>
            ))}
          </div>
        </div>
      )}

      {/* IP address — ROUTER/OLT required, CLIENT optional */}
      {showIp && (
        <div className="relative">
          <input
            className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none transition-colors ${
              ipRequired
                ? 'border-blue-300 focus:border-[#173d59] bg-blue-50/30'
                : 'border-gray-300 focus:border-[#173d59]'
            }`}
            placeholder={ipRequired ? 'IP Address * (required)' : 'IP Address (optional)'}
            value={form.ip_address}
            onChange={e => setField('ip_address', e.target.value)}
          />
          {ipRequired && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-blue-400 font-semibold uppercase tracking-wide">
              Required
            </span>
          )}
        </div>
      )}

      {/* Port configuration — OLT/ROUTER/BOX-এর জন্য */}
      {['OLT', 'ROUTER', 'BOX'].includes(form.node_type) && (
        <div className="border border-gray-200 rounded-xl p-3 bg-gray-50/60">
          <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-2">
            Port Configuration
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-gray-500 mb-1 block">
                {form.node_type === 'OLT' ? 'PON Ports' : 'Output Ports'}
              </label>
              <input type="number" min="1" max="128"
                className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:border-[#173d59]"
                placeholder={form.node_type === 'OLT' ? '8' : '4'}
                value={form.port_count ?? ''}
                onChange={e => setField('port_count', e.target.value ? parseInt(e.target.value) : null)}
              />
            </div>
            {form.node_type !== 'BOX' && (
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">
                  {form.node_type === 'OLT' ? 'UP-Link Ports' : 'WAN Ports'}
                </label>
                <input type="number" min="0" max="8"
                  className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:border-[#173d59]"
                  placeholder="2"
                  value={form.uplink_count ?? ''}
                  onChange={e => setField('uplink_count', e.target.value ? parseInt(e.target.value) : null)}
                />
              </div>
            )}
          </div>
        </div>
      )}

      <textarea
        className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#173d59] resize-none"
        rows={2}
        placeholder="Description (optional)"
        value={form.description}
        onChange={e => setField('description', e.target.value)}
      />
    </div>
  );
}

// ─── AddNodeModal ─────────────────────────────────────────────────────────────
function AddNodeModal({ latlng, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: '', node_type: 'ROUTER', ip_address: '',
    splitter_ratio: '', port_count: null, uplink_count: null,
    status: 'active', description: '',
    latitude: latlng.lat.toFixed(7),
    longitude: latlng.lng.toFixed(7),
  });
  const [saving, setSaving] = useState(false);
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Node name is required.');
    if (['ROUTER', 'OLT'].includes(form.node_type) && !form.ip_address.trim()) {
      return toast.error('IP address is required for Router and OLT nodes.');
    }
    setSaving(true);
    try {
      const payload = { ...form, ip_address: form.ip_address.trim() || null };
      const res = await api.post('/network/nodes/', payload);
      toast.success('Node added to map.');
      onSaved(res.data);
    } catch {
      toast.error('Failed to save node.');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-end md:items-center justify-center bg-black/60 p-0 md:p-4">
      <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="text-base font-bold text-[#173d59] mb-1">Add Network Node</h3>
        <p className="text-xs text-gray-400 mb-4">
          Lat: {form.latitude} &nbsp;|&nbsp; Lng: {form.longitude}
        </p>
        <NodeFormFields form={form} setField={setField} />
        <div className="flex gap-3 mt-5">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 bg-[#173d59] hover:bg-[#1f5075] text-white rounded-full py-3 text-sm font-semibold transition-all disabled:opacity-60 min-h-[44px] touch-manipulation">
            {saving ? 'Saving...' : 'Save Node'}
          </button>
          <button onClick={onClose}
            className="flex-1 sm:flex-none px-5 py-3 text-sm text-gray-600 border border-gray-300 rounded-full hover:bg-gray-50 transition-all min-h-[44px] touch-manipulation">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── EditNodeModal ─────────────────────────────────────────────────────────────
// কেন আলাদা modal: AddNodeModal-এ lat/lng auto-fill, EditNodeModal-এ existing
// ডেটা pre-fill এবং PATCH endpoint ব্যবহার করে।
// Delete দুই-ধাপে — প্রথম click-এ confirm button দেখায়, দ্বিতীয়তে DELETE request।
function EditNodeModal({ node, onClose, onUpdated, onDeleted }) {
  const [form, setForm] = useState({
    name:           node.name,
    node_type:      node.node_type,
    ip_address:     node.ip_address     || '',
    splitter_ratio: node.splitter_ratio  || '',
    port_count:     node.port_count     ?? null,
    uplink_count:   node.uplink_count   ?? null,
    status:         node.status,
    description:    node.description    || '',
    latitude:       node.latitude,
    longitude:      node.longitude,
  });
  const [saving,  setSaving]  = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // PATCH — existing node update
  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Node name is required.');
    if (['ROUTER', 'OLT'].includes(form.node_type) && !form.ip_address?.trim()) {
      return toast.error('IP address is required for Router and OLT nodes.');
    }
    setSaving(true);
    try {
      const payload = { ...form, ip_address: form.ip_address?.trim() || null };
      const res = await api.patch(`/network/nodes/${node.id}/`, payload);
      toast.success('Node updated successfully.');
      onUpdated(res.data);
    } catch {
      toast.error('Failed to update node.');
    } finally { setSaving(false); }
  };

  // DELETE — দুই-ধাপ confirm
  const handleDelete = async () => {
    if (!confirmDel) { setConfirmDel(true); return; }
    setDeleting(true);
    try {
      await api.delete(`/network/nodes/${node.id}/`);
      toast.success(`Node "${node.name}" deleted.`);
      onDeleted(node.id);
    } catch {
      toast.error('Failed to delete node.');
    } finally { setDeleting(false); }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-end md:items-center justify-center bg-black/60 p-0 md:p-4">
      <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-[#173d59]">Edit Node</h3>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-lg font-mono">
            #{node.id}
          </span>
        </div>
        <NodeFormFields form={form} setField={setField} />
        {/* Coordinates — editable যাতে ভুল জায়গায় বসানো node সঠিক অবস্থানে সরানো যায় */}
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1 block">
              Latitude
            </label>
            <input
              type="number"
              step="0.0000001"
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-[#173d59]"
              placeholder="23.8103000"
              value={form.latitude}
              onChange={e => setField('latitude', e.target.value)}
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1 block">
              Longitude
            </label>
            <input
              type="number"
              step="0.0000001"
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-[#173d59]"
              placeholder="90.4125000"
              value={form.longitude}
              onChange={e => setField('longitude', e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-5">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 bg-[#173d59] hover:bg-[#1f5075] text-white rounded-full py-3 text-sm font-semibold transition-all disabled:opacity-60 min-h-[44px] touch-manipulation">
            {saving ? 'Saving...' : 'Update Node'}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className={`flex-1 sm:flex-none px-4 py-3 text-sm font-semibold rounded-full border transition-all disabled:opacity-60 min-h-[44px] touch-manipulation ${
              confirmDel
                ? 'bg-rose-600 text-white border-rose-600 hover:bg-rose-700'
                : 'text-rose-500 border-rose-200 bg-rose-50 hover:bg-rose-100'
            }`}
          >
            {deleting ? 'Deleting...' : confirmDel ? 'Confirm Delete' : 'Delete'}
          </button>
          <button onClick={() => { setConfirmDel(false); onClose(); }}
            className="flex-1 sm:flex-none px-4 py-3 text-sm text-gray-600 border border-gray-300 rounded-full hover:bg-gray-50 transition-all min-h-[44px] touch-manipulation">
            Cancel
          </button>
        </div>
        {confirmDel && (
          <p className="mt-2 text-xs text-rose-500 text-center">
            Click "Confirm Delete" again to permanently remove this node.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── AddLinkModal ─────────────────────────────────────────────────────────────
const FIBER_CORE_COLORS = [
  'Blue', 'Orange', 'Green', 'Brown', 'Slate', 'White',
  'Red', 'Black', 'Yellow', 'Violet', 'Rose', 'Aqua',
];

function AddLinkModal({ sourceNode, targetNode, paths, onClose, onSaved }) {
  const [form, setForm] = useState({
    source_node: sourceNode.id,
    target_node: targetNode.id,
    link_type:        'FIBER',
    source_port:      '',
    target_port:      '',
    fiber_company:    '',
    cable_code:       '',
    fiber_core_count: '',
    fiber_used_cores: '',
    fiber_core_color: '',
    fiber_core_details: '',
    color_code: '#00bcd4',
    distance:   '',
    status:     'active',
    paths,
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isFiber = form.link_type === 'FIBER';

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        distance:         form.distance ? parseFloat(form.distance) : null,
        fiber_core_count: form.fiber_core_count ? parseInt(form.fiber_core_count) : null,
      };
      const res = await api.post('/network/links/', payload);
      toast.success('Link saved successfully.');
      onSaved(res.data);
    } catch {
      toast.error('Failed to save link.');
    } finally { setSaving(false); }
  };

  const inp = 'w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#173d59]';
  const sec = 'text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-2 mt-4';

  return (
    <div className="fixed inset-0 z-[9999] flex items-end md:items-center justify-center bg-black/60 p-0 md:p-4">
      <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="text-base font-bold text-[#173d59] mb-1">Add Cable Link</h3>
        <p className="text-xs text-gray-400 mb-4">
          <span className="font-semibold text-gray-600">{sourceNode.name}</span>
          {' → '}
          <span className="font-semibold text-gray-600">{targetNode.name}</span>
          <span className="mx-2 text-gray-300">|</span>
          <span>{paths.length} waypoints</span>
        </p>

        {/* ── Basic ─────────────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select className={inp} value={form.link_type} onChange={e => set('link_type', e.target.value)}>
              <option value="FIBER">🔵 Fiber Optic</option>
              <option value="ETHERNET">🟢 Ethernet</option>
              <option value="WIRELESS">🟣 Wireless</option>
            </select>
            <select className={inp} value={form.status} onChange={e => set('status', e.target.value)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="maintenance">Maintenance</option>
            </select>
          </div>

          {/* ── Port info ───────────────────────────────────────────────────── */}
          <div className={sec}>Port / Interface</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input className={inp} placeholder={`${sourceNode.name} port (e.g. GE-0/0/1)`}
              value={form.source_port} onChange={e => set('source_port', e.target.value)} />
            <input className={inp} placeholder={`${targetNode.name} port (e.g. PON-1)`}
              value={form.target_port} onChange={e => set('target_port', e.target.value)} />
          </div>

          {/* ── Fiber details (only for FIBER type) ─────────────────────────── */}
          {isFiber && (
            <>
              <div className={sec}>Fiber Cable Details</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input className={inp} placeholder="Cable Company (e.g. Summit, BDCOM)"
                  value={form.fiber_company} onChange={e => set('fiber_company', e.target.value)} />
                <input className={inp} placeholder="Cable Code / Batch No."
                  value={form.cable_code} onChange={e => set('cable_code', e.target.value)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input className={inp} placeholder="Total Core Count (e.g. 12)" type="number" min="1"
                  value={form.fiber_core_count} onChange={e => set('fiber_core_count', e.target.value)} />
                <input className={inp} placeholder="Used Cores (e.g. 1-2, 3-4)"
                  value={form.fiber_used_cores} onChange={e => set('fiber_used_cores', e.target.value)} />
              </div>

              {/* Core color quick-select chips */}
              <div>
                <div className="text-[10px] text-gray-400 mb-1.5">Core Colors <span className="text-gray-300">(click to add)</span></div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {FIBER_CORE_COLORS.map(c => (
                    <button key={c} type="button"
                      onClick={() => set('fiber_core_color',
                        form.fiber_core_color
                          ? form.fiber_core_color.includes(c) ? form.fiber_core_color : `${form.fiber_core_color}, ${c}`
                          : c
                      )}
                      className={`text-[10px] px-2 py-0.5 rounded-full border transition-all ${
                        form.fiber_core_color.includes(c)
                          ? 'bg-[#173d59] text-white border-[#173d59]'
                          : 'text-gray-500 border-gray-200 hover:border-[#173d59]'
                      }`}
                    >{c}</button>
                  ))}
                </div>
                <input className={inp} placeholder="Core colors (editable)"
                  value={form.fiber_core_color} onChange={e => set('fiber_core_color', e.target.value)} />
              </div>

              <input className={inp} placeholder="Additional notes (optional)"
                value={form.fiber_core_details} onChange={e => set('fiber_core_details', e.target.value)} />
            </>
          )}

          {/* ── Map & status ────────────────────────────────────────────────── */}
          <div className={sec}>Cable & Map</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">Map Line Color</label>
              <div className="flex items-center gap-2 border border-gray-300 rounded-xl px-3 py-2">
                <input type="color" className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent p-0"
                  value={form.color_code} onChange={e => set('color_code', e.target.value)} />
                <span className="text-xs text-gray-500 font-mono">{form.color_code}</span>
              </div>
            </div>
            <input className={inp} placeholder="Distance (meters)" type="number" min="0"
              value={form.distance} onChange={e => set('distance', e.target.value)} />
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 bg-[#173d59] hover:bg-[#1f5075] text-white rounded-full py-3 text-sm font-semibold transition-all disabled:opacity-60 min-h-[44px] touch-manipulation">
            {saving ? 'Saving...' : 'Save Link'}
          </button>
          <button onClick={onClose}
            className="flex-1 sm:flex-none px-5 py-3 text-sm text-gray-600 border border-gray-300 rounded-full hover:bg-gray-50 transition-all min-h-[44px] touch-manipulation">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── EditLinkModal ────────────────────────────────────────────────────────────
// AddLinkModal-এর মতোই, কিন্তু existing link-এর data pre-fill করে PATCH করে।
function EditLinkModal({ link, onClose, onUpdated, onDeleted }) {
  const [form, setForm] = useState({
    link_type:        link.link_type,
    source_port:      link.source_port      || '',
    target_port:      link.target_port      || '',
    fiber_company:    link.fiber_company    || '',
    cable_code:       link.cable_code       || '',
    fiber_core_count: link.fiber_core_count ?? '',
    fiber_used_cores: link.fiber_used_cores || '',
    fiber_core_color: link.fiber_core_color || '',
    fiber_core_details: link.fiber_core_details || '',
    color_code: link.color_code || '#00bcd4',
    distance:   link.distance   ?? '',
    status:     link.status,
  });
  const [saving,      setSaving]      = useState(false);
  const [deleting,    setDeleting]    = useState(false);
  const [confirmDel,  setConfirmDel]  = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isFiber = form.link_type === 'FIBER';

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        distance:         form.distance         ? parseFloat(form.distance)         : null,
        fiber_core_count: form.fiber_core_count ? parseInt(form.fiber_core_count)   : null,
      };
      const res = await api.patch(`/network/links/${link.id}/`, payload);
      toast.success('Link updated.');
      onUpdated(res.data);
    } catch {
      toast.error('Failed to update link.');
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!confirmDel) { setConfirmDel(true); return; }
    setDeleting(true);
    try {
      await api.delete(`/network/links/${link.id}/`);
      toast.success('Link deleted.');
      onDeleted(link.id);
    } catch {
      toast.error('Failed to delete link.');
    } finally { setDeleting(false); }
  };

  const inp = 'w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#173d59]';
  const sec = 'text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-2 mt-4';

  return (
    <div className="fixed inset-0 z-[9999] flex items-end md:items-center justify-center bg-black/60 p-0 md:p-4">
      <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-bold text-[#173d59]">Edit Link</h3>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-lg font-mono">#{link.id}</span>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          <span className="font-semibold text-gray-600">{link.source_node_name}</span>
          {' → '}
          <span className="font-semibold text-gray-600">{link.target_node_name}</span>
        </p>

        <div className="space-y-3">
          {/* Basic */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select className={inp} value={form.link_type} onChange={e => set('link_type', e.target.value)}>
              <option value="FIBER">🔵 Fiber Optic</option>
              <option value="ETHERNET">🟢 Ethernet</option>
              <option value="WIRELESS">🟣 Wireless</option>
            </select>
            <select className={inp} value={form.status} onChange={e => set('status', e.target.value)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="maintenance">Maintenance</option>
            </select>
          </div>

          {/* Ports */}
          <div className={sec}>Port / Interface</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input className={inp} placeholder={`${link.source_node_name} port`}
              value={form.source_port} onChange={e => set('source_port', e.target.value)} />
            <input className={inp} placeholder={`${link.target_node_name} port`}
              value={form.target_port} onChange={e => set('target_port', e.target.value)} />
          </div>

          {/* Fiber details */}
          {isFiber && (
            <>
              <div className={sec}>Fiber Cable Details</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input className={inp} placeholder="Cable Company (e.g. Summit)"
                  value={form.fiber_company} onChange={e => set('fiber_company', e.target.value)} />
                <input className={inp} placeholder="Cable Code / Batch No."
                  value={form.cable_code} onChange={e => set('cable_code', e.target.value)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input className={inp} placeholder="Total Core Count" type="number" min="1"
                  value={form.fiber_core_count} onChange={e => set('fiber_core_count', e.target.value)} />
                <input className={inp} placeholder="Used Cores (e.g. 1-2, 3-4)"
                  value={form.fiber_used_cores} onChange={e => set('fiber_used_cores', e.target.value)} />
              </div>
              <div>
                <div className="text-[10px] text-gray-400 mb-1.5">Core Colors <span className="text-gray-300">(click to add)</span></div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {FIBER_CORE_COLORS.map(c => (
                    <button key={c} type="button"
                      onClick={() => set('fiber_core_color',
                        form.fiber_core_color
                          ? form.fiber_core_color.includes(c) ? form.fiber_core_color : `${form.fiber_core_color}, ${c}`
                          : c
                      )}
                      className={`text-[10px] px-2 py-0.5 rounded-full border transition-all ${
                        form.fiber_core_color.includes(c)
                          ? 'bg-[#173d59] text-white border-[#173d59]'
                          : 'text-gray-500 border-gray-200 hover:border-[#173d59]'
                      }`}
                    >{c}</button>
                  ))}
                </div>
                <input className={inp} placeholder="Core colors (editable)"
                  value={form.fiber_core_color} onChange={e => set('fiber_core_color', e.target.value)} />
              </div>
              <input className={inp} placeholder="Additional notes (optional)"
                value={form.fiber_core_details} onChange={e => set('fiber_core_details', e.target.value)} />
            </>
          )}

          {/* Map line */}
          <div className={sec}>Cable & Map</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">Map Line Color</label>
              <div className="flex items-center gap-2 border border-gray-300 rounded-xl px-3 py-2">
                <input type="color" className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent p-0"
                  value={form.color_code} onChange={e => set('color_code', e.target.value)} />
                <span className="text-xs text-gray-500 font-mono">{form.color_code}</span>
              </div>
            </div>
            <input className={inp} placeholder="Distance (meters)" type="number" min="0"
              value={form.distance} onChange={e => set('distance', e.target.value)} />
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 mt-5">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 bg-[#173d59] hover:bg-[#1f5075] text-white rounded-full py-3 text-sm font-semibold transition-all disabled:opacity-60 min-h-[44px] touch-manipulation">
            {saving ? 'Saving...' : 'Update Link'}
          </button>
          <button onClick={handleDelete} disabled={deleting}
            className={`flex-1 sm:flex-none px-4 py-3 text-sm font-semibold rounded-full border transition-all disabled:opacity-60 min-h-[44px] touch-manipulation ${
              confirmDel ? 'bg-rose-600 text-white border-rose-600' : 'text-rose-500 border-rose-200 bg-rose-50 hover:bg-rose-100'
            }`}>
            {deleting ? 'Deleting...' : confirmDel ? 'Confirm' : 'Delete'}
          </button>
          <button onClick={() => { setConfirmDel(false); onClose(); }}
            className="flex-1 sm:flex-none px-4 py-3 text-sm text-gray-600 border border-gray-300 rounded-full hover:bg-gray-50 transition-all min-h-[44px] touch-manipulation">
            Cancel
          </button>
        </div>
        {confirmDel && (
          <p className="mt-2 text-xs text-rose-500 text-center">
            এই link স্থায়ীভাবে মুছে ফেলা হবে। আবার Confirm ক্লিক করুন।
          </p>
        )}
      </div>
    </div>
  );
}

// ─── FiberCablePopup ─────────────────────────────────────────────────────────
// প্রতিটি লিংক = আলাদা স্বতন্ত্র fiber cable।
// দুই প্রান্তের node, port, IP সহ বিস্তারিত দেখায়।
function FiberCablePopup({ link, allLinks = [], allNodes = [], onEdit, onEditPath, onDeleted, onLinkAdded, onLinkUpdated, onNodeAdded }) {
  const [deleting,    setDeleting]    = useState(false);
  const [confirmDel,  setConfirmDel]  = useState(false);

  // Same cable_code-এর অন্য connections (co-cables)
  const coCables = link.cable_code
    ? allLinks.filter(l => l.id !== link.id && l.cable_code === link.cable_code)
    : [];

  const typeColor = { FIBER: '#0369a1', ETHERNET: '#16a34a', WIRELESS: '#7c3aed' }[link.link_type] || '#64748b';
  const typeBg    = { FIBER: '#e0f2fe', ETHERNET: '#dcfce7', WIRELESS: '#ede9fe' }[link.link_type] || '#f1f5f9';
  const isFiber   = link.link_type === 'FIBER';
  const srcStyle  = NODE_STYLE[link.source_node_type] || { bg: '#374151' };
  const tgtStyle  = NODE_STYLE[link.target_node_type] || { bg: '#374151' };

  const handleDelete = async () => {
    if (!confirmDel) { setConfirmDel(true); return; }
    setDeleting(true);
    try {
      await api.delete(`/network/links/${link.id}/`);
      toast.success('Cable deleted.');
      onDeleted(link.id);
    } catch {
      toast.error('Failed to delete.');
    } finally { setDeleting(false); }
  };

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', width: 300 }}>

      {/* ── Cable header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8,
          paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ width: 12, height: 12, borderRadius: '50%', marginTop: 3, flexShrink: 0,
            background: link.color_code || '#00bcd4',
            boxShadow: `0 0 0 3px ${link.color_code || '#00bcd4'}33` }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: '#0f172a', lineHeight: 1.4 }}>
            {link.source_node_name} → {link.target_node_name}
          </div>
          <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>
            {NODE_STYLE[link.source_node_type]?.label || link.source_node_type}
            {' → '}
            {NODE_STYLE[link.target_node_type]?.label || link.target_node_type}
          </div>
          {(link.fiber_company || link.cable_code) && (
            <div style={{ fontSize: 9, color: '#64748b', marginTop: 1 }}>
              {[link.fiber_company, link.cable_code].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
          <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 5, fontWeight: 700,
              background: typeBg, color: typeColor }}>
            {link.link_type_display || link.link_type}
          </span>
          {link.fiber_core_count && (
            <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 5, fontWeight: 700,
                background: '#f0fdf4', color: '#16a34a', whiteSpace: 'nowrap' }}>
              {link.fiber_core_count}C cable
            </span>
          )}
          <span style={{ fontSize: 9, color: STATUS_COLOR[link.status] || '#6b7280',
              fontWeight: 600, padding: '2px 5px', background: '#f8fafc',
              borderRadius: 5, whiteSpace: 'nowrap' }}>
            ● {link.status_display || link.status}
          </span>
        </div>
      </div>

      {/* ── Fiber core visualization ── */}
      {isFiber && link.fiber_core_count && (
        <div style={{ marginBottom: 8, background: '#f8fafc', borderRadius: 8, padding: '7px 10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: 5 }}>
            <div style={{ fontSize: 9, color: '#64748b', fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: 1 }}>
              Fiber Cores ({link.fiber_core_count} total)
            </div>
            {link.fiber_core_color && (
              <span style={{ fontSize: 9, color: '#475569', fontFamily: 'monospace',
                  background: '#f1f5f9', borderRadius: 4, padding: '1px 5px' }}>
                {link.fiber_core_color}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {generateFiberCores(Math.min(link.fiber_core_count, 144)).map(c => {
              const isUsed = link.fiber_core_color &&
                link.fiber_core_color.toLowerCase().includes(c.name.toLowerCase());
              return (
                <div key={c.name} title={isUsed ? `Used: ${c.name}` : `Free: ${c.name}`}
                  style={{ width: 16, height: 16, borderRadius: 3, position: 'relative',
                    background: isUsed ? c.hex : '#e2e8f0',
                    border: `1.5px solid ${isUsed ? (c.border || c.hex) : '#cbd5e1'}`,
                    opacity: isUsed ? 1 : 0.4 }}>
                  {isUsed && (
                    <div style={{ position: 'absolute', top: -2, right: -2,
                        width: 6, height: 6, borderRadius: '50%',
                        background: '#10b981', border: '1px solid #fff' }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── দুই প্রান্তের বিস্তারিত — Source ──→── Target ── */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 6,
          background: '#f0f9ff', borderRadius: 7, padding: '7px 9px',
          border: '1px solid #bae6fd', marginBottom: 8 }}>

        {/* Source side */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
            <div style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                background: srcStyle.bg,
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              dangerouslySetInnerHTML={{ __html: getNodeSvg(link.source_node_type, 11, 11) }}
            />
            <span style={{ fontSize: 10, fontWeight: 700, color: '#0f172a',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                flex: 1, minWidth: 0 }}>
              {link.source_node_name}
            </span>
          </div>
          <div style={{ paddingLeft: 23, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {link.source_port && (
              <code style={{ fontSize: 9, color: '#0369a1', background: '#dbeafe',
                  borderRadius: 3, padding: '1px 5px', display: 'inline-block', fontWeight: 700 }}>
                📌 {link.source_port}
              </code>
            )}
            {link.source_node_ip && (
              <span style={{ fontSize: 8, color: '#64748b', fontFamily: 'monospace' }}>
                {link.source_node_ip}
              </span>
            )}
          </div>
        </div>

        {/* Arrow */}
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
            <line x1="1" y1="7" x2="13" y2="7" stroke="#0891b2" strokeWidth="1.5"/>
            <polyline points="9,3 13,7 9,11" stroke="#0891b2" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
        </div>

        {/* Target side */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
            <div style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                background: tgtStyle.bg,
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              dangerouslySetInnerHTML={{ __html: getNodeSvg(link.target_node_type, 11, 11) }}
            />
            <span style={{ fontSize: 10, fontWeight: 700, color: '#0f172a',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                flex: 1, minWidth: 0 }}>
              {link.target_node_name}
            </span>
          </div>
          <div style={{ paddingLeft: 23, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {link.target_port && (
              <code style={{ fontSize: 9, color: '#0369a1', background: '#dbeafe',
                  borderRadius: 3, padding: '1px 5px', display: 'inline-block', fontWeight: 700 }}>
                📌 {link.target_port}
              </code>
            )}
            {link.target_node_ip && (
              <span style={{ fontSize: 8, color: '#64748b', fontFamily: 'monospace' }}>
                {link.target_node_ip}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Extra fiber notes ── */}
      {isFiber && (link.fiber_used_cores || link.fiber_core_details) && (
        <div style={{ marginBottom: 8, fontSize: 9, color: '#64748b', lineHeight: 1.7 }}>
          {link.fiber_used_cores && <div><span style={{ color: '#94a3b8' }}>Used cores: </span>{link.fiber_used_cores}</div>}
          {link.fiber_core_details && <div>{link.fiber_core_details}</div>}
        </div>
      )}

      {/* ── Distance ── */}
      {link.distance && (
        <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 8 }}>{link.distance}m</div>
      )}

      {/* ── Action buttons ── */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={onEdit}
          style={{ flex: 1, background: '#173d59', color: '#fff', border: 'none',
            borderRadius: 8, padding: '8px 0', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
          onMouseEnter={e => e.currentTarget.style.background = '#1f5075'}
          onMouseLeave={e => e.currentTarget.style.background = '#173d59'}
        >✏️ Edit Details</button>
        <button onClick={onEditPath}
          style={{ flex: 1, background: '#0891b2', color: '#fff', border: 'none',
            borderRadius: 8, padding: '8px 0', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
          onMouseEnter={e => e.currentTarget.style.background = '#0e7490'}
          onMouseLeave={e => e.currentTarget.style.background = '#0891b2'}
        >🖱️ Edit Path</button>
        <button onClick={handleDelete} disabled={deleting}
          style={{ background: confirmDel ? '#dc2626' : '#fff1f2',
            color: confirmDel ? '#fff' : '#e11d48',
            border: `1px solid ${confirmDel ? '#dc2626' : '#fecdd3'}`,
            borderRadius: 8, padding: '8px 10px', fontSize: 11, fontWeight: 600,
            cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1 }}
        >{deleting ? '…' : confirmDel ? 'Confirm' : '🗑️'}</button>
      </div>
      {confirmDel && (
        <p style={{ fontSize: 9, color: '#dc2626', textAlign: 'center', marginTop: 4 }}>
          Click Confirm to permanently delete this cable.
        </p>
      )}

      {/* ── Same Cable Connections — cable_code দিয়ে grouped ── */}
      {coCables.length > 0 && (
        <div style={{ marginBottom: 8, background: '#fefce8', border: '1px solid #fde68a',
            borderRadius: 8, padding: '7px 10px' }}>
          <div style={{ fontSize: 9, color: '#92400e', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            📡 Same Cable — {coCables.length} more connection{coCables.length > 1 ? 's' : ''}
          </div>
          {coCables.map(co => {
            const coreName = co.fiber_core_color?.split(/[,→\-–]/)[0]?.trim();
            const coreObj  = coreName
              ? FIBER_BASE_COLORS.find(c => c.name.toLowerCase() === coreName.toLowerCase())
              : null;
            const tgtSt = NODE_STYLE[co.target_node_type] || { bg: '#374151' };
            return (
              <div key={co.id} style={{ display: 'flex', alignItems: 'center', gap: 6,
                  background: '#fff', borderRadius: 6, padding: '5px 7px', marginBottom: 4,
                  border: '1px solid #fde68a' }}>
                {coreObj
                  ? <div style={{ width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                        background: coreObj.hex, border: `2px solid ${coreObj.border || coreObj.hex}` }}
                      title={co.fiber_core_color} />
                  : <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background: '#94a3b8' }} />
                }
                <div style={{ width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                    background: tgtSt.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  dangerouslySetInnerHTML={{ __html: getNodeSvg(co.target_node_type, 10, 10) }}
                />
                <span style={{ fontSize: 10, fontWeight: 700, color: '#0f172a', flex: 1, minWidth: 0,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {co.target_node_name}
                </span>
                {co.target_port && (
                  <code style={{ fontSize: 8, color: '#0369a1', background: '#dbeafe',
                      borderRadius: 3, padding: '1px 4px', flexShrink: 0 }}>
                    {co.target_port}
                  </code>
                )}
                <span style={{ fontSize: 9, color: co.fiber_core_color ? '#475569' : '#94a3b8',
                    flexShrink: 0, fontFamily: 'monospace' }}>
                  {co.fiber_core_color || 'no core'}
                </span>
                <span style={{ fontSize: 8, color: STATUS_COLOR[co.status] || '#6b7280',
                    flexShrink: 0 }}>● {co.status}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Free core section ── */}
      {onLinkAdded && (
        <FreeCoreSection
          sourceLink={link}
          allLinks={allLinks}
          allNodes={allNodes}
          onLinkAdded={onLinkAdded}
          onLinkUpdated={onLinkUpdated}
        />
      )}

      {/* ── Cable surgery — মাঝখানে Join Box বা Splitter insert ── */}
      {onNodeAdded && onLinkAdded && onDeleted && (
        <CableInsertSection
          link={link}
          onNodeAdded={onNodeAdded}
          onLinkAdded={onLinkAdded}
          onLinkDeleted={onDeleted}
        />
      )}
    </div>
  );
}

// ─── FreeCoreSection ──────────────────────────────────────────────────────────
// Same fiber cable-এর free core ব্যবহার করে নতুন connection তৈরি করা।
// source_node = original cable-এর SOURCE (Splitter) — CLIENT node avoid করতে
// MAP path = cable-এর END node (Amir P) → new target — visual continuity
function FreeCoreSection({ sourceLink, allLinks, allNodes, onLinkAdded, onLinkUpdated }) {
  const [open,       setOpen]       = useState(false);
  const [targetId,   setTargetId]   = useState('');
  const [srcPort,    setSrcPort]    = useState('');
  const [dstPort,    setDstPort]    = useState('');
  const [fiberCore,  setFiberCore]  = useState('');
  const [connecting, setConnecting] = useState(false);

  if (sourceLink.link_type !== 'FIBER' || !sourceLink.fiber_core_count) return null;

  // Same cable_code থেকে used cores
  const sameCableLinks = sourceLink.cable_code
    ? allLinks.filter(l => l.id !== sourceLink.id && l.cable_code === sourceLink.cable_code)
    : [];
  const usedCores     = parseUsedCores([sourceLink, ...sameCableLinks]);
  const allCoresList  = generateFiberCores(Math.min(sourceLink.fiber_core_count, 144));
  const freeCoresList = allCoresList.filter(c => !usedCores.has(c.name));

  if (freeCoresList.length === 0) return null;

  // SOURCE node = original cable-এর source (e.g. Splitter)
  // এটাই নতুন link-এর source_node হবে — CLIENT node error এড়াতে
  const srcNode = allNodes.find(n => n.id === sourceLink.source_node);

  // Cable END node = original cable-এর target (e.g. Amir P)
  // MAP PATH-এ শুধু এই node-এর coordinates ব্যবহার হবে visual continuity-র জন্য
  const cableEndNode = allNodes.find(n => n.id === sourceLink.target_node);

  // Source node (Splitter) ports
  const srcNodePorts = srcNode?.node_type === 'SPLITTER'
    ? getSplitterPorts(srcNode.splitter_ratio).out
    : [...(getNodePorts(srcNode)?.uplinks || []), ...(getNodePorts(srcNode)?.downlinks || [])];
  const srcUsedPorts = srcNode ? getUsedPorts(srcNode.id, allLinks) : new Set();
  const srcFreePorts = srcNodePorts.filter(p => !srcUsedPorts.has(p));

  // Target nodes — source node এবং cable end node বাদে সব
  const targetNodes    = allNodes.filter(n =>
    n.id !== sourceLink.source_node && n.id !== sourceLink.target_node && n.latitude && n.longitude
  );
  const selectedTarget = targetNodes.find(n => String(n.id) === targetId) ?? null;

  // Target node ports
  const dstNodePorts = selectedTarget?.node_type === 'SPLITTER'
    ? ['In', ...getSplitterPorts(selectedTarget.splitter_ratio).out]
    : [...(getNodePorts(selectedTarget)?.uplinks || []), ...(getNodePorts(selectedTarget)?.downlinks || [])];
  const dstUsedPorts = selectedTarget ? getUsedPorts(selectedTarget.id, allLinks) : new Set();

  const handleConnect = async () => {
    if (!targetId || !fiberCore) return toast.error('Target node এবং core select করুন।');
    if (!selectedTarget) return;
    setConnecting(true);
    try {
      // Cable code — reuse বা নতুন generate
      let cableCode = sourceLink.cable_code;
      if (!cableCode) {
        cableCode = `fc-${sourceLink.id}-${Date.now()}`;
        const updRes = await api.patch(`/network/links/${sourceLink.id}/`, { cable_code: cableCode });
        onLinkUpdated && onLinkUpdated(updRes.data);
      }

      // MAP PATH: cable end (Amir P) → new target (Mosarof)
      // Logical source = Splitter, কিন্তু map-এ line Amir P থেকে শুরু হয়
      const pathStart = cableEndNode || srcNode;
      const newPaths = pathStart ? [
        { lat: parseFloat(pathStart.latitude),      lng: parseFloat(pathStart.longitude) },
        { lat: parseFloat(selectedTarget.latitude), lng: parseFloat(selectedTarget.longitude) },
      ] : sourceLink.paths;

      const res = await api.post('/network/links/', {
        source_node:      sourceLink.source_node,  // Splitter (original source)
        target_node:      parseInt(targetId),
        link_type:        'FIBER',
        color_code:       sourceLink.color_code,
        cable_code:       cableCode,
        status:           'active',
        source_port:      srcPort || undefined,
        target_port:      dstPort || undefined,
        fiber_core_color: fiberCore,
        fiber_core_count: sourceLink.fiber_core_count,
        paths:            newPaths,
      });
      toast.success(`"${fiberCore}" core — ${selectedTarget.name} connected!`);
      onLinkAdded(res.data);
      setOpen(false);
      setTargetId(''); setSrcPort(''); setDstPort(''); setFiberCore('');
    } catch (err) {
      const msg = err?.response?.data
        ? Object.entries(err.response.data).map(([k, v]) => `${k}: ${[v].flat().join(', ')}`).join(' | ')
        : 'Connection failed.';
      toast.error(msg.slice(0, 150));
    } finally { setConnecting(false); }
  };

  const selSt = { width: '100%', border: '1px solid #e2e8f0', borderRadius: 6,
    padding: '5px 8px', fontSize: 10, outline: 'none', background: '#f8fafc', color: '#1e293b' };
  const lblSt = { fontSize: 9, color: '#64748b', fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 };

  const PChip = ({ label, active, used, onSel }) => (
    <button type="button"
      onClick={e => { e.stopPropagation(); if (!used || active) onSel(); else toast.error(`Port "${label}" already in use.`, { duration: 2000 }); }}
      style={{ fontSize: 9, padding: '2px 6px', borderRadius: 5, fontFamily: 'monospace',
        fontWeight: 700, flexShrink: 0, transition: 'all 0.12s',
        cursor: used && !active ? 'not-allowed' : 'pointer',
        border: active ? '2px solid #0891b2' : used ? '2px solid #fca5a5' : '1px solid #e2e8f0',
        background: active ? '#0891b2' : used ? '#fff1f2' : '#fff',
        color: active ? '#fff' : used ? '#b91c1c' : '#475569',
        opacity: used && !active ? 0.75 : 1 }}>
      {used && !active ? `${label} 🔒` : label}
    </button>
  );

  return (
    <div style={{ marginTop: 8, borderTop: '1px solid #f1f5f9', paddingTop: 8 }}>
      {/* Toggle button */}
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v); if (open) { setFiberCore(''); setTargetId(''); setSrcPort(''); setDstPort(''); } }}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 10px',
          background: open ? '#eff6ff' : '#f0fdf4',
          border: `1px solid ${open ? '#bfdbfe' : '#86efac'}`,
          borderRadius: 7, fontSize: 11, fontWeight: 700,
          color: open ? '#1d4ed8' : '#16a34a', cursor: 'pointer' }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Use Free Core
          <span style={{ fontSize: 9, fontWeight: 400, opacity: 0.7 }}>
            ({freeCoresList.length}/{sourceLink.fiber_core_count} available)
          </span>
        </span>
        <span style={{ fontSize: 9, opacity: 0.5 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ marginTop: 8, background: '#f8fafc', border: '1px solid #e2e8f0',
            borderRadius: 8, padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* Map path info banner */}
          <div style={{ background: '#eff6ff', borderRadius: 6, padding: '5px 9px', fontSize: 10,
              color: '#1e40af', display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            <span>
              Map line: <strong>{cableEndNode?.name || 'cable end'}</strong> → new client
              <span style={{ opacity: 0.6, marginLeft: 4 }}>({srcNode?.name} via free port)</span>
            </span>
          </div>

          {/* Free core chips */}
          <div>
            <div style={lblSt}>Select Free Core</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: 2 }}>
              {freeCoresList.map(c => (
                <button key={c.name} type="button"
                  onClick={e => { e.stopPropagation(); setFiberCore(fiberCore === c.name ? '' : c.name); }}
                  title={c.name}
                  style={{ width: 24, height: 24, borderRadius: 5, cursor: 'pointer',
                    background: c.hex, flexShrink: 0,
                    border: fiberCore === c.name ? '3px solid #0f172a' : `2px solid ${c.border || c.hex}`,
                    boxShadow: fiberCore === c.name ? '0 0 0 2px #0891b2' : 'none',
                    transform: fiberCore === c.name ? 'scale(1.15)' : 'scale(1)',
                    transition: 'all 0.12s' }} />
              ))}
            </div>
            {fiberCore && (
              <div style={{ marginTop: 4, fontSize: 10, color: '#0891b2', fontWeight: 700 }}>
                ✓ {fiberCore} core selected
              </div>
            )}
          </div>

          {/* Target node */}
          <div>
            <div style={lblSt}>Connect To (New Client)</div>
            <select value={targetId}
              onChange={e => { e.stopPropagation(); setTargetId(e.target.value); setDstPort(''); }}
              onClick={e => e.stopPropagation()} style={selSt}>
              <option value="">-- Target node select করুন --</option>
              {targetNodes.map(n => {
                const ns = NODE_STYLE[n.node_type] || { letter: '?' };
                const clientFull = n.node_type === 'CLIENT' &&
                  allLinks.some(l => l.source_node === n.id || l.target_node === n.id);
                return (
                  <option key={n.id} value={String(n.id)} disabled={clientFull}>
                    [{ns.letter}] {n.name}{clientFull ? ' 🔒 full' : ''}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Source node (Splitter) FREE port chips */}
          {srcNode && srcNodePorts.length > 0 && (
            <div>
              <div style={{ ...lblSt, display: 'flex', justifyContent: 'space-between' }}>
                <span>📍 {srcNode.name} Port</span>
                <span style={{ color: srcFreePorts.length > 0 ? '#16a34a' : '#ef4444',
                    background: srcFreePorts.length > 0 ? '#dcfce7' : '#fee2e2',
                    borderRadius: 4, padding: '0 5px', textTransform: 'none',
                    letterSpacing: 0, fontWeight: 600, fontSize: 8 }}>
                  {srcFreePorts.length} free
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                <PChip label="—" active={srcPort === ''} used={false} onSel={() => setSrcPort('')} />
                {srcNodePorts.map(p => (
                  <PChip key={p} label={p} active={srcPort === p}
                    used={srcUsedPorts.has(p)}
                    onSel={() => setSrcPort(srcPort === p ? '' : p)} />
                ))}
              </div>
            </div>
          )}

          {/* Target node port chips */}
          {selectedTarget && dstNodePorts.length > 0 && (
            <div>
              <div style={lblSt}>📍 {selectedTarget.name} Port</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                <PChip label="—" active={dstPort === ''} used={false} onSel={() => setDstPort('')} />
                {dstNodePorts.map(p => (
                  <PChip key={p} label={p} active={dstPort === p}
                    used={dstUsedPorts.has(p)}
                    onSel={() => setDstPort(dstPort === p ? '' : p)} />
                ))}
              </div>
            </div>
          )}

          {/* Connect button */}
          <button
            onClick={e => { e.stopPropagation(); handleConnect(); }}
            disabled={connecting || !targetId || !fiberCore}
            style={{ padding: '8px', fontSize: 11, fontWeight: 700, borderRadius: 7, border: 'none',
              cursor: connecting || !targetId || !fiberCore ? 'not-allowed' : 'pointer',
              background: !targetId || !fiberCore ? '#e2e8f0' : connecting ? '#94a3b8' : '#0891b2',
              color: !targetId || !fiberCore ? '#94a3b8' : '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
          >
            {connecting ? '⏳ Connecting...'
              : !fiberCore ? 'Core select করুন ↑'
              : !targetId ? 'Target select করুন ↑'
              : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                  </svg>
                  Connect via {fiberCore} core {srcPort ? `(${srcPort})` : ''}
                </>
              )}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── DownstreamCascade ───────────────────────────────────────────────────────
// JB থেকে downstream-এ কী আছে তা recursive tree view-এ দেখায়।
// JB → Splitter → [clients], JB → JB → Splitter → [clients] etc.
function DownstreamCascade({ startId, allNodes, allLinks, visited = new Set(), depth = 0 }) {
  if (depth > 6 || visited.has(startId)) return null;
  const vis      = new Set(visited).add(startId);
  const outLinks = allLinks.filter(l => l.source_node === startId);
  if (outLinks.length === 0) return null;

  return (
    <div>
      {outLinks.map(link => {
        const target = allNodes.find(n => n.id === link.target_node);
        if (!target || vis.has(target.id)) return null;
        const tSt      = NODE_STYLE[target.node_type] || { bg: '#374151' };
        const coreName = link.fiber_core_color?.split(/[,→\-–]/)[0]?.trim();
        const coreObj  = coreName
          ? FIBER_BASE_COLORS.find(c => c.name.toLowerCase() === coreName.toLowerCase())
          : null;
        const isClient = target.node_type === 'CLIENT';
        const isJB     = target.node_type === 'BOX';
        const isSpl    = target.node_type === 'SPLITTER';
        const sc       = STATUS_COLOR[target.status] || '#6b7280';
        // Splitter port info
        const splPortInfo = isSpl ? (() => {
          const usedP  = getUsedPorts(target.id, allLinks);
          const sp     = getSplitterPorts(target.splitter_ratio);
          const freeP  = sp.out.filter(p => !usedP.has(p)).length;
          return { total: sp.out.length, free: freeP };
        })() : null;

        return (
          <div key={link.id} style={{ paddingLeft: 12 }}>
            {/* Tree line + node row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
              <span style={{ color: '#cbd5e1', fontSize: 10, flexShrink: 0 }}>
                {depth === 0 ? '└' : '├'}─
              </span>
              {coreObj && (
                <div style={{ width: 8, height: 8, borderRadius: 1, background: coreObj.hex,
                    border: `1px solid ${coreObj.border || coreObj.hex}`, flexShrink: 0 }} title={coreName} />
              )}
              <div style={{ width: 14, height: 14, borderRadius: 3, background: tSt.bg, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                dangerouslySetInnerHTML={{ __html: getNodeSvg(target.node_type, 9, 9) }}
              />
              <span style={{ fontSize: 9, fontWeight: isClient ? 600 : 700,
                  color: isClient ? '#475569' : '#0f172a',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                {target.name}
              </span>
              {isSpl && target.splitter_ratio && (
                <span style={{ fontSize: 9, color: '#0369a1', background: '#e0f2fe',
                    borderRadius: 3, padding: '0 4px', fontFamily: 'monospace', flexShrink: 0 }}>
                  {target.splitter_ratio}
                </span>
              )}
              {isSpl && splPortInfo && (
                <span style={{ fontSize: 9, flexShrink: 0, fontWeight: 700,
                    color: splPortInfo.free > 0 ? '#16a34a' : '#ef4444',
                    background: splPortInfo.free > 0 ? '#dcfce7' : '#fee2e2',
                    borderRadius: 3, padding: '0 4px' }}>
                  {splPortInfo.free}/{splPortInfo.total}
                </span>
              )}
              {isJB && (
                <span style={{ fontSize: 9, color: '#92400e', background: '#fef3c7',
                    borderRadius: 3, padding: '0 4px', fontFamily: 'monospace', flexShrink: 0 }}>
                  JB
                </span>
              )}
              {isClient && (
                <span style={{ fontSize: 8, color: sc, flexShrink: 0 }}>●</span>
              )}
            </div>
            {/* Recurse — clients are terminal */}
            {!isClient && (
              <DownstreamCascade
                startId={target.id}
                allNodes={allNodes}
                allLinks={allLinks}
                visited={vis}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── SplitterInsidePanel ─────────────────────────────────────────────────────
// JB-এর inside Splitter-এর সম্পূর্ণ details।
// Input (In): কোন cable-এর কোন core ফিড করছে — cable-grouped selection।
// Output (Out): connected info বা free port-এ connect form।
function SplitterInsidePanel({ splitter, jbLink, allLinks, allNodes,
    clientMarkers = [], jbFiberCables = [], hasFiberCable,
    onLinkUpdated, onLinkCreated, onNodeCreated, onNodeUpdated, onNodeDeleted }) {
  const [expanded,      setExpanded]      = useState(true);
  const [editingIn,     setEditingIn]     = useState(false);
  const [patching,      setPatching]      = useState(false);

  // Edit Splitter state
  const [editMode,    setEditMode]    = useState(false);
  const [editName,    setEditName]    = useState(splitter.name);
  const [editRatio,   setEditRatio]   = useState(splitter.splitter_ratio || '1:4');
  const [saving,      setSaving]      = useState(false);
  // Delete confirm state
  const [delConfirm,  setDelConfirm]  = useState(false);
  const [deleting,    setDeleting]    = useState(false);
  const [connectPort,    setConnectPort]   = useState(null); // Out-X port string
  const [connTarget,     setConnTarget]   = useState('');
  const [connCable,      setConnCable]    = useState('');   // selected cable link id
  const [connCore,       setConnCore]     = useState('');
  const [connCoreCount,  setConnCoreCount] = useState(12);  // fiber cable core count
  const [connCreating,   setConnCreating]  = useState(false);

  const sp        = getSplitterPorts(splitter.splitter_ratio);
  const usedPorts = getUsedPorts(splitter.id, allLinks);
  const freeOut   = sp.out.filter(p => !usedPorts.has(p)).length;

  // Dynamic clients — NetworkNode নেই, clientMarkers-এ আছে
  const splExistingClientIds = new Set(allNodes.filter(n => n.client).map(n => n.client));
  const splDynClients = clientMarkers.filter(c => !splExistingClientIds.has(c.id));

  // In port — current core from JB→Splitter link
  const inCoreName = jbLink?.fiber_core_color?.split(/[,→\-–]/)[0]?.trim();
  const inCoreObj  = inCoreName
    ? FIBER_BASE_COLORS.find(c => c.name.toLowerCase() === inCoreName.toLowerCase())
    : null;

  // Per-cable cores for grouped display
  const getCableCores = (cable) => cable.fiber_core_count
    ? generateFiberCores(Math.min(cable.fiber_core_count, 144))
    : [];

  const getCableLabel = (cable) => {
    const isSrc = cable.source_node !== splitter.id;
    return isSrc
      ? `${cable.source_node_name} → JB`
      : `JB → ${cable.target_node_name}`;
  };

  // Out port → connected link
  const getOutConn = (port) => allLinks.find(lk =>
    (lk.source_node === splitter.id && lk.source_port === port) ||
    (lk.target_node === splitter.id && lk.target_port === port)
  );

  // Selected cable for output connect form
  const selectedConnCable = jbFiberCables.find(c => String(c.id) === connCable) ?? null;
  const connCableCores    = selectedConnCable ? getCableCores(selectedConnCable) : [];

  const handleSaveEdit = async () => {
    if (!editName.trim()) return toast.error('Name required.');
    setSaving(true);
    try {
      const res = await api.patch(`/network/nodes/${splitter.id}/`, {
        name: editName.trim(),
        splitter_ratio: editRatio,
      });
      onNodeUpdated && onNodeUpdated(res.data);
      setEditMode(false);
      toast.success(`✓ "${editName}" updated.`);
    } catch { toast.error('Update failed.'); }
    finally { setSaving(false); }
  };

  const handleDeleteSplitter = async () => {
    setDeleting(true);
    try {
      await api.delete(`/network/nodes/${splitter.id}/`);
      onNodeDeleted && onNodeDeleted(splitter.id);
      toast.success(`🗑️ Splitter "${splitter.name}" deleted.`);
    } catch { toast.error('Delete failed.'); setDeleting(false); }
  };

  const handleCoreAssign = async (newCore) => {
    if (!jbLink || patching) return;
    setPatching(true);
    try {
      const res = await api.patch(`/network/links/${jbLink.id}/`, { fiber_core_color: newCore });
      onLinkUpdated && onLinkUpdated(res.data);
      setEditingIn(false);
      toast.success(`Splitter "${splitter.name}" ← ${newCore} core assigned.`);
    } catch { toast.error('Core assignment failed.'); }
    finally { setPatching(false); }
  };

  const handleConnectOut = async (port) => {
    if (!connTarget) return toast.error('Target node select করুন।');

    // Dynamic client হলে আগে NetworkNode তৈরি করতে হবে
    let resolvedTarget = allNodes.find(n => String(n.id) === connTarget);
    if (!resolvedTarget && String(connTarget).startsWith('dyn-')) {
      const clientId = parseInt(connTarget.replace('dyn-', ''));
      const dyn = splDynClients.find(c => c.id === clientId);
      if (!dyn) return toast.error('Client not found.');
      setConnCreating(true);
      try {
        const nr = await api.post('/network/nodes/', {
          name: dyn.full_name, node_type: 'CLIENT',
          latitude: dyn.latitude, longitude: dyn.longitude,
          client: dyn.id, status: dyn.status === 'active' ? 'active' : 'inactive',
        });
        resolvedTarget = nr.data;
        onNodeCreated && onNodeCreated(nr.data);
      } catch {
        setConnCreating(false);
        return toast.error('Client node তৈরি ব্যর্থ হয়েছে।');
      }
    }

    if (!resolvedTarget) return;
    setConnCreating(true);
    try {
      const paths = splitter.latitude && resolvedTarget.latitude ? [
        { lat: parseFloat(splitter.latitude),       lng: parseFloat(splitter.longitude) },
        { lat: parseFloat(resolvedTarget.latitude), lng: parseFloat(resolvedTarget.longitude) },
      ] : undefined;
      const res = await api.post('/network/links/', {
        source_node:      splitter.id,
        target_node:      resolvedTarget.id,
        source_port:      port,
        target_port:      resolvedTarget.node_type === 'CLIENT' ? 'ONT' : undefined,
        link_type:        'FIBER',
        color_code:       selectedConnCable?.color_code || '#00bcd4',
        cable_code:       selectedConnCable?.cable_code || undefined,
        fiber_core_color: connCore || undefined,
        fiber_core_count: selectedConnCable?.fiber_core_count || connCoreCount || undefined,
        status:           'active',
        paths,
      });
      onLinkCreated && onLinkCreated(res.data);
      toast.success(`${port} → ${resolvedTarget.name}${connCore ? ` (${connCore})` : ''} connected!`);
      setConnectPort(null); setConnTarget(''); setConnCable(''); setConnCore(''); setConnCoreCount(12);
    } catch (err) {
      const msg = err?.response?.data
        ? Object.entries(err.response.data).map(([k,v])=>`${k}: ${[v].flat().join(', ')}`).join(' | ')
        : 'Connection failed.';
      toast.error(msg.slice(0, 150));
    } finally { setConnCreating(false); }
  };

  const secLbl = { fontSize: 10, color: '#475569', fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 };
  const chipBtn = (isActive, hex, border, onClick, title, size=26) => ({
    width: size, height: size, borderRadius: 5, cursor: 'pointer', background: hex, flexShrink: 0,
    border: isActive ? '3px solid #0f172a' : `2px solid ${border || hex}`,
    boxShadow: isActive ? '0 0 0 2px #0891b2' : 'none',
    transform: isActive ? 'scale(1.12)' : 'scale(1)', transition: 'all 0.1s',
  });

  return (
    <div style={{ background: '#f0fdf4', borderRadius: 8, marginBottom: 6,
        border: '1px solid #86efac', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 9px' }}>
        {/* Left — click to expand */}
        <div onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
          role="button" tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setExpanded(v => !v); } }}
          style={{ display:'flex', alignItems:'center', gap:6, flex:1, cursor:'pointer', userSelect:'none', minWidth:0 }}>
          <div style={{ width:16, height:16, borderRadius:3, flexShrink:0,
              background:NODE_STYLE.SPLITTER.bg, display:'flex', alignItems:'center', justifyContent:'center' }}
            dangerouslySetInnerHTML={{ __html: getNodeSvg('SPLITTER', 10, 10) }}
          />
          <span style={{ fontSize:11, fontWeight:700, color:'#0f172a', flex:1 }}>
            {splitter.name}
          </span>
          {splitter.splitter_ratio && (
            <span style={{ fontSize:9, background:'#e0f2fe', color:'#0369a1',
                borderRadius:4, padding:'1px 6px', fontFamily:'monospace', fontWeight:700, flexShrink:0 }}>
              {splitter.splitter_ratio}
            </span>
          )}
          <span style={{ fontSize:9, fontWeight:700, flexShrink:0,
              color: freeOut > 0 ? '#16a34a' : '#ef4444',
              background: freeOut > 0 ? '#dcfce7' : '#fee2e2',
              borderRadius:4, padding:'1px 6px' }}>
            {freeOut}/{sp.out.length} free
          </span>
          <span style={{ fontSize:9, color:'#94a3b8', flexShrink:0 }}>{expanded ? '▲' : '▼'}</span>
        </div>
        {/* Right — Edit + Delete (no expand trigger) */}
        <button onClick={e => { e.stopPropagation(); setEditMode(v => !v); setDelConfirm(false); setEditName(splitter.name); setEditRatio(splitter.splitter_ratio||'1:4'); }}
          title="Edit splitter name / ratio"
          style={{ background:'none', border:'none', cursor:'pointer', color:'#0891b2',
            fontSize:12, padding:'0 3px', lineHeight:1, flexShrink:0,
            opacity: editMode ? 1 : 0.5, transition:'opacity 0.15s' }}
          onMouseEnter={e=>e.currentTarget.style.opacity='1'}
          onMouseLeave={e=>{ if(!editMode) e.currentTarget.style.opacity='0.5'; }}>
          ✏️
        </button>
        <button onClick={e => { e.stopPropagation(); setDelConfirm(v => !v); setEditMode(false); }}
          title="Delete this splitter"
          style={{ background:'none', border:'none', cursor:'pointer', color:'#e11d48',
            fontSize:12, padding:'0 3px', lineHeight:1, flexShrink:0,
            opacity: delConfirm ? 1 : 0.5, transition:'opacity 0.15s' }}
          onMouseEnter={e=>e.currentTarget.style.opacity='1'}
          onMouseLeave={e=>{ if(!delConfirm) e.currentTarget.style.opacity='0.5'; }}>
          🗑️
        </button>
      </div>

      {/* ── Edit form ── */}
      {editMode && (
        <div style={{ padding:'8px 10px', background:'#eff6ff', borderTop:'1px solid #bfdbfe' }}>
          <div style={{ fontSize:9, color:'#1d4ed8', fontWeight:700, marginBottom:6,
              textTransform:'uppercase', letterSpacing:'0.04em' }}>Edit Splitter</div>
          <div style={{ marginBottom:5 }}>
            <div style={{ fontSize:8, color:'#64748b', fontWeight:600, marginBottom:3 }}>Name</div>
            <input value={editName} onChange={e=>setEditName(e.target.value)}
              onClick={e=>e.stopPropagation()}
              style={{ width:'100%', border:'1px solid #93c5fd', borderRadius:5, padding:'4px 8px',
                fontSize:11, outline:'none', background:'#fff', boxSizing:'border-box', color:'#0f172a' }} />
          </div>
          <div style={{ marginBottom:7 }}>
            <div style={{ fontSize:8, color:'#64748b', fontWeight:600, marginBottom:3 }}>Ratio</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
              {SPLITTER_PLC_RATIOS.map(r => (
                <button key={r} type="button" onClick={e=>{ e.stopPropagation(); setEditRatio(r); }}
                  style={{ padding:'2px 7px', borderRadius:4, fontSize:9, fontWeight:700,
                    fontFamily:'monospace', cursor:'pointer',
                    border: editRatio===r?'2px solid #1d4ed8':'1px solid #e2e8f0',
                    background: editRatio===r?'#1d4ed8':'#fff',
                    color: editRatio===r?'#fff':'#475569' }}>
                  {r}
                </button>
              ))}
              {SPLITTER_TAP_RATIOS.slice(0,6).map(r => (
                <button key={r} type="button" onClick={e=>{ e.stopPropagation(); setEditRatio(r); }}
                  style={{ padding:'2px 6px', borderRadius:4, fontSize:8, fontWeight:700,
                    fontFamily:'monospace', cursor:'pointer',
                    border: editRatio===r?'2px solid #0891b2':'1px solid #e2e8f0',
                    background: editRatio===r?'#0891b2':'#fff',
                    color: editRatio===r?'#fff':'#475569' }}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display:'flex', gap:5 }}>
            <button onClick={e=>{ e.stopPropagation(); handleSaveEdit(); }}
              disabled={saving || !editName.trim()}
              style={{ flex:1, padding:'6px', fontSize:10, fontWeight:700, borderRadius:6,
                border:'none', cursor: !editName.trim()?'not-allowed':'pointer',
                background: saving?'#94a3b8':'#1d4ed8', color:'#fff' }}>
              {saving ? '⏳...' : '✓ Save'}
            </button>
            <button onClick={e=>{ e.stopPropagation(); setEditMode(false); }}
              style={{ padding:'6px 10px', fontSize:10, borderRadius:6,
                border:'1px solid #e2e8f0', background:'#fff', color:'#475569', cursor:'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Delete confirm ── */}
      {delConfirm && (
        <div style={{ padding:'8px 10px', background:'#fff1f2', borderTop:'1px solid #fecdd3' }}>
          <div style={{ fontSize:10, color:'#dc2626', fontWeight:600, marginBottom:7 }}>
            "{splitter.name}" এবং সব connections মুছে ফেলবেন?
          </div>
          <div style={{ display:'flex', gap:5 }}>
            <button onClick={e=>{ e.stopPropagation(); handleDeleteSplitter(); }}
              disabled={deleting}
              style={{ flex:1, padding:'6px', fontSize:10, fontWeight:700, borderRadius:6,
                border:'none', cursor:'pointer', background: deleting?'#94a3b8':'#dc2626', color:'#fff' }}>
              {deleting ? '⏳...' : '🗑️ Delete'}
            </button>
            <button onClick={e=>{ e.stopPropagation(); setDelConfirm(false); }}
              style={{ padding:'6px 10px', fontSize:10, borderRadius:6,
                border:'1px solid #e2e8f0', background:'#fff', color:'#475569', cursor:'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {expanded && (
        <div style={{ padding: '8px 10px', background: '#fff', borderTop: '1px solid #bbf7d0' }}>

          {/* ══ INPUT (In) ══════════════════════════════════════════════════ */}
          <div style={{ marginBottom: 10 }}>
            <div style={secLbl}>📥 Input (In) — Fiber Core</div>

            {!editingIn ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f8fafc',
                  borderRadius: 6, padding: '5px 9px', border: '1px solid #e2e8f0' }}>
                {inCoreObj
                  ? <div style={{ width: 12, height: 12, borderRadius: 2, background: inCoreObj.hex,
                        border: `2px solid ${inCoreObj.border || inCoreObj.hex}`, flexShrink: 0 }} />
                  : <div style={{ width: 12, height: 12, borderRadius: 2, background: '#e2e8f0',
                        border: '1.5px dashed #94a3b8', flexShrink: 0 }} />
                }
                <span style={{ fontSize: 11, color: inCoreName ? '#0f172a' : '#94a3b8',
                    fontWeight: inCoreName ? 600 : 400, flex: 1 }}>
                  {inCoreName || 'No core assigned'}
                </span>
                <button onClick={e => { e.stopPropagation(); setEditingIn(true); }}
                  style={{ fontSize: 10, padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
                    border: '1px solid #86efac', background: '#f0fdf4', color: '#16a34a', fontWeight: 700 }}>
                  {inCoreName ? 'Change' : 'Assign'}
                </button>
              </div>
            ) : (
              <div style={{ background: '#f8fafc', borderRadius: 7, padding: '8px 9px',
                  border: '1px solid #bae6fd' }}>

                {!hasFiberCable ? (
                  <div style={{ background: '#fef3c7', borderRadius: 5, padding: '6px 8px',
                      fontSize: 9, color: '#78350f', marginBottom: 6 }}>
                    ⚠ JB-তে fiber cable নেই। <strong>🔵 Add Fiber Cable (OLT / Router)</strong> button দিয়ে আগে upstream cable যোগ করুন।
                  </div>
                ) : jbFiberCables.length === 0 || jbFiberCables.every(c => !c.fiber_core_count) ? (
                  <div style={{ background: '#fff7ed', borderRadius: 5, padding: '6px 8px',
                      fontSize: 9, color: '#9a3412', marginBottom: 6 }}>
                    ⚠ Cable-এ core count নেই। ✏️ Edit Details → Total Core Count set করুন।
                  </div>
                ) : (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 9, color: '#0369a1', fontWeight: 600, marginBottom: 6 }}>
                      Cable select করুন, তারপর core:
                    </div>
                    {/* Cables grouped */}
                    {jbFiberCables.filter(c => c.fiber_core_count > 0).map(cable => {
                      const cores = getCableCores(cable);
                      const label = getCableLabel(cable);
                      return (
                        <div key={cable.id} style={{ marginBottom: 7, background: '#f0f9ff',
                            borderRadius: 6, padding: '6px 8px', border: '1px solid #bae6fd' }}>
                          <div style={{ fontSize: 9, color: '#0369a1', fontWeight: 700, marginBottom: 5,
                              display: 'flex', alignItems: 'center', gap: 5 }}>
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                              strokeWidth="2.5" strokeLinecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                            {label}
                            <span style={{ fontSize: 8, color: '#94a3b8', fontWeight: 400 }}>
                              ({cable.fiber_core_count}C)
                            </span>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {cores.map(c => {
                              const isActive = inCoreName === c.name;
                              return (
                                <button key={c.name} type="button" title={c.name}
                                  onClick={e => { e.stopPropagation(); if (!patching) handleCoreAssign(c.name); }}
                                  disabled={patching}
                                  style={chipBtn(isActive, c.hex, c.border, null, c.name)} />
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                    {patching && <div style={{ fontSize: 9, color: '#0891b2' }}>⏳ Assigning...</div>}
                  </div>
                )}

                <button onClick={e => { e.stopPropagation(); setEditingIn(false); }}
                  style={{ fontSize: 9, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                    border: '1px solid #e2e8f0', background: '#fff', color: '#475569' }}>
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* ══ OUTPUT Ports ════════════════════════════════════════════════ */}
          <div>
            <div style={secLbl}>📤 Output Ports</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {sp.out.map(port => {
                const conn  = getOutConn(port);

                /* ── Used port ── */
                if (conn) {
                  const isOutConn = conn.source_node === splitter.id;
                  const pName = isOutConn ? conn.target_node_name : conn.source_node_name;
                  const pType = isOutConn ? conn.target_node_type : conn.source_node_type;
                  const pSt   = NODE_STYLE[pType] || { bg: '#374151' };
                  const pNode = allNodes.find(n => n.id === (isOutConn ? conn.target_node : conn.source_node));
                  const sc    = STATUS_COLOR[pNode?.status] || '#6b7280';
                  const cn    = conn.fiber_core_color?.split(/[,→\-–]/)[0]?.trim();
                  const co    = cn ? FIBER_BASE_COLORS.find(c => c.name.toLowerCase() === cn.toLowerCase()) : null;
                  return (
                    <div key={port} style={{ display: 'flex', alignItems: 'center', gap: 5,
                        padding: '4px 7px', borderRadius: 5, background: '#f0fdf4',
                        border: '1px solid #bbf7d0' }}>
                      <code style={{ fontSize: 9, color: '#0369a1', background: '#dbeafe',
                          borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>{port}</code>
                      {co && (
                        <div title={cn}
                          style={{ width: 11, height: 11, borderRadius: 2, flexShrink: 0,
                            background: co.hex, border: `2px solid ${co.border||co.hex}`,
                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                      )}
                      {conn.fiber_core_count && (
                        <span style={{ fontSize: 10, color: '#0369a1', background: '#dbeafe',
                            borderRadius: 3, padding: '1px 5px', fontWeight: 700, flexShrink: 0,
                            fontFamily: 'monospace' }}>
                          {conn.fiber_core_count}C
                        </span>
                      )}
                      <div style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                          background: pSt.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        dangerouslySetInnerHTML={{ __html: getNodeSvg(pType, 10, 10) }}
                      />
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#0f172a', flex: 1, minWidth: 0,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pName}</span>
                      <span style={{ fontSize: 9, color: sc, flexShrink: 0, fontWeight: 600 }}>● {pNode?.status || '?'}</span>
                    </div>
                  );
                }

                /* ── Free port — connect form ── */
                const isConnecting = connectPort === port;
                return (
                  <div key={port}>
                    {!isConnecting ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5,
                          padding: '4px 7px', borderRadius: 5, background: '#f8fafc',
                          border: '1px dashed #e2e8f0' }}>
                        <code style={{ fontSize: 9, color: '#64748b', background: '#f1f5f9',
                            borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>{port}</code>
                        <span style={{ fontSize: 9, color: '#16a34a', flex: 1 }}>— (free)</span>
                        <button onClick={e => { e.stopPropagation();
                            setConnectPort(port); setConnTarget(''); setConnCable('');
                            setConnCore(''); setConnCoreCount(12); }}
                          style={{ fontSize: 9, padding: '1px 8px', borderRadius: 4, cursor: 'pointer',
                            border: '1px solid #86efac', background: '#f0fdf4', color: '#16a34a', fontWeight: 700 }}>
                          + Connect
                        </button>
                      </div>
                    ) : (
                      <div style={{ background: '#f0fdf4', borderRadius: 7, padding: '8px 9px',
                          border: '1px solid #86efac' }}>
                        <div style={{ fontSize: 9, color: '#15803d', fontWeight: 700, marginBottom: 7,
                            display: 'flex', justifyContent: 'space-between' }}>
                          <span>🔗 Connect {port}</span>
                          <button onClick={e => { e.stopPropagation(); setConnectPort(null); }}
                            style={{ fontSize: 9, border: 'none', background: 'none',
                              color: '#94a3b8', cursor: 'pointer' }}>✕</button>
                        </div>

                        {/* Target node */}
                        <div style={{ marginBottom: 6 }}>
                          <div style={{ fontSize: 8, color: '#64748b', fontWeight: 700,
                              textTransform: 'uppercase', marginBottom: 3 }}>Target Node</div>
                          <select value={connTarget}
                            onChange={e => { e.stopPropagation(); setConnTarget(e.target.value); }}
                            onClick={e => e.stopPropagation()}
                            style={{ width: '100%', border: '1px solid #86efac', borderRadius: 5,
                              padding: '4px 7px', fontSize: 10, outline: 'none', background: '#fff' }}>
                            <option value="">-- Node / Client select করুন --</option>
                            {allNodes.filter(n => n.id !== splitter.id && n.latitude && n.longitude).map(n => {
                              const ns = NODE_STYLE[n.node_type] || { letter: '?' };
                              const full = n.node_type === 'CLIENT' &&
                                allLinks.some(l => l.source_node === n.id || l.target_node === n.id);
                              return (
                                <option key={n.id} value={String(n.id)} disabled={full}>
                                  [{ns.letter}] {n.name}{full ? ' 🔒' : ''}
                                </option>
                              );
                            })}
                            {splDynClients.length > 0 && (
                              <option disabled>── Clients (GPS) ──</option>
                            )}
                            {splDynClients.map(c => (
                              <option key={`dyn-${c.id}`} value={`dyn-${c.id}`}>
                                [C] {c.full_name} ({c.customer_id})
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* ── Fiber Cable & Core section ── */}
                        {(() => {
                          // Target node type detect করো
                          const tgtNode      = allNodes.find(n => String(n.id) === connTarget) ?? null;
                          const targetIsBox  = tgtNode?.node_type === 'BOX';

                          // cable select হলে সেটার core count নাও, না হলে connCoreCount ব্যবহার
                          const selCable     = jbFiberCables.find(c => String(c.id) === connCable) ?? null;
                          const effectiveCount = targetIsBox
                            ? connCoreCount   // BOX target: user directly picks count
                            : (selCable?.fiber_core_count || connCoreCount);
                          const allCores     = generateFiberCores(Math.min(Math.max(effectiveCount, 1), 96));

                          // Used cores for non-BOX targets
                          const usedByOutputLinks = parseUsedCores(
                            allLinks.filter(l =>
                              (l.source_node === splitter.id && l.source_port?.startsWith('Out')) ||
                              (l.target_node === splitter.id && l.target_port?.startsWith('Out'))
                            )
                          );
                          const usedByCable = (!targetIsBox && selCable)
                            ? parseUsedCores(allLinks.filter(l =>
                                (l.source_node === selCable.source_node && l.target_node === selCable.target_node) ||
                                (l.source_node === selCable.target_node && l.target_node === selCable.source_node)
                              ))
                            : usedByOutputLinks;

                          // ══ TARGET IS BOX — simplified cable routing form ══════
                          if (targetIsBox) {
                            const signalCore  = connCore;
                            const freeInBox   = allCores.filter(c => c.name !== signalCore).length;
                            return (
                              <div style={{ background:'#fffbeb', borderRadius:7, padding:'9px 10px',
                                  border:'2px solid #fcd34d', marginBottom:6 }}>

                                {/* Header */}
                                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                                    marginBottom:7 }}>
                                  <div style={{ fontSize:8, color:'#92400e', fontWeight:700,
                                      textTransform:'uppercase', letterSpacing:'0.05em' }}>
                                    📦 New Cable → BOX
                                  </div>
                                  <span style={{ fontSize:8, color:'#0891b2', background:'#e0f2fe',
                                      borderRadius:4, padding:'1px 6px', fontWeight:700 }}>
                                    {effectiveCount}C cable
                                  </span>
                                </div>

                                {/* Step 1: Total cable core count */}
                                <div style={{ marginBottom:8 }}>
                                  <div style={{ fontSize:8, color:'#64748b', fontWeight:700,
                                      marginBottom:4, textTransform:'uppercase', letterSpacing:'0.04em' }}>
                                    ① Cable-এ মোট কতটি Core?
                                  </div>
                                  <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
                                    {[2, 4, 6, 8, 12, 24, 48, 96].map(n => (
                                      <button key={n} type="button"
                                        onClick={e => { e.stopPropagation(); setConnCoreCount(n); setConnCore(''); }}
                                        style={{ padding:'2px 7px', fontSize:9, fontWeight:700,
                                          borderRadius:5, cursor:'pointer', flexShrink:0,
                                          border: connCoreCount===n?'2px solid #0891b2':'1px solid #cbd5e1',
                                          background: connCoreCount===n?'#0891b2':'#fff',
                                          color: connCoreCount===n?'#fff':'#64748b' }}>
                                        {n}C
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {/* Step 2: Signal core — which core carries this output */}
                                <div style={{ marginBottom:6 }}>
                                  <div style={{ fontSize:8, color:'#64748b', fontWeight:700,
                                      marginBottom:4, textTransform:'uppercase', letterSpacing:'0.04em' }}>
                                    ② {port} Signal কোন Core-এ যাবে?
                                    {signalCore && (
                                      <span style={{ marginLeft:6, color:'#0891b2', fontWeight:700,
                                          textTransform:'none', letterSpacing:0, fontSize:9 }}>
                                        ✓ {signalCore}
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ display:'flex', flexWrap:'wrap', gap:4, maxHeight:60, overflowY:'auto' }}>
                                    {allCores.map(c => {
                                      const isActive = signalCore === c.name;
                                      return (
                                        <div key={c.name} style={{ display:'flex', flexDirection:'column',
                                            alignItems:'center', gap:1 }}>
                                          <button type="button"
                                            title={`${c.name} — Signal core হিসেবে select করুন`}
                                            onClick={e => { e.stopPropagation(); setConnCore(isActive?'':c.name); }}
                                            style={{ width:24, height:24, borderRadius:5,
                                              background:c.hex, cursor:'pointer', flexShrink:0,
                                              border: isActive?'3px solid #0f172a':`2px solid ${c.border||c.hex}`,
                                              boxShadow: isActive?'0 0 0 2.5px #f59e0b':'none',
                                              transform: isActive?'scale(1.15)':'scale(1)',
                                              transition:'all 0.1s', position:'relative' }}>
                                            {isActive && (
                                              <div style={{ position:'absolute', top:-4, right:-4,
                                                width:10, height:10, borderRadius:'50%',
                                                background:'#f59e0b', border:'1.5px solid #fff',
                                                display:'flex', alignItems:'center', justifyContent:'center' }}>
                                                <span style={{ fontSize:8, color:'#fff', fontWeight:900 }}>↓</span>
                                              </div>
                                            )}
                                          </button>
                                          <span style={{ fontSize:8, color: isActive?'#d97706':'#94a3b8',
                                              fontWeight: isActive?700:400, whiteSpace:'nowrap' }}>
                                            {c.name.length>5?c.name.substring(0,5):c.name}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>

                                {/* Preview: what the new BOX will see */}
                                {signalCore && (
                                  <div style={{ background:'#fff', borderRadius:6, padding:'6px 8px',
                                      border:'1px solid #fcd34d', marginTop:4 }}>
                                    <div style={{ fontSize:8, color:'#92400e', fontWeight:700,
                                        marginBottom:5, textTransform:'uppercase', letterSpacing:'0.04em' }}>
                                      📦 New BOX-এ cable দেখাবে:
                                    </div>
                                    <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                                      {allCores.map(c => {
                                        const isSignal = c.name === signalCore;
                                        return (
                                          <div key={c.name} style={{ display:'flex', flexDirection:'column',
                                              alignItems:'center', gap:1 }}>
                                            <div title={isSignal?`${c.name} — Signal from ${port}`:`${c.name} — FREE`}
                                              style={{ width:20, height:20, borderRadius:4, position:'relative',
                                                background: isSignal ? c.hex : '#fff',
                                                border: isSignal
                                                  ? `2.5px solid ${c.border||c.hex}`
                                                  : '2px dashed #94a3b8',
                                                boxShadow: isSignal ? '0 0 0 1.5px #f59e0b' : 'none' }}>
                                              {isSignal && (
                                                <div style={{ position:'absolute', top:-4, right:-4,
                                                  width:9,height:9, borderRadius:'50%',
                                                  background:'#f59e0b', border:'1px solid #fff',
                                                  display:'flex', alignItems:'center', justifyContent:'center' }}>
                                                  <span style={{ fontSize:5, color:'#fff', fontWeight:900 }}>↓</span>
                                                </div>
                                              )}
                                              {!isSignal && (
                                                <div style={{ position:'absolute', inset:0, display:'flex',
                                                  alignItems:'center', justifyContent:'center' }}>
                                                  <div style={{ width:5, height:5, borderRadius:'50%',
                                                    background:'#16a34a' }} />
                                                </div>
                                              )}
                                            </div>
                                            <span style={{ fontSize:8, fontWeight:700, whiteSpace:'nowrap',
                                                color: isSignal ? '#d97706' : '#16a34a' }}>
                                              {isSignal ? '↓sig' : 'free'}
                                            </span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                    <div style={{ marginTop:5, fontSize:8, color:'#64748b', display:'flex',
                                        justifyContent:'space-between' }}>
                                      <span style={{ color:'#d97706', fontWeight:600 }}>
                                        ↓ {signalCore} = signal from {port}
                                      </span>
                                      <span style={{ color:'#16a34a', fontWeight:600 }}>
                                        {freeInBox} cores free in BOX
                                      </span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          }

                          // ══ DEFAULT: Client / other node form (unchanged) ══════
                          const freeCoreCount = allCores.filter(c => !usedByCable.has(c.name)).length;
                          return (
                            <div style={{ background: '#f0f9ff', borderRadius: 7, padding: '8px 9px',
                                border: '1px solid #bae6fd', marginBottom: 6 }}>

                              {/* Header */}
                              <div style={{ display: 'flex', alignItems: 'center',
                                  justifyContent: 'space-between', marginBottom: 6 }}>
                                <div style={{ fontSize: 8, color: '#0369a1', fontWeight: 700,
                                    textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                  🔵 Fiber Core
                                </div>
                                <span style={{ fontSize: 8, fontWeight: 700, borderRadius: 4, padding: '1px 6px',
                                    color: freeCoreCount > 0 ? '#16a34a' : '#dc2626',
                                    background: freeCoreCount > 0 ? '#dcfce7' : '#fee2e2' }}>
                                  {freeCoreCount}/{effectiveCount} free
                                </span>
                              </div>

                              {/* Cable core count buttons */}
                              {!selCable && (
                                <div style={{ marginBottom: 7 }}>
                                  <div style={{ fontSize: 8, color: '#64748b', fontWeight: 600,
                                      marginBottom: 4 }}>Cable Core Count:</div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                                    {[2, 4, 6, 8, 12, 24, 48, 96].map(n => (
                                      <button key={n} type="button"
                                        onClick={e => { e.stopPropagation();
                                          setConnCoreCount(n); setConnCore(''); }}
                                        style={{ padding: '1px 6px', fontSize: 9, fontWeight: 700,
                                          borderRadius: 4, cursor: 'pointer', flexShrink: 0,
                                          border: connCoreCount === n ? '2px solid #0891b2' : '1px solid #cbd5e1',
                                          background: connCoreCount === n ? '#0891b2' : '#fff',
                                          color: connCoreCount === n ? '#fff' : '#64748b' }}>
                                        {n}C
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* JB Cable selection */}
                              {jbFiberCables.length > 0 && (
                                <div style={{ marginBottom: 7 }}>
                                  <div style={{ fontSize: 8, color: '#64748b', fontWeight: 600,
                                      marginBottom: 4 }}>
                                    JB Fiber Cable {selCable ? `(${selCable.fiber_core_count || '?'}C)` : '(optional):'}
                                  </div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 5,
                                        fontSize: 9, cursor: 'pointer',
                                        color: connCable === '' ? '#0891b2' : '#475569' }}>
                                      <input type="radio" name={`cable-${port}`} value=""
                                        checked={connCable === ''}
                                        onChange={() => { setConnCable(''); setConnCore(''); }}
                                        onClick={e => e.stopPropagation()} />
                                      Not specified
                                    </label>
                                    {jbFiberCables.map(cable => (
                                      <label key={cable.id}
                                        style={{ display: 'flex', alignItems: 'center', gap: 5,
                                          fontSize: 9, cursor: 'pointer',
                                          color: connCable === String(cable.id) ? '#0891b2' : '#475569' }}>
                                        <input type="radio" name={`cable-${port}`} value={String(cable.id)}
                                          checked={connCable === String(cable.id)}
                                          onChange={() => { setConnCable(String(cable.id)); setConnCore(''); }}
                                          onClick={e => e.stopPropagation()} />
                                        {getCableLabel(cable)}
                                        {cable.fiber_core_count
                                          ? <span style={{ color: '#0891b2', fontWeight: 700 }}> ({cable.fiber_core_count}C)</span>
                                          : ''}
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Fiber core color chips */}
                              <div>
                                <div style={{ fontSize: 8, color: '#64748b', fontWeight: 600, marginBottom: 5,
                                    display: 'flex', justifyContent: 'space-between' }}>
                                  <span>Core Color Select করুন:</span>
                                  {connCore && (
                                    <span style={{ color: '#0891b2', fontWeight: 700,
                                        textTransform: 'none', letterSpacing: 0 }}>
                                      ✓ {connCore}
                                    </span>
                                  )}
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4,
                                    maxHeight: 72, overflowY: 'auto', padding: 2 }}>
                                  {allCores.map(c => {
                                    const isUsed   = usedByCable.has(c.name);
                                    const isActive = connCore === c.name;
                                    return (
                                      <button key={c.name} type="button"
                                        title={`${c.name}${isUsed ? ' (used)' : ''}`}
                                        onClick={e => {
                                          e.stopPropagation();
                                          if (isUsed && !isActive) {
                                            toast.error(`⛔ Core "${c.name}" already used.`, { duration: 2500 });
                                            return;
                                          }
                                          setConnCore(isActive ? '' : c.name);
                                        }}
                                        style={{
                                          width: 24, height: 24, borderRadius: 5,
                                          background: c.hex, flexShrink: 0, cursor: 'pointer',
                                          border: isActive ? '3px solid #0f172a' : `2px solid ${c.border || c.hex}`,
                                          boxShadow: isActive ? '0 0 0 2px #0891b2' : 'none',
                                          opacity: isUsed && !isActive ? 0.3 : 1,
                                          transform: isActive ? 'scale(1.15)' : 'scale(1)',
                                          transition: 'all 0.1s', position: 'relative',
                                        }}>
                                        {isUsed && !isActive && (
                                          <span style={{ position: 'absolute', inset: 0,
                                            display: 'flex', alignItems: 'center',
                                            justifyContent: 'center', fontSize: 9,
                                            color: '#1e293b', fontWeight: 900 }}>✕</span>
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Connect button */}
                        <button onClick={e => { e.stopPropagation(); handleConnectOut(port); }}
                          disabled={connCreating || !connTarget}
                          style={{ width: '100%', padding: '7px', fontSize: 10, fontWeight: 700,
                            borderRadius: 6, border: 'none', cursor: !connTarget ? 'not-allowed' : 'pointer',
                            background: !connTarget ? '#e2e8f0' : connCreating ? '#94a3b8' : '#16a34a',
                            color: !connTarget ? '#94a3b8' : '#fff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                          {connCreating ? '⏳...' : !connTarget ? 'Target select করুন ↑' : (
                            <>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                              Connect {port}{connCore ? ` (${connCore})` : ''}
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SplitterPortPanel ───────────────────────────────────────────────────────
// SPLITTER node-এ click করলে NodeActionCard-এর main view-এ এই panel দেখাবে।
//
// বাস্তব ISP topology:
//   OLT / Router / BOX → fiber → Splitter (IN) → fiber → Client (Out-1..N)
//
// Splitter কখনো JB-এর ভিতরে নয় — এটি map-এ independent network device।
// IN  port : upstream (OLT/Router/BOX) থেকে একটি fiber core আসে।
// OUT ports: প্রতিটি output client/ONT-এ যায়।
function SplitterPortPanel({ splitter, allLinks, allNodes, clientMarkers = [],
    onLinkCreated, onLinkUpdated, onNodeCreated }) {

  const [connectingPort, setConnectingPort] = useState(null);
  const [connTarget,     setConnTarget]     = useState('');
  const [connCore,       setConnCore]       = useState('');
  const [creating,       setCreating]       = useState(false);
  const [editingInCore,  setEditingInCore]  = useState(false);
  const [patchingCore,   setPatchingCore]   = useState(false);

  const sp       = getSplitterPorts(splitter.splitter_ratio);
  const usedPorts = getUsedPorts(splitter.id, allLinks);
  const freeOut   = sp.out.filter(p => !usedPorts.has(p)).length;

  // Dynamic clients — NetworkNode ছাড়া GPS-সহ clients
  const spExistingClientIds = new Set(allNodes.filter(n => n.client).map(n => n.client));
  const spDynClients = clientMarkers.filter(c => !spExistingClientIds.has(c.id));

  // IN port link — upstream থেকে আসা fiber (target_port='In' অথবা source_port='In')
  const inLink = allLinks.find(lk =>
    (lk.target_node === splitter.id && lk.target_port === 'In') ||
    (lk.source_node === splitter.id && lk.source_port === 'In')
  );
  const inPeer     = inLink
    ? (inLink.target_node === splitter.id ? inLink.source_node_name : inLink.target_node_name)
    : null;
  const inPeerType = inLink
    ? (inLink.target_node === splitter.id ? inLink.source_node_type : inLink.target_node_type)
    : null;
  const inCoreName = inLink?.fiber_core_color?.split(/[,→\-–]/)[0]?.trim();
  const inCoreObj  = inCoreName
    ? FIBER_BASE_COLORS.find(c => c.name.toLowerCase() === inCoreName.toLowerCase())
    : null;

  // OUT port → connected link
  const getOutLink = (port) => allLinks.find(lk =>
    (lk.source_node === splitter.id && lk.source_port === port) ||
    (lk.target_node === splitter.id && lk.target_port === port)
  );

  // IN port fiber core পরিবর্তন
  const handleAssignInCore = async (newCore) => {
    if (!inLink || patchingCore) return;
    setPatchingCore(true);
    try {
      const res = await api.patch(`/network/links/${inLink.id}/`, { fiber_core_color: newCore });
      onLinkUpdated && onLinkUpdated(res.data);
      setEditingInCore(false);
      toast.success(`Core "${newCore}" assigned.`);
    } catch { toast.error('Core assignment failed.'); }
    finally { setPatchingCore(false); }
  };

  // Port connect handler — IN বা OUT-N
  const handleConnect = async (port) => {
    if (!connTarget) return toast.error('Node / Client select করুন।');
    const isIn = port === 'In';

    let target = allNodes.find(n => String(n.id) === connTarget);

    // Dynamic client auto-create
    if (!target && String(connTarget).startsWith('dyn-')) {
      const cId  = parseInt(connTarget.replace('dyn-', ''));
      const dyn  = spDynClients.find(c => c.id === cId);
      if (!dyn) return toast.error('Client not found.');
      setCreating(true);
      try {
        const nr = await api.post('/network/nodes/', {
          name: dyn.full_name, node_type: 'CLIENT',
          latitude: dyn.latitude, longitude: dyn.longitude,
          client: dyn.id, status: dyn.status === 'active' ? 'active' : 'inactive',
        });
        target = nr.data;
        onNodeCreated && onNodeCreated(nr.data);
      } catch {
        setCreating(false);
        return toast.error('Client node তৈরি ব্যর্থ।');
      }
    }

    if (!target) return;
    setCreating(true);
    try {
      const src = isIn ? target    : splitter;
      const tgt = isIn ? splitter  : target;
      const paths = src.latitude && tgt.latitude ? [
        { lat: parseFloat(src.latitude), lng: parseFloat(src.longitude) },
        { lat: parseFloat(tgt.latitude), lng: parseFloat(tgt.longitude) },
      ] : undefined;

      const res = await api.post('/network/links/', {
        source_node:      src.id,
        target_node:      tgt.id,
        source_port:      isIn ? undefined : port,
        target_port:      isIn ? 'In' : (target.node_type === 'CLIENT' ? 'ONT' : undefined),
        link_type:        'FIBER',
        color_code:       '#00bcd4',
        status:           'active',
        fiber_core_color: connCore || undefined,
        paths,
      });
      onLinkCreated && onLinkCreated(res.data);
      toast.success(`${isIn ? 'Upstream' : port} ↔ ${target.name} connected!`);
      setConnectingPort(null); setConnTarget(''); setConnCore('');
    } catch (err) {
      const msg = err?.response?.data
        ? Object.entries(err.response.data).map(([k,v])=>`${k}: ${[v].flat().join(', ')}`).join(' | ')
        : 'Connection failed.';
      toast.error(msg.slice(0, 150));
    } finally { setCreating(false); }
  };

  const spSecLbl = { fontSize: 9, color: '#64748b', fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 };
  const coreChipStyle = (isActive, hex, border) => ({
    width: 22, height: 22, borderRadius: 4, cursor: 'pointer', flexShrink: 0,
    background: hex, border: isActive ? '3px solid #0f172a' : `2px solid ${border || hex}`,
    boxShadow: isActive ? '0 0 0 2px #0891b2' : 'none',
    transform: isActive ? 'scale(1.12)' : 'scale(1)', transition: 'all 0.1s',
  });

  // ── Connect form (shared) ────────────────────────────────────────────────────
  const ConnectForm = ({ port, isIn }) => {
    const upTypes = ['ROUTER', 'OLT', 'BOX'];
    const targetNodes = allNodes.filter(n => {
      if (n.id === splitter.id || !n.latitude || !n.longitude) return false;
      if (isIn) return upTypes.includes(n.node_type);
      if (n.node_type === 'CLIENT')
        return !allLinks.some(l => l.source_node === n.id || l.target_node === n.id);
      return !['CLIENT', 'SPLITTER'].includes(n.node_type) || n.node_type === 'SPLITTER';
    });
    return (
      <div style={{ background:'#f0fdf4', borderRadius:7, padding:'8px 9px',
          border:'1px solid #86efac', marginTop:4 }}>
        <div style={{ fontSize:9, color:'#15803d', fontWeight:700, marginBottom:7,
            display:'flex', justifyContent:'space-between' }}>
          <span>🔗 {isIn ? 'Connect Upstream (OLT / Router / BOX)' : `Connect ${port}`}</span>
          <button onClick={e=>{e.stopPropagation(); setConnectingPort(null); setConnTarget(''); setConnCore('');}}
            style={{fontSize:9,border:'none',background:'none',color:'#94a3b8',cursor:'pointer'}}>✕</button>
        </div>

        {/* Target */}
        <div style={{marginBottom:6}}>
          <div style={{...spSecLbl, marginBottom:3}}>
            {isIn ? 'Upstream (OLT / Router / BOX)' : 'Client / Node'}
          </div>
          <select value={connTarget}
            onChange={e=>{e.stopPropagation(); setConnTarget(e.target.value);}}
            onClick={e=>e.stopPropagation()}
            style={{width:'100%', border:'1px solid #86efac', borderRadius:5,
              padding:'4px 7px', fontSize:10, outline:'none', background:'#fff', color:'#1e293b'}}>
            <option value="">-- Select --</option>
            {targetNodes.map(n => {
              const ns = NODE_STYLE[n.node_type]||{letter:'?'};
              return <option key={n.id} value={String(n.id)}>[{ns.letter}] {n.name}</option>;
            })}
            {!isIn && spDynClients.length > 0 && <option disabled>── Clients (GPS) ──</option>}
            {!isIn && spDynClients.map(c => (
              <option key={`dyn-${c.id}`} value={`dyn-${c.id}`}>
                [C] {c.full_name} ({c.customer_id})
              </option>
            ))}
          </select>
        </div>

        {/* Fiber core chips */}
        <div style={{marginBottom:6}}>
          <div style={{...spSecLbl, marginBottom:3}}>Fiber Core (optional)</div>
          <div style={{display:'flex', flexWrap:'wrap', gap:3}}>
            {FIBER_CORE_12.map(c => (
              <button key={c.name} type="button" title={c.name}
                onClick={e=>{e.stopPropagation(); setConnCore(connCore===c.name?'':c.name);}}
                style={coreChipStyle(connCore===c.name, c.hex, c.border)} />
            ))}
          </div>
          {connCore && <div style={{fontSize:9, color:'#0891b2', marginTop:2, fontWeight:600}}>✓ {connCore}</div>}
        </div>

        {/* Button */}
        <button onClick={e=>{e.stopPropagation(); handleConnect(port);}}
          disabled={creating || !connTarget}
          style={{width:'100%', padding:'7px', fontSize:10, fontWeight:700, borderRadius:6,
            border:'none', cursor: !connTarget?'not-allowed':'pointer',
            background: !connTarget?'#e2e8f0': creating?'#94a3b8':'#16a34a',
            color: !connTarget?'#94a3b8':'#fff',
            display:'flex', alignItems:'center', justifyContent:'center', gap:5}}>
          {creating ? '⏳...' : !connTarget ? 'Select করুন ↑' : (
            <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>Connect{connCore?` (${connCore})`:''}</>
          )}
        </button>
      </div>
    );
  };

  return (
    <div style={{marginTop:10, borderTop:'2px dashed #e0f2fe', paddingTop:10}}>

      {/* Header */}
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8}}>
        <div style={{fontSize:9, color:'#0891b2', fontWeight:700,
            textTransform:'uppercase', letterSpacing:1, display:'flex', alignItems:'center', gap:5}}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="2" x2="12" y2="9.5"/>
            <line x1="12" y1="9.5" x2="4"  y2="21"/>
            <line x1="12" y1="9.5" x2="12" y2="21"/>
            <line x1="12" y1="9.5" x2="20" y2="21"/>
          </svg>
          OPTICAL SPLITTER PORTS
        </div>
        <span style={{fontSize:9, fontWeight:700,
            color: freeOut>0?'#16a34a':'#ef4444',
            background: freeOut>0?'#dcfce7':'#fee2e2',
            borderRadius:4, padding:'1px 6px'}}>
          {freeOut}/{sp.out.length} free
        </span>
      </div>

      {/* ══ INPUT (In) port ════════════════════════════════════════════════════ */}
      <div style={{marginBottom:10}}>
        <div style={spSecLbl}>📥 Input (In) — OLT / Router / BOX থেকে fiber আসে</div>

        {inLink ? (
          <div style={{background:'#f0f9ff', borderRadius:7, padding:'6px 9px', border:'1px solid #bae6fd'}}>
            <div style={{display:'flex', alignItems:'center', gap:6}}>
              <div style={{width:14, height:14, borderRadius:3, flexShrink:0,
                  background: NODE_STYLE[inPeerType]?.bg || '#374151',
                  display:'flex', alignItems:'center', justifyContent:'center'}}
                dangerouslySetInnerHTML={{__html: getNodeSvg(inPeerType, 9, 9)}}
              />
              <span style={{fontSize:11, fontWeight:700, color:'#0f172a', flex:1}}>{inPeer}</span>
              {inCoreObj && (
                <div style={{width:10, height:10, borderRadius:2, flexShrink:0,
                    background:inCoreObj.hex, border:`1.5px solid ${inCoreObj.border||inCoreObj.hex}`}} />
              )}
              <span style={{fontSize:9, color:'#0891b2', fontWeight:600,
                  background:'#e0f2fe', borderRadius:3, padding:'1px 5px', flexShrink:0}}>
                {inCoreName || 'no core'}
              </span>
              <button onClick={e=>{e.stopPropagation(); setEditingInCore(v=>!v);}}
                style={{fontSize:9, padding:'1px 6px', borderRadius:4, cursor:'pointer', flexShrink:0,
                  border:'1px solid #bae6fd', background:'#f0f9ff', color:'#0369a1', fontWeight:700}}>
                {editingInCore ? 'Cancel' : 'Core ✏️'}
              </button>
            </div>
            {editingInCore && (
              <div style={{marginTop:7, paddingTop:7, borderTop:'1px solid #e0f2fe'}}>
                <div style={{fontSize:8, color:'#64748b', fontWeight:600, marginBottom:5}}>
                  Core select করুন:
                </div>
                <div style={{display:'flex', flexWrap:'wrap', gap:3}}>
                  {FIBER_CORE_12.map(c => (
                    <button key={c.name} type="button" title={c.name}
                      onClick={e=>{e.stopPropagation(); if(!patchingCore) handleAssignInCore(c.name);}}
                      disabled={patchingCore}
                      style={coreChipStyle(inCoreName===c.name, c.hex, c.border)} />
                  ))}
                </div>
                {patchingCore && <div style={{fontSize:9, color:'#0891b2', marginTop:3}}>⏳ Assigning...</div>}
              </div>
            )}
          </div>
        ) : connectingPort === 'In' ? (
          <ConnectForm port="In" isIn={true} />
        ) : (
          <div style={{display:'flex', alignItems:'center', gap:6, background:'#fafafa',
              borderRadius:6, padding:'5px 9px', border:'1px dashed #e2e8f0'}}>
            <span style={{fontSize:10, color:'#94a3b8', flex:1, fontStyle:'italic'}}>
              Not connected — OLT / Router connect করুন
            </span>
            <button onClick={e=>{e.stopPropagation();
                setConnectingPort('In'); setConnTarget(''); setConnCore('');}}
              style={{fontSize:9, padding:'2px 8px', borderRadius:5, cursor:'pointer',
                border:'1px solid #bae6fd', background:'#f0f9ff', color:'#0369a1', fontWeight:700}}>
              + Connect
            </button>
          </div>
        )}
      </div>

      {/* ══ OUTPUT ports ═══════════════════════════════════════════════════════ */}
      <div>
        <div style={spSecLbl}>📤 Output Ports — Client / ONT-এ connect করুন</div>
        <div style={{display:'flex', flexDirection:'column', gap:4}}>
          {sp.out.map(port => {
            const conn = getOutLink(port);
            if (conn) {
              const isOut   = conn.source_node === splitter.id;
              const pName   = isOut ? conn.target_node_name : conn.source_node_name;
              const pType   = isOut ? conn.target_node_type : conn.source_node_type;
              const pSt     = NODE_STYLE[pType] || { bg:'#374151' };
              const pNode   = allNodes.find(n => n.id === (isOut ? conn.target_node : conn.source_node));
              const sc      = STATUS_COLOR[pNode?.status] || '#6b7280';
              const cn      = conn.fiber_core_color?.split(/[,→\-–]/)[0]?.trim();
              const co      = cn ? FIBER_BASE_COLORS.find(c => c.name.toLowerCase() === cn.toLowerCase()) : null;
              return (
                <div key={port} style={{display:'flex', alignItems:'center', gap:5,
                    padding:'4px 7px', borderRadius:5, background:'#f0fdf4', border:'1px solid #bbf7d0'}}>
                  <code style={{fontSize:9, color:'#0369a1', background:'#dbeafe',
                      borderRadius:3, padding:'1px 5px', flexShrink:0}}>{port}</code>
                  {co && <div style={{width:9, height:9, borderRadius:1, flexShrink:0,
                      background:co.hex, border:`1.5px solid ${co.border||co.hex}`}} />}
                  <div style={{width:13, height:13, borderRadius:3, flexShrink:0,
                      background:pSt.bg, display:'flex', alignItems:'center', justifyContent:'center'}}
                    dangerouslySetInnerHTML={{__html: getNodeSvg(pType, 8, 8)}}
                  />
                  <span style={{fontSize:10, fontWeight:600, color:'#0f172a', flex:1, minWidth:0,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{pName}</span>
                  <span style={{fontSize:8, color:sc, flexShrink:0}}>● {pNode?.status||'?'}</span>
                </div>
              );
            }
            return (
              <div key={port}>
                {connectingPort !== port ? (
                  <div style={{display:'flex', alignItems:'center', gap:5, padding:'4px 7px',
                      borderRadius:5, background:'#f8fafc', border:'1px dashed #e2e8f0'}}>
                    <code style={{fontSize:9, color:'#64748b', background:'#f1f5f9',
                        borderRadius:3, padding:'1px 5px', flexShrink:0}}>{port}</code>
                    <span style={{fontSize:9, color:'#16a34a', flex:1}}>— (free)</span>
                    <button onClick={e=>{e.stopPropagation();
                        setConnectingPort(port); setConnTarget(''); setConnCore('');}}
                      style={{fontSize:9, padding:'1px 8px', borderRadius:4, cursor:'pointer',
                        border:'1px solid #86efac', background:'#f0fdf4', color:'#16a34a', fontWeight:700}}>
                      + Connect
                    </button>
                  </div>
                ) : (
                  <ConnectForm port={port} isIn={false} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── JoinBoxPanel ────────────────────────────────────────────────────────────
// BOX node-এর cable junction + mandatory Splitter management + downstream tree.
// Rule: Splitter শুধু JB-এর ভিতরেই add করা যাবে।
function JoinBoxPanel({ node, allLinks, allNodes, clientMarkers = [], onLinkCreated, onNodeCreated, onLinkUpdated, onNodeUpdated, onNodeDeleted }) {
  const allJBLinks = allLinks.filter(l =>
    l.source_node === node.id || l.target_node === node.id
  );

  // Side assignment — default: incoming (target=JB)→A, outgoing (source=JB)→B
  const [sideMap, setSideMap] = useState(() => {
    const m = {};
    allJBLinks.forEach(l => { m[l.id] = l.target_node === node.id ? 'A' : 'B'; });
    return m;
  });

  const [showDownstream,    setShowDownstream]    = useState(false);
  const [showCableJunction, setShowCableJunction] = useState(true);  // CABLE JUNCTION section
  const [showCoreConns,     setShowCoreConns]     = useState(true);  // CORE CONNECTIONS section
  const [showSplitters,     setShowSplitters]     = useState(true);  // SPLITTERS INSIDE JB section
  // CableRow-এর fiber core toggle — link.id → boolean
  // CableRow inner component-এ useState ব্যবহার করা যায় না (Rules of Hooks),
  // তাই parent JoinBoxPanel-এ map হিসেবে track করা হচ্ছে।
  const [coreOpenMap, setCoreOpenMap] = useState({});

  // Add Splitter form state — JB-এর ভেতরে Splitter যোগ করার form
  const [splitterName,      setSplitterName]     = useState('');
  const [splitterRatio,     setSplitterRatio]    = useState('1:4');
  const [splitterCoreColor, setSplitterCoreColor] = useState('');
  const [creating,          setCreating]         = useState(false);
  const [showSplForm,       setShowSplForm]      = useState(false);

  // Add Fiber Cable form state — BOX থেকে upstream (OLT/Router) cable যোগ করার form
  const [showCableForm,  setShowCableForm]  = useState(false);
  const [cableTargetId,  setCableTargetId]  = useState('');
  const [cableType,      setCableType]      = useState('FIBER');
  const [cableCoreCount, setCableCoreCount] = useState(12);
  const [cableSrcPort,   setCableSrcPort]   = useState('');
  const [cableDstPort,   setCableDstPort]   = useState('');
  const [cableSrcCore,   setCableSrcCore]   = useState('');
  const [cableCreating,  setCableCreating]  = useState(false);

  const toggleSide = (id) =>
    setSideMap(prev => ({ ...prev, [id]: prev[id] === 'A' ? 'B' : 'A' }));

  const sideA = allJBLinks.filter(l => sideMap[l.id] === 'A');
  const sideB = allJBLinks.filter(l => sideMap[l.id] === 'B');
  const aUsed = parseUsedCores(sideA);
  const bUsed = parseUsedCores(sideB);
  const throughCores = [...aUsed].filter(c => bUsed.has(c));
  const aOnlyCores   = [...aUsed].filter(c => !bUsed.has(c));
  const bOnlyCores   = [...bUsed].filter(c => !aUsed.has(c));

  // Splitter connections — শুধু BOX → Splitter direction (source=BOX, target=Splitter)।
  // Splitter → BOX direction (upstream cable) "inside JB" নয় — বাদ দেওয়া হচ্ছে।
  // Insert Join Box করলে নতুন BOX-এ upstream Splitter-এর cable আসে (Splitter→BOX),
  // সেটা ভুলভাবে "inside" দেখানো উচিত নয়।
  const splitterLinks = allJBLinks.filter(l => {
    if (l.source_node !== node.id) return false; // BOX অবশ্যই source হতে হবে
    return allNodes.find(n => n.id === l.target_node)?.node_type === 'SPLITTER';
  });
  const hasSplitter = splitterLinks.length > 0;

  // JB-এর upstream fiber cables (splitter link বাদে)
  const nonSplFiber = allJBLinks.filter(l =>
    l.link_type === 'FIBER' && !splitterLinks.some(sl => sl.id === l.id)
  );
  const hasFiberCable = nonSplFiber.length > 0;

  // Splitter form-এর core picker-এ দেখানোর জন্য available cores
  const branchableCores = (() => {
    const seen = new Set();
    const result = [];
    nonSplFiber.forEach(l => {
      if (l.fiber_core_count) {
        generateFiberCores(Math.min(l.fiber_core_count, 144)).forEach(c => {
          if (!seen.has(c.name)) { seen.add(c.name); result.push(c.name); }
        });
      } else if (l.fiber_core_color) {
        parseUsedCores([l]).forEach(cn => {
          if (!seen.has(cn)) { seen.add(cn); result.push(cn); }
        });
      }
    });
    return result;
  })();

  const getCorObj = n => FIBER_BASE_COLORS.find(c => c.name.toLowerCase() === n.toLowerCase());

  // Dynamic clients — NodeActionCard-এ প্রয়োজন নেই — JB-তে শুধু upstream fiber
  const existingClientNodeIds = new Set(allNodes.filter(n => n.client).map(n => n.client));
  const dynClients = clientMarkers.filter(c => !existingClientNodeIds.has(c.id));

  // ── Upstream Fiber Cable যোগ করার handler — BOX থেকে OLT/Router/BOX-এ link ──
  const handleAddSplitter = async () => {
    if (!splitterName.trim()) return toast.error('Splitter name দিন।');
    setCreating(true);
    try {
      // Splitter JB-এর exact coordinates-এ তৈরি হবে (same location — JB-এর ভেতরে)
      const splRes = await api.post('/network/nodes/', {
        name: splitterName.trim(), node_type: 'SPLITTER',
        splitter_ratio: splitterRatio,
        latitude:  node.latitude,
        longitude: node.longitude,
        status: 'active',
      });
      const spl = splRes.data;
      onNodeCreated && onNodeCreated(spl);
      const lRes = await api.post('/network/links/', {
        source_node: node.id, target_node: spl.id,
        link_type: 'FIBER', color_code: '#00bcd4', status: 'active',
        fiber_core_color: splitterCoreColor || undefined,
        target_port: 'In',
        paths: [
          { lat: parseFloat(node.latitude), lng: parseFloat(node.longitude) },
          { lat: parseFloat(spl.latitude),  lng: parseFloat(spl.longitude)  },
        ],
      });
      onLinkCreated && onLinkCreated(lRes.data);
      toast.success(`🔀 Splitter "${spl.name}" added inside ${node.name}!`);
      setShowSplForm(false); setSplitterName(''); setSplitterCoreColor('');
    } catch (err) {
      const msg = err?.response?.data
        ? Object.entries(err.response.data).map(([k,v])=>`${k}: ${[v].flat().join(', ')}`).join(' | ')
        : 'Failed.';
      toast.error(msg.slice(0, 150));
    } finally { setCreating(false); }
  };

  // Upstream fiber cable যোগ করার handler — শুধু OLT/Router/BOX target
  const handleAddFiberCable = async () => {
    if (!cableTargetId) return toast.error('Upstream node select করুন।');
    const target = allNodes.find(n => String(n.id) === String(cableTargetId));
    if (!target) return;
    setCableCreating(true);
    try {
      const res = await api.post('/network/links/', {
        source_node:      target.id,   // upstream → JB (direction: OLT → BOX)
        target_node:      node.id,
        link_type:        cableType,
        color_code:       LINK_DEFAULT_COLOR[cableType] || '#00bcd4',
        status:           'active',
        source_port:      cableDstPort  || undefined,
        target_port:      cableSrcPort  || undefined,
        fiber_core_color: cableSrcCore  || undefined,
        fiber_core_count: cableType === 'FIBER' ? cableCoreCount : undefined,
        paths: [
          { lat: parseFloat(target.latitude), lng: parseFloat(target.longitude) },
          { lat: parseFloat(node.latitude),   lng: parseFloat(node.longitude) },
        ],
      });
      onLinkCreated && onLinkCreated(res.data);
      toast.success(`✅ ${target.name} → ${node.name} cable connected!`);
      setShowCableForm(false);
      setCableTargetId(''); setCableSrcPort(''); setCableDstPort('');
      setCableSrcCore(''); setCableCoreCount(12); setCableType('FIBER');
    } catch (err) {
      const msg = err?.response?.data
        ? Object.entries(err.response.data).map(([k,v])=>`${k}: ${[v].flat().join(', ')}`).join(' | ')
        : 'Failed.';
      toast.error(msg.slice(0, 150));
    } finally { setCableCreating(false); }
  };

  const secLabel = { fontSize: 10, color: '#475569', fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.06em' };

  // Core chip click → Add Splitter form-এ সেই core pre-fill হবে
  // FTTH/ODN: প্রতিটি core মূল্যবান — signal core বা free core যেকোনোটিই
  // নতুন Splitter-এর IN port-এ route করা যাবে।
  const quickRouteCoreToSplitter = (e, coreName) => {
    e.stopPropagation();
    setSplitterName(prev => prev.trim() || `SP-${splitterLinks.length + 1}`);
    setSplitterCoreColor(coreName);
    setShowSplForm(true);
    setShowCableForm(false);
    // scroll the popup down slightly so form is visible
    setTimeout(() => {
      document.querySelector('.leaflet-popup-content')
        ?.scrollTo({ top: 9999, behavior: 'smooth' });
    }, 80);
  };

  const CableRow = ({ link }) => {
    const showCores = coreOpenMap[link.id] ?? false;
    const toggleCores = (e) => {
      e.stopPropagation();
      setCoreOpenMap(prev => ({ ...prev, [link.id]: !prev[link.id] }));
    };
    const isOut   = link.source_node === node.id;
    const pName   = isOut ? link.target_node_name : link.source_node_name;
    const pType   = isOut ? link.target_node_type : link.source_node_type;
    const pPort   = isOut ? link.target_port      : link.source_port;
    const myPort  = isOut ? link.source_port      : link.target_port;
    const pSt     = NODE_STYLE[pType] || { bg: '#374151' };
    const side    = sideMap[link.id] || 'B';
    const sideCol = side === 'A' ? '#0891b2' : '#16a34a';
    const sideBg  = side === 'A' ? '#f0f9ff'  : '#f0fdf4';
    const sideBdr = side === 'A' ? '#bae6fd'  : '#86efac';
    const used    = parseUsedCores([link]);
    const cores   = link.fiber_core_count
      ? generateFiberCores(Math.min(link.fiber_core_count, 96)) : [];
    const freeCores = cores.filter(c => !used.has(c.name));
    const usedCores = cores.filter(c =>  used.has(c.name));

    return (
      <div style={{ borderRadius:7, marginBottom:6, border:`1.5px solid ${sideBdr}`, overflow:'hidden' }}>

        {/* ── Header — 2 row layout ── */}
        <div style={{ background:sideBg }}>

          {/* Row 1: side btn + direction + icon + FULL name + toggle */}
          <div style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 8px 3px',
              cursor: cores.length > 0 ? 'pointer' : 'default' }}
            onClick={e => { e.stopPropagation(); if (cores.length > 0) toggleCores(e); }}>
            {/* A/B side button — clicks only toggle side, not expand */}
            <button onClick={e => { e.stopPropagation(); toggleSide(link.id); }}
              title="Switch A/B"
              style={{ width:22, height:22, borderRadius:5, flexShrink:0, cursor:'pointer',
                border:'none', fontWeight:900, fontSize:11, background:sideCol, color:'#fff' }}>
              {side}
            </button>
            {/* Direction */}
            <span style={{ fontSize:10, color:sideCol, fontWeight:800, flexShrink:0 }}>
              {isOut ? '▶' : '◀'}
            </span>
            {/* Node type badge */}
            <span style={{ fontSize:8, color:sideCol, fontWeight:700, flexShrink:0,
                background:`${sideCol}18`, borderRadius:3, padding:'1px 4px', textTransform:'uppercase' }}>
              {isOut ? 'OUT' : 'IN'}
            </span>
            {/* Node icon */}
            <div style={{ width:17, height:17, borderRadius:4, flexShrink:0, background:pSt.bg,
                display:'flex', alignItems:'center', justifyContent:'center' }}
              dangerouslySetInnerHTML={{ __html: getNodeSvg(pType, 11, 11) }}
            />
            {/* Full peer name — no truncation */}
            <span style={{ fontSize:12, fontWeight:700, color:'#0f172a', flex:1, minWidth:0 }}>
              {pName}
            </span>
            {/* Expand/collapse indicator */}
            {cores.length > 0 && (
              <span style={{ fontSize:9, color:'#94a3b8', flexShrink:0, userSelect:'none' }}>
                {showCores ? '▲' : '▼'}
              </span>
            )}
          </div>

          {/* Row 2: port badges + core count + tiny core chips + free count */}
          <div style={{ display:'flex', alignItems:'center', gap:4, padding:'0 8px 5px 30px',
              cursor: cores.length > 0 ? 'pointer' : 'default', flexWrap:'wrap' }}
            onClick={e => { e.stopPropagation(); if (cores.length > 0) toggleCores(e); }}>
            {myPort && <code style={{ fontSize:9, color:'#0369a1', background:'#dbeafe', borderRadius:3, padding:'0 4px', flexShrink:0 }}>{myPort}</code>}
            {myPort && pPort && <span style={{ fontSize:9, color:'#94a3b8' }}>→</span>}
            {pPort && <code style={{ fontSize:9, color:'#15803d', background:'#dcfce7', borderRadius:3, padding:'0 4px', flexShrink:0 }}>{pPort}</code>}
            {link.fiber_core_count && (
              <span style={{ fontSize:9, fontFamily:'monospace', fontWeight:700,
                  color:'#0891b2', background:'#e0f2fe', borderRadius:3, padding:'0 4px', flexShrink:0 }}>
                {link.fiber_core_count}C
              </span>
            )}
            {cores.length > 0 && (
              <>
                <div style={{ display:'flex', gap:1 }}>
                  {cores.slice(0,8).map(c => {
                    const isUsed = used.has(c.name);
                    const isThr  = throughCores.includes(c.name);
                    return (
                      <div key={c.name} style={{ width:9, height:9, borderRadius:2,
                          background: c.hex,
                          border: isThr ? '1.5px solid #0891b2' : isUsed ? `1px solid ${c.border||c.hex}` : `1px dashed ${c.border||c.hex}`,
                          opacity: isUsed ? 1 : 0.55 }} />
                    );
                  })}
                  {cores.length > 8 && <span style={{ fontSize:7, color:'#94a3b8' }}>+{cores.length-8}</span>}
                </div>
                {freeCores.length > 0 && (
                  <span style={{ fontSize:9, color:'#16a34a', fontWeight:700, background:'#dcfce7',
                      borderRadius:3, padding:'0 4px' }}>
                    {freeCores.length} free
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Expanded core detail (toggle) ── */}
        {showCores && cores.length > 0 && (
          <div style={{ padding:'7px 10px', background:'#fff', borderTop:`1px solid ${sideBdr}` }}>
            {/* Summary */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
              <span style={{ fontSize:10, color:'#475569', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em' }}>
                Fiber Cores
              </span>
              <div style={{ display:'flex', gap:4 }}>
                {usedCores.length > 0 && <span style={{ fontSize:9, fontWeight:700, color:'#dc2626', background:'#fee2e2', borderRadius:4, padding:'1px 6px' }}>{usedCores.length} used</span>}
                {freeCores.length > 0 && <span style={{ fontSize:9, fontWeight:700, color:'#16a34a', background:'#dcfce7', borderRadius:4, padding:'1px 6px' }}>{freeCores.length} free</span>}
              </div>
            </div>
            {/* Core chips — clickable */}
            <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginBottom:7 }}>
              {cores.map(c => {
                const isUsed = used.has(c.name);
                const isThr  = throughCores.includes(c.name);
                return (
                  <button key={c.name} type="button"
                    title={`${c.name} — ${isUsed ? (isThr ? 'splice' : 'signal') : 'FREE'}: click → Splitter`}
                    onClick={e => quickRouteCoreToSplitter(e, c.name)}
                    style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2,
                      background:'none', border:'none', cursor:'pointer', padding:0 }}>
                    <div style={{ width:22, height:22, borderRadius:4, position:'relative',
                        background: c.hex,
                        border: isThr ? '2.5px solid #0891b2' : isUsed ? `2px solid ${c.border||c.hex}` : `1.5px dashed ${c.border||c.hex}`,
                        opacity: isUsed ? 1 : 0.72,
                        boxShadow: isThr ? '0 0 0 2px #bae6fd' : isUsed ? `0 2px 5px ${c.hex}55` : 'none' }}>
                      {!isUsed && <div style={{ position:'absolute', top:1, left:2, fontSize:8, color:'rgba(255,255,255,0.9)', fontWeight:900 }}>f</div>}
                      {isUsed && !isThr && <div style={{ position:'absolute', bottom:-2, right:-2, width:9, height:9, borderRadius:'50%', background:'#d97706', border:'1.5px solid #fff', display:'flex', alignItems:'center', justifyContent:'center' }}><span style={{ fontSize:6, color:'#fff', fontWeight:900 }}>↓</span></div>}
                      {isThr && <div style={{ position:'absolute', bottom:-2, right:-2, width:9, height:9, borderRadius:'50%', background:'#0891b2', border:'1.5px solid #fff', display:'flex', alignItems:'center', justifyContent:'center' }}><span style={{ fontSize:6, color:'#fff', fontWeight:900 }}>↔</span></div>}
                    </div>
                    <span style={{ fontSize:8, fontWeight:700, color:'#475569', whiteSpace:'nowrap' }}>{c.name.length>5?c.name.substring(0,5):c.name}</span>
                    <span style={{ fontSize:7, color: isUsed?(isThr?'#0891b2':'#d97706'):'#16a34a', whiteSpace:'nowrap' }}>{isUsed?(isThr?'splice':'signal'):'free'}</span>
                  </button>
                );
              })}
            </div>
            {/* Compact action buttons */}
            <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
              {usedCores.filter(c => !throughCores.includes(c.name)).map(c => {
                const co = getCorObj(c.name);
                return (
                  <button key={c.name} type="button" onClick={e => quickRouteCoreToSplitter(e, c.name)}
                    style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 8px',
                      background:'#fffbeb', borderRadius:5, cursor:'pointer',
                      border:'1px solid #fcd34d', fontSize:10, fontWeight:600, color:'#92400e', width:'100%' }}>
                    {co && <div style={{ width:10, height:10, borderRadius:2, flexShrink:0, background:co.hex, border:`1.5px solid ${co.border||co.hex}` }} />}
                    <span style={{ flex:1 }}>🔀 <strong>{c.name}</strong> → Splitter IN</span>
                    <span style={{ fontSize:9, color:'#d97706', fontWeight:700, background:'#fef3c7', borderRadius:3, padding:'0 5px' }}>+ Splitter</span>
                  </button>
                );
              })}
              {freeCores.length > 0 && (
                <button type="button" onClick={e => quickRouteCoreToSplitter(e, freeCores[0].name)}
                  style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 8px',
                    background:'#f0fdf4', borderRadius:5, cursor:'pointer',
                    border:'1px solid #bbf7d0', fontSize:10, fontWeight:600, color:'#15803d', width:'100%' }}>
                  <div style={{ display:'flex', gap:2 }}>
                    {freeCores.slice(0,3).map(fc => { const fo = getCorObj(fc.name); return fo ? <div key={fc.name} style={{ width:9, height:9, borderRadius:2, background:fo.hex, border:`1.5px solid ${fo.border||fo.hex}` }} /> : null; })}
                    {freeCores.length>3 && <span style={{ fontSize:8, color:'#16a34a', fontWeight:700 }}>+{freeCores.length-3}</span>}
                  </div>
                  <span style={{ flex:1 }}>✓ <strong>{freeCores.length} free</strong> → new Splitter</span>
                  <span style={{ fontSize:9, color:'#16a34a', fontWeight:700, background:'#dcfce7', borderRadius:3, padding:'0 5px' }}>+ Splitter</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ marginTop: 6, borderTop: '1px dashed #e0f2fe', paddingTop: 7 }}>

      {/* ── CABLE JUNCTION header — click to toggle ── */}
      <button onClick={e => { e.stopPropagation(); setShowCableJunction(v => !v); }}
        style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between',
          background:'none', border:'none', cursor:'pointer', padding:0, marginBottom: showCableJunction ? 6 : 4 }}>
        <div style={{ ...secLabel, color: '#0891b2', display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="18" rx="2"/>
            <line x1="8" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="16" y2="21"/>
          </svg>
          CABLE JUNCTION
          <span style={{ fontSize:9, color:'#94a3b8', fontStyle:'italic', fontWeight:400, textTransform:'none', letterSpacing:0 }}>
            ({allJBLinks.length})
          </span>
        </div>
        <span style={{ fontSize:10, color:'#94a3b8' }}>{showCableJunction ? '▲' : '▼'}</span>
      </button>

      {/* ── Cable list ── */}
      {showCableJunction && allJBLinks.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {allJBLinks.map(l => <CableRow key={l.id} link={l} />)}
        </div>
      )}

      {/* ── Core connections — collapsible ── */}
      {(throughCores.length > 0 || aOnlyCores.length > 0 || bOnlyCores.length > 0) && (
        <div style={{ background: '#f8fafc', borderRadius: 7, padding: '6px 10px',
            border: '1px solid #e2e8f0', marginBottom: 7 }}>
          <button onClick={e => { e.stopPropagation(); setShowCoreConns(v => !v); }}
            style={{ width:'100%', display:'flex', justifyContent:'space-between', alignItems:'center',
              background:'none', border:'none', cursor:'pointer', padding:0, marginBottom: showCoreConns ? 5 : 0 }}>
            <div style={{ ...secLabel }}>Core Connections</div>
            <span style={{ fontSize:9, color:'#94a3b8' }}>{showCoreConns ? '▲' : '▼'}</span>
          </button>
          {showCoreConns && (
            <>
              {throughCores.map(cn => {
                const c = getCorObj(cn);
                return (
                  <div key={cn} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4, fontSize: 10 }}>
                    {c && <div style={{ width: 11, height: 11, borderRadius: 2, background: c.hex, border: `1.5px solid ${c.border||c.hex}`, flexShrink: 0 }} />}
                    <span style={{ color: '#374151', fontWeight: 700, minWidth: 40 }}>{cn}</span>
                    <span style={{ fontSize: 9, color: '#0891b2', background: '#e0f2fe', borderRadius: 3, padding: '0 5px', fontWeight: 700 }}>A</span>
                    <div style={{ flex: 1, height: 2, background: c?.hex || '#0891b2', borderRadius: 1, opacity: 0.4 }} />
                    <span style={{ fontSize: 9, color: '#16a34a', background: '#dcfce7', borderRadius: 3, padding: '0 5px', fontWeight: 700 }}>B</span>
                    <span style={{ fontSize: 9, color: '#0891b2', fontWeight: 700 }}>✓ splice</span>
                  </div>
                );
              })}
              {aOnlyCores.map(cn => {
                const c = getCorObj(cn);
                return (
                  <div key={cn} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4, fontSize: 10 }}>
                    {c && <div style={{ width: 11, height: 11, borderRadius: 2, background: c.hex, border: `1.5px solid ${c.border||c.hex}`, flexShrink: 0 }} />}
                    <span style={{ color: '#374151', fontWeight: 700, minWidth: 40 }}>{cn}</span>
                    <span style={{ fontSize: 9, color: '#0891b2', background: '#e0f2fe', borderRadius: 3, padding: '0 5px', fontWeight: 700 }}>A</span>
                    <span style={{ fontSize: 9, color: '#94a3b8' }}>──── (no B)</span>
                  </div>
                );
              })}
              {bOnlyCores.map(cn => {
                const c = getCorObj(cn);
                return (
                  <div key={cn} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4, fontSize: 10 }}>
                    {c && <div style={{ width: 11, height: 11, borderRadius: 2, background: c.hex, border: `1.5px solid ${c.border||c.hex}`, flexShrink: 0 }} />}
                    <span style={{ color: '#374151', fontWeight: 700, minWidth: 40 }}>{cn}</span>
                    <span style={{ fontSize: 9, color: '#94a3b8' }}>(no A) ────</span>
                    <span style={{ fontSize: 9, color: '#16a34a', background: '#dcfce7', borderRadius: 3, padding: '0 5px', fontWeight: 700 }}>B</span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}


      {/* ── Inside Splitters — JB-এর ভেতরের splitters — collapsible ── */}
      {hasSplitter && (
        <div style={{ marginBottom: 8 }}>
          <button onClick={e => { e.stopPropagation(); setShowSplitters(v => !v); }}
            style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between',
              background:'none', border:'none', cursor:'pointer', padding:0, marginBottom: showSplitters ? 5 : 0 }}>
            <div style={{ ...secLabel, color: '#15803d', display: 'flex', alignItems: 'center', gap: 5 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="2" x2="12" y2="9.5"/>
                <line x1="12" y1="9.5" x2="4"  y2="21"/>
                <line x1="12" y1="9.5" x2="12" y2="21"/>
                <line x1="12" y1="9.5" x2="20" y2="21"/>
              </svg>
              Splitters Inside JB
              <span style={{ fontSize:9, color:'#94a3b8', fontWeight:400, textTransform:'none', letterSpacing:0 }}>
                ({splitterLinks.length})
              </span>
            </div>
            <span style={{ fontSize:9, color:'#94a3b8' }}>{showSplitters ? '▲' : '▼'}</span>
          </button>
          {showSplitters && splitterLinks.map(l => {
            const peerId   = l.source_node === node.id ? l.target_node : l.source_node;
            const splitter = allNodes.find(n => n.id === peerId);
            if (!splitter) return null;
            return (
              <SplitterInsidePanel
                key={splitter.id}
                splitter={splitter}
                jbLink={l}
                allLinks={allLinks}
                allNodes={allNodes}
                clientMarkers={clientMarkers}
                jbFiberCables={nonSplFiber}
                hasFiberCable={hasFiberCable}
                onLinkUpdated={onLinkUpdated}
                onLinkCreated={onLinkCreated}
                onNodeCreated={onNodeCreated}
                onNodeUpdated={onNodeUpdated}
                onNodeDeleted={onNodeDeleted}
              />
            );
          })}
        </div>
      )}

      {/* ── Add Splitter form — CableRow core button দিয়ে trigger হয় ── */}
      {showSplForm && (
        <div style={{ background: '#fff', border: '2px solid #86efac',
            borderRadius: 10, padding: '12px 14px', marginBottom: 8,
            boxShadow: '0 4px 16px rgba(22,163,74,0.12)' }}>

          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid #f0fdf4' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ width: 28, height: 28, borderRadius: 7, background: '#16a34a',
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white"
                  strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="2" x2="12" y2="9.5"/>
                  <line x1="12" y1="9.5" x2="4"  y2="21"/>
                  <line x1="12" y1="9.5" x2="12" y2="21"/>
                  <line x1="12" y1="9.5" x2="20" y2="21"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>
                  Add Splitter
                </div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>inside {node.name}</div>
              </div>
            </div>
            <button onClick={e => { e.stopPropagation(); setShowSplForm(false); setSplitterName(''); setSplitterCoreColor(''); }}
              style={{ width: 26, height: 26, borderRadius: '50%', border: 'none',
                background: '#f1f5f9', color: '#64748b', cursor: 'pointer',
                fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700 }}>✕</button>
          </div>

          {/* Name */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase',
                letterSpacing: '0.06em', marginBottom: 5 }}>Name *</div>
            <input value={splitterName} onChange={e => setSplitterName(e.target.value)}
              onClick={e => e.stopPropagation()} placeholder="e.g. SP-1, SP-A"
              style={{ width: '100%', border: '1.5px solid #86efac', borderRadius: 7,
                padding: '8px 11px', fontSize: 13, fontWeight: 600, outline: 'none',
                background: '#fff', color: '#0f172a', boxSizing: 'border-box',
                transition: 'border-color 0.15s' }}
              onFocus={e => e.target.style.borderColor = '#16a34a'}
              onBlur={e => e.target.style.borderColor = '#86efac'}
            />
          </div>

          {/* Ratio */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase',
                letterSpacing: '0.06em', marginBottom: 7 }}>Ratio</div>

            {/* PLC */}
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, marginBottom: 5 }}>
              PLC — Symmetric
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
              {SPLITTER_PLC_RATIOS.map(r => (
                <button key={r} type="button" onClick={e => { e.stopPropagation(); setSplitterRatio(r); }}
                  style={{ padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                    fontFamily: 'monospace', cursor: 'pointer', flexShrink: 0,
                    border: splitterRatio === r ? '2px solid #16a34a' : '1.5px solid #e2e8f0',
                    background: splitterRatio === r ? '#16a34a' : '#fff',
                    color: splitterRatio === r ? '#fff' : '#475569',
                    boxShadow: splitterRatio === r ? '0 2px 6px rgba(22,163,74,0.3)' : 'none' }}>
                  {r}
                </button>
              ))}
            </div>

            {/* Tap */}
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, marginBottom: 5 }}>
              Tap — Asymmetric
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 68, overflowY: 'auto',
                padding: '4px 0' }}>
              {SPLITTER_TAP_RATIOS.map(r => (
                <button key={r} type="button" onClick={e => { e.stopPropagation(); setSplitterRatio(r); }}
                  style={{ padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                    fontFamily: 'monospace', cursor: 'pointer', flexShrink: 0,
                    border: splitterRatio === r ? '2px solid #0891b2' : '1.5px solid #e2e8f0',
                    background: splitterRatio === r ? '#0891b2' : '#fff',
                    color: splitterRatio === r ? '#fff' : '#475569' }}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          {/* Fiber core — এই Splitter-এর IN port কোন core পাবে */}
          {branchableCores.length > 0 && (() => {
            // শুধু BOX→InternalSplitter direction-এর links থেকে assigned cores।
            // Upstream Splitter→BOX incoming cable-এর core "assigned" নয় —
            // সেটা incoming signal যা নতুন Splitter-এও ব্যবহার করা যাবে।
            const assignedToInternalSpl = parseUsedCores(
              allLinks.filter(l =>
                l.source_node === node.id &&
                allNodes.find(n => n.id === l.target_node)?.node_type === 'SPLITTER'
              )
            );

            // Incoming cables-এর cores — এগুলো signal বহন করছে (পরামর্শ দেওয়া হবে)
            const incomingCores = parseUsedCores(
              allLinks.filter(l => l.target_node === node.id && l.link_type === 'FIBER')
            );

            const freeCount = branchableCores.filter(cn => !assignedToInternalSpl.has(cn)).length;

            return (
              <div style={{ marginBottom: 10 }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginBottom: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#475569',
                      textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Cable Core — Splitter IN port
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 5, padding: '2px 8px',
                      color: freeCount > 0 ? '#16a34a' : '#ef4444',
                      background: freeCount > 0 ? '#dcfce7' : '#fee2e2',
                      border: `1px solid ${freeCount > 0 ? '#86efac' : '#fca5a5'}` }}>
                    {freeCount}/{branchableCores.length} available
                  </span>
                </div>

                {/* Core chips */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                    <button type="button" onClick={e => { e.stopPropagation(); setSplitterCoreColor(''); }}
                      style={{ width: 32, height: 32, borderRadius: 7, fontSize: 10, cursor: 'pointer',
                        fontWeight: splitterCoreColor === '' ? 700 : 500,
                        border: splitterCoreColor === '' ? '2.5px solid #0891b2' : '1.5px solid #e2e8f0',
                        background: splitterCoreColor === '' ? '#e0f2fe' : '#fff', color: '#475569',
                        boxShadow: splitterCoreColor === '' ? '0 0 0 2px #bae6fd' : 'none' }}>
                      Any
                    </button>
                    <span style={{ fontSize: 9, color: '#64748b', fontWeight: 500 }}>Any</span>
                    <span style={{ fontSize: 8, color: '#94a3b8' }}>–</span>
                  </div>

                  {branchableCores.map(cn => {
                    const c          = getCorObj(cn);
                    if (!c) return null;
                    const isAssigned = assignedToInternalSpl.has(cn);
                    const isIncoming = incomingCores.has(cn);
                    const isActive   = splitterCoreColor === cn;
                    return (
                      <div key={cn} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
                        <button type="button"
                          onClick={e => {
                            e.stopPropagation();
                            if (isAssigned && !isActive) {
                              toast.error(`Core "${cn}" ইতিমধ্যে অন্য Splitter-এ assigned।`, { duration:2500 });
                              return;
                            }
                            setSplitterCoreColor(isActive ? '' : cn);
                          }}
                          title={isAssigned ? `${cn} — assigned` : isIncoming ? `${cn} — incoming signal (recommended)` : `${cn} — free`}
                          style={{ width: 32, height: 32, borderRadius: 7, cursor: isAssigned ? 'not-allowed' : 'pointer',
                            background: c.hex, flexShrink: 0, position: 'relative',
                            border: isActive ? '3px solid #0f172a'
                              : isAssigned ? `2px solid ${c.border||c.hex}`
                              : isIncoming ? '3px solid #f59e0b'
                              : `2px dashed ${c.border||c.hex}`,
                            boxShadow: isActive ? '0 0 0 2.5px #0891b2'
                              : isIncoming && !isAssigned ? '0 0 0 2.5px #fde68a'
                              : 'none',
                            opacity: isAssigned && !isActive ? 0.4 : 1, transition: 'all 0.12s' }}>
                          {isAssigned && !isActive && (
                            <span style={{ position:'absolute', inset:0, display:'flex',
                              alignItems:'center', justifyContent:'center', fontSize:14, color:'#0f172a', fontWeight:900 }}>✕</span>
                          )}
                          {isIncoming && !isAssigned && !isActive && (
                            <div style={{ position:'absolute', top:-4, right:-4, width:13, height:13,
                              borderRadius:'50%', background:'#f59e0b', border:'2px solid #fff',
                              display:'flex', alignItems:'center', justifyContent:'center' }}>
                              <span style={{ fontSize:8, color:'#fff', fontWeight:900 }}>↓</span>
                            </div>
                          )}
                          {!isIncoming && !isAssigned && !isActive && (
                            <div style={{ position:'absolute', bottom:2, right:2, width:7, height:7,
                              borderRadius:'50%', background:'#16a34a', border:'1.5px solid #fff' }} />
                          )}
                        </button>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#374151', whiteSpace: 'nowrap' }}>
                          {cn.length > 7 ? cn.substring(0,7) : cn}
                        </span>
                        <span style={{ fontSize: 9, fontWeight: 600, whiteSpace: 'nowrap', borderRadius: 3, padding: '0 4px',
                            color: isAssigned ? '#dc2626' : isIncoming ? '#d97706' : '#16a34a',
                            background: isAssigned ? '#fee2e2' : isIncoming ? '#fef3c7' : '#dcfce7' }}>
                          {isAssigned ? '✕ used' : isIncoming ? '↓ signal' : '● free'}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Legend */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '6px 8px',
                    background: '#f8fafc', borderRadius: 6, marginBottom: 6 }}>
                  {incomingCores.size > 0 && (
                    <span style={{ fontSize: 10, color: '#d97706', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#f59e0b', display: 'inline-block', flexShrink: 0 }} />
                      ↓ Incoming signal (recommended)
                    </span>
                  )}
                  <span style={{ fontSize: 10, color: '#16a34a', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#16a34a', display: 'inline-block', flexShrink: 0 }} />
                    ● Free core
                  </span>
                  <span style={{ fontSize: 10, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                    <span style={{ fontWeight: 900, fontSize: 11 }}>✕</span>
                    Already assigned
                  </span>
                </div>

                {splitterCoreColor && (() => {
                  const selectedObj = getCorObj(splitterCoreColor);
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                        background: '#f0fdf4', borderRadius: 7, border: '1.5px solid #86efac' }}>
                      {selectedObj && <div style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                          background: selectedObj.hex, border: `2px solid ${selectedObj.border||selectedObj.hex}` }} />}
                      <span style={{ fontSize: 11, color: '#15803d', fontWeight: 700 }}>
                        ✓ {splitterCoreColor} core selected
                        {incomingCores.has(splitterCoreColor) ? ' — incoming signal ✓' : ''}
                      </span>
                    </div>
                  );
                })()}
              </div>
            );
          })()}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={e => { e.stopPropagation(); handleAddSplitter(); }}
              disabled={creating || !splitterName.trim()}
              style={{ flex: 1, padding: '10px', fontSize: 12, fontWeight: 700, borderRadius: 8,
                border: 'none', cursor: !splitterName.trim() ? 'not-allowed' : 'pointer',
                background: !splitterName.trim() ? '#e2e8f0' : creating ? '#94a3b8' : '#16a34a',
                color: !splitterName.trim() ? '#94a3b8' : '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                boxShadow: splitterName.trim() && !creating ? '0 3px 8px rgba(22,163,74,0.35)' : 'none' }}>
              {creating ? '⏳ Creating...' : (
                <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/></svg>Add Splitter</>
              )}
            </button>
            <button onClick={e => { e.stopPropagation(); setShowSplForm(false); setSplitterName(''); setSplitterCoreColor(''); }}
              style={{ padding: '10px 16px', fontSize: 12, fontWeight: 600, borderRadius: 8,
                border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Add Fiber Cable — BOX থেকে upstream OLT/Router/BOX cable ── */}
      {!showCableForm ? (
        <button onClick={e => { e.stopPropagation(); setShowCableForm(true); }}
          style={{ width:'100%', padding:'7px', fontSize:11, fontWeight:700,
            borderRadius:7, cursor:'pointer', marginBottom:6,
            border:'1.5px dashed #bae6fd', background:'#f0f9ff', color:'#0891b2',
            display:'flex', alignItems:'center', justifyContent:'center', gap:5 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          {hasFiberCable ? '+ Add Another Upstream Cable' : '🔵 Add Fiber Cable (OLT / Router)'}
        </button>
      ) : (() => {
        // ── Cable form ─────────────────────────────────────────────────────────
        // cableTarget — dropdown থেকে selected node
        const cableTarget = allNodes.find(n => String(n.id) === String(cableTargetId)) ?? null;
        const cableTargetPorts = cableTarget && cableTarget.node_type !== 'SPLITTER'
          ? getNodePorts(cableTarget) : null;
        const cableTargetSplPorts = cableTarget?.node_type === 'SPLITTER'
          ? getSplitterPorts(cableTarget.splitter_ratio) : null;
        const cableSrcPorts = getNodePorts(node);
        const cableTargetUsed = cableTarget ? getUsedPorts(cableTarget.id, allLinks) : new Set();
        const cableSrcUsed    = getUsedPorts(node.id, allLinks);
        const cableTgtPortLink = {};
        if (cableTarget) allLinks.forEach(lk => {
          if (lk.source_node === cableTarget.id && lk.source_port) cableTgtPortLink[lk.source_port] = lk.target_node_name;
          if (lk.target_node === cableTarget.id && lk.target_port) cableTgtPortLink[lk.target_port] = lk.source_node_name;
        });
        const cableSrcPortLink = {};
        allLinks.forEach(lk => {
          if (lk.source_node === node.id && lk.source_port) cableSrcPortLink[lk.source_port] = lk.target_node_name;
          if (lk.target_node === node.id && lk.target_port) cableSrcPortLink[lk.target_port] = lk.source_node_name;
        });
        const activeCableCores = generateFiberCores(Math.min(Math.max(cableCoreCount, 1), 144));
        const usedCableCores   = parseUsedCores(allJBLinks);
        const resetCableForm   = () => {
          setShowCableForm(false); setCableTargetId(''); setCableSrcPort('');
          setCableDstPort(''); setCableSrcCore(''); setCableCoreCount(12); setCableType('FIBER');
        };

        return (
          <div style={{ background:'#f0f9ff', border:'1px solid #bae6fd',
              borderRadius:8, padding:'9px 10px', marginBottom:6 }}>

            {/* Header */}
            <div style={{ fontSize:10, fontWeight:700, color:'#0891b2', marginBottom:8,
                display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span>🔵 Upstream Cable → {node.name}</span>
              <button onClick={e => { e.stopPropagation(); resetCableForm(); }}
                style={{ fontSize:10, border:'none', background:'none', color:'#94a3b8', cursor:'pointer' }}>✕</button>
            </div>

            {/* Connection type */}
            <div style={{ marginBottom:6 }}>
              <div style={{ ...secLabel, marginBottom:3 }}>Type</div>
              <div style={{ display:'flex', gap:3 }}>
                {[['FIBER','🔵'],['ETHERNET','🟢'],['WIRELESS','🟣']].map(([t, icon]) => (
                  <button key={t} type="button"
                    onClick={e => { e.stopPropagation(); setCableType(t); setCableSrcCore(''); }}
                    style={{ flex:1, padding:'2px 5px', borderRadius:5, fontSize:9, fontWeight:700,
                      cursor:'pointer', border: cableType===t?'2px solid #0891b2':'1px solid #e2e8f0',
                      background: cableType===t?'#0891b2':'#fff', color: cableType===t?'#fff':'#64748b' }}>
                    {icon} {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Core count — FIBER mode */}
            {cableType === 'FIBER' && (
              <div style={{ display:'flex', alignItems:'center', gap:3, marginBottom:7, flexWrap:'wrap' }}>
                <span style={{ fontSize:9, color:'#64748b', fontWeight:600, whiteSpace:'nowrap' }}>Cable:</span>
                {[2,4,6,8,12,24,48,96].map(n => (
                  <button key={n} type="button"
                    onClick={e => { e.stopPropagation(); setCableCoreCount(n); setCableSrcCore(''); }}
                    style={{ padding:'1px 5px', fontSize:9, fontWeight:700, borderRadius:4,
                      cursor:'pointer', flexShrink:0,
                      border: cableCoreCount===n?'2px solid #0891b2':'1px solid #cbd5e1',
                      background: cableCoreCount===n?'#0891b2':'#fff',
                      color: cableCoreCount===n?'#fff':'#64748b' }}>
                    {n}C
                  </button>
                ))}
              </div>
            )}

            {/* Upstream node dropdown — শুধু OLT/Router/BOX */}
            <div style={{ marginBottom:6 }}>
              <div style={{ ...secLabel, marginBottom:3 }}>Upstream Node (OLT / Router / BOX)</div>
              <select value={cableTargetId}
                onChange={e => { e.stopPropagation(); setCableTargetId(e.target.value); setCableDstPort(''); }}
                onClick={e => e.stopPropagation()}
                style={{ width:'100%', border:'1px solid #bae6fd', borderRadius:6,
                  padding:'5px 8px', fontSize:10, outline:'none', background:'#fff', color:'#1e293b' }}>
                <option value="">-- OLT / Router / BOX select করুন --</option>
                {allNodes.filter(n =>
                  n.id !== node.id &&
                  n.latitude && n.longitude &&
                  ['ROUTER', 'OLT', 'BOX'].includes(n.node_type)
                ).map(n => {
                  const ns = NODE_STYLE[n.node_type] || { letter:'?', label:'?' };
                  return (
                    <option key={n.id} value={String(n.id)}>
                      [{ns.letter}] {n.name}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* BOX incoming port — cable যেখানে ঢোকে */}
            {cableSrcPorts && (
              <div style={{ marginBottom:6 }}>
                <div style={{ ...secLabel, marginBottom:3 }}>
                  📥 {node.name} — Incoming Port (cable এখানে ঢোকে)
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
                  {/* Upstream cable-এর জন্য শুধু uplink port (In) relevant */}
                  {cableSrcPorts.uplinks.map(p => (
                    <PortChip key={p} label={`📥 ${p}`} active={cableSrcPort===p}
                      used={cableSrcUsed.has(p)} peer={cableSrcPortLink[p]}
                      onSelect={() => setCableSrcPort(cableSrcPort===p?'':p)} />
                  ))}
                </div>
              </div>
            )}

            {/* Upstream node outgoing port — cable যেখান থেকে বের হয় */}
            {cableTarget && (
              <div style={{ marginBottom:6 }}>
                <div style={{ ...secLabel, marginBottom:3 }}>
                  📤 {cableTarget.name} — Outgoing Port (PON = downstream)
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
                  {cableTargetSplPorts ? (
                    <>
                      <PortChip label="📥 In" active={cableDstPort==='In'}
                        used={cableTargetUsed.has('In')} peer={cableTgtPortLink['In']}
                        onSelect={() => setCableDstPort(cableDstPort==='In'?'':'In')} />
                      {cableTargetSplPorts.out.map(p => (
                        <PortChip key={p} label={p} small active={cableDstPort===p}
                          used={cableTargetUsed.has(p)} peer={cableTgtPortLink[p]}
                          onSelect={() => setCableDstPort(cableDstPort===p?'':p)} />
                      ))}
                    </>
                  ) : cableTargetPorts ? (
                    <>
                      {cableTargetPorts.uplinks.map(p => (
                        <PortChip key={p} label={`🔼 ${p}`} active={cableDstPort===p}
                          used={cableTargetUsed.has(p)} peer={cableTgtPortLink[p]}
                          onSelect={() => setCableDstPort(cableDstPort===p?'':p)} />
                      ))}
                      {cableTargetPorts.downlinks.map(p => (
                        <PortChip key={p} label={p} small active={cableDstPort===p}
                          used={cableTargetUsed.has(p)} peer={cableTgtPortLink[p]}
                          onSelect={() => setCableDstPort(cableDstPort===p?'':p)} />
                      ))}
                    </>
                  ) : null}
                </div>
              </div>
            )}

            {/* Fiber core color chip row */}
            {cableType === 'FIBER' && (
              <div style={{ marginBottom:7 }}>
                <div style={{ ...secLabel, marginBottom:4 }}>🔵 Fiber Core (optional)</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:3, maxHeight:52, overflowY:'auto' }}>
                  {activeCableCores.map(c => {
                    const conflict = usedCableCores.has(c.name) && cableSrcCore !== c.name;
                    return (
                      <button key={c.name} type="button" title={c.name}
                        onClick={e => { e.stopPropagation(); setCableSrcCore(cableSrcCore===c.name?'':c.name); }}
                        style={{ width:22, height:22, borderRadius:4, cursor:'pointer', flexShrink:0,
                          background:c.hex,
                          border: cableSrcCore===c.name?'3px solid #0f172a':`2px solid ${c.border||c.hex}`,
                          boxShadow: cableSrcCore===c.name?'0 0 0 2px #0891b2':'none',
                          opacity: conflict?0.35:1, position:'relative', transition:'all 0.1s' }}>
                        {conflict && <span style={{ position:'absolute', inset:0, display:'flex',
                          alignItems:'center', justifyContent:'center',
                          fontSize:9, color:'#1e293b', fontWeight:900 }}>✕</span>}
                      </button>
                    );
                  })}
                </div>
                {cableSrcCore && (
                  <div style={{ fontSize:9, color:'#0891b2', marginTop:3, fontWeight:600 }}>
                    ✓ Core: {cableSrcCore}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div style={{ display:'flex', gap:5 }}>
              <button onClick={e => { e.stopPropagation(); handleAddFiberCable(); }}
                disabled={cableCreating || !cableTargetId}
                style={{ flex:1, padding:'8px', fontSize:11, fontWeight:700, borderRadius:7,
                  border:'none', cursor: !cableTargetId?'not-allowed':'pointer',
                  background: !cableTargetId?'#e2e8f0': cableCreating?'#94a3b8':'#0891b2',
                  color: !cableTargetId?'#94a3b8':'#fff',
                  display:'flex', alignItems:'center', justifyContent:'center', gap:5 }}>
                {cableCreating ? '⏳...' : !cableTargetId ? 'Node select করুন ↑' : (
                  <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  {cableTargetId && allNodes.find(n=>String(n.id)===String(cableTargetId))?.name || 'Upstream'} → {node.name}{cableSrcPort?` (${cableSrcPort})`:''}

                  </>
                )}
              </button>
              <button onClick={e => { e.stopPropagation(); resetCableForm(); }}
                style={{ padding:'8px 12px', fontSize:11, fontWeight:600, borderRadius:7,
                  border:'1px solid #e2e8f0', background:'#fff', color:'#475569', cursor:'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        );
      })()}


      {/* ── Downstream cascade — JB থেকে সব দেখায় ── */}
      <button onClick={e => { e.stopPropagation(); setShowDownstream(v => !v); }}
        style={{ width: '100%', padding: '5px 8px', fontSize: 10, fontWeight: 700,
          borderRadius: 6, cursor: 'pointer', marginTop: 4,
          border: '1px solid #e2e8f0', background: showDownstream ? '#eff6ff' : '#f8fafc',
          color: showDownstream ? '#1d4ed8' : '#64748b',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>🔍 Downstream View</span>
        <span style={{ fontSize: 8, opacity: 0.6 }}>{showDownstream ? '▲' : '▼'}</span>
      </button>
      {showDownstream && (
        <div style={{ background: '#f8fafc', borderRadius: 7, padding: '8px 10px',
            border: '1px solid #e2e8f0', marginTop: 4 }}>
          <div style={{ ...secLabel, marginBottom: 6, color: '#1d4ed8' }}>
            Downstream from {node.name}
          </div>
          {allLinks.filter(l => l.source_node === node.id).length === 0 ? (
            <div style={{ fontSize: 9, color: '#94a3b8', fontStyle: 'italic' }}>
              No downstream connections yet.
            </div>
          ) : (
            <DownstreamCascade
              startId={node.id}
              allNodes={allNodes}
              allLinks={allLinks}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── CableInsertSection ──────────────────────────────────────────────────────
// Cable-এর মাঝখানে Join Box insert করার UI (শুধু BOX — Splitter JB-এর ভিতরে)।
// Process: নতুন BOX তৈরি → original cable দুই ভাগে split → original delete।
function CableInsertSection({ link, onNodeAdded, onLinkAdded, onLinkDeleted }) {
  const [open,       setOpen]     = useState(false);
  const [nodeName,   setNodeName] = useState('');
  const [inserting,  setInserting] = useState(false);

  // Cable-এর geographic midpoint বের করা
  const midpoint = (() => {
    const p = link.paths;
    if (!p || p.length < 2) return null;
    if (p.length === 2) return {
      lat: (parseFloat(p[0].lat) + parseFloat(p[1].lat)) / 2,
      lng: (parseFloat(p[0].lng) + parseFloat(p[1].lng)) / 2,
    };
    const m = Math.floor(p.length / 2);
    return { lat: parseFloat(p[m].lat), lng: parseFloat(p[m].lng) };
  })();

  const handleInsert = async () => {
    if (!nodeName.trim()) return toast.error('Node name required.');
    if (!midpoint) return toast.error('Cable path midpoint found করা যাচ্ছে না।');
    setInserting(true);
    try {
      // ── 1. Midpoint-এ নতুন node তৈরি ─────────────────────────────────────
      const nodeRes = await api.post('/network/nodes/', {
        name:           nodeName.trim(),
        node_type:      'BOX',
        latitude:       midpoint.lat.toFixed(7),
        longitude:      midpoint.lng.toFixed(7),
        status:         'active',

      });
      const newNode = nodeRes.data;
      onNodeAdded(newNode);

      // ── 2. Original path দুই ভাগে ভাগ করা ───────────────────────────────
      const paths = link.paths.map(p => ({ lat: parseFloat(p.lat), lng: parseFloat(p.lng) }));
      let firstHalf, secondHalf;
      if (paths.length <= 2) {
        firstHalf  = [paths[0], midpoint];
        secondHalf = [midpoint, paths[paths.length - 1]];
      } else {
        const m    = Math.floor(paths.length / 2);
        firstHalf  = paths.slice(0, m + 1);
        secondHalf = paths.slice(m);
      }

      const linkBase = {
        link_type:        link.link_type,
        color_code:       link.color_code,
        cable_code:       link.cable_code || undefined,
        fiber_core_color: link.fiber_core_color || undefined,
        fiber_core_count: link.fiber_core_count || undefined,
        fiber_company:    link.fiber_company    || undefined,
        distance:         undefined,
        status:           'active',
      };

      // ── 3. Original link আগে delete — port conflict এড়াতে ────────────────
      // নতুন links-এ একই source_port/target_port ব্যবহার হবে,
      // তাই original link আগে delete না করলে port duplicate error আসে।
      await api.delete(`/network/links/${link.id}/`);
      onLinkDeleted(link.id);

      // ── 4. Link 1: original source → new node ───────────────────────────
      const l1 = await api.post('/network/links/', {
        ...linkBase,
        source_node:  link.source_node,
        target_node:  newNode.id,
        source_port:  link.source_port  || undefined,
        target_port:  undefined,
        paths:        firstHalf,
      });
      onLinkAdded(l1.data);

      // ── 5. Link 2: new node → original target ───────────────────────────
      const l2 = await api.post('/network/links/', {
        ...linkBase,
        source_node:  newNode.id,
        target_node:  link.target_node,
        source_port:  undefined,
        target_port:  link.target_port  || undefined,
        paths:        secondHalf,
      });
      onLinkAdded(l2.data);

      toast.success(
        `📦 Join Box "${newNode.name}" inserted! Splitter যোগ করতে JB-তে click করুন।`,
        { duration: 5000 }
      );
      setOpen(false); setNodeName('');
    } catch (err) {
      const msg = err?.response?.data
        ? Object.entries(err.response.data).map(([k, v]) => `${k}: ${[v].flat().join(', ')}`).join(' | ')
        : 'Insert failed.';
      toast.error(msg.slice(0, 200));
    } finally { setInserting(false); }
  };

  const inpSt = { width: '100%', border: '1px solid #e2e8f0', borderRadius: 6,
    padding: '6px 9px', fontSize: 11, outline: 'none', background: '#fff', color: '#1e293b' };
  const lblSt = { fontSize: 9, color: '#64748b', fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 };

  return (
    <div style={{ marginTop: 8, borderTop: '1px solid #f1f5f9', paddingTop: 8 }}>
      {/* Toggle */}
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v); if (open) setNodeName(''); }}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 10px',
          background: open ? '#fefce8' : '#fafafa',
          border: `1px solid ${open ? '#fde68a' : '#e2e8f0'}`,
          borderRadius: 7, fontSize: 11, fontWeight: 700,
          color: open ? '#92400e' : '#475569', cursor: 'pointer' }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 10c-.83 0-1.5-.67-1.5-1.5v-5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5z"/>
            <path d="M20.5 10H19V8.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
            <path d="M9.5 14c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5S8 21.33 8 20.5v-5c0-.83.67-1.5 1.5-1.5z"/>
            <path d="M3.5 14H5v1.5c0 .83-.67 1.5-1.5 1.5S2 16.33 2 15.5 2.67 14 3.5 14z"/>
            <path d="M14 14.5V16h-4v-1.5"/>
            <path d="M14 7.5H16"/>
            <path d="M8 16.5H6"/>
          </svg>
          ✂️ Insert Join Box in Cable
          <span style={{ fontSize: 9, fontWeight: 400, opacity: 0.6 }}>
            (Splitter JB-এর ভিতরে)
          </span>
        </span>
        <span style={{ fontSize: 9, opacity: 0.5 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ marginTop: 8, background: '#fffbeb', border: '1px solid #fde68a',
            borderRadius: 8, padding: '10px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Info banner */}
          <div style={{ background: '#fef3c7', borderRadius: 6, padding: '5px 9px', fontSize: 10,
              color: '#78350f', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>✂️</span>
            <span>
              Cable মাঝখানে Join Box insert করুন।<br/>
              <span style={{ opacity: 0.7 }}>
                ফলে: {link.source_node_name} → <strong>[{nodeName || '?'}]</strong> → {link.target_node_name}
              </span>
              <br/>
              <span style={{ opacity: 0.6, fontSize: 9 }}>
                Join Box-এর ভিতরে Splitter যোগ করা যাবে।
              </span>
            </span>
          </div>

          {/* Node name */}
          <div>
            <div style={lblSt}>Join Box Name *</div>
            <input
              value={nodeName}
              onChange={e => setNodeName(e.target.value)}
              onClick={e => e.stopPropagation()}
              placeholder="e.g. JB-1, JB-2, JB-Main"
              style={inpSt}
            />
          </div>

          {/* Midpoint info */}
          {midpoint && (
            <div style={{ background: '#fff', borderRadius: 6, padding: '5px 9px', fontSize: 10,
                color: '#64748b', border: '1px solid #e2e8f0' }}>
              <span style={{ fontWeight: 700, color: '#475569' }}>📍 Position:</span>{' '}
              cable-এর midpoint —{' '}
              <span style={{ fontFamily: 'monospace' }}>
                {midpoint.lat.toFixed(5)}, {midpoint.lng.toFixed(5)}
              </span>
            </div>
          )}

          {/* Insert button */}
          <button
            onClick={e => { e.stopPropagation(); handleInsert(); }}
            disabled={inserting || !nodeName.trim()}
            style={{ padding: '9px', fontSize: 11, fontWeight: 700, borderRadius: 7, border: 'none',
              cursor: inserting || !nodeName.trim() ? 'not-allowed' : 'pointer',
              background: !nodeName.trim() ? '#e2e8f0' : inserting ? '#94a3b8' : '#d97706',
              color: !nodeName.trim() ? '#94a3b8' : '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            {inserting ? '⏳ Inserting...' : !nodeName.trim() ? 'Name দিন ↑' : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Insert Join Box "{nodeName}"
              </>
            )}
          </button>

          <div style={{ fontSize: 9, color: '#78350f', background: '#fef9c3',
              borderRadius: 5, padding: '3px 8px', textAlign: 'center' }}>
            ⚠ Original cable delete হবে, দুটি নতুন link তৈরি হবে।
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main NetworkMap Component ────────────────────────────────────────────────
export default function NetworkMap() {
  const [nodes, setNodes]   = useState([]);
  const [links, setLinks]   = useState([]);
  const [clientMarkers, setClientMarkers] = useState([]);
  const [showClients, setShowClients]     = useState(true);
  const [loading, setLoading] = useState(true);

  // Map tile style — 'dark' | 'satellite' | 'hybrid'
  // default 'hybrid' — satellite imagery + road/place name labels একসাথে
  // key prop দিয়ে style change-এ Leaflet TileLayer forced remount হয়
  const [mapStyle, setMapStyle] = useState('hybrid');

  // Interaction mode
  const [mode, setMode] = useState('view');

  // Draw link state
  const [sourceNode,   setSourceNode]   = useState(null);
  const [drawingPath,  setDrawingPath]  = useState([]);
  const [targetNode,   setTargetNode]   = useState(null);

  // Modals
  const [showNodeModal,     setShowNodeModal]     = useState(false);
  const [pendingLatlng,     setPendingLatlng]     = useState(null);
  const [showLinkModal,     setShowLinkModal]     = useState(false);
  const [showEditModal,     setShowEditModal]     = useState(false);
  const [editingNode,       setEditingNode]       = useState(null);
  const [showEditLinkModal, setShowEditLinkModal] = useState(false);
  const [editingLink,       setEditingLink]       = useState(null);
  // Path editing — drag waypoints to reshape a link
  const [editingLinkPath,   setEditingLinkPath]   = useState(null);
  // { linkId: number, paths: [{lat,lng},...] }

  // View mode-এ selected node — sidebar info panel দেখানোর জন্য
  const [selectedNodeInfo, setSelectedNodeInfo] = useState(null);

  // Leaflet map instance ref — sidebar থেকে flyTo করার জন্য
  const mapRef          = useRef(null);
  const nodeMarkerRefs  = useRef({});   // nodeId → Leaflet Marker instance
  const clientMarkerRefs = useRef({});  // `dyn-${c.id}` → Leaflet Marker instance

  // Sidebar
  const [filterType,      setFilterType]      = useState('ALL');
  const [sidebarOpen,     setSidebarOpen]      = useState(true);
  const [searchQuery,     setSearchQuery]      = useState('');
  const [selectedClientId, setSelectedClientId] = useState(null); // selected dynamic client

  // ── Sidebar fly-to: node বা client-এ click → map flyTo + popup auto-open ──
  // Zoom levels: satellite/hybrid-এ Google Maps max zoom = 21
  // Node type অনুযায়ী zoom — BOX/Splitter একটু wide, Client একদম close
  const NODE_ZOOM = { ROUTER: 19, OLT: 19, BOX: 20, SPLITTER: 20, CLIENT: 21 };

  const flyToNode = useCallback((node) => {
    if (!node.latitude || !node.longitude) return;
    // Sidebar-এ detail panel খুলবে না — শুধু map-এ fly + popup
    // setSelectedNodeInfo ইচ্ছাকৃতভাবে call করা হচ্ছে না
    const lat  = parseFloat(node.latitude);
    const lng  = parseFloat(node.longitude);
    const zoom = NODE_ZOOM[node.node_type] ?? 20;
    if (mapRef.current) {
      mapRef.current.flyTo([lat, lng], zoom, { animate: true, duration: 1.2 });
      setTimeout(() => {
        const m = nodeMarkerRefs.current[node.id];
        if (m) m.openPopup();
      }, 1350);
    }
  }, []);

  const flyToClient = useCallback((c) => {
    // Sidebar-এ stay করবে — শুধু map-এ fly + popup
    setSearchQuery('');
    if (mapRef.current) {
      mapRef.current.flyTo([c.latitude, c.longitude], 21, { animate: true, duration: 1.2 });
      setTimeout(() => {
        const m = clientMarkerRefs.current[`dyn-${c.id}`];
        if (m) m.openPopup();
      }, 1350);
    }
  }, []);

  // Click feedback — map-এ click করলে সাময়িক ripple circle দেখানো হয়
  // ব্যবহারকারী বুঝতে পারবেন click register হয়েছে
  const [clickFeedback, setClickFeedback] = useState(null);

  // ── Data fetch ────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      const [nRes, lRes, cRes] = await Promise.all([
        api.get('/network/nodes/'),
        api.get('/network/links/'),
        api.get('/network/client-markers/'),
      ]);
      setNodes(nRes.data.results ?? nRes.data);
      setLinks(lRes.data.results ?? lRes.data);
      setClientMarkers(Array.isArray(cRes.data) ? cRes.data : []);
    } catch {
      toast.error('Failed to load network data.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Map click ─────────────────────────────────────────────────────────────
  const handleMapClick = useCallback((latlng) => {
    // visual feedback — click position-এ সাময়িক ripple দেখানো (500ms)
    setClickFeedback(latlng);
    setTimeout(() => setClickFeedback(null), 600);

    if (mode === 'addNode') {
      setPendingLatlng(latlng);
      setShowNodeModal(true);
    } else if (mode === 'drawLink' && sourceNode) {
      setDrawingPath(prev => [...prev, latlng]);
    }
  }, [mode, sourceNode]);

  // ── Node marker click ──────────────────────────────────────────────────────
  // view mode → sidebar info panel খোলো
  // drawLink mode → source/target নির্বাচন
  const handleNodeMarkerClick = useCallback((node) => {
    if (mode === 'view') {
      setSelectedNodeInfo(node);
      return;
    }
    if (mode !== 'drawLink') return;
    if (!sourceNode) {
      setSourceNode(node);
      setDrawingPath([{ lat: parseFloat(node.latitude), lng: parseFloat(node.longitude) }]);
      toast.success(`Source: "${node.name}" — click map to draw path, then click target.`, { duration: 4000 });
    } else if (node.id !== sourceNode.id) {
      const finalPath = [
        ...drawingPath,
        { lat: parseFloat(node.latitude), lng: parseFloat(node.longitude) },
      ];
      setTargetNode(node);
      setDrawingPath(finalPath);
      setShowLinkModal(true);
    }
  }, [mode, sourceNode, drawingPath]);

  // ── Undo last waypoint ─────────────────────────────────────────────────────
  // শেষ যোগ করা waypoint সরিয়ে দেয় — source node-এর position সংরক্ষিত থাকে
  const handleUndoWaypoint = useCallback(() => {
    setDrawingPath(prev => {
      // source position (index 0) মুছে ফেলা যাবে না
      if (prev.length <= 1) return prev;
      return prev.slice(0, -1);
    });
  }, []);

  // ── Reset drawing ──────────────────────────────────────────────────────────
  const resetDrawing = useCallback(() => {
    setMode('view');
    setSourceNode(null);
    setTargetNode(null);
    setDrawingPath([]);
  }, []);

  // ── Node update ───────────────────────────────────────────────────────────
  // EditNodeModal থেকে PATCH সফল হলে local state update
  const handleNodeUpdated = useCallback((updatedNode) => {
    setNodes(prev => prev.map(n => n.id === updatedNode.id ? updatedNode : n));
    setSelectedNodeInfo(updatedNode);
    setShowEditModal(false);
    setEditingNode(null);
  }, []);

  // ── Node delete ────────────────────────────────────────────────────────────
  // list ও selected info উভয় পরিষ্কার করা হয়
  const handleNodeDeleted = useCallback((deletedId) => {
    setNodes(prev => prev.filter(n => n.id !== deletedId));
    setLinks(prev => prev.filter(
      l => l.source_node !== deletedId && l.target_node !== deletedId
    ));
    setSelectedNodeInfo(null);
    setShowEditModal(false);
    setEditingNode(null);
  }, []);

  // ── Path editing helpers ──────────────────────────────────────────────────
  const saveEditedPath = async () => {
    if (!editingLinkPath) return;
    try {
      const res = await api.patch(`/network/links/${editingLinkPath.linkId}/`, {
        paths: editingLinkPath.paths,
      });
      setLinks(prev => prev.map(l => l.id === editingLinkPath.linkId ? res.data : l));
      toast.success('Cable path saved.');
    } catch {
      toast.error('Failed to save path.');
    } finally { setEditingLinkPath(null); }
  };

  // ── Derived values ────────────────────────────────────────────────────────
  const filteredNodes  = filterType === 'ALL' ? nodes : nodes.filter(n => n.node_type === filterType);
  const activeCount    = nodes.filter(n => n.status === 'active').length;

  // Search results — node + client markers একসাথে
  const searchResults = searchQuery.trim().length >= 1
    ? (() => {
        const q = searchQuery.trim().toLowerCase();
        const matchedNodes = nodes.filter(n =>
          (n.name || '').toLowerCase().includes(q) ||
          (n.ip_address || '').toLowerCase().includes(q)
        ).map(n => ({ type: 'node', data: n }));
        const matchedClients = clientMarkers.filter(c =>
          (c.customer_id || '').toLowerCase().includes(q) ||
          (c.full_name   || '').toLowerCase().includes(q) ||
          (c.phone       || '').toLowerCase().includes(q)
        ).map(c => ({ type: 'client', data: c }));
        return [...matchedClients, ...matchedNodes];  // client আগে
      })()
    : [];

  // Drawing status bar message
  const statusMsg = mode === 'addNode'
    ? 'Click anywhere on the map to place a node.'
    : mode === 'drawLink' && !sourceNode
      ? 'Click a node marker to set cable source.'
      : mode === 'drawLink' && sourceNode
        ? `Drawing: "${sourceNode.name}" → ${drawingPath.length} waypoints added | Click another node to finish.`
        : '';

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
      Loading network map...
    </div>
  );

  return (
    <div className="flex flex-col -m-4 overflow-hidden" style={{ height: 'calc(100vh - 56px)' }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-3 py-2 flex-shrink-0">
        {/* Row 1: Title + mobile sidebar toggle + tile toggle */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {/* Mobile sidebar toggle */}
            <button
              className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 active:bg-gray-300 transition-all touch-manipulation"
              onClick={() => setSidebarOpen(v => !v)}
              title="Toggle Panel"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-[#173d59] leading-tight">Network GIS Map</h1>
              <p className="text-[10px] text-gray-400 leading-tight">
                {nodes.length} nodes · {links.length} links · {activeCount} active
              </p>
            </div>
          </div>
          {/* Tile style toggle — compact on mobile */}
          <div className="flex items-center border border-gray-200 rounded-full overflow-hidden flex-shrink-0">
            {[
              { key: 'dark',      label: 'Dark',  short: 'D' },
              { key: 'satellite', label: 'Sat',   short: 'S' },
              { key: 'hybrid',    label: 'Hybrid', short: 'H' },
            ].map(({ key, label, short }) => (
              <button
                key={key}
                onClick={() => setMapStyle(key)}
                className={`px-2 py-1.5 text-xs font-semibold transition-all touch-manipulation ${
                  mapStyle === key
                    ? 'bg-slate-700 text-white'
                    : 'bg-white text-gray-500 hover:bg-gray-50'
                }`}
              >
                <span className="hidden sm:inline">{label}</span>
                <span className="sm:hidden">{short}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Mode buttons — horizontal scroll on mobile */}
        <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          {[
            { key: 'view',     label: 'View',      cls: 'bg-[#173d59] text-white border-[#173d59]' },
            { key: 'addNode',  label: '+ Node',    cls: 'bg-emerald-600 text-white border-emerald-600' },
            { key: 'drawLink', label: 'Draw Link', cls: 'bg-cyan-600 text-white border-cyan-600' },
          ].map(({ key, label, cls }) => (
            <button
              key={key}
              onClick={() => { resetDrawing(); setMode(key); setSelectedNodeInfo(null); }}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all touch-manipulation ${
                mode === key ? cls : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}

          {mode === 'drawLink' && sourceNode && drawingPath.length > 1 && (
            <button
              onClick={handleUndoWaypoint}
              className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-all touch-manipulation"
              title="Remove last waypoint"
            >
              ↩ Undo
            </button>
          )}
          {mode === 'drawLink' && drawingPath.length > 1 && (
            <button
              onClick={() => {
                setDrawingPath(sourceNode
                  ? [{ lat: parseFloat(sourceNode.latitude), lng: parseFloat(sourceNode.longitude) }]
                  : []);
              }}
              className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100 transition-all touch-manipulation"
              title="Clear all waypoints"
            >
              Clear
            </button>
          )}

          {mode !== 'view' && (
            <button onClick={resetDrawing}
              className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 transition-all touch-manipulation">
              Cancel
            </button>
          )}
          <button onClick={fetchData}
            className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-white text-gray-500 border border-gray-300 hover:bg-gray-50 transition-all touch-manipulation ml-auto">
            Refresh
          </button>
        </div>

        {/* Drawing instruction bar */}
        {statusMsg && (
          <div className={`mt-2 px-3 py-1.5 rounded-xl text-xs font-medium truncate ${
            mode === 'addNode'  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
            mode === 'drawLink' ? 'bg-cyan-50 text-cyan-700 border border-cyan-100' : ''
          }`}>
            {statusMsg}
          </div>
        )}
      </div>

      {/* ── Content: Sidebar + Map ─────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden relative">

        {/* ── Sidebar ──────────────────────────────────────────────────────── */}
        {sidebarOpen && (
          <>
            {/* Mobile backdrop — sidebar-এর পেছনে dark overlay, click করলে sidebar বন্ধ */}
            <div
              className="fixed inset-0 bg-black/40 z-[599] md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          <div className="absolute inset-y-0 left-0 z-[600] md:relative md:inset-y-auto md:left-auto md:z-auto w-[280px] md:w-60 bg-white border-r border-slate-200 flex flex-col overflow-hidden flex-shrink-0 shadow-2xl md:shadow-none">

            {/* Stats */}
            <div className="p-3 border-b border-gray-100 grid grid-cols-2 gap-2">
              <div className="bg-sky-50 rounded-xl py-2.5 text-center">
                <div className="text-lg font-bold text-sky-600">{nodes.length}</div>
                <div className="text-[9px] uppercase tracking-wider text-sky-400">Nodes</div>
              </div>
              <div className="bg-teal-50 rounded-xl py-2.5 text-center">
                <div className="text-lg font-bold text-teal-600">{links.length}</div>
                <div className="text-[9px] uppercase tracking-wider text-teal-400">Links</div>
              </div>
              <div className="col-span-2 bg-amber-50 rounded-xl py-2 px-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-slate-800 rounded-full flex items-center justify-center">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-amber-700">{clientMarkers.length}</div>
                    <div className="text-[9px] uppercase tracking-wider text-amber-500">Clients on Map</div>
                  </div>
                </div>
                <button
                  onClick={() => setShowClients(v => !v)}
                  className={`text-[10px] font-semibold px-2 py-1 rounded-lg transition-colors ${
                    showClients
                      ? 'bg-amber-500 text-white'
                      : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {showClients ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>

            {/* ── Node Info Panel (view mode selected node) ─────────────── */}
            {selectedNodeInfo ? (
              <div className="flex-1 overflow-y-auto">
                {/* Back button */}
                <button
                  onClick={() => setSelectedNodeInfo(null)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-gray-500 hover:bg-gray-50 border-b border-gray-100 transition-all"
                >
                  ← All Nodes
                </button>

                {/* Node detail card */}
                <div className="p-3">
                  {(() => {
                    const s = NODE_STYLE[selectedNodeInfo.node_type] || { bg: '#374151', letter: '?', label: 'Unknown' };
                    const sc = STATUS_COLOR[selectedNodeInfo.status] || '#6b7280';
                    return (
                      <>
                        {/* Node header */}
                        <div className="flex items-center gap-3 mb-4 p-3 rounded-xl" style={{ background: s.bg + '18' }}>
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: s.bg }}
                            dangerouslySetInnerHTML={{ __html: getNodeSvg(selectedNodeInfo.node_type, 22, 22) }}
                          />
                          <div>
                            <div className="text-sm font-bold text-gray-900">{selectedNodeInfo.name}</div>
                            <div className="text-xs text-gray-400">{s.label}</div>
                          </div>
                        </div>

                        {/* Details */}
                        <div className="space-y-2 text-xs mb-4">
                          <div className="flex justify-between">
                            <span className="text-gray-400 uppercase tracking-wider text-[10px]">Status</span>
                            <span className="font-semibold capitalize flex items-center gap-1.5" style={{ color: sc }}>
                              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: sc }} />
                              {selectedNodeInfo.status}
                            </span>
                          </div>
                          {selectedNodeInfo.ip_address && (
                            <div className="flex justify-between">
                              <span className="text-gray-400 uppercase tracking-wider text-[10px]">IP</span>
                              <code className="text-gray-700 font-medium">{selectedNodeInfo.ip_address}</code>
                            </div>
                          )}
                          {selectedNodeInfo.node_type === 'SPLITTER' && selectedNodeInfo.splitter_ratio && (
                            <div className="flex justify-between items-center">
                              <span className="text-gray-400 uppercase tracking-wider text-[10px]">Ratio</span>
                              <span className="text-xs font-bold text-cyan-600 bg-cyan-50 px-2 py-0.5 rounded">
                                {selectedNodeInfo.splitter_ratio}
                              </span>
                            </div>
                          )}
                          {selectedNodeInfo.router_name && (
                            <div className="flex justify-between">
                              <span className="text-gray-400 uppercase tracking-wider text-[10px]">Router</span>
                              <span className="text-gray-700 text-right">{selectedNodeInfo.router_name}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-gray-400 uppercase tracking-wider text-[10px]">Lat / Lng</span>
                            <span className="text-gray-500 font-mono text-[10px]">
                              {parseFloat(selectedNodeInfo.latitude).toFixed(5)},
                              {parseFloat(selectedNodeInfo.longitude).toFixed(5)}
                            </span>
                          </div>
                          {selectedNodeInfo.description && (
                            <p className="text-gray-500 bg-gray-50 rounded-lg p-2 leading-relaxed">
                              {selectedNodeInfo.description}
                            </p>
                          )}
                        </div>

                        {/* Connected Links */}
                        {(() => {
                          const nodeLinks = links.filter(
                            l => l.source_node === selectedNodeInfo.id || l.target_node === selectedNodeInfo.id
                          );
                          if (!nodeLinks.length) return null;
                          return (
                            <div className="mb-4">
                              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-2">
                                Connections ({nodeLinks.length})
                              </div>
                              <div className="space-y-1.5">
                                {nodeLinks.map(lk => {
                                  const isSource = lk.source_node === selectedNodeInfo.id;
                                  const peer     = isSource ? lk.target_node_name : lk.source_node_name;
                                  const peerType = isSource ? lk.target_node_type : lk.source_node_type;
                                  const peerSt   = NODE_STYLE[peerType] || { letter: '?', bg: '#374151' };
                                  return (
                                    <div key={lk.id} className="bg-gray-50 rounded-lg px-2.5 py-2 space-y-1">
                                      {/* Peer row */}
                                      <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                             style={{ background: lk.color_code || '#00bcd4' }} />
                                        <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                                             style={{ background: peerSt.bg }}
                                             dangerouslySetInnerHTML={{ __html: getNodeSvg(peerType, 13, 13) }}
                                        />
                                        <div className="flex-1 min-w-0">
                                          <div className="text-xs font-medium text-gray-700 truncate">{peer}</div>
                                          <div className="text-[10px] text-gray-400">{lk.link_type_display || lk.link_type}</div>
                                        </div>
                                        {lk.distance && (
                                          <div className="text-[10px] text-gray-400 flex-shrink-0">{lk.distance}m</div>
                                        )}
                                      </div>
                                      {/* Port info */}
                                      {(() => {
                                        const myPort   = isSource ? lk.source_port : lk.target_port;
                                        const peerPort = isSource ? lk.target_port : lk.source_port;
                                        if (!myPort && !peerPort) return null;
                                        return (
                                          <div className="flex items-center gap-1.5 pl-5 text-[10px] text-gray-400 font-mono">
                                            {myPort && <span className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">📌 {myPort}</span>}
                                            {myPort && peerPort && <span>→</span>}
                                            {peerPort && <span className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{peerPort}</span>}
                                          </div>
                                        );
                                      })()}
                                      {/* Fiber summary */}
                                      {lk.link_type === 'FIBER' && (lk.fiber_company || lk.fiber_core_count) && (
                                        <div className="pl-5 text-[10px] text-gray-400">
                                          {[lk.fiber_company, lk.fiber_core_count && `${lk.fiber_core_count}-core`].filter(Boolean).join(' · ')}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Action buttons */}
                        <button
                          onClick={() => { setEditingNode(selectedNodeInfo); setShowEditModal(true); }}
                          className="w-full bg-[#173d59] hover:bg-[#1f5075] text-white rounded-xl py-3 text-xs font-semibold transition-all mb-2 min-h-[44px] touch-manipulation"
                        >
                          Edit Node
                        </button>
                        <button
                          onClick={() => setSelectedNodeInfo(null)}
                          className="w-full bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-xl py-2.5 text-xs font-medium transition-all border border-gray-200 min-h-[44px] touch-manipulation"
                        >
                          Deselect
                        </button>
                      </>
                    );
                  })()}
                </div>
              </div>
            ) : (
              /* ── Search + Node List ────────────────────────────────────── */
              <>
                {/* Search box */}
                <div className="p-2.5 border-b border-gray-100 space-y-2">
                  <div className="relative">
                    <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
                      fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                    </svg>
                    <input
                      type="text"
                      placeholder="Search by ID, name, phone..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-7 py-2 text-xs border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-100"
                    />
                    {searchQuery && (
                      <button onClick={() => setSearchQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                        ✕
                      </button>
                    )}
                  </div>
                  {!searchQuery && (
                    <select
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:border-[#173d59] bg-gray-50"
                      value={filterType}
                      onChange={e => setFilterType(e.target.value)}
                    >
                      <option value="ALL">All Types</option>
                      {Object.entries(NODE_STYLE).map(([k, v]) => (
                        <option key={k} value={k}>{v.label}</option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {/* ── Search Results ── */}
                  {searchQuery.trim() ? (
                    searchResults.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-8">No results found.</p>
                    ) : searchResults.map((item, idx) => {
                      if (item.type === 'client') {
                        const c = item.data;
                        const dot = STATUS_DOT[c.status] || '#6b7280';
                        const isActive = c.status === 'active';
                        return (
                          <div key={`c-${c.id}`}
                            onClick={() => flyToClient(c)}
                            className="flex items-center gap-2 px-2.5 py-2 rounded-xl hover:bg-amber-50 cursor-pointer border border-transparent hover:border-amber-200 transition-all"
                          >
                            {/* WiFi icon badge */}
                            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 border-2"
                              style={{ background: STATUS_BG[c.status] || '#0f172a', borderColor: dot }}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                                stroke={dot} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="19" r="1.5" fill={dot} stroke="none"/>
                                <path d="M8.5 15.5a5 5 0 0 1 7 0"/>
                                <path d="M4.5 11.5a11 11 0 0 1 15 0"/>
                              </svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-bold text-gray-800 truncate">{c.full_name}</div>
                              <div className="text-[10px] text-gray-500">{c.customer_id} · {c.phone}</div>
                            </div>
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dot }} />
                          </div>
                        );
                      }
                      // node result
                      const node = item.data;
                      const s = NODE_STYLE[node.node_type] || { bg: '#374151', letter: '?', label: 'Unknown' };
                      return (
                        <div key={`n-${node.id}`}
                          onClick={() => { setSearchQuery(''); flyToNode(node); }}
                          className="flex items-center gap-2 px-2.5 py-2 rounded-xl hover:bg-blue-50 cursor-pointer border border-transparent hover:border-blue-100 transition-all"
                        >
                          <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0" style={{ background: s.bg }}
                            dangerouslySetInnerHTML={{ __html: getNodeSvg(node.node_type, 13, 13) }} />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-gray-800 truncate">{node.name}</div>
                            <div className="text-[10px] text-gray-400">{s.label}</div>
                          </div>
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STATUS_COLOR[node.status] || '#6b7280' }} />
                        </div>
                      );
                    })
                  ) : (
                    /* ── Normal Node List ── */
                    filteredNodes.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-8">
                        No nodes yet.<br />
                        <span className="text-gray-300">Use Add Node mode to begin.</span>
                      </p>
                    ) : filteredNodes.map(node => {
                      const s = NODE_STYLE[node.node_type] || { bg: '#374151', letter: '?', label: 'Unknown' };
                      return (
                        <div
                          key={node.id}
                          onClick={() => flyToNode(node)}
                          className="flex items-center gap-2 px-2.5 py-2 rounded-xl hover:bg-blue-50/60 transition-all cursor-pointer border border-transparent hover:border-blue-100"
                        >
                          <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0" style={{ background: s.bg }}
                            dangerouslySetInnerHTML={{ __html: getNodeSvg(node.node_type, 14, 14) }} />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-gray-800 truncate">{node.name}</div>
                            <div className="text-[10px] text-gray-400">{s.label}</div>
                          </div>
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STATUS_COLOR[node.status] || '#6b7280' }} />
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}

            <button onClick={() => setSidebarOpen(false)}
              className="border-t border-gray-100 py-2 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all flex-shrink-0">
              ◀ Hide Panel
            </button>
          </div>
          </>
        )}

        {!sidebarOpen && (
          /* Desktop-only ▶ tab — mobile-এ header hamburger button ব্যবহার করতে হবে */
          <button onClick={() => setSidebarOpen(true)}
            className="hidden md:flex bg-white border-r border-gray-200 px-1.5 py-4 text-xs text-gray-500 hover:bg-gray-50 transition-all flex-shrink-0 z-[500] items-center">
            ▶
          </button>
        )}

        {/* ── Leaflet Map ──────────────────────────────────────────────────── */}
        <div className="flex-1 relative">

          {/* ── Active mode instruction banner ─────────────────────────────
              MapContainer-এর বাইরে কিন্তু একই relative div-এ — z-[1000] দিয়ে
              map-এর উপর ভাসে। ব্যবহারকারী যেন সবসময় বুঝতে পারেন কী করতে হবে। */}
          {mode === 'addNode' && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none w-[90%] max-w-sm">
              <div className="bg-emerald-600 text-white text-[11px] font-semibold px-4 py-2.5 rounded-full shadow-xl flex items-center gap-2 justify-center">
                <span>📍</span>
                <span>মানচিত্রে ক্লিক করুন → নোড যোগ হবে</span>
              </div>
            </div>
          )}
          {mode === 'drawLink' && !sourceNode && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none w-[90%] max-w-sm">
              <div className="bg-cyan-600 text-white text-[11px] font-semibold px-4 py-2.5 rounded-full shadow-xl flex items-center gap-2 justify-center">
                <span>🔗</span>
                <span>নোড মার্কারে ক্লিক → Source নির্বাচন</span>
              </div>
            </div>
          )}
          {mode === 'drawLink' && sourceNode && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none w-[90%] max-w-sm">
              <div className="bg-amber-500 text-white text-[11px] font-semibold px-4 py-2.5 rounded-full shadow-xl flex items-center gap-2 justify-center">
                <span>✏️</span>
                <span>ক্লিক → waypoint | Target নোডে ক্লিক → শেষ</span>
              </div>
            </div>
          )}

          {/* ── Path edit control panel ───────────────────────────────────────
              Link-এর path drag করে edit করার সময় floating panel দেখায়। */}
          {editingLinkPath && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] w-[92%] max-w-sm">
              <div className="bg-white rounded-2xl shadow-2xl px-4 py-3 flex flex-col sm:flex-row items-center gap-3 border border-amber-100">
                <div className="text-center flex-1">
                  <div className="text-xs font-bold text-amber-600">Path Edit Mode</div>
                  <div className="text-[10px] text-gray-400 mt-0.5 leading-tight">
                    {editingLinkPath.paths.length} pts · Drag 🔵 reshape · Click ⚪ add
                  </div>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                  <button onClick={saveEditedPath}
                    className="flex-1 sm:flex-none bg-[#173d59] hover:bg-[#1f5075] text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition-all min-h-[44px] touch-manipulation">
                    Save
                  </button>
                  <button onClick={() => setEditingLinkPath(null)}
                    className="flex-1 sm:flex-none text-gray-500 text-xs font-semibold px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 transition-all min-h-[44px] touch-manipulation">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          <MapContainer
            ref={mapRef}
            center={(() => { const v = savedMapView(); return v ? [v.lat, v.lng] : [23.8103, 90.4125]; })()}
            zoom={(() => { const v = savedMapView(); return v ? v.zoom : 12; })()}
            maxZoom={21}
            style={{ width: '100%', height: '100%' }}
          >
            {/* ── Tile Layers ── key prop দিয়ে style change-এ forced remount ─ */}
            {/* key={mapStyle} — tile style পরিবর্তনে Leaflet forced remount,
                নয়তো পুরনো tiles screen-এ আটকে থাকে */}
            <TileLayer
              key={mapStyle}
              url={TILE_LAYERS[mapStyle].url}
              attribution={TILE_LAYERS[mapStyle].attrib}
              subdomains={TILE_LAYERS[mapStyle].subdomains || 'abc'}
              maxZoom={21}
              maxNativeZoom={mapStyle === 'satellite' ? 19 : 21}
            />

            {/* Map position auto-save — moveend/zoomend এ localStorage এ পজিশন সেভ হয় */}
            <MapPositionSaver />
            {/* CursorManager: Leaflet container-এ সরাসরি cursor set করে */}
            <CursorManager mode={mode} />
            <MapClickHandler mode={mode} sourceNode={sourceNode} onMapClick={handleMapClick} />

            {/* Click feedback ripple — ব্যবহারকারীকে দেখায় click register হয়েছে */}
            {clickFeedback && (
              <CircleMarker
                center={[clickFeedback.lat, clickFeedback.lng]}
                radius={14}
                pathOptions={{ color: '#fbbf24', fill: true, fillColor: '#fbbf24', fillOpacity: 0.25, weight: 2 }}
              />
            )}

            {/* Saved links — প্রতিটি link = আলাদা স্বতন্ত্র fiber cable */}
            {links.map(link => {
              if (!link.paths || link.paths.length < 2) return null;
              // JB → inside-Splitter link — map-এ দেখাবে না (Splitter JB-এর ভিতরে)
              if (link.target_node_type === 'SPLITTER') {
                const tgtIncoming = links.filter(l => l.target_node === link.target_node);
                if (tgtIncoming.every(l => {
                  const src = nodes.find(n => n.id === l.source_node);
                  return src?.node_type === 'BOX';
                })) return null;
              }
              const positions = link.paths.map(p => [parseFloat(p.lat), parseFloat(p.lng)]);
              return (
                <Polyline
                  key={link.id}
                  positions={positions}
                  pathOptions={{
                    color:     link.color_code || '#00bcd4',
                    weight:    5,
                    opacity:   0.85,
                    dashArray: link.status !== 'active' ? '10, 8' : undefined,
                  }}
                >
                  {/* ── Hover Tooltip — fiber cable বিস্তারিত ── */}
                  {(() => {
                    const srcSt = NODE_STYLE[link.source_node_type] || { bg: '#374151' };
                    const tgtSt = NODE_STYLE[link.target_node_type] || { bg: '#374151' };
                    const tc = { FIBER: '#0891b2', ETHERNET: '#10b981', WIRELESS: '#8b5cf6' };
                    const typeColor = tc[link.link_type] || '#64748b';
                    const cn = link.fiber_core_color?.split(/[,→\-–]/)[0]?.trim();
                    const co = cn ? FIBER_BASE_COLORS.find(c => c.name.toLowerCase() === cn.toLowerCase()) : null;
                    const statusColor = link.status === 'active' ? '#16a34a' : '#ef4444';
                    return (
                      <Tooltip direction="top" sticky={true} opacity={1} offset={[0, -4]}>
                        <div style={{ fontFamily:'Inter,sans-serif', minWidth:180, maxWidth:240, fontSize:11 }}>
                          {/* Type + status */}
                          <div style={{ display:'flex', alignItems:'center', gap:6,
                              paddingBottom:6, marginBottom:6, borderBottom:'1px solid #f1f5f9' }}>
                            <span style={{ fontSize:10, fontWeight:700, color:'#fff', background:typeColor,
                                borderRadius:4, padding:'1px 7px', letterSpacing:'0.04em' }}>
                              {link.link_type}
                            </span>
                            {link.fiber_core_count && (
                              <span style={{ fontSize:9, fontFamily:'monospace', fontWeight:700,
                                  color:'#0891b2', background:'#e0f2fe', borderRadius:3, padding:'0 5px' }}>
                                {link.fiber_core_count}C
                              </span>
                            )}
                            <span style={{ marginLeft:'auto', fontSize:9, fontWeight:700,
                                color: statusColor }}>
                              ● {link.status}
                            </span>
                          </div>
                          {/* Source → Target */}
                          <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:5 }}>
                            <div style={{ width:18, height:18, borderRadius:4, flexShrink:0, background:srcSt.bg,
                                display:'flex', alignItems:'center', justifyContent:'center' }}
                              dangerouslySetInnerHTML={{ __html: getNodeSvg(link.source_node_type, 11, 11) }}
                            />
                            <span style={{ fontWeight:600, color:'#0f172a', flex:1, minWidth:0,
                                overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                              {link.source_node_name}
                            </span>
                            {link.source_port && (
                              <code style={{ fontSize:8, color:'#0369a1', background:'#dbeafe',
                                  borderRadius:3, padding:'0 4px', flexShrink:0 }}>
                                {link.source_port}
                              </code>
                            )}
                          </div>
                          <div style={{ display:'flex', alignItems:'center', gap:5, paddingLeft:6,
                              marginBottom:6, color:'#94a3b8', fontSize:10 }}>
                            <div style={{ width:1, height:14, background:'#e2e8f0', marginLeft:8 }} />
                            <span style={{ color:'#94a3b8' }}>▼</span>
                          </div>
                          <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom: co ? 6 : 0 }}>
                            <div style={{ width:18, height:18, borderRadius:4, flexShrink:0, background:tgtSt.bg,
                                display:'flex', alignItems:'center', justifyContent:'center' }}
                              dangerouslySetInnerHTML={{ __html: getNodeSvg(link.target_node_type, 11, 11) }}
                            />
                            <span style={{ fontWeight:600, color:'#0f172a', flex:1, minWidth:0,
                                overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                              {link.target_node_name}
                            </span>
                            {link.target_port && (
                              <code style={{ fontSize:8, color:'#0369a1', background:'#dbeafe',
                                  borderRadius:3, padding:'0 4px', flexShrink:0 }}>
                                {link.target_port}
                              </code>
                            )}
                          </div>
                          {/* Fiber core */}
                          {co && (
                            <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:6,
                                paddingTop:6, borderTop:'1px solid #f1f5f9' }}>
                              <div style={{ width:12, height:12, borderRadius:3, flexShrink:0,
                                  background:co.hex, border:`2px solid ${co.border||co.hex}` }} />
                              <span style={{ fontSize:10, color:'#475569', fontWeight:600 }}>{cn} core</span>
                            </div>
                          )}
                          {/* Click hint */}
                          <div style={{ marginTop:6, fontSize:9, color:'#94a3b8', textAlign:'center',
                              paddingTop:5, borderTop:'1px solid #f1f5f9' }}>
                            Click for details ↗
                          </div>
                        </div>
                      </Tooltip>
                    );
                  })()}
                  <Popup maxWidth={330} minWidth={310}>
                    <FiberCablePopup
                      link={link}
                      allLinks={links}
                      allNodes={nodes}
                      onEdit={() => { setEditingLink(link); setShowEditLinkModal(true); }}
                      onEditPath={() => {
                        setEditingLinkPath({ linkId: link.id, paths: link.paths.map(p => ({ ...p })) });
                      }}
                      onDeleted={(linkId) => setLinks(prev => prev.filter(l => l.id !== linkId))}
                      onLinkAdded={(newLink) => setLinks(prev => [...prev, newLink])}
                      onLinkUpdated={(updLink) => setLinks(prev => prev.map(l => l.id === updLink.id ? updLink : l))}
                      onNodeAdded={(newNode) => setNodes(prev => [...prev, newNode])}
                    />
                  </Popup>
                </Polyline>
              );
            })}

            {/* Live drawing preview */}
            {drawingPath.length >= 2 && (
              <Polyline
                positions={drawingPath.map(p => [p.lat, p.lng])}
                pathOptions={{ color: '#fbbf24', weight: 3, dashArray: '8, 10', opacity: 0.9 }}
              />
            )}

            {/* ── Path editing: live preview polyline ── */}
            {editingLinkPath && (
              <Polyline
                positions={editingLinkPath.paths.map(p => [p.lat, p.lng])}
                pathOptions={{ color: '#f59e0b', weight: 4, dashArray: '8, 6', opacity: 1 }}
                interactive={false}
              />
            )}

            {/* ── Path editing: draggable waypoint markers ── */}
            {editingLinkPath && editingLinkPath.paths.map((pt, idx) => (
              <Marker
                key={`wp-${editingLinkPath.linkId}-${idx}`}
                position={[pt.lat, pt.lng]}
                icon={waypointIcon}
                draggable={true}
                eventHandlers={{
                  drag: (e) => {
                    const { lat, lng } = e.target.getLatLng();
                    setEditingLinkPath(prev => ({
                      ...prev,
                      paths: prev.paths.map((p, i) => i === idx ? { lat, lng } : p),
                    }));
                  },
                  // Right-click deletes waypoint (min 2 points required)
                  contextmenu: () => {
                    if (editingLinkPath.paths.length <= 2) {
                      toast.error('Min 2 waypoints required.');
                      return;
                    }
                    setEditingLinkPath(prev => ({
                      ...prev,
                      paths: prev.paths.filter((_, i) => i !== idx),
                    }));
                  },
                }}
              />
            ))}

            {/* ── Path editing: midpoint markers — click to insert waypoint ── */}
            {editingLinkPath && editingLinkPath.paths.slice(0, -1).map((pt, idx) => {
              const next   = editingLinkPath.paths[idx + 1];
              const midLat = (pt.lat + next.lat) / 2;
              const midLng = (pt.lng + next.lng) / 2;
              return (
                <Marker
                  key={`mid-${editingLinkPath.linkId}-${idx}`}
                  position={[midLat, midLng]}
                  icon={midpointIcon}
                  eventHandlers={{
                    click: () => {
                      setEditingLinkPath(prev => {
                        const newPaths = [...prev.paths];
                        newPaths.splice(idx + 1, 0, { lat: midLat, lng: midLng });
                        return { ...prev, paths: newPaths };
                      });
                    },
                  }}
                />
              );
            })}

            {/* ── Dynamic Client Markers (lat/lng থাকা সব client) ───────── */}
            {showClients && clientMarkers.map(c => (
              <Marker
                key={`client-${c.id}`}
                ref={el => { if (el) clientMarkerRefs.current[`dyn-${c.id}`] = el; }}
                position={[c.latitude, c.longitude]}
                icon={buildClientIcon(c.status, selectedClientId === c.id)}
                eventHandlers={{ click: () => setSelectedClientId(c.id) }}
              >
                {/* ── Client hover tooltip ── */}
                {(() => {
                  const dot = STATUS_DOT[c.status] || '#6b7280';
                  return (
                    <Tooltip direction="top" offset={[0, -18]} opacity={1}>
                      <div style={{ fontFamily:'Inter,sans-serif', minWidth:175, maxWidth:225, fontSize:11 }}>
                        {/* Header */}
                        <div style={{ display:'flex', alignItems:'center', gap:6,
                            paddingBottom:6, marginBottom:6, borderBottom:'1px solid #f1f5f9' }}>
                          <div style={{ width:22, height:22, borderRadius:'50%', flexShrink:0,
                              background:'#052e16', border:`2px solid ${dot}`,
                              display:'flex', alignItems:'center', justifyContent:'center' }}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                              stroke={dot} strokeWidth="2.2" strokeLinecap="round">
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                              <circle cx="12" cy="7" r="4"/>
                            </svg>
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontWeight:700, fontSize:12, color:'#0f172a',
                                overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                              {c.full_name}
                            </div>
                            <div style={{ fontSize:9, color:'#94a3b8', fontFamily:'monospace' }}>{c.customer_id}</div>
                          </div>
                          <span style={{ fontSize:9, fontWeight:700, color:dot, background:`${dot}18`,
                              borderRadius:4, padding:'1px 5px', flexShrink:0 }}>
                            ● {c.status}
                          </span>
                        </div>
                        {/* Details */}
                        <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                          {[
                            ['Package', c.package_name],
                            ['Zone',    `${c.zone_name}${c.subzone_name !== '—' ? ' / '+c.subzone_name : ''}`],
                            ['Phone',   c.phone],
                          ].map(([lbl, val]) => (
                            <div key={lbl} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                              <span style={{ color:'#94a3b8', fontSize:10 }}>{lbl}</span>
                              <span style={{ color:'#0f172a', fontWeight:600, fontSize:10,
                                  maxWidth:130, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                                  textAlign:'right' }}>{val}</span>
                            </div>
                          ))}
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                            <span style={{ color:'#94a3b8', fontSize:10 }}>Bill</span>
                            <span style={{ fontWeight:700, color:'#0891b2', fontSize:10 }}>৳{c.monthly_bill}/mo</span>
                          </div>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                            <span style={{ color:'#94a3b8', fontSize:10 }}>Due</span>
                            <span style={{ fontWeight:700, fontSize:10,
                                color: parseFloat(c.due_amount) > 0 ? '#dc2626' : '#16a34a' }}>
                              {parseFloat(c.due_amount) > 0 ? `৳${c.due_amount}` : 'Clear'}
                            </span>
                          </div>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                            <span style={{ color:'#94a3b8', fontSize:10 }}>Expiry</span>
                            <span style={{ color:'#475569', fontWeight:600, fontSize:10 }}>{c.expiry_date}</span>
                          </div>
                        </div>
                        <div style={{ marginTop:5, fontSize:9, color:'#94a3b8', textAlign:'center',
                            paddingTop:4, borderTop:'1px solid #f1f5f9' }}>
                          Click for full details ↗
                        </div>
                      </div>
                    </Tooltip>
                  );
                })()}
                <Popup maxWidth={260} minWidth={240}>
                  <div style={{ fontFamily: 'Inter, sans-serif' }}>
                    {/* Header */}
                    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10,
                      padding:'8px 10px', background:'#0f172a', borderRadius:8 }}>
                      <div style={{ width:34, height:34, background:'#1e3a5f', borderRadius:'50%',
                        display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                          stroke={STATUS_DOT[c.status] || '#6b7280'} strokeWidth="2.2"
                          strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                          <circle cx="12" cy="7" r="4"/>
                        </svg>
                      </div>
                      <div>
                        <div style={{ fontSize:13, fontWeight:700, color:'#f1f5f9', lineHeight:1.2 }}>{c.full_name}</div>
                        <div style={{ fontSize:10, color:'#94a3b8', marginTop:2 }}>
                          <span style={{background:'#1e3a5f',padding:'1px 5px',borderRadius:3,marginRight:4,fontFamily:'monospace'}}>{c.customer_id}</span>
                          {c.phone}
                        </div>
                      </div>
                    </div>
                    {/* Info rows */}
                    {[
                      ['Status',   <span style={{ color: STATUS_DOT[c.status] || '#6b7280', fontWeight:600, textTransform:'capitalize' }}>{c.status}</span>],
                      ['Zone',     c.zone_name],
                      ['Sub Zone', c.subzone_name],
                      ['Package',  c.package_name],
                      ['Server',   c.router_name],
                      ['Bill',     `৳ ${c.monthly_bill}/mo`],
                      ['Due',      c.due_amount !== '0.00' ? <span style={{color:'#ef4444', fontWeight:600}}>৳ {c.due_amount}</span> : <span style={{color:'#22c55e'}}>Clear</span>],
                      ['Expiry',   c.expiry_date],
                      ['GPS',      `${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}`],
                    ].map(([label, val]) => (
                      <div key={label} style={{ display:'flex', justifyContent:'space-between',
                        alignItems:'center', padding:'3px 0', borderBottom:'1px solid #f1f5f9', fontSize:11 }}>
                        <span style={{ color:'#94a3b8', textTransform:'uppercase', fontSize:10, letterSpacing:'0.05em' }}>{label}</span>
                        <span style={{ color:'#1e293b', fontWeight:500 }}>{val}</span>
                      </div>
                    ))}
                    {/* Connect to Network Node */}
                    <ClientConnectSection
                      client={c}
                      allNodes={nodes}
                      allLinks={links}
                      onConnected={(newNode, newLink) => {
                        setNodes(prev => [...prev, newNode]);
                        setClientMarkers(prev => prev.filter(x => x.id !== c.id));
                        setLinks(prev => [...prev, newLink]);
                      }}
                    />
                    {/* Direction + Edit buttons */}
                    <div style={{ display:'flex', gap:6, marginTop:8 }}>
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${c.latitude},${c.longitude}`}
                        target="_blank" rel="noopener noreferrer"
                        style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center',
                          gap:5, padding:'7px 6px', background:'#1a56db', color:'#fff',
                          borderRadius:6, fontSize:11, fontWeight:600, textDecoration:'none' }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                        Direction
                      </a>
                      <a
                        href={`/clients/${c.id}/edit`}
                        style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center',
                          gap:5, padding:'7px 6px', background:'#0f766e', color:'#fff',
                          borderRadius:6, fontSize:11, fontWeight:600, textDecoration:'none' }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        Edit
                      </a>
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}

            {/* Node markers */}
            {nodes.map(node => {
              if (!node.latitude || !node.longitude) return null;
              // Inside-JB Splitter — জয়েন বক্সের ভিতরে, map-এ আলাদা marker দেখাবে না
              if (node.node_type === 'SPLITTER') {
                const incoming = links.filter(l => l.target_node === node.id);
                if (incoming.length > 0 && incoming.every(l => {
                  const src = nodes.find(n => n.id === l.source_node);
                  return src?.node_type === 'BOX';
                })) return null;
              }
              const isDrawSrc  = sourceNode?.id === node.id;
              const isViewSel  = selectedNodeInfo?.id === node.id;
              return (
                <Marker
                  key={node.id}
                  ref={el => { if (el) nodeMarkerRefs.current[node.id] = el; }}
                  position={[parseFloat(node.latitude), parseFloat(node.longitude)]}
                  icon={buildIcon(node, isDrawSrc, isViewSel)}
                  eventHandlers={{ click: () => handleNodeMarkerClick(node) }}
                >
                  {/* ── Hover Tooltip — node type-অনুযায়ী বিস্তারিত ── */}
                  {(() => {
                    const ns   = NODE_STYLE[node.node_type] || { bg:'#374151', label:'Node' };
                    const sc   = STATUS_COLOR[node.status]  || '#6b7280';
                    const myL  = links.filter(l => l.source_node === node.id || l.target_node === node.id);
                    const tcol = { FIBER:'#0891b2', ETHERNET:'#10b981', WIRELESS:'#8b5cf6' };

                    // ── Helper ─────────────────────────────────────────────
                    const R = ({ label, children, top }) => (
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                          paddingTop: top ? 5 : 0, marginTop: top ? 3 : 0,
                          borderTop: top ? '1px solid #f1f5f9' : 'none' }}>
                        <span style={{ color:'#94a3b8', fontSize:9, fontWeight:600,
                            textTransform:'uppercase', letterSpacing:'0.04em', flexShrink:0 }}>{label}</span>
                        <span style={{ color:'#0f172a', fontSize:10, fontWeight:600,
                            textAlign:'right', maxWidth:155, overflow:'hidden',
                            textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{children}</span>
                      </div>
                    );
                    const SecHdr = ({ children }) => (
                      <div style={{ fontSize:8, color:'#94a3b8', fontWeight:700, textTransform:'uppercase',
                          letterSpacing:'0.05em', marginTop:7, marginBottom:3,
                          paddingTop:5, borderTop:'1px solid #f1f5f9' }}>{children}</div>
                    );
                    const CoreDot = ({ color }) => {
                      const co = color ? FIBER_BASE_COLORS.find(c => c.name.toLowerCase() === color.toLowerCase()) : null;
                      return co ? <div style={{ width:9, height:9, borderRadius:2, flexShrink:0,
                          background:co.hex, border:`1.5px solid ${co.border||co.hex}`, display:'inline-block' }} /> : null;
                    };

                    // ── Router / OLT ──────────────────────────────────────
                    const renderRouterOLT = () => {
                      const downLinks = myL.filter(l => l.source_node === node.id);
                      const upLinks   = myL.filter(l => l.target_node === node.id);
                      const ports     = getNodePorts(node);
                      const usedDown  = ports ? ports.downlinks.filter(p => getUsedPorts(node.id, links).has(p)).length : 0;
                      return (<>
                        {node.ip_address && <R label="IP"><code style={{ fontSize:9, background:'#f1f5f9', borderRadius:3, padding:'0 5px', color:'#0f172a' }}>{node.ip_address}</code></R>}
                        {ports && <R label={node.node_type === 'OLT' ? 'PON Ports' : 'Ports'}><span style={{ color: usedDown < ports.downlinks.length ? '#16a34a' : '#ef4444', fontWeight:700 }}>{usedDown}/{ports.downlinks.length} used</span></R>}
                        {upLinks.length > 0 && (<>
                          <SecHdr>⬆ Upstream</SecHdr>
                          {upLinks.slice(0,3).map(lk => {
                            const pn = lk.source_node_name; const pp = lk.source_port;
                            const cn = lk.fiber_core_color?.split(/[,→\-–]/)[0]?.trim();
                            return (
                              <div key={lk.id} style={{ display:'flex', alignItems:'center', gap:4, marginBottom:2 }}>
                                <div style={{ width:14,height:14, borderRadius:3, flexShrink:0, background:NODE_STYLE[lk.source_node_type]?.bg||'#374151', display:'flex', alignItems:'center', justifyContent:'center' }} dangerouslySetInnerHTML={{ __html: getNodeSvg(lk.source_node_type,9,9) }} />
                                <span style={{ fontSize:9, fontWeight:600, color:'#0f172a', flex:1 }}>{pn}</span>
                                {pp && <code style={{ fontSize:9, color:'#0369a1', background:'#dbeafe', borderRadius:2, padding:'0 3px' }}>{pp}</code>}
                                {cn && <CoreDot color={cn} />}
                              </div>
                            );
                          })}
                        </>)}
                        {downLinks.length > 0 && (<>
                          <SecHdr>⬇ Downstream ({downLinks.length})</SecHdr>
                          {downLinks.slice(0,4).map(lk => {
                            const pn = lk.target_node_name; const pp = lk.source_port; const tp = lk.target_port;
                            const cn = lk.fiber_core_color?.split(/[,→\-–]/)[0]?.trim();
                            const cc = lk.fiber_core_count;
                            return (
                              <div key={lk.id} style={{ display:'flex', alignItems:'center', gap:4, marginBottom:2 }}>
                                <div style={{ width:14,height:14, borderRadius:3, flexShrink:0, background:NODE_STYLE[lk.target_node_type]?.bg||'#374151', display:'flex', alignItems:'center', justifyContent:'center' }} dangerouslySetInnerHTML={{ __html: getNodeSvg(lk.target_node_type,9,9) }} />
                                <span style={{ fontSize:9, fontWeight:600, color:'#0f172a', flex:1 }}>{pn}</span>
                                {pp && <code style={{ fontSize:9, color:'#0369a1', background:'#dbeafe', borderRadius:2, padding:'0 3px' }}>{pp}</code>}
                                {tp && <span style={{ fontSize:9, color:'#64748b' }}>→</span>}
                                {tp && <code style={{ fontSize:9, color:'#15803d', background:'#dcfce7', borderRadius:2, padding:'0 3px' }}>{tp}</code>}
                                {cc && <span style={{ fontSize:9, color:'#0891b2', fontFamily:'monospace', fontWeight:700 }}>{cc}C</span>}
                                {cn && <CoreDot color={cn} />}
                              </div>
                            );
                          })}
                          {downLinks.length > 4 && <div style={{ fontSize:8, color:'#94a3b8' }}>+{downLinks.length-4} more...</div>}
                        </>)}
                      </>);
                    };

                    // ── BOX ───────────────────────────────────────────────
                    const renderBOX = () => {
                      const upCables = myL.filter(l => l.target_node === node.id && l.link_type === 'FIBER');
                      const splLinks = myL.filter(l => {
                        const peer = l.source_node === node.id ? l.target_node : l.source_node;
                        return nodes.find(n => n.id === peer)?.node_type === 'SPLITTER';
                      });
                      const downDirect = myL.filter(l => l.source_node === node.id &&
                        !splLinks.some(sl => sl.id === l.id));
                      return (<>
                        <R label="Connections">{myL.length}</R>
                        {upCables.length > 0 && (<>
                          <SecHdr>🔵 Upstream Fiber Cables</SecHdr>
                          {upCables.map(lk => {
                            const pn = lk.source_node_name; const sp = lk.source_port; const tp = lk.target_port;
                            const cn = lk.fiber_core_color?.split(/[,→\-–]/)[0]?.trim();
                            const cc = lk.fiber_core_count;
                            return (
                              <div key={lk.id} style={{ display:'flex', alignItems:'center', gap:4, marginBottom:2 }}>
                                <div style={{ width:14,height:14, borderRadius:3, flexShrink:0, background:NODE_STYLE[lk.source_node_type]?.bg||'#374151', display:'flex', alignItems:'center', justifyContent:'center' }} dangerouslySetInnerHTML={{ __html: getNodeSvg(lk.source_node_type,9,9) }} />
                                <span style={{ fontSize:9, fontWeight:600, color:'#0f172a', flex:1 }}>{pn}</span>
                                {sp && <code style={{ fontSize:9, color:'#0369a1', background:'#dbeafe', borderRadius:2, padding:'0 3px' }}>{sp}</code>}
                                {tp && <code style={{ fontSize:9, color:'#15803d', background:'#dcfce7', borderRadius:2, padding:'0 3px' }}>{tp}</code>}
                                {cc && <span style={{ fontSize:9, color:'#0891b2', fontFamily:'monospace', fontWeight:700 }}>{cc}C</span>}
                                {cn && <CoreDot color={cn} />}
                              </div>
                            );
                          })}
                        </>)}
                        {splLinks.length > 0 && (<>
                          <SecHdr>🔀 Splitters Inside ({splLinks.length})</SecHdr>
                          {splLinks.map(lk => {
                            const peerId = lk.source_node === node.id ? lk.target_node : lk.source_node;
                            const spl = nodes.find(n => n.id === peerId);
                            if (!spl) return null;
                            const sp = getSplitterPorts(spl.splitter_ratio);
                            const used = getUsedPorts(spl.id, links);
                            const free = sp.out.filter(p => !used.has(p)).length;
                            const inCn = lk.fiber_core_color?.split(/[,→\-–]/)[0]?.trim();
                            return (
                              <div key={lk.id} style={{ display:'flex', alignItems:'center', gap:4, marginBottom:2,
                                  background:'#f0fdf4', borderRadius:4, padding:'3px 5px' }}>
                                <div style={{ width:12,height:12, borderRadius:3, flexShrink:0, background:NODE_STYLE.SPLITTER.bg, display:'flex', alignItems:'center', justifyContent:'center' }} dangerouslySetInnerHTML={{ __html: getNodeSvg('SPLITTER',8,8) }} />
                                <span style={{ fontSize:9, fontWeight:600, color:'#0f172a', flex:1 }}>{spl.name}</span>
                                <span style={{ fontSize:9, fontFamily:'monospace', color:'#0891b2', fontWeight:700 }}>{spl.splitter_ratio}</span>
                                {inCn && <CoreDot color={inCn} />}
                                <span style={{ fontSize:8, fontWeight:700, color: free > 0 ? '#16a34a':'#ef4444' }}>{free}/{sp.out.length}</span>
                              </div>
                            );
                          })}
                        </>)}
                        {downDirect.length > 0 && (<>
                          <SecHdr>⬇ Direct Downstream</SecHdr>
                          {downDirect.slice(0,3).map(lk => {
                            const pn = lk.target_node_name;
                            const tp = lk.target_port;
                            return (
                              <div key={lk.id} style={{ display:'flex', alignItems:'center', gap:4, marginBottom:2 }}>
                                <div style={{ width:13,height:13, borderRadius:3, flexShrink:0, background:NODE_STYLE[lk.target_node_type]?.bg||'#374151', display:'flex', alignItems:'center', justifyContent:'center' }} dangerouslySetInnerHTML={{ __html: getNodeSvg(lk.target_node_type,8,8) }} />
                                <span style={{ fontSize:9, fontWeight:600, color:'#0f172a', flex:1 }}>{pn}</span>
                                {tp && <code style={{ fontSize:9, color:'#15803d', background:'#dcfce7', borderRadius:2, padding:'0 3px' }}>{tp}</code>}
                              </div>
                            );
                          })}
                        </>)}
                      </>);
                    };

                    // ── SPLITTER ──────────────────────────────────────────
                    const renderSPLITTER = () => {
                      const sp = getSplitterPorts(node.splitter_ratio);
                      const usedPorts = getUsedPorts(node.id, links);
                      const free = sp.out.filter(p => !usedPorts.has(p)).length;
                      const jbLnk = links.find(l => l.target_node === node.id &&
                        nodes.find(n => n.id === l.source_node)?.node_type === 'BOX');
                      const jbNode = jbLnk ? nodes.find(n => n.id === jbLnk.source_node) : null;
                      const inCn = jbLnk?.fiber_core_color?.split(/[,→\-–]/)[0]?.trim();
                      // Output ports
                      const getOut = port => links.find(l =>
                        (l.source_node === node.id && l.source_port === port) ||
                        (l.target_node === node.id && l.target_port === port)
                      );
                      return (<>
                        <R label="Ratio"><span style={{ fontFamily:'monospace', fontWeight:700, color:'#0891b2' }}>{node.splitter_ratio}</span></R>
                        <R label="Free Ports"><span style={{ fontWeight:700, color: free > 0 ? '#16a34a' : '#ef4444' }}>{free}/{sp.out.length}</span></R>
                        {jbNode && (
                          <R label="Inside JB"><span style={{ color:'#059669', fontWeight:600 }}>{jbNode.name}</span></R>
                        )}
                        {/* IN port */}
                        <SecHdr>📥 Input (In)</SecHdr>
                        <div style={{ display:'flex', alignItems:'center', gap:4, marginBottom:2 }}>
                          {jbNode ? (
                            <>
                              <div style={{ width:12,height:12, borderRadius:3, flexShrink:0, background:NODE_STYLE.BOX.bg, display:'flex', alignItems:'center', justifyContent:'center' }} dangerouslySetInnerHTML={{ __html: getNodeSvg('BOX',8,8) }} />
                              <span style={{ fontSize:9, color:'#0f172a', fontWeight:600, flex:1 }}>{jbNode.name}</span>
                              {jbLnk?.fiber_core_count && <span style={{ fontSize:9, color:'#0891b2', fontFamily:'monospace', fontWeight:700 }}>{jbLnk.fiber_core_count}C</span>}
                              {inCn && <CoreDot color={inCn} />}
                              {inCn && <span style={{ fontSize:8, color:'#475569' }}>{inCn}</span>}
                            </>
                          ) : (
                            <span style={{ fontSize:9, color:'#94a3b8', fontStyle:'italic' }}>Not connected</span>
                          )}
                        </div>
                        {/* Output ports */}
                        <SecHdr>📤 Output Ports</SecHdr>
                        {sp.out.map(port => {
                          const conn = getOut(port);
                          const isOut = conn?.source_node === node.id;
                          const pName = conn ? (isOut ? conn.target_node_name : conn.source_node_name) : null;
                          const pType = conn ? (isOut ? conn.target_node_type : conn.source_node_type) : null;
                          const portCn = conn?.fiber_core_color?.split(/[,→\-–]/)[0]?.trim();
                          return (
                            <div key={port} style={{ display:'flex', alignItems:'center', gap:4, marginBottom:2,
                                borderRadius:4, padding:'2px 4px',
                                background: conn ? '#f0fdf4' : '#fafafa',
                                border: `1px ${conn ? 'solid #bbf7d0' : 'dashed #e2e8f0'}` }}>
                              <code style={{ fontSize:8, color: conn ? '#0369a1' : '#94a3b8', background: conn ? '#dbeafe' : '#f1f5f9', borderRadius:2, padding:'0 4px', flexShrink:0 }}>{port}</code>
                              {conn && pType && (
                                <div style={{ width:11,height:11, borderRadius:2, flexShrink:0, background:NODE_STYLE[pType]?.bg||'#374151', display:'flex', alignItems:'center', justifyContent:'center' }} dangerouslySetInnerHTML={{ __html: getNodeSvg(pType,7,7) }} />
                              )}
                              <span style={{ fontSize:9, fontWeight: conn ? 600 : 400,
                                  color: conn ? '#0f172a' : '#94a3b8', flex:1,
                                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                {conn ? pName : '— free'}
                              </span>
                              {portCn && <CoreDot color={portCn} />}
                            </div>
                          );
                        })}
                      </>);
                    };

                    // ── CLIENT ────────────────────────────────────────────
                    const renderCLIENT = () => {
                      const cData = node.client ? clientMarkers.find(c => c.id === node.client) ?? null : null;
                      const optConn = myL[0]; // single fiber connection
                      const peerName = optConn ? (optConn.source_node === node.id ? optConn.target_node_name : optConn.source_node_name) : null;
                      const peerType = optConn ? (optConn.source_node === node.id ? optConn.target_node_type : optConn.source_node_type) : null;
                      const peerPort = optConn ? (optConn.source_node === node.id ? optConn.target_port : optConn.source_port) : null;
                      const coreName = optConn?.fiber_core_color?.split(/[,→\-–]/)[0]?.trim();
                      const today = new Date();
                      const expiry = cData?.expiry_date && cData.expiry_date !== '—' ? new Date(cData.expiry_date) : null;
                      const daysLeft = expiry ? Math.ceil((expiry - today) / 86400000) : null;
                      if (!cData) return <div style={{ fontSize:10, color:'#94a3b8', padding:'4px 0' }}>Loading client data...</div>;
                      return (<>
                        <R label="ID"><code style={{ fontSize:9, background:'#f1f5f9', borderRadius:3, padding:'0 5px' }}>{cData.customer_id}</code></R>
                        <R label="Package">{cData.package_name}</R>
                        <R label="Zone">{cData.zone_name}{cData.subzone_name !== '—' ? ' / '+cData.subzone_name : ''}</R>
                        <R label="Phone">{cData.phone}</R>
                        <R label="Bill"><span style={{ color:'#0891b2', fontWeight:700 }}>৳{cData.monthly_bill}/mo</span></R>
                        <R label="Due"><span style={{ fontWeight:700, color: parseFloat(cData.due_amount) > 0 ? '#dc2626' : '#16a34a' }}>{parseFloat(cData.due_amount) > 0 ? `৳${cData.due_amount}` : '✓ Clear'}</span></R>
                        {expiry && (
                          <R label="Expiry">
                            <span style={{ fontWeight:700, color: daysLeft < 0 ? '#dc2626' : daysLeft <= 5 ? '#d97706' : '#16a34a' }}>
                              {cData.expiry_date}{daysLeft !== null ? ` (${daysLeft < 0 ? Math.abs(daysLeft)+'d ago' : daysLeft+'d left'})` : ''}
                            </span>
                          </R>
                        )}
                        {cData.router_name !== '—' && <R label="Router">{cData.router_name}</R>}
                        {optConn && (<>
                          <SecHdr>📡 Optical Connection</SecHdr>
                          <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                            {peerType && <div style={{ width:13,height:13, borderRadius:3, flexShrink:0, background:NODE_STYLE[peerType]?.bg||'#374151', display:'flex', alignItems:'center', justifyContent:'center' }} dangerouslySetInnerHTML={{ __html: getNodeSvg(peerType,8,8) }} />}
                            <span style={{ fontSize:9, fontWeight:600, color:'#0f172a', flex:1 }}>{peerName}</span>
                            {peerPort && <code style={{ fontSize:9, color:'#0369a1', background:'#dbeafe', borderRadius:2, padding:'0 3px' }}>{peerPort}</code>}
                            {coreName && <CoreDot color={coreName} />}
                            {coreName && <span style={{ fontSize:8, color:'#475569' }}>{coreName}</span>}
                          </div>
                        </>)}
                      </>);
                    };

                    return (
                      <Tooltip direction="top" offset={[0, -18]} opacity={1}>
                        <div style={{ fontFamily:'Inter,sans-serif', minWidth:200, maxWidth:265, fontSize:11 }}>
                          {/* ── Header ── */}
                          <div style={{ display:'flex', alignItems:'center', gap:6,
                              paddingBottom:6, marginBottom:6, borderBottom:'2px solid #f1f5f9' }}>
                            <div style={{ width:26, height:26, borderRadius:6, flexShrink:0, background:ns.bg,
                                display:'flex', alignItems:'center', justifyContent:'center',
                                boxShadow:`0 0 0 2px ${sc}44` }}
                              dangerouslySetInnerHTML={{ __html: getNodeSvg(node.node_type, 15, 15) }}
                            />
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontWeight:800, color:'#0f172a', fontSize:13, lineHeight:1.2,
                                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                {node.name}
                              </div>
                              <div style={{ fontSize:9, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.04em' }}>
                                {ns.label}
                              </div>
                            </div>
                            <span style={{ fontSize:9, fontWeight:700, color:sc, background:`${sc}20`,
                                borderRadius:10, padding:'2px 7px', flexShrink:0, border:`1px solid ${sc}44` }}>
                              ● {node.status}
                            </span>
                          </div>

                          {/* ── Node-specific content ── */}
                          {node.node_type === 'ROUTER'   && renderRouterOLT()}
                          {node.node_type === 'OLT'      && renderRouterOLT()}
                          {node.node_type === 'BOX'      && renderBOX()}
                          {node.node_type === 'SPLITTER' && renderSPLITTER()}
                          {node.node_type === 'CLIENT'   && renderCLIENT()}

                          {/* ── Footer: GPS + hint ── */}
                          <div style={{ marginTop:5, paddingTop:4, borderTop:'1px solid #f1f5f9',
                              display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                            <span style={{ fontSize:8, color:'#94a3b8', fontFamily:'monospace' }}>
                              {parseFloat(node.latitude).toFixed(4)}, {parseFloat(node.longitude).toFixed(4)}
                            </span>
                            <span style={{ fontSize:8, color:'#94a3b8' }}>Click ↗</span>
                          </div>
                        </div>
                      </Tooltip>
                    );
                  })()}
                  {/* NodeActionCard Popup — Edit / Delete / Link সরাসরি map-এ */}
                  <Popup maxWidth={310} minWidth={295}>
                    <NodeActionCard
                      node={node}
                      allNodes={nodes}
                      allLinks={links}
                      clientMarkers={clientMarkers}
                      onEdit={() => { setEditingNode(node); setShowEditModal(true); }}
                      onDeleted={handleNodeDeleted}
                      onLinkCreated={newLink => setLinks(prev => [...prev, newLink])}
                      onLinkDeleted={linkId => setLinks(prev => prev.filter(l => l.id !== linkId))}
                      onLinkUpdated={updatedLink => setLinks(prev => prev.map(l => l.id === updatedLink.id ? updatedLink : l))}
                      onEditLink={link => { setEditingLink(link); setShowEditLinkModal(true); }}
                      onNodeCreated={newNode => {
                        setNodes(prev => [...prev, newNode]);
                        setClientMarkers(prev => prev.filter(c => c.id !== newNode.client));
                      }}
                      onNodeUpdated={upd => setNodes(prev => prev.map(n => n.id === upd.id ? upd : n))}
                      onNodeDeleted={nid => setNodes(prev => prev.filter(n => n.id !== nid))}
                    />
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>

        </div>
      </div>

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      {showNodeModal && pendingLatlng && (
        <AddNodeModal
          latlng={pendingLatlng}
          onClose={() => { setShowNodeModal(false); setPendingLatlng(null); setMode('view'); }}
          onSaved={newNode => {
            setNodes(prev => [...prev, newNode]);
            setShowNodeModal(false);
            setPendingLatlng(null);
            setMode('view');
          }}
        />
      )}
      {showLinkModal && sourceNode && targetNode && (
        <AddLinkModal
          sourceNode={sourceNode}
          targetNode={targetNode}
          paths={drawingPath}
          onClose={() => { setShowLinkModal(false); resetDrawing(); }}
          onSaved={newLink => {
            setLinks(prev => [...prev, newLink]);
            setShowLinkModal(false);
            resetDrawing();
          }}
        />
      )}
      {showEditModal && editingNode && (
        <EditNodeModal
          node={editingNode}
          onClose={() => { setShowEditModal(false); setEditingNode(null); }}
          onUpdated={handleNodeUpdated}
          onDeleted={handleNodeDeleted}
        />
      )}
      {showEditLinkModal && editingLink && (
        <EditLinkModal
          link={editingLink}
          onClose={() => { setShowEditLinkModal(false); setEditingLink(null); }}
          onUpdated={updatedLink => {
            setLinks(prev => prev.map(l => l.id === updatedLink.id ? updatedLink : l));
            setShowEditLinkModal(false);
            setEditingLink(null);
          }}
          onDeleted={linkId => {
            setLinks(prev => prev.filter(l => l.id !== linkId));
            setShowEditLinkModal(false);
            setEditingLink(null);
          }}
        />
      )}
    </div>
  );
}
