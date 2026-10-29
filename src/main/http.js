// Every outbound request goes through here: per-service throttling, timeouts,
// retries with backoff, Retry-After, and a disk cache that can serve stale
// data when a service is rate-limiting us.

import { HttpError, RateLimitError, withBackoff, createThrottle, parseRetryAfter } from '../core/backoff.js';

export const USER_AGENT = 'Glasscase/0.1 (+https://github.com/OWNER/glasscase)';

// Minimum gap between request starts, per service.
const INTERVALS = {
  'steam-community': 4000, // inventories, profiles
  'steam-market': 3200, // priceoverview / pricehistory (~20 per minute)
  'steam-api': 250,
  'steam-store': 1600,
  skinport: 1500,
  waxpeer: 2000,
  marketcsgo: 2000,
  lisskins: 2000,
  csfloat: 1500,
  fx: 1000,
  images: 0,
};

const SERVICE_NAMES = {
  'steam-community': 'Steam',
  'steam-market': 'The Steam Market',
  'steam-api': 'The Steam Web API',
  'steam-store': 'The Steam store',
  skinport: 'Skinport',
  waxpeer: 'Waxpeer',
  marketcsgo: 'Market.CSGO',
  lisskins: 'Lis-skins',
  csfloat: 'CSFloat',
  fx: 'The exchange-rate service',
  images: 'The Steam image CDN',
};

export function createHttp({ store, log, fetchImpl = globalThis.fetch, offline = false }) {
  const throttles = new Map();
  // Services that told us to back off stay blocked until this time.
  const blockedUntil = new Map();

  const throttleFor = (service) => {
    let t = throttles.get(service);
    if (!t) {
      t = createThrottle(INTERVALS[service] ?? 1000);
      throttles.set(service, t);
    }
    return t;
  };

  async function request(url, { service, headers = {}, signal, as = 'json', timeoutMs = 30000 }) {
    if (offline) throw Object.assign(new Error('Network access is turned off.'), { name: 'OfflineError' });
    const until = blockedUntil.get(service) ?? 0;
    if (until > Date.now()) throw new RateLimitError(SERVICE_NAMES[service] ?? service, until - Date.now());

    return throttleFor(service)(async () => {
      const timeout = AbortSignal.timeout(timeoutMs);
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: as === 'json' ? 'application/json' : '*/*', ...headers },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        redirect: 'follow',
      });
      if (!res.ok) {
        const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
        throw new HttpError(res.status, `HTTP ${res.status}`, { retryAfterMs, url });
      }
      if (as === 'text') return res.text();
      if (as === 'buffer') return { buffer: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') };
      const text = await res.text();
      if (!text.trim()) throw new HttpError(204, 'Empty response', { url });
      try {
        return JSON.parse(text);
      } catch {
        throw new HttpError(502, 'Response was not JSON', { url });
      }
    });
  }

  // Fetches with cache. Returns { data, fromCache, savedAt, stale }.
  async function get(url, {
    service,
    cacheKey = null,
    maxAgeMs = 0,
    allowStale = true,
    retries = 2,
    headers,
    signal,
    as = 'json',
    onWait,
  }) {
    if (cacheKey && maxAgeMs > 0) {
      const hit = store.getCache(cacheKey);
      if (hit && Date.now() - hit.savedAt < maxAgeMs) return { data: hit.data, fromCache: true, savedAt: hit.savedAt, stale: false };
    }
    try {
      const data = await withBackoff(() => request(url, { service, headers, signal, as }), {
        service: SERVICE_NAMES[service] ?? service,
        retries,
        signal,
        onWait: (info) => {
          log.warn(`${service} asked us to wait ${Math.round(info.waitMs / 1000)}s (attempt ${info.attempt})`);
          onWait?.(info);
        },
      });
      const entry = cacheKey ? store.setCache(cacheKey, data) : { savedAt: Date.now() };
      return { data, fromCache: false, savedAt: entry.savedAt, stale: false };
    } catch (err) {
      if (err instanceof RateLimitError) blockedUntil.set(service, Math.max(blockedUntil.get(service) ?? 0, err.retryAt));
      if (cacheKey && allowStale) {
        const hit = store.getCache(cacheKey);
        if (hit) {
          log.warn(`${service}: serving cached data after ${err.message}`);
          return { data: hit.data, fromCache: true, savedAt: hit.savedAt, stale: true, error: err };
        }
      }
      throw err;
    }
  }

  return {
    get,
    request,
    isBlocked: (service) => (blockedUntil.get(service) ?? 0) > Date.now(),
    blockedFor: (service) => Math.max(0, (blockedUntil.get(service) ?? 0) - Date.now()),
  };
}
