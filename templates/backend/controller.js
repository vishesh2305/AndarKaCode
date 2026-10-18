// backend/controllers/<entity>.controller.js: one handler per endpoint the screenshots show.
// Search, filter and paging code appear only when the screenshot shows those controls.
const LIST_CAP = 500; // a list with no paging on screen still returns a bounded number of rows

// Emitted as-is into controllers that have an Export button.
const CSV_HELPER = String.raw`// Quotes, commas and line breaks are escaped; text starting with = + - @ is prefixed with ' so a
// spreadsheet never runs it as a formula.
function csvCell(value) {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === "string" && /^[=+\-@]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}`;

export default ({ entity, spec, comment, pascal }) => {
  const { endpoints } = entity;
  const M = entity.Model;
  const soft = Boolean(endpoints.delete?.soft);
  const writes = Boolean(endpoints.create || endpoints.update);
  const refFields = entity.fields.filter((f) => f.type === "ref");
  const refModels = writes ? [...new Set(refFields.map((f) => f.ref))] : [];
  const operations = entity.operations ?? [];
  const exportOp = operations.find((o) => o.kind === "export");
  const needsId = Boolean(endpoints.get || endpoints.update || endpoints.delete || operations.some((o) => o.route.row));
  const list = endpoints.list;
  const searchFields = list?.search ? entity.fields.filter((f) => f.type === "string" || f.type === "email").map((f) => f.name) : [];
  const filterFields = (list?.filters ?? []).filter((name) => entity.fields.some((f) => f.name === name));
  const populate = refFields.length ? `.populate(${JSON.stringify(refFields.map((f) => f.name).join(" "))})` : "";
  const alive = soft ? "...ALIVE, " : "";
  const isSoft = (name) => Boolean(spec.entities.find((e) => e.name === name)?.endpoints.delete?.soft);

  const imports = [
    `import { ${M} } from "../models/${entity.name}.model.js";`,
    writes && `import { validate${M} } from "../validation/${entity.name}.validation.js";`,
    ...refModels.map((ref) => `import { ${pascal(ref)} } from "../models/${ref}.model.js";`),
  ].filter(Boolean);

  const helpers = [
    soft && "const ALIVE = { deletedAt: null }; // soft delete: deleted records are kept but hidden",
    needsId && "const isId = (id) => /^[a-f0-9]{24}$/i.test(id);",
    needsId && `const notFound = (res) => res.status(404).json({ error: ${JSON.stringify(`${M} not found`)} });`,
    writes && 'const invalid = (res, details) => res.status(400).json({ error: "Invalid input", details });',
    searchFields.length && 'const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");',
    exportOp && `const CSV_COLUMNS = ${JSON.stringify(entity.fields.map((f) => [f.name, f.label]))};`,
    exportOp && CSV_HELPER,
  ].filter(Boolean);

  const refCheck = refModels.length
    ? `
// A relation must point at a record that exists.
async function checkRelations(value, errors) {
${refFields
  .filter((f) => refModels.includes(f.ref))
  .map(
    (f) => `  if (value.${f.name} && !(await ${pascal(f.ref)}.exists({ _id: value.${f.name}${isSoft(f.ref) ? ", deletedAt: null" : ""} }))) {
    errors.${f.name} = "must be the id of an existing record";
  }`
  )
  .join("\n")}
}
`
    : "";

  const handlers = [];

  if (list) {
    const body = [`  const filter = ${soft ? "{ ...ALIVE }" : "{}"};`];
    if (searchFields.length) {
      body.push(`  const q = String(req.query.q ?? "").trim();
  if (q) {
    const pattern = new RegExp(escapeRegex(q), "i");
    filter.$or = ${JSON.stringify(searchFields)}.map((field) => ({ [field]: pattern }));
  }`);
    }
    if (filterFields.length) {
      body.push(`  for (const field of ${JSON.stringify(filterFields)}) {
    if (req.query[field] !== undefined && req.query[field] !== "") filter[field] = req.query[field];
  }`);
    }
    if (list.pagination) {
      body.push(`  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 10, 1), 100);
  const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
  const [items, total] = await Promise.all([
    ${M}.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)${populate},
    ${M}.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });`);
    } else {
      body.push(`  const [items, total] = await Promise.all([
    ${M}.find(filter).sort({ createdAt: -1 }).limit(${LIST_CAP})${populate},
    ${M}.countDocuments(filter),
  ]);
  res.json({ items, total });`);
    }
    handlers.push(`// ${comment(list.evidence)}
export async function list(req, res) {
${body.join("\n")}
}`);
  }

  if (endpoints.get) {
    handlers.push(`// ${comment(endpoints.get.evidence)}
export async function get(req, res) {
  if (!isId(req.params.id)) return notFound(res);
  const record = await ${M}.findOne({ ${alive}_id: req.params.id })${populate};
  return record ? res.json(record) : notFound(res);
}`);
  }

  if (endpoints.create) {
    handlers.push(`// ${comment(endpoints.create.evidence)}
export async function create(req, res) {
  const { ok, errors, value } = validate${M}(req.body);
${refModels.length ? "  await checkRelations(value, errors);\n" : ""}  if (!ok || Object.keys(errors).length) return invalid(res, errors);
  const record = await ${M}.create(value);
  res.status(201).json(${populate ? `await record${populate}` : "record"});
}`);
  }

  if (endpoints.update) {
    handlers.push(`// ${comment(endpoints.update.evidence)}
export async function update(req, res) {
  if (!isId(req.params.id)) return notFound(res);
  const { ok, errors, value } = validate${M}(req.body, { partial: true });
${refModels.length ? "  await checkRelations(value, errors);\n" : ""}  if (!ok || Object.keys(errors).length) return invalid(res, errors);
  const record = await ${M}.findOneAndUpdate({ ${alive}_id: req.params.id }, { $set: value }, { returnDocument: "after", runValidators: true })${populate};
  return record ? res.json(record) : notFound(res);
}`);
  }

  if (endpoints.delete) {
    const action = soft
      ? `${M}.findOneAndUpdate({ ...ALIVE, _id: req.params.id }, { $set: { deletedAt: new Date() } })`
      : `${M}.findOneAndDelete({ _id: req.params.id })`;
    handlers.push(`// ${comment(endpoints.delete.evidence)}
export async function remove(req, res) {
  if (!isId(req.params.id)) return notFound(res);
  const record = await ${action};
  return record ? res.status(204).end() : notFound(res);
}`);
  }

  for (const op of operations) {
    if (op.kind === "setStatus") {
      handlers.push(`// ${comment(op.evidence)}
export async function ${op.name}(req, res) {
  if (!isId(req.params.id)) return notFound(res);
  const record = await ${M}.findOneAndUpdate({ ${alive}_id: req.params.id }, { $set: ${JSON.stringify(op.set)} }, { returnDocument: "after" })${populate};
  return record ? res.json(record) : notFound(res);
}`);
    } else if (op.kind === "export") {
      handlers.push(`// ${comment(op.evidence)}
export async function ${op.name}(_req, res) {
  const records = await ${M}.find(${soft ? "ALIVE" : "{}"}).sort({ createdAt: -1 }).limit(10000);
  const lines = [
    CSV_COLUMNS.map(([, label]) => csvCell(label)).join(","),
    ...records.map((record) => CSV_COLUMNS.map(([field]) => csvCell(record[field])).join(",")),
  ];
  res.type("text/csv").attachment(${JSON.stringify(`${entity.plural}.csv`)}).send(lines.join("\\n") + "\\n");
}`);
    } else {
      handlers.push(`// ${comment(op.evidence)}: what this button does is written by the AI layer (Step 13)
export async function ${op.name}(_req, res) {
  res.status(501).json({ error: ${JSON.stringify(`"${comment(op.button)}" is not available yet`)}, operation: ${JSON.stringify(op.name)} });
}`);
    }
  }

  return `// Handlers for ${comment(entity.label)}: generated by AndarKaCode, one per endpoint and button the screenshots show.
${imports.join("\n")}

${helpers.join("\n")}
${refCheck}
${handlers.join("\n\n")}
`;
};
