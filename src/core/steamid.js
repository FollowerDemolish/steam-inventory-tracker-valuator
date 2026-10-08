// SteamID helpers. Pure functions, no I/O.
// SteamID64 for an individual account = BASE + accountId.

export const BASE = 76561197960265728n;
const MAX_ACCOUNT_ID = 0xffffffffn;

// Steam "quick invite" short codes (s.team/p/xxxx-xxxx) encode the account id
// in hex, with each hex digit swapped for a consonant from this alphabet.
// TODO(verify): decode a real s.team/p/ link against its profile.
const INVITE_ALPHABET = 'bcdfghjkmnpqrtvw';
const HEX = '0123456789abcdef';

export function isSteamId64(value) {
  const s = String(value ?? '').trim();
  if (!/^7656119\d{10}$/.test(s)) return false;
  const n = BigInt(s);
  return n > BASE && n - BASE <= MAX_ACCOUNT_ID;
}

export function fromAccountId(accountId) {
  const n = BigInt(accountId);
  if (n <= 0n || n > MAX_ACCOUNT_ID) return null;
  return (BASE + n).toString();
}

export function toAccountId(id64) {
  if (!isSteamId64(id64)) return null;
  return Number(BigInt(id64) - BASE);
}

// STEAM_X:Y:Z (legacy SteamID2). X is the universe and is ignored for individuals.
export function fromSteam2(value) {
  const m = /^STEAM_[0-5]:([01]):(\d{1,10})$/i.exec(String(value).trim());
  if (!m) return null;
  const y = BigInt(m[1]);
  const z = BigInt(m[2]);
  return fromAccountId(z * 2n + y);
}

// [U:1:N] or U:1:N (SteamID3).
export function fromSteam3(value) {
  const m = /^\[?U:1:(\d{1,10})\]?$/i.exec(String(value).trim());
  if (!m) return null;
  return fromAccountId(m[1]);
}

export function toSteam2(id64) {
  const acc = toAccountId(id64);
  if (acc == null) return null;
  return `STEAM_1:${acc % 2}:${Math.floor(acc / 2)}`;
}

export function toSteam3(id64) {
  const acc = toAccountId(id64);
  if (acc == null) return null;
  return `[U:1:${acc}]`;
}

export function fromInviteCode(code) {
  const clean = String(code ?? '').trim().toLowerCase().replace(/-/g, '');
  if (!clean || clean.length > 8) return null;
  let hex = '';
  for (const ch of clean) {
    const i = INVITE_ALPHABET.indexOf(ch);
    if (i < 0) return null;
    hex += HEX[i];
  }
  return fromAccountId(BigInt('0x' + hex));
}

export function toInviteCode(id64) {
  const acc = toAccountId(id64);
  if (acc == null) return null;
  const mapped = acc.toString(16).split('').map((h) => INVITE_ALPHABET[HEX.indexOf(h)]).join('');
  const half = Math.ceil(mapped.length / 2);
  return mapped.length > 3 ? `${mapped.slice(0, half)}-${mapped.slice(half)}` : mapped;
}
