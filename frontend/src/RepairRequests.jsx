import { useEffect, useRef, useState } from "react";
import { apiRequest } from "./auth.js";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 20; // ~1 minute total

async function prepareCameraPhoto(file) {
  if (file.type === "image/jpeg" && file.size <= MAX_FILE_BYTES) return file;

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();

    const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!jpeg) throw new Error("Could not encode photo.");
    return new File([jpeg], `${file.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`, { type: jpeg.type });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function RepairRequests({ config }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);

  // File upload state
  const [files, setFiles] = useState([]); // [{ file, status, error }]
  const cameraInputRef = useRef(null);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [cameraError, setCameraError] = useState("");

  // Per-request extraction results: { [request_id]: { status, text, error } }
  const [extractions, setExtractions] = useState({});
  const pollTimers = useRef({}); // request_id → { intervalId, attempts }

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

  // Clear all poll timers on unmount.
  useEffect(() => {
    return () => {
      Object.values(pollTimers.current).forEach(({ intervalId }) => clearInterval(intervalId));
    };
  }, []);

  function queueFiles(selected) {
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
  }

  function handleFileChange(event) {
    queueFiles(Array.from(event.target.files));
    event.target.value = "";
  }

  async function handleCameraChange(event) {
    const [photo] = event.target.files;
    event.target.value = "";
    if (!photo) return;

    setCameraError("");
    setPreparingPhoto(true);
    try {
      queueFiles([await prepareCameraPhoto(photo)]);
    } catch {
      setCameraError("Could not prepare the photo. Retake it or choose a JPEG file.");
    } finally {
      setPreparingPhoto(false);
    }
  }

  function removeFile(index) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  /** Upload one file to S3 via a presigned URL and return its file_id. */
  async function uploadFile(requestId, { file }) {
    const { file_id, upload_url } = await apiRequest(config, `/requests/${requestId}/uploads`, {
      method: "POST",
      body: { content_type: file.type, file_name: file.name },
    });
    const s3Response = await fetch(upload_url, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!s3Response.ok) throw new Error(`S3 upload failed (HTTP ${s3Response.status}).`);
    return file_id;
  }

  /** Start extraction workflow for one file_id and begin polling. */
  async function startExtraction(requestId, fileId) {
    setExtractions((prev) => ({
      ...prev,
      [requestId]: { status: "processing", text: null, error: null },
    }));

    let resultId;
    try {
      const { result_id } = await apiRequest(config, `/requests/${requestId}/extractions`, {
        method: "POST",
        body: { file_id: fileId },
      });
      resultId = result_id;
    } catch (err) {
      setExtractions((prev) => ({
        ...prev,
        [requestId]: { status: "error", text: null, error: err.message },
      }));
      return;
    }

    // Poll until complete, failed, or max attempts reached.
    let attempts = 0;
    const intervalId = setInterval(async () => {
      attempts++;
      try {
        const record = await apiRequest(
          config,
          `/requests/${requestId}/ai-results/${encodeURIComponent(resultId)}`
        );
        if (record.status === "complete") {
          clearInterval(intervalId);
          delete pollTimers.current[requestId];
          setExtractions((prev) => ({
            ...prev,
            [requestId]: { status: "complete", text: record.extracted_text, error: null },
          }));
        } else if (record.status === "failed") {
          clearInterval(intervalId);
          delete pollTimers.current[requestId];
          setExtractions((prev) => ({
            ...prev,
            [requestId]: { status: "error", text: null, error: "Extraction failed on the server." },
          }));
        } else if (attempts >= POLL_MAX_ATTEMPTS) {
          clearInterval(intervalId);
          delete pollTimers.current[requestId];
          setExtractions((prev) => ({
            ...prev,
            [requestId]: { status: "error", text: null, error: "Extraction timed out." },
          }));
        }
      } catch {
        // Ignore transient poll errors; keep trying until max attempts.
        if (attempts >= POLL_MAX_ATTEMPTS) {
          clearInterval(intervalId);
          delete pollTimers.current[requestId];
          setExtractions((prev) => ({
            ...prev,
            [requestId]: { status: "error", text: null, error: "Could not retrieve extraction result." },
          }));
        }
      }
    }, POLL_INTERVAL_MS);

    pollTimers.current[requestId] = { intervalId, attempts };
  }

  async function submitRequest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);

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
      let uploadedFileIds = [];
      if (readyFiles.length > 0) {
        setFiles((prev) => prev.map((f) => f.status === "ready" ? { ...f, status: "uploading" } : f));
        const results = await Promise.allSettled(
          readyFiles.map((entry) => uploadFile(request.request_id, entry))
        );
        const failures = [];
        results.forEach((r, i) => {
          if (r.status === "fulfilled") {
            uploadedFileIds.push(r.value);
          } else {
            failures.push(readyFiles[i].file.name);
          }
        });
        if (failures.length > 0) {
          setSaveError(`Request saved, but ${failures.length} file(s) failed to upload: ${failures.join(", ")}.`);
          setRequests((previous) => [request, ...previous].slice(0, 50));
          form.reset();
          setFiles([]);
          return;
        }
      }

      setRequests((previous) => [request, ...previous].slice(0, 50));
      form.reset();
      setFiles([]);
      setSaved(true);

      //Kick off extraction for the first successfully uploaded file (images/PDFs).
      //    If multiple files were uploaded, only extract the first one for now.
      if (uploadedFileIds.length > 0) {
        startExtraction(request.request_id, uploadedFileIds[0]);
      }
    } catch (error) {
      setSaveError(error instanceof TypeError ? "Could not reach the backend. Try again." : error.message);
    } finally {
      setSaving(false);
    }
  }

  const hasFiles = files.length > 0;
  const isBusy = loading || saving || preparingPhoto;

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

          <p>
            <label htmlFor="file-upload">Photos or documents (optional)</label><br />
            <small>JPEG, PNG, WebP, GIF, or PDF · max 10 MB each · text will be extracted automatically</small><br />
            <input
              id="file-upload"
              type="file"
              multiple
              accept={ALLOWED_TYPES.join(",")}
              onChange={handleFileChange}
              disabled={isBusy}
            />
            <button type="button" onClick={() => cameraInputRef.current.click()}>Take photo</button>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              ref={cameraInputRef}
              onChange={handleCameraChange}
              hidden
            />
          </p>
          {preparingPhoto && <p role="status">Preparing photo…</p>}
          {cameraError && <p role="alert">{cameraError}</p>}

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
          {requests.map((request) => {
            const extraction = extractions[request.request_id];
            return (
              <li key={request.request_id}>
                <strong>{request.item_name}</strong> — {request.status}
                <p>{request.description}</p>
                {extraction && (
                  <div aria-live="polite">
                    {extraction.status === "processing" && (
                      <p><small>⏳ Extracting text from uploaded file…</small></p>
                    )}
                    {extraction.status === "complete" && extraction.text && (
                      <details>
                        <summary><small>📄 Extracted text</small></summary>
                        <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.85em" }}>
                          {extraction.text}
                        </pre>
                      </details>
                    )}
                    {extraction.status === "error" && (
                      <p><small>⚠️ {extraction.error}</small></p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
