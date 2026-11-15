// Step 34b: the live preview on a site of its own. Browsers keep cookies per site (a host and every name
// under the same registered domain; ports don't count), so a preview on another site is never sent the UI's
// session cookie, and its pages are "cross-site" to the UI.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultPreviewOrigin, sameSite, siteOf } from "../src/sites.js";

describe("siteOf: what a browser counts as one site", () => {
  it("a registered domain with all its subdomains, ports not counted", () => {
    assert.equal(siteOf("https://andarkacode.com"), "andarkacode.com");
    assert.equal(siteOf("https://preview.andarkacode.com:8443"), "andarkacode.com");
    assert.equal(siteOf("https://a.b.andarkacode.com"), "andarkacode.com");
  });

  it("a domain under a country's second level (co.in, co.uk, com.au) keeps three labels", () => {
    assert.equal(siteOf("https://preview.andarkacode.co.in"), "andarkacode.co.in");
    assert.equal(siteOf("https://andarkacode.com.au"), "andarkacode.com.au");
  });

  it("an IP address or a single name is a site by itself", () => {
    assert.equal(siteOf("http://127.0.0.1:4000"), "127.0.0.1");
    assert.equal(siteOf("http://localhost:4001"), "localhost");
    assert.equal(siteOf("http://[::1]:4000"), "[::1]");
  });
});

describe("sameSite", () => {
  it("another port, or a subdomain, is still the same site; another domain or host is not", () => {
    assert.equal(sameSite("http://127.0.0.1:4000", "http://127.0.0.1:4001"), true);
    assert.equal(sameSite("https://andarkacode.com", "https://preview.andarkacode.com"), true);
    assert.equal(sameSite("https://andarkacode.com", "https://andarkacode-preview.app"), false);
    assert.equal(sameSite("http://localhost:4000", "http://127.0.0.1:4001"), false);
  });
});

describe("defaultPreviewOrigin: the preview's address when PREVIEW_ORIGIN is not set (one computer)", () => {
  it("another site than the address people open: 127.0.0.1 when they open localhost, and the other way round", () => {
    assert.equal(defaultPreviewOrigin({ host: "127.0.0.1", port: 4001, publicUrl: "http://localhost:4000" }), "http://127.0.0.1:4001");
    assert.equal(defaultPreviewOrigin({ host: "127.0.0.1", port: 4001, publicUrl: "http://127.0.0.1:4000" }), "http://localhost:4001");
  });

  it("a server listening everywhere is reached on 127.0.0.1", () => {
    assert.equal(defaultPreviewOrigin({ host: "0.0.0.0", port: 4001, publicUrl: null }), "http://127.0.0.1:4001");
    assert.equal(defaultPreviewOrigin({ host: "::", port: 4001, publicUrl: "http://localhost:4000" }), "http://127.0.0.1:4001");
  });
});
