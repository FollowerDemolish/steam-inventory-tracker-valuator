// Settings: prices, exit value, games, optional credentials and local data.

import { h, segmented, toggle } from '../dom.js';
import { icon } from '../icons.js';
import { CURRENCIES } from '../../../core/currencies.js';
import { GAMES, parseCustomContext, gameName } from '../../../core/games.js';
import { formatBytes } from '../../../core/format.js';
import { VENUES } from '../../../core/venues.js';

function row(title, desc, control, id) {
  return h('div.srow', { id },
    h('div', h('div.t', title), desc ? h('div.d', desc) : null),
    h('div.ctl', control));
}

function select(options, value, onChange, label) {
  const el = h('select.field', { 'aria-label': label, on: { change: (e) => onChange(e.target.value) } },
    options.map(([v, l]) => h('option', { value: String(v) }, l)));
  el.value = String(value);
  return el;
}

function secretRow({ title, desc, has, masked, placeholder, onSave, onRemove, extra, id }) {
  const input = h('input.field.secret', { type: 'password', placeholder: has ? masked : placeholder, 'aria-label': title, autocomplete: 'off', spellcheck: 'false' });
  const saveBtn = h('button.btn', { type: 'button', on: { click: async () => {
    const v = input.value.trim();
    if (!v) return input.focus();
    await onSave(v);
    input.value = '';
  } } }, 'Save');
  return row(title, desc, [
    input,
    saveBtn,
    extra,
    has ? h('button.btn.ghost.danger', { type: 'button', 'aria-label': `Remove ${title}`, on: { click: onRemove } }, icon('trash')) : null,
  ], id);
}

export function renderSettings({ state, app }) {
  const s = state.settings;
  const sec = state.secrets;
  const info = state.info ?? {};
  const set = (patch) => app.updateSettings(patch);

  const gamesPick = h('div.games-pick', { role: 'group', 'aria-label': 'Games to scan' },
    GAMES.map((g) => {
      const on = s.games.includes(g.appid);
      return h('button.pick', {
        type: 'button', role: 'checkbox', 'aria-checked': String(on),
        on: { click: () => set({ games: on ? s.games.filter((x) => x !== g.appid) : [...s.games, g.appid] }) },
      }, on ? icon('check') : null, g.short);
    }),
    s.customContexts.map((c) => h('button.pick', {
      type: 'button', role: 'checkbox', 'aria-checked': 'true', title: 'Remove this custom inventory',
      on: { click: () => set({ customContexts: s.customContexts.filter((x) => !(x.appid === c.appid && x.contextid === c.contextid)) }) },
    }, icon('check'), `${gameName(c.appid)} ${c.appid}/${c.contextid}`)),
  );
  const customInput = h('input.field', { placeholder: 'appid/contextid', 'aria-label': 'Custom inventory, as appid/contextid', style: { width: '140px' } });
  const addCustom = () => {
    const c = parseCustomContext(customInput.value);
    if (!c) return app.toast('Use the form appid/contextid, for example 232090/2.', 'warn');
    set({ customContexts: [...s.customContexts, c] });
  };

  const dataMode = {
    'portable-exe': 'Portable: stored next to the .exe.',
    appimage: 'Portable: stored next to the AppImage.',
    'user-data': 'Stored in your user profile.',
    custom: 'Custom folder for this run.',
  }[info.dataMode] ?? '';

  const el = h('div.page',
    h('div.page-head', h('div', h('h1.large-title', 'Settings'), h('p.page-sub', 'Everything stays on this computer. Glasscase has no accounts and sends no telemetry.'))),
    h('div.settings',
      h('section.group',
        h('h2', 'Prices'),
        h('div.panel',
          row('Currency', 'Prices are requested in this currency. Changing it rescans.',
            select(CURRENCIES.map((c) => [c.code, `${c.code}, ${c.name}`]), s.currency, (v) => set({ currency: v }), 'Currency')),
          row('LOWEST from', 'Steam floor is the default and falls back to Skinport, labelled. Best floor takes each item\u2019s cheapest listing across the enabled marketplaces, mixing wallet and cash venues with each number labelled.',
            select([['steam', 'Steam floor'], ['best', 'Best floor across marketplaces'], ['skinport', 'Skinport floor'], ['waxpeer', 'Waxpeer floor'], ['marketcsgo', 'Market.CSGO floor'], ['lisskins', 'Lis-skins floor']], s.lowestSource, (v) => set({ lowestSource: v }), 'LOWEST from')),
          row('AVG from', 'Skinport sales by default. Steam sales need the optional login cookie; without it AVG falls back to the Steam 24 h median, labelled.',
            segmented([{ value: 'skinport', label: 'Skinport sales' }, { value: 'steam', label: 'Steam sales' }], s.avgSource, (v) => set({ avgSource: v }), 'AVG from')),
          row('AVG window', 'How far back AVG averages actual sales.',
            segmented([{ value: '24h', label: '24 h' }, { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }, { value: '90d', label: '90 days' }], s.window, (v) => set({ window: v }), 'AVG window')),
          row('AVG method', 'Trimmed drops the single highest and lowest sale in the window, which tames outliers. It is always labelled as trimmed.',
            segmented([{ value: 'mean', label: 'Mean' }, { value: 'trimmed', label: 'Trimmed mean' }], s.avgMode, (v) => set({ avgMode: v }), 'AVG method')),
          row('Steam floor lookups per scan', 'Steam answers about 20 price requests a minute. The most valuable items go first; the rest use the Skinport floor, labelled, and fill in from the cache on later scans.',
            select([[20, '20 items'], [40, '40 items'], [80, '80 items'], [150, '150 items']], s.steamFloorLimit, (v) => set({ steamFloorLimit: Number(v) }), 'Steam floor lookups per scan')),
        ),
      ),
      h('section.group',
        h('h2', 'Exit value'),
        h('div.panel',
          row('Steam buy orders (experimental)', 'Reads Steam’s undocumented order book for your most valuable items to estimate Instant (net). Cached for an hour, stops at the first rate limit. Steam picks its currency from your IP region.',
            toggle('Use Steam buy orders', s.buyOrders, (v) => set({ buyOrders: v })), 'buyOrders'),
          row('Items to check for buy orders', null,
            select([[10, '10 items'], [15, '15 items'], [25, '25 items'], [50, '50 items']], s.buyOrdersTopN, (v) => set({ buyOrdersTopN: Number(v) }), 'Items to check for buy orders')),
          row('Share of daily volume you can sell', 'Days to sell assume you capture this share of each item’s daily sales.',
            select([[0.05, '5%'], [0.1, '10%'], [0.2, '20%'], [0.5, '50%']], s.captureRate, (v) => set({ captureRate: Number(v) }), 'Share of daily volume')),
        ),
      ),
      h('section.group',
        h('h2', 'Marketplaces'),
        h('div.panel',
          VENUES.filter((v) => v.role === 'floor' && !v.always).map((v) => row(
            v.name,
            `${v.access}. ${v.coverage}. Seller fee is an assumption; check ${v.name}\u2019s own fee page.`,
            [
              select([[0.02, '2% fee'], [0.03, '3% fee'], [0.05, '5% fee'], [0.06, '6% fee'], [0.07, '7% fee'], [0.08, '8% fee'], [0.1, '10% fee'], [0.12, '12% fee'], [0.15, '15% fee']], s.fees[v.id], (val) => set({ fees: { ...s.fees, [v.id]: Number(val) } }), `${v.name} seller fee`),
              toggle(`Use ${v.name}`, s.venues[v.id], (on) => set({ venues: { ...s.venues, [v.id]: on } })),
            ],
            `venue-${v.id}`,
          )),
          row('CSFloat sales (experimental)', `${VENUES.find((v) => v.id === 'csfloat').access}. CS2 daily sales averages for your most valuable items, used as a second AVG source when Skinport has no sales. They include float and sticker premiums.`,
            toggle('Use CSFloat sales', s.venues.csfloat, (on) => set({ venues: { ...s.venues, csfloat: on } }))),
          row('Items to check on CSFloat', null,
            select([[5, '5 items'], [10, '10 items'], [20, '20 items'], [40, '40 items']], s.csfloatTopN, (v) => set({ csfloatTopN: Number(v) }), 'Items to check on CSFloat')),
          row('Exchange rates', 'Waxpeer, Market.CSGO, Lis-skins and CSFloat quote in USD. Other currencies are converted with free daily rates from open.er-api.com, cached for 12 hours, and the rate is shown wherever it is used.', null),
        ),
      ),
      h('section.group',
        h('h2', 'Games'),
        h('div.panel',
          row('Inventories to scan', 'Each game is one request to Steam, so fewer games means fewer rate limits.', gamesPick),
          row('Custom inventory', 'Any other game with tradable items, as appid/contextid.',
            [customInput, h('button.btn', { type: 'button', on: { click: addCustom } }, 'Add')]),
        ),
      ),
      h('section.group',
        h('h2', 'Optional keys'),
        h('div.panel',
          secretRow({
            id: 'apiKey',
            title: 'Steam Web API key',
            desc: h('span', 'Unlocks library value, Steam level, bans and account age. Free from ', h('a', { on: { click: () => app.openExternal('https://steamcommunity.com/dev/apikey') } }, 'steamcommunity.com/dev/apikey'), '. Stored in the data folder and never logged.'),
            has: sec.hasApiKey, masked: sec.apiKey, placeholder: 'Paste your key',
            onSave: (v) => app.setSecret('apiKey', v),
            onRemove: () => app.setSecret('apiKey', ''),
            extra: sec.hasApiKey ? h('button.btn.ghost', { type: 'button', on: { click: () => app.checkKey() } }, 'Check') : null,
          }),
          secretRow({
            id: 'cookie',
            title: 'Steam login cookie',
            desc: 'Paste the steamLoginSecure cookie from your browser to unlock Steam’s own sales averages. It is a full session credential: it stays in the data folder, is sent only to steamcommunity.com, and is never logged. Remove it any time.',
            has: sec.hasCookie, masked: sec.cookie, placeholder: 'steamLoginSecure value',
            onSave: (v) => app.setSecret('cookie', v),
            onRemove: () => app.setSecret('cookie', ''),
          }),
        ),
      ),
      h('section.group',
        h('h2', 'Data'),
        h('div.panel',
          row('Data folder', dataMode, [h('span.path', { title: info.dataDir }, info.dataDir ?? ''), h('button.btn', { type: 'button', on: { click: () => app.api.data.openFolder() } }, icon('folder'), 'Open')]),
          row('Cache', 'Inventories are cached for 10 minutes, prices for 1 to 6 hours, images until cleared.',
            [h('span.src', state.cacheBytes != null ? formatBytes(state.cacheBytes) : '…'), h('button.btn', { type: 'button', on: { click: () => app.clearCache() } }, 'Clear cache')]),
          row('Scan history', 'Every scan is kept locally for the History chart.',
            h('button.btn.danger', { type: 'button', on: { click: () => app.clearHistory(true) } }, 'Clear all history')),
          row('Motion', 'Reduced turns off count-ups, springs and shimmer.',
            segmented([{ value: 'system', label: 'System' }, { value: 'reduce', label: 'Reduced' }, { value: 'full', label: 'Full' }], s.motion, (v) => set({ motion: v }), 'Motion')),
        ),
      ),
      h('p.about',
        `Glasscase ${info.version ?? ''}. Free and open source under the MIT license. Not affiliated with Valve or Steam; Steam and the Steam logo are trademarks of Valve Corporation. Prices are informational and can be wrong. Inter typeface by Rasmus Andersson, SIL Open Font License.`),
    ),
  );

  return {
    el,
    title: 'Settings',
    mounted: () => {
      app.refreshCacheSize();
      if (state.settingsFocus) {
        const target = el.querySelector(`#${state.settingsFocus}`);
        state.settingsFocus = null;
        if (target) {
          target.scrollIntoView({ block: 'center' });
          target.querySelector('input, button, select')?.focus();
        }
      }
    },
  };
}
