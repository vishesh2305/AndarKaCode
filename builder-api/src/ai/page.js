// Step 18.2: the single-call page builder (docs/production-architecture.md §3.2). One screenshot + the
// page instructions -> one model call -> one HTML page: no agent steps, no Screenshot-to-Code. The same
// Ollama/Gemini calls as the vision client (src/ai/vision.js), asking for HTML instead of JSON.
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3-vl:8b-instruct";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
export const pageModelName = {
  local: OLLAMA_MODEL,
  cloud: process.env.GEMINI_PAGE_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-3-flash-preview",
};
const TIMEOUT_MS = 600_000; // a whole page from a local 8B model can take several minutes

/** The request: the same goals Screenshot-to-Code gives its model, plus our page instructions (markers). */
export function pagePrompt(instructions) {
  return `Build a web page that looks exactly like the screenshot.

- Use the exact text from the screenshot: headings, labels, column names, button text and sample rows.
- Match the layout, spacing, colours and font sizes as closely as you can.
- Write one single HTML file. Use Tailwind with this script: <script src="https://cdn.tailwindcss.com"></script>
- For images and icons, use simple inline SVG or a plain coloured box; never embed the screenshot itself.

${instructions}

Answer with only the complete HTML, from <!DOCTYPE html> to </html>, in one \`\`\`html block.`;
}

/** The page inside the model's answer; throws if there is none or it was cut off. */
export function extractHtml(answer) {
  const text = String(answer ?? "");
  const block = /```html\s*([\s\S]*?)```/i.exec(text)?.[1] ?? text;
  const start = block.search(/<!doctype html|<html[\s>]/i);
  if (start === -1) throw new Error("The model's answer has no HTML page");
  const end = block.toLowerCase().lastIndexOf("</html>");
  if (end === -1 || end < start) throw new Error("The page was cut off before </html> (the answer hit its length limit)");
  return block.slice(start, end + "</html>".length);
}

async function local({ prompt, imageB64 }) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: "user", content: prompt, images: [imageB64] }],
      stream: false,
      think: false,
      options: { temperature: 0.2, num_ctx: 16384 },
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

async function cloud({ prompt, imageB64 }) {
  if (!GEMINI_API_KEY) throw new Error("Cloud mode needs GEMINI_API_KEY in builder-api/.env");
  for (const delay of [...RETRY_DELAYS_MS, null]) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${pageModelName.cloud}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: "image/png", data: imageB64 } }] }],
        generationConfig: { temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await res.json();
    if (res.ok) return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (delay === null || !TRANSIENT.has(res.status)) throw new Error(`Gemini ${res.status}: ${data.error?.message ?? JSON.stringify(data)}`);
    await new Promise((r) => setTimeout(r, delay));
  }
}

export const pageProviders = { local, cloud };

/** One page: { html, provider }. auto = local first, then cloud if local fails or gives no page. */
export async function buildPage({ imageB64, instructions, mode, providers = pageProviders }) {
  const prompt = pagePrompt(instructions);
  let lastError;
  for (const provider of mode === "auto" ? ["local", "cloud"] : [mode]) {
    try {
      return { html: extractHtml(await providers[provider]({ prompt, imageB64 })), provider };
    } catch (err) {
      lastError = new Error(`${provider}: ${err.message}`);
    }
  }
  throw lastError;
}
