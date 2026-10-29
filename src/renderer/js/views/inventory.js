// Inventory: a fast, filterable grid of vitrine tiles.

import { h, money, segmented, toggle, clear, plural, fill } from '../dom.js';
import { icon } from '../icons.js';
import { tile, rarityName } from '../tile.js';
import { gameShort } from '../../../core/games.js';
import { parsePrice } from '../../../core/price-parse.js';
import { rarityRank } from '../../../core/rarity.js';

const SORTS = [
  { value: 'value', label: 'Value at LOWEST' },
  { value: 'avg', label: 'Value at AVG' },
  { value: 'unit', label: 'Unit price' },
  { value: 'rarity', label: 'Rarity' },
  { value: 'quantity', label: 'Quantity' },
  { value: 'days', label: 'Days to sell' },
  { value: 'name', label: 'Name' },
];

const lineValue = (s) => (s.prices?.lowest?.value ?? s.prices?.avg?.value ?? 0) * (s.quantity ?? 1);

function sortStacks(list, by) {
  const out = list.slice();
  const cmp = {
    value: (a, b) => lineValue(b) - lineValue(a),
    avg: (a, b) => (b.prices?.avg?.value ?? 0) * b.quantity - (a.prices?.avg?.value ?? 0) * a.quantity,
    unit: (a, b) => (b.prices?.lowest?.value ?? b.prices?.avg?.value ?? 0) - (a.prices?.lowest?.value ?? a.prices?.avg?.value ?? 0),
    rarity: (a, b) => rarityRank(b.rarity?.name) - rarityRank(a.rarity?.name) || lineValue(b) - lineValue(a),
    quantity: (a, b) => b.quantity - a.quantity,
    days: (a, b) => (b.derived?.daysToSell ?? -1) - (a.derived?.daysToSell ?? -1),
    name: (a, b) => a.name.localeCompare(b.name),
  }[by] ?? (() => 0);
  return out.sort(cmp);
}

export function filterStacks(stacks, f) {
  const q = (f.q ?? '').trim().toLowerCase();
  const min = parsePrice(f.min);
  return stacks.filter((s) => {
    if (f.keys && !f.keys.includes(s.key)) return false;
    if (f.game !== 'all' && String(s.appid) !== String(f.game)) return false;
    if (f.rarity !== 'all' && rarityName(s) !== f.rarity) return false;
    if (f.tradable && (!s.tradable || s.derived?.locked)) return false;
    if (min != null && min > 0 && (s.prices?.lowest?.value ?? s.prices?.avg?.value ?? 0) < min) return false;
    if (q && !`${s.name} ${s.marketHashName ?? ''} ${s.typeLine ?? ''} ${s.exterior ?? ''} ${rarityName(s) ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function renderInventory({ state, app }) {
  const r = state.result;
  const f = state.inv;
  const code = r.currency;

  const grid = h('div.shelf', { role: 'list', 'aria-label': 'Items' });
  const extra = h('div');
  const line = h('div.result-line', { 'aria-live': 'polite' });

  const draw = () => {
    const list = sortStacks(filterStacks(r.stacks, f), f.sort);
    const market = list.filter((s) => s.marketable && (s.prices?.lowest || s.prices?.avg));
    const unpriced = list.filter((s) => s.marketable && !s.prices?.lowest && !s.prices?.avg);
    const bound = list.filter((s) => !s.marketable);
    const count = list.reduce((a, s) => a + s.quantity, 0);
    const lowSum = market.reduce((a, s) => a + (s.prices?.lowest?.value ?? 0) * s.quantity, 0);
    const avgSum = market.reduce((a, s) => a + (s.prices?.avg?.value ?? 0) * s.quantity, 0);

    fill(line, 
      h('span', h('b', plural(count, 'item')), ` in ${plural(list.length, 'stack')}`),
      h('span', 'LOWEST ', h('b', money(lowSum, code))),
      h('span', 'AVG ', h('b', money(avgSum, code))),
      f.keys ? h('button.chip.accent', { type: 'button', on: { click: () => { f.keys = null; f.keysTitle = null; app.render(); } } }, `Showing: ${f.keysTitle}`, icon('close')) : null,
      h('span.grow'),
      sort,
    );

    clear(grid);
    clear(extra);
    if (!list.length) {
      clear(grid);
      extra.append(h('div.empty',
        emptyArt(),
        h('h3', r.stacks.length ? 'No items match these filters' : 'This case is empty'),
        h('p', r.stacks.length ? 'Clear the search or loosen a filter to see more.' : 'None of the selected games returned items. Choose more games in Settings, or check the profile’s privacy.'),
        h('div.actions', r.stacks.length
          ? h('button.btn', { type: 'button', on: { click: () => { Object.assign(f, { q: '', game: 'all', rarity: 'all', tradable: false, min: '', keys: null }); app.render(); } } }, 'Clear filters')
          : h('button.btn', { type: 'button', on: { click: () => app.go('settings') } }, 'Choose games')),
      ));
      return;
    }
    const frag = document.createDocumentFragment();
    for (const s of market) frag.append(tile(s, r, app.openItem));
    grid.append(frag);
    if (unpriced.length) {
      extra.append(
        h('div.subhead', h('h3', 'Unpriced'), h('p', 'No marketplace returned a price. These count as unpriced, never as zero.')),
        h('div.shelf', unpriced.map((s) => tile(s, r, app.openItem))),
      );
    }
    if (bound.length) {
      extra.append(
        h('div.subhead', h('h3', 'Not marketable'), h('p', 'Medals, coins and other account-bound items. Left out of every total.')),
        h('div.shelf', bound.map((s) => tile(s, r, app.openItem))),
      );
    }
  };

  const games = [...new Set(r.stacks.map((s) => s.appid))];
  const gameOptions = [{ value: 'all', label: 'All', sub: r.summary.counts.items }].concat(
    games.map((id) => ({ value: String(id), label: gameShort(id), sub: r.stacks.filter((s) => s.appid === id).reduce((a, s) => a + s.quantity, 0) })),
  );
  const rarities = [...new Set(r.stacks.map(rarityName).filter(Boolean))].sort((a, b) => rarityRank(b.replace('★ ', '')) - rarityRank(a.replace('★ ', '')));

  const search = h('input.field', {
    type: 'search', placeholder: 'Search items', value: f.q ?? '', 'aria-label': 'Search items', id: 'inv-search',
    on: { input: (e) => { f.q = e.target.value; draw(); } },
  });

  const rarity = h('select.field', { 'aria-label': 'Rarity', on: { change: (e) => { f.rarity = e.target.value; draw(); } } },
    h('option', { value: 'all' }, 'Any rarity'),
    rarities.map((x) => h('option', { value: x }, x)));
  rarity.value = f.rarity;

  const sort = h('select.field', { 'aria-label': 'Sort by', on: { change: (e) => { f.sort = e.target.value; draw(); } } },
    SORTS.map((x) => h('option', { value: x.value }, `Sort: ${x.label}`)));
  sort.value = f.sort;

  const min = h('input.field.minp', {
    type: 'text', inputmode: 'decimal', placeholder: 'Min price', value: f.min ?? '', 'aria-label': 'Minimum price',
    on: { input: (e) => { f.min = e.target.value; draw(); } },
  });

  const el = h('div.page',
    h('div.page-head',
      h('div', h('h1.large-title', 'Inventory'), h('p.page-sub', `${plural(r.summary.counts.items, 'item')} across ${plural(games.length, 'game')}. Select an item for both sources, sales volume and links.`)),
    ),
    h('div.filters',
      h('div.search', icon('search'), search),
      segmented(gameOptions, String(f.game), (v) => { f.game = v; draw(); }, 'Game'),
      rarity,
      toggle('Tradable now', f.tradable, (v) => { f.tradable = v; draw(); }),
      min,
    ),
    line,
    grid,
    extra,
  );

  draw();
  return {
    el,
    title: 'Inventory',
    focusSearch: () => search.focus(),
  };
}

function emptyArt() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 96 96');
  svg.setAttribute('class', 'art');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<defs><linearGradient id="eg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#66c0f4" stop-opacity=".35"/><stop offset="1" stop-color="#1a9fff" stop-opacity=".05"/></linearGradient></defs>'
    + '<rect x="14" y="18" width="68" height="56" rx="10" fill="url(#eg)" stroke="#66c0f4" stroke-opacity=".5"/>'
    + '<path d="M14 58h68" stroke="#66c0f4" stroke-opacity=".7"/><path d="M26 78h44" stroke="#66c0f4" stroke-opacity=".9" stroke-width="2" stroke-linecap="round"/>'
    + '<path d="M22 26l10 10M30 24l4 4" stroke="#ffffff" stroke-opacity=".35" stroke-linecap="round"/>';
  return svg;
}
