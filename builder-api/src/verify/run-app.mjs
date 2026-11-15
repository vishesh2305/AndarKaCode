// Runs ONE generated app in this process (started by app-runner.js): its own database, 127.0.0.1 only,
// a free port. Prints "READY <port>" when it answers. Usage: node run-app.mjs <appDir>
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const appDir = path.resolve(process.argv[2] ?? "");
const load = (file) => import(pathToFileURL(path.join(appDir, file)).href);

// The app's own Mongoose (through its node_modules link), so the app's models use this connection.
const mongoose = (await import(pathToFileURL(createRequire(path.join(appDir, "package.json")).resolve("mongoose")).href)).default;
const { app } = await load("backend/server.js");
await mongoose.connect(process.env.MONGODB_URI);
if (existsSync(path.join(appDir, "backend/auth/seed.js"))) await (await load("backend/auth/seed.js")).ensureFirstUser();

// In its own process: 127.0.0.1 and a free port. In a sandbox (Step 33a): PORT=3000 and HOST=0.0.0.0, the
// sandbox's own network, which only our door reaches.
const server = app.listen(Number(process.env.PORT ?? 0), process.env.HOST ?? "127.0.0.1", () => console.log(`READY ${server.address().port}`));

async function shutdown() {
  server.close();
  await mongoose.disconnect().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
// The Builder API is gone (stopped, crashed, killed): stop too, so no app keeps its port. Windows already
// does this for child processes; macOS and Linux do not.
process.on("disconnect", shutdown);
// In a sandbox it is started with `docker exec -i`: when we close its input (or are gone), it stops.
if (process.env.EXIT_ON_STDIN_END === "1") process.stdin.on("end", shutdown).resume();
