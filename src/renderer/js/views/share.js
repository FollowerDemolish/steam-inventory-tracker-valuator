// Share card: pick a layout and theme, hide personal details, save a PNG.

import { h, segmented, toggle } from '../dom.js';
import { icon } from '../icons.js';
import { renderCard, THEMES, LAYOUTS } from '../share-card.js';

export function renderShare({ state, app }) {
  const r = state.result;
  const opts = state.share;
  const canvas = h('canvas', { 'aria-label': 'Share card preview', role: 'img' });
  let drawing = Promise.resolve();
  const redraw = () => {
    drawing = drawing.then(() => renderCard(canvas, r, opts)).catch((err) => console.error(err));
    return drawing;
  };

  const swatches = h('div.swatches', { role: 'radiogroup', 'aria-label': 'Theme' },
    Object.entries(THEMES).map(([id, t]) => {
      const b = h('button.swatch', {
        type: 'button', role: 'radio', 'aria-checked': String(opts.theme === id),
        on: { click: () => {
          opts.theme = id;
          for (const x of swatches.children) x.setAttribute('aria-checked', String(x === b));
          redraw();
        } },
      }, h('i', { style: { background: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})` } }), t.name);
      return b;
    }));

  const save = async () => {
    await redraw();
    const who = opts.privacy ? 'private' : (r.profile.name || 'card').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const name = `glasscase-${who}-${opts.layout}-${opts.theme}.png`;
    const res = await app.api.share.save({ dataUrl: canvas.toDataURL('image/png'), name });
    if (res.saved) app.toast(`Saved ${res.path.split(/[\\/]/).pop()}`);
    else if (!res.canceled) app.toast(res.message ?? 'The card was not saved.', 'warn');
    return res;
  };

  const el = h('div.page',
    h('div.page-head', h('div', h('h1.large-title', 'Share card'), h('p.page-sub', 'A PNG report card for your inventory. Everything is drawn on this computer.'))),
    h('div.share-wrap',
      h('div.share-stage', canvas),
      h('section.panel.share-controls', { 'aria-label': 'Card options' },
        h('div.grp', h('span.lbl', 'Layout'),
          segmented(Object.entries(LAYOUTS).map(([value, l]) => ({ value, label: l.name })), opts.layout, (v) => { opts.layout = v; redraw(); }, 'Layout')),
        h('div.grp', h('span.lbl', 'Theme'), swatches),
        h('div.grp', h('span.lbl', 'Marketplaces'),
          toggle('Show a net-by-venue line', opts.venueLine !== false, (v) => { opts.venueLine = v; redraw(); })),
        h('div.grp', h('span.lbl', 'Privacy'),
          toggle('Hide name, avatar and ID', opts.privacy, (v) => { opts.privacy = v; redraw(); }),
          h('p.src', 'Use this when posting publicly. Item names and totals stay visible.')),
        h('button.btn.primary.large', { type: 'button', on: { click: save } }, icon('download'), 'Save PNG…'),
        h('p.src', 'Cards say where prices come from and that they are informational.'),
      ),
    ),
  );

  return { el, title: 'Share card', mounted: redraw, save, redraw };
}
