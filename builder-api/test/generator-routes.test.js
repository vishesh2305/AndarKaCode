// Backend generator, piece 11.2 (no database): every entity gets routes and a controller with
// EXACTLY the endpoints its screenshots show, and the server mounts them under /api/<plural>.
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateBackend, writeBackend } from "../src/generator/index.js";
import { catalogSpec, editDeleteSpec, relationSpec } from "./fixtures/specs.js";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), ".generated", "routes");
const load = (dir, file) => import(pathToFileURL(path.join(OUT, dir, file)).href);

// "GET /", "GET /:id", ... from an Express router.
const routeTable = (router) =>
  router.stack.filter((layer) => layer.route).flatMap((layer) => Object.keys(layer.route.methods).map((m) => `${m.toUpperCase()} ${layer.route.path}`));

before(async () => {
  await rm(OUT, { recursive: true, force: true });
  await writeBackend(path.join(OUT, "edit"), generateBackend(editDeleteSpec, { name: "x" }));
  await writeBackend(path.join(OUT, "catalog"), generateBackend(catalogSpec, { name: "x" }));
  await writeBackend(path.join(OUT, "relation"), generateBackend(relationSpec, { name: "x" }));
});
after(() => rm(OUT, { recursive: true, force: true }));

describe("generated routes: exactly the endpoints on screen", () => {
  it("Edit/Delete only -> list, get, update, delete; no create", async () => {
    const { router } = await load("edit", "backend/routes/employee.routes.js");
    assert.deepEqual(routeTable(router).sort(), ["DELETE /:id", "GET /", "GET /:id", "PUT /:id"]);
  });

  it("Add only -> list and create; no get, update or delete", async () => {
    const { router } = await load("catalog", "backend/routes/product.routes.js");
    assert.deepEqual(routeTable(router).sort(), ["GET /", "POST /"]);
  });

  it("a list-only entity gets only GET /", async () => {
    const { router } = await load("relation", "backend/routes/department.routes.js");
    assert.deepEqual(routeTable(router), ["GET /"]);
  });

  it("generates a controller with only the handlers its routes use", () => {
    const controller = generateBackend(catalogSpec, { name: "x" })["backend/controllers/product.controller.js"];
    assert.match(controller, /export async function list\(/);
    assert.match(controller, /export async function create\(/);
    assert.doesNotMatch(controller, /export async function (get|update|remove)\(/);
  });

  it("adds search, filter and paging code only when the screenshot shows them", () => {
    const files = (spec) => generateBackend(spec, { name: "x" });
    const catalog = files(catalogSpec)["backend/controllers/product.controller.js"];
    const edit = files(editDeleteSpec)["backend/controllers/employee.controller.js"];
    assert.match(catalog, /req\.query\.q/);
    assert.match(catalog, /"category"/);
    assert.match(catalog, /req\.query\.page/);
    assert.doesNotMatch(edit, /req\.query\.(q|page)/);
  });

  it("mounts every entity's routes under /api/<plural>", () => {
    const server = generateBackend(relationSpec, { name: "x" })["backend/server.js"];
    assert.match(server, /app\.use\("\/api\/leaveRequests", leaveRequestRoutes\)/);
    assert.match(server, /app\.use\("\/api\/departments", departmentRoutes\)/);
  });

  it("documents each route with the screenshot element it comes from", () => {
    const routes = generateBackend(editDeleteSpec, { name: "x" })["backend/routes/employee.routes.js"];
    assert.match(routes, /\/\/ s1: row action 'Delete'\n.*router\.delete\("\/:id"/);
  });
});
