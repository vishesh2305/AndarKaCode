import mongoose from "mongoose";
import { schemaOptions } from "./common.js";

// One piece of verified work, kept for reuse (ARCHITECTURE.md §9). Only projects that reached READY add
// to it; the first project to do a piece of work stays its source.
const memorySchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["inventory", "page", "custom"], required: true },
    key: { type: String, required: true }, // src/memory/keys.js
    payload: { type: mongoose.Schema.Types.Mixed, required: true }, // inventory JSON, page HTML, or code
    provider: { type: String, enum: ["local", "cloud", null], default: null }, // which AI did the work
    seconds: Number, // how long the work took the first time (the time a reuse saves)
    sourceProjectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
    sourceName: String,
  },
  schemaOptions
);
memorySchema.index({ kind: 1, key: 1 }, { unique: true });

export const Memory = mongoose.model("Memory", memorySchema);
