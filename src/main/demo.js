// The offline demo: a fictional profile whose items, icons and prices are
// real public market data frozen on the snapshot date.

import fs from 'node:fs';
import path from 'node:path';
import { DEMO_RATES } from '../core/currencies.js';

const DEMO_FILE = path.join(import.meta.dirname, 'demo', 'demo.json');
let cached = null;

export function loadDemo() {
  cached ??= JSON.parse(fs.readFileSync(DEMO_FILE, 'utf8'));
  return cached;
}

export function demoRate(code) {
  return DEMO_RATES[code] ?? 1;
}

// Converts the USD snapshot to another currency at a fixed demo rate.
// Skinport rows are in major units, Steam quotes in cents.
export function convertDemoQuotes(quotes, code) {
  const rate = demoRate(code);
  const c = (v) => (Number.isFinite(v) ? Math.round(v * rate) : v);
  const m = (v) => (Number.isFinite(v) ? Math.round(v * rate * 100) / 100 : v);
  const out = {};
  for (const [name, q] of Object.entries(quotes)) {
    out[name] = {
      steam: q.steam ? { ...q.steam, lowest: c(q.steam.lowest), median24h: c(q.steam.median24h) } : undefined,
      book: q.book
        ? { ...q.book, currency: code, bid: c(q.book.bid), ask: c(q.book.ask), ladder: q.book.ladder.map(([p, n]) => [c(p), n]) }
        : undefined,
      skinport: q.skinport
        ? {
            items: q.skinport.items.map((r) => ({ ...r, min_price: m(r.min_price), suggested_price: m(r.suggested_price) })),
            sales: q.skinport.sales.map((r) => {
              const conv = (b) => (b ? { ...b, min: m(b.min), max: m(b.max), avg: m(b.avg), median: m(b.median) } : b);
              return { ...r, last_24_hours: conv(r.last_24_hours), last_7_days: conv(r.last_7_days), last_30_days: conv(r.last_30_days), last_90_days: conv(r.last_90_days) };
            }),
          }
        : undefined,
    };
  }
  return out;
}

// Seeds a believable value history for the demo profile, ending just before
// `latest`. The curve dips after the July 2025 trade-protection change and
// falls hard after the October 2025 trade-up update, as knife-heavy
// inventories did, then slowly recovers.
export function seedDemoHistory(latest) {
  const start = Date.UTC(2025, 4, 6);
  const end = latest.at - 5 * 864e5;
  const tp = Date.UTC(2025, 6, 16);
  const tu = Date.UTC(2025, 9, 22);
  const curve = (t) => {
    if (t < tp) return 0.9 + ((t - start) / (tp - start)) * 0.04;
    if (t < tp + 12 * 864e5) return 0.89;
    if (t < tu) return 0.9 + ((t - tp) / (tu - tp)) * 0.18;
    const k = (t - tu) / Math.max(1, end - tu);
    return 0.8 + 0.2 * ((1 - Math.exp(-2.4 * k)) / (1 - Math.exp(-2.4)));
  };
  const stamps = [];
  for (let t = start; t < end - 8 * 864e5; t += 17 * 864e5) stamps.push(t);
  stamps.push(tp - 2 * 864e5, tu - 2 * 864e5, tu + 3 * 864e5, end);
  const unique = [...new Set(stamps)].sort((a, b) => a - b).filter((t, i, a) => i === 0 || t - a[i - 1] > 2 * 864e5);
  return unique.map((at, i) => {
    const noise = i === unique.length - 1 ? -0.016 : 0.011 * Math.sin(i * 2.3) + 0.007 * Math.sin(i * 0.9 + 1);
    const f = curve(at) + noise;
    const g = f - 0.01 + 0.006 * Math.sin(i * 1.7);
    return {
      ...latest,
      at: at + (i % 4) * 3.6e6,
      lowest: Math.round(latest.lowest * f),
      avg: Math.round(latest.avg * g),
      net: Math.round(latest.net * f),
      perGame: latest.perGame.map((pg) => ({ ...pg, lowest: Math.round(pg.lowest * f), avg: Math.round(pg.avg * g) })),
      demo: true,
    };
  });
}

// Keeps the demo's trade holds in the future: holds are stored relative to
// the snapshot date and shifted to start from today.
export function shiftDemoHold(iso, snapshot, now = Date.now()) {
  if (!iso) return iso;
  const offset = Date.parse(iso) - Date.parse(snapshot);
  return new Date(now + offset).toISOString();
}
