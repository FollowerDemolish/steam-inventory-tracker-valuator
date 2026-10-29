// History: every scan saved locally, charted over time with market events.

import { h, money, plural, fill } from '../dom.js';
import { icon } from '../icons.js';
import { formatDate, formatMoney, formatSignedMoney, formatSignedPercent } from '../../../core/format.js';
import { historyDelta, MARKET_EVENTS } from '../../../core/report.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const kid of kids) if (kid) el.append(kid);
  return el;
};

function niceTicks(min, max, count = 4) {
  const span = max - min || Math.abs(max) || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= step0) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(v);
  return out;
}

// Monotone cubic interpolation (Fritsch-Carlson): smooth, but never
// overshoots, so a sharp drop is drawn as a drop and not as a spike.
export function smoothPath(pts) {
  const n = pts.length;
  if (n < 2) return n ? `M${pts[0][0]},${pts[0][1]}` : '';
  const dx = [];
  const m = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    m.push(dx[i] > 0 ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0);
  }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0 || dx[i - 1] <= 0 || dx[i] <= 0) t.push(0);
    else t.push((3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]));
  }
  t.push(m[n - 2]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h3 = dx[i] / 3;
    d += ` C${x0 + h3},${y0 + t[i] * h3} ${x1 - h3},${y1 - t[i + 1] * h3} ${x1},${y1}`;
  }
  return d;
}

export function chart(entries, code, { width = 1000, height = 300 } = {}) {
  const wrap = h('div.chart');
  const pad = { l: 8, r: 64, t: 34, b: 28 };
  const W = width;
  const H = height;
  const xs = entries.map((e) => e.at);
  const vals = entries.flatMap((e) => [e.lowest, e.avg]).filter(Number.isFinite);
  const t0 = Math.min(...xs);
  const t1 = Math.max(...xs);
  const ticks = niceTicks(Math.min(...vals) * 0.96, Math.max(...vals) * 1.03);
  const vMin = ticks[0];
  const vMax = ticks[ticks.length - 1];
  const x = (t) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - vMin) / Math.max(1, vMax - vMin)) * (H - pad.t - pad.b);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Inventory value over time, ${entries.length} scans` });
  const defs = s('defs');
  const grad = s('linearGradient', { id: 'area', x1: 0, y1: 0, x2: 0, y2: 1 },
    s('stop', { offset: '0', 'stop-color': '#1a9fff', 'stop-opacity': '0.32' }),
    s('stop', { offset: '1', 'stop-color': '#1a9fff', 'stop-opacity': '0' }));
  defs.append(grad);
  svg.append(defs);

  const grid = s('g', { class: 'grid' });
  const axis = s('g', { class: 'axis' });
  for (const v of ticks) {
    grid.append(s('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }));
    const label = s('text', { x: W - pad.r + 10, y: y(v) + 4 });
    label.textContent = formatMoney(v, code, { compact: true });
    axis.append(label);
  }
  // Month labels
  const months = [];
  const d = new Date(t0);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  while (d.getTime() <= t1) {
    if (d.getTime() >= t0) months.push(d.getTime());
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  const every = Math.max(1, Math.ceil(months.length / 8));
  months.forEach((m, i) => {
    if (i % every) return;
    const tx = s('text', { x: x(m), y: H - 6, 'text-anchor': 'middle' });
    const dt = new Date(m);
    tx.textContent = dt.getUTCMonth() === 0 || i === 0 ? dt.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : dt.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    axis.append(tx);
  });
  svg.append(grid, axis);

  // Market events
  const evG = s('g');
  MARKET_EVENTS.filter((e) => e.at >= t0 && e.at <= t1).forEach((e, i) => {
    const ex = x(e.at);
    const g = s('g', { class: 'event' });
    g.append(s('line', { x1: ex, x2: ex, y1: pad.t - 6, y2: H - pad.b }));
    const label = s('text', { x: ex + 8, y: pad.t - 12 + i * 0 });
    label.textContent = e.label;
    const w = e.label.length * 6.2 + 14;
    g.append(s('rect', { x: ex + 1, y: pad.t - 26, width: w, height: 20, rx: 6 }), label);
    const title = s('title');
    title.textContent = `${formatDate(e.at)}: ${e.detail}`;
    g.append(title);
    evG.append(g);
  });
  svg.append(evG);

  const low = entries.map((e) => [x(e.at), y(e.lowest)]);
  const avg = entries.filter((e) => Number.isFinite(e.avg)).map((e) => [x(e.at), y(e.avg)]);
  const lowPath = smoothPath(low);
  svg.append(s('path', { d: `${lowPath} L${low[low.length - 1][0]},${H - pad.b} L${low[0][0]},${H - pad.b} Z`, fill: 'url(#area)' }));
  if (avg.length > 1) svg.append(s('path', { d: smoothPath(avg), class: 'line-avg' }));
  svg.append(s('path', { d: lowPath, class: 'line-low' }));
  const last = low[low.length - 1];
  svg.append(s('circle', { cx: last[0], cy: last[1], r: 4.5, class: 'pt' }));

  // Hover crosshair
  const cross = s('g', { class: 'cross', opacity: 0 });
  const vline = s('line', { y1: pad.t, y2: H - pad.b });
  const dot = s('circle', { r: 4.5, class: 'pt' });
  cross.append(vline, dot);
  svg.append(cross);
  const tip = h('div.chart-tip', { hidden: true });
  const hit = s('rect', { x: pad.l, y: 0, width: W - pad.l - pad.r, height: H, fill: 'transparent' });
  svg.append(hit);

  const show = (clientX) => {
    const box = svg.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < entries.length; i++) if (Math.abs(x(entries[i].at) - px) < Math.abs(x(entries[best].at) - px)) best = i;
    const e = entries[best];
    const cx = x(e.at);
    const cy = y(e.lowest);
    vline.setAttribute('x1', cx);
    vline.setAttribute('x2', cx);
    dot.setAttribute('cx', cx);
    dot.setAttribute('cy', cy);
    cross.setAttribute('opacity', 1);
    tip.hidden = false;
    fill(tip, 
      h('div.d', formatDate(e.at)),
      h('div.r', h('span', 'LOWEST'), money(e.lowest, e.currency)),
      Number.isFinite(e.avg) ? h('div.r', h('span', 'AVG'), money(e.avg, e.currency)) : null,
      h('div.r', h('span', 'Items'), h('span', String(e.items))),
    );
    tip.style.left = `${(cx / W) * box.width}px`;
    tip.style.top = `${(cy / H) * box.height}px`;
  };
  hit.addEventListener('pointermove', (ev) => show(ev.clientX));
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('opacity', 0);
    tip.hidden = true;
  });

  wrap.append(svg, tip);
  return wrap;
}

export function renderHistory({ state, app }) {
  const r = state.result;
  const code = r.currency;
  const all = (state.history ?? []).slice().sort((a, b) => a.at - b.at);
  const entries = all.filter((e) => e.currency === code);
  const delta = historyDelta(entries);

  const head = h('div.page-head',
    h('div', h('h1.large-title', 'History'), h('p.page-sub', 'Every scan is saved on this computer. Nothing is uploaded.')),
    entries.length ? h('button.btn.ghost', { type: 'button', on: { click: () => app.clearHistory() } }, icon('trash'), 'Clear history') : null,
  );

  if (entries.length < 2) {
    return {
      el: h('div.page', head, h('section.panel', h('div.empty',
        icon('history', 'art'),
        h('h3', entries.length ? 'One scan so far' : 'No scans yet'),
        h('p', 'Scan this profile again later and Glasscase will chart the value over time and show what changed.'),
        h('div.actions', h('button.btn', { type: 'button', on: { click: () => app.rescan() } }, icon('refresh'), 'Scan again')),
      ))),
      title: 'History',
    };
  }

  const first = entries[0];
  const latest = entries[entries.length - 1];
  const high = entries.reduce((a, e) => (e.lowest > a.lowest ? e : a));
  const low = entries.reduce((a, e) => (e.lowest < a.lowest ? e : a));
  const chg = (a, b) => (b.lowest > 0 ? (a.lowest - b.lowest) / b.lowest : null);

  const stats = h('section.panel.hist-stats',
    h('div', h('span.lbl', 'Latest, at LOWEST'), h('div.small-number', money(latest.lowest, code)), h('span.src', formatDate(latest.at))),
    h('div', h('span.lbl', 'Since the last scan'),
      h('div.small-number', formatSignedMoney(delta?.abs ?? 0, code)),
      delta ? h(`span.delta.${delta.abs > 0 ? 'up' : delta.abs < 0 ? 'down' : 'flat'}`, `${formatSignedPercent(delta.rel)} since ${formatDate(delta.since, { month: 'short', day: 'numeric' })}`) : null),
    h('div', h('span.lbl', `Since ${formatDate(first.at, { month: 'short', year: 'numeric' })}`),
      h('div.small-number', formatSignedMoney(latest.lowest - first.lowest, code)),
      h(`span.delta.${latest.lowest > first.lowest ? 'up' : latest.lowest < first.lowest ? 'down' : 'flat'}`, formatSignedPercent(chg(latest, first)))),
    h('div', h('span.lbl', 'Range'), h('div.small-number', money(high.lowest, code)), h('span.src', `High on ${formatDate(high.at)}, low ${formatMoney(low.lowest, code)}`)),
  );

  const chartPanel = h('section.panel',
    h('div.panel-head', h('h3.panel-title', 'Value over time'),
      h('div.legend', h('span', h('i'), 'LOWEST'), h('span', h('i.avg'), 'AVG'), h('span', h('i.ev'), 'Market event'))),
    chart(entries, code),
  );

  const rows = entries.slice().reverse().slice(0, 40);
  const table = h('section.panel', { style: { 'margin-top': '16px' } },
    h('div.panel-head', h('h3.panel-title', 'Scans'), h('span.panel-meta', plural(entries.length, 'scan'))),
    h('table.list',
      h('thead', h('tr', h('th', 'Date'), h('th.r', 'LOWEST'), h('th.r', 'AVG'), h('th.r', 'Net'), h('th.r', 'Items'), h('th.r', 'Change'))),
      h('tbody', rows.map((e, i) => {
        const prev = rows[i + 1];
        const c = prev ? e.lowest - prev.lowest : null;
        return h('tr',
          h('td', formatDate(e.at, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })),
          h('td.r', money(e.lowest, code)),
          h('td.r', money(e.avg, code)),
          h('td.r', money(e.net, code)),
          h('td.r', String(e.items)),
          h('td.r', c == null ? '—' : h(`span.delta.${c > 0 ? 'up' : c < 0 ? 'down' : 'flat'}`, formatSignedMoney(c, code))));
      })),
    ),
  );

  return {
    el: h('div.page', head,
      r.demo ? h('div.notices', h('div.notice', icon('sparkles'), h('span', 'Demo history: the curve is invented, but it follows the real market events marked on the chart.'))) : null,
      all.length !== entries.length ? h('div.notices', h('div.notice', icon('info'), h('span', `${plural(all.length - entries.length, 'scan')} in other currencies are hidden.`))) : null,
      stats, chartPanel, table),
    title: 'History',
  };
}
