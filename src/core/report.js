// Applies the pricing contract to every stack and aggregates the result.
// Pure, so the app can re-price instantly when the source or window changes.

import { resolvePrices, lowestSourceOf, avgSourceOf } from './pricing.js';
import { aggregate, daysToSell, skinportNet, DEFAULT_CAPTURE_RATE, DEFAULT_SKINPORT_FEE } from './aggregate.js';
import { isLocked } from './instant.js';

const EMPTY_PRICES = { lowest: null, avg: null, dailyVolume: null, instant: null, venues: [] };

export function priceStacks(stacks, settings = {}) {
  const now = settings.now ?? Date.now();
  const capture = settings.captureRate ?? DEFAULT_CAPTURE_RATE;
  const spFee = settings.fees?.skinport ?? settings.skinportFee ?? DEFAULT_SKINPORT_FEE;
  return stacks.map((s) => {
    const prices = s.marketable ? resolvePrices(s.quotes ?? {}, { ...settings, now }, s) : EMPTY_PRICES;
    return {
      ...s,
      prices,
      derived: {
        locked: isLocked(s, now),
        skewed: Boolean(prices.avg?.skewed),
        daysToSell: s.marketable ? daysToSell(s.quantity ?? 1, prices.dailyVolume, capture) : null,
        skinportNet: s.marketable ? skinportNet(s.quotes?.skinport?.min, spFee) : null,
      },
    };
  });
}

export function buildReport(stacks, settings = {}, currency = null) {
  const now = settings.now ?? Date.now();
  const priced = priceStacks(stacks, { ...settings, now });
  const summary = aggregate(priced, {
    now,
    currency,
    captureRate: settings.captureRate ?? DEFAULT_CAPTURE_RATE,
    skinportFee: settings.fees?.skinport ?? settings.skinportFee ?? DEFAULT_SKINPORT_FEE,
  });
  return {
    stacks: priced,
    summary,
    source: settings.source ?? 'both',
    lowestSource: lowestSourceOf(settings),
    avgSource: avgSourceOf(settings),
    window: settings.window ?? '7d',
    avgMode: settings.avgMode ?? 'mean',
  };
}

// The compact record stored in local history after each scan.
export function historyEntry(result) {
  const { summary } = result;
  return {
    at: result.scannedAt,
    currency: result.currency,
    source: result.source,
    window: result.window,
    lowest: summary.totals.lowest.value,
    avg: summary.totals.avg.value,
    net: summary.totals.net.value,
    items: summary.counts.items,
    unpriced: summary.counts.unpriced,
    perGame: summary.perGame.map((g) => ({ appid: g.appid, lowest: g.lowest, avg: g.avg })),
    demo: Boolean(result.demo),
  };
}

// Delta between the latest entry and the one before it, in the same currency.
export function historyDelta(entries) {
  const list = (entries ?? []).filter((e) => e && Number.isFinite(e.lowest));
  if (list.length < 2) return null;
  const last = list[list.length - 1];
  const prev = [...list.slice(0, -1)].reverse().find((e) => e.currency === last.currency);
  if (!prev) return null;
  const abs = last.lowest - prev.lowest;
  return {
    abs,
    rel: prev.lowest > 0 ? abs / prev.lowest : null,
    avgAbs: Number.isFinite(last.avg) && Number.isFinite(prev.avg) ? last.avg - prev.avg : null,
    since: prev.at,
  };
}

// Market events drawn on the history chart.
// TODO(verify): exact day of the July 2025 trade-protection change.
export const MARKET_EVENTS = Object.freeze([
  { at: Date.UTC(2025, 6, 16), label: 'CS2 trade protection', detail: 'Received CS2 items are trade-protected for 7 days and trades can be reversed.' },
  { at: Date.UTC(2025, 9, 22), label: 'CS2 trade-up update', detail: 'Covert items can be traded up into knives and gloves; knife and glove prices fell sharply.' },
]);
