// The vitrine tile: an item on a plinth lit by its rarity colour.

import { h, money, itemArt, rarityStyle } from './dom.js';
import { icon } from './icons.js';
import { formatMoney } from '../../core/format.js';
import { holdShort } from './labels.js';

export function rarityName(stack) {
  return stack.rarity?.name ?? stack.category ?? null;
}

export function metaLine(stack) {
  return [rarityName(stack), stack.exterior].filter(Boolean);
}

export function tile(stack, result, onOpen) {
  const code = result.currency;
  const low = stack.prices?.lowest;
  const avg = stack.prices?.avg;
  const lock = stack.derived?.locked ? holdShort(stack.tradeHoldUntil) : null;
  const meta = metaLine(stack);
  const qty = stack.quantity > 1 ? stack.quantity : 1;

  let prices;
  if (!stack.marketable) {
    prices = h('div.prices', h('span.na', 'Not marketable'));
  } else if (!low && !avg) {
    // Unpriced by the sources in use; say so if another marketplace lists it.
    const other = (stack.prices?.venues ?? []).filter((r) => r.floor > 0).sort((a, b) => a.floor - b.floor)[0];
    prices = h('div.prices', h('span.unpriced', 'Unpriced'), other ? h('span.avg', { title: `${other.name} lists it at ${formatMoney(other.floor, code)}` }, `on ${other.name}`) : null);
  } else {
    // Stacks show line totals (what the sort uses); the unit floor stays visible as "ea".
    prices = h('div.prices',
      h('span.low', { title: low ? `LOWEST: ${low.label}${low.fallback ? ' (fallback)' : ''}${qty > 1 ? `. ${formatMoney(low.value, code)} each` : ''}` : 'No floor' },
        low ? money(low.value * qty, code) : '—',
        low && qty > 1 ? h('span.ea', `${formatMoney(low.value, code)} ea`) : null),
      avg
        ? h('span.avg', { title: `AVG: ${avg.label}${avg.fallback ? ' (fallback)' : ''}${avg.median ? `. Median ${formatMoney(avg.median, code)}` : ''}${avg.skewed ? '. Skewed by outlier sales' : ''}${qty > 1 ? `. ${formatMoney(avg.value, code)} each` : ''}` },
            avg.metric === 'median' ? 'median ' : 'avg ', money(avg.value * qty, code), avg.skewed ? h('span.skew-dot', { 'aria-label': 'skewed average' }) : null)
        : h('span.avg', 'no avg'),
    );
  }

  const label = [
    stack.name,
    stack.quantity > 1 ? `${stack.quantity} items` : null,
    meta.join(', '),
    low ? `LOWEST ${formatMoney(low.value * qty, code)}${qty > 1 ? ` (${formatMoney(low.value, code)} each)` : ''}` : null,
    avg ? `AVG ${formatMoney(avg.value * qty, code)}` : null,
    lock ? 'on trade hold' : null,
  ].filter(Boolean).join(', ');

  return h('button.tile', {
    type: 'button',
    style: rarityStyle(stack),
    'aria-label': label,
    dataset: { key: stack.key },
    on: { click: () => onOpen(stack) },
  },
    h('div.stage', itemArt(stack, 256),
      h('div.flags',
        lock ? h('span.flag', { title: `Trade hold until ${new Date(stack.tradeHoldUntil).toLocaleString('en-US')}` }, icon('lock'), lock) : h('span'),
        stack.quantity > 1 ? h('span.flag.qty', `×${stack.quantity}`) : null,
      ),
    ),
    h('div.body',
      h('div.name', stack.name),
      h('div.meta',
        rarityName(stack) ? h('span.rar', rarityName(stack)) : null,
        rarityName(stack) && stack.exterior ? h('span.sep', { 'aria-hidden': 'true' }) : null,
        stack.exterior ? h('span', stack.exterior) : null,
      ),
      prices,
    ),
  );
}
