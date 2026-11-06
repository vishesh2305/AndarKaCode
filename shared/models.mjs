// Step 31b: the models a workspace's slots may use with its own keys. frontend = reading screenshots and
// drawing pages (needs images); backend = writing custom button code. `verified` is the date a model passed
// our exams (npm run eval:pages and eval:custom in builder-api), or null while it is listed but not yet
// examined. Only models named here can be chosen: a model is added when it exists and can do the job.
export const MODELS = [
  { provider: "gemini", model: "gemini-3.5-flash", slots: ["frontend", "backend"], verified: "2026-11-01" }, // pages, and 5/5 custom code
  { provider: "anthropic", model: "claude-sonnet-5-5", slots: ["frontend", "backend"], verified: null },
  { provider: "anthropic", model: "claude-opus-5-5", slots: ["frontend", "backend"], verified: null },
  { provider: "anthropic", model: "claude-haiku-5-5", slots: ["frontend", "backend"], verified: null },
];

/** The listed model of this provider for this slot, or null. */
export const modelFor = (provider, model, slot) => MODELS.find((m) => m.provider === provider && m.model === model && m.slots.includes(slot)) ?? null;
