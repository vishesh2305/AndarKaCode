// Step 13: the coding AI writes one custom button's code. Every answer goes through the safety check;
// only safe code is tried (pressed once in the real app, see tester.js). What went wrong goes back to the
// model as a repair request. A button whose code never passes keeps answering "not available yet".
import { findOperationMemory } from "../memory/index.js";
import { codeProviders } from "./model.js";
import { customPrompt, extractCode, repairPrompt } from "./prompt.js";
import { checkCustomCode } from "./safety.js";

const MAX_REPAIRS = 3; // per model, after its first answer

/** The custom buttons whose code was written, from a backend job's results ({ operation, ok }). */
export const writtenButtons = (backendJob) => (backendJob?.custom ?? []).filter((c) => c.ok).map((c) => c.operation);

/** Which coding AI is asked, from the project's mode. Auto: Gemini first (right more often), local as backup. */
export const providerOrder = (mode) => (mode === "auto" ? ["cloud", "local"] : [mode]);

/**
 * test(code) -> null when the button answers, else what went wrong (text). providers is injectable for tests.
 * Resolves with { ok, code?, provider?, answers, problem?, unavailable }.
 */
export async function writeCustomCode({
  spec,
  op,
  mode,
  test,
  providers = codeProviders,
  maxRepairs = MAX_REPAIRS,
  findOperation = findOperationMemory,
}) {
  // Pattern Library (Level 4 Memory): check if verified code already exists for this operation
  try {
    const mem = await findOperation(op.entity, op.name);
    if (mem?.payload?.code) {
      const code = mem.payload.code;
      const safety = checkCustomCode(code);
      if (safety.ok) {
        const problem = await test(code);
        if (!problem) {
          return { ok: true, code, provider: "memory", answers: 0, unavailable: [] };
        }
        console.log(`[memory] Verified code for ${op.entity}:${op.name} failed tests: ${problem}. Falling back to AI models.`);
      } else {
        console.log(`[memory] Verified code for ${op.entity}:${op.name} failed safety check: ${safety.problems.join("; ")}. Falling back to AI models.`);
      }
    }
  } catch (err) {
    console.warn(`[memory] Lookup failed for ${op.entity}:${op.name}:`, err.message);
  }

  let answers = 0;
  let problem = null;
  const unavailable = []; // models that did not answer, and why
  for (const provider of providerOrder(mode)) {
    let code = null;
    for (let attempt = 0; attempt <= maxRepairs; attempt++) {
      let answer;
      try {
        answer = await providers[provider](attempt === 0 ? customPrompt(spec, op) : repairPrompt(spec, op, code ?? "(no code)", problem));
      } catch (err) {
        unavailable.push(`${provider}: ${err.message}`);
        break;
      }
      answers++;
      code = extractCode(answer);
      const safety = code ? checkCustomCode(code) : { ok: false, problems: ["the answer had no code"] };
      problem = !safety.ok ? (code ? `the safety check refused it: ${safety.problems.join("; ")}` : "the answer had no code") : await test(code);
      if (!problem) return { ok: true, code, provider, answers, unavailable };
    }
  }
  return { ok: false, answers, problem: problem ?? `no coding AI answered: ${unavailable.join("; ")}`, unavailable };
}
