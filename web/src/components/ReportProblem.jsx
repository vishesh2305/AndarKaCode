// Step 35: "Report a problem": what is wrong, and where it was seen. A reviewer reads every report.
import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { reportProblem } from "../report.js";

export function ReportProblem({ projectId, onClose }) {
  const [reason, setReason] = useState("");
  const [url, setUrl] = useState("");
  const [about, setAbout] = useState(Boolean(projectId));
  const [state, setState] = useState({ sending: false, error: null, sent: false });
  const dialog = useRef(null);

  useEffect(() => {
    dialog.current?.showModal?.();
  }, []);

  async function submit(event) {
    event.preventDefault();
    const report = reportProblem({ reason, url, projectId: about ? projectId : null });
    if (!report.ok) return setState({ sending: false, error: report.error, sent: false });
    setState({ sending: true, error: null, sent: false });
    try {
      await api.report(report.body);
      setState({ sending: false, error: null, sent: true });
    } catch (err) {
      setState({ sending: false, error: err.message, sent: false });
    }
  }

  return (
    <dialog ref={dialog} className="report-dialog" onClose={onClose} aria-labelledby="report-title">
      <form method="dialog" onSubmit={submit}>
        <h2 id="report-title">Report a problem</h2>
        {state.sent ? (
          <>
            <p role="status">Thank you. A person will read your report.</p>
            <div className="report-actions">
              <button type="button" className="btn" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="report-field">
              What is wrong?
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} maxLength={2000} required placeholder="For example: this copies my bank's login page" />
            </label>
            <label className="report-field">
              Where did you see it? (optional)
              <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            </label>
            {projectId && (
              <label className="report-check">
                <input type="checkbox" checked={about} onChange={(e) => setAbout(e.target.checked)} /> It is about the project open now
              </label>
            )}
            {state.error && (
              <p className="station-error" role="alert">
                {state.error}
              </p>
            )}
            <div className="report-actions">
              <button type="button" className="sign-out" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn" disabled={state.sending}>
                {state.sending ? "Sending…" : "Send report"}
              </button>
            </div>
          </>
        )}
      </form>
    </dialog>
  );
}
