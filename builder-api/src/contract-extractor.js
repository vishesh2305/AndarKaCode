// Screenshot -> Contract body (ARCHITECTURE.md §4). Proven in spikes/contract-extractor (Step 4).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./storage.js";

const schema = JSON.parse(await readFile(path.join(REPO_ROOT, "shared/contract.schema.json"), "utf8"));
delete schema.$comment;

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
// The -instruct variant: the thinking variant returns structured output in `thinking` and leaves `content` empty.
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3-vl:8b-instruct";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3-flash-preview";
const TIMEOUT_MS = 180_000;

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

async function callOllama(imageB64) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: "user", content: PROMPT, images: [imageB64] }],
      format: schema,
      stream: false,
      think: false,
      options: { temperature: 0, num_ctx: 8192 },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${data.error ?? JSON.stringify(data)}`);
  return data.message.content || data.message.thinking;
}

// Gemini often answers 503 "high demand" for a few seconds; retry those, fail fast on anything else.
const GEMINI_RETRY_DELAYS_MS = [2000, 5000, 10000];
const GEMINI_TRANSIENT = new Set([500, 502, 503, 504]);

async function callGemini(imageB64) {
  if (!GEMINI_API_KEY) throw new Error("Cloud mode needs GEMINI_API_KEY in builder-api/.env");
  for (const delay of [...GEMINI_RETRY_DELAYS_MS, null]) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: "image/png", data: imageB64 } }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json", responseJsonSchema: schema },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    );
    const data = await res.json();
    if (res.ok) return data.candidates[0].content.parts[0].text;
    if (delay === null || !GEMINI_TRANSIENT.has(res.status))
      throw new Error(`Gemini ${res.status}: ${data.error?.message ?? JSON.stringify(data)}`);
    await new Promise((r) => setTimeout(r, delay));
  }
}

// The model output is schema-shaped already; these are the rules a JSON Schema can't express.
export function checkContract(body) {
  const problems = [];
  const camel = /^[a-z][a-zA-Z0-9]*$/;
  const TYPES = ["string", "email", "number", "boolean", "date", "enum"];
  const ACTIONS = ["list", "create", "update", "delete", "search"];
  for (const key of ["name", "plural", "label"])
    if (typeof body.resource?.[key] !== "string" || !body.resource[key]) problems.push(`resource.${key} is missing`);
  if (!camel.test(body.resource?.plural ?? "")) problems.push(`resource.plural "${body.resource?.plural}" is not camelCase`);
  if (!camel.test(body.resource?.name ?? "")) problems.push(`resource.name "${body.resource?.name}" is not camelCase`);
  const seen = new Set();
  for (const f of body.fields ?? []) {
    if (!camel.test(f.name)) problems.push(`field "${f.name}" is not camelCase`);
    if (seen.has(f.name)) problems.push(`field "${f.name}" appears twice`);
    seen.add(f.name);
    if (!TYPES.includes(f.type)) problems.push(`field "${f.name}" has unknown type "${f.type}"`);
    if (typeof f.label !== "string" || !f.label) problems.push(`field "${f.name}" has no label`);
    if (f.type === "enum" && !(f.options?.length > 0)) problems.push(`enum field "${f.name}" has no options`);
  }
  for (const a of body.actions ?? []) if (!ACTIONS.includes(a)) problems.push(`unknown action "${a}"`);
  if (!(body.fields?.length > 0)) problems.push("no fields found");
  if (!body.actions?.includes("list")) problems.push(`actions is missing "list"`);
  return problems;
}

const callProvider = { local: callOllama, cloud: callGemini };

/**
 * mode: "local" | "cloud" | "auto" (local first, then cloud if a key is set).
 * Resolves with { body, provider, model }; rejects with the last error if every provider failed.
 */
export async function extractContract(imagePath, mode) {
  const imageB64 = (await readFile(path.join(REPO_ROOT, imagePath))).toString("base64");
  const providers = mode === "auto" ? ["local", ...(GEMINI_API_KEY ? ["cloud"] : [])] : [mode];

  let lastError;
  for (const provider of providers) {
    try {
      const body = JSON.parse(await callProvider[provider](imageB64));
      body.actions = [...new Set(body.actions)];
      body.ui = { sampleConst: `SAMPLE_${body.resource.plural.toUpperCase()}` };
      const problems = checkContract(body);
      if (problems.length) throw new Error(`Contract problems: ${problems.join("; ")}`);
      return { body, provider, model: provider === "local" ? OLLAMA_MODEL : GEMINI_MODEL };
    } catch (err) {
      lastError = new Error(`${provider}: ${err.message}`);
    }
  }
  throw lastError;
}
