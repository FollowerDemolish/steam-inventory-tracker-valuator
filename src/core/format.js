// Display formatting shared by the main process and the renderer.
// Works in both environments (no Node APIs).

import { currencyByCode } from './currencies.js';

const moneyCache = new Map();

function moneyFormatter(code, compact) {
  const key = `${code}|${compact}`;
  let f = moneyCache.get(key);
  if (!f) {
    const cur = currencyByCode(code);
    const big = ['IDR', 'VND', 'KRW'].includes(cur.code);
    f = new Intl.NumberFormat(cur.locale, {
      style: 'currency',
      currency: cur.code,
      currencyDisplay: 'narrowSymbol',
      notation: compact ? 'compact' : 'standard',
      minimumFractionDigits: compact || big ? 0 : 2,
      maximumFractionDigits: compact ? 1 : big ? 0 : 2,
    });
    moneyCache.set(key, f);
  }
  return f;
}

// cents -> "$1,234.56"; null -> an em dash.
export function formatMoney(cents, code = 'USD', { compact = false } = {}) {
  if (cents == null || !Number.isFinite(cents)) return '—';
  return moneyFormatter(code, compact).format(cents / 100);
}

// Splits a formatted amount so the UI can style the symbol and decimals.
export function moneyParts(cents, code = 'USD') {
  if (cents == null || !Number.isFinite(cents)) return [{ type: 'literal', value: '—' }];
  return moneyFormatter(code, false).formatToParts(cents / 100);
}

export function formatNumber(n, digits = 0) {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(n);
}

export function formatPercent(fraction, digits = 0) {
  if (fraction == null || !Number.isFinite(fraction)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: digits }).format(fraction);
}

export function formatSignedPercent(fraction, digits = 1) {
  if (fraction == null || !Number.isFinite(fraction)) return '—';
  const s = formatPercent(Math.abs(fraction), digits);
  return fraction > 0 ? `+${s}` : fraction < 0 ? `−${s}` : s;
}

export function formatSignedMoney(cents, code = 'USD') {
  if (cents == null || !Number.isFinite(cents)) return '—';
  const s = formatMoney(Math.abs(cents), code);
  return cents > 0 ? `+${s}` : cents < 0 ? `−${s}` : s;
}

export function relativeTime(ts, now = Date.now()) {
  const diff = now - ts;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const units = [
    ['year', 365 * 864e5], ['month', 30 * 864e5], ['week', 7 * 864e5],
    ['day', 864e5], ['hour', 36e5], ['minute', 6e4],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(-Math.round(diff / ms), unit);
  }
  return 'just now';
}

// Account age from a creation date: "12 years, 4 months".
export function accountAge(created, now = Date.now()) {
  const t = typeof created === 'number' ? created : Date.parse(created);
  if (!Number.isFinite(t)) return null;
  const a = new Date(t);
  const b = new Date(now);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months--;
  if (months < 0) return null;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [];
  if (years) parts.push(`${years} ${years === 1 ? 'year' : 'years'}`);
  if (rest || !years) parts.push(`${rest} ${rest === 1 ? 'month' : 'months'}`);
  return parts.join(', ');
}

export function formatDate(ts, opts = { year: 'numeric', month: 'short', day: 'numeric' }) {
  if (ts == null) return '—';
  return new Intl.DateTimeFormat('en-US', opts).format(new Date(ts));
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// Shows the first and last few characters of a secret, never the whole thing.
export function maskSecret(secret, keep = 4) {
  if (!secret) return '';
  const s = String(secret);
  if (s.length <= keep * 2) return '•'.repeat(Math.max(4, s.length));
  return `${s.slice(0, keep)}••••${s.slice(-keep)}`;
}
