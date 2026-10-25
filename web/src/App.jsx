// AndarKaCode UI: projects on the left; for the selected one, the metro line, how the current
// station works, and four views (screenshots, plan, pages, backend). Polls the Builder API.
import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { Header } from "./components/Header.jsx";
import { MetroLine } from "./components/MetroLine.jsx";
import { NewProject } from "./components/NewProject.jsx";
import { ProjectList, ago } from "./components/ProjectList.jsx";
import { StationInfo } from "./components/StationInfo.jsx";
import { Backend, Pages, Plan, Screenshots } from "./components/Tabs.jsx";
import { pipelineStatus } from "./pipeline.js";

const TABS = ["Screenshots", "Plan", "Pages", "Backend"];

// Links to a view: #/new, #/p/<projectId>, #/p/<projectId>/<tab> (handy for bookmarking a demo view).
function readHash() {
  const [, kind, id, tab] = window.location.hash.split("/");
  const named = TABS.find((t) => t.toLowerCase() === (tab ?? "").toLowerCase());
  return { creating: kind === "new", selectedId: kind === "p" ? id ?? null : null, tab: named ?? "Screenshots" };
}
const SETTLED = ["READY", "NEEDS_ATTENTION"];

function usePolling(load, ms, deps) {
  useEffect(() => {
    let alive = true;
    let timer;
    const tick = async () => {
      await load().catch(() => {});
      if (alive) timer = setTimeout(tick, typeof ms === "function" ? ms() : ms);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

export function App() {
  const [health, setHealth] = useState(null);
  const [projects, setProjects] = useState([]);
  const initial = readHash();
  const [selectedId, setSelectedId] = useState(initial.selectedId);
  const [creating, setCreating] = useState(initial.creating);
  const [project, setProject] = useState(null);
  const [station, setStation] = useState(null); // null = follow the current station
  const [tab, setTab] = useState(initial.tab);

  usePolling(() => api.health().then(setHealth, () => setHealth({ db: false, gateway: null })), 5000, []);
  usePolling(() => api.projects().then(setProjects), 4000, []);
  usePolling(
    () => (selectedId ? api.project(selectedId).then(setProject) : Promise.resolve()),
    () => (project && SETTLED.includes(project.state) ? 8000 : 2000),
    [selectedId, project?.state]
  );

  // Open the newest project on first load; start with the upload form when there are none.
  useEffect(() => {
    if (selectedId || creating) return;
    if (projects.length) setSelectedId(projects[0].id);
  }, [projects, selectedId, creating]);

  const select = useCallback((id) => {
    setCreating(false);
    setSelectedId(id);
    setProject(null);
    setStation(null);
    setTab("Screenshots");
  }, []);

  // Keep the address bar in step with what is shown.
  useEffect(() => {
    const hash = creating ? "#/new" : selectedId ? `#/p/${selectedId}/${tab.toLowerCase()}` : "";
    if (hash && window.location.hash !== hash) window.history.replaceState(null, "", hash);
  }, [creating, selectedId, tab]);

  const status = project ? pipelineStatus(project) : null;
  const shown = station ?? status?.current;
  const showForm = creating || (!selectedId && projects.length === 0);

  return (
    <div className="app">
      <Header health={health} />
      <div className="layout">
        <ProjectList projects={projects} selectedId={selectedId} onSelect={select} onNew={() => setCreating(true)} creating={showForm} />
        {/* Scrolls on its own on wide screens, so the sidebar never makes the page taller (styles.css). */}
        <div className="main-scroll">
          <main className="main">
            {showForm ? (
              <NewProject onCreated={(id) => (api.projects().then(setProjects), select(id))} />
            ) : !project ? (
              <p className="empty">Loading…</p>
            ) : (
              <>
                <div className="project-head">
                  <div>
                    <h1>{project.name}</h1>
                    <p className="muted">
                      Started {ago(project.createdAt)} with {project.screenshots?.length || 1} screenshot
                      {(project.screenshots?.length || 1) === 1 ? "" : "s"}, AI mode {project.mode}
                    </p>
                  </div>
                  <div className="download">
                    {project.state === "READY" ? (
                      <a className="btn btn-download" href={api.downloadUrl(project.id)} download>
                        Download app (.zip)
                      </a>
                    ) : (
                      <span className="btn btn-download btn-disabled" aria-disabled="true" title="Available once every check passes">
                        Download app (.zip)
                      </span>
                    )}
                    {status.canDownloadAnyway && (
                      <a className="download-anyway" href={api.downloadUrl(project.id, { anyway: true })} download>
                        Download anyway, with the check report
                      </a>
                    )}
                  </div>
                </div>

                <div className="metro-wrap">
                  <MetroLine status={status} selected={shown} onSelect={setStation} />
                </div>
                <StationInfo id={shown} project={project} status={status} />

                <div className="tabs" role="tablist" aria-label="Project views">
                  {TABS.map((t) => (
                    <button key={t} role="tab" aria-selected={tab === t} className={`tab${tab === t ? " tab-on" : ""}`} onClick={() => setTab(t)}>
                      {t}
                    </button>
                  ))}
                </div>
                <div className="tab-panel" role="tabpanel" aria-label={tab}>
                  {tab === "Screenshots" && <Screenshots project={project} />}
                  {tab === "Plan" && (
                    <Plan
                      project={project}
                      onSaved={() => {
                        api.project(project.id).then(setProject).catch(() => {});
                      }}
                    />
                  )}
                  {tab === "Pages" && <Pages project={project} pages={status.stations.pages.pages} wired={status.stations.wire.status === "done"} />}
                  {tab === "Backend" && <Backend project={project} ready={status.stations.backend.status === "done"} />}
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
