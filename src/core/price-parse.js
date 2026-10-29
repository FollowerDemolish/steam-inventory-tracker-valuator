// Parses Steam's locale-formatted price strings into integer minor units (cents).
// Examples: "$31.90", "31,90€", "1 234,56 p\u0443\u0431." (rubles), "R$ 12,34", "CHF 1'234.50",
// "12,--€", "Rp 12 345", "₩ 1,234". Returns null when no price is present.

const GROUP_CHARS = /[\s\u00a0\u202f\u2009']/g;

export function parsePrice(text) {
  if (text == null) return null;
  if (typeof text === 'number') return Number.isFinite(text) ? Math.round(text * 100) : null;
  let s = String(text).trim();
  if (!s) return null;

  // Whole-unit prices like "12,--€" or "12.--".
  s = s.replace(/([.,])\s*[-–—]{1,2}(?!\d)/, (_, sep) => `${sep}00`);

  // Take the first run that starts and ends with a digit. This drops currency
  // symbols and abbreviations that carry their own dots (the ruble's, "kr.").
  const m = /\d(?:[\d\s\u00a0\u202f\u2009'.,]*\d)?/.exec(s);
  if (!m) return null;
  let num = m[0].replace(GROUP_CHARS, '');

  const lastComma = num.lastIndexOf(',');
  const lastDot = num.lastIndexOf('.');
  let decimalSep = null;

  if (lastComma >= 0 && lastDot >= 0) {
    decimalSep = lastComma > lastDot ? ',' : '.';
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const count = num.split(sep).length - 1;
    const digitsAfter = num.length - num.lastIndexOf(sep) - 1;
    // A single separator followed by one or two digits is a decimal mark.
    // Three digits after it, or repeated separators, means grouping.
    if (count === 1 && digitsAfter > 0 && digitsAfter <= 2) decimalSep = sep;
  }

  let intPart = num;
  let fracPart = '';
  if (decimalSep) {
    const i = num.lastIndexOf(decimalSep);
    intPart = num.slice(0, i);
    fracPart = num.slice(i + 1);
  }
  intPart = intPart.replace(/[.,]/g, '');
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;

  const cents = Number(intPart || '0') * 100 + Number((fracPart + '00').slice(0, 2));
  return Number.isFinite(cents) ? cents : null;
}

// Parses Steam's integer-ish volume strings ("1,234", "67").
export function parseVolume(text) {
  if (text == null) return null;
  const digits = String(text).replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}
