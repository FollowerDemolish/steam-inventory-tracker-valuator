// Local persistence: settings, secrets, recent profiles, scan history and an
// HTTP response cache. Plain JSON files in the data folder; nothing leaves
// the machine.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_GAME_IDS } from '../core/games.js';
import { CURRENCIES } from '../core/currencies.js';
import { WINDOWS, SOURCES, AVG_MODES, AVG_SOURCES } from '../core/pricing.js';
import { LOWEST_SOURCES, defaultVenueSettings } from '../core/venues.js';

export const DEFAULT_SETTINGS = Object.freeze({
  currency: 'USD',
  source: 'both',
  window: '7d',
  games: [...DEFAULT_GAME_IDS],
  customContexts: [],
  steamFloorLimit: 40,
  lowestSource: 'steam',
  avgSource: 'skinport',
  venues: defaultVenueSettings().enabled,
  fees: defaultVenueSettings().fees,
  csfloatTopN: 10,
  avgMode: 'mean',
  buyOrders: false,
  buyOrdersTopN: 15,
  captureRate: 0.1,
  skinportFee: 0.08,
  motion: 'system',
});

const MAX_RECENT = 8;
const MAX_HISTORY_PER_PROFILE = 200;

function sanitizeSettings(input) {
  const s = { ...DEFAULT_SETTINGS, ...(input ?? {}) };
  if (!CURRENCIES.some((c) => c.code === s.currency)) s.currency = 'USD';
  if (!SOURCES.includes(s.source)) s.source = 'both';
  if (!WINDOWS.includes(s.window)) s.window = '7d';
  s.games = Array.isArray(s.games) ? s.games.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [...DEFAULT_GAME_IDS];
  s.customContexts = Array.isArray(s.customContexts)
    ? s.customContexts.filter((c) => Number.isInteger(c?.appid) && Number.isInteger(c?.contextid)).slice(0, 8)
    : [];
  s.steamFloorLimit = Math.min(500, Math.max(0, Number(s.steamFloorLimit) || 0));
  if (!['system', 'reduce', 'full'].includes(s.motion)) s.motion = 'system';
  if (!AVG_MODES.includes(s.avgMode)) s.avgMode = 'mean';
  // Older settings files only had `source`; derive the split settings from it.
  if (!input?.lowestSource && input?.source) s.lowestSource = input.source === 'skinport' ? 'skinport' : 'steam';
  if (!input?.avgSource && input?.source) s.avgSource = input.source === 'steam' ? 'steam' : 'skinport';
  if (!LOWEST_SOURCES.includes(s.lowestSource)) s.lowestSource = 'steam';
  if (!AVG_SOURCES.includes(s.avgSource)) s.avgSource = 'skinport';
  const dv = defaultVenueSettings();
  s.venues = { ...dv.enabled, ...(typeof s.venues === 'object' && s.venues ? s.venues : {}) };
  for (const k of Object.keys(s.venues)) if (!(k in dv.enabled)) delete s.venues[k];
  for (const k of Object.keys(s.venues)) s.venues[k] = Boolean(s.venues[k]);
  s.fees = { ...dv.fees, ...(typeof s.fees === 'object' && s.fees ? s.fees : {}) };
  if (input?.skinportFee != null && input?.fees?.skinport == null) s.fees.skinport = Number(input.skinportFee);
  for (const k of Object.keys(s.fees)) {
    const f = Number(s.fees[k]);
    s.fees[k] = Number.isFinite(f) ? Math.min(0.5, Math.max(0, f)) : dv.fees[k] ?? 0;
  }
  s.skinportFee = s.fees.skinport;
  s.csfloatTopN = Math.min(40, Math.max(1, Math.round(Number(s.csfloatTopN) || 10)));
  s.buyOrders = Boolean(s.buyOrders);
  s.buyOrdersTopN = Math.min(50, Math.max(1, Math.round(Number(s.buyOrdersTopN) || 15)));
  s.captureRate = Math.min(1, Math.max(0.01, Number(s.captureRate) || 0.1));
  s.skinportFee = Math.min(0.5, Math.max(0, Number.isFinite(Number(s.skinportFee)) ? Number(s.skinportFee) : 0.08));
  return s;
}

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.cacheDir = path.join(dir, 'cache');
    this.imageDir = path.join(dir, 'images');
    for (const d of [this.dir, this.cacheDir, this.imageDir]) fs.mkdirSync(d, { recursive: true });
  }

  file(name) {
    return path.join(this.dir, name);
  }

  readJson(name, fallback) {
    try {
      return JSON.parse(fs.readFileSync(this.file(name), 'utf8'));
    } catch {
      return fallback;
    }
  }

  writeJson(name, data) {
    const target = this.file(name);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, target);
  }

  // Settings
  getSettings() {
    return sanitizeSettings(this.readJson('settings.json', {}));
  }

  setSettings(patch) {
    const next = sanitizeSettings({ ...this.getSettings(), ...(patch ?? {}) });
    this.writeJson('settings.json', next);
    return next;
  }

  // Secrets (optional Steam Web API key and steamLoginSecure cookie).
  // Stored in their own file so settings can be shared without them.
  getSecrets() {
    const s = this.readJson('secrets.json', {});
    return { apiKey: typeof s.apiKey === 'string' ? s.apiKey : '', cookie: typeof s.cookie === 'string' ? s.cookie : '' };
  }

  setSecret(name, value) {
    if (!['apiKey', 'cookie'].includes(name)) throw new Error('Unknown secret');
    const s = this.getSecrets();
    s[name] = String(value ?? '').trim();
    this.writeJson('secrets.json', s);
    return s;
  }

  // Recent profiles
  getRecent() {
    const list = this.readJson('recent.json', []);
    return Array.isArray(list) ? list : [];
  }

  addRecent(entry) {
    const list = this.getRecent().filter((r) => r.steamid !== entry.steamid);
    list.unshift({ ...entry, at: Date.now() });
    this.writeJson('recent.json', list.slice(0, MAX_RECENT));
    return this.getRecent();
  }

  removeRecent(steamid) {
    this.writeJson('recent.json', this.getRecent().filter((r) => r.steamid !== steamid));
    return this.getRecent();
  }

  // Scan history
  getHistory(steamid) {
    const all = this.readJson('history.json', {});
    return Array.isArray(all?.[steamid]) ? all[steamid] : [];
  }

  addHistory(steamid, entry) {
    const all = this.readJson('history.json', {});
    const list = Array.isArray(all[steamid]) ? all[steamid] : [];
    list.push(entry);
    all[steamid] = list.slice(-MAX_HISTORY_PER_PROFILE);
    this.writeJson('history.json', all);
    return all[steamid];
  }

  setHistory(steamid, list) {
    const all = this.readJson('history.json', {});
    all[steamid] = list;
    this.writeJson('history.json', all);
  }

  clearHistory(steamid) {
    const all = this.readJson('history.json', {});
    if (steamid) delete all[steamid];
    this.writeJson('history.json', steamid ? all : {});
  }

  // HTTP cache
  cachePath(key) {
    return path.join(this.cacheDir, crypto.createHash('sha1').update(key).digest('hex') + '.json');
  }

  getCache(key) {
    try {
      const entry = JSON.parse(fs.readFileSync(this.cachePath(key), 'utf8'));
      return entry?.key === key ? entry : null;
    } catch {
      return null;
    }
  }

  setCache(key, data) {
    const entry = { key, savedAt: Date.now(), data };
    try {
      fs.writeFileSync(this.cachePath(key), JSON.stringify(entry));
    } catch {
      // A full disk should not break a scan.
    }
    return entry;
  }

  async clearCache() {
    for (const d of [this.cacheDir, this.imageDir]) {
      await fsp.rm(d, { recursive: true, force: true });
      await fsp.mkdir(d, { recursive: true });
    }
  }

  async cacheSize() {
    let total = 0;
    for (const d of [this.cacheDir, this.imageDir]) {
      let names = [];
      try {
        names = await fsp.readdir(d);
      } catch {
        continue;
      }
      for (const n of names) {
        try {
          total += (await fsp.stat(path.join(d, n))).size;
        } catch {
          // File vanished between readdir and stat.
        }
      }
    }
    return total;
  }
}
