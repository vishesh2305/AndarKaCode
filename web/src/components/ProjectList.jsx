// Your projects, newest first, with where each one is; and what memory holds (Step 14).
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { memoryWords } from "../stations.js";
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

// Memory: how much earlier work is kept, and a way to forget it. Projects themselves are never touched.
function MemoryBox({ refreshKey }) {
  const [counts, setCounts] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.memory().then(setCounts, () => setCounts(null));
  }, [refreshKey]);

  async function clear() {
    if (!window.confirm("Forget everything in memory? Your projects stay; new projects are built from scratch.")) return;
    setBusy(true);
    try {
      await api.clearMemory();
      setCounts(await api.memory());
    } finally {
      setBusy(false);
    }
  }

  if (!counts) return null;
  const words = memoryWords(counts);
  return (
    <section className="memory-box" aria-label="Memory">
      <h2>Memory</h2>
      <p className="memory-count">{words}</p>
      <p className="memory-hint">Work from Ready projects, reused when the same screenshot or button comes back.</p>
      <button className="btn btn-quiet" disabled={busy || words === "nothing yet"} onClick={clear}>
        {busy ? "Clearing…" : "Clear memory"}
      </button>
    </section>
  );
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
      <MemoryBox refreshKey={projects.map((p) => `${p.id}:${p.state}`).join(",")} />
    </nav>
  );
}
