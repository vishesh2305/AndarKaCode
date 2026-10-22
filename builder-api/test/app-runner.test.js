// Running a generated app (Step 16): the app process gets only what it needs to run, never our keys.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appEnv } from "../src/verify/app-runner.js";

describe("appEnv: the generated app's environment", () => {
  it("passes the database, the first account and what Node needs to start, nothing else", () => {
    const env = appEnv(
      { MONGODB_URI: "mongodb://127.0.0.1:27017/verify_x", ADMIN_EMAIL: "admin@example.com", ADMIN_PASSWORD: "verify-pass-1" },
      { PATH: "/usr/bin", SystemRoot: "C:\\Windows", GATEWAY_API_KEY: "secret-1", GEMINI_API_KEY: "secret-2", MONGODB_URI: "mongodb://ours/builder_db", HOME: "/home/x" }
    );
    assert.deepEqual(env, {
      PATH: "/usr/bin",
      SystemRoot: "C:\\Windows",
      MONGODB_URI: "mongodb://127.0.0.1:27017/verify_x",
      ADMIN_EMAIL: "admin@example.com",
      ADMIN_PASSWORD: "verify-pass-1",
    });
  });

  it("never lets an extra setting smuggle in a key", () => {
    const env = appEnv({ MONGODB_URI: "mongodb://x/y", GEMINI_API_KEY: "nope", NODE_OPTIONS: "--require evil.js" }, { PATH: "/bin" });
    assert.equal(env.GEMINI_API_KEY, undefined);
    assert.equal(env.NODE_OPTIONS, undefined);
  });
});
