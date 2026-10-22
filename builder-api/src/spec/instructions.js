// App Spec + one screenshot -> the text Screenshot-to-Code receives with that screenshot.
// Only what is on THAT page (decided by each item's evidence "sN: ..."), with the exact markers
// the runtime binder (Step 15) and the Verifier (Step 16) look for.
import { camelCase } from "./derive.js";

const onPage = (item, n) => new RegExp(`(^|; )s${n}: `).test(item?.evidence ?? "");

const INPUT_HINT = {
  string: "a text <input>",
  email: '<input type="email">',
  number: '<input type="number">',
  date: '<input type="date">',
  boolean: '<input type="checkbox">',
  enum: "a <select>",
  ref: "a <select>",
};

// A dropdown stored as text (its choices were not visible) is still drawn as a dropdown.
const inputHint = (f) => (f.control === "select" ? "a <select>" : INPUT_HINT[f.type]);

function describeField(f) {
  const extras = [];
  if (f.type === "enum") extras.push(`one of: ${f.options.join(", ")}`);
  else if (f.control === "select") extras.push("a dropdown");
  else if (f.type === "ref") extras.push(`chosen from the ${f.ref} list`);
  else if (f.type !== "string") extras.push(f.type);
  if (f.required) extras.push("required");
  return `- ${f.name} -> label "${f.label}"${extras.length ? ` (${extras.join("; ")})` : ""}`;
}

const HEADER = "Build this page with these EXACT names and markers. Do not rename them: they connect the page to its backend.";

function loginInstructions(auth) {
  return [
    HEADER,
    "",
    "This is a sign-in page.",
    '- The email input MUST have name="email" and data-field="email".',
    '- The password input MUST have name="password" and data-field="password".',
    '- The sign-in button MUST have data-action="login".',
    auth.signup && '- The sign-up link or button MUST have data-action="signup".',
  ]
    .filter(Boolean)
    .join("\n");
}

export function pageInstructions(spec, n) {
  const page = spec.pages.find((p) => p.screenshot === n);
  if (!page) throw new Error(`The spec has no page for screenshot ${n}`);
  if (page.kind === "login") return loginInstructions(spec.auth ?? {});

  const lines = [HEADER, ""];
  const entity = spec.entities.find((e) => e.name === page.entity);
  const rules = [];

  if (entity) {
    const shown = entity.fields.filter((f) => onPage(f, n));
    const fields = shown.length ? shown : entity.fields;
    const has = (key) => entity.endpoints[key] && onPage(entity.endpoints[key], n);
    const operations = spec.operations.filter((o) => o.entity === entity.name && onPage(o, n));
    const rowOperations = operations.filter((o) => o.kind !== "export" && o.scope !== "page");
    const pageOperations = operations.filter((o) => !rowOperations.includes(o));

    lines.push(`Data: ${entity.name} (plural: ${entity.plural}), page title "${entity.label}".`, "Fields on this page (in this order):", ...fields.map(describeField), "");

    if (has("list")) {
      const rowButtons = [
        has("update") && '<button data-action="update">Edit</button>',
        has("delete") && '<button data-action="delete">Delete</button>',
        ...rowOperations.map((o) => `<button data-action="${o.name}">${o.button}</button>`),
      ].filter(Boolean);
      rules.push(
        `Every table cell showing a field must have data-field="<fieldName>". Example row:\n   <tr><td data-field="${fields[0].name}">...</td> ...${rowButtons.length ? ` <td>${rowButtons.join(" ")}</td>` : ""}</tr>`
      );
    }
    if (has("create") || has("update")) {
      rules.push(
        `The form has one input per field, each with name="<fieldName>" and data-field="<fieldName>".\n   Input types: ${fields.map((f) => `${f.name} = ${inputHint(f)}`).join(", ")}.`
      );
    }

    const controls = [];
    if (has("create")) controls.push(`- The button that saves a NEW ${entity.name} MUST have data-action="create". Write it exactly like this:\n  <button type="submit" data-action="create">Add ${entity.label.replace(/s$/, "")}</button>`);
    if (has("update")) controls.push('- Each row\'s Edit button MUST have data-action="update".');
    if (has("delete")) controls.push('- Each row\'s Delete button MUST have data-action="delete".');
    for (const o of rowOperations) controls.push(`- Each row's "${o.button}" button MUST have data-action="${o.name}".`);
    for (const o of pageOperations) controls.push(`- The "${o.button}" button MUST have data-action="${o.name}".`);
    const list = has("list") ? entity.endpoints.list : null;
    if (list?.search) controls.push('- The search box MUST have data-action="search".');
    for (const f of list?.filters ?? []) controls.push(`- The filter dropdown for ${f} MUST have data-filter="${f}".`);
    if (list?.pagination) controls.push('- The previous/next page buttons MUST have data-action="prevPage" and data-action="nextPage".');
    if (controls.length) rules.push(`Buttons and controls:\n${controls.join("\n")}`);

    if (has("list")) {
      rules.push(
        `Put the sample rows in a JavaScript array named exactly\n   const ${entity.sampleConst} = [ { ${fields.map((f) => `${f.name}: ...`).join(", ")} }, ... ];\n   and render the table rows from that array.`
      );
    }
  }

  const stats = spec.stats.filter((s) => onPage(s, n));
  if (stats.length) {
    rules.push(`Number cards:\n${stats.map((s) => `- The number in the "${s.label}" card MUST be inside an element with data-stat="${camelCase(s.label)}".`).join("\n")}`);
  }

  lines.push("Rules:", ...rules.map((r, i) => `${i + 1}. ${r}`));
  return lines.join("\n");
}
