// Steam endpoints. All free; the API key and login cookie are optional and
// only ever sent to Steam's own hosts.

import { parseProfileXml } from '../core/profile-xml.js';
import { mergePages } from '../core/inventory.js';
import { parsePrice, parseVolume } from '../core/price-parse.js';
import { averageSteamHistory, WINDOWS } from '../core/pricing.js';
import { HttpError } from '../core/backoff.js';
import { parseOrderbook } from '../core/orderbook.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export class PrivateInventoryError extends Error {
  constructor(message = 'This inventory is private.') {
    super(message);
    this.name = 'PrivateInventoryError';
  }
}

export class ProfileError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProfileError';
  }
}

const COUNTRY_FOR_CURRENCY = {
  USD: 'us', GBP: 'gb', EUR: 'de', CHF: 'ch', RUB: 'ru', PLN: 'pl', BRL: 'br', NOK: 'no', IDR: 'id', MYR: 'my',
  PHP: 'ph', SGD: 'sg', THB: 'th', VND: 'vn', KRW: 'kr', TRY: 'tr', UAH: 'ua', MXN: 'mx', CAD: 'ca', AUD: 'au',
  NZD: 'nz', CNY: 'cn', INR: 'in', KZT: 'kz',
};

export function createSteam({ http, store, log }) {
  async function profile(ref, { apiKey, signal } = {}) {
    const url = ref.kind === 'vanity'
      ? `https://steamcommunity.com/id/${encodeURIComponent(ref.value)}/?xml=1`
      : `https://steamcommunity.com/profiles/${ref.value}/?xml=1`;
    const res = await http.get(url, {
      service: 'steam-community', as: 'text', signal, retries: 1,
      cacheKey: `profile:${ref.kind}:${ref.value.toLowerCase()}`, maxAgeMs: 30 * MIN,
    });
    const parsed = parseProfileXml(res.data);
    if (!parsed.ok) {
      const msg = /could not be found/i.test(parsed.error)
        ? `No Steam profile matches "${ref.value}". Check the spelling or paste the full profile link.`
        : parsed.error;
      throw new ProfileError(msg);
    }
    const p = { ...parsed.profile, fromCache: res.fromCache };

    if (apiKey) {
      try {
        await enrichWithApi(p, apiKey, signal);
      } catch (err) {
        log.warn('Web API enrichment failed:', err.message);
        p.apiError = err.message;
      }
    } else {
      p.level = await levelFromPage(p.steamid, signal).catch(() => null);
    }
    return p;
  }

  // Best effort: the public profile page shows the level for public profiles
  // (markup "friendPlayerLevelNum", verified on a public profile 2026-10-29).
  async function levelFromPage(steamid, signal) {
    const res = await http.get(`https://steamcommunity.com/profiles/${steamid}/`, {
      service: 'steam-community', as: 'text', signal, retries: 0,
      cacheKey: `level:${steamid}`, maxAgeMs: 6 * HOUR,
    });
    const m = /friendPlayerLevelNum">\s*(\d+)\s*</.exec(res.data);
    return m ? Number(m[1]) : null;
  }

  async function api(path, params, apiKey, signal) {
    const qs = new URLSearchParams({ key: apiKey, ...params });
    const res = await http.get(`https://api.steampowered.com/${path}/?${qs}`, { service: 'steam-api', signal, retries: 1 });
    return res.data;
  }

  async function enrichWithApi(p, apiKey, signal) {
    const [summaries, level, bans] = await Promise.all([
      api('ISteamUser/GetPlayerSummaries/v2', { steamids: p.steamid }, apiKey, signal).catch(() => null),
      api('IPlayerService/GetSteamLevel/v1', { steamid: p.steamid }, apiKey, signal).catch(() => null),
      api('ISteamUser/GetPlayerBans/v1', { steamids: p.steamid }, apiKey, signal).catch(() => null),
    ]);
    const s = summaries?.response?.players?.[0];
    if (s?.timecreated) p.created = s.timecreated * 1000;
    if (s?.avatarfull) p.avatar = s.avatarfull;
    if (Number.isFinite(level?.response?.player_level)) p.level = level.response.player_level;
    const b = bans?.players?.[0];
    if (b) {
      p.vacBanned = Boolean(b.VACBanned);
      p.vacBans = b.NumberOfVACBans ?? 0;
      p.gameBans = b.NumberOfGameBans ?? 0;
      p.daysSinceLastBan = b.DaysSinceLastBan ?? null;
      p.tradeBanState = b.EconomyBan && b.EconomyBan !== 'none' ? b.EconomyBan : p.tradeBanState;
      p.communityBanned = Boolean(b.CommunityBanned);
    }
    p.source = 'api';
  }

  // Reads a whole inventory, following pagination. Cached for 10 minutes.
  async function inventory(steamid, appid, contextid, { signal, maxAgeMs = 10 * MIN, onWait } = {}) {
    const cacheKey = `inv:${steamid}:${appid}:${contextid}`;
    const hit = store.getCache(cacheKey);
    if (hit && maxAgeMs > 0 && Date.now() - hit.savedAt < maxAgeMs) {
      return { ...hit.data, fromCache: true, savedAt: hit.savedAt, stale: false };
    }

    const pages = [];
    let start = null;
    let count = 2000;
    try {
      for (let guard = 0; guard < 50; guard++) {
        const url = `https://steamcommunity.com/inventory/${steamid}/${appid}/${contextid}?l=english&count=${count}${start ? `&start_assetid=${start}` : ''}`;
        let page;
        try {
          page = (await http.get(url, { service: 'steam-community', signal, retries: 2, allowStale: false, onWait })).data;
        } catch (err) {
          if (err instanceof HttpError && err.status === 400 && count > 1000) {
            count = 1000;
            guard--;
            continue;
          }
          if (err instanceof HttpError && (err.status === 403 || err.status === 401)) throw new PrivateInventoryError();
          if (err instanceof HttpError && err.status === 204) throw new PrivateInventoryError('Steam returned an empty response. The inventory is probably private.');
          throw err;
        }
        if (page?.success === false || page?.success === 0) throw new PrivateInventoryError(page?.Error ?? 'Steam refused to show this inventory.');
        pages.push(page);
        if (!page?.more_items || !page?.last_assetid) break;
        start = page.last_assetid;
      }
    } catch (err) {
      const stale = store.getCache(cacheKey);
      if (stale && !(err instanceof PrivateInventoryError)) {
        return { ...stale.data, fromCache: true, savedAt: stale.savedAt, stale: true, error: err };
      }
      throw err;
    }
    const merged = mergePages(pages);
    const entry = store.setCache(cacheKey, merged);
    return { ...merged, fromCache: false, savedAt: entry.savedAt, stale: false };
  }

  // Current floor, 24 h median and 24 h volume. Cached for 3 hours.
  async function priceOverview(appid, name, currency, { signal } = {}) {
    const url = `https://steamcommunity.com/market/priceoverview/?appid=${appid}&currency=${currency.steamId}&market_hash_name=${encodeURIComponent(name)}`;
    const res = await http.get(url, {
      service: 'steam-market', signal, retries: 1,
      cacheKey: `po:${appid}:${currency.steamId}:${name}`, maxAgeMs: 3 * HOUR,
    });
    const d = res.data ?? {};
    return {
      lowest: parsePrice(d.lowest_price),
      median24h: parsePrice(d.median_price),
      volume24h: d.volume != null ? parseVolume(d.volume) : d.lowest_price ? 0 : null,
      fromCache: res.fromCache,
      savedAt: res.savedAt,
    };
  }

  // Returns a fresh cached priceoverview without touching the network.
  function cachedPriceOverview(appid, name, currency) {
    const hit = store.getCache(`po:${appid}:${currency.steamId}:${name}`);
    if (!hit || Date.now() - hit.savedAt > 3 * HOUR) return null;
    const d = hit.data ?? {};
    return {
      lowest: parsePrice(d.lowest_price),
      median24h: parsePrice(d.median_price),
      volume24h: d.volume != null ? parseVolume(d.volume) : d.lowest_price ? 0 : null,
      fromCache: true,
      savedAt: hit.savedAt,
    };
  }

  // Full sales history. Needs the user's own steamLoginSecure cookie.
  // TODO(verify): Steam may quote history in the account's wallet currency
  // rather than the requested one; the response currency is not labelled.
  async function priceHistory(appid, name, currency, cookie, { signal } = {}) {
    const url = `https://steamcommunity.com/market/pricehistory/?appid=${appid}&currency=${currency.steamId}&market_hash_name=${encodeURIComponent(name)}`;
    const res = await http.get(url, {
      service: 'steam-market', signal, retries: 1,
      headers: { Cookie: `steamLoginSecure=${cookie}` },
      cacheKey: `ph:${appid}:${currency.steamId}:${name}`, maxAgeMs: 6 * HOUR,
    });
    const points = res.data?.prices;
    if (!Array.isArray(points)) return null;
    const history = {};
    for (const w of WINDOWS) history[w] = averageSteamHistory(points, w);
    return history;
  }

  // Experimental: Steam's undocumented order book. Cached for 1 hour; a 429
  // is not retried so the caller can stop at the first one.
  async function orderbook(appid, name, { signal } = {}) {
    const qp = encodeURIComponent(JSON.stringify([Number(appid), name]));
    const res = await http.get(`https://steamcommunity.com/market/orderbook?q=Load&qp=${qp}`, {
      service: 'steam-market', signal, retries: 0, allowStale: false,
      cacheKey: `ob:${appid}:${name}`, maxAgeMs: HOUR,
    });
    return parseOrderbook(res.data);
  }

  async function ownedGames(steamid, apiKey, { signal } = {}) {
    const qs = new URLSearchParams({ key: apiKey, steamid, include_appinfo: '1', include_played_free_games: '1', format: 'json' });
    const res = await http.get(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?${qs}`, {
      service: 'steam-api', signal, retries: 1, cacheKey: `owned:${steamid}`, maxAgeMs: 30 * MIN,
    });
    return res.data?.response ?? {};
  }

  // Store prices for many apps at once (only works with filters=price_overview).
  async function storePrices(appids, currencyCode, { signal, onProgress } = {}) {
    const cc = COUNTRY_FOR_CURRENCY[currencyCode] ?? 'us';
    const out = {};
    const chunks = [];
    for (let i = 0; i < appids.length; i += 50) chunks.push(appids.slice(i, i + 50));
    let done = 0;
    for (const chunk of chunks) {
      const url = `https://store.steampowered.com/api/appdetails?appids=${chunk.join(',')}&filters=price_overview&cc=${cc}`;
      const res = await http.get(url, {
        service: 'steam-store', signal, retries: 1, cacheKey: `store:${cc}:${chunk.join(',')}`, maxAgeMs: 12 * HOUR,
      });
      for (const [id, v] of Object.entries(res.data ?? {})) {
        const po = v?.success && !Array.isArray(v.data) ? v.data?.price_overview : null;
        out[id] = po
          ? { currency: po.currency, initial: po.initial, final: po.final, discount: po.discount_percent ?? 0 }
          : { free: Boolean(v?.success), currency: null };
      }
      done += chunk.length;
      onProgress?.(done, appids.length);
    }
    return out;
  }

  return {
    profile,
    inventory,
    priceOverview,
    cachedPriceOverview,
    priceHistory,
    orderbook,
    ownedGames,
    storePrices,
  };
}
