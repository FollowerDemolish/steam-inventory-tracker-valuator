// Glasscase main process: window, custom protocol, IPC and the network layer.

import { app, BrowserWindow, ipcMain, protocol, shell, dialog, session } from 'electron';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { resolveDataDir } from '../core/data-dir.js';
import { buildReport, historyEntry } from '../core/report.js';
import { summarizeLibrary } from '../core/library.js';
import { currencyByCode } from '../core/currencies.js';
import { maskSecret } from '../core/format.js';
import { RateLimitError } from '../core/backoff.js';
import { Store } from './store.js';
import { createHttp } from './http.js';
import { createSteam } from './steam.js';
import { createSkinport } from './skinport.js';
import { createVenues } from './venues.js';
import { createImages } from './images.js';
import { createLogger } from './log.js';
import { runScan, ScanError } from './scan.js';
import { loadDemo, demoRate, seedDemoHistory } from './demo.js';
import { runDriver } from './driver.js';

const SRC = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(1);
const flag = (name) => argv.includes(`--${name}`);
const option = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;

const MODE = flag('smoke') ? 'smoke' : flag('shots') ? 'shots' : flag('record') ? 'record' : 'app';
const OFFLINE = flag('offline');
const log = createLogger({ quiet: MODE === 'app' && app.isPackaged });

// Smoke and screenshot runs use a throwaway data folder.
const TEMP_DATA = MODE !== 'app' && !option('data-dir');
const dataOverride = option('data-dir') ?? (TEMP_DATA ? fs.mkdtempSync(path.join(os.tmpdir(), 'glasscase-')) : null);
const { dir: DATA_DIR, mode: DATA_MODE } = resolveDataDir({ env: process.env, userData: app.getPath('userData'), override: dataOverride });
if (DATA_MODE !== 'user-data') app.setPath('userData', path.join(DATA_DIR, 'Session'));

const store = new Store(DATA_DIR);
const http = createHttp({ store, log, offline: OFFLINE });
const steam = createSteam({ http, store, log });
const skinport = createSkinport({ http });
const venues = createVenues({ http, store, log });
const images = createImages({ dir: store.imageDir, log, offline: OFFLINE });

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const ALLOWED_EXTERNAL = /^(steamcommunity\.com|store\.steampowered\.com|skinport\.com|github\.com|help\.steampowered\.com|waxpeer\.com|market\.csgo\.com|market\.dota2\.net|tf2\.tm|rust\.tm|lis-skins\.com|csfloat\.com|open\.er-api\.com)$/;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
]);

if (MODE === 'app' && !app.requestSingleInstanceLock()) app.quit();

let win = null;
let lastResult = null;
let lastRequest = null;
let scanAbort = null;
const scanControl = { skipSteam: false };

async function serveStatic(url) {
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const full = path.resolve(SRC, rel);
  const allowed = [path.join(SRC, 'renderer') + path.sep, path.join(SRC, 'core') + path.sep];
  if (!allowed.some((p) => full.startsWith(p))) return new Response('Forbidden', { status: 403 });
  try {
    const data = await fsp.readFile(full);
    const headers = { 'Content-Type': MIME[path.extname(full)] ?? 'application/octet-stream' };
    if (full.endsWith('.html')) headers['Content-Security-Policy'] = CSP;
    return new Response(data, { status: 200, headers });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function sendWindowState() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('win:state', { maximized: win.isMaximized(), focused: win.isFocused(), fullscreen: win.isFullScreen() });
}

function createWindow() {
  const shotSize = MODE === 'app' ? null : { width: 1440, height: 900 };
  win = new BrowserWindow({
    width: shotSize?.width ?? 1320,
    height: shotSize?.height ?? 860,
    minWidth: 980,
    minHeight: 640,
    frame: false,
    show: false,
    backgroundColor: '#0a1420',
    title: 'Glasscase',
    icon: path.join(SRC, 'renderer', 'img', 'icon-512.png'),
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  for (const ev of ['maximize', 'unmaximize', 'focus', 'blur', 'enter-full-screen', 'leave-full-screen']) win.on(ev, sendWindowState);
  win.once('ready-to-show', () => {
    if (MODE === 'app') win.show();
    else win.showInactive();
  });
  win.webContents.on('console-message', (event) => {
    const { level, message } = event;
    if (level === 'error' || level === 'warning' || level === 3 || level === 2) log.warn(`renderer: ${message}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    log.error(`renderer gone: ${details.reason}`);
    if (MODE !== 'app') app.exit(1);
  });
  win.loadURL('app://glasscase/renderer/index.html');
  return win;
}

function secretsView() {
  const s = store.getSecrets();
  return { hasApiKey: Boolean(s.apiKey), apiKey: maskSecret(s.apiKey), hasCookie: Boolean(s.cookie), cookie: maskSecret(s.cookie, 3) };
}

function errorPayload(err) {
  if (err instanceof ScanError) return { error: { message: err.message, kind: err.kind, retryInMs: err.retryInMs } };
  if (err instanceof RateLimitError) return { error: { message: err.message, kind: 'rate-limit', retryInMs: err.retryInMs } };
  return { error: { message: err?.message ?? String(err), kind: 'error' } };
}

function saveHistory(result) {
  const steamid = result.profile.steamid;
  const entry = historyEntry(result);
  const existing = store.getHistory(steamid);
  if (result.demo) {
    if (!existing.length) store.setHistory(steamid, seedDemoHistory(entry));
    const last = store.getHistory(steamid).at(-1);
    if (!last || entry.at - last.at > 10 * 60 * 1000 || last.currency !== entry.currency) store.addHistory(steamid, entry);
    return;
  }
  const usable = result.games.some((g) => ['ok', 'cached', 'stale', 'empty'].includes(g.status));
  if (usable) store.addHistory(steamid, entry);
}

async function getLibrary({ steamid, demo }) {
  const settings = store.getSettings();
  const currency = currencyByCode(settings.currency);
  if (demo) {
    const data = loadDemo();
    const rate = demoRate(currency.code);
    const games = data.library.map((g) => {
      if (!g.price) return { appid: g.appid, name: g.name, hours: g.hours, price: null, free: true };
      const initial = Math.round(g.price * rate);
      const final = g.discount ? Math.floor(initial * (1 - g.discount / 100)) : initial;
      return { appid: g.appid, name: g.name, hours: g.hours, price: { initial, final, discount: g.discount ?? 0, currency: currency.code }, free: false };
    });
    return { ok: true, demo: true, currency: currency.code, games, totals: summarizeLibrary(games) };
  }
  const { apiKey } = store.getSecrets();
  if (!apiKey) return { ok: false, reason: 'needs-key' };
  try {
    const owned = await steam.ownedGames(steamid, apiKey);
    if (!Array.isArray(owned.games)) {
      return { ok: false, reason: 'private', message: 'Steam returned no games. The profile keeps its game details private (Steam > Privacy settings > Game details).' };
    }
    const prices = await steam.storePrices(owned.games.map((g) => g.appid), currency.code);
    const games = owned.games.map((g) => {
      const p = prices[g.appid];
      return {
        appid: g.appid,
        name: g.name ?? `App ${g.appid}`,
        hours: Math.round(((g.playtime_forever ?? 0) / 60) * 10) / 10,
        price: p && Number.isFinite(p.final) ? { initial: p.initial, final: p.final, discount: p.discount, currency: p.currency } : null,
        free: Boolean(p?.free),
      };
    });
    const foreign = games.find((g) => g.price && g.price.currency !== currency.code);
    return {
      ok: true,
      currency: currency.code,
      games,
      totals: summarizeLibrary(games),
      note: foreign ? `The Steam store quoted prices in ${foreign.price.currency} for your region.` : null,
    };
  } catch (err) {
    if (err?.status === 403 || err?.status === 401) return { ok: false, reason: 'bad-key', message: 'Steam rejected the Web API key. Check it in Settings.' };
    return { ok: false, reason: 'error', message: err instanceof RateLimitError ? err.message : `Could not load the library (${err.message}).` };
  }
}

// A few demo items for the decorative shelf on the home screen.
function showcase() {
  const data = loadDemo();
  const want = ['M4A1-S | Printstream (Minimal Wear)', '★ Driver Gloves | King Snake (Field-Tested)', 'AWP | Asiimov (Field-Tested)', '★ Karambit | Doppler (Factory New)', 'USP-S | Kill Confirmed (Minimal Wear)', 'Desert Eagle | Blaze (Factory New)', 'AK-47 | Redline (Field-Tested)'];
  const out = [];
  for (const inv of Object.values(data.inventories)) {
    for (const d of inv.descriptions) {
      if (!want.includes(d.market_hash_name) || !d.icon_url) continue;
      const rarity = d.tags?.find((t) => t.category === 'Rarity')?.color;
      out.push({ name: d.market_hash_name, iconUrl: d.icon_url, color: d.market_hash_name.startsWith('\u2605') ? '#e4ae39' : `#${rarity ?? '66c0f4'}` });
    }
  }
  return want.map((n) => out.find((o) => o.name === n)).filter(Boolean);
}

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    dataDir: DATA_DIR,
    dataMode: DATA_MODE,
    mode: MODE,
    offline: OFFLINE,
    demoSnapshot: loadDemo().snapshot,
    showcase: showcase(),
    autoDemo: flag('demo'),
  }));

  ipcMain.handle('win:minimize', () => win?.minimize());
  ipcMain.handle('win:toggle-maximize', () => {
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle('win:close', () => win?.close());

  ipcMain.handle('settings:get', () => ({ settings: store.getSettings(), secrets: secretsView() }));
  ipcMain.handle('settings:set', (_e, patch) => ({ settings: store.setSettings(patch), secrets: secretsView() }));
  ipcMain.handle('secrets:set', (_e, { name, value }) => {
    store.setSecret(name, value);
    log.info(`${name === 'apiKey' ? 'API key' : 'Login cookie'} ${value ? 'saved' : 'removed'}`);
    return secretsView();
  });
  ipcMain.handle('secrets:check-key', async () => {
    const { apiKey } = store.getSecrets();
    if (!apiKey) return { ok: false, message: 'No key saved.' };
    try {
      await http.get(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=76561197960287930`, { service: 'steam-api', retries: 0 });
      return { ok: true, message: 'Steam accepted the key.' };
    } catch (err) {
      return { ok: false, message: err?.status === 403 || err?.status === 401 ? 'Steam rejected this key.' : `Could not check the key (${err.message}).` };
    }
  });

  ipcMain.handle('profiles:recent', () => store.getRecent());
  ipcMain.handle('profiles:remove-recent', (_e, steamid) => store.removeRecent(steamid));

  ipcMain.handle('scan:start', async (event, request) => {
    scanAbort?.abort();
    const abort = new AbortController();
    scanAbort = abort;
    scanControl.skipSteam = false;
    const settings = store.getSettings();
    try {
      const result = await runScan({
        input: request?.input,
        demo: Boolean(request?.demo),
        settings,
        secrets: store.getSecrets(),
        deps: { steam, skinport, venues },
        signal: abort.signal,
        control: scanControl,
        emit: (p) => {
          if (!event.sender.isDestroyed()) event.sender.send('scan:progress', p);
        },
      });
      lastResult = result;
      lastRequest = request;
      saveHistory(result);
      if (!result.demo) {
        store.addRecent({ steamid: result.profile.steamid, name: result.profile.name, avatar: result.profile.avatar ?? null, input: result.profile.steamid });
      }
      return { result };
    } catch (err) {
      log.warn('scan failed:', err.message);
      return errorPayload(err);
    } finally {
      if (scanAbort === abort) scanAbort = null;
    }
  });
  ipcMain.handle('scan:cancel', () => scanAbort?.abort());
  ipcMain.handle('scan:skip', () => {
    scanControl.skipSteam = true;
  });
  ipcMain.handle('scan:reprice', () => {
    if (!lastResult) return { error: { message: 'Nothing to re-price yet.', kind: 'error' } };
    const settings = store.getSettings();
    if (settings.currency !== lastResult.currency) return { needsRescan: true, request: lastRequest };
    const report = buildReport(lastResult.stacks, { ...settings, fx: lastResult.fx ?? null }, lastResult.currency);
    lastResult = { ...lastResult, ...report };
    return { result: lastResult };
  });

  ipcMain.handle('history:list', (_e, steamid) => store.getHistory(String(steamid)));
  ipcMain.handle('history:clear', (_e, steamid) => store.clearHistory(steamid ? String(steamid) : null));

  ipcMain.handle('library:get', (_e, req) => getLibrary(req ?? {}));

  ipcMain.handle('data:info', async () => ({ dataDir: DATA_DIR, dataMode: DATA_MODE, cacheBytes: await store.cacheSize() }));
  ipcMain.handle('data:clear-cache', async () => {
    await store.clearCache();
    return { cacheBytes: await store.cacheSize() };
  });
  ipcMain.handle('data:open-folder', () => shell.openPath(DATA_DIR));

  ipcMain.handle('share:save', async (_e, { dataUrl, name }) => {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
    if (!m) return { saved: false, message: 'The card could not be rendered.' };
    const buf = Buffer.from(m[1], 'base64');
    const safeName = String(name ?? 'glasscase-card.png').replace(/[^\w.-]+/g, '-').slice(0, 80);
    let target;
    if (MODE !== 'app') {
      const out = MODE === 'record'
        ? path.join(os.tmpdir(), 'glasscase-record-cards')
        : path.resolve(option('out') ?? (MODE === 'smoke' ? 'smoke-output' : path.join('assets', 'shots')));
      await fsp.mkdir(out, { recursive: true });
      target = path.join(out, safeName);
    } else {
      const res = await dialog.showSaveDialog(win, {
        title: 'Save share card',
        defaultPath: path.join(app.getPath('pictures'), safeName),
        filters: [{ name: 'PNG image', extensions: ['png'] }],
      });
      if (res.canceled || !res.filePath) return { saved: false, canceled: true };
      target = res.filePath;
    }
    await fsp.writeFile(target, buf);
    return { saved: true, path: target };
  });

  ipcMain.handle('shell:open', async (_e, url) => {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' || !ALLOWED_EXTERNAL.test(u.hostname.replace(/^www\./, ''))) return false;
      await shell.openExternal(u.toString());
      return true;
    } catch {
      return false;
    }
  });
}

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://glasscase/')) e.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (e) => e.preventDefault());
});

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    if (url.host !== 'glasscase') return new Response('Not found', { status: 404 });
    if (url.pathname.startsWith('/img/')) return images.handle(url);
    return serveStatic(url);
  });
  registerIpc();
  createWindow();

  if (MODE !== 'app') {
    const outDir = path.resolve(option('out') ?? (MODE === 'smoke' ? 'smoke-output' : MODE === 'record' ? 'assets' : path.join('assets', 'shots')));
    const code = await runDriver({ win, mode: MODE, outDir, log, ipcMain });
    if (TEMP_DATA) await fsp.rm(DATA_DIR, { recursive: true, force: true }).catch(() => {});
    app.exit(code);
  }
});

app.on('window-all-closed', () => app.quit());
