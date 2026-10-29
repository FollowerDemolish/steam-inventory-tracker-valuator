// Overview: who the profile is, what the inventory is worth, and how much of
// that you could actually get out.

import { h, money, countUp, avatar, plural } from '../dom.js';
import { icon } from '../icons.js';
import { tile } from '../tile.js';
import { gameName, gameById } from '../../../core/games.js';
import { accountAge, formatPercent, formatSignedPercent, formatSignedMoney, formatDate, formatMoney, relativeTime } from '../../../core/format.js';
import { historyDelta } from '../../../core/report.js';
import { smoothPath } from './history.js';
import { lowestSource, avgSource, lowestFallbackText, avgFallbackText, coverageText, holdText, windowLabel as windowLabelText, venueShort, fxNote } from '../labels.js';

function badges(p) {
  const out = [];
  if (Number.isFinite(p.level)) {
    const hue = p.level >= 100 ? '#e4ae39' : p.level >= 50 ? '#d32ce6' : p.level >= 20 ? '#4b69ff' : '#8b9eb3';
    out.push(h('span.chip', h('span.level', { style: { '--level': hue } }, String(p.level)), 'Steam level'));
  }
  const age = p.created ? accountAge(p.created) : null;
  if (age) out.push(h('span.chip', { title: `Member since ${formatDate(p.created)}` }, icon('calendar'), `${age} on Steam`));
  if (p.vacBanned) out.push(h('span.chip.bad', icon('shieldX'), p.vacBans > 1 ? `${p.vacBans} VAC bans` : 'VAC ban on record'));
  else out.push(h('span.chip.good', icon('shield'), 'No VAC bans'));
  const trade = String(p.tradeBanState ?? 'None');
  if (trade && trade.toLowerCase() !== 'none') out.push(h('span.chip.bad', icon('shieldX'), `Trade ban: ${trade}`));
  else out.push(h('span.chip.good', icon('shield'), 'No trade ban'));
  if (p.limited) out.push(h('span.chip.warn', icon('warn'), 'Limited account'));
  else out.push(h('span.chip.good', icon('check'), 'Not limited'));
  return out;
}

function deltaChip(delta, code) {
  if (!delta || delta.rel == null) return null;
  const cls = delta.abs > 0 ? 'up' : delta.abs < 0 ? 'down' : 'flat';
  return h(`span.delta.${cls}`, { title: `${formatSignedMoney(delta.abs, code)} since ${formatDate(delta.since)}` },
    `${formatSignedPercent(delta.rel)} since ${formatDate(delta.since, { month: 'short', day: 'numeric' })}`);
}

function ring(fraction) {
  const r = 19;
  const c = 2 * Math.PI * r;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 46 46');
  svg.setAttribute('class', 'ring');
  svg.setAttribute('aria-hidden', 'true');
  const mk = (cls) => {
    const el = document.createElementNS(ns, 'circle');
    el.setAttribute('cx', '23');
    el.setAttribute('cy', '23');
    el.setAttribute('r', String(r));
    el.setAttribute('class', cls);
    return el;
  };
  const val = mk('val');
  val.setAttribute('stroke-dasharray', String(c));
  val.setAttribute('stroke-dashoffset', String(c));
  val.setAttribute('transform', 'rotate(-90 23 23)');
  svg.append(mk('track'), val);
  requestAnimationFrame(() => requestAnimationFrame(() => val.setAttribute('stroke-dashoffset', String(c * (1 - (fraction ?? 0))))));
  return svg;
}

function skeleton() {
  const block = (w, ht, extra = {}) => h('div.skel', { style: { width: w, height: `${ht}px`, ...extra } });
  return h('div',
    h('div.ov-profile', block('76px', 76, { 'border-radius': '22px' }), h('div.who-block', block('260px', 30), h('div.badges', block('110px', 26), block('140px', 26), block('120px', 26)))),
    h('div.panel.hero', { 'aria-busy': 'true' },
      h('div.hero-main', block('70px', 20), block('360px', 64), block('240px', 14)),
      h('div.hero-side', h('div', block('60px', 20), block('200px', 34), block('180px', 12)), h('div', block('60px', 20), block('160px', 22), block('200px', 12))),
    ),
    h('div.section-title', block('140px', 20)),
    h('div.shelf.top', Array.from({ length: 6 }, () => h('div.tile', h('div.stage', block('110px', 80)), h('div.body', block('90%', 13), block('60%', 11), block('50%', 14))))),
  );
}

export function renderOverview({ state, app }) {
  const r = state.result;
  if (!r) return { el: h('div.page', skeleton()), title: 'Overview' };

  const s = r.summary;
  const t = s.totals;
  const code = r.currency;
  const p = r.profile;
  const prev = state.prevTotals?.currency === r.currency ? state.prevTotals : null;
  const delta = historyDelta(state.history);

  const lowEl = money(prev ? prev.lowest : 0, code, 'money');
  const avgEl = money(prev ? prev.avg : 0, code, 'money');
  const netEl = money(prev ? prev.net : 0, code, 'money');

  const notices = r.notices.filter((n) => n.severity !== 'info' || n.kind === 'orderbook-currency' || n.kind === 'steam-limit');
  const noticeEls = notices.length
    ? h('div.notices', notices.map((n) => h(`div.notice.${n.severity === 'error' ? 'error' : n.severity === 'warn' ? 'warn' : 'info'}`, { role: n.severity === 'error' ? 'alert' : null }, icon(n.severity === 'info' ? 'info' : 'warn'), h('span', n.text))))
    : null;

  // Profile
  const profile = h('div.ov-profile',
    avatar(p),
    h('div.who-block',
      h('h1', p.name),
      h('div.badges', badges(p), r.demo ? h('span.chip.accent', icon('sparkles'), 'Demo profile') : null),
    ),
  );

  // Totals: LOWEST and AVG
  const lowFallback = lowestFallbackText(r);
  const skewedN = s.warnings.find((w) => w.kind === 'skewed')?.keys.length ?? 0;
  const avgFallback = avgFallbackText(r);
  const hero = h('section.panel.hero', { 'aria-label': 'Inventory value' },
    h('div.hero-main',
      h('div.metric-row', h('span.metric', 'LOWEST'), h('span.src', 'If you listed everything at the current floor')),
      h('div.big-number', lowEl),
      h('div.coverage',
        h('span.src', h('b', lowestSource(r)), ', live'),
        h('span.meter', { 'aria-hidden': 'true' }, h('i', { style: { width: `${(t.lowest.priced / Math.max(1, t.lowest.of)) * 100}%` } })),
        h('span', coverageText(t.lowest)),
        deltaChip(delta, code),
      ),
      lowFallback ? h('div.src', lowFallback) : null,
      spark(state.history, r.currency, app),
    ),
    h('div.hero-side',
      h('div',
        h('div.metric-row', h('span.metric.avg', 'AVG'), h('span.src', 'Average of real sales')),
        h('div.mid-number', avgEl),
        h('div.src', h('b', avgSource(r)), `. ${coverageText(t.avg)}.`),
        avgFallback || skewedN
          ? h('div.src', [avgFallback, skewedN ? `${skewedN === 1 ? '1 average is' : `${skewedN} averages are`} skewed by outlier sales.` : null].filter(Boolean).join(' '))
          : null,
      ),
      h('div',
        h('div.metric-row', h('span.metric.net', 'NET'), h('span.src', 'If sold on Steam')),
        h('div.small-number', netEl),
        h('div.src', 'Wallet funds after Valve’s fees, listing at LOWEST.'),
      ),
    ),
  );

  // Top items
  const byKey = new Map(r.stacks.map((x) => [x.key, x]));
  const topStacks = s.top.map((l) => byKey.get(l.key)).filter(Boolean).slice(0, 6);
  const top = topStacks.length
    ? [
        h('div.section-title', h('h2', 'Most valuable'), h('button.btn.ghost', { type: 'button', on: { click: () => app.go('inventory') } }, `All ${plural(s.counts.items, 'item')}`, icon('chevron'))),
        h('div.shelf.top', topStacks.map((st) => tile(st, r, app.openItem))),
      ]
    : null;

  // Exit value
  const inst = t.instant;
  const instantOn = r.demo || state.settings?.buyOrders;
  let instantBody;
  if (inst.priced) {
    instantBody = [
      h('div.small-number', money(inst.value, code)),
      h('div.cap', `Selling into Steam buy orders now, after fees. Covers ${inst.priced} of the most valuable stacks; locked items are left out.`),
    ];
  } else if (inst.otherCurrency) {
    instantBody = [
      h('div.small-number', money(inst.otherValue, inst.otherCurrency)),
      h('div.cap', `Steam quoted buy orders in ${inst.otherCurrency} for your IP region, so this stays out of ${code} totals.`),
    ];
  } else if (!instantOn) {
    instantBody = [
      h('div.small-number', '—'),
      h('div.cap', 'Turn on Steam buy orders in Settings to see what selling instantly would bring.'),
      h('div', h('button.btn', { type: 'button', on: { click: () => app.go('settings', { focus: 'buyOrders' }) } }, 'Open Settings')),
    ];
  } else {
    instantBody = [h('div.small-number', '—'), h('div.cap', 'Steam returned no buy orders for these items.')];
  }

  const cashVenue = s.venues.find((v) => v.id === s.verdict.cash) ?? null;
  const exit = [
    h('div.section-title', h('h2', 'Exit value'), h('span.panel-meta', 'What you could actually take out, and how fast')),
    h('section.panel.exit', { 'aria-label': 'Exit value' },
      h('div', h('div.head', icon('bolt'), 'Instant (net)', h('span.exp', 'Experimental')), instantBody),
      h('div', h('div.head', icon('wallet'), 'Net on Steam'),
        h('div.small-number', money(t.net.value, code)),
        h('div.cap', 'Listing at LOWEST after Valve’s fees. Paid as Steam wallet funds, which can’t be withdrawn.')),
      h('div', h('div.head', icon('cash'), 'Net in cash'),
        cashVenue ? h('div.small-number', money(cashVenue.net, code)) : h('div.small-number', '\u2014'),
        h('div.cap', cashVenue
          ? `On ${cashVenue.name}, the best-paying cash marketplace, after its ${formatPercent(cashVenue.fee ?? 0)} fee. Covers ${cashVenue.priced} of ${cashVenue.of} items.`
          : 'No enabled cash marketplace lists these items.'),
        s.exit.walletPremium != null ? h('div.cap', `Steam wallet premium over Skinport: ${formatSignedPercent(s.exit.walletPremium, 0)} on the same items.`) : null),
      h('div', h('div.head', icon('hourglass'), 'Sellable within 7 days'),
        h('div.ring-wrap', ring(s.exit.sellable7d), h('div.small-number', formatPercent(s.exit.sellable7d ?? 0))),
        h('div.cap', `Of the value at LOWEST, if you capture ${formatPercent(s.exit.captureRate)} of daily sales volume.${s.exit.unknownVolume ? ` ${plural(s.exit.unknownVolume, 'item')} without volume data count as unsold.` : ''}`)),
    ),
  ];

  // By game
  const total = t.lowest.value || t.avg.value || 1;
  const games = s.perGame.filter((g) => g.lowest || g.avg || g.items);
  const byGame = h('section.panel', { 'aria-label': 'Value by game' },
    h('div.panel-head', h('h3.panel-title', 'By game'), h('span.panel-meta', 'at LOWEST')),
    h('div.split-bar', { role: 'img', 'aria-label': games.map((g) => `${gameName(g.appid)} ${share((g.lowest || g.avg) / total)}`).join(', ') },
      games.filter((g) => g.lowest || g.avg).map((g) => h('i', { style: { width: `${((g.lowest || g.avg) / total) * 100}%`, background: gameById(g.appid)?.color ?? '#66c0f4' } }))),
    h('div.game-rows', games.map((g) =>
      h('div.game-row',
        h('span.sw', { style: { background: gameById(g.appid)?.color ?? '#66c0f4' } }),
        h('span.nm', gameName(g.appid), h('small', plural(g.items, 'item'))),
        h('span.pct', share((g.lowest || g.avg) / total)),
        h('span.v', money(g.lowest || g.avg, code)),
      ))),
    r.games.filter((g) => !['ok', 'demo', 'cached'].includes(g.status)).map((g) =>
      h('div.game-row', h('span.sw', { style: { background: 'var(--fill-3)' } }), h('span.nm', g.name, h('small', statusText(g))), h('span.pct'), h('span.v', '—'))),
  );

  // Warnings
  const warnings = h('section.panel', { 'aria-label': 'Warnings' },
    h('div.panel-head', h('h3.panel-title', 'Worth knowing'), h('span.panel-meta', s.warnings.length ? plural(s.warnings.length, 'note') : 'All clear')),
    s.warnings.length
      ? h('div.warn-list', s.warnings.map((w) =>
          h(`button.warn-item.${w.severity === 'warn' ? 'warn' : 'info'}`, { type: 'button', on: { click: () => app.showKeys(w) } },
            h('span.ic', icon(w.severity === 'warn' ? 'warn' : 'info')),
            h('span', h('div.tt', w.title), h('div.dd', w.detail)),
            icon('chevron', 'go'),
          )))
      : h('p.src', 'Every marketable item has a price, and nothing looks unusual.'),
  );

  // Cash-able vs sunk
  const lib = state.library;
  let sunk;
  if (lib?.ok) {
    sunk = [
      h('div.small-number', money(lib.totals.current, lib.currency)),
      h('div.cap', `What the ${plural(lib.totals.priced, 'paid game')} would cost to buy again today on the Steam store.`),
      h('div', h('button.btn.ghost', { type: 'button', on: { click: () => app.go('library') } }, 'Open library', icon('chevron'))),
    ];
  } else if (lib && lib.reason === 'needs-key') {
    sunk = [
      h('div.small-number', '—'),
      h('div.cap', 'Add a free Steam Web API key to see the library’s replacement cost.'),
      h('div', h('button.btn', { type: 'button', on: { click: () => app.go('library') } }, 'How to enable it')),
    ];
  } else if (lib) {
    sunk = [h('div.small-number', '—'), h('div.cap', lib.message ?? 'The library is unavailable.')];
  } else {
    sunk = [h('div.skel', { style: { width: '160px', height: '22px' } }), h('div.cap', 'Loading the library…')];
  }
  const account = h('section.panel.account', { 'aria-label': 'Cash-able and sunk value' },
    h('section',
      h('div.lbl', 'Cash-able: inventory'),
      h('div.small-number', money(t.lowest.value, code)),
      h('div.cap', 'Marketable items at LOWEST. Items can be sold on their own.'),
    ),
    h('div.vs', h('span', 'kept apart')),
    h('section', h('div.lbl', 'Sunk: library replacement cost'), sunk),
    h('div.account-note', 'Steam accounts can’t be sold under the Steam Subscriber Agreement, so Glasscase never adds these into one “account worth”.'),
  );

  // Trade locks
  const locks = s.locks.length
    ? h('section.panel', { 'aria-label': 'Trade locks' },
        h('div.panel-head', h('h3.panel-title', 'Trade locks'), h('span.panel-meta', h('span', 'Locked now: '), money(s.lockedValue, code))),
        h('div.locks', s.locks.map((l) => {
          const d = new Date(l.until);
          const names = l.keys.map((k) => byKey.get(k)?.name).filter(Boolean);
          return h('div.lock-row',
            h('div.lock-day', h('small', d.toLocaleString('en-US', { month: 'short' })), h('b', String(d.getDate()))),
            h('div.what', h('div.t', names.join(', ')), h('div.s', `${holdText(l.until)}, ${plural(l.count, 'item')}. Not counted in Instant.`)),
            h('span.v', money(l.value, code)),
          );
        })),
      )
    : null;

  // By marketplace: every enabled venue on the items the totals use.
  const walletVenue = s.venues.find((v) => v.kind === 'wallet') ?? null;
  const best = s.verdict.bestCash;
  const split = Object.entries(best.byVenue).sort((a, b) => b[1] - a[1]).map(([id, n]) => `${venueShort(id)} for ${n}`).join(', ');
  const fxLine = fxNote(r.fx, code);
  const byVenue = s.venues.length
    ? [
        h('div.section-title', h('h2', 'By marketplace'), h('span.panel-meta', 'Each floor, and what you keep after that marketplace\u2019s fee')),
        h('section.panel.venues', { 'aria-label': 'Value by marketplace' },
          h('div.vrow.vhead', { role: 'row' }, h('span', 'Marketplace'), h('span', 'Paid in'), h('span.r', 'Items'), h('span.r', 'At floor'), h('span.r', 'Fee'), h('span.r', 'Net')),
          s.venues.map((v) => h(`div.vrow${v.id === s.verdict.cash ? '.top-cash' : ''}${v.kind === 'wallet' ? '.wallet' : ''}`, { role: 'row' },
            h('span.vname', h('b', v.name), v.id === s.verdict.cash ? h('span.vbadge.cash', 'Most cash') : null),
            h('span', h(`span.kind.${v.kind}`, v.kind === 'wallet' ? 'Wallet funds' : 'Cash')),
            h('span.r', `${v.priced} of ${v.of}`),
            h('span.r', money(v.total, code)),
            h('span.r.muted', v.kind === 'wallet' ? '15%' : formatPercent(v.fee ?? 0)),
            h('span.r.net', money(v.net, code)),
          )),
          h('div.vfoot',
            cashVenue && walletVenue
              ? h('p', h('b', `Worth most in cash on ${cashVenue.name}`), `: ${formatMoney(cashVenue.net, code)} after fees for ${cashVenue.priced} items. In Steam wallet funds: ${formatMoney(walletVenue.net, code)} for ${walletVenue.priced} items, which can only be spent on Steam.`)
              : null,
            best.priced ? h('p', `Selling each item wherever it nets most in cash would bring ${formatMoney(best.value, code)} (${split}).`) : null,
            h('p.muted', `Marketplaces list different items, so compare the item counts too.${fxLine ? ` ${fxLine}` : ''}`),
          ),
        ),
      ]
    : null;

  // Which sources the totals actually used
  const mixRow = (pillCls, metric, label, n) => (n ? h('div.mix-row', h(`span.metric${pillCls}`, metric), h('span.lbl', label), h('span.n', plural(n, 'item'))) : null);
  const lowRows = Object.entries(s.mix.lowest).sort((a, b) => b[1] - a[1]).map(([k, n]) => {
    const fb = k.endsWith('-fallback');
    const id = k.replace(/-fallback$/, '');
    return mixRow('', 'LOWEST', `${venueShort(id)} floor${fb ? ', as fallback' : ''}`, n);
  });
  const avgRows = Object.entries(s.mix.avg).sort((a, b) => b[1] - a[1]).map(([k, n]) => {
    const [id, metric] = k.split('-');
    const primary = id === (r.avgSource ?? 'skinport') && metric === 'avg';
    const label = metric === 'median' ? `${venueShort(id)} median 24 h` : `${venueShort(id)} ${r.avgMode === 'trimmed' ? 'trimmed avg' : 'avg'}, ${windowLabelText(r.window)}`;
    return mixRow('.avg', 'AVG', primary ? label : `${label}, as fallback`, n);
  });
  const sources = h('section.panel', { 'aria-label': 'Sources used' },
    h('div.panel-head', h('h3.panel-title', 'Sources used'), h('span.panel-meta', r.demo ? `Snapshot of ${formatDate(Date.parse(r.snapshot))}` : `${code}, ${relativeTime(r.scannedAt)}`)),
    h('div.mix', lowRows, avgRows, mixRow('.instant', 'INSTANT', 'Steam buy orders', t.instant.priced)),
  );

  const scanned = r.demo ? `Demo snapshot from ${formatDate(Date.parse(r.snapshot))}` : `Scanned ${relativeTime(r.scannedAt)}`;
  const el = h('div.page',
    noticeEls,
    profile,
    hero,
    top,
    exit,
    byVenue,
    h('div.section-title', h('h2', 'Breakdown'), h('span.panel-meta', `${scanned}, prices in ${code}`)),
    h('div.grid-2.top-align', h('div.stack', byGame, sources, locks), warnings),
    h('div.section-title', h('h2', 'Account'), h('span.panel-meta', 'Cash-able and sunk value, side by side')),
    account,
  );

  return {
    el,
    title: p.name,
    mounted: () => {
      countUp(lowEl, prev ? prev.lowest : 0, t.lowest.value, code, { duration: 1300 });
      countUp(avgEl, prev ? prev.avg : 0, t.avg.value, code, { duration: 1300 });
      countUp(netEl, prev ? prev.net : 0, t.net.value, code, { duration: 1300 });
      state.prevTotals = { lowest: t.lowest.value, avg: t.avg.value, net: t.net.value, currency: code };
      if (!state.library && !state.libraryLoading) app.loadLibrary();
    },
  };
}

// A quiet trend line under the LOWEST total.
function spark(history, code, app) {
  const entries = (history ?? []).filter((e) => e.currency === code && Number.isFinite(e.lowest)).sort((a, b) => a.at - b.at);
  if (entries.length < 2) return null;
  const W = 600;
  const H = 96;
  const t0 = entries[0].at;
  const t1 = entries[entries.length - 1].at;
  const vals = entries.map((e) => e.lowest);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v) => 10 + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - 20);
  const pts = entries.map((e) => [x(e.at), y(e.lowest)]);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const line = smoothPath(pts);
  svg.innerHTML = '<defs><linearGradient id="spk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a9fff" stop-opacity=".28"/><stop offset="1" stop-color="#1a9fff" stop-opacity="0"/></linearGradient></defs>';
  const area = document.createElementNS(ns, 'path');
  area.setAttribute('d', `${line} L${W},${H} L0,${H} Z`);
  area.setAttribute('fill', 'url(#spk)');
  const stroke = document.createElementNS(ns, 'path');
  stroke.setAttribute('d', line);
  stroke.setAttribute('class', 'spark-line');
  svg.append(area, stroke);
  const first = new Date(t0).toLocaleString('en-US', { month: 'short', year: 'numeric' });
  return h('button.spark', { type: 'button', title: 'Open History', on: { click: () => app.go('history') } },
    svg,
    h('span.spark-cap', h('span', `Since ${first}`), h('span', `${entries.length} scans`)),
  );
}

function share(f) {
  return f > 0 && f < 0.005 ? '<1%' : formatPercent(f);
}

function statusText(g) {
  return {
    private: 'private',
    'rate-limited': 'rate-limited',
    error: 'unavailable',
    empty: 'empty',
    stale: 'cached',
  }[g.status] ?? g.status;
}

