// Step 33c: how the orchestrator runs a generated app. VERIFY_LANE=inline (the default): here, in a box
// (box.js). VERIFY_LANE=queue: through the box queue, run by the verifier service (ROLE=verifier), the one
// service that may start sandboxes. Either way the answer is the same: verify -> the report, press -> null
// or the problem.
import { pressOnce } from "../custom/tester.js";
import { submitBoxJob, waitBoxJob } from "../box-queue.js";
import { verifyApp } from "./index.js";

const RUN = { verify: verifyApp, press: pressOnce };
const queued = () => process.env.VERIFY_LANE === "queue";

async function viaQueue(kind, { priority = 0, ...input }) {
  return waitBoxJob(await submitBoxJob({ kind, input, priority }));
}

export const lane = {
  /** { spec, appDir, customWritten, mongoUri, testsMongoUri, priority? } -> the Verifier's report */
  verify: ({ priority, ...input }) => (queued() ? viaQueue("verify", { priority, ...input }) : verifyApp(input)),
  /** { spec, op, appDir, mongoUri, code, priority? } -> null when the button answers, else the problem */
  press: ({ priority, ...input }) => (queued() ? viaQueue("press", { priority, ...input }) : pressOnce(input)),
};

/** The verifier service runs a claimed job with this. */
export function runBoxJob({ kind, input }) {
  if (!RUN[kind]) throw new Error(`Unknown kind of box job "${kind}"`);
  return RUN[kind](input);
}
