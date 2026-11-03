import mongoose from "mongoose";
import { schemaOptions } from "./common.js";

// Step 29: a person. One verified email; each provider they signed in with is an identity of theirs.
const identitySchema = new mongoose.Schema({ provider: { type: String, enum: ["github", "google"], required: true }, subject: { type: String, required: true } }, { _id: false });

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, trim: true, maxlength: 200 },
    avatarUrl: String,
    identities: { type: [identitySchema], default: [] },
    lastSignInAt: Date,
  },
  schemaOptions
);
userSchema.index({ "identities.provider": 1, "identities.subject": 1 }, { unique: true });

export const User = mongoose.model("User", userSchema);
