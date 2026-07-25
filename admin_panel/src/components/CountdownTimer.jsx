// এই কম্পোনেন্টটি একটি task-এর deadline অনুযায়ী লাইভ countdown timer দেখায়।
//
// কেন আলাদা reusable component: "All Tasks" (admin) ও "My Tasks" (employee)
// দুই page-এই একই timer দরকার — duplicate logic এড়াতে একটিই source।
//
// কীভাবে কাজ করে:
//   • prop হিসেবে deadline (ISO string) আসে।
//   • প্রতি ১ সেকেন্ডে setInterval দিয়ে remaining = deadline − now হিসাব হয়।
//   • remaining > 0 হলে "02h 45m 10s remaining" (সবুজ/হলুদ — কম সময় হলে হলুদ)।
//   • remaining ≤ 0 হলে "Overdue by 12m" (লাল)। কাজ শেষ হলে static badge।
//
// কেন backend-এর remaining_seconds ব্যবহার না করে frontend নিজে tick করি:
//   real-time ticking effect দরকার; প্রতি সেকেন্ডে API call করা অপচয়। deadline
//   একবার পেলেই client-side ঘড়ি চালানো যথেষ্ট ও মসৃণ।
import { useState, useEffect } from 'react';

// মোট সেকেন্ডকে "Xd Yh Zm Ws" string-এ রূপান্তর — readable countdown-এর জন্য।
function formatDuration(totalSec) {
  const s = Math.abs(totalSec);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0 || d > 0) parts.push(`${String(h).padStart(2, '0')}h`);
  parts.push(`${String(m).padStart(2, '0')}m`);
  // দিন-ঘণ্টা বড় হলে সেকেন্ড দেখানো অর্থহীন; ছোট সময়েই সেকেন্ড দেখাই।
  if (d === 0 && h === 0) parts.push(`${String(sec).padStart(2, '0')}s`);
  return parts.join(' ');
}

export default function CountdownTimer({ deadline, status }) {
  // now state প্রতি সেকেন্ডে আপডেট হয়ে re-render ঘটায় (live tick)।
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // কাজ শেষ/বাতিল হলে timer চালানোর দরকার নেই — interval বন্ধ থাকবে।
    if (status === 'completed' || status === 'cancelled' || !deadline) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [deadline, status]);

  // deadline না থাকলে countdown দেখানোর কিছু নেই।
  if (!deadline) {
    return <span className="text-gray-400 text-xs">No deadline</span>;
  }

  // কাজ সম্পন্ন হলে countdown বন্ধ — static সবুজ badge।
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Completed
      </span>
    );
  }
  if (status === 'cancelled') {
    return <span className="text-xs text-gray-400">Cancelled</span>;
  }

  const remainingSec = Math.floor((new Date(deadline).getTime() - now) / 1000);
  const overdue = remainingSec < 0;

  // < ১ ঘণ্টা বাকি থাকলে হলুদ warning; overdue হলে লাল; নাহলে সবুজ।
  const cls = overdue
    ? 'text-red-600'
    : remainingSec < 3600
      ? 'text-amber-600'
      : 'text-teal-700';

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold tabular-nums ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${overdue ? 'bg-red-500 animate-pulse' : remainingSec < 3600 ? 'bg-amber-500' : 'bg-teal-500'}`} />
      {overdue
        ? `Overdue by ${formatDuration(remainingSec)}`
        : `${formatDuration(remainingSec)} remaining`}
    </span>
  );
}
