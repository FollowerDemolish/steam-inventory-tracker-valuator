import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateFees, sellerReceives, amountToSendForReceived } from '../src/core/fees.js';

test('matches known Steam fee splits', () => {
  // Buyer pays -> seller receives (5% Steam fee + 10% publisher fee, each at least 0.01).
  const known = { 3: 1, 2: 0, 4: 2, 20: 18, 100: 88, 115: 100, 3190: 2775, 149500: 130000 };
  for (const [paid, received] of Object.entries(known)) {
    assert.equal(sellerReceives(Number(paid)), received, `paid ${paid}`);
  }
});

test('fee split always adds back up to the buyer price', () => {
  for (let amount = 3; amount <= 20000; amount += amount < 500 ? 1 : 37) {
    const f = calculateFees(amount);
    assert.equal(f.amount, amount, `amount ${amount}`);
    assert.equal(f.fees, f.steamFee + f.publisherFee);
    assert.ok(f.steamFee >= 1 && f.publisherFee >= 1, `minimum fees at ${amount}`);
  }
});

test('received amount never decreases as the price rises', () => {
  let prev = 0;
  for (let amount = 3; amount <= 5000; amount++) {
    const r = sellerReceives(amount);
    assert.ok(r >= prev, `monotonic at ${amount}`);
    prev = r;
  }
});

test('forward and reverse calculations agree', () => {
  for (const received of [1, 7, 88, 1000, 2775, 130000]) {
    const sent = amountToSendForReceived(received).amount;
    assert.equal(sellerReceives(sent), received, `received ${received}`);
  }
});

test('handles empty and invalid amounts', () => {
  assert.equal(sellerReceives(0), 0);
  assert.equal(sellerReceives(-5), 0);
  assert.equal(sellerReceives(NaN), 0);
  assert.equal(sellerReceives(1), 0);
});
