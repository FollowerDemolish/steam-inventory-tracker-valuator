import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinInventory, groupItems, mergePages, parseTradeHold } from '../src/core/inventory.js';

const desc = (classid, extra = {}) => ({
  classid, instanceid: '0', name: `Item ${classid}`, market_hash_name: `Item ${classid}`, icon_url: `icon${classid}`,
  type: 'Classified Rifle', name_color: 'D2D2D2', marketable: 1, tradable: 1, commodity: 0,
  tags: [
    { category: 'Rarity', localized_tag_name: 'Classified', color: 'd32ce6' },
    { category: 'Exterior', localized_tag_name: 'Field-Tested' },
    { category: 'Type', localized_tag_name: 'Rifle' },
  ],
  ...extra,
});

test('joins assets to descriptions on classid and instanceid', () => {
  const page = {
    assets: [
      { assetid: '1', classid: '10', instanceid: '0', amount: '1' },
      { assetid: '2', classid: '10', instanceid: '0', amount: '1' },
      { assetid: '3', classid: '20', instanceid: '7', amount: '1' },
      { assetid: '4', classid: '99', instanceid: '0', amount: '1' },
    ],
    descriptions: [desc('10'), desc('20', { instanceid: '7', name: 'Other' })],
  };
  const { items, orphans } = joinInventory(page, 730, 2);
  assert.equal(items.length, 3);
  assert.deepEqual(orphans, ['4']);
  assert.equal(items[0].rarity.name, 'Classified');
  assert.equal(items[0].rarity.color, '#d32ce6');
  assert.equal(items[0].exterior, 'Field-Tested');
  assert.equal(items[0].nameColor, '#d2d2d2');
  assert.equal(items[2].name, 'Other');
});

test('groups identical items into stacks with quantity', () => {
  const page = {
    assets: [
      { assetid: '1', classid: '10', instanceid: '0', amount: '1' },
      { assetid: '2', classid: '10', instanceid: '0', amount: '1' },
      { assetid: '3', classid: '30', instanceid: '0', amount: '250' },
    ],
    descriptions: [desc('10'), desc('30', { market_hash_name: '753-Sack of Gems', commodity: 1 })],
  };
  const stacks = groupItems(joinInventory(page, 753, 6).items);
  assert.equal(stacks.length, 2);
  assert.equal(stacks.find((s) => s.marketHashName === 'Item 10').quantity, 2);
  assert.deepEqual(stacks.find((s) => s.marketHashName === 'Item 10').assetids, ['1', '2']);
  assert.equal(stacks.find((s) => s.marketHashName === '753-Sack of Gems').quantity, 250);
});

test('keeps trade-held copies apart from free ones', () => {
  const held = desc('11', {
    market_hash_name: 'Item 10', tradable: 0,
    owner_descriptions: [{ value: ' ' }, { value: 'Tradable/Marketable After Nov 05, 2026 (7:00:00) GMT' }],
  });
  const page = {
    assets: [
      { assetid: '1', classid: '10', instanceid: '0', amount: '1' },
      { assetid: '2', classid: '11', instanceid: '0', amount: '1' },
    ],
    descriptions: [desc('10'), held],
  };
  const stacks = groupItems(joinInventory(page, 730, 2).items);
  assert.equal(stacks.length, 2);
  const lock = stacks.find((s) => s.tradeHoldUntil);
  assert.equal(lock.tradeHoldUntil, '2026-11-05T07:00:00.000Z');
  assert.equal(lock.tradable, false);
});

test('reads trade-hold dates in several wordings', () => {
  assert.equal(parseTradeHold('Tradable/Marketable After Nov 05, 2026 (7:00:00) GMT'), '2026-11-05T07:00:00.000Z');
  assert.equal(parseTradeHold('Tradable After Jan 9, 2027'), '2027-01-09T00:00:00.000Z');
  assert.equal(parseTradeHold('Trade Protected until November 5, 2026 (7:00:00) GMT'), '2026-11-05T07:00:00.000Z');
  assert.equal(parseTradeHold('Exterior: Field-Tested'), null);
  assert.equal(parseTradeHold(null), null);
});

test('merges paginated responses', () => {
  const merged = mergePages([
    { assets: [{ assetid: '1' }], descriptions: [{ classid: 'a' }], total_inventory_count: 2 },
    { assets: [{ assetid: '2' }], descriptions: [{ classid: 'b' }], total_inventory_count: 2 },
  ]);
  assert.equal(merged.assets.length, 2);
  assert.equal(merged.descriptions.length, 2);
  assert.equal(merged.total_inventory_count, 2);
});
