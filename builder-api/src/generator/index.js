// App Spec -> backend source files, from the templates in /templates/backend (no AI).
// Only the files the spec needs are generated (ARCHITECTURE.md v3.1 §7).
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { camelCase } from "../spec/derive.js";
import apiTests from "../../../templates/backend/api-tests.js";
import * as auth from "../../../templates/backend/auth.js";
import controller from "../../../templates/backend/controller.js";
import * as customRuntime from "../../../templates/backend/custom-runtime.js";
import envExample from "../../../templates/backend/env-example.js";
import model from "../../../templates/backend/model.js";
import packageJson from "../../../templates/backend/package-json.js";
import routes from "../../../templates/backend/routes.js";
import server from "../../../templates/backend/server.js";
import statsRoutes from "../../../templates/backend/stats-routes.js";
import validation from "../../../templates/backend/validation.js";

const pascal = (name) => name.charAt(0).toUpperCase() + name.slice(1);
// Screenshot text ends up in code comments; keep it on one line.
const comment = (text) => String(text ?? "").replace(/[\r\n]+/g, " ").trim();

function appInfo(name) {
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "generated-app";
  return { title: comment(name) || "Generated app", slug, dbName: slug.replace(/-/g, "_") };
}

// "syncPayrollLeaveRequest" on leaveRequest -> "sync-payroll" (the URL part of an operation).
function operationSegment(op, entityName) {
  const base = op.name.endsWith(pascal(entityName)) ? op.name.slice(0, -entityName.length) : op.name;
  return (base || op.name).replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

// Where each operation is served. Row buttons act on one record; page buttons and export on the whole list.
export function operationRoute(op, entityName) {
  if (op.kind === "export") return { method: "get", path: "/export.csv", row: false };
  const row = op.kind === "setStatus" || op.scope !== "page";
  return { method: "post", path: `${row ? "/:id" : ""}/${operationSegment(op, entityName)}`, row };
}

/** Returns { "relative/path": "file contents" }. Pure: same spec + name -> same files. */
export function generateBackend(spec, { name }) {
  const app = appInfo(name);
  const files = {
    "package.json": packageJson({ app }),
    ".env.example": envExample({ app, spec }),
    "backend/server.js": server({ app, spec }),
  };
  const entities = [];
  for (const e of spec.entities) {
    const operations = spec.operations.filter((o) => o.entity === e.name).map((o) => ({ ...o, route: operationRoute(o, e.name) }));
    const entity = { ...e, Model: pascal(e.name), operations };
    entities.push(entity);
    files[`backend/models/${e.name}.model.js`] = model({ entity, comment, pascal });
    const custom = operations.some((o) => o.kind === "custom"); // its code checks values like Add and Edit do
    if (custom) {
      files["backend/custom/run.js"] = customRuntime.runFile();
      files["backend/custom/worker.js"] = customRuntime.workerFile();
    }
    if (e.endpoints.create || e.endpoints.update || custom) {
      files[`backend/validation/${e.name}.validation.js`] = validation({ entity, comment });
    }
    files[`backend/controllers/${e.name}.controller.js`] = controller({ entity, spec, comment, pascal });
    files[`backend/routes/${e.name}.routes.js`] = routes({ entity, comment });
  }
  if (spec.auth) {
    files["backend/auth/passwords.js"] = auth.passwords();
    files["backend/auth/middleware.js"] = auth.middleware();
    files["backend/auth/seed.js"] = auth.seed({ auth: spec.auth });
    files["backend/models/account.model.js"] = auth.accountModel({ auth: spec.auth, comment });
    files["backend/models/loginSession.model.js"] = auth.loginSessionModel();
    files["backend/routes/auth.routes.js"] = auth.authRoutes({ auth: spec.auth, comment });
  }
  if (spec.stats.length) files["backend/routes/stats.routes.js"] = statsRoutes({ spec, comment, pascal, camelCase });
  files["tests/api.test.js"] = apiTests({ app, spec, entities, pascal, camelCase, comment });
  return files;
}

/** Writes generated files under dir. */
export async function writeBackend(dir, files) {
  for (const [relPath, content] of Object.entries(files)) {
    const filePath = path.join(dir, relPath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }
}
