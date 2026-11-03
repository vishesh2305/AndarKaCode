import mongoose from "mongoose";
import { schemaOptions } from "./common.js";

// Step 29: the beta's invite list. Only these emails (verified by GitHub or Google) get an account.
const inviteSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    note: { type: String, maxlength: 200 },
    usedAt: Date, // the first sign-in
  },
  schemaOptions
);

export const Invite = mongoose.model("Invite", inviteSchema);
