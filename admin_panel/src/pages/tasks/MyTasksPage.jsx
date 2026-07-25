// এই ফাইলটি Task Management module-এর Employee page — "My Tasks"।
//
// কী দেখায়: শুধু currently logged-in employee-এর কাছে assigned task (backend
// /tasks/tasks/my-tasks/ endpoint দিয়ে — request.user filter)। employee এখান
// থেকে নিজের task-এর status পরিবর্তন করতে পারে (Pending → Processing →
// Completed) এবং প্রতিটি task-এর লাইভ countdown timer দেখে।
//
// কেন আলাদা page (AllTasks নয়): employee-কে অন্যের task বা create/reassign
// control দেখানো অর্থহীন ও permission-বহির্ভূত — তাই কেবল নিজের কাজ ও status
// update রাখা হয়েছে। countdown timer + badge AllTasks-এর সাথে shared component।
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import CountdownTimer from '../../components/CountdownTimer';
import {
  STATUS_BADGE, PRIORITY_BADGE, STATUS_LABEL, STATUS_OPTIONS,
} from './taskConstants';

function fmtDateTime(v) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch { return v; }
}

export default function MyTasksPage() {
  const [searchParams] = useSearchParams();
  const [tasks, setTasks]     = useState([]);
  const [loading, setLoading] = useState(true);
  // Dashboard/Bell থেকে status filter এলে initial-এ ধরি (?status=pending)।
  const [filterStatus, setFilterStatus] = useState(searchParams.get('status') || '');

  // ── নিজের task লোড — my-tasks endpoint backend-এ request.user filter করে ─
  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (filterStatus) params.status = filterStatus;
    api.get('/tasks/tasks/my-tasks/', { params })
      .then((r) => setTasks(r.data?.results || r.data || []))
      .catch(() => toast.error('Failed to load my tasks'))
      .finally(() => setLoading(false));
  }, [filterStatus]);

  useEffect(() => { load(); }, [load]);

  // ── status update (employee self-service) ────────────────────────
  function changeStatus(t, newStatus) {
    api.post(`/tasks/tasks/${t.id}/change-status/`, { status: newStatus })
      .then(() => { toast.success('Status updated'); load(); })
      .catch(() => toast.error('Status change failed'));
  }

  // summary count — কয়টি pending/processing/overdue, employee-কে quick view।
  const counts = tasks.reduce((acc, t) => {
    const eff = t.effective_status || t.status;
    acc[eff] = (acc[eff] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* ── Page header ───────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <svg className="w-6 h-6 text-[#1c2333]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <h1 className="text-base font-semibold text-gray-700">My Tasks</h1>
            <p className="text-xs text-gray-400">Tasks assigned to you — track & update progress</p>
          </div>
        </div>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
          className="border border-gray-200 rounded px-2 py-1.5 text-sm">
          <option value="">All Status</option>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* ── Quick summary chips ───────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: 'pending',    label: 'Pending',    cls: 'bg-blue-50 text-blue-700 border-blue-200' },
          { key: 'processing', label: 'Processing', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
          { key: 'overdue',    label: 'Overdue',    cls: 'bg-red-50 text-red-700 border-red-200' },
          { key: 'completed',  label: 'Completed',  cls: 'bg-green-50 text-green-700 border-green-200' },
        ].map((c) => (
          <div key={c.key} className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${c.cls}`}>
            {c.label}: {counts[c.key] || 0}
          </div>
        ))}
      </div>

      {/* ── Task cards (card layout — mobile-friendly) ────────── */}
      {loading ? (
        <div className="text-center py-10 text-gray-400 text-sm">লোড হচ্ছে...</div>
      ) : tasks.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm py-12 text-center text-gray-400 text-sm">
          No tasks assigned to you.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {tasks.map((t) => {
            const eff = t.effective_status || t.status;
            return (
              <div key={t.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
                {/* card header — title + priority */}
                <div className="px-4 py-2.5 bg-[#23445f] text-white flex items-center justify-between gap-2">
                  <span className="font-medium text-sm truncate">{t.task_title || t.title}</span>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold ${PRIORITY_BADGE[t.priority] || 'bg-gray-100 text-gray-600'}`}>
                    {t.priority_display || t.priority}
                  </span>
                </div>
                {/* body */}
                <div className="p-4 flex-1 flex flex-col gap-3">
                  {t.description && (
                    <p className="text-xs text-gray-500 line-clamp-2">{t.description}</p>
                  )}
                  {/* countdown timer — live tick from deadline */}
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-400 uppercase tracking-wide">Countdown</span>
                    <CountdownTimer deadline={t.deadline} status={t.status} />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-gray-500">
                    <span>Deadline</span>
                    <span className="font-mono">{fmtDateTime(t.deadline)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-gray-500">
                    <span>Assigned by</span>
                    <span>{t.created_by_name || '—'}</span>
                  </div>
                  {/* status badge + change dropdown */}
                  <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_BADGE[eff] || 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABEL[eff] || eff}
                    </span>
                    <select
                      value={['pending', 'processing', 'completed'].includes(t.status) ? t.status : 'pending'}
                      onChange={(e) => changeStatus(t, e.target.value)}
                      className="border border-gray-200 rounded px-2 py-1 text-xs"
                    >
                      {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
