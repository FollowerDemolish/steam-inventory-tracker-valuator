// Marketplaces Glasscase can price against. Steam pays out in wallet funds
// that can't be withdrawn; every other venue pays cash. Numbers from
// different venues are never mixed without their venue label.

import { sellerReceives } from './fees.js';

export const VENUES = Object.freeze([
  {
    id: 'steam', name: 'Steam Market', short: 'Steam', kind: 'wallet', native: 'scan', role: 'floor', always: true,
    apps: null, access: 'Built in, no key', coverage: 'Every marketable item; paid out as Steam wallet funds',
  },
  {
    id: 'skinport', name: 'Skinport', short: 'Skinport', kind: 'cash', native: 'scan', role: 'floor', defaultOn: true,
    apps: { 730: true, 570: true, 440: true, 252490: true },
    // TODO(verify): Skinport's standard seller fee (8% assumed).
    defaultFee: 0.08, access: 'Public API, no key', coverage: 'CS2, Dota 2, TF2 and Rust floors plus sales history',
  },
  {
    id: 'waxpeer', name: 'Waxpeer', short: 'Waxpeer', kind: 'cash', native: 'USD', role: 'floor', defaultOn: true,
    apps: { 730: 'csgo', 570: 'dota2', 252490: 'rust', 440: 'tf2' },
    // TODO(verify): Waxpeer's seller fee (6% assumed).
    defaultFee: 0.06, access: 'Public price list, no key', coverage: 'CS2, Dota 2, Rust and TF2 floors, in USD',
  },
  {
    id: 'marketcsgo', name: 'Market.CSGO', short: 'Market.CSGO', kind: 'cash', native: 'USD', role: 'floor', defaultOn: true,
    apps: { 730: 'market.csgo.com', 570: 'market.dota2.net', 440: 'tf2.tm', 252490: 'rust.tm' },
    // TODO(verify): Market.CSGO's seller fee (5% assumed).
    defaultFee: 0.05, access: 'Public price list, no key', coverage: 'CS2, Dota 2, TF2 and Rust floors via its sister sites, in USD',
  },
  {
    id: 'lisskins', name: 'Lis-skins', short: 'Lis-skins', kind: 'cash', native: 'USD', role: 'floor', defaultOn: true,
    apps: { 730: 'csgo', 570: 'dota2', 252490: 'rust' },
    // TODO(verify): Lis-skins' seller fee (5% assumed).
    defaultFee: 0.05, access: 'Public price export, no key', coverage: 'CS2, Dota 2 and Rust floors, in USD (no TF2 export)',
  },
  {
    id: 'csfloat', name: 'CSFloat', short: 'CSFloat', kind: 'cash', native: 'USD', role: 'avg', defaultOn: false, experimental: true,
    apps: { 730: true },
    access: 'Undocumented website endpoint, no key',
    coverage: 'CS2 daily sales averages for your most valuable items; includes float and sticker premiums',
  },
]);

export const FLOOR_VENUES = Object.freeze(VENUES.filter((v) => v.role === 'floor').map((v) => v.id));
export const THIRD_PARTY = Object.freeze(['waxpeer', 'marketcsgo', 'lisskins']);
export const LOWEST_SOURCES = Object.freeze(['steam', 'best', 'skinport', 'waxpeer', 'marketcsgo', 'lisskins']);

export function venueById(id) {
  return VENUES.find((v) => v.id === id) ?? null;
}

export function venueName(id) {
  return venueById(id)?.name ?? id;
}

export function defaultVenueSettings() {
  const enabled = {};
  const fees = {};
  for (const v of VENUES) {
    if (v.always) continue;
    enabled[v.id] = Boolean(v.defaultOn);
    if (v.defaultFee != null) fees[v.id] = v.defaultFee;
  }
  return { enabled, fees };
}

export function venueSupports(id, appid) {
  const v = venueById(id);
  if (!v) return false;
  if (!v.apps) return true;
  return Boolean(v.apps[appid]);
}

export function isEnabled(id, ctx) {
  if (id === 'steam') return true;
  const enabled = ctx?.enabled ?? defaultVenueSettings().enabled;
  return Boolean(enabled[id]);
}

export function feeOf(id, ctx) {
  return ctx?.fees?.[id] ?? venueById(id)?.defaultFee ?? 0;
}

// Converts minor units between currencies with a USD-based rate table.
// Returns { value, rate, date, source } or null when a rate is missing.
export function convert(amount, from, to, fx) {
  if (!Number.isFinite(amount)) return null;
  if (from === to) return { value: amount, rate: 1, date: null, source: null };
  const rates = fx?.rates;
  const rFrom = from === fx?.base ? 1 : rates?.[from];
  const rTo = to === fx?.base ? 1 : rates?.[to];
  if (!(rFrom > 0) || !(rTo > 0)) return null;
  const rate = rTo / rFrom;
  return { value: Math.round(amount * rate), rate, date: fx.date ?? null, source: fx.source ?? null };
}

// Net after a venue's seller fee. Steam uses Valve's exact algorithm.
export function venueNet(id, floor, ctx) {
  if (!(floor > 0)) return null;
  if (id === 'steam') return sellerReceives(floor);
  return Math.floor(floor * (1 - feeOf(id, ctx)));
}

export function venueUrl(id, stack, quotes) {
  const name = stack?.marketHashName;
  if (!name) return null;
  const q = encodeURIComponent(name);
  switch (id) {
    case 'steam':
      return `https://steamcommunity.com/market/listings/${stack.appid}/${q}`;
    case 'skinport':
      return quotes?.skinport?.itemPage ?? `https://skinport.com/market?search=${q}`;
    case 'waxpeer':
      return `https://waxpeer.com/?game=${venueById('waxpeer').apps[stack.appid] ?? 'csgo'}&search=${q}`;
    case 'marketcsgo':
      return `https://${venueById('marketcsgo').apps[stack.appid] ?? 'market.csgo.com'}/en/?search=${q}`;
    case 'lisskins':
      return quotes?.venues?.lisskins?.url ?? `https://lis-skins.com/market/csgo/?query=${q}`;
    case 'csfloat':
      return `https://csfloat.com/search?market_hash_name=${q}`;
    default:
      return null;
  }
}

// One row per enabled venue that lists the item, in the scan currency.
// ctx: { currency, fx, enabled, fees }
export function venueRows(stack, ctx = {}) {
  const quotes = stack?.quotes ?? {};
  const currency = ctx.currency ?? 'USD';
  const rows = [];

  if (quotes.steam?.lowest > 0) {
    rows.push({
      id: 'steam', name: venueName('steam'), kind: 'wallet', floor: quotes.steam.lowest,
      listings: quotes.book?.sellOrders ?? null, net: venueNet('steam', quotes.steam.lowest, ctx), fee: null, converted: null,
    });
  }
  if (isEnabled('skinport', ctx) && quotes.skinport?.min > 0) {
    rows.push({
      id: 'skinport', name: venueName('skinport'), kind: 'cash', floor: quotes.skinport.min,
      listings: quotes.skinport.quantity ?? null, net: venueNet('skinport', quotes.skinport.min, ctx), fee: feeOf('skinport', ctx), converted: null,
    });
  }
  for (const id of THIRD_PARTY) {
    const q = quotes.venues?.[id];
    if (!isEnabled(id, ctx) || !(q?.min > 0)) continue;
    const conv = convert(q.min, q.currency ?? 'USD', currency, ctx.fx);
    rows.push({
      id, name: venueName(id), kind: 'cash',
      floor: conv?.value ?? null,
      native: { value: q.min, currency: q.currency ?? 'USD' },
      listings: q.count ?? null,
      net: conv ? venueNet(id, conv.value, ctx) : null,
      fee: feeOf(id, ctx),
      converted: conv && conv.rate !== 1 ? { from: q.currency ?? 'USD', rate: conv.rate, date: conv.date, source: conv.source } : null,
      missingRate: !conv,
    });
  }
  for (const r of rows) r.url = venueUrl(r.id, stack, quotes);
  return markBest(rows);
}

// Cheapest place to buy (lowest floor) and best place to sell (highest net).
export function markBest(rows) {
  const priced = rows.filter((r) => r.floor > 0);
  const cheapest = priced.reduce((a, r) => (!a || r.floor < a.floor ? r : a), null);
  const bestSell = rows.filter((r) => r.net > 0).reduce((a, r) => (!a || r.net > a.net ? r : a), null);
  const bestCash = rows.filter((r) => r.kind === 'cash' && r.net > 0).reduce((a, r) => (!a || r.net > a.net ? r : a), null);
  for (const r of rows) {
    r.cheapest = r === cheapest;
    r.bestSell = r === bestSell;
    r.bestCash = r === bestCash;
  }
  return rows;
}
