import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexSkinportItems, indexSkinportSales, skinportQuote } from '../src/core/skinport-data.js';
import { parseOrderbook, walkBuyOrders, currencyFromSteamId } from '../src/core/orderbook.js';
import { resolveDataDir, DATA_FOLDER_NAME } from '../src/core/data-dir.js';
import { parseProfileXml } from '../src/core/profile-xml.js';
import { sellerReceives } from '../src/core/fees.js';

const bucket = (avg, median, volume, min = avg, max = avg) => ({ avg, median, volume, min, max });

test('Skinport rows become cents, preferring the versionless row', () => {
  const items = indexSkinportItems([
    { market_hash_name: 'AK-47 | Redline (Field-Tested)', version: null, min_price: 21.09, suggested_price: 30.1, quantity: 120, item_page: 'https://skinport.com/item/x' },
  ]);
  const sales = indexSkinportSales([
    { market_hash_name: 'AK-47 | Redline (Field-Tested)', version: null, last_24_hours: bucket(29.38, 26.58, 4), last_7_days: bucket(32.2, 25.62, 60), last_30_days: bucket(39.85, 26.65, 309, 18.78, 2114.6), last_90_days: bucket(42.64, 28.65, 913) },
  ]);
  const q = skinportQuote('AK-47 | Redline (Field-Tested)', items, sales);
  assert.equal(q.min, 2109);
  assert.equal(q.sales['7d'].avg, 3220);
  assert.equal(q.sales['30d'].max, 211460);
  assert.equal(q.versions, 1);
  assert.equal(skinportQuote('Nope', items, sales), null);
});

test('Skinport versions (Doppler phases) are blended and counted', () => {
  const name = '★ Karambit | Doppler (Factory New)';
  const items = indexSkinportItems([
    { market_hash_name: name, version: 'Phase 1', min_price: 1192.92, quantity: 5 },
    { market_hash_name: name, version: 'Phase 2', min_price: 1583.89, quantity: 3 },
  ]);
  const sales = indexSkinportSales([
    { market_hash_name: name, version: 'Phase 1', last_7_days: bucket(1159.3, 1156.78, 12, 1073.54, 1226.61) },
    { market_hash_name: name, version: 'Phase 2', last_7_days: bucket(1622.43, 1621.7, 6, 1591.84, 1667.5) },
  ]);
  const q = skinportQuote(name, items, sales);
  assert.equal(q.min, 119292);
  assert.equal(q.versions, 2);
  assert.equal(q.sales['7d'].volume, 18);
  assert.equal(q.sales['7d'].avg, Math.round(((1159.3 * 12 + 1622.43 * 6) / 18) * 100));
  assert.equal(q.sales['7d'].median, null);
  assert.equal(q.sales['24h'].avg, null);
});

test('parses the Steam order book and detects its currency', () => {
  const book = parseOrderbook({ data: { success: true, data: { amtMaxBuyOrder: 2824, amtMinSellOrder: 2866, eCurrency: 3, cBuyOrders: 57, cSellOrders: 9, rgCompactBuyOrders: [2809, 51, 2824, 2, 2823, 4] } } });
  assert.equal(book.currency, 'EUR');
  assert.equal(book.bid, 2824);
  assert.deepEqual(book.ladder, [[2824, 2], [2823, 4], [2809, 51]]);
  assert.equal(currencyFromSteamId(1), 'USD');
  assert.equal(parseOrderbook({ data: { success: false } }), null);
});

test('walks buy orders for the quantity held, applying fees per unit', () => {
  const ladder = [[19, 100], [18, 250], [17, 10000]];
  const w = walkBuyOrders(ladder, 300);
  assert.equal(w.filled, 300);
  assert.equal(w.gross, 19 * 100 + 18 * 200);
  assert.equal(w.net, sellerReceives(19) * 100 + sellerReceives(18) * 200);
  assert.equal(w.lowestTouched, 18);
  const short = walkBuyOrders([[500, 2]], 5);
  assert.equal(short.filled, 2);
  assert.equal(short.unfilled, 3);
});

test('portable data folder rules', () => {
  assert.deepEqual(resolveDataDir({ env: { PORTABLE_EXECUTABLE_DIR: '/mnt/usb' }, userData: '/home/u/.config/Glasscase' }), { dir: `/mnt/usb/${DATA_FOLDER_NAME}`, mode: 'portable-exe' });
  assert.deepEqual(resolveDataDir({ env: { APPIMAGE: '/opt/apps/Glasscase-0.1.0.AppImage' }, userData: '/x' }), { dir: `/opt/apps/${DATA_FOLDER_NAME}`, mode: 'appimage' });
  assert.deepEqual(resolveDataDir({ env: {}, userData: '/home/u/.config/Glasscase' }), { dir: '/home/u/.config/Glasscase', mode: 'user-data' });
  assert.equal(resolveDataDir({ env: { APPIMAGE: '/a/b.AppImage' }, userData: '/x', override: '/tmp/gc' }).mode, 'custom');
});

test('reads the public profile XML', () => {
  const xml = `<?xml version="1.0"?><profile><steamID64>76561197960287930</steamID64><steamID><![CDATA[Rabscuttle]]></steamID>
    <privacyState>public</privacyState><avatarFull><![CDATA[https://avatars.fastly.steamstatic.com/a_full.jpg]]></avatarFull>
    <vacBanned>0</vacBanned><tradeBanState>None</tradeBanState><isLimitedAccount>0</isLimitedAccount>
    <memberSince>September 12, 2003</memberSince><customURL><![CDATA[gabelogannewell]]></customURL></profile>`;
  const r = parseProfileXml(xml);
  assert.equal(r.ok, true);
  assert.equal(r.profile.name, 'Rabscuttle');
  assert.equal(r.profile.vacBanned, false);
  assert.equal(r.profile.customUrl, 'gabelogannewell');
  assert.equal(new Date(r.profile.created).getFullYear(), 2003);
  const missing = parseProfileXml('<response><error><![CDATA[The specified profile could not be found.]]></error></response>');
  assert.equal(missing.ok, false);
  assert.match(missing.error, /could not be found/);
});
