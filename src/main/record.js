// `--record`: plays a scripted walkthrough of the demo through the real UI,
// captures frames with webContents.capturePage() and encodes GIFs into assets/.
// Run with: xvfb-run -a -s "-screen 0 1920x1080x24" npm run gifs

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { nativeImage } from 'electron';
import { encodeGif } from './gif.js';

const FPS = 14;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Skia bitmaps are BGRA; GIF encoding wants RGBA.
function bgraToRgba(buf) {
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i < buf.length; i += 4) {
    out[i] = buf[i + 2];
    out[i + 1] = buf[i + 1];
    out[i + 2] = buf[i];
    out[i + 3] = 255;
  }
  return out;
}

function startCapture(win, { dir, width, height, rect = null }) {
  const frames = [];
  let stopped = false;
  let last = null;
  const interval = 1000 / FPS;
  const loop = (async () => {
    let i = 0;
    while (!stopped) {
      const t = Date.now();
      const img = await win.webContents.capturePage(rect ?? undefined);
      const sized = img.getSize().width === width ? img : img.resize({ width, height, quality: 'best' });
      const rgba = bgraToRgba(sized.toBitmap());
      if (last && rgba.equals(last.buf)) {
        last.end = Date.now();
      } else {
        const file = path.join(dir, `f${String(i++).padStart(5, '0')}.rgba`);
        await fs.writeFile(file, rgba);
        last = { file, buf: rgba, start: t, end: Date.now() };
        frames.push(last);
      }
      const wait = interval - (Date.now() - t);
      if (wait > 0) await sleep(wait);
    }
  })();
  return {
    async stop(holdMs = 1200) {
      stopped = true;
      await loop;
      return frames.map((f, i) => ({
        file: f.file,
        delay: Math.max(40, i < frames.length - 1 ? frames[i + 1].start - f.start : holdMs),
      }));
    },
  };
}

async function previewWriter(dir, width, height) {
  await fs.mkdir(dir, { recursive: true });
  return async (n, rgba) => {
    const bgra = Buffer.from(bgraToRgba(Buffer.from(rgba)));
    await fs.writeFile(path.join(dir, `frame-${String(n).padStart(3, '0')}.png`), nativeImage.createFromBitmap(bgra, { width, height }).toPNG());
  };
}

export async function record({ win, send, log, outDir }) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'glasscase-frames-'));
  const previewDir = process.env.GLASSCASE_GIF_PREVIEW || null;
  const step = (cmd) => send(cmd, 90000);
  try {
    await step({ type: 'settle', ms: 1000 });

    // demo.gif: home, demo, overview, inventory, item sheet, share card, back home.
    const W = 1200;
    const H = 750;
    const demoDir = path.join(tmp, 'demo');
    await fs.mkdir(demoDir);
    const cap = startCapture(win, { dir: demoDir, width: W, height: H });
    await sleep(1300);
    await step({ type: 'click', selector: '.home-actions .btn', text: 'Try the demo' });
    await step({ type: 'settle', ms: 3100 });
    await step({ type: 'click', selector: '.nav-item', text: 'Inventory' });
    await sleep(900);
    await step({ type: 'click', selector: '.seg button', text: 'CS2' });
    await sleep(700);
    await step({ type: 'type', selector: '#inv-search', value: 'ak-47', delay: 150 });
    await sleep(900);
    await step({ type: 'click', selector: '.tile', text: 'Redline' });
    await sleep(3300);
    await step({ type: 'key', key: 'Escape' });
    await sleep(500);
    await step({ type: 'click', selector: '.nav-item', text: 'Share card' });
    await sleep(1300);
    await step({ type: 'click', selector: '.swatch', text: 'Aurora' });
    await sleep(900);
    await step({ type: 'click', selector: '.share-controls .btn.primary' });
    await sleep(1500);
    await step({ type: 'click', selector: '.nav-item', text: 'Scan another' });
    await sleep(500);
    await step({ type: 'hide-pointer' });
    await step({ type: 'reset-home' });
    await sleep(900);
    const demoFrames = await cap.stop(900);
    const demo = await encodeGif(demoFrames, {
      width: W,
      height: H,
      out: path.join(outDir, 'demo.gif'),
      preview: previewDir ? { frames: [0, 25, 60, 90, 120], write: await previewWriter(path.join(previewDir, 'demo'), W, H) } : null,
    });
    const demoMs = demoFrames.reduce((a, f) => a + f.delay, 0);
    log.info(`demo.gif: ${demo.frames} frames, ${(demoMs / 1000).toFixed(1)} s, ${(demo.bytes / 1048576).toFixed(2)} MB`);

    // marketplaces.gif: the per-venue table for a few items, cropped to the sheet.
    await step({ type: 'demo' });
    // Clean cuts between items: no half-finished sheet animation in the close-up.
    await step({ type: 'motion', value: 'reduce' });
    await step({ type: 'navigate', view: 'inventory' });
    await step({ type: 'settle', ms: 800 });
    await step({ type: 'open-item', name: 'AK-47 | Redline' });
    await step({ type: 'settle', ms: 900 });
    const sheet = (await step({ type: 'rect', selector: '.sheet' })).rect;
    const info = (await step({ type: 'rect', selector: '.sheet .info' })).rect;
    const market = (await step({ type: 'rect', selector: '.sheet .market' })).rect;
    // Crop to the information column: name, the three totals and the venue table.
    const rect = { x: info.x, y: sheet.y, width: sheet.x + sheet.width - info.x, height: Math.min(market.y + market.height + 16, 900) - sheet.y };
    const mW = rect.width;
    const mH = rect.height;
    const mDir = path.join(tmp, 'market');
    await fs.mkdir(mDir);
    const cap2 = startCapture(win, { dir: mDir, width: mW, height: mH, rect });
    await sleep(2400);
    for (const name of ['Karambit', 'AWP | Asiimov', 'Fiery Soul']) {
      await step({ type: 'open-item', name });
      await sleep(2400);
    }
    await step({ type: 'open-item', name: 'AK-47 | Redline' });
    await sleep(500);
    const mFrames = await cap2.stop(400);
    await step({ type: 'motion', value: 'system' });
    const mk = await encodeGif(mFrames, {
      width: mW,
      height: mH,
      out: path.join(outDir, 'marketplaces.gif'),
      preview: previewDir ? { frames: [0, 12, 30], write: await previewWriter(path.join(previewDir, 'market'), mW, mH) } : null,
    });
    const mMs = mFrames.reduce((a, f) => a + f.delay, 0);
    log.info(`marketplaces.gif: ${mk.frames} frames, ${(mMs / 1000).toFixed(1)} s, ${(mk.bytes / 1048576).toFixed(2)} MB, ${mW}x${mH}`);
    return 0;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
