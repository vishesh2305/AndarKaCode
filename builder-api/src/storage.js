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

/** Counts differing bits between two 16-character (64-bit) hex dHash strings (0 to 64). */
export function hammingDistance(hex1, hex2) {
  if (typeof hex1 !== "string" || typeof hex2 !== "string") {
    throw new TypeError("Hex strings are required");
  }
  if (hex1.length !== 16 || hex2.length !== 16) {
    throw new Error("Both hashes must be 16-character hex strings");
  }
  if (!/^[0-9a-fA-F]{16}$/.test(hex1) || !/^[0-9a-fA-F]{16}$/.test(hex2)) {
    throw new Error("Invalid hex characters");
  }
  let x = BigInt("0x" + hex1) ^ BigInt("0x" + hex2);
  let dist = 0;
  while (x > 0n) {
    dist += Number(x & 1n);
    x >>= 1n;
  }
  return dist;
}

/**
 * Computes a 64-bit perceptual difference hash (dHash).
 * Resizes image to 9x8 grayscale, then iterates 8 rows and 8 columns,
 * comparing whether pixel[x+1] > pixel[x].
 * Returns a 16-character hex string.
 */
export async function computeDHash(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new TypeError("Buffer is required");
  }
  const raw = await sharp(buffer)
    .grayscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer();

  let hex = "";
  for (let y = 0; y < 8; y++) {
    let rowByte = 0;
    for (let x = 0; x < 8; x++) {
      const left = raw[y * 9 + x];
      const right = raw[y * 9 + (x + 1)];
      rowByte = (rowByte << 1) | (right > left ? 1 : 0);
    }
    hex += rowByte.toString(16).padStart(2, "0");
  }
  return hex;
}

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
