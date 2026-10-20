// Drop screenshots (page order = drop order), name the app, pick where the AI runs, build.
import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

const MODES = [
  { id: "local", label: "Local", hint: "Free, runs on your two laptops" },
  { id: "cloud", label: "Cloud", hint: "Fastest, uses Gemini" },
  { id: "auto", label: "Auto", hint: "Local first, cloud if it fails" },
];
const ACCEPT = ["image/png", "image/jpeg", "image/webp"];

export function NewProject({ onCreated }) {
  const [files, setFiles] = useState([]); // [{ file, url }] in page order
  const [name, setName] = useState("");
  const [mode, setMode] = useState("local");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const input = useRef(null);
  const latest = useRef(files);
  latest.current = files;

  // Thumbnails use object URLs; release them when the form goes away.
  useEffect(() => () => latest.current.forEach(({ url }) => URL.revokeObjectURL(url)), []);

  function add(list) {
    const images = [...list].filter((f) => ACCEPT.includes(f.type));
    if (images.length < list.length) setError("Only PNG, JPEG or WebP screenshots can be used.");
    else setError(null);
    const added = images.map((file) => ({ file, url: URL.createObjectURL(file) }));
    setFiles((current) => [...current, ...added].slice(0, 10));
  }

  async function build() {
    setBusy(true);
    setError(null);
    try {
      const project = await api.create(files.map((f) => f.file), { name: name.trim(), mode });
      onCreated(project.id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const move = (i, by) =>
    setFiles((current) => {
      const next = [...current];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });

  return (
    <section className="new-project">
      <h1>Turn screenshots into a working app</h1>
      <p className="lead">Drop one screenshot per page. You'll get pages that look like them, plus a backend that does exactly what they show.</p>

      <div
        className={`dropzone${dragging ? " dropzone-over" : ""}`}
        onDragOver={(e) => (e.preventDefault(), setDragging(true))}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => (e.preventDefault(), setDragging(false), add(e.dataTransfer.files))}
      >
        <svg className="dropzone-mascot" viewBox="-30 -26 60 52" aria-hidden="true">
          <rect x="-24" y="-20" width="48" height="40" rx="16" />
          <circle cx="-8" cy="-3" r="3.4" />
          <circle cx="8" cy="-3" r="3.4" />
          <path d="M-7 8 Q0 13 7 8" />
        </svg>
        <p className="dropzone-text">Drop screenshots here</p>
        <button className="btn btn-quiet" onClick={() => input.current.click()}>
          Choose files
        </button>
        <input ref={input} type="file" accept={ACCEPT.join(",")} multiple hidden onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
      </div>

      {files.length > 0 && (
        <ol className="picked">
          {files.map(({ file, url }, i) => (
            <li key={url} className="picked-item">
              <img src={url} alt="" />
              <span className="picked-page">Page {i + 1}</span>
              <span className="picked-name">{file.name}</span>
              <span className="picked-actions">
                <button className="icon-btn" aria-label={`Move ${file.name} earlier`} disabled={i === 0} onClick={() => move(i, -1)}>
                  ‹
                </button>
                <button className="icon-btn" aria-label={`Move ${file.name} later`} disabled={i === files.length - 1} onClick={() => move(i, 1)}>
                  ›
                </button>
                <button className="icon-btn" aria-label={`Remove ${file.name}`} onClick={() => (URL.revokeObjectURL(url), setFiles(files.filter((_, j) => j !== i)))}>
                  ×
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="form-row">
        <label className="field">
          <span>App name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Staff Directory" maxLength={100} />
        </label>
        <fieldset className="modes">
          <legend>Where the AI runs</legend>
          {MODES.map((m) => (
            <label key={m.id} className={`mode${mode === m.id ? " mode-on" : ""}`}>
              <input type="radio" name="mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} />
              <strong>{m.label}</strong>
              <small>{m.hint}</small>
            </label>
          ))}
        </fieldset>
      </div>

      {error && <p className="form-error">{error}</p>}
      <button className="btn btn-go" disabled={!files.length || busy} onClick={build}>
        {busy ? "Uploading…" : `Build my app from ${files.length || "the"} screenshot${files.length === 1 ? "" : "s"}`}
      </button>
    </section>
  );
}
