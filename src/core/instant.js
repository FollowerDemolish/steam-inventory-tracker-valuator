// "Instant (net)": what selling a whole stack into Steam's buy orders right
// now would put in the Steam wallet, after Valve's fees.

import { walkBuyOrders } from './orderbook.js';
import { sellerReceives } from './fees.js';

export function isLocked(stack, now = Date.now()) {
  if (!stack?.tradeHoldUntil) return false;
  const t = Date.parse(stack.tradeHoldUntil);
  return Number.isFinite(t) && t > now;
}

export function orderbookInstant(book, stack, { now = Date.now() } = {}) {
  if (!book || !Array.isArray(book.ladder) || !stack?.marketable) return null;
  const quantity = stack.quantity ?? 1;
  if (isLocked(stack, now)) {
    return { locked: true, value: null, label: 'Instant (net), Steam buy orders', source: 'steam', metric: 'instant', window: 'now', currency: book.currency };
  }
  const walk = walkBuyOrders(book.ladder, quantity, sellerReceives);
  if (!walk.filled) return null;
  return {
    value: walk.net,
    gross: walk.gross,
    filled: walk.filled,
    of: quantity,
    perUnit: Math.round(walk.net / walk.filled),
    bid: book.bid,
    lowestTouched: walk.lowestTouched,
    currency: book.currency,
    source: 'steam',
    metric: 'instant',
    window: 'now',
    label: 'Instant (net), Steam buy orders',
    partial: walk.unfilled > 0,
  };
}
