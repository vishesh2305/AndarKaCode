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
    where: "Mac, templates only",
    how: [
      "Templates write only the backend parts the spec asks for: data models, routes, input checks, login if a login screen is shown, and a test for each part.",
      "It takes under a second, and the same spec always gives the same code.",
    ],
    details: (project, s) => [["Result", s.note ?? "—"], ["Time", secs(s.seconds)]],
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
    where: "coming next",
    how: ["Coming next: a small script connects each page's tables and buttons to the backend, using the markers the pages already have."],
    details: () => [],
  },
  verify: {
    title: "Check",
    where: "coming next",
    how: ["Coming next: a robot browser and the generated tests check that every button works and that nothing unnecessary was built."],
    details: () => [],
  },
  ready: {
    title: "Ready",
    where: "coming next",
    how: ["Coming next: a live preview and publishing to GitHub. Today you can download the app as a zip once the sync check passes."],
    details: () => [],
  },
};

export const STATUS_WORDS = {
  done: "Done",
  active: "Working on it",
  waiting: "Waiting",
  failed: "Needs attention",
  soon: "Coming soon",
};
