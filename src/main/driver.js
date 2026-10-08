// Drives the renderer for --smoke and --shots runs: loads the demo, visits
// screens and saves PNG screenshots with webContents.capturePage().

import fs from 'node:fs/promises';
import path from 'node:path';

export async function runDriver({ win, mode, outDir, log, ipcMain }) {
  await fs.mkdir(outDir, { recursive: true });
  const pending = new Map();
  let seq = 0;
  ipcMain.on('driver:done', (_e, id, info) => {
    const fn = pending.get(id);
    pending.delete(id);
    fn?.(info);
  });

  const send = (cmd, timeoutMs = 60000) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for "${cmd.type}"`));
      }, timeoutMs);
      pending.set(id, (info) => {
        clearTimeout(timer);
        if (info && info.ok === false) reject(new Error(`${cmd.type} failed: ${info.error ?? 'unknown error'}`));
        else resolve(info);
      });
      win.webContents.send('driver:command', { id, ...cmd });
    });

  const shot = async (name) => {
    // Park the pointer away from interactive elements so nothing shows a hover state.
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 1430, y: 895 });
    await new Promise((r) => setTimeout(r, 250));
    const img = await win.webContents.capturePage();
    const file = path.join(outDir, `${name}.png`);
    await fs.writeFile(file, img.toPNG());
    const { width, height } = img.getSize();
    log.info(`saved ${file} (${width}x${height})`);
    return file;
  };

  const step = async (cmd, settleMs = 900) => {
    await send(cmd);
    await send({ type: 'settle', ms: settleMs });
  };

  try {
    if (win.webContents.isLoading()) {
      await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    }
    // The renderer registers its driver once booted; retry hello until then.
    for (let i = 0; ; i++) {
      try {
        await send({ type: 'hello' }, 1500);
        break;
      } catch (err) {
        if (i > 20) throw err;
      }
    }

    if (mode === 'record') {
      const { record } = await import('./record.js');
      return await record({ win, send, log, outDir });
    }

    if (mode === 'smoke') {
      const demo = await send({ type: 'demo' });
      if (!demo?.items) throw new Error('The demo did not load any items.');
      await send({ type: 'settle', ms: 1600 });
      await shot('smoke-overview');
      await step({ type: 'navigate', view: 'inventory' });
      await shot('smoke-inventory');
      log.info(`smoke ok: demo loaded ${demo.items} items, Overview and Inventory rendered`);
      return 0;
    }

    // Full screenshot tour.
    await send({ type: 'settle', ms: 1200 });
    await shot('01-home');
    await step({ type: 'error-state' }, 600);
    await shot('02-home-rate-limited');
    await send({ type: 'demo' });
    await send({ type: 'settle', ms: 1800 });
    await shot('03-overview');
    await step({ type: 'scroll', y: 760 }, 700);
    await shot('04-overview-exit');
    await step({ type: 'scroll', y: 1500 }, 700);
    await shot('05-overview-breakdown');
    await step({ type: 'navigate', view: 'inventory' });
    await shot('06-inventory');
    await step({ type: 'scroll', y: 100000 }, 900);
    await shot('06b-inventory-bottom');
    await step({ type: 'open-item', name: 'AK-47 | Redline' }, 1200);
    await shot('07-item-sheet');
    await send({ type: 'close' });
    await step({ type: 'open-item', name: 'Karambit' }, 1200);
    await shot('08-item-sheet-knife');
    await send({ type: 'close' });
    await step({ type: 'navigate', view: 'library' }, 1500);
    await shot('09-library');
    await step({ type: 'library-needs-key' }, 500);
    await shot('09b-library-no-key');
    await step({ type: 'navigate', view: 'history' });
    await shot('10-history');
    await step({ type: 'share', opts: { layout: 'summary', theme: 'midnight', privacy: false } }, 1200);
    await shot('11-share');
    await send({ type: 'share', opts: { layout: 'summary', theme: 'midnight', privacy: false }, save: true });
    await send({ type: 'share', opts: { layout: 'grid', theme: 'aurora', privacy: true }, save: true });
    await send({ type: 'share', opts: { layout: 'summary', theme: 'ice', privacy: true }, save: true });
    await send({ type: 'share', opts: { layout: 'summary', theme: 'graphite', privacy: false }, save: true });
    await step({ type: 'navigate', view: 'settings' });
    await shot('12-settings');
    await step({ type: 'navigate', view: 'overview' }, 400);
    await step({ type: 'palette', query: 'ak' }, 800);
    await shot('13-palette');
    await send({ type: 'close' });
    return 0;
  } catch (err) {
    log.error(`driver failed: ${err.stack ?? err.message}`);
    try {
      await shot('failure');
    } catch {
      // Ignore: the window may be gone.
    }
    return 1;
  }
}
