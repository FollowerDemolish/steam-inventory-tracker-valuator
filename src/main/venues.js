// Third-party marketplaces and the exchange-rate feed. Whole catalogs are
// fetched once per game, parsed into a compact name -> floor map, cached for
// an hour and looked up locally. Cached data is served when a venue refuses.

import { parseWaxpeer, parseMarketCsgo, parseLisSkins, parseCsfloatGraph, parseFx } from '../core/venue-parsers.js';
import { venueById } from '../core/venues.js';

const HOUR = 60 * 60 * 1000;

const CATALOGS = {
  waxpeer: {
    url: (appid) => `https://api.waxpeer.com/v1/prices?game=${venueById('waxpeer').apps[appid]}&minified=1`,
    parse: parseWaxpeer,
  },
  marketcsgo: {
    url: (appid) => `https://${venueById('marketcsgo').apps[appid]}/api/v2/prices/USD.json`,
    parse: parseMarketCsgo,
  },
  lisskins: {
    // Never the "api_csgo_full.json" export: it is over 140 MB.
    url: (appid) => `https://lis-skins.com/market_export_json/${venueById('lisskins').apps[appid]}.json`,
    parse: parseLisSkins,
  },
};

export function createVenues({ http, store, log }) {
  async function cached(key, maxAgeMs, load) {
    const hit = store.getCache(key);
    if (hit && Date.now() - hit.savedAt < maxAgeMs) return { data: hit.data, savedAt: hit.savedAt, fromCache: true, stale: false };
    try {
      const data = await load();
      const entry = store.setCache(key, data);
      return { data, savedAt: entry.savedAt, fromCache: false, stale: false };
    } catch (err) {
      if (hit) {
        log.warn(`${key}: serving cached data after ${err.message}`);
        return { data: hit.data, savedAt: hit.savedAt, fromCache: true, stale: true, error: err };
      }
      throw err;
    }
  }

  // name -> { min (USD cents), count, url?, unlocked? }
  async function catalog(id, appid, { signal } = {}) {
    const def = CATALOGS[id];
    if (!def || !venueById(id)?.apps?.[appid]) return null;
    return cached(`venue:${id}:${appid}`, HOUR, async () => {
      const res = (await http.get(def.url(appid), { service: id, signal, retries: 1, allowStale: false })).data;
      const parsed = def.parse(res);
      if (!Object.keys(parsed).length) throw new Error('empty price list');
      return parsed;
    });
  }

  // Experimental: CSFloat daily sales for one CS2 item. Cached for 6 hours.
  async function csfloatHistory(name, { signal } = {}) {
    return cached(`csfloat:${name}`, 6 * HOUR, async () => {
      const res = (await http.get(`https://csfloat.com/api/v1/history/${encodeURIComponent(name)}/graph`, { service: 'csfloat', signal, retries: 0, allowStale: false })).data;
      return Array.isArray(res) ? res.slice(0, 100).map((d) => ({ day: d.day, count: d.count, avg_price: Math.round(d.avg_price) })) : [];
    }).then((r) => ({ ...r, data: parseCsfloatGraph(r.data) }));
  }

  // USD-based exchange rates, cached for 12 hours.
  async function fx({ signal } = {}) {
    const r = await cached('fx:USD', 12 * HOUR, async () => {
      const parsed = parseFx((await http.get('https://open.er-api.com/v6/latest/USD', { service: 'fx', signal, retries: 1, allowStale: false })).data);
      if (!parsed) throw new Error('unexpected exchange-rate response');
      return parsed;
    });
    return r.data;
  }

  return { catalog, csfloatHistory, fx };
}
