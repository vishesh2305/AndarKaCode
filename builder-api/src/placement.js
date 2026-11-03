// Step 28: placement. Server 2 (ui-workers) and server 1 (api, orchestrator, MongoDB) build one project at
// the same time and meet in MongoDB, so they must be close: the same region, a round trip under about 5 ms.
import { performance } from "node:perf_hooks";

/** The round trip of `ping` in ms: the median of `times` pings, so one slow ping doesn't count. */
export async function measureDelay(ping, { times = 5, now = () => performance.now() } = {}) {
  const took = [];
  for (let i = 0; i < times; i++) {
    const start = now();
    await ping();
    took.push(now() - start);
  }
  took.sort((a, b) => a - b);
  return took[Math.floor(times / 2)];
}

/** { ok, message }: is MongoDB close enough (`limit` ms, PLACEMENT_MS)? */
export function placementCheck({ ms, limit }) {
  const away = `MongoDB is ${ms.toFixed(1)} ms away`;
  if (ms <= limit) return { ok: true, message: `${away} (under ${limit} ms)` };
  return {
    ok: false,
    message: `${away}, over ${limit} ms: every page job waits on it. Run this ui-worker in the same region as server 1 (or raise PLACEMENT_MS)`,
  };
}
