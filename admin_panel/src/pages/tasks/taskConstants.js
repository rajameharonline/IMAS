// এই ফাইলটি Task Management UI-র shared constant ধারণ করে।
// কেন আলাদা: "All Tasks" ও "My Tasks" দুই page একই badge রঙ ও dropdown option
// ব্যবহার করে — এক জায়গায় রাখলে consistency থাকে, duplicate এড়ানো যায়।

// status (effective_status সহ) → badge রঙ। overdue লাল, processing হলুদ ইত্যাদি।
export const STATUS_BADGE = {
  pending:     'bg-blue-100 text-blue-700',
  processing:  'bg-amber-100 text-amber-700',
  in_progress: 'bg-amber-100 text-amber-700', // legacy alias
  completed:   'bg-green-100 text-green-700',
  overdue:     'bg-red-100 text-red-700',
  cancelled:   'bg-gray-200 text-gray-600',
};

export const PRIORITY_BADGE = {
  low:    'bg-gray-100 text-gray-600',
  medium: 'bg-blue-100 text-blue-700',
  high:   'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
};

// requirement অনুযায়ী form/filter-এ ব্যবহৃত option (Pending/Processing/Completed)।
// overdue manual select করা হয় না — deadline পেরোলে নিজে থেকেই দেখায়।
export const STATUS_OPTIONS = [
  { value: 'pending',    label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed',  label: 'Completed' },
];

export const PRIORITY_OPTIONS = [
  { value: 'low',    label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high',   label: 'High' },
];

// effective_status label (overdue সহ) — badge text-এ দেখানোর জন্য।
export const STATUS_LABEL = {
  pending: 'Pending',
  processing: 'Processing',
  in_progress: 'Processing',
  completed: 'Completed',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
};
