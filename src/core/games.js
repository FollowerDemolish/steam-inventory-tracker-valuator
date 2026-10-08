// Games whose inventories Glasscase knows how to read.

export const GAMES = Object.freeze([
  { appid: 730, contextid: 2, name: 'Counter-Strike 2', short: 'CS2', skinport: true, color: '#e4ae39' },
  { appid: 570, contextid: 2, name: 'Dota 2', short: 'Dota 2', skinport: true, color: '#d6453a' },
  { appid: 440, contextid: 2, name: 'Team Fortress 2', short: 'TF2', skinport: true, color: '#cf6a32' },
  { appid: 252490, contextid: 2, name: 'Rust', short: 'Rust', skinport: true, color: '#ce422b' },
  { appid: 753, contextid: 6, name: 'Steam Community', short: 'Steam', skinport: false, color: '#66c0f4' },
]);

export const DEFAULT_GAME_IDS = Object.freeze([730, 570, 753]);

export function gameById(appid) {
  return GAMES.find((g) => g.appid === Number(appid)) ?? null;
}

export function gameName(appid) {
  return gameById(appid)?.name ?? `App ${appid}`;
}

export function gameShort(appid) {
  return gameById(appid)?.short ?? `App ${appid}`;
}

// Parses a custom "appid/contextid" entry such as "232090/2".
export function parseCustomContext(text) {
  const m = /^\s*(\d{1,10})\s*\/\s*(\d{1,10})\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  return { appid: Number(m[1]), contextid: Number(m[2]) };
}

export function skinportSupports(appid) {
  return Boolean(gameById(appid)?.skinport);
}
