import { useEffect, useState } from "react";
import { apiRequest } from "./auth.js";

export default function OutcomeConfirmation({ config, request, canConfirm = false }) {
  const [record, setRecord] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const path = `/requests/${encodeURIComponent(request.request_id)}`;
  const terminal = ["Completed", "Unresolved"].includes(request.status);

  useEffect(() => {
    setRecord(null);
    setError("");
    if (!terminal) return;
    const controller = new AbortController();
    apiRequest(config, `${path}/history`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setRecord(result); })
      .catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [config, path, request.status, request.updated_at, terminal]);

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      setRecord(await apiRequest(config, `${path}/confirmation`, {
        method: "POST",
        body: { status: record.request.status, outcome_version: record.outcome_version },
      }));
    } catch (error) {
      setRecord(null);
      setError(`${error.message} Refresh this page before trying again.`);
    } finally {
      setBusy(false);
    }
  }

  if (!terminal) return null;
  return (
    <section aria-label={`Outcome for ${request.item_name}`}>
      {record && record.request.status !== request.status ? (
        <p role="status">The repair status changed. Refresh to view the current outcome.</p>
      ) : record?.confirmation ? (
        <p role="status">Requester acknowledged {record.confirmation.status} on {new Date(record.confirmation.confirmed_at).toLocaleString()}.</p>
      ) : record && (
        <>
          <p>Outcome: {record.request.status}. Not yet acknowledged by the requester.</p>
          {canConfirm && (
            <><p>Review the repair notes before acknowledging the outcome. This does not certify that the item is safe.</p>
              <button type="button" disabled={busy} onClick={confirm}>
                {busy ? "Saving…" : `Acknowledge ${record.request.status} outcome`}
              </button>
            </>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
