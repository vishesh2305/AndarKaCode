// A project (as GET /api/projects/:id returns it) -> what each metro station shows.
// Pure: no React, no network, so it can be tested on its own (web/test/pipeline.test.js).

export const STATION_IDS = ["upload", "read", "plan", "pages", "backend", "sync", "wire", "verify", "ready"];
const SOON = ["wire", "verify", "ready"]; // planned steps, shown honestly as "coming soon"
const BUILD_STATES = ["CONTRACT_DRAFT", "BUILDING"];

const secondsOf = (job, now) =>
  job?.startedAt ? Math.round(((job.finishedAt ? Date.parse(job.finishedAt) : now) - Date.parse(job.startedAt)) / 1000) : null;

const fromJob = (job) => (job?.status === "done" ? "done" : job?.status === "failed" ? "failed" : "active");

export function pipelineStatus(project, now = Date.now()) {
  const jobs = project.jobs ?? [];
  const latest = (kind, match = () => true) => jobs.filter((j) => j.kind === kind && match(j)).at(-1);
  const spec = project.currentContractVersion > 0 && project.contract ? project.contract : null;
  const hash = spec?.hash;
  const state = project.state;
  const stations = {};

  stations.upload = { status: "done", screenshots: project.screenshots?.length ?? 1 };

  // Read: the vision AI lists what each screenshot shows. A spec the checker rejects means reading worked.
  const reading = latest("contract");
  const specRejected = reading?.status === "failed" && /^Spec problems/.test(reading.error ?? "");
  stations.read = {
    status: spec || specRejected || reading?.status === "done" ? "done" : reading?.status === "failed" ? "failed" : "active",
    seconds: secondsOf(reading, now),
    provider: reading?.provider ?? null,
  };

  // Plan: fixed rules turn the inventory into an App Spec.
  stations.plan = { status: spec ? "done" : specRejected ? "failed" : "waiting", version: spec?.version ?? null, hash: hash ?? null };

  // Pages: one Gateway job per screenshot, for the CURRENT spec only.
  const specPages = spec?.body?.pages ?? [];
  const pages = specPages.map(({ screenshot }) => {
    const job = latest("frontend", (j) => j.contractHash === hash && j.page === screenshot);
    return { page: screenshot, status: job?.status ?? "waiting" };
  });
  const pageJobs = jobs.filter((j) => j.kind === "frontend" && j.contractHash === hash);
  let pagesStatus = "waiting";
  if (spec) {
    if (pages.some((p) => p.status === "failed")) pagesStatus = "failed";
    else if (pages.length && pages.every((p) => p.status === "done")) pagesStatus = "done";
    else if (BUILD_STATES.includes(state)) pagesStatus = "active";
  }
  stations.pages = {
    status: pagesStatus,
    pages,
    seconds: pageJobs.length ? Math.max(...pageJobs.map((j) => secondsOf(j, now) ?? 0)) : null,
    provider: pageJobs.at(-1)?.provider ?? null,
  };

  // Backend: the template generator, for the CURRENT spec only.
  const backend = hash ? latest("backend", (j) => j.contractHash === hash) : null;
  stations.backend = {
    status: backend ? fromJob(backend) : spec && BUILD_STATES.includes(state) ? "active" : "waiting",
    seconds: secondsOf(backend, now),
    note: backend?.note ?? null,
  };

  // Sync check: every page and the backend carry the current spec's fingerprint.
  const branchesDone = stations.pages.status === "done" && stations.backend.status === "done";
  const somethingFailed = ["read", "plan", "pages", "backend"].some((id) => stations[id].status === "failed");
  stations.sync = {
    status:
      state === "SYNCED" ? "done"
      : state === "NEEDS_ATTENTION" && spec && !somethingFailed ? "failed"
      : branchesDone ? "active"
      : "waiting",
    hash: hash ?? null,
  };

  for (const id of SOON) stations[id] = { status: "soon" };

  const order = ["read", "plan", "pages", "backend", "sync"];
  const current =
    order.find((id) => stations[id].status === "failed") ??
    order.find((id) => stations[id].status === "active") ??
    (state === "SYNCED" ? "sync" : "upload");

  return { stations, current, error: project.error ?? null };
}
