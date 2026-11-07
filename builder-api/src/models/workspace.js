import mongoose from "mongoose";
import { schemaOptions } from "./common.js";

// Step 29: where projects live. Each person gets a personal one at their first sign-in; teams come later.
export const ROLES = ["owner", "member"];
const memberSchema = new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, required: true }, role: { type: String, enum: ROLES, required: true } }, { _id: false });

const workspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    ownerId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    personal: { type: Boolean, default: false },
    plan: { type: String, enum: ["free", "pro"], default: "free" }, // Step 32b: its quota, and whether it goes first
    members: { type: [memberSchema], default: [] },
    // Step 31b: which saved key and model each slot uses with the workspace's own keys (BYOK).
    // frontend: reading screenshots and drawing pages; backend: writing custom button code.
    slots: {
      frontend: { keyId: mongoose.Schema.Types.ObjectId, model: String },
      backend: { keyId: mongoose.Schema.Types.ObjectId, model: String },
    },
  },
  schemaOptions
);
workspaceSchema.index({ "members.userId": 1 });
// One personal workspace per person, even when two sign-ins arrive at the same moment.
workspaceSchema.index({ ownerId: 1 }, { unique: true, partialFilterExpression: { personal: true }, name: "one_personal_workspace" });

export const Workspace = mongoose.model("Workspace", workspaceSchema);
