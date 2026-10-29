// Totals, per-game breakdown, top items, exit values, trade locks and honesty
// warnings for a priced inventory. Every stack is expected to carry `prices`
// from resolvePrices().

import { sellerReceives } from './fees.js';
import { isLocked } from './instant.js';

export const SPREAD_THRESHOLD = 0.5;
export const DEFAULT_CAPTURE_RATE = 0.1;
// TODO(verify): Skinport's seller fee. Their site has advertised 8% for
// standard sales; check https://skinport.com before relying on it.
export const DEFAULT_SKINPORT_FEE = 0.08;

// Relative disagreement between floor and average, measured against the average.
export function spreadOf(lowest, avg) {
  if (!(lowest > 0) || !(avg > 0)) return null;
  return Math.abs(lowest - avg) / avg;
}

// Days to sell a stack if you capture `captureRate` of daily volume.
export function daysToSell(quantity, dailyVolume, captureRate = DEFAULT_CAPTURE_RATE) {
  if (!dailyVolume || !(dailyVolume.value > 0) || !(captureRate > 0)) return null;
  return quantity / (dailyVolume.value * captureRate);
}

export function skinportNet(min, fee = DEFAULT_SKINPORT_FEE) {
  if (!(min > 0)) return null;
  return Math.floor(min * (1 - fee));
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function dayKey(iso) {
  return String(iso).slice(0, 10);
}

export function aggregate(stacks, {
  fee = sellerReceives,
  spreadThreshold = SPREAD_THRESHOLD,
  topN = 8,
  now = Date.now(),
  captureRate = DEFAULT_CAPTURE_RATE,
  skinportFee = DEFAULT_SKINPORT_FEE,
  currency = null,
} = {}) {
  const totals = {
    lowest: { value: 0, priced: 0, of: 0 },
    avg: { value: 0, priced: 0, of: 0 },
    net: { value: 0, priced: 0, of: 0 },
    netSkinport: { value: 0, priced: 0, of: 0, fee: skinportFee },
    instant: { value: 0, priced: 0, of: 0, gross: 0, partial: 0, currency, otherCurrency: null, otherValue: 0 },
  };
  const counts = { items: 0, stacks: stacks.length, marketable: 0, nonMarketable: 0, unpriced: 0, tradeHold: 0, skewed: 0, locked: 0 };
  const games = new Map();
  const unpriced = [];
  const nonMarketable = [];
  const illiquid = [];
  const spread = [];
  const skewed = [];
  const avgFallbacks = [];
  const lowestFallbacks = [];
  const mix = { lowest: {}, avg: {} };
  const lines = [];
  const lockGroups = new Map();
  const liquidity = { valued: 0, sellable7d: 0, unknownVolume: 0 };
  let premiumSteam = 0;
  let premiumSkinport = 0;
  const venueAcc = new Map();
  let valued = 0;
  const bestCash = { value: 0, priced: 0, byVenue: {} };

  for (const s of stacks) {
    const qty = s.quantity ?? 1;
    counts.items += qty;
    const locked = isLocked(s, now);
    if (s.tradeHoldUntil) counts.tradeHold += qty;

    let g = games.get(s.appid);
    if (!g) {
      g = { appid: s.appid, items: 0, stacks: 0, lowest: 0, avg: 0, net: 0, unpriced: 0, nonMarketable: 0 };
      games.set(s.appid, g);
    }
    g.items += qty;
    g.stacks += 1;

    if (!s.marketable) {
      counts.nonMarketable += qty;
      g.nonMarketable += qty;
      nonMarketable.push(s.key);
      continue;
    }

    counts.marketable += qty;
    totals.lowest.of += 1;
    totals.avg.of += 1;
    totals.net.of += 1;
    totals.netSkinport.of += 1;

    const low = s.prices?.lowest ?? null;
    const avg = s.prices?.avg ?? null;
    const inst = s.prices?.instant ?? null;

    if (!low && !avg) {
      counts.unpriced += qty;
      g.unpriced += qty;
      unpriced.push(s.key);
      continue;
    }

    const line = { key: s.key, quantity: qty, lineLowest: null, lineAvg: null, lineNet: null };
    let steamNetLine = null;

    if (low) {
      line.lineLowest = low.value * qty;
      line.lineNet = fee(low.value) * qty;
      totals.lowest.value += line.lineLowest;
      totals.lowest.priced += 1;
      totals.net.value += line.lineNet;
      totals.net.priced += 1;
      g.lowest += line.lineLowest;
      g.net += line.lineNet;
      steamNetLine = low.source === 'steam' ? line.lineNet : null;
      const tag = low.fallback ? `${low.source}-fallback` : low.source;
      mix.lowest[tag] = (mix.lowest[tag] ?? 0) + 1;
      if (low.fallback) lowestFallbacks.push(s.key);
    }
    if (avg) {
      line.lineAvg = avg.value * qty;
      totals.avg.value += line.lineAvg;
      totals.avg.priced += 1;
      g.avg += line.lineAvg;
      const tag = `${avg.source}-${avg.metric}`;
      mix.avg[tag] = (mix.avg[tag] ?? 0) + 1;
      if (avg.fallback) avgFallbacks.push(s.key);
      if (avg.skewed) {
        skewed.push(s.key);
        counts.skewed += qty;
      }
    }

    // Per-venue totals over the items that have a LOWEST (the valued set),
    // so venues are compared on the same items the totals use.
    if (low) {
      valued += 1;
      let best = null;
      for (const r of s.prices?.venues ?? []) {
        if (!(r.floor > 0)) continue;
        let acc = venueAcc.get(r.id);
        if (!acc) {
          acc = { id: r.id, name: r.name, kind: r.kind, fee: r.fee ?? null, total: 0, net: 0, priced: 0, items: 0, converted: null };
          venueAcc.set(r.id, acc);
        }
        acc.total += r.floor * qty;
        acc.net += (r.net ?? 0) * qty;
        acc.priced += 1;
        acc.items += qty;
        if (r.converted) acc.converted = r.converted;
        if (r.kind === 'cash' && r.net > 0 && (!best || r.net > best.net)) best = r;
      }
      if (best) {
        bestCash.value += best.net * qty;
        bestCash.priced += 1;
        bestCash.byVenue[best.id] = (bestCash.byVenue[best.id] ?? 0) + 1;
      }
    }

    // Net if sold on Skinport (cash): Skinport floor minus the seller fee.
    const spNetUnit = skinportNet(s.quotes?.skinport?.min, skinportFee);
    if (spNetUnit != null) {
      totals.netSkinport.value += spNetUnit * qty;
      totals.netSkinport.priced += 1;
      if (steamNetLine != null) {
        premiumSteam += steamNetLine;
        premiumSkinport += spNetUnit * qty;
      }
    }

    // Instant (net) from buy orders; locked stacks never count.
    if (inst && !locked && inst.value != null) {
      totals.instant.of += 1;
      if (!currency || inst.currency === currency) {
        totals.instant.value += inst.value;
        totals.instant.gross += inst.gross;
        totals.instant.priced += 1;
        if (inst.partial) totals.instant.partial += 1;
      } else {
        totals.instant.otherCurrency = inst.currency;
        totals.instant.otherValue += inst.value;
      }
    }

    // Liquidity: days to sell and the share of value sellable within 7 days.
    const value = line.lineLowest ?? line.lineAvg ?? 0;
    const daily = s.prices?.dailyVolume;
    const days = daysToSell(qty, daily, captureRate);
    line.daysToSell = days;
    liquidity.valued += value;
    if (days == null) liquidity.unknownVolume += 1;
    else liquidity.sellable7d += value * Math.min(1, 7 / days);
    if (daily && qty > daily.value) illiquid.push(s.key);

    // Trade locks, grouped by the day they lift.
    if (locked) {
      counts.locked += qty;
      const k = dayKey(s.tradeHoldUntil);
      const grp = lockGroups.get(k) ?? { until: s.tradeHoldUntil, value: 0, count: 0, keys: [] };
      grp.value += value;
      grp.count += qty;
      grp.keys.push(s.key);
      lockGroups.set(k, grp);
    }

    const sp = spreadOf(low?.value, avg?.value);
    if (sp != null && sp > spreadThreshold) spread.push(s.key);

    lines.push(line);
  }

  const basis = totals.lowest.value || totals.avg.value || 1;
  const perGame = [...games.values()]
    .map((g) => ({ ...g, share: (g.lowest || g.avg) / basis }))
    .sort((a, b) => (b.lowest || b.avg) - (a.lowest || a.avg));

  const top = lines
    .slice()
    .sort((a, b) => (b.lineLowest ?? b.lineAvg ?? 0) - (a.lineLowest ?? a.lineAvg ?? 0))
    .slice(0, topN);

  const locks = [...lockGroups.values()].sort((a, b) => a.until.localeCompare(b.until));
  const lockedValue = locks.reduce((a, l) => a + l.value, 0);

  const exit = {
    sellable7d: liquidity.valued > 0 ? liquidity.sellable7d / liquidity.valued : null,
    unknownVolume: liquidity.unknownVolume,
    captureRate,
    walletPremium: premiumSkinport > 0 ? premiumSteam / premiumSkinport - 1 : null,
  };

  const warnings = [];
  if (unpriced.length) {
    warnings.push({
      kind: 'unpriced', severity: 'warn', keys: unpriced,
      title: `${plural(unpriced.length, 'item')} without a price`,
      detail: 'The sources in use returned no floor or sales average. They count as unpriced, never as zero. The item sheet shows any other marketplace that lists them.',
    });
  }
  if (skewed.length) {
    warnings.push({
      kind: 'skewed', severity: 'warn', keys: skewed,
      title: `${plural(skewed.length, 'item')} with a skewed average`,
      detail: 'A few unusual sales pull the mean away from the median (by more than 25%, or a sale above 5x the median). Compare AVG with the median shown beside it.',
    });
  }
  if (spread.length) {
    warnings.push({
      kind: 'spread', severity: 'warn', keys: spread,
      title: `${plural(spread.length, 'item')} with a wide spread`,
      detail: `The floor and the sales average differ by more than ${Math.round(spreadThreshold * 100)}%. Treat these values with care.`,
    });
  }
  if (illiquid.length) {
    warnings.push({
      kind: 'liquidity', severity: 'warn', keys: illiquid,
      title: `${plural(illiquid.length, 'item')} with thin trading`,
      detail: 'You hold more of these than the market sells in a day, so selling them quickly could push the price down.',
    });
  }
  if (locks.length) {
    warnings.push({
      kind: 'locked', severity: 'info', keys: locks.flatMap((l) => l.keys),
      title: `${plural(counts.locked, 'item')} on a trade hold`,
      detail: 'Locked items still count toward LOWEST and AVG, but not toward Instant: they cannot be sold until the hold lifts.',
    });
  }
  if (avgFallbacks.length) {
    warnings.push({
      kind: 'avg-fallback', severity: 'info', keys: avgFallbacks,
      title: `AVG falls back for ${plural(avgFallbacks.length, 'item')}`,
      detail: 'These have no sales average for the chosen window, so a labelled substitute (usually the Steam 24 h median) is used.',
    });
  }
  if (lowestFallbacks.length) {
    warnings.push({
      kind: 'lowest-fallback', severity: 'info', keys: lowestFallbacks,
      title: `LOWEST falls back for ${plural(lowestFallbacks.length, 'item')}`,
      detail: 'The preferred marketplace had no floor, so the other marketplace floor is shown and labelled.',
    });
  }
  if (nonMarketable.length) {
    warnings.push({
      kind: 'non-marketable', severity: 'info', keys: nonMarketable,
      title: `${plural(counts.nonMarketable, 'item')} that can't be sold on the Market`,
      detail: 'Medals, coins and other account-bound items are listed separately and left out of every total.',
    });
  }

  const venues = [...venueAcc.values()]
    .map((v) => ({ ...v, of: valued }))
    .sort((a, b) => b.net - a.net);
  const cashVenues = venues.filter((v) => v.kind === 'cash');
  const verdict = {
    cash: cashVenues[0]?.id ?? null,
    wallet: venues.find((v) => v.kind === 'wallet')?.id ?? null,
    bestCash: { ...bestCash, of: valued },
  };

  return { totals, counts, perGame, top, warnings, mix, exit, locks, lockedValue, venues, verdict };
}
