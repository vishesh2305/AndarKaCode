// Step 13: the safety check for AI-written button code, before it is ever run (ARCHITECTURE.md §7).
// The code is read as a structure with acorn, never run here. It must be exactly
//   export default async function ({ record, input, helpers }) { ... }
// using only its helpers: no imports, no process or globals, no code made from strings, no prototype
// tricks, no timers or network, and no loops that can run forever (for ... of over a list is fine).
// Screenshot text reaches the AI, so it could try to steer it: this check doesn't trust the code.
import { parse } from "acorn";

const MAX_LENGTH = 8000;

const NAMES = new Set([
  "require", "module", "exports", "process", "global", "globalThis", "window", "self", "eval", "Function",
  "Reflect", "Proxy", "WebAssembly", "SharedArrayBuffer", "Atomics", "Worker", "setTimeout", "setInterval",
  "setImmediate", "queueMicrotask", "fetch", "XMLHttpRequest", "WebSocket", "Buffer", "arguments",
]);
const PROPERTIES = new Set([
  "constructor", "__proto__", "prototype", "caller", "callee", "getPrototypeOf", "setPrototypeOf",
  "defineProperty", "defineProperties", "getOwnPropertyDescriptor", "getOwnPropertyDescriptors",
  "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__",
]);
const NODES = {
  ImportDeclaration: "an import is not allowed (custom code gets everything it needs from its helpers)",
  ImportExpression: "import(...) is not allowed (custom code gets everything it needs from its helpers)",
  ExportNamedDeclaration: "only one export: export default async function",
  ExportAllDeclaration: "only one export: export default async function",
  WhileStatement: "a while loop is not allowed (use for ... of over a list)",
  DoWhileStatement: "a do ... while loop is not allowed (use for ... of over a list)",
  ForStatement: "a for (;;) loop is not allowed (use for ... of over a list)",
  ForInStatement: "for ... in is not allowed (use for ... of over a list)",
  WithStatement: '"with" is not allowed',
  LabeledStatement: "labels are not allowed",
  ThisExpression: '"this" is not allowed',
  MetaProperty: "import.meta and new.target are not allowed",
  ClassDeclaration: "classes are not allowed",
  ClassExpression: "classes are not allowed",
  Super: '"super" is not allowed',
  TaggedTemplateExpression: "tagged templates are not allowed",
  DebuggerStatement: '"debugger" is not allowed',
};
const SHAPE = "the code must be only one thing: export default async function ({ record, input, helpers }) { ... }";

function walk(node, visit, parent = null, key = null) {
  visit(node, parent, key);
  for (const [childKey, value] of Object.entries(node)) {
    if (childKey === "loc") continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child.type === "string") walk(child, visit, node, childKey);
    }
  }
}

// An identifier used as a property name (record.salary, { salary: 1 }) rather than a variable.
const isPropertyName = (parent, key) =>
  (parent?.type === "MemberExpression" && key === "property" && !parent.computed) ||
  ((parent?.type === "Property" || parent?.type === "MethodDefinition" || parent?.type === "PropertyDefinition") && key === "key" && !parent.computed);

/** { ok, problems: ["line 2: \"process\" is not allowed ..."] } */
export function checkCustomCode(source) {
  const code = String(source ?? "");
  if (code.length > MAX_LENGTH) return { ok: false, problems: [`the code is too long (${code.length} characters; the limit is ${MAX_LENGTH})`] };

  let program;
  try {
    program = parse(code, { ecmaVersion: "latest", sourceType: "module", locations: true });
  } catch (err) {
    const where = err.loc ? ` (line ${err.loc.line}, column ${err.loc.column + 1})` : "";
    return { ok: false, problems: [`the code could not be read: ${err.message.replace(/\s*\(\d+:\d+\)$/, "")}${where}`] };
  }

  const problems = [];
  const at = (node, message) => problems.push(`line ${node.loc.start.line}: ${message}`);

  const [first] = program.body;
  const fn = first?.type === "ExportDefaultDeclaration" ? first.declaration : null;
  if (program.body.length !== 1 || !fn || !/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(fn.type)) {
    problems.push(SHAPE);
  } else if (!fn.async) {
    at(fn, "the function must be async (export default async function ...)");
  }

  walk(program, (node, parent, key) => {
    if (NODES[node.type]) at(node, NODES[node.type]);
    if ((node.type === "FunctionDeclaration" || node.type === "FunctionExpression") && node.generator) at(node, "generator functions are not allowed");
    if (node.type === "Identifier") {
      if (isPropertyName(parent, key)) {
        if (PROPERTIES.has(node.name)) at(node, `"${node.name}" is not allowed`);
      } else if (NAMES.has(node.name)) {
        at(node, `"${node.name}" is not allowed (custom code may only use its helpers)`);
      }
    }
    if ((node.type === "MemberExpression" && node.computed) || (node.type === "Property" && node.computed)) {
      const keyNode = node.type === "MemberExpression" ? node.property : node.key;
      if (keyNode.type === "Literal" && typeof keyNode.value === "string") {
        if (PROPERTIES.has(keyNode.value)) at(keyNode, `"${keyNode.value}" is not allowed`);
      } else if (!(keyNode.type === "Literal" && typeof keyNode.value === "number")) {
        at(keyNode, "use dot notation (record.salary), not record[name]");
      }
    }
    if (node.type === "Literal" && typeof node.value === "string" && parent?.type === "Property" && key === "key" && PROPERTIES.has(node.value)) {
      at(node, `"${node.value}" is not allowed`);
    }
  });

  const unique = [...new Set(problems)];
  return { ok: unique.length === 0, problems: unique };
}
