import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScan, ScanError } from '../src/main/scan.js';
import { RateLimitError } from '../src/core/backoff.js';
import { PrivateInventoryError } from '../src/main/steam.js';

const settings = { currency: 'USD', source: 'both', window: '7d', games: [730, 570, 753], customContexts: [], steamFloorLimit: 40, avgMode: 'mean', buyOrders: false, buyOrdersTopN: 15, captureRate: 0.1, skinportFee: 0.08 };

test('the offline demo produces a complete, labelled report', async () => {
  const r = await runScan({ demo: true, settings, secrets: {}, deps: {} });
  assert.equal(r.demo, true);
  assert.equal(r.games.length, 3);
  assert.ok(r.summary.counts.items > 100);
  assert.ok(r.summary.totals.lowest.value > 0);
  assert.ok(r.summary.totals.avg.value > 0);
  assert.ok(r.summary.totals.instant.value > 0, 'demo carries buy-order ladders');
  const kinds = r.summary.warnings.map((w) => w.kind);
  for (const k of ['unpriced', 'non-marketable', 'avg-fallback', 'locked', 'skewed', 'liquidity']) assert.ok(kinds.includes(k), k);
  const gems = r.stacks.find((s) => s.marketHashName === '753-Sack of Gems');
  assert.equal(gems.prices.avg.label, 'Steam median 24h');
  assert.equal(gems.prices.avg.fallback, true);
  assert.ok(r.summary.locks.length >= 1);
  assert.ok(r.notices.some((n) => n.kind === 'demo'));
});

test('the demo converts to another currency at a labelled fixed rate', async () => {
  const usd = await runScan({ demo: true, settings, secrets: {}, deps: {} });
  const eur = await runScan({ demo: true, settings: { ...settings, currency: 'EUR' }, secrets: {}, deps: {} });
  assert.equal(eur.currency, 'EUR');
  assert.ok(eur.summary.totals.lowest.value < usd.summary.totals.lowest.value);
  assert.ok(eur.notices.some((n) => n.kind === 'demo-currency'));
});

function fakeDeps({ inventoryError = null, priceError = null } = {}) {
  const inv = {
    assets: [{ assetid: '1', classid: '1', instanceid: '0', amount: '1' }, { assetid: '2', classid: '2', instanceid: '0', amount: '1' }],
    descriptions: [
      { classid: '1', instanceid: '0', name: 'AK-47 | Redline (Field-Tested)', market_hash_name: 'AK-47 | Redline (Field-Tested)', marketable: 1, tradable: 1, tags: [] },
      { classid: '2', instanceid: '0', name: 'Revolution Case', market_hash_name: 'Revolution Case', marketable: 1, tradable: 1, tags: [] },
    ],
  };
  let priceCalls = 0;
  return {
    priceCalls: () => priceCalls,
    steam: {
      profile: async () => ({ steamid: '76561197960287930', name: 'Tester', privacy: 'public' }),
      inventory: async (id, appid) => {
        if (appid !== 730) return { assets: [], descriptions: [], savedAt: Date.now() };
        if (inventoryError) throw inventoryError;
        return { ...inv, savedAt: Date.now() };
      },
      cachedPriceOverview: () => null,
      priceOverview: async (appid, name) => {
        priceCalls++;
        if (priceError && priceCalls > 1) throw priceError;
        return name.startsWith('AK') ? { lowest: 3190, median24h: 3998, volume24h: 69 } : { lowest: 19, median24h: 19, volume24h: 89000 };
      },
      orderbook: async () => null,
    },
    skinport: {
      catalog: async () => ({
        items: new Map([['AK-47 | Redline (Field-Tested)', { min: 2109, versions: 1 }]]),
        sales: new Map([['AK-47 | Redline (Field-Tested)', { sales: { '7d': { avg: 3220, median: 2562, volume: 60, min: 2208, max: 21744 } }, versions: 1 }]]),
        savedAt: Date.now(),
      }),
    },
  };
}

test('a live scan labels each source and falls back honestly', async () => {
  const deps = fakeDeps();
  const r = await runScan({ input: '76561197960287930', settings, secrets: {}, deps });
  const ak = r.stacks.find((s) => s.marketHashName.startsWith('AK'));
  const cs = r.stacks.find((s) => s.marketHashName === 'Revolution Case');
  assert.equal(ak.prices.lowest.label, 'Steam floor');
  assert.equal(ak.prices.avg.label, 'Skinport avg 7d');
  assert.equal(cs.prices.avg.label, 'Steam median 24h');
  assert.equal(cs.prices.avg.fallback, true);
  assert.equal(r.games.find((g) => g.appid === 730).status, 'ok');
  assert.equal(r.games.find((g) => g.appid === 570).status, 'empty');
});

test('a rate-limited Steam Market stops lookups and says so', async () => {
  const deps = fakeDeps({ priceError: new RateLimitError('The Steam Market', 120000) });
  const r = await runScan({ input: '76561197960287930', settings, secrets: {}, deps });
  assert.equal(deps.priceCalls(), 2);
  const note = r.notices.find((n) => n.kind === 'steam-rate-limit');
  assert.ok(note);
  assert.match(note.text, /Retry in about 2 min/);
  const cs = r.stacks.find((s) => s.marketHashName === 'Revolution Case');
  assert.equal(cs.prices.lowest, null);
});

test('rate-limited and private inventories become per-game statuses', async () => {
  const limited = await runScan({ input: '76561197960287930', settings, secrets: {}, deps: fakeDeps({ inventoryError: new RateLimitError('Steam', 300000) }) });
  const g = limited.games.find((x) => x.appid === 730);
  assert.equal(g.status, 'rate-limited');
  assert.match(g.message, /rate-limiting this connection/);
  assert.ok(limited.notices.some((n) => n.kind === 'inventory-rate-limit'));
  const priv = await runScan({ input: '76561197960287930', settings, secrets: {}, deps: fakeDeps({ inventoryError: new PrivateInventoryError() }) });
  assert.equal(priv.games.find((x) => x.appid === 730).status, 'private');
});

test('bad input is rejected before any request', async () => {
  await assert.rejects(runScan({ input: 'https://example.com/x', settings, secrets: {}, deps: {} }), (e) => e instanceof ScanError && e.kind === 'input');
});
