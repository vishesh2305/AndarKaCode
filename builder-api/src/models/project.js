import mongoose from "mongoose";
import { schemaOptions } from "./common.js";

// The build lifecycle, ARCHITECTURE.md §3.
export const PROJECT_STATES = [
  "UPLOADED",
  "CONTRACT_DRAFT",
  "BUILDING",
  "SYNCED",
  "INTEGRATING",
  "VERIFYING",
  "REPAIRING",
  "READY",
  "PREVIEW_LIVE",
  "SHIPPED",
  "NEEDS_ATTENTION",
];

// One uploaded screenshot = one page of the generated app.
const screenshotSchema = new mongoose.Schema(
  {
    path: { type: String, required: true }, // relative to the repo root, e.g. runs/<id>/screenshot-1.png
    sha256: { type: String, required: true }, // of the uploaded file
    dHash: String, // picture fingerprint: copies of the same screen stay close (Step 14)
    width: Number,
    height: Number,
    inventory: mongoose.Schema.Types.Mixed, // what the vision pass saw (shared/inventory.schema.json)
  },
  { _id: false }
);

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    // Step 30: who made it, and the workspace it belongs to (none when sign-in is off). Every project route
    // finds only the projects of the signed-in person's workspace.
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", index: true },
    // Step 31c: the workspace's own keys this project is built with, per slot (src/keys/slots.js): which key
    // and model, never the key. An empty slot uses the server's models (mode).
    keys: { frontend: { keyId: mongoose.Schema.Types.ObjectId, provider: String, model: String, lastFour: String }, backend: { keyId: mongoose.Schema.Types.ObjectId, provider: String, model: String, lastFour: String } },
    screenshots: { type: [screenshotSchema], default: [] },
    // First screenshot, kept for listings and for projects created before multi-screenshot uploads.
    imageHash: { type: String, required: true, index: true },
    imagePath: { type: String },
    imageWidth: Number,
    imageHeight: Number,
    state: { type: String, enum: PROJECT_STATES, default: "UPLOADED" },
    mode: { type: String, enum: ["local", "cloud", "auto"], default: "local" }, // which AI providers to use
    useMemory: { type: Boolean, default: true }, // false = "Start fresh": build everything again (Step 14)
    currentContractVersion: { type: Number, default: 0 }, // 0 = no Contract yet
    error: String, // why the project is NEEDS_ATTENTION
    // Step 22: who is building this project, until when (src/lease.js), and whether to look again after.
    lease: { owner: String, until: Date },
    rerun: { type: Boolean, default: false },
  },
  schemaOptions
);

export const Project = mongoose.model("Project", projectSchema);
