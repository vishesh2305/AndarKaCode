import mongoose from "mongoose";
import { schemaOptions } from "./common.js";

// Step 29: a signed-in browser. The cookie holds a random token; here is only its sha256, so a copy of the
// database opens nothing. MongoDB deletes a session by itself once it expires (the TTL index).
const sessionSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, required: true },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  schemaOptions
);

export const Session = mongoose.model("Session", sessionSchema);

// A sign-in under way: the state sent to the provider, the browser that started it (a hash of its login
// cookie) and the PKCE verifier. Good for 10 minutes, and once.
const loginSchema = new mongoose.Schema(
  {
    state: { type: String, required: true, unique: true },
    browserHash: { type: String, required: true },
    provider: { type: String, required: true },
    verifier: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  schemaOptions
);

export const Login = mongoose.model("Login", loginSchema);
