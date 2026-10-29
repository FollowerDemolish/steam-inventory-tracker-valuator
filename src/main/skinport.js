// Skinport public API (free, no key). One request returns a whole game's
// catalog, so prices are looked up locally after two calls per game.

import { indexSkinportItems, indexSkinportSales } from '../core/skinport-data.js';

const TEN_MIN = 10 * 60 * 1000;

export function createSkinport({ http }) {
  const headers = { 'Accept-Encoding': 'br' };

  async function catalog(appid, currencyCode, { signal } = {}) {
    const [items, sales] = await Promise.all([
      http.get(`https://api.skinport.com/v1/items?app_id=${appid}&currency=${currencyCode}&tradable=0`, {
        service: 'skinport', headers, signal, retries: 1, cacheKey: `sp-items:${appid}:${currencyCode}`, maxAgeMs: TEN_MIN,
      }),
      http.get(`https://api.skinport.com/v1/sales/history?app_id=${appid}&currency=${currencyCode}`, {
        service: 'skinport', headers, signal, retries: 1, cacheKey: `sp-sales:${appid}:${currencyCode}`, maxAgeMs: TEN_MIN,
      }),
    ]);
    return {
      items: indexSkinportItems(items.data),
      sales: indexSkinportSales(sales.data),
      savedAt: Math.min(items.savedAt, sales.savedAt),
      fromCache: items.fromCache && sales.fromCache,
      stale: items.stale || sales.stale,
    };
  }

  return { catalog };
}
