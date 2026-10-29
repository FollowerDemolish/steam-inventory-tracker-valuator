// Reads Steam's public profile XML (steamcommunity.com/.../?xml=1).
// A tiny tag reader is enough: the document is flat and values are CDATA.

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

export function readTag(xml, tag) {
  const re = new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${tag}>`);
  const m = re.exec(xml);
  if (!m) return null;
  const v = m[1] ?? decodeEntities(m[2] ?? '');
  return v.trim();
}

export function parseProfileXml(xml) {
  const text = String(xml ?? '');
  const error = readTag(text, 'error');
  if (error) return { ok: false, error };
  const id64 = readTag(text, 'steamID64');
  if (!id64) return { ok: false, error: 'Steam returned a page without a profile.' };

  const memberSince = readTag(text, 'memberSince');
  const created = memberSince ? Date.parse(memberSince) : NaN;
  const num = (v) => (v == null || v === '' ? null : Number(v));

  return {
    ok: true,
    profile: {
      steamid: id64,
      name: readTag(text, 'steamID') ?? 'Unknown',
      avatar: readTag(text, 'avatarFull') ?? readTag(text, 'avatarMedium') ?? readTag(text, 'avatarIcon'),
      onlineState: readTag(text, 'onlineState'),
      privacy: readTag(text, 'privacyState') ?? 'unknown',
      visibility: num(readTag(text, 'visibilityState')),
      created: Number.isFinite(created) ? created : null,
      memberSince,
      vacBanned: readTag(text, 'vacBanned') === '1',
      tradeBanState: readTag(text, 'tradeBanState') ?? 'None',
      limited: readTag(text, 'isLimitedAccount') === '1',
      customUrl: readTag(text, 'customURL') || null,
      location: readTag(text, 'location') || null,
      level: null,
      source: 'xml',
    },
  };
}
