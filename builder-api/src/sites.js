// Step 34b: what a browser counts as one "site": a host with every name under the same registered domain,
// ports not counted. Cookies (without a Domain, ours) go to their own host only, and SameSite cookies are not
// sent with requests from another site; so the live preview, on another site, never gets the UI's session.
// Without the full public-suffix list, a country's second level (co.in, co.uk, com.au...) keeps three labels;
// a shared host such as x.vercel.app then counts as one site with y.vercel.app, which errs on the safe side.
const SECOND_LEVELS = new Set(["ac", "co", "com", "edu", "gen", "gov", "firm", "ind", "net", "nic", "org", "res"]);

/** The site of a URL: "https://preview.andarkacode.com:8443" -> "andarkacode.com". */
export function siteOf(url) {
  const host = new URL(url).hostname.toLowerCase();
  if (host.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(host) || !host.includes(".")) return host;
  const labels = host.split(".");
  const keep = labels.length >= 3 && labels.at(-1).length === 2 && SECOND_LEVELS.has(labels.at(-2)) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

export const sameSite = (a, b) => siteOf(a) === siteOf(b);

/**
 * The live preview's address on one computer (no PREVIEW_ORIGIN): where it listens, as another site than
 * the address people open. 127.0.0.1 and localhost are two sites to a browser.
 */
export function defaultPreviewOrigin({ host, port, publicUrl }) {
  let name = ["0.0.0.0", "::", ""].includes(host) ? "127.0.0.1" : host;
  if (publicUrl && new URL(publicUrl).hostname === name && ["127.0.0.1", "localhost"].includes(name)) name = name === "localhost" ? "127.0.0.1" : "localhost";
  return `http://${name.includes(":") ? `[${name}]` : name}:${port}`;
}
