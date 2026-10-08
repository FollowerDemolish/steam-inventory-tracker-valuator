import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice, parseVolume } from '../src/core/price-parse.js';

// Steam's ruble suffix, written as escapes to keep the source ASCII.
const RUB = 'p\u0443\u0431.';

test('parses Steam locale price strings into cents', () => {
  const cases = {
    '$31.90': 3190,
    '$1,234.56': 123456,
    '31,90€': 3190,
    '1.234,56€': 123456,
    '12,--€': 1200,
    [`1 234,56 ${RUB}`]: 123456,
    [`1\u00a0234,56 ${RUB}`]: 123456,
    [`57 ${RUB}`]: 5700,
    'R$ 12,34': 1234,
    '£0.03': 3,
    "CHF 1'234.50": 123450,
    'CHF 12.50': 1250,
    '12,34 zł': 1234,
    '100,50₴': 10050,
    'Rp 12 345': 1234500,
    '₩ 1,234': 123400,
    '¥ 45.10': 4510,
    'S$1.20': 120,
    '฿35.00': 3500,
    '1.234₫': 123400,
    '12,5 kr': 1250,
    '0,03 TL': 3,
    '₸ 1 234': 123400,
  };
  for (const [input, cents] of Object.entries(cases)) assert.equal(parsePrice(input), cents, input);
});

test('returns null when there is no price', () => {
  for (const v of [null, undefined, '', '--', 'free', 'N/A']) assert.equal(parsePrice(v), null, String(v));
});

test('accepts plain numbers in major units', () => {
  assert.equal(parsePrice(32.2), 3220);
  assert.equal(parsePrice(0.1 + 0.2), 30);
});

test('parses volume strings', () => {
  assert.equal(parseVolume('67'), 67);
  assert.equal(parseVolume('113,287'), 113287);
  assert.equal(parseVolume(null), null);
});
