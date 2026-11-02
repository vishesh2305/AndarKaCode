// gatewayLight: Laptop B's light in the header. Since Step 23b pages are drawn by the single call by
// default, so Screenshot-to-Code only has to be running when the Gateway's page builder is "s2c".
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gatewayLight } from "../src/gateway-light.js";

const up = { reachable: true, ollamaUp: true, s2cUp: false, queueLength: 2 };

describe("gatewayLight: Laptop B's light", () => {
  it("is grey while the first health check is on its way", () => {
    assert.deepEqual(gatewayLight(undefined), { ok: null, detail: "checking…" });
  });

  it("is green with the single call even when Screenshot-to-Code is not running", () => {
    const light = gatewayLight({ ...up, pageBuilder: "single" });
    assert.equal(light.ok, true);
    assert.match(light.detail, /Pages: one model call/);
    assert.match(light.detail, /2 job\(s\) waiting/);
  });

  it("needs Screenshot-to-Code when it is the page builder", () => {
    assert.equal(gatewayLight({ ...up, pageBuilder: "s2c" }).ok, false);
    assert.equal(gatewayLight({ ...up, pageBuilder: "s2c", s2cUp: true }).ok, true);
    assert.match(gatewayLight({ ...up, pageBuilder: "s2c" }).detail, /Screenshot-to-Code down/);
  });

  it("treats an older Gateway (no pageBuilder) as Screenshot-to-Code, as before", () => {
    assert.equal(gatewayLight(up).ok, false);
  });

  it("is red when the GPU model is down, or the Gateway can't be reached", () => {
    assert.equal(gatewayLight({ ...up, pageBuilder: "single", ollamaUp: false }).ok, false);
    const unreachable = gatewayLight({ reachable: false, error: "connect ECONNREFUSED" });
    assert.equal(unreachable.ok, false);
    assert.match(unreachable.detail, /Not reachable: connect ECONNREFUSED/);
  });
});
