// App Spec -> backend source files, from the templates in /templates/backend (no AI).
// Only the files the spec needs are generated (ARCHITECTURE.md v3.1 §7).
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import controller from "../../../templates/backend/controller.js";
import envExample from "../../../templates/backend/env-example.js";
import model from "../../../templates/backend/model.js";
import packageJson from "../../../templates/backend/package-json.js";
import routes from "../../../templates/backend/routes.js";
import server from "../../../templates/backend/server.js";
import validation from "../../../templates/backend/validation.js";

const pascal = (name) => name.charAt(0).toUpperCase() + name.slice(1);
// Screenshot text ends up in code comments; keep it on one line.
const comment = (text) => String(text ?? "").replace(/[\r\n]+/g, " ").trim();

function appInfo(name) {
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "generated-app";
  return { title: comment(name) || "Generated app", slug, dbName: slug.replace(/-/g, "_") };
}

/** Returns { "relative/path": "file contents" }. Pure: same spec + name -> same files. */
export function generateBackend(spec, { name }) {
  const app = appInfo(name);
  const files = {
    "package.json": packageJson({ app }),
    ".env.example": envExample({ app, spec }),
    "backend/server.js": server({ app, spec }),
  };
  for (const e of spec.entities) {
    const entity = { ...e, Model: pascal(e.name) };
    files[`backend/models/${e.name}.model.js`] = model({ entity, comment, pascal });
    if (e.endpoints.create || e.endpoints.update) {
      files[`backend/validation/${e.name}.validation.js`] = validation({ entity, comment });
    }
    files[`backend/controllers/${e.name}.controller.js`] = controller({ entity, spec, comment, pascal });
    files[`backend/routes/${e.name}.routes.js`] = routes({ entity, comment });
  }
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
