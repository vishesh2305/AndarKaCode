// Step 31b: a workspace's own AI keys (BYOK), at /api/keys, for the signed-in owner. A key is checked with its
// provider before it is saved, sealed by the vault, and shown only by its last 4 characters. The two slots
// take a saved key and a model from the verified list (shared/models.mjs).
import express from "express";
import mongoose from "mongoose";
import { MODELS, modelFor } from "../../../shared/models.mjs";
import { checkKey, PROVIDER_LABELS, PROVIDERS } from "../../../shared/providers.mjs";
import { ApiKey } from "../models/api-key.js";
import { rateLimit } from "../security.js";
import { Workspace } from "../models/workspace.js";
import { createVault, lastFour } from "./vault.js";

const SLOTS = ["frontend", "backend"];

export function createKeysRouter({ keyVaultSecret }) {
  const vault = keyVaultSecret ? createVault(keyVaultSecret) : null;
  const router = express.Router();

  // Signed in (AUTH=on), as the workspace's owner.
  router.use(async (req, res, next) => {
    if (!req.user) return res.status(409).json({ error: "Your own keys need sign-in (AUTH=on in builder-api/.env)" });
    const workspace = await Workspace.findById(req.user.workspaceId);
    const role = workspace?.members.find((m) => m.userId.equals(req.user.id))?.role;
    if (role !== "owner") return res.status(403).json({ error: "Only the workspace's owner manages its keys" });
    req.workspace = workspace;
    next();
  });

  async function view(workspace) {
    const keys = await ApiKey.find({ workspaceId: workspace._id }).sort({ createdAt: 1 });
    const slot = (name) => {
      const chosen = workspace.slots?.[name];
      const key = chosen?.keyId && keys.find((k) => k._id.equals(chosen.keyId));
      return key ? { keyId: key.id, provider: key.provider, model: chosen.model, lastFour: key.lastFour } : null;
    };
    return { keys: keys.map((k) => k.toJSON()), slots: { frontend: slot("frontend"), backend: slot("backend") }, models: MODELS, vault: Boolean(vault) };
  }

  router.get("/", async (req, res) => res.json(await view(req.workspace)));

  // Each new key asks its provider: at most 10 an hour per workspace (Step 32a).
  const addLimit = rateLimit({ name: "keys", limit: 10, windowMs: 3_600_000, key: (req) => String(req.workspace._id), message: "Too many keys added in this workspace" });
  router.post("/", addLimit, async (req, res) => {
    if (!vault) return res.status(503).json({ error: "Saving keys needs KEY_VAULT_SECRET in builder-api/.env (make one with: openssl rand -hex 32)" });
    const { provider, apiKey, label } = req.body ?? {};
    if (!PROVIDERS.includes(provider)) return res.status(400).json({ error: `provider must be one of ${PROVIDERS.join(", ")}` });
    if (typeof apiKey !== "string" || !apiKey.trim() || apiKey.length > 500) return res.status(400).json({ error: "apiKey must be the key, as the provider gave it" });
    const key = apiKey.trim();
    const check = await checkKey({ provider, apiKey: key });
    if (!check.ok) return res.status(400).json({ error: `${PROVIDER_LABELS[provider]} refused this key: ${check.reason}` });
    const _id = new mongoose.Types.ObjectId();
    const saved = await ApiKey.create({
      _id,
      workspaceId: req.workspace._id,
      createdById: req.user.id,
      provider,
      label: typeof label === "string" && label.trim() ? label.trim().slice(0, 60) : undefined,
      lastFour: lastFour(key),
      sealed: vault.seal(key, { workspaceId: req.workspace.id, keyId: _id.toString() }),
      checkedAt: new Date(),
    });
    res.status(201).json(saved.toJSON());
  });

  router.delete("/:id", async (req, res) => {
    const removed = mongoose.isValidObjectId(req.params.id) && (await ApiKey.findOneAndDelete({ _id: req.params.id, workspaceId: req.workspace._id }));
    if (!removed) return res.status(404).json({ error: "No such key" });
    const unset = Object.fromEntries(SLOTS.filter((s) => req.workspace.slots?.[s]?.keyId?.equals(removed._id)).map((s) => [`slots.${s}`, 1]));
    if (Object.keys(unset).length) await Workspace.updateOne({ _id: req.workspace._id }, { $unset: unset });
    res.status(204).end();
  });

  // { frontend?: { keyId, model } | null, backend?: ... }: only the slots named change.
  router.put("/slots", async (req, res) => {
    const set = {};
    const unset = {};
    for (const slot of SLOTS) {
      if (!(slot in (req.body ?? {}))) continue;
      const choice = req.body[slot];
      if (choice === null) {
        unset[`slots.${slot}`] = 1;
        continue;
      }
      const key = mongoose.isValidObjectId(choice?.keyId) && (await ApiKey.findOne({ _id: choice.keyId, workspaceId: req.workspace._id }));
      if (!key) return res.status(400).json({ error: `${slot}: No such key in this workspace` });
      if (!modelFor(key.provider, choice.model, slot)) {
        return res.status(400).json({ error: `${slot}: "${choice.model}" is not on the verified list for ${key.provider} as the ${slot} slot` });
      }
      set[`slots.${slot}`] = { keyId: key._id, model: choice.model };
    }
    const workspace = await Workspace.findByIdAndUpdate(req.workspace._id, { ...(Object.keys(set).length && { $set: set }), ...(Object.keys(unset).length && { $unset: unset }) }, { new: true });
    res.json(await view(workspace));
  });

  return router;
}
