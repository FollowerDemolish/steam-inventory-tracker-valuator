// Small DOM toolkit: element builder, money rendering, images and motion.

import { moneyParts, formatMoney } from '../../core/format.js';
import { displayRarityColor } from '../../core/rarity.js';
import { icon, placeholderIconFor } from './icons.js';

// h('div.cls#id', { on: { click }, style: { '--x': 1 }, attrs }, ...children)
export function h(tag, props = null, ...children) {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag);
  const el = document.createElement(m?.[1] || 'div');
  for (const part of (m?.[2] ?? '').match(/[.#][\w-]+/g) ?? []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'style') for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk, String(sv));
      else if (k === 'class') el.className += ` ${v}`;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Replaces an element's children, skipping null and false.
export function fill(el, ...children) {
  clear(el);
  return append(el, children);
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

// Renders money with a quieter symbol and decimals.
export function money(cents, code, cls = 'money') {
  const el = h(`span.${cls}`);
  setMoney(el, cents, code);
  return el;
}

export function setMoney(el, cents, code) {
  clear(el);
  el.setAttribute('aria-label', formatMoney(cents, code));
  if (cents == null || !Number.isFinite(cents)) {
    el.append(document.createTextNode('—'));
    return;
  }
  for (const p of moneyParts(cents, code)) {
    if (p.type === 'currency') el.append(h('span.sym', { 'aria-hidden': 'true' }, p.value));
    else if (p.type === 'decimal' || p.type === 'fraction') {
      let dec = el.querySelector(':scope > .dec');
      if (!dec) {
        dec = h('span.dec', { 'aria-hidden': 'true' });
        el.append(dec);
      }
      dec.append(p.value);
    } else if (p.type === 'literal' && /^\s+$/.test(p.value)) el.append('\u2009');
    else el.append(h('span', { 'aria-hidden': 'true' }, p.value));
  }
}

export function reducedMotion() {
  const pref = document.documentElement.dataset.motion;
  if (pref === 'reduce') return true;
  if (pref === 'full') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Count-up with a critically damped spring: x(t) = 1 - (1 + wt) e^(-wt).
export function countUp(el, from, to, code, { duration = 1100 } = {}) {
  if (el._raf) cancelAnimationFrame(el._raf);
  if (reducedMotion() || from == null || to == null || from === to) {
    setMoney(el, to, code);
    return;
  }
  const w = 9 / (duration / 1000);
  const start = performance.now();
  const tick = (now) => {
    const t = (now - start) / 1000;
    const p = t * 1000 >= duration ? 1 : 1 - (1 + w * t) * Math.exp(-w * t);
    setMoney(el, Math.round(from + (to - from) * p), code);
    if (p < 1) el._raf = requestAnimationFrame(tick);
    else el._raf = null;
  };
  el._raf = requestAnimationFrame(tick);
}

export function econUrl(hash, size = 256) {
  return hash ? `app://glasscase/img/econ/${hash}/${size}` : null;
}

export function avatarUrl(url) {
  if (!url) return null;
  if (url.startsWith('app://')) return url;
  return `app://glasscase/img/avatar?u=${encodeURIComponent(url)}`;
}

// Item art with an offline placeholder that keeps the rarity light.
export function itemArt(item, size = 256) {
  const ph = () => h('div.placeholder', { 'aria-hidden': 'true' }, icon(placeholderIconFor(item)));
  const src = econUrl(item.iconUrl, size);
  if (!src) return ph();
  const img = h('img', { src, alt: '', decoding: 'async', loading: 'lazy', draggable: 'false' });
  img.addEventListener('error', () => img.replaceWith(ph()), { once: true });
  return img;
}

export function rarityStyle(item) {
  return { '--rarity': displayRarityColor(item) };
}

// Generated avatar for the demo profile and for profiles without one.
export function avatar(profile, cls = 'avatar') {
  const fallback = () => {
    const c = h('canvas', { class: cls, width: 96, height: 96, 'aria-hidden': 'true' });
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 96, 96);
    grad.addColorStop(0, '#66c0f4');
    grad.addColorStop(1, '#1a3f8f');
    g.fillStyle = grad;
    g.fillRect(0, 0, 96, 96);
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.font = '700 46px Inter';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText((profile?.name ?? '?').trim().charAt(0).toUpperCase() || '?', 48, 52);
    return c;
  };
  const src = avatarUrl(profile?.avatar);
  if (!src) return fallback();
  const img = h('img', { class: cls, src, alt: '', draggable: 'false' });
  img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
  return img;
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

// Moves the sliding thumb of a segmented control under the checked button.
export function syncSeg(seg) {
  const thumb = seg.querySelector('.thumb');
  const on = seg.querySelector('button[aria-checked="true"]');
  if (!thumb || !on) return;
  const apply = () => {
    thumb.style.width = `${on.offsetWidth}px`;
    thumb.style.transform = `translateX(${on.offsetLeft}px)`;
  };
  if (on.offsetWidth) apply();
  else requestAnimationFrame(apply);
}

export function segmented(options, value, onChange, label) {
  const seg = h('div.seg', { role: 'radiogroup', 'aria-label': label });
  seg.append(h('span.thumb', { 'aria-hidden': 'true' }));
  const buttons = options.map((o) =>
    h('button', {
      type: 'button',
      role: 'radio',
      'aria-checked': String(o.value === value),
      tabindex: o.value === value ? '0' : '-1',
      on: {
        click: () => {
          for (const b of buttons) {
            b.setAttribute('aria-checked', String(b === btnFor(o.value)));
            b.tabIndex = b === btnFor(o.value) ? 0 : -1;
          }
          syncSeg(seg);
          onChange(o.value);
        },
        keydown: (e) => {
          if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
          e.preventDefault();
          const i = buttons.indexOf(e.currentTarget);
          const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
          next.focus();
          next.click();
        },
      },
    }, o.label, o.sub != null ? h('span.sub', o.sub) : null),
  );
  const btnFor = (v) => buttons[options.findIndex((o) => o.value === v)];
  seg.append(...buttons);
  requestAnimationFrame(() => syncSeg(seg));
  return seg;
}

export function toggle(labelText, checked, onChange) {
  const btn = h('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': String(Boolean(checked)),
    'aria-label': labelText,
    on: {
      click: () => {
        const next = btn.getAttribute('aria-checked') !== 'true';
        btn.setAttribute('aria-checked', String(next));
        onChange(next);
      },
    },
  });
  return h('label.switch', btn, h('span', labelText));
}
