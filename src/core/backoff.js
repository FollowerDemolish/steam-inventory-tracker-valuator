// Retry, backoff and throttling helpers shared by every network call.

export class HttpError extends Error {
  constructor(status, message, { retryAfterMs = null, url = null } = {}) {
    super(message ?? `HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.url = url;
  }
}

export class RateLimitError extends Error {
  constructor(service, retryInMs) {
    const minutes = Math.max(1, Math.ceil(retryInMs / 60000));
    super(`${service} is rate-limiting this connection. Retry in about ${minutes} min, use cached data, or try the demo.`);
    this.name = 'RateLimitError';
    this.service = service;
    this.retryInMs = retryInMs;
    this.retryAt = Date.now() + retryInMs;
  }
}

// Exponential backoff with symmetric jitter: base * 2^attempt, capped,
// then spread by +/- jitter so parallel clients do not retry in lockstep.
export function computeBackoff(attempt, { baseMs = 2000, maxMs = 120000, jitter = 0.25, random = Math.random } = {}) {
  const raw = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  const spread = raw * jitter;
  return Math.max(0, Math.round(raw - spread + random() * spread * 2));
}

// Retry-After can be delta-seconds or an HTTP date.
export function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return Number(s) * 1000;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return Math.max(0, t - now);
}

const defaultSleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason ?? new Error('Aborted'));
    }, { once: true });
  });

export function isRetryable(err) {
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
  return err?.name === 'TypeError' || err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT' || err?.name === 'TimeoutError';
}

// Runs fn(attempt) and retries on 429, 5xx and network errors.
// A Retry-After longer than maxWaitMs is not waited out: the call fails fast
// with a RateLimitError so the UI can offer cached data instead.
export async function withBackoff(fn, {
  service = 'Steam',
  retries = 2,
  baseMs = 2000,
  maxMs = 60000,
  maxWaitMs = 45000,
  minLimitMs = 60000,
  sleep = defaultSleep,
  random = Math.random,
  onWait = null,
  signal = null,
} = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (signal?.aborted) throw err;
      if (!isRetryable(err)) throw err;
      const limited = err instanceof HttpError && err.status === 429;
      const hinted = err instanceof HttpError ? err.retryAfterMs : null;
      const wait = hinted ?? computeBackoff(attempt, { baseMs, maxMs, random });
      if (attempt >= retries || wait > maxWaitMs) {
        // Without a Retry-After hint, assume the limit lasts at least a minute.
        if (limited) throw new RateLimitError(service, Math.max(wait, hinted ?? minLimitMs));
        throw err;
      }
      onWait?.({ attempt: attempt + 1, waitMs: wait, limited });
      await sleep(wait, signal);
      attempt++;
    }
  }
}

// Serializes calls to one host and keeps at least `intervalMs` between starts.
export function createThrottle(intervalMs, { now = Date.now, sleep = defaultSleep } = {}) {
  let last = -Infinity;
  let chain = Promise.resolve();
  return function run(fn) {
    const next = chain.then(async () => {
      const gap = last + intervalMs - now();
      if (gap > 0) await sleep(gap);
      last = now();
      return fn();
    });
    chain = next.catch(() => {});
    return next;
  };
}
