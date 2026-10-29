// Glasscase renderer: state, navigation, scanning and keyboard handling.

import { h, clear, avatar, plural, fill } from './dom.js';
import { icon, trafficGlyph } from './icons.js';
import { renderHome } from './views/home.js';
import { renderOverview } from './views/overview.js';
import { renderInventory } from './views/inventory.js';
import { renderLibrary } from './views/library.js';
import { renderHistory } from './views/history.js';
import { renderShare } from './views/share.js';
import { renderSettings } from './views/settings.js';
import { openSheet, closeSheet, isSheetOpen } from './sheet.js';
import { openPalette, closePalette, isPaletteOpen } from './palette.js';
import { relativeTime } from '../../core/format.js';
import { venueShort } from './labels.js';

const api = window.glasscase;
const isMac = navigator.userAgent.includes('Mac');

const VIEWS = {
  home: renderHome,
  overview: renderOverview,
  inventory: renderInventory,
  library: renderLibrary,
  history: renderHistory,
  share: renderShare,
  settings: renderSettings,
};

const NAV = [
  { id: 'overview', label: 'Overview', icon: 'overview', key: '1' },
  { id: 'inventory', label: 'Inventory', icon: 'inventory', key: '2' },
  { id: 'library', label: 'Library', icon: 'library', key: '3' },
  { id: 'history', label: 'History', icon: 'history', key: '4' },
  { id: 'share', label: 'Share card', icon: 'share', key: '5' },
];

const state = {
  info: null,
  settings: null,
  secrets: null,
  view: 'home',
  result: null,
  prevTotals: null,
  scanning: null,
  scanError: null,
  recent: [],
  lastRequest: null,
  history: [],
  library: null,
  libraryLoading: false,
  inv: { game: 'all', rarity: 'all', tradable: false, min: '', sort: 'value', q: '', keys: null, keysTitle: null },
  share: { layout: 'summary', theme: 'midnight', privacy: false, venueLine: true },
  homeInput: '',
  cacheBytes: null,
  settingsFocus: null,
};

let current = null; // the mounted view object
const root = document.getElementById('app');
const sidebar = h('nav.sidebar', { 'aria-label': 'Sections' });
const main = h('main.main', { id: 'main' });
const toolbar = h('header.toolbar');
const pageHost = h('div', { id: 'page' });
const toasts = h('div.toasts', { role: 'status', 'aria-live': 'polite' });
let hud = null;

// ---------- Actions ----------

const app = {
  api,
  state,
  go,
  render,
  startScan,
  rescan,
  toast,
  openItem: (stack) => openSheet(stack, state.result, app),
  openExternal: (url) => api.openExternal(url),
  settings: () => state.settings,
  removeRecent: async (steamid) => {
    state.recent = await api.profiles.removeRecent(steamid);
    render();
  },
  showKeys: (warning) => {
    Object.assign(state.inv, { game: 'all', rarity: 'all', tradable: false, min: '', q: '', keys: warning.keys, keysTitle: warning.title });
    go('inventory');
  },
  loadLibrary,
  updateSettings,
  setSecret: async (name, value) => {
    state.secrets = await api.settings.setSecret({ name, value });
    toast(value ? (name === 'apiKey' ? 'API key saved' : 'Login cookie saved') : (name === 'apiKey' ? 'API key removed' : 'Login cookie removed'));
    if (name === 'apiKey') {
      state.library = null;
      if (state.result) loadLibrary(true);
    }
    render();
  },
  checkKey: async () => {
    const res = await api.settings.checkKey();
    toast(res.message, res.ok ? 'ok' : 'warn');
  },
  clearCache: async () => {
    const res = await api.data.clearCache();
    state.cacheBytes = res.cacheBytes;
    toast('Cache cleared');
    render();
  },
  refreshCacheSize: async () => {
    const res = await api.data.info();
    if (res.cacheBytes !== state.cacheBytes) {
      state.cacheBytes = res.cacheBytes;
      if (state.view === 'settings') render({ keepScroll: true });
    }
  },
  clearHistory: async (all = false) => {
    const msg = all ? 'Clear the scan history for every profile? This cannot be undone.' : 'Clear the scan history for this profile? This cannot be undone.';
    if (state.info?.mode === 'app' && !window.confirm(msg)) return;
    await api.history.clear(all ? null : state.result?.profile.steamid);
    state.history = state.result ? await api.history.list(state.result.profile.steamid) : [];
    toast(all ? 'All history cleared' : 'History cleared for this profile');
    render();
  },
};

function toast(text, kind = 'ok') {
  const t = h('div.toast', icon(kind === 'ok' ? 'check' : 'warn'), h('span', text));
  if (kind !== 'ok') t.querySelector('svg').style.stroke = 'var(--amber)';
  toasts.append(t);
  setTimeout(() => t.remove(), 3200);
}

async function updateSettings(patch) {
  const before = state.settings;
  const res = await api.settings.set(patch);
  state.settings = res.settings;
  state.secrets = res.secrets;
  applyMotion();
  const changed = (k) => k in patch && JSON.stringify(patch[k]) !== JSON.stringify(before[k]);
  const pricing = ['source', 'lowestSource', 'avgSource', 'window', 'avgMode', 'captureRate', 'skinportFee', 'fees', 'venues'].some(changed);
  const newlyOn = changed('venues') ? Object.keys(patch.venues).filter((k) => patch.venues[k] && !before.venues?.[k]) : [];
  if ('currency' in patch && patch.currency !== before.currency) {
    state.library = null;
    if (state.result) {
      toast(`Rescanning in ${patch.currency}`);
      startScan(state.lastRequest ?? { demo: true }, { stay: true });
    }
  } else if (pricing && state.result) {
    const res2 = await api.scan.reprice();
    if (res2.result) {
      state.result = res2.result;
      toast(newlyOn.length && !state.result.demo ? 'Saved. Scan again to fetch the new marketplace.' : 'Prices updated');
    }
  } else if (('games' in patch || 'customContexts' in patch || 'buyOrders' in patch) && state.result) {
    toast('Saved. Rescan to apply it.');
  }
  render();
}

async function loadLibrary(force = false) {
  if (!state.result || (state.libraryLoading && !force)) return;
  state.libraryLoading = true;
  try {
    state.library = await api.library.get({ steamid: state.result.profile.steamid, demo: state.result.demo });
  } catch (err) {
    state.library = { ok: false, reason: 'error', message: err.message };
  } finally {
    state.libraryLoading = false;
  }
  if (['overview', 'library'].includes(state.view)) render({ keepScroll: true });
}

// ---------- Scanning ----------

async function startScan(request, { stay = false } = {}) {
  if (state.scanning) await api.scan.cancel();
  state.scanning = { label: request.demo ? 'Opening the demo case' : 'Finding the profile' };
  state.scanError = null;
  const first = !state.result;
  if (!stay || first) {
    state.result = first ? null : state.result;
    if (first) state.view = 'overview';
  }
  showHud();
  render();

  const res = await api.scan.start(request);
  state.scanning = null;
  hideHud();
  if (res.error) {
    if (res.error.kind === 'cancelled') {
      if (!state.result) go('home');
      return;
    }
    state.scanError = res.error;
    state.lastRequest = request;
    if (!state.result) {
      go('home');
    } else {
      toast(res.error.message, 'warn');
      render();
    }
    return;
  }
  const prevId = state.result?.profile.steamid;
  state.result = res.result;
  state.lastRequest = request;
  state.homeInput = '';
  if (prevId !== res.result.profile.steamid) {
    state.prevTotals = null;
    state.inv = { ...state.inv, game: 'all', rarity: 'all', q: '', keys: null, keysTitle: null };
  }
  state.library = null;
  state.history = await api.history.list(res.result.profile.steamid);
  state.recent = await api.profiles.recent();
  if (!stay || first) state.view = 'overview';
  render();
  loadLibrary(true);
}

function rescan() {
  if (state.lastRequest) startScan(state.lastRequest, { stay: true });
}

function showHud() {
  hideHud();
  hud = h('div.progress-hud', { role: 'status', 'aria-live': 'polite' });
  document.body.append(hud);
  updateHud();
}

function hideHud() {
  hud?.remove();
  hud = null;
}

function updateHud() {
  if (!hud || !state.scanning) return;
  const p = state.scanning;
  const determinate = Number.isFinite(p.total) && p.total > 0;
  fill(hud, 
    h('div.row',
      h('span.spinner', { 'aria-hidden': 'true' }),
      h('span.label', p.label),
      determinate ? h('span.step', `${Math.min(p.done + 1, p.total)} of ${p.total}`) : null,
      p.canSkip ? h('button.btn', { type: 'button', on: { click: () => api.scan.skip() } }, 'Skip') : null,
      h('button.btn.ghost', { type: 'button', on: { click: () => api.scan.cancel() } }, 'Cancel'),
    ),
    h('div.bar' + (determinate ? '' : '.indeterminate'), h('i', { style: determinate ? { width: `${((p.done + 0.5) / p.total) * 100}%` } : {} })),
    p.item ? h('div.item', p.item) : null,
  );
}

// ---------- Rendering ----------

function go(view, opts = {}) {
  if (view !== 'home' && view !== 'settings' && !state.result && !state.scanning) view = 'home';
  if (opts.focus) state.settingsFocus = opts.focus;
  closeSheet();
  state.view = view;
  render();
  main.scrollTop = 0;
}

function render({ keepScroll = false } = {}) {
  const top = main.scrollTop;
  root.classList.toggle('no-profile', !state.result && !state.scanning);
  renderSidebar();
  const fn = VIEWS[state.view] ?? renderHome;
  current = fn({ state, app });
  clear(pageHost).append(current.el);
  renderToolbar(current.title);
  if (keepScroll) main.scrollTop = top;
  current.mounted?.();
  document.title = current.title && current.title !== 'Glasscase' ? `${current.title} — Glasscase` : 'Glasscase';
}

function renderToolbar(title) {
  const showActions = Boolean(state.result);
  fill(toolbar, 
    h('span.tb-title', state.view === 'home' ? '' : title ?? ''),
    h('span.tb-spacer'),
    h('button.btn.ghost', { type: 'button', 'aria-label': 'Open the command palette', title: `Command palette (${isMac ? '⌘' : 'Ctrl+'}K)`, on: { click: showPalette } },
      icon('command'), h('span', 'Search'), h('span.kbd', isMac ? '⌘K' : 'Ctrl K')),
    showActions
      ? h('button.btn.ghost.icon', { type: 'button', 'aria-label': 'Scan again', title: 'Scan again', disabled: Boolean(state.scanning), on: { click: rescan } }, icon('refresh'))
      : null,
    !state.result
      ? h('button.btn.ghost.icon', { type: 'button', 'aria-label': 'Settings', title: 'Settings', on: { click: () => go(state.view === 'settings' ? 'home' : 'settings') } }, icon(state.view === 'settings' ? 'home' : 'settings'))
      : null,
  );
}

function renderSidebar() {
  const r = state.result;
  const p = r?.profile;
  const items = NAV.map((n) =>
    h('button.nav-item', {
      type: 'button',
      'aria-current': state.view === n.id ? 'page' : null,
      title: `${n.label} (${isMac ? '⌘' : 'Ctrl+'}${n.key})`,
      disabled: !r,
      on: { click: () => go(n.id) },
    }, icon(n.icon), h('span', n.label),
      n.id === 'inventory' && r ? h('span.count', String(r.summary.counts.items)) : null,
      n.id === 'history' && state.history.length ? h('span.count', String(state.history.filter((e) => e.currency === r?.currency).length)) : null,
    ),
  );

  const warnCount = r ? r.summary.warnings.filter((w) => w.severity === 'warn').length : 0;
  const limited = r?.notices.some((n) => /rate-limit/.test(n.kind));
  const status = r
    ? h('div.side-status',
        h('div.line', h('span.dot' + (limited ? '.bad' : r.demo ? '.info' : '')), `${r.demo ? 'Demo snapshot' : `Scanned ${relativeTime(r.scannedAt)}`}, ${r.currency}`),
        h('div.line', icon('tag'), `${r.lowestSource === 'best' ? 'Best floor' : `${venueShort(r.lowestSource ?? 'steam')} floor`}, ${venueShort(r.avgSource ?? 'skinport')} avg`),
        warnCount ? h('div.line', icon('warn'), plural(warnCount, 'warning')) : null,
      )
    : null;

  fill(sidebar, 
    h('div.drag'),
    p
      ? h('button.who', { type: 'button', title: 'Scan another profile', on: { click: () => go('home') } },
          avatar(p),
          h('span.who-text', h('span.who-name', p.name), h('span.who-sub', r.demo ? 'Demo profile' : Number.isFinite(p.level) ? `Level ${p.level}` : 'Steam profile')))
      : h('div.who', h('span.skel', { style: { width: '36px', height: '36px', 'border-radius': '10px' } }), h('span.skel', { style: { width: '110px', height: '14px' } })),
    h('div.nav', items),
    h('div.spacer'),
    h('div.nav',
      h('button.nav-item', { type: 'button', 'aria-current': state.view === 'home' ? 'page' : null, on: { click: () => go('home') } }, icon('home'), h('span', 'Scan another')),
      h('button.nav-item', { type: 'button', 'aria-current': state.view === 'settings' ? 'page' : null, title: `Settings (${isMac ? '⌘' : 'Ctrl+'},)`, on: { click: () => go('settings') } }, icon('settings'), h('span', 'Settings')),
    ),
    status,
  );
}

function showPalette() {
  const r = state.result;
  const commands = [
    ...NAV.map((n) => ({ label: `Go to ${n.label}`, icon: n.icon, keys: ['mod', n.key], run: () => go(n.id), hidden: !r })),
    { label: 'Go to Settings', icon: 'settings', keys: ['mod', ','], run: () => go('settings') },
    { label: 'Scan another profile', icon: 'home', run: () => go('home') },
    { label: 'Try the demo', icon: 'sparkles', run: () => startScan({ demo: true }) },
    { label: 'Scan again', icon: 'refresh', keys: ['mod', 'R'], run: rescan, hidden: !r },
    { label: 'Save a share card', icon: 'photo', run: () => go('share'), hidden: !r },
    { label: 'Show items with warnings', icon: 'warn', run: () => { const w = r.summary.warnings.find((x) => x.severity === 'warn'); if (w) app.showKeys(w); else go('inventory'); }, hidden: !r || !r.summary.warnings.length },
    { label: 'Open the data folder', icon: 'folder', run: () => api.data.openFolder() },
    { label: 'Clear the cache', icon: 'trash', run: app.clearCache },
  ];
  const items = r ? r.stacks.map((s) => ({ label: s.name, iconUrl: s.iconUrl, run: () => app.openItem(s) })) : [];
  const recent = state.recent.map((x) => ({ ...x, run: () => startScan({ input: x.steamid }) }));
  openPalette({ commands, items, recent, isMac });
}

function applyMotion() {
  document.documentElement.dataset.motion = state.settings?.motion ?? 'system';
}

// ---------- Keyboard ----------

document.addEventListener('keydown', (e) => {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (isPaletteOpen()) closePalette();
    else {
      closeSheet();
      showPalette();
    }
    return;
  }
  if (e.key === 'Escape') {
    if (closePalette() || closeSheet()) return;
    if (state.inv.keys && state.view === 'inventory') {
      state.inv.keys = null;
      render();
    }
    return;
  }
  if (isPaletteOpen() || isSheetOpen()) return;
  if (mod && /^[1-5]$/.test(e.key) && state.result) {
    e.preventDefault();
    go(NAV[Number(e.key) - 1].id);
  } else if (mod && e.key === ',') {
    e.preventDefault();
    go('settings');
  } else if (mod && e.key.toLowerCase() === 'r') {
    e.preventDefault();
    rescan();
  } else if (mod && e.key.toLowerCase() === 'f' && state.result) {
    e.preventDefault();
    if (state.view !== 'inventory') go('inventory');
    current?.focusSearch?.();
  } else if (e.key === '/' && state.view === 'inventory' && !/input|select|textarea/i.test(document.activeElement?.tagName ?? '')) {
    e.preventDefault();
    current?.focusSearch?.();
  }
});

main.addEventListener('scroll', () => {
  root.classList.toggle('scrolled', main.scrollTop > 6);
}, { passive: true });

// ---------- Window chrome ----------

function traffic() {
  const b = (cls, label, glyph, fn) => h(`button.${cls}`, { type: 'button', 'aria-label': label, title: label, on: { click: fn } }, trafficGlyph(glyph));
  return h('div.traffic', { role: 'group', 'aria-label': 'Window' },
    b('tl-close', 'Close', 'close', () => api.window.close()),
    b('tl-min', 'Minimize', 'min', () => api.window.minimize()),
    b('tl-zoom', 'Zoom', 'zoom', () => api.window.toggleMaximize()),
  );
}

api.window.onState((s) => {
  document.body.classList.toggle('blurred', !s.focused);
});

api.scan.onProgress((p) => {
  if (!state.scanning) return;
  state.scanning = p;
  updateHud();
});

// ---------- Test driver (smoke and screenshot runs only) ----------

function settle(ms = 900) {
  return new Promise((resolve) => {
    const imgs = [...document.querySelectorAll('img')];
    const pending = imgs.filter((i) => !i.complete);
    const done = () => setTimeout(resolve, ms);
    if (!pending.length) return done();
    let left = pending.length;
    const t = setTimeout(done, 9000);
    for (const i of pending) {
      const fin = () => {
        if (--left === 0) {
          clearTimeout(t);
          done();
        }
      };
      i.addEventListener('load', fin, { once: true });
      i.addEventListener('error', fin, { once: true });
    }
  });
}

// A visible pointer for recorded walkthroughs (record mode only), so viewers
// can follow what is clicked. Clicks still go through the real UI.
let pointer = null;
function findTarget(cmd) {
  const list = [...document.querySelectorAll(cmd.selector)];
  const el = cmd.text ? list.find((e) => e.textContent.trim().includes(cmd.text)) : list[0];
  if (!el) throw new Error(`No element for ${cmd.selector}${cmd.text ? ` "${cmd.text}"` : ''}`);
  return el;
}
function movePointer(el, ms = 650) {
  if (!pointer) {
    pointer = h('div.rec-pointer', { 'aria-hidden': 'true' });
    pointer.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M5 3l14 8.2-6.3 1.5 3.9 6.8-2.6 1.5-3.9-6.8L5 18.4z" fill="#fff" stroke="#0b1520" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    pointer.style.transform = `translate(${innerWidth * 0.62}px, ${innerHeight * 0.7}px)`;
    document.body.append(pointer);
  }
  const r = el.getBoundingClientRect();
  pointer.style.transitionDuration = `${ms}ms`;
  pointer.style.transform = `translate(${Math.round(r.left + Math.min(r.width / 2, 60))}px, ${Math.round(r.top + r.height / 2)}px)`;
  return new Promise((res) => setTimeout(res, ms + 60));
}

async function drive(cmd) {
  switch (cmd.type) {
    case 'pointer':
      await movePointer(findTarget(cmd), cmd.ms);
      return { ok: true };
    case 'click': {
      const el = findTarget(cmd);
      await movePointer(el, cmd.ms ?? 650);
      pointer?.classList.add('down');
      await new Promise((r) => setTimeout(r, 120));
      pointer?.classList.remove('down');
      el.click();
      return { ok: true };
    }
    case 'type': {
      const el = findTarget(cmd);
      await movePointer(el, 500);
      el.focus();
      for (const ch of cmd.value) {
        el.value += ch;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, cmd.delay ?? 110));
      }
      return { ok: true };
    }
    case 'select': {
      const el = findTarget(cmd);
      await movePointer(el, 550);
      el.value = cmd.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    }
    case 'key':
      document.dispatchEvent(new KeyboardEvent('keydown', { key: cmd.key, bubbles: true }));
      return { ok: true };
    case 'rect': {
      const r = findTarget(cmd).getBoundingClientRect();
      return { ok: true, rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } };
    }
    case 'reset-home':
      // Back to a fresh start, so a recorded walkthrough loops cleanly.
      state.result = null;
      state.history = [];
      state.library = null;
      state.prevTotals = null;
      go('home');
      return { ok: true };
    case 'motion':
      document.documentElement.dataset.motion = cmd.value;
      return { ok: true };
    case 'hide-pointer':
      pointer?.remove();
      pointer = null;
      return { ok: true };
    case 'scroll-to': {
      const el = findTarget(cmd);
      main.style.scrollBehavior = 'auto';
      main.scrollTop += el.getBoundingClientRect().top - (cmd.offset ?? 80);
      return { ok: true };
    }
    case 'hello':
      return { ok: true };
    case 'demo':
      await startScan({ demo: true });
      return { ok: Boolean(state.result), items: state.result?.summary.counts.items };
    case 'navigate':
      toasts.querySelectorAll('.toast').forEach((t) => t.remove());
      go(cmd.view);
      return { ok: state.view === cmd.view };
    case 'scroll':
      main.style.scrollBehavior = 'auto';
      main.scrollTop = cmd.y;
      return { ok: true };
    case 'open-item': {
      const list = state.result.stacks.filter((s) => s.marketable && s.prices?.lowest);
      const s = cmd.name ? state.result.stacks.find((x) => x.name.includes(cmd.name)) : list[cmd.index ?? 0];
      app.openItem(s);
      return { ok: true };
    }
    case 'palette':
      showPalette();
      if (cmd.query) {
        const input = document.querySelector('.palette input');
        input.value = cmd.query;
        input.dispatchEvent(new Event('input'));
      }
      return { ok: true };
    case 'close':
      closePalette();
      closeSheet();
      return { ok: true };
    case 'share': {
      Object.assign(state.share, cmd.opts ?? {});
      go('share');
      await current.redraw();
      if (cmd.save) return current.save();
      return { ok: true };
    }
    case 'home-input':
      state.homeInput = cmd.value;
      go('home');
      return { ok: true };
    case 'settle':
      await settle(cmd.ms);
      return { ok: true };
    case 'library-needs-key':
      state.library = { ok: false, reason: 'needs-key' };
      go('library');
      return { ok: true };
    case 'error-state':
      state.scanError = { kind: 'rate-limit', message: 'Steam is rate-limiting this connection. Retry in about 4 min, use cached data, or try the demo.' };
      state.lastRequest = { input: 'gabelogannewell' };
      go('home');
      return { ok: true };
    default:
      return { ok: false, error: `Unknown command ${cmd.type}` };
  }
}

// ---------- Boot ----------

async function boot() {
  const [info, s, recent] = await Promise.all([api.app.info(), api.settings.get(), api.profiles.recent()]);
  state.info = info;
  state.settings = s.settings;
  state.secrets = s.secrets;
  state.recent = recent;
  applyMotion();
  document.body.classList.add(`platform-${info.platform}`);
  document.body.prepend(h('div.ambient', { 'aria-hidden': 'true' }), h('div.titlebar', { 'aria-hidden': 'true' }), traffic());
  main.append(toolbar, pageHost);
  root.append(sidebar, main);
  document.body.append(toasts);
  render();
  if (info.autoDemo && info.mode === 'app') startScan({ demo: true });
  if (info.mode !== 'app') {
    api.driver.onCommand(async (cmd) => {
      try {
        api.driver.done(cmd.id, await drive(cmd));
      } catch (err) {
        api.driver.done(cmd.id, { ok: false, error: String(err?.stack ?? err) });
      }
    });
  }
}

boot();
