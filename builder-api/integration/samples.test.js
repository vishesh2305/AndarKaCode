// Integration, evaluation plan B1: "Try a sample". The upload screen offers a few ready screenshots, so nobody
// hunts through folders on stage. GET /api/samples lists them; each image is served from samples/mocks by its
// id (never by a path from the request); a sample uploads and builds like any other screenshot.
// Needs a MongoDB: TEST_MONGODB_URI=mongodb://127.0.0.1:27017/builder_test npm run test:integration
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { startSignedInApi } from "./helpers/signed-in-api.js";

const MONGODB_URI = process.env.TEST_MONGODB_URI;
if (!MONGODB_URI) throw new Error("Set TEST_MONGODB_URI (a throwaway database; it is dropped before the tests)");
const PNG_START = "89504e470d0a1a0a";

let api;
let session;
before(async () => {
  await mongoose.connect(MONGODB_URI);
  await mongoose.connection.dropDatabase();
  api = await startSignedInApi({ MONGODB_URI }); // ROLE=api: projects are saved, not built
  session = await api.signIn("demo@example.com");
});
after(async () => {
  api?.stop();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe("Try a sample", () => {
  it("lists the samples: a name, what it shows, and its screenshots in page order", async () => {
    const res = await api.get("/api/samples", session);
    assert.equal(res.status, 200);
    const samples = await res.json();
    assert.deepEqual(samples.map((s) => s.id), ["techfest", "employees", "orders", "departments"]);
    for (const s of samples) {
      assert.ok(s.name && s.about, JSON.stringify(s));
      assert.ok(s.images.length >= 1);
      for (const url of s.images) assert.match(url, new RegExp(`^/api/samples/${s.id}/\\d+\\.png$`));
    }
    assert.equal(samples.find((s) => s.id === "departments").images.length, 2, "a two-page sample: employees and their departments");
  });

  it("serves each screenshot as a PNG", async () => {
    const samples = await (await api.get("/api/samples", session)).json();
    for (const url of samples.flatMap((s) => s.images)) {
      const res = await api.get(url, session);
      assert.equal(res.status, 200, url);
      assert.equal(res.headers.get("content-type"), "image/png");
      assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 8).toString("hex"), PNG_START, url);
    }
  });

  it("an unknown sample, a page it doesn't have, or a path is 404", async () => {
    for (const url of ["/api/samples/nope/1.png", "/api/samples/techfest/2.png", "/api/samples/techfest/0.png", "/api/samples/..%2F..%2Fpackage.json/1.png"]) {
      assert.equal((await api.get(url, session)).status, 404, url);
    }
  });

  it("needs sign-in, like the rest of the API", async () => {
    assert.equal((await api.get("/api/samples")).status, 401);
  });

  it("a sample's screenshots upload like any others", async () => {
    const departments = (await (await api.get("/api/samples", session)).json()).find((s) => s.id === "departments");
    const form = new FormData();
    for (const [i, url] of departments.images.entries()) {
      form.append("image", new Blob([await (await api.get(url, session)).arrayBuffer()], { type: "image/png" }), `page-${i + 1}.png`);
    }
    form.append("name", departments.name);
    const res = await api.get("/api/projects", session, { method: "POST", body: form });
    assert.equal(res.status, 201, await res.clone().text());
    const project = await res.json();
    assert.equal(project.name, departments.name);
    assert.equal(project.screenshots.length, 2);
  });
});
