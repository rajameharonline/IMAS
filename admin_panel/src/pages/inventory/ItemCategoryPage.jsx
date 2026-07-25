// Item Category — ISP hardware taxonomy tree।
// Sample Item Category: OLT, ONU, Router, Switch, Splitter, Cable ইত্যাদি
// pre-built ISP category tree একক click-এ database-এ copy করা যাবে।
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, RefreshCw, SquarePen, Trash2, ChevronRight, Search } from 'lucide-react';
import api from '../../utils/api';
import { asList, formatApiError } from '../bandwidth/bandwidthHelpers';

// ── Tree helpers ──────────────────────────────────────────────────
function buildTree(rows) {
  const map = {};
  const roots = [];
  rows.forEach((r) => { map[r.id] = { ...r, _children: [] }; });
  rows.forEach((r) => {
    if (r.parent) {
      map[r.parent]?._children.push(map[r.id]);
    } else {
      roots.push(map[r.id]);
    }
  });
  return roots;
}

// ── Category Tree Node ────────────────────────────────────────────
function CatNode({ node, depth, onEdit, onDelete }) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = node._children?.length > 0;
  const indent = depth * 20;

  return (
    <div>
      <div
        className="flex items-center justify-between py-2.5 px-3 hover:bg-gray-50/60 rounded-lg transition-colors group"
        style={{ paddingLeft: `${12 + indent}px` }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {hasChildren ? (
            <button onClick={() => setOpen((o) => !o)}
              className="shrink-0 text-slate-400 hover:text-slate-600">
              <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
            </button>
          ) : (
            <span className="shrink-0 h-3.5 w-3.5 flex items-center justify-center text-slate-300 text-[10px]">
              {depth > 0 ? '─' : '└'}
            </span>
          )}
          <span className="text-sm font-semibold text-slate-800 truncate">{node.name}</span>
          {node.description && (
            <span className="text-xs text-slate-500 truncate hidden sm:inline">
              &nbsp; ({node.description})
            </span>
          )}
          {hasChildren && (
            <span className="shrink-0 text-[11px] text-slate-400 font-normal">
              — {node._children.length} Sub-{node._children.length === 1 ? 'Category' : 'Categories'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button onClick={() => onEdit(node)}
            className="px-2.5 py-1 rounded border border-slate-200 text-[11px] font-semibold text-cyan-600 hover:bg-cyan-50">
            Edit
          </button>
          <button onClick={() => onDelete(node)}
            className="px-2.5 py-1 rounded border border-slate-200 text-[11px] font-semibold text-rose-600 hover:bg-rose-50">
            Delete
          </button>
        </div>
      </div>
      {open && hasChildren && (
        <div className="border-l border-slate-200 ml-5">
          {node._children.map((child) => (
            <CatNode key={child.id} node={child} depth={depth + 1} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sample Data Preview Node ───────────────────────────────────────
function SampleNode({ item }) {
  const [open, setOpen] = useState(item.depth < 1);
  if (item.depth > 0) return null; // top-level only in initial render — handled by flat loop below
  return null;
}

export default function ItemCategoryPage() {
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');

  // Add/Edit modal
  const [modal,   setModal]   = useState(false);
  const [editing, setEditing] = useState(null);
  const [form,    setForm]    = useState({ name: '', description: '', parent: '', is_active: true });
  const [saving,  setSaving]  = useState(false);

  // Sample data modal
  const [sampleModal, setSampleModal] = useState(false);
  const [sampleData,  setSampleData]  = useState([]);
  const [sampleSearch, setSampleSearch] = useState('');
  const [copying,     setCopying]     = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/inventory/item-categories/?page_size=500');
      setRows(asList(data));
    } catch { toast.error('Categories লোড করা যায়নি।'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);

  const tree = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? rows.filter((r) => [r.name, r.description].some((v) => String(v || '').toLowerCase().includes(q)))
      : rows;
    return buildTree(filtered);
  }, [rows, search]);

  // ── Add / Edit handlers ─────────────────────────────────────────
  const rootCategories = useMemo(() => rows.filter((r) => !r.parent), [rows]);

  const openAdd  = () => { setEditing(null); setForm({ name: '', description: '', parent: '', is_active: true }); setModal(true); };
  const openEdit = (node) => {
    setEditing(node);
    setForm({ name: node.name, description: node.description || '', parent: node.parent || '', is_active: node.is_active });
    setModal(true);
  };
  const closeModal = () => { setModal(false); setEditing(null); };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Category name required.'); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      parent: form.parent || null,
      is_active: form.is_active,
    };
    try {
      if (editing) {
        await api.patch(`/inventory/item-categories/${editing.id}/`, payload);
        toast.success('Category updated.');
      } else {
        await api.post('/inventory/item-categories/', payload);
        toast.success('Category created.');
      }
      closeModal(); fetch();
    } catch (err) { toast.error(formatApiError(err, 'Save failed.')); }
    finally { setSaving(false); }
  };

  const handleDelete = async (node) => {
    if (!confirm(`Delete "${node.name}"?`)) return;
    try {
      await api.delete(`/inventory/item-categories/${node.id}/`);
      toast.success('Deleted.'); fetch();
    } catch (err) { toast.error(formatApiError(err, 'Delete failed.')); }
  };

  // ── Sample Data handlers ────────────────────────────────────────
  const openSample = async () => {
    setSampleSearch('');
    setSampleModal(true);
    if (sampleData.length) return;
    try {
      const { data } = await api.get('/inventory/item-categories/sample-data/');
      setSampleData(data.categories || []);
    } catch { toast.error('Sample data লোড করা যায়নি।'); }
  };

  const handleCopyData = async () => {
    if (!confirm('এই sample ISP categories database-এ copy করবেন?')) return;
    setCopying(true);
    try {
      const { data } = await api.post('/inventory/item-categories/copy-sample-data/');
      toast.success(data.message || 'Categories copied!');
      setSampleModal(false);
      fetch();
    } catch (err) { toast.error(formatApiError(err, 'Copy failed.')); }
    finally { setCopying(false); }
  };

  const filteredSample = useMemo(() => {
    const q = sampleSearch.trim().toLowerCase();
    if (!q) return sampleData;
    return sampleData.filter((s) => s.name.toLowerCase().includes(q));
  }, [sampleData, sampleSearch]);

  // Render sample flat list as indented tree
  const renderSampleItem = (item, i) => {
    const indent = item.depth * 18;
    return (
      <div key={i} className="flex items-center py-1.5 hover:bg-gray-50/60 rounded"
        style={{ paddingLeft: `${12 + indent}px` }}>
        <span className="text-slate-400 text-[11px] mr-2">
          {item.depth > 0 ? '└─' : '→'}
        </span>
        <span className={`text-sm ${item.depth === 0 ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>
          {item.name}
        </span>
        {item.description && (
          <span className="text-xs text-slate-400 ml-2 hidden sm:inline">
            &nbsp;({item.description})
          </span>
        )}
        {item.children_count > 0 && (
          <span className="ml-2 text-[11px] text-slate-400">
            - {item.children_count} Sub-{item.children_count === 1 ? 'Category' : 'Categories'}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Item Category</h1>
          <p className="text-xs text-slate-500">Item Category List</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={openSample}
            className="inline-flex items-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all">
            Sample Item Category
          </button>
          <button onClick={openAdd}
            className="inline-flex items-center gap-2 rounded-xl bg-[#173d59] hover:bg-[#1f5075] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all">
            <Plus className="h-4 w-4" /> Item Category
          </button>
        </div>
      </div>

      {/* Tree Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        {/* Search */}
        <div className="flex items-center gap-3 mb-5">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search categories..."
              className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-400/30" />
          </div>
          <button onClick={fetch}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 transition-all">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {/* Item Categories label + tree */}
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50/60 border-b border-slate-200">
            <span className="text-sm font-semibold text-slate-700">Item Categories</span>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs outline-none focus:ring-1 focus:ring-sky-400/30 w-40" />
            </div>
          </div>
          <div className="p-3 max-h-[60vh] overflow-y-auto">
            {loading ? (
              <div className="py-12 text-center text-slate-400 text-sm">Loading...</div>
            ) : tree.length === 0 ? (
              <p className="py-12 text-center text-slate-400 text-sm">
                No categories found.{' '}
                <button onClick={openSample} className="text-teal-600 underline">Import sample ISP data</button>
              </p>
            ) : (
              tree.map((node) => (
                <CatNode key={node.id} node={node} depth={0} onEdit={openEdit} onDelete={handleDelete} />
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Add/Edit Modal ─────────────────────────────────────── */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-slate-800">
                {editing ? 'Edit Item Category' : 'Add Item Category'}
              </h3>
              <button onClick={closeModal} className="text-2xl text-rose-400 hover:text-rose-600 leading-none">×</button>
            </div>
            <div className="space-y-4 mb-5">
              <label className="block">
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Item Category <span className="text-rose-500">*</span>
                </span>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. ONU, Router, Splitter"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400" />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1 flex items-center justify-between">
                  Sub-Category Of
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${form.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                    {form.is_active ? 'Active' : 'Inactive'}
                  </span>
                </span>
                <div className="flex gap-2">
                  <select value={form.parent} onChange={(e) => setForm((f) => ({ ...f, parent: e.target.value }))}
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400/30 bg-white">
                    <option value="">Select (Top Level)</option>
                    {rows.filter((r) => r.id !== editing?.id).map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50">
                    <input type="checkbox" checked={form.is_active}
                      onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                      className="h-3.5 w-3.5 accent-teal-600" />
                    <span className="text-xs font-medium text-slate-600">Active</span>
                  </label>
                </div>
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Description</span>
                <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3} placeholder="Optional description"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-400/30 resize-none" />
              </label>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setForm({ name: '', description: '', parent: '', is_active: true })}
                className="flex-1 rounded-lg bg-rose-500 hover:bg-rose-600 text-white py-2.5 text-sm font-semibold transition-all">
                Clear
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 text-sm font-semibold transition-all disabled:opacity-50">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sample Data Modal ──────────────────────────────────── */}
      {sampleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-slate-800">Sample Data of ItemCategory For ISP</h3>
              <button onClick={() => setSampleModal(false)}
                className="text-2xl text-rose-400 hover:text-rose-600 leading-none">×</button>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col p-5 gap-3">
              {/* Search + label */}
              <div className="border border-slate-200 rounded-xl overflow-hidden flex-1 flex flex-col">
                <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-slate-200">
                  <span className="text-sm font-semibold text-slate-700">Sample Item Categories</span>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <input value={sampleSearch} onChange={(e) => setSampleSearch(e.target.value)}
                      placeholder="Search"
                      className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs outline-none w-36" />
                  </div>
                </div>
                <div className="overflow-y-auto flex-1 p-3">
                  {filteredSample.length === 0
                    ? <div className="py-8 text-center text-slate-400 text-sm">Loading...</div>
                    : filteredSample.map((item, i) => renderSampleItem(item, i))
                  }
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setSampleModal(false)}
                className="px-6 py-2.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold transition-all">
                Close
              </button>
              <button onClick={handleCopyData} disabled={copying}
                className="px-6 py-2.5 rounded-lg bg-[#2d8fe4] hover:bg-[#2681d5] text-white text-sm font-semibold transition-all disabled:opacity-50">
                {copying ? 'Copying...' : 'Copy This Data'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
