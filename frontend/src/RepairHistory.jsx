import { useEffect, useRef, useState } from "react";
import { apiRequest } from "./auth.js";
import RepairNotes from "./RepairNotes.jsx";
import OutcomeConfirmation from "./OutcomeConfirmation.jsx";

export default function RepairHistory({ config, isVolunteer }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [repairs, setRepairs] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(null);
  const filters = useRef({ q: "", status: "all" });

  async function load(page = null) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    if (!page) { setRepairs([]); setCursor(null); }
    try {
      const params = new URLSearchParams(filters.current);
      if (page) params.set("cursor", page);
      let result;
      // Filters can leave a page empty; continue until a match or the last page.
      do {
        result = await apiRequest(config, `/repair-history?${params}`, { signal: controller.signal });
        if (result.next_cursor) params.set("cursor", result.next_cursor);
      } while (!result.repairs.length && result.next_cursor && !controller.signal.aborted);
      if (controller.signal.aborted) return;
      setRepairs((previous) => {
        const all = page ? [...previous, ...result.repairs] : result.repairs;
        return [...new Map(all.map((entry) => [entry.request.request_id, entry])).values()];
      });
      setCursor(result.next_cursor);
    } catch (error) {
      if (!controller.signal.aborted) setError(error.message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  useEffect(() => {
    load();
    return () => pending.current?.abort();
  }, [config]);

  return (
    <section aria-labelledby="repair-history-heading">
      <h3 id="repair-history-heading">My repair history</h3>
      <p>{isVolunteer ? "Completed and unresolved repairs assigned to you." : "Your completed and unresolved repair requests."}</p>
      <form onSubmit={(event) => {
        event.preventDefault();
        filters.current = { q: search.trim(), status };
        load();
      }}>
        <label>Search item name or description{" "}
          <input type="search" value={search} maxLength={120} onChange={(event) => setSearch(event.target.value)} />
        </label>{" "}
        <label>Outcome{" "}
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">Completed and Unresolved</option>
            <option>Completed</option><option>Unresolved</option>
          </select>
        </label>{" "}
        <button type="submit">Search / refresh history</button>
      </form>
      {busy && <p role="status">Loading history…</p>}
      {error && <p role="alert">{error}</p>}
      {!busy && !error && !repairs.length && <p>No matching repair records.</p>}
      <ul>{repairs.map(({ request }) => (
        <li key={request.request_id}>
          <strong>{request.item_name}</strong> — {request.status}
          <p>{request.description}</p>
          <p>Submitted: {new Date(request.created_at).toLocaleString()}</p>
          <RepairNotes config={config} request={request} />
          <OutcomeConfirmation config={config} request={request} canConfirm={!isVolunteer} />
        </li>
      ))}</ul>
      {cursor && <button type="button" disabled={busy} onClick={() => load(cursor)}>Load more repair history</button>}
    </section>
  );
}
