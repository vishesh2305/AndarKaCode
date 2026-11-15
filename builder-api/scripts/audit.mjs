// Step 35: reads the audit log (there is no API route for it, on purpose).
//   npm run audit                          the last 50 events
//   npm run audit -- someone@example.com   that person's events
//   npm run audit -- project <projectId>   what happened to a project
//   add --limit 200 for more
import mongoose from "mongoose";
import { loadConfig } from "../src/config.js";
import { AuditEvent } from "../src/models/audit-event.js";

const args = process.argv.slice(2);
const at = args.indexOf("--limit");
const limit = at === -1 ? 50 : Math.min(5000, Number(args.splice(at, 2)[1]) || 50);
const [first, second] = args;
const filter = first === "project" && second ? { "target.id": second } : first?.includes("@") ? { "actor.email": first.toLowerCase() } : {};
const config = loadConfig(process.env);
await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 5000 });
try {
  const events = (await AuditEvent.find(filter).sort({ at: -1 }).limit(limit).lean()).reverse();
  if (!events.length) console.log("No events.");
  for (const e of events) {
    const who = e.actor?.email ?? e.actor?.service ?? (e.actor?.userId ? `user ${e.actor.userId}` : "someone");
    const what = e.target ? ` ${e.target.kind} ${e.target.id}` : "";
    console.log(`${e.at.toISOString()}  ${e.action.padEnd(16)} ${who}${what}${e.details ? `  ${JSON.stringify(e.details)}` : ""}`);
  }
} finally {
  await mongoose.disconnect();
}
