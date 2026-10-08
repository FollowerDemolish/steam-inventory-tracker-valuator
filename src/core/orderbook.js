// Steam buy orders ("instant sell"). The order book comes from Steam's
// undocumented market/orderbook endpoint, so everything here is defensive.
// Response shape (verified 2026-10-29):
//   { data: { success, data: { amtMaxBuyOrder, amtMinSellOrder, eCurrency,
//     cBuyOrders, cSellOrders, rgCompactBuyOrders: [price, qty, price, qty, ...] } } }
// Prices are integer minor units in the currency `eCurrency` (Steam currency
// id), which follows the requester's IP region, not a query parameter.

import { CURRENCIES } from './currencies.js';
import { sellerReceives } from './fees.js';

export function currencyFromSteamId(id) {
  return CURRENCIES.find((c) => c.steamId === Number(id))?.code ?? null;
}

export function parseOrderbook(json) {
  const d = json?.data?.data ?? json?.data ?? json;
  if (!d || d.success === false) return null;
  const flat = Array.isArray(d.rgCompactBuyOrders) ? d.rgCompactBuyOrders : [];
  const ladder = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const price = Number(flat[i]);
    const qty = Number(flat[i + 1]);
    if (price > 0 && qty > 0) ladder.push([price, qty]);
  }
  ladder.sort((a, b) => b[0] - a[0]);
  const bid = Number(d.amtMaxBuyOrder) || ladder[0]?.[0] || null;
  return {
    bid,
    ask: Number(d.amtMinSellOrder) || null,
    currency: currencyFromSteamId(d.eCurrency),
    buyOrders: Number(d.cBuyOrders) || 0,
    sellOrders: Number(d.cSellOrders) || 0,
    ladder,
  };
}

// Sells `quantity` units into the buy orders, best price first. Each unit is
// a separate sale, so Steam's fee is applied per unit at its own price.
export function walkBuyOrders(ladder, quantity, fee = sellerReceives) {
  let left = Math.max(0, Math.trunc(quantity));
  let gross = 0;
  let net = 0;
  let filled = 0;
  let lowestTouched = null;
  for (const [price, qty] of ladder ?? []) {
    if (left <= 0) break;
    const take = Math.min(left, qty);
    gross += price * take;
    net += fee(price) * take;
    filled += take;
    left -= take;
    lowestTouched = price;
  }
  return {
    filled,
    unfilled: left,
    gross,
    net,
    avgPrice: filled ? Math.round(gross / filled) : null,
    lowestTouched,
  };
}
