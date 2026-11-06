// Step 31c: a project's slot keys. When a project is made, it keeps which of its workspace's keys and models
// each slot uses (never the key); a model call opens that key from the vault only at the moment it is made.
import { ApiKey } from "../models/api-key.js";
import { createVault } from "./vault.js";

/** What a new project keeps of its workspace's slots: { frontend, backend }, each { keyId, provider, model, lastFour } or null. */
export async function slotsOf(workspace) {
  const keep = async (slot) => {
    const chosen = workspace?.slots?.[slot];
    const key = chosen?.keyId && (await ApiKey.findOne({ _id: chosen.keyId, workspaceId: workspace._id }).lean());
    return key ? { keyId: key._id, provider: key.provider, model: chosen.model, lastFour: key.lastFour } : null;
  };
  return { frontend: await keep("frontend"), backend: await keep("backend") };
}

/**
 * The slot's key, opened for a call: { provider, model, apiKey }, or null when the slot is empty (the
 * server's own models are used). A key deleted since the project was made stops the build: it never falls
 * back to models the person did not choose.
 */
export async function openSlotKey(project, slot, { secret = process.env.KEY_VAULT_SECRET || null } = {}) {
  const chosen = project.keys?.[slot];
  if (!chosen?.keyId) return null;
  if (!secret) throw new Error(`This server can't open your ${slot} key: KEY_VAULT_SECRET is not set on it`);
  const row = await ApiKey.findOne({ _id: chosen.keyId, workspaceId: project.workspaceId }).lean();
  if (!row) throw new Error(`Your ${slot} key (${chosen.provider} …${chosen.lastFour ?? "????"}) was deleted: add a key for the ${slot} slot and build again`);
  const apiKey = createVault(secret).open(row.sealed, { workspaceId: String(project.workspaceId), keyId: String(row._id) });
  return { provider: row.provider, model: chosen.model, apiKey };
}
