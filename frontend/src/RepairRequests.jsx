import { useEffect, useState } from "react";
import { apiRequest } from "./auth.js";

export default function RepairRequests({ config }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest(config, "/requests", { signal: controller.signal })
      .then(({ requests }) => setRequests(requests))
      .catch(() => {
        if (!controller.signal.aborted) setLoadError("Could not load your requests. Refresh to try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [config]);

  async function submitRequest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setSaving(true);
    setSaveError("");
    setSaved(false);
    try {
      const request = await apiRequest(config, "/requests", {
        method: "POST",
        body: {
          item_name: fields.get("item_name"),
          description: fields.get("description"),
        },
      });
      // Show the saved response immediately while the DynamoDB index catches up.
      setRequests((previous) => [request, ...previous].slice(0, 50));
      form.reset();
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof TypeError ? "Could not reach the backend. Try again." : error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="requests-heading">
      <h3 id="requests-heading">My repair requests</h3>
      <form onSubmit={submitRequest}>
        <fieldset disabled={loading || saving}>
          <legend>Submit a repair request</legend>
          <p><label htmlFor="item-name">Item name</label><br />
            <input id="item-name" name="item_name" maxLength={120} required /></p>
          <p><label htmlFor="description">Problem description</label><br />
            <textarea id="description" name="description" maxLength={2000} required /></p>
          <button type="submit">{saving ? "Submitting…" : "Submit request"}</button>
        </fieldset>
      </form>
      {saveError && <p role="alert">{saveError}</p>}
      {saved && <p role="status">Repair request submitted.</p>}
      {loading && <p role="status">Loading requests…</p>}
      {loadError && <p role="alert">{loadError}</p>}
      {!loading && !loadError && !requests.length && <p>No repair requests yet.</p>}
      {requests.length > 0 && (
        <ul>
          {requests.map((request) => (
            <li key={request.request_id}>
              <strong>{request.item_name}</strong> — {request.status}
              <p>{request.description}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
