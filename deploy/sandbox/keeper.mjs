// Step 33a: the sandbox's first process. Starts the app's own MongoDB (inside the sandbox, in memory),
// prints "SANDBOX READY" once it answers, and ends everything at the time limit (SANDBOX_MAX_MS): the
// container then stops and Docker removes it. The app itself is started later with `docker exec`.
import { spawn } from "node:child_process";
import net from "node:net";

const MAX_MS = Number(process.env.SANDBOX_MAX_MS ?? 30 * 60_000);
let stopping = false;

const mongod = spawn("mongod", ["--bind_ip_all", "--port", "27017", "--dbpath", "/data/db", "--wiredTigerCacheSizeGB", "0.25", "--quiet", "--nounixsocket"], {
  stdio: ["ignore", "ignore", "inherit"],
});
mongod.once("exit", (code) => {
  if (!stopping) console.error(`The sandbox's database stopped (exit code ${code})`);
  process.exit(stopping ? 0 : 1);
});

function stop() {
  if (stopping) return;
  stopping = true;
  mongod.kill("SIGTERM");
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
setTimeout(stop, MAX_MS);

const answers = () =>
  new Promise((resolve) => {
    const socket = net.connect(27017, "127.0.0.1");
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
  });
while (!(await answers())) await new Promise((r) => setTimeout(r, 100));
console.log("SANDBOX READY");
