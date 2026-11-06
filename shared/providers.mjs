// Step 31a: the AI providers a user can bring a key for (BYOK). One call for every purpose, in each
// provider's own request shape: read a screenshot (image + JSON), draw a page (image + HTML), write code
// (text). Usage is recorded like every model call (Step 25), a busy provider is tried again, and the key
// never reaches an error message, even when the provider repeats it back.
// Each address can be changed with <PROVIDER>_BASE_URL (a proxy, a regional endpoint, the tests).
import { geminiUsage, recordUsage, secondsSince } from "./meter.mjs";

export const PROVIDERS = ["gemini", "openai", "anthropic", "groq", "openrouter"];
const LABELS = { gemini: "Gemini", openai: "OpenAI", anthropic: "Anthropic", groq: "Groq", openrouter: "OpenRouter" };
const BASE_URLS = {
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
};
const baseUrl = (provider) => (process.env[`${provider.toUpperCase()}_BASE_URL`] || BASE_URLS[provider]).replace(/\/$/, "");

const TIMEOUT_MS = 600_000; // a whole page can take minutes
const ANTHROPIC_MAX_TOKENS = 16_000; // Anthropic needs a limit; a page is well under it
const TRANSIENT = new Set([429, 500, 502, 503, 504]);
export const retry = { delays: [2000, 5000, 10000] }; // the tests make these short

// Keys as providers write them (OpenAI sk-, Anthropic sk-ant-, Groq gsk_, OpenRouter sk-or-, Google AIza),
// including the shortened "sk-abc...wxyz" form some providers echo back.
const KEY_LIKE = /\b(?:sk-[A-Za-z0-9_-]{6,}|gsk_[A-Za-z0-9]{6,}|AIza[0-9A-Za-z_-]{20,})(?:\.\.\.[A-Za-z0-9]{2,})?/g;

/** The message with the key, and anything that looks like a key, hidden. */
export function redactKey(message, apiKey) {
  let text = String(message ?? "");
  if (apiKey) text = text.split(apiKey).join("[key hidden]");
  return text.replace(KEY_LIKE, "[key hidden]");
}

const ofUsage = (inputTokens, outputTokens, thinkingTokens = 0) => ({
  inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
  outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
  thinkingTokens: Number.isFinite(thinkingTokens) ? thinkingTokens : 0,
});

// Each provider: the request for a prompt (with an image, asking for JSON), and how to read the answer.
const ADAPTERS = {
  gemini: {
    request: ({ apiKey, model, prompt, imageB64, json, schema, temperature }) => ({
      url: `${baseUrl("gemini")}/models/${model}:generateContent`,
      headers: { "x-goog-api-key": apiKey },
      body: {
        contents: [{ parts: [{ text: prompt }, ...(imageB64 ? [{ inline_data: { mime_type: "image/png", data: imageB64 } }] : [])] }],
        generationConfig: { temperature, ...(json && { responseMimeType: "application/json", ...(schema && { responseJsonSchema: schema }) }) },
      },
    }),
    text: (data) => data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "",
    usage: (data) => geminiUsage(data),
    check: (apiKey) => ({ url: `${baseUrl("gemini")}/models`, headers: { "x-goog-api-key": apiKey } }),
  },
  anthropic: {
    request: ({ apiKey, model, prompt, imageB64, temperature }) => ({
      url: `${baseUrl("anthropic")}/messages`,
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: {
        model,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        temperature,
        messages: [
          {
            role: "user",
            content: [...(imageB64 ? [{ type: "image", source: { type: "base64", media_type: "image/png", data: imageB64 } }] : []), { type: "text", text: prompt }],
          },
        ],
      },
    }),
    text: (data) => (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join(""),
    usage: (data) => ofUsage(data.usage?.input_tokens, data.usage?.output_tokens),
    check: (apiKey) => ({ url: `${baseUrl("anthropic")}/models`, headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } }),
  },
};

// OpenAI's chat completions, which Groq and OpenRouter speak too. No temperature: some OpenAI models refuse one.
const openaiStyle = (provider, checkPath = "/models") => ({
  request: ({ apiKey, model, prompt, imageB64, json }) => ({
    url: `${baseUrl(provider)}/chat/completions`,
    headers: { Authorization: `Bearer ${apiKey}` },
    body: {
      model,
      messages: [{ role: "user", content: imageB64 ? [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:image/png;base64,${imageB64}` } }] : prompt }],
      ...(json && { response_format: { type: "json_object" } }),
    },
  }),
  text: (data) => data.choices?.[0]?.message?.content ?? "",
  usage: (data) => ofUsage(data.usage?.prompt_tokens, data.usage?.completion_tokens, data.usage?.completion_tokens_details?.reasoning_tokens),
  check: (apiKey) => ({ url: `${baseUrl(provider)}${checkPath}`, headers: { Authorization: `Bearer ${apiKey}` } }),
});
ADAPTERS.openai = openaiStyle("openai");
ADAPTERS.groq = openaiStyle("groq");
ADAPTERS.openrouter = openaiStyle("openrouter", "/key"); // its model list needs no key; /key does

const errorOf = (data, status) => data?.error?.message ?? (typeof data?.error === "string" ? data.error : null) ?? data?.message ?? `HTTP ${status}`;

// A model without a JSON mode (Anthropic) may wrap its JSON in prose or a code fence.
function jsonOnly(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const body = fenced ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start !== -1 && end > start ? body.slice(start, end + 1) : body.trim();
}

/**
 * One model call with a user's key: the answer's text (JSON text when json is true).
 * purpose: "read" | "page" | "code", for the meter.
 */
export async function callModel({ provider, apiKey, model, prompt, imageB64 = null, json = false, schema = null, temperature = 0.2, purpose }) {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`Unknown provider "${provider}" (one of ${PROVIDERS.join(", ")})`);
  if (!apiKey) throw new Error(`${LABELS[provider]} needs a key`);
  const { url, headers, body } = adapter.request({ apiKey, model, prompt, imageB64, json, schema, temperature });
  for (const delay of [...retry.delays, null]) {
    const started = Date.now();
    let res;
    let data;
    try {
      res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
      data = await res.json().catch(() => ({}));
    } catch (err) {
      throw new Error(redactKey(`${LABELS[provider]}: ${err.message}`, apiKey));
    }
    if (res.ok) {
      recordUsage({ purpose, provider, model, ...adapter.usage(data), seconds: secondsSince(started) });
      const text = adapter.text(data);
      return json && provider === "anthropic" ? jsonOnly(text) : text;
    }
    if (delay === null || !TRANSIENT.has(res.status)) throw new Error(redactKey(`${LABELS[provider]} ${res.status}: ${errorOf(data, res.status)}`, apiKey));
    await new Promise((r) => setTimeout(r, delay));
  }
}

/** Is this key good? One cheap request that needs it: { ok: true } or { ok: false, reason }. */
export async function checkKey({ provider, apiKey }) {
  const adapter = ADAPTERS[provider];
  if (!adapter) return { ok: false, reason: `Unknown provider "${provider}"` };
  if (!apiKey) return { ok: false, reason: "No key given" };
  const { url, headers } = adapter.check(apiKey);
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => ({}));
    return { ok: false, reason: redactKey(`${LABELS[provider]} ${res.status}: ${errorOf(data, res.status)}`, apiKey) };
  } catch (err) {
    return { ok: false, reason: redactKey(`${LABELS[provider]}: ${err.message}`, apiKey) };
  }
}
