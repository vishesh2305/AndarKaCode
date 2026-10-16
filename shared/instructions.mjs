// Contract -> the text Screenshot-to-Code receives with the screenshot (ARCHITECTURE.md §4).
// The markers it asks for are what the Wirer (Step 11) and the Verifier (Step 12) look for.

// "jobTitle" -> "Job Title"
const words = (camel) => camel.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

const INPUT_HINT = {
  string: 'a text <input>',
  email: '<input type="email">',
  number: '<input type="number">',
  date: '<input type="date">',
  boolean: '<input type="checkbox">',
  enum: "a <select>",
};

function describeField(f) {
  const extras = [];
  if (f.type === "enum") extras.push(`options: ${f.options.join(", ")}`);
  else if (f.type !== "string") extras.push(f.type);
  if (f.required) extras.push("required");
  return `- ${f.name} -> label "${f.label}"${extras.length ? ` (${extras.join("; ")})` : ""}`;
}

export function buildInstructions(contract) {
  const { resource, fields, actions } = contract;
  const noun = words(resource.name);
  const has = (action) => actions.includes(action);
  const firstField = fields[0].name;

  const buttonRules = [
    has("create") &&
      `- The button that saves a NEW ${noun.toLowerCase()} MUST have data-action="create". Write it exactly like this:\n` +
        `  <button type="submit" data-action="create">Add ${noun}</button>`,
    has("update") && `- Each row's Edit button MUST have data-action="update".`,
    has("delete") && `- Each row's Delete button MUST have data-action="delete".`,
    has("search") && `- The search box MUST have data-action="search".`,
  ].filter(Boolean);

  const rowButtons = [
    has("update") && '<button data-action="update">Edit</button>',
    has("delete") && '<button data-action="delete">Delete</button>',
  ].filter(Boolean);

  const sampleKeys = fields.map((f) => `${f.name}: ...`).join(", ");

  return `Build this page with these EXACT field names and markers. Do not rename them.

Resource: ${resource.name} (plural: ${resource.plural}), page title "${resource.label}"
Fields (in this order):
${fields.map(describeField).join("\n")}

Rules:
1. Every table cell showing a field must have data-field="<fieldName>". Example row:
   <tr><td data-field="${firstField}">...</td> ...${rowButtons.length ? ` <td>${rowButtons.join(" ")}</td>` : ""}</tr>
2. Include a form with one input per field. Each input must have name="<fieldName>" and data-field="<fieldName>".
   Input types: ${fields.map((f) => `${f.name} = ${INPUT_HINT[f.type]}`).join(", ")}.
3. Buttons and search:
${buttonRules.join("\n")}
4. Put the sample rows in a JavaScript array named exactly
   const ${contract.ui.sampleConst} = [ { ${sampleKeys} }, ... ];
   and render the table rows from that array.
`;
}
