// Minimal logger that never prints secrets in full.

const SECRET_PATTERNS = [
  [/([?&]key=)[^&\s]+/gi, '$1<redacted>'],
  [/(steamLoginSecure=)[^;\s]+/gi, '$1<redacted>'],
];

export function redact(text) {
  let s = String(text);
  for (const [re, rep] of SECRET_PATTERNS) s = s.replace(re, rep);
  return s;
}

export function createLogger({ quiet = false } = {}) {
  const write = (level, args) => {
    if (quiet && level === 'debug') return;
    const line = args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    const out = `[glasscase] ${level}: ${redact(line)}`;
    if (level === 'error' || level === 'warn') console.error(out);
    else console.log(out);
  };
  return {
    debug: (...a) => write('debug', a),
    info: (...a) => write('info', a),
    warn: (...a) => write('warn', a),
    error: (...a) => write('error', a),
  };
}
