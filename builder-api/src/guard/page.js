// Step 52a, guardrails: the HTML a region fix returns replaces one part of a page. Before it is used it must
// be one element, keep every marker the app depends on (the binder and the Check find controls by them), and
// carry nothing that runs or leaves the page: no scripts, event handlers, frames, javascript: links, or
// forms that send to another site. The downloaded app runs without our Content-Security-Policy, so this
// check is what keeps a fix harmless there too.
import { JSDOM } from "jsdom";

const MARKERS = ["data-action", "data-field", "data-filter", "data-stat", "data-andarkacode"];
const FORBIDDEN = ["script", "iframe", "frame", "frameset", "object", "embed", "applet", "base", "link", "meta", "html", "head", "body"];
const URL_ATTRIBUTES = ["href", "src", "action", "formaction", "xlink:href", "poster", "data"];
const BAD_URL = /^\s*(javascript|vbscript|data:text\/html)/i;
const MAX_LENGTH = 60_000;

const { document } = new JSDOM("").window;

/** The elements of an HTML fragment (text and comments left out). */
export function fragmentElements(html) {
  const template = document.createElement("template");
  template.innerHTML = String(html ?? "");
  return [...template.content.childNodes].filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim()));
}

const markersOf = (root) =>
  [root, ...root.querySelectorAll("*")].flatMap((el) => MARKERS.filter((m) => el.hasAttribute(m)).map((m) => `${m}="${el.getAttribute(m)}"`));

/** { ok, problems[] }: before is the part as it was, after what the fix returned. */
export function checkFragment({ before, after }) {
  const problems = [];
  // A whole page is not a part: <html>/<body> are dropped by the parser, so look at the text itself.
  if (/<\s*(html|body|head)\b/i.test(after ?? "")) problems.push("the answer must be one element, not a whole page");
  const nodes = fragmentElements(after);
  if (nodes.length !== 1 || nodes[0].nodeType !== 1) {
    if (!problems.length) problems.push("the answer must be exactly one element (the part that was marked)");
    return { ok: false, problems };
  }
  if (String(after).length > MAX_LENGTH) problems.push(`the answer is too long (over ${MAX_LENGTH} characters)`);
  const root = nodes[0];

  const kept = new Set(markersOf(root));
  const lost = [...new Set(markersOf(fragmentElements(before)[0] ?? document.createElement("div")))].filter((m) => !kept.has(m));
  if (lost.length) problems.push(`it lost markers the app depends on: ${lost.join(", ")} (keep every data-action, data-field, data-filter and data-stat exactly as it was)`);

  for (const el of [root, ...root.querySelectorAll("*")]) {
    const tag = el.tagName.toLowerCase();
    if (FORBIDDEN.includes(tag)) problems.push(`<${tag}> is not allowed in a fix`);
    for (const { name, value } of el.attributes) {
      if (/^on/i.test(name)) problems.push(`the ${name} attribute is not allowed (no event handlers: the app's own script does that)`);
      if (name === "srcdoc") problems.push("srcdoc is not allowed");
      if (URL_ATTRIBUTES.includes(name) && BAD_URL.test(value)) problems.push(`a ${value.trim().split(":")[0].toLowerCase()}: link is not allowed`);
      if (name === "style" && /expression\s*\(|url\s*\(\s*['"]?\s*javascript:/i.test(value)) problems.push("a style that runs code is not allowed");
    }
    if (tag === "form" && /^\s*(https?:)?\/\//i.test(el.getAttribute("action") ?? "")) problems.push("a form that sends to another site is not allowed");
  }
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}
