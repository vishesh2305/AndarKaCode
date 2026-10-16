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
    status: { type: String, enum: ["queued", "running", "done", "failed"], default: "queued" },
    provider: { type: String, enum: ["local", "cloud", null], default: null },
    contractHash: String, // which Contract version this job was built for
    remoteJobId: String, // the Gateway's jobId for frontend jobs
    error: String,
    startedAt: Date,
    finishedAt: Date,
  },
  schemaOptions
);

export const Job = mongoose.model("Job", jobSchema);
