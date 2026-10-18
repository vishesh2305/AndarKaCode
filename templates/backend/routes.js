// backend/routes/<entity>.routes.js: one line per endpoint the screenshots show, with its evidence.
const ROUTES = [
  ["list", "get", "/", "list"],
  ["get", "get", "/:id", "get"],
  ["create", "post", "/", "create"],
  ["update", "put", "/:id", "update"],
  ["delete", "delete", "/:id", "remove"],
];

export default ({ entity, comment }) => {
  const lines = ROUTES.filter(([key]) => entity.endpoints[key]).map(
    ([key, method, route, handler]) => `// ${comment(entity.endpoints[key].evidence)}\nrouter.${method}(${JSON.stringify(route)}, controller.${handler});`
  );
  return `// API routes for ${comment(entity.label)}: only the endpoints the screenshots show.
import { Router } from "express";
import * as controller from "../controllers/${entity.name}.controller.js";

export const router = Router();

${lines.join("\n\n")}
`;
};
