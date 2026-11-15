import { useState } from "react";
import { apiRequest } from "./auth.js";

const fields = [
  ["observations", "Observations"],
  ["diagnostic_notes", "Diagnostic notes"],
  ["repair_steps", "Repair steps"],
];

export default function RepairNotes({ config, request, canWrite = false }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const path = `/requests/${encodeURIComponent(request.request_id)}/notes`;

  async function load() {
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest(config, path);
      setNotes(result.notes);
      setOpen(true);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function save(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const note = await apiRequest(config, path, {
        method: "POST",
        body: Object.fromEntries(fields.map(([key]) => [key, data.get(key)])),
      });
      setNotes((previous) => [note, ...previous].slice(0, 50));
      form.reset();
      setMessage("Repair work saved.");
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={`Repair work for ${request.item_name}`}>
      <button type="button" disabled={busy} onClick={load}>
        {open ? "Refresh repair notes" : "View repair notes"}
      </button>
      {open && (
        <>
          <h4>Repair notes (latest 50)</h4>
          {canWrite && ["Claimed", "In Progress"].includes(request.status) && (
            <form onSubmit={save}>
              <fieldset disabled={busy}>
                <legend>Record repair work</legend>
                <p>Fill in at least one field. Record what you observed or did.</p>
                {fields.map(([key, label]) => (
                  <p key={key}><label>{label}<br />
                    <textarea name={key} maxLength={2000} />
                  </label></p>
                ))}
                <button type="submit">Save repair work</button>
              </fieldset>
            </form>
          )}
          {!notes.length && <p>No repair notes yet.</p>}
          {notes.map((note) => (
            <article key={note.record_key}>
              <p>{new Date(note.created_at).toLocaleString()} — Volunteer: {note.author_id}</p>
              {fields.map(([key, label]) => note[key] && (
                <div key={key}><strong>{label}</strong>
                  <p style={{ whiteSpace: "pre-wrap" }}>{note[key]}</p>
                </div>
              ))}
            </article>
          ))}
        </>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
