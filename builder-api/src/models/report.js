import mongoose from "mongoose";
import { schemaOptions } from "./common.js";

// Step 35: a report of a problem (a phishing clone, abuse, something broken), from a signed-in person.
// A reviewer lists and closes them with: npm run review -- reports | close-report <id>
const reportSchema = new mongoose.Schema(
  {
    reporter: { userId: mongoose.Schema.Types.ObjectId, email: String, workspaceId: mongoose.Schema.Types.ObjectId },
    projectId: String, // the project it is about, if any (not necessarily the reporter's own)
    url: String, // where they saw it, if any (a preview's address, say)
    reason: { type: String, required: true },
    status: { type: String, enum: ["open", "closed"], default: "open" },
    closedBy: String,
    note: String,
  },
  schemaOptions
);
reportSchema.index({ status: 1, createdAt: 1 });

export const Report = mongoose.model("Report", reportSchema, "reports");
