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

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    imageHash: { type: String, required: true, index: true }, // sha256 of the uploaded file
    imagePath: { type: String }, // relative to the repo root, e.g. runs/<id>/screenshot.png
    imageWidth: Number,
    imageHeight: Number,
    state: { type: String, enum: PROJECT_STATES, default: "UPLOADED" },
    mode: { type: String, enum: ["local", "cloud", "auto"], default: "local" }, // which AI providers to use
    currentContractVersion: { type: Number, default: 0 }, // 0 = no Contract yet
    error: String, // why the project is NEEDS_ATTENTION
  },
  schemaOptions
);

export const Project = mongoose.model("Project", projectSchema);
