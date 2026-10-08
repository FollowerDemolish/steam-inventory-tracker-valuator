// Shapes Skinport's public API responses into the quote format pricing.js reads.

export const WINDOW_KEYS = Object.freeze({ '24h': 'last_24_hours', '7d': 'last_7_days', '30d': 'last_30_days', '90d': 'last_90_days' });
const toCents = (v) => (Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null);

function groupByName(list) {
  const map = new Map();
  for (const row of Array.isArray(list) ? list : []) {
    if (!row?.market_hash_name) continue;
    const arr = map.get(row.market_hash_name);
    if (arr) arr.push(row);
    else map.set(row.market_hash_name, [row]);
  }
  return map;
}

// Skinport can return several rows for one market_hash_name, one per
// `version` (for example the phases of a Doppler knife). Steam's name does
// not say which phase an item is, so when there is no versionless row the
// versions are blended: the lowest floor across them, and a volume-weighted
// sales average. `versions` records how many rows were blended.
function pickItemRow(rows) {
  const plain = rows.find((r) => r.version == null);
  if (plain || rows.length === 1) {
    const r = plain ?? rows[0];
    return { min: toCents(r.min_price), suggested: toCents(r.suggested_price), quantity: r.quantity ?? null, itemPage: r.item_page ?? null, versions: 1 };
  }
  const mins = rows.map((r) => toCents(r.min_price)).filter((v) => v != null);
  return {
    min: mins.length ? Math.min(...mins) : null,
    suggested: null,
    quantity: rows.reduce((a, r) => a + (r.quantity ?? 0), 0),
    itemPage: rows[0].item_page ?? null,
    versions: rows.length,
  };
}

function blendWindow(rows, key) {
  let sum = 0;
  let volume = 0;
  let min = null;
  let max = null;
  for (const r of rows) {
    const b = r[key];
    if (!b || !(b.volume > 0) || !Number.isFinite(b.avg)) continue;
    sum += b.avg * b.volume;
    volume += b.volume;
    if (Number.isFinite(b.min)) min = min == null ? b.min : Math.min(min, b.min);
    if (Number.isFinite(b.max)) max = max == null ? b.max : Math.max(max, b.max);
  }
  return {
    avg: volume ? toCents(sum / volume) : null,
    median: null,
    min: toCents(min),
    max: toCents(max),
    volume,
  };
}

function pickSalesRow(rows) {
  const plain = rows.find((r) => r.version == null);
  const sales = {};
  if (plain || rows.length === 1) {
    const r = plain ?? rows[0];
    for (const [w, key] of Object.entries(WINDOW_KEYS)) {
      const b = r[key];
      sales[w] = b
        ? { avg: toCents(b.avg), median: toCents(b.median), min: toCents(b.min), max: toCents(b.max), volume: b.volume ?? 0 }
        : { avg: null, median: null, min: null, max: null, volume: 0 };
    }
    return { sales, itemPage: r.item_page ?? null, versions: 1 };
  }
  for (const [w, key] of Object.entries(WINDOW_KEYS)) sales[w] = blendWindow(rows, key);
  return { sales, itemPage: rows[0].item_page ?? null, versions: rows.length };
}

export function indexSkinportItems(list) {
  const out = new Map();
  for (const [name, rows] of groupByName(list)) out.set(name, pickItemRow(rows));
  return out;
}

export function indexSkinportSales(list) {
  const out = new Map();
  for (const [name, rows] of groupByName(list)) out.set(name, pickSalesRow(rows));
  return out;
}

// Combines both indexes for one item into a Skinport quote, or null.
export function skinportQuote(name, itemsIndex, salesIndex) {
  const it = itemsIndex?.get(name) ?? null;
  const sa = salesIndex?.get(name) ?? null;
  if (!it && !sa) return null;
  return {
    min: it?.min ?? null,
    suggested: it?.suggested ?? null,
    quantity: it?.quantity ?? null,
    sales: sa?.sales ?? null,
    itemPage: it?.itemPage ?? sa?.itemPage ?? null,
    versions: Math.max(it?.versions ?? 1, sa?.versions ?? 1),
  };
}
