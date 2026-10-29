// Library: replacement cost of owned games. Needs the optional free Web API key.

import { h, money, plural } from '../dom.js';
import { icon } from '../icons.js';
import { formatNumber, formatMoney } from '../../../core/format.js';
import { sortLibrary } from '../../../core/library.js';

function explainer(app, reason, message) {
  if (reason === 'needs-key') {
    return h('section.panel.explainer',
      h('h2.panel-title', 'Turn on library value with a free key'),
      h('p.src', { style: { 'margin-top': '6px' } }, 'Steam only lists a profile’s games through its Web API, which needs a personal key. The key is free, takes a minute, and stays on this computer.'),
      h('ol.steps',
        h('li', h('span', h('b', 'Open Steam’s key page'), ' while signed in to Steam in your browser.')),
        h('li', h('span', h('b', 'Register a key.'), ' Any domain name works, for example ', h('b', 'localhost'), '. Accept the Steam Web API terms.')),
        h('li', h('span', h('b', 'Paste the key in Settings'), ' under Steam Web API key. Glasscase stores it in its data folder and never logs it.')),
        h('li', h('span', h('b', 'Make game details public'), ' for the profile you scan (Steam > Edit profile > Privacy settings), or the list comes back empty.')),
      ),
      h('div', { style: { display: 'flex', gap: '8px' } },
        h('button.btn.primary', { type: 'button', on: { click: () => app.openExternal('https://steamcommunity.com/dev/apikey') } }, icon('external'), 'Open the key page'),
        h('button.btn', { type: 'button', on: { click: () => app.go('settings', { focus: 'apiKey' }) } }, icon('key'), 'Add key in Settings'),
      ),
    );
  }
  return h('div.empty',
    h('h3', reason === 'private' ? 'Game details are private' : 'Library unavailable'),
    h('p', message ?? 'Steam did not return the library.'),
    h('div.actions', h('button.btn', { type: 'button', on: { click: () => app.loadLibrary(true) } }, icon('refresh'), 'Try again')),
  );
}

export function renderLibrary({ state, app }) {
  const lib = state.library;
  const head = h('div.page-head',
    h('div', h('h1.large-title', 'Library'), h('p.page-sub', 'Replacement cost: what the games would cost to buy again today on the Steam store.')),
  );

  if (!lib) {
    if (!state.libraryLoading) app.loadLibrary();
    return {
      el: h('div.page', head, h('section.panel.lib-stats', Array.from({ length: 4 }, () => h('div', h('div.skel', { style: { width: '90px', height: '13px' } }), h('div.skel', { style: { width: '140px', height: '24px' } })))),
        h('div.games', { style: { 'margin-top': '16px' } }, Array.from({ length: 8 }, () => h('div.game', h('div.skel', { style: { width: '116px', height: '44px' } }), h('div.skel', { style: { width: '70%', height: '13px' } }), h('div.skel', { style: { width: '50px', height: '13px' } }))))),
      title: 'Library',
    };
  }
  if (!lib.ok) return { el: h('div.page', head, explainer(app, lib.reason, lib.message)), title: 'Library' };

  const t = lib.totals;
  const code = lib.currency;
  const sort = state.librarySort ?? 'value';
  const games = sortLibrary(lib.games, sort);

  const sortSel = h('select.field', { 'aria-label': 'Sort games', on: { change: (e) => { state.librarySort = e.target.value; app.render(); } } },
    h('option', { value: 'value' }, 'Sort: Price'),
    h('option', { value: 'hours' }, 'Sort: Hours played'),
    h('option', { value: 'name' }, 'Sort: Name'));
  sortSel.value = sort;

  const el = h('div.page',
    head,
    lib.demo ? h('div.notices', h('div.notice', icon('sparkles'), h('span', 'Demo library: real games and store prices, with made-up playtime.'))) : null,
    lib.note ? h('div.notices', h('div.notice', icon('info'), h('span', lib.note))) : null,
    h('section.panel.lib-stats', { 'aria-label': 'Library totals' },
      h('div', h('span.lbl', 'Replacement cost today'), h('div.small-number', money(t.current, code)), h('span.cap', `${plural(t.priced, 'paid game')}, current store prices`)),
      h('div', h('span.lbl', 'At full price'), h('div.small-number', money(t.full, code)), h('span.cap', 'Without today’s discounts')),
      h('div', h('span.lbl', 'Games'), h('div.small-number', formatNumber(t.games)), h('span.cap', `${t.free} free to play${t.unpriced ? `, ${t.unpriced} not on sale` : ''}`)),
      h('div', h('span.lbl', 'Time played'), h('div.small-number', `${formatNumber(Math.round(t.hours))} h`), h('span.cap', t.perHour != null ? `${formatMoney(Math.round(t.perHour), code)} per hour at full price` : 'No playtime recorded')),
    ),
    h('div.section-title', h('h2', plural(lib.games.length, 'game')), sortSel),
    h('div.games', games.map((g) => {
      const ph = h('div.cap-ph', g.name);
      const img = h('img.cap-img', { src: `app://glasscase/img/app/${g.appid}/capsule`, alt: '', loading: 'lazy' });
      img.addEventListener('error', () => img.replaceWith(ph), { once: true });
      return h('div.game',
        img,
        h('div', { style: { 'min-width': '0' } }, h('div.nm', g.name), h('div.hrs', `${formatNumber(g.hours, 1)} h played`)),
        h('div.pr',
          g.price
            ? [h('b', money(g.price.final, g.price.currency ?? code)), g.price.discount ? h('s', formatMoney(g.price.initial, g.price.currency ?? code)) : null]
            : g.free ? h('span.free', 'Free') : h('span.hrs', 'Not on sale')),
      );
    })),
    h('p.about', { style: { 'margin-top': '18px' } }, 'Steam accounts can’t be sold under the Steam Subscriber Agreement. Replacement cost shows what the games are worth to you, and is never added to the inventory value.'),
  );
  return { el, title: 'Library' };
}
