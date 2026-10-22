// A stand-in for Screenshot-to-Code in the pipeline tests: builds a plain page from the instructions the
// Builder API sends, with every field and marker they ask for (a form, a table with one sample row drawn
// from the SAMPLE_ array, buttons, filters, stat cards). Good enough for the Verifier to use like a person.
const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function parseFields(instructions) {
  const fields = [];
  for (const line of instructions.split("\n")) {
    const m = line.match(/^- (\w+) -> label "([^"]+)"(?: \((.*)\))?$/);
    if (!m) continue;
    const extras = m[3] ?? "";
    const options = extras.match(/one of: ([^;]+)/)?.[1].split(", ");
    const type = options ? "enum" : /chosen from the/.test(extras) ? "ref" : /\b(number|email|date|boolean)\b/.exec(extras)?.[1] ?? "string";
    fields.push({ name: m[1], label: m[2], type, options, required: /required/.test(extras), dropdown: /a dropdown/.test(extras) });
  }
  return fields;
}

const sampleValue = (f) => ({ string: `Sample ${f.label}`, email: "sample@example.com", number: 7, date: "2026-01-15", boolean: true, enum: f.options?.[0] })[f.type] ?? "";

function input(f) {
  const attrs = `id="${f.name}" name="${f.name}" data-field="${f.name}"${f.required ? " required" : ""}`;
  if (f.type === "enum") return `<select ${attrs}><option value="">Select ${esc(f.label)}</option>${f.options.map((o) => `<option>${esc(o)}</option>`).join("")}</select>`;
  if (f.type === "ref") return `<select ${attrs}><option value="">Select ${esc(f.label)}</option></select>`;
  if (f.dropdown) return `<select ${attrs}><option value="">Select ${esc(f.label)}</option><option>Alpha</option><option>Beta</option></select>`;
  if (f.type === "boolean") return `<input type="checkbox" ${attrs.replace(" required", "")}>`;
  const type = { number: "number", email: "email", date: "date" }[f.type] ?? "text";
  return `<input type="${type}" ${attrs}>`;
}

export function fakePage(instructions) {
  if (instructions.includes("This is a sign-in page.")) {
    const signup = instructions.includes('data-action="signup"') ? '<a href="#" data-action="signup">Sign up</a>' : "";
    return `<!doctype html><html><body><h1>Sign in</h1><form>
<label for="email">Email</label><input type="email" id="email" name="email" data-field="email" required>
<label for="password">Password</label><input type="password" id="password" name="password" data-field="password" required>
<button type="submit" data-action="login">Sign in</button></form>${signup}</body></html>`;
  }
  const title = instructions.match(/page title "([^"]+)"/)?.[1] ?? "Page";
  const sample = instructions.match(/const (SAMPLE_\w+) = \[/)?.[1] ?? "SAMPLE_ROWS";
  const fields = parseFields(instructions);
  const actions = [...new Set([...instructions.matchAll(/data-action="(\w+)"/g)].map((m) => m[1]))];
  const exampleRow = instructions.split("\n").find((l) => l.includes("<tr>")) ?? "";
  const rowActions = actions.filter((a) => exampleRow.includes(`data-action="${a}"`));
  const pageActions = actions.filter((a) => !rowActions.includes(a) && !["create", "search", "prevPage", "nextPage"].includes(a));
  const filters = [...instructions.matchAll(/data-filter="(\w+)"/g)].map((m) => m[1]);
  const stats = [...instructions.matchAll(/data-stat="(\w+)"/g)].map((m) => m[1]);
  const hasForm = instructions.includes("The form has one input per field");
  const hasTable = instructions.includes("Every table cell showing a field");
  const buttonLabel = (a) => instructions.match(new RegExp(`"([^"]+)" button MUST have data-action="${a}"`))?.[1] ?? a;

  const parts = [`<h1>${esc(title)}</h1>`];
  parts.push(...stats.map((s) => `<div class="card"><p>${esc(s)}</p><p data-stat="${s}">12</p></div>`));
  if (actions.includes("search")) parts.push('<input type="search" placeholder="Search" data-action="search">');
  parts.push(...filters.map((f) => `<select data-filter="${f}"><option value="">All</option></select>`));
  parts.push(...pageActions.map((a) => `<button data-action="${a}">${esc(buttonLabel(a))}</button>`));
  if (hasForm) {
    parts.push(
      `<form>${fields.map((f) => `<label for="${f.name}">${esc(f.label)}</label>${input(f)}`).join("\n")}
<button type="submit"${actions.includes("create") ? ' data-action="create"' : ""}>${actions.includes("create") ? "Add" : "Save"}</button></form>`
    );
  }
  if (hasTable) {
    const head = fields.map((f) => `<th>${esc(f.label)}</th>`).join("");
    const buttons = rowActions.map((a) => `<button data-action="${a}">${esc(a === "update" ? "Edit" : a === "delete" ? "Delete" : buttonLabel(a))}</button>`).join(" ");
    const cells = fields.map((f) => `'<td data-field="${f.name}">' + r.${f.name} + '</td>'`).join(" + ");
    parts.push(`<table><thead><tr>${head}<th></th></tr></thead><tbody id="rows"></tbody></table>`);
    if (actions.includes("prevPage")) parts.push('<button data-action="prevPage">Previous</button><button data-action="nextPage">Next</button>');
    parts.push(`<script>
const ${sample} = [${JSON.stringify(Object.fromEntries(fields.map((f) => [f.name, sampleValue(f)])))}];
for (const r of ${sample}) document.getElementById("rows").insertAdjacentHTML("beforeend", "<tr>" + ${cells || "''"} + '<td>${buttons.replace(/'/g, "\\'")}</td></tr>');
</script>`);
  }
  return `<!doctype html><html><body>\n${parts.join("\n")}\n</body></html>`;
}
