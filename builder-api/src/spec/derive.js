// UI inventory -> App Spec. Deterministic: the same screenshots always give the same spec.
// Rule: no evidence, no code. Every spec item records the screenshot element that requires it
// (ARCHITECTURE.md v3.1 §0 and §4.2).

const SKIP_COLUMN = /^(#|no\.?|s\.?\s?no\.?|id|actions?|)$/i;
const TITLE_NOISE = /\b(management|manager|list|dashboard|page|overview|table|admin|details|form|all)\b/gi;

const UPDATE = /^(edit|update|modify)$/i;
const DELETE = /^(delete|remove|trash)$/i;
const VIEW = /^(view|details|open)$/i;
const CREATE = /^(\+|add|new|create)\b/i;
const EXPORT = /\bexport\b/i;
const ARCHIVE = /archiv|restore|deleted|trash/i;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BOOLEAN = /^(yes|no|true|false|y|n|✓|✗|✔|✘)$/i;
const NUMBER = /^[-+]?[$€£₹]?\s*\d[\d,]*(\.\d+)?\s*%?$/;
const DATES = [
  /^\d{4}-\d{2}-\d{2}/, // 2024-01-15
  /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/, // 15/02/2024
  /^[A-Za-z]{3,9}\.? \d{1,2},? \d{4}$/, // Mar 3, 2024
  /^\d{1,2} [A-Za-z]{3,9}\.?,? \d{4}$/, // 3 Mar 2024
];

const INPUT_TYPE = { text: "string", textarea: "string", email: "email", number: "number", date: "date", checkbox: "boolean" };

const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1);

/** "Full Name" -> "fullName", "Salary ($)" -> "salary". */
export function camelCase(label) {
  const words = String(label).replace(/\([^)]*\)/g, " ").split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words.map((w, i) => (i === 0 ? w.toLowerCase() : capitalize(w.toLowerCase()))).join("");
}

/** Field type from the sample values shown in a column. */
export function inferType(values) {
  const shown = values.map((v) => String(v).trim()).filter(Boolean);
  if (shown.length === 0) return "string";
  const all = (test) => shown.every(test);
  if (all((v) => EMAIL.test(v))) return "email";
  if (all((v) => BOOLEAN.test(v))) return "boolean";
  if (all((v) => NUMBER.test(v))) return "number";
  if (all((v) => DATES.some((d) => d.test(v)))) return "date";
  return "string";
}

const singular = (word) => (/ies$/.test(word) ? word.replace(/ies$/, "y") : /[^s]s$/.test(word) ? word.slice(0, -1) : word);
const plural = (word) => (/[^aeiou]y$/.test(word) ? word.replace(/y$/, "ies") : /(s|x|ch|sh)$/.test(word) ? `${word}es` : `${word}s`);

// The entity a table/form is about: the vision pass's hint, else the screen title without noise words.
function entityName(hint, title) {
  if (hint?.singular) return { name: camelCase(hint.singular), plural: camelCase(hint.plural || plural(hint.singular)) };
  const base = camelCase(String(title ?? "").replace(TITLE_NOISE, " "));
  if (!base) return null;
  const name = singular(base);
  return { name, plural: plural(name) };
}

export function deriveSpec(screens) {
  const entities = new Map();
  const operations = [];
  const stats = [];
  const openQuestions = [];
  const pages = [];
  const rowButtons = []; // resolved after all fields are known (status values may come from any screen)
  const statCards = [];
  let auth = null;

  // Entities that have their own table somewhere: a column/select naming one of them is a relation.
  const managed = new Map();
  screens.forEach((s, i) => {
    if (s.kind === "login") return;
    for (const table of s.tables) {
      const id = entityName(table.entityHint, s.title);
      if (!id) continue;
      const where = `s${i + 1}: table '${s.title}'`;
      for (const key of [id.name, id.plural]) managed.set(key.toLowerCase(), { ...id, where });
    }
  });

  function getEntity(id, label) {
    if (!entities.has(id.name)) {
      entities.set(id.name, {
        name: id.name,
        plural: id.plural,
        label,
        sampleConst: `SAMPLE_${id.plural.toUpperCase()}`,
        fields: [],
        endpoints: {},
      });
    }
    return entities.get(id.name);
  }

  // A label that names another managed entity becomes a relation to it.
  const relationFor = (label, entity) => {
    const target = managed.get(camelCase(label).toLowerCase());
    return target && target.name !== entity.name ? target : null;
  };

  function addField(entity, incoming) {
    const existing = entity.fields.find((f) => f.name === incoming.name);
    if (!existing) {
      entity.fields.push(incoming);
      return;
    }
    // A later sighting (usually the form) adds what the first one could not show.
    existing.required ||= incoming.required;
    if (existing.type !== "ref" && incoming.fromForm && incoming.type !== "string") {
      existing.type = incoming.type;
      if (incoming.options) existing.options = incoming.options;
    }
    existing.evidence = `${existing.evidence}; ${incoming.evidence}`;
  }

  screens.forEach((s, i) => {
    const n = i + 1;
    const at = (what) => `s${n}: ${what}`;

    if (s.auth?.loginForm) {
      auth = {
        login: { evidence: at("login form") },
        signup: s.auth.signupLink ? { evidence: at("sign-up link") } : null,
        me: s.auth.userMenu ? { evidence: at("user menu") } : null,
        roles: s.auth.roleIndicators?.length
          ? { values: [...new Set(s.auth.roleIndicators.map((r) => r.toLowerCase()))], evidence: at("role labels") }
          : null,
      };
    }
    if (s.kind === "login") {
      pages.push({ screenshot: n, kind: s.kind });
      return;
    }

    let primary = null;
    for (const table of s.tables) {
      const id = entityName(table.entityHint, s.title);
      if (!id) continue;
      const entity = getEntity(id, s.title);
      primary ??= entity;

      for (const col of table.columns) {
        if (SKIP_COLUMN.test(col.label.trim())) continue;
        const name = camelCase(col.label);
        const base = { name, label: col.label, required: false, evidence: at(`column '${col.label}'`) };
        const target = relationFor(col.label, entity);
        if (target) addField(entity, { ...base, type: "ref", ref: target.name, evidence: `${base.evidence}; ${target.where}` });
        else if (col.badge) addField(entity, { ...base, type: "enum", options: [...new Set(col.values)] });
        else addField(entity, { ...base, type: inferType(col.values) });
      }

      const list = (entity.endpoints.list ??= { search: false, filters: [], pagination: false, evidence: at(`table '${s.title}'`) });
      list.search ||= Boolean(s.search);
      list.pagination ||= Boolean(s.pagination);
      for (const f of s.filters) if (!list.filters.includes(camelCase(f.label))) list.filters.push(camelCase(f.label));

      for (const label of table.rowActions) {
        const evidence = at(`row action '${label}'`);
        if (UPDATE.test(label)) {
          entity.endpoints.update ??= { evidence };
          entity.endpoints.get ??= { evidence: `${evidence} (loads the record)` };
        } else if (DELETE.test(label)) {
          entity.endpoints.delete ??= { soft: false, evidence };
        } else if (VIEW.test(label)) {
          entity.endpoints.get ??= { evidence };
        } else {
          rowButtons.push({ entity, label, evidence });
        }
      }
    }

    const formEntity = s.forms.length ? getEntityForForm(s) : null;
    primary ??= formEntity;

    for (const button of s.buttons) {
      const evidence = at(`button '${button.label}'`);
      const entity = primary;
      if (!entity) continue;
      if (CREATE.test(button.label)) entity.endpoints.create ??= { evidence };
      else if (EXPORT.test(button.label)) {
        operations.push({ name: `export${capitalize(entity.plural)}`, entity: entity.name, kind: "export", button: button.label, evidence });
      } else if (ARCHIVE.test(button.label)) entity.archiveEvidence ??= evidence;
      else rowButtons.push({ entity, label: button.label, evidence, scope: "page" });
    }

    for (const form of s.forms) {
      const entity = formEntity;
      if (!entity) break;
      for (const input of form.inputs) {
        if (input.kind === "password") continue;
        const name = camelCase(input.label);
        const base = { name, label: input.label, required: Boolean(input.required), fromForm: true, evidence: at(`form input '${input.label}'`) };
        const target = relationFor(input.label, entity);
        if (target) addField(entity, { ...base, type: "ref", ref: target.name, evidence: `${base.evidence}; ${target.where}` });
        else if (input.kind === "select") {
          addField(entity, { ...base, type: "enum", options: input.options ?? [] });
          openQuestions.push({
            entity: entity.name,
            field: name,
            question: `Is "${input.label}" a fixed list, or data you manage on its own page?`,
            default: "enum",
          });
        } else addField(entity, { ...base, type: INPUT_TYPE[input.kind] ?? "string" });
      }
      if (s.kind === "form") entity.endpoints.create ??= { evidence: at(`form '${form.submitLabel ?? "submit"}'`) };
    }

    for (const card of s.statCards) statCards.push({ card, entity: primary, evidence: at(`stat card '${card.label}'`) });
    pages.push({ screenshot: n, kind: s.kind, ...(primary && { entity: primary.name }) });

    function getEntityForForm(screen) {
      const hint = screen.forms.find((f) => f.entityHint)?.entityHint ?? screen.tables[0]?.entityHint;
      const id = entityName(hint, screen.title);
      return id ? getEntity(id, screen.title) : null;
    }
  });

  for (const { entity, label, evidence, scope } of rowButtons) operations.push(operationFor(entity, label, evidence, scope));
  for (const { card, entity, evidence } of statCards) stats.push(statFor(card, entity, evidence, openQuestions));

  for (const entity of entities.values()) {
    if (entity.endpoints.delete && entity.archiveEvidence) {
      entity.endpoints.delete.soft = true;
      entity.endpoints.delete.evidence += `; ${entity.archiveEvidence}`;
    }
    delete entity.archiveEvidence;
    for (const f of entity.fields) delete f.fromForm;
  }

  return { entities: [...entities.values()], operations, stats, auth, pages, openQuestions };
}

// "Approve" next to a Status badge with "Approved" -> a template status change; anything else -> AI.
function operationFor(entity, label, evidence, scope = "row") {
  const words = label.toLowerCase().replace(/^mark\s+as\s+/, "").split(/\s+/);
  const stem = words[0].replace(/e$/, "");
  for (const f of entity.fields) {
    if (f.type !== "enum") continue;
    const option = f.options.find((o) => o.toLowerCase().startsWith(stem) || o.toLowerCase() === words.at(-1));
    if (option) {
      return { name: `${camelCase(words[0])}${capitalize(entity.name)}`, entity: entity.name, kind: "setStatus", set: { [f.name]: option }, button: label, evidence };
    }
  }
  return { name: `${camelCase(label)}${capitalize(entity.name)}`, entity: entity.name, kind: "custom", scope, button: label, evidence };
}

// One stat per card: a count of the entity, a count by an enum value, a sum of a number field, or custom.
function statFor(card, entity, evidence, openQuestions) {
  const label = card.label.trim();
  const rest = camelCase(label.replace(/^total\s+/i, "")).toLowerCase();
  if (entity) {
    if ([entity.name, entity.plural].map((x) => x.toLowerCase()).includes(rest)) {
      return { label, entity: entity.name, metric: "count", evidence };
    }
    for (const f of entity.fields) {
      const option = f.type === "enum" && f.options.find((o) => o.toLowerCase() === label.toLowerCase());
      if (option) return { label, entity: entity.name, metric: "count", where: { [f.name]: option }, evidence };
      if (f.type === "number" && /^total\s+/i.test(label) && f.name.toLowerCase() === rest) {
        return { label, entity: entity.name, metric: "sum", field: f.name, evidence };
      }
    }
  }
  openQuestions.push({ stat: label, question: `How is "${label}" calculated?`, default: "custom" });
  return { label, ...(entity && { entity: entity.name }), metric: "custom", evidence };
}
