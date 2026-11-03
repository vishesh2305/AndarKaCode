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
// Step 24: ROLE=orchestrator is the building service, ROLE=ui-worker draws pages (Step 26); neither has a UI.
// api and all (the default) serve the UI and API.
const entry = { orchestrator: "./worker.js", "ui-worker": "./ui-worker.js" }[config.role] ?? "./app.js";
await import(entry);
