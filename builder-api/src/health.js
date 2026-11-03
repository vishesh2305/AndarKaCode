// Step 20: what the servers' health checks ask. /healthz: is the process alive (always yes if it answers).
// /readyz: may it take work, i.e. is the database connected. And at start: is the UI build outdated?
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/** The /readyz answer. */
export const readiness = ({ dbConnected }) => ({ status: dbConnected ? 200 : 503, body: { ready: dbConnected, db: dbConnected } });

async function newestFile(dir) {
  let newest = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? await newestFile(full) : (await stat(full)).mtimeMs);
  }
  return newest;
}

/** True when a file in web/src changed after web/dist was built (`git pull` does not rebuild the UI). */
export async function webBuildIsStale(webDir) {
  try {
    const built = (await stat(path.join(webDir, "dist", "index.html"))).mtimeMs;
    return (await newestFile(path.join(webDir, "src"))) > built;
  } catch {
    return false; // no build (or no source): nothing to compare
  }
}
