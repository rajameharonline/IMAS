// admin_panel/src/pages/network/NetworkTopology.jsx
// ─────────────────────────────────────────────────────────────────────────────
// ISP Network Topology — Dendrogram / DB-schema style (sample screenshots)
//   ● Compact text nodes with tiny type badge + status dot
//   ● Thin smooth bezier curves fanning out left→right
//   ● Hover node → all connected edges glow bright
//   ● Dark hex-dot grid background
//   ● Click node → detail panel top-right
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap, Panel,
  Handle, Position, useNodesState, useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import toast from 'react-hot-toast';
import api from '../../utils/api';

// ─── Config ───────────────────────────────────────────────────────────────────
const TYPE_CFG = {
  ROUTER:   { label:'Core Router',    depth:0, accent:'#60a5fa', icon:'R' },
  OLT:      { label:'OLT Device',     depth:1, accent:'#c084fc', icon:'O' },
  SPLITTER: { label:'Fiber Splitter', depth:2, accent:'#22d3ee', icon:'S' },
  BOX:      { label:'Junction Box',   depth:3, accent:'#4ade80', icon:'B' },
  CLIENT:   { label:'End Client',     depth:4, accent:'#fbbf24', icon:'C' },
};
const STATUS_COLOR = {
  active:'#10b981', inactive:'#ef4444', maintenance:'#f59e0b', unknown:'#475569',
};
const BRANCH_COLORS = [
  '#f97316','#38bdf8','#4ade80','#c084fc',
  '#fb7185','#facc15','#2dd4bf','#a78bfa',
  '#f472b6','#60a5fa','#34d399','#fb923c',
];
const X_GAP  = 360;   // horizontal spacing — আরো spread out
const Y_LEAF = 60;    // vertical spacing between leaves

// ─── Collapse inside-JB Splitters ────────────────────────────────────────────
// সব ID comparisons string-এ করা হচ্ছে — integer/string mismatch এড়াতে
function collapseInsideJBSplitters(rawNodes, rawEdges) {
  const sid = id => String(id);
  const boxIds = new Set(rawNodes.filter(n => n.data?.nodeType === 'BOX').map(n => sid(n.id)));
  const insideIds = new Set();
  const splitterBox = {};   // splitterId(str) → boxId(str)

  rawNodes.filter(n => n.data?.nodeType === 'SPLITTER').forEach(sp => {
    const spId = sid(sp.id);
    const fromBox = rawEdges.filter(e => sid(e.target) === spId && boxIds.has(sid(e.source)));
    if (fromBox.length > 0) {
      insideIds.add(spId);
      splitterBox[spId] = sid(fromBox[0].source);
    }
  });
  if (!insideIds.size) return { nodes: rawNodes, edges: rawEdges };

  const boxSplitters = {};
  insideIds.forEach(spId => {
    const boxId = splitterBox[spId];
    const sp = rawNodes.find(n => sid(n.id) === spId);
    if (!boxSplitters[boxId]) boxSplitters[boxId] = [];
    boxSplitters[boxId].push({ name: sp?.data?.label || spId, ratio: sp?.data?.splitterRatio || '' });
  });

  const cleanEdges = rawEdges
    .filter(e => !(insideIds.has(sid(e.target)) && boxIds.has(sid(e.source))))
    .map(e => {
      const src = sid(e.source);
      return insideIds.has(src)
        ? { ...e, source: splitterBox[src] }   // string boxId
        : e;
    })
    .filter((e, i, arr) =>
      arr.findIndex(x => sid(x.source)===sid(e.source) && sid(x.target)===sid(e.target)) === i
    );

  const cleanNodes = rawNodes
    .filter(n => !insideIds.has(sid(n.id)))
    .map(n => {
      const info = boxSplitters[sid(n.id)];
      return info ? { ...n, data: { ...n.data, insideSplitters: info } } : n;
    });

  return { nodes: cleanNodes, edges: cleanEdges };
}

// ─── Downstream client count ──────────────────────────────────────────────────
function computeClientCounts(nodes, edges) {
  const sid = id => String(id);
  const ch = {};
  nodes.forEach(n => { ch[sid(n.id)] = []; });
  edges.forEach(e => { const s=sid(e.source),t=sid(e.target); if (ch[s] && !ch[s].includes(t)) ch[s].push(t); });
  const counts = {};
  function walk(id, v = new Set()) {
    const k=sid(id); if (v.has(k)) return 0; v.add(k);
    if (nodes.find(n => sid(n.id)===k)?.data?.nodeType === 'CLIENT') return 1;
    return (ch[k]||[]).reduce((s,c) => s + walk(c, new Set(v)), 0);
  }
  nodes.forEach(n => { counts[sid(n.id)] = walk(n.id); });
  return counts;
}

// ─── Tree layout (BFS depth for X, subtree-center for Y) ─────────────────────
function computeTreeLayout(nodes, edges) {
  if (!nodes.length) return nodes;
  const sid = id => String(id);
  const ch = {}, par = {};
  nodes.forEach(n => { ch[sid(n.id)] = []; });
  edges.forEach(e => {
    const s = sid(e.source), t = sid(e.target);
    const srcNode = nodes.find(n => sid(n.id)===s);
    const tgtNode = nodes.find(n => sid(n.id)===t);
    const sd = TYPE_CFG[srcNode?.data?.nodeType]?.depth ?? 99;
    const td = TYPE_CFG[tgtNode?.data?.nodeType]?.depth ?? 99;
    const [fs,ft] = sd<=td ? [s,t] : [t,s];
    if (ch[fs]!==undefined && !ch[fs].includes(ft)) { ch[fs].push(ft); if (!par[ft]) par[ft]=fs; }
  });
  const roots = nodes.filter(n => !par[sid(n.id)]);

  // BFS depth for X — string IDs throughout
  // Real roots = ROUTER nodes; other "root" nodes are isolated (not yet connected)
  const routerRoots = roots.filter(r => r.data?.nodeType === 'ROUTER');
  const bfsRoots    = routerRoots.length > 0 ? routerRoots : roots;

  const xd = {};
  const q = bfsRoots.map(r=>({id:sid(r.id),d:0}));
  while (q.length) {
    const {id,d} = q.shift(); if (xd[id]!==undefined) continue;
    xd[id]=d; (ch[id]||[]).forEach(k => { if (xd[k]===undefined) q.push({id:k,d:d+1}); });
  }
  // Nodes not reached by BFS (isolated) → use TYPE_CFG depth so they appear on the right
  nodes.forEach(n => {
    const k        = sid(n.id);
    const typeDep  = TYPE_CFG[n.data?.nodeType]?.depth ?? 2;
    if (xd[k] === undefined) {
      // Not reachable from any router — use type-based depth
      xd[k] = typeDep;
    } else if (xd[k] === 0 && n.data?.nodeType !== 'ROUTER' && (ch[k] || []).length === 0) {
      // Isolated non-router root with no children — use type-based depth
      xd[k] = typeDep;
    }
  });

  // DFS subtree Y
  let leafY = 0; const yp = {};
  function assignY(id, vis=new Set()) {
    if (vis.has(id)) return; vis.add(id);
    const kids = ch[id]||[];
    if (!kids.length) { yp[id] = leafY++ * Y_LEAF; }
    else { kids.forEach(k=>assignY(k,new Set(vis))); const ys=kids.map(k=>yp[k]??0); yp[id]=(Math.min(...ys)+Math.max(...ys))/2; }
  }
  roots.forEach(r=>assignY(sid(r.id)));
  return nodes.map(n => ({ ...n, position:{ x:(xd[sid(n.id)]??0)*X_GAP+40, y:yp[sid(n.id)]??0 } }));
}

// ─── Branch colors ────────────────────────────────────────────────────────────
function buildBranchColors(nodes, edges) {
  const sid = id => String(id);
  const ch = {}; nodes.forEach(n=>{ch[sid(n.id)]=[];});
  edges.forEach(e=>{const s=sid(e.source);if(ch[s])ch[s].push(sid(e.target));});
  const cm = {};
  nodes.filter(n=>n.data?.nodeType==='ROUTER').forEach(n=>{cm[sid(n.id)]='#64748b';});
  nodes.filter(n=>n.data?.nodeType==='OLT').forEach((olt,i)=>{
    const c=BRANCH_COLORS[i%BRANCH_COLORS.length]; const oid=sid(olt.id); cm[oid]=c;
    const q=[oid],v=new Set([oid]);
    while(q.length){const cur=q.shift();(ch[cur]||[]).forEach(k=>{if(!v.has(k)){v.add(k);cm[k]=c;q.push(k);}});}
  });
  nodes.forEach(n=>{const k=sid(n.id);if(!cm[k])cm[k]='#475569';});
  return cm;
}

// ─── Node component — compact, dendrogram style ───────────────────────────────
function SimpleNode({ data }) {
  const cfg    = TYPE_CFG[data.nodeType] || { accent:'#475569', icon:'?' };
  const sc     = STATUS_COLOR[data.status] || '#6b7280';
  const isDown = data.status === 'inactive';
  const isMaint= data.status === 'maintenance';
  const isActive = data.status === 'active';
  const borderAccent = isDown ? '#ef444455' : isMaint ? '#f59e0b40' : `${cfg.accent}35`;
  const isHL   = data.isHighlighted;
  const ins    = data.insideSplitters || [];

  return (
    <div style={{
      position:'relative',
      display:'inline-flex', flexDirection:'column',
      background: isHL
        ? `linear-gradient(90deg, ${cfg.accent}1c, rgba(10,18,35,0.98))`
        : isDown
          ? 'rgba(22,5,5,0.95)'
          : 'rgba(10,17,32,0.95)',
      border:`1px solid ${isHL ? cfg.accent+'65' : borderAccent}`,
      borderLeft:`3px solid ${isDown?'#ef4444':isMaint?'#f59e0b':cfg.accent}`,
      borderRadius:'0 8px 8px 0',
      backdropFilter:'blur(14px)',
      boxShadow: isHL
        ? `0 0 0 1px ${cfg.accent}28, 0 6px 24px rgba(0,0,0,0.65), 0 0 30px ${cfg.accent}20`
        : `0 2px 14px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03)`,
      cursor:'pointer',
      transition:'all 0.2s',
      minWidth:145, maxWidth:215,
    }}>
      {/* Input handle — LEFT */}
      <Handle type="target" position={Position.Left} style={{
        width:7, height:7,
        background: isDown ? '#ef4444' : cfg.accent,
        border:'none', left:-3.5,
        opacity:0.75,
        boxShadow: isHL ? `0 0 8px ${cfg.accent}` : 'none',
        transition:'box-shadow 0.18s',
      }} />

      {/* Main row */}
      <div style={{ display:'flex', alignItems:'center', gap:7, padding:'7px 11px 7px 8px' }}>
        {/* Type badge */}
        <div style={{
          width:18, height:18, borderRadius:4, flexShrink:0,
          background:`${cfg.accent}22`, border:`1px solid ${cfg.accent}40`,
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:8, fontWeight:900, color:cfg.accent,
          transition:'background 0.15s',
        }}>{cfg.icon}</div>

        {/* Name */}
        <span style={{
          fontSize:12.5, flex:1, minWidth:0,
          color: isDown ? '#fca5a5cc' : isHL ? '#ffffff' : 'rgba(195,220,250,0.92)',
          fontFamily:'"Inter", sans-serif',
          fontWeight: isHL ? 600 : 500,
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
          letterSpacing:0.1, lineHeight:1,
          transition:'color 0.15s',
        }}>
          {data.label}
        </span>

        {/* Client count */}
        {data.clientCount > 0 && data.nodeType !== 'CLIENT' && (
          <span style={{
            fontSize:8.5, color:`${cfg.accent}88`,
            background:`${cfg.accent}14`, borderRadius:4,
            padding:'1px 5px', flexShrink:0, fontFamily:'monospace', fontWeight:700,
          }}>
            {data.clientCount}
          </span>
        )}

        {/* Collapse/Expand toggle — শুধু child আছে এমন node-এ */}
        {data.hasChildren && (
          <div style={{
            display:'flex', alignItems:'center', gap:2, flexShrink:0,
            padding:'2px 4px', borderRadius:4, cursor:'pointer',
            background: data.isCollapsed ? `${cfg.accent}22` : 'rgba(255,255,255,0.04)',
            border:`1px solid ${data.isCollapsed ? cfg.accent+'55' : 'rgba(255,255,255,0.08)'}`,
            transition:'all 0.18s',
          }}>
            {/* collapsed হলে hidden count দেখাও */}
            {data.isCollapsed && data.collapsedCount > 0 && (
              <span style={{
                fontSize:7, fontWeight:800, color:cfg.accent,
                fontFamily:'monospace', letterSpacing:0.2,
              }}>+{data.collapsedCount}</span>
            )}
            {/* Chevron: ▶ collapsed, ▼ expanded */}
            <svg width="6" height="6" viewBox="0 0 8 8"
              style={{ flexShrink:0 }}
              fill={data.isCollapsed ? cfg.accent : '#64748b'}>
              {data.isCollapsed
                ? <polygon points="2,1 7,4 2,7" />
                : <polygon points="1,2 4,7 7,2" />
              }
            </svg>
          </div>
        )}

        {/* Status dot */}
        <div style={{
          width:7, height:7, borderRadius:'50%', flexShrink:0,
          background:sc,
          boxShadow: isActive ? `0 0 7px ${sc}` : 'none',
          transition:'box-shadow 0.15s',
        }} />
      </div>

      {/* Inside splitters row — only for BOX */}
      {ins.length > 0 && (
        <div style={{
          display:'flex', gap:3, flexWrap:'wrap',
          padding:'0 7px 5px 7px', marginTop:-1,
        }}>
          {ins.map((sp,i) => (
            <span key={i} style={{
              fontSize:7.5, color:'#22d3ee88',
              background:'#22d3ee0d', border:'1px solid #22d3ee1a',
              borderRadius:3, padding:'0 4px',
              fontFamily:'monospace',
            }}>
              {sp.name}{sp.ratio?` (${sp.ratio})`:''}
            </span>
          ))}
        </div>
      )}

      {/* Output handle — RIGHT (fan-out origin) */}
      <Handle type="source" position={Position.Right} style={{
        width:9, height:9,
        background: isDown ? '#ef4444' : cfg.accent,
        border:'2px solid rgba(0,0,0,0.4)', right:-4.5,
        boxShadow: isHL ? `0 0 12px ${cfg.accent}, 0 0 4px ${cfg.accent}` : `0 0 6px ${cfg.accent}60`,
        transition:'box-shadow 0.18s',
      }} />
    </div>
  );
}

// ─── Edge component — always-on traffic flow (download ↔ upload) ─────────────
// download = source→target (ISP → client, left→right)  → বড় উজ্জ্বল ডট
// upload   = target→source (client → ISP, right→left)  → ছোট ম্লান ডট
function SimpleEdge({ sourceX, sourceY, targetX, targetY, data }) {
  const color    = data?.color || '#1e3a5f';
  const isHL     = data?.isHighlighted || false;
  const isActive = data?.isActive !== false;

  const dx     = Math.abs(targetX - sourceX);
  const offset = Math.min(dx * 0.52, 160);

  // Download path: source → target
  const d = `M ${sourceX} ${sourceY} C ${sourceX+offset} ${sourceY}, ${targetX-offset} ${targetY}, ${targetX} ${targetY}`;
  // Upload path: target → source (reversed bezier)
  const dRev = `M ${targetX} ${targetY} C ${targetX-offset} ${targetY}, ${sourceX+offset} ${sourceY}, ${sourceX} ${sourceY}`;

  // Inactive link — faint dashed line, no animation
  if (!isActive) {
    return (
      <g>
        <path d={d} fill="none" stroke="#ef444420" strokeWidth={0.8}
          strokeDasharray="4,7" strokeLinecap="round" />
      </g>
    );
  }

  const pathLen = Math.sqrt(dx * dx + (targetY - sourceY) ** 2);
  const durDown = Math.max(0.8, Math.min(2.4, pathLen / 270));   // download faster
  const durUp   = Math.max(1.3, Math.min(3.8, pathLen / 170));   // upload slower

  // Size & opacity — hover করলে বড় ও উজ্জ্বল
  const dlR1   = isHL ? 5.5  : 3.2;   // download primary dot radius
  const dlR2   = isHL ? 3    : 1.8;   // download trailing dot
  const ulR    = isHL ? 3.5  : 2.0;   // upload dot
  const dlOp1  = isHL ? 0.95 : 0.78;
  const dlOp2  = isHL ? 0.50 : 0.42;
  const ulOp   = isHL ? 0.65 : 0.45;

  const dlFilter = isHL
    ? `drop-shadow(0 0 6px ${color}) drop-shadow(0 0 2px #fff)`
    : `drop-shadow(0 0 4px ${color}aa)`;
  const ulFilter = isHL ? `drop-shadow(0 0 4px ${color}88)` : 'none';

  return (
    <g>
      {/* ── Glow layers — hover only ── */}
      {isHL && (
        <>
          <path d={d} fill="none" stroke={color} strokeWidth={26} opacity={0.05} />
          <path d={d} fill="none" stroke={color} strokeWidth={9}  opacity={0.13} />
          <path d={d} fill="none" stroke={color} strokeWidth={3}  opacity={0.52} strokeLinecap="round" />
        </>
      )}

      {/* ── Base line — always on, branch-colored ── */}
      <path d={d} fill="none"
        stroke={color}
        strokeWidth={isHL ? 2 : 1.3}
        opacity={isHL ? 0.88 : 0.45}
        strokeLinecap="round"
      />

      {/* ── Download: source → target  (left → right) ── always on ── */}
      {/* Primary packet */}
      <circle r={dlR1} fill={color} opacity={dlOp1}
        style={{ filter: dlFilter }}>
        <animateMotion dur={`${durDown}s`} repeatCount="indefinite" path={d} />
      </circle>
      {/* Trailing packet */}
      <circle r={dlR2} fill={color} opacity={dlOp2}>
        <animateMotion
          dur={`${durDown}s`}
          begin={`-${(durDown * 0.42).toFixed(2)}s`}
          repeatCount="indefinite" path={d}
        />
      </circle>

      {/* ── Upload: target → source  (right → left) ── always on, dimmer ── */}
      <circle r={ulR} fill={color} opacity={ulOp}
        style={{ filter: ulFilter }}>
        <animateMotion dur={`${durUp}s`} repeatCount="indefinite" path={dRev} />
      </circle>
    </g>
  );
}

// ─── Main NetworkTopology ─────────────────────────────────────────────────────
export default function NetworkTopology() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading]            = useState(true);
  const [stats, setStats]                = useState({ total:0, active:0, inactive:0, maintenance:0, edges:0 });
  const [selectedNode, setSelectedNode]  = useState(null);
  const [hoveredId, setHoveredId]        = useState(null);
  const [selectedEdge, setSelectedEdge]  = useState(null);
  const [flipping, setFlipping]          = useState(false);

  // Source of truth — full unfiltered dataset (collapse/expand করেও এগুলো অপরিবর্তিত থাকে)
  const [allNodes, setAllNodes]         = useState([]);
  const [allEdges, setAllEdges]         = useState([]);
  // Collapsed node IDs — এদের descendants লুকিয়ে রাখা হবে
  const [collapsedIds, setCollapsedIds] = useState(new Set());

  const nodeTypes = useMemo(() => ({ networkNode: SimpleNode }), []);
  const edgeTypes = useMemo(() => ({ trafficEdge: SimpleEdge }), []);

  // ── Children map — allEdges থেকে প্রতিটি node-এর direct children ──────────
  const childrenMap = useMemo(() => {
    const sid = id => String(id);
    const ch  = {};
    allNodes.forEach(n => { ch[sid(n.id)] = []; });
    allEdges.forEach(e => {
      const s = sid(e.source), t = sid(e.target);
      if (ch[s] !== undefined && !ch[s].includes(t)) ch[s].push(t);
    });
    return ch;
  }, [allNodes, allEdges]);

  // ── Hidden IDs — collapsed node-দের সব descendants ──────────────────────────
  const hiddenIds = useMemo(() => {
    const hidden = new Set();
    const addDesc = id => {
      (childrenMap[String(id)] || []).forEach(c => {
        if (!hidden.has(c)) { hidden.add(c); addDesc(c); }
      });
    };
    collapsedIds.forEach(id => addDesc(String(id)));
    return hidden;
  }, [collapsedIds, childrenMap]);

  // ── Count all descendants of a node (collapsed badge-এ দেখানোর জন্য) ────────
  const countDesc = useCallback(id => {
    const visited = new Set();
    const q = [String(id)];
    while (q.length) {
      const cur = q.shift();
      (childrenMap[cur] || []).forEach(c => { if (!visited.has(c)) { visited.add(c); q.push(c); } });
    }
    return visited.size;
  }, [childrenMap]);

  const onNodeMouseEnter = useCallback((_ev, node) => { setHoveredId(node.id); }, []);
  const onNodeMouseLeave = useCallback(() => { setHoveredId(null); }, []);

  // ── Process topology ──────────────────────────────────────────────────────
  const processTopology = useCallback((rawNodes, rawEdges) => {
    const { nodes: cNodes, edges: cEdgesRaw } = collapseInsideJBSplitters(rawNodes, rawEdges);
    const depthOf = {};
    cNodes.forEach(n => { depthOf[n.id] = TYPE_CFG[n.data?.nodeType]?.depth ?? 99; });
    const cEdges = cEdgesRaw.map(e =>
      (depthOf[e.source]??99) > (depthOf[e.target]??99) ? {...e,source:e.target,target:e.source} : e
    );
    const branchColors = buildBranchColors(cNodes, cEdges);
    const clientCounts = computeClientCounts(cNodes, cEdges);
    const enrichedNodes = cNodes.map(n => ({
      ...n, type:'networkNode',
      data: { ...n.data, branchColor:branchColors[String(n.id)]||'#475569', clientCount:clientCounts[String(n.id)]||0 },
    }));
    const laidOut = computeTreeLayout(enrichedNodes, cEdges);
    const nodesWithHL = laidOut.map(n => ({ ...n, data: { ...n.data, isHighlighted:false, hasChildren:false, isCollapsed:false, collapsedCount:0 } }));
    const coloredEdges = cEdges.map(e => ({
      ...e, type:'trafficEdge', animated:false,
      data: { ...e.data, color:branchColors[String(e.target)]||branchColors[String(e.source)]||'#1e3a5f', isActive:e.data?.status!=='inactive'&&e.data?.status!=='offline', isHighlighted:false },
    }));
    return { nodes: nodesWithHL, edges: coloredEdges };
  }, []);

  // ── Fetch — allNodes/allEdges source of truth ─────────────────────────────
  const fetchTopology = useCallback(async () => {
    setLoading(true); setHoveredId(null); setCollapsedIds(new Set());
    try {
      const res = await api.get('/network/topology/');
      const rn = res.data.nodes || [];
      const re = res.data.edges || [];
      const { nodes: laidOut, edges: coloredEdges } = processTopology(rn, re);
      setAllNodes(laidOut);
      setAllEdges(coloredEdges);
      setStats({
        total:rn.length, active:rn.filter(n=>n.data?.status==='active').length,
        inactive:rn.filter(n=>n.data?.status==='inactive').length,
        maintenance:rn.filter(n=>n.data?.status==='maintenance').length,
        edges:re.length,
      });
    } catch { toast.error('Failed to load topology.'); }
    finally { setLoading(false); }
  }, [processTopology]);

  useEffect(() => { fetchTopology(); }, [fetchTopology]);

  // ── Sync visible nodes → ReactFlow (collapse + highlight একসাথে) ───────────
  useEffect(() => {
    if (!allNodes.length) return;
    setNodes(allNodes
      .filter(n => !hiddenIds.has(String(n.id)))
      .map(n => {
        const sid       = String(n.id);
        const children  = childrenMap[sid] || [];
        const collapsed = collapsedIds.has(sid);
        return {
          ...n,
          data: {
            ...n.data,
            hasChildren:    children.length > 0,
            isCollapsed:    collapsed,
            collapsedCount: collapsed ? countDesc(n.id) : 0,
            isHighlighted:  sid === String(hoveredId),
          },
        };
      })
    );
  }, [allNodes, hiddenIds, childrenMap, collapsedIds, hoveredId, countDesc, setNodes]);

  // ── Sync visible edges → ReactFlow ────────────────────────────────────────
  useEffect(() => {
    if (!allEdges.length) return;
    setEdges(allEdges
      .filter(e => !hiddenIds.has(String(e.source)) && !hiddenIds.has(String(e.target)))
      .map(e => ({
        ...e,
        data: {
          ...e.data,
          isHighlighted: hoveredId
            ? (String(e.source) === String(hoveredId) || String(e.target) === String(hoveredId))
            : false,
        },
      }))
    );
  }, [allEdges, hiddenIds, hoveredId, setEdges]);

  // ── Drag: position allNodes-এও update ────────────────────────────────────
  const onNodeDragStop = useCallback(async (_ev, node) => {
    setAllNodes(prev => prev.map(n => n.id === node.id ? { ...n, position: node.position } : n));
    try { await api.patch(`/network/nodes/${node.id}/position/`, { pos_x:Math.round(node.position.x), pos_y:Math.round(node.position.y) }); } catch {}
  }, []);

  // ── Click: detail panel + collapse toggle ────────────────────────────────
  const onNodeClick = useCallback((_ev, n) => {
    setSelectedNode(n.data);
    setSelectedEdge(null);
    const sid = String(n.id);
    if ((childrenMap[sid] || []).length > 0) {
      setCollapsedIds(prev => {
        const next = new Set(prev);
        if (next.has(sid)) next.delete(sid); else next.add(sid);
        return next;
      });
    }
  }, [childrenMap]);

  const onEdgeClick    = useCallback((_ev, e) => {
    if (!e.data?.linkId) return;
    setSelectedEdge({ id:e.id, linkId:e.data.linkId, sourceId:e.source, targetId:e.target });
    setSelectedNode(null);
  }, []);
  const flipLink = useCallback(async () => {
    if (!selectedEdge?.linkId) return; setFlipping(true);
    try { await api.patch(`/network/links/${selectedEdge.linkId}/flip/`); toast.success('Link flipped.'); setSelectedEdge(null); await fetchTopology(); }
    catch { toast.error('Failed.'); } finally { setFlipping(false); }
  }, [selectedEdge, fetchTopology]);

  const healthPct   = stats.total > 0 ? Math.round((stats.active/stats.total)*100) : 100;
  const healthColor = healthPct >= 90 ? '#10b981' : healthPct >= 70 ? '#f59e0b' : '#ef4444';

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', background:'#07111e', fontFamily:'Inter, sans-serif' }}>

      {/* ── Header — 2-row compact layout (mobile-friendly) ─────────────── */}
      <div style={{
        flexShrink:0, padding:'7px 12px',
        background:'rgba(4,8,18,0.98)',
        borderBottom:'1px solid rgba(255,255,255,0.05)',
        backdropFilter:'blur(10px)',
      }}>
        {/* Row 1: icon + title + refresh */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, minWidth:0 }}>
            <div style={{
              width:28, height:28, borderRadius:7, flexShrink:0,
              background:'linear-gradient(135deg,#1d4ed8,#3b82f6)',
              display:'flex', alignItems:'center', justifyContent:'center',
              boxShadow:'0 0 12px #3b82f640',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round">
                <circle cx="5" cy="12" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="5" r="2"/>
                <circle cx="12" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
                <line x1="7" y1="12" x2="10" y2="6.5"/><line x1="7" y1="12" x2="10" y2="17.5"/>
                <line x1="14" y1="5" x2="17" y2="5"/><line x1="14" y1="19" x2="17" y2="19"/>
              </svg>
            </div>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:800, color:'#dde8f8', letterSpacing:-0.3, lineHeight:1 }}>
                Network <span style={{ color:'#60a5fa' }}>Topology</span>
              </div>
              <div style={{ fontSize:8.5, color:'#1a3050', marginTop:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                Live traffic · Click to expand/collapse
              </div>
            </div>
          </div>
          {/* Refresh button */}
          <button onClick={fetchTopology} style={{
            flexShrink:0,
            background:'rgba(4,25,12,0.9)', color:'#4ade80',
            border:'1px solid #15803d28', borderRadius:16,
            padding:'6px 12px', fontSize:11, fontWeight:600,
            cursor:'pointer', display:'flex', alignItems:'center', gap:4,
            minHeight:34, touchAction:'manipulation',
          }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.18-8.49"/>
            </svg>
            Refresh
          </button>
        </div>

        {/* Row 2: health + stats — horizontal scroll, no wrap */}
        <div className="topo-stats-row" style={{
          display:'flex', alignItems:'center', gap:5,
          overflowX:'auto', paddingBottom:1, marginTop:7,
        }}>
          {/* Health badge */}
          <div style={{
            flexShrink:0, display:'flex', alignItems:'center', gap:5,
            background:'rgba(8,16,32,0.95)', border:`1px solid ${healthColor}25`,
            borderRadius:16, padding:'4px 10px',
          }}>
            <div style={{ width:5, height:5, borderRadius:'50%', background:healthColor, boxShadow:`0 0 6px ${healthColor}`, animation:'pulse 2s ease-in-out infinite' }} />
            <span style={{ fontSize:10, fontWeight:700, color:healthColor, whiteSpace:'nowrap' }}>{healthPct}% Healthy</span>
          </div>

          {[
            { v:stats.total,       l:'NODES',  c:'#3b82f6', dark:'#0e1e3d' },
            { v:stats.active,      l:'ACTIVE', c:'#10b981', dark:'#032010' },
            { v:stats.inactive,    l:'OFFLINE',c:'#ef4444', dark:'#1e0505', alert:stats.inactive>0 },
            { v:stats.maintenance, l:'MAINT',  c:'#f59e0b', dark:'#1c1000' },
            { v:stats.edges,       l:'LINKS',  c:'#8b5cf6', dark:'#100830' },
          ].map(s => (
            <div key={s.l} style={{
              flexShrink:0,
              background:`${s.dark}ee`, borderRadius:14, padding:'3px 10px',
              textAlign:'center', minWidth:38, color:'#fff',
              border:`1px solid ${s.c}${s.alert?'50':'18'}`,
              animation: s.alert ? 'alertBlink 2s ease-in-out infinite' : 'none',
            }}>
              <div style={{ fontSize:13, fontWeight:800, lineHeight:1, letterSpacing:-0.5 }}>{s.v}</div>
              <div style={{ fontSize:6.5, opacity:0.65, textTransform:'uppercase', letterSpacing:0.8, marginTop:1 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Canvas ──────────────────────────────────────────────────────── */}
      <div style={{ flex:1, position:'relative', overflow:'hidden' }}>

        {/* ── Selected Node Detail — desktop: top-right overlay, mobile: bottom sheet ── */}
        {selectedNode && (() => {
          const cfg    = TYPE_CFG[selectedNode.nodeType] || { accent:'#475569', icon:'?' };
          const sc     = STATUS_COLOR[selectedNode.status] || '#6b7280';
          const isDown = selectedNode.status === 'inactive';
          return (
            <div className="topo-node-panel" style={{
              position:'absolute', top:10, right:10, zIndex:20,
              background: isDown ? 'rgba(15,3,3,0.98)' : 'rgba(4,8,20,0.98)',
              backdropFilter:'blur(18px)',
              border:`1.5px solid ${isDown?'#ef444450':cfg.accent+'40'}`,
              borderRadius:12, padding:'13px 16px', width:230,
              boxShadow:`0 0 24px ${isDown?'#ef444418':cfg.accent+'14'}, 0 8px 32px rgba(0,0,0,0.8)`,
            }}>
              {/* Mobile drag handle */}
              <div className="topo-drag-handle" style={{ display:'none', justifyContent:'center', marginBottom:10 }}>
                <div style={{ width:36, height:4, borderRadius:2, background:'rgba(255,255,255,0.15)' }} />
              </div>
              {/* Header */}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <div style={{
                    width:28, height:28, borderRadius:7, flexShrink:0,
                    background:`${isDown?'#ef4444':cfg.accent}18`,
                    border:`1px solid ${isDown?'#ef444435':cfg.accent+'30'}`,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:10, fontWeight:900, color:isDown?'#ef4444':cfg.accent,
                  }}>{cfg.icon}</div>
                  <div>
                    <div style={{ fontSize:7, textTransform:'uppercase', letterSpacing:1.2, fontWeight:700, color:isDown?'#ef4444':cfg.accent, marginBottom:3 }}>{cfg.label}</div>
                    <div style={{ fontSize:15, fontWeight:800, color:isDown?'#fca5a5':'#dde8f8', letterSpacing:-0.3 }}>{selectedNode.label}</div>
                  </div>
                </div>
                <button onClick={()=>setSelectedNode(null)}
                  style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.08)', cursor:'pointer', color:'#94a3b8', fontSize:12, padding:'4px 7px', borderRadius:6, minWidth:28, minHeight:28 }}>
                  ✕
                </button>
              </div>
              {/* Status */}
              <div style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 9px', borderRadius:7, marginBottom:9, background:`${sc}0e`, border:`1px solid ${sc}22` }}>
                <div style={{ width:7, height:7, borderRadius:'50%', background:sc, boxShadow:selectedNode.status==='active'?`0 0 8px ${sc}`:'none' }} />
                <span style={{ fontSize:11, fontWeight:700, color:sc }}>{selectedNode.status || '—'}</span>
                {isDown && <span style={{ fontSize:9, color:'#ef444488', marginLeft:'auto' }}>⚠ Service Down</span>}
              </div>
              {/* Info rows */}
              {[
                { l:'IP Address', v:selectedNode.ip,        mono:true },
                { l:'Router',     v:selectedNode.routerName            },
                { l:'Downstream', v:selectedNode.clientCount>0?`${selectedNode.clientCount} clients`:null, warn:isDown },
              ].filter(r=>r.v).map(row=>(
                <div key={row.l} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:7 }}>
                  <span style={{ color:'#152840', fontSize:11 }}>{row.l}</span>
                  <span style={{ color:row.warn&&isDown?'#ef4444':'#4d7fa8', fontSize:11, fontFamily:row.mono?'"JetBrains Mono",monospace':'inherit', fontWeight:row.warn?700:400 }}>{row.v}</span>
                </div>
              ))}
              {selectedNode.insideSplitters?.length > 0 && (
                <div style={{ borderTop:'1px solid rgba(255,255,255,0.04)', paddingTop:8, marginTop:4 }}>
                  <div style={{ fontSize:7.5, textTransform:'uppercase', letterSpacing:1, color:'#22d3ee40', fontWeight:700, marginBottom:5 }}>Inside Splitters</div>
                  {selectedNode.insideSplitters.map((sp,i)=>(
                    <div key={i} style={{ display:'flex', justifyContent:'space-between', marginBottom:4, fontSize:11 }}>
                      <span style={{ color:'#1e3a5f' }}>{sp.name}</span>
                      <span style={{ color:'#22d3ee80', fontFamily:'monospace' }}>{sp.ratio}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Edge Flip Panel — desktop: top-left, mobile: bottom sheet ── */}
        {selectedEdge && (
          <div className="topo-edge-panel" style={{
            position:'absolute', top:10, left:10, zIndex:20,
            background:'rgba(4,8,18,0.98)', backdropFilter:'blur(16px)',
            border:'1px solid #f9731648', borderRadius:11, padding:'12px 15px', width:210,
            boxShadow:'0 0 18px #f9731615, 0 8px 28px rgba(0,0,0,0.7)',
          }}>
            <div className="topo-drag-handle" style={{ display:'none', justifyContent:'center', marginBottom:8 }}>
              <div style={{ width:36, height:4, borderRadius:2, background:'rgba(255,255,255,0.15)' }} />
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
              <span style={{ fontSize:7.5, textTransform:'uppercase', letterSpacing:1.3, fontWeight:700, color:'#f97316' }}>Link Selected</span>
              <button onClick={()=>setSelectedEdge(null)}
                style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.08)', cursor:'pointer', color:'#94a3b8', fontSize:12, padding:'3px 7px', borderRadius:6 }}>
                ✕
              </button>
            </div>
            <p style={{ margin:'0 0 10px', fontSize:10.5, color:'#2d4156', lineHeight:1.5 }}>Flip link direction.</p>
            <button onClick={flipLink} disabled={flipping} style={{
              width:'100%', background:flipping?'#0f1825':'linear-gradient(135deg,#f97316,#ea580c)',
              color:'#fff', border:'none', borderRadius:7, padding:'10px 0', fontSize:12, fontWeight:700,
              cursor:flipping?'not-allowed':'pointer', opacity:flipping?0.5:1,
              display:'flex', alignItems:'center', justifyContent:'center', gap:6,
              minHeight:44, touchAction:'manipulation',
            }}>
              {flipping ? '⏳' : '⇄  Flip Link Direction'}
            </button>
          </div>
        )}
        {loading ? (
          <div style={{
            display:'flex', alignItems:'center', justifyContent:'center',
            height:'100%', gap:12, color:'#1e3a5f', fontSize:13,
            background:'radial-gradient(ellipse at 20% 50%,#0a1525 0%,#07111e 70%)',
          }}>
            <div style={{ width:20, height:20, borderRadius:'50%', border:'2px solid #1e40af30', borderTopColor:'#60a5fa', animation:'spin 0.8s linear infinite' }} />
            Loading…
          </div>
        ) : nodes.length === 0 ? (
          <div style={{
            display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
            height:'100%', background:'radial-gradient(ellipse at 20% 50%,#0a1525 0%,#07111e 70%)',
          }}>
            <div style={{ fontSize:48, opacity:0.06, color:'#60a5fa', marginBottom:14 }}>⬡</div>
            <p style={{ margin:0, fontSize:13, fontWeight:700, color:'#1e3a5f' }}>No topology data.</p>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick} onEdgeClick={onEdgeClick}
            onNodeMouseEnter={onNodeMouseEnter} onNodeMouseLeave={onNodeMouseLeave}
            onPaneClick={() => { setSelectedNode(null); setSelectedEdge(null); setHoveredId(null); }}
            nodeTypes={nodeTypes} edgeTypes={edgeTypes}
            fitView fitViewOptions={{ padding:0.25 }}
            minZoom={0.03} maxZoom={5} colorMode="dark"
            style={{ background:'radial-gradient(ellipse 90% 80% at 15% 50%,#0a1828 0%,#06101c 60%)' }}
          >
            {/* Hex dot grid — like sample screenshot */}
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1.5}
              color="rgba(60,100,200,0.20)"
            />

            <Controls style={{
              background:'rgba(4,8,18,0.97)', border:'1px solid rgba(255,255,255,0.05)',
              borderRadius:9, boxShadow:'0 4px 18px rgba(0,0,0,0.5)',
            }} />

            <MiniMap style={{
              background:'rgba(4,7,16,0.98)', border:'1px solid rgba(255,255,255,0.05)',
              borderRadius:9,
            }}
              nodeColor={n => TYPE_CFG[n.data?.nodeType]?.accent || '#374151'}
              nodeStrokeWidth={0} maskColor="rgba(0,0,0,0.7)"
            />

          </ReactFlow>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform:rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.45} }
        @keyframes alertBlink { 0%,100%{box-shadow:0 2px 8px currentColor} 50%{box-shadow:0 0 16px currentColor} }
        .react-flow__node { transition:filter 0.15s; }
        .react-flow__node:hover > div { filter:brightness(1.08); }
        .react-flow__node.selected > div > div:first-child {
          border-color: rgba(96,165,250,0.5) !important;
        }
        .react-flow__controls-button {
          background:rgba(4,8,18,0.98) !important;
          border-bottom:1px solid rgba(255,255,255,0.04) !important;
          color:#2d5a80 !important; fill:#2d5a80 !important;
        }
        .react-flow__controls-button:hover { background:rgba(10,20,40,0.98) !important; color:#60a5fa !important; fill:#60a5fa !important; }

        /* ── Stats row — hide scrollbar ── */
        .topo-stats-row { -ms-overflow-style:none; scrollbar-width:none; }
        .topo-stats-row::-webkit-scrollbar { display:none; }

        /* ── Mobile responsive ── */
        @media (max-width: 640px) {
          /* MiniMap — ছোট স্ক্রিনে লুকানো */
          .react-flow__minimap { display:none !important; }

          /* Controls — বাম নিচে, ছোট */
          .react-flow__controls { transform:scale(0.88); transform-origin:bottom left; }

          /* Node detail panel — bottom sheet */
          .topo-node-panel {
            top: auto !important;
            bottom: 0 !important;
            right: 0 !important;
            left: 0 !important;
            width: 100% !important;
            max-height: 60vh !important;
            overflow-y: auto !important;
            border-radius: 16px 16px 0 0 !important;
            border-left: none !important;
            border-right: none !important;
            border-bottom: none !important;
          }
          /* Edge flip panel — bottom sheet, above node panel */
          .topo-edge-panel {
            top: auto !important;
            bottom: 0 !important;
            left: 0 !important;
            right: 0 !important;
            width: 100% !important;
            border-radius: 16px 16px 0 0 !important;
            border-left: none !important;
            border-right: none !important;
            border-bottom: none !important;
          }
          /* Drag handle দেখানো mobile-এ */
          .topo-drag-handle { display:flex !important; }
        }
      `}</style>
    </div>
  );
}
