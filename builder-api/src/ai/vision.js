// One image + a prompt + a JSON Schema -> the model's JSON text. Local Ollama or cloud Gemini.
// Same calls proven in Step 4 (spikes/contract-extractor) and the Step 9 contract extractor.

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
// The -instruct variant: the thinking variant returns structured output in `thinking` and leaves `content` empty.
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3-vl:8b-instruct";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3-flash-preview";
const TIMEOUT_MS = 180_000;

export const modelName = { local: OLLAMA_MODEL, cloud: GEMINI_MODEL };

async function local({ prompt, schema, imageB64 }) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: "user", content: prompt, images: [imageB64] }],
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

async function cloud({ prompt, schema, imageB64 }) {
  if (!GEMINI_API_KEY) throw new Error("Cloud mode needs GEMINI_API_KEY in builder-api/.env");
  for (const delay of [...GEMINI_RETRY_DELAYS_MS, null]) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: "image/png", data: imageB64 } }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", responseJsonSchema: schema },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await res.json();
    if (res.ok) return data.candidates[0].content.parts[0].text;
    if (delay === null || !GEMINI_TRANSIENT.has(res.status))
      throw new Error(`Gemini ${res.status}: ${data.error?.message ?? JSON.stringify(data)}`);
    await new Promise((r) => setTimeout(r, delay));
  }
}

export const visionProviders = { local, cloud };
