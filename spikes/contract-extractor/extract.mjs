// Step 4 spike: screenshot -> Contract JSON.
// Usage:  node extract.mjs <image.png>           (local Ollama)
//         node extract.mjs <image.png> --cloud   (Gemini backup, needs GEMINI_API_KEY)
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contractHash } from "../../shared/hash.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(
  await readFile(path.join(here, "../../shared/contract.schema.json"), "utf8")
);
delete schema.$comment;

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
// The -instruct variant: the thinking variant returns structured output in `thinking` and leaves `content` empty.
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3-vl:8b-instruct";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3-flash-preview";
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 180_000);

const PROMPT = `You are reading a screenshot of a data-management web page (a table, a form, buttons).
Describe its data model as JSON.

- resource.name: singular camelCase English noun (e.g. "employee"). resource.plural: its plural. resource.label: the page title as shown.
- fields: one per table column or form input, in the order shown. Skip row numbers, IDs and action columns (Edit/Delete).
  - name: camelCase English (e.g. "Full Name" -> "fullName").
  - label: the text exactly as shown.
  - type: "email" for email addresses, "number" for numeric values, "date" for dates, "boolean" for yes/no or checkboxes,
    "enum" when values come from a small fixed set (list them all in "options"), otherwise "string".
  - required: true for fields that identify a record (like a name or email).
- actions: always "list". Add "create" if there is an Add/New button, "update" if Edit, "delete" if Delete, "search" if a search box.
- rules: {"delete": "soft", "auth": "none"}.
- openQuestions: up to 3 short questions the screenshot cannot answer (e.g. who may delete, extra validation).`;

async function callOllama(imageB64, think) {
  const body = {
    model: OLLAMA_MODEL,
    messages: [{ role: "user", content: PROMPT, images: [imageB64] }],
    format: schema,
    stream: false,
    options: { temperature: 0, num_ctx: 8192 },
  };
  if (think !== undefined) body.think = think;

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) {
    // Models without a thinking mode reject the "think" field; retry without it.
    if (think !== undefined && /think/i.test(data.error ?? "")) return callOllama(imageB64, undefined);
    throw new Error(`Ollama ${res.status}: ${data.error ?? JSON.stringify(data)}`);
  }
  return data.message.content || data.message.thinking;
}

// Gemini often answers 503 "high demand" for a few seconds; retry those, fail fast on anything else.
const GEMINI_RETRY_DELAYS_MS = [2000, 5000, 10000];
const GEMINI_TRANSIENT = new Set([500, 502, 503, 504]);

async function callGemini(imageB64, mimeType) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Set GEMINI_API_KEY to use --cloud");
  for (const delay of [...GEMINI_RETRY_DELAYS_MS, null]) {
    try {
      return await callGeminiOnce(imageB64, mimeType, key);
    } catch (err) {
      if (delay === null || !GEMINI_TRANSIENT.has(err.status)) throw err;
      console.log(`Gemini ${err.status}, retrying in ${delay / 1000} s`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

async function callGeminiOnce(imageB64, mimeType, key) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: imageB64 } }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", responseJsonSchema: schema },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(`Gemini ${res.status}: ${data.error?.message ?? JSON.stringify(data)}`);
    err.status = res.status;
    throw err;
  }
  return data.candidates[0].content.parts[0].text;
}

// The model output is schema-shaped already; these are the rules a JSON Schema can't express.
function checkContract(c) {
  const problems = [];
  const camel = /^[a-z][a-zA-Z0-9]*$/;
  if (!camel.test(c.resource.name)) problems.push(`resource.name "${c.resource.name}" is not camelCase`);
  const seen = new Set();
  for (const f of c.fields) {
    if (!camel.test(f.name)) problems.push(`field "${f.name}" is not camelCase`);
    if (seen.has(f.name)) problems.push(`field "${f.name}" appears twice`);
    seen.add(f.name);
    if (f.type === "enum" && !(f.options?.length > 0)) problems.push(`enum field "${f.name}" has no options`);
  }
  if (!c.actions.includes("list")) problems.push(`actions is missing "list"`);
  return problems;
}

const [imagePath, flag] = process.argv.slice(2);
if (!imagePath) {
  console.error("Usage: node extract.mjs <image.png> [--cloud]");
  process.exit(1);
}
const cloud = flag === "--cloud";
const imageB64 = (await readFile(imagePath)).toString("base64");
const mimeType = imagePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";

const started = Date.now();
const raw = cloud ? await callGemini(imageB64, mimeType) : await callOllama(imageB64, false);
const seconds = ((Date.now() - started) / 1000).toFixed(1);

const body = JSON.parse(raw);
body.actions = [...new Set(body.actions)];
body.ui = { sampleConst: `SAMPLE_${body.resource.plural.toUpperCase()}` };
const contract = { version: 1, ...body };
const problems = checkContract(contract);

const outPath = imagePath.replace(/\.(png|jpe?g)$/i, `.contract.${cloud ? "cloud" : "local"}.json`);
await writeFile(outPath, JSON.stringify(contract, null, 2) + "\n");

console.log(`Provider: ${cloud ? `cloud (${GEMINI_MODEL})` : `local (${OLLAMA_MODEL})`}`);
console.log(`Time:     ${seconds} s`);
console.log(`Fields:   ${contract.fields.map((f) => `${f.name}:${f.type}`).join(", ")}`);
console.log(`Actions:  ${contract.actions.join(", ")}`);
console.log(`Hash:     ${contractHash(contract).slice(0, 12)}…`);
console.log(`Saved:    ${outPath}`);
console.log(problems.length ? `PROBLEMS:\n - ${problems.join("\n - ")}` : "Checks:   all passed");
process.exit(problems.length ? 2 : 0);
