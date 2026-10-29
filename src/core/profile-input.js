// Turns whatever the user pasted into a profile reference.
// Returns { ok: true, kind: 'id64' | 'vanity', value, via } or { ok: false, error }.

import { isSteamId64, fromSteam2, fromSteam3, fromAccountId, fromInviteCode } from './steamid.js';

const VANITY_RE = /^[A-Za-z0-9_-]{2,32}$/;
const STEAM_HOSTS = new Set(['steamcommunity.com', 'www.steamcommunity.com', 'm.steamcommunity.com']);
const INVITE_HOSTS = new Set(['s.team', 'www.s.team']);

const ok = (kind, value, via) => ({ ok: true, kind, value, via });
const fail = (error) => ({ ok: false, error });

function fromId64Like(segment, via) {
  if (isSteamId64(segment)) return ok('id64', segment, via);
  const s3 = fromSteam3(decodeURIComponent(segment));
  if (s3) return ok('id64', s3, via);
  return null;
}

function parseUrl(text) {
  let candidate = text;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) candidate = 'https://' + candidate;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);

  if (STEAM_HOSTS.has(host)) {
    const [section, id] = parts;
    if (!section) return fail('That Steam link has no profile in it. Paste the link to a profile page.');
    switch (section.toLowerCase()) {
      case 'profiles': {
        if (!id) return fail('That link is missing the SteamID after /profiles/.');
        return fromId64Like(id, 'url') ?? fail(`"${id}" is not a valid SteamID64.`);
      }
      case 'id': {
        if (!id) return fail('That link is missing the custom name after /id/.');
        const vanity = decodeURIComponent(id);
        return VANITY_RE.test(vanity) ? ok('vanity', vanity, 'url') : fail(`"${vanity}" is not a valid custom URL name.`);
      }
      case 'user':
      case 'p': {
        if (!id) return fail('That invite link is missing its friend code.');
        const id64 = fromInviteCode(id);
        return id64 ? ok('id64', id64, 'invite') : fail('That friend invite code could not be decoded. Paste the profile link instead.');
      }
      default:
        return fail('That Steam page is not a profile. Open the profile and copy its address.');
    }
  }

  if (INVITE_HOSTS.has(host)) {
    if (parts[0]?.toLowerCase() === 'p' && parts[1]) {
      const id64 = fromInviteCode(parts[1]);
      return id64 ? ok('id64', id64, 'invite') : fail('That friend invite code could not be decoded. Paste the profile link instead.');
    }
    return fail('That s.team link is not a friend invite. Paste the profile link instead.');
  }

  if (host.includes('.')) return fail(`Links from ${host} are not supported. Paste a steamcommunity.com profile link.`);
  return null;
}

export function parseProfileInput(raw) {
  const text = String(raw ?? '')
    .trim()
    .replace(/^[<"'`]+|[>"'`]+$/g, '')
    .trim();
  if (!text) return fail('Paste a Steam profile link, SteamID or custom URL name.');

  if (isSteamId64(text)) return ok('id64', text, 'id64');

  const s2 = fromSteam2(text);
  if (s2) return ok('id64', s2, 'steam2');
  if (/^STEAM_/i.test(text)) return fail('That STEAM_X:Y:Z id is malformed.');

  const s3 = fromSteam3(text);
  if (s3) return ok('id64', s3, 'steam3');
  if (/^\[?U:/i.test(text)) return fail('That [U:1:N] id is malformed.');

  if (/^\d+$/.test(text)) {
    if (text.length <= 10) {
      const id64 = fromAccountId(text);
      if (id64) return ok('id64', id64, 'friendcode');
    }
    if (text.length === 17) return fail('That 17-digit number is not a valid SteamID64.');
    return fail('That number is not a SteamID64 or a friend code.');
  }

  if (/[/.]/.test(text)) {
    const fromUrl = parseUrl(text);
    if (fromUrl) return fromUrl;
  }

  if (VANITY_RE.test(text)) return ok('vanity', text, 'vanity');
  return fail('That does not look like a Steam profile. Try a profile link, a SteamID64 or a custom URL name.');
}
