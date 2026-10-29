// Chooses which number becomes LOWEST and which becomes AVG for one item,
// and labels each with its real source and window.
//
// Contract:
//   LOWEST = the current floor (cheapest live listing).
//   AVG    = the average (mean) of actual sales over the chosen window.
// A fallback is never presented as the requested metric: it carries
// `fallback: true`, its own label, and a note explaining why.
//
// Outlier guard: alongside the mean we keep the window median and max. An
// AVG is "skewed" when mean and median differ by more than 25%, or when the
// biggest sale is more than 5x the median. An opt-in trimmed mean (dropping
// the single highest and lowest sale) is always labelled "trimmed".

import { orderbookInstant } from './instant.js';
import { venueRows, venueById, isEnabled, convert } from './venues.js';

export const WINDOWS = Object.freeze(['24h', '7d', '30d', '90d']);
export const WINDOW_LABELS = Object.freeze({ '24h': '24 h', '7d': '7 days', '30d': '30 days', '90d': '90 days' });
export const SOURCES = Object.freeze(['both', 'steam', 'skinport']);
export const AVG_SOURCES = Object.freeze(['skinport', 'steam']);
export const AVG_MODES = Object.freeze(['mean', 'trimmed']);
export const SKEW_MEAN_MEDIAN = 0.25;
export const SKEW_MAX_MEDIAN = 5;

export function priceLabel({ source, metric, window, trimmed = false }) {
  const name = venueById(source)?.short ?? source;
  if (metric === 'floor') return `${name} floor`;
  if (metric === 'median') return `${name} median ${window}`;
  return `${name} ${trimmed ? 'trimmed avg' : 'avg'} ${window}`;
}

function quote(source, metric, value, window, extra = {}) {
  const q = { value, source, metric, window: window ?? null, fallback: false, ...extra };
  q.label = priceLabel(q);
  return q;
}

const has = (v) => Number.isFinite(v) && v > 0;

// Detects a mean pulled away by outliers.
export function skewOf({ mean, median, max }) {
  const reasons = [];
  if (has(mean) && has(median) && Math.abs(mean - median) / median > SKEW_MEAN_MEDIAN) reasons.push('mean-median');
  if (has(max) && has(median) && max > SKEW_MAX_MEDIAN * median) reasons.push('max');
  return reasons;
}

// Mean without the single highest and lowest sale, from window aggregates.
export function trimmedMean({ mean, volume, min, max }) {
  if (!has(mean) || !(volume >= 3) || !has(min) || !has(max)) return null;
  const v = Math.round((mean * volume - min - max) / (volume - 2));
  return v > 0 ? v : null;
}

function windowAvg(source, bucket, window, avgMode) {
  if (!bucket || !has(bucket.avg) || !(bucket.volume > 0)) return null;
  const stats = { mean: bucket.avg, median: bucket.median ?? null, max: bucket.max ?? null, min: bucket.min ?? null, volume: bucket.volume };
  const skew = skewOf(stats);
  const extra = { volume: bucket.volume, mean: bucket.avg, median: stats.median, max: stats.max, skew, skewed: skew.length > 0 };
  if (avgMode === 'trimmed') {
    const t = trimmedMean(stats);
    if (t) return quote(source, 'avg', t, window, { ...extra, trimmed: true });
    return quote(source, 'avg', bucket.avg, window, { ...extra, note: 'Too few sales to trim, so this is the plain average.' });
  }
  return quote(source, 'avg', bucket.avg, window, extra);
}

function steamMedian24h(steam) {
  return has(steam?.median24h) ? quote('steam', 'median', steam.median24h, '24h', { volume: steam.volume24h ?? null, median: steam.median24h }) : null;
}

function asFallback(q, requested, note) {
  if (!q) return null;
  return { ...q, fallback: true, requested, note: q.note ? `${note} ${q.note}` : note };
}

// The pricing context a set of settings implies.
export function pricingContext(settings = {}) {
  return { currency: settings.currency ?? 'USD', fx: settings.fx ?? null, enabled: settings.venues, fees: settings.fees };
}

// Which venue LOWEST comes from: 'steam' (default), 'best' or a venue id.
// Older settings only had `source`; 'skinport' there meant the Skinport floor.
export function lowestSourceOf(settings = {}) {
  if (settings.lowestSource) return settings.lowestSource;
  return settings.source === 'skinport' ? 'skinport' : 'steam';
}

// Which venue AVG comes from: 'skinport' (default) or 'steam'.
export function avgSourceOf(settings = {}) {
  if (settings.avgSource) return settings.avgSource;
  return settings.source === 'steam' ? 'steam' : 'skinport';
}

function floorQuote(row) {
  if (!row || !(row.floor > 0)) return null;
  return quote(row.id, 'floor', row.floor, 'now', { kind: row.kind, converted: row.converted ?? null });
}

export function resolveLowest(quotes, settings = {}, rows = null) {
  const mode = lowestSourceOf(settings);
  const list = rows ?? venueRows({ quotes }, pricingContext(settings));
  const by = (id) => list.find((r) => r.id === id && r.floor > 0) ?? null;

  if (mode === 'best') {
    const cheapest = list.filter((r) => r.floor > 0).reduce((a, r) => (!a || r.floor < a.floor ? r : a), null);
    const q = floorQuote(cheapest);
    return q ? { ...q, best: true, requested: 'Best floor across marketplaces' } : null;
  }
  if (mode === 'steam') {
    return floorQuote(by('steam')) ?? asFallback(floorQuote(by('skinport')), 'Steam floor', 'No Steam floor available; using the Skinport floor.');
  }
  const name = venueById(mode)?.short ?? mode;
  return floorQuote(by(mode)) ?? asFallback(floorQuote(by('steam')), `${name} floor`, `No ${name} listing; using the Steam floor.`);
}

// CSFloat sales are quoted in USD and converted to the scan currency.
function csfloatAvg(quotes, window, avgMode, settings) {
  const cf = quotes?.csfloat;
  const ctx = pricingContext(settings);
  if (!cf?.sales || !isEnabled('csfloat', ctx)) return null;
  const b = cf.sales[window];
  if (!b || !(b.volume > 0)) return null;
  const c = (v) => (v == null ? null : convert(v, cf.currency ?? 'USD', ctx.currency, ctx.fx)?.value ?? null);
  const bucket = { avg: c(b.avg), median: c(b.median), min: c(b.min), max: c(b.max), volume: b.volume };
  if (bucket.avg == null) return null;
  const q = windowAvg('csfloat', bucket, window, avgMode);
  return q ? { ...q, note: 'CSFloat averages include float and sticker premiums, so they run high.' } : null;
}

export function resolveAvg(quotes, settings = {}) {
  const { window = '7d', avgMode = 'mean' } = settings;
  const source = avgSourceOf(settings);
  const steam = quotes?.steam;
  const sp = quotes?.skinport;
  const spAvg = windowAvg('skinport', sp?.sales?.[window], window, avgMode);
  const stAvg = windowAvg('steam', steam?.history?.[window], window, avgMode);
  const cfAvg = csfloatAvg(quotes, window, avgMode, settings);
  const trim = avgMode === 'trimmed' ? 'trimmed avg' : 'avg';

  if (source === 'steam') {
    const requested = `Steam ${trim} ${window}`;
    if (stAvg) return stAvg;
    const why = steam?.history ? `No Steam sales in ${window}.` : 'Steam sales history needs the optional login cookie.';
    return (
      asFallback(steamMedian24h(steam), requested, `${why} Showing the Steam 24 h median instead.`) ??
      asFallback(spAvg, requested, `${why} Showing the Skinport average instead.`) ??
      asFallback(cfAvg, requested, `${why} Showing the CSFloat average instead.`)
    );
  }
  const requested = `Skinport ${trim} ${window}`;
  if (spAvg) return spAvg;
  const why = sp ? `No Skinport sales in ${window}.` : 'Skinport does not list this item.';
  if (stAvg) return asFallback(stAvg, requested, `${why} Using Steam sales history.`);
  if (cfAvg) return asFallback(cfAvg, requested, `${why} Using CSFloat sales.`);
  return asFallback(steamMedian24h(steam), requested, `${why} Showing the Steam 24 h median instead.`);
}

// Daily sales volume used for liquidity. Prefers Steam's 24 h count, then
// Skinport's 7-day volume spread over 7 days.
export function resolveDailyVolume(quotes) {
  const steamVol = quotes?.steam?.volume24h;
  if (Number.isFinite(steamVol)) return { value: steamVol, source: 'steam', window: '24h' };
  const sp7 = quotes?.skinport?.sales?.['7d']?.volume;
  if (Number.isFinite(sp7)) return { value: sp7 / 7, source: 'skinport', window: '7d' };
  return null;
}

export function resolvePrices(quotes, settings = {}, stack = null) {
  const venues = venueRows({ ...(stack ?? {}), quotes }, pricingContext(settings));
  return {
    lowest: resolveLowest(quotes, settings, venues),
    avg: resolveAvg(quotes, settings),
    dailyVolume: resolveDailyVolume(quotes),
    instant: stack ? orderbookInstant(quotes?.book, stack, settings) : null,
    venues,
  };
}

// Volume-weighted statistics of Steam price history points
// ([dateString, price, volumeString]) inside the window. Prices are in major
// units; results are in minor units.
export function averageSteamHistory(points, window, now = Date.now()) {
  const spanMs = { '24h': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5, '90d': 90 * 864e5 }[window];
  if (!spanMs || !Array.isArray(points)) return null;
  const rows = [];
  for (const [dateText, price, volume] of points) {
    const t = parseSteamHistoryDate(dateText);
    if (t == null || now - t > spanMs || t > now + 864e5) continue;
    const v = Number(String(volume).replace(/[^\d]/g, '')) || 0;
    if (!Number.isFinite(price) || v <= 0) continue;
    rows.push([price, v]);
  }
  const volume = rows.reduce((a, r) => a + r[1], 0);
  if (!volume) return { avg: null, median: null, min: null, max: null, volume: 0 };
  const sum = rows.reduce((a, [p, v]) => a + p * v, 0);
  rows.sort((a, b) => a[0] - b[0]);
  let acc = 0;
  let median = null;
  for (const [p, v] of rows) {
    acc += v;
    if (acc >= volume / 2) {
      median = p;
      break;
    }
  }
  const c = (v) => (v == null ? null : Math.round(v * 100));
  return { avg: c(sum / volume), median: c(median), min: c(rows[0][0]), max: c(rows[rows.length - 1][0]), volume };
}

// "Oct 28 2026 01: +0" -> epoch ms (UTC).
export function parseSteamHistoryDate(text) {
  const m = /^([A-Z][a-z]{2}) (\d{1,2}) (\d{4}) (\d{1,2}):/.exec(String(text ?? ''));
  if (!m) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mo = months.indexOf(m[1]);
  if (mo < 0) return null;
  return Date.UTC(Number(m[3]), mo, Number(m[2]), Number(m[4]));
}
