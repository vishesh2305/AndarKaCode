// What each metro station is, where it runs, and how it works, in plain words.
// details(project, station) returns the live facts shown for this project.

const short = (hash) => (hash ? hash.slice(0, 12) : "—");
const secs = (s) => (s == null ? "—" : s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`);
const providerName = (p) => (p === "local" ? "local AI on the laptop" : p === "cloud" ? "Gemini (cloud backup)" : "—");

function specCounts(project) {
  const spec = project.contract?.body;
  if (!spec) return [];
  const fields = spec.entities.reduce((n, e) => n + e.fields.length, 0);
  return [
    ["Tables", spec.entities.length ? spec.entities.map((e) => e.label).join(", ") : "none"],
    ["Fields", fields],
    ["Buttons beyond add/edit/delete", spec.operations.length],
    ["Number cards", spec.stats.length],
    ["Login", spec.auth ? "yes (a login screen is shown)" : "no (no login screen)"],
  ];
}

export const STATIONS = {
  upload: {
    title: "Upload",
    where: "Mac",
    how: [
      "Your screenshots are saved in the order you dropped them. Each one becomes one page of the app.",
      "Every screenshot gets a fingerprint (SHA-256) and is shrunk to at most 1280 pixels wide, so the AI reads it faster.",
    ],
    details: (project, s) => [["Screenshots", s.screenshots]],
  },
  read: {
    title: "Read",
    where: "Mac, with a vision AI",
    how: [
      "An AI that understands images looks at each screenshot and lists what it sees: tables and their columns, buttons, forms, search boxes, number cards, a login form.",
      "It only describes the screen; it doesn't decide what to build. The laptop's own model goes first, with Gemini as a backup.",
    ],
    details: (project, s) => [
      ["Read by", providerName(s.provider)],
      ["Time", secs(s.seconds)],
    ],
  },
  plan: {
    title: "Plan",
    where: "Mac, rules only",
    how: [
      "Fixed rules turn what is on screen into an App Spec: the data, the buttons, and what each one needs to work.",
      "Every item keeps its evidence, like “column ‘Email’ on screenshot 1”. Nothing without evidence gets built.",
    ],
    details: (project, s) => [["Spec version", s.version ?? "—"], ["Fingerprint", short(s.hash)], ...specCounts(project)],
  },
  pages: {
    title: "Pages",
    where: "Windows GPU",
    how: [
      "The Windows laptop's graphics card redraws each screenshot as a real web page, one job per screenshot.",
      "Its instructions come from the spec: the exact field names, and markers on every button and table cell, so the page can be connected to the backend.",
    ],
    details: (project, s) => [
      ...s.pages.map((p) => [`Page ${p.page}`, { done: "built", running: "building now", failed: "failed", waiting: "waiting" }[p.status] ?? p.status]),
      ["Built by", providerName(s.provider)],
      ["Time", secs(s.seconds)],
    ],
  },
  backend: {
    title: "Backend",
    where: "Mac, templates + a coding AI",
    how: [
      "Templates write only the backend parts the spec asks for: data models, routes, input checks, login if a login screen is shown, and a test for each part. The same spec always gives the same code.",
      "A button no template covers (like “Give 10% Raise”) gets its code from a coding AI. The code is checked for anything unsafe, then the button is pressed once in the real app. If it fails, the AI gets the problem and tries again, up to 3 times. A button that still fails says “not available yet”.",
    ],
    details: (project, s) => [
      ["Result", s.note ?? "—"],
      ...s.custom.map((c) => [
        c.button,
        c.ok ? `written by ${providerName(c.provider)}, ${c.answers} answer${c.answers === 1 ? "" : "s"}` : `not written, says "not available yet": ${c.problem ?? "no answer"}`,
      ]),
      ["Time", secs(s.seconds)],
    ],
  },
  sync: {
    title: "Sync check",
    where: "Mac",
    how: [
      "Every page and the backend are stamped with the fingerprint of the spec they were built from. The app moves on only when all of them match the current spec.",
      "If the spec changes during a build, the out-of-date parts are thrown away and rebuilt.",
    ],
    details: (project, s) => [["Spec fingerprint", short(s.hash)]],
  },
  wire: {
    title: "Wire",
    where: "Mac",
    how: [
      "Each page gets one extra line: a small script (app.js) that connects its tables, forms and buttons to the backend, using the markers on the page.",
      "A list (api-map.json) says which button calls which backend address. The page's look doesn't change: new rows are copies of its own sample rows.",
    ],
    details: (project, s) => [["Pages wired", s.status === "done" ? project.contract?.body.pages.length ?? "—" : "—"]],
  },
  verify: {
    title: "Check",
    where: "Mac",
    how: [
      "The app is started on a throwaway database. In a browser without a screen, each page is used like a person would: add a record, reload, edit it, search, filter, press its buttons, delete it, sign in.",
      "Every result must reach the database. Then the app's own tests run. If something fails, the report says which control, what the backend answered, and which part to blame: the page, the spec or the backend.",
    ],
    details: (project, s) => [
      ["Passed", s.summary?.pass ?? "—"],
      ["Failed", s.summary?.fail ?? "—"],
      ["Warnings", s.summary?.warn ?? "—"],
      ["Time", s.seconds == null ? "—" : `${s.seconds} s`],
    ],
  },
  ready: {
    title: "Ready",
    where: "Mac",
    how: [
      "Every check passed. Try the app for real in the Pages tab (Live), then download it as a zip with its verify report.",
      "Publishing to GitHub comes in a later step.",
    ],
    details: () => [],
  },
};

export const CHECK_MARKS = { pass: "✓", fail: "✗", warn: "!", note: "i", skip: "–" };
export const LAYER_WORDS = { page: "the page", spec: "the spec", backend: "the backend" };

export const STATUS_WORDS = {
  done: "Done",
  active: "Working on it",
  waiting: "Waiting",
  failed: "Needs attention",
  soon: "Coming soon",
};
