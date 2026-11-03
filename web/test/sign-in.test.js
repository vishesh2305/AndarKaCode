// Step 29: what the UI shows before the app, from GET /api/me and the ?signin= the Builder API sends back.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { signInView } from "../src/sign-in.js";

const out = { auth: true, user: null, providers: ["github", "google"] };

describe("signInView", () => {
  it("waits while /api/me has not answered", () => {
    assert.deepEqual(signInView(null, ""), { show: "loading" });
  });

  it("goes straight to the app when sign-in is off (this computer only)", () => {
    assert.deepEqual(signInView({ auth: false, user: null }, ""), { show: "app", user: null });
  });

  it("shows the app with the person once signed in", () => {
    const user = { id: "u1", name: "Asha", email: "asha@example.com" };
    assert.deepEqual(signInView({ ...out, user, workspace: { id: "w1" } }, ""), { show: "app", user });
  });

  it("shows a sign-in button per provider when signed out", () => {
    const view = signInView(out, "");
    assert.equal(view.show, "sign-in");
    assert.deepEqual(view.buttons, [
      { provider: "github", label: "Sign in with GitHub", href: "/auth/github/start" },
      { provider: "google", label: "Sign in with Google", href: "/auth/google/start" },
    ]);
    assert.equal(view.message, null);
  });

  it("says plainly why the last sign-in did not get in", () => {
    assert.match(signInView(out, "?signin=not-invited").message, /not on the invite list/);
    assert.match(signInView(out, "?signin=not-verified").message, /verified email/);
    assert.match(signInView(out, "?signin=failed").message, /try again/);
    assert.equal(signInView(out, "?signin=whatever").message, null);
  });
});
