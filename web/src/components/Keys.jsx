// Step 31b: the workspace's own AI keys (BYOK) and its two slots. A key is checked with its provider when it
// is added; after that only its last 4 characters are ever shown.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { slotChoices } from "../keys.js";

const PROVIDERS = [
  ["gemini", "Google Gemini"],
  ["anthropic", "Anthropic"],
  ["openai", "OpenAI"],
  ["groq", "Groq"],
  ["openrouter", "OpenRouter"],
];
const SLOTS = [
  ["frontend", "Frontend: reading screenshots and drawing pages"],
  ["backend", "Backend: writing custom button code"],
];

export function Keys() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState({ provider: "gemini", apiKey: "", label: "" });
  const [busy, setBusy] = useState(false);

  const load = () => api.keys().then(setData, (err) => setError(err.message));
  useEffect(() => {
    load();
  }, []);

  const run = async (work) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const add = (e) => {
    e.preventDefault();
    run(async () => {
      await api.addKey(adding);
      setAdding((a) => ({ ...a, apiKey: "", label: "" })); // the key leaves the page once saved
    });
  };
  const choose = (slot, value) => run(() => api.setSlots({ [slot]: value ? { keyId: value.split("|")[0], model: value.split("|")[1] } : null }));

  if (!data) return <p className="empty">{error ?? "Loading…"}</p>;
  return (
    <section className="keys">
      <h1>Your AI keys</h1>
      <p className="muted">Builds use your own keys from these two slots. Keys are stored encrypted, and only their last 4 characters are ever shown.</p>
      {error && (
        <p className="sign-in-message" role="alert">
          {error}
        </p>
      )}
      {!data.vault && <p className="sign-in-message">Saving keys is switched off on this server (KEY_VAULT_SECRET is not set).</p>}

      <h2>Slots</h2>
      {SLOTS.map(([slot, label]) => {
        const current = data.slots[slot];
        const choices = slotChoices(data.models, data.keys, slot);
        return (
          <label key={slot} className="keys-slot">
            <span>{label}</span>
            <select value={current ? `${current.keyId}|${current.model}` : ""} disabled={busy} onChange={(e) => choose(slot, e.target.value)}>
              <option value="">None (the server's own models)</option>
              {choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        );
      })}

      <h2>Saved keys</h2>
      {data.keys.length === 0 ? (
        <p className="muted">No keys yet.</p>
      ) : (
        <ul className="keys-list">
          {data.keys.map((k) => (
            <li key={k.id}>
              <span>
                {k.label || k.provider} <span className="muted">({k.provider}, …{k.lastFour})</span>
              </span>
              <button type="button" className="sign-out" disabled={busy} onClick={() => run(() => api.deleteKey(k.id))}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2>Add a key</h2>
      <form className="keys-add" onSubmit={add}>
        <label>
          Provider
          <select value={adding.provider} onChange={(e) => setAdding({ ...adding, provider: e.target.value })}>
            {PROVIDERS.map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Key
          <input type="password" autoComplete="off" spellCheck="false" value={adding.apiKey} onChange={(e) => setAdding({ ...adding, apiKey: e.target.value })} required />
        </label>
        <label>
          Name (optional)
          <input type="text" maxLength={60} value={adding.label} onChange={(e) => setAdding({ ...adding, label: e.target.value })} />
        </label>
        <button className="btn" type="submit" disabled={busy || !data.vault}>
          {busy ? "Checking…" : "Check and save"}
        </button>
      </form>
    </section>
  );
}
