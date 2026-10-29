// Renders the app icon and the README hero banner from SVG/HTML sources.
// Usage: npm run assets   (needs network once, for the item art in the hero)

import { app, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

// SVG sources are drawn into a canvas so the PNG keeps its transparency.
const icons = [
  { src: 'src/renderer/img/icon.svg', out: 'build/icon.png', size: 1024 },
  { src: 'src/renderer/img/icon.svg', out: 'src/renderer/img/icon-512.png', size: 512 },
];

const hero = { src: 'scripts/hero/hero.html', out: 'assets/hero.png', width: 1600, height: 560, scale: 2, wait: 3000 };

async function write(out, buf, label) {
  const file = path.join(root, out);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buf);
  console.log(`wrote ${out} (${label})`);
}

async function renderIcons(win) {
  await win.loadURL('about:blank');
  for (const job of icons) {
    const svg = await fs.readFile(path.join(root, job.src), 'utf8');
    const dataUrl = await win.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = c.height = ${job.size};
          c.getContext('2d').drawImage(img, 0, 0, ${job.size}, ${job.size});
          resolve(c.toDataURL('image/png'));
        };
        img.onerror = () => reject(new Error('SVG failed to load'));
        img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
      })
    `);
    await write(job.out, Buffer.from(dataUrl.split(',')[1], 'base64'), `${job.size}x${job.size}`);
  }
}

async function renderHero(win) {
  win.setContentSize(hero.width * hero.scale, hero.height * hero.scale);
  await win.loadFile(path.join(root, hero.src));
  win.webContents.setZoomFactor(hero.scale);
  await new Promise((r) => setTimeout(r, hero.wait));
  const image = await win.webContents.capturePage();
  const s = image.getSize();
  await write(hero.out, image.toPNG(), `${s.width}x${s.height}`);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 400,
    height: 300,
    show: false,
    frame: false,
    useContentSize: true,
    backgroundColor: '#08111b',
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true },
  });
  try {
    await renderIcons(win);
    await renderHero(win);
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
