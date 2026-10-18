// Backend generator, piece 11.3 (no database): operations (status buttons, export, custom) and stats
// become routes only when the screenshots show them.
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateBackend, writeBackend } from "../src/generator/index.js";
import { editDeleteSpec, opsSpec } from "./fixtures/specs.js";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), ".generated", "ops");
const load = (file) => import(pathToFileURL(path.join(OUT, file)).href);
const routeTable = (router) =>
  router.stack.filter((layer) => layer.route).flatMap((layer) => Object.keys(layer.route.methods).map((m) => `${m.toUpperCase()} ${layer.route.path}`));

before(async () => {
  await rm(OUT, { recursive: true, force: true });
  await writeBackend(OUT, generateBackend(opsSpec, { name: "Leave Desk" }));
});
after(() => rm(OUT, { recursive: true, force: true }));

describe("generated operations", () => {
  it("adds one route per visible button: status changes, export, and custom buttons", async () => {
    const { router } = await load("backend/routes/leaveRequest.routes.js");
    assert.deepEqual(routeTable(router).sort(), [
      "GET /",
      "GET /export.csv",
      "POST /:id/approve",
      "POST /:id/recalculate",
      "POST /:id/reject",
      "POST /sync-payroll",
    ]);
  });

  it("puts /export.csv before /:id routes so it is never read as an id", async () => {
    const { router } = await load("backend/routes/leaveRequest.routes.js");
    const paths = routeTable(router).map((r) => r.split(" ")[1]);
    const firstIdRoute = paths.findIndex((p) => p.startsWith("/:id"));
    assert.ok(paths.indexOf("/export.csv") < firstIdRoute);
  });

  it("documents each operation route with its button's evidence", () => {
    const routes = generateBackend(opsSpec, { name: "x" })["backend/routes/leaveRequest.routes.js"];
    assert.match(routes, /\/\/ s1: row action 'Approve'\n.*router\.post\("\/:id\/approve"/);
  });

  it("marks custom buttons as not available yet (written by the AI layer in Step 13)", () => {
    const controller = generateBackend(opsSpec, { name: "x" })["backend/controllers/leaveRequest.controller.js"];
    assert.match(controller, /status\(501\)/);
    assert.match(controller, /Recalculate/);
  });

  it("generates no operation code when the screen has no extra buttons", () => {
    const controller = generateBackend(editDeleteSpec, { name: "x" })["backend/controllers/employee.controller.js"];
    assert.doesNotMatch(controller, /501|text\/csv|\$set: \{ status/);
  });
});

describe("generated stats", () => {
  it("generates a stats route only when stat cards are visible, mounted at /api/stats", () => {
    const withStats = generateBackend(opsSpec, { name: "x" });
    const without = generateBackend(editDeleteSpec, { name: "x" });
    assert.ok(withStats["backend/routes/stats.routes.js"]);
    assert.match(withStats["backend/server.js"], /app\.use\("\/api\/stats", statsRoutes\)/);
    assert.equal(without["backend/routes/stats.routes.js"], undefined);
    assert.doesNotMatch(without["backend/server.js"], /stats/);
  });

  it("names each number after its card, matching the page's data-stat markers", () => {
    const stats = generateBackend(opsSpec, { name: "x" })["backend/routes/stats.routes.js"];
    for (const key of ["totalRequests", "pending", "totalDays", "happinessIndex"]) assert.match(stats, new RegExp(`\\b${key}\\b`));
  });
});
