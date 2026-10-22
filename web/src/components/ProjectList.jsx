// Your projects, newest first, with where each one is.
const STATE_WORDS = {
  UPLOADED: "Reading",
  CONTRACT_DRAFT: "Planning",
  BUILDING: "Building",
  SYNCED: "Wiring",
  INTEGRATING: "Wiring",
  VERIFYING: "Checking",
  READY: "Ready to download",
  NEEDS_ATTENTION: "Needs attention",
};
const STATE_LOOK = { READY: "done", NEEDS_ATTENTION: "failed" };

export function ago(date) {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(date)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function ProjectList({ projects, selectedId, onSelect, onNew, creating }) {
  return (
    <nav className="sidebar" aria-label="Projects">
      <button className={`btn btn-new${creating ? " btn-current" : ""}`} onClick={onNew}>
        <span aria-hidden="true">＋</span> New project
      </button>
      {projects.length === 0 ? (
        <p className="sidebar-empty">No projects yet. Drop a screenshot to start one.</p>
      ) : (
        <ul className="project-list">
          {projects.map((p) => (
            <li key={p.id}>
              <button className={`project-item${p.id === selectedId ? " project-current" : ""}`} onClick={() => onSelect(p.id)}>
                <span className={`state-dot state-${STATE_LOOK[p.state] ?? "active"}`} aria-hidden="true" />
                <span className="project-name">{p.name}</span>
                <span className="project-meta">{STATE_WORDS[p.state] ?? p.state}</span>
                <span className="project-time">{ago(p.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
