// Step 33a: the sandbox's door, our own small forwarder (it never runs the app's code). It sits on Docker's
// normal network, where its two ports are published on this computer's loopback only, and on the
// sandbox's network, which has no way out. It forwards our connections to the app (3000) and to the app's
// database (27017) in the sandbox; nothing starts from the sandbox side. Usage: node door.mjs <sandbox> <maxMs>
import net from "node:net";

const [target, maxMs] = process.argv.slice(2);

for (const port of [3000, 27017]) {
  net
    .createServer((client) => {
      const upstream = net.connect(port, target);
      client.pipe(upstream).pipe(client);
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
    })
    .listen(port);
}

setTimeout(() => process.exit(0), Number(maxMs) || 30 * 60_000);
process.on("SIGTERM", () => process.exit(0));
