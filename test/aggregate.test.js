import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, spreadOf, daysToSell, skinportNet } from '../src/core/aggregate.js';
import { buildReport, historyDelta } from '../src/core/report.js';
import { sellerReceives } from '../src/core/fees.js';

const NOW = Date.UTC(2026, 9, 29);
const stack = (key, quantity, quotes, extra = {}) => ({ key, appid: 730, marketHashName: key, quantity, marketable: true, tradable: true, quotes, ...extra });
const sp = (min, avg7, median7, vol7, max7 = null) => ({ min, sales: { '7d': { avg: avg7, median: median7, volume: vol7, min: null, max: max7 } } });

function report(stacks, settings = {}) {
  return buildReport(stacks, { source: 'both', window: '7d', now: NOW, ...settings }, 'USD');
}

test('totals LOWEST, AVG and Net with coverage counts', () => {
  const { summary } = report([
    stack('A', 2, { steam: { lowest: 1000, volume24h: 50 }, skinport: sp(900, 950, 940, 30) }),
    stack('B', 1, { steam: { lowest: 300, volume24h: 10 } }),
    stack('C', 1, {}),
    stack('D', 1, {}, { marketable: false }),
  ]);
  assert.equal(summary.totals.lowest.value, 2300);
  assert.equal(summary.totals.lowest.priced, 2);
  assert.equal(summary.totals.lowest.of, 3);
  assert.equal(summary.totals.avg.value, 1900);
  assert.equal(summary.totals.avg.priced, 1);
  assert.equal(summary.totals.net.value, sellerReceives(1000) * 2 + sellerReceives(300));
  assert.equal(summary.counts.unpriced, 1);
  assert.equal(summary.counts.nonMarketable, 1);
  assert.equal(summary.counts.items, 5);
});

test('raises unpriced, non-marketable, spread and liquidity warnings', () => {
  const { summary } = report([
    stack('Wide', 1, { steam: { lowest: 1000, volume24h: 5 }, skinport: sp(900, 400, 400, 10) }),
    stack('Thin', 40, { steam: { lowest: 500, volume24h: 34 }, skinport: sp(480, 490, 488, 200) }),
    stack('None', 1, {}),
    stack('Coin', 1, {}, { marketable: false }),
  ]);
  const kinds = summary.warnings.map((w) => w.kind);
  for (const k of ['unpriced', 'non-marketable', 'spread', 'liquidity']) assert.ok(kinds.includes(k), k);
  assert.deepEqual(summary.warnings.find((w) => w.kind === 'spread').keys, ['Wide']);
  assert.deepEqual(summary.warnings.find((w) => w.kind === 'liquidity').keys, ['Thin']);
  assert.ok(spreadOf(1000, 400) > 0.5);
  assert.equal(spreadOf(null, 400), null);
});

test('counts skewed averages and reports fallbacks', () => {
  const { summary, stacks } = report([
    stack('Skew', 2, { steam: { lowest: 3190, volume24h: 69 }, skinport: sp(2109, 3985, 2665, 309, 211460) }),
    stack('Gems', 3, { steam: { lowest: 66, median24h: 68, volume24h: 3568 } }),
  ]);
  assert.equal(summary.counts.skewed, 2);
  assert.ok(stacks[0].derived.skewed);
  assert.ok(summary.warnings.some((w) => w.kind === 'skewed'));
  assert.deepEqual(summary.warnings.find((w) => w.kind === 'avg-fallback').keys, ['Gems']);
  assert.equal(summary.mix.avg['steam-median'], 1);
});

test('nets out Skinport with its fee and computes the wallet premium', () => {
  const { summary } = report([stack('A', 1, { steam: { lowest: 1150, volume24h: 9 }, skinport: sp(1000, 1000, 1000, 9) })], { skinportFee: 0.08 });
  assert.equal(summary.totals.netSkinport.value, 920);
  assert.equal(skinportNet(1000, 0.08), 920);
  const steamNet = sellerReceives(1150);
  assert.ok(Math.abs(summary.exit.walletPremium - (steamNet / 920 - 1)) < 1e-9);
});

test('instant value walks the buy-order ladder and skips locked stacks', () => {
  const book = { bid: 120, currency: 'USD', ladder: [[120, 2], [110, 3], [100, 100]] };
  const { summary, stacks } = report([
    stack('Cases', 6, { steam: { lowest: 130, volume24h: 9000 }, book }),
    stack('Locked', 1, { steam: { lowest: 5000, volume24h: 3 }, book: { bid: 4800, currency: 'USD', ladder: [[4800, 5]] } }, { tradeHoldUntil: '2026-11-05T07:00:00.000Z' }),
  ]);
  const expected = sellerReceives(120) * 2 + sellerReceives(110) * 3 + sellerReceives(100) * 1;
  assert.equal(stacks[0].prices.instant.value, expected);
  assert.equal(stacks[0].prices.instant.filled, 6);
  assert.equal(stacks[1].prices.instant.locked, true);
  assert.equal(summary.totals.instant.value, expected);
  assert.equal(summary.totals.instant.priced, 1);
});

test('keeps instant values in another currency out of the totals', () => {
  const { summary } = report([stack('A', 1, { steam: { lowest: 3190 }, book: { bid: 2824, currency: 'EUR', ladder: [[2824, 2]] } })]);
  assert.equal(summary.totals.instant.value, 0);
  assert.equal(summary.totals.instant.otherCurrency, 'EUR');
  assert.equal(summary.totals.instant.otherValue, sellerReceives(2824));
});

test('groups trade locks by unlock day and computes sellable within 7 days', () => {
  const { summary } = report([
    stack('L1', 1, { steam: { lowest: 1000, volume24h: 100 } }, { tradeHoldUntil: '2026-11-03T07:00:00.000Z' }),
    stack('L2', 1, { steam: { lowest: 500, volume24h: 100 } }, { tradeHoldUntil: '2026-11-03T08:00:00.000Z' }),
    stack('Free', 1, { steam: { lowest: 2000, volume24h: 0.5 } }),
  ]);
  assert.equal(summary.locks.length, 1);
  assert.equal(summary.locks[0].value, 1500);
  assert.equal(summary.locks[0].count, 2);
  assert.equal(summary.lockedValue, 1500);
  // Free: 1 unit, 0.5/day x 10% capture -> 20 days; 7/20 of its value sells within a week.
  assert.equal(daysToSell(1, { value: 0.5 }, 0.1), 20);
  const expected = (1000 + 500 + 2000 * (7 / 20)) / 3500;
  assert.ok(Math.abs(summary.exit.sellable7d - expected) < 1e-9);
});

test('per-game breakdown and top items are sorted by value', () => {
  const s = aggregate([
    { key: 'x', appid: 570, quantity: 1, marketable: true, prices: { lowest: { value: 100, source: 'steam' } } },
    { key: 'y', appid: 730, quantity: 1, marketable: true, prices: { lowest: { value: 900, source: 'steam' } } },
  ]);
  assert.deepEqual(s.perGame.map((g) => g.appid), [730, 570]);
  assert.equal(s.top[0].key, 'y');
  assert.equal(s.perGame[0].share, 0.9);
});

test('history delta compares with the previous scan in the same currency', () => {
  assert.equal(historyDelta([{ lowest: 100, currency: 'USD', at: 1 }]), null);
  const d = historyDelta([
    { lowest: 1000, avg: 900, currency: 'USD', at: 1 },
    { lowest: 5000, currency: 'EUR', at: 2 },
    { lowest: 1100, avg: 1000, currency: 'USD', at: 3 },
  ]);
  assert.equal(d.abs, 100);
  assert.equal(d.rel, 0.1);
  assert.equal(d.since, 1);
});
