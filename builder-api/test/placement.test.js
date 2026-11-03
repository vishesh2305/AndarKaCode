// Step 28: placement. Pages (server 2) and the backend (server 1) are built at the same time and meet in
// MongoDB, so server 2 must be close to server 1: same region, a round trip under about 5 ms. A ui-worker
// measures its round trip to MongoDB at start and says plainly when it is too far away.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { measureDelay, placementCheck } from "../src/placement.js";

// A clock that moves only when told: each ping takes the next of these milliseconds.
function fakeClock(durations) {
  let t = 1000;
  let i = 0;
  return {
    now: () => t,
    ping: async () => {
      t += durations[i++];
    },
  };
}

describe("measureDelay: the round trip to the database", () => {
  it("is the median of several pings, so one slow ping doesn't count", async () => {
    const clock = fakeClock([0.4, 0.5, 30, 0.6, 0.5]);
    assert.equal(await measureDelay(clock.ping, { times: 5, now: clock.now }), 0.5);
  });

  it("pings 5 times by default", async () => {
    let pings = 0;
    await measureDelay(async () => pings++);
    assert.equal(pings, 5);
  });
});

describe("placementCheck: is server 2 close enough to server 1?", () => {
  it("is fine under the limit, and says so", () => {
    const { ok, message } = placementCheck({ ms: 0.8, limit: 5 });
    assert.equal(ok, true);
    assert.match(message, /MongoDB is 0\.8 ms away/);
  });

  it("over the limit, says how far, what it slows down, and the setting", () => {
    const { ok, message } = placementCheck({ ms: 41.26, limit: 5 });
    assert.equal(ok, false);
    assert.match(message, /MongoDB is 41\.3 ms away/);
    assert.match(message, /same region/);
    assert.match(message, /PLACEMENT_MS/);
  });
});
