// Step 20: every Builder API setting, checked once at start-up. A wrong setting stops the start with a
// message naming the setting and the file; every problem is listed at once; a secret is never printed.
const FILE = "builder-api/.env";
const MODES = ["local", "cloud", "auto"];
const ROLES = ["all", "api", "orchestrator", "ui-worker"]; // Step 24: one process, or the services (ui-worker: Step 26)
const PAGE_LANES = ["gateway", "queue"];
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

  // Behind a container HOST is 0.0.0.0, which a browser can't open: PREVIEW_ORIGIN says where the browser
  // finds the live preview (Step 24). Without it, the address is worked out when the preview listens.
  const previewOrigin = has("PREVIEW_ORIGIN") ? env.PREVIEW_ORIGIN.replace(/\/$/, "") : null;
  if (previewOrigin && !/^https?:\/\//.test(previewOrigin)) problems.push(`PREVIEW_ORIGIN in ${FILE} must start with http:// or https:// (for example http://127.0.0.1:4001)`);

  const storage = has("STORAGE") ? env.STORAGE : "local";
  if (storage === "r2") problems.push(`STORAGE=r2 comes with the servers and Cloudflare (Step 46): use STORAGE=local for now`);
  else if (storage !== "local") problems.push(`STORAGE in ${FILE} must be local (it is "${storage}")`);

  wholeNumber("READ_PARALLEL", 6, { min: 1, max: 20 });
  wholeNumber("CUSTOM_PARALLEL", 3, { min: 1, max: 20 });
  wholeNumber("GATEWAY_POLL_MS", 2000, { min: 100 });
  wholeNumber("PREVIEW_IDLE_MS", 15 * 60_000, { min: 1000 });
  wholeNumber("LEASE_MS", 60_000, { min: 1000 }); // how long a project's lease lasts without renewal (Step 22)
  wholeNumber("PICKUP_MS", 20_000, { min: 100 }); // how often the orchestrator looks for new work (Step 24)
  wholeNumber("UI_PARALLEL", 4, { min: 1, max: 20 }); // pages one ui-worker draws at the same time (Step 26)
  const placementMs = wholeNumber("PLACEMENT_MS", 5, { min: 1, max: 1000 }); // a ui-worker warns past this round trip to MongoDB (Step 28)

  // Step 26: where pages are drawn. Laptop B's Gateway when it is set (development), else the page queue
  // for ui-worker services (production, no Laptop B).
  const pageLane = has("PAGE_LANE") ? env.PAGE_LANE : gateway ? "gateway" : "queue";
  if (!PAGE_LANES.includes(pageLane)) problems.push(`PAGE_LANE in ${FILE} must be one of ${PAGE_LANES.join(", ")} (it is "${pageLane}")`);
  else if (pageLane === "gateway" && !has("GATEWAY_URL")) problems.push(`PAGE_LANE=gateway needs GATEWAY_URL and GATEWAY_API_KEY in ${FILE} (or PAGE_LANE=queue with a ui-worker)`);

  const role = has("ROLE") ? env.ROLE : "all";
  if (!ROLES.includes(role)) problems.push(`ROLE in ${FILE} must be one of ${ROLES.join(", ")} (it is "${role}")`);

  // Step 29: sign-in. Off: this computer only, as before. On: GitHub and/or Google, invited accounts only.
  const authSetting = has("AUTH") ? env.AUTH : "off";
  if (!["on", "off"].includes(authSetting)) problems.push(`AUTH in ${FILE} must be on or off (it is "${authSetting}")`);
  const pair = (prefix) => {
    const [id, secret] = [`${prefix}_CLIENT_ID`, `${prefix}_CLIENT_SECRET`];
    if (has(id) !== has(secret)) problems.push(`${id} and ${secret} go together in ${FILE}: set both (from the provider's OAuth app) or neither`);
    return has(id) && has(secret) ? { clientId: env[id], clientSecret: env[secret] } : null;
  };
  const github = pair("GITHUB");
  const google = pair("GOOGLE");
  const publicUrl = has("PUBLIC_URL") ? env.PUBLIC_URL.replace(/\/$/, "") : null;
  if (publicUrl && !/^https?:\/\//.test(publicUrl)) problems.push(`PUBLIC_URL in ${FILE} must start with http:// or https:// (the address people open, for example https://andarkacode.com)`);
  const sessionDays = wholeNumber("SESSION_DAYS", 14, { min: 1, max: 90 });
  const authOn = authSetting === "on";
  if (authOn && !publicUrl) problems.push(`AUTH=on needs PUBLIC_URL in ${FILE}: the address people open (the providers send them back there)`);
  if (authOn && !github && !google) problems.push(`AUTH=on needs GitHub or Google sign-in in ${FILE}: GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, or GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET`);
  const auth = {
    on: authOn,
    publicUrl,
    sessionDays,
    secureCookie: Boolean(publicUrl?.startsWith("https://")),
    // The providers' addresses can change for GitHub Enterprise or another OpenID issuer (and for the tests).
    github: github && { ...github, url: (env.GITHUB_URL || "https://github.com").replace(/\/$/, ""), apiUrl: (env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "") },
    google: google && { ...google, issuer: (env.GOOGLE_ISSUER || "https://accounts.google.com").replace(/\/$/, "") },
  };

  // Step 31b: the secret the key vault encrypts users' AI keys with. Without it, nobody can save keys.
  const keyVaultSecret = has("KEY_VAULT_SECRET") ? env.KEY_VAULT_SECRET : null;
  if (keyVaultSecret && !/^[0-9a-f]{64}$/i.test(keyVaultSecret)) problems.push(`KEY_VAULT_SECRET in ${FILE} must be 64 hex characters (32 bytes): make one with: openssl rand -hex 32`);

  const config = { port, host: has("HOST") ? env.HOST : "127.0.0.1", previewPort, mongodbUri, defaultMode, gateway, storage, role, previewOrigin, pageLane, placementMs, auth, keyVaultSecret, modes: MODES };
  return { config, problems };
}

/** The settings, or one error listing every problem. */
export function loadConfig(env) {
  const { config, problems } = checkConfig(env);
  if (problems.length) throw new Error(`The Builder API can't start, fix these settings first:\n- ${problems.join("\n- ")}`);
  return config;
}
