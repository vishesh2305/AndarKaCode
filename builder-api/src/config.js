// Step 20: every Builder API setting, checked once at start-up. A wrong setting stops the start with a
// message naming the setting and the file; every problem is listed at once; a secret is never printed.
const FILE = "builder-api/.env";
const MODES = ["local", "cloud", "auto"];
const MIN_GATEWAY_KEY = 16; // what the Gateway itself accepts (gateway/src/server.js)

/** { config, problems }: the settings read from env, and what is wrong with them (plain sentences). */
export function checkConfig(env) {
  const problems = [];
  const has = (name) => env[name] !== undefined && env[name] !== "";

  const wholeNumber = (name, fallback, { min, max }) => {
    if (!has(name)) return fallback;
    const n = Number(env[name]);
    if (Number.isInteger(n) && n >= min && (max === undefined || n <= max)) return n;
    const range = max === undefined ? `a whole number of at least ${min}` : `a whole number from ${min} to ${max}`;
    problems.push(`${name} in ${FILE} must be ${range} (it is "${env[name]}")`);
    return fallback;
  };

  const port = wholeNumber("PORT", 4000, { min: 1, max: 65535 });
  const previewPort = wholeNumber("PREVIEW_PORT", port + 1, { min: 0, max: 65535 }); // 0 = any free port
  if (has("PREVIEW_PORT") && previewPort === port) problems.push(`PREVIEW_PORT in ${FILE} must be different from PORT (both are ${port})`);

  const mongodbUri = has("MONGODB_URI") ? env.MONGODB_URI : "mongodb://127.0.0.1:27017/builder_db";
  if (!/^mongodb(\+srv)?:\/\//.test(mongodbUri)) problems.push(`MONGODB_URI in ${FILE} must start with mongodb:// or mongodb+srv://`);

  const defaultMode = has("DEFAULT_MODE") ? env.DEFAULT_MODE : "local";
  if (!MODES.includes(defaultMode)) problems.push(`DEFAULT_MODE in ${FILE} must be one of ${MODES.join(", ")} (it is "${defaultMode}")`);
  else if (defaultMode === "cloud" && !has("GEMINI_API_KEY")) problems.push(`DEFAULT_MODE=cloud needs GEMINI_API_KEY in ${FILE}`);

  let gateway = null;
  if (has("GATEWAY_URL") !== has("GATEWAY_API_KEY")) {
    problems.push(`GATEWAY_URL and GATEWAY_API_KEY go together in ${FILE}: set both (to use Laptop B) or neither`);
  } else if (has("GATEWAY_URL")) {
    if (!/^https?:\/\//.test(env.GATEWAY_URL)) problems.push(`GATEWAY_URL in ${FILE} must start with http:// or https:// (for example http://100.x.y.z:8787)`);
    if (env.GATEWAY_API_KEY.length < MIN_GATEWAY_KEY) problems.push(`GATEWAY_API_KEY in ${FILE} must be at least ${MIN_GATEWAY_KEY} characters, like the one in gateway/.env`);
    gateway = { url: env.GATEWAY_URL, apiKey: env.GATEWAY_API_KEY };
  }

  const storage = has("STORAGE") ? env.STORAGE : "local";
  if (storage === "r2") problems.push(`STORAGE=r2 comes with the servers and Cloudflare (Step 46): use STORAGE=local for now`);
  else if (storage !== "local") problems.push(`STORAGE in ${FILE} must be local (it is "${storage}")`);

  wholeNumber("READ_PARALLEL", 6, { min: 1, max: 20 });
  wholeNumber("CUSTOM_PARALLEL", 3, { min: 1, max: 20 });
  wholeNumber("GATEWAY_POLL_MS", 2000, { min: 100 });
  wholeNumber("PREVIEW_IDLE_MS", 15 * 60_000, { min: 1000 });
  wholeNumber("LEASE_MS", 60_000, { min: 1000 }); // how long a project's lease lasts without renewal (Step 22)

  const config = { port, host: has("HOST") ? env.HOST : "127.0.0.1", previewPort, mongodbUri, defaultMode, gateway, storage, modes: MODES };
  return { config, problems };
}

/** The settings, or one error listing every problem. */
export function loadConfig(env) {
  const { config, problems } = checkConfig(env);
  if (problems.length) throw new Error(`The Builder API can't start, fix these settings first:\n- ${problems.join("\n- ")}`);
  return config;
}
