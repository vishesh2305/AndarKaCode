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

/** Shrinks the upload to at most 1280 px wide, stores it as PNG, returns where and how big. */
export async function saveScreenshot(projectId, buffer) {
  // Decode first: a file that is not an image fails here, before anything is written.
  const { data, info } = await sharp(buffer)
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });

  const dir = path.join(RUNS_DIR, projectId.toString());
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "screenshot.png");
  await writeFile(filePath, data);

  return {
    imagePath: path.relative(REPO_ROOT, filePath).split(path.sep).join("/"),
    imageWidth: info.width,
    imageHeight: info.height,
  };
}
