import mongoose from "mongoose";
import { schemaOptions } from "./common.js";

// Step 33c: work that runs a generated app (VERIFY_LANE=queue): "verify" an app, or "press" a custom button
// once. The orchestrator submits it; the verifier service (ROLE=verifier) claims it with a lease, runs it in
// a box (a sandbox with SANDBOX=docker) and hands back the answer. The app's files are on the volume both
// services share (input.appDir).
const boxJobSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["verify", "press"], required: true },
    status: { type: String, enum: ["queued", "running", "done", "failed"], default: "queued" },
    input: { type: mongoose.Schema.Types.Mixed, required: true }, // what verifyApp / pressOnce take
    priority: { type: Number, default: 0 }, // a pro workspace's work first (Step 32b)
    worker: String, // which verifier holds it
    leaseUntil: Date,
    result: mongoose.Schema.Types.Mixed, // the report (verify), or null / the problem (press)
    error: String,
    startedAt: Date,
    finishedAt: Date,
  },
  { ...schemaOptions, minimize: false }
);
boxJobSchema.index({ status: 1, priority: -1, createdAt: 1 });
// Finished work is kept a day, for looking into a build; then MongoDB deletes it.
boxJobSchema.index({ finishedAt: 1 }, { expireAfterSeconds: 24 * 3600 });

export const BoxJob = mongoose.model("BoxJob", boxJobSchema, "box_jobs");
