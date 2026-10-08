// Onboarding: paste a profile, open a recent one, or try the demo.

import { h, fill } from '../dom.js';
import { icon } from '../icons.js';
import { avatar } from '../dom.js';
import { parseProfileInput } from '../../../core/profile-input.js';
import { relativeTime } from '../../../core/format.js';

const NEUTRAL_HINT = 'Works with profile links, SteamID64, custom URLs, STEAM_0:X:Y and [U:1:N] ids, and friend codes.';

function describe(ref) {
  if (ref.kind === 'vanity') return `Custom URL "${ref.value}"`;
  const via = { steam2: 'from a STEAM_X:Y:Z id', steam3: 'from a [U:1:N] id', friendcode: 'from a friend code', invite: 'from an invite link', url: 'from the link', id64: '' }[ref.via] ?? '';
  return `SteamID64 ${ref.value} ${via}`.trim();
}

export function renderHome({ state, app }) {
  const hint = h('div.paste-hint', { 'aria-live': 'polite' });
  const setHint = (kind, text) => {
    hint.className = `paste-hint ${kind}`;
    fill(hint, kind === 'ok' ? icon('check') : kind === 'bad' ? icon('warn') : '', h('span', text));
  };

  const input = h('input', {
    type: 'text',
    value: state.homeInput ?? '',
    placeholder: 'Paste a profile link, SteamID64 or custom URL',
    'aria-label': 'Steam profile',
    spellcheck: 'false',
    autocomplete: 'off',
    on: {
      input: () => {
        state.homeInput = input.value;
        const v = input.value.trim();
        if (!v) return setHint('', NEUTRAL_HINT);
        const ref = parseProfileInput(v);
        if (ref.ok) setHint('ok', describe(ref));
        else setHint('', NEUTRAL_HINT);
      },
      keydown: (e) => {
        if (e.key === 'Enter') submit();
      },
    },
  });

  const submit = () => {
    const v = input.value.trim();
    const ref = parseProfileInput(v);
    if (!ref.ok) {
      setHint('bad', ref.error);
      input.focus();
      return;
    }
    app.startScan({ input: v });
  };

  if (input.value) input.dispatchEvent(new Event('input'));
  else setHint('', NEUTRAL_HINT);

  const err = state.scanError;
  const errorCard = err
    ? h('div.notice.error', { role: 'alert' },
        icon(err.kind === 'rate-limit' ? 'clock' : 'warn'),
        h('div', { style: { display: 'grid', gap: '8px' } },
          h('span', err.message),
          state.lastRequest && !state.lastRequest.demo
            ? h('div', h('button.btn', { type: 'button', on: { click: () => app.startScan(state.lastRequest) } }, icon('refresh'), 'Retry'))
            : null,
        ),
      )
    : null;

  const recent = state.recent?.length
    ? h('section.recent', { 'aria-label': 'Recent profiles' },
        h('h2', 'Recent profiles'),
        h('div.recent-list',
          state.recent.slice(0, 6).map((r) =>
            h('div.recent-item', { role: 'button', tabindex: '0', on: {
              click: (e) => {
                if (e.target.closest('.x')) return;
                app.startScan({ input: r.steamid });
              },
              keydown: (e) => {
                if (e.key === 'Enter' && !e.target.closest('.x')) app.startScan({ input: r.steamid });
              },
            } },
              avatar(r),
              h('div.t', h('span.n', r.name ?? r.steamid), h('span.s', `Scanned ${relativeTime(r.at)}`)),
              h('button.x', { type: 'button', 'aria-label': `Remove ${r.name ?? r.steamid} from recent profiles`, on: { click: () => app.removeRecent(r.steamid) } }, icon('close')),
            ),
          ),
        ),
      )
    : null;

  const shelf = state.info?.showcase?.length
    ? h('div.shelf-deco', { 'aria-hidden': 'true' },
        h('div.row', state.info.showcase.map((s) => {
          const img = h('img', { src: `app://glasscase/img/econ/${s.iconUrl}/256`, alt: '', draggable: 'false' });
          const piece = h('div.piece', { style: { '--rarity': s.color } }, img);
          img.addEventListener('error', () => piece.remove(), { once: true });
          return piece;
        })),
      )
    : h('div');

  const el = h('div.home',
    h('div.home-center',
      h('img.home-mark', { src: 'app://glasscase/renderer/img/icon.svg', alt: '' }),
      h('h1.home-title', 'Value any Steam inventory.'),
      h('p.home-lede', 'Paste a profile. Glasscase prices every item at its current floor and at the average of real sales, and shows where each number comes from.'),
      h('div.paste', icon('user'), input, h('button.btn.primary', { type: 'button', on: { click: submit } }, 'Scan')),
      hint,
      errorCard,
      h('div.home-actions',
        h('button.btn', { type: 'button', on: { click: () => app.startScan({ demo: true }) } }, icon('sparkles'), 'Try the demo'),
        h('span.or', 'Offline, with real items and prices from a fictional profile.'),
      ),
      recent,
    ),
    h('div',
      shelf,
      h('p.home-foot', 'Free and open source. Not affiliated with Valve or Steam. Prices are informational.'),
    ),
  );

  return {
    el,
    title: 'Glasscase',
    mounted: () => {
      if (!state.scanning) input.focus();
    },
  };
}
