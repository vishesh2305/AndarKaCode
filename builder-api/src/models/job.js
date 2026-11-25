import mongoose from "mongoose";
import { PROVIDERS } from "../../../shared/providers.mjs";
import { schemaOptions, SERVER_MODELS } from "./common.js";

// One piece of work for a project, on either laptop (ARCHITECTURE.md §11).
const jobSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    kind: {
      type: String,
      enum: ["contract", "frontend", "backend", "verify", "preview", "publish"],
      required: true,
    },
    status: { type: String, enum: ["queued", "running", "done", "failed", "cancelled"], default: "queued" },
    provider: { type: String, enum: [...SERVER_MODELS, ...PROVIDERS, null], default: null },
    contractHash: String, // which Contract version this job was built for
    page: Number, // frontend jobs: which screenshot (1-based) this page is built from
    remoteJobId: String, // the Gateway's jobId for frontend jobs
    usage: { type: [mongoose.Schema.Types.Mixed], default: undefined }, // Step 25: { purpose, provider, model, inputTokens, outputTokens, thinkingTokens, seconds } per model call
    artifactPath: String, // what the job produced, relative to the repo root (e.g. runs/<id>/frontend/v1.html)
    note: String, // e.g. "placeholder until Step 10"
    fallback: String, // the workspace's own key failed and the local models did this job: why (no key in it)
    report: mongoose.Schema.Types.Mixed, // verify jobs: the Verifier's report (src/verify/index.js)
    // backend jobs: one entry per custom button, { operation, button, ok, provider, answers, problem? } (Step 13)
    custom: { type: [mongoose.Schema.Types.Mixed], default: undefined },
    // reused work (Step 14): { sourceProjectId, sourceName, seconds } (+ count for readings)
    fromMemory: mongoose.Schema.Types.Mixed,
    // Step 54a, frontend jobs: region fixes { id, kind, n?, selector?, label, note, status, problem?, provider? },
    // and the pages before each kept fix (artifact paths; Undo takes the last one back)
    fixes: { type: [mongoose.Schema.Types.Mixed], default: undefined },
    revisions: { type: [String], default: undefined },
    error: String,
    startedAt: Date,
    finishedAt: Date,
  },
  schemaOptions
);

export const Job = mongoose.model("Job", jobSchema);
