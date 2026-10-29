// Parsers for third-party price feeds. All return plain objects keyed by
// market_hash_name with integer minor units (USD cents), so they can be
// cached as JSON and looked up locally.
// Response shapes verified live on 2026-10-29.

const cents = (v) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};

// Waxpeer: { success, items: [{ name, count, min }] }, min in 1/1000 USD.
export function parseWaxpeer(json) {
  const out = {};
  for (const it of Array.isArray(json?.items) ? json.items : []) {
    if (!it?.name || !(it.min > 0)) continue;
    out[it.name] = { min: Math.round(it.min / 10), count: Number(it.count) || 0 };
  }
  return out;
}

// Market.CSGO (and market.dota2.net, tf2.tm, rust.tm):
// { success, time, currency, items: [{ market_hash_name, volume, price }] }, price as a string in major units.
export function parseMarketCsgo(json) {
  const out = {};
  if (json?.currency && json.currency !== 'USD') return out;
  for (const it of Array.isArray(json?.items) ? json.items : []) {
    const min = cents(it?.price);
    if (!it?.market_hash_name || min == null) continue;
    const prev = out[it.market_hash_name];
    if (!prev || min < prev.min) out[it.market_hash_name] = { min, count: Number(it.volume) || 0 };
  }
  return out;
}

// Lis-skins: [{ name, price, unlocked_price, url, count }], prices in USD major units.
// `price` is the cheapest listing; `unlocked_price` the cheapest one that can be traded right away.
export function parseLisSkins(json) {
  const out = {};
  for (const it of Array.isArray(json) ? json : []) {
    const min = cents(it?.price);
    if (!it?.name || min == null) continue;
    out[it.name] = { min, count: Number(it.count) || 0, unlocked: cents(it.unlocked_price), url: typeof it.url === 'string' ? it.url : null };
  }
  return out;
}

const WINDOW_DAYS = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };

// CSFloat history graph: [{ count, day, avg_price }], one row per day, avg_price in USD cents.
// Returns per-window stats shaped like Skinport sales windows. Daily averages
// are all we get, so median and max are over days (weighted by sales count).
export function parseCsfloatGraph(json, now = Date.now()) {
  const rows = (Array.isArray(json) ? json : [])
    .map((d) => ({ t: Date.parse(d?.day), count: Number(d?.count) || 0, avg: Number(d?.avg_price) }))
    .filter((d) => Number.isFinite(d.t) && d.count > 0 && Number.isFinite(d.avg) && d.avg > 0);
  const sales = {};
  for (const [w, days] of Object.entries(WINDOW_DAYS)) {
    const from = now - days * 864e5 - 864e5 / 2;
    const inWin = rows.filter((d) => d.t >= from && d.t <= now + 864e5);
    const volume = inWin.reduce((a, d) => a + d.count, 0);
    if (!volume) {
      sales[w] = { avg: null, median: null, min: null, max: null, volume: 0 };
      continue;
    }
    const avg = Math.round(inWin.reduce((a, d) => a + d.avg * d.count, 0) / volume);
    const sorted = inWin.slice().sort((a, b) => a.avg - b.avg);
    let acc = 0;
    let median = sorted[sorted.length - 1].avg;
    for (const d of sorted) {
      acc += d.count;
      if (acc >= volume / 2) {
        median = d.avg;
        break;
      }
    }
    sales[w] = { avg, median: Math.round(median), min: Math.round(sorted[0].avg), max: Math.round(sorted[sorted.length - 1].avg), volume };
  }
  return { sales, currency: 'USD', daily: true };
}

// open.er-api.com: { result, base_code, time_last_update_unix, rates: { EUR: 0.89, ... } }
export function parseFx(json) {
  if (json?.result !== 'success' || !json.rates || typeof json.rates !== 'object') return null;
  const base = json.base_code ?? 'USD';
  const rates = {};
  for (const [k, v] of Object.entries(json.rates)) if (Number.isFinite(v) && v > 0) rates[k] = v;
  if (!rates[base]) rates[base] = 1;
  return {
    base,
    rates,
    date: Number.isFinite(json.time_last_update_unix) ? json.time_last_update_unix * 1000 : null,
    source: 'open.er-api.com',
  };
}
