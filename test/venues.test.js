import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseWaxpeer, parseMarketCsgo, parseLisSkins, parseCsfloatGraph, parseFx } from '../src/core/venue-parsers.js';
import { convert, venueRows, venueNet, markBest, defaultVenueSettings, venueSupports } from '../src/core/venues.js';
import { resolveLowest, resolveAvg, resolvePrices } from '../src/core/pricing.js';
import { buildReport } from '../src/core/report.js';
import { sellerReceives } from '../src/core/fees.js';
import { Store } from '../src/main/store.js';
import { runScan } from '../src/main/scan.js';

const FX = { base: 'USD', rates: { USD: 1, EUR: 0.9, RUB: 80.5 }, date: Date.UTC(2026, 9, 29), source: 'open.er-api.com' };
const ALL_ON = { skinport: true, waxpeer: true, marketcsgo: true, lisskins: true, csfloat: true };
const FEES = { skinport: 0.08, waxpeer: 0.06, marketcsgo: 0.05, lisskins: 0.05 };

test('Waxpeer prices are thousandths of a dollar', () => {
  const m = parseWaxpeer({ success: true, items: [{ name: 'AWP | Asiimov (Field-Tested)', count: 130, min: 100900 }, { name: 'Bad', count: 1, min: 0 }] });
  assert.deepEqual(m['AWP | Asiimov (Field-Tested)'], { min: 10090, count: 130 });
  assert.equal(m.Bad, undefined);
  assert.deepEqual(parseWaxpeer(null), {});
});

test('Market.CSGO prices are strings in dollars; the cheapest duplicate wins', () => {
  const m = parseMarketCsgo({ success: true, currency: 'USD', items: [
    { market_hash_name: 'AK-47 | Redline (Field-Tested)', volume: '69', price: '25.326' },
    { market_hash_name: 'AK-47 | Redline (Field-Tested)', volume: '3', price: '24.990' },
  ] });
  assert.deepEqual(m['AK-47 | Redline (Field-Tested)'], { min: 2499, count: 3 });
  assert.deepEqual(parseMarketCsgo({ currency: 'RUB', items: [{ market_hash_name: 'x', price: '1' }] }), {}, 'non-USD feeds are ignored');
});

test('Lis-skins keeps the item link and the unlocked price', () => {
  const m = parseLisSkins([{ name: 'AWP | Asiimov (Field-Tested)', price: 99.39, unlocked_price: 101.2, url: 'https://lis-skins.com/market/csgo/awp-asiimov-field-tested/', count: 40 }]);
  assert.deepEqual(m['AWP | Asiimov (Field-Tested)'], { min: 9939, count: 40, unlocked: 10120, url: 'https://lis-skins.com/market/csgo/awp-asiimov-field-tested/' });
});

test('CSFloat daily averages become weighted window stats', () => {
  const now = Date.UTC(2026, 9, 29, 12);
  const day = (d) => new Date(Date.UTC(2026, 9, d)).toISOString();
  const g = parseCsfloatGraph([
    { day: day(29), count: 10, avg_price: 3000 },
    { day: day(27), count: 30, avg_price: 2000 },
    { day: day(1), count: 60, avg_price: 1000 },
  ], now);
  assert.equal(g.currency, 'USD');
  assert.equal(g.sales['24h'].volume, 10);
  assert.equal(g.sales['7d'].volume, 40);
  assert.equal(g.sales['7d'].avg, Math.round((3000 * 10 + 2000 * 30) / 40));
  assert.equal(g.sales['7d'].median, 2000);
  assert.equal(g.sales['7d'].max, 3000);
  assert.equal(g.sales['30d'].volume, 100);
  assert.equal(parseCsfloatGraph([], now).sales['7d'].avg, null);
});

test('exchange rates parse and convert, with the rate and date kept', () => {
  const fx = parseFx({ result: 'success', base_code: 'USD', time_last_update_unix: 1793232151, rates: { USD: 1, EUR: 0.897215, RUB: 80.531694 } });
  assert.equal(fx.base, 'USD');
  assert.equal(fx.rates.RUB, 80.531694);
  assert.equal(fx.date, 1793232151000);
  assert.equal(parseFx({ result: 'error' }), null);
  assert.deepEqual(convert(1000, 'USD', 'USD', null), { value: 1000, rate: 1, date: null, source: null });
  assert.equal(convert(1000, 'USD', 'EUR', FX).value, 900);
  assert.equal(convert(900, 'EUR', 'USD', FX).value, 1000);
  assert.equal(convert(1000, 'USD', 'RUB', FX).value, 80500);
  assert.equal(convert(1000, 'USD', 'KZT', FX), null, 'a missing rate is not guessed');
});

function stack(quotes, extra = {}) {
  return { key: 'k', appid: 730, marketHashName: 'AK-47 | Redline (Field-Tested)', quantity: 1, marketable: true, quotes, ...extra };
}

const quotes = {
  steam: { lowest: 3190, median24h: 3998, volume24h: 69 },
  skinport: { min: 2109, quantity: 64, sales: { '7d': { avg: 3220, median: 2562, volume: 60, min: 2208, max: 21744 } } },
  venues: {
    waxpeer: { min: 2551, count: 120, currency: 'USD' },
    marketcsgo: { min: 2533, count: 69, currency: 'USD' },
    lisskins: { min: 2517, count: 40, currency: 'USD', url: 'https://lis-skins.com/x' },
  },
};

test('venue rows carry floor, listings, net after each fee and a link', () => {
  const rows = venueRows(stack(quotes), { currency: 'USD', fx: null, enabled: ALL_ON, fees: FEES });
  assert.deepEqual(rows.map((r) => r.id), ['steam', 'skinport', 'waxpeer', 'marketcsgo', 'lisskins']);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by.steam.kind, 'wallet');
  assert.equal(by.steam.net, sellerReceives(3190));
  assert.equal(by.skinport.net, Math.floor(2109 * 0.92));
  assert.equal(by.waxpeer.net, Math.floor(2551 * 0.94));
  assert.equal(by.lisskins.url, 'https://lis-skins.com/x');
  assert.equal(venueNet('marketcsgo', 2533, { fees: FEES }), Math.floor(2533 * 0.95));
  assert.equal(by.skinport.cheapest, true, 'Skinport has the lowest floor');
  assert.equal(by.steam.bestSell, true, 'Steam nets most, but in wallet funds');
  assert.equal(by.marketcsgo.bestCash, true, 'Market.CSGO nets most in cash');
});

test('disabled venues are left out and USD venues convert with the rate shown', () => {
  const rows = venueRows(stack(quotes), { currency: 'EUR', fx: FX, enabled: { ...ALL_ON, waxpeer: false }, fees: FEES });
  assert.ok(!rows.some((r) => r.id === 'waxpeer'));
  const tm = rows.find((r) => r.id === 'marketcsgo');
  assert.equal(tm.floor, Math.round(2533 * 0.9));
  assert.equal(tm.native.value, 2533);
  assert.equal(tm.converted.rate, 0.9);
  assert.equal(tm.converted.source, 'open.er-api.com');
  const noRate = venueRows(stack(quotes), { currency: 'KZT', fx: FX, enabled: ALL_ON, fees: FEES }).find((r) => r.id === 'lisskins');
  assert.equal(noRate.floor, null);
  assert.equal(noRate.missingRate, true);
});

test('best markers handle ties and empty input', () => {
  assert.deepEqual(markBest([]), []);
  const rows = markBest([{ id: 'a', kind: 'cash', floor: 100, net: 90 }, { id: 'b', kind: 'cash', floor: 100, net: 95 }]);
  assert.equal(rows[0].cheapest, true);
  assert.equal(rows[1].bestSell, true);
});

test('LOWEST follows the chosen venue and labels it', () => {
  const ctx = { currency: 'USD', venues: ALL_ON, fees: FEES };
  assert.equal(resolveLowest(quotes, { ...ctx, lowestSource: 'steam' }).label, 'Steam floor');
  const best = resolveLowest(quotes, { ...ctx, lowestSource: 'best' });
  assert.equal(best.value, 2109);
  assert.equal(best.label, 'Skinport floor');
  assert.equal(best.best, true);
  const wax = resolveLowest(quotes, { ...ctx, lowestSource: 'waxpeer' });
  assert.equal(wax.label, 'Waxpeer floor');
  assert.equal(wax.value, 2551);
  assert.equal(wax.kind, 'cash');
  const fb = resolveLowest({ steam: quotes.steam }, { ...ctx, lowestSource: 'lisskins' });
  assert.equal(fb.fallback, true);
  assert.equal(fb.label, 'Steam floor');
  assert.match(fb.note, /No Lis-skins listing/);
});

test('the default Steam floor never falls back to third-party floors', () => {
  const onlyLis = { venues: { lisskins: { min: 1259234, count: 1, currency: 'USD' } } };
  assert.equal(resolveLowest(onlyLis, { lowestSource: 'steam', venues: ALL_ON }), null);
  const p = resolvePrices(onlyLis, { lowestSource: 'steam', venues: ALL_ON }, stack(onlyLis));
  assert.equal(p.lowest, null);
  assert.equal(p.venues[0].id, 'lisskins', 'the sheet can still show where it is listed');
  assert.equal(resolveLowest(onlyLis, { lowestSource: 'best', venues: ALL_ON }).value, 1259234);
});

test('CSFloat is a labelled second AVG source only when enabled', () => {
  const now = Date.UTC(2026, 9, 29, 12);
  const csfloat = parseCsfloatGraph([{ day: new Date(Date.UTC(2026, 9, 28)).toISOString(), count: 20, avg_price: 4700 }], now);
  const q = { steam: { median24h: 3998 }, csfloat };
  const off = resolveAvg(q, { window: '7d', venues: { ...ALL_ON, csfloat: false } });
  assert.equal(off.label, 'Steam median 24h');
  const on = resolveAvg(q, { window: '7d', venues: ALL_ON, currency: 'EUR', fx: FX });
  assert.equal(on.label, 'CSFloat avg 7d');
  assert.equal(on.value, Math.round(4700 * 0.9));
  assert.equal(on.fallback, true);
  assert.match(on.note, /float and sticker premiums/);
});

test('per-venue totals use the valued items and name the best cash venue', () => {
  const stacks = [
    stack(quotes, { key: 'a', quantity: 2 }),
    stack({ steam: { lowest: 1000 }, venues: { waxpeer: { min: 900, count: 5, currency: 'USD' } } }, { key: 'b', marketHashName: 'B' }),
    stack({ venues: { lisskins: { min: 999999, count: 1, currency: 'USD' } } }, { key: 'c', marketHashName: 'C' }),
  ];
  const { summary } = buildReport(stacks, { lowestSource: 'steam', window: '7d', venues: ALL_ON, fees: FEES, now: Date.UTC(2026, 9, 29) }, 'USD');
  const v = Object.fromEntries(summary.venues.map((x) => [x.id, x]));
  assert.equal(v.steam.total, 3190 * 2 + 1000);
  assert.equal(v.steam.priced, 2);
  assert.equal(v.steam.of, 2, 'the unpriced item is not in the comparison');
  assert.equal(v.lisskins.total, 2517 * 2, 'the Lis-skins-only item stays out');
  assert.equal(v.waxpeer.net, Math.floor(2551 * 0.94) * 2 + Math.floor(900 * 0.94));
  assert.equal(summary.verdict.wallet, 'steam');
  assert.equal(summary.verdict.cash, 'waxpeer');
  assert.equal(summary.verdict.bestCash.value, Math.floor(2533 * 0.95) * 2 + Math.floor(900 * 0.94));
  assert.deepEqual(summary.verdict.bestCash.byVenue, { marketcsgo: 1, waxpeer: 1 });
});

test('settings migrate the old single source and sanitize venues and fees', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glasscase-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ source: 'skinport', skinportFee: 0.06, venues: { waxpeer: false, bogus: true }, fees: { lisskins: 9 } }));
    const s = new Store(dir).getSettings();
    assert.equal(s.lowestSource, 'skinport');
    assert.equal(s.avgSource, 'skinport');
    assert.equal(s.fees.skinport, 0.06);
    assert.equal(s.fees.lisskins, 0.5, 'fees are clamped');
    assert.equal(s.venues.waxpeer, false);
    assert.equal(s.venues.marketcsgo, true);
    assert.equal(s.venues.csfloat, false, 'CSFloat stays off by default');
    assert.equal('bogus' in s.venues, false);
    assert.deepEqual(Object.keys(defaultVenueSettings().fees).sort(), ['lisskins', 'marketcsgo', 'skinport', 'waxpeer']);
    assert.equal(venueSupports('lisskins', 440), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a live scan merges venue catalogs and converts USD venues', async () => {
  const settings = {
    currency: 'EUR', lowestSource: 'steam', avgSource: 'skinport', window: '7d', games: [730], customContexts: [], steamFloorLimit: 5,
    avgMode: 'mean', buyOrders: false, captureRate: 0.1, venues: { ...ALL_ON, csfloat: false }, fees: FEES,
  };
  const deps = {
    steam: {
      profile: async () => ({ steamid: '76561197960287930', name: 'Tester', privacy: 'public' }),
      inventory: async () => ({
        assets: [{ assetid: '1', classid: '1', instanceid: '0', amount: '1' }],
        descriptions: [{ classid: '1', instanceid: '0', name: 'AK', market_hash_name: 'AK', marketable: 1, tradable: 1, tags: [] }],
        savedAt: Date.now(),
      }),
      cachedPriceOverview: () => null,
      priceOverview: async () => ({ lowest: 2900, median24h: 3000, volume24h: 50 }),
    },
    skinport: { catalog: async () => ({ items: new Map(), sales: new Map(), savedAt: Date.now() }) },
    venues: {
      catalog: async (id) => {
        if (id === 'lisskins') throw new Error('HTTP 503');
        return { data: { AK: { min: id === 'waxpeer' ? 2500 : 2600, count: 9 } }, savedAt: Date.now() };
      },
      fx: async () => FX,
    },
  };
  const r = await runScan({ input: '76561197960287930', settings, secrets: {}, deps });
  assert.equal(r.fx, FX);
  const rows = r.stacks[0].prices.venues;
  assert.equal(rows.find((x) => x.id === 'waxpeer').floor, 2250);
  assert.ok(r.notices.some((n) => n.kind === 'venue-error' && /Lis-skins/.test(n.text)));
  assert.equal(r.summary.verdict.cash, 'marketcsgo');
});
