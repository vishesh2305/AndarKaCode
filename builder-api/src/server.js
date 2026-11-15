// The Builder API's entry point. Step 20: the settings are checked first, in milliseconds, before the
// app and its many modules are loaded, so a wrong setting stops the start at once with every problem listed.
import { loadConfig } from "./config.js";

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
// Step 33b: sign-in on, but generated apps still run as processes here: fine on this computer, not for others.
if (config.auth.on && config.sandbox.mode === "process") {
  console.warn("Warning: sign-in is on, but generated apps run as processes on this computer (SANDBOX=process). Before anyone else uses it, set SANDBOX=docker (Step 33).");
}
// Step 24: ROLE=orchestrator is the building service, ROLE=ui-worker draws pages (Step 26), ROLE=verifier runs
// generated apps (Step 33c); none has a UI. api and all (the default) serve the UI and API.
const entry = { orchestrator: "./worker.js", "ui-worker": "./ui-worker.js", verifier: "./verifier.js" }[config.role] ?? "./app.js";
await import(entry);
