// Bandwidth Buy module-এর shared helper।
// কেন আলাদা file: provider/item/bill page-গুলোতে একই formatting, list extraction,
// আর file download logic বারবার লাগবে; shared রাখলে code drift কমে।

export function asList(payload) {
  return Array.isArray(payload) ? payload : (payload?.results || []);
}

export function money(value) {
  const n = Number(value || 0);
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function toInputDate(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

export async function downloadBlob(response, fallbackName = 'download') {
  const blob = new Blob([response.data], { type: response.headers['content-type'] || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const disposition = response.headers['content-disposition'] || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] || fallbackName;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function stripHtmlTags(value) {
  // HTML error page toast-এ raw markup দেখানো যাবে না, তাই plain text বানাচ্ছি।
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractHtmlTitle(html) {
  const match = String(html || '').match(/<title[^>]*>(.*?)<\/title>/i);
  return match ? stripHtmlTags(match[1]) : '';
}

export function formatApiError(err, fallback = 'Request failed.') {
  const data = err?.response?.data;
  const status = err?.response?.status;
  if (!data) return err?.message || fallback;
  if (typeof data === 'string') {
    // Django/Nginx/Apache-এর HTML error page থাকলে user-friendly বার্তা দিচ্ছি।
    const compact = data.trim();
    if (/<\/?html|<!doctype html/i.test(compact)) {
      const title = extractHtmlTitle(compact);
      if (title) return `${title}${status ? ` (${status})` : ''}`;
      return `Request failed${status ? ` (${status})` : ''}.`;
    }
    return compact;
  }
  if (data.detail) return data.detail;
  if (Array.isArray(data)) return data.join(' | ');
  if (typeof data === 'object') {
    return Object.entries(data)
      .map(([key, value]) => {
        const text = Array.isArray(value) ? value.join(' | ') : String(value);
        return key === 'non_field_errors' ? text : `${key}: ${text}`;
      })
      .join(' | ');
  }
  return fallback;
}
