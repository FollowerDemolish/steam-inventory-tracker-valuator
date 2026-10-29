// Human wording for sources, windows and coverage.

import { WINDOW_LABELS } from '../../core/pricing.js';
import { venueById } from '../../core/venues.js';
import { formatDate } from '../../core/format.js';

export function windowLabel(w) {
  return WINDOW_LABELS[w] ?? w;
}

export function venueShort(id) {
  return venueById(id)?.short ?? id;
}

function lowestMode(result) {
  return result.lowestSource ?? (result.source === 'skinport' ? 'skinport' : 'steam');
}

export function lowestSource(result) {
  const mode = lowestMode(result);
  if (mode === 'best') return 'Best floor across marketplaces';
  return `${venueShort(mode)} floor`;
}

export function avgSource(result) {
  const src = result.avgSource ?? (result.source === 'steam' ? 'steam' : 'skinport');
  return `${venueShort(src)} ${result.avgMode === 'trimmed' ? 'trimmed avg' : 'avg'}, ${windowLabel(result.window)}`;
}

export function lowestFallbackText(result) {
  const mode = lowestMode(result);
  if (mode === 'best') {
    const used = Object.keys(result.summary.mix.lowest).length;
    return used > 1 ? `Each item uses its cheapest listing, across ${used} marketplaces.` : null;
  }
  const n = Object.entries(result.summary.mix.lowest).filter(([k]) => k.endsWith('-fallback')).reduce((a, [, v]) => a + v, 0);
  if (!n) return null;
  const other = mode === 'steam' ? 'Skinport' : 'Steam';
  return `${n === 1 ? '1 item uses' : `${n} items use`} the ${other} floor instead.`;
}

// "USD prices converted at 1 USD = 0.897 EUR (open.er-api.com, Oct 29, 2026)."
export function fxNote(fx, currency) {
  if (!fx || currency === 'USD') return null;
  const rate = fx.rates?.[currency];
  if (!rate) return `No exchange rate for ${currency}, so USD-only marketplaces are hidden.`;
  const digits = rate >= 100 ? 2 : rate >= 10 ? 3 : 4;
  return `USD prices converted at 1 USD = ${rate.toFixed(digits)} ${currency} (${fx.source ?? 'exchange rates'}${fx.date ? `, ${formatDate(fx.date)}` : ''}).`;
}

export function avgFallbackText(result) {
  const w = result.summary.warnings.find((x) => x.kind === 'avg-fallback');
  if (!w) return null;
  const medians = result.summary.mix.avg['steam-median'] ?? 0;
  const n = w.keys.length;
  const verb = n === 1 ? '1 item uses' : `${n} items use`;
  if (medians === n) return `${verb} the Steam 24 h median instead.`;
  return `${verb} a labelled substitute.`;
}

export function coverageText(t) {
  return `${t.priced} of ${t.of} priced`;
}

export function daysText(days) {
  if (days == null) return 'No sales data';
  if (days < 1 / 24) return 'Minutes';
  if (days < 1) return `${Math.max(1, Math.round(days * 24))} h`;
  if (days < 60) return `${days < 10 ? days.toFixed(1).replace(/\.0$/, '') : Math.round(days)} days`;
  return `${Math.round(days / 30)} months`;
}

export function holdText(iso, now = Date.now()) {
  const ms = Date.parse(iso) - now;
  if (!(ms > 0)) return 'Unlocked';
  const days = Math.ceil(ms / 864e5);
  return days <= 1 ? 'Unlocks within a day' : `Unlocks in ${days} days`;
}

export function holdShort(iso, now = Date.now()) {
  const ms = Date.parse(iso) - now;
  if (!(ms > 0)) return null;
  const days = Math.ceil(ms / 864e5);
  return days <= 1 ? '<1d' : `${days}d`;
}
