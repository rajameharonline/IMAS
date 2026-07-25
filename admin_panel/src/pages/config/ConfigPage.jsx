import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../../utils/api';
import toast from 'react-hot-toast';

// ── Icons ──────────────────────────────────────────────────────────────
function EditIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────
function Modal({ title, onClose, onClear, onSave, saving, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 pt-16 px-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-xl leading-none font-light">&times;</button>
        </div>
        <div className="px-5 pt-4 pb-2 space-y-3">{children}</div>
        <div className="px-5 py-4 space-y-2">
          <div className="flex gap-3">
            <button type="button" onClick={onClear}
              className="flex-1 bg-red-500 text-white py-2 rounded text-xs font-semibold hover:bg-red-600 transition-colors">
              Clear
            </button>
            <button type="button" onClick={onSave} disabled={saving}
              className="flex-1 bg-blue-500 text-white py-2 rounded text-xs font-semibold hover:bg-blue-600 disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
          <div className="flex justify-center">
            <button type="button" onClick={onClose}
              className="bg-red-500 text-white py-1.5 px-10 rounded text-xs font-semibold hover:bg-red-600 transition-colors">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MField({ label, required, children }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-wider mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const inp = 'w-full border border-gray-300 rounded px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400';
const sel = inp + ' bg-white cursor-pointer';

// ── Pagination helpers ─────────────────────────────────────────────────
function PagBtn({ label, onClick, active, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`px-2.5 py-1 rounded text-[11px] border transition-colors min-w-[32px]
        ${active ? 'bg-blue-500 text-white border-blue-500' : ''}
        ${disabled ? 'opacity-40 cursor-default border-gray-200 text-gray-400' : !active ? 'hover:bg-gray-100 border-gray-200 text-gray-600' : ''}`}>
      {label}
    </button>
  );
}

function paginationPages(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, '...', total];
  if (current >= total - 3) return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
  return [1, '...', current - 1, current, current + 1, '...', total];
}

// ── Reusable table section ─────────────────────────────────────────────
function ConfigTable({ title, subtitle, icon, addLabel, onAdd, columns, rows, loading }) {
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const filtered = rows.filter(row =>
    columns.filter(c => c.searchable !== false).some(col => {
      const v = col.value ? col.value(row) : String(row[col.key] ?? '');
      return String(v).toLowerCase().includes(search.toLowerCase());
    })
  );

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => { setPage(1); }, [search, pageSize]);

  return (
    <div className="space-y-3">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <h1 className="text-base font-semibold text-gray-800">{title}</h1>
          <span className="text-xs text-gray-400">{subtitle}</span>
        </div>
      </div>

      {/* Card */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        {/* Add button row */}
        <div className="flex justify-end px-4 py-3">
          <button onClick={onAdd}
            className="bg-[#1c2333] text-white text-xs font-semibold px-3 py-2 rounded flex items-center gap-1 hover:bg-[#2a3347] transition-colors">
            + {addLabel}
          </button>
        </div>

        {/* Controls row */}
        <div className="flex items-center justify-between px-4 pb-3">
          <div className="flex items-center gap-2 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
            SHOW
            <select value={pageSize} onChange={e => setPageSize(+e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-xs font-normal normal-case tracking-normal focus:outline-none">
              {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            ENTRIES
          </div>
          <div className="flex items-center gap-2 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
            SEARCH:
            <input value={search} onChange={e => setSearch(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-xs font-normal normal-case tracking-normal focus:outline-none focus:ring-1 focus:ring-blue-400 w-36" />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#1c2333] text-white">
                {columns.map((col, i) => (
                  <th key={i}
                    className={`px-3 py-3 font-semibold border-r border-[#2a3347] last:border-r-0 whitespace-nowrap
                      ${col.align === 'left' ? 'text-left' : 'text-center'}`}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-gray-400">Loading...</td></tr>
              ) : paged.length === 0 ? (
                <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-gray-400">No entries found</td></tr>
              ) : (
                paged.map((row, i) => (
                  <tr key={row.id ?? i} className={i % 2 === 0 ? 'bg-white hover:bg-blue-50' : 'bg-gray-50 hover:bg-blue-50'}>
                    {columns.map((col, j) => (
                      <td key={j}
                        className={`px-3 py-2.5 border-b border-gray-100 align-middle
                          ${col.align === 'left' ? 'text-left' : 'text-center'}`}>
                        {col.render ? col.render(row, i) : col.value ? col.value(row) : row[col.key]}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
          <span className="text-[11px] text-gray-500">
            {total === 0 ? 'No entries'
              : `Showing ${(safePage - 1) * pageSize + 1} to ${Math.min(safePage * pageSize, total)} of ${total} entries`}
          </span>
          <div className="flex items-center gap-1">
            <PagBtn label="First" disabled={safePage === 1} onClick={() => setPage(1)} />
            <PagBtn label="Previous" disabled={safePage === 1} onClick={() => setPage(p => p - 1)} />
            {paginationPages(safePage, totalPages).map((p, i) =>
              p === '...'
                ? <span key={'e' + i} className="px-1 text-gray-400 text-xs">...</span>
                : <PagBtn key={p} label={p} active={p === safePage} onClick={() => setPage(p)} />
            )}
            <PagBtn label="Next" disabled={safePage === totalPages} onClick={() => setPage(p => p + 1)} />
            <PagBtn label="Last" disabled={safePage === totalPages} onClick={() => setPage(totalPages)} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Action buttons ─────────────────────────────────────────────────────
function ActionCell({ onEdit, onDelete }) {
  const [confirm, setConfirm] = useState(false);
  if (confirm) return (
    <span className="flex gap-2 items-center justify-center text-[11px]">
      <button onClick={onDelete} className="text-red-600 font-semibold hover:underline">Yes</button>
      <span className="text-gray-300">|</span>
      <button onClick={() => setConfirm(false)} className="text-gray-500 hover:underline">No</button>
    </span>
  );
  return (
    <div className="flex items-center justify-center gap-2">
      <button onClick={onEdit} className="text-green-600 hover:text-green-800 transition-colors"><EditIcon /></button>
      <button onClick={() => setConfirm(true)} className="text-red-500 hover:text-red-700 transition-colors"><TrashIcon /></button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Zone Section
// ══════════════════════════════════════════════════════════════════════
function ZoneSection() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get('/config/zones/'); setItems(r.data.results ?? r.data); }
    catch { toast.error('Failed to load zones'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const blank = () => ({ name: '', description: '' });
  const openAdd = () => { setForm(blank()); setModal({ mode: 'add' }); };
  const openEdit = (item) => { setForm({ name: item.name, description: item.description || '' }); setModal({ mode: 'edit', data: item }); };

  const save = async () => {
    if (!form.name.trim()) { toast.error('Zone name is required'); return; }
    setSaving(true);
    try {
      modal.mode === 'add'
        ? await api.post('/config/zones/', { ...form, is_active: true })
        : await api.patch(`/config/zones/${modal.data.id}/`, form);
      toast.success(modal.mode === 'add' ? 'Zone added' : 'Zone updated');
      setModal(null); load();
    } catch (e) { toast.error(e.response?.data?.name?.[0] || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    try { await api.delete(`/config/zones/${id}/`); toast.success('Deleted'); load(); }
    catch { toast.error('Cannot delete — has related sub zones'); }
  };

  const columns = [
    { key: 'serial', label: 'Serial', render: (_, i) => i + 1, searchable: false },
    { key: 'name', label: 'Zone Name', align: 'left' },
    { key: 'description', label: 'Details', align: 'left', value: r => r.description || '' },
    { key: 'action', label: 'Action', searchable: false,
      render: (row) => <ActionCell onEdit={() => openEdit(row)} onDelete={() => del(row.id)} /> },
  ];

  return (
    <>
      <ConfigTable title="Zone" subtitle="Configure zone" icon="📍"
        addLabel="Zone" onAdd={openAdd} columns={columns} rows={items} loading={loading} />
      {modal && (
        <Modal title={modal.mode === 'add' ? 'Add Zone' : 'Edit Zone'}
          onClose={() => setModal(null)} onClear={() => setForm(blank())}
          onSave={save} saving={saving}>
          <MField label="ZONE" required>
            <input className={inp} value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Zone name" />
          </MField>
          <MField label="DETAILS(OPTIONAL)">
            <textarea className={inp} rows={3} value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
          </MField>
        </Modal>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════
// SubZone Section
// ══════════════════════════════════════════════════════════════════════
function SubZoneSection() {
  const [items, setItems] = useState([]);
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ zone: '', name: '', description: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r1, r2] = await Promise.all([api.get('/config/subzones/'), api.get('/config/zones/')]);
      setItems(r1.data.results ?? r1.data);
      setZones(r2.data.results ?? r2.data);
    } catch { toast.error('Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const blank = () => ({ zone: '', name: '', description: '' });
  const openAdd = () => { setForm(blank()); setModal({ mode: 'add' }); };
  const openEdit = (item) => { setForm({ zone: item.zone, name: item.name, description: item.description || '' }); setModal({ mode: 'edit', data: item }); };

  const save = async () => {
    if (!form.zone || !form.name.trim()) { toast.error('Zone and name are required'); return; }
    setSaving(true);
    try {
      modal.mode === 'add'
        ? await api.post('/config/subzones/', { ...form, is_active: true })
        : await api.patch(`/config/subzones/${modal.data.id}/`, form);
      toast.success(modal.mode === 'add' ? 'Sub zone added' : 'Sub zone updated');
      setModal(null); load();
    } catch (e) { toast.error(e.response?.data?.name?.[0] || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    try { await api.delete(`/config/subzones/${id}/`); toast.success('Deleted'); load(); }
    catch { toast.error('Cannot delete — has related boxes'); }
  };

  const columns = [
    { key: 'serial', label: 'Serial', render: (_, i) => i + 1, searchable: false },
    { key: 'name', label: 'Sub Zone', align: 'left' },
    { key: 'zone_name', label: 'Zone', align: 'left' },
    { key: 'description', label: 'Details', align: 'left', value: r => r.description || '' },
    { key: 'action', label: 'Action', searchable: false,
      render: (row) => <ActionCell onEdit={() => openEdit(row)} onDelete={() => del(row.id)} /> },
  ];

  return (
    <>
      <ConfigTable title="Sub Zone" subtitle="Configure sub zone" icon="📍"
        addLabel="Sub Zone" onAdd={openAdd} columns={columns} rows={items} loading={loading} />
      {modal && (
        <Modal title={modal.mode === 'add' ? 'Add Sub Zone' : 'Edit Sub Zone'}
          onClose={() => setModal(null)} onClear={() => setForm(blank())}
          onSave={save} saving={saving}>
          <MField label="ZONE" required>
            <select className={sel} value={form.zone} onChange={e => setForm(p => ({ ...p, zone: e.target.value }))}>
              <option value="">Select</option>
              {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </MField>
          <MField label="SUB ZONE" required>
            <input className={inp} value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Sub zone name" />
          </MField>
          <MField label="DETAILS(OPTIONAL)">
            <textarea className={inp} rows={3} value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
          </MField>
        </Modal>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Box Section
// ══════════════════════════════════════════════════════════════════════
function BoxSection() {
  const [items, setItems] = useState([]);
  const [zones, setZones] = useState([]);
  const [allSubzones, setAllSubzones] = useState([]);
  const [filteredSubzones, setFilteredSubzones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ zone: '', subzone: '', name: '', description: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r1, r2, r3] = await Promise.all([
        api.get('/config/boxes/'),
        api.get('/config/subzones/'),
        api.get('/config/zones/'),
      ]);
      setItems(r1.data.results ?? r1.data);
      setAllSubzones(r2.data.results ?? r2.data);
      setZones(r3.data.results ?? r3.data);
    } catch { toast.error('Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const blank = () => ({ zone: '', subzone: '', name: '', description: '' });

  const handleZoneChange = (zoneId) => {
    setForm(f => ({ ...f, zone: zoneId, subzone: '' }));
    setFilteredSubzones(allSubzones.filter(s => String(s.zone) === String(zoneId)));
  };

  const openAdd = () => {
    setForm(blank());
    setFilteredSubzones([]);
    setModal({ mode: 'add' });
  };

  const openEdit = (item) => {
    const editZone = String(item.zone_id || '');
    const filtered = allSubzones.filter(s => String(s.zone) === editZone);
    setFilteredSubzones(filtered);
    setForm({ zone: editZone, subzone: item.subzone, name: item.name, description: item.location || '' });
    setModal({ mode: 'edit', data: item });
  };

  const save = async () => {
    if (!form.subzone || !form.name.trim()) { toast.error('Sub zone and box name are required'); return; }
    const payload = { subzone: form.subzone, name: form.name, location: form.description, is_active: true };
    setSaving(true);
    try {
      modal.mode === 'add'
        ? await api.post('/config/boxes/', payload)
        : await api.patch(`/config/boxes/${modal.data.id}/`, payload);
      toast.success(modal.mode === 'add' ? 'Box added' : 'Box updated');
      setModal(null); load();
    } catch (e) { toast.error(e.response?.data?.name?.[0] || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    try { await api.delete(`/config/boxes/${id}/`); toast.success('Deleted'); load(); }
    catch { toast.error('Cannot delete — in use'); }
  };

  const columns = [
    { key: 'serial', label: 'Serial', render: (_, i) => i + 1, searchable: false },
    { key: 'name', label: 'Box', align: 'left' },
    { key: 'subzone_name', label: 'Sub Zone', align: 'left' },
    { key: 'zone_name', label: 'Zone', align: 'left' },
    { key: 'location', label: 'Details', align: 'left', value: r => r.location || '' },
    { key: 'action', label: 'Action', searchable: false,
      render: (row) => <ActionCell onEdit={() => openEdit(row)} onDelete={() => del(row.id)} /> },
  ];

  return (
    <>
      <ConfigTable title="Box" subtitle="Configure Box" icon="📍"
        addLabel="Box" onAdd={openAdd} columns={columns} rows={items} loading={loading} />
      {modal && (
        <Modal title={modal.mode === 'add' ? 'Add Box' : 'Edit Box'}
          onClose={() => setModal(null)} onClear={() => { setForm(blank()); setFilteredSubzones([]); }}
          onSave={save} saving={saving}>
          <MField label="ZONE" required>
            <select className={sel} value={form.zone} onChange={e => handleZoneChange(e.target.value)}>
              <option value="">Select</option>
              {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </MField>
          <MField label="SUB ZONE" required>
            <select className={sel} value={form.subzone} onChange={e => setForm(f => ({ ...f, subzone: e.target.value }))}
              disabled={!filteredSubzones.length}>
              <option value="">Select</option>
              {filteredSubzones.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </MField>
          <MField label="BOX" required>
            <input className={inp} value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Box name" />
          </MField>
          <MField label="DETAILS(OPTIONAL)">
            <textarea className={inp} rows={3} value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </MField>
        </Modal>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════
// ClientType Section
// ══════════════════════════════════════════════════════════════════════
function ClientTypeSection() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [imageFile, setImageFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get('/config/client-types/'); setItems(r.data.results ?? r.data); }
    catch { toast.error('Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const blank = () => ({ name: '', description: '' });
  const openAdd = () => { setForm(blank()); setImageFile(null); setModal({ mode: 'add' }); };
  const openEdit = (item) => {
    setForm({ name: item.name, description: item.description || '' });
    setImageFile(null);
    setModal({ mode: 'edit', data: item });
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error('Client type name is required'); return; }
    setSaving(true);
    try {
      if (imageFile) {
        const fd = new FormData();
        fd.append('name', form.name);
        fd.append('description', form.description);
        fd.append('is_active', 'true');
        fd.append('image', imageFile);
        modal.mode === 'add'
          ? await api.post('/config/client-types/', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
          : await api.patch(`/config/client-types/${modal.data.id}/`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      } else {
        const payload = { ...form, is_active: true };
        modal.mode === 'add'
          ? await api.post('/config/client-types/', payload)
          : await api.patch(`/config/client-types/${modal.data.id}/`, payload);
      }
      toast.success(modal.mode === 'add' ? 'Client type added' : 'Updated');
      setModal(null); load();
    } catch (e) { toast.error(e.response?.data?.name?.[0] || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    try { await api.delete(`/config/client-types/${id}/`); toast.success('Deleted'); load(); }
    catch { toast.error('Cannot delete — in use'); }
  };

  const columns = [
    { key: 'serial', label: 'Serial', render: (_, i) => i + 1, searchable: false },
    { key: 'image', label: 'Featured Image', searchable: false,
      render: row => row.image
        ? <img src={row.image} alt={row.name} className="w-10 h-10 object-cover rounded mx-auto" />
        : <div className="w-10 h-10 bg-gray-100 rounded mx-auto flex items-center justify-center text-gray-300 text-xs">—</div>
    },
    { key: 'name', label: 'Client Type', align: 'left' },
    { key: 'description', label: 'Details', align: 'left', value: r => r.description || '' },
    { key: 'action', label: 'Action', searchable: false,
      render: (row) => <ActionCell onEdit={() => openEdit(row)} onDelete={() => del(row.id)} /> },
  ];

  return (
    <>
      <ConfigTable title="Client Type" subtitle="Configure Client Type" icon="👤"
        addLabel="Client Type" onAdd={openAdd} columns={columns} rows={items} loading={loading} />
      {modal && (
        <Modal title={modal.mode === 'add' ? 'Add Client Type' : 'Edit Client Type'}
          onClose={() => setModal(null)}
          onClear={() => { setForm(blank()); setImageFile(null); if (fileRef.current) fileRef.current.value = ''; }}
          onSave={save} saving={saving}>
          <MField label="CLIENT TYPE" required>
            <input className={inp} value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Home, Corporate" />
          </MField>
          <MField label="DETAILS(OPTIONAL)">
            <textarea className={inp} rows={3} value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
          </MField>
          <MField label="FEATURED IMAGE">
            <input ref={fileRef} type="file" accept="image/*"
              className="w-full text-xs text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
              onChange={e => setImageFile(e.target.files[0] || null)} />
          </MField>
        </Modal>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════
// ProtocolType Section  (Connection Type)
// ══════════════════════════════════════════════════════════════════════
const MIKROTIK_TYPES = [
  { value: 'pppoe',   label: 'PPPoE',      color: 'bg-blue-100 text-blue-700' },
  { value: 'dhcp',    label: 'DHCP',       color: 'bg-green-100 text-green-700' },
  { value: 'static',  label: 'Static IP',  color: 'bg-orange-100 text-orange-700' },
  { value: 'hotspot', label: 'Hotspot',    color: 'bg-purple-100 text-purple-700' },
  { value: 'other',   label: 'Other',      color: 'bg-gray-100 text-gray-600' },
];

function MikrotikBadge({ value }) {
  const t = MIKROTIK_TYPES.find(x => x.value === value) ?? MIKROTIK_TYPES[4];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${t.color}`}>
      {t.label}
    </span>
  );
}

function ProtocolTypeSection() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({
    name: '', description: '', mikrotik_interface_type: 'pppoe', radius_enabled: true, is_active: true,
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get('/config/protocol-types/'); setItems(r.data.results ?? r.data); }
    catch { toast.error('Failed to load connection types'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const blank = () => ({
    name: '', description: '', mikrotik_interface_type: 'pppoe', radius_enabled: true, is_active: true,
  });

  const openAdd = () => { setForm(blank()); setModal({ mode: 'add' }); };
  const openEdit = (item) => {
    setForm({
      name: item.name,
      description: item.description || '',
      mikrotik_interface_type: item.mikrotik_interface_type || 'pppoe',
      radius_enabled: item.radius_enabled ?? true,
      is_active: item.is_active ?? true,
    });
    setModal({ mode: 'edit', data: item });
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error('Connection type name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        description: form.description,
        mikrotik_interface_type: form.mikrotik_interface_type,
        radius_enabled: form.radius_enabled,
        is_active: form.is_active,
      };
      modal.mode === 'add'
        ? await api.post('/config/protocol-types/', payload)
        : await api.patch(`/config/protocol-types/${modal.data.id}/`, payload);
      toast.success(modal.mode === 'add' ? 'Connection type added' : 'Connection type updated');
      setModal(null); load();
    } catch (e) { toast.error(e.response?.data?.name?.[0] || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    try { await api.delete(`/config/protocol-types/${id}/`); toast.success('Deleted'); load(); }
    catch { toast.error('Cannot delete — in use by clients'); }
  };

  const columns = [
    { key: 'serial', label: 'Serial', render: (_, i) => i + 1, searchable: false },
    { key: 'name',   label: 'Connection Type', align: 'left' },
    {
      key: 'mikrotik_interface_type', label: 'Mikrotik Type',
      render: row => <MikrotikBadge value={row.mikrotik_interface_type} />,
      value: row => row.mikrotik_interface_type,
    },
    {
      key: 'radius_enabled', label: 'RADIUS Auth',
      render: row => row.radius_enabled
        ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700">RADIUS</span>
        : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-500">Local</span>,
      value: row => row.radius_enabled ? 'radius' : 'local',
    },
    {
      key: 'is_active', label: 'Status',
      render: row => row.is_active
        ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700">Active</span>
        : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-600">Inactive</span>,
      value: row => row.is_active ? 'active' : 'inactive',
    },
    { key: 'description', label: 'Details', align: 'left', value: r => r.description || '' },
    {
      key: 'action', label: 'Action', searchable: false,
      render: (row) => <ActionCell onEdit={() => openEdit(row)} onDelete={() => del(row.id)} />,
    },
  ];

  return (
    <>
      <ConfigTable title="Connection Type" subtitle="Mikrotik & RADIUS integration" icon="🔌"
        addLabel="Connection Type" onAdd={openAdd} columns={columns} rows={items} loading={loading} />
      {modal && (
        <Modal title={modal.mode === 'add' ? 'Add Connection Type' : 'Edit Connection Type'}
          onClose={() => setModal(null)} onClear={() => setForm(blank())}
          onSave={save} saving={saving}>

          <MField label="CONNECTION TYPE NAME" required>
            <input className={inp} value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="e.g. PPPoE, DHCP, Static" />
          </MField>

          <MField label="MIKROTIK INTERFACE TYPE" required>
            <select className={sel} value={form.mikrotik_interface_type}
              onChange={e => {
                const v = e.target.value;
                setForm(p => ({
                  ...p,
                  mikrotik_interface_type: v,
                  radius_enabled: v === 'pppoe' || v === 'hotspot',
                }));
              }}>
              {MIKROTIK_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <p className="mt-1 text-[10px] text-gray-400">
              PPPoE ও Hotspot → RADIUS authentication। DHCP/Static → Local বা RADIUS।
            </p>
          </MField>

          <MField label="RADIUS AUTHENTICATION">
            <div className="flex items-center gap-3 mt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="radius_enabled" checked={form.radius_enabled}
                  onChange={() => setForm(p => ({ ...p, radius_enabled: true }))}
                  className="accent-blue-500" />
                <span className="text-xs text-gray-700 font-medium">
                  Enabled
                  <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-blue-100 text-blue-700">RADIUS</span>
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="radius_enabled" checked={!form.radius_enabled}
                  onChange={() => setForm(p => ({ ...p, radius_enabled: false }))}
                  className="accent-gray-500" />
                <span className="text-xs text-gray-700 font-medium">
                  Disabled
                  <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-gray-100 text-gray-600">Local</span>
                </span>
              </label>
            </div>
          </MField>

          <MField label="STATUS">
            <div className="flex items-center gap-3 mt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="is_active" checked={form.is_active}
                  onChange={() => setForm(p => ({ ...p, is_active: true }))}
                  className="accent-green-500" />
                <span className="text-xs text-gray-700 font-medium">Active</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="is_active" checked={!form.is_active}
                  onChange={() => setForm(p => ({ ...p, is_active: false }))}
                  className="accent-red-500" />
                <span className="text-xs text-gray-700 font-medium">Inactive</span>
              </label>
            </div>
          </MField>

          <MField label="DETAILS (OPTIONAL)">
            <textarea className={inp} rows={2} value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              placeholder="Connection type description" />
          </MField>
        </Modal>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Main ConfigPage — routes to the right section by URL
// ══════════════════════════════════════════════════════════════════════
const SECTIONS = [
  { path: '/config/zones',          Component: ZoneSection },
  { path: '/config/subzones',       Component: SubZoneSection },
  { path: '/config/boxes',          Component: BoxSection },
  { path: '/config/client-types',   Component: ClientTypeSection },
  { path: '/config/protocol-types', Component: ProtocolTypeSection },
];

export default function ConfigPage() {
  const { pathname } = useLocation();
  const match = SECTIONS.find(s => pathname.startsWith(s.path)) ?? SECTIONS[0];
  const { Component } = match;
  return <Component />;
}
