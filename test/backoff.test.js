import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBackoff, parseRetryAfter, withBackoff, createThrottle, HttpError, RateLimitError } from '../src/core/backoff.js';

test('backoff grows exponentially, is capped and jittered', () => {
  const mid = () => 0.5;
  assert.equal(computeBackoff(0, { baseMs: 1000, random: mid }), 1000);
  assert.equal(computeBackoff(1, { baseMs: 1000, random: mid }), 2000);
  assert.equal(computeBackoff(3, { baseMs: 1000, random: mid }), 8000);
  assert.equal(computeBackoff(20, { baseMs: 1000, maxMs: 30000, random: mid }), 30000);
  assert.equal(computeBackoff(1, { baseMs: 1000, jitter: 0.25, random: () => 0 }), 1500);
  assert.equal(computeBackoff(1, { baseMs: 1000, jitter: 0.25, random: () => 1 }), 2500);
});

test('reads Retry-After as seconds or as an HTTP date', () => {
  assert.equal(parseRetryAfter('120'), 120000);
  const now = Date.parse('2026-10-29T12:00:00Z');
  assert.equal(parseRetryAfter('Thu, 29 Oct 2026 12:01:00 GMT', now), 60000);
  assert.equal(parseRetryAfter(''), null);
  assert.equal(parseRetryAfter('soon'), null);
});

test('retries 429 and 5xx, honouring Retry-After', async () => {
  const waits = [];
  let calls = 0;
  const result = await withBackoff(async () => {
    calls++;
    if (calls === 1) throw new HttpError(429, 'slow down', { retryAfterMs: 3000 });
    if (calls === 2) throw new HttpError(503, 'busy');
    return 'ok';
  }, { retries: 3, baseMs: 100, random: () => 0.5, sleep: async (ms) => waits.push(ms) });
  assert.equal(result, 'ok');
  assert.deepEqual(waits, [3000, 200]);
});

test('turns a persistent 429 into a RateLimitError with a retry time', async () => {
  await assert.rejects(
    withBackoff(async () => { throw new HttpError(429, 'nope'); }, { service: 'Steam', retries: 1, baseMs: 10, sleep: async () => {} }),
    (err) => err instanceof RateLimitError && err.retryInMs >= 60000 && /rate-limiting/.test(err.message),
  );
});

test('fails fast when Retry-After is longer than we are willing to wait', async () => {
  let slept = false;
  await assert.rejects(
    withBackoff(async () => { throw new HttpError(429, 'nope', { retryAfterMs: 600000 }); }, { retries: 3, maxWaitMs: 45000, sleep: async () => { slept = true; } }),
    (err) => err instanceof RateLimitError && err.retryInMs === 600000,
  );
  assert.equal(slept, false);
});

test('does not retry client errors', async () => {
  let calls = 0;
  await assert.rejects(withBackoff(async () => { calls++; throw new HttpError(403, 'private'); }, { retries: 3, sleep: async () => {} }), HttpError);
  assert.equal(calls, 1);
});

test('throttle keeps a minimum gap between calls', async () => {
  let clock = 0;
  const sleeps = [];
  const run = createThrottle(1000, { now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } });
  const order = [];
  await Promise.all([1, 2, 3].map((n) => run(async () => order.push([n, clock]))));
  assert.deepEqual(order, [[1, 0], [2, 1000], [3, 2000]]);
  assert.deepEqual(sleeps, [1000, 1000]);
});
