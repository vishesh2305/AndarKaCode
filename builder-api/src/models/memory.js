import mongoose from "mongoose";
import { PROVIDERS } from "../../../shared/providers.mjs";
import { schemaOptions, SERVER_MODELS } from "./common.js";

// One piece of verified work, kept for reuse (ARCHITECTURE.md §9). Only projects that reached READY add
// to it; the first project to do a piece of work stays its source.
const memorySchema = new mongoose.Schema(
  {
    // Step 30 (M2): whose memory this is. "ws:<workspaceId>" (that workspace's projects only), "library"
    // (shared, reviewed: Step 39), or "local" when sign-in is off. Rows from before Step 30 have none: local.
    scope: String,
    kind: { type: String, enum: ["inventory", "page", "custom"], required: true },
    key: { type: String, required: true }, // src/memory/keys.js
    // The content (inventory JSON, page HTML, or code) is a compressed blob named by its hash (Step 21,
    // src/blobs.js), so each row stays under 1 KB. Rows remembered before Step 21 still hold `payload`.
    payloadKey: String,
    payloadBytes: Number,
    payload: mongoose.Schema.Types.Mixed,
    provider: { type: String, enum: [...SERVER_MODELS, ...PROVIDERS, null], default: null }, // which AI did the work
    seconds: Number, // how long the work took the first time (the time a reuse saves)
    sourceProjectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
    sourceName: String,
    // pages: the screenshot's picture fingerprint and the page instructions' hash, so a copy of the
    // screenshot (resized, re-saved) with the same instructions finds this page (Step 14 piece 2)
    dHash: String,
    dHashBands: { type: [String], default: undefined }, // Step 28 (M3): the dHash in bands, for the index (src/memory/dhash.js)
    instructionsHash: String,
    // custom code: the button's text, row or page, and the fields of the table it was verified on, so the
    // same button on another table can find it (the verified-code library, Step 14 piece 3)
    button: String,
    row: Boolean,
    fields: mongoose.Schema.Types.Mixed,
  },
  schemaOptions
);
// Every search is narrowed by scope first (Step 30). The same piece can be remembered once per scope.
memorySchema.index({ scope: 1, kind: 1, key: 1 }, { unique: true });
memorySchema.index({ scope: 1, kind: 1, instructionsHash: 1, dHashBands: 1 });
memorySchema.index({ scope: 1, kind: 1, button: 1 });

export const Memory = mongoose.model("Memory", memorySchema);
