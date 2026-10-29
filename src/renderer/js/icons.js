// Inline SVG icons drawn on a 24px grid with a 1.7px stroke.

const P = {
  overview: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l3.6-4.6"/><circle cx="12" cy="16" r="1.3"/><path d="M4 19.5h16"/>',
  inventory: '<path d="M12 3.2l8 4.4v8.8L12 20.8l-8-4.4V7.6z"/><path d="M4 7.6l8 4.4 8-4.4M12 12v8.8"/>',
  library: '<path d="M7.2 8.5h9.6a4 4 0 0 1 3.9 4.8l-.9 4a2.1 2.1 0 0 1-3.7.9l-1.6-2.1H9.5l-1.6 2.1a2.1 2.1 0 0 1-3.7-.9l-.9-4a4 4 0 0 1 3.9-4.8z"/><path d="M8.2 11.3v3M6.7 12.8h3"/><circle cx="15.6" cy="12" r=".7"/><circle cx="17.4" cy="13.7" r=".7"/>',
  history: '<path d="M3.5 19.5h17"/><path d="M5 15.5l4.2-4.3 3.4 2.9 6.4-7"/><path d="M15.6 7.1H19v3.4"/>',
  share: '<path d="M12 14.5V3.6"/><path d="M8.2 7.2L12 3.4l3.8 3.8"/><path d="M8.6 10.2H7.2a2.2 2.2 0 0 0-2.2 2.2v6a2.2 2.2 0 0 0 2.2 2.2h9.6a2.2 2.2 0 0 0 2.2-2.2v-6a2.2 2.2 0 0 0-2.2-2.2h-1.4"/>',
  settings: '<path d="M4 7.5h9M17.5 7.5H20M4 16.5h2.5M11 16.5h9"/><circle cx="15.2" cy="7.5" r="2.2"/><circle cx="8.8" cy="16.5" r="2.2"/>',
  search: '<circle cx="10.6" cy="10.6" r="6.1"/><path d="M15.2 15.2l4.8 4.8"/>',
  refresh: '<path d="M19.4 12.6a7.5 7.5 0 1 1-2.3-6.1"/><path d="M19.4 4.6v4.2h-4.2"/>',
  lock: '<rect x="5.2" y="10.6" width="13.6" height="9.6" rx="2.6"/><path d="M8.4 10.6V8.2a3.6 3.6 0 0 1 7.2 0v2.4"/>',
  warn: '<path d="M10.3 4.6a2 2 0 0 1 3.4 0l7 12.2a2 2 0 0 1-1.7 3H5a2 2 0 0 1-1.7-3z"/><path d="M12 9.6v4"/><path d="M12 16.9h.01"/>',
  info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.2"/><path d="M12 7.9h.01"/>',
  external: '<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5L11 13"/><path d="M18 14.5v3.3a1.7 1.7 0 0 1-1.7 1.7H6.2a1.7 1.7 0 0 1-1.7-1.7V7.7A1.7 1.7 0 0 1 6.2 6h3.3"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  chevron: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
  check: '<path d="M5.2 12.6l4.4 4.4 9.2-9.6"/>',
  command: '<path d="M9 9V6.6A2.4 2.4 0 1 0 6.6 9H9zm0 0h6M9 9v6m6-6V6.6A2.4 2.4 0 1 1 17.4 9H15zm0 0v6m0 0H9m6 0v2.4a2.4 2.4 0 1 0 2.4-2.4H15zm-6 0v2.4A2.4 2.4 0 1 1 6.6 15H9z"/>',
  shield: '<path d="M12 3.4l7 2.9v5.5c0 4.3-2.9 7.6-7 9.2-4.1-1.6-7-4.9-7-9.2V6.3z"/><path d="M9.1 12.2l2.1 2.1 3.8-4"/>',
  shieldX: '<path d="M12 3.4l7 2.9v5.5c0 4.3-2.9 7.6-7 9.2-4.1-1.6-7-4.9-7-9.2V6.3z"/><path d="M9.8 9.8l4.4 4.4M14.2 9.8l-4.4 4.4"/>',
  clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.6V12l2.9 1.9"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.6"/><path d="M4 10h16M8.5 3.5v3.5M15.5 3.5v3.5"/>',
  trash: '<path d="M5 7h14M10 7V5.2h4V7"/><path d="M6.8 7l.8 11.3a1.8 1.8 0 0 0 1.8 1.7h5.2a1.8 1.8 0 0 0 1.8-1.7L17.2 7"/>',
  folder: '<path d="M3.8 7.4a2 2 0 0 1 2-2h3.6l2 2.2h6.8a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2H5.8a2 2 0 0 1-2-2z"/>',
  key: '<circle cx="8" cy="15.5" r="3.6"/><path d="M10.6 13l7.9-7.9M15.6 8l2.3 2.3M13.4 10.2l1.7 1.7"/>',
  cookie: '<path d="M20 12.4A8 8 0 1 1 11.6 4a3 3 0 0 0 3.6 3.6 3 3 0 0 0 4.8 4.8z"/><path d="M8.5 10.5h.01M9.5 15.5h.01M14.5 14.5h.01"/>',
  photo: '<rect x="3.8" y="5" width="16.4" height="14" rx="2.6"/><circle cx="9" cy="10" r="1.6"/><path d="M20.2 15.2l-4.4-4.2-7.3 8"/>',
  sparkles: '<path d="M12 3.6l1.7 4.6 4.7 1.8-4.7 1.7L12 16.4l-1.7-4.7-4.7-1.7 4.7-1.8z"/><path d="M18.4 15.2l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  user: '<circle cx="12" cy="8.6" r="3.8"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/>',
  bolt: '<path d="M13.2 3.4L5.6 13.2h6l-1 7.4 7.8-10h-6.2z"/>',
  wallet: '<path d="M4 7.6A2.6 2.6 0 0 1 6.6 5h10.2v3"/><rect x="4" y="8" width="16" height="11.4" rx="2.6"/><path d="M15.6 13.7h.01"/>',
  cash: '<rect x="3.4" y="6.4" width="17.2" height="11.2" rx="2.4"/><circle cx="12" cy="12" r="2.6"/><path d="M6.6 9.6v.01M17.4 14.4v.01"/>',
  hourglass: '<path d="M7 3.8h10M7 20.2h10"/><path d="M8 3.8v2.8a4 4 0 0 0 1.6 3.2L12 12l2.4-2.2A4 4 0 0 0 16 6.6V3.8M8 20.2v-2.8a4 4 0 0 1 1.6-3.2L12 12l2.4 2.2a4 4 0 0 1 1.6 3.2v2.8"/>',
  tag: '<path d="M3.8 12.3V5.6a1.8 1.8 0 0 1 1.8-1.8h6.7l8 8a1.8 1.8 0 0 1 0 2.5l-6.2 6.2a1.8 1.8 0 0 1-2.5 0z"/><circle cx="8.2" cy="8.2" r="1.4"/>',
  layers: '<path d="M12 4l8.4 4.4L12 12.8 3.6 8.4z"/><path d="M3.6 12.2L12 16.6l8.4-4.4M3.6 16L12 20.4l8.4-4.4"/>',
  eyeOff: '<path d="M4 4l16 16"/><path d="M9.9 6.3A9 9 0 0 1 12 6c5 0 8.4 4.4 9 6-.3.9-1.2 2.3-2.6 3.6M6.4 7.9C4.8 9.1 3.5 10.8 3 12c.6 1.6 4 6 9 6a9 9 0 0 0 3.5-.7"/><path d="M9.9 10a3 3 0 0 0 4.2 4.1"/>',
  download: '<path d="M12 4v11"/><path d="M7.6 10.8L12 15.2l4.4-4.4"/><path d="M5 19.4h14"/>',
  home: '<path d="M4.2 11L12 4.4l7.8 6.6"/><path d="M6.4 9.4v9.4a1.4 1.4 0 0 0 1.4 1.4h8.4a1.4 1.4 0 0 0 1.4-1.4V9.4"/>',
  case: '<rect x="3.6" y="6.6" width="16.8" height="12.8" rx="2.6"/><path d="M9 6.6V5.2a1.4 1.4 0 0 1 1.4-1.4h3.2A1.4 1.4 0 0 1 15 5.2v1.4M3.6 12h16.8"/>',
  knife: '<path d="M4 20l7.4-7.4"/><path d="M11.4 12.6L19.6 4.4c.6 3.6-.8 7.2-4 9.4l-1.6-1.6"/>',
  card: '<rect x="6" y="3.6" width="12" height="16.8" rx="2.2"/><path d="M9 8h6M9 11h6M9 14h3.6"/>',
  gem: '<path d="M7 4.6h10l3.4 4.6L12 19.8 3.6 9.2z"/><path d="M3.6 9.2h16.8M9.6 4.6L8.4 9.2 12 19.8l3.6-10.6-1.2-4.6"/>',
  medal: '<circle cx="12" cy="14.6" r="5.2"/><path d="M8.8 10.4L6.4 3.8h4l1.6 4M15.2 10.4l2.4-6.6h-4L12 7.8"/><path d="M12 12.4v4.4"/>',
  sticker: '<path d="M20 12a8 8 0 1 1-8-8"/><path d="M20 12h-4.6A3.4 3.4 0 0 1 12 8.6V4l8 8z"/>',
  gun: '<path d="M3.6 9.4h15l1.8-1.6v3.6h-6.2l-1 2.6h-3l-1.4 5.6H5.6l1.6-6.6H3.6z"/>',
  sun: '<circle cx="12" cy="12" r="3.6"/><path d="M12 3.6v1.8M12 18.6v1.8M3.6 12h1.8M18.6 12h1.8M6 6l1.3 1.3M16.7 16.7L18 18M6 18l1.3-1.3M16.7 7.3L18 6"/>',
  dots: '<circle cx="6" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18" cy="12" r="1"/>',
  minus: '<path d="M6 12h12"/>',
};

const TRAFFIC = {
  close: '<path d="M2.2 2.2l3.6 3.6M5.8 2.2L2.2 5.8"/>',
  min: '<path d="M1.6 4h4.8"/>',
  zoom: '<path d="M2 5.6V2h3.6M6 2.4v3.6H2.4"/>',
};

const NS = 'http://www.w3.org/2000/svg';

function build(markup, viewBox, cls) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', cls);
  // Static markup from this file only; never user data.
  svg.innerHTML = markup;
  return svg;
}

export function icon(name, cls = '') {
  return build(P[name] ?? P.info, '0 0 24 24', `icon-stroke ${cls}`.trim());
}

export function trafficGlyph(name) {
  return build(TRAFFIC[name], '0 0 8 8', '');
}

// Picks a placeholder glyph for an item that has no icon.
export function placeholderIconFor(item) {
  const t = `${item.category ?? ''} ${item.typeLine ?? ''} ${item.name ?? ''}`.toLowerCase();
  if (/knife|★/.test(t)) return 'knife';
  if (/glove/.test(t)) return 'knife';
  if (/sticker|patch|graffiti/.test(t)) return 'sticker';
  if (/case|container|chest|treasure|capsule/.test(t)) return 'case';
  if (/coin|medal|pin|badge|collectible/.test(t)) return 'medal';
  if (/card/.test(t)) return 'card';
  if (/gem/.test(t)) return 'gem';
  if (/rifle|pistol|smg|sniper|shotgun|machinegun/.test(t)) return 'gun';
  return 'inventory';
}
