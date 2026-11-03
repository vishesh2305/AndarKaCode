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
// Step 24: ROLE=orchestrator is the building service (no UI); api and all (the default) serve the UI and API.
await import(config.role === "orchestrator" ? "./worker.js" : "./app.js");
