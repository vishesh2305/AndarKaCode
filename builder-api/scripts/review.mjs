// Step 35: a person reviews what the trust & safety check held, and the reports people sent.
//   npm run review -- held                         the projects waiting for a review, with why
//   npm run review -- release <projectId> "note"   it is fine (their own bank's demo, say): it is built
//   npm run review -- block <projectId> "note"     it is not: no preview, no download
//   npm run review -- reports                      open reports, oldest first
//   npm run review -- close-report <id> "note"
// Who reviews: REVIEWER=you@example.com (else this computer's user name). Every step goes to the audit log.
import os from "node:os";
import mongoose from "mongoose";
import { loadConfig } from "../src/config.js";
import { blockProject, closeReport, listHeld, listReports, releaseProject } from "../src/safety/review.js";

const [command, id, note] = process.argv.slice(2);
const by = process.env.REVIEWER || os.userInfo().username;
const config = loadConfig(process.env);
await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 5000 });
try {
  if (command === "held") {
    const held = await listHeld();
    if (!held.length) console.log("Nothing is waiting for a review.");
    for (const p of held) console.log(`${p._id}  ${p.name}  (held ${p.review?.at?.toISOString?.() ?? ""})\n    ${(p.review?.flags ?? []).map((f) => f.reason).join("\n    ")}`);
  } else if (command === "release" && id) {
    const p = await releaseProject(id, { by, note });
    console.log(`Released ${p.id} (${p.name}): ${p.state === "CONTRACT_DRAFT" ? "it is built now" : `it stays ${p.state}`}.`);
  } else if (command === "block" && id) {
    const p = await blockProject(id, { by, note });
    console.log(`Blocked ${p.id} (${p.name}): no preview, no download.`);
  } else if (command === "reports") {
    const reports = await listReports();
    if (!reports.length) console.log("No open reports.");
    for (const r of reports) console.log(`${r.id}  ${r.createdAt.toISOString()}  from ${r.reporter?.email ?? "this computer"}${r.projectId ? `  project ${r.projectId}` : ""}${r.url ? `  ${r.url}` : ""}\n    ${r.reason}`);
  } else if (command === "close-report" && id) {
    await closeReport(id, { by, note });
    console.log(`Closed report ${id}.`);
  } else {
    console.log('Usage: npm run review -- held | release <projectId> "note" | block <projectId> "note" | reports | close-report <id> "note"');
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
