import mongoose from "mongoose";
import { schemaOptions } from "./common.js";

// Step 31b: one AI key a workspace brought (BYOK), sealed by the key vault (src/keys/vault.js). The key
// itself is never stored or shown: only its sealed form and its last 4 characters.
const apiKeySchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    createdById: { type: mongoose.Schema.Types.ObjectId, required: true },
    provider: { type: String, enum: ["gemini", "openai", "anthropic", "groq", "openrouter"], required: true },
    label: { type: String, trim: true, maxlength: 60 },
    lastFour: { type: String, required: true },
    sealed: { ciphertext: { type: String, required: true }, iv: { type: String, required: true }, tag: { type: String, required: true } },
    checkedAt: Date, // when its provider last accepted it
  },
  {
    ...schemaOptions,
    toJSON: {
      ...schemaOptions.toJSON,
      transform(doc, ret) {
        schemaOptions.toJSON.transform(doc, ret);
        delete ret.sealed; // never in an answer
        return ret;
      },
    },
  }
);

export const ApiKey = mongoose.model("ApiKey", apiKeySchema);
