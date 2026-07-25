// এই ফাইলটি Task Management module-এর Admin page — "All Tasks"।
//
// কী দেখায়: সব task-এর তালিকা (table), নতুন task তৈরি/edit modal, status ও
// priority filter, re-assign + status-change action, এবং প্রতিটি row-এ লাইভ
// countdown timer (deadline অনুযায়ী)।
//
// কেন এক ফাইলে: list + create/edit modal + action একসাথে থাকলে admin-এর
// workflow দ্রুত হয় — page switch লাগে না (support module-এর প্যাটার্ন অনুসরণ)।
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import CountdownTimer from '../../components/CountdownTimer';
import {
  STATUS_BADGE, PRIORITY_BADGE, STATUS_LABEL,
  STATUS_OPTIONS, PRIORITY_OPTIONS,
} from './taskConstants';

// খালি form state — নতুন task modal-এর initial value।
const EMPTY_FORM = {
  task_title: '', description: '', priority: 'medium',
  status: 'pending', category: '', assigned_to: '', deadline: '',
};

// datetime-local input ↔ ISO রূপান্তর। input "YYYY-MM-DDTHH:mm" দেয়, API ISO চায়।
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  // timezone offset বাদ দিয়ে local-এ দেখানোর জন্য সামঞ্জস্য।
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

/* ── Mobile Task Card ── */
function MobileTaskCard({ t, idx, employees, reassign, changeStatus, openEdit, remove }) {
  const isEven = idx % 2 === 0;
  const eff = t.effective_status || t.status;
  const FRow = ({ label, children }) => (
    <div className="flex items-stretch border-b border-gray-200 last:border-0">
      <div className="w-28 shrink-0 bg-gray-50 px-3 py-2.5 flex items-center border-r border-gray-200">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex-1 min-w-0 px-3 py-2.5 flex items-center justify-end bg-white">{children}</div>
    </div>
  );
  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${isEven ? 'bg-white border-gray-200' : 'bg-slate-50/40 border-gray-200'}`}>
      {/* Header: title + priority */}
      <div className="px-3 py-2.5 bg-[#23445f]/5 border-b border-gray-200">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-gray-900 text-[13px] flex-1 min-w-0">{t.task_title || t.title}</p>
          <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold ${PRIORITY_BADGE[t.priority] || 'bg-gray-100 text-gray-600'}`}>
            {t.priority_display || t.priority}
          </span>
        </div>
        {t.description && <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-2">{t.description}</p>}
      </div>
      {/* Detail rows */}
      <div>
        <FRow label="Assigned To">
          <select value={t.assigned_to || ''} onChange={(e) => reassign(t, e.target.value)}
            className="border border-gray-200 rounded px-2 py-1 text-xs max-w-[160px] focus:outline-none focus:ring-1 focus:ring-teal-400">
            <option value="">Unassigned</option>
            {employees.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
          </select>
        </FRow>
        <FRow label="Status">
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_BADGE[eff] || 'bg-gray-100 text-gray-600'}`}>
            {STATUS_LABEL[eff] || eff}
          </span>
        </FRow>
        <FRow label="Countdown">
          <CountdownTimer deadline={t.deadline} status={t.status} />
        </FRow>
        <FRow label="Created By">
          <span className="text-[12px] text-gray-600">{t.created_by_name || '—'}</span>
        </FRow>
      </div>
      {/* Footer: status change + edit + delete */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50/60 border-t border-gray-200 flex-wrap">
        <select value={['pending', 'processing', 'completed'].includes(t.status) ? t.status : 'pending'}
          onChange={(e) => changeStatus(t, e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs flex-1 focus:outline-none focus:ring-1 focus:ring-teal-400">
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button onClick={() => openEdit(t)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100">Edit</button>
        <button onClick={() => remove(t)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100">Delete</button>
      </div>
    </div>
  );
}

export default function AllTasksPage() {
  const [searchParams] = useSearchParams();
  const [tasks, setTasks]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [cats, setCats]         = useState([]);
  const [employees, setEmployees] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]   = useState(null);     // edit হলে task object
  const [form, setForm]         = useState(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);
  // Dashboard card থেকে আসা status filter (/tasks/list?status=pending) initial-এ ধরি।
  const [filterStatus, setFilterStatus]     = useState(searchParams.get('status') || '');
  const [filterPriority, setFilterPriority] = useState('');
  const [search, setSearch]     = useState('');

  // ── task list লোড (status/priority/search filter সহ) ──────────────
  const loadTasks = useCallback(() => {
    setLoading(true);
    const params = {};
    if (filterStatus) params.status = filterStatus;
    if (filterPriority) params.priority = filterPriority;
    if (search) params.search = search;
    api.get('/tasks/tasks/', { params })
      .then((r) => setTasks(r.data?.results || r.data || []))
      .catch(() => toast.error('Failed to load tasks'))
      .finally(() => setLoading(false));
  }, [filterStatus, filterPriority, search]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  // category + employee dropdown একবার লোড।
  useEffect(() => {
    api.get('/tasks/categories/?is_active=true')
      .then((r) => setCats(r.data?.results || r.data || []))
      .catch(() => {});
    // assigned_to = accounts.User (panel user); App Users API ব্যবহার।
    // canonical endpoint = /auth/users/ (router 'users' under auth/) — page_size
    // বাড়িয়ে সব employee একসাথে আনি যাতে dropdown ভরে।
    api.get('/auth/users/', { params: { page_size: 200 } })
      .then((r) => setEmployees(r.data?.results || r.data || []))
      .catch(() => {});
  }, []);

  // ── modal খোলা (নতুন/edit) ───────────────────────────────────────
  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  }
  function openEdit(t) {
    setEditing(t);
    setForm({
      task_title: t.task_title || t.title || '',
      description: t.description || '',
      priority: t.priority || 'medium',
      // overdue computed value form-এ নয়; raw stored status দেখাই।
      status: ['pending', 'processing', 'completed'].includes(t.status) ? t.status : 'pending',
      category: t.category || '',
      assigned_to: t.assigned_to || '',
      deadline: toLocalInput(t.deadline),
    });
    setShowModal(true);
  }

  // ── save (create / update) ───────────────────────────────────────
  function save(e) {
    e.preventDefault();
    if (!form.task_title.trim()) { toast.error('Task title is required'); return; }
    setSaving(true);
    // payload: deadline local→ISO; খালি FK গুলো null।
    const payload = {
      task_title: form.task_title.trim(),
      description: form.description,
      priority: form.priority,
      status: form.status,
      category: form.category || null,
      assigned_to: form.assigned_to || null,
      deadline: form.deadline ? new Date(form.deadline).toISOString() : null,
    };
    const req = editing
      ? api.put(`/tasks/tasks/${editing.id}/`, payload)
      : api.post('/tasks/tasks/', payload);
    req
      .then(() => {
        toast.success(editing ? 'Task updated' : 'Task created — employee notified');
        setShowModal(false);
        loadTasks();
      })
      .catch((err) => {
        const d = err.response?.data;
        toast.error(d ? JSON.stringify(d) : 'Save failed');
      })
      .finally(() => setSaving(false));
  }

  // ── quick status change (table dropdown) ─────────────────────────
  function changeStatus(t, newStatus) {
    api.post(`/tasks/tasks/${t.id}/change-status/`, { status: newStatus })
      .then(() => { toast.success('Status updated'); loadTasks(); })
      .catch(() => toast.error('Status change failed'));
  }

  // ── quick re-assign (table dropdown) ─────────────────────────────
  function reassign(t, userId) {
    api.post(`/tasks/tasks/${t.id}/assign/`, { assigned_to: userId || '' })
      .then(() => { toast.success('Re-assigned — employee notified'); loadTasks(); })
      .catch(() => toast.error('Re-assign failed'));
  }

  function remove(t) {
    if (!window.confirm(`Delete task "${t.task_title || t.title}"?`)) return;
    api.delete(`/tasks/tasks/${t.id}/`)
      .then(() => { toast.success('Task deleted'); loadTasks(); })
      .catch(() => toast.error('Delete failed'));
  }

  return (
    <div className="space-y-4">
      {/* ── Page header ───────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <svg className="w-6 h-6 text-[#1c2333]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
          <div>
            <h1 className="text-base font-semibold text-gray-700">All Tasks</h1>
            <p className="text-xs text-gray-400">Assign, track & monitor team tasks</p>
          </div>
        </div>
        <button onClick={openCreate}
          className="bg-[#1d3a50] text-white text-xs font-medium px-4 py-2 rounded hover:bg-[#16303f] transition-colors">
          + New Task
        </button>
      </div>

      {/* ── Filter bar ─────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3 flex flex-wrap gap-2 items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title / employee..."
          className="border border-gray-200 rounded px-3 py-1.5 text-sm flex-1 min-w-[180px] focus:ring-2 focus:ring-teal-400 outline-none"
        />
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
          className="border border-gray-200 rounded px-2 py-1.5 text-sm">
          <option value="">All Status</option>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}
          className="border border-gray-200 rounded px-2 py-1.5 text-sm">
          <option value="">All Priority</option>
          {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* ── Task table ─────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <>
        {/* ── Mobile Card List (< md) ── */}
        <div className="md:hidden space-y-2 p-3">
          {loading ? <p className="text-center py-6 text-gray-400 text-sm">লোড হচ্ছে...</p>
           : tasks.length === 0 ? <p className="text-center py-6 text-gray-400 text-sm">No tasks found</p>
           : tasks.map((t, idx) => (
             <MobileTaskCard key={t.id} t={t} idx={idx}
               employees={employees} reassign={reassign}
               changeStatus={changeStatus} openEdit={openEdit} remove={remove} />
           ))}
        </div>
        {/* ── Desktop Table (md+) ── */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="bg-[#23445f] text-white text-left">
                {['Task', 'Assigned To', 'Priority', 'Status', 'Countdown', 'Created By', 'Actions'].map((h) => (
                  <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">লোড হচ্ছে...</td></tr>
              ) : tasks.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">No tasks found</td></tr>
              ) : tasks.map((t) => {
                const eff = t.effective_status || t.status;
                return (
                  <tr key={t.id} className="hover:bg-gray-50 border-b border-gray-100">
                    <td className="px-3 py-2 text-gray-800">
                      <p className="font-medium">{t.task_title || t.title}</p>
                      {t.description && <p className="text-[11px] text-gray-400 line-clamp-1">{t.description}</p>}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {/* quick re-assign dropdown */}
                      <select
                        value={t.assigned_to || ''}
                        onChange={(e) => reassign(t, e.target.value)}
                        className="border border-gray-200 rounded px-2 py-1 text-xs max-w-[140px]"
                      >
                        <option value="">Unassigned</option>
                        {employees.map((u) => (
                          <option key={u.id} value={u.id}>{u.full_name || u.username}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${PRIORITY_BADGE[t.priority] || 'bg-gray-100 text-gray-600'}`}>
                        {t.priority_display || t.priority}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_BADGE[eff] || 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABEL[eff] || eff}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <CountdownTimer deadline={t.deadline} status={t.status} />
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{t.created_by_name || '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {/* quick status change */}
                        <select
                          value={['pending', 'processing', 'completed'].includes(t.status) ? t.status : 'pending'}
                          onChange={(e) => changeStatus(t, e.target.value)}
                          className="border border-gray-200 rounded px-1.5 py-1 text-xs"
                        >
                          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <button onClick={() => openEdit(t)} title="Edit"
                          className="p-1 text-gray-500 hover:text-teal-600">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        <button onClick={() => remove(t)} title="Delete"
                          className="p-1 text-gray-500 hover:text-red-600">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      </div>

      {/* ── Create / Edit modal ────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="bg-[#1c2333] text-white px-5 py-3 flex items-center justify-between">
              <h3 className="font-semibold text-sm">{editing ? 'Edit Task' : 'New Task'}</h3>
              <button onClick={() => setShowModal(false)} className="text-white/70 hover:text-white">✕</button>
            </div>
            <form onSubmit={save} className="p-5 bg-white space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Task Title *</label>
                <input value={form.task_title} onChange={(e) => setForm({ ...form, task_title: e.target.value })}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-teal-400 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-teal-400 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Assign To</label>
                  <select value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
                    className="w-full border border-gray-200 rounded px-3 py-2 text-sm">
                    <option value="">— Select Employee —</option>
                    {employees.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full border border-gray-200 rounded px-3 py-2 text-sm">
                    <option value="">— None —</option>
                    {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Priority</label>
                  <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}
                    className="w-full border border-gray-200 rounded px-3 py-2 text-sm">
                    {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full border border-gray-200 rounded px-3 py-2 text-sm">
                    {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Deadline (for countdown timer)</label>
                <input type="datetime-local" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm" />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
                <button type="button" onClick={() => setShowModal(false)}
                  className="bg-gray-100 text-gray-700 hover:bg-gray-200 text-sm px-4 py-2 rounded">Cancel</button>
                <button type="submit" disabled={saving}
                  className="bg-[#1d3a50] text-white hover:bg-[#16303f] text-sm px-4 py-2 rounded disabled:opacity-50">
                  {saving ? 'Saving...' : editing ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
