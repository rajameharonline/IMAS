// এই কম্পোনেন্টটি কাস্টমারের জন্য নতুন Support Ticket open করার responsive
// modal। কেন আলাদা component: Customer Search, Client List, Client Profile —
// যেখান থেকেই "+ Open Ticket" বাটন press হোক, একই UI ও API call চলবে।
//
// Required props:
//   client     — { id, full_name, customer_id, phone, zone_name, ... }
//   onClose()  — modal বন্ধ করার callback
//   onCreated(ticket?) — সফল create হলে parent কে জানাতে (optional)
//
// Design rule (ai.md): mobile-এ bottom sheet, desktop-এ center popup;
// dark header (#1c2333), teal save button, English labels।

import { useEffect, useState } from 'react';
import api from '../utils/api';
import toast from 'react-hot-toast';

const PRIORITY_OPTS = [
  { value: 'low',      label: 'Low' },
  { value: 'medium',   label: 'Medium' },
  { value: 'high',     label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const SOURCE_OPTS = [
  { value: 'admin',  label: 'Admin Panel' },
  { value: 'phone',  label: 'Phone / Walk-in' },
  { value: 'portal', label: 'Client Portal' },
  { value: 'field',  label: 'Field Engineer' },
];

// helper — API list-ও pagination-aware (results) — দুই format-ই সামলায়।
function getList(data) {
  return Array.isArray(data) ? data : (data?.results || []);
}

export default function OpenTicketModal({ client, onClose, onCreated }) {
  // টিকেট form state — initial মান minimal।
  const [form, setForm] = useState({
    ticket_type: '',
    priority:    'medium',
    source:      'admin',
    assigned_to: '',
    subject:     '',
    description: '',
  });
  const [ticketTypes, setTicketTypes] = useState([]);
  const [staffUsers, setStaffUsers]   = useState([]);
  const [saving, setSaving]           = useState(false);

  // dropdown options load — TicketType (categories) ও staff users।
  useEffect(() => {
    Promise.all([
      api.get('/support/categories/', { params: { is_active: true, page_size: 200 } }),
      api.get('/auth/users/', { params: { page_size: 200 } }).catch(() => ({ data: [] })),
    ]).then(([catR, usrR]) => {
      setTicketTypes(getList(catR.data));
      // accounts/auth/users endpoint থাকলে staff list; না থাকলে empty।
      setStaffUsers(getList(usrR.data));
    }).catch(() => {});
  }, []);

  // Field change handler — generic setter।
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  // Validation — frontend-side basic checks; final validation backend-এ।
  const validate = () => {
    if (!form.subject.trim())     return 'Subject is required.';
    if (!form.description.trim()) return 'Description is required.';
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) { toast.error(err); return; }
    setSaving(true);
    try {
      const payload = {
        client:        client.id,
        ticket_type:   form.ticket_type || null,   // FK alias of `category`
        priority:      form.priority,
        source:        form.source,
        assigned_to:   form.assigned_to || null,
        subject:       form.subject.trim(),
        description:   form.description.trim(),
      };
      const { data } = await api.post('/support/tickets/', payload);
      toast.success(`Ticket ${data.ticket_no || data.ticket_id} opened.`);
      onCreated?.(data);
      onClose?.();
    } catch (e) {
      const msg = e?.response?.data
        ? JSON.stringify(e.response.data).slice(0, 200)
        : 'Failed to open ticket.';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    // Responsive overlay — mobile end-aligned (bottom sheet), desktop center।
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-0 md:p-4">
      <div className="w-full md:max-w-2xl bg-white rounded-t-2xl md:rounded-2xl max-h-[90vh] overflow-y-auto shadow-2xl">

        {/* Header — dark anchor strip */}
        <div className="bg-[#1c2333] text-white px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <h3 className="text-base font-semibold font-slab">Open Support Ticket</h3>
          </div>
          <button onClick={onClose} className="text-gray-300 hover:text-white p-1 -mr-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Client snapshot — pre-populated, read-only */}
        <div className="px-5 pt-4 pb-3 bg-gradient-to-r from-teal-50 to-emerald-50 border-b border-gray-100">
          <p className="text-[10px] font-semibold text-teal-700 uppercase tracking-wider mb-1">Client</p>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#1c2333] text-white text-sm font-bold flex items-center justify-center shrink-0">
              {(client?.full_name || '?')[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-800 truncate">
                {client?.full_name}
                <span className="ml-2 text-xs font-mono text-gray-500">
                  {client?.customer_id}
                </span>
              </p>
              <p className="text-xs text-gray-600 truncate">
                {client?.phone}
                {client?.zone_name && (
                  <span className="ml-2 text-gray-500">· {client.zone_name}</span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Form body */}
        <div className="px-5 py-4 space-y-4">

          {/* Row 1 — Ticket Type · Priority */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Ticket Type">
              <select
                value={form.ticket_type} onChange={set('ticket_type')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400">
                <option value="">— Select Type —</option>
                {ticketTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <select
                value={form.priority} onChange={set('priority')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400">
                {PRIORITY_OPTS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
          </div>

          {/* Row 2 — Source · Assigned Employee */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Source">
              <select
                value={form.source} onChange={set('source')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400">
                {SOURCE_OPTS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Assigned Employee">
              <select
                value={form.assigned_to} onChange={set('assigned_to')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400">
                <option value="">— Unassigned —</option>
                {staffUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name || u.username} {u.role ? `(${u.role})` : ''}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* Subject */}
          <Field label="Subject" required>
            <input
              value={form.subject} onChange={set('subject')}
              placeholder="Brief issue title"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
          </Field>

          {/* Description */}
          <Field label="Description" required>
            <textarea
              value={form.description} onChange={set('description')}
              rows={4}
              placeholder="Describe the issue with sufficient detail..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none" />
          </Field>
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2 bg-gray-50">
          <button
            onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={handleSave} disabled={saving}
            className="px-5 py-2 text-sm font-semibold rounded-lg bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-60 flex items-center gap-2">
            {saving && (
              <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            Open Ticket
          </button>
        </div>
      </div>
    </div>
  );
}

// ছোট label + child wrapper — code DRY রাখার জন্য।
function Field({ label, required, children }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </p>
      {children}
    </div>
  );
}
