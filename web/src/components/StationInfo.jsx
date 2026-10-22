// "How it works" for the selected station, plus the live facts for this project.
import { CHECK_MARKS, LAYER_WORDS, STATIONS, STATUS_WORDS } from "../stations.js";

export function StationInfo({ id, project, status }) {
  const info = STATIONS[id];
  const s = status.stations[id];
  const facts = info.details(project, s).filter(([, value]) => value !== undefined && value !== null);

  return (
    <section className={`station-info station-info-${s.status}`} aria-live="polite">
      <header className="station-info-head">
        <h2>{info.title}</h2>
        <span className="station-where">{info.where}</span>
        <span className={`status-chip status-${s.status}`}>{STATUS_WORDS[s.status]}</span>
      </header>
      <div className="station-info-body">
        <div className="station-how">
          <h3>How it works</h3>
          {info.how.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        {facts.length > 0 && (
          <div className="station-facts">
            <h3>Your project</h3>
            <dl>
              {facts.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
      {s.status === "failed" && status.error && (
        <p className="station-error">
          <strong>What went wrong: </strong>
          {status.error}
        </p>
      )}
      {id === "verify" && s.checks?.length > 0 && <Report checks={s.checks} />}
    </section>
  );
}

// The Verifier's checks, problems first: what was tried, what happened, and which part to blame.
function Report({ checks }) {
  return (
    <div className="report">
      <h3>The checks</h3>
      <ul>
        {checks.map((c) => (
          <li key={c.id} className={`report-row report-${c.status}`}>
            <span className="report-mark" aria-label={c.status}>
              {CHECK_MARKS[c.status] ?? "?"}
            </span>
            <span className="report-text">
              <strong>{c.title}</strong>
              {c.page ? <span className="report-page">page {c.page}</span> : null}
              <span className="report-detail">{c.detail}</span>
              {c.layer && c.status === "fail" ? <span className="report-layer">To fix: {LAYER_WORDS[c.layer] ?? c.layer}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
