export function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function getInitials(name) {
  if (!name) return '?';
  const clean = name.replace(/[^a-zA-Z0-9\s]/g, '').trim();
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase() || '?';
}

const SENDER_COLORS = [
  'text-sky-400',
  'text-emerald-400',
  'text-amber-400',
  'text-rose-400',
  'text-purple-400',
  'text-indigo-400',
  'text-teal-400',
  'text-orange-400',
  'text-cyan-400',
  'text-pink-400'
];

export function getSenderColor(str) {
  if (!str) return 'text-primary';
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) & 0xffffffff;
  }
  return SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length];
}

export function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatSnippet(snippet) {
  if (!snippet) return '';
  const tokenStart = '___MARK_START___';
  const tokenEnd = '___MARK_END___';
  let safe = snippet
    .replace(/<mark class="[^"]*">/gi, tokenStart)
    .replace(/<\/mark>/gi, tokenEnd);
  safe = escapeHtml(safe);
  return safe
    .replace(new RegExp(tokenStart, 'g'), '<mark class="bg-warning text-warning-content rounded px-0.5">')
    .replace(new RegExp(tokenEnd, 'g'), '</mark>');
}

export function formatCompactNumber(n) {
  const num = Number(n) || 0;
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return num.toLocaleString();
}

export function formatYmLabel(ym) {
  if (!ym || typeof ym !== 'string') return ym || '';
  const parts = ym.split('-');
  if (parts.length < 2) return ym;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mIdx = parseInt(parts[1], 10) - 1;
  const monthStr = monthNames[mIdx] || parts[1];
  const yearStr = parts[0].length === 4 ? `'${parts[0].slice(2)}` : parts[0];
  return `${monthStr} ${yearStr}`;
}

export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
