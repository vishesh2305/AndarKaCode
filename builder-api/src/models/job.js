import mongoose from "mongoose";
import { schemaOptions } from "./common.js";

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
    provider: { type: String, enum: ["local", "cloud", null], default: null },
    contractHash: String, // which Contract version this job was built for
    page: Number, // frontend jobs: which screenshot (1-based) this page is built from
    remoteJobId: String, // the Gateway's jobId for frontend jobs
    artifactPath: String, // what the job produced, relative to the repo root (e.g. runs/<id>/frontend/v1.html)
    note: String, // e.g. "placeholder until Step 10"
    report: mongoose.Schema.Types.Mixed, // verify jobs: the Verifier's report (src/verify/index.js)
    error: String,
    startedAt: Date,
    finishedAt: Date,
  },
  schemaOptions
);

export const Job = mongoose.model("Job", jobSchema);
