// Step 32c: adaptive concurrency per key. Each key runs at most `limit` model calls at once (starting at
// `max`). A "too many requests" answer halves the limit (never below 1) and pauses the key for as long as the
// provider asks; each run of calls that go through raises it by one again, up to `max`. Per process: two
// services sharing a key each slow down on their own.
import { createHash } from "node:crypto";

export function createLimiter({ max = 4 } = {}) {
  let limit = max;
  let active = 0;
  let streak = 0; // calls through since the last change of limit
  let pausedUntil = 0;
  let slowDowns = 0;
  let timer = null;
  const waiting = [];

  function pump() {
    while (waiting.length && active < limit) {
      const wait = pausedUntil - Date.now();
      if (wait > 0) {
        timer ??= setTimeout(() => {
          timer = null;
          pump();
        }, wait); // calls are waiting on it: it keeps the process alive
        return;
      }
      active++;
      waiting.shift()();
    }
  }

  return {
    limit: () => limit,
    slowDowns: () => slowDowns, // how often a provider said "too many requests" to this key
    /** Runs fn when there is room; a call that resolves counts as gone through. */
    async run(fn) {
      await new Promise((resolve) => {
        waiting.push(resolve);
        pump();
      });
      try {
        const result = await fn();
        if (++streak >= limit && limit < max) {
          limit++;
          streak = 0;
        }
        return result;
      } finally {
        active--;
        pump();
      }
    },
    /** The provider said "too many requests": fewer at once, and a pause of `ms`. */
    slowDown(ms) {
      slowDowns++;
      limit = Math.max(1, Math.floor(limit / 2));
      streak = 0;
      pausedUntil = Math.max(pausedUntil, Date.now() + ms);
    },
  };
}

const limiters = new Map(); // "<provider>:<hash of the key>" -> limiter; the key itself is never kept

/** The limiter of this provider's key (made on first use). */
export function limiterFor(provider, apiKey, { max = 4 } = {}) {
  const id = `${provider}:${createHash("sha256").update(String(apiKey)).digest("hex").slice(0, 16)}`;
  if (!limiters.has(id)) limiters.set(id, createLimiter({ max }));
  return limiters.get(id);
}
limiterFor.keys = () => [...limiters.keys()];
