// Step 21: the blob store. Big pieces (remembered pages, readings, code) are kept as compressed files named
// by the SHA-256 of their content, and the database keeps only that name. "local" writes them under
// runs/blobs/; "r2" (Cloudflare, Step 46) will keep the same names in a bucket.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createBlobStore } from "../src/blobs.js";

const store = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "blobs-"));
  return { dir, blobs: createBlobStore({ dir }) };
};
const PAGE = `<!DOCTYPE html><html><body>${"<tr><td>Ann Lee</td><td>52,000</td></tr>".repeat(400)}</body></html>`;

async function filesIn(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) if (entry.isFile()) out.push(path.join(entry.parentPath ?? entry.path, entry.name));
  return out;
}

describe("createBlobStore (local)", () => {
  it("names a blob by the SHA-256 of its content and gives the same content back", async () => {
    const { blobs } = await store();
    const key = await blobs.put(PAGE);
    assert.equal(key, createHash("sha256").update(PAGE).digest("hex"));
    assert.equal((await blobs.get(key)).toString("utf8"), PAGE);
  });

  it("keeps the same content once, however often it is put", async () => {
    const { dir, blobs } = await store();
    assert.equal(await blobs.put(PAGE), await blobs.put(PAGE));
    assert.equal((await filesIn(dir)).length, 1);
  });

  it("stores it compressed", async () => {
    const { dir, blobs } = await store();
    await blobs.put(PAGE);
    const [file] = await filesIn(dir);
    assert.ok((await stat(file)).size < PAGE.length / 10, "repetitive HTML compresses well");
  });

  it("keeps JSON values as they were (readings are objects)", async () => {
    const { blobs } = await store();
    const reading = { title: "Employees", tables: [{ columns: ["Full Name", "Salary"] }] };
    assert.deepEqual(await blobs.getJson(await blobs.putJson(reading)), reading);
    assert.equal(await blobs.getJson(await blobs.putJson("plain text")), "plain text");
  });

  it("says which blob is missing", async () => {
    const { blobs } = await store();
    await assert.rejects(blobs.get("a".repeat(64)), /blob a{64} is missing/);
  });

  it("refuses a name that is not a SHA-256 (it could reach outside the folder)", async () => {
    const { blobs } = await store();
    for (const bad of ["../../etc/passwd", "abc", "A".repeat(64)]) await assert.rejects(blobs.get(bad), /not a blob name/, bad);
  });
});
