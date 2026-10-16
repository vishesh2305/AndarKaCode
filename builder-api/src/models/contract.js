import mongoose from "mongoose";
import { schemaOptions } from "./common.js";

// Every edit makes a new version with a new hash; old versions are kept (ARCHITECTURE.md §3).
const contractSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    version: { type: Number, required: true, min: 1 },
    hash: { type: String, required: true }, // contractHash(body), shared/hash.mjs
    body: { type: mongoose.Schema.Types.Mixed, required: true }, // shape: shared/contract.schema.json
    approved: { type: Boolean, default: false },
    answers: { type: mongoose.Schema.Types.Mixed, default: {} }, // user's answers to openQuestions
  },
  schemaOptions
);

contractSchema.index({ projectId: 1, version: 1 }, { unique: true });

export const Contract = mongoose.model("Contract", contractSchema);
