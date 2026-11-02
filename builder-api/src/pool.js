// Runs work at the same time with a limit (Steps 18.4 and 23): pages in the page exam, screenshots
// being read, and later pages and custom buttons in a build.

/** worker(item, index) for every item, at most `limit` at a time; the results keep the items' order. */
export async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}
