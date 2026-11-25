// Step 54a, region fix: a person marks one part of a built page and says what is wrong; only that part
// changes. A part in the page's HTML is rewritten (a part fix); a part the page's script draws (a table row's
// button) gets CSS for that one component, found by its marker (a style fix).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkStyle, numberPage, partOf, pickerPage, replacePart, styleSelector, withStyle, writeFix } from "../src/fix/index.js";

const PAGE = `<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body>
<h1 class="text-2xl">TechFest</h1>
<div class="cards"><div class="card"><p>Checked In</p><p data-stat="checkedIn">2</p></div></div>
<button data-action="create" class="bg-violet-600">+ Register Student</button>
<table><tbody id="rows"></tbody></table>
<script>const SAMPLE_REGISTRATIONS = [{ studentName: "Aarav" }];</script>
</body></html>`;

const numberOf = (html, pattern) => Number(html.match(pattern)?.[1]);

describe("numbering the parts of a page", () => {
  it("numbers every element inside <body> in document order, the same way every time", () => {
    const once = numberPage(PAGE);
    assert.equal(once, numberPage(PAGE));
    assert.match(once, /<h1 class="text-2xl" data-ak-n="1">/);
    assert.ok(!/<body[^>]*data-ak-n/.test(once), "the body itself is not a part");
    assert.ok(!/<script[^>]*data-ak-n/.test(once), "scripts are not parts");
  });

  it("partOf gives one numbered part's HTML, without the numbers", () => {
    const n = numberOf(numberPage(PAGE), /data-action="create"[^>]*data-ak-n="(\d+)"|data-ak-n="(\d+)"[^>]*data-action="create"/);
    assert.equal(partOf(PAGE, n), '<button data-action="create" class="bg-violet-600">+ Register Student</button>');
    assert.equal(partOf(PAGE, 999), null);
  });

  it("replacePart changes only that part: the rest of the page is the same", () => {
    const n = numberOf(numberPage(PAGE), /<h1[^>]*data-ak-n="(\d+)"/);
    const fixed = replacePart(PAGE, n, '<h1 class="text-4xl text-violet-700">TechFest 2026</h1>');
    assert.match(fixed, /<h1 class="text-4xl text-violet-700">TechFest 2026<\/h1>/);
    assert.equal(replacePart(fixed, n, '<h1 class="text-2xl">TechFest</h1>'), replacePart(PAGE, n, '<h1 class="text-2xl">TechFest</h1>'));
    assert.match(fixed, /const SAMPLE_REGISTRATIONS = \[/, "the page's script is untouched");
    assert.ok(!fixed.includes("data-ak-n"), "no numbers are left in the saved page");
  });

  it("pickerPage: the numbered page plus the picker script, for the 'Fix a part' view only", () => {
    const html = pickerPage(PAGE);
    assert.match(html, /data-ak-n="1"/);
    assert.match(html, /<script data-andarkacode-picker>/);
    assert.match(html, /ak-pick/);
  });
});

describe("style fixes, for parts the page's script draws", () => {
  it("only marker, id and tag selectors are accepted", () => {
    assert.equal(styleSelector('[data-action="checkIn"]'), '[data-action="checkIn"]');
    assert.equal(styleSelector('#rows td[data-field="status"] span'), '#rows td[data-field="status"] span');
    for (const bad of ['body', "*", 'a[href^="http"]', "div{}", '[data-action="x"]{color:red}', "</style><script>", "", "x".repeat(300)]) {
      assert.equal(styleSelector(bad), null, bad);
    }
  });

  it("checkStyle: CSS declarations only, nothing that loads or runs", () => {
    assert.deepEqual(checkStyle("background-color: #7c3aed !important; color: white !important; border-radius: 9999px;"), { ok: true, problems: [] });
    for (const bad of ["background: url(https://evil.example/x.png)", "color: red } body { display: none", "@import 'x.css'", "width: expression(alert(1))", "color: red</style><script>", "behavior: url(x.htc)"]) {
      assert.equal(checkStyle(bad).ok, false, bad);
    }
  });

  it("withStyle adds one marked <style> before </body>", () => {
    const html = withStyle(PAGE, '[data-action="checkIn"]', "background-color: #7c3aed !important;", 1);
    assert.match(html, /<style data-ak-fix="1">\[data-action="checkIn"\] \{ background-color: #7c3aed !important; \}<\/style>\n<\/body>/);
  });
});

describe("writeFix: ask the AI, check its answer, retry with the problem", () => {
  const n = () => numberOf(numberPage(PAGE), /<h1[^>]*data-ak-n="(\d+)"/);

  it("a part fix: the changed part goes into the page", async () => {
    const prompts = [];
    const local = async (prompt) => (prompts.push(prompt), '```html\n<h1 class="text-4xl text-violet-700">TechFest</h1>\n```');
    const result = await writeFix({ html: PAGE, pick: { kind: "part", n: n() }, note: "bigger and purple", mode: "local", providers: { local } });
    assert.equal(result.ok, true, result.problem);
    assert.equal(result.provider, "local");
    assert.match(result.html, /<h1 class="text-4xl text-violet-700">TechFest<\/h1>/);
    assert.match(prompts[0], /bigger and purple/);
    assert.match(prompts[0], /<h1 class="text-2xl">TechFest<\/h1>/);
  });

  it("an answer that breaks a rule is sent back with the problem, then refused after 3 tries", async () => {
    const target = numberOf(numberPage(PAGE), /data-action="create"[^>]*data-ak-n="(\d+)"|data-ak-n="(\d+)"[^>]*data-action="create"/);
    const prompts = [];
    const local = async (prompt) => (prompts.push(prompt), '<button class="bg-green-600">Add Student</button>');
    const result = await writeFix({ html: PAGE, pick: { kind: "part", n: target }, note: "green, says Add Student", mode: "local", providers: { local } });
    assert.equal(result.ok, false);
    assert.equal(prompts.length, 3);
    assert.match(prompts[1], /lost markers the app depends on: data-action="create"/);
    assert.match(result.problem, /data-action="create"/);
  });

  it("a style fix: CSS for that one component", async () => {
    const local = async () => "```css\nbackground-color: #7c3aed !important; color: #fff !important;\n```";
    const result = await writeFix({ html: PAGE, pick: { kind: "style", selector: '[data-action="checkIn"]', label: "button “Check In”" }, note: "purple", mode: "local", providers: { local } });
    assert.equal(result.ok, true, result.problem);
    assert.match(result.html, /<style data-ak-fix="1">\[data-action="checkIn"\] \{ background-color: #7c3aed !important; color: #fff !important; \}<\/style>/);
  });

  it("auto mode tries the cloud first, then the laptop", async () => {
    const cloud = async () => {
      throw new Error("Gemini 503");
    };
    const local = async () => '<h1 class="text-4xl">TechFest</h1>';
    const result = await writeFix({ html: PAGE, pick: { kind: "part", n: n() }, note: "bigger", mode: "auto", providers: { cloud, local } });
    assert.equal(result.provider, "local");
    assert.equal(result.ok, true);
  });

  it("a part number that isn't on the page is refused before any AI is asked", async () => {
    const result = await writeFix({ html: PAGE, pick: { kind: "part", n: 999 }, note: "x", mode: "local", providers: { local: async () => assert.fail("asked") } });
    assert.equal(result.ok, false);
    assert.match(result.problem, /no longer on the page/);
  });
});
