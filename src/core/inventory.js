// Joins Steam inventory pages (assets + descriptions) into normalized items,
// then groups identical items into stacks with a quantity.

import { normalizeHex } from './rarity.js';

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

export function mergePages(pages) {
  const assets = [];
  const descriptions = [];
  let total = 0;
  for (const page of pages) {
    if (!page) continue;
    if (Array.isArray(page.assets)) assets.push(...page.assets);
    if (Array.isArray(page.descriptions)) descriptions.push(...page.descriptions);
    if (Number.isFinite(page.total_inventory_count)) total = Math.max(total, page.total_inventory_count);
  }
  return { assets, descriptions, total_inventory_count: total || assets.length };
}

// Pulls a trade-hold date out of text such as
// "Tradable/Marketable After Nov 05, 2026 (7:00:00) GMT".
export function parseTradeHold(text) {
  if (!text) return null;
  // TODO(verify): the exact wording Steam uses for CS2 trade protection.
  // Both "Tradable/Marketable After <date>" and "... until <date>" are read.
  const m = /(?:After|until)\s+([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:\s*\(?\s*(\d{1,2}):(\d{2}):(\d{2})\)?)?/i.exec(String(text));
  if (!m) return null;
  const month = MONTHS[m[1].slice(0, 1).toUpperCase() + m[1].slice(1, 3).toLowerCase()];
  if (month == null) return null;
  const date = new Date(Date.UTC(Number(m[3]), month, Number(m[2]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function tagByCategory(tags, category) {
  return (tags ?? []).find((t) => t.category === category) ?? null;
}

function tagName(tag) {
  return tag ? tag.localized_tag_name ?? tag.name ?? tag.internal_name ?? null : null;
}

export function normalizeDescription(desc, appid, contextid) {
  const tags = Array.isArray(desc.tags) ? desc.tags : [];
  const rarityTag = tagByCategory(tags, 'Rarity');
  const exterior = tagName(tagByCategory(tags, 'Exterior'));
  const quality = tagName(tagByCategory(tags, 'Quality'));
  const type = tagName(tagByCategory(tags, 'Type')) ?? tagName(tagByCategory(tags, 'item_class')) ?? null;

  let tradeHoldUntil = null;
  for (const od of desc.owner_descriptions ?? []) {
    tradeHoldUntil = parseTradeHold(od?.value);
    if (tradeHoldUntil) break;
  }

  return {
    appid: Number(appid),
    contextid: Number(contextid),
    classid: String(desc.classid),
    instanceid: String(desc.instanceid ?? '0'),
    name: desc.name ?? desc.market_name ?? desc.market_hash_name ?? 'Unknown item',
    marketHashName: desc.market_hash_name ?? null,
    typeLine: desc.type ?? '',
    category: type,
    iconUrl: desc.icon_url_large || desc.icon_url || null,
    nameColor: normalizeHex(desc.name_color),
    rarity: rarityTag ? { name: tagName(rarityTag), color: normalizeHex(rarityTag.color) } : null,
    exterior,
    quality,
    marketable: Boolean(Number(desc.marketable)),
    tradable: Boolean(Number(desc.tradable)),
    commodity: Boolean(Number(desc.commodity)),
    tradeHoldUntil,
  };
}

// Joins assets to descriptions on (classid, instanceid). Assets whose
// description is missing are reported in `orphans` instead of dropped silently.
export function joinInventory(page, appid, contextid) {
  const byKey = new Map();
  for (const d of page.descriptions ?? []) {
    byKey.set(`${d.classid}_${d.instanceid ?? '0'}`, d);
  }
  const items = [];
  const orphans = [];
  for (const a of page.assets ?? []) {
    const desc = byKey.get(`${a.classid}_${a.instanceid ?? '0'}`);
    if (!desc) {
      orphans.push(String(a.assetid));
      continue;
    }
    items.push({
      ...normalizeDescription(desc, a.appid ?? appid, a.contextid ?? contextid),
      assetid: String(a.assetid),
      amount: Math.max(1, Number(a.amount) || 1),
    });
  }
  return { items, orphans };
}

// Groups identical items into stacks. Items on a trade hold stay separate
// from free copies so the lock is shown accurately.
export function groupItems(items) {
  const groups = new Map();
  for (const it of items) {
    const identity = it.marketHashName ?? `class:${it.classid}_${it.instanceid}`;
    const key = `${it.appid}|${identity}|${it.tradable ? 't' : 'n'}|${it.tradeHoldUntil ?? ''}`;
    let g = groups.get(key);
    if (!g) {
      const { assetid, amount, ...rest } = it;
      g = { ...rest, key, assetids: [], quantity: 0 };
      groups.set(key, g);
    }
    g.assetids.push(it.assetid);
    g.quantity += it.amount;
  }
  return [...groups.values()];
}
