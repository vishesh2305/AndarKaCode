// Step 13: the coding AI. A prompt -> the model's answer (text). Local Ollama or cloud Gemini, the same
// calls as the vision client (src/ai/vision.js), without an image or a JSON schema.
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
export const codeModelName = {
  local: process.env.OLLAMA_CODE_MODEL ?? "qwen2.5-coder:7b",
  cloud: process.env.GEMINI_CODE_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-3-flash-preview",
};
const TIMEOUT_MS = 180_000;

async function local(prompt, model = codeModelName.local) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      think: false,
      options: { temperature: 0.2, num_ctx: 8192 },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${data.error ?? JSON.stringify(data)}`);
  return data.message.content || data.message.thinking || "";
}

// Gemini often answers 503 "high demand" for a few seconds; retry those, fail fast on anything else.
const RETRY_DELAYS_MS = [2000, 5000, 10000];
const TRANSIENT = new Set([500, 502, 503, 504]);

async function cloud(prompt, model = codeModelName.cloud) {
  if (!GEMINI_API_KEY) throw new Error("The cloud coding model needs GEMINI_API_KEY");
  for (const delay of [...RETRY_DELAYS_MS, null]) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await res.json();
    if (res.ok) return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (delay === null || !TRANSIENT.has(res.status)) throw new Error(`Gemini ${res.status}: ${data.error?.message ?? JSON.stringify(data)}`);
    await new Promise((r) => setTimeout(r, delay));
  }
}

export const codeProviders = { local, cloud };
