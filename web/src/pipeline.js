// A project (as GET /api/projects/:id returns it) -> what each metro station shows.
// Pure: no React, no network, so it can be tested on its own (web/test/pipeline.test.js).

export const STATION_IDS = ["upload", "read", "plan", "pages", "backend", "sync", "wire", "verify", "ready"];
const BUILD_STATES = ["CONTRACT_DRAFT", "BUILDING"];
const AFTER_SYNC = ["SYNCED", "INTEGRATING", "VERIFYING", "READY"];
const RANK = { fail: 0, warn: 1, note: 2, skip: 3, pass: 4 }; // the report shows problems first

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

  // Check (Step 16): the Verifier's job for the CURRENT spec, with its report.
  const verify = hash ? latest("verify", (j) => j.contractHash === hash) : null;
  const report = verify?.report ?? null;

  // Sync check: every page and the backend carry the current spec's fingerprint.
  const branchesDone = stations.pages.status === "done" && stations.backend.status === "done";
  const somethingFailed = ["read", "plan", "pages", "backend"].some((id) => stations[id].status === "failed");
  const pastSync = AFTER_SYNC.includes(state) || Boolean(verify);
  stations.sync = {
    status:
      pastSync ? "done"
      : state === "NEEDS_ATTENTION" && spec && !somethingFailed ? "failed"
      : branchesDone ? "active"
      : "waiting",
    hash: hash ?? null,
  };

  // Wire: the wired pages are written into the app folder, right after the sync check.
  stations.wire = { status: ["SYNCED", "INTEGRATING"].includes(state) ? "active" : pastSync ? "done" : "waiting" };

  // Check: the app is started on a throwaway database and used like a person would.
  stations.verify = {
    status:
      state === "READY" || report?.ok ? "done"
      : report && !report.ok ? "failed"
      : verify?.status === "failed" ? "failed"
      : state === "VERIFYING" || verify?.status === "running" ? "active"
      : "waiting",
    summary: report?.summary ?? null,
    seconds: report?.seconds ?? null,
    error: verify?.status === "failed" ? verify.error ?? null : null,
    checks: report ? [...report.checks].sort((a, b) => RANK[a.status] - RANK[b.status]) : [],
  };

  // Ready: every check passed; the app can be downloaded.
  stations.ready = { status: state === "READY" ? "done" : "waiting" };

  const order = ["read", "plan", "pages", "backend", "sync", "wire", "verify"];
  const current =
    order.find((id) => stations[id].status === "failed") ??
    order.find((id) => stations[id].status === "active") ??
    (state === "READY" ? "ready" : "upload");

  return { stations, current, error: project.error ?? null, canDownloadAnyway: state === "NEEDS_ATTENTION" && Boolean(report) };
}
