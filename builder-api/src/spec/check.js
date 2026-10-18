// Is this App Spec buildable? Used after derivation and when a user edits the spec.
// Returns a list of problems in plain words; an empty list means the spec is fine.

const CAMEL = /^[a-z][a-zA-Z0-9]*$/;
const FIELD_TYPES = new Set(["string", "email", "number", "boolean", "date", "enum", "ref"]);
const ENDPOINTS = new Set(["list", "get", "create", "update", "delete"]);
const OPERATION_KINDS = new Set(["setStatus", "export", "custom"]);
const METRICS = new Set(["count", "sum", "custom"]);
const PAGE_KINDS = new Set(["list", "form", "dashboard", "login", "detail", "other"]);

const hasEvidence = (item) => typeof item?.evidence === "string" && item.evidence.trim() !== "";

export function checkSpec(spec) {
  const problems = [];
  const entities = spec.entities ?? [];
  const byName = new Map();

  if (!entities.length && !spec.auth) problems.push("Nothing to build: no table, form or login form was found");

  for (const e of entities) {
    if (!CAMEL.test(e.name ?? "")) problems.push(`entity "${e.name}" is not camelCase`);
    if (!CAMEL.test(e.plural ?? "")) problems.push(`entity "${e.name}" has a plural "${e.plural}" that is not camelCase`);
    if (byName.has(e.name)) problems.push(`entity "${e.name}" appears twice`);
    byName.set(e.name, e);
  }

  for (const e of entities) {
    const seen = new Set();
    for (const f of e.fields ?? []) {
      if (!CAMEL.test(f.name ?? "")) problems.push(`field "${f.name}" is not camelCase`);
      if (seen.has(f.name)) problems.push(`field "${f.name}" appears twice in "${e.name}"`);
      seen.add(f.name);
      if (!FIELD_TYPES.has(f.type)) problems.push(`field "${f.name}" has unknown type "${f.type}"`);
      if (f.type === "enum" && !(f.options?.length > 0)) problems.push(`enum field "${f.name}" has no options`);
      if (f.type === "ref" && !byName.has(f.ref)) problems.push(`field "${f.name}" is a relation to unknown entity "${f.ref}"`);
      if (!hasEvidence(f)) problems.push(`field "${f.name}" has no evidence`);
    }
    const endpoints = Object.entries(e.endpoints ?? {});
    if (!endpoints.length) problems.push(`entity "${e.name}" has no endpoints`);
    for (const [key, endpoint] of endpoints) {
      if (!ENDPOINTS.has(key)) problems.push(`entity "${e.name}" has unknown endpoint "${key}"`);
      if (!hasEvidence(endpoint)) problems.push(`endpoint "${e.name}.${key}" has no evidence`);
    }
  }

  const operationNames = new Set();
  for (const o of spec.operations ?? []) {
    if (operationNames.has(o.name)) problems.push(`operation "${o.name}" appears twice`);
    operationNames.add(o.name);
    const entity = byName.get(o.entity);
    if (!entity) problems.push(`operation "${o.name}" belongs to unknown entity "${o.entity}"`);
    if (!OPERATION_KINDS.has(o.kind)) problems.push(`operation "${o.name}" has unknown kind "${o.kind}"`);
    if (o.kind === "setStatus" && entity) {
      for (const [fieldName, value] of Object.entries(o.set ?? {})) {
        const f = entity.fields.find((x) => x.name === fieldName);
        if (!f || f.type !== "enum" || !f.options.includes(value)) {
          problems.push(`operation "${o.name}" sets ${fieldName} to "${value}", which is not one of its options`);
        }
      }
    }
    if (!hasEvidence(o)) problems.push(`operation "${o.name}" has no evidence`);
  }

  for (const s of spec.stats ?? []) {
    const entity = s.entity && byName.get(s.entity);
    if (s.entity && !entity) problems.push(`stat "${s.label}" counts unknown entity "${s.entity}"`);
    if (!METRICS.has(s.metric)) problems.push(`stat "${s.label}" has unknown metric "${s.metric}"`);
    if (s.metric === "sum" && entity && entity.fields.find((f) => f.name === s.field)?.type !== "number") {
      problems.push(`stat "${s.label}" sums unknown number field "${s.field}"`);
    }
    if (!hasEvidence(s)) problems.push(`stat "${s.label}" has no evidence`);
  }

  if (spec.auth && !hasEvidence(spec.auth.login)) problems.push("auth.login has no evidence");

  for (const p of spec.pages ?? []) {
    if (!Number.isInteger(p.screenshot) || p.screenshot < 1) problems.push(`page has an invalid screenshot number "${p.screenshot}"`);
    if (!PAGE_KINDS.has(p.kind)) problems.push(`page ${p.screenshot} has unknown kind "${p.kind}"`);
    if (p.entity && !byName.has(p.entity)) problems.push(`page ${p.screenshot} shows unknown entity "${p.entity}"`);
  }

  return problems;
}
