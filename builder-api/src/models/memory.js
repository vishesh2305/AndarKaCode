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
    // pages: the screenshot's picture fingerprint and the page instructions' hash, so a copy of the
    // screenshot (resized, re-saved) with the same instructions finds this page (Step 14 piece 2)
    dHash: String,
    instructionsHash: String,
    // custom code: the button's text, row or page, and the fields of the table it was verified on, so the
    // same button on another table can find it (the verified-code library, Step 14 piece 3)
    button: String,
    row: Boolean,
    fields: mongoose.Schema.Types.Mixed,
  },
  schemaOptions
);
memorySchema.index({ kind: 1, key: 1 }, { unique: true });
memorySchema.index({ kind: 1, instructionsHash: 1 });
memorySchema.index({ kind: 1, button: 1 });

export const Memory = mongoose.model("Memory", memorySchema);
