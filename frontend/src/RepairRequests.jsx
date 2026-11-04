import { useEffect, useRef, useState } from "react";
import { apiRequest } from "./auth.js";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

export default function RepairRequests({ config }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);

  // File upload state
  const [files, setFiles] = useState([]); // [{ file, status, error }]
  const fileInputRef = useRef(null);

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

  function handleFileChange(event) {
    const selected = Array.from(event.target.files);
    const validated = selected.map((file) => {
      if (!ALLOWED_TYPES.includes(file.type)) {
        return { file, status: "error", error: `Unsupported type: ${file.type || "unknown"}` };
      }
      if (file.size > MAX_FILE_BYTES) {
        return { file, status: "error", error: `Too large (max 10 MB)` };
      }
      return { file, status: "ready", error: null };
    });
    setFiles((prev) => [...prev, ...validated]);
    // Reset the input so the same file can be re-added after removal.
    event.target.value = "";
  }

  function removeFile(index) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  /** Upload a single file to S3 via a presigned URL returned by the backend. */
  async function uploadFile(requestId, { file }) {
    const { upload_url } = await apiRequest(config, `/requests/${requestId}/uploads`, {
      method: "POST",
      body: { content_type: file.type, file_name: file.name },
    });
    // PUT directly to S3 — no Authorization header, just the content type.
    const s3Response = await fetch(upload_url, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!s3Response.ok) {
      throw new Error(`S3 upload failed (HTTP ${s3Response.status}).`);
    }
  }

  async function submitRequest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);

    // Block submission if any file has a validation error.
    const invalidFiles = files.filter((f) => f.status === "error");
    if (invalidFiles.length > 0) {
      setSaveError("Remove invalid files before submitting.");
      return;
    }

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

      // Upload each selected file (in parallel, capped failures reported).
      const readyFiles = files.filter((f) => f.status === "ready");
      if (readyFiles.length > 0) {
        setFiles((prev) => prev.map((f) => f.status === "ready" ? { ...f, status: "uploading" } : f));
        const results = await Promise.allSettled(
          readyFiles.map((entry) => uploadFile(request.request_id, entry))
        );
        const failures = results
          .map((r, i) => r.status === "rejected" ? readyFiles[i].file.name : null)
          .filter(Boolean);
        if (failures.length > 0) {
          setSaveError(`Request saved, but ${failures.length} file(s) failed to upload: ${failures.join(", ")}.`);
          setRequests((previous) => [request, ...previous].slice(0, 50));
          form.reset();
          setFiles([]);
          return; // show only the error banner, not the success banner
        }
      }

      setRequests((previous) => [request, ...previous].slice(0, 50));
      form.reset();
      setFiles([]);
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof TypeError ? "Could not reach the backend. Try again." : error.message);
    } finally {
      setSaving(false);
    }
  }

  const hasFiles = files.length > 0;
  const isBusy = loading || saving;

  return (
    <section aria-labelledby="requests-heading">
      <h3 id="requests-heading">My repair requests</h3>
      <form onSubmit={submitRequest}>
        <fieldset disabled={isBusy}>
          <legend>Submit a repair request</legend>
          <p><label htmlFor="item-name">Item name</label><br />
            <input id="item-name" name="item_name" maxLength={120} required /></p>
          <p><label htmlFor="description">Problem description</label><br />
            <textarea id="description" name="description" maxLength={2000} required /></p>

          {/* File upload */}
          <p>
            <label htmlFor="file-upload">Photos or documents (optional)</label><br />
            <small>JPEG, PNG, WebP, GIF, or PDF · max 10 MB each</small><br />
            <input
              id="file-upload"
              type="file"
              multiple
              accept={ALLOWED_TYPES.join(",")}
              ref={fileInputRef}
              onChange={handleFileChange}
              disabled={isBusy}
            />
          </p>

          {hasFiles && (
            <ul aria-label="Selected files">
              {files.map(({ file, status, error }, index) => (
                <li key={`${file.name}-${index}`}>
                  <span>
                    {status === "uploading" && "⏳ "}
                    {status === "error" && "⚠️ "}
                    {status === "ready" && "📎 "}
                    {file.name}
                    {error && <> — <em>{error}</em></>}
                  </span>
                  {status !== "uploading" && (
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      aria-label={`Remove ${file.name}`}
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

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
