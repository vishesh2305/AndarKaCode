// Step 21: the blob store. Big pieces (remembered pages, readings, custom code) are kept as gzip files
// named by the SHA-256 of their content; the database keeps only that name, so its rows stay small
// (memory plan M1). The same content is stored once. "local" keeps them under runs/blobs/; "r2"
// (Cloudflare R2, Step 46) will keep the same names in a bucket behind the same three calls.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { RUNS_DIR } from "./storage.js";

const zip = promisify(gzip);
const unzip = promisify(gunzip);
const NAME = /^[0-9a-f]{64}$/;

export function createBlobStore({ dir }) {
  const fileOf = (key) => {
    if (!NAME.test(key)) throw new Error(`"${key}" is not a blob name (64 lowercase hex characters)`);
    return path.join(dir, key.slice(0, 2), `${key}.gz`);
  };

  /** Stores the content (string or Buffer) once; returns its name. */
  async function put(content) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const key = createHash("sha256").update(data).digest("hex");
    const file = fileOf(key);
    await mkdir(path.dirname(file), { recursive: true });
    // Written next to its place, then renamed: a reader never sees half a blob.
    const part = `${file}.${process.pid}.${Date.now()}.part`;
    await writeFile(part, await zip(data));
    await rename(part, file);
    return key;
  }

  /** The content stored under this name, as a Buffer. */
  async function get(key) {
    let packed;
    try {
      packed = await readFile(fileOf(key));
    } catch (err) {
      if (err.code === "ENOENT") throw new Error(`blob ${key} is missing`);
      throw err;
    }
    return unzip(packed);
  }

  return {
    put,
    get,
    putJson: (value) => put(JSON.stringify(value)),
    getJson: async (key) => JSON.parse((await get(key)).toString("utf8")),
  };
}

/** The Builder API's blob store (STORAGE=local; checked in src/config.js). */
export const blobs = createBlobStore({ dir: path.join(RUNS_DIR, "blobs") });
