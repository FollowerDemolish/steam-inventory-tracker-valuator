// Runs one scan: profile, inventories, Skinport catalogs, Steam floors,
// then pricing and aggregation. Progress is reported through `emit`.

import { parseProfileInput } from '../core/profile-input.js';
import { joinInventory, groupItems } from '../core/inventory.js';
import { GAMES, gameById, gameName, skinportSupports } from '../core/games.js';
import { currencyByCode, DEMO_RATES } from '../core/currencies.js';
import { THIRD_PARTY, venueName, venueSupports } from '../core/venues.js';
import { parseWaxpeer, parseMarketCsgo, parseLisSkins, parseCsfloatGraph } from '../core/venue-parsers.js';
import { indexSkinportItems, indexSkinportSales, skinportQuote } from '../core/skinport-data.js';
import { buildReport } from '../core/report.js';
import { RateLimitError } from '../core/backoff.js';
import { PrivateInventoryError, ProfileError } from './steam.js';
import { loadDemo, convertDemoQuotes, shiftDemoHold } from './demo.js';

export class ScanError extends Error {
  constructor(message, { kind = 'error', retryInMs = null } = {}) {
    super(message);
    this.name = 'ScanError';
    this.kind = kind;
    this.retryInMs = retryInMs;
  }
}

function minutes(ms) {
  return Math.max(1, Math.ceil(ms / 60000));
}

function contextsFor(settings) {
  const list = [];
  for (const id of settings.games) {
    const g = gameById(id);
    if (g) list.push({ appid: g.appid, contextid: g.contextid });
  }
  for (const c of settings.customContexts ?? []) {
    if (!list.some((x) => x.appid === c.appid && x.contextid === c.contextid)) list.push(c);
  }
  return list;
}

// Order Steam lookups by what the item is likely worth, most valuable first.
function lookupOrder(stacks) {
  const byName = new Map();
  for (const s of stacks) {
    if (!s.marketable || !s.marketHashName) continue;
    const k = `${s.appid}|${s.marketHashName}`;
    const est = (s.quotes?.skinport?.min ?? s.quotes?.skinport?.sales?.['7d']?.avg ?? 0) * s.quantity;
    const prev = byName.get(k);
    if (prev) prev.est += est;
    else byName.set(k, { appid: s.appid, name: s.marketHashName, est });
  }
  return [...byName.values()].sort((a, b) => b.est - a.est);
}

function attachQuotes(stacks, key, quote, field = 'steam') {
  for (const s of stacks) {
    if (`${s.appid}|${s.marketHashName}` !== key) continue;
    s.quotes[field] = field === 'steam' ? { ...(s.quotes.steam ?? {}), ...quote } : quote;
  }
}

export async function runScan({ input, demo = false, settings, secrets, deps, emit = () => {}, signal, control = {} }) {
  const currency = currencyByCode(settings.currency);
  const notices = [];
  const scannedAt = Date.now();

  if (demo) return runDemo({ settings, currency, emit, scannedAt });

  // 1. Profile
  const ref = parseProfileInput(input);
  if (!ref.ok) throw new ScanError(ref.error, { kind: 'input' });
  emit({ stage: 'profile', label: 'Finding the profile' });
  let profile;
  try {
    profile = await deps.steam.profile(ref, { apiKey: secrets.apiKey, signal });
  } catch (err) {
    if (err instanceof ProfileError) throw new ScanError(err.message, { kind: 'profile' });
    if (err instanceof RateLimitError) throw new ScanError(err.message, { kind: 'rate-limit', retryInMs: err.retryInMs });
    if (signal?.aborted) throw new ScanError('Scan cancelled.', { kind: 'cancelled' });
    throw new ScanError(`Could not reach Steam (${err.message}). Check your connection or try the demo.`, { kind: 'network' });
  }
  if (profile.privacy && profile.privacy !== 'public') {
    notices.push({ kind: 'privacy', severity: 'warn', text: `This profile is ${profile.privacy === 'friendsonly' ? 'friends-only' : 'private'}, so Steam will probably hide its inventory.` });
  }

  // 2. Inventories
  const contexts = contextsFor(settings);
  const games = [];
  const items = [];
  for (let i = 0; i < contexts.length; i++) {
    const { appid, contextid } = contexts[i];
    if (signal?.aborted) throw new ScanError('Scan cancelled.', { kind: 'cancelled' });
    emit({ stage: 'inventory', label: `Reading ${gameName(appid)} inventory`, done: i, total: contexts.length, appid });
    const g = { appid, contextid, name: gameName(appid), status: 'ok', count: 0, savedAt: null, message: null };
    try {
      const inv = await deps.steam.inventory(profile.steamid, appid, contextid, {
        signal,
        onWait: ({ waitMs }) => emit({ stage: 'inventory', label: `Steam asked us to slow down. Waiting ${Math.ceil(waitMs / 1000)} s`, done: i, total: contexts.length, appid }),
      });
      const { items: joined, orphans } = joinInventory(inv, appid, contextid);
      items.push(...joined);
      g.count = joined.reduce((a, it) => a + it.amount, 0);
      g.savedAt = inv.savedAt;
      if (orphans.length) g.message = `${orphans.length} items had no description and were skipped.`;
      if (inv.stale) {
        g.status = 'stale';
        g.message = `Steam is rate-limiting this connection, so this is cached data from ${new Date(inv.savedAt).toLocaleString('en-US')}.`;
      } else if (inv.fromCache) {
        g.status = 'cached';
      }
      if (!g.count && g.status === 'ok') g.status = 'empty';
    } catch (err) {
      if (signal?.aborted) throw new ScanError('Scan cancelled.', { kind: 'cancelled' });
      if (err instanceof PrivateInventoryError) {
        g.status = 'private';
        g.message = err.message;
      } else if (err instanceof RateLimitError) {
        g.status = 'rate-limited';
        g.message = err.message;
        g.retryInMs = err.retryInMs;
      } else {
        g.status = 'error';
        g.message = `Could not read this inventory (${err.message}).`;
      }
    }
    games.push(g);
  }

  const stacks = groupItems(items).map((s) => ({ ...s, quotes: {} }));

  // 3. Skinport catalogs (two requests per game, cached for 10 minutes)
  const skinportApps = [...new Set(stacks.filter((s) => s.marketable && skinportSupports(s.appid)).map((s) => s.appid))];
  if (!currency.skinport && skinportApps.length) {
    notices.push({ kind: 'skinport-currency', severity: 'info', text: `Skinport does not quote in ${currency.code}, so Skinport prices are unavailable for this scan.` });
  } else {
    for (let i = 0; i < skinportApps.length; i++) {
      const appid = skinportApps[i];
      emit({ stage: 'skinport', label: `Loading Skinport prices for ${gameName(appid)}`, done: i, total: skinportApps.length });
      try {
        const cat = await deps.skinport.catalog(appid, currency.code, { signal });
        for (const s of stacks) {
          if (s.appid === appid && s.marketHashName) s.quotes.skinport = skinportQuote(s.marketHashName, cat.items, cat.sales);
        }
        if (cat.stale) notices.push({ kind: 'skinport-stale', severity: 'info', text: `Skinport prices for ${gameName(appid)} come from the local cache.` });
      } catch (err) {
        if (signal?.aborted) throw new ScanError('Scan cancelled.', { kind: 'cancelled' });
        const text = err instanceof RateLimitError ? err.message : `Skinport prices for ${gameName(appid)} are unavailable (${err.message}).`;
        notices.push({ kind: 'skinport-error', severity: 'warn', text });
      }
    }
  }

  // 3b. Third-party marketplaces: one catalog per game, cached for an hour.
  const marketApps = [...new Set(stacks.filter((s) => s.marketable && s.marketHashName).map((s) => s.appid))];
  const jobs = [];
  for (const id of THIRD_PARTY) {
    if (!settings.venues?.[id] || !deps.venues) continue;
    for (const appid of marketApps) if (venueSupports(id, appid)) jobs.push({ id, appid });
  }
  for (let i = 0; i < jobs.length; i++) {
    const { id, appid } = jobs[i];
    if (signal?.aborted) throw new ScanError('Scan cancelled.', { kind: 'cancelled' });
    emit({ stage: 'venues', label: `Loading ${venueName(id)} prices for ${gameName(appid)}`, done: i, total: jobs.length });
    try {
      const cat = await deps.venues.catalog(id, appid, { signal });
      if (!cat) continue;
      for (const s of stacks) {
        const hit = s.appid === appid && s.marketHashName ? cat.data[s.marketHashName] : null;
        if (hit) s.quotes.venues = { ...(s.quotes.venues ?? {}), [id]: { ...hit, currency: 'USD' } };
      }
      if (cat.stale) notices.push({ kind: 'venue-stale', severity: 'info', text: `${venueName(id)} prices for ${gameName(appid)} come from the local cache.` });
    } catch (err) {
      if (signal?.aborted) throw new ScanError('Scan cancelled.', { kind: 'cancelled' });
      const text = err instanceof RateLimitError ? err.message : `${venueName(id)} prices for ${gameName(appid)} are unavailable (${err.message}).`;
      notices.push({ kind: 'venue-error', severity: 'info', text });
    }
  }

  // Exchange rates for venues that only quote USD.
  let fx = null;
  const usdVenues = THIRD_PARTY.some((id) => settings.venues?.[id]) || settings.venues?.csfloat;
  if (currency.code !== 'USD' && usdVenues && deps.venues) {
    emit({ stage: 'fx', label: 'Loading exchange rates' });
    try {
      fx = await deps.venues.fx({ signal });
    } catch (err) {
      notices.push({ kind: 'fx', severity: 'warn', text: `Exchange rates are unavailable (${err.message}), so USD-only marketplaces are hidden for ${currency.code}.` });
    }
  }

  // 4. Steam floors (throttled, cached for 3 hours, most valuable first)
  const order = lookupOrder(stacks);
  const limit = settings.steamFloorLimit;
  const lookups = { total: order.length, done: 0, network: 0, cached: 0, skipped: 0, rateLimited: 0, limit };
  let stopReason = null;
  for (const entry of order) {
    if (signal?.aborted) throw new ScanError('Scan cancelled.', { kind: 'cancelled' });
    const key = `${entry.appid}|${entry.name}`;
    const cachedQuote = deps.steam.cachedPriceOverview(entry.appid, entry.name, currency);
    if (cachedQuote) {
      attachQuotes(stacks, key, cachedQuote);
      lookups.cached++;
      lookups.done++;
      continue;
    }
    if (stopReason || control.skipSteam || lookups.network >= limit) {
      if (!stopReason) stopReason = control.skipSteam ? 'skipped' : 'limit';
      if (stopReason === 'rate-limited') lookups.rateLimited++;
      else lookups.skipped++;
      continue;
    }
    emit({ stage: 'steam', label: `Checking Steam floors`, done: lookups.network, total: Math.min(limit, order.length - lookups.cached), item: entry.name, canSkip: true });
    try {
      const q = await deps.steam.priceOverview(entry.appid, entry.name, currency, { signal });
      attachQuotes(stacks, key, q);
      lookups.network++;
      lookups.done++;
    } catch (err) {
      if (signal?.aborted) throw new ScanError('Scan cancelled.', { kind: 'cancelled' });
      if (err instanceof RateLimitError) {
        stopReason = 'rate-limited';
        lookups.rateLimited++;
        lookups.retryInMs = err.retryInMs;
      } else {
        lookups.done++;
      }
    }
  }
  if (stopReason === 'rate-limited') {
    notices.push({ kind: 'steam-rate-limit', severity: 'warn', text: `The Steam Market is rate-limiting this connection. Steam floors were checked for ${lookups.done} of ${lookups.total} items; the rest show the Skinport floor, labelled. Retry in about ${minutes(lookups.retryInMs ?? 60000)} min.` });
  } else if (lookups.skipped) {
    const why = stopReason === 'skipped' ? 'You skipped the remaining Steam lookups' : `Steam allows about 20 lookups a minute, so each scan checks up to ${limit} new items`;
    notices.push({ kind: 'steam-limit', severity: 'info', text: `${why}. ${lookups.skipped} items use the Skinport floor instead, labelled. Scan again later to fill them in from the cache.` });
  }

  // 5. Steam sales history (only with the optional login cookie)
  if (secrets.cookie) {
    const needs = order.filter((e) => settings.source === 'steam' || !stacks.some((s) => `${s.appid}|${s.marketHashName}` === `${e.appid}|${e.name}` && s.quotes.skinport?.sales?.[settings.window]?.volume > 0));
    let done = 0;
    for (const entry of needs.slice(0, limit)) {
      if (signal?.aborted) throw new ScanError('Scan cancelled.', { kind: 'cancelled' });
      if (control.skipSteam) break;
      emit({ stage: 'history', label: 'Reading Steam sales history', done, total: Math.min(limit, needs.length), item: entry.name, canSkip: true });
      try {
        const history = await deps.steam.priceHistory(entry.appid, entry.name, currency, secrets.cookie, { signal });
        if (history) attachQuotes(stacks, `${entry.appid}|${entry.name}`, { history });
      } catch (err) {
        if (err instanceof RateLimitError) break;
        if (err?.status === 400 || err?.status === 403) {
          notices.push({ kind: 'cookie', severity: 'warn', text: 'Steam rejected the login cookie, so Steam sales averages are unavailable. Paste a fresh steamLoginSecure value in Settings.' });
          break;
        }
      }
      done++;
    }
  }

  // 6. Experimental: walk Steam buy orders for the most valuable stacks.
  if (settings.buyOrders) {
    const unlocked = (e) => stacks.some((st) => st.appid === e.appid && st.marketHashName === e.name && !st.tradeHoldUntil);
    const ranked = lookupOrder(stacks)
      .map((e) => {
        const st = stacks.find((x) => x.appid === e.appid && x.marketHashName === e.name);
        return { ...e, est: (st?.quotes.steam?.lowest ?? st?.quotes.skinport?.min ?? 0) * (st?.quantity ?? 1) };
      })
      .filter(unlocked)
      .sort((a, b) => b.est - a.est)
      .slice(0, settings.buyOrdersTopN);
    const currencies = new Set();
    for (let i = 0; i < ranked.length; i++) {
      const entry = ranked[i];
      if (signal?.aborted) throw new ScanError('Scan cancelled.', { kind: 'cancelled' });
      if (control.skipSteam) break;
      emit({ stage: 'orderbook', label: 'Reading Steam buy orders', done: i, total: ranked.length, item: entry.name, canSkip: true });
      try {
        const book = await deps.steam.orderbook(entry.appid, entry.name, { signal });
        if (book) {
          attachQuotes(stacks, `${entry.appid}|${entry.name}`, book, 'book');
          if (book.currency) currencies.add(book.currency);
        }
      } catch (err) {
        if (err instanceof RateLimitError) {
          notices.push({ kind: 'orderbook-rate-limit', severity: 'warn', text: `Steam stopped answering buy-order requests after ${i} items (rate limit), so Instant covers only those.` });
          break;
        }
      }
    }
    const foreign = [...currencies].filter((c) => c !== currency.code);
    if (foreign.length) {
      notices.push({ kind: 'orderbook-currency', severity: 'info', text: `Steam quoted buy orders in ${foreign.join(', ')} (it picks the currency from your IP region), so Instant is shown in that currency and kept out of ${currency.code} totals.` });
    }
  }

  // 7. Experimental: CSFloat daily sales as a second CS2 average.
  if (settings.venues?.csfloat && deps.venues) {
    const ranked = lookupOrder(stacks)
      .filter((e) => e.appid === 730)
      .map((e) => {
        const st = stacks.find((x) => x.appid === e.appid && x.marketHashName === e.name);
        return { ...e, est: (st?.quotes.steam?.lowest ?? st?.quotes.skinport?.min ?? 0) * (st?.quantity ?? 1) };
      })
      .sort((a, b) => b.est - a.est)
      .slice(0, settings.csfloatTopN ?? 10);
    for (let i = 0; i < ranked.length; i++) {
      if (signal?.aborted) throw new ScanError('Scan cancelled.', { kind: 'cancelled' });
      if (control.skipSteam) break;
      emit({ stage: 'csfloat', label: 'Reading CSFloat sales', done: i, total: ranked.length, item: ranked[i].name, canSkip: true });
      try {
        const res = await deps.venues.csfloatHistory(ranked[i].name, { signal });
        attachQuotes(stacks, `${ranked[i].appid}|${ranked[i].name}`, res.data, 'csfloat');
      } catch (err) {
        if (err instanceof RateLimitError) {
          notices.push({ kind: 'csfloat-rate-limit', severity: 'info', text: `CSFloat stopped answering after ${i} items (rate limit).` });
          break;
        }
      }
    }
  }

  for (const g of games) {
    if (g.status === 'rate-limited') {
      notices.push({ kind: 'inventory-rate-limit', severity: 'error', text: `${g.name}: ${g.message}` });
    } else if (g.status === 'private') {
      notices.push({ kind: 'inventory-private', severity: 'warn', text: `${g.name}: ${g.message}` });
    } else if (g.status === 'stale') {
      notices.push({ kind: 'inventory-stale', severity: 'info', text: `${g.name}: ${g.message}` });
    } else if (g.status === 'error') {
      notices.push({ kind: 'inventory-error', severity: 'warn', text: `${g.name}: ${g.message}` });
    }
  }

  emit({ stage: 'finalize', label: 'Adding it all up' });
  const report = buildReport(stacks, { ...settings, fx }, currency.code);
  return {
    id: `${profile.steamid}-${scannedAt}`,
    scannedAt,
    demo: false,
    currency: currency.code,
    fx,
    profile,
    games,
    notices,
    lookups,
    ...report,
  };
}

function runDemo({ settings, currency, emit, scannedAt }) {
  emit({ stage: 'profile', label: 'Opening the demo case' });
  const data = loadDemo();
  const quotes = convertDemoQuotes(data.quotes, currency.code);
  const wanted = new Set(settings.games);
  const games = [];
  const items = [];
  for (const g of GAMES) {
    const inv = data.inventories[g.appid];
    if (!inv || !wanted.has(g.appid)) continue;
    const { items: joined } = joinInventory(inv, g.appid, g.contextid);
    for (const it of joined) it.tradeHoldUntil = shiftDemoHold(it.tradeHoldUntil, data.snapshot, scannedAt);
    items.push(...joined);
    games.push({ appid: g.appid, contextid: g.contextid, name: g.name, status: 'demo', count: joined.reduce((a, it) => a + it.amount, 0), savedAt: Date.parse(data.snapshot), message: null });
  }
  const snapshotAt = Date.parse(data.snapshot) + 12 * 3600 * 1000;
  const stacks = groupItems(items).map((s) => {
    const q = quotes[s.marketHashName] ?? {};
    const raw = data.quotes[s.marketHashName]?.raw ?? {};
    const sp = q.skinport && currency.skinport
      ? skinportQuote(s.marketHashName, indexSkinportItems(q.skinport.items), indexSkinportSales(q.skinport.sales))
      : null;
    const venues = {};
    const name = s.marketHashName;
    if (raw.waxpeer) venues.waxpeer = { ...parseWaxpeer({ items: [raw.waxpeer] })[name], currency: 'USD' };
    if (raw.marketcsgo) venues.marketcsgo = { ...parseMarketCsgo({ currency: 'USD', items: [raw.marketcsgo] })[name], currency: 'USD' };
    if (raw.lisskins) venues.lisskins = { ...parseLisSkins([raw.lisskins])[name], currency: 'USD' };
    for (const k of Object.keys(venues)) if (!(venues[k].min > 0)) delete venues[k];
    return {
      ...s,
      quotes: {
        steam: q.steam ?? null,
        skinport: sp,
        book: q.book ?? null,
        venues: Object.keys(venues).length ? venues : null,
        csfloat: raw.csfloat ? parseCsfloatGraph(raw.csfloat, snapshotAt) : null,
      },
    };
  });
  const fx = { base: 'USD', rates: { ...DEMO_RATES }, date: Date.parse(data.snapshot), source: 'fixed demo rates' };
  const notices = [
    { kind: 'demo', severity: 'info', text: `Demo profile. Item names, icons and prices are real market data captured on ${data.snapshot}; the owner, quantities and history are made up.` },
  ];
  if (currency.code !== 'USD') {
    notices.push({ kind: 'demo-currency', severity: 'info', text: `Demo prices were captured in USD and converted to ${currency.code} at a fixed demo rate (1 USD = ${DEMO_RATES[currency.code]} ${currency.code}).` });
  }
  if (!currency.skinport) {
    notices.push({ kind: 'skinport-currency', severity: 'info', text: `Skinport does not quote in ${currency.code}, so Skinport prices are unavailable.` });
  }
  const report = buildReport(stacks, { ...settings, fx }, currency.code);
  const lookupsTotal = new Set(stacks.filter((s) => s.marketable).map((s) => s.marketHashName)).size;
  return {
    id: `demo-${scannedAt}`,
    scannedAt,
    demo: true,
    snapshot: data.snapshot,
    currency: currency.code,
    fx: currency.code === 'USD' ? null : fx,
    profile: { ...data.profile, avatar: 'app://glasscase/renderer/img/demo-avatar.svg' },
    games,
    notices,
    lookups: { total: lookupsTotal, done: lookupsTotal, network: 0, cached: lookupsTotal, skipped: 0, rateLimited: 0, limit: settings.steamFloorLimit },
    ...report,
  };
}
