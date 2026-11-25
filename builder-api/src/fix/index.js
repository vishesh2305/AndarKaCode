// Step 54a, region fix: a person marks one part of a built page and says what is wrong; only that part changes.
// - A part in the page's HTML (a title, a card, a button outside the table) is a "part fix": the AI rewrites
//   that element, and it is put back at its exact place in the file (source offsets), so every other byte of
//   the page stays as it was.
// - A part the page's own script draws (a table row's button or cell) is not in the HTML: a "style fix" adds
//   CSS for that one component, found by its marker ([data-action="checkIn"]).
// Every answer passes the guard (src/guard/page.js) before it is used; one that doesn't goes back to the AI
// with the problem, three tries in all.
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { codeProviders } from "../custom/model.js";
import { providerOrder } from "../custom/writer.js";
import { checkFragment } from "../guard/page.js";

const PICKER = readFileSync(new URL("./picker.js", import.meta.url), "utf8");
const SKIP = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);
const MAX_TRIES = 3;

/** The page parsed, and its parts in document order: the elements inside <body> written in the file. */
function parts(html) {
  const dom = new JSDOM(html, { includeNodeLocations: true });
  const body = dom.window.document.body;
  const list = body ? [...body.querySelectorAll("*")].filter((el) => !SKIP.has(el.tagName) && !el.closest("script, style, template, noscript") && dom.nodeLocation(el)) : [];
  return { dom, list };
}

/** The page with data-ak-n="1", "2", ... on every part (for the "Fix a part" view only). */
export function numberPage(html) {
  const { dom, list } = parts(html);
  list.forEach((el, i) => el.setAttribute("data-ak-n", String(i + 1)));
  return dom.serialize();
}

/** The numbered page plus the picker script: drawing a box picks a part and tells the app. */
export function pickerPage(html) {
  const numbered = numberPage(html);
  const script = `<script data-andarkacode-picker>\n${PICKER}</script>\n`;
  const at = numbered.toLowerCase().lastIndexOf("</body>");
  return at === -1 ? numbered + script : numbered.slice(0, at) + script + numbered.slice(at);
}

/** Part n's HTML exactly as it is written in the file, or null. */
export function partOf(html, n) {
  const { dom, list } = parts(html);
  const el = Number.isInteger(n) && n >= 1 ? list[n - 1] : null;
  if (!el) return null;
  const { startOffset, endOffset } = dom.nodeLocation(el);
  return html.slice(startOffset, endOffset);
}

/** The page with part n replaced by fragment; every other byte as it was. */
export function replacePart(html, n, fragment) {
  const { dom, list } = parts(html);
  const el = list[n - 1];
  if (!el) throw new Error(`The page has no part ${n}`);
  const { startOffset, endOffset } = dom.nodeLocation(el);
  return html.slice(0, startOffset) + fragment + html.slice(endOffset);
}

// ---- style fixes ----

const COMPOUND = /^(?:[a-z][a-z0-9]*)?(?:#[A-Za-z][\w-]*)?(?:\[data-(?:action|field|filter|stat)="[\w-]+"\])?$/;

/** The selector, if it is only tags, ids and our markers, and names an id or a marker; else null. */
export function styleSelector(selector) {
  const s = String(selector ?? "").trim().replace(/\s+/g, " ");
  if (!s || s.length > 200 || !/#|\[data-/.test(s)) return null;
  const compounds = s.split(/ > | /);
  return compounds.every((c) => c && COMPOUND.test(c)) ? s : null;
}

/** { ok, problems[] } for CSS declarations: property: value; pairs only, nothing that loads or runs. */
export function checkStyle(declarations) {
  const css = String(declarations ?? "").trim();
  const problems = [];
  if (!css) problems.push("the answer had no CSS");
  if (css.length > 2000) problems.push("the CSS is too long (over 2000 characters)");
  if (/[{}<>\\@]/.test(css)) problems.push("only declarations are allowed: no selectors, braces, @rules or tags");
  if (/url\s*\(|expression\s*\(|javascript:|behaviou?r\s*:|-moz-binding/i.test(css)) problems.push("nothing that loads a file or runs code (url(), expression(), behavior)");
  const bad = css.split(";").map((d) => d.trim()).filter((d) => d && !/^-?[a-z][a-z-]*\s*:\s*[^:;]+(:[^;]*)?$/i.test(d));
  if (bad.length && !problems.length) problems.push(`not a CSS declaration: ${bad[0].slice(0, 80)}`);
  return { ok: problems.length === 0, problems };
}

/** The page with one more <style data-ak-fix="k"> before </body>. */
export function withStyle(html, selector, declarations, k = (html.match(/data-ak-fix="/g) ?? []).length + 1) {
  const css = declarations.trim().replace(/;?$/, ";");
  const tag = `<style data-ak-fix="${k}">${selector} { ${css} }</style>\n`;
  const at = html.toLowerCase().lastIndexOf("</body>");
  return at === -1 ? html + tag : html.slice(0, at) + tag + html.slice(at);
}

// ---- asking the AI ----

const RULES = [
  "Rules (an answer that breaks one is refused):",
  "- change only what the person asked for; keep the rest of the part as it is (its text, its order, its look);",
  "- keep every data-action, data-field, data-filter and data-stat attribute, every id and every name exactly as they are, on the same kind of element;",
  "- no <script>, no on... attributes (onclick and the like), no iframes, no javascript: links;",
  "- for the look, use Tailwind CSS classes (the page loads Tailwind) or a style attribute;",
  "- answer with the whole changed part only: exactly one element, in one ```html block.",
];

const partPrompt = (part, note) =>
  ["You change one part of a web page (HTML with Tailwind CSS classes).", "", "The part:", "```html", part, "```", "", `What the person wants changed: ${note}`, "", ...RULES].join("\n");

const stylePrompt = ({ selector, label }, note) =>
  [
    `You write CSS declarations for one component of a web page: ${label ?? "the marked part"} (CSS selector: ${selector}).`,
    "The page draws it with its own script, so only its style can change.",
    "",
    `What the person wants changed: ${note}`,
    "",
    "Rules (an answer that breaks one is refused):",
    "- only declarations, like  background-color: #7c3aed !important; color: #ffffff !important;",
    "- end every value with !important, so it wins over the page's own classes;",
    "- no selectors, no braces, no @import, no url(), nothing that runs code;",
    "- answer in one ```css block.",
  ].join("\n");

const again = (prompt, answer, problems) => `${prompt}\n\nYour earlier answer was:\n${answer}\n\nIt was refused: ${problems.join("; ")}\nAnswer again, following every rule.`;

const block = (answer, lang) => (String(answer).match(new RegExp("```" + lang + "\\s*\\n([\\s\\S]*?)```"))?.[1] ?? String(answer)).trim();

/**
 * pick: { kind: "part", n } or { kind: "style", selector, label }. Resolves with
 * { ok, html?, provider?, answers, problem? }; providers is injectable for tests.
 */
export async function writeFix({ html, pick, note, mode, providers = codeProviders, maxTries = MAX_TRIES }) {
  let prompt;
  let use;
  if (pick?.kind === "part") {
    const part = partOf(html, pick.n);
    if (!part) return { ok: false, answers: 0, problem: "That part is no longer on the page (it changed since you marked it). Mark it again." };
    prompt = partPrompt(part, note);
    use = (answer) => {
      const fragment = block(answer, "html");
      const { problems } = checkFragment({ before: part, after: fragment });
      return problems.length ? { problems } : { html: replacePart(html, pick.n, fragment) };
    };
  } else {
    const selector = styleSelector(pick?.selector);
    if (!selector) return { ok: false, answers: 0, problem: "That part can't be fixed by its style: mark a button, a cell or a heading." };
    prompt = stylePrompt({ selector, label: pick.label }, note);
    use = (answer) => {
      const css = block(answer, "css");
      const { problems } = checkStyle(css);
      return problems.length ? { problems } : { html: withStyle(html, selector, css) };
    };
  }

  let answers = 0;
  let problem = null;
  const unavailable = [];
  for (const provider of providerOrder(mode)) {
    let asked = prompt;
    for (let attempt = 0; attempt < maxTries; attempt++) {
      let answer;
      try {
        answer = await providers[provider](asked);
      } catch (err) {
        unavailable.push(`${provider}: ${err.message}`);
        break;
      }
      answers++;
      const result = use(answer);
      if (result.html) return { ok: true, html: result.html, provider, answers };
      problem = result.problems.join("; ");
      asked = again(prompt, String(answer).slice(0, 4000), result.problems);
    }
  }
  return { ok: false, answers, problem: problem ?? `no AI answered: ${unavailable.join("; ")}` };
}
