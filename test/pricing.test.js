import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLowest, resolveAvg, resolvePrices, skewOf, trimmedMean, averageSteamHistory, priceLabel } from '../src/core/pricing.js';

const sales = (avg, median, volume, min = null, max = null) => ({ avg, median, volume, min, max });
const full = {
  steam: { lowest: 3190, median24h: 3998, volume24h: 69 },
  skinport: {
    min: 2109,
    sales: { '24h': sales(2938, 2658, 4, 2509, 3926), '7d': sales(3220, 2562, 60, 2208, 21744), '30d': sales(3985, 2665, 309, 1878, 211460), '90d': sales(4264, 2865, 913, 1878, 211460) },
  },
};

test('LOWEST is the Steam floor by default and labelled as such', () => {
  const q = resolveLowest(full, { source: 'both' });
  assert.equal(q.value, 3190);
  assert.equal(q.label, 'Steam floor');
  assert.equal(q.fallback, false);
});

test('LOWEST uses the Skinport floor when Skinport is chosen', () => {
  const q = resolveLowest(full, { source: 'skinport' });
  assert.equal(q.value, 2109);
  assert.equal(q.label, 'Skinport floor');
});

test('LOWEST falls back to the other marketplace, labelled', () => {
  const q = resolveLowest({ skinport: { min: 500 } }, { source: 'both' });
  assert.equal(q.value, 500);
  assert.equal(q.fallback, true);
  assert.equal(q.requested, 'Steam floor');
  assert.equal(q.label, 'Skinport floor');
  assert.match(q.note, /No Steam floor/);
});

test('AVG is the Skinport mean of sales for the chosen window', () => {
  const q = resolveAvg(full, { source: 'both', window: '30d' });
  assert.equal(q.value, 3985);
  assert.equal(q.label, 'Skinport avg 30d');
  assert.equal(q.window, '30d');
  assert.equal(q.median, 2665);
  assert.equal(q.fallback, false);
});

test('AVG falls back to the Steam 24 h median and says so', () => {
  const q = resolveAvg({ steam: { lowest: 66, median24h: 68, volume24h: 3568 } }, { source: 'both', window: '7d' });
  assert.equal(q.value, 68);
  assert.equal(q.metric, 'median');
  assert.equal(q.label, 'Steam median 24h');
  assert.equal(q.fallback, true);
  assert.equal(q.requested, 'Skinport avg 7d');
  assert.match(q.note, /does not list/);
});

test('AVG with no Skinport sales in the window falls back with a reason', () => {
  const q = resolveAvg({ steam: { median24h: 100 }, skinport: { min: 90, sales: { '7d': sales(null, null, 0) } } }, { window: '7d' });
  assert.equal(q.fallback, true);
  assert.match(q.note, /No Skinport sales in 7d/);
});

test('Steam source uses Steam sales history when the cookie provided it', () => {
  const withHistory = { ...full, steam: { ...full.steam, history: { '7d': sales(3300, 3250, 400, 3000, 3600) } } };
  const q = resolveAvg(withHistory, { source: 'steam', window: '7d' });
  assert.equal(q.label, 'Steam avg 7d');
  assert.equal(q.value, 3300);
  assert.equal(q.fallback, false);
});

test('Steam source without the cookie falls back to the 24 h median, labelled', () => {
  const q = resolveAvg(full, { source: 'steam', window: '7d' });
  assert.equal(q.label, 'Steam median 24h');
  assert.equal(q.fallback, true);
  assert.equal(q.requested, 'Steam avg 7d');
  assert.match(q.note, /login cookie/);
});

test('no data at all yields null rather than zero', () => {
  const p = resolvePrices({}, { source: 'both', window: '7d' });
  assert.equal(p.lowest, null);
  assert.equal(p.avg, null);
});

test('flags skewed averages (Redline FT 30d: one huge sale)', () => {
  const q = resolveAvg(full, { window: '30d' });
  assert.equal(q.skewed, true);
  assert.ok(q.skew.includes('mean-median'));
  assert.ok(q.skew.includes('max'));
  assert.deepEqual(skewOf({ mean: 100, median: 95, max: 140 }), []);
  assert.deepEqual(skewOf({ mean: 100, median: 70, max: 140 }), ['mean-median']);
  assert.deepEqual(skewOf({ mean: 100, median: 98, max: 600 }), ['max']);
});

test('trimmed AVG drops the highest and lowest sale and is labelled', () => {
  assert.equal(trimmedMean({ mean: 3985, volume: 309, min: 1878, max: 211460 }), Math.round((3985 * 309 - 1878 - 211460) / 307));
  assert.equal(trimmedMean({ mean: 100, volume: 2, min: 90, max: 110 }), null);
  const q = resolveAvg(full, { window: '30d', avgMode: 'trimmed' });
  assert.equal(q.trimmed, true);
  assert.equal(q.label, 'Skinport trimmed avg 30d');
  assert.ok(q.value < 3985);
  assert.equal(priceLabel({ source: 'steam', metric: 'avg', window: '7d', trimmed: true }), 'Steam trimmed avg 7d');
});

test('averages Steam price history by volume inside the window', () => {
  const now = Date.UTC(2026, 9, 29, 12);
  const points = [
    ['Oct 01 2026 01: +0', 10, '5'],
    ['Oct 27 2026 01: +0', 30, '10'],
    ['Oct 28 2026 01: +0', 31, '30'],
    ['Oct 29 2026 01: +0', 33, '0'],
  ];
  const w7 = averageSteamHistory(points, '7d', now);
  assert.equal(w7.volume, 40);
  assert.equal(w7.avg, Math.round(((30 * 10 + 31 * 30) / 40) * 100));
  assert.equal(w7.median, 3100);
  const w30 = averageSteamHistory(points, '30d', now);
  assert.equal(w30.volume, 45);
  const w24 = averageSteamHistory(points, '24h', now);
  assert.equal(w24.volume, 0);
  assert.equal(w24.avg, null);
});
