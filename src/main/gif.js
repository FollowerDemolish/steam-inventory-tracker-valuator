// GIF encoding for recorded walkthroughs (`npm run gifs`). Development only:
// gifenc is a devDependency and this module is imported lazily.
//
// Quality and size tricks:
// - Each frame gets its own 255-colour palette, built from the pixels that
//   changed, so the dark glass gradients keep their shades.
// - Unchanged pixels are written as transparent on top of the previous frame,
//   which keeps static areas stable (no flicker) and compresses to almost nothing.
// - A 4x4 ordered (Bayer) dither hides banding without the shimmer that
//   error-diffusion dithering causes between frames.

import fs from 'node:fs/promises';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);
const TRANSPARENT = 255;
const MAX_SAMPLE = 260000;

async function loadGifenc() {
  const mod = await import('gifenc');
  return mod.GIFEncoder ? mod : mod.default;
}

function nearest(palette, r, g, b) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = p[0] - r;
    const dg = p[1] - g;
    const db = p[2] - b;
    // Weighted for perceived brightness.
    const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// frames: [{ file, delay }] where each file holds raw RGBA pixels.
export async function encodeGif(frames, { width, height, out, dither = 6, preview = null }) {
  const { GIFEncoder, quantize } = await loadGifenc();
  const enc = GIFEncoder();
  const n = width * height;
  let prev = null;
  const composite = new Uint8Array(n * 4);
  const cache = new Int16Array(1 << 18);
  let written = 0;

  for (let f = 0; f < frames.length; f++) {
    const rgba = new Uint8Array(await fs.readFile(frames[f].file));
    const cur32 = new Uint32Array(rgba.buffer, rgba.byteOffset, n);
    const prev32 = prev ? new Uint32Array(prev.buffer, prev.byteOffset, n) : null;
    const mask = new Uint8Array(n);
    let changed = 0;
    for (let p = 0; p < n; p++) {
      if (!prev32 || cur32[p] !== prev32[p]) {
        mask[p] = 1;
        changed++;
      }
    }
    if (prev && changed === 0) continue;

    // Palette from the changed pixels only.
    const step = Math.max(1, Math.ceil(changed / MAX_SAMPLE));
    const sample = new Uint8Array(Math.ceil(changed / step) * 4);
    let k = 0;
    let seen = 0;
    for (let p = 0; p < n; p++) {
      if (!mask[p]) continue;
      if (seen++ % step) continue;
      sample[k++] = rgba[p * 4];
      sample[k++] = rgba[p * 4 + 1];
      sample[k++] = rgba[p * 4 + 2];
      sample[k++] = 255;
    }
    const palette = quantize(sample.subarray(0, k), 255, { format: 'rgb565' }).map((c) => [c[0], c[1], c[2]]);
    while (palette.length < 255) palette.push([0, 0, 0]);
    palette.push([0, 0, 0]);

    const pal255 = palette.slice(0, 255);
    const index = new Uint8Array(n);
    cache.fill(-1);
    for (let p = 0; p < n; p++) {
      if (!mask[p]) {
        index[p] = TRANSPARENT;
        continue;
      }
      const x = p % width;
      const y = (p / width) | 0;
      const d = BAYER[((y & 3) << 2) | (x & 3)] * dither;
      const r = Math.max(0, Math.min(255, rgba[p * 4] + d));
      const g = Math.max(0, Math.min(255, rgba[p * 4 + 1] + d));
      const b = Math.max(0, Math.min(255, rgba[p * 4 + 2] + d));
      const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
      let idx = cache[key];
      if (idx < 0) {
        idx = nearest(pal255, r, g, b);
        cache[key] = idx;
      }
      index[p] = idx;
      const c = palette[idx];
      composite[p * 4] = c[0];
      composite[p * 4 + 1] = c[1];
      composite[p * 4 + 2] = c[2];
      composite[p * 4 + 3] = 255;
    }

    enc.writeFrame(index, width, height, {
      palette,
      delay: frames[f].delay,
      transparent: Boolean(prev),
      transparentIndex: TRANSPARENT,
      dispose: 1,
      repeat: 0,
    });
    if (preview?.frames?.includes(written)) await preview.write(written, composite);
    written++;
    prev = rgba;
  }
  enc.finish();
  const bytes = enc.bytes();
  await fs.writeFile(out, bytes);
  return { frames: written, bytes: bytes.length };
}
