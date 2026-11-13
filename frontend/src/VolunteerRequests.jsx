import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "./auth.js";

function newestFirst(first, second) {
  return second.created_at.localeCompare(first.created_at);
}

function useRequestList(config, view, search, refresh) {
  const [requests, setRequests] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pending = useRef(null);

  const loadPage = useCallback(async (cursor = null) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError("");
    if (!cursor) {
      setRequests([]);
      setNextCursor(null);
    }

    try {
      const params = new URLSearchParams({ view });
      if (search) params.set("q", search);
      if (cursor) params.set("cursor", cursor);
      let page;
      // A DynamoDB page can have no matches while older pages still have results.
      do {
        page = await apiRequest(config, `/requests?${params}`, { signal: controller.signal });
        if (page.next_cursor) params.set("cursor", page.next_cursor);
      } while (!page.requests.length && page.next_cursor && !controller.signal.aborted);

      if (controller.signal.aborted) return;
      setRequests((previous) => {
        const seen = new Set(previous.map(({ request_id }) => request_id));
        return [...previous, ...page.requests.filter(({ request_id }) => !seen.has(request_id))].sort(newestFirst);
      });
      setNextCursor(page.next_cursor);
    } catch (error) {
      if (!controller.signal.aborted) setError(error.message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [config, search, view]);

  useEffect(() => {
    loadPage();
    return () => pending.current?.abort();
  }, [loadPage, refresh]);

  return { requests, setRequests, nextCursor, loading, error, loadPage };
}

function insertRequest(requests, updated) {
  return [...requests.filter(({ request_id }) => request_id !== updated.request_id), updated].sort(newestFirst);
}

function RequestList({ heading, list, emptyMessage, action, actionLabel, actionableStatus, busy, pendingId }) {
  return (
    <section aria-label={heading}>
      <h4>{heading}</h4>
      {list.loading && <p role="status">Loading requests…</p>}
      {list.error && <p role="alert">{list.error}</p>}
      {!list.loading && !list.error && !list.requests.length && <p>{emptyMessage}</p>}
      {list.requests.length > 0 && (
        <ul>
          {list.requests.map((request) => (
            <li key={request.request_id}>
              <strong>{request.item_name}</strong> — {request.status}
              <p>{request.description}</p>
              {request.status === actionableStatus && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => action(request)}
                  aria-label={`${actionLabel} ${request.item_name}`}
                >
                  {pendingId === request.request_id ? "Updating…" : actionLabel}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {list.nextCursor && (
        <button type="button" disabled={busy} onClick={() => list.loadPage(list.nextCursor)}>
          Load more {heading.toLowerCase()}
        </button>
      )}
    </section>
  );
}

export default function VolunteerRequests({ config }) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [pendingId, setPendingId] = useState(null);
  const [actionError, setActionError] = useState("");
  const [feedback, setFeedback] = useState("");
  const available = useRequestList(config, "available", search, refresh);
  const claimed = useRequestList(config, "claimed", "", refresh);
  const busy = pendingId !== null || available.loading || claimed.loading;

  function refreshLists() {
    setRefresh((previous) => previous + 1);
  }

  async function changeClaim(request, method) {
    setPendingId(request.request_id);
    setActionError("");
    setFeedback("");
    try {
      const path = `/requests/${encodeURIComponent(request.request_id)}/claim`;
      const { request: updated, notification } = await apiRequest(config, path, { method });
      const isClaim = method === "POST";
      if (isClaim) {
        available.setRequests((previous) => previous.filter(({ request_id }) => request_id !== updated.request_id));
        claimed.setRequests((previous) => insertRequest(previous, updated));
      } else {
        claimed.setRequests((previous) => previous.filter(({ request_id }) => request_id !== updated.request_id));
        if (updated.item_name.toLowerCase().includes(search.toLowerCase())) {
          available.setRequests((previous) => insertRequest(previous, updated));
        }
      }
      const message = `${updated.item_name} ${isClaim ? "claimed" : "released"}.`;
      setFeedback(notification === "failed" ? `${message} The status email could not be sent.` : message);
    } catch (error) {
      setActionError(error.message);
      if (error.status === 409) refreshLists();
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section aria-labelledby="volunteer-heading">
      <h3 id="volunteer-heading">Volunteer dashboard</h3>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (pendingId !== null) return;
        const term = searchInput.trim();
        if (term === search) available.loadPage();
        else setSearch(term);
      }}>
        <label htmlFor="volunteer-search">Search available requests by item name</label>{" "}
        <input id="volunteer-search" type="search" value={searchInput} maxLength={120}
          onChange={(event) => setSearchInput(event.target.value)} />{" "}
        <button type="submit" disabled={pendingId !== null}>Search</button>{" "}
        <button type="button" disabled={pendingId !== null} onClick={refreshLists}>Refresh requests</button>
      </form>
      {actionError && <p role="alert">{actionError}</p>}
      {feedback && <p role="status">{feedback}</p>}
      <RequestList heading="Available requests" list={available}
        emptyMessage={search ? "No available requests match that item name." : "No repair requests are available."}
        action={(request) => changeClaim(request, "POST")} actionLabel="Claim" actionableStatus="Submitted"
        busy={busy} pendingId={pendingId} />
      <RequestList heading="My claimed requests" list={claimed} emptyMessage="You have no claimed requests."
        action={(request) => changeClaim(request, "DELETE")} actionLabel="Release" actionableStatus="In Progress"
        busy={busy} pendingId={pendingId} />
    </section>
  );
}
