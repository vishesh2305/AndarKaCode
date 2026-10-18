import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// runs/ sits at the repo root and is git-ignored.
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const RUNS_DIR = path.join(REPO_ROOT, "runs");

const MAX_WIDTH = 1280; // smaller image = shorter prompt = faster GPU (ARCHITECTURE.md §3)

export const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** Shrinks an upload to at most 1280 px wide as PNG. Throws if the file is not an image. */
export async function shrinkScreenshot(buffer) {
  const { data, info } = await sharp(buffer)
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Stores screenshot number n (1-based) of a project; returns where and how big. */
export async function saveScreenshot(projectId, n, shrunk) {
  const relPath = await saveArtifact(projectId, `screenshot-${n}.png`, shrunk.data);
  return { path: relPath, width: shrunk.width, height: shrunk.height };
}

/** Writes a generated file under runs/<projectId>/ and returns its repo-relative path. */
export async function saveArtifact(projectId, relativePath, content) {
  const filePath = path.join(RUNS_DIR, projectId.toString(), relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return path.relative(REPO_ROOT, filePath).split(path.sep).join("/");
}
