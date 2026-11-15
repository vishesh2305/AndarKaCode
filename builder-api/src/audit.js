// Step 35: adds an event to the audit log (models/audit-event.js). It never fails what it records: a
// problem writing the event is logged and the request goes on. There is nothing here to change or delete one.
import { log } from "./log.js";
import { AuditEvent } from "./models/audit-event.js";

/**
 * audit("key.add", { actor: { userId, email } | { service }, workspaceId, target: { kind, id }, details })
 * details must hold no secret (a key: its provider and last four characters only).
 */
export async function audit(action, { actor = {}, workspaceId = null, target = null, details = undefined } = {}) {
  try {
    await AuditEvent.create({ action, actor, workspaceId, target: target && { kind: target.kind, id: String(target.id) }, details });
  } catch (err) {
    log.error(`audit log: could not keep ${action}: ${err.message}`);
  }
}

/** The person behind a request (with sign-in on), for audit(). */
export const actorOf = (req) => ({ ...(req.user && { userId: req.user.id, email: req.user.email }), ip: req.ip });
