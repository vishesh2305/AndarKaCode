// Step 23: every screenshot is read at the same time, so reading 3 takes about as long as reading 1.
// A local Ollama answers one at a time anyway; a cloud model reads them side by side.
import { runPool } from "../pool.js";

const READ_LIMIT = Number(process.env.READ_PARALLEL ?? 6);

/**
 * Reads every screenshot (or takes its earlier reading from memory) at the same time.
 * read(shot) -> { inventory, provider }; recall(shot) -> a memory entry or null.
 * Returns { inventories (in the screenshots' order), provider ("cloud" if any screenshot needed it), reused }.
 */
export async function readScreenshots(shots, { read, recall, limit = READ_LIMIT }) {
  const readings = await runPool(shots, limit, async (shot) => {
    const memory = await recall(shot);
    if (memory) return { inventory: memory.payload, provider: memory.provider, memory };
    return read(shot);
  });
  const providers = readings.map((r) => r.provider);
  return {
    inventories: readings.map((r) => r.inventory),
    provider: providers.includes("cloud") ? "cloud" : providers.at(-1),
    reused: readings.filter((r) => r.memory).map((r) => r.memory),
  };
}
