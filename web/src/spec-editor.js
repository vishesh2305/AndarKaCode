// Helper functions for inspecting and editing an App Spec in the UI.
// Pure functions so they can be tested directly without React or a browser.

const CAMEL = /^[a-z][a-zA-Z0-9]*$/;
export const FIELD_TYPES = ["string", "email", "number", "boolean", "date", "enum", "ref"];

/** Converts a label or phrase like "Full Name" or "phone_number" into camelCase "fullName". */
export function toCamelCase(label) {
  const words = String(label ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (!words.length) return "";
  return words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join("");
}

export function isValidCamelCase(str) {
  return CAMEL.test(String(str ?? ""));
}

/**
 * Returns a cloned spec with a field updated.
 * Handles type-switching cleanly (e.g. initializing options for enum, clearing ref if not ref).
 */
export function updateField(spec, entityName, fieldName, updates) {
  const next = structuredClone(spec);
  const entity = (next.entities ?? []).find((e) => e.name === entityName);
  if (!entity) return next;

  const field = (entity.fields ?? []).find((f) => f.name === fieldName);
  if (!field) return next;

  const oldType = field.type;
  Object.assign(field, updates);

  // If type was changed
  if (updates.type && updates.type !== oldType) {
    if (updates.type === "enum") {
      field.options = Array.isArray(updates.options) && updates.options.length ? updates.options : ["Option 1", "Option 2"];
      delete field.ref;
    } else if (updates.type === "ref") {
      const other = (next.entities ?? []).find((e) => e.name !== entityName);
      field.ref = updates.ref || other?.name || entityName;
      delete field.options;
    } else {
      delete field.options;
      delete field.ref;
    }
  }

  // Ensure options is an array of non-empty strings if enum
  if (field.type === "enum" && updates.optionsString !== undefined) {
    field.options = updates.optionsString
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
  }

  return next;
}

/**
 * Adds a new field to an entity.
 */
export function addField(spec, entityName, rawField) {
  const next = structuredClone(spec);
  const entity = (next.entities ?? []).find((e) => e.name === entityName);
  if (!entity) return next;

  const rawName = String(rawField.name ?? "").trim();
  const name = isValidCamelCase(rawName) ? rawName : toCamelCase(rawName);
  const label = (rawField.label ?? "").trim() || (name.charAt(0).toUpperCase() + name.slice(1));
  const type = FIELD_TYPES.includes(rawField.type) ? rawField.type : "string";
  const required = Boolean(rawField.required);
  const evidence = (rawField.evidence ?? "").trim() || "manual: added in editor";

  const field = { name, label, type, required, evidence };

  if (type === "enum") {
    let options = Array.isArray(rawField.options) ? rawField.options : [];
    if (!options.length && typeof rawField.optionsString === "string") {
      options = rawField.optionsString.split(",").map((s) => s.trim()).filter(Boolean);
    }
    field.options = options.length ? options : ["Active", "Inactive"];
  } else if (type === "ref") {
    const other = (next.entities ?? []).find((e) => e.name !== entityName);
    field.ref = rawField.ref || other?.name || entityName;
  }

  entity.fields = [...(entity.fields ?? []), field];
  return next;
}

/**
 * Removes a field from an entity, and cleans up any dependent setStatus operations.
 */
export function removeField(spec, entityName, fieldName) {
  const next = structuredClone(spec);
  const entity = (next.entities ?? []).find((e) => e.name === entityName);
  if (!entity) return next;

  entity.fields = (entity.fields ?? []).filter((f) => f.name !== fieldName);

  // Clean up any operations that set this field
  if (Array.isArray(next.operations)) {
    next.operations = next.operations.filter((op) => {
      if (op.entity !== entityName || op.kind !== "setStatus" || !op.set) return true;
      return !(fieldName in op.set);
    });
  }

  // Clean up any stats that sum this field
  if (Array.isArray(next.stats)) {
    next.stats = next.stats.filter((s) => {
      if (s.entity !== entityName || s.metric !== "sum") return true;
      return s.field !== fieldName;
    });
  }

  return next;
}

/**
 * Answers or resolves an open question and adjusts the field/spec if applicable.
 */
export function resolveOpenQuestion(spec, questionIndex, answer, actionChoice) {
  const next = structuredClone(spec);
  const q = next.openQuestions?.[questionIndex];
  if (!q) return next;

  q.answer = String(answer ?? "").trim();
  q.resolved = true;

  // If the question is about an entity field (e.g. enum vs ref vs text)
  if (q.entity && q.field) {
    const entity = (next.entities ?? []).find((e) => e.name === q.entity);
    const field = (entity?.fields ?? []).find((f) => f.name === q.field);
    if (field) {
      if (actionChoice === "enum") {
        field.type = "enum";
        if (!field.options || !field.options.length) field.options = ["Option 1", "Option 2"];
        delete field.ref;
      } else if (actionChoice === "ref") {
        field.type = "ref";
        const other = (next.entities ?? []).find((e) => e.name !== q.entity);
        field.ref = other?.name || q.entity;
        delete field.options;
      } else if (actionChoice === "string" || actionChoice === "text") {
        field.type = "string";
        delete field.options;
        delete field.ref;
      }
    }
  }

  return next;
}

/**
 * Quick client-side check before submitting to PUT /api/projects/:id/contract.
 * Returns a list of problem descriptions (empty if valid).
 */
export function validateSpec(spec) {
  const problems = [];
  const entities = spec?.entities ?? [];
  const byName = new Map();

  if (!entities.length && !spec?.auth) {
    problems.push("Spec has no entities or auth to build.");
  }

  for (const e of entities) {
    if (!isValidCamelCase(e.name)) problems.push(`Entity "${e.name}" must be camelCase`);
    byName.set(e.name, e);
  }

  for (const e of entities) {
    const seen = new Set();
    for (const f of e.fields ?? []) {
      if (!isValidCamelCase(f.name)) problems.push(`Field "${f.name}" in "${e.name}" must be camelCase`);
      if (seen.has(f.name)) problems.push(`Field "${f.name}" is duplicated in "${e.name}"`);
      seen.add(f.name);

      if (!FIELD_TYPES.includes(f.type)) problems.push(`Field "${f.name}" has unknown type "${f.type}"`);
      if (f.type === "enum" && (!Array.isArray(f.options) || f.options.length === 0)) {
        problems.push(`Enum field "${f.name}" requires at least one option`);
      }
      if (f.type === "ref" && !byName.has(f.ref)) {
        problems.push(`Relation field "${f.name}" points to unknown entity "${f.ref}"`);
      }
    }
  }

  return problems;
}
