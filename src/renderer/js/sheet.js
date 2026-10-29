// Item detail sheet: both sources side by side, with every number labelled.

import { h, money, itemArt, rarityStyle, plural } from './dom.js';
import { icon } from './icons.js';
import { rarityName } from './tile.js';
import { gameName } from '../../core/games.js';
import { formatMoney, formatNumber, formatPercent } from '../../core/format.js';
import { sellerReceives } from '../../core/fees.js';
import { spreadOf } from '../../core/aggregate.js';
import { WINDOWS } from '../../core/pricing.js';
import { daysText, holdText, windowLabel, fxNote } from './labels.js';

let open = null;

export function closeSheet() {
  if (!open) return false;
  open.overlay.remove();
  open.sheet.remove();
  open.restore?.focus?.();
  document.removeEventListener('keydown', open.onKey, true);
  open = null;
  return true;
}

export function isSheetOpen() {
  return Boolean(open);
}

function usedCard(metric, cls, q, code, extra) {
  if (!q) {
    return h('div', h('span.metric' + (cls ? `.${cls}` : ''), metric), h('div.small-number', '—'), h('div.src', extra ?? 'Not available'));
  }
  return h('div',
    h('span.metric' + (cls ? `.${cls}` : ''), metric),
    h('div.small-number', money(q.value, code)),
    h('div.src', h('b', q.label), q.fallback ? h('span.fallback-mark', 'fallback') : null),
    q.note ? h('div.src', q.note) : null,
    extra ? h('div.src', extra) : null,
  );
}

export function openSheet(stack, result, app) {
  closeSheet();
  const code = result.currency;
  const q = stack.quotes ?? {};
  const p = stack.prices ?? {};
  const st = q.steam;
  const sp = q.skinport;
  const book = q.book;
  const restore = document.activeElement;
  const cf = q.csfloat?.sales?.[result.window];
  const csfloatOn = app.settings()?.venues?.csfloat;

  const close = h('button.btn.icon.ghost.close', { type: 'button', 'aria-label': 'Close', on: { click: closeSheet } }, icon('close'));

  const chips = [
    rarityName(stack) ? h('span.chip', { style: rarityStyle(stack) }, h('span.rar', rarityName(stack))) : null,
    stack.exterior ? h('span.chip', stack.exterior) : null,
    stack.quality && !['Normal', 'Standard', 'Unique', '\u2605'].includes(stack.quality) ? h('span.chip', stack.quality) : null,
    h('span.chip', gameName(stack.appid)),
    stack.quantity > 1 ? h('span.chip.accent', `${stack.quantity} owned`) : null,
    stack.derived?.locked ? h('span.chip.warn', icon('lock'), holdText(stack.tradeHoldUntil)) : null,
    !stack.marketable ? h('span.chip', 'Not marketable') : null,
  ];

  const low = p.lowest;
  const avg = p.avg;
  const avgExtra = avg?.median != null && avg.metric !== 'median'
    ? `Median ${formatMoney(avg.median, code)}${avg.volume ? `, ${plural(avg.volume, 'sale')}` : ''}${avg.skewed ? '. Skewed by outlier sales.' : '.'}`
    : null;

  const inst = p.instant;
  const instCard = inst?.locked
    ? usedCard('INSTANT', 'instant', null, code, 'Locked items can’t be sold into buy orders until the hold lifts.')
    : inst
      ? h('div',
          h('span.metric.instant', 'INSTANT'),
          h('div.small-number', money(inst.value, inst.currency ?? code)),
          h('div.src', h('b', 'Steam buy orders'), inst.of === 1 ? ', net' : `, net for ${inst.filled < inst.of ? `${inst.filled} of ${inst.of}` : inst.of === 2 ? 'both' : `all ${inst.of}`}`),
          h('div.src', `Top bid ${formatMoney(inst.bid, inst.currency ?? code)}${inst.filled > 1 ? `, deepest fill ${formatMoney(inst.lowestTouched, inst.currency ?? code)}` : ''}.`),
        )
      : usedCard('INSTANT', 'instant', null, code, stack.marketable ? 'No buy-order data for this item.' : 'Not marketable.');

  const steamRows = [];
  if (st) {
    steamRows.push(['Floor now', st.lowest != null ? formatMoney(st.lowest, code) : null]);
    steamRows.push(['Median, 24 h', st.median24h != null ? formatMoney(st.median24h, code) : null]);
    steamRows.push(['Sales, 24 h', st.volume24h != null ? formatNumber(st.volume24h) : null]);
    if (st.history) {
      const hw = st.history[result.window];
      steamRows.push([`Avg sale, ${windowLabel(result.window)}`, hw?.avg ? formatMoney(hw.avg, code) : null]);
    } else {
      steamRows.push(['Sales average', 'Needs login cookie']);
    }
  }
  if (book) {
    steamRows.push(['Top buy order', book.bid ? formatMoney(book.bid, book.currency ?? code) : null]);
    steamRows.push(['Buy orders', formatNumber(book.buyOrders)]);
  }

  const kv = (rows) => h('dl.kv', rows.flatMap(([k, v]) => [h('dt', k), h(v == null || /^Needs/.test(v) ? 'dd.muted' : 'dd', v ?? '—')]));

  const steamCard = h('div.source-card',
    h('h4', 'Steam Community Market', h('span.panel-meta', 'wallet')),
    st || book ? kv(steamRows) : h('p.src', 'No Steam data for this item.'),
  );

  const spCard = h('div.source-card',
    h('h4', 'Skinport', h('span.panel-meta', 'cash')),
    sp
      ? [
          kv([['Floor now', sp.min != null ? formatMoney(sp.min, code) : null], ['Listings', sp.quantity != null ? formatNumber(sp.quantity) : null]]),
          sp.sales
            ? h('table.windows',
                h('thead', h('tr', h('th', 'Sales'), h('th', 'Avg'), h('th', 'Median'), h('th', 'Max'), h('th', 'Count'))),
                h('tbody', WINDOWS.map((w) => {
                  const b = sp.sales[w] ?? {};
                  return h(`tr${w === result.window ? '.sel' : ''}`,
                    h('td', { title: windowLabel(w) }, w.replace(/(\d+)/, '$1\u2009')),
                    h('td', b.avg ? formatMoney(b.avg, code) : '—'),
                    h('td', b.median ? formatMoney(b.median, code) : '—'),
                    h('td', b.max ? formatMoney(b.max, code) : '—'),
                    h('td', formatNumber(b.volume ?? 0)));
                })))
            : h('p.src', 'No sales history.'),
          sp.versions > 1 ? h('p.src', { style: { 'margin-top': '6px' } }, `Skinport lists ${sp.versions} variants (for example Doppler phases); the floor is the cheapest and averages blend all of them.`) : null,
        ]
      : h('p.src', [730, 570, 440, 252490].includes(stack.appid) ? 'Skinport has no listing or sales for this item.' : 'Skinport does not trade this game.'),
  );

  const facts = [];
  if (low && avg) {
    const spread = spreadOf(low.value, avg.value);
    if (spread != null) facts.push([spread > 0.5 ? 'warn' : '', 'tag', `Spread between floor and average: ${formatPercent(spread)}${spread > 0.5 ? '. Treat with care.' : '.'}`]);
  }
  if (stack.marketable && low) {
    facts.push(['', 'wallet', `Net per item if sold on Steam at LOWEST: ${formatMoney(sellerReceives(low.value), code)} (Valve keeps ${formatMoney(low.value - sellerReceives(low.value), code)}).`]);
  }
  if (stack.derived?.skinportNet != null) facts.push(['', 'cash', `Net per item on Skinport: ${formatMoney(stack.derived.skinportNet, code)} after the seller fee.`]);
  if (stack.marketable) {
    const d = stack.derived?.daysToSell;
    const vol = p.dailyVolume;
    facts.push([d != null && d > 7 ? 'warn' : '', 'hourglass', d != null
      ? `About ${daysText(d)} to sell ${stack.quantity > 1 ? `all ${stack.quantity}` : 'it'} at ${formatPercent(state().captureRate)} of ${vol?.source === 'steam' ? 'Steam’s 24 h' : 'Skinport’s daily'} volume (${formatNumber(vol.value, 1)} a day).`
      : 'No sales volume data, so time to sell is unknown.']);
  }
  if (csfloatOn && cf?.volume > 0) {
    facts.push(['', 'history', `CSFloat: ${formatMoney(cf.avg, 'USD')} average over ${windowLabel(result.window)} from ${formatNumber(cf.volume)} sales (USD). It includes float and sticker premiums, so it runs high.`]);
  }
  if (avg?.skewed) facts.push(['warn', 'warn', `The average is skewed: ${avg.skew.includes('max') ? 'one sale was more than 5x the median' : 'mean and median differ by more than 25%'}. The median is the steadier number here.`]);

  // Marketplaces: every enabled venue that lists the item.
  const rows = p.venues ?? [];
  const converted = rows.some((r) => r.converted);
  const market = rows.length
    ? h('section.market', { 'aria-label': 'Marketplaces' },
        h('div.market-head', h('h3', 'Marketplaces'), h('span.panel-meta', 'Floor now, and what you keep after each fee')),
        h('div.mrow.mh', h('span', 'Venue'), h('span.r', 'Floor'), h('span.r', 'Listings'), h('span.r', 'Net'), h('span')),
        rows.map((r) => h(`div.mrow${r.cheapest ? '.buy' : ''}${r.bestSell ? '.sell' : ''}${r.bestCash && !r.bestSell ? '.cashbest' : ''}`,
          h('span.mname', h('b', r.name), h(`span.kind.${r.kind}`, r.kind === 'wallet' ? 'wallet' : 'cash'),
            r.cheapest ? h('span.vbadge.buy', 'Cheapest to buy') : null,
            r.bestSell ? h('span.vbadge.cash', r.kind === 'wallet' ? 'Best to sell, wallet' : 'Best to sell') : null,
            r.bestCash && !r.bestSell ? h('span.vbadge.cash', 'Best in cash') : null),
          h('span.r', { title: r.converted ? `${formatMoney(r.native.value, r.native.currency)} converted` : null }, r.floor != null ? `${r.converted ? '\u2248\u2009' : ''}${formatMoney(r.floor, code)}` : 'No rate'),
          h('span.r.muted', r.listings != null ? formatNumber(r.listings) : '\u2014'),
          h('span.r', { title: r.kind === 'wallet' ? 'After Valve\u2019s 5% + 10% fees' : `After a ${formatPercent(r.fee ?? 0)} seller fee` },
            r.net != null ? formatMoney(r.net, code) : '\u2014', h('small', r.kind === 'wallet' ? ' \u221215%' : ` \u2212${formatPercent(r.fee ?? 0)}`)),
          r.url ? h('button.btn.ghost.icon', { type: 'button', 'aria-label': `Open on ${r.name}`, title: `Open on ${r.name}`, on: { click: () => app.openExternal(r.url) } }, icon('external')) : h('span'),
        )),
        converted ? h('p.src', fxNote(result.fx, code)) : null,
      )
    : null;


  function state() {
    return app.settings();
  }

  const sheet = h('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title' },
    h('div.display', { style: rarityStyle(stack) }, h('div.pedestal', itemArt(stack, 512))),
    h('div.info',
      close,
      h('div', h('h2#sheet-title', stack.name), h('p.typeline', stack.typeLine || gameName(stack.appid))),
      h('div.chips', chips),
      stack.marketable
        ? h('div.used', usedCard('LOWEST', '', low, code), usedCard('AVG', 'avg', avg, code, avgExtra), instCard)
        : h('div.notice', icon('info'), h('span', 'This item can’t be sold on the Steam Market, so it has no price and is left out of every total.')),
      market,
      stack.marketable ? h('div.sources', steamCard, spCard) : null,
      facts.length ? h('div.facts', facts.map(([cls, ic, text]) => h(`div.fact${cls ? `.${cls}` : ''}`, icon(ic), h('span', text)))) : null,
    ),
  );
  const overlay = h('div.overlay', { on: { click: closeSheet } });

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeSheet();
    } else if (e.key === 'Tab') {
      const focusables = [...sheet.querySelectorAll('button, [href], input, select, [tabindex]:not([tabindex="-1"])')];
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay, sheet);
  close.focus();
  open = { sheet, overlay, onKey, restore };
}
