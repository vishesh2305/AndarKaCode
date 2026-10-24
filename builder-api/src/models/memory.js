import mongoose from "mongoose";
import { schemaOptions } from "./common.js";

export const MEMORY_KINDS = ["screenshot", "spec", "operation"];

const memorySchema = new mongoose.Schema(
  {
    kind: { type: String, enum: MEMORY_KINDS, required: true, index: true },
    key: { type: String, required: true },
    dHash: { type: String, index: { sparse: true } },
    embedding: { type: [Number], default: undefined },
    verified: { type: Boolean, default: true },
    sourceProjectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
    payload: { type: mongoose.Schema.Types.Mixed },
  },
  schemaOptions
);

memorySchema.index({ kind: 1, key: 1 });

export const Memory = mongoose.model("Memory", memorySchema);
