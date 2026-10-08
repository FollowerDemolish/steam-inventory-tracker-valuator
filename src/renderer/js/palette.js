// Command palette (Ctrl/Cmd+K): jump anywhere, run actions, find items.

import { h, econUrl } from './dom.js';
import { icon } from './icons.js';
import { relativeTime } from '../../core/format.js';

let open = null;

export function isPaletteOpen() {
  return Boolean(open);
}

export function closePalette() {
  if (!open) return false;
  open.overlay.remove();
  open.box.remove();
  open.restore?.focus?.();
  open = null;
  return true;
}

function score(text, q) {
  const t = text.toLowerCase();
  if (!q) return 1;
  if (t.startsWith(q)) return 3;
  if (t.includes(` ${q}`)) return 2;
  if (t.includes(q)) return 1;
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length ? 0.5 : 0;
}

export function openPalette({ commands, items, recent, isMac }) {
  if (open) return closePalette();
  const restore = document.activeElement;
  const input = h('input', { type: 'text', placeholder: 'Search commands, items and profiles', 'aria-label': 'Command palette', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palette-list', autocomplete: 'off', spellcheck: 'false' });
  const list = h('div.list#palette-list', { role: 'listbox' });
  let flat = [];
  let index = 0;
  const mod = isMac ? '⌘' : 'Ctrl';

  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const groups = [];
    const cmd = commands.map((c) => ({ ...c, s: score(c.label, q) })).filter((c) => c.s > 0 && !c.hidden).sort((a, b) => b.s - a.s);
    if (cmd.length) groups.push(['Commands', cmd]);
    if (recent.length) {
      const rs = recent.map((r) => ({ label: r.name ?? r.steamid, sub: `Scanned ${relativeTime(r.at)}`, icon: 'user', run: r.run, s: score(r.name ?? r.steamid, q) })).filter((r) => r.s > 0);
      if (rs.length) groups.push(['Recent profiles', rs.slice(0, 5)]);
    }
    if (q && items.length) {
      const its = items.map((it) => ({ ...it, s: score(it.label, q) })).filter((it) => it.s > 0).sort((a, b) => b.s - a.s).slice(0, 8);
      if (its.length) groups.push(['Items', its]);
    }
    flat = groups.flatMap(([, g]) => g);
    index = Math.min(index, Math.max(0, flat.length - 1));
    while (list.firstChild) list.firstChild.remove();
    if (!flat.length) {
      list.append(h('div.none', 'Nothing matches. Try an item name or a command like “inventory”.'));
      return;
    }
    let n = 0;
    for (const [title, g] of groups) {
      list.append(h('div.group', { role: 'presentation' }, title));
      for (const c of g) {
        const i = n++;
        const opt = h('div.opt', {
          role: 'option', id: `opt-${i}`, 'aria-selected': String(i === index),
          on: { mousemove: () => { if (index !== i) { index = i; mark(); } }, click: () => run(i) },
        },
          c.iconUrl ? h('img', { src: econUrl(c.iconUrl, 64), alt: '' }) : icon(c.icon ?? 'chevron'),
          h('span', c.label),
          c.sub ? h('span.hint', c.sub) : c.keys ? h('span.hint', c.keys.map((k) => h('span.kbd', k === 'mod' ? mod : k))) : null,
        );
        list.append(opt);
      }
    }
    input.setAttribute('aria-activedescendant', `opt-${index}`);
  };

  const mark = () => {
    list.querySelectorAll('.opt').forEach((o, i) => o.setAttribute('aria-selected', String(i === index)));
    input.setAttribute('aria-activedescendant', `opt-${index}`);
    list.querySelector(`#opt-${index}`)?.scrollIntoView({ block: 'nearest' });
  };

  const run = (i) => {
    const c = flat[i];
    if (!c) return;
    closePalette();
    c.run();
  };

  input.addEventListener('input', () => {
    index = 0;
    draw();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      index = Math.min(flat.length - 1, index + 1);
      mark();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      index = Math.max(0, index - 1);
      mark();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(index);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePalette();
    } else if (e.key === 'Tab') {
      e.preventDefault();
    }
  });

  const box = h('div.palette', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' },
    h('div.pin', icon('search'), input, h('span.kbd', 'esc')),
    list,
    h('div.foot', h('span', h('span.kbd', '↑'), h('span.kbd', '↓'), 'to move'), h('span', h('span.kbd', '↵'), 'to open'), h('span', h('span.kbd', mod), h('span.kbd', 'K'), 'to toggle')),
  );
  const overlay = h('div.overlay', { on: { click: closePalette } });
  document.body.append(overlay, box);
  open = { box, overlay, restore };
  draw();
  input.focus();
}
