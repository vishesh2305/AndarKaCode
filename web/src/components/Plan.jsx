// The Plan view: inspect and edit the App Spec derived from the screenshots.
// Users can tweak field types, add/remove fields, adjust enum options, and answer open questions.
// Clicking "Save & Rebuild" sends the updated spec to PUT /api/projects/:id/contract.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import {
  FIELD_TYPES,
  addField,
  isValidCamelCase,
  removeField,
  resolveOpenQuestion,
  toCamelCase,
  updateField,
  validateSpec,
} from "../spec-editor.js";

const ENDPOINT_WORDS = { list: "Show the list", get: "Open one", create: "Add", update: "Edit", delete: "Delete" };
const KIND_WORDS = { setStatus: "changes status", export: "downloads a CSV", custom: "not available yet" };

function Evidence({ text }) {
  return <span className="evidence">{text}</span>;
}

function Empty({ text }) {
  return <p className="muted empty-plan">{text}</p>;
}

export function Plan({ project, onSaved }) {
  const spec = project.contract?.body;
  const version = project.contract?.version ?? project.currentContractVersion ?? 1;

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState([]);
  const [successMsg, setSuccessMsg] = useState(null);

  // Per-entity draft state for adding a new field
  const [addingTo, setAddingTo] = useState(null); // entity.name or null
  const [newField, setNewField] = useState({ name: "", label: "", type: "string", options: "", required: false });

  // Sync draft when project.contract updates (unless currently editing)
  useEffect(() => {
    if (!isEditing && spec) {
      setDraft(structuredClone(spec));
    }
  }, [spec, isEditing]);

  if (!spec) return <Empty text="The plan appears once the screenshots have been read." />;

  const activeSpec = isEditing && draft ? draft : spec;
  const entityNames = (activeSpec.entities ?? []).map((e) => e.name);

  function startEditing() {
    setDraft(structuredClone(spec));
    setProblems([]);
    setSuccessMsg(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    setDraft(structuredClone(spec));
    setProblems([]);
    setAddingTo(null);
    setIsEditing(false);
  }

  function handleFieldTypeChange(entityName, fieldName, newType) {
    setDraft((prev) => updateField(prev, entityName, fieldName, { type: newType }));
  }

  function handleFieldOptionsChange(entityName, fieldName, optionsString) {
    setDraft((prev) => updateField(prev, entityName, fieldName, { optionsString }));
  }

  function handleFieldRefChange(entityName, fieldName, targetRef) {
    setDraft((prev) => updateField(prev, entityName, fieldName, { ref: targetRef }));
  }

  function handleFieldRequiredToggle(entityName, fieldName, currentRequired) {
    setDraft((prev) => updateField(prev, entityName, fieldName, { required: !currentRequired }));
  }

  function handleFieldNameChange(entityName, fieldName, newName) {
    setDraft((prev) => {
      const next = structuredClone(prev);
      const entity = next.entities.find((e) => e.name === entityName);
      const field = entity?.fields.find((f) => f.name === fieldName);
      if (field) {
        field.name = newName;
      }
      return next;
    });
  }

  function handleFieldLabelChange(entityName, fieldName, newLabel) {
    setDraft((prev) => {
      const next = structuredClone(prev);
      const entity = next.entities.find((e) => e.name === entityName);
      const field = entity?.fields.find((f) => f.name === fieldName);
      if (field) {
        field.label = newLabel;
      }
      return next;
    });
  }

  function handleRemoveField(entityName, fieldName) {
    setDraft((prev) => removeField(prev, entityName, fieldName));
  }

  function handleStartAddField(entityName) {
    setAddingTo(entityName);
    setNewField({ name: "", label: "", type: "string", options: "", required: false });
  }

  function handleCommitAddField(entityName) {
    if (!newField.name.trim()) return;
    setDraft((prev) =>
      addField(prev, entityName, {
        name: newField.name,
        label: newField.label || newField.name,
        type: newField.type,
        optionsString: newField.options,
        required: newField.required,
      })
    );
    setAddingTo(null);
    setNewField({ name: "", label: "", type: "string", options: "", required: false });
  }

  function handleAnswerQuestion(idx, answerText, choice) {
    // If not in editing mode, enter edit mode with current spec
    const base = isEditing && draft ? draft : structuredClone(spec);
    const updated = resolveOpenQuestion(base, idx, answerText, choice);
    setDraft(updated);
    if (!isEditing) setIsEditing(true);
  }

  async function handleSave() {
    setProblems([]);
    setSuccessMsg(null);

    // Client-side pre-validation
    const validationIssues = validateSpec(draft);
    if (validationIssues.length) {
      setProblems(validationIssues);
      return;
    }

    setSaving(true);
    try {
      const res = await api.updateContract(project.id, draft);
      setSaving(false);
      setIsEditing(false);
      setAddingTo(null);

      if (res.changed) {
        setSuccessMsg(`Spec saved! Building version v${res.contract.version}...`);
      } else {
        setSuccessMsg("No changes detected in App Spec.");
      }

      if (onSaved) onSaved(res);
    } catch (err) {
      setSaving(false);
      const msg = err.message || "Failed to update spec";
      setProblems([msg]);
    }
  }

  return (
    <div className="plan">
      {/* Top toolbar */}
      <div className="plan-header-bar">
        <div>
          <span className="spec-version-badge">Spec v{version}</span>
          {isEditing && <span className="spec-editing-pill">Editing mode</span>}
        </div>
        <div className="plan-actions-bar">
          {!isEditing ? (
            <button type="button" className="btn btn-quiet" onClick={startEditing}>
              ✏️ Edit plan
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-quiet" onClick={cancelEditing} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn btn-go" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save & Rebuild"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Notifications / Alerts */}
      {problems.length > 0 && (
        <div className="plan-alert plan-alert-error" role="alert">
          <strong>Cannot save plan:</strong>
          <ul>
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {successMsg && (
        <div className="plan-alert plan-alert-success" role="status">
          {successMsg}
        </div>
      )}

      {isEditing && (
        <div className="plan-edit-guide">
          💡 You can adjust field types, edit select options, add or remove fields, or resolve open questions below.
          Click <strong>“Save & Rebuild”</strong> to update the spec and trigger a fresh build.
        </div>
      )}

      {/* Entities */}
      {activeSpec.entities.map((e) => (
        <article key={e.name} className="plan-entity">
          <h3>
            {e.label} <code>/api/{e.plural}</code>
          </h3>

          <table className="plan-fields">
            <thead>
              <tr>
                <th scope="col" style={{ width: isEditing ? "28%" : "30%" }}>
                  Field
                </th>
                <th scope="col" style={{ width: isEditing ? "22%" : "30%" }}>
                  Type
                </th>
                <th scope="col" style={{ width: isEditing ? "32%" : "40%" }}>
                  {isEditing ? "Options / Details" : "Why it exists"}
                </th>
                {isEditing && (
                  <th scope="col" style={{ width: "10%" }}>
                    Req?
                  </th>
                )}
                {isEditing && (
                  <th scope="col" style={{ width: "8%", textAlign: "center" }}>
                    Action
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {e.fields.map((f) => (
                <tr key={f.name}>
                  {/* Field name and label */}
                  <td>
                    {!isEditing ? (
                      <>
                        <code>{f.name}</code>
                        {f.required && <span className="required">required</span>}
                      </>
                    ) : (
                      <div className="plan-field-name-edit">
                        <input
                          type="text"
                          className="plan-input plan-input-name"
                          value={f.name}
                          onChange={(ev) => handleFieldNameChange(e.name, f.name, ev.target.value)}
                          placeholder="fieldName"
                          title="Field name (camelCase)"
                        />
                        {!isValidCamelCase(f.name) && (
                          <span className="field-warn" title="Should be camelCase">
                            ⚠️ camelCase
                          </span>
                        )}
                      </div>
                    )}
                  </td>

                  {/* Field type */}
                  <td>
                    {!isEditing ? (
                      f.type === "enum" ? (
                        `one of ${(f.options || []).join(", ")}`
                      ) : f.type === "ref" ? (
                        `link to ${f.ref}`
                      ) : (
                        f.type
                      )
                    ) : (
                      <select
                        className="plan-select"
                        value={f.type}
                        onChange={(ev) => handleFieldTypeChange(e.name, f.name, ev.target.value)}
                      >
                        {FIELD_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>

                  {/* Options, ref, or evidence */}
                  <td>
                    {!isEditing ? (
                      <Evidence text={f.evidence} />
                    ) : f.type === "enum" ? (
                      <div className="plan-options-edit">
                        <input
                          type="text"
                          className="plan-input"
                          placeholder="Option 1, Option 2, …"
                          value={(f.options || []).join(", ")}
                          onChange={(ev) => handleFieldOptionsChange(e.name, f.name, ev.target.value)}
                        />
                        <span className="muted-hint">Comma-separated choices</span>
                      </div>
                    ) : f.type === "ref" ? (
                      <select
                        className="plan-select"
                        value={f.ref || ""}
                        onChange={(ev) => handleFieldRefChange(e.name, f.name, ev.target.value)}
                      >
                        {entityNames.map((n) => (
                          <option key={n} value={n}>
                            link to {n}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Evidence text={f.evidence} />
                    )}
                  </td>

                  {/* Required checkbox (edit mode only) */}
                  {isEditing && (
                    <td style={{ verticalAlign: "middle" }}>
                      <label className="plan-checkbox-label">
                        <input
                          type="checkbox"
                          checked={Boolean(f.required)}
                          onChange={() => handleFieldRequiredToggle(e.name, f.name, f.required)}
                        />
                      </label>
                    </td>
                  )}

                  {/* Action: remove field (edit mode only) */}
                  {isEditing && (
                    <td style={{ textAlign: "center", verticalAlign: "middle" }}>
                      <button
                        type="button"
                        className="icon-btn icon-btn-delete"
                        title={`Remove field "${f.name}"`}
                        onClick={() => handleRemoveField(e.name, f.name)}
                      >
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Add Field Inline Form */}
          {isEditing && (
            <div className="plan-add-field-wrap">
              {addingTo === e.name ? (
                <div className="plan-add-field-form">
                  <h4>Add field to {e.label}</h4>
                  <div className="plan-add-grid">
                    <div>
                      <label>Field name</label>
                      <input
                        type="text"
                        className="plan-input"
                        placeholder="e.g. phoneNumber"
                        value={newField.name}
                        onChange={(ev) =>
                          setNewField((prev) => ({
                            ...prev,
                            name: ev.target.value,
                            label: prev.label || ev.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label>Type</label>
                      <select
                        className="plan-select"
                        value={newField.type}
                        onChange={(ev) => setNewField((prev) => ({ ...prev, type: ev.target.value }))}
                      >
                        {FIELD_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                    {newField.type === "enum" && (
                      <div className="grid-full">
                        <label>Options (comma-separated)</label>
                        <input
                          type="text"
                          className="plan-input"
                          placeholder="e.g. Active, Pending, Inactive"
                          value={newField.options}
                          onChange={(ev) => setNewField((prev) => ({ ...prev, options: ev.target.value }))}
                        />
                      </div>
                    )}
                    <div>
                      <label className="checkbox-wrap">
                        <input
                          type="checkbox"
                          checked={newField.required}
                          onChange={(ev) => setNewField((prev) => ({ ...prev, required: ev.target.checked }))}
                        />
                        <span>Required field</span>
                      </label>
                    </div>
                  </div>
                  <div className="plan-add-actions">
                    <button type="button" className="btn btn-quiet" onClick={() => setAddingTo(null)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-go btn-small"
                      onClick={() => handleCommitAddField(e.name)}
                      disabled={!newField.name.trim()}
                    >
                      + Add field
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn btn-quiet btn-small" onClick={() => handleStartAddField(e.name)}>
                  + Add field
                </button>
              )}
            </div>
          )}

          {/* Endpoints & Operations */}
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
            {activeSpec.operations
              .filter((o) => o.entity === e.name)
              .map((o) => (
                <li key={o.name}>
                  <strong>“{o.button}”</strong> {KIND_WORDS[o.kind]} <Evidence text={o.evidence} />
                </li>
              ))}
          </ul>
        </article>
      ))}

      {/* Number cards */}
      {activeSpec.stats.length > 0 && (
        <article className="plan-entity">
          <h3>Number cards</h3>
          <ul className="plan-actions">
            {activeSpec.stats.map((s) => (
              <li key={s.label}>
                <strong>{s.label}</strong>{" "}
                {s.metric === "custom" ? "(how to calculate it is an open question)" : `(${s.metric})`}{" "}
                <Evidence text={s.evidence} />
              </li>
            ))}
          </ul>
        </article>
      )}

      {/* Login */}
      <article className="plan-entity">
        <h3>Login</h3>
        {activeSpec.auth ? (
          <ul className="plan-actions">
            <li>
              <strong>Log in</strong> <Evidence text={activeSpec.auth.login.evidence} />
            </li>
            {activeSpec.auth.signup && (
              <li>
                <strong>Sign up</strong> <Evidence text={activeSpec.auth.signup.evidence} />
              </li>
            )}
            {activeSpec.auth.me && (
              <li>
                <strong>Current user and log out</strong> <Evidence text={activeSpec.auth.me.evidence} />
              </li>
            )}
          </ul>
        ) : (
          <p className="muted">No login screen in the screenshots, so the app has no login.</p>
        )}
      </article>

      {/* Open questions */}
      {activeSpec.openQuestions.length > 0 && (
        <article className="plan-entity plan-questions">
          <h3>Open questions</h3>
          <div className="plan-questions-list">
            {activeSpec.openQuestions.map((q, i) => (
              <div key={i} className={`plan-question-card${q.resolved ? " question-resolved" : ""}`}>
                <div className="question-text">
                  <strong>Question {i + 1}:</strong> {q.question}
                </div>

                {q.resolved ? (
                  <div className="question-answered">
                    <span className="answered-pill">✓ Resolved: {q.answer}</span>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => handleAnswerQuestion(i, "", "string")}
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="question-choices">
                    <span className="choices-hint">Quick choices:</span>
                    {q.entity && q.field ? (
                      <div className="choice-buttons">
                        <button
                          type="button"
                          className="chip"
                          onClick={() => handleAnswerQuestion(i, "Fixed list (options)", "enum")}
                        >
                          Fixed list (enum)
                        </button>
                        <button
                          type="button"
                          className="chip"
                          onClick={() => handleAnswerQuestion(i, "Data on its own page (relation)", "ref")}
                        >
                          Managed relation (ref)
                        </button>
                        <button
                          type="button"
                          className="chip"
                          onClick={() => handleAnswerQuestion(i, "Free text", "string")}
                        >
                          Free text (string)
                        </button>
                      </div>
                    ) : (
                      <div className="choice-buttons">
                        <button
                          type="button"
                          className="chip"
                          onClick={() => handleAnswerQuestion(i, "Count records", "count")}
                        >
                          Count records
                        </button>
                        <button
                          type="button"
                          className="chip"
                          onClick={() => handleAnswerQuestion(i, "Sum values", "sum")}
                        >
                          Sum values
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </article>
      )}
    </div>
  );
}
