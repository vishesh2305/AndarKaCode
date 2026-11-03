// The Builder API's entry point. Step 20: the settings are checked first, in milliseconds, before the
// app and its many modules are loaded, so a wrong setting stops the start at once with every problem listed.
import { loadConfig } from "./config.js";

try {
  loadConfig(process.env);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
await import("./app.js");
