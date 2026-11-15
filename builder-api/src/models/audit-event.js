import mongoose from "mongoose";

// Step 35: the audit log. One event for each moment that matters: who (a person, a reviewer, or one of our
// services), in which workspace, did what, to what, when. Only ever added to (src/audit.js has no update or
// delete, and no API route reads or changes it); kept a year, then MongoDB deletes it. Never a secret: a key
// appears only as its last four characters.
const auditEventSchema = new mongoose.Schema(
  {
    at: { type: Date, default: () => new Date() },
    action: { type: String, required: true }, // e.g. "auth.sign-in", "key.add", "review.held"
    actor: {
      userId: mongoose.Schema.Types.ObjectId,
      email: String,
      service: String, // "orchestrator", "review script"...
      ip: String,
    },
    workspaceId: mongoose.Schema.Types.ObjectId,
    target: { kind: String, id: String },
    details: mongoose.Schema.Types.Mixed,
  },
  { versionKey: false }
);
auditEventSchema.index({ at: 1 }, { expireAfterSeconds: 365 * 24 * 3600 });
auditEventSchema.index({ workspaceId: 1, at: -1 });
auditEventSchema.index({ "target.id": 1, at: 1 });
auditEventSchema.index({ "actor.email": 1, at: -1 });

export const AuditEvent = mongoose.model("AuditEvent", auditEventSchema, "audit_events");
