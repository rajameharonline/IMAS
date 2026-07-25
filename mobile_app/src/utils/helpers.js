// Phone normalize: +880 / 880 / 01 → 01XXXXXXXXX
export function normalizePhone(raw) {
  let p = (raw || '').trim();
  if (p.startsWith('+880')) p = '0' + p.slice(4);
  else if (p.startsWith('880') && p.length === 13) p = '0' + p.slice(3);
  return p;
}

// তারিখ format: 2026-06-05 → ০৫ জুন ২০২৬
const BN_MONTHS = ['', 'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];

export function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return `${d.getDate()} ${BN_MONTHS[d.getMonth() + 1]} ${d.getFullYear()}`;
}

export function fmtCurrency(amount) {
  if (amount == null) return '০';
  return `৳${parseFloat(amount).toLocaleString('bn-BD', { minimumFractionDigits: 0 })}`;
}

// ─── English formatters (HomeScreen-এ ব্যবহৃত) ──────────────────────────────
const EN_MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDateEn(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return `${d.getDate()} ${EN_MONTHS[d.getMonth() + 1]} ${d.getFullYear()}`;
}

export function fmtCurrencyEn(amount) {
  if (amount == null) return '৳0';
  return `৳${parseFloat(amount).toLocaleString('en-US', { minimumFractionDigits: 0 })}`;
}

export function timeSince(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'এইমাত্র';
  if (m < 60) return `${m} মিনিট আগে`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ঘণ্টা আগে`;
  return fmtDate(dateStr);
}
