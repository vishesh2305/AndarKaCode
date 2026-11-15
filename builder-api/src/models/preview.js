import mongoose from "mongoose";
import { schemaOptions } from "./common.js";

// Step 34a: a project's live preview, between the api service (which asks for it) and the preview service
// (which runs it, on its own address). One per project. The request carries the app's files and starting
// rows (the preview service shares no disk with the api); they are dropped once the preview runs.
const previewSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true, unique: true },
    hash: { type: String, required: true }, // the spec version it shows
    status: { type: String, enum: ["queued", "starting", "running", "failed", "stopped"], default: "queued" },
    files: Buffer, // the wired app, as a tar (verify/tar.js)
    seed: mongoose.Schema.Types.Mixed, // the starting rows: { collection: [records] }
    auth: { type: Boolean, default: false },
    token: String, // the secret in its address: /preview/<projectId>/<token>/
    credentials: mongoose.Schema.Types.Mixed, // the throwaway sign-in of an app with a login screen
    worker: String, // which preview service runs it
    seenAt: Date, // that service's last word: a running preview not seen for a while is started again
    stopRequested: { type: Boolean, default: false },
    error: String,
    requestedAt: Date,
  },
  schemaOptions
);
previewSchema.index({ status: 1, requestedAt: 1 });

export const Preview = mongoose.model("Preview", previewSchema, "previews");
