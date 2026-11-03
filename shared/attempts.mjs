// The models a page is tried on, in order (Step 18.6): the job's model, once more, then the other model.
// auto = local first, then cloud (or local again when no cloud key is set). Shared by Laptop B's Gateway
// and the ui-worker service (Step 26).
export function attemptPlan(mode, { hasCloud }) {
  if (mode === "auto") return hasCloud ? ["local", "cloud"] : ["local", "local"];
  if (mode === "cloud") return ["cloud", "cloud", "local"];
  return hasCloud ? ["local", "local", "cloud"] : ["local", "local"];
}
