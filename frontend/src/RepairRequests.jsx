import OutcomeConfirmation from "./OutcomeConfirmation.jsx";
import { useEffect, useRef, useState } from "react";
import RepairNotes from "./RepairNotes.jsx";
import { apiRequest } from "./auth.js";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 20; // ~1 minute total

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

  // Per-request extraction results: { [request_id]: { status, text, lines, confidences, avgConfidence, error } }
  const [extractions, setExtractions] = useState({});
  const pollTimers = useRef({}); // request_id → { intervalId, attempts }
  const [editingText, setEditingText] = useState({}); // { [requestId]: string }
  const [savingEdit, setSavingEdit] = useState({}); // { [requestId]: boolean }
  const [editError, setEditError] = useState({}); // { [requestId]: string }
  const [copiedId, setCopiedId] = useState(null);

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
      [requestId]: { status: "processing", text: null, lines: null, confidences: null, avgConfidence: null, error: null },
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
        [requestId]: { status: "error", text: null, lines: null, confidences: null, avgConfidence: null, error: err.message },
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
            [requestId]: {
              status: "complete",
              resultId: resultId,
              text: record.extracted_text,
              lines: record.lines || [],
              confidences: record.confidences || [],
              avgConfidence: record.avg_confidence ?? null,
              userCorrected: Boolean(record.user_corrected),
              needsReview: Boolean(record.needs_review),
              error: null,
            },
          }));
        } else if (record.status === "failed") {
          clearInterval(intervalId);
          delete pollTimers.current[requestId];
          setExtractions((prev) => ({
            ...prev,
            [requestId]: { status: "error", text: null, lines: null, confidences: null, avgConfidence: null, error: "Extraction failed on the server." },
          }));
        } else if (attempts >= POLL_MAX_ATTEMPTS) {
          clearInterval(intervalId);
          delete pollTimers.current[requestId];
          setExtractions((prev) => ({
            ...prev,
            [requestId]: { status: "error", text: null, lines: null, confidences: null, avgConfidence: null, error: "Extraction timed out." },
          }));
        }
      } catch {
        // Ignore transient poll errors; keep trying until max attempts.
        if (attempts >= POLL_MAX_ATTEMPTS) {
          clearInterval(intervalId);
          delete pollTimers.current[requestId];
          setExtractions((prev) => ({
            ...prev,
            [requestId]: { status: "error", text: null, lines: null, confidences: null, avgConfidence: null, error: "Could not retrieve extraction result." },
          }));
        }
      }
    }, POLL_INTERVAL_MS);

    pollTimers.current[requestId] = { intervalId, attempts };
  }

  async function saveCorrection(requestId, resultId) {
    const text = editingText[requestId];
    if (typeof text !== "string" || !text.trim()) return;

    setSavingEdit((prev) => ({ ...prev, [requestId]: true }));
    setEditError((prev) => ({ ...prev, [requestId]: "" }));

    try {
      const response = await apiRequest(
        config,
        `/requests/${requestId}/ai-results/${encodeURIComponent(resultId)}`,
        {
          method: "PATCH",
          body: { corrected_text: text.trim() },
        }
      );

      setExtractions((prev) => ({
        ...prev,
        [requestId]: {
          ...prev[requestId],
          text: response.extracted_text,
          lines: response.lines || response.extracted_text.split("\n"),
          userCorrected: true,
          needsReview: false,
        },
      }));
      setEditingText((prev) => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
    } catch (err) {
      setEditError((prev) => ({
        ...prev,
        [requestId]: err.message || "Could not save corrections.",
      }));
    } finally {
      setSavingEdit((prev) => ({ ...prev, [requestId]: false }));
    }
  }

  async function copyText(requestId, text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(requestId);
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      // Fallback if clipboard API is not available
    }
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
                <RepairNotes config={config} request={request} />
                <OutcomeConfirmation config={config} request={request} canConfirm />
                {extraction && (
                  <div aria-live="polite">
                    {extraction.status === "processing" && (
                      <p><small>⏳ Extracting text from uploaded file…</small></p>
                    )}
                    {extraction.status === "complete" && (
                      extraction.text ? (
                        <details open={extraction.avgConfidence != null && extraction.avgConfidence < 70 ? true : undefined}>
                          <summary>
                            <small>📄 Extracted text</small>
                            {extraction.avgConfidence != null && (
                              <small> — <ConfidenceBadge value={extraction.avgConfidence} label="overall" /></small>
                            )}
                            {extraction.userCorrected && (
                              <small style={{ marginLeft: "0.5em", color: "#27ae60", fontWeight: 600 }}>✓ Corrected</small>
                            )}
                            {!extraction.userCorrected && extraction.avgConfidence != null && extraction.avgConfidence < 70 && (
                              <small style={{ marginLeft: "0.5em", color: "#c0392b", fontWeight: 600 }}>⚠️ Needs review</small>
                            )}
                          </summary>

                          {/* Low confidence advisory banner */}
                          {!extraction.userCorrected && extraction.avgConfidence != null && extraction.avgConfidence < 70 && (
                            <div
                              role="alert"
                              style={{
                                padding: "0.5em 0.75em",
                                margin: "0.5em 0",
                                backgroundColor: extraction.avgConfidence < 50 ? "#fff1f0" : "#fffbe6",
                                border: `1px solid ${extraction.avgConfidence < 50 ? "#ffa39e" : "#ffe58f"}`,
                                borderRadius: "4px",
                                fontSize: "0.85em",
                                color: extraction.avgConfidence < 50 ? "#a8071a" : "#874d00",
                              }}
                            >
                              <strong>
                                {extraction.avgConfidence < 50
                                  ? "⚠️ Very Low Confidence Scan (< 50%)"
                                  : "⚠️ Low Confidence Scan (< 70%)"}
                              </strong>
                              <p style={{ margin: "0.25em 0" }}>
                                {extraction.avgConfidence < 50
                                  ? "Textract had trouble reading this image clearly. Characters, serial numbers, or model names are likely inaccurate."
                                  : "Some text was difficult to recognize due to blur, lighting, or angle. Please verify the flagged lines."}
                              </p>
                              <div style={{ display: "flex", gap: "0.75em", flexWrap: "wrap", marginTop: "0.35em", alignItems: "center" }}>
                                <span>💡 <em>Tip: Flat, well-lit, close-up photos without glare yield the best results.</em></span>
                                {editingText[request.request_id] === undefined && extraction.resultId && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditingText((prev) => ({
                                        ...prev,
                                        [request.request_id]: extraction.text,
                                      }))
                                    }
                                    style={{ fontSize: "0.85em", padding: "0.2em 0.5em", cursor: "pointer" }}
                                  >
                                    ✏️ Correct text
                                  </button>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Inline edit form OR Display list */}
                          {editingText[request.request_id] !== undefined ? (
                            <div style={{ margin: "0.5em 0", padding: "0.6em", background: "#f8f9fa", borderRadius: "4px", border: "1px solid #ddd" }}>
                              <label htmlFor={`edit-${request.request_id}`} style={{ display: "block", fontSize: "0.85em", fontWeight: 600, marginBottom: "0.3em" }}>
                                Edit extracted text:
                              </label>
                              <textarea
                                id={`edit-${request.request_id}`}
                                rows={Math.min(10, Math.max(3, (editingText[request.request_id] || "").split("\n").length + 1))}
                                value={editingText[request.request_id]}
                                onChange={(e) =>
                                  setEditingText((prev) => ({
                                    ...prev,
                                    [request.request_id]: e.target.value,
                                  }))
                                }
                                disabled={savingEdit[request.request_id]}
                                style={{ width: "100%", boxSizing: "border-box", fontSize: "0.85em", fontFamily: "monospace", padding: "0.4em" }}
                              />
                              {editError[request.request_id] && (
                                <p role="alert" style={{ color: "#c0392b", fontSize: "0.8em", margin: "0.3em 0" }}>
                                  {editError[request.request_id]}
                                </p>
                              )}
                              <div style={{ display: "flex", gap: "0.5em", marginTop: "0.4em" }}>
                                <button
                                  type="button"
                                  onClick={() => saveCorrection(request.request_id, extraction.resultId)}
                                  disabled={savingEdit[request.request_id]}
                                  style={{ fontSize: "0.85em", padding: "0.3em 0.8em" }}
                                >
                                  {savingEdit[request.request_id] ? "Saving…" : "Save correction"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditingText((prev) => {
                                      const next = { ...prev };
                                      delete next[request.request_id];
                                      return next;
                                    })
                                  }
                                  disabled={savingEdit[request.request_id]}
                                  style={{ fontSize: "0.85em", padding: "0.3em 0.8em" }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              {extraction.lines && extraction.lines.length > 0 ? (
                                <ul style={{ listStyle: "none", padding: 0, margin: "0.5em 0", fontSize: "0.85em" }}>
                                  {extraction.lines.map((line, i) => {
                                    const conf = extraction.confidences?.[i];
                                    const isLineVeryLow = conf != null && conf < 50;
                                    const isLineLow = conf != null && conf < 70;
                                    return (
                                      <li
                                        key={i}
                                        style={{
                                          padding: "0.25em 0.4em",
                                          margin: "0.15em 0",
                                          borderRadius: "3px",
                                          backgroundColor: isLineVeryLow ? "#fff1f0" : isLineLow ? "#fffbe6" : "transparent",
                                          borderLeft: isLineLow ? `3px solid ${isLineVeryLow ? "#f5222d" : "#faad14"}` : "none",
                                          borderBottom: isLineLow ? "none" : "1px solid #eee",
                                          display: "flex",
                                          justifyContent: "space-between",
                                          alignItems: "center",
                                          gap: "0.5em",
                                        }}
                                      >
                                        <span style={{ wordBreak: "break-word" }}>
                                          {isLineLow && (
                                            <span title={`Uncertain line (${conf != null ? conf.toFixed(1) : 0}%)`} style={{ marginRight: "0.35em" }}>
                                              ⚠️
                                            </span>
                                          )}
                                          {line}
                                        </span>
                                        {conf != null && (
                                          <span style={{ flexShrink: 0 }}>
                                            <ConfidenceBadge value={conf} />
                                          </span>
                                        )}
                                      </li>
                                    );
                                  })}
                                </ul>
                              ) : (
                                <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.85em" }}>
                                  {extraction.text}
                                </pre>
                              )}

                              {/* Action buttons */}
                              <div style={{ display: "flex", gap: "0.5em", marginTop: "0.5em", fontSize: "0.8em" }}>
                                {extraction.resultId && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditingText((prev) => ({
                                        ...prev,
                                        [request.request_id]: extraction.text,
                                      }))
                                    }
                                    style={{ fontSize: "0.9em", padding: "0.2em 0.5em", cursor: "pointer" }}
                                  >
                                    ✏️ Edit text
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => copyText(request.request_id, extraction.text)}
                                  style={{ fontSize: "0.9em", padding: "0.2em 0.5em", cursor: "pointer" }}
                                >
                                  {copiedId === request.request_id ? "✓ Copied!" : "📋 Copy text"}
                                </button>
                              </div>
                            </>
                          )}
                        </details>
                      ) : (
                        <div
                          role="alert"
                          style={{
                            padding: "0.5em 0.75em",
                            margin: "0.5em 0",
                            backgroundColor: "#fff1f0",
                            border: "1px solid #ffa39e",
                            borderRadius: "4px",
                            fontSize: "0.85em",
                            color: "#a8071a",
                          }}
                        >
                          <strong>⚠️ No readable text detected in this image (0.0% confidence)</strong>
                          <p style={{ margin: "0.25em 0 0" }}>
                            The scan could not recognize any characters clearly. Try uploading a well-lit, close-up photo of the label or manual.
                          </p>
                        </div>
                      )
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

/** Colour-coded confidence badge (green ≥ 90, yellow ≥ 70, red < 70, dark red < 50). */
function ConfidenceBadge({ value, label }) {
  const pct = typeof value === "number" ? value : 0;
  let color = "#c0392b"; // red (< 70)
  if (pct >= 90) color = "#27ae60"; // green
  else if (pct >= 70) color = "#f39c12"; // yellow/orange
  else if (pct < 50) color = "#962d22"; // dark red (< 50)

  const level =
    pct >= 90
      ? "High confidence"
      : pct >= 70
      ? "Moderate confidence"
      : pct >= 50
      ? "Low confidence - review recommended"
      : "Very low confidence - likely inaccurate";

  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.1em 0.45em",
        borderRadius: "4px",
        fontSize: "0.8em",
        fontWeight: 600,
        color: "#fff",
        backgroundColor: color,
      }}
      title={`Textract confidence: ${pct.toFixed(1)}% (${level})`}
    >
      {pct.toFixed(1)}%{label ? ` ${label}` : ""}
    </span>
  );
}

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
