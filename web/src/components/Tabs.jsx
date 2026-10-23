// The four views of a project: what you uploaded, what was planned, the pages, and the backend code.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { startView } from "../pipeline.js";

export function Screenshots({ project }) {
  const count = project.screenshots?.length || 1;
  return (
    <div className="shots">
      {Array.from({ length: count }, (_, i) => (
        <figure key={i} className="shot">
          <img src={api.screenshotUrl(project.id, i + 1)} alt={`Screenshot ${i + 1}`} loading="lazy" />
          <figcaption>
            Page {i + 1}
            {project.screenshots?.[i]?.inventory?.title ? `: ${project.screenshots[i].inventory.title}` : ""}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

const ENDPOINT_WORDS = { list: "Show the list", get: "Open one", create: "Add", update: "Edit", delete: "Delete" };
const KIND_WORDS = { setStatus: "changes status", export: "downloads a CSV", custom: "not available yet" };

function Evidence({ text }) {
  return <span className="evidence">{text}</span>;
}

export function Plan({ project }) {
  const spec = project.contract?.body;
  if (!spec) return <Empty text="The plan appears once the screenshots have been read." />;
  return (
    <div className="plan">
      {spec.entities.map((e) => (
        <article key={e.name} className="plan-entity">
          <h3>
            {e.label} <code>/api/{e.plural}</code>
          </h3>
          <table className="plan-fields">
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Type</th>
                <th scope="col">Why it exists</th>
              </tr>
            </thead>
            <tbody>
              {e.fields.map((f) => (
                <tr key={f.name}>
                  <td>
                    <code>{f.name}</code>
                    {f.required && <span className="required">required</span>}
                  </td>
                  <td>{f.type === "enum" ? `one of ${f.options.join(", ")}` : f.type === "ref" ? `link to ${f.ref}` : f.type}</td>
                  <td>
                    <Evidence text={f.evidence} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="plan-actions">
            {Object.entries(e.endpoints).map(([key, ep]) => (
              <li key={key}>
                <strong>{ENDPOINT_WORDS[key]}</strong>
                {key === "list" && ep.search ? ", with search" : ""}
                {key === "list" && ep.filters.length ? `, filter by ${ep.filters.join(", ")}` : ""}
                {key === "list" && ep.pagination ? ", with pages" : ""}
                {key === "delete" && ep.soft ? " (kept in an archive)" : ""} <Evidence text={ep.evidence} />
              </li>
            ))}
            {spec.operations
              .filter((o) => o.entity === e.name)
              .map((o) => (
                <li key={o.name}>
                  <strong>“{o.button}”</strong> {KIND_WORDS[o.kind]} <Evidence text={o.evidence} />
                </li>
              ))}
          </ul>
        </article>
      ))}
      {spec.stats.length > 0 && (
        <article className="plan-entity">
          <h3>Number cards</h3>
          <ul className="plan-actions">
            {spec.stats.map((s) => (
              <li key={s.label}>
                <strong>{s.label}</strong> {s.metric === "custom" ? "(how to calculate it is an open question)" : `(${s.metric})`} <Evidence text={s.evidence} />
              </li>
            ))}
          </ul>
        </article>
      )}
      <article className="plan-entity">
        <h3>Login</h3>
        {spec.auth ? (
          <ul className="plan-actions">
            <li>
              <strong>Log in</strong> <Evidence text={spec.auth.login.evidence} />
            </li>
            {spec.auth.signup && (
              <li>
                <strong>Sign up</strong> <Evidence text={spec.auth.signup.evidence} />
              </li>
            )}
            {spec.auth.me && (
              <li>
                <strong>Current user and log out</strong> <Evidence text={spec.auth.me.evidence} />
              </li>
            )}
          </ul>
        ) : (
          <p className="muted">No login screen in the screenshots, so the app has no login.</p>
        )}
      </article>
      {spec.openQuestions.length > 0 && (
        <article className="plan-entity plan-questions">
          <h3>Open questions</h3>
          <ul>
            {spec.openQuestions.map((q, i) => (
              <li key={i}>{q.question}</li>
            ))}
          </ul>
        </article>
      )}
    </div>
  );
}

export function Pages({ project, pages, wired }) {
  const ready = pages.filter((p) => p.status === "done").map((p) => p.page);
  const [page, setPage] = useState(ready[0] ?? pages[0]?.page ?? 1);
  const [view, setView] = useState("built"); // "built": as Laptop B drew it; "live": the real app on a test database
  const [live, setLive] = useState({ url: null, credentials: null, error: null, starting: false });
  useEffect(() => {
    if (!ready.includes(page) && ready.length) setPage(ready[0]);
  }, [ready.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new spec version means a new app. Once it is Ready, open on the working app (started with the
  // screenshots' rows); before that, show Laptop B's drawing.
  const opensLive = startView(project) === "live" && wired;
  useEffect(() => {
    setLive({ url: null, credentials: null, error: null, starting: false });
    if (opensLive) goLive({ fresh: true });
    else setView("built");
  }, [project.id, project.contract?.hash, opensLive]); // eslint-disable-line react-hooks/exhaustive-deps

  async function goLive({ fresh = false } = {}) {
    setView("live");
    if (live.url && !fresh) return;
    setLive((l) => ({ ...l, starting: true, error: null }));
    try {
      const preview = await api.startPreview(project.id);
      setLive({ url: preview.url, credentials: preview.credentials, error: null, starting: false });
    } catch (err) {
      setLive({ url: null, credentials: null, error: err.message, starting: false });
    }
  }

  async function stopLive() {
    await api.stopPreview(project.id);
    setLive({ url: null, credentials: null, error: null, starting: false });
    setView("built");
  }

  if (!pages.length) return <Empty text="Pages appear here once they are built on the Windows GPU." />;
  const liveUrl = live.url && live.url.replace(/page-\d+\.html$/, `page-${page}.html`);
  return (
    <div className="pages">
      <div className="pages-bar">
        <div className="page-picker" role="tablist" aria-label="Pages">
          {pages.map((p) => (
            <button key={p.page} role="tab" aria-selected={page === p.page} className={`chip${page === p.page ? " chip-on" : ""}`} onClick={() => setPage(p.page)}>
              Page {p.page}
            </button>
          ))}
        </div>
        <div className="view-toggle" role="radiogroup" aria-label="How to show the page">
          <button role="radio" aria-checked={view === "built"} className={`chip${view === "built" ? " chip-on" : ""}`} onClick={() => setView("built")}>
            As built
          </button>
          <button
            role="radio"
            aria-checked={view === "live"}
            className={`chip chip-live${view === "live" ? " chip-on" : ""}`}
            onClick={() => goLive()}
            disabled={!wired}
            title={wired ? "Use the real app, on a test database" : "Available once the pages are wired"}
          >
            Live
          </button>
        </div>
      </div>

      {view === "live" && live.credentials && (
        <p className="live-note">
          Sign in with <code className="code">{live.credentials.email}</code> and password <code className="code">{live.credentials.password}</code>
        </p>
      )}

      <div className="browser">
        <div className="browser-bar" aria-hidden="true">
          <span />
          <span />
          <span />
          {view === "live" && liveUrl && <span className="browser-address">{liveUrl}</span>}
        </div>
        {view === "built" ? (
          ready.includes(page) ? (
            // Generated code runs in a sandbox: scripts yes, but no access to this app or its cookies.
            <iframe key={`${project.contract?.hash}-${page}`} title={`Generated page ${page}`} src={api.pageUrl(project.id, page)} sandbox="allow-scripts" />
          ) : (
            <Empty text={`Page ${page} is still being built on the Windows GPU.`} />
          )
        ) : live.error ? (
          <Empty text={live.error} />
        ) : liveUrl ? (
          // The live app runs on its own local port (another site than this UI), so it may keep its own
          // login and forms without being able to reach this UI.
          <iframe key={liveUrl} title={`Live page ${page}`} src={liveUrl} sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads" />
        ) : (
          <Empty text="Starting the app on a test database…" />
        )}
      </div>

      {view === "built" ? (
        <p className="muted">A drawing only: the page as Laptop B drew it, with the screenshots' sample data. Its buttons don't save anything. Choose Live to use the working app.</p>
      ) : (
        <p className="muted live-foot">
          The working app on a test database, started with the screenshots' rows: every button works, and what you change is saved there. It stops after 15 minutes without use, and its test data is deleted.{" "}
          <button className="btn btn-quiet" onClick={stopLive}>
            Stop the live app
          </button>
        </p>
      )}
    </div>
  );
}

export function Backend({ project, ready }) {
  const [files, setFiles] = useState(null);
  const [current, setCurrent] = useState("backend/server.js");
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ready) return;
    api.files(project.id).then((r) => setFiles(r.files), (e) => setError(e.message));
  }, [project.id, project.contract?.hash, ready]);

  useEffect(() => {
    if (!files) return;
    api.fileContent(project.id, current).then(setCode, (e) => setCode(`// ${e.message}`));
  }, [project.id, files, current]);

  if (!ready) return <Empty text="The backend appears here once it has been generated." />;
  if (error) return <Empty text={error} />;
  if (!files) return <Empty text="Loading files…" />;
  return (
    <div className="code-view">
      <ul className="file-list" aria-label="Generated files">
        {files.map((f) => (
          <li key={f.path}>
            <button className={`file${f.path === current ? " file-on" : ""}`} onClick={() => setCurrent(f.path)}>
              {f.path}
            </button>
          </li>
        ))}
      </ul>
      <pre className="code" aria-label={current}>
        <code>
          {code.split("\n").map((line, i) => (
            <span key={i} className="code-line">
              <span className="code-num" aria-hidden="true">
                {i + 1}
              </span>
              {line || " "}
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

export function Empty({ text }) {
  return <p className="empty">{text}</p>;
}
