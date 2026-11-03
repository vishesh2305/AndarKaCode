// Step 20: every setting is checked once, at start-up. A wrong setting stops the Builder API with a clear
// message naming the setting and the file, instead of a silent fallback or a confusing error later.
// Every problem is listed at once, and a secret is never printed.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { checkConfig, loadConfig } from "../src/config.js";

const KEY = "k".repeat(24);
const problemsOf = (env) => checkConfig(env).problems;

describe("checkConfig: the defaults", () => {
  it("runs on this computer only, with a local database, local models and no Gateway", () => {
    const { config, problems } = checkConfig({});
    assert.deepEqual(problems, []);
    assert.equal(config.port, 4000);
    assert.equal(config.host, "127.0.0.1");
    assert.equal(config.previewPort, 4001, "PORT + 1");
    assert.equal(config.mongodbUri, "mongodb://127.0.0.1:27017/builder_db");
    assert.equal(config.defaultMode, "local");
    assert.equal(config.gateway, null);
  });

  it("takes a full, valid set of settings", () => {
    const { config, problems } = checkConfig({
      PORT: "5000",
      PREVIEW_PORT: "5100",
      HOST: "0.0.0.0",
      MONGODB_URI: "mongodb+srv://cluster0.example.net/builder",
      GATEWAY_URL: "http://100.125.27.97:8787",
      GATEWAY_API_KEY: KEY,
      DEFAULT_MODE: "cloud",
      GEMINI_API_KEY: "g-key",
      READ_PARALLEL: "4",
      CUSTOM_PARALLEL: "2",
    });
    assert.deepEqual(problems, []);
    assert.equal(config.port, 5000);
    assert.equal(config.previewPort, 5100);
    assert.deepEqual(config.gateway, { url: "http://100.125.27.97:8787", apiKey: KEY });
    assert.equal(config.defaultMode, "cloud");
  });
});

describe("checkConfig: what is refused", () => {
  it("a port that is not a whole number from 1 to 65535, naming the setting, the file and the value", () => {
    for (const bad of ["abc", "0", "70000", "40.5"]) {
      const [problem] = problemsOf({ PORT: bad });
      assert.match(problem, /PORT in builder-api\/\.env must be a whole number from 1 to 65535/, bad);
      assert.ok(problem.includes(`"${bad}"`), problem);
    }
  });

  it("allows PREVIEW_PORT=0: any free port (the integration tests use it)", () => {
    const { config, problems } = checkConfig({ PREVIEW_PORT: "0" });
    assert.deepEqual(problems, []);
    assert.equal(config.previewPort, 0);
  });

  it("the live preview on the same port as the Builder API", () => {
    assert.match(problemsOf({ PORT: "4000", PREVIEW_PORT: "4000" })[0], /PREVIEW_PORT.*different from PORT/);
  });

  it("an unknown default mode (it used to become local without a word)", () => {
    assert.match(problemsOf({ DEFAULT_MODE: "clod" })[0], /DEFAULT_MODE.*local, cloud, auto.*"clod"/);
  });

  it("cloud as the default mode without a Gemini key", () => {
    assert.match(problemsOf({ DEFAULT_MODE: "cloud" })[0], /DEFAULT_MODE=cloud needs GEMINI_API_KEY/);
  });

  it("a Gateway address without its key, or a key without an address", () => {
    assert.match(problemsOf({ GATEWAY_URL: "http://x:8787" })[0], /GATEWAY_URL and GATEWAY_API_KEY go together/);
    assert.match(problemsOf({ GATEWAY_API_KEY: KEY })[0], /GATEWAY_URL and GATEWAY_API_KEY go together/);
  });

  it("a Gateway address that is not http(s), and a key shorter than the Gateway accepts", () => {
    assert.match(problemsOf({ GATEWAY_URL: "100.125.27.97:8787", GATEWAY_API_KEY: KEY })[0], /GATEWAY_URL in builder-api\/\.env must start with http:\/\/ or https:\/\//);
    assert.match(problemsOf({ GATEWAY_URL: "http://x:8787", GATEWAY_API_KEY: "short" })[0], /GATEWAY_API_KEY in builder-api\/\.env must be at least 16 characters/);
  });

  it("a database address that is not a MongoDB address", () => {
    assert.match(problemsOf({ MONGODB_URI: "postgres://localhost/db" })[0], /MONGODB_URI in builder-api\/\.env must start with mongodb:\/\/ or mongodb\+srv:\/\//);
  });

  it("how many at once, outside 1 to 20, and a Gateway poll faster than 100 ms", () => {
    assert.match(problemsOf({ READ_PARALLEL: "0" })[0], /READ_PARALLEL in builder-api\/\.env must be a whole number from 1 to 20/);
    assert.match(problemsOf({ CUSTOM_PARALLEL: "x" })[0], /CUSTOM_PARALLEL in builder-api\/\.env must be a whole number from 1 to 20/);
    assert.match(problemsOf({ GATEWAY_POLL_MS: "50" })[0], /GATEWAY_POLL_MS in builder-api\/\.env must be a whole number of at least 100/);
  });

  it("storage other than local: R2 comes with the servers (Step 46)", () => {
    assert.equal(checkConfig({}).config.storage, "local");
    assert.match(problemsOf({ STORAGE: "r2" })[0], /STORAGE=r2.*Step 46.*local/);
    assert.match(problemsOf({ STORAGE: "s3" })[0], /STORAGE in builder-api\/\.env must be local/);
  });

  it("a project lease shorter than a second (Step 22)", () => {
    assert.match(problemsOf({ LEASE_MS: "500" })[0], /LEASE_MS in builder-api\/\.env must be a whole number of at least 1000/);
  });

  it("lists every problem at once, not only the first", () => {
    assert.equal(problemsOf({ PORT: "abc", DEFAULT_MODE: "clod", MONGODB_URI: "x" }).length, 3);
  });
});

describe("loadConfig: start, or stop with every problem", () => {
  it("gives the settings when they are fine", () => {
    assert.equal(loadConfig({ PORT: "4100" }).port, 4100);
  });

  it("throws one error that lists every problem", () => {
    assert.throws(() => loadConfig({ PORT: "abc", DEFAULT_MODE: "clod" }), (err) => /PORT/.test(err.message) && /DEFAULT_MODE/.test(err.message));
  });

  it("never prints a secret, not even a wrong one", () => {
    const secret = randomBytes(5).toString("hex"); // shorter than allowed, made up at every run
    try {
      loadConfig({ GATEWAY_URL: "ftp://x", GATEWAY_API_KEY: secret.slice(0, 10), DEFAULT_MODE: "cloud" });
      assert.fail("should have thrown");
    } catch (err) {
      assert.ok(!err.message.includes(secret), err.message);
    }
  });
});
