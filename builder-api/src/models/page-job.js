import mongoose from "mongoose";
import { schemaOptions } from "./common.js";

// Step 26: one page to draw, in the page queue (PAGE_LANE=queue). The orchestrator submits it; a ui-worker
// claims it with a lease, draws it and hands it back. The screenshot and the page are blobs (Step 21).
const pageJobSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // sha256 of (screenshot, contract hash): the same request is the same job
    status: { type: String, enum: ["queued", "running", "done", "failed"], default: "queued" },
    imageKey: { type: String, required: true },
    instructions: { type: String, required: true },
    contractHash: { type: String, required: true },
    mode: { type: String, enum: ["local", "cloud", "auto"], required: true },
    worker: String, // which ui-worker holds it
    leaseUntil: Date,
    provider: { type: String, enum: ["local", "cloud", null], default: null },
    htmlKey: String,
    usage: { type: [mongoose.Schema.Types.Mixed], default: undefined },
    error: String,
    startedAt: Date,
    finishedAt: Date,
  },
  schemaOptions
);
pageJobSchema.index({ status: 1, createdAt: 1 });
pageJobSchema.index({ key: 1, status: 1 });

export const PageJob = mongoose.model("PageJob", pageJobSchema);
