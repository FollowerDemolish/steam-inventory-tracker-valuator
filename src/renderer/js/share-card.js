// Renders the share card to a canvas. Everything is drawn locally; item art
// comes through app://glasscase/img so the canvas stays exportable.

import { formatMoney, formatDate, formatPercent } from '../../core/format.js';
import { displayRarityColor } from '../../core/rarity.js';
import { gameShort, gameById } from '../../core/games.js';
import { avatarUrl, econUrl } from './dom.js';
import { lowestSource, avgSource } from './labels.js';

export const THEMES = {
  midnight: {
    name: 'Midnight', swatch: ['#123049', '#071019'],
    bg: ['#0c1d31', '#060e17'], glows: [['rgba(26,159,255,0.38)', 0.15, -0.1, 0.75], ['rgba(102,192,244,0.12)', 0.95, 0.05, 0.5]],
    panel: 'rgba(160,200,240,0.06)', stroke: 'rgba(170,205,240,0.14)', ink: '#f1f6fc', ink2: '#9fb1c4', ink3: '#6b7f94', accent: '#66c0f4', accent2: '#1a9fff',
  },
  aurora: {
    name: 'Aurora', swatch: ['#1a6c8f', '#3a1f6e'],
    bg: ['#0b1734', '#160d33'], glows: [['rgba(40,210,220,0.32)', 0.1, 0.0, 0.7], ['rgba(150,90,255,0.32)', 0.9, 0.9, 0.75], ['rgba(26,159,255,0.2)', 0.75, -0.1, 0.5]],
    panel: 'rgba(200,220,255,0.07)', stroke: 'rgba(200,220,255,0.16)', ink: '#f4f6ff', ink2: '#aab4d6', ink3: '#7480a6', accent: '#7fe3ef', accent2: '#8f7bff',
  },
  graphite: {
    name: 'Graphite', swatch: ['#3a3d44', '#141518'],
    bg: ['#1b1d21', '#0f1012'], glows: [['rgba(255,255,255,0.07)', 0.2, -0.1, 0.7]],
    panel: 'rgba(255,255,255,0.045)', stroke: 'rgba(255,255,255,0.1)', ink: '#f2f2f3', ink2: '#a6a8ae', ink3: '#74777e', accent: '#9ad1ff', accent2: '#66c0f4',
  },
  ice: {
    name: 'Ice', swatch: ['#f4f8fc', '#cfe0f0'],
    bg: ['#f3f7fb', '#dde8f3'], glows: [['rgba(26,159,255,0.18)', 0.15, -0.1, 0.7], ['rgba(102,192,244,0.16)', 0.9, 1.0, 0.6]],
    panel: 'rgba(255,255,255,0.72)', stroke: 'rgba(12,30,50,0.1)', ink: '#0b1a2a', ink2: '#4a5d72', ink3: '#7a8a9c', accent: '#1a7fd6', accent2: '#1a9fff', light: true,
  },
};

export const LAYOUTS = {
  summary: { name: 'Summary', w: 1200, h: 675 },
  grid: { name: 'Picture grid', w: 1080, h: 1350 },
};

const SCALE = 2;

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function font(weight, size) {
  return `${weight} ${size}px Inter`;
}

function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

function background(ctx, w, hgt, t) {
  const g = ctx.createLinearGradient(0, 0, w * 0.3, hgt);
  g.addColorStop(0, t.bg[0]);
  g.addColorStop(1, t.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, hgt);
  for (const [color, cx, cy, r] of t.glows) {
    const rg = ctx.createRadialGradient(cx * w, cy * hgt, 0, cx * w, cy * hgt, r * Math.max(w, hgt));
    rg.addColorStop(0, color);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, w, hgt);
  }
}

function panel(ctx, x, y, w, hgt, r, t) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, hgt, r);
  ctx.fillStyle = t.panel;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = t.stroke;
  ctx.stroke();
  ctx.restore();
}

const PILL = {
  LOWEST: ['#66c0f4', '#1170b8'],
  AVG: ['#b49cff', '#5b3fc4'],
  NET: ['#5ad08a', '#16804a'],
  INSTANT: ['#ffc163', '#a8650d'],
  ITEMS: ['#66c0f4', '#1170b8'],
};

function pillColor(label, t) {
  const pair = PILL[label] ?? PILL.LOWEST;
  return t.light ? pair[1] : pair[0];
}

function pill(ctx, x, y, text, color, t) {
  ctx.font = font(700, 13);
  const w = ctx.measureText(text).width + 18;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, 24, 7);
  ctx.globalAlpha = t.light ? 0.12 : 0.18;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = t.light ? color : '#ffffff';
  ctx.globalAlpha = t.light ? 1 : 0.92;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 9, y + 12.5);
  ctx.restore();
  return w;
}

function moneyText(ctx, cents, code, x, y, size, weight, t) {
  const s = formatMoney(cents, code);
  ctx.font = font(weight, size);
  ctx.fillStyle = t.ink;
  ctx.fillText(s, x, y);
  return ctx.measureText(s).width;
}

function glyph(ctx, x, y, size, color) {
  // Simple case glyph used when art is missing.
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.roundRect(x - size / 2, y - size * 0.35, size, size * 0.7, 6);
  ctx.moveTo(x - size / 2, y);
  ctx.lineTo(x + size / 2, y);
  ctx.stroke();
  ctx.restore();
}

function itemTile(ctx, x, y, w, hgt, stack, img, code, t, { showName = true } = {}) {
  const color = displayRarityColor(stack);
  panel(ctx, x, y, w, hgt, 16, t);
  const stageH = showName ? hgt - 64 : hgt - 40;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, hgt, 16);
  ctx.clip();
  const rg = ctx.createRadialGradient(x + w / 2, y + stageH + 10, 0, x + w / 2, y + stageH + 10, w * 0.62);
  rg.addColorStop(0, `${color}66`);
  rg.addColorStop(1, `${color}00`);
  ctx.fillStyle = rg;
  ctx.fillRect(x, y, w, stageH + 2);
  ctx.restore();
  const lg = ctx.createLinearGradient(x, 0, x + w, 0);
  lg.addColorStop(0, `${color}00`);
  lg.addColorStop(0.2, color);
  lg.addColorStop(0.8, color);
  lg.addColorStop(1, `${color}00`);
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.fillStyle = lg;
  ctx.fillRect(x, y + stageH, w, 2);
  ctx.restore();
  if (img) {
    const box = Math.min(w - 24, stageH - 16);
    const ratio = img.naturalWidth / img.naturalHeight || 1;
    const iw = ratio >= 1 ? box * 1.12 : box * ratio;
    const ih = ratio >= 1 ? (box * 1.12) / ratio : box;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 8;
    ctx.drawImage(img, x + (w - iw) / 2, y + (stageH - ih) / 2 + 2, iw, ih);
    ctx.restore();
  } else {
    glyph(ctx, x + w / 2, y + stageH / 2, Math.min(56, w * 0.3), color);
  }
  ctx.textBaseline = 'alphabetic';
  if (showName) {
    ctx.font = font(600, 14);
    ctx.fillStyle = t.ink;
    ctx.fillText(fit(ctx, stack.name, w - 24), x + 12, y + stageH + 25);
  }
  const price = stack.prices?.lowest?.value ?? stack.prices?.avg?.value;
  ctx.font = font(650, 15);
  ctx.fillStyle = t.ink;
  const py = y + hgt - 14;
  ctx.fillText(price != null ? formatMoney(price, code) : 'Unpriced', x + 12, py);
  if (stack.quantity > 1) {
    ctx.font = font(600, 12.5);
    ctx.fillStyle = t.ink2;
    const q = `×${stack.quantity}`;
    ctx.fillText(q, x + w - 12 - ctx.measureText(q).width, py);
  }
}

function header(ctx, x, y, result, opts, t, avatarImg, w) {
  const p = result.profile;
  const size = 56;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, 16);
  ctx.clip();
  if (!opts.privacy && avatarImg) {
    ctx.drawImage(avatarImg, x, y, size, size);
  } else {
    const g = ctx.createLinearGradient(x, y, x + size, y + size);
    g.addColorStop(0, t.accent);
    g.addColorStop(1, t.accent2);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = font(700, 26);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(opts.privacy ? '?' : (p.name ?? '?').charAt(0).toUpperCase(), x + size / 2, y + size / 2 + 1);
  }
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = font(720, 26);
  ctx.fillStyle = t.ink;
  ctx.fillText(fit(ctx, opts.privacy ? 'A Steam collection' : p.name, w - size - 230), x + size + 16, y + 26);
  ctx.font = font(500, 14.5);
  ctx.fillStyle = t.ink2;
  const idPart = opts.privacy || result.demo ? '' : `   ${p.steamid}`;
  ctx.fillText(`Steam inventory, ${formatDate(result.scannedAt)}${idPart}`, x + size + 16, y + 49);

  // Wordmark
  ctx.font = font(680, 16);
  const wm = 'Glasscase';
  const ww = ctx.measureText(wm).width;
  const wx = x + w - ww;
  ctx.fillStyle = t.ink;
  ctx.fillText(wm, wx, y + 26);
  ctx.save();
  const g = ctx.createLinearGradient(wx - 26, y + 8, wx - 8, y + 30);
  g.addColorStop(0, t.accent);
  g.addColorStop(1, t.accent2);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(wx - 28, y + 9, 20, 20, 6);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.moveTo(wx - 18, y + 13);
  ctx.lineTo(wx - 12.5, y + 19);
  ctx.lineTo(wx - 18, y + 25);
  ctx.lineTo(wx - 23.5, y + 19);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.font = font(500, 12.5);
  ctx.fillStyle = t.ink3;
  const sub = result.demo ? 'Demo profile' : 'glasscase';
  ctx.fillText(sub, x + w - ctx.measureText(sub).width, y + 49);
}

function footer(ctx, x, y, w, result, t) {
  ctx.font = font(500, 12.5);
  ctx.fillStyle = t.ink3;
  const left = `LOWEST: ${lowestSource(result)}. AVG: ${avgSource(result)}. Prices in ${result.currency}, informational.`;
  ctx.fillText(fit(ctx, left, w - 220), x, y);
  const right = 'Not affiliated with Valve';
  ctx.fillText(right, x + w - ctx.measureText(right).width, y);
}

function gameBar(ctx, x, y, width, summary, t) {
  const games = summary.perGame.filter((g) => g.lowest || g.avg).slice(0, 4);
  const total = games.reduce((a, g) => a + (g.lowest || g.avg), 0) || 1;
  let bx = x;
  games.forEach((g, i) => {
    const gw = ((g.lowest || g.avg) / total) * width;
    ctx.fillStyle = gameById(g.appid)?.color ?? t.accent;
    ctx.beginPath();
    ctx.roundRect(bx, y, Math.max(4, gw - (i < games.length - 1 ? 3 : 0)), 10, 5);
    ctx.fill();
    bx += gw;
  });
  let lx = x;
  ctx.font = font(560, 13.5);
  games.forEach((g) => {
    const f = (g.lowest || g.avg) / total;
    const label = `${gameShort(g.appid)} ${f > 0 && f < 0.005 ? '<1%' : formatPercent(f)}`;
    ctx.fillStyle = gameById(g.appid)?.color ?? t.accent;
    ctx.beginPath();
    ctx.roundRect(lx, y + 26, 10, 10, 3);
    ctx.fill();
    ctx.fillStyle = t.ink2;
    ctx.fillText(label, lx + 16, y + 36);
    lx += ctx.measureText(label).width + 40;
  });
}

// "Net in cash: $2,974.33 on Market.CSGO. Steam wallet: $3,541.56."
export function venueLine(result) {
  const s = result.summary;
  const cash = s.venues?.find((v) => v.id === s.verdict?.cash);
  const wallet = s.venues?.find((v) => v.kind === 'wallet');
  if (!cash && !wallet) return null;
  const parts = [];
  if (cash) parts.push(`Net in cash: ${formatMoney(cash.net, result.currency)} on ${cash.name}`);
  if (wallet) parts.push(`Steam wallet: ${formatMoney(wallet.net, result.currency)}`);
  return `${parts.join('. ')}.`;
}

export async function renderCard(canvas, result, opts) {
  const t = THEMES[opts.theme] ?? THEMES.midnight;
  const L = LAYOUTS[opts.layout] ?? LAYOUTS.summary;
  canvas.width = L.w * SCALE;
  canvas.height = L.h * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  await document.fonts.load(font(700, 20));
  await document.fonts.load(font(500, 14));

  const s = result.summary;
  const code = result.currency;
  const topCount = opts.layout === 'grid' ? 16 : 4;
  const tops = result.stacks
    .filter((x) => x.marketable && (x.prices?.lowest || x.prices?.avg))
    .sort((a, b) => (b.prices?.lowest?.value ?? b.prices?.avg?.value ?? 0) * b.quantity - (a.prices?.lowest?.value ?? a.prices?.avg?.value ?? 0) * a.quantity)
    .slice(0, topCount);
  const [avatarImg, ...imgs] = await Promise.all([
    opts.privacy ? null : loadImage(avatarUrl(result.profile.avatar)),
    ...tops.map((x) => loadImage(econUrl(x.iconUrl, 256))),
  ]);

  background(ctx, L.w, L.h, t);
  ctx.textBaseline = 'alphabetic';
  const pad = 56;

  if (opts.layout === 'grid') {
    header(ctx, pad, pad, result, opts, t, avatarImg, L.w - pad * 2);
    let y = pad + 112;
    pill(ctx, pad, y - 26, 'LOWEST', pillColor('LOWEST', t), t);
    moneyText(ctx, s.totals.lowest.value, code, pad, y + 54, 64, 720, t);
    const right = L.w - pad;
    ctx.font = font(500, 14);
    ctx.fillStyle = t.ink2;
    const avgLabel = `AVG ${formatMoney(s.totals.avg.value, code)}`;
    const itemsLabel = `${s.counts.items} items`;
    ctx.font = font(650, 22);
    ctx.fillStyle = t.ink;
    ctx.fillText(avgLabel, right - ctx.measureText(avgLabel).width, y + 18);
    ctx.font = font(500, 15);
    ctx.fillStyle = t.ink2;
    ctx.fillText(itemsLabel, right - ctx.measureText(itemsLabel).width, y + 48);
    y += 92;
    const cols = 4;
    const gap = 14;
    const tw = (L.w - pad * 2 - gap * (cols - 1)) / cols;
    const th = 228;
    tops.forEach((st, i) => {
      const cx = pad + (i % cols) * (tw + gap);
      const cy = y + Math.floor(i / cols) * (th + gap);
      itemTile(ctx, cx, cy, tw, th, st, imgs[i], code, t);
    });
    const rows = Math.ceil(tops.length / cols);
    gameBar(ctx, pad, y + rows * (th + gap) + 18, L.w - pad * 2, s, t);
    const vl = venueLine(result);
    if (opts.venueLine !== false && vl) {
      ctx.font = font(500, 14);
      ctx.fillStyle = t.ink2;
      ctx.fillText(fit(ctx, vl, L.w - pad * 2), pad, y + rows * (th + gap) + 82);
    }
    footer(ctx, pad, L.h - 40, L.w - pad * 2, result, t);
    return canvas;
  }

  // Summary layout
  header(ctx, pad, pad - 8, result, opts, t, avatarImg, L.w - pad * 2);
  const colW = 560;
  pill(ctx, pad, 146, 'LOWEST', pillColor('LOWEST', t), t);
  moneyText(ctx, s.totals.lowest.value, code, pad - 3, 250, 84, 720, t);
  ctx.font = font(500, 15);
  ctx.fillStyle = t.ink2;
  ctx.fillText(`${lowestSource(result)}, ${s.totals.lowest.priced} of ${s.totals.lowest.of} items priced`, pad, 284);

  let y = 312;
  const stats = [
    ['AVG', formatMoney(s.totals.avg.value, code), avgSource(result)],
    ['NET', formatMoney(s.totals.net.value, code), 'if sold on Steam'],
    s.totals.instant.priced
      ? ['INSTANT', formatMoney(s.totals.instant.value, code), 'Steam buy orders, net']
      : ['ITEMS', String(s.counts.items), `${s.counts.unpriced} unpriced`],
  ];
  const sw = (colW - 24) / 3;
  stats.forEach(([label, value, cap], i) => {
    const sx = pad + i * (sw + 12);
    panel(ctx, sx, y, sw, 104, 16, t);
    pill(ctx, sx + 14, y + 14, label, pillColor(label, t), t);
    ctx.font = font(680, 24);
    ctx.fillStyle = t.ink;
    ctx.fillText(fit(ctx, value, sw - 28), sx + 14, y + 70);
    ctx.font = font(500, 12.5);
    ctx.fillStyle = t.ink2;
    ctx.fillText(fit(ctx, cap, sw - 28), sx + 14, y + 92);
  });

  y += 148;
  gameBar(ctx, pad, y, colW, s, t);
  ctx.font = font(500, 14);
  ctx.fillStyle = t.ink2;
  const games = s.perGame.filter((g) => g.items).length;
  const extra = [`${s.counts.items} items in ${games} ${games === 1 ? 'game' : 'games'}`];
  if (s.counts.unpriced) extra.push(`${s.counts.unpriced} unpriced`);
  if (s.counts.nonMarketable) extra.push(`${s.counts.nonMarketable} not marketable`);
  ctx.fillText(fit(ctx, `${extra.join(', ')}.`, colW), pad, y + 78);
  const vl = venueLine(result);
  if (opts.venueLine !== false && vl) {
    ctx.fillStyle = t.ink2;
    ctx.fillText(fit(ctx, vl, colW), pad, y + 102);
  }

  // Top items, 2 x 2
  const gx = pad + colW + 40;
  const gw2 = L.w - pad - gx;
  const gap = 14;
  const tw = (gw2 - gap) / 2;
  const th = 206;
  const gy = 138;
  tops.forEach((st, i) => {
    itemTile(ctx, gx + (i % 2) * (tw + gap), gy + Math.floor(i / 2) * (th + gap), tw, th, st, imgs[i], code, t);
  });

  footer(ctx, pad, L.h - 34, L.w - pad * 2, result, t);
  return canvas;
}
