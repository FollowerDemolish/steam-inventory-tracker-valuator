// Serves Steam images to the renderer from app://glasscase/img/... so the
// renderer never talks to the network and exported PNGs stay untainted.
// Images are cached on disk; a failed load returns 404 and the renderer
// shows its offline placeholder.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ECON_SIZES = new Set([64, 96, 128, 192, 256, 360, 512]);
const AVATAR_HOST = /^(avatars\.(fastly|akamai|cloudflare)\.steamstatic\.com|avatars\.steamstatic\.com|steamcdn-a\.akamaihd\.net|cdn\.(akamai|fastly|cloudflare)\.steamstatic\.com)$/;
const MAX_ACTIVE = 6;
const FAIL_TTL_MS = 5 * 60 * 1000;

function sniffType(buf) {
  if (buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length > 3 && buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  return null;
}

export function upstreamFor(url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['img', kind, ...]
  const kind = parts[1];
  if (kind === 'econ') {
    const hash = parts[2] ?? '';
    const size = Number(parts[3] ?? 128);
    if (!/^[A-Za-z0-9_-]{10,600}$/.test(hash) || !ECON_SIZES.has(size)) return null;
    return `https://community.fastly.steamstatic.com/economy/image/${hash}/${size}fx${size}f`;
  }
  if (kind === 'avatar') {
    let target;
    try {
      target = new URL(url.searchParams.get('u') ?? '');
    } catch {
      return null;
    }
    if (target.protocol !== 'https:' || !AVATAR_HOST.test(target.hostname)) return null;
    return target.toString();
  }
  if (kind === 'app') {
    const appid = Number(parts[2]);
    const variant = parts[3];
    if (!Number.isInteger(appid) || appid <= 0) return null;
    if (variant === 'header') return `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`;
    if (variant === 'capsule') return `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appid}/capsule_231x87.jpg`;
    return null;
  }
  return null;
}

export function createImages({ dir, log, fetchImpl = globalThis.fetch, offline = false }) {
  const inflight = new Map();
  const failed = new Map();
  let active = 0;
  const waiting = [];

  const acquire = () => new Promise((resolve) => {
    if (active < MAX_ACTIVE) {
      active++;
      resolve();
    } else {
      waiting.push(resolve);
    }
  });
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };

  async function load(upstream) {
    const file = path.join(dir, crypto.createHash('sha1').update(upstream).digest('hex') + '.img');
    try {
      const buf = await fs.readFile(file);
      return { buf, type: sniffType(buf) ?? 'application/octet-stream' };
    } catch {
      // Not cached yet.
    }
    if (offline) return null;
    const failedAt = failed.get(upstream);
    if (failedAt && Date.now() - failedAt < FAIL_TTL_MS) return null;

    await acquire();
    try {
      const res = await fetchImpl(upstream, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Glasscase/0.1' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const type = sniffType(buf);
      if (!type) throw new Error('Not an image');
      await fs.writeFile(file, buf).catch(() => {});
      return { buf, type };
    } catch (err) {
      failed.set(upstream, Date.now());
      log.debug(`image unavailable: ${err.message}`);
      return null;
    } finally {
      release();
    }
  }

  async function handle(url) {
    const upstream = upstreamFor(url);
    if (!upstream) return new Response('Bad image request', { status: 400 });
    let p = inflight.get(upstream);
    if (!p) {
      p = load(upstream).finally(() => inflight.delete(upstream));
      inflight.set(upstream, p);
    }
    const img = await p;
    if (!img) return new Response('Image unavailable', { status: 404 });
    return new Response(img.buf, { status: 200, headers: { 'Content-Type': img.type, 'Cache-Control': 'max-age=86400' } });
  }

  return { handle };
}
