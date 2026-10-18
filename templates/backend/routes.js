// backend/routes/<entity>.routes.js: one line per endpoint and button the screenshots show, with its evidence.
// Fixed paths (/export.csv, page buttons) come before /:id routes, so they are never read as an id.
const ENDPOINTS = {
  list: ["get", "/", "list"],
  get: ["get", "/:id", "get"],
  create: ["post", "/", "create"],
  update: ["put", "/:id", "update"],
  delete: ["delete", "/:id", "remove"],
};

export default ({ entity, comment }) => {
  const line = (evidence, method, route, handler) =>
    `// ${comment(evidence)}\nrouter.${method}(${JSON.stringify(route)}, controller.${handler});`;
  const endpoint = (key) => entity.endpoints[key] && line(entity.endpoints[key].evidence, ...ENDPOINTS[key]);
  const operations = (row) =>
    entity.operations.filter((o) => o.route.row === row).map((o) => line(o.evidence, o.route.method, o.route.path, o.name));

  const lines = [
    endpoint("list"),
    ...operations(false),
    endpoint("get"),
    endpoint("create"),
    endpoint("update"),
    endpoint("delete"),
    ...operations(true),
  ].filter(Boolean);

  return `// API routes for ${comment(entity.label)}: only the endpoints and buttons the screenshots show.
import { Router } from "express";
import * as controller from "../controllers/${entity.name}.controller.js";

export const router = Router();

${lines.join("\n\n")}
`;
};
