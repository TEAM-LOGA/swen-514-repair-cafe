import { useEffect, useRef, useState } from "react";
import { apiRequest } from "./auth.js";
import RepairNotes from "./RepairNotes.jsx";
import { RequestStatusForm } from "./RepairRequests.jsx";

export default function VolunteerWork({ config }) {
  const [view, setView] = useState("available");
  const [requests, setRequests] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const generation = useRef(0);

  async function load(selected, page = null) {
    const current = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ view: selected });
      if (page) params.set("cursor", page);
      const result = await apiRequest(config, `/requests?${params}`);
      if (current !== generation.current) return;
      setRequests((previous) => page
        ? [...new Map([...previous, ...result.requests].map((r) => [r.request_id, r])).values()]
        : result.requests);
      setCursor(result.next_cursor);
    } catch (error) {
      if (current === generation.current) setError(error.message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }

  useEffect(() => {
    setRequests([]);
    setCursor(null);
    load(view);
    return () => { generation.current++; };
  }, [config, view]);

  async function assign(request, release) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest(config, `/requests/${encodeURIComponent(request.request_id)}/claim`, {
        method: release ? "DELETE" : "POST",
      });
      setRequests((previous) => previous.filter((r) => r.request_id !== request.request_id));
      setMessage(release ? "Request released. It is available to other volunteers." : "Request claimed. Open My assigned requests to record repair work.");
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="volunteer-heading">
      <h3 id="volunteer-heading">Volunteer repair work</h3>
      <p>Claim another person's request to help with the repair.</p>
      <label>Show{" "}
        <select value={view} disabled={busy} onChange={(event) => { setMessage(""); setView(event.target.value); }}>
          <option value="available">Available requests</option>
          <option value="assigned">My assigned requests</option>
        </select>
      </label>{" "}
      <button type="button" disabled={busy} onClick={() => load(view)}>Refresh</button>
      {busy && <p role="status">Loading…</p>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      {!busy && !error && !requests.length && <p>No requests in this view.</p>}
      <ul>
        {requests.map((request) => (
          <li key={request.request_id}>
            <strong>{request.item_name}</strong> — {request.status}
            <p>{request.description}</p>
            {view === "available" ? (
              <button type="button" disabled={busy} onClick={() => assign(request, false)}>Claim request</button>
            ) : (
              <>
                {["Claimed", "In Progress"].includes(request.status) && (
                  <button type="button" disabled={busy} onClick={() => assign(request, true)}>Release request</button>
                )}
                <RequestStatusForm config={config} request={request} onStatusChange={(id, status) =>
                  setRequests((previous) => previous.map((r) => r.request_id === id ? { ...r, status } : r))
                } />
                <RepairNotes config={config} request={request} canWrite />
              </>
            )}
          </li>
        ))}
      </ul>
      {cursor && <button type="button" disabled={busy} onClick={() => load(view, cursor)}>Load more requests</button>}
    </section>
  );
}
