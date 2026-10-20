// Gateway client: when Laptop B can't be reached, the error says so in plain words (not "fetch failed").
import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.GATEWAY_URL = "http://100.64.0.1:8787";
process.env.GATEWAY_API_KEY = "test-key";
const { submitFrontend, getFrontend } = await import("../src/gateway-client.js");

describe("gateway client errors", () => {
  it("explains an unreachable Gateway instead of 'fetch failed'", async (t) => {
    t.mock.method(globalThis, "fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await assert.rejects(
      submitFrontend({ imageDataUrl: "data:image/png;base64,x", instructions: "x", contractHash: "a".repeat(64), mode: "local" }),
      /Gateway at http:\/\/100\.64\.0\.1:8787 is not reachable.*Laptop B.*Tailscale/s
    );
  });

  it("explains a Gateway that does not answer in time", async (t) => {
    t.mock.method(globalThis, "fetch", async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    });
    await assert.rejects(getFrontend("job-1"), /Gateway at http:\/\/100\.64\.0\.1:8787 did not answer/);
  });

  it("keeps the Gateway's own error for HTTP errors", async (t) => {
    t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 401, json: async () => ({ error: "Missing or wrong X-API-Key" }) }));
    await assert.rejects(getFrontend("job-1"), /401 Missing or wrong X-API-Key/);
  });
});
