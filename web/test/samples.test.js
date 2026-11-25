// Evaluation plan B1, "Try a sample": a sample (as GET /api/samples lists it) becomes the files of the upload
// form, in page order, named after the sample, as if they had been dropped in.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sampleFiles } from "../src/samples.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const departments = { id: "departments", name: "Staff & Departments", images: ["/api/samples/departments/1.png", "/api/samples/departments/2.png"] };

describe("sampleFiles", () => {
  it("fetches each screenshot, in page order, as a PNG file named after the sample", async () => {
    const asked = [];
    const fetch = async (url) => (asked.push(url), new Response(PNG, { headers: { "content-type": "image/png" } }));
    const files = await sampleFiles(departments, fetch);
    assert.deepEqual(asked, departments.images);
    assert.deepEqual(files.map((f) => f.name), ["departments-1.png", "departments-2.png"]);
    assert.ok(files.every((f) => f instanceof File && f.type === "image/png" && f.size === PNG.length));
  });

  it("a screenshot that can't be fetched says which sample failed", async () => {
    const fetch = async () => new Response("", { status: 404 });
    await assert.rejects(sampleFiles(departments, fetch), /Couldn't load the sample “Staff & Departments” \(HTTP 404\)/);
  });
});
