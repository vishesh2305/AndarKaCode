// Step 25: the meter. Every model call records what it was for (read, page, code), the provider, the model,
// its tokens (thinking apart) and its seconds, on the piece of work it belongs to: a Builder API job, or a
// Gateway job on Laptop B, whose usage goes back with its page. The cost per build comes from these.
// Shared by the Builder API and the Gateway. Uses AsyncLocalStorage, so the model calls keep their shapes.
import { AsyncLocalStorage } from "node:async_hooks";

const current = new AsyncLocalStorage();

/** Runs work(); every recordUsage() inside it (however deep, however parallel) is added to `list`. */
export const withUsage = (list, work) => current.run(list, work);

/** One model call's usage; ignored outside withUsage (e.g. the page exam, a test). */
export function recordUsage(entry) {
  current.getStore()?.push(entry);
}

const count = (n) => (Number.isFinite(n) ? n : 0);

/** Tokens out of an Ollama /api/chat answer. */
export const ollamaUsage = (data) => ({ inputTokens: count(data?.prompt_eval_count), outputTokens: count(data?.eval_count), thinkingTokens: 0 });

/** Tokens out of a Gemini generateContent answer (thinking tokens are billed like output, so kept apart). */
export function geminiUsage(data) {
  const u = data?.usageMetadata ?? {};
  return { inputTokens: count(u.promptTokenCount), outputTokens: count(u.candidatesTokenCount), thinkingTokens: count(u.thoughtsTokenCount) };
}

/** Seconds since `started` (Date.now()), to one decimal. */
export const secondsSince = (started) => Math.round((Date.now() - started) / 100) / 10;
