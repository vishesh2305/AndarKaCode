// Memory: Level 1 (exact SHA-256), Level 2 (perceptual dHash <= 6), and Level 4 (Pattern Library).
// ARCHITECTURE.md §9 & §12. Only verified artifacts enter memory.
import { readFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { Memory } from "../models/memory.js";
import { hammingDistance, REPO_ROOT } from "../storage.js";

/**
 * Finds a verified screenshot inventory from memory:
 * Level 1: exact SHA-256 match.
 * Level 2: near-duplicate perceptual dHash match (minimal Hamming distance <= 6).
 * Returns null if no match found or database is not connected.
 */
export async function findScreenshotMemory({ sha256, dHash } = {}) {
  if (mongoose.connection.readyState !== 1) return null;

  // Level 1: exact SHA-256 match
  if (sha256) {
    const exact = await Memory.findOne({ kind: "screenshot", key: sha256, verified: true });
    if (exact) return exact;
  }

  // Level 2: near-duplicate perceptual dHash match (Hamming distance <= 6)
  if (dHash) {
    const candidates = await Memory.find({
      kind: "screenshot",
      dHash: { $exists: true, $ne: null },
      verified: true,
    });
    let best = null;
    let minDistance = Infinity;
    for (const cand of candidates) {
      if (!cand.dHash) continue;
      try {
        const dist = hammingDistance(dHash, cand.dHash);
        if (dist <= 6 && dist < minDistance) {
          minDistance = dist;
          best = cand;
        }
      } catch {
        // Skip invalid dHash candidate
      }
    }
    if (best) return best;
  }

  return null;
}

/**
 * Finds a verified operation code from the Pattern Library.
 * Returns null if not found or database is not connected.
 */
export async function findOperationMemory(entity, name) {
  if (mongoose.connection.readyState !== 1) return null;
  return Memory.findOne({
    kind: "operation",
    key: `${entity}:${name}`,
    verified: true,
  });
}

/**
 * Finds a verified spec from memory by its contract hash.
 */
export async function findSpecMemory(hash) {
  if (mongoose.connection.readyState !== 1) return null;
  return Memory.findOne({
    kind: "spec",
    key: hash,
    verified: true,
  });
}

/**
 * Saves all verified artifacts of a project that reached READY state into memory:
 * - Screenshots: kind 'screenshot', key: sha256, dHash, payload: { inventory }
 * - Spec: kind 'spec', key: contract.hash, payload: contract.body
 * - Custom operations: kind 'operation', key: `${op.entity}:${op.name}`, payload: { code, operation: op }
 */
export async function rememberVerifiedProject(project, contract, rootDir = REPO_ROOT) {
  if (mongoose.connection.readyState !== 1) return;

  const projectId = project?._id ?? project?.id;

  // 1. Remember verified screenshots
  const screenshots = project?.screenshots ?? [];
  for (const shot of screenshots) {
    if (shot?.sha256 && shot?.inventory) {
      await Memory.findOneAndUpdate(
        { kind: "screenshot", key: shot.sha256 },
        {
          kind: "screenshot",
          key: shot.sha256,
          dHash: shot.dHash,
          verified: true,
          sourceProjectId: projectId,
          payload: { inventory: shot.inventory },
        },
        { upsert: true, returnDocument: "after" }
      );
    }
  }

  // 2. Remember verified spec
  if (contract?.hash && contract?.body) {
    await Memory.findOneAndUpdate(
      { kind: "spec", key: contract.hash },
      {
        kind: "spec",
        key: contract.hash,
        verified: true,
        sourceProjectId: projectId,
        payload: contract.body,
      },
      { upsert: true, returnDocument: "after" }
    );
  }

  // 3. Remember verified custom operations from the backend artifact
  const customOps = (contract?.body?.operations ?? []).filter((op) => op.kind === "custom");
  for (const op of customOps) {
    let code = op.code ?? null;
    if (!code && rootDir) {
      const candidates = [
        path.join(rootDir, "backend", "custom", `${op.name}.js`),
        path.join(rootDir, "runs", projectId.toString(), "app", `v${contract.version}`, "backend", "custom", `${op.name}.js`),
        path.join(rootDir, projectId.toString(), "app", `v${contract.version}`, "backend", "custom", `${op.name}.js`),
      ];
      for (const p of candidates) {
        try {
          code = await readFile(p, "utf8");
          if (code) break;
        } catch {
          // File not at this path, check next
        }
      }
    }

    if (code) {
      await Memory.findOneAndUpdate(
        { kind: "operation", key: `${op.entity}:${op.name}` },
        {
          kind: "operation",
          key: `${op.entity}:${op.name}`,
          verified: true,
          sourceProjectId: projectId,
          payload: { code, operation: op },
        },
        { upsert: true, returnDocument: "after" }
      );
    }
  }
}
